// Pure, I/O-free core of the Tier-1 interaction-tracking system.
//
// WHAT THIS IS: the fixed taxonomy of guest-interaction events we count, plus
// the validation/normalisation helpers that both the client transport
// (trackInteraction) and the write endpoint (/api/track) share. Deliberately
// pure — no Redis, no Prisma, no `window` — so the whole event contract is
// unit-testable in isolation (scripts/test-interaction-events.mjs) and so the
// SAME allowlist guards both ends: the client only emits known keys, and the
// server independently re-validates every incoming key against this same list.
//
// WHY AN ALLOWLIST (not free-form event names): Tier-1 counters live one row
// per (eventWindow, interactionKey) in Postgres. A closed, code-defined set of
// interaction keys is what caps cardinality and makes the numbers legible — an
// attacker (or a bug) spraying arbitrary keys at /api/track can never create
// rows or inflate storage, because the server drops anything not in
// INTERACTION_KEYS before it touches Redis. This mirrors how isValidSource
// (lib/redis.ts) gates the ingest path.
//
// IDENTIFIER-FREE BY CONSTRUCTION (Tier-1): nothing in this module carries or
// derives a person-level identifier. An interaction record is just
// { key, objectId? } where objectId is a CATALOG object id (e.g. "M57") — a
// property of the SKY, not the viewer. The optional consented viewerId (Tier-2)
// is attached by the caller OUTSIDE this module and only when
// hasAnalyticsConsent() is true; this core never sees it. See the report's
// "Tier-1 identifier-free proof" section.

// ---- The interaction taxonomy ----
// One entry per distinct thing we count. Adding a counter = adding a line here
// (and the server accepts it automatically). Grouped by area for readability;
// the values are the stable wire keys (never rename without a data migration —
// they become Postgres row identities).
export const INTERACTION_KEYS = [
  // Live viewing surface
  'history_pill_tap', // guest opened an earlier target from the history strip (objectId set)
  'object_info_open', // guest opened the "more about this view" drawer (objectId set)
  'fullscreen_enter', // guest entered fullscreen (count only)

  // Farewell scene
  'farewell_scene_ufo', // the UFO farewell scene was shown to a guest
  'farewell_scene_eclipse', // the eclipse farewell scene was shown to a guest
  'farewell_ufo_tap', // a counted tap on the UFO (pre-finale; UFO scene only)
  'farewell_finale_reached', // the UFO finale fired (terminal; UFO scene only)
  'eclipse_totality_reached', // a guest tapped the eclipse through to totality (eclipse scene only; the eclipse's engagement analogue of the UFO finale)

  // Review / testimonial funnel — the FOUR variants tracked separately so
  // finder-vs-baseline conversion is comparable (see the spec's Part 2 routing).
  // Impression = the ask became visible; click = the guest tapped through.
  'funnel_whatsapp_impression', // baseline WhatsApp option shown
  'funnel_whatsapp_click', // baseline WhatsApp option clicked -> WHATSAPP_URL
  'funnel_baseline_review_impression', // baseline review option shown
  'funnel_baseline_review_click', // baseline review option clicked -> REVIEW_URL
  'funnel_finder_review_impression', // finder (easter-egg) review ask shown
  'funnel_finder_review_click', // finder review ask clicked -> REVIEW_URL

  // In-event review prompt — the small toast shown DURING a live session
  // (start+40min), separate from the farewell asks above so in-event vs.
  // farewell conversion is comparable. impression = toast faded in; click =
  // tapped through to REVIEW_URL; dismiss = tapped ✕ (measures annoyance).
  'funnel_inevent_review_impression',
  'funnel_inevent_review_click',
  'funnel_inevent_review_dismiss',

  // Tonight's Sky (/sky-calendar) — aggregate interest signals, identifier-free.
  'sky_city_select', // guest opened a city's conditions (objectId = city id, e.g. "kos") — which markets people care about
  'sky_full_detail', // guest opened Full detail (the altitude chart) — is the depth wanted (count only)
  'sky_date_bucket', // which night the guest is viewing, BUCKETED (objectId = "tonight" | "soon" | "later") — do people plan ahead? Bucketed (never an exact date) to stay identifier-free.
] as const

