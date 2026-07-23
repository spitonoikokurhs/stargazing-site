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
  recordViewerActivity,
  viewerEventKey,
  viewerSpecialEventKey,
  type HotelSource,
  type Source,
  type LatestFrame,
} from '@/lib/redis'
import { athensToday, eventFor, nextEvent } from '@/lib/schedule'
import { extraEventFor, isExtraEventSlug } from '@/lib/extra-events'
import { matchCoordinates } from '@/lib/catalog'
import { debugSecret, isDebugAuthorized, resolveDebugGate, parseDebugParam } from '@/lib/debug-auth'
import { buildDebugFields } from '@/lib/debug-fields'

// Node runtime for the single Prisma read on the offline path (cancellation
// status). The live path is Redis-only. Neither path writes to Postgres —
// session closing lives in /api/cron/close-sessions (lib/sessions.ts).
export const runtime = 'nodejs'

// Belt-and-suspenders against a cached response: this endpoint is polled every
// 10s for CURRENT state, and — critically for the ?debug=1 path — a response
// built for an authenticated operator (which bypasses the finished flag) must
// NEVER be replayed to a guest from any cache. force-dynamic + revalidate 0
// keep Next from ever statically caching, and every response also carries
// explicit no-store headers (see json() / debugJson() below).
export const dynamic = 'force-dynamic'
export const revalidate = 0

const LIVE_WINDOW_MS = 5 * 60 * 1000 // a source is "fresh" if heard from within 5 min
const HYSTERESIS_MS = 45 * 1000 // only switch away from the active source if the other leads by >45s
const ACTIVE_SOURCE_TTL_S = 600 // 10-min TTL on the chosen-source key

// Every response is uncacheable — /live polls this every 10s for current
// state. Hardened beyond a bare `no-store` because the ?debug=1 path can return
// live data that a guest must never receive from an intermediary cache: the
// full directive set plus Vary make "do not store, do not reuse across auth
// states" explicit to every proxy/CDN, not just the browser. Vary lists BOTH
// Authorization (Bearer path) and Cookie (the signed sg_debug cookie path), so
// a cache keyed on either credential can never serve one caller's response to
// another with different credentials.
const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Authorization, Cookie',
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

// Debug responses get an additional `private` directive — belt-and-suspenders
// so a shared cache treats them as single-user even if the directives above
// were somehow relaxed. Used for the ?debug=1 live/no-feed responses and the
// 401 an unauthenticated debug request receives.
const DEBUG_NO_STORE_HEADERS: Record<string, string> = {
  ...NO_STORE_HEADERS,
  'Cache-Control': `private, ${NO_STORE_HEADERS['Cache-Control']}`,
}
function debugJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: DEBUG_NO_STORE_HEADERS })
}

// A guest's random, per-tab viewer id (see VIEWER_ID_STORAGE_KEY in
// LiveView.tsx) — NOT an IP, cookie, or anything tied to identity, purely a
// dedup key for private viewer analytics (see lib/redis.ts's
// recordViewerActivity / /api/viewer-stats). Loosely validated (bounded
// length, safe charset) since it's untrusted input written straight into
// Redis; missing/invalid values simply skip tracking for that poll rather
// than failing the request — this endpoint's guest-facing behavior must
// never depend on viewer tracking succeeding.
const VIEWER_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
function readViewerId(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get('viewerId')
  return raw && VIEWER_ID_PATTERN.test(raw) ? raw : null
}

// Private analytics may NEVER slow the guest-facing hot path — a slow Redis
// round trip here must not delay (and definitely must not fail) the actual
// status response, which is what drives /live's live/reconnecting/offline
// UI. Racing against a short timeout means the worst case is simply "this
// one poll's viewer count didn't get recorded," never "a guest's frame
// took an extra 2s to appear because Redis was having a bad moment."
const VIEWER_TRACKING_TIMEOUT_MS = 250

