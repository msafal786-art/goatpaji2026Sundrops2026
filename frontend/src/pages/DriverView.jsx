import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { T, STATUS } from '../theme.js'

export default function DriverView({ user, onLogout }) {
  const [loads, setLoads] = useState([])
  const [expanded, setExpanded] = useState(null)

  useEffect(() => { api.loads().then(setLoads) }, [])

  async function updateStatus(id, status) {
    await api.updateLoadStatus(id, status)
    setLoads(ls => ls.map(l => l.id === id ? { ...l, status } : l))
  }

  const activeLoads = loads.filter(l => !['completed'].includes(l.status))
  const completedLoads = loads.filter(l => l.status === 'completed').slice(0, 5)

  return (
    <div style={{ background: T.bg, minHeight: '100vh', paddingBottom: 32 }}>
      {/* Header */}
      <div style={{
        background: T.bg1 + 'f0', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${T.sep}`, padding: '14px 18px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>My Loads</div>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 1 }}>{user.full_name}</div>
        </div>
        <button onClick={onLogout} style={{
          background: T.bg2, border: `1px solid ${T.sep}`, color: T.text2,
          padding: '7px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
        }}>Sign out</button>
      </div>

      <div style={{ padding: '14px 14px 0' }}>
        {activeLoads.length === 0 && (
          <div style={{ background: T.bg1, borderRadius: 16, padding: '48px 20px', textAlign: 'center', color: T.text3, marginTop: 12, border: `1px solid ${T.sep}` }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>No active loads</div>
          </div>
        )}

        {activeLoads.map(l => {
          const s = STATUS[l.status] || STATUS.pending
          const open = expanded === l.id
          const pickupAddr = [l.pickup_city, l.pickup_state].filter(Boolean).join(', ')
          const delivAddr = [l.delivery_city, l.delivery_state].filter(Boolean).join(', ')

          return (
            <div key={l.id} style={{
              background: `linear-gradient(135deg, ${s.color}20 0%, ${s.color}0d 100%)`,
              border: `1px solid ${s.color}55`,
              borderRadius: 16, marginBottom: 12, overflow: 'hidden',
              backdropFilter: 'blur(10px)',
            }}>
              {/* Top bar */}
              <div
                onClick={() => setExpanded(open ? null : l.id)}
                style={{ padding: '14px 16px', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{l.load_number || `#${l.id}`}</div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                    background: s.color + '30', color: s.color,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{s.label}</span>
                </div>

                {/* Route summary */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: T.blue, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Pickup</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{pickupAddr || l.pickup_name}</div>
                    <div style={{ fontSize: 11, color: T.blue }}>{l.pickup_date}{l.pickup_time ? ` · ${l.pickup_time}` : ''}</div>
                  </div>
                  <div style={{ fontSize: 18, color: T.text3 }}>→</div>
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: T.purple, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Delivery</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{delivAddr || l.delivery_name}</div>
                    <div style={{ fontSize: 11, color: T.purple }}>{l.delivery_date}{l.delivery_time ? ` · ${l.delivery_time}` : ''}</div>
                  </div>
                </div>

                <div style={{ fontSize: 10, color: T.text3, marginTop: 8, textAlign: 'right' }}>{open ? '▲ less' : '▼ details'}</div>
              </div>

              {/* Expanded details */}
              {open && (
                <div style={{ borderTop: `1px solid ${s.color}30`, padding: '14px 16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <LocBox label="Pickup" color={T.blue}
                      name={l.pickup_name}
                      address={[l.pickup_address, l.pickup_city, l.pickup_state].filter(Boolean).join(', ')}
                      date={l.pickup_date} time={l.pickup_time}
                      phone={l.pickup_phone} refs={l.pickup_refs} />
                    <LocBox label="Delivery" color={T.purple}
                      name={l.delivery_name}
                      address={[l.delivery_address, l.delivery_city, l.delivery_state].filter(Boolean).join(', ')}
                      date={l.delivery_date} time={l.delivery_time}
                      phone={l.delivery_phone} refs={l.delivery_refs} />
                  </div>

                  {(l.commodity || l.weight || l.tractor_number) && (
                    <div style={{ padding: '10px 12px', background: T.bg2, borderRadius: 10, fontSize: 12, color: T.text2, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                      {l.commodity && <span>📦 {l.commodity}</span>}
                      {l.weight && <span>⚖️ {l.weight}</span>}
                      {l.tractor_number && <span>🚛 T:{l.tractor_number} / Tr:{l.truck_trailer}</span>}
                    </div>
                  )}

                  {l.special_instructions && (
                    <div style={{ padding: '10px 12px', background: T.orange + '15', border: `1px solid ${T.orange}40`, borderRadius: 10, fontSize: 12, color: T.text2, marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.orange, marginBottom: 4 }}>SPECIAL INSTRUCTIONS</div>
                      {l.special_instructions}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      style={{ padding: '14px', background: T.green, color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
                      onClick={() => updateStatus(l.id, 'in_transit')}>
                      🚛 En Route
                    </button>
                    <button
                      style={{ padding: '14px', background: T.teal, color: '#000', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
                      onClick={() => updateStatus(l.id, 'delivered')}>
                      ✓ Delivered
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {completedLoads.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Completed</div>
            {completedLoads.map(l => (
              <div key={l.id} style={{ background: T.bg1, borderRadius: 12, padding: '12px 16px', marginBottom: 8, border: `1px solid ${T.sep}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.6 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: T.text }}>{l.load_number || `#${l.id}`}</span>
                <span style={{ fontSize: 12, color: T.text3 }}>{[l.pickup_city, l.delivery_city].filter(Boolean).join(' → ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LocBox({ label, name, address, date, time, color, refs, phone }) {
  return (
    <div style={{ padding: '10px 11px', background: color + '18', borderRadius: 10, border: `1px solid ${color}30` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 }}>{label}</div>
      {name && <div style={{ fontWeight: 600, fontSize: 12, color: T.text }}>{name}</div>}
      {address && <div style={{ fontSize: 11, color: T.text2, marginTop: 2, lineHeight: 1.4 }}>{address}</div>}
      {(date || time) && <div style={{ fontSize: 11, fontWeight: 600, color, marginTop: 4 }}>{date}{time ? ` · ${time}` : ''}</div>}
      {phone && (
        <a href={`tel:${phone}`} style={{ fontSize: 11, color: T.blue, marginTop: 3, display: 'block', textDecoration: 'none' }}>📞 {phone}</a>
      )}
      {refs && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{refs}</div>}
    </div>
  )
}
