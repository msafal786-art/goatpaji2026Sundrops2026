import React, { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { api, maybeRefreshToken, getActiveCompany, setActiveCompany, clearActiveCompany, getViewAs, clearViewAs } from './api.js'
import { isAdmin as isAdminUser, canSeeRevenue, userCompanies, isMultiCompany } from './permissions.js'
import { T, applyTheme } from './theme.js'
import { ThemeProvider } from './ThemeContext.jsx'
import { AuthContext } from './AuthContext.jsx'
import { useIsMobile } from './hooks/useIsMobile.js'
import Login from './pages/Login.jsx'
import Landing from './pages/Landing.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Loads from './pages/Loads.jsx'
import LoadDetail from './pages/LoadDetail.jsx'
import Drivers from './pages/Drivers.jsx'
import Trucks from './pages/Trucks.jsx'
import Companies from './pages/Companies.jsx'
import DriverView from './pages/DriverView.jsx'
import Settings from './pages/Settings.jsx'
import Search from './pages/Search.jsx'
import Recommendations from './pages/Recommendations.jsx'
import Deadhead from './pages/Deadhead.jsx'
import Revenue from './pages/Revenue.jsx'
import Payroll from './pages/Payroll.jsx'
import Users from './pages/Users.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Compliance from './pages/Compliance.jsx'
import Calendar from './pages/Calendar.jsx'
import Audit from './pages/Audit.jsx'
import Inbox from './pages/Inbox.jsx'
import Fuel from './pages/Fuel.jsx'
import LoadReview from './pages/LoadReview.jsx'

const NAV_H = 44

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (secs < 90) return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

// ── Dropdown menu item ─────────────────────────────────────────────────────────
function DropItem({ to, label, onClick }) {
  const loc = useLocation()
  const active = loc.pathname.startsWith(to)
  return (
    <Link to={to} onClick={onClick} style={{
      display: 'block', padding: '9px 18px', textDecoration: 'none',
      fontSize: 13, fontWeight: active ? 700 : 500,
      color: active ? T.blue : T.text,
      background: active ? T.blue + '12' : 'transparent',
      whiteSpace: 'nowrap',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.bg2 }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >{label}</Link>
  )
}

// ── Top nav item (with optional dropdown) ─────────────────────────────────────
function NavItem({ label, to, mainTo, children }) {
  const loc = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const active = to ? loc.pathname.startsWith(to)
    : mainTo ? loc.pathname.startsWith(mainTo)
    : (children || []).some(c => loc.pathname.startsWith(c.to))

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('keydown', onKey) }
  }, [])

  const linkStyle = {
    padding: '0 14px', height: NAV_H, display: 'flex', alignItems: 'center',
    fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
    color: active ? T.blue : T.text2,
    borderBottom: active ? `2px solid ${T.blue}` : '2px solid transparent',
    textDecoration: 'none', userSelect: 'none',
  }

  // Simple link with no dropdown
  if (to) return <Link to={to} aria-current={active ? 'page' : undefined} style={linkStyle}>{label}</Link>

  // Split: label navigates to mainTo, ▼ opens dropdown
  // If no mainTo, entire label+arrow is the toggle
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
      {mainTo ? (
        <Link to={mainTo} aria-current={active ? 'page' : undefined} style={{ ...linkStyle, paddingRight: 4 }}>{label}</Link>
      ) : (
        <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
          style={{ ...linkStyle, background: 'none', border: 'none', paddingRight: 4 }}>
          {label}
        </button>
      )}
      <button
        aria-haspopup="menu" aria-expanded={open} aria-label={`${label} menu`}
        style={{
          height: NAV_H, padding: '0 8px', background: 'none', border: 'none',
          cursor: 'pointer', color: active ? T.blue : T.text3, fontSize: 9,
          borderBottom: active ? `2px solid ${T.blue}` : '2px solid transparent',
        }}
        onClick={() => setOpen(o => !o)}
      ><span aria-hidden="true">▼</span></button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: NAV_H, left: 0, zIndex: 1000,
          background: T.bg1, border: `1px solid ${T.sep}`,
          borderRadius: 10, overflow: 'hidden', minWidth: 180,
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
        }}>
          {children.map(c => <DropItem key={c.to} {...c} onClick={() => setOpen(false)} />)}
        </div>
      )}
    </div>
  )
}

