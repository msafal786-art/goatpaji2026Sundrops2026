// ── Weekly carrier summary ───────────────────────────────────────────────────
// One email per carrier, to that carrier's owner / carrier admins: last week's
// loads and revenue, drivers that sat idle, and the paperwork and expiries that
// need attention. buildSummary() gathers the numbers (also used for the in-app
// preview), renderSummaryHtml() lays them out as an email-safe HTML page, and
// sendMail() delivers through SMTP when SMTP_* env vars are set.
//
// The "week" is the last full Mon–Sun, in America/Chicago (the dispatch office).

const nodemailer = require('nodemailer');

const TZ = 'America/Chicago';

// YYYY-MM-DD for a Date, as seen in the office's timezone.
function ymd(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The last complete Mon–Sun before `now` → { start, end } inclusive.
function lastWeek(now = new Date()) {
  const today = ymd(now);
  const dow = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 Sun … 6 Sat
  const thisMonday = addDays(today, -((dow + 6) % 7));
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}

const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; };

function buildSummary(db, companyId, { canRevenue = true, now = new Date() } = {}) {
  const company = db.prepare('SELECT id, name FROM companies WHERE id = ?').get(companyId);
  if (!company) return null;
  const wk = lastWeek(now);
  const prev = { start: addDays(wk.start, -7), end: addDays(wk.end, -7) };
  const today = ymd(now);

  const delivered = (range) => db.prepare(`
    SELECT l.id, l.load_number, l.broker_order, l.broker_name, l.rate, l.miles, l.driver_id,
           d.full_name AS driver_name
    FROM loads l LEFT JOIN drivers d ON d.id = l.driver_id
    WHERE l.company_id = ? AND l.status IN ('delivered','completed')
      AND l.delivery_date BETWEEN ? AND ?`).all(companyId, range.start, range.end);

  const wkLoads = delivered(wk);
  const prevLoads = delivered(prev);
  const revenue = wkLoads.reduce((s, l) => s + num(l.rate), 0);
  const prevRevenue = prevLoads.reduce((s, l) => s + num(l.rate), 0);
  const miles = wkLoads.reduce((s, l) => s + num(l.miles), 0);

  const count = (sql, ...p) => db.prepare(sql).get(companyId, ...p).n;
  const pickedUp = count(`SELECT COUNT(*) n FROM loads WHERE company_id = ? AND pickup_date BETWEEN ? AND ? AND status != 'cancelled'`, wk.start, wk.end);
  const cancelled = count(`SELECT COUNT(*) n FROM loads WHERE company_id = ? AND status = 'cancelled' AND pickup_date BETWEEN ? AND ?`, wk.start, wk.end);
  const upcoming = count(`SELECT COUNT(*) n FROM loads WHERE company_id = ? AND status NOT IN ('delivered','completed','cancelled') AND pickup_date BETWEEN ? AND ?`, today, addDays(today, 7));
  const needDriver = count(`SELECT COUNT(*) n FROM loads WHERE company_id = ? AND status IN ('open','covered') AND driver_id IS NULL AND pickup_date BETWEEN ? AND ?`, today, addDays(today, 7));

  // Per-driver: loads & revenue delivered last week.
  const byDriver = {};
  for (const l of wkLoads) {
    const k = l.driver_name || 'Unassigned';
    byDriver[k] = byDriver[k] || { driver: k, loads: 0, revenue: 0, miles: 0 };
    byDriver[k].loads++; byDriver[k].revenue += num(l.rate); byDriver[k].miles += num(l.miles);
  }
  const drivers = Object.values(byDriver).sort((a, b) => b.revenue - a.revenue);

  // Idle: active drivers with no load touching last week at all.
  const idleDrivers = db.prepare(`
    SELECT d.full_name FROM drivers d
    WHERE d.company_id = ? AND COALESCE(d.is_active, 1) = 1
      AND NOT EXISTS (SELECT 1 FROM loads l WHERE l.driver_id = d.id AND l.status != 'cancelled'
                      AND (l.pickup_date BETWEEN ? AND ? OR l.delivery_date BETWEEN ? AND ?
                           OR (l.pickup_date < ? AND l.delivery_date > ?)))
    ORDER BY d.full_name`).all(companyId, wk.start, wk.end, wk.start, wk.end, wk.start, wk.end).map(r => r.full_name);
  const trucksDown = db.prepare(`SELECT tractor_number FROM trucks WHERE company_id = ? AND status = 'maintenance' ORDER BY tractor_number`)
    .all(companyId).map(r => r.tractor_number);

  // Needs attention
  const missingPod = db.prepare(`
    SELECT l.id, COALESCE(l.load_number, l.broker_order, '#' || l.id) AS ref, l.broker_name, l.delivery_date
    FROM loads l
    WHERE l.company_id = ? AND l.status IN ('delivered','completed') AND l.delivery_date >= ?
      AND NOT EXISTS (SELECT 1 FROM load_docs ld WHERE ld.load_id = l.id AND ld.doc_type = 'POD')
    ORDER BY l.delivery_date DESC`).all(companyId, addDays(today, -14));
  const notInvoiced = db.prepare(`
    SELECT COALESCE(l.load_number, l.broker_order, '#' || l.id) AS ref, l.broker_name, l.delivery_date, l.rate
    FROM loads l WHERE l.company_id = ? AND l.status = 'delivered' AND l.delivery_date <= ?
    ORDER BY l.delivery_date`).all(companyId, addDays(today, -3));

  const soon = addDays(today, 30);
  const expiries = [];
  for (const d of db.prepare(`SELECT full_name, license_expiry, medical_card_expiry, drug_test_expiry FROM drivers
                              WHERE company_id = ? AND COALESCE(is_active, 1) = 1`).all(companyId)) {
    for (const [col, label] of [['license_expiry', 'CDL'], ['medical_card_expiry', 'Medical card'], ['drug_test_expiry', 'Drug test']]) {
      if (d[col] && d[col] <= soon) expiries.push({ who: d.full_name, what: label, date: d[col] });
    }
  }
  for (const t of db.prepare(`SELECT tractor_number, registration_expiry, insurance_expiry FROM trucks WHERE company_id = ?`).all(companyId)) {
    for (const [col, label] of [['registration_expiry', 'Registration'], ['insurance_expiry', 'Insurance']]) {
      if (t[col] && t[col] <= soon) expiries.push({ who: `Truck ${t.tractor_number}`, what: label, date: t[col] });
    }
  }
  for (const m of db.prepare(`SELECT t.tractor_number, m.service_type, m.next_due_date FROM maintenance_records m
                              JOIN trucks t ON t.id = m.truck_id
                              WHERE m.company_id = ? AND m.next_due_date IS NOT NULL AND m.next_due_date <= ?`).all(companyId, addDays(today, 14))) {
    expiries.push({ who: `Truck ${m.tractor_number}`, what: `${m.service_type} due`, date: m.next_due_date });
  }
  expiries.sort((a, b) => a.date.localeCompare(b.date));
  expiries.forEach(e => { e.overdue = e.date < today; });

  return {
    company, week: wk, today, canRevenue,
    loads: { delivered: wkLoads.length, prevDelivered: prevLoads.length, pickedUp, cancelled, upcoming, needDriver, miles },
    revenue: canRevenue ? { total: revenue, prev: prevRevenue, perMile: miles ? revenue / miles : 0 } : null,
    drivers: drivers.map(d => canRevenue ? d : { ...d, revenue: undefined }),
    idleDrivers, trucksDown,
    attention: {
      missingPod,
      notInvoiced: notInvoiced.map(l => canRevenue ? l : { ...l, rate: undefined }),
      expiries,
    },
  };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = s => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

// Email-client-safe HTML: tables + inline styles only.
function renderSummaryHtml(s, { portalUrl = 'https://goatpaji.com' } = {}) {
  const C = { text: '#1c1c1e', mute: '#6e6e73', line: '#e5e5ea', bg: '#f5f5f7', blue: '#0a84ff', green: '#248a3d', red: '#d70015', orange: '#c93400' };
  const delta = (cur, prev, fmt) => {
    if (!prev) return '';
    const pct = Math.round(((cur - prev) / prev) * 100);
    const col = pct >= 0 ? C.green : C.red;
    return `<div style="font-size:12px;color:${col};margin-top:2px">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${fmt(prev)}</div>`;
  };
  const tile = (label, value, sub = '') => `
    <td style="padding:12px 14px;background:#fff;border:1px solid ${C.line};border-radius:10px;vertical-align:top">
      <div style="font-size:11px;color:${C.mute};text-transform:uppercase;letter-spacing:.5px">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${C.text};margin-top:4px">${value}</div>${sub}
    </td>`;
  const section = (title, body) => `
    <tr><td style="padding:22px 0 8px;font-size:15px;font-weight:700;color:${C.text}">${title}</td></tr>
    <tr><td>${body}</td></tr>`;
  const table = (heads, rows) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid ${C.line};font-size:13px">
      <tr>${heads.map((h, i) => `<th align="${i ? 'right' : 'left'}" style="padding:8px 10px;border-bottom:1px solid ${C.line};color:${C.mute};font-weight:600;font-size:11px;text-transform:uppercase">${h}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map((c, i) => `<td align="${i ? 'right' : 'left'}" style="padding:8px 10px;border-bottom:1px solid ${C.line};color:${C.text}">${c}</td>`).join('')}</tr>`).join('')}
    </table>`;
  const list = (items) => `<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ${C.line};font-size:13px">
      ${items.map(i => `<tr><td style="padding:8px 10px;border-bottom:1px solid ${C.line};color:${C.text}">${i}</td></tr>`).join('')}</table>`;
  const ok = (t) => `<div style="font-size:13px;color:${C.green};padding:4px 0">✓ ${t}</div>`;

  const L = s.loads, a = s.attention;
  const tiles = [
    tile('Loads delivered', L.delivered, delta(L.delivered, L.prevDelivered, v => `${v}`)),
    ...(s.revenue ? [tile('Revenue', money(s.revenue.total), delta(s.revenue.total, s.revenue.prev, money)),
                     tile('Rate / mile', s.revenue.perMile ? '$' + s.revenue.perMile.toFixed(2) : '—', `<div style="font-size:12px;color:${C.mute};margin-top:2px">${Math.round(L.miles).toLocaleString()} mi</div>`)]
                   : [tile('Miles', Math.round(L.miles).toLocaleString())]),
  ];

  const driverRows = s.drivers.map(d => [esc(d.driver), d.loads, Math.round(d.miles).toLocaleString(), ...(s.revenue ? [money(d.revenue)] : [])]);
  const attnCount = a.missingPod.length + a.notInvoiced.length + a.expiries.length;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(s.company.name)} — weekly summary</title></head>
<body style="margin:0;background:${C.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px">
  <tr><td style="font-size:12px;color:${C.mute};text-transform:uppercase;letter-spacing:.6px">Weekly summary · ${fmtDate(s.week.start)} – ${fmtDate(s.week.end)}</td></tr>
  <tr><td style="font-size:24px;font-weight:800;color:${C.text};padding:4px 0 16px">${esc(s.company.name)}</td></tr>
  <tr><td><table width="100%" cellpadding="0" cellspacing="8" style="margin:0 -8px"><tr>${tiles.join('')}</tr></table></td></tr>
  <tr><td style="font-size:13px;color:${C.mute};padding:10px 0 0">
    ${L.pickedUp} picked up last week${L.cancelled ? ` · ${L.cancelled} cancelled` : ''} · <b style="color:${C.text}">${L.upcoming}</b> booked for the next 7 days${L.needDriver ? ` · <b style="color:${C.orange}">${L.needDriver} still need a driver</b>` : ''}
  </td></tr>

  ${section('Drivers', driverRows.length
      ? table(['Driver', 'Loads', 'Miles', ...(s.revenue ? ['Revenue'] : [])], driverRows)
      : `<div style="font-size:13px;color:${C.mute}">No loads delivered last week.</div>`)}
  ${s.idleDrivers.length ? `<tr><td style="font-size:13px;color:${C.orange};padding:8px 0 0"><b>Idle all week:</b> ${s.idleDrivers.map(esc).join(', ')}</td></tr>` : ''}
  ${s.trucksDown.length ? `<tr><td style="font-size:13px;color:${C.orange};padding:4px 0 0"><b>In maintenance:</b> ${s.trucksDown.map(t => 'Truck ' + esc(t)).join(', ')}</td></tr>` : ''}

  ${section(`Needs attention${attnCount ? ` (${attnCount})` : ''}`,
    (attnCount === 0 ? ok('Nothing outstanding — paperwork and expiries are all in order.') : '') +
    (a.missingPod.length ? `<div style="font-size:12px;font-weight:700;color:${C.mute};margin:8px 0 4px">DELIVERED IN THE LAST 2 WEEKS, NO POD UPLOADED (${a.missingPod.length})</div>` +
      list(a.missingPod.slice(0, 10).map(l => `<a href="${portalUrl}/loads/${l.id}" style="color:${C.blue};text-decoration:none">${esc(l.ref)}</a> · ${esc(l.broker_name || '')} · delivered ${fmtDate(l.delivery_date)}`)
        .concat(a.missingPod.length > 10 ? [`<span style="color:${C.mute}">+ ${a.missingPod.length - 10} more — see Loads in the portal</span>`] : [])) : '') +
    (a.notInvoiced.length ? `<div style="font-size:12px;font-weight:700;color:${C.mute};margin:12px 0 4px">DELIVERED 3+ DAYS AGO, NOT YET INVOICED</div>` +
      list(a.notInvoiced.map(l => `${esc(l.ref)} · ${esc(l.broker_name || '')} · ${fmtDate(l.delivery_date)}${l.rate !== undefined && s.revenue ? ` · ${money(num(l.rate))}` : ''}`)) : '') +
    (a.expiries.length ? `<div style="font-size:12px;font-weight:700;color:${C.mute};margin:12px 0 4px">EXPIRING / DUE SOON</div>` +
      list(a.expiries.map(e => `<span style="color:${e.overdue ? C.red : C.text}">${esc(e.who)} — ${esc(e.what)} ${e.overdue ? '<b>overdue</b> since' : 'on'} ${fmtDate(e.date)}</span>`)) : '')
  )}

  <tr><td style="padding:26px 0 8px"><a href="${portalUrl}/dashboard" style="display:inline-block;background:${C.blue};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:9px">Open the portal</a></td></tr>
  <tr><td style="font-size:11px;color:${C.mute};padding:8px 0">Sent every Monday morning. You can turn this email off under Settings in the portal.</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Delivery ─────────────────────────────────────────────────────────────────
let transport = null;
function mailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function getTransport() {
  if (!mailConfigured()) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}
async function sendMail({ to, subject, html }) {
  const t = getTransport();
  if (!t) throw new Error('Email is not set up (SMTP_HOST / SMTP_USER / SMTP_PASS)');
  return t.sendMail({
    from: process.env.SUMMARY_FROM || process.env.SMTP_USER,
    to, subject, html,
    ...(process.env.SUMMARY_BCC ? { bcc: process.env.SUMMARY_BCC } : {}),
  });
}

module.exports = { buildSummary, renderSummaryHtml, lastWeek, ymd, mailConfigured, sendMail, TZ };
