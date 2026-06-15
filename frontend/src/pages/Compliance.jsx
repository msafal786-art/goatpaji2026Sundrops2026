import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'
import { useAuth } from '../AuthContext.jsx'

function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)
  return Math.ceil(diff / 86400000)
}

function urgencyOf(days) {
  if (days === null) return 4   // missing = lowest priority for sort, but show as gray
  if (days < 0) return 0        // expired
  if (days <= 30) return 1      // expiring soon
  if (days <= 90) return 2      // watch
  return 3                      // ok
}

function ExpiryBadge({ dateStr, label }) {
  const days = daysUntil(dateStr)
  if (!dateStr) return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>{label}</div>
      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: T.bg2, color: T.text3, fontWeight: 600 }}>
        Not set
      </span>
    </div>
  )
  const color = days < 0 ? T.red : days <= 30 ? T.orange : days <= 90 ? '#d4a017' : T.green
  const bg = days < 0 ? T.red + '15' : days <= 30 ? T.orange + '15' : days <= 90 ? '#d4a01715' : T.green + '15'
  const text = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today!' : `${days}d`
  const dateDisplay = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>{label}</div>
      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: bg, color, fontWeight: 700, display: 'block', marginBottom: 1 }}>
        {text}
      </span>
      <span style={{ fontSize: 10, color: T.text3 }}>{dateDisplay}</span>
    </div>
  )
}

function worstDays(items) {
  const valid = items.filter(d => d !== null)
  if (valid.length === 0) return null
  return Math.min(...valid)
}

