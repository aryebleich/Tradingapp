// The merge of the old database into the live one (scripts/turso-merge.mjs): two small sample
// databases, the old one with ids below 10,000,000 and the live one started fresh above it, one
// person in both, a scheduled order whose time passed, and an active bot. The result must be one
// account, nothing switched on, the schedule marked missed, every foreign key pointing at a row, and
// a failed merge must leave the live file exactly as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@libsql/client';

const root = new URL('..', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-merge-'));
const KEY = crypto.randomBytes(32).toString('hex');
const env = { ...process.env, DATABASE_URL: '', DATABASE_AUTH_TOKEN: '', ENCRYPTION_KEY: KEY };
const NOW = Date.parse('2026-12-01T00:30:00Z'), GAP = Date.parse('2026-11-25T14:30:00Z');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const node = (code, file) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: { ...env, DB_FILE: file }, encoding: 'utf8' });

// The old database: the normal schema (ids from 1), two people, history, automations, a session.
function makeOld(file) {
  node(`const D = await import('./src/db.js'); await D.ready; const { encrypt } = await import('./src/crypto.js');
    const r = (s, ...a) => D.run(s, ...a);
    await r("INSERT INTO users (id, email, pass_hash, phone, created_at, ref_num, ref_code, reset_hash) VALUES (1, 'ann@example.com', 'old-hash-ann', '+18455550101', 1, 1, 'ANN1', 'reset-token')");
    await r("INSERT INTO users (id, email, pass_hash, created_at, ref_num, ref_code) VALUES (2, 'Ben@Example.com', 'old-hash-ben', 2, 2, 'BEN2')");
    await r("INSERT INTO fills (id, user_id, account, symbol, side, qty, price, source, at) VALUES (5, 2, 'paper', 'SPY', 'buy', 3, 500, 'web', 10)");
    await r("INSERT INTO journal_notes (fill_id, user_id, note, at) VALUES (5, 2, 'first trade', 11)");
    await r("INSERT INTO paper_accounts (user_id, cash, start_cash) VALUES (2, 98500, 100000)");
    await r("INSERT INTO scheduled_orders (id, user_id, account, symbol, side, qty, repeat, next_run, active, created_at) VALUES (7, 2, 'paper', 'VTI', 'buy', 1, 'weekly', ${GAP}, 1, 5)");
    await r("INSERT INTO scheduled_orders (id, user_id, account, symbol, side, qty, repeat, next_run, active, created_at) VALUES (8, 1, 'paper', 'QQQ', 'buy', 1, 'weekly', ${NOW + 864e5}, 1, 5)");
    await r("INSERT INTO ai_bots (id, user_id, kind, name, account, symbol, config, active, every_min, created_at) VALUES (9, 1, 'trend', 'Old bot', 'paper', 'SPY', '{}', 1, 15, 5)");
    await r("INSERT INTO user_strategies (id, user_id, name, spec, account, mode, created_at) VALUES (11, 2, 'Playbook', '{}', 'paper', 'approve', 5)");
    await r("INSERT INTO credentials (user_id, provider, blob) VALUES (1, 'alpaca', ?)", encrypt({ key: 'PKTEST', secret: 'x' }));
    await r("INSERT INTO user_settings (user_id, k, v, updated_at) VALUES (2, 'theme', '\\"dark\\"', 5)");
    await r("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('old-session', 1, 1, ${NOW + 864e5})");
    await r("INSERT INTO site_settings (k, v, updated_at) VALUES ('sponsored', '[]', 1), ('maintenance', '{\\"on\\":true}', 1)");
    process.exit(0)`, file);
}
// The live database: started fresh (ids from 10,000,001); Ben signed up again, Cara is new.
function makeLive(file) {
  execFileSync(process.execPath, ['scripts/fresh-db.mjs', file], { cwd: root, env, encoding: 'utf8' });
  node(`const D = await import('./src/db.js'); await D.ready; const r = (s, ...a) => D.run(s, ...a);
    const ben = Number((await r("INSERT INTO users (email, pass_hash, created_at, ref_num, ref_code) VALUES ('ben@example.com', 'new-hash-ben', 100, 1, 'NEWB')")).lastInsertRowid);
    const cara = Number((await r("INSERT INTO users (email, pass_hash, created_at, ref_num, ref_code) VALUES ('cara@example.com', 'hash-cara', 101, 2, 'CARA')")).lastInsertRowid);
    await r("INSERT INTO fills (user_id, account, symbol, side, qty, price, source, at) VALUES (?, 'paper', 'AAPL', 'buy', 2, 200, 'web', 120)", ben);
    await r("INSERT INTO paper_accounts (user_id, cash, start_cash) VALUES (?, 99600, 100000)", ben);
    await r("INSERT INTO user_settings (user_id, k, v, updated_at) VALUES (?, 'theme', '\\"light\\"', 130)", ben);
    await r("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('ben-now', ?, 140, ${NOW + 864e5})", ben);
    await r("INSERT INTO site_settings (k, v, updated_at) VALUES ('hosting', '{\\"active\\":\\"oracle\\"}', 1)");
    console.log(JSON.stringify({ ben, cara })); process.exit(0)`, file);
}
const rows = async (file, sql) => { const c = createClient({ url: 'file:' + file }); try { return (await c.execute(sql)).rows.map(r => ({ ...r })); } finally { c.close(); } };

