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
  Elongation,
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
  // 0..1 illuminated fraction (unrounded) + which limb is lit — everything a
  // renderer needs to draw an accurate moon (see the SVG moon in the calendar).
  // waxing = right limb lit; waning = left limb lit.
  illumFraction: number
  waxing: boolean
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
  // angle<180 is the waxing half of the cycle (new -> full): right limb lit.
  return {
    phaseName,
    illumPercent,
    illumFraction: frac,
    waxing: angle < 180,
    stargazingNote: moonStargazingNote(illumPercent),
  }
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

// The next `days` nights of moon phase (tonight first) — for the planning strip,
// so a trip-planner can pick a dark night. `startUtc` anchors "tonight"; each
// subsequent entry steps +1 day at the same UTC time (phase drifts ~12°/day, so
// same-UTC-time sampling is plenty accurate for a planning glance).
export type MoonDay = {
  dayOffset: number
  phaseName: string
  illumPercent: number
  illumFraction: number
  waxing: boolean
}
export function moonWeek(startUtc: Date, days = 7): MoonDay[] {
  const out: MoonDay[] = []
  for (let d = 0; d < days; d++) {
    const when = new Date(startUtc.getTime() + d * 86_400_000)
    const info = moonInfo(when)
    out.push({
      dayOffset: d,
      phaseName: info.phaseName,
      illumPercent: info.illumPercent,
      illumFraction: info.illumFraction,
      waxing: info.waxing,
    })
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

// ---- Sun/Moon altitude curves (for the 24-hour arc chart) ----
//
// Samples the Sun's and Moon's altitude across the SELECTED LOCAL DAY (local
// midnight -> next local midnight), so the chart's x-axis is that city's own
// 00:00..24:00 clock. Server-side only (astronomy-engine); the page ships just
// the resulting numbers as SVG path points. Also returns each body's transit
// (culmination) — the sampled peak — since a planner wants "highest at HH:MM".
export type AltSample = { minute: number; altitude: number } // minute 0..1440 from local midnight
export type AltTransit = { hhmm: string; altitude: number } | null
export type AltCurves = {
  dayStartUtc: Date // the local-midnight instant the samples are measured from
  sun: AltSample[]
  moon: AltSample[]
  sunTransit: AltTransit
  moonTransit: AltTransit
  // Fractional position (0..1 across the 24h) of "now", or null when the shown
  // day isn't today in the city's zone (so the marker only appears for today).
  nowFraction: number | null
  // Graded twilight bands across the day, so the chart can distinguish civil /
  // nautical / astronomical twilight vs. full dark (not just "dark or not").
  // Each band is a contiguous run at one level; 'day' runs are omitted (the
  // chart's base is day). Same sun-sample source as darkSpans.
  twilightBands: { startMin: number; endMin: number; level: TwilightLevel }[]
}

// Sun-altitude twilight levels, brightest (day) to darkest (astro-dark).
export type TwilightLevel = 'day' | 'civil' | 'nautical' | 'astronomical' | 'dark'

// 5-minute sampling = 289 points/curve — smooth enough for a chart, cheap enough
// for hourly ISR. Higher-res buys nothing at chart scale.
const ALT_SAMPLE_STEP_MIN = 5

export function altitudeCurves(city: City, whenUtc: Date, nowUtc: Date): AltCurves {
  const localDate = cityLocalDateString(whenUtc, city.tz)
  const dayStartUtc = cityMidnightUtc(localDate, city.tz)
  const sun: AltSample[] = []
  const moon: AltSample[] = []
  let sunTransit: { minute: number; altitude: number } | null = null
  let moonTransit: { minute: number; altitude: number } | null = null

  for (let minute = 0; minute <= 1440; minute += ALT_SAMPLE_STEP_MIN) {
    const at = new Date(dayStartUtc.getTime() + minute * 60_000)
    const sAlt = altAz(city, { kind: 'body', name: 'Sun', body: Body.Sun }, at).altitude
    const mAlt = altAz(city, { kind: 'body', name: 'the Moon', body: Body.Moon }, at).altitude
    sun.push({ minute, altitude: sAlt })
    moon.push({ minute, altitude: mAlt })
    if (!sunTransit || sAlt > sunTransit.altitude) sunTransit = { minute, altitude: sAlt }
    if (!moonTransit || mAlt > moonTransit.altitude) moonTransit = { minute, altitude: mAlt }
  }

  const transitToLocal = (t: { minute: number; altitude: number } | null): AltTransit =>
    t && t.altitude > 0
      ? { hhmm: formatLocalHHMM(new Date(dayStartUtc.getTime() + t.minute * 60_000), city.tz), altitude: t.altitude }
      : null

  // Graded twilight: classify each sun sample by altitude, then run-length-
  // encode consecutive same-level samples into bands. Reads straight off the sun
  // samples so it can't drift from the chart (unlike night-based twilightPhases,
  // whose dawn belongs to the NEXT calendar day). Yields the after-midnight tail
  // AND the evening span. 'day' runs are dropped (the chart base is day).
  // Thresholds are the standard twilight definitions.
  const levelForSun = (alt: number): TwilightLevel => {
    if (alt >= 0) return 'day'
    if (alt >= -6) return 'civil'
    if (alt >= -12) return 'nautical'
    if (alt >= -18) return 'astronomical'
    return 'dark'
  }
  const twilightBands: { startMin: number; endMin: number; level: TwilightLevel }[] = []
  let bandLevel: TwilightLevel | null = null
  let bandStart = 0
  for (const s of sun) {
    const lvl = levelForSun(s.altitude)
    if (lvl !== bandLevel) {
      if (bandLevel !== null && bandLevel !== 'day') twilightBands.push({ startMin: bandStart, endMin: s.minute, level: bandLevel })
      bandLevel = lvl
      bandStart = s.minute
    }
  }
  if (bandLevel !== null && bandLevel !== 'day') twilightBands.push({ startMin: bandStart, endMin: 1440, level: bandLevel })

  // "now" marker only when the shown day IS today in the city's zone.
  const showsToday = cityLocalDateString(nowUtc, city.tz) === localDate
  const nowFraction = showsToday
    ? Math.min(1, Math.max(0, (nowUtc.getTime() - dayStartUtc.getTime()) / (1440 * 60_000)))
    : null

  return {
    dayStartUtc,
    sun,
    moon,
    sunTransit: transitToLocal(sunTransit),
    moonTransit: transitToLocal(moonTransit),
    nowFraction,
    twilightBands,
  }
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

// ============================================================================
// NIGHTLY SKY-CONDITIONS CARD — twilight phases, planet visibility, moon-in-dark.
// All server-side, all formatted into the city's own IANA zone (DST-correct).
// ============================================================================

// A local instant + its "HH:MM" in the city zone, or null when the event doesn't
// occur (polar day, never-dark summer, planet that never rises, etc.).
type LocalTime = { hhmm: string; date: Date } | null

function localTime(date: Date | undefined | null, tz: string): LocalTime {
  return date ? { hhmm: formatLocalHHMM(date, tz), date } : null
}

// ---- Twilight ----
// The full darkness ladder for a night: sunset → civil → nautical → astronomical
// dusk, then astronomical → nautical → civil dawn → sunrise. ASTRONOMICAL dark
// (sun below -18°) is the one that matters — a session can properly start then.
// Any phase can be null (high-latitude summer never reaches it — honest, not a bug).
export type TwilightPhases = {
  sunset: LocalTime
  civilDusk: LocalTime // sun -6°
  nauticalDusk: LocalTime // sun -12°
  astroDusk: LocalTime // sun -18° — "session can start"
  astroDawn: LocalTime // sun -18° rising
  nauticalDawn: LocalTime
  civilDawn: LocalTime
  sunrise: LocalTime
}

export function twilightPhases(city: City, whenUtc: Date): TwilightPhases {
  const observer = new Observer(city.lat, city.lon, city.height)
  const localDate = cityLocalDateString(whenUtc, city.tz)
  const midnight = cityMidnightUtc(localDate, city.tz)
  const noon = new Date(midnight.getTime() + 12 * 3600_000) // this day's local noon

  // "Tonight" is the night that STARTS this evening: sunset on day D, through to
  // sunrise the MORNING AFTER (D+1). So:
  //  - Dusk crossings: sun DESCENDING (-1), searched from this noon → this
  //    evening's sunset/twilight.
  const dusk = (deg: number) => localTime(SearchAltitude(Body.Sun, observer, -1, noon, 1, deg)?.date, city.tz)
  const sunset = SearchRiseSet(Body.Sun, observer, -1, noon, 1)?.date ?? null

  //  - Dawn crossings + sunrise: the FIRST ascending crossing AFTER tonight's
  //    sunset — i.e. searched forward from just after sunset (not from the next
  //    calendar noon, which would skip a whole day and land on the morning of
  //    D+2 — the bug that put planet peaks in daylight). Fall back to this
  //    evening + 4h if sunset is somehow absent.
  const afterSunset = new Date((sunset ? sunset.getTime() : midnight.getTime() + 20 * 3600_000) + 60_000)
  const dawn = (deg: number) => localTime(SearchAltitude(Body.Sun, observer, +1, afterSunset, 1, deg)?.date, city.tz)

  return {
    sunset: localTime(sunset, city.tz),
    civilDusk: dusk(-6),
    nauticalDusk: dusk(-12),
    astroDusk: dusk(-18),
    astroDawn: dawn(-18),
    nauticalDawn: dawn(-12),
    civilDawn: dawn(-6),
    sunrise: localTime(SearchRiseSet(Body.Sun, observer, +1, afterSunset, 1)?.date, city.tz),
  }
}

// ---- Moon during the dark window ----
// The distinction you care about: is the Moon UP during astronomical dark? A
// moon-free dark window is a deep-sky night; moon-up-all-night is a bright night.
export type MoonWindow = {
  moonrise: LocalTime
  moonset: LocalTime
  // Plain verdict about the moon vs. the dark window.
  verdict: string
  moonFreeDark: boolean // true = dark window has no moon in it (best for deep sky)
}

export function moonDuringDark(city: City, whenUtc: Date, tw: TwilightPhases): MoonWindow {
  const observer = new Observer(city.lat, city.lon, city.height)
  const localDate = cityLocalDateString(whenUtc, city.tz)
  const midnight = cityMidnightUtc(localDate, city.tz)
  const noon = new Date(midnight.getTime() + 12 * 3600_000) // this day's local noon

  // NIGHT-PAIRING: "tonight" is the night that STARTS this evening. Search both
  // moonrise and moonset forward from NOON so they belong to the SAME night and
  // stay in order. Searching both from midnight (the old bug) paired this night's
  // rise with the PREVIOUS night's set — e.g. "rises 20:58 · sets 06:46" where
  // that 06:46 set happened ~14h before the rise. The set following a pre-
  // midnight rise is the next morning's (~07:48), which is what a guest needs.
  const mr = SearchRiseSet(Body.Moon, observer, +1, noon, 1)
  const moonrise = localTime(mr?.date, city.tz)
  // Moonset = the first set AFTER that rise (so the pair is one contiguous
  // moon-up span). Fall back to searching from noon if the rise is absent.
  const setSearchFrom = mr?.date ? new Date(mr.date.getTime() + 60_000) : noon
  const ms = SearchRiseSet(Body.Moon, observer, -1, setSearchFrom, 1)
  const moonset = localTime(ms?.date, city.tz)

  // If there's no astronomical dark window at all, say so.
  if (!tw.astroDusk || !tw.astroDawn) {
    return { moonrise, moonset, verdict: 'The sky never gets fully dark tonight (northern summer).', moonFreeDark: false }
  }
  const darkStart = tw.astroDusk.date.getTime()
  const darkEnd = tw.astroDawn.date.getTime()

  // How much of the dark window the Moon is actually up (fraction 0..1), and how
  // bright it is. Both matter: a 19%-lit crescent that sets soon after dark is
  // effectively a dark night, NOT "bright skies" — the old check flagged ANY
  // moon-up moment as bright, which was too strict.
  const STEPS = 24
  let upSamples = 0
  for (let i = 0; i <= STEPS; i++) {
    const t = new Date(darkStart + ((darkEnd - darkStart) * i) / STEPS)
    const eq = Equator(Body.Moon, t, observer, true, true)
    const hor = Horizon(t, observer, eq.ra, eq.dec, 'normal')
    if (hor.altitude > 0) upSamples++
  }
  const upFraction = upSamples / (STEPS + 1)
  const illum = moonInfo(whenUtc).illumPercent // 0..100

  // "Effective moonlight" for the dark window ≈ how much of it the moon is up ×
  // how bright the moon is. A dark night is: moon down most of the window, OR a
  // dim crescent even if up. We call it moon-free/good for deep sky when that
  // product is low.
  const brightUp = upFraction * (illum / 100)

  let verdict: string
  let moonFreeDark: boolean
  if (upFraction < 0.05) {
    // Moon essentially never up during dark.
    moonFreeDark = true
    verdict = moonset
      ? `Moon-free dark skies (it sets at ${moonset.hhmm}) — ideal for galaxies and nebulae.`
      : 'Moon-free dark skies tonight — ideal for galaxies and nebulae.'
  } else if (brightUp < 0.15) {
    // Up for part of the window but dim and/or brief — effectively dark.
    moonFreeDark = true
    const setNote = moonset && upFraction < 0.6 ? ` It sets at ${moonset.hhmm}, leaving the rest of the night dark.` : ''
    verdict = `A ${illum}%-lit moon${upFraction < 0.6 ? ' for part of the night' : ''} — dark enough for galaxies and nebulae.${setNote}`
  } else if (brightUp < 0.45) {
    // Some real moonlight for a good chunk of the night.
    moonFreeDark = false
    verdict = `A ${illum}%-lit moon is up for some of the dark window — deep-sky objects still show, brightest targets best.`
  } else {
    // Bright and up most of the night.
    moonFreeDark = false
    verdict = `A bright ${illum}%-lit moon is up through much of the night — best for the Moon, planets and bright targets; faint objects wash out.`
  }
  return { moonrise, moonset, verdict, moonFreeDark }
}

// ============================================================================
// V2 NIGHT SUMMARY — the verdict-first model (see /sky-calendar-v2).
// Kept SEPARATE from the live-page functions above so v2 can iterate without
// touching production. The headline metric is MOONLESS DARK: the dark window
// intersected with the moon being below the horizon — the number that actually
// decides a night (a 99% moon up all night makes 6h of "dark" worth ~nothing).
// ============================================================================

// Half-open time interval as epoch-ms [start, end).
export type Interval = [number, number]

// Subtract b-intervals from a-intervals (a \ b). Both need not be sorted; result
// is sorted, gaps < 1 min dropped. Used for dark \ moon-up = moonless.
function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  let cur = a.map((x) => [...x] as Interval)
  for (const [bs, be] of b) {
    const next: Interval[] = []
    for (const [s, e] of cur) {
      if (be <= s || bs >= e) {
        next.push([s, e])
        continue
      }
      if (bs > s) next.push([s, Math.min(bs, e)])
      if (be < e) next.push([Math.max(be, s), e])
    }
    cur = next
  }
  return cur.filter(([s, e]) => e - s > 60_000).sort((x, y) => x[0] - y[0])
}

function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s) / 60_000, 0)
}

