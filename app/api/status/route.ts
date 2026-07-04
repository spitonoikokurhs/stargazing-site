import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  redis,
  latestFrameKey,
  parseLatestFrame,
  ACTIVE_SOURCE_KEY,
  SOURCES,
  type Source,
  type LatestFrame,
} from '@/lib/redis'
import { athensToday, eventFor, nextEvent } from '@/lib/schedule'

// Node runtime for the single Prisma read on the offline path (cancellation
// status). The live path is Redis-only. Neither path writes to Postgres —
// session closing lives in /api/cron/close-sessions (lib/sessions.ts).
export const runtime = 'nodejs'
// This route intentionally uses request-time data (Redis, Prisma, no-store).
// Force dynamic rendering so next build does not try to statically evaluate it.
export const dynamic = 'force-dynamic'

const LIVE_WINDOW_MS = 5 * 60 * 1000 // a source is "fresh" if heard from within 5 min
const HYSTERESIS_MS = 45 * 1000 // only switch away from the active source if the other leads by >45s
const ACTIVE_SOURCE_TTL_S = 600 // 10-min TTL on the chosen-source key

type OfflineStatus = {
  tonight:
    | { hotelId: string; start: string; end: string; cancelled: boolean; cancellationReason?: string }
    | null
  next: { date: string; hotelId: string; start: string; end: string } | null
  degraded?: true
}

// Every response is uncacheable — /live polls this every 10s for current state.
function json(body: unknown) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

// Current Athens wall-clock time as "HH:MM" (24h, zero-padded) for same-day
// comparison against an event's end time.
function athensNowHHMM(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

// Tomorrow's Athens calendar date (UTC arithmetic = pure calendar-day math).
function athensTomorrow(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function offlineStatus(): Promise<OfflineStatus> {
  // Static schedule first: this must work even when Redis and Postgres are down.
  // Postgres only enriches it with the cancellation banner below.
  const today = athensToday()
  const tonightEvent = eventFor(today)
  let tonight: OfflineStatus['tonight'] = null

  if (tonightEvent) {
    let cancelled = false
    let cancellationReason: string | undefined
    try {
      const session = await prisma.session.findUnique({
        where: { date_hotelId: { date: today, hotelId: tonightEvent.hotelId } },
      })
      cancelled = session?.status === 'cancelled'
      cancellationReason = cancelled ? (session?.cancellationReason ?? undefined) : undefined
    } catch (e) {
      console.error('/api/status: cancellation read failed, defaulting to not-cancelled', e)
    }

    tonight = {
      hotelId: tonightEvent.hotelId,
      start: tonightEvent.start,
      end: tonightEvent.end,
      cancelled,
      ...(cancellationReason ? { cancellationReason } : {}),
    }
  }

  const next =
    tonightEvent && athensNowHHMM() < tonightEvent.end
      ? { date: today, ...tonightEvent }
      : nextEvent(athensTomorrow(today))

  return { tonight, next }
}

export async function GET() {
  let offline: OfflineStatus
  try {
    offline = await offlineStatus()
  } catch (e) {
    // This should only catch unexpected bugs in pure schedule derivation. Keep
    // answering; the Redis live path below may still upgrade the response.
    console.error('/api/status: static offline schedule derivation failed', e)
    offline = { tonight: null, next: null, degraded: true }
  }

  // Redis is an optional live upgrade. If Redis is unavailable/stalled, guests
  // still get tonight/next from the static schedule above instead of a bare
  // degraded response with no useful event information.
  let pegasusRaw: unknown
  let seestarRaw: unknown
  let activeRaw: unknown
  try {
    ;[pegasusRaw, seestarRaw, activeRaw] = await Promise.all([
      redis.get(latestFrameKey('pegasus')),
      redis.get(latestFrameKey('seestar')),
      redis.get(ACTIVE_SOURCE_KEY),
    ])
  } catch (e) {
    console.error('/api/status: Redis read failed; returning offline schedule', e)
    return json({ live: false, ...offline, degraded: true })
  }

  const frames: Record<Source, LatestFrame | null> = {
    pegasus: parseLatestFrame(pegasusRaw),
    seestar: parseLatestFrame(seestarRaw),
  }
  const activeSource: Source | null = activeRaw === 'pegasus' || activeRaw === 'seestar' ? activeRaw : null

  const now = Date.now()
  const ageInfo = (f: LatestFrame | null): { fresh: boolean; ageSeconds: number } | null => {
    if (!f) return null
    const t = new Date(f.ingestedAt).getTime()
    if (Number.isNaN(t)) return null
    const ageMs = now - t
    return { fresh: ageMs < LIVE_WINDOW_MS, ageSeconds: Math.max(0, Math.round(ageMs / 1000)) }
  }
  const sources = {
    pegasus: ageInfo(frames.pegasus),
    seestar: ageInfo(frames.seestar),
  }
  const ingestedMs = (s: Source): number => new Date(frames[s]!.ingestedAt).getTime()
  const freshSources = SOURCES.filter((s) => sources[s]?.fresh)

  if (freshSources.length === 0) {
    return json({ live: false, ...offline })
  }

  let chosen: Source
  if (activeSource && sources[activeSource]?.fresh) {
    chosen = activeSource
    const other: Source = activeSource === 'pegasus' ? 'seestar' : 'pegasus'
    if (sources[other]?.fresh && ingestedMs(other) - ingestedMs(activeSource) > HYSTERESIS_MS) {
      chosen = other
    }
  } else {
    chosen = freshSources.reduce((best, s) => (ingestedMs(s) > ingestedMs(best) ? s : best))
  }

  try {
    await redis.set(ACTIVE_SOURCE_KEY, chosen, { ex: ACTIVE_SOURCE_TTL_S })
  } catch (e) {
    console.error('/api/status: active-source Redis write failed; serving chosen live frame anyway', e)
  }

  const f = frames[chosen]!
  return json({
    live: true,
    source: chosen,
    frame: {
      frameId: f.frameId,
      blobUrl: f.blobUrl,
      capturedAt: f.capturedAt,
      ingestedAt: f.ingestedAt,
    },
    observation: { observationId: f.observationId, objectName: f.objectName },
    sessionId: f.sessionId,
    viewers: null, // placeholder until /api/heartbeat lands; keeps /live on the final shape
    sources,
  })
}
