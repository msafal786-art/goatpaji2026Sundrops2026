// One-shot bulk import of load board data
const db = require('./db');
const bcrypt = require('bcryptjs');

// ── Companies ────────────────────────────────────────────────────────────────
const companies = [
  { name: 'Wmk Star Inc' },          // id 1 — already exists
  { name: 'Sant Trans Inc' },         // id 2 — already exists
  { name: 'FFI Trucking' },
  { name: 'Independent / Other' },
];

function ensureCompany(name) {
  const ex = db.prepare('SELECT id FROM companies WHERE name = ?').get(name);
  if (ex) return ex.id;
  return db.prepare('INSERT INTO companies (name) VALUES (?)').run(name).lastInsertRowid;
}

const cID = {};
companies.forEach(c => { cID[c.name] = ensureCompany(c.name); });

// ── Driver helper ─────────────────────────────────────────────────────────────
function ensureDriver(fullName, companyId) {
  if (!fullName || fullName === 'Assign Later') return null;
  const ex = db.prepare('SELECT id FROM drivers WHERE full_name = ? AND company_id = ?').get(fullName, companyId);
  if (ex) return ex.id;
  return db.prepare('INSERT INTO drivers (full_name, company_id, status) VALUES (?, ?, ?)').run(fullName, companyId, 'on_load').lastInsertRowid;
}

function resolveCompany(driverRaw) {
  if (!driverRaw || driverRaw === 'Assign Later') return cID['Independent / Other'];
  if (driverRaw.includes('WMK')) return cID['Wmk Star Inc'];
  if (driverRaw.includes('Sant')) return cID['Sant Trans Inc'];
  if (driverRaw.includes('FFI')) return cID['FFI Trucking'];
  return cID['Independent / Other'];
}

function cleanDriver(raw) {
  if (!raw || raw === 'Assign Later') return null;
  return raw.replace(' FFI', '').replace(' WMK', '').replace(' Sant', '').trim();
}

