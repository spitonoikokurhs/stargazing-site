// Simple placeholder sign-off for a finished special event (see
// lib/live-status.ts's 'special-event-finished' uiState). Deliberately NOT
// the Aegean UFO farewell — that mechanism is hotel-specific (seeded on the
// hotel schedule's calendar date, carries a "next session" line from the
// recurring weekly rotation, neither of which a special event has). This is
// a genuine placeholder: same calm aesthetic as MysteryGate (same
// .status-root/.shooting-stars background, same serif display font), plain
// sign-off copy, no animation, no next-session line.
import { BackToHome } from './BackToHome'

const SIGN_OFF_LINE = 'Clear skies until we meet again.'

export function SpecialEventFarewell() {
  return (
    <div className="status-root">
      <div className="shooting-stars" aria-hidden="true">
        <span className="shooting-star shooting-star--one" />
        <span className="shooting-star shooting-star--two" />
        <span className="shooting-star shooting-star--three" />
      </div>
      <div className="status-steady">
        <p className="status-heading">{SIGN_OFF_LINE}</p>
      </div>
      {/* Back-to-home link — same calm end-of-event affordance as the hotel
          farewell scenes; a guest at a finished special event should have a
          clear path into the rest of the site. */}
      <div className="status-back-home">
        <BackToHome variant="link" />
      </div>
    </div>
  )
}
