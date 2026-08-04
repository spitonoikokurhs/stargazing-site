// Inline-SVG icons for the Tonight's Sky page — flags, the moon, and planets.
// All pure/presentational server components: no client JS, no external assets,
// no emoji. Emoji were the previous approach but rendered inconsistently (the
// moon came out cartoon-cheese-yellow on Windows, and country flags fell back
// to two-letter boxes because Windows ships no flag-emoji font). Hand-authored
// SVG renders identically everywhere and lets us tune the palette to the page.

// ---------------------------------------------------------------------------
// Moon — drawn from the illuminated fraction, not a fixed set of phase faces.
// A single disc with a cool silver face; the un-lit part is covered by a dark
// overlay whose inner edge is the terminator (a half-ellipse). waxing => the
// lit limb is on the RIGHT, waning => on the LEFT, matching how the sky looks.
// ---------------------------------------------------------------------------
export function MoonPhaseIcon({
  fraction,
  waxing,
  size = 48,
  title,
}: {
  fraction: number // 0 (new) .. 1 (full)
  waxing: boolean
  size?: number
  title?: string
}) {
  const f = Math.max(0, Math.min(1, fraction))
  const r = 50
  const cx = 50
  const cy = 50
  const topY = cy - r // 0
  const botY = cy + r // 100
  // The terminator is a half-ellipse whose horizontal semi-axis k = r·cos(π·f):
  //   f=0 (new)   -> k=+r  (shadow fills the whole disc)
  //   f=0.5 (half)-> k=0   (straight terminator down the middle)
  //   f=1 (full)  -> k=-r  (shadow vanishes)
  // The SHADOW region is: the outer semicircle on the DARK limb, closed by the
  // terminator ellipse. For WAXING the lit limb is on the right, so the dark
  // limb (outer arc) is on the LEFT; for WANING it's mirrored.
  const k = r * Math.cos(Math.PI * f)
  const termRx = Math.abs(k)

  // Draw top -> bottom down the dark limb, then terminator back up to the top.
  // Outer arc sweep: 0 hugs the LEFT limb, 1 hugs the RIGHT limb (for a top->
  // bottom traversal). Terminator sweep is chosen so the ellipse bulges toward
  // the LIT side on a crescent (k>0) and toward the DARK side on a gibbous
  // (k<0) — which for a fixed traversal direction is simply the sign of k.
  let outerSweep: number
  let termSweep: number
  if (waxing) {
    // dark limb on the left; traversal top->bottom hugs the left, terminator
    // returns bottom->top. Crescent (k>0) => terminator bulges RIGHT into the
    // lit side; gibbous (k<0) => bulges LEFT into the dark side.
    outerSweep = 0
    termSweep = k > 0 ? 0 : 1
  } else {
    // waning: mirror image (dark limb on the right).
    outerSweep = 1
    termSweep = k > 0 ? 1 : 0
  }

  const shadowPath =
    `M ${cx} ${topY} ` +
    `A ${r} ${r} 0 0 ${outerSweep} ${cx} ${botY} ` +
    `A ${termRx} ${r} 0 0 ${termSweep} ${cx} ${topY} Z`

  const gid = `moonlit-${waxing ? 'wax' : 'wan'}`
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? 'Moon phase'}
      className="sky-svg-moon"
    >
      <defs>
        <radialGradient id={gid} cx="38%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#f4f7fb" />
          <stop offset="55%" stopColor="#d7dee8" />
          <stop offset="100%" stopColor="#aeb8c6" />
        </radialGradient>
      </defs>
      {/* faint outer ring so a near-new moon still reads as a disc */}
      <circle cx={cx} cy={cy} r={r - 0.5} fill="#171d26" stroke="#2b3442" strokeWidth="1" />
      {/* lit face */}
      <circle cx={cx} cy={cy} r={r - 0.5} fill={`url(#${gid})`} />
      {/* subtle maria — small, soft, varied so the lit face reads as a textured
          moon rather than a few big blobs (the old large ellipses looked
          potato-ish at hero size). Two opacity tiers for gentle depth. */}
      <g fill="#b9c3d1">
        <ellipse cx="40" cy="42" rx="5.5" ry="4.5" opacity="0.42" />
        <ellipse cx="57" cy="36" rx="3.8" ry="3.2" opacity="0.38" />
        <ellipse cx="60" cy="57" rx="4.6" ry="3.8" opacity="0.4" />
        <ellipse cx="44" cy="60" rx="3.2" ry="2.6" opacity="0.34" />
        <ellipse cx="50" cy="48" rx="2.4" ry="2.1" opacity="0.28" />
        <circle cx="34" cy="52" r="1.6" opacity="0.3" />
        <circle cx="63" cy="45" r="1.4" opacity="0.26" />
        <circle cx="52" cy="66" r="1.3" opacity="0.24" />
      </g>
      {/* shadow overlay (the un-lit part) */}
      {f < 0.995 && <path d={shadowPath} fill="#12161e" opacity="0.94" />}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Planets — small characteristic discs. Venus: bright cream. Mars: rusty red.
