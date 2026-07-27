// Fixture tests for the /season calendar's pure assembly (lib/season-data.ts).
// Each fixture encodes one of the honest-data rules from
// docs/season-calendar-investigation-2026-07-26.md, so a regression in any rule
// fails a named assertion, not a pixel.
//
// Run with: node --import tsx scripts/test-season-data.mjs
import {
  assembleSeason,
  buildTimeline,
  sortHotels,
  regimeForDate,
  CONSENT_BOUNDARY_DATE,
  CONSENT_FREE_BOUNDARY_DATE,
} from '../lib/season-data.ts'
import { viewerEventKey } from '../lib/redis.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const T = (iso) => new Date(iso)

// eventKey shape parity with the real system (duplicated literal in season-data
// to stay I/O-free — this assertion is the contract that keeps them equal).
assert('eventKey shape matches viewerEventKey', viewerEventKey('2026-07-20', 'oku-kos') === '2026-07-20:oku-kos')

// ---- fixtures ----
const sessions = [
  // pre-snapshot night (no viewer row exists) — must SHOW, marked
  { id: 's1', date: '2026-07-10', hotelId: 'caravia-beach', status: 'completed', cancellationReason: null },
  // measured pre-consent night, finish snapshot — also the pre-consent best
  { id: 's2', date: '2026-07-18', hotelId: 'oku-kos', status: 'completed', cancellationReason: null },
  // measured pre-consent night, backfill snapshot
  { id: 's3', date: '2026-07-20', hotelId: 'caravia-beach', status: 'completed', cancellationReason: null },
  // cancelled night — listed, never counted
  { id: 's4', date: '2026-07-21', hotelId: 'astir-odysseus', status: 'cancelled', cancellationReason: 'weather' },
  // CONSENT-GATED (undercounted) night: 26-07 <= date < 28-07. Shown + badged,
  // but excluded from averages and best-night.
  { id: 's5', date: '2026-07-27', hotelId: 'oku-kos', status: 'completed', cancellationReason: null },
  // CONSENT-FREE night (>= 28-07): counts everyone again via the ephemeral id.
  // Same hotel as a pre-consent night (oku) so the rollup mixes regimes 1+3 -> †.
  { id: 's6', date: '2026-07-29', hotelId: 'oku-kos', status: 'completed', cancellationReason: null },
]

const stackRuns = [
  // s2: settling -> M13 (closed) -> settling x2 (fold) -> M31 final run (open, frame fallback)
  { sessionId: 's2', source: 'pegasus', startedAt: T('2026-07-18T20:00:00Z'), endedAt: T('2026-07-18T20:04:00Z'), objectId: null, objectName: null, objectType: null, confidence: null, hasInRangeRunnerUp: null, latestFrameId: null },
  { sessionId: 's2', source: 'pegasus', startedAt: T('2026-07-18T20:04:00Z'), endedAt: T('2026-07-18T20:24:00Z'), objectId: 'M13', objectName: 'Hercules Cluster', objectType: 'Globular Cluster', confidence: 'high', hasInRangeRunnerUp: false, latestFrameId: null },
  { sessionId: 's2', source: 'pegasus', startedAt: T('2026-07-18T20:24:00Z'), endedAt: T('2026-07-18T20:26:00Z'), objectId: null, objectName: null, objectType: null, confidence: null, hasInRangeRunnerUp: null, latestFrameId: null },
  { sessionId: 's2', source: 'pegasus', startedAt: T('2026-07-18T20:26:00Z'), endedAt: T('2026-07-18T20:30:00Z'), objectId: null, objectName: null, objectType: null, confidence: null, hasInRangeRunnerUp: null, latestFrameId: null },
  { sessionId: 's2', source: 'pegasus', startedAt: T('2026-07-18T20:30:00Z'), endedAt: null, objectId: 'M31', objectName: 'Andromeda Galaxy', objectType: 'Galaxy', confidence: 'medium', hasInRangeRunnerUp: true, latestFrameId: 'f-final' },
  // s3: single open run with NO frame lookup -> duration null, approx
  { sessionId: 's3', source: 'seestar', startedAt: T('2026-07-20T20:00:00Z'), endedAt: null, objectId: 'M57', objectName: 'Ring Nebula', objectType: 'Planetary Nebula', confidence: 'high', hasInRangeRunnerUp: false, latestFrameId: 'f-missing' },
]

const frameTimes = { 'f-final': T('2026-07-18T21:10:00Z') } // M31 ran 40min by frame time

