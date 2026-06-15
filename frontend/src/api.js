const BASE = '/api'

function getToken() {
  return localStorage.getItem('token')
}

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

async function req(method, path, body, isForm = false) {
  const headers = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (!isForm) headers['Content-Type'] = 'application/json'

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
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
  createLoad: (d) => req('POST', '/loads', d),
  updateLoad: (id, d) => req('PUT', `/loads/${id}`, d),
  deleteLoad: (id) => req('DELETE', `/loads/${id}`),
  dispatchMessage: (id) => req('GET', `/loads/${id}/dispatch-message`),
  markDispatched: (id) => req('POST', `/loads/${id}/mark-dispatched`),
  updateLoadStatus: (id, status) => req('POST', `/loads/${id}/status`, { status }),

  parseRateCon: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('POST', '/parse-rate-con', fd, true)
  },

  // Load documents
  loadDocs: (loadId) => req('GET', `/loads/${loadId}/docs`),
  uploadDoc: (loadId, file, doc_type) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('doc_type', doc_type)
    return req('POST', `/loads/${loadId}/docs`, fd, true)
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

  activeUsers: () => req('GET', '/active-users'),
  search: (q) => req('GET', `/search?q=${encodeURIComponent(q)}`),
  recommendations: () => req('GET', '/recommendations'),
  payrollWeek: (start) => req('GET', `/payroll/week?start=${start}`),
  savePayrollEntry: (body) => req('PUT', '/payroll/entry', body),
  deletePayrollEntry: (driver_id, date) => req('DELETE', `/payroll/entry?driver_id=${driver_id}&date=${date}`),
  updateDriverRate: (id, rate) => req('PUT', `/drivers/${id}/rate`, { rate_per_mile: rate }),
  get: (path) => req('GET', path.replace(/^\/api/, '')),
}
