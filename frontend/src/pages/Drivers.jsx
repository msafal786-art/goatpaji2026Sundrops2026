import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T, STATUS } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const EMPTY = {
  full_name: '', phone: '', email: '', address: '', date_of_birth: '',
  hire_date: '', status: 'available', company_id: '',
  cdl_class: '', license_state: '', license_number: '', license_expiry: '',
  medical_card_expiry: '', drug_test_date: '', drug_test_expiry: '', background_check_date: '',
  emergency_contact_name: '', emergency_contact_phone: '',
  notes: '', username: '', password: '',
}

const LOAD_STATUSES = {
  open: { label: 'Open', color: T.text3 },
  covered: { label: 'Covered', color: '#5ac8fa' },
  dispatched: { label: 'Dispatched', color: T.blue },
  loading: { label: 'Loading', color: T.orange },
  on_route: { label: 'On Route', color: '#30d158' },
  unloading: { label: 'Unloading', color: T.orange },
  in_yard: { label: 'In Yard', color: '#bf5af2' },
  delivered: { label: 'Delivered', color: T.green },
  completed: { label: 'Completed', color: T.green },
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr + 'T00:00') - new Date()) / 864e5)
}

function fmt(city, state) {
  if (city && state) return `${city}, ${state}`
  return city || state || ''
}

