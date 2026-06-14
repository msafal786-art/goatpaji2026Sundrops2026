const BASE = '/api'

function getToken() {
  return localStorage.getItem('token')
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
  login: (u, p) => req('POST', '/login', { username: u, password: p }),
  me: () => req('GET', '/me'),

  companies: () => req('GET', '/companies'),
  createCompany: (d) => req('POST', '/companies', d),
  updateCompany: (id, d) => req('PUT', `/companies/${id}`, d),

  users: () => req('GET', '/users'),
  createUser: (d) => req('POST', '/users', d),

  drivers: () => req('GET', '/drivers'),
  createDriver: (d) => req('POST', '/drivers', d),
  updateDriver: (id, d) => req('PUT', `/drivers/${id}`, d),
  deleteDriver: (id) => req('DELETE', `/drivers/${id}`),

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

  stats: () => req('GET', '/stats'),

  search: (q) => req('GET', `/search?q=${encodeURIComponent(q)}`),
  get: (path) => req('GET', path.replace(/^\/api/, '')),
}
