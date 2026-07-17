// Backfill the durable ViewerStatsNightly table from whatever viewer-stats
// Redis keys are STILL UNEXPIRED (the counters carry a 48h TTL — see
// VIEWER_STATS_TTL_S in lib/redis.ts — so only the last couple of nights can
// ever be recovered this way; anything older is already gone and cannot be
// reconstructed). Idempotent: upserts on the unique eventKey, so re-running is
// safe and just refreshes each row. Reports real per-night counts.
//
// This exists so nights that ended BEFORE the finish-trigger snapshot shipped
// (or any night whose /api/finish snapshot failed) still get archived, as long
// as their Redis keys haven't aged out yet. Going forward, /api/finish writes
// the snapshot live and this script is only a safety net.
//
// Run with: node --env-file=.env.local --import tsx scripts/backfill-viewer-stats.mjs
//
// The unique-set key shape it scans (see viewerKeys in lib/redis.ts):
//   hotel:  live:viewers:hotel:unique:<YYYY-MM-DD>:<hotelId>
//   event:  live:viewers:event:<slug>:unique:<slug>:<revealAt>
import { redis } from '../lib/redis.ts'
import { snapshotViewerStatsNightly } from '../lib/viewer-stats-nightly.ts'

// Scan (not KEYS — never block Redis) every unique-viewers set still present.
async function scanUniqueKeys() {
  let cursor = 0
  const keys = []
  do {
    const [next, batch] = await redis.scan(cursor, { match: 'live:viewers:*:unique:*', count: 200 })
    cursor = Number(next)
    keys.push(...batch)
  } while (cursor !== 0)
  return keys.sort()
}

// Reconstruct the snapshot descriptors from a unique-set key. Returns null for
// any key shape we don't recognize (so a stray/legacy key can't crash the run).
function parseUniqueKey(key) {
  // Hotel: live:viewers:hotel:unique:<YYYY-MM-DD>:<hotelId>
  const hotel = key.match(/^live:viewers:hotel:unique:(\d{4}-\d{2}-\d{2}):(.+)$/)
  if (hotel) {
    const [, date, hotelId] = hotel
    return {
      scope: 'hotel',
      slug: null,
      eventKey: `${date}:${hotelId}`, // === viewerEventKey(date, hotelId)
      date,
      hotelId,
      eventSlug: null,
    }
  }
  // Special event: live:viewers:event:<slug>:unique:<slug>:<revealAt>
  const event = key.match(/^live:viewers:event:([^:]+):unique:(.+)$/)
  if (event) {
    const [, slug, eventKeyTail] = event // eventKeyTail === "<slug>:<revealAt>"
    return {
      scope: 'event',
      slug,
      eventKey: eventKeyTail, // === viewerSpecialEventKey(slug, revealAt)
      date: null,
      hotelId: null,
      eventSlug: slug,
    }
  }
  return null
}

async function main() {
  console.log('Scanning production Redis for surviving viewer-stats keys...\n')
  const keys = await scanUniqueKeys()
  console.log(`Found ${keys.length} unique-viewers key(s) still unexpired:`)
  for (const k of keys) console.log('  ' + k)
  console.log('')

  let written = 0
  let skipped = 0
  for (const key of keys) {
    const parsed = parseUniqueKey(key)
    if (!parsed) {
      console.log(`SKIP  unrecognized key shape: ${key}`)
      skipped++
      continue
    }
    const result = await snapshotViewerStatsNightly({ ...parsed, source: 'backfill' })
    if (result) {
      console.log(
        `WROTE ${parsed.eventKey}  (scope=${parsed.scope}, unique=${result.unique}, maxConcurrent=${result.maxConcurrent})`,
      )
      written++
    } else {
      console.log(`FAIL  snapshot returned null for ${parsed.eventKey}`)
      skipped++
    }
  }

  console.log(`\n=== Backfill complete: ${written} row(s) written, ${skipped} skipped ===`)
  process.exit(0)
}

main().catch((e) => {
  console.error('Backfill failed:', e)
  process.exit(1)
})
