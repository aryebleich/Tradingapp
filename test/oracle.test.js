// The move to the Oracle VM: a database file on a lasting disk passes the start-up check, online
// backups restore to the same rows, the Turso copy works through sync only (and says clearly when
// Turso refuses), maintenance mode stops orders and jobs, and Admin → Database / Keys need the admin
// role plus a fresh password and never show a key's value.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-oracle-'));
const root = new URL('..', import.meta.url).pathname;
const hasSqlite = spawnSync('sqlite3', ['-version']).status === 0;

test('PERSISTENT_DISK=1: a database file on a lasting disk passes the start-up check on a hosted server', () => {
  const probe = env => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "const D = await import('./src/db.js'); console.log(JSON.stringify({ lasting: D.persistentDb, needs: D.needsHostedDb(), kind: D.dbKind() })); process.exit(0)"],
    { cwd: root, env: { ...process.env, DATABASE_URL: '', DB_FILE: path.join(tmp, 'probe.db'), RENDER: '1', ...env }, encoding: 'utf8' }).trim().split('\n').pop());
  assert.deepEqual(probe({ PERSISTENT_DISK: '1' }), { lasting: true, needs: false, kind: 'file' });
  const without = probe({ PERSISTENT_DISK: '' });
  assert.equal(without.lasting, false); assert.equal(without.needs, true); // a plain file on Render is still refused
});

