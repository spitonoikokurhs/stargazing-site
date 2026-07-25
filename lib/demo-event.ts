// Self-running simulated-event definition for the /demo/[slug] sales pages
// (in-person hotel pitches). Pure + deterministic: given a wall-clock time it
// computes exactly where the looping "event" is, so every viewer sees the same
// point of the loop with NO session state, NO Redis, NO writes. Consumed by
// app/api/demo-status/route.ts (which turns a phase into a StatusResponse) and
// app/demo/[slug]/page.tsx (branding).
//
// Frames are REAL archived astrophotography already in /public/images, each
// paired with the catalog id it actually depicts (verified against the existing
// ?demo= mappings in LiveView) so the real catalog card/pills/facts render and
// nothing is mislabelled — these pitches are to astronomy-literate hoteliers.

// ---- Branding: slug -> display name ----
// hotelDisplayName (lib/live-copy.ts) already title-cases unknown slugs, but the
// demo needs exact marketing names, so they live here and the endpoint sets the
// response hotelId to the SLUG while the page shows the mapped name. Unknown
// slug -> 'generic' ("Your Hotel"), never a broken page. Add a slug by adding a
// line here.
export const DEMO_HOTELS: Record<string, string> = {
  mandarin: 'Mandarin Oriental Bodrum',
  titanic: 'Titanic Deluxe Bodrum',
  maxxroyal: 'Maxx Royal Bodrum',
  mett: 'METT Bodrum',
  plaza: 'The Plaza Bodrum',
  mgallery: 'MGallery The Bodrum',
  sirene: 'Sirene Bodrum',
  allium: 'Allium Bodrum',
  susona: 'Susona Bodrum',
  sixsenses: 'Six Senses Kaplankaya',
  generic: 'Your Hotel',
}

export function demoHotelName(slug: string): string {
  return DEMO_HOTELS[slug] ?? DEMO_HOTELS.generic
}

// Resolve any requested slug to a known one (falls back to 'generic'), so the
// endpoint and page always operate on a valid slug and the branding is stable.
export function resolveDemoSlug(slug: string | null | undefined): string {
  if (slug && Object.prototype.hasOwnProperty.call(DEMO_HOTELS, slug)) return slug
  return 'generic'
}

// ---- The scripted loop ----
// A ~60-90s starting phase, then 4-5 target segments (~90-120s each). Each
// target: the catalog id (drives the real card), the real frame image, and a
// plausible accumulated-exposure figure that ticks up within the segment.
export type DemoTarget = {
  catalogId: string
  blobUrl: string
  // Seconds of accumulated exposure shown at the START of this target's
  // segment; it grows across the segment (see demoAccumulatedTime) so the
  // "X min stacked" figure visibly climbs like a real stack.
  startAccumulatedSeconds: number
}

export const DEMO_STARTING_MS = 75_000 // starting screen (living sky + crosshair)
export const DEMO_SEGMENT_MS = 105_000 // each target segment

// Real frames, each GENUINELY depicting its catalog id — no mislabels. This is
// deliberately limited to the three archived shots that actually match a
// catalog object (Orion / Triangulum / Trifid): the pitch is to
// astronomy-literate hoteliers, so a card reading "Ring Nebula, a tiny ring"
// over an image of a spiral galaxy (which the older ?demo= mapping does, pairing
// M57/M27 with unrelated galaxy JPEGs) is a credibility risk not worth taking
// for extra variety. The loop repeats these three, which reads as a full night;
// each segment is long enough (~105s) that the repeat isn't obvious in a pitch.
//
// TO EXTEND (your call on return): add more entries here ONLY when the image
// genuinely depicts the catalogId. If you drop in real archived frames of e.g.
// M57/M27/M8/M51/M101, add them here and they'll slot straight into the loop.
export const DEMO_TARGETS: DemoTarget[] = [
  { catalogId: 'M42', blobUrl: '/images/nebula-orion-m42.jpg', startAccumulatedSeconds: 240 },
  { catalogId: 'M33', blobUrl: '/images/galaxy-triangulum-m33.jpg', startAccumulatedSeconds: 300 },
  { catalogId: 'M20', blobUrl: '/images/nebula-trifid-m20.jpg', startAccumulatedSeconds: 180 },
]

export const DEMO_LOOP_MS = DEMO_STARTING_MS + DEMO_TARGETS.length * DEMO_SEGMENT_MS

// Where the loop is at a given wall-clock ms. `starting` phase, or a target
// segment with its index. `intoSegmentMs` lets the accumulated-time tick.
export type DemoPhase =
  | { kind: 'starting'; intoMs: number }
  | { kind: 'target'; index: number; intoSegmentMs: number }

// Pure position from wall clock. position = now % loopDuration, so the whole
// loop cycles forever and every device is in sync.
export function demoPhaseAt(nowMs: number): DemoPhase {
  const pos = ((nowMs % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS
  if (pos < DEMO_STARTING_MS) return { kind: 'starting', intoMs: pos }
  const afterStart = pos - DEMO_STARTING_MS
  const index = Math.min(DEMO_TARGETS.length - 1, Math.floor(afterStart / DEMO_SEGMENT_MS))
  return { kind: 'target', index, intoSegmentMs: afterStart - index * DEMO_SEGMENT_MS }
}

// Jump the loop to a named stage for presenting (?stage=starting or ?stage=N,
// 1-based target index). Returns the wall-clock offset to feed demoPhaseAt so
// the rest of the pipeline is unchanged. null for an unrecognised value.
export function demoStageOffsetMs(stage: string | null | undefined): number | null {
  if (!stage) return null
  if (stage === 'starting') return 0
  const n = Number(stage)
  if (Number.isInteger(n) && n >= 1 && n <= DEMO_TARGETS.length) {
    // Land a little into the segment so accumulated time isn't at its floor.
    return DEMO_STARTING_MS + (n - 1) * DEMO_SEGMENT_MS + Math.floor(DEMO_SEGMENT_MS / 3)
  }
  return null
}

// Accumulated exposure for a target segment: starts at the target's floor and
// climbs ~1s per real second into the segment, capped at the segment length so
// it reads like a live stack building up.
export function demoAccumulatedTime(target: DemoTarget, intoSegmentMs: number): number {
  return target.startAccumulatedSeconds + Math.floor(intoSegmentMs / 1000)
}

// The history entries that have accumulated by a given phase: every target
// BEFORE the current one is a completed run, plus the current one as active —
// exactly how the real history strip fills across a night, resetting when the
// loop restarts. startedAt/endedAt are synthesised from the phase so ordering
// is stable; the caller stamps concrete ISO strings from a base time.
export function demoCompletedTargetCount(phase: DemoPhase): number {
  return phase.kind === 'starting' ? 0 : phase.index
}
