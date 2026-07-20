import React, { useRef, useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

// One document read per API call — keep a couple in flight, not the whole stack.
const CONCURRENCY = 2

const DOC_TYPES = ['BOL', 'POD', 'Lumper', 'Scale Ticket', 'Invoice', 'Rate Con', 'Other']

const STATE_STYLE = {
  queued:   { label: 'Queued',    color: T.text3 },
  reading:  { label: 'Reading…',  color: T.blue },
  matched:  { label: 'Matched',   color: T.green },
  unsure:   { label: 'Pick load', color: T.orange },
  nomatch:  { label: 'No match',  color: T.orange },
  attaching:{ label: 'Filing…',   color: T.blue },
  attached: { label: 'Filed',     color: T.green },
  error:    { label: 'Failed',    color: T.red },
}

function lane(l) {
  const from = [l.pickup_city, l.pickup_state].filter(Boolean).join(', ')
  const to = [l.delivery_city, l.delivery_state].filter(Boolean).join(', ')
  return `${from || '—'} → ${to || '—'}`
}

export default function DocInbox({ onClose, onDone }) {
  const [items, setItems] = useState([]) // { id, file, state, staged, candidates, chosen, docType, error }
  const [dragOver, setDragOver] = useState(false)
  const [working, setWorking] = useState(false)
  const inputRef = useRef(null)
  const nextId = useRef(1)

  function addFiles(fileList) {
    const files = Array.from(fileList).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!files.length) return
    const added = files.map(f => ({
      id: nextId.current++, file: f, state: 'queued',
      staged: null, candidates: [], chosen: '', docType: 'BOL', error: '', extracted: null,
    }))
    setItems(prev => [...prev, ...added])
    readAll(added)
  }

  async function readAll(queue) {
    setWorking(true)
    const pending = [...queue]
    async function worker() {
      while (pending.length) {
        const item = pending.shift()
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, state: 'reading' } : i))
        try {
          const res = await api.matchDoc(item.file)
          const best = res.candidates?.[0]
          setItems(prev => prev.map(i => i.id === item.id ? {
            ...i,
            state: !best ? 'nomatch' : res.confident ? 'matched' : 'unsure',
            staged: { filename: res.staged_filename, original_name: res.original_name },
            candidates: res.candidates || [],
            chosen: res.confident && best ? String(best.load.id) : '',
            docType: res.suggested_doc_type || 'BOL',
            extracted: res.extracted || null,
          } : i))
        } catch (err) {
          setItems(prev => prev.map(i => i.id === item.id
            ? { ...i, state: 'error', error: err.message || 'Could not read this document' } : i))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))
    setWorking(false)
  }

  function setItem(id, patch) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }

  const fileable = items.filter(i => ['matched', 'unsure', 'nomatch'].includes(i.state) && i.chosen)

  async function fileAll() {
    setWorking(true)
    for (const item of fileable) {
      setItem(item.id, { state: 'attaching' })
      try {
        await api.attachDoc(item.staged.filename, item.staged.original_name, Number(item.chosen), item.docType)
        setItem(item.id, { state: 'attached' })
      } catch (err) {
        setItem(item.id, { state: 'error', error: err.message })
      }
    }
    setWorking(false)
    onDone?.()
  }

  async function handleClose() {
    // Clean up anything staged on the server but never filed
    const orphans = items.filter(i => i.staged && i.state !== 'attached')
    await Promise.allSettled(orphans.map(i => api.discardDoc(i.staged.filename)))
    onClose()
  }

  const filedCount = items.filter(i => i.state === 'attached').length

  return (
    <div style={modalBg} onClick={handleClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Document drop box</h2>
          <button onClick={handleClose} style={closeBtn}>×</button>
        </div>
        <p style={{ fontSize: 12.5, color: T.text3, margin: '0 0 14px' }}>
          Drop BOLs, PODs, or lumper receipts. Each document is read and matched to the load it belongs to — confirm the match and it gets filed against that load.
        </p>

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
            Drop BOLs / PODs here, or click to choose
          </div>
          <div style={{ fontSize: 11.5, color: T.text3, marginTop: 3 }}>Multiple files welcome</div>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        </div>

        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {items.map(item => {
              const st = STATE_STYLE[item.state]
              const done = item.state === 'attached'
              return (
                <div key={item.id} style={{
                  border: `1px solid ${item.state === 'unsure' ? T.orange + '55' : T.sep}`,
                  borderRadius: 10, padding: '10px 12px', background: T.bg2, opacity: done ? 0.65 : 1,
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

                  {item.error && <div style={{ fontSize: 11.5, color: T.red, marginTop: 5 }}>{item.error}</div>}

                  {item.extracted && (
                    <div style={{ fontSize: 11.5, color: T.text3, marginTop: 5 }}>
                      {[
                        item.extracted.bol_number && `BOL ${item.extracted.bol_number}`,
                        item.extracted.po_number && `PO ${item.extracted.po_number}`,
                        item.extracted.load_number && `Load ${item.extracted.load_number}`,
                        item.extracted.delivery_city,
                      ].filter(Boolean).join(' · ') || 'No reference numbers found'}
                    </div>
                  )}

                  {!done && item.candidates.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {item.candidates.map(c => {
                        const selected = String(item.chosen) === String(c.load.id)
                        return (
                          <button
                            key={c.load.id}
                            onClick={() => setItem(item.id, { chosen: selected ? '' : String(c.load.id) })}
                            style={{
                              textAlign: 'left', cursor: 'pointer', borderRadius: 8, padding: '7px 9px',
                              background: selected ? T.blue + '18' : T.bg1,
                              border: `1px solid ${selected ? T.blue : T.sep}`,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
                                #{c.load.load_number || c.load.broker_order || c.load.id}
                                {c.load.driver_name && <span style={{ fontWeight: 500, color: T.text3 }}> · {c.load.driver_name}</span>}
                              </span>
                              <span style={{ fontSize: 10, color: T.text3 }}>{c.reasons[0] || ''}</span>
                            </div>
                            <div style={{ fontSize: 11.5, color: T.text2, marginTop: 2 }}>{lane(c.load)}</div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {!done && item.state === 'nomatch' && (
                    <div style={{ fontSize: 11.5, color: T.text3, marginTop: 6 }}>
                      No load looked like a match. File it from the load's own page instead.
                    </div>
                  )}

                  {!done && item.chosen && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 11.5, color: T.text3, fontWeight: 600 }}>File as</span>
                      <select value={item.docType} onChange={e => setItem(item.id, { docType: e.target.value })} style={selectS}>
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {filedCount > 0 && (
            <span style={{ fontSize: 12.5, color: T.green, fontWeight: 600, marginRight: 'auto' }}>
              {filedCount} document{filedCount > 1 ? 's' : ''} filed
            </span>
          )}
          <button onClick={handleClose} style={secBtn}>{filedCount ? 'Done' : 'Cancel'}</button>
          <button
            onClick={fileAll}
            disabled={working || fileable.length === 0}
            style={{
              ...primaryBtn,
              opacity: (working || fileable.length === 0) ? 0.5 : 1,
              cursor: (working || fileable.length === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {working ? 'Working…' : `File ${fileable.length || ''} document${fileable.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16, overflowY: 'auto' }
const modalBox = { background: T.bg1, borderRadius: 16, padding: '22px 24px 24px', width: '100%', maxWidth: 760, border: `1px solid ${T.sep}`, maxHeight: '90vh', overflowY: 'auto' }
const closeBtn = { background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: T.text3, lineHeight: 1 }
const selectS = { padding: '5px 9px', border: `1px solid ${T.sep}`, borderRadius: 7, fontSize: 11.5, background: T.bg1, color: T.text, outline: 'none' }
const primaryBtn = { padding: '10px 20px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, fontWeight: 600, fontSize: 13 }
const secBtn = { padding: '10px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
