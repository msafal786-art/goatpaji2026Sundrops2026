require('dotenv').config();

// Fail fast if critical env vars are missing — prevents silent JWT signing with empty secret
if (!process.env.JWT_SECRET) {
  console.error('[fatal] JWT_SECRET is not set — refusing to start');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Anthropic = require('@anthropic-ai/sdk');
const drive = require('./drive.js');

// If running on Railway with a volume, seed the DB from the bundled file on first deploy
const VOL_DB = process.env.DB_PATH;
const BUNDLED_DB = path.join(__dirname, 'dispatch.db');
if (VOL_DB && VOL_DB !== BUNDLED_DB && !fs.existsSync(VOL_DB) && fs.existsSync(BUNDLED_DB)) {
  fs.mkdirSync(path.dirname(VOL_DB), { recursive: true });
  fs.copyFileSync(BUNDLED_DB, VOL_DB);
  console.log('Copied bundled dispatch.db to volume');
}

const db = require('./db');

const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // frontend uses inline styles; re-enable if migrating to CSS files
  crossOriginEmbedderPolicy: false,
}));

// Trust Railway's reverse proxy so rate-limiters get real client IPs
app.set('trust proxy', 1);

// ── CORS — allow only our domain + localhost dev ─────────────────────────────
const ALLOWED_ORIGINS = [
  'https://goatpaji.com',
  'https://www.goatpaji.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3001',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── Body size limit ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
// /uploads served after UPLOADS_DIR is defined below

// ── Login rate limiter: 10 attempts per 15 min per IP ────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── General API rate limiter: 300 req per 1 min ──────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// /uploads is NOT served statically — all file access goes through authenticated API endpoints

const ALLOWED_UPLOAD_TYPES = ['application/pdf','image/jpeg','image/jpg','image/png','image/heic','image/heif'];
// Mobile browsers (iOS/Android) often report PDFs as application/octet-stream or leave type empty.
// Fall back to extension check so valid files aren't blocked by an ambiguous MIME type.
const ALLOWED_EXTENSIONS = new Set(['.pdf','.jpg','.jpeg','.png','.heic','.heif']);
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_UPLOAD_TYPES.includes(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) return cb(null, true);
    req._fileTypeError = 'Only PDF, JPG, PNG, or HEIC files are allowed';
    cb(null, false);
  },
});
// Document reads take 15–40s. Give the SDK room and let it ride out transient
// upstream failures (429 / 5xx / connection errors) before we surface an error.
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 100000,
  maxRetries: 3,
});

// ── Driver availability ──────────────────────────────────────────────────────
// drivers.status duplicates something the loads table already knows, so it
// drifts: finishing one load used to mark a driver 'available' even when they
// were still running another. Recompute it from the loads instead of setting
// it by hand at each call site.
//
// 'off_duty' is a deliberate choice by a dispatcher, so it is never
// auto-cleared here — only the available/on_load pair is derived.
const ACTIVE_LOAD_SQL = "status NOT IN ('delivered','completed')";

function syncDriverStatus(driverId) {
  if (!driverId) return;
  const d = db.prepare('SELECT status FROM drivers WHERE id = ?').get(driverId);
  if (!d || d.status === 'off_duty') return;
  const n = db.prepare(`SELECT COUNT(*) AS n FROM loads WHERE driver_id = ? AND ${ACTIVE_LOAD_SQL}`).get(driverId).n;
  db.prepare('UPDATE drivers SET status = ? WHERE id = ?').run(n > 0 ? 'on_load' : 'available', driverId);
}

// Push an uploaded file to Drive and, once Drive confirms it, drop the local
// copy so Drive is the only place documents live.
//
// The local file is deleted ONLY on a confirmed Drive file id. If Drive is
// unconfigured, down, or errors, the file stays on disk and the download
// endpoint serves it from there — an upload must never silently lose a BOL
// just because Google was unavailable.
async function storeDocument(localPath, fileName, mimeType) {
  const driveId = await drive.upload(localPath, fileName, mimeType);
  if (driveId) {
    try { fs.unlinkSync(localPath); } catch (e) {
      console.error('[storage] Drive copy saved but local cleanup failed:', e.message);
    }
  }
  return driveId;
}

// Parsed-but-never-filed uploads (a rate con read, then the tab closed) leave
// a staged file behind that no /discard call will ever clean up. Sweep files
// that no document row references and that nothing is plausibly still working
// on, so the volume doesn't creep up with abandoned scratch.
const STAGE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
function sweepStagedUploads() {
  try {
    const referenced = new Set([
      ...db.prepare('SELECT filename FROM load_docs').all(),
      ...db.prepare('SELECT filename FROM truck_docs').all(),
    ].map(r => r.filename));
    const cutoff = Date.now() - STAGE_TTL_MS;
    let removed = 0;
    for (const name of fs.readdirSync(UPLOADS_DIR)) {
      if (referenced.has(name)) continue;
      const p = path.join(UPLOADS_DIR, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); removed++; }
      } catch {}
    }
    if (removed) console.log(`[storage] Swept ${removed} abandoned staged upload(s)`);
  } catch (e) {
    console.error('[storage] Sweep failed:', e.message);
  }
}
setInterval(sweepStagedUploads, 60 * 60 * 1000).unref();
setTimeout(sweepStagedUploads, 30000).unref();

// Documents are named for what they are, not whatever the scanner called them:
//   "2499616 - BOL.pdf", "2499616 - Rate Con.pdf", "2499616 - POD (2).pdf"
// so a folder of them is searchable by load number in Drive.
function buildDocName(ref, docType, originalName, existingCount = 0) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
  const ext = path.extname(originalName || '').toLowerCase() || '.pdf';
  const label = clean(docType) || 'Document';
  const prefix = clean(ref) || 'Unfiled';
  const dupe = existingCount > 0 ? ` (${existingCount + 1})` : '';
  return `${prefix} - ${label}${dupe}${ext}`;
}

// How this load should be referred to in a filename.
function loadRef(loadId) {
  const l = db.prepare('SELECT load_number, broker_order, id FROM loads WHERE id = ?').get(loadId);
  return l ? (l.load_number || l.broker_order || `Load ${l.id}`) : `Load ${loadId}`;
}

// Existing docs of this type on this load, so a second BOL becomes "(2)".
function docTypeCount(table, column, ownerId, docType) {
  const row = db.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE ${column} = ? AND doc_type = ?`)
    .get(ownerId, docType);
  return row?.n || 0;
}

// Shape an Anthropic failure into a message the dispatcher can act on, plus a
// `retryable` flag the frontend uses to decide whether to try again itself.
function describeParseError(err) {
  const m = err?.message || '';
  if (err?.status === 429)  return { msg: 'Too many documents at once — wait a few seconds and retry.', retryable: true };
  if (err?.status === 529 || /overload/i.test(m)) return { msg: 'Document service is busy — retry in a moment.', retryable: true };
  if (err?.status >= 500)   return { msg: 'Document service had a problem — retry in a moment.', retryable: true };
  if (/credit/i.test(m))    return { msg: 'PDF reading unavailable — API credits exhausted. Enter details manually.', retryable: false };
  if (err?.status === 401 || /api key/i.test(m)) return { msg: 'PDF reading unavailable — API key not configured. Contact admin.', retryable: false };
  if (/timeout|ETIMEDOUT|aborted/i.test(m)) return { msg: 'Reading this PDF took too long — retry, or enter it manually.', retryable: true };
  if (/No JSON/i.test(m))   return { msg: 'Could not read load details from this PDF — try entering manually.', retryable: false };
  return { msg: 'Failed to read PDF', retryable: false };
}

// ── Health check (Railway uses this) ────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    // Fetch allowed_company_ids fresh (admin can change access without requiring re-login)
    try {
      const u = db.prepare('SELECT last_seen_at, allowed_company_ids FROM users WHERE id = ?').get(req.user.id);
      const stale = !u?.last_seen_at || (Date.now() - new Date(u.last_seen_at).getTime()) > 60000;
      if (stale) db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), req.user.id);
      if (u) req.user.allowed_company_ids = u.allowed_company_ids || null;
    } catch {}
    // Company switcher: a multi-company scoped user may narrow this request to a
    // single one of their companies via the X-Active-Company header. This flows
    // through scopeCompanyIds()/companyScopeClause() so every scoped endpoint
    // honors it automatically. Ignored for admins and for ids outside scope.
    const active = Number(req.headers['x-active-company']);
    if (active && req.user.allowed_company_ids) {
      try {
        const ids = JSON.parse(req.user.allowed_company_ids).map(Number);
        if (ids.includes(active)) req.user.allowed_company_ids = JSON.stringify([active]);
      } catch {}
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Append one entry to a load's activity trail. Never throws — logging must not
// break the request it's recording. `action` is a short verb ('created',
// 'dispatched', 'status', 'edited', 'driver_changed'); `detail` is free text.
function logActivity(loadId, req, action, detail = '') {
  try {
    const name = req?.user?.full_name || (req?.user?.role === 'driver' ? 'Driver' : 'System');
    db.prepare('INSERT INTO load_activity (load_id, action, detail, user_id, user_name) VALUES (?,?,?,?,?)')
      .run(loadId, action, detail || null, req?.user?.id || null, name);
  } catch (e) {
    console.error('[activity] failed to log', action, 'for load', loadId, e.message);
  }
}

// ── Audit log (persistent oversight trail) ───────────────────────────────────
// The client's real IP, honoring the proxy chain Railway sits behind.
function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || req.ip || null;
}

// Minimal cookie-header parser (we don't pull in cookie-parser for one cookie).
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Append an audit record. Never throws. Returns the new row id (or null) so a
// caller can enrich it — e.g. attach coarse geo once the async lookup returns.
function logAudit(req, action, detail = '', extra = {}) {
  try {
    const u = req?.user || {};
    const r = db.prepare(`INSERT INTO audit_log
      (user_id, user_name, role, company_id, action, detail, ip, user_agent, device_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      extra.user_id ?? u.id ?? null,
      extra.user_name ?? u.full_name ?? null,
      extra.role ?? u.role ?? null,
      extra.company_id ?? u.company_id ?? null,
      action, detail || null,
      clientIp(req), (req.headers['user-agent'] || '').slice(0, 400),
      extra.device_id ?? parseCookies(req).did ?? null,
    );
    return r.lastInsertRowid;
  } catch (e) {
    console.error('[audit] failed to log', action, e.message);
    return null;
  }
}

