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
  const confidence: Confidence = fractionOfRadius <= 0.5 ? 'high' : 'medium'

  return { match: best.obj, confidence, separationDeg: best.separationDeg }
}
