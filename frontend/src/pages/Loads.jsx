import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
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

function LoadRow({ load, onStatusUpdate, onEdit, onStatusDrawer }) {
  const navigate = useNavigate()
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
  const delivCity  = [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

  const rowBg = late
    ? (T.isDark ? 'rgba(255,69,58,0.08)' : 'rgba(255,59,48,0.06)')
    : load.status === 'in_transit'
      ? (T.isDark ? 'rgba(48,209,88,0.06)' : 'rgba(48,209,88,0.05)')
      : load.status === 'dispatched'
        ? (T.isDark ? 'rgba(191,90,242,0.06)' : 'rgba(191,90,242,0.04)')
        : 'transparent'

  return (
    <>
      <tr
        onClick={() => navigate(`/loads/${load.id}`)}
        style={{ borderBottom: `1px solid ${T.sep}`, background: rowBg, cursor: 'pointer', transition: 'background 0.1s' }}
        onMouseEnter={e => e.currentTarget.style.background = T.bg2}
        onMouseLeave={e => e.currentTarget.style.background = rowBg}
      >
        {/* Load # */}
        <td style={{ padding: '7px 10px 7px 14px', whiteSpace: 'nowrap', borderLeft: `3px solid ${accentColor}` }}>
          {load.broker_order && (
            <div style={{ fontSize: 12, fontWeight: 700, color: late ? T.red : T.text }}>
              {late && '! '}{load.broker_order}
            </div>
          )}
          <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>
            #{load.load_number || load.id} · {load.broker_name}
          </div>
        </td>

        {/* Driver / Carrier */}
        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: load.driver_name ? T.text : T.orange }}>
            {load.driver_name || '— Assign —'}
          </div>
          {shortCompany && (
            <div style={{ fontSize: 10, fontWeight: 700, color: compColor, marginTop: 1 }}>{shortCompany}</div>
          )}
        </td>

        {/* Ship Date */}
        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontSize: 11, color: T.text2 }}>
          {load.pickup_date || '—'}
          {load.pickup_time && <div style={{ fontSize: 10, color: T.text3 }}>{load.pickup_time}</div>}
        </td>

        {/* Del Date */}
        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontSize: 11, color: T.text2 }}>
          {load.delivery_date || '—'}
          {load.delivery_time && <div style={{ fontSize: 10, color: T.text3 }}>{load.delivery_time}</div>}
        </td>

        {/* Origin */}
        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, color: T.text }}>{pickupCity || load.pickup_name || '—'}</div>
        </td>

        {/* Destination */}
        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, color: T.text }}>{delivCity || load.delivery_name || '—'}</div>
        </td>

        {/* Status */}
        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
            background: accentColor + '20', color: accentColor,
          }}>
            {late ? 'LATE' : s.label.toUpperCase()}{load.dispatch_sent ? ' ✓' : ''}
          </span>
          {alert && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }} onClick={e => e.stopPropagation()}>
              <button style={alertBtn(T.green)}  onClick={e => handleStatusClick(e, 'in_transit')}>Picked Up</button>
              <button style={alertBtn(T.blue)}   onClick={e => handleStatusClick(e, 'dispatched')}>Loaded</button>
            </div>
          )}
        </td>

        {/* Actions */}
        <td style={{ padding: '7px 14px 7px 6px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 5 }}>
            <button style={tblBtn(T.blue)}  onClick={() => onStatusDrawer(load)}>Status</button>
            {load.status === 'delivered'
              ? <button style={tblBtn(T.green)} onClick={handleInvoice}>Invoice</button>
              : <button style={tblBtn(T.text2)} onClick={() => onEdit(load)}>Edit</button>
            }
          </div>
        </td>
      </tr>
    </>
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

function tblBtn(color) {
  return {
    fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', fontWeight: 600,
    background: color + '18', border: `1px solid ${color}40`, color,
  }
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

const STATUS_FLOW = [
  { key: 'pending',    label: 'Pending',     desc: 'Not yet assigned' },
  { key: 'assigned',   label: 'Assigned',    desc: 'Driver assigned' },
  { key: 'dispatched', label: 'Dispatched',  desc: 'En route to pickup' },
  { key: 'in_transit', label: 'In Transit',  desc: 'Picked up, moving' },
  { key: 'delivered',  label: 'Delivered',   desc: 'At destination' },
  { key: 'completed',  label: 'Completed',   desc: 'Invoiced & done' },
]

function StatusDrawer({ load, onClose, onSaved }) {
  const [saving, setSaving] = useState(null)
  if (!load) return null

  const pickupCity = [load.pickup_city, load.pickup_state].filter(Boolean).join(', ')
  const delivCity  = [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

  async function handleStatus(key) {
    if (key === load.status) { onClose(); return }
    setSaving(key)
    await api.updateLoadStatus(load.id, key)
    setSaving(null)
    onSaved()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100 }} />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 340, maxWidth: '95vw',
        background: T.bg1, borderLeft: `1px solid ${T.sep}`, zIndex: 1101,
        display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${T.sep}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>
              {load.load_number || `#${load.id}`}
            </div>
            <div style={{ fontSize: 12, color: T.text3, marginTop: 3 }}>{load.broker_name || '—'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: T.text3, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Load summary */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.sep}`, display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Pickup</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{pickupCity || '—'}</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{load.pickup_date}</div>
          </div>
          <div style={{ color: T.text3, alignSelf: 'center', fontSize: 16 }}>→</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Delivery</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{delivCity || '—'}</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{load.delivery_date}</div>
          </div>
        </div>

        {load.driver_name && (
          <div style={{ padding: '10px 20px', borderBottom: `1px solid ${T.sep}`, fontSize: 13, color: T.text }}>
            <span style={{ color: T.text3, fontSize: 11, marginRight: 6 }}>Driver</span>
            <span style={{ fontWeight: 600 }}>{load.driver_name}</span>
          </div>
        )}

        {/* Status buttons */}
        <div style={{ padding: '18px 20px', flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Update Status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {STATUS_FLOW.map(({ key, label, desc }) => {
              const isCurrent = load.status === key
              const sc = STATUS[key] || STATUS.pending
              const isSaving = saving === key
              return (
                <button
                  key={key}
                  onClick={() => handleStatus(key)}
                  disabled={!!saving}
                  style={{
                    padding: '12px 16px', borderRadius: 10, cursor: isSaving ? 'wait' : 'pointer',
                    border: `2px solid ${isCurrent ? sc.color : T.sep}`,
                    background: isCurrent ? sc.color + '18' : T.bg2,
                    display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                    opacity: saving && !isSaving ? 0.5 : 1, transition: 'all 0.12s',
                  }}
                >
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: isCurrent ? sc.color : T.sep,
                    boxShadow: isCurrent ? `0 0 0 3px ${sc.color}30` : 'none',
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isCurrent ? sc.color : T.text }}>
                      {label} {isCurrent && '✓'} {isSaving && '…'}
                    </div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{desc}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
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
  const [drawerLoad, setDrawerLoad] = useState(null)
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
            borderRadius: 8, cursor: 'pointer', fontSize: 14, color: T.text, fontWeight: 600,
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

      {/* Load table */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: T.text3, background: T.bg1, borderRadius: 12, border: `1px solid ${T.sep}` }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No loads in this view</div>
        </div>
      ) : (
        <div style={{ border: `1px solid ${T.sep}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead>
                <tr style={{ background: T.bg2, borderBottom: `2px solid ${T.sep}` }}>
                  {['Load #', 'Driver / Carrier', 'Ship Date', 'Del Date', 'Origin', 'Destination', 'Status', ''].map((h, i) => (
                    <th key={i} style={{
                      padding: i === 0 ? '8px 10px 8px 14px' : '8px 10px',
                      fontSize: 10, fontWeight: 700, color: T.text3,
                      textTransform: 'uppercase', letterSpacing: 0.7,
                      textAlign: 'left', whiteSpace: 'nowrap',
                      borderLeft: i === 0 ? '3px solid transparent' : undefined,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(l => (
                  <LoadRow
                    key={l.id}
                    load={l}
                    onStatusUpdate={fetchLoads}
                    onEdit={(load) => { setEditLoad(load); setShowForm(true) }}
                    onStatusDrawer={setDrawerLoad}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <LoadForm
          load={editLoad}
          onClose={() => { setShowForm(false); setEditLoad(null) }}
          onSave={() => { fetchLoads(); setShowForm(false); setEditLoad(null) }}
        />
      )}

      <StatusDrawer
        load={drawerLoad}
        onClose={() => setDrawerLoad(null)}
        onSaved={fetchLoads}
      />
    </div>
  )
}