// Best-effort coarse geolocation from IP. Non-blocking: the login response is
// already sent; this just enriches the audit row when/if it resolves. Private
// IPs and lookup failures are silently skipped.
async function enrichAuditGeo(auditId, ip) {
  if (!auditId || !ip) return;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fc|fd)/i.test(ip)) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city`, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await res.json();
    if (j.status === 'success') {
      db.prepare('UPDATE audit_log SET city = ?, country = ? WHERE id = ?').run(j.city || null, j.country || null, auditId);
    }
  } catch { /* geo is best-effort */ }
}

// Human-readable labels for load statuses, used in the activity trail.
const STATUS_LABELS = {
  open: 'Open', covered: 'Covered', dispatched: 'Dispatched', loading: 'Loading',
  on_route: 'On Route', unloading: 'Unloading', in_yard: 'In Yard',
  delivered: 'Delivered', completed: 'Completed',
};

// ── Company scoping — single source of truth for data isolation ──────────────
// Every endpoint that returns or mutates company-owned rows MUST scope through
// these. The failure mode we guard against: a scoped user (company_owner, or a
// dispatcher with allowed_company_ids / company_id) falling through to "no
// filter", which returns every carrier's data.
//
// Returns the list of company_ids a user may access, or null for unrestricted
// admin access. An empty array means "scoped to nothing" — never "everything".
function scopeCompanyIds(user) {
  const isAdmin = user.role === 'dispatcher' && !user.company_id && !user.allowed_company_ids;
  if (isAdmin) return null;
  if (user.allowed_company_ids) {
    try {
      const ids = JSON.parse(user.allowed_company_ids);
      return Array.isArray(ids) ? ids.map(Number) : [];
    } catch { return []; }
  }
  if (user.company_id) return [Number(user.company_id)];
  return [];
}

// True if the user may access rows belonging to companyId.
function userCanAccessCompany(user, companyId) {
  const ids = scopeCompanyIds(user);
  if (ids === null) return true;
  return companyId != null && ids.includes(Number(companyId));
}

// Builds a SQL clause restricting `col` (a qualified company column, e.g.
// 'l.company_id') to the user's scope. `lead` is the joining keyword ('WHERE'
// or 'AND'). Admin → empty clause. Empty scope → an impossible predicate so
// zero rows are returned rather than all of them.
function companyScopeClause(user, col, lead = 'WHERE') {
  const ids = scopeCompanyIds(user);
  if (ids === null) return { clause: '', params: [] };
  if (ids.length === 0) return { clause: `${lead} 1=0`, params: [] };
  return { clause: `${lead} ${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

// Admin = unscoped dispatcher. User- and company-management are admin-only:
// a scoped dispatcher is a tenant and must not enumerate accounts, create users
// (privilege escalation via role/allowed_company_ids), or rename carriers.
function requireAdmin(req, res, next) {
  if (scopeCompanyIds(req.user) !== null) return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Auth routes ──────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password, admin_code } = req.body;

  // Input validation
  if (!username || !password ||
      typeof username !== 'string' || typeof password !== 'string' ||
      username.length > 120 || password.length > 256) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  // Always run bcrypt compare (even on miss) to prevent timing attacks
  const hash = user?.password || '$2a$10$invalidhashinvalidhashinvalidhashxx';
  const match = bcrypt.compareSync(password, hash);
  if (!user || !match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Admin accounts (dispatcher with no company_id AND no allowed_company_ids) require the admin code
  const isAdmin = user.role === 'dispatcher' && !user.company_id && !user.allowed_company_ids;
  const secret = process.env.ADMIN_SECRET;
  if (isAdmin && secret) {
    if (!admin_code || admin_code !== secret) {
      return res.status(401).json({ error: 'Admin code required', need_admin_code: true });
    }
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, company_id: user.company_id, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  // Persistent device cookie: correlates repeat sessions from the same browser
  // so the admin can tell distinct devices apart in the audit log. Not used for
  // auth (the JWT is), so it stays a plain httpOnly cookie.
  let deviceId = parseCookies(req).did;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    res.cookie('did', deviceId, {
      httpOnly: true, sameSite: 'lax', secure: true,
      maxAge: 1000 * 60 * 60 * 24 * 365, path: '/',
    });
  }

  // Record where/how the portal was accessed (IP, device, coarse location).
  const auditId = logAudit(req, 'login',
    `${user.username} signed in`,
    { user_id: user.id, user_name: user.full_name || user.username, role: user.role, company_id: user.company_id, device_id: deviceId });
  enrichAuditGeo(auditId, clientIp(req)); // async, non-blocking

  console.log(`[login] user=${user.id} role=${user.role} ip=${clientIp(req)} at=${new Date().toISOString()}`);
  res.json({ token, role: user.role, full_name: user.full_name, company_id: user.company_id, allowed_company_ids: user.allowed_company_ids || null });
});

// ── Token refresh — extends session if still valid ───────────────────────────
app.post('/api/refresh', auth, (req, res) => {
  const user = db.prepare('SELECT id, role, company_id, full_name FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const token = jwt.sign(
    { id: user.id, role: user.role, company_id: user.company_id, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.username, u.role, u.company_id, u.full_name, u.email, u.phone,
           u.can_see_revenue, u.must_change_password, u.allowed_company_ids, c.name as company_name
    FROM users u LEFT JOIN companies c ON u.company_id = c.id
    WHERE u.id = ?
  `).get(req.user.id);
  if (user.role === 'driver') {
    user.driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(user.id);
  }
  // Header/branding name: admin runs the whole operation (GOAT INC); a scoped
  // user (company_owner or scoped dispatcher) sees their own carrier's name,
  // which company_name can't provide when they're scoped via allowed_company_ids.
  const scope = scopeCompanyIds(req.user);
  if (scope === null) {
    user.portal_name = 'Goat Inc';
    user.companies = [];        // admin sees all; no switcher
  } else if (scope.length > 0) {
    // Full {id,name} list powers the multi-company switcher on the client.
    user.companies = db.prepare(`SELECT id, name FROM companies WHERE id IN (${scope.map(() => '?').join(',')}) ORDER BY name`).all(...scope);
    user.portal_name = user.companies.map(c => c.name).join(' · ') || user.company_name || 'Dispatch Portal';
  } else {
    user.portal_name = user.company_name || 'Dispatch Portal';
    user.companies = [];
  }
  res.json(user);
});

// ── Change password ───────────────────────────────────────────────────────────
app.put('/api/change-password', auth, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
});

// ── Admin: bulk reset passwords ───────────────────────────────────────────────
app.post('/api/admin/reset-passwords', auth, (req, res) => {
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
  const { password, user_ids } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  const hash = bcrypt.hashSync(password, 10);
  // Reset specific user_ids, or all non-admin users if none specified
  const targets = user_ids?.length
    ? db.prepare(`SELECT id FROM users WHERE id IN (${user_ids.map(() => '?').join(',')}) AND (company_id IS NOT NULL OR role != 'dispatcher')`).all(...user_ids)
    : db.prepare(`SELECT id FROM users WHERE company_id IS NOT NULL OR role != 'dispatcher'`).all();
  for (const u of targets) {
    db.prepare('UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?').run(hash, u.id);
  }
  res.json({ ok: true, count: targets.length });
});

// ── Companies ────────────────────────────────────────────────────────────────
app.get('/api/companies', auth, (req, res) => {
  // Scope the company list to what the caller is allowed to see. Loads are already
  // filtered per-company; without this, a scoped user (company_owner / scoped
  // dispatcher) would receive every carrier's name via this endpoint (e.g. the
  // Load Board carrier chips), leaking other companies' identities.
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  if (isAdmin) {
    return res.json(db.prepare('SELECT * FROM companies ORDER BY name').all());
  }
  // Scoped dispatcher with an explicit allow-list
  if (req.user.allowed_company_ids) {
    const ids = JSON.parse(req.user.allowed_company_ids);
    if (!ids.length) return res.json([]);
    return res.json(db.prepare(`SELECT * FROM companies WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids));
  }
  // company_owner or single-company scoped dispatcher → only their own company
  if (req.user.company_id) {
    return res.json(db.prepare('SELECT * FROM companies WHERE id = ?').all(req.user.company_id));
  }
  // Drivers / anyone else with no company scope → nothing
  return res.json([]);
});

app.post('/api/companies', auth, requireAdmin, (req, res) => {
  const { name, mc_number, dot_number, address, phone, email } = req.body;
  const r = db.prepare('INSERT INTO companies (name,mc_number,dot_number,address,phone,email) VALUES (?,?,?,?,?,?)').run(name, mc_number, dot_number, address, phone, email);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/companies/:id', auth, requireAdmin, (req, res) => {
  const { name, mc_number, dot_number, address, phone, email } = req.body;
  db.prepare('UPDATE companies SET name=?,mc_number=?,dot_number=?,address=?,phone=?,email=? WHERE id=?').run(name, mc_number, dot_number, address, phone, email, req.params.id);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id));
});

// ── Users (for company owners and drivers) ───────────────────────────────────
app.get('/api/users', auth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.company_id, u.full_name, u.email, u.phone,
           u.can_see_revenue, u.last_seen_at, u.allowed_company_ids, c.name as company_name
    FROM users u LEFT JOIN companies c ON u.company_id = c.id
    WHERE u.role != 'driver'
    ORDER BY c.name, u.full_name
  `).all();
  res.json(users);
});

app.post('/api/users', auth, requireAdmin, (req, res) => {
  const { username, password, role, company_id, full_name, email, phone, can_see_revenue, allowed_company_ids } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'username, password, role required' });
  const hash = bcrypt.hashSync(password, 10);
  const acIds = Array.isArray(allowed_company_ids) && allowed_company_ids.length > 0
    ? JSON.stringify(allowed_company_ids) : null;
  try {
    const r = db.prepare('INSERT INTO users (username,password,role,company_id,full_name,email,phone,can_see_revenue,allowed_company_ids) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(username, hash, role, company_id || null, full_name || null, email || null, phone || null, can_see_revenue ? 1 : 0, acIds);
    res.json(db.prepare('SELECT u.*, c.name as company_name FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.put('/api/users/:id', auth, requireRole('dispatcher'), (req, res) => {
  const { username, full_name, email, phone, can_see_revenue, password, company_id, role, allowed_company_ids } = req.body;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
  // username is UNIQUE; only touch it when actually changing, and reject collisions
  // up front so the client gets a clear message instead of a raw constraint 500.
  const newUsername = (username || '').trim();
  if (newUsername && newUsername !== existing.username) {
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, req.params.id);
    if (taken) return res.status(409).json({ error: 'Username already taken' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, req.params.id);
  }
  if (password) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
  }
  const acIds = Array.isArray(allowed_company_ids) && allowed_company_ids.length > 0
    ? JSON.stringify(allowed_company_ids) : null;
  db.prepare('UPDATE users SET full_name=?, email=?, phone=?, can_see_revenue=?, company_id=?, role=?, allowed_company_ids=? WHERE id = ?')
    .run(full_name || existing.full_name, email || existing.email, phone || existing.phone,
         can_see_revenue ? 1 : 0, company_id !== undefined ? (company_id || null) : existing.company_id,
         role || existing.role, acIds !== undefined ? acIds : existing.allowed_company_ids, req.params.id);
  res.json(db.prepare('SELECT u.*, c.name as company_name FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.id = ?').get(req.params.id));
});

app.delete('/api/users/:id', auth, requireRole('dispatcher'), (req, res) => {
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    // foreign_keys is ON and several history tables reference users(id), so a
    // plain DELETE fails for any user who's ever uploaded a doc, logged activity,
    // etc. Detach those references (all nullable) so the login can be removed
    // while the history rows survive.
    const removeUser = db.transaction((uid) => {
      db.prepare('UPDATE drivers SET user_id = NULL WHERE user_id = ?').run(uid);
      db.prepare('UPDATE load_docs SET uploaded_by = NULL WHERE uploaded_by = ?').run(uid);
      db.prepare('UPDATE truck_docs SET uploaded_by = NULL WHERE uploaded_by = ?').run(uid);
      db.prepare('UPDATE maintenance_records SET created_by = NULL WHERE created_by = ?').run(uid);
      db.prepare('UPDATE load_activity SET user_id = NULL WHERE user_id = ?').run(uid);
      return db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    });
    const info = removeUser(id);
    if (info.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to delete user', id, e);
    res.status(500).json({ error: 'Failed to remove user', detail: e.message });
  }
});

// ── Drivers ──────────────────────────────────────────────────────────────────
app.get('/api/drivers', auth, (req, res) => {
  // Same derivation as /drivers/board — the driver dropdowns show "(on_load)"
  // from this, so it has to agree with the board.
  let query = `SELECT d.*, c.name as company_name,
      CASE WHEN d.status = 'off_duty' THEN 'off_duty'
           WHEN EXISTS (SELECT 1 FROM loads WHERE driver_id = d.id AND ${ACTIVE_LOAD_SQL})
             THEN 'on_load' ELSE 'available' END as status
    FROM drivers d LEFT JOIN companies c ON d.company_id = c.id`;
  const params = [];
  if (req.user.role === 'company_owner') {
    query += ' WHERE d.company_id = ?';
    params.push(req.user.company_id);
  } else if (req.user.allowed_company_ids) {
    const ids = JSON.parse(req.user.allowed_company_ids);
    if (ids.length > 0) {
      query += ` WHERE d.company_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  } else if (req.user.company_id) {
    query += ' WHERE d.company_id = ?';
    params.push(req.user.company_id);
  }
  query += ' ORDER BY d.full_name';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/drivers/board', auth, (req, res) => {
  let where = '';
  const params = [];
  if (req.user.role === 'company_owner') {
    where = 'WHERE d.company_id = ?'; params.push(req.user.company_id);
  } else if (req.user.allowed_company_ids) {
    const ids = JSON.parse(req.user.allowed_company_ids);
    if (ids.length > 0) { where = `WHERE d.company_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
  } else if (req.user.company_id) {
    where = 'WHERE d.company_id = ?'; params.push(req.user.company_id);
  }
  const rows = db.prepare(`
    SELECT d.id, d.full_name, d.phone, d.is_active, d.company_id,
           -- Availability is derived from the loads, never read from the
           -- stored column, so the board can't show a stale value.
           CASE WHEN d.status = 'off_duty' THEN 'off_duty'
                WHEN l.id IS NOT NULL THEN 'on_load'
                ELSE 'available' END as status,
           c.name as company_name,
           l.id as load_id, l.load_number, l.broker_name, l.status as load_status,
           l.pickup_name, l.pickup_city, l.pickup_state, l.pickup_date, l.pickup_time,
           l.delivery_name, l.delivery_city, l.delivery_state, l.delivery_date, l.delivery_time,
           l.extra_stops, l.rate, l.commodity, l.miles
    FROM drivers d
    LEFT JOIN companies c ON d.company_id = c.id
    LEFT JOIN loads l ON l.driver_id = d.id
      AND l.status NOT IN ('delivered','completed')
      AND l.id = (SELECT MAX(id) FROM loads WHERE driver_id = d.id AND status NOT IN ('delivered','completed'))
    ${where}
    ORDER BY c.name, d.full_name
  `).all(...params);
  res.json(rows);
});

app.post('/api/drivers', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const {
    full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes, company_id,
    username, password,
    hire_date, date_of_birth, address, cdl_class, license_state,
    drug_test_date, drug_test_expiry, background_check_date, emergency_contact_name, emergency_contact_phone
  } = req.body;
  const dScope = scopeCompanyIds(req.user);
  let cid;
  if (dScope === null) {
    cid = company_id;
  } else {
    cid = company_id != null && company_id !== '' ? Number(company_id) : dScope[0];
    if (!dScope.includes(Number(cid)))
      return res.status(403).json({ error: 'Forbidden: cannot create a driver for another company' });
  }

  let user_id = null;
  if (username && password) {
    const hash = bcrypt.hashSync(password, 10);
    try {
      const ur = db.prepare('INSERT INTO users (username,password,role,company_id,full_name,phone,email) VALUES (?,?,?,?,?,?,?)').run(username, hash, 'driver', cid, full_name, phone, email);
      user_id = ur.lastInsertRowid;
    } catch (e) {
      return res.status(400).json({ error: 'Username already exists' });
    }
  }

  const r = db.prepare(`INSERT INTO drivers
    (user_id,company_id,full_name,phone,email,license_number,license_expiry,medical_card_expiry,notes,
     hire_date,date_of_birth,address,cdl_class,license_state,drug_test_date,drug_test_expiry,background_check_date,
     emergency_contact_name,emergency_contact_phone)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    user_id, cid, full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes,
    hire_date||null, date_of_birth||null, address||null, cdl_class||null, license_state||null,
    drug_test_date||null, drug_test_expiry||null, background_check_date||null, emergency_contact_name||null, emergency_contact_phone||null
  );
  res.json(db.prepare('SELECT d.*, c.name as company_name FROM drivers d LEFT JOIN companies c ON d.company_id = c.id WHERE d.id = ?').get(r.lastInsertRowid));
});

