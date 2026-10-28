// Google Drive for the owner: "Save to Drive" on Admin → README uploads the private README as a PDF
// with page numbers. Uses the same Google OAuth app as sign-in (GOOGLE_CLIENT_ID / SECRET) with the
// narrow drive.file scope: QuantPocket can only see and change the files it created itself.
// Add PUBLIC_URL/oauth/google-drive/callback to the OAuth client's authorized redirect URIs.
import crypto from 'node:crypto';
import { siteGet, siteSet } from './site.js';
import { encrypt, tryDecrypt } from './crypto.js';
import { now } from './db.js';

const env = k => process.env[k] || '';
const AUTH_URL = () => env('GOOGLE_AUTH_URL') || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => env('GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token';
const UPLOAD = () => env('GOOGLE_DRIVE_UPLOAD_URL') || 'https://www.googleapis.com/upload/drive/v3/files';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const driveReady = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
const redirectUri = () => (env('PUBLIC_URL') || 'http://localhost:3000').replace(/\/$/, '') + '/oauth/google-drive/callback';
const states = new Map(); // state -> { userId, at }

export const status = () => { const d = siteGet('drive', null); return { ready: driveReady(), connected: !!d?.refresh, connectedAt: d?.at || null, fileId: d?.fileId || null, link: d?.link || null, savedAt: d?.savedAt || null, redirectUri: redirectUri() }; };
export function authUrl(userId) {
  const state = crypto.randomBytes(18).toString('base64url');
  for (const [k, v] of states) if (now() - v.at > 10 * 60e3) states.delete(k);
  states.set(state, { userId, at: now() });
  const q = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
  return `${AUTH_URL()}?${q}`;
}
export async function finish(userId, { code, state }) {
  const s = states.get(state); states.delete(state);
  if (!s || s.userId !== userId || now() - s.at > 10 * 60e3) throw new Error('The Google Drive connection expired. Please try again.');
  const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri(), grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.refresh_token) throw new Error('Google did not grant Drive access' + (d.error_description ? `: ${d.error_description}` : '.'));
  const cur = siteGet('drive', {}) || {};
  await siteSet('drive', { ...cur, refresh: encrypt(d.refresh_token), at: now() });
}
export const disconnect = () => siteSet('drive', null);

async function accessToken() {
  const d = siteGet('drive', null), refresh = d?.refresh && tryDecrypt(d.refresh, 'Google Drive token');
  if (!refresh) throw Object.assign(new Error('Connect Google Drive first'), { status: 400 });
  const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refresh, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw Object.assign(new Error('Google Drive access was removed. Connect it again.'), { status: 401 });
  return t.access_token;
}
// Uploads the PDF; the same Drive file is updated on later saves (Drive keeps earlier versions).
export async function savePdf(pdf, name) {
  const token = await accessToken(), d = siteGet('drive', {}) || {};
  const boundary = 'qp' + crypto.randomBytes(8).toString('hex');
  const meta = d.fileId ? { name } : { name, mimeType: 'application/pdf' };
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--`)]);
  const send = (method, url) => fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(30000) });
  let r = d.fileId ? await send('PATCH', `${UPLOAD()}/${encodeURIComponent(d.fileId)}?uploadType=multipart&fields=id,webViewLink`) : null;
  // The earlier file was deleted from Drive: make a new one.
  if (!r || r.status === 404) r = await send('POST', `${UPLOAD()}?uploadType=multipart&fields=id,webViewLink`);
  const f = await r.json().catch(() => ({}));
  if (!r.ok || !f.id) throw Object.assign(new Error(`Google Drive answered ${r.status}${f.error?.message ? ': ' + f.error.message : ''}`), { status: 502 });
  await siteSet('drive', { ...(siteGet('drive', {}) || {}), fileId: f.id, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, savedAt: now() });
  return { id: f.id, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` };
}
