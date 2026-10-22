// Which Alpaca account a user trades through, and the OAuth2 flow for linking an existing one.
import crypto from 'node:crypto';
import { one, run, now } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { URLS } from './http.js';
import { Trading } from './trading.js';

async function cred(userId, provider) {
  const r = await one('SELECT blob FROM credentials WHERE user_id = ? AND provider = ?', userId, provider);
  if (!r) return null;
  try { return decrypt(r.blob); } catch { return null; }
}
export const saveCred = (userId, provider, value) =>
  run('INSERT INTO credentials (user_id, provider, blob) VALUES (?,?,?) ON CONFLICT DO UPDATE SET blob = excluded.blob', userId, provider, encrypt(value));

// All connections the user has, keyed by type.
export async function connections(userId) {
  const out = {};
  const b = await one('SELECT * FROM broker_accounts WHERE user_id = ?', userId);
  if (b) out.broker = { type: 'broker', accountId: b.account_id, accountNumber: b.account_number, status: b.status };
  const o = await cred(userId, 'alpaca_oauth');
  if (o) out.oauth = { type: 'oauth', token: o.token, live: !!o.live };
  const k = await cred(userId, 'alpaca');
  if (k) out.keys = { type: 'keys', k: k.k, s: k.s, live: !!k.live };
  return out;
}

// The connection used for trading: the user's choice if still available, otherwise the first
// available of broker account, OAuth, API keys. Returns a Trading client or null.
export async function tradingFor(userId) {
  const all = await connections(userId);
  const pref = (await one('SELECT alpaca_conn FROM users WHERE id = ?', userId))?.alpaca_conn;
  const c = all[pref] || all.broker || all.oauth || all.keys;
  return c ? new Trading(c) : null;
}
export async function requireTrading(userId) {
  const t = await tradingFor(userId);
  if (!t) throw Object.assign(new Error('Connect an Alpaca account first (Account page).'), { status: 409 });
  if (t.type === 'broker' && !['ACTIVE'].includes(t.conn.status)) {
    const fresh = await one('SELECT status FROM broker_accounts WHERE user_id = ?', userId);
    if (fresh?.status !== 'ACTIVE') throw Object.assign(new Error(`Your brokerage account is ${fresh?.status || 'pending'}; trading opens once it is ACTIVE.`), { status: 409 });
  }
  return t;
}

// ---------- OAuth2 (authorization code flow) ----------

export const oauthEnabled = () => !!(process.env.ALPACA_OAUTH_CLIENT_ID && process.env.ALPACA_OAUTH_CLIENT_SECRET);
const states = new Map(); // state -> { userId, at }
const redirectUri = () => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '') + '/oauth/alpaca/callback';

export function oauthStartUrl(userId) {
  for (const [k, v] of states) if (now() - v.at > 10 * 60e3) states.delete(k);
  const state = crypto.randomBytes(24).toString('base64url');
  states.set(state, { userId, at: now() });
  const p = new URLSearchParams({ response_type: 'code', client_id: process.env.ALPACA_OAUTH_CLIENT_ID, redirect_uri: redirectUri(), state, scope: 'account:write trading data' });
  if (process.env.ALPACA_OAUTH_ENV) p.set('env', process.env.ALPACA_OAUTH_ENV);
  return `${URLS.oauthAuthorize()}?${p}`;
}

// Validates state (CSRF protection), exchanges the code and stores the token encrypted.
export async function oauthCallback(state, code, sessionUserId) {
  const s = states.get(state);
  states.delete(state);
  if (!s || now() - s.at > 10 * 60e3) throw new Error('This sign-in link expired. Please try connecting again.');
  if (sessionUserId && s.userId !== sessionUserId) throw new Error('Signed-in user changed during the Alpaca sign-in.');
  const r = await fetch(URLS.oauthToken(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: process.env.ALPACA_OAUTH_CLIENT_ID, client_secret: process.env.ALPACA_OAUTH_CLIENT_SECRET, redirect_uri: redirectUri() }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Alpaca did not accept the sign-in: ' + (d.message || d.error_description || d.error || r.status));
  const live = process.env.ALPACA_OAUTH_ENV === 'live';
  await saveCred(s.userId, 'alpaca_oauth', { token: d.access_token, live, scope: d.scope });
  await run("UPDATE users SET alpaca_conn = 'oauth' WHERE id = ?", s.userId);
  return s.userId;
}