test('the merge: one account per person, old ids kept, automations paused, schedule missed, foreign keys fine', async () => {
  const old = path.join(tmp, 'old.db'), live = path.join(tmp, 'live.db');
  makeOld(old); makeLive(live);
  process.env.ENCRYPTION_KEY = KEY;
  const { mergeFile, NOTICE, MISSED } = await import('../scripts/turso-merge.mjs');
  const r = await mergeFile(live, old, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));

  const users = await rows(live, 'SELECT id, lower(email) e, pass_hash, ref_num, ref_code, reset_hash FROM users ORDER BY id');
  assert.deepEqual(users.map(u => [Number(u.id), u.e]), [[1, 'ann@example.com'], [2, 'ben@example.com'], [10_000_002, 'cara@example.com']]);
  const ben = users.find(u => u.e === 'ben@example.com');
  assert.equal(ben.pass_hash, 'new-hash-ben', 'the newer password is kept'); assert.equal(ben.ref_code, 'BEN2');
  assert.equal(users[0].reset_hash, null, 'one-time tokens are not copied');
  assert.equal(Number(users.find(u => u.e === 'cara@example.com').ref_num), 10_000_002, 'a clashing referral number moved on the new account');
  assert.deepEqual(r.accountsMerged, [{ kept: 2, merged: 10_000_001, by: 'email' }]);
  assert.equal(r.tables.users.old, 2); assert.equal(r.tables.users.new, 2); assert.equal(r.tables.users.merged, 3); assert.equal(r.tables.users.accountMerges, 1);

  // Ben's history: the old fill (id 5) and the new one, both his; his old paper account stays.
  const fills = await rows(live, 'SELECT id, user_id FROM fills ORDER BY id');
  assert.deepEqual(fills.map(f => [Number(f.id) < 10_000_000, Number(f.user_id)]), [[true, 2], [false, 2]]);
  assert.equal(Number((await rows(live, 'SELECT cash FROM paper_accounts WHERE user_id = 2'))[0].cash), 98500);
  assert.equal((await rows(live, 'SELECT COUNT(*) n FROM paper_accounts WHERE user_id >= 10000000 AND user_id < 10000002'))[0].n, 0);
  assert.equal((await rows(live, "SELECT v FROM user_settings WHERE user_id = 2 AND k = 'theme'"))[0].v, '"light"', 'the newer setting wins');

  // Nothing runs: the passed schedule is missed and paused, the future one paused, the bot and Playbook off.
  const so = await rows(live, 'SELECT id, active, paused, last_result FROM scheduled_orders ORDER BY id');
  assert.equal(so[0].last_result, MISSED); assert.equal(Number(so[0].paused), 1); assert.equal(Number(so[1].paused), 1); assert.equal(so[1].last_result, null);
  assert.equal(Number((await rows(live, 'SELECT active FROM ai_bots WHERE id = 9'))[0].active), 0);
  assert.equal((await rows(live, 'SELECT mode FROM user_strategies WHERE id = 11'))[0].mode, 'manual');
  assert.deepEqual(r.paused, { ai_bots: 1, scheduled_orders: 2, user_strategies: 1 }); assert.equal(r.missed, 1);
  const was = await rows(live, "SELECT was FROM merge_paused WHERE tbl = 'user_strategies'"); assert.equal(was[0].was, 'approve');
  const notices = await rows(live, "SELECT user_id, v FROM user_settings WHERE k = 'notice' ORDER BY user_id");
  assert.deepEqual(notices.map(n => Number(n.user_id)), [1, 2]); assert.equal(JSON.parse(notices[0].v).text, NOTICE);

  // Sessions: old ones are not copied, Ben's new one moved to his account; live site settings win.
  assert.deepEqual((await rows(live, 'SELECT token_hash, user_id FROM sessions')).map(s => [s.token_hash, Number(s.user_id)]), [['ben-now', 2]]);
  const site = Object.fromEntries((await rows(live, 'SELECT k, v FROM site_settings')).map(x => [x.k, x.v]));
  assert.equal(site.maintenance, undefined, 'the old maintenance switch is not copied'); assert.ok(site.hosting); assert.equal(site.sponsored, '[]');

  // Foreign keys, one account per email, the audit log, the credential.
  assert.deepEqual(await rows(live, 'PRAGMA foreign_key_check'), []);
  assert.equal((await rows(live, 'SELECT COUNT(*) n FROM (SELECT lower(email) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1)'))[0].n, 0);
  const audit = await rows(live, "SELECT user_id, detail FROM audit_log WHERE event = 'account_merged'");
  assert.equal(Number(audit[0].user_id), 2); assert.deepEqual(JSON.parse(audit[0].detail), { from: 10_000_001, by: 'email' });
  assert.deepEqual(r.credentials, { checked: 1, decrypted: 1 });
  const ids = await rows(live, 'SELECT MAX(id) m FROM fills WHERE id < 10000000'); assert.equal(Number(ids[0].m), 5);
  // A second run adds nothing and joins nobody.
  const again = await mergeFile(live, old, { now: NOW });
  assert.equal(again.ok, true, JSON.stringify(again)); assert.equal(again.alreadyMerged, true); assert.equal(again.rowsCopied, 0);
  assert.equal((await rows(live, 'SELECT COUNT(*) n FROM users'))[0].n, 3);
});

