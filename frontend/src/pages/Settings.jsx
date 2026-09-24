import React, { useState, useEffect } from 'react'
import { T } from '../theme.js'
import { useTheme } from '../ThemeContext.jsx'
import { useAuth } from '../AuthContext.jsx'
import { api, openSummaryPreview } from '../api.js'
import { isAdmin as isAdminUser, canManageTeam, userCompanies } from '../permissions.js'

function useThemeForce() {
  const [, tick] = useState(0)
  useEffect(() => {
    const fn = () => tick(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])
}

// ── Weekly summary email ─────────────────────────────────────────────────────
// Carrier owners / admins: turn their own copy on or off and set the address.
// Main admin: see who gets each carrier's email, preview it, or send it now.
function SummarySection({ user, setUser }) {
  const admin = isAdminUser(user)
  const [status, setStatus] = useState(null)
  const [email, setEmail] = useState(user.email || '')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(null)

  useEffect(() => { if (admin) api.summaryStatus().then(setStatus).catch(() => {}) }, [admin])

  async function save(d) {
    setMsg('')
    try { const u = await api.updateMySummary(d); setUser?.(prev => ({ ...prev, ...u })); setMsg('Saved') }
    catch (e) { setMsg(e.message) }
  }
  async function sendNow(c) {
    if (!window.confirm(`Send last week's summary for ${c.name} now?`)) return
    setBusy(c.id); setMsg('')
    try { const r = await api.sendSummary(c.id); setMsg(`Sent to ${r.sent.join(', ')}`); setStatus(await api.summaryStatus()) }
    catch (e) { setMsg(e.message) }
    setBusy(null)
  }

  const btn = { padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}` }
  const intro = (
    <div style={{ padding: '14px 16px', fontSize: 13, color: T.text2, lineHeight: 1.6, borderBottom: `1px solid ${T.sep}` }}>
      Every Saturday morning each carrier's owner and admins get an email with last week's loads, revenue,
      idle drivers, and the paperwork and expiries that need attention (week runs Saturday to Saturday).
    </div>
  )

  if (admin) return (
    <Section title="Weekly Summary Email">
      {intro}
      {status && !status.configured && (
        <div style={{ padding: '12px 16px', fontSize: 12, color: T.orange, borderBottom: `1px solid ${T.sep}` }}>
          Sending is off until email is set up on the server (SMTP_HOST, SMTP_USER, SMTP_PASS). Previews work now.
        </div>
      )}
      {status?.companies.map((c, i) => (
        <div key={c.id} style={{ padding: '12px 16px', borderBottom: i < status.companies.length - 1 ? `1px solid ${T.sep}` : 'none', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{c.name}</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>
              {c.recipients.map(r => r.active ? r.email : `${r.name} (${r.opted_out ? 'turned off' : 'no email'})`).join(' · ')}
            </div>
            {c.last && <div style={{ fontSize: 11, color: c.last.error ? T.red : T.text3, marginTop: 2 }}>
              {c.last.error ? `Last attempt failed: ${c.last.error}` : `Last sent ${c.last.sent_at?.slice(0, 16)} UTC`}
            </div>}
          </div>
          <button style={btn} onClick={() => openSummaryPreview(c.id)}>Preview</button>
          {status.configured && <button style={{ ...btn, color: T.blue }} disabled={busy === c.id} onClick={() => sendNow(c)}>{busy === c.id ? 'Sending…' : 'Send now'}</button>}
        </div>
      ))}
      {status && status.companies.length === 0 && (
        <div style={{ padding: 16, fontSize: 13, color: T.text3 }}>No carrier owners or carrier admins yet.</div>
      )}
      {msg && <div style={{ padding: '10px 16px', fontSize: 12, color: T.text3 }}>{msg}</div>}
    </Section>
  )

  const companies = userCompanies(user)
  return (
    <Section title="Weekly Summary Email">
      {intro}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${T.sep}` }}>
        <span style={{ fontSize: 13, color: T.text2, minWidth: 90 }}>Send it to</span>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email"
          style={{ flex: 1, minWidth: 180, padding: '8px 10px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, color: T.text, fontSize: 13 }} />
        <button style={btn} onClick={() => save({ email })}>Save</button>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: T.text, cursor: 'pointer', flex: 1 }}>
          <input type="checkbox" checked={!user.summary_opt_out} onChange={e => save({ opt_out: !e.target.checked })} />
          Email me the weekly summary
        </label>
        {companies.map(c => (
          <button key={c.id} style={btn} onClick={() => openSummaryPreview(c.id)}>Preview{companies.length > 1 ? ` · ${c.name}` : ''}</button>
        ))}
      </div>
      {msg && <div style={{ padding: '0 16px 12px', fontSize: 12, color: T.text3 }}>{msg}</div>}
    </Section>
  )
}

