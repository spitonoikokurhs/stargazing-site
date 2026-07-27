# Consent-Free Viewer Counting — Investigation & Options

**Date:** 28-07-2026
**Branch:** `fix/consent-free-viewer-count` (off `main`)
**Status:** Investigation only — **options, not an implementation. Nothing built.**

---

## Q1 — Diagnosis: CONFIRMED, and the evidence is unambiguous

Your read is exactly right. The full chain, from the code:

1. **QR guests land on `/live` and are never offered consent.** The banner is suppressed on
   every `/live*` path ([cookie-consent.js:188+](public/cookie-consent.js#L188), the
   `isBannerSuppressedPath` tier) — which we did on purpose so it could never cover the
   farewell scene. A guest who scans a QR and never visits the homepage is therefore never
   shown the banner, so `localStorage` never gets `accepted`.
2. **No consent → no viewerId.** Each poll, LiveView calls `getConsentedViewerId()` then
   `getOrCreateViewerId()` ([LiveView.tsx:1289-1295](app/live/LiveView.tsx#L1289)) — both
   return `null` unless consent is stored. So the poll URL carries **no** `viewerId`
   (:1297-1299).
3. **No viewerId → not counted.** `/api/status`'s `trackViewer` first line is
   `if (!viewerId) return` ([status/route.ts:112](app/api/status/route.ts#L112)); and
   `recordViewerActivity` counts unique/peak by adding the `viewerId` to a Redis SET / active
   sorted set ([redis.ts:130-138](lib/redis.ts#L130)). No id → nothing added → guest invisible.

Each of the three is working as designed. **Together they make it structurally impossible to
count a QR-only guest** — the only viewers counted are the handful who happened to visit the
homepage (and accepted) before scanning.

### The evidence (production archive, read-only)

| | 20-07 astir | 27-07 astir |
|---|---|---|
| Regime | **pre-consent** (gating deployed 26-07 14:03, `aa53157`) | **first real event AFTER gating** |
| unique / peak | **30 / 13** | **4 / 2** |
| snapshotSource | finish | finish |

And 27-07's **Tier-1 interaction counters exist**: `fullscreen_enter ×2`, `object_info_open`
on M51 and M27. Those beacons need **no** viewerId (Tier-1 is identifier-free), so they fired
for the real audience while the viewer counter — which needs a consented id — saw 4. **The
audience was there; the counter couldn't see it.** This is the proof, exactly as you predicted
in Q5 (fully answered below).

The 30 → 4 drop is not an audience collapse; it's the consent gate landing between the two
Astir nights. That's the discontinuity `/season` already flags with its 26-07 divider — but
the divider undersells it: post-gating, the number isn't just *lower*, it's *structurally
broken* for QR-only events.

---

## Q2 — Consent-free counting designs

The bar (yours, and the right one): **same legal footing as Tier-1** — no identifier stored on
the guest's device, no personal data, nothing that could single out a person. Options, with
what each actually measures:

### (a) Pure server-side page-open counter — NO identifier anywhere
- **What/where:** `/api/status` increments a Redis counter per poll (or per first-poll). No
  cookie, no storage, no id in the request.
- **Measures:** raw poll volume, or (first-poll-only) page-opens. **Cannot** distinguish
  people from refreshes/reconnects, and **cannot** compute *unique* or *peak concurrent* at
  all — a counter has no notion of "distinct" or "currently active."
- **Identifier-free:** trivially yes.
- **Verdict:** honest but too blunt — it throws away the two numbers you actually renew hotels
  on (unique, peak). Poll volume swings with poll cadence and reconnects, so it's not even a
  stable proxy. Rejected as the primary, but see the hybrid note.

### (b) In-memory-only ephemeral session id — NEVER written to storage
- **What/where:** LiveView mints a random id in a plain JS variable (`crypto.randomUUID()`)
  held in a React ref — **never** `localStorage`, `sessionStorage`, or a cookie. It rides the
  poll URL exactly where the consented `viewerId` does today, and feeds the **same**
  `recordViewerActivity` (SET for unique, active sorted-set for peak). It dies when the tab
  closes or reloads.
- **Measures:** unique + peak concurrent — the real metrics — for the life of a tab.
- **Distinguishes:** two different phones = two ids ✓. **A refresh mints a NEW id** (the old
  one was never persisted), so a guest who reloads counts as 2 unique. Peak concurrent is
  barely affected (the old tab's id ages out of the 60s active window). So this **slightly
  over-counts unique** on reloads — an *upper*-leaning estimate, which for "how many were
  watching" is the safe direction and miles better than 4.
- **Identifier-free — is it provably so, like Tier-1?** This is the crux. The id exists only
  in tab memory and vanishes on close; nothing is stored on the device, no cookie, no
  fingerprint, no IP. Under GDPR/ePrivacy the relevant question is Art. 5(3) (storing/accessing
  info on the device) — **(b) stores nothing on the device, so 5(3) isn't triggered**, same as
  Tier-1. The id is a transient, single-session, random token used only to de-duplicate a live
  count server-side; it is not retained and cannot re-identify the guest on a later visit. This
  is a well-trodden "count without tracking" pattern. **One honest caveat vs Tier-1:** Tier-1
  stores *no per-person token at all* (pure tallies), whereas (b) has a per-tab token in
  flight — so (b) is *marginally* less trivially-provable than Tier-1, though still, in my
  reading, consent-free. If you want the absolute Tier-1 footing with no per-person token
  anywhere, that's option (c).

### (c) Server-derived ephemeral id — no token on the client at all (my recommendation to consider)
- **What/where:** the client sends **nothing** identifying. The server derives a *transient,
  in-memory-only* dedup key per active connection from request-shape data it already receives,
  salted with a **daily-rotating server secret and never stored** — e.g. a short hash used only
  to populate the same active/unique Redis structures, with the usual TTL, then discarded. The
  raw inputs are never written; only the ephemeral hash lands in the (TTL'd, per-event) counter
  sets.
- **Measures:** unique + peak, like (b).
- **Trade-off:** the dedup quality depends on how distinguishing the server-side inputs are —
  coarser than a per-tab id, so it can *under*-count when guests share a NAT (many phones, one
  apparent connection signature). That's the opposite failure of (b).
- **Identifier-free:** strongest of the three on the "nothing on the device" axis. But it edges
  toward using request metadata (which can include IP-derived signal) — so it must be built to
  **hash-and-discard with a rotating salt, storing nothing raw**, or it stops being clean. That
  discipline is exactly what makes it more delicate to get provably right than (b).

### Recommendation for your decision
**(b) is the best fit for what you actually asked for:** it restores the real unique + peak
numbers, needs no device storage (5(3) not triggered), reuses the entire existing
`recordViewerActivity` machinery unchanged, and its only inaccuracy (reload over-count) leans
*up* — the honest direction for an audience estimate. (c) is theoretically cleaner on "zero
client token" but harder to prove correct and prone to NAT under-counting; (a) can't produce
your metrics. A possible refinement: **(b) as primary, plus (a)'s raw page-open counter as a
cross-check** so you can sanity-check unique against total opens. I'd want your steer before
picking between "(b) alone" and "(b) + (a) cross-check."

---

## Q3 — Coexistence with the existing consented viewerId (no two competing numbers)

The consented path and (b) must **not** both count the same guest, or unique inflates. The
clean design — **one id per poll, chosen by a clear precedence, feeding one counter:**

- If the guest **has consent** and a stored `viewerId` → use it (stable across reloads — the
  *better* number, so consented guests are counted more accurately).
- Else → use the **ephemeral in-memory id** (option b).
- Either way, exactly **one** id rides the poll and feeds `recordViewerActivity`. There is
  still **one** unique/peak number per event; the id's *provenance* differs per guest but the
  count is single-sourced. So this **supersedes** the "consent-or-nothing" gate without
  removing the consented path — consent still buys the cross-session-stable id (and remains the
  only thing that unlocks Tier-2 journeys + Vercel Analytics); it just stops being the
  *precondition for being counted at all*.
- **`clearStoredViewerId` on withdrawal still works** — a guest who rejects consent loses the
  stored id and falls through to the ephemeral one, so they're still *counted* (anonymously)
  but no longer *tracked* across sessions. That's the correct post-withdrawal state, not a
  regression.

Net: no second number. One counter, one metric, better-populated.

---

## Q4 — Keeping the `/season` trend honest across THREE regimes

Today's archive now spans three counting regimes, and the season view must not let you misread
a *measurement change* as an *audience change*:

1. **Pre-consent** (≤ 25-07): everyone counted (incl. your own testing — already footnoted).
2. **Consent-gated** (26-07 → whenever this ships): QR-only guests **structurally undercounted**
   — the 4/2 regime. This is the dangerous band: the numbers look real but are broken.
3. **Consent-free** (post-this-fix): everyone counted again, by the ephemeral id.

`/season` already has the 26-07 divider, but it currently frames 26-07 as "counts fewer
(consenting only)" — which *understates* regime 2. Proposal:
- **A second boundary** at this fix's deploy date, and re-label the regimes explicitly:
  regime-2 rows get a distinct marker meaning **"undercounted — QR guests not captured"**, not
  merely "consent-gated." A per-row badge is more honest than a single divider here, because
  regime 2 is the one whose numbers you must NOT quote.
- **Best-night split** (already pre/post-consent) becomes a **three-way** or, cleaner, "best
  night (comparable-counting only)" that draws from regimes 1 **and** 3 (both count everyone)
  while **excluding** regime 2 — so the headline is never a structurally-broken number.
- **Per-hotel rollups:** exclude regime-2 nights from the averages (or mark them `‡` and show
  the n), same discipline as the existing pre-snapshot exclusion — a renewal average must not
  be dragged down by nights the counter couldn't see.
- A one-line footnote naming the three regimes and their dates.

This is a `lib/season-data.ts` + page change only (no new data), and it's the right moment to
do it since regime 2 is now a named, dated, understood band.

---

## Q5 — What 27-07 astir-odysseus interaction counters show (CONFIRMED)

Directly from the archive:

```
27-07 astir-odysseus (eventKey 2026-07-27:astir-odysseus)
  fullscreen_enter          2
  object_info_open  M51     1
  object_info_open  M27     1
  viewer stats: unique 4 / peak 2
```

Those interaction beacons are **identifier-free and fire with no viewerId** — so they recorded
real guest actions (people entering fullscreen, opening object info on two different targets)
**while the viewer counter saw only 4.** That is the diagnosis proven from data: **the audience
was present and interacting; the consent-gated counter simply couldn't count them.** (The
interaction totals are small because only some guests tap — they're an existence proof, not an
audience size; the *size* is what option (b) recovers.)

---

## Scope guardrails (your constraints, locked)

- **No farewell-scene change.** None of the options touch it.
- **No banner re-introduced on `/live*`.** The whole point is counting *without* a banner —
  the suppression stays exactly as is.
- Guest experience is untouched: (b) is an in-memory variable + an extra URL param that already
  exists on the poll; the guest sees and feels nothing.

## Decisions I need before building

1. **Which design:** (b) alone, (b) + (a) cross-check, or (c)? (My lean: **(b) alone** — start
   simple, it recovers the real numbers; add (a) later only if you want a cross-check.)
2. **Season regime-2 handling:** badge-and-exclude regime-2 nights from averages/best-night as
   proposed, or something lighter?
3. Anything on the legal read of (b) you want a second opinion on before I build — happy to
   write it up more formally, but I won't proceed on the counting change until you're satisfied
   it's consent-free to your standard.

**Nothing built. Awaiting your direction on Q(decisions) above.**
