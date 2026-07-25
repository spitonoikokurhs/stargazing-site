// Tests for the /demo/[slug] self-running event: the pure loop math
// (lib/demo-event.ts) and the endpoint's response shapes (app/api/demo-status).
// The endpoint drives the REAL LiveView via its statusUrl seam, so its bodies
// MUST satisfy LiveView's isStatusResponse contract — we assert the exact fields
// isLiveStatus/isStartingStatus require (mirrored here because those validators
// live inside the client component and can't be imported into node). Also
// asserts the endpoint is analytics-inert (no viewerId read, no tracking) and
// stateless (same input -> same output).
//
// Run with: node --import tsx scripts/test-demo-event.mjs
import { NextRequest } from 'next/server'
import {
  demoPhaseAt,
  demoStageOffsetMs,
  demoAccumulatedTime,
  resolveDemoSlug,
  demoHotelName,
  DEMO_STARTING_MS,
  DEMO_SEGMENT_MS,
  DEMO_TARGETS,
  DEMO_LOOP_MS,
} from '../lib/demo-event.ts'
import { GET } from '../app/api/demo-status/route.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

// Mirror of LiveView's live/starting validators (the fields that MUST be present
// and well-typed or the page renders nothing).
function isString(v) { return typeof v === 'string' }
function validLiveBody(v) {
  return v && v.live === true && isString(v.source) && v.frame && isString(v.frame.frameId) &&
    isString(v.frame.blobUrl) && isString(v.frame.capturedAt) && isString(v.frame.ingestedAt) &&
    v.observation && isString(v.observation.observationId) && isString(v.observation.objectName) &&
    isString(v.sessionId)
}
function validStartingBody(v) {
  return v && v.live === false && v.starting === true && v.tonight &&
    isString(v.tonight.hotelId) && isString(v.tonight.start) && isString(v.tonight.end) &&
    typeof v.tonight.cancelled === 'boolean' && (v.next === null || typeof v.next === 'object')
}

async function bodyAt(slug, stage) {
  const qs = new URLSearchParams()
  if (slug != null) qs.set('demo', slug)
  if (stage != null) qs.set('stage', stage)
  // Include a viewerId to prove the endpoint IGNORES it (analytics-inert).
  qs.set('viewerId', 'should-be-ignored-000000')
  const res = GET(new NextRequest(`https://x.test/api/demo-status?${qs}`))
  return res.json()
}

async function main() {
  // ---- loop math ----
  assert('loop = starting + N*segment', DEMO_LOOP_MS === DEMO_STARTING_MS + DEMO_TARGETS.length * DEMO_SEGMENT_MS)
  // 3+ real-matching targets (curated to only genuinely-correct frame/id pairs).
  assert('3+ targets', DEMO_TARGETS.length >= 3)

  assert('t=0 -> starting', demoPhaseAt(0).kind === 'starting')
  assert('t just before segments -> starting', demoPhaseAt(DEMO_STARTING_MS - 1).kind === 'starting')
  {
    const p = demoPhaseAt(DEMO_STARTING_MS)
    assert('t=startingEnd -> target 0', p.kind === 'target' && p.index === 0)
  }
  {
    const p = demoPhaseAt(DEMO_STARTING_MS + DEMO_SEGMENT_MS + 5)
    assert('into 2nd segment -> target 1', p.kind === 'target' && p.index === 1)
  }
  {
    const last = DEMO_TARGETS.length - 1
    const p = demoPhaseAt(DEMO_STARTING_MS + last * DEMO_SEGMENT_MS + 5)
    assert('last segment -> last target', p.kind === 'target' && p.index === last)
  }
  // loop wraps
  assert('loop wraps: t=LOOP -> starting again', demoPhaseAt(DEMO_LOOP_MS).kind === 'starting')
  assert('negative-safe modulo', demoPhaseAt(-1).kind === 'target')

  // accumulated time climbs within a segment
  {
    const t = DEMO_TARGETS[0]
    assert('accumulated at seg start = floor', demoAccumulatedTime(t, 0) === t.startAccumulatedSeconds)
    assert('accumulated climbs ~1/s', demoAccumulatedTime(t, 30_000) === t.startAccumulatedSeconds + 30)
  }

  // stage override
  assert('stage=starting -> 0', demoStageOffsetMs('starting') === 0)
  assert('stage=1 lands in target 0', demoPhaseAt(demoStageOffsetMs('1')).index === 0)
  assert('stage=N lands in last target', demoPhaseAt(demoStageOffsetMs(String(DEMO_TARGETS.length))).index === DEMO_TARGETS.length - 1)
  assert('stage=99 (out of range) -> null', demoStageOffsetMs('99') === null)
  assert('stage=garbage -> null', demoStageOffsetMs('abc') === null)

  // slug resolution + branding
  assert('known slug resolves to itself', resolveDemoSlug('mandarin') === 'mandarin')
  assert('unknown slug -> generic', resolveDemoSlug('nope') === 'generic')
  assert('null slug -> generic', resolveDemoSlug(null) === 'generic')
  assert('mandarin -> Mandarin Oriental Bodrum', demoHotelName('mandarin') === 'Mandarin Oriental Bodrum')
  assert('generic -> Your Hotel', demoHotelName('generic') === 'Your Hotel')
  assert('unknown -> Your Hotel', demoHotelName('nope') === 'Your Hotel')

  // ---- endpoint response shapes (the isStatusResponse contract) ----
  {
    const starting = await bodyAt('mandarin', 'starting')
    assert('starting stage -> valid starting body', validStartingBody(starting), JSON.stringify(starting).slice(0, 120))
    assert('starting carries the demo hotelId for branding', starting.tonight.hotelId === 'mandarin')
  }
  for (let i = 1; i <= DEMO_TARGETS.length; i++) {
    const live = await bodyAt('titanic', String(i))
    assert(`stage ${i} -> valid LIVE body`, validLiveBody(live), JSON.stringify(live).slice(0, 140))
    assert(`stage ${i} -> objectMatch present with name+type`, live.objectMatch && isString(live.objectMatch.name) && isString(live.objectMatch.type))
    assert(`stage ${i} -> frame image is a real /images asset`, live.frame.blobUrl.startsWith('/images/'))
    assert(`stage ${i} -> hotelId is the slug (branding)`, live.hotelId === 'titanic')
    assert(`stage ${i} -> viewers null (no tracking surfaced)`, live.viewers === null)
    // history accumulates: stage i has i entries, last one active
    assert(`stage ${i} -> history has ${i} entr${i === 1 ? 'y' : 'ies'}`, Array.isArray(live.history) && live.history.length === i, `got ${live.history?.length}`)
    assert(`stage ${i} -> exactly one active history entry`, live.history.filter((h) => h.active).length === 1)
  }

  // unknown slug still returns a valid body (generic), never broken
  {
    const live = await bodyAt('totally-unknown-hotel', '2')
    assert('unknown slug -> valid live body (generic)', validLiveBody(live) && live.hotelId === 'generic')
  }

  // stateless: same stage input -> identical body (modulo the frameId's second
  // counter, which we ignore by comparing objectMatch + history)
  {
    const a = await bodyAt('plaza', '3')
    const b = await bodyAt('plaza', '3')
    assert('stateless: same stage -> same object + history', JSON.stringify(a.objectMatch) === JSON.stringify(b.objectMatch) && a.history.length === b.history.length)
  }

  console.log('')
  if (failures > 0) { console.log(`${failures} demo test(s) FAILED`); process.exit(1) }
  console.log('All demo-event tests passed.')
}

await main()
