'use client'

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  liveStatusReducer,
  initialLiveStatusState,
  type LiveStatusState,
  type OfflinePayload,
  type DisplayObject,
} from '@/lib/live-status'
import { pickFarewellVariant, formatNextSessionLines, NO_NEXT_SESSION_LINE } from '@/lib/live-farewell'
import { FarewellAegeanUfo } from './FarewellAegeanUfo'
import { SpecialEventFarewell } from './SpecialEventFarewell'
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
import { computeRunKey } from '@/lib/detect-transition'
import { nextEvent } from '@/lib/schedule'

// Crossfade duration for a flavor-line swap; must match the opacity transition
// in styles.css (.status-flavor).
const FLAVOR_FADE_MS = 300

const POLL_INTERVAL_MS = 10 * 1000
const FETCH_TIMEOUT_MS = 8 * 1000
const IMAGE_PRELOAD_TIMEOUT_MS = 10 * 1000
const RECONNECT_CHECK_MS = 1000 // how often we check the 45s give-up clause while reconnecting
const TRANSITION_CHECK_MS = 1000 // how often we check the 5-min transition give-up clause (threshold itself lives in lib/live-status.ts's reducer, same pattern as RECONNECT_CHECK_MS/GIVE_UP_AFTER_MS)

// Object-match confidence tiers as reported by lib/catalog.ts via /api/status.
type ObjectMatchConfidence = 'high' | 'medium' | 'low' | 'none'

// One entry in the session-history strip (see app/api/status/route.ts's
// fetchHistory/HistoryEntry — kept in sync with that shape by hand, same as
// every other /api/status field this file validates). confidence is left as
// a plain string here (not narrowed to ObjectMatchConfidence) since the
// server stores the real Confidence value as-is and this file's own
// isValidHistoryEntry is what actually constrains which values pass through.
type HistoryEntry = {
  // StackRun.id — the React key (see SessionHistoryStrip). startedAt alone
  // isn't safe as a key: same-millisecond StackRun rows are possible under
  // concurrent ingest, which would collide; id is the DB primary key.
  id: string
  objectId: string | null
  objectName: string | null
  objectType: string | null
  confidence: string | null
  startedAt: string
  endedAt: string | null
  blobUrl: string | null
  active: boolean
}

// Raw /api/status response shapes we care about. Anything not matching one of
// these (network error, timeout, non-2xx, bad JSON) is POLL_FAILED — never
// treated as offline. See lib/live-status.ts for the full contract notes.
type StatusLive = {
  live: true
  // Hotel devices OR any special-event slug (config/extra-events.json) — kept
  // as a plain string for the same reason lib/redis.ts's Source type is: the
  // set of valid special-event sources isn't fixed at build time.
  source: string
  frame: { frameId: string; blobUrl: string; capturedAt: string; ingestedAt: string }
  observation: { observationId: string; objectName: string }
  sessionId: string
  // Tonight's session-history strip (app/api/status/route.ts's fetchHistory) —
  // chronological StackRun rows for the current session+source. Optional and
  // best-effort like telemetry/objectMatch below: absent, malformed, or
  // individually-invalid entries must never invalidate the whole response or
  // affect the live image — see isValidHistory, which silently DROPS bad
  // items rather than failing the whole array.
  history?: HistoryEntry[]
  // The currently-open StackRun's startedAt for this observation (see
  // activeStackRunStartedAt in app/api/status/route.ts) — combined with
  // source+observationId, this is the run key state-aware-transition
  // compares against the displayed frame's own run key to detect "a new
  // stack run has started" directly from the main poll, without depending
  // on the separate useMilestoneFrames poll cycle. Optional/nullable like
  // telemetry/objectMatch below: absent (older server) or null (no StackRun
  // row yet) both just mean "no run-key comparison possible this poll,"
  // never a reason to fail validation.
  stackRunStartedAt?: string | null
  telemetry?: { state?: string; totalAccumulatedTime?: number; astrometryState?: string }
  objectMatch?: {
    name: string
    confidence: ObjectMatchConfidence
    description: string
    type: string
    constellation?: string
    distanceLy?: number
    sizeDescription?: string
    wowFacts?: string[]
    visualHint?: string
    drawer?: { heading: string; body: string }[]
  }
}
type StatusOffline = {
  live: false
  degraded?: false
  finished?: false
  specialEventFinished?: false
  tonight: OfflinePayload['tonight']
  next: OfflinePayload['next']
}
type StatusDegraded = {
  live: false
  degraded: true
  finished?: false
  specialEventFinished?: false
  tonight?: OfflinePayload['tonight']
  next?: OfflinePayload['next']
}
// The explicit "tonight is finished" flag from /api/finish (see
// app/api/status/route.ts, which checks this BEFORE any frame-freshness
// logic). Deliberately its own narrow shape — not a variant of
// StatusOffline/StatusDegraded — so isStatusResponse can recognize it before
// (and independently of) the tonight/next offline fields, which /api/status
// never includes on this branch. degraded?: false alongside finished:true
// (and finished?: false on the other two variants) is what lets TypeScript
// narrow body.finished/body.degraded safely across the whole union below,
// the same pattern StatusOffline already uses for degraded.
type StatusFinished = {
  live: false
  finished: true
  degraded?: false
  specialEventFinished?: false
  date: string
  next: OfflinePayload['next']
}
// A special event's own finished flag (eventFinishedKey — per-source, see
// lib/redis.ts), distinct from StatusFinished: no date/next (special events
// have no farewell-variant seed or recurring next session — see
// extraEventStatus in app/api/status/route.ts), and drives a different
// uiState ('special-event-finished', not 'finished') so it never triggers
// the hotel-specific Aegean UFO farewell.
type StatusSpecialEventFinished = {
  live: false
  specialEventFinished: true
  degraded?: false
  finished?: false
}
type StatusResponse =
  | StatusLive
  | StatusOffline
  | StatusDegraded
  | StatusFinished
  | StatusSpecialEventFinished

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString)
}

function isDrawerArray(v: unknown): v is { heading: string; body: string }[] {
  return Array.isArray(v) && v.every((s) => isObject(s) && isString(s.heading) && isString(s.body))
}

function isSource(v: unknown): v is StatusLive['source'] {
  return isString(v) && v.length > 0
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
    (v.sizeDescription === undefined || isString(v.sizeDescription)) &&
    (v.wowFacts === undefined || isStringArray(v.wowFacts)) &&
    (v.visualHint === undefined || isString(v.visualHint)) &&
    (v.drawer === undefined || isDrawerArray(v.drawer))
  )
}

// Deliberately NOT an all-or-nothing validator like isValidTelemetry/
// isValidObjectMatch above — history is a nice-to-have strip, not core
// live-view data, so a single malformed entry (or the whole field being an
// unexpected shape) degrades to "drop that entry" / "empty strip" rather
// than invalidating the entire /api/status response the way returning
// false from here would. Called separately in the poll loop, never as part
// of isLiveStatus's own pass/fail gate.
function isValidHistoryEntry(v: unknown): v is HistoryEntry {
  if (!isObject(v)) return false
  return (
    isString(v.id) &&
    (v.objectId === null || isString(v.objectId)) &&
    (v.objectName === null || isString(v.objectName)) &&
    (v.objectType === null || isString(v.objectType)) &&
    (v.confidence === null || isString(v.confidence)) &&
    isString(v.startedAt) &&
    (v.endedAt === null || isString(v.endedAt)) &&
    (v.blobUrl === null || isString(v.blobUrl)) &&
    typeof v.active === 'boolean'
  )
}

function sanitizeHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return []
  return v.filter(isValidHistoryEntry)
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
    (v.stackRunStartedAt === undefined || v.stackRunStartedAt === null || isString(v.stackRunStartedAt)) &&
    isValidTelemetry(v.telemetry) &&
    isValidObjectMatch(v.objectMatch)
  )
}

function isOfflineStatus(v: Record<string, unknown>): v is StatusOffline {
  return v.live === false && v.degraded !== true && isTonightInfo(v.tonight) && isNextInfo(v.next)
}

function isFinishedStatus(v: Record<string, unknown>): v is StatusFinished {
  return v.live === false && v.finished === true && isString(v.date) && isNextInfo(v.next)
}

function isSpecialEventFinishedStatus(v: Record<string, unknown>): v is StatusSpecialEventFinished {
  return v.live === false && v.specialEventFinished === true
}

