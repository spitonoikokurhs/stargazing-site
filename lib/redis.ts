import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { isExtraEventSlug } from '@/lib/extra-events'

export const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL as string,
  token: process.env.UPSTASH_KV_REST_API_TOKEN as string,
})

// Ingest-only limiter: 30 requests/minute per key (see app/api/ingest/route.ts
// for the key choice and fail-open handling). Headroom rationale: the real
// relay posts roughly one frame per 20-40s per source, so even two sources
// sharing one IP (same travel router) sit around ~6/min in steady state —
// 30/min leaves ~5x room for retries/bursts before throttling kicks in.
// A separate Ratelimit instance (not shared with any other route) so its
// prefix/quota can never collide with unrelated future rate limiting.
export const ingestRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  prefix: 'ratelimit:ingest',
})

// Tier-1 interaction-beacon limiter (see app/api/track/route.ts). A guest
// legitimately fires a handful of interaction beacons across a session (a few
// pill taps, a drawer open, some UFO taps during the farewell), so 120/min per
// IP is generous headroom for real use while bounding how fast one client can
// spray counters. Keyed by IP purely for throttling — the IP is passed to
// Upstash's limiter (which hashes it into an internal counter key) and is
// NEVER stored as data, logged, or written to a counter; see the route's
// identifier-free note. A separate instance/prefix so its quota can never
// collide with ingestRatelimit.
export const trackRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, '1 m'),
  prefix: 'ratelimit:track',
})

// The two physical telescope devices. Plain strings in the DB; this array +
// guard are the application-level validation for the normal hotel dual-source
// live page (see that route's source-switch logic).
export const HOTEL_SOURCES = ['pegasus', 'seestar'] as const
export type HotelSource = (typeof HOTEL_SOURCES)[number]

// A valid ingest `source` is either a hotel device (HOTEL_SOURCES) or a
// configured special-event slug (config/extra-events.json — see
// lib/extra-events.ts). Reusing the source field as the special-event key
// keeps ingest's hotelId resolution a single lookup (see scheduledHotelFor vs.
// extraEventFor in app/api/ingest/route.ts) without a second identity field,
// and — critically — means a NEW special event needs zero code changes: its
// slug becomes a valid source purely by existing in the config file. Kept as
// `string` rather than a closed union for the same reason: the whole point is
// that this set isn't fixed at build time.
export type Source = HotelSource | string

export function isValidSource(value: string): value is Source {
  return (HOTEL_SOURCES as readonly string[]).includes(value) || isExtraEventSlug(value)
}

// Single source of truth for Redis key naming.
//
// live:latest:<source> holds an explicitly JSON.stringify-ed payload
// (we own both ends of the format; /api/status JSON.parses it):
//   { frameId, blobUrl, capturedAt, ingestedAt, observationId, sessionId, objectName, telemetry? }
// telemetry is an optional subset of the ingest route's device-metadata field
// (state, astrometryState, totalAccumulatedTime, raDegrees, decDegrees) —
// absent on Tier-1-only frames or when the device didn't report metadata.
// capturedAt = device-side timestamp (best effort), ingestedAt = server receipt
// time — comparing the two diagnoses stale device clocks.
// Written with EX 600 (10-min TTL) purely as garbage collection; the 5-min
// liveness window is computed from capturedAt in the payload, not the TTL.
export function latestFrameKey(source: Source): string {
  return `live:latest:${source}`
}

// The single shared key holding which source /api/status last chose as the live
// feed. Read + rewritten (with a TTL) on every live poll for source hysteresis.
export const ACTIVE_SOURCE_KEY = 'live:active-source'

