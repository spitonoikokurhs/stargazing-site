import type { Metadata } from 'next'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import LiveView from '../../live/LiveView'
import { resolveDemoSlug } from '@/lib/demo-event'
import '../../live/styles.css'

// Same self-hosted display/rim faces as /live so the demo is pixel-identical to
// a real event (see app/live/page.tsx).
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
  title: 'Live demo',
  // Sales tool, not public content — never indexed.
  robots: { index: false, follow: false },
}

// Depends on the current instant (the loop position) — must not be statically
// generated.
export const dynamic = 'force-dynamic'

// Self-running simulated event for in-person hotel pitches. Renders the SAME
// LiveView the real /live uses, pointed at /api/demo-status (a read-only,
// stateless, analytics-inert feed — see that route). No LiveView changes, no
// guest-path risk. An unknown slug resolves to 'generic' ("Your Hotel"), never
// a broken page. The optional ?stage= (starting | 1..N) is threaded to the
// endpoint so a presenter can jump the loop.
export default function DemoPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { stage?: string }
}) {
  const slug = resolveDemoSlug(params.slug)
  const stage = typeof searchParams.stage === 'string' ? searchParams.stage : null

  const statusUrl = `/api/demo-status?demo=${encodeURIComponent(slug)}${
    stage ? `&stage=${encodeURIComponent(stage)}` : ''
  }`

  return (
    <div className={`${cormorant.variable} ${inter.variable}`} data-demo="1">
      <LiveView statusUrl={statusUrl} />
    </div>
  )
}
