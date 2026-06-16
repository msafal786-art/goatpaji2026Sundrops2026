import React, { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { T, STATUS } from '../theme.js'

const ACTIVE_STATUSES = ['dispatched', 'loading', 'on_route', 'unloading', 'in_yard']

function coloredIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.45)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  })
}

// In-memory + localStorage geocoding cache (Nominatim, free)
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function FitBounds({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [48, 48], maxZoom: 9 })
    }
  }, [positions.length])
  return null
}

export default function FleetMap({ loads }) {
  const [markers, setMarkers] = useState([])
  const [plotting, setPlotting] = useState(true)

  useEffect(() => {
    const active = loads.filter(l => ACTIVE_STATUSES.includes(l.status))
    if (!active.length) { setMarkers([]); setPlotting(false); return }

    let cancelled = false
    setPlotting(true)

    async function run() {
      const result = []
      for (const load of active) {
        if (cancelled) break
        // Pick current location: dispatched/loading = at pickup, everything else = heading to delivery
        const atPickup = ['dispatched', 'loading'].includes(load.status)
        const city  = atPickup ? load.pickup_city  : load.delivery_city
        const state = atPickup ? load.pickup_state : load.delivery_state
        const pos = await geocode(city, state)
        if (pos) result.push({ load, pos })
        await sleep(350) // respect Nominatim 1 req/sec limit
      }
      if (!cancelled) { setMarkers(result); setPlotting(false) }
    }
    run()
    return () => { cancelled = true }
  }, [loads])

  const positions = markers.map(m => [m.pos.lat, m.pos.lng])

  return (
    <div style={{ position: 'relative', height: 400, borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.sep}` }}>
      <MapContainer center={[39.5, -98.35]} zoom={4} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {markers.map(({ load, pos }) => {
          const s = STATUS[load.status] || STATUS.open
          const route = [
            [load.pickup_city, load.pickup_state].filter(Boolean).join(', '),
            [load.delivery_city, load.delivery_state].filter(Boolean).join(', '),
          ].filter(Boolean).join(' → ')
          return (
            <Marker key={load.id} position={[pos.lat, pos.lng]} icon={coloredIcon(s.color)}>
              <Popup>
                <div style={{ fontFamily: 'system-ui', minWidth: 200, padding: '2px 0' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
                    {load.driver_name || 'Unassigned'}
                  </div>
                  <div style={{ fontSize: 11, color: '#777', marginBottom: 5 }}>
                    {load.load_number || load.broker_order || `#${load.id}`}
                    {load.broker_name ? ` · ${load.broker_name}` : ''}
                  </div>
                  <div style={{ fontSize: 11, marginBottom: 7, lineHeight: 1.4 }}>{route}</div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: s.color + '22', color: s.color, border: `1px solid ${s.color}44`,
                  }}>{s.label.toUpperCase()}</span>
                  {load.trailer_number && (
                    <div style={{ fontSize: 10, color: '#888', marginTop: 5 }}>Trailer: {load.trailer_number}</div>
                  )}
                  {load.pickup_date && (
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                      PU: {load.pickup_date} → DEL: {load.delivery_date || '—'}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          )
        })}
        {positions.length > 0 && <FitBounds positions={positions} />}
      </MapContainer>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 10, left: 10, zIndex: 1000,
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)',
        borderRadius: 8, padding: '7px 11px', fontSize: 10, fontWeight: 600,
        display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 300,
        boxShadow: '0 1px 6px rgba(0,0,0,0.15)',
      }}>
        {['dispatched','loading','on_route','unloading','in_yard'].map(s => {
          const st = STATUS[s]
          const count = markers.filter(m => m.load.status === s).length
          if (!count) return null
          return (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#333' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.color, display: 'inline-block' }} />
              {st.label} ({count})
            </span>
          )
        })}
      </div>

      {/* Loading overlay */}
      {plotting && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 1000,
          background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)',
          borderRadius: 8, padding: '5px 11px', fontSize: 11, color: '#555',
          boxShadow: '0 1px 5px rgba(0,0,0,0.12)',
        }}>
          Plotting trucks…
        </div>
      )}
    </div>
  )
}
