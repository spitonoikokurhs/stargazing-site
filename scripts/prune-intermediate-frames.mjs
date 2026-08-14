// Prune redundant intermediate telescope frames from Vercel Blob + the DB.
//
// WHY: /api/ingest stores every ~10s frame during an event and NOTHING ever
// deletes them, so Blob storage grows without bound (hit ~82% of the 1 GB free
// tier after one month). The guest-facing surfaces only ever show a small
// subset; the every-10s intermediate captures are dead weight once a run ends.
//
// WHAT IT KEEPS (the "keep set" — never deleted):
//   1. Any frame that is some StackRun.latestFrameId — the final display frame
//      for that run. This is what the observations gallery, /observations, and
//      the /live history strip render. Keeping ALL runs' latest frames (not
//      just the newest per object) means older nights' history stays intact.
//   2. Any milestone frame (stackMilestone != null: 0/120/300 = First/2min/5min)
//      — powers the /live milestone toggle's stacking-progression replay.
//
// WHAT IT DELETES: every other frame — pure intermediate regular frames that
// are neither a run's final image nor a milestone. Nobody can view these.
//
// SAFETY:
//   - DRY RUN BY DEFAULT. Prints exactly what it WOULD delete and proves every
//     gallery object's display frame survives. Pass --commit to actually delete.
//   - The keep set is recomputed at run time (not cached from an earlier
//     analysis), so it reflects the DB as-is at deletion.
//   - Deletes the Blob object FIRST, then the DB row, per frame. If the Blob
//     delete fails, the row is left (so we never have a DB row whose blob is
//     gone silently — the next run retries it). A already-missing blob (404)
//     is treated as success (the goal — free the space — is met).
//   - Never touches thumbnails logic (there are none today) beyond deleting a
//     frame's own thumbnailPath if present.
//   - Bounded batch with a short delay so a big prune doesn't hammer the API.
//
// RUN:
//   node --import tsx scripts/prune-intermediate-frames.mjs           # dry run
//   node --import tsx scripts/prune-intermediate-frames.mjs --commit   # delete
//   ... --commit --limit 200    # delete at most 200 (safe incremental prune)

// Load .env.local so BLOB_READ_WRITE_TOKEN (and POSTGRES_PRISMA_URL) are present
// when run as a plain node script — Next.js loads these automatically, a bare
// `node` invocation does not. Must run BEFORE @vercel/blob / prisma read env.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { prisma } from '@/lib/db'
import { del } from '@vercel/blob'

const COMMIT = process.argv.includes('--commit')
const limitArg = process.argv.find((a) => a.startsWith('--limit'))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1], 10) : Infinity

const mb = (b) => (Number(b) / (1024 * 1024)).toFixed(1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log(`\n=== prune-intermediate-frames (${COMMIT ? 'COMMIT — will DELETE' : 'DRY RUN — no deletions'}) ===\n`)

  // --- Build the keep set ---
  const runs = await prisma.stackRun.findMany({
    where: { latestFrameId: { not: null } },
    select: { latestFrameId: true },
  })
  const keepLatest = new Set(runs.map((r) => r.latestFrameId))
  console.log(`Keep-frames from StackRun.latestFrameId: ${keepLatest.size}`)

  // --- Classify every frame ---
  const frames = await prisma.frame.findMany({
    select: { id: true, blobPath: true, thumbnailPath: true, sizeBytes: true, stackMilestone: true },
  })
  const toDelete = []
  let keepBytes = 0
  for (const f of frames) {
    const isKeep = keepLatest.has(f.id) || f.stackMilestone !== null
    if (isKeep) keepBytes += Number(f.sizeBytes || 0)
    else toDelete.push(f)
  }
  const delBytes = toDelete.reduce((s, f) => s + Number(f.sizeBytes || 0), 0)

  console.log(`Total frames: ${frames.length} (${mb(frames.reduce((s, f) => s + Number(f.sizeBytes || 0), 0))} MB)`)
  console.log(`KEEP:   ${frames.length - toDelete.length} frames, ${mb(keepBytes)} MB`)
  console.log(`DELETE: ${toDelete.length} frames, ${mb(delBytes)} MB`)

  // --- Safety proof: gallery display frames survive ---
  const galleryRuns = await prisma.stackRun.findMany({
    where: { objectId: { not: null }, latestFrameId: { not: null }, confidence: { in: ['high', 'medium'] } },
    select: { objectId: true, latestFrameId: true },
    orderBy: { startedAt: 'desc' },
  })
  const perObject = new Map()
  for (const r of galleryRuns) if (!perObject.has(r.objectId)) perObject.set(r.objectId, r.latestFrameId)
  const deleteIds = new Set(toDelete.map((f) => f.id))
  let galleryOk = true
  for (const [obj, fid] of perObject) {
    if (deleteIds.has(fid)) {
      galleryOk = false
      console.log(`  !! ABORT-WORTHY: gallery object ${obj} display frame ${fid} is in the DELETE set`)
    }
  }
  console.log(`\nGallery objects: ${perObject.size} — all display frames survive: ${galleryOk ? 'YES ✓' : 'NO ✗'}`)
  if (!galleryOk) {
    console.log('\nRefusing to proceed: the keep-set logic would drop a visible image. No deletions.')
    await prisma.$disconnect()
    process.exit(1)
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN complete. ${toDelete.length} frames (${mb(delBytes)} MB) would be freed.`)
    console.log('Re-run with --commit to delete. Add "--limit 200" to prune incrementally.\n')
    await prisma.$disconnect()
    return
  }

  // --- Commit: delete blob then row, one at a time, bounded ---
  const batch = toDelete.slice(0, LIMIT === Infinity ? toDelete.length : LIMIT)
  console.log(`\nDeleting ${batch.length} frames${LIMIT !== Infinity ? ` (limited to ${LIMIT})` : ''}...\n`)
  let ok = 0
  let freed = 0
  let failed = 0
  for (const f of batch) {
    try {
      // Delete the blob object(s). del() resolves for an already-absent path,
      // so a missing blob doesn't block freeing the DB row.
      const paths = [f.blobPath, f.thumbnailPath].filter(Boolean)
      if (paths.length) await del(paths)
      await prisma.frame.delete({ where: { id: f.id } })
      ok++
      freed += Number(f.sizeBytes || 0)
      if (ok % 50 === 0) {
        console.log(`  ...${ok}/${batch.length} deleted (${mb(freed)} MB freed)`)
        await sleep(250)
      }
    } catch (e) {
      failed++
      console.log(`  ! failed on frame ${f.id}: ${e?.message ?? e}`)
    }
  }
  console.log(`\nDone. Deleted ${ok} frames, freed ~${mb(freed)} MB. Failures: ${failed}.`)
  if (batch.length < toDelete.length) {
    console.log(`(${toDelete.length - batch.length} more eligible — re-run to continue.)`)
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('prune failed:', e)
  await prisma.$disconnect()
  process.exit(1)
})
