# /live "Starting Soon" screen — redesign brief (2026-07-22)

**Status:** design brief, not built. For direction before implementation.
When built: front-end only, its own branch off `main`.

## What this screen is
The `uiState: 'starting'` screen (`StartingScreen` in `app/live/LiveView.tsx`).
Shown when a scheduled event is active but the first telescope frame hasn't
arrived yet — the guest is EARLY and on purpose (they scanned the QR / tapped the
Live pill right at the scheduled start), waiting for first light. It's the first
thing a guest sees, so it sets the tone for the whole experience.

## The problem (why it's not nice)
It currently reuses the LIVE view's circular eyepiece chrome — the brass rim,
tick marks, "STARGAZING.WORLD" arc — but with an almost-empty near-black circle
inside (a faint amber center blob + 5 sparse twinkling stars). See
`docs/starting-screen-white-bg-troubleshoot.md` era screenshot.

Concretely what's wrong:
- **Reads as absence, not anticipation.** Borrowing the live view's frame
  without the live view's payload (the image) makes it feel like a broken or
  empty telescope — "nothing here" — rather than "something wonderful is about
  to begin." A big black circle is a void, not a promise.
- **Too dark / low-contrast.** The eyepiece is ~black on a near-black page; the 5
  stars and amber blob are so faint the whole square looks unlit. On a phone in a
  bright hotel lobby it can look like a loading failure.
- **Static and flat.** The only motion is a slow 6s "breathe" on the center glow
  and gentle star twinkle — not enough to communicate "actively getting ready."
- **Copy is fine but unsupported.** "The telescope is waking up… / The first
  live observation will appear here automatically." is good, calm copy — but the
  visual underneath doesn't sell the same warmth.
- **Wastes the moment.** This is a captive, expectant audience at the emotional
  start of the event. Right now it gives them a dark waiting-room.

## Design intent for the redesign
Turn "empty telescope" into "the night is about to open." Keep it calm and
premium (match /live's existing language — deep night palette, brass `--gold`
accent `#c7a869`, Cormorant serif display, understated), but make it feel ALIVE
and ANTICIPATORY, and legible on a phone. It should feel like the held breath
before the first target, not a loading spinner.

Guardrails:
- Front-end only. No /api/status/schema/relay changes — same props
  (`payload`), same state trigger.
- Keep the discreet back-arrow (top-left) as-is — approved, unrelated.
- Keep the honest promise copy ("the first observation appears automatically").
- Respect `prefers-reduced-motion` (the current screen does; the redesign must).
- Keep the hotel logo + session-context line (venue grounding) — they're good.

## Direction options (pick one, or blend)

### Option A — "The sky filling in" (RECOMMENDED)
Replace the empty black eyepiece with a genuinely beautiful, gently ANIMATED
night sky that reads as the telescope finding its bearings: a richer starfield
(dozens of stars at varied depths/brightness, a faint Milky Way band across the
circle), slow drift, and one or two soft shooting stars — building, not empty.
The center could hold a slow, elegant "acquiring" motif (a reticle/crosshair
easing into place, or a target ring gently converging) to say "aligning on
tonight's first object" without a spinner. Warm, alive, premium. The circle
becomes a window onto a real sky, so the jump to the first real frame feels
continuous rather than "black → image."
- Pro: directly fixes "reads as absence"; the same circular frame now has
  something worth looking at; smooth continuity into the live image.
- Effort: moderate — mostly CSS/SVG (or a small canvas starfield), no new data.

### Option B — "Countdown / arrival" anchor
Lean into the guest being EARLY: show the actual start time and a calm sense of
imminence — e.g. "Tonight's session begins at 21:30 · first light any moment,"
optionally a gentle progress/breathing indicator, with the venue name and a
warm one-liner. Less about the visual sky, more about orienting the waiting
guest ("you're in the right place, it's about to start"). Could combine with a
lighter version of A's starfield behind it.
- Pro: maximally reassuring for the early guest; uses real schedule data we
  already have (start time via payload).
- Con: risks feeling more "utility screen" than "magic moment" if the visual
  behind it stays plain — best blended with A.

### Option C — "Signature hero moment"
Make the starting screen its own small designed set-piece (in the spirit of the
UFO / eclipse farewell scenes), a branded opening rather than a muted echo of
the live frame: a distinctive illustration/animation (the Aegean horizon, a
telescope silhouette against the Milky Way, the observatory waking) with the
"starting soon" copy. Highest craft, most memorable.
- Pro: turns a dead moment into a brand asset; bookends the farewell scenes
  (grand open, grand close).
- Con: most effort; needs an art direction pass; risk of over-designing a
  transient screen a guest only sees briefly.

## Recommendation
**Option A as the base** (a living, beautiful sky instead of an empty circle),
**blended with a touch of B** (surface the real start time / "first light any
moment" so the early guest is oriented). That fixes the core "reads as absence"
problem, keeps the effort reasonable, reuses data we already have, and flows
continuously into the first live frame. Option C is the upgrade path if you want
the opening to be a signature set-piece later.

## Open questions for the decision
1. Direction: A, B, C, or the A+B blend recommended above?
2. Keep the circular eyepiece frame, or break out of it for the starting screen
   (a full-bleed sky reads more open/anticipatory; the circle is what makes it
   feel empty today)?
3. Show the literal start time (e.g. "21:30")? We have it in `payload.tonight`
   — reassuring for an early guest, but adds a number to an otherwise poetic
   screen.
4. How much motion is "premium" vs "too much"? (Drift + occasional shooting star
   feels alive; anything spinner-like would cheapen it.)
