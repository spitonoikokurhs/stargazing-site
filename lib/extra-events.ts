import extraEventsData from '@/config/extra-events.json'

// Special events: one-off broadcasts outside the recurring weekly hotel
// schedule (config/schedule.json) — a star party, a private group, anything
// that isn't a regular hotel night. Keyed by "event slug" — this SAME slug
// doubles as the ingest `source` value (see lib/redis.ts's isValidSource) and
// as the resolved event behind the ONE fixed /live/special-event route (see
// resolveSpecialEvent below and app/live/special-event/page.tsx), so a single
// string identifies the event everywhere: relay -> ingest -> status -> page.
// hotelId is a fixed, dedicated value (never derived from date), which is
// what keeps a special event from ever colliding with a real hotel's
// scheduled night on the same calendar date (see app/api/ingest/route.ts).
//
// Adding a new special event is config-only: a new entry here is immediately
// a valid ingest source, gets its own isolated Session, and — once its
// revealAt/endsAt window arrives — is automatically what /live/special-event
// resolves to (see resolveSpecialEvent). No code changes anywhere.
export type ExtraEvent = {
  hotelId: string
  label: string
  // ISO 8601 with explicit offset — when the mystery gate lifts and
  // /live/special-event starts behaving like a normal live page for this
  // event.
  revealAt: string
  // ISO 8601 with explicit offset — when this event stops being eligible for
  // /live/special-event to resolve to (see resolveSpecialEvent). A direct
  // link to a specific past event isn't a supported flow for special events
  // (unlike hotels' /live, there's no per-event permalink) — once endsAt
  // passes, this entry simply falls out of consideration.
  endsAt: string
  // Optional logo shown on the mystery gate (public/images/logos/*) — see
  // MysteryGate.tsx. Omit for a special event with no logo; the gate renders
  // without one rather than a broken image.
  logoSrc?: string
}

const extraEvents = extraEventsData as Record<string, ExtraEvent>

export function extraEventFor(slug: string): ExtraEvent | null {
  return extraEvents[slug] ?? null
}

export function isExtraEventSlug(slug: string): boolean {
  return slug in extraEvents
}

// What /live/special-event (the one fixed, permanent URL — see that route)
// resolves to at a given instant. Pure date-math over config/extra-events.json,
// re-evaluated on every request — no stored "current event" pointer anywhere,
// so a config change takes effect on the very next page load.
//
// Priority, in order:
//   1. ACTIVE: revealAt <= now < endsAt. If more than one entry's window
//      somehow overlaps (a config mistake — windows are meant to be
//      non-overlapping), the one with the earliest revealAt wins, so the
//      result is always deterministic rather than depending on object key
//      iteration order.
//   2. UPCOMING: revealAt > now, none active. The soonest revealAt wins —
//      this is what lets a guest scan the permanent QR code days before an
//      event and land on its mystery gate rather than a blank state.
//   3. Neither: null — the route shows its neutral "no special event right
//      now" state (see NoSpecialEvent in app/live/special-event/page.tsx).
export function resolveSpecialEvent(now: Date = new Date()): { slug: string; event: ExtraEvent } | null {
  const t = now.getTime()
  const entries = Object.entries(extraEvents)

  const active = entries
    .filter(([, e]) => new Date(e.revealAt).getTime() <= t && t < new Date(e.endsAt).getTime())
    .sort((a, b) => new Date(a[1].revealAt).getTime() - new Date(b[1].revealAt).getTime())
  if (active.length > 0) {
    const [slug, event] = active[0]
    return { slug, event }
  }

  const upcoming = entries
    .filter(([, e]) => new Date(e.revealAt).getTime() > t)
    .sort((a, b) => new Date(a[1].revealAt).getTime() - new Date(b[1].revealAt).getTime())
  if (upcoming.length > 0) {
    const [slug, event] = upcoming[0]
    return { slug, event }
  }

  return null
}
