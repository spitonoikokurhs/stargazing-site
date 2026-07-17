import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import {
  redis,
  EVENT_FINISHED_KEY,
  EVENT_FINISHED_TTL_S,
  eventFinishedKey,
  isValidSource,
  viewerEventKey,
  viewerSpecialEventKey,
} from '@/lib/redis'
import { isExtraEventSlug, extraEventFor } from '@/lib/extra-events'
import { athensToday, eventFor } from '@/lib/schedule'
import { snapshotViewerStatsNightly } from '@/lib/viewer-stats-nightly'

// Node runtime required: crypto.timingSafeEqual, createHash.
export const runtime = 'nodejs'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// IDENTICAL auth mechanism to /api/ingest's authorized() (app/api/ingest/
// route.ts) — same scheme (Bearer token, sha256-hashed on both sides before
// timingSafeEqual so the comparison is constant-time and never throws on a
// length mismatch) AND the same secret (INGEST_SECRET). Deliberately not a
// new secret: the relay already holds INGEST_SECRET, so a "finish tonight"
// call needs no separate credential to provision or leak.
function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(presented, expected)
}

// Marks tonight's event as finished for presentation purposes ONLY. This
// must NEVER be inferred from a relay restart, a stale/quiet feed, or a
// slew — it exists purely so a deliberate "the event is over" signal (from
// a separate relay script, built later) can override an otherwise-live-
// looking feed. See app/api/status/route.ts for the ordering guarantee
// (finished-check runs BEFORE any frame-freshness logic) and app/api/
// ingest/route.ts for the auto-clear on the next successful fresh ingest.
//
// SCOPE: this route sets the finished Redis flag and, as ONE deliberate
// exception (added for the durable viewer-stats archive), takes a best-effort
// snapshot of the night's viewer counters into the ViewerStatsNightly
// Postgres table (see snapshotViewerStatsNightly + the model doc). That
// snapshot is the finish moment's whole reason to touch Postgres — it is
// non-fatal (a failure logs and is swallowed; the finished flag is set FIRST
// and returned regardless), so the finish signal itself can never be broken
// by a DB hiccup. This route STILL must never close Postgres sessions, delete
// frames/blobs, or touch relay-health state — the snapshot is a pure read of
// Redis + one additive upsert, nothing more.
//
// ?event=<slug> (config/extra-events.json) scopes this to a single special
// event instead of the shared hotel flag — see eventFinishedKey in
// lib/redis.ts. An unknown/absent slug falls back to the normal hotel
// EVENT_FINISHED_KEY, unchanged from before special events existed.
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.INGEST_SECRET
    if (!secret) {
      console.error('/api/finish: INGEST_SECRET not configured')
      return json({ error: 'internal' }, 500)
    }
    if (!authorized(req, secret)) {
      console.warn(`/api/finish: auth failure at ${new Date().toISOString()}`)
      return json({ error: 'unauthorized' }, 401)
    }

    const eventSlug = req.nextUrl.searchParams.get('event')
    if (eventSlug && isExtraEventSlug(eventSlug) && isValidSource(eventSlug)) {
      // Set the finished flag FIRST — the primary, must-not-fail action.
      await redis.set(eventFinishedKey(eventSlug), '1', { ex: EVENT_FINISHED_TTL_S })
      // Then best-effort snapshot this special event's viewer counters into
      // the durable table (see the SCOPE note above) before its Redis keys
      // eventually expire. Special-event key: scope="event", NOT date-scoped
      // (a multi-day event is one event — see viewerSpecialEventKey).
      const revealAt = extraEventFor(eventSlug)?.revealAt ?? 'unknown'
      await snapshotViewerStatsNightly({
        scope: 'event',
        slug: eventSlug,
        eventKey: viewerSpecialEventKey(eventSlug, revealAt),
        date: null,
        hotelId: null,
        eventSlug,
        source: 'finish',
      })
      return json({ finished: true, event: eventSlug })
    }

    // Set the finished flag FIRST — the primary, must-not-fail action.
    await redis.set(EVENT_FINISHED_KEY, '1', { ex: EVENT_FINISHED_TTL_S })
    // Then best-effort snapshot tonight's hotel viewer counters. Hotel key is
    // date-scoped (viewerEventKey) — each hotel night is its own event.
    const today = athensToday()
    const hotelId = eventFor(today)?.hotelId ?? null
    await snapshotViewerStatsNightly({
      scope: 'hotel',
      slug: null,
      eventKey: viewerEventKey(today, hotelId),
      date: today,
      hotelId,
      eventSlug: null,
      source: 'finish',
    })
    return json({ finished: true })
  } catch (e) {
    console.error('/api/finish: unexpected error', e)
    return json({ error: 'internal' }, 500)
  }
}