// The moon's above-horizon intervals within [winStart, winEnd], found by
// sampling + refining at the sign changes (astronomy-engine has no direct
// interval API). 2-min sampling is ample for a bar drawn to the minute.
function moonUpIntervals(city: City, winStart: Date, winEnd: Date): Interval[] {
  const observer = new Observer(city.lat, city.lon, city.height)
  const moonAlt = (t: number) => {
    const eq = Equator(Body.Moon, new Date(t), observer, true, true)
    return Horizon(new Date(t), observer, eq.ra, eq.dec, 'normal').altitude
  }
  const s = winStart.getTime()
  const e = winEnd.getTime()
  const step = 2 * 60_000
  const out: Interval[] = []
  let runStart: number | null = moonAlt(s) > 0 ? s : null
  let prevT = s
  let prevUp = moonAlt(s) > 0
  for (let t = s + step; t <= e; t += step) {
    const up = moonAlt(t) > 0
    if (up !== prevUp) {
      // bisect the crossing between prevT and t
      let lo = prevT
      let hi = t
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2
        if (moonAlt(mid) > 0 === prevUp) lo = mid
        else hi = mid
      }
      const cross = (lo + hi) / 2
      if (up) runStart = cross
      else if (runStart !== null) {
        out.push([runStart, cross])
        runStart = null
      }
    }
    prevT = t
    prevUp = up
  }
  if (runStart !== null) out.push([runStart, e])
  return out
}

