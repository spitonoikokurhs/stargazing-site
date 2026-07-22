// Back-to-home affordance for /live, so a guest who arrived via QR code, the
// homepage Live pill, or a direct link is never stranded — there is otherwise
// NO navigation off /live in any state (the "STARGAZING.WORLD" rim mark is a
// decorative SVG watermark, and hotel logos are venue branding, neither a link).
//
// One component, two variants (mirroring how LiveStatusPill uses a `variant`
// prop), so the single "go home" element reads differently by context:
//
//   variant="arrow"  — LIVE state. A discreet, low-opacity back-arrow icon in
//                       the top-left of the topbar (opposite the fullscreen
//                       button). Present but quiet, so it never competes with
//                       the immersive live stream; a guest only reaches for it
//                       once they're done watching.
//
//   variant="link"   — OFFLINE / STATUS / FAREWELL states. A prominent
//                       "← stargazing.events" text link. No live view to
//                       protect here, and a stranded (or, at farewell, a
//                       receptive) guest should have a clear path into the rest
//                       of the site. Text link, not a button — understated per
//                       the site's premium aesthetic, not a bolted-on widget.
//
// Always links to '/' (the homepage). Front-end only; no data/endpoint touch.

export function BackToHome({ variant }: { variant: 'arrow' | 'link' }) {
  if (variant === 'arrow') {
    return (
      <a
        href="/"
        className="back-home back-home--arrow"
        aria-label="Back to stargazing.events home"
      >
        <span className="back-home__arrow" aria-hidden="true">
          ←
        </span>
      </a>
    )
  }

  return (
    // aria-label mirrors the arrow variant so a screen reader announces the
    // INTENT ("back … home"), not just the bare domain the visible label shows.
    <a href="/" className="back-home back-home--link" aria-label="Back to stargazing.events home">
      <span className="back-home__arrow" aria-hidden="true">
        ←
      </span>
      <span className="back-home__label">stargazing.events</span>
    </a>
  )
}
