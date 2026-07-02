# Plan: Remove write-amplification from `/api/status`

Status: **proposal — not implemented.** This document describes a plan only. No
code in this repo has been changed to implement it.

## 1. Problem statement

`/api/status` ([app/api/status/route.ts](../app/api/status/route.ts)) is polled
by `/live` every 10 seconds once that page ships. Today the route performs
writes on **both** of its paths, which is the wrong shape for a hot polling
endpoint:

- **Live path** ([route.ts:97](../app/api/status/route.ts#L97)): `await
  redis.set(ACTIVE_SOURCE_KEY, chosen, { ex: ACTIVE_SOURCE_TTL_S })` — a Redis
  write on *every single poll* while live, even when `chosen` hasn't changed
  since the last poll.
- **Offline path** ([route.ts:126-133](../app/api/status/route.ts#L126-L133)):
  `prisma.session.updateMany(...)` — a Postgres write on *every single poll*
  while offline, even when there is nothing to close (the common case: no
  session is active most of the day).

At 10s polling, one open `/live` tab generates ~360 writes/hour to Redis or
Postgres that are pure overhead 99%+ of the time. With multiple concurrent
viewers this multiplies directly — N tabs = N× the redundant write traffic,
all racing to write the same value. Neither Upstash Redis nor Neon Postgres
bills purely on read/write count the same way, but this is still real load,
real latency added to the hot path, and real risk surface (every extra write
is one more thing that can throw, contend, or need `degraded: true` handling).

The goal: make `/api/status` a **pure-read** endpoint on both paths before
`/live` starts generating real polling volume.

## 2. Current code, precisely

### 2a. The offline-path write (`app/api/status/route.ts`, lines 116-133)

```ts
// 4. OFFLINE. All DB work degrades (never 500s) via the inner catch.
try {
  // a. Lazy session close: any still-"active" session with no endedAt is
  //    over (we're offline). We don't have the true last-frame time cheaply
  //    here, so `now` is acceptable. Idempotent. Racing with ingest
  //    reactivation is accepted — ingest reactivates any non-active session.
  //    The updatedAt guard prevents the close/reopen flap where we read
  //    Redis as stale, ingest lands a frame and reactivates the session, and
  //    this update then closes what ingest just reopened: sessions touched
  //    within the liveness window are skipped, only genuinely quiet ones close.
  await prisma.session.updateMany({
    where: {
      status: 'active',
      endedAt: null,
      updatedAt: { lt: new Date(Date.now() - LIVE_WINDOW_MS) },
    },
    data: { status: 'completed', endedAt: new Date() },
  })
```

This runs on **every** offline poll. `LIVE_WINDOW_MS` is `5 * 60 * 1000`
([route.ts:17](../app/api/status/route.ts#L17)), shared with the freshness
calculation on the live path.

### 2b. The live-path write (`app/api/status/route.ts`, lines 93-97)

```ts
// Persist the choice with a TTL. Concurrent polls racing this write is
// benign: every writer picks from the same Redis snapshot, so they write
// the same value (or an equally-valid one a beat later).
await redis.set(ACTIVE_SOURCE_KEY, chosen, { ex: ACTIVE_SOURCE_TTL_S })
```

This runs on **every** live poll, unconditionally — even when `chosen ===
activeSource` and nothing changed. `ACTIVE_SOURCE_TTL_S` is `600`
([route.ts:19](../app/api/status/route.ts#L19)).

### 2c. Related pieces that stay as-is

- `lib/redis.ts`: `ACTIVE_SOURCE_KEY`
  ([lib/redis.ts:32](../lib/redis.ts#L32)), `LatestFrame` type, and
  `parseLatestFrame` — no changes needed to these; the write-conditional logic
  (section 4) is new code added to `route.ts`, not a change to
  `lib/redis.ts`'s existing exports.
- `lib/schedule.ts`: `eventFor`, `nextEvent`, `athensToday` — pure functions,
  no I/O, already read-only. Not part of this plan's scope, cited here only
  because `route.ts`'s offline path calls them
  ([route.ts:12](../app/api/status/route.ts#L12)).
- `lib/db.ts`: the `prisma` singleton, including the `DATABASE_URL` /
  `POSTGRES_PRISMA_URL` fallback added in PR #11. Unaffected — the new cron
  route will import this same singleton.
- `app/api/ingest/route.ts`: the `authorized()` helper
  ([app/api/ingest/route.ts:41-47](../app/api/ingest/route.ts#L41-L47)) is the
  precedent this plan reuses for the cron's own auth (section 3d) — same
  constant-time comparison shape, different secret.

## 3. Vercel Cron: researched, current as of 2026-07

I fetched Vercel's own docs (`vercel.com/docs/cron-jobs` and
`vercel.com/docs/cron-jobs/manage-cron-jobs`, both showing `last_updated:
2026-06`) rather than relying on training memory, because cron config is
exactly the kind of platform surface that drifts. Citing what they say
directly below; flagging the one place I could not verify against this
project's actual settings.

### 3a. Configuration mechanism: `vercel.json`, not the dashboard

Cron jobs are declared in a `crons` array in `vercel.json` (or via the Build
Output API, not relevant here) and take effect on the **next production
deployment**. The dashboard (**Settings → Cron Jobs**) is *view/manage only* —
you can see invocation history, view logs, and click **Disable**, but you
cannot create or edit the schedule from the dashboard. To change a schedule
you edit `vercel.json` and redeploy.

**This project does not currently have a `vercel.json`.** Git history shows
one existed and was deliberately removed:
[`505105d Remove vercel.json (cleanUrls breaks Next.js routing)`](../../..).
Reintroducing `vercel.json` for `crons` must not resurrect whatever
`cleanUrls`-related config caused that breakage — the new file should contain
**only** a `crons` key (plus optionally `$schema`), nothing else, unless a
future need is deliberately added with its own testing.

Minimal shape:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/close-sessions",
      "schedule": "<cron expression — see 3b>"
    }
  ]
}
```

### 3b. Cron expression syntax and restrictions

Standard 5-field cron (`minute hour day-of-month month day-of-week`), with
Vercel-specific restrictions:

- No named values (`MON`, `JAN`, etc.) — numeric only. Day-of-week is `0-6`,
  Sun–Sat.
- Cannot set both day-of-month and day-of-week to a non-`*` value
  simultaneously.
- **All schedules run in UTC.** There is no per-project timezone setting.
  This matters here because the rest of the app is Athens-local
  (`athensToday()`, `eventFor()`) — the cron's *schedule* is UTC, but the
  *work it does* (closing sessions) is timezone-agnostic (it's just "has this
  row been quiet for N minutes", not a calendar-date comparison), so this is
  a non-issue for the close-sessions job specifically. Flagging it so it
  isn't a surprise if a future cron *does* need Athens-local timing (it would
  need to compute the UTC-equivalent expression, accounting for Greece's DST
  offset — EEST is UTC+3 in summer, EET is UTC+2 in winter).

### 3c. ⚠️ Plan/tier limit — this changes the schedule you asked for

Per `vercel.com/docs/cron-jobs/usage-and-pricing`:

| Plan | Cron jobs/project | Minimum interval | Scheduling precision |
|---|---|---|---|
| **Hobby** | 100 | **Once per day** | Per-hour (±59 min) |
| Pro | 100 | Once per minute | Per-minute |
| Enterprise | 100 | Once per minute | Per-minute |

The Vercel dashboard screenshot from this session's earlier work shows this
project under **"Michail Reisis' … Hobby"** — i.e. the **Hobby plan**. On
Hobby, **a `*/1 * * * *` (every-minute) expression will fail at deploy time**
with an explicit error ("Hobby accounts are limited to daily cron jobs...").
Additionally, even a once-daily Hobby cron has ±59 minute imprecision — Vercel
may fire it any time within the specified hour.

**This directly contradicts the "every minute" requirement from the task
brief.** I'm not silently downgrading the requirement to fit what I found;
this is decision point 1 in section 5 — you need to choose how to resolve it
before implementation. I did not guess which the project is willing to do.

### 3d. Authentication: `CRON_SECRET`, Bearer header, Vercel-managed

Documented pattern — add an env var named exactly `CRON_SECRET` (Vercel's own
convention) to the Vercel project. Vercel **automatically** sends it as
`Authorization: Bearer <CRON_SECRET value>` on every request it makes to a
cron path. The target route compares the incoming header against
`process.env.CRON_SECRET`.

This is structurally identical to the existing `INGEST_SECRET` pattern in
`app/api/ingest/route.ts`
([app/api/ingest/route.ts:41-47](../app/api/ingest/route.ts#L41-L47)):
`createHash('sha256').update(...).digest()` both sides, then
`timingSafeEqual`. Vercel's own docs example uses a plain `!==` string
compare, not constant-time — I'd deviate from Vercel's sample and reuse this
project's existing constant-time helper for consistency with `authorized()`
in the ingest route and because it's already proven code in this repo. See
section 4d for the exact proposed shape.

One nuance worth naming: **Vercel sends `CRON_SECRET` as the *literal* env var
value** — there's no signing/HMAC, it's a shared-secret Bearer token exactly
like `INGEST_SECRET` already works. So the auth code can be near-identical to
`authorized()`, just reading `CRON_SECRET` instead of `INGEST_SECRET`.

### 3e. Idempotency and concurrency — Vercel's own guidance applies directly

Vercel's docs explicitly warn: cron delivery is best-effort, can occasionally
double-invoke, and jobs should be idempotent and reconciliation-based rather
than incremental ("bad: increment a counter twice"; "good: set status to
active if not already active").

The existing close-sessions query is already exactly this shape — `updateMany`
with a `where: { status: 'active', endedAt: null, updatedAt: { lt: ... } }`
guard is naturally idempotent (running it twice in a row is a no-op the second
time, since the matched rows no longer satisfy `status: 'active'`). No new
locking mechanism is needed for this specific job. Flagging this only because
Vercel's docs raise it as a general concern — for this particular query it's
already handled by construction.

## 4. Proposed changes, described in prose (no code written)

Four files touched. Concrete enough to review and approve; this section does
**not** modify any files — it is the spec for a follow-up implementation PR.

### 4a. `app/api/status/route.ts` — remove the write, keep everything else

Delete the entire block at
[route.ts:118-133](../app/api/status/route.ts#L118-L133) (the `// a. Lazy
session close` comment through the closing `})` of the `updateMany` call).
The offline path becomes: read `eventFor(today)`, read `session` via
`findUnique`, build `tonight`/`next`, return. No `prisma` write survives on
this path. The `try { ... } catch (e) { ... degraded: true }` wrapper around
the (now read-only) DB calls stays — a read can still throw (connection
issue, etc.) and should still degrade rather than 500, per the existing
"endpoint always answers" contract in the function's outer catch
([route.ts:171-176](../app/api/status/route.ts#L171-L176)).

The live-path write (section 4c) also changes in this same file, at
[route.ts:93-97](../app/api/status/route.ts#L93-L97).

No change to: the Redis reads (lines 48-58), the freshness calc (60-76), the
hysteresis selection logic (79-92), the response shapes, `runtime = 'nodejs'`,
or the `Cache-Control: no-store` header. This plan is scoped to the two writes
only.

### 4b. New route: `app/api/cron/close-sessions/route.ts`

New file, sibling to the existing `app/api/status/` and `app/api/ingest/`
route folders (matches this project's existing convention of one folder per
endpoint under `app/api/`).

- `export async function GET(req: NextRequest)` — Vercel cron invocations are
  always `GET` (per section 3a: "Vercel makes an HTTP GET request").
- `export const runtime = 'nodejs'` — needed for Prisma, same as
  `app/api/status/route.ts` and `app/api/ingest/route.ts` already declare.
- Auth first, fail closed: read `CRON_SECRET` from env; if unset,
  `console.error` and `500` (mirrors `INGEST_SECRET`'s "fail closed and loud"
  behavior at
  [app/api/ingest/route.ts:51-56](../app/api/ingest/route.ts#L51-L56)); if set
  but the request's `Authorization` header doesn't match, `401`.
- Body: exactly the `prisma.session.updateMany(...)` call being removed from
  `route.ts` in 4a — same `where` shape (`status: 'active', endedAt: null,
  updatedAt: { lt: new Date(Date.now() - <window>) }`), same `data: { status:
  'completed', endedAt: new Date() }`. The window constant either gets
  imported from `app/api/status/route.ts` (would need exporting) or
  duplicated as a local constant with a comment cross-referencing
  `LIVE_WINDOW_MS` in `route.ts` — see open question 4 in section 5 for which.
- Response: a small JSON body reporting what happened is useful here
  precisely *because* this route is no longer on the hot polling path — e.g.
  `{ closed: <count> }` using the `count` Prisma's `updateMany` already
  returns. Unlike `/api/status`, there's no "must always 200" contract for a
  cron target; a genuine failure *should* surface as a non-200 so Vercel's
  cron-job logs show it failed (per section 3e's note that Vercel does not
  retry — but does log — failed cron invocations).
- Should the query logic itself live in a `lib/` function instead of inline
  in the route? See open question 3 in section 5 — I'm not deciding this
  silently because it affects whether a future third caller (e.g. a manual
  admin "force-close" action) has a natural reuse point or not.

### 4c. `app/api/status/route.ts` — make the live-path Redis write conditional

At [route.ts:93-97](../app/api/status/route.ts#L93-L97), wrap the existing
`redis.set(ACTIVE_SOURCE_KEY, chosen, ...)` call in a condition: only execute
it when `chosen !== activeSource`. When the hysteresis logic (lines 79-92)
picks the same source that was already stored, skip the write entirely.

This is a straightforward change *in the common case* — most polls while live
will find `chosen === activeSource` and do nothing. One thing worth being
explicit about because it changes the key's behavior slightly: today's code
writes on every poll, which has the side effect of continuously refreshing
`ACTIVE_SOURCE_TTL_S` (600s / 10min) as a byproduct. If the write becomes
conditional on `chosen !== activeSource`, **the TTL stops being refreshed
while the same source stays live**, and `ACTIVE_SOURCE_KEY` will expire after
10 minutes even mid-broadcast. Given `/live` polls every 10s, the *first* poll
after expiry would simply find `activeSource === null` and re-pick + rewrite
(the existing "stale/absent → pick freshest" branch at
[route.ts:89-91](../app/api/status/route.ts#L89-L91) already handles this
correctly) — so it self-heals within one poll cycle and produces at most one
extra write per 10 minutes instead of one per 10 seconds. That's still a ~60×
reduction in write volume and is very likely fine, but it is a *behavior
change* worth your explicit sign-off (open question 2, section 5) rather than
something to wave through silently, since "the key always has a live TTL
while the source is live" was true before and won't be true after.

### 4d. `lib/redis.ts` — no changes needed

I initially expected this file might need a helper (e.g. `writeActiveSource`)
to hold the "only write if changed" logic, but on inspection the condition is
a single `if` around one call site inside `route.ts` — adding an abstraction
in `lib/redis.ts` for a one-call-site check would be exactly the kind of
premature abstraction this codebase's existing style avoids (see how
`latestFrameKey`, `parseLatestFrame` etc. are all *used* from `route.ts` but
the *decision logic* about when to call them lives in the route). Recommend
keeping the conditional inline in `route.ts` unless a second call site
appears later.

### 4e. `vercel.json` — new file (see section 3a for why it doesn't exist today)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/close-sessions",
      "schedule": "<depends on open question 1 — see section 5>"
    }
  ]
}
```

Only the `crons` key. Explicitly not reintroducing `cleanUrls` or any other
option from whatever the pre-`505105d` `vercel.json` contained — I did not
inspect that removed file's full contents as part of this plan (it's outside
scope; flagging that if you want me to check what else was in it, that's a
5-second `git show 505105d^:vercel.json`, but I did not do it unprompted since
this plan is supposed to be read-only research, not a broader audit).

### 4f. `package.json` — no changes expected

No new dependency is needed. The cron route uses the existing `prisma`
singleton from `lib/db.ts` and Next's built-in `NextRequest`/`NextResponse`,
exactly like the other two routes. I don't foresee a `scripts` entry being
needed either — Vercel Cron doesn't invoke anything via `npm run`, it makes an
HTTP request to the deployed route directly. Flagging as "no changes" rather
than omitting it, since the brief asked me to address this file explicitly.

### 4g. `.env.example` — should get `CRON_SECRET` added

Not explicitly requested in the task list, but follows directly from section
3d and this repo's existing convention
([.env.example](../.env.example) already lists `INGEST_SECRET` under "App
secrets"). Listing this here as a natural companion change rather than
silently expanding scope — confirm in review whether you want it bundled into
the same implementation PR or done separately.

## 5. Open questions — decisions needed before implementation

1. **The Hobby-plan interval conflict (section 3c) is the big one.** "Every
   minute" as specified in the brief is not deployable on the Hobby plan.
   Options, roughly in order of how much they preserve the original intent:
   - **(a) Upgrade to Pro.** Unlocks per-minute crons, matches the brief
     exactly. Has a real monthly cost — I don't have current Pro pricing
     verified for this plan (deliberately not guessing a number; happy to
     fetch it if useful) and don't know your budget appetite for this
     project.
   - **(b) Accept once-daily on Hobby.** A session that goes quiet mid-evening
     would stay `status: 'active'` in the DB for up to ~24h before the cron
     closes it. Given `/api/status`'s live/offline determination is entirely
     Redis-freshness-based (not DB-status-based — see
     [route.ts:79](../app/api/status/route.ts#L79), `if (freshSources.length >
     0)`), a stale-but-uncosed `Session.status` **does not affect what
     `/live` shows**. It only affects: (i) how long a genuinely-ended
     session's row says `"active"` in the DB before catching up, and (ii)
     whether `tonight.cancelled` logic at
     [route.ts:145](../app/api/status/route.ts#L145) reads a stale `status`
     — worth checking against real data patterns before assuming it's
     harmless.
   - **(c) Hybrid: once-daily cron catches the general case, keep a narrower
     always-on-Hobby-legal safety net.** E.g. run the cron once daily at a
     fixed UTC time safely after the latest possible Athens event end
     (Section 3b's DST note applies here), and additionally trigger the same
     close-sessions logic in one extra place with essentially zero added
     write cost — e.g. from within `/api/ingest`'s existing transaction when
     it detects a *different* hotel's session should be closed because a new
     one is starting. This needs real design if chosen; not detailed further
     here since it's speculative until you weigh in.
   - I am not picking one of these. This is the one decision that changes
     the shape of section 4b/4e, so it should be resolved first.

2. **Confirm the TTL-decay behavior change in section 4c is acceptable** —
   `ACTIVE_SOURCE_KEY` will now expire after 10 idle-of-change minutes instead
   of being continuously refreshed, self-healing within one 10s poll cycle.
   I believe this is harmless given the self-heal path already exists and is
   already exercised code (the "stale/absent" branch), but it's a real
   behavior change from today, not a pure no-op refactor.

3. **Where should the close-sessions query logic live** — inlined directly in
   `app/api/cron/close-sessions/route.ts` (matches how `/api/status` and
   `/api/ingest` currently keep their logic inline rather than in `lib/`), or
   extracted to a `lib/` function (e.g. `lib/sessions.ts`) that the route
   calls? Extraction only pays for itself if there's a second caller on the
   horizon (option 5c above would create one). Recommend inline-for-now,
   revisit if 5c is chosen — but this is your call given the specific option
   chosen in question 1.

4. **`LIVE_WINDOW_MS`\-equivalent constant** — should the cron route import it
   from `app/api/status/route.ts` (requires adding `export` to that constant)
   or declare its own local copy with a comment pointing at the other file?
   Importing keeps them mechanically in sync; a local copy keeps the cron
   route fully decoupled from the status route's internals. Given both files
   would live under `app/api/`, either is normal Next.js practice — no strong
   default from precedent elsewhere in this codebase since this would be the
   first cross-route import.

5. **Bundle `.env.example`'s `CRON_SECRET` entry into the same PR, or a
   separate tiny one?** (Section 4g.) Low-stakes, just confirm.

6. **Should the cron response body do anything beyond `{closed: n}`** — e.g.
   should it also report which session IDs were closed, for auditability via
   Vercel's cron logs? Not costly either way; only asking because "IDs
   closed" is genuinely useful for debugging a "why did session X show as
   completed at time Y" question later, and this is the cheapest possible
   time to add it (mid-plan) vs. after the route ships.

## 6. Test plan

### 6a. Verifying the cron works

Prerequisite: `CRON_SECRET` set in the target Vercel environment(s), and the
question-1 schedule decision reflected in `vercel.json`.

1. **Deploy** with the new route + `vercel.json`. Confirm in **Vercel
   dashboard → Settings → Cron Jobs** that the job is listed with the
   expected path and schedule (per section 3a, this view is read-only but is
   the source of truth for "did Vercel register it").
2. **Manual invocation, unauthenticated** — `curl
   https://<prod-domain>/api/cron/close-sessions` with no `Authorization`
   header. Expect `401`. Confirms the route isn't a silent open door if
   someone finds the path.
3. **Manual invocation, authenticated** — same request with `Authorization:
   Bearer <CRON_SECRET value>` (pulled from the Vercel dashboard, not
   committed anywhere — same handling discipline as `INGEST_SECRET` in
   existing test tooling). Expect `200` and a body reflecting however many
   rows matched (likely `{closed: 0}` in steady state).
4. **End-to-end with a real stale session** — using
   `scripts/cleanup-test-data.mjs`'s existing pattern for exercising
   `/api/ingest` (see `scripts/fake-relay.mjs`), send one frame to create a
   `Session` row with `status: 'active'`, wait past the close-eligibility
   window (`updatedAt` older than whatever constant is chosen per question
   4), then invoke the cron route per step 3 and confirm the row now reads
   `status: 'completed', endedAt: <non-null>` via a direct Prisma query or
   Postgres check. Clean up afterward with `scripts/cleanup-test-data.mjs`
   (already handles `Session`/`Observation`/`Frame`/blob/Redis cleanup for a
   given date+source).
5. **Log verification** — hit **View Logs** from the Cron Jobs settings page
   after a real scheduled invocation (not just a manual `curl`) to confirm
   Vercel is actually triggering it on schedule, not just that the route
   works when called by hand. Given section 3c's ±59min Hobby imprecision (if
   question 1 lands on Hobby), this check needs a wide enough observation
   window — don't conclude "it's broken" from one missed hour.

### 6b. Verifying `/api/status` is now write-free

1. **Static check**: `grep -n "updateMany\|redis.set" app/api/status/route.ts`
   after the change — should return zero matches (the only writes in the file
   are gone).
2. **Offline-path check**: reproduce this session's earlier verification
   steps (dev server + `curl localhost:3350/api/status` while genuinely
   offline) and confirm the response shape is byte-identical to before
   (`{live:false, tonight, next}`) — the *output contract* must not change,
   only the fact that producing it no longer writes.
3. **Live-path check, no-change case**: start dev, send one frame via
   `fake-relay.mjs`, curl `/api/status` twice in quick succession (within the
   45s hysteresis window, same source). Before the fix, both requests write
   to `ACTIVE_SOURCE_KEY`; after the fix, only the first should (verify via
   Upstash's dashboard request log, or by instrumenting a temporary
   `console.log` right before the conditional `redis.set` during manual
   testing — remove before merging).
4. **Live-path check, actual-change case**: force a source switch (send
   frames from `pegasus` then `seestar` with enough of a gap to cross the
   1-45s hysteresis threshold) and confirm the write *does* still fire when
   `chosen` genuinely changes — this is the regression case that would prove
   the conditional is wired backward if it silently passed by never writing
   at all.
5. **Regression pass**: rerun this project's standard verification battery
   from the `/api/status` PR (#10) — `npx tsc --noEmit`, `npm run lint`, and
   the full offline → live → +30s curl cycle — to confirm nothing in the
   surrounding logic (hysteresis, freshness, degrade-on-error) was disturbed
   by removing the two write call sites.
