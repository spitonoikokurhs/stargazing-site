// Standalone holding screen for a special event before its reveal time (see
// lib/extra-events.ts). Deliberately NOT built on StatusScreen/the live state
// machine — there's no polling, no telemetry, nothing to react to; it's an
// inert placeholder that a parent swaps out for real LiveView once the clock
// passes revealAt (see app/live/special-event/EventGate.tsx). Reuses
// .status-root/.shooting-stars from styles.css so it shares the exact page
// background, starfield, and shooting-star treatment as every other /live
// screen.
//
// logoSrc is optional (config/extra-events.json's ExtraEvent.logoSrc) — a
// special event with no logo configured just shows the glyph/copy alone,
// same graceful-absence pattern as StatusScreen's hotel logo.
export function MysteryGate({ logoSrc }: { logoSrc?: string | null }) {
  return (
    <div className="status-root">
      <div className="shooting-stars" aria-hidden="true">
        <span className="shooting-star shooting-star--one" />
        <span className="shooting-star shooting-star--two" />
        <span className="shooting-star shooting-star--three" />
      </div>
      <div className="status-steady">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- local /public asset, fixed-height badge, no next/image sizing needed
          <img src={logoSrc} alt="" className="mystery-logo" />
        ) : null}
        <p className="mystery-glyph" aria-hidden="true">
          ?
        </p>
        <p className="status-heading">Something&rsquo;s happening tonight.</p>
        <p className="status-sub">Check back after dark. 🔭</p>
      </div>
    </div>
  )
}
