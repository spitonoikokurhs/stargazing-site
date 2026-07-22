#!/usr/bin/env node
// Standalone assertion runner for lib/live-pill.ts's state machine
// (deriveLivePillState) + panel composer. Run via:
//   npx tsx scripts/test-live-pill.mjs
// No test framework in this repo (same pattern as scripts/test-catalog.mjs).
// Front-end-only feature: this covers the /api/status -> pill-state mapping and
// all the edge cases (cancelled tonight, degraded, next null, null response).

import { deriveLivePillState, buildNextSessionPanel, forcedStatusFromQuery } from '../lib/live-pill.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const NEXT = { date: '2026-07-23', hotelId: 'paralos-kyma-dunes', start: '21:30', end: '22:30' }

// --- live ---
{
  const s = deriveLivePillState({ live: true, tonight: null, next: NEXT })
  assert('live=true -> kind live', s.kind === 'live', s.kind)
  assert('live -> label "Live now"', s.label === 'Live now', s.label)
  assert('live -> href /live', s.href === '/live')
}

// --- tonight (event today, not cancelled) ---
{
  const s = deriveLivePillState({ live: false, tonight: { hotelId: 'oku-kos', start: '21:30', end: '22:30' }, next: NEXT })
  assert('tonight -> kind tonight', s.kind === 'tonight', s.kind)
  assert('tonight -> label "Live at 21:30"', s.label === 'Live at 21:30', s.label)
  assert('tonight -> href /live', s.href === '/live')
}

// --- tonight CANCELLED -> must NOT be the amber "live at" state; falls through to idle/next ---
{
  const s = deriveLivePillState({ live: false, tonight: { hotelId: 'oku-kos', start: '21:30', end: '22:30', cancelled: true }, next: NEXT })
  assert('cancelled tonight -> NOT tonight state', s.kind !== 'tonight', s.kind)
  assert('cancelled tonight -> idle (uses next)', s.kind === 'idle', s.kind)
  assert('cancelled tonight -> label uses next weekday/time', /^Next: \w+ 21:30$/.test(s.label), s.label)
}

// --- idle (no event today) -> panel with schedule anchor ---
{
  const s = deriveLivePillState({ live: false, tonight: null, next: NEXT })
  assert('idle -> kind idle', s.kind === 'idle', s.kind)
  assert('idle -> opensPanel', s.opensPanel === true)
  // 2026-07-23 is a Thursday; time shown verbatim; venue from hotelDisplayName (single source of truth)
  assert('idle -> panel schedule "Thursday 23 July · 21:30 · Paralos Kyma Dunes"',
    s.panel.schedule === 'Thursday 23 July · 21:30 · Paralos Kyma Dunes', s.panel.schedule)
  assert('idle -> resume line known', s.panel.resumeLine === 'Live telescope views resume then.', s.panel.resumeLine)
  assert('idle -> label "Next: Thursday 21:30"', s.label === 'Next: Thursday 21:30', s.label)
}

// --- idle with next=null -> graceful coming-soon, no empty fields ---
{
  const s = deriveLivePillState({ live: false, tonight: null, next: null })
  assert('no next -> kind idle', s.kind === 'idle', s.kind)
  assert('no next -> label neutral "Live"', s.label === 'Live', s.label)
  assert('no next -> panel schedule null', s.panel.schedule === null, String(s.panel.schedule))
  assert('no next -> resume "Next session coming soon."', s.panel.resumeLine === 'Next session coming soon.', s.panel.resumeLine)
}

// --- degraded flag -> neutral fallback link ---
{
  const s = deriveLivePillState({ live: false, tonight: null, next: NEXT, degraded: true })
  assert('degraded -> kind fallback', s.kind === 'fallback', s.kind)
  assert('degraded -> label "Live"', s.label === 'Live', s.label)
  assert('degraded -> href /live', s.href === '/live')
}

// --- null response (fetch failed / not yet loaded) -> neutral fallback ---
{
  const s = deriveLivePillState(null)
  assert('null response -> kind fallback', s.kind === 'fallback', s.kind)
  assert('null response -> label "Live"', s.label === 'Live', s.label)
  assert('null response -> href /live (never broken pill)', s.href === '/live')
}

// --- panel composer directly ---
{
  const p = buildNextSessionPanel(NEXT)
  assert('panel: schedule composed', p.schedule === 'Thursday 23 July · 21:30 · Paralos Kyma Dunes', p.schedule)
  const pn = buildNextSessionPanel(null)
  assert('panel(null): schedule null + coming-soon', pn.schedule === null && pn.resumeLine === 'Next session coming soon.')
}

// --- ?pill-demo= review override (dev-only, query-param driven) ---
{
  // Each forced mode round-trips through the real state machine to the expected state.
  assert('pill-demo=live -> live state', deriveLivePillState(forcedStatusFromQuery('?pill-demo=live')).kind === 'live')
  assert('pill-demo=tonight -> tonight state', deriveLivePillState(forcedStatusFromQuery('?pill-demo=tonight')).kind === 'tonight')
  const idle = deriveLivePillState(forcedStatusFromQuery('?pill-demo=idle'))
  assert('pill-demo=idle -> idle state', idle.kind === 'idle', idle.kind)
  assert('pill-demo=idle -> panel has schedule', idle.kind === 'idle' && idle.panel.schedule !== null)
  // Absent / invalid -> null -> component falls back to real polling.
  assert('no pill-demo param -> null', forcedStatusFromQuery('') === null)
  assert('pill-demo=bogus -> null', forcedStatusFromQuery('?pill-demo=bogus') === null)
  assert('other params ignored -> null', forcedStatusFromQuery('?foo=bar&x=1') === null)
}

console.log('')
if (failures > 0) { console.log(`${failures} assertion(s) failed.`); process.exit(1) }
else console.log('All assertions passed.')
