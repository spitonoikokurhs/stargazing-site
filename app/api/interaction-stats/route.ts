import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { resolveInteractionScope } from '@/lib/interaction-stats'
import { readDurableInteractionStats } from '@/lib/interaction-stats-flush'

// Node runtime required: crypto.timingSafeEqual, createHash.
export const runtime = 'nodejs'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Same DEDICATED-secret pattern as /api/viewer-stats: prefer VIEWER_STATS_TOKEN
// (read-only analytics credential), fall back to INGEST_SECRET with a loud warn
// in production. This endpoint is the interaction sibling of /api/viewer-stats —
// private operator/analytics only, never surfaced to guests — so it deliberately
// reuses the exact same auth so one read token covers both.
function statsSecret(): string | undefined {
  return process.env.VIEWER_STATS_TOKEN || process.env.INGEST_SECRET
}

function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(presented, expected)
}

// Private read side for the Tier-1 interaction counters (spec Part 3). Returns
// the durable per-counter rows and a per-key rollup for one event window. No UI
// consumes it yet — the banked calendar/season view will. ?event=<slug> scopes
// to a special event; otherwise tonight's hotel scope (same resolution as
// /api/viewer-stats and /api/track, so all three agree on the eventKey).
export async function GET(req: NextRequest) {
  try {
    const secret = statsSecret()
    if (!secret) {
      console.error('/api/interaction-stats: no secret configured (VIEWER_STATS_TOKEN or INGEST_SECRET)')
      return json({ error: 'internal' }, 500)
    }
    if (process.env.NODE_ENV === 'production' && !process.env.VIEWER_STATS_TOKEN) {
      console.warn(
        '/api/interaction-stats: VIEWER_STATS_TOKEN not set in production, falling back to INGEST_SECRET — set a separate token for production',
      )
    }
    if (!authorized(req, secret)) {
      console.warn(`/api/interaction-stats: auth failure at ${new Date().toISOString()}`)
      return json({ error: 'unauthorized' }, 401)
    }

    const eventSlug = req.nextUrl.searchParams.get('event')
    const scope = resolveInteractionScope(eventSlug)
    const stats = await readDurableInteractionStats(scope.eventKey)

    return json({
      scope: scope.scope,
      eventKey: scope.eventKey,
      date: scope.date,
      hotelId: scope.hotelId,
      eventSlug: scope.eventSlug,
      // Per-key rollup (counters summed across objectIds) for a quick read, plus
      // the full per-counter rows (including the per-objectId breakdown).
      byKey: stats.byKey,
      counters: stats.rows,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('/api/interaction-stats: unexpected error', e)
    return json({ error: 'internal' }, 500)
  }
}
