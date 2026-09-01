const BASE = '/api'

function getToken() {
  return localStorage.getItem('token')
}

// ── Active company (multi-company switcher) ──────────────────────────────────
// A scoped user with several companies can narrow the whole portal to one of
// them. We stash the choice locally and send it as a header; the server checks
// it's within their scope and filters every scoped endpoint to it. Empty = all.
export function getActiveCompany() { return localStorage.getItem('activeCompany') || '' }
export function setActiveCompany(id) {
  if (id) localStorage.setItem('activeCompany', String(id))
  else localStorage.removeItem('activeCompany')
}
export function clearActiveCompany() { localStorage.removeItem('activeCompany') }

// ── View-as (admin-only, read-only portal preview) ───────────────────────────
// When set, every request carries X-View-As so the server scopes data to the
// target user. Control-plane calls (the profile fetch itself) pass
// { skipViewAs: true } so they run as the real admin.
export function getViewAs() { return localStorage.getItem('viewAs') || '' }
export function setViewAs(id) {
  if (id) localStorage.setItem('viewAs', String(id))
  else localStorage.removeItem('viewAs')
}
export function clearViewAs() { localStorage.removeItem('viewAs') }

// Silently refresh token if it expires in < 8 hours
export async function maybeRefreshToken() {
  const token = getToken()
  if (!token) return
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const hoursLeft = (payload.exp * 1000 - Date.now()) / 36e5
    if (hoursLeft > 0 && hoursLeft < 8) {
      const res = await fetch(BASE + '/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        localStorage.setItem('token', data.token)
      }
    }
  } catch { /* non-critical */ }
}

// Most calls are quick DB reads, but anything that reads a PDF with Claude
// takes 15–40s. A single blanket timeout either cut those off mid-parse or
// made ordinary calls hang, so the timeout (and retry policy) is per-call.
const DEFAULT_TIMEOUT = 20000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Worth retrying: the upstream model was busy, or the connection dropped.
// Never retried: 4xx (bad request / auth / duplicate) — retrying won't help.
function isTransient(err) {
  return err?.transient === true || err?.name === 'AbortError' || err?.name === 'TypeError'
}

