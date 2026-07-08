import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { put } from '@vercel/blob'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  redis,
  ingestRatelimit,
  isValidSource,
  latestFrameKey,
  EVENT_FINISHED_KEY,
  eventFinishedKey,
  type Source,
} from '@/lib/redis'
import { athensToday, scheduledHotelFor } from '@/lib/schedule'
import { extraEventFor } from '@/lib/extra-events'
import {
  detectTransition,
  nextMilestoneToTag,
  MILESTONE_SECONDS,
  type MilestoneSeconds,
  type ObservationFrameInput,
} from '@/lib/detect-transition'

// Node runtime required: crypto.timingSafeEqual, createHash, Buffer.
export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_METADATA_CHARS = 64 * 1024 // 64KB (chars ~ bytes for the ASCII-ish JSON devices send)
const CAPTURED_AT_MAX_FUTURE_MS = 10 * 60 * 1000 // 10 min
const CAPTURED_AT_MAX_PAST_MS = 24 * 60 * 60 * 1000 // 24 h
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

// Extracts the fields lib/detect-transition.ts's detectTransition needs from
// a raw metadata value — same fields, same lenient shape as the Redis
// telemetry subset built further below, but needed earlier here (inside the
// DB transaction, before the Frame row is created) so stackMilestone can be
// set at insert time rather than backfilled after the fact.
function extractObservationFrameInput(metadata: Prisma.InputJsonValue | null): ObservationFrameInput {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { totalAccumulatedTime: null, raDegrees: null, decDegrees: null }
  }
  const m = metadata as Record<string, unknown>
  return {
    totalAccumulatedTime: typeof m.totalAccumulatedTime === 'number' ? m.totalAccumulatedTime : null,
    raDegrees: typeof m.raDegrees === 'number' ? m.raDegrees : null,
    decDegrees: typeof m.decDegrees === 'number' ? m.decDegrees : null,
  }
}

function isP2002(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

// The unique index behind our dedup guarantee (see migration: CREATE UNIQUE
// INDEX "Frame_source_sha256_key" ON "Frame"("source", "sha256")). P2002.meta
// .target is the constraint name (Postgres) or field list depending on version;
// match either form. A P2002 on any OTHER constraint must NOT be read as dedup.
const FRAME_SHA256_CONSTRAINT = 'Frame_source_sha256_key'
function isFrameSha256Conflict(e: Prisma.PrismaClientKnownRequestError): boolean {
  const target = e.meta?.target
  const asText = Array.isArray(target) ? target.join(',') : typeof target === 'string' ? target : ''
  return asText.includes('sha256') || asText.includes(FRAME_SHA256_CONSTRAINT)
}

// Constant-time bearer-token check. Both sides are sha256-hashed first so
// timingSafeEqual always compares equal-length buffers and cannot throw on
// a length mismatch (which would itself leak length information).
function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(presented, expected)
}

