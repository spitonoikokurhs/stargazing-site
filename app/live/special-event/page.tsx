import type { Metadata } from 'next'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import { resolveSpecialEvent } from '@/lib/extra-events'
import { EventGate } from './EventGate'
import { NoSpecialEvent } from '../NoSpecialEvent'
import '../styles.css'

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
  title: 'Live',
  // Not linked from site nav; found only via a directly-shared QR code/link —
  // never indexed, same policy as the main /live page.
  robots: { index: false, follow: false },
}

// Must be dynamic, not statically generated: which event this resolves to
// depends on the current instant (see resolveSpecialEvent) — a cached/static
// render would freeze on whichever event was active at build time.
export const dynamic = 'force-dynamic'

// ONE fixed, permanent URL for every special event, present and future — see
// lib/extra-events.ts's resolveSpecialEvent for how "which event" is decided.
// This is the whole point: print one QR code once, and it silently starts
// pointing at whichever event's window is current the next time someone
// scans it, with zero code changes for a new event (just a new
// config/extra-events.json entry).
export default function SpecialEventPage() {
  const resolved = resolveSpecialEvent()

  if (!resolved) {
    return (
      <div className={`${cormorant.variable} ${inter.variable}`}>
        <NoSpecialEvent />
      </div>
    )
  }

  const { slug, event } = resolved
  return (
    <div className={`${cormorant.variable} ${inter.variable}`}>
      <EventGate eventSlug={slug} revealAt={event.revealAt} logoSrc={event.logoSrc} />
    </div>
  )
}
