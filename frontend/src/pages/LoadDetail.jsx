import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import LoadForm from '../components/LoadForm.jsx'

export default function LoadDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const [load, setLoad] = useState(null)
  const [allIds, setAllIds] = useState([])
  const [dispatchMsg, setDispatchMsg] = useState('')
  const [showMsg, setShowMsg] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [copying, setCopying] = useState(false)

  useEffect(() => { loadData() }, [id])
  useEffect(() => {
    api.loads().then(ls => {
      const sorted = [...ls].sort((a, b) => {
        const ad = a.pickup_date || '', bd = b.pickup_date || ''
        return ad < bd ? -1 : ad > bd ? 1 : 0
      })
      setAllIds(sorted.map(l => l.id))
    })
  }, [])

  async function loadData() {
    const l = await api.load(id)
    setLoad(l)
  }

  const currentIdx = allIds.indexOf(Number(id))
  const prevId = currentIdx > 0 ? allIds[currentIdx - 1] : null
  const nextId = currentIdx >= 0 && currentIdx < allIds.length - 1 ? allIds[currentIdx + 1] : null

  async function handleGetDispatch() {
    const { message } = await api.dispatchMessage(id)
    setDispatchMsg(message)
    setShowMsg(true)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(dispatchMsg)
    setCopying(true)
    setTimeout(() => setCopying(false), 1500)
  }

  async function handleMarkDispatched() {
    await api.markDispatched(id)
    await loadData()
  }

  async function handleStatus(status) {
    await api.updateLoadStatus(id, status)
    await loadData()
  }

  if (!load) return <div style={{ padding: 40, color: T.text2 }}>Loading…</div>

  const canEdit = user.role !== 'driver'
  const s = STATUS[load.status] || STATUS.pending

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <button onClick={() => navigate('/loads')} style={{
          background: 'none', border: 'none', color: T.blue, cursor: 'pointer',
          fontSize: 13, padding: 0, fontWeight: 600,
        }}>← Back to Loads</button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => prevId && navigate(`/loads/${prevId}`)} disabled={!prevId} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: prevId ? 'pointer' : 'default',
            background: T.bg2, border: `1px solid ${T.sep}`, color: prevId ? T.text : T.text3,
          }}>← Prev</button>
          <button onClick={() => nextId && navigate(`/loads/${nextId}`)} disabled={!nextId} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: nextId ? 'pointer' : 'default',
            background: T.bg2, border: `1px solid ${T.sep}`, color: nextId ? T.text : T.text3,
          }}>Next →</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            {load.broker_order && (
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: -0.4, margin: 0 }}>
                {load.broker_order}
              </h1>
            )}
            <span style={{ fontSize: 14, fontWeight: 600, color: T.text3, letterSpacing: 0 }}>
              #{load.load_number || load.id}
            </span>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: s.color + '22', color: s.color, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>{s.label}</span>
            {load.dispatch_sent && <span style={{ fontSize: 11, color: T.green }}>✓ Dispatched {load.dispatch_sent_at?.slice(0,10)}</span>}
            {load.company_name && (
              <span style={{ fontSize: 11, background: T.blue + '22', color: T.blue, padding: '3px 10px', borderRadius: 20 }}>
                {load.company_name}
              </span>
            )}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn onClick={handleGetDispatch}>Dispatch Message</Btn>
            {!load.dispatch_sent && load.driver_id && (
              <Btn color={T.green} onClick={handleMarkDispatched}>Mark Dispatched</Btn>
            )}
            {load.status === 'delivered' && (
              <Btn color={T.green} onClick={() => handleStatus('completed')}>✓ Mark Invoiced</Btn>
            )}
            <Btn onClick={() => setShowEdit(true)}>Edit</Btn>
          </div>
        )}
      </div>

      {/* Status progression */}
      {canEdit && (
        <div style={{ background: T.bg1, borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: `1px solid ${T.sep}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Update Status</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['pending','assigned','dispatched','in_transit','delivered','completed'].map(st => {
              const ss = STATUS[st]
              const active = load.status === st
              return (
                <button key={st} onClick={() => handleStatus(st)} style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: `1.5px solid ${active ? ss.color : T.sep}`,
                  background: active ? ss.color + '22' : 'transparent',
                  color: active ? ss.color : T.text2,
                  cursor: 'pointer', textTransform: 'capitalize',
                }}>{ss.label}</button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <Card title="Pickup">
          <Field label="Shipper" value={load.pickup_name} bold />
          <Field label="Address" value={[load.pickup_address, load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).join(', ')} />
          <Field label="Date / Time" value={`${load.pickup_date || ''}${load.pickup_time ? ' @ ' + load.pickup_time : ''}`} />
          <Field label="Phone" value={load.pickup_phone} />
          <Field label="References" value={load.pickup_refs} />
        </Card>
        <Card title="Delivery">
          <Field label="Consignee" value={load.delivery_name} bold />
          <Field label="Address" value={[load.delivery_address, load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).join(', ')} />
          <Field label="Date / Time" value={`${load.delivery_date || ''}${load.delivery_time ? ' @ ' + load.delivery_time : ''}`} />
          <Field label="Phone" value={load.delivery_phone} />
          <Field label="References" value={load.delivery_refs} />
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        <Card title="Broker">
          <Field label="Broker" value={load.broker_name} bold />
          <Field label="Order #" value={load.broker_order} />
          <Field label="Contact" value={load.broker_contact} />
          <Field label="Email" value={load.broker_email} />
          {(user.role === 'dispatcher' || user.role === 'company_owner') && load.rate && (
            <Field label="Rate" value={`$${Number(load.rate).toLocaleString()}`} bold />
          )}
        </Card>
        <Card title="Load Info">
          <Field label="Commodity" value={load.commodity} />
          <Field label="Weight" value={load.weight} />
          <Field label="Miles" value={load.miles} />
          <Field label="Trailer" value={load.trailer_type} />
          <Field label="BOL" value={load.bol} />
        </Card>
        <Card title="Assignment">
          <Field label="Driver" value={load.driver_name || 'Unassigned'} bold />
          <Field label="Phone" value={load.driver_phone} />
          <Field label="Tractor #" value={load.tractor_number} />
          <Field label="Trailer #" value={load.truck_trailer} />
        </Card>
      </div>

      {load.special_instructions && (
        <Card title="Special Instructions">
          <p style={{ fontSize: 13, color: T.text2, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{load.special_instructions}</p>
        </Card>
      )}

      {/* Dispatch message modal */}
      {showMsg && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setShowMsg(false)}>
          <div style={{ background: T.bg1, borderRadius: 20, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${T.sep}` }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Dispatch Message</h2>
              <button onClick={() => setShowMsg(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>
            <pre style={{
              fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
              background: T.bg2, padding: 16, borderRadius: 10, maxHeight: 340, overflowY: 'auto', color: T.text,
            }}>{dispatchMsg}</pre>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Btn color={T.blue} onClick={handleCopy}>{copying ? '✓ Copied!' : 'Copy to Clipboard'}</Btn>
              {!load.dispatch_sent && load.driver_id && (
                <Btn color={T.green} onClick={async () => { await handleMarkDispatched(); setShowMsg(false) }}>Mark as Sent</Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {showEdit && (
        <LoadForm
          load={load}
          onClose={() => setShowEdit(false)}
          onSave={(updated) => { setLoad(updated); setShowEdit(false) }}
        />
      )}
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div style={{ background: T.bg1, borderRadius: 14, padding: '16px 20px', border: `1px solid ${T.sep}` }}>
      <h3 style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, value, bold }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: T.text3 }}>{label} </span>
      <span style={{ fontSize: 13, color: T.text, fontWeight: bold ? 600 : 400 }}>{value}</span>
    </div>
  )
}

function Btn({ children, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 16px', background: (color || T.bg3), color: color ? '#fff' : T.text,
      border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 13,
    }}>{children}</button>
  )
}
