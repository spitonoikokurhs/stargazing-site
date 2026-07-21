# Stale-astrometry naming failure — scope + build order (v1)

**Status:** SCOPED, not built. Detect-and-log ONLY for v1 — no naming-behavior
change until we have a night of real `astrometryTimestamp` data.
**Branch discipline:** this is SEPARATE from `fix/m101-naming-match` (the
display-gate fix). Do NOT build stale-detection on that branch. This doc lives
on `docs/stale-astrometry-scope`.

---

## The failure (oku-kos, 2026-07-21; same class seen at Astir earlier)

The Lagoon (M8) was genuinely, optically dead-centered in the SmartEye view. But
the SmartEye's REPORTED astrometry stayed FROZEN for the whole ~15-min stack, so
the site matched a stale coordinate that pointed at empty sky → correct fallback
to "Deep-sky field." **The fallback logic worked; the INPUT was a stale
coordinate at the source.** This is NOT the M101 bug (that was a correct
coordinate hidden by a display gate). No naming-logic change fixes a bad input.

### Proven from production data (Neon session `cmrv219080000l804ftd7xk7j`)
- 21 frames frozen at astrometry `269.5333, -22.7975`, `astrometryState:"solved"`
  the entire time, while `totalAccumulatedTime` climbed.
- On those frames the NYX mount read `271.4174, -22.8004` (`mountTelemetryOk:true`,
  `mountTelemetryAgeSeconds:0.7`) → a **1.737° astro-vs-mount disagreement**.

### Proven from the relay log (2026-07-21 tail)
Three consecutive successful solves, minutes apart:
```
22:18:12  state=solved timestamp=7  ra=208.5387573 dec=50.3486099  totalAccumulatedTime=15
22:20:11  state=solved timestamp=7  ra=208.5387573 dec=50.3486099  totalAccumulatedTime=120
22:22:15  state=solved timestamp=7  ra=208.5387573 dec=50.3486099  totalAccumulatedTime=240
```
`astrometryTimestamp` FROZEN at `7`, RA/Dec identical to 7 decimals, while
integration advances 15→120→240s. **This is the real falsifier and it needs no
NYX.** Matches the OKU-July-7 12-minute frozen-solve case in `docs/OPERATIONS.md`.

### Why the MOUNT is NOT a rescue source (decisive — shelves mount-primary)
The same log shows the mount was ALSO stale, in a different way, and lied about
being fresh:
```
22:18:12  mount ok=False ra=202.752204   dec=47.05734766 age=7.4s
22:20:11  mount ok=True  ra=202.7521794  dec=47.05734766 age=1.1s
22:22:15  mount ok=True  ra=202.7521524  dec=47.05734766 age=1.1s
```
`dec` byte-frozen at `47.05734766`; the DB probe shows the same frozen mount
`dec` on the M8 frames. **`mountTelemetryOk:true` + low `age` did NOT mean the
value was fresh.** A "prefer-mount-when-fresh" rule would have matched on ANOTHER
wrong coordinate. NYX also flapped unreachable↔recovered dozens of times in ~25
min (mDNS `nyx88.local` resolution failures + connect timeouts). Conclusion:
**the mount is not a trustworthy coordinate oracle right now; do not name from
it.**

