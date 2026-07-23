import { createHash, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

// Shared authorization for the private operator debug surface: the
// /live-debug page (cookie bootstrap — see app/live-debug/route.ts) and the
// /api/status?debug=1 read it drives. Kept in ONE place so the secret source,
// the constant-time comparison, and the cookie name can never drift between
// the route that MINTS the cookie and the endpoint that TRUSTS it.
//
// Same secret policy as /api/viewer-stats and /api/debug/match-decisions: a
// dedicated VIEWER_STATS_TOKEN, falling back to INGEST_SECRET only when it
// isn't configured. This is read-only diagnostics checked from a phone/laptop
// after (or during) an event — the same operator context those endpoints
// already serve — so it deliberately reuses their credential rather than
// inventing a third one. The fallback stays even in production (callers warn,
// they don't hard-fail) so a missing token can't lock the operator out.
export function debugSecret(): string | undefined {
  return process.env.VIEWER_STATS_TOKEN || process.env.INGEST_SECRET
}

// Constant-time compare of a presented token against the configured secret.
// Both sides are hashed to a fixed 32-byte digest first, so timingSafeEqual
// never throws on a length mismatch and the comparison time can't leak the
// secret's length. Identical construction to authorized() in
// app/api/debug/match-decisions/route.ts — intentionally so.
export function tokenMatches(presented: string, secret: string): boolean {
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

// The HttpOnly cookie the /live-debug bootstrap sets once a valid ?token= is
// presented, and that /api/status?debug=1 accepts thereafter. Its VALUE is the
// sha256 hex of the secret, never the secret itself — so even if the cookie
// somehow leaked (it's HttpOnly + Secure + SameSite=Strict, so it shouldn't),
// it can't be replayed as a Bearer token against the other debug endpoints,
// which compare the RAW token. Verified with a second constant-time compare
// against the same hex digest.
export const DEBUG_COOKIE_NAME = 'sg_debug'

export function debugCookieValue(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function cookieMatches(presented: string, secret: string): boolean {
  const expected = debugCookieValue(secret)
  // Both are fixed-length lowercase hex (sha256 → 64 chars); guard the length
  // anyway so timingSafeEqual can't throw on a malformed/truncated cookie.
  if (presented.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
}

// Is this request authorized to see debug data? Accepts EITHER a Bearer token
// (for curl/manual checks and the test suite) OR the bootstrap cookie (how the
// /live-debug page's own /api/status?debug=1 polls authenticate, keeping the
// raw token out of the browser entirely after the one bootstrap redirect).
export function isDebugAuthorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (header && header.startsWith('Bearer ')) {
    if (tokenMatches(header.slice('Bearer '.length), secret)) return true
  }
  const cookie = req.cookies.get(DEBUG_COOKIE_NAME)?.value
  if (cookie && cookieMatches(cookie, secret)) return true
  return false
}

// The pure decision at the heart of the /api/status debug gate — extracted so
// its ordering (and the critical "a debug request never silently falls through
// to guest behaviour" and "an UNauthenticated request is untouched" invariants)
// can be exhaustively unit-tested WITHOUT touching Redis or the shared
// production finished-flag. The GET handler wires the real (finishedFlag,
// debugRequested, debugAuthorized) into this and acts on the verdict:
//
//   'unauthorized'    -> 401 (debug requested but not authorized)
//   'debug-live'      -> skip the finished flag, serve live + debug fields
//   'guest-finished'  -> the normal farewell short-circuit (finished flag set)
//   'guest-normal'    -> ordinary guest path (no finished flag)
//
// The invariant the "fear test" checks: a request with debugAuthorized=false
// ALWAYS yields a guest-* verdict identical to what it would get with no debug
// param at all — the debug machinery leaves the guest path bit-for-bit alone.
export type DebugGateVerdict = 'unauthorized' | 'debug-live' | 'guest-finished' | 'guest-normal'

export function resolveDebugGate(input: {
  finishedFlag: boolean
  debugRequested: boolean
  debugAuthorized: boolean
}): DebugGateVerdict {
  const { finishedFlag, debugRequested, debugAuthorized } = input
  // A debug request that isn't authorized is a hard stop — never a fall-through.
  if (debugRequested && !debugAuthorized) return 'unauthorized'
  // Authorized debug bypasses the finished short-circuit to keep showing live.
  if (debugAuthorized) return 'debug-live'
  // Everyone else is the guest path: finished flag wins if set, else normal.
  return finishedFlag ? 'guest-finished' : 'guest-normal'
}
