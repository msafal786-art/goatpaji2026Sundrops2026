import React, { useEffect, useState } from 'react'
import { T } from '../theme.js'
import { api } from '../api.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

const STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
}

function stateName(code) { return STATE_NAMES[code] || code }

function fmt$(n) {
  if (!n) return null
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function LaneBadge({ from, to }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: T.bg2, border: `1px solid ${T.sep}`,
      borderRadius: 8, padding: '4px 10px',
      fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: 0.2,
    }}>
      <span style={{ color: T.blue }}>{from}</span>
      <span style={{ color: T.text3, fontSize: 11 }}>→</span>
      <span style={{ color: T.green }}>{to}</span>
    </span>
  )
}

function BrokerRow({ broker, isTop }) {
  const [copied, setCopied] = useState(false)

  function copyBroker() {
    const text = [broker.broker_name, broker.broker_contact, broker.broker_email].filter(Boolean).join(' · ')
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 12px', borderRadius: 9,
      background: isTop ? T.blue + '10' : 'transparent',
      border: isTop ? `1px solid ${T.blue}22` : `1px solid transparent`,
      marginBottom: 4,
    }}>
      {/* rank dot */}
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: isTop ? T.blue + '25' : T.bg2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: isTop ? T.blue : T.text3,
      }}>
        {broker.times_used}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: isTop ? 700 : 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {broker.broker_name}
        </div>
        {(broker.broker_contact || broker.broker_email) && (
          <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>
            {[broker.broker_contact, broker.broker_email].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {broker.avg_rate && (
          <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>{fmt$(broker.avg_rate)}</div>
        )}
        <div style={{ fontSize: 10, color: T.text3 }}>{broker.times_used} load{broker.times_used !== 1 ? 's' : ''}</div>
      </div>

      <button onClick={copyBroker} style={{
        flexShrink: 0, padding: '5px 10px', borderRadius: 7,
        background: copied ? T.green + '20' : T.bg2,
        border: `1px solid ${copied ? T.green + '40' : T.sep}`,
        color: copied ? T.green : T.text3,
        fontSize: 11, fontWeight: 600, cursor: 'pointer',
      }}>
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  )
}

function LaneCard({ lane, fromState }) {
  const [open, setOpen] = useState(true)
  const hasRate = lane.avg_rate || lane.brokers.some(b => b.avg_rate)

  return (
    <div style={{
      background: T.bg1, border: `1px solid ${T.sep}`,
      borderRadius: 14, overflow: 'hidden', marginBottom: 10,
    }}>
      {/* Lane header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '14px 16px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12,
          background: open ? T.bg2 : 'transparent',
        }}
      >
        <LaneBadge from={fromState} to={lane.delivery_state} />

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: T.text2 }}>
            {stateName(fromState)} → {stateName(lane.delivery_state)}
          </div>
          {lane.delivery_city && (
            <div style={{ fontSize: 11, color: T.text3 }}>{lane.delivery_city}</div>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{lane.load_count} loads</div>
          {hasRate && lane.avg_rate && (
            <div style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>{fmt$(lane.avg_rate)} avg</div>
          )}
          {lane.min_rate && lane.max_rate && lane.min_rate !== lane.max_rate && (
            <div style={{ fontSize: 10, color: T.text3 }}>{fmt$(lane.min_rate)} – {fmt$(lane.max_rate)}</div>
          )}
        </div>

        <span style={{ color: T.text3, fontSize: 12, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {/* Brokers */}
      {open && (
        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            Brokers to contact — sorted by frequency
          </div>
          {lane.brokers.map((b, i) => (
            <BrokerRow key={b.broker_name} broker={b} isTop={i === 0} />
          ))}
          {lane.brokers.length === 0 && (
            <div style={{ fontSize: 12, color: T.text3, padding: '8px 0' }}>No broker history for this lane.</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Recommendations() {
  const mobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.recommendations().then(setData).finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>
          Lane Recommendations
        </h1>
        <p style={{ fontSize: 13, color: T.text3, marginTop: 5, lineHeight: 1.5 }}>
          Based on where your trucks are delivering right now, these are the outbound lanes
          your fleet has historically run — with the brokers and rates that booked them.
        </p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: T.text3, fontSize: 14 }}>
          Analyzing lane history…
        </div>
      )}

      {!loading && (!data || data.length === 0) && (
        <div style={{
          background: T.bg1, border: `1px solid ${T.sep}`,
          borderRadius: 14, padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🗺</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>No active deliveries to base recommendations on</div>
          <div style={{ fontSize: 13, color: T.text3 }}>Recommendations appear once loads are in transit or dispatched.</div>
        </div>
      )}

      {!loading && data && data.map(dest => (
        <div key={dest.delivery_state} style={{ marginBottom: 32 }}>

          {/* Destination header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
            padding: '12px 16px', background: T.bg1,
            border: `1px solid ${T.sep}`, borderLeft: `3px solid ${T.orange}`,
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.orange, letterSpacing: -1 }}>
              {dest.delivery_state}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                {dest.trucks_delivering} truck{dest.trucks_delivering !== 1 ? 's' : ''} delivering to {dest.delivery_city || stateName(dest.delivery_state)}
              </div>
              <div style={{ fontSize: 12, color: T.text3 }}>
                Book outbound loads from {stateName(dest.delivery_state)} now
              </div>
            </div>
          </div>

          {dest.outbound_lanes.map(lane => (
            <LaneCard
              key={lane.delivery_state}
              lane={lane}
              fromState={dest.delivery_state}
            />
          ))}
        </div>
      ))}

      {/* How it works */}
      {!loading && data && data.length > 0 && (
        <div style={{
          background: T.bg1, border: `1px solid ${T.sep}`, borderRadius: 14,
          padding: '16px 18px', marginTop: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            How this works
          </div>
          <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.7 }}>
            Recommendations are built from your {' '}
            <strong style={{ color: T.text }}>1,200+ historical loads</strong>.
            When a truck is delivering to a state, this page finds all outbound lanes you've
            historically run from that state and ranks the brokers by how often you've worked with them.
            Click <strong style={{ color: T.text }}>Copy</strong> on any broker to copy their name and contact to your clipboard.
          </div>
        </div>
      )}
    </div>
  )
}
