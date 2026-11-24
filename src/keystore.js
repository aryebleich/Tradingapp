// The key store: every API key and setting the owner manages from Admin → Keys, kept on the Oracle
// server in the app's own SQLite database (table secrets), each value encrypted with AES-256-GCM
// under ENCRYPTION_KEY (src/crypto.js). ENCRYPTION_KEY itself never goes in here: it stays only in the
// server .env, and the same one is needed to read the keys again after restoring a backup.
//
// secret(name) is the one way to read a key: the key store first, then the environment. A key saved
// in Admin works at once, with no redeploy or restart: it is also put on process.env (the code that
// reads process.env directly sees it too), and every other worker picks it up within a few seconds
// (a cheap version check). Removing a key in Admin falls back to the server .env value.
//
// Values never leave the server: Admin sees the last 4 characters of a secret (plain settings such
// as addresses in full), when it was changed and by whom, and where it comes from.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, tryDecrypt } from './crypto.js';
import { describe, isSecret, CATALOG, GROUPS } from './keys-catalog.js';

// Never stored here: the master key, what the host sets, and what would cut the app off its data.
export const ENV_ONLY = new Set(['ENCRYPTION_KEY', 'DATABASE_URL', 'DATABASE_AUTH_TOKEN', 'DB_FILE', 'PERSISTENT_DISK', 'NODE_ENV', 'PORT', 'HOSTNAME', 'RENDER',
  'RENDER_SERVICE_ID', 'RENDER_EXTERNAL_URL', 'PATH', 'HOME', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'NODE_PATH', 'SSL_CERT_FILE',
  'SSL_CERT_DIR', 'NODE_VERSION', 'ALLOW_UNPATCHED_NODE', 'LD_PRELOAD', 'AUTH_CACHE_MS']);
export const validName = k => /^[A-Z][A-Z0-9_]{1,63}$/.test(k);
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

// What the environment held before the key store touched it (the fallback when a key is removed).
const BOOT = Object.fromEntries(Object.entries(process.env));
const store = new Map(); // name -> value (decrypted, in memory only)
const meta = new Map();  // name -> { last4, updatedAt, updatedBy, testedAt, testOk, testMsg }
let version = null, timer = null, D = null;
const dbm = async () => (D ||= await import('./db.js'));

export function secret(name) {
  if (store.has(name)) return store.get(name);
  const v = process.env[name];
  return v === undefined ? '' : String(v);
}
export const has = name => secret(name).trim() !== '';
export const source = name => (store.has(name) ? 'admin' : String(process.env[name] ?? '').trim() ? 'env' : 'missing');
export const last4 = v => { const s = String(v ?? ''); return s.length <= 4 ? '•'.repeat(s.length) : s.slice(-4); };

const SCHEMA = `CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY, blob TEXT NOT NULL, last4 TEXT, updated_at INTEGER NOT NULL, updated_by INTEGER, updated_by_email TEXT,
  created_at INTEGER NOT NULL, tested_at INTEGER, test_ok INTEGER, test_msg TEXT)`;
async function load() {
  const { all } = await dbm();
  const rows = await all('SELECT name, blob, last4, updated_at, updated_by_email, tested_at, test_ok, test_msg FROM secrets');
  const before = new Set(store.keys());
  store.clear(); meta.clear();
  for (const r of rows) {
    const v = tryDecrypt(r.blob, 'key ' + r.name);
    if (v == null || typeof v.v !== 'string') continue; // under another ENCRYPTION_KEY: the environment value applies
    store.set(r.name, v.v);
    meta.set(r.name, { last4: r.last4, updatedAt: r.updated_at, updatedBy: r.updated_by_email, testedAt: r.tested_at, testOk: r.test_ok == null ? null : !!r.test_ok, testMsg: r.test_msg });
    process.env[r.name] = v.v;
  }
  // Removed in Admin (here or by another worker): back to what the server .env says.
  for (const k of before) if (!store.has(k)) { if (BOOT[k] !== undefined) process.env[k] = BOOT[k]; else delete process.env[k]; }
}
const currentVersion = async () => { const { one } = await dbm(); const r = await one('SELECT COUNT(*) n, COALESCE(MAX(updated_at), 0) m, COALESCE(MAX(tested_at), 0) t FROM secrets'); return `${r.n}:${r.m}:${r.t}`; };
export async function refresh() { const v = await currentVersion(); if (v !== version) { await load(); version = v; } }

