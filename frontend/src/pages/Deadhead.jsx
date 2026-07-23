import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { T, STATUS, carrierColor } from '../theme.js'
import { api } from '../api.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

// Trucks that are on a load and will free up when it delivers.
const ACTIVE_STATUSES = ['covered', 'dispatched', 'loading', 'on_route', 'unloading', 'in_yard', 'delivered']

// ── Date helpers (loads store dates as ISO YYYY-MM-DD strings) ────────────────
function isoDay(d) { return d.toISOString().slice(0, 10) }
function today() { return isoDay(new Date()) }
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoDay(d)
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}
function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmt$(n) {
  const v = Number(String(n).replace(/[^0-9.]/g, ''))
  if (!v) return null
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

// ── Geocoding (Nominatim, free) — shares the localStorage cache with FleetMap ──
const _cache = {}
async function geocode(city, state) {
  if (!city) return null
  const key = `gc:${city}_${state}`.toLowerCase().replace(/\s+/g, '_')
  if (key in _cache) return _cache[key]
  const stored = localStorage.getItem(key)
  if (stored) return (_cache[key] = JSON.parse(stored))
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${city}, ${state}, USA`)}`
    )
    const d = await r.json()
    const v = d[0] ? { lat: +d[0].lat, lng: +d[0].lon } : null
    _cache[key] = v
    if (v) localStorage.setItem(key, JSON.stringify(v))
    return v
  } catch {
    _cache[key] = null
    return null
  }
}
const cacheKey = (city, state) => `gc:${city}_${state}`.toLowerCase().replace(/\s+/g, '_')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Fallback only: great-circle miles scaled by a road factor. Used when the
// routing service can't be reached — flagged as approximate in the UI.
const ROAD_FACTOR = 1.2
function haversineMiles(a, b) {
  const R = 3958.8
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.asin(Math.sqrt(s)) * ROAD_FACTOR)
}

// Real driving miles via OSRM (public routing engine) — the same road network
// Google Maps routes on, so numbers line up with a truck's actual repositioning
// drive rather than straight-line distance. One call per origin returns the
// road distance to every candidate at once; results are cached per city-pair.
const _rmCache = {}
const rmKey = (oKey, dKey) => `rm:${oKey}>${dKey}`
const METERS_PER_MILE = 1609.34

// origin: {lat,lng}; dests: [{ key, pos:{lat,lng} }] → { [destKey]: miles|null }
async function fetchRoadMiles(origin, dests) {
  const out = {}
  // OSRM table caps total coordinates; chunk destinations to stay well under it.
  for (let i = 0; i < dests.length; i += 90) {
    const batch = dests.slice(i, i + 90)
    const coords = [origin, ...batch.map(d => d.pos)]
      .map(p => `${p.lng},${p.lat}`).join(';')
    try {
      const r = await fetch(
        `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=distance`
      )
      const j = await r.json()
      const row = j.code === 'Ok' && j.distances ? j.distances[0] : null
      batch.forEach((d, k) => {
        const m = row ? row[k + 1] : null
        out[d.key] = m == null ? null : Math.round(m / METERS_PER_MILE)
      })
    } catch {
      batch.forEach(d => { out[d.key] = null })
    }
  }
  return out
}

function milesColor(m) {
  if (m <= 100) return T.green
  if (m <= 250) return T.orange
  return T.red
}

function loc(city, state) {
  return [city, state].filter(Boolean).join(', ')
}

// ── One candidate pickup row under a freeing truck ────────────────────────────
function CandidateRow({ c, rank }) {
  const s = STATUS[c.load.status] || STATUS.open
  const rate = fmt$(c.load.rate)
  return (
    <Link to={`/loads/${c.load.id}`} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', borderRadius: 9, textDecoration: 'none',
      background: rank === 0 ? T.blue + '10' : 'transparent',
      border: rank === 0 ? `1px solid ${T.blue}22` : `1px solid transparent`,
      marginBottom: 4,
    }}
      onMouseEnter={e => { if (rank !== 0) e.currentTarget.style.background = T.bg2 }}
      onMouseLeave={e => { if (rank !== 0) e.currentTarget.style.background = 'transparent' }}
    >
      {/* deadhead badge */}
      <div style={{
        flexShrink: 0, minWidth: 62, textAlign: 'center',
        background: milesColor(c.miles) + '18', border: `1px solid ${milesColor(c.miles)}44`,
        borderRadius: 8, padding: '4px 6px',
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: milesColor(c.miles), lineHeight: 1 }}>
          {c.approx ? '~' : ''}{c.miles}
        </div>
        <div style={{ fontSize: 8, fontWeight: 700, color: T.text3, letterSpacing: 0.4, marginTop: 2 }}>
          {c.approx ? 'MI EST' : 'MI DH'}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loc(c.load.pickup_city, c.load.pickup_state)}
          <span style={{ color: T.text3, fontWeight: 500 }}> → {loc(c.load.delivery_city, c.load.delivery_state) || '—'}</span>
        </div>
        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
          PU {fmtDate(c.load.pickup_date)}
          {c.gapDays != null && (
            <span style={{ color: c.gapDays < 0 ? T.red : T.text3 }}>
              {' · '}{c.gapDays === 0 ? 'same day' : c.gapDays < 0 ? `${-c.gapDays}d before free` : `${c.gapDays}d after free`}
            </span>
          )}
          {c.load.broker_name ? ` · ${c.load.broker_name}` : ''}
          {c.load.load_number ? ` · ${c.load.load_number}` : ''}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {rate && <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>{rate}</div>}
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
          background: s.color + '22', color: s.color, border: `1px solid ${s.color}44`,
        }}>{s.label.toUpperCase()}</span>
      </div>
    </Link>
  )
}