// Fail-open, time-boxed viewer tracking. Awaited (so serverless doesn't tear
// down before the write lands, in the common case where it's fast) but
// raced against VIEWER_TRACKING_TIMEOUT_MS and wrapped in try/catch: this
// cannot delay the response beyond VIEWER_TRACKING_TIMEOUT_MS, though the
// underlying Redis write may still complete afterward in the background
// (Promise.race doesn't cancel the loser, it just stops waiting on it) — and
// a failing Redis call can never throw into the response either way, since
// recordViewerActivity already catches internally and returns null on
// failure. This wrapper's job is to make both of those guarantees explicit
// at the call site, not to claim tracking has zero footprint after the
// timeout fires.
async function trackViewer(
  scope: 'hotel' | 'event',
  slug: Source | null,
  eventKey: string,
  viewerId: string | null,
): Promise<void> {
  if (!viewerId) return
  try {
    await Promise.race([
      recordViewerActivity(scope, slug, eventKey, viewerId),
      new Promise((resolve) => setTimeout(resolve, VIEWER_TRACKING_TIMEOUT_MS)),
    ])
  } catch (e) {
    console.error('/api/status: viewer tracking failed', e)
  }
}

// Today's scheduled hotel event key (see viewerEventKey in lib/redis.ts) —
// shared by every hotel-path branch that tracks viewers (live, finished,
// reconnecting/degraded during a scheduled window), so they all land in the
// SAME per-night bucket regardless of which specific state the guest's poll
// happened to observe.
function hotelViewerEventKey(): string {
  const today = athensToday()
  return viewerEventKey(today, eventFor(today)?.hotelId ?? null)
}

type ObjectMatch = {
  name: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  // Objective "is the field contested" fact from matchCoordinates (see its
  // doc comment): true when a SECOND catalog object is within its own display
  // radius of this solve. The client's shared display-name policy uses it to
  // decide whether a 'medium' match is safe to name (off-center, no rival) or
  // should be withheld (genuinely ambiguous). Surfaced as the raw fact, not a
  // display verdict, so the live card and history strip can each apply their
  // own policy. Absent-in-payload defaults to false ("no rival") on the
  // client, the safe direction for the guardrail (see isValidObjectMatch).
  hasInRangeRunnerUp: boolean
  description: string
  type: string
  constellation?: string
  distanceLy?: number
  sizeDescription?: string
  wowFacts?: string[]
  visualHint?: string
  drawer?: { heading: string; body: string }[]
}

type HistoryEntry = {
  // StackRun.id — the correct React key on the client (see LiveView.tsx):
  // startedAt is a timestamp string, and same-millisecond StackRun rows are
  // possible under concurrent ingest requests, which would collide as a key.
  // id is the DB primary key, always unique.
  id: string
  objectId: string | null
  objectName: string | null
  objectType: string | null
  confidence: string | null
  // Contested-field fact for this run's stored match (StackRun.hasInRangeRunnerUp;
  // see lib/catalog.ts). The TAPPABLE history strip gates the pill's name on
  // this via the SAME shouldShowMatchName policy the live card uses. null on
  // runs with no match / rows predating the column — the client treats null as
  // false ("not contested"), matching today's behavior for old runs.
  hasInRangeRunnerUp: boolean | null
  startedAt: string
  endedAt: string | null
  blobUrl: string | null
  active: boolean
}

// Tonight's session-history strip data (app/live/LiveView.tsx) — every
// StackRun row for this session+source, chronological (startedAt asc), raw
// and unfiltered. Client-side display rules (omit old null-identity runs,
// show a neutral pill only for an unresolved ACTIVE run, etc. — see
// LiveView.tsx) are deliberately NOT applied here, matching this codebase's
// existing pattern of endpoints returning raw data and letting the client
// decide presentation (e.g. /api/observations/[id]/milestones). `active` is
// true for exactly the row with endedAt: null (there is at most one open
// StackRun per session+source at a time, by construction — see the
// updateMany-then-create sequencing in app/api/ingest/route.ts). blobUrl is
// resolved from latestFrameId, falling back to firstFrameId if the latest
// frame lookup somehow misses (defensive; should not normally happen) —
// null (never a broken image) if neither frame can be found.
//
// Never fails the caller: any Postgres error here degrades to an empty
// array, exactly like the offline path's own cancellation-read guard — a
// missing history strip is cosmetic, unlike the live frame itself.
// Defensive cap — a real session rarely exceeds 5-6 runs, but this bounds
// the query and the response regardless. Queried DESC + take, then reversed
// back to chronological order, so a long session's cap keeps the MOST
// RECENT 20 runs (including the active one), not an arbitrary first-20 that
// could silently drop the current target off the end of a long night.
const HISTORY_MAX_RUNS = 20

