#!/usr/bin/env node
// Standalone validation runner for lib/detect-transition.ts. Run via:
//   npx tsx scripts/test-detect-transition.mjs
//
// detectTransition is validated by REPLAYING two real telescope sessions
// frame-by-frame (scripts/fixtures/astir-2026-07-06.json, dumped verbatim
// from Postgres; scripts/fixtures/oku-2026-07-07.json, transcribed from the
// real relay debug log for 2026-07-07 at OKU Kos) and asserting the
// transition call at every known reset/non-reset point in each session. The
// replay loop below implements the CALLER CONTRACT documented in
// lib/detect-transition.ts: `previous` only advances past frames with usable
// totalAccumulatedTime, and lastStackRunStartedAtMs is tracked across calls
// to drive the settling window.
//
// assessAstrometryFreshness is validated only against SYNTHETIC fixtures
// (see the bottom section) — the relay does not yet forward a real
// timestamp/age value in production (confirmed: as of the Astir/OKU sessions
// above, ingested metadata has no such field), so this function is
// UNVALIDATED against real data. Revisit once a real sample lands.

import { detectTransition, assessAstrometryFreshness } from '../lib/detect-transition.ts'
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

function isUsable(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

// Replays a fixture end-to-end following the caller contract: `previous`
// only advances past frames with usable totalAccumulatedTime;
// lastStackRunStartedAtMs updates whenever stackRun 'new' fires. Returns the
// per-frame results array (same length/order as the input frames).
function replay(frames) {
  let previous = null
  let lastStackRunStartedAtMs = null
  const results = []

  for (const f of frames) {
    const nowMs = Date.parse(f.capturedAt)
    const current = { totalAccumulatedTime: f.totalAccumulatedTime, raDegrees: f.raDegrees, decDegrees: f.decDegrees }
    const result = detectTransition(previous, current, { nowMs, lastStackRunStartedAtMs })
    results.push(result)

    if (result.stackRun === 'new') lastStackRunStartedAtMs = nowMs
    if (isUsable(current.totalAccumulatedTime)) previous = current
    // else: caller contract — do NOT advance `previous` past an unusable frame
  }
  return results
}

// ---------------------------------------------------------------------------
// 1. detectTransition — replay real OKU 2026-07-07 session
// ---------------------------------------------------------------------------
{
  const frames = loadFixture('./fixtures/oku-2026-07-07.json')
  console.log(`\n--- OKU 2026-07-07: replaying ${frames.length} real frames ---`)
  const results = replay(frames)

  // Known reset points by index (0-based), from manual analysis of the log
  // (verified programmatically against the fixture's own "RESET" notes).
  // None of these fall within 90s of a PRIOR reset in this real session (the
  // gaps between them are all many minutes), so the settling window should
  // never suppress any of them.
  const expectedNew = new Set([34, 53, 64]) // 1590->10, 1070->20, 710->100

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const r = results[i]
    if (expectedNew.has(i)) {
      assert(
        `OKU frame ${i} (${f.capturedAt}) -> stackRun NEW (${f.note ?? ''})`,
        r.stackRun === 'new',
        `got ${r.stackRun}: ${r.reason}`,
      )
    } else if (i > 0) {
      assert(
        `OKU frame ${i} (${f.capturedAt}) -> stackRun SAME (${f.note ?? 'steady state'})`,
        r.stackRun === 'same',
        `got ${r.stackRun}: ${r.reason}`,
      )
    }
  }

  // The specific claim in the user's brief: the frozen-astrometry episode
  // (indices 53-63, ra/dec identical throughout) must NOT confuse stackRun
  // detection — index 53 (the reset into it) is NEW, every frame after
  // within it is SAME, despite raDegrees/decDegrees never changing for the
  // entire 12-minute span.
  {
    const staleEpisode = frames.slice(53, 64)
    const allSameRaDec = staleEpisode.every(
      (f) => f.raDegrees === staleEpisode[0].raDegrees && f.decDegrees === staleEpisode[0].decDegrees,
    )
    assert('OKU stale-astrometry episode: fixture really is coordinate-frozen across all 11 polls', allSameRaDec)

    const episodeResults = results.slice(53, 64)
    assert(
      'OKU stale-astrometry episode: exactly one stackRun NEW (the reset) then all SAME, despite frozen ra/dec throughout',
      episodeResults[0].stackRun === 'new' && episodeResults.slice(1).every((r) => r.stackRun === 'same'),
      `got [${episodeResults.map((r) => r.stackRun).join(', ')}]`,
    )
    // skyTarget: 'new_candidate' fires alongside the stackRun reset (index
    // 53), then 'unknown' for the rest — never 'same', since this function
    // has no positive basis to assert the target held steady without a
    // validated freshness check (and in this specific episode, the
    // coordinate WAS frozen/stale — 'unknown' is the honest answer either way).
    assert(
      'OKU stale-astrometry episode: skyTarget is new_candidate at the reset, unknown thereafter (never a false "same")',
      episodeResults[0].skyTarget === 'new_candidate' && episodeResults.slice(1).every((r) => r.skyTarget === 'unknown'),
      `got [${episodeResults.map((r) => r.skyTarget).join(', ')}]`,
    )
  }
}

