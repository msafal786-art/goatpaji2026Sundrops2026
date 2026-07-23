import React, { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { api, maybeRefreshToken } from './api.js'
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
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const linkStyle = {
    padding: '0 14px', height: NAV_H, display: 'flex', alignItems: 'center',
    fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
    color: active ? T.blue : T.text2,
    borderBottom: active ? `2px solid ${T.blue}` : '2px solid transparent',
    textDecoration: 'none', userSelect: 'none',
  }

  // Simple link with no dropdown
  if (to) return <Link to={to} style={linkStyle}>{label}</Link>

  // Split: label navigates to mainTo, ▼ opens dropdown
  // If no mainTo, entire label+arrow is the toggle
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
      {mainTo ? (
        <Link to={mainTo} style={{ ...linkStyle, paddingRight: 4 }}>{label}</Link>
      ) : (
        <button onClick={() => setOpen(o => !o)} style={{ ...linkStyle, background: 'none', border: 'none', paddingRight: 4 }}>
          {label}
        </button>
      )}
      <button
        style={{
          height: NAV_H, padding: '0 8px', background: 'none', border: 'none',
          cursor: 'pointer', color: active ? T.blue : T.text3, fontSize: 9,
          borderBottom: active ? `2px solid ${T.blue}` : '2px solid transparent',
        }}
        onClick={() => setOpen(o => !o)}
      >▼</button>
      {open && (
        <div style={{
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

// ── Desktop top nav ────────────────────────────────────────────────────────────
function TopNav({ user, onLogout }) {
  const loc = useLocation()
  const isAdmin = user.role === 'dispatcher' && !user.company_id && !user.allowed_company_ids
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

  const moreItems = [
    { to: '/compliance',      label: 'Compliance' },
    { to: '/recommendations', label: 'Lanes' },
    { to: '/deadhead',        label: 'Deadhead' },
    { to: '/revenue',         label: 'Revenue' },
    ...(isAdmin ? [{ to: '/companies', label: 'Companies' }, { to: '/users', label: 'Users' }] : []),
    { to: '/settings',        label: 'Settings' },
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
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1.2 }}>
            {user.company_name || (isAdmin ? 'Goat Inc' : 'Dispatch Portal')}
          </div>
          <div style={{ fontSize: 10, color: T.text3, lineHeight: 1 }}>
            {isAdmin ? (user.full_name || 'Safal Madaan') : 'Freight Mgmt'}
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
        <NavItem label="Dispatch" to="/loads" />
        <NavItem label="Calendar" to="/calendar" />
        <NavItem label="Dashboard" to="/dashboard" />
        <NavItem label="Drivers" mainTo="/drivers" children={[
          { to: '/drivers', label: 'Driver List' },
          { to: '/payroll', label: 'Payroll' },
        ]} />
        <NavItem label="Equipment" mainTo="/trucks" children={[
          { to: '/trucks', label: 'Trucks & Trailers' },
        ]} />
        <NavItem label="Search" to="/search" />
        <NavItem label="More" children={moreItems} />
      </nav>

      {/* Right: online indicator + user */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderLeft: `1px solid ${T.sep}`, flexShrink: 0 }}>

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
const BOTTOM_NAV = [
  { to: '/loads',    icon: '↗',  label: 'Loads' },
  { to: '/drivers',  icon: '◉',  label: 'Drivers' },
  { to: '/trucks',   icon: '▣',  label: 'Trucks' },
  { to: '/payroll',  icon: '💵', label: 'Payroll' },
  { to: '/settings', icon: '⚙',  label: 'More' },
]

function BottomNav({ onLogout }) {
  const loc = useLocation()
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
      background: T.bg1 + 'ee', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      borderTop: `1px solid ${T.sep}`, display: 'flex',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {BOTTOM_NAV.map(l => {
        const active = loc.pathname.startsWith(l.to)
        return (
          <Link key={l.to} to={l.to} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '10px 0 8px', textDecoration: 'none', gap: 3,
            color: active ? T.blue : T.text3,
          }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{l.icon}</span>
            <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, letterSpacing: 0.3 }}>{l.label}</span>
          </Link>
        )
      })}
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
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 16, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {user.company_name || 'Dispatch Portal'}
          </div>
        )}
        {children}
      </main>
      {mobile && <BottomNav onLogout={onLogout} />}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
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
        api.me().then(setUser)
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

  function handleLogout() {
    if (!window.confirm('Sign out of Dispatch Portal?')) return
    localStorage.removeItem('token')
    setUser(null)
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100vh', background: T.bg, color: T.text2, fontSize: 14 }}>
      <div style={{ width: 36, height: 36, background: T.blue, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 900, color: '#fff' }}>G</div>
      <div>{slowLoad ? 'Server is waking up…' : 'Loading…'}</div>
      {slowLoad && <div style={{ fontSize: 11, color: T.text3 }}>This can take 10–20 s on a cold start</div>}
    </div>
  )

  return (
    <ThemeProvider>
    <AuthContext.Provider value={{ user, setUser }}>
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
          <AppShell user={user} onLogout={handleLogout}>
            <Routes>
              <Route path="/" element={<Navigate to="/loads" />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/loads" element={<Loads />} />
              <Route path="/loads/:id" element={<LoadDetail />} />
              <Route path="/drivers" element={<Drivers />} />
              <Route path="/trucks" element={<Trucks />} />
              {user.role === 'dispatcher' && <Route path="/companies" element={<Companies />} />}
              {user.role === 'dispatcher' && <Route path="/users" element={<Users />} />}
              <Route path="/compliance" element={<Compliance />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/search" element={<Search />} />
              <Route path="/recommendations" element={<Recommendations />} />
              <Route path="/deadhead" element={<Deadhead />} />
              <Route path="/revenue" element={<Revenue />} />
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