async function fetchHistory(sessionId: string, source: string): Promise<HistoryEntry[]> {
  try {
    const recentDesc = await prisma.stackRun.findMany({
      where: { sessionId, source },
      orderBy: { startedAt: 'desc' },
      take: HISTORY_MAX_RUNS,
    })
    const runs = recentDesc.slice().reverse()
    if (runs.length === 0) return []

    const frameIds = Array.from(
      new Set(runs.flatMap((r) => [r.latestFrameId, r.firstFrameId]).filter((id): id is string => id !== null)),
    )
    const frames = await prisma.frame.findMany({
      where: { id: { in: frameIds } },
      select: { id: true, blobUrl: true },
    })
    const blobById = new Map(frames.map((f) => [f.id, f.blobUrl]))

    return runs.map((r) => ({
      id: r.id,
      objectId: r.objectId,
      objectName: r.objectName,
      objectType: r.objectType,
      confidence: r.confidence,
      hasInRangeRunnerUp: r.hasInRangeRunnerUp,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      blobUrl: (r.latestFrameId && blobById.get(r.latestFrameId)) || (r.firstFrameId && blobById.get(r.firstFrameId)) || null,
      active: r.endedAt === null,
    }))
  } catch (e) {
    console.error('/api/status: history fetch failed, degrading to empty', e)
    return []
  }
}

