import React, { useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api.login(username, password)
      onLogin(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: T.bg,
    }}>
      <div style={{
        background: T.bg1, borderRadius: 20, padding: '40px 36px', width: 360,
        border: `1px solid ${T.sep}`,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Dispatch Portal</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>Sign In</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 6 }}>Username</label>
            <input
              style={{
                width: '100%', padding: '11px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
                borderRadius: 10, fontSize: 15, color: T.text, outline: 'none', boxSizing: 'border-box',
              }}
              value={username} onChange={e => setUsername(e.target.value)} placeholder="Username or email" required autoComplete="username"
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 6 }}>Password</label>
            <input
              style={{
                width: '100%', padding: '11px 14px', background: T.bg2, border: `1px solid ${T.sep}`,
                borderRadius: 10, fontSize: 15, color: T.text, outline: 'none', boxSizing: 'border-box',
              }}
              type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
            />
          </div>
          {error && (
            <div style={{ fontSize: 13, color: T.red, marginBottom: 14, padding: '10px 12px', background: T.red + '18', borderRadius: 8 }}>
              {error}
            </div>
          )}
          <button style={{
            width: '100%', padding: '13px', background: T.blue, color: '#fff',
            border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            letterSpacing: -0.2,
          }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
