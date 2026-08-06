import type { Metadata } from 'next'
import { latestObservationsPerObject } from '@/lib/recent-observations'
import { LatestObservations } from '../components/LatestObservations'
import '../homepage.css'

export const metadata: Metadata = {
  title: 'Observations — deep sky through our electronic eyepiece | Stargazing Events',
  description:
    'The nebulae, galaxies and clusters we’ve captured through our electronic eyepiece on Kos — each one exactly as our guests saw it, live under the Aegean sky. Tap any capture for the full frame and what it is.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.stargazing.events/observations' },
}

// Hourly ISR — the gallery grows as new objects are observed, no need to
// recompute per request.
export const revalidate = 3600

export default async function ObservationsPage() {
  // Full list (all distinct objects), newest capture per object. Fail-safe: []
  // on any DB issue -> the gallery renders nothing and we show a calm note.
  const observations = await latestObservationsPerObject()

  return (
    <main>
      <header className="obs-topbar">
        <div className="container">
          <a href="/" className="brand">
            <span className="brand-dot"></span>
            <span>Stargazing Events</span>
          </a>
          <a className="obs-back" href="/">← Home</a>
        </div>
      </header>

      {observations.length > 0 ? (
        <LatestObservations items={observations} variant="full" />
      ) : (
        <section className="section">
          <div className="container">
            <p className="lo-eyebrow">From the eyepiece</p>
            <h2>Observations</h2>
            <p className="lead">Our latest captures will appear here after the next night under the sky.</p>
            <p style={{ marginTop: '18px' }}>
              <a href="/">← Back to home</a>
            </p>
          </div>
        </section>
      )}
    </main>
  )
}
