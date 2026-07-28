import type { Metadata } from 'next'
import { CITIES, sunMoonTimes, moonInfo, moonWeek, moonGlyph } from '@/lib/ephemeris'
import './sky-calendar.css'

export const metadata: Metadata = {
  title: 'Tonight’s Sky — Sunset, Moonrise & Moon Phase | Stargazing Events',
  description:
    'Tonight’s sunset, moonrise, moonset and moon phase for Kos, Athens, Berlin, Rome and London — plus when the sky gets dark enough to stargaze. Times shown in each city’s local timezone.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.stargazing.world/sky-calendar' },
}

// Recompute hourly: the numbers change slowly (sunset by ~1 min/day), so an
// hourly ISR revalidate keeps the page fresh and CDN-cached without recomputing
// per request. The astronomy-engine work happens HERE, server-side — the browser
// receives only the resulting strings (the engine never ships to the client).
export const revalidate = 3600

// A short, honest verdict on tonight for the header.
function moonHeadline(illumPercent: number, phaseName: string): string {
  return `${phaseName.charAt(0).toUpperCase()}${phaseName.slice(1)} · ${illumPercent}% lit`
}

export default function SkyCalendarPage() {
  // One "now" for the whole page so every city/section is consistent.
  const now = new Date()
  const moon = moonInfo(now)
  const week = moonWeek(now, 7)
  const rows = CITIES.map((c) => sunMoonTimes(c, now))

  // JSON-LD: a simple WebPage; harmless if search engines ignore it, helpful if not.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Tonight’s Sky — Sun & Moon Calendar',
    description:
      'Sunset, moonrise, moonset and moon phase for Kos, Athens, Berlin, Rome and London, with local timezones.',
    url: 'https://www.stargazing.world/sky-calendar',
  })

  const dayLabel = (offset: number) =>
    offset === 0 ? 'Tonight' : new Date(now.getTime() + offset * 86_400_000).toLocaleDateString('en-GB', { weekday: 'short' })

  return (
    <main className="sky-root">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <header className="sky-header">
        <h1>Tonight’s sky</h1>
        <p className="sky-sub">
          Sunset, moon and the dark-sky window — for planning a night under the stars.
        </p>
      </header>

      {/* ---- Moon: shared across all cities (the Moon looks the same continent-wide) ---- */}
      <section className="sky-moon" aria-label="Tonight’s moon">
        <div className="sky-moon-glyph" aria-hidden="true">
          {moonGlyph(moon.phaseName)}
        </div>
        <div className="sky-moon-text">
          <p className="sky-moon-headline">{moonHeadline(moon.illumPercent, moon.phaseName)}</p>
          <p className="sky-moon-note">{moon.stargazingNote}</p>
        </div>
      </section>

      {/* ---- 7-night moon strip: pick a dark night ---- */}
      <section className="sky-week" aria-label="Moon over the next 7 nights">
        <h2 className="sky-h2">Next 7 nights</h2>
        <ol className="sky-week-strip">
          {week.map((d) => (
            <li key={d.dayOffset} className={`sky-week-day${d.illumPercent <= 15 ? ' sky-week-day--dark' : ''}`}>
              <span className="sky-week-glyph" aria-hidden="true">
                {d.glyph}
              </span>
              <span className="sky-week-label">{dayLabel(d.dayOffset)}</span>
              <span className="sky-week-pct">{d.illumPercent}%</span>
            </li>
          ))}
        </ol>
        <p className="sky-week-hint">
          Darker nights (lower %) are best for galaxies and nebulae. A bright moon is still lovely — it’s the star of its own show.
        </p>
      </section>

      {/* ---- Per-city rise/set table ---- */}
      <section className="sky-cities" aria-label="Sun and moon times by city">
        <h2 className="sky-h2">By city</h2>
        <div className="sky-table-wrap">
          <table className="sky-table">
            <thead>
              <tr>
                <th>City</th>
                <th>Sunset</th>
                <th>Dark from</th>
                <th>Moonrise</th>
                <th>Moonset</th>
                <th>Sunrise</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cityId}>
                  <th scope="row" className="sky-city-name">
                    {r.cityName}
                    <span className="sky-tz">{r.tzAbbrev}</span>
                  </th>
                  <td className="sky-num">{r.sunset ?? '—'}</td>
                  <td className="sky-num sky-num--dark">{r.darkFrom ?? 'stays light'}</td>
                  <td className="sky-num">{r.moonrise ?? '—'}</td>
                  <td className="sky-num">{r.moonset ?? '—'}</td>
                  <td className="sky-num">{r.sunrise ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sky-tz-note">
          Every time is shown in that city’s own local clock, with daylight saving applied — the code beside each city
          (e.g. EEST, CEST, BST) tells you which. A “—” means the event doesn’t occur on this date (for example, on some
          nights the moon doesn’t rise); “stays light” means the sky never gets fully dark that night (northern summer).
        </p>
      </section>

      <footer className="sky-footer">
        <p>
          Planning a stargazing night in Greece?{' '}
          <a href="/#contact">Get in touch</a> — we bring the telescope, and we check the sky and the moon for you.
        </p>
      </footer>
    </main>
  )
}
