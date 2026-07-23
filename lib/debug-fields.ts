import { matchCoordinates, nearestCatalogObject } from '@/lib/catalog'
import type { LatestFrame, LatestFrameTelemetry } from '@/lib/redis'

// The extra, raw-input fields the debug overlay renders on top of the normal
// live payload (see app/live/LiveView.tsx's DebugOverlay). Deliberately built
// from the SAME frame + telemetry the guest response already has, PLUS a
// read-time nearestCatalogObject lookup — nothing here is stored or written.
//
// Lives in lib/ (not in the route file) for two reasons: Next forbids a route
// module from exporting anything but its HTTP handlers + segment config, and
// keeping it here lets scripts/test-status-debug-route.mjs import it directly to
// prove the relay-field passthrough (parseLatestFrame -> buildDebugFields)
// end-to-end without mocking Redis/Prisma.
//
// Only ever spread into a response when the caller is debug-authorized (see the
// GET handler), so none of this can ever reach a guest. The relay's stale-solve
// / coord-source fields are forwarded end-to-end (ingest allowlist →
// LatestFrameTelemetry → parseLatestFrame → here); each is copied straight from
// telemetry when present, and left OUT of the payload when absent so the overlay
// renders "not sent" (an older relay / Tier-1 frame). A field only reaches here
// if all three upstream strip points carry it under the SAME key — see the
// ingest allowlist's note on the mount names still pending relay-dev
// confirmation (docs/live-debug-relay-fields-TODO.md).
export function buildDebugFields(frame: LatestFrame): Record<string, unknown> {
  const t = frame.telemetry
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(frame.ingestedAt).getTime()) / 1000))

  const debug: Record<string, unknown> = {
    frameId: frame.frameId,
    sessionId: frame.sessionId,
    observationId: frame.observationId,
    capturedAt: frame.capturedAt,
    ingestedAt: frame.ingestedAt,
    frameAgeSeconds: ageSeconds,
    state: t?.state ?? null,
    astrometryState: t?.astrometryState ?? null,
    totalAccumulatedTime: t?.totalAccumulatedTime ?? null,
    raDegrees: typeof t?.raDegrees === 'number' ? t.raDegrees : null,
    decDegrees: typeof t?.decDegrees === 'number' ? t.decDegrees : null,
  }

  // Relay stale-solve / coord-source passthrough — added ONLY when present, so
  // an absent field is omitted (overlay shows "not sent") rather than sent as a
  // null the overlay would have to disambiguate from a real value. Copying by
  // an explicit key list guarantees every forwarded field uses the exact key
  // the overlay reads, and TypeScript checks each key against the telemetry
  // type.
  if (t) {
    const passthroughKeys: (keyof LatestFrameTelemetry)[] = [
      'astrometrySolveSuspect',
      'solveTiming',
      'solveTimingReason',
      'newObservation',
      'coordSourceDeltaDeg',
      'coordSourcesDisagree',
      'mountRaDegrees',
      'mountDecDegrees',
      'mountTelemetryOk',
    ]
    for (const key of passthroughKeys) {
      if (t[key] !== undefined) debug[key] = t[key]
    }
  }

  // Full match result — the raw confidence + contested-field fact the guest
  // card deliberately hides behind its display policy. Computed the same way
  // resolveObjectMatch does, but WITHOUT the "only when named" gate, so the
  // operator sees the decision even when the guest UI withholds the name.
  if (t?.astrometryState === 'solved' && typeof t.raDegrees === 'number' && typeof t.decDegrees === 'number') {
    const result = matchCoordinates(t.raDegrees, t.decDegrees)
    debug.match = result.match
      ? {
          objectId: result.match.id,
          name: result.match.primaryName,
          type: result.match.type,
          confidence: result.confidence,
          separationDeg: Number(result.separationDeg.toFixed(4)),
          hasInRangeRunnerUp: result.hasInRangeRunnerUp,
        }
      : { objectId: null, confidence: result.confidence, hasInRangeRunnerUp: result.hasInRangeRunnerUp }

    // Nearest catalog object under TODAY's radii — the tuning signal (a
    // fractionOfRadius just over 1.0 is a near-miss a slightly wider radius
    // would capture). Same read-time enrichment /api/debug/match-decisions
    // does for fallback rows.
    const nearest = nearestCatalogObject(t.raDegrees, t.decDegrees)
    if (nearest) {
      debug.nearest = {
        objectId: nearest.objectId,
        separationDeg: Number(nearest.separationDeg.toFixed(4)),
        displayRadiusDeg: Number(nearest.displayRadiusDeg.toFixed(4)),
        fractionOfRadius: Number(nearest.fractionOfRadius.toFixed(3)),
      }
    }
  }

  return debug
}
