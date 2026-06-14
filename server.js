require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Anthropic = require('@anthropic-ai/sdk');

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
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const upload = multer({ dest: 'uploads/' });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Health check (Railway uses this) ────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { id: user.id, role: user.role, company_id: user.company_id, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, role: user.role, full_name: user.full_name, company_id: user.company_id });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.username, u.role, u.company_id, u.full_name, u.email, u.phone,
           c.name as company_name
    FROM users u LEFT JOIN companies c ON u.company_id = c.id
    WHERE u.id = ?
  `).get(req.user.id);
  if (user.role === 'driver') {
    user.driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(user.id);
  }
  res.json(user);
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
app.post('/api/users', auth, requireRole('dispatcher'), (req, res) => {
  const { username, password, role, company_id, full_name, email, phone } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const r = db.prepare('INSERT INTO users (username,password,role,company_id,full_name,email,phone) VALUES (?,?,?,?,?,?,?)').run(username, hash, role, company_id || null, full_name, email, phone);
    res.json({ id: r.lastInsertRowid, username, role, full_name });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.get('/api/users', auth, requireRole('dispatcher'), (req, res) => {
  res.json(db.prepare('SELECT id,username,role,company_id,full_name,email,phone,created_at FROM users ORDER BY full_name').all());
});

// ── Drivers ──────────────────────────────────────────────────────────────────
app.get('/api/drivers', auth, (req, res) => {
  let query = 'SELECT d.*, c.name as company_name FROM drivers d LEFT JOIN companies c ON d.company_id = c.id';
  const params = [];
  if (req.user.role === 'company_owner') {
    query += ' WHERE d.company_id = ?';
    params.push(req.user.company_id);
  }
  query += ' ORDER BY d.full_name';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/drivers', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes, company_id, username, password } = req.body;
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

  const r = db.prepare('INSERT INTO drivers (user_id,company_id,full_name,phone,email,license_number,license_expiry,medical_card_expiry,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(user_id, cid, full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes);
  res.json(db.prepare('SELECT d.*, c.name as company_name FROM drivers d LEFT JOIN companies c ON d.company_id = c.id WHERE d.id = ?').get(r.lastInsertRowid));
});

app.put('/api/drivers/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const { full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes, status } = req.body;
  db.prepare('UPDATE drivers SET full_name=?,phone=?,email=?,license_number=?,license_expiry=?,medical_card_expiry=?,notes=?,status=? WHERE id=?').run(full_name, phone, email, license_number, license_expiry, medical_card_expiry, notes, status, req.params.id);
  res.json(db.prepare('SELECT d.*, c.name as company_name FROM drivers d LEFT JOIN companies c ON d.company_id = c.id WHERE d.id = ?').get(req.params.id));
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
      t.tractor_number, t.trailer_number as truck_trailer,
      c.name as company_name
    FROM loads l
    LEFT JOIN drivers d ON l.driver_id = d.id
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
    return res.json(loadsQuery('WHERE l.driver_id = ?', [driver.id]));
  }
  if (req.user.role === 'company_owner') {
    return res.json(loadsQuery('WHERE l.company_id = ?', [req.user.company_id]));
  }
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
      t.tractor_number, t.trailer_number as truck_trailer,
      c.name as company_name
    FROM loads l
    LEFT JOIN drivers d ON l.driver_id = d.id
    LEFT JOIN trucks t ON l.truck_id = t.id
    LEFT JOIN companies c ON l.company_id = c.id
    WHERE l.id = ?
  `).get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });
  res.json(load);
});

