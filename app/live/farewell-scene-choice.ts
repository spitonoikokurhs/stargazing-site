// Per-CLIENT random pick between the two farewell scenes (UFO vs. eclipse).
//
// Deliberately DISTINCT from pickFarewellVariant in lib/live-farewell.ts, which
// is per-EVENT-NIGHT deterministic (every guest + the lobby TV see the SAME
// closer, seeded off the date). This picker is the opposite by design: it's
// random PER GUEST/DEVICE, stable for that guest for the whole night, so two
// guests at the same event can get different scenes and compare them — the
// intended "conversation moment." pickFarewellVariant is left entirely
// untouched (the UFO path still flows through it unchanged).
//
// Stability: the 50/50 roll happens ONCE, the first time a given client enters
// the finished state for a given event date, and is persisted in sessionStorage
// keyed by that date. A refresh (or re-opening the page mid-farewell) re-reads
// the stored choice rather than re-rolling, so a guest who got the eclipse keeps
// the eclipse. Keyed by date so the next scheduled night rolls fresh.

export type FarewellScene = 'ufo' | 'eclipse'

const STORAGE_PREFIX = 'farewell-scene:'

function storageKey(eventDate: string): string {
  return `${STORAGE_PREFIX}${eventDate}`
}

// Resolve which scene THIS client shows for the given event date. Reads a prior
// stored choice if present; otherwise rolls 50/50, persists it, and returns it.
//
// forced (from the ?scene= demo override — only ever non-null under
// demo=finished, see forcedSceneFromQuery) is a TESTING override ONLY: it
// short-circuits the roll for this render but is deliberately NOT persisted, so
// forcing a scene to inspect it can never poison the real random choice stored
// for that date. It also does not READ the stored value, so a forced test
// always shows exactly the scene asked for regardless of what a prior real
// visit rolled.
//
// SSR/no-storage safe: with no window (server render) it returns a deterministic
// default ('ufo') without touching storage, so the first client paint matches
// until the effect-driven client resolve runs; if sessionStorage throws
// (private-mode quirks), it degrades to an un-persisted in-memory roll rather
// than breaking the farewell.
export function resolveFarewellScene(eventDate: string, forced?: FarewellScene | null): FarewellScene {
  if (forced === 'ufo' || forced === 'eclipse') {
    return forced // testing override only — not persisted, does not touch the real stored choice
  }
  if (typeof window === 'undefined') return 'ufo'
  const stored = tryRead(eventDate)
  if (stored) return stored
  const rolled: FarewellScene = Math.random() < 0.5 ? 'ufo' : 'eclipse'
  tryPersist(eventDate, rolled)
  return rolled
}

function tryRead(eventDate: string): FarewellScene | null {
  try {
    const v = window.sessionStorage.getItem(storageKey(eventDate))
    return v === 'ufo' || v === 'eclipse' ? v : null
  } catch {
    return null
  }
}

function tryPersist(eventDate: string, scene: FarewellScene): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(storageKey(eventDate), scene)
  } catch {
    // sessionStorage unavailable (private mode / blocked) — the choice just
    // won't persist across refreshes; the scene still renders fine this load.
  }
}

// Parse the ?scene= testing override into a forced scene, or null. Honored
// ONLY when ?demo=finished is ALSO present — a real production
// /live?scene=eclipse must NOT bypass the random per-guest rule, so the override
// is scoped strictly to the demo-finished testing route. Bare ?demo=finished
// with no ?scene= (or any non-demo URL) yields null and falls through to the
// real per-client random selection.
export function forcedSceneFromQuery(): FarewellScene | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('demo') !== 'finished') return null // override only valid on the demo-finished route
  const raw = params.get('scene')
  return raw === 'ufo' || raw === 'eclipse' ? raw : null
}