### (Context, not our bug) tonight also had two other concurrent failures
Most frames failed to UPLOAD (`Failed to resolve 'www.stargazing.events'` — the
relay's own internet DNS was down), and SmartEye HEAD 404'd for the first ~20
min. Those are relay/network issues, out of scope for this repo. Only the
stale-coordinate naming behavior is addressable here.

---

## What the naming path uses today (confirmed in code)

ONLY the SmartEye astrometry `raDegrees`/`decDegrees` when
`astrometryState==='solved'`. The mount fields are present in raw `Frame.metadata`
but UNUSED for matching, and are NOT even carried in the Redis telemetry subset
that `/api/status` reads.

- Live display match: `app/api/status/route.ts` `resolveObjectMatch`.
- Ingest DB match: `app/api/ingest/route.ts` `resolveStackRunMatch` /
  `solvedCoords` (reads raw metadata — mount fields ARE visible here, just unused).
- Redis subset written by ingest step 8 = `{state, astrometryState,
  totalAccumulatedTime, raDegrees, decDegrees}` — mount fields dropped here.

### Existing helper to build on (do not duplicate)
`lib/detect-transition.ts` already has `assessAstrometryFreshness(...)` +
`AstrometryFreshnessInput` — flagged in `OPERATIONS.md` as "unvalidated, awaiting
real SmartEye timestamp data." We NOW have that data. IMPORTANT nuance: tonight's
`astrometryTimestamp` was a small integer (`7`) that FREEZES, not an aging epoch
clock. So the robust detector is FRAME-TO-FRAME DELTA ("did the timestamp value
change vs the previous frame in this stack?"), NOT absolute age
(`assessAstrometryFreshness`'s current `STALE_AFTER_S` age model, which assumes an
advancing clock). Reuse/extend the module, but the primary signal is
delta-based.

---

## BUILD ORDER (v1) — detect-and-log only

### 1. Stale-solve detection (SmartEye-only, NO NYX dependency) — PRIMARY SIGNAL
Flag `astrometryFrozen = true` when, within the same stack run:
- `astrometryTimestamp` AND `raDegrees`/`decDegrees` are unchanged across **>=3
  consecutive frames**, AND
- `totalAccumulatedTime` has advanced by **>=60s** across that span.

Rationale for the thresholds: identical to 7-decimal coordinates across ≥3 frames
while integration climbs ≥60s is unambiguous — a real re-solve would jitter the
low decimals and advance the timestamp. Keep them tunable; validate against the
first night of logged data before trusting them.

### 2. Site behavior when `astrometryFrozen = true`
Do NOT confidently name from the SmartEye coordinate. Show the "Deep-sky field"
fallback (or the settling state, depending on `state`). **This does NOT rescue
tonight's Lagoon name** — it makes the fallback PRINCIPLED instead of accidental,
and it can NEVER introduce a WRONG name. That's the correct first trade.
(NOTE: v1 is detect-and-LOG only. The behavior change in this step is v2, gated
on a night of data confirming the detector doesn't false-positive. See "Rollout".)

### 3. Log/persist per frame — turns both failure modes into evidence
Record, per frame (extend `MatchDecision`, the natural home — additive nullable,
same pattern as the M101 `hasInRangeRunnerUp` work):
- `astrometryTimestamp`
- `astrometryTimestampAdvanced` (bool: changed vs previous frame in this stack)
- `astrometryFrozen` (the derived flag from step 1)
- `mountRaDegrees`, `mountDecDegrees`, `mountTelemetryOk`, `mountTelemetryAgeSeconds`
- `astroVsMountDeltaDeg` (via existing `angularSeparationDeg`)
- `coordinateSourceUsed` + `reason` (what the naming path actually used and why)

### 4. NYX = SECONDARY DIAGNOSTIC ONLY
Log the mount fields + delta, but do NOT let NYX drive any guest-facing name
until it's proven fresh/stable over a night or two with **numeric IPs (no mDNS)**
+ **single relay instance** (the log shows TWO relay instances running — every
line is duplicated). NYX reliability (DHCP reservation, relay-side) is a
prerequisite for ever reconsidering mount-as-source, and is NOT work in this repo.

---

## Explicitly OUT of scope
- **Do NOT widen the M8 radius.** A ~2° error is a SOURCE bug (stale solve), not
  catalog tuning — widening the radius to swallow a stale coordinate would
  mis-name real nearby objects. Leave the catalog alone.
- **Do NOT build mount-primary / prefer-mount.** Shelved by tonight's data
  (mount stale while `ok:true`). Revisit only after NYX is proven, and even then
  lean toward WITHHOLD-on-disagreement over actively re-matching on the mount.
- **Do NOT build on `fix/m101-naming-match`.** Separate concern, separate branch.

---

## Rollout sequence (proposed)
1. v1 = steps 1 (detect) + 3 (log) only. Ship after the M101 fix is deployed and
   settled. Behavior-neutral: names exactly as today; just records the signal.
2. Collect ≥1 real night of `astrometryFrozen` / timestamp-advance data. Confirm
   the detector fires on genuine frozen stacks and does NOT false-positive on a
   correctly re-solving stack (a stationary but freshly-re-solved target could in
   principle repeat coordinates — validate the ≥3-frame + ≥60s guard against real
   data).
3. Only then v2 = step 2 (withhold naming when frozen). Behavior change, gated on
   the data.
4. NYX-as-source stays shelved pending its own reliability work.

---

## SmartEye-dev conversation (external)
Ask whether "New Observation" forces a FRESH plate-solve or can serve a CACHED
one, AND what `astrometryTimestamp` semantics are (does it tick per solve
attempt?). Tonight's frozen `timestamp=7` across advancing integration is the
hard evidence: if it's meant to force a fresh solve, a pinned timestamp is a
device-contract violation to report; if it can serve cached, then
`astrometryState:"solved"` is semantically misleading and the timestamp is the
only client-side falsifier. Either way we route around it with the detector
above; the answer just tells us whether it's ALSO a SmartEye bug to file.
