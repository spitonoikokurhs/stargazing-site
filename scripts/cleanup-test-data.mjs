#!/usr/bin/env node
// Delete a night's test/smoke data for one source, scoped by Athens date.
//
// Usage:
//   node scripts/cleanup-test-data.mjs <date> <source> [--execute] [--force]
//   e.g. node scripts/cleanup-test-data.mjs 2026-07-03 pegasus
//        node scripts/cleanup-test-data.mjs 2026-07-03 pegasus --execute
//
// Default is a DRY RUN: reports what would be deleted (counts, blob paths,
// session hotelId/status) and deletes nothing. Pass --execute to perform it.
//
// Deletion order (mirrors the ingest write path in reverse):
//   blobs via del() -> Frames -> Observations -> Session -> redis keys
// The redis latest key (live:latest:<source>) is always cleared; the shared
// live:active-source key is cleared ONLY if it currently points at <source>.
//
// Safety: a session is deleted only if removing <source>'s observations leaves
// it with none — a session shared with another source is kept.
//
// Live-session guard: if any in-scope frame was ingested within the last 60
// minutes, --execute refuses (a real event may be in progress) unless --force
// is also passed. Real events run most nights.

import { PrismaClient } from '@prisma/client'
import { Redis } from '@upstash/redis'
import { del } from '@vercel/blob'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- env: no auto-load for plain node scripts, so parse the dotenv files
// ourselves (no new dependency). Precedence matches Next.js:
// real process.env  >  .env.local  >  .env. We only set keys not already set,
// and load .env.local before .env so the former wins between the two files.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
function loadEnv(file) {
  let text
  try {
    text = readFileSync(join(repoRoot, file), 'utf8')
  } catch {
    return // file absent is fine
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    if (key in process.env) continue // real env wins
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}
loadEnv('.env.local')
loadEnv('.env')

// Deliberately restricted to the two real hotel devices (not special-event
// slugs from config/extra-events.json) — this is a destructive cleanup
// command, so it intentionally does NOT grow automatically as new event
// slugs are added; keep in sync with HOTEL_SOURCES in lib/redis.ts (kept
// literal to avoid importing a TS module with a path alias from a plain .mjs).
const SOURCES = ['pegasus', 'seestar']
const RECENT_MS = 60 * 60 * 1000 // live-session guard window
const ACTIVE_SOURCE_KEY = 'live:active-source'

function die(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

const [date, source, ...flags] = process.argv.slice(2)
const execute = flags.includes('--execute')
const force = flags.includes('--force')
for (const f of flags) {
  if (f !== '--execute' && f !== '--force') die(`unknown flag: ${f}`, 2)
}
if (!date || !source) {
  die('usage: node scripts/cleanup-test-data.mjs <date> <source> [--execute] [--force]', 1)
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`date must be YYYY-MM-DD, got: ${date}`, 1)
if (!SOURCES.includes(source)) die(`source must be one of: ${SOURCES.join(', ')}`, 1)

const prisma = new PrismaClient()
const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL,
  token: process.env.UPSTASH_KV_REST_API_TOKEN,
})

const mode = execute ? 'EXECUTE' : 'DRY RUN'
console.log(`================ cleanup-test-data (${mode}) ================`)
console.log(`date=${date}  source=${source}${force ? '  --force' : ''}\n`)

// --- gather scope: date -> sessions -> this-source observations -> frames ---
const sessions = await prisma.session.findMany({
  where: { date },
  select: { id: true, date: true, hotelId: true, status: true },
})
const sessionIds = sessions.map((s) => s.id)

const observations = await prisma.observation.findMany({
  where: { sessionId: { in: sessionIds }, source },
  select: { id: true, sessionId: true, objectName: true },
})
const obsIds = observations.map((o) => o.id)
const scopedSessionIds = [...new Set(observations.map((o) => o.sessionId))]

const frames = await prisma.frame.findMany({
  where: { observationId: { in: obsIds } },
  select: { id: true, blobPath: true, thumbnailPath: true, ingestedAt: true },
})

