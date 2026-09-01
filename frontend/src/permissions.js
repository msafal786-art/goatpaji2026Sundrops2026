// ── Single source of truth for what a user may see/do on the client ──────────
// The server enforces all of this too (scopeCompanyIds / requireAdmin); these
// helpers just decide which buttons and sections to render, so a scoped user
// never sees a control they'd only get "Forbidden" from. Mirrors the backend's
// admin definition: an unscoped dispatcher.

export function isAdmin(user) {
  return !!user && user.role === 'dispatcher' && !user.company_id && !user.allowed_company_ids
}

// Admin always sees revenue; scoped users only if explicitly granted.
export function canSeeRevenue(user) {
  return isAdmin(user) || !!user?.can_see_revenue
}

// The {id,name} companies a scoped user belongs to (from /me). Empty for admin.
export function userCompanies(user) {
  return Array.isArray(user?.companies) ? user.companies : []
}

// Only multi-company users get a company switcher.
export function isMultiCompany(user) {
  return userCompanies(user).length > 1
}

// Broker Inbox is scoped to the carrier whose mailbox is connected (plus admin).
// The server decides and sets can_see_inbox on the profile.
export function canSeeInbox(user) {
  return !!user?.can_see_inbox
}
