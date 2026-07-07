#!/usr/bin/env node
// Standalone validation runner for lib/detect-transition.ts. Run via:
//   npx tsx scripts/test-detect-transition.mjs
//
// detectObservationTransition is validated by REPLAYING two real telescope
// sessions frame-by-frame (scripts/fixtures/astir-2026-07-06.json, dumped
// verbatim from Postgres; scripts/fixtures/oku-2026-07-07.json, transcribed
// from the real relay debug log for 2026-07-07 at OKU Kos) and asserting the
// transition call at every known reset/non-reset point in each session.
//
// assessAstrometryFreshness is validated only against SYNTHETIC fixtures
// (see the bottom section) — the relay does not yet forward a real
// timestamp/age value in production (confirmed: as of the Astir/OKU sessions
// above, ingested metadata has no such field), so this function is
// UNVALIDATED against real data. Revisit once a real sample lands.

import { detectObservationTransition, assessAstrometryFreshness } from '../lib/detect-transition.ts'
import { readFileSync } from 'node:fs'

let failures = 0
function assert(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`)
  } else {
    failures++
    console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`)
  }
}

function loadFixture(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url)))
}

// ---------------------------------------------------------------------------
// 1. detectObservationTransition — replay real OKU 2026-07-07 session
// ---------------------------------------------------------------------------
{
  const frames = loadFixture('./fixtures/oku-2026-07-07.json')
  console.log(`\n--- OKU 2026-07-07: replaying ${frames.length} real frames ---`)

  // Known reset points by index (0-based), from manual analysis of the log
  // (verified programmatically against the fixture's own "RESET" notes).
  const expectedNew = new Set([34, 53, 64]) // 1590->10, 1070->20, 710->100
  let prev = null
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const result = detectObservationTransition(prev, {
      totalAccumulatedTime: f.totalAccumulatedTime,
      raDegrees: f.raDegrees,
      decDegrees: f.decDegrees,
    })
    if (expectedNew.has(i)) {
      assert(
        `OKU frame ${i} (${f.capturedAt}) -> NEW (${f.note ?? ''})`,
        result.transition === 'new',
        `got ${result.transition}: ${result.reason}`,
      )
    } else if (i > 0) {
      assert(
        `OKU frame ${i} (${f.capturedAt}) -> SAME (${f.note ?? 'steady state'})`,
        result.transition === 'same',
        `got ${result.transition}: ${result.reason}`,
      )
    }
    prev = { totalAccumulatedTime: f.totalAccumulatedTime, raDegrees: f.raDegrees, decDegrees: f.decDegrees }
  }

  // The specific claim in the user's brief: the frozen-astrometry episode
  // (frames 35-44, ra/dec identical throughout) must NOT confuse detection —
  // frame 35 (the reset into it) is NEW, every frame after within it is SAME,
  // and detection never wavers despite raDegrees/decDegrees never changing
  // for the entire 12-minute span.
  {
    const staleEpisode = frames.slice(53, 64) // indices 53-63: the reset frame through the last frozen-coord frame (11 polls)
    const allSameRaDec = staleEpisode.every(
      (f) => f.raDegrees === staleEpisode[0].raDegrees && f.decDegrees === staleEpisode[0].decDegrees,
    )
    assert('OKU stale-astrometry episode: fixture really is coordinate-frozen across all 11 polls', allSameRaDec)

    let p = { totalAccumulatedTime: frames[52].totalAccumulatedTime, raDegrees: frames[52].raDegrees, decDegrees: frames[52].decDegrees }
    const transitions = []
    for (const f of staleEpisode) {
      const r = detectObservationTransition(p, { totalAccumulatedTime: f.totalAccumulatedTime, raDegrees: f.raDegrees, decDegrees: f.decDegrees })
      transitions.push(r.transition)
      p = { totalAccumulatedTime: f.totalAccumulatedTime, raDegrees: f.raDegrees, decDegrees: f.decDegrees }
    }
    assert(
      'OKU stale-astrometry episode: exactly one NEW (the reset) then all SAME, despite frozen ra/dec throughout',
      transitions[0] === 'new' && transitions.slice(1).every((t) => t === 'same'),
      `got [${transitions.join(', ')}]`,
    )
  }
}

