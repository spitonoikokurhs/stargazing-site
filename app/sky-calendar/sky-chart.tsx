// The 24-hour altitude chart + the day/night timeline bar for Tonight's Sky.
// Both are pure/presentational server components that take already-computed
// numbers (see lib/ephemeris: altitudeCurves + twilightPhases) and emit inline
// SVG — no client JS, no charting library, so /sky-calendar keeps its tiny page
// weight. The x-axis is the SELECTED CITY's own local 00:00..24:00 clock.

import type { AltCurves, AltSample, TwilightPhases } from '@/lib/ephemeris'

// ---- geometry ----------------------------------------------------------------
const W = 720
const H = 260
const PAD_L = 34 // room for the altitude axis labels
const PAD_R = 12
const PAD_T = 12
const PAD_B = 26 // room for the hour labels
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B
const ALT_MIN = -90
const ALT_MAX = 90

const xForMinute = (m: number) => PAD_L + (m / 1440) * PLOT_W
const yForAlt = (a: number) => PAD_T + ((ALT_MAX - a) / (ALT_MAX - ALT_MIN)) * PLOT_H

// A smooth-enough polyline path for a sampled curve (5-min samples already read
// as a smooth arc at this scale, so a plain polyline is honest and crisp).
function curvePath(samples: AltSample[]): string {
  return samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xForMinute(s.minute).toFixed(1)} ${yForAlt(s.altitude).toFixed(1)}`).join(' ')
}

// Minutes-from-local-midnight for a twilight instant, relative to the chart's
// day-start. Null-safe: a phase that doesn't occur (never-dark summer) returns
// null and its band simply isn't drawn.
function minuteOf(date: Date | undefined, dayStartUtc: Date): number | null {
  if (!date) return null
  const m = (date.getTime() - dayStartUtc.getTime()) / 60_000
  return m >= 0 && m <= 1440 ? m : null
}

// Progressively darker blue per twilight level, so the shaded night reads as a
// gradient from dusk (civil) through to full dark — matching the darkness ladder
// above the chart.
const TWILIGHT_FILL: Record<string, string> = {
  civil: 'rgba(40,58,96,0.34)',
  nautical: 'rgba(32,46,80,0.5)',
  astronomical: 'rgba(24,34,62,0.66)',
  dark: 'rgba(16,24,46,0.82)',
}

export function AltitudeChart({ curves }: { curves: AltCurves }) {
  // Graded twilight shading from the sun samples — always matches the chart's own
  // 00:00..24:00 axis, and distinguishes civil / nautical / astronomical / dark.
  const bands = curves.twilightBands.map((b) => ({
    x1: xForMinute(b.startMin),
    x2: xForMinute(b.endMin),
    fill: TWILIGHT_FILL[b.level] ?? TWILIGHT_FILL.dark,
  }))

  // 24-hour hour labels every 3h (00,03,...,24).
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21, 24]
  const hourLabel = (h: number) => (h === 24 ? '24' : String(h).padStart(2, '0'))

  // Altitude gridlines at -60,-30,0,30,60.
  const altTicks = [60, 30, 0, -30, -60]

  const nowX = curves.nowFraction !== null ? PAD_L + curves.nowFraction * PLOT_W : null

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="sky-altchart"
      role="img"
      aria-label="Sun and Moon altitude across the day"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* graded twilight shading (civil -> nautical -> astronomical -> dark) */}
      {bands.map((b, i) => (
        <rect key={i} x={b.x1} y={PAD_T} width={b.x2 - b.x1} height={PLOT_H} fill={b.fill} />
      ))}

      {/* altitude gridlines + labels */}
      {altTicks.map((a) => (
        <g key={a}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yForAlt(a)}
            y2={yForAlt(a)}
            stroke={a === 0 ? 'rgba(234,231,223,0.34)' : 'rgba(150,180,220,0.12)'}
            strokeWidth={a === 0 ? 1.2 : 1}
            strokeDasharray={a === 0 ? undefined : '3 4'}
          />
          <text x={PAD_L - 6} y={yForAlt(a) + 3.5} textAnchor="end" className="sky-altchart-axis">
            {a > 0 ? `+${a}°` : `${a}°`}
          </text>
        </g>
      ))}

      {/* hour ticks + labels */}
      {hourTicks.map((h) => (
        <g key={h}>
          <line
            x1={xForMinute(h * 60)}
            x2={xForMinute(h * 60)}
            y1={PAD_T}
            y2={PAD_T + PLOT_H}
            stroke="rgba(150,180,220,0.08)"
            strokeWidth={1}
          />
          <text x={xForMinute(h * 60)} y={H - 9} textAnchor="middle" className="sky-altchart-axis">
            {hourLabel(h)}
          </text>
        </g>
      ))}

      {/* Moon curve (silver) — drawn first so the Sun sits on top */}
      <path d={curvePath(curves.moon)} fill="none" stroke="#c7d2e0" strokeWidth={2} strokeLinejoin="round" opacity={0.9} />
      {/* Sun curve (gold) */}
      <path d={curvePath(curves.sun)} fill="none" stroke="#e8c583" strokeWidth={2.4} strokeLinejoin="round" />

      {/* transit dots at each body's peak */}
      {curves.moonTransit && (
        <circle
          cx={xForMinute(minuteFromHHMM(curves.moonTransit.hhmm))}
          cy={yForAlt(curves.moonTransit.altitude)}
          r={3.2}
          fill="#eef2f8"
          stroke="#0b0f14"
          strokeWidth={1}
        />
      )}
      {curves.sunTransit && (
        <circle
          cx={xForMinute(minuteFromHHMM(curves.sunTransit.hhmm))}
          cy={yForAlt(curves.sunTransit.altitude)}
          r={3.6}
          fill="#f4dca6"
          stroke="#0b0f14"
          strokeWidth={1}
        />
      )}

      {/* now marker (today only) */}
      {nowX !== null && (
        <g>
          <line x1={nowX} x2={nowX} y1={PAD_T} y2={PAD_T + PLOT_H} stroke="#7ee0c4" strokeWidth={1.4} strokeDasharray="2 3" />
          <circle cx={nowX} cy={PAD_T} r={2.6} fill="#7ee0c4" />
        </g>
      )}
    </svg>
  )
}

// The transit hhmm is a wall-clock string in the city's zone; convert back to a
// minute-of-day for x-positioning (avoids re-plumbing the raw Date through).
function minuteFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10))
  return h * 60 + m
}

// ---- 24-hour day/night timeline bar ------------------------------------------
// A compact horizontal bar: night (dark) vs day (lit), with sunrise/sunset tick
// marks and a "now" dot on today. Reads instantly on a phone, complements the
// altitude chart (bar = when it's dark; chart = how high things get).
export function DayNightBar({ curves, tw }: { curves: AltCurves; tw: TwilightPhases }) {
  // Sunrise/sunset markers come from twilightPhases (their hhmm is the labelled
  // time a guest reads), but they belong to the night STARTING this evening, so
  // only the sunset reliably lands within this calendar day; guard each with
  // minuteOf and simply omit any that fall outside. The twilight BANDS come from
  // the sun samples (curves.twilightBands), which always fit the 00:00..24:00 axis.
  const sunsetM = minuteOf(tw.sunset?.date, curves.dayStartUtc)

  const pct = (m: number) => `${(m / 1440) * 100}%`
  const hourTicks = [0, 6, 12, 18, 24]
  const hourLabel = (h: number) => (h === 24 ? '24' : String(h).padStart(2, '0'))

  return (
    <div className="sky-daynight" aria-label="24-hour day and night">
      <div className="sky-daynight-bar">
        {/* graded twilight bands (civil -> dark), both after-midnight + evening */}
        {curves.twilightBands.map((b, i) => (
          <div
            key={i}
            className={`sky-daynight-tw sky-daynight-tw--${b.level}`}
            style={{ left: pct(b.startMin), width: pct(b.endMin - b.startMin) }}
          />
        ))}

        {/* sunset marker */}
        {sunsetM !== null && (
          <span className="sky-daynight-mark sky-daynight-mark--set" style={{ left: pct(sunsetM) }} title={`Sunset ${tw.sunset?.hhmm ?? ''}`} />
        )}
        {/* now dot (today only) */}
        {curves.nowFraction !== null && (
          <span className="sky-daynight-now" style={{ left: `${curves.nowFraction * 100}%` }} />
        )}
      </div>
      <div className="sky-daynight-hours">
        {hourTicks.map((h) => (
          <span key={h} style={{ left: pct(h * 60) }}>
            {hourLabel(h)}
          </span>
        ))}
      </div>
    </div>
  )
}
