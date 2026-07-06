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
    }
  | { kind: 'moving' }
  | { kind: 'fallback' }

export type LiveFrame = {
  frameId: string
  blobUrl: string
  objectName: string
  displayObject: DisplayObject
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

export type LiveStatusState = {
  uiState: UiState
  lastLiveFrame: LiveFrame | null
  lastStatusAt: number | null // last time ANY poll produced a result (success or failure), for observability
  lastLiveStatusAt: number | null // last time a live:true payload was actually confirmed live (image loaded)
  consecutiveFailures: number
  lastOfflinePayload: OfflinePayload | null
}

export const initialLiveStatusState: LiveStatusState = {
  uiState: 'checking',
  lastLiveFrame: null,
  lastStatusAt: null,
  lastLiveStatusAt: null,
  consecutiveFailures: 0,
  lastOfflinePayload: null,
}

// Only the fields the reducer needs from a raw /api/status "live" body.
type LiveFramePayload = {
  frameId: string
  blobUrl: string
  ingestedAt: string
  objectName: string
  displayObject: DisplayObject
  totalAccumulatedTime?: number
}

export type LiveStatusEvent =
  | { type: 'POLL_LIVE_IMAGE_LOADED'; frame: LiveFramePayload; loadedAt: number }
  | { type: 'POLL_LIVE_IMAGE_FAILED' }
  | { type: 'POLL_OFFLINE'; payload: OfflinePayload }
  | { type: 'POLL_DEGRADED' }
  | { type: 'POLL_FAILED' }
  | { type: 'RECONNECT_TIMEOUT' }
// FOCUS_VISIBLE / HIDDEN are not reducer events: per the transition table both
// are "any state -> same state" (HIDDEN also stops the poll scheduler, and
// FOCUS_VISIBLE triggers an immediate poll) — i.e. they never change uiState
// or any other field here, so LiveView handles them directly as scheduling
// concerns rather than routing them through the reducer.

const RECONNECT_AFTER_FAILURES = 2 // live -> reconnecting on the 2nd consecutive failure
const GIVE_UP_AFTER_FAILURES = 4 // reconnecting -> degraded on the 4th consecutive failure
const GIVE_UP_AFTER_MS = 45 * 1000 // ...or 45s since the last confirmed-live payload, whichever first

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
        totalAccumulatedTime: event.frame.totalAccumulatedTime,
        ingestedAt: event.frame.ingestedAt,
        loadedAt: event.loadedAt,
      }
      // Applies uniformly from checking/live/reconnecting/any-offline/degraded:
      // a confirmed image load always wins and clears the failure count.
      return {
        ...state,
        uiState: 'live',
        lastLiveFrame: frame,
        lastStatusAt: now,
        lastLiveStatusAt: now,
        consecutiveFailures: 0,
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
      return {
        ...state,
        uiState: deriveOfflineState(event.payload),
        lastStatusAt: now,
        consecutiveFailures: 0,
        lastOfflinePayload: event.payload,
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
