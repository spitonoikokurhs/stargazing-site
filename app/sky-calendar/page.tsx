import type { Metadata } from 'next'
import {
  CITIES,
  cityById,
  moonInfo,
  moonWeek,
  twilightPhases,
  planetsTonight,
  moonDuringDark,
  altitudeCurves,
  zoneAbbrev,
} from '@/lib/ephemeris'
import { issPasses } from '@/lib/iss'
import { upcomingCelestialEvents } from '@/lib/celestial-events'
import { CityFlag, EventIcon, MoonPhaseIcon, PlanetIcon, RiseSetArrow, TwilightIcon, type TwilightRowKind } from './sky-icons'
import { AltitudeChart, DayNightBar } from './sky-chart'
import './sky-calendar.css'

export const metadata: Metadata = {
  title: 'Tonight’s Sky — Darkness, Moon & Planets | Stargazing Events',
  description:
    'Tonight’s stargazing conditions for Kos, Athens, Bodrum, Berlin, Munich, Rome and London: when the sky gets fully dark, the moon, and which planets are up and where to look. Times in each city’s local timezone.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.stargazing.events/sky-calendar' },
}

// Server-computed, hourly ISR. The astronomy-engine work is all HERE — the
// browser gets only strings; the ~46 KB engine never ships to the client.
export const revalidate = 3600

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Heavens-Above's skychart `tz` param wants its own zone code, not an IANA name.
// Map the IANA zones our cities use to a Heavens-Above code KNOWN to be valid
// (an unknown code silently falls back to UCT, which is what broke the Bodrum
// link). The star positions are driven by lat/lon/time regardless, so the tz
// only sets the displayed clock; Turkey (UTC+3, no DST) uses EET as the closest
// valid Eastern-European code.
function heavensAboveTz(iana: string): string {
  switch (iana) {
    case 'Europe/Athens':
    case 'Europe/Istanbul':
      return 'EET' // Eastern Europe — EET/EEST
    case 'Europe/Berlin':
    case 'Europe/Rome':
      return 'CET' // Central Europe — CET/CEST
    case 'Europe/London':
      return 'GMT' // UK — GMT/BST
    default:
      return 'UCT'
  }
}

// Heavens-Above language (`cul`) per city, per the requested convention:
// Greek cities -> English, Bodrum (Turkey) -> Turkish, German cities -> German,
// UK -> English. Keyed by country so a new city inherits the right language.
function heavensAboveLang(country: string): string {
  switch (country) {
    case 'Turkey':
      return 'tr'
    case 'Germany':
      return 'de'
    default:
      // Greece, United Kingdom, Italy, and anything else -> English.
      return 'en'
  }
}

// Date/weekday labels must read in the SELECTED CITY's local zone, not the
// server's (Vercel runs UTC — without the timeZone a Kos guest just past midnight
// would see tomorrow's date while it's still "tonight" for them). Every string
// on the card is then internally consistent in that city's clock.
function fmtDateLabel(d: Date, tz: string): string {
  return d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
}

