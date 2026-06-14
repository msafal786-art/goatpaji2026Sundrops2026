import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'
import { T, STATUS, carrierColor, ACTIVE_CARRIERS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import LoadForm from '../components/LoadForm.jsx'

function isLate(load) {
  const now = new Date()
  const pickupPassed = load.pickup_date && new Date(load.pickup_date + 'T' + (load.pickup_time?.replace(' AM','').replace(' PM','') || '00:00')) < now
  const notPickedUp = ['pending','assigned'].includes(load.status)
  const deliveryPassed = load.delivery_date && new Date(load.delivery_date + 'T00:00') < now
  const notDelivered = !['delivered','completed'].includes(load.status)
  return (pickupPassed && notPickedUp) || (deliveryPassed && notDelivered)
}

// Urgency color: overrides status color for unassigned/near-pickup loads
function urgencyColor(load) {
  const s = STATUS[load.status] || STATUS.pending
  if (isLate(load)) return T.red                          // overdue — red
  if (['in_transit'].includes(load.status)) return T.green // moving — green
  if (['dispatched'].includes(load.status)) return T.orange // dispatched, on way to pickup — warm amber
  if (['delivered'].includes(load.status)) return T.teal   // delivered — teal
  if (['completed'].includes(load.status)) return T.text3  // done — muted

  // Pending/assigned: check proximity to pickup
  if (load.pickup_date) {
    const now = new Date()
    const pickup = new Date(load.pickup_date + 'T06:00')
    const hoursUntil = (pickup - now) / 36e5
    if (!load.driver_id && hoursUntil <= 24 && hoursUntil >= 0) return T.red   // urgent unassigned
    if (!load.driver_id) return 'rgba(235,235,245,0.22)'                         // unassigned, far out — pale
    if (hoursUntil <= 24) return T.orange                                         // assigned, pickup soon — warm
  }
  return s.color
}

function pickupAlertNeeded(load) {
  if (!load.pickup_date) return false
  const now = new Date()
  let pickupDT = new Date(load.pickup_date + 'T00:00')
  if (load.pickup_time) {
    const m = load.pickup_time.trim().match(/(\d+):(\d+)\s*(AM|PM)?/i)
    if (m) {
      let h = parseInt(m[1]), min = parseInt(m[2])
      if (m[3]?.toUpperCase() === 'PM' && h !== 12) h += 12
      if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0
      pickupDT = new Date(load.pickup_date + 'T' + String(h).padStart(2,'0') + ':' + String(min).padStart(2,'0'))
    }
  }
  return pickupDT < now && ['pending','assigned','dispatched'].includes(load.status)
}

function LoadTile({ load, onStatusUpdate, onEdit }) {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [hovered, setHovered] = useState(false)
  const late = isLate(load)
  const alert = pickupAlertNeeded(load)
  const s = STATUS[load.status] || STATUS.pending
  const accentColor = urgencyColor(load)
  const compColor = carrierColor(load.company_name)
  const shortCompany = load.company_name
    ? load.company_name.replace(' INC','').replace(' LLC','').replace('THE FRONTLINE FREIGHT','FRONTLINE').replace(' BROS','')
    : null

  async function handleStatusClick(e, status) {
    e.stopPropagation()
    await api.updateLoadStatus(load.id, status)
    onStatusUpdate()
  }

  async function handleInvoice(e) {
    e.stopPropagation()
    if (!confirm(`Mark load ${load.load_number || '#'+load.id} as invoiced and complete?`)) return
    await api.updateLoadStatus(load.id, 'completed')
    onStatusUpdate()
  }

  const pickupCity = [load.pickup_city, load.pickup_state].filter(Boolean).join(', ')
  const delivCity = [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

  const tile = {
    position: 'relative',
    background: hovered ? T.bg2 : T.bg1,
    border: `1px solid ${T.sep}`,
    borderLeft: `3px solid ${accentColor}`,
    borderRadius: 10,
    marginBottom: 5,
    overflow: 'hidden',
    transition: 'background 0.12s',
    cursor: 'pointer',
  }

  if (mobile) {
    return (
      <div
        style={tile}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div onClick={() => navigate(`/loads/${load.id}`)} style={{ padding: '11px 13px 11px 14px' }}>
          {/* Row 1 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: -0.2 }}>
                {late && <span style={{ color: T.red, marginRight: 4, fontWeight: 800 }}>!</span>}
                {load.load_number || `#${load.id}`}
              </span>
              {load.broker_name && (
                <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{load.broker_name}</div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
              <StatusPill color={accentColor} label={late ? 'Late' : s.label} sent={load.dispatch_sent} />
              {load.status === 'delivered'
                ? <ActionBtn color={T.green} onClick={handleInvoice}>Invoice ✓</ActionBtn>
                : <ActionBtn color={T.text2} onClick={e => { e.stopPropagation(); onEdit(load) }}>Edit</ActionBtn>
              }
            </div>
          </div>
          {/* Row 2: driver + company */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: load.driver_name ? T.text : T.orange }}>
              {load.driver_name || '— Assign Driver —'}
            </span>
            {shortCompany && (
              <span style={{ fontSize: 10, background: compColor + '1a', color: compColor, padding: '2px 8px', borderRadius: 20, fontWeight: 600, border: `1px solid ${compColor}33` }}>
                {shortCompany}
              </span>
            )}
          </div>
          {/* Row 3: truck */}
          {(load.tractor_number || load.truck_trailer) && (
            <div style={{ fontSize: 10, color: T.text3, marginBottom: 7, letterSpacing: 0.1 }}>
              {load.tractor_number && `Truck ${load.tractor_number}`}{load.tractor_number && load.truck_trailer && ' · '}{load.truck_trailer && `Trailer ${load.truck_trailer}`}
            </div>
          )}
          {/* Row 4: route */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, marginTop: 4 }}>
            <div style={{ flex: 1, borderRight: `1px solid ${T.sep}`, paddingRight: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Pickup</div>
              <div style={{ fontSize: 12, color: T.text, fontWeight: 500, lineHeight: 1.3 }}>{pickupCity || load.pickup_name || '—'}</div>
              {load.pickup_date && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{load.pickup_date}{load.pickup_time && ` · ${load.pickup_time}`}</div>}
            </div>
            <div style={{ flex: 1, paddingLeft: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Delivery</div>
              <div style={{ fontSize: 12, color: T.text, fontWeight: 500, lineHeight: 1.3 }}>{delivCity || load.delivery_name || '—'}</div>
              {load.delivery_date && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{load.delivery_date}{load.delivery_time && ` · ${load.delivery_time}`}</div>}
            </div>
          </div>
        </div>
        {alert && <AlertBar mobile onStatusClick={handleStatusClick} onView={() => navigate(`/loads/${load.id}`)} />}
      </div>
    )
  }

  return (
    <div
      style={tile}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={() => navigate(`/loads/${load.id}`)}
        style={{ padding: '10px 14px 10px 15px', display: 'flex', alignItems: 'center', gap: 16 }}
      >
        {/* Load # + broker */}
        <div style={{ minWidth: 115, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, letterSpacing: -0.1 }}>
            {late && <span style={{ color: T.red, marginRight: 4, fontWeight: 800 }}>!</span>}
            {load.load_number || `#${load.id}`}
          </div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 3, maxWidth: 115, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {load.broker_name || <span style={{ color: 'transparent' }}>—</span>}
          </div>
        </div>

        {/* Driver */}
        <div style={{ minWidth: 120, flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Driver</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: load.driver_name ? T.text : T.orange }}>
            {load.driver_name || '— Assign —'}
          </div>
          {(load.tractor_number || load.truck_trailer) && (
            <div style={{ fontSize: 9, color: T.text3, marginTop: 2 }}>
              {load.tractor_number && `T ${load.tractor_number}`}{load.tractor_number && load.truck_trailer && ' · '}{load.truck_trailer && `Tr ${load.truck_trailer}`}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 38, background: T.sep, flexShrink: 0 }} />

        {/* Pickup */}
        <div style={{ minWidth: 135, flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Pickup</div>
          <div style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{pickupCity || load.pickup_name || '—'}</div>
          {load.pickup_date && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{load.pickup_date}{load.pickup_time && ` · ${load.pickup_time}`}</div>}
        </div>

        <div style={{ color: T.text3, fontSize: 12, flexShrink: 0 }}>→</div>

        {/* Delivery */}
        <div style={{ minWidth: 135, flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Delivery</div>
          <div style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{delivCity || load.delivery_name || '—'}</div>
          {load.delivery_date && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{load.delivery_date}{load.delivery_time && ` · ${load.delivery_time}`}</div>}
        </div>

        {/* Company chip */}
        {shortCompany && (
          <div style={{ flexShrink: 0 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
              background: compColor + '1a', color: compColor, border: `1px solid ${compColor}33`,
              whiteSpace: 'nowrap',
            }}>{shortCompany}</span>
          </div>
        )}

        {/* Status + actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <StatusPill color={accentColor} label={late ? 'Late' : s.label} sent={load.dispatch_sent} />
          {load.status === 'delivered'
            ? <ActionBtn color={T.green} onClick={handleInvoice}>Invoice ✓</ActionBtn>
            : <ActionBtn color={T.text2} onClick={e => { e.stopPropagation(); onEdit(load) }}>Edit</ActionBtn>
          }
        </div>
      </div>

      {alert && <AlertBar onStatusClick={handleStatusClick} onView={() => navigate(`/loads/${load.id}`)} />}
    </div>
  )
}

function StatusPill({ color, label, sent }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
      background: color + '18', color, border: `1px solid ${color}30`,
      textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}{sent ? ' ✓' : ''}
    </span>
  )
}

function ActionBtn({ color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
      background: 'transparent', border: `1px solid ${T.sep}`, color,
    }}>{children}</button>
  )
}

function AlertBar({ mobile, onStatusClick, onView }) {
  return (
    <div style={{
      background: T.bg2, borderTop: `1px solid ${T.sep}`,
      padding: mobile ? '8px 13px' : '7px 15px',
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: T.orange }}>Pickup window passed</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={alertBtn(T.green)} onClick={e => onStatusClick(e, 'in_transit')}>Picked Up</button>
        <button style={alertBtn(T.blue)} onClick={e => onStatusClick(e, 'dispatched')}>Loaded</button>
        <button style={alertBtn(T.orange)} onClick={e => { e.stopPropagation(); onView() }}>Detention</button>
      </div>
    </div>
  )
}

function alertBtn(color) {
  return {
    fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    background: color + '22', border: `1px solid ${color}40`, color,
    fontWeight: 700,
  }
}

const SORT_OPTIONS = [
  { key: 'delivery_asc',  label: '↑ Delivery' },
  { key: 'delivery_desc', label: '↓ Delivery' },
  { key: 'pickup_asc',   label: '↑ Pickup' },
  { key: 'pickup_desc',  label: '↓ Pickup' },
]

const STATUS_TABS = [
  { key: 'active',     label: 'Active' },
  { key: 'late',       label: 'Late' },
  { key: 'pending',    label: 'Pending' },
  { key: 'assigned',   label: 'Assigned' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'invoice',    label: 'To Invoice' },
  { key: 'completed',  label: 'Completed' },
  { key: 'all',        label: 'All' },
]

// Short display names for carrier chips
const CARRIER_SHORT = {
  'WMK STAR INC': 'WMK',
  'SANT TRANS INC': 'Sant',
  'THE FRONTLINE FREIGHT INC': 'Frontline',
  'CHEEMA BROS TRANS INC': 'Cheema',
  'BROTHERS LOGISTICS INC': 'Brothers',
}

export default function Loads() {
  const { user } = useAuth()
  const mobile = useIsMobile()
  const [loads, setLoads] = useState([])
  const [companies, setCompanies] = useState([])
  const [companyFilter, setCompanyFilter] = useState('')
  const [activeTab, setActiveTab] = useState('active')
  const [sort, setSort] = useState('delivery_asc')
  const [showForm, setShowForm] = useState(false)
  const [editLoad, setEditLoad] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const fetchLoads = useCallback(async () => {
    const params = {}
    if (companyFilter) params.company_id = companyFilter
    setLoads(await api.loads(params))
    setLastRefresh(new Date())
  }, [companyFilter])

  useEffect(() => {
    fetchLoads()
    if (user.role === 'dispatcher') api.companies().then(setCompanies)
  }, [fetchLoads])

  useEffect(() => {
    const interval = setInterval(fetchLoads, 15000)
    return () => clearInterval(interval)
  }, [fetchLoads])

  const ACTIVE_STATUSES = ['pending','assigned','dispatched','in_transit']

  const filtered = loads.filter(l => {
    if (activeTab === 'all') return true
    if (activeTab === 'active') return ACTIVE_STATUSES.includes(l.status)
    if (activeTab === 'late') return isLate(l)
    if (activeTab === 'invoice') return l.status === 'delivered'
    return l.status === activeTab
  })

  const sorted = [...filtered].sort((a, b) => {
    const [field, dir] = sort.split('_')
    const da = new Date((field === 'delivery' ? a.delivery_date : a.pickup_date) || '9999')
    const db2 = new Date((field === 'delivery' ? b.delivery_date : b.pickup_date) || '9999')
    return dir === 'asc' ? da - db2 : db2 - da
  })

  const countTab = (key) => {
    if (key === 'all') return loads.length
    if (key === 'active') return loads.filter(l => ACTIVE_STATUSES.includes(l.status)).length
    if (key === 'late') return loads.filter(isLate).length
    if (key === 'invoice') return loads.filter(l => l.status === 'delivered').length
    return loads.filter(l => l.status === key).length
  }

  // Active carrier quick filters — exact match against the 5 carriers only
  const activeCarrierCompanies = ACTIVE_CARRIERS
    .map(ac => companies.find(c => c.name.toUpperCase() === ac))
    .filter(Boolean)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: mobile ? 12 : 18 }}>
        <div>
          <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>Load Board</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, display: 'inline-block', opacity: 0.9 }} />
            <span style={{ fontSize: 11, color: T.text3 }}>
              {loads.length} loads · syncs every 15s · {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={fetchLoads} style={{
            padding: mobile ? '7px 10px' : '8px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
            borderRadius: 8, cursor: 'pointer', fontSize: 12, color: T.text2, fontWeight: 600,
          }}>↻</button>
          <button onClick={() => { setEditLoad(null); setShowForm(true) }} style={{
            padding: mobile ? '7px 12px' : '8px 16px', background: T.blue, border: 'none',
            borderRadius: 8, cursor: 'pointer', fontSize: mobile ? 12 : 13, color: '#fff', fontWeight: 600,
          }}>+ Add Load</button>
        </div>
      </div>

      {/* Carrier quick-filter chips */}
      {user.role === 'dispatcher' && activeCarrierCompanies.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setCompanyFilter('')}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${!companyFilter ? T.text2 : T.sep}`,
              background: !companyFilter ? T.bg2 : 'transparent',
              color: !companyFilter ? T.text : T.text3,
            }}
          >All</button>
          {activeCarrierCompanies.map(c => {
            const color = carrierColor(c.name)
            const active = companyFilter === String(c.id)
            return (
              <button key={c.id} onClick={() => setCompanyFilter(active ? '' : String(c.id))} style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${active ? color : color + '50'}`,
                background: active ? color + '25' : color + '12',
                color: active ? color : color + 'cc',
              }}>
                {CARRIER_SHORT[c.name] || c.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Sort + controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2, background: T.bg2, borderRadius: 8, padding: 3 }}>
          {SORT_OPTIONS.map(o => (
            <button key={o.key} onClick={() => setSort(o.key)} style={{
              padding: '5px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: sort === o.key ? T.bg3 : 'transparent',
              color: sort === o.key ? T.text : T.text2,
            }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
        {STATUS_TABS.map(t => {
          const count = countTab(t.key)
          const active = activeTab === t.key
          const lateTab = t.key === 'late'
          const tabColor = lateTab ? T.red : T.blue
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
              border: `1px solid ${active ? tabColor : T.sep}`,
              background: active ? tabColor + '22' : 'transparent',
              color: active ? tabColor : (lateTab && count > 0 ? T.red : T.text2),
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {t.label}
              {count > 0 && (
                <span style={{
                  marginLeft: 5, fontSize: 10, padding: '0px 5px', borderRadius: 8,
                  background: active ? tabColor + '40' : T.bg2,
                  color: active ? tabColor : T.text3,
                }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Load tiles */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: T.text3, background: T.bg1, borderRadius: 12, border: `1px solid ${T.sep}` }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No loads in this view</div>
        </div>
      ) : (
        <div>
          {sorted.map(l => (
            <LoadTile
              key={l.id}
              load={l}
              onStatusUpdate={fetchLoads}
              onEdit={(load) => { setEditLoad(load); setShowForm(true) }}
            />
          ))}
        </div>
      )}

      {showForm && (
        <LoadForm
          load={editLoad}
          onClose={() => { setShowForm(false); setEditLoad(null) }}
          onSave={() => { fetchLoads(); setShowForm(false); setEditLoad(null) }}
        />
      )}
    </div>
  )
}