// A session is deletable only if it has no observations from OTHER sources.
const foreign = await prisma.observation.groupBy({
  by: ['sessionId'],
  where: { sessionId: { in: scopedSessionIds }, source: { not: source } },
  _count: { _all: true },
})
const sharedSessionIds = new Set(foreign.map((g) => g.sessionId))
const deletableSessions = sessions.filter(
  (s) => scopedSessionIds.includes(s.id) && !sharedSessionIds.has(s.id),
)
const keptSessions = sessions.filter(
  (s) => scopedSessionIds.includes(s.id) && sharedSessionIds.has(s.id),
)

// --- redis state ---
const latestKey = `live:latest:${source}`
const latestPresent = (await redis.get(latestKey)) != null
const activeSourceVal = await redis.get(ACTIVE_SOURCE_KEY)
const activeSourcePointsHere = activeSourceVal === source

// --- report ---
console.log(`SESSIONS on ${date} (${sessions.length}):`)
for (const s of sessions) {
  const tag = deletableSessions.includes(s)
    ? 'DELETE'
    : keptSessions.includes(s)
      ? 'KEEP (shared with another source)'
      : 'KEEP (no in-scope observations)'
  console.log(`  ${s.id}  hotel=${s.hotelId}  status=${s.status}  -> ${tag}`)
}

console.log(`\nOBSERVATIONS (${source}): ${observations.length}`)
console.log(`FRAMES (${source}): ${frames.length}`)
for (const f of frames) {
  console.log(`  blob: ${f.blobPath}${f.thumbnailPath ? `\n  thumb: ${f.thumbnailPath}` : ''}`)
}

console.log(`\nREDIS:`)
console.log(`  ${latestKey} = ${latestPresent ? 'present -> DELETE' : 'absent'}`)
console.log(
  `  ${ACTIVE_SOURCE_KEY} = ${activeSourceVal ?? '(absent)'}` +
    (activeSourcePointsHere ? ' -> DELETE (points at this source)' : ' -> KEEP'),
)

// --- live-session guard ---
const now = Date.now()
const recent = frames.filter((f) => now - new Date(f.ingestedAt).getTime() < RECENT_MS)
if (recent.length > 0) {
  console.log(
    `\n⚠️  ${recent.length} frame(s) ingested within the last 60 min — a live session may be in progress.`,
  )
  if (execute && !force) {
    die('REFUSING to execute without --force. Re-run with --force if you are sure.', 5)
  }
}

if (!execute) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --execute to perform the deletion.')
  await prisma.$disconnect()
  process.exit(0)
}

// --- execute, in order: blobs -> Frames -> Observations -> Session -> redis ---
const counts = { blobs: 0, thumbnails: 0, frames: 0, observations: 0, sessions: 0, redisKeys: 0 }

for (const f of frames) {
  if (f.blobPath) {
    await del(f.blobPath)
    counts.blobs++
  }
  if (f.thumbnailPath) {
    await del(f.thumbnailPath)
    counts.thumbnails++
  }
}
counts.frames = (await prisma.frame.deleteMany({ where: { id: { in: frames.map((f) => f.id) } } })).count
counts.observations = (await prisma.observation.deleteMany({ where: { id: { in: obsIds } } })).count
counts.sessions = (
  await prisma.session.deleteMany({ where: { id: { in: deletableSessions.map((s) => s.id) } } })
).count
if (latestPresent && (await redis.del(latestKey))) counts.redisKeys++
if (activeSourcePointsHere && (await redis.del(ACTIVE_SOURCE_KEY))) counts.redisKeys++

console.log('\n================ DELETION COUNTS ================')
console.log(`blobs deleted:        ${counts.blobs} (+${counts.thumbnails} thumbnails)`)
console.log(`frames deleted:       ${counts.frames}`)
console.log(`observations deleted: ${counts.observations}`)
console.log(`sessions deleted:     ${counts.sessions}`)
console.log(`redis keys deleted:   ${counts.redisKeys}`)

await prisma.$disconnect()
