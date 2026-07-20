#!/usr/bin/env node
// One-time Google Drive setup for the dispatch portal.
//
// Signs you in with your own Google account, creates a folder for the
// portal's documents, and prints the three Railway variables to set.
//
// Run:  GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node setup-drive.js
//
// Get the client id/secret from console.cloud.google.com:
//   APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
//   Application type: "Desktop app"

const http = require('http');
const fs = require('fs');
const { google } = require('googleapis');

// Credentials can come from the JSON Google gives you (easiest — no copying
// secrets by hand) or from environment variables.
//   node setup-drive.js ~/Downloads/client_secret_xxx.json
function fromJsonFile(pathArg) {
  try {
    const parsed = JSON.parse(fs.readFileSync(pathArg, 'utf8'));
    const c = parsed.installed || parsed.web || parsed;
    if (c.client_id && c.client_secret) {
      return { id: c.client_id, secret: c.client_secret };
    }
    console.error(`No client_id/client_secret found in ${pathArg}`);
  } catch (e) {
    console.error(`Could not read ${pathArg}: ${e.message}`);
  }
  return {};
}

const fileArg = process.argv[2];
const fromFile = fileArg ? fromJsonFile(fileArg) : {};
const CLIENT_ID = fromFile.id || process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = fromFile.secret || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;

// drive.file grants access only to files this app creates — it can never see
// the rest of your Drive. That's why we create our own folder below.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Missing OAuth client credentials.

1. Go to console.cloud.google.com -> APIs & Services -> Library
   Enable "Google Drive API".
2. APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
   Application type: Desktop app
3. Download the JSON and pass it in:

   node setup-drive.js ~/Downloads/client_secret_xxx.json

   (or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET instead)
`);
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',       // required to receive a refresh token
  prompt: 'consent',            // force a refresh token even on re-runs
  scope: SCOPES,
});

console.log('\nOpen this URL in your browser and approve access:\n');
console.log(authUrl);
console.log('\nWaiting for you to finish in the browser…\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end(`Authorization failed: ${error}. You can close this tab.`);
    console.error(`\nAuthorization failed: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code) { res.end('Waiting for authorization…'); return; }

  res.end('Done — you can close this tab and return to the terminal.');
  server.close();

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      console.error('\nNo refresh token returned. Revoke the app at ' +
        'myaccount.google.com/permissions and run this again.');
      process.exit(1);
    }
    oauth2.setCredentials(tokens);

    // Create a dedicated folder so uploads are tidy and the narrow
    // drive.file scope is sufficient to write into it.
    const drive = google.drive({ version: 'v3', auth: oauth2 });
    const folder = await drive.files.create({
      requestBody: {
        name: 'Dispatch Portal Documents',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id, name',
    });

    console.log(`
Success. Created the folder "${folder.data.name}" in your Drive.

Set these three variables on Railway (service -> Variables), then redeploy:

  GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}
  GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}
  GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}
  GOOGLE_DRIVE_FOLDER_ID=${folder.data.id}

Keep the refresh token secret — it grants access to files this app creates.
`);
    process.exit(0);
  } catch (e) {
    console.error('\nToken exchange failed:', e.message);
    process.exit(1);
  }
});

server.listen(PORT);
