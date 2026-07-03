import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'

// Node runtime required: crypto.timingSafeEqual, createHash.
export const runtime = 'nodejs'

const MIN_SECRET_LENGTH = 32

// Every response is uncacheable — a cached auth error or CDN-cached cron
// result would be wrong (mirrors /api/status's json() helper).
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Constant-time bearer-token check — same shape as /api/ingest's authorized()
// (app/api/ingest/route.ts): both sides sha256-hashed first so
// timingSafeEqual always compares equal-length buffers and cannot throw on a
// length mismatch (which would itself leak length information).
function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(presented, expected)
}

// Triggered daily by Vercel Cron (see vercel.json). Vercel sends CRON_SECRET
// as `Authorization: Bearer <value>` automatically on every invocation it
// makes; this route just verifies that against the same env var.
export async function GET(req: NextRequest) {
  // Auth — fail closed and loud if the secret is not configured, same
  // discipline as INGEST_SECRET in /api/ingest. Nothing expensive runs before
  // this check.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET not configured')
    return json({ error: 'internal' }, 500)
  }
  // Soft strength guard: warn, don't block — a short but correct secret still
  // authenticates fine, this just flags a weak one for rotation.
  if (secret.length < MIN_SECRET_LENGTH) {
    console.warn(`CRON_SECRET is shorter than ${MIN_SECRET_LENGTH} chars; consider rotating to a longer value`)
  }
  if (!authorized(req, secret)) {
    return json({ error: 'unauthorized' }, 401)
  }

  // Deliberately a controlled 500 on failure (not a 200 swallowing the
  // error): Vercel's cron log should show the run as failed, but no raw
  // throw escapes to a default error page that could leak a stack.
  //
  // lib/sessions.ts (and its prisma import) is loaded dynamically here,
  // AFTER auth succeeds, so an unauthenticated request never causes the
  // Prisma-importing module to load at all.
  try {
    const { closeStaleActiveSessions } = await import('@/lib/sessions')
    const closed = await closeStaleActiveSessions()
    return json({ closed })
  } catch (e) {
    console.error('/api/cron/close-sessions failed', e)
    return json({ error: 'internal' }, 500)
  }
}