test('an online backup (VACUUM INTO) has the same rows, and restore.sh puts it back', async () => {
  const live = path.join(tmp, 'live.db'), c = createClient({ url: 'file:' + live });
  await c.execute('PRAGMA journal_mode = WAL');
  await c.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
  await c.execute('CREATE TABLE fills (id INTEGER PRIMARY KEY, user_id INT, qty REAL)');
  for (let i = 0; i < 50; i++) await c.execute({ sql: 'INSERT INTO users (email) VALUES (?)', args: [`u${i}@example.com`] });
  for (let i = 0; i < 120; i++) await c.execute({ sql: 'INSERT INTO fills (user_id, qty) VALUES (?, ?)', args: [i % 50, i] });
  const B = await import('../src/backup.js');
  const b = await B.backupNow({ client: c, file: live, t: new Date('2026-11-23T05:00:00Z') });
  assert.equal(b.ok, true); assert.deepEqual(b.counts, { fills: 120, users: 50 });
  await c.execute("INSERT INTO users (email) VALUES ('after@example.com')"); // written after the backup
  const files = B.listBackups(B.backupDir(live)).map(f => f.name).sort();
  assert.deepEqual(files, ['daily-20261123T00.db', 'hourly-20261123T05.db']);
  const status = B.backupStatus(B.backupDir(live));
  assert.equal(status.last.ok, true); assert.equal(status.last.rows, 170);
  assert.equal(status.lastUpload.skipped, true); assert.match(status.lastUpload.warning, /OCI_BACKUP_PAR_URL/);
  c.close();
  if (!hasSqlite) return; // restore.sh needs the sqlite3 command (installed on the VM by setup.sh)
  const r = spawnSync('bash', [path.join(root, 'deploy/vm/restore.sh'), path.join(B.backupDir(live), 'hourly-20261123T05.db')], { env: { ...process.env, NO_DOCKER: '1', DB: live }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = await B.checkBackup(live);
  assert.deepEqual(after.counts, { fills: 120, users: 50 }); // the row written after the backup is gone
  assert.ok(fs.readdirSync(tmp).some(f => f.startsWith('live.db.before-restore-')), 'the replaced database is kept');
  const bad = path.join(tmp, 'broken.db'); fs.writeFileSync(bad, 'not a database');
  assert.notEqual(spawnSync('bash', [path.join(root, 'deploy/vm/restore.sh'), bad], { env: { ...process.env, NO_DOCKER: '1', DB: live } }).status, 0);
  assert.deepEqual((await B.checkBackup(live)).counts, { fills: 120, users: 50 }, 'a broken backup changes nothing');
});

test('backups: retention keeps 48 hourly and 30 daily; the off-site copy decrypts only with the key', async () => {
  const B = await import('../src/backup.js'), dir = path.join(tmp, 'ret');
  fs.mkdirSync(dir);
  for (let i = 0; i < 60; i++) { const f = path.join(dir, `hourly-202611${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}x${i}.db`); fs.writeFileSync(f, ''); fs.utimesSync(f, i, i); }
  for (let i = 0; i < 35; i++) { const f = path.join(dir, `daily-2026${String(1 + Math.floor(i / 28)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}T00.db`); fs.writeFileSync(f, ''); fs.utimesSync(f, i, i); }
  B.prune(dir);
  const left = B.listBackups(dir);
  assert.equal(left.filter(f => f.kind === 'hourly').length, 48); assert.equal(left.filter(f => f.kind === 'daily').length, 30);
  const key = Buffer.alloc(32, 7), enc = B.encryptBackup(Buffer.from('SQLite format 3 data'), key);
  assert.equal(B.decryptBackup(enc, key).toString(), 'SQLite format 3 data');
  assert.throws(() => B.decryptBackup(enc, Buffer.alloc(32, 8)));
});

test('turso-pull: an embedded replica that only syncs makes a file that passes integrity_check', async () => {
  const { pull } = await import('../scripts/turso-pull.mjs');
  let syncs = 0;
  const fake = cfg => {
    const c = createClient({ url: cfg.url });
    if (!cfg.syncUrl) return c;
    assert.equal(cfg.syncUrl, 'libsql://example-db.turso.io'); assert.equal(cfg.authToken, 'test-token');
    c.sync = async () => { // the fake Turso: the first sync brings the pages, the second has nothing left
      syncs++;
      if (syncs === 1) { await c.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)'); await c.execute("INSERT INTO users (email) VALUES ('a@example.com'), ('b@example.com')"); await c.execute('CREATE TABLE credentials (user_id INT, blob TEXT)'); return { frame_no: 4, frames_synced: 4 }; }
      return { frame_no: 4, frames_synced: 0 };
    };
    return c;
  };
  const r = await pull({ dest: path.join(tmp, 'pull', 'pull.db'), syncUrl: 'libsql://example-db.turso.io', authToken: 'test-token', makeClient: fake });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.method, 'embedded-replica-sync'); assert.equal(r.integrity, 'ok');
  assert.equal(r.syncs, 2); assert.equal(r.frames, 4); assert.deepEqual(r.counts, { credentials: 0, users: 2 });
  assert.doesNotMatch(JSON.stringify(r), /test-token/);
});

test('turso-pull: a refused sync is reported clearly (and the token is never printed)', async () => {
  const { pull } = await import('../scripts/turso-pull.mjs');
  const refuse = cfg => { const c = createClient({ url: cfg.url }); c.sync = async () => { throw new Error('BLOCKED: Operation was blocked: sync is forbidden, do you need to upgrade your plan? token=test-token'); }; return c; };
  const r = await pull({ dest: path.join(tmp, 'pull2', 'pull.db'), syncUrl: 'libsql://example-db.turso.io', authToken: 'test-token', makeClient: refuse });
  assert.equal(r.ok, false); assert.equal(r.refused, true); assert.match(r.error, /BLOCKED/); assert.doesNotMatch(JSON.stringify(r), /test-token/);
  const none = await pull({ dest: path.join(tmp, 'pull3', 'pull.db'), syncUrl: '' });
  assert.equal(none.ok, false); assert.equal(none.refused, false); assert.match(none.error, /DATABASE_URL/);
});

// ---------- through the server ----------
process.env.ADMIN_EMAIL = 'oracle-boss@example.com';
process.env.CRON_SECRET = 'cron-test-secret';
process.env.OCI_BACKUP_PAR_URL = '';
let server, base;
before(async () => { const { app } = await import('../server.js'); await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }); });
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
function client() {
  let cookie = '';
  return async (p, body, method) => {
    const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, headers: r.headers, text: await r.clone().text(), body: await r.json().catch(() => null) };
  };
}

test('/healthz answers without a database query', async () => {
  const D = await import('../src/db.js'); process.env.DB_READ_STATS = '1'; D.resetDbStats();
  const r = await fetch(base + '/healthz'); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.ok, true); assert.ok('database' in b);
  assert.equal(D.dbStats(50).top.length, 0, 'no statement ran');
  delete process.env.DB_READ_STATS;
});

test('maintenance mode refuses new orders (market and paper limit) and pauses the jobs', async () => {
  const u = client(); await u('/api/auth/register', { email: 'maint-user@example.com', password: 'Str0ngPassword' });
  const on = await fetch(base + '/internal/maintenance', { method: 'POST', headers: { authorization: 'Bearer cron-test-secret', 'content-type': 'application/json' }, body: JSON.stringify({ on: true, reason: 'test move' }) });
  assert.equal((await on.json()).on, true);
  assert.equal((await fetch(base + '/internal/maintenance', { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 401);
  const o = await u('/api/orders', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, type: 'market' });
  assert.equal(o.status, 503, o.text); assert.match(o.body.error, /maintenance/i); assert.equal(o.headers.get('x-maintenance'), '1');
  const l = await u('/api/orders', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, type: 'limit', limit_price: 1 });
  assert.equal(l.status, 503, l.text);
  const S = await import('../src/scheduler.js');
  assert.deepEqual(await S.runDueJobs(Date.now()), { paused: 'maintenance' });
  const M = await import('../src/maintenance.js'); await M.setMaintenance(false);
  assert.notDeepEqual(await S.runDueJobs(Date.now()), { paused: 'maintenance' });
  const after = await u('/api/orders', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, type: 'market' });
  assert.notEqual(after.status, 503);
});

