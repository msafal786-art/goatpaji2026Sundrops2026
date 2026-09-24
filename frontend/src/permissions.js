// ── Single source of truth for what a user may see/do on the client ──────────
// The server enforces all of this too (scopeCompanyIds / requireAdmin); these
// helpers just decide which buttons and sections to render, so a scoped user
// never sees a control they'd only get "Forbidden" from. Mirrors the backend's
// admin definition: an unscoped dispatcher.

export function isAdmin(user) {
  return !!user && user.role === 'dispatcher' && !user.company_id && !user.allowed_company_ids
}

// Mirrors the server (dashboard-stats / revenue-streams): admin and carrier
// owners always see revenue; other scoped users only if explicitly granted.
export function canSeeRevenue(user) {
  return isAdmin(user) || user?.role === 'company_owner' || !!user?.can_see_revenue
}

// The {id,name} companies a scoped user belongs to (from /me). Empty for admin.
export function userCompanies(user) {
  return Array.isArray(user?.companies) ? user.companies : []
}

// Only multi-company users get a company switcher.
export function isMultiCompany(user) {
  return userCompanies(user).length > 1
}

// Whether the current view spans several carriers — admin, or a multi-company
// user on "All companies". Drives carrier badges, filters and company pickers.
// (A user who switched to one carrier sees just that one, so no picker.)
export function seesMultipleCompanies(user) {
  if (isAdmin(user)) return true
  return isMultiCompany(user) && !localStorageGet('activeCompany')
}

function localStorageGet(k) {
  try { return localStorage.getItem(k) || '' } catch { return '' }
}

// Carrier owner / carrier admin → the Team page (server decides, on /me).
export function canManageTeam(user) {
  return !isAdmin(user) && !!user?.can_manage_team
}

// Broker Inbox is scoped to the carrier whose mailbox is connected (plus admin).
// The server decides and sets can_see_inbox on the profile.
export function canSeeInbox(user) {
  return !!user?.can_see_inbox
}
