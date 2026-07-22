// Registry + deterministic picker for the /live "finished" screen's farewell
// animation. Currently one variant (the Aegean UFO scene); adding a second
// or third is meant to be "write the component, add one entry below" — no
// changes needed anywhere else (StatusScreen just renders whichever variant
// pickFarewellVariant() returns).
//
// Seeding: picked ONCE PER EVENT NIGHT, not per page load/refresh — every
// guest phone and the lobby TV independently compute the same pick from the
// same seed (today's Athens calendar date, YYYY-MM-DD, already returned by
// /api/status's finished branch), so everyone at tonight's event sees the
// same closer, and it naturally changes on the next scheduled night with no
// new server-side state. Deliberately NOT Math.random() per render, which
// would flicker between variants on every refresh.

import { hotelDisplayName, hotelLogoSrc } from '@/lib/live-copy'
import { athensWeekday } from '@/lib/schedule'

export type FarewellVariantId = 'aegean-ufo'

export const FAREWELL_VARIANT_IDS: FarewellVariantId[] = ['aegean-ufo']

// A short, warm sentence that sits above the real schedule line (see
// formatNextSessionLines below) — pure atmosphere, no facts, so it can be
// picked from a pool without any of them needing to stay accurate over time.
// Picked from the SAME per-event-night seed as pickFarewellVariant (not
// per-render/Math.random()), so every guest phone and the lobby TV show the
// same line together, and it naturally rotates to a different one on the
// next scheduled night with no new server-side state.
const NEXT_SESSION_LEAD_LINES = [
  'Until the next clear sky.',
  'The night will open again.',
  'More stars are waiting for you.',
  'We’ll save you a place under the sky.',
  'The universe will be here when you return.',
  'Another sky story is waiting.',
  'Next time, we look deeper.',
  'Tonight ends, but the sky continues.',
  'The island sky will be waiting.',
  'One night ends. The universe does not.',
  'The night sky has more stories to tell.',
]

// Small, stable string hash (djb2) — good enough for picking an index out of
// a short array, not a cryptographic requirement. Deterministic across every
// browser/device for the same input string, which is the only property that
// actually matters here.
function hashString(s: string): number {
  let hash = 5381
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33) ^ s.charCodeAt(i)
  }
  return hash >>> 0 // unsigned
}

export function pickFarewellVariant(seed: string): FarewellVariantId {
  const ids = FAREWELL_VARIANT_IDS
  return ids[hashString(seed) % ids.length]
}

// Deliberately a SEPARATE hash call from pickFarewellVariant (not reusing its
// result/index) — the two pools are different lengths, and mixing indices
// across them would create an artificial correlation between which farewell
// variant plays and which lead line shows, for no reason. A distinct seed
// suffix ("|lead") keeps the two picks independent while still being stable
// and per-event-night.
function pickNextSessionLeadLine(seed: string): string {
  const lines = NEXT_SESSION_LEAD_LINES
  return lines[hashString(`${seed}|lead`) % lines.length]
}

export type NextSessionLines = { lead: string; schedule: string; logoSrc: string | null } | null

// Two-line "next session" copy for the farewell screen: a rotating warm lead
// line, and underneath it the real schedule — weekday, start–end time (24h,
// Athens-local), and the venue name (via hotelDisplayName). Deliberately NOT
// "Every Tuesday..." — the actual schedule only runs on dark-of-moon weeks
// and can shift week to week (a hotel occasionally swaps its night), so
// `next` is always the REAL computed next occurrence, not a recurring-
// pattern promise; the line states that one specific date truthfully rather
// than implying a fixed weekly slot.
//
// logoSrc reuses the SAME hotelId -> logo mapping as the offline/status
// screen's badge (hotelLogoSrc in lib/live-copy.ts) — null for a hotel with
// no logo asset yet, in which case the caller renders text only, same
// graceful-absence pattern the status screen already uses.
//
// seed should be the SAME per-event-night seed passed to pickFarewellVariant
// (today's Athens calendar date), so the lead line is stable across every
// guest's phone and the lobby TV for the whole night, per this file's
// seeding convention.
export function formatNextSessionLines(
  seed: string,
  next: { date: string; hotelId: string; start: string; end: string } | null,
): NextSessionLines {
  if (!next) return null
  const weekday = athensWeekday(next.date) // shared Athens-weekday mechanism (see lib/schedule.ts)
  const venue = hotelDisplayName(next.hotelId)
  return {
    lead: pickNextSessionLeadLine(seed),
    schedule: `${weekday}, ${next.start}–${next.end} here at ${venue}.`,
    logoSrc: hotelLogoSrc(next.hotelId),
  }
}

// Warm, calm fallback for when there's no known next session at all (e.g.
// outside the season, or none found within the lookup window) — vague but
// true, matching the screen's poetic tone rather than leaving a blank gap
// or an awkward "next session: unknown."
export const NO_NEXT_SESSION_LINE = 'We’ll be back under these skies soon.'