// Jupiter: tan with belts. Saturn: pale gold with a ring. Mercury: grey.
// Keyed by the exact `name` the ephemeris uses (see planetsTonight).
// ---------------------------------------------------------------------------
export function PlanetIcon({ name, size = 26 }: { name: string; size?: number }) {
  const svg = (children: React.ReactNode, extraClass = '') => (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={name}
      className={`sky-svg-planet ${extraClass}`.trim()}
    >
      {children}
    </svg>
  )
  const key = name.toLowerCase()
  switch (key) {
    case 'venus':
      return svg(
        <>
          <defs>
            <radialGradient id="pl-venus" cx="36%" cy="32%" r="75%">
              <stop offset="0%" stopColor="#fff7e2" />
              <stop offset="70%" stopColor="#f2d999" />
              <stop offset="100%" stopColor="#d8b25f" />
            </radialGradient>
          </defs>
          <circle cx="20" cy="20" r="15" fill="url(#pl-venus)" />
        </>,
      )
    case 'mars':
      return svg(
        <>
          <defs>
            <radialGradient id="pl-mars" cx="36%" cy="32%" r="75%">
              <stop offset="0%" stopColor="#ff9d6b" />
              <stop offset="65%" stopColor="#e2572f" />
              <stop offset="100%" stopColor="#a63417" />
            </radialGradient>
            <clipPath id="pl-mars-clip">
              <circle cx="20" cy="20" r="15" />
            </clipPath>
          </defs>
          <circle cx="20" cy="20" r="15" fill="url(#pl-mars)" />
          {/* dark surface markings (Syrtis-like), clipped to the disc */}
          <g clipPath="url(#pl-mars-clip)" fill="#a5391c" opacity="0.55">
            <ellipse cx="24" cy="16" rx="4.5" ry="3.2" />
            <ellipse cx="15" cy="25" rx="3.5" ry="2.4" />
          </g>
          {/* polar ice cap: a thin frost cap hugging the top of the disc, not a
              floating dot */}
          <path d="M12 8.5 A 15 15 0 0 1 28 8.5 A 9 4 0 0 0 12 8.5 Z" clipPath="url(#pl-mars-clip)" fill="#f3ede6" opacity="0.9" />
        </>,
      )
    case 'jupiter':
      return svg(
        <>
          <defs>
            <radialGradient id="pl-jup" cx="36%" cy="30%" r="80%">
              <stop offset="0%" stopColor="#f6e6cf" />
              <stop offset="100%" stopColor="#c99f6f" />
            </radialGradient>
            <clipPath id="pl-jup-clip">
              <circle cx="20" cy="20" r="15" />
            </clipPath>
          </defs>
          <circle cx="20" cy="20" r="15" fill="url(#pl-jup)" />
          <g clipPath="url(#pl-jup-clip)" opacity="0.55">
            <rect x="5" y="12" width="30" height="2.6" fill="#b98c58" />
            <rect x="5" y="18" width="30" height="3.2" fill="#a9794a" />
            <rect x="5" y="24" width="30" height="2.4" fill="#c19b6b" />
          </g>
          <ellipse cx="25" cy="24" rx="3" ry="2" fill="#c96a4a" opacity="0.75" />
        </>,
      )
    case 'saturn':
      // One continuous ring around the planet: the FULL ring ellipse is drawn
      // first (so its far side shows above the planet's top), the planet disc is
      // drawn over it (occluding the ring's rear-behind portion), then the ring's
      // NEAR arc is drawn again on top so it crosses in front of the lower body.
      // Same ellipse geometry + same transform for every piece, so it always
      // reads as a single ring, not two mismatched ones.
      return svg(
        <g transform="rotate(-20 20 20)">
          <defs>
            <radialGradient id="pl-sat" cx="38%" cy="32%" r="80%">
              <stop offset="0%" stopColor="#f7edcf" />
              <stop offset="100%" stopColor="#cdaf72" />
            </radialGradient>
            <linearGradient id="pl-sat-ring" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#c9b17e" />
              <stop offset="50%" stopColor="#f0e2b4" />
              <stop offset="100%" stopColor="#c9b17e" />
            </linearGradient>
          </defs>
          {/* full ring (its top half will show above the planet) */}
          <ellipse cx="20" cy="20" rx="18.5" ry="6.4" fill="none" stroke="url(#pl-sat-ring)" strokeWidth="3" />
          {/* inner gap so the ring reads as a band, not a wire */}
          <ellipse cx="20" cy="20" rx="14.5" ry="4.6" fill="none" stroke="#0f1420" strokeWidth="1.1" opacity="0.5" />
          {/* the planet, occluding the ring's rear-behind section */}
          <circle cx="20" cy="20" r="11.5" fill="url(#pl-sat)" />
          {/* the ring's NEAR arc, crossing in front of the lower body */}
          <path d="M 1.7 21.6 A 18.5 6.4 0 0 0 38.3 21.6" fill="none" stroke="url(#pl-sat-ring)" strokeWidth="3" />
        </g>,
        'sky-svg-planet--saturn',
      )
    case 'mercury':
      return svg(
        <>
          <defs>
            <radialGradient id="pl-merc" cx="36%" cy="32%" r="75%">
              <stop offset="0%" stopColor="#d9dbde" />
              <stop offset="100%" stopColor="#8f9295" />
            </radialGradient>
          </defs>
          <circle cx="20" cy="20" r="14" fill="url(#pl-merc)" />
          <circle cx="24" cy="16" r="2" fill="#7c7f82" opacity="0.6" />
        </>,
      )
    default:
      return svg(<circle cx="20" cy="20" r="14" fill="#c7ced8" />)
  }
}

