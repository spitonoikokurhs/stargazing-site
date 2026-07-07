import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { redis, EVENT_FINISHED_KEY, EVENT_FINISHED_TTL_S } from '@/lib/redis'

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
// CRITICAL SCOPE: this route sets exactly one Redis flag and nothing else.
// It must never close Postgres sessions, delete frames/blobs, or touch
// relay-health state — those all remain entirely unaffected by this flag,
// by construction (this handler has no Prisma import, no Blob import).
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

    await redis.set(EVENT_FINISHED_KEY, '1', { ex: EVENT_FINISHED_TTL_S })
    return json({ finished: true })
  } catch (e) {
    console.error('/api/finish: unexpected error', e)
    return json({ error: 'internal' }, 500)
  }
}
