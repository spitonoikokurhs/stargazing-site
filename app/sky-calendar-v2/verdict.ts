// Verdict-first copy for /sky-calendar-v2. Pure functions: given the computed
// night + planets, produce the hero headline and the "How we'd play it" expert
// read. Auto-generated from the data (rules over moon %, moonless hours, and
// which planets are well-placed) so it's always live and never stale; the
// wording is templated and can later be swapped for hand-written lines per
// scenario without changing callers.

import type { NightSummary, PlanetTonight } from '@/lib/ephemeris'

// The one-line hero headline — the "answer a guest came for."
export function verdictHeadline(night: NightSummary): string {
  switch (night.grade) {
    case 'no-dark':
      return 'The sky never gets fully dark.'
    case 'bright':
      return 'A bright-moon night.'
    case 'mixed':
      return 'A part-dark night.'
    case 'dark':
      return night.moonIllumPct <= 5 ? 'A properly dark night.' : 'A dark-sky window opens.'
  }
}

// The moonless-hours phrase used under the headline, e.g. "0 moonless hours" or
// "4h 10m moon-free". Leads with the metric that decides the night.
export function moonlessPhrase(night: NightSummary): string {
  if (night.grade === 'no-dark') return 'No astronomical darkness tonight'
  const m = night.moonlessMinutes
  if (m < 1) return 'No moon-free darkness — the Moon is up all night'
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  const dur = h ? (min ? `${h}h ${min}m` : `${h}h`) : `${min}m`
  return `${dur} of moon-free darkness`
}

// "How we'd play it" — the expert read, ending naturally at the CTA. Chooses a
// strategy from the grade + what's actually up:
//  - dark night: point at deep sky (galaxies/nebulae) if targets warrant.
//  - bright/mixed: point at the Moon + bright planets (high-contrast targets).
//  - nothing up: honest, still warm.
export function howWedPlayIt(night: NightSummary, planets: PlanetTonight[]): string {
  const wellPlaced = planets.filter((p) => p.visible && p.maxAltitude >= 25).map((p) => p.name)
  const planetList = formatList(wellPlaced)

  if (night.grade === 'no-dark') {
    return 'With no true darkness tonight, this is a night for the Moon and the brightest planets rather than faint deep-sky. Good for a relaxed, early session.'
  }
  if (night.grade === 'bright') {
    const targets = wellPlaced.length ? `the Moon itself${planetList ? `, ${planetList}` : ''}` : 'the Moon itself'
    return `With the Moon this bright, we point at ${targets} — crisp, high-contrast targets that shine through the moonlight. Faint galaxies can wait for a darker night.`
  }
  if (night.grade === 'mixed') {
    return `A part-dark night: we start on the Moon and ${planetList || 'the bright planets'} while the Moon is up, then turn to deep-sky once it's down and the sky is properly black.`
  }
  // dark
  if (wellPlaced.length) {
    return `A genuinely dark window — galaxies and nebulae are on the menu, and ${planetList} ${wellPlaced.length > 1 ? 'are' : 'is'} well-placed for the eyepiece. The kind of night we plan a full session around.`
  }
  return 'A genuinely dark window — ideal for galaxies, nebulae and the Milky Way. The kind of night we plan a full session around.'
}

function formatList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
