import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS, carrierColor } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

// ── helpers ───────────────────────────────────────────────────────────────────
function dateStr(d) { return d.toISOString().slice(0, 10) }
function fmt$(n) { return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) }
function getCount(arr, s) { return arr?.find(x => x.status === s)?.count || 0 }
function sumCount(arr) { return arr?.reduce((s, x) => s + x.count, 0) || 0 }

function isLate(load) {
  const now = new Date()
  const pickupPassed = load.pickup_date && new Date(load.pickup_date + 'T06:00') < now
  const notPickedUp = ['pending', 'assigned'].includes(load.status)
  const deliveryPassed = load.delivery_date && new Date(load.delivery_date + 'T00:00') < now
  const notDelivered = !['delivered', 'completed'].includes(load.status)
  return (pickupPassed && notPickedUp) || (deliveryPassed && notDelivered)
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function KPI({ label, value, color, sub, onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov && onClick ? T.bg2 : T.bg1,
        border: `1px solid ${T.sep}`,
        borderRadius: 14,
        padding: '18px 20px',
        flex: 1,
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: color, borderRadius: '14px 14px 0 0',
      }} />
      <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color, letterSpacing: -1.5, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ── Progress bar row ──────────────────────────────────────────────────────────
function BarRow({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: T.text2, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color: T.text3 }}>{value} / {total}</span>
      </div>
      <div style={{ height: 5, background: T.bg3, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

// ── Compact load row ──────────────────────────────────────────────────────────
function LoadRow({ load }) {
  const navigate = useNavigate()
  const [hov, setHov] = useState(false)
  const s = STATUS[load.status] || STATUS.pending
  const late = isLate(load)
  const dotColor = late ? T.red : s.color

  return (
    <div
      onClick={() => navigate(`/loads/${load.id}`)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderRadius: 9, cursor: 'pointer',
        background: hov ? T.bg2 : 'transparent',
        borderLeft: `2px solid ${dotColor}`,
        marginBottom: 2,
        transition: 'background 0.1s',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>
            {load.load_number || `#${load.id}`}
          </span>
          {load.broker_name && (
            <span style={{ fontSize: 11, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {load.broker_name}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
          {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ')}
          {' → '}
          {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ')}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: dotColor, fontWeight: 600 }}>
          {late ? 'Late' : s.label}
        </div>
        <div style={{ fontSize: 10, color: T.text3 }}>
          {load.driver_name || <span style={{ color: T.orange }}>Unassigned</span>}
        </div>
      </div>
    </div>
  )
}

// ── Revenue bar chart ─────────────────────────────────────────────────────────
function RevenueChart({ byMonth }) {
  const entries = Object.entries(byMonth).sort()
  if (entries.length === 0) return null
  const max = Math.max(...entries.map(([, v]) => v))
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 60, marginTop: 8 }}>
      {entries.map(([mo, amt]) => {
        const h = max > 0 ? Math.max(4, Math.round((amt / max) * 52)) : 4
        const label = new Date(mo + '-02').toLocaleString('default', { month: 'short' })
        return (
          <div key={mo} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: T.text3, letterSpacing: 0.3 }}>
              {fmt$(amt)}
            </span>
            <div style={{ width: '100%', height: h, background: T.blue, borderRadius: 3, opacity: 0.85 }} />
            <span style={{ fontSize: 9, color: T.text3 }}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({ title, action, actionTo }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.9 }}>
        {title}
      </div>
      {action && (
        <Link to={actionTo} style={{ fontSize: 12, color: T.blue, textDecoration: 'none', fontWeight: 600 }}>
          {action}
        </Link>
      )}
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: T.bg1, border: `1px solid ${T.sep}`,
      borderRadius: 14, padding: '16px 18px', ...style,
    }}>
      {children}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [stats, setStats] = useState(null)
  const [loads, setLoads] = useState([])
  const [revenue, setRevenue] = useState(null)
  const [now, setNow] = useState(new Date())

  function fetchAll() {
    api.stats().then(setStats)
    api.loads().then(data => {
      setLoads(data)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 60)
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      const recent = data.filter(l => l.delivery_date >= cutoffStr && l.rate)
      const totalRev = recent.reduce((s, l) => s + Number(l.rate || 0), 0)
      const byMonth = {}
      for (const l of recent) {
        const mo = l.delivery_date?.slice(0, 7)
        if (mo) byMonth[mo] = (byMonth[mo] || 0) + Number(l.rate || 0)
      }
      setRevenue({ total: totalRev, byMonth, count: recent.length })
    })
  }

  useEffect(() => {
    fetchAll()
    const poll = setInterval(fetchAll, 15000)
    const clock = setInterval(() => setNow(new Date()), 30000)
    return () => { clearInterval(poll); clearInterval(clock) }
  }, [])

  // Derived data
  const activeLoads = loads.filter(l => ['pending','assigned','dispatched','in_transit'].includes(l.status))
  const lateLoads = loads.filter(isLate)
  const inTransit = loads.filter(l => l.status === 'in_transit')
  const toInvoice = loads.filter(l => l.status === 'delivered')

  const urgentUnassigned = loads.filter(l => {
    if (!l.pickup_date) return false
    if (['dispatched','in_transit','delivered','completed'].includes(l.status)) return false
    if (l.driver_id) return false
    const pickup = new Date(l.pickup_date + 'T' + (l.pickup_time?.match(/(\d+:\d+)/)?.[1] || '06:00'))
    const hrs = (pickup - now) / 36e5
    return hrs >= 0 && hrs <= 24
  })

  const driverTotal = sumCount(stats?.drivers)
  const truckTotal = sumCount(stats?.trucks)
  const todayStr = dateStr(now)

  // Who's delivering today / tomorrow
  const delivToday = loads.filter(l => l.delivery_date === todayStr && !['completed'].includes(l.status) && l.driver_name)
  const delivTomorrow = loads.filter(l => {
    const tom = new Date(now); tom.setDate(now.getDate() + 1)
    return l.delivery_date === dateStr(tom) && !['completed'].includes(l.status) && l.driver_name
  })

  const greeting = (() => {
    const h = now.getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div>

      {/* ── Header ── */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 700, color: T.text, letterSpacing: -0.6, lineHeight: 1.1 }}>
            {greeting}, {user.full_name?.split(' ')[0] || user.username}
          </h1>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>{dateLabel}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.green, display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: T.text3 }}>Live · 15s sync</span>
        </div>
      </div>

      {/* ── Urgent alert ── */}
      {urgentUnassigned.length > 0 && (
        <div style={{
          background: T.bg1, border: `1px solid ${T.red}55`,
          borderLeft: `4px solid ${T.red}`,
          borderRadius: 12, padding: '12px 16px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>🚨</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.red }}>
              {urgentUnassigned.length} load{urgentUnassigned.length > 1 ? 's' : ''} picking up in &lt;24h — no driver assigned
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {urgentUnassigned.map(l => (
              <div key={l.id}
                onClick={() => navigate(`/loads/${l.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  padding: '7px 10px', borderRadius: 8, background: T.bg2,
                  fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 700, color: T.text, minWidth: 80 }}>{l.load_number || `#${l.id}`}</span>
                <span style={{ color: T.text2, flex: 1 }}>{l.broker_name}</span>
                <span style={{ color: T.text3 }}>{[l.pickup_city, l.pickup_state].filter(Boolean).join(', ')} → {[l.delivery_city, l.delivery_state].filter(Boolean).join(', ')}</span>
                <span style={{ color: T.red, fontWeight: 600, whiteSpace: 'nowrap' }}>{l.pickup_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KPI row ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: mobile ? 'wrap' : 'nowrap' }}>
        <KPI
          label="Active Loads"
          value={activeLoads.length}
          color={T.blue}
          sub={`${toInvoice.length} to invoice`}
          onClick={() => navigate('/loads')}
        />
        <KPI
          label="In Transit"
          value={inTransit.length}
          color={T.green}
          sub="on the road"
          onClick={() => navigate('/loads')}
        />
        {lateLoads.length > 0 && (
          <KPI
            label="Late"
            value={lateLoads.length}
            color={T.red}
            sub="need attention"
            onClick={() => navigate('/loads')}
          />
        )}
        {revenue && (
          <KPI
            label="Revenue (60d)"
            value={fmt$(revenue.total)}
            color={T.green}
            sub={`${revenue.count} loads`}
          />
        )}
      </div>

      {/* ── Main body: 2 columns on desktop ── */}
      <div style={{ display: 'flex', gap: 16, flexDirection: mobile ? 'column' : 'row', alignItems: 'flex-start' }}>

        {/* ── Left column: loads ── */}
        <div style={{ flex: 2, minWidth: 0 }}>

          {/* Active loads */}
          <Card style={{ marginBottom: 14 }}>
            <SectionHead title={`Active Loads (${activeLoads.length})`} action="View all →" actionTo="/loads" />
            {activeLoads.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: T.text3, fontSize: 13 }}>
                No active loads · <Link to="/loads" style={{ color: T.blue, textDecoration: 'none' }}>add one</Link>
              </div>
            ) : (
              <div>
                {/* Late first */}
                {lateLoads.slice(0, 5).map(l => <LoadRow key={l.id + 'l'} load={l} />)}
                {/* Then rest of active, skip duplicates */}
                {activeLoads
                  .filter(l => !isLate(l))
                  .slice(0, mobile ? 6 : 12)
                  .map(l => <LoadRow key={l.id} load={l} />)
                }
                {activeLoads.length > (mobile ? 6 : 12) + lateLoads.length && (
                  <div style={{ textAlign: 'center', paddingTop: 8 }}>
                    <Link to="/loads" style={{ fontSize: 12, color: T.blue, textDecoration: 'none' }}>
                      + {activeLoads.length - (mobile ? 6 : 12)} more
                    </Link>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Delivering today / tomorrow */}
          {(delivToday.length > 0 || delivTomorrow.length > 0) && (
            <Card style={{ marginBottom: 14 }}>
              <SectionHead title="Deliveries" />
              {delivToday.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 }}>Today</div>
                  {delivToday.map(l => <LoadRow key={l.id} load={l} />)}
                </>
              )}
              {delivTomorrow.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 10, marginBottom: 6 }}>Tomorrow</div>
                  {delivTomorrow.map(l => <LoadRow key={l.id} load={l} />)}
                </>
              )}
            </Card>
          )}
        </div>

        {/* ── Right column: fleet + revenue ── */}
        <div style={{ flex: 1, minWidth: mobile ? '100%' : 220 }}>

          {/* Fleet status */}
          {stats && (
            <Card style={{ marginBottom: 14 }}>
              <SectionHead title="Fleet" />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, marginBottom: 8 }}>Drivers</div>
                <BarRow label="Available" value={getCount(stats.drivers,'available')} total={driverTotal} color={T.green} />
                <BarRow label="On Load"   value={getCount(stats.drivers,'on_load')}   total={driverTotal} color={T.blue} />
                <BarRow label="Off Duty"  value={getCount(stats.drivers,'off_duty')}  total={driverTotal} color={T.text3} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, marginBottom: 8 }}>Trucks</div>
                <BarRow label="Available"    value={getCount(stats.trucks,'available')}    total={truckTotal} color={T.green} />
                <BarRow label="On Load"      value={getCount(stats.trucks,'on_load')}      total={truckTotal} color={T.blue} />
                <BarRow label="Maintenance"  value={getCount(stats.trucks,'maintenance')}  total={truckTotal} color={T.red} />
              </div>
            </Card>
          )}

          {/* Load status breakdown */}
          {stats && (
            <Card style={{ marginBottom: 14 }}>
              <SectionHead title="Load Status" />
              {[
                { label: 'Pending',    key: 'pending',    color: T.orange },
                { label: 'Assigned',   key: 'assigned',   color: T.blue },
                { label: 'Dispatched', key: 'dispatched', color: T.purple },
                { label: 'In Transit', key: 'in_transit', color: T.green },
                { label: 'Delivered',  key: 'delivered',  color: T.teal },
              ].map(({ label, key, color }) => {
                const n = getCount(stats.loads, key)
                return (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.sep}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                      <span style={{ fontSize: 13, color: T.text2 }}>{label}</span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: n > 0 ? color : T.text3 }}>{n}</span>
                  </div>
                )
              })}
            </Card>
          )}

          {/* Revenue chart */}
          {revenue && revenue.total > 0 && (
            <Card>
              <SectionHead title="Revenue — 60 days" />
              <div style={{ fontSize: 26, fontWeight: 700, color: T.green, letterSpacing: -1, lineHeight: 1 }}>
                {fmt$(revenue.total)}
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>{revenue.count} loads delivered</div>
              <RevenueChart byMonth={revenue.byMonth} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
