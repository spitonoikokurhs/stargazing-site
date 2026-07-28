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

---

# Addendum — Built: shared ephemeris lib + sky-calendar (28-07-2026)

Decisions approved (server-side compute; calendar first; cities Kos/Athens/Berlin/Rome/London;
notables = planets + Moon + the showpiece DSOs, held to the trust thresholds). Calendar +
shared lib built; flavor lines are next (not yet built). Held for review, not pushed.

## What was built

- **`config/cities.json`** — Kos, Athens, Berlin, Rome, London (coords + height + IANA zone).
  Adding a city is one entry here, no code change (per your constraint).
- **`lib/ephemeris.ts`** — the shared server-side layer (astronomy-engine wrapped): `sunMoonTimes`
  (rise/set + dark-from), `moonInfo` (phase name + illumination % + stargazing verdict),
  `moonWeek` (7-night strip), and the flavor-line groundwork (`visibleNotables`, `altAz`,
  `isDarkEnough`, `NOTABLES`). Pure; the engine is imported ONLY here.
- **`app/sky-calendar/page.tsx` + `.css`** — guest-facing, indexed, server-computed (hourly
  ISR). Moon header (glyph + verdict), 7-night planning strip (dark nights highlighted),
  per-city rise/set table, and the DST/timezone honesty note. Dark aesthetic, desktop-first,
  phone-fine.
- **`scripts/test-ephemeris.mjs`** — 33 assertions.

## DST / timezone honesty — CONFIRMED (your build-report ask)

The correctness rule is enforced and tested. astronomy-engine computes in UTC; every emitted
local time is formatted into that **specific city's IANA zone** via `Intl.DateTimeFormat`,
which applies the zone's real offset AND its daylight-saving rules for the given instant. So the
page is honest per city, and says which clock each time is on:

- **Each row carries its zone abbreviation, resolved for the date** — verified live on 28-07
  (summer): Kos/Athens **EEST**, Berlin/Rome **CEST**, London **BST**. The test also asserts the
  winter values (Kos **EET**, London **GMT**) so a DST flip can't silently break the labels.
- **Rendered times are genuinely different per zone and correct** — live: Kos sunset 20:21 EEST,
  Rome 20:32 CEST, London 20:54 BST (later, further west/north). Not a naive single-offset shift.
- **An explicit note on the page** tells the reader every time is in that city's own local clock
  with DST applied, and what "—" and "stays light" mean.
