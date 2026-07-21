import catalogData from '@/config/catalog.json'

export type CatalogObject = {
  id: string
  primaryName: string
  aliases: string[]
  type: string
  raDeg: number | null
  decDeg: number | null
  displayRadiusDeg: number | null
  priority: number
  description: string
  requiresEphemeris?: boolean
  // Guest-facing facts shown as fact chips on /live (see Facts in
  // app/live/LiveView.tsx). Optional/additive — absent on any entry not yet
  // back-filled; the UI omits a chip rather than showing a placeholder.
  constellation?: string
  distanceLy?: number
  // Guest-relatable apparent size (angular size vs. the Moon's ~31 arcmin),
  // e.g. "6× wider than the full Moon" or "a tiny ring — telescope only" —
  // NOT physical/linear size. Optional/additive like the two fields above.
  sizeDescription?: string
  // Enriched-card content (see docs/enriched-card-designer-brief-2026-07-07.md
  // and the design previews at app/preview/enriched*). Optional/additive and
  // back-filled gradually like the fields above — absent on any entry not
  // yet written. Deliberately real, fact-checked copy (not placeholder text):
  // this is production content, independent of which UI design (if any)
  // eventually ships it, so it lives here rather than in a preview's own
  // sample data. A short, punchy sentence each; astronomically precise
  // rather than rounded to a "nicer"-sounding but wrong number or date.
  wowFacts?: string[]
  // A short line managing what the guest should actually expect to SEE
  // through the eyepiece/telescope image — distinct in purpose from
  // wowFacts (which are about the object itself, not how it looks tonight).
  visualHint?: string
  // Four-section deep-dive shown in a collapsed-by-default "more" drawer.
  // Section headings are meant to stay consistent across every object
  // (What you're seeing / Why it matters / The human story / How to spot
  // it), so the UI can render a fixed heading order rather than looking
  // them up per object.
  drawer?: { heading: string; body: string }[]
}

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export type MatchResult = {
  match: CatalogObject | null
  confidence: Confidence
  separationDeg: number
  // True when a SECOND catalog object (not the winner) is within ITS OWN
  // displayRadiusDeg of this solve — the exact predicate the runner-up
  // guardrail below already uses. This is an OBJECTIVE FACT about the sky +
  // catalog, deliberately NOT a display decision: it says "the field is
  // contested," and leaves "should we therefore show/withhold the name" to the
  // presentation layer (see resolveDisplayObject / shouldShowMatchName in
  // app/live/LiveView.tsx). Kept as a fact so different surfaces (live card vs.
  // history strip vs. season-end MatchDecision analysis) can each apply their
  // own policy to it rather than being handed one baked-in verdict.
  //
  // IMPORTANT — the predicate is "within its own radius," NOT "within some
  // fixed angular distance." An object can have sky neighbors that are close in
  // degrees yet nowhere near their own radius of this solve (e.g. M101 that
  // night): those are NOT runner-ups and must NOT set this true, or an
  // off-center-but-unambiguous match would be wrongly withheld.
  //
  // CATALOG-DENSITY DEPENDENT: this value is a function of what's in the
  // catalog. Adding a nearby entry later (M81/M82, the Virgo cluster galaxies,
  // a double cluster) can make a currently-clean isolated target sprout an
  // in-range runner-up and start withholding its name. That's correct behavior
  // (the field genuinely became contested), but flagged here so a future
  // catalog addition changing an unrelated object's label isn't a surprise.
  hasInRangeRunnerUp: boolean
}

// Cast once at module load: JSON has no way to express `null` vs "absent" for
// the ephemeris objects' ra/decDeg/displayRadiusDeg, but the shape matches.
const CATALOG = (catalogData as { objects: CatalogObject[] }).objects

// Objects with requiresEphemeris (Moon, planets) carry no fixed raDeg/decDeg —
// their position changes daily and needs a real ephemeris source. They are
// deliberately excluded from the static coordinate matcher below; a future
// branch wires in real ephemeris lookups and matches those separately.
const STATIC_CATALOG = CATALOG.filter(
  (obj): obj is CatalogObject & { raDeg: number; decDeg: number; displayRadiusDeg: number } =>
    !obj.requiresEphemeris && obj.raDeg !== null && obj.decDeg !== null && obj.displayRadiusDeg !== null,
)

const DEG_TO_RAD = Math.PI / 180

// Proper spherical angular separation (haversine form), not flat Euclidean
// distance — RA lines converge toward the poles, so naive sqrt(dRA^2+dDec^2)
// overstates separation away from the celestial equator.
export function angularSeparationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const lat1 = dec1 * DEG_TO_RAD
  const lat2 = dec2 * DEG_TO_RAD
  const dLat = (dec2 - dec1) * DEG_TO_RAD
  const dLon = (ra2 - ra1) * DEG_TO_RAD

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return c / DEG_TO_RAD
}

