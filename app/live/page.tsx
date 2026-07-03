import type { Metadata } from 'next'
import LiveView from './LiveView'
import './styles.css'

export const metadata: Metadata = {
  title: 'Live',
  robots: { index: false, follow: false }, // v1: not ready for search indexing
}

export default function LivePage() {
  return <LiveView />
}
