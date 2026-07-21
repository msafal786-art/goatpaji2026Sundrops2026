import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS, carrierColor, ACTIVE_CARRIERS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import LoadForm from '../components/LoadForm.jsx'
import BulkRateCons from '../components/BulkRateCons.jsx'
import DocInbox from '../components/DocInbox.jsx'

// Final drop for a load. Multi-drop loads keep drop 1 in delivery_* and the
// remaining drops in extra_stops (JSON array, in order). The board shows where
// the truck ends up — the LAST drop — so the date, time and city all have to
// come from that same stop, or a row reads "drop 1's time, last drop's city".
function finalDest(load) {
  let stops = []
  try { stops = load?.extra_stops ? JSON.parse(load.extra_stops) : [] } catch { stops = [] }
  if (!Array.isArray(stops)) stops = []
  // Ignore trailing stops with no location — a blank row shouldn't become "the destination".
  const filled = stops.filter(s => s && (s.city || s.state || s.name))
  const last = filled.length ? filled[filled.length - 1] : null
  const city  = last?.city  || load?.delivery_city
  const state = last?.state || load?.delivery_state
  return {
    city, state,
    date: last?.date || load?.delivery_date,
    time: last?.time || load?.delivery_time,
    text: [city, state].filter(Boolean).join(', '),
    extraCount: filled.length,
  }
}

function useDensity() {
  const [density, setDensity] = useState(() => localStorage.getItem('density') || 'comfortable')
  useEffect(() => {
    const fn = () => setDensity(localStorage.getItem('density') || 'comfortable')
    window.addEventListener('densitychange', fn)
    return () => window.removeEventListener('densitychange', fn)
  }, [])
  return density
}

// US state → IANA timezone (default to ET for unknown/empty)
const STATE_TZ = {
  // Eastern
  CT:'America/New_York', DE:'America/New_York', FL:'America/New_York',
  GA:'America/New_York', IN:'America/New_York', ME:'America/New_York',
  MD:'America/New_York', MA:'America/New_York', MI:'America/New_York',
  NH:'America/New_York', NJ:'America/New_York', NY:'America/New_York',
  NC:'America/New_York', OH:'America/New_York', PA:'America/New_York',
  RI:'America/New_York', SC:'America/New_York', VT:'America/New_York',
  VA:'America/New_York', WV:'America/New_York', DC:'America/New_York',
  // Central
  AL:'America/Chicago', AR:'America/Chicago', IL:'America/Chicago',
  IA:'America/Chicago', KS:'America/Chicago', KY:'America/Chicago',
  LA:'America/Chicago', MN:'America/Chicago', MS:'America/Chicago',
  MO:'America/Chicago', NE:'America/Chicago', ND:'America/Chicago',
  OK:'America/Chicago', SD:'America/Chicago', TN:'America/Chicago',
  TX:'America/Chicago', WI:'America/Chicago',
  // Mountain
  CO:'America/Denver', ID:'America/Denver', MT:'America/Denver',
  NM:'America/Denver', UT:'America/Denver', WY:'America/Denver',
  AZ:'America/Phoenix',
  // Pacific
  CA:'America/Los_Angeles', NV:'America/Los_Angeles',
  OR:'America/Los_Angeles', WA:'America/Los_Angeles',
  // Other
  AK:'America/Anchorage', HI:'Pacific/Honolulu',
}

function stateToTZ(state) {
  return STATE_TZ[(state || '').toUpperCase().trim()] || 'America/New_York'
}

// Parse a date+time as a specific IANA timezone wall-clock and return a UTC Date.
// Uses Intl to correctly handle DST for any timezone.
function parseInTZ(dateStr, h24 = 0, min = 0, tz = 'America/New_York') {
  if (!dateStr) return null
  const y = parseInt(dateStr.slice(0, 4))
  const mo = parseInt(dateStr.slice(5, 7)) - 1
  const d = parseInt(dateStr.slice(8, 10))
  // Probe noon UTC to get the TZ offset at that date (handles DST correctly)
  const probeUTC = new Date(Date.UTC(y, mo, d, 12, 0, 0))
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(probeUTC)
  const get = type => parseInt(parts.find(p => p.type === type)?.value || 0)
  const offsetMs = probeUTC - new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')))
  return new Date(Date.UTC(y, mo, d, h24, min) + offsetMs)
}

// Parse "8:00 AM" / "14:30" style strings into [hours24, minutes]
function parseHM(timeStr) {
  if (!timeStr) return [0, 0]
  const m = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM)?/i)
  if (!m) return [0, 0]
  let h = parseInt(m[1]), min = parseInt(m[2])
  if (m[3]?.toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0
  return [h, min]
}

