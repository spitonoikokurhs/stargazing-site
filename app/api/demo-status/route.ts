import { NextRequest, NextResponse } from 'next/server'
import catalogData from '@/config/catalog.json'
import type { CatalogObject } from '@/lib/catalog'
import {
  DEMO_TARGETS,
  DEMO_STARTING_MS,
  DEMO_SEGMENT_MS,
  demoPhaseAt,
  demoStageOffsetMs,
  demoAccumulatedTime,
  demoCompletedTargetCount,
  resolveDemoSlug,
  sanitizeDemoName,
  type DemoPhase,
} from '@/lib/demo-event'

// Self-running simulated-event feed for the /demo/[slug] sales pages. Drives the
// exact same LiveView the real /live uses (via its statusUrl seam), so the demo
// is visually indistinguishable from a real event.
//
// CONTRACT — this endpoint is:
//   - READ-ONLY and STATELESS: it computes the current scripted state purely
//     from the wall clock (position = now % loopDuration). No Redis, no
//     Postgres, no session, no writes anywhere.
//   - ANALYTICS-INERT: it never calls trackViewer and never reads/records any
//     viewerId, so a demo can never pollute real viewer stats or event data.
//   - fully isolated from /live and /api/status: a bug here cannot touch real
//     live state.
export const runtime = 'nodejs'
// Never statically cached — the response depends on the current instant.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const CATALOG = (catalogData as { objects: CatalogObject[] }).objects
const CATALOG_BY_ID = new Map(CATALOG.map((o) => [o.id, o]))