test('STANDBY=1 means no jobs, whatever the hosting settings say', async () => {
  const H = await import('../src/hosting.js');
  const r = await fetch(base + '/internal/standby', { method: 'POST', headers: { authorization: 'Bearer cron-test-secret', 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) });
  assert.equal((await r.json()).standby, true); assert.equal(H.isActiveHost(), false);
  await fetch(base + '/internal/standby', { method: 'POST', headers: { authorization: 'Bearer cron-test-secret', 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) });
  assert.equal(process.env.STANDBY, undefined);
});

test('Admin → Database and Keys: admin only, a fresh password first, never a key value', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_never_shown_123456';
  const boss = client(), user = client();
  await boss('/api/auth/register', { email: 'oracle-boss@example.com', password: 'Str0ngPassword' });
  await user('/api/auth/register', { email: 'oracle-user@example.com', password: 'Str0ngPassword' });
  for (const p of ['/api/admin/server', '/api/admin/server/keys', '/api/admin/server/metrics']) assert.equal((await user(p)).status, 403, p);
  assert.equal((await user('/api/admin/server/unlock', { password: 'Str0ngPassword' })).status, 403);
  // The admin without the step-up: closed.
  for (const p of ['/api/admin/server', '/api/admin/server/keys']) { const r = await boss(p); assert.equal(r.status, 403, p); assert.equal(r.body.adminUnlock, true); }
  for (const p of ['/api/admin/server/backup', '/api/admin/server/maintenance', '/api/admin/server/restore', '/api/admin/server/download']) assert.equal((await boss(p, {})).status, 403, p);
  assert.equal((await boss('/api/admin/server/unlock', { password: 'wrong-password' })).status, 403);
  assert.equal((await boss('/api/admin/server/unlock', { password: 'Str0ngPassword' })).status, 200);
  const s = await boss('/api/admin/server'); assert.equal(s.status, 200);
  assert.ok(s.body.database.kind); assert.ok(s.body.server.cpus >= 1);
  const k = await boss('/api/admin/server/keys'); assert.equal(k.status, 200);
  const stripe = k.body.groups.flatMap(g => g.keys).find(x => x.name === 'STRIPE_SECRET_KEY');
  assert.deepEqual(stripe, { name: 'STRIPE_SECRET_KEY', set: true, required: false });
  for (const r of [s, k]) { assert.doesNotMatch(r.text, /sk_test_never_shown|cron-test-secret|Str0ngPassword/); }
  assert.ok(k.body.missingRequired.length >= 0);
  // Restore needs the typed word too; the maintenance switch is audited.
  assert.equal((await boss('/api/admin/server/restore', { name: 'nope.db', typed: 'RESTORE' })).status, 404);
  const m = await boss('/api/admin/server/maintenance', { on: true, reason: 'admin test' }); assert.equal(m.body.on, true);
  await boss('/api/admin/server/maintenance', { on: false });
  const { all } = await import('../src/db.js');
  const acts = (await all("SELECT event AS action FROM audit_log WHERE event IN ('admin_server_unlock', 'maintenance_on', 'maintenance_off')")).map(r => r.action);
  for (const a of ['admin_server_unlock', 'maintenance_on', 'maintenance_off']) assert.ok(acts.includes(a), a);
  delete process.env.STRIPE_SECRET_KEY;
});

test('keyReport: names only, and a missing required key is a warning', async () => {
  const { keyReport } = await import('../src/server-admin.js');
  const r = keyReport({ DB_FILE: '/app/data/quantpocket.db', PERSISTENT_DISK: '1', HOST_ID: 'oracle', PUBLIC_URL: 'https://x.example', CRON_SECRET: 'abc' });
  assert.deepEqual(r.missingRequired, ['ENCRYPTION_KEY']);
  assert.ok(r.warnings.some(w => w.key === 'OCI_BACKUP_PAR_URL' && w.level === 'warn'));
  assert.doesNotMatch(JSON.stringify(r), /abc|x\.example/);
});
