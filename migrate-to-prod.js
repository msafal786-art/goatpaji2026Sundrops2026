#!/usr/bin/env node
// One-time migration: push all local loads/drivers/companies to production.
//
// Credentials are NEVER hardcoded here — pass them in the environment:
//   PROD_USER=dispatcher PROD_PASS='…' PROD_ADMIN_CODE='…' node migrate-to-prod.js

const db = require('./db.js')

const PROD = process.env.PROD_URL || 'https://goatpaji.com'
const CREDS = {
  username: process.env.PROD_USER,
  password: process.env.PROD_PASS,
  admin_code: process.env.PROD_ADMIN_CODE,
}

if (!CREDS.username || !CREDS.password) {
  console.error('Missing credentials. Run with:')
  console.error("  PROD_USER=dispatcher PROD_PASS='…' PROD_ADMIN_CODE='…' node migrate-to-prod.js")
  process.exit(1)
}

async function req(method, path, body, token) {
  const res = await fetch(PROD + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

async function main() {
  console.log('Logging in to production...')
  const { token } = await req('POST', '/login', CREDS)
  if (!token) { console.error('Login failed'); process.exit(1) }
  console.log('Logged in.')

  // ── 1. Sync companies ──────────────────────────────────────────────────────
  console.log('\n── Companies ──')
  const prodCompanies = await req('GET', '/companies', null, token)
  const prodCompanyByName = {}
  for (const c of prodCompanies) prodCompanyByName[c.name.trim().toLowerCase()] = c.id

  const localCompanies = db.prepare('SELECT * FROM companies').all()
  const companyIdMap = {} // local id → prod id
  for (const c of localCompanies) {
    const key = c.name.trim().toLowerCase()
    if (prodCompanyByName[key]) {
      companyIdMap[c.id] = prodCompanyByName[key]
      console.log(`  ✓ exists: ${c.name}`)
    } else {
      const created = await req('POST', '/companies', {
        name: c.name, mc_number: c.mc_number, dot_number: c.dot_number,
        address: c.address, phone: c.phone, email: c.email
      }, token)
      companyIdMap[c.id] = created.id
      console.log(`  + created: ${c.name} → id ${created.id}`)
    }
  }

  // ── 2. Sync drivers ────────────────────────────────────────────────────────
  console.log('\n── Drivers ──')
  const prodDrivers = await req('GET', '/drivers', null, token)
  const prodDriverByKey = {}
  for (const d of prodDrivers) {
    const key = d.full_name.trim().toLowerCase()
    prodDriverByKey[key] = d.id
  }

  const localDrivers = db.prepare('SELECT * FROM drivers').all()
  const driverIdMap = {} // local id → prod id
  for (const d of localDrivers) {
    const key = d.full_name.trim().toLowerCase()
    if (prodDriverByKey[key]) {
      driverIdMap[d.id] = prodDriverByKey[key]
      console.log(`  ✓ exists: ${d.full_name}`)
    } else {
      const body = {
        full_name: d.full_name, phone: d.phone, email: d.email,
        license_number: d.license_number, license_expiry: d.license_expiry,
        medical_card_expiry: d.medical_card_expiry, notes: d.notes,
        company_id: companyIdMap[d.company_id] || null,
        status: d.status || 'available'
      }
      const created = await req('POST', '/drivers', body, token)
      driverIdMap[d.id] = created.id
      console.log(`  + created: ${d.full_name} → id ${created.id}`)
    }
  }

  // ── 3. Sync loads ──────────────────────────────────────────────────────────
  console.log('\n── Loads ──')
  const prodLoads = await req('GET', '/loads', null, token)
  const prodLoadNums = new Set(prodLoads.map(l => l.load_number).filter(Boolean))
  const prodLoadKeys = new Set(
    prodLoads.map(l => `${l.broker_order}|${l.pickup_date}|${l.delivery_date}`)
  )

  const localLoads = db.prepare('SELECT * FROM loads ORDER BY id').all()
  let created = 0, skipped = 0, failed = 0

  for (const l of localLoads) {
    const dedupKey = `${l.broker_order}|${l.pickup_date}|${l.delivery_date}`
    if ((l.load_number && prodLoadNums.has(l.load_number)) || prodLoadKeys.has(dedupKey)) {
      skipped++
      continue
    }

    const body = {
      company_id: companyIdMap[l.company_id] || null,
      load_number: l.load_number, broker_name: l.broker_name,
      broker_order: l.broker_order, broker_contact: l.broker_contact,
      broker_email: l.broker_email, commodity: l.commodity,
      weight: l.weight, miles: l.miles, trailer_type: l.trailer_type,
      bol: l.bol, rate: l.rate,
      pickup_name: l.pickup_name, pickup_address: l.pickup_address,
      pickup_city: l.pickup_city, pickup_state: l.pickup_state,
      pickup_zip: l.pickup_zip, pickup_date: l.pickup_date,
      pickup_time: l.pickup_time, pickup_phone: l.pickup_phone,
      pickup_refs: l.pickup_refs,
      delivery_name: l.delivery_name, delivery_address: l.delivery_address,
      delivery_city: l.delivery_city, delivery_state: l.delivery_state,
      delivery_zip: l.delivery_zip, delivery_date: l.delivery_date,
      delivery_time: l.delivery_time, delivery_phone: l.delivery_phone,
      delivery_refs: l.delivery_refs,
      special_instructions: l.special_instructions,
      driver_id: driverIdMap[l.driver_id] || null,
      truck_id: null, // trucks not migrated to avoid conflicts
      status: l.status || 'pending',
      dispatch_sent: l.dispatch_sent || 0
    }

    const result = await req('POST', '/loads', body, token)
    if (result && result.id) {
      created++
      if (created % 50 === 0) console.log(`  ... ${created} loads created so far`)
    } else {
      failed++
      console.error(`  ✗ failed load ${l.id}:`, result)
    }
  }

  console.log(`\n✅ Done!`)
  console.log(`   Loads created: ${created}`)
  console.log(`   Loads skipped (already existed): ${skipped}`)
  console.log(`   Failed: ${failed}`)

  // ── 4. Final count ─────────────────────────────────────────────────────────
  const finalLoads = await req('GET', '/loads', null, token)
  console.log(`\n   Production now has ${finalLoads.length} loads`)
}

main().catch(console.error)
