// Upcoming celestial events for the sky-calendar — eclipses (computed offline
// from astronomy-engine) and meteor-shower peaks (a static annual table; showers
// recur on ~fixed calendar dates each year). Pure + server-side; the page ships
// only the resulting strings.
//
// Honesty: eclipse VISIBILITY is location-dependent and we don't compute local
// circumstances here, so each eclipse says "visible where?" plainly rather than
// implying it's overhead. Meteor peaks are the globally-standard dates; the
// actual show depends on moonlight and sky darkness (which THIS page already
// tells the user).

import { SearchLunarEclipse, NextLunarEclipse, SearchGlobalSolarEclipse, NextGlobalSolarEclipse } from 'astronomy-engine'

export type CelestialEvent = {
  date: string // "YYYY-MM-DD" (UTC date of the peak/maximum)
  daysAway: number
  kind: 'lunar-eclipse' | 'solar-eclipse' | 'meteor-shower'
  title: string
  detail: string // one plain-language line
}

// ---- Meteor showers (static annual peaks) ----
// Month/day of the PEAK night + a short note. These recur yearly; we project the
// next occurrence from "now". Kept to the reliably-good showers a guest could
// actually enjoy (skips minor/unreliable ones).
const METEOR_SHOWERS: { name: string; peakMonth: number; peakDay: number; note: string }[] = [
  { name: 'Quadrantids', peakMonth: 1, peakDay: 3, note: 'Sharp peak, up to ~40/hour — brief but rich.' },
  { name: 'Lyrids', peakMonth: 4, peakDay: 22, note: 'Modest but reliable, ~15/hour.' },
  { name: 'Eta Aquariids', peakMonth: 5, peakDay: 6, note: 'Fast meteors from Halley’s Comet, best before dawn.' },
  { name: 'Perseids', peakMonth: 8, peakDay: 12, note: 'The summer favourite — up to ~100/hour, warm nights.' },
  { name: 'Orionids', peakMonth: 10, peakDay: 21, note: 'Halley’s Comet again, ~20/hour.' },
  { name: 'Leonids', peakMonth: 11, peakDay: 17, note: 'Fast and bright, ~15/hour.' },
  { name: 'Geminids', peakMonth: 12, peakDay: 14, note: 'The year’s best — up to ~120/hour, bright and slow.' },
]

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

// Next meteor-shower peaks within the horizon (days), projected to this or next year.
function upcomingMeteorShowers(now: Date, horizonDays: number): CelestialEvent[] {
  const out: CelestialEvent[] = []
  for (const s of METEOR_SHOWERS) {
    // This year's peak, or next year's if already past.
    let peak = new Date(Date.UTC(now.getUTCFullYear(), s.peakMonth - 1, s.peakDay, 22, 0, 0))
    if (peak.getTime() < now.getTime() - 86_400_000) {
      peak = new Date(Date.UTC(now.getUTCFullYear() + 1, s.peakMonth - 1, s.peakDay, 22, 0, 0))
    }
    const daysAway = daysBetween(now, peak)
    if (daysAway >= 0 && daysAway <= horizonDays) {
      out.push({
        date: ymdUtc(peak),
        daysAway,
        kind: 'meteor-shower',
        title: `${s.name} meteor shower`,
        detail: `Peak night. ${s.note}`,
      })
    }
  }
  return out
}

// ---- Eclipses (computed) ----
function eclipseKindWord(kind: string): string {
  // astronomy-engine EclipseKind: 'partial' | 'penumbral' | 'total' | 'annular'
  return kind
}

function upcomingEclipses(now: Date, horizonDays: number): CelestialEvent[] {
  const out: CelestialEvent[] = []
  const horizonMs = now.getTime() + horizonDays * 86_400_000

  // Lunar: walk forward from now, collecting eclipses within the horizon.
  try {
    let ecl = SearchLunarEclipse(now)
    for (let i = 0; i < 12 && ecl.peak.date.getTime() <= horizonMs; i++) {
      if (ecl.peak.date.getTime() >= now.getTime()) {
        out.push({
          date: ymdUtc(ecl.peak.date),
          daysAway: daysBetween(now, ecl.peak.date),
          kind: 'lunar-eclipse',
          title: `${eclipseKindWord(ecl.kind).replace(/^\w/, (c) => c.toUpperCase())} lunar eclipse`,
          detail:
            ecl.kind === 'total'
              ? 'The Moon turns deep red — visible from the whole night side of Earth (check if it’s up for you).'
              : 'A shadow crosses part of the Moon — visible wherever the Moon is up at the time.',
        })
      }
      ecl = NextLunarEclipse(ecl.peak.date)
    }
  } catch {
    // ephemeris hiccup — skip lunar eclipses rather than throw
  }

  // Solar: same walk.
  try {
    let ecl = SearchGlobalSolarEclipse(now)
    for (let i = 0; i < 12 && ecl.peak.date.getTime() <= horizonMs; i++) {
      if (ecl.peak.date.getTime() >= now.getTime()) {
        out.push({
          date: ymdUtc(ecl.peak.date),
          daysAway: daysBetween(now, ecl.peak.date),
          kind: 'solar-eclipse',
          title: `${eclipseKindWord(ecl.kind).replace(/^\w/, (c) => c.toUpperCase())} solar eclipse`,
          detail: 'Only visible along a narrow track on Earth — check whether it passes near you (never look at the Sun unprotected).',
        })
      }
      ecl = NextGlobalSolarEclipse(ecl.peak.date)
    }
  } catch {
    // skip solar eclipses on error
  }

  return out
}

// Everything coming up within `horizonDays` (default ~120 = a season ahead),
// soonest first. Server-side, pure.
export function upcomingCelestialEvents(now: Date, horizonDays = 120): CelestialEvent[] {
  const events = [...upcomingMeteorShowers(now, horizonDays), ...upcomingEclipses(now, horizonDays)]
  events.sort((a, b) => a.daysAway - b.daysAway)
  return events
}
