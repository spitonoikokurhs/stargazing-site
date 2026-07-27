// Single source of truth for the analytics-consent gate, shared by every
// TypeScript/React surface that must NOT run non-essential analytics before a
// guest has opted in. The authoritative writer is public/cookie-consent.js
// (Google Consent Mode + the banner); this module only READS the same
// localStorage key it writes, so the two can never disagree about what
// "consented" means. The test scripts/test-consent-parity.mjs asserts the
// duplicated literal strings below match the JS, so a rename can't silently
// desync the two files.
//
// Why this matters (ePrivacy Art. 5(3)): storing a viewer id, loading Vercel
// Analytics, or loading Speed Insights are all NON-essential
// storage/processing that require prior consent. Temporary storage
// (sessionStorage) is not exempt. Withdrawal must be exactly as effective as
// granting — so consent is re-read on every change, and withdrawing tears the
// same things down that granting brought up.

// Must match STORAGE_KEY in public/cookie-consent.js exactly.
export const CONSENT_STORAGE_KEY = 'stargazing_cookie_consent_v1'
export const CONSENT_ACCEPTED_VALUE = 'accepted'

// The per-tab viewer id key (analytics). Shared here so getStoredViewerId /
// clearStoredViewerId and LiveView all agree on it.
export const VIEWER_ID_STORAGE_KEY = 'stargazing:viewerId'

// Dispatched by cookie-consent.js on EVERY consent change — both accept AND
// reject (and re-choosing via Privacy Settings). Consumers re-read the stored
// state and react in BOTH directions: grant → mount/attach, withdraw →
// unmount/detach, with no page reload. Must match the string dispatched in
// public/cookie-consent.js.
export const CONSENT_CHANGED_EVENT = 'stargazing-consent-changed'

// Back-compat alias: the earlier grant-only event name. cookie-consent.js still
// fires this on accept so anything that listened for it keeps working, but new
// code should listen for CONSENT_CHANGED_EVENT (fires on withdrawal too).
export const CONSENT_GRANTED_EVENT = 'stargazing-consent-granted'

// True only when the guest has explicitly accepted. Any other state — no
// choice yet, "rejected", storage disabled/unavailable, or SSR (no window) —
// is treated as NOT consented, the safe default. Never throws.
export function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY) === CONSENT_ACCEPTED_VALUE
  } catch {
    return false
  }
}

// ---- Viewer-ID gate (the /live analytics identifier) ----
// Extracted here (out of LiveView) so it is unit-testable directly rather than
// mirrored in a test. All three operations are consent-aware and never throw.

