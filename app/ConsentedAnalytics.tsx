'use client'

import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { hasAnalyticsConsent, CONSENT_CHANGED_EVENT } from '@/lib/consent'

// Gates Vercel Analytics + Speed Insights behind stored analytics consent.
// Previously both were mounted unconditionally in the root layout, so they
// reported page views / performance / device data on EVERY route — including
// the immersive /live* routes where the banner is suppressed — before any
// consent. That made "nothing is collected without consent" false and broke the
// compliance basis for suppressing the banner there (see lib/consent.ts).
//
// Now they mount ONLY when the guest has accepted:
//   - On first render we read the stored choice (hasAnalyticsConsent). If
//     already accepted (e.g. accepted earlier on the homepage — the choice is
//     site-wide localStorage), analytics runs immediately, same as before.
//   - If not yet accepted, nothing mounts. When the guest later accepts,
//     cookie-consent.js dispatches CONSENT_GRANTED_EVENT and we flip on without
//     a page reload.
//
// Rejecting, or never choosing, leaves analytics unmounted — the safe default.
// This is intentionally global (every route), not /live-only: the pre-consent
// firing was site-wide, so the correct fix is site-wide. It only ever makes the
// site collect LESS without consent, never more.
//
// WITHDRAWAL is as effective as granting (ePrivacy 5(3)): we listen for the
// general consent-change event and RE-READ the stored state on every change, so
// accept mounts these and a later reject UNMOUNTS them — both without a reload.
export function ConsentedAnalytics() {
  const [consented, setConsented] = useState(false)

  useEffect(() => {
    // Re-read the authoritative stored state on mount AND on every change, so
    // this reflects the current choice in both directions (grant → true,
    // withdraw → false). React unmounts <Analytics/>/<SpeedInsights/> when this
    // flips back to false.
    const sync = () => setConsented(hasAnalyticsConsent())
    sync()
    window.addEventListener(CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, sync)
  }, [])

  if (!consented) return null
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  )
}
