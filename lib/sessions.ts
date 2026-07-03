import { prisma } from '@/lib/db'
import { athensToday } from '@/lib/schedule'

const SAME_DAY_STALE_MS = 6 * 60 * 60 * 1000 // 6h — comfortably longer than a ~1h event plus slack

// Closes Sessions that are still "active" but are definitely over. Called by
// the daily /api/cron/close-sessions cron, NOT by /api/status — Session.status
// is pure bookkeeping (the /live page's live/offline determination is
// entirely Redis-freshness-based, see app/api/status/route.ts), so this can
// run once a day rather than on the hot polling path.
//
// A session matches (OR'd):
//   1. status='active' AND date < today       — any active session dated
//      yesterday-or-older is definitively over, regardless of updatedAt.
//   2. status='active' AND date = today AND updatedAt < now-6h — a same-day
//      session closes only once untouched for 6+ hours, safely longer than a
//      real event (~1h) plus slack, so this can never close a session that's
//      merely between frames.
//
// Safety by construction: even if this ever closes a session prematurely,
// /api/ingest reactivates ANY non-active session the moment a new frame
// arrives (see app/api/ingest/route.ts, "Reality beats paperwork"). So a
// wrong call here cannot do lasting harm — worst case is a session shows
// "completed" for a few minutes until the next frame flips it back.
export async function closeStaleActiveSessions(): Promise<number> {
  const today = athensToday()
  const staleBefore = new Date(Date.now() - SAME_DAY_STALE_MS)

  const result = await prisma.session.updateMany({
    where: {
      status: 'active',
      endedAt: null, // defensive: ingest always pairs status:'active' with endedAt:null
      OR: [{ date: { lt: today } }, { date: today, updatedAt: { lt: staleBefore } }],
    },
    data: { status: 'completed', endedAt: new Date() },
  })

  return result.count
}
