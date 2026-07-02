import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { T } from '../theme.js'
import { useAuth } from '../AuthContext.jsx'

const STATUS_COLOR = {
  pending:    T.text3,
  assigned:   '#d4a017',
  dispatched: T.blue,
  in_transit: T.orange,
  delivered:  T.green,
  completed:  T.teal || T.green,
}

const STATUS_BG = {
  pending:    T.text3 + '20',
  assigned:   '#d4a01720',
  dispatched: T.blue + '20',
  in_transit: T.orange + '20',
  delivered:  T.green + '20',
  completed:  (T.teal || T.green) + '20',
}

function isoMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  return d
}

export default function Calendar() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loads, setLoads] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('month') // 'month' | 'week'
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })

  useEffect(() => {
    api.loads().then(setLoads).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // Group loads by pickup_date
  const byDate = {}
  for (const load of loads) {
    if (!load.pickup_date) continue
    const key = load.pickup_date.slice(0, 10)
    if (!byDate[key]) byDate[key] = []
    byDate[key].push(load)
  }

  function prevMonth() {
    setCursor(c => {
      if (c.month === 0) return { year: c.year - 1, month: 11 }
      return { ...c, month: c.month - 1 }
    })
  }
  function nextMonth() {
    setCursor(c => {
      if (c.month === 11) return { year: c.year + 1, month: 0 }
      return { ...c, month: c.month + 1 }
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const dayNames   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  // Build month grid
  const firstDay = new Date(cursor.year, cursor.month, 1)
  const lastDay  = new Date(cursor.year, cursor.month + 1, 0)
  const startPad = firstDay.getDay() // 0=Sun
  const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7

  const cells = []
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startPad + 1
    if (dayNum < 1 || dayNum > lastDay.getDate()) {
      cells.push(null)
    } else {
      const dateStr = `${cursor.year}-${String(cursor.month + 1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`
      cells.push(dateStr)
    }
  }

  // Week view — current week from Monday
  const weekStart = isoMonday(new Date())
  const weekDays = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    weekDays.push(d.toISOString().slice(0, 10))
  }

  function LoadPill({ load }) {
    const color = STATUS_COLOR[load.status] || T.text3
    const bg    = STATUS_BG[load.status] || T.bg2
    const label = load.load_number || `#${load.id}`
    const route = `${load.pickup_city || ''}${load.pickup_state ? ` ${load.pickup_state}` : ''} → ${load.delivery_city || ''}${load.delivery_state ? ` ${load.delivery_state}` : ''}`
    return (
      <div
        onClick={() => navigate(`/loads/${load.id}`)}
        style={{
          background: bg, color, borderLeft: `2px solid ${color}`,
          borderRadius: 4, padding: '2px 5px', marginBottom: 2, cursor: 'pointer',
          fontSize: 10, fontWeight: 600, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
        title={`${label} · ${route}`}
      >
        {label} {route}
      </div>
    )
  }

  // Total loads this month
  const thisMonthLoads = loads.filter(l => {
    if (!l.pickup_date) return false
    const d = l.pickup_date.slice(0, 7)
    return d === `${cursor.year}-${String(cursor.month + 1).padStart(2,'0')}`
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: -0.4, margin: 0 }}>Calendar</h1>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>
            {thisMonthLoads.length} load{thisMonthLoads.length !== 1 ? 's' : ''} in {monthNames[cursor.month]} {cursor.year}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* View toggle */}
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
          {view === 'month' && (
            <>
              <button onClick={prevMonth} style={{ padding: '7px 12px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, cursor: 'pointer', color: T.text2, fontSize: 14 }}>‹</button>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.text, minWidth: 140, textAlign: 'center' }}>
                {monthNames[cursor.month]} {cursor.year}
              </span>
              <button onClick={nextMonth} style={{ padding: '7px 12px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, cursor: 'pointer', color: T.text2, fontSize: 14 }}>›</button>
            </>
          )}
          {view === 'week' && (
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
              This week — {new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ color: T.text3, padding: 20 }}>Loading loads…</div>
      ) : view === 'month' ? (
        <div style={{ background: T.bg1, borderRadius: 14, border: `1px solid ${T.sep}`, overflow: 'hidden' }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${T.sep}` }}>
            {dayNames.map(d => (
              <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{d}</div>
            ))}
          </div>
          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map((dateStr, i) => {
              const dayLoads = dateStr ? (byDate[dateStr] || []) : []
              const isToday = dateStr === today
              const isPast = dateStr && dateStr < today
              const isWeekend = i % 7 === 0 || i % 7 === 6
              return (
                <div key={i} style={{
                  minHeight: 90, padding: '6px', borderRight: `1px solid ${T.sep}`,
                  borderBottom: `1px solid ${T.sep}`,
                  background: isToday ? T.blue + '0a' : isWeekend && dateStr ? T.bg2 + '60' : 'transparent',
                  opacity: !dateStr ? 0.3 : isPast ? 0.7 : 1,
                }}>
                  {dateStr && (
                    <>
                      <div style={{
                        fontSize: 12, fontWeight: isToday ? 800 : 500,
                        color: isToday ? T.blue : T.text2,
                        marginBottom: 4,
                        ...(isToday ? {
                          width: 22, height: 22, background: T.blue, color: '#fff',
                          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                        } : {})
                      }}>
                        {new Date(dateStr + 'T00:00:00').getDate()}
                      </div>
                      {dayLoads.slice(0, 3).map(l => <LoadPill key={l.id} load={l} />)}
                      {dayLoads.length > 3 && (
                        <div style={{ fontSize: 9, color: T.text3, fontWeight: 600, marginTop: 1 }}>+{dayLoads.length - 3} more</div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* Week view */
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
                  <div style={{ fontSize: isToday ? 18 : 16, fontWeight: isToday ? 800 : 500, color: isToday ? T.blue : T.text }}>
                    {d.getDate()}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3 }}>
                    {d.toLocaleDateString('en-US', { month: 'short' })}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: 200 }}>
            {weekDays.map((dateStr, i) => {
              const dayLoads = byDate[dateStr] || []
              return (
                <div key={dateStr} style={{ padding: '8px', borderRight: i < 6 ? `1px solid ${T.sep}` : 'none', minHeight: 160 }}>
                  {dayLoads.map(l => {
                    const color = STATUS_COLOR[l.status] || T.text3
                    const bg    = STATUS_BG[l.status] || T.bg2
                    return (
                      <div key={l.id} onClick={() => navigate(`/loads/${l.id}`)} style={{
                        background: bg, borderLeft: `3px solid ${color}`, borderRadius: 6,
                        padding: '6px 8px', marginBottom: 6, cursor: 'pointer',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color }}>{l.load_number || `#${l.id}`}</div>
                        <div style={{ fontSize: 10, color: T.text2, marginTop: 2 }}>
                          {l.pickup_city} → {l.delivery_city}
                        </div>
                        {l.driver_name && <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>{l.driver_name}</div>}
                      </div>
                    )
                  })}
                  {dayLoads.length === 0 && (
                    <div style={{ fontSize: 11, color: T.text3, padding: '8px 0' }}>—</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {Object.entries(STATUS_COLOR).map(([status, color]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 11, color: T.text3, textTransform: 'capitalize' }}>{status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
