// Pure detection helpers for the stacking-progression feature (see
// docs/PHASE_2_BRIEF.md's original T+0/T+60/T+180/T+300 design and
// prisma/schema.prisma's Frame.stackMilestone — the milestone marks actually
// shipping are First/2min/5min/Current, see MILESTONE_SECONDS below). No I/O,
// no Prisma, no Redis — these only fold telemetry into a decision; a caller
// (eventually app/api/ingest/route.ts) owns persistence and owns tracking
// the rolling state (lastUsable, lastStackRunStartedAt) across frames.
//
//   - detectTransition: is the STACK RUN the same or new, and is the SKY
//     TARGET the same or a new candidate? Two separate axes on one result
//     (see TransitionResult below) — a stack restart does not imply a new
//     object (an operator can restart a stack on the same target), and a
//     target CAN change without a clock reset (seen in real OKU data: a
//     small correction where totalAccumulatedTime kept climbing). The
//     milestone toggle (First/2min/5min/Current) keys ONLY off stackRun;
//     object naming is a stackRun-independent concern that additionally
//     needs assessAstrometryFreshness before trusting a coordinate jump —
//     see skyTarget's own doc below for why it stays conservative today.
//   - assessAstrometryFreshness: "can raDegrees/decDegrees be trusted right
//     now?" A stale solve must never be trusted for a guest-facing object
//     name or for confirming a sky-target change, even mid-stack-run.
//
// A frame can be a confident NEW stack run while simultaneously having
// STALE astrometry (see the OKU 2026-07-07 case in the validation script) —
// these are independent axes, not one combined signal.

// ---------------------------------------------------------------------------
// detectTransition
// ---------------------------------------------------------------------------

export type ObservationFrameInput = {
  totalAccumulatedTime: number | null | undefined
  raDegrees: number | null | undefined
  decDegrees: number | null | undefined
}

export type StackRun = 'same' | 'new' | 'uncertain'
export type SkyTarget = 'same' | 'new_candidate' | 'unknown'

