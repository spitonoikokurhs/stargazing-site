# Viewer Metrics — Spec (banked)

**Status:** banked design, **not built yet**. Build **after** the Astir Odysseus
dry-run seam-test — it's a new backend feature (new route + Redis writes), which
is exactly the category we're holding until after the event for stability.

**Owner-facing only.** These numbers are for us, never shown to guests.

---

## Why this exists

First piece of the **hotel-value-metrics funnel** — the numbers we show a hotel
to prove the live view earns its keep (how many of their guests actually
watched, and how big the peak audience was on a given night). It plugs into the
`viewers: null` stub already shipped in `app/api/status/route.ts` (~line 149:
`viewers: null, // placeholder until /api/heartbeat lands`).

## What we measure

| Metric | Build? | Notes |
|---|---|---|
| **Total unique visitors** per night | **No — already covered** | Vercel Analytics already reports unique visitors and is filterable by date. Re-building it would duplicate it. Use the dashboard. |
| **Max concurrent viewers** per night (within the venue window) | **Yes — this is the work** | Vercel doesn't give a reliable per-night concurrency peak. This is the genuinely new metric and the focus of the build. |

So the build is essentially: **max-simultaneous viewers per event night**, private.

## Identity basis — anonymous browser ID (NOT MAC, NOT IP)

- **MAC address is impossible.** MAC addresses never leave the local network
  segment; a web server never receives one. Any "per MAC" counting is a
  non-starter on the web.
- **IP is useless for our case.** At a hotel every guest shares one NAT'd public
  IP over the venue Wi-Fi, so IP-based counting would collapse the whole
  audience into a single visitor.
- **Use an anonymous browser ID.** A random UUID minted client-side and stored
  in `localStorage` (fallback: a first-party cookie). It identifies a *browser*,
  not a person or device — resets on cache-clear / incognito / new device. Good
  enough for concurrency counting; never tied to identity.

## Privacy / GDPR / cookie-consent

- The anonymous ID is **personal data under GDPR** (it's a persistent
  pseudonymous identifier), even though it carries no name/email.
- **Gate it behind the existing cookie-consent flow** (the site already has
  cookie consent → GA4). The heartbeat/ID must only activate after the analytics
  consent category is granted; with consent denied, `/live` still works, we just
  don't count that viewer.
- Store **aggregates, not history**: keep only per-night presence with short
  TTLs and a per-night max integer. Do **not** retain a per-visitor visit log.
- Update the **privacy policy** to mention anonymous audience-measurement on
  `/live` before shipping.

## Metrics windows (per venue, Athens local time)

Concurrency is only counted **inside the venue's event window** so a stray
daytime hit or a late lingering tab doesn't distort the peak.

| Venue | Window (Europe/Athens) |
|---|---|
| OKU Kos | **21:45 – 23:15** |
| All others (incl. Astir Odysseus) | **21:20 – 22:45** |

Make this a small config map keyed by `hotelId` (default = the "all others"
window), so windows are editable without code changes to the counting logic.
Source the active venue from the same schedule the rest of `/live` already uses.

## Architecture sketch (for the build later)

1. **Client heartbeat** — while `/live` is open and consent is granted, POST the
   anonymous ID to `/api/heartbeat` every ~15–20s (reuse/piggyback the existing
   `/api/status` poll cadence where possible).
2. **`/api/heartbeat` route** (new) — on each beat, write a Redis presence key
   `presence:<night>:<id>` with a short TTL (e.g. 45s). Active concurrency =
   count of live keys (a `SET presence:<night>` with per-member expiry, or a
   sorted set scored by last-seen timestamp, pruned on read).
3. **Per-night max** — after computing current concurrency, only *inside the
   venue window*, update `max:<night>` via `max(current, stored)` (a Lua
   `GETSET`-style compare, or a small transaction). Nights keyed by Athens date.
4. **Private read** — an admin-gated view (reuse `ADMIN_PASSWORD`) that shows
   `max:<night>` per date. "Somewhere, somehow, for me only" — could be a
   password-gated `/admin/metrics` page or a protected API returning JSON;
   minimal UI is fine.
5. **Wire the stub** — once concurrency is real, `/api/status` can surface
   `viewers` (current concurrency) in place of the `null` stub if we ever want a
   live number, but the **max-per-night** stays owner-only.

## Open questions (resolve at build time)

- Heartbeat cadence vs. Upstash request budget (each beat is a Redis write).
- Exact presence structure (per-key TTL vs. sorted-set + prune) — pick for
  fewest Redis ops.
- Where the admin view lives (page vs. JSON endpoint) and how it authenticates.
- Whether to also bank **total uniques via our own ID** later, or keep leaning
  on Vercel Analytics for that number.

## Sequencing

**Post-Astir.** After the dry-run, on its own branch (`feat/viewer-metrics`).
Not before — it adds backend surface area we don't want to introduce right
before the seam-test.
