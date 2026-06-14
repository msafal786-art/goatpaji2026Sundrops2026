import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { T, STATUS } from '../theme.js'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'

export default function Search() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [, forceUpdate] = useState(0)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults(null); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.get(`/api/search?q=${encodeURIComponent(query.trim())}`)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 280)
  }, [query])

  const showRate = user.role === 'dispatcher' || user.role === 'company_owner'

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: '0 0 20px' }}>Search</h1>

      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <span style={{
          position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
          fontSize: 16, color: T.text3, pointerEvents: 'none',
        }}>⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Load #, broker, shipper, delivery city, reference…"
          style={{
            width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12,
            border: `1px solid ${T.sep}`, background: T.bg1, color: T.text,
            fontSize: 15, outline: 'none', boxSizing: 'border-box',
          }}
        />
        {query && (
          <button onClick={() => setQuery('')} style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: T.text3, fontSize: 18,
          }}>×</button>
        )}
      </div>

      {/* Hint chips */}
      {!query && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
          {['Load #', 'Broker name', 'Shipper city', 'Delivery city', 'Reference #'].map(hint => (
            <span key={hint} style={{
              padding: '5px 12px', borderRadius: 20,
              background: T.bg2, color: T.text3, fontSize: 12, fontWeight: 500,
            }}>{hint}</span>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && <div style={{ color: T.text3, fontSize: 14, textAlign: 'center', padding: 40 }}>Searching…</div>}

      {/* No results */}
      {!loading && results && results.length === 0 && (
        <div style={{ color: T.text3, fontSize: 14, textAlign: 'center', padding: 40 }}>
          No loads found for "{query}"
        </div>
      )}

      {/* Results */}
      {!loading && results && results.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map(load => (
              <SearchResult key={load.id} load={load} showRate={showRate} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SearchResult({ load, showRate }) {
  const st = STATUS[load.status] || STATUS.pending
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    window.addEventListener('themechange', fn)
    return () => window.removeEventListener('themechange', fn)
  }, [])

  return (
    <Link to={`/loads/${load.id}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: T.bg1, borderRadius: 12,
        border: `1px solid ${T.sep}`,
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 14,
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.bg2}
      onMouseLeave={e => e.currentTarget.style.background = T.bg1}
      >
        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: st.color, flexShrink: 0,
        }} />

        {/* Load number + broker */}
        <div style={{ minWidth: 100 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>#{load.load_number}</div>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 1 }}>{load.broker_name || '—'}</div>
        </div>

        {/* Route */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: T.text2 }}>
            {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ')}
            {' → '}
            {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ')}
          </div>
          {load.pickup_date && (
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
              {new Date(load.pickup_date + 'T06:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Status + rate */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 6,
            background: st.color + '22', color: st.color,
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>{st.label}</span>
          {showRate && load.rate && (
            <div style={{ fontSize: 12, color: T.green, fontWeight: 700, marginTop: 4 }}>
              ${Number(load.rate).toLocaleString()}
            </div>
          )}
        </div>

        {/* Arrow */}
        <span style={{ color: T.text3, fontSize: 16, flexShrink: 0 }}>›</span>
      </div>
    </Link>
  )
}
