// Night-windowed altitude chart + day/night bar for /sky-calendar-v2. Unlike the
// shared sky-chart (a full 00:00..24:00 axis), these crop to the NIGHT — ~2h
// before sunset to ~2h after sunrise — so the important hours fill the width and
// it reads well on a phone (handoff §10). The altitude chart precomputes all
// SVG geometry HERE (server) and hands ready-made path strings to a small client
// component that only manages series visibility (so ephemeris stays server-side).

import type { NightCurves, NightCurve } from '@/lib/ephemeris'
import { NightChartClient, type ChartGeometry } from './NightChartClient'

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
// Distinct from the Sun's gold (#e8c583), the Moon's silver (#c7d2e0) AND the
// teal (#7ee0c4, reserved for darkness/now). Only one planet shows at a time, so
// each needs to separate from Sun/Moon/teal, not from the other planets.
const PLANET_COLORS: Record<string, string> = {
  Venus: '#8fc4e6', // pale blue
  Mars: '#e2724f', // rust
  Jupiter: '#c79be0', // soft violet
  Saturn: '#e39ab8', // dusty rose
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

  const twoH = 2 * 3600_000
  const firstTick = Math.ceil(curves.winStart / twoH) * twoH
  const hourTicks: { x: number; label: string }[] = []
  for (let t = firstTick; t <= curves.winEnd; t += twoH) {
    const hh = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
    hourTicks.push({ x: xFor(t), label: hh.slice(0, 2) })
  }

  // All geometry precomputed server-side; the client component only toggles.
  const geo: ChartGeometry = {
    viewBox: `0 0 ${W} ${H}`,
    padT: PAD_T,
    plotH: PLOT_H,
    plotL: PAD_L,
    plotR: W - PAD_R,
    sunPath: path(curves.sun),
    moonPath: path(curves.moon),
    planets: curves.planets.map((pl) => ({ name: pl.name, color: PLANET_COLORS[pl.name] ?? '#c7ced8', path: path(pl.samples) })),
    twilight: curves.twilightBands.map((b) => ({ x: xFor(b.start), w: Math.max(0, xFor(b.end) - xFor(b.start)), fill: TWILIGHT_FILL[b.level] ?? TWILIGHT_FILL.dark })),
    altTicks: [60, 30, 0, -30].map((a) => ({ a, y: yFor(a), label: a > 0 ? `+${a}°` : `${a}°` })),
    hourTicks,
    nowX: curves.nowMs != null && curves.nowMs >= curves.winStart && curves.nowMs <= curves.winEnd ? xFor(curves.nowMs) : null,
  }

  return <NightChartClient geo={geo} />
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
      {/* Key so the graded strip reads at a glance: gold = still light,
          progressively darker blue = deeper twilight into full dark. */}
      <div className="v2-nightbar-key" aria-hidden="true">
        <span className="v2-nbk"><span className="v2-nbk-sw v2-nbk-sw--day" />Light</span>
        <span className="v2-nbk"><span className="v2-nbk-sw v2-nbk-sw--civil" />Twilight</span>
        <span className="v2-nbk"><span className="v2-nbk-sw v2-nbk-sw--dark" />Properly dark</span>
      </div>
    </div>
  )
}