// ---------------------------------------------------------------------------
// 2. detectTransition — replay real Astir 2026-07-06 session
// ---------------------------------------------------------------------------
{
  const frames = loadFixture('./fixtures/astir-2026-07-06.json')
  console.log(`\n--- Astir 2026-07-06: replaying ${frames.length} real frames ---`)
  const results = replay(frames)

  const newIndices = results.map((r, i) => (r.stackRun === 'new' ? i : null)).filter((i) => i !== null)
  console.log(`  stackRun NEW fired at indices: ${newIndices.join(', ')}`)

  // Programmatic inspection of every backward totalAccumulatedTime drop in
  // the real Astir data found exactly 7 genuine resets after frame 0 (8
  // stack runs total across the ~2h session). None of these real resets
  // fall within 90s of each other (the closest pair is minutes apart), so
  // the settling window should not suppress any of them — this assertion
  // is also a tripwire for the settling window accidentally over-suppressing.
  assert(
    'Astir session: exactly 8 total stack runs detected (1 initial + 7 real retargets), settling window does not over-suppress',
    newIndices.length === 8,
    `got ${newIndices.length}`,
  )

  // The specific non-firing case flagged during log review: a long silent
  // gap (18:38:38 -> 18:48:21, ~10 real minutes) where totalAccumulatedTime
  // continued climbing (760 -> 1310) — must NOT be treated as a new stack
  // run just because of the wall-clock gap.
  {
    const beforeIdx = frames.findIndex((f) => f.totalAccumulatedTime === 760)
    const afterIdx = frames.findIndex((f) => f.totalAccumulatedTime === 1310)
    assert(
      'Astir: long wall-clock gap with clock still climbing (760s -> 1310s) -> stackRun SAME',
      results[afterIdx].stackRun === 'same',
      `got ${results[afterIdx].stackRun}: ${results[afterIdx].reason}`,
    )
    assert('fixture sanity: 760s frame precedes 1310s frame', beforeIdx < afterIdx && beforeIdx >= 0 && afterIdx >= 0)
  }

  // The two real resets with modest deltas (65->30 delta 35; 80->30 delta
  // 50) — both must still be caught with margin under the 30s threshold.
  {
    const idx35 = frames.findIndex((f) => f.totalAccumulatedTime === 30 && f.raDegrees === 149.1566619873047)
    const idx50 = frames.findIndex((f) => f.totalAccumulatedTime === 30 && f.raDegrees === 314.7654113769531)
    assert(
      'Astir: real reset 65->30 (delta 35, modest margin over 30s threshold) -> stackRun NEW',
      results[idx35]?.stackRun === 'new',
      `got ${results[idx35]?.stackRun}: ${results[idx35]?.reason}`,
    )
    assert(
      'Astir: real reset 80->30 (delta 50, modest margin over 30s threshold) -> stackRun NEW',
      results[idx50]?.stackRun === 'new',
      `got ${results[idx50]?.stackRun}: ${results[idx50]?.reason}`,
    )
  }
}

