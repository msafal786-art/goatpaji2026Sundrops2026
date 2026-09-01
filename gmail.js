// ── Gmail integration client ─────────────────────────────────────────────────
//
// Read-only access to a single connected mailbox (the Goat Inc inbox) so the
// portal can show broker communication in one place. Uses the OAuth 2.0 + Gmail
// REST API directly (no SDK) to keep dependencies light.
//
// Scope: https://www.googleapis.com/auth/gmail.readonly  (restricted scope —
// the connected Google account must be a Test user on the OAuth consent screen
// until the app is verified; testing-mode refresh tokens expire ~weekly).
//
// Credentials come from env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. The redirect
// URI is derived from APP_BASE_URL (default https://goatpaji.com).

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function baseUrl() {
  return (process.env.APP_BASE_URL || 'https://goatpaji.com').replace(/\/+$/, '');
}
function redirectUri() {
  return `${baseUrl()}/api/gmail/callback`;
}
function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

class GmailError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

// The Google consent URL. `state` is an opaque value we round-trip to defend the
// callback against CSRF. access_type=offline + prompt=consent guarantee a
// refresh_token is issued on first connect.
function buildAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

// Exchange the one-time auth code for tokens (includes the long-lived refresh_token).
async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GmailError(data.error_description || data.error || 'token exchange failed', 'auth');
  return data; // { access_token, refresh_token, expires_in, ... }
}

// Trade the refresh_token for a fresh access token.
async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant => the refresh token was revoked or expired (testing-mode 7-day rule)
    const kind = data.error === 'invalid_grant' ? 'reauth' : 'auth';
    throw new GmailError(data.error_description || data.error || 'token refresh failed', kind);
  }
  return data; // { access_token, expires_in, ... }
}

async function apiGet(accessToken, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GmailError(data.error?.message || `Gmail API ${res.status}`, res.status === 401 ? 'reauth' : 'api');
  return data;
}

// List message ids matching a Gmail search query (e.g. 'newer_than:30d -in:chats').
async function listMessageIds(accessToken, q, maxResults = 50) {
  const p = new URLSearchParams({ q: q || '', maxResults: String(maxResults) });
  const data = await apiGet(accessToken, `/messages?${p.toString()}`);
  return (data.messages || []).map(m => ({ id: m.id, threadId: m.threadId }));
}

function headerVal(headers, name) {
  const h = (headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// Recursively pull the best text body out of a MIME payload, and note attachments.
function extractBody(payload) {
  let text = '';
  let html = '';
  const attachments = [];
  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    if (part.filename && part.body?.attachmentId) {
      attachments.push({ filename: part.filename, mimeType: mime, size: part.body.size || 0, attachmentId: part.body.attachmentId });
    }
    if (mime === 'text/plain' && part.body?.data) text += decodeB64(part.body.data);
    else if (mime === 'text/html' && part.body?.data) html += decodeB64(part.body.data);
    (part.parts || []).forEach(walk);
  }
  walk(payload);
  if (!text && html) text = stripHtml(html);
  return { text: text.trim(), attachments };
}

function decodeB64(data) {
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}
function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// Fetch one full message and normalize it to the shape we store.
async function getMessage(accessToken, id) {
  const m = await apiGet(accessToken, `/messages/${id}?format=full`);
  const headers = m.payload?.headers || [];
  const { text, attachments } = extractBody(m.payload);
  const from = parseAddress(headerVal(headers, 'From'));
  const to = headerVal(headers, 'To');
  return {
    gmail_id: m.id,
    thread_id: m.threadId,
    from_name: from.name,
    from_email: from.email,
    to_email: to,
    subject: headerVal(headers, 'Subject'),
    snippet: m.snippet || '',
    body_text: text,
    internal_date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    label_ids: m.labelIds || [],
    has_attachments: attachments.length > 0,
    attachments,
  };
}

// Download one attachment's bytes. Returns a Buffer.
async function getAttachment(accessToken, messageId, attachmentId) {
  const data = await apiGet(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  if (!data.data) throw new GmailError('attachment had no data', 'api');
  return Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// "Name <email@x.com>" → { name, email }
function parseAddress(raw) {
  if (!raw) return { name: '', email: '' };
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: raw.trim().toLowerCase() };
}

module.exports = {
  SCOPE, isConfigured, redirectUri, baseUrl,
  buildAuthUrl, exchangeCode, refreshAccessToken,
  listMessageIds, getMessage, getAttachment, parseAddress, GmailError,
};
