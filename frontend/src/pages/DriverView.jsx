import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { T, STATUS } from '../theme.js'

export default function DriverView({ user, onLogout }) {
  const [loads, setLoads] = useState([])

  useEffect(() => { api.loads().then(setLoads) }, [])

  async function updateStatus(id, status) {
    await api.updateLoadStatus(id, status)
    setLoads(ls => ls.map(l => l.id === id ? { ...l, status } : l))
  }

  const activeLoads = loads.filter(l => l.status !== 'completed')
  const completedLoads = loads.filter(l => l.status === 'completed').slice(0, 5)

  return (
    <div style={{ background: T.bg, minHeight: '100vh' }}>
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.sep}`, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>My Dispatches</div>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>Welcome, {user.full_name}</div>
        </div>
        <button onClick={onLogout} style={{
          background: T.bg2, border: `1px solid ${T.sep}`, color: T.text2,
          padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        }}>Sign out</button>
      </div>

      <div style={{ padding: '16px', maxWidth: 600, margin: '0 auto' }}>
        {activeLoads.length === 0 && (
          <div style={{ background: T.bg1, borderRadius: 14, padding: '40px 20px', textAlign: 'center', color: T.text3, marginTop: 20, border: `1px solid ${T.sep}` }}>
            No active loads right now.
          </div>
        )}

        {activeLoads.map(l => {
          const s = STATUS[l.status] || STATUS.pending
          return (
            <div key={l.id} style={{ background: T.bg1, borderRadius: 14, marginBottom: 14, overflow: 'hidden', border: `1px solid ${T.sep}`, borderLeft: `3px solid ${s.color}` }}>
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.sep}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Load {l.load_number || `#${l.id}`}</div>
                  <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>{l.broker_name}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.color + '22', padding: '3px 9px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {s.label}
                </span>
              </div>

              <div style={{ padding: '14px 18px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <LocBox label="Pickup" name={l.pickup_name}
                    address={[l.pickup_address, l.pickup_city, l.pickup_state].filter(Boolean).join(', ')}
                    date={l.pickup_date} time={l.pickup_time} color={T.blue}
                    refs={l.pickup_refs} phone={l.pickup_phone} />
                  <LocBox label="Delivery" name={l.delivery_name}
                    address={[l.delivery_address, l.delivery_city, l.delivery_state].filter(Boolean).join(', ')}
                    date={l.delivery_date} time={l.delivery_time} color={T.purple}
                    refs={l.delivery_refs} phone={l.delivery_phone} />
                </div>

                {(l.commodity || l.weight || l.tractor_number) && (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: T.bg2, borderRadius: 8, fontSize: 12, color: T.text2, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {l.commodity && <span>{l.commodity}</span>}
                    {l.weight && <span>{l.weight}</span>}
                    {l.tractor_number && <span>T:{l.tractor_number} / Tr:{l.truck_trailer}</span>}
                  </div>
                )}

                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ padding: '9px 16px', background: T.green, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                    onClick={() => updateStatus(l.id, 'in_transit')}>En Route</button>
                  <button style={{ padding: '9px 16px', background: T.teal, color: '#000', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                    onClick={() => updateStatus(l.id, 'delivered')}>Delivered</button>
                </div>
              </div>
            </div>
          )
        })}

        {completedLoads.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Completed</div>
            {completedLoads.map(l => (
              <div key={l.id} style={{ background: T.bg1, borderRadius: 10, padding: '12px 16px', marginBottom: 8, border: `1px solid ${T.sep}`, opacity: 0.6 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: T.text }}>Load {l.load_number || `#${l.id}`}</span>
                <span style={{ marginLeft: 10, fontSize: 12, color: T.text3 }}>{l.pickup_city} → {l.delivery_city}</span>
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
    <div style={{ padding: '10px 12px', background: color + '18', borderRadius: 9, borderLeft: `2px solid ${color}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 13, color: T.text }}>{name}</div>
      <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>{address}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color, marginTop: 4 }}>{date} {time}</div>
      {phone && <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{phone}</div>}
      {refs && <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{refs}</div>}
    </div>
  )
}