// Explicit "tonight is over" flag — set ONLY by a deliberate POST to
// /api/finish (see app/api/finish/route.ts), never inferred from stale/absent
// frames. /api/status checks this BEFORE any frame-freshness logic, so it
// overrides an otherwise-live-looking feed (see app/api/status/route.ts).
// The 60min TTL is a safety backstop, NOT the primary reset mechanism — the
// primary reset is /api/ingest deleting this key on the next successful
// fresh-frame ingest, so a new session just works with no manual un-finish
// step. Deliberately short (not e.g. 24h): the farewell is a send-off for
// the hour after finishing (guests leaving, lobby TV wind-down, late QR
// scans), not a screen that should still be showing before a DIFFERENT
// event the next day on a hotel that shares this /live — a stale farewell
// lingering into tomorrow's session would look broken, not intentional.
//
// Deliberately ONE global key, not per-source: only one hotel event runs per
// night (config/schedule.json), so there's never ambiguity about which
// hotel's night this finishes. Special events (config/extra-events.json) are
// NOT covered by this key — see eventFinishedKey below — so finishing a
// hotel's night can never accidentally finish a special event, or vice versa.
export const EVENT_FINISHED_KEY = 'live:event:finished'
export const EVENT_FINISHED_TTL_S = 60 * 60

// Per-source finished flag for a special event (config/extra-events.json).
// Same semantics/TTL as EVENT_FINISHED_KEY (explicit POST /api/finish?event=
// <slug> only, auto-cleared on the next fresh ingest for that source — see
// app/api/ingest/route.ts) but keyed by source so finishing one special event
// can never affect another special event, the hotel EVENT_FINISHED_KEY, or
// vice versa.
export function eventFinishedKey(source: Source): string {
  return `live:event:finished:${source}`
}

// --- Private viewer analytics (see /api/status's viewer tracking and
// /api/viewer-stats) --------------------------------------------------------
//
// This is NOT guest-facing — no count is ever rendered on /live. It exists
// purely so the operator can privately check how many people are watching, at
// GET /api/viewer-stats (bearer-token protected, same INGEST_SECRET as
// /api/finish and /api/ingest). Three independent Redis structures, all keyed
// by a per-viewer-tab random id (see VIEWER_ID_STORAGE_KEY in LiveView.tsx —
// never an IP, cookie, or anything tied to a real identity):
//
//   1. "active" sorted set — member=viewerId, score=Date.now(). Currently-
//      watching count is ZCOUNT of members scored within the last 60s
//      (VIEWER_ACTIVE_WINDOW_MS); ZREMRANGEBYSCORE trims anything older than
//      120s on every write so the set can't grow unboundedly over a long
//      session. This key is intentionally NOT scoped by eventKey — it only
//      ever needs to answer "who's active right now," and clearing it (or
//      letting old members age out) between events is irrelevant to that
//      question, unlike unique/max below which must reset per event.
//   2. "unique" SET — member=viewerId, TTL VIEWER_STATS_TTL_S. SCARD gives
//      the total distinct viewers seen this event. Scoped by eventKey (see
//      viewerEventKey) so it resets on the next scheduled night rather than
//      accumulating across the whole season.
//   3. "max" — a single-member sorted set (member is a constant placeholder,
//      the SCORE is the actual max value) updated via `ZADD ... GT`, Redis's
//      own atomic "only write if the new score is greater" primitive. This
//      is NOT a plain GET/compare/SET: an unguarded read-modify-write can
//      regress under concurrency (poller A reads max=5 while current=10,
//      poller B reads max=5 while current=6, A writes 10, B writes 6 — max
//      goes DOWN if B's write lands last). ZADD GT pushes the compare into
//      Redis itself, so two concurrent writers can never produce a lower
//      final value than either of their inputs, no external locking needed.
//      Same eventKey scoping and TTL as unique.
//
// Separate key prefixes for the hotel path vs. each special-event slug (see
// viewerKeys) so a special event's numbers can never mix with the shared
// hotel night's, or with another special event's — mirrors eventFinishedKey's
// own per-slug isolation above.
export const VIEWER_ACTIVE_WINDOW_MS = 60 * 1000
const VIEWER_ACTIVE_CLEANUP_MS = 120 * 1000
// 2 days: comfortably outlives the longest realistic single event night
// (including the farewell/wind-down hour after `finished`), while still
// guaranteeing the unique/max counters don't silently persist across an
// entire season the way a TTL-less key would.
const VIEWER_STATS_TTL_S = 60 * 60 * 48