// ---------------------------------------------------------------------------
// 3. detectTransition — synthetic edge cases not present in either real
//    session, but worth locking down explicitly
// ---------------------------------------------------------------------------
{
  console.log('\n--- Synthetic edge cases ---')
  const ctx = (nowMs, lastStackRunStartedAtMs = null) => ({ nowMs, lastStackRunStartedAtMs })

  {
    const r = detectTransition(null, { totalAccumulatedTime: 5, raDegrees: 10, decDegrees: 10 }, ctx(1000))
    assert('no previous frame -> stackRun NEW, reason no_previous_frame', r.stackRun === 'new' && r.reason === 'no_previous_frame')
    assert('no previous frame -> skyTarget unknown (nothing to compare against)', r.skyTarget === 'unknown')
  }

  {
    // current totalAccumulatedTime unusable -> uncertain, not silently 'same'.
    const r = detectTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: null, raDegrees: 10, decDegrees: 10 },
      ctx(2000),
    )
    assert('current totalAccumulatedTime null -> stackRun uncertain', r.stackRun === 'uncertain')
  }

  {
    // The exact scenario from the brief: 600 -> null -> 30 must compare 30
    // against 600 (the caller's job, per the contract — simulated here by
    // simply never advancing `previous` past the null frame) and correctly
    // read it as a real reset.
    const previous = { totalAccumulatedTime: 600, raDegrees: 10, decDegrees: 10 }
    // A null frame arrives; per the caller contract `previous` does NOT advance.
    const nullFrameResult = detectTransition(previous, { totalAccumulatedTime: null, raDegrees: 10, decDegrees: 10 }, ctx(3000))
    assert('600 -> null: stackRun uncertain (the null frame itself)', nullFrameResult.stackRun === 'uncertain')
    // Next real frame is compared against the ORIGINAL previous (600), not null.
    const afterNull = detectTransition(previous, { totalAccumulatedTime: 30, raDegrees: 10, decDegrees: 10 }, ctx(4000))
    assert(
      '600 -> null -> 30: compares 30 against 600 (not against null) -> stackRun NEW',
      afterNull.stackRun === 'new',
      `got ${afterNull.stackRun}: ${afterNull.reason}`,
    )
  }

  {
    const r = detectTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 110, raDegrees: 10, decDegrees: 10 },
      ctx(5000),
    )
    assert('small monotonic increase (subExposureTime tick) -> stackRun SAME', r.stackRun === 'same')
  }

  {
    const r = detectTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 98, raDegrees: 10, decDegrees: 10 },
      ctx(6000),
    )
    assert(
      'tiny same-value re-read jitter under the low floor (100->98, delta 2) -> stackRun SAME, not uncertain or new',
      r.stackRun === 'same',
    )
  }

  {
    const r = detectTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 95, raDegrees: 10, decDegrees: 10 },
      ctx(7000),
    )
    assert(
      'a small drop under the low floor, below the reset threshold (100->95, delta 5) -> stackRun UNCERTAIN',
      r.stackRun === 'uncertain',
    )
  }

  {
    const r = detectTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 71, raDegrees: 10, decDegrees: 10 },
      ctx(8000),
    )
    assert('boundary: drop just under the reset threshold (100->71, delta 29) -> stackRun UNCERTAIN', r.stackRun === 'uncertain')
  }

  {
    const r = detectTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 70, raDegrees: 10, decDegrees: 10 },
      ctx(9000),
    )
    assert('boundary: drop exactly at the reset threshold (100->70, delta 30) -> stackRun NEW', r.stackRun === 'new')
  }

  {
    const r = detectTransition(
      { totalAccumulatedTime: 500, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 200, raDegrees: 10, decDegrees: 10 },
      ctx(10000),
    )
    assert(
      'drop clears the reset threshold but lands ABOVE the low floor (500->200, delta 300) -> stackRun SAME, not a reset',
      r.stackRun === 'same',
    )
  }

  {
    const r = detectTransition(
      { totalAccumulatedTime: 500, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 119, raDegrees: 10, decDegrees: 10 },
      ctx(11000),
    )
    assert('boundary: reset landing exactly at the low floor - 1 (119s) with a qualifying drop -> stackRun NEW', r.stackRun === 'new')
  }

  // --- Settling window ---
  // Simulates a bouncy/settling stacker: 100 -> 20 (genuine reset) -> 90 (climbing
  // again, same run) -> 40 (a SECOND apparent reset — 90->40 independently
  // clears the 30s/120s reset rule — but it's really settling noise from the
  // SAME restart, not a fresh retarget). This shape was not observed in
  // either real dataset; it's the specific failure mode the settling window
  // exists to guard against per the product brief.
  {
    const lastReset = 100_000

    const step1 = detectTransition(
      { totalAccumulatedTime: 100, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 20, raDegrees: 10, decDegrees: 10 },
      ctx(lastReset, null),
    )
    assert('settling: initial reset (no prior lastStackRunStartedAtMs) -> stackRun NEW', step1.stackRun === 'new')

    // Climbing normally for a beat (still well inside the settling window).
    const climbing = detectTransition(
      { totalAccumulatedTime: 20, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 90, raDegrees: 10, decDegrees: 10 },
      ctx(lastReset + 20_000, lastReset),
    )
    assert('settling: climbing again after the reset -> stackRun SAME (unaffected by the window)', climbing.stackRun === 'same')

    // A SECOND apparent reset 30s after the first (well inside the 90s
    // window) that would independently qualify (90->40, delta 50, lands
    // under 120s) — no coordinate jump (same ra/dec) -> suppressed to SAME
    // (settling noise from the same restart).
    const step2 = detectTransition(
      { totalAccumulatedTime: 90, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 40, raDegrees: 10, decDegrees: 10 },
      ctx(lastReset + 30_000, lastReset),
    )
    assert(
      'settling: bouncy second reset 30s later (90->40, independently qualifying), no coordinate jump -> suppressed to stackRun SAME',
      step2.stackRun === 'same',
      `got ${step2.stackRun}: ${step2.reason}`,
    )

    // Same shape, but WITH a large coordinate jump -> honored as genuinely NEW.
    const step3 = detectTransition(
      { totalAccumulatedTime: 90, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 40, raDegrees: 40, decDegrees: 10 },
      ctx(lastReset + 30_000, lastReset),
    )
    assert(
      'settling: same shape WITH a large coordinate jump -> honored as stackRun NEW (corroborated)',
      step3.stackRun === 'new',
      `got ${step3.stackRun}: ${step3.reason}`,
    )

    // Same shape, but arriving AFTER the settling window (100s later) -> honored as NEW even with no coordinate jump.
    const step4 = detectTransition(
      { totalAccumulatedTime: 90, raDegrees: 10, decDegrees: 10 },
      { totalAccumulatedTime: 40, raDegrees: 10, decDegrees: 10 },
      ctx(lastReset + 100_000, lastReset),
    )
    assert(
      'settling: same shape arriving after the 90s window has elapsed -> stackRun NEW (window expired)',
      step4.stackRun === 'new',
      `got ${step4.stackRun}: ${step4.reason}`,
    )
  }
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
