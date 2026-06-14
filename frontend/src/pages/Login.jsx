import React, { useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [adminCode, setAdminCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const inp = () => ({
    width: '100%', padding: '11px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
    borderRadius: 10, fontSize: 15, color: T.text, outline: 'none', boxSizing: 'border-box',
  })
  const lbl = () => ({ display: 'block', fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 6 })

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api.login(username, password, needCode ? adminCode : undefined)
      onLogin(data)
    } catch (err) {
      // Server signals admin code is required
      if (err.message === 'Admin code required') {
        setNeedCode(true)
        setError('This account requires an admin code.')
      } else {
        setError(err.message)
        setNeedCode(false)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
      <div style={{ background: T.bg1, borderRadius: 20, padding: '40px 36px', width: 360, border: `1px solid ${T.sep}` }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Dispatch Portal</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>Sign In</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl()}>Username</label>
            <input style={inp()} value={username} onChange={e => setUsername(e.target.value)}
              placeholder="Username" required autoComplete="username" />
          </div>
          <div style={{ marginBottom: needCode ? 12 : 20 }}>
            <label style={lbl()}>Password</label>
            <input style={inp()} type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required autoComplete="current-password" />
          </div>

          {needCode && (
            <div style={{ marginBottom: 20 }}>
              <label style={lbl()}>Admin Code</label>
              <input style={{ ...inp(), borderColor: T.orange, background: T.orange + '10' }}
                type="password" value={adminCode} onChange={e => setAdminCode(e.target.value)}
                placeholder="Enter admin secret code" required autoFocus />
              <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
                Contact the system owner for the admin code.
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 13, color: T.red, marginBottom: 14, padding: '10px 12px', background: T.red + '15', borderRadius: 8 }}>
              {error}
            </div>
          )}
          <button style={{
            width: '100%', padding: '13px', background: T.blue, color: '#fff',
            border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }} disabled={loading}>
            {loading ? 'Signing in…' : needCode ? 'Verify & Sign In' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
