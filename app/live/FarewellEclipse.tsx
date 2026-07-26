'use client'

import { useEffect, useMemo, useState } from 'react'
import { buildEclipseSceneHtml } from './farewell-eclipse-scene'
import { BackToHome } from './BackToHome'
import { ReviewFunnel } from './ReviewFunnel'
import type { InteractionKey } from '@/lib/interaction-events'

// Escapes a value for safe interpolation into HTML text/attribute context.
// The footer values (venue name, schedule sentence, logo URL) come from our
// OWN config today, so this is not an attack-surface defense — it's correctness
// insurance: a venue name with an apostrophe or ampersand (or an accented Greek
// character rendered via entity) must not silently break the scene's markup
// when spliced into the iframe srcDoc. Covers the five HTML-significant chars.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Build the footer markup that gets injected into the eclipse scene's
// {{FAREWELL_FOOTER}} marker. Mirrors WHAT the UFO farewell shows (a rotating
// lead line, the real next-session schedule sentence, and the hotel logo) but
// as plain escaped HTML for the self-contained iframe document, styled by the
// scene's own .venue-footer CSS. Every interpolated value is escaped. Absent
// pieces are simply omitted (same graceful-absence pattern as the UFO/status
// screens), and if there's nothing at all to show the footer stays empty.
function buildEclipseFooterHtml(props: {
  nextSessionLead: string | null
  nextSessionSchedule: string | null
  nextSessionLogoSrc: string | null
}): string {
  const parts: string[] = []
  if (props.nextSessionLogoSrc) {
    // alt="" — decorative; the schedule text carries the venue name.
    parts.push(`<img class="vf-logo" src="${escapeHtml(props.nextSessionLogoSrc)}" alt="">`)
  }
  if (props.nextSessionLead) {
    parts.push(`<span class="vf-lead">${escapeHtml(props.nextSessionLead)}</span>`)
  }
  if (props.nextSessionSchedule) {
    parts.push(`<span class="vf-schedule">${escapeHtml(props.nextSessionSchedule)}</span>`)
  }
  return parts.join('')
}

// The eclipse farewell scene, embedded as a self-contained <iframe srcDoc> so
// its ~250 lines of unscoped inline CSS (.stage/.reward/.big/.small/…) can
// never collide with the site's own farewell CSS — a separate document is the
// only guarantee of zero cascade bleed (both worlds define .reward/.big/.small
// families). The scene's visuals/animation/timing are treated as final and
// embedded verbatim; only the venue/next-session footer is injected, escaped,
// via the {{FAREWELL_FOOTER}} marker.
//
// Same prop shape as FarewellAegeanUfo, so the finished-state render can pick
// between the two scenes with identical inputs (see LiveViewPresentation).
export function FarewellEclipse({
  nextSessionLead,
  nextSessionSchedule,
  nextSessionLogoSrc,
  hotelId,
  onTrack,
}: {
  nextSessionLead: string | null
  nextSessionSchedule: string | null
  nextSessionLogoSrc: string | null
  // Tonight's venue, for the review-funnel WhatsApp prefill. Null -> generic.
  hotelId?: string | null
  // Tier-1 beacon sink for the funnel's own impressions/clicks. The eclipse's
  // "scene shown" beacon is fired by LiveView; UFO-tap/finale beacons don't apply
  // (the scene is iframe-isolated — see the report). Optional: demo/debug omit it.
  onTrack?: (key: InteractionKey) => void
}) {
  // The eclipse scene lives in a sandboxed cross-origin iframe, so the parent
  // can't observe totality directly. The scene posts an 'eclipse-totality'
  // message to window.parent at first totality (see farewell-eclipse-scene.ts —
  // one additive, standalone-safe line). We listen for it to reveal the baseline
  // review invitation "after totality," per the spec. Latched: once true it
  // stays, so a replay of the eclipse loop doesn't re-toggle the invitation.
  const [totalityReached, setTotalityReached] = useState(false)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Validate shape only (the sandboxed null-origin iframe has an opaque
      // origin, so an origin check isn't meaningful here; we accept only our
      // own known message type and ignore everything else).
      if (e && e.data && typeof e.data === 'object' && (e.data as { type?: unknown }).type === 'eclipse-totality') {
        setTotalityReached(true)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  // Built once per mount from the (stable) props — the scene HTML is large, and
  // there's no reason to re-template it on re-render (the finished state is
  // terminal, so these props don't change under a mounted scene anyway).
  const srcDoc = useMemo(
    () =>
      buildEclipseSceneHtml(
        buildEclipseFooterHtml({ nextSessionLead, nextSessionSchedule, nextSessionLogoSrc }),
      ),
    [nextSessionLead, nextSessionSchedule, nextSessionLogoSrc],
  )

  return (
    <>
      <iframe
        title="Total solar eclipse over the Asklepieion of Kos"
        srcDoc={srcDoc}
        // Fixed full-viewport frame: the scene is designed to own the whole
        // screen (like the UFO farewell), and being a separate document it has no
        // effect on the host page's scroll/layout. sandbox allows only what the
        // scene needs — its own inline scripts — with no same-origin access,
        // popups, navigation, or form submission.
        sandbox="allow-scripts"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          background: '#05060c',
          zIndex: 50,
        }}
      />
      {/* Back-to-home link, rendered by the PARENT and overlaid on top of the
          iframe (zIndex 51 > the iframe's 50). It cannot live INSIDE the srcDoc:
          the iframe is sandboxed without allow-top-navigation, so a link within
          it could never navigate the guest's tab to the homepage. Same calm
          end-of-event affordance as the UFO farewell, positioned bottom-center
          clear of the scene's own footer. */}
      <div className="farewell-eclipse-back-home">
        <BackToHome variant="link" />
      </div>
      {/* Review funnel: baseline invitation only (the eclipse has no finale, so
          no finder variant — see the report). Revealed AFTER totality, as a
          PARENT-tree sibling overlay (zIndex 51 > the iframe's 50) in the
          top-right — clear of the centered sun and the top-left back-home link.
          Reduced motion is honoured by the funnel/CSS even though the eclipse
          scene itself doesn't (it's a separate document). */}
      {totalityReached && (
        <div className="farewell-eclipse-funnel">
          <ReviewFunnel variant="baseline" hotelId={hotelId} onTrack={onTrack} />
        </div>
      )}
    </>
  )
}
