import { NextRequest, NextResponse } from 'next/server'
import { debugSecret, tokenMatches, mintDebugCookie, DEBUG_COOKIE_NAME, DEBUG_COOKIE_TTL_MS } from '@/lib/debug-auth'

// Node runtime: debug-auth uses crypto (createHmac / timingSafeEqual).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cookie bootstrap for the private /season operator calendar — byte-for-byte
// the /live-debug/auth flow (see that route for the full security notes), with
// /season as the destination. Deliberately the SAME token and the SAME signed
// sg_debug cookie: one operator identity unlocks both views, so an existing
// /live-debug bookmark already opens /season and vice versa — this route only
// exists so a direct /season bookmark can bootstrap without a detour.
//
//   GET /season/auth?token=<DEBUG_VIEW_TOKEN>
//     -> validate (constant-time) -> Set-Cookie sg_debug -> 302 /season
export async function GET(req: NextRequest) {
  const secret = debugSecret()
  const token = req.nextUrl.searchParams.get('token')

  const dest = new URL('/season', req.nextUrl.origin)
  if (!secret || !token || !tokenMatches(token, secret)) {
    if (!secret) console.error('/season/auth: no debug secret configured (set DEBUG_VIEW_TOKEN)')
    else console.warn(`/season/auth: token rejected at ${new Date().toISOString()}`)
    const res = NextResponse.redirect(dest, { status: 302 })
    res.headers.set('Referrer-Policy', 'no-referrer')
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  const res = NextResponse.redirect(dest, { status: 302 })
  res.cookies.set(DEBUG_COOKIE_NAME, mintDebugCookie(secret, Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(DEBUG_COOKIE_TTL_MS / 1000),
  })
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Cache-Control', 'no-store')
  return res
}
