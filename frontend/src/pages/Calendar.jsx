import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { T, STATUS, carrierColor, carrierKey, ACTIVE_CARRIERS } from '../theme.js'
import { useAuth } from '../AuthContext.jsx'

// Statuses worth showing on a planning calendar — completed loads are noise.
const LEGEND_STATUSES = ['open', 'covered', 'dispatched', 'loading', 'on_route', 'unloading', 'in_yard', 'delivered']

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

// The final drop of a multi-stop load — same rule as the load board.
function finalDrop(load) {
  let stops = []
  try { stops = load.extra_stops ? JSON.parse(load.extra_stops) : [] } catch {}
  if (!Array.isArray(stops)) stops = []
  const last = stops.length ? stops[stops.length - 1] : null
  return {
    city: last?.city || load.delivery_city,
    state: last?.state || load.delivery_state,
    date: (last?.date || load.delivery_date || '').slice(0, 10),
  }
}

export default function Calendar() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loads, setLoads] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('week')
  const [carrier, setCarrier] = useState(null)       // company name, null = all
  const [dayOpen, setDayOpen] = useState(null)       // date string for the day panel
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [weekStart, setWeekStart] = useState(() => isoMonday(new Date()))

  useEffect(() => {
    api.loads().then(setLoads).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const isDispatcher = user.role === 'dispatcher'
  const carrierNames = ACTIVE_CARRIERS.filter(name =>
    loads.some(l => carrierKey(l.company_name) === carrierKey(name)))

  const visible = loads.filter(l => {
    if (l.status === 'completed') return false
    if (!carrier) return true
    return carrierKey(l.company_name) === carrierKey(carrier)
  })

  // Each load lands on its pickup day AND its delivery day, so the calendar
  // shows when trucks free up — not just when they load.
  const byDate = {}
  function push(dateStr, entry) {
    if (!dateStr) return
    ;(byDate[dateStr] ||= []).push(entry)
  }
  for (const load of visible) {
    const pu = (load.pickup_date || '').slice(0, 10)
    const drop = finalDrop(load)
    push(pu, { load, kind: 'PU', city: load.pickup_city, state: load.pickup_state })
    if (drop.date && drop.date !== pu) {
      push(drop.date, { load, kind: 'DEL', city: drop.city, state: drop.state })
    }
  }
  for (const key of Object.keys(byDate)) {
    byDate[key].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'PU' ? -1 : 1))
  }

  const today = ymd(new Date())
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  function shiftMonth(delta) {
    setCursor(c => {
      const m = c.month + delta
      if (m < 0) return { year: c.year - 1, month: 11 }
      if (m > 11) return { year: c.year + 1, month: 0 }
      return { ...c, month: m }
    })
  }
  function shiftWeek(delta) {
    setWeekStart(ws => { const d = new Date(ws); d.setDate(d.getDate() + delta * 7); return d })
  }
  function goToday() {
    const now = new Date()
    setCursor({ year: now.getFullYear(), month: now.getMonth() })
    setWeekStart(isoMonday(now))
  }

  // Month grid
  const firstDay = new Date(cursor.year, cursor.month, 1)
  const lastDay = new Date(cursor.year, cursor.month + 1, 0)
  const startPad = firstDay.getDay()
  const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7
  const cells = []
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startPad + 1
    cells.push(dayNum < 1 || dayNum > lastDay.getDate()
      ? null
      : `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`)
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return ymd(d)
  })

  const monthKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const monthPickups = visible.filter(l => (l.pickup_date || '').slice(0, 7) === monthKey).length
  const monthDrops = visible.filter(l => finalDrop(l).date.slice(0, 7) === monthKey).length

  function Entry({ entry, size = 'sm' }) {
    const { load, kind, city, state } = entry
    const st = STATUS[load.status] || { color: T.text3, label: load.status }
    const isDel = kind === 'DEL'
    const unassigned = !load.driver_name
    return (
      <div
        onClick={e => { e.stopPropagation(); navigate(`/loads/${load.id}`) }}
        title={`${load.load_number || load.id} · ${st.label} · ${kind === 'PU' ? 'Pick up' : 'Deliver'} ${[city, state].filter(Boolean).join(', ')}${load.driver_name ? ` · ${load.driver_name}` : ' · no driver'}`}
        style={{
          background: st.color + (isDel ? '14' : '22'),
          borderLeft: `${isDel ? 2 : 3}px ${isDel ? 'dashed' : 'solid'} ${st.color}`,
          borderRadius: 4, padding: size === 'sm' ? '2px 5px' : '6px 8px',
          marginBottom: size === 'sm' ? 2 : 6, cursor: 'pointer',
          fontSize: size === 'sm' ? 10 : 11.5, lineHeight: 1.35,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: size === 'sm' ? 'nowrap' : 'normal',
        }}
      >
        <span style={{
          fontWeight: 800, fontSize: size === 'sm' ? 8 : 9, letterSpacing: 0.4,
          color: st.color, marginRight: 4,
        }}>{kind}</span>
        <span style={{ fontWeight: 700, color: T.text }}>{load.load_number || `#${load.id}`}</span>
        <span style={{ color: T.text2 }}> {[city, state].filter(Boolean).join(', ')}</span>
        {size !== 'sm' && (
          <div style={{ fontSize: 10.5, color: unassigned ? T.orange : T.text3, marginTop: 2 }}>
            {load.driver_name || 'No driver assigned'}
            {load.company_name && <span style={{ color: carrierColor(load.company_name) }}> · {load.company_name}</span>}
          </div>
        )}
      </div>
    )
  }

  const navBtn = { padding: '7px 12px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, cursor: 'pointer', color: T.text2, fontSize: 14 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: -0.4, margin: 0 }}>Calendar</h1>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>
            {monthNames[cursor.month]} {cursor.year} — {monthPickups} pickup{monthPickups !== 1 ? 's' : ''}, {monthDrops} {monthDrops === 1 ? 'delivery' : 'deliveries'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 2, background: T.bg2, borderRadius: 8, padding: 3 }}>
            {['month', 'week'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                background: view === v ? T.bg1 : 'transparent',
                color: view === v ? T.text : T.text3,
              }}>{v}</button>
            ))}
          </div>
          <button onClick={goToday} style={{ ...navBtn, fontSize: 12, fontWeight: 600 }}>Today</button>
          <button onClick={() => view === 'month' ? shiftMonth(-1) : shiftWeek(-1)} style={navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text, minWidth: 150, textAlign: 'center' }}>
            {view === 'month'
              ? `${monthNames[cursor.month]} ${cursor.year}`
              : `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          </span>
          <button onClick={() => view === 'month' ? shiftMonth(1) : shiftWeek(1)} style={navBtn}>›</button>
        </div>
      </div>

      {/* Carrier filter — mirrors the load board chips */}
      {isDispatcher && carrierNames.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={() => setCarrier(null)} style={chip(!carrier, T.blue)}>All</button>
          {carrierNames.map(name => {
            const c = carrierColor(name)
            return (
              <button key={name} onClick={() => setCarrier(carrier === name ? null : name)} style={chip(carrier === name, c)}>
                {carrierLabel(name)}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div style={{ color: T.text3, padding: 20 }}>Loading loads…</div>
      ) : view === 'month' ? (
        <div style={{ background: T.bg1, borderRadius: 14, border: `1px solid ${T.sep}`, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${T.sep}` }}>
            {dayNames.map(d => (
              <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map((dateStr, i) => {
              const entries = dateStr ? (byDate[dateStr] || []) : []
              const isToday = dateStr === today
              const isPast = dateStr && dateStr < today
              const isWeekend = i % 7 === 0 || i % 7 === 6
              const unassigned = entries.filter(e => e.kind === 'PU' && !e.load.driver_name).length
              return (
                <div
                  key={i}
                  onClick={() => dateStr && entries.length > 0 && setDayOpen(dateStr)}
                  style={{
                    minHeight: 92, padding: 6, borderRight: `1px solid ${T.sep}`, borderBottom: `1px solid ${T.sep}`,
                    background: isToday ? T.blue + '0a' : isWeekend && dateStr ? T.bg2 + '60' : 'transparent',
                    opacity: !dateStr ? 0.3 : isPast ? 0.7 : 1,
                    cursor: dateStr && entries.length ? 'pointer' : 'default',
                  }}
                >
                  {dateStr && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{
                          fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? T.blue : T.text2,
                          ...(isToday ? { width: 22, height: 22, background: T.blue, color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 } : {}),
                        }}>
                          {new Date(dateStr + 'T00:00:00').getDate()}
                        </div>
                        {unassigned > 0 && (
                          <span title={`${unassigned} pickup${unassigned > 1 ? 's' : ''} with no driver`} style={{
                            fontSize: 8.5, fontWeight: 800, color: T.orange, background: T.orange + '22',
                            padding: '1px 5px', borderRadius: 4,
                          }}>{unassigned} open</span>
                        )}
                      </div>
                      {entries.slice(0, 3).map((e, k) => <Entry key={k} entry={e} />)}
                      {entries.length > 3 && (
                        <div style={{ fontSize: 9, color: T.blue, fontWeight: 700, marginTop: 1 }}>
                          +{entries.length - 3} more
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div style={{ background: T.bg1, borderRadius: 14, border: `1px solid ${T.sep}`, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${T.sep}` }}>
            {weekDays.map(dateStr => {
              const d = new Date(dateStr + 'T00:00:00')
              const isToday = dateStr === today
              return (
                <div key={dateStr} style={{ padding: '12px 8px', textAlign: 'center', borderRight: `1px solid ${T.sep}`, background: isToday ? T.blue + '0a' : 'transparent' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div style={{ fontSize: isToday ? 18 : 16, fontWeight: isToday ? 800 : 500, color: isToday ? T.blue : T.text }}>{d.getDate()}</div>
                  <div style={{ fontSize: 10, color: T.text3 }}>{d.toLocaleDateString('en-US', { month: 'short' })}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: 200 }}>
            {weekDays.map((dateStr, i) => {
              const entries = byDate[dateStr] || []
              return (
                <div key={dateStr} style={{ padding: 8, borderRight: i < 6 ? `1px solid ${T.sep}` : 'none', minHeight: 170 }}>
                  {entries.map((e, k) => <Entry key={k} entry={e} size="md" />)}
                  {entries.length === 0 && <div style={{ fontSize: 11, color: T.text3, padding: '8px 0' }}>—</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        {LEGEND_STATUSES.map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: STATUS[key].color }} />
            <span style={{ fontSize: 11, color: T.text3 }}>{STATUS[key].label}</span>
          </div>
        ))}
        <span style={{ fontSize: 11, color: T.text3, borderLeft: `1px solid ${T.sep}`, paddingLeft: 14 }}>
          <b style={{ color: T.text2 }}>PU</b> pickup · <b style={{ color: T.text2 }}>DEL</b> delivery (dashed)
        </span>
      </div>

      {/* Day detail panel */}
      {dayOpen && (
        <div onClick={() => setDayOpen(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.bg1, borderRadius: 16, border: `1px solid ${T.sep}`,
            padding: '20px 22px', width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text, margin: 0 }}>
                  {new Date(dayOpen + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </h2>
                <div style={{ fontSize: 12, color: T.text3, marginTop: 3 }}>
                  {(() => {
                    const p = (byDate[dayOpen] || []).filter(e => e.kind === 'PU').length
                    const d = (byDate[dayOpen] || []).filter(e => e.kind === 'DEL').length
                    return `${p} pickup${p === 1 ? '' : 's'} · ${d} ${d === 1 ? 'delivery' : 'deliveries'}`
                  })()}
                </div>
              </div>
              <button onClick={() => setDayOpen(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: T.text3, lineHeight: 1 }}>×</button>
            </div>
            {(byDate[dayOpen] || []).map((e, k) => <Entry key={k} entry={e} size="md" />)}
          </div>
        </div>
      )}
    </div>
  )
}

// Short chip label — skip filler words so "THE FRONTLINE FREIGHT INC" reads
// as FRONTLINE rather than THE.
function carrierLabel(name) {
  const skip = new Set(['THE', 'A', 'AND', '&'])
  const word = name.toUpperCase().split(/\s+/).find(w => !skip.has(w)) || name
  return word.replace(/[^A-Z0-9&]/gi, '')
}

const chip = (active, color) => ({
  padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 700,
  background: active ? color + '22' : 'transparent',
  border: `1px solid ${active ? color : T.sep}`,
  color: active ? color : T.text3,
})