const viewerStats = [
  { eventKey: '2026-07-18:oku-kos', scope: 'hotel', date: '2026-07-18', hotelId: 'oku-kos', eventSlug: null, unique: 61, maxConcurrent: 24, source: 'finish', capturedAt: T('2026-07-18T22:00:00Z') },
  { eventKey: '2026-07-20:caravia-beach', scope: 'hotel', date: '2026-07-20', hotelId: 'caravia-beach', eventSlug: null, unique: 33, maxConcurrent: 12, source: 'backfill', capturedAt: T('2026-07-21T10:00:00Z') },
  // 27-07 oku: CONSENT-GATED — undercounted 4/2, must be excluded from aggregates
  { eventKey: '2026-07-27:oku-kos', scope: 'hotel', date: '2026-07-27', hotelId: 'oku-kos', eventSlug: null, unique: 4, maxConcurrent: 2, source: 'finish', capturedAt: T('2026-07-27T22:00:00Z') },
  // 29-07 oku: CONSENT-FREE — counts everyone again (45/18)
  { eventKey: '2026-07-29:oku-kos', scope: 'hotel', date: '2026-07-29', hotelId: 'oku-kos', eventSlug: null, unique: 45, maxConcurrent: 18, source: 'finish', capturedAt: T('2026-07-29T22:00:00Z') },
  // a special event (no Session row) — must appear as its own 'event' night
  { eventKey: 'parnonas:2026-07-11T20:00:00Z', scope: 'event', date: null, hotelId: null, eventSlug: 'parnonas', unique: 87, maxConcurrent: 41, source: 'finish', capturedAt: T('2026-07-12T01:00:00Z') },
]

const interactions = [
  // interaction counters on the consent-gated (undercounted) night 27-07 —
  // they still attach; interactions are independent of the viewer regime
  { eventKey: '2026-07-27:oku-kos', interactionKey: 'history_pill_tap', objectId: 'M57', count: 4 },
  { eventKey: '2026-07-27:oku-kos', interactionKey: 'history_pill_tap', objectId: 'M31', count: 2 },
  { eventKey: '2026-07-27:oku-kos', interactionKey: 'farewell_finale_reached', objectId: null, count: 3 },
  // midnight-STRAGGLER bucket for the same date (hotelId-null fallback key) —
  // must never attach to the real night, and never appear as a night
  { eventKey: '2026-07-28:hotel', interactionKey: 'farewell_ufo_tap', objectId: null, count: 2 },
]

const season = assembleSeason({ sessions, stackRuns, viewerStats, interactions, frameTimes })

// ---- night list: session-led union ----
assert('6 session nights + 1 special event = 7 nights', season.nights.length === 7, `got ${season.nights.length}`)
assert('newest first', season.nights[0].date === '2026-07-29')
const preSnapshot = season.nights.find((n) => n.date === '2026-07-10')
assert('pre-snapshot night SHOWN', !!preSnapshot)
assert('pre-snapshot night has viewer null (marked, not zeroed)', preSnapshot.viewer === null)
const backfillNight = season.nights.find((n) => n.date === '2026-07-20')
assert('backfill badge passthrough', backfillNight.viewer?.snapshotSource === 'backfill')
const special = season.nights.find((n) => n.type === 'event')
assert('special event appears as its own night', special?.eventSlug === 'parnonas' && special.viewer?.unique === 87)
assert('special event date falls back to snapshot date', special.date === '2026-07-12')
const cancelled = season.nights.find((n) => n.status === 'cancelled')
assert('cancelled night listed with reason', cancelled?.cancellationReason === 'weather')

// ---- straggler exclusion by construction ----
assert('no night carries the straggler bucket key', season.nights.every((n) => n.eventKey !== '2026-07-28:hotel'))
const s5night = season.nights.find((n) => n.date === '2026-07-27')
assert('real night interactions exclude straggler counts', s5night.interactions?.farewell_ufo_tap === undefined)
assert('interactions roll up per key across objectIds', s5night.interactions?.history_pill_tap === 6)
assert('finale count attached', s5night.interactions?.farewell_finale_reached === 3)
assert('pre-tracking night has interactions NULL (renders em-dash, not 0)', season.nights.find((n) => n.date === '2026-07-18').interactions === null)

// ---- timeline: folding + duration truth ----
const tl = season.nights.find((n) => n.date === '2026-07-18').objects
assert('timeline: settling, M13, settling(folded x2), M31', tl.length === 4, JSON.stringify(tl.map((e) => e.kind)))
assert('consecutive unresolved runs FOLD', tl[2].kind === 'settling' && tl[2].runCount === 2)
assert('folded settling sums durations', tl[2].durationS === 360)
assert('resolved run breaks the fold (first settling separate)', tl[0].kind === 'settling' && tl[0].runCount === 1)
assert('closed run duration exact, not approx', tl[1].kind === 'object' && tl[1].durationS === 1200 && tl[1].approx === false)
assert('final run uses FRAME time, approx-marked', tl[3].kind === 'object' && tl[3].durationS === 2400 && tl[3].approx === true)
assert('contested flag carried', tl[3].contested === true)
const tl3 = season.nights.find((n) => n.date === '2026-07-20').objects
assert('open run with missing frame -> duration null, approx', tl3[0].durationS === null && tl3[0].approx === true)