function json(body: unknown) {
  // no-store so the looping state is always fresh; nothing here is cacheable.
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

// The objectMatch payload for a catalog id — the SAME shape resolveObjectMatch
// produces in /api/status, so LiveView renders the real card/pills/facts. High
// confidence, no runner-up: a curated demo target is unambiguous by design.
function objectMatchForCatalog(obj: CatalogObject) {
  return {
    name: obj.primaryName,
    confidence: 'high' as const,
    hasInRangeRunnerUp: false,
    description: obj.description,
    type: obj.type,
    ...(obj.constellation ? { constellation: obj.constellation } : {}),
    ...(obj.distanceLy ? { distanceLy: obj.distanceLy } : {}),
    ...(obj.sizeDescription ? { sizeDescription: obj.sizeDescription } : {}),
    ...(obj.wowFacts ? { wowFacts: obj.wowFacts } : {}),
    ...(obj.visualHint ? { visualHint: obj.visualHint } : {}),
    ...(obj.drawer ? { drawer: obj.drawer } : {}),
  }
}

// Timestamps are anchored to REAL now, not the (possibly frozen, via ?stage)
// loop position — otherwise the frame's ingestedAt would look ancient and
// LiveView would treat it as a perpetually-stale frame and never settle. We
// place the CURRENT run's start at `realNow - intoSegmentMs` (so it started
// `intoSegmentMs` ago, matching the accumulated-time figure and staying recent
// and STABLE across polls at the same phase), and lay prior runs back-to-back
// before it. currentRunStartMs is that anchor.
function currentRunStartMs(realNow: number, phase: DemoPhase): number {
  const into = phase.kind === 'target' ? phase.intoSegmentMs : 0
  return realNow - into
}
function segmentStartedAtIso(realNow: number, phase: DemoPhase, index: number): string {
  // index === current -> currentRunStartMs; earlier runs each one segment before.
  const currentIndex = phase.kind === 'target' ? phase.index : 0
  const start = currentRunStartMs(realNow, phase) - (currentIndex - index) * DEMO_SEGMENT_MS
  return new Date(start).toISOString()
}
function segmentEndedAtIso(realNow: number, phase: DemoPhase, index: number): string {
  return new Date(new Date(segmentStartedAtIso(realNow, phase, index)).getTime() + DEMO_SEGMENT_MS).toISOString()
}

// Build the accumulated history for the current phase: every target BEFORE the
// current one is a completed run; the current one is active. Mirrors how the
// real strip fills across a night and resets when the loop restarts.
function buildHistory(phase: DemoPhase, realNow: number) {
  const activeIndex = phase.kind === 'target' ? phase.index : -1
  const entries = []
  const upTo = phase.kind === 'target' ? phase.index : -1
  for (let i = 0; i <= upTo; i++) {
    const t = DEMO_TARGETS[i]
    const obj = CATALOG_BY_ID.get(t.catalogId)
    if (!obj) continue
    const isActive = i === activeIndex
    entries.push({
      id: `demo-run-${i}`,
      objectId: obj.id,
      objectName: obj.primaryName,
      objectType: obj.type,
      confidence: 'high',
      hasInRangeRunnerUp: false,
      startedAt: segmentStartedAtIso(realNow, phase, i),
      endedAt: isActive ? null : segmentEndedAtIso(realNow, phase, i),
      blobUrl: t.blobUrl,
      active: isActive,
    })
  }
  return entries
}

export function GET(req: NextRequest) {
  try {
    const slug = resolveDemoSlug(req.nextUrl.searchParams.get('demo'))

    // ?name=<text> override: brand for an unplanned venue by editing the URL.
    // Sanitized + length-capped (see sanitizeDemoName). When present it becomes
    // the response hotelId, which hotelDisplayName renders as-is — so
    // /demo/generic?name=Sunset%20Palace shows "Sunset Palace". Falls back to
    // the slug's mapped name when absent/blank.
    const brandingId = sanitizeDemoName(req.nextUrl.searchParams.get('name')) ?? slug

    // ?stage= override (presenter convenience): jump the LOOP POSITION to a
    // named stage. Absent -> the real wall clock drives the loop on its own.
    // CRUCIALLY, only the loop POSITION uses the stage offset; all displayed
    // TIMESTAMPS use the real clock (`now`) so a staged frame never looks
    // ancient (which would make LiveView treat it as perpetually stale).
    const stageOffset = demoStageOffsetMs(req.nextUrl.searchParams.get('stage'))
    const now = Date.now()
    const positionNow = stageOffset === null ? now : stageOffset
    const phase = demoPhaseAt(positionNow)

    // STARTING phase: the living-sky "session starting up" screen. Shaped like
    // /api/status's starting response so LiveView renders StartingScreen. tonight
    // carries the demo slug as hotelId so the venue branding shows; next is null
    // (a demo has no real schedule).
    if (phase.kind === 'starting') {
      return json({
        live: false,
        starting: true,
        tonight: { hotelId: brandingId, start: '21:30', end: '23:30', cancelled: false },
        next: null,
      })
    }

    // TARGET phase: a live frame for this segment's real object.
    const target = DEMO_TARGETS[phase.index]
    const obj = CATALOG_BY_ID.get(target.catalogId)
    if (!obj) {
      // Should never happen (curated ids), but degrade to starting rather than 500.
      return json({
        live: false,
        starting: true,
        tonight: { hotelId: brandingId, start: '21:30', end: '23:30', cancelled: false },
        next: null,
      })
    }

    const accumulated = demoAccumulatedTime(target, phase.intoSegmentMs)
    const nowIso = new Date(now).toISOString() // fresh — frame never looks stale
    const history = buildHistory(phase, now)
    const stackRunStartedAt = segmentStartedAtIso(now, phase, phase.index)

    return json({
      live: true,
      // hotelId-as-source is fine: LiveView treats source as an opaque string.
      source: slug,
      frame: {
        // Stable per (slug, target index) so the image doesn't reload/flicker on
        // every poll — the accumulated-time figure still ticks via telemetry.
        frameId: `demo-${slug}-run-${phase.index}`,
        blobUrl: target.blobUrl,
        capturedAt: nowIso,
        ingestedAt: nowIso,
      },
      observation: { observationId: `demo-obs-${phase.index}`, objectName: obj.primaryName },
      sessionId: `demo-session-${slug}`,
      // hotelId surfaced so branding (hotelDisplayName / logo) renders; the demo
      // page maps the slug to its marketing name via lib/demo-event.
      hotelId: brandingId,
      viewers: null,
      history,
      stackRunStartedAt,
      telemetry: {
        state: 'IMAGE_STACK_RUNNING',
        totalAccumulatedTime: accumulated,
        astrometryState: 'solved',
      },
      objectMatch: objectMatchForCatalog(obj),
    })
  } catch {
    // Never 500 a sales demo — degrade to a benign offline shape.
    return json({ live: false, tonight: null, next: null })
  }
}
