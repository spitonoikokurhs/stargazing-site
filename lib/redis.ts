import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL as string,
  token: process.env.UPSTASH_KV_REST_API_TOKEN as string,
})

// The devices that can act as a live-view source. Plain strings in the DB;
// this array + guard are the application-level validation.
export const SOURCES = ['pegasus', 'seestar'] as const
export type Source = (typeof SOURCES)[number]

export function isValidSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value)
}

// Single source of truth for Redis key naming.
//
// live:latest:<source> holds an explicitly JSON.stringify-ed payload
// (we own both ends of the format; /api/status JSON.parses it):
//   { frameId, blobUrl, capturedAt, ingestedAt, observationId, sessionId, objectName }
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

  return {
    frameId: o.frameId,
    blobUrl: o.blobUrl,
    capturedAt: o.capturedAt,
    ingestedAt: o.ingestedAt,
    observationId: o.observationId,
    sessionId: o.sessionId,
    objectName: o.objectName,
  }
}
