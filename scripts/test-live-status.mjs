#!/usr/bin/env node
// Standalone reducer tests for lib/live-status.ts, focused on the state-
// aware-transition feature (transitioningRunKey/transitionStartedAt) — the
// old target's image/card must never render once a new stack run is
// detected, until a displayable frame for that new run actually loads.
//
// Run via: npx tsx scripts/test-live-status.mjs
import { liveStatusReducer, initialLiveStatusState } from '../lib/live-status.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`)
  } else {
    failures++
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function knownDisplayObject(name) {
  return { kind: 'known', name, description: 'test', type: 'Nebula' }
}

function frameForRun(overrides) {
  return {
    frameId: 'frame-1',
    blobUrl: 'https://example.com/1.jpg',
    ingestedAt: '2026-07-09T20:00:00.000Z',
    objectName: 'M13',
    displayObject: knownDisplayObject('M13'),
    observationId: 'obs-1',
    source: 'pegasus',
    stackRunStartedAt: '2026-07-09T20:00:00.000Z',
    ...overrides,
  }
}

// --- Test 1: old run live -> new stackRunStartedAt reported, image not
//     loaded yet -> transitioning, no old card/image implied (lastLiveFrame
//     stays untouched, but transitioningRunKey is set so the render layer
//     knows to suppress it). ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  assert('old run promoted to live first', state.uiState === 'live' && state.lastLiveFrame?.frameId === 'frame-1')
  assert('transitioningRunKey starts null after a normal live promotion', state.transitioningRunKey === null)

  const newRunKey = 'pegasus:obs-1:2026-07-09T20:10:00.000Z'
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: newRunKey })
  assert('POLL_RUN_TRANSITIONING sets transitioningRunKey to the new run', state.transitioningRunKey === newRunKey)
  assert('transitionStartedAt is set', typeof state.transitionStartedAt === 'number')
  assert('uiState is UNCHANGED by transitioning alone (still live — the render layer, not uiState, gates the old image)', state.uiState === 'live')
  assert('lastLiveFrame is NOT cleared — still available underneath for reconnecting to fall back on', state.lastLiveFrame?.frameId === 'frame-1')
}

// --- Test 2: new image preload succeeds -> new run live (transitioningRunKey
//     clears, lastLiveFrame promotes to the new frame). ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  const newRunKey = 'pegasus:obs-1:2026-07-09T20:10:00.000Z'
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: newRunKey })
  assert('setup: transitioning before promotion', state.transitioningRunKey === newRunKey)

  state = liveStatusReducer(state, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({
      frameId: 'frame-2',
      blobUrl: 'https://example.com/2.jpg',
      objectName: 'M57',
      displayObject: knownDisplayObject('M57'),
      stackRunStartedAt: '2026-07-09T20:10:00.000Z',
    }),
    loadedAt: 2000,
  })
  assert('new run promotes to live', state.uiState === 'live' && state.lastLiveFrame?.frameId === 'frame-2')
  assert('transitioningRunKey clears on successful promotion', state.transitioningRunKey === null)
  assert('transitionStartedAt clears on successful promotion', state.transitionStartedAt === null)
}

// --- Test 3: preload fails -> remains transition/reconnecting, old image
//     NOT restored (transitioningRunKey/lastLiveFrame both stay as they
//     were — POLL_LIVE_IMAGE_FAILED doesn't touch either). ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  const newRunKey = 'pegasus:obs-1:2026-07-09T20:10:00.000Z'
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: newRunKey })

  state = liveStatusReducer(state, { type: 'POLL_LIVE_IMAGE_FAILED' })
  assert('transitioningRunKey survives a failed preload (still waiting on the new run)', state.transitioningRunKey === newRunKey)
  assert('lastLiveFrame is still the OLD frame — never silently reverted/promoted', state.lastLiveFrame?.frameId === 'frame-1')
  assert('uiState still live (not forced offline) after one failed preload', state.uiState === 'live')
}

// --- Test 4: second run change while transitioning -> waits for the
//     latest run only (transitioningRunKey replaced, transitionStartedAt
//     restarted, not accumulated). ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  const firstNewRunKey = 'pegasus:obs-1:2026-07-09T20:10:00.000Z'
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: firstNewRunKey })
  const firstTransitionStartedAt = state.transitionStartedAt

  const secondNewRunKey = 'pegasus:obs-1:2026-07-09T20:20:00.000Z'
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: secondNewRunKey })
  assert('a newer run key SUPERSEDES the one being waited on', state.transitioningRunKey === secondNewRunKey)
  assert(
    'transitionStartedAt is RESTARTED (not preserved) when a newer run key supersedes an in-progress one',
    typeof state.transitionStartedAt === 'number' && state.transitionStartedAt >= firstTransitionStartedAt,
  )

  // A frame belonging to the FIRST (now-superseded) run key arriving late
  // must still promote correctly if dispatched (LiveView itself is
  // responsible for not dispatching a stale result — see its own doc
  // comment — but the reducer's job here is just to confirm redispatching
  // the SAME runKey again is a no-op, not that it re-triggers a restart).
  const redispatchState = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: secondNewRunKey })
  assert(
    'redispatching the SAME (already-current) run key is a no-op — does not restart the clock again',
    redispatchState.transitionStartedAt === state.transitionStartedAt,
  )
}

