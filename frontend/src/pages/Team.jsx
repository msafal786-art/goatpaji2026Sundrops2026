import React, { useState, useEffect } from 'react'
import { T } from '../theme.js'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { userCompanies, canSeeRevenue } from '../permissions.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

// Team — a carrier owner / carrier admin manages their own carrier's logins.
// Every account made here is a dispatcher scoped to this carrier; the server
// enforces that (see /api/team), this page just lays it out.

const ACCESS = {
  owner:      { label: 'Owner',      color: T.orange, desc: '' },
  admin:      { label: 'Admin',      color: T.blue,   desc: 'Runs loads, sees revenue, and can add or remove team logins.' },
  dispatcher: { label: 'Dispatcher', color: T.green,  desc: 'Runs loads, drivers and trucks. Cannot manage the team.' },
}

const EMPTY = { full_name: '', username: '', password: '', phone: '', email: '', access: 'dispatcher', can_see_revenue: false, company_ids: [] }

function lastSeen(ts) {
  if (!ts) return 'Never signed in'
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 600) return 'Online now'
  if (secs < 3600) return `Active ${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `Active ${Math.floor(secs / 3600)}h ago`
  return `Active ${new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

export default function Team() {
  const { user } = useAuth()
  const mobile = useIsMobile()
  const companies = userCompanies(user)
  const multi = companies.length > 1
  const revenueOk = canSeeRevenue(user)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try { setRows(await api.team()) } catch (e) { setError(e.message) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY, company_ids: companies.map(c => c.id) })
    setError(''); setShow(true)
  }
  function openEdit(r) {
    setEditing(r)
    setForm({ ...EMPTY, ...r, password: '', access: r.access, company_ids: r.company_ids })
    setError(''); setShow(true)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const payload = {
        full_name: form.full_name, phone: form.phone, email: form.email,
        access: form.access, can_see_revenue: form.can_see_revenue, company_ids: form.company_ids,
      }
      if (editing) {
        if (form.password) payload.password = form.password
        await api.updateTeamUser(editing.id, payload)
      } else {
        await api.createTeamUser({ ...payload, username: form.username, password: form.password })
      }
      setShow(false); load()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  async function handleRemove(r) {
    if (!window.confirm(`Remove ${r.full_name || r.username}'s login? They won't be able to sign in any more. Their past activity stays on record.`)) return
    try { await api.deleteTeamUser(r.id); load() } catch (err) { alert(err.message) }
  }

  const inp = { width: '100%', padding: '10px 12px', border: `1px solid ${T.sep}`, borderRadius: 9, fontSize: 14, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' }
  const lbl = { fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }
  const btn = (color) => ({ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: `1px solid ${(color || T.sep)}${color ? '50' : ''}`, color: color || T.text2 })
  const coName = (id) => companies.find(c => c.id === id)?.name || `#${id}`

  return (
    <div style={{ padding: mobile ? 16 : 28, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12 }}>
        <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: T.text, margin: 0 }}>Team</h1>
        <button onClick={openNew} style={{ padding: '9px 16px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>+ Add person</button>
      </div>
      <div style={{ fontSize: 13, color: T.text3, marginBottom: 20 }}>
        Logins for {companies.map(c => c.name).join(' · ') || 'your carrier'}. People you add only see this carrier's loads, drivers and trucks.
      </div>

      {loading && <div style={{ color: T.text3, padding: 20 }}>Loading…</div>}
      {!loading && rows.length === 0 && !error && (
        <div style={{ color: T.text3, padding: 20 }}>No one else yet. Add a dispatcher to get started.</div>
      )}
      {error && !show && <div style={{ color: T.red, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(r => {
          const a = ACCESS[r.access] || ACCESS.dispatcher
          const locked = r.access === 'owner'
          return (
            <div key={r.id} style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: a.color + '22', color: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                {(r.full_name || r.username || '?').slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{r.full_name || r.username}</span>
                  {r.is_me && <span style={{ fontSize: 10, fontWeight: 700, color: T.blue, background: T.blue + '20', padding: '2px 7px', borderRadius: 20 }}>You</span>}
                  <span style={{ fontSize: 10, fontWeight: 700, color: a.color, background: a.color + '18', padding: '2px 8px', borderRadius: 20 }}>{a.label}</span>
                  {r.access === 'dispatcher' && r.can_see_revenue && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.green, background: T.green + '15', padding: '2px 8px', borderRadius: 20 }}>Sees Revenue</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>
                  @{r.username} · {lastSeen(r.last_seen_at)}
                  {multi && ` · ${r.company_ids.map(coName).join(', ')}`}
                </div>
              </div>
              {!locked && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btn()} onClick={() => openEdit(r)}>Edit</button>
                  {!r.is_me && <button style={btn(T.red)} onClick={() => handleRemove(r)}>Remove</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {show && (
        <div onClick={() => setShow(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.bg1, borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${T.sep}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text, margin: 0 }}>{editing ? `Edit ${editing.full_name || editing.username}` : 'Add person'}</h2>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Full name</label>
                <input style={inp} value={form.full_name || ''} onChange={e => set('full_name', e.target.value)} />
              </div>
              {!editing && (
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Username *</label>
                  <input style={inp} required autoComplete="off" value={form.username} onChange={e => set('username', e.target.value)} />
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>{editing ? 'New password (leave blank to keep)' : 'Temporary password *'}</label>
                <input style={inp} type="text" autoComplete="new-password" required={!editing} minLength={6}
                  value={form.password} onChange={e => set('password', e.target.value)} />
                <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>They'll be asked to choose their own password when they sign in.</div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Phone</label>
                  <input style={inp} value={form.phone || ''} onChange={e => set('phone', e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Email</label>
                  <input style={inp} type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} />
                </div>
              </div>

              <label style={lbl}>Access</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {['dispatcher', 'admin'].map(k => {
                  const a = ACCESS[k]
                  const on = form.access === k
                  const disabled = editing?.is_me && k === 'dispatcher'
                  return (
                    <button type="button" key={k} disabled={disabled} onClick={() => set('access', k)} style={{
                      textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
                      border: `1.5px solid ${on ? a.color : T.sep}`, background: on ? a.color + '15' : T.bg2, opacity: disabled ? 0.5 : 1,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: on ? a.color : T.text }}>{a.label}</div>
                      <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{a.desc}</div>
                    </button>
                  )
                })}
              </div>

              {form.access === 'dispatcher' && revenueOk && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.text, marginBottom: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.can_see_revenue} onChange={e => set('can_see_revenue', e.target.checked)} />
                  Can see revenue
                </label>
              )}

              {multi && (
                <div style={{ marginBottom: 14 }}>
                  <label style={lbl}>Carriers *</label>
                  {companies.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.text, marginBottom: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.company_ids.includes(c.id)}
                        onChange={e => set('company_ids', e.target.checked ? [...form.company_ids, c.id] : form.company_ids.filter(x => x !== c.id))} />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}

              {error && <div style={{ color: T.red, fontSize: 12, marginBottom: 12, padding: '9px 12px', background: T.red + '12', borderRadius: 8 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShow(false)} style={{ padding: '10px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Cancel</button>
                <button type="submit" disabled={saving || (multi && form.company_ids.length === 0)} style={{ padding: '10px 20px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
