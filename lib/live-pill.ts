// Pure state-machine + copy helpers for the guest-facing live-status pill (see
// components/LiveStatusPill.tsx). Deliberately React-free and side-effect-free so
// the state derivation and the panel wording can be reasoned about (and tested)
// without a DOM or a network. The component owns fetching/polling /api/status
// and passes the raw response shape here; this module decides what the pill says
// and does.
//
// SCOPE: front-end only. Reads the EXISTING /api/status response verbatim — no
// backend/relay/db involvement. hotel-id -> name and the Athens-weekday
// mechanism are reused from their single sources (lib/live-copy, lib/schedule),
// never re-hardcoded here.

import { hotelDisplayName } from '@/lib/live-copy'
import { athensWeekday } from '@/lib/schedule'

// The subset of /api/status this pill reads. /api/status returns more (frame,
// telemetry, history, …) on a live response, but the pill only needs the three
// top-level fields that form its state machine. Everything is optional/loose so
// a partial or older payload degrades gracefully rather than throwing.
export type LiveStatusResponse = {
  live?: boolean
  // Present (non-null) when there IS an event today. cancelled marks a night
  // created-but-called-off (e.g. weather); a cancelled tonight must NOT read as
  // an upcoming "live at" countdown (see deriveLivePillState).
  tonight?: { hotelId: string; start: string; end: string; cancelled?: boolean } | null
  next?: { date: string; hotelId: string; start: string; end: string } | null
  // Set by /api/status when it degraded internally; folded into the neutral
  // fallback, same as a failed fetch.
  degraded?: boolean
}

// The three guest-facing states, plus the neutral fallback. `kind` drives the
// dot color and click behavior; the component renders label/venue/panel from
// the rest.
//   live    -> red pulsing dot,  "Live now",           click => /live
//   tonight -> amber dot,        "Live at HH:MM",       click => /live (pre-event screen)
//   idle    -> gray dot,         "Next: <weekday> HH:MM", click => off-event panel
//   fallback-> gray dot,         "Live",                click => /live (never a broken pill)
export type LivePillState =
  | { kind: 'live'; label: string; href: '/live' }
  | { kind: 'tonight'; label: string; href: '/live' }
  | { kind: 'idle'; label: string; opensPanel: true; panel: NextSessionPanel }
  | { kind: 'fallback'; label: string; href: '/live' }

// Content for the off-event "Next session" panel. Minimal by design — a
// return-decision anchor (day + date + time + venue) and one calm line. NO
// object/capture/showcase content. `line` is composed from the schedule; when
// there's no known next event it degrades to a graceful coming-soon message
// with the schedule fields absent.
export type NextSessionPanel = {
  // e.g. "Thursday 23 July · 21:30 · Paralos Kyma Dunes", or null when no next
  // event is scheduled (component shows the coming-soon copy instead).
  schedule: string | null
  // Always present. "Live telescope views resume then." with a known next
  // event; "Next session coming soon." otherwise.
  resumeLine: string
}

const NEUTRAL_FALLBACK_LABEL = 'Live'
const RESUME_KNOWN = 'Live telescope views resume then.'
const RESUME_UNKNOWN = 'Next session coming soon.'

// Compose the panel's schedule anchor: "Thursday 23 July · 21:30 · <Venue>".
// Reuses athensWeekday (shared mechanism) for the weekday, the raw start string
// (already Athens-local 24h HH:MM, shown verbatim like every other event time
// on the site — no new tz convention), and hotelDisplayName (single source of
// truth) for the venue. Day-of-month + month name are the calendar anchor a
// return-decision needs, which the farewell "Thursday, 21:30–22:30 here at…"
// line deliberately omits. Formatted in the Athens zone to match the weekday.
function composeNextSessionSchedule(next: NonNullable<LiveStatusResponse['next']>): string {
  const weekday = athensWeekday(next.date)
  // Day + month ("23 July") in the Athens zone, from the same midnight-UTC parse
  // of the bare YYYY-MM-DD event date athensWeekday uses.
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${next.date}T00:00:00Z`))
  const venue = hotelDisplayName(next.hotelId)
  return `${weekday} ${dayMonth} · ${next.start} · ${venue}`
}

// Build the off-event panel content from `next` (nullable). Split out so the
// idle state and any "no next event" degradation share one composer.
export function buildNextSessionPanel(next: LiveStatusResponse['next']): NextSessionPanel {
  if (!next) {
    return { schedule: null, resumeLine: RESUME_UNKNOWN }
  }
  return { schedule: composeNextSessionSchedule(next), resumeLine: RESUME_KNOWN }
}

// THE state machine. Maps a /api/status response (or null, when the fetch
// failed / hasn't returned yet) to exactly one LivePillState.
//
// Order matters:
//   1. null response OR degraded flag -> neutral fallback (never a broken pill).
//   2. live === true                  -> live.
//   3. an event today that is NOT cancelled -> tonight ("Live at <start>").
//      A CANCELLED tonight is deliberately skipped: an amber countdown on a
//      called-off night would mislead guests, so it falls through to idle/next.
//   4. otherwise                      -> idle, opening the next-session panel.
export function deriveLivePillState(res: LiveStatusResponse | null): LivePillState {
  // 1. No data or server-degraded: neutral, still clickable to /live.
  if (res === null || res.degraded === true) {
    return { kind: 'fallback', label: NEUTRAL_FALLBACK_LABEL, href: '/live' }
  }

  // 2. Live now.
  if (res.live === true) {
    return { kind: 'live', label: 'Live now', href: '/live' }
  }

  // 3. Event today, not cancelled -> upcoming countdown to its start time.
  const tonight = res.tonight
  if (tonight && tonight.cancelled !== true) {
    return { kind: 'tonight', label: `Live at ${tonight.start}`, href: '/live' }
  }

  // 4. Idle: no event today (or tonight cancelled) -> next-session panel.
  const next = res.next ?? null
  const label = next ? `Next: ${athensWeekday(next.date)} ${next.start}` : NEUTRAL_FALLBACK_LABEL
  return { kind: 'idle', label, opensPanel: true, panel: buildNextSessionPanel(next) }
}
