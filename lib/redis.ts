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
