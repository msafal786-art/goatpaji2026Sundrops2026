import React, { useState, useEffect, useCallback, useRef } from 'react'
import { T } from '../theme.js'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function mondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function toISO(date) {
  return date.toISOString().slice(0, 10)
}

function fmtDate(isoStr) {
  const [, m, d] = isoStr.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

function fmt$(n) {
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function MilesCell({ driverId, date, initial, rate, onSaved }) {
  const [val, setVal] = useState(initial != null ? String(initial) : '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef()

  useEffect(() => {
    setVal(initial != null ? String(initial) : '')
  }, [initial])

  async function save() {
    const miles = parseFloat(val)
    if (isNaN(miles) && val !== '') return
    setSaving(true)
    try {
      if (val === '' || isNaN(miles)) {
        await api.deletePayrollEntry(driverId, date)
        onSaved(date, null)
      } else {
        await api.savePayrollEntry({ driver_id: driverId, entry_date: date, miles })
        onSaved(date, miles)
      }
    } catch (e) {
      alert(e.message)
    }
    setSaving(false)
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      step="1"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={e => e.key === 'Enter' && inputRef.current?.blur()}
      placeholder="—"
      style={{
        width: '100%', border: 'none', outline: 'none', background: 'transparent',
        color: val ? T.text : T.text3, fontSize: 13, textAlign: 'center',
        fontFamily: 'inherit', padding: '6px 0', cursor: 'text',
        opacity: saving ? 0.5 : 1,
      }}
    />
  )
}

function RateCell({ driverId, initial, onChange }) {
  const [val, setVal] = useState(initial != null ? String(initial) : '0.55')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setVal(initial != null ? String(initial) : '0.55') }, [initial])

  async function save() {
    const rate = parseFloat(val)
    if (isNaN(rate) || rate < 0) return
    setSaving(true)
    try {
      await api.updateDriverRate(driverId, rate)
      onChange(rate)
    } catch (e) { /* ignore */ }
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
      <span style={{ fontSize: 11, color: T.text3 }}>$</span>
      <input
        type="number" min="0" step="0.01" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        style={{
          width: 44, border: 'none', outline: 'none', background: 'transparent',
          color: T.text2, fontSize: 11, textAlign: 'center', fontFamily: 'inherit',
          padding: '2px 0', opacity: saving ? 0.5 : 1,
        }}
      />
      <span style={{ fontSize: 11, color: T.text3 }}>/mi</span>
    </div>
  )
}

export default function Payroll() {
  const { user } = useAuth()
  const [weekStart, setWeekStart] = useState(toISO(mondayOf(new Date())))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // local overrides: { [driverId]: { [date]: miles|null, rate: number } }
  const [overrides, setOverrides] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setOverrides({})
    try {
      const d = await api.payrollWeek(weekStart)
      setData(d)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [weekStart])

  useEffect(() => { load() }, [load])

  function prevWeek() {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() - 7)
    setWeekStart(toISO(d))
  }
  function nextWeek() {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + 7)
    const now = mondayOf(new Date())
    if (d <= now) setWeekStart(toISO(d))
  }

  const isCurrentWeek = weekStart === toISO(mondayOf(new Date()))

  function handleMilesSaved(driverId, date, miles) {
    setOverrides(prev => ({
      ...prev,
      [driverId]: { ...prev[driverId], [date]: miles }
    }))
  }

  function handleRateChanged(driverId, rate) {
    setOverrides(prev => ({
      ...prev,
      [driverId]: { ...prev[driverId], rate }
    }))
  }

  function getMiles(driver, date) {
    const ov = overrides[driver.id]?.[date]
    if (ov !== undefined) return ov
    const day = data?.dates?.indexOf(date)
    return driver.days?.[day]?.miles ?? null
  }

  function getRate(driver) {
    return overrides[driver.id]?.rate ?? driver.rate_per_mile ?? 0.55
  }

  function getWeeklyTotal(driver) {
    if (!data || !driver.days) return 0
    return data.dates.reduce((sum, date) => {
      const m = getMiles(driver, date)
      return sum + (m != null ? m : 0)
    }, 0)
  }

  // Group by company for dispatcher view
  function groupByCompany(drivers) {
    const groups = {}
    for (const d of drivers) {
      const key = d.company_name || 'Unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(d)
    }
    return groups
  }

  const dates = data?.dates || []
  const drivers = data?.drivers || []
  const isOwner = user?.role === 'company_owner'
  const groups = isOwner ? { [user?.company_name || 'My Drivers']: drivers } : groupByCompany(drivers)

  function printStatements() {
    const rows = drivers
      .filter(d => getWeeklyTotal(d) > 0)
      .map(d => {
        const totalMiles = getWeeklyTotal(d)
        const rate = getRate(d)
        const pay = totalMiles * rate
        const dayRows = dates.map((date, i) => {
          const m = getMiles(d, date)
          return `<tr>
            <td>${DAY_LABELS[i]} ${fmtDate(date)}</td>
            <td>${m != null && m > 0 ? m.toLocaleString() : '—'}</td>
            <td>${m != null && m > 0 ? fmt$(m * rate) : '—'}</td>
          </tr>`
        }).join('')
        return `
          <div class="statement">
            <div class="header">
              <h2>${d.full_name}</h2>
              <div class="company">${d.company_name || ''}</div>
              <div class="week">Week of ${dates[0]} – ${dates[6]}</div>
            </div>
            <table>
              <thead><tr><th>Day</th><th>Miles</th><th>Earnings</th></tr></thead>
              <tbody>${dayRows}</tbody>
              <tfoot>
                <tr class="total">
                  <td>Total</td>
                  <td>${totalMiles.toLocaleString()} mi @ $${rate}/mi</td>
                  <td>${fmt$(pay)}</td>
                </tr>
              </tfoot>
            </table>
          </div>`
      }).join('')

    const html = `<!DOCTYPE html><html><head><title>Pay Statements</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; color: #000; margin: 0; padding: 0; }
      .statement { padding: 24px 28px; page-break-after: always; border-bottom: 2px solid #ddd; }
      .statement:last-child { page-break-after: auto; }
      .header { margin-bottom: 16px; }
      h2 { margin: 0 0 4px; font-size: 18px; }
      .company { color: #555; font-size: 12px; }
      .week { color: #777; font-size: 12px; margin-top: 2px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
      th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
      .total td { font-weight: 700; border-top: 2px solid #333; background: #fafafa; }
      @media print { body { font-size: 12px; } }
    </style></head><body>${rows || '<p style="padding:24px">No drivers with miles this week.</p>'}</body></html>`

    const win = window.open('', '_blank', 'width=680,height=800')
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 400)
  }

  // Summary totals
  const grandMiles = drivers.reduce((s, d) => s + getWeeklyTotal(d), 0)
  const grandPay = drivers.reduce((s, d) => s + getWeeklyTotal(d) * getRate(d), 0)
  const paidCount = drivers.filter(d => getWeeklyTotal(d) > 0).length

  const colW = 62
  const COL = { width: colW, minWidth: colW, maxWidth: colW, textAlign: 'center' }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0 }}>Payroll</h1>
          <p style={{ fontSize: 13, color: T.text3, margin: '4px 0 0' }}>Daily miles · weekly summary · click any cell to edit</p>
        </div>
        {/* Week navigator + print */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={prevWeek} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.sep}`, background: T.bg2, color: T.text, cursor: 'pointer', fontSize: 14 }}>‹</button>
          <div style={{ textAlign: 'center', minWidth: 180 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: T.text }}>
              {dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[6])}` : '—'}
            </div>
            <div style={{ fontSize: 11, color: T.text3 }}>{isCurrentWeek ? 'Current week' : weekStart.slice(0, 4)}</div>
          </div>
          <button onClick={nextWeek} disabled={isCurrentWeek} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.sep}`, background: T.bg2, color: isCurrentWeek ? T.text3 : T.text, cursor: isCurrentWeek ? 'default' : 'pointer', fontSize: 14 }}>›</button>
          {!loading && drivers.length > 0 && (
            <button onClick={printStatements} style={{
              padding: '6px 14px', borderRadius: 8, border: `1px solid ${T.sep}`,
              background: T.bg2, color: T.text2, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>Print Statements</button>
          )}
        </div>
      </div>

      {/* Summary bar */}
      {!loading && drivers.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Drivers with miles', val: `${paidCount} / ${drivers.length}` },
            { label: 'Total miles', val: grandMiles.toLocaleString() },
            { label: 'Estimated payroll', val: fmt$(grandPay) },
          ].map(s => (
            <div key={s.label} style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 10, padding: '10px 18px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginTop: 2 }}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ color: T.text3, padding: 40, textAlign: 'center' }}>Loading…</div>}
      {error && <div style={{ color: '#ff453a', padding: 20 }}>{error}</div>}

      {!loading && drivers.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: T.text3 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🚛</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text2 }}>No active drivers</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add drivers in the Drivers section first.</div>
        </div>
      )}

      {/* Grid per company group */}
      {!loading && Object.entries(groups).map(([companyName, companyDrivers]) => (
        <div key={companyName} style={{ marginBottom: 32 }}>
          {!isOwner && (
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{companyName}</div>
          )}
          <div style={{ border: `1px solid ${T.sep}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            {/* Column headers */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${T.sep}`, background: T.bg2, minWidth: 900 }}>
              <div style={{ flex: 1, padding: '8px 14px', fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Driver</div>
              {dates.map((date, i) => (
                <div key={date} style={{ ...COL, padding: '8px 0', fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <div>{DAY_LABELS[i]}</div>
                  <div style={{ fontWeight: 400 }}>{fmtDate(date)}</div>
                </div>
              ))}
              <div style={{ width: 72, textAlign: 'center', padding: '8px 0', fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total mi</div>
              <div style={{ width: 88, textAlign: 'center', padding: '8px 0', fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pay</div>
              <div style={{ width: 100, textAlign: 'center', padding: '8px 0', fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Rate/mi</div>
            </div>

            {/* Driver rows */}
            {companyDrivers.map((driver, idx) => {
              const weekMiles = getWeeklyTotal(driver)
              const rate = getRate(driver)
              const weekPay = weekMiles * rate
              const hasAny = weekMiles > 0

              return (
                <div key={driver.id} style={{
                  display: 'flex', alignItems: 'center', minWidth: 900,
                  borderBottom: idx < companyDrivers.length - 1 ? `1px solid ${T.sep}` : 'none',
                  borderLeft: hasAny ? '3px solid #30d158' : '3px solid transparent',
                  background: hasAny ? (T.isDark ? 'rgba(48,209,88,0.04)' : 'rgba(48,209,88,0.03)') : 'transparent',
                }}>
                  <div style={{ flex: 1, padding: '10px 14px' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{driver.full_name}</div>
                  </div>
                  {dates.map(date => {
                    const miles = getMiles(driver, date)
                    return (
                      <div key={date} style={{ ...COL, borderLeft: `1px solid ${T.sep}` }}>
                        <MilesCell
                          driverId={driver.id}
                          date={date}
                          initial={miles}
                          rate={rate}
                          onSaved={(d, m) => handleMilesSaved(driver.id, d, m)}
                        />
                      </div>
                    )
                  })}
                  <div style={{ width: 72, textAlign: 'center', borderLeft: `1px solid ${T.sep}`, padding: '10px 4px', fontSize: 13, fontWeight: 700, color: hasAny ? T.text : T.text3 }}>
                    {hasAny ? weekMiles.toLocaleString() : '—'}
                  </div>
                  <div style={{ width: 88, textAlign: 'center', borderLeft: `1px solid ${T.sep}`, padding: '10px 4px', fontSize: 13, fontWeight: 700, color: hasAny ? '#30d158' : T.text3 }}>
                    {hasAny ? fmt$(weekPay) : '—'}
                  </div>
                  <div style={{ width: 100, borderLeft: `1px solid ${T.sep}`, padding: '6px 4px' }}>
                    <RateCell driverId={driver.id} initial={rate} onChange={r => handleRateChanged(driver.id, r)} />
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        </div>
      ))}
    </div>
  )
}
