import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import LiveView from '../live/LiveView'
import { debugSecret, verifyDebugCookie, DEBUG_COOKIE_NAME } from '@/lib/debug-auth'
import { DebugUnauthorized } from './DebugUnauthorized'
import '../live/styles.css'
import './debug.css'

// Same self-hosted display/rim faces as /live so the debug view is visually
// identical to the guest live view it mirrors (see app/live/page.tsx).
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display',
  display: 'swap',
})
const inter = Inter({
  subsets: ['latin'],
  weight: ['300'],
  variable: '--font-rim',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Live · debug',
  // Never indexed — private operator surface. referrer: no-referrer keeps the
  // debug URL (and, defensively, any earlier token in history) out of the
  // Referer header on any outbound navigation from this page.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// Must be dynamic: authorization is per-request (the cookie), and the view it
// renders shows live state. A static render would be both wrong and unsafe.
export const dynamic = 'force-dynamic'

// Private operator debug view: the SAME LiveView the guests see, but pointed at
// /api/status?debug=1 (which, for an authorized caller, bypasses the "finish
// night" farewell and returns the real feed plus raw diagnostic fields — see
// app/api/status/route.ts) and rendered in debugMode (which adds the overlay —
// see LiveView / DebugOverlay). Guest /live is completely untouched by any of
// this.
//
// Authorization is the sg_debug cookie minted by /live-debug/auth (see that
// route). We re-validate it HERE too — not just trust its presence — by
// recomputing the expected hex from the current secret, so a stale cookie left
// over after the token was rotated no longer renders the view. The page's
// /api/status?debug=1 polls carry the same cookie and are independently
// re-checked server-side there, so this page-level gate is the UX layer, not
// the security boundary.
export default function LiveDebugPage() {
  const secret = debugSecret()
  const cookie = cookies().get(DEBUG_COOKIE_NAME)?.value
  // Verify signature AND embedded expiry (see verifyDebugCookie) — a stale or
  // forged cookie fails here, so an expired cookie shows DebugUnauthorized, not
  // the feed. This page gate is the UX layer; /api/status?debug=1 re-checks the
  // same cookie server-side and is the actual security boundary.
  const authorized = secret !== undefined && verifyDebugCookie(cookie, secret, Date.now())

  if (!authorized) {
    return (
      <div className={`${cormorant.variable} ${inter.variable}`}>
        <DebugUnauthorized configured={secret !== undefined} />
      </div>
    )
  }

  return (
    <div className={`${cormorant.variable} ${inter.variable}`}>
      <LiveView statusUrl="/api/status?debug=1" debugMode />
    </div>
  )
}
