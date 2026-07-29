'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  deriveLivePillState,
  forcedStatusFromQuery,
  liveRoomLabel,
  type LiveStatusResponse,
  type LivePillState,
} from '@/lib/live-pill'
import './live-status-pill.css'

// Guest-facing live-status pill. Always shows current state (via a colored dot)
// and is always clickable, so a guest never has to type /live by hand. Two
// placements via `variant`: a compact 'header' pill for the nav (every page)
// and a larger 'hero' element for the homepage. Both render identical STATES —
// only size/emphasis differ.
//
// Front-end only: it POLLS the existing /api/status endpoint and reads its
// { live, tonight, next } shape (see lib/live-pill.ts for the state machine).
// No backend/relay/db involvement.

const POLL_INTERVAL_MS = 45_000 // flip to LIVE within ~45s without a manual refresh; well under the ~52-min stack

type Variant = 'header' | 'hero'

export function LiveStatusPill({ variant = 'header' }: { variant?: Variant }) {
  // null until the first fetch resolves; a failed fetch also lands as null,
  // which deriveLivePillState maps to the neutral 'Live' fallback (never a
  // broken/blank pill). We never surface a loading spinner — the neutral
  // fallback IS a valid, clickable state, so the very first paint is usable.
  const [status, setStatus] = useState<LiveStatusResponse | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  // For the HERO panel only: a fixed (viewport-relative) position computed from
  // the trigger, so the popover escapes the hero's overflow:hidden clip. null =
  // use the default absolute positioning (header).
  const [heroPanelPos, setHeroPanelPos] = useState<{ top: number; left: number } | null>(null)
  // Client-mounted flag: the hero panel is portaled to document.body (to escape
  // the hero's transformed ancestor, which would otherwise trap position:fixed),
  // and createPortal needs document — so it must be false during SSR/first paint.
  const [mounted, setMounted] = useState(false)
  // Guard against a slow/stale fetch resolving after unmount.
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const body = (await res.json()) as LiveStatusResponse
      if (mountedRef.current) setStatus(body)
    } catch {
      // Unreachable/failed: fall back to neutral by clearing to null. This is a
      // deliberate degrade, not an error surface — the pill stays a working
      // link to /live.
      if (mountedRef.current) setStatus(null)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    setMounted(true)
    // ?pill-demo=live|tonight|idle (review-only, see forcedStatusFromQuery):
    // pin a synthetic status and skip polling entirely, so a reviewer can hold
    // a state still. Resolved in the effect (not during render) so the server
    // and first client paint agree — same SSR-safety discipline as the /live
    // demo hooks. With no param this branch is inert and normal polling runs.
    const forced = forcedStatusFromQuery(window.location.search)
    if (forced) {
      setStatus(forced)
      return () => {
        mountedRef.current = false
      }
    }
    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [poll])

  const state = deriveLivePillState(status)

  // Close the panel on Escape / outside interaction, mirroring native popover
  // dismissal expectations for keyboard + pointer users.
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!panelOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPanelOpen(false)
        triggerRef.current?.focus()
      }
    }
    function onPointer(e: PointerEvent) {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setPanelOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [panelOpen])

  const dotKind = state.kind // 'live' | 'tonight' | 'idle' | 'fallback'
  const className = `live-pill live-pill--${variant} live-pill--${dotKind}`

  const dot = <span className={`live-pill__dot live-pill__dot--${dotKind}`} aria-hidden="true" />
  // ROLES ARE SWAPPED BY PLACEMENT (see lib/live-pill):
  //   HERO   -> shows STATUS / next-event info (state.label). On idle it opens
  //             the next-event panel — it must NOT dump the guest on the dead
  //             /live screen. On live/tonight it links into /live (there IS
  //             something to watch).
  //   HEADER -> the LIVE ROOM door (liveRoomLabel). Always links to /live.
  const isHero = variant === 'hero'
  const labelText = isHero ? state.label : liveRoomLabel(state)
  const label = <span className="live-pill__label">{labelText}</span>

  // HERO + idle: open the next-event panel (no dead-screen link). The panel is
  // position:fixed (see .live-pill__panel--hero) so the hero's overflow:hidden
  // can't clip it — the earlier clipping bug.
  if (isHero && state.kind === 'idle') {
    return (
      <span className="live-pill__wrap">
        <button
          type="button"
          ref={triggerRef}
          className={className}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => {
            // Position the fixed panel from the trigger's viewport rect (so it
            // escapes the hero's overflow:hidden). Flip ABOVE the pill when there
            // isn't room below — the hero pill sits low on the page, so a
            // below-panel would open off the bottom of the screen and look like
            // "nothing happened" (the bug this fixes).
            const r = triggerRef.current?.getBoundingClientRect()
            if (r) {
              const PANEL_H = 150 // approx; enough to decide above/below
              const below = r.bottom + 10
              const roomBelow = window.innerHeight - r.bottom
              const openAbove = roomBelow < PANEL_H + 20
              // Clamp left so a wide panel never runs off the right edge.
              const left = Math.min(r.left, window.innerWidth - 260)
              setHeroPanelPos({
                top: openAbove ? Math.max(10, r.top - PANEL_H - 10) : below,
                left: Math.max(10, left),
              })
            }
            setPanelOpen((o) => !o)
          }}
        >
          {dot}
          {label}
        </button>
        {panelOpen &&
          mounted &&
          createPortal(
            // Portaled to <body> so no transformed hero ancestor traps the
            // position:fixed panel (a transform/filter ancestor makes `fixed`
            // relative to IT, not the viewport — that put the panel off-screen).
            <div
              ref={panelRef}
              className="live-pill__panel live-pill__panel--hero"
              role="dialog"
              aria-label="Next session"
              style={heroPanelPos ? { top: heroPanelPos.top, left: heroPanelPos.left } : undefined}
            >
              <span className="live-pill__panel-title">Next session</span>
              {state.panel.schedule && <span className="live-pill__panel-schedule">{state.panel.schedule}</span>}
              <span className="live-pill__panel-resume">{state.panel.resumeLine}</span>
            </div>,
            document.body,
          )}
      </span>
    )
  }

  // HEADER + idle: the live-room door. It LINKS to /live (that's the header's
  // job now), but we still surface the next-event detail via title/aria so a
  // guest isn't surprised by the waiting screen.
  if (!isHero && state.kind === 'idle') {
    return (
      <a
        href="/live"
        className={className}
        title={state.panel.schedule ? `Next session: ${state.panel.schedule}` : undefined}
        aria-label={state.panel.schedule ? `Enter the live room — next session ${state.panel.schedule}` : 'Enter the live room'}
      >
        {dot}
        {label}
      </a>
    )
  }

  // live / tonight / fallback: a link to /live (both placements). (Both idle
  // cases returned above; the ?? '/live' just satisfies the type-narrower.)
  const href = 'href' in state ? state.href : '/live'
  return (
    <a href={href} className={className} aria-label={ariaLabelFor(state, isHero)}>
      {dot}
      {label}
    </a>
  )
}

// A fuller label for assistive tech — the visible text is terse, but a screen
// reader benefits from naming the destination. isHero picks the wording for the
// placement (the hero frames status; the header frames "enter the live room").
function ariaLabelFor(state: LivePillState, isHero: boolean): string {
  const dest = isHero ? 'open the live telescope view' : 'enter the live room'
  switch (state.kind) {
    case 'live':
      return `Live now — ${dest}`
    case 'tonight':
      return `${state.label} — ${dest}`
    case 'fallback':
      return isHero ? 'Open the live telescope view' : 'Enter the live room'
    default:
      return state.label
  }
}
