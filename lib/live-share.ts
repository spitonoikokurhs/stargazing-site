// Guest share-message composition for /live. PURELY CLIENT-SIDE by design: no
// network call, no storage, nothing sent to any backend — callers only ever
// hand the composed string to the guest's own share sheet / deep link / copy
// action. See app/live/LiveView.tsx for where this is used.

// Auto-line pools — exact content as specified. {name} is substituted at
// render time (KNOWN_OBJECT_LINES only); NO_CONFIDENT_NAME_LINES has no
// placeholder and deliberately contains no location references.
export const KNOWN_OBJECT_LINES = [
  '{name} is having its close-up, live',
  'Watching {name} live — no filter, just a lot of light-years',
  'Light that left {name} long ago just landed on my phone',
  '{name}, live and lightyears away',
  'Photons from {name} travelled all this way just to reach my screen',
  'Currently having a staring contest with {name}',
  'Some light travels millions of years for a moment like this — meet {name}',
  '{name} is trending in my telescope right now',
  '{name}: been glowing since before humans, live on my screen',
]

export const NO_CONFIDENT_NAME_LINES = [
  'Watching the night sky live through the telescope at stargazing.events',
  'The universe, live right now',
  'Watching deep space live',
  'The night sky, live and unfiltered',
  'Watching the universe do its thing, live',
  'Out of this world and live on my phone',
  'Deep space, live and direct',
  'Somewhere out there, live',
  'Stargazing, minus the neck strain',
  'Live from the dark, beautiful nowhere',
  'A little piece of infinity, live',
  "The sky's putting on a show tonight",
  'Certified stardust, live',
]

export const LIVE_URL = 'https://stargazing.events/live'

export function pickRandomLine(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)]
}

// Fill {name} in a KNOWN_OBJECT_LINES template. No-op for lines without the
// placeholder (defensive; every current line has it).
export function fillName(template: string, name: string): string {
  return template.replace(/\{name\}/g, name)
}

// Composition rule: [auto-line] + newline + URL. No guest-typed portion —
// the share panel is icon-only, per the confirmed v1 scope.
export function composeShareText(autoLine: string): string {
  return `${autoLine}\n${LIVE_URL}`
}