// --- Test 5: TRANSITION_TIMEOUT is a no-op before the 5-minute threshold,
//     and falls through to reconnecting once it elapses — clearing
//     transitioningRunKey (so the render layer actually leaves
//     TransitionScreen) while remembering the stuck run in suppressedRunKey
//     (so LiveView doesn't immediately re-enter transition for the same
//     stuck run on the next poll). ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: 'pegasus:obs-1:new' })
  const afterTransitionStart = liveStatusReducer(state, { type: 'TRANSITION_TIMEOUT' })
  assert('TRANSITION_TIMEOUT immediately after starting is a no-op (well under 5 min)', afterTransitionStart.uiState === 'live')
  assert('transitioningRunKey untouched by the no-op case', afterTransitionStart.transitioningRunKey === 'pegasus:obs-1:new')

  // Simulate 5+ minutes elapsed by directly constructing a state with an
  // old transitionStartedAt (the reducer computes now - transitionStartedAt
  // internally, so backdating the stored timestamp is the correct way to
  // simulate elapsed wall-clock time without a real sleep).
  const backdated = { ...state, transitionStartedAt: Date.now() - 6 * 60 * 1000 }
  const timedOut = liveStatusReducer(backdated, { type: 'TRANSITION_TIMEOUT' })
  assert('TRANSITION_TIMEOUT after 5+ min falls through to reconnecting', timedOut.uiState === 'reconnecting')
  assert(
    'transitioningRunKey IS cleared by timeout — required for LiveViewPresentation\'s uiState===\'live\' guard to actually leave TransitionScreen',
    timedOut.transitioningRunKey === null,
  )
  assert(
    'the stuck run key is remembered in suppressedRunKey instead, so a late frame for it can still promote directly via POLL_LIVE_IMAGE_LOADED',
    timedOut.suppressedRunKey === 'pegasus:obs-1:new',
  )

  // A late frame for the suppressed run arriving after the timeout must
  // still promote to live normally, and must clear suppressedRunKey so a
  // future stall on some OTHER run can be suppressed independently.
  const lateFrame = liveStatusReducer(timedOut, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({
      frameId: 'frame-late',
      objectName: 'M57',
      displayObject: knownDisplayObject('M57'),
      stackRunStartedAt: 'new',
    }),
    loadedAt: 3000,
  })
  assert('a late frame for the suppressed run still promotes to live', lateFrame.uiState === 'live' && lateFrame.lastLiveFrame?.frameId === 'frame-late')
  assert('suppressedRunKey clears once its run finally promotes', lateFrame.suppressedRunKey === null)

  // A genuinely NEW transition starting (a real target change, not the
  // suppressed run reappearing) must also clear suppressedRunKey — once a
  // newer run has appeared, the old suppression is stale and would never
  // be checked again anyway (isRunChange in LiveView.tsx only ever
  // compares against the LATEST incoming run key).
  const newTransitionAfterSuppression = liveStatusReducer(timedOut, {
    type: 'POLL_RUN_TRANSITIONING',
    runKey: 'pegasus:obs-1:even-newer',
  })
  assert(
    'a new transition clears a stale suppressedRunKey from an earlier timeout',
    newTransitionAfterSuppression.transitioningRunKey === 'pegasus:obs-1:even-newer' &&
      newTransitionAfterSuppression.suppressedRunKey === null,
  )
}

// --- Test 5b: after TRANSITION_TIMEOUT, LiveView's render-gate condition
//     (uiState === 'live' && transitioningRunKey !== null) no longer
//     matches — this is the actual bug fix (previously transitioningRunKey
//     alone gated TransitionScreen, so the screen never went away even
//     though uiState had moved to 'reconnecting'). ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: 'pegasus:obs-1:new' })
  const backdated = { ...state, transitionStartedAt: Date.now() - 6 * 60 * 1000 }
  const timedOut = liveStatusReducer(backdated, { type: 'TRANSITION_TIMEOUT' })

  const wouldRenderTransitionScreen = timedOut.uiState === 'live' && timedOut.transitioningRunKey !== null
  assert('LiveViewPresentation\'s render gate no longer matches after timeout (TransitionScreen actually exits)', wouldRenderTransitionScreen === false)
}

