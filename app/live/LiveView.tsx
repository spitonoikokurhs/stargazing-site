'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import {
  liveStatusReducer,
  initialLiveStatusState,
  type LiveStatusState,
  type OfflinePayload,
} from '@/lib/live-status'
import {
  pickFlavor,
  hotelDisplayName,
  hotelLogoSrc,
  FLAVOR_ROTATE_MS,
  FLAVOR_NO_REPEAT_WINDOW,
  type FlavorContext,
  type OfflineSubState,
} from '@/lib/live-copy'

// Crossfade duration for a flavor-line swap; must match the opacity transition
// in styles.css (.status-flavor).
const FLAVOR_FADE_MS = 300

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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isSource(v: unknown): v is StatusLive['source'] {
  return v === 'pegasus' || v === 'seestar'
}

function isTonightInfo(v: unknown): v is OfflinePayload['tonight'] {
  if (v === null) return true
  if (!isObject(v)) return false
  const cancellationReason = v.cancellationReason
  return (
    isString(v.hotelId) &&
    isString(v.start) &&
    isString(v.end) &&
    typeof v.cancelled === 'boolean' &&
    (cancellationReason === undefined || isString(cancellationReason))
  )
}

function isNextInfo(v: unknown): v is OfflinePayload['next'] {
  if (v === null) return true
  return isObject(v) && isString(v.date) && isString(v.hotelId) && isString(v.start) && isString(v.end)
}

function isLiveStatus(v: Record<string, unknown>): v is StatusLive {
  if (v.live !== true || !isSource(v.source) || !isObject(v.frame) || !isObject(v.observation)) return false
  return (
    isString(v.frame.frameId) &&
    isString(v.frame.blobUrl) &&
    isString(v.frame.capturedAt) &&
    isString(v.frame.ingestedAt) &&
    isString(v.observation.observationId) &&
    isString(v.observation.objectName) &&
    isString(v.sessionId)
  )
}

function isOfflineStatus(v: Record<string, unknown>): v is StatusOffline {
  return v.live === false && v.degraded !== true && isTonightInfo(v.tonight) && isNextInfo(v.next)
}

function isStatusResponse(v: unknown): v is StatusResponse {
  if (!isObject(v)) return false
  if (v.live === false && v.degraded === true) return true
  return isLiveStatus(v) || isOfflineStatus(v)
}

// Preload an image; resolve only once it has actually loaded (never resolve
// on a half-fetched or errored image). 10s timeout treated as failure.
function preloadImage(src: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('image preload aborted'))
      return
    }
    const img = new Image()
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      img.onload = null
      img.onerror = null
    }
    const abort = () => {
      cleanup()
      img.src = ''
      reject(new Error('image preload aborted'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('image preload timed out'))
    }, IMAGE_PRELOAD_TIMEOUT_MS)
    img.onload = () => {
      cleanup()
      resolve()
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('image preload failed'))
    }
    signal?.addEventListener('abort', abort, { once: true })
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
  const activeControllerRef = useRef<AbortController | null>(null)
  const activeImageControllerRef = useRef<AbortController | null>(null)
  const pollGenerationRef = useRef(0)

  // "updated Xs ago" ticks on its own timer, independent of polling.
  const [, forceTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function pollOnce() {
      if (inFlightRef.current) return
      inFlightRef.current = true
      const pollGeneration = ++pollGenerationRef.current

      const controller = new AbortController()
      activeControllerRef.current = controller
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
            const imageController = new AbortController()
            activeImageControllerRef.current = imageController
            try {
              await preloadImage(body.frame.blobUrl, imageController.signal)
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
            } finally {
              if (activeImageControllerRef.current === imageController) activeImageControllerRef.current = null
            }
          }
        }
      } catch {
        clearTimeout(fetchTimeout)
        if (!cancelled) dispatch({ type: 'POLL_FAILED' })
      } finally {
        if (pollGenerationRef.current === pollGeneration) {
          if (activeControllerRef.current === controller) activeControllerRef.current = null
          inFlightRef.current = false
          if (!cancelled) scheduleNext()
        }
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
      pollGenerationRef.current += 1
      activeControllerRef.current?.abort()
      activeControllerRef.current = null
      activeImageControllerRef.current?.abort()
      activeImageControllerRef.current = null
      inFlightRef.current = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
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

  const lastLiveLoadedAt = state.lastLiveFrame?.loadedAt

  // Tick every second so "updated Xs ago" stays live without waiting on a poll.
  useEffect(() => {
    if ((state.uiState !== 'live' && state.uiState !== 'reconnecting') || lastLiveLoadedAt === undefined) return
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.uiState, lastLiveLoadedAt])

  return <LiveViewPresentation state={state} />
}

