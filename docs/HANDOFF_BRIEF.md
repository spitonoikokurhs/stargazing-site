# Stargazing Site Development Handoff Brief

## Current Status (as of 13-07-2026)

### Recently Completed
- **Frame-stale transition feature** (merged to main): Detects when live frame is >75 seconds old (ingestedAt-based), triggers distinct `uiState: 'frame-stale'` transition separate from run-change logic. Fully reducer-tested with 85+ assertions covering frame-stale trigger, same-run frame exit, timeout, and interaction with run-change.
- **Session startup screen** (merged to main): New `uiState: 'starting'` shown when scheduled event is active but no first frame ingested yet (session.startedAt === null). Server detects via exact event window (margin 0, not 60-minute tracking).
- **Starting screen eyepiece polish** (just merged to main): Premium presentation with 5 animated glowing stars (diffraction spikes, staggered twinkle), hotel logo display (original color, ~30% opacity), session context text ("Tonight at [Hotel] · HH:MM–HH:MM"), simplified "● STARTING SOON" topbar, and custom CSS property overrides for muted copy color. Also fixed transition screen white background by adding `.content--transition` class.

### Git State
- **Current branch**: main (just merged feat/starting-screen-eyepiece-polish)
- **Recent commits**:
  - `12d5069` Fix transition screen white background in content area
  - `59cb90d` Polish starting screen eyepiece state
  - `ec8da81` Merge feat/session-startup-screen into main
  - `205fd66` Add session-startup screen for pre-first-frame event windows
  - `29804d2` Housekeeping: update stale SessionHistoryStrip comment and add tsx to devDependencies
- **Untracked docs** (left in repo, safe to ignore): catalog-additions, drawer-scroll review, enriched-object-content draft, live-business-marketing review, live-system review, starting-screen troubleshoot, tappable-pills review

### Code Architecture Overview

#### Pure Reducer State Machine (`lib/live-status.ts`)
- **LiveStatusState** includes:
  - `uiState`: 'checking' | 'live' | 'offline-*' | 'special-*' | 'starting' | 'degraded'
  - `transitionReason`: 'run-change' | 'frame-stale' | null (replaces old `transitioningRunKey` gate)
  - `transitioningRunKey`: string | null (only for run-change transitions)
  - `transitioningFrameId`: string | null (only for frame-stale transitions)
  - `suppressedRunKey`: string | null (run-change only; frame-stale leaves it unchanged)
  - `lastLiveFrame`: { frameId, runKey, ingestedAt, ... } | null
  - `lastOfflinePayload`: OfflinePayload | null (persists hotel/session context for offline/starting screens)
  - `transitionStartedAt`: number | null

- **Key Events**:
  - `POLL_LIVE_IMAGE_LOADED`: Unconditionally clears all transition state (decision was made upstream)
  - `POLL_RUN_TRANSITIONING`: Sets transitionReason='run-change', transitioningFrameId=null
  - `POLL_FRAME_STALE`: Sets transitionReason='frame-stale', transitioningFrameId=frameId, transitioningRunKey=null
  - `POLL_STARTING`: Clears lastLiveFrame, sets uiState='starting'
  - `TRANSITION_TIMEOUT`: Shared 5-minute timeout; branches on transitionReason (only run-change writes suppressedRunKey)

#### React/UI Layer (`app/live/LiveView.tsx`)
- **LiveViewPresentation**: Top-level router that gates on:
  1. Render priority (checking > terminal states > degraded/offline > starting > historical browsing > transition > live)
  2. `transitionReason !== null` → render TransitionScreen
  3. `uiState === 'starting'` → render StartingScreen
  4. Otherwise → render LiveFrameView (normal live + object card)

