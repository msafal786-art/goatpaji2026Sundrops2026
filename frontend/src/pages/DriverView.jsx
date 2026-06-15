import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api.js'
import { T, STATUS } from '../theme.js'

const font = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"

function openMaps(addr) {
  const q = encodeURIComponent(addr)
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  window.open(isIOS ? `maps://maps.apple.com/?q=${q}` : `https://maps.google.com/?q=${q}`, '_blank')
}

function InfoRow({ label, value, mono, href }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: `1px solid ${T.sep}` }}>
      <span style={{ fontSize: 12, color: T.text3, fontWeight: 500, minWidth: 90, flexShrink: 0 }}>{label}</span>
      {href
        ? <a href={href} style={{ fontSize: 13, color: T.blue, textDecoration: 'none', fontWeight: 600 }}>{value}</a>
        : <span style={{ fontSize: 13, color: T.text, fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</span>
      }
    </div>
  )
}

function LocationBlock({ type, load }) {
  const isPickup = type === 'pickup'
  const color = isPickup ? T.blue : T.purple
  const city = isPickup
    ? [load.pickup_city, load.pickup_state].filter(Boolean).join(', ')
    : [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')
  const name    = isPickup ? load.pickup_name    : load.delivery_name
  const address = isPickup ? load.pickup_address : load.delivery_address
  const date    = isPickup ? load.pickup_date    : load.delivery_date
  const time    = isPickup ? load.pickup_time    : load.delivery_time
  const phone   = isPickup ? load.pickup_phone   : load.delivery_phone
  const refs    = isPickup ? load.pickup_refs    : load.delivery_refs
  const mapsAddr = [address || name, city].filter(Boolean).join(', ')

  return (
    <div style={{
      background: T.bg2, borderRadius: 14, padding: '14px 16px',
      border: `1px solid ${color}25`, borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8 }}>
        {isPickup ? '📍 Pickup' : '📦 Delivery'}
      </div>

      {name && <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8 }}>{name}</div>}

      {mapsAddr && (
        <button onClick={() => openMaps(mapsAddr)} style={{
          display: 'block', width: '100%', textAlign: 'left',
          background: color + '12', border: `1px solid ${color}25`,
          borderRadius: 10, padding: '10px 12px', cursor: 'pointer', marginBottom: 10,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color }}>{city}</div>
          {address && <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{address}</div>}
          <div style={{ fontSize: 11, color, marginTop: 5, fontWeight: 700 }}>Open in Maps →</div>
        </button>
      )}

      <InfoRow label="Date"      value={date} />
      <InfoRow label="Time"      value={time} />
      <InfoRow label="Phone"     value={phone} href={phone ? `tel:${phone}` : null} />
      <InfoRow label="Reference" value={refs} mono />
    </div>
  )
}

