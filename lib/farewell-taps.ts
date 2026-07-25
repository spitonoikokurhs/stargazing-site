// The pure tap → state decision at the core of the UFO farewell easter egg,
// extracted from FarewellAegeanUfo's click handler so its terminal guarantee is
// directly unit-testable (scripts/test-farewell-taps.mjs) rather than mirrored
// in a test. The component wires the real DOM/animation side-effects around the
// verdict this returns; the load-bearing RULES live here:
//
//   - Every tap counts (no tap is ever swallowed by an in-flight spin) until
//     the finale fires — that's the "rapid tap must reach the finale" fix.
//   - The finale fires exactly once, when the streak first reaches the
//     threshold.
//   - Once the finale has fired, it is TERMINAL: every subsequent tap is inert,
//     forever, no replay. (Same property the static tier has via staticRevealed.)

export const FAREWELL_TAP_THRESHOLD = 5 // TAP_TIER_3 — do not change without product sign-off

export type FarewellTapState = {
  count: number
  // Set true the instant the finale fires; NEVER reset. Blocks all further taps.
  finaleCompleted: boolean
}

export type FarewellTapResult = {
  state: FarewellTapState
  // 'ignored'      — post-finale (terminal): nothing happens.
  // 'counted'      — the tap advanced the streak but did not (yet) fire.
  // 'finale'       — THIS tap reached the threshold and fired the one-time finale.
  action: 'ignored' | 'counted' | 'finale'
}

export function initialTapState(): FarewellTapState {
  return { count: 0, finaleCompleted: false }
}

// Given the current state and a tap, return the next state + what happens.
// Pure: no time, no DOM, no randomness. `finaleRunning` (the mid-animation gate
// in the component) is deliberately NOT modeled here — it only affects
// animation re-triggering, never whether a tap counts or whether the finale is
// terminal, which are the properties under test.
export function tap(state: FarewellTapState, threshold: number = FAREWELL_TAP_THRESHOLD): FarewellTapResult {
  // TERMINAL: once the finale has fired, every further tap is inert.
  if (state.finaleCompleted) {
    return { state, action: 'ignored' }
  }
  const count = state.count + 1
  if (count >= threshold) {
    // Fire the one-time finale and latch terminal.
    return { state: { count, finaleCompleted: true }, action: 'finale' }
  }
  return { state: { count, finaleCompleted: false }, action: 'counted' }
}

// The idle-reset the component's timer performs between streaks (before the
// finale). Deliberately CANNOT clear finaleCompleted — a reset after the finale
// must not re-open replay. Exposed so the test can prove exactly that.
export function idleReset(state: FarewellTapState): FarewellTapState {
  if (state.finaleCompleted) return state // terminal survives any reset
  return { count: 0, finaleCompleted: false }
}