// ---------------------------------------------------------------------------
// Celestial-event icons for the "Coming up" list — meteor shower, lunar
// eclipse (coppery "blood" moon), solar eclipse. SVG, not emoji (the emoji
// ☄️🌕🌑 rendered inconsistently — the same reason the moon looked like cheese).
// ---------------------------------------------------------------------------
export function EventIcon({ kind, size = 30 }: { kind: string; size?: number }) {
  const frame = (children: React.ReactNode, label: string) => (
    <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={label} className="sky-svg-event">
      {children}
    </svg>
  )
  switch (kind) {
    case 'meteor-shower':
      return frame(
        <>
          <defs>
            <linearGradient id="ev-meteor" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff3d6" stopOpacity="0" />
              <stop offset="100%" stopColor="#ffd98a" />
            </linearGradient>
          </defs>
          {/* two streaks + heads */}
          <path d="M6 8 L24 26" stroke="url(#ev-meteor)" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="25" cy="27" r="3" fill="#fff0cf" />
          <path d="M16 6 L28 18" stroke="url(#ev-meteor)" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
          <circle cx="29" cy="19" r="2" fill="#ffe4ad" />
          {/* a couple of static stars */}
          <circle cx="10" cy="30" r="1" fill="#cfd8e6" />
          <circle cx="33" cy="9" r="1.2" fill="#cfd8e6" />
        </>,
        'Meteor shower',
      )
    case 'lunar-eclipse':
      return frame(
        <>
          <defs>
            <radialGradient id="ev-blood" cx="40%" cy="36%" r="70%">
              <stop offset="0%" stopColor="#e08a6a" />
              <stop offset="70%" stopColor="#a83c2a" />
              <stop offset="100%" stopColor="#6e2417" />
            </radialGradient>
          </defs>
          <circle cx="20" cy="20" r="14" fill="url(#ev-blood)" />
          <ellipse cx="16" cy="17" rx="4" ry="3" fill="#8a3020" opacity="0.5" />
          <ellipse cx="24" cy="24" rx="3.5" ry="3" fill="#8a3020" opacity="0.5" />
        </>,
        'Lunar eclipse',
      )
    case 'solar-eclipse':
      return frame(
        <>
          <defs>
            <radialGradient id="ev-corona" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#fff4cf" />
              <stop offset="100%" stopColor="#fff4cf" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="20" cy="20" r="17" fill="url(#ev-corona)" opacity="0.7" />
          <circle cx="20" cy="20" r="11" fill="#ffd98a" />
          {/* the Moon's dark disc sliding across */}
          <circle cx="24.5" cy="17.5" r="10" fill="#12161e" />
        </>,
        'Solar eclipse',
      )
    default:
      return frame(<circle cx="20" cy="20" r="12" fill="#c7ced8" />, 'Celestial event')
  }
}

