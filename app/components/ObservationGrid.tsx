'use client'

/* eslint-disable @next/next/no-img-element */
// Client grid + lightbox for the observation captures. The cards are the same
// as before (thumbnail, name, type, constellation, date); clicking one opens a
// lightbox with the FULL uncropped image and the object's facts (distance, size,
// a sentence). Keyboard + tap-out to close. Data is fetched server-side and
// passed in already-serialized (observedAtIso as a string, not a Date).

import { useCallback, useEffect, useState } from 'react'
import type { ObservationCard } from '@/lib/recent-observations'

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
}

// "2,537,000 light-years away" / "22,200 light-years away" — grouped digits.
function fmtDistance(ly: number): string {
  return `${ly.toLocaleString('en-GB')} light-year${ly === 1 ? '' : 's'} away`
}

export function ObservationGrid({ items }: { items: ObservationCard[] }) {
  const [open, setOpen] = useState<ObservationCard | null>(null)

  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    // lock body scroll while the lightbox is open
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, close])

  return (
    <>
      <ol className="lo-grid">
        {items.map((o) => (
          <li key={o.objectId} className="lo-card">
            <button type="button" className="lo-card-btn" onClick={() => setOpen(o)} aria-label={`View ${o.name} full image`}>
              <div className="lo-thumb">
                <img
                  src={o.thumbnailUrl ?? o.imageUrl}
                  alt={`${o.name}${o.type ? ` — ${o.type}` : ''}, captured through our electronic eyepiece`}
                  loading="lazy"
                  decoding="async"
                />
                <div className="lo-overlay">
                  <span className="lo-name">{o.name}</span>
                  {o.type ? <span className="lo-type">{o.type}</span> : null}
                </div>
                <span className="lo-zoom-hint" aria-hidden="true">⤢</span>
              </div>
              <div className="lo-meta">
                <span className="lo-where">{o.constellation ? `in ${o.constellation}` : ' '}</span>
                <span className="lo-date">{fmtDate(o.observedAtIso)}</span>
              </div>
            </button>
          </li>
        ))}
      </ol>

      {open ? (
        <div className="lb" role="dialog" aria-modal="true" aria-label={`${open.name} — full image`} onClick={close}>
          <div className="lb-inner" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lb-close" onClick={close} aria-label="Close">
              ×
            </button>
            <div className="lb-figure">
              {/* Full uncropped capture — no crop/scale here, this is the whole frame. */}
              <img src={open.imageUrl} alt={`${open.name}${open.type ? ` — ${open.type}` : ''}, full frame`} />
            </div>
            <div className="lb-info">
              <p className="lb-eyebrow">Observed {fmtDate(open.observedAtIso)}</p>
              <h3 className="lb-title">{open.name}</h3>
              <p className="lb-type">
                {open.type}
                {open.constellation ? ` · in ${open.constellation}` : ''}
              </p>
              {open.description ? <p className="lb-desc">{open.description}</p> : null}
              <dl className="lb-facts">
                {open.distanceLy != null ? (
                  <div className="lb-fact">
                    <dt>Distance</dt>
                    <dd>{fmtDistance(open.distanceLy)}</dd>
                  </div>
                ) : null}
                {open.sizeDescription ? (
                  <div className="lb-fact">
                    <dt>Apparent size</dt>
                    <dd>{open.sizeDescription}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="lb-credit">Seen through our electronic eyepiece, live under the Aegean sky.</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
