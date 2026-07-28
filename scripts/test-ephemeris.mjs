// Tests for the shared ephemeris layer (lib/ephemeris.ts). Verifies the maths
// against known-good values, the DST/timezone honesty (the load-bearing
// correctness rule — each city's times in its OWN zone), and honest null
// handling. Uses fixed instants so results are deterministic.
//
// Run with: node --import tsx scripts/test-ephemeris.mjs
import {
  CITIES,
  cityById,
  sunMoonTimes,
  moonInfo,
  visibleNotables,
  altAz,
  isDarkEnough,
  azimuthToCompass,
  zoneAbbrev,
  NOTABLES,
  twilightPhases,
  planetsTonight,
  moonDuringDark,
} from '../lib/ephemeris.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
// HH:MM within +/- tolMin of an expected HH:MM (rise/set is ~1min accurate; a
// small tolerance keeps the test robust without being meaningless).
function timeNear(actual, expectedHHMM, tolMin) {
  if (!actual) return false
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
  return Math.abs(toMin(actual) - toMin(expectedHHMM)) <= tolMin
}

const kos = cityById('kos')
const london = cityById('london')
const berlin = cityById('berlin')

// A summer instant (DST active in all EU zones) and a winter one (DST off).
const SUMMER = new Date('2026-07-28T18:00:00Z')
const WINTER = new Date('2026-01-15T18:00:00Z')

// ---- config ----
assert('5 cities configured', CITIES.length === 5)
assert('cities have IANA zones', CITIES.every((c) => typeof c.tz === 'string' && c.tz.includes('/')))
assert('adding-a-city is config-only (Athens present)', !!cityById('athens'))

// ---- DST honesty: the zone abbreviation reflects DST for the instant ----
assert('Kos summer -> EEST (DST)', zoneAbbrev(SUMMER, kos.tz) === 'EEST', zoneAbbrev(SUMMER, kos.tz))
assert('Kos winter -> EET (no DST)', zoneAbbrev(WINTER, kos.tz) === 'EET', zoneAbbrev(WINTER, kos.tz))
assert('London summer -> BST', zoneAbbrev(SUMMER, london.tz) === 'BST', zoneAbbrev(SUMMER, london.tz))
assert('London winter -> GMT', zoneAbbrev(WINTER, london.tz) === 'GMT', zoneAbbrev(WINTER, london.tz))
assert('Berlin summer -> CEST', zoneAbbrev(SUMMER, berlin.tz) === 'CEST', zoneAbbrev(SUMMER, berlin.tz))

// ---- sun/moon times: known-good values (verified against the smoke test) ----
{
  const t = sunMoonTimes(kos, SUMMER)
  assert('Kos date is local', t.localDate === '2026-07-28')
  assert('Kos times labelled EEST', t.tzAbbrev === 'EEST')
  // Kos 28-07: sunrise ~06:12, sunset ~20:21 local (EEST = UTC+3).
  assert('Kos sunrise ~06:12 EEST', timeNear(t.sunrise, '06:12', 3), t.sunrise)
  assert('Kos sunset ~20:21 EEST', timeNear(t.sunset, '20:21', 3), t.sunset)
  assert('Kos has a dark-from time in summer', typeof t.darkFrom === 'string', String(t.darkFrom))
  // dark-from must be AFTER sunset.
  assert('Kos dark-from is after sunset', t.darkFrom > t.sunset, `${t.sunset} -> ${t.darkFrom}`)
}

// ---- DST correctness across cities: sunset differs by the RIGHT offset ----
{
  // Same instant, Kos (UTC+3 summer) vs London (UTC+1 summer). London is west +
  // 2h behind the clock, so its sunset WALL time isn't a simple shift — but both
  // must be plausible evening times and labelled with the right zone.
  const kosT = sunMoonTimes(kos, SUMMER)
  const lonT = sunMoonTimes(london, SUMMER)
  assert('London times labelled BST', lonT.tzAbbrev === 'BST')
  assert('London summer sunset is late evening (20:00-22:00 BST)', lonT.sunset >= '20:00' && lonT.sunset <= '22:00', lonT.sunset)
  // London high-summer: nautical dark may never arrive -> darkFrom null is HONEST.
  assert('London darkFrom is null-or-late (honest high-latitude summer)', lonT.darkFrom === null || lonT.darkFrom >= '22:30', String(lonT.darkFrom))
}

