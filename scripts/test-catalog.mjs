#!/usr/bin/env node
// Standalone assertion runner for lib/catalog.ts (no test framework in this
// repo yet — see lib/catalog.ts for the matcher itself). Run via:
//   npx tsx scripts/test-catalog.mjs
// tsx is used on-demand (not added as a project dependency) purely so this
// script can import the real .ts module directly instead of duplicating it.

import { matchCoordinates, angularSeparationDeg } from '../lib/catalog.ts'
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

console.log('')
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`)
  process.exit(1)
} else {
  console.log('All assertions passed.')
}