function fmtDate(d) {
  if (!d) return ''
  const parts = d.split('-')
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`
  return d
}

export default function Drivers() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [companies, setCompanies] = useState([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(null) // null = All
  const [sortAsc, setSortAsc] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [loginMsg, setLoginMsg] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const data = await api.driversBoard()
    setRows(data)
  }, [])

  useEffect(() => {
    load()
    // All dispatchers need companies — for filter tabs AND the edit form
    if (user.role === 'dispatcher' || user.role === 'company_owner') api.companies().then(setCompanies)
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [load])

  function openNew() { setForm({ ...EMPTY }); setEditing(null); setShow(true); setError('') }
  function openEdit(d) {
    setForm({ ...EMPTY, ...d, password: '', username: d.username || '' })
    setEditing(d); setShow(true); setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (editing) {
        if (form.password) {
          if (!editing.user_id) {
            if (!form.username) { setError('Username required to create login'); setSaving(false); return }
            await api.createDriverLogin(editing.id, form.username, form.password)
          } else {
            await api.resetDriverPassword(editing.id, form.password)
          }
          setLoginMsg({ name: editing.full_name || form.full_name, username: form.username || editing.username, password: form.password })
        }
        await api.updateDriver(editing.id, form)
      } else {
        await api.createDriver(form)
      }
      setShow(false)
      load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this driver?')) return
    await api.deleteDriver(id)
    setRows(rs => rs.filter(r => r.id !== id))
  }

  async function handleToggleActive(id) {
    const res = await api.toggleDriverActive(id)
    setRows(rs => rs.map(r => r.id === id ? { ...r, is_active: res.is_active } : r))
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const mobile = useIsMobile()
  const isAdmin = user.role === 'dispatcher' && !user.company_id

  // Companies that actually have drivers in this data set
  const companiesWithDrivers = companies.filter(c =>
    rows.some(r => r.company_id === c.id)
  )

  const filtered = rows
    .filter(r => {
      if (!showInactive && r.is_active === 0) return false
      if (selectedCompanyId && r.company_id !== selectedCompanyId) return false
      if (!search) return true
      return (
        r.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.company_name || '').toLowerCase().includes(search.toLowerCase()) ||
        (r.load_number || '').includes(search) ||
        (r.broker_name || '').toLowerCase().includes(search.toLowerCase())
      )
    })
    .sort((a, b) => {
      // Active always before inactive
      if (a.is_active !== b.is_active) return b.is_active - a.is_active
      const cmp = a.full_name.localeCompare(b.full_name)
      return sortAsc ? cmp : -cmp
    })

  // Group by company (only shown when "All" is selected)
  const showGroups = !selectedCompanyId
  const grouped = {}
  filtered.forEach(r => {
    const key = showGroups ? (r.company_name || 'Unknown') : 'all'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(r)
  })

  const selectedCompanyName = selectedCompanyId
    ? (companies.find(c => c.id === selectedCompanyId)?.name || '')
    : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ fontSize: mobile ? 18 : 22, fontWeight: 700, color: T.text, letterSpacing: -0.4, margin: 0 }}>
          Driver Board
          {selectedCompanyName && (
            <span style={{ fontSize: 14, fontWeight: 500, color: T.blue, marginLeft: 10 }}>— {selectedCompanyName}</span>
          )}
        </h1>
        <button style={primaryBtn()} onClick={openNew}>+ Add Driver</button>
      </div>

      {/* Company filter tabs — only shown to admin dispatcher */}
      {isAdmin && companiesWithDrivers.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          <button
            onClick={() => setSelectedCompanyId(null)}
            style={tabBtn(selectedCompanyId === null)}
          >
            All Companies
          </button>
          {companiesWithDrivers.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCompanyId(c.id)}
              style={tabBtn(selectedCompanyId === c.id)}
            >
              {c.name.replace(/ INC$| LLC$| LTD$/i, '')}
              <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.7 }}>
                {rows.filter(r => r.company_id === c.id).length}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputS(), maxWidth: 260 }}
          placeholder="Search drivers, loads, broker…"
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <button onClick={() => setSortAsc(a => !a)} style={tabBtn(false)} title="Toggle sort order">
          A–Z {sortAsc ? '↑' : '↓'}
        </button>
        <button onClick={() => setShowInactive(s => !s)} style={tabBtn(showInactive)}>
          {showInactive ? 'Hide Inactive' : 'Show Inactive'}
        </button>
      </div>

      {/* Mobile card view */}
      {mobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(grouped).map(([company, drivers]) => (
            <React.Fragment key={company}>
              {showGroups && (
                <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, letterSpacing: 0.5, padding: '6px 4px 2px', textTransform: 'uppercase' }}>
                  {company}
                </div>
              )}
              {drivers.map(r => {
                const isDisabled = r.is_active === 0
                const sc = STATUS[r.status] || STATUS.available
                const ls = r.load_status ? (LOAD_STATUSES[r.load_status] || {}) : null
                const hasLoad = !!r.load_id
                let extraStops = []
                try { extraStops = r.extra_stops ? JSON.parse(r.extra_stops) : [] } catch {}
                return (
                  <div key={r.id} style={{ background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 12, padding: '12px 14px', opacity: isDisabled ? 0.55 : 1 }}>
                    {/* Top row: name + status + actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>{r.full_name}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: sc.color, background: sc.color + '20', padding: '2px 8px', borderRadius: 10 }}>{sc.label}</span>
                          {r.phone && (
                            <a href={`tel:${r.phone}`} style={{ fontSize: 12, color: T.blue, textDecoration: 'none' }}>{r.phone}</a>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                        {!isDisabled && <button style={smBtn()} onClick={() => openEdit(r)}>Edit</button>}
                        <button style={smBtn(isDisabled ? T.green : T.orange)} onClick={() => handleToggleActive(r.id)}>
                          {isDisabled ? 'On' : 'Off'}
                        </button>
                      </div>
                    </div>
                    {/* Load info */}
                    {hasLoad ? (
                      <div style={{ background: T.bg2, borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <button
                            onClick={() => navigate(`/loads/${r.load_id}`)}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.blue, fontWeight: 700, fontSize: 13 }}
                          >
                            #{r.load_number}
                          </button>
                          <span style={{ fontSize: 13, fontWeight: 700, color: T.green }}>${Number(r.rate || 0).toLocaleString()}</span>
                        </div>
                        {ls && <div style={{ fontSize: 10, color: ls.color, fontWeight: 600, marginBottom: 4 }}>{ls.label}</div>}
                        <div style={{ fontSize: 11, color: T.text2, marginBottom: 2 }}>
                          <span style={{ color: T.text3 }}>PU </span>
                          {fmt(r.pickup_city, r.pickup_state)}
                          {r.pickup_date && <span style={{ color: T.blue, marginLeft: 4 }}>{fmtDate(r.pickup_date)}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: T.text2 }}>
                          <span style={{ color: T.text3 }}>DR </span>
                          {fmt(r.delivery_city, r.delivery_state)}
                          {r.delivery_date && <span style={{ color: T.orange, marginLeft: 4 }}>{fmtDate(r.delivery_date)}</span>}
                        </div>
                        {extraStops.map((s, i) => (
                          <div key={i} style={{ fontSize: 11, color: T.text2 }}>
                            <span style={{ color: T.text3 }}>DR{i + 2} </span>
                            {fmt(s.city, s.state)}
                            {s.date && <span style={{ color: T.orange, marginLeft: 4 }}>{fmtDate(s.date)}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      !isDisabled && (
                        <button
                          onClick={() => navigate('/loads/new')}
                          style={{ width: '100%', padding: '7px', background: 'none', border: `1px dashed ${T.sep}`, color: T.text3, borderRadius: 8, fontSize: 12, cursor: 'pointer', marginTop: 4 }}
                        >
                          + Assign Load
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </React.Fragment>
          ))}
          {filtered.length === 0 && <div style={{ padding: 30, color: T.text3, textAlign: 'center' }}>No drivers found.</div>}
        </div>
      ) : (
      /* Desktop spreadsheet table */
      <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${T.sep}`, background: T.bg1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
          <thead>
            <tr style={{ background: T.bg2, borderBottom: `2px solid ${T.sep}` }}>
              {['Driver', 'Status', 'Phone', 'Load #', 'Broker', 'Pickup', 'Drop(s)', 'Rate', ''].map((h, i) => (
                <th key={i} style={{
                  padding: '10px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700,
                  color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8,
                  whiteSpace: 'nowrap', position: 'sticky', top: 0, background: T.bg2,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(grouped).map(([company, drivers]) => (
              <React.Fragment key={company}>
                {showGroups && (
                  <tr style={{ background: T.blue + '12' }}>
                    <td colSpan={9} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: T.blue, letterSpacing: 0.5 }}>
                      {company}
                    </td>
                  </tr>
                )}
                {drivers.map((r, idx) => {
                  const isDisabled = r.is_active === 0
                  const sc = STATUS[r.status] || STATUS.available
                  const ls = r.load_status ? (LOAD_STATUSES[r.load_status] || {}) : null
                  const hasLoad = !!r.load_id

                  let extraStops = []
                  try { extraStops = r.extra_stops ? JSON.parse(r.extra_stops) : [] } catch {}

                  return (
                    <tr key={r.id} style={{
                      background: isDisabled ? T.bg2 : idx % 2 === 0 ? T.bg1 : T.bg2 + 'aa',
                      opacity: isDisabled ? 0.5 : 1,
                      borderBottom: `1px solid ${T.sep}`,
                    }}>
                      <td style={{ padding: '10px 12px', minWidth: 140 }}>
                        <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{r.full_name}</div>
                        {isDisabled && <span style={{ fontSize: 9, fontWeight: 700, color: T.orange, background: T.orange + '20', padding: '1px 5px', borderRadius: 4 }}>DISABLED</span>}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sc.color, background: sc.color + '20', padding: '2px 8px', borderRadius: 10 }}>
                          {sc.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: T.text2, whiteSpace: 'nowrap' }}>
                        {r.phone || <span style={{ color: T.text3 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', minWidth: 90 }}>
                        {hasLoad ? (
                          <div>
                            <button onClick={() => navigate(`/loads/${r.load_id}`)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.blue, fontWeight: 700, fontSize: 12.5, textDecoration: 'underline' }}>
                              #{r.load_number}
                            </button>
                            {ls && <div style={{ fontSize: 10, color: ls.color, fontWeight: 600, marginTop: 2 }}>{ls.label}</div>}
                          </div>
                        ) : (
                          <button onClick={() => navigate('/loads/new')} style={{ background: 'none', border: `1px dashed ${T.sep}`, padding: '3px 8px', cursor: 'pointer', color: T.text3, fontSize: 11, borderRadius: 6 }}>
                            + Assign
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: T.text2, maxWidth: 130 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {hasLoad ? (r.broker_name || <span style={{ color: T.text3 }}>—</span>) : <span style={{ color: T.text3 }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', minWidth: 160 }}>
                        {hasLoad ? (
                          <div>
                            <div style={{ fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                              {r.pickup_name || <span style={{ color: T.text3, fontWeight: 400 }}>—</span>}
                            </div>
                            <div style={{ color: T.text3, fontSize: 11, marginTop: 1 }}>
                              {fmt(r.pickup_city, r.pickup_state)}
                              {r.pickup_date && <span style={{ marginLeft: 4, color: T.blue }}>{fmtDate(r.pickup_date)}</span>}
                            </div>
                          </div>
                        ) : <span style={{ color: T.text3 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', minWidth: 200 }}>
                        {hasLoad ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <DropLine label={extraStops.length > 0 ? 'Drop 1' : null} name={r.delivery_name} location={fmt(r.delivery_city, r.delivery_state)} date={r.delivery_date} />
                            {extraStops.map((s, i) => (
                              <DropLine key={i} label={`Drop ${i + 2}`} name={s.name} location={fmt(s.city, s.state)} date={s.date} />
                            ))}
                          </div>
                        ) : <span style={{ color: T.text3 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 600, color: T.green }}>
                        {hasLoad && r.rate ? `$${Number(r.rate).toLocaleString()}` : <span style={{ color: T.text3, fontWeight: 400 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 5 }}>
                          {!isDisabled && <button style={smBtn()} onClick={() => openEdit(r)}>Edit</button>}
                          {hasLoad && <button style={smBtn(T.blue)} onClick={() => navigate(`/loads/${r.load_id}`)}>Load</button>}
                          <button style={smBtn(isDisabled ? T.green : T.orange)} onClick={() => handleToggleActive(r.id)}>
                            {isDisabled ? 'Enable' : 'Disable'}
                          </button>
                          {isAdmin && <button style={smBtn(T.red)} onClick={() => handleDelete(r.id)}>✕</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 30, color: T.text3, textAlign: 'center' }}>No drivers found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Driver login copy modal */}
      {loginMsg && (() => {
        const msg = [
          `Hi ${loginMsg.name},`,
          ``,
          `Your driver portal is ready. Here's how to sign in:`,
          ``,
          `Sign in here: https://goatpaji.com/login`,
          `Username: ${loginMsg.username}`,
          loginMsg.password ? `Password: ${loginMsg.password}` : null,
          ``,
          `Open in Chrome on your phone or any browser.`,
          loginMsg.password ? `\nIf you have trouble signing in, contact your dispatcher.` : null,
        ].filter(l => l !== null).join('\n')

        async function copyMsg() {
          await navigator.clipboard.writeText(msg)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }

        return (
          <div style={modalBg()} onClick={() => setLoginMsg(null)}>
            <div style={modalBox()} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text, margin: 0 }}>Driver Login Info</h2>
                <button onClick={() => setLoginMsg(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
              </div>
              <div style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
                Copy this and send it to the driver via text or WhatsApp.
                {loginMsg.password && <span style={{ color: T.orange }}> Password will not be shown again once you close this.</span>}
              </div>
              <pre style={{ background: T.bg2, border: `1px solid ${T.sep}`, borderRadius: 10, padding: '14px 16px', fontSize: 13, color: T.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{msg}</pre>
              <button onClick={copyMsg} style={{ marginTop: 14, width: '100%', padding: '12px', background: copied ? T.green : T.blue, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {copied ? '✓ Copied!' : 'Copy to Clipboard'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Add / Edit modal */}
      {show && (
        <div style={modalBg()} onClick={() => setShow(false)}>
          <div style={modalBox()} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{editing ? 'Edit Driver' : 'Add Driver'}</h2>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>

              <Section label="Personal Info">
                <Row>
                  <FField label="Full Name *"><input style={inputS()} required value={form.full_name} onChange={e => set('full_name', e.target.value)} /></FField>
                  <FField label="Date of Birth"><input style={inputS()} type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></FField>
                </Row>
                <Row>
                  <FField label="Phone"><input style={inputS()} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></FField>
                  <FField label="Email"><input style={inputS()} type="email" value={form.email} onChange={e => set('email', e.target.value)} /></FField>
                </Row>
                <FField label="Home Address" style={{ marginBottom: 12 }}>
                  <input style={inputS()} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street, City, State, ZIP" />
                </FField>
              </Section>

              <Section label="Employment">
                <Row>
                  {user.role === 'dispatcher' && (
                    <FField label="Company *">
                      <select style={{ ...inputS(), borderColor: !form.company_id ? T.orange : T.sep }} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
                        <option value="">— Select Company —</option>
                        {companies.filter(c => c.id !== 26).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        {companies.filter(c => c.id === 26).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {!form.company_id && <div style={{ fontSize: 10, color: T.orange, marginTop: 3 }}>Please assign to a company</div>}
                    </FField>
                  )}
                  <FField label="Hire Date"><input style={inputS()} type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} /></FField>
                  {editing && (
                    <FField label="Status">
                      <select style={inputS()} value={form.status} onChange={e => set('status', e.target.value)}>
                        <option value="available">Available</option>
                        <option value="on_load">On Load</option>
                        <option value="off_duty">Off Duty</option>
                      </select>
                    </FField>
                  )}
                </Row>
              </Section>

              <Section label="Licensing & Compliance">
                <Row>
                  <FField label="CDL Class">
                    <select style={inputS()} value={form.cdl_class} onChange={e => set('cdl_class', e.target.value)}>
                      <option value="">Select…</option>
                      {['A','B','C'].map(c => <option key={c} value={c}>Class {c}</option>)}
                    </select>
                  </FField>
                  <FField label="License State"><input style={inputS()} value={form.license_state} onChange={e => set('license_state', e.target.value)} placeholder="e.g. CA" maxLength={2} /></FField>
                  <FField label="License #"><input style={inputS()} value={form.license_number} onChange={e => set('license_number', e.target.value)} /></FField>
                </Row>
                <Row>
                  <FField label="License Expiry"><input style={inputS()} type="date" value={form.license_expiry} onChange={e => set('license_expiry', e.target.value)} /></FField>
                  <FField label="Med Card Expiry"><input style={inputS()} type="date" value={form.medical_card_expiry} onChange={e => set('medical_card_expiry', e.target.value)} /></FField>
                </Row>
                <Row>
                  <FField label="Drug Test Date"><input style={inputS()} type="date" value={form.drug_test_date} onChange={e => set('drug_test_date', e.target.value)} /></FField>
                  <FField label="Drug Test Expiry"><input style={inputS()} type="date" value={form.drug_test_expiry} onChange={e => set('drug_test_expiry', e.target.value)} /></FField>
                </Row>
                <Row>
                  <FField label="Background Check Date"><input style={inputS()} type="date" value={form.background_check_date} onChange={e => set('background_check_date', e.target.value)} /></FField>
                </Row>
              </Section>

              <Section label="Emergency Contact">
                <Row>
                  <FField label="Name"><input style={inputS()} value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} /></FField>
                  <FField label="Phone"><input style={inputS()} type="tel" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} /></FField>
                </Row>
              </Section>

              <Section label={editing?.user_id ? 'Portal Login (Reset Password)' : 'Portal Login'}>
                <div style={{ fontSize: 12, color: T.text3, marginBottom: 10 }}>
                  {editing?.user_id
                    ? 'Driver already has a portal login. Enter a new password below to reset it, or leave blank to keep current.'
                    : 'Give the driver a login to access their loads at goatpaji.com. Leave blank to skip.'}
                </div>
                <Row>
                  {!editing?.user_id && (
                    <FField label="Username">
                      <input style={inputS()} value={form.username} onChange={e => set('username', e.target.value)} placeholder="e.g. rahul.bhatia" autoComplete="off" />
                    </FField>
                  )}
                  {editing?.user_id && (
                    <FField label="Current Username">
                      <input style={{ ...inputS(), opacity: 0.5 }} value={editing.username || '(set)'} readOnly />
                    </FField>
                  )}
                  <FField label={editing?.user_id ? 'New Password' : 'Password'}>
                    <input style={inputS()} type="password" value={form.password} onChange={e => set('password', e.target.value)}
                      placeholder={editing?.user_id ? 'Leave blank to keep' : 'Min 8 characters'} autoComplete="new-password" />
                  </FField>
                </Row>
              </Section>

              <FField label="Notes">
                <textarea style={{ ...inputS(), height: 64, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </FField>

              {error && <div style={{ color: T.red, fontSize: 12, margin: '12px 0', padding: '9px 12px', background: T.red + '12', borderRadius: 8 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button type="button" style={secBtn()} onClick={() => setShow(false)}>Cancel</button>
                <button type="submit" style={primaryBtn()} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Driver'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function DropLine({ label, name, location, date }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
      {label && <span style={{ fontSize: 9.5, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>{label}:</span>}
      <div>
        <div style={{ fontWeight: 600, color: T.text, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
          {name || <span style={{ color: T.text3, fontWeight: 400 }}>—</span>}
        </div>
        <div style={{ color: T.text3, fontSize: 11 }}>
          {location}
          {date && <span style={{ marginLeft: 4, color: T.orange }}>{fmtDate(date)}</span>}
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.sep}` }}>{label}</div>
      {children}
    </div>
  )
}

function Row({ children }) { return <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>{children}</div> }

function FField({ label, children, style: extraStyle }) {
  return (
    <div style={{ flex: 1, minWidth: 140, ...extraStyle }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const tabBtn    = (active) => ({
  padding: '6px 14px', border: `1px solid ${active ? T.blue : T.sep}`,
  borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 500,
  background: active ? T.blue : T.bg2, color: active ? '#fff' : T.text2,
  transition: 'all 0.15s',
})
const primaryBtn = () => ({ padding: '10px 20px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 })
const secBtn    = () => ({ padding: '10px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 })
const smBtn     = (color) => ({ padding: '4px 10px', background: color ? color + '15' : T.bg2, color: color || T.text2, border: `1px solid ${color ? color + '40' : T.sep}`, borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 })
const inputS    = () => ({ width: '100%', padding: '9px 11px', border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' })
const modalBg   = () => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '20px 0 0' })
const modalBox  = () => ({ background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px 24px 32px', width: '100%', maxWidth: 620, border: `1px solid ${T.sep}`, maxHeight: '94vh', overflowY: 'auto' })
