// Pure state machine for the /live page. No I/O here — app/live/LiveView.tsx
// owns fetching, image preloading, and timers; this file only knows how to
// fold an Event into the next UiState. Kept separate so the transition table
// can be read (and tested) without any browser APIs involved.

export const UI_STATES = [
  'checking',
  'live',
  'offline-event-tonight',
  'offline-cancelled',
  'offline-nothing',
  'reconnecting',
  'degraded',
  'finished',
  // A special event's own finished state (see
  // app/live/special-event/EventGate.tsx and app/live/SpecialEventFarewell.tsx)
  // — deliberately separate from
  // 'finished', which renders the hotel-specific Aegean UFO farewell. Special
  // events never dispatch POLL_FINISHED and hotels never dispatch
  // POLL_SPECIAL_EVENT_FINISHED, so the two states can never cross.
  'special-event-finished',
] as const
export type UiState = (typeof UI_STATES)[number]

// What the guest-facing object label should show, derived once at dispatch
// time from telemetry.astrometryState + objectMatch (see LiveView.tsx). Kept
// as a settled display decision rather than raw telemetry, so this reducer
// (and every other consumer of LiveFrame) stays presentation-agnostic about
// astrometry states/confidence tiers — it just renders whichever of these
// three the caller already decided.
export type DisplayObject =
  | {
      kind: 'known'
      name: string
      description: string
      type: string
      // Optional/additive — absent on any catalog entry not yet back-filled;
      // the facts UI renders gracefully-absent rather than showing a fake
      // value (see Facts in app/live/LiveView.tsx).
      constellation?: string
      distanceLy?: number
      // Guest-relatable apparent size (vs. the Moon), NOT physical size —
      // see CatalogObject.sizeDescription in lib/catalog.ts.
      sizeDescription?: string
      // Enriched-card content — see CatalogObject.wowFacts/visualHint/drawer
      // in lib/catalog.ts. Optional/additive like the fields above; the
      // enriched card renders only when present, falling back to the plain
      // card otherwise (see EnrichedCard in app/live/LiveView.tsx).
      wowFacts?: string[]
      visualHint?: string
      drawer?: { heading: string; body: string }[]
    }
  | { kind: 'moving' }
  | { kind: 'fallback' }

export type LiveFrame = {
  frameId: string
  blobUrl: string
  objectName: string
  displayObject: DisplayObject
  // Which Observation this frame belongs to — drives the stacking-milestone
  // toggle's fetch (see app/api/observations/[id]/milestones/route.ts and
  // MilestoneToggle in app/live/LiveView.tsx). Changes whenever the target
  // changes, which is exactly when the milestone toggle needs to reset/refetch.
  observationId: string
  // Which device produced this frame ("pegasus" | "seestar" | a special-event
  // slug) — part of the milestone toggle's reset key alongside observationId
  // and stackRunStartedAt (see MilestoneToggle's runKey), so a milestone
  // selection can never survive an active-source switch and show under the
  // wrong device's card.
  source: string
  // The stack run this frame belongs to (see /api/status's
  // stackRunStartedAt, sourced from StackRun.startedAt) — null when no
  // StackRun row exists for this observation yet (e.g. pre-migration data).
  // Combined with source+observationId this is the frame's "run key" (see
  // computeRunKey in lib/detect-transition.ts) — what
  // state-aware-transition compares against transitioningRunKey below to
  // decide whether a freshly-loaded frame actually belongs to the run the
  // guest is waiting for, or is a late-arriving frame from an EARLIER run
  // that should be ignored once a newer transition has superseded it.
  stackRunStartedAt: string | null
  // Seconds of exposure the device has accumulated, when telemetry reported
  // it. "Total accumulated" (not per-object) — see the render label; absent
  // on Tier-1-only frames or when the device didn't send it.
  totalAccumulatedTime?: number
  ingestedAt: string
  loadedAt: number // Date.now() when the preload actually completed — drives "updated Xs ago"
}

export type TonightInfo = { hotelId: string; start: string; end: string; cancelled: boolean; cancellationReason?: string }
export type NextInfo = { date: string; hotelId: string; start: string; end: string }
export type OfflinePayload = { tonight: TonightInfo | null; next: NextInfo | null }