// --- Test 5c: suppressedRunKey prevents LiveView from immediately
//     re-entering transition for the SAME stuck run on the next poll,
//     without blocking a genuinely NEWER run from transitioning normally.
//     (This models the isRunChange condition from LiveView.tsx's poll loop
//     directly, since that logic lives in LiveView, not the reducer.) ---
{
  const suppressedRunKey = 'pegasus:obs-1:stuck'
  const displayedRunKey = 'pegasus:obs-1:2026-07-09T20:00:00.000Z'

  function isRunChange(incomingRunKey, displayed, suppressed) {
    return incomingRunKey !== null && displayed !== null && incomingRunKey !== displayed && incomingRunKey !== suppressed
  }

  assert(
    'the same stuck run reported again is NOT treated as a run change (suppressed)',
    isRunChange(suppressedRunKey, displayedRunKey, suppressedRunKey) === false,
  )
  assert(
    'a genuinely newer run key IS still treated as a run change (not blocked by an unrelated suppression)',
    isRunChange('pegasus:obs-1:even-newer', displayedRunKey, suppressedRunKey) === true,
  )
}

// --- Test 6: POLL_RUN_TRANSITIONING with the SAME run key as an
//     already-set one is a true no-op (returns the identical state
//     reference — no unnecessary re-render). ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: 'pegasus:obs-1:new' })
  const again = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: 'pegasus:obs-1:new' })
  assert('re-dispatching the identical run key returns the SAME state object (true no-op)', again === state)
}

// --- Test 7: a top-level state change (offline/finished) clears any
//     in-progress transition — it must not linger into an unrelated state. ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: 'pegasus:obs-1:new' })
  const offline = liveStatusReducer(state, { type: 'POLL_OFFLINE', payload: { tonight: null, next: null } })
  assert('POLL_OFFLINE clears transitioningRunKey', offline.transitioningRunKey === null)
  assert('POLL_OFFLINE clears transitionStartedAt', offline.transitionStartedAt === null)
}

// --- Test 8: a null stackRunStartedAt on an incoming poll must NOT trigger
//     a false transition — it means "server couldn't resolve the active
//     run this poll," not "the run is now null." Models LiveView.tsx's
//     incomingRunKey computation directly (computeRunKey is only called
//     when body.stackRunStartedAt is non-null; the reducer never sees the
//     difference, so this is tested at the same level the guard lives). ---
{
  function computeIncomingRunKey(source, observationId, stackRunStartedAt) {
    if (stackRunStartedAt == null) return null
    return `${source}:${observationId}:${stackRunStartedAt}`
  }

  const incomingRunKey = computeIncomingRunKey('pegasus', 'obs-1', null)
  assert('a null stackRunStartedAt produces a null incoming run key (skips comparison entirely)', incomingRunKey === null)

  const displayedRunKey = 'pegasus:obs-1:2026-07-09T20:00:00.000Z'
  const isRunChange = incomingRunKey !== null && displayedRunKey !== null && incomingRunKey !== displayedRunKey
  assert('a null incoming run key never registers as a run change, regardless of what is currently displayed', isRunChange === false)
}

// --- Test 9: a stale preload for a superseded run must be dropped, not
//     promoted. Models LiveView.tsx's post-preload guard directly: after
//     preloadImage resolves for run B, if transitioningRunKey has since
//     moved on to run C (superseded by a later POLL_RUN_TRANSITIONING or
//     by TRANSITION_TIMEOUT firing on its own independent timer mid-await),
//     run B's frame must be dropped rather than dispatched as live. ---
{
  let state = liveStatusReducer(initialLiveStatusState, {
    type: 'POLL_LIVE_IMAGE_LOADED',
    frame: frameForRun({}),
    loadedAt: 1000,
  })
  const runB = 'pegasus:obs-1:runB'
  const runC = 'pegasus:obs-1:runC'
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: runB })

  // Run B's preload is "in flight" here. Before it resolves, run C
  // supersedes it (a later poll, or TRANSITION_TIMEOUT firing independently).
  state = liveStatusReducer(state, { type: 'POLL_RUN_TRANSITIONING', runKey: runC })
  assert('setup: transitioningRunKey has moved on to run C while B\'s preload is still in flight', state.transitioningRunKey === runC)

  // LiveView's guard: const stateNow = stateRef.current; if
  // (stateNow.transitioningRunKey !== null && stateNow.transitioningRunKey
  // !== incomingRunKey) return — for run B's now-resolved preload,
  // incomingRunKey is runB, stateNow.transitioningRunKey is runC.
  const incomingRunKeyForResolvedPreload = runB
  const shouldDropStalePreload =
    state.transitioningRunKey !== null && state.transitioningRunKey !== incomingRunKeyForResolvedPreload
  assert('run B\'s late-resolving preload is correctly identified as stale and dropped', shouldDropStalePreload === true)

  // Confirm the guard does NOT false-positive when the preload's run
  // actually matches what's currently being waited on (the normal path).
  const incomingRunKeyForCurrentPreload = runC
  const shouldDropCurrentPreload =
    state.transitioningRunKey !== null && state.transitioningRunKey !== incomingRunKeyForCurrentPreload
  assert('a preload for the CURRENTLY-awaited run is NOT dropped by the same guard', shouldDropCurrentPreload === false)
}

console.log('')
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`)
  process.exit(1)
} else {
  console.log('All assertions passed.')
}
