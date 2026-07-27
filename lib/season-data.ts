// Pure assembly for the /season operator calendar: takes plain rows (subsets of
// the Prisma models — trivially fixture-able) and produces the night list,
// season summary, and per-hotel rollups. NO I/O, NO Prisma imports — the page
// (app/season/page.tsx) does the querying and hands rows in, so every decision
// documented in docs/season-calendar-investigation-2026-07-26.md is testable in
// isolation (scripts/test-season-data.mjs).
//
// The honest-data rules this module OWNS (see the investigation report):
//   - Session-led union: every known Session is a night, even without viewer
//     stats (pre-snapshot nights render marked, never invented as zeros).
//   - Straggler exclusion by construction: viewer/interaction rows attach ONLY
//     by the night's exact eventKey ("date:hotelId"), so a midnight-straggler
//     fallback bucket ("date:hotel") can never pollute a real night or appear
//     as a night of its own.
//   - Duration truth: a run with endedAt uses it; the final run of a night
//     (endedAt null) falls back to its latest frame's ingestedAt (approx:true,
//     rendered with a ~) — NEVER Session.endedAt, which is cron-stamped hours
//     later and would silently inflate the last object of every night.
//   - Unresolved (objectId-null) runs fold into muted "settling" entries so
//     identified objects stay the story but the telescope time still adds up.
//   - Consent discontinuity: nights before CONSENT_BOUNDARY_DATE counted every
//     tab; from that date, consenting guests only. The summary's best night is
//     split best-before/best-after so the headline is never an artifact.

// ---- The THREE viewer-counting regimes ----
// Viewer counts across the season came from three different mechanisms, and the
// season view must never let a MEASUREMENT change read as an AUDIENCE change:
//
//   1. 'pre-consent'  (< CONSENT_BOUNDARY_DATE): every browser tab counted, via
//      a sessionStorage-persisted id. Counts everyone — but also the operator's
//      own early-season testing (already footnoted), and the persisted id
//      survived reloads.
//   2. 'consent-gated' ([CONSENT_BOUNDARY_DATE, CONSENT_FREE_BOUNDARY_DATE)):
//      only CONSENTED guests counted. QR guests land on /live, never see the
//      banner (suppressed there), never consent — so they were STRUCTURALLY
//      UNDERCOUNTED. This is the broken band: numbers look real but aren't.
//      Currently exactly ONE night (27-07 astir-odysseus): the gate deployed
//      26-07 and that was the first event after it.
//   3. 'consent-free' (>= CONSENT_FREE_BOUNDARY_DATE): every tab counted again,
//      via the CONSENT-FREE ephemeral id (lib/consent.ts getEphemeralViewerId —
//      page-memory only, nothing stored on the device). Counts everyone.
//
// Regimes 1 and 3 both count everyone, so they are broadly comparable — with
// ONE caveat stated in the UI footnote: regime 1's id was sessionStorage-
// persisted (survived reloads) while regime 3's ephemeral id is NOT, so a
// reload mints a new one. Regime 3 therefore runs slightly HIGHER than regime 1
// for the same real audience — an upward bias on unique only (peak is a 60s
// active window, barely affected). Not broken; just not a growth signal.
export const CONSENT_BOUNDARY_DATE = '2026-07-26' // consent gating deployed (main @ aa53157)
export const CONSENT_FREE_BOUNDARY_DATE = '2026-07-28' // consent-free ephemeral counting deployed (this fix)

export type CountingRegime = 'pre-consent' | 'consent-gated' | 'consent-free'

export function regimeForDate(date: string): CountingRegime {
  if (date < CONSENT_BOUNDARY_DATE) return 'pre-consent'
  if (date < CONSENT_FREE_BOUNDARY_DATE) return 'consent-gated'
  return 'consent-free'
}

// A 'consent-gated' night is the only one whose viewer number must NOT be
// trusted or compared — QR guests weren't captured. Used to exclude it from
// averages and the best-night headline.
export function isUndercounted(regime: CountingRegime): boolean {
  return regime === 'consent-gated'
}

// ---- Input row shapes (plain-data subsets of the Prisma models) ----
export type SeasonSessionRow = {
  id: string
  date: string // "YYYY-MM-DD" Athens
  hotelId: string
  status: string // "active" | "cancelled" | "completed"
  cancellationReason: string | null
}

