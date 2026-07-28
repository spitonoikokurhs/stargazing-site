# Ephemeris Layer — Investigation Report

**Date:** 28-07-2026
**Branch:** `feat/ephemeris-astro` (off `main`)
**Status:** Investigation only — no feature code. Hold for review. (The `?demo=history-test`
mock-image fix + the history-browsing brief are also on this branch, already done.)

Two features share one ephemeris layer, as you framed it:
- **A. Astro-correct `/live` flavor lines** — only name a planet/object when it's genuinely up.
- **B. Guest sun/moon calendar** — rise/set + moon phase for Kos, Berlin, Rome, London.

I checked the library against reality (installed it in a throwaway dir, ran the actual maths,
measured the real gzip, then removed it), and mapped both integration surfaces in the code.

---

## Q1 — `astronomy-engine`: does it do what we need, offline? YES. Verified.

Confirmed by running it, not just reading docs (throwaway install, then removed):
- **Offline / no key / no deps:** `dependencies: {}`, MIT license, single self-contained JS
  file. Everything computes from built-in models (VSOP87 planets, ELP2000 moon). No network.
- **Capability A (alt/az from a location):** `new Observer(lat, lon, h)` → `Equator(body, …)`
  → `Horizon(…)` gives azimuth/altitude for the 8 planets, Sun, Moon. Arbitrary deep-sky
  objects work via `DefineStar` (supply RA/Dec — and **our `config/catalog.json` already
  stores `raDeg`/`decDeg` per object**, so DSO visibility is free data we already have).
  Smoke test: Saturn from Kos, 28-07 20:00 UTC → az 80.7°, alt **−5.8°** (just below the
  horizon — so a "Saturn's up" line correctly would NOT fire; the maths gates itself).
- **Capability B (rise/set + phase):** `SearchRiseSet(body, obs, ±1, midnight, 1)` for
  sun/moon rise/set (returns `null` on polar day/no-moonrise days — must null-handle);
  `MoonPhase()` (angle) + `Illumination().phase_fraction` (0..1) for the phase + name.
  Smoke test: Kos 28-07 → sunrise/sunset 06:12/20:21 local, moon 99% illuminated (near-full).
- **Accuracy:** ~1 arc-minute — vastly finer than "in the southeast" needs. Millennia of range.