export default function Settings() {
  useThemeForce()
  const { mode, toggle } = useTheme()
  const { user, setUser } = useAuth()
  const [density, setDensity] = useState(() => localStorage.getItem('density') || 'comfortable')
  const [sessionInfo] = useState(() => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return null
      const payload = JSON.parse(atob(token.split('.')[1]))
      return {
        issuedAt: new Date(payload.iat * 1000).toLocaleString(),
        expiresAt: new Date(payload.exp * 1000).toLocaleString(),
      }
    } catch { return null }
  })

  function setDensityVal(v) {
    setDensity(v)
    localStorage.setItem('density', v)
    window.dispatchEvent(new Event('densitychange'))
  }

  const loginExpiresDate = sessionInfo ? new Date(sessionInfo.expiresAt) : null
  const hoursLeft = loginExpiresDate ? Math.round((loginExpiresDate - Date.now()) / 36e5) : null

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: '0 0 6px', letterSpacing: -0.5 }}>Settings</h1>
      <p style={{ fontSize: 13, color: T.text3, margin: '0 0 28px' }}>Manage your preferences and account.</p>

      {/* Appearance */}
      <Section title="Appearance">
        <Row label="Theme" sub="Changes the color scheme across all pages">
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { val: 'dark',  icon: '🌙', label: 'Dark' },
              { val: 'light', icon: '☀️', label: 'Light' },
            ].map(opt => (
              <button key={opt.val} onClick={() => toggle(opt.val)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: mode === opt.val ? T.blue : T.bg2,
                color: mode === opt.val ? '#fff' : T.text2,
              }}>
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Density" sub="Controls how compact the load board and lists appear" last>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { val: 'compact',     label: 'Compact' },
              { val: 'comfortable', label: 'Comfortable' },
            ].map(opt => (
              <button key={opt.val} onClick={() => setDensityVal(opt.val)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: density === opt.val ? T.blue : T.bg2,
                color: density === opt.val ? '#fff' : T.text2,
              }}>
                {opt.label}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* Account */}
      <Section title="Account">
        <Row label="Username"><Val>{user.username}</Val></Row>
        <Row label="Role"><Val style={{ textTransform: 'capitalize' }}>{user.role.replace('_', ' ')}</Val></Row>
        {user.full_name && <Row label="Full name"><Val>{user.full_name}</Val></Row>}
        {user.email && <Row label="Email"><Val>{user.email}</Val></Row>}
        {user.company_name && <Row label="Company"><Val>{user.company_name}</Val></Row>}
        {user.phone && <Row label="Phone" last><Val>{user.phone}</Val></Row>}
        {!user.phone && <Row label="Phone" last><Val style={{ color: T.text3 }}>Not set</Val></Row>}
      </Section>

      {(isAdminUser(user) || canManageTeam(user)) && <SummarySection user={user} setUser={setUser} />}

      {/* Session & Security */}
      {(
        <Section title="Session & Security">
          {sessionInfo && (
            <>
              <Row label="Signed in at"><Val>{sessionInfo.issuedAt}</Val></Row>
              <Row label="Session expires">
                <Val style={{ color: hoursLeft < 12 ? T.orange : T.text2 }}>
                  {sessionInfo.expiresAt}{hoursLeft !== null && ` (${hoursLeft}h left)`}
                </Val>
              </Row>
            </>
          )}
          <Row label="Auth method"><Val>JWT · bcrypt passwords</Val></Row>
          <Row label="Connection"><Val style={{ color: T.green }}>Encrypted (HTTPS)</Val></Row>
          <Row label="Data storage"><Val>Railway Volume · SQLite WAL</Val></Row>
          <Row label="Rate limiting" last><Val style={{ color: T.green }}>Active — 10 attempts / 15 min</Val></Row>
        </Section>
      )}

      {/* Mobile App */}
      <Section title="Mobile App">
        <div style={{ padding: '16px 16px 4px' }}>
          <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.6, marginBottom: 16 }}>
            The Dispatch Portal works as an installed app on iPhone, iPad, and Android — no App Store required.
            Add it to your home screen for a native-app experience with offline support.
          </div>
        </div>

        <Row label="iPhone & iPad">
          <div style={{ fontSize: 12, color: T.text3, textAlign: 'right', maxWidth: 240 }}>
            Open goatpaji.com in Safari → tap <strong style={{ color: T.text2 }}>Share</strong> → <strong style={{ color: T.text2 }}>Add to Home Screen</strong>
          </div>
        </Row>
        <Row label="Android">
          <div style={{ fontSize: 12, color: T.text3, textAlign: 'right', maxWidth: 240 }}>
            Open goatpaji.com in Chrome → tap <strong style={{ color: T.text2 }}>⋮ menu</strong> → <strong style={{ color: T.text2 }}>Add to Home screen</strong>
          </div>
        </Row>
        <Row label="iPad (full screen)" last>
          <div style={{ fontSize: 12, color: T.text3, textAlign: 'right', maxWidth: 240 }}>
            Same as iPhone — works in split-view and full-screen landscape
          </div>
        </Row>

        <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${T.sep}` }}>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Share portal link
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              flex: 1, background: T.bg2, border: `1px solid ${T.sep}`,
              borderRadius: 8, padding: '8px 12px', fontSize: 12, color: T.text2,
              fontFamily: 'monospace',
            }}>
              https://goatpaji.com
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText('https://goatpaji.com')}
              style={{
                padding: '8px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
                borderRadius: 8, cursor: 'pointer', color: T.text2, fontSize: 12, fontWeight: 600,
              }}
            >
              Copy
            </button>
          </div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 10 }}>
            Share this link with drivers and dispatchers. They log in with their assigned credentials.
          </div>
        </div>
      </Section>

      {/* Change Password */}
      <ChangePasswordSection />

      {/* About */}
      <Section title="About">
        <Row label="Product"><Val>Dispatch Portal · GOAT INC</Val></Row>
        <Row label="Version"><Val>2026.1</Val></Row>
        <Row label="Support" last>
          <a href="mailto:loads.safal@gmail.com" style={{ fontSize: 13, color: T.blue, textDecoration: 'none' }}>
            loads.safal@gmail.com
          </a>
        </Row>
      </Section>

      {/* Sign Out */}
      <button
        onClick={() => {
          if (!window.confirm('Sign out of Dispatch Portal?')) return
          localStorage.removeItem('token')
          window.location.reload()
        }}
        style={{
          width: '100%', padding: '14px', background: T.bg1,
          border: `1px solid ${T.sep}`, borderRadius: 14,
          color: '#ff453a', fontSize: 15, fontWeight: 600,
          cursor: 'pointer', marginBottom: 32,
        }}
      >
        Sign Out
      </button>
    </div>
  )
}

function ChangePasswordSection() {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (pw !== pw2) { setMsg('Passwords do not match'); return }
    if (pw.length < 6) { setMsg('Must be at least 6 characters'); return }
    setSaving(true); setMsg('')
    try {
      await api.changePassword(pw)
      setMsg('Password updated.')
      setPw(''); setPw2('')
      setTimeout(() => { setMsg(''); setOpen(false) }, 2000)
    } catch (err) {
      setMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Security">
      {!open ? (
        <Row label="Password" last>
          <button onClick={() => setOpen(true)} style={{ padding: '6px 14px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, cursor: 'pointer', color: T.text2, fontSize: 12, fontWeight: 600 }}>
            Change Password
          </button>
        </Row>
      ) : (
        <div style={{ padding: 16 }}>
          <form onSubmit={submit}>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)}
              placeholder="New password" autoFocus autoComplete="new-password"
              style={{ width: '100%', padding: '10px 12px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, color: T.text, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
              placeholder="Confirm password" autoComplete="new-password"
              style={{ width: '100%', padding: '10px 12px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, color: T.text, fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} />
            {msg && <div style={{ fontSize: 12, color: msg === 'Password updated.' ? T.green : T.red, marginBottom: 10 }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={saving} style={{ flex: 1, padding: '9px', background: T.blue, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Update'}
              </button>
              <button type="button" onClick={() => { setOpen(false); setPw(''); setPw2(''); setMsg('') }} style={{ padding: '9px 16px', background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, color: T.text2, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </Section>
  )
}

function useThemeForce2() {
  const [, tick] = useState(0)
  useEffect(() => {
    const fn = () => tick(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])
}

function Section({ title, children }) {
  useThemeForce2()
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ background: T.bg1, borderRadius: 14, border: `1px solid ${T.sep}`, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, sub, last, children }) {
  useThemeForce2()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '13px 16px', gap: 16,
      borderBottom: last ? 'none' : `1px solid ${T.sep}`,
    }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Val({ children, style }) {
  useThemeForce2()
  return <span style={{ fontSize: 13, color: T.text2, ...style }}>{children}</span>
}