export type SeasonStackRunRow = {
  sessionId: string
  source: string
  startedAt: Date
  endedAt: Date | null
  objectId: string | null
  objectName: string | null
  objectType: string | null
  confidence: string | null
  hasInRangeRunnerUp: boolean | null
  latestFrameId: string | null
}

export type SeasonViewerRow = {
  eventKey: string
  scope: string // "hotel" | "event"
  date: string | null
  hotelId: string | null
  eventSlug: string | null
  unique: number
  maxConcurrent: number
  source: string // "finish" | "backfill"
  capturedAt: Date
}

export type SeasonInteractionRow = {
  eventKey: string
  interactionKey: string
  objectId: string | null
  count: number
}

// latestFrameId -> that frame's ingestedAt (only needed for final runs).
export type FrameTimeLookup = Record<string, Date>

// ---- Output shapes ----
export type TimelineEntry =
  | {
      kind: 'object'
      source: string
      startedAt: Date
      durationS: number | null
      approx: boolean // duration derived from the latest frame, not a closed run
      objectId: string
      objectName: string | null
      objectType: string | null
      confidence: string | null
      contested: boolean
    }
  | {
      kind: 'settling' // one or more consecutive unresolved runs, folded
      source: string
      startedAt: Date
      durationS: number | null
      approx: boolean
      runCount: number
    }

export type NightEntry = {
  type: 'hotel' | 'event'
  date: string // display/sort date; a special event uses its snapshot date
  hotelId: string | null
  eventSlug: string | null
  eventKey: string
  status: string
  cancellationReason: string | null
  regime: CountingRegime // which counting mechanism produced this night's viewer number
  undercounted: boolean // true only for 'consent-gated' — viewer number not trustworthy
  viewer: { unique: number; maxConcurrent: number; snapshotSource: string } | null
  objects: TimelineEntry[]
  // null = no interaction rows for this night (predates tracking) -> render "—",
  // never a fake zero. Non-null = real counts by interaction key.
  interactions: Record<string, number> | null
}

export type HotelRollup = {
  hotelId: string
  events: number // completed nights at this venue
  measuredNights: number // of those, how many have a COMPARABLE viewer row (excludes undercounted)
  undercountedNights: number // consent-gated nights at this venue, shown but excluded from the average
  avgUnique: number | null // over comparable measured nights only; null when none
  avgPeak: number | null
  mixedRegime: boolean // comparable nights drawn from BOTH pre-consent and consent-free -> render † (see reload caveat)
}

export type BestNight = { date: string; hotelId: string | null; eventSlug: string | null; unique: number }

export type SeasonSummary = {
  totalEvents: number // completed nights (hotel + special event)
  cancelledCount: number
  measuredNights: number
  totalUnique: number // sum over measured nights
  avgUnique: number | null // per comparable measured night; null when none
  undercountedNights: number // consent-gated nights excluded from totals/average
  // Best night drawn ONLY from comparable regimes (pre-consent + consent-free,
  // both count everyone) — never a consent-gated (undercounted) night, and the
  // consent-gated 4/2 could never win anyway. This is the number safe to quote.
  bestComparable: BestNight | null
}

export type SeasonData = {
  nights: NightEntry[] // newest first
  summary: SeasonSummary
  hotels: HotelRollup[] // default order: avgUnique desc (the renewal ranking)
}

// ---- helpers ----
function hotelEventKey(date: string, hotelId: string): string {
  // Same shape as viewerEventKey (lib/redis.ts) — duplicated as a pure literal
  // here so this module stays I/O-free; asserted equal in the test suite.
  return `${date}:${hotelId}`
}

function durationOf(
  run: SeasonStackRunRow,
  frameTimes: FrameTimeLookup,
): { durationS: number | null; approx: boolean } {
  if (run.endedAt) {
    return { durationS: Math.max(0, Math.round((run.endedAt.getTime() - run.startedAt.getTime()) / 1000)), approx: false }
  }
  const frameAt = run.latestFrameId ? frameTimes[run.latestFrameId] : undefined
  if (frameAt) {
    return { durationS: Math.max(0, Math.round((frameAt.getTime() - run.startedAt.getTime()) / 1000)), approx: true }
  }
  return { durationS: null, approx: true }
}

