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

// Read the durable interaction rows for one event window (the read endpoint's
// source). Returns the per-counter rows plus a convenience byKey rollup
// (counters summed across objectIds per interaction key). Best-effort: returns
// empty on any DB error. LIVE (still-buffering) counters aren't merged in here —
// the read endpoint reads the durable table, which the periodic cron keeps
// current to within ~5 min; a caller wanting the absolute live edge can also
// read Redis, but the season/calendar consumer this feeds wants the durable rows.
export async function readDurableInteractionStats(eventKey: string): Promise<{
  rows: { counterField: string; interactionKey: string; objectId: string | null; count: number }[]
  byKey: Record<string, number>
}> {
  try {
    const rows = await prisma.eventInteractionStats.findMany({
      where: { eventKey },
      select: { counterField: true, interactionKey: true, objectId: true, count: true },
      orderBy: { counterField: 'asc' },
    })
    const byKey: Record<string, number> = {}
    for (const r of rows) {
      byKey[r.interactionKey] = (byKey[r.interactionKey] ?? 0) + r.count
    }
    return { rows, byKey }
  } catch (e) {
    console.error('readDurableInteractionStats failed', e)
    return { rows: [], byKey: {} }
  }
}

// Archive read for a PAST hotel night by Athens date (?date= on the read
// endpoint — the interaction sibling of /api/viewer-stats' archive branch).
// Rows carry their eventKey/hotelId because one date can legitimately hold
// MORE THAN ONE eventKey:
//   - "<date>:<hotelId>" — the real scheduled night (hotelId set);
//   - "<date>:hotel"     — the fallback bucket (hotelId null), fed by e.g. a
//     guest lingering past midnight (their beacons re-key onto the NEW date
//     with no scheduled event — same date-keying the viewer-stats system has
//     by design) or an unscheduled ad-hoc session.
// CONSUMER CAVEAT (season/calendar view): rows with hotelId === null under a
// date that ALSO has a real hotelId'd night are midnight-straggler noise, not
// a second event — group by eventKey and don't present the fallback bucket as
// a night of its own unless it's the only bucket the date has.
export async function readDurableInteractionStatsByDate(date: string): Promise<{
  rows: {
    eventKey: string
    hotelId: string | null
    counterField: string
    interactionKey: string
    objectId: string | null
    count: number
  }[]
  byKey: Record<string, number>
  eventKeys: string[]
}> {
  try {
    const rows = await prisma.eventInteractionStats.findMany({
      where: { date, scope: 'hotel' },
      select: {
        eventKey: true,
        hotelId: true,
        counterField: true,
        interactionKey: true,
        objectId: true,
        count: true,
      },
      orderBy: [{ eventKey: 'asc' }, { counterField: 'asc' }],
    })
    const byKey: Record<string, number> = {}
    const eventKeys: string[] = []
    for (const r of rows) {
      byKey[r.interactionKey] = (byKey[r.interactionKey] ?? 0) + r.count
      if (!eventKeys.includes(r.eventKey)) eventKeys.push(r.eventKey)
    }
    return { rows, byKey, eventKeys }
  } catch (e) {
    console.error('readDurableInteractionStatsByDate failed', e)
    return { rows: [], byKey: {}, eventKeys: [] }
  }
}

// Range read for the private /stats operator page: every hotel-scoped interaction
// row whose Athens date falls inside [from, to] (inclusive). Powers the per-night
// table with a hotel filter. Hotel scope only (special events are date-independent
// and read via ?event= on their own stable key), so a season/date view never mixes
// them in. Rows keep their date/hotelId/eventKey so the caller can group by night
// and by venue — AND correctly handle the midnight-straggler caveat documented on
// readDurableInteractionStatsByDate (a hotelId===null bucket sharing a date with a
// real hotel night is leftover noise, not a venue of its own). Best-effort:
// returns [] on any DB error, so the page renders "no data" rather than breaking.
export async function readDurableInteractionStatsInRange(
  from: string,
  to: string,
): Promise<{
  rows: {
    date: string | null
    eventKey: string
    hotelId: string | null
    counterField: string
    interactionKey: string
    objectId: string | null
    count: number
  }[]
}> {
  try {
    const rows = await prisma.eventInteractionStats.findMany({
      where: { scope: 'hotel', date: { gte: from, lte: to } },
      select: {
        date: true,
        eventKey: true,
        hotelId: true,
        counterField: true,
        interactionKey: true,
        objectId: true,
        count: true,
      },
      orderBy: [{ date: 'desc' }, { hotelId: 'asc' }, { counterField: 'asc' }],
    })
    return { rows }
  } catch (e) {
    console.error('readDurableInteractionStatsInRange failed', e)
    return { rows: [] }
  }
}