export type NightGrade = 'dark' | 'mixed' | 'bright' | 'no-dark'

export type NightSummary = {
  // The astronomical-dark window as intervals (usually one, but modelled as an
  // array so high-latitude / edge cases render honestly).
  darkIntervals: Interval[]
  darkMinutes: number
  darkStart: LocalTime // first dark interval start
  darkEnd: LocalTime // last dark interval end
  // Dark ∩ moon-below-horizon — the metric the hero leads with.
  moonlessIntervals: Interval[]
  moonlessMinutes: number
  // 'dark' ≥120 moonless min, 'mixed' 1–119, 'bright' 0, 'no-dark' never dark.
  grade: NightGrade
  moonIllumPct: number
  moonPhase: string
  moonWaxing: boolean
  moonIllumFraction: number
  moonrise: LocalTime
  moonset: LocalTime
}

// Compute the v2 night summary for a city + evening instant. `when` should be an
// evening instant on the target local date (same convention as the other card
// functions). Reuses twilightPhases for the dark boundaries.
export function nightSummary(city: City, when: Date, tw: TwilightPhases): NightSummary {
  const moon = moonInfo(when)
  const observer = new Observer(city.lat, city.lon, city.height)
  const localDate = cityLocalDateString(when, city.tz)
  const midnight = cityMidnightUtc(localDate, city.tz)
  const noon = new Date(midnight.getTime() + 12 * 3600_000)
  const mr = SearchRiseSet(Body.Moon, observer, +1, noon, 1)
  const moonrise = localTime(mr?.date, city.tz)
  const setFrom = mr?.date ? new Date(mr.date.getTime() + 60_000) : noon
  const moonset = localTime(SearchRiseSet(Body.Moon, observer, -1, setFrom, 1)?.date, city.tz)

  // No astronomical dark at all (high-latitude summer) — a state, not a null (§4).
  if (!tw.astroDusk || !tw.astroDawn) {
    return {
      darkIntervals: [],
      darkMinutes: 0,
      darkStart: null,
      darkEnd: null,
      moonlessIntervals: [],
      moonlessMinutes: 0,
      grade: 'no-dark',
      moonIllumPct: moon.illumPercent,
      moonPhase: moon.phaseName,
      moonWaxing: moon.waxing,
      moonIllumFraction: moon.illumFraction,
      moonrise,
      moonset,
    }
  }

  const darkIntervals: Interval[] = [[tw.astroDusk.date.getTime(), tw.astroDawn.date.getTime()]]
  const moonUp = moonUpIntervals(city, tw.astroDusk.date, tw.astroDawn.date)
  const moonlessIntervals = subtractIntervals(darkIntervals, moonUp)
  const darkMinutes = totalMinutes(darkIntervals)
  const moonlessMinutes = totalMinutes(moonlessIntervals)
  const grade: NightGrade = moonlessMinutes >= 120 ? 'dark' : moonlessMinutes >= 1 ? 'mixed' : 'bright'

  return {
    darkIntervals,
    darkMinutes,
    darkStart: tw.astroDusk,
    darkEnd: tw.astroDawn,
    moonlessIntervals,
    moonlessMinutes,
    grade,
    moonIllumPct: moon.illumPercent,
    moonPhase: moon.phaseName,
    moonWaxing: moon.waxing,
    moonIllumFraction: moon.illumFraction,
    moonrise,
    moonset,
  }
}

