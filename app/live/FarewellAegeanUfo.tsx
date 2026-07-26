'use client'

import { useEffect, useRef, useState } from 'react'
import { BackToHome } from './BackToHome'
import { initialTapState, tap as tapDecision, idleReset, type FarewellTapState } from '@/lib/farewell-taps'
import { type InteractionKey } from '@/lib/interaction-events'
import { ReviewFunnel } from './ReviewFunnel'

// Ported from docs/ufo-escalatev1.html (the standalone prototype), preserving
// the design/animation/tap-tier logic as-is per explicit instruction. The
// prototype is a self-contained imperative DOM-animation engine (creates and
// destroys shooting-star/splash/trail-dot elements every frame via
// requestAnimationFrame) — rewriting that as idiomatic React state would be a
// large, risky rewrite of working physics code for no real benefit, so this
// component keeps the same imperative engine, just scoped to a container ref
// instead of `document` globally (so it's safe to mount/unmount inside React
// and never leaks listeners or touches unrelated DOM).
//
// Performance tiers (see usePerformanceTier below):
//   'full'    — everything: up to 8 shooting stars, comet, full flag finale.
//   'reduced' — fewer shooting stars, no comet, simplified tier-3 payoff
//               (still celebratory, just lighter). UFO, goodnight text, and
//               the basic Aegean scene (sea/sail/static stars) are ALWAYS
//               shown at every tier — only the heaviest effects are cut.
//   'static'  — prefers-reduced-motion: no JS animation loop at all, no
//               shooting stars/comet/flag, just the static scene + UFO
//               resting in place (no CSS keyframe animation either) and the
//               plain goodnight/heading/sub text. Still "intentional and
//               pretty," per the requirement — not a broken/empty screen.

export type PerformanceTier = 'full' | 'reduced' | 'static'

const GOODNIGHT_LINES = ['Gute Nacht', 'Goodnight', 'Buonanotte', 'Bonne nuit', 'İyi geceler', 'Καληνύχτα']
const GREET_LINES = ['καληνύχτα ✨', 'beam me up! 🛸', 'see you soon ⭐', 'stardust ✦', 'buonanotte 🌙', 'made of starlight 🌠']
const EXCITED_LINES = ['whee! 🛸', 'again! ✨', 'so many stars! ⭐', "you're fun 🌙", 'more! 🌠']

// Tap-tier thresholds. Compressed from the prototype's 5/10 to 3/5 so the
// finale is more reachable (guests weren't tapping far enough to trigger it),
// while preserving the three-stage escalation arc: gentle greeting (taps 1-2)
// -> excited tier (tap 3, fast spin + sparkle bursts) -> full finale (tap 5,
// fleet flyby + alien-flag formation + reward line). Keeping TIER_2 strictly
// below TIER_3 is what keeps the excited tier its own distinct beat rather
// than collapsing straight from greeting into the finale on the same tap.
const TAP_TIER_2 = 3
const TAP_TIER_3 = 5
const STREAK_RESET_IDLE_MS = 4000
// Dwell before the baseline review invitation appears — long enough that the
// scene has clearly settled (past the entrance beats), short enough that a guest
// lingering on the farewell still sees it. Calm, not eager.
const FUNNEL_BASELINE_DWELL_MS = 18000

// Real stellar colors, weighted like an actual sky — mostly white/blue-white,
// a few orange-red giants. [color, weight] pairs.
const STAR_COLOR_WEIGHTS: [string, number][] = [
  ['#cfe2ff', 2.5],
  ['#f8f7ff', 3.5],
  ['#fff3e0', 2],
  ['#ffe9c4', 1.4],
  ['#ffd2a1', 1],
  ['#ffb9a6', 0.7],
]
const SHOOTING_STAR_COLORS = ['#ff9ad5', '#c39aff', '#9dffc9', '#ffe89a', '#9ad9ff']
const HORIZON_VH = 74

function weightedStarColor(): string {
  const total = STAR_COLOR_WEIGHTS.reduce((sum, [, w]) => sum + w, 0)
  let r = Math.random() * total
  for (const [color, w] of STAR_COLOR_WEIGHTS) {
    r -= w
    if (r <= 0) return color
  }
  return STAR_COLOR_WEIGHTS[0][0]
}

function randomShootingStarColor(): string {
  return SHOOTING_STAR_COLORS[Math.floor(Math.random() * SHOOTING_STAR_COLORS.length)]
}

// --- Performance tier detection --------------------------------------------
//
// Hard gate (required, accessibility): prefers-reduced-motion always wins,
// no heuristics involved. Soft gate (best-effort, for old/low-power devices
// that haven't set reduced-motion): a cheap hardwareConcurrency/deviceMemory
// check picks an INITIAL guess, then a short real frame-rate sample can
// downgrade further if actual frames are being dropped — measuring the real
// symptom (jank) rather than only guessing from device specs, which are an
// imperfect proxy at best.
function initialGuessFromDeviceSpecs(): PerformanceTier {
  if (typeof navigator === 'undefined') return 'full'
  const cores = navigator.hardwareConcurrency ?? 8
  // deviceMemory is Chromium-only and not in the TS lib DOM types.
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8
  if (cores <= 4 || deviceMemory <= 4) return 'reduced'
  return 'full'
}

