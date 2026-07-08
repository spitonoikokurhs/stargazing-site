import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { readViewerStats, viewerEventKey, viewerSpecialEventKey } from '@/lib/redis'
import { athensToday, eventFor } from '@/lib/schedule'
import { extraEventFor, isExtraEventSlug } from '@/lib/extra-events'

// Node runtime required: crypto.timingSafeEqual, createHash.
export const runtime = 'nodejs'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// A DEDICATED secret for this endpoint, falling back to INGEST_SECRET only
// when VIEWER_STATS_TOKEN isn't configured. In production this fallback is
// logged loudly (see the console.warn at the call site below) rather than
// silently accepted: this endpoint gets checked from a phone during a live
// event, a context where the relay's write-capable secret (which can post
// frames and mark nights finished/cancelled) has no business being typed/
// pasted/stored. Read-only analytics deserves its own, separately-revocable
// credential rather than reusing the one that can actually control the
// broadcast. The fallback itself stays in place even in production (a warn,
// not a hard failure) so a missing VIEWER_STATS_TOKEN can't lock the
// operator out of stats mid-event — it nags every request until fixed
// instead of blocking the deploy that would fix it.
function statsSecret(): string | undefined {
  return process.env.VIEWER_STATS_TOKEN || process.env.INGEST_SECRET
}

// Same auth SCHEME as /api/finish and /api/ingest — Bearer token, sha256-
// hashed on both sides before timingSafeEqual so the comparison is
// constant-time and never throws on a length mismatch — but see statsSecret
// above for why the actual secret VALUE is (in production) meant to differ.
function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(presented, expected)
}

// Private operator/analytics endpoint — NEVER surfaced to guests. /live does
// not call this and does not render any of these numbers; see the viewers:
// null passthrough in app/api/status/route.ts. ?event=<slug> reads a special
// event's own scoped counters, keyed by the event's OWN revealAt (see
// viewerSpecialEventKey — a multi-day special event is one event, not one
// counter per calendar day); otherwise reads the shared hotel scope for
// tonight's scheduled event (falling back to a generic "hotel" bucket if no
// event is scheduled today, e.g. checking stats outside a normal session).
export async function GET(req: NextRequest) {
  try {
    const secret = statsSecret()
    if (!secret) {
      console.error('/api/viewer-stats: no secret configured (VIEWER_STATS_TOKEN or INGEST_SECRET)')
      return json({ error: 'internal' }, 500)
    }
    if (process.env.NODE_ENV === 'production' && !process.env.VIEWER_STATS_TOKEN) {
      console.warn(
        '/api/viewer-stats: VIEWER_STATS_TOKEN not set in production, falling back to INGEST_SECRET — set a separate token for production',
      )
    }
    if (!authorized(req, secret)) {
      console.warn(`/api/viewer-stats: auth failure at ${new Date().toISOString()}`)
      return json({ error: 'unauthorized' }, 401)
    }

    const eventSlug = req.nextUrl.searchParams.get('event')

    const scope: 'hotel' | 'event' = eventSlug && isExtraEventSlug(eventSlug) ? 'event' : 'hotel'
    const slug = scope === 'event' ? eventSlug : null
    const eventKey =
      scope === 'event' && slug
        ? viewerSpecialEventKey(slug, extraEventFor(slug)?.revealAt ?? 'unknown')
        : viewerEventKey(athensToday(), eventFor(athensToday())?.hotelId ?? null)

    const stats = await readViewerStats(scope, slug, eventKey)

    return json({
      scope,
      eventKey,
      current: stats.current,
      maxConcurrent: stats.maxConcurrent,
      unique: stats.unique,
      activeWindowSeconds: 60,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('/api/viewer-stats: unexpected error', e)
    return json({ error: 'internal' }, 500)
  }
}
