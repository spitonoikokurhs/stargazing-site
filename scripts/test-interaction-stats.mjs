// Integration test for the Tier-1 Redis buffer layer (lib/interaction-stats.ts)
// against REAL Upstash Redis — mirrors scripts/test-viewer-stats.mjs: randomized
// per-run eventKey to avoid collisions, self-cleanup at the end, hand-rolled
// asserts, no test runner.
//
// Run with: node --env-file=.env.local --import tsx scripts/test-interaction-stats.mjs
import { recordInteraction, readInteractionStats, interactionStatsKey } from '../lib/interaction-stats.ts'
import { redis } from '../lib/redis.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

// A unique event key per run so parallel/repeat runs never collide. No
// Date.now()/random restriction here (this is a script, not a workflow), but keep
// it stable within the run.
const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const eventKey = `itest:${runId}`

async function main() {
  // 1. plain counter increments
  await recordInteraction(eventKey, { key: 'fullscreen_enter', objectId: null })
  await recordInteraction(eventKey, { key: 'fullscreen_enter', objectId: null })
  {
    const s = await readInteractionStats(eventKey)
    assert('plain counter increments', s['fullscreen_enter'] === 2, JSON.stringify(s))
  }

  // 2. object-scoped counters are separated per objectId
  await recordInteraction(eventKey, { key: 'history_pill_tap', objectId: 'M57' })
  await recordInteraction(eventKey, { key: 'history_pill_tap', objectId: 'M57' })
  await recordInteraction(eventKey, { key: 'history_pill_tap', objectId: 'M42' })
  {
    const s = await readInteractionStats(eventKey)
    assert('object counter M57 = 2', s['history_pill_tap:M57'] === 2, JSON.stringify(s))
    assert('object counter M42 = 1', s['history_pill_tap:M42'] === 1, JSON.stringify(s))
  }

  // 3. all four funnel variants counted independently
  await recordInteraction(eventKey, { key: 'funnel_whatsapp_impression', objectId: null })
  await recordInteraction(eventKey, { key: 'funnel_whatsapp_click', objectId: null })
  await recordInteraction(eventKey, { key: 'funnel_baseline_review_click', objectId: null })
  await recordInteraction(eventKey, { key: 'funnel_finder_review_click', objectId: null })
  {
    const s = await readInteractionStats(eventKey)
    assert('whatsapp impression counted', s['funnel_whatsapp_impression'] === 1)
    assert('whatsapp click counted', s['funnel_whatsapp_click'] === 1)
    assert('baseline review click counted', s['funnel_baseline_review_click'] === 1)
    assert('finder review click counted', s['funnel_finder_review_click'] === 1)
  }

  // 4. read of a never-touched event key is empty (no crash)
  {
    const s = await readInteractionStats(`itest:absent-${runId}`)
    assert('absent event -> empty object', typeof s === 'object' && Object.keys(s).length === 0)
  }

  // 5. TTL is set (GC) on the hash
  {
    const ttl = await redis.ttl(interactionStatsKey(eventKey))
    assert('hash has a positive TTL (GC)', typeof ttl === 'number' && ttl > 0, `ttl=${ttl}`)
  }

  // 6. buffer cap: fill past MAX_INTERACTION_FIELDS with novel object-scoped
  // fields and confirm NEW fields stop being added while existing ones still
  // increment. (Cap is 512; use a smaller-scope check to keep the run fast —
  // add many novel fields and assert the hash length is bounded.)
  {
    const capKey = `itest:cap-${runId}`
    // Add 600 distinct object ids (>512 cap). Object ids must pass the char class.
    for (let i = 0; i < 600; i++) {
      await recordInteraction(capKey, { key: 'history_pill_tap', objectId: `OBJ${i}` })
    }
    const len = await redis.hlen(interactionStatsKey(capKey))
    assert('buffer cap bounds field count', len <= 512 + 5, `hlen=${len}`) // small race slack
    // An EXISTING field still increments even at the cap.
    const before = (await readInteractionStats(capKey))['history_pill_tap:OBJ0'] ?? 0
    await recordInteraction(capKey, { key: 'history_pill_tap', objectId: 'OBJ0' })
    const after = (await readInteractionStats(capKey))['history_pill_tap:OBJ0'] ?? 0
    assert('existing field still increments at cap', after === before + 1, `before=${before} after=${after}`)
    await redis.del(interactionStatsKey(capKey))
  }

  // cleanup
  await redis.del(interactionStatsKey(eventKey))

  console.log('')
  if (failures > 0) { console.log(`${failures} interaction-stats test(s) FAILED`); process.exit(1) }
  console.log('All interaction-stats tests passed.')
}

await main()
