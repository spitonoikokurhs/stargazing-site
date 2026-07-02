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
