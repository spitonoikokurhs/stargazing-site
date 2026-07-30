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
      {/* subtle maria so the lit face isn't a flat coin */}
      <g fill="#c2cbd7" opacity="0.55">
        <ellipse cx="38" cy="40" rx="9" ry="7" />
        <ellipse cx="58" cy="34" rx="6" ry="5" />
        <ellipse cx="60" cy="58" rx="8" ry="6" />
        <ellipse cx="42" cy="62" rx="5" ry="4" />
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
          </defs>
          <circle cx="20" cy="20" r="15" fill="url(#pl-mars)" />
          <ellipse cx="24" cy="15" rx="4" ry="3" fill="#c1401f" opacity="0.6" />
          <circle cx="20" cy="6" r="2.4" fill="#ffe9dc" opacity="0.85" />
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
      return svg(
        <>
          <defs>
            <radialGradient id="pl-sat" cx="36%" cy="32%" r="78%">
              <stop offset="0%" stopColor="#f7edcf" />
              <stop offset="100%" stopColor="#d3b779" />
            </radialGradient>
          </defs>
          {/* ring behind */}
          <ellipse
            cx="20"
            cy="21"
            rx="18"
            ry="6"
            fill="none"
            stroke="#e6d3a0"
            strokeWidth="2.2"
            transform="rotate(-18 20 21)"
          />
          <circle cx="20" cy="20" r="12" fill="url(#pl-sat)" />
          {/* ring front (over the planet's lower half) */}
          <path
            d="M 3 25 A 18 6 -18 0 0 37 17"
            fill="none"
            stroke="#f0dead"
            strokeWidth="2.2"
            transform="rotate(-18 20 21)"
            opacity="0.95"
          />
        </>,
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
