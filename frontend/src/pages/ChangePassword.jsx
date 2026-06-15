import React, { useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

export default function ChangePassword({ user, onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (pw !== pw2) { setError('Passwords do not match'); return }
    if (pw.length < 6) { setError('Must be at least 6 characters'); return }
    setSaving(true); setError('')
    try {
      await api.changePassword(pw)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inp = {
    width: '100%', padding: '13px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
    borderRadius: 12, fontSize: 16, color: T.text, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg, padding: 20 }}>
      <div style={{ background: T.bg1, borderRadius: 22, padding: '36px 28px', width: '100%', maxWidth: 380, border: `1px solid ${T.sep}` }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, letterSpacing: -0.4, margin: 0 }}>
            Set Your Password
          </h1>
          <p style={{ fontSize: 13, color: T.text3, marginTop: 8, lineHeight: 1.5 }}>
            Hi {user?.full_name?.split(' ')[0] || user?.username}, your temporary password needs to be changed before you continue.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 6 }}>
              New Password
            </label>
            <input
              style={inp} type="password" value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="Choose a strong password"
              autoFocus autoComplete="new-password" required
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 6 }}>
              Confirm Password
            </label>
            <input
              style={inp} type="password" value={pw2}
              onChange={e => setPw2(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password" required
            />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: T.red, marginBottom: 16, padding: '10px 12px', background: T.red + '15', borderRadius: 10 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={saving} style={{
            width: '100%', padding: '15px', background: T.blue, color: '#fff',
            border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 700, cursor: 'pointer',
          }}>
            {saving ? 'Saving…' : 'Set Password & Continue'}
          </button>

          <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
            Choose something memorable you can type on your phone.
          </div>
        </form>
      </div>
    </div>
  )
}