// ── Load data ─────────────────────────────────────────────────────────────────
// columns: order#, driverRaw, pickupDate, pickupTime, deliveryDate, deliveryTime,
//          broker, pickupShipper, pickupCity, pickupState,
//          deliveryConsignee, deliveryCity, deliveryState, status
const loads = [
  // [order#, driver, pickupDate, pickupTime, delivDate, delivTime, broker, pickName, pickCity, pickSt, delivName, delivCity, delivSt, status]
  ['1487478','Gurdeep','2026-06-11','07:00 AM','2026-06-15','07:00 AM','Bennett International Logistics','ACS INTERNATIONAL PRODUCTS LP','Tucson','AZ','MPL (MARSTONE PRODUCTS)','Fairland','IN','dispatched'],
  ['1091924','Gurinder','2026-06-11','08:00 AM','2026-06-15','08:00 AM','Trident Transport LLC','voltage hq','Spokane Valley','WA','To Be Confirmed','Eastvale','CA','in_transit'],
  ['2997009','Sukhwinder Sant','2026-06-11','08:00 AM','2026-06-14','08:00 AM','Integrity Express Logistics','To Be Confirmed','Arrey','NM','To Be Confirmed','Goshen','NY','dispatched'],
  ['E976614','TAJINDER SAHOTA FFI','2026-06-11','08:00 AM','2026-06-15','09:00 AM','Mercer Transportation Co., Inc.','HBE SALT LAKE CITY NEW','Salt Lake City','UT','HBE - PLAINFIELD, IN - DC','Plainfield','IN','in_transit'],
  ['E976621','STEVEN DAVIS FFI','2026-06-11','08:00 AM','2026-06-15','08:00 AM','Mercer Transportation Co., Inc.','HBE SALT LAKE CITY NEW','Salt Lake City','UT','HBE - PLAINFIELD, IN - DC','Plainfield','IN','in_transit'],
  ['E976629','VISHAL FFI','2026-06-11','08:00 AM','2026-06-15','11:00 AM','Mercer Transportation Co., Inc.','HBE SALT LAKE CITY NEW','Salt Lake City','UT','HBE - PLAINFIELD, IN - DC','Plainfield','IN','in_transit'],
  ['169069','VISHAL FFI','2026-06-11','08:00 AM','2026-06-15','10:00 AM','PBLS LLC','Draper Incorporated','Spiceland','IN','ROWLAND HALL MS','Salt Lake City','UT','in_transit'],
  ['23277302','AMARJEET','2026-06-11','12:00 PM','2026-06-13','05:30 AM','RXO','NEWELL SERV CNTR','Victorville','CA','WALMART DC #6037','Hermiston','OR','pending'],
  ['S4040812','Amarpreet','2026-06-11','12:00 PM','2026-06-15','08:00 AM','Spot','The Chamberlain Group LLC','Tucson','AZ','The Chamberlain Group LLC','Woodinville','WA','pending'],
  ['A-646726','Lakhvir','2026-06-11','12:00 PM','2026-06-13','02:00 AM','Ally Logistics','WOODS DISTRIBUTION','Fort Worth','TX','TULLY DC','New York','NY','dispatched'],
  ['37092315','Raman','2026-06-12','01:00 PM','2026-06-15','07:00 AM','Total Quality Logistics','To Be Confirmed','Everett','WA','To Be Confirmed','Visalia','CA','in_transit'],
  ['138391','JAI KISHAN FFI','2026-06-12','05:00 AM','2026-06-15','10:30 AM','P Clark and Associates LLC','Grain Craft 84402','Ogden','UT','Cafe Valley','Marion','IN','in_transit'],
  ['710816','GAGANDEEP FFI','2026-06-12','08:00 AM','2026-06-15','11:00 AM','BMM Logistics','INTERMOUNTAIN','Payson','UT','Hanzo Logistics','Brownsburg','IN','in_transit'],
  ['31520-12038','RAHUL BHATIA FFI','2026-06-12','08:00 AM','2026-06-16','11:30 AM','RPM','AER-08858','West Valley','UT','HCL HOLLINGSWORTH CORE LOG-Q9XYC','Columbus','OH','in_transit'],
  ['A-647637','Jaspreet Raman WMK','2026-06-12','08:00 AM','2026-06-15','08:00 AM','Ally Logistics','SUMNER, WA (HOLMAN 3PL)','Sumner','WA','PERFECT 85 DEGREES C INC','Buena Park','CA','in_transit'],
  ['1599524','NK CHIKARA FFI','2026-06-12','09:00 AM','2026-06-15','06:00 AM','ROAR Logistics Inc - Intl','CAMPBELLS SNACKS','Plainfield','IN','PEPPERIDGE FARM INC.','North Logan','UT','in_transit'],
  ['556855141','Sanjeev Verma','2026-06-12','09:00 AM','2026-06-15','08:00 AM','C.H. Robinson Contract Addendum','PERFORMANCE Health Holdings','Indianapolis','IN','PERFORMANCE Health SL','Salt Lake City','UT','in_transit'],
  ['556856047','MANISH FFI','2026-06-12','09:00 AM','2026-06-15','08:00 AM','C.H. Robinson Contract Addendum','PERFORMANCE Health Holdings','Indianapolis','IN','PERFORMANCE Health SL','Salt Lake City','UT','in_transit'],
  ['220443','Rajhbir Singh','2026-06-12','10:00 AM','2026-06-16','02:00 PM','High Tide Logistics','CORPAK INC','Tulare','CA','DC FOREST PARK','Forest Park','GA','pending'],
  ['4402497-1','Sukhvinder Singh','2026-06-12','11:00 AM','2026-06-15','11:00 AM','Armstrong Transport Group LLC','GLENDALE DC CJ LOGISTICS','Glendale','AZ','WAL-MART DC 6037G','Hermiston','OR','in_transit'],
  // 0761567 and 1824108 already exist — skip
  ['113439','Amarpreet','2026-06-13','02:30 PM','2026-06-15','10:00 AM','Corcoran Logistics LLC','AMERICOLD CONNELL','Connell','WA','TRANSLOAD FWD (CALEXICO)','Calexico','CA','pending'],
  ['LD49786','GAGAN','2026-06-12','07:00 AM','2026-06-13','05:00 AM','GUYDLOGISTICS CORP','US-PL-MODESTO-CA-OUT','Modesto','CA','US-PL-CASA GRANDE-AZ-FLI','Casa Grande','AZ','in_transit'],
  ['23268225','Satvir','2026-06-12','08:00 AM','2026-06-16','08:00 PM','RXO Inc','To Be Confirmed','Vernon','CA','To Be Confirmed','Indianapolis','IN','pending'],
  ['32171797','MOHIT FFI','2026-06-12','03:00 PM','2026-06-15','02:00 AM','PLS SeRVICES','PCNA-SUNSWEET PA','Fleetwood','PA','GATORADE DC INDY CONNECT IN','Indianapolis','IN','in_transit'],
  ['711053','YADWINDER FFI','2026-06-12','03:00 PM','2026-06-15','08:00 AM','BMM Logistics','INTERMOUNTAIN','Payson','UT','Hanzo Logistics','Brownsburg','IN','in_transit'],
  // Future loads (Assign Later)
  ['138398','Assign Later','2026-06-15','05:00 AM','2026-06-17','','P Clark and Associates LLC','Grain Craft 84402','Ogden','UT','Cafe Valley','Marion','IN','pending'],
  ['138421','Assign Later','2026-06-17','05:00 AM','2026-06-19','','P Clark and Associates LLC','Grain Craft 84402','Ogden','UT','Cafe Valley','Marion','IN','pending'],
  ['67539752','Assign Later','2026-06-15','02:00 PM','2026-06-18','07:00 AM','Echo Transportation Simplified','Alta Salt Lake City','Salt Lake City','UT','Sojo','Whiteland','IN','pending'],
  ['67798738','Assign Later','2026-06-16','10:00 AM','2026-06-18','10:00 AM','Echo Transportation Simplified','INM: Indianapolis Mixing Ctr. - WH','Plainfield','IN','PEPPERIDGE LOGAN EAST - FG','Logan','UT','pending'],
  ['32180708','Assign Later','2026-06-15','07:00 PM','2026-06-18','08:00 AM','PLS SeRVICES','LIFETIME CHECK IN OFFICE','Clearfield','UT','Kokosing Construction','Millersport','OH','pending'],
  ['4338991','Assign Later','2026-06-15','07:00 AM','2026-06-17','11:00 AM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC ut','West Valley City','UT','pending'],
  ['4338995','Assign Later','2026-06-15','07:00 AM','2026-06-17','01:00 PM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC ut','West Valley City','UT','pending'],
  ['4339007','Assign Later','2026-06-16','07:00 AM','2026-06-18','11:00 AM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC ut','West Valley City','UT','pending'],
  ['4339029','Assign Later','2026-06-16','07:00 AM','2026-06-18','01:00 PM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC ut','West Valley City','UT','pending'],
  ['4342855','Assign Later','2026-06-29','07:00 AM','2026-07-01','07:00 AM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC ut','West Valley City','UT','pending'],
  ['4342856','Assign Later','2026-06-29','07:00 AM','2026-07-01','08:00 AM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC','West Valley City','UT','pending'],
  ['4342861','Assign Later','2026-06-30','07:00 AM','2026-07-02','07:00 AM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC ut','West Valley City','UT','pending'],
  ['4342862','Assign Later','2026-06-30','07:00 AM','2026-07-02','08:00 AM','Visual Pak Logistics, LLC','Thermoguard c/o MP GLOBAL','New Albany','IN','Tovala - SLC ut','West Valley City','UT','pending'],
];

const insertLoad = db.prepare(`
  INSERT OR IGNORE INTO loads (
    company_id, load_number, broker_name,
    pickup_name, pickup_city, pickup_state, pickup_date, pickup_time,
    delivery_name, delivery_city, delivery_state, delivery_date, delivery_time,
    driver_id, status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let inserted = 0;
for (const [ln, driverRaw, pd, pt, dd, dt, broker, pName, pCity, pSt, dName, dCity, dSt, status] of loads) {
  // Skip already existing loads
  const exists = db.prepare('SELECT id FROM loads WHERE load_number = ?').get(ln);
  if (exists) { console.log(`SKIP existing: ${ln}`); continue; }

  const companyId = resolveCompany(driverRaw);
  const driverClean = cleanDriver(driverRaw);
  const driverId = driverClean ? ensureDriver(driverClean, companyId) : null;

  insertLoad.run(companyId, ln, broker, pName, pCity, pSt, pd, pt, dName, dCity, dSt, dd, dt, driverId, status);
  console.log(`✓ ${ln} — ${driverClean || 'unassigned'} — ${broker}`);
  inserted++;
}

console.log(`\nDone. Inserted ${inserted} loads.`);
process.exit(0);
