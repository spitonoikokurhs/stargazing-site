'use client'

// Private operator analytics — the human-readable window onto the Tier-1
// interaction counters (/api/interaction-stats). Not linked from anywhere, not
// in the sitemap, robots-noindex: an operator opens /stats, pastes the
// VIEWER_STATS_TOKEN once (kept in this browser's localStorage only, never in
// code or on a server), and reads a per-night table with a hotel filter.
//
// Reads only. It never writes, and the endpoint it calls is the same
// token-protected read the CLI curl uses — this page is pure convenience over
// that JSON. Fully client-side so the token never leaves the browser except as
// the Bearer header on the fetch the operator themselves triggered.

import { useCallback, useEffect, useMemo, useState } from 'react'
import './stats.css'

const TOKEN_STORAGE_KEY = 'sg-stats-token'

// Known venues (stable — mirrors config/schedule.json). A hotelId not in this
// map still renders via titleCase() so an ad-hoc night never leaks a raw slug.
const HOTEL_NAMES: Record<string, string> = {
  'astir-odysseus': 'Astir Odysseus',
  'oku-kos': 'OKU Kos',
  'paralos-kyma-dunes': 'Paralos Kyma Dunes',
  'caravia-beach': 'Caravia Beach',
}

function hotelName(id: string | null): string {
  if (!id) return 'Other / after-midnight'
  return HOTEL_NAMES[id] ?? titleCase(id)
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// Friendly column labels for the interaction keys we count. Order here is the
// column order in the table. Keys not listed still show, appended, using their
// raw name — so a newly-added counter is never silently dropped.
const KEY_LABELS: Array<{ key: string; label: string }> = [
  { key: 'sky_city_select', label: 'Sky: city opened' },
  { key: 'sky_full_detail', label: 'Sky: full detail' },
  { key: 'sky_date_bucket', label: 'Sky: night chosen' },
  { key: 'object_info_open', label: 'Observation opened' },
  { key: 'history_pill_tap', label: 'History target tapped' },
  { key: 'fullscreen_enter', label: 'Fullscreen' },
  { key: 'funnel_whatsapp_click', label: 'WhatsApp clicked' },
  { key: 'funnel_baseline_review_click', label: 'Review clicked' },
  { key: 'funnel_finder_review_click', label: 'Review clicked (finder)' },
]

// ---- API row shape (from /api/interaction-stats?from=&to=) ----
type RangeRow = {
  date: string | null
  eventKey: string
  hotelId: string | null
  counterField: string
  interactionKey: string
  objectId: string | null
  count: number
}

type RangeResponse = {
  scope: 'hotel'
  range: { from: string; to: string }
  counters: RangeRow[]
}

// One collapsed row in the table: a single night at a single venue, with a
// per-interaction-key tally summed across objectIds.
type NightGroup = {
  date: string
  hotelId: string | null
  byKey: Record<string, number>
  total: number
}

// dd-mm-yyyy for display (EU format). Input is Athens "YYYY-MM-DD".
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

// Default range: last 30 days, computed from an anchor "today" passed in (we
// avoid Date.now() drift by reading it once on mount).
function isoDaysAgo(anchorIso: string, days: number): string {
  const [y, m, d] = anchorIso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

function todayIso(): string {
  // Local calendar date is fine for a range bound; the API filters on Athens
  // date strings and inclusive bounds tolerate a day of slack at the edge.
  const dt = new Date()
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function StatsPage() {
  const [token, setToken] = useState('')
  const [savedToken, setSavedToken] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [hotelFilter, setHotelFilter] = useState<string>('all')
  const [rows, setRows] = useState<RangeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null)

  // Restore a previously-entered token + seed the default range on mount.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null
    if (stored) setSavedToken(stored)
    const today = todayIso()
    setTo(today)
    setFrom(isoDaysAgo(today, 30))
  }, [])

  const fetchRange = useCallback(
    async (authToken: string, rangeFrom: string, rangeTo: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/interaction-stats?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
          { headers: { Authorization: `Bearer ${authToken}` }, cache: 'no-store' },
        )
        if (res.status === 401) {
          setError('That token was rejected. Check VIEWER_STATS_TOKEN in Vercel and try again.')
          setRows([])
          return
        }
        if (!res.ok) {
          setError(`Request failed (${res.status}).`)
          setRows([])
          return
        }
        const data = (await res.json()) as RangeResponse
        setRows(Array.isArray(data.counters) ? data.counters : [])
        setLoadedRange(data.range ?? { from: rangeFrom, to: rangeTo })
      } catch {
        setError('Could not reach the server. Check your connection and try again.')
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const handleSaveToken = useCallback(() => {
    const trimmed = token.trim()
    if (!trimmed) return
    window.localStorage.setItem(TOKEN_STORAGE_KEY, trimmed)
    setSavedToken(trimmed)
    setToken('')
    if (from && to) void fetchRange(trimmed, from, to)
  }, [token, from, to, fetchRange])

  const handleForget = useCallback(() => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    setSavedToken(null)
    setRows([])
    setLoadedRange(null)
    setError(null)
  }, [])

  const handleLoad = useCallback(() => {
    if (savedToken && from && to) void fetchRange(savedToken, from, to)
  }, [savedToken, from, to, fetchRange])

  // Auto-load once when a saved token + range are both ready and nothing's loaded.
  useEffect(() => {
    if (savedToken && from && to && !loadedRange && !loading) {
      void fetchRange(savedToken, from, to)
    }
  }, [savedToken, from, to, loadedRange, loading, fetchRange])

  // Which hotels appear in the loaded data (for the filter dropdown). Always
  // includes the known venues so the operator can pick one even before data
  // for it exists in the window.
  const hotelOptions = useMemo(() => {
    const present = new Set<string>()
    for (const r of rows) if (r.hotelId) present.add(r.hotelId)
    const known = Object.keys(HOTEL_NAMES)
    const all = Array.from(new Set([...known, ...Array.from(present)]))
    return all.sort((a, b) => hotelName(a).localeCompare(hotelName(b)))
  }, [rows])

  // Collapse the flat rows into one group per (date, hotelId), summing counts
  // per interaction key across objectIds. Then apply the hotel filter and the
  // midnight-straggler rule: a hotelId===null group on a date that ALSO has a
  // real hotel night is leftover noise — kept only if it's the sole group.
  const groups = useMemo<NightGroup[]>(() => {
    const map = new Map<string, NightGroup>()
    for (const r of rows) {
      if (!r.date) continue
      const gid = `${r.date}::${r.hotelId ?? ''}`
      let g = map.get(gid)
      if (!g) {
        g = { date: r.date, hotelId: r.hotelId, byKey: {}, total: 0 }
        map.set(gid, g)
      }
      g.byKey[r.interactionKey] = (g.byKey[r.interactionKey] ?? 0) + r.count
      g.total += r.count
    }

    // Midnight-straggler suppression: for each date, if there's a real hotel
    // group, drop the null-hotel group (it's after-midnight leftover, not a night).
    const datesWithRealHotel = new Set<string>()
    for (const g of Array.from(map.values())) if (g.hotelId) datesWithRealHotel.add(g.date)

    let out = Array.from(map.values()).filter(
      (g) => g.hotelId !== null || !datesWithRealHotel.has(g.date),
    )

    if (hotelFilter !== 'all') {
      out = out.filter((g) => (g.hotelId ?? '') === hotelFilter)
    }

    // Newest night first; within a night, by venue name.
    out.sort((a, b) => (a.date === b.date ? hotelName(a.hotelId).localeCompare(hotelName(b.hotelId)) : b.date.localeCompare(a.date)))
    return out
  }, [rows, hotelFilter])

  // Only render columns for keys that actually have data in the current view
  // (plus keep the canonical order). Avoids a table full of zero columns.
  const activeColumns = useMemo(() => {
    const present = new Set<string>()
    for (const g of groups) for (const k of Object.keys(g.byKey)) if (g.byKey[k] > 0) present.add(k)
    const ordered = KEY_LABELS.filter((c) => present.has(c.key))
    const extras = Array.from(present)
      .filter((k) => !KEY_LABELS.some((c) => c.key === k))
      .map((k) => ({ key: k, label: k }))
    return [...ordered, ...extras]
  }, [groups])

  // Column totals across all visible nights.
  const columnTotals = useMemo(() => {
    const t: Record<string, number> = {}
    let grand = 0
    for (const g of groups)
      for (const c of activeColumns) {
        const v = g.byKey[c.key] ?? 0
        t[c.key] = (t[c.key] ?? 0) + v
        grand += v
      }
    return { t, grand }
  }, [groups, activeColumns])

  return (
    <main className="stats-main">
      <header className="stats-header">
        <div>
          <h1>Interaction stats</h1>
          <p className="stats-sub">
            Private operator view · guest taps per night, by venue. Search-engine visibility lives in Google
            Search Console, not here.
          </p>
        </div>
        <a className="stats-home" href="/">← Home</a>
      </header>

      {!savedToken ? (
        <section className="stats-card stats-auth">
          <h2>Enter your access token</h2>
          <p>
            Paste your <code>VIEWER_STATS_TOKEN</code> (Vercel → project → Settings → Environment Variables).
            It’s stored in this browser only — never sent anywhere except as the request’s authorisation header.
          </p>
          <div className="stats-auth-row">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveToken()
              }}
              placeholder="Bearer token"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={handleSaveToken} disabled={!token.trim()}>
              Save &amp; load
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="stats-card stats-controls">
            <div className="stats-field">
              <label htmlFor="from">From</label>
              <input id="from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="stats-field">
              <label htmlFor="to">To</label>
              <input id="to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="stats-field">
              <label htmlFor="hotel">Venue</label>
              <select id="hotel" value={hotelFilter} onChange={(e) => setHotelFilter(e.target.value)}>
                <option value="all">All venues</option>
                {hotelOptions.map((h) => (
                  <option key={h} value={h}>
                    {hotelName(h)}
                  </option>
                ))}
              </select>
            </div>
            <div className="stats-field stats-actions">
              <button type="button" onClick={handleLoad} disabled={loading || !from || !to}>
                {loading ? 'Loading…' : 'Load'}
              </button>
              <button type="button" className="stats-link-btn" onClick={handleForget}>
                Forget token
              </button>
            </div>
          </section>

          {error && <p className="stats-error">{error}</p>}

          {loadedRange && !error && (
            <p className="stats-range-note">
              Showing {fmtDate(loadedRange.from)} → {fmtDate(loadedRange.to)}
              {hotelFilter !== 'all' ? ` · ${hotelName(hotelFilter)}` : ''} · {groups.length}{' '}
              {groups.length === 1 ? 'night' : 'nights'}
            </p>
          )}

          <section className="stats-card stats-table-wrap">
            {groups.length === 0 && !loading ? (
              <p className="stats-empty">
                No interactions recorded in this window yet. Counters fill as guests use the site during and
                after events — an empty table here is normal for a quiet period, not an error.
              </p>
            ) : (
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="stats-col-date">Night</th>
                    <th className="stats-col-hotel">Venue</th>
                    {activeColumns.map((c) => (
                      <th key={c.key} className="stats-col-num">
                        {c.label}
                      </th>
                    ))}
                    <th className="stats-col-num stats-col-total">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={`${g.date}::${g.hotelId ?? ''}`}>
                      <td className="stats-col-date">{fmtDate(g.date)}</td>
                      <td className="stats-col-hotel">{hotelName(g.hotelId)}</td>
                      {activeColumns.map((c) => (
                        <td key={c.key} className="stats-col-num">
                          {g.byKey[c.key] ?? 0}
                        </td>
                      ))}
                      <td className="stats-col-num stats-col-total">{g.total}</td>
                    </tr>
                  ))}
                </tbody>
                {groups.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="stats-col-date">Total</td>
                      <td className="stats-col-hotel"></td>
                      {activeColumns.map((c) => (
                        <td key={c.key} className="stats-col-num">
                          {columnTotals.t[c.key] ?? 0}
                        </td>
                      ))}
                      <td className="stats-col-num stats-col-total">{columnTotals.grand}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </section>
        </>
      )}
    </main>
  )
}
