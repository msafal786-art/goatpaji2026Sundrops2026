// Google Drive helper — used only when GOOGLE_SERVICE_ACCOUNT_JSON is set.
// Falls back silently to local disk if not configured or if Drive fails.
const { google } = require('googleapis');
const fs = require('fs');

let _drive = null;

function getClient() {
  if (_drive) return _drive;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const credentials = JSON.parse(raw);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    _drive = google.drive({ version: 'v3', auth });
    console.log('[drive] Google Drive client ready');
    return _drive;
  } catch (e) {
    console.error('[drive] Init failed:', e.message);
    return null;
  }
}

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

// Upload a local file path to Drive. Returns Drive file ID or null on failure.
async function upload(localPath, originalName, mimeType) {
  const drive = getClient();
  if (!drive) return null;
  try {
    const res = await drive.files.create({
      requestBody: {
        name: originalName,
        parents: FOLDER_ID ? [FOLDER_ID] : [],
      },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: fs.createReadStream(localPath),
      },
      fields: 'id',
    });
    return res.data.id;
  } catch (e) {
    console.error('[drive] Upload error:', e.message);
    return null;
  }
}

// Stream a Drive file into an Express response stream.
// Returns true on success, false if Drive unavailable or error.
async function download(fileId, destStream) {
  const drive = getClient();
  if (!drive) return false;
  try {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    await new Promise((resolve, reject) =>
      res.data.on('end', resolve).on('error', reject).pipe(destStream, { end: false })
    );
    return true;
  } catch (e) {
    console.error('[drive] Download error:', e.message);
    return false;
  }
}

// Delete a file from Drive (best-effort, no throw).
async function remove(fileId) {
  const drive = getClient();
  if (!drive || !fileId) return;
  try { await drive.files.delete({ fileId }); } catch {}
}

module.exports = { upload, download, remove, isEnabled: () => !!getClient() };
