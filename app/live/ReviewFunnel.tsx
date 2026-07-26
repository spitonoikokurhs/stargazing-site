'use client'

import { useEffect, useRef, useState } from 'react'
import { REVIEW_URL, whatsappUrl, FUNNEL_COPY } from '@/lib/review-funnel'
import type { InteractionKey } from '@/lib/interaction-events'

// The review/testimonial funnel reveal — a calm, dismissible invitation shown on
// the farewell screen. Two variants (see lib/review-funnel):
//   • 'baseline' — everyone, after the scene settles: WhatsApp (first) + review.
//   • 'finder'   — easter-egg finders, after the finale: a single review ask.
//
// It is a GUEST, not a banner: no motion beyond a gentle fade (honoured under
// reduced-motion), never covers the scene's focal area (placement is the caller's
// job — this renders inline/overlay content the caller positions), and once
// dismissed it never reappears (sessionStorage flag — UX state, not tracking).
//
// TRACKING: fires Tier-1 impression beacons once when it becomes visible, and
// click beacons on each action — all four variants counted separately
// (funnel_whatsapp_*, funnel_baseline_review_*, funnel_finder_review_*). The
// beacons flow through the same `onTrack` the scene already holds; demo/debug
// pass no onTrack, so nothing is emitted there.

// sessionStorage key for the baseline dismiss. Per-tab UX state; best-effort
// (private mode / disabled storage just means it may re-show, which is harmless).
const DISMISS_KEY = 'stargazing:funnel-dismissed'

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
    // best-effort — a lost dismiss flag only risks re-showing, never a crash
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
  // The finder variant is a payoff for the most engaged guests and is never
  // dismissible-suppressed (it appears at most once, after the finale). Only the
  // baseline honours the dismiss flag.
  const [dismissed, setDismissed] = useState(() => variant === 'baseline' && readDismissed())

  const emit = (key: InteractionKey) => {
    try {
      onTrack?.(key)
    } catch {
      // a tracking hiccup must never disturb the farewell
    }
  }

  // Impression: fired once, when this reveal first becomes visible (i.e. not
  // already dismissed). A ref guards against a re-fire on re-render.
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
  return (
    <div className="review-funnel review-funnel--baseline" role="group" aria-label={c.lead}>
      <p className="review-funnel-lead">{c.lead}</p>
      <p className="review-funnel-sub">{c.sub}</p>
      <div className="review-funnel-actions">
        {/* WhatsApp visually FIRST — the lead-capture path (per spec). */}
        <a
          className="review-funnel-btn review-funnel-btn--whatsapp"
          href={whatsappUrl(hotelId)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => emit('funnel_whatsapp_click')}
        >
          {c.whatsapp}
        </a>
        <a
          className="review-funnel-btn review-funnel-btn--review"
          href={REVIEW_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => emit('funnel_baseline_review_click')}
        >
          {c.review}
        </a>
      </div>
      <button
        type="button"
        className="review-funnel-dismiss"
        onClick={() => {
          persistDismissed()
          setDismissed(true)
        }}
      >
        {c.dismiss}
      </button>
    </div>
  )
}
