// Route-level tests for /api/status's debug path. Two things the pure gate
// tests (test-status-debug.mjs) can't prove:
//
//   A. RELAY-FIELD PASSTHROUGH (the MUST-FIX #3 proof) — exercised end-to-end
//      through the REAL transform functions parseLatestFrame (lib/redis.ts) and
//      buildDebugFields (the actual exported route helper), so a frame carrying
//      the relay's stale-solve fields is proven to reach the debug payload
//      under the exact keys the overlay reads. No client mocking needed: these
//      are pure functions over a frame payload.
//
//   B. GET-HANDLER AUTH/PARAM BRANCHES — the 401 (unauthenticated debug), the
//      400s (malformed ?debug, ?debug=1&event=…). These branches all return
//      BEFORE the handler touches Redis or Postgres, so calling the real GET
//      exercises the true wiring with zero client access and zero prod writes.
//
// The finished-bypass / live-with-debug / no-feed branches DO touch Redis+
// Prisma; rather than fight the Upstash and Prisma client proxies with fragile
// monkeypatches, those are covered as pure logic in test-status-debug.mjs
// (resolveDebugGate) and, at deploy time, by the curl checks in
// docs/live-debug-post-deploy-verification.md. This file proves the two things
// those can't: the field transform, and the pre-Redis handler branches.
//
// Run with: node --import tsx scripts/test-status-debug-route.mjs
const TOKEN = 'route-test-debug-token-xyz'
process.env.DEBUG_VIEW_TOKEN = TOKEN
delete process.env.VIEWER_STATS_TOKEN
delete process.env.INGEST_SECRET
process.env.UPSTASH_KV_REST_API_URL ??= 'https://mock.local'
process.env.UPSTASH_KV_REST_API_TOKEN ??= 'mock'

const { NextRequest } = await import('next/server')
const { parseLatestFrame } = await import('../lib/redis.ts')
const { buildDebugFields } = await import('../lib/debug-fields.ts')
const { GET } = await import('../app/api/status/route.ts')
const { mintDebugCookie, DEBUG_COOKIE_NAME } = await import('../lib/debug-auth.ts')

