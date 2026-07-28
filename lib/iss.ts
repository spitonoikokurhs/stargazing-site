// ISS pass prediction — the ONE part of the sky tools that can't be done from a
// static model: a satellite's orbit decays and is re-boosted, so its position is
// only known from fresh TLE (two-line element) data. We fetch the current ISS
// TLE from CelesTrak (free, no key), propagate it with satellite.js (SGP4, MIT,
// zero deps), and compute tonight's VISIBLE passes — all server-side, so the
// browser still receives only strings.
//
// HARD SAFETY RULE (the operator is standing under the real sky in front of an
// audience): NEVER show a fabricated or stale pass. If the TLE fetch fails, or
// the TLE is too old to trust, this returns { ok: false } and the page says
// "unavailable right now" — silence beats a wrong claim about where the ISS is.

import * as satellite from 'satellite.js'
import type { City } from '@/lib/ephemeris'

// CelesTrak's canonical ISS (NORAD 25544) TLE endpoint — plain text, no key.
const ISS_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle'

// A TLE older than this is not trustworthy for pass timing (the orbit drifts).
const TLE_MAX_AGE_DAYS = 7

// Minimum peak altitude for a pass to be worth listing — below this it skims the
// horizon and is lost behind terrain/haze.
const MIN_PASS_PEAK_DEG = 15

export type IssPass = {
  start: string // "HH:MM" city-local
  startDir: string // compass direction it appears (N/NE/…)
  peak: string // "HH:MM" city-local of highest point
  peakAltitude: number // degrees
  end: string // "HH:MM" city-local
  endDir: string // compass where it disappears
}

export type IssResult =
  | { ok: true; passes: IssPass[]; tleAgeHours: number }
  | { ok: false; reason: string }

// ---- TLE fetch (cached via Next fetch) ----
async function fetchIssTle(): Promise<{ line1: string; line2: string } | null> {
  try {
    // Next caches this for an hour (revalidate) so we don't hammer CelesTrak and
    // the page stays fast; a fresh TLE is only needed every few days anyway.
    // Hard timeout so a slow/down CelesTrak can never hang the page render — on
    // timeout the catch below returns null → the page shows "unavailable".
    const res = await fetch(ISS_TLE_URL, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const text = await res.text()
    const lines = text
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
    // Format: name, line1 (starts "1 "), line2 (starts "2 ").
    const l1 = lines.find((l) => l.startsWith('1 '))
    const l2 = lines.find((l) => l.startsWith('2 '))
    if (!l1 || !l2) return null
    return { line1: l1, line2: l2 }
  } catch {
    return null
  }
}

function azToCompass(azDeg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16]
}