// ---- Planets tonight (the eyepiece experience) ----
// CRITICAL HONESTY RULE: a planet's visibility and "best time" are evaluated
// WITHIN the astronomical-dark window, NOT at its raw transit. A planet can
// culminate at 72° at 1pm and be below the horizon all night — reporting its
// daytime transit as "high in the south, best around 13:21" would be a flat lie
// to someone standing at the eyepiece. So we sample each planet's altitude
// across the dark window and report the best moment IN it (or mark it not-up).
export type PlanetTonight = {
  name: string
  visible: boolean // clears the altitude floor at some point DURING dark
  rise: LocalTime
  set: LocalTime
  bestTime: LocalTime // when it's highest DURING the dark window
  maxAltitude: number // degrees at that best moment (within dark)
  direction: string // compass at the best moment
  // Plain-language line, e.g. "Highest just before dawn — well-placed in the
  // south." When not up during dark: an honest "not up tonight from <city>".
  summary: string
}

const PLANET_BODIES: { name: string; body: Body }[] = [
  { name: 'Venus', body: Body.Venus },
  { name: 'Mars', body: Body.Mars },
  { name: 'Jupiter', body: Body.Jupiter },
  { name: 'Saturn', body: Body.Saturn },
]

// A planet is worth showing only if it clears this altitude at its best moment
// in the observable window — below it, it's genuinely lost in horizon murk. Set
// to 10°: the bright naked-eye planets (Venus especially) are clearly visible
// this low against a sea/open horizon, and the operator confirmed seeing Venus
// at ~14° — a 15° floor wrongly excluded it. 10° keeps out only the truly-lost
// (a couple of degrees, in the trees).
const MIN_PLANET_ALT_DEG = 10

