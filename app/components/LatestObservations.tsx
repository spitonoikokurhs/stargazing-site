// "Latest observations" — a guest-facing gallery of the most recent capture of
// each object through the electronic eyepiece (see lib/recent-observations).
// Server component: fetches nothing itself — it's handed the list and renders
// nothing when it's empty (fail-safe, so a data hiccup never leaves a broken
// section). The interactive grid + click-to-open lightbox lives in the client
// ObservationGrid child.
//
// `heading` lets the same gallery serve the homepage TEASER (a short intro,
// "See all →" link) and the full /observations page (no teaser cap).

import type { RecentObservation } from '@/lib/recent-observations'
import { toCard } from '@/lib/recent-observations'
import { ObservationGrid } from './ObservationGrid'

export function LatestObservations({
  items,
  variant = 'full',
}: {
  items: RecentObservation[]
  // 'full' = the whole intro + all items (the /observations page).
  // 'teaser' = homepage: same cards but a shorter intro and a "See all" link.
  variant?: 'full' | 'teaser'
}) {
  if (!items || items.length === 0) return null

  const cards = items.map(toCard)

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
          Each object below is exactly as our guests saw it, live under the Aegean sky. Tap any capture to see it full
          size, with a few words about what it is.
        </p>

        <ObservationGrid items={cards} />

        {variant === 'teaser' ? (
          <p className="lo-seeall">
            <a href="/observations">See all observations →</a>
          </p>
        ) : null}
      </div>
    </section>
  )
}
