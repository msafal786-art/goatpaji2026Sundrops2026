#!/usr/bin/env node
// Move documents that predate Drive mirroring off the local volume.
//
// For every load/truck document that has a local file but no Drive copy:
// upload it, record the Drive id, then delete the local file. Verifies the
// Drive id was returned before deleting anything — a failed upload leaves the
// local file exactly as it was, so a rerun picks it up.
//
//   node migrate-docs-to-drive.js --dry-run   (report only, change nothing)
//   node migrate-docs-to-drive.js

const fs = require('fs');
const path = require('path');
const db = require('./db.js');
const drive = require('./drive.js');

const DRY = process.argv.includes('--dry-run');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

const MIME = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.heic': 'image/heic', '.heif': 'image/heif',
};
const mimeFor = (name) => MIME[path.extname(name || '').toLowerCase()] || 'application/octet-stream';

async function migrateTable(table) {
  const rows = db.prepare(
    `SELECT id, original_name, filename, drive_file_id FROM ${table} WHERE drive_file_id IS NULL`
  ).all();

  let moved = 0, missing = 0, failed = 0;
  for (const row of rows) {
    const localPath = path.join(UPLOADS_DIR, row.filename || '');
    if (!row.filename || !fs.existsSync(localPath)) { missing++; continue; }

    if (DRY) { console.log(`  would upload: ${row.original_name}`); moved++; continue; }

    const driveId = await drive.upload(localPath, row.original_name || row.filename, mimeFor(row.original_name));
    if (!driveId) { console.error(`  FAILED (kept locally): ${row.original_name}`); failed++; continue; }

    db.prepare(`UPDATE ${table} SET drive_file_id = ? WHERE id = ?`).run(driveId, row.id);
    try { fs.unlinkSync(localPath); } catch (e) {
      console.error(`  uploaded but local cleanup failed for ${row.original_name}: ${e.message}`);
    }
    moved++;
    console.log(`  moved: ${row.original_name}`);
  }
  return { total: rows.length, moved, missing, failed };
}

(async () => {
  if (!drive.isEnabled()) {
    console.error('Drive is not configured — set the GOOGLE_OAUTH_* variables first.');
    process.exit(1);
  }
  console.log(`Drive mode: ${drive.mode()}${DRY ? '  (DRY RUN — nothing will change)' : ''}`);
  console.log(`Uploads dir: ${UPLOADS_DIR}\n`);

  for (const table of ['load_docs', 'truck_docs']) {
    console.log(`${table}:`);
    const r = await migrateTable(table);
    console.log(`  → ${r.moved} moved, ${r.missing} with no local file, ${r.failed} failed (of ${r.total} without a Drive copy)\n`);
  }

  // Anything left in uploads/ that no document row points at is stale scratch
  // (abandoned drop-box staging, deleted docs) — report it, don't touch it.
  try {
    const referenced = new Set([
      ...db.prepare('SELECT filename FROM load_docs').all(),
      ...db.prepare('SELECT filename FROM truck_docs').all(),
    ].map(r => r.filename));
    const orphans = fs.readdirSync(UPLOADS_DIR).filter(f => !referenced.has(f));
    if (orphans.length) {
      const bytes = orphans.reduce((sum, f) => {
        try { return sum + fs.statSync(path.join(UPLOADS_DIR, f)).size } catch { return sum }
      }, 0);
      console.log(`${orphans.length} unreferenced file(s) in uploads/ (${(bytes / 1048576).toFixed(1)} MB) — not linked to any document, left alone.`);
    }
  } catch {}
  process.exit(0);
})();
