import React, { useState, useEffect } from 'react'
import { T } from '../theme.js'
import { api } from '../api.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

// Compact device label from a user-agent string.
function deviceLabel(ua) {
  if (!ua) return 'Unknown device'
  const os = /iphone|ipad|ios/i.test(ua) ? 'iPhone/iPad'
    : /android/i.test(ua) ? 'Android'
    : /mac os x|macintosh/i.test(ua) ? 'Mac'
    : /windows/i.test(ua) ? 'Windows'
    : /linux/i.test(ua) ? 'Linux' : 'Device'
  const br = /edg\//i.test(ua) ? 'Edge'
    : /chrome|crios/i.test(ua) ? 'Chrome'
    : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /safari/i.test(ua) ? 'Safari' : ''
  return br ? `${br} · ${os}` : os
}

function whenLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z'))
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const FILTERS = [
  { key: '',              label: 'All activity' },
  { key: 'login',         label: 'Logins' },
  { key: 'load_deleted',  label: 'Deletions' },
]

const ACTION_META = {
  login:        { color: T.green,  label: 'Login' },
  load_deleted: { color: T.red,    label: 'Load deleted' },
}

export default function Audit() {
  const isMobile = useIsMobile()
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  useEffect(() => {
    setLoading(true)
    api.auditLog({ action: filter, limit: 300 })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [filter])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>Access Log</div>
        <div style={{ fontSize: 13, color: T.text3, marginTop: 2 }}>
          Where and how the portal is being used — logins, devices, locations, and deletions.
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
        {FILTERS.map(f => {
          const active = filter === f.key
          return (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: active ? T.blue : T.bg2,
              color: active ? '#fff' : T.text2,
              border: `1px solid ${active ? T.blue : T.sep}`,
            }}>{f.label}</button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ color: T.text3, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: T.text3, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>No activity recorded yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const meta = ACTION_META[r.action] || { color: T.text3, label: r.action }
            const place = [r.city, r.country].filter(Boolean).join(', ')
            return (
              <div key={r.id} style={{
                background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 12,
                padding: '12px 14px', display: 'flex', gap: 12,
                flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center',
              }}>
                {/* Action badge */}
                <div style={{ flexShrink: 0 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: meta.color,
                    background: meta.color + '18', border: `1px solid ${meta.color}44`,
                    padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                  }}>{meta.label}</span>
                </div>

                {/* Who + detail */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                    {r.user_name || 'Unknown'}
                    {r.role && <span style={{ fontSize: 11, color: T.text3, fontWeight: 500, marginLeft: 8 }}>{r.role.replace('_', ' ')}</span>}
                  </div>
                  {r.detail && <div style={{ fontSize: 13, color: T.text2, marginTop: 2 }}>{r.detail}</div>}
                </div>

                {/* Where / device */}
                <div style={{ flexShrink: 0, textAlign: isMobile ? 'left' : 'right', fontSize: 12, color: T.text3 }}>
                  <div style={{ color: place ? T.text2 : T.text3, fontWeight: place ? 600 : 400 }}>
                    {place || 'Location unknown'}{r.ip ? ` · ${r.ip}` : ''}
                  </div>
                  <div style={{ marginTop: 2 }}>{deviceLabel(r.user_agent)} · {whenLabel(r.ts)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
