import React from 'react'
import { Link } from 'react-router-dom'

const C = {
  bg:     '#0e0e10',
  bg1:    '#1a1a1d',
  sep:    'rgba(84,84,88,0.28)',
  text:   '#f2f2f7',
  text2:  'rgba(235,235,245,0.60)',
  text3:  'rgba(235,235,245,0.38)',
  blue:   '#0a84ff',
  green:  '#30d158',
  orange: '#ff9f0a',
  purple: '#bf5af2',
}

const font = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"

const SERVICES = [
  {
    icon: '↗',
    color: C.blue,
    title: 'Freight Dispatch',
    desc: 'Load sourcing, rate negotiation, broker communication, and all your paperwork — handled.',
    badge: 'Core Service',
  },
  {
    icon: '◎',
    color: C.green,
    title: 'Software & Tracking',
    desc: 'Proprietary dispatch portal with real-time load tracking and live status for every move.',
    badge: 'Live Tracking',
  },
  {
    icon: '◉',
    color: C.orange,
    title: 'Driver Roster & Payroll',
    desc: 'Automated driver management and payroll-ready settlement reports synced to every load.',
    badge: 'Automated',
  },
  {
    icon: '▣',
    color: C.purple,
    title: 'ELD Device Rental',
    desc: 'Compliant ELD units with 24/7 backend technical support. Plug in and stay legal.',
    badge: '24/7 Support',
  },
]

export default function Landing() {
  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: font, minHeight: '100vh' }}>

      {/* Nav */}
      <nav style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '18px 36px', borderBottom: `1px solid ${C.sep}`,
        position: 'sticky', top: 0, background: C.bg + 'ee',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, background: C.blue, borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: -1,
          }}>G</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>GOAT INC</div>
            <div style={{ fontSize: 10, color: C.text3, letterSpacing: 0.6, textTransform: 'uppercase' }}>Freight Dispatch</div>
          </div>
        </div>
        <Link to="/login" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 18px', borderRadius: 22,
          background: 'rgba(10,132,255,0.10)', border: `1px solid rgba(10,132,255,0.30)`,
          color: C.blue, fontSize: 13, fontWeight: 700, textDecoration: 'none',
          letterSpacing: 0.1,
        }}>
          🔑 Portal Login
        </Link>
      </nav>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '88px 24px 72px' }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(10,132,255,0.12)', border: `1px solid rgba(10,132,255,0.28)`,
          color: C.blue, fontSize: 11, fontWeight: 700, letterSpacing: 1.3,
          textTransform: 'uppercase', padding: '5px 15px', borderRadius: 22, marginBottom: 28,
        }}>
          Trusted Freight Dispatch Partner
        </div>

        <h1 style={{ fontSize: 'clamp(38px, 7vw, 58px)', fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.05, marginBottom: 20 }}>
          Move More.<br />
          <span style={{ color: C.blue }}>Stress Less.</span>
        </h1>

        <p style={{ fontSize: 17, color: C.text2, maxWidth: 440, margin: '0 auto 40px', lineHeight: 1.65 }}>
          Full-service freight dispatch and fleet management for owner-operators and carriers.
          We handle the paperwork — you drive.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="tel:9298889669" style={{
            background: C.blue, color: '#fff', padding: '13px 28px', borderRadius: 26,
            fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block',
          }}>
            Call 929-888-9669
          </a>
          <a href="mailto:loads.safal@gmail.com" style={{
            background: 'transparent', color: C.text2,
            border: `1px solid ${C.sep}`,
            padding: '13px 28px', borderRadius: 26,
            fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-block',
          }}>
            Email Us
          </a>
        </div>
      </div>

      {/* Contact bar */}
      <div style={{
        display: 'flex', gap: 0, justifyContent: 'center',
        background: C.bg1, borderTop: `1px solid ${C.sep}`, borderBottom: `1px solid ${C.sep}`,
        flexWrap: 'wrap',
      }}>
        {[
          { icon: '📞', label: '929-888-9669', href: 'tel:9298889669' },
          { icon: '✉', label: 'loads.safal@gmail.com', href: 'mailto:loads.safal@gmail.com' },
          { icon: '🕐', label: '24/7 Backend Support', href: null },
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '16px 28px', borderRight: i < 2 ? `1px solid ${C.sep}` : 'none',
          }}>
            <span style={{ fontSize: 16 }}>{item.icon}</span>
            {item.href
              ? <a href={item.href} style={{ fontSize: 13, color: C.text2, textDecoration: 'none' }}>{item.label}</a>
              : <span style={{ fontSize: 13, color: C.text2 }}>{item.label}</span>
            }
          </div>
        ))}
      </div>

      {/* Services */}
      <div style={{ padding: '72px 24px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
            Everything Your Fleet Needs
          </h2>
          <p style={{ fontSize: 14, color: C.text3 }}>One partner. End-to-end coverage.</p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 14,
        }}>
          {SERVICES.map((s, i) => (
            <div key={i} style={{
              background: C.bg1, borderRadius: 18,
              border: `1px solid ${C.sep}`, padding: '26px 22px',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 11, marginBottom: 16,
                background: s.color + '1a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, color: s.color,
              }}>
                {s.icon}
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8, letterSpacing: -0.2 }}>
                {s.title}
              </h3>
              <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, marginBottom: 14 }}>
                {s.desc}
              </p>
              <span style={{
                display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
                textTransform: 'uppercase', padding: '4px 10px', borderRadius: 6,
                background: s.color + '18', color: s.color,
              }}>
                {s.badge}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Why GOAT */}
      <div style={{
        margin: '0 24px 72px', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto',
        background: C.bg1, borderRadius: 22, border: `1px solid ${C.sep}`, padding: '40px 36px',
        textAlign: 'center',
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.8, marginBottom: 10 }}>
          Why GOAT INC?
        </h2>
        <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.7, maxWidth: 480, margin: '0 auto 30px' }}>
          We're a small team that runs tight — fast load booking, transparent rates, and real humans
          answering the phone at 3 AM when a driver needs help.
        </p>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { stat: '24/7', label: 'Dispatcher support' },
            { stat: '5+', label: 'Active carriers' },
            { stat: '100%', label: 'Compliance focused' },
          ].map((item, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: C.blue, letterSpacing: -1 }}>{item.stat}</div>
              <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Portal keyhole */}
      <div style={{
        textAlign: 'center', padding: '0 24px 80px',
      }}>
        <div style={{
          width: 68, height: 68, borderRadius: '50%', margin: '0 auto 22px',
          background: 'rgba(10,132,255,0.10)', border: `2px solid rgba(10,132,255,0.25)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
        }}>🔑</div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 }}>
          Carrier & Dispatcher Portal
        </h3>
        <p style={{ fontSize: 13, color: C.text3, marginBottom: 24 }}>
          Existing clients — log in to manage loads, drivers, and your fleet.
        </p>
        <Link to="/login" style={{
          background: C.blue, color: '#fff', padding: '13px 32px', borderRadius: 26,
          fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block',
        }}>
          Access Portal
        </Link>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: `1px solid ${C.sep}`, padding: '22px 36px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ fontSize: 11, color: C.text3 }}>© 2026 GOAT INC — Freight Dispatch Services</div>
        <div style={{ display: 'flex', gap: 20 }}>
          <a href="tel:9298889669" style={{ fontSize: 11, color: C.text3, textDecoration: 'none' }}>929-888-9669</a>
          <a href="mailto:loads.safal@gmail.com" style={{ fontSize: 11, color: C.text3, textDecoration: 'none' }}>loads.safal@gmail.com</a>
        </div>
      </div>
    </div>
  )
}
