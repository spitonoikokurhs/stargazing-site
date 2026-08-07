import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { resolveInteractionScope } from '@/lib/interaction-stats'
import {
  readDurableInteractionStats,
  readDurableInteractionStatsByDate,
  readDurableInteractionStatsInRange,
} from '@/lib/interaction-stats-flush'
import { athensToday } from '@/lib/schedule'

// Athens "YYYY-MM-DD" shape guard for the ?from=/?to= range params. Cheap
// validation before the DB touch — a malformed range reads as "no range".
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Node runtime required: crypto.timingSafeEqual, createHash.
export const runtime = 'nodejs'
// Always dynamic: the route reads request headers (auth) on every call, and
// declaring it silences Next's build-time static-render probe (which otherwise
// logs a spurious "Dynamic server usage" error through our catch block — the
// pre-existing /api/viewer-stats lives with that noise; this route needn't).
export const dynamic = 'force-dynamic'

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

    // ?from=YYYY-MM-DD&to=YYYY-MM-DD — range read for the /stats operator page.
    // Returns every hotel-scoped counter row across the window (one flat list;
    // the client groups by night and hotel, and filters the midnight-straggler
    // bucket per the readDurableInteractionStatsByDate caveat). Hotel scope only,
    // so ?event= is ignored here. Bounded so a typo can't scan the whole table.
    const fromParam = req.nextUrl.searchParams.get('from')
    const toParam = req.nextUrl.searchParams.get('to')
    if (fromParam || toParam) {
      if (!fromParam || !toParam || !DATE_RE.test(fromParam) || !DATE_RE.test(toParam)) {
        return json({ error: 'from and to must both be YYYY-MM-DD' }, 400)
      }
      // Normalise a reversed range rather than returning empty silently.
      const from = fromParam <= toParam ? fromParam : toParam
      const to = fromParam <= toParam ? toParam : fromParam
      const range = await readDurableInteractionStatsInRange(from, to)
      return json({
        scope: 'hotel',
        range: { from, to },
        archived: true,
        counters: range.rows,
        generatedAt: new Date().toISOString(),
      })
    }

    const eventSlug = req.nextUrl.searchParams.get('event')
    const scope = resolveInteractionScope(eventSlug)

    // ?date=YYYY-MM-DD reads a PAST hotel night's archived interaction rows —
    // mirrors /api/viewer-stats' archive branch exactly: hotel scope only (a
    // special event's eventKey is date-independent, so ?event= already reads
    // its own stable rows and ?date= is ignored there), and `date` omitted or
    // set to today keeps the normal current-scope read below. Rows carry
    // eventKey/hotelId because one date can hold both the real night AND the
    // midnight-straggler fallback bucket — see the consumer caveat on
    // readDurableInteractionStatsByDate (a season view must not present the
    // hotelId-null bucket as a night of its own).
    const requestedDate = req.nextUrl.searchParams.get('date')
    const today = athensToday()
    if (scope.scope === 'hotel' && requestedDate && requestedDate !== today) {
      const archived = await readDurableInteractionStatsByDate(requestedDate)
      return json({
        scope: 'hotel',
        date: requestedDate,
        archived: true,
        found: archived.rows.length > 0,
        eventKeys: archived.eventKeys,
        byKey: archived.byKey,
        counters: archived.rows,
        generatedAt: new Date().toISOString(),
      })
    }

    const stats = await readDurableInteractionStats(scope.eventKey)

    return json({
      scope: scope.scope,
      eventKey: scope.eventKey,
      date: scope.date,
      hotelId: scope.hotelId,
      eventSlug: scope.eventSlug,
      archived: false,
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
