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
}

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export type MatchResult = {
  match: CatalogObject | null
  confidence: Confidence
  separationDeg: number
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
    return { match: null, confidence: 'none', separationDeg: Infinity }
  }

  const radius = best.obj.displayRadiusDeg as number
  const fractionOfRadius = best.separationDeg / radius
  const confidence: Confidence = fractionOfRadius <= highConfidenceCutoffFraction(radius) ? 'high' : 'medium'

  return { match: best.obj, confidence, separationDeg: best.separationDeg }
}
