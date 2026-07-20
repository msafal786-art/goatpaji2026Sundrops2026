// Google Drive mirror for uploaded documents.
//
// Two auth modes, tried in order:
//   1. OAuth as a real Google account (GOOGLE_OAUTH_CLIENT_ID / _SECRET /
//      _REFRESH_TOKEN). Files are owned by that account and use its storage.
//      This is the mode to use with a personal gmail.com account.
//   2. Service account (GOOGLE_SERVICE_ACCOUNT_JSON). Only works against a
//      Workspace Shared Drive — service accounts have no storage quota of
//      their own, so uploading into a personal Drive folder fails.
//
// If neither is configured, every call is a no-op and the portal just keeps
// files on local disk. Drive is a mirror, never the only copy.
const { google } = require('googleapis');
const fs = require('fs');

let _drive = null;
let _mode = null;

function getClient() {
  if (_drive) return _drive;

  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } = process.env;
  if (GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN) {
    try {
      const auth = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET);
      // The library exchanges this for a fresh access token as needed.
      auth.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
      _drive = google.drive({ version: 'v3', auth });
      _mode = 'oauth';
      console.log('[drive] Ready (OAuth — files owned by your Google account)');
      return _drive;
    } catch (e) {
      console.error('[drive] OAuth init failed:', e.message);
    }
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const credentials = JSON.parse(raw);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      _drive = google.drive({ version: 'v3', auth });
      _mode = 'service_account';
      console.log('[drive] Ready (service account — requires a Workspace Shared Drive)');
      return _drive;
    } catch (e) {
      console.error('[drive] Service account init failed:', e.message);
    }
  }

  return null;
}

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

// Upload a local file to Drive. Returns the Drive file ID, or null on any
// failure — callers treat Drive as best-effort and keep the local copy.
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
      supportsAllDrives: true,
    });
    return res.data.id;
  } catch (e) {
    // The classic misconfiguration — spell out the fix rather than a raw 403.
    if (/storage quota/i.test(e.message || '') && _mode === 'service_account') {
      console.error('[drive] Upload failed: service accounts have no storage quota. ' +
        'Use a Workspace Shared Drive, or switch to OAuth (see setup-drive.js).');
    } else {
      console.error('[drive] Upload error:', e.message);
    }
    return null;
  }
}

// Stream a Drive file into an Express response.
async function download(fileId, destStream) {
  const drive = getClient();
  if (!drive) return false;
  try {
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
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

// Best-effort delete; never throws.
async function remove(fileId) {
  const drive = getClient();
  if (!drive || !fileId) return;
  try { await drive.files.delete({ fileId, supportsAllDrives: true }); } catch {}
}

module.exports = { upload, download, remove, isEnabled: () => !!getClient(), mode: () => _mode };
