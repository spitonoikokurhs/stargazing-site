# /live-debug — relay diagnostic field contract (CONFIRMED)

**Status: resolved.** These field names/types were verified against the relay
source at `feat/stale-solve-detector @ 8e8eb9a`. This is the reference for the
debug overlay's diagnostic fields — not an open TODO. Nothing here is pending.

The debug overlay forwards the relay's stale-solve / coord-source detector
fields end-to-end through four strip points that ALL must use the exact same key
or the field reads "not sent" forever. If the relay ever renames or adds a
field, update all four together:

1. `app/api/ingest/route.ts` — the telemetry allowlist (Redis write, ~step 7b)
2. `lib/redis.ts` — `LatestFrameTelemetry` type + `parseLatestFrame` validation
3. `lib/debug-fields.ts` — `buildDebugFields` passthrough key list
4. `app/live/LiveView.tsx` — `DebugFields` type + `DebugOverlay` render

## Solve / coord-source fields

| key                     | type                    |
|-------------------------|-------------------------|
| `astrometrySuspect`     | boolean or null         |
| `solveTiming`           | string classification   |
| `solveTimingReason`     | string                  |
| `newObservation`        | boolean                 |
| `coordSourceDeltaDeg`   | number                  |
| `coordSourcesDisagree`  | boolean                 |

`solveTiming` is a **string classification** (e.g. `changed_while_accum_high`),
NOT a duration — the overlay renders it verbatim, with no unit suffix.

## Mount fields

| key                        | type            |
|----------------------------|-----------------|
| `mountRaDegrees`           | number or null  |
| `mountDecDegrees`          | number or null  |
| `mountTelemetryOk`         | boolean         |
| `mountSlewing`             | boolean or null |
| `mountTelemetryAgeSeconds` | number or null  |

Nullable fields preserve `null` through the parser, so the overlay can
distinguish "sent, but no current reading" (`null`) from "older relay never sent
this field at all" (absent → renders "not sent").

## Additive-by-design

Every field above is OPTIONAL at every strip point. A frame that omits any or
all of them (relay `master`, a Tier-1-only frame, an older detector build)
ingests and renders exactly as before — the field is simply absent from the
debug payload and the overlay shows "not sent". Nothing here rejects a frame or
alters existing-field behaviour.
