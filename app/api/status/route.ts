import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  redis,
  latestFrameKey,
  parseLatestFrame,
  ACTIVE_SOURCE_KEY,
  SOURCES,
  type Source,
  type LatestFrame,
} from '@/lib/redis'
import { athensToday, eventFor, nextEvent } from '@/lib/schedule'
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

export async function GET() {
  try {
    // 1. Redis reads in parallel. Malformed payloads parse to null (absent),
    //    never a 500.
    const [pegasusRaw, seestarRaw, activeRaw] = await Promise.all([
      redis.get(latestFrameKey('pegasus')),
      redis.get(latestFrameKey('seestar')),
      redis.get(ACTIVE_SOURCE_KEY),
    ])
    const frames: Record<Source, LatestFrame | null> = {
      pegasus: parseLatestFrame(pegasusRaw),
      seestar: parseLatestFrame(seestarRaw),
    }
    const activeSource: Source | null =
      activeRaw === 'pegasus' || activeRaw === 'seestar' ? activeRaw : null

    // 2. Per-source age from ingestedAt — server-receipt time, i.e. "did we hear
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
    const ingestedMs = (s: Source): number => new Date(frames[s]!.ingestedAt).getTime()
    const freshSources = SOURCES.filter((s) => sources[s]?.fresh)

    // 3. LIVE if at least one source is fresh.
    if (freshSources.length > 0) {
      let chosen: Source
      if (activeSource && sources[activeSource]?.fresh) {
        // Hysteresis: stick with the active source unless the other is fresh AND
        // meaningfully newer (>45s), so a near-tie doesn't flap the feed.
        chosen = activeSource
        const other: Source = activeSource === 'pegasus' ? 'seestar' : 'pegasus'
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

      // Telemetry is best-effort passthrough; object-name fields are added
      // ONLY when astrometryState is 'solved' AND both coordinates are
      // present — any other astrometryState (or missing telemetry entirely,
      // e.g. Tier-1-only frames) omits them outright, not null/"Unknown", so
      // the frontend's existing no-confident-name fallback path handles it.
      const telemetry = f.telemetry
      let objectMatch:
        | { name: string; confidence: 'high' | 'medium' | 'low' | 'none'; description: string; type: string }
        | undefined
      if (
        telemetry?.astrometryState === 'solved' &&
        typeof telemetry.raDegrees === 'number' &&
        typeof telemetry.decDegrees === 'number'
      ) {
        const result = matchCoordinates(telemetry.raDegrees, telemetry.decDegrees)
        if (result.match) {
          objectMatch = {
            name: result.match.primaryName,
            confidence: result.confidence,
            description: result.match.description,
            type: result.match.type,
          }
        }
      }

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

    // 4. OFFLINE. The only remaining DB access is the single cancellation
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
    // 5. Any unexpected throw still answers 200. Contract: this endpoint never
    //    fails — if status goes down, /live goes down with it, gracefully.
    console.error('/api/status unexpected error', e)
    return json({ live: false, degraded: true })
  }
}
