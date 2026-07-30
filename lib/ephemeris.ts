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
  // Minutes-from-local-midnight where the Sun is below -18° (astronomical dark),
  // as [start,end) spans WITHIN this calendar day. Derived from the sun samples
  // themselves, so the chart's shaded night always matches its own x-axis (a
  // full calendar day shows TWO dark spans: after-midnight tail + evening).
  darkSpans: { startMin: number; endMin: number }[]
}

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

  // Astronomical-dark spans: contiguous runs where the sampled Sun altitude is
  // below -18°. Reads straight off the sun samples so it can't drift from the
  // chart (unlike the night-based twilightPhases, whose dawn belongs to the NEXT
  // calendar day). Naturally yields the after-midnight tail AND the evening span.
  const ASTRO_DARK_DEG = -18
  const darkSpans: { startMin: number; endMin: number }[] = []
  let runStart: number | null = null
  for (const s of sun) {
    const dark = s.altitude < ASTRO_DARK_DEG
    if (dark && runStart === null) runStart = s.minute
    if (!dark && runStart !== null) {
      darkSpans.push({ startMin: runStart, endMin: s.minute })
      runStart = null
    }
  }
  if (runStart !== null) darkSpans.push({ startMin: runStart, endMin: 1440 })

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
    darkSpans,
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
  const mr = SearchRiseSet(Body.Moon, observer, +1, midnight, 1)
  const ms = SearchRiseSet(Body.Moon, observer, -1, midnight, 1)
  const moonrise = localTime(mr?.date, city.tz)
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
  const rise = localTime(SearchRiseSet(body, observer, +1, midnight, 1)?.date, city.tz)
  const set = localTime(SearchRiseSet(body, observer, -1, midnight, 1)?.date, city.tz)

  // OBSERVABLE WINDOW = sunset → next sunrise. This is when a bright planet can
  // actually be seen — INCLUDING twilight, not just astronomical dark. (Venus
  // is the reason: it's an evening/morning-star, visible low in bright twilight
  // and usually gone before full dark. Gating on dark-only wrongly hid it.)
  // Fall back to the whole day if sunset/sunrise are somehow absent.
  const winStart = tw.sunset?.date ?? midnight
  const winEnd = tw.sunrise?.date ?? new Date(midnight.getTime() + 24 * 3600_000)

  const best = bestInWindow(city, { kind: 'body', name, body }, winStart, winEnd)
  const direction = azimuthToCompass(best.az)
  const bestTime = localTime(best.when, city.tz)
  const visible = best.alt >= MIN_PLANET_ALT_DEG

  // Is the best moment during full astronomical dark, or (for a low evening/
  // morning object like Venus) in twilight? Honest wording depends on it.
  const inTwilight =
    !!tw.astroDusk &&
    !!tw.astroDawn &&
    (best.when.getTime() < tw.astroDusk.date.getTime() || best.when.getTime() > tw.astroDawn.date.getTime())

  let summary: string
  if (!visible) {
    summary =
      best.alt < 0
        ? `Not up tonight from ${city.name} — it stays below the horizon after dark.`
        : `Very low from ${city.name} tonight — it never clears the horizon haze, hard to catch.`
  } else {
    const frac = (best.when.getTime() - winStart.getTime()) / (winEnd.getTime() - winStart.getTime())
    const phrase = whenPhrase(frac)
    const word = altitudeWord(best.alt)
    const lead = word === 'high' ? 'High' : word === 'well-placed' ? 'Well-placed' : 'Low'
    // For a genuinely-low twilight object, say so plainly (Venus: "Low in the
    // evening twilight, around 21:14 — in the west").
    const tw2 = inTwilight && best.alt < 25 ? ', a bright evening/morning object' : ''
    summary = `${lead} ${phrase}${bestTime ? ` (around ${bestTime.hhmm})` : ''} — in the ${direction}${tw2}.`
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