function altitudeWord(alt: number): string {
  if (alt >= 45) return 'high'
  if (alt >= 25) return 'well-placed'
  return 'low'
}

// A rough "when" phrase for a best-time relative to the dark window, so the copy
// reads like a guide, not a clock: "just after dark" / "in the small hours" /
// A plain "when" phrase for a best-time within the OBSERVABLE window (sunset →
// sunrise). frac is where in that window the peak falls.
function whenPhrase(frac: number): string {
  if (frac <= 0.1) return 'in the evening twilight'
  if (frac < 0.35) return 'in the evening'
  if (frac >= 0.9) return 'just before dawn'
  if (frac > 0.65) return 'in the small hours'
  return 'around the middle of the night'
}

// Sample a body's altitude across an arbitrary [start, end] window; return the
// highest point + when/where. Used over the whole OBSERVABLE window (sunset →
// sunrise), not just full dark — a bright planet is very much visible in
// twilight (Venus, the evening star, is the textbook case: brightest low in the
// west just after sunset, gone before astronomical dark). Gating only on full
// dark wrongly declared such objects "not visible".
function bestInWindow(
  city: City,
  target: Notable,
  start: Date,
  end: Date,
): { alt: number; az: number; when: Date } {
  const STEPS = 48
  let best = { alt: -90, az: 0, when: start }
  for (let i = 0; i <= STEPS; i++) {
    const when = new Date(start.getTime() + ((end.getTime() - start.getTime()) * i) / STEPS)
    const { altitude, azimuth } = altAz(city, target, when)
    if (altitude > best.alt) best = { alt: altitude, az: azimuth, when }
  }
  return best
}