export type TransitionResult = {
  stackRun: StackRun
  skyTarget: SkyTarget
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

// Real telescope behavior this must NOT misfire on (from real Astir/OKU
// session data, see the validation script):
//   - A long wall-clock gap (minutes, e.g. a relay network outage) with
//     totalAccumulatedTime continuing to climb by roughly the elapsed time —
//     the stack kept running unattended. NOT a new stack run.
//   - totalAccumulatedTime occasionally ticking by less than real elapsed
//     time (e.g. the stacker dropped a sub-exposure) — still climbing, still
//     the same stack run.
//   - A small coordinate correction (a few tenths of a degree, e.g. a
//     re-centering nudge) with totalAccumulatedTime CONTINUING to climb —
//     same stack run; astrometry noise/refinement, not a new target.
//   - ra/dec staying byte-identical for 10+ minutes straight while
//     totalAccumulatedTime climbs normally (OKU 22:49:45-23:01:50) — the
//     astrometry is very likely stale (see assessAstrometryFreshness), but
//     that is NOT stackRun's concern: the accumulated-time trajectory alone
//     already told us this was one continuous stack run.
//   - A totalAccumulatedTime reading that is null/missing/unparseable — must
//     NOT be compared against, or become, the reset baseline. The caller is
//     responsible for passing `previous` as the last frame with USABLE
//     timing (see the module-level doc on ObservationFrameInput and the
//     caller contract below), so e.g. a 600 -> null -> 30 sequence compares
//     30 against 600 (a real reset), never against null.
//
// What MUST trigger stackRun 'new' (also from real data):
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
// same-stack-run reading in either session ever dropped from its previous
// value AND landed under 120s — so the low-floor condition alone already
// perfectly separates every real reset from every real non-reset in the
// available data.
//
// The drop-threshold guards against device jitter/a corrected re-read being
// misread as a real retarget — a false 'new' here is worse than a false
// 'same', because it would wrongly reset the guest-facing milestone toggle
// mid-stack. Set at 30s: comfortably below both real Astir resets this must
// still catch (65->30, delta 35; 80->30, delta 50) while excluding small
// dips that could plausibly be jitter rather than a genuine reset. Drops in
// [RESET_UNCERTAIN_DROP_THRESHOLD_S, RESET_DROP_THRESHOLD_S) that land under
// the low floor are reported stackRun 'uncertain' rather than silently
// folded into either 'same' or 'new' — see the branch below.
const RESET_DROP_THRESHOLD_S = 30
// Any drop at all (a same-value re-read must not count) landing under the
// low floor, but too small to confidently call a reset (< RESET_DROP_THRESHOLD_S),
// is reported 'uncertain' — neither confidently the same stack run nor
// confidently a new one.
const RESET_UNCERTAIN_DROP_THRESHOLD_S = 5
const RESET_LOW_FLOOR_S = 120

// Settling window: once a stackRun 'new' fires, further time-reset-based
// 'new' calls are suppressed for this long UNLESS a fresh, large coordinate
// jump corroborates a genuine second retarget in quick succession. This
// exists for a failure mode not seen in either real dataset but plausible in
// principle: a bouncy/settling stacker reporting totalAccumulatedTime as
// e.g. 100 -> 90 -> 40 -> 20 while genuinely restarting only once — each
// step alone can look like a fresh small reset and would otherwise fire
// 'new' repeatedly, thrashing the guest-facing milestone toggle. 90s is
// chosen to comfortably span the relay's real ~30-40s poll cadence (2-3
// polls) without being so long it would suppress a genuine fast back-to-back
// retarget (an operator deliberately slewing twice within a few seconds).
const SETTLING_WINDOW_MS = 90 * 1000

// A coordinate move at least this large is treated as informative enough to
// override the settling window (see SETTLING_WINDOW_MS) — chosen well above
// real re-centering noise seen in the data (largest same-stack-run nudge:
// ~0.9deg between two Astir polls) and well under a genuine cross-sky
// retarget (the OKU log's real target changes were all >15deg apart).
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

function isUsableNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function haveUsableCoords(f: ObservationFrameInput): boolean {
  return isUsableNumber(f.raDegrees) && isUsableNumber(f.decDegrees)
}

// detectTransition decides, for `current`'s telemetry relative to `previous`
// (the last frame with USABLE totalAccumulatedTime — see the caller contract
// below), whether the STACK RUN is the same/new/uncertain, and separately
// whether there's any basis to suspect the SKY TARGET changed.
//
// === Caller contract for `previous` ===
// `previous` must be the last frame this function was told had usable
// telemetry — NOT simply "the immediately prior frame regardless of
// validity." If a frame's totalAccumulatedTime is null/missing/unparseable,
// the caller must skip updating its rolling `previous` reference (continue
// carrying forward the last known-usable frame) so a 600 -> null -> 30
// sequence compares 30 against 600 (correctly reading it as a real reset),
// never against null. This function has no memory across calls by design
// (kept pure/stateless) — maintaining that rolling reference, and the
// `lastStackRunStartedAt` timestamp used for the settling window, is the
// caller's responsibility.
//
// previous === null means "no open stack run at all" (session start, or the
// prior stack run was already closed by other logic) — always stackRun
// 'new' in that case, trivially, with skyTarget 'unknown' (nothing to
// compare against yet).
//
// === stackRun ===
// Primary signal: totalAccumulatedTime reset from high to low (see
// RESET_DROP_THRESHOLD_S/RESET_LOW_FLOOR_S). Checked first and alone is
// sufficient — do not require corroboration from the coordinate signal,
// because astrometry can be independently stale (frozen) exactly when a
// fresh solve is what would otherwise confirm the retarget; requiring both
// signals to agree would make this blind to a new stack run during exactly
// the failure mode it needs to survive (see the OKU case).
//
// A stackRun 'new' verdict is suppressed back down to 'same' if it falls
// inside the settling window since `context.lastStackRunStartedAtMs` (see
// SETTLING_WINDOW_MS) — UNLESS a fresh coordinate jump (>= COORDINATE_JUMP_DEG)
// corroborates it, in which case the settling window does not apply and the
// reset is still honored as genuinely 'new'.
//
// === skyTarget ===
// Deliberately conservative for now: 'new_candidate' is reported ONLY
// alongside a confirmed stackRun 'new' (a coordinate jump without ANY clock
// reset is NOT treated as a target change here — astrometry can be stale
// exactly when it would matter most, so a coordinate-only signal is not
// trusted for object naming yet; this needs assessAstrometryFreshness
// wired in first, which is deferred). Otherwise 'unknown' — never 'same',
// because without a validated freshness check this function has no positive
// basis to assert the target DIDN'T change either (a target change without a
// clock reset was observed in real OKU data — see the small-correction case
// in the validation script). Callers must not read 'unknown' as "safe to
// keep showing the current object name" — that policy call belongs to
// whatever wires assessAstrometryFreshness in.
export function detectTransition(
  previous: ObservationFrameInput | null,
  current: ObservationFrameInput,
  context: { nowMs: number; lastStackRunStartedAtMs: number | null } = { nowMs: Date.now(), lastStackRunStartedAtMs: null },
): TransitionResult {
  if (previous === null) {
    return { stackRun: 'new', skyTarget: 'unknown', confidence: 'high', reason: 'no_previous_frame' }
  }

  const prevTime = previous.totalAccumulatedTime
  const curTime = current.totalAccumulatedTime
  const haveBothTimes = isUsableNumber(prevTime) && isUsableNumber(curTime)

  if (!haveBothTimes) {
    // Unusable timing data on one or both sides — the CALLER is responsible
    // for not having advanced `previous` past a null/unusable reading (see
    // the caller contract above), so reaching this branch means `current`
    // itself is the unusable one. Report uncertain rather than guessing;
    // never silently treat this as either 'same' or 'new'.
    return {
      stackRun: 'uncertain',
      skyTarget: 'unknown',
      confidence: 'low',
      reason: 'current totalAccumulatedTime missing or unparseable',
    }
  }

  const drop = (prevTime as number) - (curTime as number)
  const lowEnough = (curTime as number) < RESET_LOW_FLOOR_S
  const resetQualifies = lowEnough && drop >= RESET_DROP_THRESHOLD_S

  if (resetQualifies) {
    const withinSettlingWindow =
      context.lastStackRunStartedAtMs !== null &&
      context.nowMs - context.lastStackRunStartedAtMs < SETTLING_WINDOW_MS

    if (withinSettlingWindow) {
      const coordJump = coordinateJumpDeg(previous, current)
      if (coordJump !== null && coordJump >= COORDINATE_JUMP_DEG) {
        // Fresh reset inside the settling window, but corroborated by a
        // large coordinate jump — honored as a genuine second retarget in
        // quick succession, not settling noise.
        return {
          stackRun: 'new',
          skyTarget: 'new_candidate',
          confidence: 'medium',
          reason: `totalAccumulatedTime reset ${prevTime}s -> ${curTime}s inside settling window, corroborated by ${coordJump.toFixed(2)}deg coordinate jump`,
        }
      }
      // Inside the settling window with no corroborating coordinate jump —
      // treat as settling noise from the same restart, not a fresh one.
      return {
        stackRun: 'same',
        skyTarget: 'unknown',
        confidence: 'medium',
        reason: `totalAccumulatedTime reset ${prevTime}s -> ${curTime}s suppressed: within ${SETTLING_WINDOW_MS / 1000}s settling window of the last stack-run start, no corroborating coordinate jump`,
      }
    }

    return {
      stackRun: 'new',
      skyTarget: 'new_candidate',
      confidence: 'high',
      reason: `totalAccumulatedTime reset ${prevTime}s -> ${curTime}s`,
    }
  }

  // Landed under the low floor via SOME drop, but too small to confidently
  // call a reset (a real retarget always dropped by at least
  // RESET_DROP_THRESHOLD_S in both real sessions). Could be a genuine small
  // retarget the clock hasn't fully reflected yet, or could be device
  // jitter/a corrected re-read — genuinely ambiguous, so this is reported
  // 'uncertain' rather than silently treated as either 'same' (a false
  // negative would delay a milestone reset a real retarget needs) or 'new'
  // (a false positive would wrongly reset the toggle mid-stack, the worse
  // failure mode per product guidance).
  if (lowEnough && drop >= RESET_UNCERTAIN_DROP_THRESHOLD_S) {
    return {
      stackRun: 'uncertain',
      skyTarget: 'unknown',
      confidence: 'low',
      reason: `totalAccumulatedTime dropped ${prevTime}s -> ${curTime}s (${drop}s drop, below the ${RESET_DROP_THRESHOLD_S}s reset threshold)`,
    }
  }

  // Accumulated time present and did NOT reset (or dropped by less than the
  // noise guard): same stack run, full stop — this is the primary signal
  // and it has a clear answer, so coordinates are not consulted for
  // stackRun. This is what keeps stackRun correct through the OKU
  // stale-astrometry episode: the clock climbing normally is trusted over
  // the frozen coordinate. skyTarget stays 'unknown' rather than 'same' —
  // see the function-level doc for why a coordinate-only signal isn't
  // trusted here yet (a real OKU frame showed a target-relevant coordinate
  // move WITHOUT any clock reset).
  return { stackRun: 'same', skyTarget: 'unknown', confidence: 'high', reason: 'totalAccumulatedTime did not reset' }
}

// Angular separation between `previous`/`current`'s coordinates, or null if
// either side lacks usable ra/dec. Exposed as a small helper (not just
// inlined) so the settling-window corroboration check and any future caller
// share one implementation.
function coordinateJumpDeg(previous: ObservationFrameInput, current: ObservationFrameInput): number | null {
  if (!haveUsableCoords(previous) || !haveUsableCoords(current)) return null
  return angularSeparationDeg(
    previous.raDegrees as number,
    previous.decDegrees as number,
    current.raDegrees as number,
    current.decDegrees as number,
  )
}

// ---------------------------------------------------------------------------
// Milestone marks
// ---------------------------------------------------------------------------
//
// First (0s) / 2 min (120s) / 5 min (300s) / Current View. Deliberately NOT
// the Phase 2 brief's original 0/60/180/300 — front-loaded instead, since
// live stacking visually deepens fastest early (First->2min is the biggest
// visual jump; 2min->5min still clearly deepens; 60s/180s were dropped as a
// product decision, not a technical constraint). Frame.stackMilestone in
// prisma/schema.prisma stores whichever of these a frame was tagged with, or
// null for a non-milestone frame — its comment should read 0 | 120 | 300,
// not the brief's original 0 | 60 | 180 | 300 (schema itself has no CHECK
// constraint on the column, so this is a comment-only correction, not a
// migration).
export const MILESTONE_SECONDS = [0, 120, 300] as const
export type MilestoneSeconds = (typeof MILESTONE_SECONDS)[number]

// Which milestone mark (if any) `totalAccumulatedTime` newly qualifies for
// on THIS frame, given which marks the current stack run has already
// tagged. Pure decision only — the caller (app/api/ingest/route.ts) owns
// persisting the tag and querying `alreadyTagged` for the open stack run.
//
// "Closest frame AT-OR-AFTER crossing a threshold" (per the product rule):
// returns the LARGEST untagged mark that `totalAccumulatedTime` has reached
// or passed, not the smallest — so a frame that jumps straight from 40s to
// 310s (a slow/delayed poll) tags 300 (5min) on arrival rather than
// retroactively also claiming 120 (2min), which this frame was never
// actually AT. Only one mark is ever returned per call: if a frame
// legitimately qualifies for multiple untagged marks at once (a big
// wall-clock gap crossing more than one threshold between polls — seen for
// real in the Astir data, e.g. 760s -> 1310s), only the highest is tagged;
// the lower one is intentionally left untagged rather than backfilled onto
// a frame that wasn't really "at" that mark. A stack run beginning a fresh
// reset (totalAccumulatedTime having just reset to a low value) should have
// `alreadyTagged` cleared by the caller for the NEW run before calling this
// — this function has no notion of "which run" on its own.
export function nextMilestoneToTag(
  totalAccumulatedTime: number | null | undefined,
  alreadyTagged: ReadonlySet<MilestoneSeconds>,
): MilestoneSeconds | null {
  if (!isUsableNumber(totalAccumulatedTime)) return null
  const candidates = MILESTONE_SECONDS.filter(
    (mark) => totalAccumulatedTime >= mark && !alreadyTagged.has(mark),
  )
  if (candidates.length === 0) return null
  return candidates[candidates.length - 1]
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
// replayed from a real session, unlike detectTransition's).

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
