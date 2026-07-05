import type { Metadata } from 'next'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import LiveView from './LiveView'
import './styles.css'

// Serif display face for the object name, self-hosted by next/font at build
// time (no runtime CDN dependency, no layout shift). Scoped to /live via a
// CSS variable applied only on this page's root wrapper.
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display',
  display: 'swap',
})

// Inter for the rim watermark text — light weight (300) reads airy/wide
// against the brass ring, distinct from the serif object name.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300'],
  variable: '--font-rim',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Live',
  robots: { index: false, follow: false }, // v1: not ready for search indexing
}

export default function LivePage() {
  return (
    <div className={`${cormorant.variable} ${inter.variable}`}>
      <LiveView />
    </div>
  )
}