export type InteractionKey = (typeof INTERACTION_KEYS)[number]

const INTERACTION_KEY_SET: ReadonlySet<string> = new Set(INTERACTION_KEYS)

export function isInteractionKey(value: unknown): value is InteractionKey {
  return typeof value === 'string' && INTERACTION_KEY_SET.has(value)
}

// The subset of keys that carry an objectId (a catalog object). For every other
// key an objectId is meaningless and is dropped, so counters stay clean.
const OBJECT_SCOPED_KEYS: ReadonlySet<string> = new Set<InteractionKey>([
  'history_pill_tap',
  'object_info_open',
  // sky_city_select carries a CITY id (kos/bodrum/...) in the objectId slot —
  // same generic short-string mechanism, so per-city tallies separate cleanly.
  'sky_city_select',
  // sky_date_bucket carries a coarse bucket (tonight/soon/later), not a date.
  'sky_date_bucket',
])

export function keyTakesObjectId(key: InteractionKey): boolean {
  return OBJECT_SCOPED_KEYS.has(key)
}

// A catalog objectId is a short token like "M57" / "ALBIREO" (see
// config/catalog.json). We never trust the client's string blindly: cap length
// and restrict to the character class catalog ids actually use, so the objectId
// dimension of a counter can't be abused to smuggle arbitrary/high-cardinality
// values into the key space. Anything failing this is treated as "no objectId"
// (the counter still increments, just without the object dimension) rather than
// rejecting the whole event — a malformed id must never cost us the tally.
const OBJECT_ID_MAX = 24
const OBJECT_ID_RE = /^[A-Za-z0-9_-]{1,24}$/

export function normalizeObjectId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > OBJECT_ID_MAX) return null
  return OBJECT_ID_RE.test(trimmed) ? trimmed : null
}

// ---- The counter field name ----
// Each event window is one Redis hash (and, on flush, one Postgres row set)
// whose FIELDS are these counter names. For an object-scoped key we suffix the
// objectId so per-object tallies are separable ("history_pill_tap:M57"); for a
// plain key the field is just the key. This is the single place that mapping
// lives, so the increment path and the read/flush path can never disagree.
export function counterField(key: InteractionKey, objectId: string | null): string {
  if (objectId && keyTakesObjectId(key)) {
    return `${key}:${objectId}`
  }
  return key
}

// Parse a counterField back into its parts (used by the flush/read side to
// re-expand a hash into rows). Returns null for anything that isn't a known
// key — a defensive guard so a stray hash field can never become a row.
export function parseCounterField(field: string): { key: InteractionKey; objectId: string | null } | null {
  const colon = field.indexOf(':')
  if (colon === -1) {
    return isInteractionKey(field) ? { key: field, objectId: null } : null
  }
  const key = field.slice(0, colon)
  const objectId = field.slice(colon + 1)
  if (!isInteractionKey(key) || !keyTakesObjectId(key)) return null
  const normalized = normalizeObjectId(objectId)
  if (!normalized) return null
  return { key, objectId: normalized }
}

// ---- Validation of a raw inbound event (server side) ----
// Turns an untrusted { key, objectId? } into a validated, normalised record, or
// null if the key isn't in the allowlist. Never throws.
export type InteractionEvent = { key: InteractionKey; objectId: string | null }

export function validateInteractionEvent(raw: unknown): InteractionEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const candidateKey = (raw as { key?: unknown }).key
  if (!isInteractionKey(candidateKey)) return null
  const objectId = keyTakesObjectId(candidateKey)
    ? normalizeObjectId((raw as { objectId?: unknown }).objectId)
    : null
  return { key: candidateKey, objectId }
}
