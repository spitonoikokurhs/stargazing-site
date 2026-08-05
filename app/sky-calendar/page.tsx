import type { Metadata } from 'next'
import {
  CITIES,
  cityById,
  twilightPhases,
  nightSummary,
  planetsTonight,
  nightCurves,
  moonWeek,
  zoneAbbrev,
  type Interval,
} from '@/lib/ephemeris'
import { upcomingCelestialEvents } from '@/lib/celestial-events'
import { MoonPhaseIcon, PlanetIcon, EventIcon, RiseSetArrow, TwilightIcon, type TwilightRowKind } from './sky-icons'
import { NightAltitudeChart, NightBar } from './sky-chart'
import { verdictHeadline, moonlessPhrase, howWedPlayIt } from './verdict'
import { SkyTrack } from './SkyTrack'
import './sky-calendar.css'

export const metadata: Metadata = {
  title: 'Tonight’s Sky — Is it a dark night? Moon, planets & the eyepiece | Stargazing Events',
  description:
    'A verdict-first read of tonight’s sky for Kos, Athens, Bodrum and beyond: is it a dark, moon-free night worth planning, what’s worth looking at through the eyepiece, and when the sky is actually dark.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.stargazing.events/sky-calendar' },
}

export const revalidate = 3600
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function fmtDur(mins: number): string {
  if (mins < 1) return '0h'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

// epoch-ms interval -> "HH:MM" in the city zone
function fmtInterval(iv: Interval, tz: string): string {
  const f = (t: number) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
  return `${f(iv[0])}–${f(iv[1])}`
}

export default async function SkyCalendarV2({
  searchParams,
}: {
  searchParams: { city?: string; date?: string; detail?: string }
}) {
  const city = cityById(searchParams.city ?? '') ?? CITIES[0]
  const dateParam = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : null
  const full = searchParams.detail === 'full'
  const now = new Date()
  const when = dateParam ? new Date(`${dateParam}T18:00:00Z`) : now

  const tw = twilightPhases(city, when)
  const night = nightSummary(city, when, tw)
  const planets = planetsTonight(city, when, tw)
  const visible = planets.filter((p) => p.visible)
  const hidden = planets.filter((p) => !p.visible)
  const curves = nightCurves(city, when, tw, now)
  const week = moonWeek(now, 7)
  const events = upcomingCelestialEvents(when, 120)

  const tz = zoneAbbrev(when, city.tz)
  const headline = verdictHeadline(night)
  const moonless = moonlessPhrase(night)
  const play = howWedPlayIt(night, planets)

  // Is the shown date actually today in the city's zone? Drives "Tonight in Kos"
  // vs. a dated eyebrow like "Fri 14 Aug · Kos" — the eyebrow must not say
  // "tonight" when the guest has stepped to another night.
  const localYmdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: city.tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const isToday = localYmdFmt.format(now) === localYmdFmt.format(when)
  const eyebrowLabel = isToday
    ? `Tonight in ${city.name}`
    : `${new Date(when).toLocaleDateString('en-GB', { timeZone: city.tz, weekday: 'short', day: 'numeric', month: 'long' })} · ${city.name}`

  // City + date hrefs preserve the other params (and the detail flag).
  const hrefWith = (over: Partial<{ city: string; date: string; detail: string }>) => {
    const p = new URLSearchParams()
    p.set('city', over.city ?? city.id)
    const d = over.date ?? dateParam
    if (d) p.set('date', d)
    const det = over.detail ?? (full ? 'full' : undefined)
    if (det) p.set('detail', det)
    return `/sky-calendar?${p.toString()}`
  }

  const nightYmd = (offset: number) => localYmdFmt.format(new Date(now.getTime() + offset * 86_400_000))
  const shownYmd = localYmdFmt.format(when)
  const dayLabel = (offset: number) =>
    offset === 0 ? 'Tonight' : new Date(now.getTime() + offset * 86_400_000).toLocaleDateString('en-GB', { timeZone: city.tz, weekday: 'short' })

  const twilightRows: { label: string; time: string | null; kind: TwilightRowKind; key?: boolean }[] = [
    { label: 'Sunset', time: tw.sunset?.hhmm ?? null, kind: 'sunset' },
    { label: 'Civil twilight ends', time: tw.civilDusk?.hhmm ?? null, kind: 'civil-dusk' },
    { label: 'Nautical twilight ends', time: tw.nauticalDusk?.hhmm ?? null, kind: 'nautical-dusk' },
    { label: 'Fully dark', time: tw.astroDusk?.hhmm ?? null, kind: 'astro-dusk', key: true },
    { label: 'First light', time: tw.astroDawn?.hhmm ?? null, kind: 'astro-dawn', key: true },
    { label: 'Nautical twilight (dawn)', time: tw.nauticalDawn?.hhmm ?? null, kind: 'nautical-dawn' },
    { label: 'Civil twilight (dawn)', time: tw.civilDawn?.hhmm ?? null, kind: 'civil-dawn' },
    { label: 'Sunrise', time: tw.sunrise?.hhmm ?? null, kind: 'sunrise' },
  ]

  const fmtEventDate = (ymd: string) =>
    new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
  const countdown = (days: number) => (days <= 0 ? 'Tonight' : days === 1 ? 'Tomorrow' : days <= 21 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`)

  return (
    <main className={`v2-root v2-grade-${night.grade}`}>
      {/* Consent-gated interest beacon: which city + whether Full detail. */}
      <SkyTrack cityId={city.id} fullDetail={full} />
      <div className="v2-inner">
        {/* Controls: one collapsed line, not seven chips. */}
        <div className="v2-controls">
          <details className="v2-picker">
            <summary>{city.name}<span className="v2-picker-caret">⌄</span></summary>
            <div className="v2-picker-menu">
              {CITIES.map((c) => (
                <a key={c.id} href={hrefWith({ city: c.id })} className={c.id === city.id ? 'is-active' : ''}>
                  {c.name} <span className="v2-picker-region">{c.country}</span>
                </a>
              ))}
            </div>
          </details>
          <span className="v2-controls-date">{new Date(when).toLocaleDateString('en-GB', { timeZone: city.tz, weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <a className="v2-home" href="/">← Home</a>
        </div>

        {/* HERO — the verdict, not the controls. */}
        <section className="v2-hero" aria-label="Sky verdict">
          <div className="v2-hero-main">
            <p className="v2-eyebrow">{eyebrowLabel}</p>
            <h1 className="v2-headline">{headline}</h1>
            <p className="v2-moonless">
              {night.grade !== 'no-dark' && night.darkStart && night.darkEnd ? (
                <>Properly dark <strong>{night.darkStart.hhmm}–{night.darkEnd.hhmm}</strong> · {fmtDur(night.darkMinutes)}</>
              ) : (
                <>{moonless}</>
              )}
            </p>
            <p className="v2-sub">
              {night.moonPhase} · {night.moonIllumPct}% lit
              {night.grade !== 'no-dark' && <> · <span className="v2-accent">{moonless}</span></>}
            </p>
          </div>
          <div className="v2-hero-moon" aria-hidden="true">
            <MoonPhaseIcon fraction={night.moonIllumFraction} waxing={night.moonWaxing} size={92} title={night.moonPhase} />
          </div>
        </section>

        {/* Night bar — cropped to the night (sunset−2h → sunrise+2h), so the
            dark hours fill the bar instead of being crushed by daytime. */}
        <div className="v2-bar">
          <NightBar curves={curves} tz={city.tz} />
        </div>

        {/* How we'd play it -> CTA (commercial as conclusion). */}
        <section className="v2-play" aria-label="How we’d play it">
          <p className="v2-eyebrow">How we’d play it</p>
          <p className="v2-play-text">{play}</p>
          <a className="v2-cta" href="/#contact">Plan a night with us →</a>
        </section>

        {/* Worth looking at — planets as sentences + one time that matters. */}
        <section className="v2-worth" aria-label="Worth looking at">
          <p className="v2-eyebrow">Worth looking at</p>
          {visible.length > 0 ? (
            <ul className="v2-planets">
              {visible.map((p) => (
                <li key={p.name} className="v2-planet">
                  <span className="v2-planet-icon" aria-hidden="true"><PlanetIcon name={p.name} /></span>
                  <span className="v2-planet-body">
                    <span className="v2-planet-head">
                      <span className="v2-planet-name">{p.name}</span>
                      {p.bestTime && <span className="v2-planet-best">Best {p.bestTime.hhmm}</span>}
                    </span>
                    <span className="v2-planet-line">{p.summary}</span>
                    {full && (
                      <span className="v2-planet-times">
                        <span><span className="v2-t-ic v2-t-ic--rise" aria-hidden="true"><RiseSetArrow dir="rise" /></span>rises {p.rise?.hhmm ?? '—'}</span>
                        <span><span className="v2-t-ic v2-t-ic--set" aria-hidden="true"><RiseSetArrow dir="set" /></span>sets {p.set?.hhmm ?? '—'}</span>
                        <span>highest {p.bestTime?.hhmm ?? '—'} ({Math.round(p.maxAltitude)}°)</span>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="v2-muted">No planets are well-placed against a dark sky tonight.</p>
          )}
          {hidden.length > 0 && (
            <p className="v2-muted v2-hidden-line">
              {hidden.map((p) => p.name).join(', ')} {hidden.length > 1 ? 'are' : 'is'} below the horizon whenever the sky is dark.
            </p>
          )}
        </section>

        {/* Twilight ladder — collapsed by default, full ladder one tap away. */}
        <details className="v2-disclosure" open={full}>
          <summary>Twilight stages &amp; sun times <span className="v2-plus">+</span></summary>
          <ul className="v2-ladder">
            {twilightRows.map((r) => (
              <li key={r.label} className={`v2-ladder-row${r.key ? ' v2-ladder-row--key' : ''}`}>
                <span className="v2-ladder-label"><span className="v2-ladder-ic" aria-hidden="true"><TwilightIcon kind={r.kind} /></span>{r.label}</span>
                <span className="v2-ladder-time">{r.time ?? 'stays light'}</span>
              </li>
            ))}
          </ul>
          <p className="v2-muted">All times {tz} (local). Moon-free windows: {night.moonlessIntervals.length ? night.moonlessIntervals.map((iv) => fmtInterval(iv, city.tz)).join(', ') : 'none tonight'}.</p>
        </details>

        {/* Altitude chart — FULL DETAIL ONLY (handoff: not on the default view). */}
        {full && (
          <details className="v2-disclosure" open>
            <summary>Sun, Moon &amp; planet altitude <span className="v2-plus">+</span></summary>
            <div className="v2-chart-wrap"><NightAltitudeChart curves={curves} tz={city.tz} /></div>
            <p className="v2-muted">Altitude across the night ({tz}), sunset to sunrise. A target is easy to observe when its curve is high during the shaded dark band. Tap “show planets” to overlay them.</p>
          </details>
        )}

        {/* Not tonight? — the 7-night strip. */}
        <section className="v2-week" aria-label="The next 7 nights">
          <p className="v2-eyebrow">Not tonight?</p>
          <p className="v2-week-hint">Darker nights suit galaxies and nebulae. The Moon thins out toward the end of the week.</p>
          <ol className="v2-week-strip">
            {week.map((d) => {
              const isShown = nightYmd(d.dayOffset) === shownYmd
              return (
                <li key={d.dayOffset}>
                  <a href={hrefWith({ date: nightYmd(d.dayOffset) })} className={`v2-week-day${isShown ? ' is-active' : ''}`} aria-current={isShown ? 'true' : undefined}>
                    <span className="v2-week-label">{dayLabel(d.dayOffset)}</span>
                    <span className="v2-week-glyph" aria-hidden="true"><MoonPhaseIcon fraction={d.illumFraction} waxing={d.waxing} size={30} title={d.phaseName} /></span>
                    <span className="v2-week-pct">{d.illumPercent}%</span>
                  </a>
                </li>
              )
            })}
          </ol>
        </section>

        {/* Coming up. */}
        {events.length > 0 && (
          <section className="v2-events" aria-label="Coming up">
            <p className="v2-eyebrow">Coming up</p>
            <ul className="v2-events-list">
              {events.map((e, i) => (
                <li key={i} className={`v2-event${e.daysAway <= 2 ? ' v2-event--soon' : ''}`}>
                  <span className="v2-event-ic" aria-hidden="true"><EventIcon kind={e.kind} /></span>
                  <span className="v2-event-body">
                    <span className="v2-event-title">{e.title}</span>
                    <span className="v2-event-when">{fmtEventDate(e.date)} · {e.detail}</span>
                  </span>
                  <span className={`v2-event-cd${e.daysAway <= 2 ? ' v2-event-cd--soon' : ''}`}>{countdown(e.daysAway)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Detail toggle + footer. */}
        <div className="v2-foot">
          <a className="v2-detail-toggle" href={hrefWith({ detail: full ? '' : 'full' })}>
            {full ? 'Show essentials' : 'Show full detail'}
          </a>
          <p className="v2-tagline">We bring the telescope, and we read the sky for you — so the night lands on the right hour.</p>
          <a className="v2-cta v2-cta--foot" href="/#contact">Get in touch →</a>
        </div>
      </div>
    </main>
  )
}