- **Honest nulls:** `SearchRiseSet` returns null on polar day / no-moonrise days, and `darkFrom`
  is null when the sky never reaches nautical dusk (northern summer). The page renders "—" /
  "stays light" — never an invented time. (`darkFrom` uses `SearchAltitude`, not `SearchRiseSet`
  — a bug I caught in review: SearchRiseSet's last arg is metres-above-ground, not a sun angle.)

## Server-side-only — CONFIRMED

Real `next build`: `/sky-calendar` ships **182 B** of page JS (First Load = the shared 87.5 kB
baseline). The ~46 KB astronomy-engine is **not in the client bundle** — the page is
static-prerendered and the engine stays server-only, exactly as designed. Client cost: zero.

## Verified

- 33/33 ephemeris assertions (DST abbrevs summer+winter, known-good Kos sunset 20:21 EEST, moon
  ~99%, daylight → silence, Saturn self-gated below horizon, deep-night notables surface).
- tsc + lint clean · all suites · real build green.
- Rendered live at 900px and 390px: correct per-zone times, 5 cities, 7-night strip, honest
  moon verdict, zero JS errors. Consent banner correctly appears (this IS a guest page, unlike
  /live* and /season).

## Next (not built): the flavor-line "true right now" pool

The groundwork is in `lib/ephemeris.ts` (`visibleNotables` returns the gated, above-15°,
after-dusk, direction-tagged notables — [] when nothing qualifies, so silence beats a wrong
claim). Remaining: a gated `FlavorSituation`/pre-`pickFlavor` branch in `lib/live-copy.ts` that
turns a visible notable into one short Aegean-toned line, recomputed from the live clock. Held
for a follow-up per the build order.

**Calendar + shared lib built and verified. Flavor lines next. Held for review. Not pushed.**

---

# Part 2 — Nightly sky-conditions card (scope addition, reshapes the calendar)

You want a per-date, per-city conditions card: full twilight phases, moon-during-dark-window,
and eyepiece-planet visibility with plain-language "best seen around…". This is not a bolt-on —
it becomes the substance of the calendar page. I verified every computation against the real
library (throwaway install, ran the maths, removed it) before proposing.

## Q1 — What astronomy-engine gives directly vs. what I derive

**Computed directly (a function call each):**
- **Twilight phases** — `SearchAltitude(Sun, obs, ±1, from, 1, angle)` with `angle` = −6 (civil),
  −12 (nautical), −18 (astronomical). Descending (−1) after noon = **dusk**; ascending (+1)
  before the next noon = **dawn**. Verified for Kos 28-07: civil 17:50, nautical 18:25, **astro
  19:03 UTC** (→ 22:03 EEST — that's your "session can properly start" number).
- **Planet transit + max altitude, in ONE call** — `SearchHourAngle(planet, obs, 0, from, 1)`.
  Hour angle 0 = due-south culmination = the object's highest point; the returned event carries
  `.time` AND `.hor` (altitude/azimuth) directly, so max altitude and transit time come together.
  Verified: Jupiter transits at alt 72.2° (az 180 = due south), Saturn 56.6°.
- **Rise/set** for sun/moon/planets — `SearchRiseSet` (already used).
- **Moon phase + illumination** — `MoonPhase` + `Illumination` (already used).
- **Mercury/Venus visibility** — `Elongation(body, when)` gives tonight's angular separation from
  the Sun + a `visibility` field ('morning'/'evening'). Verified: Mercury 28-07 = 18.5°, morning.

**Derived (simple logic on top, no extra ephemeris):**
- **Moon up during the dark window?** — interval overlap: does [moonrise, moonset] intersect
  [astro-dusk, astro-dawn]? Pure arithmetic on times I already compute. This is your
  "moon-all-night vs moon-free" distinction.
- **"Best seen around HH:MM, low/high in the [direction]"** — from transit time + max altitude +
  transit azimuth (always due south from our latitudes) → plain sentence. "high" if max alt
  >45°, "moderate" 25–45°, "low" 15–25°; skip below ~15° entirely (per your "don't list what
  nobody can see").
- **Mercury inclusion gate** — show Mercury ONLY when `Elongation` says it's genuinely
  observable (elongation > ~10° AND the object clears the horizon during a dark-ish window).
  Otherwise omit it, not "not visible" clutter.
- **Which planets to show tonight** — compute all of Jupiter/Saturn/Venus/Mars (+ Mercury when
  gated), drop any whose max altitude never clears ~15° during the night. A dropped planet gets
  ONE honest line ("Jupiter is too low from Kos tonight"), not a row implying it's up.

**Nothing needs an external source.** All offline, ~1 arc-minute, MIT.

## Q2 — Layout: one page + city switcher, tonight-default, with a date picker

**One page, `/sky-calendar`, with a city switcher** — not a page per city. Reasoning:
- **SEO:** five near-identical pages would compete with each other (thin/duplicate-content risk);
  one strong page with `?city=` (or a path segment) and per-city `<h2>`s concentrates the ranking
  signal. If we later want per-city landing pages for local search ("stargazing Rome"), those
  should be a *deliberate* small set of richer pages, not an auto-generated five — a later call.
- **Phone:** a switcher (chips/select) reads far better than five long stacked pages; the guest
  standing next to the scope picks Kos once and sees everything.
- **Server-computed still:** city + date are params; the page recomputes server-side and ships
  strings. Engine never hits the client (already proven: 182 B page JS).

**Tonight is the default; a date picker (not a multi-day table) for planning.** The card is
information-dense per night (twilight × 6, moon, 4–5 planets with sentences) — a multi-day table
of all that would be unreadable. So: **tonight by default**, a compact date picker to look ahead
(trip planning), and the existing **7-night moon strip stays** as the at-a-glance "pick a dark
night" overview that complements the detailed single-night card. Best of both: strip for
scanning, card for the chosen night.

## Q3 — Same surface as the sun/moon calendar? YES — it absorbs it.

I agree with your suspicion. The moon/sun calendar and this conditions card are the **same
page** — the card IS the calendar, deepened. Concretely, the page becomes:
1. **Moon header** (kept) — phase glyph, %, verdict.
2. **7-night moon strip** (kept) — pick a dark night.
3. **City switcher + date (default tonight).**
4. **The night card for the chosen city/date:**
   - **Darkness timeline** — sunset → civil → nautical → **astronomical dark (highlighted: "a
     session can start")** → … → astronomical dawn → sunrise. Plain row with times, astro-dark
     emphasised.
   - **Moon tonight** — rise/set, phase, and the plain verdict: "Moon sets at 01:10 — dark and
     moon-free after that" vs "Moon up most of the night — bright, best for the Moon itself."
   - **Planets tonight (eyepiece)** — a line per visible planet: "**Saturn** — best around 03:40,
     high in the south." Raw rise/set/transit kept in a details/expand for the number-wanters.
     A short "not up tonight" note for the dropped ones.
   - Every time labelled with the city's zone (EEST/CEST/BST…), DST-correct (already built +
     tested).

The per-city rise/set **table** I built becomes redundant once each city has a full card — I'll
**replace** it with the switcher+card (the table showed 5 cities × sunset/moonrise; the card
shows one city × everything, which is what a planner or a guest actually reads). The 7-night
strip and moon header carry over.

## Q4 — Product fit (informs the copy)

Planets are your **eyepiece** experience (stream = deep sky, eyepiece = planets), so the planet
lines are written two ways at once: **"what to look for tonight"** for a guest at the scope
("Saturn's high in the south right now — that's the one with rings in the eyepiece") and
**planning** for a visitor ("Jupiter rises late this week; come after 11pm or wait for August").
The plain-language sentences serve both; the raw times serve the planners who want them.

## Build plan (on approval of Q2/Q3 above)

1. Extend `lib/ephemeris.ts`: `twilightPhases(city, date)` (6 times), `planetsTonight(city, date)`
   (per-planet: rise/set/transit/maxAlt/direction/visible-flag + the plain sentence, gated +
   Mercury-elongation), `moonDuringDark(city, date)` (the overlap verdict). All server-side,
   pure, unit-tested against verified values (astro-dark 22:03 EEST, Saturn transit alt 56.6°,
   Mercury morning-only).
2. Rework `/sky-calendar`: add the city switcher + date param, replace the 5-city table with the
   single-city night card, keep the moon header + 7-night strip.
3. CSS for the card (timeline, planet lines). Same dark aesthetic.
4. Extend `scripts/test-ephemeris.mjs` with the new derivations + gates.
5. Verify (tsc/lint/suites/real build + live render at desktop+phone), confirming DST per city
   and that server-only still holds (engine not in client bundle). Hold for review.

**Two decisions before I build:** (a) **one page + `?city=` switcher, tonight-default + date
picker** — confirm? (b) **replace the 5-city table with the single-city card** (vs. keep both)?
My recommendation is the switcher+card; the table stops earning its space once each city has a
full card.

**Investigation done + verified. Awaiting your go on the two layout calls, then I build.**

---

# Part 3 — Built: nightly sky-conditions card

Approved: **one page + `?city=` switcher, tonight-default + date param; replace the 5-city table
with the single-city night card.** Built on the shared `lib/ephemeris.ts`. Held for review.

## What was built

- **`lib/ephemeris.ts` extended:** `twilightPhases` (the full ladder — sunset → civil → nautical
  → **astronomical dark** → astro dawn → nautical → civil → sunrise, each nullable), `planetsTonight`
  (per-planet rise/set + best-during-dark time/altitude/direction + plain sentence + the "not up"
  honesty case), `moonDuringDark` (moon-in-dark-window verdict — your moon-free vs moon-up-all-night
  distinction). Mercury gated on real elongation. All server-side.
- **`/sky-calendar` reworked:** moon header + 7-night strip (kept) → city switcher chips → the
  single-city night card: darkness timeline (astro-dark row highlighted "a session can start"),
  moon verdict + raw times, and the planet lines with expandable raw times. The 5-city table is
  gone (superseded by the card).
- **`test-ephemeris.mjs` extended** — now covers the twilight ladder, the during-dark planet
  evaluation, the moon-during-dark verdict, and the no-dark (northern-summer null) path.

## Q1 confirmed in build — what's computed vs derived

- **Computed directly:** twilight phases (`SearchAltitude` at −6/−12/−18), planet transit + alt/az
  (`SearchHourAngle`, event carries `.hor` directly), rise/set (`SearchRiseSet`), moon phase/illum,
  Mercury visibility (`Elongation`).
- **Derived (simple logic):** the "best seen around HH:MM, low/high in the [direction]" sentence;
  the moon-in-dark-window overlap; the planet inclusion gate.

## The honesty bug I caught and fixed (worth flagging)

My first pass reported each planet's **raw transit** — which for Jupiter/Venus tonight is during
the DAY (Jupiter "high, best around 13:21", Mercury "72°"). That would have told a guest at the
eyepiece to look for a planet that's below the horizon all night. **Fixed:** a planet's visibility
and best time are now evaluated by sampling its altitude **across the astronomical-dark window**,
not at transit. Live result for Kos 28-07: Saturn "High just before dawn (04:31) — in the
southeast" (53°, genuine), Mars low, **Venus + Jupiter honestly "Not up tonight"** — no false
rows. A regression test now guards this (every visible planet must clear 15° during real dark).

## DST honesty — confirmed live per city

Rendered: Kos "all times **EEST**", Berlin "all times **CEST**" — each city's own zone, DST applied
for the date, stated on the card. Every time carries its zone; the test asserts summer AND winter
abbreviations so a DST flip can't silently break them. Honest nulls throughout ("stays light" when
a phase isn't reached; "Not up tonight"; the northern-summer no-dark note).

## Verified

- Extended ephemeris suite (twilight ladder ~22:03 astro-dark, during-dark planets with the
  daytime-transit regression guard, moon-during-dark, Berlin-midsummer null-dark) — all pass.
- tsc + lint clean · all suites · real build green. `/sky-calendar` ships **182 B** page JS —
  engine still server-only, not in the client bundle.
- Live render at 900px + 390px: correct per-zone times (EEST/CEST), astro-dark highlighted,
  honest planet visibility, city switcher, zero JS errors.

## Still not built: the astro-correct flavor lines (feature 2b)

The groundwork (`visibleNotables`) is in place; the gated "true right now" flavor pool in
`lib/live-copy.ts` remains for a follow-up.

**Conditions card built + verified. Held for review. Not pushed.**
