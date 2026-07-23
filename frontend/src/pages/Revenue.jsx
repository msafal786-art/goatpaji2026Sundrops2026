import React, { useEffect, useState } from 'react'
import { T } from '../theme.js'
import { api } from '../api.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

function fmtFull(n) {
  if (!n) return '$0'
  return '$' + Math.round(n).toLocaleString()
}
// Compact money for dense cells: $4.4k, $12k
function fmtK(n) {
  if (!n) return '—'
  if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k'
  return '$' + Math.round(n)
}

function periodLabel(p, period) {
  if (period === 'month') {
    const [y, m] = p.split('-')
    const d = new Date(+y, +m - 1, 1)
    return `${d.toLocaleDateString(undefined, { month: 'short' })} '${y.slice(2)}`
  }
  const [y, w] = p.split('-W')
  return `W${w} '${y.slice(2)}`
}

// ── Segmented control ─────────────────────────────────────────────────────────
function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: T.bg2, borderRadius: 9, padding: 3 }}>
      {options.map(o => {
        const active = value === o.value
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: active ? 700 : 500,
            background: active ? T.bg1 : 'transparent',
            color: active ? T.text : T.text3,
          }}>{o.label}</button>
        )
      })}
    </div>
  )
}

export default function Revenue() {
  const mobile = useIsMobile()
  const [by, setBy] = useState('driver')       // driver | truck
  const [period, setPeriod] = useState('week') // week | month
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setDenied(false)
    api.revenueStreams(by, period)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) { if (/authoriz/i.test(e.message)) setDenied(true); setData(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [by, period])

  // Keep the table a sensible width — show the most recent periods, scroll for older.
  const MAX_COLS = mobile ? 6 : 12
  const periods = data ? data.periods.slice(-MAX_COLS) : []

  // Grand totals
  const grandByPeriod = {}
  let grandTotal = 0
  if (data) {
    for (const p of periods) grandByPeriod[p] = 0
    for (const row of data.rows) {
      for (const p of periods) grandByPeriod[p] += row.cells[p]?.revenue || 0
      grandTotal += periods.reduce((s, p) => s + (row.cells[p]?.revenue || 0), 0)
    }
  }

  const entityLabel = by === 'driver' ? 'Driver' : 'Truck'
  const cellPad = mobile ? '7px 8px' : '9px 12px'
  const th = { padding: cellPad, fontSize: 10.5, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right', whiteSpace: 'nowrap' }
  const stickyLeft = { position: 'sticky', left: 0, background: T.bg1, zIndex: 1 }
  // Pin the Total column to the right so it stays visible while weeks scroll.
  const stickyRight = { position: 'sticky', right: 0, background: T.bg1, zIndex: 1, borderLeft: `1px solid ${T.sep}` }

  return (
    <div style={{ maxWidth: 1500 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>
          Revenue Streams
        </h1>
        <p style={{ fontSize: 13, color: T.text3, marginTop: 5, lineHeight: 1.5 }}>
          Delivered revenue by {by === 'driver' ? 'driver' : 'truck'}, per {period === 'week' ? 'week' : 'month'}.
          Counts loads marked delivered or completed, dated by their delivery day.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <Segmented value={by} onChange={setBy} options={[
          { value: 'driver', label: 'By Driver' },
          { value: 'truck', label: 'By Truck' },
        ]} />
        <Segmented value={period} onChange={setPeriod} options={[
          { value: 'week', label: 'Weekly' },
          { value: 'month', label: 'Monthly' },
        ]} />
      </div>

      {denied && (
        <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>Revenue is restricted</div>
          <div style={{ fontSize: 13, color: T.text3 }}>Your account doesn't have permission to view revenue figures.</div>
        </div>
      )}

      {!denied && loading && (
        <div style={{ textAlign: 'center', padding: 48, color: T.text3, fontSize: 14 }}>Loading revenue…</div>
      )}

      {!denied && !loading && data && (
        <>
          {/* Grand total banner */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16,
            padding: '14px 18px', background: T.bg1, border: `1px solid ${T.sep}`,
            borderLeft: `3px solid ${T.green}`, borderRadius: 12,
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: T.green, letterSpacing: -0.5 }}>{fmtFull(grandTotal)}</div>
            <div style={{ fontSize: 13, color: T.text3 }}>
              across {data.rows.length} {by === 'driver' ? 'driver' : 'truck'}{data.rows.length !== 1 ? 's' : ''},
              last {periods.length} {period === 'week' ? 'weeks' : 'months'}
            </div>
          </div>

          {data.rows.length === 0 ? (
            <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>No delivered revenue in range</div>
              <div style={{ fontSize: 13, color: T.text3 }}>Revenue appears here once loads are marked delivered with a rate and a {by} assigned.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: mobile ? 'auto' : 640 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.sep}` }}>
                    <th style={{ ...th, ...stickyLeft, textAlign: 'left' }}>{entityLabel}</th>
                    {periods.map(p => <th key={p} style={th}>{periodLabel(p, period)}</th>)}
                    <th style={{ ...th, ...stickyRight, color: T.text2 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => {
                    const rowTotal = periods.reduce((s, p) => s + (row.cells[p]?.revenue || 0), 0)
                    if (rowTotal === 0) return null // hide entities with no revenue in the visible window
                    const top = i === 0
                    return (
                      <tr key={row.id} style={{ borderBottom: `1px solid ${T.sep}55` }}>
                        <td style={{
                          ...stickyLeft, padding: cellPad, fontSize: 13, fontWeight: top ? 700 : 600,
                          color: T.text, whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {top && <span style={{ color: T.green, marginRight: 5 }}>▲</span>}
                          {row.name}
                          {row.sub && <span style={{ color: T.text3, fontWeight: 500, fontSize: 11 }}> · {row.sub}</span>}
                        </td>
                        {periods.map(p => {
                          const rev = row.cells[p]?.revenue || 0
                          return (
                            <td key={p} style={{ padding: cellPad, fontSize: 12.5, textAlign: 'right', color: rev ? T.text2 : T.text3, whiteSpace: 'nowrap' }}>
                              {fmtK(rev)}
                            </td>
                          )
                        })}
                        <td style={{ ...stickyRight, padding: cellPad, fontSize: 13, fontWeight: 700, textAlign: 'right', color: T.text, whiteSpace: 'nowrap' }}>
                          {fmtFull(rowTotal)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `1px solid ${T.sep}` }}>
                    <td style={{ ...stickyLeft, padding: cellPad, fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>All</td>
                    {periods.map(p => (
                      <td key={p} style={{ padding: cellPad, fontSize: 12, textAlign: 'right', color: T.text3, whiteSpace: 'nowrap' }}>
                        {fmtK(grandByPeriod[p])}
                      </td>
                    ))}
                    <td style={{ ...stickyRight, padding: cellPad, fontSize: 13, fontWeight: 800, textAlign: 'right', color: T.green, whiteSpace: 'nowrap' }}>
                      {fmtFull(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