// Build a night's object timeline: chronological, unresolved runs folded.
// Consecutive unresolved runs merge into ONE settling entry (their durations
// summed where known); a resolved run breaks the fold.
export function buildTimeline(runs: SeasonStackRunRow[], frameTimes: FrameTimeLookup): TimelineEntry[] {
  const sorted = [...runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const out: TimelineEntry[] = []
  for (const run of sorted) {
    const { durationS, approx } = durationOf(run, frameTimes)
    if (run.objectId === null) {
      const last = out[out.length - 1]
      if (last && last.kind === 'settling') {
        last.runCount += 1
        if (durationS !== null) last.durationS = (last.durationS ?? 0) + durationS
        last.approx = last.approx || approx
      } else {
        out.push({ kind: 'settling', source: run.source, startedAt: run.startedAt, durationS, approx, runCount: 1 })
      }
      continue
    }
    out.push({
      kind: 'object',
      source: run.source,
      startedAt: run.startedAt,
      durationS,
      approx,
      objectId: run.objectId,
      objectName: run.objectName,
      objectType: run.objectType,
      confidence: run.confidence,
      contested: run.hasInRangeRunnerUp === true,
    })
  }
  return out
}

// ---- main assembly ----
export function assembleSeason(input: {
  sessions: SeasonSessionRow[]
  stackRuns: SeasonStackRunRow[]
  viewerStats: SeasonViewerRow[]
  interactions: SeasonInteractionRow[]
  frameTimes: FrameTimeLookup
}): SeasonData {
  const runsBySession = new Map<string, SeasonStackRunRow[]>()
  for (const r of input.stackRuns) {
    const list = runsBySession.get(r.sessionId)
    if (list) list.push(r)
    else runsBySession.set(r.sessionId, [r])
  }

  // Viewer rows by EXACT eventKey — the join that excludes stragglers by
  // construction ("date:hotel" can never equal "date:<realHotelId>").
  const viewerByKey = new Map<string, SeasonViewerRow>()
  for (const v of input.viewerStats) viewerByKey.set(v.eventKey, v)

  // Interaction counts by exact eventKey, rolled up per interactionKey (the
  // per-object split stays available via /api/interaction-stats; the calendar
  // shows per-key totals).
  const interactionsByKey = new Map<string, Record<string, number>>()
  for (const row of input.interactions) {
    let bucket = interactionsByKey.get(row.eventKey)
    if (!bucket) {
      bucket = {}
      interactionsByKey.set(row.eventKey, bucket)
    }
    bucket[row.interactionKey] = (bucket[row.interactionKey] ?? 0) + row.count
  }

  // 1. Session-led hotel nights.
  const nights: NightEntry[] = input.sessions.map((s) => {
    const eventKey = hotelEventKey(s.date, s.hotelId)
    const viewer = viewerByKey.get(eventKey)
    return {
      type: 'hotel' as const,
      date: s.date,
      hotelId: s.hotelId,
      eventSlug: null,
      eventKey,
      status: s.status,
      cancellationReason: s.cancellationReason,
      regime: regimeForDate(s.date),
      undercounted: isUndercounted(regimeForDate(s.date)),
      viewer: viewer
        ? { unique: viewer.unique, maxConcurrent: viewer.maxConcurrent, snapshotSource: viewer.source }
        : null,
      objects: buildTimeline(runsBySession.get(s.id) ?? [], input.frameTimes),
      interactions: interactionsByKey.get(eventKey) ?? null,
    }
  })

  // 2. Special-event viewer rows (scope "event") have no Session — append as
  // their own nights so a special event's audience shows in the season. Its
  // display date is the snapshot date (a multi-day event has no single date).
  const sessionKeys = new Set(nights.map((n) => n.eventKey))
  for (const v of input.viewerStats) {
    if (v.scope !== 'event') continue
    if (sessionKeys.has(v.eventKey)) continue
    const date = v.date ?? v.capturedAt.toISOString().slice(0, 10)
    nights.push({
      type: 'event',
      date,
      hotelId: null,
      eventSlug: v.eventSlug,
      eventKey: v.eventKey,
      status: 'completed',
      cancellationReason: null,
      regime: regimeForDate(date),
      undercounted: isUndercounted(regimeForDate(date)),
      viewer: { unique: v.unique, maxConcurrent: v.maxConcurrent, snapshotSource: v.source },
      objects: [],
      interactions: interactionsByKey.get(v.eventKey) ?? null,
    })
  }

  // Newest first; stable tiebreak on eventKey for determinism.
  nights.sort((a, b) => (a.date === b.date ? (a.eventKey < b.eventKey ? 1 : -1) : a.date < b.date ? 1 : -1))

  // 3. Summary. Cancelled nights are listed but never counted as events.
  // "measured" for totals/average means a viewer row AND a trustworthy one —
  // consent-gated (undercounted) nights are shown per-row but excluded from
  // every aggregate, so a broken 4/2 can never drag the season average or win
  // best-night.
  const completed = nights.filter((n) => n.status !== 'cancelled')
  const comparable = completed.filter((n) => n.viewer !== null && !n.undercounted)
  const undercountedNights = completed.filter((n) => n.viewer !== null && n.undercounted).length
  const totalUnique = comparable.reduce((sum, n) => sum + (n.viewer?.unique ?? 0), 0)

  function bestOf(pool: NightEntry[]): BestNight | null {
    let best: NightEntry | null = null
    for (const n of pool) {
      if (!n.viewer) continue
      if (!best || n.viewer.unique > (best.viewer?.unique ?? -1)) best = n
    }
    return best && best.viewer
      ? { date: best.date, hotelId: best.hotelId, eventSlug: best.eventSlug, unique: best.viewer.unique }
      : null
  }

  const summary: SeasonSummary = {
    totalEvents: completed.length,
    cancelledCount: nights.length - completed.length,
    measuredNights: comparable.length,
    totalUnique,
    avgUnique: comparable.length > 0 ? Math.round(totalUnique / comparable.length) : null,
    undercountedNights,
    // Best night from comparable regimes only (both count everyone). The reload
    // caveat (regime 3 slightly > regime 1) is disclosed in the footnote, not
    // corrected here — it can't flip which night is best at any realistic gap.
    bestComparable: bestOf(comparable),
  }

  // 4. Per-hotel rollups (hotel nights only — special events have no venue to
  // renew). Averages over MEASURED nights only, count disclosed by the caller
  // ("avg 41 (4 of 6 nights measured)"); never a fake zero in the mean.
  const byHotel = new Map<string, NightEntry[]>()
  for (const n of completed) {
    if (n.type !== 'hotel' || !n.hotelId) continue
    const list = byHotel.get(n.hotelId)
    if (list) list.push(n)
    else byHotel.set(n.hotelId, [n])
  }
  // Array.from (not iterator spread) — the build's TS target predates es2015 iteration.
  const hotels: HotelRollup[] = Array.from(byHotel.entries()).map(([hotelId, hotelNights]) => {
    // Average over COMPARABLE measured nights only — a consent-gated night is
    // shown (in undercountedNights) but never dragged into the renewal number.
    const m = hotelNights.filter((n) => n.viewer !== null && !n.undercounted)
    const undercounted = hotelNights.filter((n) => n.viewer !== null && n.undercounted).length
    // † when the comparable nights span BOTH pre-consent and consent-free — the
    // two everyone-counted regimes that differ only by the reload caveat.
    const pre = m.some((n) => n.regime === 'pre-consent')
    const free = m.some((n) => n.regime === 'consent-free')
    return {
      hotelId,
      events: hotelNights.length,
      measuredNights: m.length,
      undercountedNights: undercounted,
      avgUnique:
        m.length > 0
          ? Math.round(m.reduce((s: number, n: NightEntry) => s + (n.viewer?.unique ?? 0), 0) / m.length)
          : null,
      avgPeak:
        m.length > 0
          ? Math.round(m.reduce((s: number, n: NightEntry) => s + (n.viewer?.maxConcurrent ?? 0), 0) / m.length)
          : null,
      mixedRegime: pre && free,
    }
  })
  // Default order: engagement (avgUnique) desc — the renewal ranking. Unmeasured
  // venues sink to the bottom rather than sorting as zero among real numbers.
  hotels.sort((a, b) => (b.avgUnique ?? -1) - (a.avgUnique ?? -1))

  return { nights, summary, hotels }
}

// Re-sort the hotel rollup for the ?sort= header links. Always returns a copy.
export type HotelSortKey = 'unique' | 'peak' | 'events'
export function sortHotels(hotels: HotelRollup[], key: HotelSortKey): HotelRollup[] {
  const sorted = [...hotels]
  if (key === 'events') sorted.sort((a, b) => b.events - a.events)
  else if (key === 'peak') sorted.sort((a, b) => (b.avgPeak ?? -1) - (a.avgPeak ?? -1))
  else sorted.sort((a, b) => (b.avgUnique ?? -1) - (a.avgUnique ?? -1))
  return sorted
}
