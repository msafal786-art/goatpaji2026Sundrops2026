import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T } from '../theme.js'

const EMPTY = {
  company_id: '', load_number: '', broker_name: '', broker_order: '', broker_contact: '',
  broker_email: '', commodity: '', weight: '', miles: '', trailer_type: '', bol: '', rate: '',
  pickup_name: '', pickup_address: '', pickup_city: '', pickup_state: '', pickup_zip: '',
  pickup_date: '', pickup_time: '', pickup_phone: '', pickup_refs: '',
  delivery_name: '', delivery_address: '', delivery_city: '', delivery_state: '', delivery_zip: '',
  delivery_date: '', delivery_time: '', delivery_phone: '', delivery_refs: '',
  special_instructions: '', notes: '', driver_id: '', truck_id: ''
}

const EMPTY_STOP = { name: '', address: '', city: '', state: '', zip: '', date: '', time: '', phone: '', refs: '' }

export default function LoadForm({ load, onClose, onSave }) {
  const { user } = useAuth()
  const isAdmin = user.role === 'dispatcher' && !user.company_id && !user.allowed_company_ids
  const [form, setForm] = useState(load ? { ...EMPTY, ...load, driver_id: load.driver_id || '', truck_id: load.truck_id || '' } : { ...EMPTY })
  const [extraStops, setExtraStops] = useState(() => {
    if (!load?.extra_stops) return []
    try { return JSON.parse(load.extra_stops) } catch { return [] }
  })
  const [extraPickups, setExtraPickups] = useState(() => {
    if (!load?.extra_pickups) return []
    try { return JSON.parse(load.extra_pickups) } catch { return [] }
  })
  const [companies, setCompanies] = useState([])
  const [drivers, setDrivers] = useState([])
  const [trucks, setTrucks] = useState([])
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [parseError, setParseError] = useState('')
  const [dupWarning, setDupWarning] = useState(null) // { id, load_number, broker_name, created_at }
  const fileRef = useRef()
  const dupTimerRef = useRef()

  useEffect(() => {
    if (isAdmin) api.companies().then(setCompanies)
    api.drivers().then(setDrivers)
    api.trucks().then(setTrucks)
    // Auto-assign company for non-admin users
    if (!load && !isAdmin) {
      const cid = user.company_id ||
        (user.allowed_company_ids ? JSON.parse(user.allowed_company_ids)[0] : null)
      if (cid) setForm(f => ({ ...f, company_id: String(cid) }))
    }
  }, [])

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    // Real-time duplicate check on load_number field
    if (k === 'load_number' && !load) {
      clearTimeout(dupTimerRef.current)
      setDupWarning(null)
      if (v.trim().length > 2) {
        dupTimerRef.current = setTimeout(async () => {
          const res = await api.checkDuplicateLoad(v.trim())
          if (res.duplicate) setDupWarning(res.load)
        }, 600)
      }
    }
  }

  async function handleFileParse(e) {
    const file = e.target.files[0]
    if (!file) return
    setParsing(true)
    setParseError('')
    try {
      const data = await api.parseRateCon(file)
      setForm(f => ({
        ...f,
        load_number: data.load_number || f.load_number,
        broker_name: data.broker_name || f.broker_name,
        broker_order: data.broker_order || f.broker_order,
        broker_contact: data.broker_contact || f.broker_contact,
        broker_email: data.broker_email || f.broker_email,
        commodity: data.commodity || f.commodity,
        weight: data.weight || f.weight,
        miles: data.miles || f.miles,
        trailer_type: data.trailer_type || f.trailer_type,
        bol: data.bol || f.bol,
        rate: data.rate ? data.rate.replace(/[$,]/g, '') : f.rate,
        pickup_name: data.pickup_name || f.pickup_name,
        pickup_address: data.pickup_address || f.pickup_address,
        pickup_city: data.pickup_city || f.pickup_city,
        pickup_state: data.pickup_state || f.pickup_state,
        pickup_zip: data.pickup_zip || f.pickup_zip,
        pickup_date: data.pickup_date || f.pickup_date,
        pickup_time: data.pickup_time || f.pickup_time,
        pickup_phone: data.pickup_phone || f.pickup_phone,
        pickup_refs: data.pickup_refs || f.pickup_refs,
        delivery_name: data.delivery_name || f.delivery_name,
        delivery_address: data.delivery_address || f.delivery_address,
        delivery_city: data.delivery_city || f.delivery_city,
        delivery_state: data.delivery_state || f.delivery_state,
        delivery_zip: data.delivery_zip || f.delivery_zip,
        delivery_date: data.delivery_date || f.delivery_date,
        delivery_time: data.delivery_time || f.delivery_time,
        delivery_phone: data.delivery_phone || f.delivery_phone,
        delivery_refs: data.delivery_refs || f.delivery_refs,
        special_instructions: data.special_instructions || f.special_instructions,
      }))
      if (Array.isArray(data.extra_stops) && data.extra_stops.length > 0) {
        setExtraStops(data.extra_stops)
      }
      if (Array.isArray(data.extra_pickups) && data.extra_pickups.length > 0) {
        setExtraPickups(data.extra_pickups)
      }
      // After parse, check if this load number already exists
      if (data.load_number && !load) {
        const dup = await api.checkDuplicateLoad(data.load_number.trim())
        if (dup.duplicate) setDupWarning(dup.load)
      }
    } catch (err) {
      setParseError(err.message)
    } finally {
      setParsing(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, extra_stops: extraStops, extra_pickups: extraPickups }
      if (!payload.driver_id) payload.driver_id = null
      if (!payload.truck_id) payload.truck_id = null
      if (user.role === 'company_owner') payload.company_id = user.company_id

      // Driver requires a company
      if (payload.driver_id && !payload.company_id) {
        setError('A company must be selected when a driver is assigned.')
        setSaving(false)
        return
      }

      const saved = load ? await api.updateLoad(load.id, payload) : await api.createLoad(payload)
      onSave(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{load ? 'Edit Load' : 'Add Load'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
        </div>

        {/* PDF Parser */}
        <div style={{ background: T.blue + '18', border: `1.5px dashed ${T.blue}60`, borderRadius: 10, padding: '16px', marginBottom: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: T.text2, marginBottom: 8 }}>Upload Rate Confirmation PDF to auto-fill fields</div>
          <input type="file" accept=".pdf" ref={fileRef} onChange={handleFileParse} style={{ display: 'none' }} />
          <button type="button" style={{ padding: '8px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            onClick={() => fileRef.current.click()} disabled={parsing}>
            {parsing ? 'Reading PDF…' : 'Choose PDF'}
          </button>
          {parseError && <div style={{ color: T.red, fontSize: 12, marginTop: 8 }}>{parseError}</div>}
        </div>

        <form onSubmit={handleSubmit}>
          <Section title="Assign Driver & Truck">
            <Row>
              <Field label="Driver">
                <select style={inputS} value={form.driver_id} onChange={e => {
                  const dId = e.target.value
                  const driver = drivers.find(d => String(d.id) === dId)
                  setForm(f => ({
                    ...f,
                    driver_id: dId,
                    company_id: driver?.company_id ? String(driver.company_id) : f.company_id,
                  }))
                }}>
                  <option value="">Unassigned</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>{d.full_name} — {d.company_name}{d.status !== 'available' ? ` (${d.status})` : ''}</option>
                  ))}
                </select>
              </Field>
              <Field label="Truck / Trailer">
                <select style={inputS} value={form.truck_id} onChange={e => set('truck_id', e.target.value)}>
                  <option value="">None</option>
                  {trucks.map(t => (
                    <option key={t.id} value={t.id}>T:{t.tractor_number} / Tr:{t.trailer_number} — {t.company_name}{t.status !== 'available' ? ` (${t.status})` : ''}</option>
                  ))}
                </select>
              </Field>
            </Row>
          </Section>

          {isAdmin && (
            <Section title="Company">
              <Row>
                <Field label="Company *">
                  <select style={inputS} value={form.company_id} onChange={e => set('company_id', e.target.value)} required>
                    <option value="">Select company…</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              </Row>
            </Section>
          )}

          <Section title="Broker / Load Info">
            {dupWarning && (
              <div style={{
                margin: '0 0 12px', padding: '10px 14px', borderRadius: 10,
                background: '#ff9f0a22', border: '1px solid #ff9f0a66',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ff9f0a' }}>
                    ⚠ Load #{dupWarning.load_number} already exists
                  </div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                    {dupWarning.broker_name} · Built {dupWarning.created_at ? new Date(dupWarning.created_at).toLocaleDateString() : ''}
                  </div>
                </div>
                <a
                  href={`/loads/${dupWarning.id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, fontWeight: 700, color: '#ff9f0a', whiteSpace: 'nowrap', textDecoration: 'underline' }}
                >
                  View Load →
                </a>
              </div>
            )}
            <Row>
              <Field label="Load Number">
                <input
                  style={{ ...inputS, borderColor: dupWarning ? '#ff9f0a' : undefined }}
                  value={form.load_number}
                  onChange={e => set('load_number', e.target.value)}
                />
              </Field>
              <Field label="Broker Name"><input style={inputS} value={form.broker_name} onChange={e => set('broker_name', e.target.value)} /></Field>
              <Field label="Order #"><input style={inputS} value={form.broker_order} onChange={e => set('broker_order', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="Broker Contact"><input style={inputS} value={form.broker_contact} onChange={e => set('broker_contact', e.target.value)} /></Field>
              <Field label="Broker Email"><input style={inputS} value={form.broker_email} onChange={e => set('broker_email', e.target.value)} /></Field>
              <Field label="Rate ($)"><input style={inputS} value={form.rate} onChange={e => set('rate', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="Commodity"><input style={inputS} value={form.commodity} onChange={e => set('commodity', e.target.value)} /></Field>
              <Field label="Weight"><input style={inputS} value={form.weight} onChange={e => set('weight', e.target.value)} /></Field>
              <Field label="Miles"><input style={inputS} value={form.miles} onChange={e => set('miles', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="Trailer Type"><input style={inputS} value={form.trailer_type} onChange={e => set('trailer_type', e.target.value)} /></Field>
              <Field label="BOL #"><input style={inputS} value={form.bol} onChange={e => set('bol', e.target.value)} /></Field>
            </Row>
          </Section>

          <SectionWithAdd title="Pickup" label="+ Add Pick" onAdd={() => setExtraPickups(s => [...s, { ...EMPTY_STOP }])}>
            {extraPickups.length > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 8 }}>Pick 1</div>}
            <Row>
              <Field label="Shipper Name"><input style={inputS} value={form.pickup_name} onChange={e => set('pickup_name', e.target.value)} /></Field>
              <Field label="Address"><input style={inputS} value={form.pickup_address} onChange={e => set('pickup_address', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="City"><input style={inputS} value={form.pickup_city} onChange={e => set('pickup_city', e.target.value)} /></Field>
              <Field label="State"><input style={inputS} value={form.pickup_state} onChange={e => set('pickup_state', e.target.value)} /></Field>
              <Field label="ZIP"><input style={inputS} value={form.pickup_zip} onChange={e => set('pickup_zip', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="Date"><input style={inputS} placeholder="YYYY-MM-DD" value={form.pickup_date} onChange={e => set('pickup_date', e.target.value)} /></Field>
              <Field label="Time"><input style={inputS} value={form.pickup_time} onChange={e => set('pickup_time', e.target.value)} /></Field>
              <Field label="Phone"><input style={inputS} value={form.pickup_phone} onChange={e => set('pickup_phone', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="References (PU#, PO#, etc)"><input style={inputS} value={form.pickup_refs} onChange={e => set('pickup_refs', e.target.value)} /></Field>
            </Row>

            {extraPickups.map((pick, idx) => (
              <div key={idx} style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${T.sep}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text2 }}>Pick {idx + 2}</div>
                  <button type="button" onClick={() => setExtraPickups(s => s.filter((_, i) => i !== idx))}
                    style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    Remove
                  </button>
                </div>
                <Row>
                  <Field label="Shipper Name"><input style={inputS} value={pick.name} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} /></Field>
                  <Field label="Address"><input style={inputS} value={pick.address} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, address: e.target.value } : x))} /></Field>
                </Row>
                <Row>
                  <Field label="City"><input style={inputS} value={pick.city} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, city: e.target.value } : x))} /></Field>
                  <Field label="State"><input style={inputS} value={pick.state} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, state: e.target.value } : x))} /></Field>
                  <Field label="ZIP"><input style={inputS} value={pick.zip} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, zip: e.target.value } : x))} /></Field>
                </Row>
                <Row>
                  <Field label="Date"><input style={inputS} placeholder="YYYY-MM-DD" value={pick.date} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, date: e.target.value } : x))} /></Field>
                  <Field label="Time"><input style={inputS} value={pick.time} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, time: e.target.value } : x))} /></Field>
                  <Field label="Phone"><input style={inputS} value={pick.phone} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, phone: e.target.value } : x))} /></Field>
                </Row>
                <Row>
                  <Field label="References (PU#, PO#, etc)"><input style={inputS} value={pick.refs} onChange={e => setExtraPickups(s => s.map((x, i) => i === idx ? { ...x, refs: e.target.value } : x))} /></Field>
                </Row>
              </div>
            ))}

          </SectionWithAdd>

          <SectionWithAdd title="Delivery" label="+ Add Drop" onAdd={() => setExtraStops(s => [...s, { ...EMPTY_STOP }])}>
            {extraStops.length > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 8 }}>Drop 1</div>}
            <Row>
              <Field label="Consignee Name"><input style={inputS} value={form.delivery_name} onChange={e => set('delivery_name', e.target.value)} /></Field>
              <Field label="Address"><input style={inputS} value={form.delivery_address} onChange={e => set('delivery_address', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="City"><input style={inputS} value={form.delivery_city} onChange={e => set('delivery_city', e.target.value)} /></Field>
              <Field label="State"><input style={inputS} value={form.delivery_state} onChange={e => set('delivery_state', e.target.value)} /></Field>
              <Field label="ZIP"><input style={inputS} value={form.delivery_zip} onChange={e => set('delivery_zip', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="Date"><input style={inputS} placeholder="YYYY-MM-DD" value={form.delivery_date} onChange={e => set('delivery_date', e.target.value)} /></Field>
              <Field label="Time"><input style={inputS} value={form.delivery_time} onChange={e => set('delivery_time', e.target.value)} /></Field>
              <Field label="Phone"><input style={inputS} value={form.delivery_phone} onChange={e => set('delivery_phone', e.target.value)} /></Field>
            </Row>
            <Row>
              <Field label="References (PO#, AO#, etc)"><input style={inputS} value={form.delivery_refs} onChange={e => set('delivery_refs', e.target.value)} /></Field>
            </Row>

            {extraStops.map((stop, idx) => (
              <div key={idx} style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${T.sep}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text2 }}>Drop {idx + 2}</div>
                  <button type="button" onClick={() => setExtraStops(s => s.filter((_, i) => i !== idx))}
                    style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    Remove
                  </button>
                </div>
                <Row>
                  <Field label="Consignee Name"><input style={inputS} value={stop.name} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} /></Field>
                  <Field label="Address"><input style={inputS} value={stop.address} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, address: e.target.value } : x))} /></Field>
                </Row>
                <Row>
                  <Field label="City"><input style={inputS} value={stop.city} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, city: e.target.value } : x))} /></Field>
                  <Field label="State"><input style={inputS} value={stop.state} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, state: e.target.value } : x))} /></Field>
                  <Field label="ZIP"><input style={inputS} value={stop.zip} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, zip: e.target.value } : x))} /></Field>
                </Row>
                <Row>
                  <Field label="Date"><input style={inputS} placeholder="YYYY-MM-DD" value={stop.date} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, date: e.target.value } : x))} /></Field>
                  <Field label="Time"><input style={inputS} value={stop.time} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, time: e.target.value } : x))} /></Field>
                  <Field label="Phone"><input style={inputS} value={stop.phone} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, phone: e.target.value } : x))} /></Field>
                </Row>
                <Row>
                  <Field label="References (PO#, AO#, etc)"><input style={inputS} value={stop.refs} onChange={e => setExtraStops(s => s.map((x, i) => i === idx ? { ...x, refs: e.target.value } : x))} /></Field>
                </Row>
              </div>
            ))}

          </SectionWithAdd>

          <Section title="Special Instructions">
            <textarea style={{ ...inputS, width: '100%', height: 80, resize: 'vertical' }}
              value={form.special_instructions} onChange={e => set('special_instructions', e.target.value)}
              placeholder="Carrier instructions, requirements…" />
          </Section>

          <Section title="Internal Notes">
            <textarea style={{ ...inputS, width: '100%', height: 80, resize: 'vertical' }}
              value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Internal notes — not sent to driver…" />
          </Section>

          {error && <div style={{ color: T.red, fontSize: 13, marginBottom: 12, padding: '8px 12px', background: T.red + '18', borderRadius: 6 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {load && isAdmin && (
                <button type="button" disabled={saving} onClick={async () => {
                  if (!confirm(`Delete this load? This cannot be undone.`)) return
                  setSaving(true)
                  try { await api.deleteLoad(load.id); onSave() }
                  catch (err) { setError(err.message); setSaving(false) }
                }} style={{ padding: '10px 16px', background: T.red + '15', color: T.red, border: `1px solid ${T.red}40`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  Delete Load
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" style={secBtn} onClick={onClose}>Cancel</button>
              <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : load ? 'Update Load' : 'Create Load'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.sep}` }}>{title}</div>
      {children}
    </div>
  )
}

function SectionWithAdd({ title, children, label, onAdd }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.sep}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>
        <button type="button" onClick={onAdd} style={{ padding: '4px 12px', background: T.blue, color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
          {label}
        </button>
      </div>
      {children}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>{children}</div>
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const inputS = { width: '100%', padding: '9px 11px', border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' }
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, overflowY: 'auto' }
const modalBox = { background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px', width: '100%', maxWidth: 700, border: `1px solid ${T.sep}`, maxHeight: '94vh', overflowY: 'auto' }
const primaryBtn = { padding: '10px 22px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 14 }
const secBtn = { padding: '10px 18px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 14 }
