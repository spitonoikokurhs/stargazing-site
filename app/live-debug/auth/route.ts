import { NextRequest, NextResponse } from 'next/server'
import { debugSecret, tokenMatches, debugCookieValue, DEBUG_COOKIE_NAME } from '@/lib/debug-auth'

// Node runtime: debug-auth uses crypto (createHash / timingSafeEqual).
export const runtime = 'nodejs'
// Never statically rendered — this validates a per-request token and mints a
// cookie; a cached render would be meaningless (and dangerous).
export const dynamic = 'force-dynamic'

// Cookie bootstrap for the private /live-debug operator view.
//
//   GET /live-debug/auth?token=<VIEWER_STATS_TOKEN or INGEST_SECRET>
//     -> validate (constant-time)
//     -> Set-Cookie: sg_debug=<sha256 hex of secret>  (HttpOnly, Secure,
//        SameSite=Strict, ~12h)
//     -> 302 redirect to /live-debug  (NO token in the destination URL)
//
// The operator visits this URL ONCE (from a bookmark/QR), and thereafter uses
// the clean /live-debug URL. The token therefore never sits in browser
// history, screenshots, referrers, or server logs for the page itself — only
// this single bootstrap request's query string ever carries it, and the
// redirect immediately replaces the address bar with the tokenless URL.
//
// The cookie's VALUE is the sha256 hex of the secret, never the secret itself
// (see debugCookieValue) — so even an HttpOnly cookie leak can't be replayed
// as a Bearer token against the raw-token debug endpoints.
export async function GET(req: NextRequest) {
  const secret = debugSecret()
  const token = req.nextUrl.searchParams.get('token')

  // Wrong/missing token, or no secret configured: send them to /live-debug
  // WITHOUT setting a cookie. The page itself renders the unauthorized notice
  // (one place owns that copy), and we deliberately do NOT echo back whether
  // the token was wrong vs. absent vs. server-misconfigured.
  const dest = new URL('/live-debug', req.nextUrl.origin)
  if (!secret || !token || !tokenMatches(token, secret)) {
    if (!secret) console.error('/live-debug/auth: no secret configured (VIEWER_STATS_TOKEN or INGEST_SECRET)')
    else console.warn(`/live-debug/auth: token rejected at ${new Date().toISOString()}`)
    const res = NextResponse.redirect(dest, { status: 302 })
    res.headers.set('Referrer-Policy', 'no-referrer')
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  const res = NextResponse.redirect(dest, { status: 302 })
  res.cookies.set(DEBUG_COOKIE_NAME, debugCookieValue(secret), {
    httpOnly: true,
    // Secure in production; omitted in dev so localhost (http) can set it.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    // ~12h — long enough for a night at the venue plus the debugging tail,
    // short enough that a forgotten open tab doesn't stay authed indefinitely.
    maxAge: 60 * 60 * 12,
  })
  // The token was in THIS request's query string; make sure it can't leak via
  // a referrer on the redirect, and never cache the Set-Cookie response.
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Cache-Control', 'no-store')
  return res
}