// At start: the table, the values saved by the older Admin → Keys (one encrypted blob in
// site_settings) moved in once, then a version check every 3 seconds.
export async function initKeystore({ every = 3000 } = {}) {
  const { db, run, one } = await dbm();
  await db.execute(SCHEMA);
  const S = await import('./site.js');
  if (!S.siteGet('keystoreMoved', false)) {
    const old = S.siteGet('env', null), saved = old ? tryDecrypt(old, 'saved settings') || {} : {};
    for (const [k, v] of Object.entries(saved)) if (validName(k) && !ENV_ONLY.has(k) && v && !(await one('SELECT 1 FROM secrets WHERE name = ?', k))) {
      await run('INSERT INTO secrets (name, blob, last4, updated_at, updated_by_email, created_at) VALUES (?,?,?,?,?,?)', k, encrypt({ v: String(v) }), last4(v), Date.now(), 'moved from the older Keys page', Date.now());
    }
    await S.siteSet('keystoreMoved', true);
  }
  await refresh();
  if (every && !timer) { timer = setInterval(() => refresh().catch(() => {}), every); timer.unref?.(); }
}

function check(name) {
  if (!validName(name)) throw bad(`"${name}" is not a valid name (capital letters, digits and _)`);
  if (ENV_ONLY.has(name)) throw bad(name === 'ENCRYPTION_KEY' ? 'ENCRYPTION_KEY stays in the server .env only: it is what encrypts this key store.' : `${name} is set by the server itself and cannot be changed here`);
}
export async function setSecret(name, value, user = null) {
  check(name);
  const v = String(value ?? '');
  if (!v.trim()) throw bad('Enter a value');
  if (v.length > 20000) throw bad('That value is too long');
  if (v.includes('•')) throw bad('That looks like a masked value, not the key itself');
  const { run } = await dbm(), t = Date.now();
  await run(`INSERT INTO secrets (name, blob, last4, updated_at, updated_by, updated_by_email, created_at, tested_at, test_ok, test_msg) VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL)
    ON CONFLICT(name) DO UPDATE SET blob = excluded.blob, last4 = excluded.last4, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email, tested_at = NULL, test_ok = NULL, test_msg = NULL`, name, encrypt({ v }), last4(v), t, user?.id ?? null, user?.email ?? null, t);
  store.set(name, v); process.env[name] = v;
  meta.set(name, { last4: last4(v), updatedAt: t, updatedBy: user?.email ?? null, testedAt: null, testOk: null, testMsg: null });
  version = null;
  return { name, last4: last4(v), source: 'admin' };
}
export async function removeSecret(name) {
  check(name);
  const { run } = await dbm();
  const r = await run('DELETE FROM secrets WHERE name = ?', name);
  store.delete(name); meta.delete(name);
  if (BOOT[name] !== undefined) process.env[name] = BOOT[name]; else delete process.env[name];
  version = null;
  return { name, removed: r.changes > 0, source: source(name) };
}

// A real, harmless check call to the provider (src/keys-catalog.js). The answer never carries the value.
export async function testSecret(name, { fetchImpl = fetch } = {}) {
  const d = describe(name), v = secret(name);
  if (!v) return { ok: false, message: 'Not set' };
  if (!d.test) return { ok: null, message: 'No check call for this key' };
  const req = d.test(v, secret);
  if (!req) return { ok: null, message: 'Needs its other half set first' };
  const scrub = s => String(s || '').split(v).join('•••').replace(/[\w-]{24,}/g, '•••').slice(0, 160);
  let ok = false, message;
  try {
    const r = await fetchImpl(req.url, { headers: req.headers || {}, signal: AbortSignal.timeout(12000) });
    const j = await r.json().catch(() => null);
    ok = r.ok && (!req.okIf || req.okIf(j));
    message = ok ? `OK (${r.status})` : `Refused (${r.status})${j?.error?.message || j?.message || j?.error ? ': ' + scrub(j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : '')) : ''}`;
  } catch (e) { message = 'No answer: ' + scrub(e.name === 'TimeoutError' ? 'timed out' : e.message); }
  if (store.has(name)) {
    const { run } = await dbm(), t = Date.now();
    await run('UPDATE secrets SET tested_at = ?, test_ok = ?, test_msg = ? WHERE name = ?', t, ok ? 1 : 0, message, name);
    Object.assign(meta.get(name) || {}, { testedAt: t, testOk: ok, testMsg: message });
  }
  return { ok, message };
}

