import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/db'
import { athensToday } from '@/lib/schedule'

// Node runtime required: crypto.timingSafeEqual, createHash.
export const runtime = 'nodejs'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// IDENTICAL auth pattern to /api/viewer-stats: a dedicated VIEWER_STATS_TOKEN,
// falling back to INGEST_SECRET only when it isn't configured, with a loud
// production warning on the fallback. This endpoint is read-only diagnostics
// (catalog-match outcomes), checked from a phone/laptop after an event — the
// same context that motivated viewer-stats getting its own separately-
// revocable read credential rather than reusing the relay's write-capable
// INGEST_SECRET. The fallback stays even in production (a warn, not a hard
// failure) so a missing token can't lock the operator out of the data.
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

// Private operator/diagnostics endpoint — NEVER surfaced to guests. Returns
// the durable MatchDecision rows (see the model in prisma/schema.prisma)
// written at ingest for every StackRun identity decision, so season-wide
// catalog-radius tuning can be done from Postgres rather than from ephemeral
// Vercel logs.
//
// ?date=YYYY-MM-DD  — Athens calendar date of the event night; defaults to
//                     today (athensToday). Rows are joined to their Session
//                     to filter on Session.date, so this is "decisions made
//                     during that night's session(s)".
// ?result=fallback  — optional filter to one outcome (matched|fallback|
//                     upgraded); omit for all three.
//
// Response includes a per-result summary count (the "how many times did we
// fall back tonight" answer) plus the full row list with coordinates.
export async function GET(req: NextRequest) {
  try {
    const secret = statsSecret()
    if (!secret) {
      console.error('/api/debug/match-decisions: no secret configured (VIEWER_STATS_TOKEN or INGEST_SECRET)')
      return json({ error: 'internal' }, 500)
    }
    if (process.env.NODE_ENV === 'production' && !process.env.VIEWER_STATS_TOKEN) {
      console.warn(
        '/api/debug/match-decisions: VIEWER_STATS_TOKEN not set in production, falling back to INGEST_SECRET — set a separate token for production',
      )
    }
    if (!authorized(req, secret)) {
      console.warn(`/api/debug/match-decisions: auth failure at ${new Date().toISOString()}`)
      return json({ error: 'unauthorized' }, 401)
    }

    const date = req.nextUrl.searchParams.get('date') ?? athensToday()
    const resultFilter = req.nextUrl.searchParams.get('result')

    // Sessions for this Athens date (one per hotel; usually exactly one). A
    // MatchDecision.sessionId points at one of these — filter decisions to
    // that night by resolving the date's session ids first, rather than
    // denormalizing date onto MatchDecision.
    const sessions = await prisma.session.findMany({
      where: { date },
      select: { id: true, hotelId: true },
    })
    const sessionIds = sessions.map((s) => s.id)

    if (sessionIds.length === 0) {
      return json({
        date,
        sessions: [],
        summary: { matched: 0, fallback: 0, upgraded: 0, total: 0 },
        decisions: [],
        generatedAt: new Date().toISOString(),
      })
    }

    const decisions = await prisma.matchDecision.findMany({
      where: {
        sessionId: { in: sessionIds },
        ...(resultFilter ? { result: resultFilter } : {}),
      },
      orderBy: { createdAt: 'asc' },
    })

    // Per-outcome summary — the headline "how many fallbacks tonight" number,
    // computed over the returned rows (already date/result-scoped).
    const summary = { matched: 0, fallback: 0, upgraded: 0, total: decisions.length }
    for (const d of decisions) {
      if (d.result === 'matched') summary.matched++
      else if (d.result === 'fallback') summary.fallback++
      else if (d.result === 'upgraded') summary.upgraded++
    }

    return json({
      date,
      sessions: sessions.map((s) => ({ id: s.id, hotelId: s.hotelId })),
      summary,
      decisions: decisions.map((d) => ({
        stackRunId: d.stackRunId,
        source: d.source,
        result: d.result,
        ra: d.ra,
        dec: d.dec,
        objectId: d.objectId,
        confidence: d.confidence,
        at: d.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('/api/debug/match-decisions: unexpected error', e)
    return json({ error: 'internal' }, 500)
  }
}