function planetTonight(
  city: City,
  whenUtc: Date,
  name: string,
  body: Body,
  tw: TwilightPhases,
): PlanetTonight {
  const observer = new Observer(city.lat, city.lon, city.height)
  const localDate = cityLocalDateString(whenUtc, city.tz)
  const midnight = cityMidnightUtc(localDate, city.tz)
  const noon = new Date(midnight.getTime() + 12 * 3600_000)
  // Night-pair rise/set from noon, same fix as the moon (see moonDuringDark):
  // both belong to the night starting this evening, and the set follows the rise.
  const riseEv = SearchRiseSet(body, observer, +1, noon, 1)
  const rise = localTime(riseEv?.date, city.tz)
  const setSearchFrom = riseEv?.date ? new Date(riseEv.date.getTime() + 60_000) : noon
  const set = localTime(SearchRiseSet(body, observer, -1, setSearchFrom, 1)?.date, city.tz)

  // CORRECTNESS (handoff §3.2): the "best time / highest" must be measured INSIDE
  // the astronomical-dark window — not sunset→sunrise. Measuring across twilight
  // let a planet's peak land AFTER first light (e.g. Saturn "57° at 05:38", past
  // a 04:33 first light), advertising an altitude reached in dawn twilight, not
  // dark. So: peak within dark first; only if it's weak in dark do we consider a
  // twilight peak (the twilight_only case that keeps Venus/Mercury honest).
  const haveDark = !!tw.astroDusk && !!tw.astroDawn
  const darkStart = tw.astroDusk?.date ?? tw.sunset?.date ?? midnight
  const darkEnd = tw.astroDawn?.date ?? tw.sunrise?.date ?? new Date(midnight.getTime() + 24 * 3600_000)
  const twStart = tw.sunset?.date ?? midnight
  const twEnd = tw.sunrise?.date ?? new Date(midnight.getTime() + 24 * 3600_000)

  const target: Notable = { kind: 'body', name, body }
  const bestDark = bestInWindow(city, target, darkStart, darkEnd)
  const bestTwi = bestInWindow(city, target, twStart, twEnd)

  // TWILIGHT-ONLY: too low in dark to be worth a dark peak (<5°), but reaches a
  // usable altitude (≥8°) somewhere in twilight — an inherently twilight object.
  const twilightOnly = bestDark.alt < 5 && bestTwi.alt >= 8
  const best = twilightOnly ? bestTwi : bestDark
  const winStart = twilightOnly ? twStart : darkStart
  const winEnd = twilightOnly ? twEnd : darkEnd

  const direction = azimuthToCompass(best.az)
  const bestTime = localTime(best.when, city.tz)
  const visible = best.alt >= MIN_PLANET_ALT_DEG || (twilightOnly && best.alt >= 8)

  // BOUNDARY GUARD (handoff §6): a peak sitting within ~5 min of the window edge
  // was still climbing/sinking when the window closed — not a real culmination.
  const edgeMs = 5 * 60_000
  const atStart = best.when.getTime() - winStart.getTime() < edgeMs
  const atEnd = winEnd.getTime() - best.when.getTime() < edgeMs

  let summary: string
  if (!visible) {
    summary = haveDark
      ? (bestDark.alt < 0
          ? `Not up tonight from ${city.name} — it stays below the horizon while it's dark.`
          : `Very low from ${city.name} tonight — it never clears the horizon murk, hard to catch.`)
      : `The sky never gets fully dark tonight from ${city.name}.`
  } else {
    const frac = (best.when.getTime() - winStart.getTime()) / (winEnd.getTime() - winStart.getTime())
    const phrase = whenPhrase(frac)
    const word = altitudeWord(best.alt)
    const lead = word === 'high' ? 'High' : word === 'well-placed' ? 'Well-placed' : 'Low'
    const twNote = twilightOnly ? ', a bright twilight object' : ''
    if (atEnd) {
      summary = `Still climbing when the sky brightens${bestTime ? ` at ${bestTime.hhmm}` : ''} — reaches ${Math.round(best.alt)}° in the ${direction}${twNote}.`
    } else if (atStart) {
      summary = `Already ${Math.round(best.alt)}° as darkness falls${bestTime ? ` (${bestTime.hhmm})` : ''}, then sinking — in the ${direction}${twNote}.`
    } else {
      summary = `${lead} ${phrase}${bestTime ? ` (around ${bestTime.hhmm})` : ''} — in the ${direction}${twNote}.`
    }
  }
  return { name, visible, rise, set, bestTime, maxAltitude: best.alt, direction, summary }
}