// Deadline for a delivery window: the last time in the string ("08:00 AM - 02:00 PM" → 2 PM).
// No parseable time means due by end of day.
function parseDeliveryHM(timeStr) {
  const matches = [...(timeStr || '').matchAll(/(\d+):(\d+)\s*(AM|PM)?/gi)]
  if (!matches.length) return [23, 59]
  const m = matches[matches.length - 1]
  let h = parseInt(m[1]), min = parseInt(m[2])
  if (m[3]?.toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0
  return [h, min]
}

// Late means one thing: the delivery window has passed and the load still
// hasn't delivered. A missed *pickup* is a different, lesser problem — it has
// its own "Pickup window passed" banner (see pickupAlertNeeded) and must not
// paint the row red, or half the board reads as an emergency.
//
// Uses the final drop for multi-stop loads, so a load isn't called late on
// drop 1's date while it still has stops to make.
function isLate(load) {
  if (['delivered', 'completed'].includes(load.status)) return false
  const dest = finalDest(load)
  const date = (dest.date || '').slice(0, 10)
  if (!date) return false
  const [dh, dm] = parseDeliveryHM(dest.time)
  return parseInTZ(date, dh, dm, stateToTZ(dest.state)) < new Date()
}

// Urgency color: overrides status color for unassigned/near-pickup loads
function urgencyColor(load) {
  const s = STATUS[load.status] || STATUS.open
  if (isLate(load)) return T.red
  if (['on_route','in_transit'].includes(load.status)) return T.green
  if (['loading','unloading','in_yard'].includes(load.status)) return '#ff6b35'
  if (['dispatched'].includes(load.status)) return T.orange
  if (['delivered'].includes(load.status)) return T.teal
  if (['completed'].includes(load.status)) return T.text3

  // Open/covered: check proximity to pickup in pickup city's timezone
  if (load.pickup_date) {
    const now = new Date()
    const pickup = parseInTZ(load.pickup_date, 6, 0, stateToTZ(load.pickup_state))
    const hoursUntil = (pickup - now) / 36e5
    if (!load.driver_id && hoursUntil <= 24 && hoursUntil >= 0) return T.red
    if (!load.driver_id) return 'rgba(235,235,245,0.22)'
    if (hoursUntil <= 24) return T.orange
  }
  return s.color
}

function pickupAlertNeeded(load) {
  if (!load.pickup_date) return false
  const [ph, pm] = parseHM(load.pickup_time)
  return parseInTZ(load.pickup_date, ph, pm, stateToTZ(load.pickup_state)) < new Date()
    && ['open','covered','dispatched','pending','assigned'].includes(load.status)
}

function LoadRow({ load, onStatusUpdate, onEdit, onStatusDrawer, user, compact, justBuilt }) {
  const navigate = useNavigate()
  const late = isLate(load)
  const alert = pickupAlertNeeded(load)
  const s = STATUS[load.status] || STATUS.open
  const accentColor = urgencyColor(load)
  const compColor = carrierColor(load.company_name)
  const shortCompany = load.company_name
    ? load.company_name.replace(' INC','').replace(' LLC','').replace('THE FRONTLINE FREIGHT','FRONTLINE').replace(' BROS','')
    : null
  const pad = compact ? '5px 8px 5px 12px' : '8px 10px 8px 14px'
  const padCell = compact ? '5px 8px' : '8px 10px'

  async function handleStatusClick(e, status) {
    e.stopPropagation()
    await api.updateLoadStatus(load.id, status)
    onStatusUpdate()
  }

  async function handleInvoice(e) {
    e.stopPropagation()
    if (!confirm(`Mark load ${load.broker_order || load.load_number || '#'+load.id} as invoiced and complete?`)) return
    await api.updateLoadStatus(load.id, 'completed')
    onStatusUpdate()
  }

  const pickupCity = [load.pickup_city, load.pickup_state].filter(Boolean).join(', ')
  const dest       = finalDest(load)
  const delivCity  = dest.text

  const rowBg = justBuilt
    ? (T.isDark ? 'rgba(48,209,88,0.13)' : 'rgba(48,209,88,0.10)')
    : late
    ? (T.isDark ? 'rgba(255,69,58,0.09)' : 'rgba(255,59,48,0.07)')
    : ['on_route','in_transit'].includes(load.status)
      ? (T.isDark ? 'rgba(48,209,88,0.07)' : 'rgba(48,209,88,0.06)')
      : ['loading','unloading','in_yard'].includes(load.status)
        ? (T.isDark ? 'rgba(255,107,53,0.07)' : 'rgba(255,107,53,0.05)')
        : load.status === 'dispatched'
          ? (T.isDark ? 'rgba(191,90,242,0.07)' : 'rgba(191,90,242,0.05)')
          : 'transparent'

  return (
    <>
      <tr
        onClick={() => navigate(`/loads/${load.id}`)}
        style={{ borderBottom: `1px solid ${T.sep}`, background: rowBg, cursor: 'pointer', transition: 'background 0.1s' }}
        onMouseEnter={e => e.currentTarget.style.background = T.bg2}
        onMouseLeave={e => e.currentTarget.style.background = rowBg}
      >
        {/* Load # — our number big, broker order small */}
        <td style={{ padding: pad, whiteSpace: 'nowrap', borderLeft: `3px solid ${accentColor}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: late ? T.red : T.text, letterSpacing: -0.2 }}>
            {late && <span style={{ color: T.red, marginRight: 3 }}>!</span>}
            {load.load_number || `#${load.id}`}
            {justBuilt && (
              <span style={{
                marginLeft: 5, fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5,
                color: T.green, background: T.green + '22', padding: '1px 5px', borderRadius: 4,
                verticalAlign: 'middle',
              }}>NEW</span>
            )}
          </div>
          {!compact && (
            <div style={{ fontSize: 10, color: T.text3, marginTop: 2, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {load.broker_order ? `Order: ${load.broker_order}` : ''}{load.broker_name ? (load.broker_order ? ' · ' : '') + load.broker_name : ''}
            </div>
          )}
        </td>

        {/* Driver / Carrier */}
        <td style={{ padding: padCell, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: load.driver_name ? T.text : T.orange }}>
            {load.driver_name || '— Unassigned —'}
          </div>
          {!compact && shortCompany && (
            <div style={{ fontSize: 10, fontWeight: 700, color: compColor, marginTop: 2 }}>{shortCompany}</div>
          )}
          {!compact && load.trailer_number && (
            <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>Trailer: {load.trailer_number}</div>
          )}
          {!compact && load.checkin_time && !load.checkout_time && (
            <div style={{ fontSize: 10, color: T.green, fontWeight: 700, marginTop: 2 }}>● Checked In</div>
          )}
          {!compact && load.checkout_time && (
            <div style={{ fontSize: 10, color: T.teal, fontWeight: 700, marginTop: 2 }}>✓ Checked Out</div>
          )}
        </td>

        {/* Broker */}
        <td style={{ padding: padCell, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, color: T.text }}>{load.broker_name || '—'}</div>
        </td>

        {/* Ship Date */}
        <td style={{ padding: padCell, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, color: T.text }}>{load.pickup_date || '—'}</div>
          {!compact && load.pickup_time && <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>{load.pickup_time}</div>}
        </td>

        {/* Del Date — final drop, matching the Destination column */}
        <td style={{ padding: padCell, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, color: T.text }}>{dest.date || '—'}</div>
          {!compact && dest.time && <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>{dest.time}</div>}
        </td>

        {/* Origin */}
        <td style={{ padding: padCell, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{pickupCity || load.pickup_name || '—'}</div>
        </td>

        {/* Destination — final drop for multi-stop loads */}
        <td style={{ padding: padCell, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{delivCity || load.delivery_name || '—'}</div>
          {dest.extraCount > 0 && (
            <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>
              {dest.extraCount + 1} stops · final drop
            </div>
          )}
        </td>

        {/* Status badge */}
        <td style={{ padding: padCell, whiteSpace: 'nowrap' }}>
          <span style={{
            display: 'inline-block', fontSize: 10, fontWeight: 700,
            padding: '3px 8px', borderRadius: 5,
            background: accentColor + '22', color: accentColor,
            border: `1px solid ${accentColor}50`,
          }}>
            {late && <span style={{ marginRight: 3 }}>!</span>}{s.label.toUpperCase()}{load.dispatch_sent ? ' ✓' : ''}
          </span>
        </td>

        {/* Actions */}
        <td style={{ padding: compact ? '5px 10px 5px 4px' : '8px 14px 8px 6px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 5 }}>
            <button
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                background: T.blue, border: 'none', color: '#fff',
              }}
              onClick={() => onStatusDrawer(load)}
            >Status</button>
            {load.status === 'delivered'
              ? <button style={solidBtn(T.green)} onClick={handleInvoice}>Invoice</button>
              : <button style={ghostBtn()} onClick={() => onEdit(load)}>Edit</button>
            }
          </div>
        </td>
      </tr>

      {/* Alert bar — must be a <tr> to be valid inside <tbody> */}
      {alert && (
        <tr style={{ background: T.isDark ? 'rgba(255,159,10,0.06)' : 'rgba(255,159,10,0.05)' }}>
          <td colSpan={9} onClick={e => e.stopPropagation()} style={{ padding: '6px 14px 8px 17px', borderBottom: `1px solid ${T.sep}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.orange }}>Pickup window passed</span>
              {user?.role !== 'driver' && <>
                <button style={alertBtn('#ff6b35')} onClick={e => handleStatusClick(e, 'loading')}>Loading</button>
                <button style={alertBtn(T.green)}   onClick={e => handleStatusClick(e, 'on_route')}>On Route</button>
              </>}
              <button style={alertBtn(T.orange)} onClick={e => { e.stopPropagation(); navigate(`/loads/${load.id}`) }}>Detention</button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function solidBtn(color) {
  return {
    fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
    background: color, border: 'none', color: '#fff',
  }
}

function ghostBtn() {
  return {
    fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
    background: 'transparent', border: `1px solid ${T.sep}`, color: T.text2,
  }
}

const STATUS_FLOW = [
  { key: 'open',       label: 'Open',       desc: 'Load posted, not yet covered' },
  { key: 'covered',    label: 'Covered',    desc: 'Driver assigned, not dispatched' },
  { key: 'dispatched', label: 'Dispatched', desc: 'Driver en route to pickup' },
  { key: 'loading',    label: 'Loading',    desc: 'At pickup facility, loading' },
  { key: 'on_route',   label: 'On Route',   desc: 'Loaded and driving to delivery' },
  { key: 'unloading',  label: 'Unloading',  desc: 'At delivery facility' },
  { key: 'in_yard',    label: 'In Yard',    desc: 'In delivery yard' },
  { key: 'delivered',  label: 'Delivered',  desc: 'Load delivered successfully' },
  { key: 'completed',  label: 'Completed',  desc: 'Invoiced & done' },
]

// Statuses where drivers must supply extra check-in/out info
const DRIVER_EXTRA_STATUSES = ['dispatched', 'on_route', 'unloading', 'delivered']
const DRIVER_ALLOWED_STATUSES = ['dispatched','loading','on_route','unloading','in_yard','delivered']

const DRIVER_MODAL_CONFIG = {
  dispatched: {
    title: 'Pickup Check-In',
    subtitle: 'Confirm arrival at pickup facility',
    fields: ['checkin_time', 'trailer_number', 'checkin_notes'],
  },
  on_route: {
    title: 'Loaded & Departing',
    subtitle: 'Confirm you have loaded and are leaving pickup',
    fields: ['checkout_time', 'bol_sent'],
  },
  unloading: {
    title: 'Arrived at Delivery',
    subtitle: 'Confirm arrival at delivery facility',
    fields: ['delivery_checkin_time'],
  },
  delivered: {
    title: 'Delivery Complete',
    subtitle: 'Confirm the delivery is done',
    fields: ['delivery_checkout_time', 'delivery_bol_sent'],
  },
}

function DriverStatusModal({ load, targetStatus, onClose, onSaved }) {
  const now = new Date()
  const timeNow = now.toTimeString().slice(0, 5)
  const [form, setForm] = useState({
    checkin_time: timeNow,
    trailer_number: load.trailer_number || '',
    checkin_notes: '',
    checkout_time: timeNow,
    bol_sent: false,
    delivery_checkin_time: timeNow,
    delivery_checkout_time: timeNow,
    delivery_bol_sent: false,
  })
  const [saving, setSaving] = useState(false)
  const cfg = DRIVER_MODAL_CONFIG[targetStatus]
  if (!cfg) return null

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    const extra = {}
    cfg.fields.forEach(f => { extra[f] = form[f] })
    await api.updateLoadStatus(load.id, targetStatus, extra)
    setSaving(false)
    onSaved()
    onClose()
  }

  const inp = { width: '100%', padding: '11px 13px', border: `1px solid ${T.sep}`, borderRadius: 10, fontSize: 15, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' }
  const lbl = { fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 6 }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1200 }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: T.bg1, borderRadius: '20px 20px 0 0', padding: '24px 24px 44px', zIndex: 1201, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: T.sep, margin: '0 auto 20px' }} />
        <div style={{ fontSize: 19, fontWeight: 700, color: T.text, marginBottom: 4 }}>{cfg.title}</div>
        <div style={{ fontSize: 13, color: T.text3, marginBottom: 22 }}>{cfg.subtitle}</div>
        <form onSubmit={handleSubmit}>
          {cfg.fields.includes('checkin_time') && (
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Check-In Time</label>
              <input type="time" value={form.checkin_time} onChange={e => setF('checkin_time', e.target.value)} style={inp} />
            </div>
          )}
          {cfg.fields.includes('trailer_number') && (
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Trailer Number</label>
              <input type="text" value={form.trailer_number} onChange={e => setF('trailer_number', e.target.value)} placeholder="e.g. T-12345" style={inp} />
            </div>
          )}
          {cfg.fields.includes('checkin_notes') && (
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Notes (optional)</label>
              <textarea value={form.checkin_notes} onChange={e => setF('checkin_notes', e.target.value)} placeholder="Any notes about this pickup…" rows={3}
                style={{ ...inp, resize: 'none', fontSize: 13 }} />
            </div>
          )}
          {cfg.fields.includes('checkout_time') && (
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Check-Out Time</label>
              <input type="time" value={form.checkout_time} onChange={e => setF('checkout_time', e.target.value)} style={inp} />
            </div>
          )}
          {cfg.fields.includes('bol_sent') && (
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14, background: T.bg2, padding: '14px 16px', borderRadius: 12, border: `1px solid ${T.sep}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>BOL sent to company group?</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Confirm Bill of Lading was shared</div>
              </div>
              <button type="button" onClick={() => setF('bol_sent', !form.bol_sent)}
                style={{ width: 48, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', background: form.bol_sent ? T.green : T.bg3, position: 'relative', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: form.bol_sent ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 0.18s' }} />
              </button>
            </div>
          )}
          {cfg.fields.includes('delivery_checkin_time') && (
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Arrival Time at Delivery</label>
              <input type="time" value={form.delivery_checkin_time} onChange={e => setF('delivery_checkin_time', e.target.value)} style={inp} />
            </div>
          )}
          {cfg.fields.includes('delivery_checkout_time') && (
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Check-Out Time at Delivery</label>
              <input type="time" value={form.delivery_checkout_time} onChange={e => setF('delivery_checkout_time', e.target.value)} style={inp} />
            </div>
          )}
          {cfg.fields.includes('delivery_bol_sent') && (
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14, background: T.bg2, padding: '14px 16px', borderRadius: 12, border: `1px solid ${T.sep}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>POD / BOL sent to company group?</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Confirm proof of delivery was shared</div>
              </div>
              <button type="button" onClick={() => setF('delivery_bol_sent', !form.delivery_bol_sent)}
                style={{ width: 48, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', background: form.delivery_bol_sent ? T.green : T.bg3, position: 'relative', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: form.delivery_bol_sent ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 0.18s' }} />
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: 14, background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 12, cursor: 'pointer', fontWeight: 600, fontSize: 15 }}>Cancel</button>
            <button type="submit" disabled={saving}
              style={{ flex: 2, padding: 14, background: T.blue, color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
              {saving ? 'Updating…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

function StatusDrawer({ load, onClose, onSaved, user, onDriverExtra }) {
  const [saving, setSaving] = useState(null)
  if (!load) return null

  const isDriver = user?.role === 'driver'
  const visibleStatuses = isDriver
    ? STATUS_FLOW.filter(s => DRIVER_ALLOWED_STATUSES.includes(s.key))
    : STATUS_FLOW

  const pickupCity = [load.pickup_city, load.pickup_state].filter(Boolean).join(', ')
  const dest       = finalDest(load)
  const delivCity  = dest.text

  async function handleStatus(key) {
    if (key === load.status) { onClose(); return }
    // Driver selecting a status that needs extra info → hand off to DriverStatusModal
    if (isDriver && DRIVER_EXTRA_STATUSES.includes(key)) {
      onClose()
      onDriverExtra(key)
      return
    }
    setSaving(key)
    await api.updateLoadStatus(load.id, key)
    setSaving(null)
    onSaved()
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 340, maxWidth: '95vw',
        background: T.bg1, borderLeft: `1px solid ${T.sep}`, zIndex: 1101,
        display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${T.sep}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>{load.load_number || `#${load.id}`}</div>
            <div style={{ fontSize: 12, color: T.text3, marginTop: 3 }}>{load.broker_name || '—'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: T.text3, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

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
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{dest.date}</div>
          </div>
        </div>

        {load.driver_name && (
          <div style={{ padding: '10px 20px', borderBottom: `1px solid ${T.sep}`, fontSize: 13, color: T.text }}>
            <span style={{ color: T.text3, fontSize: 11, marginRight: 6 }}>Driver</span>
            <span style={{ fontWeight: 600 }}>{load.driver_name}</span>
          </div>
        )}

        <div style={{ padding: '18px 20px', flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Update Status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleStatuses.map(({ key, label, desc }) => {
              const isCurrent = load.status === key
              const sc = STATUS[key] || STATUS.open
              const isSaving = saving === key
              const needsExtra = isDriver && DRIVER_EXTRA_STATUSES.includes(key)
              return (
                <button key={key} onClick={() => handleStatus(key)} disabled={!!saving}
                  style={{
                    padding: '12px 16px', borderRadius: 10, cursor: isSaving ? 'wait' : 'pointer',
                    border: `2px solid ${isCurrent ? sc.color : T.sep}`,
                    background: isCurrent ? sc.color + '18' : T.bg2,
                    display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                    opacity: saving && !isSaving ? 0.5 : 1, transition: 'all 0.12s',
                  }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: isCurrent ? sc.color : T.sep, boxShadow: isCurrent ? `0 0 0 3px ${sc.color}30` : 'none' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isCurrent ? sc.color : T.text }}>
                      {label} {isCurrent && '✓'} {isSaving && '…'}
                    </div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>
                      {desc}{needsExtra ? ' — will ask for details' : ''}
                    </div>
                  </div>
                  {needsExtra && <span style={{ fontSize: 10, color: T.blue, fontWeight: 700 }}>›</span>}
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
    fontSize: 11, padding: '4px 11px', borderRadius: 6, cursor: 'pointer',
    background: color + '20', border: `1px solid ${color}50`, color,
    fontWeight: 700,
  }
}

const STATUS_TABS = [
  { key: 'active',     label: 'Active' },
  { key: 'late',       label: 'Late' },
  { key: 'open',       label: 'Open' },
  { key: 'covered',    label: 'Covered' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'on_route',   label: 'On Route' },
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
  const density = useDensity()
  const compact = density === 'compact'
  const [loads, setLoads] = useState([])
  const [companies, setCompanies] = useState([])
  const [companyFilter, setCompanyFilter] = useState('')
  const [activeTab, setActiveTab] = useState('active')
  const [sortField, setSortField] = useState('pickup')
  const [sortDir, setSortDir] = useState('asc')
  const [showForm, setShowForm] = useState(false)
  const [showBulkRC, setShowBulkRC] = useState(false)
  const [showDocInbox, setShowDocInbox] = useState(false)
  const [justBuiltIds, setJustBuiltIds] = useState([])   // newest first — pinned to top of the board
  const [justBuilt, setJustBuilt] = useState(null)       // the load to offer dispatch for
  const [dispatchMsg, setDispatchMsg] = useState('')
  const [copied, setCopied] = useState(false)

  // A load was just created — pin it and offer to copy its dispatch right away.
  function handleCreated(saved) {
    if (!saved?.id) return
    setJustBuiltIds(ids => [saved.id, ...ids.filter(i => i !== saved.id)])
    setJustBuilt(saved)
    setDispatchMsg('')
    setCopied(false)
  }

  async function copyDispatch() {
    if (!justBuilt) return
    try {
      let msg = dispatchMsg
      if (!msg) {
        const res = await api.dispatchMessage(justBuilt.id)
        msg = res.message
        setDispatchMsg(msg)
      }
      await navigator.clipboard.writeText(msg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (or no driver on the load) — show the text to copy by hand
      if (!dispatchMsg) {
        try { setDispatchMsg((await api.dispatchMessage(justBuilt.id)).message) } catch {}
      }
    }
  }
  const [editLoad, setEditLoad] = useState(null)
  const [drawerLoad, setDrawerLoad] = useState(null)
  const [driverModal, setDriverModal] = useState(null) // { load, targetStatus }
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [query, setQuery] = useState('')

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

  const ACTIVE_STATUSES = ['open','covered','dispatched','loading','on_route','unloading','in_yard']

  const q = query.trim().toLowerCase()
  const matchesQuery = (l) => !q || [
    l.load_number, l.broker_order, l.broker_name, l.driver_name, l.company_name,
    l.pickup_city, l.pickup_state, l.delivery_city, l.delivery_state,
    l.pickup_name, l.delivery_name, l.commodity,
  ].some(v => (v || '').toLowerCase().includes(q))

  const filtered = loads.filter(l => {
    if (!matchesQuery(l)) return false
    if (activeTab === 'all') return true
    if (activeTab === 'active') return ACTIVE_STATUSES.includes(l.status)
    if (activeTab === 'late') return isLate(l)
    if (activeTab === 'invoice') return l.status === 'delivered'
    return l.status === activeTab
  })

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const sorted = [...filtered].sort((a, b) => {
    // Loads created in this session pin to the top (newest first) so a load you
    // just built is right there to dispatch, whatever the current sort is.
    const aNew = justBuiltIds.indexOf(a.id)
    const bNew = justBuiltIds.indexOf(b.id)
    if (aNew !== -1 || bNew !== -1) {
      if (aNew === -1) return 1
      if (bNew === -1) return -1
      return aNew - bNew
    }
    let va, vb
    if (sortField === 'pickup')   { va = a.pickup_date || '9999';   vb = b.pickup_date || '9999' }
    else if (sortField === 'delivery') { va = finalDest(a).date || '9999'; vb = finalDest(b).date || '9999' }
    else if (sortField === 'load')     { va = a.load_number || a.broker_order || ''; vb = b.load_number || b.broker_order || '' }
    else if (sortField === 'driver')   { va = (a.driver_name || '').toLowerCase(); vb = (b.driver_name || '').toLowerCase() }
    else if (sortField === 'broker')   { va = (a.broker_name || '').toLowerCase(); vb = (b.broker_name || '').toLowerCase() }
    else if (sortField === 'origin')   { va = a.pickup_city || ''; vb = b.pickup_city || '' }
    else if (sortField === 'dest')     { va = finalDest(a).city || ''; vb = finalDest(b).city || '' }
    else if (sortField === 'status')   { va = a.status || ''; vb = b.status || '' }
    else { va = a.pickup_date || '9999'; vb = b.pickup_date || '9999' }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const searched = loads.filter(matchesQuery)
  const countTab = (key) => {
    if (key === 'all') return searched.length
    if (key === 'active') return searched.filter(l => ACTIVE_STATUSES.includes(l.status)).length
    if (key === 'late') return searched.filter(isLate).length
    if (key === 'invoice') return searched.filter(l => l.status === 'delivered').length
    return searched.filter(l => l.status === key).length
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: T.text3, pointerEvents: 'none' }}>⌕</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={mobile ? 'Search' : 'Search load #, driver, broker, city…'}
              style={{
                width: mobile ? 110 : 230, padding: '8px 10px 8px 28px',
                background: T.bg2, border: `1px solid ${query ? T.blue : T.sep}`,
                borderRadius: 8, fontSize: 12, color: T.text, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {query && (
              <button onClick={() => setQuery('')} style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: T.text3, fontSize: 13, padding: 2,
              }}>×</button>
            )}
          </div>
          <button onClick={fetchLoads} style={{
            padding: mobile ? '7px 10px' : '8px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
            borderRadius: 8, cursor: 'pointer', fontSize: 14, color: T.text, fontWeight: 600,
          }}>↻</button>
          <button onClick={() => setShowDocInbox(true)} title="Drop BOLs and PODs — they're matched to their load automatically" style={{
            padding: mobile ? '7px 10px' : '8px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
            borderRadius: 8, cursor: 'pointer', fontSize: mobile ? 12 : 13, color: T.text, fontWeight: 600,
          }}>{mobile ? 'Docs' : 'Drop BOLs'}</button>
          <button onClick={() => setShowBulkRC(true)} title="Add several rate cons at once" style={{
            padding: mobile ? '7px 10px' : '8px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
            borderRadius: 8, cursor: 'pointer', fontSize: mobile ? 12 : 13, color: T.text, fontWeight: 600,
          }}>{mobile ? 'Bulk RC' : 'Bulk rate cons'}</button>
          <button onClick={() => { setEditLoad(null); setShowForm(true) }} style={{
            padding: mobile ? '7px 12px' : '8px 16px', background: T.blue, border: 'none',
            borderRadius: 8, cursor: 'pointer', fontSize: mobile ? 12 : 13, color: '#fff', fontWeight: 600,
          }}>+ Add Load</button>
        </div>
      </div>

      {/* Just-built load — dispatch it without hunting for it on the board */}
      {justBuilt && (
        <div style={{
          background: T.green + '14', border: `1px solid ${T.green}55`, borderRadius: 10,
          padding: '10px 14px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>
            Load #{justBuilt.load_number || justBuilt.broker_order || justBuilt.id} added
            {justBuilt.driver_name
              ? <span style={{ fontWeight: 400, color: T.text2 }}> · {justBuilt.driver_name}</span>
              : <span style={{ fontWeight: 400, color: T.orange }}> · no driver assigned yet</span>}
          </span>
          <div style={{ display: 'flex', gap: 7, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button onClick={copyDispatch} style={{
              padding: '6px 13px', background: copied ? T.green : T.blue, border: 'none',
              borderRadius: 7, cursor: 'pointer', fontSize: 12.5, color: '#fff', fontWeight: 600,
            }}>{copied ? '✓ Copied' : 'Copy dispatch'}</button>
            <button onClick={() => navigate(`/loads/${justBuilt.id}`)} style={{
              padding: '6px 13px', background: T.bg2, border: `1px solid ${T.sep}`,
              borderRadius: 7, cursor: 'pointer', fontSize: 12.5, color: T.text, fontWeight: 600,
            }}>Open load</button>
            <button onClick={() => { setJustBuilt(null); setDispatchMsg('') }} title="Dismiss" style={{
              padding: '6px 10px', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 16, color: T.text3, lineHeight: 1,
            }}>×</button>
          </div>
          {dispatchMsg && !copied && (
            <textarea
              readOnly
              value={dispatchMsg}
              onFocus={e => e.target.select()}
              style={{
                width: '100%', height: 130, marginTop: 4, padding: '8px 10px',
                border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 11.5,
                background: T.bg1, color: T.text, fontFamily: 'inherit', resize: 'vertical',
              }}
            />
          )}
        </div>
      )}

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

      {/* Status tabs + density toggle */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 3, flex: 1, overflowX: 'auto', paddingBottom: 2 }}>
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
        {/* Density toggle */}
        <div style={{ display: 'flex', border: `1px solid ${T.sep}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0, marginLeft: 6 }}>
          {['comfortable', 'compact'].map(d => (
            <button key={d} onClick={() => {
              localStorage.setItem('density', d)
              window.dispatchEvent(new Event('densitychange'))
            }} style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: density === d ? T.blue + '22' : 'transparent',
              color: density === d ? T.blue : T.text3,
              textTransform: 'capitalize',
            }}>{d === 'comfortable' ? 'Comfortable' : 'Compact'}</button>
          ))}
        </div>
      </div>

      {/* Load table */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: T.text3, background: T.bg1, borderRadius: 12, border: `1px solid ${T.sep}` }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {q ? `No loads match "${query.trim()}"` : 'No loads in this view'}
          </div>
          {q && (
            <button onClick={() => setQuery('')} style={{
              marginTop: 12, padding: '7px 16px', background: T.bg2, border: `1px solid ${T.sep}`,
              borderRadius: 8, cursor: 'pointer', color: T.text2, fontSize: 12, fontWeight: 600,
            }}>Clear search</button>
          )}
        </div>
      ) : (
        <div style={{ border: `1px solid ${T.sep}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead>
                <tr style={{ background: T.bg2, borderBottom: `2px solid ${T.sep}` }}>
                  {[
                    { label: 'Load #',          field: 'load',     first: true },
                    { label: 'Driver / Carrier', field: 'driver' },
                    { label: 'Broker',           field: 'broker' },
                    { label: 'Ship Date',        field: 'pickup' },
                    { label: 'Del Date',         field: 'delivery' },
                    { label: 'Origin',           field: 'origin' },
                    { label: 'Destination',      field: 'dest' },
                    { label: 'Status',           field: 'status' },
                    { label: '',                 field: null },
                  ].map(({ label, field, first }, i) => {
                    const active = field && sortField === field
                    return (
                      <th key={i} onClick={field ? () => toggleSort(field) : undefined} style={{
                        padding: first ? '8px 10px 8px 14px' : '8px 10px',
                        fontSize: 10, fontWeight: 700, color: active ? T.text : T.text3,
                        textTransform: 'uppercase', letterSpacing: 0.7,
                        textAlign: 'left', whiteSpace: 'nowrap',
                        borderLeft: first ? '3px solid transparent' : undefined,
                        cursor: field ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}>
                        {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(l => (
                  <LoadRow
                    key={l.id}
                    load={l}
                    user={user}
                    compact={compact}
                    justBuilt={justBuiltIds.includes(l.id)}
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
          onSave={(saved) => {
            const wasNew = !editLoad
            fetchLoads()
            setShowForm(false)
            setEditLoad(null)
            if (wasNew) handleCreated(saved)
          }}
        />
      )}

      {showBulkRC && (
        <BulkRateCons
          onClose={() => setShowBulkRC(false)}
          onDone={(created) => {
            fetchLoads()
            if (Array.isArray(created) && created.length) {
              setJustBuiltIds(ids => [...created.map(l => l.id), ...ids.filter(i => !created.some(c => c.id === i))])
            }
          }}
        />
      )}

      {showDocInbox && (
        <DocInbox
          onClose={() => setShowDocInbox(false)}
          onDone={fetchLoads}
        />
      )}

      <StatusDrawer
        load={drawerLoad}
        user={user}
        onClose={() => setDrawerLoad(null)}
        onSaved={fetchLoads}
        onDriverExtra={(targetStatus) => setDriverModal({ load: drawerLoad, targetStatus })}
      />

      {driverModal && (
        <DriverStatusModal
          load={driverModal.load}
          targetStatus={driverModal.targetStatus}
          onClose={() => setDriverModal(null)}
          onSaved={() => { setDriverModal(null); fetchLoads() }}
        />
      )}
    </div>
  )
}