function isStatusResponse(v: unknown): v is StatusResponse {
  if (!isObject(v)) return false
  // Checked BEFORE degraded/offline/live — mirrors the server's own
  // ordering in app/api/status/route.ts (finished-check runs first, before
  // any frame-freshness logic), so the two sides of this contract agree on
  // priority rather than just happening to agree today.
  if (v.live === false && v.finished === true) return true
  if (v.live === false && v.specialEventFinished === true) return true
  if (v.live === false && v.degraded === true) return true
  return isLiveStatus(v) || isOfflineStatus(v) || isFinishedStatus(v) || isSpecialEventFinishedStatus(v)
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
      wowFacts: body.objectMatch.wowFacts,
      visualHint: body.objectMatch.visualHint,
      drawer: body.objectMatch.drawer,
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
  | 'known-enriched'
  | 'moving'
  | 'fallback'
  | 'new-target'
  | 'finished'
  | 'history-test'

const DEMO_MODES: DemoMode[] = [
  'known',
  'known-nebula',
  'known-galaxy',
  'known-globular',
  'known-open-cluster',
  'known-planetary',
  'known-supernova-remnant',
  'known-enriched',
  'moving',
  'fallback',
  'new-target',
  'finished',
  'history-test',
]

// Stacking-progression milestone marks — see MILESTONE_SECONDS in
// lib/detect-transition.ts (First=0s, 2min=120s, 5min=300s) and
// app/api/observations/[id]/milestones/route.ts, which this key set mirrors
// exactly. 'current' always exists (it's just the live frame); the other
// three are only available once the CURRENT stack run has genuinely reached
// that mark — see useMilestoneFrames below for the fetch/poll that backs this.
type MilestoneKey = 'current' | 'first' | 'twoMin' | 'fiveMin'

type MilestoneFrame = { blobUrl: string; capturedAt: string }
type MilestoneMarks = { first: MilestoneFrame | null; twoMin: MilestoneFrame | null; fiveMin: MilestoneFrame | null }

const MILESTONE_POLL_MS = 10 * 1000

type MilestoneState = { marks: MilestoneMarks | null; runKey: string | null }

// Fetches /api/observations/[id]/milestones for the given observation and
// polls it every MILESTONE_POLL_MS while `open` — new marks land as a real
// stack run progresses (First is available immediately, 2min/5min arrive
// later), so this can't be a one-shot fetch. Also surfaces the resolved
// runKey (source+observationId+stackRunStartedAt, see computeRunKey) so the
// caller can force the guest's milestone SELECTION back to 'current'
// whenever it changes — this covers not just an observationId change but
// also a same-observation stack-run reset (mid-session retarget with no
// Observation split) and an active-source switch, both flagged in review as
// real ways the old observationId-only reset logic could leave a guest
// silently viewing a stale/mismatched milestone frame.
//
// Resets marks (and therefore forces the caller's next read of runKey to
// null, which differs from any real key and so always triggers a selection
// reset) IMMEDIATELY on a source/observationId prop change, rather than
// waiting for the next poll to resolve — showing the PREVIOUS run's
// milestone frames for even one render under the new identity would be
// exactly the bug this hardening pass exists to close.
function useMilestoneFrames(source: string | null, observationId: string | null, open: boolean): MilestoneState {
  const [state, setState] = useState<MilestoneState>({ marks: null, runKey: null })

  useEffect(() => {
    setState({ marks: null, runKey: null }) // clear immediately — see doc above
    if (source === null || observationId === null) return

    let cancelled = false
    const controller = new AbortController()

    async function fetchOnce() {
      try {
        const res = await fetch(`/api/observations/${encodeURIComponent(observationId as string)}/milestones`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!res.ok) return // leave state as last-known-good; a transient failure shouldn't blank the toggle
        const body = await res.json()
        if (cancelled) return
        if (
          isObject(body) &&
          isString(body.observationId) &&
          (body.stackRunStartedAt === null || isString(body.stackRunStartedAt)) &&
          isObject(body.marks) &&
          isMilestoneFrameOrNull(body.marks.first) &&
          isMilestoneFrameOrNull(body.marks.twoMin) &&
          isMilestoneFrameOrNull(body.marks.fiveMin)
        ) {
          setState({
            marks: { first: body.marks.first, twoMin: body.marks.twoMin, fiveMin: body.marks.fiveMin },
            runKey: computeRunKey(source as string, body.observationId, body.stackRunStartedAt),
          })
        }
      } catch {
        // Network error/abort — leave state as last-known-good, same as a
        // non-OK response; this is a supplementary feature, never worth
        // disrupting the main live view over.
      }
    }

    fetchOnce()
    // Only poll while the observation is still open — once it's closed (a
    // target change or session end), its milestone set is final and will
    // never change again, so continuing to poll would be pure waste.
    const interval = open ? setInterval(fetchOnce, MILESTONE_POLL_MS) : null

    return () => {
      cancelled = true
      controller.abort()
      if (interval) clearInterval(interval)
    }
  }, [source, observationId, open])

  return state
}

function isMilestoneFrameOrNull(v: unknown): v is MilestoneFrame | null {
  if (v === null) return true
  return isObject(v) && typeof v.blobUrl === 'string' && typeof v.capturedAt === 'string'
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
  // The one enriched-content demo (M27 has wowFacts/visualHint/drawer as of
  // fix/catalog-copy-accuracy; M31 and Saturn also have it, but this is the
  // only demo key needed to review the EnrichedCard UI — see EnrichedCard in
  // this file).
  'known-enriched': { catalogId: 'M27', blobUrl: '/images/astro-05.jpg', totalAccumulatedTime: 1980 },
  // A target that JUST started — short accumulated time; the milestone
  // toggle correctly shows only 'Current View' as available here since real
  // milestone data (fetched via useMilestoneFrames) never gets constructed
  // in demo mode (see isDemo in LiveFrameView) — this entry is purely for
  // reviewing the "just started" object-card content, not the toggle.
  'new-target': { catalogId: 'M20', blobUrl: '/images/nebula-trifid-m20.jpg', totalAccumulatedTime: 22 },
  // Live object behind the history-test demo (see MOCK_HISTORY below) — just
  // needs to be a normal known-object card; the point of this demo mode is
  // the history strip beneath it, not this card itself.
  'history-test': { catalogId: 'M13', blobUrl: '/images/astro-01.jpg', totalAccumulatedTime: 1860 },
}

// Pure client-side mock data for ?demo=history-test — reviewing
// SessionHistoryStrip's two-row wrap (HISTORY_ROW_MAX, see the component)
// AND tappable history-pill browsing (preload-before-switch, catalog
// lookup, the null-blobUrl/unresolved edge cases) without writing anything
// to Postgres. Deliberately mixes short catalog ids that print as-is (M13,
// M27, M31) with the long hyphenated ones (NGC6960-6992, LEO-TRIPLET) that
// force shortHistoryLabel's name-based fallback — 9 entries total (one more
// than double HISTORY_ROW_MAX), so the strip wraps to two rows of 4/5 —
// still exercising the two-row layout, not a special case of it.
//
// Most entries carry a REAL blobUrl (an existing /public/images asset —
// see KNOWN_DEMO_SOURCE above for the same pattern) so tapping them
// actually demonstrates a successful preload+switch, not just the error
// path. mock-3 (Veil Nebula) is the deliberate exception — blobUrl: null —
// so the "No saved image for this target" feedback (see
// handleSelectHistoryRun in LiveViewPresentation) has something real to
// test against. mock-9 is a SECOND unresolved/settling pill (confidence:
// 'none', not the active one) to confirm a non-active unresolved run is
// correctly omitted from the strip entirely (see isDisplayableRun's own
// doc comment: only the ACTIVE run gets the neutral settling treatment;
// a past run that never resolved is dropped, not shown as "…").
// mock-10 is the active/current one (matches the demo's own
// KNOWN_DEMOS['history-test'] = M13 card).
const MOCK_HISTORY: HistoryEntry[] = [
  {
    id: 'mock-1',
    objectId: 'M27',
    objectName: 'Dumbbell Nebula',
    objectType: 'Planetary Nebula',
    confidence: 'high',
    startedAt: '2026-07-09T20:00:00.000Z',
    endedAt: '2026-07-09T20:12:00.000Z',
    blobUrl: '/images/astro-05.jpg',
    active: false,
  },
  {
    id: 'mock-2',
    objectId: 'NGC7000',
    objectName: 'North America Nebula',
    objectType: 'Diffuse Nebula',
    confidence: 'high',
    startedAt: '2026-07-09T20:12:00.000Z',
    endedAt: '2026-07-09T20:24:00.000Z',
    blobUrl: '/images/astro-04.jpg',
    active: false,
  },
  {
    id: 'mock-3',
    objectId: 'NGC6960-6992',
    objectName: 'Veil Nebula',
    objectType: 'Supernova Remnant',
    confidence: 'medium',
    startedAt: '2026-07-09T20:24:00.000Z',
    endedAt: '2026-07-09T20:36:00.000Z',
    // Deliberately null — the "no saved image for this target" test case
    // (see this const's own doc comment above).
    blobUrl: null,
    active: false,
  },
  {
    id: 'mock-4',
    objectId: 'M31',
    objectName: 'Andromeda Galaxy',
    objectType: 'Spiral Galaxy',
    confidence: 'high',
    startedAt: '2026-07-09T20:36:00.000Z',
    endedAt: '2026-07-09T20:48:00.000Z',
    blobUrl: '/images/galaxy-triangulum-m33.jpg',
    active: false,
  },
  {
    id: 'mock-5',
    objectId: 'LEO-TRIPLET',
    objectName: 'Leo Triplet',
    objectType: 'Galaxy Group',
    confidence: 'medium',
    startedAt: '2026-07-09T20:48:00.000Z',
    endedAt: '2026-07-09T21:00:00.000Z',
    blobUrl: '/images/galaxy-ngc2403.jpg',
    active: false,
  },
  {
    id: 'mock-6',
    objectId: 'M51',
    objectName: 'Whirlpool Galaxy',
    objectType: 'Spiral Galaxy',
    confidence: 'high',
    startedAt: '2026-07-09T21:00:00.000Z',
    endedAt: '2026-07-09T21:12:00.000Z',
    blobUrl: '/images/galaxy-fireworks-ngc6946.jpg',
    active: false,
  },
  {
    id: 'mock-7',
    objectId: 'M101',
    objectName: 'Pinwheel Galaxy',
    objectType: 'Spiral Galaxy',
    confidence: 'medium',
    startedAt: '2026-07-09T21:12:00.000Z',
    endedAt: '2026-07-09T21:24:00.000Z',
    blobUrl: '/images/galaxy-ic342-hidden.jpg',
    active: false,
  },
  {
    id: 'mock-8',
    objectId: 'M20',
    objectName: 'Trifid Nebula',
    objectType: 'Diffuse Nebula',
    confidence: 'high',
    startedAt: '2026-07-09T21:24:00.000Z',
    endedAt: '2026-07-09T21:36:00.000Z',
    blobUrl: '/images/nebula-trifid-m20.jpg',
    active: false,
  },
  {
    id: 'mock-9',
    objectId: null,
    objectName: null,
    objectType: null,
    confidence: 'none',
    startedAt: '2026-07-09T21:36:00.000Z',
    endedAt: '2026-07-09T21:38:00.000Z',
    blobUrl: null,
    active: false,
  },
  {
    id: 'mock-10',
    objectId: 'M13',
    objectName: 'Hercules Globular Cluster',
    objectType: 'Globular Cluster',
    confidence: 'high',
    startedAt: '2026-07-09T21:38:00.000Z',
    endedAt: null,
    blobUrl: '/images/astro-01.jpg',
    active: true,
  },
]

const CATALOG_BY_ID = new Map((catalogData as { objects: CatalogObject[] }).objects.map((o) => [o.id, o]))

// Reverse lookup for the live heading (see headingParts) — /api/status's
// objectMatch payload carries the catalog object's primaryName/type but
// never its id (see resolveObjectMatch in app/api/status/route.ts), so the
// heading recovers the id client-side from the SAME catalog.json already
// imported above, rather than widening the wire contract just to send a
// string the client can already look up locally.
const CATALOG_ID_BY_NAME = new Map(
  (catalogData as { objects: CatalogObject[] }).objects.map((o) => [o.primaryName, o.id]),
)

// Builds a DisplayObject for a tapped history pill (see SessionHistoryStrip/
// HistoryPill and the historical-browsing wiring in LiveFrameView) — reuses
// the EXACT same DisplayObject shape the live path produces via
// resolveDisplayObject above, so every component downstream (ObjectTypeLine,
// Facts, ObjectDescription/EnrichedCard, headingParts) renders a historical
// object with no new code path, just different data in.
//
// Catalog lookup by objectId is the common/expected case (a StackRun that
// made it into the history strip at all already passed isDisplayableRun's
// high/medium-confidence gate — see that function's own doc comment — so it
// should always have a real objectId the catalog recognizes). objectId
// missing or not found in the catalog is a defensive fallback, not a normal
// path: render a safe MINIMAL card from the StackRun's own denormalized
// fields (objectName/objectType) rather than failing or inventing content
// — no constellation/distance/wowFacts/etc, since we have no source for
// them. ObjectDescription's own all-or-nothing enriched-content gate means
// this naturally renders as the plain (non-enriched) card.
function displayObjectForHistoryRun(run: HistoryEntry): DisplayObject {
  const catalogObject = run.objectId ? CATALOG_BY_ID.get(run.objectId) : undefined
  if (catalogObject) {
    return {
      kind: 'known',
      name: catalogObject.primaryName,
      description: catalogObject.description,
      type: catalogObject.type,
      constellation: catalogObject.constellation,
      distanceLy: catalogObject.distanceLy,
      sizeDescription: catalogObject.sizeDescription,
      wowFacts: catalogObject.wowFacts,
      visualHint: catalogObject.visualHint,
      drawer: catalogObject.drawer,
    }
  }
  return {
    kind: 'known',
    name: run.objectName ?? run.objectId ?? 'Unknown',
    description: '',
    type: run.objectType ?? 'Unknown',
  }
}

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
    wowFacts?: string[]
    visualHint?: string
    drawer?: { heading: string; body: string }[]
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
          wowFacts: catalogObject.wowFacts,
          visualHint: catalogObject.visualHint,
          drawer: catalogObject.drawer,
        },
      ],
    ]
  }),
)

// A real astro photo (already shipped under /public/images) stands in for the
// live telescope frame in demo mode — cache-busted per call so the "new
// frame" preload path runs identically to production instead of always
// short-circuiting on the same-frameId branch.
function getDemoStatusBody(): StatusResponse | null {
  const mode = getDemoMode()
  if (!mode) return null

  // Finished is a live:false shape (unlike every other demo mode, which is
  // live:true) — handled first and separately so the rest of this function
  // can stay focused on constructing StatusLive bodies. `next` used to be
  // hardcoded to a fixed hotel/date (always "today" at OKU) — on any day
  // that isn't actually OKU's real weekly slot, that showed a guest the
  // WRONG next session (e.g. "Wednesday at OKU" when Wednesday has no
  // session and OKU is actually Tuesday's hotel). Real production status
  // walks forward from tomorrow via nextEvent() — see athensTomorrow +
  // nextEvent in app/api/status/route.ts — so the demo does the same lookup
  // here instead of fabricating a next session that may not exist.
  if (mode === 'finished') {
    const today = athensTodayDate()
    const tomorrow = addAthensDays(today, 1)
    const next = nextEvent(tomorrow)
    return {
      live: false,
      finished: true,
      date: today,
      next: next ? { date: next.date, hotelId: next.hotelId, start: next.start, end: next.end } : null,
    }
  }

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
        wowFacts: known.wowFacts,
        visualHint: known.visualHint,
        drawer: known.drawer,
      },
      // Only history-test injects mock history — every other known-* demo
      // stays history-free so those pages keep reviewing their own card
      // content in isolation, undistracted by a strip underneath.
      ...(mode === 'history-test' ? { history: MOCK_HISTORY } : {}),
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

