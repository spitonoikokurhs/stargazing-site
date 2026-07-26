// Client-side transport for Tier-1 interaction beacons. Fire-and-forget by
// design: nothing here is ever awaited by a render path, and every call is
// wrapped so a failure (offline, blocked beacon, missing API) is a silent no-op
// — a guest's experience must never depend on a tally landing.
//
// This is the ONLY place the client emits interaction events. It sends exactly
// { key, objectId? } to POST /api/track; it attaches NO identifier (Tier-1 is
// identifier-free — see app/api/track/route.ts). Tier-2 (consented viewerId)
// would be layered here later, gated on hasAnalyticsConsent(); it is not sent today.

import { type InteractionKey } from '@/lib/interaction-events'

// Builds '/api/track' or '/api/track?event=<slug>' so the beacon lands in the
// same server-resolved event window the page is viewing. The slug is derived
// from the page's statusUrl (see deriveEventSlug), never guessed.
function trackUrl(eventSlug: string | null): string {
  return eventSlug ? `/api/track?event=${encodeURIComponent(eventSlug)}` : '/api/track'
}

// The per-page tracking context, computed once in LiveView and threaded down to
// every hook point. `enabled` is FALSE for demo (/api/demo-status — analytics-
// inert by contract) and debug (operator-only) pages, so those never emit a
// single beacon; TRUE only on the real guest paths (/api/status[?event=]).
export type TrackingContext = { enabled: boolean; eventSlug: string | null }

// Derive the tracking context from a LiveView statusUrl + debugMode. Real guest
// paths are exactly the ones served by /api/status (the hotel path and the
// ?event= special-event path); everything else (demo's /api/demo-status, any
// future feed) is excluded. debugMode (the operator /live-debug view) is always
// excluded regardless of URL.
//
// localDemoMode: /live also has its OWN query-param test mode (?demo=known-nebula
// / history-test / … — see getDemoMode in app/live/LiveView.tsx) that synthesizes
// status bodies WITHOUT changing statusUrl — so the URL gate alone can't see it.
// The caller passes that mode here and any non-null value kills tracking:
// operator test runs on /live?demo=… must never pollute a real night's counters
// (the exact pollution class event-window attribution exists to prevent). Null on
// SSR (getDemoMode is window-guarded) is fine — the context is only consumed by
// client-side handlers/effects, never rendered, so no hydration concern.
export function trackingContextFor(
  statusUrl: string,
  debugMode: boolean,
  localDemoMode: string | null = null,
): TrackingContext {
  const isGuestStatus = statusUrl === '/api/status' || statusUrl.startsWith('/api/status?')
  const enabled = !debugMode && localDemoMode === null && isGuestStatus
  return { enabled, eventSlug: enabled ? deriveEventSlug(statusUrl) : null }
}

// Context-aware emit: a no-op unless ctx.enabled, otherwise trackInteraction
// with the context's eventSlug. This is what the hook points call, so the
// demo/debug suppression lives in ONE place (the context) and can't be
// forgotten at a callsite.
export function track(
  ctx: TrackingContext | null | undefined,
  key: InteractionKey,
  objectId?: string | null,
): void {
  if (!ctx || !ctx.enabled) return
  trackInteraction(key, { objectId: objectId ?? null, eventSlug: ctx.eventSlug })
}

// Extract the special-event slug from a LiveView statusUrl (e.g.
// '/api/status?event=parnonas' -> 'parnonas'); null for the normal hotel path
// or a demo/debug URL. Pure string parsing, no I/O.
export function deriveEventSlug(statusUrl: string): string | null {
  const q = statusUrl.indexOf('?')
  if (q === -1) return null
  try {
    const params = new URLSearchParams(statusUrl.slice(q + 1))
    const slug = params.get('event')
    return slug && slug.length > 0 ? slug : null
  } catch {
    return null
  }
}

// Emit one interaction beacon. Never throws, never blocks. Prefers
// navigator.sendBeacon (survives page unload — important for a farewell/close),
// falling back to fetch with keepalive, then silently giving up.
export function trackInteraction(
  key: InteractionKey,
  opts?: { objectId?: string | null; eventSlug?: string | null },
): void {
  // SSR / non-browser guard — the transport is client-only.
  if (typeof window === 'undefined') return

  const body = JSON.stringify(
    opts?.objectId ? { key, objectId: opts.objectId } : { key },
  )
  const url = trackUrl(opts?.eventSlug ?? null)

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // Blob with an explicit JSON type so the endpoint's req.json() parses it;
      // a bare string beacon posts as text/plain which some parsers reject.
      const blob = new Blob([body], { type: 'application/json' })
      const ok = navigator.sendBeacon(url, blob)
      if (ok) return
      // sendBeacon returns false if the payload was refused (e.g. queue full) —
      // fall through to the fetch path rather than dropping silently.
    }
  } catch {
    // fall through to fetch
  }

  try {
    // keepalive lets the request outlive the page (same reason as sendBeacon).
    // Fully detached: we neither await nor inspect the response.
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      // No credentials — this endpoint neither reads nor sets cookies, and we
      // want nothing identifying ridealong on the request.
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    // give up silently — a lost tally is a non-event
  }
}
