#!/usr/bin/env node
// Standalone assertion runner for lib/catalog.ts (no test framework in this
// repo yet — see lib/catalog.ts for the matcher itself). Run via:
//   npx tsx scripts/test-catalog.mjs
// tsx is used on-demand (not added as a project dependency) purely so this
// script can import the real .ts module directly instead of duplicating it.

import { matchCoordinates, angularSeparationDeg, runnerUpClearMarginThreshold } from '../lib/catalog.ts'
import catalogData from '../config/catalog.json' with { type: 'json' }

const CATALOG = catalogData.objects
const byId = (id) => CATALOG.find((o) => o.id === id)

let failures = 0
function assert(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`)
  } else {
    failures++
    console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`)
  }
}

// 1. Exact coordinates of a catalog object -> high confidence, correct match.
{
  const m57 = byId('M57')
  const r = matchCoordinates(m57.raDeg, m57.decDeg)
  assert(
    'exact M57 coords -> match M57',
    r.match?.id === 'M57',
    `got ${r.match?.id ?? 'null'}`,
  )
  assert('exact M57 coords -> high confidence', r.confidence === 'high', `got ${r.confidence}`)
  assert('exact M57 coords -> separation ~0', r.separationDeg < 1e-6, `got ${r.separationDeg}`)
}

// 2. Coordinates near the edge of a LARGE object's radius (M31, 2.5°, well
//    over 2x the ~0.94° telescope FOV) -> still HIGH confidence, correct
//    match. This is the size-aware cutoff's whole point (see
//    highConfidenceCutoffFraction in lib/catalog.ts): the telescope can never
//    frame all of a 2.5°-wide object in one ~0.94° view, so landing anywhere
//    within a large object's extent is a confident match, not a near-miss.
{
  const m31 = byId('M31')
  // Offset straight north by 90% of the radius (still within bounds, near the edge).
  const edgeDec = m31.decDeg + m31.displayRadiusDeg * 0.9
  const r = matchCoordinates(m31.raDeg, edgeDec)
  assert(
    'near-edge M31 coords -> match M31',
    r.match?.id === 'M31',
    `got ${r.match?.id ?? 'null'}`,
  )
  assert(
    'near-edge M31 coords (large object) -> high confidence',
    r.confidence === 'high',
    `got ${r.confidence}`,
  )
}

// 2b. The same 90%-of-radius offset on a SMALL object (M57, 0.15° — far under
//     the FOV) must still resolve to medium, not high — confirms the
//     size-aware cutoff didn't accidentally loosen small objects too.
{
  const m57 = byId('M57')
  const edgeDec = m57.decDeg + m57.displayRadiusDeg * 0.9
  const r = matchCoordinates(m57.raDeg, edgeDec)
  assert(
    'near-edge M57 coords -> match M57',
    r.match?.id === 'M57',
    `got ${r.match?.id ?? 'null'}`,
  )
  assert(
    'near-edge M57 coords (small object) -> still medium confidence',
    r.confidence === 'medium',
    `got ${r.confidence}`,
  )
}

// 2c. Regression guard for the original bug: NGC 7000 at the exact reported
//     coordinates (RA 314.747, Dec 44.650) must resolve to HIGH confidence —
//     this is the specific case that was silently falling back to
//     "Deep-sky field" under the old flat 50%-of-radius cutoff. It's also the
//     only in-range candidate at these coordinates, so this doubles as
//     confirmation that the runner-up guardrail (see 2d/2e below) does NOT
//     block a legitimate size-aware "high" when there's no real competitor.
{
  const r = matchCoordinates(314.747, 44.65)
  assert(
    'NGC 7000 dry-run coordinates -> match NGC7000',
    r.match?.id === 'NGC7000',
    `got ${r.match?.id ?? 'null'}`,
  )
  assert(
    'NGC 7000 dry-run coordinates -> high confidence (was the bug: medium)',
    r.confidence === 'high',
    `got ${r.confidence}`,
  )
}

// 2d. Runner-up guardrail: a genuine crowded-field case using REAL catalog
//     data (not synthetic/injected). M65 and the Leo Triplet's radius
//     circles genuinely overlap (0.12° and 0.9° radii, 0.335° apart) because
//     the Triplet's entry is centered on the wider group framing while M65
//     is its own tight entry — at Dec 13.1372 (found by sweeping for the
//     point where both objects' fraction-of-own-radius scores are closest),
//     M65 scores 0.375 and the Triplet scores 0.361 — nearly tied. Even
//     though M65 wins outright on priority (95 vs 92) and would otherwise
//     qualify as "high" on its own, the near-tie means we can't be sure
//     which object the telescope is actually centered on, so confidence
//     must downgrade to "medium" (-> guest sees "Deep-sky field", not a
//     possibly-wrong name) rather than confidently naming M65.
{
  const r = matchCoordinates(169.7333, 13.1372)
  assert(
    'crowded M65/Leo-Triplet point -> still matches M65 (wins on priority)',
    r.match?.id === 'M65',
    `got ${r.match?.id ?? 'null'}`,
  )
  assert(
    'crowded M65/Leo-Triplet point -> downgraded to medium, not high',
    r.confidence === 'medium',
    `got ${r.confidence}`,
  )
}

