// Behavioral tests for the analytics-consent gate — the load-bearing claim
// behind suppressing the cookie banner on /live*: nothing non-essential is
// collected without consent, AND withdrawal is as effective as granting.
//
// These test the ACTUAL shipped functions from lib/consent.ts (getOrCreateViewerId
// / getConsentedViewerId / clearStoredViewerId / hasAnalyticsConsent) — not a
// mirror of them. LiveView imports the same functions, so passing here means the
// live path behaves this way. We stub window.localStorage + window.sessionStorage
// so the real code runs; no framework, no jsdom (repo style).
//
// Run with: node --import tsx scripts/test-consent.mjs

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

// Fake window with both storages + a crypto.randomUUID, set BEFORE import so
// lib/consent.ts's typeof-window checks see it.
let local = makeStorage()
let session = makeStorage()
globalThis.window = { localStorage: local, sessionStorage: session }
if (!globalThis.crypto) globalThis.crypto = {}
let uuidN = 0
globalThis.crypto.randomUUID = () => `uuid-${++uuidN}`

const {
  hasAnalyticsConsent,
  getOrCreateViewerId,
  getConsentedViewerId,
  clearStoredViewerId,
  CONSENT_STORAGE_KEY,
  CONSENT_ACCEPTED_VALUE,
  VIEWER_ID_STORAGE_KEY,
} = await import('../lib/consent.ts')

function accept() { local.setItem(CONSENT_STORAGE_KEY, CONSENT_ACCEPTED_VALUE) }
function reject() { local.setItem(CONSENT_STORAGE_KEY, 'rejected') }
function clearChoice() { local.removeItem(CONSENT_STORAGE_KEY) }
function reset() { local = makeStorage(); session = makeStorage(); globalThis.window = { localStorage: local, sessionStorage: session } }

function main() {
  // --- hasAnalyticsConsent contract ---
  reset(); clearChoice()
  assert('no choice -> not consented', hasAnalyticsConsent() === false)
  reject(); assert('rejected -> not consented', hasAnalyticsConsent() === false)
  local.setItem(CONSENT_STORAGE_KEY, 'garbage'); assert('unknown value -> not consented', hasAnalyticsConsent() === false)
  accept(); assert('accepted -> consented', hasAnalyticsConsent() === true)

  // --- No consent: getOrCreateViewerId returns null AND writes nothing ---
  reset(); clearChoice()
  assert('no consent -> getOrCreateViewerId null', getOrCreateViewerId() === null)
  assert('no consent -> NOTHING in sessionStorage', session._map.size === 0)
  assert('no consent -> getConsentedViewerId null', getConsentedViewerId() === null)

  // --- Rejected: still no id, no write ---
  reset(); reject()
  assert('rejected -> getOrCreateViewerId null', getOrCreateViewerId() === null)
  assert('rejected -> no storage write', session._map.size === 0)

  // --- Consent: id created, persisted, stable ---
  reset(); accept()
  const id1 = getOrCreateViewerId()
  assert('consent -> id created', typeof id1 === 'string' && id1.length > 0)
  assert('consent -> persisted to sessionStorage', session.getItem(VIEWER_ID_STORAGE_KEY) === id1)
  assert('consent -> getConsentedViewerId returns the same id', getConsentedViewerId() === id1)
  assert('consent -> second getOrCreateViewerId is stable (no double-count)', getOrCreateViewerId() === id1)

  // --- ACCEPT AFTER /live already mounted (mid-session grant): the per-poll
  //     resolution means the id appears once consent lands, no reload. We model
  //     "poll" as a call to getConsentedViewerId (poll's fast path) falling back
  //     to getOrCreateViewerId — exactly what LiveView's loop does. ---
  reset(); clearChoice()
  assert('mounted-no-consent poll -> no id', (getConsentedViewerId() ?? getOrCreateViewerId()) === null)
  accept()
  const grantedId = getConsentedViewerId() ?? getOrCreateViewerId()
  assert('mid-session accept -> next poll now has an id', typeof grantedId === 'string' && grantedId.length > 0)

  // --- ACCEPT then REJECT without reload: withdrawal stops transmission AND
  //     erasing the stored id is possible/effective. ---
  reset(); accept()
  const beforeWithdraw = getOrCreateViewerId()
  assert('pre-withdraw id exists', typeof beforeWithdraw === 'string')
  reject()
  assert('after reject -> getConsentedViewerId null (transmission stops)', getConsentedViewerId() === null)
  assert('after reject -> getOrCreateViewerId also null (no new id minted)', getOrCreateViewerId() === null)
  // The poll clears the stored id on withdrawal:
  clearStoredViewerId()
  assert('after reject + clear -> sessionStorage id erased', session.getItem(VIEWER_ID_STORAGE_KEY) === null)

  // --- storage throwing (private mode) -> safe false / null, never throws ---
  {
    const thrower = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    globalThis.window = { localStorage: thrower, sessionStorage: thrower }
    let threw = false, consent, id
    try { consent = hasAnalyticsConsent(); id = getOrCreateViewerId() } catch { threw = true }
    assert('storage throws -> no throw, consent false, id null', threw === false && consent === false && id === null)
    globalThis.window = { localStorage: local, sessionStorage: session }
  }

  console.log('')
  if (failures > 0) { console.log(`${failures} consent test(s) FAILED`); process.exit(1) }
  console.log('All consent tests passed.')
}

main()