// Add n calendar days to a YYYY-MM-DD date — same pure UTC arithmetic as
// addDays/athensTomorrow in lib/schedule.ts / app/api/status/route.ts, kept
// as its own tiny helper here since nextEvent() itself is imported but the
// server route's athensTomorrow() is not exported.
function addAthensDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Purely local dedup key for PRIVATE viewer analytics (see recordViewerActivity
// in lib/redis.ts and GET /api/viewer-stats) — a random id, NOT an IP, cookie,
// or anything tied to the guest's identity, that exists only so the operator
// can see how many distinct tabs are polling right now. Never rendered on
// /live; guests never see this value or know it exists. sessionStorage (not a
// plain in-memory ref) so a mid-session page refresh keeps the SAME id rather
// than momentarily registering as a second viewer; it naturally disappears
// when the tab closes, which is exactly when that viewer should stop counting.
const VIEWER_ID_STORAGE_KEY = 'stargazing:viewerId'

function getOrCreateViewerId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const existing = window.sessionStorage.getItem(VIEWER_ID_STORAGE_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    window.sessionStorage.setItem(VIEWER_ID_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Private-browsing/storage-disabled: viewer analytics quietly loses this
    // guest, never a crash — the page itself must keep working regardless.
    return null
  }
}

// statusUrl defaults to the normal hotel endpoint. /live/[event] passes
// '/api/status?event=<slug>' instead so the exact same component/state
// machine/rendering serves a special event (see app/api/status/route.ts's
// extraEventStatus) without any other behavioral change here.
export default function LiveView({ statusUrl = '/api/status' }: { statusUrl?: string } = {}) {
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
  // Generated once per mount (stable across every poll in this tab's
  // lifetime) — see getOrCreateViewerId's doc comment for why this is
  // private-analytics-only and never rendered.
  const viewerIdRef = useRef<string | null>(null)
  if (viewerIdRef.current === null) viewerIdRef.current = getOrCreateViewerId()

  // "updated Xs ago" ticks on its own timer, independent of polling.
  const [, forceTick] = useState(0)

  // Tonight's session-history strip — updated directly from every live poll
  // (see the poll effect below), independent of the reducer/lastLiveFrame
  // dedup: a new StackRun can appear on a poll that reuses the SAME frame
  // (e.g. the frame hasn't changed but a fresh detection just landed), so
  // this must not wait on a frame-identity change the way milestone marks
  // legitimately do. Reset to [] on any non-live poll result (offline/
  // finished/degraded) so a stale night's history can never linger into a
  // different state.
  const [history, setHistory] = useState<HistoryEntry[]>([])

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
          // viewerId appended purely for private viewer analytics (see
          // getOrCreateViewerId above) — never read back from the response,
          // never affects rendering. Omitted entirely when unavailable
          // (private browsing / storage disabled) rather than sending an
          // empty/placeholder value.
          const url = viewerIdRef.current
            ? `${statusUrl}${statusUrl.includes('?') ? '&' : '?'}viewerId=${encodeURIComponent(viewerIdRef.current)}`
            : statusUrl
          const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
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

        if (body.live === false && body.finished === true) {
          // Checked FIRST — before degraded/offline/live — mirroring the
          // server's own ordering. This must win even if the client were
          // somehow mid-way through rendering a fresh "live" frame; a
          // deliberate finish always overrides.
          setHistory([])
          dispatch({ type: 'POLL_FINISHED', payload: { date: body.date, next: body.next } })
        } else if (body.live === false && body.specialEventFinished === true) {
          // Same "always wins" priority as POLL_FINISHED, for a special
          // event's own scoped finished flag (see extraEventStatus in
          // app/api/status/route.ts) — routes to 'special-event-finished',
          // never 'finished', so the UFO farewell can never render here.
          setHistory([])
          dispatch({ type: 'POLL_SPECIAL_EVENT_FINISHED' })
        } else if (body.live === false && body.degraded === true) {
          // Resets history same as the other non-live branches — a degraded
          // poll means the CURRENT status couldn't be confirmed, so a stale
          // history strip must not linger as if it were still authoritative.
          setHistory([])
          dispatch({ type: 'POLL_DEGRADED' })
        } else if (body.live === false) {
          setHistory([])
          dispatch({ type: 'POLL_OFFLINE', payload: { tonight: body.tonight, next: body.next } })
        } else {
          // live:true. nextHistory is computed here but NOT applied yet for
          // the new-frame path below — see the two dispatch sites: history
          // must only advance in lockstep with the frame actually being
          // shown, never before. Applying it immediately (the previous
          // behavior) could show the history strip pointing at a NEW target
          // while the OLD image was still on screen, if that new image's
          // preload failed and POLL_LIVE_IMAGE_FAILED left the old frame
          // displayed.
          const nextHistory = sanitizeHistory(body.history)
          // live:true — never dispatch "live" until the image actually preloads.
          const current = stateRef.current

          // State-aware transition: compare the INCOMING run key (this
          // poll's source+observationId+stackRunStartedAt) against the
          // CURRENTLY DISPLAYED frame's own run key — read from
          // stateRef.current (not a render-time closure) so this always
          // compares against the real reducer state, immune to stale
          // closures across the async preload below. No comparison is
          // possible (and none is needed) before any frame has ever been
          // shown — current.lastLiveFrame is null on the very first live
          // poll, which is what 'checking' already covers.
          // A null stackRunStartedAt means "the server couldn't resolve the
          // active StackRun this poll" (e.g. fetchHistory failing server-
          // side — see activeStackRunStartedAt in /api/status/route.ts), NOT
          // "the run is now null." Treating it as a real value would make a
          // transient server-side hiccup look like a run change on every
          // poll until the query recovers, incorrectly yanking the guest
          // into transition off a real, currently-displayed frame. So run-
          // change detection is skipped entirely for this poll when it's
          // null — the displayed frame (and any in-progress transition)
          // just carries over unchanged until a poll reports a real value.
          const incomingRunKey =
            body.stackRunStartedAt != null
              ? computeRunKey(body.source, body.observation.observationId, body.stackRunStartedAt)
              : null
          const displayedRunKey = current.lastLiveFrame
            ? computeRunKey(
                current.lastLiveFrame.source,
                current.lastLiveFrame.observationId,
                current.lastLiveFrame.stackRunStartedAt,
              )
            : null
          const isRunChange =
            incomingRunKey !== null &&
            displayedRunKey !== null &&
            incomingRunKey !== displayedRunKey &&
            // Don't immediately re-enter transition for a run TRANSITION_TIMEOUT
            // already gave up on — see suppressedRunKey's doc in lib/live-status.ts.
            // A genuinely newer run key is unaffected (it won't match
            // suppressedRunKey) and still triggers a normal transition.
            incomingRunKey !== current.suppressedRunKey
          if (isRunChange) {
            // Dispatched BEFORE attempting to preload the new run's frame —
            // this is what makes the old image/card disappear immediately
            // rather than lingering until the new frame finishes loading.
            // A no-op in the reducer if this poll is reporting the SAME
            // run key an earlier poll already started transitioning to
            // (see the reducer case); a genuinely newer run key here
            // correctly supersedes it and restarts the give-up clock.
            dispatch({ type: 'POLL_RUN_TRANSITIONING', runKey: incomingRunKey })
          }

          if (current.lastLiveFrame?.frameId === body.frame.frameId) {
            // Same frame we already showed — no new image to wait on, so
            // history is safe to apply immediately alongside this dispatch.
            setHistory(nextHistory)
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
                observationId: body.observation.observationId,
                source: body.source,
                stackRunStartedAt: body.stackRunStartedAt ?? null,
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
              // Guard against a stale-preload race. The poll loop itself is
              // serial (inFlightRef keeps a second /api/status fetch from
              // starting until this one's preload fully settles), so this
              // can't happen via two overlapping polls — but
              // TRANSITION_TIMEOUT runs on its OWN independent setInterval
              // (see the effect below) and can fire mid-await, superseding
              // transitioningRunKey to suppress THIS run while this exact
              // preload is still in flight. Re-reading stateRef.current here
              // (rather than trusting incomingRunKey, captured before the
              // await) catches that: if a transition is in progress and
              // waiting on some OTHER run than the one this preload just
              // loaded, this frame is stale — drop it rather than promoting
              // an outdated/suppressed run to live.
              const stateNow = stateRef.current
              if (stateNow.transitioningRunKey !== null && stateNow.transitioningRunKey !== incomingRunKey) {
                return
              }
              // Only NOW, after preload succeeds, does history catch up to
              // this poll — applied alongside the live-frame dispatch so the
              // strip and the displayed image always advance together.
              setHistory(nextHistory)
              dispatch({
                type: 'POLL_LIVE_IMAGE_LOADED',
                frame: {
                  frameId: body.frame.frameId,
                  blobUrl: body.frame.blobUrl,
                  ingestedAt: body.frame.ingestedAt,
                  objectName: body.observation.objectName,
                  displayObject: resolveDisplayObject(body),
                  observationId: body.observation.observationId,
                  source: body.source,
                  stackRunStartedAt: body.stackRunStartedAt ?? null,
                  totalAccumulatedTime: body.telemetry?.totalAccumulatedTime,
                },
                loadedAt: Date.now(),
              })
            } catch {
              // Preload failed — the OLD frame stays on screen (see
              // POLL_LIVE_IMAGE_FAILED in the reducer), so history must also
              // stay as it was; nextHistory is deliberately dropped here,
              // never applied. If isRunChange fired above, transitioningRunKey
              // stays set too — the guest keeps seeing the transition/moving
              // copy (not the old target), never a fallback to the stale
              // image, exactly per the edge-case requirement.
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
    // statusUrl is fixed for the lifetime of a mounted page (derived from the
    // route, not app state) — intentionally excluded so this effect's mount/
    // unmount semantics (polling loop, listeners) are untouched by the new prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconnecting give-up clause driven by wall-clock time (45s since last
  // confirmed-live payload), independent of poll cadence — a slow/absent poll
  // stream must not prevent giving up to degraded.
  useEffect(() => {
    if (state.uiState !== 'reconnecting') return
    const id = setInterval(() => dispatch({ type: 'RECONNECT_TIMEOUT' }), RECONNECT_CHECK_MS)
    return () => clearInterval(id)
  }, [state.uiState])

  // Transition give-up clause (5 min since transitionStartedAt) — same
  // wall-clock-driven pattern as the reconnecting one above, independent of
  // poll cadence. Only meaningful while transitioningRunKey is actually
  // set; the reducer's own TRANSITION_TIMEOUT case is a no-op otherwise, so
  // this timer is safe to leave running even across an unrelated state
  // change (it'll just keep firing no-ops until transitioningRunKey clears
  // and the effect's dependency re-evaluates to stop it).
  useEffect(() => {
    if (state.transitioningRunKey === null) return
    const id = setInterval(() => dispatch({ type: 'TRANSITION_TIMEOUT' }), TRANSITION_CHECK_MS)
    return () => clearInterval(id)
  }, [state.transitioningRunKey])

  const lastLiveLoadedAt = state.lastLiveFrame?.loadedAt

  // Tick every second so "updated Xs ago" stays live without waiting on a poll.
  useEffect(() => {
    if ((state.uiState !== 'live' && state.uiState !== 'reconnecting') || lastLiveLoadedAt === undefined) return
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.uiState, lastLiveLoadedAt])

  return <LiveViewPresentation state={state} history={history} />
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

function LiveViewPresentation({ state, history }: { state: LiveStatusState; history: HistoryEntry[] }) {
  const { uiState, lastLiveFrame } = state

  // Which StackRun (if any) the guest has tapped in the history strip to
  // browse — lifted all the way up HERE, above the transition-screen/
  // LiveFrameView branch below, rather than living inside LiveFrameView's
  // own local state. This is deliberate, not incidental: LiveFrameView does
  // NOT render at all during a transition (see the transitioningRunKey
  // branch further down) or during any of the terminal screens above it —
  // if this selection lived inside LiveFrameView, tapping a history pill and
  // then having a NEW live stack run start underneath would unmount
  // LiveFrameView and silently lose the selection, yanking the guest back to
  // live. Keeping it here means a live target change underneath never
  // disturbs an active historical browse — only an explicit "Back to Live"
  // tap, tapping the live/active pill again, or the terminal-state effect
  // below ever clears it (see the guardrails this satisfies in the history-
  // pill-browsing feature brief: #10 and #12).
  //
  // A SNAPSHOT of the whole entry (taken at the moment preload succeeds —
  // see handleSelectHistoryRun), not just the id: an earlier version
  // re-derived the selected run by looking it up in the live `history`
  // array on every render, which meant a single malformed/empty
  // /api/status response (server-side history query hiccup — see
  // fetchHistory's own "never fails the caller" doc comment in
  // app/api/status/route.ts, which degrades to an empty array rather than
  // erroring) could make the lookup miss and silently kick the guest back
  // to live mid-browse, even though nothing about their OWN action
  // changed. Storing the snapshot means the displayed image/card is stable
  // regardless of what any single poll's history payload looks like —
  // only an explicit action ever clears it.
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<HistoryEntry | null>(null)

  // Historical browsing only makes sense while the page itself is showing a
  // live/reconnecting view underneath — once we're on a hard terminal or
  // non-live screen (finished, special-event-finished, any offline variant,
  // degraded, or back to checking), there's no live page for "Back to Live"
  // to return the guest TO, so the selection is cleared automatically. A new
  // live StackRun starting is deliberately NOT one of these cases (see the
  // comment above) — only leaving the live/reconnecting family clears it.
  useEffect(() => {
    if (uiState !== 'live' && uiState !== 'reconnecting') {
      setSelectedHistoryRun(null)
    }
  }, [uiState])

  // Feedback for a tap that did NOT result in switching (null blobUrl, or a
  // preload that failed/timed out) — deliberately separate from
  // selectedHistoryRun itself: this is pure UI feedback for a failed
  // interaction, cleared on the next successful/attempted interaction, never
  // something a live target change or terminal-state transition needs to
  // preserve or react to.
  const [historyPreloadError, setHistoryPreloadError] = useState<string | null>(null)
  // Auto-dismiss after a few seconds rather than leaving a stale "no saved
  // image"/"image unavailable" message on screen indefinitely until the
  // guest happens to tap something else — this is transient feedback about
  // ONE tap, not a persistent status the guest needs to keep seeing.
  useEffect(() => {
    if (!historyPreloadError) return
    const timer = setTimeout(() => setHistoryPreloadError(null), 5000)
    return () => clearTimeout(timer)
  }, [historyPreloadError])
  // Guards against a rapid double-tap across two different pills letting a
  // SLOWER, now-stale preload win the race and overwrite a faster, more
  // recent one — same abort-on-supersede discipline the main poll loop uses
  // for its own image preloads (see pollOnce's imageController handling
  // further up this file).
  const historyPreloadControllerRef = useRef<AbortController | null>(null)

  function handleBackToLive() {
    historyPreloadControllerRef.current?.abort()
    setHistoryPreloadError(null)
    setSelectedHistoryRun(null)
    // Returning to live should land the guest back at the top, same as
    // switching TO a history run below — a consistent "the view just
    // changed, start from the image" behavior in both directions.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // The single entry point for every "tap a history pill" interaction,
  // regardless of which screen it happens on (TransitionScreen or
  // LiveFrameView both call this the same way) — lives here, not inside
  // LiveFrameView, specifically so preload-before-switch (guardrail: never
  // show a historical image/card until it has actually loaded) behaves
  // identically whether the guest taps a pill while a transition is
  // showing or while the normal live view is showing. SessionHistoryStrip/
  // HistoryPill's own click handler already decided "select this run"
  // (non-null) vs. "clear the selection" (null — tapping the live/active
  // pill again, or re-tapping the already-selected pill) before calling
  // this, so by the time we're here `run` is either a genuine new
  // selection to preload, or an explicit clear.
  async function handleSelectHistoryRun(run: HistoryEntry | null) {
    if (run === null) {
      handleBackToLive()
      return
    }

    historyPreloadControllerRef.current?.abort()
    const controller = new AbortController()
    historyPreloadControllerRef.current = controller

    if (run.blobUrl === null) {
      setHistoryPreloadError('No saved image for this target.')
      return
    }

    try {
      await preloadImage(run.blobUrl, controller.signal)
      if (controller.signal.aborted) return
      setHistoryPreloadError(null)
      // Snapshot the WHOLE entry at the moment preload succeeds — see
      // selectedHistoryRun's own doc comment above for why this is a
      // snapshot rather than a re-derived lookup against the live history
      // array on every render.
      setSelectedHistoryRun(run)
      // The new object's view should start from the image, same as landing
      // on the page fresh — without this, a guest who scrolled down into
      // the previous object's facts/drawer would switch objects while
      // still scrolled past the image, missing the new photo entirely.
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      if (controller.signal.aborted) return
      setHistoryPreloadError('Image unavailable.')
    }
  }

  // Keeps the snapshot's LIVE-relevant fields (active, endedAt, confidence
  // — anything the strip itself needs to stay current, like whether this
  // pill should still show as the active/live one) in sync with the real
  // history array WHEN a matching entry is actually present in it — but
  // deliberately does NOT clear the selection if the entry is temporarily
  // missing from one poll's history array (a transient/malformed
  // /api/status response — see fetchHistory's own "never fails the
  // caller" doc comment in app/api/status/route.ts, which degrades to []
  // rather than erroring — must not silently kick the guest back to live).
  // A run genuinely scrolling out of the server's bounded history window
  // (HISTORY_MAX_RUNS) behaves the same way: the snapshot just stops
  // refreshing and keeps showing what it last knew, which is the correct,
  // stable behavior for something the guest deliberately chose to look at.
  useEffect(() => {
    if (!selectedHistoryRun) return
    const liveMatch = history.find((run) => run.id === selectedHistoryRun.id)
    if (!liveMatch) return
    const changed =
      liveMatch.active !== selectedHistoryRun.active ||
      liveMatch.endedAt !== selectedHistoryRun.endedAt ||
      liveMatch.confidence !== selectedHistoryRun.confidence
    if (changed) {
      setSelectedHistoryRun(liveMatch)
    }
    // selectedHistoryRun is intentionally excluded from the dependency
    // array — including it would re-run this effect every time IT sets
    // selectedHistoryRun, which is harmless (the `changed` check makes it
    // a no-op on the second pass) but pointless churn. `history` alone is
    // what should actually trigger a re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history])

  if (uiState === 'checking') {
    return <StatusScreen heading="Checking…" loader />
  }

  // Checked early, ahead of degraded/offline/live — matches the reducer's
  // own "wins from any state" handling of POLL_FINISHED (see
  // lib/live-status.ts). Renders its own full-screen farewell scene rather
  // than StatusScreen: FarewellAegeanUfo is a self-contained stage with its
  // own heading/sub/background, so nesting it inside StatusScreen's steady
  // block would duplicate/conflict with that scene rather than complement
  // it. Variant is picked once per event night (seeded on the Athens
  // calendar date from /api/status, NOT per page-load) so every guest phone
  // and the lobby TV show the same closer tonight — see lib/live-farewell.ts
  // for how a 2nd/3rd variant slots into pickFarewellVariant's registry.
  if (uiState === 'finished' && state.finishedInfo) {
    const variant = pickFarewellVariant(state.finishedInfo.date)
    const nextSessionLines = formatNextSessionLines(state.finishedInfo.date, state.finishedInfo.next)
    switch (variant) {
      case 'aegean-ufo':
      default:
        return (
          <FarewellAegeanUfo
            nextSessionLead={nextSessionLines?.lead ?? (state.finishedInfo.next ? null : NO_NEXT_SESSION_LINE)}
            nextSessionSchedule={nextSessionLines?.schedule ?? null}
            nextSessionLogoSrc={nextSessionLines?.logoSrc ?? null}
          />
        )
    }
  }

  // A special event's own finished state — deliberately a separate branch
  // from 'finished' above (see lib/live-status.ts's uiState doc): never the
  // Aegean UFO farewell, just the plain sign-off screen.
  if (uiState === 'special-event-finished') {
    return <SpecialEventFarewell />
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

  // Historical browsing (selectedHistoryRun !== null) OUTRANKS the
  // transition screen below — a guest who tapped a history pill must not be
  // yanked back to "next object incoming" just because the telescope moved
  // on to a new live target while they were looking at an earlier one. Routed
  // through LiveFrameView itself (not a separate branch/component) so the
  // fullscreen/pan-zoom/share-panel machinery there is reused verbatim rather
  // than duplicated — LiveFrameView switches its image+card to the selected
  // historical run internally (see its own selectedHistoryRun handling)
  // while everything else (polling, transition detection, history strip
  // updates) keeps running exactly as it does when not browsing. "Back to
  // Live" (or tapping the live/active pill again) returns the guest to
  // whatever the ACTUAL current live state is at that moment — live,
  // transitioning, or reconnecting — never a frozen snapshot of what live
  // looked like when they started browsing.
  if (selectedHistoryRun !== null) {
    return (
      <LiveFrameView
        uiState={uiState}
        lastLiveFrame={lastLiveFrame}
        history={history}
        selectedHistoryRun={selectedHistoryRun}
        historyPreloadError={historyPreloadError}
        onSelectHistoryRun={handleSelectHistoryRun}
      />
    )
  }

  // State-aware transition (see POLL_RUN_TRANSITIONING/transitioningRunKey
  // in lib/live-status.ts): a new stack run has been detected but no
  // displayable frame for it exists yet. Intercepted HERE, before
  // LiveFrameView, rather than inside it — LiveFrameView unconditionally
  // sets up milestone-toggle fetching/selection state that assumes
  // lastLiveFrame IS the thing currently being shown, and React hooks can't
  // be conditionally skipped once that component starts rendering. Skipping
  // straight to TransitionScreen keeps lastLiveFrame completely untouched
  // underneath (still available for reconnecting/degraded to fall back on
  // if this transition itself times out — see TRANSITION_TIMEOUT) while
  // guaranteeing the OLD image/card can never render for even one frame.
  //
  // Gated on uiState === 'live' as well as transitioningRunKey !== null:
  // TRANSITION_TIMEOUT clears transitioningRunKey and moves uiState to
  // 'reconnecting' together (see the reducer), so in practice these two
  // conditions change atomically — but degraded/offline/finished can also
  // be reached from 'live' via other events without necessarily routing
  // through TRANSITION_TIMEOUT first (e.g. POLL_OFFLINE also clears
  // transitioningRunKey, but belt-and-suspenders here means a future state
  // that reaches this branch with a stale transitioningRunKey still falls
  // through to the normal per-uiState rendering above instead of getting
  // stuck on the transition screen.
  if (uiState === 'live' && state.transitioningRunKey !== null) {
    return (
      <TransitionScreen
        history={history}
        selectedHistoryRunId={null}
        historyPreloadError={historyPreloadError}
        onSelectHistoryRun={handleSelectHistoryRun}
      />
    )
  }

  return (
    <LiveFrameView
      uiState={uiState}
      lastLiveFrame={lastLiveFrame}
      history={history}
      selectedHistoryRun={null}
      historyPreloadError={historyPreloadError}
      onSelectHistoryRun={handleSelectHistoryRun}
    />
  )
}

// Shown in place of the normal circular image + object card while
// transitioningRunKey is set (see LiveViewPresentation above) — deliberately
// NOT the old frame's image, per the feature's whole purpose. Reuses the
// exact .viewer/.sky-square/.rim structure the real live view uses (so the
// page doesn't visually jump/reflow between transition and live), just with
// no <img> at all — .sky-square's own dark background IS the "empty
// telescope frame" the spec asks for — plus the loader and the same
// rotating moving-phrase copy TransitionCopy already uses for the
// 'moving' DisplayObject.kind case (astrometryState-driven), so a guest
// sees the same visual language whether the transition is "new stack run
// detected" or "telescope reports it's slewing."
function TransitionScreen({
  history,
  selectedHistoryRunId,
  historyPreloadError,
  onSelectHistoryRun,
}: {
  history: HistoryEntry[]
  selectedHistoryRunId: string | null
  historyPreloadError: string | null
  onSelectHistoryRun: (run: HistoryEntry | null) => void
}) {
  return (
    <div className="page">
      <header className="topbar" aria-label="Live page status">
        <div className="topbar__live">
          <span className="red-dot reconnecting" aria-hidden="true" />
          <span>NEXT OBJECT INCOMING</span>
        </div>
      </header>

      <section className="viewer viewer--transition" aria-label="Telescope repositioning">
        <div className="sky-square">
          <TelescopeLoader />
        </div>
        <svg className="rim" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="rim-ring outer" cx="50" cy="50" r="48" />
          <circle className="rim-ring" cx="50" cy="50" r="45.9" />
        </svg>
      </section>

      {/* A tap here can fail (null blobUrl, or preload failure/timeout) the
          exact same way it can from LiveFrameView — handleSelectHistoryRun
          in LiveViewPresentation is the SAME entry point regardless of
          which screen the tap happened on (see its own doc comment). Without
          rendering this here too, a failed tap on THIS screen would fail
          completely silently — the error state would be set, but nothing
          on screen would ever show it, since selectedHistoryRun stays null
          and the render stays on TransitionScreen. Mirrors LiveFrameView's
          own historyPreloadError rendering exactly. */}
      {historyPreloadError && (
        <p className="history-preload-error" role="status">
          {historyPreloadError}
        </p>
      )}

      {/* History keeps updating during transition (see /api/status's history
          field, refreshed on every poll regardless of transitioningRunKey) —
          the new active run shows up as SessionHistoryStrip's own neutral
          "…" settling pill (isDisplayableRun is false until a StackRun gets
          a confident object match), which is exactly the guest-facing signal
          that a new run is underway even before its frame is ready to show.
          Pills stay tappable here too — selectedHistoryRunId is always null
          on THIS screen (LiveViewPresentation routes to LiveFrameView's
          historical view instead once a selection exists), but a tap here
          still needs to fire onSelectHistoryRun so the NEXT render picks up
          the selection and switches away from this screen. */}
      <SessionHistoryStrip
        history={history}
        selectedHistoryRunId={selectedHistoryRunId}
        onSelectHistoryRun={onSelectHistoryRun}
      />

      <div className="content" aria-live="polite">
        <TransitionCopy mainPhrases={MOVING_PHRASES} />
      </div>
    </div>
  )
}

// The object-name heading (.title) must always fit on ONE line rather than
// wrapping ("Hercules Globular Cluster" at .title's normal clamp() size
// wraps to two lines on a 375px phone, which reads as broken for what's
// meant to be a single confident display line) or dominating (shrinking
// every name down to the shortest one's size loses the impact a short name
// like "M13" should have). CSS alone can't do length-aware sizing — clamp()
// scales with VIEWPORT width, not with how long THIS particular string is —
// so this measures the actual rendered width against the container and
// steps the font-size down only as far as needed for the specific text
// currently showing.
//
// MIN_TITLE_FONT_PX is a hard floor: below this, text becomes harder to
// read than it is worth avoiding a wrap, so anything that would need to
// shrink further is simply allowed to wrap onto two lines instead (undoing
// text-wrap:balance's single-line assumption below the floor, but two
// readable lines beats one illegibly-tiny one).
const MAX_TITLE_FONT_PX = 56 // matches .title's own clamp() ceiling in styles.css
const MIN_TITLE_FONT_PX = 24
const TITLE_FONT_STEP_PX = 2

function useShrinkTitleToFit(text: string): { ref: React.RefObject<HTMLHeadingElement>; fontSize: number | null } {
  const ref = useRef<HTMLHeadingElement | null>(null)
  // null = "use the CSS clamp() default," not yet measured OR measurement
  // determined the default already fits. Only set to a NUMBER when the
  // text needed to shrink below the default to fit on one line.
  const [fontSize, setFontSize] = useState<number | null>(null)

  // useLayoutEffect (not useEffect): this must resolve the final size
  // BEFORE the browser paints, or the guest would see one frame at full
  // size wrapped onto two lines, then a visible snap down to the fitted
  // size — exactly the "jarring jump" this whole feature is trying to
  // avoid elsewhere on this page.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // .title has no fixed height/overflow:hidden, so clientHeight and
    // scrollHeight are ALWAYS equal regardless of how many lines the text
    // wraps to — comparing them can never detect wrapping (an earlier
    // version of this hook tried that and it silently never fit anything,
    // shrinking every title straight to the floor). The reliable test is
    // WIDTH: force single-line rendering (white-space:nowrap overrides
    // text-wrap:balance's line-splitting for the duration of this
    // measurement only) and compare the text's natural single-line width
    // (scrollWidth) against the space actually available (clientWidth) —
    // exactly "would this fit on one line," which is the real question.
    el.style.whiteSpace = 'nowrap'
    // Reset to the CSS default first — re-measuring against a PREVIOUS
    // shrink (from the last object's longer name) would only ever find
    // "yes it still fits," never let the size grow back up for a shorter
    // new name.
    el.style.fontSize = ''

    if (el.scrollWidth <= el.clientWidth + 1) {
      // Fits already at the default clamp() size — nothing to do.
      el.style.whiteSpace = ''
      setFontSize(null)
      return
    }

    let size = MAX_TITLE_FONT_PX
    while (size > MIN_TITLE_FONT_PX) {
      size -= TITLE_FONT_STEP_PX
      el.style.fontSize = `${size}px`
      if (el.scrollWidth <= el.clientWidth + 1) break
    }
    // Restore normal wrapping either way: at the floor, text-wrap:balance
    // takes back over and the text wraps to two readable lines instead of
    // staying forced onto one illegibly-narrow line; once fitted above the
    // floor, normal wrapping is simply a no-op since the text now fits.
    el.style.whiteSpace = ''
    setFontSize(size)
  }, [text])

  return { ref, fontSize }
}

// Split out so it (and its fullscreenMode state) only mounts once we
// actually have a frame to show — the circular FOV view is the pretty
// default view; fullscreen swaps to the full square image, maximized, with
// the circular framing dropped entirely (see the fullscreen wiring below).
function LiveFrameView({
  uiState,
  lastLiveFrame,
  history,
  selectedHistoryRun,
  historyPreloadError,
  onSelectHistoryRun,
}: {
  uiState: LiveStatusState['uiState']
  lastLiveFrame: NonNullable<LiveStatusState['lastLiveFrame']>
  history: HistoryEntry[]
  selectedHistoryRun: HistoryEntry | null
  historyPreloadError: string | null
  onSelectHistoryRun: (run: HistoryEntry | null) => void
}) {
  // 'off': normal circular view. 'native': the real Fullscreen API is active
  // (Android/desktop — unaffected by this change). 'css-fallback': a fixed
  // full-viewport overlay standing in for fullscreen where the API doesn't
  // exist at all — namely iOS Safari, which only allows native fullscreen on
  // <video> elements (Apple's restriction, not a bug we can work around) and
  // exposes neither document.fullscreenEnabled nor element.requestFullscreen
  // for anything else. See supportsNativeFullscreen()/handleToggleFullscreen
  // below for the feature-detection (never user-agent sniffing).
  const [fullscreenMode, setFullscreenMode] = useState<'off' | 'native' | 'css-fallback'>('off')
  // Scroll target for EnrichedCard's drawer-close scroll (see EnrichedCard) —
  // closing the drawer scrolls back up to reveal the image, not all the way
  // to the page top (the LIVE/updated status bar doesn't need to be back in
  // view). Threaded down as a plain ref rather than reached via
  // document.querySelector, matching this file's existing ref-based
  // conventions elsewhere.
  const viewerRef = useRef<HTMLElement>(null)
  const [milestoneSelection, setMilestoneSelection] = useState<MilestoneKey>('current')
  // Demo mode is purely local synthetic data (see getDemoStatusBody) — never
  // fetch real milestone data for a fake observationId in that case.
  const isDemo = getDemoMode() !== null
  const { marks: milestoneMarks, runKey: milestoneRunKey } = useMilestoneFrames(
    isDemo ? null : lastLiveFrame.source,
    isDemo ? null : lastLiveFrame.observationId,
    uiState === 'live' || uiState === 'reconnecting',
  )
  // Resets to 'current' whenever the resolved run identity changes — see
  // computeRunKey's doc for why this must be source+observationId+
  // stackRunStartedAt, not observationId alone: a same-observation stack
  // restart (the common case in production, since one Observation row spans
  // a whole session) or an active-source switch must ALSO force the guest
  // back to the live frame, not just an outright target change. Keyed off
  // milestoneRunKey (the hook's own resolved state, updated only once a
  // fetch confirms the new identity) rather than the raw props directly, so
  // this fires in lockstep with marks actually being cleared/repopulated —
  // avoiding a render where the OLD selection is still applied against the
  // NEW marks for even one frame.
  useEffect(() => {
    setMilestoneSelection('current')
  }, [milestoneRunKey])

  // History browsing and milestone browsing must never disagree — a guest
  // returning to live after browsing history should land on the ACTUAL
  // live frame, never a milestone selection left over from before they
  // started browsing. selectedHistoryRun/historyPreloadError/
  // onSelectHistoryRun are all owned by LiveViewPresentation (see its own
  // doc comments) — lifted up there rather than living here so preload-
  // before-switch behaves identically whether a pill tap happens on THIS
  // screen or on TransitionScreen, which LiveFrameView has no reach into.
  useEffect(() => {
    if (selectedHistoryRun) {
      setMilestoneSelection('current')
    }
  }, [selectedHistoryRun])

  useEffect(() => {
    function onFullscreenChange() {
      // Only the NATIVE path fires this browser event; the CSS fallback has
      // no browser-level fullscreen state to listen for; its own toggle
      // handler sets fullscreenMode directly. Guard so a native
      // fullscreenchange (e.g. the user pressing Esc) can't stomp on an
      // active css-fallback session that it has nothing to do with.
      if (document.fullscreenElement != null) {
        setFullscreenMode('native')
      } else {
        setFullscreenMode((current) => (current === 'native' ? 'off' : current))
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Body-scroll lock for the CSS fallback only — native fullscreen already
  // suspends the page's own scroll (the browser replaces the whole viewport
  // with the fullscreen element), so locking here too would be redundant.
  // The CSS fallback instead renders an overlay ON TOP of the still-present
  // scrollable page, so without this, a background scroll/iOS rubber-band
  // bounce would be visible/possible behind the "fullscreen" overlay.
  useEffect(() => {
    if (fullscreenMode !== 'css-fallback') return
    const { body } = document
    const previousOverflow = body.style.overflow
    const previousPosition = body.style.position
    const previousWidth = body.style.width
    const previousTop = body.style.top
    const scrollY = window.scrollY
    body.style.overflow = 'hidden'
    // position:fixed (not just overflow:hidden) is what actually stops iOS
    // Safari's rubber-band bounce — overflow:hidden alone still lets the
    // page rubber-band on iOS. Pinning the scroll offset via top + restoring
    // it on cleanup keeps the guest's place in the page across the toggle.
    body.style.position = 'fixed'
    body.style.width = '100%'
    body.style.top = `-${scrollY}px`
    return () => {
      body.style.overflow = previousOverflow
      body.style.position = previousPosition
      body.style.width = previousWidth
      body.style.top = previousTop
      window.scrollTo(0, scrollY)
    }
  }, [fullscreenMode])

  function handleToggleFullscreen() {
    if (fullscreenMode === 'native') {
      document.exitFullscreen().catch(() => {})
      return
    }
    if (fullscreenMode === 'css-fallback') {
      setFullscreenMode('off')
      return
    }
    if (supportsNativeFullscreen()) {
      document.documentElement.requestFullscreen().catch(() => {})
      // fullscreenMode itself is set by the fullscreenchange listener above
      // once the browser actually grants it, not optimistically here — if
      // the promise rejects (e.g. blocked by a permissions policy), the
      // listener simply never fires and the view correctly stays 'off'.
    } else {
      setFullscreenMode('css-fallback')
    }
  }

  // Which frame is actually shown: 'current' is always the live frame; any
  // other selection shows that milestone's stored frame IF it's still
  // available — a milestone frame can become unavailable mid-view (e.g. the
  // target changed and milestoneMarks hasn't refetched yet for the new
  // observation), in which case this falls back to 'current' rather than
  // rendering a broken/stale image src. Computed once, above BOTH the
  // fullscreen and normal render paths, so a guest who opens fullscreen
  // while viewing a milestone frame sees that same frame maximized, not a
  // silent swap back to the live feed.
  const selectedMilestoneFrame =
    milestoneSelection === 'first'
      ? milestoneMarks?.first
      : milestoneSelection === 'twoMin'
        ? milestoneMarks?.twoMin
        : milestoneSelection === 'fiveMin'
          ? milestoneMarks?.fiveMin
          : undefined
  const viewingMilestone = milestoneSelection !== 'current' && selectedMilestoneFrame != null
  // A selected HISTORY run (a different object entirely) always outranks a
  // milestone selection (a different stack depth of the SAME live object) —
  // the two are mutually exclusive by construction anyway (selecting a
  // history run resets milestoneSelection to 'current', see
  // handleSelectHistoryRun above, and the milestone toggle itself is hidden
  // entirely while browsing history, see its render guard below), but the
  // ?. chain here is belt-and-suspenders against relying on that ordering.
  const viewingHistorical = selectedHistoryRun != null || viewingMilestone
  const displaySrc =
    selectedHistoryRun?.blobUrl ?? (viewingMilestone ? selectedMilestoneFrame.blobUrl : lastLiveFrame.blobUrl)
  // The object CARD content, not just the image: a history run is a
  // different object, so unlike the milestone case (same object, earlier
  // stack depth — see selectedMilestoneFrame above, which only ever swaps
  // the image), browsing history must also swap what ObjectTypeLine/Facts/
  // ObjectDescription/the heading render. displayObjectForHistoryRun (see
  // its own doc comment) is what supplies real catalog content when
  // possible, falling back to a safe minimal card otherwise.
  const effectiveDisplayObject = selectedHistoryRun
    ? displayObjectForHistoryRun(selectedHistoryRun)
    : lastLiveFrame.displayObject

  // Identity key for whichever object is CURRENTLY displayed — a history
  // run's own StackRun id when browsing, otherwise the live frame's run
  // key (computeRunKey — the same source+observationId+stackRunStartedAt
  // identity state-aware-transition already uses elsewhere in this file).
  // Passed as ObjectDescription's own key below so EnrichedCard fully
  // remounts (drawer's local `open` state resets to false) whenever the
  // DISPLAYED object actually changes — a live target transitioning to a
  // new StackRun, or the guest tapping a different history pill — rather
  // than leaving a guest's open drawer showing stale content, or worse,
  // content that no longer matches the object now on screen. A same-object
  // frame update (same run key) does NOT change this string, so the drawer
  // correctly stays open/untouched across ordinary polling.
  const effectiveObjectKey = selectedHistoryRun
    ? `history:${selectedHistoryRun.id}`
    : computeRunKey(lastLiveFrame.source, lastLiveFrame.observationId, lastLiveFrame.stackRunStartedAt)

  // The heading's actual content AND a flat-text version of the same,
  // computed together so useShrinkTitleToFit (called right below, BEFORE
  // any early return — hooks can't be conditional) has a plain string to
  // key its measurement effect on. The split (title-id + title-sub) vs.
  // plain forms render identically in terms of total visible text, so a
  // single joined string is enough for the "did the text change, should we
  // re-measure" check even though the split form renders as two separate
  // spans.
  let titleContent: React.ReactNode
  let titlePlainText: string
  if (effectiveDisplayObject.kind === 'known') {
    const { lead, sub } = headingParts(effectiveDisplayObject.name, effectiveDisplayObject.type)
    if (sub) {
      titleContent = (
        <>
          <span className="title-id">{lead}</span>
          <span className="title-sub">{sub}</span>
        </>
      )
      titlePlainText = `${lead}, ${sub}`
    } else {
      titleContent = lead
      titlePlainText = lead
    }
  } else {
    const label = objectLabel(effectiveDisplayObject)
    titleContent = label
    titlePlainText = label
  }
  const { ref: titleRef, fontSize: titleFontSize } = useShrinkTitleToFit(titlePlainText)

  if (fullscreenMode !== 'off') {
    return (
      <div className="live-root live-root--fullscreen">
        <button
          type="button"
          className="fullscreen-button fullscreen-exit-button"
          onClick={handleToggleFullscreen}
          aria-label="Exit fullscreen"
        >
          ⤢
        </button>
        {/* object-fit: contain — the WHOLE square frame stays visible,
            maximized within the viewport. No circular mask, no rim text:
            fullscreen is the see-everything-in-detail mode, not the eyepiece
            aesthetic (that's the default circular view). Pinch-to-zoom/pan
            is scoped entirely to this image (see PannableZoomImage) — the
            exit button and page chrome are outside it and never affected.
            Identical markup for BOTH native and css-fallback modes — the
            only difference between them is how fullscreenMode gets set/
            cleared (a real browser API vs. plain React state), not how this
            is rendered, so the zoomable-image experience is exactly the
            same either way. displaySrc/effectiveDisplayObject (not always
            lastLiveFrame's own) so fullscreen respects whichever milestone
            frame OR history run is selected. */}
        <PannableZoomImage src={displaySrc} alt={objectLabel(effectiveDisplayObject)} />
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
          {/* Two-line structure, ALWAYS (line 2 just renders empty/absent
              when not browsing) — line 1 is status/badge, line 2 is
              reserved for Back to Live. Phone testing found that rendering
              Back to Live INLINE beside the badge on a single flex-wrap row
              (an earlier version of this header) made the topbar's height
              jump between live and browsing mode, reading as a layout
              shift/scroll rather than a deliberate mode change. Splitting
              into two literal rows — the second only populated while
              browsing — keeps the topbar's shape predictable regardless of
              which state is showing. */}
          <div className="topbar__live">
            {selectedHistoryRun ? (
              // Browsing a history-strip pill: an UNMISSABLE, unambiguous
              // "not live" state — a different object entirely, not just an
              // earlier stack depth of the current one (contrast the
              // milestone case below), so this gets its own explicit label
              // naming WHICH object. Uses the SAME short label the pill
              // itself shows (shortHistoryLabel) rather than the full
              // catalog name — "VIEWING NORTH AMERICA NEBULA · NOT LIVE" on
              // a 375px screen risks wrapping/pushing layout, and the short
              // form also means the badge always visually matches whatever
              // the guest just tapped. objectId is guaranteed non-null here:
              // SessionHistoryStrip only ever renders a TAPPABLE pill for a
              // run that already passed isDisplayableRun's objectId!==null
              // gate (see that function's own doc comment).
              <span className="viewing-earlier-badge">
                VIEWING {shortHistoryLabel(selectedHistoryRun.objectId!, selectedHistoryRun.objectName).toUpperCase()} · NOT
                LIVE
              </span>
            ) : !viewingHistorical ? (
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
              // Viewing a milestone frame (First/2min/5min): the red pulse
              // turns OFF and this label makes it unmistakable that this is
              // NOT the live view, so a guest never mistakes a frozen earlier
              // frame for the current feed.
              <span className="viewing-earlier-badge">VIEWING AN EARLIER FRAME · NOT LIVE</span>
            )}
          </div>
          {/* Always rendered (not conditionally mounted) so the grid-rows
              CSS transition (see .topbar__actions in styles.css) has stable
              content to animate open/closed around, rather than the button
              itself popping in and out of the DOM — --open toggles the row
              between collapsed (0fr, normal live view — no permanent empty
              gap) and expanded (1fr, browsing), animated rather than
              snapping instantly either way. */}
          <div className={`topbar__actions${selectedHistoryRun ? ' topbar__actions--open' : ''}`}>
            <button
              type="button"
              className="back-to-live-button"
              tabIndex={selectedHistoryRun ? 0 : -1}
              aria-hidden={selectedHistoryRun ? undefined : true}
              onClick={() => onSelectHistoryRun(null)}
            >
              Back to Live
            </button>
          </div>
        </header>

        <section className="viewer" aria-label="Live telescope image" ref={viewerRef}>
          <div className="sky-square">
            {/* eslint-disable-next-line @next/next/no-img-element -- external Vercel Blob URL, no next/image domain config for v1 */}
            <img
              src={displaySrc}
              alt={objectLabel(effectiveDisplayObject)}
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
                STARGAZING.WORLD
              </textPath>
            </text>
          </svg>

          <button
            type="button"
            className="fullscreen-button viewer-fullscreen-button"
            onClick={handleToggleFullscreen}
            aria-label="Toggle fullscreen"
          >
            ⛶
          </button>
        </section>

        {/* Milestone selection and history-run selection must never stack —
            see handleSelectHistoryRun's own reasoning above. Hiding the
            toggle entirely (not just disabling it) while browsing history
            is the other half of that guarantee: there is nothing for a
            guest to tap here that would leave the two selections
            disagreeing once they return to live. */}
        {!selectedHistoryRun && (
          <MilestoneToggle
            marks={milestoneMarks}
            selection={milestoneSelection}
            onSelect={setMilestoneSelection}
          />
        )}

        {historyPreloadError && (
          <p className="history-preload-error" role="status">
            {historyPreloadError}
          </p>
        )}

        <SessionHistoryStrip
          history={history}
          selectedHistoryRunId={selectedHistoryRun?.id ?? null}
          onSelectHistoryRun={onSelectHistoryRun}
        />

        <section
          className="content"
          aria-live="polite"
          style={contentTypeColorVars(effectiveDisplayObject) as React.CSSProperties}
        >
          {/* Object name is the topmost element in the content block.
              "Gathered light" now lives only in the topbar (next to
              LIVE/updated) — showing it twice on one screen was redundant,
              see git history for the removed .integration line.
              Split via headingParts (not objectLabel's plain name) when
              kind==='known': a Messier object with a real name heads here as
              "M13" + "Hercules" (the id small/muted, the name large — see
              .title-id/.title-sub below), a bare Messier id as "Messier 4"
              alone — see headingParts' own doc comment for why this differs
              from objectLabel's (untrimmed) alt-text use.
              Auto-shrunk to fit one line via useShrinkTitleToFit (see its
              own doc comment) — titleFontSize is null (use the CSS default)
              unless this specific text needed to shrink below it. */}
          <h1 className="title" ref={titleRef} style={titleFontSize ? { fontSize: `${titleFontSize}px` } : undefined}>
            {titleContent}
          </h1>

          <ObjectTypeLine displayObject={effectiveDisplayObject} />

          <Facts displayObject={effectiveDisplayObject} />

          <div className="description">
            <ObjectDescription key={effectiveObjectKey} displayObject={effectiveDisplayObject} />
          </div>
        </section>

        {SHOW_SHARE_PANEL && <SharePanel displayObject={effectiveDisplayObject} />}
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

// Sets --object-type-border/--object-type-bg-subtle ONCE on .content (the
// shared ancestor of both Facts and the enriched-card/.description block —
// see .fact and .live-object-desc in styles.css, which now just consume
// these vars as-is rather than each computing their own color-mix()). This
// is what makes the chips and the enriched card match BY CONSTRUCTION: one
// computation, one pair of variables, two consumers — not three independent
// hardcoded color-mix() percentages that could silently drift apart if only
// one component's CSS is edited later. The type pill deliberately stays
// OUTSIDE this shared set (own --type-color, own stronger 55%/13% mix) —
// it's meant to read as more vivid than chips/card, not part of the same
// family. 'moving'/'fallback' have no confirmed catalog type to tint by, so
// they fall back to the same neutral FALLBACK_PILL_COLOR the fallback type
// pill uses rather than an arbitrary/wrong hue.
function contentTypeColorVars(displayObject: DisplayObject): Record<string, string> {
  const color = displayObject.kind === 'known' ? typeColor(displayObject.type) : FALLBACK_PILL_COLOR
  return {
    '--object-type-border': `color-mix(in srgb, ${color} 21%, rgba(237, 234, 227, 0.085))`,
    '--object-type-bg-subtle': `color-mix(in srgb, ${color} 6%, rgba(237, 234, 227, 0.043))`,
    // .fact span's label tint (pre-existing, unrelated to this refactor)
    // still reads --type-color directly, so it stays available too.
    '--type-color': color,
  }
}

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
  // Always shows icon + full type label — the redundancy this used to guard
  // against (e.g. "Hercules Globular Cluster" heading + "Globular Cluster"
  // pill both saying the type) is now resolved on the HEADING side instead
  // (see objectLabel's own trim), so the type pill can stay a single,
  // uniform shape for every object rather than silently dropping its label
  // for some.
  return (
    <div className="type-line">
      <div className="type-pill" style={{ '--type-color': color } as React.CSSProperties}>
        <span className="type-icon" aria-hidden="true">
          <TypeIcon type={displayObject.type} />
        </span>
        <span className="type-pill-label">{displayObject.type}</span>
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
  // --object-type-border/--object-type-bg-subtle/--type-color all come from
  // .content now (see contentTypeColorVars) — .fact just consumes them, no
  // lookup of its own, so it can never drift from the enriched card's tint.
  return (
    <div className="facts" aria-label="Object information">
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

// Stacking-progression toggle — backed by real frame data from
// /api/observations/[id]/milestones (see useMilestoneFrames above). A mark
// button is disabled whenever its frame isn't available: the observation
// hasn't reached that mark yet, milestoneMarks hasn't loaded, or (a short
// stack that ends before 5min, say) it will never be reached — all three
// look identical to a guest (a disabled button), which is the correct
// behavior per product guidance: never show a broken/empty/mislabeled frame.
function MilestoneToggle({
  marks,
  selection,
  onSelect,
}: {
  marks: MilestoneMarks | null
  selection: MilestoneKey
  onSelect: (key: MilestoneKey) => void
}) {
  const options: { key: MilestoneKey; label: string; available: boolean }[] = [
    { key: 'first', label: 'First', available: marks?.first != null },
    { key: 'twoMin', label: '2 min', available: marks?.twoMin != null },
    { key: 'fiveMin', label: '5 min', available: marks?.fiveMin != null },
    { key: 'current', label: 'Current View', available: true },
  ]
  return (
    <div className="snapshot-toggle" role="group" aria-label="Compare stack age">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className="snap"
          aria-pressed={selection === opt.key}
          disabled={!opt.available}
          onClick={() => opt.available && onSelect(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Tonight's session-history strip — "here's what's been observed tonight,"
// informational only (no tap interaction, no frame preview yet — see the
// StackRun/history feature brief). Sits directly below the milestone
// toggle and above the object name: both are compact horizontal context
// rows describing "what am I looking at / when in its stack" and "what
// came before this," grouped together as one context zone between the
// image and the full object-info section.
//
// Display rules (deliberately stricter than "objectId !== null"): only
// high/medium confidence runs get a named pill — low/none confidence is
// never shown as a name, because a wrong-looking name is worse than no
// pill at all for a premium guest experience. The one exception is the
// CURRENTLY ACTIVE run: if it is NOT displayable as a named pill — either
// no identity at all (objectId === null) OR an identity that only cleared
// low/none confidence — show a single neutral "settling" pill instead, so
// the strip doesn't just vanish the instant the telescope slews to a new
// target or lands on a weak/ambiguous match. That's the one moment guests
// actively want confirmation "something changed, hang on." (A non-active
// run failing to clear high/medium is different: that target's window has
// closed, so it's simply omitted — only the CURRENT in-progress run gets
// the settling treatment.) Old unresolved runs (never confidently
// identified before the NEXT run started) are omitted entirely rather than
// cluttering the strip with failed transitions.
const HISTORY_CONFIDENT_TIERS = new Set(['high', 'medium'])
function isDisplayableRun(run: HistoryEntry): boolean {
  return run.objectId !== null && HISTORY_CONFIDENT_TIERS.has(run.confidence ?? '')
}

// A catalog id like "M13"/"M27" is already the natural pill label — short,
// recognizable, exactly what's printed on a star chart. Real catalog ids top
// out at 7 characters ("NGC7000") except for a handful of hyphenated/multi-
// number ones ("NGC6960-6992", "NGC869-884", "LEO-TRIPLET", each 10-12
// chars) that run long enough to force equal-width pills into an illegibly
// narrow slice once there are 5+ objects. IDs at or under
// HISTORY_LABEL_ID_FITS_CHARS stay exactly as printed — "NGC7000" is left
// alone, not swapped for "North" just because "North" is shorter; a
// technically-shorter but less recognizable label is not an improvement.
// Only IDs past that length get the name-based shortening: the object's own
// primaryName, first word only ("Veil Nebula" -> "Veil", "Leo Triplet" ->
// "Leo") since the pill's type icon right next to the label already implies
// "Nebula"/"Cluster"/"Galaxy" etc. If even that first word is still long,
// it's hard-truncated with an ellipsis as a last resort. The full id/name/
// type always still goes in title/aria-label — this only ever shortens the
// VISIBLE label.
const HISTORY_LABEL_ID_FITS_CHARS = 7
const HISTORY_LABEL_MAX_CHARS = 8

function shortHistoryLabel(objectId: string, objectName: string | null): string {
  if (objectId.length <= HISTORY_LABEL_ID_FITS_CHARS) return objectId
  if (!objectName) return objectId

  const firstWord = objectName.split(' ')[0]
  if (firstWord.length <= HISTORY_LABEL_MAX_CHARS) return firstWord
  return `${firstWord.slice(0, HISTORY_LABEL_MAX_CHARS)}…`
}

function HistoryPill({
  run,
  selectedHistoryRunId,
  onSelectHistoryRun,
}: {
  run: HistoryEntry
  selectedHistoryRunId: string | null
  onSelectHistoryRun: (run: HistoryEntry | null) => void
}) {
  const isSettling = !isDisplayableRun(run)
  const isSelected = run.id === selectedHistoryRunId
  // A pill with no saved image is still tappable (so the guest gets real
  // feedback — "no saved image for this target" — rather than a pill that
  // silently does nothing and reads as broken), just visually muted to hint
  // it's a lesser case than a normal completed pill. Only the unresolved
  // "…" settling pill is truly non-interactive: there is no run identity
  // yet for it to select.
  const hasNoImage = !isSettling && run.blobUrl === null
  const label = isSettling ? '…' : shortHistoryLabel(run.objectId!, run.objectName)
  const title = isSettling
    ? 'Telescope is settling on a new target'
    : [run.objectId, run.objectName, run.objectType].filter(Boolean).join(', ')
  // aria-current marks the LIVE/active run — but only when nothing is
  // currently selected for historical browsing, since aria-current and
  // aria-pressed both being true on two different pills at once would be a
  // confusing, self-contradictory state for assistive tech. aria-pressed
  // marks the run the guest explicitly selected to browse, independent of
  // which run is live.
  const ariaCurrent = run.active && selectedHistoryRunId === null ? 'true' : undefined
  const ariaLabel = isSettling
    ? title
    : run.active
      ? selectedHistoryRunId === null
        ? title
        : `Back to live: ${title}`
      : `View earlier target ${title}, not live`
  const colorVars = isSettling
    ? undefined
    : ({
        '--object-type-border': `color-mix(in srgb, ${typeColor(run.objectType ?? '')} 21%, rgba(237, 234, 227, 0.085))`,
        '--object-type-bg-subtle': `color-mix(in srgb, ${typeColor(run.objectType ?? '')} 6%, rgba(237, 234, 227, 0.043))`,
        '--type-color': typeColor(run.objectType ?? ''),
      } as React.CSSProperties)

  function handleClick() {
    // Tapping the live/active pill — REGARDLESS of whether anything is
    // currently selected — always means "go to/stay at live," never
    // "select this as a historical run." Without the unconditional
    // run.active check here, tapping the active pill while NOTHING was
    // selected (the ordinary case: a guest just taps their own current
    // live target) fell through to the `else` branch below and incorrectly
    // entered historical-browsing mode on the guest's own live frame —
    // "VIEWING M13 · NOT LIVE" for the very object that IS live. Re-tapping
    // the already-selected pill is the other "go back to live" case. Any
    // OTHER completed pill means "select this run" (the actual
    // preload+switch happens in the caller).
    if (isSelected || run.active) {
      onSelectHistoryRun(null)
    } else {
      onSelectHistoryRun(run)
    }
  }

  return (
    // role="listitem" lives on this wrapper, NOT the button — aria-pressed/
    // aria-current aren't valid on an element with role="listitem" (the
    // button needs its own native interactive semantics, uncontested by the
    // list-item role it used to carry back when this was a plain <div>).
    <div role="listitem">
      <button
        type="button"
        className={`history-pill${run.active ? ' is-active' : ''}${isSettling ? ' is-unresolved' : ''}${hasNoImage ? ' history-pill--no-image' : ''}${isSelected ? ' is-selected' : ''}`}
        style={colorVars}
        title={title}
        aria-label={ariaLabel}
        aria-current={ariaCurrent}
        aria-pressed={isSelected}
        disabled={isSettling}
        onClick={handleClick}
      >
        {/* Live indicator — ALWAYS shown on the active/live run, regardless
            of whether the guest is currently browsing a different run
            (selectedHistoryRunId !== null): this is "where live is," not
            "what's selected," so it must stay visible as an anchor point
            while browsing, not just when nothing is selected. The selected
            historical pill (is-selected) never gets this dot even if it
            happens to also be run.active — see isSelected's own check
            above, which already prevents a pill from being both active AND
            selected at once (tapping the active pill always clears the
            selection instead, see handleClick). Same red-dot class/pulse
            the topbar LIVE indicator uses (see .red-dot in styles.css) so
            "red dot = live" reads as one consistent visual language across
            the whole page, not a new symbol to learn. */}
        {run.active && <span className="red-dot history-pill-dot" aria-hidden="true" />}
        {!isSettling && (
          <span className="history-pill-icon" aria-hidden="true">
            <TypeIcon type={run.objectType ?? ''} />
          </span>
        )}
        <span className="history-pill-label">{label}</span>
      </button>
    </div>
  )
}

// More than HISTORY_ROW_MAX objects wraps to a second row rather than
// horizontal scroll or shrinking pills further — every pill stays fully
// visible and its label stays readable, at the cost of a second short row.
// The bottom row shares the SAME width as the top row (.history-strip-rows)
// with its own flex:1 1 0 pills dividing it evenly — see .history-strip in
// styles.css.
//
// 4, not 5: at narrow phone widths (375px), 5 equal-width pills per row
// left no room for a 7-character id like "NGC7000" to render in full — it
// had to CSS-ellipsis to "N…", which read as broken/truncated rather than
// a deliberate design choice. Dropping to 4 gives each pill enough width
// for the longest real catalog ids to render in full at 375px (verified —
// see the ?demo=history-test screenshot this was checked against).
const HISTORY_ROW_MAX = 4

function SessionHistoryStrip({
  history,
  selectedHistoryRunId,
  onSelectHistoryRun,
}: {
  history: HistoryEntry[]
  selectedHistoryRunId: string | null
  onSelectHistoryRun: (run: HistoryEntry | null) => void
}) {
  if (history.length === 0) return null

  const visible = history.filter((run) => isDisplayableRun(run) || (run.active && !isDisplayableRun(run)))
  if (visible.length === 0) return null

  if (visible.length <= HISTORY_ROW_MAX) {
    return (
      <div className="history-strip" role="list" aria-label="Tonight's observed objects">
        {visible.map((run) => (
          <HistoryPill
            key={run.id}
            run={run}
            selectedHistoryRunId={selectedHistoryRunId}
            onSelectHistoryRun={onSelectHistoryRun}
          />
        ))}
      </div>
    )
  }

  const topRow = visible.slice(0, HISTORY_ROW_MAX)
  const bottomRow = visible.slice(HISTORY_ROW_MAX)
  return (
    <div className="history-strip-rows" role="list" aria-label="Tonight's observed objects">
      <div className="history-strip">
        {topRow.map((run) => (
          <HistoryPill
            key={run.id}
            run={run}
            selectedHistoryRunId={selectedHistoryRunId}
            onSelectHistoryRun={onSelectHistoryRun}
          />
        ))}
      </div>
      <div className="history-strip history-strip--bottom-row">
        {bottomRow.map((run) => (
          <HistoryPill
            key={run.id}
            run={run}
            selectedHistoryRunId={selectedHistoryRunId}
            onSelectHistoryRun={onSelectHistoryRun}
          />
        ))}
      </div>
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
    // Deliberately much denser/more numerous points than Open Cluster above
    // — a star cloud isn't a handful of bound stars, it's an unresolved
    // crowd of thousands of unrelated background stars (see the doc comment
    // on 'Star Cloud' in lib/object-types.ts), so the glyph itself should
    // read as "field," not "group."
    case 'Star Cloud':
      return (
        <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
          <circle cx="32" cy="32" r="26" fill="#0c0f16" />
          <circle cx="20" cy="18" r="1.1" fill="#f3ecd8" />
          <circle cx="27" cy="14" r="0.8" fill="#e8d9b0" />
          <circle cx="34" cy="17" r="1.3" fill="#f3ecd8" />
          <circle cx="42" cy="14" r="0.9" fill="#e8d9b0" />
          <circle cx="46" cy="22" r="1.2" fill="#f3ecd8" />
          <circle cx="18" cy="27" r="0.9" fill="#e8d9b0" />
          <circle cx="25" cy="24" r="1" fill="#f3ecd8" />
          <circle cx="32" cy="26" r="0.8" fill="#e8d9b0" />
          <circle cx="39" cy="28" r="1.1" fill="#f3ecd8" />
          <circle cx="47" cy="32" r="0.9" fill="#e8d9b0" />
          <circle cx="16" cy="36" r="1.2" fill="#f3ecd8" />
          <circle cx="22" cy="34" r="0.8" fill="#e8d9b0" />
          <circle cx="29" cy="37" r="1" fill="#f3ecd8" />
          <circle cx="36" cy="35" r="0.9" fill="#e8d9b0" />
          <circle cx="43" cy="40" r="1.1" fill="#f3ecd8" />
          <circle cx="20" cy="44" r="0.9" fill="#e8d9b0" />
          <circle cx="27" cy="46" r="1.2" fill="#f3ecd8" />
          <circle cx="34" cy="44" r="0.8" fill="#e8d9b0" />
          <circle cx="41" cy="47" r="1" fill="#f3ecd8" />
          <circle cx="46" cy="42" r="0.8" fill="#e8d9b0" />
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
function ObjectDescription({
  displayObject,
}: {
  displayObject: DisplayObject
}) {
  if (displayObject.kind === 'known') {
    // Enriched content is authored as a complete set (see CatalogObject in
    // lib/catalog.ts) — all three or none, so requiring all three here is a
    // deliberate all-or-nothing gate, not an accidental one. Silent upgrade:
    // an object without enriched content gets the exact plain card below,
    // never a broken/partial enriched section.
    if (displayObject.wowFacts && displayObject.visualHint && displayObject.drawer) {
      return (
        <EnrichedCard
          type={displayObject.type}
          wowFacts={displayObject.wowFacts}
          visualHint={displayObject.visualHint}
          drawer={displayObject.drawer}
        />
      )
    }
    return <p className="live-object-desc">{displayObject.description}</p>
  }
  if (displayObject.kind === 'moving') {
    // Loader ONLY here, not on 'fallback' — 'moving' is the "telescope is
    // physically busy" state (slewing/searching), so it gets the same
    // "getting ready" cue as the checking screen. 'fallback' already has a
    // confident live frame in view with a name it just can't confirm; nothing
    // is "in progress" there, so no loader.
    return <TransitionCopy mainPhrases={MOVING_PHRASES} showLoader />
  }
  return <TransitionCopy mainPhrases={[FALLBACK_SUPPORTING_LINE]} />
}

// How often the wowFact rotates. Faster than the 25s transitional-copy
// cadence — this is meant to be actively browsable ("did you know" moments),
// not ambient background text.
const WOW_FACT_ROTATE_MS = 15 * 1000

// Distinct Unicode glyph per drawer section — same gold styling throughout,
// but a different symbol per heading reads as a small taxonomy of section
// "kinds" rather than four identical bullets. Matched by exact heading text
// as authored in config/catalog.json's drawer[].heading (title-case; CSS
// text-transform:uppercase renders the caps, so the match must stay
// title-case too); falls back to the wowFact's own ✦ for anything
// unrecognized, so a future/typo'd heading still degrades to the
// pre-existing glyph rather than rendering blank.
function drawerHeadingGlyph(heading: string): string {
  switch (heading) {
    case "What you're seeing":
      return '◎'
    case 'Why it matters':
      return '✦'
    case 'The human story':
      return '☺'
    case 'How to spot it':
      return '✛'
    default:
      return '✦'
  }
}

// ◎ reads noticeably smaller than the other three glyphs at the shared
// font-size (its ring is thinner/more open) — bumped 20% larger so all four
// carry equal visual weight in the heading row.
function drawerHeadingGlyphIsLarge(heading: string): boolean {
  return heading === "What you're seeing"
}

// Enriched object-info card: a rotating "did you know" fact, a static
// what-to-look-for hint, and a collapsed-by-default drawer of deeper sections
// (see CatalogObject.wowFacts/visualHint/drawer in lib/catalog.ts). Reuses
// .live-object-desc as the outer card so it sits identically to the plain
// description it replaces — same box, same position in the layout, just
// richer content. Never rendered in fullscreen: fullscreen is a wholly
// separate render branch (see LiveFrameView's isFullscreen check) that never
// reaches ObjectDescription at all, so there's nothing extra to gate here.
function EnrichedCard({
  type,
  wowFacts,
  visualHint,
  drawer,
}: {
  type: string
  wowFacts: string[]
  visualHint: string
  drawer: { heading: string; body: string }[]
}) {
  const { text, visible } = useRotatingPhrase(wowFacts, WOW_FACT_ROTATE_MS)
  const [open, setOpen] = useState(false)
  // The drawer's own grid wrapper (see .enriched-drawer's grid-template-rows
  // transition in styles.css) — the transitionend LISTENER attaches here,
  // since this is the element that actually has the CSS transition. The
  // scroll TARGET itself is toggleRef below, not this.
  const drawerRef = useRef<HTMLDivElement>(null)
  // The toggle button is the scroll anchor in BOTH directions — on open,
  // pinned as high as possible (block:'start') so "Less about this view"
  // sits near the top of the viewport with drawer content filling the rest
  // below it; on close, pinned at the bottom (block:'end') so "More about
  // this view" (now showing that label again) sits at the bottom edge with
  // the image/facts/wowfact visible above it. The button's own position
  // barely moves when the drawer expands/collapses below it (it sits ABOVE
  // the drawer in DOM order), which is exactly why it's a stable anchor
  // for both directions rather than the drawer content itself.
  const toggleRef = useRef<HTMLButtonElement>(null)
  // Guards against scrolling on mount/unrelated re-renders — this component
  // remounts fresh (open resets to false) every time the displayed object
  // changes (see the key= on ObjectDescription's own caller), and a fresh
  // mount must NEVER trigger a scroll on its own. Only an actual tap on the
  // toggle button below ever sets this to true.
  const hasInteractedRef = useRef(false)

  function handleToggle() {
    hasInteractedRef.current = true
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (!hasInteractedRef.current) return
    const el = drawerRef.current
    if (!el) return

    if (!open) {
      // Closing: the toggle button's position doesn't shift when the
      // drawer collapses below it (see toggleRef's own doc comment above),
      // so unlike opening, there's no "still-growing element" to wait
      // out — an immediate scroll can't overshoot into content that
      // hasn't collapsed yet, because the button was never moving.
      toggleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      return
    }

    // Opening: wait for the grid-template-rows expand transition to
    // actually finish before scrolling — scrollIntoView measures the
    // element's CURRENT layout position, and mid-transition that position
    // is still moving every frame. transitionend is the correct native
    // signal for "the growth is done, the layout is final now" (rather
    // than a guessed setTimeout matching the CSS duration, which drifts if
    // that duration ever changes and isn't kept in sync by hand).
    //
    // The timeout fallback (matching .enriched-drawer's own 260ms — see
    // styles.css) covers the case transitionend never fires at all:
    // prefers-reduced-motion sets transition:none there, which means no
    // transition ever starts, so there's nothing to end. Without this
    // fallback, a reduced-motion guest's "More about this view" tap would
    // silently never scroll. didScroll + clearing the timeout on whichever
    // fires first keeps this from double-firing (transitionend AND the
    // timeout both landing) on a normal-motion device.
    const drawerEl = el
    let didScroll = false
    function scrollToToggle() {
      if (didScroll) return
      didScroll = true
      toggleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    function onTransitionEnd(e: TransitionEvent) {
      if (e.target !== drawerEl || e.propertyName !== 'grid-template-rows') return
      scrollToToggle()
    }
    drawerEl.addEventListener('transitionend', onTransitionEnd)
    const fallbackTimer = setTimeout(scrollToToggle, 280)
    return () => {
      drawerEl.removeEventListener('transitionend', onTransitionEnd)
      clearTimeout(fallbackTimer)
    }
  }, [open])

  return (
    <div className="live-object-desc enriched-card">
      <div className="enriched-wowfact-slot">
        <p className={`enriched-wowfact${visible ? ' is-visible' : ''}`}>
          {/* The same illustrated TypeIcon the type pill uses (see
              ObjectTypeLine), shrunk to sit inline before the fact — a
              type-specific mark instead of a generic ✦. These icons carry
              their own baked-in multi-stop gradients (deliberately not
              currentColor/tintable — see TypeIcon's own doc comment), so
              this is the icon's real colors at a smaller size, not a
              var(--type-color)-tinted glyph the way the drawer headings'
              Unicode marks are. */}
          <span className="enriched-wowfact-glyph" aria-hidden="true">
            <TypeIcon type={type} />
          </span>
          {text}
        </p>
      </div>
      <p className="enriched-hint">{visualHint}</p>
      <button
        type="button"
        className="enriched-drawer-toggle"
        ref={toggleRef}
        onClick={handleToggle}
        aria-expanded={open}
      >
        {open ? 'Less about this view' : 'More about this view'}
        <span className={`enriched-drawer-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>
      {/* Always mounted (not a conditional {open ? ... : null}) so the
          grid-template-rows transition below has something to actually
          ANIMATE between — the guest sees the drawer grow/shrink at their
          tap point (item 5) instead of it snapping in/out instantly, and
          the transitionend listener above has a real transition to listen
          for in the first place. */}
      <div className={`enriched-drawer${open ? ' enriched-drawer--open' : ''}`} ref={drawerRef}>
        <div className="enriched-drawer-inner">
          {drawer.map((section) => (
            <div className="enriched-drawer-section" key={section.heading}>
              <p className="enriched-drawer-heading">
                <span
                  className={`enriched-drawer-heading-glyph${drawerHeadingGlyphIsLarge(section.heading) ? ' enriched-drawer-heading-glyph--large' : ''}`}
                  aria-hidden="true"
                >
                  {drawerHeadingGlyph(section.heading)}
                </span>
                {section.heading}
              </p>
              <p className="enriched-drawer-body">{section.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// A Messier id with no distinctive name of its own — primaryName is either
// bare ("M65") or just the id plus its own type ("M4 Globular Cluster",
// which STARTS with "M4" — see the regex). Scoped to Messier ids only:
// every NGC/named/planet object in the catalog already has a real name
// (see the catalog survey behind this change), so this pattern is
// deliberately narrow rather than a general "name starts with the id" rule
// that could misfire on some future non-Messier id shaped like a prefix.
const BARE_MESSIER_NAME = /^M\d+(\s|$)/

// Builds the live heading for a known catalog object as { lead, sub } —
// lead is the large text, sub (if present) renders smaller beside/below it
// (see the <h1> call site). Only Messier objects get the "M13, Hercules" /
// "Messier 4" treatment; every other object (NGC ids, named objects,
// planets, the Moon) keeps its plain catalog name untouched — those don't
// have the id-echoes-in-the-name pattern this exists to clean up. The type
// itself is never shown here (redundant with the ObjectTypeLine pill right
// below), whether the name is split or not.
function headingParts(name: string, type: string): { lead: string; sub: string | null } {
  const id = CATALOG_ID_BY_NAME.get(name)
  if (!id || !/^M\d+$/.test(id)) return { lead: name, sub: null }

  if (BARE_MESSIER_NAME.test(name)) {
    // No distinctive name beyond the id itself — spell out "Messier N"
    // rather than leaving a guest looking at a bare catalog code as the
    // whole heading.
    return { lead: `Messier ${id.slice(1)}`, sub: null }
  }

  // Has a real name (e.g. "Hercules Globular Cluster", "Andromeda Galaxy")
  // — strip the type suffix if the name spells it out verbatim (the type
  // pill below already says it in full), then pair the id with what's left.
  const lowerName = name.toLowerCase()
  const lowerType = type.toLowerCase()
  const properName = lowerName.endsWith(lowerType) ? name.slice(0, name.length - type.length).trim() : name
  return { lead: id, sub: properName.length > 0 ? properName : null }
}

// Guest-facing label for the three display states — see DisplayObject in
// lib/live-status.ts. "Moving" and "fallback" are deliberately vague/generic:
// a wrong specific name is worse than an honest "we're not sure yet."
//
// Deliberately NOT split via headingParts here: this also backs the
// telescope image's alt text (see its two call sites), which has no
// adjacent type pill or heading layout to supply what a bare "M13" or
// "Messier 4" alone would drop — a screen reader user needs the full
// descriptive name from the alt text itself.
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
  'A new patch of sky is coming into view…',
  'Making the jump…',
  'Engaging the next target…',
  'New coordinates — let’s see what’s out there…',
  'Onwards and skywards…',
  'The universe just got a little more interesting…',
  'Don’t panic — the telescope knows where it’s going…',
  'Let’s see what’s on the other side…',
  'The night is young and the sky is wide…',
  'Another corner of the cosmos, coming up…',
  'Second star to the right, and straight on till morning…',
  'Rotating to the next chapter of tonight’s story…',
  'The best views are never in the same place twice…',
  'One more wonder before the night is through…',
  'Looking for something older than history…',
  'We’re not lost. We’re exploring.',
  'Finding the next excuse to say wow.',
  'Following the oldest travelers in the universe.',
  'Changing targets, not changing wonder.',
  'Following ancient light…',
  'Next stop: the past…',
  'Searching the archives of the universe…',
  'This next object is not just far away — it is long ago…',
  'The sky keeps records. We are opening one now…',
  'Another fossil of light is coming into view…',
  'The next target is a postcard from the past…',
  'We are not just changing direction — we are changing time…',
  'Old light, new wonder…',
  'The telescope is collecting yesterday’s universe…',
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

const TRANSITION_PHRASE_ROTATE_MS = 25 * 1000
const TRANSITION_PHRASE_FADE_MS = 600

// Crossfades between entries of `phrases` on an interval — the shared
// rotation mechanism behind both the main transitional line and the
// instruction line. A single-entry pool (e.g. the fixed fallback supporting
// line) just renders statically without ever rotating (the effect's interval
// still runs but modulo-1 always re-selects the same index, and the identical
// text skips the visible crossfade in practice).
function useRotatingPhrase(
  phrases: string[],
  rotateMs: number = TRANSITION_PHRASE_ROTATE_MS,
): { text: string; visible: boolean } {
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
    }, rotateMs)
    return () => {
      clearInterval(rotate)
      if (fadeRef.id) clearTimeout(fadeRef.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phrases/rotateMs
    // are module-level constants per call site; re-running on identity would
    // restart rotation needlessly since neither is ever actually new.
  }, [phrases.length, rotateMs])

  return { text: phrases[index], visible }
}

const MOVING_PHRASE_ROTATE_MS = 10 * 1000

// Same crossfade mechanism as useRotatingPhrase (identical fade timing/
// interval shape), but TRUE random selection each tick instead of sequential
// (i+1) % length — and never repeats the immediately-previous pick, so a
// large pool doesn't visibly loop back-to-back by chance. Purpose-built for
// MOVING_PHRASES rather than generalizing useRotatingPhrase itself: the
// other three call sites (wowFact, RotatingPhrase, the instruction line)
// keep their existing sequential behavior unchanged, so this is additive,
// not a behavior change to shared code.
function useRandomNoRepeatPhrase(phrases: string[], rotateMs: number): { text: string; visible: boolean } {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * phrases.length))
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (phrases.length <= 1) return
    const fadeRef = { id: null as ReturnType<typeof setTimeout> | null }
    const rotate = setInterval(() => {
      setVisible(false)
      fadeRef.id = setTimeout(() => {
        setIndex((current) => {
          // Pick uniformly among every index EXCEPT the current one, rather
          // than rejection-sampling Math.random() until it differs — avoids
          // an (unbounded, if unlikely) retry loop and stays O(1).
          const next = Math.floor(Math.random() * (phrases.length - 1))
          return next >= current ? next + 1 : next
        })
        setVisible(true)
      }, TRANSITION_PHRASE_FADE_MS)
    }, rotateMs)
    return () => {
      clearInterval(rotate)
      if (fadeRef.id) clearTimeout(fadeRef.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phrases/rotateMs
    // are module-level constants per call site, same reasoning as
    // useRotatingPhrase above.
  }, [phrases.length, rotateMs])

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
// STATIC instruction line beneath it. The main line rotates every 10s to a
// random pool entry (never repeating the immediately-previous one — see
// useRandomNoRepeatPhrase); the instruction line stays fixed at "one moment"
// rather than also rotating, so guest attention isn't split between two
// simultaneously-changing lines — only the main phrase above moves.
function TransitionCopy({
  mainPhrases,
  showLoader,
}: {
  mainPhrases: string[]
  showLoader?: boolean
}) {
  const main = useRandomNoRepeatPhrase(mainPhrases, MOVING_PHRASE_ROTATE_MS)
  return (
    <div className="live-object-desc live-object-desc--transition">
      {showLoader ? <TelescopeLoader small /> : null}
      <p className={`transition-main${main.visible ? ' is-visible' : ''}`}>{main.text}</p>
      <p className="transition-instruction is-visible">one moment</p>
    </div>
  )
}

// Temporarily off — see the SHOW_SHARE_PANEL gate at SharePanel's own call
// site in LiveFrameView. Implementation (component, icons, CSS) is kept
// intact, not deleted, so the compact share-dock redesign is ready to
// re-enable once its follow-up round lands rather than being rebuilt from
// scratch.
const SHOW_SHARE_PANEL = false

// Guest share panel. PURELY CLIENT-SIDE, per the confirmed privacy
// constraint: nothing here leaves the browser as data — the composed
// auto-line text only ever gets handed to the guest's OWN share sheet / deep
// link / clipboard. No fetch, no storage, nothing sent to any backend or
// database. Icon-only: no guest text input at all (an earlier caption/name
// field was dropped from the design).
//
// Compact "share dock" rather than a card — a quiet utility footer row, not
// a section competing with the object card above it (see .share-dock in
// styles.css for the lower-contrast/lower-padding treatment vs. the old
// .share-card 4-tile grid this replaces). Final button set: Share (wide
// primary pill) + WhatsApp/Instagram/Copy (compact icon buttons).
//
// X/Twitter removed entirely — not part of the confirmed final set.
// Messenger deliberately NOT shipped: there is no reliable web share intent
// that accepts freeform text the way wa.me does (the fb-messenger:// deep
// link only fires from specific mobile contexts, and Meta's own web dialog
// only accepts a bare link, silently dropping the composed line) — shipping
// it anyway would be exactly the "dead/misleading button" the fallback
// rules exist to prevent. Instagram has the same no-web-intent limitation,
// but ships anyway per an explicit confirmed exception: it calls the SAME
// navigator.share() as the Share button, functioning as a visual shortcut
// for a guest who specifically wants Instagram rather than a distinct
// action — so it's gated on navigator.share existing (mobile only; hidden
// entirely on desktop, where it would be a dead button since there's no
// share sheet to open).
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
  // Feature-detected ONCE per mount, not read directly in JSX — avoids a
  // hydration mismatch (SSR has no `navigator`) and matches this file's
  // existing feature-detection-not-UA-sniffing discipline (see
  // supportsNativeFullscreen's own doc comment). Instagram's button only
  // ever renders when this is true — see this function's own doc comment
  // above for why (no web share intent exists for it, so without
  // navigator.share it would be a dead button).
  const [canNativeShare, setCanNativeShare] = useState(false)
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareText())
      setStatus('Copied')
    } catch {
      // Clipboard permission denied or unavailable — silently no-op; this is
      // a nice-to-have action, not a critical path.
      setStatus('Copy unavailable')
    }
  }

  return (
    <section className="share-dock" aria-label="Share this view">
      <div className="share-dock-label">Share this view</div>
      <div className="share-dock-row">
        <button type="button" className="share-dock-primary" onClick={handleNativeShare}>
          <ShareIcon />
          <span>Share</span>
        </button>
        <button type="button" className="share-dock-icon" onClick={handleWhatsApp} aria-label="Share on WhatsApp">
          <WhatsAppIcon />
        </button>
        {canNativeShare && (
          <button type="button" className="share-dock-icon" onClick={handleNativeShare} aria-label="Share to Instagram">
            <InstagramIcon />
          </button>
        )}
        <button
          type="button"
          className="share-dock-icon share-dock-icon--quiet"
          onClick={handleCopy}
          aria-label="Copy share text"
        >
          <CopyIcon />
        </button>
      </div>
      <div className="share-status" aria-live="polite">
        {status}
      </div>
    </section>
  )
}

// Small monochrome line icons — no external icon library, no icon font, no
// external requests — kept as inline SVG so there's no extra dependency for
// these few glyphs. currentColor throughout so each inherits whichever
// .share-dock-* button color it sits inside (see styles.css) rather than
// carrying its own fixed color — same pattern TypeIcon's non-gradient
// glyphs use elsewhere in this file.
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

// Camera-outline glyph (Instagram reference, kept monochrome/currentColor —
// no brand color fill per the confirmed "no full-color brand logos"
// constraint). Rounded-square body + circular lens + small viewfinder
// notch, the same recognizable silhouette Simple Icons' own Instagram mark
// uses, simplified to plain strokes so it reads cleanly at compact size.
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
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

// Feature detection ONLY — never user-agent sniffing. iOS Safari doesn't
// implement the Fullscreen API on anything but <video> elements (an Apple
// platform restriction, not a bug), so document.documentElement.requestFullscreen
// is simply undefined there; checking for its existence (plus
// fullscreenEnabled, which some browsers set false even when the method
// exists, e.g. inside a cross-origin iframe without an allow policy) is a
// reliable, forward-compatible way to know whether calling it will actually
// do anything, regardless of which browser/OS this is.
function supportsNativeFullscreen(): boolean {
  if (typeof document === 'undefined') return false
  // DEMO-MOCK ONLY: ?forceFullscreenFallback=1 lets the CSS fallback path be
  // reviewed on any desktop/Android browser tonight, without waiting for a
  // real iOS device — forces the same code path an actual iPhone would take,
  // without any user-agent sniffing in the real detection logic above/below.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('forceFullscreenFallback') === '1') {
    return false
  }
  return document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function'
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
//
// `small`: reuses the exact same component/cycling logic for the 'moving'
// transition card (see ObjectDescription/TransitionCopy) — only --scope-size
// changes (via the scope-loader--small modifier), so both contexts share one
// "the telescope is working" visual instead of a second bespoke widget.
function TelescopeLoader({ small }: { small?: boolean }) {
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
    <span className={`scope-loader${small ? ' scope-loader--small' : ''}`} aria-hidden="true">
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
  tone?: 'cancelled' | 'finished'
  loader?: boolean
  logoSrc?: string | null
  logoAlt?: string
  flavorContext?: FlavorContext
}) {
  const cancelled = tone === 'cancelled'
  const finished = tone === 'finished'
  return (
    <div className={`status-root${cancelled ? ' status-root--cancelled' : ''}${finished ? ' status-root--finished' : ''}`}>
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
        {/* PLACEHOLDER slot for the custom "closing" animation (a UFO
            departure, per the plan) — built separately later. For now just
            a static glyph so the finished state reads as visually distinct
            and deliberate rather than empty; swapping this span's contents
            for a real animated component is the only change needed once
            that's built (no restructuring of StatusScreen required). */}
        {finished ? (
          <span className="status-finished-icon" aria-hidden="true">
            🛸
          </span>
        ) : null}
        <div className="status-heading-row">
          <p className={`status-heading${cancelled ? ' status-heading--cancelled' : ''}${finished ? ' status-heading--finished' : ''}`}>
            {heading}
          </p>
          {loader ? <TelescopeLoader /> : null}
        </div>
        {sub ? (
          <p className={`status-sub${cancelled ? ' status-sub--cancelled' : ''}${finished ? ' status-sub--finished' : ''}`}>
            {sub}
          </p>
        ) : null}
      </div>
      {flavorContext ? <FlavorLine context={flavorContext} secondary={cancelled || finished} /> : null}
    </div>
  )
}
