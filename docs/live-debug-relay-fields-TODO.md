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
| `astrometrySolveSuspect`| boolean |
| `solveTiming`           | number  |
| `solveTimingReason`     | string  |
| `newObservation`        | boolean |
| `coordSourceDeltaDeg`   | number  |
| `coordSourcesDisagree`  | boolean |

## PENDING relay-dev confirmation — mount coordinates

Currently wired under **assumed** names:

| assumed key        | type    |
|--------------------|---------|
| `mountRaDegrees`   | number  |
| `mountDecDegrees`  | number  |
| `mountTelemetryOk` | boolean |

**Action:** confirm against `feat/stale-solve-detector @ 8e8eb9a` what the relay
actually emits in the `metadata` object for mount coordinates. If the names
differ (e.g. `mountRa`/`mountDec`, or a nested `mount: {ra, dec, ok}` object),
update all four strip points above to match. Until confirmed, these three read
"not sent" in the overlay even when the relay is sending mount data.

Also confirm `solveTiming` units (ms vs. s) for the overlay label — it currently
renders `${solveTiming}ms`.
