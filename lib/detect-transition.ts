// Pure detection helpers for the stacking-progression feature (see
// docs/PHASE_2_BRIEF.md's T+0/T+60/T+180/T+300 milestones and
// prisma/schema.prisma's Frame.stackMilestone). No I/O, no Prisma, no Redis —
// these only fold telemetry into a decision; a caller (eventually
// app/api/ingest/route.ts) owns persistence. Kept in two SEPARATE functions
// on purpose, because they answer genuinely different questions and are
// consumed differently downstream:
//
//   - detectObservationTransition: "is this the same observation as before,
//     or a new one?" Drives milestone tagging (First/3min/5min/Current) —
//     trust the stack clock regardless of whether astrometry is fresh.
//   - assessAstrometryFreshness: "can raDegrees/decDegrees be trusted right
//     now?" Drives object naming/catalog matching — a stale solve must never
//     be trusted for a guest-facing object name, even mid-observation.
//
// A frame can be a confident NEW OBSERVATION while simultaneously having
// STALE astrometry (see the OKU 2026-07-07 case below) — these are
// independent axes, not one combined signal.

// ---------------------------------------------------------------------------
// detectObservationTransition
// ---------------------------------------------------------------------------

export type ObservationFrameInput = {
  totalAccumulatedTime: number | null | undefined
  raDegrees: number | null | undefined
  decDegrees: number | null | undefined
}

export type TransitionResult = {
  transition: 'same' | 'new' | 'uncertain'
  reason: string
}

// Real telescope behavior this must NOT misfire on (from real Astir/OKU
// session data, see the validation script):
//   - A long wall-clock gap (minutes, e.g. a relay network outage) with
//     totalAccumulatedTime continuing to climb by roughly the elapsed time —
//     the stack kept running unattended. NOT a new observation.
//   - totalAccumulatedTime occasionally ticking by less than real elapsed
//     time (e.g. the stacker dropped a sub-exposure) — still climbing, still
//     the same observation.
//   - A small coordinate correction (a few tenths of a degree, e.g. a
//     re-centering nudge) with totalAccumulatedTime CONTINUING to climb —
//     same observation; astrometry noise/refinement, not a new target.
//   - ra/dec staying byte-identical for 10+ minutes straight while
//     totalAccumulatedTime climbs normally (OKU 22:49:45-23:01:50) — the
//     astrometry is very likely stale (see assessAstrometryFreshness), but
//     that is NOT this function's concern: the accumulated-time trajectory
//     alone already told us this was one continuous observation.
//
// What MUST trigger 'new' (also from real data):
//   - totalAccumulatedTime resetting from a high value to a low one
//     (e.g. 1390 -> 20, or 80 -> 30) — the primary, load-bearing signal.
//     Real observations reset to a small number (subExposureTime or a low
//     multiple of it), never exactly to the operator's literal starting
//     instant, so "low" is judged relative to the previous value, not
//     against a hardcoded floor like 0 or 10.

// A reset counts as "high to low" when the new value is both smaller than the
// previous by at least this many seconds AND itself under this floor.
//
// The low-floor check is what actually does the work: every real reset
// across BOTH real sessions (Astir 2026-07-06, 7 retargets; OKU 2026-07-07,
// 3 retargets — 10 total) landed at or under 100s, while the value being
// reset FROM ranged 65-2010s. Checked exhaustively: not one single real
// same-observation reading in either session ever dropped from its previous
// value AND landed under 120s — so the low-floor condition alone already
// perfectly separates every real reset from every real non-reset in the
// available data.
//
// The drop-threshold guards against device jitter/a corrected re-read being
// misread as a real retarget — a false 'new' here is worse than a false
// 'same', because it would wrongly reset the guest-facing milestone toggle
// mid-stack. Set at 30s: comfortably below both real Astir resets this must
// still catch (65->30, delta 35; 80->30, delta 50) while excluding small
// dips that could plausibly be jitter rather than a genuine reset. An
// earlier version used 5s here (a near-zero noise guard); raised to 30s for
// a stronger conservative margin against a false 'new'. Drops in
// [RESET_UNCERTAIN_DROP_THRESHOLD_S, RESET_DROP_THRESHOLD_S) that land under
// the low floor are reported 'uncertain' rather than silently folded into
// either 'same' or 'new' — see the branch below.
const RESET_DROP_THRESHOLD_S = 30
// Any drop at all (a same-value re-read must not count) landing under the
// low floor, but too small to confidently call a reset (< RESET_DROP_THRESHOLD_S),
// is reported 'uncertain' — neither confidently the same observation nor
// confidently a new one.
const RESET_UNCERTAIN_DROP_THRESHOLD_S = 5
const RESET_LOW_FLOOR_S = 120

// A coordinate move at least this large is treated as informative (see
// coordinateJumpDeg below) — chosen well above real re-centering noise seen
// in the data (largest same-observation nudge: ~0.6deg between two Astir
// polls 66s apart) and well under a genuine cross-sky retarget (the OKU log's
// real target changes were all >15deg apart).
const COORDINATE_JUMP_DEG = 5

