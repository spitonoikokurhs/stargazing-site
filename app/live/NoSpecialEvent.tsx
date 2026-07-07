// Neutral state for /live/special-event when resolveSpecialEvent (see
// lib/extra-events.ts) finds no active or upcoming special event — e.g. the
// permanent QR code scanned well before the next one is configured, or well
// after the last one's endsAt. Deliberately NOT an error/404: this is a
// completely expected, calm state, not a broken link — same shell as
// MysteryGate (same .status-root/.shooting-stars background, same serif
// heading) with different copy and no logo/glyph, since there's no specific
// event to represent yet.
export function NoSpecialEvent() {
  return (
    <div className="status-root">
      <div className="shooting-stars" aria-hidden="true">
        <span className="shooting-star shooting-star--one" />
        <span className="shooting-star shooting-star--two" />
        <span className="shooting-star shooting-star--three" />
      </div>
      <div className="status-steady">
        <p className="status-heading">No special event right now.</p>
        <p className="status-sub">Check back soon. 🔭</p>
      </div>
    </div>
  )
}