**Bundle — the one real design driver.** Measured: **~46 KB gzip** (browser-min build). But
it's **all-or-nothing — no tree-shaking** (shared coefficient tables), so importing one
function pulls the whole engine. → **Recommendation: compute SERVER-SIDE and ship only the
resulting strings.** The engine never reaches the browser, the client bundle cost is **zero**,
and both features want server compute anyway (flavor lines can be pre-computed; the calendar is
a page). This is cleaner than a client dynamic-import and I'd build it that way unless you want
the flavor line to recompute on a sub-minute cadence in the browser (it doesn't need to — see Q2).

## Q2 — Flavor-line integration

**Key finding from the code:** flavor lines today render **only on the offline/status screens**
(`buildFlavorContext` is built from the offline payload — `LiveView.tsx:2401/2418`), i.e.
**pre-show and off-night, never over the live feed.** That's actually the *ideal* home for
"what's up tonight" copy — a guest who scanned early, or is checking before they come down,
sees "Saturn's rising in the east right now" while waiting. No need to touch the live view.

**The mechanism** (`lib/live-copy.ts`): `FLAVOR_POOLS: Record<FlavorSituation, string[]>` —
per-situation pools (`GENERAL`, `APPROACHING`, `SOON`, …); `pickFlavor` picks the situation's
pool, runs `interpolate()` (which already does `{hotel}`/`{start}` substitution — the seam),
and `pickFrom` avoids the last 3. Client-rotates every 8s in `FlavorLine`. **Load-bearing
constraint:** the rotation effect depends on *primitive* inputs, not the context object, and
`pickFlavor` re-reads the live clock internally — so any time-varying computed input must be
re-derived from the clock inside `pickFlavor`, not captured once.

**Three options (evidence in the flavor-map); my recommendation is (c):**
- (a) Replace GENERAL with computed lines — loses the curated 50-line personality, highest
  stale risk. No.
- (b) Augment — merge computed lines into the pool; simplest, but random selection means a
  genuinely special event ("Saturn AND a near-full moon, both up") competes equally with filler
  and no priority. Medium stale risk.
- **(c) A separate gated "true right now" pool with priority — RECOMMENDED.** A new
  `FlavorSituation` or a pre-`pickFlavor` check: when a truly-notable object is genuinely up
  (gated on real thresholds, below), surface a computed line, weighted above generic filler;
  otherwise fall through to today's pools unchanged. Lowest stale risk, you control exactly when
  a computed line is eligible, and the curated personality stays intact. Most code, but the
  module is already built for injectable-clock testing (`now?: Date`).

**Trustworthiness thresholds (what makes a computed line honest):**
- **Altitude > ~10°** above the horizon — below that it's behind hills/haze/buildings, so
  "Saturn's up" would be technically-true-but-useless. (Kos venues are near sea level with a
  sea horizon, so ~10° is a fair floor; ~15° to be safe.)
- **Direction from azimuth** in 8-point compass words (N/NE/E/…), never degrees — matches the
  pool's no-numbers voice.
- **Darkness gate:** only when the Sun is below ~−6° (civil dusk) — GENERAL fires >60min before
  start, often in daylight; a planet "up" at 3pm is noise. Compute the Sun's altitude too and
  gate on it.
- **Notability:** planets (naked-eye, guests can find them) + a short hand-picked showpiece DSO
  list, not every catalog object. A computed line about a mag-10 galaxy nobody can see unaided
  helps no one.
- **Tone:** one short sentence, no numbers/jargon, Aegean warmth — matching e.g. *"Jupiter,
  Saturn, or a galaxy far away — the sky decides tonight's stars."* (`live-copy.ts:131`), the
  existing planet-naming template. Computed line e.g. *"Saturn's climbing in the southeast
  right now — we'll aim there tonight."*

## Q3 — Sun/Moon calendar page

**Guest-facing.** It fits the existing marketing story (the Bodrum page's FAQ already says "the
moon phase is checked in advance"), gives home-viewers and trip-planners a reason to visit, and
carries no private data. Build it like the existing static guest pages (`app/bodrum-hotelleri`
— SSG, JSON-LD, self-contained CSS), **noindex off** (this one we WANT indexed, unlike the
operator pages).

**Data per city** (Kos, Berlin, Rome, London — coords in a new `config/cities.json`):
- Today's **sunrise / sunset**, **moonrise / moonset** (null-handled: "—" or "up all night"),
  **moon phase name + illumination %** + a small phase glyph, and **golden/blue-hour**-ish
  "best dark-sky window" (sunset → when the sky is genuinely dark) — the line that matters for
  stargazing.
- All four cities share one moon phase (the Moon looks the same continent-wide) — so phase is
  one header, rise/set is the per-city table.

**Layout (desktop-first, phone-fine, matching the site's calm dark aesthetic):**
- Header: tonight's moon — big phase glyph, name ("Waning gibbous, 87% lit"), and a one-line
  stargazing verdict ("Bright moon — best for the Moon itself and planets, faint galaxies wash
  out").
- A 4-row city table: City · Sunset · Dark from · Moonrise · Moonset, tabular-nums.
- Optional: a 7-day moon-phase strip (tonight + next 6) so a trip-planner can pick a dark night
  — cheap to compute, high planning value.
- CTA at the bottom → the events/contact, tying the planning tool back to booking.

**Compute:** server-side at request time (or ISR revalidating hourly) — the page ships plain
strings, the engine stays server-only. A city's timezone conversion is ours to do (engine is
UTC-internal); `Intl.DateTimeFormat` with the city's IANA zone handles it, no extra dep.

## Q4 — One feature or two? ONE shared lib, TWO thin consumers. (I agree with coupling.)

Coupling the **ephemeris layer** is right; coupling the **surfaces** is not. Concretely:
- **`lib/ephemeris.ts`** (new, server-side, pure): wraps astronomy-engine into small honest
  functions — `bodyAltAz(city, body, when)`, `visibleNotables(city, when)` (returns the gated,
  above-horizon, dark-sky notable list), `sunMoonTimes(city, date)`, `moonPhase(when)`. This is
  the shared layer, built and tested once (against the smoke-test values above).
- **Consumer 1 (flavor):** a server route or RSC-computed input that calls `visibleNotables` and
  feeds the gated "true right now" pool (Q2c).
- **Consumer 2 (calendar):** the page calls `sunMoonTimes` + `moonPhase` per city.

Why not one surface: they render in different places (a rotating line inside `/live`'s status
screen vs. a standalone page), have different audiences (a waiting guest vs. a home planner),
and different data (visibility gating vs. rise/set tables). Forcing them together would bloat
both. **The lib is the reuse; the surfaces stay independent.** If you ever disagree and want,
say, the calendar embedded into the live waiting screen, the lib already supports it — but I'd
ship them as two pages/surfaces.

## Recommended build order (on approval)

1. `lib/ephemeris.ts` + `config/cities.json` (Kos/Berlin/Rome/London coords + IANA zones), with
   a pure unit test asserting the smoke-test values (Saturn below horizon at the test instant,
   Kos sunset ~20:21 local, moon ~99%). Server-only; engine never bundled to client.
2. The sun/moon calendar page (bigger visible win, fully independent) — build + verify first.
3. The flavor-line "true right now" pool (Q2c) — smaller, threaded into the existing seam.
4. Standard drill each: tsc + lint + suites + real build; live screenshot pass; hold for review.

## Decisions I need

1. **Server-side compute (engine never ships to browser) — confirm?** My strong recommendation;
   the only reason to reconsider is if you want the flavor line to recompute client-side on a
   fast cadence, which it doesn't need.
2. **Build the calendar first, flavor second** (calendar is the bigger standalone win) — or the
   reverse?
3. **Cities:** Kos, Berlin, Rome, London as stated — add/drop any? (Athens, given the base?)
4. **Notable-object list for flavor:** planets + which showpiece DSOs? (I'd start with the
   Moon, the naked-eye planets, and ~5 famous DSOs that are genuinely bright — M31, M42, M45,
   M13, M8 — gated on season/visibility. Your call on the list.)

**Nothing built beyond the investigation + the already-done mock fix. Awaiting your direction.**