// ---------------------------------------------------------------------------
// Rise / set arrows — a small up/down chevron over a horizon line, for the
// "rises"/"sets" labels beside planets (and anywhere a rise/set is shown).
// ---------------------------------------------------------------------------
export function RiseSetArrow({ dir, size = 13 }: { dir: 'rise' | 'set'; size?: number }) {
  const up = dir === 'rise'
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} role="img" aria-label={up ? 'rises' : 'sets'} className="sky-svg-arrow">
      {/* horizon */}
      <line x1="2" y1="12.5" x2="14" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
      {up ? (
        <path d="M8 2.5 L8 9.5 M5 5.5 L8 2.5 L11 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8 2.5 L8 9.5 M5 6.5 L8 9.5 L11 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Darkness-ladder icons — one distinctive glyph per twilight stage, so the
// "Darkness tonight" rows are scannable. Sun sinks lower (and the sky darkens)
// down the ladder: sunset -> civil -> nautical -> astronomical dark -> (dawn
// mirrors back up) -> sunrise. Keyed by an explicit `kind`, not the label text.
// ---------------------------------------------------------------------------
export type TwilightRowKind =
  | 'sunset'
  | 'civil-dusk'
  | 'nautical-dusk'
  | 'astro-dusk'
  | 'astro-dawn'
  | 'nautical-dawn'
  | 'civil-dawn'
  | 'sunrise'

export function TwilightIcon({ kind, size = 22 }: { kind: TwilightRowKind; size?: number }) {
  const frame = (children: React.ReactNode, label: string) => (
    <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={label} className="sky-svg-tw">
      {children}
    </svg>
  )
  // A sun sitting at/behind a horizon, with rays, in a warmth that cools as the
  // sky darkens. dusk arrow points down, dawn up.
  const sunDisc = (cx: number, cy: number, r: number, fill: string, rays = true) => (
    <>
      {rays && (
        <g stroke={fill} strokeWidth="1.4" strokeLinecap="round" opacity="0.85">
          <line x1={cx} y1={cy - r - 4} x2={cx} y2={cy - r - 1.5} />
          <line x1={cx - r - 3.5} y1={cy} x2={cx - r - 1.2} y2={cy} />
          <line x1={cx + r + 1.2} y1={cy} x2={cx + r + 3.5} y2={cy} />
          <line x1={cx - r - 2.6} y1={cy - r - 2.6} x2={cx - r - 1} y2={cy - r - 1} />
          <line x1={cx + r + 1} y1={cy - r - 1} x2={cx + r + 2.6} y2={cy - r - 2.6} />
        </g>
      )}
      <circle cx={cx} cy={cy} r={r} fill={fill} />
    </>
  )
  const horizon = (color = '#7c8794') => (
    <line x1="4" y1="21" x2="28" y2="21" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
  )
  const arrow = (down: boolean, color: string) =>
    down ? (
      <path d="M26 8 L26 14 M23.5 11.5 L26 14 L28.5 11.5" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M26 14 L26 8 M23.5 10.5 L26 8 L28.5 10.5" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    )

  switch (kind) {
    case 'sunset':
      return frame(<>{sunDisc(15, 18, 5, '#f2b25a')}{horizon('#caa15f')}{arrow(true, '#e6a24f')}</>, 'Sunset')
    case 'sunrise':
      return frame(<>{sunDisc(15, 18, 5, '#f7c877')}{horizon('#caa15f')}{arrow(false, '#f2c96b')}</>, 'Sunrise')
    case 'civil-dusk':
      return frame(<>{sunDisc(15, 22, 4.5, '#d98a54', false)}{horizon('#8794a6')}{arrow(true, '#b98a5c')}</>, 'Civil twilight (dusk)')
    case 'civil-dawn':
      return frame(<>{sunDisc(15, 22, 4.5, '#d9a06a', false)}{horizon('#8794a6')}{arrow(false, '#c99a6a')}</>, 'Civil twilight (dawn)')
    case 'nautical-dusk':
      return frame(<>{horizon('#6b7a8f')}<path d="M11 26 A 4.2 4.2 0 0 1 19 26 Z" fill="#5f74a6" opacity="0.9" />{arrow(true, '#6f82ad')}</>, 'Nautical twilight (dusk)')
    case 'nautical-dawn':
      return frame(<>{horizon('#6b7a8f')}<path d="M11 26 A 4.2 4.2 0 0 1 19 26 Z" fill="#6a80b4" opacity="0.9" />{arrow(false, '#7a8ec0')}</>, 'Nautical twilight (dawn)')
    case 'astro-dusk':
      // full dark begins: stars over a dark horizon, down arrow
      return frame(
        <>
          <circle cx="10" cy="11" r="1.4" fill="#dfe6f0" />
          <circle cx="18" cy="8" r="1.1" fill="#c7d2e0" />
          <circle cx="22" cy="15" r="1.3" fill="#eef2f8" />
          <circle cx="13" cy="16" r="0.9" fill="#aeb8c6" />
          {horizon('#3a4658')}
          {arrow(true, '#7ee0c4')}
        </>,
        'Fully dark begins',
      )
    case 'astro-dawn':
      // dark ends: stars fading, up arrow
      return frame(
        <>
          <circle cx="10" cy="11" r="1.2" fill="#aeb8c6" opacity="0.8" />
          <circle cx="18" cy="8" r="1" fill="#9aa6b6" opacity="0.7" />
          <circle cx="22" cy="15" r="1.2" fill="#cfd8e6" />
          {horizon('#3a4658')}
          {arrow(false, '#7ee0c4')}
        </>,
        'Dark ends (first light)',
      )
  }
}

// ---------------------------------------------------------------------------
// Flags — small geometric SVG flags for the switcher chips + card title, keyed
// by the country strings in config/cities.json. Simple constructions (stripes /
// crescent / cross) so they render crisply at chip size on every platform, no
// flag-emoji font required. Unknown country -> a neutral globe.
// ---------------------------------------------------------------------------
function FlagFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 30 20" role="img" aria-label={label} className="sky-svg-flag">
      <defs>
        <clipPath id={`flag-clip-${label}`}>
          <rect x="0" y="0" width="30" height="20" rx="2.5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#flag-clip-${label})`}>{children}</g>
      <rect x="0.5" y="0.5" width="29" height="19" rx="2.5" fill="none" stroke="rgba(0,0,0,0.28)" />
    </svg>
  )
}

export function CityFlag({ country }: { country: string }) {
  switch (country) {
    case 'Greece':
      // Nine blue/white stripes + a blue canton with a white cross.
      return (
        <FlagFrame label="Greece">
          <rect width="30" height="20" fill="#0d5eaf" />
          {[1, 3, 5, 7, 9].map((i) => (
            <rect key={i} y={(i * 20) / 9} width="30" height={20 / 9} fill="#fff" />
          ))}
          <rect width={(4 * 20) / 9} height={(5 * 20) / 9} fill="#0d5eaf" />
          <rect x={(2 * 20) / 9 - 1.1} y="0" width="2.2" height={(5 * 20) / 9} fill="#fff" />
          <rect x="0" y={(2.5 * 20) / 9 - 1.1} width={(4 * 20) / 9} height="2.2" fill="#fff" />
        </FlagFrame>
      )
    case 'Turkey':
      // Red field, white crescent + star (simplified).
      return (
        <FlagFrame label="Turkey">
          <rect width="30" height="20" fill="#e30a17" />
          <circle cx="12" cy="10" r="5" fill="#fff" />
          <circle cx="13.6" cy="10" r="4" fill="#e30a17" />
          <path
            d="M18.2 10 l1.9 .55 -.02 1.98 1.14-1.63 1.9 .6 -1.2-1.58 1.16-1.6-1.88 .63-1.17-1.6 .01 1.98z"
            fill="#fff"
          />
        </FlagFrame>
      )
    case 'Germany':
      // Black / red / gold horizontal thirds.
      return (
        <FlagFrame label="Germany">
          <rect width="30" height="20" fill="#111" />
          <rect y="6.667" width="30" height="6.667" fill="#d00" />
          <rect y="13.333" width="30" height="6.667" fill="#ffce00" />
        </FlagFrame>
      )
    case 'Italy':
      // Green / white / red vertical thirds.
      return (
        <FlagFrame label="Italy">
          <rect width="30" height="20" fill="#fff" />
          <rect width="10" height="20" fill="#009246" />
          <rect x="20" width="10" height="20" fill="#ce2b37" />
        </FlagFrame>
      )
    case 'United Kingdom':
      // Union Jack (simplified but recognisable).
      return (
        <FlagFrame label="United Kingdom">
          <rect width="30" height="20" fill="#012169" />
          <path d="M0 0 L30 20 M30 0 L0 20" stroke="#fff" strokeWidth="4" />
          <path d="M0 0 L30 20 M30 0 L0 20" stroke="#c8102e" strokeWidth="2" />
          <path d="M15 0 V20 M0 10 H30" stroke="#fff" strokeWidth="6" />
          <path d="M15 0 V20 M0 10 H30" stroke="#c8102e" strokeWidth="3.4" />
        </FlagFrame>
      )
    default:
      return (
        <FlagFrame label={country}>
          <rect width="30" height="20" fill="#26303c" />
          <circle cx="15" cy="10" r="6" fill="none" stroke="#9fb2c6" strokeWidth="1.4" />
          <path d="M9 10 H21 M15 4 V16" stroke="#9fb2c6" strokeWidth="1.1" />
        </FlagFrame>
      )
  }
}
