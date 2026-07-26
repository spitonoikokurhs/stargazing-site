# Farewell Polish — Meteor-Splash Investigation + Two Applied Fixes

**Date:** 27-07-2026
**Branch:** `fix/farewell-polish` (off `main` @ `7fb216e`)
**Status:** All three landed. #1 was investigated first (below), approved, then applied in
`6d20bad` with the deterministic before/after repro: impact pinned onto the boat — BEFORE,
rings painted over the hull and crossed the horizon; AFTER, the identical impact rendered
behind the boat and cut cleanly at the waterline. Repro pins reverted; the commit is layering
only. #2/#3 in `25ead80`. Held for review — no push/deploy.

**Finale-link question (answered, no change made):** during the finale the bottom exit sits
~400px below anything animated, at the same faint contrast as the tap-hint caption — which
has ALWAYS stayed visible during the finale, so the register has precedent. It doesn't
compete with the payoff. If you still want it hidden: clean, ~8 lines (one stage-class toggle
at the three existing finale start/reset sites + a 4-line CSS rule), no new timing logic.

---

## #1 — Meteor impact splash layering (investigation)

### Which scene

**UFO farewell only**, both animated tiers (`full` and `reduced` — the splash code runs in
both). The static tier has no animation engine, and the **eclipse scene is clean** — I grepped
its entire template for splash/meteor/shooting content: zero matches. Its only sky effects
(birds, shadow bands) live inside the iframe and have no impact effects.

### The actual cause — a stacking-context asymmetry, not randomness

The pipeline, from code:
- Shooting stars fly in the sky layers; on impact, `splash()` appends the splash element to
  the **reflection layer** ([FarewellAegeanUfo.tsx:440](app/live/FarewellAegeanUfo.tsx#L440)),
  which also holds the stars' water reflections (:529).
- `.farewell-reflLayer` has **`z-index: 1`** ([styles.css:2233](app/live/styles.css#L2233)).
- The foreground elements — `.farewell-sea` (:2410), `.farewell-shimmer` (:2420), and
  **`.farewell-sail`, the boat** (:2442) — have **no z-index at all** (auto).

A positioned sibling with `z-index: 1` paints above ALL positioned z-auto siblings regardless
of DOM order. So **everything in the reflection layer — splashes and reflection streaks —
always paints on top of the sea gradient, the shimmer, AND the boat.** For the sea/shimmer
that's intended (rings and reflections ARE surface light). The two visible defects, both
driven by the impact's random position — which is exactly why it "looks random":

1. **Splash over the boat.** A splash lands at x = −8+120·t vw (anywhere across the width),
   y = 74vh + depth·16vh (depth = `Math.random()`), scaled up to ~2×. The boat sits at
   x ≈ 50%−140px (a ~46px-wide window) straddling the horizon. Whenever the random impact x
   falls in that window at shallow-to-mid depth, a **far** splash paints over the **nearer**
   boat — a distant water splash occluding a foreground object. Narrow x window → rare →
   "does not happen every time."
2. **Splash poking above the horizon.** A depth≈0 splash is **centered on the 74vh horizon
   line**, so the top half of its glow/rings renders above the sea's crisp `border-top`, into
   the sky — it reads as floating in front of the horizon instead of landing at it. Frequency
   scales with how often `Math.random()` lands near 0.

The reflection streaks share the layer and can cross the boat the same way (subtler — they're
low-opacity).

### Deterministic reproduction — yes

Two dev-only lines in `launch()` pin it: `p.y0 = 59; p.depth = 0.1` makes every star impact at
x ≈ 39vw — the boat's position at a 1280px viewport — splashing over the hull every cycle.
`p.depth = 0` reproduces the horizon-poke on every impact instead. I have not committed any
such patch; it's how I'd verify the fix visually on demand.

### Proposed fix (two small changes — held for your approval)

1. **`.farewell-sail { z-index: 2 }`** — the boat becomes a true foreground object, always
   occluding splashes and reflections. This is also correct in practice, not just convenient:
   the boat straddles the horizon (far water), and genuinely-near splashes (high depth) land
   well below its hull box anyway — so "boat always wins" produces the physically-right
   picture in every reachable case.
2. **Clip the reflection layer at the horizon**: inline `clipPath: inset(${HORIZON_VH}vh 0 0 0)`
   on the reflLayer div in the JSX — using the engine's own `HORIZON_VH` constant, so there's
   no duplicated `74` between CSS and JS to drift apart. Splash rings become waterline
   semicircles (water effects physically can't render above the waterline anymore), which
   kills defect 2 outright. Safe because the layer contains ONLY water-surface content —
   verified: its only two `appendChild` sites are the splash (:440) and the reflections (:529).

No timing, animation, spawn-rate, or color changes — layering only. Say go and it's ~4 lines.

---

## #2 — Back-to-site moved to the bottom (applied)

- **UFO, both tiers:** the link moved out of `.farewell-card-text` to a stage-level,
  absolutely-positioned slot at the very bottom (`bottom: 40px`, above the tap-hint caption at
  8px) — the visual order now reads scene → funnel → exit. Side effect, deliberate and worth
  knowing: being outside the card text, the link **no longer disappears during the finale**
  (the card text hides for the payoff; a small bottom link doesn't compete with it, and the
  calm exit stays available throughout).
- **Eclipse:** the parent-overlay link moved **top-left → bottom-left** (bottom-center is
  owned by the scene's own venue footer inside the iframe). The old top-left rationale
  referenced the cookie-banner collision, which no longer exists (banner is path-suppressed on
  `/live*`); comment updated accordingly.

## #3 — Funnel dismiss → auto-fade (applied)

- Dismiss button removed (JSX, CSS, copy string).
- **Baseline, untouched for 30s → opacity-only fade over 2.4s → gone for the session.** The
  fade fires no beacons and can't touch the impression (its once-guard ref is independent of
  fade state). The sessionStorage flag is kept — **same key as the old dismiss flag**, since
  the semantics are identical ("baseline had its moment this session"), so sessions that
  dismissed under the old build stay quiet after this deploys.
- **Interaction rescues the block:** tapping WhatsApp or review marks it interacted, cancels
  the pending fade — and if the tap lands *mid-fade*, the fade class is removed and the same
  transition gently restores full opacity. The block then stays, exactly as before.
- **Reduced-motion — my call: the block PERSISTS (no auto-fade).** Reasoning: any motion-free
  removal is worse than keeping it. An instant pop-out is *more* attention-grabbing than a
  slow fade; and on the static tier the block sits inline in the card flow, so removing it
  reflows the entire card — a jarring layout jump on precisely the tier that asked for calm.
  The block is small, quiet, and never over a focal area, so persisting is the
  least-attention option, which is the point of the constraint.
- Applies to both scenes and both tiers automatically (it's the one shared component); the
  **finder variant is untouched** — it never had a dismiss and never fades (it's the earned
  payoff).

## Verification

(To be completed before commit: tsc + lint + suites + real build, plus a visual pass of both
scenes via `?demo=finished` at desktop and phone widths — bottom link placement, funnel
fade-out at 30s, interaction rescue.)