function usePerformanceTier(): PerformanceTier {
  const [tier, setTier] = useState<PerformanceTier>(() => {
    if (typeof window === 'undefined') return 'full'
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'static'
    return initialGuessFromDeviceSpecs()
  })

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    function onChange() {
      setTier(media.matches ? 'static' : initialGuessFromDeviceSpecs())
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // Real frame-rate sample: only meaningful if we're not already static
  // (reduced-motion) and not already at the lowest animated tier. Samples
  // ~1.5s of real rAF deltas shortly after mount; if the actual frame rate
  // is clearly janky (well under 30fps average, i.e. this device can't even
  // keep up with the DOM churn of the 'full' tier), downgrade to 'reduced'.
  // A device that's already fine never gets touched by this — it only ever
  // moves DOWN a tier from measured jank, never up (no reason to promote
  // mid-session; the visual change would be more jarring than staying put).
  useEffect(() => {
    if (tier !== 'full') return
    let raf = 0
    let frames = 0
    let start = 0
    function sample(now: number) {
      if (!start) start = now
      frames++
      const elapsed = now - start
      if (elapsed >= 1500) {
        const fps = (frames * 1000) / elapsed
        if (fps < 30) setTier('reduced')
        return // stop sampling either way — one measurement is enough
      }
      raf = requestAnimationFrame(sample)
    }
    raf = requestAnimationFrame(sample)
    return () => cancelAnimationFrame(raf)
    // Intentionally only runs once per mount at the 'full' tier — re-running
    // on every tier change would re-trigger itself after the downgrade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return tier
}

// ---------------------------------------------------------------------------

type ShootingStarParticle = {
  el: HTMLDivElement
  rf: HTMLDivElement
  dead: boolean
  flying: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastDot: number
  color: string
  y0: number
  dur: number
  ang: number
  tEnd: number
  t0: number
  // How far out to sea this particular star lands, re-rolled each launch:
  // 0 = far shore (splashes right at the horizon line), 1 = near shore
  // (splashes low, close to the viewer). Gives the sea some perspective
  // instead of every star landing on the same line — see splash()/tick().
  depth: number
}

export function FarewellAegeanUfo({
  nextSessionLead,
  nextSessionSchedule,
  nextSessionLogoSrc,
  hotelId,
  onTrack,
}: {
  // "See you again — the stars will be waiting" style line, picked from a
  // pool (see lib/live-farewell.ts) — or the graceful no-next-session
  // fallback when there's nothing scheduled at all.
  nextSessionLead: string | null
  // The real weekday/time/venue sentence, e.g. "Tuesday, 21:30–22:30 here
  // at OKU Kos." — null when there's no known next session (in which case
  // only nextSessionLead's fallback line renders).
  nextSessionSchedule: string | null
  // The next session's hotel logo (same hotelId -> logo mapping as the
  // offline/status screen's badge — see hotelLogoSrc in lib/live-copy.ts).
  // null when there's no next session OR the hotel has no logo asset yet;
  // either way the schedule line still renders text-only, same graceful-
  // absence pattern used everywhere else a logo is optional on this page.
  nextSessionLogoSrc: string | null
  // Tonight's venue slug, for the review-funnel WhatsApp prefill. Null -> generic.
  hotelId?: string | null
  // Tier-1 interaction beacon sink (UFO scene only — see the report's scene-
  // integration section). The scene calls onTrack('farewell_ufo_tap') /
  // ('farewell_finale_reached') at the imperative tap/finale points, and the
  // ReviewFunnel below routes its funnel_* beacons through the same callback.
  // Optional so standalone/demo/debug paths that render this without tracking
  // pass nothing.
  onTrack?: (key: InteractionKey) => void
}) {
  const tier = usePerformanceTier()
  const stageRef = useRef<HTMLDivElement>(null)
  const skyLayerRef = useRef<HTMLDivElement>(null)
  const reflLayerRef = useRef<HTMLDivElement>(null)
  const bgLayerRef = useRef<HTMLDivElement>(null)
  const ufoRef = useRef<SVGSVGElement>(null)
  // The click/keyboard target is the wrapping native <button> (see the render),
  // not the SVG — so keyboard activation (Enter/Space, which a native button
  // turns into a click) reaches onUfoClick too. ufoRef stays on the SVG for the
  // animation's classList (spin/spinfast) manipulation.
  const ufoButtonRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const fleetRef = useRef<HTMLDivElement>(null)
  const rewardRef = useRef<HTMLDivElement>(null)
  const flagRef = useRef<HTMLDivElement>(null)
  const cardTextRef = useRef<HTMLDivElement>(null)
  const ufoSlotRef = useRef<HTMLDivElement>(null)
  const burstRefs = useRef<(HTMLDivElement | null)[]>([null, null, null])
  const [goodnightIndex, setGoodnightIndex] = useState(0)

  // onTrack held in a ref so the imperative tap/finale closures (which capture
  // once at effect-setup) always call the latest callback without re-running the
  // big animation effect on every render. emitTrack is the safe no-op-guarded
  // caller used at every beacon point.
  const onTrackRef = useRef(onTrack)
  onTrackRef.current = onTrack
  const emitTrack = (key: InteractionKey) => {
    try {
      onTrackRef.current?.(key)
    } catch {
      // a tracking hiccup must never disturb the farewell
    }
  }

  // Static-tier (prefers-reduced-motion) tap easter egg. The animated engine
  // below never mounts for the static tier, so it has its own tiny, motion-free
  // version: the SAME TAP_TIER_3 taps reveal a reward line via a gentle
  // opacity fade (no spin/flip/zoom — safe under reduced-motion). Without this
  // the static UFO swallowed taps entirely (guests tapped and nothing happened).
  const [staticRevealed, setStaticRevealed] = useState(false)
  const staticTapsRef = useRef(0)
  const staticResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- Review-funnel gating ----
  // Baseline invitation appears after the scene has SETTLED. There's no built-in
  // settle event (see the report), so we use a dwell timer keyed off mount:
  // ~18s, comfortably past the entrance beats, calm rather than eager.
  const [baselineReady, setBaselineReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setBaselineReady(true), FUNNEL_BASELINE_DWELL_MS)
    return () => clearTimeout(t)
  }, [])
  // Finder invitation appears only AFTER the finale fully completes (animated
  // tiers) or the static reveal latches (static tier). This React state is the
  // surfaced form of the terminal finaleCompleted latch, flipped at the finale
  // reset points below; once true it never resets (matches the latch).
  const [finaleCompleted, setFinaleCompleted] = useState(false)
  const finaleCompletedRef = useRef(false)
  const markFinaleCompleted = () => {
    if (finaleCompletedRef.current) return
    finaleCompletedRef.current = true
    setFinaleCompleted(true)
  }
  function onStaticUfoTap() {
    if (staticRevealed) return
    staticTapsRef.current += 1
    // The 5th (finale) tap emits ONLY farewell_finale_reached below — matching
    // the animated tier, where the finale tap is tracked as the finale and not
    // double-counted as a tap. Pre-finale taps (1-4) count here.
    if (staticTapsRef.current < TAP_TIER_3) emitTrack('farewell_ufo_tap')
    if (staticResetRef.current) clearTimeout(staticResetRef.current)
    staticResetRef.current = setTimeout(() => {
      staticTapsRef.current = 0
    }, STREAK_RESET_IDLE_MS)
    if (staticTapsRef.current >= TAP_TIER_3) {
      if (staticResetRef.current) clearTimeout(staticResetRef.current)
      setStaticRevealed(true)
      emitTrack('farewell_finale_reached')
      // Static-tier "finale" reached — surface the finder reveal (no animation
      // to wait on, so it's immediate, matching the static reward).
      markFinaleCompleted()
    }
  }
  useEffect(() => () => { if (staticResetRef.current) clearTimeout(staticResetRef.current) }, [])

  // Rotating goodnight line — simple interval, independent of the animation
  // engine below (pure text, no DOM-node churn either way).
  useEffect(() => {
    const id = setInterval(() => {
      setGoodnightIndex((i) => (i + 1) % GOODNIGHT_LINES.length)
    }, 7000)
    return () => clearInterval(id)
  }, [])

  // The full imperative animation engine — shooting stars, comet, tap-tier
  // escalation, Newtonian background stars, flag finale. Ported as directly
  // as practical from the prototype; every DOM lookup is scoped to refs
  // instead of document.getElementById/querySelector, and everything is torn
  // down on unmount (timers cleared, RAF cancelled, created nodes removed via
  // React's own unmount of the layer containers).
  useEffect(() => {
    if (
      !stageRef.current ||
      !skyLayerRef.current ||
      !reflLayerRef.current ||
      !bgLayerRef.current ||
      !ufoRef.current ||
      !ufoButtonRef.current ||
      !bubbleRef.current ||
      !fleetRef.current ||
      !rewardRef.current ||
      !flagRef.current ||
      !cardTextRef.current ||
      !ufoSlotRef.current
    ) {
      return
    }
    // Non-null assertions below are safe: the guard above already confirmed
    // every ref is populated. TypeScript can't carry that narrowing into the
    // nested function declarations further down this closure (a known
    // limitation, not a real nullability risk here) — reassigning to `!`-
    // asserted locals is the standard workaround.
    const stage = stageRef.current
    const skyLayer = skyLayerRef.current!
    const reflLayer = reflLayerRef.current!
    const bgLayer = bgLayerRef.current!
    const ufo = ufoRef.current!
    const ufoButton = ufoButtonRef.current!
    const bubble = bubbleRef.current!
    const fleet = fleetRef.current!
    const reward = rewardRef.current!
    const flag = flagRef.current!
    const cardText = cardTextRef.current!
    const ufoSlot = ufoSlotRef.current!

    // Tier-driven caps. 'static' never reaches this effect at all (the
    // component returns a non-animated render for that tier — see below).
    const maxStars = tier === 'reduced' ? 3 : 8
    const bgStarCount = tier === 'reduced' ? 14 : 26
    const cometEnabled = tier === 'full'
    const flagFinaleEnabled = tier === 'full'

    // --- Newtonian background stars (static, once) ---
    // Cleared first so this stays idempotent if the effect re-runs against
    // the same DOM node (e.g. React 18 Strict Mode's dev-only double-invoke
    // of mount effects) instead of silently doubling up on every re-run.
    bgLayer.innerHTML = ''
    for (let i = 0; i < bgStarCount; i++) {
      let x = 0
      let y = 0
      for (let tries = 0; tries < 12; tries++) {
        x = 2 + Math.random() * 96
        y = 2 + Math.random() * 64
        if (!(x > 27 && x < 73 && y > 20 && y < 64)) break // keep the card area clean
      }
      const r = Math.random()
      const size = r < 0.14 ? 14 + Math.random() * 8 : r < 0.5 ? 9 + Math.random() * 4 : 5 + Math.random() * 3
      const star = document.createElement('span')
      star.className = 'farewell-bgstar'
      star.style.left = `${x.toFixed(1)}%`
      star.style.top = `${y.toFixed(1)}%`
      star.style.setProperty('--s', `${size.toFixed(1)}px`)
      star.style.setProperty('--sc', weightedStarColor())
      star.style.setProperty('--td', `${(2.5 + Math.random() * 4).toFixed(1)}s`)
      star.style.setProperty('--tl', `${(-Math.random() * 4).toFixed(1)}s`)
      bgLayer.appendChild(star)
    }

    // --- Comet (optional reward for patient watchers) ---
    skyLayer.innerHTML = '' // idempotent re-run guard, same reasoning as bgLayer above
    const comet = {
      el: document.createElement('div'),
      flying: false,
      timer: null as ReturnType<typeof setTimeout> | null,
      y0: 0,
      dy: 0,
      dur: 0,
      ang: 0,
      t0: 0,
    }
    if (cometEnabled) {
      comet.el.className = 'farewell-comet'
      comet.el.innerHTML =
        '<span class="farewell-comet-tail"></span><span class="farewell-comet-tail2"></span><span class="farewell-comet-head"></span>'
      skyLayer.appendChild(comet.el)
    }
    function launchComet() {
      comet.y0 = 5 + Math.random() * 22
      comet.dy = -4 + Math.random() * 10
      comet.dur = 22000 + Math.random() * 10000
      comet.ang = (Math.atan2((comet.dy * window.innerHeight) / 100, 1.24 * window.innerWidth) * 180) / Math.PI
      comet.t0 = performance.now()
      comet.flying = true
    }
    function scheduleComet(first: boolean) {
      if (!cometEnabled) return
      comet.timer = setTimeout(
        launchComet,
        (first ? 20000 : 70000) + Math.random() * (first ? 25000 : 70000),
      )
    }
    scheduleComet(true)

    // --- Shooting-star physics pool ---
    const pool: ShootingStarParticle[] = []

    function dropDot(x: number, y: number, color: string, prox: number) {
      const d = document.createElement('span')
      d.className = 'farewell-tdot'
      d.style.setProperty('--sc', color)
      d.style.opacity = (0.4 + prox * 0.35).toFixed(2)
      d.style.transform = `translate(${x.toFixed(2)}vw,${y.toFixed(2)}vh)`
      skyLayer.appendChild(d)
      const remove = () => d.remove()
      d.addEventListener('animationend', remove)
      setTimeout(() => {
        if (d.parentNode) d.remove()
      }, 900)
    }

    // SEA_DEPTH_VH: how far into the sea band (below the horizon line) a
    // "near shore" splash (depth=1) can land, vs. a "far shore" one
    // (depth=0) which lands right at the horizon. Kept comfortably inside
    // .farewell-sea's own 26vh band so splashes never spill past it.
    const SEA_DEPTH_VH = 16

    function splash(x: number, color: string, f: number, depth: number) {
      const s = document.createElement('div')
      s.className = 'farewell-splash'
      const y = HORIZON_VH + depth * SEA_DEPTH_VH
      // Nearer splashes (higher depth) read as closer to the viewer — bigger
      // and a touch more opaque, same perspective cue as the reflection
      // stretch in tick() below.
      const scale = f * (1 + depth * 0.6)
      s.style.setProperty('--sc', color)
      s.style.opacity = (0.75 + depth * 0.25).toFixed(2)
      s.style.transform = `translate(${x.toFixed(2)}vw,${y.toFixed(2)}vh) scale(${scale.toFixed(2)})`
      s.innerHTML =
        '<i class="farewell-splash-glow"></i><i class="farewell-splash-ring"></i>' +
        '<i class="farewell-splash-d1"></i><i class="farewell-splash-d2"></i><i class="farewell-splash-d3"></i>'
      reflLayer.appendChild(s)
      setTimeout(() => s.remove(), 950)
    }

    function launch(p: ShootingStarParticle) {
      if (p.dead) return
      p.color = randomShootingStarColor()
      p.el.style.setProperty('--sc', p.color)
      p.rf.style.setProperty('--sc', p.color)
      p.y0 = 2 + Math.random() * 64
      p.dur = 900 + Math.random() * 2300
      p.ang = (Math.atan2(0.38 * window.innerHeight, 1.2 * window.innerWidth) * 180) / Math.PI
      p.tEnd = p.y0 + 38 > HORIZON_VH ? (HORIZON_VH - p.y0) / 38 : 1
      p.t0 = performance.now()
      p.lastDot = 0
      p.flying = true
      p.depth = Math.random()
    }

    function finish(p: ShootingStarParticle) {
      p.flying = false
      p.el.style.opacity = '0'
      p.rf.style.display = 'none'
      if (p.tEnd < 1) {
        const f = 0.6 + ((3200 - p.dur) / 2300) * 1.5
        splash(-8 + 120 * p.tEnd, p.color, f, p.depth)
      }
      if (!p.dead) p.timer = setTimeout(() => launch(p), 300 + Math.random() * 3200)
    }

    function tick(now: number) {
      for (const p of pool) {
        if (!p.flying) continue
        const t = (now - p.t0) / p.dur
        if (t >= p.tEnd) {
          finish(p)
          continue
        }
        const x = -8 + 120 * t
        const y = p.y0 + 38 * t
        const prox = Math.min(1, Math.max(0, (y - 46) / (HORIZON_VH - 46)))
        const fadein = Math.min(1, t / 0.07)
        p.el.style.transform = `translate(${x.toFixed(2)}vw,${y.toFixed(2)}vh) rotate(${p.ang.toFixed(1)}deg)`
        p.el.style.opacity = fadein.toFixed(2)
        p.el.style.filter = `brightness(${(1 + prox * 0.9).toFixed(2)})`
        if (now - p.lastDot > 42) {
          p.lastDot = now
          dropDot(x, y, p.color, prox)
        }
        if (y > 38) {
          // Reflection eases toward this star's own landing depth as it
          // nears the horizon (prox -> 1), so it visibly reaches further
          // into the sea for a "near shore" star than a "far shore" one,
          // matching where splash() will actually land it.
          let yr = HORIZON_VH + (HORIZON_VH - y) * 0.55 + prox * p.depth * SEA_DEPTH_VH * 0.5
          if (yr < HORIZON_VH + 0.4) yr = HORIZON_VH + 0.4
          p.rf.style.display = 'block'
          p.rf.style.transform = `translate(${x.toFixed(2)}vw,${yr.toFixed(2)}vh) rotate(${(-p.ang * 0.55).toFixed(1)}deg) scaleY(1.9)`
          p.rf.style.opacity = ((0.09 + prox * 0.34) * fadein).toFixed(2)
        } else {
          p.rf.style.display = 'none'
        }
      }
      if (comet.flying) {
        const ct = (now - comet.t0) / comet.dur
        if (ct >= 1) {
          comet.flying = false
          comet.el.style.opacity = '0'
          scheduleComet(false)
        } else {
          const cx = -12 + 124 * ct
          const cy = comet.y0 + comet.dy * ct
          const cop = Math.min(1, ct / 0.12, (1 - ct) / 0.12)
          comet.el.style.transform = `translate(${cx.toFixed(2)}vw,${cy.toFixed(2)}vh) rotate(${comet.ang.toFixed(1)}deg)`
          comet.el.style.opacity = cop.toFixed(2)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    let rafId = requestAnimationFrame(tick)

    function makeStar(): ShootingStarParticle {
      const el = document.createElement('div')
      el.className = 'farewell-sstar'
      el.innerHTML = '<span class="farewell-sstar-tail"></span><span class="farewell-sstar-head"></span>'
      skyLayer.appendChild(el)
      const rf = document.createElement('div')
      rf.className = 'farewell-srefl'
      rf.innerHTML = '<span class="farewell-srefl-tail"></span><span class="farewell-srefl-head"></span>'
      reflLayer.appendChild(rf)
      const p: ShootingStarParticle = {
        el,
        rf,
        dead: false,
        flying: false,
        timer: null,
        lastDot: 0,
        color: '#fff',
        y0: 0,
        dur: 0,
        ang: 0,
        tEnd: 1,
        t0: 0,
        depth: 0,
      }
      p.timer = setTimeout(() => launch(p), Math.random() * 1500)
      pool.push(p)
      return p
    }
    function setStars(total: number) {
      const want = Math.min(maxStars, Math.max(0, total))
      while (pool.length < want) makeStar()
      while (pool.length > want) {
        const p = pool.pop()
        if (!p) break
        p.dead = true
        p.flying = false
        if (p.timer) clearTimeout(p.timer)
        p.el.remove()
        p.rf.remove()
      }
    }
    setStars(2) // calm baseline sky

    // --- Tap-tier escalation ---
    // Count + terminal-finale state live in the pure state machine
    // (lib/farewell-taps.ts) so the "every tap counts" and "finale is terminal
    // forever" rules are unit-tested directly (scripts/test-farewell-taps.mjs),
    // not mirrored. tapState.finaleCompleted is the permanent terminal latch;
    // busy/finaleRunning below are animation-only gates layered on top.
    let tapState: FarewellTapState = initialTapState()
    let busy = false // spin-animation in flight — suppresses RE-TRIGGERING a spin, never drops a tap
    let finaleRunning = false // the long finale sequence is playing — ignore taps until it resets
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    function fireBursts() {
      for (const b of burstRefs.current) {
        if (!b) continue
        const ang = Math.random() * 360 * (Math.PI / 180)
        const d = 40 + Math.random() * 30
        b.style.setProperty('--bt', `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px)`)
        b.classList.remove('go')
        void b.offsetWidth
        b.classList.add('go')
      }
    }
    function say(txt: string) {
      if (!bubble) return
      bubble.textContent = txt
      bubble.classList.remove('show')
      void bubble.offsetWidth
      bubble.classList.add('show')
    }

    function onUfoClick() {
      // While the FINALE sequence is playing, ignore further taps (it's a long
      // choreographed payoff that must not re-fire on top of itself). This is an
      // animation gate distinct from the terminal latch below.
      if (finaleRunning) return

      // The pure state machine decides everything: it counts the tap, or — if
      // the finale has ALREADY fired — returns 'ignored' (terminal, no replay).
      // EVERY tap counts until the finale (no tap swallowed by an in-flight
      // spin); `busy` only suppresses RE-TRIGGERING the spin animation, never
      // the counting.
      const result = tapDecision(tapState)
      tapState = result.state
      if (result.action === 'ignored') return // post-finale: terminal, inert

      // Tier-1: a counted UFO tap. The finale tap is tracked distinctly below
      // (as farewell_finale_reached), so only the pre-finale 'counted' taps
      // emit the tap beacon here — the finale isn't double-counted as a tap.
      if (result.action === 'counted') emitTrack('farewell_ufo_tap')

      // Full tier can afford the escalating doubling (2, 4, 8...) for a big
      // dramatic ramp-up. On the reduced tier (already-detected low-power/
      // low-frame-rate devices), grow much more conservatively — +2 stars
      // per tap instead of doubling — so a fast tap streak can't spike the
      // DOM-churn cost on a device that's already struggling.
      setStars(tier === 'full' ? Math.pow(2, tapState.count) : 2 + tapState.count * 2)
      if (resetTimer) clearTimeout(resetTimer)
      resetTimer = setTimeout(() => {
        tapState = idleReset(tapState) // cannot clear the terminal latch
        setStars(2)
      }, STREAK_RESET_IDLE_MS)

      if (result.action === 'finale') {
        // Tier-1: the finale fired (terminal — the state machine latches
        // finaleCompleted, so this can only happen once per mount).
        emitTrack('farewell_finale_reached')
        finaleRunning = true
        busy = true
        ufo.classList.remove('spin', 'spinfast')
        void (ufo as unknown as HTMLElement).offsetWidth
        ufo.classList.add('spinfast')
        fireBursts()
        // Clear the goodnight/heading/next-session/flavor block out of the
        // way for the duration of the finale so the reward message has clean
        // space to sit in rather than overlapping that text — restored once
        // the finale fully resets, in the same place it timing-wise always
        // reset from before.
        cardText.classList.add('farewell-card-text--hidden')
        if (flagFinaleEnabled) {
          fleet.classList.remove('go')
          void fleet.offsetWidth
          fleet.classList.add('go')
          flag.classList.remove('go', 'bye')
          void flag.offsetWidth
          flag.classList.add('go')
          // The flag formation sits near the top of the stage — nudge the
          // UFO down slightly for the finale so it doesn't sit underneath/
          // overlap the flag while it's flying in and holding. Reverted
          // alongside the rest of the reset below.
          ufoSlot.classList.add('farewell-ufo-slot--finale')
          setTimeout(() => {
            reward.classList.remove('show', 'farewell-reward--long')
            void reward.offsetWidth
            reward.classList.add('show', 'farewell-reward--long')
          }, 2600)
          // Flag holds fully assembled for ~9s (roughly double the original
          // ~4.6s hold) before scattering — it's the payoff, worth lingering
          // on. Scatter + reset timings below are shifted out by the same
          // amount so the sequence (hold -> scatter -> reward clears -> card
          // text returns) stays coherent, just stretched.
          setTimeout(() => flag.classList.add('bye'), 11000)
          setTimeout(() => {
            flag.classList.remove('go', 'bye')
            cardText.classList.remove('farewell-card-text--hidden')
            ufoSlot.classList.remove('farewell-ufo-slot--finale')
            busy = false
            finaleRunning = false
            // Streak count reset for tidiness; the terminal latch
            // (finaleCompleted) survives idleReset, so no tap can replay the
            // finale even though finaleRunning is back to false.
            tapState = idleReset(tapState)
            setStars(2)
            // Finale has fully completed — surface the finder review reveal.
            markFinaleCompleted()
          }, 12500)
        } else {
          // Reduced tier: skip the (heaviest) 117-alien flag finale entirely,
          // but still deliver a real payoff — the reward line alone, plus
          // the sparkle burst already fired above. Still feels intentional.
          reward.classList.remove('show')
          void reward.offsetWidth
          reward.classList.add('show')
          setTimeout(() => {
            cardText.classList.remove('farewell-card-text--hidden')
            busy = false
            finaleRunning = false
            tapState = idleReset(tapState) // terminal latch survives
            setStars(2)
            // Finale (reduced tier) fully completed — surface the finder reveal.
            markFinaleCompleted()
          }, 4500)
        }
        return
      }

      // Below TAP_TIER_3: play the greet/excited spin reaction — but ONLY if a
      // previous spin isn't still in flight (`busy`). A tap that lands mid-spin
      // has already been counted above; it just doesn't restart the animation,
      // so rapid tapping accumulates smoothly toward the finale instead of
      // thrashing (or being dropped, the old bug).
      if (busy) return
      busy = true
      if (tapState.count >= TAP_TIER_2) {
        ufo.classList.remove('spin', 'spinfast')
        void (ufo as unknown as HTMLElement).offsetWidth
        ufo.classList.add('spinfast')
        fireBursts()
        say(EXCITED_LINES[Math.floor(Math.random() * EXCITED_LINES.length)])
        setTimeout(() => {
          busy = false
        }, 500)
      } else {
        ufo.classList.remove('spin', 'spinfast')
        void (ufo as unknown as HTMLElement).offsetWidth
        ufo.classList.add('spin')
        say(GREET_LINES[Math.floor(Math.random() * GREET_LINES.length)])
        setTimeout(() => {
          busy = false
        }, 700)
      }
    }
    // Listener on the BUTTON, not the SVG — a native button turns Enter/Space
    // into a click, so keyboard users trigger onUfoClick exactly like a tap.
    ufoButton.addEventListener('click', onUfoClick)

    return () => {
      cancelAnimationFrame(rafId)
      if (resetTimer) clearTimeout(resetTimer)
      if (comet.timer) clearTimeout(comet.timer)
      ufoButton.removeEventListener('click', onUfoClick)
      for (const p of pool) {
        if (p.timer) clearTimeout(p.timer)
        p.el.remove()
        p.rf.remove()
      }
      // bgLayer/skyLayer/reflLayer/comet nodes are children of ref'd
      // containers that unmount with the component — no separate cleanup
      // needed for the static background stars or the comet element itself.
    }
  }, [tier])

  if (tier === 'static') {
    return (
      <div className="farewell-stage farewell-stage--static" ref={stageRef}>
        <div className="farewell-stars" />
        <div className="farewell-card">
          <div className="farewell-ufo-slot">
            {/* A REAL native <button> (not an svg with role="button"): native
                buttons get Enter/Space activation, focus, and reliable
                VoiceOver/TalkBack semantics for free — more robust than an ARIA
                role on an SVG. The SVG inside is purely decorative
                (aria-hidden). Reachable and operable without any animation, so
                the easter egg works in reduced-motion. */}
            <button
              type="button"
              className="farewell-ufo-button"
              aria-label="Tap the UFO"
              disabled={staticRevealed}
              onClick={onStaticUfoTap}
            >
              <svg
                className="farewell-ufo-unit farewell-ufo-unit--static"
                viewBox="0 0 130 78"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <UfoMarkup />
              </svg>
            </button>
          </div>
          {/* Motion-free reward reveal — a gentle opacity fade once TAP_TIER_3
              taps land (see onStaticUfoTap). No spin/flip/zoom. */}
          {staticRevealed && (
            <div className="farewell-reward farewell-reward--static show" role="status">
              <span className="farewell-reward-big">You really looked up tonight.</span>
              <span className="farewell-reward-small">Thank you for stargazing with us ✨</span>
            </div>
          )}
          <p className="farewell-goodnight-static">{GOODNIGHT_LINES[goodnightIndex]}</p>
          <div className="farewell-heading">Tonight’s session has ended</div>
          {nextSessionLead ? <div className="farewell-sub">{nextSessionLead}</div> : null}
          {nextSessionSchedule ? (
            <div className="farewell-next-venue">
              {nextSessionLogoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- local /public asset, fixed-height badge, no next/image sizing needed here
                <img src={nextSessionLogoSrc} alt="" className="farewell-next-logo" />
              ) : null}
              <div className="farewell-sub farewell-sub--schedule">{nextSessionSchedule}</div>
            </div>
          ) : null}
          <div className="farewell-flavor">
            The photons have gone home.
            <br />
            Same time, next star.
          </div>
          {/* The calm high point of the event — a receptive guest who just had
              a great experience is the best moment to offer a path into the
              rest of the site. Prominent link (like the offline state), and
              above the decorative sea/shimmer layers so it stays tappable. */}
          <div className="farewell-back-home">
            <BackToHome variant="link" />
          </div>
          {/* Review funnel (static tier): finder reveal once the static easter
              egg is found, otherwise the baseline invitation after the dwell.
              Inline in the card flow, below the back-home link — never over the
              UFO/reward focal area. */}
          {finaleCompleted ? (
            <ReviewFunnel variant="finder" onTrack={onTrack} />
          ) : (
            baselineReady && <ReviewFunnel variant="baseline" hotelId={hotelId} onTrack={onTrack} />
          )}
        </div>
        <div className="farewell-sea" />
        <div className="farewell-shimmer" />
      </div>
    )
  }

  return (
    <div className="farewell-stage" ref={stageRef}>
      <div className="farewell-stars" />
      <div className="farewell-bgstars" ref={bgLayerRef} />
      <div className="farewell-skyLayer" ref={skyLayerRef} />
      <div className="farewell-reflLayer" ref={reflLayerRef} />

      <div className="farewell-fleet" ref={fleetRef}>
        <span className="farewell-mini farewell-mini--1" style={{ top: '30%' }}>
          🛸
        </span>
        <span className="farewell-mini farewell-mini--2" style={{ top: '26%' }}>
          🛸
        </span>
        <span className="farewell-mini farewell-mini--3" style={{ top: '34%' }}>
          🛸
        </span>
        <span className="farewell-mini farewell-mini--4" style={{ top: '28%' }}>
          🛸
        </span>
        <span className="farewell-mini farewell-mini--5" style={{ top: '32%' }}>
          🛸
        </span>
      </div>
      <AlienFlag containerRef={flagRef} />
      <div className="farewell-reward" ref={rewardRef}>
        <span className="farewell-reward-big">You really looked up tonight.</span>
        <span className="farewell-reward-small">Thank you for stargazing with us ✨</span>
      </div>

      <div className="farewell-card">
        <div className="farewell-ufo-slot" ref={ufoSlotRef}>
          <div className="farewell-flash" />
          <div className="farewell-spark farewell-spark--1" />
          <div className="farewell-spark farewell-spark--2" />
          <div className="farewell-spark farewell-spark--3" />
          <div className="farewell-spark farewell-spark--4" />
          <div className="farewell-spark farewell-spark--5" />
          <div className="farewell-spark farewell-spark--6" />
          <div className="farewell-burst" ref={(el) => { burstRefs.current[0] = el }} />
          <div className="farewell-burst" ref={(el) => { burstRefs.current[1] = el }} />
          <div className="farewell-burst" ref={(el) => { burstRefs.current[2] = el }} />
          <div className="farewell-bubble" ref={bubbleRef} />
          {/* Same native-<button> treatment as the static tier, so both tiers
              are identically keyboard-reachable and screen-reader-labelled. The
              button is the click/focus target; the SVG (kept on ufoRef for the
              spin animation) is decorative. */}
          <button type="button" className="farewell-ufo-button" ref={ufoButtonRef} aria-label="Tap the UFO">
            <svg
              className="farewell-ufo-unit"
              ref={ufoRef}
              viewBox="0 0 130 78"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <UfoMarkup />
            </svg>
          </button>
        </div>

        <div className="farewell-card-text" ref={cardTextRef}>
          <div className="farewell-goodnight">
            {GOODNIGHT_LINES.map((line, i) => (
              <div key={line} className={`farewell-goodnight-line${i === goodnightIndex ? ' is-active' : ''}`}>
                <span className="farewell-goodnight-text">{line}</span>
              </div>
            ))}
          </div>

          <div className="farewell-heading">Tonight’s session has ended</div>
          {nextSessionLead ? <div className="farewell-sub">{nextSessionLead}</div> : null}
          {nextSessionSchedule ? (
            <div className="farewell-next-venue">
              {nextSessionLogoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- local /public asset, fixed-height badge, no next/image sizing needed here
                <img src={nextSessionLogoSrc} alt="" className="farewell-next-logo" />
              ) : null}
              <div className="farewell-sub farewell-sub--schedule">{nextSessionSchedule}</div>
            </div>
          ) : null}
          <div className="farewell-flavor">
            The photons have gone home.
            <br />
            Same time, next star.
          </div>
          {/* Prominent back-to-home link at the calm end-of-event moment (see
              the static path above for the rationale). */}
          <div className="farewell-back-home">
            <BackToHome variant="link" />
          </div>
          {/* Review funnel (animated tiers): finder reveal after the finale
              fully completes, otherwise the baseline invitation after the dwell.
              Lives inside .farewell-card-text, so it's correctly hidden during
              the finale payoff (.farewell-card-text--hidden) and returns with the
              card text afterwards — and it sits below the back-home link, clear
              of the UFO slot, the flag zone, and the reward line. */}
          {finaleCompleted ? (
            <ReviewFunnel variant="finder" onTrack={onTrack} />
          ) : (
            baselineReady && <ReviewFunnel variant="baseline" hotelId={hotelId} onTrack={onTrack} />
          )}
        </div>
      </div>

      <div className="farewell-sea" />
      <div className="farewell-shimmer" />
      <svg className="farewell-sail" width="46" height="40" viewBox="0 0 46 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M23 4 L23 30" stroke="#9fc4d4" strokeWidth="1.2" />
        <path d="M23 6 Q34 14 32 28 L23 28 Z" fill="#9fc4d4" opacity=".7" />
        <path d="M23 8 Q14 16 16 28 L23 28 Z" fill="#c6dde6" opacity=".55" />
        <path d="M14 30 L32 30 L28 36 L18 36 Z" fill="#7f9fb0" />
      </svg>
      <div className="farewell-caption">tap the UFO 👽 keep tapping…</div>
    </div>
  )
}

function UfoMarkup() {
  return (
    <>
      <ellipse cx="60" cy="32" rx="25" ry="21" fill="#2a3550" />
      <ellipse cx="60" cy="30" rx="21" ry="16" fill="#3d4d72" />
      <ellipse cx="55" cy="24" rx="6" ry="4" fill="#5b6d95" opacity=".6" />
      <ellipse cx="60" cy="32" rx="7.5" ry="8.5" fill="#7ee0c4" />
      <circle cx="56.5" cy="31" r="1.7" fill="#0a0a0f" />
      <circle cx="63.5" cy="31" r="1.7" fill="#0a0a0f" />
      <path d="M57.5 36 q2.5 2 5 0" stroke="#0a0a0f" strokeWidth="1" fill="none" strokeLinecap="round" />
      <g className="farewell-arm">
        <path d="M78 40 q10 -6 15 -16" stroke="#7ee0c4" strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle cx="93" cy="24" r="3.4" fill="#7ee0c4" />
      </g>
      <ellipse cx="60" cy="50" rx="55" ry="16" fill="#3f4d6c" />
      <ellipse cx="60" cy="48" rx="55" ry="14" fill="#5d6d92" />
      <ellipse cx="60" cy="46" rx="46" ry="10" fill="#6f80a8" />
      <circle cx="30" cy="50" r="3.2" fill="#f4c775">
        <animate attributeName="opacity" values="1;.25;1" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="45" cy="53" r="3.2" fill="#7ee0c4">
        <animate attributeName="opacity" values=".25;1;.25" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="54" r="3.2" fill="#e88a8a">
        <animate attributeName="opacity" values="1;.25;1" dur="1.4s" begin=".3s" repeatCount="indefinite" />
      </circle>
      <circle cx="75" cy="53" r="3.2" fill="#7ee0c4">
        <animate attributeName="opacity" values=".25;1;.25" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="90" cy="50" r="3.2" fill="#f4c775">
        <animate attributeName="opacity" values="1;.25;1" dur="1.4s" begin=".5s" repeatCount="indefinite" />
      </circle>
    </>
  )
}

// The tier-3 payoff formation: a 13x9 grid of tiny alien SVGs colored into
// the Greek flag (blue/white cross + stripes). Built once into a ref'd
// container via innerHTML (matching the prototype exactly — this is static
// decorative markup with per-cell random animation-delay custom properties,
// not stateful content, so imperative construction is the simplest faithful
// port rather than 117 individual React elements).
function AlienFlag({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }) {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const cols = 13
    const rows = 9
    function alienSvg(col: string, eye: string): string {
      return (
        '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">' +
        `<line x1="10" y1="5" x2="10" y2="2.2" stroke="${col}" stroke-width="1.4"/>` +
        `<circle cx="10" cy="1.8" r="1.4" fill="${col}"/>` +
        `<ellipse cx="10" cy="12.5" rx="6.2" ry="7" fill="${col}"/>` +
        `<circle cx="7.7" cy="11" r="1.2" fill="${eye}"/>` +
        `<circle cx="12.3" cy="11" r="1.2" fill="${eye}"/>` +
        '</svg>'
      )
    }
    let html = ''
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inCanton = r < 5 && c < 5
        const white = inCanton ? r === 2 || c === 2 : r % 2 === 1
        const d = (c * 0.08 + r * 0.025 + Math.random() * 0.05).toFixed(2)
        const e = ((rows - r) * 0.04 + Math.random() * 0.18).toFixed(2)
        html +=
          `<span class="farewell-flag-cell ${white ? 'is-white' : 'is-blue'}" style="--d:${d}s;--e:${e}s">` +
          `<span class="farewell-flag-stepper">${white ? alienSvg('#1b5cae', '#eaf2fb') : alienSvg('#eaf4ff', '#123c73')}</span>` +
          '</span>'
      }
    }
    el.innerHTML = html
  }, [containerRef])

  return <div className="farewell-flag" ref={containerRef} />
}
