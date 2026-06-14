import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const EMPTY = {
  full_name: '', phone: '', email: '', address: '', date_of_birth: '',
  hire_date: '', status: 'available', company_id: '',
  cdl_class: '', license_state: '', license_number: '', license_expiry: '',
  medical_card_expiry: '', drug_test_date: '', background_check_date: '',
  emergency_contact_name: '', emergency_contact_phone: '',
  notes: '', username: '', password: '',
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr + 'T00:00') - new Date()) / 864e5)
}

function ExpiryBadge({ date }) {
  if (!date) return null
  const days = daysUntil(date)
  const color = days < 0 ? T.red : days <= 30 ? T.orange : days <= 90 ? '#ff9f0a' : T.green
  const label = days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `${days}d left`
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '15', padding: '2px 6px', borderRadius: 4, marginLeft: 6 }}>
      {label}
    </span>
  )
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
  const [search, setSearch] = useState('')

  useEffect(() => {
    load()
    if (user.role === 'dispatcher') api.companies().then(setCompanies)
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  async function load() { setDrivers(await api.drivers()) }

  function openNew() { setForm({ ...EMPTY }); setEditing(null); setShow(true); setError('') }
  function openEdit(d) {
    setForm({ ...EMPTY, ...d, password: '', username: d.username || '' })
    setEditing(d); setShow(true); setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (editing) {
        // If password filled in: create or reset login
        if (form.password) {
          if (!editing.user_id) {
            if (!form.username) { setError('Username required to create login'); setSaving(false); return }
            await api.createDriverLogin(editing.id, form.username, form.password)
          } else {
            await api.resetDriverPassword(editing.id, form.password)
          }
        }
        const updated = await api.updateDriver(editing.id, form)
        setDrivers(ds => ds.map(d => d.id === editing.id ? { ...updated, user_id: form.password && !editing.user_id ? 1 : d.user_id } : d))
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

  async function handleToggleActive(id) {
    const res = await api.toggleDriverActive(id)
    setDrivers(ds => ds.map(d => d.id === id ? { ...d, is_active: res.is_active } : d))
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const mobile = useIsMobile()
  const isAdmin = user.role === 'dispatcher' && !user.company_id

  const filtered = drivers.filter(d =>
    !search || d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (d.company_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>Drivers</h1>
        <button style={primaryBtn()} onClick={openNew}>+ Add Driver</button>
      </div>

      <input
        style={{ ...inputS(), marginBottom: 14, maxWidth: 320 }}
        placeholder="Search by name or company…"
        value={search} onChange={e => setSearch(e.target.value)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
        {filtered.map(d => {
          const sc = STATUS[d.status] || STATUS.available
          const isDisabled = d.is_active === 0
          const licDays = daysUntil(d.license_expiry)
          const medDays = daysUntil(d.medical_card_expiry)
          const hasAlert = (licDays !== null && licDays <= 60) || (medDays !== null && medDays <= 60)
          return (
            <div key={d.id} style={{
              background: T.bg1, borderRadius: 14, padding: '15px 18px',
              border: `1px solid ${hasAlert && !isDisabled ? T.orange + '60' : T.sep}`,
              opacity: isDisabled ? 0.55 : 1,
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: T.text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {d.full_name}
                    {isDisabled && <span style={{ fontSize: 10, fontWeight: 700, color: T.orange, background: T.orange + '20', padding: '2px 8px', borderRadius: 20 }}>DISABLED</span>}
                    {d.user_id && <span style={{ fontSize: 10, fontWeight: 700, color: T.green, background: T.green + '15', padding: '2px 7px', borderRadius: 20 }}>Portal</span>}
                  </div>
                  <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>{d.company_name}</div>
                </div>
                {!isDisabled && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: sc.color, background: sc.color + '20', padding: '3px 9px', borderRadius: 20, flexShrink: 0 }}>
                    {sc.label}
                  </span>
                )}
              </div>

              {/* Info */}
              <div style={{ fontSize: 12, color: T.text2, display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
                {d.phone && <span>{d.phone}</span>}
                {d.email && <span style={{ color: T.text3 }}>{d.email}</span>}
                {d.hire_date && <span style={{ color: T.text3 }}>Hired {d.hire_date}</span>}
                {d.cdl_class && <span>CDL Class {d.cdl_class}{d.license_state ? ` · ${d.license_state}` : ''}</span>}
                {d.license_number && (
                  <span>
                    Lic: {d.license_number}
                    {d.license_expiry && <><span style={{ color: T.text3 }}> · exp {d.license_expiry}</span><ExpiryBadge date={d.license_expiry} /></>}
                  </span>
                )}
                {d.medical_card_expiry && (
                  <span>
                    Med Card exp {d.medical_card_expiry}<ExpiryBadge date={d.medical_card_expiry} />
                  </span>
                )}
                {d.drug_test_date && <span style={{ color: T.text3 }}>Drug test {d.drug_test_date}</span>}
                {d.emergency_contact_name && <span style={{ color: T.text3 }}>Emergency: {d.emergency_contact_name} {d.emergency_contact_phone}</span>}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!isDisabled && <button style={smBtn()} onClick={() => openEdit(d)}>Edit</button>}
                <button style={smBtn(isDisabled ? T.green : T.red)} onClick={() => handleToggleActive(d.id)}>
                  {isDisabled ? 'Enable' : 'Disable'}
                </button>
                {isAdmin && <button style={smBtn(T.red)} onClick={() => handleDelete(d.id)}>Remove</button>}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && <div style={{ color: T.text3, padding: 20 }}>No drivers found.</div>}
      </div>

      {/* Add / Edit form */}
      {show && (
        <div style={modalBg()} onClick={() => setShow(false)}>
          <div style={modalBox()} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{editing ? 'Edit Driver' : 'Add Driver'}</h2>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>

              {/* ── Personal ── */}
              <Section label="Personal Info">
                <Row>
                  <FField label="Full Name *"><input style={inputS()} required value={form.full_name} onChange={e => set('full_name', e.target.value)} /></FField>
                  <FField label="Date of Birth"><input style={inputS()} type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></FField>
                </Row>
                <Row>
                  <FField label="Phone"><input style={inputS()} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></FField>
                  <FField label="Email"><input style={inputS()} type="email" value={form.email} onChange={e => set('email', e.target.value)} /></FField>
                </Row>
                <FField label="Home Address" style={{ marginBottom: 12 }}>
                  <input style={inputS()} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street, City, State, ZIP" />
                </FField>
              </Section>

              {/* ── Employment ── */}
              <Section label="Employment">
                <Row>
                  {user.role === 'dispatcher' && (
                    <FField label="Company">
                      <select style={inputS()} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
                        <option value="">Select…</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </FField>
                  )}
                  <FField label="Hire Date"><input style={inputS()} type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} /></FField>
                  {editing && (
                    <FField label="Status">
                      <select style={inputS()} value={form.status} onChange={e => set('status', e.target.value)}>
                        <option value="available">Available</option>
                        <option value="on_load">On Load</option>
                        <option value="off_duty">Off Duty</option>
                      </select>
                    </FField>
                  )}
                </Row>
              </Section>

              {/* ── Compliance / Licensing ── */}
              <Section label="Licensing & Compliance">
                <Row>
                  <FField label="CDL Class">
                    <select style={inputS()} value={form.cdl_class} onChange={e => set('cdl_class', e.target.value)}>
                      <option value="">Select…</option>
                      {['A','B','C'].map(c => <option key={c} value={c}>Class {c}</option>)}
                    </select>
                  </FField>
                  <FField label="License State"><input style={inputS()} value={form.license_state} onChange={e => set('license_state', e.target.value)} placeholder="e.g. CA" maxLength={2} /></FField>
                  <FField label="License #"><input style={inputS()} value={form.license_number} onChange={e => set('license_number', e.target.value)} /></FField>
                </Row>
                <Row>
                  <FField label="License Expiry"><input style={inputS()} type="date" value={form.license_expiry} onChange={e => set('license_expiry', e.target.value)} /></FField>
                  <FField label="Med Card Expiry"><input style={inputS()} type="date" value={form.medical_card_expiry} onChange={e => set('medical_card_expiry', e.target.value)} /></FField>
                </Row>
                <Row>
                  <FField label="Drug Test Date"><input style={inputS()} type="date" value={form.drug_test_date} onChange={e => set('drug_test_date', e.target.value)} /></FField>
                  <FField label="Background Check Date"><input style={inputS()} type="date" value={form.background_check_date} onChange={e => set('background_check_date', e.target.value)} /></FField>
                </Row>
              </Section>

              {/* ── Emergency Contact ── */}
              <Section label="Emergency Contact">
                <Row>
                  <FField label="Name"><input style={inputS()} value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} /></FField>
                  <FField label="Phone"><input style={inputS()} type="tel" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} /></FField>
                </Row>
              </Section>

              {/* ── Portal Login ── */}
              <Section label={editing?.user_id ? 'Portal Login (Reset Password)' : 'Portal Login'}>
                <div style={{ fontSize: 12, color: T.text3, marginBottom: 10 }}>
                  {editing?.user_id
                    ? 'Driver already has a portal login. Enter a new password below to reset it, or leave blank to keep current.'
                    : 'Give the driver a login to access their loads at goatpaji.com. Leave blank to skip.'}
                </div>
                <Row>
                  {!editing?.user_id && (
                    <FField label="Username">
                      <input style={inputS()} value={form.username} onChange={e => set('username', e.target.value)}
                        placeholder="e.g. rahul.bhatia" autoComplete="off" />
                    </FField>
                  )}
                  {editing?.user_id && (
                    <FField label="Current Username">
                      <input style={{ ...inputS(), opacity: 0.5 }} value={editing.username || '(set)'} readOnly />
                    </FField>
                  )}
                  <FField label={editing?.user_id ? 'New Password' : 'Password'}>
                    <input style={inputS()} type="password" value={form.password} onChange={e => set('password', e.target.value)}
                      placeholder={editing?.user_id ? 'Leave blank to keep' : 'Min 8 characters'} autoComplete="new-password" />
                  </FField>
                </Row>
              </Section>

              {/* ── Notes ── */}
              <FField label="Notes">
                <textarea style={{ ...inputS(), height: 64, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </FField>

              {error && <div style={{ color: T.red, fontSize: 12, margin: '12px 0', padding: '9px 12px', background: T.red + '12', borderRadius: 8 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button type="button" style={secBtn()} onClick={() => setShow(false)}>Cancel</button>
                <button type="submit" style={primaryBtn()} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Driver'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.sep}` }}>{label}</div>
      {children}
    </div>
  )
}

function Row({ children }) { return <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>{children}</div> }

function FField({ label, children, style: extraStyle }) {
  return (
    <div style={{ flex: 1, minWidth: 140, ...extraStyle }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const primaryBtn = () => ({ padding: '10px 20px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 })
const secBtn    = () => ({ padding: '10px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 })
const smBtn     = (color) => ({ padding: '6px 12px', background: color ? color + '15' : T.bg2, color: color || T.text2, border: `1px solid ${color ? color + '40' : T.sep}`, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 })
const inputS    = () => ({ width: '100%', padding: '9px 11px', border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' })
const modalBg   = () => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '20px 0 0' })
const modalBox  = () => ({ background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px 24px 32px', width: '100%', maxWidth: 620, border: `1px solid ${T.sep}`, maxHeight: '94vh', overflowY: 'auto' })