app.put('/api/drivers/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const {
    full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes, status, pay_percentage,
    hire_date, date_of_birth, address, cdl_class, license_state,
    drug_test_date, drug_test_expiry, background_check_date, emergency_contact_name, emergency_contact_phone
  } = req.body;
  const existingDriver = db.prepare('SELECT company_id FROM drivers WHERE id = ?').get(req.params.id);
  if (!existingDriver) return res.status(404).json({ error: 'Driver not found' });
  if (!userCanAccessCompany(req.user, existingDriver.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  const dScope = scopeCompanyIds(req.user);
  let cid;
  if (dScope === null) {
    cid = req.body.company_id || null;
  } else {
    // Scoped users may not move a driver outside their scope; default to keeping it.
    cid = req.body.company_id != null && req.body.company_id !== ''
      ? Number(req.body.company_id) : existingDriver.company_id;
    if (!dScope.includes(Number(cid)))
      return res.status(403).json({ error: 'Forbidden: cannot move a driver to another company' });
  }
  db.prepare(`UPDATE drivers SET
    full_name=?,phone=?,email=?,license_number=?,license_expiry=?,medical_card_expiry=?,notes=?,status=?,pay_percentage=?,
    hire_date=?,date_of_birth=?,address=?,cdl_class=?,license_state=?,drug_test_date=?,drug_test_expiry=?,background_check_date=?,
    emergency_contact_name=?,emergency_contact_phone=?,company_id=?
    WHERE id=?`).run(
    full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes, status, pay_percentage ?? 70,
    hire_date||null, date_of_birth||null, address||null, cdl_class||null, license_state||null,
    drug_test_date||null, drug_test_expiry||null, background_check_date||null, emergency_contact_name||null, emergency_contact_phone||null,
    cid, req.params.id
  );
  res.json(db.prepare('SELECT d.*, c.name as company_name FROM drivers d LEFT JOIN companies c ON d.company_id = c.id WHERE d.id = ?').get(req.params.id));
});

// Bulk reassign drivers to a company: { driver_ids: [1,2,3], company_id: 6 }
app.post('/api/drivers/bulk-assign-company', auth, requireRole('dispatcher'), (req, res) => {
  const { driver_ids, company_id } = req.body;
  // Reassigning drivers across carriers is an admin-only operation.
  if (scopeCompanyIds(req.user) !== null) return res.status(403).json({ error: 'Forbidden' });
  if (!Array.isArray(driver_ids) || !company_id) return res.status(400).json({ error: 'driver_ids and company_id required' });
  const update = db.prepare('UPDATE drivers SET company_id=? WHERE id=?');
  const tx = db.transaction(() => driver_ids.forEach(id => update.run(company_id, id)));
  tx();
  res.json({ updated: driver_ids.length });
});

