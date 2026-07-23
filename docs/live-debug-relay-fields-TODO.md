# /live-debug — relay field names to confirm

The debug overlay forwards the relay's stale-solve / coord-source detector
fields end-to-end through three strip points that ALL must use the exact same
key or the field reads "not sent" forever:

1. `app/api/ingest/route.ts` — the telemetry allowlist (~step 7b, Redis write)
2. `lib/redis.ts` — `LatestFrameTelemetry` type + `parseLatestFrame` validation
3. `app/api/status/route.ts` — `buildDebugFields` (`copyIfSet` calls)
4. `app/live/LiveView.tsx` — `DebugFields` type + `DebugOverlay` render

## Confirmed (names taken from the code review; treat as authoritative)

These six are wired under these exact keys:

| key                     | type    |
|-------------------------|---------|
| `astrometrySuspect`     | boolean or null |
| `solveTiming`           | string classification |
| `solveTimingReason`     | string  |
| `newObservation`        | boolean |
| `coordSourceDeltaDeg`   | number  |
| `coordSourcesDisagree`  | boolean |

## CONFIRMED against relay @ 8e8eb9a — mount coordinates

Confirmed against `feat/stale-solve-detector @ 8e8eb9a`:

| confirmed key      | type    |
|--------------------|---------|
| `mountRaDegrees`   | number  |
| `mountDecDegrees`  | number  |
| `mountTelemetryOk` | boolean |
| `mountSlewing`     | boolean or null |
| `mountTelemetryAgeSeconds` | number or null |

`solveTiming` is a string classification, not a duration; the overlay renders it without a unit suffix.