import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import LoadForm from '../components/LoadForm.jsx'

const DOC_TYPES = ['Rate Con', 'BOL', 'POD', 'Other']

export default function LoadDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const fileRef = useRef()

  const [load, setLoad] = useState(null)
  const [allIds, setAllIds] = useState([])
  const [dispatchMsg, setDispatchMsg] = useState('')
  const [showMsg, setShowMsg] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [copying, setCopying] = useState(false)

  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadType, setUploadType] = useState('BOL')

  const [detentionEdit, setDetentionEdit] = useState(false)
  const [detForm, setDetForm] = useState({ detention_start: '', detention_end: '', detention_rate: 65 })
  const [savingDet, setSavingDet] = useState(false)

  const [showChangeDriver, setShowChangeDriver] = useState(false)
  const [allDrivers, setAllDrivers] = useState([])
  const [driverSearch, setDriverSearch] = useState('')
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [brokerMsg, setBrokerMsg] = useState('')
  const [msgCopied, setMsgCopied] = useState(false)
  const [savingDriver, setSavingDriver] = useState(false)

  useEffect(() => { loadData(); fetchDocs() }, [id])
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
    setDetForm({
      detention_start: l.detention_start ? l.detention_start.slice(0, 16) : '',
      detention_end:   l.detention_end   ? l.detention_end.slice(0, 16)   : '',
      detention_rate:  l.detention_rate  ?? 65,
    })
  }

  async function fetchDocs() {
    try { setDocs(await api.loadDocs(id)) } catch { setDocs([]) }
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

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      await api.uploadDoc(id, file, uploadType)
      await fetchDocs()
    } finally {
      setUploading(false)
      fileRef.current.value = ''
    }
  }

  async function handleDeleteDoc(docId) {
    if (!confirm('Remove this document?')) return
    await api.deleteDoc(docId)
    await fetchDocs()
  }

  async function openChangeDriver() {
    const drivers = await api.drivers()
    setAllDrivers(drivers.filter(d => d.is_active !== 0))
    setSelectedDriver(null)
    setDriverSearch('')
    setBrokerMsg('')
    setMsgCopied(false)
    setShowChangeDriver(true)
  }

  function buildBrokerMsg(driver) {
    const loadRef = load.broker_order || load.load_number || `#${load.id}`
    const broker = load.broker_contact || load.broker_name || 'Team'
    const origName = load.driver_name || 'previous driver'
    return `Hi ${broker},

Please be advised that the driver assigned to Load ${loadRef} has been changed.

Previous Driver: ${origName}
New Driver: ${driver.full_name}
New Driver Phone: ${driver.phone || 'N/A'}

Please update your tracking portal and carrier contact with the new driver information. The load details and schedule remain unchanged.

Thank you,
${load.company_name || 'Dispatch'}`
  }

  function pickDriver(d) {
    setSelectedDriver(d)
    setBrokerMsg(buildBrokerMsg(d))
    setMsgCopied(false)
  }

  async function handleCopyBrokerMsg() {
    await navigator.clipboard.writeText(brokerMsg)
    setMsgCopied(true)
    setTimeout(() => setMsgCopied(false), 2000)
  }

  async function handleSaveDriverChange() {
    if (!selectedDriver) return
    setSavingDriver(true)
    try {
      const updated = await api.changeDriver(id, selectedDriver.id)
      setLoad(updated)
      setShowChangeDriver(false)
    } finally { setSavingDriver(false) }
  }

  async function handleSaveDetention() {
    setSavingDet(true)
    try {
      await api.setDetention(id, {
        detention_start: detForm.detention_start || null,
        detention_end:   detForm.detention_end   || null,
        detention_rate:  Number(detForm.detention_rate) || 65,
      })
      await loadData()
      setDetentionEdit(false)
    } finally { setSavingDet(false) }
  }

  function calcDetention(start, end, rate) {
    if (!start || !end) return null
    const hrs = (new Date(end) - new Date(start)) / 3600000
    if (hrs <= 0) return null
    return { hrs: Math.round(hrs * 10) / 10, charge: Math.round(hrs * rate) }
  }

  if (!load) return <div style={{ padding: 40, color: T.text2 }}>Loading…</div>

  const canEdit = user.role !== 'driver'
  const s = STATUS[load.status] || STATUS.pending

  const fmtTime = (iso) => {
    if (!iso) return null
    try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return iso }
  }

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
            <span style={{ fontSize: 14, fontWeight: 600, color: T.text3 }}>
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
          <Field label="Trailer Type" value={load.trailer_type} />
          <Field label="BOL #" value={load.bol} />
        </Card>
        <Card title="Assignment">
          {/* Current driver — large */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 2 }}>Driver</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{load.driver_name || 'Unassigned'}</div>
            {load.driver_phone && <div style={{ fontSize: 12, color: T.text2 }}>{load.driver_phone}</div>}
          </div>
          {/* Original driver — small chip, shown only after a swap */}
          {load.original_driver_id && load.original_driver_id !== load.driver_id && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, padding: '4px 10px', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Loaded by</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.text2 }}>{load.original_driver_name}</span>
              {load.original_driver_phone && <span style={{ fontSize: 10, color: T.text3 }}>{load.original_driver_phone}</span>}
            </div>
          )}
          <Field label="Tractor #" value={load.tractor_number} />
          <Field label="Trailer #" value={load.trailer_number || load.truck_trailer} />
          {load.checkin_time && <Field label="Check-In" value={fmtTime(load.checkin_time)} />}
          {load.checkout_time && <Field label="Check-Out" value={fmtTime(load.checkout_time)} />}
          {canEdit && (
            <button onClick={openChangeDriver} style={{
              marginTop: 10, padding: '6px 14px', background: T.orange + '18',
              color: T.orange, border: `1px solid ${T.orange}40`, borderRadius: 8,
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>Change Driver</button>
          )}
        </Card>
      </div>

      {load.special_instructions && (
        <Card title="Special Instructions">
          <p style={{ fontSize: 13, color: T.text2, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{load.special_instructions}</p>
        </Card>
      )}

      {/* Documents */}
      <div style={{ background: T.bg1, borderRadius: 14, padding: '16px 20px', marginTop: 14, border: `1px solid ${T.sep}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Documents</h3>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={uploadType} onChange={e => setUploadType(e.target.value)} style={{
                padding: '5px 10px', borderRadius: 8, fontSize: 12, background: T.bg2,
                border: `1px solid ${T.sep}`, color: T.text, cursor: 'pointer',
              }}>
                {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <button onClick={() => fileRef.current.click()} disabled={uploading} style={{
                padding: '6px 14px', background: T.blue, color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>{uploading ? 'Uploading…' : '+ Upload'}</button>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
            </div>
          )}
        </div>

        {docs.length === 0 ? (
          <div style={{ fontSize: 13, color: T.text3, padding: '12px 0' }}>No documents uploaded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {docs.map(doc => (
              <div key={doc.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: T.bg2, borderRadius: 10, gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: docTypeColor(doc.doc_type) + '22', color: docTypeColor(doc.doc_type),
                    flexShrink: 0, textTransform: 'uppercase',
                  }}>{doc.doc_type}</span>
                  <span style={{ fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.original_name}
                  </span>
                  <span style={{ fontSize: 11, color: T.text3, flexShrink: 0 }}>
                    {doc.uploaded_at?.slice(0,10)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => api.downloadDoc(doc.id, doc.original_name)} style={{
                    padding: '5px 12px', background: T.bg3, color: T.text, border: 'none',
                    borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}>Download</button>
                  {canEdit && (
                    <button onClick={() => handleDeleteDoc(doc.id)} style={{
                      padding: '5px 12px', background: T.red + '22', color: T.red, border: 'none',
                      borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detention Tracker */}
      {canEdit && (() => {
        const det = calcDetention(load.detention_start, load.detention_end, load.detention_rate ?? 65)
        return (
          <div style={{ background: T.bg1, borderRadius: 14, padding: '16px 20px', marginTop: 14, border: `1px solid ${T.sep}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Detention</h3>
                {det && <div style={{ fontSize: 12, color: T.orange, fontWeight: 700, marginTop: 4 }}>{det.hrs}h · ${det.charge.toLocaleString()} @ ${load.detention_rate ?? 65}/hr</div>}
              </div>
              <button onClick={() => setDetentionEdit(v => !v)} style={{
                padding: '5px 14px', background: T.orange + '20', color: T.orange,
                border: `1px solid ${T.orange}40`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>{detentionEdit ? 'Cancel' : load.detention_start ? 'Edit' : '+ Log Detention'}</button>
            </div>

            {!detentionEdit && load.detention_start && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>Detention Start</div>
                  <div style={{ fontSize: 13, color: T.text }}>{fmtTime(load.detention_start)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>Detention End</div>
                  <div style={{ fontSize: 13, color: T.text }}>{load.detention_end ? fmtTime(load.detention_end) : <span style={{ color: T.orange }}>In progress…</span>}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>Rate</div>
                  <div style={{ fontSize: 13, color: T.text }}>${load.detention_rate ?? 65}/hr</div>
                </div>
                {det && (
                  <div>
                    <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>Detention Charge</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: T.orange }}>${det.charge.toLocaleString()}</div>
                  </div>
                )}
              </div>
            )}

            {!detentionEdit && !load.detention_start && (
              <div style={{ fontSize: 13, color: T.text3 }}>No detention logged. Click to log if driver was delayed at pickup or delivery.</div>
            )}

            {detentionEdit && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>Detention Start</label>
                    <input type="datetime-local" value={detForm.detention_start}
                      onChange={e => setDetForm(f => ({ ...f, detention_start: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, color: T.text, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>Detention End</label>
                    <input type="datetime-local" value={detForm.detention_end}
                      onChange={e => setDetForm(f => ({ ...f, detention_end: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, color: T.text, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>Rate ($/hr)</label>
                    <input type="number" min="0" value={detForm.detention_rate}
                      onChange={e => setDetForm(f => ({ ...f, detention_rate: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, color: T.text, boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(() => {
                  const preview = calcDetention(detForm.detention_start, detForm.detention_end, Number(detForm.detention_rate) || 65)
                  return preview ? (
                    <div style={{ background: T.orange + '12', border: `1px solid ${T.orange}30`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: T.orange, fontWeight: 700 }}>
                      {preview.hrs} hours detained → Charge: ${preview.charge.toLocaleString()} (add to invoice)
                    </div>
                  ) : null
                })()}
                <button onClick={handleSaveDetention} disabled={savingDet} style={{
                  padding: '8px 20px', background: T.orange, color: '#fff', border: 'none',
                  borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                }}>{savingDet ? 'Saving…' : 'Save Detention'}</button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Change Driver modal */}
      {showChangeDriver && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setShowChangeDriver(false)}>
          <div style={{ background: T.bg1, borderRadius: 20, padding: 24, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${T.sep}` }}
            onClick={e => e.stopPropagation()}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text, margin: 0 }}>Change Driver</h2>
                <div style={{ fontSize: 12, color: T.text3, marginTop: 3 }}>
                  Load {load.broker_order || load.load_number || `#${load.id}`} · currently {load.driver_name || 'unassigned'}
                </div>
              </div>
              <button onClick={() => setShowChangeDriver(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>

            {/* Driver search */}
            <input
              value={driverSearch}
              onChange={e => setDriverSearch(e.target.value)}
              placeholder="Search driver by name…"
              autoFocus
              style={{
                width: '100%', padding: '10px 13px', background: T.bg2, border: `1px solid ${T.sep}`,
                borderRadius: 10, fontSize: 13, color: T.text, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
              }}
            />

            {/* Driver list */}
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 18, borderRadius: 10, border: `1px solid ${T.sep}` }}>
              {allDrivers
                .filter(d => d.id !== load.driver_id && (!driverSearch || d.full_name.toLowerCase().includes(driverSearch.toLowerCase())))
                .map((d, i, arr) => (
                  <div key={d.id} onClick={() => pickDriver(d)} style={{
                    padding: '11px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: selectedDriver?.id === d.id ? T.orange + '18' : 'transparent',
                    borderBottom: i < arr.length - 1 ? `1px solid ${T.sep}` : 'none',
                    borderLeft: selectedDriver?.id === d.id ? `3px solid ${T.orange}` : '3px solid transparent',
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{d.full_name}</div>
                      <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{d.phone || 'No phone'} · {d.company_name || 'Independent'}</div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: d.status === 'available' ? T.green + '20' : T.orange + '20',
                      color: d.status === 'available' ? T.green : T.orange,
                    }}>
                      {d.status === 'available' ? 'Available' : d.status === 'on_load' ? 'On Load' : d.status}
                    </span>
                  </div>
                ))
              }
              {allDrivers.filter(d => d.id !== load.driver_id && (!driverSearch || d.full_name.toLowerCase().includes(driverSearch.toLowerCase()))).length === 0 && (
                <div style={{ padding: 16, color: T.text3, fontSize: 13, textAlign: 'center' }}>No drivers found</div>
              )}
            </div>

            {/* Broker message — shown once a driver is picked */}
            {selectedDriver && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    Broker Change Notice
                  </div>
                  <button onClick={handleCopyBrokerMsg} style={{
                    padding: '4px 12px', background: msgCopied ? T.green + '20' : T.bg2,
                    color: msgCopied ? T.green : T.text2, border: `1px solid ${msgCopied ? T.green + '40' : T.sep}`,
                    borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  }}>{msgCopied ? '✓ Copied' : 'Copy'}</button>
                </div>
                <textarea
                  value={brokerMsg}
                  onChange={e => setBrokerMsg(e.target.value)}
                  rows={10}
                  style={{
                    width: '100%', padding: '12px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
                    borderRadius: 10, fontSize: 12, color: T.text, lineHeight: 1.7,
                    fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
                  Edit the message above if needed, copy it, then save the driver change.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowChangeDriver(false)} style={{
                padding: '10px 18px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`,
                borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 13,
              }}>Cancel</button>
              <button onClick={handleSaveDriverChange} disabled={!selectedDriver || savingDriver} style={{
                padding: '10px 22px', background: selectedDriver ? T.orange : T.bg2,
                color: selectedDriver ? '#fff' : T.text3, border: 'none',
                borderRadius: 10, cursor: selectedDriver ? 'pointer' : 'default',
                fontWeight: 700, fontSize: 13, opacity: savingDriver ? 0.7 : 1,
              }}>{savingDriver ? 'Saving…' : `Assign ${selectedDriver ? selectedDriver.full_name.split(' ')[0] : 'Driver'}`}</button>
            </div>
          </div>
        </div>
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

function docTypeColor(type) {
  if (type === 'Rate Con') return T.blue
  if (type === 'BOL') return T.orange
  if (type === 'POD') return T.green
  return T.purple
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