app.delete('/api/drivers/:id', auth, requireRole('dispatcher'), (req, res) => {
  const driver = db.prepare('SELECT company_id FROM drivers WHERE id = ?').get(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (!userCanAccessCompany(req.user, driver.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM drivers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Trucks ───────────────────────────────────────────────────────────────────
app.get('/api/trucks', auth, (req, res) => {
  let query = 'SELECT t.*, c.name as company_name FROM trucks t LEFT JOIN companies c ON t.company_id = c.id';
  const params = [];
  if (req.user.role === 'company_owner') {
    query += ' WHERE t.company_id = ?';
    params.push(req.user.company_id);
  } else if (req.user.allowed_company_ids) {
    const ids = JSON.parse(req.user.allowed_company_ids);
    if (ids.length > 0) {
      query += ` WHERE t.company_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  } else if (req.user.company_id) {
    query += ' WHERE t.company_id = ?';
    params.push(req.user.company_id);
  }
  query += ' ORDER BY t.tractor_number';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/trucks', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { tractor_number, trailer_number, trailer_type, vin, plate, registration_expiry, insurance_expiry, notes, company_id } = req.body;
  const tScope = scopeCompanyIds(req.user);
  let cid;
  if (tScope === null) {
    cid = company_id;
  } else {
    cid = company_id != null && company_id !== '' ? Number(company_id) : tScope[0];
    if (!tScope.includes(Number(cid)))
      return res.status(403).json({ error: 'Forbidden: cannot create a truck for another company' });
  }
  const r = db.prepare('INSERT INTO trucks (company_id,tractor_number,trailer_number,trailer_type,vin,plate,registration_expiry,insurance_expiry,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(cid, tractor_number, trailer_number, trailer_type, vin, plate, registration_expiry, insurance_expiry, notes);
  res.json(db.prepare('SELECT t.*, c.name as company_name FROM trucks t LEFT JOIN companies c ON t.company_id = c.id WHERE t.id = ?').get(r.lastInsertRowid));
});

app.put('/api/trucks/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { tractor_number, trailer_number, trailer_type, vin, plate, registration_expiry, insurance_expiry, notes, status, company_id } = req.body;
  const existing = db.prepare('SELECT company_id FROM trucks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, existing.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  // Only an unscoped admin dispatcher may move a truck between carriers — it
  // changes who can see the truck and which drivers can be put on it.
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  const effectiveCompanyId = isAdmin && company_id ? company_id : existing.company_id;

  db.prepare('UPDATE trucks SET tractor_number=?,trailer_number=?,trailer_type=?,vin=?,plate=?,registration_expiry=?,insurance_expiry=?,notes=?,status=?,company_id=? WHERE id=?')
    .run(tractor_number, trailer_number, trailer_type, vin, plate, registration_expiry, insurance_expiry, notes, status, effectiveCompanyId, req.params.id);
  res.json(db.prepare('SELECT t.*, c.name as company_name FROM trucks t LEFT JOIN companies c ON t.company_id = c.id WHERE t.id = ?').get(req.params.id));
});

app.delete('/api/trucks/:id', auth, requireRole('dispatcher'), (req, res) => {
  const truck = db.prepare('SELECT company_id FROM trucks WHERE id = ?').get(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, truck.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM trucks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Loads ────────────────────────────────────────────────────────────────────
function loadsQuery(where = '', params = []) {
  return db.prepare(`
    SELECT l.*,
      d.full_name as driver_name, d.phone as driver_phone,
      rd.full_name as relay_driver_name,
      od.full_name as original_driver_name, od.phone as original_driver_phone,
      t.tractor_number, t.trailer_number as truck_trailer,
      c.name as company_name
    FROM loads l
    LEFT JOIN drivers d ON l.driver_id = d.id
    LEFT JOIN drivers rd ON l.relay_driver_id = rd.id
    LEFT JOIN drivers od ON l.original_driver_id = od.id
    LEFT JOIN trucks t ON l.truck_id = t.id
    LEFT JOIN companies c ON l.company_id = c.id
    ${where}
    ORDER BY l.created_at DESC
  `).all(...params);
}

app.get('/api/loads', auth, (req, res) => {
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) return res.json([]);
    // Drivers only see loads once dispatched and while active — not pending/assigned/completed
    // Strip financial fields — drivers must never see rate/pay amounts
    return res.json(loadsQuery("WHERE l.driver_id = ? AND l.status IN ('dispatched','loading','on_route','unloading','in_yard','delivered')", [driver.id])
      .map(({ rate, relay_split, ...rest }) => rest));
  }
  if (req.user.role === 'company_owner') {
    return res.json(loadsQuery('WHERE l.company_id = ?', [req.user.company_id]));
  }
  // Multi-company scoped dispatcher
  if (req.user.allowed_company_ids) {
    const ids = JSON.parse(req.user.allowed_company_ids);
    if (ids.length > 0) {
      const { status } = req.query;
      let where = `WHERE l.company_id IN (${ids.map(() => '?').join(',')})`;
      const params = [...ids];
      if (status) { where += ' AND l.status = ?'; params.push(status); }
      return res.json(loadsQuery(where, params));
    }
  }
  // Single-company scoped dispatcher (old style)
  if (req.user.company_id) {
    const { status } = req.query;
    let where = 'WHERE l.company_id = ?';
    const params = [req.user.company_id];
    if (status) { where += ' AND l.status = ?'; params.push(status); }
    return res.json(loadsQuery(where, params));
  }
  // Admin dispatcher — can filter by any company via query param
  const { company_id, status } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (company_id) { where += ' AND l.company_id = ?'; params.push(company_id); }
  if (status) { where += ' AND l.status = ?'; params.push(status); }
  res.json(loadsQuery(where, params));
});

app.get('/api/loads/:id', auth, (req, res) => {
  const load = db.prepare(`
    SELECT l.*,
      d.full_name as driver_name, d.phone as driver_phone,
      od.full_name as original_driver_name, od.phone as original_driver_phone,
      t.tractor_number, t.trailer_number as truck_trailer,
      c.name as company_name
    FROM loads l
    LEFT JOIN drivers d ON l.driver_id = d.id
    LEFT JOIN drivers od ON l.original_driver_id = od.id
    LEFT JOIN trucks t ON l.truck_id = t.id
    LEFT JOIN companies c ON l.company_id = c.id
    WHERE l.id = ?
  `).get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });

  // IDOR: drivers can only see their own load; scoped users only their company's loads
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
    const { rate, relay_split, ...safe } = load;
    return res.json(safe);
  }
  if (!userCanAccessCompany(req.user, load.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  res.json(load);
});

// Check for duplicate load number before creating
app.get('/api/loads/check-duplicate', auth, (req, res) => {
  const num = (req.query.load_number || '').trim();
  if (!num) return res.json({ duplicate: false });
  const existing = db.prepare(`
    SELECT l.id, l.load_number, l.broker_name, l.created_at, c.name as company_name
    FROM loads l LEFT JOIN companies c ON l.company_id = c.id
    WHERE TRIM(l.load_number) = ? OR TRIM(l.broker_order) = ?
    ORDER BY l.id DESC LIMIT 1
  `).get(num, num);
  res.json({ duplicate: !!existing, load: existing || null });
});

app.post('/api/loads', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  // Company assignment is authoritative server-side. A scoped user may only
  // create loads for a company in their scope — never trust req.body.company_id
  // for them. Admin dispatchers may assign any company.
  const scopeIds = scopeCompanyIds(req.user); // null = admin (unrestricted)
  let cid;
  if (scopeIds === null) {
    cid = req.body.company_id;
  } else {
    cid = req.body.company_id != null && req.body.company_id !== ''
      ? Number(req.body.company_id) : scopeIds[0];
    if (!scopeIds.includes(Number(cid)))
      return res.status(403).json({ error: 'Forbidden: cannot create a load for another company' });
  }
  const {
    load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, notes, driver_id, truck_id, extra_stops, extra_pickups
  } = req.body;

  // Reject duplicate load numbers
  if (load_number && load_number.trim()) {
    const dup = db.prepare(
      `SELECT id FROM loads WHERE TRIM(load_number) = ? OR TRIM(broker_order) = ? LIMIT 1`
    ).get(load_number.trim(), load_number.trim());
    if (dup) return res.status(409).json({ error: `Load #${load_number} already exists (ID ${dup.id})` });
  }

  const extraStopsJson = Array.isArray(extra_stops) && extra_stops.length > 0
    ? JSON.stringify(extra_stops) : null;
  const extraPickupsJson = Array.isArray(extra_pickups) && extra_pickups.length > 0
    ? JSON.stringify(extra_pickups) : null;

  const r = db.prepare(`INSERT INTO loads (
    company_id, load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, notes, driver_id, truck_id,
    status, extra_stops, extra_pickups
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    cid, load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, notes || null, driver_id || null, truck_id || null,
    'open', extraStopsJson, extraPickupsJson
  );

  syncDriverStatus(driver_id);
  if (truck_id) {
    db.prepare("UPDATE trucks SET status = 'on_load' WHERE id = ?").run(truck_id);
  }

  logActivity(r.lastInsertRowid, req, 'created', `Load created${load_number ? ' (#' + load_number + ')' : ''}`);

  res.json(db.prepare('SELECT l.*, d.full_name as driver_name, t.tractor_number, t.trailer_number as truck_trailer, c.name as company_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id LEFT JOIN trucks t ON l.truck_id = t.id LEFT JOIN companies c ON l.company_id = c.id WHERE l.id = ?').get(r.lastInsertRowid));
});

app.put('/api/loads/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const existing = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Scoped users can only edit loads within their company scope.
  if (!userCanAccessCompany(req.user, existing.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  const {
    load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, notes, driver_id, truck_id, status, company_id, extra_stops, extra_pickups
  } = req.body;

  // Old driver's availability is recomputed after the load row is updated —
  // doing it here would still see this load assigned to them.
  if (existing.truck_id && existing.truck_id !== truck_id) {
    db.prepare("UPDATE trucks SET status = 'available' WHERE id = ?").run(existing.truck_id);
  }

  const newStatus = status || existing.status;

  // Only admin dispatcher can change which company a load belongs to
  const isAdminEdit = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  const effectiveCompanyId = isAdminEdit ? (company_id || existing.company_id) : existing.company_id;

  const extraStopsJson = Array.isArray(extra_stops) && extra_stops.length > 0
    ? JSON.stringify(extra_stops) : null;
  const extraPickupsJson = Array.isArray(extra_pickups) && extra_pickups.length > 0
    ? JSON.stringify(extra_pickups) : null;

  db.prepare(`UPDATE loads SET
    company_id=?, load_number=?, broker_name=?, broker_order=?, broker_contact=?, broker_email=?,
    commodity=?, weight=?, miles=?, trailer_type=?, bol=?, rate=?,
    pickup_name=?, pickup_address=?, pickup_city=?, pickup_state=?, pickup_zip=?,
    pickup_date=?, pickup_time=?, pickup_phone=?, pickup_refs=?,
    delivery_name=?, delivery_address=?, delivery_city=?, delivery_state=?, delivery_zip=?,
    delivery_date=?, delivery_time=?, delivery_phone=?, delivery_refs=?,
    special_instructions=?, notes=?, driver_id=?, truck_id=?, status=?, extra_stops=?, extra_pickups=?
    WHERE id=?
  `).run(
    effectiveCompanyId,
    load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, notes || null, driver_id || null, truck_id || null, newStatus, extraStopsJson, extraPickupsJson,
    req.params.id
  );

  // Record which fields actually changed, so the activity trail shows real edits.
  const editable = {
    load_number: 'Load #', broker_name: 'Broker', broker_order: 'Broker order',
    commodity: 'Commodity', weight: 'Weight', miles: 'Miles', trailer_type: 'Trailer',
    bol: 'BOL', rate: 'Rate',
    pickup_name: 'Pickup', pickup_address: 'Pickup address', pickup_city: 'Pickup city',
    pickup_state: 'Pickup state', pickup_zip: 'Pickup zip', pickup_date: 'Pickup date',
    pickup_time: 'Pickup time', pickup_refs: 'Pickup PO',
    delivery_name: 'Delivery', delivery_address: 'Delivery address', delivery_city: 'Delivery city',
    delivery_state: 'Delivery state', delivery_zip: 'Delivery zip', delivery_date: 'Delivery date',
    delivery_time: 'Delivery time', delivery_refs: 'Delivery PO',
    special_instructions: 'Instructions', notes: 'Notes',
  };
  const changed = Object.keys(editable)
    .filter(k => (req.body[k] ?? '') !== (existing[k] ?? '') && !(!req.body[k] && !existing[k]))
    .map(k => editable[k]);
  if (changed.length) logActivity(req.params.id, req, 'edited', 'Edited: ' + changed.join(', '));
  if (newStatus !== existing.status) {
    logActivity(req.params.id, req, 'status',
      `${STATUS_LABELS[existing.status] || existing.status} → ${STATUS_LABELS[newStatus] || newStatus}`);
  }

  // Recompute both sides: the driver taken off this load may still be running
  // another, and the one put on it may have been idle.
  syncDriverStatus(existing.driver_id);
  syncDriverStatus(driver_id);
  if (truck_id) db.prepare("UPDATE trucks SET status = 'on_load' WHERE id = ?").run(truck_id);

  res.json(db.prepare('SELECT l.*, d.full_name as driver_name, d.phone as driver_phone, t.tractor_number, t.trailer_number as truck_trailer, c.name as company_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id LEFT JOIN trucks t ON l.truck_id = t.id LEFT JOIN companies c ON l.company_id = c.id WHERE l.id = ?').get(req.params.id));
});

app.delete('/api/loads/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  // Scoped users (company owners / scoped dispatchers) may delete their own
  // company's loads; admin may delete any. The load-scoped activity trail
  // cascade-deletes with the load, so the permanent "who deleted this" record
  // goes to the audit_log, which has no FK to loads.
  if (!userCanAccessCompany(req.user, load.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  logAudit(req, 'load_deleted',
    `Deleted load${load.load_number ? ' #' + load.load_number : ' (ID ' + load.id + ')'}` +
    `${load.broker_name ? ' — ' + load.broker_name : ''}`,
    { company_id: load.company_id });
  if (load.truck_id) db.prepare("UPDATE trucks SET status = 'available' WHERE id = ?").run(load.truck_id);
  db.prepare('DELETE FROM loads WHERE id = ?').run(req.params.id);
  syncDriverStatus(load.driver_id); // after the delete, so this load no longer counts
  res.json({ ok: true });
});

// ── Dispatch message ──────────────────────────────────────────────────────────
app.get('/api/loads/:id/dispatch-message', auth, (req, res) => {
  const load = db.prepare('SELECT l.*, d.full_name as driver_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id WHERE l.id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // WhatsApp bolding helpers: *text* renders bold. We only bold the things that
  // matter most — appointment TIMES (never dates), PO/reference numbers, the
  // BOL/POD reminders, and any fines/penalties in the broker notes.
  const bold = (t) => (t == null || t === '') ? t : `*${t}*`
  // "On: <date> @ <time>" — bold only the time portion, leave the date plain.
  const onLine = (date, time) => `On: ${date}${time ? ' @ ' + bold(time) : ''}`
  // "PO: BM: X, PO: Y, IX: Z" — bold each value after a label, keep labels plain.
  const boldRefs = (refs) => String(refs).split(',').map(p => p.trim()).map(part => {
    const idx = part.indexOf(':')
    if (idx === -1) return bold(part)
    return `${part.slice(0, idx + 1)} ${bold(part.slice(idx + 1).trim())}`
  }).join(', ')
  // Bold any note line that mentions a fine/penalty or a $ amount; leave the
  // rest of the broker notes (auto-tracking, RXO, accessorials) plain.
  const boldFines = (text) => String(text).split('\n').map(line =>
    /\b(fine|penalt|late\s*fee|chargeback|\$\s?\d)/i.test(line) ? bold(line.trim()) : line
  ).join('\n')

  const BOL_REMINDER = `Send ${bold('BOL and Picture of seal before leaving Shipper')}`
  const POD_REMINDER = `Send ${bold('POD right after delivery')}`

  const lines = []
  lines.push(`Hello ${load.driver_name || 'Driver'},`)
  lines.push('')
  lines.push(`Load Number: ${load.load_number || load.id}`)

  // Pickup block(s)
  let extraPickups = []
  try { extraPickups = load.extra_pickups ? JSON.parse(load.extra_pickups) : [] } catch {}
  const totalPickups = 1 + extraPickups.length

  lines.push('')
  lines.push(`${totalPickups > 1 ? 'Pick 1' : 'Pick'}: ${load.pickup_name || ''}`)
  const puAddr = [load.pickup_address, load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).join(', ')
  if (puAddr) lines.push(`At: ${puAddr}`)
  if (load.pickup_date) lines.push(onLine(load.pickup_date, load.pickup_time))
  if (load.pickup_refs) lines.push(`PO: ${boldRefs(load.pickup_refs)}`)
  if (load.pickup_phone) lines.push(`Call: ${load.pickup_phone}`)
  lines.push(BOL_REMINDER)

  extraPickups.forEach((pick, i) => {
    lines.push('')
    lines.push(`Pick ${i + 2}: ${pick.name || ''}`)
    const addr = [pick.address, pick.city, pick.state, pick.zip].filter(Boolean).join(', ')
    if (addr) lines.push(`At: ${addr}`)
    if (pick.date) lines.push(onLine(pick.date, pick.time))
    if (pick.refs) lines.push(`PO: ${boldRefs(pick.refs)}`)
    if (pick.phone) lines.push(`Call: ${pick.phone}`)
    lines.push(BOL_REMINDER)
  })

  // Delivery block
  lines.push('')
  lines.push(`Drop 1: ${load.delivery_name || ''}`)
  const delAddr = [load.delivery_address, load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).join(', ')
  if (delAddr) lines.push(`At: ${delAddr}`)
  if (load.delivery_date) lines.push(onLine(load.delivery_date, load.delivery_time))
  if (load.delivery_refs) lines.push(`PO: ${boldRefs(load.delivery_refs)}`)
  if (load.delivery_phone) lines.push(`Call: ${load.delivery_phone}`)
  lines.push(POD_REMINDER)

  // Extra stops
  let extraStops = []
  try { extraStops = load.extra_stops ? JSON.parse(load.extra_stops) : [] } catch {}
  extraStops.forEach((stop, i) => {
    lines.push('')
    lines.push(`Drop ${i + 2}: ${stop.name || ''}`)
    const addr = [stop.address, stop.city, stop.state, stop.zip].filter(Boolean).join(', ')
    if (addr) lines.push(`At: ${addr}`)
    if (stop.date) lines.push(onLine(stop.date, stop.time))
    if (stop.refs) lines.push(`PO: ${boldRefs(stop.refs)}`)
    if (stop.phone) lines.push(`Call: ${stop.phone}`)
    lines.push(POD_REMINDER)
  })

  // Broker notes — always included in full (fines and everything the broker sent,
  // never the rate). Fine/penalty lines get bolded.
  if (load.special_instructions) {
    lines.push('')
    lines.push('Notes:')
    lines.push(boldFines(load.special_instructions))
  }

  res.json({ message: lines.join('\n') });
});

app.post('/api/loads/:id/mark-dispatched', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const load = db.prepare('SELECT company_id FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, load.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE loads SET dispatch_sent=1, dispatch_sent_at=datetime('now'), status='dispatched' WHERE id=?").run(req.params.id);
  logActivity(req.params.id, req, 'dispatched', 'Dispatch message sent');
  res.json({ ok: true });
});

app.post('/api/loads/:id/status', auth, (req, res) => {
  const {
    status,
    checkin_time, checkin_notes, trailer_number,
    checkout_time, bol_sent,
    delivery_checkin_time,
    delivery_checkout_time, delivery_bol_sent,
  } = req.body;
  const validStatuses = ['open','covered','dispatched','loading','on_route','unloading','in_yard','delivered','completed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
    const driverAllowed = ['dispatched','loading','on_route','unloading','in_yard','delivered'];
    if (!driverAllowed.includes(status)) return res.status(403).json({ error: 'Drivers cannot set this status' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Build UPDATE including any extra check-in/out fields the driver submitted
  const fields = { status };
  if (['dispatched','loading'].includes(status)) {
    if (checkin_time)  fields.checkin_time  = checkin_time;
    if (checkin_notes) fields.checkin_notes = checkin_notes;
    if (trailer_number) fields.trailer_number = trailer_number;
  }
  if (status === 'on_route') {
    if (checkout_time) fields.checkout_time = checkout_time;
    if (bol_sent !== undefined) fields.bol_sent = bol_sent ? 1 : 0;
  }
  if (status === 'unloading') {
    if (delivery_checkin_time) fields.delivery_checkin_time = delivery_checkin_time;
  }
  if (status === 'delivered') {
    if (delivery_checkout_time) fields.delivery_checkout_time = delivery_checkout_time;
    if (delivery_bol_sent !== undefined) fields.delivery_bol_sent = delivery_bol_sent ? 1 : 0;
  }

  const setClauses = Object.keys(fields).map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE loads SET ${setClauses} WHERE id=?`).run(...Object.values(fields), req.params.id);

  if (status !== load.status) {
    const extras = [];
    if (fields.checkin_time) extras.push(`in ${fields.checkin_time}`);
    if (fields.checkout_time) extras.push(`out ${fields.checkout_time}`);
    if (fields.trailer_number) extras.push(`trailer ${fields.trailer_number}`);
    if (fields.bol_sent) extras.push('BOL sent');
    if (fields.delivery_checkin_time) extras.push(`del in ${fields.delivery_checkin_time}`);
    if (fields.delivery_checkout_time) extras.push(`del out ${fields.delivery_checkout_time}`);
    if (fields.delivery_bol_sent) extras.push('POD sent');
    const label = `${STATUS_LABELS[load.status] || load.status} → ${STATUS_LABELS[status] || status}`;
    logActivity(req.params.id, req, 'status', extras.length ? `${label} (${extras.join(', ')})` : label);
  }

  // Recompute on every status change, not just on delivery — a driver freed by
  // finishing this load may still be running another one.
  syncDriverStatus(load.driver_id);
  if (['delivered','completed'].includes(status)) {
    if (load.truck_id) db.prepare("UPDATE trucks SET status='available' WHERE id=?").run(load.truck_id);
  }

  res.json({ ok: true });
});

// ── PDF Rate Con Parser ───────────────────────────────────────────────────────
app.post('/api/parse-rate-con', auth, requireRole('dispatcher', 'company_owner'), upload.single('file'), async (req, res) => {
  if (req._fileTypeError) return res.status(400).json({ error: req._fileTypeError });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const isPdf = req.file.mimetype === 'application/pdf' ||
                path.extname(req.file.originalname).toLowerCase() === '.pdf';
  if (!isPdf) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'Only PDF files are supported for rate con parsing' });
  }

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64 = fileBuffer.toString('base64');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          {
            type: 'text',
            text: `Extract all load/dispatch information from this rate confirmation PDF. Return ONLY a valid JSON object in exactly this format:

{
  "load_number": "",
  "broker_name": "",
  "broker_order": "",
  "broker_contact": "",
  "broker_email": "",
  "commodity": "",
  "weight": "",
  "miles": "",
  "trailer_type": "",
  "bol": "",
  "rate": "",
  "special_instructions": "",
  "driver_name": "",
  "driver_phone": "",
  "tractor_number": "",
  "trailer_number": "",
  "stops": []
}

The "stops" field is an array. Add ONE object per stop in the order they appear in the document. Each object:
{ "type": "pickup", "name": "", "address": "", "city": "", "state": "", "zip": "", "date": "", "time": "", "phone": "", "refs": "" }
Use type "pickup" for shipper/pick/origin stops, and "delivery" for consignee/drop/destination stops.

Rules:
- stops: List every stop separately. If a document has Stop 1 Pick, Stop 2 Drop, Stop 3 Drop — that is 3 objects. NEVER merge two stops into one object.
- Each stop object must contain only that one location's data. Do not put two addresses or two city names in one field.
- refs: Capture ALL reference numbers near that stop (PO#, PU#, BOL#, AO#, REF#, etc.) as one string.
- broker_order: The broker's load/order/confirmation number.
- rate: Total payment amount, numeric only, no $ sign.
- For dates use YYYY-MM-DD format. For times use HH:MM AM/PM format.
- special_instructions: Any driver notes, requirements, appointments, lumper/dock info.`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const raw = JSON.parse(jsonMatch[0]);

    // Split the stops array into primary pickup/delivery fields + extras
    const stops = Array.isArray(raw.stops) ? raw.stops : [];
    const pickups = stops.filter(s => s.type === 'pickup');
    const deliveries = stops.filter(s => s.type === 'delivery');

    function stopToPickup(s) {
      return {
        pickup_name: s.name || '', pickup_address: s.address || '',
        pickup_city: s.city || '', pickup_state: s.state || '', pickup_zip: s.zip || '',
        pickup_date: s.date || '', pickup_time: s.time || '',
        pickup_phone: s.phone || '', pickup_refs: s.refs || '',
      };
    }
    function stopToDelivery(s) {
      return {
        delivery_name: s.name || '', delivery_address: s.address || '',
        delivery_city: s.city || '', delivery_state: s.state || '', delivery_zip: s.zip || '',
        delivery_date: s.date || '', delivery_time: s.time || '',
        delivery_phone: s.phone || '', delivery_refs: s.refs || '',
      };
    }
    function stopToExtra(s) {
      return { name: s.name || '', address: s.address || '', city: s.city || '',
               state: s.state || '', zip: s.zip || '', date: s.date || '',
               time: s.time || '', phone: s.phone || '', refs: s.refs || '' };
    }

    const data = {
      load_number: raw.load_number || '',
      broker_name: raw.broker_name || '',
      broker_order: raw.broker_order || '',
      broker_contact: raw.broker_contact || '',
      broker_email: raw.broker_email || '',
      commodity: raw.commodity || '',
      weight: raw.weight || '',
      miles: raw.miles || '',
      trailer_type: raw.trailer_type || '',
      bol: raw.bol || '',
      rate: raw.rate || '',
      special_instructions: raw.special_instructions || '',
      driver_name: raw.driver_name || '',
      driver_phone: raw.driver_phone || '',
      tractor_number: raw.tractor_number || '',
      trailer_number: raw.trailer_number || '',
      ...(pickups[0] ? stopToPickup(pickups[0]) : {}),
      extra_pickups: pickups.slice(1).map(stopToExtra),
      ...(deliveries[0] ? stopToDelivery(deliveries[0]) : {}),
      extra_stops: deliveries.slice(1).map(stopToExtra),
      _filename: req.file.originalname,
    };

    // Keep the PDF staged rather than discarding it — the client attaches it
    // to the load it creates as the "Rate Con" document. Anything the user
    // abandons is cleaned up via /api/docs/discard.
    data.staged_filename = req.file.filename;
    data.original_name = req.file.originalname;

    res.json(data);
  } catch (err) {
    console.error('Parse error:', err.message, err.status);
    try { fs.unlinkSync(req.file.path); } catch {}
    const { msg, retryable } = describeParseError(err);
    res.status(retryable ? 503 : 500).json({ error: msg, retryable, detail: err.message });
  }
});

// ── BOL / POD drop box — parse a document and match it to an existing load ────
// Two-step so the file is only uploaded once: /match parses + suggests loads
// (keeping the file staged in UPLOADS_DIR), /attach commits it to a load.

// Normalize a reference for comparison: strip everything but alphanumerics.
function normRef(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Score how well a parsed document matches a load. Reference-number hits are
// worth far more than city/date hits, which are corroborating signals only.
function scoreDocAgainstLoad(doc, load) {
  const reasons = [];
  let score = 0;

  const docRefs = [doc.load_number, doc.bol_number, doc.po_number, doc.pro_number, ...(doc.reference_numbers || [])]
    .map(normRef).filter(r => r.length >= 4);
  const loadRefs = [load.load_number, load.broker_order, load.bol, load.pickup_refs, load.delivery_refs]
    .flatMap(v => String(v || '').split(/[\s,;|]+/))
    .map(normRef).filter(r => r.length >= 4);

  for (const dr of docRefs) {
    if (loadRefs.some(lr => lr === dr)) { score += 60; reasons.push(`reference ${dr} matches`); break; }
  }
  if (score === 0) {
    for (const dr of docRefs) {
      if (loadRefs.some(lr => lr.includes(dr) || dr.includes(lr))) { score += 35; reasons.push(`reference ${dr} partially matches`); break; }
    }
  }

  const city = (v) => String(v || '').toUpperCase().trim();
  if (doc.pickup_city && city(doc.pickup_city) === city(load.pickup_city)) { score += 12; reasons.push('pickup city matches'); }
  if (doc.delivery_city && city(doc.delivery_city) === city(load.delivery_city)) { score += 12; reasons.push('delivery city matches'); }
  if (doc.carrier_name && load.company_name && city(doc.carrier_name).includes(city(load.company_name).split(' ')[0])) {
    score += 5; reasons.push('carrier matches');
  }
  for (const d of [doc.ship_date, doc.delivery_date].filter(Boolean)) {
    if (d === load.pickup_date || d === load.delivery_date) { score += 8; reasons.push(`date ${d} matches`); break; }
  }
  return { score, reasons };
}

app.post('/api/docs/match', auth, requireRole('dispatcher', 'company_owner'), upload.single('file'), async (req, res) => {
  if (req._fileTypeError) return res.status(400).json({ error: req._fileTypeError });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const isPdf = req.file.mimetype === 'application/pdf' ||
                path.extname(req.file.originalname).toLowerCase() === '.pdf';

  try {
    let doc = {};
    if (isPdf) {
      const base64 = fs.readFileSync(req.file.path).toString('base64');
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            {
              type: 'text',
              text: `This is a freight document (bill of lading, proof of delivery, or similar). Extract identifying information so it can be matched to a dispatch record. Return ONLY a valid JSON object in exactly this format:

{
  "doc_type": "",
  "load_number": "",
  "bol_number": "",
  "po_number": "",
  "pro_number": "",
  "reference_numbers": [],
  "carrier_name": "",
  "shipper_name": "",
  "consignee_name": "",
  "pickup_city": "",
  "pickup_state": "",
  "delivery_city": "",
  "delivery_state": "",
  "ship_date": "",
  "delivery_date": "",
  "signed": false
}

Rules:
- doc_type: one of "BOL", "POD", "Lumper", "Scale Ticket", "Invoice", "Other".
- reference_numbers: every other reference/order/pickup number visible, as strings.
- Dates in YYYY-MM-DD format. Use "" for anything not present — never guess.
- signed: true only if the document shows a delivery/receiver signature.`
            }
          ]
        }]
      });
      const text = response.content[0].text.trim();
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('No JSON in response');
      doc = JSON.parse(m[0]);
    }

    // Candidate loads, scoped to what this user may see
    let where = "WHERE l.status NOT IN ('completed')";
    const params = [];
    if (req.user.company_id) { where += ' AND l.company_id = ?'; params.push(req.user.company_id); }
    else if (req.user.allowed_company_ids) {
      const ids = JSON.parse(req.user.allowed_company_ids);
      if (ids.length) { where += ` AND l.company_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
    }
    const loads = db.prepare(`
      SELECT l.*, d.full_name as driver_name, c.name as company_name
      FROM loads l
      LEFT JOIN drivers d ON l.driver_id = d.id
      LEFT JOIN companies c ON l.company_id = c.id
      ${where}
      ORDER BY l.id DESC LIMIT 400
    `).all(...params);

    const candidates = loads
      .map(l => {
        const { score, reasons } = scoreDocAgainstLoad(doc, l);
        return {
          score, reasons,
          load: {
            id: l.id, load_number: l.load_number, broker_order: l.broker_order,
            broker_name: l.broker_name, status: l.status, driver_name: l.driver_name,
            company_name: l.company_name,
            pickup_city: l.pickup_city, pickup_state: l.pickup_state, pickup_date: l.pickup_date,
            delivery_city: l.delivery_city, delivery_state: l.delivery_state, delivery_date: l.delivery_date,
          },
        };
      })
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Auto-confident when the best match is a strong reference hit and clearly
    // ahead of the runner-up — the UI can pre-select it.
    const best = candidates[0];
    const runnerUp = candidates[1];
    const confident = !!best && best.score >= 60 && (!runnerUp || best.score - runnerUp.score >= 25);

    res.json({
      staged_filename: req.file.filename,
      original_name: req.file.originalname,
      parsed: isPdf,
      extracted: doc,
      suggested_doc_type: doc.doc_type || 'BOL',
      candidates,
      confident,
    });
  } catch (err) {
    console.error('Doc match error:', err.message, err.status);
    try { fs.unlinkSync(req.file.path); } catch {}
    const { msg, retryable } = describeParseError(err);
    res.status(retryable ? 503 : 500).json({ error: msg, retryable, detail: err.message });
  }
});

// Commit a staged document to a load.
app.post('/api/docs/attach', auth, requireRole('dispatcher', 'company_owner'), async (req, res) => {
  const { staged_filename, original_name, load_id, doc_type } = req.body;
  if (!staged_filename || !load_id) return res.status(400).json({ error: 'staged_filename and load_id required' });

  // staged_filename must be a bare multer filename inside UPLOADS_DIR
  const safeName = path.basename(String(staged_filename));
  const localPath = path.join(UPLOADS_DIR, safeName);
  if (!localPath.startsWith(path.resolve(UPLOADS_DIR)) || !fs.existsSync(localPath)) {
    return res.status(400).json({ error: 'Staged file not found — re-upload it' });
  }

  const load = db.prepare('SELECT company_id FROM loads WHERE id = ?').get(load_id);
  if (!load) return res.status(404).json({ error: 'Load not found' });
  if (!userCanAccessCompany(req.user, load.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  const type = doc_type || 'BOL';
  const docName = buildDocName(loadRef(load_id), type, original_name || safeName,
    docTypeCount('load_docs', 'load_id', load_id, type));
  const driveId = await storeDocument(localPath, docName, 'application/pdf');
  const r = db.prepare('INSERT INTO load_docs (load_id, doc_type, original_name, filename, uploaded_by, drive_file_id) VALUES (?,?,?,?,?,?)')
    .run(load_id, type, docName, safeName, req.user.id, driveId || null);
  res.json(db.prepare('SELECT * FROM load_docs WHERE id = ?').get(r.lastInsertRowid));
});

// Discard a staged document that the dispatcher chose not to attach.
app.post('/api/docs/discard', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const safeName = path.basename(String(req.body.staged_filename || ''));
  const localPath = path.join(UPLOADS_DIR, safeName);
  if (safeName && localPath.startsWith(path.resolve(UPLOADS_DIR))) {
    try { fs.unlinkSync(localPath); } catch {}
  }
  res.json({ ok: true });
});

// ── Stats for dashboard ───────────────────────────────────────────────────────
// ── Rich dashboard stats ──────────────────────────────────────────────────────
app.get('/api/dashboard-stats', auth, (req, res) => {
  const isOwner = req.user.role === 'company_owner';
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  const canRevenue = isOwner || isAdmin || req.user.can_see_revenue;

  // Build company filter — supports single company_id, multi allowed_company_ids, or none (admin sees all)
  let cWhere = '';
  let cParams = [];
  if (isOwner) {
    cWhere = 'AND l.company_id = ?';
    cParams = [req.user.company_id];
  } else if (req.user.allowed_company_ids) {
    const ids = JSON.parse(req.user.allowed_company_ids);
    if (ids.length > 0) {
      cWhere = `AND l.company_id IN (${ids.map(() => '?').join(',')})`;
      cParams = ids;
    }
  } else if (req.user.company_id) {
    cWhere = 'AND l.company_id = ?';
    cParams = [req.user.company_id];
  }

  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  function monthRow(mo) {
    return db.prepare(`
      SELECT COUNT(*) as loads,
             SUM(CAST(rate AS REAL)) as revenue,
             SUM(CAST(miles AS REAL)) as miles
      FROM loads l
      WHERE status IN ('delivered','completed')
        AND strftime('%Y-%m', delivery_date) = ?
        ${cWhere}
    `).get(mo, ...cParams);
  }

  const tm = monthRow(thisMonth);
  const lm = monthRow(lastMonth);

  // Last 8 weeks revenue — group by ISO week
  const weekRows = db.prepare(`
    SELECT strftime('%Y-W%W', delivery_date) as week,
           COUNT(*) as loads,
           SUM(CAST(rate AS REAL)) as revenue,
           SUM(CAST(miles AS REAL)) as miles
    FROM loads l
    WHERE status IN ('delivered','completed')
      AND delivery_date >= date('now', '-56 days')
      ${cWhere}
    GROUP BY week ORDER BY week
  `).all(...cParams);

  // Loads picking up in next 7 days
  const upcoming = db.prepare(`
    SELECT l.id, l.load_number, l.broker_order, l.pickup_date, l.pickup_city, l.pickup_state,
           l.delivery_city, l.delivery_state, l.status, d.full_name as driver_name
    FROM loads l
    LEFT JOIN drivers d ON l.driver_id = d.id
    WHERE l.pickup_date BETWEEN date('now') AND date('now', '+7 days')
      AND l.status NOT IN ('delivered','completed')
      ${cWhere}
    ORDER BY l.pickup_date, l.pickup_time
    LIMIT 20
  `).all(...cParams);

  // To-do: needs assignment (no driver, pickup in next 14d)
  const needsDriver = db.prepare(`
    SELECT COUNT(*) as n FROM loads l
    WHERE l.driver_id IS NULL
      AND l.status IN ('open','covered')
      AND l.pickup_date <= date('now', '+14 days')
      ${cWhere}
  `).get(...cParams).n;

  // To-do: ready to invoice
  const toInvoice = db.prepare(`
    SELECT COUNT(*) as n, SUM(CAST(rate AS REAL)) as total
    FROM loads l WHERE l.status = 'delivered' ${cWhere}
  `).get(...cParams);

  res.json({
    canRevenue,
    thisMonth: { ...tm, month: thisMonth },
    lastMonth: { ...lm, month: lastMonth },
    weeklyTrend: weekRows,
    upcoming,
    needsDriver,
    toInvoice: { count: toInvoice.n, total: toInvoice.total || 0 },
  });
});

// Revenue attributed to each driver or truck, bucketed by week or month.
// Same revenue rule as the dashboard: realized on delivered/completed loads,
// dated by delivery_date. Gated by the can_see_revenue permission.
app.get('/api/revenue-streams', auth, (req, res) => {
  const isOwner = req.user.role === 'company_owner';
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  const canRevenue = isOwner || isAdmin || req.user.can_see_revenue;
  if (!canRevenue) return res.status(403).json({ error: 'Not authorized to view revenue' });

  const by = req.query.by === 'truck' ? 'truck' : 'driver';
  const period = req.query.period === 'month' ? 'month' : 'week';

  // Company scope — mirrors dashboard-stats.
  let cWhere = '';
  let cParams = [];
  if (isOwner) {
    cWhere = 'AND l.company_id = ?';
    cParams = [req.user.company_id];
  } else if (req.user.allowed_company_ids) {
    const ids = JSON.parse(req.user.allowed_company_ids);
    if (ids.length > 0) {
      cWhere = `AND l.company_id IN (${ids.map(() => '?').join(',')})`;
      cParams = ids;
    }
  } else if (req.user.company_id) {
    cWhere = 'AND l.company_id = ?';
    cParams = [req.user.company_id];
  }

  const periodFmt = period === 'month' ? '%Y-%m' : '%Y-W%W';
  const sinceDays = period === 'month' ? 400 : 35; // ~13 months / ~5 weeks (≈ one month)

  // Credit the driver who was LOADED, not whoever finishes the drop. change-driver
  // preserves the first-assigned driver in original_driver_id, so a load handed to a
  // local drop driver (e.g. Hrang) still counts for the hauler — no clashing credit.
  const groupCol = by === 'truck' ? 'l.truck_id' : 'COALESCE(l.original_driver_id, l.driver_id)';

  // Revenue is recorded once a load is loaded/underway (not only on delivery), dated
  // by the pickup day — the moment the driver was loaded.
  const REV_STATUSES = "'loading','on_route','unloading','in_yard','delivered','completed'";

  // Optional carrier filter, so revenue can be viewed per company.
  let compWhere = '';
  const compParams = [];
  if (req.query.company_id) { compWhere = 'AND l.company_id = ?'; compParams.push(Number(req.query.company_id)); }

  const grouped = db.prepare(`
    SELECT ${groupCol} AS gid,
           strftime('${periodFmt}', l.pickup_date) AS period,
           COUNT(*) AS loads,
           SUM(CAST(l.rate AS REAL)) AS revenue
    FROM loads l
    WHERE l.status IN (${REV_STATUSES})
      AND ${groupCol} IS NOT NULL
      AND l.pickup_date IS NOT NULL AND l.pickup_date != ''
      AND l.pickup_date >= date('now', '-${sinceDays} days')
      ${cWhere} ${compWhere}
    GROUP BY gid, period
  `).all(...cParams, ...compParams);

  // Entity display names (with home carrier as the sub-label)
  const names = {};
  if (by === 'truck') {
    for (const t of db.prepare('SELECT t.id, t.tractor_number, t.trailer_number, c.name AS company_name FROM trucks t LEFT JOIN companies c ON t.company_id = c.id').all())
      names[t.id] = { name: t.tractor_number || `Truck #${t.id}`, sub: t.company_name || t.trailer_number || '' };
  } else {
    for (const d of db.prepare('SELECT d.id, d.full_name, c.name AS company_name FROM drivers d LEFT JOIN companies c ON d.company_id = c.id').all())
      names[d.id] = { name: d.full_name || `Driver #${d.id}`, sub: d.company_name || '' };
  }

  // Carriers that have revenue in range, for the company filter.
  const companies = db.prepare(`
    SELECT DISTINCT c.id, c.name
    FROM loads l JOIN companies c ON l.company_id = c.id
    WHERE l.status IN (${REV_STATUSES})
      AND l.pickup_date >= date('now', '-${sinceDays} days')
      ${cWhere}
    ORDER BY c.name
  `).all(...cParams);

  // Which carrier each entity actually ran under (loads.company_id), so the row's
  // company reflects the revenue source rather than the driver's home company.
  const carrierAgg = db.prepare(`
    SELECT ${groupCol} AS gid, c.name AS company_name, SUM(CAST(l.rate AS REAL)) AS rev
    FROM loads l LEFT JOIN companies c ON l.company_id = c.id
    WHERE l.status IN (${REV_STATUSES})
      AND ${groupCol} IS NOT NULL
      AND l.pickup_date >= date('now', '-${sinceDays} days')
      ${cWhere} ${compWhere}
    GROUP BY gid, l.company_id
  `).all(...cParams, ...compParams);
  const carrierByGid = {};
  for (const r of carrierAgg) {
    const g = (carrierByGid[r.gid] ||= { best: '', bestRev: -1, n: 0 });
    g.n++;
    if ((r.rev || 0) > g.bestRev) { g.bestRev = r.rev || 0; g.best = r.company_name || ''; }
  }
  const carrierLabel = (gid) => {
    const g = carrierByGid[gid];
    if (!g) return '';
    return g.best + (g.n > 1 ? ` +${g.n - 1}` : '');
  };

  // Assemble: distinct period axis (newest last) + per-entity cells.
  const periodSet = new Set();
  const entities = new Map(); // gid -> { id, name, sub, total, loadsTotal, cells }
  for (const r of grouped) {
    if (!r.period) continue;
    periodSet.add(r.period);
    let e = entities.get(r.gid);
    if (!e) {
      const meta = names[r.gid] || { name: `#${r.gid}`, sub: '' };
      e = { id: r.gid, name: meta.name, sub: carrierLabel(r.gid) || meta.sub, total: 0, loadsTotal: 0, cells: {} };
      entities.set(r.gid, e);
    }
    const rev = r.revenue || 0;
    e.cells[r.period] = { revenue: rev, loads: r.loads };
    e.total += rev;
    e.loadsTotal += r.loads;
  }

  const periods = [...periodSet].sort();
  const rows = [...entities.values()].sort((a, b) => b.total - a.total);
  res.json({ canRevenue, by, period, periods, rows, companies });
});

app.get('/api/stats', auth, (req, res) => {
  // Same company column name across all three tables, so one clause serves all.
  const scope = companyScopeClause(req.user, 'company_id', 'WHERE');
  const loads = db.prepare(`SELECT status, COUNT(*) as count FROM loads ${scope.clause} GROUP BY status`).all(...scope.params);
  const drivers = db.prepare(`SELECT status, COUNT(*) as count FROM drivers ${scope.clause} GROUP BY status`).all(...scope.params);
  const trucks = db.prepare(`SELECT status, COUNT(*) as count FROM trucks ${scope.clause} GROUP BY status`).all(...scope.params);
  res.json({ loads, drivers, trucks });
});

// ── Search loads ─────────────────────────────────────────────────────────────
app.get('/api/search', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const scope = companyScopeClause(req.user, 'l.company_id', 'AND');
  const companyClause = scope.clause;
  const companyParam = scope.params;

  const rows = db.prepare(`
    SELECT l.id, l.load_number, l.broker_name, l.pickup_city, l.pickup_state,
           l.delivery_city, l.delivery_state, l.pickup_date, l.status, l.rate,
           d.full_name as driver_name, c.name as company_name
    FROM loads l
    LEFT JOIN drivers d ON l.driver_id = d.id
    LEFT JOIN companies c ON l.company_id = c.id
    WHERE (
      l.load_number LIKE ?
      OR l.broker_name LIKE ?
      OR l.pickup_city LIKE ?
      OR l.delivery_city LIKE ?
      OR l.pickup_refs LIKE ?
      OR l.delivery_refs LIKE ?
    )
    ${companyClause}
    ORDER BY l.id DESC
    LIMIT 100
  `).all(like, like, like, like, like, like, ...companyParam);
  res.json(rows);
});

