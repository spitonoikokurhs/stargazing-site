import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'

// Node runtime required: crypto.timingSafeEqual, createHash.
export const runtime = 'nodejs'

const MIN_SECRET_LENGTH = 32

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Same constant-time bearer check as the other cron/authed routes.
function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(presented, expected)
}

// Periodic Tier-1 interaction flush (rider B: "~5min periodic flush, so a crash
// loses minutes not the night"). Triggered by Vercel Cron (see vercel.json).
// Flushes the CURRENT hotel event window's Redis interaction counters into the
// durable EventInteractionStats table; the flush is an idempotent absolute-value
// upsert (see flushInteractionStats), so running it every few minutes just keeps
// the durable rows current — the finish-night flush is the same operation at the
// end.
//
// Scope: tonight's HOTEL event only. There is one hotel event per night
// (config/schedule.json), so this cron always targets the right window without
// parameters. Special events (config/extra-events.json) are flushed at their own
// /api/finish?event=<slug> and don't need periodic coverage (they're short,
// operator-driven reveals); if that ever changes, add their scopes here.
//
// Runs cheaply outside event hours too: if no interactions have been recorded
// (empty Redis hash), flushInteractionStats returns {flushed:0} without touching
// Postgres — so a 5-min all-day cadence costs one Redis HGETALL per run when idle.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET not configured')
    return json({ error: 'internal' }, 500)
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.warn(`CRON_SECRET is shorter than ${MIN_SECRET_LENGTH} chars; consider rotating to a longer value`)
  }
  if (!authorized(req, secret)) {
    return json({ error: 'unauthorized' }, 401)
  }

  // Prisma/Redis-importing modules loaded dynamically AFTER auth, so an
  // unauthenticated request never loads them (same discipline as close-sessions).
  try {
    const { resolveInteractionScope } = await import('@/lib/interaction-stats')
    const { flushInteractionStats } = await import('@/lib/interaction-stats-flush')
    const result = await flushInteractionStats(resolveInteractionScope(null), 'periodic')
    return json({ flushed: result?.flushed ?? 0 })
  } catch (e) {
    console.error('/api/cron/flush-interactions failed', e)
    return json({ error: 'internal' }, 500)
  }
}
