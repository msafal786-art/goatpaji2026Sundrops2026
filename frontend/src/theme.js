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
  open:       { color: '#ff9f0a', label: 'Open' },
  covered:    { color: '#0a84ff', label: 'Covered' },
  dispatched: { color: '#bf5af2', label: 'Dispatched' },
  loading:    { color: '#ff6b35', label: 'Loading' },
  on_route:   { color: '#30d158', label: 'On Route' },
  unloading:  { color: '#5ac8f5', label: 'Unloading' },
  in_yard:    { color: '#64d2ff', label: 'In Yard' },
  delivered:  { color: '#34c759', label: 'Delivered' },
  completed:  { color: 'rgba(120,120,128,0.55)', label: 'Completed' },
  // legacy aliases so old JWT loads still render
  pending:    { color: '#ff9f0a', label: 'Open' },
  assigned:   { color: '#0a84ff', label: 'Covered' },
  in_transit: { color: '#30d158', label: 'On Route' },
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

// The first meaningful word of a carrier name, used as its match key. Filler
// words are skipped so "THE FRONTLINE FREIGHT INC" keys off FRONTLINE rather
// than THE — matching on "THE" wrongly caught "BRO(THE)RS LOGISTICS INC", which
// contains it as a substring.
const CARRIER_FILLER = new Set(['THE', 'A', 'AND', '&'])
export function carrierKey(name) {
  if (!name) return ''
  return name.toUpperCase().split(/\s+/).find(w => w && !CARRIER_FILLER.has(w)) || ''
}

export function carrierColor(name) {
  if (!name) return T.text3
  const k = carrierKey(name)
  for (const [key, color] of Object.entries(CARRIER_COLORS)) {
    if (k && k === carrierKey(key)) return color
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