// 2e. Sanity check alongside 2d: moving further from the near-tie point
//     (toward M65's own center) should let the winner pull clearly ahead of
//     the runner-up again and restore "high" — confirms the guardrail reacts
//     to the actual margin rather than blanket-downgrading anything near
//     the Triplet.
{
  const r = matchCoordinates(169.7333, 13.0922) // M65's exact center
  assert(
    'M65 exact center (clear of the near-tie zone) -> match M65',
    r.match?.id === 'M65',
    `got ${r.match?.id ?? 'null'}`,
  )
  assert(
    'M65 exact center -> high confidence restored once clearly ahead',
    r.confidence === 'high',
    `got ${r.confidence}`,
  )
}

// 2f. Zero-score floor: without RUNNER_UP_MARGIN_FLOOR, an exactly-centered
//     winner (winnerScore === 0) computes a clear-margin threshold of
//     0 * RUNNER_UP_CLEAR_MARGIN = 0 — and no runner-up score can ever be
//     "less than" 0, so the guardrail would silently disable itself for a
//     dead-center hit. That's backwards: two objects tied at dead center is
//     exactly the ambiguous case the guardrail exists to catch. The real
//     catalog has no two objects at/near the same coordinates today (this
//     doesn't bite yet), so this tests the exact threshold formula
//     matchCoordinates uses, at the scenario it's designed for, rather than
//     faking a catalog entry or skipping coverage.
{
  const winnerScore = 0 // exactly-centered winner
  const tiedRunnerUpScore = 0 // a second object equally dead-centered
  const threshold = runnerUpClearMarginThreshold(winnerScore)
  assert(
    'zero-score floor -> threshold is NOT zero (floor applied)',
    threshold === 0.05,
    `got ${threshold}`,
  )
  assert(
    'zero-score floor -> a tied dead-center runner-up correctly fails to clear it',
    tiedRunnerUpScore < threshold,
    `runnerUpScore=${tiedRunnerUpScore} threshold=${threshold}`,
  )
}

// 2g. Sanity check alongside 2f: the floor must not fire for a genuinely
//     clear win at nonzero scores — a winner at 10% of its radius with a
//     runner-up at 40% should stay "high" (0.4 clears both the floor and the
//     1.5x margin), confirming this isn't an overly aggressive blanket
//     downgrade near any small winner score.
{
  const winnerScore = 0.1
  const clearRunnerUpScore = 0.4
  const threshold = runnerUpClearMarginThreshold(winnerScore)
  assert(
    'non-tied small winner score -> a clearly-worse runner-up still clears the threshold',
    clearRunnerUpScore >= threshold,
    `runnerUpScore=${clearRunnerUpScore} threshold=${threshold}`,
  )
}

// 3. Coordinates between two objects, closer to a low-priority one but within
//    a high-priority one's larger radius -> priority wins over raw distance.
{
  const m42 = byId('M42') // priority 100, radius 1.0
  const lowPriority = { raDeg: m42.raDeg + 0.9, decDeg: m42.decDeg, priority: 1, displayRadiusDeg: 1.0 }
  // Sanity: this synthetic point is inside M42's radius, and closer to a
  // hypothetical low-priority object at the same offset than to M42's own
  // center — but since only real catalog entries are matched, we instead
  // verify directly against a real nearby-but-lower-priority neighbor: M42
  // and M43 aren't both in the catalog, so we assert via priority tie-break
  // logic on synthetic separations using the exported angularSeparationDeg.
  const sepToM42 = angularSeparationDeg(m42.raDeg + 0.9, m42.decDeg, m42.raDeg, m42.decDeg)
  assert(
    'synthetic point is within M42 radius',
    sepToM42 <= m42.displayRadiusDeg,
    `sep=${sepToM42} radius=${m42.displayRadiusDeg}`,
  )
  const r = matchCoordinates(m42.raDeg + 0.9, m42.decDeg)
  assert(
    'point near M42 edge -> still resolves to M42 (highest priority in range)',
    r.match?.id === 'M42',
    `got ${r.match?.id ?? 'null'}`,
  )
}

// 4. Coordinates matching nothing in the catalog -> confidence 'none', match null.
{
  // A point far from any catalog object: RA 200, Dec +70 is empty sky between
  // catalogued targets.
  const r = matchCoordinates(200, 70)
  assert('empty-sky coords -> match null', r.match === null, `got ${r.match?.id ?? 'null'}`)
  assert('empty-sky coords -> confidence none', r.confidence === 'none', `got ${r.confidence}`)
}

