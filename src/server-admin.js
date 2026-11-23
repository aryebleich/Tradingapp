// Admin → Database and the server parts of Admin → Hosting and Keys, for the server that holds its
// own database file (the Oracle VM). Everything here needs the admin role and a fresh password (or
// 2FA) confirmation: POST /unlock opens a 15-minute window for this session only. Every action is
// written to the audit log. Values of keys are never sent, only their names and whether they are set.
//
// The app runs as an unprivileged user in a read-only container, so the host actions (deploy now,
// restart, restore) are requests: a small file on the data volume that the host's update script
// (deploy/vm/update.sh, every 2 minutes, as root) carries out and logs.
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireUser, requireAdmin, confirmsIdentity, rateLimit } from './auth.js';
import { audit, all, one, db, dbFile, dbKind, persistentDisk, dbHealth } from './db.js';
import { verifyTotp, tryDecrypt } from './crypto.js';
import { ENV_GROUPS } from './site.js';
import { backupStatus, backupNow, backupDir, listBackups } from './backup.js';
import { maintenance, setMaintenance } from './maintenance.js';
import { thisHost, standby, isActiveHost } from './hosting.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const UNLOCK_MS = 15 * 60e3;
const unlocked = new Map(); // session hash -> time of the last confirmation
export const isUnlocked = req => !!req.sessionHash && Date.now() - (unlocked.get(req.sessionHash) || 0) < UNLOCK_MS;
export const lockAll = () => unlocked.clear();
const needUnlock = (req, res, next) => (isUnlocked(req) ? next() : res.status(403).json({ error: 'Confirm your password to open the server and database settings.', adminUnlock: true }));
const dataDir = () => (dbFile ? path.dirname(dbFile) : null);
const onVm = () => !!dbFile && persistentDisk();

