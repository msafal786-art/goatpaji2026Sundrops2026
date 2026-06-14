import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const EMPTY = {
  tractor_number: '', trailer_number: '', trailer_type: '53 ft. Van', vin: '',
  plate: '', registration_expiry: '', insurance_expiry: '', notes: '', company_id: '', status: 'available'
}

export default function Trucks() {
  const { user } = useAuth()
  const [trucks, setTrucks] = useState([])
  const [companies, setCompanies] = useState([])
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
    if (user.role === 'dispatcher') api.companies().then(setCompanies)
  }, [])

  async function load() { setTrucks(await api.trucks()) }
  function openNew() { setForm({ ...EMPTY }); setEditing(null); setShow(true); setError('') }
  function openEdit(t) { setForm({ ...EMPTY, ...t }); setEditing(t); setShow(true); setError('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editing) {
        const updated = await api.updateTruck(editing.id, form)
        setTrucks(ts => ts.map(t => t.id === editing.id ? updated : t))
      } else {
        const created = await api.createTruck(form)
        setTrucks(ts => [created, ...ts])
      }
      setShow(false)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this truck?')) return
    await api.deleteTruck(id)
    setTrucks(ts => ts.filter(t => t.id !== id))
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const mobile = useIsMobile()
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>Trucks & Trailers</h1>
        <button style={primaryBtn} onClick={openNew}>+ Add</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {trucks.map(t => {
          const sc = STATUS[t.status] || STATUS.available
          return (
            <div key={t.id} style={{ background: T.bg1, borderRadius: 14, padding: '16px 18px', border: `1px solid ${T.sep}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Tractor #{t.tractor_number}</div>
                  <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>Trailer #{t.trailer_number} — {t.trailer_type}</div>
                  <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{t.company_name}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: sc.color, background: sc.color + '22', padding: '3px 9px', borderRadius: 20 }}>
                  {sc.label}
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: T.text2, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {t.plate && <span>Plate: {t.plate}</span>}
                {t.registration_expiry && <span>Reg exp: {t.registration_expiry}</span>}
                {t.insurance_expiry && <span>Ins exp: {t.insurance_expiry}</span>}
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button style={smBtn} onClick={() => openEdit(t)}>Edit</button>
                {user.role === 'dispatcher' && (
                  <button style={{ ...smBtn, color: T.red, borderColor: T.red + '40' }} onClick={() => handleDelete(t.id)}>Remove</button>
                )}
              </div>
            </div>
          )
        })}
        {trucks.length === 0 && <div style={{ color: T.text3, padding: 20 }}>No trucks yet.</div>}
      </div>

      {show && (
        <div style={modalBg} onClick={() => setShow(false)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text }}>{editing ? 'Edit Truck' : 'Add Truck'}</h2>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <Row>
                <FField label="Tractor # *"><input style={inputS} required value={form.tractor_number} onChange={e => set('tractor_number', e.target.value)} /></FField>
                <FField label="Trailer #"><input style={inputS} value={form.trailer_number} onChange={e => set('trailer_number', e.target.value)} /></FField>
                <FField label="Trailer Type"><input style={inputS} value={form.trailer_type} onChange={e => set('trailer_type', e.target.value)} /></FField>
              </Row>
              <Row>
                <FField label="Plate"><input style={inputS} value={form.plate} onChange={e => set('plate', e.target.value)} /></FField>
                <FField label="VIN"><input style={inputS} value={form.vin} onChange={e => set('vin', e.target.value)} /></FField>
                {user.role === 'dispatcher' && (
                  <FField label="Company">
                    <select style={inputS} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
                      <option value="">Select…</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </FField>
                )}
              </Row>
              <Row>
                <FField label="Registration Expiry"><input style={inputS} type="date" value={form.registration_expiry} onChange={e => set('registration_expiry', e.target.value)} /></FField>
                <FField label="Insurance Expiry"><input style={inputS} type="date" value={form.insurance_expiry} onChange={e => set('insurance_expiry', e.target.value)} /></FField>
              </Row>
              {editing && (
                <Row>
                  <FField label="Status">
                    <select style={inputS} value={form.status} onChange={e => set('status', e.target.value)}>
                      <option value="available">Available</option>
                      <option value="on_load">On Load</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </FField>
                </Row>
              )}
              <FField label="Notes"><textarea style={{ ...inputS, height: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} /></FField>
              {error && <div style={{ color: T.red, fontSize: 12, margin: '10px 0' }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" style={secBtn} onClick={() => setShow(false)}>Cancel</button>
                <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add Truck'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ children }) { return <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>{children}</div> }
function FField({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 150 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const primaryBtn = { padding: '9px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
const secBtn = { padding: '9px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
const smBtn = { padding: '6px 12px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const inputS = { width: '100%', padding: '9px 11px', border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' }
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, overflowY: 'auto' }
const modalBox = { background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px', width: '100%', maxWidth: 540, border: `1px solid ${T.sep}`, maxHeight: '92vh', overflowY: 'auto' }