export default async function SkyCalendarPage({
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
  const now = new Date()
  const when = dateParam ? new Date(`${dateParam}T18:00:00Z`) : now

  const moon = moonInfo(when)
  // The 7-night strip ALWAYS starts from today (not the selected date), so it's a
  // stable "next 7 nights" you can navigate freely — picking a future night no
  // longer strands you unable to get back to tonight.
  const week = moonWeek(now, 7)
  const tw = twilightPhases(city, when)
  // Sun + Moon altitude across the selected local day, for the 24h arc chart +
  // timeline bar. `now` drives the "now" marker (shown only when the picked day
  // is today in the city's zone).
  const curves = altitudeCurves(city, when, now)
  const moonWin = moonDuringDark(city, when, tw)
  const planets = planetsTonight(city, when, tw)
  const visiblePlanets = planets.filter((p) => p.visible)
  const hiddenPlanets = planets.filter((p) => !p.visible)

  // ISS visible passes for the city-local day (needs a live TLE — see lib/iss).
  // Safe by contract: returns { ok:false } with a reason if the feed is down or
  // stale, so we render "unavailable" rather than anything fabricated.
  const iss = await issPasses(city, when)

  // Upcoming celestial events (eclipses computed, meteor showers from the annual
  // table) — a season-level "coming up" list, not per-night. Next ~120 days.
  const events = upcomingCelestialEvents(when, 120)
  // "Wed 12 August" — weekday + day + month, so an event is plannable at a glance.
  const fmtEventDate = (ymd: string) =>
    new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
  // A short human countdown for the pill: Tonight / Tomorrow / in N days / in N
  // weeks. Weeks past ~3 so a distant event doesn't read as a huge day count.
  const countdownLabel = (days: number): string => {
    if (days <= 0) return 'Tonight'
    if (days === 1) return 'Tomorrow'
    if (days <= 21) return `in ${days} days`
    return `in ${Math.round(days / 7)} weeks`
  }

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Tonight’s Sky — Darkness, Moon & Planets',
    description:
      'Stargazing conditions — darkness window, moon and visible planets — for Kos, Athens, Bodrum, Berlin, Munich, Rome and London.',
    url: 'https://www.stargazing.events/sky-calendar',
  })

  const cityHref = (id: string) => {
    const p = new URLSearchParams()
    p.set('city', id)
    if (dateParam) p.set('date', dateParam)
    return `/sky-calendar?${p.toString()}`
  }

  // Interactive sky map: rather than build our own star chart, link out to
  // Heavens-Above's skychart, pre-set to the selected city's coordinates. Their
  // page renders the live constellations/planets for that lat/lon; we just hand
  // it the location so the guest lands on THEIR sky, not a default one.
  const skyMapHref = (() => {
    const p = new URLSearchParams()
    p.set('lat', city.lat.toFixed(4))
    p.set('lng', city.lon.toFixed(4))
    p.set('loc', city.name)
    p.set('alt', String(city.height))
    p.set('tz', heavensAboveTz(city.tz))
    p.set('cul', heavensAboveLang(city.country))
    return `https://www.heavens-above.com/skychart.aspx?${p.toString()}`
  })()
  // The 7-night strip is anchored at TODAY (now), so offsets are days-from-today.
  const localYmdFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: city.tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  // City-local "YYYY-MM-DD" for a night `offset` days from today.
  const nightYmd = (offset: number) => localYmdFmt.format(new Date(now.getTime() + offset * 86_400_000))
  // Link to that night's full card (keeps the current city).
  const dateHrefFor = (offset: number) => {
    const p = new URLSearchParams()
    p.set('city', city.id)
    p.set('date', nightYmd(offset))
    return `/sky-calendar?${p.toString()}`
  }
  // Which night is currently shown (to mark it active in the strip).
  const shownYmd = localYmdFmt.format(when)
  // Step the SHOWN date by ±1 day (lets you go further than the 7-night strip).
  const stepDayHref = (deltaDays: number) => {
    const target = localYmdFmt.format(new Date(when.getTime() + deltaDays * 86_400_000))
    const p = new URLSearchParams()
    p.set('city', city.id)
    p.set('date', target)
    return `/sky-calendar?${p.toString()}`
  }
  // Don't let "previous" go before today (no point showing a past night).
  const todayYmd = localYmdFmt.format(now)
  const canGoPrev = shownYmd > todayYmd
  // Weekday label + the actual date for each strip night.
  const dayLabel = (offset: number) =>
    offset === 0
      ? 'Tonight'
      : new Date(now.getTime() + offset * 86_400_000).toLocaleDateString('en-GB', { timeZone: city.tz, weekday: 'short' })
  const dayDate = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toLocaleDateString('en-GB', { timeZone: city.tz, day: 'numeric', month: 'short' })

  // The darkness ladder as ordered rows (skip any null phase honestly). `kind`
  // selects the row's icon (see TwilightIcon).
  const twilightRows: { label: string; time: string | null; kind: TwilightRowKind; emphasis?: boolean }[] = [
    { label: 'Sunset', time: tw.sunset?.hhmm ?? null, kind: 'sunset' },
    { label: 'Civil twilight ends', time: tw.civilDusk?.hhmm ?? null, kind: 'civil-dusk' },
    { label: 'Nautical twilight ends', time: tw.nauticalDusk?.hhmm ?? null, kind: 'nautical-dusk' },
    { label: 'Fully dark — a session can start', time: tw.astroDusk?.hhmm ?? null, kind: 'astro-dusk', emphasis: true },
    { label: 'First light — dark ends', time: tw.astroDawn?.hhmm ?? null, kind: 'astro-dawn', emphasis: true },
    { label: 'Nautical twilight (dawn)', time: tw.nauticalDawn?.hhmm ?? null, kind: 'nautical-dawn' },
    { label: 'Civil twilight (dawn)', time: tw.civilDawn?.hhmm ?? null, kind: 'civil-dawn' },
    { label: 'Sunrise', time: tw.sunrise?.hhmm ?? null, kind: 'sunrise' },
  ]

  return (
    <main className="sky-root">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <div className="sky-inner">
        <div className="sky-topbar">
          <a href="/" className="sky-home-link">← Home</a>
        </div>

        <header className="sky-header">
          <h1>Tonight’s sky</h1>
          <p className="sky-sub">When it gets dark, what the moon’s doing, and which planets are up — for planning a night under the stars.</p>
        </header>

      {/* ---- 7-night strip: tap a night to load its full conditions ---- */}
      <section className="sky-week" aria-label="The next 7 nights">
        <h2 className="sky-h2">Next 7 nights <span className="sky-h2-sub">— tap a night to see it</span></h2>
        <ol className="sky-week-strip">
          {week.map((d) => {
            const isShown = nightYmd(d.dayOffset) === shownYmd
            return (
              <li key={d.dayOffset}>
                <a
                  href={dateHrefFor(d.dayOffset)}
                  className={`sky-week-day${d.illumPercent <= 15 ? ' sky-week-day--dark' : ''}${isShown ? ' sky-week-day--active' : ''}`}
                  aria-current={isShown ? 'true' : undefined}
                >
                  <span className="sky-week-label">{dayLabel(d.dayOffset)}</span>
                  <span className="sky-week-date">{dayDate(d.dayOffset)}</span>
                  <span className="sky-week-glyph" aria-hidden="true">
                    <MoonPhaseIcon fraction={d.illumFraction} waxing={d.waxing} size={30} title={d.phaseName} />
                  </span>
                  <span className="sky-week-pct">{d.illumPercent}%</span>
                </a>
              </li>
            )
          })}
        </ol>
        <p className="sky-week-hint">Darker nights (lower %) are best for galaxies and nebulae. Tap any night to see its darkness, moon, planets and ISS passes.</p>
      </section>

      {/* ---- City switcher ---- */}
      <nav className="sky-cities-nav" aria-label="Choose a city">
        {CITIES.map((c) => (
          <a key={c.id} href={cityHref(c.id)} className={`sky-city-chip${c.id === city.id ? ' is-active' : ''}`}>
            <span className="sky-city-flag"><CityFlag country={c.country} /></span>
            {c.name}
          </a>
        ))}
      </nav>

      {/* ---- The night card for the chosen city ---- */}
      <section className="sky-card" aria-label={`Conditions for ${city.name}`}>
        <div className="sky-card-head">
          <h2 className="sky-card-title">
            <span className="sky-card-flag"><CityFlag country={city.country} /></span>
            {city.name}
            <span className="sky-tz">{zoneAbbrev(when, city.tz)}</span>
          </h2>
          <div className="sky-card-nav">
            {canGoPrev ? (
              <a className="sky-day-step" href={stepDayHref(-1)} aria-label="Previous night">‹</a>
            ) : (
              <span className="sky-day-step sky-day-step--off" aria-hidden="true">‹</span>
            )}
            <span className="sky-card-date">{fmtDateLabel(when, city.tz)}</span>
            <a className="sky-day-step" href={stepDayHref(1)} aria-label="Next night">›</a>
          </div>
          <span className="sky-card-tznote">all times {zoneAbbrev(when, city.tz)} (local)</span>
        </div>

        {/* Moon — the single moon home: phase + % lit, the viewing verdict, and
            this city/date's moonrise & moonset. Sits at the top of the card. */}
        <div className="sky-block sky-moon-block">
          <div className="sky-moon-glyph" aria-hidden="true">
            <MoonPhaseIcon fraction={moon.illumFraction} waxing={moon.waxing} size={72} title={moon.phaseName} />
          </div>
          <div className="sky-moon-text">
            <p className="sky-moon-headline">
              {moon.phaseName.charAt(0).toUpperCase() + moon.phaseName.slice(1)} · {moon.illumPercent}% lit
            </p>
            <p className="sky-moon-verdict">{moonWin.verdict}</p>
            <p className="sky-raw sky-raw--moon">
              <span className="sky-t-icon sky-t-icon--rise" aria-hidden="true"><RiseSetArrow dir="rise" /></span>
              Rises {moonWin.moonrise?.hhmm ?? '—'}
              <span className="sky-raw-sep">·</span>
              <span className="sky-t-icon sky-t-icon--set" aria-hidden="true"><RiseSetArrow dir="set" /></span>
              sets {moonWin.moonset?.hhmm ?? '—'}
            </p>
          </div>
        </div>

        {/* Darkness timeline */}
        <div className="sky-block">
          <h3 className="sky-block-title">Darkness tonight</h3>
          <ul className="sky-timeline">
            {twilightRows.map((r) => (
              <li key={r.label} className={`sky-tl-row${r.emphasis ? ' sky-tl-row--key' : ''}`}>
                <span className="sky-tl-label">
                  <span className="sky-tl-icon" aria-hidden="true"><TwilightIcon kind={r.kind} /></span>
                  {r.label}
                </span>
                <span className="sky-tl-time">{r.time ?? 'stays light'}</span>
              </li>
            ))}
          </ul>
          {!tw.astroDusk ? (
            <p className="sky-block-note">The sky doesn’t reach full darkness tonight — a northern-summer thing. Deep-sky viewing needs a darker window.</p>
          ) : null}
        </div>

        {/* Planets */}
        <div className="sky-block">
          <h3 className="sky-block-title">Planets tonight</h3>
          {visiblePlanets.length > 0 ? (
            <ul className="sky-planets">
              {visiblePlanets.map((p) => (
                <li key={p.name} className="sky-planet">
                  <span className="sky-planet-name">
                    <span className="sky-planet-icon" aria-hidden="true"><PlanetIcon name={p.name} /></span>
                    {p.name}
                  </span>
                  <span className="sky-planet-line">{p.summary}</span>
                  {/* Raw times shown inline (not hidden behind a click) — a
                      planner wants them, and a mystery "times" toggle read as
                      unclear. Compact, muted, so the plain line stays the lead. */}
                  <span className="sky-planet-times">
                    <span><span className="sky-t-icon sky-t-icon--rise" aria-hidden="true"><RiseSetArrow dir="rise" /></span><span className="sky-t-label">rises</span> {p.rise?.hhmm ?? '—'}</span>
                    <span><span className="sky-t-icon sky-t-icon--set" aria-hidden="true"><RiseSetArrow dir="set" /></span><span className="sky-t-label">sets</span> {p.set?.hhmm ?? '—'}</span>
                    <span><span className="sky-t-label">highest</span> {p.bestTime?.hhmm ?? '—'} ({Math.round(p.maxAltitude)}°)</span>
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

        {/* ISS visible passes — real data from a live satellite feed, or an
            honest "unavailable" if the feed is down/stale (never fabricated). */}
        <div className="sky-block">
          <h3 className="sky-block-title">ISS passes <span className="sky-block-sub">(naked eye)</span></h3>
          {iss.ok && iss.passes.length > 0 ? (
            <>
              <ul className="sky-iss">
                {iss.passes.map((p, i) => (
                  <li key={i} className="sky-iss-pass">
                    <span className="sky-iss-time">{p.start}</span>
                    <span className="sky-iss-desc">
                      appears in the {p.startDir}, climbs to {p.peakAltitude}° by {p.peak}, gone by {p.end} in the {p.endDir}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="sky-block-note">
                The Space Station looks like a bright, steady star gliding across the sky over a few minutes — no
                flashing. Look toward the first direction at the start time.
              </p>
            </>
          ) : iss.ok ? (
            <p className="sky-block-note">No visible ISS passes over {city.name} tonight.</p>
          ) : (
            <p className="sky-block-note">ISS pass times are unavailable right now — {iss.reason}</p>
          )}
        </div>

        {/* Sun + Moon altitude across the 24h + a compact day/night timeline —
            the "how high, and when" planning view. */}
        <div className="sky-block">
          <h3 className="sky-block-title">Sun &amp; Moon path <span className="sky-block-sub">(altitude over 24h)</span></h3>
          <div className="sky-chart-legend" aria-hidden="true">
            <span className="sky-legend-item"><span className="sky-legend-swatch sky-legend-swatch--sun" />Sun{curves.sunTransit ? ` · highest ${curves.sunTransit.hhmm} (${Math.round(curves.sunTransit.altitude)}°)` : ''}</span>
            <span className="sky-legend-item"><span className="sky-legend-swatch sky-legend-swatch--moon" />Moon{curves.moonTransit ? ` · highest ${curves.moonTransit.hhmm} (${Math.round(curves.moonTransit.altitude)}°)` : ''}</span>
          </div>
          <div className="sky-chart-legend sky-chart-legend--tw" aria-hidden="true">
            <span className="sky-legend-item"><span className="sky-legend-box sky-legend-box--civil" />Civil</span>
            <span className="sky-legend-item"><span className="sky-legend-box sky-legend-box--nautical" />Nautical</span>
            <span className="sky-legend-item"><span className="sky-legend-box sky-legend-box--astro" />Astronomical</span>
            <span className="sky-legend-item"><span className="sky-legend-box sky-legend-box--dark" />Full dark</span>
          </div>
          <div className="sky-chart-wrap">
            <AltitudeChart curves={curves} />
          </div>
          <DayNightBar curves={curves} tw={tw} />
          <p className="sky-block-note">
            The shaded band is the genuinely-dark part of the night. A target is easy to observe when its curve is high
            (above ~30°) during that band; low on the horizon means haze and rooftops. Times are {zoneAbbrev(when, city.tz)} (local).
          </p>
          <p className="sky-skymap-link">
            <a href={skyMapHref} target="_blank" rel="noopener noreferrer">
              Open an interactive sky map for {city.name} ↗
            </a>
          </p>
        </div>
      </section>

      {/* ---- Coming up: eclipses + meteor showers (season-level, not per-night) ---- */}
      {events.length > 0 ? (
        <section className="sky-events" aria-label="Upcoming celestial events">
          <h2 className="sky-h2">Coming up</h2>
          <ul className="sky-events-list">
            {events.map((e, i) => (
              <li key={i} className={`sky-event sky-event--${e.kind}${e.daysAway <= 2 ? ' sky-event--soon' : ''}`}>
                <span className="sky-event-icon" aria-hidden="true">
                  <EventIcon kind={e.kind} />
                </span>
                <span className="sky-event-body">
                  <span className="sky-event-title">{e.title}</span>
                  <span className="sky-event-when">{fmtEventDate(e.date)}</span>
                  <span className="sky-event-detail">{e.detail}</span>
                </span>
                <span className={`sky-event-countdown${e.daysAway <= 2 ? ' sky-event-countdown--soon' : ''}`}>
                  {countdownLabel(e.daysAway)}
                </span>
              </li>
            ))}
          </ul>
          <p className="sky-block-note">
            Meteor showers are best on a moonless night away from town lights — use the moon panel above to judge.
            Eclipse and shower dates are worldwide; whether it’s above your horizon depends on your location and time.
          </p>
        </section>
      ) : null}

      <p className="sky-tz-note">
        Every time is shown in {city.name}’s own local clock, with daylight saving applied for the date. “—” means the
        event doesn’t occur (for example, some nights the moon doesn’t rise); “stays light” means the sky never reaches
        that stage (northern summer). ISS pass times use live orbital data and show only passes
        visible to the naked eye (bright enough, in a dark-enough sky). Planet visibility is judged during the genuinely-dark window, not by a daytime
        high point — so a planet only appears here when you could actually see it.
      </p>

        <footer className="sky-footer">
          <p>
            Planning a stargazing night in Greece? <a href="/#contact">Get in touch</a> — we bring the telescope for the
            deep sky and the eyepiece for the planets, and we check the sky and the moon for you.
          </p>
          <p className="sky-footer-home"><a href="/">← Back to home</a></p>
        </footer>
      </div>
    </main>
  )
}
