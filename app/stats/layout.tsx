import type { Metadata } from 'next'

// The /stats operator page is private: never indexed, never followed. The page
// itself is a client component (token entry, live fetch) so it can't export
// metadata — this thin server layout carries the robots directive for the route.
export const metadata: Metadata = {
  title: 'Interaction stats',
  robots: { index: false, follow: false, nocache: true },
}

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children
}