let failures = 0
function assert(name, cond, detail) {
  if (cond) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---- Part A: relay-field passthrough through the real transform pipeline ----
function partA() {
  const nowIso = new Date().toISOString()
  // A frame payload exactly as ingest writes it to Redis, carrying every relay
  // passthrough field.
  const rawPayload = JSON.stringify({
    frameId: 'frame-1',
    blobUrl: 'https://blob.local/frame.jpg',
    capturedAt: nowIso,
    ingestedAt: nowIso,
    observationId: 'obs-1',
    sessionId: 'sess-1',
    objectName: 'Test Object',
    telemetry: {
      state: 'IMAGE_STACK_RUNNING',
      astrometryState: 'solved',
      totalAccumulatedTime: 120,
      raDegrees: 10.5,
      decDegrees: 41.2,
      astrometrySolveSuspect: true,
      solveTiming: 1234,
      solveTimingReason: 'slow-plate',
      newObservation: false,
      coordSourceDeltaDeg: 0.42,
      coordSourcesDisagree: true,
      mountRaDegrees: 10.6,
      mountDecDegrees: 41.1,
      mountTelemetryOk: true,
    },
  })

  // 1. parseLatestFrame must KEEP the relay fields (the redis.ts strip point).
  const frame = parseLatestFrame(rawPayload)
  assert('A1. parseLatestFrame keeps astrometrySolveSuspect', frame?.telemetry?.astrometrySolveSuspect === true)
  assert('A1. parseLatestFrame keeps solveTiming', frame?.telemetry?.solveTiming === 1234)
  assert('A1. parseLatestFrame keeps solveTimingReason', frame?.telemetry?.solveTimingReason === 'slow-plate')
  assert('A1. parseLatestFrame keeps coordSourceDeltaDeg', frame?.telemetry?.coordSourceDeltaDeg === 0.42)
  assert('A1. parseLatestFrame keeps coordSourcesDisagree', frame?.telemetry?.coordSourcesDisagree === true)
  assert('A1. parseLatestFrame keeps newObservation', frame?.telemetry?.newObservation === false)
  assert('A1. parseLatestFrame keeps mountRaDegrees', frame?.telemetry?.mountRaDegrees === 10.6)
  assert('A1. parseLatestFrame keeps mountTelemetryOk', frame?.telemetry?.mountTelemetryOk === true)

  // 2. buildDebugFields must FORWARD them into the debug payload (the route
  //    strip point) under the exact keys the overlay reads.
  const debug = buildDebugFields(frame)
  assert('A2. buildDebugFields forwards astrometrySolveSuspect', debug.astrometrySolveSuspect === true)
  assert('A2. buildDebugFields forwards solveTiming', debug.solveTiming === 1234)
  assert('A2. buildDebugFields forwards solveTimingReason', debug.solveTimingReason === 'slow-plate')
  assert('A2. buildDebugFields forwards coordSourceDeltaDeg', debug.coordSourceDeltaDeg === 0.42)
  assert('A2. buildDebugFields forwards coordSourcesDisagree', debug.coordSourcesDisagree === true)
  assert('A2. buildDebugFields forwards newObservation', debug.newObservation === false)
  assert('A2. buildDebugFields forwards mountRaDegrees', debug.mountRaDegrees === 10.6)
  assert('A2. buildDebugFields forwards mountTelemetryOk', debug.mountTelemetryOk === true)
  // raw match/confidence surfaced (the guest card hides these)
  assert('A2. buildDebugFields surfaces raw match+confidence', debug.match && 'confidence' in debug.match)

  // 3. ABSENT relay fields are OMITTED, not sent as null — so the overlay shows
  //    "not sent" for an older relay / Tier-1 frame.
  const bare = parseLatestFrame(
    JSON.stringify({
      frameId: 'f2',
      blobUrl: 'https://b/f.jpg',
      capturedAt: nowIso,
      ingestedAt: nowIso,
      observationId: 'o',
      sessionId: 's',
      objectName: 'X',
      telemetry: { astrometryState: 'solved', raDegrees: 10.5, decDegrees: 41.2 },
    }),
  )
  const bareDebug = buildDebugFields(bare)
  assert('A3. absent relay fields OMITTED (not null)', !('solveTiming' in bareDebug) && !('mountRaDegrees' in bareDebug))

  // 4. A wrong-typed relay field is dropped by parseLatestFrame (best-effort),
  //    not forwarded as garbage.
  const badTyped = parseLatestFrame(
    JSON.stringify({
      frameId: 'f3',
      blobUrl: 'https://b/f.jpg',
      capturedAt: nowIso,
      ingestedAt: nowIso,
      observationId: 'o',
      sessionId: 's',
      objectName: 'X',
      telemetry: { astrometryState: 'solved', raDegrees: 10.5, decDegrees: 41.2, solveTiming: 'not-a-number', astrometrySolveSuspect: 'yes' },
    }),
  )
  assert('A4. wrong-typed solveTiming dropped by parser', badTyped?.telemetry?.solveTiming === undefined)
  assert('A4. wrong-typed astrometrySolveSuspect dropped by parser', badTyped?.telemetry?.astrometrySolveSuspect === undefined)
}

// ---- Part B: real GET handler, auth/param branches (return before any client) ----
function req(path, { cookie, bearer } = {}) {
  const headers = {}
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const r = new NextRequest(`https://example.test${path}`, { headers })
  if (cookie) r.cookies.set(DEBUG_COOKIE_NAME, cookie)
  return r
}
async function status(res) {
  return { status: res.status, headers: res.headers, body: await res.json() }
}

async function partB() {
  const cookie = mintDebugCookie(TOKEN, Date.now())

  // Unauthenticated debug -> 401 (never a guest fall-through). Returns before Redis.
  {
    const { status: st, body } = await status(await GET(req('/api/status?debug=1')))
    assert('B1. ?debug=1 no creds -> 401', st === 401 && body.error === 'unauthorized')
  }
  // Malformed ?debug -> 400. Returns before Redis.
  {
    const { status: st } = await status(await GET(req('/api/status?debug=true', { cookie })))
    assert('B2. ?debug=true -> 400', st === 400)
  }
  {
    const { status: st } = await status(await GET(req('/api/status?debug=0&debug=1', { cookie })))
    assert('B3. ?debug=0&debug=1 duplicate -> 400', st === 400)
  }
  // ?debug=1&event=… -> 400 (not supported in v1). Returns before Redis.
  {
    const { status: st } = await status(await GET(req('/api/status?debug=1&event=some-event', { cookie })))
    assert('B4. ?debug=1&event=… -> 400', st === 400)
  }
  // The 401/400 responses must still be uncacheable + private.
  {
    const { headers } = await status(await GET(req('/api/status?debug=1')))
    assert('B5. 401 carries private no-store + Vary includes Cookie', /private/.test(headers.get('cache-control') ?? '') && /no-store/.test(headers.get('cache-control') ?? '') && /Cookie/.test(headers.get('vary') ?? ''))
  }
}

async function main() {
  partA()
  await partB()
  console.log('')
  if (failures > 0) {
    console.log(`${failures} route test(s) FAILED`)
    process.exit(1)
  }
  console.log('All debug ROUTE tests passed.')
}

await main()
