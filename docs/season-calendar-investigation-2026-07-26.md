# Season Calendar — Investigation Report

**Date:** 26-07-2026
**Branch:** `feat/season-calendar` (fresh off merged `main` @ `f3a881c` — interaction data + `?date=` read live)
**Status:** Investigation only — no build yet. Hold for review.

Answers to your four questions, grounded in the schema AND in read-only queries against the
real production archive (run 26-07-2026), plus the honest handling of each data caveat.

---

## The real data, as of today

| Table | Coverage |
|---|---|
| `Session` | **10 nights**, 09-07 → 24-07, all `completed`, 4 hotels (paralos-kyma-dunes ×3, caravia-beach ×3, oku-kos ×2, astir-odysseus ×2). **All 10 have StackRuns.** |
| `ViewerStatsNightly` | **6 rows**, 16-07 → 24-07. 4 × `finish`, 2 × `backfill`. All hotel scope — **no special-event row exists yet.** |
| `StackRun` | 40 runs (first 08-07). **26 with a resolved objectId, 14 unresolved** (mid-slew runs that never got astrometry). **10 with `endedAt: null`** — exactly the final run of each night. |
| `EventInteractionStats` | **0 rows** — tracking deployed today; every historical night is genuinely "—". |

Two immediate consequences: **4 of your 10 known nights (09-07 → 15-07) have no viewer row** —
the "no stats" case is real, not hypothetical; and **every night so far predates interaction
tracking** — the "—" rendering is what the whole page shows in that column until tonight.

---

## Q1 — Objects shown per night: what's actually queryable

**Source of truth is `StackRun`, not `Observation`.** The schema itself documents that
`Observation` never splits per target in production (the relay sends no target name, so every
session has one "Unknown" observation per source). `StackRun` is the real per-target record —
the same rows that feed the guest history strip — with everything the calendar needs:
`startedAt`, `endedAt`, `objectId`, `objectName`, `objectType`, `confidence`,
`hasInRangeRunnerUp`, `source`, indexed by `[sessionId, source, startedAt]`.

**Order:** trivially derivable — `startedAt` ascending. Both devices can run in parallel, so
the honest render is one chronological list with a small source marker (pegasus/seestar)
rather than pretending one linear narrative.

**Duration per object: yes, cheaply — with ONE documented correction.**
- Normal runs: `endedAt − startedAt` (the next run's start closed it). Free.
- **The final run of each night has `endedAt: null`** (10/40 rows — one per session, never
  closed because nothing follows it). The naive fallback — `Session.endedAt` — is WRONG for
  durations: I verified `lib/sessions.ts:35` stamps it at the **cron's run time (~01:00)**,
  which would inflate every night's last object by hours. The honest fallback:
  `StackRun.latestFrameId → Frame.ingestedAt` — the real moment the last frame of that run
  arrived. One extra indexed lookup for ≤1 row per night. That's what I'll use, marked with a
  `~` (approx) in the UI since it's frame-derived.
- **14/40 runs are unresolved** (null objectId — slews that never solved). They're real
  telescope time, so hiding them silently would make nights look shorter than they were. Plan:
  fold consecutive unresolved runs into a single muted "settling / unidentified" line with
  summed duration — the identified objects stay the story, the time still adds up.

**Cost:** one `findMany` on Sessions + one on StackRuns (`sessionId IN (...)`, index-backed) +
≤1 Frame lookup per night. Whole current archive ≈ 50 rows.

## Q2 — ViewerStatsNightly: rollups and how far back

**Yes for the rollups, with a defined night-list strategy.** Each row has `unique`,
`maxConcurrent`, `hotelId`, `date`, `source` (finish/backfill), `eventKey` — everything the
per-hotel rollup needs (events count, avg unique, avg peak) and the season summary (total,
average, best night).

**How far back: 16-07.** Sessions go back to 09-07. So the master night-list must NOT be
`ViewerStatsNightly` (it would silently drop your first week). Plan — **union, Session-led**:
- Master list = `Session` rows (every known real night, cancelled ones included with their
  `cancellationReason`).
- LEFT-join viewer stats by eventKey (`date:hotelId`). Missing → the night renders with a
  **"no viewer stats"** mark (your explicit-over-omission option — I'm taking *show and mark*,
  because a renewal conversation needs "we ran 3 nights at your hotel" even when two predate
  the snapshot system).
- Any `ViewerStatsNightly` row *without* a Session (future special events — scope `event`,
  no Session row is created for them today) gets appended as its own entry, typed
  "special event". None exist yet, but the union handles them the day one does.
- `snapshotSource` badge: `finish` vs `backfill`, straight off the row.

**Per-hotel rollup caveat, stated on the page:** averages are computed only over nights that
HAVE stats (n shown next to the average, e.g. "avg 41 viewers (4 of 6 nights measured)") —
never averaging in fake zeros for pre-snapshot nights.

## Q3 — Layout: table with expandable rows, NOT a calendar grid

You said "calendar", you asked for scan-a-season + filter-by-hotel. A month grid is the wrong
tool for this data: **2–3 events/week means a grid is ~70% empty cells**, it caps information
per cell at almost nothing, it makes cross-month scanning (a season = 4–5 months) a paging
exercise, and it can't rank hotels. What serves the two real jobs:

- **Top: season summary strip** — total events, total unique viewers, avg/night, best night —
  then the **per-hotel rollup table** (events, avg unique, avg peak — the renewal number),
  clickable to filter.
- **Below: one table, one row per night, newest first.** Columns: date · venue · type ·
  unique · peak · objects-count · interactions-present indicator · source badge. **Row expands**
  to the night's detail: the object timeline (in order, durations, confidence-muted names for
  contested/low matches — operator sees truth with a badge, not the guest-side gating) and the
  full interaction counters ("—" where absent).
