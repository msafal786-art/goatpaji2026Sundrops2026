import React, { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { api, maybeRefreshToken } from './api.js'
import { T, applyTheme } from './theme.js'
import { ThemeProvider } from './ThemeContext.jsx'
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

export const AuthContext = createContext(null)
export function useAuth() { return useContext(AuthContext) }

const NAV_LINKS = {
  dispatcher: [
    { to: '/dashboard', icon: '⊞', label: 'Dashboard' },
    { to: '/loads',     icon: '↗',  label: 'Loads' },
    { to: '/search',    icon: '⌕',  label: 'Search' },
    { to: '/drivers',   icon: '◉',  label: 'Drivers' },
    { to: '/trucks',    icon: '◈',  label: 'Trucks' },
    { to: '/companies', icon: '⬡',  label: 'Companies' },
    { to: '/settings',  icon: '⚙',  label: 'Settings' },
  ],
  company_owner: [
    { to: '/dashboard', icon: '⊞', label: 'Dashboard' },
    { to: '/loads',     icon: '↗',  label: 'Loads' },
    { to: '/search',    icon: '⌕',  label: 'Search' },
    { to: '/drivers',   icon: '◉',  label: 'Drivers' },
    { to: '/trucks',    icon: '◈',  label: 'Trucks' },
    { to: '/settings',  icon: '⚙',  label: 'Settings' },
  ],
}

// Bottom nav uses only the top 5 for visual balance
const BOTTOM_NAV_LINKS = {
  dispatcher: [
    { to: '/dashboard', icon: '⊞', label: 'Dashboard' },
    { to: '/loads',     icon: '↗',  label: 'Loads' },
    { to: '/search',    icon: '⌕',  label: 'Search' },
    { to: '/drivers',   icon: '◉',  label: 'Drivers' },
    { to: '/settings',  icon: '⚙',  label: 'Settings' },
  ],
  company_owner: [
    { to: '/dashboard', icon: '⊞', label: 'Dashboard' },
    { to: '/loads',     icon: '↗',  label: 'Loads' },
    { to: '/search',    icon: '⌕',  label: 'Search' },
    { to: '/drivers',   icon: '◉',  label: 'Drivers' },
    { to: '/settings',  icon: '⚙',  label: 'Settings' },
  ],
}

// ── Desktop sidebar ────────────────────────────────────────────────────────────
function Sidebar({ user, onLogout }) {
  const loc = useLocation()
  const links = NAV_LINKS[user.role] || []
  return (
    <div style={{
      width: 220, background: T.bg1, display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 100,
      borderRight: `1px solid ${T.sep}`,
    }}>
      <div style={{ padding: '20px 16px 16px', borderBottom: `1px solid ${T.sep}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>
          {user.role === 'company_owner' && user.company_name
            ? user.company_name.replace(' INC','').replace(' LLC','').replace('THE FRONTLINE FREIGHT','FRONTLINE').replace(' TRANS','').replace(' LOGISTICS','').replace(' BROS','')
            : 'Dispatch Portal'}
        </div>
        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Freight Management</div>
      </div>
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {links.map(l => {
          const active = loc.pathname.startsWith(l.to)
          return (
            <Link key={l.to} to={l.to} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
              borderRadius: 10, margin: '1px 8px', textDecoration: 'none', fontSize: 14,
              fontWeight: active ? 600 : 400,
              color: active ? T.text : T.text2,
              background: active ? T.bg2 : 'transparent',
            }}>
              <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{l.icon}</span>
              {l.label}
            </Link>
          )
        })}
      </nav>
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.sep}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text2, marginBottom: 2 }}>{user.full_name || user.username}</div>
        <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>{user.role.replace('_', ' ')}</div>
        <button onClick={onLogout} style={{
          width: '100%', padding: '8px 12px', background: T.bg2, border: 'none',
          borderRadius: 8, color: T.text2, fontSize: 12, cursor: 'pointer', textAlign: 'left',
        }}>Sign out</button>
      </div>
    </div>
  )
}

// ── Mobile bottom nav ──────────────────────────────────────────────────────────
function BottomNav({ user, onLogout }) {
  const loc = useLocation()
  const links = BOTTOM_NAV_LINKS[user.role] || []
  // Limit to 5 tabs; Companies is only for dispatcher so it fits
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
      background: T.bg1 + 'ee',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderTop: `1px solid ${T.sep}`,
      display: 'flex',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {links.map(l => {
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
      <button onClick={onLogout} style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '10px 0 8px', background: 'none', border: 'none', gap: 3,
        color: T.text3, cursor: 'pointer',
      }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>↩</span>
        <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: 0.3 }}>Sign out</span>
      </button>
    </div>
  )
}

// ── App shell ──────────────────────────────────────────────────────────────────
function AppShell({ children, user, onLogout }) {
  const mobile = useIsMobile()
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: T.bg }}>
      {!mobile && <Sidebar user={user} onLogout={onLogout} />}
      <main style={{
        flex: 1,
        marginLeft: mobile ? 0 : 220,
        padding: mobile ? '16px 14px 80px' : '28px 32px',
        minHeight: '100vh',
        maxWidth: mobile ? '100vw' : undefined,
        overflowX: 'hidden',
      }}>
        {mobile && (
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 16, letterSpacing: -0.3 }}>
            {user.role === 'company_owner' && user.company_name
              ? user.company_name.replace(' INC','').replace(' LLC','').replace('THE FRONTLINE FREIGHT','FRONTLINE').replace(' TRANS','').replace(' LOGISTICS','').replace(' BROS','')
              : 'Dispatch Portal'}
          </div>
        )}
        {children}
      </main>
      {mobile && <BottomNav user={user} onLogout={onLogout} />}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [, forceUpdate] = useState(0)

  // Apply saved theme immediately
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
      maybeRefreshToken().finally(() =>
        api.me().then(setUser).catch(() => localStorage.removeItem('token')).finally(() => setLoading(false))
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: T.bg, color: T.text2, fontSize: 14 }}>
      Loading…
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
        ) : user.role === 'driver' ? (
          <Routes><Route path="*" element={<DriverView user={user} onLogout={handleLogout} />} /></Routes>
        ) : (
          <AppShell user={user} onLogout={handleLogout}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/loads" element={<Loads />} />
              <Route path="/loads/:id" element={<LoadDetail />} />
              <Route path="/drivers" element={<Drivers />} />
              <Route path="/trucks" element={<Trucks />} />
              {user.role === 'dispatcher' && <Route path="/companies" element={<Companies />} />}
              <Route path="/search" element={<Search />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          </AppShell>
        )}
      </BrowserRouter>
    </AuthContext.Provider>
    </ThemeProvider>
  )
}
