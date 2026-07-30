// Night-windowed altitude chart + day/night bar for /sky-calendar-v2. Unlike the
// shared sky-chart (a full 00:00..24:00 axis), these crop to the NIGHT — ~2h
// before sunset to ~2h after sunrise — so the important hours fill the width and
// it reads well on a phone (handoff §10). Pure SVG, server-rendered. A planet
// overlay is toggled with a CSS-only checkbox so the page stays zero-JS.

import type { NightCurves, NightCurve } from '@/lib/ephemeris'

const W = 720
const H = 240
const PAD_L = 32
const PAD_R = 12
const PAD_T = 12
const PAD_B = 26
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B
const ALT_MIN = -30 // night chart: floor at -30° — below that is just "well down"
const ALT_MAX = 90

// Per-planet stroke colour (off-white tints + the two accents only would collide,
// so planets get muted distinct hues but stay subordinate to sun/moon).
const PLANET_COLORS: Record<string, string> = {
  Venus: '#f2d999',
  Mars: '#e2724f',
  Jupiter: '#d8c39a',
  Saturn: '#cbb98f',
}

const TWILIGHT_FILL: Record<string, string> = {
  civil: 'rgba(40,58,96,0.34)',
  nautical: 'rgba(32,46,80,0.5)',
  astronomical: 'rgba(24,34,62,0.66)',
  dark: 'rgba(16,24,46,0.82)',
}

export function NightAltitudeChart({ curves, tz }: { curves: NightCurves; tz: string }) {
  const span = curves.winEnd - curves.winStart
  const xFor = (t: number) => PAD_L + ((t - curves.winStart) / span) * PLOT_W
  const yFor = (a: number) => PAD_T + ((ALT_MAX - Math.max(ALT_MIN, Math.min(ALT_MAX, a))) / (ALT_MAX - ALT_MIN)) * PLOT_H
  const path = (samples: NightCurve[]) =>
    samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xFor(s.t).toFixed(1)} ${yFor(s.altitude).toFixed(1)}`).join(' ')

  // Hour ticks: every 2h across the window, labelled 24h local.
  const ticks: { x: number; label: string }[] = []
  const twoH = 2 * 3600_000
  const firstTick = Math.ceil(curves.winStart / twoH) * twoH
  for (let t = firstTick; t <= curves.winEnd; t += twoH) {
    const hh = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
    ticks.push({ x: xFor(t), label: hh.slice(0, 2) })
  }
  const altTicks = [60, 30, 0, -30]
  const nowX = curves.nowMs != null && curves.nowMs >= curves.winStart && curves.nowMs <= curves.winEnd ? xFor(curves.nowMs) : null

  return (
    <div className="v2-nightchart">
      {/* CSS-only planet toggle: the checkbox flips a class that reveals the planet group */}
      <input type="checkbox" id="v2-planet-toggle" className="v2-planet-check" />
      <div className="v2-chart-legend">
        <span className="v2-leg"><span className="v2-leg-line v2-leg-line--sun" />Sun</span>
        <span className="v2-leg"><span className="v2-leg-line v2-leg-line--moon" />Moon</span>
        <label htmlFor="v2-planet-toggle" className="v2-planet-toggle-btn">Show planets</label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="v2-nightchart-svg" role="img" aria-label="Sun, Moon and planet altitude across the night" preserveAspectRatio="xMidYMid meet">
        {/* graded twilight shading */}
        {curves.twilightBands.map((b, i) => (
          <rect key={i} x={xFor(b.start)} y={PAD_T} width={Math.max(0, xFor(b.end) - xFor(b.start))} height={PLOT_H} fill={TWILIGHT_FILL[b.level] ?? TWILIGHT_FILL.dark} />
        ))}
        {/* altitude gridlines */}
        {altTicks.map((a) => (
          <g key={a}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yFor(a)} y2={yFor(a)} stroke={a === 0 ? 'rgba(234,231,223,0.34)' : 'rgba(150,180,220,0.12)'} strokeWidth={a === 0 ? 1.2 : 1} strokeDasharray={a === 0 ? undefined : '3 4'} />
            <text x={PAD_L - 6} y={yFor(a) + 3.5} textAnchor="end" className="v2-chart-axis">{a > 0 ? `+${a}°` : `${a}°`}</text>
          </g>
        ))}
        {/* hour ticks */}
        {ticks.map((tk, i) => (
          <text key={i} x={tk.x} y={H - 9} textAnchor="middle" className="v2-chart-axis">{tk.label}</text>
        ))}
        {/* planet overlays — hidden until the toggle is checked (CSS) */}
        <g className="v2-planet-curves">
          {curves.planets.map((pl) => (
            <path key={pl.name} d={path(pl.samples)} fill="none" stroke={PLANET_COLORS[pl.name] ?? '#c7ced8'} strokeWidth={1.4} strokeDasharray="4 3" opacity={0.85} />
          ))}
        </g>
        {/* moon (silver), then sun (gold) on top */}
        <path d={path(curves.moon)} fill="none" stroke="#c7d2e0" strokeWidth={2} strokeLinejoin="round" opacity={0.9} />
        <path d={path(curves.sun)} fill="none" stroke="#e8c583" strokeWidth={2.4} strokeLinejoin="round" />
        {/* now marker */}
        {nowX != null && (
          <g>
            <line x1={nowX} x2={nowX} y1={PAD_T} y2={PAD_T + PLOT_H} stroke="#7ee0c4" strokeWidth={1.4} strokeDasharray="2 3" />
            <circle cx={nowX} cy={PAD_T} r={2.6} fill="#7ee0c4" />
          </g>
        )}
      </svg>
    </div>
  )
}

// Compact night bar: the twilight bands across the same night window, with a
// "now" dot. No 24h axis, so the dark part isn't crushed into a third of the bar.
export function NightBar({ curves, tz }: { curves: NightCurves; tz: string }) {
  const span = curves.winEnd - curves.winStart
  const pct = (t: number) => `${((t - curves.winStart) / span) * 100}%`
  const twoH = 2 * 3600_000
  const ticks: { left: string; label: string }[] = []
  const firstTick = Math.ceil(curves.winStart / twoH) * twoH
  for (let t = firstTick; t <= curves.winEnd; t += twoH) {
    const hh = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
    ticks.push({ left: pct(t), label: hh.slice(0, 2) })
  }
  return (
    <div className="v2-nightbar" aria-label="The night, sunset to sunrise">
      <div className="v2-nightbar-track">
        {curves.twilightBands.map((b, i) => (
          <div key={i} className={`v2-nightbar-tw v2-nightbar-tw--${b.level}`} style={{ left: pct(b.start), width: `${((b.end - b.start) / span) * 100}%` }} />
        ))}
        {curves.nowMs != null && curves.nowMs >= curves.winStart && curves.nowMs <= curves.winEnd && (
          <span className="v2-nightbar-now" style={{ left: pct(curves.nowMs) }} />
        )}
      </div>
      <div className="v2-nightbar-hours">
        {ticks.map((tk, i) => (
          <span key={i} style={{ left: tk.left }}>{tk.label}</span>
        ))}
      </div>
    </div>
  )
}
