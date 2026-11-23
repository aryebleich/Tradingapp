// Backups of the local database file (the Oracle VM: no provider keeps a copy, so the app does).
// Every hour: SQLite's online backup (VACUUM INTO), never a copy of the live file, so a backup is
// always consistent even while the app writes. Each backup is checked (integrity_check) before it
// counts. Kept on the VM: the newest 48 hourly and 30 daily copies. Once a day the daily copy is
// gzipped, encrypted (AES-256-GCM) and uploaded to Oracle Object Storage when OCI_BACKUP_PAR_URL is
// set (a write-only pre-authenticated request URL of a bucket); without it the status says so.
// The status is a JSON file next to the backups, so it can be read even when the database cannot.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';
import { db, dbFile, persistentDisk } from './db.js';

export const KEEP_HOURLY = 48, KEEP_DAILY = 30, FINAL_DAYS = 90;
export const backupDir = (file = dbFile) => (file ? path.join(path.dirname(file), 'backups') : null);
const stamp = (t = new Date()) => t.toISOString().replace(/[-:]/g, '').slice(0, 11); // 20261123T05
const statusFile = dir => path.join(dir, 'status.json');
export function backupStatus(dir = backupDir()) {
  if (!dir) return { enabled: false, reason: 'The database is a shared server (DATABASE_URL), which keeps its own copies.' };
  let s = {}; try { s = JSON.parse(fs.readFileSync(statusFile(dir), 'utf8')); } catch {}
  return { enabled: true, dir, ...s, offsite: process.env.OCI_BACKUP_PAR_URL ? 'Oracle Object Storage' : null, files: listBackups(dir).slice(0, 100) };
}
const saveStatus = (dir, patch) => { const s = { ...backupStatus(dir), ...patch }; delete s.files; delete s.enabled; delete s.dir; delete s.offsite; fs.writeFileSync(statusFile(dir), JSON.stringify(s, null, 1)); };
export function listBackups(dir = backupDir()) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^(hourly|daily|manual)-\d{8}T\d{2}.*\.db$/.test(f))
    .map(f => { const st = fs.statSync(path.join(dir, f)); return { name: f, kind: f.split('-')[0], bytes: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at);
}
// Opens a backup on its own and checks it: integrity_check and the number of rows per table.
export async function checkBackup(file) {
  const c = createClient({ url: 'file:' + file });
  try {
    const ok = String((await c.execute('PRAGMA integrity_check')).rows[0][0]);
    const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows.map(r => r.name ?? r[0]);
    const counts = {};
    for (const t of tables) counts[t] = Number((await c.execute(`SELECT COUNT(*) FROM "${t}"`)).rows[0][0]);
    return { integrity: ok, ok: ok === 'ok', tables: tables.length, counts };
  } finally { c.close(); }
}
// One backup now: VACUUM INTO a new file, check it, then keep or drop it.
export async function backupNow({ kind = 'hourly', client = db, file = dbFile, t = new Date() } = {}) {
  const dir = backupDir(file); if (!dir) throw Object.assign(new Error('The database is not a local file.'), { status: 409 });
  fs.mkdirSync(dir, { recursive: true });
  const name = `${kind}-${stamp(t)}${kind === 'manual' ? '-' + t.getTime().toString(36) : ''}.db`, out = path.join(dir, name), t0 = Date.now();
  fs.rmSync(out, { force: true });
  try {
    await client.execute({ sql: 'VACUUM INTO ?', args: [out] });
    const chk = await checkBackup(out);
    if (!chk.ok) { fs.rmSync(out, { force: true }); throw new Error('integrity_check: ' + chk.integrity); }
    const last = { at: Date.now(), file: name, ok: true, ms: Date.now() - t0, bytes: fs.statSync(out).size, tables: chk.tables, rows: Object.values(chk.counts).reduce((a, b) => a + b, 0) };
    // The first backup of a day is also that day's daily copy (a finished file, so copying it is safe).
    const day = name.slice(name.indexOf('-') + 1, name.indexOf('-') + 9), daily = path.join(dir, `daily-${day}T00.db`);
    let madeDaily = false;
    if (!fs.existsSync(daily)) { fs.copyFileSync(out, daily); madeDaily = true; }
    prune(dir);
    saveStatus(dir, { last, ...(madeDaily ? { lastDaily: { at: Date.now(), file: path.basename(daily) } } : {}) });
    if (madeDaily) await uploadDaily(daily).then(u => saveStatus(dir, { lastUpload: u })).catch(e => saveStatus(dir, { lastUpload: { at: Date.now(), ok: false, error: String(e.message).slice(0, 200) } }));
    return { ...last, counts: chk.counts };
  } catch (e) {
    saveStatus(dir, { last: { at: Date.now(), file: name, ok: false, error: String(e.message).slice(0, 300) } });
    throw e;
  }
}
export function prune(dir, now = Date.now()) {
  // The final copy of the old database (scripts/final-copy.mjs) is kept 90 days.
  const final = path.join(path.dirname(dir), 'final');
  if (fs.existsSync(final)) for (const f of fs.readdirSync(final)) { const p = path.join(final, f); if (now - fs.statSync(p).mtimeMs > FINAL_DAYS * 864e5) fs.rmSync(p, { force: true }); }
  const all = listBackups(dir);
  for (const [kind, keep] of [['hourly', KEEP_HOURLY], ['daily', KEEP_DAILY], ['manual', 10]]) for (const f of all.filter(x => x.kind === kind).slice(keep)) fs.rmSync(path.join(dir, f.name), { force: true });
}
// The encryption of an off-site copy: "BFB1" + 12-byte IV + 16-byte tag + AES-256-GCM(gzip(file)).
const backupKey = () => crypto.createHash('sha256').update('brightfolio-backup|' + (process.env.BACKUP_KEY || process.env.ENCRYPTION_KEY || '')).digest();
export function encryptBackup(buf, key = backupKey()) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(buf)), c.final()]);
  return Buffer.concat([Buffer.from('BFB1'), iv, c.getAuthTag(), body]);
}
export function decryptBackup(buf, key = backupKey()) {
  if (buf.subarray(0, 4).toString() !== 'BFB1') throw new Error('Not a Brightolio backup');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16)); d.setAuthTag(buf.subarray(16, 32));
  return zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(32)), d.final()]));
}
export async function uploadDaily(file) {
  const par = process.env.OCI_BACKUP_PAR_URL;
  if (!par) return { at: Date.now(), ok: false, skipped: true, warning: 'No off-site copy: OCI_BACKUP_PAR_URL is not set (Oracle Object Storage → bucket → pre-authenticated request, write only).' };
  if (!process.env.BACKUP_KEY && !process.env.ENCRYPTION_KEY) return { at: Date.now(), ok: false, skipped: true, warning: 'No off-site copy: no BACKUP_KEY or ENCRYPTION_KEY to encrypt it with.' };
  const name = path.basename(file) + '.gz.enc', body = encryptBackup(fs.readFileSync(file));
  const r = await fetch(par.replace(/\/?$/, '/') + encodeURIComponent(name), { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream' }, signal: AbortSignal.timeout(120e3) });
  if (!r.ok) throw new Error(`Object Storage answered ${r.status}`);
  return { at: Date.now(), ok: true, object: name, bytes: body.length };
}
// Every hour on a server whose database is a local file on a lasting disk (any server, active or not:
// each backs up its own file). The first run is a few minutes after start when the last is over an hour old.
let timer = null;
export function startBackups() {
  if (timer || !dbFile || !persistentDisk()) return null;
  const tick = () => { const s = backupStatus(); if (!s.last?.at || Date.now() - s.last.at >= 60 * 60e3 - 60e3) backupNow().catch(e => console.error('backup failed:', e.message)); };
  setTimeout(tick, 3 * 60e3).unref?.();
  timer = setInterval(tick, 5 * 60e3); timer.unref?.();
  return timer;
}
