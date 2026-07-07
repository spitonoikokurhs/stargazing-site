// Type -> one-line, guest-friendly definition, shown next to the object-type
// icon when a catalog object is matched (see app/live/LiveView.tsx). Keyed on
// the catalog's own "type" string (config/catalog.json), so a new catalog
// entry with an existing type value gets a definition for free.
export const TYPE_DEFINITIONS: Record<string, string> = {
  Galaxy: 'A vast island of billions of stars.',
  'Spiral Galaxy': 'A vast island of billions of stars, arranged in sweeping arms.',
  'Irregular Galaxy': 'A vast island of billions of stars, shaped by chaos rather than symmetry.',
  'Galaxy Group': 'Several galaxies bound together, drifting through space as one.',
  'Diffuse Nebula': 'A glowing cloud of gas where stars are born.',
  'Planetary Nebula': 'The glowing farewell of a dying star.',
  'Supernova Remnant': 'The glowing debris of a star that exploded.',
  'Globular Cluster': 'A dense, ancient ball of thousands of stars.',
  'Open Cluster': 'A loose group of young stars born together.',
  // Distinct from Open Cluster: a star cloud isn't a gravitationally bound
  // group at all, just a dense window through our own galaxy's dust where
  // many unrelated background stars happen to line up (e.g. M24 — see
  // config/catalog.json). Retyped from 'Open Cluster' after a content
  // review flagged the mismatch.
  'Star Cloud': 'A dense window through our galaxy’s dust, packed with countless background stars.',
  Planet: 'A world orbiting our own Sun.',
  Moon: 'Our nearest neighbor in space.',
  // Not present in the catalog yet — defined ahead of time so a future
  // catalog entry with any of these types picks up an icon+definition for free.
  'Double Star': 'Two stars orbiting each other, closer than they look.',
  Comet: 'A ball of ice and dust growing a tail near the Sun.',
  'Reflection Nebula': "A cloud of dust lit up by a nearby star's light.",
}

export function typeDefinition(type: string): string | null {
  return TYPE_DEFINITIONS[type] ?? null
}
