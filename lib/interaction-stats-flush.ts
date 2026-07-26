import { prisma } from '@/lib/db'
import { readInteractionStats } from '@/lib/interaction-stats'
import { parseCounterField } from '@/lib/interaction-events'
import type { InteractionScope } from '@/lib/interaction-stats'

// Flushes (upserts) the CURRENT Tier-1 interaction counters for one event's
// Redis hash into the durable EventInteractionStats table (see the model in
// prisma/schema.prisma). The interaction-side analogue of
// snapshotViewerStatsNightly — same best-effort contract, same eventKey identity.
//
// Called from:
//   - /api/finish, at the deliberate "the night is over" trigger (source="finish")
//   - the periodic cron app/api/cron/flush-interactions (source="periodic"),
//     every ~5 min during event hours, so a crash loses minutes not the night.
//
// IDEMPOTENT overwrite (rider B): each counter is upserted on the unique
// (eventKey, counterField) — the stored `count` is Redis's ABSOLUTE tally, so a
// re-flush overwrites with the fresher absolute value rather than adding. Two
// overlapping flushes therefore converge on the same numbers; there is no
// additive race. A field that fails parseCounterField (not a known key) is
// skipped, so a stray hash field can never become a row.
//
// Best-effort: returns the number of counters flushed, or null on any failure
// (Redis read or DB write) — callers treat null as "flush skipped," never a
// reason to fail their own primary action.
export async function flushInteractionStats(
  scope: InteractionScope,
  source: 'finish' | 'periodic' | 'backfill',
): Promise<{ flushed: number } | null> {
  try {
    const counters = await readInteractionStats(scope.eventKey)
    const fields = Object.entries(counters)
    if (fields.length === 0) return { flushed: 0 }

    let flushed = 0
    for (const [counterField, count] of fields) {
      const parsed = parseCounterField(counterField)
      if (!parsed) continue // stray/unknown field — never becomes a row
      if (!Number.isFinite(count)) continue

      await prisma.eventInteractionStats.upsert({
        where: { eventKey_counterField: { eventKey: scope.eventKey, counterField } },
        create: {
          eventKey: scope.eventKey,
          counterField,
          interactionKey: parsed.key,
          objectId: parsed.objectId,
          count,
          scope: scope.scope,
          date: scope.date,
          hotelId: scope.hotelId,
          eventSlug: scope.eventSlug,
          source,
        },
        update: {
          // Overwrite with the fresh absolute tally; re-stamp source/updatedAt.
          // Descriptors are stable per eventKey but set anyway to self-heal a row
          // first written with partial descriptors (same pattern as the viewer flush).
          count,
          interactionKey: parsed.key,
          objectId: parsed.objectId,
          scope: scope.scope,
          date: scope.date,
          hotelId: scope.hotelId,
          eventSlug: scope.eventSlug,
          source,
          updatedAt: new Date(),
        },
      })
      flushed += 1
    }
    return { flushed }
  } catch (e) {
    console.error('flushInteractionStats failed', e)
    return null
  }
}