// Best-effort client IP for rate-limit keying and failure logging only — never
// used for auth. x-forwarded-for's first entry is the original client behind
// Vercel's proxy chain; falls back to a fixed key if absent (e.g. local dev)
// so rate limiting still functions (as one shared bucket) rather than no-op.
function clientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)

    // 1. Rate limit BEFORE auth — this must also throttle wrong-token guesses,
    // not just excessive traffic from an already-valid token, so it can't be
    // keyed on the (not-yet-verified) token. Keyed by IP instead: 30 req/min
    // comfortably clears the real relay's cadence (~1 frame per 20-40s per
    // source) even with two sources behind one router, while still bounding
    // a leaked/guessed token's blast radius. Fails OPEN on an Upstash error —
    // dropping real frames at a live event is worse than a brief unthrottled
    // window, so a limiter outage must never block legitimate ingest.
    try {
      const { success } = await ingestRatelimit.limit(ip)
      if (!success) {
        console.warn(`ingest: rate limited at ${new Date().toISOString()} from ${ip}`)
        return NextResponse.json({ error: 'rate limited' }, { status: 429 })
      }
    } catch (e) {
      console.warn(`ingest: ratelimit check failed, failing open at ${new Date().toISOString()}`, e)
    }

    // 2. Auth — fail closed and loud if the secret is not configured.
    const secret = process.env.INGEST_SECRET
    if (!secret) {
      console.error('INGEST_SECRET not configured')
      return NextResponse.json({ error: 'internal' }, { status: 500 })
    }
    if (!authorized(req, secret)) {
      console.warn(`ingest: auth failure at ${new Date().toISOString()} from ${ip}`)
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    // 3. Parse + validate multipart fields.
    const form = await req.formData()

    const image = form.get('image')
    if (!(image instanceof File)) return badRequest('image field is required')
    const mime = image.type
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      return badRequest('image must be image/jpeg or image/png')
    }
    if (image.size > MAX_IMAGE_BYTES) return badRequest('image exceeds 10MB limit')

    const sourceRaw = form.get('source')
    if (typeof sourceRaw !== 'string' || !isValidSource(sourceRaw)) {
      return badRequest('source must be one of: pegasus, seestar')
    }
    const source: Source = sourceRaw

    // Magic-byte check in addition to MIME — the declared type must match
    // what the bytes actually are.
    const bytes = Buffer.from(await image.arrayBuffer())
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)
    if ((mime === 'image/jpeg' && !isJpeg) || (mime === 'image/png' && !isPng)) {
      return badRequest('image bytes do not match declared content type')
    }

    // targetName: trimmed; empty string is treated as absent. Never creates
    // an objectName of "".
    const targetNameRaw = form.get('targetName')
    const targetName =
      typeof targetNameRaw === 'string' && targetNameRaw.trim() !== '' ? targetNameRaw.trim() : null

    // capturedAt: device clocks and relay retries lie. Parse leniently, then
    // discard anything >10 min in the future or >24 h in the past.
    const now = new Date()
    let capturedAt = now
    const capturedAtRaw = form.get('capturedAt')
    if (typeof capturedAtRaw === 'string' && capturedAtRaw !== '') {
      const parsed = new Date(capturedAtRaw)
      if (!Number.isNaN(parsed.getTime())) {
        const delta = parsed.getTime() - now.getTime()
        if (delta <= CAPTURED_AT_MAX_FUTURE_MS && delta >= -CAPTURED_AT_MAX_PAST_MS) {
          capturedAt = parsed
        }
      }
    }

    // metadata: lenient — unparseable or oversized just stores null; a bad
    // metadata string must never fail the request.
    let metadata: Prisma.InputJsonValue | null = null
    const metadataRaw = form.get('metadata')
    if (
      typeof metadataRaw === 'string' &&
      metadataRaw !== '' &&
      metadataRaw.length <= MAX_METADATA_CHARS
    ) {
      try {
        metadata = JSON.parse(metadataRaw)
      } catch {
        metadata = null
      }
    }

    // 4. Hash server-side — never trusted from the client.
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    // 5. Dedup check BEFORE any writes: same source + same bytes → done.
    const existing = await prisma.frame.findUnique({
      where: { source_sha256: { source, sha256 } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ deduped: true, frameId: existing.id }, { status: 200 })
    }

    // 6. Blob upload. If this fails we 500 with nothing written anywhere —
    // the relay retries. Store the RETURNED url/pathname, never the requested
    // path (put() is not guaranteed to honor it verbatim).
    //
    // Session.date semantics: this is the Athens-local date at INGEST time —
    // the event night as the server experienced it, not the device capture
    // date. A frame retried across midnight lands on the new date; acceptable
    // because real events end ~22:35.
    const date = athensToday()
    const ext = mime === 'image/png' ? 'png' : 'jpg'
    let blob: { url: string; pathname: string }
    try {
      blob = await put(`frames/${date}/${source}/${sha256}.${ext}`, bytes, {
        access: 'public',
        addRandomSuffix: false,
        // The path is the FULL sha256, so an existing object at this path
        // holds byte-identical content (not just a 64-bit prefix collision) —
        // overwriting is genuinely safe and idempotent. Without this, two
        // identical concurrent requests (both past the DB dedup check) would
        // have the second put() throw on the existing pathname; instead it
        // overwrites, proceeds to the DB, hits the Frame P2002, returns dedup 200.
        allowOverwrite: true,
        contentType: mime,
      })
    } catch (e) {
      console.error('ingest: blob upload failed', e)
      return NextResponse.json({ error: 'internal' }, { status: 500 })
    }

    // 7. DB writes in a single transaction.
    let result: {
      frameId: string
      observationId: string
      sessionId: string
      objectName: string
      ingestedAt: Date
    }
    try {
      result = await prisma.$transaction(async (tx) => {
        // 6a. Find or create today's Session.
        //
        // A source that's also a special-event slug (config/extra-events.json,
        // e.g. "parnonas") always resolves to that event's OWN fixed hotelId —
        // never the date-based weekly schedule. This is deliberate: a special
        // event's date can fall on a day the weekly grid already assigns to a
        // real hotel (e.g. Parnonas's July 10 2026 is a Friday = caravia-beach),
        // and without this branch the two would collide into the same Session
        // row. Checked before the schedule lookup so a special-event source can
        // never be shadowed by it.
        const extraEvent = extraEventFor(source)
        const hotelId = extraEvent?.hotelId ?? scheduledHotelFor(date) ?? 'adhoc'
        let session = await tx.session.findUnique({
          where: { date_hotelId: { date, hotelId } },
        })
        if (!session) {
          try {
            session = await tx.session.create({
              data: { date, hotelId, status: 'active', startedAt: now },
            })
          } catch (e) {
            // Concurrent request created it between our read and write —
            // re-read and proceed with the winner's row.
            if (!isP2002(e)) throw e
            session = await tx.session.findUniqueOrThrow({
              where: { date_hotelId: { date, hotelId } },
            })
          }
        }
        if (session.status !== 'active') {
          // Reality beats paperwork: frames arriving means the event is happening —
          // whether the row said cancelled (weather call reversed) or completed
          // (network gap exceeded the liveness window and the relay came back).
          // endedAt: null — a resumed session is no longer ended.
          session = await tx.session.update({
            where: { id: session.id },
            data: { status: 'active', startedAt: session.startedAt ?? now, endedAt: null },
          })
        }

        // 6b. Find or create the active Observation for this source.
        //
        // Known + accepted MVP limitation: two concurrent frames from the same
        // source carrying a new target can each close the old observation and
        // create their own — duplicate Observations. Reachable via test tooling
        // (parallel sends with target changes), and also in the wild if a relay
        // restarts and retries in-flight frames around a target change. Accepted
        // for MVP; no serialization logic on purpose.
        let observation = await tx.observation.findFirst({
          where: { sessionId: session.id, source, endedAt: null },
          orderBy: { startedAt: 'desc' },
        })
        if (observation && targetName !== null) {
          const openRaw = (observation.rawTargetName ?? '').trim()
          if (openRaw !== targetName) {
            // Target changed: close the open observation, start a new one.
            await tx.observation.update({
              where: { id: observation.id },
              data: { endedAt: now },
            })
            observation = null
          }
        }
        const isFreshObservation = !observation
        if (!observation) {
          observation = await tx.observation.create({
            data: {
              sessionId: session.id,
              objectName: targetName ?? 'Unknown',
              rawTargetName: targetName,
              source,
              startedAt: now,
            },
          })
        }

        // 6c. Stacking-progression milestone tagging (lib/detect-transition.ts).
        // Additive only — never affects session/observation resolution above,
        // dedup, or the frame write's other fields. Best-effort: any
        // unexpected shape here just leaves stackMilestone null rather than
        // failing the whole ingest (matches this route's existing "a bad
        // metadata string must never fail the request" discipline).
        //
        // `previous` is the last frame in THIS observation with usable
        // totalAccumulatedTime — per detectTransition's caller contract,
        // frames with unusable timing are skipped, never advancing the
        // baseline. A freshly-created Observation (this request) has no
        // prior frames at all, so `previous` is null there — trivially
        // stackRun 'new' via detectTransition's own null-previous branch.
        let stackMilestone: MilestoneSeconds | null = null
        if (isFreshObservation) {
          await tx.observation.update({
            where: { id: observation.id },
            data: { lastStackRunStartedAt: now },
          })
          stackMilestone = nextMilestoneToTag(extractObservationFrameInput(metadata).totalAccumulatedTime, new Set())
        } else {
          // `previous`: the last frame in this observation with usable
          // totalAccumulatedTime — per detectTransition's caller contract, a
          // frame with unusable timing must be skipped, never becoming (or
          // being compared against as) the reset baseline. Ordered by
          // ingestedAt (server-assigned, always monotonic), not capturedAt
          // (client-reported, best-effort — a retried/delayed frame can
          // arrive with an OLDER capturedAt than a frame already processed,
          // which would silently pick the wrong "previous" telemetry).
          // Bounded lookback (20 frames back) covers the defensive case of
          // several consecutive unusable-metadata frames without an
          // unbounded scan; if usable timing is that sparse, detectTransition
          // correctly falls through to its own 'uncertain' handling anyway
          // (see below).
          const lookback = await tx.frame.findMany({
            where: { observationId: observation.id },
            select: { metadata: true },
            orderBy: { ingestedAt: 'desc' },
            take: 20,
          })
          const previousFrame = lookback
            .map((f) => extractObservationFrameInput(f.metadata as Prisma.InputJsonValue | null))
            .find((f) => f.totalAccumulatedTime !== null)
          const previous = previousFrame ?? null
          const current = extractObservationFrameInput(metadata)

          const result = detectTransition(previous, current, {
            nowMs: now.getTime(),
            lastStackRunStartedAtMs: observation.lastStackRunStartedAt?.getTime() ?? null,
          })

          if (result.stackRun === 'new') {
            await tx.observation.update({
              where: { id: observation.id },
              data: { lastStackRunStartedAt: now },
            })
            stackMilestone = nextMilestoneToTag(current.totalAccumulatedTime, new Set())
          } else if (result.stackRun === 'same') {
            // Marks already tagged WITHIN the current stack run — scoped by
            // ingestedAt, NOT a fixed row-count lookback (a run can span 50+
            // frames in real sessions — see scripts/fixtures/astir-2026-07-06
            // .json's longest run, 54 frames — so a bounded take() here would
            // silently miss earlier tags and risk re-tagging a mark).
            //
            // ingestedAt, not capturedAt: capturedAt is a client-reported,
            // best-effort device/relay timestamp (see its parsing above) that
            // can legitimately land BEFORE lastStackRunStartedAt (which is
            // stamped from the server's own `now` at the moment the reset was
            // recognized) — e.g. network latency between the relay capturing
            // a frame and this request being processed. Filtering by
            // capturedAt >= runStart risked excluding the very frame that
            // established the run, silently re-tagging mark 0 on every
            // subsequent same-run frame. ingestedAt is always assigned from
            // the same server clock lastStackRunStartedAt is, so the two are
            // always comparable.
            //
            // A null lastStackRunStartedAt (pre-migration row, or a row that
            // has never had a confirmed reset) is treated as "the whole
            // observation is one run," the correct fallback since every
            // frame in it then belongs to the same (only) run.
            const runStart = observation.lastStackRunStartedAt
            const taggedFrames = await tx.frame.findMany({
              where: {
                observationId: observation.id,
                stackMilestone: { not: null },
                ...(runStart !== null ? { ingestedAt: { gte: runStart } } : {}),
              },
              select: { stackMilestone: true },
            })
            const tagged = new Set<MilestoneSeconds>(
              taggedFrames
                .map((f) => f.stackMilestone as number)
                .filter((m): m is MilestoneSeconds => (MILESTONE_SECONDS as readonly number[]).includes(m)),
            )
            stackMilestone = nextMilestoneToTag(current.totalAccumulatedTime, tagged)
          }
          // stackRun 'uncertain': leave stackMilestone null — neither tag a
          // fresh run nor assume continuation of the old one.
        }

        // 6d. Insert the Frame.
        const frame = await tx.frame.create({
          data: {
            observationId: observation.id,
            source,
            blobUrl: blob.url,
            blobPath: blob.pathname,
            sha256,
            capturedAt,
            sizeBytes: bytes.length,
            ...(stackMilestone !== null ? { stackMilestone } : {}),
            ...(metadata !== null ? { metadata } : {}),
          },
        })

        return {
          frameId: frame.id,
          observationId: observation.id,
          sessionId: session.id,
          objectName: observation.objectName,
          ingestedAt: frame.ingestedAt,
        }
      })
    } catch (e) {
      // Unique-constraint race SPECIFICALLY on [source, sha256]: a concurrent
      // request inserted the same frame after our dedup check. Treat as dedup.
      // A P2002 on any other constraint falls through to the 500 path below so
      // a future unique index can never silently masquerade as dedup.
      if (isP2002(e) && isFrameSha256Conflict(e)) {
        const dup = await prisma.frame.findUnique({
          where: { source_sha256: { source, sha256 } },
          select: { id: true },
        })
        if (dup) {
          return NextResponse.json({ deduped: true, frameId: dup.id }, { status: 200 })
        }
      }
      // Transaction failed after the blob upload succeeded: the blob is
      // orphaned. Acceptable — log the pathname so orphans are findable by a
      // later cleanup script. Deliberately NOT deleting inline (a delete can
      // also fail and complicates the handler).
      console.error('ingest: DB transaction failed; orphaned blob at', blob.pathname, e)
      return NextResponse.json({ error: 'internal' }, { status: 500 })
    }

    // 8. Redis LAST — only after the transaction commits. A Redis failure
    // must not fail the request: the frame IS persisted; /api/status is at
    // most one frame stale.
    let redisWarning = false
    try {
      // Telemetry subset only, not the raw metadata blob — metadata is
      // arbitrary/untrusted device JSON up to 64KB; the live-status contract
      // stays a narrow, known shape. Absent when Tier-1-only frames (no
      // metadata) or a non-object metadata value.
      const telemetry =
        metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
          ? {
              state: (metadata as Record<string, unknown>).state,
              astrometryState: (metadata as Record<string, unknown>).astrometryState,
              totalAccumulatedTime: (metadata as Record<string, unknown>).totalAccumulatedTime,
              raDegrees: (metadata as Record<string, unknown>).raDegrees,
              decDegrees: (metadata as Record<string, unknown>).decDegrees,
            }
          : undefined
      const payload = JSON.stringify({
        frameId: result.frameId,
        blobUrl: blob.url,
        capturedAt: capturedAt.toISOString(),
        // Use the DB row's ingestedAt (set at insert), not the handler's `now`,
        // so the same-named field carries the same value in Redis and Postgres.
        ingestedAt: result.ingestedAt.toISOString(),
        observationId: result.observationId,
        sessionId: result.sessionId,
        objectName: result.objectName,
        ...(telemetry ? { telemetry } : {}),
      })
      await redis.set(latestFrameKey(source), payload, { ex: 600 })

      // Auto-clear "finished" on the next successful FRESH ingest — this is
      // the PRIMARY reset mechanism (the 60min TTL on the flag itself, see
      // EVENT_FINISHED_TTL_S in lib/redis.ts, is only a safety backstop, not
      // how this is meant to clear in practice). We only reach this line for
      // a genuinely new frame: both the pre-write dedup check (step 5) and
      // the DB-transaction P2002 dedup path above return early before this
      // point, so a deduped/repeated frame can never accidentally un-finish
      // a session that was deliberately ended.
      // Best-effort: if this delete fails, the 60min TTL still bounds how
      // long a stale flag can linger, and the next ingest retries the delete.
      //
      // A special-event source clears its OWN scoped flag (eventFinishedKey)
      // rather than the shared hotel EVENT_FINISHED_KEY — a fresh Parnonas
      // frame must never un-finish a hotel's already-ended night, or vice
      // versa (see lib/redis.ts's eventFinishedKey doc).
      try {
        const isSpecialEvent = extraEventFor(source) !== null
        await redis.del(isSpecialEvent ? eventFinishedKey(source) : EVENT_FINISHED_KEY)
      } catch (e) {
        console.error('ingest: failed to clear finished flag after fresh ingest', e)
      }
    } catch (e) {
      redisWarning = true
      console.error('ingest: Redis set failed after DB commit', e)
    }

    // 9. Done.
    return NextResponse.json(
      {
        frameId: result.frameId,
        observationId: result.observationId,
        sessionId: result.sessionId,
        deduped: false,
        ...(redisWarning ? { redisWarning: true } : {}),
      },
      { status: 201 },
    )
  } catch (e) {
    // Never leak stack traces in responses.
    console.error('ingest: unexpected error', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
