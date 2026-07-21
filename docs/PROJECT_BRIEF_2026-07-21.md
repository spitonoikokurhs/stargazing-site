# Stargazing-site — FULL PROJECT BRIEF (state as of 21-07-2026)

Paste-into-a-fresh-conversation context dump. Everything you need to hand this
off cold: what the system is, how endings/fallbacks work, SmartEye vs Seestar,
the current M101 fix, exact git/branch/migration status, and the exact
deploy-order commands. Written because the working chat filled up.

---

## 0. TL;DR / WHERE THINGS STAND RIGHT NOW

- **Repo:** `stargazing-site`, Next.js 14 (App Router), deployed on **Vercel**.
  Prod data: **Neon Postgres** (Frankfurt) + **Upstash Redis**.
- **Default branch:** `main`. (There is NO `master`.)
- **Current working branch:** `fix/m101-naming-match`, **1 commit ahead of main**:
  - `2e16066  Fix M101 naming: show off-center 'medium' matches, withhold contested ones`
- **Two DB migrations are written but NOT applied** (pending on Neon):
  - `20260721T000000_add_match_decision_contested`  (adds `MatchDecision.hasInRangeRunnerUp BOOLEAN` nullable)
  - `20260721T010000_add_stackrun_contested`        (adds `StackRun.hasInRangeRunnerUp BOOLEAN` nullable)
- **CRITICAL DEPLOY ORDER: migrate FIRST, then deploy code.** (Reason + exact
  commands in §7. Code-first would break live ingest — a missing column is a
  hard SQL error inside the ingest transaction, not a graceful null.)
- **Nothing is merged to main yet, nothing is deployed yet, migrations not run.**
  The commit itself is safe to have; it's the deploy+migrate ordering that matters.

---

## 1. WHAT THE PRODUCT IS

A live stargazing-events business in **Kos, Greece**. On event nights a telescope
at a hotel streams stacked astrophotography frames to a public web page
(`/live`), where hotel guests watch the current deep-sky object build up in near
real time, with a name, a catalog card, facts, and a session-history strip of
what's been viewed tonight.

**Hotels (schedule slugs in `config/schedule.json`):**
- `astir-odysseus` (Astir Odysseus)
- `caravia-beach`
- `oku-kos`
- `paralos-kyma-dunes`

Each hotel has a weekly slot (day + start/end time, Athens local). One
`Session` row per hotel per night.

---

## 2. THE HARDWARE / RELAY PIPELINE (SmartEye vs Seestar)

Two telescope sources, both POST frames to the SAME endpoint `/api/ingest`:

- **`pegasus`** = the **Pegasus SmartEye** rig. Plate-solves and reports
  `astrometryState: "solved"` + `raDegrees`/`decDegrees` (in DEGREES). **SmartEye
  produces NO object names** — only coordinates. Naming is 100% our job
  (coordinate → catalog match). This is the primary/most-used rig.
