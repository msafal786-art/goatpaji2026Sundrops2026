import React, { useState, useEffect } from 'react'
import { T } from '../theme.js'
import { useTheme } from '../ThemeContext.jsx'
import { useAuth } from '../App.jsx'

export default function Settings() {
  const { mode, toggle } = useTheme()
  const { user } = useAuth()
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: '0 0 24px' }}>Settings</h1>

      {/* Theme */}
      <Section title="Appearance">
        <Row label="Theme">
          <div style={{ display: 'flex', gap: 8 }}>
            {['dark', 'light'].map(m => (
              <button key={m} onClick={() => toggle(m)} style={{
                padding: '7px 18px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                background: mode === m ? T.blue : T.bg2,
                color: mode === m ? '#fff' : T.text2,
                transition: 'background 0.15s',
              }}>
                {m === 'dark' ? '🌙 Dark' : '☀️ Light'}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* Account */}
      <Section title="Account">
        <Row label="Username"><span style={{ color: T.text2, fontSize: 14 }}>{user.username}</span></Row>
        <Row label="Role"><span style={{ color: T.text2, fontSize: 14, textTransform: 'capitalize' }}>{user.role.replace('_', ' ')}</span></Row>
        {user.full_name && <Row label="Name"><span style={{ color: T.text2, fontSize: 14 }}>{user.full_name}</span></Row>}
        {user.email && <Row label="Email"><span style={{ color: T.text2, fontSize: 14 }}>{user.email}</span></Row>}
        {user.company_name && <Row label="Company"><span style={{ color: T.text2, fontSize: 14 }}>{user.company_name}</span></Row>}
      </Section>

      {/* App info */}
      <Section title="About">
        <Row label="Version"><span style={{ color: T.text3, fontSize: 13 }}>Dispatch Portal 2026</span></Row>
      </Section>
    </div>
  )
}

function Section({ title, children }) {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{
        background: T.bg1, borderRadius: 14,
        border: `1px solid ${T.sep}`, overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, children }) {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '13px 16px', borderBottom: `1px solid ${T.sep}`,
    }}
    className="settings-row">
      <span style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  )
}
