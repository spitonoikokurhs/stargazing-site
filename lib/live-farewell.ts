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

export type FarewellVariantId = 'aegean-ufo'

export const FAREWELL_VARIANT_IDS: FarewellVariantId[] = ['aegean-ufo']

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

// "Monday, 21:30" — human weekday + 24h start time, computed in Athens time
// so it matches the schedule's own timezone regardless of the guest's
// device locale/timezone. Separate from the offline state's raw-ISO-date
// "Next session: 2026-07-13, 21:30" line (lib/live-status.ts callers) —
// this is deliberately friendlier copy for the farewell screen specifically.
export function formatNextSessionLabel(next: { date: string; start: string } | null): string | null {
  if (!next) return null
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    weekday: 'long',
  }).format(new Date(`${next.date}T00:00:00Z`))
  return `Next session: ${weekday}, ${next.start}`
}
