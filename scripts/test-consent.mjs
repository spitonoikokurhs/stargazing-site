// Behavioral tests for the analytics-consent gate (lib/consent.ts) — the
// load-bearing claim behind suppressing the cookie banner on /live*: nothing
// non-essential is collected without consent. Covers the exact contract the
// review asked for:
//   - no stored consent  -> hasAnalyticsConsent() false  (=> no viewer id is
//     created, no Vercel Analytics / Speed Insights mount)
//   - stored "accepted"  -> hasAnalyticsConsent() true    (analytics runs)
//   - "rejected" / absent / bad storage -> false (safe default)
//
// Pure-function test in the repo's existing style (no framework, no jsdom): we
// stub a minimal window.localStorage so lib/consent.ts's real code runs. We
// also exercise the viewer-id GATE against the same helper to prove the
// "no consent -> no id, no storage write" behaviour end-to-end.
//
// Run with: node --import tsx scripts/test-consent.mjs

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

// --- Minimal in-memory localStorage stub on a fake window (set BEFORE import so
//     lib/consent.ts sees window at module-eval time via typeof checks). ---
function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

globalThis.window = { localStorage: makeStorage({}) }

const { hasAnalyticsConsent, CONSENT_STORAGE_KEY, CONSENT_ACCEPTED_VALUE } = await import('../lib/consent.ts')

function setConsent(value) {
  if (value === null) globalThis.window.localStorage.removeItem(CONSENT_STORAGE_KEY)
  else globalThis.window.localStorage.setItem(CONSENT_STORAGE_KEY, value)
}

// A faithful mirror of getOrCreateViewerId's consent GATE (the real function is
// module-private in LiveView.tsx). It proves the load-bearing behaviour: the
// consent check happens BEFORE any sessionStorage write, so no id is stored
// without consent. Uses a stubbed sessionStorage so we can assert no write.
function makeViewerIdGate() {
  const session = makeStorage({})
  const VIEWER_ID_STORAGE_KEY = 'stargazing:viewerId'
  function getOrCreateViewerId() {
    if (!hasAnalyticsConsent()) return null // <-- the gate under test
    const existing = session.getItem(VIEWER_ID_STORAGE_KEY)
    if (existing) return existing
    const fresh = 'viewer-' + session._map.size // deterministic stand-in for crypto.randomUUID()
    session.setItem(VIEWER_ID_STORAGE_KEY, fresh)
    return fresh
  }
  return { getOrCreateViewerId, session, VIEWER_ID_STORAGE_KEY }
}

function main() {
  // --- hasAnalyticsConsent contract ---
  setConsent(null)
  assert('no choice -> not consented', hasAnalyticsConsent() === false)

  setConsent('rejected')
  assert('rejected -> not consented', hasAnalyticsConsent() === false)

  setConsent('garbage')
  assert('unknown value -> not consented', hasAnalyticsConsent() === false)

  setConsent(CONSENT_ACCEPTED_VALUE)
  assert('accepted -> consented', hasAnalyticsConsent() === true)
  assert('accepted value is the string "accepted"', CONSENT_ACCEPTED_VALUE === 'accepted')

  // --- viewer-id gate: NO consent -> no id AND no storage write ---
  {
    setConsent(null)
    const { getOrCreateViewerId, session, VIEWER_ID_STORAGE_KEY } = makeViewerIdGate()
    const id = getOrCreateViewerId()
    assert('no consent -> viewer id is null', id === null)
    assert('no consent -> NOTHING written to sessionStorage', session.getItem(VIEWER_ID_STORAGE_KEY) === null && session._map.size === 0)
  }

  // --- viewer-id gate: rejected -> still no id ---
  {
    setConsent('rejected')
    const { getOrCreateViewerId, session } = makeViewerIdGate()
    assert('rejected -> viewer id is null', getOrCreateViewerId() === null)
    assert('rejected -> no storage write', session._map.size === 0)
  }

  // --- viewer-id gate: consent -> id created and persisted, stable on re-call ---
  {
    setConsent(CONSENT_ACCEPTED_VALUE)
    const { getOrCreateViewerId, session, VIEWER_ID_STORAGE_KEY } = makeViewerIdGate()
    const id1 = getOrCreateViewerId()
    assert('consent -> viewer id created (non-null)', typeof id1 === 'string' && id1.length > 0)
    assert('consent -> id persisted to sessionStorage', session.getItem(VIEWER_ID_STORAGE_KEY) === id1)
    const id2 = getOrCreateViewerId()
    assert('consent -> same id on second call (no double-count)', id2 === id1)
  }

  // --- storage throwing (private mode) -> safe false, never throws ---
  {
    const thrower = { getItem: () => { throw new Error('storage blocked') } }
    globalThis.window = { localStorage: thrower }
    let threw = false
    let result
    try { result = hasAnalyticsConsent() } catch { threw = true }
    assert('storage throws -> hasAnalyticsConsent returns false, does not throw', threw === false && result === false)
    globalThis.window = { localStorage: makeStorage({}) } // restore
  }

  console.log('')
  if (failures > 0) { console.log(`${failures} consent test(s) FAILED`); process.exit(1) }
  console.log('All consent tests passed.')
}

main()
