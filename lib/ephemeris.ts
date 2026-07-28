// Shared ephemeris layer — the single place astronomy-engine is used. Powers
// both the guest sun/moon calendar (app/sky-calendar) and (later) the
// astro-correct /live flavor lines. SERVER-SIDE ONLY by design: astronomy-engine
// is ~46 KB gzip and all-or-nothing (no tree-shaking), so it must never reach the
// browser — callers compute here and ship only the resulting strings/numbers.
//
// DST / TIMEZONE HONESTY (the load-bearing correctness rule): astronomy-engine
// computes everything in UTC. Every local time this module emits is formatted
// into a SPECIFIC city's IANA zone via Intl.DateTimeFormat, which applies that
// zone's real UTC offset AND its daylight-saving rules for the given instant
// automatically. So Berlin/Rome/London (CEST/BST in summer) and Kos/Athens
// (EEST) each get their correct wall-clock time with no hand-rolled offset math.
// Every emitted time also carries the zone abbreviation it's shown in, so a
// reader never has to guess which clock a time is on.

import {
  Observer,
  Body,
  Equator,
  Horizon,
  SearchRiseSet,
  SearchAltitude,
  MoonPhase,
  Illumination,
  DefineStar,
} from 'astronomy-engine'
import citiesData from '@/config/cities.json'

export type City = {
  id: string
  name: string
  country: string
  lat: number
  lon: number
  height: number
  tz: string // IANA zone — the source of truth for local time + DST
}

export const CITIES: City[] = (citiesData as { cities: City[] }).cities

export function cityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id)
}

// ---- Time formatting in a city's own zone (DST-correct) ----

