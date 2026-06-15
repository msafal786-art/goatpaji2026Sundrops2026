const Database = require('better-sqlite3');
const path = require('path');

// On Railway, DB lives on a persistent volume at /app/data; locally it's next to this file
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dispatch.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    mc_number TEXT,
    dot_number TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('dispatcher','company_owner','driver')),
    company_id INTEGER REFERENCES companies(id),
    full_name TEXT,
    email TEXT,
    phone TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    company_id INTEGER REFERENCES companies(id),
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    license_number TEXT,
    license_expiry TEXT,
    medical_card_expiry TEXT,
    notes TEXT,
    status TEXT DEFAULT 'available' CHECK(status IN ('available','on_load','off_duty')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trucks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id),
    tractor_number TEXT NOT NULL,
    trailer_number TEXT,
    trailer_type TEXT,
    vin TEXT,
    plate TEXT,
    registration_expiry TEXT,
    insurance_expiry TEXT,
    notes TEXT,
    status TEXT DEFAULT 'available' CHECK(status IN ('available','on_load','maintenance')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id),
    load_number TEXT,
    broker_name TEXT,
    broker_order TEXT,
    broker_contact TEXT,
    broker_email TEXT,
    commodity TEXT,
    weight TEXT,
    miles TEXT,
    trailer_type TEXT,
    bol TEXT,
    rate TEXT,
    pickup_name TEXT,
    pickup_address TEXT,
    pickup_city TEXT,
    pickup_state TEXT,
    pickup_zip TEXT,
    pickup_date TEXT,
    pickup_time TEXT,
    pickup_phone TEXT,
    pickup_refs TEXT,
    delivery_name TEXT,
    delivery_address TEXT,
    delivery_city TEXT,
    delivery_state TEXT,
    delivery_zip TEXT,
    delivery_date TEXT,
    delivery_time TEXT,
    delivery_phone TEXT,
    delivery_refs TEXT,
    special_instructions TEXT,
    driver_id INTEGER REFERENCES drivers(id),
    truck_id INTEGER REFERENCES trucks(id),
    dispatch_sent INTEGER DEFAULT 0,
    dispatch_sent_at TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','assigned','dispatched','in_transit','delivered','completed')),
    rate_con_filename TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS driver_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER REFERENCES drivers(id),
    doc_type TEXT,
    filename TEXT,
    expiry TEXT,
    uploaded_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Incremental migrations ───────────────────────────────────────────────────
const cols = db.prepare("PRAGMA table_info(drivers)").all().map(r => r.name);
if (!cols.includes('pay_percentage'))          db.prepare('ALTER TABLE drivers ADD COLUMN pay_percentage REAL DEFAULT 70').run();
if (!cols.includes('rate_per_mile'))           db.prepare('ALTER TABLE drivers ADD COLUMN rate_per_mile REAL DEFAULT 0.55').run();
if (!cols.includes('is_active'))               db.prepare('ALTER TABLE drivers ADD COLUMN is_active INTEGER DEFAULT 1').run();
if (!cols.includes('hire_date'))               db.prepare('ALTER TABLE drivers ADD COLUMN hire_date TEXT').run();
if (!cols.includes('date_of_birth'))           db.prepare('ALTER TABLE drivers ADD COLUMN date_of_birth TEXT').run();
if (!cols.includes('address'))                 db.prepare('ALTER TABLE drivers ADD COLUMN address TEXT').run();
if (!cols.includes('cdl_class'))               db.prepare('ALTER TABLE drivers ADD COLUMN cdl_class TEXT').run();
if (!cols.includes('license_state'))           db.prepare('ALTER TABLE drivers ADD COLUMN license_state TEXT').run();
if (!cols.includes('drug_test_date'))          db.prepare('ALTER TABLE drivers ADD COLUMN drug_test_date TEXT').run();
if (!cols.includes('background_check_date'))   db.prepare('ALTER TABLE drivers ADD COLUMN background_check_date TEXT').run();
if (!cols.includes('emergency_contact_name'))  db.prepare('ALTER TABLE drivers ADD COLUMN emergency_contact_name TEXT').run();
if (!cols.includes('emergency_contact_phone')) db.prepare('ALTER TABLE drivers ADD COLUMN emergency_contact_phone TEXT').run();

const loadCols = db.prepare("PRAGMA table_info(loads)").all().map(r => r.name);
if (!loadCols.includes('relay_driver_id'))   db.prepare('ALTER TABLE loads ADD COLUMN relay_driver_id INTEGER REFERENCES drivers(id)').run();
if (!loadCols.includes('relay_split'))       db.prepare('ALTER TABLE loads ADD COLUMN relay_split INTEGER DEFAULT 50').run();
if (!loadCols.includes('trailer_number'))    db.prepare('ALTER TABLE loads ADD COLUMN trailer_number TEXT').run();
if (!loadCols.includes('checkin_time'))      db.prepare('ALTER TABLE loads ADD COLUMN checkin_time TEXT').run();
if (!loadCols.includes('checkout_time'))     db.prepare('ALTER TABLE loads ADD COLUMN checkout_time TEXT').run();

// Load documents (POD, BOL, Rate Con, Other)
db.exec(`
  CREATE TABLE IF NOT EXISTS load_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    load_id INTEGER NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL DEFAULT 'Other',
    original_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TEXT DEFAULT (datetime('now'))
  );
`);

// Maintenance records for trucks and trailers
db.exec(`
  CREATE TABLE IF NOT EXISTS maintenance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    truck_id INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL,
    service_date TEXT NOT NULL,
    mileage TEXT,
    notes TEXT,
    next_due_date TEXT,
    next_due_mileage TEXT,
    company_id INTEGER REFERENCES companies(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Payroll — daily mileage entries, one row per driver per day
db.exec(`
  CREATE TABLE IF NOT EXISTS payroll_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    company_id INTEGER REFERENCES companies(id),
    entry_date TEXT NOT NULL,
    miles REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(driver_id, entry_date)
  );
`);

// Seed a default dispatcher account
const bcrypt = require('bcryptjs');
const existingDispatcher = db.prepare('SELECT id FROM users WHERE username = ?').get('dispatcher');
if (!existingDispatcher) {
  const hash = bcrypt.hashSync('dispatch123', 10);
  db.prepare(`INSERT INTO users (username, password, role, full_name) VALUES (?, ?, 'dispatcher', 'Main Dispatcher')`).run('dispatcher', hash);
}

module.exports = db;