// ── Payroll (daily miles, weekly view) ───────────────────────────────────────

// GET /api/payroll/week?start=YYYY-MM-DD  (start = Monday of the week)
app.get('/api/payroll/week', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { start } = req.query;
  if (!start) return res.status(400).json({ error: 'start date required' });

  // Build date range Mon–Sun
  const weekDates = [];
  const mon = new Date(start + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const scope = companyScopeClause(req.user, 'd.company_id', 'AND');
  const drivers = db.prepare(`SELECT d.id, d.full_name, d.rate_per_mile, d.company_id, c.name as company_name
      FROM drivers d LEFT JOIN companies c ON d.company_id = c.id
      WHERE d.is_active = 1 ${scope.clause}
      ORDER BY c.name, d.full_name`).all(...scope.params);

  // No drivers in scope → return an empty week (avoids an invalid `IN ()` query).
  if (drivers.length === 0) return res.json({ week_start: start, dates: weekDates, drivers: [] });

  const placeholders = weekDates.map(() => '?').join(',');
  const entries = db.prepare(
    `SELECT * FROM payroll_entries WHERE driver_id IN (${drivers.map(() => '?').join(',')}) AND entry_date IN (${placeholders})`
  ).all(...drivers.map(d => d.id), ...weekDates);

  const entryMap = {};
  for (const e of entries) {
    if (!entryMap[e.driver_id]) entryMap[e.driver_id] = {};
    entryMap[e.driver_id][e.entry_date] = e;
  }

  const result = drivers.map(d => ({
    ...d,
    days: weekDates.map(date => entryMap[d.id]?.[date] || null),
    total_miles: weekDates.reduce((sum, date) => sum + (entryMap[d.id]?.[date]?.miles || 0), 0),
  }));

  res.json({ week_start: start, dates: weekDates, drivers: result });
});

