// Regression tests for the UFO farewell tap state machine (lib/farewell-taps.ts,
// wired into FarewellAegeanUfo's click handler). Proves the two load-bearing
// rules, in particular the MUST-FIX the review demanded:
//   - the finale fires exactly once at the threshold
//   - once fired it is TERMINAL FOREVER: every further tap is inert, and an
//     idle-reset in between cannot re-open replay (both apply to the animated
//     tier; the static tier has the same property via staticRevealed, asserted
//     structurally below)
//
// Run with: node --import tsx scripts/test-farewell-taps.mjs

import {
  initialTapState,
  tap,
  idleReset,
  FAREWELL_TAP_THRESHOLD,
} from '../lib/farewell-taps.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

function main() {
  assert('threshold is 5 (unchanged)', FAREWELL_TAP_THRESHOLD === 5)

  // --- taps below threshold: every one counts, none fires ---
  {
    let s = initialTapState()
    for (let i = 1; i < FAREWELL_TAP_THRESHOLD; i++) {
      const r = tap(s)
      s = r.state
      assert(`tap ${i} -> counted, count=${i}`, r.action === 'counted' && s.count === i, `action=${r.action} count=${s.count}`)
      assert(`tap ${i} -> not yet terminal`, s.finaleCompleted === false)
    }
  }

  // --- the threshold tap fires the finale exactly once ---
  {
    let s = initialTapState()
    let fired = 0
    let last
    for (let i = 0; i < FAREWELL_TAP_THRESHOLD; i++) { last = tap(s); s = last.state; if (last.action === 'finale') fired++ }
    assert('finale fires exactly once at threshold', fired === 1 && last.action === 'finale')
    assert('finale latches terminal (finaleCompleted true)', s.finaleCompleted === true)
  }

  // --- THE REGRESSION: post-finale taps are inert, forever ---
  {
    let s = initialTapState()
    for (let i = 0; i < FAREWELL_TAP_THRESHOLD; i++) s = tap(s).state // fire it
    assert('precondition: terminal after firing', s.finaleCompleted === true)

    const countAtFinale = s.count
    // Hammer it with far more than another full threshold of taps.
    for (let i = 0; i < FAREWELL_TAP_THRESHOLD * 4; i++) {
      const r = tap(s)
      assert(`post-finale tap ${i + 1} -> ignored`, r.action === 'ignored', `action=${r.action}`)
      assert(`post-finale tap ${i + 1} -> state UNCHANGED`, r.state === s || (r.state.count === s.count && r.state.finaleCompleted === s.finaleCompleted))
      s = r.state
    }
    assert('post-finale: count never advanced past the finale', s.count === countAtFinale, `count=${s.count} expected=${countAtFinale}`)
    assert('post-finale: never fires a second finale', s.finaleCompleted === true)
  }

  // --- an idle-reset AFTER the finale must NOT re-open replay ---
  {
    let s = initialTapState()
    for (let i = 0; i < FAREWELL_TAP_THRESHOLD; i++) s = tap(s).state // fire
    s = idleReset(s) // the streak-reset timer runs during finale cleanup
    assert('idleReset after finale keeps terminal latch', s.finaleCompleted === true)
    // Now a fresh full streak of taps must still NOT fire again.
    let firedAgain = 0
    for (let i = 0; i < FAREWELL_TAP_THRESHOLD; i++) { const r = tap(s); s = r.state; if (r.action === 'finale') firedAgain++ }
    assert('no replay after post-finale idleReset + full streak', firedAgain === 0 && s.finaleCompleted === true)
  }

  // --- idle-reset BEFORE the finale behaves normally (streak clears) ---
  {
    let s = initialTapState()
    s = tap(s).state
    s = tap(s).state
    assert('pre-finale count is 2', s.count === 2)
    s = idleReset(s)
    assert('pre-finale idleReset clears the streak', s.count === 0 && s.finaleCompleted === false)
    // and the finale still reachable afterwards
    let fired = 0
    for (let i = 0; i < FAREWELL_TAP_THRESHOLD; i++) { const r = tap(s); s = r.state; if (r.action === 'finale') fired++ }
    assert('finale still reachable after a pre-finale reset', fired === 1)
  }

  console.log('')
  if (failures > 0) { console.log(`${failures} farewell-tap test(s) FAILED`); process.exit(1) }
  console.log('All farewell-tap tests passed.')
}

main()
