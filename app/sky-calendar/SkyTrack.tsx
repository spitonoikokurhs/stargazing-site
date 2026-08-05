'use client'

// Consent-gated, identifier-free interest beacons for /sky-calendar. Fires once
// per page view: which CITY the guest is looking at, and whether they opened
// Full detail. Aggregate counts only — same privacy model as the rest of the
// site (see app/api/track). No cookie, no id; only fires after cookie consent.
//
// The page is server-rendered from the URL, so a page view IS a city selection
// (the city is the ?city= param, defaulted to Kos). This tiny client island is
// the only JS the page ships for tracking; it renders nothing.

import { useEffect } from 'react'
import { hasAnalyticsConsent, CONSENT_GRANTED_EVENT } from '@/lib/consent'
import { trackInteraction } from '@/lib/track-client'

export function SkyTrack({ cityId, fullDetail }: { cityId: string; fullDetail: boolean }) {
  useEffect(() => {
    let sent = false
    const fire = () => {
      if (sent || !hasAnalyticsConsent()) return
      sent = true
      // Which market: city id in the objectId slot (kos/bodrum/…) — the server
      // allowlists sky_city_select as object-scoped, so per-city tallies split.
      trackInteraction('sky_city_select', { objectId: cityId })
      if (fullDetail) trackInteraction('sky_full_detail')
    }
    // Fire now if consent already given; otherwise wait for the grant event so a
    // guest who accepts on this page still gets counted (once).
    if (hasAnalyticsConsent()) {
      fire()
    } else {
      window.addEventListener(CONSENT_GRANTED_EVENT, fire, { once: true })
      return () => window.removeEventListener(CONSENT_GRANTED_EVENT, fire)
    }
  }, [cityId, fullDetail])

  return null
}
