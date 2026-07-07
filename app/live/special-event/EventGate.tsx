'use client'

import { useEffect, useState } from 'react'
import LiveView from '../LiveView'
import { MysteryGate } from '../MysteryGate'

// How often to re-check the clock against revealAt while gated. Coarse on
// purpose — this is a one-time flip, not a countdown, so it doesn't need
// second-level precision; a guest sitting on the page across the threshold
// sees it clear within a few seconds.
const GATE_CHECK_MS = 5 * 1000

// Client-side time gate for the special event resolved by the server (see
// lib/extra-events.ts's resolveSpecialEvent, called from
// app/live/special-event/page.tsx). Before revealAt: MysteryGate, a static
// holding screen, no polling at all. At/after revealAt: mounts the real
// LiveView pointed at this event's own /api/status query, which is where the
// actual live/offline/reconnecting state machine takes over — this
// component's only job is the one-time flip. eventSlug/revealAt/logoSrc are
// just the resolved event's data passed down as plain props; this component
// has no idea (and doesn't need to know) that the slug came from server-side
// resolution rather than a URL param.
export function EventGate({
  eventSlug,
  revealAt,
  logoSrc,
}: {
  eventSlug: string
  revealAt: string
  logoSrc?: string | null
}) {
  // Lazily computed so a server-rendered shell and the first client render
  // agree (both evaluate revealAt against "now" only after mount) — avoids a
  // hydration mismatch from checking Date.now() during SSR.
  const [revealed, setRevealed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const threshold = new Date(revealAt).getTime()
    const check = () => setRevealed(Date.now() >= threshold)
    check()
    setMounted(true)
    if (Date.now() >= threshold) return
    const id = setInterval(check, GATE_CHECK_MS)
    return () => clearInterval(id)
  }, [revealAt])

  // Before mount: render the gate (matches what a not-yet-revealed guest
  // scanning the QR code before the event should see, and avoids a
  // server/client markup mismatch since the server can't know "now").
  if (!mounted || !revealed) return <MysteryGate logoSrc={logoSrc} />

  return <LiveView statusUrl={`/api/status?event=${encodeURIComponent(eventSlug)}`} />
}