- **Filters:** hotel select, event-type select, from/to date inputs. Server-side (they double
  as the query bounds — see Q4).
- Desktop-first table; on phone the rows collapse to stacked cards via CSS (same content, no
  horizontal scroll).

This is a *list that knows it's a season*, which is what scanning and renewal math actually
want. If you still want a visual month-grid later, it can be added as a secondary view on the
same endpoint — but I wouldn't build it first.

## Q4 — Performance querying a whole season

**No concern at any realistic scale, by construction.** Today: 10 nights / 40 runs / 6 stat
rows — trivial. A full season (~150 nights, ~1.5–2k runs, ~7k interaction rows worst case) is
still 3–4 indexed queries returning a few thousand small rows — tens of milliseconds on Neon,
a ~100–200 KB JSON payload, entirely fine for an operator page. What I'll do anyway:
- The **date-range filter params double as server-side query bounds** from day one — so "query
  the whole season at once" is the default but never the only mode, and the endpoint never
  grows an unbounded query as seasons accumulate.
- `Cache-Control: private, no-store` (operator data, always fresh); no pagination — a season
  fits, and pagination would fight the scan-the-season purpose.

## Data caveats — handled honestly (your list, my calls)

1. **Pre-snapshot nights (09-07 → 15-07):** shown, marked "no viewer stats" — not omitted
   (rationale in Q2). Averages exclude them, with the n disclosed.