export type ViewerScope = 'hotel' | 'event'

function viewerKeys(scope: ViewerScope, slug: Source | null, eventKey: string) {
  const prefix = scope === 'hotel' ? 'live:viewers:hotel' : `live:viewers:event:${slug}`
  return {
    active: `${prefix}:active`,
    unique: `${prefix}:unique:${eventKey}`,
    max: `${prefix}:max:${eventKey}`,
  }
}

// Stable per-event key for the HOTEL path so unique/max naturally reset on
// the next scheduled night rather than accumulating forever: YYYY-MM-DD:
// <hotelId> when tonight's scheduled hotel is known, or YYYY-MM-DD:hotel as
// a fallback (e.g. an unscheduled/ad-hoc live session). Each hotel night IS
// genuinely a separate event, so date-scoping is correct here — do NOT use
// this for special events (see viewerSpecialEventKey below).
export function viewerEventKey(todayAthens: string, hotelId: string | null): string {
  return `${todayAthens}:${hotelId ?? 'hotel'}`
}

// Stable per-event key for a SPECIAL event (config/extra-events.json) —
// deliberately NOT scoped by today's date, unlike viewerEventKey above. A
// special event can span multiple calendar days (e.g. Parnonas running
// 2026-07-10 through 2026-07-12 as ONE event) and "unique viewers during the
// event" must count across the whole window, not reset at midnight each
// night. Derived from the event's own config (revealAt/endsAt), which is
// already the stable identity /api/finish and eventFinishedKey use to scope
// a special event — reusing that same revealAt timestamp (rather than the
// slug alone) means a slug that gets reused for a genuinely different future
// occurrence (new revealAt/endsAt entry, same slug) still gets its own fresh
// counters instead of silently inheriting a past occurrence's numbers.
export function viewerSpecialEventKey(slug: string, revealAt: string): string {
  return `${slug}:${revealAt}`
}

// Constant member name for the "max" single-member sorted set — only the
// SCORE ever matters (see the doc comment above); the member string itself
// is an arbitrary fixed placeholder so ZADD GT always targets the same slot.
const MAX_SENTINEL_MEMBER = 'max'

// Records one viewer's presence (active sorted set + unique set) and
// atomically ratchets the running max via ZADD GT, all in one pipelined
// round trip — no separate read-modify-write, so the race that could
// regress max under concurrency (see the doc comment above VIEWER_ACTIVE_
// WINDOW_MS) cannot happen. Returns the three current metrics, or null if
// the pipeline itself failed — callers must treat a null return as "skip
// viewer tracking for this poll," never as a reason to fail the request
// (see the fail-open handling in app/api/status/route.ts and
// /api/viewer-stats).
export async function recordViewerActivity(
  scope: ViewerScope,
  slug: Source | null,
  eventKey: string,
  viewerId: string,
): Promise<{ current: number; unique: number; maxConcurrent: number } | null> {
  try {
    const keys = viewerKeys(scope, slug, eventKey)
    const now = Date.now()

    const pipeline = redis.pipeline()
    pipeline.zadd(keys.active, { score: now, member: viewerId })
    pipeline.zremrangebyscore(keys.active, 0, now - VIEWER_ACTIVE_CLEANUP_MS)
    pipeline.zcount(keys.active, now - VIEWER_ACTIVE_WINDOW_MS, now)
    pipeline.sadd(keys.unique, viewerId)
    pipeline.expire(keys.unique, VIEWER_STATS_TTL_S)
    pipeline.scard(keys.unique)
    const results = await pipeline.exec<[unknown, unknown, number, unknown, unknown, number]>()

    const current = results[2]
    const unique = results[5]
    if (typeof current !== 'number' || typeof unique !== 'number') return null

    // ZADD GT: writes score=current for MAX_SENTINEL_MEMBER only if greater
    // than whatever score is already stored there — Redis performs the
    // compare server-side, so this can never regress under concurrent
    // callers, unlike a client-side GET-then-SET. Runs as its own command
    // (not foldable into the pipeline above) because it depends on `current`,
    // which the pipeline itself just computed.
    await redis.zadd(keys.max, { gt: true }, { score: current, member: MAX_SENTINEL_MEMBER })
    await redis.expire(keys.max, VIEWER_STATS_TTL_S)
    const maxScore = await redis.zscore(keys.max, MAX_SENTINEL_MEMBER)
    const maxConcurrent = typeof maxScore === 'number' ? maxScore : Number(maxScore) || current

    return { current, unique, maxConcurrent }
  } catch (e) {
    console.error('recordViewerActivity failed', e)
    return null
  }
}

