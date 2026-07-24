// Single source of truth for the analytics-consent gate, shared by every
// TypeScript/React surface that must NOT run non-essential analytics before a
// guest has opted in. The authoritative writer is public/cookie-consent.js
// (Google Consent Mode + the banner); this module only READS the same
// localStorage key it writes, so the two can never disagree about what
// "consented" means.
//
// Why this matters (ePrivacy Art. 5(3)): storing a viewer id, loading Vercel
// Analytics, or loading Speed Insights are all NON-essential
// storage/processing that require prior consent. Temporary storage
// (sessionStorage) is not exempt. So each of those surfaces gates on
// hasAnalyticsConsent() and does nothing until the stored choice is
// "accepted" — including on the immersive /live* routes where the banner is
// suppressed (see isImmersivePath in cookie-consent.js): suppressing the
// PROMPT there is only compliant because nothing is collected there either.

// Must match STORAGE_KEY in public/cookie-consent.js exactly.
export const CONSENT_STORAGE_KEY = 'stargazing_cookie_consent_v1'
export const CONSENT_ACCEPTED_VALUE = 'accepted'

// Event dispatched by cookie-consent.js's grantConsent() the moment a guest
// accepts, so components that gate on consent (see ConsentedAnalytics) can
// start WITHOUT a page reload. Rejecting/again-visiting needs no event: those
// paths simply never mount analytics.
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