export default function Compliance() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'urgent' | 'expired'
  const [tab, setTab] = useState('drivers')  // 'drivers' | 'trucks'

  useEffect(() => {
    api.compliance().then(setData).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color: T.text3, padding: 20 }}>Loading…</div>
  if (!data) return <div style={{ color: T.red, padding: 20 }}>Failed to load compliance data.</div>

  // Sort drivers by worst expiry urgency
  const sortedDrivers = [...data.drivers].sort((a, b) => {
    const aDays = worstDays([daysUntil(a.license_expiry), daysUntil(a.medical_card_expiry), daysUntil(a.drug_test_expiry)])
    const bDays = worstDays([daysUntil(b.license_expiry), daysUntil(b.medical_card_expiry), daysUntil(b.drug_test_expiry)])
    const au = urgencyOf(aDays), bu = urgencyOf(bDays)
    if (au !== bu) return au - bu
    if (aDays === null && bDays === null) return 0
    if (aDays === null) return 1
    if (bDays === null) return -1
    return aDays - bDays
  })

  const sortedTrucks = [...data.trucks].sort((a, b) => {
    const aDays = worstDays([daysUntil(a.registration_expiry), daysUntil(a.insurance_expiry)])
    const bDays = worstDays([daysUntil(b.registration_expiry), daysUntil(b.insurance_expiry)])
    const au = urgencyOf(aDays), bu = urgencyOf(bDays)
    if (au !== bu) return au - bu
    if (aDays === null && bDays === null) return 0
    if (aDays === null) return 1
    if (bDays === null) return -1
    return aDays - bDays
  })

  function filterItems(items, getExpiries) {
    if (filter === 'all') return items
    return items.filter(item => {
      const days = worstDays(getExpiries(item))
      if (filter === 'expired') return days !== null && days < 0
      if (filter === 'urgent') return days !== null && days <= 30
      return true
    })
  }

  const filteredDrivers = filterItems(sortedDrivers, d => [daysUntil(d.license_expiry), daysUntil(d.medical_card_expiry), daysUntil(d.drug_test_expiry)])
  const filteredTrucks  = filterItems(sortedTrucks,  t => [daysUntil(t.registration_expiry), daysUntil(t.insurance_expiry)])

  // Summary counts
  const expiredDrivers = sortedDrivers.filter(d => {
    const days = worstDays([daysUntil(d.license_expiry), daysUntil(d.medical_card_expiry), daysUntil(d.drug_test_expiry)])
    return days !== null && days < 0
  }).length
  const urgentDrivers = sortedDrivers.filter(d => {
    const days = worstDays([daysUntil(d.license_expiry), daysUntil(d.medical_card_expiry), daysUntil(d.drug_test_expiry)])
    return days !== null && days >= 0 && days <= 30
  }).length
  const expiredTrucks = sortedTrucks.filter(t => {
    const days = worstDays([daysUntil(t.registration_expiry), daysUntil(t.insurance_expiry)])
    return days !== null && days < 0
  }).length
  const urgentTrucks = sortedTrucks.filter(t => {
    const days = worstDays([daysUntil(t.registration_expiry), daysUntil(t.insurance_expiry)])
    return days !== null && days >= 0 && days <= 30
  }).length

  const totalExpired = expiredDrivers + expiredTrucks
  const totalUrgent  = urgentDrivers + urgentTrucks

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: -0.4, margin: 0 }}>Compliance</h1>
        <div style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>Expiry dates for all drivers and equipment — sorted by urgency</div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Expired', count: totalExpired, color: T.red, bg: T.red + '12', filter: 'expired' },
          { label: 'Due in 30 days', count: totalUrgent, color: T.orange, bg: T.orange + '12', filter: 'urgent' },
          { label: 'Drivers', count: data.drivers.length, color: T.text2, bg: T.bg2, filter: 'all' },
          { label: 'Trucks', count: data.trucks.length, color: T.text2, bg: T.bg2, filter: 'all' },
        ].map(s => (
          <button key={s.label} onClick={() => setFilter(s.filter)} style={{
            padding: '10px 18px', borderRadius: 12, border: `1px solid ${s.color}30`,
            background: filter === s.filter && s.filter !== 'all' ? s.bg : T.bg1,
            cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: 11, color: T.text3, fontWeight: 600 }}>{s.label}</div>
          </button>
        ))}
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} style={{ padding: '10px 14px', borderRadius: 12, border: `1px solid ${T.sep}`, background: T.bg1, cursor: 'pointer', color: T.text3, fontSize: 12 }}>
            Clear filter ×
          </button>
        )}
      </div>

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: T.bg2, borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'drivers', label: `Drivers (${filteredDrivers.length})` },
          { key: 'trucks',  label: `Trucks (${filteredTrucks.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '7px 18px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            background: tab === t.key ? T.bg1 : 'transparent',
            color: tab === t.key ? T.text : T.text3,
            boxShadow: tab === t.key ? `0 1px 3px ${T.sep}` : 'none',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Drivers table */}
      {tab === 'drivers' && (
        <div style={{ background: T.bg1, borderRadius: 14, border: `1px solid ${T.sep}`, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '10px 18px', borderBottom: `1px solid ${T.sep}`, background: T.bg2 }}>
            {['Driver', 'Company', 'CDL Expiry', 'Med Card', 'Drug Test'].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: h === 'Driver' || h === 'Company' ? 'left' : 'center' }}>{h}</div>
            ))}
          </div>
          {filteredDrivers.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: T.text3, fontSize: 13 }}>No drivers match the current filter.</div>
          )}
          {filteredDrivers.map((d, i) => {
            const worstD = worstDays([daysUntil(d.license_expiry), daysUntil(d.medical_card_expiry), daysUntil(d.drug_test_expiry)])
            const rowAlert = worstD !== null && worstD < 0
            return (
              <div key={d.id} style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                padding: '14px 18px', alignItems: 'center', gap: 8,
                borderBottom: i < filteredDrivers.length - 1 ? `1px solid ${T.sep}` : 'none',
                background: rowAlert ? T.red + '06' : 'transparent',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                    {d.full_name}
                    {!d.is_active && <span style={{ marginLeft: 6, fontSize: 10, color: T.text3, background: T.bg2, padding: '1px 6px', borderRadius: 10 }}>Inactive</span>}
                  </div>
                  {d.license_number && (
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>
                      {d.cdl_class ? `CDL-${d.cdl_class}` : 'CDL'}{d.license_state ? ` · ${d.license_state}` : ''} · #{d.license_number}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: T.text2 }}>{d.company_name || '—'}</div>
                <ExpiryBadge dateStr={d.license_expiry} label="" />
                <ExpiryBadge dateStr={d.medical_card_expiry} label="" />
                <ExpiryBadge dateStr={d.drug_test_expiry} label="" />
              </div>
            )
          })}
        </div>
      )}

      {/* Trucks table */}
      {tab === 'trucks' && (
        <div style={{ background: T.bg1, borderRadius: 14, border: `1px solid ${T.sep}`, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 18px', borderBottom: `1px solid ${T.sep}`, background: T.bg2 }}>
            {['Truck', 'Company', 'Registration', 'Insurance'].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: h === 'Truck' || h === 'Company' ? 'left' : 'center' }}>{h}</div>
            ))}
          </div>
          {filteredTrucks.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: T.text3, fontSize: 13 }}>No trucks match the current filter.</div>
          )}
          {filteredTrucks.map((t, i) => {
            const worstD = worstDays([daysUntil(t.registration_expiry), daysUntil(t.insurance_expiry)])
            const rowAlert = worstD !== null && worstD < 0
            return (
              <div key={t.id} style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                padding: '14px 18px', alignItems: 'center', gap: 8,
                borderBottom: i < filteredTrucks.length - 1 ? `1px solid ${T.sep}` : 'none',
                background: rowAlert ? T.red + '06' : 'transparent',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Unit #{t.tractor_number}</div>
                  {(t.trailer_number || t.plate) && (
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>
                      {t.trailer_number ? `Trailer: ${t.trailer_number}` : ''}{t.plate ? ` · Plate: ${t.plate}` : ''}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: T.text2 }}>{t.company_name || '—'}</div>
                <ExpiryBadge dateStr={t.registration_expiry} label="" />
                <ExpiryBadge dateStr={t.insurance_expiry} label="" />
              </div>
            )
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: T.text3, marginTop: 16, textAlign: 'center' }}>
        Update expiry dates on the Drivers and Trucks pages.
        {totalExpired > 0 && <span style={{ color: T.red, fontWeight: 700 }}> {totalExpired} item{totalExpired > 1 ? 's' : ''} expired — action required.</span>}
      </div>
    </div>
  )
}
