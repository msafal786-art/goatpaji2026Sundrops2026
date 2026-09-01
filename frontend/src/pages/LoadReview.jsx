import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { T } from '../theme.js'
import { api } from '../api.js'

function Field({ label, value }) {
  if (!value) return null
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  )
}

export default function LoadReview() {
  const navigate = useNavigate()
  const [drafts, setDrafts] = useState([])
  const [companies, setCompanies] = useState([])
  const [picked, setPicked] = useState({})      // draftId -> company_id
  const [busy, setBusy] = useState({})
  const [loading, setLoading] = useState(true)
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [d, c] = await Promise.all([api.loadDrafts(), api.companies().catch(() => [])])
      setDrafts(d); setCompanies(c)
    } catch { /* empty */ }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function approve(d) {
    setBusy(b => ({ ...b, [d.id]: true }))
    try {
      const r = await api.approveDraft(d.id, picked[d.id] || '')
      setDrafts(list => list.filter(x => x.id !== d.id))
      if (r.load_id && confirm('Load created. Open it now?')) navigate(`/loads/${r.load_id}`)
    } catch (e) { alert(e.message) }
    finally { setBusy(b => ({ ...b, [d.id]: false })) }
  }
  async function reject(d) {
    if (!confirm('Discard this draft?')) return
    try { await api.rejectDraft(d.id); setDrafts(list => list.filter(x => x.id !== d.id)) }
    catch (e) { alert(e.message) }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>Load Review</div>
        <div style={{ fontSize: 13, color: T.text3 }}>Rate cons pulled from broker emails. Assign a carrier and approve to put them on the board.</div>
      </div>

      {loading ? (
        <div style={{ color: T.text3, textAlign: 'center', padding: '40px 0' }}>Loading…</div>
      ) : drafts.length === 0 ? (
        <div style={{ color: T.text3, textAlign: 'center', padding: '50px 20px', background: T.bg1, border: `1px dashed ${T.sep}`, borderRadius: 14 }}>
          Nothing to review. Open a rate-con email in the Broker Inbox and hit “Draft load”.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {drafts.map(d => {
            const p = d.parsed_json || {}
            const lane = [p.pickup_city && `${p.pickup_city}, ${p.pickup_state}`, p.delivery_city && `${p.delivery_city}, ${p.delivery_state}`].filter(Boolean).join('  →  ')
            return (
              <div key={d.id} style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                      {p.broker_name || d.from_email || 'Rate con'}{p.load_number ? ` · #${p.load_number}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.subject} · {d.attachment_name}</div>
                  </div>
                  {p.rate && <div style={{ fontSize: 18, fontWeight: 800, color: T.green }}>${Number(p.rate).toLocaleString()}</div>}
                </div>

                {lane && <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 12 }}>{lane}</div>}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
                  <Field label="Broker order" value={p.broker_order} />
                  <Field label="Commodity" value={p.commodity} />
                  <Field label="Weight" value={p.weight} />
                  <Field label="Equipment" value={p.trailer_type} />
                  <Field label="Miles" value={p.miles} />
                  <Field label="Pickup" value={p.pickup_date && `${p.pickup_date} ${p.pickup_time || ''}`} />
                  <Field label="Delivery" value={p.delivery_date && `${p.delivery_date} ${p.delivery_time || ''}`} />
                  <Field label="Contact" value={p.broker_contact} />
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${T.sep}`, paddingTop: 12 }}>
                  <select value={picked[d.id] || ''} onChange={e => setPicked(x => ({ ...x, [d.id]: e.target.value }))}
                    style={{ padding: '8px 10px', borderRadius: 8, background: T.bg2, color: T.text, border: `1px solid ${T.sep}`, fontSize: 13 }}>
                    <option value="">Assign carrier…</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => reject(d)} style={{ padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: T.bg2, border: `1px solid ${T.sep}`, color: T.text2, fontSize: 13, fontWeight: 600 }}>Discard</button>
                  <button onClick={() => approve(d)} disabled={busy[d.id]} style={{ padding: '8px 18px', borderRadius: 8, cursor: busy[d.id] ? 'wait' : 'pointer', background: T.green, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                    {busy[d.id] ? 'Creating…' : 'Approve → create load'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