// ---------- what Admin shows ----------
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export function vmMetrics() {
  const mem = (() => { try { const m = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').map(l => l.split(/:\s+/)).filter(x => x[1]).map(([k, v]) => [k, parseInt(v, 10) * 1024])); return { total: m.MemTotal, available: m.MemAvailable }; } catch { return { total: os.totalmem(), available: os.freemem() }; } })();
  const dir = dataDir() || process.cwd();
  const disk = (() => { try { const s = fs.statfsSync(dir); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; } })();
  const host = dataDir() ? readJson(path.join(dataDir(), '.host.json')) : null;
  const actions = (() => { try { return fs.readFileSync(path.join(dataDir(), 'host-actions.log'), 'utf8').trim().split('\n').slice(-12); } catch { return []; } })();
  const pending = dataDir() ? ['deploy', 'restart', 'restore'].filter(k => fs.existsSync(path.join(dataDir(), `.${k}-request`))) : [];
  return {
    host: thisHost(), active: isActiveHost(), standby: standby(), cpus: os.cpus().length, load: os.loadavg().map(x => +x.toFixed(2)),
    memory: mem, disk, uptimeSec: Math.round(os.uptime()), appUptimeSec: Math.round(process.uptime()), node: process.version,
    version: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null, lastDeploy: host, hostActions: actions, pending, canRequest: onVm(),
  };
}
async function tableSizes() {
  if (dbKind() !== 'file') return { counted: false, reason: 'Turso bills every row read, so the tables are not counted here.', tables: [] };
  const names = (await all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map(r => r.name);
  const tables = [];
  for (const n of names) tables.push({ name: n, rows: Number((await one(`SELECT COUNT(*) AS n FROM "${n}"`)).n) });
  return { counted: true, tables: tables.sort((a, b) => b.rows - a.rows) };
}
const fileSize = f => { try { return fs.statSync(f).size; } catch { return null; } };
export async function databaseStatus() {
  return {
    kind: dbKind(), file: dbFile ? path.basename(dbFile) : null, persistentDisk: persistentDisk(), health: dbHealth(),
    bytes: dbFile ? fileSize(dbFile) : null, walBytes: dbFile ? fileSize(dbFile + '-wal') : null,
    sizes: await tableSizes().catch(e => ({ counted: false, reason: e.message, tables: [] })),
    backups: backupStatus(), maintenance: maintenance(),
  };
}
// Names only. "Required" are the ones this server cannot work without; "recommended" are warned about.
export function keyReport(env = process.env) {
  const file = !env.DATABASE_URL;
  const required = ['ENCRYPTION_KEY', 'CRON_SECRET', 'PUBLIC_URL', 'HOST_ID', ...(file ? ['DB_FILE', 'PERSISTENT_DISK'] : ['DATABASE_URL', 'DATABASE_AUTH_TOKEN'])];
  const recommended = ['ADMIN_EMAIL', 'ALPACA_KEY_ID', 'ALPACA_SECRET', 'RESEND_API_KEY', ...(file ? ['OCI_BACKUP_PAR_URL'] : [])];
  const set = k => !!String(env[k] ?? '').trim();
  const groups = ENV_GROUPS.map(([name, keys]) => ({ name, keys: keys.map(k => ({ name: k, set: set(k), required: required.includes(k) })) }));
  const warnings = [
    ...required.filter(k => !set(k)).map(k => ({ key: k, level: 'error', text: `${k} is missing: this server needs it.` })),
    ...(file && env.PERSISTENT_DISK !== '1' ? [{ key: 'PERSISTENT_DISK', level: 'error', text: 'PERSISTENT_DISK is not 1: the database file is treated as temporary.' }] : []),
    ...recommended.filter(k => !set(k)).map(k => ({ key: k, level: 'warn', text: k === 'OCI_BACKUP_PAR_URL' ? 'OCI_BACKUP_PAR_URL is missing: backups stay on this server only (no off-site copy).' : `${k} is not set.` })),
  ];
  return { required, recommended, groups, warnings, missingRequired: warnings.filter(w => w.level === 'error').map(w => w.key) };
}

// Does ENCRYPTION_KEY open the stored credentials? (The migration's check; nothing is decrypted to the caller.)
export async function credentialCheck(limit = 5) {
  const rows = await all('SELECT blob FROM credentials ORDER BY rowid DESC LIMIT ?', limit).catch(() => []);
  const ok = rows.filter(r => tryDecrypt(r.blob, 'credential') != null).length;
  return { checked: rows.length, decrypted: ok, ok: rows.length === 0 || ok === rows.length };
}
const request = (kind, body = '') => {
  if (!onVm()) throw bad('Only on a server with its own database file (the Oracle VM).', 409);
  fs.writeFileSync(path.join(dataDir(), `.${kind}-request`), body);
};

export const serverAdminRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  // Step-up: the password (and the 2FA code when it is on), at most 8 tries in 15 minutes.
  r.post('/unlock', async (req, res) => {
    if (!rateLimit('srvunlock:' + req.user.id, 8, 15 * 60e3)) throw bad('Too many attempts', 429);
    if (!confirmsIdentity(req.user, req.body || {})) throw bad(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password', 403);
    if (req.user.totp_enabled && !verifyTotp(req.user.totp_secret, req.body?.code)) throw bad('Enter the code from your authenticator app', 403);
    if (!req.sessionHash) throw bad('Sign in again', 403);
    unlocked.set(req.sessionHash, Date.now());
    await audit(req.user.id, 'admin_server_unlock', null, req.ip);
    res.json({ ok: true, minutes: UNLOCK_MS / 60e3 });
  });
  r.post('/lock', (req, res) => { unlocked.delete(req.sessionHash); res.json({ ok: true }); });
  // Hosting shows the server's own numbers (no secrets, no data): admin only.
  r.get('/metrics', (req, res) => res.json(vmMetrics()));
  r.use(needUnlock);
  r.get('/', async (req, res) => res.json({ database: await databaseStatus(), server: vmMetrics(), unlockedFor: Math.round((UNLOCK_MS - (Date.now() - unlocked.get(req.sessionHash))) / 1000) }));
  r.get('/keys', (req, res) => res.json(keyReport()));
  r.post('/backup', async (req, res) => {
    const b = await backupNow({ kind: 'manual' });
    await audit(req.user.id, 'admin_backup_now', { file: b.file, bytes: b.bytes }, req.ip);
    delete b.counts; res.json(b);
  });
  r.post('/download', async (req, res) => {
    const name = String(req.body?.name || ''), f = listBackups().find(x => x.name === name);
    if (!f) throw bad('No such backup', 404);
    await audit(req.user.id, 'admin_backup_download', { file: name }, req.ip);
    res.download(path.join(backupDir(), name), name);
  });
  r.post('/restore', async (req, res) => {
    const name = String(req.body?.name || '');
    if (!listBackups().some(x => x.name === name)) throw bad('No such backup', 404);
    if (String(req.body?.typed || '').trim() !== 'RESTORE') throw bad('Type RESTORE to confirm');
    request('restore', name);
    await audit(req.user.id, 'admin_restore_requested', { file: name }, req.ip);
    res.json({ ok: true, message: `Restore of ${name} requested: the server stops the app, keeps the current database, puts this backup in and starts again within about 2 minutes.` });
  });
  r.post('/maintenance', async (req, res) => {
    const m = await setMaintenance(req.body?.on === true, req.body?.reason || 'Admin');
    await audit(req.user.id, m.on ? 'maintenance_on' : 'maintenance_off', { reason: m.reason || null }, req.ip);
    res.json(m);
  });
  r.post('/deploy', async (req, res) => { request('deploy'); await audit(req.user.id, 'hosting_vm_deploy', { host: thisHost() }, req.ip); res.json({ ok: true, message: 'Deploy requested: the server builds the newest version within about 2 minutes.' }); });
  r.post('/restart', async (req, res) => { request('restart'); await audit(req.user.id, 'hosting_vm_restart', { host: thisHost() }, req.ip); res.json({ ok: true, message: 'Restart requested: within about 2 minutes.' }); });
  return r;
})();
export { db as _db };