// "HH:MM" wall-clock in the city's zone, 24h (matches the site's EU time
// convention). Returns null passed through for absent events.
function formatLocalHHMM(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

// The zone's SHORT abbreviation for a given instant (e.g. "CEST" vs "CET",
// "BST" vs "GMT", "EEST" vs "EET") — resolved for THAT instant so it reflects
// whether DST is in effect on the date in question, not a fixed guess.
export function zoneAbbrev(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz
}

// The city-local calendar date "YYYY-MM-DD" for a given instant (used to anchor
// rise/set searches to the city's own midnight, not the server's).
function cityLocalDateString(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

// The UTC instant of a city's local midnight for the given day. We search
// rise/set from here across ~1 day so the results belong to that local date.
// The zone's offset is read at local NOON (not midnight) to sidestep the
// once-a-year DST-transition gap/overlap that can straddle midnight; noon is
// always unambiguous. Local midnight (00:00 wall clock) in UTC = 00:00Z minus
// that offset.
function cityMidnightUtc(localDate: string, tz: string): Date {
  const noonGuess = new Date(`${localDate}T12:00:00Z`)
  const offsetMin = zoneOffsetMinutes(noonGuess, tz)
  return new Date(new Date(`${localDate}T00:00:00Z`).getTime() - offsetMin * 60_000)
}

// Minutes east of UTC for a zone at a given instant (positive = ahead of UTC).
function zoneOffsetMinutes(date: Date, tz: string): number {
  // Format the same instant as UTC and as the zone, diff the wall clocks.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - date.getTime()) / 60_000)
}

// ---- Sun / Moon rise-set + phase ----

export type SunMoonTimes = {
  cityId: string
  cityName: string
  localDate: string // the city-local date these times are for, "YYYY-MM-DD"
  tzAbbrev: string // which clock every time below is shown in (e.g. "EEST")
  sunrise: string | null // "HH:MM" city-local, or null (polar day/night)
  sunset: string | null
  moonrise: string | null // null on days with no moonrise (lunar day ~24h50m)
  moonset: string | null
  // When the sky is genuinely dark enough for deep-sky viewing: the END of
  // astronomical/nautical twilight after sunset. Null when it never gets that
  // dark (high-latitude summer — London/Berlin can stay in twilight all night).
  darkFrom: string | null
}

// Compute sunrise/sunset/moonrise/moonset + "dark from" for a city on the date
// containing `whenUtc` (defaults handled by the caller passing a real instant).
// Every string is city-local wall time; nulls are HONEST (polar day, no
// moonrise that date, or never-dark summer nights) and the caller renders them
// as "—"/"all night" rather than inventing a time.
export function sunMoonTimes(city: City, whenUtc: Date): SunMoonTimes {
  const observer = new Observer(city.lat, city.lon, city.height)
  const localDate = cityLocalDateString(whenUtc, city.tz)
  const midnight = cityMidnightUtc(localDate, city.tz)

  const rise = (body: Body) => {
    const t = SearchRiseSet(body, observer, +1, midnight, 1)
    return t ? formatLocalHHMM(t.date, city.tz) : null
  }
  const set = (body: Body) => {
    const t = SearchRiseSet(body, observer, -1, midnight, 1)
    return t ? formatLocalHHMM(t.date, city.tz) : null
  }

  return {
    cityId: city.id,
    cityName: city.name,
    localDate,
    tzAbbrev: zoneAbbrev(midnight, city.tz),
    sunrise: rise(Body.Sun),
    sunset: set(Body.Sun),
    moonrise: rise(Body.Moon),
    moonset: set(Body.Moon),
    darkFrom: darkFrom(observer, midnight, city.tz),
  }
}

// "Dark from": when the Sun next drops below -12° (nautical dusk — a fair
// practical threshold for the sky reading genuinely dark to a guest; -18°
// astronomical is stricter but at these latitudes in summer it's often never
// reached, and -12° is honestly "dark enough to stargaze"). SearchAltitude
// (direction -1 = descending) is the correct function here — its final arg is
// the target ALTITUDE in degrees, unlike SearchRiseSet whose final arg is
// metres above ground. Searched from local noon forward so we get the EVENING
// crossing. Null if it never gets that dark in the next 24h (high-latitude
// summer twilight — London/Berlin can stay lighter than this all night in June).
function darkFrom(observer: Observer, midnightUtc: Date, tz: string): string | null {
  const NAUTICAL_DUSK_DEG = -12
  const noon = new Date(midnightUtc.getTime() + 12 * 3600_000)
  const t = SearchAltitude(Body.Sun, observer, -1, noon, 1, NAUTICAL_DUSK_DEG)
  return t ? formatLocalHHMM(t.date, tz) : null
}

export type MoonInfo = {
  phaseName: string // "waxing gibbous", "full moon", ...
  illumPercent: number // 0..100, rounded
  // A one-line, honest stargazing verdict about tonight's moon — a bright moon
  // washes out faint deep-sky; a dark/new moon is ideal for galaxies/nebulae.
  stargazingNote: string
}

// The Moon looks the same across all our cities on a given night, so this is
// computed once (no observer needed for phase/illumination).
export function moonInfo(whenUtc: Date): MoonInfo {
  const angle = MoonPhase(whenUtc) // 0=new, 90=first qtr, 180=full, 270=last qtr
  const frac = Illumination(Body.Moon, whenUtc).phase_fraction // 0..1
  const illumPercent = Math.round(frac * 100)
  const phaseName = moonPhaseName(angle, frac)
  return { phaseName, illumPercent, stargazingNote: moonStargazingNote(illumPercent) }
}

function moonPhaseName(angle: number, frac: number): string {
  if (angle < 5 || angle > 355) return 'new moon'
  if (Math.abs(angle - 180) < 5) return 'full moon'
  if (Math.abs(angle - 90) < 5) return 'first quarter'
  if (Math.abs(angle - 270) < 5) return 'last quarter'
  const waxing = angle < 180
  return waxing
    ? frac < 0.5
      ? 'waxing crescent'
      : 'waxing gibbous'
    : frac < 0.5
      ? 'waning crescent'
      : 'waning gibbous'
}

// A moon-phase glyph for a phase name — a simple, honest visual cue (emoji moon
// faces render everywhere and need no asset). Waxing = right-lit, waning = left-lit.
export function moonGlyph(phaseName: string): string {
  switch (phaseName) {
    case 'new moon':
      return '🌑'
    case 'waxing crescent':
      return '🌒'
    case 'first quarter':
      return '🌓'
    case 'waxing gibbous':
      return '🌔'
    case 'full moon':
      return '🌕'
    case 'waning gibbous':
      return '🌖'
    case 'last quarter':
      return '🌗'
    case 'waning crescent':
      return '🌘'
    default:
      return '🌙'
  }
}

// The next `days` nights of moon phase (tonight first) — for the planning strip,
// so a trip-planner can pick a dark night. `startUtc` anchors "tonight"; each
// subsequent entry steps +1 day at the same UTC time (phase drifts ~12°/day, so
// same-UTC-time sampling is plenty accurate for a planning glance).
export type MoonDay = { dayOffset: number; phaseName: string; illumPercent: number; glyph: string }
export function moonWeek(startUtc: Date, days = 7): MoonDay[] {
  const out: MoonDay[] = []
  for (let d = 0; d < days; d++) {
    const when = new Date(startUtc.getTime() + d * 86_400_000)
    const info = moonInfo(when)
    out.push({ dayOffset: d, phaseName: info.phaseName, illumPercent: info.illumPercent, glyph: moonGlyph(info.phaseName) })
  }
  return out
}

function moonStargazingNote(illumPercent: number): string {
  if (illumPercent <= 15) return 'Dark skies — ideal for galaxies and nebulae.'
  if (illumPercent <= 45) return 'Fairly dark — deep-sky objects still show well.'
  if (illumPercent <= 75) return 'Some moonlight — best for the Moon, planets, and bright targets.'
  return 'Bright moon — great for the Moon and planets; faint objects wash out.'
}

// ---- Object visibility (for the flavor lines, built now on the shared layer) ----

// Cardinal/inter-cardinal direction from an azimuth in degrees (0=N, clockwise).
export function azimuthToCompass(az: number): string {
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
  return dirs[Math.round((((az % 360) + 360) % 360) / 45) % 8]
}

// A notable object we might name in a flavor line: a naked-eye body (planet/Moon)
// or a showpiece deep-sky object we actually feature at events. DSOs carry RA/Dec
// (hours / degrees) so astronomy-engine can place them via DefineStar.
export type Notable =
  | { kind: 'body'; name: string; body: Body }
  | { kind: 'dso'; name: string; raHours: number; decDeg: number; distLy: number }

// Alt/az for a body or DSO from a city at an instant. altitude<0 => below horizon.
export function altAz(city: City, target: Notable, whenUtc: Date): { altitude: number; azimuth: number } {
  const observer = new Observer(city.lat, city.lon, city.height)
  let body: Body
  if (target.kind === 'body') {
    body = target.body
  } else {
    // Reuse a fixed star slot for the DSO's coordinates, then treat it like any body.
    DefineStar(Body.Star1, target.raHours, target.decDeg, target.distLy)
    body = Body.Star1
  }
  const eq = Equator(body, whenUtc, observer, true, true)
  const hor = Horizon(whenUtc, observer, eq.ra, eq.dec, 'normal')
  return { altitude: hor.altitude, azimuth: hor.azimuth }
}

// Is it dark enough at this city/instant to bother naming sky objects? Gate the
// flavor lines on the Sun being below civil-ish dusk so we never say "Saturn's
// up" in daylight.
export function isDarkEnough(city: City, whenUtc: Date): boolean {
  const CIVIL_DUSK_DEG = -6
  const observer = new Observer(city.lat, city.lon, city.height)
  const eq = Equator(Body.Sun, whenUtc, observer, true, true)
  const hor = Horizon(whenUtc, observer, eq.ra, eq.dec, 'normal')
  return hor.altitude < CIVIL_DUSK_DEG
}

// Minimum altitude for a "genuinely up" claim — below this it's behind hills/
// haze/rooftops, so naming it would be true-but-useless.
const MIN_NOTABLE_ALT_DEG = 15

// The showpiece objects worth a flavor line — the ones a guest can name and
// might see: the planets + the deep-sky objects actually shown at events. DSO
// coordinates are J2000 RA(hours)/Dec(deg). Kept deliberately short (per the
// spec: notable only, no obscure targets).
export const NOTABLES: Notable[] = [
  { kind: 'body', name: 'the Moon', body: Body.Moon },
  { kind: 'body', name: 'Venus', body: Body.Venus },
  { kind: 'body', name: 'Mars', body: Body.Mars },
  { kind: 'body', name: 'Jupiter', body: Body.Jupiter },
  { kind: 'body', name: 'Saturn', body: Body.Saturn },
  { kind: 'dso', name: 'the Andromeda Galaxy', raHours: 0.7123, decDeg: 41.2687, distLy: 2537000 }, // M31
  { kind: 'dso', name: 'the Hercules Cluster', raHours: 16.6949, decDeg: 36.4613, distLy: 22200 }, // M13
  { kind: 'dso', name: 'the Ring Nebula', raHours: 18.8931, decDeg: 33.0288, distLy: 2300 }, // M57
  { kind: 'dso', name: 'the Dumbbell Nebula', raHours: 19.9934, decDeg: 22.7212, distLy: 1360 }, // M27
  { kind: 'dso', name: 'the Whirlpool Galaxy', raHours: 13.4979, decDeg: 47.1953, distLy: 23000000 }, // M51
  { kind: 'dso', name: 'the Pinwheel Galaxy', raHours: 14.0535, decDeg: 54.3488, distLy: 21000000 }, // M101
  { kind: 'dso', name: 'the Orion Nebula', raHours: 5.5881, decDeg: -5.391, distLy: 1344 }, // M42
]

// The notables genuinely up (above MIN_NOTABLE_ALT_DEG) at a city/instant, WITH
// their compass direction — only meaningful when isDarkEnough is also true. This
// is what the flavor "true right now" pool consumes. Returns [] when nothing
// qualifies — and per the spec, silence beats a wrong claim, so an empty list
// means the flavor line falls back to the curated static pool.
export function visibleNotables(
  city: City,
  whenUtc: Date,
): { name: string; direction: string; altitude: number }[] {
  if (!isDarkEnough(city, whenUtc)) return []
  const out: { name: string; direction: string; altitude: number }[] = []
  for (const target of NOTABLES) {
    const { altitude, azimuth } = altAz(city, target, whenUtc)
    if (altitude >= MIN_NOTABLE_ALT_DEG) {
      out.push({ name: target.name, direction: azimuthToCompass(azimuth), altitude })
    }
  }
  // Highest first — the most prominent object leads.
  out.sort((a, b) => b.altitude - a.altitude)
  return out
}