// Carried alongside the 'finished' uiState — date is the deterministic seed
// every viewer uses to independently pick the SAME farewell animation
// variant for tonight (see lib/live-farewell.ts); next is the same
// next-session lookup the offline state already uses, so the farewell
// screen's "Next session: Monday, 21:30" line is never a second source of
// truth. Both come straight through from /api/status's finished response.
export type FinishedInfo = { date: string; next: NextInfo | null }

export type LiveStatusState = {
  uiState: UiState
  lastLiveFrame: LiveFrame | null
  lastStatusAt: number | null // last time ANY poll produced a result (success or failure), for observability
  lastLiveStatusAt: number | null // last time a live:true payload was actually confirmed live (image loaded)
  consecutiveFailures: number
  lastOfflinePayload: OfflinePayload | null
  finishedInfo: FinishedInfo | null
  // Which KIND of transition is active, if any — the single source of truth
  // for "is a transition showing right now," checked by render/poll-loop
  // code instead of transitioningRunKey/transitioningFrameId directly (see
  // those fields' own doc comments for why they're each only meaningful
  // under ONE of these two reasons, never both at once):
  //   'run-change' — the telescope moved to a new stack run, but no frame
  //     from it has been shown yet. Waits for a SPECIFIC run key.
  //   'frame-stale' — the CURRENTLY displayed frame is simply too old
  //     (production logs showed 1.5-2.5 min real slew gaps with zero
  //     transition screens shown, because run-change alone only fires once
  //     the new run's stackRunStartedAt appears — which happens at the same
  //     moment as its first frame, not before). Waits for ANY fresher
  //     frame, including one from the SAME stack run (e.g. a slow upload
  //     cycle) — see transitioningFrameId's own doc comment for why this is
  //     a deliberately different waiting-semantics than run-change.
  // Never both at once — POLL_FRAME_STALE no-ops if a run-change transition
  // is already in progress (see that case below), and POLL_RUN_TRANSITIONING
  // always wins by simply overwriting whichever reason was active.
  transitionReason: 'run-change' | 'frame-stale' | null
  // Meaningful ONLY when transitionReason === 'run-change'. Set when a live
  // poll reports a run key (source+observationId+stackRunStartedAt) that
  // differs from lastLiveFrame's own run key — "the telescope has moved on
  // to a new stack run, but we haven't shown a frame from it yet." While
  // set, LiveView suppresses the OLD frame's image/card and shows the
  // moving/transition copy instead — see POLL_RUN_TRANSITIONING and
  // POLL_LIVE_IMAGE_LOADED below. Deliberately NOT implemented by clearing
  // lastLiveFrame itself: reconnecting's own "keep showing the last known
  // frame through a transient network blip" contract needs lastLiveFrame to
  // stay intact underneath, since a transition can still degrade into a
  // real connectivity problem (see transitionStartedAt below) and
  // reconnecting/degraded must have something to fall back to.
  transitioningRunKey: string | null
  // Meaningful ONLY when transitionReason === 'frame-stale'. The frameId of
  // the frame that was on screen when staleness was detected — recorded so
  // LiveView's defensive guard (see POLL_FRAME_STALE below) can ignore a
  // stray stale-timer firing for a frame that isn't displayed anymore (e.g.
  // a frame already promoted via a different path between the timer
  // scheduling its dispatch and it actually firing). Unlike
  // transitioningRunKey, this is NOT "the thing we're waiting for" — a
  // frame-stale transition accepts ANY successfully preloaded fresher
  // frame to exit (see LiveView's preload guard), including one belonging
  // to the SAME stack run as this id. It exists purely to validate the
  // dispatch is still relevant, not to gate what can resolve it.
  transitioningFrameId: string | null
  // Date.now() when the CURRENT transition (whichever reason) first began —
  // restarted (not accumulated) if a newer run key supersedes an
  // in-progress run-change transition before it resolves, since waiting is
  // only ever for "the latest known run," never a stale one. Shared across
  // both reasons (only one is ever active at a time) — used by LiveView's
  // timeout check to fall through to reconnecting/offline after 5 minutes
  // with no displayable frame (see TRANSITION_GIVE_UP_MS) — a stuck
  // transition must not leave the guest staring at "next object incoming"
  // forever, regardless of which reason produced it.
  transitionStartedAt: number | null
  // Set by TRANSITION_TIMEOUT to the run key that just gave up waiting —
  // NOT cleared afterward like transitioningRunKey normally would be,
  // because the server may keep reporting the SAME stuck stackRunStartedAt
  // on every subsequent poll (e.g. a stalled stack that never produces a
  // usable frame). Without this, the very next poll would recompute the
  // identical incoming run key, see it differs from the displayed frame's
  // run key, and immediately re-dispatch POLL_RUN_TRANSITIONING — flipping
  // straight back into TransitionScreen and undoing the fall-through to
  // reconnecting this timeout exists to produce. Once a run key is
  // suppressed, LiveView simply skips run-change detection for it; a
  // genuinely NEWER run key (a real target change) is unaffected and still
  // triggers a normal transition. Cleared whenever a frame legitimately
  // promotes to live (POLL_LIVE_IMAGE_LOADED) or the feed goes offline/
  // finishes, so a future stall can be suppressed again independently.
  //
  // Deliberately run-change ONLY — a frame-stale timeout has no equivalent
  // "stuck on the identical value forever" failure mode to guard against
  // (the next poll's frame.frameId is naturally different data each time
  // regardless of staleness), so TRANSITION_TIMEOUT's frame-stale branch
  // never touches this field.
  suppressedRunKey: string | null
}

