import type { Metadata } from 'next'
import Script from 'next/script'
import { ConsentedAnalytics } from './ConsentedAnalytics'
import './globals.css'
import './cookie-consent.css'

export const metadata: Metadata = {
  title: {
    default: 'Stargazing Events — Telescope Stargazing on Kos, Greece',
    template: '%s | Stargazing Events',
  },
  // Site-wide fallback description for any page without its own. The homepage
  // and key pages override this; it exists so no page ships description-less.
  description:
    'Live telescope stargazing on Kos and across the Greek islands — planets, galaxies and nebulae with an expert guide, under the Aegean’s darkest skies.',
  authors: [{ name: 'Michalis Reisis' }],
  icons: {
    icon: [
      { url: '/images/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/images/favicon-64x64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: { url: '/images/favicon-180x180.png', sizes: '180x180' },
    shortcut: '/images/favicon-32x32.png',
    other: { rel: 'icon', url: '/favicon.ico', sizes: 'any' },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://formspree.io" />
        {/* No googletagmanager preconnect: a preconnect opens a connection to
            Google before any consent, breaking the "zero third-party contact
            before consent" posture. GA is loaded (with its own connection) only
            after the guest accepts — see loadGoogleAnalytics in
            public/cookie-consent.js — so the pre-warmed socket saved nothing
            for a non-consenting guest and leaked contact for everyone. */}
      </head>
      <body>
        {children}
        {/* Vercel Analytics + Speed Insights, gated behind stored analytics
            consent (see ConsentedAnalytics / lib/consent.ts). Previously mounted
            unconditionally here, which reported on every route before consent. */}
        <ConsentedAnalytics />
        <Script src="/cookie-consent.js" strategy="afterInteractive" />
      </body>
    </html>
  )
}
