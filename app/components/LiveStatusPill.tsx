'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { deriveLivePillState, type LiveStatusResponse, type LivePillState } from '@/lib/live-pill'
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
  const label = <span className="live-pill__label">{state.label}</span>

  // Idle state: the pill is a BUTTON that toggles the off-event panel (it does
  // NOT navigate to /live — there's no live view to show). Every other state is
  // a LINK straight to /live.
  if (state.kind === 'idle') {
    return (
      <span className="live-pill__wrap">
        <button
          type="button"
          ref={triggerRef}
          className={className}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
        >
          {dot}
          {label}
        </button>
        {panelOpen && (
          <div ref={panelRef} className="live-pill__panel" role="dialog" aria-label="Next session">
            <span className="live-pill__panel-title">Next session</span>
            {state.panel.schedule && <span className="live-pill__panel-schedule">{state.panel.schedule}</span>}
            <span className="live-pill__panel-resume">{state.panel.resumeLine}</span>
          </div>
        )}
      </span>
    )
  }

  // live / tonight / fallback: a link to /live.
  return (
    <a href={state.href} className={className} aria-label={ariaLabelFor(state)}>
      {dot}
      {label}
    </a>
  )
}

// A fuller label for assistive tech — the visible text is terse ("Live now"),
// but a screen reader benefits from naming the destination.
function ariaLabelFor(state: LivePillState): string {
  switch (state.kind) {
    case 'live':
      return 'Live now — open the live telescope view'
    case 'tonight':
      return `${state.label} — open the live telescope view`
    case 'fallback':
      return 'Open the live telescope view'
    default:
      return state.label
  }
}