// ── Company switcher (multi-company scoped users) ────────────────────────────
// Lets a user who belongs to several carriers view one at a time (or all).
// Changing it re-fetches everything the simplest reliable way: a full reload,
// so every page picks up the new X-Active-Company scope.
function CompanySwitcher({ user, compact }) {
  const companies = userCompanies(user)
  if (!isMultiCompany(user)) return null
  const active = getActiveCompany()
  function onChange(e) {
    setActiveCompany(e.target.value)
    window.location.reload()
  }
  return (
    <select value={active} onChange={onChange} aria-label="Active company"
      style={{
        maxWidth: compact ? '100%' : 200, height: compact ? 40 : 30,
        padding: '0 10px', borderRadius: 8, cursor: 'pointer',
        background: T.bg2, color: T.text, border: `1px solid ${T.sep}`,
        fontSize: compact ? 14 : 12, fontWeight: 600, width: compact ? '100%' : 'auto',
      }}>
      <option value="">All companies</option>
      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  )
}

// ── Nav search bar — type and go to the search page with the query ───────────
function NavSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  function submit(e) {
    e.preventDefault()
    const v = q.trim()
    if (v) navigate(`/search?q=${encodeURIComponent(v)}`)
  }
  return (
    <form onSubmit={submit} style={{ padding: '0 14px', display: 'flex', alignItems: 'center' }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" aria-label="Search"
        style={{
          width: 190, height: 30, padding: '0 12px', borderRadius: 8, fontSize: 13,
          background: T.bg2, color: T.text, border: `1px solid ${T.sep}`, outline: 'none',
        }} />
    </form>
  )
}