- **`seestar`** = a **ZWO Seestar S50**. Same ingest contract (`source=seestar`).
  Lower frame cadence (~1 new frame/min vs SmartEye's few seconds).

**The relay** is a **separate Termux Python script** running on a OnePlus Pad
(one script per device). It fetches the latest image from the scope over the
local Wi-Fi hotspot and POSTs it (multipart form) to `/api/ingest` with the
`source` id, a `targetName` (usually absent/"Unknown" in practice), `capturedAt`,
and a `metadata` JSON blob. **The relay code is NOT in this repo** — you can't
edit it from here.

**Key metadata fields the app reads from the relay (verbatim, no remapping):**
- `astrometryState`: one of `unavailable | solved | failed | present_unknown`.
- `raDegrees`, `decDegrees`: numbers, degrees. Only trusted when
  `astrometryState === "solved"`.
- `totalAccumulatedTime`: stack integration seconds — the RELIABLE stack-progress
  signal (astrometry can be stale/frozen; this always advances).
- `state`: e.g. `IMAGE_STACK_RUNNING`.

**Stale-astrometry gotcha (documented in `docs/OPERATIONS.md`):** SmartEye reports
the LAST successful solve, not a fresh per-frame solve. If you start a stack
before centering, the solve reflects the off-center GoTo landing and persists
stale for the whole stack → correct image, off-center coordinates. **Operator
rule: slew → platesolve → CENTER the object → confirm dead-center → THEN "New
Observation" to start stacking.** Off-center starts are the root of the "medium
confidence" naming cases (see §5).

---

## 3. HOW NAMING WORKS (coordinate → catalog match)

- **Catalog:** `config/catalog.json` (static objects with `raDeg`, `decDeg`,
  `displayRadiusDeg`, `priority`, names/aliases, rich card content). Moon/planets
  are `requiresEphemeris` and excluded from the static matcher.
- **Matcher:** `lib/catalog.ts` → `matchCoordinates(ra, dec)` returns
  `{ match, confidence, separationDeg, hasInRangeRunnerUp }`.
  - Finds catalog objects whose center is within their own `displayRadiusDeg` of
    the solve; picks by priority then closeness.
  - **Confidence tiers:** `high | medium | low | none`.
    - `high` = well-centered (size-aware cutoff; big objects are lenient).
    - `medium` = EITHER (A) off-center of an isolated object (identity CERTAIN,
      just not centered) OR (B) genuinely ambiguous (a runner-up object also in
      range). These two are the crux of the M101 fix — see §5.
  - **`hasInRangeRunnerUp`** (NEW): objective FACT — is a second catalog object
    within ITS OWN radius of this solve? Distinguishes medium-A from medium-B.

---

## 4. DISPLAY STATES / FALLBACKS ON `/live`

The live card resolves ONE of three display states per frame
(`resolveDisplayObject` in `app/live/LiveView.tsx`):

- **`known`** — a confident catalog match → shows the object NAME, type pill,
  facts, description, enriched drawer. Gated by `shouldShowMatchName` (see §5).
- **`moving`** — `astrometryState` is `unavailable`/`failed` (telescope slewing
  between targets) → "Next object incoming" transitional copy, no name.
- **`fallback`** — solved but no confident nameable match → neutral **"Deep-sky
  field"** pill (deliberate, dignified — NOT an error/empty gap). This is the
  no-name state a withheld/ambiguous match falls back to.

**Session-history strip:** two-row strip of tonight's past targets as pills.
Pills are **TAPPABLE** — tapping renders the full named object card for that past
run (`displayObjectForHistoryRun`). `isDisplayableRun` decides which runs get a
named/tappable pill; non-displayable ones are dropped (or, if the active run,
shown as a neutral "…" settling pill that is `disabled`).

---

## 5. THE M101 FIX (this branch, commit 2e16066) — WHAT + WHY

**Bug (20-07-2026 Astir event):** M101 was plate-solved but `/live` showed no
name / "Deep-sky field." Investigation with PRODUCTION DATA proved:
- Relay payload was CANONICAL (`astrometryState:"solved"`, `raDegrees:210.877`,
  degrees). Not a relay/payload bug.
- Server matched M101 correctly BOTH passes (StackRun + MatchDecision rows show
  M101, one `medium` one `high`). Not a matcher/catalog/radius bug.
- **Real cause:** the CLIENT only showed a name when `confidence === 'high'`. The
  first M101 stack solved 0.16° off-center (67% of radius) → `medium` → name
  suppressed even though identity was certain.

**Why not just "show all medium":** `medium` has two causes. (A) off-center
isolated object = safe to name (M101). (B) genuinely contested field = a
runner-up is also in range = naming ANY single name risks a confidently-WRONG
name in front of paying guests. Asymmetric cost: a hidden name is mild; a wrong
name is a credibility hit. So we surface the FACT and decide by it.

**The fix (all committed on `fix/m101-naming-match`):**
1. `matchCoordinates` returns **`hasInRangeRunnerUp`** (runner-up scan runs
   unconditionally; predicate = "second object within ITS OWN radius").
2. **`lib/match-display.ts` → `shouldShowMatchName(confidence, hasInRangeRunnerUp)`**
   — the ONE shared policy: show on `high`, or `medium` with NO runner-up;
   withhold otherwise. Extracted into its own module so it's unit-testable.
3. **Both guest-facing surfaces gate on it:** the live card (`resolveDisplayObject`)
   AND the tappable history strip (`isDisplayableRun`). History needed the real
   fact because a tapped pill renders a full named card — a contested medium the
   card withholds is now DROPPED from the strip too (no pill → no tap → no
   possibly-wrong card). Traced end-to-end: `displayObjectForHistoryRun` is
   unreachable for a contested-medium run.
4. **Persisted on BOTH `StackRun` and `MatchDecision`** (nullable). Different
   lifetimes: MatchDecision = event-moment diagnostic/audit; StackRun = display
   identity state read later by the history strip. Debug endpoint
   (`/api/debug/match-decisions`) surfaces it + a `contested` count for
   season-end radius tuning.
5. **null/absent = "not contested" everywhere** (old server, old rows, no match)
   = prior behavior, safe.
6. Demo coverage: `?demo=medium-offcenter` (shows name) and
   `?demo=medium-ambiguous` (withholds); plus two `MOCK_HISTORY` entries.

**Tests (all green):** `scripts/test-match-display.mjs` (new, 10 assertions),
`scripts/test-catalog.mjs` (incl. the exact Astir solves), `test-live-status.mjs`,
`test-detect-transition.mjs`. `tsc --noEmit` clean, `next lint` clean.

**Separate note (NOT fixed, flagged):** T4 that night (RA 271.15/Dec −23.59) was a
genuine near-miss on M8 (0.17° outside its radius) — a real RADIUS-TUNING
candidate, unrelated to M101. Left alone on purpose.

Full diagnosis writeup: `docs/m101-naming-failure-2026-07-20.md`.

---

## 6. THE ENDING / FAREWELL SCREENS (already shipped, on main)

When an event finishes, `/live` shows a farewell scene. There are effectively
THREE ending paths:

- **UFO farewell** (`FarewellAegeanUfo`) — Aegean UFO scene with a tap-to-escalate
  easter egg (tap tiers → fleet + Greek-flag alien finale), venue/next-session
  footer, hotel logo.
- **Eclipse farewell** (`FarewellEclipse`) — total solar eclipse over the
  Asklepieion of Kos; tap the sun ~6× to totality, then egress + sign-off. Built
  as a self-contained `<iframe srcDoc>` (its inline CSS can't collide with the
  site). Same footer.
- These two are chosen **RANDOMLY PER GUEST/DEVICE, 50/50**
  (`resolveFarewellScene` in `app/live/farewell-scene-choice.ts`), stable per
  night via `sessionStorage` (keyed by event date). Two guests at the same event
  can get different endings. Terminal lock: once finished, the scene stays.
  Force for testing: `?demo=finished&scene=eclipse` or `...&scene=ufo` (the
  `?scene=` override ONLY works under `demo=finished`, never in production).
- **SpecialEventFarewell** — a separate, PLAIN sign-off for special events
  (`uiState: 'special-event-finished'`), deliberately NEVER the UFO or eclipse.

(These shipped earlier and are on `main`; the M101 branch does NOT touch them.)

---

## 7. DEPLOY THIS BRANCH — EXACT SAFE ORDER (do this after the event, calmly)

**Build wiring confirmed:** `package.json` build = `prisma generate && next build`
(generate only — does NOT run migrations). `vercel.json` has only a cron, no
build override. **So migrations are NOT auto-applied on deploy → you MUST apply
them manually, FIRST.**

**WHY migrate-first (not code-first):** the ingest route WRITES the new column
(`prisma.stackRun.create({ data: { ..., hasInRangeRunnerUp } })`). If the column
doesn't exist, Postgres throws `42703 undefined_column`, and because that write
is INSIDE the ingest transaction, it ABORTS the whole frame ingest → every solved
frame fails until the migration lands = live frame loss. Nullable/default does
NOT save you: the DB can't resolve the column NAME at all. Old code vs new
nullable columns is safe; new code vs old schema is NOT.

### Command sequence (run from repo root):

```bash
# 1. Apply the two pending migrations to Neon (while old code still live)
npx prisma migrate deploy

# 2. Confirm they applied
npx prisma migrate status
#    Expect: "Database schema is up to date!" and both migrations listed applied.

# 2b. (Optional belt-and-suspenders) confirm the columns exist — run this SQL
#     against Neon; expect TWO rows back:
#   SELECT table_name, column_name
#   FROM information_schema.columns
#   WHERE table_name IN ('StackRun','MatchDecision')
#     AND column_name = 'hasInRangeRunnerUp';

# 3. ONLY THEN deploy the code — merge to main (triggers Vercel prod deploy)
git checkout main
git merge fix/m101-naming-match     # fast-forward, 1 commit
git push origin main

# 4. After deploy goes green: smoke-test
#    - GET /api/status (should 200, unchanged shape + optional hasInRangeRunnerUp)
#    - watch the first solved ingest in Vercel logs; confirm no 42703, frame persists
```

**Do NOT** add `migrate deploy` to the build script — Vercel's build may use the
POOLED `DATABASE_URL`, and DDL over PgBouncer is unreliable; this repo keeps DDL
on the non-pooled `directUrl` (`POSTGRES_URL_NON_POOLING`) via manual
`migrate deploy` on purpose. Run migrate, confirm status, THEN merge — don't fire
both at once and hope the ~1–2 min build outlasts the migration.

### Rollback thought
The columns are additive + nullable, so even if you had to revert the code, the
columns can stay (harmless, unread by old code). No down-migration needed for a
revert.

---

## 8. ENV / INFRA QUICK REFERENCE

- **Neon Postgres:** `DATABASE_URL` (pooled, runtime), `POSTGRES_URL_NON_POOLING`
  (direct, DDL/migrations — this is Prisma's `directUrl`). Both in `.env`.
- **Upstash Redis:** viewer analytics + latest-frame cache (`live:latest:<source>`,
  48h TTL on some keys). Live image served from Redis; Postgres is the durable
  record.
- **Vercel Blob:** stores the frame images (`blobUrl`).
- **Prisma** 6.19.3. **Next** 14.2. **Node** 20.
- Test runners (no framework): `npx tsx scripts/test-*.mjs`
  (`test-catalog`, `test-match-display`, `test-live-status`,
  `test-detect-transition`, `test-viewer-stats`). `test-viewer-stats` needs a
  live Redis env and errors offline — that's expected, unrelated to app code.

---

## 9. STANDING PREFERENCES (for whoever/whatever continues this)

- **No AI attribution in commits** (no Co-Authored-By / AI trailers). Ever.
- **EU formats:** dates dd-mm-yyyy, time 24h HH:MM (never 12h/AM-PM).
- **Never commit without approval.** Every claim backed by real command output.
- Escape/sanitize any guest-facing value interpolated into raw HTML (srcDoc).
- Keep `tsc --noEmit` + `next lint` clean before any commit.
- Prefer targeted fixes; don't over-widen match radius (already correct for M101).

---

## 10. OPEN / DEFERRED ITEMS

- **Deploy the M101 fix** in the order in §7 (migrate → merge). Not done yet.
- **M8 radius tuning** (the T4 near-miss) — separate, not started.
- Branch protection currently allows admin direct pushes; revisit routing
  through PRs in the off-season.
- Old stray branches exist (e.g. `feat/transition-screen-polish`,
  `feat/tappable-history-pills`) — cleanup deferred.
- There is an unrelated stash on `main`: `stash@{0} "UFO tap-tier lowered to 7,
  uncommitted"` — untouched; decide later whether to apply or drop it.
```