// ---- regimes: the consent-gated night is undercounted, others aren't ----
const gatedNight = season.nights.find((n) => n.date === '2026-07-27')
assert('27-07 is consent-gated regime', gatedNight.regime === 'consent-gated')
assert('27-07 flagged undercounted', gatedNight.undercounted === true)
assert('18-07 is pre-consent, not undercounted', season.nights.find((n) => n.date === '2026-07-18').regime === 'pre-consent' && season.nights.find((n) => n.date === '2026-07-18').undercounted === false)
assert('29-07 is consent-free, not undercounted', season.nights.find((n) => n.date === '2026-07-29').regime === 'consent-free' && season.nights.find((n) => n.date === '2026-07-29').undercounted === false)

// ---- summary: undercounted excluded from aggregates + best-night ----
assert('totalEvents includes all completed (incl undercounted)', season.summary.totalEvents === 6, `got ${season.summary.totalEvents}`)
assert('cancelledCount = 1', season.summary.cancelledCount === 1)
// Comparable measured = 18(61) + 20(33) + 29(45) + parnonas(87). The 27-07 (4) is EXCLUDED.
assert('measuredNights = 4 comparable (undercounted excluded)', season.summary.measuredNights === 4)
assert('undercountedNights = 1', season.summary.undercountedNights === 1)
assert('totalUnique sums COMPARABLE only (excludes the 4)', season.summary.totalUnique === 61 + 33 + 45 + 87)
assert('avgUnique over comparable, rounded', season.summary.avgUnique === Math.round((61 + 33 + 45 + 87) / 4))
assert('bestComparable is the special event (87), never the undercounted 4', season.summary.bestComparable?.unique === 87 && season.summary.bestComparable.eventSlug === 'parnonas')
assert('consent boundary constants are the deploy dates', CONSENT_BOUNDARY_DATE === '2026-07-26' && CONSENT_FREE_BOUNDARY_DATE === '2026-07-28')

// ---- per-hotel rollups: undercounted excluded from the average ----
assert('special events excluded from hotel rollups', season.hotels.every((h) => h.hotelId !== null))
const oku = season.hotels.find((h) => h.hotelId === 'oku-kos')
// oku has 3 nights: 18-07 (61, pre), 27-07 (4, GATED), 29-07 (45, free).
assert('oku: 3 events, 2 comparable-measured, 1 undercounted', oku.events === 3 && oku.measuredNights === 2 && oku.undercountedNights === 1)
assert('oku avgUnique = (61+45)/2, the 4 excluded', oku.avgUnique === 53)
assert('oku mixedRegime (pre+free) -> dagger', oku.mixedRegime === true)
const caravia = season.hotels.find((h) => h.hotelId === 'caravia-beach')
assert('caravia: 2 events, only 1 measured (no fake zero)', caravia.events === 2 && caravia.measuredNights === 1 && caravia.avgUnique === 33)
assert('caravia not mixed (pre only)', caravia.mixedRegime === false)
assert('caravia has no undercounted nights', caravia.undercountedNights === 0)
assert('cancelled-only hotel: 0 events counted', !season.hotels.some((h) => h.hotelId === 'astir-odysseus'))
assert('default order: engagement desc (oku 53 > caravia 33)', season.hotels[0].hotelId === 'oku-kos')

// ---- sort variants ----
assert('sort by events: oku (3) first', sortHotels(season.hotels, 'events')[0].events === 3)
assert('sort by peak: oku (avg 21) vs caravia (12)', sortHotels(season.hotels, 'peak')[0].hotelId === 'oku-kos')
assert('sortHotels returns a copy', sortHotels(season.hotels, 'events') !== season.hotels)

// ---- regimeForDate direct ----
assert('regimeForDate: pre-consent', regimeForDate('2026-07-25') === 'pre-consent')
assert('regimeForDate: boundary day is consent-gated', regimeForDate('2026-07-26') === 'consent-gated')
assert('regimeForDate: consent-free from the free boundary', regimeForDate('2026-07-28') === 'consent-free')

// ---- buildTimeline direct: empty ----
assert('empty runs -> empty timeline', buildTimeline([], {}).length === 0)

console.log('')
if (failures > 0) { console.log(`${failures} season-data test(s) FAILED`); process.exit(1) }
console.log('All season-data tests passed.')
