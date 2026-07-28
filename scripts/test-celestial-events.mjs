// Tests for lib/celestial-events.ts — eclipses (computed) + meteor showers
// (static annual). Run: node --import tsx scripts/test-celestial-events.mjs
import { upcomingCelestialEvents } from '../lib/celestial-events.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const NOW = new Date('2026-07-29T12:00:00Z')
const events = upcomingCelestialEvents(NOW, 150)

assert('returns some events', events.length >= 3, `got ${events.length}`)
assert('soonest first (sorted by daysAway)', events.every((e, i) => i === 0 || events[i - 1].daysAway <= e.daysAway))
assert('all events are in the future', events.every((e) => e.daysAway >= 0))
assert('all within the horizon', events.every((e) => e.daysAway <= 150))

const perseids = events.find((e) => e.title.includes('Perseids'))
assert('Perseids present (~Aug 12)', !!perseids && perseids.date === '2026-08-12', perseids?.date)
assert('Perseids is a meteor-shower kind', perseids?.kind === 'meteor-shower')

const solar = events.find((e) => e.kind === 'solar-eclipse')
assert('a solar eclipse is found (computed)', !!solar && /eclipse/i.test(solar.title), solar?.title)
assert('solar eclipse note warns about the Sun', /never look at the Sun|narrow track/i.test(solar?.detail ?? ''), solar?.detail)

const lunar = events.find((e) => e.kind === 'lunar-eclipse')
assert('a lunar eclipse is found (computed)', !!lunar && /lunar eclipse/i.test(lunar.title), lunar?.title)

// horizon respected: a tiny horizon yields only very-soon events
const soon = upcomingCelestialEvents(NOW, 20)
assert('short horizon excludes far events', soon.every((e) => e.daysAway <= 20))

// every event has the required fields well-formed
assert('events well-formed', events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title && e.detail))

console.log('')
if (failures > 0) { console.log(`${failures} celestial-events test(s) FAILED`); process.exit(1) }
console.log('All celestial-events tests passed.')
