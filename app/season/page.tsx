import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { debugSecret, verifyDebugCookie, DEBUG_COOKIE_NAME } from '@/lib/debug-auth'
import { hotelDisplayName } from '@/lib/live-copy'
import {
  assembleSeason,
  sortHotels,
  CONSENT_BOUNDARY_DATE,
  type HotelSortKey,
  type NightEntry,
  type TimelineEntry,
} from '@/lib/season-data'
import { SeasonUnauthorized } from './SeasonUnauthorized'
import './season.css'

export const metadata: Metadata = {
  title: 'Season · operator',
  // Private operator surface — never indexed, never linked from guest pages.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// Per-request auth (cookie) + always-fresh archive reads.
export const dynamic = 'force-dynamic'

// ---- display helpers (module-local; the assembly stays in lib/season-data) ----

// dd-mm-yyyy — the operator's preferred format everywhere on this page.
function fmtDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}-${m}-${y}`
}

function fmtDuration(seconds: number | null, approx: boolean): string {
  if (seconds === null) return '—'
  const mins = Math.round(seconds / 60)
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
  return approx ? `~${label}` : label
}

function venueLabel(night: NightEntry): string {
  if (night.type === 'event') return night.eventSlug ?? 'Special event'
  return night.hotelId ? hotelDisplayName(night.hotelId) : '—'
}

// Interaction keys in display order with operator-facing labels. Keys absent
// from a night's counts simply don't render; a night with interactions === null
// renders a single "—" (predates tracking — never a fake zero).
const INTERACTION_DISPLAY: [string, string][] = [
  ['history_pill_tap', 'pill taps'],
  ['object_info_open', 'info opens'],
  ['fullscreen_enter', 'fullscreen'],
  ['farewell_ufo_tap', 'UFO taps'],
  ['farewell_finale_reached', 'finales'],
  ['eclipse_totality_reached', 'totalities'],
  ['funnel_whatsapp_impression', 'WA seen'],
  ['funnel_whatsapp_click', 'WA clicks'],
  ['funnel_baseline_review_impression', 'review seen'],
  ['funnel_baseline_review_click', 'review clicks'],
  ['funnel_finder_review_impression', 'finder seen'],
  ['funnel_finder_review_click', 'finder clicks'],
]

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const time = entry.startedAt.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Athens',
  })
  if (entry.kind === 'settling') {
    return (
      <li className="season-tl season-tl--settling">
        <span className="season-tl-time">{time}</span>
        <span className="season-tl-name">
          settling / unidentified{entry.runCount > 1 ? ` (${entry.runCount} runs)` : ''}
        </span>
        <span className="season-tl-dur">{fmtDuration(entry.durationS, entry.approx)}</span>
        <span className="season-tl-src">{entry.source}</span>
      </li>
    )
  }
  return (
    <li className="season-tl">
      <span className="season-tl-time">{time}</span>
      <span className="season-tl-name">
        {entry.objectId}
        {entry.objectName ? ` — ${entry.objectName}` : ''}
        {entry.confidence && entry.confidence !== 'high' ? (
          <em className="season-tl-conf"> ({entry.confidence}{entry.contested ? ', contested' : ''})</em>
        ) : entry.contested ? (
          <em className="season-tl-conf"> (contested)</em>
        ) : null}
      </span>
      <span className="season-tl-dur">{fmtDuration(entry.durationS, entry.approx)}</span>
      <span className="season-tl-src">{entry.source}</span>
    </li>
  )
}

function NightRow({ night }: { night: NightEntry }) {
  const objectCount = night.objects.filter((o) => o.kind === 'object').length
  return (
    <details className="season-night">
      <summary className="season-night-summary">
        <span className="season-cell season-cell--date">{fmtDate(night.date)}</span>
        <span className="season-cell season-cell--venue">{venueLabel(night)}</span>
        <span className="season-cell season-cell--type">{night.type === 'event' ? 'special' : 'hotel'}</span>
        {night.status === 'cancelled' ? (
          <span className="season-cell season-cell--cancelled">
            cancelled{night.cancellationReason ? ` (${night.cancellationReason})` : ''}
          </span>
        ) : night.viewer ? (
          <>
            <span className="season-cell season-cell--num" data-label="unique ">
              {night.viewer.unique}
            </span>
            <span className="season-cell season-cell--num" data-label="peak ">
              {night.viewer.maxConcurrent}
            </span>
          </>
        ) : (
          <span className="season-cell season-cell--nostats">no viewer stats</span>
        )}
        <span className="season-cell season-cell--num" data-label="objects ">
          {objectCount > 0 ? objectCount : '—'}
        </span>
        <span className="season-cell season-cell--flags">
          {night.interactions ? <span className="season-badge season-badge--ix">ix</span> : null}
          {night.viewer?.snapshotSource === 'backfill' ? (
            <span className="season-badge season-badge--backfill" title="Reconstructed by backfill, not a live finish snapshot">
              backfill
            </span>
          ) : null}
        </span>
      </summary>
      <div className="season-night-detail">
        {night.objects.length > 0 ? (
          <ul className="season-tl-list">
            {night.objects.map((entry, i) => (
              <TimelineRow key={i} entry={entry} />
            ))}
          </ul>
        ) : (
          <p className="season-detail-empty">No per-object data for this night.</p>
        )}
        <div className="season-ix">
          {night.interactions ? (
            <ul className="season-ix-list">
              {INTERACTION_DISPLAY.filter(([key]) => night.interactions![key] !== undefined).map(([key, label]) => (
                <li key={key}>
                  <strong>{night.interactions![key]}</strong> {label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="season-detail-empty">Interactions: — (night predates interaction tracking)</p>
          )}
        </div>
      </div>
    </details>
  )
}

export default async function SeasonPage({
  searchParams,
}: {
  searchParams: { hotel?: string; type?: string; from?: string; to?: string; sort?: string }
}) {
  const secret = debugSecret()
  const cookie = cookies().get(DEBUG_COOKIE_NAME)?.value
  const authorized = secret !== undefined && verifyDebugCookie(cookie, secret, Date.now())
  if (!authorized) {
    return <SeasonUnauthorized configured={secret !== undefined} />
  }

  // ---- filters (also the server-side query bounds) ----
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const from = searchParams.from && DATE_RE.test(searchParams.from) ? searchParams.from : null
  const to = searchParams.to && DATE_RE.test(searchParams.to) ? searchParams.to : null
  const hotelFilter = searchParams.hotel || null
  const typeFilter = searchParams.type === 'hotel' || searchParams.type === 'event' ? searchParams.type : null
  const sortKey: HotelSortKey =
    searchParams.sort === 'events' || searchParams.sort === 'peak' ? searchParams.sort : 'unique'

  // ---- queries (read-only; date filters bound the Session query) ----
  const sessions = await prisma.session.findMany({
    where: {
      ...(hotelFilter ? { hotelId: hotelFilter } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    select: { id: true, date: true, hotelId: true, status: true, cancellationReason: true },
    orderBy: { date: 'desc' },
  })
  const sessionIds = sessions.map((s) => s.id)

  const stackRuns =
    sessionIds.length > 0
      ? await prisma.stackRun.findMany({
          where: { sessionId: { in: sessionIds } },
          select: {
            sessionId: true,
            source: true,
            startedAt: true,
            endedAt: true,
            objectId: true,
            objectName: true,
            objectType: true,
            confidence: true,
            hasInRangeRunnerUp: true,
            latestFrameId: true,
          },
        })
      : []

  // Final-run duration fallback: ONLY open runs need a frame time (see
  // lib/season-data's duration rule — Session.endedAt is cron-stamped and
  // would inflate the last object of every night).
  const openFrameIds = stackRuns
    .filter((r) => r.endedAt === null && r.latestFrameId !== null)
    .map((r) => r.latestFrameId as string)
  const frames =
    openFrameIds.length > 0
      ? await prisma.frame.findMany({
          where: { id: { in: openFrameIds } },
          select: { id: true, ingestedAt: true },
        })
      : []
  const frameTimes: Record<string, Date> = {}
  for (const f of frames) frameTimes[f.id] = f.ingestedAt

  // All viewer rows (tiny table — one row per night per season); assembly joins
  // hotel rows by exact eventKey and appends event-scope rows as their own
  // nights. Interactions are fetched for exactly the keys the nights can have.
  const viewerStats = await prisma.viewerStatsNightly.findMany({
    select: {
      eventKey: true,
      scope: true,
      date: true,
      hotelId: true,
      eventSlug: true,
      unique: true,
      maxConcurrent: true,
      source: true,
      capturedAt: true,
    },
  })
  const nightKeys = [
    ...sessions.map((s) => `${s.date}:${s.hotelId}`),
    ...viewerStats.filter((v) => v.scope === 'event').map((v) => v.eventKey),
  ]
  const interactions =
    nightKeys.length > 0
      ? await prisma.eventInteractionStats.findMany({
          where: { eventKey: { in: nightKeys } },
          select: { eventKey: true, interactionKey: true, objectId: true, count: true },
        })
      : []

  const season = assembleSeason({ sessions, stackRuns, viewerStats, interactions, frameTimes })

  // Post-assembly filters: type (event nights have no Session, so the Session
  // query can't bound them) and — for event nights only — hotel/date bounds the
  // Session query already applied to hotel nights.
  let nights = season.nights
  if (typeFilter) nights = nights.filter((n) => n.type === typeFilter)
  if (hotelFilter) nights = nights.filter((n) => n.type === 'hotel' && n.hotelId === hotelFilter)
  if (from) nights = nights.filter((n) => n.date >= from)
  if (to) nights = nights.filter((n) => n.date <= to)

  const hotels = sortHotels(season.hotels, sortKey)
  // Array.from (not iterator spread): the build's TS target predates es2015
  // iteration — same constraint that shaped sanitizeDemoName's regex.
  const hotelOptions = Array.from(new Set(season.nights.filter((n) => n.hotelId).map((n) => n.hotelId as string))).sort()

  // Consent divider position: nights are newest-first, so the divider renders
  // before the FIRST pre-consent night — and only when both sides are visible.
  const hasPost = nights.some((n) => !n.preConsent)
  const hasPre = nights.some((n) => n.preConsent)

  const sortHref = (key: HotelSortKey) => {
    const p = new URLSearchParams()
    if (hotelFilter) p.set('hotel', hotelFilter)
    if (typeFilter) p.set('type', typeFilter)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    p.set('sort', key)
    return `/season?${p.toString()}`
  }

  return (
    <main className="season-root">
      <header className="season-header">
        <h1>Season overview</h1>
        <p className="season-sub">Operator view · read-only archive</p>
      </header>

      {/* ---- season summary strip ---- */}
      <section className="season-summary" aria-label="Season summary">
        <div className="season-stat">
          <span className="season-stat-num">{season.summary.totalEvents}</span>
          <span className="season-stat-label">events{season.summary.cancelledCount > 0 ? ` (+${season.summary.cancelledCount} cancelled)` : ''}</span>
        </div>
        <div className="season-stat">
          <span className="season-stat-num">{season.summary.totalUnique}</span>
          <span className="season-stat-label">unique viewers</span>
        </div>
        <div className="season-stat">
          <span className="season-stat-num">{season.summary.avgUnique ?? '—'}</span>
          <span className="season-stat-label">
            avg / night ({season.summary.measuredNights} of {season.summary.totalEvents} measured)
          </span>
        </div>
        {/* Best night split at the consent boundary — a single headline would
            always be a pre-consent artifact (those counts included every tab). */}
        <div className="season-stat">
          <span className="season-stat-num">{season.summary.bestBefore?.unique ?? '—'}</span>
          <span className="season-stat-label">
            best night · pre-consent
            {season.summary.bestBefore
              ? ` (${fmtDate(season.summary.bestBefore.date)}${
                  season.summary.bestBefore.hotelId ? `, ${hotelDisplayName(season.summary.bestBefore.hotelId)}` : season.summary.bestBefore.eventSlug ? `, ${season.summary.bestBefore.eventSlug}` : ''
                })`
              : ''}
          </span>
        </div>
        <div className="season-stat">
          <span className="season-stat-num">{season.summary.bestAfter?.unique ?? '—'}</span>
          <span className="season-stat-label">
            best night · consent-gated
            {season.summary.bestAfter
              ? ` (${fmtDate(season.summary.bestAfter.date)}${
                  season.summary.bestAfter.hotelId ? `, ${hotelDisplayName(season.summary.bestAfter.hotelId)}` : ''
                })`
              : ''}
          </span>
        </div>
      </section>

      {/* ---- per-hotel rollups (THE renewal table) ---- */}
      <section className="season-hotels" aria-label="Per-hotel rollup">
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th>
                <a href={sortHref('events')} className={sortKey === 'events' ? 'is-sorted' : ''}>events</a>
              </th>
              <th>
                <a href={sortHref('unique')} className={sortKey === 'unique' ? 'is-sorted' : ''}>avg unique</a>
              </th>
              <th>
                <a href={sortHref('peak')} className={sortKey === 'peak' ? 'is-sorted' : ''}>avg peak</a>
              </th>
              <th>measured</th>
            </tr>
          </thead>
          <tbody>
            {hotels.map((h) => (
              <tr key={h.hotelId}>
                <td>{hotelDisplayName(h.hotelId)}</td>
                <td className="season-num">{h.events}</td>
                <td className="season-num">
                  {h.avgUnique ?? '—'}
                  {h.mixedConsent ? <sup title="Mixes pre- and post-consent nights — counting basis changed 26-07-2026">†</sup> : null}
                </td>
                <td className="season-num">
                  {h.avgPeak ?? '—'}
                  {h.mixedConsent ? <sup>†</sup> : null}
                </td>
                <td className="season-num">
                  {h.measuredNights} of {h.events}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---- filters ---- */}
      <form className="season-filters" method="get" action="/season">
        <label>
          Venue{' '}
          <select name="hotel" defaultValue={hotelFilter ?? ''}>
            <option value="">all</option>
            {hotelOptions.map((id) => (
              <option key={id} value={id}>
                {hotelDisplayName(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type{' '}
          <select name="type" defaultValue={typeFilter ?? ''}>
            <option value="">all</option>
            <option value="hotel">hotel nights</option>
            <option value="event">special events</option>
          </select>
        </label>
        <label>
          From <input type="date" name="from" defaultValue={from ?? ''} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={to ?? ''} />
        </label>
        <button type="submit">Apply</button>
        <a className="season-filters-clear" href="/season">
          clear
        </a>
      </form>

      {/* ---- night list ---- */}
      <section className="season-nights" aria-label="Event nights">
        <div className="season-nights-head" aria-hidden="true">
          <span className="season-cell season-cell--date">date</span>
          <span className="season-cell season-cell--venue">venue</span>
          <span className="season-cell season-cell--type">type</span>
          <span className="season-cell season-cell--num">unique</span>
          <span className="season-cell season-cell--num">peak</span>
          <span className="season-cell season-cell--num">objects</span>
          <span className="season-cell season-cell--flags"></span>
        </div>
        {nights.map((night, i) => {
          const prev = nights[i - 1]
          const showDivider = hasPre && hasPost && night.preConsent && (!prev || !prev.preConsent)
          return (
            <div key={night.eventKey}>
              {showDivider ? (
                <div className="season-divider" role="note">
                  measurement change — consent gating deployed {fmtDate(CONSENT_BOUNDARY_DATE)}: counts above include
                  consenting guests only; counts below include every tab. Not comparable across this line.
                </div>
              ) : null}
              <NightRow night={night} />
            </div>
          )
        })}
        {nights.length === 0 ? <p className="season-detail-empty">No nights match these filters.</p> : null}
      </section>

      <footer className="season-footnotes">
        <p>
          A “viewer” is a browser tab that polled the live page, not a person. Averages are computed over measured
          nights only — nights before the snapshot system (16-07-2026) are listed as “no viewer stats”, never counted
          as zero. † mixes pre- and post-consent nights. ~ durations are derived from the night’s last received frame.
          Early-season numbers may also include the operator’s own testing on /live (day-long attribution, no consent
          gate at the time) — treat pre-16-07-adjacent counts as upper bounds in renewal conversations.
        </p>
      </footer>
    </main>
  )
}