// TODO(future branch): constellation lookup for the no-match fallback (e.g.
// "Star field in Cygnus"). Out of scope here — this module only reports
// match/no-match; presentation-layer fallback text is the caller's job.

// The telescope's actual field of view. This is the physical anchor for the
// size-aware confidence cutoff below: the scope can only ever frame a patch
// of sky about this wide, so for any catalog object noticeably larger than
// the FOV, the reported solve coordinate is necessarily SOME sub-region of
// the object, not the object's true center — "off-center" is the normal,
// expected case for a big object, not a sign of an uncertain match.
// TODO(future branch): read the real per-frame fovDegrees from the solve
// payload instead of this fixed estimate, if/when the device reports it —
// would let a wider or narrower actual FOV shift this per-frame rather than
// using one constant for every device/session.
const TELESCOPE_FOV_DEG = 0.94

// How close to a catalog object's center a solve needs to land, as a
// fraction of that object's own displayRadiusDeg, to count as "high"
// confidence rather than "medium" (see matchCoordinates below).
//
// A flat 50%-of-radius cutoff (the original rule) is correct for objects
// much smaller than the telescope's FOV: the scope's view can contain the
// whole object plus empty sky around it, so landing in the outer half of a
// SMALL object's radius really can mean "centered near it, not on it."
//
// It breaks down for objects bigger than the FOV (e.g. North America Nebula
// at 1.3° radius vs. a ~0.94° FOV): the telescope can never see the whole
// object at once, so any solve that falls anywhere within a large object's
// extent IS a confident match — there's no "centered on empty sky nearby"
// failure mode once the object itself is bigger than what the scope can see.
//
// Formula: the cutoff rises linearly from 0.5 (radius -> 0) to 1.0 (radius
// >= 2x the FOV), then holds at 1.0 (anywhere within radius counts as high)
// for anything larger still. 2x the FOV (not 1x) as the point where the
// cutoff maxes out is deliberately conservative — an object only "a bit"
// bigger than the FOV still leaves room for a real near-miss, so the
// generous end of the curve is reserved for objects clearly larger than what
// the scope can frame in one view.
function highConfidenceCutoffFraction(displayRadiusDeg: number): number {
  const sizeRatio = Math.min(1, displayRadiusDeg / (2 * TELESCOPE_FOV_DEG))
  return 0.5 + 0.5 * sizeRatio
}

// Runner-up guardrail: in a crowded field, being size-aware-close to the
// WINNING object isn't enough on its own — if a second object is nearly as
// plausible a match, we genuinely don't know which one the telescope is
// actually on, and a confidently-wrong name is worse than a fallback (see
// matchCoordinates' doc comment). "Nearly as plausible" is judged on the
// same normalized score both candidates are ranked by: separationDeg /
// displayRadiusDeg (fraction of the OBJECT'S OWN radius), so a tiny object
// and a huge one are compared on equal footing rather than by raw distance.
//
// The runner-up must score at least this much WORSE (i.e. a larger,
// less-convincing fraction) than the winner for "high" to survive; otherwise
// confidence is downgraded to "medium" regardless of how well the winner
// alone would have qualified. 1.5x is a deliberately conservative margin —
// "clearly stands out," not just "technically ahead" — favoring an
// occasional safe fallback over ever confidently picking the wrong one of
// two close candidates.
const RUNNER_UP_CLEAR_MARGIN = 1.5

// Floor on the margin threshold below (winnerScore * RUNNER_UP_CLEAR_MARGIN):
// without it, an exactly-centered winner (winnerScore === 0) would compute a
// threshold of 0, and NO runner-up score could ever be "less than" 0 — the
// guardrail would silently disable itself for a dead-center hit, which is
// backwards (a dead-center hit tied by an equally dead-center runner-up is
// exactly the ambiguous case the guardrail exists to catch). Not reachable
// by any current catalog entry (no two objects share coordinates), but a
// real risk for future nested/group/duplicate entries — cheap to guard now.
const RUNNER_UP_MARGIN_FLOOR = 0.05

// Exported so scripts/test-catalog.mjs can verify this exact formula
// directly: the real catalog has no two objects at or near the same
// coordinates today, so the zero-score edge case this floor guards against
// can't be exercised through matchCoordinates with real data. Testing the
// formula itself against the scenario it's designed for (a tied dead-center
// runner-up) is more honest than skipping coverage or faking a catalog entry.
export function runnerUpClearMarginThreshold(winnerScore: number): number {
  return Math.max(winnerScore * RUNNER_UP_CLEAR_MARGIN, RUNNER_UP_MARGIN_FLOOR)
}