async function req(method, path, body, isForm = false, opts = {}) {
  const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT
  const maxAttempts = (opts.retries ?? 0) + 1

  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const headers = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const activeCompany = getActiveCompany()
    if (activeCompany) headers['X-Active-Company'] = activeCompany
    const viewAs = getViewAs()
    if (viewAs && !opts.skipViewAs) headers['X-View-As'] = viewAs
    if (!isForm) headers['Content-Type'] = 'application/json'

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        signal: ctrl.signal,
        body: isForm ? body : body ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      clearTimeout(timer)
      lastErr = e.name === 'AbortError'
        ? Object.assign(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`), { transient: true })
        : e
      if (attempt < maxAttempts && isTransient(lastErr)) { await sleep(1000 * attempt); continue }
      throw lastErr
    }
    clearTimeout(timer)

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      const msg = err.error || 'Request failed'
      lastErr = Object.assign(
        new Error(err.detail ? `${msg} — ${err.detail}` : msg),
        // 429/5xx are worth another go; the server also flags retryable cases.
        { transient: res.status === 429 || res.status >= 500 || err.retryable === true }
      )
      if (attempt < maxAttempts && isTransient(lastErr)) { await sleep(1000 * attempt); continue }
      throw lastErr
    }
    return res.json()
  }
  throw lastErr
}

export const api = {
  login: (u, p, adminCode) => req('POST', '/login', { username: u, password: p, admin_code: adminCode || undefined }),
  me: () => req('GET', '/me'),
  changePassword: (new_password) => req('PUT', '/change-password', { new_password }),
  resetAllPasswords: (password, user_ids) => req('POST', '/admin/reset-passwords', { password, user_ids }),

  companies: () => req('GET', '/companies'),
  createCompany: (d) => req('POST', '/companies', d),
  updateCompany: (id, d) => req('PUT', `/companies/${id}`, d),

  users: () => req('GET', '/users'),
  createUser: (d) => req('POST', '/users', d),
  updateUser: (id, d) => req('PUT', `/users/${id}`, d),
  deleteUser: (id) => req('DELETE', `/users/${id}`),
  dashboardStats: () => req('GET', '/dashboard-stats'),

  drivers: () => req('GET', '/drivers'),
  driversBoard: () => req('GET', '/drivers/board'),
  createDriver: (d) => req('POST', '/drivers', d),
  updateDriver: (id, d) => req('PUT', `/drivers/${id}`, d),
  deleteDriver: (id) => req('DELETE', `/drivers/${id}`),
  toggleDriverActive: (id) => req('PUT', `/drivers/${id}/toggle-active`),
  createDriverLogin: (id, username, password) => req('POST', `/drivers/${id}/login`, { username, password }),
  resetDriverPassword: (id, password) => req('PUT', `/drivers/${id}/login`, { password }),

  trucks: () => req('GET', '/trucks'),
  createTruck: (d) => req('POST', '/trucks', d),
  updateTruck: (id, d) => req('PUT', `/trucks/${id}`, d),
  deleteTruck: (id) => req('DELETE', `/trucks/${id}`),

  loads: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return req('GET', `/loads${q ? '?' + q : ''}`)
  },
  load: (id) => req('GET', `/loads/${id}`),
  checkDuplicateLoad: (load_number) => req('GET', `/loads/check-duplicate?load_number=${encodeURIComponent(load_number)}`),
  createLoad: (d) => req('POST', '/loads', d),
  updateLoad: (id, d) => req('PUT', `/loads/${id}`, d),
  deleteLoad: (id) => req('DELETE', `/loads/${id}`),
  dispatchMessage: (id) => req('GET', `/loads/${id}/dispatch-message`),
  markDispatched: (id) => req('POST', `/loads/${id}/mark-dispatched`),
  updateLoadStatus: (id, status, extra = {}) => req('POST', `/loads/${id}/status`, { status, ...extra }),

  // Reading a PDF with Claude runs 15–40s; allow well past that and retry
  // once on a timeout or an overloaded upstream.
  parseRateCon: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('POST', '/parse-rate-con', fd, true, { timeout: 120000, retries: 1 })
  },

  // Document drop box — parse a BOL/POD and match it to an existing load
  matchDoc: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('POST', '/docs/match', fd, true, { timeout: 120000, retries: 1 })
  },
  attachDoc: (staged_filename, original_name, load_id, doc_type) =>
    req('POST', '/docs/attach', { staged_filename, original_name, load_id, doc_type }, false, { timeout: 90000 }),
  discardDoc: (staged_filename) => req('POST', '/docs/discard', { staged_filename }),

  // Load documents
  loadDocs: (loadId) => req('GET', `/loads/${loadId}/docs`),
  loadActivity: (loadId) => req('GET', `/loads/${loadId}/activity`),
  auditLog: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    return req('GET', `/audit-log${q ? `?${q}` : ''}`)
  },
  // Admin: fetch a user's portal profile for "view as" (runs as the real admin).
  viewProfile: (id) => req('GET', `/users/${id}/view-profile`, null, false, { skipViewAs: true }),

  // Gmail / broker inbox (admin)
  gmailStatus: () => req('GET', '/gmail/status'),
  gmailAuthUrl: () => req('GET', '/gmail/auth-url'),
  gmailSync: () => req('POST', '/gmail/sync', {}, false, { timeout: 60000 }),
  gmailDisconnect: () => req('POST', '/gmail/disconnect'),
  gmailThreads: () => req('GET', '/gmail/threads'),
  gmailThread: (threadId) => req('GET', `/gmail/threads/${threadId}`),
  gmailAssist: (threadId) => req('POST', `/gmail/threads/${threadId}/assist`, {}, false, { timeout: 45000 }),
  gmailDraftLoad: (threadId) => req('POST', `/gmail/threads/${threadId}/draft-load`, {}, false, { timeout: 60000 }),

  // Load review queue (rate cons from email)
  loadDrafts: () => req('GET', '/load-drafts'),
  approveDraft: (id, company_id) => req('POST', `/load-drafts/${id}/approve`, { company_id }),
  rejectDraft: (id) => req('POST', `/load-drafts/${id}/reject`),

  // Fuel card reports
  fuelUpload: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('POST', '/fuel/upload', fd, true, { timeout: 120000 })
  },
  fuelTransactions: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    return req('GET', `/fuel/transactions${q ? `?${q}` : ''}`)
  },
  fuelSummary: () => req('GET', '/fuel/summary'),
  // Uploads can be a 20 MB scan over a phone connection, and the server also
  // pushes to Drive. No retry — filing the same document twice is worse than
  // an error the dispatcher can act on.
  uploadDoc: (loadId, file, doc_type) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('doc_type', doc_type)
    return req('POST', `/loads/${loadId}/docs`, fd, true, { timeout: 90000 })
  },
  downloadDoc: async (docId, filename) => {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/docs/${docId}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error('Download failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'document'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },
  deleteDoc: (docId) => req('DELETE', `/docs/${docId}`),

  // Trailer / check-in / check-out
  changeDriver: (loadId, driver_id) => req('PUT', `/loads/${loadId}/change-driver`, { driver_id }),
  setTrailer: (loadId, trailer_number) => req('PUT', `/loads/${loadId}/trailer`, { trailer_number }),
  checkIn: (loadId) => req('PUT', `/loads/${loadId}/checkin`, {}),
  checkOut: (loadId) => req('PUT', `/loads/${loadId}/checkout`, {}),

  // Maintenance
  maintenance: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return req('GET', `/maintenance${q ? '?' + q : ''}`)
  },
  createMaintenance: (d) => req('POST', '/maintenance', d),
  deleteMaintenance: (id) => req('DELETE', `/maintenance/${id}`),

  stats: () => req('GET', '/stats'),
  revenueStreams: (by, period, companyId) => req('GET', `/revenue-streams?by=${by}&period=${period}${companyId ? `&company_id=${companyId}` : ''}`),

  activeUsers: () => req('GET', '/active-users'),
  compliance: () => req('GET', '/compliance'),

  // Truck documents
  truckDocs: (truckId) => req('GET', `/trucks/${truckId}/docs`),
  uploadTruckDoc: (truckId, file, doc_type) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('doc_type', doc_type)
    return req('POST', `/trucks/${truckId}/docs`, fd, true)
  },
  downloadTruckDoc: async (docId, filename) => {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/truck-docs/${docId}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error('Download failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename || 'document'
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  },
  deleteTruckDoc: (docId) => req('DELETE', `/truck-docs/${docId}`),
  setDetention: (loadId, data) => req('PUT', `/loads/${loadId}/detention`, data),
  search: (q) => req('GET', `/search?q=${encodeURIComponent(q)}`),
  recommendations: () => req('GET', '/recommendations'),
  payrollWeek: (start) => req('GET', `/payroll/week?start=${start}`),
  savePayrollEntry: (body) => req('PUT', '/payroll/entry', body),
  deletePayrollEntry: (driver_id, date) => req('DELETE', `/payroll/entry?driver_id=${driver_id}&date=${date}`),
  updateDriverRate: (id, rate) => req('PUT', `/drivers/${id}/rate`, { rate_per_mile: rate }),
  updateDriverNotes: (id, notes) => req('PUT', `/drivers/${id}/notes`, { notes }),
  get: (path) => req('GET', path.replace(/^\/api/, '')),
}
