import React, { useEffect, useState, lazy, Suspense } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const FleetMap = lazy(() => import('../components/FleetMap.jsx'))

function fmt$(n) { return '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) }
function fmtMi(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' mi' }
function pct(a, b) { if (!b) return null; return Math.round(((a - b) / b) * 100) }

function isLate(load) {
  const now = new Date()
  const pickupPassed = load.pickup_date && new Date(load.pickup_date + 'T06:00') < now
  const notPickedUp = ['open','covered','pending','assigned'].includes(load.status)
  const delivPassed = load.delivery_date && new Date(load.delivery_date + 'T00:00') < now
  const notDelivered = !['delivered', 'completed'].includes(load.status)
  return (pickupPassed && notPickedUp) || (delivPassed && notDelivered)
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, color, trend, onClick }) {
  const [hov, setHov] = useState(false)
  const trendUp = trend > 0, trendDown = trend < 0
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov && onClick ? T.bg2 : T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14,
        padding: '18px 20px', flex: 1, minWidth: 0, cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '14px 14px 0 0' }} />
      <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color, letterSpacing: -1.5, lineHeight: 1 }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {trend !== null && trend !== undefined && (
          <span style={{ fontSize: 11, fontWeight: 700, color: trendUp ? T.green : trendDown ? T.red : T.text3 }}>
            {trendUp ? '▲' : trendDown ? '▼' : '–'} {Math.abs(trend)}% vs last month
          </span>
        )}
        {sub && !trend && <span style={{ fontSize: 11, color: T.text3 }}>{sub}</span>}
      </div>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function BarRow({ label, value, total, color }) {
  const p = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: T.text2, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color: T.text3 }}>{value} / {total}</span>
      </div>
      <div style={{ height: 5, background: T.bg3, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${p}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

// ── Load list row ─────────────────────────────────────────────────────────────
function LoadRow({ load, late }) {
  const navigate = useNavigate()
  const [hov, setHov] = useState(false)
  const s = STATUS[load.status] || STATUS.pending
  const color = late ? T.red : s.color
  return (
    <div onClick={() => navigate(`/loads/${load.id}`)}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9,
        cursor: 'pointer', background: hov ? T.bg2 : 'transparent',
        borderLeft: `2px solid ${color}`, marginBottom: 2 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>
            {load.broker_order || load.load_number || `#${load.id}`}
          </span>
          {load.broker_name && <span style={{ fontSize: 11, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{load.broker_name}</span>}
        </div>
        <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
          {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ')} → {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ')}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color, fontWeight: 600 }}>{late ? 'Late' : s.label}</div>
        <div style={{ fontSize: 10, color: load.driver_name ? T.text3 : T.orange }}>
          {load.driver_name || 'Unassigned'}
        </div>
      </div>
    </div>
  )
}

// ── Weekly revenue bars ───────────────────────────────────────────────────────
function WeeklyBars({ weeks, canRevenue }) {
  if (!weeks || weeks.length === 0) return <div style={{ fontSize: 12, color: T.text3 }}>No data yet.</div>
  const key = canRevenue ? 'revenue' : 'loads'
  const max = Math.max(...weeks.map(w => w[key] || 0), 1)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 80, marginTop: 12 }}>
      {weeks.slice(-8).map((w, i) => {
        const val = w[key] || 0
        const h = Math.max(4, Math.round((val / max) * 68))
        const label = w.week?.slice(-3) || `W${i + 1}`
        return (
          <div key={w.week || i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 9, color: T.text3, letterSpacing: 0.2 }}>
              {canRevenue ? (val >= 1000 ? `$${Math.round(val / 1000)}k` : `$${Math.round(val)}`) : val}
            </span>
            <div style={{ width: '100%', height: h, background: T.blue, borderRadius: '3px 3px 0 0', opacity: 0.8 }} />
            <span style={{ fontSize: 9, color: T.text3 }}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function Card({ children, style }) {
  return <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, padding: '16px 18px', ...style }}>{children}</div>
}
function SH({ title, action, to }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.9 }}>{title}</div>
      {action && <Link to={to} style={{ fontSize: 12, color: T.blue, textDecoration: 'none', fontWeight: 600 }}>{action}</Link>}
    </div>
  )
}

