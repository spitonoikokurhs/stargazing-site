import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  redis,
  latestFrameKey,
  parseLatestFrame,
  ACTIVE_SOURCE_KEY,
  EVENT_FINISHED_KEY,
  eventFinishedKey,
  HOTEL_SOURCES,
  isValidSource,
  type HotelSource,
  type Source,
  type LatestFrame,
} from '@/lib/redis'
import { athensToday, eventFor, nextEvent } from '@/lib/schedule'
import { extraEventFor, isExtraEventSlug } from '@/lib/extra-events'
import { matchCoordinates } from '@/lib/catalog'

// Node runtime for the single Prisma read on the offline path (cancellation
// status). The live path is Redis-only. Neither path writes to Postgres —
// session closing lives in /api/cron/close-sessions (lib/sessions.ts).
export const runtime = 'nodejs'

const LIVE_WINDOW_MS = 5 * 60 * 1000 // a source is "fresh" if heard from within 5 min
const HYSTERESIS_MS = 45 * 1000 // only switch away from the active source if the other leads by >45s
const ACTIVE_SOURCE_TTL_S = 600 // 10-min TTL on the chosen-source key

// Every response is uncacheable — /live polls this every 10s for current state.
function json(body: unknown) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

type ObjectMatch = {
  name: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  description: string
  type: string
  constellation?: string
  distanceLy?: number
  sizeDescription?: string
  wowFacts?: string[]
  visualHint?: string
  drawer?: { heading: string; body: string }[]
}

// Shared by the hotel dual-source path and the single-source extra-event
// path: object-name fields are added ONLY when astrometryState is 'solved'
// AND both coordinates are present — any other astrometryState (or missing
// telemetry entirely, e.g. Tier-1-only frames) omits them outright, not
// null/"Unknown", so the frontend's existing no-confident-name fallback path
// handles it.
function resolveObjectMatch(telemetry: LatestFrame['telemetry']): ObjectMatch | undefined {
  if (
    telemetry?.astrometryState !== 'solved' ||
    typeof telemetry.raDegrees !== 'number' ||
    typeof telemetry.decDegrees !== 'number'
  ) {
    return undefined
  }
  const result = matchCoordinates(telemetry.raDegrees, telemetry.decDegrees)
  if (!result.match) return undefined
  return {
    name: result.match.primaryName,
    confidence: result.confidence,
    description: result.match.description,
    type: result.match.type,
    ...(result.match.constellation ? { constellation: result.match.constellation } : {}),
    ...(result.match.distanceLy ? { distanceLy: result.match.distanceLy } : {}),
    ...(result.match.sizeDescription ? { sizeDescription: result.match.sizeDescription } : {}),
    ...(result.match.wowFacts ? { wowFacts: result.match.wowFacts } : {}),
    ...(result.match.visualHint ? { visualHint: result.match.visualHint } : {}),
    ...(result.match.drawer ? { drawer: result.match.drawer } : {}),
  }
}

