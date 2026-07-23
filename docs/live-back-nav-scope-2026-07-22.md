# /live back-to-home navigation — findings + design choices (2026-07-22)

**Status:** SCOPED, not built. For a decision before building. Intended branch
when built: `feat/live-back-nav` (fresh off `main`, separate from
`feat/live-status-pill`).

## Problem
Guests reach `/live` via QR code, the new homepage Live pill, or a direct link.
Once there they may have no way back to the main site — especially on a no-event
night. Need a back-to-home affordance that's quiet during a live event and more
prominent when offline.

## Current-state findings (what's on /live today)

**1. Any home link / logo-link / back button / nav on /live right now?**
NO — none, in any state.
- The page wrapper (`app/live/page.tsx`) is just `<LiveView />` — no header, no nav.
- Live-frame view: a `.topbar` ("● LIVE · UPDATED Xs ago · N MIN STACKED") and a
  fullscreen button (⤢, top-right of the viewer). The brand text was
  DELIBERATELY removed from the topbar (LiveView.tsx ~L2580) because
  "STARGAZING.WORLD" already shows — but that mark is an SVG `<text>` watermark
  on the eyepiece rim: DECORATIVE, not a link.
- Offline / next-session `StatusScreen`: heading + sub + flavor line + an
  optional HOTEL logo (bare `<img>`, unlinked). No home/back affordance at all.
- Farewell screens (UFO / eclipse): show a HOTEL logo (venue branding, unlinked)
  + next-session copy. No site link.

**2. Does it differ between live-event and offline/next-session states?**
Structurally yes (different components), but on "way back home" they're
IDENTICAL: neither has one.

**3. If a guest arrives when there's no event — stuck or not?**
Effectively STUCK. They hit the `StatusScreen` with zero navigation. The only
escape is the browser Back button — which does NOTHING on a fresh QR / direct-link
/ Live-pill arrival (no prior history entry on this origin). A guest scanning the
QR on a no-event night lands on a dead-end page with no path to the homepage.

## Key constraint for the fix
The hint "if /live already has a logo/header, just make that link home" does NOT
cleanly apply: the only brand mark is the decorative SVG rim watermark (awkward
to linkify — it's `<text>` mid-view inside the eyepiece SVG, and linking it
fights the immersive intent during a live event). Hotel logos aren't ours to
point home (venue branding). So there is NO existing element to simply re-link —
a small new affordance must be added. Both variants link to `/` (homepage),
styled from the site's existing tokens (premium, understated), not a bolted-on
widget.

---

## DECISION 1 — LIVE-state affordance (immersive; must stay quiet)

Top-right corner is taken by the fullscreen button, so this goes TOP-LEFT of the
topbar.

- **Option A — Discreet back arrow, top-left (RECOMMENDED).**
  A small low-opacity back-arrow (←) icon button, top-left, opposite the
  fullscreen button. Minimal, icon-only, quietest — doesn't compete with the
  live view. Con: an arrow alone doesn't say WHERE it goes.
- **Option B — Tiny wordmark, top-left.**
  A small low-opacity "stargazing.events" text link, top-left. More discoverable
  (names the destination) but a touch more visual weight during the immersive
  view.
- **Option C — Back arrow + wordmark ("← stargazing.events"), top-left.**
  Most discoverable, clearest destination, but the most chrome added to the
  immersive live view — mild tension with "present but quiet."

## DECISION 2 — OFFLINE / StatusScreen affordance (no live view to protect)

- **Option A — Prominent "← stargazing.events" text link (RECOMMENDED).**
  A clear text link near the status column (e.g. below the heading/flavor line),
  warm but understated per the site language. Clearly gets a stranded guest
  home. Matches the "can be more prominent" intent.
- **Option B — Same discreet affordance as live.**
  Reuse the exact quiet top-corner affordance in both states — one element to
  build/maintain, visually uniform across states, but less prominent offline than
  the intent calls for.
- **Option C — Button-styled "Explore the site" CTA.**
  A `.btn`-styled call-to-action ("Explore the site" / "Visit stargazing.events")
  in the status column — most prominent/inviting, reads as an action. Slightly
  more "widget" than a text link.

## Recommendation
1A (discreet top-left back arrow during live) + 2A (prominent
"← stargazing.events" text link when offline). Quiet where it must be, clear
where it can be, one small component with a state-driven variant — consistent
with how the live-status pill's `variant` prop already works.

## Notes for whoever builds it
- States to cover: live-frame view (topbar), `StatusScreen` (offline / next /
  cancelled / temporarily-unavailable / checking), and consider whether the
  farewell screens need it too (they already show next-session copy; a guest
  there is at the END of an event, arguably the calmest place to offer "back to
  the site"). Flag: farewell inclusion is a secondary decision.
- Fullscreen mode (`live-root--fullscreen`) is deliberately chrome-free (just the
  exit button + zoomable image) — do NOT add the affordance there.
- Link target `/` (homepage). Front-end only; no /api/status, schema, or relay
  involvement.
- Build on `feat/live-back-nav` off `main`, hold for review, no push/deploy, no
  AI attribution.