// What Admin → Keys shows: every known key (and any added by hand), grouped. Never a secret value.
export function report() {
  const names = new Set([...CATALOG.keys(), ...store.keys()]);
  const rows = [...names].map(name => {
    const d = describe(name), m = meta.get(name), src = source(name), sec = isSecret(name), v = secret(name);
    return {
      name, group: d.group, what: d.what, need: d.need, url: d.url, secret: sec, source: src, envOnly: ENV_ONLY.has(name),
      last4: src === 'missing' ? null : sec ? (m?.last4 || last4(v)) : null, value: !sec && src !== 'missing' ? v.slice(0, 200) : null,
      changedAt: m?.updatedAt || null, changedBy: m?.updatedBy || null, testable: !!d.test, tested: m?.testedAt ? { at: m.testedAt, ok: m.testOk, message: m.testMsg } : null,
      alsoInEnv: src === 'admin' && BOOT[name] !== undefined && BOOT[name] !== '',
    };
  });
  const groups = GROUPS.map(g => ({ name: g, keys: rows.filter(r => r.group === g).sort((a, b) => (a.need === 'required' ? -1 : 0) - (b.need === 'required' ? -1 : 0) || a.name.localeCompare(b.name)) })).filter(g => g.keys.length);
  const missing = rows.filter(r => r.source === 'missing' && (r.need === 'required' || r.need === 'recommended')).map(r => ({ name: r.name, need: r.need }));
  return { groups, missing, counts: { admin: rows.filter(r => r.source === 'admin').length, env: rows.filter(r => r.source === 'env').length, missing: rows.filter(r => r.source === 'missing').length } };
}

// "Copy to the server .env": an encrypted request on the data volume. The host's update script
// (deploy/vm/update.sh, as root, every 2 minutes) decrypts it inside the app container
// (scripts/env-request.mjs) and hands the lines to migrate.sh's set-env step, so the key also
// survives a database restore. The value never passes through GitHub or a log.
export async function requestEnvCopy(names) {
  const { dbFile } = await dbm();
  if (!dbFile) throw bad('Only on the Oracle server (its own database file).', 409);
  const dir = path.dirname(dbFile), f = path.join(dir, '.env-request');
  const prev = fs.existsSync(f) ? tryDecrypt(fs.readFileSync(f, 'utf8').trim(), 'env request') || {} : {};
  for (const n of names) { check(n); if (!store.has(n)) throw bad(`${n} is not in the key store`); prev[n] = store.get(n); }
  fs.writeFileSync(f, encrypt(prev), { mode: 0o600 });
  return { names, queued: Object.keys(prev).length };
}

// One notification to the owner for every change (never the value).
async function tellOwner(subject, text) {
  try {
    const { adminEmails } = await import('./auth.js'); const to = adminEmails()[0];
    if (to && secret('RESEND_API_KEY')) await (await import('./notify.js')).sendEmail(to, subject, text);
  } catch (e) { console.warn('key notification:', e.message); }
}

export const keysRouter = (() => {
  const r = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  r.use(wrap(async (req, res, next) => {
    const { requireUser, requireAdmin } = await import('./auth.js');
    requireUser(req, res, () => requireAdmin(req, res, next));
  }));
  // Admin plus step-up (the password, and 2FA when on: Admin → Database's unlock, 15 minutes).
  r.use(wrap(async (req, res, next) => {
    const { isUnlocked } = await import('./server-admin.js');
    if (!isUnlocked(req)) return res.status(403).json({ error: 'Confirm your password to open Keys.', adminUnlock: true });
    next();
  }));
  r.get('/', (req, res) => res.json(report()));
  const done = async (req, event, name, extra = {}) => {
    const { audit } = await dbm();
    await audit(req.user.id, event, { name, ...extra }, req.ip);
    await tellOwner(`Brightolio: ${name} ${{ key_set: 'was saved', key_removed: 'was removed', key_env_copy: 'is being copied to the server .env' }[event] || 'changed'}`,
      `${name} ${event === 'key_removed' ? 'was removed from' : event === 'key_env_copy' ? 'is being copied from' : 'was saved in'} Admin → Keys by ${req.user.email} at ${new Date().toISOString()}. The value is never sent by email. If this was not you, sign in, change your password and rotate the key.`);
  };
  r.put('/:name', wrap(async (req, res) => {
    const name = String(req.params.name).toUpperCase();
    const out = await setSecret(name, req.body?.value, req.user);
    await done(req, 'key_set', name, { rotated: req.body?.rotate === true });
    res.json(out);
  }));
  r.delete('/:name', wrap(async (req, res) => {
    const name = String(req.params.name).toUpperCase();
    const out = await removeSecret(name);
    await done(req, 'key_removed', name);
    res.json(out);
  }));
  r.post('/:name/test', wrap(async (req, res) => {
    const name = String(req.params.name).toUpperCase(), out = await testSecret(name);
    const { audit } = await dbm(); await audit(req.user.id, 'key_test', { name, ok: out.ok }, req.ip);
    res.json(out);
  }));
  r.post('/:name/copy-env', wrap(async (req, res) => {
    const name = String(req.params.name).toUpperCase(), out = await requestEnvCopy([name]);
    await done(req, 'key_env_copy', name);
    res.json({ ...out, message: 'Queued: the server writes it into its .env within about 2 minutes (no restart: the key already works).' });
  }));
  return r;
})();
