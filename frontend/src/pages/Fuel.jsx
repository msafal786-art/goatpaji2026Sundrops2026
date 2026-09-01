import React, { useState, useEffect, useRef } from 'react'
import { T } from '../theme.js'
import { api } from '../api.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const fmt$ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
const SEV = { high: T.red, medium: T.orange, low: T.text3 }
const CODE_LABEL = {
  non_fuel: 'Non-fuel', large_fill: 'Large fill', price_outlier: 'Overpriced',
  multi_state_day: 'Multi-state day', many_same_day: 'Many same day', not_debited: 'Not debited',
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 12, padding: '14px 16px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || T.text }}>{value}</div>
      <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function Fuel() {
  const isMobile = useIsMobile()
  const [summary, setSummary] = useState(null)
  const [rows, setRows] = useState([])
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const [, forceUpdate] = useState(0)
  const fileRef = useRef(null)

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([api.fuelSummary(), api.fuelTransactions({ flagged: flaggedOnly ? '1' : '' })])
      setSummary(s); setRows(t)
    } catch { /* empty state */ }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [flaggedOnly])

  async function onFile(file) {
    if (!file) return
    setUploading(true); setUploadMsg(null)
    try {
      const r = await api.fuelUpload(file)
      setUploadMsg({ kind: 'ok', text: `Imported ${r.added} transaction${r.added === 1 ? '' : 's'}${r.duplicates ? ` (${r.duplicates} already on file)` : ''}${r.flagged ? ` — ${r.flagged} flagged for review` : ''}.` })
      await load()
    } catch (e) {
      setUploadMsg({ kind: 'err', text: `Upload failed: ${e.message}` })
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>Fuel Cards</div>
          <div style={{ fontSize: 13, color: T.text3 }}>Upload the daily card report — transactions are mapped and checked for anomalies.</div>
        </div>
        <div>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
            padding: '10px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer',
          }}>{uploading ? 'Reading report…' : '⬆ Upload report (PDF)'}</button>
        </div>
      </div>

      {uploadMsg && (
        <div style={{ marginBottom: 14, fontSize: 13, borderRadius: 10, padding: '11px 14px',
          background: (uploadMsg.kind === 'ok' ? T.green : T.red) + '15',
          border: `1px solid ${(uploadMsg.kind === 'ok' ? T.green : T.red)}40`,
          color: uploadMsg.kind === 'ok' ? T.green : T.red }}>{uploadMsg.text}</div>
      )}

      {summary && summary.totals.n > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          <Stat label="Transactions" value={summary.totals.n} />
          <Stat label="Total spend" value={fmt$(summary.totals.amount)} />
          <Stat label="Gallons" value={Math.round(summary.totals.qty).toLocaleString()} />
          <Stat label="Flagged" value={summary.totals.flagged} color={summary.totals.flagged > 0 ? T.red : T.green} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={() => setFlaggedOnly(false)} style={tab(!flaggedOnly)}>All transactions</button>
        <button onClick={() => setFlaggedOnly(true)} style={tab(flaggedOnly, T.red)}>
          ⚠ Anomalies{summary?.totals.flagged ? ` (${summary.totals.flagged})` : ''}
        </button>
      </div>

      {loading ? (
        <div style={{ color: T.text3, textAlign: 'center', padding: '40px 0' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: T.text3, textAlign: 'center', padding: '50px 20px', background: T.bg1, border: `1px dashed ${T.sep}`, borderRadius: 14 }}>
          {flaggedOnly ? 'No anomalies 🎉' : 'No fuel transactions yet. Upload a card report to get started.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${T.sep}`, borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ background: T.bg2, color: T.text3, textAlign: 'left' }}>
                {['Date', 'Card', 'Unit', 'Fuel', 'Location', 'Gal', '$/gal', 'Amount', 'Flags'].map(h => (
                  <th key={h} style={{ padding: '9px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const flags = r.anomaly_flags || []
                const worst = flags.some(f => f.severity === 'high') ? T.red : flags.length ? T.orange : null
                return (
                  <tr key={r.id} style={{ borderTop: `1px solid ${T.sep}`, background: worst ? worst + '0d' : 'transparent' }}>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', color: T.text2 }}>{r.tran_date}</td>
                    <td style={{ padding: '9px 12px', color: T.text }}>{r.card_number}</td>
                    <td style={{ padding: '9px 12px', color: T.text2 }}>{r.unit || '—'}</td>
                    <td style={{ padding: '9px 12px', color: T.text2 }}>{r.item}</td>
                    <td style={{ padding: '9px 12px', color: T.text2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.location_name}{r.state ? `, ${r.state}` : ''}</td>
                    <td style={{ padding: '9px 12px', color: T.text2 }}>{r.qty}</td>
                    <td style={{ padding: '9px 12px', color: T.text2 }}>{r.unit_price ? r.unit_price.toFixed(3) : '—'}</td>
                    <td style={{ padding: '9px 12px', color: T.text, fontWeight: 600 }}>{fmt$(r.amount)}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {flags.map((f, i) => (
                          <span key={i} title={f.detail} style={{
                            fontSize: 10, fontWeight: 700, color: SEV[f.severity] || T.text3,
                            background: (SEV[f.severity] || T.text3) + '20', border: `1px solid ${(SEV[f.severity] || T.text3)}44`,
                            padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                          }}>{CODE_LABEL[f.code] || f.code}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function tab(active, color) {
  const c = color || T.blue
  return {
    padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: active ? c : T.bg2, color: active ? '#fff' : T.text2,
    border: `1px solid ${active ? c : T.sep}`,
  }
}