// Read-only variant for /api/viewer-stats — same three metrics, no writes at
// all (a manual stats check should never itself count as a "viewer poll").
export async function readViewerStats(
  scope: ViewerScope,
  slug: Source | null,
  eventKey: string,
): Promise<{ current: number; unique: number; maxConcurrent: number }> {
  const keys = viewerKeys(scope, slug, eventKey)
  const now = Date.now()
  try {
    const [current, unique, maxScore] = await Promise.all([
      redis.zcount(keys.active, now - VIEWER_ACTIVE_WINDOW_MS, now),
      redis.scard(keys.unique),
      redis.zscore(keys.max, MAX_SENTINEL_MEMBER),
    ])
    return {
      current: typeof current === 'number' ? current : 0,
      unique: typeof unique === 'number' ? unique : 0,
      maxConcurrent: typeof maxScore === 'number' ? maxScore : Number(maxScore) || 0,
    }
  } catch (e) {
    console.error('readViewerStats failed', e)
    return { current: 0, unique: 0, maxConcurrent: 0 }
  }
}

// Telemetry subset carried in the Redis payload (see latestFrameKey doc
// above). Every field is independently optional/nullable — a device can omit
// any of them, and astrometryState governs whether ra/decDegrees are
// meaningful at all (only 'solved' implies real coordinates).
export type LatestFrameTelemetry = {
  state?: string
  astrometryState?: 'unavailable' | 'solved' | 'failed' | 'present_unknown'
  totalAccumulatedTime?: number
  raDegrees?: number | null
  decDegrees?: number | null
  // --- Operator-debug passthrough (relay stale-solve / coord-source detector).
  // Surfaced ONLY on /live-debug (see buildDebugFields in
  // app/api/status/route.ts); the guest live card ignores them. Forwarded from
  // ingest (see that route's allowlist) and validated field-by-field in
  // parseLatestFrame. All optional — a frame without them (Tier-1, older relay)
  // simply omits them, and the overlay renders "not sent."
  astrometrySuspect?: boolean | null
  solveTiming?: string
  solveTimingReason?: string
  newObservation?: boolean
  coordSourceDeltaDeg?: number
  coordSourcesDisagree?: boolean
  // Mount coords — field names CONFIRMED against relay @ 8e8eb9a (see
  // docs/live-debug-relay-fields.md).
  mountRaDegrees?: number | null
  mountDecDegrees?: number | null
  mountTelemetryOk?: boolean
  mountSlewing?: boolean | null
  mountTelemetryAgeSeconds?: number | null
}

// The shape of the live:latest:<source> payload — the exact object /api/ingest
// JSON.stringify-es (see ingest route step 7). Kept in sync with that writer.
export type LatestFrame = {
  frameId: string
  blobUrl: string
  capturedAt: string
  ingestedAt: string
  observationId: string
  sessionId: string
  objectName: string
  telemetry?: LatestFrameTelemetry
}