// ---------------------------------------------------------------------------
// 2. detectObservationTransition — replay real Astir 2026-07-06 session
// ---------------------------------------------------------------------------
{
  const frames = loadFixture('./fixtures/astir-2026-07-06.json')
  console.log(`\n--- Astir 2026-07-06: replaying ${frames.length} real frames ---`)

  let prev = null
  let newCount = 0
  const newIndices = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const result = detectObservationTransition(prev, {
      totalAccumulatedTime: f.totalAccumulatedTime,
      raDegrees: f.raDegrees,
      decDegrees: f.decDegrees,
    })
    if (result.transition === 'new') {
      newCount++
      newIndices.push(i)
    }
    prev = { totalAccumulatedTime: f.totalAccumulatedTime, raDegrees: f.raDegrees, decDegrees: f.decDegrees }
  }
  console.log(`  NEW fired at indices: ${newIndices.join(', ')}`)

  // Frame 0 is always 'new' (no open observation). Programmatic inspection
  // of every backward totalAccumulatedTime drop in the real Astir data
  // (see the analysis in lib/detect-transition.ts's RESET_DROP_THRESHOLD_S
  // comment) found exactly 7 further genuine resets after frame 0 — 8
  // objects observed total across the ~2h session. This asserts the COUNT
  // matches that analysis — if the underlying fixture or the detector's
  // threshold ever changes, this is the tripwire. (An earlier version of
  // this test asserted 7 total based on manual log reading that missed one
  // real retarget at index 3 — corrected after the programmatic re-check.)
  assert('Astir session: exactly 8 total observations detected (1 initial + 7 real retargets)', newCount === 8, `got ${newCount}`)

  // The specific non-firing case flagged during log review: a long silent
  // gap (18:38:38 -> 18:48:21, ~10 real minutes) where totalAccumulatedTime
  // continued climbing (760 -> 1310) — must NOT be treated as a new
  // observation just because of the wall-clock gap.
  {
    const before = frames.find((f) => f.totalAccumulatedTime === 760)
    const after = frames.find((f) => f.totalAccumulatedTime === 1310)
    const r = detectObservationTransition(
      { totalAccumulatedTime: before.totalAccumulatedTime, raDegrees: before.raDegrees, decDegrees: before.decDegrees },
      { totalAccumulatedTime: after.totalAccumulatedTime, raDegrees: after.raDegrees, decDegrees: after.decDegrees },
    )
    assert(
      'Astir: long wall-clock gap with clock still climbing (760s -> 1310s) -> SAME',
      r.transition === 'same',
      `got ${r.transition}: ${r.reason}`,
    )
  }

  // The specific re-centering-nudge case: 20:16:30 (80s, 315.70/44.48) ->
  // 20:17:36 (30s, 314.77/44.67) is ACTUALLY a real reset (80->30 clears the
  // threshold) tangled with a small coordinate move — confirms the function
  // correctly reads this as NEW via the clock, not confused by the modest
  // (~0.9deg) coordinate distance being far below COORDINATE_JUMP_DEG.
  {
    const r = detectObservationTransition(
      { totalAccumulatedTime: 80, raDegrees: 315.7000122070312, decDegrees: 44.47722244262695 },
      { totalAccumulatedTime: 30, raDegrees: 314.7654113769531, decDegrees: 44.66972351074219 },
    )
    assert(
      'Astir: 80s->30s reset with a small coordinate move -> NEW (via clock, not coordinate)',
      r.transition === 'new',
      `got ${r.transition}: ${r.reason}`,
    )
  }
}

// ---------------------------------------------------------------------------
// 3. detectObservationTransition — synthetic edge cases not present in
//    either real session, but worth locking down explicitly
// ---------------------------------------------------------------------------
{
  console.log('\n--- Synthetic edge cases ---')

  assert(
    'no open observation -> NEW',
    detectObservationTransition(null, { totalAccumulatedTime: 5, raDegrees: 10, decDegrees: 10 }).transition === 'new',
  )

  assert(
    'totalAccumulatedTime missing on both sides, coords identical -> uncertain (not same)',
    detectObservationTransition(
      { totalAccumulatedTime: null, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: null, raDegrees: 10, decDegrees: 10 },
    ).transition === 'uncertain',
  )

  assert(
    'totalAccumulatedTime missing on both sides, coords jumped >5deg -> uncertain',
    detectObservationTransition(
      { totalAccumulatedTime: undefined, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: undefined, raDegrees: 30, decDegrees: 10 },
    ).transition === 'uncertain',
  )

  assert(
    'small monotonic increase (subExposureTime tick) -> SAME',
    detectObservationTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 110, raDegrees: 10, decDegrees: 10 },
    ).transition === 'same',
  )

  assert(
    'tiny same-value re-read jitter under the low floor (100->98, delta 2) -> SAME, not a false reset or uncertain',
    detectObservationTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 98, raDegrees: 10, decDegrees: 10 },
    ).transition === 'same',
    'delta must clear RESET_UNCERTAIN_DROP_THRESHOLD_S (5s) to count as a real drop at all',
  )

  assert(
    'a small drop under the low floor, below the reset threshold (100->95, delta 5) -> UNCERTAIN',
    detectObservationTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 95, raDegrees: 10, decDegrees: 10 },
    ).transition === 'uncertain',
    'a drop this small could be device jitter rather than a genuine retarget — reported uncertain, not silently trusted as NEW (a false positive would wrongly reset the guest-facing milestone toggle mid-stack) or silently folded into SAME',
  )

  assert(
    'boundary: drop just under the reset threshold (100->71, delta 29) -> UNCERTAIN',
    detectObservationTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 71, raDegrees: 10, decDegrees: 10 },
    ).transition === 'uncertain',
  )

  assert(
    'boundary: drop exactly at the reset threshold (100->70, delta 30) -> NEW',
    detectObservationTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 70, raDegrees: 10, decDegrees: 10 },
    ).transition === 'new',
  )

  assert(
    'real Astir case with margin: 65->30 (delta 35) -> NEW',
    detectObservationTransition(
      { totalAccumulatedTime: 65, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 30, raDegrees: 10, decDegrees: 10 },
    ).transition === 'new',
  )

  assert(
    'real Astir case with margin: 80->30 (delta 50) -> NEW',
    detectObservationTransition(
      { totalAccumulatedTime: 80, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 30, raDegrees: 10, decDegrees: 10 },
    ).transition === 'new',
  )

  assert(
    'drop clears the reset threshold but lands ABOVE the low floor (500->200, delta 300) -> SAME, not a reset',
    detectObservationTransition(
      { totalAccumulatedTime: 500, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 200, raDegrees: 10, decDegrees: 10 },
    ).transition === 'same',
    'a real reset lands low AND drops a lot — a big drop landing high is a stacker readjustment, not a retarget',
  )

  assert(
    'boundary: reset landing exactly at the low floor - 1 (119s) with a qualifying drop -> NEW',
    detectObservationTransition(
      { totalAccumulatedTime: 500, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 119, raDegrees: 10, decDegrees: 10 },
    ).transition === 'new',
  )
}