export const initialLiveStatusState: LiveStatusState = {
  uiState: 'checking',
  lastLiveFrame: null,
  lastStatusAt: null,
  lastLiveStatusAt: null,
  consecutiveFailures: 0,
  lastOfflinePayload: null,
  finishedInfo: null,
  transitionReason: null,
  transitioningRunKey: null,
  transitioningFrameId: null,
  transitionStartedAt: null,
  suppressedRunKey: null,
}

// Only the fields the reducer needs from a raw /api/status "live" body.
type LiveFramePayload = {
  frameId: string
  blobUrl: string
  ingestedAt: string
  objectName: string
  displayObject: DisplayObject
  observationId: string
  source: string
  stackRunStartedAt: string | null
  totalAccumulatedTime?: number
}

export type LiveStatusEvent =
  | { type: 'POLL_LIVE_IMAGE_LOADED'; frame: LiveFramePayload; loadedAt: number }
  | { type: 'POLL_LIVE_IMAGE_FAILED' }
  | { type: 'POLL_OFFLINE'; payload: OfflinePayload }
  | { type: 'POLL_DEGRADED' }
  | { type: 'POLL_FAILED' }
  | { type: 'RECONNECT_TIMEOUT' }
  | { type: 'POLL_FINISHED'; payload: FinishedInfo }
  | { type: 'POLL_SPECIAL_EVENT_FINISHED' }
  // Dispatched by LiveView the moment a live poll's run key
  // (source+observationId+stackRunStartedAt) no longer matches
  // lastLiveFrame's own run key — fired BEFORE attempting to preload the
  // new run's frame, so the old image/card disappears immediately rather
  // than lingering until the new frame finishes loading. runKey is the
  // NEWEST known run key; dispatching this again with a different runKey
  // while already transitioning simply replaces it and restarts
  // transitionStartedAt (see the reducer case) — only the latest run is
  // ever waited on.
  | { type: 'POLL_RUN_TRANSITIONING'; runKey: string }
  // Dispatched by LiveView's OWN wall-clock timer (not the poll cycle —
  // see FRAME_STALE_CHECK_MS in LiveView.tsx) when the currently displayed
  // frame's ingestedAt crosses FRAME_STALE_AFTER_MS while uiState==='live'.
  // frameId is the CURRENTLY displayed frame at the moment the timer fired
  // — the reducer uses it as a defensive guard (see the case below) against
  // a stray firing for a frame that isn't displayed anymore. A no-op if a
  // transition (either reason) is already active — staleness only ever
  // STARTS a transition, it never interrupts/overrides an in-progress one
  // (a run-change already means the guest is correctly seeing "next object
  // incoming"; re-flagging the same situation as "stale" underneath it
  // would be redundant, not additive).
  | { type: 'POLL_FRAME_STALE'; frameId: string }
  // A transition has been waiting TRANSITION_GIVE_UP_MS with no displayable
  // frame — falls through to reconnecting so the guest sees a real "trying
  // to reconnect" state instead of an indefinite "next object incoming."
  // Only meaningful while actually transitioning; a no-op guard in the
  // reducer (same pattern as RECONNECT_TIMEOUT) so a stray timer firing
  // after the transition already resolved can't corrupt anything. Branches
  // internally on transitionReason — see the case below — since run-change
  // and frame-stale exit through different fields (suppressedRunKey is
  // run-change only, see that field's own doc comment).
  | { type: 'TRANSITION_TIMEOUT' }
