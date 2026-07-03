'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import {
  liveStatusReducer,
  initialLiveStatusState,
  type LiveStatusState,
  type OfflinePayload,
} from '@/lib/live-status'

const POLL_INTERVAL_MS = 10 * 1000
const FETCH_TIMEOUT_MS = 8 * 1000
const IMAGE_PRELOAD_TIMEOUT_MS = 10 * 1000
const RECONNECT_CHECK_MS = 1000 // how often we check the 45s give-up clause while reconnecting

// Raw /api/status response shapes we care about. Anything not matching one of
// these (network error, timeout, non-2xx, bad JSON) is POLL_FAILED — never
// treated as offline. See lib/live-status.ts for the full contract notes.
type StatusLive = {
  live: true
  source: 'pegasus' | 'seestar'
  frame: { frameId: string; blobUrl: string; capturedAt: string; ingestedAt: string }
  observation: { observationId: string; objectName: string }
  sessionId: string
}
type StatusOffline = {
  live: false
  degraded?: false
  tonight: OfflinePayload['tonight']
  next: OfflinePayload['next']
}
type StatusDegraded = { live: false; degraded: true; tonight?: OfflinePayload['tonight']; next?: OfflinePayload['next'] }
type StatusResponse = StatusLive | StatusOffline | StatusDegraded

function isStatusResponse(v: unknown): v is StatusResponse {
  return typeof v === 'object' && v !== null && 'live' in v
}

// Preload an image; resolve only once it has actually loaded (never resolve
// on a half-fetched or errored image). 10s timeout treated as failure.
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => {
      img.onload = null
      img.onerror = null
      reject(new Error('image preload timed out'))
    }, IMAGE_PRELOAD_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('image preload failed'))
    }
    img.src = src
  })
}

function athensNowHHMM(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

// Same formatting as the server's athensToday() (lib/schedule.ts) — en-CA
// yields ISO-style YYYY-MM-DD.
function athensTodayDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default function LiveView() {
  const [state, dispatch] = useReducer(liveStatusReducer, initialLiveStatusState)

  // Mutable refs for values the polling loop needs without re-subscribing
  // effects on every state change (the loop reads "current" state via refs,
  // not via the closure captured at effect-setup time).
  const stateRef = useRef(state)
  stateRef.current = state
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const stoppedRef = useRef(false) // true while document.hidden

  // "updated Xs ago" ticks on its own timer, independent of polling.
  const [, forceTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function pollOnce() {
      if (inFlightRef.current) return
      inFlightRef.current = true

      const controller = new AbortController()
      const fetchTimeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      try {
        const res = await fetch('/api/status', { signal: controller.signal, cache: 'no-store' })
        if (!res.ok) throw new Error(`status ${res.status}`)

        const body: unknown = await res.json()
        if (!isStatusResponse(body)) throw new Error('malformed response')
        // Only clear the fetch-timeout abort once the ENTIRE status request —
        // headers, body parse, and shape validation — has completed. Clearing
        // right after fetch() resolves would leave a stalled res.json() body
        // parse uncovered by the 8s timeout.
        clearTimeout(fetchTimeout)
        if (cancelled) return

        if (body.live === false && body.degraded === true) {
          dispatch({ type: 'POLL_DEGRADED' })
        } else if (body.live === false) {
          dispatch({ type: 'POLL_OFFLINE', payload: { tonight: body.tonight, next: body.next } })
        } else {
          // live:true — never dispatch "live" until the image actually preloads.
          const current = stateRef.current
          if (current.lastLiveFrame?.frameId === body.frame.frameId) {
            // Same frame we already showed — no need to re-preload, just
            // refresh the "updated Xs ago" anchor via a synthetic reload event
            // using the existing loadedAt (recompute below is unnecessary;
            // simplest correct move is to re-dispatch with the same loadedAt
            // preserved so the label keeps ticking off the real load time).
            dispatch({
              type: 'POLL_LIVE_IMAGE_LOADED',
              frame: {
                frameId: body.frame.frameId,
                blobUrl: body.frame.blobUrl,
                ingestedAt: body.frame.ingestedAt,
                objectName: body.observation.objectName,
              },
              loadedAt: current.lastLiveFrame.loadedAt,
            })
          } else {
            try {
              await preloadImage(body.frame.blobUrl)
              if (cancelled) return
              dispatch({
                type: 'POLL_LIVE_IMAGE_LOADED',
                frame: {
                  frameId: body.frame.frameId,
                  blobUrl: body.frame.blobUrl,
                  ingestedAt: body.frame.ingestedAt,
                  objectName: body.observation.objectName,
                },
                loadedAt: Date.now(),
              })
            } catch {
              if (!cancelled) dispatch({ type: 'POLL_LIVE_IMAGE_FAILED' })
            }
          }
        }
      } catch {
        clearTimeout(fetchTimeout)
        if (!cancelled) dispatch({ type: 'POLL_FAILED' })
      } finally {
        inFlightRef.current = false
        if (!cancelled) scheduleNext()
      }
    }

    function scheduleNext() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (stoppedRef.current || document.hidden) return
      timeoutRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS)
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stoppedRef.current = true
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
      } else {
        stoppedRef.current = false
        pollOnce() // immediate poll on becoming visible
      }
    }

    function onFocus() {
      if (!document.hidden) pollOnce()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)

    pollOnce() // initial poll

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // Reconnecting give-up clause driven by wall-clock time (45s since last
  // confirmed-live payload), independent of poll cadence — a slow/absent poll
  // stream must not prevent giving up to degraded.
  useEffect(() => {
    if (state.uiState !== 'reconnecting') return
    const id = setInterval(() => dispatch({ type: 'RECONNECT_TIMEOUT' }), RECONNECT_CHECK_MS)
    return () => clearInterval(id)
  }, [state.uiState])

  // Tick every second so "updated Xs ago" stays live without waiting on a poll.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return <LiveViewPresentation state={state} />
}