function fmtTime(iso) {
  if (!iso) return null
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

function LoadCard({ load, onStatusUpdate }) {
  const [updating, setUpdating] = useState(false)
  const [trailerInput, setTrailerInput] = useState(load.trailer_number || '')
  const [savingTrailer, setSavingTrailer] = useState(false)
  const [timeSaving, setTimeSaving] = useState(null)
  const [localCheckin, setLocalCheckin] = useState(load.checkin_time)
  const [localCheckout, setLocalCheckout] = useState(load.checkout_time)
  const s = STATUS[load.status] || STATUS.pending

  async function doUpdate(newStatus) {
    if (updating) return
    setUpdating(true)
    try { await api.updateLoadStatus(load.id, newStatus); onStatusUpdate() }
    finally { setUpdating(false) }
  }

  async function saveTrailer() {
    if (trailerInput === (load.trailer_number || '')) return
    setSavingTrailer(true)
    try { await api.setTrailer(load.id, trailerInput); onStatusUpdate() }
    finally { setSavingTrailer(false) }
  }

  async function doCheckin() {
    setTimeSaving('in')
    try {
      const res = await api.checkIn(load.id)
      setLocalCheckin(res.checkin_time)
      onStatusUpdate()
    } finally { setTimeSaving(null) }
  }

  async function doCheckout() {
    setTimeSaving('out')
    try {
      const res = await api.checkOut(load.id)
      setLocalCheckout(res.checkout_time)
      onStatusUpdate()
    } finally { setTimeSaving(null) }
  }

  const NEXT = {
    pending:    [{ status: 'dispatched', label: 'Start Trip',             color: T.blue,   icon: '🚛' }],
    assigned:   [{ status: 'dispatched', label: 'Start Trip',             color: T.blue,   icon: '🚛' }],
    dispatched: [{ status: 'in_transit', label: 'Picked Up — En Route',   color: T.green,  icon: '✅' }],
    in_transit: [{ status: 'delivered',  label: 'Delivered',              color: T.teal,   icon: '📦' }],
  }
  const actions = NEXT[load.status] || []
  const pickupCity  = [load.pickup_city, load.pickup_state].filter(Boolean).join(', ')
  const delivCity   = [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

  return (
    <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 18, overflow: 'hidden', marginBottom: 14 }}>

      {/* Header */}
      <div style={{ background: s.color + '15', borderBottom: `1px solid ${s.color}25`, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: -0.5 }}>{load.load_number || `#${load.id}`}</div>
            {load.broker_name && <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>{load.broker_name}</div>}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 20,
            background: s.color + '22', color: s.color, border: `1px solid ${s.color}35`,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>{s.label}</span>
        </div>

        {/* Route */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: T.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Pickup</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>{pickupCity || '—'}</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{load.pickup_date}{load.pickup_time ? ` · ${load.pickup_time}` : ''}</div>
          </div>
          <div style={{ fontSize: 20, color: T.text3 }}>→</div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: T.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Delivery</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>{delivCity || '—'}</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{load.delivery_date}{load.delivery_time ? ` · ${load.delivery_time}` : ''}</div>
          </div>
        </div>
      </div>

      {/* Trailer # + check-in/out controls */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.sep}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Trailer number */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: T.text3, fontWeight: 600, minWidth: 68 }}>Trailer #</span>
          <input
            value={trailerInput}
            onChange={e => setTrailerInput(e.target.value)}
            onBlur={saveTrailer}
            placeholder="Enter trailer #"
            style={{
              flex: 1, padding: '8px 10px', background: T.bg2, border: `1px solid ${T.sep}`,
              borderRadius: 8, fontSize: 13, color: T.text, outline: 'none',
            }}
          />
          {savingTrailer && <span style={{ fontSize: 11, color: T.text3 }}>Saving…</span>}
        </div>

        {/* Check-in / Check-out */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            {localCheckin ? (
              <div style={{ background: T.green + '18', borderRadius: 10, padding: '8px 12px', border: `1px solid ${T.green}30` }}>
                <div style={{ fontSize: 10, color: T.green, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Checked In</div>
                <div style={{ fontSize: 12, color: T.text, marginTop: 3 }}>{fmtTime(localCheckin)}</div>
              </div>
            ) : (
              <button onClick={doCheckin} disabled={timeSaving === 'in'} style={{
                width: '100%', padding: '10px', background: T.green + '22', border: `1px solid ${T.green}40`,
                borderRadius: 10, color: T.green, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>{timeSaving === 'in' ? 'Saving…' : '📍 Check In'}</button>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            {localCheckout ? (
              <div style={{ background: T.teal + '18', borderRadius: 10, padding: '8px 12px', border: `1px solid ${T.teal}30` }}>
                <div style={{ fontSize: 10, color: T.teal, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Checked Out</div>
                <div style={{ fontSize: 12, color: T.text, marginTop: 3 }}>{fmtTime(localCheckout)}</div>
              </div>
            ) : (
              <button onClick={doCheckout} disabled={timeSaving === 'out'} style={{
                width: '100%', padding: '10px', background: T.teal + '22', border: `1px solid ${T.teal}40`,
                borderRadius: 10, color: T.teal, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>{timeSaving === 'out' ? 'Saving…' : '🏁 Check Out'}</button>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {actions.length > 0 && (
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.sep}` }}>
          {actions.map(a => (
            <button key={a.status} onClick={() => doUpdate(a.status)} disabled={updating} style={{
              display: 'block', width: '100%', padding: '16px',
              borderRadius: 14, background: a.color, border: 'none',
              color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: -0.2,
              cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1,
            }}>
              {a.icon} {updating ? 'Updating…' : a.label}
            </button>
          ))}
        </div>
      )}

      {load.status === 'delivered' && (
        <div style={{ padding: '20px 16px', textAlign: 'center', borderBottom: `1px solid ${T.sep}` }}>
          <div style={{ fontSize: 36, marginBottom: 6 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.green }}>Delivered — great work</div>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>Your dispatcher will mark as complete</div>
        </div>
      )}

      {/* Location details */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <LocationBlock type="pickup" load={load} />
        <LocationBlock type="delivery" load={load} />

        {(load.tractor_number || load.truck_trailer || load.trailer_number || load.trailer_type || load.weight || load.commodity) && (
          <div style={{ background: T.bg2, borderRadius: 12, padding: '12px 14px', border: `1px solid ${T.sep}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Equipment</div>
            <InfoRow label="Tractor"   value={load.tractor_number} />
            <InfoRow label="Trailer"   value={load.trailer_number || load.truck_trailer} />
            <InfoRow label="Type"      value={load.trailer_type} />
            <InfoRow label="Weight"    value={load.weight ? `${Number(load.weight).toLocaleString()} lbs` : null} />
            <InfoRow label="Commodity" value={load.commodity} />
          </div>
        )}

        {load.special_instructions && (
          <div style={{ background: T.orange + '10', borderRadius: 12, padding: '12px 14px', border: `1px solid ${T.orange}25` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.orange, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>⚠ Special Instructions</div>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{load.special_instructions}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DriverView({ user, onLogout }) {
  const [loads, setLoads] = useState([])
  const [tab, setTab] = useState('active')
  const [lastUpdate, setLastUpdate] = useState(new Date())

  const fetch = useCallback(async () => {
    const data = await api.loads()
    setLoads(data)
    setLastUpdate(new Date())
  }, [])

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, 15000)
    return () => clearInterval(interval)
  }, [fetch])

  // Server already filters to dispatched/in_transit/delivered — split into active vs history
  const activeLoads    = loads.filter(l => ['dispatched','in_transit'].includes(l.status))
  const historyLoads   = loads.filter(l => l.status === 'delivered')
  const shown = tab === 'active' ? activeLoads : historyLoads

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: font }}>

      {/* Sticky header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: T.bg1 + 'f2',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${T.sep}`,
        padding: '14px 18px',
        paddingTop: 'max(14px, env(safe-area-inset-top))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{user.full_name || user.username}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, display: 'inline-block' }} />
              <span style={{ fontSize: 11, color: T.text3 }}>{lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <button onClick={() => { if (!window.confirm('Sign out?')) return; onLogout() }} style={{
            background: T.bg2, border: `1px solid ${T.sep}`, color: T.text2,
            padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>Sign out</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {[
            { key: 'active',  label: `On Route (${activeLoads.length})` },
            { key: 'history', label: `Delivered (${historyLoads.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
              background: tab === t.key ? T.blue : T.bg2,
              color: tab === t.key ? '#fff' : T.text2,
            }}>{t.label}</button>
          ))}
          <button onClick={fetch} style={{
            marginLeft: 'auto', padding: '7px 12px', borderRadius: 20,
            background: T.bg2, border: `1px solid ${T.sep}`, color: T.text3, fontSize: 14, cursor: 'pointer',
          }}>↻</button>
        </div>
      </div>

      <div style={{ padding: '16px 14px', paddingBottom: 'max(40px, env(safe-area-inset-bottom))' }}>
        {shown.length === 0 ? (
          <div style={{
            background: T.bg1, borderRadius: 18, padding: '56px 24px',
            textAlign: 'center', border: `1px solid ${T.sep}`, marginTop: 8,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{tab === 'active' ? '✓' : '📋'}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              {tab === 'active' ? 'No active loads' : 'No delivered loads'}
            </div>
            <div style={{ fontSize: 13, color: T.text3 }}>
              {tab === 'active' ? 'Loads appear here once your dispatcher sends the dispatch.' : 'Loads you delivered appear here.'}
            </div>
          </div>
        ) : (
          shown.map(l => <LoadCard key={l.id} load={l} onStatusUpdate={fetch} />)
        )}
      </div>
    </div>
  )
}
