# UFO Finale — Main UFO Exit Investigation

**Date:** 27-07-2026
**Branch:** `fix/ufo-finale-exit` (off `main` @ `1d65ab2`)
**Status:** Investigation only — **no code changed**. Hold for approval.

---

## Q1 — What actually happens to the main UFO at that moment

It **never leaves, never hides — it just sits there for the entire 12.5-second finale.**
From the finale block ([FarewellAegeanUfo.tsx:626-678](app/live/FarewellAegeanUfo.tsx#L626)):

1. On the 5th tap the UFO gets `spinfast` — a ~0.5s excited spin **in place** (rise 20px,
   360°, scale 1.18, then back — [styles.css:2644](app/live/styles.css#L2644)).
2. The slot is nudged **down 73px** (`.farewell-ufo-slot--finale`, :2493) — to clear the flag
   zone above, not to exit.
3. Then… nothing. The UFO stays rendered, full opacity, at that position, until the reset at
   +12500ms removes the nudge. There is **no exit of any kind in the current choreography** —
   not too subtle, not too late: absent.

Meanwhile the five mini ships (`.farewell-fleet.go`, z-index 5) start flying across
**immediately** (first mini at 0s delay, 2.6s flight, staggered ×5), and the flag assembles
above (z-index 6). The main UFO lives inside `.farewell-card` at **z-index 2** — so every
mini that crosses its position paints **over** it. Result: a full-opacity UFO parked
underneath the traffic → exactly your read, "hidden behind/among the small ships."

## Q2 — Splash-class stacking bug, or choreography?

**Choreography, with a stacking aggravator — and the fix is choreographic.** The z-gap
(card 2 vs fleet 5) is real and explains why it reads as *concealed* rather than *in front
of* the ships. But raising the UFO's z-index would just invert the overlap — a lingering UFO
painting over its own arriving fleet is equally wrong. The actual defect is that the main
UFO has no departure in the sequence at all. Give it one, and the z-order question becomes
moot because it's gone before the overlap matters.

## Q3 — Proposed exit (reusing the scene's existing vocabulary)

The scene already owns a departure verb: **`farewell-flyoff`** ([styles.css:3200](app/live/styles.css#L3200))
— fade + ascend 46px + shrink to 0.5 over 0.8s, ease-in. It's what the flag's 117 aliens
already use to scatter at the end, so the register is native to this finale, not invented.
And it composes naturally with what precedes it: `spinfast` peaks at translateY(−20px), so a
flyoff starting as the spin ends continues the upward motion — the UFO spins up excited,
then rides that momentum out of the sky.

**Timing:**

| t | main UFO | fleet + flag |
|---|---|---|
| 0 ms | `spinfast` (existing wind-up) + bursts (existing) | — (newly delayed) |
| 500 ms | `spinfast` → `flyoff` (0.8s, forwards) | — |
| 600 ms | mid-ascent, fading | fleet `go` + flag `go` start |
| ~1300 ms | **gone** | minis crossing, flag marching in |
| +12500 ms (existing reset) | flyoff class removed; a short opacity **transition** (~400ms) fades it back in with the returning card text — no pop | everything resets as today |

**Overlap: slight, deliberate.** The ships should NOT wait for a completed exit — a 600ms
head start for the departure, with the fleet fading in while the UFO is mid-ascent, reads as
a handoff ("it leaves *as* they arrive") rather than two disconnected beats. The existing
11000/12500ms scatter/reset timestamps stay untouched; the 600ms comes out of the ~9s flag
hold (→ ~8.4s), which is imperceptible — so the finale's total length, the terminal-latch
timing, and `markFinaleCompleted` are all byte-identical.

**Changes required:** one `setTimeout` (flyoff at 500ms) + one 600ms delay wrapper around the
existing fleet/flag `go` block + one cleanup line in the existing reset + ~6 lines of CSS
(a `.farewell-ufo--flyoff` rule reusing the existing keyframes, and the reappear transition).
Nothing else: funnel, bottom exit, meteor layering, tap counting, and the terminal latch are
untouched by construction — the edits live entirely inside the `flagFinaleEnabled` branch
plus one CSS rule.

## Q4 — Tiers

- **Full tier:** as above — this is the only tier where the bug exists.
- **Reduced tier:** **no change, and none needed** — it deliberately has no fleet and no flag
  (`flagFinaleEnabled` is false; the finale is spinfast + reward line only), so there are no
  small ships for the UFO to hide among. The reported defect cannot occur there. Leaving it
  alone is scope discipline, not an omission.
- **Static / reduced-motion tier:** **untouched, no new motion** — it has no finale animation
  at all (5 taps reveal the static reward block; the UFO never moves). Nothing changes.

## Verification plan (post-approval)

`?demo=finished&scene=ufo`, tap ×5, screenshots at ~1s (UFO mid-departure, fleet fading in),
~4s (ships + flag own the scene, UFO gone), ~13s (reset: UFO faded back in with the card
text). Plus the standard drill: tsc + lint + all 15 suites + real build.

**Nothing changed yet. Awaiting your go.**

---

# Addendum — Built (approved, same day)

**One timing correction from the plan:** `spinfast` is **1s**, not the 500ms the proposal
assumed (keyframes end back at identity at 100%). Firing flyoff mid-spin would have snapped
the transform, so the exit lands at **+1000ms** — the exact moment the triple spin returns to
identity — and the fleet/flag start moved to **+1100ms**. Same handoff design, cleaner join:
the spin flows straight into lift-off with no intermediate frame. UFO fully gone by ~1.8s;
first mini fades in from ~1.36s (≈700ms of arrival-over-departure overlap).

**Your confirmation #1 — reappear can't glitch or double-animate: CONFIRMED, two ways.**
By code: post-finale taps hit the terminal latch's `ignored` early-return *before any
classList code runs* — no path exists that touches `flyoff`/`return` after the reset. By
test: 8 taps spammed across the reappear window (12.4–13.6s) in a live browser — final state
`farewell-ufo-unit` (classes clean, no leftovers), opacity 1, zero JS errors.

**Your confirmation #2 — timings byte-identical: CONFIRMED after the change, from the diff.**
`git diff` shows zero changes to the `2600` (reward), `11000` (scatter), `12500` (reset)
timestamps, `markFinaleCompleted`, or the beacon lines. The ~1.1s the ships now wait comes
out of the ~9s assembled-flag hold (→ ~7.9s effective), which is imperceptible; total finale
length is unchanged.

**Screenshot sequence (live run):** mid-departure at +1.35s — main UFO at 61% opacity,
ascending, while the flag cells march in from the left (the handoff, in one frame) · +4s —
UFO computed opacity **0**, ships + flag own the scene · post-reset — UFO restored at
opacity 1 with clean classes despite the tap-spam.

**Tiers:** reduced + static untouched, exactly as scoped (verified by diff — every change
sits inside the `flagFinaleEnabled` branch + one CSS block).

Verified: tsc + lint clean · all 15 suites · real build green. Held for review.
