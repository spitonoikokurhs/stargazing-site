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