function getCount(arr, s) { return arr?.find(x => x.status === s)?.count || 0 }
function sumCount(arr) { return arr?.reduce((s, x) => s + x.count, 0) || 0 }

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [stats, setStats] = useState(null)
  const [dash, setDash] = useState(null)
  const [loads, setLoads] = useState([])
  const [now, setNow] = useState(new Date())

  // company_owner always sees revenue; admin dispatcher always sees revenue;
  // scoped dispatcher only if can_see_revenue flag is set
  const canRevenue = user.role === 'company_owner'
    || (user.role === 'dispatcher' && !user.company_id)
    || !!user.can_see_revenue

  function fetchAll() {
    api.stats().then(setStats)
    api.dashboardStats().then(setDash)
    api.loads().then(setLoads)
  }

  useEffect(() => {
    fetchAll()
    const poll = setInterval(fetchAll, 15000)
    const clock = setInterval(() => setNow(new Date()), 30000)
    return () => { clearInterval(poll); clearInterval(clock) }
  }, [])

  const activeLoads = loads.filter(l => ['open','covered','dispatched','loading','on_route','unloading','in_yard'].includes(l.status))
  const lateLoads   = loads.filter(isLate)
  const inTransit   = loads.filter(l => l.status === 'on_route')
  const todayStr    = now.toISOString().slice(0, 10)

  const urgentUnassigned = loads.filter(l => {
    if (!l.pickup_date || l.driver_id) return false
    if (['dispatched','loading','on_route','unloading','in_yard','delivered','completed'].includes(l.status)) return false
    const hrs = (new Date(l.pickup_date + 'T' + (l.pickup_time?.match(/(\d+:\d+)/)?.[1] || '06:00')) - now) / 36e5
    return hrs >= 0 && hrs <= 24
  })

  const delivToday = loads.filter(l => l.delivery_date === todayStr && !['completed'].includes(l.status) && l.driver_name)
  const tom = new Date(now); tom.setDate(now.getDate() + 1)
  const delivTomorrow = loads.filter(l => l.delivery_date === tom.toISOString().slice(0,10) && !['completed'].includes(l.status) && l.driver_name)

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const driverTotal = sumCount(stats?.drivers)
  const truckTotal  = sumCount(stats?.trucks)

  const revTrend  = pct(dash?.thisMonth?.revenue, dash?.lastMonth?.revenue)
  const loadTrend = pct(dash?.thisMonth?.loads, dash?.lastMonth?.loads)
  const miTrend   = pct(dash?.thisMonth?.miles, dash?.lastMonth?.miles)

  return (
    <div>
      {/* Header */}
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

      {/* Urgent alert */}
      {urgentUnassigned.length > 0 && (
        <div style={{ background: T.bg1, border: `1px solid ${T.red}55`, borderLeft: `4px solid ${T.red}`, borderRadius: 12, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>🚨</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.red }}>
              {urgentUnassigned.length} load{urgentUnassigned.length > 1 ? 's' : ''} picking up in &lt;24h — no driver assigned
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {urgentUnassigned.map(l => (
              <div key={l.id} onClick={() => navigate(`/loads/${l.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '7px 10px', borderRadius: 8, background: T.bg2, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: T.text, minWidth: 80 }}>{l.load_number || `#${l.id}`}</span>
                <span style={{ color: T.text2, flex: 1 }}>{l.broker_name}</span>
                <span style={{ color: T.text3 }}>{[l.pickup_city, l.pickup_state].filter(Boolean).join(', ')} → {[l.delivery_city, l.delivery_state].filter(Boolean).join(', ')}</span>
                <span style={{ color: T.red, fontWeight: 600, whiteSpace: 'nowrap' }}>{l.pickup_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI row — this month */}
      {dash && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: mobile ? 'wrap' : 'nowrap' }}>
          <KPI label="Active Loads"      value={activeLoads.length}                color={T.blue}   sub={`${inTransit.length} in transit`}           onClick={() => navigate('/loads')} />
          <KPI label="Loads This Month"  value={dash.thisMonth?.loads ?? '—'}       color={T.teal}   trend={loadTrend} />
          {canRevenue && (
            <KPI label="Revenue This Month" value={fmt$(dash.thisMonth?.revenue)}    color={T.green}  trend={revTrend} />
          )}
          {canRevenue && (
            <KPI label="Miles This Month"   value={fmtMi(dash.thisMonth?.miles)}    color={T.purple} trend={miTrend} />
          )}
          {lateLoads.length > 0 && (
            <KPI label="Late" value={lateLoads.length} color={T.red} sub="need attention" onClick={() => navigate('/loads')} />
          )}
        </div>
      )}

      {/* Fleet Map */}
      {!mobile && loads.filter(l => ['dispatched','loading','on_route','unloading','in_yard'].includes(l.status)).length > 0 && (
        <Card style={{ marginBottom: 14, padding: '14px 16px' }}>
          <SH title={`Fleet Map — ${loads.filter(l => ['dispatched','loading','on_route','unloading','in_yard'].includes(l.status)).length} active trucks`} action="Full board →" to="/loads" />
          <Suspense fallback={<div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text3, fontSize: 13 }}>Loading map…</div>}>
            <FleetMap loads={loads} />
          </Suspense>
        </Card>
      )}

      {/* To-Do strip */}
      {dash && (dash.needsDriver > 0 || dash.toInvoice?.count > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {dash.needsDriver > 0 && (
            <div onClick={() => navigate('/loads')} style={{ cursor: 'pointer', background: T.orange + '15', border: `1px solid ${T.orange}40`, borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>⚠</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.orange }}>{dash.needsDriver} load{dash.needsDriver > 1 ? 's' : ''} need a driver</div>
                <div style={{ fontSize: 11, color: T.text3 }}>Picking up in next 14 days</div>
              </div>
            </div>
          )}
          {dash.toInvoice?.count > 0 && (
            <div onClick={() => navigate('/loads')} style={{ cursor: 'pointer', background: T.green + '12', border: `1px solid ${T.green}40`, borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>📋</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>
                  {dash.toInvoice.count} load{dash.toInvoice.count > 1 ? 's' : ''} ready to invoice
                  {canRevenue && dash.toInvoice.total > 0 && ` · ${fmt$(dash.toInvoice.total)}`}
                </div>
                <div style={{ fontSize: 11, color: T.text3 }}>Status: Delivered — mark as Completed</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main body */}
      <div style={{ display: 'flex', gap: 16, flexDirection: mobile ? 'column' : 'row', alignItems: 'flex-start' }}>

        {/* Left: active loads + deliveries */}
        <div style={{ flex: 2, minWidth: 0 }}>
          <Card style={{ marginBottom: 14 }}>
            <SH title={`Active Loads (${activeLoads.length})`} action="View all →" to="/loads" />
            {activeLoads.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: T.text3, fontSize: 13 }}>
                No active loads · <Link to="/loads" style={{ color: T.blue, textDecoration: 'none' }}>add one</Link>
              </div>
            ) : (
              <div>
                {lateLoads.slice(0, 5).map(l => <LoadRow key={l.id + 'late'} load={l} late />)}
                {activeLoads.filter(l => !isLate(l)).slice(0, mobile ? 6 : 14).map(l => <LoadRow key={l.id} load={l} />)}
                {activeLoads.length > (mobile ? 6 : 14) + lateLoads.length && (
                  <div style={{ textAlign: 'center', paddingTop: 8 }}>
                    <Link to="/loads" style={{ fontSize: 12, color: T.blue, textDecoration: 'none' }}>
                      + {activeLoads.length - (mobile ? 6 : 14)} more
                    </Link>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Deliveries today / tomorrow */}
          {(delivToday.length > 0 || delivTomorrow.length > 0) && (
            <Card style={{ marginBottom: 14 }}>
              <SH title="Deliveries" />
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

          {/* Upcoming pickups this week */}
          {dash?.upcoming?.length > 0 && (
            <Card>
              <SH title="Upcoming This Week" action="Full board →" to="/loads" />
              {dash.upcoming.map(l => (
                <div key={l.id} onClick={() => navigate(`/loads/${l.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2 }}
                  onMouseEnter={e => e.currentTarget.style.background = T.bg2}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: T.text3, fontWeight: 600, textTransform: 'uppercase' }}>
                      {new Date(l.pickup_date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                      {new Date(l.pickup_date + 'T12:00').getDate()}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{l.broker_order || l.load_number || `#${l.id}`}</div>
                    <div style={{ fontSize: 11, color: T.text2 }}>
                      {[l.pickup_city, l.pickup_state].filter(Boolean).join(', ')} → {[l.delivery_city, l.delivery_state].filter(Boolean).join(', ')}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: l.driver_name ? T.text3 : T.orange, flexShrink: 0 }}>
                    {l.driver_name || 'No driver'}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Right: fleet, load status, revenue trend */}
        <div style={{ flex: 1, minWidth: mobile ? '100%' : 220 }}>

          {/* Fleet */}
          {stats && (
            <Card style={{ marginBottom: 14 }}>
              <SH title="Fleet" />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, marginBottom: 8 }}>Drivers</div>
                <BarRow label="Available" value={getCount(stats.drivers,'available')} total={driverTotal} color={T.green} />
                <BarRow label="On Load"   value={getCount(stats.drivers,'on_load')}   total={driverTotal} color={T.blue} />
                <BarRow label="Off Duty"  value={getCount(stats.drivers,'off_duty')}  total={driverTotal} color={T.text3} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, marginBottom: 8 }}>Trucks</div>
                <BarRow label="Available"   value={getCount(stats.trucks,'available')}   total={truckTotal} color={T.green} />
                <BarRow label="On Load"     value={getCount(stats.trucks,'on_load')}     total={truckTotal} color={T.blue} />
                <BarRow label="Maintenance" value={getCount(stats.trucks,'maintenance')} total={truckTotal} color={T.red} />
              </div>
            </Card>
          )}

          {/* Load status breakdown */}
          {stats && (
            <Card style={{ marginBottom: 14 }}>
              <SH title="Load Pipeline" />
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

          {/* Weekly trend — revenue if can see, load count otherwise */}
          {dash?.weeklyTrend?.length > 0 && (
            <Card>
              <SH title={canRevenue ? 'Weekly Revenue' : 'Weekly Loads'} />
              {canRevenue && dash.thisMonth?.revenue > 0 && (
                <div style={{ fontSize: 22, fontWeight: 700, color: T.green, letterSpacing: -1, lineHeight: 1 }}>
                  {fmt$(dash.thisMonth.revenue)}
                </div>
              )}
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                {dash.thisMonth?.loads ?? 0} loads · {fmtMi(dash.thisMonth?.miles)} this month
              </div>
              <WeeklyBars weeks={dash.weeklyTrend} canRevenue={canRevenue} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
