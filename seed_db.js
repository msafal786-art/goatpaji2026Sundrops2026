// Run this once on Railway via Console: node seed_db.js
const db = require('./db');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
const statements = sql.split('\n').filter(l => l.trim() && !l.startsWith('--') && !l.startsWith('PRAGMA'));

let count = 0;
const run = db.transaction(() => {
  db.pragma('foreign_keys = OFF');
  for (const stmt of statements) {
    const s = stmt.trim();
    if (!s) continue;
    try { db.prepare(s).run(); count++; } catch(e) { console.error('Skip:', e.message.slice(0,80)); }
  }
  db.pragma('foreign_keys = ON');
});

run();
console.log(`Seeded ${count} rows. Done.`);
process.exit(0);