app.post('/api/loads', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const cid = req.user.role === 'company_owner' ? req.user.company_id : req.body.company_id;
  const {
    load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, driver_id, truck_id
  } = req.body;

  const r = db.prepare(`INSERT INTO loads (
    company_id, load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, driver_id, truck_id,
    status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    cid, load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, driver_id || null, truck_id || null,
    driver_id ? 'assigned' : 'pending'
  );

  if (driver_id) {
    db.prepare("UPDATE drivers SET status = 'on_load' WHERE id = ?").run(driver_id);
  }
  if (truck_id) {
    db.prepare("UPDATE trucks SET status = 'on_load' WHERE id = ?").run(truck_id);
  }

  res.json(db.prepare('SELECT l.*, d.full_name as driver_name, t.tractor_number, t.trailer_number as truck_trailer, c.name as company_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id LEFT JOIN trucks t ON l.truck_id = t.id LEFT JOIN companies c ON l.company_id = c.id WHERE l.id = ?').get(r.lastInsertRowid));
});

app.put('/api/loads/:id', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  const existing = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const {
    load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, driver_id, truck_id, status, company_id
  } = req.body;

  // Free up old driver/truck if changed
  if (existing.driver_id && existing.driver_id !== driver_id) {
    db.prepare("UPDATE drivers SET status = 'available' WHERE id = ?").run(existing.driver_id);
  }
  if (existing.truck_id && existing.truck_id !== truck_id) {
    db.prepare("UPDATE trucks SET status = 'available' WHERE id = ?").run(existing.truck_id);
  }

  const newStatus = status || (driver_id ? 'assigned' : 'pending');

  db.prepare(`UPDATE loads SET
    company_id=?, load_number=?, broker_name=?, broker_order=?, broker_contact=?, broker_email=?,
    commodity=?, weight=?, miles=?, trailer_type=?, bol=?, rate=?,
    pickup_name=?, pickup_address=?, pickup_city=?, pickup_state=?, pickup_zip=?,
    pickup_date=?, pickup_time=?, pickup_phone=?, pickup_refs=?,
    delivery_name=?, delivery_address=?, delivery_city=?, delivery_state=?, delivery_zip=?,
    delivery_date=?, delivery_time=?, delivery_phone=?, delivery_refs=?,
    special_instructions=?, driver_id=?, truck_id=?, status=?
    WHERE id=?
  `).run(
    company_id || existing.company_id,
    load_number, broker_name, broker_order, broker_contact, broker_email,
    commodity, weight, miles, trailer_type, bol, rate,
    pickup_name, pickup_address, pickup_city, pickup_state, pickup_zip,
    pickup_date, pickup_time, pickup_phone, pickup_refs,
    delivery_name, delivery_address, delivery_city, delivery_state, delivery_zip,
    delivery_date, delivery_time, delivery_phone, delivery_refs,
    special_instructions, driver_id || null, truck_id || null, newStatus,
    req.params.id
  );

  if (driver_id) db.prepare("UPDATE drivers SET status = 'on_load' WHERE id = ?").run(driver_id);
  if (truck_id) db.prepare("UPDATE trucks SET status = 'on_load' WHERE id = ?").run(truck_id);

  res.json(db.prepare('SELECT l.*, d.full_name as driver_name, d.phone as driver_phone, t.tractor_number, t.trailer_number as truck_trailer, c.name as company_name FROM loads l LEFT JOIN drivers d ON l.driver_id = d.id LEFT JOIN trucks t ON l.truck_id = t.id LEFT JOIN companies c ON l.company_id = c.id WHERE l.id = ?').get(req.params.id));
});

app.delete('/api/loads/:id', auth, requireRole('dispatcher'), (req, res) => {
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

  const pickupRefs = load.pickup_refs || '';
  const deliveryRefs = load.delivery_refs || '';

  const msg = `Hello ${load.driver_name || 'Driver'},

Load Number: ${load.load_number || load.id}

Pick: ${load.pickup_name || ''}
At: ${[load.pickup_address, load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).join(', ')}
On: ${load.pickup_date || ''} @ ${load.pickup_time || ''}
Call: ${load.pickup_phone || ''}
PO: ${pickupRefs}

Drop: ${load.delivery_name || ''}
At: ${[load.delivery_address, load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).join(', ')}
On: ${load.delivery_date || ''} @ ${load.delivery_time || ''}
Call: ${load.delivery_phone || ''}
PO: ${deliveryRefs}${load.special_instructions ? '\n\nSpecial Instructions:\n' + load.special_instructions : ''}`;

  res.json({ message: msg });
});

app.post('/api/loads/:id/mark-dispatched', auth, requireRole('dispatcher', 'company_owner'), (req, res) => {
  db.prepare("UPDATE loads SET dispatch_sent=1, dispatch_sent_at=datetime('now'), status='dispatched' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/loads/:id/status', auth, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending','assigned','dispatched','in_transit','delivered','completed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const load = db.prepare('SELECT * FROM loads WHERE id = ?').get(req.params.id);
  if (!load) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE loads SET status=? WHERE id=?').run(status, req.params.id);

  if (['delivered','completed'].includes(status)) {
    if (load.driver_id) db.prepare("UPDATE drivers SET status='available' WHERE id=?").run(load.driver_id);
    if (load.truck_id) db.prepare("UPDATE trucks SET status='available' WHERE id=?").run(load.truck_id);
  }

  res.json({ ok: true });
});

// ── PDF Rate Con Parser ───────────────────────────────────────────────────────
app.post('/api/parse-rate-con', auth, requireRole('dispatcher', 'company_owner'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64 = fileBuffer.toString('base64');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
            text: `Extract all load/dispatch information from this rate confirmation PDF. Return ONLY a valid JSON object with these exact fields (use empty string if not found):
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
  "pickup_name": "",
  "pickup_address": "",
  "pickup_city": "",
  "pickup_state": "",
  "pickup_zip": "",
  "pickup_date": "",
  "pickup_time": "",
  "pickup_phone": "",
  "pickup_refs": "",
  "delivery_name": "",
  "delivery_address": "",
  "delivery_city": "",
  "delivery_state": "",
  "delivery_zip": "",
  "delivery_date": "",
  "delivery_time": "",
  "delivery_phone": "",
  "delivery_refs": "",
  "special_instructions": "",
  "driver_name": "",
  "driver_phone": "",
  "tractor_number": "",
  "trailer_number": ""
}

For pickup_refs and delivery_refs, combine all reference numbers (PU#, BOL#, PO#, AO#, CF#, etc.) into one string like "PU #12345 PO #67890".
For dates format as YYYY-MM-DD. For times use HH:MM AM/PM format.`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const data = JSON.parse(jsonMatch[0]);
    data._filename = req.file.originalname;

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    res.json(data);
  } catch (err) {
    console.error('Parse error:', err.message);
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: 'Failed to parse PDF: ' + err.message });
  }
});

// ── Stats for dashboard ───────────────────────────────────────────────────────
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

// ── Serve frontend ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Dispatch Portal running on http://localhost:${PORT}`));