// PUT /api/payroll/entry — upsert a single day's miles for a driver
app.put('/api/payroll/entry', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { driver_id, entry_date, miles, notes } = req.body;
  if (!driver_id || !entry_date) return res.status(400).json({ error: 'driver_id and entry_date required' });

  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  // company_owner can only edit their own drivers
  if (!userCanAccessCompany(req.user, driver.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  const m = Number(miles) || 0;
  db.prepare(`
    INSERT INTO payroll_entries (driver_id, company_id, entry_date, miles, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(driver_id, entry_date) DO UPDATE SET
      miles=excluded.miles, notes=excluded.notes, updated_at=datetime('now')
  `).run(driver_id, driver.company_id, entry_date, m, notes || null);

  res.json({ ok: true });
});

// DELETE /api/payroll/entry?driver_id=X&date=YYYY-MM-DD
app.delete('/api/payroll/entry', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { driver_id, date } = req.query;
  const driver = db.prepare('SELECT company_id FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (!userCanAccessCompany(req.user, driver.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM payroll_entries WHERE driver_id=? AND entry_date=?').run(driver_id, date);
  res.json({ ok: true });
});

// PUT /api/drivers/:id/toggle-active — disable or enable a driver
app.put('/api/drivers/:id/toggle-active', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (!userCanAccessCompany(req.user, driver.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  const newActive = driver.is_active === 0 ? 1 : 0;
  db.prepare('UPDATE drivers SET is_active=? WHERE id=?').run(newActive, req.params.id);
  res.json({ ok: true, is_active: newActive });
});

// PUT /api/drivers/:id/login — reset password for an existing driver login
app.put('/api/drivers/:id/login', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });

  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (!driver.user_id) return res.status(400).json({ error: 'Driver has no login yet' });

  if (!userCanAccessCompany(req.user, driver.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, driver.user_id);
  res.json({ ok: true });
});