// ── Desktop top nav ────────────────────────────────────────────────────────────
function TopNav({ user, onLogout }) {
  const loc = useLocation()
  const isAdmin = isAdminUser(user)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [onlineOpen, setOnlineOpen] = useState(false)
  const onlineRef = useRef()

  useEffect(() => {
    if (!isAdmin) return
    function fetch() { api.activeUsers().then(setOnlineUsers).catch(() => {}) }
    fetch()
    const iv = setInterval(fetch, 30000)
    return () => clearInterval(iv)
  }, [isAdmin])

  useEffect(() => {
    function handle(e) { if (onlineRef.current && !onlineRef.current.contains(e.target)) setOnlineOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Compliance groups the fleet/finance views. Revenue only for those allowed.
  const complianceKids = [
    { to: '/compliance', label: 'Compliance' },
    { to: '/fuel',       label: 'Fuel Cards' },
    { to: '/trucks',     label: 'Equipment' },
    ...(canSeeRevenue(user) ? [{ to: '/revenue', label: 'Revenue' }] : []),
  ]
  // Broker Inbox groups the freight-sourcing / communication tools (admin only).
  const inboxKids = [
    { to: '/inbox',           label: 'Broker Inbox' },
    { to: '/load-review',     label: 'Load Review' },
    { to: '/recommendations', label: 'Lanes' },
  ]
  // More = rarely-used only.
  const moreItems = [
    { to: '/calendar', label: 'Calendar' },
    { to: '/deadhead', label: 'Deadhead' },
    ...(!isAdmin ? [{ to: '/recommendations', label: 'Lanes' }] : []),
    ...(isAdmin ? [{ to: '/companies', label: 'Companies' }, { to: '/users', label: 'Users' }, { to: '/audit', label: 'Access Log' }] : []),
    { to: '/settings', label: 'Settings' },
  ]

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: NAV_H, zIndex: 200,
      background: T.bg1, borderBottom: `1px solid ${T.sep}`,
      display: 'flex', alignItems: 'stretch',
    }}>
      {/* Logo / company */}
      <div style={{
        padding: '0 20px', display: 'flex', alignItems: 'center', gap: 8,
        borderRight: `1px solid ${T.sep}`, flexShrink: 0,
      }}>
        <svg width="28" height="28" viewBox="0 0 64 64" style={{ flexShrink: 0 }} aria-hidden="true">
          <rect width="64" height="64" rx="15" fill="#f0b429" />
          <g transform="translate(32,34)" fill="#151922">
            <path d="M0 20 C0 8 1.7 0 11 -14 C14 -11.5 14.9 -6.6 11.5 -0.8 C8.3 5.8 5.8 11.5 7.5 20 Z" />
            <path d="M0 20 C0 8 -1.7 0 -11 -14 C-14 -11.5 -14.9 -6.6 -11.5 -0.8 C-8.3 5.8 -5.8 11.5 -7.5 20 Z" />
            <circle cx="0" cy="15.5" r="3.8" />
          </g>
        </svg>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1.2 }}>
            {user.portal_name || user.company_name || (isAdmin ? 'Goat Inc' : 'Dispatch Portal')}
          </div>
          <div style={{ fontSize: 10, color: T.text3, lineHeight: 1 }}>
            {isAdmin ? (user.full_name || 'Safal Madaan') : 'Freight Mgmt'}
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
        <NavItem label="Dispatch" to="/loads" />
        <NavItem label="Dashboard" to="/dashboard" />
        <NavItem label="Compliance" mainTo="/compliance" children={complianceKids} />
        <NavItem label="Drivers" mainTo="/drivers" children={[
          { to: '/drivers', label: 'Driver List' },
          { to: '/payroll', label: 'Payroll' },
        ]} />
        {isAdmin && <NavItem label="Broker Inbox" mainTo="/inbox" children={inboxKids} />}
        <NavItem label="More" children={moreItems} />
      </nav>

      {/* Right: search + online + user */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderLeft: `1px solid ${T.sep}`, flexShrink: 0 }}>

        <NavSearch />

        {/* Company switcher — multi-company users only */}
        {isMultiCompany(user) && (
          <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center' }}>
            <CompanySwitcher user={user} />
          </div>
        )}

        {/* Who's Online — admin */}
        {isAdmin && onlineUsers.length > 0 && (
          <div ref={onlineRef} style={{ position: 'relative' }}>
            <button onClick={() => setOnlineOpen(o => !o)} style={{
              padding: '0 14px', height: NAV_H, background: 'none', border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.green, display: 'inline-block' }} />
              <span style={{ fontSize: 12, color: T.text3, fontWeight: 600 }}>{onlineUsers.length} online</span>
            </button>
            {onlineOpen && (
              <div style={{
                position: 'absolute', top: NAV_H, right: 0, zIndex: 1000,
                background: T.bg1, border: `1px solid ${T.sep}`,
                borderRadius: 10, padding: '10px 14px', minWidth: 200,
                boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  Online ({onlineUsers.length})
                </div>
                {onlineUsers.map(u => {
                  const ago = timeAgo(u.last_seen_at)
                  const isNow = ago === 'now'
                  return (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: isNow ? T.green : T.text3, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.full_name || u.username}
                        </div>
                        <div style={{ fontSize: 10, color: T.text3 }}>
                          {u.company_name || (u.role === 'dispatcher' ? 'Admin' : u.role.replace('_', ' '))}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, color: isNow ? T.green : T.text3, flexShrink: 0 }}>{ago}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* User + sign out */}
        <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `1px solid ${T.sep}` }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text, lineHeight: 1.2 }}>{user.full_name || user.username}</div>
            <div style={{ fontSize: 10, color: T.text3 }}>{user.role.replace('_', ' ')}</div>
          </div>
          <button onClick={onLogout} style={{
            padding: '5px 12px', background: T.bg2, border: `1px solid ${T.sep}`,
            borderRadius: 7, color: T.text2, fontSize: 12, cursor: 'pointer', fontWeight: 500,
            whiteSpace: 'nowrap',
          }}>Sign out</button>
        </div>
      </div>
    </div>
  )
}

// ── Mobile bottom nav ──────────────────────────────────────────────────────────
// Four primary tabs live in the bar; every other section is reachable through
// the "More" sheet, so mobile now has full parity with the desktop top nav.
const PRIMARY_NAV = [
  { to: '/loads',     icon: '↗', label: 'Dispatch' },
  { to: '/dashboard', icon: '▦', label: 'Dashboard' },
  { to: '/drivers',   icon: '◉', label: 'Drivers' },
  { to: '/trucks',    icon: '▣', label: 'Trucks' },
]

// Everything not on the tab bar, grouped for the More sheet. `admin` items only
// render for the top-level admin account.
const MORE_SECTIONS = [
  { title: 'Operations', items: [
    { to: '/calendar',        icon: '▤', label: 'Calendar' },
    { to: '/search',          icon: '⌕', label: 'Search' },
    { to: '/payroll',         icon: '💵', label: 'Payroll' },
    { to: '/compliance',      icon: '✓', label: 'Compliance' },
    { to: '/fuel',            icon: '⛽', label: 'Fuel Cards' },
  ]},
  { title: 'Planning', items: [
    { to: '/recommendations', icon: '↭', label: 'Lanes' },
    { to: '/deadhead',        icon: '⇄', label: 'Deadhead' },
    { to: '/revenue',         icon: '$', label: 'Revenue' },
  ]},
  { title: 'Admin', admin: true, items: [
    { to: '/inbox',           icon: '✉', label: 'Broker Inbox' },
    { to: '/load-review',     icon: '📋', label: 'Load Review' },
    { to: '/companies',       icon: '▤', label: 'Companies' },
    { to: '/users',           icon: '◉', label: 'Users' },
    { to: '/audit',           icon: '⚑', label: 'Access Log' },
  ]},
  { title: 'Account', items: [
    { to: '/settings',        icon: '⚙', label: 'Settings' },
  ]},
]

function MoreSheet({ user, onClose, onLogout }) {
  const isAdmin = isAdminUser(user)
  const loc = useLocation()
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Hide admin-only sections, and drop Revenue for users not allowed to see it —
  // the item is absent rather than a locked/"not allowed" tile.
  const sections = MORE_SECTIONS
    .filter(s => !s.admin || isAdmin)
    .map(s => ({ ...s, items: s.items.filter(it => it.to !== '/revenue' || canSeeRevenue(user)) }))
    .filter(s => s.items.length > 0)

  return (
    <div role="dialog" aria-modal="true" aria-label="More menu"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end', background: 'rgba(0,0,0,0.45)',
        animation: 'sheetFade .18s ease',
      }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        borderTop: `1px solid ${T.sep}`, boxShadow: '0 -8px 40px rgba(0,0,0,0.35)',
        padding: '10px 16px calc(24px + env(safe-area-inset-bottom))',
        maxHeight: '82vh', overflowY: 'auto', animation: 'sheetUp .22s cubic-bezier(.32,.72,0,1)',
      }}>
        {/* Grab handle */}
        <div style={{ width: 38, height: 4, borderRadius: 4, background: T.text3, opacity: 0.5, margin: '4px auto 14px' }} />

        {/* Company switcher — multi-company users only */}
        {isMultiCompany(user) && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, paddingLeft: 4 }}>
              Company
            </div>
            <CompanySwitcher user={user} compact />
          </div>
        )}

        {sections.map(sec => (
          <div key={sec.title} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, paddingLeft: 4 }}>
              {sec.title}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {sec.items.map(it => {
                const active = loc.pathname.startsWith(it.to)
                return (
                  <Link key={it.to} to={it.to} onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, minHeight: 52,
                      padding: '0 14px', borderRadius: 12, textDecoration: 'none',
                      background: active ? T.blue + '18' : T.bg2,
                      border: `1px solid ${active ? T.blue + '55' : T.sep}`,
                      color: active ? T.blue : T.text,
                    }}>
                    <span aria-hidden="true" style={{ fontSize: 18, width: 22, textAlign: 'center', flexShrink: 0 }}>{it.icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{it.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}

        <button onClick={() => { onClose(); onLogout() }} style={{
          width: '100%', minHeight: 50, marginTop: 4, background: T.red + '14',
          border: `1px solid ${T.red}44`, borderRadius: 12, color: T.red,
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>Sign out</button>
      </div>
    </div>
  )
}

function BottomNav({ user, onLogout }) {
  const loc = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  // A route change (including tapping a More-sheet item) always closes the sheet.
  useEffect(() => { setMenuOpen(false) }, [loc.pathname])
  const moreActive = menuOpen || !PRIMARY_NAV.some(l => loc.pathname.startsWith(l.to))

  const tab = (active) => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 3, minHeight: 52, padding: '8px 0',
    textDecoration: 'none', background: 'none', border: 'none', cursor: 'pointer',
    boxShadow: active ? `inset 0 2px 0 ${T.blue}` : 'none',
    color: active ? T.blue : T.text2,
  })

  return (
    <>
      {menuOpen && <MoreSheet user={user} onLogout={onLogout} onClose={() => setMenuOpen(false)} />}
      <nav aria-label="Primary" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        background: T.bg1 + 'ee', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid ${T.sep}`, display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {PRIMARY_NAV.map(l => {
          const active = loc.pathname.startsWith(l.to)
          return (
            <Link key={l.to} to={l.to} aria-label={l.label} aria-current={active ? 'page' : undefined} style={tab(active)}>
              <span aria-hidden="true" style={{ fontSize: 21, lineHeight: 1 }}>{l.icon}</span>
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: 0.2 }}>{l.label}</span>
            </Link>
          )
        })}
        <button aria-label="More" aria-haspopup="dialog" aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)} style={tab(moreActive)}>
          <span aria-hidden="true" style={{ fontSize: 21, lineHeight: 1 }}>☰</span>
          <span style={{ fontSize: 10, fontWeight: moreActive ? 700 : 500, letterSpacing: 0.2 }}>More</span>
        </button>
      </nav>
    </>
  )
}

// ── View-as banner (admin previewing another user's portal) ──────────────────
function ViewAsBanner({ target, onExit }) {
  const mobile = useIsMobile()
  return (
    <div role="status" style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)',
      bottom: mobile ? 'calc(74px + env(safe-area-inset-bottom))' : 24,
      zIndex: 400, display: 'flex', alignItems: 'center', gap: 12, maxWidth: '92vw',
      background: T.purple, color: '#fff', padding: '9px 10px 9px 16px',
      borderRadius: 999, boxShadow: '0 8px 30px rgba(0,0,0,0.38)',
    }}>
      <span aria-hidden="true" style={{ fontSize: 15 }}>👁</span>
      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        Viewing as {target.full_name || target.username} · read-only
      </span>
      <button onClick={onExit} style={{
        background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.35)',
        color: '#fff', fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 999,
        cursor: 'pointer', flexShrink: 0,
      }}>Exit</button>
    </div>
  )
}

// ── App shell ──────────────────────────────────────────────────────────────────
function AppShell({ children, user, onLogout }) {
  const mobile = useIsMobile()
  return (
    <div style={{ minHeight: '100vh', background: T.bg }}>
      {!mobile && <TopNav user={user} onLogout={onLogout} />}
      <main style={{
        paddingTop: mobile ? 0 : NAV_H,
        padding: mobile ? '16px 14px 80px' : `${NAV_H + 24}px 28px 28px`,
        minHeight: '100vh',
        overflowX: 'hidden',
      }}>
        {mobile && (
          <h1 style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 16, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {user.portal_name || user.company_name || 'Dispatch Portal'}
          </h1>
        )}
        {children}
      </main>
      {mobile && <BottomNav user={user} onLogout={onLogout} />}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)          // the real signed-in user
  const [viewAs, setViewAs] = useState(null)       // admin previewing this user's portal
  const [loading, setLoading] = useState(true)
  const [slowLoad, setSlowLoad] = useState(false)
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark'
    applyTheme(saved)
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      const slow = setTimeout(() => setSlowLoad(true), 4000)
      const bail = setTimeout(() => { localStorage.removeItem('token'); setLoading(false) }, 22000)
      maybeRefreshToken().finally(() =>
        api.me().then(me => {
          setUser(me)
          // Resume an in-progress "view as" preview after a reload/navigation.
          const va = getViewAs()
          if (va && isAdminUser(me)) {
            api.viewProfile(va).then(setViewAs).catch(() => clearViewAs())
          }
        })
          .catch(() => localStorage.removeItem('token'))
          .finally(() => { clearTimeout(slow); clearTimeout(bail); setLoading(false) })
      )
    } else {
      setLoading(false)
    }
  }, [])

  function handleLogin(data) {
    localStorage.setItem('token', data.token)
    api.me().then(setUser)
  }

  function signOut() {
    clearActiveCompany()
    clearViewAs()
    localStorage.removeItem('token')
    setViewAs(null)
    setUser(null)
  }

  // Leave the preview and return to the admin's own portal. A full reload is the
  // simplest way to re-fetch every page's data without the X-View-As scope.
  function exitViewAs() {
    clearViewAs()
    window.location.assign('/users')
  }

  function handleLogout() {
    if (!window.confirm('Sign out of Dispatch Portal?')) return
    signOut()
  }

  // Auto sign-out after 1 hour of inactivity. Any interaction resets the clock.
  useEffect(() => {
    if (!user) return
    const IDLE_MS = 60 * 60 * 1000
    let timer
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        signOut()
        alert('You were signed out after 1 hour of inactivity.')
      }, IDLE_MS)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [user])

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100vh', background: T.bg, color: T.text2, fontSize: 14 }}>
      <svg width="36" height="36" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="15" fill="#f0b429" />
        <g transform="translate(32,34)" fill="#151922">
          <path d="M0 20 C0 8 1.7 0 11 -14 C14 -11.5 14.9 -6.6 11.5 -0.8 C8.3 5.8 5.8 11.5 7.5 20 Z" />
          <path d="M0 20 C0 8 -1.7 0 -11 -14 C-14 -11.5 -14.9 -6.6 -11.5 -0.8 C-8.3 5.8 -5.8 11.5 -7.5 20 Z" />
          <circle cx="0" cy="15.5" r="3.8" />
        </g>
      </svg>
      <div>{slowLoad ? 'Server is waking up…' : 'Loading…'}</div>
      {slowLoad && <div style={{ fontSize: 11, color: T.text3 }}>This can take 10–20 s on a cold start</div>}
    </div>
  )

  // While previewing, the whole portal renders as the target user; login,
  // password-change and driver gating stay on the real signed-in admin.
  const effective = viewAs || user

  return (
    <ThemeProvider>
    <AuthContext.Provider value={{ user: effective, setUser }}>
      <BrowserRouter>
        {!user ? (
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login onLogin={handleLogin} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        ) : user.must_change_password ? (
          <ChangePassword user={user} onDone={() => api.me().then(setUser)} />
        ) : user.role === 'driver' ? (
          <Routes><Route path="*" element={<DriverView user={user} onLogout={handleLogout} />} /></Routes>
        ) : (
          <AppShell user={effective} onLogout={handleLogout}>
            {viewAs && <ViewAsBanner target={viewAs} onExit={exitViewAs} />}
            <Routes>
              <Route path="/" element={<Navigate to="/loads" />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/loads" element={<Loads />} />
              <Route path="/loads/:id" element={<LoadDetail />} />
              <Route path="/drivers" element={<Drivers />} />
              <Route path="/trucks" element={<Trucks />} />
              {/* Admin-only. Gated on the real admin check (not just role), so a
                  scoped dispatcher can't reach these by typing the URL — it falls
                  through to the redirect below rather than showing a blocked page. */}
              {isAdminUser(effective) && <Route path="/companies" element={<Companies />} />}
              {isAdminUser(effective) && <Route path="/users" element={<Users />} />}
              {isAdminUser(effective) && <Route path="/inbox" element={<Inbox />} />}
              {isAdminUser(effective) && <Route path="/load-review" element={<LoadReview />} />}
              {isAdminUser(effective) && <Route path="/audit" element={<Audit />} />}
              <Route path="/compliance" element={<Compliance />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/search" element={<Search />} />
              <Route path="/recommendations" element={<Recommendations />} />
              <Route path="/deadhead" element={<Deadhead />} />
              <Route path="/fuel" element={<Fuel />} />
              {canSeeRevenue(effective) && <Route path="/revenue" element={<Revenue />} />}
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/loads" />} />
            </Routes>
          </AppShell>
        )}
      </BrowserRouter>
    </AuthContext.Provider>
    </ThemeProvider>
  )
}