// Angular separation in degrees between two ra/dec points (small-angle
// approximation with a cos(dec) correction — matches lib/catalog.ts's
// angularSeparationDeg; duplicated here rather than imported so this module
// has zero dependency on the catalog module, which is about a completely
// different concern).
function angularSeparationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const avgDecRad = ((dec1 + dec2) / 2) * (Math.PI / 180)
  const dRa = (ra1 - ra2) * Math.cos(avgDecRad)
  const dDec = dec1 - dec2
  return Math.sqrt(dRa * dRa + dDec * dDec)
}

// detectObservationTransition decides whether `current`'s telemetry belongs
// to the SAME observation as `previous`, or starts a NEW one.
//
// previous === null means "no open observation" (session start, or the prior
// observation was already closed by other logic, e.g. a rawTargetName
// change per app/api/ingest/route.ts's existing string-compare path) — always
// 'new' in that case, trivially.
//
// Primary signal: totalAccumulatedTime reset from high to low (see
// RESET_DROP_THRESHOLD_S/RESET_LOW_FLOOR_S). This is checked FIRST and alone
// is sufficient — do not require corroboration from the coordinate signal,
// because astrometry can be independently stale (frozen) exactly when a
// fresh solve is what would otherwise confirm the retarget; requiring both
// signals to agree would make this function blind to a new observation
// during exactly the failure mode it needs to survive (see the OKU case).
//
// Supporting signal: a large coordinate jump (>= COORDINATE_JUMP_DEG) is
// evidence of a retarget too, but is only used to break a genuine AMBIGUITY
// (accumulated-time data missing/unusable) — never to override what the
// accumulated-time trajectory already said. A coordinate jump alongside an
// UNCHANGED or still-climbing accumulated-time reading is deliberately
// ignored: real re-centering nudges move the coordinate without resetting
// the clock (see the Astir 20:16:30->20:17:36 case, ~0.9deg apart, clock kept
// climbing — that stayed the SAME observation in the real session).
export function detectObservationTransition(
  previous: ObservationFrameInput | null,
  current: ObservationFrameInput,
): TransitionResult {
  if (previous === null) {
    return { transition: 'new', reason: 'no open observation' }
  }

  const prevTime = previous.totalAccumulatedTime
  const curTime = current.totalAccumulatedTime
  const haveBothTimes =
    typeof prevTime === 'number' && Number.isFinite(prevTime) &&
    typeof curTime === 'number' && Number.isFinite(curTime)

  if (haveBothTimes) {
    const drop = prevTime - curTime
    const lowEnough = curTime < RESET_LOW_FLOOR_S

    if (lowEnough && drop >= RESET_DROP_THRESHOLD_S) {
      return {
        transition: 'new',
        reason: `totalAccumulatedTime reset ${prevTime}s -> ${curTime}s`,
      }
    }

    // Landed under the low floor via SOME drop, but too small to confidently
    // call a reset (a real retarget always reset from a much higher value in
    // both real sessions — see RESET_DROP_THRESHOLD_S's doc). Could be a
    // genuine small retarget the clock hasn't fully reflected yet, or could
    // be device jitter/a corrected re-read — genuinely ambiguous, so this is
    // reported 'uncertain' rather than silently treated as either 'same' (a
    // false negative would delay the milestone reset a real retarget needs)
    // or 'new' (a false positive would wrongly reset the toggle mid-stack,
    // which is the worse failure mode per the caller's guidance).
    if (lowEnough && drop >= RESET_UNCERTAIN_DROP_THRESHOLD_S) {
      return {
        transition: 'uncertain',
        reason: `totalAccumulatedTime dropped ${prevTime}s -> ${curTime}s (${drop}s drop, below the ${RESET_DROP_THRESHOLD_S}s reset threshold)`,
      }
    }

    // Accumulated time present and did NOT reset (or dropped by less than
    // the noise guard): same observation, full stop — this is the primary
    // signal and it has a clear answer, so coordinates (even a large jump)
    // are not consulted. This is what keeps the function correct through the
    // OKU stale-astrometry episode: the clock climbing normally is trusted
    // over the frozen coordinate.
    return { transition: 'same', reason: 'totalAccumulatedTime did not reset' }
  }

  // Accumulated-time data is missing/unusable on one or both sides — fall
  // back to the coordinate signal as the best remaining evidence, but report
  // 'uncertain' rather than a confident 'new'/'same': this is a genuinely
  // weaker basis than the primary signal, and a caller (e.g. milestone
  // tagging) may reasonably choose to wait for a clearer read rather than
  // act on it.
  const haveBothCoords =
    typeof previous.raDegrees === 'number' && Number.isFinite(previous.raDegrees) &&
    typeof previous.decDegrees === 'number' && Number.isFinite(previous.decDegrees) &&
    typeof current.raDegrees === 'number' && Number.isFinite(current.raDegrees) &&
    typeof current.decDegrees === 'number' && Number.isFinite(current.decDegrees)

  if (!haveBothCoords) {
    return { transition: 'uncertain', reason: 'no usable totalAccumulatedTime or coordinates' }
  }

  const sep = angularSeparationDeg(
    previous.raDegrees as number,
    previous.decDegrees as number,
    current.raDegrees as number,
    current.decDegrees as number,
  )
  if (sep >= COORDINATE_JUMP_DEG) {
    return {
      transition: 'uncertain',
      reason: `totalAccumulatedTime unusable; coordinate jumped ${sep.toFixed(2)}deg (supporting signal only)`,
    }
  }
  return { transition: 'uncertain', reason: 'totalAccumulatedTime unusable; coordinates stable' }
}