// Current Athens wall-clock time as "HH:MM" (24h, zero-padded) for same-day
// comparison against an event's end time.
function athensNowHHMM(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

// Tomorrow's Athens calendar date (UTC arithmetic = pure calendar-day math).
function athensTomorrow(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Single-source status for a special event (config/extra-events.json). Shaped
// identically to the hotel path's live/offline responses (same field names —
// see LiveView.tsx's StatusLive/StatusOffline guards) so the SAME frontend
// state machine renders both, but with everything hotel-specific removed:
// no hysteresis (one source, not two), no ACTIVE_SOURCE_KEY, no Postgres
// cancellation lookup (a special event has no cancellable Session row — it's
// not part of the weekly schedule at all), no shared EVENT_FINISHED_KEY (see
// eventFinishedKey — a per-source flag so finishing one special event can
// never finish a hotel's night, or another special event). The UFO farewell
// mechanism is deliberately not wired to special events either way — a
// finished special event gets its own simple SpecialEventFarewell screen
// (see app/live/LiveView.tsx's 'special-event-finished' uiState). `source`
// doubles as both the special-event slug and the ingest Source value (see
// lib/extra-events.ts).
async function extraEventStatus(slug: Source): Promise<NextResponse> {
  // Finished check FIRST, same ordering discipline as the hotel path below —
  // an explicit POST /api/finish?event=<slug> must win even over a
  // still-fresh frame.
  const finishedRaw = await redis.get(eventFinishedKey(slug))
  if (finishedRaw != null) {
    return json({ live: false, specialEventFinished: true })
  }

  const raw = await redis.get(latestFrameKey(slug))
  const frame = parseLatestFrame(raw)

  const now = Date.now()
  const fresh = frame ? now - new Date(frame.ingestedAt).getTime() < LIVE_WINDOW_MS : false

  if (frame && fresh) {
    const objectMatch = resolveObjectMatch(frame.telemetry)
    return json({
      live: true,
      source: slug,
      frame: {
        frameId: frame.frameId,
        blobUrl: frame.blobUrl,
        capturedAt: frame.capturedAt,
        ingestedAt: frame.ingestedAt,
      },
      observation: { observationId: frame.observationId, objectName: frame.objectName },
      sessionId: frame.sessionId,
      viewers: null,
      sources: { [slug]: { fresh: true, ageSeconds: Math.max(0, Math.round((now - new Date(frame.ingestedAt).getTime()) / 1000)) } },
      ...(frame.telemetry
        ? {
            telemetry: {
              state: frame.telemetry.state,
              totalAccumulatedTime: frame.telemetry.totalAccumulatedTime,
              astrometryState: frame.telemetry.astrometryState,
            },
          }
        : {}),
      ...(objectMatch ? { objectMatch } : {}),
    })
  }

  // Offline shape: no weekly schedule applies to an extra event, so `tonight`
  // is always null (nothing to cancel) and `next` is always null (this isn't
  // part of the recurring rotation `nextEvent()` walks) — the offline screen
  // falls back to its generic "no upcoming sessions" copy, which is correct
  // here: there is no next occurrence to advertise.
  return json({ live: false, tonight: null, next: null })
}

export async function GET(req: NextRequest) {
  try {
    // 0. Special-event branch (?event=<slug>) — called by /live/special-event
    //    (app/live/special-event/EventGate.tsx) with whichever slug
    //    lib/extra-events.ts's resolveSpecialEvent picked server-side.
    //    Entirely separate from the hotel dual-source logic below: single
    //    fixed source, no hysteresis, no ACTIVE_SOURCE_KEY, no Postgres
    //    cancellation/schedule lookups (a special event has no weekly
    //    schedule). An unknown/absent slug falls through to the normal hotel
    //    path unchanged.
    const eventSlug = req.nextUrl.searchParams.get('event')
    if (eventSlug && isExtraEventSlug(eventSlug) && isValidSource(eventSlug)) {
      return await extraEventStatus(eventSlug)
    }

    // 1. Redis reads in parallel, INCLUDING the finished flag — but the
    //    finished flag is READ here only for efficiency (one round trip);
    //    the DECISION to short-circuit on it happens immediately below,
    //    strictly before any frame-freshness logic runs. This ordering is
    //    the whole point of the feature: an explicit "tonight is finished"
    //    must win even when the last frame is only seconds old. Malformed
    //    frame payloads parse to null (absent), never a 500.
    const [pegasusRaw, seestarRaw, activeRaw, finishedRaw] = await Promise.all([
      redis.get(latestFrameKey('pegasus')),
      redis.get(latestFrameKey('seestar')),
      redis.get(ACTIVE_SOURCE_KEY),
      redis.get(EVENT_FINISHED_KEY),
    ])

    // 2. Finished check FIRST — before touching frame freshness at all. A
    //    stale or quiet feed alone must NEVER produce this state; only an
    //    explicit POST to /api/finish sets this key (see that route and
    //    app/api/ingest/route.ts, which deletes it on the next successful
    //    fresh ingest — the key existing at all IS the signal, so its value
    //    doesn't matter).
    //
    //    date + next are included so every viewer (every guest phone AND the
    //    lobby TV) can independently derive the SAME farewell animation
    //    variant and the SAME "next session" line without a second request:
    //    - date (today's Athens calendar date) is the deterministic seed for
    //      picking a farewell variant (see lib/live-farewell.ts) — every
    //      client computes the same pick from the same date string, so
    //      everyone at tonight's event sees the same closer, and it changes
    //      automatically on the next scheduled night with no server-side
    //      state beyond the date itself.
    //    - next reuses the exact same nextEvent() lookup the offline path
    //      already uses below, so "Next session: Monday, 21:30" on the
    //      finished screen is never a second source of truth.
    if (finishedRaw != null) {
      const today = athensToday()
      const tonightEvent = eventFor(today)
      const next =
        tonightEvent && athensNowHHMM() < tonightEvent.end
          ? { date: today, ...tonightEvent }
          : nextEvent(athensTomorrow(today))
      return json({ live: false, finished: true, date: today, next })
    }

    const frames: Record<HotelSource, LatestFrame | null> = {
      pegasus: parseLatestFrame(pegasusRaw),
      seestar: parseLatestFrame(seestarRaw),
    }
    const activeSource: HotelSource | null =
      activeRaw === 'pegasus' || activeRaw === 'seestar' ? activeRaw : null

    // 3. Per-source age from ingestedAt — server-receipt time, i.e. "did we hear
    //    from a telescope recently?" (capturedAt is a device clock, display-only).
    //    An unparseable ingestedAt collapses to null: treated as absent.
    const now = Date.now()
    const ageInfo = (f: LatestFrame | null): { fresh: boolean; ageSeconds: number } | null => {
      if (!f) return null
      const t = new Date(f.ingestedAt).getTime()
      if (Number.isNaN(t)) return null
      const ageMs = now - t
      return { fresh: ageMs < LIVE_WINDOW_MS, ageSeconds: Math.max(0, Math.round(ageMs / 1000)) }
    }
    const sources = {
      pegasus: ageInfo(frames.pegasus),
      seestar: ageInfo(frames.seestar),
    }
    const ingestedMs = (s: HotelSource): number => new Date(frames[s]!.ingestedAt).getTime()
    const freshSources = HOTEL_SOURCES.filter((s) => sources[s]?.fresh)

    // 4. LIVE if at least one source is fresh.
    if (freshSources.length > 0) {
      let chosen: HotelSource
      if (activeSource && sources[activeSource]?.fresh) {
        // Hysteresis: stick with the active source unless the other is fresh AND
        // meaningfully newer (>45s), so a near-tie doesn't flap the feed.
        chosen = activeSource
        const other: HotelSource = activeSource === 'pegasus' ? 'seestar' : 'pegasus'
        if (sources[other]?.fresh && ingestedMs(other) - ingestedMs(activeSource) > HYSTERESIS_MS) {
          chosen = other
        }
      } else {
        // Active source stale/absent: pick the freshest fresh source.
        chosen = freshSources.reduce((best, s) => (ingestedMs(s) > ingestedMs(best) ? s : best))
      }

      // Persist the choice with a TTL. Concurrent polls racing this write is
      // benign: every writer picks from the same Redis snapshot, so they write
      // the same value (or an equally-valid one a beat later).
      await redis.set(ACTIVE_SOURCE_KEY, chosen, { ex: ACTIVE_SOURCE_TTL_S })

      const f = frames[chosen]!

      // Telemetry is best-effort passthrough — see resolveObjectMatch for the
      // solved+coordinates gating.
      const telemetry = f.telemetry
      const objectMatch = resolveObjectMatch(telemetry)

      return json({
        live: true,
        source: chosen,
        frame: {
          frameId: f.frameId,
          blobUrl: f.blobUrl,
          capturedAt: f.capturedAt,
          ingestedAt: f.ingestedAt,
        },
        observation: { observationId: f.observationId, objectName: f.objectName },
        sessionId: f.sessionId,
        viewers: null, // placeholder until /api/heartbeat lands; keeps /live on the final shape
        sources,
        ...(telemetry
          ? {
              telemetry: {
                state: telemetry.state,
                // "Total accumulated" per the design review — not "on this
                // object": totalAccumulatedTime does not reset on a target
                // change, so labeling it per-object would misrepresent it.
                totalAccumulatedTime: telemetry.totalAccumulatedTime,
                astrometryState: telemetry.astrometryState,
              },
            }
          : {}),
        ...(objectMatch ? { objectMatch } : {}),
      })
    }

    // 5. OFFLINE. The only remaining DB access is the single cancellation
    //    read below — session closing moved to the /api/cron/close-sessions
    //    cron (see lib/sessions.ts) so this endpoint is never on the hot path
    //    for a Postgres write. That read is individually guarded (see b)
    //    rather than relying on the outer catch, so a DB hiccup there can't
    //    take down the whole offline response.
    try {
      // a. Tonight: is there a scheduled event today?
      const today = athensToday()
      const tonightEvent = eventFor(today)
      let tonight:
        | { hotelId: string; start: string; end: string; cancelled: boolean; cancellationReason?: string }
        | null = null
      if (tonightEvent) {
        // b. Was it cancelled? A missing weather-cancellation banner is
        //    cosmetic; the page staying up matters more — so this read
        //    degrades to cancelled:false on failure instead of bubbling to
        //    the outer catch and losing `next` along with it.
        let cancelled = false
        let cancellationReason: string | undefined
        try {
          const session = await prisma.session.findUnique({
            where: { date_hotelId: { date: today, hotelId: tonightEvent.hotelId } },
          })
          cancelled = session?.status === 'cancelled'
          cancellationReason = cancelled ? (session?.cancellationReason ?? undefined) : undefined
        } catch (e) {
          console.error('/api/status: cancellation read failed, defaulting to not-cancelled', e)
        }
        tonight = {
          hotelId: tonightEvent.hotelId,
          start: tonightEvent.start,
          end: tonightEvent.end,
          cancelled,
          ...(cancellationReason ? { cancellationReason } : {}),
        }
      }

      // c. Next: if today's event hasn't ended yet (Athens wall time), it IS the
      //    next event; otherwise walk forward from tomorrow.
      const next =
        tonightEvent && athensNowHHMM() < tonightEvent.end
          ? { date: today, ...tonightEvent }
          : nextEvent(athensTomorrow(today))

      return json({ live: false, tonight, next })
    } catch (e) {
      // d. Anything else unexpected on the offline path: degrade rather than
      //    500 — the offline copy is non-essential next to the endpoint
      //    always answering.
      console.error('/api/status offline path failed', e)
      return json({ live: false, tonight: null, next: null, degraded: true })
    }
  } catch (e) {
    // 6. Any unexpected throw still answers 200. Contract: this endpoint never
    //    fails — if status goes down, /live goes down with it, gracefully.
    console.error('/api/status unexpected error', e)
    return json({ live: false, degraded: true })
  }
}
