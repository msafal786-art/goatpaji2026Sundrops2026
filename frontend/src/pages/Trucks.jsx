import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { T } from '../theme.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const EMPTY = {
  tractor_number: '', trailer_number: '', trailer_type: '53 ft. Van', vin: '',
  plate: '', registration_expiry: '', insurance_expiry: '', notes: '', company_id: '', status: 'available'
}

const MAINT_EMPTY = { service_type: 'Oil Change', service_date: '', mileage: '', notes: '', next_due_date: '', next_due_mileage: '' }
const SERVICE_TYPES = ['Oil Change', 'Annual Inspection', 'Tire Rotation', 'Brake Service', 'Transmission', 'Coolant Flush', 'Air Filter', 'Other']

function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function DueBadge({ label, dateStr, mileage }) {
  const days = daysUntil(dateStr)
  if (days === null && !mileage) return null
  let color = T.green, text = ''
  if (days !== null) {
    if (days < 0) { color = T.red; text = `${label} overdue ${Math.abs(days)}d` }
    else if (days <= 14) { color = T.red; text = `${label} due in ${days}d` }
    else if (days <= 30) { color = T.orange; text = `${label} due in ${days}d` }
    else if (days <= 60) { color = T.orange; text = `${label} due ~${Math.round(days/7)}w` }
    else { return null }
  }
  if (!text && mileage) text = `${label} due @ ${Number(mileage).toLocaleString()} mi`
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px',
      borderRadius: 6, background: color + '22', color, border: `1px solid ${color}40`,
      marginTop: 4, marginRight: 4,
    }}>{text}</span>
  )
}

