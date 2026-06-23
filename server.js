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
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  console.log(`[login] user=${user.id} role=${user.role} ip=${req.ip} at=${new Date().toISOString()}`);
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
  res.json(db.prepare('SELECT * FROM companies ORDER BY name').all());
});

app.post('/api/companies', auth, requireRole('dispatcher'), (req, res) => {
  const { name, mc_number, dot_number, address, phone, email } = req.body;
  const r = db.prepare('INSERT INTO companies (name,mc_number,dot_number,address,phone,email) VALUES (?,?,?,?,?,?)').run(name, mc_number, dot_number, address, phone, email);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/companies/:id', auth, requireRole('dispatcher'), (req, res) => {
  const { name, mc_number, dot_number, address, phone, email } = req.body;
  db.prepare('UPDATE companies SET name=?,mc_number=?,dot_number=?,address=?,phone=?,email=? WHERE id=?').run(name, mc_number, dot_number, address, phone, email, req.params.id);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id));
});

// ── Users (for company owners and drivers) ───────────────────────────────────
app.get('/api/users', auth, requireRole('dispatcher'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.company_id, u.full_name, u.email, u.phone,
           u.can_see_revenue, u.last_seen_at, u.allowed_company_ids, c.name as company_name
    FROM users u LEFT JOIN companies c ON u.company_id = c.id
    WHERE u.role != 'driver'
    ORDER BY c.name, u.full_name
  `).all();
  res.json(users);
});

app.post('/api/users', auth, requireRole('dispatcher'), (req, res) => {
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
  const { full_name, email, phone, can_see_revenue, password, company_id, role, allowed_company_ids } = req.body;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
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
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Drivers ──────────────────────────────────────────────────────────────────
app.get('/api/drivers', auth, (req, res) => {
  let query = 'SELECT d.*, c.name as company_name FROM drivers d LEFT JOIN companies c ON d.company_id = c.id';
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
    SELECT d.id, d.full_name, d.phone, d.status, d.is_active, d.company_id,
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
  const cid = req.user.role === 'company_owner' ? req.user.company_id : company_id;

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
  const cid = req.user.role === 'company_owner' ? req.user.company_id : (req.body.company_id || null);
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
  if (!Array.isArray(driver_ids) || !company_id) return res.status(400).json({ error: 'driver_ids and company_id required' });
  const update = db.prepare('UPDATE drivers SET company_id=? WHERE id=?');
  const tx = db.transaction(() => driver_ids.forEach(id => update.run(company_id, id)));
  tx();
  res.json({ updated: driver_ids.length });
});

app.delete('/api/drivers/:id', auth, requireRole('dispatcher'), (req, res) => {
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
  const cid = req.user.role === 'company_owner' ? req.user.company_id : company_id;
  const r = db.prepare('INSERT INTO trucks (company_id,tractor_number,trailer_number,trailer_type,vin,plate,registration_expiry,insurance_expiry,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(cid, tractor_number, trailer_number, trailer_type, vin, plate, registration_expiry, insurance_expiry, notes);
  res.json(db.prepare('SELECT t.*, c.name as company_name FROM trucks t LEFT JOIN companies c ON t.company_id = c.id WHERE t.id = ?').get(r.lastInsertRowid));
});

app.put('/api/trucks/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { tractor_number, trailer_number, trailer_type, vin, plate, registration_expiry, insurance_expiry, notes, status } = req.body;
  db.prepare('UPDATE trucks SET tractor_number=?,trailer_number=?,trailer_type=?,vin=?,plate=?,registration_expiry=?,insurance_expiry=?,notes=?,status=? WHERE id=?').run(tractor_number, trailer_number, trailer_type, vin, plate, registration_expiry, insurance_expiry, notes, status, req.params.id);
  res.json(db.prepare('SELECT t.*, c.name as company_name FROM trucks t LEFT JOIN companies c ON t.company_id = c.id WHERE t.id = ?').get(req.params.id));
});

app.delete('/api/trucks/:id', auth, requireRole('dispatcher'), (req, res) => {
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
  if (req.user.company_id && load.company_id !== req.user.company_id)
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
  // company_owner → their company; scoped dispatcher (has company_id) → their company; admin dispatcher → body value
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  const cid = req.user.role === 'company_owner' ? req.user.company_id
            : isAdmin ? req.body.company_id
            : req.user.company_id;
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

  if (driver_id) {
    db.prepare("UPDATE drivers SET status='on_load' WHERE id=?").run(driver_id);
  }
  if (truck_id) {
    db.prepare("UPDATE trucks SET status = 'on_load' WHERE id = ?").run(truck_id);
  }

  res.json(db.prepare('SELECT l.*, d.full_name as driver_name, t.tractor_number, t.trailer_number as truck_trailer, c.name as company_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id LEFT JOIN trucks t ON l.truck_id = t.id LEFT JOIN companies c ON l.company_id = c.id WHERE l.id = ?').get(r.lastInsertRowid));
});

app.put('/api/loads/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const existing = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Scoped dispatcher or company_owner can only edit loads in their own company
  if (req.user.company_id && existing.company_id !== req.user.company_id)
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

  // Free up old driver/truck if changed
  if (existing.driver_id && existing.driver_id !== driver_id) {
    db.prepare("UPDATE drivers SET status = 'available' WHERE id = ?").run(existing.driver_id);
  }
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

  if (driver_id) db.prepare("UPDATE drivers SET status='on_load' WHERE id=?").run(driver_id);
  if (truck_id) db.prepare("UPDATE trucks SET status = 'on_load' WHERE id = ?").run(truck_id);

  res.json(db.prepare('SELECT l.*, d.full_name as driver_name, d.phone as driver_phone, t.tractor_number, t.trailer_number as truck_trailer, c.name as company_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id LEFT JOIN trucks t ON l.truck_id = t.id LEFT JOIN companies c ON l.company_id = c.id WHERE l.id = ?').get(req.params.id));
});

app.delete('/api/loads/:id', auth, requireRole('dispatcher'), (req, res) => {
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (load?.driver_id) db.prepare("UPDATE drivers SET status = 'available' WHERE id = ?").run(load.driver_id);
  if (load?.truck_id) db.prepare("UPDATE trucks SET status = 'available' WHERE id = ?").run(load.truck_id);
  db.prepare('DELETE FROM loads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Dispatch message ──────────────────────────────────────────────────────────
app.get('/api/loads/:id/dispatch-message', auth, (req, res) => {
  const load = db.prepare('SELECT l.*, d.full_name as driver_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id WHERE l.id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });

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
  if (load.pickup_date) lines.push(`On: ${load.pickup_date}${load.pickup_time ? ' @ ' + load.pickup_time : ''}`)
  if (load.pickup_refs) lines.push(`PO: ${load.pickup_refs}`)
  if (load.pickup_phone) lines.push(`Call: ${load.pickup_phone}`)

  extraPickups.forEach((pick, i) => {
    lines.push('')
    lines.push(`Pick ${i + 2}: ${pick.name || ''}`)
    const addr = [pick.address, pick.city, pick.state, pick.zip].filter(Boolean).join(', ')
    if (addr) lines.push(`At: ${addr}`)
    if (pick.date) lines.push(`On: ${pick.date}${pick.time ? ' @ ' + pick.time : ''}`)
    if (pick.refs) lines.push(`PO: ${pick.refs}`)
    if (pick.phone) lines.push(`Call: ${pick.phone}`)
  })

  // Delivery block
  lines.push('')
  lines.push(`Drop 1: ${load.delivery_name || ''}`)
  const delAddr = [load.delivery_address, load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).join(', ')
  if (delAddr) lines.push(`At: ${delAddr}`)
  if (load.delivery_date) lines.push(`On: ${load.delivery_date}${load.delivery_time ? ' @ ' + load.delivery_time : ''}`)
  lines.push(`PO: ${load.delivery_refs || ''}`)
  lines.push(`Call: ${load.delivery_phone || ''}`)

  // Extra stops
  let extraStops = []
  try { extraStops = load.extra_stops ? JSON.parse(load.extra_stops) : [] } catch {}
  extraStops.forEach((stop, i) => {
    lines.push('')
    lines.push(`Drop ${i + 2}: ${stop.name || ''}`)
    const addr = [stop.address, stop.city, stop.state, stop.zip].filter(Boolean).join(', ')
    if (addr) lines.push(`At: ${addr}`)
    if (stop.date) lines.push(`On: ${stop.date}${stop.time ? ' @ ' + stop.time : ''}`)
    if (stop.refs) lines.push(`PO: ${stop.refs}`)
    if (stop.phone) lines.push(`Call: ${stop.phone}`)
  })

  if (load.special_instructions) {
    lines.push('')
    lines.push(load.special_instructions)
  }

  res.json({ message: lines.join('\n') });
});

app.post('/api/loads/:id/mark-dispatched', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  db.prepare("UPDATE loads SET dispatch_sent=1, dispatch_sent_at=datetime('now'), status='dispatched' WHERE id=?").run(req.params.id);
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

  if (['delivered','completed'].includes(status)) {
    if (load.driver_id) db.prepare("UPDATE drivers SET status='available' WHERE id=?").run(load.driver_id);
    if (load.truck_id)  db.prepare("UPDATE trucks SET status='available' WHERE id=?").run(load.truck_id);
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

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    res.json(data);
  } catch (err) {
    console.error('Parse error:', err.message, err.status, err.error);
    try { fs.unlinkSync(req.file.path); } catch {}
    let msg = 'Failed to parse PDF';
    if (err.message?.includes('credit balance') || err.message?.includes('credit')) {
      msg = 'PDF parsing unavailable — API credits exhausted. Enter load details manually.';
    } else if (err.status === 401 || err.message?.includes('401') || err.message?.includes('auth') || err.message?.includes('API key')) {
      msg = 'PDF parsing unavailable — API key not configured. Contact admin.';
    } else if (err.status === 529 || err.message?.includes('overloaded')) {
      msg = 'Anthropic API is overloaded — try again in a moment.';
    } else if (err.message?.includes('No JSON')) {
      msg = 'Could not extract load data from PDF — try entering manually.';
    }
    res.status(500).json({ error: msg, detail: err.message });
  }
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

app.get('/api/stats', auth, (req, res) => {
  const isOwner = req.user.role === 'company_owner';
  const cid = isOwner ? req.user.company_id : null;
  const where = cid ? 'WHERE company_id = ?' : '';
  const params = cid ? [cid] : [];

  const loads = db.prepare(`SELECT status, COUNT(*) as count FROM loads ${where} GROUP BY status`).all(...params);
  const drivers = isOwner
    ? db.prepare('SELECT status, COUNT(*) as count FROM drivers WHERE company_id = ? GROUP BY status').all(cid)
    : db.prepare('SELECT status, COUNT(*) as count FROM drivers GROUP BY status').all();
  const trucks = isOwner
    ? db.prepare('SELECT status, COUNT(*) as count FROM trucks WHERE company_id = ? GROUP BY status').all(cid)
    : db.prepare('SELECT status, COUNT(*) as count FROM trucks GROUP BY status').all();

  res.json({ loads, drivers, trucks });
});

// ── Search loads ─────────────────────────────────────────────────────────────
app.get('/api/search', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const isOwner = req.user.role === 'company_owner';
  const companyClause = isOwner ? 'AND l.company_id = ?' : '';
  const companyParam = isOwner ? [req.user.company_id] : [];

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

  const isOwner = req.user.role === 'company_owner';
  const drivers = isOwner
    ? db.prepare(`SELECT d.id, d.full_name, d.rate_per_mile, d.company_id, c.name as company_name
        FROM drivers d LEFT JOIN companies c ON d.company_id = c.id
        WHERE d.company_id = ? AND d.is_active = 1
        ORDER BY d.full_name`).all(req.user.company_id)
    : db.prepare(`SELECT d.id, d.full_name, d.rate_per_mile, d.company_id, c.name as company_name
        FROM drivers d LEFT JOIN companies c ON d.company_id = c.id
        WHERE d.is_active = 1
        ORDER BY c.name, d.full_name`).all();

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
  if (req.user.role === 'company_owner' && driver.company_id !== req.user.company_id)
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
  db.prepare('DELETE FROM payroll_entries WHERE driver_id=? AND entry_date=?').run(driver_id, date);
  res.json({ ok: true });
});

// PUT /api/drivers/:id/toggle-active — disable or enable a driver
app.put('/api/drivers/:id/toggle-active', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (req.user.role === 'company_owner' && driver.company_id !== req.user.company_id)
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

  if (req.user.role === 'company_owner' && driver.company_id !== req.user.company_id)
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

  if (req.user.role === 'company_owner' && driver.company_id !== req.user.company_id)
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

// ── Lane recommendations ──────────────────────────────────────────────────────
app.get('/api/recommendations', auth, (req, res) => {
  const isOwner = req.user.role === 'company_owner';
  const companyClause = isOwner ? 'AND l.company_id = ?' : '';
  const companyParam = isOwner ? [req.user.company_id] : [];

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

// ── Driver change ────────────────────────────────────────────────────────────
app.put('/api/loads/:id/change-driver', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { driver_id } = req.body;
  if (!driver_id) return res.status(400).json({ error: 'driver_id required' });

  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.company_id && load.company_id !== req.user.company_id)
    return res.status(403).json({ error: 'Forbidden' });

  const newDriver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver_id);
  if (!newDriver) return res.status(404).json({ error: 'Driver not found' });

  // Store original driver the first time a swap happens
  const originalId = load.original_driver_id || load.driver_id;

  // Free previous driver if different
  if (load.driver_id && load.driver_id !== Number(driver_id)) {
    db.prepare("UPDATE drivers SET status='available' WHERE id=?").run(load.driver_id);
  }

  db.prepare('UPDATE loads SET driver_id=?, original_driver_id=?, status=? WHERE id=?')
    .run(driver_id, originalId || null, load.status === 'open' ? 'covered' : load.status, req.params.id);
  db.prepare("UPDATE drivers SET status='on_load' WHERE id=?").run(driver_id);

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
  }
  db.prepare('UPDATE loads SET trailer_number = ? WHERE id = ?').run(trailer_number || null, req.params.id);
  res.json({ ok: true });
});

app.put('/api/loads/:id/checkin', auth, (req, res) => {
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  }
  const time = req.body.time || new Date().toISOString();
  db.prepare('UPDATE loads SET checkin_time = ? WHERE id = ?').run(time, req.params.id);
  res.json({ ok: true, checkin_time: time });
});

app.put('/api/loads/:id/checkout', auth, (req, res) => {
  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  }
  const time = req.body.time || new Date().toISOString();
  db.prepare('UPDATE loads SET checkout_time = ? WHERE id = ?').run(time, req.params.id);
  res.json({ ok: true, checkout_time: time });
});

// ── Load documents ───────────────────────────────────────────────────────────
app.get('/api/loads/:id/docs', auth, (req, res) => {
  const load = db.prepare('SELECT company_id, driver_id FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (req.user.company_id && load.company_id !== req.user.company_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(db.prepare('SELECT * FROM load_docs WHERE load_id = ? ORDER BY uploaded_at DESC').all(req.params.id));
});

app.post('/api/loads/:id/docs', auth, upload.single('file'), async (req, res) => {
  if (req._fileTypeError) return res.status(400).json({ error: req._fileTypeError });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const load = db.prepare('SELECT company_id, driver_id FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Load not found' });
  if (req.user.role === 'driver') {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver || load.driver_id !== driver.id) return res.status(403).json({ error: 'Forbidden' });
  } else if (req.user.company_id && load.company_id !== req.user.company_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { doc_type } = req.body;
  const localPath = path.join(UPLOADS_DIR, req.file.filename);
  const driveId = await drive.upload(localPath, req.file.originalname, req.file.mimetype);
  const r = db.prepare('INSERT INTO load_docs (load_id, doc_type, original_name, filename, uploaded_by, drive_file_id) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, doc_type || 'Other', req.file.originalname, req.file.filename, req.user.id, driveId || null);
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
  } else if (req.user.company_id && doc.load_company_id !== req.user.company_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
  if (doc.drive_file_id) {
    const ok = await drive.download(doc.drive_file_id, res);
    if (ok) return res.end();
    // Drive failed — fall through to disk
  }
  const filePath = path.join(UPLOADS_DIR, doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.download(filePath, doc.original_name);
});

app.delete('/api/docs/:id', auth, requireRole('dispatcher', 'company_owner'), async (req, res) => {
  const doc = db.prepare(`
    SELECT ld.*, l.company_id as load_company_id
    FROM load_docs ld JOIN loads l ON ld.load_id = l.id WHERE ld.id = ?
  `).get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (req.user.company_id && doc.load_company_id !== req.user.company_id)
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
  if (req.user.company_id && truck.company_id !== req.user.company_id)
    return res.status(403).json({ error: 'Forbidden' });
  res.json(db.prepare('SELECT * FROM truck_docs WHERE truck_id = ? ORDER BY uploaded_at DESC').all(req.params.id));
});

app.post('/api/trucks/:id/docs', auth, requireRole('dispatcher', 'company_owner'), upload.single('file'), async (req, res) => {
  if (req._fileTypeError) return res.status(400).json({ error: req._fileTypeError });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const truck = db.prepare('SELECT * FROM trucks WHERE id = ?').get(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  if (req.user.role === 'company_owner' && truck.company_id !== req.user.company_id)
    return res.status(403).json({ error: 'Forbidden' });
  const { doc_type } = req.body;
  const localPath = path.join(UPLOADS_DIR, req.file.filename);
  const driveId = await drive.upload(localPath, req.file.originalname, req.file.mimetype);
  const r = db.prepare('INSERT INTO truck_docs (truck_id, doc_type, original_name, filename, uploaded_by, drive_file_id) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, doc_type || 'Other', req.file.originalname, req.file.filename, req.user.id, driveId || null);
  res.json(db.prepare('SELECT * FROM truck_docs WHERE id = ?').get(r.lastInsertRowid));
});

app.get('/api/truck-docs/:id/download', auth, async (req, res) => {
  const doc = db.prepare(`
    SELECT td.*, t.company_id as truck_company_id
    FROM truck_docs td JOIN trucks t ON td.truck_id = t.id WHERE td.id = ?
  `).get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (req.user.company_id && doc.truck_company_id !== req.user.company_id)
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
  if (req.user.company_id && doc.truck_company_id !== req.user.company_id)
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
  if (req.user.company_id && load.company_id !== req.user.company_id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE loads SET detention_start=?, detention_end=?, detention_rate=? WHERE id=?')
    .run(detention_start || null, detention_end || null, rate, req.params.id);
  res.json({ ok: true });
});

// ── Compliance data ──────────────────────────────────────────────────────────
app.get('/api/compliance', auth, (req, res) => {
  const isOwner = req.user.role === 'company_owner';
  const isAdmin = req.user.role === 'dispatcher' && !req.user.company_id && !req.user.allowed_company_ids;
  const cid = isOwner ? req.user.company_id : (!isAdmin && req.user.company_id) ? req.user.company_id : null;

  const driverWhere = cid ? 'WHERE d.company_id = ?' : '';
  const truckWhere  = cid ? 'WHERE t.company_id = ?' : '';
  const params = cid ? [cid] : [];

  const drivers = db.prepare(`
    SELECT d.id, d.full_name, d.cdl_class, d.license_state,
           d.license_number, d.license_expiry, d.medical_card_expiry,
           d.drug_test_date, d.drug_test_expiry, d.is_active,
           c.name as company_name
    FROM drivers d LEFT JOIN companies c ON d.company_id = c.id
    ${driverWhere}
    ORDER BY d.full_name
  `).all(...params);

  const trucks = db.prepare(`
    SELECT t.id, t.tractor_number, t.trailer_number, t.plate,
           t.registration_expiry, t.insurance_expiry,
           c.name as company_name
    FROM trucks t LEFT JOIN companies c ON t.company_id = c.id
    ${truckWhere}
    ORDER BY t.tractor_number
  `).all(...params);

  res.json({ drivers, trucks });
});

// ── Maintenance records ──────────────────────────────────────────────────────
app.get('/api/maintenance', auth, (req, res) => {
  const isOwner = req.user.role === 'company_owner';
  const clause = isOwner ? 'WHERE m.company_id = ?' : (req.query.truck_id ? 'WHERE m.truck_id = ?' : '');
  const param = isOwner ? req.user.company_id : (req.query.truck_id ? req.query.truck_id : undefined);
  const rows = db.prepare(`
    SELECT m.*, t.tractor_number, t.trailer_number as truck_trailer
    FROM maintenance_records m
    LEFT JOIN trucks t ON m.truck_id = t.id
    ${clause}
    ORDER BY m.service_date DESC
  `).all(...(param !== undefined ? [param] : []));
  res.json(rows);
});

app.post('/api/maintenance', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { truck_id, service_type, service_date, mileage, notes, next_due_date, next_due_mileage } = req.body;
  if (!truck_id || !service_type || !service_date) return res.status(400).json({ error: 'truck_id, service_type, service_date required' });
  const truck = db.prepare('SELECT * FROM trucks WHERE id = ?').get(truck_id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  if (req.user.role === 'company_owner' && truck.company_id !== req.user.company_id)
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