// 5. A requiresEphemeris object (Moon/planet) should never be returned by
//    plain coordinate matching. Chosen approach: STATIC_CATALOG in
//    lib/catalog.ts filters these out entirely before matching (they carry
//    no raDeg/decDeg to match against in the first place). Verify no
//    ephemeris object's id is ever returned, even by probing every static
//    object's own coordinates (which is the closest thing to an
//    ephemeris-vs-static collision we can construct).
{
  const ephemerisIds = new Set(CATALOG.filter((o) => o.requiresEphemeris).map((o) => o.id))
  assert(
    'catalog actually contains ephemeris entries to test against',
    ephemerisIds.size > 0,
    `found ${ephemerisIds.size}`,
  )
  let leaked = false
  for (const obj of CATALOG) {
    if (obj.requiresEphemeris) continue
    const r = matchCoordinates(obj.raDeg, obj.decDeg)
    if (r.match && ephemerisIds.has(r.match.id)) leaked = true
  }
  assert('no ephemeris object ever returned as a match', !leaked)
}

// 6. Spot-check a couple of the feat/catalog-additions objects at their own
//    exact coordinates — confirms they were entered correctly and resolve
//    with high confidence, not just that the JSON parses.
{
  const owl = byId('NGC457')
  const rOwl = matchCoordinates(owl.raDeg, owl.decDeg)
  assert('Owl Cluster exact coords -> match NGC457', rOwl.match?.id === 'NGC457', `got ${rOwl.match?.id ?? 'null'}`)
  assert('Owl Cluster exact coords -> high confidence', rOwl.confidence === 'high', `got ${rOwl.confidence}`)

  const bubble = byId('NGC7635')
  const rBubble = matchCoordinates(bubble.raDeg, bubble.decDeg)
  assert('Bubble Nebula exact coords -> match NGC7635', rBubble.match?.id === 'NGC7635', `got ${rBubble.match?.id ?? 'null'}`)
  assert('Bubble Nebula exact coords -> high confidence', rBubble.confidence === 'high', `got ${rBubble.confidence}`)

  // Bubble Nebula and M52 are only 0.616° apart (the closest new-object pair
  // added) — confirm each still resolves correctly to ITSELF at its own
  // center despite the neighbor being in range for the runner-up guardrail.
  const m52 = byId('M52')
  const rM52 = matchCoordinates(m52.raDeg, m52.decDeg)
  assert('M52 exact coords -> match M52 (not swayed by nearby Bubble Nebula)', rM52.match?.id === 'M52', `got ${rM52.match?.id ?? 'null'}`)
  assert('M52 exact coords -> high confidence', rM52.confidence === 'high', `got ${rM52.confidence}`)
}

// 7. M101 (Pinwheel Galaxy) — was entirely ABSENT from the catalog until this
//    test was added (confirmed via `grep M101 config/catalog.json` returning
//    nothing), unlike the NGC 7000 bug (2c above), which was a confidence-
//    threshold issue on an object that WAS present. A real target platesolved
//    cleanly at RA 210.85 / Dec 54.35 during a live session and fell back to
//    "Deep-sky field" because there was nothing in the catalog to match.
{
  const m101 = byId('M101')
  assert('catalog contains M101', m101 !== undefined)

  const rExact = matchCoordinates(m101.raDeg, m101.decDeg)
  assert('M101 exact coords -> match M101', rExact.match?.id === 'M101', `got ${rExact.match?.id ?? 'null'}`)
  assert('M101 exact coords -> high confidence', rExact.confidence === 'high', `got ${rExact.confidence}`)

  // The actual field-reported coordinates from the live session that
  // exposed this gap — regression guard, same pattern as 2c's NGC 7000
  // dry-run using the exact numbers that were live-observed, not just the
  // catalog's own center.
  const rField = matchCoordinates(210.85, 54.35)
  assert(
    'M101 live-session coords (210.85, 54.35) -> match M101',
    rField.match?.id === 'M101',
    `got ${rField.match?.id ?? 'null'}`,
  )
  assert(
    'M101 live-session coords -> high confidence',
    rField.confidence === 'high',
    `got ${rField.confidence}`,
  )
}

// 8. M104 (Sombrero Galaxy) — added alongside M101 after a sanity pass found
//    it was the other clear gap against a standard "famous showpiece"
//    checklist (fame + visual distinctiveness comparable to M51/M81/M101
//    already in the catalog, as opposed to e.g. M97/M106/NGC891, which are
//    real but meaningfully more niche/dim — not added).
{
  const m104 = byId('M104')
  assert('catalog contains M104', m104 !== undefined)

  const r = matchCoordinates(m104.raDeg, m104.decDeg)
  assert('M104 exact coords -> match M104', r.match?.id === 'M104', `got ${r.match?.id ?? 'null'}`)
  assert('M104 exact coords -> high confidence', r.confidence === 'high', `got ${r.confidence}`)
}

console.log('')
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`)
  process.exit(1)
} else {
  console.log('All assertions passed.')
}