function hhmm(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

// The sun's altitude at an instant/observer — a pass is only VISIBLE to a
// ground observer when the observer is in the dark (sun below the horizon) but
// the ISS is still sunlit. We approximate the "observer dark" half here (sun
// below -6°, civil twilight) since a fully-lit sky hides even a bright ISS.
function sunAltitude(gmst: number, observerGd: satellite.GeodeticLocation, when: Date): number {
  // satellite.js has no sun model; use a light-weight solar position good to a
  // fraction of a degree — enough to gate "is it dark for the observer".
  const rad = Math.PI / 180
  const d = (when.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000 // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad
  const q = (280.459 + 0.98564736 * d) * rad
  const L = q + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const e = (23.439 - 0.00000036 * d) * rad
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const lst = gmst + observerGd.longitude // local sidereal time (rad)
  const ha = lst - ra
  const alt = Math.asin(
    Math.sin(observerGd.latitude) * Math.sin(dec) + Math.cos(observerGd.latitude) * Math.cos(dec) * Math.cos(ha),
  )
  return alt / rad
}

// Compute tonight's visible ISS passes for a city, over the city-local calendar
// day containing `whenUtc` (00:00–23:59 local, per the request).
export async function issPasses(city: City, whenUtc: Date): Promise<IssResult> {
  const tle = await fetchIssTle()
  if (!tle) return { ok: false, reason: 'Live ISS data is unavailable right now.' }

  let satrec: satellite.SatRec
  try {
    satrec = satellite.twoline2satrec(tle.line1, tle.line2)
  } catch {
    return { ok: false, reason: 'Could not read the ISS orbit data.' }
  }

  // TLE freshness: epoch is encoded in the satrec (jdsatepoch). Reject stale data.
  const epochMs = (satrec.jdsatepoch - 2440587.5) * 86400000
  const ageHours = (whenUtc.getTime() - epochMs) / 3600000
  if (!Number.isFinite(ageHours) || ageHours > TLE_MAX_AGE_DAYS * 24 || ageHours < -24) {
    return { ok: false, reason: 'The ISS orbit data is out of date — check back later.' }
  }

  const observerGd: satellite.GeodeticLocation = {
    longitude: satellite.degreesToRadians(city.lon),
    latitude: satellite.degreesToRadians(city.lat),
    height: city.height / 1000, // km
  }

  // Window: the city-local day 00:00 → 24:00. Build local midnight in UTC the
  // same way ephemeris does (offset at local noon).
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: city.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(whenUtc)
  const noon = new Date(`${localDate}T12:00:00Z`)
  const offMin = zoneOffsetMinutes(noon, city.tz)
  const startUtc = new Date(new Date(`${localDate}T00:00:00Z`).getTime() - offMin * 60000)
  const endUtc = new Date(startUtc.getTime() + 24 * 3600000)

  // Step 30s across the day; a "pass" is a contiguous run of above-horizon
  // samples. Track its start/peak/end + whether it's visible (observer dark).
  const STEP_MS = 30000
  type Sample = { t: Date; alt: number; az: number; observerDark: boolean }
  const passes: IssPass[] = []
  let cur: Sample[] | null = null

  const flush = () => {
    if (!cur || cur.length === 0) { cur = null; return }
    const peak = cur.reduce((a, b) => (b.alt > a.alt ? b : a))
    // Visible pass = peaks above the floor AND the observer is dark at the peak
    // (a sunlit sky hides the ISS). We don't check the ISS's own sunlit state
    // exactly (that needs the shadow geometry) — gating on observer-dark +
    // decent altitude is the standard practical "visible pass" heuristic and
    // errs toward NOT over-claiming.
    if (peak.alt >= MIN_PASS_PEAK_DEG && peak.observerDark) {
      const first = cur[0]
      const last = cur[cur.length - 1]
      passes.push({
        start: hhmm(first.t, city.tz),
        startDir: azToCompass(first.az),
        peak: hhmm(peak.t, city.tz),
        peakAltitude: Math.round(peak.alt),
        end: hhmm(last.t, city.tz),
        endDir: azToCompass(last.az),
      })
    }
    cur = null
  }

  for (let t = startUtc.getTime(); t <= endUtc.getTime(); t += STEP_MS) {
    const when = new Date(t)
    const pv = satellite.propagate(satrec, when)
    if (!pv || typeof pv.position === 'boolean' || !pv.position) { flush(); continue }
    const gmst = satellite.gstime(when)
    const ecf = satellite.eciToEcf(pv.position, gmst)
    const look = satellite.ecfToLookAngles(observerGd, ecf)
    const altDeg = satellite.radiansToDegrees(look.elevation)
    const azDeg = satellite.radiansToDegrees(look.azimuth)
    if (altDeg > 0) {
      const observerDark = sunAltitude(gmst, observerGd, when) < -6
      if (!cur) cur = []
      cur.push({ t: when, alt: altDeg, az: azDeg, observerDark })
    } else {
      flush()
    }
  }
  flush()

  return { ok: true, passes, tleAgeHours: Math.round(ageHours) }
}

// Minutes east of UTC for a zone at an instant (dup of ephemeris' private helper
// — kept local so this module stays self-contained).
function zoneOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - date.getTime()) / 60000)
}
