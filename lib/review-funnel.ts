// Review / testimonial funnel — the constants, the venue-aware WhatsApp prefill,
// and the guest-facing copy. Pure (no I/O, no window) so the URL/prefill logic
// is unit-testable; the React reveals that use it live in the farewell scenes.
//
// TWO ENTRANCES, ONE DESTINATION (per the locked spec):
//   • BASELINE (everyone, after the scene settles): offers BOTH — WhatsApp
//     (visually first, the lead-capture path) and a Google review. Dismissible,
//     never reappears.
//   • FINDER (easter-egg finders, after the finale completes): a single
//     finder-flavoured review ask → REVIEW_URL. Finders are the most delighted
//     guests, so their enthusiasm goes where it's publicly visible.

import { hotelDisplayName } from '@/lib/live-copy'

// Google review form (public review — where finder enthusiasm and baseline
// reviews land).
export const REVIEW_URL = 'https://g.page/r/CQMsZrOvq_kLEBI/review'

// Social follow links shown on the farewell funnel. Instagram = follow-for-more
// (guests); LinkedIn = collaboration/partnership proposals (hotels, venues).
// utm tags attribute the follow to the live farewell screen specifically.
export const INSTAGRAM_URL =
  'https://instagram.com/mixalre?utm_source=live_farewell&utm_medium=website&utm_campaign=farewell_follow'
export const LINKEDIN_URL =
  'https://www.linkedin.com/in/michalis-reisis-stargazing/?utm_source=live_farewell&utm_medium=website&utm_campaign=farewell_connect'

// WhatsApp lead-capture number. The message text is a per-venue prefill built by
// whatsappUrl() below; this is the base the ?text= is appended to.
const WHATSAPP_BASE = 'https://wa.me/306947772928'

// Build the WhatsApp deep-link with a venue-aware prefilled message. When we
// know tonight's venue (hotelId present and resolvable), the guest opens
// WhatsApp with e.g. "Hi! I was at tonight's stargazing event at OKU Kos" ready
// to send; otherwise a generic prefill (D rider's fallback: special events or an
// unresolved venue never produce a wrong venue name). Always returns a valid
// wa.me URL — the prefill is a convenience, never required.
export function whatsappUrl(hotelId: string | null | undefined): string {
  const venue = hotelId ? hotelDisplayName(hotelId) : null
  const message = venue
    ? `Hi! I was at tonight's stargazing event at ${venue}`
    : `Hi! I was at tonight's stargazing event`
  return `${WHATSAPP_BASE}?text=${encodeURIComponent(message)}`
}

// ---- Guest-facing copy (premium, calm tone — "a guest, not a banner") ----
export const FUNNEL_COPY = {
  // Baseline block: one warm line, then the two actions (WhatsApp first).
  // No dismiss string: the baseline block auto-fades after ~30s untouched
  // (see ReviewFunnel.tsx) instead of asking the guest to tap anything.
  baseline: {
    lead: 'Enjoyed tonight?',
    sub: "We'd love a few words.",
    whatsapp: 'Message us on WhatsApp',
    review: 'Leave a review',
  },
  // Finder block: they found the secret, so the copy acknowledges it.
  finder: {
    lead: 'You found the secret.',
    sub: 'Tell us about your night.',
    review: 'Share your review',
  },
} as const
