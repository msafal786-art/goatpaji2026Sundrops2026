import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'
import { T, STATUS, carrierColor } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

// ── Pie / Donut chart ─────────────────────────────────────────────────────────
const PIE_PALETTE = [
  '#0a84ff','#30d158','#bf5af2','#ff9f0a','#ff453a',
  '#5ac8f5','#ffd60a','#5e5ce6','#ff6b6b','#4ecdc4',
]

function PieChart({ data, title, subtitle }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ background: T.bg1, borderRadius: 16, padding: '20px', border: `1px solid ${T.sep}`, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 11, color: T.text3, marginBottom: 16 }}>{subtitle}</div>
        <div style={{ textAlign: 'center', padding: '24px 0', color: T.text3, fontSize: 13 }}>No deliveries</div>
      </div>
    )
  }

  const total = data.reduce((s, d) => s + d.value, 0)
  const size = 140
  const cx = size / 2, cy = size / 2
  const r = 52, innerR = 32

  let angle = -Math.PI / 2
  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    angle += sweep
    const x2 = cx + r * Math.cos(angle)
    const y2 = cy + r * Math.sin(angle)
    const ix1 = cx + innerR * Math.cos(angle)
    const iy1 = cy + innerR * Math.sin(angle)
    const ix2 = cx + innerR * Math.cos(angle - sweep)
    const iy2 = cy + innerR * Math.sin(angle - sweep)
    const large = sweep > Math.PI ? 1 : 0
    const path = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2}`,
      'Z'
    ].join(' ')
    return { ...d, path, color: d.color || PIE_PALETTE[i % PIE_PALETTE.length] }
  })

  return (
    <div style={{ background: T.bg1, borderRadius: 16, padding: '20px', border: `1px solid ${T.sep}`, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, color: T.text3, marginBottom: 16 }}>{subtitle}</div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <svg width={size} height={size} style={{ flexShrink: 0 }}>
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} opacity={0.9} />
          ))}
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            fill={T.text} fontSize="18" fontWeight="700">{total}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
            fill={T.text3} fontSize="9">drivers</text>
        </svg>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: T.text, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span style={{ fontSize: 11, color: T.text3, flexShrink: 0 }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div style={{
      background: T.bg1, borderRadius: 14, padding: '16px 18px',
      border: `1px solid ${T.sep}`, flex: 1, minWidth: 100,
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, letterSpacing: -1 }}>{value}</div>
      <div style={{ fontSize: 12, color: T.text2, marginTop: 5 }}>{label}</div>
    </div>
  )
}

// ── Mini load card ────────────────────────────────────────────────────────────
function MiniLoadCard({ load }) {
  const navigate = useNavigate()
  const s = STATUS[load.status] || STATUS.pending
  const compColor = carrierColor(load.company_name)
  return (
    <div
      onClick={() => navigate(`/loads/${load.id}`)}
      style={{
        background: `linear-gradient(135deg, ${s.color}22 0%, ${s.color}0e 100%)`,
        borderRadius: 12, padding: '12px 14px',
        border: `1px solid ${s.color}55`, cursor: 'pointer',
        transition: 'filter 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.15)'}
      onMouseLeave={e => e.currentTarget.style.filter = 'none'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{load.load_number || `#${load.id}`}</div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{load.broker_name}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {s.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>{load.pickup_city}, {load.pickup_state}</div>
          <div style={{ fontSize: 10, color: T.text3 }}>{load.pickup_date}</div>
        </div>
        <div style={{ color: T.text3, fontSize: 14 }}>→</div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>{load.delivery_city}, {load.delivery_state}</div>
          <div style={{ fontSize: 10, color: T.text3 }}>{load.delivery_date}</div>
        </div>
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${s.color}25`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: load.driver_name ? T.text2 : T.orange }}>
          {load.driver_name || 'Unassigned'}
        </span>
        {load.company_name && (
          <span style={{ fontSize: 10, color: compColor, fontWeight: 700 }}>
            {load.company_name.replace(' INC','').replace(' LLC','').replace('THE FRONTLINE FREIGHT','FRONTLINE').replace(' BROS','')}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function dateStr(d) { return d.toISOString().slice(0, 10) }

function buildDeliveryPie(loads, targetDate) {
  const delivering = loads.filter(l =>
    l.delivery_date === targetDate && !['completed'].includes(l.status) && l.driver_name
  )
  // Group by driver
  const map = {}
  for (const l of delivering) {
    const k = l.driver_name
    map[k] = (map[k] || 0) + 1
  }
  return Object.entries(map).map(([label, value]) => ({ label, value }))
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth()
  const mobile = useIsMobile()
  const [stats, setStats] = useState(null)
  const [loads, setLoads] = useState([])

  useEffect(() => {
    api.stats().then(setStats)
    api.loads().then(setLoads)
  }, [])

  const getCount = (arr, s) => arr?.find(x => x.status === s)?.count || 0
  const total = arr => arr?.reduce((s, x) => s + x.count, 0) || 0

  const activeLoads = loads.filter(l => l.status !== 'completed')
  const recentCompleted = loads.filter(l => l.status === 'completed').slice(0, 4)

  // Delivery planning pie data
  const now = new Date()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const dayAfter = new Date(now); dayAfter.setDate(now.getDate() + 2)
  const todayData = buildDeliveryPie(loads, dateStr(now))
  const tomorrowData = buildDeliveryPie(loads, dateStr(tomorrow))
  const dayAfterData = buildDeliveryPie(loads, dateStr(dayAfter))

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>
          {user.full_name?.split(' ')[0] || 'Dispatcher'}
        </h1>
        <p style={{ color: T.text2, fontSize: 13, marginTop: 4 }}>Here's your operation at a glance.</p>
      </div>

      {stats && (
        <>
          <Label>Load Status</Label>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(3,1fr)' : 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginBottom: 20 }}>
            <StatPill label="Total" value={total(stats.loads)} color={T.text2} />
            <StatPill label="Pending" value={getCount(stats.loads,'pending')} color={T.orange} />
            <StatPill label="Assigned" value={getCount(stats.loads,'assigned')} color={T.blue} />
            <StatPill label="Dispatched" value={getCount(stats.loads,'dispatched')} color={T.purple} />
            <StatPill label="In Transit" value={getCount(stats.loads,'in_transit')} color={T.green} />
            <StatPill label="Delivered" value={getCount(stats.loads,'delivered')} color={T.teal} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Label>Drivers</Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                <StatPill label="Available" value={getCount(stats.drivers,'available')} color={T.green} />
                <StatPill label="On Load" value={getCount(stats.drivers,'on_load')} color={T.blue} />
                <StatPill label="Off Duty" value={getCount(stats.drivers,'off_duty')} color={T.text3} />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Label>Trucks</Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                <StatPill label="Available" value={getCount(stats.trucks,'available')} color={T.green} />
                <StatPill label="On Load" value={getCount(stats.trucks,'on_load')} color={T.blue} />
                <StatPill label="Maint." value={getCount(stats.trucks,'maintenance')} color={T.red} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Route Planning Pies */}
      <Label>Route Planning — Drivers Delivering</Label>
      <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 14, marginBottom: 28 }}>
        <PieChart data={todayData} title="Today" subtitle={dateStr(now)} />
        <PieChart data={tomorrowData} title="Tomorrow" subtitle={dateStr(tomorrow)} />
        <PieChart data={dayAfterData} title="Day After" subtitle={dateStr(dayAfter)} />
      </div>

      {/* Active Loads grid */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Label inline>Active Loads <span style={{ color: T.text3, fontWeight: 400 }}>({activeLoads.length})</span></Label>
        <Link to="/loads" style={{ fontSize: 12, color: T.blue, textDecoration: 'none', fontWeight: 600 }}>View all</Link>
      </div>

      {activeLoads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: T.text3, background: T.bg1, borderRadius: 14, border: `1px solid ${T.sep}` }}>
          No active loads.{' '}
          <Link to="/loads" style={{ color: T.blue, textDecoration: 'none' }}>Add one</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 28 }}>
          {activeLoads.map(l => <MiniLoadCard key={l.id} load={l} />)}
        </div>
      )}

      {recentCompleted.length > 0 && (
        <>
          <Label>Recently Completed</Label>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {recentCompleted.map(l => <MiniLoadCard key={l.id} load={l} />)}
          </div>
        </>
      )}
    </div>
  )
}

function Label({ children, inline }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: inline ? 0 : 10 }}>
      {children}
    </div>
  )
}
