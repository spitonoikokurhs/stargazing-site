// Rename-protection: lib/consent.ts and public/cookie-consent.js MUST agree on
// the storage key, the accepted value, and the event names — they are the
// contract between the JS that WRITES consent (+ dispatches events) and the TS
// that READS consent (+ listens). They're duplicated string literals across a
// .ts/.js boundary (the JS isn't bundled with the TS), so a rename on one side
// would silently desync them: analytics that never turns off, or a viewer id
// that never appears. This test reads the raw JS file and asserts every TS
// constant's VALUE occurs verbatim in it.
//
// Run with: node --import tsx scripts/test-consent-parity.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CONSENT_STORAGE_KEY,
  CONSENT_ACCEPTED_VALUE,
  CONSENT_CHANGED_EVENT,
  CONSENT_GRANTED_EVENT,
} from '../lib/consent.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const jsPath = join(__dirname, '..', 'public', 'cookie-consent.js')
const js = readFileSync(jsPath, 'utf8')

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

// Each TS constant's value must appear as a double-quoted literal in the JS.
function jsHasLiteral(value) {
  return js.includes(`"${value}"`) || js.includes(`'${value}'`)
}

function main() {
  assert(`storage key "${CONSENT_STORAGE_KEY}" present in cookie-consent.js`, jsHasLiteral(CONSENT_STORAGE_KEY))
  assert(`accepted value "${CONSENT_ACCEPTED_VALUE}" present in cookie-consent.js`, jsHasLiteral(CONSENT_ACCEPTED_VALUE))
  assert(`changed event "${CONSENT_CHANGED_EVENT}" dispatched in cookie-consent.js`, jsHasLiteral(CONSENT_CHANGED_EVENT))
  assert(`granted event "${CONSENT_GRANTED_EVENT}" dispatched in cookie-consent.js`, jsHasLiteral(CONSENT_GRANTED_EVENT))

  // Guard the guard: if someone typo's a TS constant to empty/short, the
  // includes() check would trivially pass — require non-trivial values.
  for (const [name, value] of [
    ['CONSENT_STORAGE_KEY', CONSENT_STORAGE_KEY],
    ['CONSENT_ACCEPTED_VALUE', CONSENT_ACCEPTED_VALUE],
    ['CONSENT_CHANGED_EVENT', CONSENT_CHANGED_EVENT],
    ['CONSENT_GRANTED_EVENT', CONSENT_GRANTED_EVENT],
  ]) {
    assert(`${name} is a non-trivial string`, typeof value === 'string' && value.length >= 6)
  }

  console.log('')
  if (failures > 0) { console.log(`${failures} parity test(s) FAILED`); process.exit(1) }
  console.log('All consent-parity tests passed.')
}

main()
