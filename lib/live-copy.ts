// Rotating flavor-text for the /live page. PRESENTATIONAL ONLY — this module
// picks a friendly line to sit *underneath* the factual status heading; it
// never feeds the state machine (lib/live-status.ts) or changes what the page
// decides to show. LiveView calls pickFlavor() on an interval to rotate the
// line; the fact above it is never touched.

// How often LiveView re-picks a flavor line.
export const FLAVOR_ROTATE_MS = 8 * 1000

// Don't repeat a line while it's still one of the last N shown. Capped per-pool
// so a small pool (e.g. NOTHING has 3 lines) always has a candidate left.
export const FLAVOR_NO_REPEAT_WINDOW = 3

// ---------------------------------------------------------------------------
// Hotel display names
// ---------------------------------------------------------------------------

const HOTEL_DISPLAY_NAMES: Record<string, string> = {
  'astir-odysseus': 'Astir Odysseus',
  'oku-kos': 'OKU Kos',
  'paralos-kyma-dunes': 'Paralos Kyma Dunes',
  'caravia-beach': 'Caravia Beach',
}

// Pretty name for a hotel slug. Falls back to a title-cased version of the slug
// for unknown/adhoc ids (e.g. a one-off "sunset-beach" -> "Sunset Beach") so an
// unmapped hotel still reads cleanly instead of leaking a raw slug.
export function hotelDisplayName(id: string): string {
  const known = HOTEL_DISPLAY_NAMES[id]
  if (known) return known
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// hotelId -> logo asset under /public/images/logos. SVG preferred where one
// exists (scales cleanly at any display size, no raster blur); PNG otherwise.
// Source images have wildly inconsistent aspect ratios (near-square to
// tall-narrow to wide-short) — LiveView renders this at a fixed HEIGHT with
// auto width so that variance never distorts the logo.
const HOTEL_LOGOS: Record<string, string> = {
  'astir-odysseus': '/images/logos/astirlogo.png',
  'oku-kos': '/images/logos/okukoslogo.png',
  'paralos-kyma-dunes': '/images/logos/paralos-kyma-dunes.svg',
  'caravia-beach': '/images/logos/caravialogo.png',
}

// Logo path for a hotel slug, or null if this hotel has no logo asset (e.g. an
// "adhoc" hotelId, or a hotel not yet added to HOTEL_LOGOS) — callers render
// nothing rather than a broken image.
export function hotelLogoSrc(id: string): string | null {
  return HOTEL_LOGOS[id] ?? null
}

// ---------------------------------------------------------------------------
// Flavor-text pools
// ---------------------------------------------------------------------------
// One array per situation. GENERAL is the big object-agnostic all-day pool; the
// rest are situational. SOON lines may contain {hotel} and {start} placeholders,
// interpolated at pick time (interpolation is applied to every pool, so the
// placeholders are safe to use anywhere — they're just no-ops when absent).

export type FlavorSituation =
  | 'GENERAL'
  | 'APPROACHING'
  | 'SOON'
  | 'WAITING_FEED'
  | 'CANCELLED'
  | 'ENDED'
  | 'NOTHING'

export const FLAVOR_POOLS: Record<FlavorSituation, string[]> = {
  // The big all-day pool. Object-agnostic — safe to show at any hour.
  GENERAL: [
    "Warming up the photons.",
    "Warming up the optics.",
    "Aligning the mount and our expectations.",
    "13.8 billion years in the making — what's a few more hours?",
    "Currently observing: the inside of the lens cap.",
    "Polar aligning. The North Star is being cooperative for once.",
    "The telescope is doing its stretches.",
    "Somewhere out there, a photon left a galaxy for us. It's still on its way.",
    "Dark skies don't rush. Neither do we.",
    "Collimating. It's more romantic than it sounds.",
    "Waiting for the sun to take the hint.",
    "Every star you'll see tonight is already old news — beautifully so.",
    "Cooling the sensor. Chilling the vibe.",
    "The mount is tracked, the coffee is poured.",
    "Light pollution: low. Anticipation: high.",
    "The sky's still deciding what to show off.",
    "Focusing — on the stars, and on being ready.",
    "We don't make the stars. We just make the introductions.",
    "Even light takes eight minutes to get here from the sun. Patience.",
    "The best seat in the house faces straight up.",
    "Stacking frames, stacking anticipation.",
    "The dark is worth the wait.",
    "Tonight's forecast: clear skies with a high chance of wonder.",
    "Somewhere above the Aegean, the night is getting ready.",
    "Two thousand stars, one horizon, no rush.",
    "The lens is clean. The sky is next.",
    "Chasing photons is a patient sport.",
    "Turning off the lights so the universe can turn on.",
    "First we wait for dark. Then the good part.",
    "The Aegean sky keeps its best secrets for after sunset.",
    "Every clear night is a small miracle. Tonight looks promising.",
    "Somewhere, ancient light is about to finish a very long trip.",
    "The telescope's ready. The universe is always ready. Just need the dark.",
    "Good things come to those who look up.",
    "The horizon's holding onto the last of the daylight. Almost.",
    "Settling the mount, steadying the sky.",
    "A little patience buys a lot of universe.",
    "The stars have been waiting billions of years. They'll wait for you.",
    "Best commute in the galaxy — just look up.",
    "Somewhere out there is tonight's first target. We'll find it together.",
    "The Milky Way rises over the Aegean every summer night. Tonight, we point at it together.",
    "Five seasons of chasing light on Kos. Tonight's another one.",
    "Salt air, dark skies, and a telescope. Not a bad way to spend an evening.",
    "The same stars the ancient Greeks named, still up there. We'll show you.",
    "The mount is aligned, the night is young.",
    "Best show on Kos starts after dark.",
    "Jupiter, Saturn, or a galaxy far away — the sky decides tonight's stars.",
    "Tonight's targets are so far away, their light is older than the human race.",
    "The Aegean gets dark, and then it gets interesting.",
    "Under this sky, every night has something worth seeing.",
  ],
  // ~60–30 min before start.
  APPROACHING: [
    "The sun's clocking out. Our shift's about to start.",
    "Golden hour's fading to blue. Blue fades to black. Then the magic.",
    "The horizon's letting go of the last light.",
    "Nearly dark enough to misbehave with a telescope.",
    "The first stars are testing the water.",
    "Twilight's doing its slow fade. Almost our cue.",
    "The sky's dimming the lights for the main act.",
    "Half an hour or so until the universe shows up.",
    "The Aegean's going quiet and dark — just how we like it.",
    "Setting up while the sky finishes getting dressed.",
  ],
  // ~30 min → start. May use {hotel} and {start}.
  SOON: [
    "Starting soon — see you at {hotel}, {start}.",
    "Almost showtime. See you under the stars at {hotel}.",
    "Nearly there — first light is minutes away at {hotel}.",
    "Grab a spot at {hotel}. The sky's nearly ready for you.",
    "The telescope's warming up at {hotel}. See you at {start}.",
    "See you at {hotel} in a few minutes. Bring your sense of wonder.",
    "Almost time. See you at {hotel}, {start}.",
    "The stars are lining up. Join us at {hotel}, {start}.",
    "Minutes away — {hotel}, {start}, eyes up.",
    "We're nearly pointed at something wonderful. See you at {hotel}.",
    "Last call for the best seat under the sky — {hotel}, {start}.",
    "The telescope's aimed and ready. See you at {hotel} in a few.",
    "First light's minutes off. Find us at {hotel}, {start}.",
    "The dark's arrived, the mount's ready. See you at {hotel}, {start}.",
    "Wrapping up setup at {hotel}. {start} — see you under the stars.",
    "Nearly showtime at {hotel}. Come find us, {start}.",
  ],
  // Past start, telescope feed not up yet.
  WAITING_FEED: [
    "Any second now — the telescope's finding its bearings.",
    "First light incoming. The universe is buffering.",
    "We're on-site and getting aligned. Hang tight.",
    "Almost there — coaxing the first frame out of the dark.",
    "Setting up under the stars. The view's worth the wait.",
    "Nearly there — the telescope's blinking awake.",
    "On-site, aligning the mount. First frame's coming.",
    "The camera's cooling, the sky's clearing. Moments away.",
    "Getting our bearings under the stars. Stay with us.",
    "Almost live — teasing the first photons out of the dark.",
    "The telescope found the sky. Now it's finding focus.",
    "Setup's nearly done. The universe is worth these last minutes.",
  ],
  // Tonight is cancelled.
  CANCELLED: [
    "Clouds won this round. The sky owes us one.",
    "Tonight's forecast: too much atmosphere.",
    "Rain check — literally. Clear skies soon, we hope.",
    "The sky had other plans tonight. We'll be back.",
    "The weather made the call, not us. See you next session.",
    "No stars tonight — but they're not going anywhere. We'll be back.",
    "Tonight's off, but the sky's patient. So are we.",
    "Mother Nature vetoed this one. Next clear night, we're on.",
  ],
  // Tonight already ended.
  ENDED: [
    "That's a wrap on tonight's sky. Same time, next star.",
    "The photons have gone home. Thanks for looking up with us.",
    "Tonight's stars have clocked out. See you next session.",
    "The sky's closing up shop for tonight. Thanks for watching.",
    "Last photon's in. That's tonight's show — see you next time.",
    "The telescope's cooling down. The memories aren't.",
    "Tonight's stars have set on our watch. Same sky, next session.",
    "That's all the universe we're showing tonight. Come back soon.",
  ],
  // No event tonight / nothing scheduled.
  NOTHING: [
    "The telescope is resting. Even light takes a night off.",
    "No session tonight — but the sky's always on. Look up anyway.",
    "Quiet night for us. The universe carries on without an audience.",
  ],
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

// The offline sub-states the /live state machine can be in (mirrors the
// uiState values 'offline-cancelled' | 'offline-event-tonight' | 'offline-nothing').
export type OfflineSubState = 'cancelled' | 'event-tonight' | 'nothing'

export type FlavorContext = {
  // Which offline sub-state the page is in, or null when there is no event
  // context at all (e.g. checking/degraded) — treated as GENERAL.
  subState: OfflineSubState | null
  // Tonight's event, when known. Drives the time tiers and {hotel}/{start}.
  tonight: { hotelId: string; start: string; end: string } | null
  // Injectable clock for tests; defaults to the real current time. The tiers
  // are computed against Athens-local time regardless of the host timezone.
  now?: Date
}

// "HH:MM" -> minutes since midnight, or null if malformed.
function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

// Minutes since Athens-local midnight for a given instant.
function athensMinutesOfDay(d: Date): number {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return hhmmToMinutes(hhmm) ?? 0
}

// Decide which pool applies. Time tiers are measured in minutes until
// tonight.start (positive = before start) in Athens-local time:
//   > 60          -> GENERAL       (event tonight, but hours away)
//   (30, 60]      -> APPROACHING
//   [0, 30]       -> SOON
//   past start,
//     before end  -> WAITING_FEED
//     at/after end -> ENDED
// CANCELLED and NOTHING map straight from the sub-state; anything with no event
// context falls back to GENERAL.
export function resolveSituation(context: FlavorContext): FlavorSituation {
  const { subState, tonight } = context

  if (subState === 'cancelled') return 'CANCELLED'
  if (subState === 'nothing') return 'NOTHING'

  if (subState === 'event-tonight' && tonight) {
    const nowMin = athensMinutesOfDay(context.now ?? new Date())
    const startMin = hhmmToMinutes(tonight.start)
    const endMin = hhmmToMinutes(tonight.end)

    // Unparseable start — fall back to the safe all-day pool.
    if (startMin === null) return 'GENERAL'

    const minutesUntilStart = startMin - nowMin

    if (minutesUntilStart > 60) return 'GENERAL'
    if (minutesUntilStart > 30) return 'APPROACHING'
    if (minutesUntilStart >= 0) return 'SOON'

    // Past start.
    if (endMin !== null && nowMin >= endMin) return 'ENDED'
    return 'WAITING_FEED'
  }

  // No event context (checking/degraded, or event-tonight with a missing
  // tonight payload) — the all-day general pool.
  return 'GENERAL'
}

// Interpolate {hotel} and {start}. A no-op when tonight is null or the line has
// no placeholders.
function interpolate(line: string, tonight: FlavorContext['tonight']): string {
  if (!tonight) return line
  return line
    .replace(/\{hotel\}/g, hotelDisplayName(tonight.hotelId))
    .replace(/\{start\}/g, tonight.start)
}

// Pick one random line from `options`, avoiding any in `recent` when possible.
// The avoid-window is capped at options.length - 1 so there is always at least
// one eligible line even for tiny pools (avoiding fewer of the most-recent
// rather than emptying the candidate set).
function pickFrom(options: string[], recent: string[]): string {
  const avoidCount = Math.min(recent.length, options.length - 1)
  const avoid = new Set(recent.slice(-avoidCount))
  const candidates = options.filter((option) => !avoid.has(option))
  const from = candidates.length > 0 ? candidates : options
  return from[Math.floor(Math.random() * from.length)]
}

// Pick one random line from the pool that matches the context, with {hotel} /
// {start} interpolated, avoiding any line in `recent` (the last few already
// shown) so the same line doesn't repeat back-to-back. Avoidance is done on the
// final interpolated text, so caller-tracked history compares apples to apples.
// Returns '' when the chosen pool is empty — LiveView renders nothing then.
export function pickFlavor(context: FlavorContext, recent: string[] = []): string {
  const pool = FLAVOR_POOLS[resolveSituation(context)]
  if (pool.length === 0) return ''
  const options = pool.map((line) => interpolate(line, context.tonight))
  return pickFrom(options, recent)
}