// Turn a raw Redis value into a LatestFrame, or null if it's absent/malformed.
// Defensive by design: @upstash/redis may hand back either the raw JSON string
// or an already-deserialized object (it attempts JSON.parse on reads), so we
// accept both. We require every field to be a string, and the three the live
// page cannot render without — frameId, blobUrl, ingestedAt — to be non-empty.
// Never throws: a bad payload must degrade to "offline", not 500 /api/status.
export function parseLatestFrame(raw: unknown): LatestFrame | null {
  if (raw == null) return null

  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof obj !== 'object' || obj === null) return null

  const o = obj as Record<string, unknown>
  const isStr = (v: unknown): v is string => typeof v === 'string'
  const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0

  if (!isNonEmpty(o.frameId) || !isNonEmpty(o.blobUrl) || !isNonEmpty(o.ingestedAt)) return null
  if (!isStr(o.capturedAt) || !isStr(o.observationId) || !isStr(o.sessionId) || !isStr(o.objectName)) {
    return null
  }

  // telemetry: best-effort, field-by-field — a malformed or partially-wrong
  // telemetry object degrades to fewer fields (or none), never fails the
  // whole frame parse. Only astrometryState values we recognize are kept.
  let telemetry: LatestFrameTelemetry | undefined
  if (typeof o.telemetry === 'object' && o.telemetry !== null) {
    const t = o.telemetry as Record<string, unknown>
    const validAstrometryStates = ['unavailable', 'solved', 'failed', 'present_unknown']
    const parsed: LatestFrameTelemetry = {}
    if (isStr(t.state)) parsed.state = t.state
    if (isStr(t.astrometryState) && validAstrometryStates.includes(t.astrometryState)) {
      parsed.astrometryState = t.astrometryState as LatestFrameTelemetry['astrometryState']
    }
    if (typeof t.totalAccumulatedTime === 'number' && Number.isFinite(t.totalAccumulatedTime)) {
      parsed.totalAccumulatedTime = t.totalAccumulatedTime
    }
    if (typeof t.raDegrees === 'number' && Number.isFinite(t.raDegrees)) parsed.raDegrees = t.raDegrees
    if (typeof t.decDegrees === 'number' && Number.isFinite(t.decDegrees)) parsed.decDegrees = t.decDegrees
    // Operator-debug passthrough — validated per-field, same best-effort
    // discipline: a wrong type on any one field just drops that field, never
    // the whole telemetry object. Surfaced only on /live-debug.
    if (typeof t.astrometrySuspect === 'boolean' || t.astrometrySuspect === null)
      parsed.astrometrySuspect = t.astrometrySuspect
    if (isStr(t.solveTiming)) parsed.solveTiming = t.solveTiming
    if (isStr(t.solveTimingReason)) parsed.solveTimingReason = t.solveTimingReason
    if (typeof t.newObservation === 'boolean') parsed.newObservation = t.newObservation
    if (typeof t.coordSourceDeltaDeg === 'number' && Number.isFinite(t.coordSourceDeltaDeg))
      parsed.coordSourceDeltaDeg = t.coordSourceDeltaDeg
    if (typeof t.coordSourcesDisagree === 'boolean') parsed.coordSourcesDisagree = t.coordSourcesDisagree
    if ((typeof t.mountRaDegrees === 'number' && Number.isFinite(t.mountRaDegrees)) || t.mountRaDegrees === null)
      parsed.mountRaDegrees = t.mountRaDegrees
    if ((typeof t.mountDecDegrees === 'number' && Number.isFinite(t.mountDecDegrees)) || t.mountDecDegrees === null)
      parsed.mountDecDegrees = t.mountDecDegrees
    if (typeof t.mountTelemetryOk === 'boolean') parsed.mountTelemetryOk = t.mountTelemetryOk
    if (typeof t.mountSlewing === 'boolean' || t.mountSlewing === null) parsed.mountSlewing = t.mountSlewing
    if (
      (typeof t.mountTelemetryAgeSeconds === 'number' && Number.isFinite(t.mountTelemetryAgeSeconds)) ||
      t.mountTelemetryAgeSeconds === null
    )
      parsed.mountTelemetryAgeSeconds = t.mountTelemetryAgeSeconds
    if (Object.keys(parsed).length > 0) telemetry = parsed
  }

  return {
    frameId: o.frameId,
    blobUrl: o.blobUrl,
    capturedAt: o.capturedAt,
    ingestedAt: o.ingestedAt,
    observationId: o.observationId,
    sessionId: o.sessionId,
    objectName: o.objectName,
    ...(telemetry ? { telemetry } : {}),
  }
}
