# M101 naming failure — Astir event, 20-07-2026

**Status:** ROOT CAUSE FOUND (data-proven). Branch: `fix/m101-naming-match`.

> **This supersedes the earlier payload-shape hypothesis in this file.** Pulling
> the real `Frame.metadata` and the stored match records from Neon **disproved**
> the relay/payload theory: the relay sent the canonical shape, the server
> matched M101 correctly and stored it. The real bug is a **client-side display
> confidence gate**. See below.

## Symptom

M101 was plate-solved by the SmartEye. `/live` did **not** show "M101"; it
showed the generic "Deep-sky field" fallback (no name).

## TL;DR root cause

The `/live` client (`app/live/LiveView.tsx` → `resolveDisplayObject`, L394)
only shows an object's name when the match confidence is **exactly `'high'`**.
Any `'medium'` match is demoted to the no-name "Deep-sky field" fallback.

**The first M101 stack that night solved slightly off-center — a `medium`
match — so the client hid the name.** Nothing upstream was wrong: the relay
payload was canonical, the server matched M101, and it's stored in the DB with
the right name. The name was suppressed only at the last step, in the browser.

## The data (all pulled from production Neon, Astir session `cmrtldku7...`)

### 1. The relay payload was canonical (payload-shape theory DISPROVEN)

Raw `Frame.metadata` for the M101 frame you named (`frameId cmrtn9br7...`, RA
210.877, ~22:55 Athens):

```json
{
  "state": "IMAGE_STACK_RUNNING",
  "raDegrees": 210.8770904541016,
  "decDegrees": 54.39611053466797,
  "astrometryState": "solved",
  "totalAccumulatedTime": 45,
  ...
}
```

- `astrometryState` is literally `"solved"`. ✅
- Coords are under the exact keys `raDegrees` / `decDegrees`, as numbers, in
  degrees (≈210, not hours). ✅
- Every frame in the session has this same canonical shape. There is **no**
  key-name drift, no snake_case, no hours/degrees problem, no nesting.

### 2. The server matched M101 correctly, BOTH passes (matcher theory DISPROVEN)

`StackRun` rows for the session:

| startedAt (UTC) | objectId | name           | confidence |
| --------------- | -------- | -------------- | ---------- |
| 19:02:35        | M51      | Whirlpool      | high       |
| **19:13:18**    | **M101** | Pinwheel Galaxy | **medium** |
| 19:21:12        | M27      | Dumbbell       | high       |
| 19:31:39        | (null)   | (null)         | (null)     |
| **19:54:38**    | **M101** | Pinwheel Galaxy | **high**   |

`MatchDecision` rows agree: 19:13 → `matched M101 medium`; 19:54 → `matched M101
high`. The server named M101 correctly both times and persisted it.

### 3. Why one pass was `medium` and one was `high`

Same object, two different solves that night:

| Pass  | Solve RA / Dec        | Separation from M101 center | Fraction of 0.24° radius | Confidence |
| ----- | --------------------- | --------------------------- | ------------------------ | ---------- |
| 19:13 | 210.623 / 54.472      | 0.161°                      | 0.67                     | **medium** |
| 19:54 | 210.877 / 54.396      | 0.064°                      | 0.27                     | **high**   |

Both are unambiguously M101 (both land well inside the radius — the matcher gets
it right). The 19:13 solve was just more off-center (the classic off-center /
pre-centering GoTo solve described in `docs/OPERATIONS.md` §1), which scored
`medium`. `medium` is a **correct, safe** match here — it's still M101 — but the
client throws the name away.

## The actual bug (one line)

`app/live/LiveView.tsx`, `resolveDisplayObject` (~L394):

```ts
if (astrometryState === 'solved' && body.objectMatch?.confidence === 'high') {
  return { kind: 'known', name: body.objectMatch.name, ... }  // shows name
}
// ...falls through to:
return { kind: 'fallback' }  // "Deep-sky field", NO name
```

A `'medium'` (or `'low'`) match — even a correct one — never reaches the
`'known'` branch, so the guest sees "Deep-sky field" instead of "M101".

Note: this is **display-only**. The StackRun/MatchDecision/history-pill path
stores and can show `medium` matches fine (the history strip already renders the
name), which is why the DB has the right answer even though the live card didn't.

## Fix options

### Option 1 — Show `medium` matches on the live card (RECOMMENDED)
Change the display gate in `resolveDisplayObject` to accept `high` **and**
`medium` (i.e. "a confident-enough named match"), keeping `low`/`none` in the
`fallback` path. This is a **one-condition change in one client function**, no
matcher/catalog/radius change, and it's the minimal fix that makes M101 (and any
future slightly-off-center solve) show its name.
- **Why it's safe:** `medium` already means "matched a catalog object, inside
  its radius, but either off-center for a small object OR without a clearly
  dominant runner-up." For an isolated bright Messier like M101 there's no
  competing object — it's simply off-center. The matcher's runner-up guardrail
  already downgrades genuinely ambiguous crowded-field cases to `medium`, so the
  real risk case is "two plausible objects," which is rare for our target list.
- **Optional hardening if you want to be conservative:** show the `medium` name
  but with a subtle "likely"/approximate treatment, OR only promote `medium` to
  a shown name when there is no in-range runner-up (would need the server to
  surface that). Not required for the core fix.

### Option 2 — Loosen the confidence *scoring* so off-center solves score `high`
Adjust the `high`-confidence cutoff in `lib/catalog.ts`
(`highConfidenceCutoffFraction`) so a 0.16° / 67%-of-radius solve counts as
`high`. **Not recommended:** this changes scoring globally for every object and
every consumer (history pills, debug tuning, MatchDecision records), and it
blunts the very signal (`medium`) that's meant to flag off-center/ambiguous
solves. The display layer, not the scorer, is where the "should we show the
name" decision belongs.

### Option 3 — Operational only (no code)
Center the target before starting the stack (per `docs/OPERATIONS.md` §1) so
solves land `high`. Good practice regardless, but it doesn't fix the software —
any off-center solve would still be hidden — so pair it with Option 1, don't
rely on it alone.

## Recommendation

**Option 1** — accept `high` + `medium` in `resolveDisplayObject`. One-line
client change, data-proven to fix this exact case, no matcher/radius change, and
consistent with the history strip which already shows `medium`-confidence names.
Do **not** widen the match radius or the `high` scoring cutoff.

## Separate, unrelated finding (note, don't fix now)

T4 that night — RA 271.15 / Dec −23.59 — was a genuine near-miss on **M8**
(0.82° away, fraction 1.17, i.e. 17% outside M8's radius), and correctly recorded
as a `fallback` (4 frames, ~19:31–19:33). That's a real **radius-tuning**
candidate for M8, entirely separate from the M101 display-gate bug. Flagging it;
not touching it here.
