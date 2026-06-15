import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T } from '../theme.js'

const EMPTY = { username: '', password: '', full_name: '', email: '', phone: '', role: 'dispatcher', company_id: '', can_see_revenue: false, allowed_company_ids: [] }
const ROLES = [
  { value: 'dispatcher',    label: 'Dispatcher' },
  { value: 'company_owner', label: 'Company Owner' },
]

function timeAgo(iso) {
  if (!iso) return 'Never'
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 90)    return 'Just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function Users() {
  const { user: me } = useAuth()
  const isAdmin = me.role === 'dispatcher' && !me.company_id && !me.allowed_company_ids
  const [users, setUsers] = useState([])
  const [companies, setCompanies] = useState([])
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [us, cs] = await Promise.all([api.users(), api.companies()])
    setUsers(us)
    setCompanies(cs)
  }

  function openNew() { setForm({ ...EMPTY }); setEditing(null); setShow(true); setError('') }
  function openEdit(u) {
    setForm({
      ...EMPTY, ...u, password: '', can_see_revenue: !!u.can_see_revenue,
      allowed_company_ids: u.allowed_company_ids ? JSON.parse(u.allowed_company_ids) : []
    });
    setEditing(u); setShow(true); setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        // Only send allowed_company_ids for dispatchers; clear it otherwise
        allowed_company_ids: form.role === 'dispatcher' ? form.allowed_company_ids : [],
      }
      if (editing) {
        const updated = await api.updateUser(editing.id, payload)
        setUsers(us => us.map(u => u.id === editing.id ? updated : u))
      } else {
        const created = await api.createUser(payload)
        setUsers(us => [created, ...us])
      }
      setShow(false)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(u) {
    if (!confirm(`Remove user "${u.username}"? This cannot be undone.`)) return
    await api.deleteUser(u.id)
    setUsers(us => us.filter(x => x.id !== u.id))
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const inp = () => ({ width: '100%', padding: '9px 11px', border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' })
  const lbl = () => ({ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 })

  // Group by company
  const grouped = {}
  for (const u of users) {
    const key = u.company_name || '— Admin / No Company'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(u)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: -0.4, margin: 0 }}>Portal Users</h1>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>Dispatcher and company owner accounts</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={async () => {
            const pw = window.prompt('Set temporary password for ALL users (except admin):', 'waheguru')
            if (!pw) return
            if (!window.confirm(`Reset ALL user passwords to "${pw}"? They will be forced to change it on next login.`)) return
            setResetting(true)
            try { await api.resetAllPasswords(pw); alert('Done — all users must change password on next login.') }
            catch (err) { alert(err.message) }
            finally { setResetting(false); load() }
          }} style={{ padding: '9px 16px', background: T.orange + '20', color: T.orange, border: `1px solid ${T.orange}50`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            {resetting ? 'Resetting…' : '🔑 Reset All Passwords'}
          </button>
          <button onClick={openNew} style={{ padding: '9px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            + Add User
          </button>
        </div>
      </div>

      {Object.entries(grouped).map(([company, members]) => (
        <div key={company} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.sep}` }}>
            {company} ({members.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.map(u => {
              const isMe = u.id === me.id
              const roleLabel = u.role === 'company_owner' ? 'Company Owner' : u.company_id ? 'Dispatcher' : 'Admin Dispatcher'
              const lastSeen = timeAgo(u.last_seen_at)
              const isOnline = u.last_seen_at && (Date.now() - new Date(u.last_seen_at)) < 5 * 60 * 1000
              return (
                <div key={u.id} style={{ background: T.bg1, borderRadius: 12, padding: '14px 18px', border: `1px solid ${T.sep}`, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  {/* Avatar circle */}
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: T.blue + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: T.blue }}>
                      {(u.full_name || u.username).charAt(0).toUpperCase()}
                    </span>
                    {isAdmin && isOnline && (
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: T.green, border: `2px solid ${T.bg1}` }} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{u.full_name || u.username}</span>
                      {isMe && <span style={{ fontSize: 10, fontWeight: 700, color: T.blue, background: T.blue + '20', padding: '2px 7px', borderRadius: 20 }}>You</span>}
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.text3, background: T.bg2, padding: '2px 8px', borderRadius: 20 }}>
                        {u.role === 'company_owner' ? 'Company Owner' : u.allowed_company_ids ? 'Scoped Dispatcher' : u.company_id ? 'Dispatcher' : 'Admin Dispatcher'}
                      </span>
                      {u.can_see_revenue === 1 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: T.green, background: T.green + '15', padding: '2px 8px', borderRadius: 20 }}>Sees Revenue</span>
                      )}
                      {u.allowed_company_ids && (() => {
                        const ids = JSON.parse(u.allowed_company_ids)
                        const names = ids.map(id => companies.find(c => c.id === id)?.name || id).join(', ')
                        return <span title={names} style={{ fontSize: 10, color: T.orange, background: T.orange + '18', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                          {ids.length} {ids.length === 1 ? 'company' : 'companies'}
                        </span>
                      })()}
                    </div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>
                      @{u.username}{u.email ? ` · ${u.email}` : ''}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {isAdmin && (
                      <div style={{ fontSize: 11, color: isOnline ? T.green : T.text3, fontWeight: isOnline ? 700 : 400 }}>
                        {isOnline ? 'Online now' : lastSeen}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => openEdit(u)} style={{ padding: '5px 12px', background: T.bg2, border: `1px solid ${T.sep}`, color: T.text2, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
                      {!isMe && (
                        <button onClick={() => handleDelete(u)} style={{ padding: '5px 12px', background: T.red + '15', border: `1px solid ${T.red}40`, color: T.red, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {users.length === 0 && <div style={{ color: T.text3, padding: 20 }}>No users yet.</div>}

      {/* Modal */}
      {show && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: '20px 0 0' }}
          onClick={() => setShow(false)}>
          <div style={{ background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px 24px 32px', width: '100%', maxWidth: 520, border: `1px solid ${T.sep}`, maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>{editing ? 'Edit User' : 'Add Portal User'}</h2>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl()}>Full Name</label>
                  <input style={inp()} value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Ahmed Khan" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl()}>Username *</label>
                  <input style={inp()} required value={form.username} onChange={e => set('username', e.target.value)}
                    placeholder="ahmed.khan" autoComplete="off"
                    readOnly={!!editing}
                    onFocus={e => editing && e.target.removeAttribute('readonly')} />
                  {editing && <div style={{ fontSize: 10, color: T.text3, marginTop: 3 }}>Click to change username</div>}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl()}>{editing ? 'New Password' : 'Password *'}</label>
                  <input style={inp()} type="password" value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder={editing ? 'Leave blank to keep' : 'Min 8 characters'}
                    required={!editing} autoComplete="new-password" />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={lbl()}>Role *</label>
                <select style={inp()} value={form.role} onChange={e => set('role', e.target.value)}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {form.role === 'company_owner' ? (
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl()}>Company *</label>
                  <select style={inp()} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
                    <option value="">Select company…</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : (
                <div style={{ background: T.bg2, borderRadius: 10, padding: '14px 16px', marginBottom: 12, border: `1px solid ${T.sep}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>Company Access</div>
                  <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
                    Check the companies this dispatcher can see. Leave all unchecked for full admin access.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {companies.map(c => {
                      const checked = (form.allowed_company_ids || []).includes(c.id)
                      return (
                        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', background: checked ? T.blue + '15' : 'transparent', border: `1px solid ${checked ? T.blue + '40' : 'transparent'}` }}>
                          <input type="checkbox" checked={checked}
                            onChange={e => {
                              const ids = form.allowed_company_ids || []
                              set('allowed_company_ids', e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))
                            }}
                            style={{ accentColor: T.blue }}
                          />
                          <span style={{ fontSize: 12, color: checked ? T.blue : T.text, fontWeight: checked ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        </label>
                      )
                    })}
                  </div>
                  {(form.allowed_company_ids || []).length === 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: T.orange, fontWeight: 600 }}>No companies selected → Full admin access to all companies</div>
                  )}
                  {(form.allowed_company_ids || []).length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: T.blue, fontWeight: 600 }}>
                      Access limited to {(form.allowed_company_ids || []).length} {(form.allowed_company_ids || []).length === 1 ? 'company' : 'companies'}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl()}>Email</label>
                  <input style={inp()} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl()}>Phone</label>
                  <input style={inp()} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
              </div>

              {/* Revenue visibility */}
              <div style={{ background: T.bg2, borderRadius: 10, padding: '14px 16px', marginBottom: 16, border: `1px solid ${T.sep}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Revenue Access</div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                      {form.role === 'company_owner'
                        ? 'Company owners always see revenue — this toggle has no effect.'
                        : (form.allowed_company_ids || []).length > 0
                          ? 'Allow this dispatcher to see revenue totals on the dashboard.'
                          : 'Admin dispatchers always see revenue.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={form.role === 'company_owner' || (form.allowed_company_ids || []).length === 0}
                    onClick={() => set('can_see_revenue', !form.can_see_revenue)}
                    style={{
                      width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                      background: (form.can_see_revenue || form.role === 'company_owner' || (form.allowed_company_ids || []).length === 0) ? T.green : T.bg3,
                      position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: (form.can_see_revenue || form.role === 'company_owner' || (form.allowed_company_ids || []).length === 0) ? 21 : 3,
                      width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                    }} />
                  </button>
                </div>
              </div>

              {error && <div style={{ color: T.red, fontSize: 12, marginBottom: 12, padding: '9px 12px', background: T.red + '12', borderRadius: 8 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShow(false)} style={{ padding: '10px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ padding: '10px 20px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
