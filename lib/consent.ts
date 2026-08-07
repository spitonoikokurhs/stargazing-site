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
// storage/processing that, under the strict reading this module takes, require
// prior consent — temporary storage (sessionStorage) is not automatically
// exempt. Withdrawal must be exactly as effective as granting — so consent is
// re-read on every change, and withdrawing tears the same things down that
// granting brought up.
//
// ONE DELIBERATE EXCEPTION: the session-only, consent-free audience count id
// (getEphemeralViewerId, further down). It stores a single auto-erased,
// non-identifying value in sessionStorage purely to stop a reloading phone
// from inflating the "unique viewers" count, and is DISCLOSED on the privacy
// page. See its doc comment for the full, honest rationale.

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

// The sessionStorage key for the consent-free count id. Distinct from
// VIEWER_ID_STORAGE_KEY (the CONSENTED id) so the two never collide and a
// consent withdrawal that clears the consented key can't wipe the count id and
// vice-versa. `eph` in the key name mirrors the value's `eph-` prefix.
export const EPHEMERAL_VIEWER_ID_STORAGE_KEY = 'stargazing:ephViewerId'

// ---- Session-only ephemeral viewer id (the QR-guest counting fix) ----
//
// WHY THIS EXISTS: guests scan a QR straight onto /live, where the consent
// banner is suppressed (so it can't cover the farewell). They are therefore
// never offered consent, so getConsentedViewerId/getOrCreateViewerId return
// null and trackViewer skips them — the real audience would be uncountable.
// This gives the counter an id so unique + peak reflect the actual live
// audience for the operator's own estimate.
//
// ============================================================================
// ePrivacy Art. 5(3) — the deliberate stance (updated 2026-08-07).
//
// WHAT is stored:  a single random UUID, `eph-<uuid>`.
// WHERE it lives:  the browser's sessionStorage (per TAB, per browser),
//                  under EPHEMERAL_VIEWER_ID_STORAGE_KEY. A module-scope
//                  variable caches it in-memory so repeated calls in one page
//                  don't re-hit storage, but sessionStorage is the source of
//                  truth so the id SURVIVES A RELOAD within the same tab.
// HOW LONG:        the tab session. sessionStorage is wiped when the tab
//                  closes; it can NOT be read on a later visit / new tab, so
//                  there is no cross-night or cross-session recognition. A
//                  reload REUSES the id (this is the whole point — see below).
// WHY it's used:   solely to de-duplicate a LIVE audience count server-side
//                  (added to a 48h-TTL, per-event Redis set for unique, and a
//                  60s active window for peak) — never to recognise the guest,
//                  never joined to anything personal, never returned to the
//                  client, never logged as identity.
//
// THE STANCE, STATED HONESTLY: Art. 5(3) governs storing information on the
// user's device, and the strict reading — which the CONSENTED path above and
// this module's header comment both take — is that even sessionStorage for
// non-essential analytics is in scope. This count id is a DELIBERATE, narrowly
// scoped exception the operator chose knowingly: it stores one session-only,
// auto-erased, non-identifying value purely to stop a reloading phone from
// being counted as many "unique" viewers. The privacy page already discloses
// exactly this ("a random value ... stored in your browser's session storage
// (not a cookie, and not localStorage) ... automatically discarded when you
// close the tab"), so the storage is DISCLOSED, which is what keeps it clean.
// The previous implementation kept this id in volatile memory only to sidestep
// 5(3) entirely; that made UNIQUE over-count badly (every reload = a new id),
// which defeated the metric. We accept the stricter-reading exposure in
// exchange for a number that means what it says.
//
// FAILURE MODE: if sessionStorage is unavailable (private mode / disabled), we
// fall back to the in-memory cache for this page load — same as before — so a
// guest is still counted, just not reload-stable. Never throws.
// ============================================================================

// In-memory cache of the count id for this page load, so repeated calls don't
// re-read sessionStorage. sessionStorage remains the source of truth (survives
// reload); this is only a within-page fast path and the storage fallback.
let ephemeralViewerId: string | null = null

// Returns the guest's session-only count id, minting it on first call and
// persisting it to sessionStorage so a reload reuses it (the reload-recount
// fix). Prefixed `eph-` so a debugger can tell a count id apart from a
// consented one at a glance — the prefix carries no information about the
// guest, only about which code path produced the id.
export function getEphemeralViewerId(): string | null {
  if (typeof window === 'undefined') return null
  if (ephemeralViewerId !== null) return ephemeralViewerId
  try {
    // Reuse the tab's existing id if this is a reload / a later poll.
    const existing = window.sessionStorage.getItem(EPHEMERAL_VIEWER_ID_STORAGE_KEY)
    if (existing) {
      ephemeralViewerId = existing
      return existing
    }
    const fresh = `eph-${crypto.randomUUID()}`
    window.sessionStorage.setItem(EPHEMERAL_VIEWER_ID_STORAGE_KEY, fresh)
    ephemeralViewerId = fresh
    return fresh
  } catch {
    // sessionStorage unavailable (private mode) OR no crypto: fall back to a
    // pure in-memory id for this page load rather than throw — the guest is
    // still counted, just not reload-stable in that locked-down environment.
    if (ephemeralViewerId === null) {
      try {
        ephemeralViewerId = `eph-${crypto.randomUUID()}`
      } catch {
        return null
      }
    }
    return ephemeralViewerId
  }
}

// TEST-ONLY: reset the module-scope id so a test can assert fresh-mint behaviour
// across simulated page loads. Never called by app code (a real page load is the
// only reset in production). Exported rather than hidden so the test needs no
// module-cache trickery.
export function __resetEphemeralViewerIdForTest(): void {
  ephemeralViewerId = null
}
