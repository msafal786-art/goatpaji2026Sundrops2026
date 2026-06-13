const XLSX = require('xlsx');
const db = require('./db');
const bcrypt = require('bcryptjs');

// ── Company IDs ────────────────────────────────────────────────────────────────
const CID = {
  FFI:        db.prepare("SELECT id FROM companies WHERE name='THE FRONTLINE FREIGHT INC'").get()?.id,
  WMK:        db.prepare("SELECT id FROM companies WHERE name='WMK STAR INC'").get()?.id,
  SANT:       db.prepare("SELECT id FROM companies WHERE name='SANT TRANS INC'").get()?.id,
  BROTHERS:   db.prepare("SELECT id FROM companies WHERE name='BROTHERS LOGISTICS INC'").get()?.id,
  CHEEMA:     db.prepare("SELECT id FROM companies WHERE name='CHEEMA BROS TRANS INC'").get()?.id,
  OTHER:      db.prepare("SELECT id FROM companies WHERE name='INDEPENDENT / OTHER'").get()?.id,
};
console.log('Company IDs:', CID);

function resolveCompany(name) {
  const n = name.toUpperCase();
  if (n.includes(' FFI'))  return CID.FFI;
  if (n.includes(' WMK'))  return CID.WMK;
  if (n.includes(' SANT') || n.includes('SANT ')) return CID.SANT;
  if (n === 'BALJIT SINGH') return CID.WMK;
  if (n === 'JASPREET RAMAN WMK') return CID.WMK;
  if (n === 'SUKHWINDER SANT') return CID.SANT;
  return CID.OTHER;
}

function cleanName(name) {
  return name.replace(/ FFI$/i,'').replace(/ WMK$/i,'').replace(/ SANT$/i,'').trim();
}

// ── Import drivers ─────────────────────────────────────────────────────────────
const driverWb = XLSX.readFile('/Users/safalmadaan/Downloads/Drivers.xlsx');
const driverRows = XLSX.utils.sheet_to_json(driverWb.Sheets[driverWb.SheetNames[0]]);
const activeDrivers = driverRows.filter(d => d.Status === 'Active');

let driverCount = 0;
for (const d of activeDrivers) {
  const rawName = String(d.Name || '').trim();
  if (!rawName) continue;
  const phone = String(d.Cell || d.Telephone || '').replace(/[?]/g,'').trim();
  const companyId = resolveCompany(rawName);
  const cleanedName = cleanName(rawName);

  // Check if exists
  const exists = db.prepare('SELECT id FROM drivers WHERE full_name=?').get(cleanedName);
  if (exists) {
    // Update phone if we have one
    if (phone) db.prepare('UPDATE drivers SET phone=? WHERE id=?').run(phone, exists.id);
    // Ensure company is correct
    db.prepare('UPDATE drivers SET company_id=? WHERE id=?').run(companyId, exists.id);
    continue;
  }
  db.prepare('INSERT OR IGNORE INTO drivers (full_name, phone, company_id, status) VALUES (?,?,?,?)').run(cleanedName, phone, companyId, 'available');
  console.log(`+ Driver: ${cleanedName} (${Object.keys(CID).find(k => CID[k] === companyId) || 'OTHER'})`);
  driverCount++;
}
console.log(`\nDrivers: ${driverCount} new, ${activeDrivers.length} total processed`);

// ── Import trucks (all as Frontline / FFI) ─────────────────────────────────────
const truckWb = XLSX.readFile('/Users/safalmadaan/Downloads/Trucks.xlsx');
const truckRows = XLSX.utils.sheet_to_json(truckWb.Sheets[truckWb.SheetNames[0]]);

let truckCount = 0;
for (const t of truckRows) {
  const num = String(t.Number || '').trim();
  if (!num) continue;
  const exists = db.prepare('SELECT id FROM trucks WHERE tractor_number=?').get(num);
  if (exists) continue;
  db.prepare('INSERT INTO trucks (tractor_number, trailer_number, trailer_type, company_id, status) VALUES (?,?,?,?,?)').run(
    num, '', '53 ft. Van', CID.FFI, 'available'
  );
  console.log(`+ Truck: ${num}`);
  truckCount++;
}
console.log(`\nTrucks: ${truckCount} new`);

// ── Create Rakesh as Frontline dispatcher user ─────────────────────────────────
const rakeshExists = db.prepare("SELECT id FROM users WHERE username='rakesh'").get();
if (!rakeshExists) {
  const hash = bcrypt.hashSync('frontline2026', 10);
  db.prepare("INSERT INTO users (username, password, full_name, role, company_id) VALUES (?,?,?,?,?)")
    .run('rakesh', hash, 'Rakesh Kumar', 'company_owner', CID.FFI);
  console.log('\n+ User: rakesh (company_owner, Frontline) — password: frontline2026');
} else {
  db.prepare("UPDATE users SET company_id=?, role='company_owner' WHERE username='rakesh'").run(CID.FFI);
  console.log('\n~ User rakesh already exists, updated to Frontline');
}

// ── Ensure Baljit Singh is WMK ────────────────────────────────────────────────
const baljit = db.prepare("SELECT id FROM drivers WHERE full_name LIKE 'Baljit%'").get();
if (baljit) {
  db.prepare('UPDATE drivers SET company_id=? WHERE id=?').run(CID.WMK, baljit.id);
  console.log('~ Baljit Singh → WMK STAR INC');
}

console.log('\nDone.');
process.exit(0);