// The currently-open StackRun's startedAt, straight from the SAME history
// array already fetched above — not a second Postgres query. This is what
// lets the client detect "a new stack run has started" from the main
// /api/status poll alone (source+observationId+stackRunStartedAt, mirroring
// computeRunKey in lib/detect-transition.ts), instead of depending on the
// separate, independently-timed useMilestoneFrames poll cycle
// (/api/observations/[id]/milestones) the way the milestone toggle's own
// reset logic does. Deriving it from `history` also guarantees the two
// values can never disagree with each other (a second independent query
// could race and return an inconsistent snapshot).
function activeStackRunStartedAt(history: HistoryEntry[]): string | null {
  return history.find((h) => h.active)?.startedAt ?? null
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
    hasInRangeRunnerUp: result.hasInRangeRunnerUp,
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

// "HH:MM" -> minutes since midnight, for arithmetic comparisons that plain
// string comparison can't safely do once a margin is involved (e.g. "22:30"
// + 60min needs to become "23:30", which string comparison has no notion
// of). Every hotel event currently configured (config/schedule.json) starts
// and ends well within a single Athens calendar day even after a ±60min
// margin, so this deliberately does NOT handle a margin pushing past
// midnight — it's a same-day window check, matching how `tonight`/`today`
// are already computed elsewhere in this file.
function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Is `nowHHMM` within [start - marginMinutes, end + marginMinutes]? Used to
// gate viewer tracking on the hotel offline path (see the P1 fix note below)
// so a guest polling at 10am doesn't count toward tonight's 21:30-22:30
// event just because `tonight` happens to be scheduled for later today.
function withinEventWindow(nowHHMM: string, start: string, end: string, marginMinutes: number): boolean {
  const now = minutesSinceMidnight(nowHHMM)
  const windowStart = minutesSinceMidnight(start) - marginMinutes
  const windowEnd = minutesSinceMidnight(end) + marginMinutes
  return now >= windowStart && now <= windowEnd
}

// Same idea as withinEventWindow above, but for a special event's full
// revealAt/endsAt ISO range rather than a same-day HH:MM pair — a special
// event isn't bounded to "today," so this compares real timestamps. Used to
// gate viewer tracking on the special-event path so an open tab left polling
// ?event=<slug> well after the event's endsAt (+ a farewell grace period)
// doesn't keep inflating that event's numbers indefinitely.
function withinSpecialEventTrackingWindow(now: Date, revealAt: string, endsAt: string, marginMinutes: number): boolean {
  const t = now.getTime()
  const start = new Date(revealAt).getTime()
  const end = new Date(endsAt).getTime() + marginMinutes * 60 * 1000
  return t >= start && t <= end
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
async function extraEventStatus(slug: Source, viewerId: string | null): Promise<NextResponse> {
  // Stable per-event key derived from the event's OWN config (revealAt), not
  // today's date — see viewerSpecialEventKey's doc comment. A special event
  // can span multiple calendar days (e.g. a 3-night event), and "unique
  // viewers during the event" must count across the whole window rather than
  // resetting at midnight each night the way the hotel path's date-scoped
  // key correctly does for genuinely separate hotel nights. extraEventFor
  // returning null here (a slug this route was already handed but the
  // config lookup somehow misses) degrades tracking to a generic per-slug
  // key rather than blocking the response — same fail-open spirit as
  // everything else viewer-tracking related.
  const extraEvent = extraEventFor(slug)
  const specialEventKey = viewerSpecialEventKey(slug, extraEvent?.revealAt ?? 'unknown')

  // Finished check FIRST, same ordering discipline as the hotel path below —
  // an explicit POST /api/finish?event=<slug> must win even over a
  // still-fresh frame. Still tracked: a guest sitting on the farewell screen
  // is still "on the live page during the event," which is what this metric
  // means to capture (see the P2 fix note on tracking during all states).
  // ALWAYS tracked once finished is set, regardless of the time-window check
  // below — the finished flag itself is the authoritative "this is still
  // (just barely) part of the event" signal, more reliable than a clock
  // comparison for a farewell screen that can legitimately run past endsAt.
  const finishedRaw = await redis.get(eventFinishedKey(slug))
  if (finishedRaw != null) {
    await trackViewer('event', slug, specialEventKey, viewerId)
    return json({ live: false, specialEventFinished: true })
  }

  // Gates the two NOT-yet-finished tracking calls below: an open tab left
  // polling ?event=<slug> long after endsAt (with the finished flag either
  // never set or already expired) shouldn't keep inflating this event's
  // numbers indefinitely — e.g. someone's phone left on the mystery-gate/
  // live page overnight after a Sunday event must not bleed into whatever
  // Monday's stats end up meaning. A 60-minute grace past endsAt covers the
  // same "farewell wind-down" window the hotel path's own margin covers.
  const now = new Date()
  const withinWindow = extraEvent ? withinSpecialEventTrackingWindow(now, extraEvent.revealAt, extraEvent.endsAt, 60) : false

  const raw = await redis.get(latestFrameKey(slug))
  const frame = parseLatestFrame(raw)

  const nowMs = now.getTime()
  const fresh = frame ? nowMs - new Date(frame.ingestedAt).getTime() < LIVE_WINDOW_MS : false

  if (frame && fresh) {
    // Private analytics only — see trackViewer's doc comment. Never affects
    // this response, which is unchanged from before viewer tracking existed.
    if (withinWindow) await trackViewer('event', slug, specialEventKey, viewerId)
    const objectMatch = resolveObjectMatch(frame.telemetry)
    const history = await fetchHistory(frame.sessionId, slug)
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
      history,
      stackRunStartedAt: activeStackRunStartedAt(history),
      sources: { [slug]: { fresh: true, ageSeconds: Math.max(0, Math.round((nowMs - new Date(frame.ingestedAt).getTime()) / 1000)) } },
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

  // Still tracked (subject to the same withinWindow gate as above): a stale/
  // absent frame here covers both "relay restart mid-event" and "event
  // hasn't started producing frames yet" — this route is only ever reached
  // for a slug the caller already resolved as THIS event's page (see
  // resolveSpecialEvent), so a guest polling here is, by construction, on
  // the special event's live page during its window. But without the gate,
  // an open tab left polling long after endsAt (finished flag already
  // expired or never set) would keep counting indefinitely.
  if (withinWindow) await trackViewer('event', slug, specialEventKey, viewerId)

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
    const viewerId = readViewerId(req)

    // Debug gate (private operator lens — /live-debug, see app/live-debug/
    // auth/route.ts). Resolved BEFORE any other branch so the one genuinely
    // dangerous outcome — an unauthenticated debug request silently receiving
    // normal guest behaviour and being mistaken for a working debug view —
    // can never happen: a debug request that isn't authorized is a hard 401,
    // never a quiet fall-through. Only when authorized does the finished flag
    // get skipped and the extra raw fields get included (both strictly below,
    // gated on debugAuthorized). A request with NO ?debug at all is the
    // ordinary guest path, byte-for-byte unchanged — this whole block is inert
    // for it.
    //
    // The debug param is parsed STRICTLY (parseDebugParam over getAll): exactly
    // one `debug=1` is valid; `debug=true`, `debug=0`, or a duplicated/mixed
    // `debug=0&debug=1` is a 400 client error — NOT silently degraded to the
    // guest path, which would let an operator believe they're in debug while
    // actually seeing the guest view (the same "invisible mistake" the
    // no-fall-through rule guards against).
    const debugParam = parseDebugParam(req.nextUrl.searchParams.getAll('debug'))
    if (debugParam === 'malformed') {
      return debugJson({ error: "invalid debug param — use exactly ?debug=1" }, 400)
    }
    const debugRequested = debugParam === 'valid'
    const secret = debugSecret()
    const debugAuthorized = debugRequested && secret !== undefined && isDebugAuthorized(req, secret)
    if (debugRequested && !debugAuthorized) {
      if (secret === undefined) {
        console.error('/api/status?debug=1: no debug secret configured (set DEBUG_VIEW_TOKEN)')
      } else {
        console.warn(`/api/status?debug=1: auth failure at ${new Date().toISOString()}`)
      }
      return debugJson({ error: 'unauthorized' }, 401)
    }

    const eventSlug = req.nextUrl.searchParams.get('event')
    // v1 contract: debug mode is scoped to the hotel-night use case ONLY, not
    // the single-source special-event path. Rather than let ?debug=1&event=…
    // authenticate and then fall into ordinary special-event behaviour (which
    // would still track viewers and honour that event's finished flag —
    // contradicting the debug contract), reject the combination outright with a
    // 400. A future version can wire debug into special events deliberately.
    if (debugRequested && eventSlug !== null) {
      return debugJson({ error: 'debug mode is not supported with ?event= in v1' }, 400)
    }
    if (eventSlug && isExtraEventSlug(eventSlug) && isValidSource(eventSlug)) {
      return await extraEventStatus(eventSlug, viewerId)
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
    // A debug-authorized caller SKIPS this short-circuit entirely — the whole
    // point of /live-debug is to keep seeing the real feed after "finish
    // night," when a guest correctly gets the farewell here. Guests (every
    // request without an authorized ?debug=1) hit the check exactly as before;
    // its ordering, tracking, and response are untouched. The verdict is
    // computed via the SAME pure resolveDebugGate the unit tests exercise, so
    // the shipped ordering and the tested ordering can never drift.
    const gate = resolveDebugGate({
      finishedFlag: finishedRaw != null,
      debugRequested,
      debugAuthorized,
    })
    if (gate === 'guest-finished') {
      // Still tracked: a guest sitting on the farewell screen is still "on
      // the live page during the event" — see the P2 fix note on tracking
      // during all states, not only live:true.
      await trackViewer('hotel', null, hotelViewerEventKey(), viewerId)
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

      // Private analytics only — see trackViewer's doc comment. Never affects
      // this response, which is unchanged from before viewer tracking existed
      // (viewers stays the same `null` placeholder guests have always seen;
      // real numbers are readable only via the auth-gated /api/viewer-stats).
      // A debug-authorized caller is the operator, NOT a guest, so it's
      // deliberately excluded from viewer counts — a post-event debugging
      // session must not inflate the night's numbers.
      if (!debugAuthorized) await trackViewer('hotel', null, hotelViewerEventKey(), viewerId)

      // Telemetry is best-effort passthrough — see resolveObjectMatch for the
      // solved+coordinates gating.
      const telemetry = f.telemetry
      const objectMatch = resolveObjectMatch(telemetry)
      const history = await fetchHistory(f.sessionId, chosen)

      const respond = debugAuthorized ? debugJson : json
      return respond({
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
        viewers: null,
        history,
        stackRunStartedAt: activeStackRunStartedAt(history),
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
        // Extra raw inputs for the operator overlay — ONLY ever present when
        // debug-authorized (see buildDebugFields / the GET guard). Guests never
        // receive this key.
        ...(debugAuthorized ? { debug: { finishedBypassed: finishedRaw != null, ...buildDebugFields(f) } } : {}),
      })
    }

    // 4b. DEBUG NO-FEED. A debug-authorized caller with no fresh source gets an
    //     HONEST diagnostic state rather than the guest offline copy: "the
    //     relay isn't sending frames," plus the age of the most recent frame
    //     still in Redis (if any) so the operator can tell a genuinely-dead
    //     relay from one that just paused. Frames carry a ~10-min Redis TTL
    //     refreshed by ingest, so a lastFrameAgeSeconds climbing past ~600
    //     means the last frame is about to (or already did) expire — surfaced
    //     as ttlSeconds too. Deliberately BEFORE the guest offline block so the
    //     operator never sees "no upcoming sessions" poetry when they mean to
    //     be debugging. Guests (no ?debug=1) never reach this.
    if (debugAuthorized) {
      const mostRecent = [frames.pegasus, frames.seestar]
        .filter((f): f is LatestFrame => f !== null)
        .sort((a, b) => new Date(b.ingestedAt).getTime() - new Date(a.ingestedAt).getTime())[0]
      const lastFrameAgeSeconds = mostRecent
        ? Math.max(0, Math.round((now - new Date(mostRecent.ingestedAt).getTime()) / 1000))
        : null
      return debugJson({
        live: false,
        debugNoFeed: true,
        debug: {
          finishedBypassed: finishedRaw != null,
          message: mostRecent
            ? 'No fresh feed — last frame is older than the 5-min live window.'
            : 'No live feed — relay is not sending frames (no frame in Redis).',
          lastFrameSource: mostRecent
            ? mostRecent === frames.pegasus
              ? 'pegasus'
              : 'seestar'
            : null,
          lastFrameAgeSeconds,
          // The ~10-min ingest TTL: once the last frame ages past this it's
          // gone from Redis entirely (lastFrameAgeSeconds would then be null on
          // the next poll). Lets the operator distinguish "paused, frame still
          // cached" from "fully expired."
          frameTtlSeconds: 600,
          ...(mostRecent ? { ...buildDebugFields(mostRecent) } : {}),
        },
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
      let session: { status?: string | null; cancellationReason?: string | null; startedAt?: Date | null } | null = null
      if (tonightEvent) {
        // b. Session state (cancellation + startup detection). A missing
        //    weather-cancellation banner is cosmetic; the page staying up
        //    matters more — so this read degrades to cancelled:false on failure
        //    instead of bubbling to the outer catch and losing `next` along
        //    with it. Session may be null (no frame has arrived yet, no admin
        //    pre-creation) or exist with startedAt:null (admin pre-created
        //    without frames), or exist with startedAt set (first frame arrived).
        let cancelled = false
        let cancellationReason: string | undefined
        try {
          session = await prisma.session.findUnique({
            where: { date_hotelId: { date: today, hotelId: tonightEvent.hotelId } },
          })
          cancelled = session?.status === 'cancelled'
          cancellationReason = cancelled ? (session?.cancellationReason ?? undefined) : undefined
        } catch (e) {
          console.error('/api/status: session read failed, defaulting to not-cancelled', e)
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

      // Still tracked, but ONLY when tonight is genuinely scheduled, not
      // cancelled, AND the current time is within event.start-60min through
      // event.end+60min — this is the "waiting for tonight's session to
      // start" and "relay temporarily down mid-window" cases the P2 fix note
      // calls out (reconnecting/degraded from the guest's perspective still
      // lands here, since neither source is currently fresh). Without the
      // time window, `tonight` being scheduled for LATER today would count a
      // guest polling at 10am toward tonight's 21:30-22:30 event, which is
      // wrong — they aren't waiting on anything yet. A cancelled night, or a
      // night with nothing scheduled at all, is excluded regardless of time.
      const TRACKING_WINDOW_MARGIN_MINUTES = 60
      if (tonight && !tonight.cancelled && withinEventWindow(athensNowHHMM(), tonight.start, tonight.end, TRACKING_WINDOW_MARGIN_MINUTES)) {
        await trackViewer('hotel', null, hotelViewerEventKey(), viewerId)
      }

      // Session startup state: event is scheduled and active (within window,
      // not cancelled), but no frame has been ingested yet. This is distinct
      // from offline/reconnecting (frames existed, then stopped). Session may
      // be null (never created yet) or exist with startedAt:null (admin
      // pre-created, no frames yet). If session.startedAt is non-null, frames
      // have arrived — fall through to normal offline state.
      // Note: startup uses exact active window (margin 0), not the 60-minute
      // tracking margin — startup is only shown during the actual event
      // window, not the pre-show grace period.
      const eventActive = tonightEvent && withinEventWindow(athensNowHHMM(), tonightEvent.start, tonightEvent.end, 0)
      const notCancelled = !tonight?.cancelled
      if (tonightEvent && eventActive && notCancelled && (session === null || session.startedAt === null)) {
        return json({ live: false, starting: true, tonight, next })
      }

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
