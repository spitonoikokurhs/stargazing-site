# History-Pill Browsing — Feature Brief

**Date:** 28-07-2026
**Status:** Already shipped and live on `main`. This brief documents what exists (it was
built alongside the tracking-cluster / season work, not as a separate commit), verified
end-to-end on 28-07 via `?demo=history-test`.

---

## What it is (for a guest)

During a live event, the `/live` screen shows a two-row strip of pills — one per object the
telescope has already imaged tonight. **Tapping a completed pill lets the guest browse that
earlier target**: its saved image plus the full catalog card (type, constellation, distance,
size, and the "did you know" facts), without disturbing the live feed. A clear **"VIEWING
<object> · NOT LIVE"** badge and a **Back to Live** button sit at the top the whole time, so
there's never any doubt they've stepped away from the live view. Tapping Back to Live — or the
currently-live pill — returns them to the feed.

The live feed underneath **never stops**: it keeps polling, transitioning between targets, and
reconnecting exactly as it does normally. Browsing history is a pure overlay on top; when the
guest returns, they land on whatever is live *now*, not where they left.

## How to check it yourself

Dev server is running:
- **This computer:** http://localhost:3480/live?demo=history-test
- **Your phone (same Wi-Fi):** http://192.168.1.206:3480/live?demo=history-test

Things to try:
1. **Tap a named pill** (M27, M31, M51, M20…) → image loads, then switches; the "VIEWING … ·
   NOT LIVE" badge + Back to Live appear; the card fills with that object's real catalog
   content; the milestone toggle (First / 2min / 5min) disappears while browsing.
2. **Back to Live** → returns to the live/demo frame; milestone toggle reappears.
3. **The greyed "Veil Nebula" pill** (deliberately has no saved image) → shows an inline "No
   saved image for this target." message and **stays put** — no switch.
4. **The "…" settling pill** (an unresolved target) → not tappable at all.
5. **Keyboard:** the pills are real buttons — tab to them, Enter to select; the badge reads to
   a screen reader.

## What's built (the guarantees, confirmed in code)

- **Preload-before-switch.** The image is fully loaded *before* the view changes, so a guest
  never sees a broken/blank frame mid-switch. A rapid double-tap across two pills can't let a
  slower load overwrite a faster one (abort-controller guarded).
- **Live feed untouched.** The historical selection is local UI state — it never touches the
  live reducer, never dispatches an event, never pauses a poll. A new live target arriving
  while the guest browses does **not** yank them away.
- **Catalog-backed content, safe fallback.** The card is looked up from the real catalog by
  object id. If the catalog somehow has no entry but the image is valid, it still switches and
  shows a minimal id/name/type card — never invented content.
- **Unmissable "not live" state.** The badge is always visible while browsing; there's no way
  to be on an old frame and think it's live.
- **Coexists with everything.** Works mid-transition (pills stay tappable on the transition
  screen too), and is mutually exclusive with the milestone toggle (selecting a pill resets
  the toggle to "current"; the toggle is hidden while browsing) so the two "viewing earlier"
  modes can never disagree.
- **Terminal-state cleanup.** If the event finishes / goes offline / degrades while a guest is
  browsing, the historical selection clears automatically (those screens have no card slot).
- **Accessibility.** Pills are real `<button>`s with `aria-pressed` (the selected historical
  pill) and `aria-current` (the live-active pill), `disabled` on settling pills, and
  descriptive labels. Back to Live is keyboard-reachable only while browsing.

## Verified (28-07-2026)

Walked the full flow in a real browser at phone width via `?demo=history-test`: 9 pills
render, 7 named-and-tappable; tapping M27 → "VIEWING M27 · NOT LIVE" with the full Dumbbell
Nebula card; null-image pill → "No saved image for this target.", no switch; Back to Live
clears cleanly; zero JS errors. No code changes were needed — the feature is complete.

## One honest note (not a bug)

In `?demo=history-test` the mock deliberately pairs **mismatched** images with object ids
(e.g. tapping M27 "Dumbbell Nebula" shows a spiral-galaxy image) — the fixture's job is to
stress the card-vs-image render paths, and it's a dev-only URL. **On a real event this cannot
happen**: the image and the object id both come from the same StackRun, so they always match.

Optional (~10 min if you want it): swap the mock's images so each pill's picture matches its
object, purely so a screen-share of the test URL never *looks* wrong. Recommended only if you
demo the test URL to anyone; otherwise leave it — it's exercising code paths, not presenting
to guests.

## Files (for reference)

- `app/live/LiveView.tsx` — `handleSelectHistoryRun` (tap + preload + abort), `selectedHistoryRun`
  state, `displayObjectForHistoryRun` (catalog mapping), the inline historical render in
  `LiveFrameView`, `HistoryPill` as a real button, `MOCK_HISTORY` demo data.
- `app/live/styles.css` — `.viewing-earlier-badge`, `.back-to-live-button`,
  `.history-preload-error`, `.history-pill--no-image`.
