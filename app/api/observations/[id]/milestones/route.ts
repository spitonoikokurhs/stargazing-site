import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { MilestoneSeconds } from '@/lib/detect-transition'

// Node runtime: Prisma read. Public, unauthenticated (mirrors /api/status —
// this is guest-facing data, not a write path).
export const runtime = 'nodejs'

// Every response is uncacheable — milestone frames update live as a stack
// run progresses, same discipline as /api/status.
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

type MilestoneFrame = { blobUrl: string; capturedAt: string } | null

// Returns the milestone frames (First=0s, 2min=120s, 5min=300s — see
// MILESTONE_SECONDS in lib/detect-transition.ts) for the CURRENT stack run
// of the given Observation, or null for any mark not yet reached — the
// client's job is to gracefully disable/hide a null mark's button, never
// show a broken/empty/mislabeled frame. "Current stack run" is scoped by
// Observation.lastStackRunStartedAt (see app/api/ingest/route.ts's tagging
// logic) exactly the same way ingest scopes its own tagged-marks query — a
// null lastStackRunStartedAt (pre-migration row, or an observation that
// never had a confirmed reset) is treated as "the whole observation is one
// run," matching ingest's own fallback.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const observation = await prisma.observation.findUnique({
      where: { id },
      select: { id: true, lastStackRunStartedAt: true, endedAt: true },
    })
    if (!observation) {
      return json({ error: 'not found' }, 404)
    }

    const runStart = observation.lastStackRunStartedAt
    const milestoneFrames = await prisma.frame.findMany({
      where: {
        observationId: observation.id,
        stackMilestone: { not: null },
        ...(runStart !== null ? { ingestedAt: { gte: runStart } } : {}),
      },
      select: { blobUrl: true, capturedAt: true, stackMilestone: true, ingestedAt: true },
      orderBy: { ingestedAt: 'asc' },
    })

    // Keyed by mark for O(1) lookup below. If a mark somehow has more than
    // one tagged frame (shouldn't happen given ingest's own dedup-by-mark
    // logic, but this endpoint reads independently and must stay correct
    // even if that invariant is ever violated), the EARLIEST one wins — it's
    // the frame that was actually at that mark first.
    const byMark = new Map<MilestoneSeconds, { blobUrl: string; capturedAt: Date }>()
    for (const f of milestoneFrames) {
      const mark = f.stackMilestone as MilestoneSeconds
      if (!byMark.has(mark)) byMark.set(mark, { blobUrl: f.blobUrl, capturedAt: f.capturedAt })
    }

    const marks: Record<'first' | 'twoMin' | 'fiveMin', MilestoneFrame> = {
      first: toMilestoneFrame(byMark.get(0)),
      twoMin: toMilestoneFrame(byMark.get(120)),
      fiveMin: toMilestoneFrame(byMark.get(300)),
    }

    return json({
      observationId: observation.id,
      open: observation.endedAt === null,
      marks,
    })
  } catch (e) {
    console.error('/api/observations/[id]/milestones unexpected error', e)
    // Degrade rather than fail the whole client — the caller's fallback is
    // simply "no milestone frames available yet," same as a not-yet-reached
    // mark; the live view itself is unaffected either way.
    return json({ error: 'internal' }, 500)
  }
}

function toMilestoneFrame(f: { blobUrl: string; capturedAt: Date } | undefined): MilestoneFrame {
  if (!f) return null
  return { blobUrl: f.blobUrl, capturedAt: f.capturedAt.toISOString() }
}
