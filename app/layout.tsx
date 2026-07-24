import type { Metadata } from 'next'
import Script from 'next/script'
import { ConsentedAnalytics } from './ConsentedAnalytics'
import './globals.css'
import './cookie-consent.css'

export const metadata: Metadata = {
  title: {
    default: 'Stargazing Events — Premium Stargazing Experiences in Greece',
    template: '%s | Stargazing Events',
  },
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
        <link rel="preconnect" href="https://www.googletagmanager.com" />
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
