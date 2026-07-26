# Tracking Cluster — Scene-Integration Investigation Report

**Date:** 26-07-2026
**Branch:** `feat/interaction-tracking-review-funnel` (fresh off merged `main` @ `aa53157`)
**Status:** Investigation only — **no build yet**. Hold for review.

This is the "investigate-first" deliverable the spec required *before* placing the
review-funnel reveal or wiring the Tier-1 beacons. Every claim below is grounded in the
actual code (file:line references throughout). It ends with a set of **decisions I need
from you** — genuine forks the spec left open, where guessing wrong would be expensive.

---

## 0. TL;DR — what the code forced me to learn

Four findings change the shape of the build versus the spec's mental model. Read these first:

1. **The eclipse scene is a sandboxed cross-origin iframe** (`sandbox="allow-scripts"`, no
   `allow-same-origin`). The parent React tree is *blind* to everything inside it — no tap
   visibility, no "totality complete" signal, no finale. So the two entrances land
   **asymmetrically**: the UFO scene can host the full funnel (baseline + finder), but the
   eclipse can only host the **baseline** ask, and even that needs a tiny `postMessage`
   added inside the scene to time it "after totality."

2. **The eclipse has no finale at all.** The tap-finale state machine (`lib/farewell-taps.ts`,
   `finaleCompleted` latch) is **UFO-only**. The eclipse's totality is tap-gated, held 9 s,
   then **replayable** — nothing terminal. There is no "finder" moment to hook in the eclipse.
   → **The finder/easter-egg variant is UFO-only.** (Consistent with the spec routing all
   finders to `REVIEW_URL`; there just won't be an eclipse finder path.)

3. **The finished screen doesn't know tonight's venue.** `FinishedInfo = { date, next }`
   (`lib/live-status.ts:101`) — no `hotelId` for the venue that just finished. The only
   hotelId reachable client-side is `next.hotelId` (the *next* session, which can differ or
   be `null`). The WhatsApp prefill wants *tonight's* venue → needs a small upstream plumbing
   change (see §6 + Decision D).

4. **There is no beacon or fetch-on-event pattern in the repo** (`sendBeacon` appears
   nowhere). I'm introducing the Tier-1 transport from scratch. Good news: the *disciplines*
   to mirror already exist — sessionStorage best-effort (`farewell-scene-choice.ts`), consent
   gating (`consent.ts` / `ConsentedAnalytics.tsx`), and a server rate-limiter
   (`ingestRatelimit` in `lib/redis.ts`).

Everything else in the spec maps cleanly onto existing seams.

---

## 1. Scene integration — the heart of the "investigate-first" ask

### 1a. UFO farewell (`app/live/FarewellAegeanUfo.tsx`)

**Render & tiers.** Three performance tiers — `full | reduced | static` — chosen by
`usePerformanceTier()` (`FarewellAegeanUfo.tsx:91-139`). `prefers-reduced-motion: reduce`
hard-forces `static` (`:94`). The animated tiers run an imperative `requestAnimationFrame`
engine inside one big `useEffect`; the static tier is a separate, motion-free JSX branch
(`:673-738`).

**"Settling."** There is **no built-in ~15-20 s dwell timer, no animation-complete event, no
phase state**. The scene reaches its calm baseline essentially at mount (`setStars(2)`,
`:502`). So the spec's "after ~15-20 s dwell" for the **baseline** ask must be a timer I add,
keyed off mount. The only *intrinsic* milestone is the finale (below).

**The finale (the "finder" trigger).** Pure state machine in `lib/farewell-taps.ts`:
- `FAREWELL_TAP_THRESHOLD = 5` (`:14`).
- `tap()` returns `action: 'finale'` on the 5th tap and latches `finaleCompleted = true`
  **permanently** — `idleReset()` deliberately cannot clear it (`:55-58`). Once latched,
  every later tap returns `'ignored'`.
- Animated finale choreography fires at `FarewellAegeanUfo.tsx:561`; it fully completes (flag
  scatter, card-text restored) at **+12500 ms** (full) / **+4500 ms** (reduced).
- Static tier has its **own independent latch**: `staticRevealed` state (`:208`, set at `:220`
  after 5 taps via `staticTapsRef`). Same "5 taps → terminal reward" behaviour, motion-free.

**Two terminal signals, neither currently surfaced.** `tapState.finaleCompleted` is a local
`let` inside the effect closure (`:510`) — not React state, not exposed. `staticRevealed` is
React state but local to the component. To gate a "finder" reveal on "finale fully completed,"
I add a small signal (flip a `useState`/ref) at the finale-reset callback (`:597-608` full /
`:616-622` reduced) and at the static reveal (`:220`). Both paths must be hooked — they use
different counters.

**Placement (never covers the focal area).** Focal zones to avoid: the UFO
(`.farewell-ufo-slot`, top ~14-160 px center), the flag formation during finale (top 5-48%
center), and the transient reward line at `top:48.3%`. The engine already reserves a clean
center rectangle for stars (`x∈27-73%, y∈20-64%`, `:293`).
- **Baseline ask:** append a dismissible block **inside `.farewell-card-text` after
  `.farewell-back-home`** (`:828-830`). It inherits the centered card layout and the
  `z-index:4 / pointer-events:auto` treatment that already keeps the back-home link tappable.
  Bonus: `.farewell-card-text` is hidden during the finale (`--hidden`, `:573`) and restored
  after — so a card-tail reveal politely disappears during the payoff and returns.
- **Finder reveal:** same card-tail slot, but a **distinct finder-flavoured block** gated on
  the finale-completed signal (replacing/augmenting the baseline block once the finale lands).
  Static tier: append after the `staticRevealed` reward (`:709`), gated on `staticRevealed`.

### 1b. Eclipse farewell (`app/live/FarewellEclipse.tsx`)

**Render — sandboxed iframe (the hard constraint).** The whole scene is a single HTML string
built by `buildEclipseSceneHtml()` and dropped into
`<iframe srcDoc={...} sandbox="allow-scripts">` (`FarewellEclipse.tsx:80-99`). No
`allow-same-origin` → the parent cannot read the iframe DOM, and the iframe's scripts run in a
null origin. The scene file is explicitly "byte-for-byte final" (`farewell-eclipse-scene.ts:1-7`),
with a single injection seam (`{{FAREWELL_FOOTER}}`).

**The parent already overlays sibling chrome.** `.farewell-eclipse-back-home` (a `BackToHome`
link) renders as a React *sibling* of the iframe at `zIndex:51`, one above the iframe's
`zIndex:50` (`FarewellEclipse.tsx:106-108`, `styles.css:3586-3592`) — precisely because a link
*inside* the sandbox could never navigate the guest's tab. **This is the pattern the baseline
ask should copy.**

**Timeline & the missing signal.** Totality is **tap-gated**, not timed: 10 taps
(`STEPS=10`) advance the moon; totality holds `TOTALITY_MS=9000`, then a `6000 ms` egress; the
loop then **resets and is replayable** (`farewell-eclipse-scene.ts:661-664, 717-751`). There is
**no `postMessage`, no outbound event** — the parent has zero visibility into totality. The
scene *does* reveal its own venue footer at first totality (`venueFooter.classList.add('show')`,
`:705-709`), so there's precedent for "reveal at totality" — but internal only.
→ To time the baseline ask "after totality completes," the minimal change is **one line inside
the scene** (`window.parent.postMessage({type:'eclipse-totality'}, '*')` alongside the existing
`venueFooter` reveal at `:705-709`) plus a `message` listener in `FarewellEclipse.tsx`. This is
small and targeted but does touch the "byte-for-byte final" file — flagged as **Decision C**.

**Placement.** Focal point: the sun disc, horizontally centered at `top:25vh`. Safe empty zone:
**top-right corner** (top-left is the back-home pill; center column is sun + corona + hint +
reward text; bottom is ruins + venue footer). A small top-right dismissible pill as a **sibling
React overlay** at `zIndex≥51` is the clean fit.

**Reduced motion.** The eclipse has **none** (no `matchMedia`, no reduced-motion CSS) — and the
site's global reduced-motion CSS can't reach inside the iframe anyway. But a **parent-side React
overlay** (the baseline ask) *can* honour `prefers-reduced-motion` on its own, and should.

### 1c. Scene-integration summary

| Capability | UFO scene | Eclipse scene |
|---|---|---|
| Baseline ask (after settle/totality) | ✅ card-tail block, mount-timer | ✅ sibling overlay, needs 1-line `postMessage` |
| Finder / easter-egg reveal | ✅ finale latch (both tiers) | ❌ no finale exists — replayable, no terminal state |
| "Scene shown" beacon | ✅ | ✅ (fired from parent, see §2) |
| UFO-tap / finale beacons | ✅ | ❌ iframe-isolated — not observable |
| reduced-motion honoured | ✅ built-in | ✅ only for the parent overlay we add |

---

## 2. Tier-1 interaction tracking — hook points (all confirmed in code)

`LiveView.tsx` is `'use client'` (`:1`), so beacons + sessionStorage are safe. Hook points:

| Event | Callsite | Handler exists? | Notes |
|---|---|---|---|
| Scene shown (ufo/eclipse) | effect `LiveView.tsx:2076-2079` (after `setFarewellScene`) | resolution effect exists | Fires once per client per finished-date. Right place — render sites would re-fire. |
| History pill tap (by objectId) | `handleSelectHistoryRun` `LiveView.tsx:2168` | ✅ `run.objectId` in scope | Beacon on committed switch. |
| Drawer / "show more" open (by objectId) | `EnrichedCard.handleToggle` `LiveView.tsx:4717` | ✅ but **objectId not in scope** | Fire only on open (`!open`); must thread objectId as a new prop (available upstream as `effectiveDisplayObject`). |
| Fullscreen enter | enter branch of `handleToggleFullscreen` `LiveView.tsx:3305-3312` | ✅ | Hook the enter branch, not the raw button (also fires on exit). |
| UFO taps | `onUfoClick` `FarewellAegeanUfo.tsx:545` + `onStaticUfoTap` `:211` | ✅ imperative | UFO scene only. |
| Finale reached | `:561` (animated) + `:218-221` (static) | ✅ one-shot | UFO scene only. |
| Review/WhatsApp impressions + clicks (4 variants) | new reveal components | new | whatsapp / baseline-review / finder-review / (+ impressions) — per spec routing. |

**Transport.** No `sendBeacon` exists yet. Plan: a tiny client helper
`trackInteraction(eventKey, {objectId?})` → `navigator.sendBeacon('/api/track', body)` (falls
back to `fetch(..., {keepalive:true})`), fire-and-forget, never awaited, never blocks render.
Tier-2 (consented) simply attaches `getConsentedViewerId()` (`consent.ts:76`) to the same body
when `hasAnalyticsConsent()` is true; absent consent, Tier-1 still counts anonymously with **no
identifier in the payload at all** (the provable-identifier-free requirement).

---

## 3. Tier-1 write endpoint + persistence (Part 1)

**New `POST /api/track`** (read-nothing, write-only, fail-open, never 500):
- Validate the eventKey against a **server-side allowlist** (a fixed enum of known event
  keys) — this is what makes Tier-1 sane and caps cardinality; unknown keys are dropped.
- **Rate-limit** by mirroring `ingestRatelimit` (`lib/redis.ts:17`) — a per-IP
  `@upstash/ratelimit` sliding window. The IP is used *only* for rate-limiting and **never
  stored** (satisfies "no IP storage").
- Increment a Redis counter (`HINCRBY` on a per-event-window hash), mirroring the
  buffer-in-Redis discipline of `recordViewerActivity` (`lib/redis.ts:190`), with a TTL GC
  like `VIEWER_STATS_TTL_S`.

**Postgres permanence — new `EventInteractionStats` table**, modelled on `ViewerStatsNightly`
(`prisma/schema.prisma:196`). Flush Redis→Postgres:
- **At finish-night:** hook the existing flush site in `app/api/finish/route.ts:81-107`
  (right where `snapshotViewerStatsNightly` already runs).
- **Periodically during the event:** ⚠️ **no periodic-flush precedent exists** — the only cron
  is daily `close-sessions` (Postgres-only) and a *manual* backfill script. So this is net-new:
  a new authed cron route modelled on `close-sessions/route.ts:30-63`'s `CRON_SECRET` shape,
  calling a snapshot fn modelled on `snapshotViewerStatsNightly`. (See Decision B on cadence.)

**Event-window attribution (not calendar day).** The window is `Session.startedAt` (first
accepted ingest, `ingest/route.ts:389`) → finish. ⚠️ **Ambiguity:** the operator `/api/finish`
POST writes only a Redis flag + `ViewerStatsNightly.capturedAt` — it does **not** stamp
`Session.endedAt` (that's the daily `close-sessions` cron, `lib/sessions.ts:35`). So "finish-
night" as an *end timestamp* isn't cleanly on the Session row today (see Decision A).

---

## 4. Review/testimonial funnel (Part 2) — routing as spec'd

Constants (I'll place them in a small `lib/review-funnel.ts`):
- `REVIEW_URL = https://g.page/r/CQMsZrOvq_kLEBI/review`
- `WHATSAPP_URL = https://wa.me/306947772928?text=<url-encoded prefill>` — prefill includes the
  venue via `hotelDisplayName(...)` (venue source is Decision D).

Routing:
- **Baseline (everyone, after scene settles):** one calm block offering **both** — "Message us
  on WhatsApp" (visually first, lead-capture) + a review invitation → `REVIEW_URL`. Dismissible;
  never reappears (sessionStorage flag, mirroring `farewell-scene-choice.ts`'s best-effort
  read/persist — UX state, not tracking). Shown on **UFO (card-tail)** and **eclipse (top-right
  overlay, after totality `postMessage`)** and the **static tier** (baseline, minus heavy motion).
- **Finder (UFO only, after finale completes):** finder-flavoured single ask → `REVIEW_URL`
  ("you found the secret — tell us about your night"). Gated on the finale-completed signal.
- **Tier-1 tracks all four separately:** whatsapp click, baseline-review click, finder-review
  click, and impressions of each.

---

## 5. Read side (Part 3)

Add a sibling authed `GET` (reusing `viewer-stats/route.ts`'s `statsSecret()` + `authorized()`
+ `json()` helpers, `:27-41`) returning the `EventInteractionStats` rows per `eventKey`. No UI —
the banked calendar/season view consumes it later. Optionally fold into `/api/viewer-stats`
behind a `?interactions=1` param; leaning toward a **separate endpoint** for a clean shape
(Decision E, minor).

---

## 6. Decisions I need from you

These are the genuine forks. I'll default as noted if you'd rather I just proceed, but each is a
real product/data call:

**A. Event-window END timestamp.** The operator "finish" writes a Redis flag +
`ViewerStatsNightly.capturedAt`, **not** `Session.endedAt`. For interaction attribution, do we
(A1) treat the finish-flush moment as the window end and stamp it onto the new stats row's
`capturedAt` (simplest, mirrors ViewerStatsNightly — **my default**), or (A2) also stamp
`Session.endedAt` at operator-finish so the Session row carries a clean window (cleaner data
model, tiny extra write in `/api/finish`)?

**B. `EventInteractionStats` shape + periodic flush cadence.** (B1) **Upsert one row per event**
(like `ViewerStatsNightly`) — **my default** — or append rows (like `MatchDecision`)? (B2)
Periodic flush cadence — a Vercel cron every N minutes during event hours? The spec says "crash =
lose minutes, not the night." My default: upsert-per-event + a cron every **5 minutes** gated to
event hours.

**C. Eclipse totality `postMessage`.** To time the eclipse baseline ask "after totality," I add
**one line** inside the "byte-for-byte final" scene file
(`farewell-eclipse-scene.ts:705-709`) plus a parent listener. OK to touch that file for this one
signal? (Alternative: a parent-side fixed timer, but it can't know if the guest ever reaches
totality, so it'd be a guess — I don't recommend it.) **My default: add the one-line signal.**

**D. WhatsApp prefill venue source.** The finished screen only has `next.hotelId` client-side
(tonight's venue isn't in `FinishedInfo`). Options: (D1) plumb tonight's `hotelId` through the
finished payload (`/api/status` already knows it via `eventFor(today)`) into `FinishedInfo` — a
small, clean upstream change, **my default**; or (D2) fall back to `next.hotelId` / a generic
prefill when absent (zero plumbing, but the prefill sometimes names the wrong/next venue or none).

**E. Read endpoint placement (minor).** Separate `GET /api/interaction-stats` (my default) vs.
folding into `/api/viewer-stats?interactions=1`.

---

## 7. Proposed build order (once decisions land)

1. `lib/interaction-events.ts` — the eventKey enum/allowlist + pure helpers (fully unit-testable,
   no I/O), mirroring `farewell-taps.ts` test style.
2. `POST /api/track` — beacon endpoint (allowlist + rate-limit + Redis HINCRBY), fail-open.
3. Client transport `trackInteraction()` + wire the confirmed hook points (§2).
4. Prisma: `EventInteractionStats` model + migration; flush fn; finish-night hook; periodic cron.
5. Review-funnel components + constants; UFO card-tail (baseline + finder), eclipse overlay
   (+ totality signal), static baseline; sessionStorage dismiss.
6. Read endpoint (§5).
7. Tests: pure logic (in-memory, `node --import tsx`) + Redis integration (`--env-file`,
   randomized keys, self-clean) mirroring `test-consent.mjs` / `test-viewer-stats.mjs`.
8. Full verification: `tsc` + `lint` + real `next build`; manual walkthrough via a demo/test hook.

**Guardrails honoured throughout:** beacons are fire-and-forget (never block render); Tier-1
payloads carry **no identifier** (consent-gated Tier-2 attaches viewerId only); no IP stored;
the reveal is a dismissible guest, never a banner, never over a focal area; finale terminal state
respected (finder only after `finaleCompleted`); eclipse "byte-for-byte" file touched only for the
single totality signal (pending Decision C).

**Nothing has been built. Awaiting your review of the decisions in §6.**
