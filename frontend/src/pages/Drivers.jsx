import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'
import { T, STATUS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const EMPTY = {
  full_name: '', phone: '', email: '', license_number: '', license_expiry: '',
  medical_card_expiry: '', notes: '', company_id: '', status: 'available',
  username: '', password: ''
}

export default function Drivers() {
  const { user } = useAuth()
  const [drivers, setDrivers] = useState([])
  const [companies, setCompanies] = useState([])
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
    if (user.role === 'dispatcher') api.companies().then(setCompanies)
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [])

  async function load() { setDrivers(await api.drivers()) }
  function openNew() { setForm({ ...EMPTY }); setEditing(null); setShow(true); setError('') }
  function openEdit(d) { setForm({ ...EMPTY, ...d, password: '', username: '' }); setEditing(d); setShow(true); setError('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editing) {
        const updated = await api.updateDriver(editing.id, form)
        setDrivers(ds => ds.map(d => d.id === editing.id ? updated : d))
      } else {
        const created = await api.createDriver(form)
        setDrivers(ds => [created, ...ds])
      }
      setShow(false)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this driver?')) return
    await api.deleteDriver(id)
    setDrivers(ds => ds.filter(d => d.id !== id))
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const mobile = useIsMobile()
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>Drivers</h1>
        <button style={primaryBtn} onClick={openNew}>+ Add</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {drivers.map(d => {
          const sc = STATUS[d.status] || STATUS.available
          return (
            <div key={d.id} style={{ background: T.bg1, borderRadius: 14, padding: '16px 18px', border: `1px solid ${T.sep}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>{d.full_name}</div>
                  <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>{d.company_name}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: sc.color, background: sc.color + '22', padding: '3px 9px', borderRadius: 20, textTransform: 'capitalize' }}>
                  {sc.label}
                </span>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: T.text2, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {d.phone && <span>{d.phone}</span>}
                {d.email && <span>{d.email}</span>}
                {d.license_number && <span>CDL: {d.license_number}{d.license_expiry ? ` · exp ${d.license_expiry}` : ''}</span>}
                {d.medical_card_expiry && <span>Medical exp: {d.medical_card_expiry}</span>}
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button style={smBtn} onClick={() => openEdit(d)}>Edit</button>
                {user.role === 'dispatcher' && (
                  <button style={{ ...smBtn, color: T.red, borderColor: T.red + '40' }} onClick={() => handleDelete(d.id)}>Remove</button>
                )}
              </div>
            </div>
          )
        })}
        {drivers.length === 0 && <div style={{ color: T.text3, padding: 20 }}>No drivers yet.</div>}
      </div>

      {show && (
        <div style={modalBg} onClick={() => setShow(false)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text }}>{editing ? 'Edit Driver' : 'Add Driver'}</h2>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <Row>
                <FField label="Full Name *"><input style={inputS} required value={form.full_name} onChange={e => set('full_name', e.target.value)} /></FField>
                <FField label="Phone"><input style={inputS} value={form.phone} onChange={e => set('phone', e.target.value)} /></FField>
              </Row>
              <Row>
                <FField label="Email"><input style={inputS} value={form.email} onChange={e => set('email', e.target.value)} /></FField>
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
                <FField label="License #"><input style={inputS} value={form.license_number} onChange={e => set('license_number', e.target.value)} /></FField>
                <FField label="License Expiry"><input style={inputS} type="date" value={form.license_expiry} onChange={e => set('license_expiry', e.target.value)} /></FField>
                <FField label="Med Card Expiry"><input style={inputS} type="date" value={form.medical_card_expiry} onChange={e => set('medical_card_expiry', e.target.value)} /></FField>
              </Row>
              {editing && (
                <Row>
                  <FField label="Status">
                    <select style={inputS} value={form.status} onChange={e => set('status', e.target.value)}>
                      <option value="available">Available</option>
                      <option value="on_load">On Load</option>
                      <option value="off_duty">Off Duty</option>
                    </select>
                  </FField>
                </Row>
              )}
              {!editing && (
                <div style={{ background: T.bg2, padding: 14, borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text3, marginBottom: 8 }}>Driver Login (optional)</div>
                  <Row>
                    <FField label="Username"><input style={inputS} value={form.username} onChange={e => set('username', e.target.value)} /></FField>
                    <FField label="Password"><input style={inputS} type="password" value={form.password} onChange={e => set('password', e.target.value)} /></FField>
                  </Row>
                </div>
              )}
              <FField label="Notes"><textarea style={{ ...inputS, height: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} /></FField>
              {error && <div style={{ color: T.red, fontSize: 12, margin: '10px 0', padding: '8px 10px', background: T.red + '18', borderRadius: 6 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" style={secBtn} onClick={() => setShow(false)}>Cancel</button>
                <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add Driver'}</button>
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
const modalBox = { background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px', width: '100%', maxWidth: 560, border: `1px solid ${T.sep}`, maxHeight: '92vh', overflowY: 'auto' }
