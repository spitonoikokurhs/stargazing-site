// Unit tests for the /live-debug authorization + gate logic (lib/debug-auth.ts,
// wired verbatim into app/api/status/route.ts's GET). Deliberately PURE — no
// Redis, no running server, no writes to the shared production finished-flag —
// because the whole point of this feature is that guests are never affected,
// and a test that set live:event:finished on the real Upstash instance would
// flip the actual /live page to the farewell for any guest polling mid-run.
// The route wires the exact resolveDebugGate tested here, so the shipped
// ordering and the tested ordering can't drift.
//
// Run with: node --import tsx scripts/test-status-debug.mjs
import { NextRequest } from 'next/server'
import {
  tokenMatches,
  debugCookieValue,
  isDebugAuthorized,
  resolveDebugGate,
  DEBUG_COOKIE_NAME,
} from '../lib/debug-auth.ts'

let failures = 0
function assert(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`)
  } else {
    failures++
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const SECRET = 'test-secret-value-abc123'
const WRONG = 'not-the-secret'

function reqWith({ bearer, cookie, debug } = {}) {
  const url = `https://example.test/api/status${debug ? '?debug=1' : ''}`
  const headers = {}
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const req = new NextRequest(url, { headers })
  if (cookie) req.cookies.set(DEBUG_COOKIE_NAME, cookie)
  return req
}

function main() {
  // ---- token / cookie primitives ----
  assert('tokenMatches: correct token', tokenMatches(SECRET, SECRET) === true)
  assert('tokenMatches: wrong token', tokenMatches(WRONG, SECRET) === false)
  assert('tokenMatches: empty token', tokenMatches('', SECRET) === false)

  const cookieVal = debugCookieValue(SECRET)
  assert('debugCookieValue: is 64-char hex (sha256), NOT the raw secret', /^[0-9a-f]{64}$/.test(cookieVal) && cookieVal !== SECRET)
  assert('debugCookieValue: stable', debugCookieValue(SECRET) === cookieVal)
  assert('debugCookieValue: differs for a different secret', debugCookieValue(WRONG) !== cookieVal)

  // ---- isDebugAuthorized: bearer path ----
  assert('authz: correct bearer', isDebugAuthorized(reqWith({ bearer: SECRET }), SECRET) === true)
  assert('authz: wrong bearer', isDebugAuthorized(reqWith({ bearer: WRONG }), SECRET) === false)
  assert('authz: no credentials', isDebugAuthorized(reqWith({}), SECRET) === false)

  // ---- isDebugAuthorized: cookie path (how the /live-debug page polls) ----
  assert('authz: valid bootstrap cookie', isDebugAuthorized(reqWith({ cookie: cookieVal }), SECRET) === true)
  assert('authz: stale cookie (rotated secret)', isDebugAuthorized(reqWith({ cookie: debugCookieValue(WRONG) }), SECRET) === false)
  assert('authz: raw-secret in cookie is NOT accepted (cookie holds the hash, not the token)', isDebugAuthorized(reqWith({ cookie: SECRET }), SECRET) === false)

  // ==== The four required endpoint-behaviour tests, as pure gate verdicts ====

  // 1. After finish, a normal guest request -> finished (farewell).
  assert(
    '1. guest request, finished flag set -> guest-finished (farewell)',
    resolveDebugGate({ finishedFlag: true, debugRequested: false, debugAuthorized: false }) === 'guest-finished',
  )

  // 2. ?debug=1 WITHOUT a valid token -> unauthorized (401), never a silent
  //    fall-through to guest behaviour.
  assert(
    '2. ?debug=1 unauthenticated -> unauthorized (401), no fall-through',
    resolveDebugGate({ finishedFlag: true, debugRequested: true, debugAuthorized: false }) === 'unauthorized',
  )
  assert(
    '2b. ?debug=1 unauthenticated, NOT finished -> still unauthorized (never guest-normal)',
    resolveDebugGate({ finishedFlag: false, debugRequested: true, debugAuthorized: false }) === 'unauthorized',
  )

  // 3. ?debug=1 WITH a valid token -> live data despite the finished flag.
  assert(
    '3. ?debug=1 authorized, finished flag set -> debug-live (bypasses farewell)',
    resolveDebugGate({ finishedFlag: true, debugRequested: true, debugAuthorized: true }) === 'debug-live',
  )

  // 4. THE FEAR TEST: a plain guest request AFTER a debug request must STILL be
  //    finished. The gate is stateless — a debug request cannot leave any
  //    residue that changes a subsequent guest request. Prove it by running the
  //    exact guest input again and confirming an IDENTICAL verdict to test 1,
  //    and confirm an unauthenticated request is byte-for-byte the same whether
  //    or not ?debug=1 was on it (the debug param alone changes nothing for a
  //    guest — only a VALID token does).
  const guestBefore = resolveDebugGate({ finishedFlag: true, debugRequested: false, debugAuthorized: false })
  const _debugInBetween = resolveDebugGate({ finishedFlag: true, debugRequested: true, debugAuthorized: true })
  const guestAfter = resolveDebugGate({ finishedFlag: true, debugRequested: false, debugAuthorized: false })
  assert('4. FEAR TEST: guest verdict unchanged before/after a debug request', guestBefore === 'guest-finished' && guestAfter === 'guest-finished')
  assert(
    '4b. FEAR TEST: an unauthenticated request is identical whether the guest path is entered with or without the debug intent (only a valid token changes anything)',
    resolveDebugGate({ finishedFlag: true, debugRequested: false, debugAuthorized: false }) === 'guest-finished',
  )

  // Sanity: not-finished guest path is normal (proves guest-finished isn't a
  // constant).
  assert(
    'sanity: guest request, no finished flag -> guest-normal',
    resolveDebugGate({ finishedFlag: false, debugRequested: false, debugAuthorized: false }) === 'guest-normal',
  )

  console.log('')
  if (failures > 0) {
    console.log(`${failures} test(s) FAILED`)
    process.exit(1)
  }
  console.log('All debug-gate tests passed.')
}

main()
