// Fixed accent colors — do NOT change between dark/light themes
const ACCENTS = {
  blue:   '#0a84ff',
  green:  '#30d158',
  red:    '#ff453a',
  orange: '#ff9f0a',
  teal:   '#5ac8f5',
  purple: '#bf5af2',
}

const DARK = {
  bg:    '#0e0e10',
  bg1:   '#1a1a1d',
  bg2:   '#252528',
  bg3:   '#323235',
  text:  '#f2f2f7',
  text2: 'rgba(235,235,245,0.65)',
  text3: 'rgba(235,235,245,0.40)',
  sep:   'rgba(84,84,88,0.45)',
  isDark: true,
}

const LIGHT = {
  bg:    '#f2f2f7',
  bg1:   '#ffffff',
  bg2:   '#e5e5ea',
  bg3:   '#d1d1d6',
  text:  '#1c1c1e',
  text2: 'rgba(60,60,67,0.80)',
  text3: 'rgba(60,60,67,0.50)',
  sep:   'rgba(60,60,67,0.18)',
  isDark: false,
}

// T is set at runtime — default to dark + accents
export let T = { ...DARK, ...ACCENTS }

export function applyTheme(mode) {
  const src = mode === 'light' ? LIGHT : DARK
  Object.assign(T, src, ACCENTS)  // accents are constant regardless of theme
  document.documentElement.style.background = src.bg
  document.documentElement.style.color = src.text
}

export const STATUS = {
  pending:    { color: '#ff9f0a', label: 'Pending' },
  assigned:   { color: '#0a84ff', label: 'Assigned' },
  dispatched: { color: '#bf5af2', label: 'Dispatched' },
  in_transit: { color: '#30d158', label: 'In Transit' },
  delivered:  { color: '#5ac8f5', label: 'Delivered' },
  completed:  { color: 'rgba(120,120,128,0.55)', label: 'Completed' },
  available:  { color: '#30d158', label: 'Available' },
  on_load:    { color: '#0a84ff', label: 'On Load' },
  off_duty:   { color: 'rgba(120,120,128,0.55)', label: 'Off Duty' },
  maintenance:{ color: '#ff453a', label: 'Maintenance' },
}

export const CARRIER_COLORS = {
  'WMK STAR INC':              '#5e5ce6',
  'SANT TRANS INC':            '#ff9f0a',
  'THE FRONTLINE FREIGHT INC': '#30d158',
  'CHEEMA BROS TRANS INC':     '#0a84ff',
  'BROTHERS LOGISTICS INC':    '#bf5af2',
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
