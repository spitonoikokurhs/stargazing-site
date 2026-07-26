// Redis buffer layer for Tier-1 interaction counters.
//
// Mirrors the discipline of lib/redis.ts's recordViewerActivity/readViewerStats:
// live increments buffer in Redis (one hash per event window), a TTL GCs the
// keys, and everything is FAIL-OPEN — any Redis error returns without throwing,
// so a tracking hiccup can never fail a guest request or block a render.
//
// The Postgres flush (buffer -> durable EventInteractionStats rows) lives in
// lib/interaction-stats-flush.ts and reads these hashes; this file only owns
// the Redis side (increment + read + reset), exactly as lib/redis.ts owns the
// viewer counters and lib/viewer-stats-nightly.ts owns their flush.

import { redis, viewerEventKey, viewerSpecialEventKey } from '@/lib/redis'
import { athensToday, eventFor } from '@/lib/schedule'
import { extraEventFor, isExtraEventSlug } from '@/lib/extra-events'
import {
  counterField,
  type InteractionEvent,
} from '@/lib/interaction-events'

// Resolve the CURRENT event window's key SERVER-SIDE, from the schedule/config —
// never from anything the client sends. This is the same scoping /api/finish and
// /api/viewer-stats use, centralised here so every interaction endpoint (write +
// read + flush) agrees on one identity: a hotel night is date-scoped
// (viewerEventKey), a special event uses its own revealAt-stable key
// (viewerSpecialEventKey, not date-scoped). `eventSlug` comes from an optional
// ?event= param; an unknown/absent slug falls back to tonight's hotel scope.
export type InteractionScope = {
  scope: 'hotel' | 'event'
  slug: string | null
  eventKey: string
  date: string | null
  hotelId: string | null
  eventSlug: string | null
}

export function resolveInteractionScope(eventSlug: string | null): InteractionScope {
  if (eventSlug && isExtraEventSlug(eventSlug)) {
    const revealAt = extraEventFor(eventSlug)?.revealAt ?? 'unknown'
    return {
      scope: 'event',
      slug: eventSlug,
      eventKey: viewerSpecialEventKey(eventSlug, revealAt),
      date: null,
      hotelId: null,
      eventSlug,
    }
  }
  const today = athensToday()
  const hotelId = eventFor(today)?.hotelId ?? null
  return {
    scope: 'hotel',
    slug: null,
    eventKey: viewerEventKey(today, hotelId),
    date: today,
    hotelId,
    eventSlug: null,
  }
}

// One hash per event window, keyed by the SAME eventKey the viewer-stats system
// uses (viewerEventKey / viewerSpecialEventKey) so an event's interaction row
// and its viewer row line up on one identity. Field = counterField(key,
// objectId); value = the running tally.
export function interactionStatsKey(eventKey: string): string {
  return `live:interactions:${eventKey}`
}

// 48h TTL, matching the viewer-stats window: comfortably outlives the longest
// event night plus its farewell/wind-down hour, while guaranteeing a buffer
// can't silently persist across a whole season if a flush is ever missed.
const INTERACTION_TTL_S = 60 * 60 * 48

// Server-side buffer cap (rider B): a hard ceiling on how many DISTINCT counter
// fields one event-window hash may hold. The taxonomy has ~14 plain keys plus
// per-object variants of the two object-scoped keys; with ~89 catalog objects
// the natural ceiling is well under 200. We cap at 512 so legitimate use is
// never touched, but a bug or abuse spraying novel object-scoped fields can't
// grow one hash without bound. Once at the cap, further NEW fields are dropped
// (existing fields still increment). HLEN is O(1) in Redis, so this check is cheap.
const MAX_INTERACTION_FIELDS = 512

// Increment one interaction counter for an event window. Fail-open: returns
// { ok: false } on any Redis error or when the buffer cap blocks a new field;
// callers never treat that as a request failure.
//
// Cap enforcement is best-effort and deliberately simple: if the hash is at the
// cap AND this field doesn't already exist, skip. There's a benign race (two
// new fields could both pass the check near the boundary) — that's fine; the
// cap is a runaway backstop, not an exact quota, and a handful over 512 costs
// nothing. HINCRBY itself is atomic.
export async function recordInteraction(
  eventKey: string,
  event: InteractionEvent,
): Promise<{ ok: boolean }> {
  try {
    const hkey = interactionStatsKey(eventKey)
    const field = counterField(event.key, event.objectId)

    // Only pay for the cap check when we might be adding a NEW field. hexists is
    // one cheap round trip; if the field already exists we skip straight to the
    // increment (the common steady-state path).
    const exists = await redis.hexists(hkey, field)
    if (!exists) {
      const fieldCount = await redis.hlen(hkey)
      if (fieldCount >= MAX_INTERACTION_FIELDS) {
        // At the cap and this is a novel field — drop it (see cap rationale).
        return { ok: false }
      }
    }

    await redis.hincrby(hkey, field, 1)
    // Refresh the GC TTL on every write so an actively-used window never expires
    // mid-event; a quiet window ages out 48h after its last interaction.
    await redis.expire(hkey, INTERACTION_TTL_S)
    return { ok: true }
  } catch (e) {
    console.error('recordInteraction failed', e)
    return { ok: false }
  }
}

// Read the full counter hash for an event window (flush + read endpoint use
// this). Fail-open: returns {} on any error. Values come back as strings from
// Redis; we coerce to integers and drop anything non-numeric.
export async function readInteractionStats(eventKey: string): Promise<Record<string, number>> {
  try {
    const raw = await redis.hgetall<Record<string, string | number>>(interactionStatsKey(eventKey))
    if (!raw) return {}
    const out: Record<string, number> = {}
    for (const [field, value] of Object.entries(raw)) {
      const n = typeof value === 'number' ? value : parseInt(String(value), 10)
      if (Number.isFinite(n)) out[field] = n
    }
    return out
  } catch (e) {
    console.error('readInteractionStats failed', e)
    return {}
  }
}