// ---- moon phase: known value + verdict wiring ----
{
  const m = moonInfo(SUMMER)
  // 28-07-2026 is near full (verified ~99% in the smoke test).
  assert('moon ~near-full on 28-07', m.illumPercent >= 90, `${m.illumPercent}%`)
  assert('moon phase name present', typeof m.phaseName === 'string' && m.phaseName.length > 0, m.phaseName)
  assert('bright moon -> washout note', m.stargazingNote.includes('wash') || m.stargazingNote.includes('Bright'), m.stargazingNote)
  // A dark-moon instant gives the ideal note.
  const newish = moonInfo(new Date('2026-08-12T20:00:00Z')) // near new moon
  assert('near-new moon -> low illum', newish.illumPercent <= 20, `${newish.illumPercent}%`)
  assert('dark moon -> ideal note', newish.stargazingNote.toLowerCase().includes('ideal') || newish.stargazingNote.toLowerCase().includes('dark'), newish.stargazingNote)
}

// ---- compass + visibility gating ----
assert('azimuth 135 -> southeast', azimuthToCompass(135) === 'southeast')
assert('azimuth 0 -> north', azimuthToCompass(0) === 'north')
assert('azimuth 350 -> north (wrap)', azimuthToCompass(350) === 'north')
assert('azimuth 225 -> southwest', azimuthToCompass(225) === 'southwest')

// Daylight gate: at noon UTC over Kos it is broad daylight -> NOTHING notable.
{
  const noon = new Date('2026-07-28T09:00:00Z') // ~noon local Kos
  assert('daylight -> not dark enough', isDarkEnough(kos, noon) === false)
  assert('daylight -> visibleNotables empty (silence beats wrong)', visibleNotables(kos, noon).length === 0)
}

// The smoke-test anchor: Saturn from Kos at 28-07 20:00 UTC was BELOW the horizon
// (-5.8deg), so it must NOT appear as visible — the maths gates itself.
{
  const saturn = NOTABLES.find((n) => n.name === 'Saturn')
  const { altitude } = altAz(kos, saturn, new Date('2026-07-28T20:00:00Z'))
  assert('Saturn below horizon at test instant (self-gating)', altitude < 0, `${altitude.toFixed(1)}deg`)
}

// After true dark, SOMETHING among the notables should be up on a normal night
// (sanity that the pipeline surfaces objects at all when it should).
{
  const lateNight = new Date('2026-07-28T22:30:00Z') // ~01:30 local Kos, deep night
  const vis = visibleNotables(kos, lateNight)
  assert('deep night -> some notable is up', vis.length >= 1, `count=${vis.length}`)
  assert('visible entries carry a compass direction', vis.every((v) => typeof v.direction === 'string' && v.direction.length > 0))
  assert('visible entries are above the 15deg floor', vis.every((v) => v.altitude >= 15))
  assert('sorted highest-first', vis.every((v, i) => i === 0 || vis[i - 1].altitude >= v.altitude))
}

// ---- NIGHTLY CONDITIONS: twilight ladder ----
{
  const tw = twilightPhases(kos, SUMMER)
  // Kos 28-07 (verified): sunset 20:21, civil 20:50, nautical 21:25, ASTRO 22:03 EEST.
  assert('twilight: sunset ~20:21', timeNear(tw.sunset?.hhmm, '20:21', 3), tw.sunset?.hhmm)
  assert('twilight: civil dusk ~20:50', timeNear(tw.civilDusk?.hhmm, '20:50', 4), tw.civilDusk?.hhmm)
  assert('twilight: nautical dusk ~21:25', timeNear(tw.nauticalDusk?.hhmm, '21:25', 4), tw.nauticalDusk?.hhmm)
  assert('twilight: ASTRO dark ~22:03 (the session-start number)', timeNear(tw.astroDusk?.hhmm, '22:03', 5), tw.astroDusk?.hhmm)
  assert('twilight: astro dawn ~04:31', timeNear(tw.astroDawn?.hhmm, '04:31', 6), tw.astroDawn?.hhmm)
  // Ladder ordering: dusk phases get progressively later.
  assert('twilight: dusk ladder ordered', tw.sunset.hhmm < tw.civilDusk.hhmm && tw.civilDusk.hhmm < tw.nauticalDusk.hhmm && tw.nauticalDusk.hhmm < tw.astroDusk.hhmm)
}
// High-latitude summer: astro dark can be null — HONEST, must not throw.
{
  // Berlin in deep June never reaches -18deg. Use a June instant.
  const JUNE = new Date('2026-06-21T18:00:00Z')
  const twB = twilightPhases(berlin, JUNE)
  assert('Berlin midsummer: astro dark is null (never fully dark)', twB.astroDusk === null, String(twB.astroDusk?.hhmm))
  // planetsTonight must handle the no-dark case without throwing. Planets CAN
  // still be visible in twilight even when it never gets astronomically dark
  // (bright planets over Berlin in June) — the observable window is sunset→
  // sunrise, not dark-only. So we assert it runs and returns a well-formed
  // list, not that everything is hidden.
  const planets = planetsTonight(berlin, JUNE, twB)
  assert('no-dark night: planetsTonight returns a well-formed list (no throw)', Array.isArray(planets) && planets.length >= 4 && planets.every((p) => typeof p.visible === 'boolean' && typeof p.summary === 'string'))
}