// ---------------------------------------------------------------------------
// 4. assessAstrometryFreshness — SYNTHETIC fixtures only (see the module's
//    own UNVALIDATED disclaimer; no real relay-reported timestamp/age exists
//    yet to replay).
// ---------------------------------------------------------------------------
{
  console.log('\n--- assessAstrometryFreshness (synthetic, UNVALIDATED against real data) ---')

  const now = Date.parse('2026-07-07T23:00:00Z')

  assert(
    'relay-reported age, well under threshold -> fresh',
    assessAstrometryFreshness({ astrometryTimestamp: null, astrometryAgeSeconds: 5, now }).freshness === 'fresh',
  )
  assert(
    'relay-reported age, well over threshold -> stale',
    assessAstrometryFreshness({ astrometryTimestamp: null, astrometryAgeSeconds: 700, now }).freshness === 'stale',
  )
  assert(
    'relay-reported negative age (clock skew) -> unknown',
    assessAstrometryFreshness({ astrometryTimestamp: null, astrometryAgeSeconds: -3, now }).freshness === 'unknown',
  )
  assert(
    'ISO timestamp 5s before now -> fresh',
    assessAstrometryFreshness({ astrometryTimestamp: new Date(now - 5000).toISOString(), now }).freshness === 'fresh',
  )
  assert(
    'ISO timestamp 700s before now -> stale',
    assessAstrometryFreshness({ astrometryTimestamp: new Date(now - 700_000).toISOString(), now }).freshness === 'stale',
  )
  assert(
    'epoch SECONDS timestamp, 5s before now -> fresh',
    assessAstrometryFreshness({ astrometryTimestamp: Math.floor((now - 5000) / 1000), now }).freshness === 'fresh',
  )
  assert(
    'epoch MILLISECONDS timestamp, 5s before now -> fresh',
    assessAstrometryFreshness({ astrometryTimestamp: now - 5000, now }).freshness === 'fresh',
  )
  assert(
    'unparseable timestamp string -> unknown',
    assessAstrometryFreshness({ astrometryTimestamp: 'not-a-date', now }).freshness === 'unknown',
  )
  assert(
    'no timestamp and no age -> unknown',
    assessAstrometryFreshness({ astrometryTimestamp: null, now }).freshness === 'unknown',
  )
  assert(
    'timestamp in the future (clock skew) -> unknown',
    assessAstrometryFreshness({ astrometryTimestamp: new Date(now + 60_000).toISOString(), now }).freshness === 'unknown',
  )

  // Mirrors the OKU real-world shape IF the relay had forwarded a frozen
  // timestamp alongside the frozen coordinate — since the real log never
  // captured the actual value, this is a plausible reconstruction, not a
  // replay: a timestamp from the FIRST poll of the stale episode (22:49:45),
  // still being reported unchanged 12 minutes later.
  {
    const episodeStart = Date.parse('2026-07-07T22:49:45Z')
    const episodeEnd = Date.parse('2026-07-07T23:01:50Z')
    const r = assessAstrometryFreshness({ astrometryTimestamp: new Date(episodeStart).toISOString(), now: episodeEnd })
    assert(
      'reconstructed OKU-shaped case: a timestamp frozen at episode start, checked 12min later -> stale',
      r.freshness === 'stale',
      `got ${r.freshness}, age ${r.ageSeconds}`,
    )
  }
}

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