export default function Trucks() {
  const { user } = useAuth()
  const [trucks, setTrucks] = useState([])
  const [companies, setCompanies] = useState([])
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Maintenance state
  const [maintTruck, setMaintTruck] = useState(null)   // truck whose maint panel is open
  const [maintRecords, setMaintRecords] = useState([])
  const [showMaintForm, setShowMaintForm] = useState(false)
  const [maintForm, setMaintForm] = useState({ ...MAINT_EMPTY })
  const [maintSaving, setMaintSaving] = useState(false)

  useEffect(() => {
    load()
    if (user.role === 'dispatcher') api.companies().then(setCompanies)
  }, [])

  async function load() { setTrucks(await api.trucks()) }
  function openNew() { setForm({ ...EMPTY }); setEditing(null); setShow(true); setError('') }
  function openEdit(t) { setForm({ ...EMPTY, ...t }); setEditing(t); setShow(true); setError('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (editing) {
        const updated = await api.updateTruck(editing.id, form)
        setTrucks(ts => ts.map(t => t.id === editing.id ? updated : t))
      } else {
        const created = await api.createTruck(form)
        setTrucks(ts => [created, ...ts])
      }
      setShow(false)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this truck?')) return
    await api.deleteTruck(id)
    setTrucks(ts => ts.filter(t => t.id !== id))
  }

  async function openMaintenance(truck) {
    setMaintTruck(truck)
    setShowMaintForm(false)
    setMaintForm({ ...MAINT_EMPTY })
    const records = await api.maintenance({ truck_id: truck.id })
    setMaintRecords(records)
  }

  async function handleAddMaint(e) {
    e.preventDefault()
    setMaintSaving(true)
    try {
      await api.createMaintenance({ ...maintForm, truck_id: maintTruck.id })
      const records = await api.maintenance({ truck_id: maintTruck.id })
      setMaintRecords(records)
      setShowMaintForm(false)
      setMaintForm({ ...MAINT_EMPTY })
    } catch (err) { alert(err.message) }
    finally { setMaintSaving(false) }
  }

  async function handleDeleteMaint(id) {
    if (!confirm('Remove this record?')) return
    await api.deleteMaintenance(id)
    setMaintRecords(r => r.filter(m => m.id !== id))
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function mset(k, v) { setMaintForm(f => ({ ...f, [k]: v })) }

  const mobile = useIsMobile()
  const inp = () => ({ width: '100%', padding: '9px 11px', border: `1px solid ${T.sep}`, borderRadius: 8, fontSize: 13, background: T.bg2, color: T.text, outline: 'none', boxSizing: 'border-box' })
  const primaryBtn = () => ({ padding: '9px 18px', background: T.blue, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 })
  const secBtn = () => ({ padding: '9px 16px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 })
  const smBtn = () => ({ padding: '6px 12px', background: T.bg2, color: T.text2, border: `1px solid ${T.sep}`, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 })
  const mBg = () => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, overflowY: 'auto' })
  const mBox = () => ({ background: T.bg1, borderRadius: '18px 18px 0 0', padding: '24px', width: '100%', maxWidth: 560, border: `1px solid ${T.sep}`, maxHeight: '92vh', overflowY: 'auto' })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>Trucks & Trailers</h1>
        <button style={primaryBtn()} onClick={openNew}>+ Add</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {trucks.map(t => {
          const regDays = daysUntil(t.registration_expiry)
          const insDays = daysUntil(t.insurance_expiry)
          const regAlert = regDays !== null && regDays <= 60
          const insAlert = insDays !== null && insDays <= 60
          const borderColor = (regAlert || insAlert) ? T.orange : T.sep
          return (
            <div key={t.id} style={{ background: T.bg1, borderRadius: 14, padding: '16px 18px', border: `1px solid ${borderColor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Tractor #{t.tractor_number}</div>
                  {t.trailer_number && <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>Trailer #{t.trailer_number} — {t.trailer_type}</div>}
                  {!t.trailer_number && t.trailer_type && <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>{t.trailer_type}</div>}
                  {t.company_name && <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{t.company_name}</div>}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: t.status === 'maintenance' ? T.orange : t.status === 'on_load' ? T.blue : T.green, background: (t.status === 'maintenance' ? T.orange : t.status === 'on_load' ? T.blue : T.green) + '22', padding: '3px 9px', borderRadius: 20 }}>
                  {t.status === 'maintenance' ? 'Maintenance' : t.status === 'on_load' ? 'On Load' : 'Available'}
                </span>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: T.text2, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {t.plate && <span>Plate: {t.plate}</span>}
                {t.registration_expiry && (
                  <span style={{ color: regAlert ? T.orange : T.text2 }}>Reg exp: {t.registration_expiry}</span>
                )}
                {t.insurance_expiry && (
                  <span style={{ color: insAlert ? T.orange : T.text2 }}>Ins exp: {t.insurance_expiry}</span>
                )}
              </div>

              {/* Expiry alerts */}
              <div style={{ marginTop: 6 }}>
                {regAlert && <DueBadge label="Registration" dateStr={t.registration_expiry} />}
                {insAlert && <DueBadge label="Insurance" dateStr={t.insurance_expiry} />}
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={smBtn()} onClick={() => openEdit(t)}>Edit</button>
                <button style={{ ...smBtn(), color: T.blue, borderColor: T.blue + '40' }} onClick={() => openMaintenance(t)}>Maintenance</button>
                {user.role === 'dispatcher' && (
                  <button style={{ ...smBtn(), color: T.red, borderColor: T.red + '40' }} onClick={() => handleDelete(t.id)}>Remove</button>
                )}
              </div>
            </div>
          )
        })}
        {trucks.length === 0 && <div style={{ color: T.text3, padding: 20 }}>No trucks yet.</div>}
      </div>

      {/* Add / Edit Truck modal */}
      {show && (
        <div style={mBg()} onClick={() => setShow(false)}>
          <div style={mBox()} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text }}>{editing ? 'Edit Truck' : 'Add Truck'}</h2>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <Row>
                <FF label="Tractor # *"><input style={inp()} required value={form.tractor_number} onChange={e => set('tractor_number', e.target.value)} /></FF>
                <FF label="Trailer #"><input style={inp()} value={form.trailer_number} onChange={e => set('trailer_number', e.target.value)} /></FF>
                <FF label="Trailer Type"><input style={inp()} value={form.trailer_type} onChange={e => set('trailer_type', e.target.value)} /></FF>
              </Row>
              <Row>
                <FF label="Plate"><input style={inp()} value={form.plate} onChange={e => set('plate', e.target.value)} /></FF>
                <FF label="VIN"><input style={inp()} value={form.vin} onChange={e => set('vin', e.target.value)} /></FF>
                {user.role === 'dispatcher' && (
                  <FF label="Company">
                    <select style={inp()} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
                      <option value="">Select…</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </FF>
                )}
              </Row>
              <Row>
                <FF label="Registration Expiry"><input style={inp()} type="date" value={form.registration_expiry} onChange={e => set('registration_expiry', e.target.value)} /></FF>
                <FF label="Insurance Expiry"><input style={inp()} type="date" value={form.insurance_expiry} onChange={e => set('insurance_expiry', e.target.value)} /></FF>
              </Row>
              {editing && (
                <Row>
                  <FF label="Status">
                    <select style={inp()} value={form.status} onChange={e => set('status', e.target.value)}>
                      <option value="available">Available</option>
                      <option value="on_load">On Load</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </FF>
                </Row>
              )}
              <FF label="Notes"><textarea style={{ ...inp(), height: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} /></FF>
              {error && <div style={{ color: T.red, fontSize: 12, margin: '10px 0' }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" style={secBtn()} onClick={() => setShow(false)}>Cancel</button>
                <button type="submit" style={primaryBtn()} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add Truck'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Maintenance panel */}
      {maintTruck && (
        <div style={mBg()} onClick={() => setMaintTruck(null)}>
          <div style={{ ...mBox(), maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text, margin: 0 }}>Maintenance — Tractor #{maintTruck.tractor_number}</h2>
                {maintTruck.trailer_number && <div style={{ fontSize: 12, color: T.text3, marginTop: 3 }}>Trailer #{maintTruck.trailer_number}</div>}
              </div>
              <button onClick={() => setMaintTruck(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: T.text3 }}>×</button>
            </div>

            {/* Alert summary */}
            {(() => {
              const upcoming = maintRecords.filter(r => {
                if (!r.next_due_date) return false
                const d = daysUntil(r.next_due_date)
                return d !== null && d <= 30
              })
              if (!upcoming.length) return null
              return (
                <div style={{ background: T.orange + '18', borderRadius: 10, padding: '12px 14px', marginBottom: 16, border: `1px solid ${T.orange}35` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.orange, marginBottom: 8 }}>Upcoming Service</div>
                  {upcoming.map(r => (
                    <div key={r.id} style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>
                      {r.service_type} — due {r.next_due_date} ({daysUntil(r.next_due_date)}d)
                      {r.next_due_mileage && ` or @ ${Number(r.next_due_mileage).toLocaleString()} mi`}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Add record button */}
            {!showMaintForm && (
              <button style={{ ...primaryBtn(), marginBottom: 16 }} onClick={() => setShowMaintForm(true)}>+ Log Service</button>
            )}

            {/* Add maintenance form */}
            {showMaintForm && (
              <form onSubmit={handleAddMaint} style={{ background: T.bg2, borderRadius: 12, padding: '16px', marginBottom: 16, border: `1px solid ${T.sep}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>Log Service Record</div>
                <Row>
                  <FF label="Service Type">
                    <select style={inp()} value={maintForm.service_type} onChange={e => mset('service_type', e.target.value)}>
                      {SERVICE_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </FF>
                  <FF label="Date *"><input style={inp()} type="date" required value={maintForm.service_date} onChange={e => mset('service_date', e.target.value)} /></FF>
                </Row>
                <Row>
                  <FF label="Current Mileage"><input style={inp()} placeholder="e.g. 145000" value={maintForm.mileage} onChange={e => mset('mileage', e.target.value)} /></FF>
                  <FF label="Next Due Date"><input style={inp()} type="date" value={maintForm.next_due_date} onChange={e => mset('next_due_date', e.target.value)} /></FF>
                  <FF label="Next Due Mileage"><input style={inp()} placeholder="e.g. 160000" value={maintForm.next_due_mileage} onChange={e => mset('next_due_mileage', e.target.value)} /></FF>
                </Row>
                <FF label="Notes"><textarea style={{ ...inp(), height: 56, resize: 'vertical' }} value={maintForm.notes} onChange={e => mset('notes', e.target.value)} /></FF>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="submit" style={primaryBtn()} disabled={maintSaving}>{maintSaving ? 'Saving…' : 'Save Record'}</button>
                  <button type="button" style={secBtn()} onClick={() => setShowMaintForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {/* Records list */}
            {maintRecords.length === 0 ? (
              <div style={{ fontSize: 13, color: T.text3, padding: '16px 0', textAlign: 'center' }}>No service records yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {maintRecords.map(r => (
                  <div key={r.id} style={{ background: T.bg2, borderRadius: 10, padding: '12px 14px', border: `1px solid ${T.sep}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{r.service_type}</div>
                        <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>{r.service_date}{r.mileage ? ` · ${Number(r.mileage).toLocaleString()} mi` : ''}</div>
                        {r.notes && <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>{r.notes}</div>}
                        {(r.next_due_date || r.next_due_mileage) && (
                          <div style={{ marginTop: 6 }}>
                            <DueBadge label={r.service_type} dateStr={r.next_due_date} mileage={r.next_due_mileage} />
                          </div>
                        )}
                      </div>
                      <button onClick={() => handleDeleteMaint(r.id)} style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', fontSize: 18, padding: '0 0 0 8px' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ children }) { return <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>{children}</div> }
function FF({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 150 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.text3, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}