2. **Midnight stragglers:** the night list is Session-led and joins viewer stats by the REAL
   eventKey (`date:hotelId`) — a stray `date:hotel` fallback bucket can never appear as a
   night row by construction. For interaction counters I query rows by the night's exact
   eventKey (not the whole date), so straggler counts don't leak into a real night's numbers
   either. They simply never render. (The `?date=` endpoint keeps exposing them for debugging;
   the calendar just doesn't consume that path.)
3. **Consent discontinuity:** viewer counts through **25-07** counted every tab; from
   **26-07** (consent deploy, `aa53157`) they count consenting guests only. Rendered as a
   labeled divider row in the night table at that boundary ("measurement change: consent
   gating deployed — counts before/after not comparable") + a footnote on the summary strip,
   and the per-hotel rollups get a `†` when they mix pre/post-consent nights. You can never
   misread the step as an audience drop.
4. **"A viewer is a browser tab, not a person"** — stated verbatim in the summary strip's
   footnote, next to the consent note.

## Auth + placement (the pattern you asked for)

Reuse `lib/debug-auth` **wholesale** — same `DEBUG_VIEW_TOKEN`, same signed `sg_debug` cookie
(12h, HttpOnly, SameSite=Strict), so one phone bookmark authenticates both operator views:
- `/season` — server component, gates exactly like `/live-debug/page.tsx` (verify cookie
  server-side, render a locked notice otherwise). `robots: noindex`, never linked from guest
  pages.
- `/season/auth?token=…` — bootstrap route, byte-for-byte the `/live-debug/auth` shape
  (302-redirect, no token in destination, no-referrer). Your existing `/live-debug/auth`
  bookmark ALSO unlocks `/season` (same cookie) — the new bootstrap just lets a `/season`
  bookmark work directly.
- `GET /api/season-stats` — the one read endpoint, guarded by the same cookie (page fetch)
  OR a `DEBUG_VIEW_TOKEN` bearer (curl). Read-only: `Session` + `StackRun` + `Frame`
  (final-run end only) + `ViewerStatsNightly` + `EventInteractionStats`. **Zero writes, zero
  Redis, zero contact with ingest//live/status paths.**

## Build order (on approval)

1. `lib/season-data.ts` — pure assembly: union + join + rollups + consent-boundary + duration
   math (unit-testable with fixture rows, no I/O).
2. `GET /api/season-stats` (authed, filters as query params).
3. `/season` page + `/season/auth` bootstrap (debug-auth reuse).
4. Desktop-first CSS, phone-degradation pass.
5. Tests: pure assembly suite (fixtures for: pre-snapshot night, backfill badge, unresolved-run
   folding, final-run duration fallback, consent divider, straggler exclusion) + route-shape
   test mirroring `test-status-debug-route.mjs`.
6. tsc + lint + real build; hold for review.

**Nothing built yet. Awaiting your review — especially the Q3 layout call (table over grid).**

---

# Addendum — Built (26-07-2026)

Approved (table over grid + all caveat calls + three riders) and built on this branch. Held
for review — not pushed, not deployed.

**Files:** `lib/season-data.ts` (pure assembly — union, timeline folding, duration truth,
consent split, rollups) · `scripts/test-season-data.mjs` (**42 fixture assertions**, one per
documented rule) · `app/season/page.tsx` (server component) · `app/season/auth/route.ts`
(debug-auth bootstrap) · `app/season/SeasonUnauthorized.tsx` · `app/season/season.css` ·
`public/cookie-consent.js` (one addition, below).

**Riders honored:** ① best night split **pre-consent / consent-gated** in the summary strip
(the consent-gated slot honestly shows "—" until a post-consent night exists — verified
against the live archive); ② per-hotel rollup **defaults to avg-unique desc** (the renewal
ranking) with `?sort=` header links for events/peak — unmeasured venues sink below real
numbers rather than sorting as zero; ③ the operator-testing caveat is the closing line of the
page footnote ("treat pre-16-07-adjacent counts as upper bounds in renewal conversations").

**One deviation from the plan, deliberate:** no `/api/season-stats` endpoint. The page is a
server component querying Prisma directly (filters are URL params, expansion is native
`<details>` — the whole page ships **182 B of client JS**). A separate endpoint would have
been dead code the page never called; if a JSON consumer ever appears, the assembly lib is
already pure and an endpoint over it is a 30-line add.

**One defect found by actually running it:** the guest cookie-consent banner rendered over
the operator tables (both viewports). Fixed in `public/cookie-consent.js` — `/season*` gets a
full early-return (no banner, no floating button, no GA: operator archive reading is not
guest analytics). Verified suppressed on `/season` AND still appearing on the homepage.

**Verified:** 42/42 fixtures · all 15 suites · tsc + lint clean · real build green
(`/season` ƒ-dynamic, 182 B) · **rendered against the real production archive** (read-only)
at 1280 px and 390 px: summary strip 10 events / 148 unique / avg 25 "(6 of 10 measured)",
renewal table ranked OKU Kos 36 → Paralos 18 with measured-counts disclosed, timeline with
`~` approx durations and confidence annotations, backfill badges, 4 "no viewer stats" nights,
zero JS errors.