// ── One freeing truck card with its ranked candidates ─────────────────────────
function TruckCard({ item }) {
  const { load, candidates, freeCity, freeState, freeDate } = item
  const cc = carrierColor(load.company_name)
  return (
    <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
      {/* header — the truck that frees up */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
        borderBottom: `1px solid ${T.sep}`, borderLeft: `3px solid ${cc}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: cc, flexShrink: 0 }} />
            {load.driver_name || 'Unassigned'}
            {load.tractor_number && <span style={{ fontSize: 11, color: T.text3, fontWeight: 500 }}>#{load.tractor_number}</span>}
          </div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 3 }}>
            Frees up in <strong style={{ color: T.text }}>{loc(freeCity, freeState) || 'unknown'}</strong>
            {' · '}{fmtDate(freeDate)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: T.text3 }}>delivering</div>
          <div style={{ fontSize: 11, color: T.text3 }}>
            {loc(load.pickup_city, load.pickup_state)} →
          </div>
        </div>
      </div>

      {/* ranked candidates */}
      <div style={{ padding: '8px 8px' }}>
        {candidates.length === 0 ? (
          <div style={{ fontSize: 12, color: T.text3, padding: '14px 8px', textAlign: 'center' }}>
            No candidate pickups match the current filters.
          </div>
        ) : (
          candidates.map((c, i) => <CandidateRow key={c.load.id} c={c} rank={i} />)
        )}
      </div>
    </div>
  )
}

export default function Deadhead() {
  const mobile = useIsMobile()
  const [loads, setLoads] = useState(null)
  const [loading, setLoading] = useState(true)
  const [geo, setGeo] = useState({}) // cacheKey -> {lat,lng} | null
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [roadMi, setRoadMi] = useState({}) // "oKey>dKey" -> miles | null
  const [rmProgress, setRmProgress] = useState({ done: 0, total: 0 })

  // controls
  const [fromDate, setFromDate] = useState(addDays(today(), 1)) // default: tomorrow
  const [toDate, setToDate] = useState(addDays(today(), 3))
  const [pool, setPool] = useState('open')          // open | open_covered | all
  const [afterFreeOnly, setAfterFreeOnly] = useState(true)
  const [maxDH, setMaxDH] = useState('')            // blank = no cap
  const [topN, setTopN] = useState(12)

  useEffect(() => {
    api.loads().then(setLoads).catch(() => setLoads([])).finally(() => setLoading(false))
  }, [])

  // Trucks that free up in the chosen window (a load delivering in [from, to]).
  const freeingTrucks = useMemo(() => {
    if (!loads) return []
    return loads
      .filter(l =>
        ACTIVE_STATUSES.includes(l.status) &&
        l.delivery_date && l.delivery_date >= fromDate && l.delivery_date <= toDate &&
        (l.delivery_city || l.delivery_state)
      )
      .sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || ''))
  }, [loads, fromDate, toDate])

  // Candidate pool of loads that need a truck.
  const candidateLoads = useMemo(() => {
    if (!loads) return []
    const statusOk =
      pool === 'open' ? (s) => s === 'open'
        : pool === 'open_covered' ? (s) => s === 'open' || s === 'covered'
          : () => true
    return loads.filter(l =>
      statusOk(l.status) &&
      (l.pickup_city || l.pickup_state) &&
      // only future/near pickups are worth repositioning to
      (!l.pickup_date || l.pickup_date >= today())
    )
  }, [loads, pool])

  // Geocode every unique city we need, throttled, filling `geo` as we go.
  // Cached hits (incl. from the Fleet map) resolve instantly.
  useEffect(() => {
    if (!loads) return
    const needed = new Map() // cacheKey -> {city,state}
    const add = (city, state) => {
      if (!city && !state) return
      const k = cacheKey(city, state)
      if (!needed.has(k)) needed.set(k, { city, state })
    }
    freeingTrucks.forEach(l => add(l.delivery_city, l.delivery_state))
    candidateLoads.forEach(l => add(l.pickup_city, l.pickup_state))

    let cancelled = false
    async function run() {
      const entries = [...needed.entries()]
      setProgress({ done: 0, total: entries.length })
      let done = 0
      const next = {}
      for (const [k, { city, state }] of entries) {
        if (cancelled) return
        const wasCached = k in _cache || localStorage.getItem(k) != null
        const v = await geocode(city, state)
        next[k] = v
        done++
        setProgress({ done, total: entries.length })
        setGeo(g => ({ ...g, [k]: v }))
        if (!wasCached) await sleep(400) // be polite to Nominatim on cold lookups
      }
    }
    run()
    return () => { cancelled = true }
  }, [freeingTrucks, candidateLoads])

  // Once cities are geocoded, get real road miles from each distinct origin city
  // to every candidate pickup (one routing call per origin, cached per city-pair).
  const geocoding = progress.total > 0 && progress.done < progress.total
  useEffect(() => {
    if (geocoding) return

    const origins = new Map() // oKey -> pos
    freeingTrucks.forEach(l => {
      const k = cacheKey(l.delivery_city, l.delivery_state)
      if (geo[k]) origins.set(k, geo[k])
    })
    const dests = []          // [{ key, pos }]
    const seen = new Set()
    candidateLoads.forEach(l => {
      const k = cacheKey(l.pickup_city, l.pickup_state)
      if (geo[k] && !seen.has(k)) { seen.add(k); dests.push({ key: k, pos: geo[k] }) }
    })
    if (!origins.size || !dests.length) { setRmProgress({ done: 0, total: 0 }); return }

    // Which origins still need any pair computed?
    const pending = [...origins.entries()].filter(([oKey]) =>
      dests.some(d => !(rmKey(oKey, d.key) in _rmCache))
    )
    if (!pending.length) return

    let cancelled = false
    async function run() {
      setRmProgress({ done: 0, total: pending.length })
      let done = 0
      for (const [oKey, pos] of pending) {
        if (cancelled) return
        const miss = dests.filter(d => !(rmKey(oKey, d.key) in _rmCache))
        // hydrate any cached pairs from localStorage before hitting the network
        const stillMiss = []
        for (const d of miss) {
          const stored = localStorage.getItem(rmKey(oKey, d.key))
          if (stored != null) _rmCache[rmKey(oKey, d.key)] = JSON.parse(stored)
          else stillMiss.push(d)
        }
        if (stillMiss.length) {
          const res = await fetchRoadMiles(pos, stillMiss)
          for (const d of stillMiss) {
            const v = res[d.key] ?? null
            _rmCache[rmKey(oKey, d.key)] = v
            try { localStorage.setItem(rmKey(oKey, d.key), JSON.stringify(v)) } catch { /* quota */ }
          }
        }
        const patch = {}
        for (const d of dests) patch[rmKey(oKey, d.key)] = _rmCache[rmKey(oKey, d.key)]
        setRoadMi(m => ({ ...m, ...patch }))
        done++
        setRmProgress({ done, total: pending.length })
        if (stillMiss.length) await sleep(300) // be polite to the routing server
      }
    }
    run()
    return () => { cancelled = true }
  }, [freeingTrucks, candidateLoads, geo, geocoding])

  // Match each freeing truck to its nearest candidate pickups.
  const items = useMemo(() => {
    const cap = maxDH ? Number(maxDH) : Infinity
    return freeingTrucks.map(load => {
      const fromKey = cacheKey(load.delivery_city, load.delivery_state)
      const origin = geo[fromKey]
      let candidates = []
      if (origin) {
        candidates = candidateLoads
          .filter(cl => cl.id !== load.id)
          .map(cl => {
            const dKey = cacheKey(cl.pickup_city, cl.pickup_state)
            const pos = geo[dKey]
            if (!pos) return null
            const road = roadMi[rmKey(fromKey, dKey)]
            // road miles when the router answered; otherwise straight-line estimate
            const approx = road == null
            const miles = approx ? haversineMiles(origin, pos) : road
            const gapDays = cl.pickup_date ? daysBetween(load.delivery_date, cl.pickup_date) : null
            return { load: cl, miles, approx, gapDays }
          })
          .filter(Boolean)
          .filter(c => c.miles <= cap)
          .filter(c => !afterFreeOnly || c.gapDays == null || c.gapDays >= 0)
          .sort((a, b) => a.miles - b.miles)
          .slice(0, topN)
      }
      return {
        load,
        candidates,
        freeCity: load.delivery_city,
        freeState: load.delivery_state,
        freeDate: load.delivery_date,
        originResolved: !!origin,
      }
    })
  }, [freeingTrucks, candidateLoads, geo, roadMi, maxDH, afterFreeOnly, topN])

  const routing = rmProgress.total > 0 && rmProgress.done < rmProgress.total

  const ctrlBox = {
    background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8,
    color: T.text, fontSize: 13, padding: '6px 9px', outline: 'none',
  }
  const labelStyle = { fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4, display: 'block' }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>
          Deadhead Matcher
        </h1>
        <p style={{ fontSize: 13, color: T.text3, marginTop: 5, lineHeight: 1.5 }}>
          For each truck delivering in the chosen window, this ranks the loads it could pick up next
          by <strong style={{ color: T.text2 }}>least deadhead</strong> — the empty miles from where it
          drops to where the next load loads.
        </p>
      </div>

      {/* Controls */}
      <div style={{
        background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 12,
        padding: '14px 16px', marginBottom: 20,
        display: 'grid', gap: 14,
        gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(120px, 1fr))',
      }}>
        <div>
          <label style={labelStyle}>Delivering from</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ ...ctrlBox, width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>through</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ ...ctrlBox, width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>Next-load pool</label>
          <select value={pool} onChange={e => setPool(e.target.value)} style={{ ...ctrlBox, width: '100%' }}>
            <option value="open">Open only</option>
            <option value="open_covered">Open + Covered</option>
            <option value="all">All upcoming</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Max deadhead (mi)</label>
          <input type="number" placeholder="any" value={maxDH} onChange={e => setMaxDH(e.target.value)} style={{ ...ctrlBox, width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>Show per truck</label>
          <select value={topN} onChange={e => setTopN(Number(e.target.value))} style={{ ...ctrlBox, width: '100%' }}>
            <option value={6}>Top 6</option>
            <option value={12}>Top 12</option>
            <option value={25}>Top 25</option>
            <option value={9999}>All</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
          <label style={{ fontSize: 12, color: T.text2, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={afterFreeOnly} onChange={e => setAfterFreeOnly(e.target.checked)} />
            Pickup on/after free date
          </label>
        </div>
      </div>

      {/* Summary / progress */}
      {!loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: T.text2 }}>
            <strong style={{ color: T.text }}>{freeingTrucks.length}</strong> truck{freeingTrucks.length !== 1 ? 's' : ''} freeing up
            {' · '}<strong style={{ color: T.text }}>{candidateLoads.length}</strong> candidate load{candidateLoads.length !== 1 ? 's' : ''}
          </div>
          {(geocoding || routing) && (
            <div style={{ fontSize: 11, color: T.text3, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{
                width: 12, height: 12, borderRadius: '50%',
                border: `2px solid ${T.sep}`, borderTopColor: T.blue,
                display: 'inline-block', animation: 'spin 0.8s linear infinite',
              }} />
              {geocoding
                ? `Mapping cities… ${progress.done}/${progress.total}`
                : `Calculating road miles… ${rmProgress.done}/${rmProgress.total}`}
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: T.text3, fontSize: 14 }}>Loading loads…</div>
      )}

      {!loading && freeingTrucks.length === 0 && (
        <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚚</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>No trucks delivering in this window</div>
          <div style={{ fontSize: 13, color: T.text3 }}>Widen the date range above, or check that loads have delivery dates set.</div>
        </div>
      )}

      {!loading && items.map(item => <TruckCard key={item.load.id} item={item} />)}

      {/* How it works */}
      {!loading && freeingTrucks.length > 0 && (
        <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, padding: '16px 18px', marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            How deadhead is calculated
          </div>
          <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.7 }}>
            Cities are geocoded (OpenStreetMap), then <strong style={{ color: T.text }}>actual driving
            miles</strong> are pulled from the OSRM road-routing engine — the same road network Google
            Maps routes on — between the truck's delivery city and each candidate's pickup city. Values
            marked <strong style={{ color: T.text }}>~ MI EST</strong> are a straight-line fallback used
            only when the router can't be reached. Distances are city-to-city, not exact dock addresses,
            and don't apply truck-specific restrictions. Loads with no pickup/delivery city are skipped.
          </div>
        </div>
      )}
    </div>
  )
}