function secondsAgo(ms: number): number {
  return Math.max(0, Math.round((Date.now() - ms) / 1000))
}

function offlineCopy(state: LiveStatusState): { heading: string; sub?: string } {
  const payload = state.lastOfflinePayload
  if (!payload) return { heading: 'Checking tonight’s schedule…' }

  const { tonight, next } = payload

  // /api/status returns tonight's own event as `next` whenever its end-time
  // hasn't passed yet (see app/api/status/route.ts step "c"), so a `next`
  // dated today is the SAME event as `tonight`, not a distinct upcoming one —
  // suppress it as a sub-line to avoid showing the same session twice.
  const today = athensTodayDate()
  const distinctNext = next && next.date !== today ? next : null

  if (tonight?.cancelled) {
    return {
      heading: 'Tonight’s session is cancelled',
      sub: tonight.cancellationReason
        ? tonight.cancellationReason
        : distinctNext
          ? `Next session: ${distinctNext.date}, ${distinctNext.start}`
          : undefined,
    }
  }

  if (tonight) {
    const now = athensNowHHMM()
    let heading: string
    if (now < tonight.start) heading = `Tonight starts at ${tonight.start}`
    else if (now < tonight.end) heading = 'Scheduled now, waiting for the telescope feed'
    else heading = 'Tonight’s session has ended'
    return { heading, sub: distinctNext ? `Next session: ${distinctNext.date}, ${distinctNext.start}` : undefined }
  }

  if (next) return { heading: `Next session: ${next.date}, ${next.start}` }
  return { heading: 'No upcoming sessions scheduled' }
}

function LiveViewPresentation({ state }: { state: LiveStatusState }) {
  const { uiState, lastLiveFrame } = state

  if (uiState === 'checking') {
    return <StatusScreen heading="Checking…" />
  }

  if (uiState === 'degraded') {
    return <StatusScreen heading="Temporarily unavailable" sub="Retrying…" />
  }

  if (uiState === 'offline-cancelled' || uiState === 'offline-event-tonight' || uiState === 'offline-nothing') {
    const { heading, sub } = offlineCopy(state)
    return <StatusScreen heading={heading} sub={sub} />
  }

  // live or reconnecting — both render the last known frame; reconnecting
  // adds a subtle label without replacing the image.
  if (!lastLiveFrame) {
    // Shouldn't happen (live/reconnecting always have a frame by construction
    // of the reducer), but keep the render total rather than crashing.
    return <StatusScreen heading="Checking…" />
  }

  return (
    <div className="live-root">
      <div className="live-image-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- external Vercel Blob URL, no next/image domain config for v1 */}
        <img src={lastLiveFrame.blobUrl} alt={lastLiveFrame.objectName} className="live-image" />
      </div>
      <div className="live-meta">
        <span className={`live-indicator${uiState === 'reconnecting' ? ' reconnecting' : ''}`}>
          {uiState === 'reconnecting' ? 'RECONNECTING' : 'LIVE'}
        </span>
        <span className="live-object">{lastLiveFrame.objectName}</span>
        <span className="live-updated">updated {secondsAgo(lastLiveFrame.loadedAt)}s ago</span>
      </div>
    </div>
  )
}

function StatusScreen({ heading, sub }: { heading: string; sub?: string }) {
  return (
    <div className="status-root">
      <p className="status-heading">{heading}</p>
      {sub ? <p className="status-sub">{sub}</p> : null}
    </div>
  )
}