// Within-radius candidates, preferring priority over raw closeness — e.g.
// coordinates near both M42 (huge, famous, high priority) and a tiny obscure
// NGC nebula nearby should resolve to M42 even if the NGC object is closer.
export function matchCoordinates(raDeg: number, decDeg: number): MatchResult {
  let best: { obj: CatalogObject; separationDeg: number } | null = null

  for (const obj of STATIC_CATALOG) {
    const separationDeg = angularSeparationDeg(raDeg, decDeg, obj.raDeg as number, obj.decDeg as number)
    if (separationDeg > (obj.displayRadiusDeg as number)) continue

    if (
      best === null ||
      obj.priority > best.obj.priority ||
      (obj.priority === best.obj.priority && separationDeg < best.separationDeg)
    ) {
      best = { obj, separationDeg }
    }
  }

  if (best === null) {
    return { match: null, confidence: 'none', separationDeg: Infinity, hasInRangeRunnerUp: false }
  }

  const radius = best.obj.displayRadiusDeg as number
  const fractionOfRadius = best.separationDeg / radius
  let confidence: Confidence = fractionOfRadius <= highConfidenceCutoffFraction(radius) ? 'high' : 'medium'

  // Single runner-up scan, run UNCONDITIONALLY (not only on the high path) —
  // it feeds two independent outputs:
  //   1. bestRunnerUpScore: the most convincing OTHER in-range candidate,
  //      scored the same way (fraction of ITS OWN radius), used by the "high"
  //      downgrade guardrail below.
  //   2. hasInRangeRunnerUp: whether ANY second object is within its own
  //      display radius of this solve — the objective "contested field" fact
  //      surfaced on MatchResult (see its doc comment). This is exactly the
  //      per-object `separationDeg > displayRadiusDeg` in-range test the loop
  //      already applies, so the fact and the guardrail can never disagree
  //      about what "in range" means.
  let bestRunnerUpScore = Infinity
  let hasInRangeRunnerUp = false
  for (const obj of STATIC_CATALOG) {
    if (obj.id === best.obj.id) continue
    const separationDeg = angularSeparationDeg(raDeg, decDeg, obj.raDeg as number, obj.decDeg as number)
    if (separationDeg > (obj.displayRadiusDeg as number)) continue // not within ITS OWN radius -> not a runner-up
    hasInRangeRunnerUp = true
    const score = separationDeg / (obj.displayRadiusDeg as number)
    if (score < bestRunnerUpScore) bestRunnerUpScore = score
  }

  // Runner-up downgrade: only matters when the winner would otherwise be
  // "high" — a "medium" result is already the safe/hedged outcome, nothing to
  // guard. If the best runner-up isn't clearly worse than the winner's own
  // score, this is a crowded field and "high" isn't safe.
  if (confidence === 'high') {
    const winnerScore = fractionOfRadius
    if (bestRunnerUpScore < runnerUpClearMarginThreshold(winnerScore)) {
      confidence = 'medium'
    }
  }

  return { match: best.obj, confidence, separationDeg: best.separationDeg, hasInRangeRunnerUp }
}

export type NearestObject = {
  objectId: string
  separationDeg: number
  displayRadiusDeg: number
  // separationDeg / displayRadiusDeg — the size-normalized closeness score.
  // <= 1 means the coordinate is INSIDE this object's radius (matchCoordinates
  // would have matched it); values just OVER 1 are the radius-tuning targets
  // (a near-miss that a slightly larger radius would capture).
  fractionOfRadius: number
}

// The single closest static-catalog object to a coordinate, by size-normalized
// separation (separation / the object's own displayRadiusDeg) — the SAME score
// matchCoordinates ranks by, so "nearest" here means "most plausible match,"
// not merely smallest raw angular distance (a tiny object 0.1 deg away is a
// worse candidate than a huge one 0.3 deg away). Unlike matchCoordinates this
// ignores the radius cutoff entirely: it always returns the best candidate
// even when nothing is within radius, which is exactly the fallback case the
// debug endpoint enriches — "what would this fallback have almost matched, and
// how much would the radius need to grow." Returns null only if the static
// catalog is somehow empty. Computed against the CURRENT catalog every call,
// so it always reflects today's tuned radii/positions.
export function nearestCatalogObject(raDeg: number, decDeg: number): NearestObject | null {
  let best: { obj: (typeof STATIC_CATALOG)[number]; separationDeg: number; fraction: number } | null = null
  for (const obj of STATIC_CATALOG) {
    const separationDeg = angularSeparationDeg(raDeg, decDeg, obj.raDeg, obj.decDeg)
    const fraction = separationDeg / obj.displayRadiusDeg
    if (best === null || fraction < best.fraction) {
      best = { obj, separationDeg, fraction }
    }
  }
  if (best === null) return null
  return {
    objectId: best.obj.id,
    separationDeg: best.separationDeg,
    displayRadiusDeg: best.obj.displayRadiusDeg,
    fractionOfRadius: best.fraction,
  }
}