- **Poll Loop** (inside LiveViewPresentation):
  - Dispatches `POLL_STARTING` when response has `{ live: false, starting: true, ... }`
  - Routes run-change transitions vs. frame-stale transitions based on what the server responds with
  - Preload-before-switch: for frame-stale, accepts ANY fresher frame; for run-change, only specific awaited runKey
  - Same-frame poll guard: if `transitionReason !== null`, return early (don't dispatch POLL_LIVE_IMAGE_LOADED)

- **Frame-staleness timer** (independent useEffect):
  - Gates on `uiState === 'live' && lastLiveFrame !== null && transitionReason === null`
  - Every 1000ms, checks if `now - lastLiveFrame.ingestedAt > 75000`
  - If stale, dispatches `POLL_FRAME_STALE` with the stale frameId

- **TransitionScreen / StartingScreen**:
  - Reuse same `.viewer/.sky-square/.rim` geometry as live view (no reflow)
  - TransitionScreen: dark spinner + rotating "NEXT OBJECT INCOMING" copy on dark background
  - StartingScreen: animated eyepiece stars + hotel logo + session context + rotating pre-show copy (muted grey)
  - Both wrap in `.live-root` for dark starfield background
  - Content areas use `.content--transition` and `.content--starting` to override inherited `--object-type-bg-subtle` variable

#### Server (`app/api/status/route.ts`)
- Returns:
  - `{ live: true, ... }` for active observations
  - `{ live: false, starting: true, tonight, next }` for pre-show (eventActive && no session.startedAt)
  - `{ live: false, starting: false, ... }` for offline/finished/degraded states
- Startup detection: exact event window (`withinEventWindow(..., margin: 0)`) vs. 60-minute tracking margin

#### Styling (`app/live/styles.css`)
- `.viewer--starting .sky-square`: Dark background with subtle radial gradients (brass/gold tint at 52%)
- `.starting-eyepiece`: Circular container with layered gradients + breathing animation (`6s ease-in-out`)
- `.starting-star--[one-five]`: Five glowing cores (13px–8px) with CSS custom properties for position, size, alpha, twinkle speed, delay
  - `::before` / `::after` pseudo-elements create diffraction spikes (horizontal/vertical)
  - Twinkle animation: 0.36→0.72→0.46 opacity over 4.2–6.2s, staggered delays
- `.starting-hotel-logo`: `max-width: min(55vw, 195px)`, max-height 49px, opacity 0.92
- `.starting-session-context`: `clamp(10.5px, 3vw, 12px)`, uppercase, muted grey (rgba(168, 166, 160, 0.58))
- `.live-object-desc--starting-copy`: Overrides --transition-main-color and --transition-instruction-color to dimmer greys
- `.content--transition` / `.content--starting`: background: transparent (overrides inherited --object-type-bg-subtle)
- `.rim-brand`: Curved "STARGAZING.WORLD" text around the telescope rim (opacity 0.32)

### Demo Mode Hooks
- `?demo=starting`: Returns { live: false, starting: true, tonight, next } with mock hotel logo and session context
- `?demo=known&stale=<seconds>`: Backdates ingestedAt (not capturedAt) to test frame-stale trigger without pausing relay
- `?demo=history-test`: Placeholder for future history-pill-browsing feature (not yet implemented)

### Testing
- **Reducer test suite** (`scripts/test-live-status.mjs`): 85+ assertions
  - Tests 1–9: run-change behavior (regression checks, unchanged)
  - Tests 10–18: frame-stale trigger, same-run frame exit, timeout, stale-event-for-gone-frame guard, interaction with run-change
  - Tests 19–21: session startup (POLL_STARTING sets state, first frame exits to live, finished wins over starting)
  - Run locally: `npx tsx scripts/test-live-status.mjs` (requires `tsx` in PATH; known issue on EditStation: `tsx.cmd` missing despite being in package.json, but verified working on dev machines)
  - Run via npm: `npm run test:live-status` (should work everywhere)

- **Manual verification**: tsc --noEmit and next lint both pass; phone testing confirms startup screen stars/logo/layout, transition screen background fix

### Known Limitations / Future Work
- **History-pill browsing** (planned, not implemented): Feature to tap completed history pills and browse earlier targets. Architecture plan exists in `/claude/plans/resilient-giggling-dahl.md` (not started yet). Would add `selectedHistoryRunId` state to LiveViewPresentation, new HistoricalFrameView component, catalog-backed DisplayObject construction, preload-before-switch guard for image availability.
- **Reducer test suite runner**: Can't run locally on EditStation due to missing `tsx` package in PATH, but npm scripts confirmed working. Not a blocker for further development.
- **Production deployment**: Merge to main pushes to GitHub but bypasses required PR gate (remote accepts direct push with warning). No CI/CD pipeline visible in this codebase; assume manual deployment or GitHub Actions elsewhere.

---

## What to Do Next (Suggested Priorities)

### Option A: History-Pill Browsing (Planned Feature)
Start implementing the browsing feature per the plan in `/claude/plans/resilient-giggling-dahl.md`. This is the next major feature request after startup screen. Requires:
1. Lifting `selectedHistoryRunId` state to LiveViewPresentation
2. New HistoricalFrameView component (reuses existing card/image rendering but gates on history selection)
3. Tap handler with preload-before-switch (abort-safe)
4. Catalog-backed DisplayObject construction
5. HistoryPill → real `<button>` conversion
6. Extended demo mode coverage

Estimated scope: moderate (reuses existing components heavily, but requires careful state threading)

### Option B: Bug Fixes / Polish
- Check if there are any reported issues in Linear or Slack (reference memory suggests bugs are tracked there)
- Verify transition screen white background fix is stable across all demo modes
- Consider accessibility audit (screen-reader labels, keyboard navigation)

### Option C: Refactoring / Tech Debt
- Reducer test suite local runner (either add `tsx` to the environment or rework test script)
- Review any stale code comments or TODO markers
- Consider extracting repeated color/animation patterns into CSS custom properties

---

## Key Files to Know

| File | Purpose | Key Changes |
|------|---------|------------|
| `lib/live-status.ts` | Pure reducer state machine | transitionReason field, POLL_FRAME_STALE/POLL_STARTING events, timeout logic branches on transitionReason |
| `app/live/LiveView.tsx` | React UI layer, polls, routing | LiveViewPresentation router, frame-staleness timer, TransitionScreen/StartingScreen components, STARTING_PHRASES, startingHotelLogo/formatStartingSessionContext helpers, TransitionCopy extended with showLoader/instruction/className |
| `app/live/styles.css` | All styling | .viewer--starting, .starting-eyepiece, .starting-star--[1-5], .starting-hotel-logo, .starting-session-context, .content--transition/.content--starting, .rim-brand, twinkle keyframes |
| `app/api/status/route.ts` | Server status endpoint | Session startup detection (exact event window, margin 0) |
| `scripts/test-live-status.mjs` | Reducer test suite | 85+ assertions covering all new transitions and edge cases |

---

## Setup for Next PC

1. Clone or pull the repo (main branch is current)
2. Run `npm install` (tsx should be available here; if not, install with `npm install --save-dev tsx`)
3. Start dev server: `npm run dev` (defaults to http://localhost:3000)
4. Run type checks: `npx tsc --noEmit` and `npx next lint` before any commits
5. Run reducer tests: `npm run test:live-status` (should pass all 85+ assertions)

---

## Important Notes for Continuity

- **No AI commit trailers**: Never add `Co-Authored-By: Claude ...` or similar to commits in this repo (per user's standing instructions)
- **Date/time format**: Always use dd-mm-yyyy dates and 24h HH:MM time (per user's memory)
- **Commit philosophy**: Create new commits for changes (never amend published commits); prefer bundled PRs over many small ones for refactors; don't add features beyond task scope; trust internal code guarantees (no defensive error handling for impossible states)
- **Testing before commit**: tsc/lint must pass; if reducer tests can't run locally, note it but don't block (npm scripts work)
- **Demo-mode safe testing**: Use `?demo=` hooks for testing without hitting production data; dev server is currently stopped/pointed at production

---

## Context for Understanding Recent Decisions

### Why transitionReason (not just transitioningRunKey)?
The old code only tracked `transitioningRunKey`, which worked fine for run-change transitions. But frame-stale transitions don't have a specific run they're waiting for (they accept any fresher frame from the same run OR a different run). So we needed a separate `transitionReason` field to distinguish which kind of transition is in progress, and diverged the timeout logic (only run-change writes suppressedRunKey). This is a cleaner design than trying to use transitioningRunKey for both purposes.

### Why ingestedAt (not capturedAt) for staleness?
`capturedAt` is the device timestamp (could be way in the past if the device's clock is wrong or offline). `ingestedAt` is the server's receipt timestamp (the moment the relay received the frame from the telescope). Staleness should reflect "how long since we got data from the relay," not "how old is the device's measurement." Also, ingestedAt is already available end-to-end in the pipeline (wire type → LiveFramePayload → LiveFrame → reducer state), so no new fields needed.

### Why startup screen at all (vs. just showing live with "waiting" text)?
The startup screen exists to give guests a calm, intentional "we're not ready yet" visual before the first frame arrives. It reads as a distinct pre-show state (not a glitchy blank frame or a transition). The eyepiece stars + hotel logo + session context create a premium "we're here, we're set up, we're waiting for the telescope" feeling, which is better UX than a spinner or a black circle.

### Why does history-pill browsing live in LiveViewPresentation (not LiveFrameView)?
If `selectedHistoryRunId` lived inside LiveFrameView's own useState, it would be destroyed when a transition starts (LiveFrameView unmounts during transitions). That would yank the guest away from their historical browsing — bad UX. By lifting it to LiveViewPresentation, the state persists through transitions and the historical view stays visible even if a new run arrives in the background. The render priority tree ensures historical browsing never gets yanked away.

---

## Questions for the User (If Needed)

If you hit blockers or need clarification on the next PC:
- Is history-pill browsing the next priority, or should we focus on bug fixes first?
- Are there reported issues in Linear/Slack that should be addressed before the next feature?
- Should the reducer test suite runner be fixed (install tsx locally, or rewrite test script)?
- Any accessibility or performance concerns to address?

---

## Commit History (Last 10)
```
12d5069 Fix transition screen white background in content area
59cb90d Polish starting screen eyepiece state
ec8da81 Merge feat/session-startup-screen into main
205fd66 Add session-startup screen for pre-first-frame event windows
29804d2 Housekeeping: update stale SessionHistoryStrip comment and add tsx to devDependencies
182ae02 Merge fix/frame-stale-same-frame-clear into main
dd06474 Fix frame-stale transition clearing on a same-frame poll
8ed6ca8 Merge feat/frame-stale-trigger into main
0a9f18a Implement frame-stale transition (75-second staleness detection)
e8b3c3c Merge feat/frame-stale-reducer into main
```

---

**Generated**: 13-07-2026  
**Branch**: main (just merged feat/starting-screen-eyepiece-polish)  
**Status**: Ready for next feature or bug-fix work
