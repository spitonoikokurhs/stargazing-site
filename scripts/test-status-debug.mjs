// Unit tests for the /live-debug authorization + gate logic (lib/debug-auth.ts,
// wired verbatim into app/api/status/route.ts's GET). Deliberately PURE — no
// Redis, no running server, no writes to the shared production finished-flag —
// because the whole point of this feature is that guests are never affected,
// and a test that set live:event:finished on the real Upstash instance would
// flip the actual /live page to the farewell for any guest polling mid-run.
// The route wires the exact resolveDebugGate/parseDebugParam tested here, so the
// shipped ordering and the tested ordering can't drift.
//
// The complementary test-status-debug-route.mjs exercises the actual GET
// handler with a MOCKED redis (still no prod writes) to prove wiring, headers,
// and field passthrough.
//
// Run with: node --import tsx scripts/test-status-debug.mjs
import { NextRequest } from 'next/server'
import {
  tokenMatches,
  mintDebugCookie,
  verifyDebugCookie,
  isDebugAuthorized,
  resolveDebugGate,
  parseDebugParam,
  DEBUG_COOKIE_NAME,
  DEBUG_COOKIE_TTL_MS,
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
const NOW = 1_700_000_000_000 // fixed clock so cookie tests are deterministic

function reqWith({ bearer, cookie } = {}) {
  const headers = {}
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const req = new NextRequest('https://example.test/api/status', { headers })
  if (cookie) req.cookies.set(DEBUG_COOKIE_NAME, cookie)
  return req
}

function main() {
  // ---- token primitives ----
  assert('tokenMatches: correct token', tokenMatches(SECRET, SECRET) === true)
  assert('tokenMatches: wrong token', tokenMatches(WRONG, SECRET) === false)
  assert('tokenMatches: empty token', tokenMatches('', SECRET) === false)

  // ---- signed cookie: format + secret binding ----
  const cookie = mintDebugCookie(SECRET, NOW)
  assert('mintDebugCookie: format is <expiry>.<hex-hmac>, not the raw secret', /^\d+\.[0-9a-f]{64}$/.test(cookie) && !cookie.includes(SECRET))
  assert('mintDebugCookie: embedded expiry = now + TTL', Number(cookie.split('.')[0]) === NOW + DEBUG_COOKIE_TTL_MS)
  assert('verifyDebugCookie: valid, not yet expired', verifyDebugCookie(cookie, SECRET, NOW) === true)
  assert('verifyDebugCookie: wrong secret rejected', verifyDebugCookie(cookie, WRONG, NOW) === false)
  assert('verifyDebugCookie: undefined rejected', verifyDebugCookie(undefined, SECRET, NOW) === false)

  // ---- signed cookie: THE EXPIRY ACTUALLY EXPIRES (the must-fix) ----
  // A validly-signed cookie must stop being accepted once its embedded expiry
  // passes — regardless of the browser. This is the difference from a bare
  // sha256(secret) cookie the server would honour forever.
  assert('verifyDebugCookie: rejected 1ms AFTER embedded expiry', verifyDebugCookie(cookie, SECRET, NOW + DEBUG_COOKIE_TTL_MS + 1) === false)
  assert('verifyDebugCookie: rejected exactly AT expiry (expiry must be strictly future)', verifyDebugCookie(cookie, SECRET, NOW + DEBUG_COOKIE_TTL_MS) === false)
  // A copied cookie cannot be extended by editing the expiry — the HMAC covers it.
  const tampered = `${NOW + 10 * DEBUG_COOKIE_TTL_MS}.${cookie.split('.')[1]}`
  assert('verifyDebugCookie: expiry cannot be extended without re-signing (HMAC covers expiry)', verifyDebugCookie(tampered, SECRET, NOW) === false)
  assert('verifyDebugCookie: garbage rejected', verifyDebugCookie('not-a-cookie', SECRET, NOW) === false)
  assert('verifyDebugCookie: non-numeric expiry rejected', verifyDebugCookie(`abc.${cookie.split('.')[1]}`, SECRET, NOW) === false)

  // ---- isDebugAuthorized: bearer + cookie paths, with clock ----
  assert('authz: correct bearer', isDebugAuthorized(reqWith({ bearer: SECRET }), SECRET, NOW) === true)
  assert('authz: wrong bearer', isDebugAuthorized(reqWith({ bearer: WRONG }), SECRET, NOW) === false)
  assert('authz: no credentials', isDebugAuthorized(reqWith({}), SECRET, NOW) === false)
  assert('authz: valid signed cookie', isDebugAuthorized(reqWith({ cookie }), SECRET, NOW) === true)
  assert('authz: EXPIRED signed cookie rejected at the endpoint', isDebugAuthorized(reqWith({ cookie }), SECRET, NOW + DEBUG_COOKIE_TTL_MS + 1) === false)
  assert('authz: raw secret in cookie is NOT accepted (cookie is a signed value, not the token)', isDebugAuthorized(reqWith({ cookie: SECRET }), SECRET, NOW) === false)

  // ---- strict debug-param parsing (should-fix) ----
  assert("parseDebugParam: absent -> 'absent'", parseDebugParam([]) === 'absent')
  assert("parseDebugParam: ['1'] -> 'valid'", parseDebugParam(['1']) === 'valid')
  assert("parseDebugParam: ['true'] -> 'malformed'", parseDebugParam(['true']) === 'malformed')
  assert("parseDebugParam: ['0'] -> 'malformed'", parseDebugParam(['0']) === 'malformed')
  assert("parseDebugParam: ['0','1'] duplicate -> 'malformed'", parseDebugParam(['0', '1']) === 'malformed')
  assert("parseDebugParam: ['1','1'] duplicate -> 'malformed'", parseDebugParam(['1', '1']) === 'malformed')

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
  //    residue that changes a subsequent guest request.
  const guestBefore = resolveDebugGate({ finishedFlag: true, debugRequested: false, debugAuthorized: false })
  const _debugInBetween = resolveDebugGate({ finishedFlag: true, debugRequested: true, debugAuthorized: true })
  const guestAfter = resolveDebugGate({ finishedFlag: true, debugRequested: false, debugAuthorized: false })
  assert('4. FEAR TEST: guest verdict unchanged before/after a debug request', guestBefore === 'guest-finished' && guestAfter === 'guest-finished')

  // 4b. (corrected) An UNAUTHENTICATED but debug-REQUESTED request must NOT be
  //     treated as a guest — it is a hard 401 (verdict 'unauthorized'), not
  //     'guest-finished'. The earlier version of this assertion mistakenly set
  //     debugRequested:false and so just re-ran the guest input; the real
  //     invariant is that debugRequested:true + debugAuthorized:false NEVER
  //     yields any guest-* verdict.
  const unauthDebug = resolveDebugGate({ finishedFlag: true, debugRequested: true, debugAuthorized: false })
  assert(
    '4b. FEAR TEST (corrected): unauthenticated debug request is 401, never a guest verdict',
    unauthDebug === 'unauthorized' && unauthDebug !== 'guest-finished' && unauthDebug !== 'guest-normal',
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
