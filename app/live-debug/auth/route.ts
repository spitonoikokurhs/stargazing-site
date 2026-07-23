import { NextRequest, NextResponse } from 'next/server'
import { debugSecret, tokenMatches, mintDebugCookie, DEBUG_COOKIE_NAME, DEBUG_COOKIE_TTL_MS } from '@/lib/debug-auth'

// Node runtime: debug-auth uses crypto (createHmac / timingSafeEqual).
export const runtime = 'nodejs'
// Never statically rendered — this validates a per-request token and mints a
// cookie; a cached render would be meaningless (and dangerous).
export const dynamic = 'force-dynamic'

// Cookie bootstrap for the private /live-debug operator view.
//
//   GET /live-debug/auth?token=<DEBUG_VIEW_TOKEN>
//     -> validate (constant-time)
//     -> Set-Cookie: sg_debug=<expiry>.<hmac>  (HttpOnly, Secure,
//        SameSite=Strict, 12h)
//     -> 302 redirect to /live-debug  (NO token in the destination URL)
//
// The operator visits this URL ONCE (from a bookmark/QR), and thereafter uses
// the clean /live-debug URL. The token therefore never sits in browser
// history, screenshots, referrers, or server logs for the page itself — only
// this single bootstrap request's query string ever carries it, and the
// redirect immediately replaces the address bar with the tokenless URL.
//
// SECURITY: this accepts ONLY the dedicated read-only DEBUG_VIEW_TOKEN (or its
// VIEWER_STATS_TOKEN alias) — NEVER the write-capable INGEST_SECRET (see
// debugSecret). If no debug secret is configured it FAILS CLOSED: no cookie,
// straight to the locked page. The cookie is a signed value with an embedded,
// server-verified expiry (see mintDebugCookie / verifyDebugCookie) — it holds
// no raw token and genuinely stops working at expiry, not merely when the
// browser feels like discarding it.
export async function GET(req: NextRequest) {
  const secret = debugSecret()
  const token = req.nextUrl.searchParams.get('token')

  // Wrong/missing token, or no debug secret configured: send them to
  // /live-debug WITHOUT setting a cookie. The page itself renders the
  // unauthorized notice (one place owns that copy), and we deliberately do NOT
  // echo back whether the token was wrong vs. absent vs. server-misconfigured.
  const dest = new URL('/live-debug', req.nextUrl.origin)
  if (!secret || !token || !tokenMatches(token, secret)) {
    if (!secret) console.error('/live-debug/auth: no debug secret configured (set DEBUG_VIEW_TOKEN)')
    else console.warn(`/live-debug/auth: token rejected at ${new Date().toISOString()}`)
    const res = NextResponse.redirect(dest, { status: 302 })
    res.headers.set('Referrer-Policy', 'no-referrer')
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  const res = NextResponse.redirect(dest, { status: 302 })
  res.cookies.set(DEBUG_COOKIE_NAME, mintDebugCookie(secret, Date.now()), {
    httpOnly: true,
    // Secure in production; omitted in dev so localhost (http) can set it.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    // Browser-side hint only; the REAL expiry is the signed value inside the
    // cookie (verifyDebugCookie enforces it server-side). Kept in sync with the
    // embedded TTL so the two agree.
    maxAge: Math.floor(DEBUG_COOKIE_TTL_MS / 1000),
  })
  // The token was in THIS request's query string; make sure it can't leak via
  // a referrer on the redirect, and never cache the Set-Cookie response.
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Cache-Control', 'no-store')
  return res
}
