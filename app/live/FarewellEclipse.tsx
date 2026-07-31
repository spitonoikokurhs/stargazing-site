'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  // can't observe totality directly. The scene posts 'eclipse-totality' at first
  // totality and 'eclipse-complete' once the whole sequence has played out (see
  // farewell-eclipse-scene.ts). Totality is used only for the Tier-1 beacon;
  // the review panel waits for eclipse-complete (below).
  // The whole experience is over (ingress -> totality -> egress, sun returned).
  // The review/socials panel waits for THIS, not for totality — so it never
  // interrupts totality, the diamond-ring transition, or the guest reading the
  // scene text. Latched: stays true across any replay of the loop.
  const [sceneComplete, setSceneComplete] = useState(false)
  // onTrack held in a ref (same pattern as FarewellAegeanUfo's onTrackRef): the
  // []-dep listener effect below captures its closure once at mount, while the
  // onTrack prop is a fresh arrow from LiveView on every render — the ref keeps
  // the latest callback reachable without re-subscribing the listener.
  const onTrackRef = useRef(onTrack)
  onTrackRef.current = onTrack
  // Once-guard for the Tier-1 totality beacon: the scene posts 'eclipse-totality'
  // at EVERY totality onset — the eclipse loop is replayable — but "a guest
  // reached totality" should count once per farewell view, mirroring
  // farewell_finale_reached's one-shot semantics on the UFO scene.
  const totalityBeaconSentRef = useRef(false)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Validate shape only (the sandboxed null-origin iframe has an opaque
      // origin, so an origin check isn't meaningful here; we accept only our
      // own known message type and ignore everything else).
      const type = e && e.data && typeof e.data === 'object' ? (e.data as { type?: unknown }).type : undefined
      if (type === 'eclipse-totality') {
        if (!totalityBeaconSentRef.current) {
          totalityBeaconSentRef.current = true
          try {
            onTrackRef.current?.('eclipse_totality_reached')
          } catch {
            // a tracking hiccup must never disturb the farewell
          }
        }
      } else if (type === 'eclipse-complete') {
        // Full sequence finished — safe to reveal the review/socials panel.
        setSceneComplete(true)
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
      {/* Review + socials panel: revealed only once the WHOLE eclipse has played
          out (eclipse-complete, i.e. the sun has fully returned) — never during
          totality or the transition, so the moment isn't interrupted. Anchored
          bottom-centre, above the back-home link, clear of the sun's focal area;
          the panel carries its own backing so it reads cleanly over the sky. */}
      {sceneComplete && (
        <div className="farewell-eclipse-funnel">
          <ReviewFunnel variant="baseline" hotelId={hotelId} onTrack={onTrack} />
        </div>
      )}
    </>
  )
}
