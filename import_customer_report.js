const XLSX = require('xlsx');
const db = require('./db');

const CID = {
  WMK:      db.prepare("SELECT id FROM companies WHERE name='WMK STAR INC'").get()?.id,
  SANT:     db.prepare("SELECT id FROM companies WHERE name='SANT TRANS INC'").get()?.id,
  FFI:      db.prepare("SELECT id FROM companies WHERE name='THE FRONTLINE FREIGHT INC'").get()?.id,
  BROTHERS: db.prepare("SELECT id FROM companies WHERE name='BROTHERS LOGISTICS INC'").get()?.id,
  CHEEMA:   db.prepare("SELECT id FROM companies WHERE name='CHEEMA BROS TRANS INC'").get()?.id,
  OTHER:    db.prepare("SELECT id FROM companies WHERE name='INDEPENDENT / OTHER'").get()?.id,
};
console.log('Company IDs:', CID);

const allDrivers = db.prepare('SELECT id, full_name, company_id FROM drivers').all();

// Clean driver suffix tags from ITS Dispatch names
function cleanDriverName(raw) {
  if (!raw) return '';
  return raw.toString()
    .replace(/\s+FFI$/i,'').replace(/\s+WMK$/i,'').replace(/\s+SANT$/i,'')
    .replace(/\s+frontline$/i,'').replace(/\s+wmk$/i,'').replace(/\s+sant$/i,'')
    .replace(/\s+Bros$/i,'').replace(/\s+Cheema$/i,'')
    .trim();
}

// Match driver name to DB record — fuzzy first/last word match
function matchDriver(raw) {
  if (!raw || !raw.toString().trim()) return null;
  const cleaned = cleanDriverName(raw.toString()).toLowerCase();
  if (!cleaned) return null;
  // Exact match first
  let d = allDrivers.find(x => x.full_name.toLowerCase() === cleaned);
  if (d) return d;
  // First word match (first name)
  const first = cleaned.split(' ')[0];
  const matches = allDrivers.filter(x => x.full_name.toLowerCase().startsWith(first));
  if (matches.length === 1) return matches[0];
  // Last word match (last name)
  const last = cleaned.split(' ').slice(-1)[0];
  const lastMatches = allDrivers.filter(x => x.full_name.toLowerCase().endsWith(last));
  if (lastMatches.length === 1) return lastMatches[0];
  return null;
}

// Determine company from route and driver name
function resolveCompany(originRaw, destRaw, driverRaw) {
  const origin = (originRaw || '').toUpperCase();
  const dest = (destRaw || '').toUpperCase();
  const driver = (driverRaw || '').toUpperCase();

  // Driver suffix overrides
  if (driver.includes(' FFI') || driver.includes('FRONTLINE')) return CID.FFI;
  if (driver.includes(' WMK')) return CID.WMK;
  if (driver.includes(' SANT')) return CID.SANT;
  if (driver.includes(' SANT') || driver.includes('SUKHWINDER')) return CID.SANT;

  // Frontline never touches CA
  const touchesCA = origin.includes(', CA') || dest.includes(', CA') ||
                    origin.startsWith('CA ') || dest.startsWith('CA ');

  // IN/UT/OH routes → Frontline (unless CA involved)
  const isFFIRoute = !touchesCA && (
    (origin.includes(', IN') || origin.includes(', UT') || origin.includes(', OH')) &&
    (dest.includes(', IN') || dest.includes(', UT') || dest.includes(', OH'))
  );
  if (isFFIRoute) return CID.FFI;

  // CA routes → WMK
  if (touchesCA) return CID.WMK;

  // Known WMK drivers
  const driverObj = matchDriver(driverRaw);
  if (driverObj) return driverObj.company_id;

  return CID.WMK; // default to WMK per user instruction
}

// Parse "City, ST" into city and state
function parseLocation(loc) {
  if (!loc) return { city: '', state: '' };
  const s = loc.toString().trim();
  const m = s.match(/^(.+),\s*([A-Z]{2})$/);
  if (m) return { city: m[1].trim(), state: m[2].trim() };
  // Try splitting last word as state
  const parts = s.split(',');
  if (parts.length >= 2) return { city: parts.slice(0,-1).join(',').trim(), state: parts.slice(-1)[0].trim() };
  return { city: s, state: '' };
}

function excelDateToStr(val) {
  if (!val) return '';
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) return val.slice(0,10);
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().slice(0,10);
  }
  return val.toString().slice(0,10);
}

// ── Parse the report ──────────────────────────────────────────────────────────
const wb = XLSX.readFile('/Users/safalmadaan/Downloads/Customer Report 2026-06-13.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const insertLoad = db.prepare(`
  INSERT OR IGNORE INTO loads (
    load_number, broker_name, pickup_city, pickup_state, delivery_city, delivery_state,
    pickup_date, delivery_date, pickup_refs, trailer_type, weight,
    driver_id, company_id, status, rate
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'completed',?)
`);

let currentBroker = '';
let imported = 0;
let skipped = 0;
let driverMisses = [];

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const first = row[0]?.toString().trim();

  // Detect broker name rows (non-numeric, non-empty, not header, not Totals, not address)
  if (first && !first.startsWith('Load') && !first.startsWith('Total') &&
      isNaN(parseInt(first)) && !first.includes('Tel:') && !first.includes('\n') &&
      !first.includes('REPORT') && first.length > 2) {
    // Check next row is address/tel — confirms this is broker name
    const next = rows[i+1]?.[0]?.toString() || '';
    if (next.includes('Tel:') || next.includes(',')) {
      currentBroker = first.replace(/\s+$/, '');
    }
    continue;
  }

  // Detect data rows: first cell is a number (load #)
  const loadNum = parseInt(first);
  if (!loadNum || loadNum < 100) continue;

  const shipDate  = excelDateToStr(row[1]);
  const delDate   = excelDateToStr(row[2]);
  const originRaw = row[5]?.toString().trim();
  const destRaw   = row[6]?.toString().trim();
  const refs      = row[7]?.toString().trim();
  const equipment = row[10]?.toString().trim();
  const weight    = row[12]?.toString().trim();
  const revenue   = row[21] ? row[21].toString().trim() : '';
  const driverRaw = row[32]?.toString().trim();

  // Skip if already imported
  const exists = db.prepare('SELECT id FROM loads WHERE load_number=?').get(loadNum.toString());
  if (exists) { skipped++; continue; }

  const pickup = parseLocation(originRaw);
  const delivery = parseLocation(destRaw);
  const driver = matchDriver(driverRaw);
  const companyId = resolveCompany(originRaw, destRaw, driverRaw);

  if (driverRaw && !driver) {
    driverMisses.push(`Load ${loadNum}: "${driverRaw}" → no match`);
  }

  insertLoad.run(
    loadNum.toString(),
    currentBroker,
    pickup.city, pickup.state,
    delivery.city, delivery.state,
    shipDate, delDate,
    refs, equipment, weight,
    driver?.id || null,
    companyId,
    revenue || null
  );
  imported++;
}

console.log(`\nImported: ${imported} loads`);
console.log(`Skipped (already exist): ${skipped}`);
console.log(`\nDriver name mismatches (${driverMisses.length}):`);
driverMisses.slice(0, 30).forEach(m => console.log(' ', m));

// Final tally
const totals = db.prepare(`SELECT c.name, count(*) as n FROM loads l
  JOIN companies c ON l.company_id=c.id WHERE l.status='completed' GROUP BY c.id`).all();
console.log('\nCompleted loads by company:');
totals.forEach(t => console.log(' ', t.name, ':', t.n));