test('a failed merge leaves the live file exactly as it was', async () => {
  const old = path.join(tmp, 'old2.db'), live = path.join(tmp, 'live2.db');
  makeOld(old); makeLive(live);
  // An old id that reaches the new range: the merge must stop.
  const c = createClient({ url: 'file:' + old }); await c.execute('PRAGMA foreign_keys = OFF'); await c.execute("UPDATE fills SET id = 10000005 WHERE id = 5"); await c.execute("UPDATE journal_notes SET fill_id = 10000005"); c.close();
  const before = sha(live);
  const { mergeFile } = await import('../scripts/turso-merge.mjs');
  const r = await mergeFile(live, old, { now: NOW });
  assert.equal(r.ok, false); assert.match(r.error, /at or above 10000000/);
  assert.equal(sha(live), before); assert.equal(fs.existsSync(live + '.merging'), false);
  // A credential that does not open with this key also stops it.
  const old3 = path.join(tmp, 'old3.db'); makeOld(old3);
  const c3 = createClient({ url: 'file:' + old3 }); await c3.execute('PRAGMA foreign_keys = OFF'); await c3.execute("UPDATE credentials SET blob = 'AAAA.BBBB.CCCC'"); c3.close();
  const r3 = await mergeFile(live, old3, { now: NOW });
  assert.equal(r3.ok, false); assert.match(r3.error, /ENCRYPTION_KEY/); assert.equal(sha(live), before);
});
