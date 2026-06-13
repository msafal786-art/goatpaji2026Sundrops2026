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
  const late = isLate(load)
  const alert = pickupAlertNeeded(load)
  const s = STATUS[load.status] || STATUS.pending
  const statusColor = late ? T.red : s.color
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

  if (mobile) {
    return (
      <div style={{
        background: `linear-gradient(135deg, ${statusColor}20 0%, ${statusColor}0d 100%)`,
        border: `1px solid ${statusColor}55`,
        borderRadius: 11, marginBottom: 6, overflow: 'hidden',
        backdropFilter: 'blur(10px)',
      }}>
        <div onClick={() => navigate(`/loads/${load.id}`)} style={{ padding: '11px 13px', cursor: 'pointer' }}>
          {/* Row 1: load# + status badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                {late && <span style={{ color: T.red, marginRight: 3 }}>!</span>}
                {load.load_number || `#${load.id}`}
              </span>
              {load.broker_name && (
                <span style={{ fontSize: 10, color: T.text3, marginLeft: 7 }}>{load.broker_name}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                background: statusColor + '30', color: statusColor,
                textTransform: 'uppercase', letterSpacing: 0.4,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
                {late ? 'Late' : s.label}
                {load.dispatch_sent ? ' ✓' : ''}
              </span>
              {load.status === 'delivered' ? (
                <button onClick={handleInvoice} style={{
                  fontSize: 11, padding: '3px 8px', background: T.green + '22',
                  border: `1px solid ${T.green}60`, borderRadius: 6, cursor: 'pointer', color: T.green, fontWeight: 700,
                }}>Invoice ✓</button>
              ) : (
                <button onClick={e => { e.stopPropagation(); onEdit(load) }} style={{
                  fontSize: 11, padding: '3px 8px', background: 'rgba(255,255,255,0.07)',
                  border: `1px solid ${T.sep}`, borderRadius: 6, cursor: 'pointer', color: T.text2, fontWeight: 600,
                }}>Edit</button>
              )}
            </div>
          </div>
          {/* Row 2: driver + company */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: load.driver_name ? T.text : T.orange }}>
              {load.driver_name || '— Assign Driver —'}
            </span>
            {shortCompany && (
              <span style={{ fontSize: 10, background: compColor + '22', color: compColor, padding: '2px 7px', borderRadius: 8, fontWeight: 700 }}>
                {shortCompany}
              </span>
            )}
          </div>
          {/* Row 3: truck info */}
          {(load.tractor_number || load.truck_trailer) && (
            <div style={{ fontSize: 10, color: T.text3, marginBottom: 7 }}>
              {load.tractor_number && `Truck ${load.tractor_number}`}{load.tractor_number && load.truck_trailer && ' · '}{load.truck_trailer && `Trailer ${load.truck_trailer}`}
            </div>
          )}
          {/* Row 4: route */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: T.blue, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1 }}>Pickup</div>
              <div style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>{pickupCity || load.pickup_name}</div>
              <div style={{ fontSize: 10, color: T.blue }}>{load.pickup_date}{load.pickup_time && ` · ${load.pickup_time}`}</div>
            </div>
            <div style={{ color: T.text3, fontSize: 14, flexShrink: 0 }}>→</div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: T.purple, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1 }}>Delivery</div>
              <div style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>{delivCity || load.delivery_name}</div>
              <div style={{ fontSize: 10, color: T.purple }}>{load.delivery_date}{load.delivery_time && ` · ${load.delivery_time}`}</div>
            </div>
          </div>
        </div>
        {alert && (
          <div style={{ background: T.orange + '18', borderTop: `1px solid ${T.orange}40`, padding: '8px 13px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.orange, marginBottom: 6 }}>Pickup window passed</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={alertBtn(T.green)} onClick={e => handleStatusClick(e, 'in_transit')}>Picked Up</button>
              <button style={alertBtn(T.blue)} onClick={e => handleStatusClick(e, 'dispatched')}>Loaded</button>
              <button style={alertBtn(T.orange)} onClick={e => { e.stopPropagation(); navigate(`/loads/${load.id}`) }}>Detention</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{
      background: `linear-gradient(135deg, ${statusColor}20 0%, ${statusColor}0d 100%)`,
      border: `1px solid ${statusColor}55`,
      borderRadius: 11,
      marginBottom: 5,
      overflow: 'hidden',
      backdropFilter: 'blur(10px)',
    }}>
      <div
        onClick={() => navigate(`/loads/${load.id}`)}
        style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
      >
        {/* Load # + broker */}
        <div style={{ minWidth: 110, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, letterSpacing: 0.1 }}>
            {late && <span style={{ color: T.red, marginRight: 3 }}>!</span>}
            {load.load_number || `#${load.id}`}
          </div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {load.broker_name}
          </div>
        </div>

        {/* Driver + truck */}
        <div style={{ minWidth: 110, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Driver</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: load.driver_name ? T.text : T.orange, marginTop: 2 }}>
            {load.driver_name || '— Assign —'}
          </div>
          {(load.tractor_number || load.truck_trailer) && (
            <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>
              {load.tractor_number && `T:${load.tractor_number}`}{load.tractor_number && load.truck_trailer && ' / '}{load.truck_trailer && `Tr:${load.truck_trailer}`}
            </div>
          )}
        </div>

        {/* Pickup */}
        <div style={{ minWidth: 140, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: T.blue, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Pickup</div>
          <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginTop: 2 }}>{load.pickup_name}</div>
          <div style={{ fontSize: 10, color: T.text2 }}>{pickupCity}</div>
          <div style={{ fontSize: 10, color: T.blue }}>{load.pickup_date}{load.pickup_time && ` · ${load.pickup_time}`}</div>
        </div>

        <div style={{ color: T.text3, fontSize: 14, flexShrink: 0 }}>→</div>

        {/* Delivery */}
        <div style={{ minWidth: 140, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: T.purple, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Delivery</div>
          <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginTop: 2 }}>{load.delivery_name}</div>
          <div style={{ fontSize: 10, color: T.text2 }}>{delivCity}</div>
          <div style={{ fontSize: 10, color: T.purple }}>{load.delivery_date}{load.delivery_time && ` · ${load.delivery_time}`}</div>
        </div>

        {/* Commodity / Company */}
        <div style={{ minWidth: 80, flexShrink: 0 }}>
          {load.commodity && <div style={{ fontSize: 10, color: T.text2 }}>{load.commodity}</div>}
          {load.miles && <div style={{ fontSize: 10, color: T.text3 }}>{load.miles} mi</div>}
          {load.company_name && (
            <span style={{
              fontSize: 10, background: compColor + '22', color: compColor,
              padding: '2px 7px', borderRadius: 8, fontWeight: 700,
              display: 'inline-block', marginTop: 2, whiteSpace: 'nowrap',
            }}>
              {shortCompany}
            </span>
          )}
        </div>

        {/* Status + Edit/Invoice */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
            background: statusColor + '30', color: statusColor,
            textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            {late ? 'Late' : s.label}
            {load.dispatch_sent ? ' ✓' : ''}
          </span>
          {load.status === 'delivered' ? (
            <button onClick={handleInvoice} style={{
              fontSize: 11, padding: '4px 10px', background: T.green + '22',
              border: `1px solid ${T.green}60`, borderRadius: 6, cursor: 'pointer', color: T.green, fontWeight: 700,
            }}>Invoice ✓</button>
          ) : (
            <button onClick={e => { e.stopPropagation(); onEdit(load) }} style={{
              fontSize: 11, padding: '4px 10px', background: 'rgba(255,255,255,0.07)',
              border: `1px solid ${T.sep}`, borderRadius: 6, cursor: 'pointer', color: T.text2, fontWeight: 600,
            }}>Edit</button>
          )}
        </div>
      </div>

      {/* Alert bar */}
      {alert && (
        <div style={{
          background: T.orange + '18', borderTop: `1px solid ${T.orange}40`,
          padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.orange }}>
            Pickup window passed — update needed
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={alertBtn(T.green)} onClick={e => handleStatusClick(e, 'in_transit')}>Picked Up — En Route</button>
            <button style={alertBtn(T.blue)} onClick={e => handleStatusClick(e, 'dispatched')}>Loaded — Waiting</button>
            <button style={alertBtn(T.orange)} onClick={e => { e.stopPropagation(); navigate(`/loads/${load.id}`) }}>Detention — View Load</button>
          </div>
        </div>
      )}
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
    const interval = setInterval(fetchLoads, 60000)
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
          <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>
            {loads.length} loads · {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
