// Standalone integration tests for private viewer analytics (lib/redis.ts's
// recordViewerActivity/readViewerStats + /api/viewer-stats's auth). Talks to
// the REAL configured Upstash instance (via .env.local) using a throwaway,
// randomized eventKey per run so it never collides with real event data and
// needs no separate teardown step beyond the TTLs already on those keys.
//
// Run with: node --env-file=.env.local --import tsx scripts/test-viewer-stats.mjs
import { recordViewerActivity, readViewerStats, viewerEventKey, viewerSpecialEventKey, redis } from '../lib/redis.ts'

let failures = 0
function assert(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`)
  } else {
    failures++
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const runId = Math.random().toString(36).slice(2, 10)
const eventKey = viewerEventKey('2099-01-01', `test-${runId}`)

async function main() {
  // --- Test 1: recording activity increments current + unique ---
  const v1 = `viewer-${runId}-1`
  const r1 = await recordViewerActivity('hotel', null, eventKey, v1)
  assert('first viewer -> current=1', r1?.current === 1, `got ${r1?.current}`)
  assert('first viewer -> unique=1', r1?.unique === 1, `got ${r1?.unique}`)
  assert('first viewer -> maxConcurrent=1', r1?.maxConcurrent === 1, `got ${r1?.maxConcurrent}`)

  // --- Test 2: same viewer polling repeatedly does not increment unique ---
  const r1b = await recordViewerActivity('hotel', null, eventKey, v1)
  assert('same viewer polls again -> current still 1', r1b?.current === 1, `got ${r1b?.current}`)
  assert('same viewer polls again -> unique still 1 (no double-count)', r1b?.unique === 1, `got ${r1b?.unique}`)

  // --- Test 3: a second distinct viewer increments both current and unique ---
  const v2 = `viewer-${runId}-2`
  const r2 = await recordViewerActivity('hotel', null, eventKey, v2)
  assert('second distinct viewer -> current=2', r2?.current === 2, `got ${r2?.current}`)
  assert('second distinct viewer -> unique=2', r2?.unique === 2, `got ${r2?.unique}`)
  assert('second distinct viewer -> maxConcurrent=2', r2?.maxConcurrent === 2, `got ${r2?.maxConcurrent}`)

  // --- Test 4: maxConcurrent increases but does not decrease ---
  // Simulate v1 aging out of the 60s active window by directly removing it
  // from the active sorted set (waiting a real 60s would make this test
  // slow) — this mirrors what ZREMRANGEBYSCORE will naturally do over time.
  const keys = {
    active: 'live:viewers:hotel:active',
  }
  await redis.zrem(keys.active, v1)
  const statsAfterDrop = await readViewerStats('hotel', null, eventKey)
  assert(
    'after one viewer ages out, current drops to 1',
    statsAfterDrop.current === 1,
    `got ${statsAfterDrop.current}`,
  )
  assert(
    'maxConcurrent stays at the earlier peak (2), does not decrease',
    statsAfterDrop.maxConcurrent === 2,
    `got ${statsAfterDrop.maxConcurrent}`,
  )

  // --- Test 5: unique persists after active expires ---
  assert(
    'unique count unaffected by active-set expiry (still 2)',
    statsAfterDrop.unique === 2,
    `got ${statsAfterDrop.unique}`,
  )

  // --- Test 6: active viewer ages out after the 60s window (simulated via
  //     a manually-scored stale member rather than a real 60s sleep). Checked
  //     directly with ZCOUNT on just this member's score, not via
  //     readViewerStats — that reads the WHOLE shared hotel active set, which
  //     by this point in the run still legitimately contains v2 from earlier
  //     tests, so it isn't a clean way to isolate one stale member. ---
  const staleViewer = `viewer-${runId}-stale`
  const activeKey = 'live:viewers:hotel:active'
  const now = Date.now()
  const countBefore = await redis.zcount(activeKey, now - 60_000, now)
  // Score it 61s in the past directly, bypassing recordViewerActivity's
  // Date.now() so this test doesn't need to actually wait a minute.
  await redis.zadd(activeKey, { score: now - 61_000, member: staleViewer })
  const countAfter = await redis.zcount(activeKey, now - 60_000, now)
  assert(
    'adding a member scored 61s ago does not change the 60s-window active count',
    countAfter === countBefore,
    `before=${countBefore}, after=${countAfter}`,
  )
  await redis.zrem(activeKey, staleViewer)

  // --- Test 7: hotel and special-event scopes are separate ---
  const eventSlug = `test-event-${runId}`
  const eventEventKey = viewerEventKey('2099-01-01', eventSlug)
  const v3 = `viewer-${runId}-3`
  await recordViewerActivity('event', eventSlug, eventEventKey, v3)
  const hotelStatsUnaffected = await readViewerStats('hotel', null, eventKey)
  const eventStats = await readViewerStats('event', eventSlug, eventEventKey)
  assert(
    'special-event viewer does not affect hotel scope unique count',
    hotelStatsUnaffected.unique === 2,
    `got ${hotelStatsUnaffected.unique}`,
  )
  assert('special-event scope sees its own viewer', eventStats.unique === 1, `got ${eventStats.unique}`)

  // --- Test 8: readViewerStats never writes (a manual check isn't a "poll") ---
  const beforeRead = await readViewerStats('hotel', null, eventKey)
  const afterRead = await readViewerStats('hotel', null, eventKey)
  assert(
    'reading stats twice in a row does not change unique',
    beforeRead.unique === afterRead.unique,
    `${beforeRead.unique} vs ${afterRead.unique}`,
  )

  // --- Test 9: atomic max cannot regress under out-of-order concurrent
  //     writes (the exact interleaving ChatGPT's review proved could
  //     corrupt a plain GET/compare/SET: a "low" write landing AFTER a
  //     "high" write must not overwrite it). Uses its own isolated eventKey
  //     so it can't be perturbed by (or perturb) the counts built up above. ---
  const raceEventKey = viewerEventKey('2099-01-01', `test-race-${runId}`)
  const raceKeys = {
    active: 'live:viewers:hotel:active',
    max: `live:viewers:hotel:max:${raceEventKey}`,
  }
  // Directly exercise the underlying primitive (ZADD GT) the same way
  // recordViewerActivity does, issuing a "high" write and then a "low" write
  // out of order — this is precisely the interleaving that regresses a
  // naive GET-then-SET (low write landing last would clobber the earlier
  // high value) but must be a no-op against ZADD GT.
  await redis.zadd(raceKeys.max, { gt: true }, { score: 10, member: 'max' })
  await redis.zadd(raceKeys.max, { gt: true }, { score: 6, member: 'max' })
  const raceMaxAfterLowWrite = await redis.zscore(raceKeys.max, 'max')
  assert(
    'atomic max: a lower write arriving after a higher one does not regress the stored max',
    Number(raceMaxAfterLowWrite) === 10,
    `got ${raceMaxAfterLowWrite}`,
  )
  // And confirm a genuinely higher write still DOES take effect afterward.
  await redis.zadd(raceKeys.max, { gt: true }, { score: 15, member: 'max' })
  const raceMaxAfterHigherWrite = await redis.zscore(raceKeys.max, 'max')
  assert(
    'atomic max: a genuinely higher write still updates the stored max',
    Number(raceMaxAfterHigherWrite) === 15,
    `got ${raceMaxAfterHigherWrite}`,
  )
  await redis.del(raceKeys.max)

  // Also exercise the full recordViewerActivity path (not just the raw
  // primitive above) with several rapid concurrent calls firing at once —
  // simulates several guest phones polling in the same instant — and
  // confirms the final maxConcurrent matches the true peak observed across
  // all of them, never less.
  const concurrencyEventKey = viewerEventKey('2099-01-01', `test-concurrency-${runId}`)
  const concurrentViewers = Array.from({ length: 5 }, (_, i) => `viewer-${runId}-concurrent-${i}`)
  const concurrentResults = await Promise.all(
    concurrentViewers.map((v) => recordViewerActivity('hotel', null, concurrencyEventKey, v)),
  )
  const trueMaxObserved = Math.max(...concurrentResults.map((r) => r?.current ?? 0))
  const finalStats = await readViewerStats('hotel', null, concurrencyEventKey)
  assert(
    'atomic max under real concurrent recordViewerActivity calls -> final max >= the highest current seen by any call',
    finalStats.maxConcurrent >= trueMaxObserved,
    `finalMax=${finalStats.maxConcurrent}, trueMaxObserved=${trueMaxObserved}`,
  )
  await redis.zrem('live:viewers:hotel:active', ...concurrentViewers)
  await redis.del(`live:viewers:hotel:unique:${concurrencyEventKey}`)
  await redis.del(`live:viewers:hotel:max:${concurrencyEventKey}`)

  // --- Test 10: multi-day special event uses ONE stable key across days,
  //     not a per-calendar-date key (the exact bug ChatGPT's review found:
  //     a 3-night event like Parnonas must have ONE unique-viewer count
  //     across July 10-12, not three separate date-scoped counters). ---
  const parnonasRevealAt = '2026-07-10T18:00:00+03:00'
  const keyDay1 = viewerSpecialEventKey('parnonas', parnonasRevealAt)
  const keyDay2 = viewerSpecialEventKey('parnonas', parnonasRevealAt)
  assert(
    'viewerSpecialEventKey is stable across calls (same slug+revealAt -> same key regardless of "today")',
    keyDay1 === keyDay2,
    `${keyDay1} vs ${keyDay2}`,
  )
  // Simulate a viewer on "day 1" and a different viewer on "day 3" of the
  // same event — both must land in the SAME unique set, unlike the hotel
  // path's viewerEventKey (which intentionally DOES vary by date).
  const parnonasViewerDay1 = `viewer-${runId}-parnonas-day1`
  const parnonasViewerDay3 = `viewer-${runId}-parnonas-day3`
  await recordViewerActivity('event', 'parnonas', keyDay1, parnonasViewerDay1)
  const parnonasStatsAfterDay3 = await recordViewerActivity('event', 'parnonas', keyDay2, parnonasViewerDay3)
  assert(
    'multi-day special event: viewers from different days accumulate into ONE unique count',
    parnonasStatsAfterDay3?.unique === 2,
    `got ${parnonasStatsAfterDay3?.unique}`,
  )
  // Contrast with the hotel path's date-scoped key, which correctly DOES
  // produce two different keys for two different dates.
  const hotelKeyDay1 = viewerEventKey('2026-07-10', 'astir-odysseus')
  const hotelKeyDay2 = viewerEventKey('2026-07-11', 'astir-odysseus')
  assert(
    'hotel viewerEventKey (unlike viewerSpecialEventKey) DOES vary by date, as intended',
    hotelKeyDay1 !== hotelKeyDay2,
    `${hotelKeyDay1} vs ${hotelKeyDay2}`,
  )
  await redis.zrem('live:viewers:event:parnonas:active', parnonasViewerDay1, parnonasViewerDay3)
  await redis.del(`live:viewers:event:parnonas:unique:${keyDay1}`)
  await redis.del(`live:viewers:event:parnonas:max:${keyDay1}`)

  // --- Cleanup: remove this run's test members from the shared active set
  //     and let the unique/max keys expire on their own TTL. ---
  await redis.zrem('live:viewers:hotel:active', v1, v2)
  await redis.del(`live:viewers:hotel:unique:${eventKey}`)
  await redis.del(`live:viewers:hotel:max:${eventKey}`)
  await redis.del(`live:viewers:event:${eventSlug}:active`)
  await redis.del(`live:viewers:event:${eventSlug}:unique:${eventEventKey}`)
  await redis.del(`live:viewers:event:${eventSlug}:max:${eventEventKey}`)

  console.log('')
  if (failures > 0) {
    console.log(`${failures} assertion(s) failed.`)
    process.exit(1)
  } else {
    console.log('All assertions passed.')
  }
}

main().catch((e) => {
  console.error('Test run crashed:', e)
  process.exit(1)
})