// The consented viewer id for this tab: null unless consent is currently
// granted. When granted, returns the existing per-tab id or mints+stores a new
// one. The consent check happens BEFORE any storage write, so no id is ever
// created or persisted without consent.
export function getOrCreateViewerId(): string | null {
  if (typeof window === 'undefined') return null
  if (!hasAnalyticsConsent()) return null
  try {
    const existing = window.sessionStorage.getItem(VIEWER_ID_STORAGE_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    window.sessionStorage.setItem(VIEWER_ID_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Private-browsing / storage-disabled: analytics quietly loses this guest,
    // never a crash — the page must keep working regardless.
    return null
  }
}

// Read the stored viewer id WITHOUT creating one, and only if consent is still
// granted. Used by the poll loop to re-check on every request, so a withdrawal
// mid-session stops transmission on the very next poll.
export function getConsentedViewerId(): string | null {
  if (typeof window === 'undefined') return null
  if (!hasAnalyticsConsent()) return null
  try {
    return window.sessionStorage.getItem(VIEWER_ID_STORAGE_KEY)
  } catch {
    return null
  }
}

// Remove the stored viewer id. Called on consent withdrawal so the identifier
// is not merely un-sent but actually erased from storage. Never throws.
export function clearStoredViewerId(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(VIEWER_ID_STORAGE_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

// ---- Consent-free ephemeral viewer id (the QR-guest counting fix) ----
//
// WHY THIS EXISTS: guests scan a QR straight onto /live, where the consent
// banner is suppressed (so it can't cover the farewell). They are therefore
// never offered consent, so getConsentedViewerId/getOrCreateViewerId return
// null and trackViewer skips them — the real audience is uncountable. This
// gives the counter an id that needs NO consent, on the same footing as the
// Tier-1 interaction counters, so unique + peak reflect the actual live
// audience for the operator's own estimate.
//
// ============================================================================
// IDENTIFIER-FREE / ePrivacy Art. 5(3) — the end-to-end proof.
//
// WHAT is stored:  a single random UUID (crypto.randomUUID()).
// WHERE it lives:  a module-scope JS variable in the page's memory ONLY
//                  (`ephemeralViewerId` below). It is NEVER written to
//                  localStorage, sessionStorage, a cookie, IndexedDB, cache,
//                  window.name, or any other browser-persisted store.
// HOW LONG:        the lifetime of the page (one document). A tab close, a
//                  reload, or a cross-page navigation discards it and the next
//                  page load mints a brand-new one. It cannot outlive the
//                  document and cannot be read back on a later visit.
// WHY it's used:   solely to de-duplicate a LIVE audience count server-side
//                  (added to a 48h-TTL, per-event Redis set for unique, and a
//                  60s active window for peak) — never to recognise the guest,
//                  never joined to anything personal, never returned to the
//                  client, never logged as identity.
//
// WHY Art. 5(3) IS NOT TRIGGERED: 5(3) governs STORING information on, or
// ACCESSING information already stored on, the user's terminal equipment.
// This id is never stored on the device (it lives only in volatile page
// memory, exactly like any transient runtime variable) and nothing is ever
// read back from the device — so there is no "storage of or access to
// information" to consent to. Same basis as the Tier-1 interaction beacons.
// Contrast the CONSENTED path above, which DOES write to sessionStorage and so
// (correctly) requires consent.
//
// RELOAD CAVEAT (documented, not hidden): because nothing is persisted, a
// reload of the same tab mints a NEW id. That inflates UNIQUE slightly (a
// reloading guest counts more than once) — the safe, upward direction for an
// audience estimate. It barely affects PEAK CONCURRENT: peak is a 60s active
// window (recordViewerActivity), so the old id ages out within ~60s and the
// reloaded tab replaces rather than adds. There is no zero-storage way to make
// a reloaded tab re-present the same id (that is precisely what persistence
// would buy, and persistence is what triggers 5(3)) — so we accept the small
// upward bias by design rather than store anything to remove it.
// ============================================================================

// The one ephemeral id for this page load. `let` at module scope: created lazily
// on first use, then stable for every subsequent call within the SAME document
// (so React re-renders / re-mounts and same-page route changes reuse it — the id
// only resets on a true page load). Reset to null is impossible without a reload,
// which is the whole point.
let ephemeralViewerId: string | null = null

// Returns the page's ephemeral viewer id, minting it on first call. Prefixed
// so a counter/debugger can tell an ephemeral (consent-free) id apart from a
// consented one at a glance — the prefix carries no information about the
// guest, only about which code path produced the id.
export function getEphemeralViewerId(): string | null {
  if (typeof window === 'undefined') return null
  if (ephemeralViewerId === null) {
    try {
      ephemeralViewerId = `eph-${crypto.randomUUID()}`
    } catch {
      // No crypto (ancient/locked-down engine): skip counting this guest rather
      // than throw. A missing tally is a non-event; the page must keep working.
      return null
    }
  }
  return ephemeralViewerId
}

// TEST-ONLY: reset the module-scope id so a test can assert fresh-mint behaviour
// across simulated page loads. Never called by app code (a real page load is the
// only reset in production). Exported rather than hidden so the test needs no
// module-cache trickery.
export function __resetEphemeralViewerIdForTest(): void {
  ephemeralViewerId = null
}