// FOCUS_VISIBLE / HIDDEN are not reducer events: per the transition table both
// are "any state -> same state" (HIDDEN also stops the poll scheduler, and
// FOCUS_VISIBLE triggers an immediate poll) — i.e. they never change uiState
// or any other field here, so LiveView handles them directly as scheduling
// concerns rather than routing them through the reducer.

const RECONNECT_AFTER_FAILURES = 2 // live -> reconnecting on the 2nd consecutive failure
const GIVE_UP_AFTER_FAILURES = 4 // reconnecting -> degraded on the 4th consecutive failure
const GIVE_UP_AFTER_MS = 45 * 1000 // ...or 45s since the last confirmed-live payload, whichever first
const TRANSITION_GIVE_UP_MS = 5 * 60 * 1000 // a transition waiting this long with no displayable frame falls through to reconnecting

function deriveOfflineState(payload: OfflinePayload): UiState {
  if (payload.tonight?.cancelled) return 'offline-cancelled'
  if (payload.tonight) return 'offline-event-tonight'
  return 'offline-nothing'
}

export function liveStatusReducer(state: LiveStatusState, event: LiveStatusEvent): LiveStatusState {
  const now = Date.now()

  switch (event.type) {
    case 'POLL_LIVE_IMAGE_LOADED': {
      const frame: LiveFrame = {
        frameId: event.frame.frameId,
        blobUrl: event.frame.blobUrl,
        objectName: event.frame.objectName,
        displayObject: event.frame.displayObject,
        observationId: event.frame.observationId,
        source: event.frame.source,
        stackRunStartedAt: event.frame.stackRunStartedAt,
        totalAccumulatedTime: event.frame.totalAccumulatedTime,
        ingestedAt: event.frame.ingestedAt,
        loadedAt: event.loadedAt,
      }
      // Applies uniformly from checking/live/reconnecting/any-offline/degraded:
      // a confirmed image load always wins and clears the failure count.
      //
      // transitionReason/transitioningRunKey/transitioningFrameId ALL clear
      // unconditionally here, regardless of which reason (if any) was
      // active — this is correct BECAUSE the accept/reject decision already
      // happened upstream in LiveView before this event was ever dispatched
      // (see the poll loop's preload guard): for a run-change transition,
      // only a frame matching the awaited runKey gets dispatched at all; for
      // a frame-stale transition, ANY successfully preloaded frame with a
      // different frameId does (including one from the SAME stack run — the
      // whole point of frame-stale is "prove the feed is alive with
      // anything fresher," not "wait for a specific run"). By the time this
      // reducer case runs, the frame it received has already been confirmed
      // acceptable for whichever reason was active — nothing left to
      // re-check here, same as before this feature existed.
      return {
        ...state,
        uiState: 'live',
        lastLiveFrame: frame,
        lastStatusAt: now,
        lastLiveStatusAt: now,
        consecutiveFailures: 0,
        transitionReason: null,
        transitioningRunKey: null,
        transitioningFrameId: null,
        transitionStartedAt: null,
        suppressedRunKey: null,
      }
    }

    case 'POLL_RUN_TRANSITIONING': {
      // Restarts (does not accumulate) transitionStartedAt whenever the
      // run key actually changes — including superseding an already-
      // in-progress transition with an even newer run key (invariant #6):
      // the 5-minute give-up clock always measures "how long have we been
      // waiting for the CURRENT best-known run," never a stale one. If
      // LiveView redispatches with the SAME runKey it's already waiting on
      // (e.g. a redundant poll), this is a no-op — the clock must not
      // reset on every single poll of an already-known transition. Also
      // ALWAYS wins over an in-progress frame-stale transition — a genuine
      // run change is strictly more informative than "the old frame was
      // just old," so it supersedes rather than being blocked by it (unlike
      // POLL_FRAME_STALE below, which defers to an existing transition of
      // EITHER reason instead of overriding it).
      if (state.transitionReason === 'run-change' && state.transitioningRunKey === event.runKey) return state
      return {
        ...state,
        transitionReason: 'run-change',
        transitioningRunKey: event.runKey,
        transitioningFrameId: null,
        transitionStartedAt: now,
        // A genuinely new transition means whatever run suppressedRunKey
        // was holding onto (from an earlier TRANSITION_TIMEOUT) has been
        // superseded — the newest run key is now what LiveView compares
        // against, so an old suppression can only linger as stale state
        // that's never checked again. Clearing it here matches
        // POLL_LIVE_IMAGE_LOADED's own clearing behavior on the other exit
        // path out of "waiting on a specific run."
        suppressedRunKey: null,
        lastStatusAt: now,
      }
    }

    case 'POLL_FRAME_STALE': {
      // No-op if a transition of EITHER reason is already active — staleness
      // only ever STARTS a transition, never interrupts/overrides one (see
      // this event's own doc comment above). Also a no-op if the frame that
      // went stale isn't the one currently displayed — a defensive guard
      // against a stray dispatch racing a frame change (e.g. the timer's
      // setTimeout callback was already queued when a fresh frame promoted
      // via the normal poll path a moment earlier).
      if (state.transitionReason !== null) return state
      if (state.lastLiveFrame?.frameId !== event.frameId) return state
      return {
        ...state,
        transitionReason: 'frame-stale',
        transitioningFrameId: event.frameId,
        transitioningRunKey: null,
        transitionStartedAt: now,
      }
    }

    case 'TRANSITION_TIMEOUT': {
      // No-op guard, same pattern as RECONNECT_TIMEOUT below: only
      // meaningful while a transition is actually in progress, so a stray
      // timer firing after it already resolved (or was superseded and
      // resolved under its new key) can't corrupt anything. Also a no-op
      // until TRANSITION_GIVE_UP_MS has actually elapsed since
      // transitionStartedAt — LiveView's own timer fires this every second
      // (same polling-independent pattern as RECONNECT_TIMEOUT), so most
      // firings during a normal, resolving transition are expected no-ops.
      if (state.transitionReason === null || state.transitionStartedAt === null) return state
      if (now - state.transitionStartedAt < TRANSITION_GIVE_UP_MS) return state
      // Route through the SAME failure-escalation path a real connectivity
      // problem would, rather than inventing a separate outcome — from the
      // guest's perspective "we've been waiting 5 minutes with nothing to
      // show" should look identical whether the cause was network trouble,
      // a stuck run-change transition, or a stuck frame-stale transition.
      //
      // transitionReason/transitioningRunKey/transitioningFrameId are ALL
      // cleared here (unlike an earlier version of this case) so
      // LiveViewPresentation's uiState==='live' && transitionReason!==null
      // render gate stops matching and TransitionScreen actually gives way
      // to the normal reconnecting UI — otherwise the guest would be stuck
      // looking at "next object incoming" forever despite uiState having
      // moved on.
      //
      // suppressedRunKey is set ONLY for the run-change reason — see that
      // field's own doc comment for why a frame-stale timeout has no
      // equivalent "stuck on the same value" failure mode to guard against.
      // For run-change, the run key that just gave up is remembered there
      // so that if the server keeps reporting this SAME stuck run on the
      // next poll, LiveView won't immediately recompute the identical
      // "incoming != displayed" mismatch and re-dispatch
      // POLL_RUN_TRANSITIONING right back into transition. A frame for the
      // suppressed run arriving late can still promote directly via
      // POLL_LIVE_IMAGE_LOADED (which clears suppressedRunKey too) — this
      // only suppresses re-ENTERING the transition screen, not accepting
      // the frame if it shows up.
      return {
        ...state,
        uiState: 'reconnecting',
        transitionReason: null,
        transitioningRunKey: null,
        transitioningFrameId: null,
        suppressedRunKey: state.transitionReason === 'run-change' ? state.transitioningRunKey : state.suppressedRunKey,
      }
    }

    case 'POLL_LIVE_IMAGE_FAILED': {
      // checking -> checking (retry quietly); live/reconnecting -> unchanged
      // (keep showing the old image); any offline state -> unchanged (don't
      // flash live). In every case: don't touch uiState, just record the poll.
      //
      // consecutiveFailures resets to 0: the server WAS reached (it returned
      // live:true) — only the image failed to load. That's a bad-image
      // problem, not an unreachable-API problem, so it must not feed the same
      // counter that drives live->reconnecting->degraded on transport
      // failures. Leaving it unchanged would let non-consecutive transport
      // failures accumulate across an otherwise-successful poll and falsely
      // trip reconnecting.
      return { ...state, lastStatusAt: now, consecutiveFailures: 0 }
    }

    case 'POLL_OFFLINE': {
      // A valid live:false response always wins over client-side grace —
      // reachable from every state, including straight out of live/reconnecting.
      // transitionReason/transitioningRunKey/transitioningFrameId/
      // transitionStartedAt all clear here too: whatever the guest was
      // waiting on (either reason) is moot once the feed itself is
      // confirmed offline — resuming later starts a fresh transition, if any.
      return {
        ...state,
        uiState: deriveOfflineState(event.payload),
        lastStatusAt: now,
        consecutiveFailures: 0,
        lastOfflinePayload: event.payload,
        transitionReason: null,
        transitioningRunKey: null,
        transitioningFrameId: null,
        transitionStartedAt: null,
        suppressedRunKey: null,
      }
    }

    case 'POLL_FINISHED': {
      // The explicit "tonight is finished" flag always wins, reachable from
      // ANY state — including straight out of 'live' with a frame that's
      // only seconds old. This is the entire point of the feature: a stale/
      // quiet feed alone must NEVER produce this state (that's reconnecting/
      // degraded's job), only a deliberate POST to /api/finish does, so once
      // that signal arrives it must override everything else unconditionally.
      return {
        ...state,
        uiState: 'finished',
        lastStatusAt: now,
        consecutiveFailures: 0,
        finishedInfo: event.payload,
        transitionReason: null,
        transitioningRunKey: null,
        transitioningFrameId: null,
        transitionStartedAt: null,
        suppressedRunKey: null,
      }
    }

    case 'POLL_SPECIAL_EVENT_FINISHED': {
      // Mirrors POLL_FINISHED's "always wins, from any state" rule, but for
      // the special-event finished flag (eventFinishedKey, scoped per source
      // — see lib/redis.ts) instead of the shared hotel EVENT_FINISHED_KEY.
      // No payload: special events have no "next session" date to carry (see
      // extraEventStatus in app/api/status/route.ts), so there's nothing
      // beyond the state transition itself.
      return {
        ...state,
        uiState: 'special-event-finished',
        lastStatusAt: now,
        consecutiveFailures: 0,
        transitionReason: null,
        transitioningRunKey: null,
        transitioningFrameId: null,
        transitionStartedAt: null,
        suppressedRunKey: null,
      }
    }

    case 'POLL_DEGRADED': {
      return { ...state, uiState: 'degraded', lastStatusAt: now, consecutiveFailures: 0 }
    }

    case 'POLL_FAILED': {
      const consecutiveFailures = state.consecutiveFailures + 1
      let uiState = state.uiState

      if (state.uiState === 'checking') {
        // Stay checking through the first failure; degrade from the 2nd.
        uiState = consecutiveFailures >= 2 ? 'degraded' : 'checking'
      } else if (state.uiState === 'live') {
        // 2nd consecutive failure while live -> reconnecting.
        uiState = consecutiveFailures >= RECONNECT_AFTER_FAILURES ? 'reconnecting' : 'live'
      } else if (state.uiState === 'reconnecting') {
        // Give-up threshold checked here too (belt and suspenders — LiveView
        // also runs a timer-driven RECONNECT_TIMEOUT for the 45s clause since
        // that clause can elapse with no new poll to trigger it).
        uiState = consecutiveFailures >= GIVE_UP_AFTER_FAILURES ? 'degraded' : 'reconnecting'
      }
      // offline-* and degraded: unchanged — keep last known copy, no trustworthy
      // new state to show. (degraded -> degraded is a no-op past this point.)

      return { ...state, uiState, lastStatusAt: now, consecutiveFailures }
    }

    case 'RECONNECT_TIMEOUT': {
      // Only meaningful from reconnecting; a no-op guard elsewhere so a stray
      // timer firing after a state change can't corrupt anything.
      if (state.uiState !== 'reconnecting') return state
      const failuresElapsed = state.consecutiveFailures >= GIVE_UP_AFTER_FAILURES
      const timeElapsed = state.lastLiveStatusAt !== null && now - state.lastLiveStatusAt >= GIVE_UP_AFTER_MS
      if (!failuresElapsed && !timeElapsed) return state
      return { ...state, uiState: 'degraded' }
    }

    default:
      return state
  }
}

export { GIVE_UP_AFTER_MS as RECONNECT_GIVE_UP_MS }
