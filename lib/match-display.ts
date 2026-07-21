import type { Confidence } from '@/lib/catalog'

// THE single "is this catalog match confident enough to show its name?" policy,
// shared by every guest-facing surface that can put an object NAME in front of
// a guest — the live card (resolveDisplayObject) and the TAPPABLE session-
// history strip (isDisplayableRun / displayObjectForHistoryRun) in
// app/live/LiveView.tsx — so the surfaces can never silently disagree about
// what counts as nameable.
//
// Extracted into its own module (rather than living inside LiveView.tsx) for
// two reasons: (1) it's the correctness-critical seam of the M101 fix, so it
// deserves direct unit coverage — see scripts/test-match-display.mjs; a helper
// buried in a 'use client' component can't be reached by the node test runner;
// (2) it makes the "one policy" claim structural — there is exactly one
// implementation, imported by both consumers.
//
// Inputs are the two OBJECTIVE things the server matcher produces:
//   • confidence          — matchCoordinates' Confidence tier.
//   • hasInRangeRunnerUp  — whether a SECOND catalog object is within its own
//                           display radius of this solve (the "contested field"
//                           fact; see lib/catalog.ts).
//
// Policy:
//   • 'high'   -> always show. Dead-center, unambiguous.
//   • 'medium' -> show ONLY when NOT contested. A 'medium' has two disjoint
//                 causes (see matchCoordinates): (A) off-center of an isolated
//                 object — same object, identity certain, just not centered
//                 (what M101 hit on 2026-07-20; the bug this fix closes was the
//                 old high-only gate hiding it); or (B) a genuine two-candidate
//                 ambiguity, a runner-up within its own radius of the same
//                 solve. hasInRangeRunnerUp separates them: false = case A (safe
//                 to name), true = case B (withhold — a confidently-WRONG name
//                 in front of guests is worse than a nameless "Deep-sky field").
//   • 'low' / 'none' -> never show (not reached for a real match today, but
//                 kept explicit).
//
// Callers pass a boolean; a missing/null contested fact on the wire (older
// server, or a run with no stored value) is resolved to false BY THE CALLER
// before calling here — false being the safe legacy direction (an old server
// naming an ambiguous medium is exactly the pre-fix behavior, no new regression
// beyond what already existed).
export function shouldShowMatchName(confidence: Confidence, hasInRangeRunnerUp: boolean): boolean {
  if (confidence === 'high') return true
  if (confidence === 'medium') return !hasInRangeRunnerUp
  return false
}
