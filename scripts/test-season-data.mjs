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
  CONSENT_BOUNDARY_DATE,
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
  // measured POST-consent night (after the boundary)
  { id: 's5', date: '2026-07-27', hotelId: 'oku-kos', status: 'completed', cancellationReason: null },
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
  { eventKey: '2026-07-27:oku-kos', scope: 'hotel', date: '2026-07-27', hotelId: 'oku-kos', eventSlug: null, unique: 19, maxConcurrent: 9, source: 'finish', capturedAt: T('2026-07-27T22:00:00Z') },
  // a special event (no Session row) — must appear as its own 'event' night
  { eventKey: 'parnonas:2026-07-11T20:00:00Z', scope: 'event', date: null, hotelId: null, eventSlug: 'parnonas', unique: 87, maxConcurrent: 41, source: 'finish', capturedAt: T('2026-07-12T01:00:00Z') },
]

const interactions = [
  // real night's counters (post-consent night s5)
  { eventKey: '2026-07-27:oku-kos', interactionKey: 'history_pill_tap', objectId: 'M57', count: 4 },
  { eventKey: '2026-07-27:oku-kos', interactionKey: 'history_pill_tap', objectId: 'M31', count: 2 },
  { eventKey: '2026-07-27:oku-kos', interactionKey: 'farewell_finale_reached', objectId: null, count: 3 },
  // midnight-STRAGGLER bucket for the same date (hotelId-null fallback key) —
  // must never attach to the real night, and never appear as a night
  { eventKey: '2026-07-28:hotel', interactionKey: 'farewell_ufo_tap', objectId: null, count: 2 },
]

const season = assembleSeason({ sessions, stackRuns, viewerStats, interactions, frameTimes })

// ---- night list: session-led union ----
assert('5 session nights + 1 special event = 6 nights', season.nights.length === 6, `got ${season.nights.length}`)
assert('newest first', season.nights[0].date === '2026-07-27')
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

// ---- summary: counts + consent-split best ----
assert('totalEvents excludes cancelled', season.summary.totalEvents === 5, `got ${season.summary.totalEvents}`)
assert('cancelledCount = 1', season.summary.cancelledCount === 1)
assert('measuredNights = 4 (of 5 completed)', season.summary.measuredNights === 4)
assert('totalUnique sums measured only', season.summary.totalUnique === 61 + 33 + 19 + 87)
assert('avgUnique over measured, rounded', season.summary.avgUnique === Math.round(200 / 4))
assert('bestBefore is the special event (pre-consent, 87)', season.summary.bestBefore?.unique === 87 && season.summary.bestBefore.eventSlug === 'parnonas')
assert('bestAfter is the post-consent night (19)', season.summary.bestAfter?.unique === 19 && season.summary.bestAfter.hotelId === 'oku-kos')
assert('consent boundary constant is the deploy date', CONSENT_BOUNDARY_DATE === '2026-07-26')

// ---- per-hotel rollups ----
assert('special events excluded from hotel rollups', season.hotels.every((h) => h.hotelId !== null))
const oku = season.hotels.find((h) => h.hotelId === 'oku-kos')
assert('oku: 2 events, 2 measured', oku.events === 2 && oku.measuredNights === 2)
assert('oku avgUnique = (61+19)/2', oku.avgUnique === 40)
assert('oku mixedConsent (pre+post) -> dagger', oku.mixedConsent === true)
const caravia = season.hotels.find((h) => h.hotelId === 'caravia-beach')
assert('caravia: 2 events, only 1 measured (no fake zero)', caravia.events === 2 && caravia.measuredNights === 1 && caravia.avgUnique === 33)
assert('caravia not mixed (pre only)', caravia.mixedConsent === false)
assert('cancelled-only hotel: 0 events counted', !season.hotels.some((h) => h.hotelId === 'astir-odysseus'))
assert('default order: engagement desc', season.hotels[0].hotelId === 'oku-kos')

// ---- sort variants ----
assert('sort by events puts 2-event hotels first', sortHotels(season.hotels, 'events')[0].events === 2)
assert('sort by peak: oku (16.5->17 avg peak) vs caravia (12)', sortHotels(season.hotels, 'peak')[0].hotelId === 'oku-kos')
assert('sortHotels returns a copy', sortHotels(season.hotels, 'events') !== season.hotels)

// ---- buildTimeline direct: empty ----
assert('empty runs -> empty timeline', buildTimeline([], {}).length === 0)

console.log('')
if (failures > 0) { console.log(`${failures} season-data test(s) FAILED`); process.exit(1) }
console.log('All season-data tests passed.')
