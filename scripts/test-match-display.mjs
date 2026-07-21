#!/usr/bin/env node
// Standalone assertion runner for lib/match-display.ts's shouldShowMatchName —
// the single "is this catalog match confident enough to show its name?" policy
// shared by the /live card and the TAPPABLE history strip. Run via:
//   npx tsx scripts/test-match-display.mjs
// No test framework in this repo yet (same pattern as scripts/test-catalog.mjs).
//
// This is the correctness-critical seam of the M101 display-gate fix: a
// contested medium match MUST be withheld on BOTH surfaces (a wrong name in
// front of a guest — including on a history-pill TAP — is worse than a nameless
// "Deep-sky field"), while an off-center-but-unambiguous medium MUST be shown.

import { shouldShowMatchName } from '../lib/match-display.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`)
  } else {
    failures++
    console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`)
  }
}

// high -> always show, regardless of contested state (a high match is
// dead-center; the runner-up guardrail would have downgraded it to medium if
// the field were genuinely ambiguous, so a 'high' + contested pairing means
// "close, but a rival is merely in range" and is still safe to name).
assert('high, no rival -> show', shouldShowMatchName('high', false) === true)
assert('high, with rival -> show', shouldShowMatchName('high', true) === true)

// medium -> show ONLY when NOT contested. This is the whole fix:
//   - off-center, no rival (what M101 hit) -> show the name.
//   - genuinely ambiguous, rival in range  -> withhold.
assert('medium, no rival (off-center) -> show', shouldShowMatchName('medium', false) === true)
assert('medium, with rival (ambiguous) -> withhold', shouldShowMatchName('medium', true) === false)

// low / none -> never show (not reached for a real match today, but the policy
// is explicit about it rather than relying on callers never passing them).
assert('low, no rival -> withhold', shouldShowMatchName('low', false) === false)
assert('low, with rival -> withhold', shouldShowMatchName('low', true) === false)
assert('none, no rival -> withhold', shouldShowMatchName('none', false) === false)
assert('none, with rival -> withhold', shouldShowMatchName('none', true) === false)

// Absent/legacy contested fact: callers resolve a missing/null wire value to
// false BEFORE calling (older server, or a run predating the StackRun column).
// Confirm that the false-default direction is SAFE the way the callers rely on:
// a medium with the fact defaulted to false shows its name — i.e. exactly the
// pre-fix behavior for legacy data, no NEW regression, and the fix only tightens
// behavior for going-forward matches that DO carry a real true value.
assert(
  'medium with contested-fact defaulted to false (legacy) -> show (matches pre-fix behavior)',
  shouldShowMatchName('medium', undefined ?? false) === true,
)
assert(
  'medium with contested-fact defaulted to false via null (legacy) -> show',
  shouldShowMatchName('medium', null ?? false) === true,
)

console.log('')
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`)
  process.exit(1)
} else {
  console.log('All assertions passed.')
}
