import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T } from '../theme.js'

// Parse at most this many rate cons at once — the parser is an API call per
// file, so a stack of 20 shouldn't fire 20 concurrent requests.
const CONCURRENCY = 2

const STATE_STYLE = {
  queued:    { label: 'Queued',   color: T.text3 },
  parsing:   { label: 'Reading…', color: T.blue },
  parsed:    { label: 'Ready',    color: T.green },
  creating:  { label: 'Saving…',  color: T.blue },
  created:   { label: 'Added',    color: T.green },
  error:     { label: 'Failed',   color: T.red },
  duplicate: { label: 'Duplicate', color: T.orange },
}

export default function BulkRateCons({ onClose, onDone }) {
  const { user } = useAuth()
  const isAdmin = user.role === 'dispatcher' && !user.company_id && !user.allowed_company_ids
  const [items, setItems] = useState([])       // { id, file, state, data, error }
  const [companies, setCompanies] = useState([])
  const [defaultCompany, setDefaultCompany] = useState(user.company_id || '')
  const [dragOver, setDragOver] = useState(false)
  const [working, setWorking] = useState(false)
  const inputRef = useRef(null)
  const nextId = useRef(1)

  useEffect(() => {
    if (isAdmin || user.role === 'dispatcher') api.companies().then(setCompanies).catch(() => {})
  }, [isAdmin, user.role])

  function addFiles(fileList) {
    const pdfs = Array.from(fileList).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    const added = pdfs.map(f => ({ id: nextId.current++, file: f, state: 'queued', data: null, error: '' }))
    setItems(prev => [...prev, ...added])
    parseAll(added)
  }

  async function parseAll(queue) {
    setWorking(true)
    const pending = [...queue]
    async function worker() {
      while (pending.length) {
        const item = pending.shift()
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, state: 'parsing' } : i))
        try {
          const data = await api.parseRateCon(item.file)
          setItems(prev => prev.map(i => i.id === item.id
            ? { ...i, state: 'parsed', data: { ...data, company_id: i.data?.company_id || '' } }
            : i))
        } catch (err) {
          setItems(prev => prev.map(i => i.id === item.id
            ? { ...i, state: 'error', error: err.message || 'Could not read this PDF' } : i))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))
    setWorking(false)
  }

  function setField(id, field, value) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, data: { ...i.data, [field]: value } } : i))
  }

  const readyItems = items.filter(i => i.state === 'parsed')
  const needsCompany = readyItems.filter(i => !(i.data.company_id || defaultCompany))

  async function createAll() {
    if (needsCompany.length) return
    setWorking(true)
    const created = []
    for (const item of readyItems) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, state: 'creating' } : i))
      try {
        const payload = { ...item.data, company_id: item.data.company_id || defaultCompany }
        delete payload._filename
        const staged = payload.staged_filename
        const originalName = payload.original_name
        delete payload.staged_filename
        delete payload.original_name

        const saved = await api.createLoad(payload)
        if (saved?.id) created.push(saved)

        // File the rate con itself against the load it created.
        if (saved?.id && staged) {
          try { await api.attachDoc(staged, originalName, saved.id, 'Rate Con') }
          catch { /* load is created; a missing RC attachment shouldn't fail the batch */ }
        }
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, state: 'created' } : i))
      } catch (err) {
        const dup = /already exists/i.test(err.message || '')
        setItems(prev => prev.map(i => i.id === item.id
          ? { ...i, state: dup ? 'duplicate' : 'error', error: err.message } : i))
      }
    }
    setWorking(false)
    onDone?.(created)
  }

  const createdCount = items.filter(i => i.state === 'created').length

  // Drop any parsed-but-never-created rate cons from the server on the way out.
  async function handleClose() {
    const orphans = items.filter(i => i.data?.staged_filename && i.state !== 'created')
    await Promise.allSettled(orphans.map(i => api.discardDoc(i.data.staged_filename)))
    onClose()
  }

  return (
    <div style={modalBg} onClick={handleClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Add rate cons in bulk</h2>
          <button onClick={handleClose} style={closeBtn}>×</button>
        </div>
        <p style={{ fontSize: 12.5, color: T.text3, margin: '0 0 14px' }}>
          Drop a stack of rate confirmation PDFs. Each one is read automatically — review the details, then add them all at once.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? T.blue : T.sep}`,
            background: dragOver ? T.blue + '10' : T.bg2,
            borderRadius: 12, padding: '22px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>
            Drop rate con PDFs here, or click to choose
          </div>
          <div style={{ fontSize: 11.5, color: T.text3, marginTop: 3 }}>Multiple files welcome</div>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        </div>

        {/* Default company */}
        {items.length > 0 && companies.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: T.text3, fontWeight: 600 }}>Carrier for all:</span>
            <select value={defaultCompany} onChange={e => setDefaultCompany(e.target.value)} style={selectS}>
              <option value="">Select carrier…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {needsCompany.length > 0 && (
              <span style={{ fontSize: 11.5, color: T.orange }}>
                {needsCompany.length} load{needsCompany.length > 1 ? 's' : ''} still need a carrier
              </span>
            )}
          </div>
        )}

        {/* Parsed list */}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {items.map(item => {
              const st = STATE_STYLE[item.state]
              const d = item.data
              return (
                <div key={item.id} style={{
                  border: `1px solid ${T.sep}`, borderRadius: 10, padding: '10px 12px', background: T.bg2,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 12, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.file.name}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: st.color, background: st.color + '20',
                      padding: '2px 8px', borderRadius: 10, flexShrink: 0,
                    }}>{st.label}</span>
                  </div>

                  {item.error && (
                    <div style={{ fontSize: 11.5, color: T.red, marginTop: 5 }}>{item.error}</div>
                  )}

                  {d && ['parsed', 'creating', 'created', 'duplicate'].includes(item.state) && (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, fontSize: 12 }}>
                        <span style={{ fontWeight: 700, color: T.text }}>
                          #{d.broker_order || d.load_number || '—'}
                        </span>
                        <span style={{ color: T.text2 }}>{d.broker_name || '—'}</span>
                        <span style={{ color: T.text2 }}>
                          {[d.pickup_city, d.pickup_state].filter(Boolean).join(', ') || '—'}
                          {' → '}
                          {[d.delivery_city, d.delivery_state].filter(Boolean).join(', ') || '—'}
                        </span>
                        {d.rate && <span style={{ color: T.green, fontWeight: 700 }}>${Number(d.rate).toLocaleString()}</span>}
                      </div>
                      {item.state === 'parsed' && companies.length > 0 && (
                        <select
                          value={d.company_id || ''}
                          onChange={e => setField(item.id, 'company_id', e.target.value)}
                          style={{ ...selectS, marginTop: 7, fontSize: 11.5 }}
                        >
                          <option value="">
                            {defaultCompany
                              ? `Use carrier above (${companies.find(c => String(c.id) === String(defaultCompany))?.name || ''})`
                              : 'Select carrier…'}
                          </option>
                          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {createdCount > 0 && (
            <span style={{ fontSize: 12.5, color: T.green, fontWeight: 600, marginRight: 'auto' }}>
              {createdCount} load{createdCount > 1 ? 's' : ''} added
            </span>
          )}
          <button onClick={handleClose} style={secBtn}>{createdCount ? "Done" : "Cancel"}</button>
          <button
            onClick={createAll}
            disabled={working || readyItems.length === 0 || needsCompany.length > 0}
            style={{
              ...primaryBtn,
              opacity: (working || readyItems.length === 0 || needsCompany.length > 0) ? 0.5 : 1,
              cursor: (working || readyItems.length === 0 || needsCompany.length > 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {working ? 'Working…' : `Add ${readyItems.length || ''} load${readyItems.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16, overflowY: 'auto' }
const modalBox = { background: T.bg1, borderRadius: 16, padding: '22px 24px 24px', width: '100%', maxWidth: 760, border: `1px solid ${T.sep}`, maxHeight: '90vh', overflowY: 'auto' }
const closeBtn = { background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: T.text3, lineHeight: 1 }
const selectS = { padding: '7px 10px', border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 12.5, background: T.bg1, color: T.text, outline: 'none' }
const primaryBtn = { padding: '10px 20px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, fontWeight: 600, fontSize: 13 }
const secBtn = { padding: '10px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
