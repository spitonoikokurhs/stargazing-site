import { NextRequest, NextResponse } from 'next/server'
import { trackRatelimit } from '@/lib/redis'
import { validateInteractionEvent } from '@/lib/interaction-events'
import { recordInteraction, resolveInteractionScope } from '@/lib/interaction-stats'

// Tier-1 interaction beacon sink. Guests' /live and farewell interactions POST
// here fire-and-forget (navigator.sendBeacon / fetch keepalive) so a bad or slow
// beacon can NEVER block or delay the guest render — this route is the only thing
// that awaits anything, and the client never waits on its response.
//
// runtime nodejs: consistent with the other API routes and their Upstash usage.
export const runtime = 'nodejs'
// Never cached — it's a write.
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// ============================================================================
// TIER-1 IS IDENTIFIER-FREE BY CONSTRUCTION — the guarantee, in one place.
//
// This endpoint stores NOTHING that identifies a person:
//   • The request body is validated to exactly { key, objectId? } where `key`
//     is one of a fixed allowlist (lib/interaction-events) and `objectId` is a
//     CATALOG object id (a property of the sky, e.g. "M57") — never a viewer.
//     Any other field on the body is ignored and never read.
//   • The client IP is read ONLY to feed trackRatelimit.limit(ip) (Upstash
//     hashes it into an internal rate-limit counter key with a short TTL; the
//     raw IP is not persisted as data). We do NOT store it, do NOT write it to
//     any counter, and deliberately do NOT even log it here (unlike /api/ingest,
//     which logs the IP on throttle for abuse triage — a beacon sink has no such
//     need, so the cleanest choice is to never touch the value beyond the
//     limiter). No x-forwarded-for value ever leaves this function.
//   • The eventKey is resolved SERVER-SIDE from the schedule (resolveInteraction
//     Scope) — the client cannot choose or influence which counter bucket it
//     writes to beyond the allowlisted key + optional objectId.
//   • No cookie is read or set. No fingerprinting. No User-Agent parsing.
//
// TIER-2 (consented per-viewer journeys) is NOT implemented in this route: it
// would attach a consented viewerId, and would be gated on hasAnalyticsConsent()
// client-side before the id is ever sent. Until that lands, this route is
// Tier-1 only and provably identifier-free.
// ============================================================================

// Best-effort client IP for rate-limit keying ONLY (see the note above). Never
// stored, never logged, never returned. Falls back to a shared bucket key when
// absent (local dev) so throttling still functions rather than no-oping.
function rateLimitKey(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function POST(req: NextRequest) {
  try {
    // 1. Rate limit first. Fails OPEN on an Upstash error — dropping a guest's
    // anonymous tally is a non-event, but so is a brief unthrottled window; we
    // never fail the request on a limiter outage.
    try {
      const { success } = await trackRatelimit.limit(rateLimitKey(req))
      if (!success) {
        // 204: the client is fire-and-forget and never inspects the body; a
        // throttle is silent by design (no error surfaced to a guest).
        return new NextResponse(null, { status: 204 })
      }
    } catch {
      // swallow — fail open
    }

    // 2. Parse the body defensively. A malformed/empty body is a no-op, not an
    // error (a beacon must never surface a failure to a guest).
    let body: unknown = null
    try {
      body = await req.json()
    } catch {
      return new NextResponse(null, { status: 204 })
    }

    // 3. Validate against the allowlist. Unknown key -> dropped silently. This
    // is the cardinality guard: only known interaction keys can ever create or
    // touch a counter.
    const event = validateInteractionEvent(body)
    if (!event) {
      return new NextResponse(null, { status: 204 })
    }

    // 4. Resolve the event window server-side and increment. Optional ?event=
    // scopes to a special event; otherwise tonight's hotel scope. recordInteraction
    // is itself fail-open (buffer cap + Redis errors return {ok:false}); either
    // way the guest gets a benign 204.
    const eventSlug = req.nextUrl.searchParams.get('event')
    const { eventKey } = resolveInteractionScope(eventSlug)
    await recordInteraction(eventKey, event)

    return new NextResponse(null, { status: 204 })
  } catch (e) {
    // Never 500 a beacon. Log for our own diagnostics (no request data), 204 out.
    console.error('/api/track: unexpected error', e)
    return new NextResponse(null, { status: 204 })
  }
}
