import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

// Shared authorization for the private operator debug surface: the /live-debug
// page (cookie bootstrap — see app/live-debug/auth/route.ts) and the
// /api/status?debug=1 read it drives. Kept in ONE place so the secret source,
// the constant-time comparison, and the cookie format can never drift between
// the route that MINTS the cookie and the endpoint that TRUSTS it.
//
// SECURITY POSTURE (why this does NOT reuse INGEST_SECRET):
// The bootstrap URL (/live-debug/auth?token=…) carries the token in a query
// string — it can land in browser history, a screenshot, a shared link, or an
// access log. INGEST_SECRET grants write authority: ingesting frames AND
// finishing a live event. If the bootstrap accepted it, a leaked debug URL
// would hand someone the power to END A LIVE EVENT, not just read diagnostics.
// So this surface requires its OWN dedicated, read-only token and FAILS CLOSED
// if it isn't set — it never falls back to a write-capable credential.
//
// DEBUG_VIEW_TOKEN is the only accepted credential. Keeping it separate makes
// this surface independently revocable and genuinely fail-closed when the
// variable is absent.
export function debugSecret(): string | undefined {
  return process.env.DEBUG_VIEW_TOKEN || undefined
}

// Constant-time compare of a presented Bearer token against the configured
// secret. Both sides are hashed to a fixed 32-byte digest first, so
// timingSafeEqual never throws on a length mismatch and the comparison time
// can't leak the secret's length. (Bearer is for curl/manual checks and the
// test suite; the browser page uses the signed cookie below.)
export function tokenMatches(presented: string, secret: string): boolean {
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

// ---- Stateless signed cookie with embedded expiry ----
//
// The bootstrap (/live-debug/auth) mints this; /api/status?debug=1 and the
// /live-debug page verify it. Format:
//
//     <expiryMs>.<hexHmac>
//     hexHmac = HMAC-SHA256(secret, "live-debug:" + expiryMs)
//
// Verification checks BOTH the signature (constant-time) AND that expiryMs is
// still in the future. This is the crucial difference from a bare
// sha256(secret) cookie with a maxAge: maxAge only ASKS the browser to discard
// the cookie — the server would still honour a copied sha256(secret) forever,
// until the secret rotates. Here the expiry is INSIDE the signed value, so a
// copied cookie stops being accepted at the embedded time no matter what the
// browser does, and it cannot be extended without the secret (the HMAC covers
// the expiry). The cookie never contains the raw token, and — being an HMAC,
// not the token — cannot be replayed as a Bearer against any endpoint.
export const DEBUG_COOKIE_NAME = 'sg_debug'
export const DEBUG_COOKIE_TTL_MS = 12 * 60 * 60 * 1000 // 12h — a venue night + tail
const COOKIE_HMAC_CONTEXT = 'live-debug:'

function signExpiry(secret: string, expiryMs: number): string {
  return createHmac('sha256', secret).update(`${COOKIE_HMAC_CONTEXT}${expiryMs}`).digest('hex')
}

// Mint a fresh signed cookie value that expires `ttlMs` from `nowMs`. nowMs is
// passed in (not read here) so callers control the clock and tests are
// deterministic.
export function mintDebugCookie(secret: string, nowMs: number, ttlMs: number = DEBUG_COOKIE_TTL_MS): string {
  const expiryMs = nowMs + ttlMs
  return `${expiryMs}.${signExpiry(secret, expiryMs)}`
}

// Verify a signed cookie: correct signature AND not past its embedded expiry.
// nowMs passed in for the same deterministic-clock reason.
export function verifyDebugCookie(value: string | undefined, secret: string, nowMs: number): boolean {
  if (!value) return false
  const dot = value.indexOf('.')
  if (dot <= 0) return false
  const expiryStr = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  // expiry must be a clean positive integer — reject anything else outright.
  if (!/^\d+$/.test(expiryStr)) return false
  const expiryMs = Number(expiryStr)
  if (!Number.isSafeInteger(expiryMs)) return false
  // Signature check FIRST (constant-time), so a forged/mangled value can't be
  // distinguished from an expired one by timing.
  const expected = signExpiry(secret, expiryMs)
  if (sig.length !== expected.length) return false
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false
  // Only then the expiry: a validly-signed but stale cookie is rejected.
  return expiryMs > nowMs
}

// Is this request authorized to see debug data? Accepts EITHER a Bearer token
// (raw token — for curl/manual checks and the test suite) OR the signed
// bootstrap cookie (how the /live-debug page's own /api/status?debug=1 polls
// authenticate, keeping the raw token out of the browser entirely after the one
// bootstrap redirect). nowMs defaults to Date.now(); callers/tests may pass an
// explicit clock.
export function isDebugAuthorized(req: NextRequest, secret: string, nowMs: number = Date.now()): boolean {
  const header = req.headers.get('authorization')
  if (header && header.startsWith('Bearer ')) {
    if (tokenMatches(header.slice('Bearer '.length), secret)) return true
  }
  const cookie = req.cookies.get(DEBUG_COOKIE_NAME)?.value
  if (verifyDebugCookie(cookie, secret, nowMs)) return true
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

// ---- Strict debug-param parsing (should-fix) ----
//
// A guest request has no ?debug at all. A debug request must be EXACTLY one
// `debug=1`. Anything ambiguous — debug=true, debug=0, debug=1&debug=1,
// debug=0&debug=1 — is a client error (400), NOT silently treated as a guest
// request. Silently degrading a malformed debug attempt to guest behaviour is
// the same class of "invisible mistake" the 401-not-fall-through rule guards
// against: the operator would think they're seeing debug and actually be seeing
// the guest view.
export type DebugParam = 'absent' | 'valid' | 'malformed'

export function parseDebugParam(values: string[]): DebugParam {
  if (values.length === 0) return 'absent'
  if (values.length === 1 && values[0] === '1') return 'valid'
  return 'malformed'
}
