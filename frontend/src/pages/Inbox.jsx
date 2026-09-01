import React, { useState, useEffect } from 'react'
import { T } from '../theme.js'
import { api } from '../api.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

function when(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function ConnectPrompt({ status, onConnect, connecting }) {
  const needsEnv = status && !status.configured
  return (
    <div style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 16, padding: '32px 28px' }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>✉️</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 8 }}>Connect your inbox</div>
      <div style={{ fontSize: 14, color: T.text2, lineHeight: 1.5, marginBottom: 20 }}>
        Link a Gmail account to see all broker communication in one place. Read-only — nothing is ever sent on your behalf.
      </div>
      {needsEnv ? (
        <div style={{ fontSize: 13, color: T.orange, background: T.orange + '15', border: `1px solid ${T.orange}40`, borderRadius: 10, padding: '12px 14px' }}>
          Google credentials aren't set on the server yet. Add <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b> in Railway, then reload.
        </div>
      ) : (
        <button onClick={onConnect} disabled={connecting} style={{
          padding: '11px 22px', background: T.blue, color: '#fff', border: 'none',
          borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: connecting ? 'wait' : 'pointer',
        }}>{connecting ? 'Opening Google…' : 'Connect Gmail'}</button>
      )}
    </div>
  )
}

export default function Inbox() {
  const mobile = useIsMobile()
  const [status, setStatus] = useState(null)
  const [threads, setThreads] = useState([])
  const [selected, setSelected] = useState(null)   // thread_id
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [notice, setNotice] = useState(null)   // { kind, text } from the OAuth return
  const [assist, setAssist] = useState(null)    // AI summary + draft reply for the open thread
  const [assisting, setAssisting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  // Surface the result of the Google OAuth round-trip (?gmail=… on return).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const p = params.get('gmail')
    const reason = params.get('reason')
    if (!p) return
    const map = {
      connected: { kind: 'ok',  text: 'Gmail connected — syncing your broker mail now.' },
      denied:    { kind: 'err', text: 'Sign-in was cancelled. If you saw a "Google hasn’t verified this app" screen, click Advanced → Continue to get past it.' },
      no_refresh:{ kind: 'err', text: 'Google didn’t return a refresh token. Remove prior access at myaccount.google.com/permissions, then Connect again.' },
      failed:    { kind: 'err', text: 'Connection failed. Please click Connect Gmail and try once more.' },
    }
    const base = map[p] || { kind: 'err', text: `Gmail: ${p}` }
    setNotice(reason ? { ...base, text: `${base.text}  (details: ${reason})` } : base)
    // Clean the param out of the URL so it doesn't re-show on refresh.
    window.history.replaceState({}, '', '/inbox')
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const st = await api.gmailStatus()
      setStatus(st)
      if (st.connected) setThreads(await api.gmailThreads())
    } catch { /* surfaced via status */ }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  async function connect() {
    setConnecting(true)
    try { const { url } = await api.gmailAuthUrl(); window.location.href = url }
    catch (e) { alert(e.message); setConnecting(false) }
  }

  async function sync() {
    setSyncing(true)
    try { await api.gmailSync(); setThreads(await api.gmailThreads()); setStatus(await api.gmailStatus()) }
    catch (e) { alert(`Sync failed: ${e.message}`) }
    finally { setSyncing(false) }
  }

  async function openThread(t) {
    setSelected(t.thread_id)
    setMessages([])
    setAssist(null); setCopied(false)
    try { setMessages(await api.gmailThread(t.thread_id)) } catch { setMessages([]) }
  }

  async function runAssist() {
    setAssisting(true); setCopied(false)
    try { setAssist(await api.gmailAssist(selected)) }
    catch (e) { alert(`AI assist failed: ${e.message}`) }
    finally { setAssisting(false) }
  }

  async function copyReply(text) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { alert('Copy failed — select the text and copy manually.') }
  }

  const noticeBanner = notice && (
    <div style={{
      maxWidth: 560, margin: '16px auto 0', fontSize: 13, borderRadius: 10, padding: '11px 14px',
      background: (notice.kind === 'ok' ? T.green : T.red) + '15',
      border: `1px solid ${(notice.kind === 'ok' ? T.green : T.red)}40`,
      color: notice.kind === 'ok' ? T.green : T.red,
    }}>{notice.text}</div>
  )

  if (loading) return <div style={{ color: T.text3, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
  if (!status?.connected) return <div>{noticeBanner}<ConnectPrompt status={status} onConnect={connect} connecting={connecting} /></div>

  const list = (
    <div style={{ flex: mobile ? '1' : '0 0 340px', minWidth: 0, borderRight: mobile ? 'none' : `1px solid ${T.sep}` }}>
      {threads.length === 0 ? (
        <div style={{ color: T.text3, fontSize: 14, padding: '30px 12px', textAlign: 'center' }}>
          No messages synced yet. Hit “Sync now”.
        </div>
      ) : threads.map(t => {
        const active = selected === t.thread_id
        return (
          <div key={t.thread_id} onClick={() => openThread(t)} style={{
            padding: '12px 14px', cursor: 'pointer', borderBottom: `1px solid ${T.sep}`,
            background: active ? T.blue + '12' : 'transparent',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.direction === 'outbound' ? `To: ${t.to_email}` : (t.from_name || t.from_email)}
              </div>
              <div style={{ fontSize: 11, color: T.text3, flexShrink: 0 }}>{when(t.internal_date)}</div>
            </div>
            <div style={{ fontSize: 13, color: T.text2, fontWeight: 600, margin: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.subject || '(no subject)'} {t.msg_count > 1 && <span style={{ color: T.text3, fontWeight: 400 }}>· {t.msg_count}</span>}
              {t.has_attachments ? ' 📎' : ''}
            </div>
            <div style={{ fontSize: 12, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.snippet}</div>
          </div>
        )
      })}
    </div>
  )

  const detail = (
    <div style={{ flex: 1, minWidth: 0, padding: mobile ? '0' : '0 4px 0 18px' }}>
      {mobile && selected && (
        <button onClick={() => setSelected(null)} style={{ margin: '4px 0 12px', background: T.bg2, border: `1px solid ${T.sep}`, color: T.text2, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>← Threads</button>
      )}
      {!selected ? (
        <div style={{ color: T.text3, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Select a conversation.</div>
      ) : messages.length === 0 ? (
        <div style={{ color: T.text3, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, flex: 1, minWidth: 0 }}>{messages[messages.length - 1].subject || '(no subject)'}</div>
            <button onClick={runAssist} disabled={assisting} style={{
              flexShrink: 0, padding: '7px 14px', borderRadius: 8, cursor: assisting ? 'wait' : 'pointer',
              background: T.purple + '18', border: `1px solid ${T.purple}55`, color: T.purple, fontSize: 13, fontWeight: 700,
            }}>{assisting ? 'Thinking…' : '✨ AI Assist'}</button>
          </div>

          {assist && (
            <div style={{ background: T.purple + '10', border: `1px solid ${T.purple}40`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {assist.category && (
                <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, color: T.purple, background: T.purple + '20', padding: '2px 9px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {assist.category.replace(/_/g, ' ')}
                </span>
              )}
              {assist.summary && <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5 }}><b>Summary:</b> {assist.summary}</div>}
              {assist.action_needed && assist.action_needed !== 'None' && (
                <div style={{ fontSize: 13, color: T.orange }}><b>Action:</b> {assist.action_needed}</div>
              )}
              {assist.suggested_reply ? (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Suggested reply</div>
                  <div style={{ fontSize: 13, color: T.text, background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 8, padding: '10px 12px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{assist.suggested_reply}</div>
                  <button onClick={() => copyReply(assist.suggested_reply)} style={{
                    marginTop: 8, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                    background: copied ? T.green : T.blue, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
                  }}>{copied ? '✓ Copied' : 'Copy reply'}</button>
                  <span style={{ fontSize: 11, color: T.text3, marginLeft: 10 }}>Paste into Gmail to send — nothing is sent for you.</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: T.text3 }}>No reply needed.</div>
              )}
            </div>
          )}

          {messages.map(m => (
            <div key={m.id} style={{
              background: m.direction === 'outbound' ? T.blue + '10' : T.bg1,
              border: `1px solid ${T.sep}`, borderRadius: 12, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: m.direction === 'outbound' ? T.blue : T.text }}>
                  {m.direction === 'outbound' ? 'You' : (m.from_name || m.from_email)}
                  <span style={{ fontSize: 11, color: T.text3, fontWeight: 400, marginLeft: 6 }}>{m.from_email}</span>
                </div>
                <div style={{ fontSize: 11, color: T.text3, flexShrink: 0 }}>{m.internal_date ? new Date(m.internal_date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
              </div>
              <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word' }}>
                {m.body_text || m.snippet}
              </div>
              {m.has_attachments && <div style={{ fontSize: 12, color: T.text3, marginTop: 8 }}>📎 {(JSON.parse(m.attachments_json || '[]')).map(a => a.filename).join(', ')}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>Broker Inbox</div>
          <div style={{ fontSize: 12, color: T.text3 }}>
            {status.email}{status.last_synced_at ? ` · synced ${when(status.last_synced_at)} ago` : ''}
          </div>
        </div>
        <button onClick={sync} disabled={syncing} style={{ padding: '8px 16px', background: T.bg2, border: `1px solid ${T.sep}`, color: T.text2, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: syncing ? 'wait' : 'pointer' }}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {status.last_error && (
        <div style={{ fontSize: 12, color: T.red, background: T.red + '12', border: `1px solid ${T.red}40`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          Last sync error: {status.last_error}{/invalid_grant|reauth/i.test(status.last_error) ? ' — reconnect Gmail in Settings.' : ''}
        </div>
      )}
      <div style={{ display: 'flex', background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, overflow: 'hidden', minHeight: 400 }}>
        {mobile ? (selected ? detail : list) : (<>{list}{detail}</>)}
      </div>
    </div>
  )
}
