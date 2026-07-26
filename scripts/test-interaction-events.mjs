// Pure-logic tests for the Tier-1 interaction taxonomy + helpers
// (lib/interaction-events.ts), the client tracking-context derivation
// (lib/track-client.ts), and the review-funnel URL/prefill (lib/review-funnel.ts).
// No I/O, no browser — mirrors scripts/test-consent.mjs's in-memory style.
//
// Run with: node --import tsx scripts/test-interaction-events.mjs
import {
  INTERACTION_KEYS,
  isInteractionKey,
  keyTakesObjectId,
  normalizeObjectId,
  counterField,
  parseCounterField,
  validateInteractionEvent,
} from '../lib/interaction-events.ts'
import { deriveEventSlug, trackingContextFor } from '../lib/track-client.ts'
import { whatsappUrl, REVIEW_URL } from '../lib/review-funnel.ts'

let failures = 0
function assert(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`)
  else { failures++; console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

// ---- allowlist ----
assert('allowlist non-empty', INTERACTION_KEYS.length >= 10)
assert('known key recognised', isInteractionKey('history_pill_tap'))
assert('unknown key rejected', !isInteractionKey('evil_key'))
assert('non-string rejected', !isInteractionKey(42) && !isInteractionKey(null) && !isInteractionKey(undefined))
assert('all four funnel variants present',
  ['funnel_whatsapp_click', 'funnel_baseline_review_click', 'funnel_finder_review_click', 'funnel_whatsapp_impression']
    .every((k) => isInteractionKey(k)))
assert('eclipse totality key present', isInteractionKey('eclipse_totality_reached'))
assert('eclipse totality is NOT object-scoped', !keyTakesObjectId('eclipse_totality_reached'))

// ---- object-scoped keys ----
assert('history_pill_tap is object-scoped', keyTakesObjectId('history_pill_tap'))
assert('object_info_open is object-scoped', keyTakesObjectId('object_info_open'))
assert('fullscreen_enter is NOT object-scoped', !keyTakesObjectId('fullscreen_enter'))
assert('funnel click is NOT object-scoped', !keyTakesObjectId('funnel_whatsapp_click'))

// ---- objectId normalisation (guards cardinality/abuse) ----
assert('valid catalog id kept', normalizeObjectId('M57') === 'M57')
assert('hyphenated id kept', normalizeObjectId('NGC6960-6992') === 'NGC6960-6992')
assert('whitespace trimmed', normalizeObjectId('  M42  ') === 'M42')
assert('empty -> null', normalizeObjectId('') === null && normalizeObjectId('   ') === null)
assert('too long -> null', normalizeObjectId('X'.repeat(25)) === null)
assert('illegal chars -> null', normalizeObjectId('M57;DROP') === null && normalizeObjectId('a b') === null)
assert('non-string -> null', normalizeObjectId(123) === null && normalizeObjectId(null) === null)

// ---- counterField round-trip ----
assert('object-scoped field suffixes objectId', counterField('history_pill_tap', 'M57') === 'history_pill_tap:M57')
assert('plain key field is just the key', counterField('fullscreen_enter', null) === 'fullscreen_enter')
assert('objectId ignored for non-object key', counterField('fullscreen_enter', 'M57') === 'fullscreen_enter')
{
  const p = parseCounterField('history_pill_tap:M57')
  assert('parse object field', p && p.key === 'history_pill_tap' && p.objectId === 'M57')
}
{
  const p = parseCounterField('fullscreen_enter')
  assert('parse plain field', p && p.key === 'fullscreen_enter' && p.objectId === null)
}
assert('parse unknown field -> null', parseCounterField('evil:M57') === null && parseCounterField('nope') === null)
assert('parse non-object key with colon -> null', parseCounterField('fullscreen_enter:M57') === null)
assert('parse bad objectId -> null', parseCounterField('history_pill_tap:a b') === null)

// ---- validateInteractionEvent (server-side untrusted input) ----
assert('valid plain event', JSON.stringify(validateInteractionEvent({ key: 'fullscreen_enter' })) === JSON.stringify({ key: 'fullscreen_enter', objectId: null }))
assert('valid object event', JSON.stringify(validateInteractionEvent({ key: 'history_pill_tap', objectId: 'M57' })) === JSON.stringify({ key: 'history_pill_tap', objectId: 'M57' }))
assert('object id dropped for non-object key', validateInteractionEvent({ key: 'fullscreen_enter', objectId: 'M57' }).objectId === null)
assert('bad object id -> null objectId, event still valid', validateInteractionEvent({ key: 'history_pill_tap', objectId: 'a b' }).objectId === null)
assert('unknown key -> null (dropped)', validateInteractionEvent({ key: 'evil' }) === null)
assert('missing key -> null', validateInteractionEvent({}) === null)
assert('non-object -> null', validateInteractionEvent(null) === null && validateInteractionEvent('x') === null)
assert('extra fields ignored', validateInteractionEvent({ key: 'fullscreen_enter', viewerId: 'sneaky', ip: '1.2.3.4' }).objectId === null)

// ---- tracking context (demo/debug suppression) ----
assert('hotel path enabled', trackingContextFor('/api/status', false).enabled === true)
assert('special-event path enabled + slug', (() => { const c = trackingContextFor('/api/status?event=parnonas', false); return c.enabled && c.eventSlug === 'parnonas' })())
assert('demo path DISABLED', trackingContextFor('/api/demo-status?demo=plaza', false).enabled === false)
assert('debug mode DISABLED even on status', trackingContextFor('/api/status?debug=1', true).enabled === false)
// The /live?demo= LOCAL test mode (getDemoMode) keeps statusUrl '/api/status' —
// the third param is the only thing that can see it, and it must kill tracking
// so operator test runs never pollute a real night's counters.
assert('local ?demo= mode DISABLED on real statusUrl', trackingContextFor('/api/status', false, 'history-test').enabled === false)
assert('local demo also kills special-event tracking', trackingContextFor('/api/status?event=parnonas', false, 'known-nebula').enabled === false)
assert('local demo null -> unchanged (enabled)', trackingContextFor('/api/status', false, null).enabled === true)
assert('local demo disabled context has null slug', trackingContextFor('/api/status?event=parnonas', false, 'known-nebula').eventSlug === null)
assert('deriveEventSlug hotel -> null', deriveEventSlug('/api/status') === null)
assert('deriveEventSlug event -> slug', deriveEventSlug('/api/status?event=oku-kos') === 'oku-kos')

// ---- review funnel URLs ----
assert('review url is the google form', REVIEW_URL.includes('g.page'))
assert('whatsapp url has wa.me + number', whatsappUrl('oku-kos').startsWith('https://wa.me/306947772928?text='))
assert('whatsapp prefill includes venue', decodeURIComponent(whatsappUrl('oku-kos')).includes('OKU') || decodeURIComponent(whatsappUrl('oku-kos')).includes('Oku'))
assert('whatsapp generic when no venue', !decodeURIComponent(whatsappUrl(null)).includes('  ') && decodeURIComponent(whatsappUrl(null)).includes('stargazing'))
assert('whatsapp text is url-encoded (has %)', whatsappUrl('oku-kos').includes('%'))

console.log('')
if (failures > 0) { console.log(`${failures} interaction-events test(s) FAILED`); process.exit(1) }
console.log('All interaction-events tests passed.')
