import React, { useState, useEffect } from 'react'
import { T } from '../theme.js'
import { useTheme } from '../ThemeContext.jsx'
import { useAuth } from '../AuthContext.jsx'

function useThemeForce() {
  const [, tick] = useState(0)
  useEffect(() => {
    const fn = () => tick(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])
}

export default function Settings() {
  useThemeForce()
  const { mode, toggle } = useTheme()
  const { user } = useAuth()
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

      {/* Session & Security — admin only */}
      {user.role === 'dispatcher' && !user.company_id && (
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
    </div>
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
