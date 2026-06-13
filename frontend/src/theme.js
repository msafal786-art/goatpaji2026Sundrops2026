export const T = {
  bg:    '#0e0e10',
  bg1:   '#1a1a1d',
  bg2:   '#252528',
  bg3:   '#323235',
  text:  '#f2f2f7',
  text2: 'rgba(235,235,245,0.72)',
  text3: 'rgba(235,235,245,0.40)',
  sep:   'rgba(84,84,88,0.45)',
  blue:   '#0a84ff',
  green:  '#30d158',
  orange: '#ff9f0a',
  red:    '#ff453a',
  purple: '#bf5af2',
  teal:   '#5ac8f5',
  yellow: '#ffd60a',
  indigo: '#5e5ce6',
  font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
}

export const STATUS = {
  pending:    { color: '#ff9f0a', label: 'Pending' },
  assigned:   { color: '#0a84ff', label: 'Assigned' },
  dispatched: { color: '#bf5af2', label: 'Dispatched' },
  in_transit: { color: '#30d158', label: 'In Transit' },
  delivered:  { color: '#5ac8f5', label: 'Delivered' },
  completed:  { color: 'rgba(235,235,245,0.3)', label: 'Completed' },
  available:  { color: '#30d158', label: 'Available' },
  on_load:    { color: '#0a84ff', label: 'On Load' },
  off_duty:   { color: 'rgba(235,235,245,0.3)', label: 'Off Duty' },
  maintenance:{ color: '#ff453a', label: 'Maintenance' },
}

// 5 active carriers + fallback
export const CARRIER_COLORS = {
  'WMK STAR INC':           '#5e5ce6',   // indigo
  'SANT TRANS INC':         '#ff9f0a',   // orange
  'THE FRONTLINE FREIGHT INC': '#30d158', // green
  'CHEEMA BROS TRANS INC':  '#0a84ff',   // blue
  'BROTHERS LOGISTICS INC': '#bf5af2',   // purple
}

export function carrierColor(name) {
  if (!name) return T.text3
  const upper = name.toUpperCase()
  for (const [key, color] of Object.entries(CARRIER_COLORS)) {
    if (upper.includes(key.split(' ')[0])) return color
  }
  return T.text3
}

export const ACTIVE_CARRIERS = [
  'WMK STAR INC',
  'SANT TRANS INC',
  'THE FRONTLINE FREIGHT INC',
  'CHEEMA BROS TRANS INC',
  'BROTHERS LOGISTICS INC',
]
