import type { Metadata } from 'next'
import {
  CITIES,
  cityById,
  moonInfo,
  moonWeek,
  moonGlyph,
  twilightPhases,
  planetsTonight,
  moonDuringDark,
  zoneAbbrev,
} from '@/lib/ephemeris'
import './sky-calendar.css'

export const metadata: Metadata = {
  title: 'Tonight’s Sky — Darkness, Moon & Planets | Stargazing Events',
  description:
    'Tonight’s stargazing conditions for Kos, Athens, Berlin, Rome and London: when the sky gets fully dark, the moon, and which planets are up and where to look. Times in each city’s local timezone.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.stargazing.events/sky-calendar' },
}

// Server-computed, hourly ISR. The astronomy-engine work is all HERE — the
// browser gets only strings; the ~46 KB engine never ships to the client.
export const revalidate = 3600

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Date/weekday labels must read in the SELECTED CITY's local zone, not the
// server's (Vercel runs UTC — without the timeZone a Kos guest just past midnight
// would see tomorrow's date while it's still "tonight" for them). Every string
// on the card is then internally consistent in that city's clock.
function fmtDateLabel(d: Date, tz: string): string {
  return d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
}

export default function SkyCalendarPage({
  searchParams,
}: {
  searchParams: { city?: string; date?: string }
}) {
  // City switcher (default Kos, home) + date (default tonight). Both are just
  // query params; the page recomputes server-side for whichever is chosen.
  const city = cityById(searchParams.city ?? '') ?? CITIES[0]
  const dateParam = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : null
  // Anchor at ~evening local so "tonight" means the coming night. For a picked
  // date, use that date's evening; otherwise now.
  const when = dateParam ? new Date(`${dateParam}T18:00:00Z`) : new Date()

  const moon = moonInfo(when)
  const week = moonWeek(when, 7)
  const tw = twilightPhases(city, when)
  const moonWin = moonDuringDark(city, when, tw)
  const planets = planetsTonight(city, when, tw)
  const visiblePlanets = planets.filter((p) => p.visible)
  const hiddenPlanets = planets.filter((p) => !p.visible)

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Tonight’s Sky — Darkness, Moon & Planets',
    description:
      'Stargazing conditions — darkness window, moon and visible planets — for Kos, Athens, Berlin, Rome and London.',
    url: 'https://www.stargazing.events/sky-calendar',
  })

  const cityHref = (id: string) => {
    const p = new URLSearchParams()
    p.set('city', id)
    if (dateParam) p.set('date', dateParam)
    return `/sky-calendar?${p.toString()}`
  }
  const dayLabel = (offset: number) =>
    offset === 0
      ? 'Tonight'
      : new Date(when.getTime() + offset * 86_400_000).toLocaleDateString('en-GB', {
          timeZone: city.tz,
          weekday: 'short',
        })

  // The darkness ladder as ordered rows (skip any null phase honestly).
  const twilightRows: { label: string; time: string | null; emphasis?: boolean }[] = [
    { label: 'Sunset', time: tw.sunset?.hhmm ?? null },
    { label: 'Civil twilight ends', time: tw.civilDusk?.hhmm ?? null },
    { label: 'Nautical twilight ends', time: tw.nauticalDusk?.hhmm ?? null },
    { label: 'Fully dark — a session can start', time: tw.astroDusk?.hhmm ?? null, emphasis: true },
    { label: 'First light — dark ends', time: tw.astroDawn?.hhmm ?? null, emphasis: true },
    { label: 'Nautical twilight (dawn)', time: tw.nauticalDawn?.hhmm ?? null },
    { label: 'Civil twilight (dawn)', time: tw.civilDawn?.hhmm ?? null },
    { label: 'Sunrise', time: tw.sunrise?.hhmm ?? null },
  ]

  return (
    <main className="sky-root">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <header className="sky-header">
        <h1>Tonight’s sky</h1>
        <p className="sky-sub">When it gets dark, what the moon’s doing, and which planets are up — for planning a night under the stars.</p>
      </header>

      {/* ---- Moon header (shared across cities — the Moon looks the same continent-wide) ---- */}
      <section className="sky-moon" aria-label="Tonight’s moon">
        <div className="sky-moon-glyph" aria-hidden="true">{moonGlyph(moon.phaseName)}</div>
        <div className="sky-moon-text">
          <p className="sky-moon-headline">
            {moon.phaseName.charAt(0).toUpperCase() + moon.phaseName.slice(1)} · {moon.illumPercent}% lit
          </p>
          <p className="sky-moon-note">{moon.stargazingNote}</p>
        </div>
      </section>

      {/* ---- 7-night moon strip: pick a dark night ---- */}
      <section className="sky-week" aria-label="Moon over the next 7 nights">
        <h2 className="sky-h2">Next 7 nights</h2>
        <ol className="sky-week-strip">
          {week.map((d) => (
            <li key={d.dayOffset} className={`sky-week-day${d.illumPercent <= 15 ? ' sky-week-day--dark' : ''}`}>
              <span className="sky-week-glyph" aria-hidden="true">{d.glyph}</span>
              <span className="sky-week-label">{dayLabel(d.dayOffset)}</span>
              <span className="sky-week-pct">{d.illumPercent}%</span>
            </li>
          ))}
        </ol>
        <p className="sky-week-hint">Darker nights (lower %) are best for galaxies and nebulae. A bright moon is still lovely — it’s the star of its own show.</p>
      </section>

      {/* ---- City switcher ---- */}
      <nav className="sky-cities-nav" aria-label="Choose a city">
        {CITIES.map((c) => (
          <a key={c.id} href={cityHref(c.id)} className={`sky-city-chip${c.id === city.id ? ' is-active' : ''}`}>
            {c.name}
          </a>
        ))}
      </nav>

      {/* ---- The night card for the chosen city ---- */}
      <section className="sky-card" aria-label={`Conditions for ${city.name}`}>
        <div className="sky-card-head">
          <h2 className="sky-card-title">
            {city.name}
            <span className="sky-tz">{zoneAbbrev(when, city.tz)}</span>
          </h2>
          <span className="sky-card-date">{fmtDateLabel(when, city.tz)} · all times {zoneAbbrev(when, city.tz)} (local)</span>
        </div>

        {/* Darkness timeline */}
        <div className="sky-block">
          <h3 className="sky-block-title">Darkness tonight</h3>
          <ul className="sky-timeline">
            {twilightRows.map((r) => (
              <li key={r.label} className={`sky-tl-row${r.emphasis ? ' sky-tl-row--key' : ''}`}>
                <span className="sky-tl-label">{r.label}</span>
                <span className="sky-tl-time">{r.time ?? 'stays light'}</span>
              </li>
            ))}
          </ul>
          {!tw.astroDusk ? (
            <p className="sky-block-note">The sky doesn’t reach full darkness tonight — a northern-summer thing. Deep-sky viewing needs a darker window.</p>
          ) : null}
        </div>

        {/* Moon during dark */}
        <div className="sky-block">
          <h3 className="sky-block-title">Moon</h3>
          <p className="sky-moon-verdict">{moonWin.verdict}</p>
          <p className="sky-raw">
            Rises {moonWin.moonrise?.hhmm ?? '—'} · sets {moonWin.moonset?.hhmm ?? '—'}
          </p>
        </div>

        {/* Planets — the eyepiece experience */}
        <div className="sky-block">
          <h3 className="sky-block-title">Planets tonight <span className="sky-block-sub">(the eyepiece)</span></h3>
          {visiblePlanets.length > 0 ? (
            <ul className="sky-planets">
              {visiblePlanets.map((p) => (
                <li key={p.name} className="sky-planet">
                  <span className="sky-planet-name">{p.name}</span>
                  <span className="sky-planet-line">{p.summary}</span>
                  {/* Raw times shown inline (not hidden behind a click) — a
                      planner wants them, and a mystery "times" toggle read as
                      unclear. Compact, muted, so the plain line stays the lead. */}
                  <span className="sky-planet-times">
                    <span><span className="sky-t-label">rises</span> {p.rise?.hhmm ?? '—'}</span>
                    <span><span className="sky-t-label">highest</span> {p.bestTime?.hhmm ?? '—'} ({Math.round(p.maxAltitude)}°)</span>
                    <span><span className="sky-t-label">sets</span> {p.set?.hhmm ?? '—'}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sky-block-note">No planets are well-placed against a dark sky from {city.name} tonight.</p>
          )}
          {hiddenPlanets.length > 0 ? (
            <p className="sky-planets-hidden">
              Not visible at night from {city.name} tonight: {hiddenPlanets.map((p) => p.name).join(', ')}.
            </p>
          ) : null}
        </div>
      </section>

      <p className="sky-tz-note">
        Every time is shown in {city.name}’s own local clock, with daylight saving applied for the date. “—” means the
        event doesn’t occur (for example, some nights the moon doesn’t rise); “stays light” means the sky never reaches
        that stage (northern summer). Planet visibility is judged during the genuinely-dark window, not by a daytime
        high point — so a planet only appears here when you could actually see it.
      </p>

      <footer className="sky-footer">
        <p>
          Planning a stargazing night in Greece? <a href="/#contact">Get in touch</a> — we bring the telescope for the
          deep sky and the eyepiece for the planets, and we check the sky and the moon for you.
        </p>
      </footer>
    </main>
  )
}