// Mercury: only include when it's genuinely observable this night — a decent
// elongation from the Sun AND clearing the altitude floor during a dark-ish
// window. Otherwise omitted entirely (no "not visible" clutter).
const MERCURY_MIN_ELONGATION_DEG = 12

function mercuryTonight(city: City, whenUtc: Date, tw: TwilightPhases): PlanetTonight | null {
  const el = Elongation(Body.Mercury, whenUtc)
  if (el.elongation < MERCURY_MIN_ELONGATION_DEG) return null
  const p = planetTonight(city, whenUtc, 'Mercury', Body.Mercury, tw)
  if (!p.visible) return null
  const endWord = el.visibility === 'morning' ? 'low before dawn' : 'low after sunset'
  return { ...p, summary: `Just catchable ${endWord} in the ${p.direction} — a tricky one.` }
}

// All planets worth naming tonight for a city (visible-during-dark first, then
// the not-up ones with an honest note so nothing is silently missing).
export function planetsTonight(city: City, whenUtc: Date, tw: TwilightPhases): PlanetTonight[] {
  const out = PLANET_BODIES.map((p) => planetTonight(city, whenUtc, p.name, p.body, tw))
  const mercury = mercuryTonight(city, whenUtc, tw)
  if (mercury) out.push(mercury)
  return out.sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1
    return b.maxAltitude - a.maxAltitude
  })
}

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
