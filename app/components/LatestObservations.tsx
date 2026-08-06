/* eslint-disable @next/next/no-img-element */
// "Latest observations" — a guest-facing gallery of the most recent capture of
// each object from the live telescope (see lib/recent-observations). Server
// component: it's handed the already-fetched list and renders nothing when the
// list is empty (fail-safe, so a data hiccup never leaves a broken section).
//
// Each card is the real stacked astrophoto with the object's name/type in an
// elegant overlay and the capture date — conveying "we photographed this, live,
// under the Aegean sky," which is the whole draw.

import type { RecentObservation } from '@/lib/recent-observations'

function fmtObserved(d: Date): string {
  // "12 August 2026" — Athens zone, EU-style, matching the site's date convention.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

export function LatestObservations({ items }: { items: RecentObservation[] }) {
  if (!items || items.length === 0) return null

  return (
    <section id="latest-observations" className="section lo-section" aria-label="Latest observations">
      <div className="container">
        <p className="lo-eyebrow">From the eyepiece</p>
        <h2>Latest observations</h2>
        <p className="lead lo-lead">
          Seen through our electronic eyepiece — a modern sensor in place of the ordinary glass one. It draws out the
          true colour of a nebula, the fine structure of a galaxy, and the faint stars scattered around it: detail no
          traditional eyepiece can show the eye.
        </p>
        <p className="lo-subnote">
          Each object below is exactly as our guests saw it, live under the Aegean sky. New ones join the collection
          every time we bring a fresh target into view.
        </p>

        <ol className="lo-grid">
          {items.map((o) => (
            <li key={o.objectId} className="lo-card">
              <div className="lo-thumb">
                <img
                  src={o.thumbnailUrl ?? o.imageUrl}
                  alt={`${o.name}${o.type ? ` — ${o.type}` : ''}, captured by Stargazing Events`}
                  loading="lazy"
                  decoding="async"
                />
                <div className="lo-overlay">
                  <span className="lo-name">{o.name}</span>
                  {o.type ? <span className="lo-type">{o.type}</span> : null}
                </div>
              </div>
              <div className="lo-meta">
                <span className="lo-where">{o.constellation ? `in ${o.constellation}` : ' '}</span>
                <time className="lo-date" dateTime={o.observedAt.toISOString()}>
                  {fmtObserved(o.observedAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
