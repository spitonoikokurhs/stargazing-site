// "Latest observations" — the most recent GOOD capture of each distinct object,
// for the guest-facing gallery on the homepage. One card per object (latest M27,
// latest M13, …), not a flood of every night. Reads live from the DB, so it
// grows itself every night an observation is made.
//
// SAFE BY CONSTRUCTION: fail-open. Any DB error / empty DB returns [] and the
// caller renders nothing (never a broken/empty gallery). Only confident, named,
// image-bearing runs are eligible — the SAME name-gate the live card uses
// (shouldShowMatchName), so the gallery never shows an unnamed or contested run.

import { shouldShowMatchName } from '@/lib/match-display'
import { prisma } from '@/lib/db'
import catalogData from '@/config/catalog.json'
import type { CatalogObject, Confidence } from '@/lib/catalog'

const CATALOG_BY_ID = new Map(
  (catalogData as { objects: CatalogObject[] }).objects.map((o) => [o.id, o]),
)

export type RecentObservation = {
  objectId: string
  name: string // catalog primaryName (falls back to the run's stored objectName)
  type: string // catalog type (falls back to the run's stored objectType)
  constellation: string | null
  imageUrl: string // full-size stacked image (Frame.blobUrl)
  thumbnailUrl: string | null
  observedAt: Date // when this run started (its capture night)
}

// How many distinct objects the gallery shows at most. Generous — a season has
// well under this many distinct named targets, but it caps a runaway query.
const MAX_OBJECTS = 60

export async function latestObservationsPerObject(limit = MAX_OBJECTS): Promise<RecentObservation[]> {
  try {
    // Pull recent named, matched, image-bearing runs, newest first, then reduce
    // to the FIRST (newest) per objectId. We over-fetch a bounded window and
    // dedup in memory rather than a Postgres DISTINCT ON (keeps this portable
    // and the confidence/name gating in one place). latestFrameId -> the run's
    // final stacked frame, which carries the display blobUrl.
    const runs = await prisma.stackRun.findMany({
      where: {
        objectId: { not: null },
        latestFrameId: { not: null },
        confidence: { in: ['high', 'medium'] },
      },
      orderBy: { startedAt: 'desc' },
      take: 800, // bounded scan; plenty to cover every distinct object in a season
      select: {
        objectId: true,
        objectName: true,
        objectType: true,
        confidence: true,
        hasInRangeRunnerUp: true,
        startedAt: true,
        latestFrameId: true,
      },
    })

    // Newest-first reduce to one run per object, applying the same name gate the
    // live card uses (so a contested medium never becomes a public named card).
    const chosen = new Map<string, (typeof runs)[number]>()
    for (const r of runs) {
      if (!r.objectId || chosen.has(r.objectId)) continue
      const named = shouldShowMatchName(
        (r.confidence ?? 'none') as Confidence,
        r.hasInRangeRunnerUp ?? false,
      )
      if (!named) continue
      chosen.set(r.objectId, r)
      if (chosen.size >= limit) break
    }
    if (chosen.size === 0) return []

    // Fetch the display images for the chosen runs' latest frames in one query.
    const frameIds = Array.from(chosen.values()).map((r) => r.latestFrameId!)
    const frames = await prisma.frame.findMany({
      where: { id: { in: frameIds } },
      select: { id: true, blobUrl: true, thumbnailUrl: true },
    })
    const frameById = new Map(frames.map((f) => [f.id, f]))

    const out: RecentObservation[] = []
    for (const r of Array.from(chosen.values())) {
      const frame = r.latestFrameId ? frameById.get(r.latestFrameId) : undefined
      if (!frame?.blobUrl) continue // image missing (pruned/absent) -> skip, don't show a broken card
      const cat = r.objectId ? CATALOG_BY_ID.get(r.objectId) : undefined
      out.push({
        objectId: r.objectId!,
        name: cat?.primaryName ?? r.objectName ?? r.objectId!,
        type: cat?.type ?? r.objectType ?? '',
        constellation: cat?.constellation ?? null,
        imageUrl: frame.blobUrl,
        thumbnailUrl: frame.thumbnailUrl ?? null,
        observedAt: r.startedAt,
      })
    }
    // Already newest-first from the reduce order.
    return out
  } catch {
    // Fail-open: no gallery beats a broken one.
    return []
  }
}