// ---- NIGHTLY CONDITIONS: planets over the OBSERVABLE window (sunset→sunrise,
//      incl. twilight — the Venus fix) ----
{
  const tw = twilightPhases(kos, SUMMER)
  // The window must be ONE night (~10h), not spill into the next day (~34h) —
  // the daytime-peak regression this fixed.
  const winHours = (tw.sunrise.date.getTime() - tw.sunset.date.getTime()) / 3600_000
  assert('observable window is one night (~8-14h, not 30+)', winHours > 6 && winHours < 16, `${winHours.toFixed(1)}h`)

  const planets = planetsTonight(kos, SUMMER, tw)
  const byName = Object.fromEntries(planets.map((p) => [p.name, p]))
  // Verified 28-07 Kos: Saturn high before dawn; Venus VISIBLE low in evening
  // twilight (~24deg, the operator saw it ~21:14); Jupiter genuinely too low.
  assert('Saturn visible (~57deg before dawn)', byName.Saturn?.visible === true && byName.Saturn.maxAltitude > 40, `${byName.Saturn?.maxAltitude?.toFixed(0)}`)
  assert('VENUS now visible (was wrongly hidden — the twilight fix)', byName.Venus?.visible === true, `visible=${byName.Venus?.visible} alt=${byName.Venus?.maxAltitude?.toFixed(0)}`)
  assert('Venus line reads as an evening-twilight object', /evening/i.test(byName.Venus.summary), byName.Venus.summary)
  assert('Jupiter honestly not up (very low / not up copy)', byName.Jupiter?.visible === false && /not up|very low/i.test(byName.Jupiter.summary), byName.Jupiter.summary)
  // Regression guard: every visible planet clears the 10deg floor and has a
  // best-time (never the old daytime-transit null/garbage).
  assert('every visible planet clears 10deg + has a best time', planets.filter((p) => p.visible).every((p) => p.maxAltitude >= 10 && p.bestTime !== null))
  const firstNotVisible = planets.findIndex((p) => !p.visible)
  assert('visible planets sorted before not-up ones', firstNotVisible === -1 || planets.slice(firstNotVisible).every((p) => !p.visible))
}

// ---- NIGHTLY CONDITIONS: moon during the dark window ----
{
  const tw = twilightPhases(kos, SUMMER)
  const md = moonDuringDark(kos, SUMMER, tw)
  // 28-07 near-full moon is up most of the night -> "up during the dark window".
  assert('moon-during-dark verdict present', typeof md.verdict === 'string' && md.verdict.length > 0)
  assert('near-full moon flagged up-during-dark (not moon-free)', md.moonFreeDark === false, md.verdict)
  // A near-new-moon night should read moon-free.
  const NEWISH = new Date('2026-08-12T20:00:00Z')
  const twN = twilightPhases(kos, NEWISH)
  const mdN = moonDuringDark(kos, NEWISH, twN)
  assert('near-new-moon night can be moon-free dark', mdN.moonFreeDark === true, mdN.verdict)

  // The graded fix: a DIM crescent that sets soon after dark = still a dark
  // night, NOT "bright skies". 16-08-2026 Kos: ~19% moon, sets ~21:51 just as
  // dark begins. Must read moon-free / dark-enough, not bright.
  const CRESC = new Date('2026-08-16T18:00:00Z')
  const twC = twilightPhases(kos, CRESC)
  const mdC = moonDuringDark(kos, CRESC, twC)
  assert('dim crescent that sets early -> dark-enough, not bright', mdC.moonFreeDark === true, mdC.verdict)
  assert('crescent verdict does NOT claim bright skies', !/bright/i.test(mdC.verdict), mdC.verdict)
}

console.log('')
if (failures > 0) { console.log(`${failures} ephemeris test(s) FAILED`); process.exit(1) }
console.log('All ephemeris tests passed.')