// POST /api/drivers/:id/login — create a portal login for an existing driver
app.post('/api/drivers/:id/login', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (driver.user_id) return res.status(400).json({ error: 'Driver already has a login' });

  if (!userCanAccessCompany(req.user, driver.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const ur = db.prepare('INSERT INTO users (username,password,role,company_id,full_name,phone,email) VALUES (?,?,?,?,?,?,?)')
      .run(username, hash, 'driver', driver.company_id, driver.full_name, driver.phone, driver.email);
    db.prepare('UPDATE drivers SET user_id = ? WHERE id = ?').run(ur.lastInsertRowid, driver.id);
    res.json({ ok: true, user_id: ur.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Username already taken' });
  }
});

// PUT /api/drivers/:id/rate — update driver's default rate per mile
app.put('/api/drivers/:id/rate', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const rate = Number(req.body.rate_per_mile);
  if (isNaN(rate) || rate < 0) return res.status(400).json({ error: 'Invalid rate' });
  db.prepare('UPDATE drivers SET rate_per_mile=? WHERE id=?').run(rate, req.params.id);
  res.json({ ok: true, rate_per_mile: rate });
});

// Notes-only update — used by the inline notes cell on the driver list so a
// quick note can't clobber the rest of the driver record (the full PUT above
// replaces every column).
app.put('/api/drivers/:id/notes', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const notes = typeof req.body.notes === 'string' ? req.body.notes.slice(0, 2000) : '';
  const driver = db.prepare('SELECT company_id FROM drivers WHERE id = ?').get(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (!userCanAccessCompany(req.user, driver.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE drivers SET notes=? WHERE id=?').run(notes, req.params.id);
  res.json({ ok: true, notes });
});

// ── Lane recommendations ──────────────────────────────────────────────────────
app.get('/api/recommendations', auth, (req, res) => {
  // The activeDestinations query is unaliased (FROM loads), so scope the bare column.
  const scope = companyScopeClause(req.user, 'company_id', 'AND');
  const companyClause = scope.clause;
  const companyParam = scope.params;

  // Active delivery destinations — where trucks are heading right now
  const activeDestinations = db.prepare(`
    SELECT DISTINCT delivery_state, delivery_city, COUNT(*) as trucks_delivering
    FROM loads
    WHERE status IN ('dispatched','loading','on_route','unloading','in_yard')
    AND delivery_state IS NOT NULL AND delivery_state != ''
    ${companyClause}
    GROUP BY delivery_state
    ORDER BY trucks_delivering DESC
  `).all(...companyParam);

  const results = [];

  for (const dest of activeDestinations) {
    const fromState = dest.delivery_state;

    // Top outbound lanes from this state in history (delivered OR completed)
    const lanes = db.prepare(`
      SELECT
        pickup_state, pickup_city,
        delivery_state, delivery_city,
        COUNT(*) as load_count,
        ROUND(AVG(CASE WHEN rate IS NOT NULL AND CAST(rate AS REAL) > 0 THEN CAST(rate AS REAL) END), 0) as avg_rate,
        MIN(CAST(rate AS REAL)) as min_rate,
        MAX(CAST(rate AS REAL)) as max_rate
      FROM loads
      WHERE status IN ('delivered','completed')
      AND pickup_state = ?
      AND delivery_state != ?
      AND broker_name IS NOT NULL AND broker_name != ''
      GROUP BY pickup_state, delivery_state
      HAVING load_count >= 1
      ORDER BY load_count DESC
      LIMIT 8
    `).all(fromState, fromState);

    for (const lane of lanes) {
      // Top brokers for this specific lane
      const brokers = db.prepare(`
        SELECT
          broker_name,
          COUNT(*) as times_used,
          broker_contact,
          broker_email,
          ROUND(AVG(CASE WHEN rate IS NOT NULL AND CAST(rate AS REAL) > 0 THEN CAST(rate AS REAL) END), 0) as avg_rate
        FROM loads
        WHERE status IN ('delivered','completed')
        AND pickup_state = ?
        AND delivery_state = ?
        AND broker_name IS NOT NULL AND broker_name != ''
        GROUP BY broker_name
        ORDER BY times_used DESC
        LIMIT 5
      `).all(fromState, lane.delivery_state);

      lane.brokers = brokers;
    }

    if (lanes.length > 0) {
      results.push({
        delivery_state: dest.delivery_state,
        delivery_city: dest.delivery_city,
        trucks_delivering: dest.trucks_delivering,
        outbound_lanes: lanes,
      });
    }
  }

  res.json(results);
});

// ── Active users (admin only) ─────────────────────────────────────────────────
app.get('/api/active-users', auth, (req, res) => {
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.last_seen_at, c.name as company_name
    FROM users u
    LEFT JOIN companies c ON u.company_id = c.id
    WHERE u.role IN ('dispatcher','company_owner')
      AND u.last_seen_at >= ?
    ORDER BY u.last_seen_at DESC
  `).all(cutoff);
  res.json(users);
});

// ── Audit log (admin only) ───────────────────────────────────────────────────
// Where/how the portal is being operated (logins + locations) and a permanent
// record of destructive actions (load deletions). Admin-only oversight.
app.get('/api/audit-log', auth, requireAdmin, (req, res) => {
  const action = req.query.action;                       // optional filter
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const where = action ? 'WHERE action = ?' : '';
  const rows = db.prepare(
    `SELECT id, ts, user_id, user_name, role, company_id, action, detail, ip, user_agent, device_id, city, country
     FROM audit_log ${where} ORDER BY ts DESC, id DESC LIMIT ?`
  ).all(...(action ? [action, limit] : [limit]));
  res.json(rows);
});

// ── Driver change ────────────────────────────────────────────────────────────
app.put('/api/loads/:id/change-driver', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { driver_id } = req.body;
  if (!driver_id) return res.status(400).json({ error: 'driver_id required' });

  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, load.company_id))
    return res.status(403).json({ error: 'Forbidden' });

  const newDriver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver_id);
  if (!newDriver) return res.status(404).json({ error: 'Driver not found' });
  // The assigned driver must belong to the same company as the load.
  if (newDriver.company_id !== load.company_id)
    return res.status(403).json({ error: "Driver must belong to the load's company" });

  // Store original driver the first time a swap happens
  const originalId = load.original_driver_id || load.driver_id;

  db.prepare('UPDATE loads SET driver_id=?, original_driver_id=?, status=? WHERE id=?')
    .run(driver_id, originalId || null, load.status === 'open' ? 'covered' : load.status, req.params.id);

  if (load.driver_id !== driver_id) {
    const prev = load.driver_id ? db.prepare('SELECT full_name FROM drivers WHERE id = ?').get(load.driver_id) : null;
    logActivity(req.params.id, req, 'driver_changed',
      prev ? `Driver: ${prev.full_name} → ${newDriver.full_name}` : `Driver assigned: ${newDriver.full_name}`);
  }

  // After the swap: the previous driver may still have other work.
  syncDriverStatus(load.driver_id);
  syncDriverStatus(driver_id);

  const updated = db.prepare(`
    SELECT l.*, d.full_name as driver_name, d.phone as driver_phone,
      od.full_name as original_driver_name, od.phone as original_driver_phone,
      t.tractor_number, c.name as company_name
    FROM loads l
    LEFT JOIN drivers d ON l.driver_id = d.id
    LEFT JOIN drivers od ON l.original_driver_id = od.id
    LEFT JOIN trucks t ON l.truck_id = t.id
    LEFT JOIN companies c ON l.company_id = c.id
    WHERE l.id = ?
  `).get(req.params.id);

  res.json(updated);
});

// ── Trailer number + check-in / check-out ────────────────────────────────────
app.put('/api/loads/:id/trailer', auth, (req, res) => {
  const { trailer_number } = req.body;
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('UPDATE loads SET trailer_number = ? WHERE id = ?').run(trailer_number || null, req.params.id);
  logActivity(load.id, req, 'trailer', trailer_number ? `Trailer set to ${trailer_number}` : 'Trailer cleared');
  res.json({ ok: true });
});

app.put('/api/loads/:id/checkin', auth, (req, res) => {
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const time = req.body.time || new Date().toISOString();
  db.prepare('UPDATE loads SET checkin_time = ? WHERE id = ?').run(time, req.params.id);
  logActivity(load.id, req, 'checkin', 'Checked in at pickup');
  res.json({ ok: true, checkin_time: time });
});

app.put('/api/loads/:id/checkout', auth, (req, res) => {
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const time = req.body.time || new Date().toISOString();
  db.prepare('UPDATE loads SET checkout_time = ? WHERE id = ?').run(time, req.params.id);
  logActivity(load.id, req, 'checkout', 'Checked out from delivery');
  res.json({ ok: true, checkout_time: time });
});

// ── Load documents ───────────────────────────────────────────────────────────
app.get('/api/loads/:id/docs', auth, (req, res) => {
  const load = db.prepare('SELECT company_id, driver_id FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(db.prepare('SELECT * FROM load_docs WHERE load_id = ? ORDER BY uploaded_at DESC').all(req.params.id));
});

// Activity trail for a load — created, edited, status changes, dispatch, driver swaps.
app.get('/api/loads/:id/activity', auth, (req, res) => {
  const load = db.prepare('SELECT company_id, driver_id FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(db.prepare('SELECT id, action, detail, user_name, created_at FROM load_activity WHERE load_id = ? ORDER BY created_at DESC, id DESC').all(req.params.id));
});

app.post('/api/loads/:id/docs', auth, upload.single('file'), async (req, res) => {
  if (req._fileTypeError) return res.status(400).json({ error: req._fileTypeError });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const load = db.prepare('SELECT company_id, driver_id FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, load.company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { doc_type } = req.body;
  const type = doc_type || 'Other';
  const localPath = path.join(UPLOADS_DIR, req.file.filename);
  const docName = buildDocName(loadRef(req.params.id), type, req.file.originalname,
    docTypeCount('load_docs', 'load_id', req.params.id, type));
  const driveId = await storeDocument(localPath, docName, req.file.mimetype);
  const r = db.prepare('INSERT INTO load_docs (load_id, doc_type, original_name, filename, uploaded_by, drive_file_id) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, type, docName, req.file.filename, req.user.id, driveId || null);
  logActivity(req.params.id, req, 'document', `Uploaded ${type} document`);
  res.json(db.prepare('SELECT * FROM load_docs WHERE id = ?').get(r.lastInsertRowid));
});

app.get('/api/docs/:id/download', auth, async (req, res) => {
  const doc = db.prepare(`
    SELECT ld.*, l.company_id as load_company_id, l.driver_id as load_driver_id
    FROM load_docs ld JOIN loads l ON ld.load_id = l.id WHERE ld.id = ?
  `).get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || doc.load_driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!userCanAccessCompany(req.user, doc.load_company_id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
  if (doc.drive_file_id) {
    const ok = await drive.download(doc.drive_file_id, res);
    if (ok) return res.end();
    // Drive is where this document lives; only older files still have a local copy.
  }
  const filePath = path.join(UPLOADS_DIR, doc.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(doc.drive_file_id ? 503 : 404).json({
      error: doc.drive_file_id
        ? 'Could not reach Google Drive for this document — try again shortly.'
        : 'File not found',
    });
  }
  res.download(filePath, doc.original_name);
});

app.delete('/api/docs/:id', auth, requireRole('dispatcher', 'company_owner'), async (req, res) => {
  const doc = db.prepare(`
    SELECT ld.*, l.company_id as load_company_id
    FROM load_docs ld JOIN loads l ON ld.load_id = l.id WHERE ld.id = ?
  `).get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, doc.load_company_id))
    return res.status(403).json({ error: 'Forbidden' });
  if (doc.drive_file_id) await drive.remove(doc.drive_file_id);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, doc.filename)); } catch {}
  db.prepare('DELETE FROM load_docs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Truck documents ──────────────────────────────────────────────────────────
app.get('/api/trucks/:id/docs', auth, (req, res) => {
  const truck = db.prepare('SELECT company_id FROM trucks WHERE id = ?').get(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  if (!userCanAccessCompany(req.user, truck.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  res.json(db.prepare('SELECT * FROM truck_docs WHERE truck_id = ? ORDER BY uploaded_at DESC').all(req.params.id));
});

app.post('/api/trucks/:id/docs', auth, requireRole('dispatcher', 'company_owner'), upload.single('file'), async (req, res) => {
  if (req._fileTypeError) return res.status(400).json({ error: req._fileTypeError });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const truck = db.prepare('SELECT * FROM trucks WHERE id = ?').get(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  if (!userCanAccessCompany(req.user, truck.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  const { doc_type } = req.body;
  const type = doc_type || 'Other';
  const localPath = path.join(UPLOADS_DIR, req.file.filename);
  const truckRef = truck.tractor_number ? `Truck ${truck.tractor_number}` : `Truck ${truck.id}`;
  const docName = buildDocName(truckRef, type, req.file.originalname,
    docTypeCount('truck_docs', 'truck_id', req.params.id, type));
  const driveId = await storeDocument(localPath, docName, req.file.mimetype);
  const r = db.prepare('INSERT INTO truck_docs (truck_id, doc_type, original_name, filename, uploaded_by, drive_file_id) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, type, docName, req.file.filename, req.user.id, driveId || null);
  res.json(db.prepare('SELECT * FROM truck_docs WHERE id = ?').get(r.lastInsertRowid));
});

app.get('/api/truck-docs/:id/download', auth, async (req, res) => {
  const doc = db.prepare(`
    SELECT td.*, t.company_id as truck_company_id
    FROM truck_docs td JOIN trucks t ON td.truck_id = t.id WHERE td.id = ?
  `).get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, doc.truck_company_id))
    return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
  if (doc.drive_file_id) {
    const ok = await drive.download(doc.drive_file_id, res);
    if (ok) return res.end();
  }
  const filePath = path.join(UPLOADS_DIR, doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.download(filePath, doc.original_name);
});

app.delete('/api/truck-docs/:id', auth, requireRole('dispatcher', 'company_owner'), async (req, res) => {
  const doc = db.prepare(`
    SELECT td.*, t.company_id as truck_company_id
    FROM truck_docs td JOIN trucks t ON td.truck_id = t.id WHERE td.id = ?
  `).get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, doc.truck_company_id))
    return res.status(403).json({ error: 'Forbidden' });
  if (doc.drive_file_id) await drive.remove(doc.drive_file_id);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, doc.filename)); } catch {}
  db.prepare('DELETE FROM truck_docs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Detention tracking ───────────────────────────────────────────────────────
app.put('/api/loads/:id/detention', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { detention_start, detention_end, detention_rate } = req.body;
  const rate = Number(detention_rate ?? 65);
  if (isNaN(rate) || rate < 0 || rate > 9999)
    return res.status(400).json({ error: 'detention_rate must be between 0 and 9999' });
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (!userCanAccessCompany(req.user, load.company_id)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE loads SET detention_start=?, detention_end=?, detention_rate=? WHERE id=?')
    .run(detention_start || null, detention_end || null, rate, req.params.id);
  logActivity(load.id, req, 'detention', `Detention updated @ $${rate}/hr`);
  res.json({ ok: true });
});

// ── Compliance data ──────────────────────────────────────────────────────────
app.get('/api/compliance', auth, (req, res) => {
  const dScope = companyScopeClause(req.user, 'd.company_id', 'WHERE');
  const tScope = companyScopeClause(req.user, 't.company_id', 'WHERE');

  const drivers = db.prepare(`
    SELECT d.id, d.full_name, d.cdl_class, d.license_state,
           d.license_number, d.license_expiry, d.medical_card_expiry,
           d.drug_test_date, d.drug_test_expiry, d.is_active,
           c.name as company_name
    FROM drivers d LEFT JOIN companies c ON d.company_id = c.id
    ${dScope.clause}
    ORDER BY d.full_name
  `).all(...dScope.params);

  const trucks = db.prepare(`
    SELECT t.id, t.tractor_number, t.trailer_number, t.plate,
           t.registration_expiry, t.insurance_expiry,
           c.name as company_name
    FROM trucks t LEFT JOIN companies c ON t.company_id = c.id
    ${tScope.clause}
    ORDER BY t.tractor_number
  `).all(...tScope.params);

  res.json({ drivers, trucks });
});

// ── Maintenance records ──────────────────────────────────────────────────────
app.get('/api/maintenance', auth, (req, res) => {
  const scope = companyScopeClause(req.user, 'm.company_id', 'WHERE');
  let clause = scope.clause;
  const params = [...scope.params];
  if (req.query.truck_id) {
    clause = clause ? `${clause} AND m.truck_id = ?` : 'WHERE m.truck_id = ?';
    params.push(req.query.truck_id);
  }
  const rows = db.prepare(`
    SELECT m.*, t.tractor_number, t.trailer_number as truck_trailer
    FROM maintenance_records m
    LEFT JOIN trucks t ON m.truck_id = t.id
    ${clause}
    ORDER BY m.service_date DESC
  `).all(...params);
  res.json(rows);
});

app.post('/api/maintenance', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { truck_id, service_type, service_date, mileage, notes, next_due_date, next_due_mileage } = req.body;
  if (!truck_id || !service_type || !service_date) return res.status(400).json({ error: 'truck_id, service_type, service_date required' });
  const truck = db.prepare('SELECT * FROM trucks WHERE id = ?').get(truck_id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  if (!userCanAccessCompany(req.user, truck.company_id))
    return res.status(403).json({ error: 'Forbidden' });
  const cid = truck.company_id;
  const r = db.prepare('INSERT INTO maintenance_records (truck_id,service_type,service_date,mileage,notes,next_due_date,next_due_mileage,company_id,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(truck_id, service_type, service_date, mileage||null, notes||null, next_due_date||null, next_due_mileage||null, cid, req.user.id);
  res.json(db.prepare('SELECT m.*, t.tractor_number FROM maintenance_records m LEFT JOIN trucks t ON m.truck_id = t.id WHERE m.id = ?').get(r.lastInsertRowid));
});

app.delete('/api/maintenance/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  db.prepare('DELETE FROM maintenance_records WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Serve frontend ────────────────────────────────────────────────────────────
// Assets (hashed filenames) get long-lived cache; index.html never cached
app.use(express.static(path.join(__dirname, 'frontend/dist'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.get('/{*path}', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

// ── Global error handler (catches multer errors before Express default 500) ───
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large. Maximum size is 20 MB.' : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Dispatch Portal running on http://localhost:${PORT}`));
