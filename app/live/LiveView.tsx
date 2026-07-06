'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import {
  liveStatusReducer,
  initialLiveStatusState,
  type LiveStatusState,
  type OfflinePayload,
  type DisplayObject,
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
import {
  KNOWN_OBJECT_LINES,
  NO_CONFIDENT_NAME_LINES,
  pickRandomLine,
  fillName,
  composeShareText,
} from '@/lib/live-share'
import { typeDefinition } from '@/lib/object-types'
import { typeColor } from '@/lib/type-colors'
import catalogData from '@/config/catalog.json'
import type { CatalogObject } from '@/lib/catalog'

// Crossfade duration for a flavor-line swap; must match the opacity transition
// in styles.css (.status-flavor).
const FLAVOR_FADE_MS = 300

const POLL_INTERVAL_MS = 10 * 1000
const FETCH_TIMEOUT_MS = 8 * 1000
const IMAGE_PRELOAD_TIMEOUT_MS = 10 * 1000
const RECONNECT_CHECK_MS = 1000 // how often we check the 45s give-up clause while reconnecting

// Object-match confidence tiers as reported by lib/catalog.ts via /api/status.
type ObjectMatchConfidence = 'high' | 'medium' | 'low' | 'none'

// Raw /api/status response shapes we care about. Anything not matching one of
// these (network error, timeout, non-2xx, bad JSON) is POLL_FAILED — never
// treated as offline. See lib/live-status.ts for the full contract notes.
type StatusLive = {
  live: true
  source: 'pegasus' | 'seestar'
  frame: { frameId: string; blobUrl: string; capturedAt: string; ingestedAt: string }
  observation: { observationId: string; objectName: string }
  sessionId: string
  telemetry?: { state?: string; totalAccumulatedTime?: number; astrometryState?: string }
  objectMatch?: {
    name: string
    confidence: ObjectMatchConfidence
    description: string
    type: string
    constellation?: string
    distanceLy?: number
    sizeDescription?: string
  }
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

// telemetry/objectMatch are best-effort additions to the live payload — a
// malformed or absent one must never fail the whole live-status validation
// (the image/objectName the page actually needs are unaffected either way).
function isValidTelemetry(v: unknown): v is StatusLive['telemetry'] {
  if (v === undefined) return true
  if (!isObject(v)) return false
  return (
    (v.state === undefined || isString(v.state)) &&
    (v.totalAccumulatedTime === undefined || typeof v.totalAccumulatedTime === 'number') &&
    (v.astrometryState === undefined || isString(v.astrometryState))
  )
}

function isValidObjectMatch(v: unknown): v is StatusLive['objectMatch'] {
  if (v === undefined) return true
  if (!isObject(v)) return false
  const validConfidence = ['high', 'medium', 'low', 'none']
  return (
    isString(v.name) &&
    isString(v.confidence) &&
    validConfidence.includes(v.confidence) &&
    isString(v.description) &&
    isString(v.type) &&
    (v.constellation === undefined || isString(v.constellation)) &&
    (v.distanceLy === undefined || typeof v.distanceLy === 'number') &&
    (v.sizeDescription === undefined || isString(v.sizeDescription))
  )
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
    isString(v.sessionId) &&
    isValidTelemetry(v.telemetry) &&
    isValidObjectMatch(v.objectMatch)
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

// Astrometry states that mean "actively slewing/searching, not yet solved" —
// shown to guests as "moving to the next target" rather than a generic
// fallback label, since it's a transitional state, not a genuine no-match.
const MOVING_ASTROMETRY_STATES = new Set(['unavailable', 'failed'])

// Settle the guest-facing object label ONCE per frame, from the raw
// telemetry/objectMatch the server sent — see DisplayObject's doc comment in
// lib/live-status.ts for why this is a resolved decision, not raw passthrough.
function resolveDisplayObject(body: StatusLive): DisplayObject {
  const astrometryState = body.telemetry?.astrometryState
  if (astrometryState === 'solved' && body.objectMatch?.confidence === 'high') {
    return {
      kind: 'known',
      name: body.objectMatch.name,
      description: body.objectMatch.description,
      type: body.objectMatch.type,
      constellation: body.objectMatch.constellation,
      distanceLy: body.objectMatch.distanceLy,
      sizeDescription: body.objectMatch.sizeDescription,
    }
  }
  if (astrometryState !== undefined && MOVING_ASTROMETRY_STATES.has(astrometryState)) {
    return { kind: 'moving' }
  }
  return { kind: 'fallback' }
}

// ---------------------------------------------------------------------------
// Demo modes — local-only visual review of the three display states, never
// touching the network or affecting production behavior when the param is
// absent. See ?demo=known|moving|fallback. Not exposed/linked anywhere; a
// guest would only ever hit this by typing the query param themselves.
// ---------------------------------------------------------------------------
type DemoMode =
  | 'known' // alias for known-nebula, kept for backward compat with earlier review links
  | 'known-nebula'
  | 'known-galaxy'
  | 'known-globular'
  | 'known-open-cluster'
  | 'known-planetary'
  | 'known-supernova-remnant'
  | 'moving'
  | 'fallback'
  | 'new-target'

const DEMO_MODES: DemoMode[] = [
  'known',
  'known-nebula',
  'known-galaxy',
  'known-globular',
  'known-open-cluster',
  'known-planetary',
  'known-supernova-remnant',
  'moving',
  'fallback',
  'new-target',
]

// DEMO-MOCK ONLY (see SnapshotToggle). 'current' always exists; the others
// are only available once the observation has aged enough to have that many
// stacked frames. ?demo=new-target simulates a target that JUST started
// (only 'current' exists yet); every other demo mode simulates an
// established observation with the full history available.
type SnapshotKey = 'current' | 'first' | 'one-min' | 'two-min'

function demoSnapshotsFor(mode: DemoMode | null): SnapshotKey[] {
  if (mode === 'new-target') return ['current']
  return ['current', 'first', 'one-min', 'two-min']
}

function getDemoMode(): DemoMode | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('demo')
  return (DEMO_MODES as string[]).includes(raw ?? '') ? (raw as DemoMode) : null
}

// One representative demo object per catalog type, so item 4's type icons +
// definitions can each be reviewed in context (?demo=known-galaxy, etc.)
// rather than only ever seeing the nebula case. Real image files already
// shipped under /public/images stand in for the live telescope frame.
//
// Fields (type/constellation/distanceLy/description) are pulled from the
// real config/catalog.json by id below, NOT duplicated here — a prior
// version hardcoded these and silently drifted from the catalog (e.g. still
// showing "Galaxy" after the catalog was upgraded to "Spiral Galaxy"), which
// made the demo pages misrepresent what a real match actually looks like.
const KNOWN_DEMO_SOURCE: Record<string, { catalogId: string; blobUrl: string; totalAccumulatedTime: number }> = {
  'known-nebula': { catalogId: 'M42', blobUrl: '/images/nebula-orion-m42.jpg', totalAccumulatedTime: 2580 },
  'known-galaxy': { catalogId: 'M33', blobUrl: '/images/galaxy-triangulum-m33.jpg', totalAccumulatedTime: 3120 },
  'known-globular': { catalogId: 'M13', blobUrl: '/images/astro-01.jpg', totalAccumulatedTime: 1860 },
  'known-open-cluster': { catalogId: 'M45', blobUrl: '/images/astro-02.jpg', totalAccumulatedTime: 1440 },
  'known-planetary': { catalogId: 'M57', blobUrl: '/images/astro-03.jpg', totalAccumulatedTime: 960 },
  'known-supernova-remnant': {
    catalogId: 'NGC6960-6992',
    blobUrl: '/images/astro-04.jpg',
    totalAccumulatedTime: 2100,
  },
  // A target that JUST started — short accumulated time, and (see
  // demoSnapshotsFor) only 'current' exists yet in the progress-toggle mock,
  // since there hasn't been time to accumulate a 1min/2min stack.
  'new-target': { catalogId: 'M20', blobUrl: '/images/nebula-trifid-m20.jpg', totalAccumulatedTime: 22 },
}

const CATALOG_BY_ID = new Map((catalogData as { objects: CatalogObject[] }).objects.map((o) => [o.id, o]))

const KNOWN_DEMOS: Record<
  string,
  {
    blobUrl: string
    name: string
    type: string
    description: string
    totalAccumulatedTime: number
    constellation?: string
    distanceLy?: number
    sizeDescription?: string
  }
> = Object.fromEntries(
  Object.entries(KNOWN_DEMO_SOURCE).flatMap(([demoKey, source]) => {
    const catalogObject = CATALOG_BY_ID.get(source.catalogId)
    if (!catalogObject) return []
    return [
      [
        demoKey,
        {
          blobUrl: source.blobUrl,
          name: catalogObject.primaryName,
          type: catalogObject.type,
          description: catalogObject.description,
          totalAccumulatedTime: source.totalAccumulatedTime,
          constellation: catalogObject.constellation,
          distanceLy: catalogObject.distanceLy,
          sizeDescription: catalogObject.sizeDescription,
        },
      ],
    ]
  }),
)

// A real astro photo (already shipped under /public/images) stands in for the
// live telescope frame in demo mode — cache-busted per call so the "new
// frame" preload path runs identically to production instead of always
// short-circuiting on the same-frameId branch.
function getDemoStatusBody(): StatusLive | null {
  const mode = getDemoMode()
  if (!mode) return null

  const knownKey = mode === 'known' ? 'known-nebula' : mode
  const known = KNOWN_DEMOS[knownKey]

  const now = new Date().toISOString()
  const base = {
    live: true as const,
    source: 'pegasus' as const,
    frame: {
      frameId: `demo-${mode}`,
      blobUrl: known?.blobUrl ?? '/images/nebula-orion-m42.jpg',
      capturedAt: now,
      ingestedAt: now,
    },
    observation: { observationId: 'demo-observation', objectName: known?.name ?? 'Unknown' },
    sessionId: 'demo-session',
  }

  if (known) {
    return {
      ...base,
      telemetry: {
        state: 'IMAGE_STACK_RUNNING',
        totalAccumulatedTime: known.totalAccumulatedTime,
        astrometryState: 'solved',
      },
      objectMatch: {
        name: known.name,
        confidence: 'high',
        description: known.description,
        type: known.type,
        constellation: known.constellation,
        distanceLy: known.distanceLy,
        sizeDescription: known.sizeDescription,
      },
    }
  }
  if (mode === 'moving') {
    return {
      ...base,
      telemetry: { state: 'SLEWING', totalAccumulatedTime: 180, astrometryState: 'unavailable' },
    }
  }
  // fallback: solved but no confident catalog match (e.g. a wide/dark field).
  return {
    ...base,
    telemetry: { state: 'IMAGE_STACK_RUNNING', totalAccumulatedTime: 95, astrometryState: 'solved' },
    objectMatch: undefined,
  }
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
        const demoBody = getDemoStatusBody()
        let body: unknown
        if (demoBody) {
          // Demo modes never touch the network — purely local, synthetic
          // StatusLive bodies for visual review of the three display states.
          body = demoBody
        } else {
          const res = await fetch('/api/status', { signal: controller.signal, cache: 'no-store' })
          if (!res.ok) throw new Error(`status ${res.status}`)
          body = await res.json()
        }
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
                displayObject: resolveDisplayObject(body),
                totalAccumulatedTime: body.telemetry?.totalAccumulatedTime,
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
                  displayObject: resolveDisplayObject(body),
                  totalAccumulatedTime: body.telemetry?.totalAccumulatedTime,
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

// "updated Xs ago" for under a minute, then rolls over to minutes ("2m ago")
// rather than ever showing 3-digit seconds — that's what was overflowing the
// topbar on mobile.
function formatUpdatedAgo(loadedAtMs: number): string {
  const seconds = secondsAgo(loadedAtMs)
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

// Format an accumulated-exposure duration (seconds) as "Xm Ys" / "Ys" /
// "Xh Ym". Guest-friendly and compact for the top cap. Returns null for
// absent/negative/non-finite input so the caller can omit the line entirely
// rather than render "0s" or "NaN".
// "52 min stacked" / "45 sec stacked" / "1h 12m stacked" — seconds are only
// ever shown when the total is under a minute; once minutes are shown, the
// leftover seconds are dropped rather than appended as a clunky "52m 0s".
function formatAccumulated(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m} min`
  return `${s} sec`
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
    <LiveFrameView
      uiState={uiState}
      lastLiveFrame={lastLiveFrame}
      demoSnapshots={demoSnapshotsFor(getDemoMode())}
    />
  )
}

// Split out so it (and its isFullscreen state) only mounts once we actually
// have a frame to show — the circular FOV view is the pretty default view;
// fullscreen swaps to the full square image, maximized, with the circular
// framing dropped entirely (see the Fullscreen API wiring below).
function LiveFrameView({
  uiState,
  lastLiveFrame,
  demoSnapshots,
}: {
  uiState: LiveStatusState['uiState']
  lastLiveFrame: NonNullable<LiveStatusState['lastLiveFrame']>
  demoSnapshots: SnapshotKey[]
}) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  // DEMO-MOCK ONLY — see SnapshotToggle's doc comment. Resets to 'current'
  // whenever the available set changes (e.g. demo mode swapped) so a stale
  // selection can never point at a snapshot that no longer exists.
  const [snapshotSelection, setSnapshotSelection] = useState<SnapshotKey>('current')
  useEffect(() => {
    setSnapshotSelection('current')
  }, [demoSnapshots])

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement != null)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  if (isFullscreen) {
    return (
      <div className="live-root live-root--fullscreen">
        <button
          type="button"
          className="fullscreen-button fullscreen-exit-button"
          onClick={toggleFullscreen}
          aria-label="Exit fullscreen"
        >
          ⤢
        </button>
        {/* object-fit: contain — the WHOLE square frame stays visible,
            maximized within the viewport. No circular mask, no rim text:
            fullscreen is the see-everything-in-detail mode, not the eyepiece
            aesthetic (that's the default circular view). Pinch-to-zoom/pan
            is scoped entirely to this image (see PannableZoomImage) — the
            exit button and page chrome are outside it and never affected. */}
        <PannableZoomImage src={lastLiveFrame.blobUrl} alt={objectLabel(lastLiveFrame.displayObject)} />
      </div>
    )
  }

  return (
    <div className="live-root">
      <div className="page">
        {/* Brand text removed — it already lives on the circular rim (see
            .rim-brand below), repeating it here read redundantly. Just the
            live/updated status remains. */}
        <header className="topbar" aria-label="Live page status">
          <div className="topbar__live">
            {snapshotSelection === 'current' ? (
              <>
                <span className={`red-dot${uiState === 'reconnecting' ? ' reconnecting' : ''}`} aria-hidden="true" />
                {/* Each "· "-joined segment is its own span (not one long
                    string) so topbar__live's flex-wrap can break the row
                    between segments on narrow phones instead of only
                    shrinking via the font-size clamp. */}
                <span>{uiState === 'reconnecting' ? 'RECONNECTING' : 'LIVE'}</span>
                <span>· UPDATED {formatUpdatedAgo(lastLiveFrame.loadedAt)}</span>
                {formatAccumulated(lastLiveFrame.totalAccumulatedTime) ? (
                  <span>· {formatAccumulated(lastLiveFrame.totalAccumulatedTime)} STACKED</span>
                ) : null}
              </>
            ) : (
              // Viewing a historical frame (demo-mock only, see SnapshotToggle):
              // the red pulse turns OFF and this label makes it unmistakable
              // that this is NOT the live view, so a guest never mistakes a
              // frozen old frame for the current feed.
              <span className="viewing-earlier-badge">VIEWING AN EARLIER FRAME · NOT LIVE</span>
            )}
          </div>
        </header>

        <section className="viewer" aria-label="Live telescope image">
          <div className="sky-square">
            {/* eslint-disable-next-line @next/next/no-img-element -- external Vercel Blob URL, no next/image domain config for v1 */}
            <img
              src={lastLiveFrame.blobUrl}
              alt={objectLabel(lastLiveFrame.displayObject)}
              className="fov-image"
            />
            <div className="fov-vignette" aria-hidden="true" />
          </div>

          <svg className="rim" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <path id="rimBrandArc" d="M 12.8 28.5 A 43 43 0 0 1 87.2 28.5" />
            </defs>
            <circle className="rim-ring outer" cx="50" cy="50" r="48" />
            <circle className="rim-ring" cx="50" cy="50" r="45.9" />
            <line className="rim-tick" x1="50" y1="2.2" x2="50" y2="4.2" />
            <line className="rim-tick" x1="50" y1="95.8" x2="50" y2="97.8" />
            <line className="rim-tick" x1="2.2" y1="50" x2="4.2" y2="50" />
            <line className="rim-tick" x1="95.8" y1="50" x2="97.8" y2="50" />
            <line className="rim-tick" x1="15.8" y1="15.8" x2="17.2" y2="17.2" />
            <line className="rim-tick" x1="84.2" y1="15.8" x2="82.8" y2="17.2" />
            <line className="rim-tick" x1="15.8" y1="84.2" x2="17.2" y2="82.8" />
            <line className="rim-tick" x1="84.2" y1="84.2" x2="82.8" y2="82.8" />
            <text className="rim-brand">
              <textPath href="#rimBrandArc" startOffset="50%" textAnchor="middle" textLength={52} lengthAdjust="spacing">
                STARGAZING.EVENTS
              </textPath>
            </text>
          </svg>

          <button
            type="button"
            className="fullscreen-button viewer-fullscreen-button"
            onClick={toggleFullscreen}
            aria-label="Toggle fullscreen"
          >
            ⛶
          </button>
        </section>

        <SnapshotToggle
          demoSnapshots={demoSnapshots}
          selection={snapshotSelection}
          onSelect={setSnapshotSelection}
        />

        <section className="content" aria-live="polite">
          {/* Object name is the topmost element in the content block.
              "Gathered light" now lives only in the topbar (next to
              LIVE/updated) — showing it twice on one screen was redundant,
              see git history for the removed .integration line. */}
          <h1 className="title">{objectLabel(lastLiveFrame.displayObject)}</h1>

          <ObjectTypeLine displayObject={lastLiveFrame.displayObject} />

          <Facts displayObject={lastLiveFrame.displayObject} />

          <div className="description">
            <ObjectDescription displayObject={lastLiveFrame.displayObject} />
          </div>
        </section>

        <SharePanel displayObject={lastLiveFrame.displayObject} />
      </div>
    </div>
  )
}

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const DOUBLE_TAP_ZOOM = 2.5
const DOUBLE_TAP_MAX_INTERVAL_MS = 300
const DOUBLE_TAP_MAX_DISTANCE_PX = 40 // two taps further apart than this are two separate taps, not a double-tap

function distanceBetween(a: React.PointerEvent, b: React.PointerEvent): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

// How far the image content (post object-fit:contain, pre zoom-scale) can be
// panned before its own edge would cross the wrapper's edge, in each axis.
// Computed from the image's natural size, not assumed square — a wide/tall
// camera frame is fit-scaled differently than a square one, and clamping
// against the wrong box would let a black gap open on one axis but not
// the other.
function maxPanOffset(
  wrapperSize: { width: number; height: number },
  naturalSize: { width: number; height: number },
  scale: number,
): { x: number; y: number } {
  if (naturalSize.width <= 0 || naturalSize.height <= 0) return { x: 0, y: 0 }
  const fitScale = Math.min(wrapperSize.width / naturalSize.width, wrapperSize.height / naturalSize.height)
  const renderedWidth = naturalSize.width * fitScale * scale
  const renderedHeight = naturalSize.height * fitScale * scale
  return {
    x: Math.max(0, (renderedWidth - wrapperSize.width) / 2),
    y: Math.max(0, (renderedHeight - wrapperSize.height) / 2),
  }
}

function clampPan(
  x: number,
  y: number,
  wrapperSize: { width: number; height: number },
  naturalSize: { width: number; height: number },
  scale: number,
): { x: number; y: number } {
  const max = maxPanOffset(wrapperSize, naturalSize, scale)
  return {
    x: Math.min(max.x, Math.max(-max.x, x)),
    y: Math.min(max.y, Math.max(-max.y, y)),
  }
}

// Pinch-to-zoom + pan + double-tap-to-zoom, scoped to exactly this image —
// used only in fullscreen, where there's no other UI to fight with.
// Deliberately hand-rolled (pointer events, no gesture library): the
// interaction is small and self-contained enough that a dependency would
// cost more than it saves, and pointer events already unify touch/mouse
// across mobile Safari and Chrome.
//
// touch-action: none on the wrapper (see .pannable-zoom-wrapper in styles.css)
// is what actually stops the browser's own page-zoom/scroll from intercepting
// the gesture — without it, iOS Safari in particular will hijack a two-finger
// pinch for its native viewport zoom instead of delivering pointer events here.
function PannableZoomImage({ src, alt }: { src: string; alt: string }) {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  // Only true for the brief animated snap-to on double-tap — pinch/pan get no
  // transition so they track fingers with zero lag; double-tap is a discrete
  // jump that needs to visibly ease rather than pop.
  const [animating, setAnimating] = useState(false)
  const pointers = useRef(new Map<number, React.PointerEvent>())
  const wrapperRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // Natural (unscaled) image dimensions, captured once the image loads —
  // required to clamp panning against the real object-fit:contain content
  // box (see maxPanOffset), which depends on the image's own aspect ratio.
  const naturalSize = useRef({ width: 0, height: 0 })
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  // Gesture-start snapshot: the scale/pan/pointer-position(s) at the moment a
  // pinch or pan begins, so every subsequent move computes its delta from a
  // fixed baseline rather than accumulating rounding error frame-to-frame.
  const gestureStart = useRef<{
    scale: number
    x: number
    y: number
    distance: number | null
    midX: number
    midY: number
  } | null>(null)

  // No reset effect needed: LiveFrameView only renders PannableZoomImage
  // while isFullscreen is true, so exiting fullscreen unmounts this
  // component entirely and its state (including transform) is discarded —
  // re-entering fullscreen always starts a fresh, unzoomed component.

  function wrapperSize(): { width: number; height: number } {
    const el = wrapperRef.current
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: 0, height: 0 }
  }

  function clamp(x: number, y: number, scale: number): { x: number; y: number } {
    return clampPan(x, y, wrapperSize(), naturalSize.current, scale)
  }

  function captureNaturalSize() {
    const el = imgRef.current
    if (el && el.naturalWidth > 0) naturalSize.current = { width: el.naturalWidth, height: el.naturalHeight }
  }

  // Belt-and-suspenders alongside onLoad below: a cache-hit image can finish
  // loading synchronously before React attaches the onLoad listener, in
  // which case onLoad never fires at all — checking `complete` on mount
  // catches that case too.
  useEffect(() => {
    captureNaturalSize()
  }, [])

  function snapshotGestureStart(pts: React.PointerEvent[]) {
    gestureStart.current = {
      scale: transform.scale,
      x: transform.x,
      y: transform.y,
      distance: pts.length === 2 ? distanceBetween(pts[0], pts[1]) : null,
      midX: pts.length === 2 ? (pts[0].clientX + pts[1].clientX) / 2 : (pts[0]?.clientX ?? 0),
      midY: pts.length === 2 ? (pts[0].clientY + pts[1].clientY) / 2 : (pts[0]?.clientY ?? 0),
    }
  }

  // Zoom toward a specific viewport point (tapX/tapY) rather than the
  // wrapper's center — so double-tapping near an edge feels anchored to
  // where the guest actually tapped, not just a center-zoom.
  function zoomToward(tapX: number, tapY: number, nextScale: number) {
    const wrapper = wrapperSize()
    const centerX = wrapper.width / 2
    const centerY = wrapper.height / 2
    // Keep the point under the finger fixed: solve for the new pan offset
    // that maps (tapX, tapY) to the same screen position after rescaling.
    const scaleRatio = nextScale / transform.scale
    const nextX = tapX - centerX - (tapX - centerX - transform.x) * scaleRatio
    const nextY = tapY - centerY - (tapY - centerY - transform.y) * scaleRatio
    const clamped = clamp(nextX, nextY, nextScale)
    setAnimating(true)
    setTransform({ scale: nextScale, x: clamped.x, y: clamped.y })
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, e)
    setAnimating(false)
    snapshotGestureStart(Array.from(pointers.current.values()))

    // Double-tap detection: only meaningful for a single-finger tap (a second
    // finger already joining is a pinch start, not a tap), matched against
    // the previous tap's time and position.
    if (pointers.current.size === 1) {
      const now = Date.now()
      const prev = lastTap.current
      if (
        prev &&
        now - prev.time <= DOUBLE_TAP_MAX_INTERVAL_MS &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_TAP_MAX_DISTANCE_PX
      ) {
        lastTap.current = null
        const nextScale = transform.scale > ZOOM_MIN ? ZOOM_MIN : DOUBLE_TAP_ZOOM
        zoomToward(e.clientX, e.clientY, nextScale)
        return
      }
      lastTap.current = { time: now, x: e.clientX, y: e.clientY }
    } else {
      // A pinch is starting — this is not a tap sequence.
      lastTap.current = null
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, e)
    const start = gestureStart.current
    if (!start) return
    const pts = Array.from(pointers.current.values())

    if (pts.length === 2 && start.distance) {
      // Pinch: scale from the ratio of current to gesture-start finger
      // distance, clamped to a sane range so the image can't vanish or
      // balloon past usefulness. Pan follows the pinch midpoint too, so
      // zooming feels anchored to where the fingers are, not just the center.
      const newDistance = distanceBetween(pts[0], pts[1])
      const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, start.scale * (newDistance / start.distance)))
      const midX = (pts[0].clientX + pts[1].clientX) / 2
      const midY = (pts[0].clientY + pts[1].clientY) / 2
      const clamped = clamp(start.x + (midX - start.midX), start.y + (midY - start.midY), nextScale)
      setTransform({ scale: nextScale, x: clamped.x, y: clamped.y })
      return
    }

    if (pts.length === 1) {
      // Pan: only meaningful once zoomed in — at scale 1 the whole image
      // already fits the viewport, so dragging at rest is a no-op rather
      // than an unexpected shift.
      if (start.scale <= ZOOM_MIN) return
      const clamped = clamp(start.x + (pts[0].clientX - start.midX), start.y + (pts[0].clientY - start.midY), start.scale)
      setTransform({ scale: start.scale, x: clamped.x, y: clamped.y })
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    const remaining = Array.from(pointers.current.values())
    if (remaining.length > 0) {
      // A finger lifted mid-gesture (e.g. pinch -> single-finger pan): snapshot
      // fresh from here so the next move computes deltas against the new,
      // now-one-fewer-pointer baseline instead of the stale two-finger one.
      snapshotGestureStart(remaining)
    } else {
      gestureStart.current = null
      // Pinch-out can end with the image no longer fully filling the view on
      // one axis (e.g. released mid-gesture at a transient scale); re-clamp
      // against the final scale so it can't rest in an off-position.
      setTransform((t) => {
        const clamped = clamp(t.x, t.y, t.scale)
        return { scale: t.scale, x: clamped.x, y: clamped.y }
      })
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="pannable-zoom-wrapper"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external Vercel Blob URL, no next/image domain config for v1 */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`fullscreen-image${animating ? ' fullscreen-image--animating' : ''}`}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
        draggable={false}
        onLoad={captureNaturalSize}
        onTransitionEnd={() => setAnimating(false)}
      />
    </div>
  )
}

// Neutral grey used for the fallback "Deep-sky field" pill — deliberately not
// one of TYPE_COLORS' per-catalog-type accents, since this isn't a matched
// catalog type at all, just an honest "we don't have a confident name yet."
const FALLBACK_PILL_COLOR = '#A8A6A0'

// Colored type pill (icon + label on a tinted rounded background, color-coded
// per catalog type) plus its one-line definition underneath. Shown for a
// confirmed catalog match (kind: 'known') AND for the no-confident-match
// fallback (kind: 'fallback', a neutral "Deep-sky field" pill) so that state
// looks like a deliberate design choice rather than an empty gap. Renders
// nothing for 'moving' — that state already has its own "next object
// incoming" copy and doesn't need a type pill.
function ObjectTypeLine({ displayObject }: { displayObject: DisplayObject }) {
  if (displayObject.kind === 'fallback') {
    return (
      <div className="type-line">
        <div className="type-pill" style={{ '--type-color': FALLBACK_PILL_COLOR } as React.CSSProperties}>
          <span className="type-icon" aria-hidden="true">
            <FallbackFieldIcon />
          </span>
          <span className="type-pill-label">Deep-sky field</span>
        </div>
      </div>
    )
  }
  if (displayObject.kind !== 'known') return null
  const definition = typeDefinition(displayObject.type)
  const color = typeColor(displayObject.type)
  // Redundancy guard: if the object's own name already contains the type
  // string (e.g. "Andromeda Galaxy" + type "Galaxy"), the text label repeats
  // what the name just said — show the icon alone instead of icon+label.
  const isRedundant = displayObject.name.toLowerCase().includes(displayObject.type.toLowerCase())
  return (
    <div className="type-line">
      <div
        className={`type-pill${isRedundant ? ' type-pill--icon-only' : ''}`}
        style={{ '--type-color': color } as React.CSSProperties}
      >
        <span className="type-icon" aria-hidden="true">
          <TypeIcon type={displayObject.type} />
        </span>
        {isRedundant ? null : <span className="type-pill-label">{displayObject.type}</span>}
      </div>
      {definition ? <p className="type-pill-definition">{definition}</p> : null}
    </div>
  )
}

// Small scattered-stars glyph for the fallback pill — visually distinct from
// TypeIcon's per-type illustrations (this isn't a catalog type), but in the
// same restrained style: a few soft points of light on a dark circle.
function FallbackFieldIcon() {
  return (
    <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill="#111318" />
      <circle cx="24" cy="22" r="1.8" fill="#dcdad4" opacity=".85" />
      <circle cx="40" cy="18" r="1.2" fill="#dcdad4" opacity=".6" />
      <circle cx="44" cy="34" r="1.6" fill="#dcdad4" opacity=".75" />
      <circle cx="22" cy="40" r="1.3" fill="#dcdad4" opacity=".65" />
      <circle cx="34" cy="44" r="1.8" fill="#dcdad4" opacity=".85" />
      <circle cx="18" cy="30" r="1" fill="#dcdad4" opacity=".5" />
    </svg>
  )
}

// Constellation / distance / size fact chips — each ONLY rendered once the
// catalog actually carries that field. No placeholder/fake values: a chip is
// simply absent rather than showing an invented fact, and the whole grid is
// absent if none of the three are present.
function Facts({ displayObject }: { displayObject: DisplayObject }) {
  if (displayObject.kind !== 'known') return null
  if (!displayObject.constellation && !displayObject.distanceLy && !displayObject.sizeDescription) return null
  // Same --type-color the type pill uses (see ObjectTypeLine) — set once here
  // and inherited by every .fact child, so the whole card reads as one
  // coordinated color family rather than each chip needing its own lookup.
  const color = typeColor(displayObject.type)
  return (
    <div className="facts" aria-label="Object information" style={{ '--type-color': color } as React.CSSProperties}>
      {displayObject.constellation ? (
        <div className="fact">
          <span>Constellation</span>
          <strong>{displayObject.constellation}</strong>
        </div>
      ) : null}
      {displayObject.distanceLy ? (
        <div className="fact">
          <span>Distance</span>
          <strong>≈ {displayObject.distanceLy.toLocaleString()} ly</strong>
        </div>
      ) : null}
      {displayObject.sizeDescription ? (
        <div className="fact">
          <span>Size</span>
          <strong>{displayObject.sizeDescription}</strong>
        </div>
      ) : null}
    </div>
  )
}

// Progress toggle — DEMO-MOCK ONLY. There is no real backend support for
// this yet: /api/status only ever exposes the LATEST frame, so "First / 1
// min / 2 min" have no real data behind them. This component exists purely
// to demonstrate the CORRECT interaction/visual states ahead of that backend
// work, per explicit instruction — it must never be mistaken for a working
// feature.
//
// TODO(future branch): a real implementation needs (1) a backend endpoint
// exposing frame history for the CURRENT observation (frames already exist
// in Postgres — see Frame/Observation — just not exposed via any route), and
// (2) Tier-2 target-change detection so the client knows which frames belong
// to the observation currently being viewed and resets the toggle when the
// target changes. Neither exists yet.
function SnapshotToggle({
  demoSnapshots,
  selection,
  onSelect,
}: {
  demoSnapshots: SnapshotKey[]
  selection: SnapshotKey
  onSelect: (key: SnapshotKey) => void
}) {
  const options: { key: SnapshotKey; label: string }[] = [
    { key: 'first', label: 'First' },
    { key: 'one-min', label: '1 min' },
    { key: 'two-min', label: '2 min' },
    { key: 'current', label: 'Current View' },
  ]
  return (
    <div className="snapshot-toggle" role="group" aria-label="Compare stack age (demo only — not real frame history)">
      {options.map((opt) => {
        const available = demoSnapshots.includes(opt.key)
        return (
          <button
            key={opt.key}
            type="button"
            className="snap"
            aria-pressed={selection === opt.key}
            disabled={!available}
            onClick={() => available && onSelect(opt.key)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// One colored, jewel-like icon per catalog type — final curated set (own
// baked-in gradients/fills, astronomically-true colors; NOT currentColor
// monochrome, so .object-type-icon must not force a color on these). All
// gradient/filter ids are unique across the set so multiple can render on
// one page without collisions. Double Star / Comet / Reflection Nebula are
// included ahead of any catalog entry using them.
function TypeIcon({ type }: { type: string }) {
  switch (type) {
    // Specific morphologies + groups reuse the same galaxy glyph — only the
    // pill color/label differentiate "Spiral"/"Irregular"/"Group" for now.
    case 'Galaxy':
    case 'Spiral Galaxy':
    case 'Irregular Galaxy':
    case 'Galaxy Group':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <radialGradient id="fga2swirl" cx="50%" cy="50%" r="65%">
              <stop offset="0%" stopColor="#FFE8B8" />
              <stop offset="28%" stopColor="#F0A85E" />
              <stop offset="55%" stopColor="#B784C9" />
              <stop offset="100%" stopColor="#5A6FC0" stopOpacity=".55" />
            </radialGradient>
            <radialGradient id="fga2core" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#FFFCF0" />
              <stop offset="45%" stopColor="#FFDFA0" stopOpacity=".9" />
              <stop offset="100%" stopColor="#FFDFA0" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="26" fill="#0d0d14" />
          <g transform="rotate(90 32 32)">
            <path
              d="M34.3,32.2 L35.5,33.1 L36.2,34.3 L36.5,35.8 L36.3,37.4 L35.6,39.0 L34.4,40.5 L32.7,41.8 L30.6,42.6 L28.3,42.9 L25.7,42.7 L23.2,41.8 L20.8,40.3 L18.7,38.3 L17.1,35.7 L16.0,32.7 L15.6,29.4 L15.9,26.0 L17.0,22.6 L18.8,19.5 L21.2,16.7 L24.3,14.4 L27.9,12.9 L31.8,12.0 L35.8,12.0 L39.8,12.8 L43.7,14.5 L39.6,13.5 L35.5,13.4 L31.8,14.2 L28.5,15.6 L25.7,17.5 L23.5,19.9 L21.9,22.5 L21.0,25.2 L20.7,27.8 L21.0,30.2 L21.7,32.4 L22.7,34.3 L24.1,35.8 L25.5,36.8 L27.1,37.5 L28.6,37.8 L30.0,37.8 L31.3,37.5 L32.4,37.0 L33.2,36.3 L33.8,35.6 L34.2,34.8 L34.4,34.0 L34.5,33.3 L34.4,32.7 Z"
              fill="url(#fga2swirl)"
              opacity="0.9"
            />
            <path
              d="M34.3,32.2 L35.5,33.1 L36.2,34.3 L36.5,35.8 L36.3,37.4 L35.6,39.0 L34.4,40.5 L32.7,41.8 L30.6,42.6 L28.3,42.9 L25.7,42.7 L23.2,41.8 L20.8,40.3 L18.7,38.3 L17.1,35.7 L16.0,32.7 L15.6,29.4 L15.9,26.0 L17.0,22.6 L18.8,19.5 L21.2,16.7 L24.3,14.4 L27.9,12.9 L31.8,12.0 L35.8,12.0 L39.8,12.8 L43.7,14.5 L39.6,13.5 L35.5,13.4 L31.8,14.2 L28.5,15.6 L25.7,17.5 L23.5,19.9 L21.9,22.5 L21.0,25.2 L20.7,27.8 L21.0,30.2 L21.7,32.4 L22.7,34.3 L24.1,35.8 L25.5,36.8 L27.1,37.5 L28.6,37.8 L30.0,37.8 L31.3,37.5 L32.4,37.0 L33.2,36.3 L33.8,35.6 L34.2,34.8 L34.4,34.0 L34.5,33.3 L34.4,32.7 Z"
              fill="url(#fga2swirl)"
              opacity="0.75"
              transform="rotate(180 32 32)"
            />
          </g>
          <circle cx="32" cy="32" r="10" fill="url(#fga2core)" />
          <circle cx="32" cy="32" r="2.6" fill="#FFFDF6" />
          <circle cx="19" cy="20" r=".7" fill="#fff" opacity=".7" />
          <circle cx="46" cy="45" r=".7" fill="#fff" opacity=".6" />
        </svg>
      )
    case 'Diffuse Nebula':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <radialGradient id="fneba2cloud" cx="48%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#fddce8" />
              <stop offset="22%" stopColor="#e8a0c4" />
              <stop offset="50%" stopColor="#c4508f" />
              <stop offset="78%" stopColor="#7a2a52" />
              <stop offset="100%" stopColor="#3d1428" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="fneba2core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff6fa" />
              <stop offset="50%" stopColor="#ffd6ea" stopOpacity=".8" />
              <stop offset="100%" stopColor="#ffd6ea" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="26" fill="#0f0810" />
          <path
            d="M32,10 C42,14 48,24 44,34 C40,44 28,50 20,44 C12,38 12,26 20,18 C24,14 28,12 32,10Z"
            fill="url(#fneba2cloud)"
            opacity=".9"
          />
          <path d="M32,40 C34,44 40,44 42,38 C40,42 35,44 32,40Z" fill="#2a1018" opacity=".4" />
          <circle cx="30" cy="28" r="9" fill="url(#fneba2core)" />
          <circle cx="30" cy="28" r="2.2" fill="#fff" />
          <circle cx="40" cy="38" r="1" fill="#fff" />
          <circle cx="24" cy="20" r="1" fill="#fff" />
          <circle cx="17" cy="33" r="1.2" fill="#fff" opacity=".85" />
        </svg>
      )
    case 'Planetary Nebula':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <radialGradient id="fpa2halo" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#e8a07a" stopOpacity=".4" />
              <stop offset="100%" stopColor="#e8a07a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="26" fill="#0c1614" />
          <circle cx="32" cy="32" r="21" fill="url(#fpa2halo)" />
          <circle cx="32" cy="32" r="15" fill="none" stroke="#2a9d8f" strokeWidth="6" opacity=".85" />
          <circle cx="32" cy="32" r="8" fill="none" stroke="#7fe8d4" strokeWidth="2.5" opacity=".7" />
          <circle cx="32" cy="32" r="3" fill="#fff" />
        </svg>
      )
    case 'Supernova Remnant':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <circle cx="32" cy="32" r="26" fill="#150e0c" />
          <circle cx="32" cy="32" r="17" fill="none" stroke="#ff8f6b" strokeWidth="3" opacity=".7" strokeDasharray="5 3" />
          <circle cx="32" cy="32" r="10" fill="none" stroke="#8fc7e8" strokeWidth="3" opacity=".65" strokeDasharray="4 3" />
        </svg>
      )
    case 'Globular Cluster':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <circle cx="32" cy="32" r="26" fill="#150f08" />
          <circle cx="32" cy="32" r="16" fill="#3a2e18" opacity=".4" />
          <circle cx="32.0" cy="32.0" r="1.6" fill="#f0c869" opacity="0.90" />
          <circle cx="31.7" cy="34.3" r="1.5" fill="#f0c869" opacity="0.83" />
          <circle cx="27.6" cy="30.8" r="1.3" fill="#f0c869" opacity="0.76" />
          <circle cx="34.6" cy="25.6" r="1.2" fill="#f0c869" opacity="0.69" />
          <circle cx="40.0" cy="36.5" r="1.0" fill="#f0c869" opacity="0.62" />
          <circle cx="25.1" cy="41.2" r="0.9" fill="#f0c869" opacity="0.56" />
          <circle cx="22.1" cy="22.3" r="0.8" fill="#f0c869" opacity="0.49" />
          <circle cx="32.9" cy="31.3" r="1.5" fill="#f0c869" opacity="0.87" />
          <circle cx="33.7" cy="34.9" r="1.4" fill="#f0c869" opacity="0.80" />
          <circle cx="26.8" cy="34.3" r="1.3" fill="#f0c869" opacity="0.73" />
          <circle cx="29.8" cy="24.3" r="1.1" fill="#f0c869" opacity="0.66" />
          <circle cx="42.2" cy="30.5" r="1.0" fill="#f0c869" opacity="0.59" />
          <circle cx="32.2" cy="44.6" r="0.8" fill="#f0c869" opacity="0.52" />
          <circle cx="17.2" cy="30.4" r="0.7" fill="#f0c869" opacity="0.45" />
          <circle cx="32.5" cy="29.9" r="1.5" fill="#f0c869" opacity="0.83" />
          <circle cx="36.2" cy="33.6" r="1.3" fill="#f0c869" opacity="0.77" />
          <circle cx="28.8" cy="38.0" r="1.2" fill="#f0c869" opacity="0.70" />
          <circle cx="24.6" cy="26.7" r="1.1" fill="#f0c869" opacity="0.63" />
          <circle cx="39.8" cy="23.7" r="0.9" fill="#f0c869" opacity="0.56" />
          <circle cx="40.7" cy="42.6" r="0.8" fill="#f0c869" opacity="0.49" />
          <circle cx="31.2" cy="32.5" r="1.5" fill="#f0c869" opacity="0.87" />
          <circle cx="30.6" cy="29.0" r="1.4" fill="#f0c869" opacity="0.80" />
          <circle cx="37.4" cy="30.4" r="1.3" fill="#f0c869" opacity="0.73" />
          <circle cx="33.3" cy="39.8" r="1.1" fill="#f0c869" opacity="0.66" />
          <circle cx="21.8" cy="32.4" r="1.0" fill="#f0c869" opacity="0.59" />
          <circle cx="33.1" cy="19.6" r="0.9" fill="#f0c869" opacity="0.53" />
        </svg>
      )
    case 'Open Cluster':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <circle cx="32" cy="32" r="26" fill="#0c0f16" />
          <circle cx="24" cy="24" r="2" fill="#eaf3ff" />
          <circle cx="40" cy="20" r="1.6" fill="#bcd9f5" />
          <circle cx="44" cy="36" r="2.2" fill="#eaf3ff" />
          <circle cx="30" cy="42" r="1.6" fill="#bcd9f5" />
          <circle cx="20" cy="38" r="1.4" fill="#bcd9f5" />
          <circle cx="36" cy="30" r="1.8" fill="#eaf3ff" />
        </svg>
      )
    case 'Planet':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <radialGradient id="fplb2plb2" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#fff0cf" />
              <stop offset="100%" stopColor="#d9ad6e" />
            </radialGradient>
          </defs>
          <ellipse cx="32" cy="32" rx="22" ry="7.5" fill="none" stroke="#f0cf95" strokeWidth="2.4" opacity=".75" />
          <ellipse cx="32" cy="32" rx="18" ry="6" fill="none" stroke="#c9975a" strokeWidth="1.6" opacity=".55" />
          <circle cx="32" cy="32" r="9.5" fill="url(#fplb2plb2)" />
        </svg>
      )
    case 'Moon':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <radialGradient id="fmb2mb2" cx="35%" cy="32%" r="70%">
              <stop offset="0%" stopColor="#f5f4ef" />
              <stop offset="100%" stopColor="#a8a6a0" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="15" fill="url(#fmb2mb2)" />
          <circle cx="27" cy="26" r="2.4" fill="#8f8d89" opacity=".45" />
          <circle cx="37" cy="36" r="1.8" fill="#8f8d89" opacity=".4" />
          <circle cx="30" cy="40" r="1.3" fill="#8f8d89" opacity=".4" />
        </svg>
      )
    case 'Double Star':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <filter id="fdsb2dsb2" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="1.1" />
            </filter>
          </defs>
          <g filter="url(#fdsb2dsb2)">
            <circle cx="26" cy="26" r="4.6" fill="#eaf3ff" />
            <circle cx="38" cy="38" r="4.6" fill="#f0cf95" />
          </g>
          <circle cx="26" cy="26" r="1.4" fill="#fff" />
          <circle cx="38" cy="38" r="1.4" fill="#fffbe8" />
        </svg>
      )
    case 'Comet':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <linearGradient id="fcmta2tail" x1="0.3" y1="0.9" x2="1" y2="0.1">
              <stop offset="0%" stopColor="#E8953A" />
              <stop offset="45%" stopColor="#F7C05E" />
              <stop offset="100%" stopColor="#FFF3D6" />
            </linearGradient>
            <radialGradient id="fcmta2head" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#FFF6DC" />
              <stop offset="100%" stopColor="#F2A94A" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="26" fill="#0d0d14" />
          <path d="M33.5,40 L54,10 L23.5,32 Z" fill="url(#fcmta2tail)" />
          <circle cx="24" cy="40" r="7.5" fill="url(#fcmta2head)" />
          <circle cx="21.5" cy="37.5" r="2.4" fill="#FFFCF0" opacity=".9" />
        </svg>
      )
    case 'Reflection Nebula':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <defs>
            <radialGradient id="reflectionDust" cx="46%" cy="45%" r="56%">
              <stop offset="0" stopColor="#f8fbff" stopOpacity=".95" />
              <stop offset=".28" stopColor="#9ed4ff" stopOpacity=".68" />
              <stop offset=".62" stopColor="#3f73b6" stopOpacity=".30" />
              <stop offset="1" stopColor="#0a0a0f" stopOpacity="0" />
            </radialGradient>
            <filter id="reflectionBlur">
              <feGaussianBlur stdDeviation="1.8" />
            </filter>
          </defs>
          <path
            d="M13 35c3-12 13-21 25-20 10 1 16 8 15 16-.8 10-11 17-24 16-10-.8-18-5-16-12Z"
            fill="url(#reflectionDust)"
            filter="url(#reflectionBlur)"
          />
          <path
            d="M18 39c9-8 20-7 32-18"
            fill="none"
            stroke="#09111f"
            strokeWidth="4.2"
            strokeLinecap="round"
            opacity=".38"
          />
          <path d="M34 17l2.1 7.1 7.1 2.1-7.1 2.1L34 35.5l-2.1-7.2-7.1-2.1 7.1-2.1L34 17Z" fill="#fffaf0" />
          <circle cx="45" cy="42" r="1.8" fill="#d6efff" opacity=".75" />
          <circle cx="21" cy="24" r="1.3" fill="#ffffff" opacity=".7" />
        </svg>
      )
    default:
      // Unknown/future type string — a plain dim dot rather than nothing, so
      // a new catalog "type" value never renders visibly broken.
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="2" />
        </svg>
      )
  }
}

// One-line description under the object name. When the object is matched from
// the catalog (kind: 'known'), shows its curated description. 'moving' gets
// its own rotating poetic line (the telescope is between targets); 'fallback'
// gets a fixed warm supporting line (solved, but no confident catalog match).
// Both transitional states also show a small rotating instruction line
// beneath the main line (see TransitionCopy) — Option A structure: main line
// prominent, instruction line smaller/dimmer.
function ObjectDescription({ displayObject }: { displayObject: DisplayObject }) {
  if (displayObject.kind === 'known') {
    return <p className="live-object-desc">{displayObject.description}</p>
  }
  if (displayObject.kind === 'moving') {
    return <TransitionCopy mainPhrases={MOVING_PHRASES} />
  }
  return <TransitionCopy mainPhrases={[FALLBACK_SUPPORTING_LINE]} />
}

// Guest-facing label for the three display states — see DisplayObject in
// lib/live-status.ts. "Moving" and "fallback" are deliberately vague/generic:
// a wrong specific name is worse than an honest "we're not sure yet."
function objectLabel(displayObject: DisplayObject): string {
  if (displayObject.kind === 'known') return displayObject.name
  if (displayObject.kind === 'moving') return 'Next object incoming'
  return 'Deep-sky field'
}

// Universal one-liners shown under the object name when there's no catalog
// description (kind: 'known' with no confident type match doesn't occur —
// this pool is currently unused by ObjectDescription directly, kept for any
// future generic-fallback need). Same spirit as the offline flavor text:
// poetic/educational, object-agnostic, always true.
const UNIVERSAL_PHRASES = [
  'The light reaching this lens left its source long before you were born.',
  'Every photon here crossed the dark for thousands of years to arrive tonight.',
  'What looks like a faint smudge is a structure larger than our whole solar system.',
  'You’re seeing the sky as it was, not as it is — distance is a kind of time machine.',
  'This is real light from real space, gathered a moment ago through the telescope.',
  'The universe doesn’t perform. It simply is — and tonight, it’s here.',
  'Most of what fills the sky is invisible to the eye alone. The telescope lets us look closer.',
  'Ancient light, caught live — the oldest thing you’ll see all day.',
  'Somewhere in this frame, gravity is quietly building the next generation of stars.',
  'The same sky the ancient Greeks watched over the Aegean, seen a little deeper.',
]

// Shown for kind: 'moving' (astrometryState 'unavailable'/'failed' — the
// telescope is between targets). Rotates gently, same mechanism/cadence as
// the old universal phrases.
const MOVING_PHRASES = [
  'Turning toward the next view…',
  'The telescope is moving through the night…',
  'On our way to the next object…',
  'Crossing to another part of the sky…',
  'A new patch of sky is coming into view…',
]

// Shown for kind: 'fallback' (solved, but no confident catalog match) as the
// warm supporting line beneath the "Deep-sky field" pill — so this state
// reads as an intentional design choice, not an error.
//
// PROPOSED — two other options in the same voice, in case this one doesn't
// land; swap freely:
//   'Gathering light while we get our bearings…'
//   'Somewhere out there, still finding the name for this…'
const FALLBACK_SUPPORTING_LINE = 'Collecting light from this part of the sky…'

// Small instruction line rotating beneath the main transitional phrase (both
// 'moving' and 'fallback') — Option A: dimmer/smaller than the main line,
// just enough reassurance that nothing is broken.
const INSTRUCTION_PHRASES = ['just a moment', 'one moment', 'the view returns shortly', 'back in a moment']

const TRANSITION_PHRASE_ROTATE_MS = 25 * 1000
const TRANSITION_PHRASE_FADE_MS = 600

// Crossfades between entries of `phrases` on an interval — the shared
// rotation mechanism behind both the main transitional line and the
// instruction line. A single-entry pool (e.g. the fixed fallback supporting
// line) just renders statically without ever rotating (the effect's interval
// still runs but modulo-1 always re-selects the same index, and the identical
// text skips the visible crossfade in practice).
function useRotatingPhrase(phrases: string[]): { text: string; visible: boolean } {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * phrases.length))
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (phrases.length <= 1) return
    const fadeRef = { id: null as ReturnType<typeof setTimeout> | null }
    const rotate = setInterval(() => {
      setVisible(false)
      fadeRef.id = setTimeout(() => {
        setIndex((i) => (i + 1) % phrases.length)
        setVisible(true)
      }, TRANSITION_PHRASE_FADE_MS)
    }, TRANSITION_PHRASE_ROTATE_MS)
    return () => {
      clearInterval(rotate)
      if (fadeRef.id) clearTimeout(fadeRef.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phrases is a
    // module-level constant array per call site; re-running on identity
    // would restart rotation needlessly since it's never actually new.
  }, [phrases.length])

  return { text: phrases[index], visible }
}

// Gently rotating universal phrase with a crossfade — used when no catalog
// description is available. Rotation cadence is calm (25s) so it reads as
// ambient, not attention-grabbing. Kept as the plain single-line variant
// (no instruction line) for any future non-transitional use of
// UNIVERSAL_PHRASES.
function RotatingPhrase() {
  const { text, visible } = useRotatingPhrase(UNIVERSAL_PHRASES)
  return (
    <p className={`live-object-desc live-object-desc--rotating${visible ? ' is-visible' : ''}`}>{text}</p>
  )
}

// Option A structure for the two transitional states (moving/fallback): the
// poetic/supporting line is the prominent element, with a small, dimmer,
// independently-rotating instruction line beneath it — same card, same
// rotation cadence/crossfade as RotatingPhrase, just two lines instead of one.
function TransitionCopy({ mainPhrases }: { mainPhrases: string[] }) {
  const main = useRotatingPhrase(mainPhrases)
  const instruction = useRotatingPhrase(INSTRUCTION_PHRASES)
  return (
    <div className="live-object-desc live-object-desc--transition">
      <p className={`transition-main${main.visible ? ' is-visible' : ''}`}>{main.text}</p>
      <p className={`transition-instruction${instruction.visible ? ' is-visible' : ''}`}>{instruction.text}</p>
    </div>
  )
}

// Guest share panel. PURELY CLIENT-SIDE, per the confirmed privacy
// constraint: nothing here leaves the browser as data — the composed
// auto-line text only ever gets handed to the guest's OWN share sheet / deep
// link / clipboard. No fetch, no storage, nothing sent to any backend or
// database. Icon-only: no guest text input at all (an earlier caption/name
// field was dropped from the design).
function SharePanel({ displayObject }: { displayObject: DisplayObject }) {
  // One random line per POOL, cached for the page's lifetime (not re-rolled
  // on every render or every object change) — "auto-line chosen at random
  // once per page load, stable across all four share icons for that
  // session." If the resolved display state later switches pools (known ->
  // fallback or back), that pool's own already-cached pick is used — still
  // exactly one roll per pool per page load, just tracked per-pool so a
  // pool-switch mid-session doesn't show a stale/wrong-shaped line.
  const knownLineRef = useRef<string | null>(null)
  if (knownLineRef.current === null) knownLineRef.current = pickRandomLine(KNOWN_OBJECT_LINES)
  const noNameLineRef = useRef<string | null>(null)
  if (noNameLineRef.current === null) noNameLineRef.current = pickRandomLine(NO_CONFIDENT_NAME_LINES)

  const autoLine =
    displayObject.kind === 'known'
      ? fillName(knownLineRef.current, displayObject.name)
      : noNameLineRef.current

  function shareText(): string {
    return composeShareText(autoLine)
  }

  const [status, setStatus] = useState('')

  async function handleNativeShare() {
    const text = shareText()
    if (navigator.share) {
      try {
        await navigator.share({ text })
        setStatus('')
      } catch {
        // Guest cancelled the share sheet or it failed silently — no error UI
        // for a purely optional, best-effort action.
      }
    } else {
      handleCopy()
    }
  }

  function handleWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(shareText())}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setStatus('')
  }

  function handleX() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText())}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setStatus('')
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareText())
      setStatus('Copied.')
    } catch {
      // Clipboard permission denied or unavailable — silently no-op; this is
      // a nice-to-have action, not a critical path.
      setStatus('Copy unavailable.')
    }
  }

  return (
    <section className="share-card" aria-label="Share this view">
      <div className="share-head">
        <span>Share this view</span>
      </div>
      <div className="share-grid">
        <button type="button" className="share-btn" onClick={handleNativeShare} aria-label="Share">
          <ShareIcon />
          <span>Share</span>
        </button>
        <button type="button" className="share-btn" onClick={handleWhatsApp} aria-label="Share on WhatsApp">
          <WhatsAppIcon />
          <span>WhatsApp</span>
        </button>
        <button type="button" className="share-btn" onClick={handleX} aria-label="Share on X">
          <XIcon />
          <span>X</span>
        </button>
        <button type="button" className="share-btn" onClick={handleCopy} aria-label="Copy share text">
          <CopyIcon />
          <span>Copy</span>
        </button>
      </div>
      <div className="share-status" aria-live="polite">
        {status}
      </div>
    </section>
  )
}

// Small monochrome/dim-gold line icons — no external icon library, kept as
// inline SVG so there's no extra dependency for four glyphs. currentColor so
// they inherit .share-btn svg's color (dim gold, brighter on hover).
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="M8.3 10.7 15.7 6.6M8.3 13.3 15.7 17.4" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3Z" />
      <path d="M8.5 8.6c.2-.5.5-.5.8-.5h.6c.2 0 .4 0 .6.5s.7 1.7.8 1.8c.1.2.1.3 0 .5-.1.2-.2.3-.4.5s-.4.4-.2.7c.2.4 1 1.5 2.1 2.4 1.4 1.2 2 1.3 2.3 1.2.2-.1.5-.5.7-.8.2-.2.4-.3.6-.2s1.4.6 1.6.7c.2.1.4.2.4.3 0 .5-.2 1.2-.5 1.5-.4.4-1.2.7-1.8.7-.5 0-1.7-.2-3.4-1.4-2-1.4-3.3-3.3-3.5-3.6-.1-.2-.9-1.2-.9-2.3 0-1.1.6-1.6.8-1.8Z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M13.9 10.4 21 3h-2.2l-6.2 6.5L7.6 3H3l7.4 10.3L3.3 21h2.2l6.6-6.9 5.4 6.9H22l-8.1-10.6Zm-2.3 2.4-.8-1.1L5 4.6h2l4.9 6.6.8 1.1 6.4 8.7h-2l-5.5-7.2Z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.8" />
      <path d="M5.5 15.5h-1a1.8 1.8 0 0 1-1.8-1.8v-9A1.8 1.8 0 0 1 4.5 2.9h9a1.8 1.8 0 0 1 1.8 1.8v1" />
    </svg>
  )
}

function toggleFullscreen() {
  if (typeof document === 'undefined') return
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  } else {
    document.documentElement.requestFullscreen().catch(() => {})
  }
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

// Bodies that cycle around the telescope, in order: moon → satellite → saturn →
// star → UFO → repeat. `modifier` tweaks per-body styling: the '✦' is a
// CSS-tinted Newtonian 4-point star, the UFO spins on itself (no
// counter-rotation), the moon is drawn smaller. To add more, just extend this
// list.
const ORBIT_BODIES = [
  { glyph: '🌙', modifier: 'scope-loader__body--moon' },
  { glyph: '🛰️', modifier: '' },
  { glyph: '🪐', modifier: '' },
  { glyph: '✦', modifier: 'scope-loader__body--star' },
  { glyph: '🛸', modifier: 'scope-loader__body--spin' },
] as const

// One full orbit lap. Must match the scope-orbit / scope-orbit-counter duration
// in styles.css so the body advances exactly when a lap completes.
const ORBIT_DURATION_MS = 4000

// Slow calm orbit around a telescope — a "getting ready" cue, deliberately not
// a fast spinner. Bodies travel the ring without spinning on themselves (see
// the counter-rotation in styles.css); the UFO is the exception. The body
// advances to the next one each time the orbit completes a lap. Decorative
// only, so hidden from assistive tech.
function TelescopeLoader() {
  // Start at index 0 (moon) so the server-rendered and first client render
  // match (no hydration mismatch), then step through the list every lap.
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % ORBIT_BODIES.length)
    }, ORBIT_DURATION_MS)
    return () => clearInterval(id)
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
      <div className="shooting-stars" aria-hidden="true">
        <span className="shooting-star shooting-star--one" />
        <span className="shooting-star shooting-star--two" />
        <span className="shooting-star shooting-star--three" />
      </div>
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