// ---------------------------------------------------------------------------
// assessAstrometryFreshness
// ---------------------------------------------------------------------------
//
// UNVALIDATED against real data as of this writing. The relay's raw
// astrometry payload is confirmed (via real OKU relay debug logs, 2026-07-07)
// to contain a 'timestamp' key alongside 'astrometryData', but the relay's
// logging at that point did not print the actual value, and the relay-side
// work to forward a timestamp + computed age to /api/ingest is described as
// "shipped this week" without a captured sample yet. This function's
// SHAPE/SIGNATURE is deliberately generic pending real sample data — do not
// treat its exact freshness thresholds or timestamp-parsing behavior as
// trustworthy until validated against real relay output (see the fixtures in
// scripts/test-detect-transition.mjs, which are synthetic/hand-built, not
// replayed from a real session, unlike detectObservationTransition's).

export type AstrometryFreshnessInput = {
  // The relay-reported astrometry timestamp, in whatever form it turns out
  // to arrive — ISO 8601 string, epoch seconds, or epoch milliseconds are
  // all handled (see parseTimestamp below); anything else is 'unknown'.
  astrometryTimestamp: string | number | null | undefined
  // The relay's own computed age (seconds since the astrometry solve), if it
  // sends one directly rather than (or in addition to) a raw timestamp.
  // Preferred over re-deriving age from astrometryTimestamp when present,
  // since the relay may have clock-sync information this function doesn't.
  astrometryAgeSeconds?: number | null
  // Clock to compare astrometryTimestamp against, when age isn't given
  // directly. Defaults to Date.now() at call time; injectable for tests.
  now?: number
}

export type FreshnessResult = {
  freshness: 'fresh' | 'stale' | 'unknown'
  ageSeconds: number | null
  reason: string
}

// A solve older than this is treated as stale rather than trustworthy for
// guest-facing object naming. Provisional pending real relay data — the OKU
// log shows the SAME frozen coordinate held for 12+ minutes (720s+) with the
// stack actively running the whole time, which is the failure mode this
// threshold exists to catch; 90s comfortably flags that case while staying
// well above the relay's own ~30-40s normal poll cadence (so a single
// slightly-slow poll cycle doesn't itself trip this).
const STALE_AFTER_S = 90

function parseTimestampToEpochMs(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // Heuristic: epoch seconds are ~10 digits today, epoch ms ~13. A value
    // under 10^12 is treated as seconds and scaled up; this holds until the
    // year 2286 for seconds-since-epoch, comfortably beyond relevance here.
    return value < 1e12 ? value * 1000 : value
  }
  const parsed = new Date(value)
  const ms = parsed.getTime()
  return Number.isNaN(ms) ? null : ms
}

export function assessAstrometryFreshness(input: AstrometryFreshnessInput): FreshnessResult {
  const now = input.now ?? Date.now()

  if (typeof input.astrometryAgeSeconds === 'number' && Number.isFinite(input.astrometryAgeSeconds)) {
    const age = input.astrometryAgeSeconds
    if (age < 0) {
      // A negative age (solve timestamped in the future relative to the
      // relay's own clock) is a clock-skew symptom, not a real freshness
      // signal either way — report unknown rather than guessing.
      return { freshness: 'unknown', ageSeconds: age, reason: 'reported age is negative (clock skew?)' }
    }
    return {
      freshness: age <= STALE_AFTER_S ? 'fresh' : 'stale',
      ageSeconds: age,
      reason: `relay-reported age ${age}s`,
    }
  }

  if (input.astrometryTimestamp == null) {
    return { freshness: 'unknown', ageSeconds: null, reason: 'no timestamp or age reported' }
  }

  const epochMs = parseTimestampToEpochMs(input.astrometryTimestamp)
  if (epochMs === null) {
    return { freshness: 'unknown', ageSeconds: null, reason: 'timestamp unparseable' }
  }

  const ageSeconds = (now - epochMs) / 1000
  if (ageSeconds < 0) {
    return { freshness: 'unknown', ageSeconds, reason: 'derived age is negative (clock skew?)' }
  }
  return {
    freshness: ageSeconds <= STALE_AFTER_S ? 'fresh' : 'stale',
    ageSeconds,
    reason: `derived from timestamp, age ${ageSeconds.toFixed(1)}s`,
  }
}