function secondsAgo(ms: number): number {
  return Math.max(0, Math.round((Date.now() - ms) / 1000))
}

// `loader` gates the telescope "getting ready" orbit — true only in the states
// where a session is actually coming/imminent (checking, before start, waiting
// for the feed), never once it's ended/cancelled/nothing.
function offlineCopy(state: LiveStatusState): { heading: string; sub?: string; loader: boolean } {
  const payload = state.lastOfflinePayload
  if (!payload) return { heading: 'Checking tonight’s schedule…', loader: true }

  const { tonight, next } = payload

  // /api/status returns tonight's own event as `next` whenever its end-time
  // hasn't passed yet (see app/api/status/route.ts step "c"), so a `next`
  // dated today is the SAME event as `tonight`, not a distinct upcoming one —
  // suppress it as a sub-line to avoid showing the same session twice.
  const today = athensTodayDate()
  const distinctNext = next && next.date !== today ? next : null
  const distinctNextLine = distinctNext ? `Next session: ${distinctNext.date}, ${distinctNext.start}` : null

  if (tonight?.cancelled) {
    return {
      heading: 'Tonight’s session is cancelled',
      sub: tonight.cancellationReason ?? distinctNextLine ?? undefined,
      loader: false,
    }
  }

  if (tonight) {
    // Hotel name leads (heading) — content order requested: hotel -> time ->
    // pun. The time-based line (start time / waiting-for-feed / ended) is the
    // sub; a genuinely distinct upcoming session, when present, stacks below
    // that same sub line rather than replacing the hotel name, so the hotel
    // is never dropped from the screen the way it was before this reorder.
    const now = athensNowHHMM()
    const heading = hotelDisplayName(tonight.hotelId)
    let timeLine: string
    let loader: boolean
    if (now < tonight.start) {
      timeLine = `Tonight at ${tonight.start}`
      loader = true
    } else if (now < tonight.end) {
      timeLine = 'Waiting for the telescope feed'
      loader = true
    } else {
      timeLine = 'Tonight’s session has ended'
      loader = false
    }
    const sub = distinctNextLine ? `${timeLine} · ${distinctNextLine}` : timeLine
    return { heading, sub, loader }
  }

  if (next) return { heading: `Next session: ${next.date}, ${next.start}`, loader: false }
  return { heading: 'No upcoming sessions scheduled', loader: false }
}

