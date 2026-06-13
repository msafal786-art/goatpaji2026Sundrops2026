import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const EMPTY = { name: '', mc_number: '', dot_number: '', address: '', phone: '', email: '' }

export default function Companies() {
  const [companies, setCompanies] = useState([])
  const [users, setUsers] = useState([])
  const [show, setShow] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [userForm, setUserForm] = useState({ username: '', password: '', full_name: '', email: '', phone: '', company_id: '', role: 'company_owner' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setCompanies(await api.companies())
    setUsers(await api.users())
  }

  function openNew() { setForm({ ...EMPTY }); setEditing(null); setShow(true); setError('') }
  function openEdit(c) { setForm({ ...EMPTY, ...c }); setEditing(c); setShow(true); setError('') }
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function setU(k, v) { setUserForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editing) {
        const updated = await api.updateCompany(editing.id, form)
        setCompanies(cs => cs.map(c => c.id === editing.id ? updated : c))
      } else {
        const created = await api.createCompany(form)
        setCompanies(cs => [...cs, created])
      }
      setShow(false)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function handleUserSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.createUser(userForm)
      setShowUser(false)
      setUserForm({ username: '', password: '', full_name: '', email: '', phone: '', company_id: '', role: 'company_owner' })
      await load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const mobile = useIsMobile()
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>Companies</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {!mobile && <button style={secBtn} onClick={() => { setShowUser(true); setError('') }}>+ Portal User</button>}
          <button style={primaryBtn} onClick={openNew}>+ Add</button>
          {mobile && <button style={secBtn} onClick={() => { setShowUser(true); setError('') }}>+ User</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {companies.map(c => {
          const owners = users.filter(u => u.company_id === c.id && u.role === 'company_owner')
          return (
            <div key={c.id} style={{ background: T.bg1, borderRadius: 14, padding: '18px 20px', border: `1px solid ${T.sep}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 10 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: T.text2, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {c.mc_number && <span style={{ color: T.text3 }}>MC# <span style={{ color: T.text2 }}>{c.mc_number}</span></span>}
                {c.dot_number && <span style={{ color: T.text3 }}>DOT# <span style={{ color: T.text2 }}>{c.dot_number}</span></span>}
                {c.phone && <span>{c.phone}</span>}
                {c.email && <span>{c.email}</span>}
                {c.address && <span style={{ color: T.text3 }}>{c.address}</span>}
              </div>
              {owners.length > 0 && (
                <div style={{ marginTop: 12, padding: '8px 10px', background: T.blue + '18', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.blue, marginBottom: 4 }}>Portal Access</div>
                  {owners.map(o => <div key={o.id} style={{ fontSize: 12, color: T.text2 }}>{o.full_name} ({o.username})</div>)}
                </div>
              )}
              <button style={{ ...smBtn, marginTop: 14 }} onClick={() => openEdit(c)}>Edit</button>
            </div>
          )
        })}
        {companies.length === 0 && <div style={{ color: T.text3, padding: 20 }}>No companies yet.</div>}
      </div>

      {show && (
        <div style={modalBg} onClick={() => setShow(false)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <ModalHeader title={editing ? 'Edit Company' : 'Add Company'} onClose={() => setShow(false)} />
            <form onSubmit={handleSubmit}>
              <FField label="Company Name *"><input style={inputS} required value={form.name} onChange={e => set('name', e.target.value)} /></FField>
              <Row>
                <FField label="MC #"><input style={inputS} value={form.mc_number} onChange={e => set('mc_number', e.target.value)} /></FField>
                <FField label="DOT #"><input style={inputS} value={form.dot_number} onChange={e => set('dot_number', e.target.value)} /></FField>
              </Row>
              <Row>
                <FField label="Phone"><input style={inputS} value={form.phone} onChange={e => set('phone', e.target.value)} /></FField>
                <FField label="Email"><input style={inputS} value={form.email} onChange={e => set('email', e.target.value)} /></FField>
              </Row>
              <FField label="Address"><input style={inputS} value={form.address} onChange={e => set('address', e.target.value)} /></FField>
              {error && <ErrMsg>{error}</ErrMsg>}
              <Footer>
                <button type="button" style={secBtn} onClick={() => setShow(false)}>Cancel</button>
                <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add'}</button>
              </Footer>
            </form>
          </div>
        </div>
      )}

      {showUser && (
        <div style={modalBg} onClick={() => setShowUser(false)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <ModalHeader title="Add Portal User" onClose={() => setShowUser(false)} />
            <form onSubmit={handleUserSubmit}>
              <Row>
                <FField label="Full Name *"><input style={inputS} required value={userForm.full_name} onChange={e => setU('full_name', e.target.value)} /></FField>
                <FField label="Role">
                  <select style={inputS} value={userForm.role} onChange={e => setU('role', e.target.value)}>
                    <option value="company_owner">Company Owner</option>
                    <option value="dispatcher">Dispatcher</option>
                  </select>
                </FField>
              </Row>
              <Row>
                <FField label="Username *"><input style={inputS} required value={userForm.username} onChange={e => setU('username', e.target.value)} /></FField>
                <FField label="Password *"><input style={inputS} required type="password" value={userForm.password} onChange={e => setU('password', e.target.value)} /></FField>
              </Row>
              <Row>
                <FField label="Company">
                  <select style={inputS} value={userForm.company_id} onChange={e => setU('company_id', e.target.value)}>
                    <option value="">None (dispatcher)</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </FField>
                <FField label="Phone"><input style={inputS} value={userForm.phone} onChange={e => setU('phone', e.target.value)} /></FField>
              </Row>
              <FField label="Email"><input style={inputS} value={userForm.email} onChange={e => setU('email', e.target.value)} /></FField>
              {error && <ErrMsg>{error}</ErrMsg>}
              <Footer>
                <button type="button" style={secBtn} onClick={() => setShowUser(false)}>Cancel</button>
                <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Create User'}</button>
              </Footer>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ModalHeader({ title, onClose }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text }}>{title}</h2>
      <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
    </div>
  )
}
function ErrMsg({ children }) {
  return <div style={{ color: T.red, fontSize: 12, margin: '10px 0', padding: '8px 10px', background: T.red + '18', borderRadius: 6 }}>{children}</div>
}
function Footer({ children }) {
  return <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>{children}</div>
}
function Row({ children }) { return <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>{children}</div> }
function FField({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 180, marginBottom: 12 }}>
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
const modalBox = { background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px', width: '100%', maxWidth: 500, border: `1px solid ${T.sep}`, maxHeight: '92vh', overflowY: 'auto' }
