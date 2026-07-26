'use client'

import { useEffect, useRef, useState } from 'react'
import { REVIEW_URL, whatsappUrl, FUNNEL_COPY } from '@/lib/review-funnel'
import type { InteractionKey } from '@/lib/interaction-events'

// The review/testimonial funnel reveal — a calm invitation shown on the
// farewell screen. Two variants (see lib/review-funnel):
//   • 'baseline' — everyone, after the scene settles: WhatsApp (first) + review.
//   • 'finder'   — easter-egg finders, after the finale: a single review ask.
//
// It is a GUEST, not a banner: no motion beyond a gentle fade (suppressed under
// reduced-motion), never covers the scene's focal area (placement is the caller's
// job), and it excuses itself: an untouched baseline block AUTO-FADES after
// ~30s (no dismiss button — the guest gets the ask, the scene gets reclaimed,
// nobody taps anything) and doesn't return for the session. A guest who
// interacts with either action cancels the fade — the block then stays, exactly
// as it behaved before. The finder variant never fades (it's the earned payoff).
//
// REDUCED MOTION — the deliberate call: the baseline block PERSISTS (no
// auto-fade at all). Any motion-free removal is worse than keeping it: an
// instant pop-out grabs more attention than a slow fade ever would, and on the
// static tier the block sits inline in the card flow, so removing it REFLOWS
// the whole card — a jarring jump on exactly the tier that asked for calm. The
// block is small, quiet, and never over a focal area, so persisting is the
// least-attention option, which is the point of the constraint.
//
// TRACKING: fires Tier-1 impression beacons once when it becomes visible, and
// click beacons on each action — all variants counted separately. The auto-fade
// fires NOTHING and cannot re-fire or lose the impression (the once-guard ref is
// independent of fade state). Demo/debug pass no onTrack, so nothing is emitted.

// sessionStorage key for "the baseline already had its moment this session" —
// set when the block auto-fades, so a re-render/refresh doesn't re-show it.
// Same key the old dismiss flag used (semantics are identical: baseline is
// done for this session), so a session that dismissed under the old build
// stays quiet after this one deploys. Per-tab UX state; best-effort (private
// mode just means it may re-show, which is harmless).
const DISMISS_KEY = 'stargazing:funnel-dismissed'

// Idle window before the untouched baseline excuses itself, and the length of
// the fade. The fade is opacity-only over 2.4s — slow enough that a guest
// looking at the scene won't have their eye pulled by it.
const AUTO_FADE_IDLE_MS = 30_000
const AUTO_FADE_DURATION_MS = 2_400

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function persistDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // best-effort — a lost flag only risks re-showing, never a crash
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function ReviewFunnel({
  variant,
  hotelId,
  onTrack,
}: {
  variant: 'baseline' | 'finder'
  // Tonight's venue, for the WhatsApp prefill (baseline only). Null -> generic.
  hotelId?: string | null
  // Tier-1 beacon sink (see the scene components). Optional: demo/debug omit it.
  onTrack?: (key: InteractionKey) => void
}) {
  // Only the baseline honours the session flag; the finder is the earned payoff
  // and always shows (at most once, after the finale).
  const [dismissed, setDismissed] = useState(() => variant === 'baseline' && readDismissed())
  // 'idle' -> visible; 'fading' -> opacity transition running; then dismissed.
  const [fading, setFading] = useState(false)
  // Set on any interaction with the block's actions — cancels the auto-fade
  // for good (the guest engaged; the block stays, as it always did).
  const interactedRef = useRef(false)

  const emit = (key: InteractionKey) => {
    try {
      onTrack?.(key)
    } catch {
      // a tracking hiccup must never disturb the farewell
    }
  }

  // Impression: fired once, when this reveal first becomes visible. Independent
  // of the fade machinery — a later auto-fade can neither re-fire nor lose it.
  const impressionSentRef = useRef(false)
  useEffect(() => {
    if (dismissed || impressionSentRef.current) return
    impressionSentRef.current = true
    if (variant === 'finder') {
      emit('funnel_finder_review_impression')
    } else {
      // Baseline shows BOTH options at once, so both are "impressed" together.
      emit('funnel_whatsapp_impression')
      emit('funnel_baseline_review_impression')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, variant])

  // Auto-fade (baseline only): untouched for AUTO_FADE_IDLE_MS -> gentle
  // opacity fade -> gone for the session. Skipped entirely under
  // reduced-motion (the block persists — see the header comment for why
  // that's the calmer choice there).
  useEffect(() => {
    if (variant !== 'baseline' || dismissed) return
    if (prefersReducedMotion()) return
    const idleTimer = setTimeout(() => {
      if (interactedRef.current) return
      setFading(true)
    }, AUTO_FADE_IDLE_MS)
    return () => clearTimeout(idleTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, dismissed])

  // When the fade starts, let the opacity transition finish, then remove the
  // block and remember that for the session. setTimeout over transitionend:
  // no listener bookkeeping, and correct even if the tab is backgrounded
  // mid-fade (the element is already at opacity 0 when the timer lands).
  useEffect(() => {
    if (!fading) return
    const doneTimer = setTimeout(() => {
      persistDismissed()
      setDismissed(true)
    }, AUTO_FADE_DURATION_MS)
    return () => clearTimeout(doneTimer)
  }, [fading])

  if (dismissed) return null

  if (variant === 'finder') {
    const c = FUNNEL_COPY.finder
    return (
      <div className="review-funnel review-funnel--finder" role="group" aria-label={c.lead}>
        <p className="review-funnel-lead">{c.lead}</p>
        <p className="review-funnel-sub">{c.sub}</p>
        <div className="review-funnel-actions">
          <a
            className="review-funnel-btn review-funnel-btn--review"
            href={REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => emit('funnel_finder_review_click')}
          >
            {c.review}
          </a>
        </div>
      </div>
    )
  }

  const c = FUNNEL_COPY.baseline
  const markInteracted = () => {
    interactedRef.current = true
    // Engaging mid-fade rescues the block: the guest is clearly interested.
    setFading(false)
  }
  return (
    <div
      className={`review-funnel review-funnel--baseline${fading ? ' review-funnel--fading' : ''}`}
      role="group"
      aria-label={c.lead}
    >
      <p className="review-funnel-lead">{c.lead}</p>
      <p className="review-funnel-sub">{c.sub}</p>
      <div className="review-funnel-actions">
        {/* WhatsApp visually FIRST — the lead-capture path (per spec). */}
        <a
          className="review-funnel-btn review-funnel-btn--whatsapp"
          href={whatsappUrl(hotelId)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            markInteracted()
            emit('funnel_whatsapp_click')
          }}
        >
          {c.whatsapp}
        </a>
        <a
          className="review-funnel-btn review-funnel-btn--review"
          href={REVIEW_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            markInteracted()
            emit('funnel_baseline_review_click')
          }}
        >
          {c.review}
        </a>
      </div>
    </div>
  )
}
