// Catalog type -> accent color, driving the type pill's label color, border,
// and faint tinted background (see .type-pill in app/live/styles.css). Keyed
// on the same catalog "type" strings as lib/object-types.ts.
export const TYPE_COLORS: Record<string, string> = {
  'Diffuse Nebula': '#E06A9F',
  'Reflection Nebula': '#6FA8E8',
  'Planetary Nebula': '#35C7B7',
  'Supernova Remnant': '#F0784E',
  'Open Cluster': '#B8D7F2',
  // Distinct from Open Cluster's pale blue — a star cloud isn't a bound
  // cluster (see lib/object-types.ts), so it gets its own warm, dense-field
  // color rather than sharing the cluster hue.
  'Star Cloud': '#E8D9B0',
  'Globular Cluster': '#D6A94B',
  Galaxy: '#B69CFF',
  // Specific galaxy morphologies share the base Galaxy violet — only the
  // group case gets a visually distinct (deeper/bluer) shade below.
  'Spiral Galaxy': '#B69CFF',
  'Irregular Galaxy': '#B69CFF',
  // Deliberately deeper/bluer than Galaxy's #B69CFF so a Galaxy Group pill
  // reads as related-but-distinct, not identical.
  'Galaxy Group': '#8B7FE8',
  Planet: '#C98A5C',
  Moon: '#BFC0C8',
  'Double Star': '#F0D36B',
  Comet: '#9BE4EA',
}

// Neutral gold/grey fallback for a type string with no color mapping, so an
// unmapped/future catalog type still renders a sensible pill instead of
// nothing or a jarring default.
const FALLBACK_COLOR = '#A8A6A0'

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? FALLBACK_COLOR
}
