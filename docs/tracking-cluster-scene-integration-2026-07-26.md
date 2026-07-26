# Tracking Cluster — Scene-Integration Investigation Report

**Date:** 26-07-2026
**Branch:** `feat/interaction-tracking-review-funnel` (fresh off merged `main` @ `aa53157`)
**Status:** BUILT — decisions approved (all defaults + riders C/D). Held for review, not pushed.

This began as the "investigate-first" deliverable the spec required *before* placing the
review-funnel reveal or wiring the Tier-1 beacons. Every claim in the investigation
(sections 1–7) is grounded in the actual code (file:line references throughout). Section 6
listed the decisions; **you approved all five defaults with two riders (C: touch the
eclipse file safely; D: plumb tonight's hotelId)**, and the cluster is now built.

**→ Jump to [Part 2 — What Was Built](#part-2--what-was-built) for the implementation, the
Tier-1 identifier-free proof, and the deploy/review notes.**

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

---

# Part 2 — What Was Built

Decisions approved (all five defaults; riders **C** = touch the eclipse file with one
guarded line, **D** = plumb tonight's hotelId). Built in the §7 order across two commits.
Held for review — **not pushed, not deployed.**

## Files

**New:**
- `lib/interaction-events.ts` — the interaction-key allowlist + pure helpers (objectId
  normalisation, counterField build/parse, event validation). Fully unit-tested.
- `lib/interaction-stats.ts` — Redis buffer: `recordInteraction` (HINCRBY + 48h TTL GC +
  server-side buffer cap of 512 fields), `readInteractionStats`, and the shared server-side
  `resolveInteractionScope` (one eventKey resolver for track + read + flush, mirroring viewer-stats).
- `lib/interaction-stats-flush.ts` — Redis→Postgres flush (`flushInteractionStats`, idempotent
  absolute-value upsert) + `readDurableInteractionStats` (read side).
- `lib/track-client.ts` — client transport: `trackInteraction` (sendBeacon/keepalive),
  `trackingContextFor` (the demo/debug OFF-gate), `track` (context-aware emit), `deriveEventSlug`.
- `lib/review-funnel.ts` — `REVIEW_URL`, `whatsappUrl(hotelId)` venue-aware prefill, copy.
- `app/live/ReviewFunnel.tsx` — the baseline/finder reveal component (impressions on visible,
  clicks per variant, sessionStorage dismiss for baseline).
- `app/api/track/route.ts` — the Tier-1 beacon sink.
- `app/api/interaction-stats/route.ts` — the authed read endpoint (viewer-stats token pattern).
- `app/api/cron/flush-interactions/route.ts` — the ~5min periodic flush cron.
- `prisma/migrations/20260726T000000_add_event_interaction_stats/migration.sql` — the table.
- `scripts/test-interaction-events.mjs` (43 assertions, pure) + `scripts/test-interaction-stats.mjs`
  (Redis integration).

**Modified:**
- `lib/redis.ts` — added `trackRatelimit` (120/min per IP, separate prefix).
- `prisma/schema.prisma` — `EventInteractionStats` model.
- `app/live/LiveView.tsx` — tracking context + 6 hook points + hotelId/onTrack threading.
- `app/live/FarewellAegeanUfo.tsx` — UFO tap/finale beacons, baseline-dwell + finale-completed
  gating, the ReviewFunnel card-tail reveals (both animated + static tiers).
- `app/live/FarewellEclipse.tsx` — totality `message` listener + baseline funnel overlay.
- `app/live/farewell-eclipse-scene.ts` — **one additive guarded line** (see below).
- `app/live/styles.css` — funnel CSS (calm, reduced-motion aware).
- `app/api/status/route.ts` + `lib/live-status.ts` — additive `hotelId` on finished payload (D).
- `app/api/finish/route.ts` — interaction flush at finish-night.
- `vercel.json` — the periodic cron registration.

## Scene integration (the delicate parts)

- **UFO:** baseline reveal appears ~18s after mount (the dwell — there's no built-in settle);
  finder reveal after the finale *fully completes* (surfaced via a new `finaleCompleted` React
  state flipped at the finale reset points, and at the static-tier `staticRevealed` latch). Both
  live in the card-tail (below Back-to-Home), so they're correctly hidden during the finale and
  never cover the UFO / flag / reward focal zones. Static tier gets the baseline too.
- **Eclipse (rider C):** the scene posts `{type:'eclipse-totality'}` to `window.parent` at first
  totality, guarded by `window.parent !== window` in a try/catch. `FarewellEclipse` listens and
  reveals the baseline funnel as a top-right sibling overlay (no finder — the eclipse has no
  finale). The **exact diff** of the scene file is one comment + one statement, zero existing
  lines changed:

  ```diff
  +      // ADDITIVE, standalone-safe: notify the host page (when embedded) that totality was reached...
  +      try{ if(window.parent && window.parent!==window){ window.parent.postMessage({type:'eclipse-totality'},'*'); } }catch(e){}
  ```

  **Standalone verified:** I rendered the scene to a file, opened it directly in a headless
  browser (so `window.parent === window`), and drove it through totality — **zero JS errors**,
  no visual change. Your offline `scene-eclipse.html` pitch file is safe.

## Tier-1 identifier-free proof (the non-negotiable constraint)

Tier-1 stores **nothing that identifies a person**, by construction — verified end to end:

1. **The wire payload is only `{ key, objectId? }`.** `key` must be in the fixed allowlist
   (`lib/interaction-events.ts`); `objectId` is a **catalog object** (e.g. `M57`) — a property
   of the sky, not the viewer — and is length/char-class normalised. `validateInteractionEvent`
   **ignores every other field** on the body (tested: a body with `viewerId`/`ip` fields has them
   dropped). No cookie is read or set; the client sends `credentials: 'omit'`.
2. **The IP is used only to rate-limit, never stored or logged.** `/api/track` reads
   `x-forwarded-for` solely to call `trackRatelimit.limit(ip)` (Upstash hashes it into an
   internal counter key with a short TTL — the raw IP is not persisted as data). Unlike
   `/api/ingest`, `/api/track` doesn't even *log* the IP. No `x-forwarded-for` value leaves the
   function; it never reaches a counter, Redis hash, or Postgres row.
3. **The eventKey is resolved server-side** from the schedule — the client can't choose its
   counter bucket beyond the allowlisted key + optional catalog objectId.
4. **The stored data is pure tallies.** `EventInteractionStats` rows are `{ eventKey,
   counterField, interactionKey, objectId, count }` — counts of anonymous events per event
   window. No per-person row exists; there is no viewerId column. (Tier-2 consented journeys are
   **not** built in this cluster — when added, the viewerId would attach client-side only when
   `hasAnalyticsConsent()`, and only then would any identifier be sent.)

Legal footing: identical to a server log line of aggregate counts — no consent required, because
no identifier is stored or sent.

## Guest-render safety (nothing blocks/crashes the live feed)

- Beacons are fire-and-forget (`sendBeacon`/`keepalive`), never awaited, wrapped in try/catch.
- `/api/track` **cannot 500**: rate-limit error → continue; bad body → 204; Redis error → 204.
- Tracking is **fully OFF** for demo (`/api/demo-status`) and the operator debug view (tested).
- The flush (finish + cron) is best-effort/non-fatal, mirroring the live viewer-stats flush.

## Verification

- ✅ `tsc` clean · `lint` clean · real `next build` green (all new routes present)
- ✅ **All 14 test suites pass** (incl. the new 43-assertion pure suite + the Redis integration
  suite; and viewer-stats, which only ever failed here for want of `--env-file`).
- ✅ Standalone eclipse file driven through totality in a real browser — no errors (rider C).

## Deploy / review notes (for when you're back)

1. **Vercel cron cadence:** `*/5 * * * *` on `/api/cron/flush-interactions`. Vercel **Hobby**
   only permits daily crons — if this project is Hobby, the deploy will reject the schedule.
   On **Pro** it's fine. If Hobby, drop it to the finish-flush only (still durable at night's end)
   or upgrade. Flagging because it's a deploy-time gate, not a code issue.
2. **DB migration** must run on deploy (`prisma migrate deploy`) to create the table — same as
   any prior migration on this project.
3. **`VIEWER_STATS_TOKEN`** already gates `/api/interaction-stats` (reuses the viewer-stats token).
4. **Manual walkthrough not done against production data:** per the standing rule (no Neon dev
   branch; dev server points at prod), I verified via build + tests + the standalone browser run
   rather than driving the live dev server. A quick manual pass on a real finished event (or a
   dev branch) is worth doing before deploy: tap history pills, open the drawer, enter fullscreen,
   reach the UFO finale, and confirm the funnel appears and `/api/interaction-stats` shows counts.

**Built, verified, held for review. Not pushed. No AI attribution.**

---

# Part 3 — Post-audit review pass

A full end-to-end audit was run over the finished cluster (client → wire → server → Redis →
Postgres → read side → funnel UI). Ten findings; you approved six fixes, four were noted as
by-design. All six are applied and re-verified.

## Fixes applied

1. **Demo-mode beacon pollution (the one that mattered).** `/live?demo=history-test` (the
   local query-param test mode) kept `statusUrl='/api/status'`, so the URL-based gate couldn't
   see it and operator test runs emitted REAL beacons into tonight's counters — the exact
   pollution class the spec exists to prevent. Fix: `trackingContextFor` gained a third
   `localDemoMode` param that kills tracking when non-null; LiveView passes `getDemoMode()`.
   The gate lives in the pure function, so it's directly unit-tested (4 new assertions),
   including "local demo also kills special-event tracking."
2. **Rate limit sized for venue reality — flat 600/min, NOT ip+UTC-hour keying.** Why: the
   limiter is a sliding ONE-MINUTE window; suffixing the hour into the key only rotates which
   bucket counts each hour — it adds zero peak-minute capacity, which is the thing the
   farewell crowd actually hits (30-50 phones behind one hotel NAT ≈ 250/min worst case
   through a single IP). 600/min gives that moment ~2.4x headroom. Abuse stays bounded by the
   layers BEHIND the limiter: the allowlist drops unknown keys, the 512-field cap bounds hash
   growth, and the worst an in-limit abuser can do is inflate anonymous tallies — no storage
   blowup, no identifier, no cost cliff. Simpler AND correct, so it won.
3. **Static-tier tap double-count.** The reduced-motion 5th tap emitted both `farewell_ufo_tap`
   AND `farewell_finale_reached`; the animated tier emitted only the finale. Now gated
   `< TAP_TIER_3` — both tiers count identically (taps 1-4 = taps, tap 5 = finale only).
4. **`eclipse_totality_reached` counter added.** Roughly half the guests get the eclipse; this
   is its engagement analogue of the UFO finale. Once-guarded per farewell view (the scene
   posts the message on every replay loop; the beacon fires only on the first), routed through
   the same `onTrack` ref pattern as the UFO scene.
5. **`?date=` on `/api/interaction-stats`.** Mirrors `/api/viewer-stats`' archive branch: past
   hotel nights read from the durable rows (`archived:true`, `found` flag); today/special
   events fall through to the current-scope read unchanged.
6. **Tracking context memoized** (stable identity across poll re-renders; it sits in effect
   dep arrays).

**Midnight-straggler note (#6, no code change):** one calendar date can hold TWO eventKeys —
the real `<date>:<hotelId>` night and a `<date>:hotel` fallback bucket (hotelId null) fed by
guests lingering past midnight. Same date-keying viewer-stats has by design. The `?date=`
response now surfaces `eventKeys` + per-row `hotelId` precisely so the future season view can
tell them apart — **rule for that view: a hotelId-null bucket under a date that also has a real
night is straggler noise, not a second event.** Documented at the source
(`readDurableInteractionStatsByDate`).

**Noted, no action (by design):** Redis round-trips per beacon (~4; pipeline later if ever
needed), sequential flush upserts (fine at realistic counter counts), read-side ≤5min
staleness (durable-table semantics, documented). **Tier 2 banked separately** — per-viewer
journeys need an append-only table, a different shape; deliberately not entangled here.

## Re-verification (after fixes)

- ✅ `tsc` clean · `lint` clean · real `next build` green (new routes `ƒ`-dynamic; the new
  endpoint declares `force-dynamic` so it doesn't add probe noise to the build log)
- ✅ **All 14 suites pass** — the pure suite now at 49 assertions including the demo-gate and
  totality-key cases.

## Answer 1 — Vercel cron: how to check the plan, and the fallback

- **Check:** Vercel dashboard → your team avatar → Settings → Billing shows Hobby/Pro. (Or
  just deploy: on **Hobby**, the `*/5 * * * *` schedule in vercel.json **fails the deployment**
  with a cron-schedule error — Hobby crons are limited to once-daily triggers, max 2 jobs.
  With flush-interactions added this project has exactly 2, so the count is fine either way.)
- **On Pro:** nothing to do — 5-min cadence deploys as-is.
- **Fallback if Hobby:** change the schedule to `"0 2 * * *"` (daily, an hour after
  close-sessions). Durability degrades gracefully, not badly: the finish-flush still lands the
  night's final numbers the moment you finish; the daily run becomes a backstop that fully
  recovers even a MISSED finish, because the Redis buffer lives 48h. What you lose vs 5-min is
  only the mid-event crash window ("crash loses the night's so-far counters until the morning
  backstop" instead of "loses ≤5 minutes") — Redis itself crashing mid-event is the only
  scenario where that matters.

## Answer 2 — Risk-ordered manual walkthrough (run on production, after deploy)

Ordered by what could hurt most, first:

1. **Farewell feel (guest-sacred, highest risk).** On a phone, on a finished night (or the
   forced-scene query you use for testing): UFO scene plays untouched → ~18s later the baseline
   invitation fades in under the card, calm, dismissible → dismiss sticks for the tab. Tap the
   UFO 5× → the finale plays FULLY uninterrupted → after the flag scatters (~12.5s) the card
   text returns with the finder ask → it opens the Google review form. Then the eclipse guest:
   tap to totality → after totality the top-right invitation appears → WhatsApp opens with the
   right venue in the prefill. Then a reduced-motion phone: static scene, baseline appears with
   no motion; 5 taps → static reward + finder.
2. **Your offline pitch file.** Open your local `scene-eclipse.html` directly — plays to
   totality, zero errors, zero visual change. (Verified headless here; eyeball it once.)
3. **No pollution (fix #1).** `/live?demo=history-test` with DevTools Network open → tap pills,
   open the drawer, go fullscreen → **zero** requests to `/api/track`. Repeat on `/demo/plaza`
   and `/live-debug`.
4. **Real beacons land.** On real `/live`: pill tap / drawer open / fullscreen → Network shows
   `POST /api/track` → 204. Then
   `curl -H "Authorization: Bearer <token>" https://www.stargazing.world/api/interaction-stats`
   → counters present (within ~5 min on Pro; after finish on the Hobby fallback).
5. **Finished payload + finish flush.** After a real `/api/finish`: `/api/status` finished body
   carries `hotelId`; interaction-stats shows the night's rows; next day
   `?date=YYYY-MM-DD` returns them with `archived:true`.
6. **Funnel tallies.** Click each of the funnel's buttons once during a test window and confirm
   the four `funnel_*` click/impression counters increment separately — remembering those test
   clicks are then in the numbers (do it before the event day).

**Fixes applied, re-verified, held for review. Not pushed. No AI attribution.**
