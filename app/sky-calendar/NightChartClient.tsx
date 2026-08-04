'use client'

// Interactive layer for the v2 night altitude chart. The heavy work (sampling
// altitudes, building the SVG path strings) stays SERVER-side in sky-chart;
// this component receives ready-made path strings and only manages which series
// are visible. So the client bundle carries UI state, not ephemeris.
//
// Behaviour (per feedback):
//  - Sun and Moon are independent toggles (each on/off, both on by default).
//  - Planets are one-at-a-time: tapping a planet shows only it; tapping the
//    ACTIVE planet again turns it off (radios can't do tap-off — hence the JS).

import { useState } from 'react'

export type ChartGeometry = {
  viewBox: string
  padT: number
  plotH: number
  plotL: number
  plotR: number
  sunPath: string
  moonPath: string
  planets: { name: string; color: string; path: string }[]
  twilight: { x: number; w: number; fill: string }[]
  altTicks: { a: number; y: number; label: string }[]
  hourTicks: { x: number; label: string }[]
  nowX: number | null
}

export function NightChartClient({ geo }: { geo: ChartGeometry }) {
  const [sun, setSun] = useState(true)
  const [moon, setMoon] = useState(true)
  const [planet, setPlanet] = useState<string | null>(null) // active planet or none

  const togglePlanet = (name: string) => setPlanet((cur) => (cur === name ? null : name))
  const active = geo.planets.find((p) => p.name === planet) ?? null

  return (
    <div className="v2-nightchart">
      <div className="v2-chart-legend">
        <button
          type="button"
          className={`v2-toggle v2-toggle--sun${sun ? ' is-on' : ''}`}
          aria-pressed={sun}
          onClick={() => setSun((v) => !v)}
        >
          <span className="v2-leg-line v2-leg-line--sun" />Sun
        </button>
        <button
          type="button"
          className={`v2-toggle v2-toggle--moon${moon ? ' is-on' : ''}`}
          aria-pressed={moon}
          onClick={() => setMoon((v) => !v)}
        >
          <span className="v2-leg-line v2-leg-line--moon" />Moon
        </button>
        <span className="v2-plseg" role="group" aria-label="Overlay one planet">
          {geo.planets.map((pl) => (
            <button
              key={pl.name}
              type="button"
              className={`v2-plseg-btn${planet === pl.name ? ' is-on' : ''}`}
              aria-pressed={planet === pl.name}
              style={{ ['--pl' as string]: pl.color }}
              onClick={() => togglePlanet(pl.name)}
            >
              {pl.name}
            </button>
          ))}
        </span>
      </div>
      <svg viewBox={geo.viewBox} className="v2-nightchart-svg" role="img" aria-label="Sun, Moon and planet altitude across the night" preserveAspectRatio="xMidYMid meet">
        {geo.twilight.map((b, i) => (
          <rect key={i} x={b.x} y={geo.padT} width={b.w} height={geo.plotH} fill={b.fill} />
        ))}
        {geo.altTicks.map((t) => (
          <g key={t.a}>
            <line x1={geo.plotL} x2={geo.plotR} y1={t.y} y2={t.y} stroke={t.a === 0 ? 'rgba(234,231,223,0.34)' : 'rgba(150,180,220,0.12)'} strokeWidth={t.a === 0 ? 1.2 : 1} strokeDasharray={t.a === 0 ? undefined : '3 4'} />
            <text x={geo.plotL - 6} y={t.y + 3.5} textAnchor="end" className="v2-chart-axis">{t.label}</text>
          </g>
        ))}
        {geo.hourTicks.map((tk, i) => (
          <text key={i} x={tk.x} y={geo.padT + geo.plotH + 17} textAnchor="middle" className="v2-chart-axis">{tk.label}</text>
        ))}
        {/* the one active planet, if any */}
        {active && <path d={active.path} fill="none" stroke={active.color} strokeWidth={1.8} strokeLinejoin="round" />}
        {/* moon then sun, each only when toggled on */}
        {moon && <path d={geo.moonPath} fill="none" stroke="#c7d2e0" strokeWidth={2} strokeLinejoin="round" opacity={0.9} />}
        {sun && <path d={geo.sunPath} fill="none" stroke="#e8c583" strokeWidth={2.4} strokeLinejoin="round" />}
        {geo.nowX != null && (
          <g>
            <line x1={geo.nowX} x2={geo.nowX} y1={geo.padT} y2={geo.padT + geo.plotH} stroke="#7ee0c4" strokeWidth={1.4} strokeDasharray="2 3" />
            <circle cx={geo.nowX} cy={geo.padT} r={2.6} fill="#7ee0c4" />
          </g>
        )}
      </svg>
    </div>
  )
}