function LiveViewPresentation({ state }: { state: LiveStatusState }) {
  const { uiState, lastLiveFrame } = state

  if (uiState === 'checking') {
    return <StatusScreen heading="Checking…" loader />
  }

  if (uiState === 'degraded') {
    return <StatusScreen heading="Temporarily unavailable" sub="Retrying…" />
  }

  if (uiState === 'offline-cancelled') {
    // Cancellation must dominate: the heading + reason are the unmissable
    // message; the flavor line rotates small and secondary beneath, never
    // able to obscure that the session is off. No loader — nothing is coming.
    const { heading, sub } = offlineCopy(state)
    const logoSrc = tonightLogoSrc(state)
    const hotelId = state.lastOfflinePayload?.tonight?.hotelId
    return (
      <StatusScreen
        heading={heading}
        sub={sub}
        tone="cancelled"
        logoSrc={logoSrc}
        logoAlt={hotelId ? hotelDisplayName(hotelId) : undefined}
        flavorContext={buildFlavorContext(state)}
      />
    )
  }

  if (uiState === 'offline-event-tonight' || uiState === 'offline-nothing') {
    const { heading, sub, loader } = offlineCopy(state)
    // offline-nothing has no specific hotel for tonight, so tonightLogoSrc
    // (which reads state.lastOfflinePayload.tonight) naturally returns null
    // there — no separate branch needed.
    const logoSrc = tonightLogoSrc(state)
    return (
      <StatusScreen
        heading={heading}
        sub={sub}
        loader={loader}
        logoSrc={logoSrc}
        flavorContext={buildFlavorContext(state)}
      />
    )
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

// Build the flavor-text context from the current (offline) state. Purely
// derived — reads the same lastOfflinePayload the factual copy uses, adds
// nothing to the state machine.
function buildFlavorContext(state: LiveStatusState): FlavorContext {
  const tonight = state.lastOfflinePayload?.tonight ?? null
  let subState: OfflineSubState | null = null
  if (state.uiState === 'offline-cancelled') subState = 'cancelled'
  else if (state.uiState === 'offline-event-tonight') subState = 'event-tonight'
  else if (state.uiState === 'offline-nothing') subState = 'nothing'
  return {
    subState,
    tonight: tonight ? { hotelId: tonight.hotelId, start: tonight.start, end: tonight.end } : null,
  }
}

// Logo for tonight's hotel, or null when there's no specific hotel (e.g.
// offline-nothing) or no logo asset mapped for that hotelId.
function tonightLogoSrc(state: LiveStatusState): string | null {
  const hotelId = state.lastOfflinePayload?.tonight?.hotelId
  return hotelId ? hotelLogoSrc(hotelId) : null
}

// Rotating flavor line — purely additive, sits under the factual heading and
// never replaces it. Re-picks a random line every FLAVOR_ROTATE_MS. When
// `secondary` is set (cancelled state) it renders smaller and dimmer so it can
// never compete with the cancellation notice above it.
function FlavorLine({ context, secondary }: { context: FlavorContext; secondary?: boolean }) {
  const [line, setLine] = useState('')
  const [visible, setVisible] = useState(false) // drives the opacity crossfade
  // Recently-shown lines, so a pick never repeats one still inside the
  // no-repeat window. Kept in a ref (not state) so updating it never triggers a
  // render, and it survives the 1s "updated Xs ago" re-renders untouched.
  const recentRef = useRef<string[]>([])
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function nextLine() {
      const next = pickFlavor(context, recentRef.current)
      if (next) recentRef.current = [...recentRef.current, next].slice(-FLAVOR_NO_REPEAT_WINDOW)
      return next
    }

    // Show the first line immediately.
    setLine(nextLine())
    setVisible(true)

    const id = setInterval(() => {
      // Crossfade: fade the current line out, then swap the text and fade in.
      setVisible(false)
      fadeRef.current = setTimeout(() => {
        setLine(nextLine())
        setVisible(true)
      }, FLAVOR_FADE_MS)
    }, FLAVOR_ROTATE_MS)

    return () => {
      clearInterval(id)
      if (fadeRef.current) clearTimeout(fadeRef.current)
    }
    // Depend on the primitive situation inputs, NOT the context object: the
    // object is rebuilt every render (including the 1s "updated Xs ago" tick),
    // so depending on it would reset the 8s timer every second and the line
    // would never actually rotate. pickFlavor reads the live clock internally,
    // so a captured context still crosses time tiers correctly between changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.subState, context.tonight?.hotelId, context.tonight?.start, context.tonight?.end])

  if (!line) return null
  const sentences = splitIntoSentences(line)
  return (
    <div className={`status-flavor-slot${secondary ? ' status-flavor-slot--secondary' : ''}`}>
      <p
        className={`status-flavor${secondary ? ' status-flavor--secondary' : ''}${visible ? ' is-visible' : ''}`}
      >
        {sentences.map((sentence, i) => (
          <span key={i} className="status-flavor-sentence">
            {sentence}
          </span>
        ))}
      </p>
    </div>
  )
}

// Split a flavor line into one span per sentence, each rendered on its own
// line via display:block in CSS (see .status-flavor-sentence). Splits on ". "
// (period + space) or a trailing "." at the very end — NOT on every "." —
// so a decimal like "13.8 billion years" is never mistaken for a sentence
// break (no space follows that period). Single-sentence lines (the vast
// majority of the pool) produce exactly one span, unchanged from before.
function splitIntoSentences(line: string): string[] {
  return line
    .split(/(?<=\.)(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Bodies that can orbit the telescope. One is picked at random each time the
// loader mounts. `modifier` tweaks per-body styling: the '✦' is a CSS-tinted
// Newtonian 4-point star, the UFO spins on itself (no counter-rotation), the
// moon is drawn smaller. To add more, just extend this list.
const ORBIT_BODIES = [
  { glyph: '🌙', modifier: 'scope-loader__body--moon' },
  { glyph: '🛰️', modifier: '' },
  { glyph: '🪐', modifier: '' },
  { glyph: '✦', modifier: 'scope-loader__body--star' },
  { glyph: '🛸', modifier: 'scope-loader__body--spin' },
] as const

// Slow calm orbit around a telescope — a "getting ready" cue, deliberately not
// a fast spinner. Bodies travel the ring without spinning on themselves (see
// the counter-rotation in styles.css); the UFO is the exception. Decorative
// only, so hidden from assistive tech.
function TelescopeLoader() {
  // Start deterministic (index 0) so the server-rendered and first client
  // render match — then pick a random body after mount. Randomizing during
  // render would desync SSR vs client and trip a hydration error.
  const [index, setIndex] = useState(0)
  useEffect(() => {
    setIndex(Math.floor(Math.random() * ORBIT_BODIES.length))
  }, [])

  const chosen = ORBIT_BODIES[index]
  return (
    <span className="scope-loader" aria-hidden="true">
      <span className="scope-loader__ring" />
      <span className="scope-loader__orbit">
        <span className={`scope-loader__body${chosen.modifier ? ` ${chosen.modifier}` : ''}`}>{chosen.glyph}</span>
      </span>
      <span className="scope-loader__icon">🔭</span>
    </span>
  )
}

function StatusScreen({
  heading,
  sub,
  tone,
  loader,
  logoSrc,
  logoAlt,
  flavorContext,
}: {
  heading: string
  sub?: string
  tone?: 'cancelled'
  loader?: boolean
  logoSrc?: string | null
  logoAlt?: string
  flavorContext?: FlavorContext
}) {
  const cancelled = tone === 'cancelled'
  return (
    <div className={`status-root${cancelled ? ' status-root--cancelled' : ''}`}>
      {/* Steady facts: logo/heading/sub. The flavor line below reserves its
          own min-height (see .status-flavor-slot in styles.css) so its
          length/sentence-count changing never shifts this block — that's
          what keeps this safe to render in the same centered flex column
          rather than needing a separate layout region. */}
      <div className="status-steady">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- local /public asset, fixed-height badge, no next/image sizing needed for v1
          <img src={logoSrc} alt={logoAlt ?? ''} className="status-hotel-logo" />
        ) : null}
        <div className="status-heading-row">
          <p className={`status-heading${cancelled ? ' status-heading--cancelled' : ''}`}>{heading}</p>
          {loader ? <TelescopeLoader /> : null}
        </div>
        {sub ? <p className={`status-sub${cancelled ? ' status-sub--cancelled' : ''}`}>{sub}</p> : null}
      </div>
      {flavorContext ? <FlavorLine context={flavorContext} secondary={cancelled} /> : null}
    </div>
  )
}
