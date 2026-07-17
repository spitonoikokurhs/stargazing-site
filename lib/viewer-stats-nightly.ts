import { prisma } from '@/lib/db'
import { readViewerStats, type ViewerScope, type Source } from '@/lib/redis'

// Persists (upserts) the CURRENT viewer-stats counters for one event's Redis
// keys into the durable ViewerStatsNightly table (see the model in
// prisma/schema.prisma). Shared by two callers so the snapshot logic lives in
// exactly one place:
//   - /api/finish, at the deliberate "the night is over" trigger (a live
//     snapshot, source="finish").
//   - scripts/backfill-viewer-stats.mjs, reconstructing still-unexpired past
//     nights from surviving Redis keys (source="backfill").
//
// eventKey is the SAME stable per-event key the Redis counters use
// (viewerEventKey "YYYY-MM-DD:<hotelId>" for a hotel night, or
// viewerSpecialEventKey "<slug>:<revealAt>" for a special event), so the
// snapshot maps unambiguously back to the counters it came from. Upsert on the
// unique eventKey means a re-finish or a backfill re-run overwrites the same
// night's row (with fresher numbers) rather than duplicating it.
//
// Best-effort by contract: returns the persisted metrics on success, or null
// on any failure (Redis read error, DB write error) — callers treat null as
// "snapshot skipped," never as a reason to fail their own primary action
// (finishing the night, or the rest of the backfill run).
export async function snapshotViewerStatsNightly(params: {
  scope: ViewerScope
  slug: Source | null
  eventKey: string
  // Denormalized descriptors stored alongside the counters for easy querying
  // (?date= browsing, season review) without re-parsing eventKey.
  date: string | null // Athens "YYYY-MM-DD" for a hotel night; null for a multi-day special event
  hotelId: string | null // hotel slug for a hotel night; null for a special event
  eventSlug: string | null // special-event slug for scope="event"; null for a hotel night
  source: 'finish' | 'backfill'
}): Promise<{ unique: number; maxConcurrent: number } | null> {
  try {
    const stats = await readViewerStats(params.scope, params.slug, params.eventKey)
    await prisma.viewerStatsNightly.upsert({
      where: { eventKey: params.eventKey },
      create: {
        eventKey: params.eventKey,
        scope: params.scope,
        date: params.date,
        hotelId: params.hotelId,
        eventSlug: params.eventSlug,
        unique: stats.unique,
        maxConcurrent: stats.maxConcurrent,
        source: params.source,
      },
      update: {
        // Refresh the counters and re-stamp capturedAt/source on re-run; the
        // scope/date/hotelId/eventSlug descriptors are stable for a given
        // eventKey so they don't need updating, but we set them anyway to
        // self-heal a row first written with partial descriptors.
        scope: params.scope,
        date: params.date,
        hotelId: params.hotelId,
        eventSlug: params.eventSlug,
        unique: stats.unique,
        maxConcurrent: stats.maxConcurrent,
        source: params.source,
        capturedAt: new Date(),
      },
    })
    return { unique: stats.unique, maxConcurrent: stats.maxConcurrent }
  } catch (e) {
    console.error('snapshotViewerStatsNightly failed', e)
    return null
  }
}
