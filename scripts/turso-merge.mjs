#!/usr/bin/env node
// Merges the old database (a copy of Turso made by scripts/turso-pull.mjs) into the live database
// file, which was started fresh on 2026-11-23 with every id counter at 10,000,000:
//   node scripts/turso-merge.mjs <live.db> <pull.db>      (the app stopped, maintenance on)
//
// What it does, in order (MIGRATION_ORACLE.md "The merge"):
//  1. Both files must pass integrity_check. Every old id must be below 10,000,000. A live row that
//     still uses an id the old data has (a table made after the fresh start) is moved up by
//     10,000,000, together with every foreign key that points at it.
//  2. Old rows are copied with their own ids. Not copied: sessions and one-time tokens (sign-in
//     links, resets, phone codes, app handoffs), caches and job slots: everyone signs in again.
//     Live site settings win (hosting, maintenance). Any other old row that cannot be copied stops
//     the merge: nothing is dropped silently.
//  3. Old automations come back paused (bots, Playbooks, scheduled orders, pairs, equalize, AI
//     funds, alerts, scanners, rules, signal hooks, open signal and news trades, the order queue).
//     Scheduled times that passed during the gap are marked "missed, not run". Each affected person
//     gets one notice in the app (user_settings 'notice'); no email or text is sent and no order.
//  4. The same person in both (same email, else the same phone): one account. The old account keeps
//     its id and history; the new account's rows move to it (on a clash the old row stays, except
//     settings, where the newer one wins); the newer password, two-factor and sign-in links are kept;
//     the new account row is removed; each merge is written to the audit log.
//  5. Checks: integrity_check, foreign_key_check (no violation that the old data did not already
//     have), one account per email, row counts per table, and a stored credential that decrypts with
//     this ENCRYPTION_KEY. Any failure: { ok: false } and the caller puts the backup back.
// Prints one JSON line: the report (counts per table, accounts merged, automations paused, time).
// mergeFile (what the command line runs) works on a copy and replaces the live file only after every
// check passed; deploy/vm/migrate.sh also keeps an exact copy of the live file and puts it back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

export const OFFSET = 10_000_000;
export const SKIP_TABLES = new Set(['sessions', 'app_handoffs', 'cache', 'job_runs']);
const TOKEN_COLUMNS = { users: ['reset_hash', 'reset_expires', 'verify_hash', 'phone_code', 'phone_code_expires', 'failed_logins', 'locked_until'] };
const LIVE_SITE_KEYS = ['maintenance', 'hosting'];
// Tables where a clash with a live row is expected and the live row stays (keyed by name, not id).
const LIVE_WINS = new Set(['site_settings']);
// The newer value wins when the same person's two accounts both have it.
const NEWER_WINS = new Set(['user_settings', 'agent_settings', 'signal_auto', 'roundup_settings', 'risk_settings']);
export const NOTICE = 'Your automations are paused after our move. Review and turn them back on.';
export const MISSED = 'missed, not run (server move)';
// [table, which rows are switched on, how they are paused] exactly as the jobs read them.
export const PAUSE = [
  ['ai_bots', 'active = 1', 'active = 0'], ['ai_funds', 'active = 1', 'active = 0'], ['alerts', 'active = 1', 'active = 0'],
  ['agents', 'deployed = 1', 'deployed = 0'], ['baskets', 'deployed = 1', 'deployed = 0'], ['channel_subs', 'active = 1', 'active = 0'],
  ['equalize', 'daily = 1', 'daily = 0'], ['family_members', 'active = 1', 'active = 0'], ['income_bots', 'active = 1', 'active = 0'],
  ['live_pairs', "status = 'running'", "status = 'paused'"], ['pair_bots', 'active = 1', 'active = 0'], ['rules', 'active = 1', 'active = 0'],
  ['scanners', 'active = 1', 'active = 0'], ['scheduled_orders', 'active = 1 AND COALESCE(paused, 0) = 0', 'paused = 1'],
  ['scripts', 'alert = 1', 'alert = 0'], ['signal_hooks', 'enabled = 1', 'enabled = 0'], ['strategies', 'deployed IS NOT NULL', 'deployed = NULL'],
  ['user_strategies', "mode IN ('auto', 'approve')", "mode = 'manual'"], ['order_queue', "status = 'pending'", "status = 'paused'"],
  ['signal_trades', "status = 'open'", "status = 'paused'"], ['newspicks_trades', "status = 'open'", "status = 'paused'"],
];

export async function merge(live, pull, { now = Date.now(), offset = OFFSET } = {}) {
  const t0 = Date.now();
  const c = createClient({ url: 'file:' + live });
  const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
  const n = async sql => Number((await q(sql))[0].n);
  const fail = msg => { throw Object.assign(new Error(msg), { mergeCheck: true }); };
  try {
    await q('PRAGMA foreign_keys = OFF');
    await q('ATTACH DATABASE ? AS old', [pull]);
    for (const s of ['main', 'old']) { const r = String((await q(`PRAGMA ${s}.integrity_check`))[0].integrity_check); if (r !== 'ok') fail(`${s}: integrity_check ${r}`); }
    const tablesOf = async s => (await q(`SELECT name FROM ${s}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'`)).map(r => String(r.name));
    const info = async (s, t) => (await q(`PRAGMA ${s}.table_info("${t}")`)).map(r => ({ name: String(r.name), pk: Number(r.pk), type: String(r.type).toUpperCase(), notnull: Number(r.notnull), dflt: r.dflt_value == null ? null : String(r.dflt_value) }));
    const fks = async (s, t) => (await q(`PRAGMA ${s}.foreign_key_list("${t}")`)).map(r => ({ from: String(r.from), table: String(r.table), to: r.to == null ? null : String(r.to) }));
    const mine = await tablesOf('main'), theirs = await tablesOf('old'), mineSet = new Set(mine);
    const meta = {};
    for (const t of mine) { const cols = await info('main', t); const pks = cols.filter(x => x.pk > 0); meta[t] = { cols, rowid: pks.length === 1 && pks[0].type === 'INTEGER' ? pks[0].name : null, fks: await fks('main', t) }; }
    // Columns that point at users: declared foreign keys, plus every user_id column.
    const userCols = mine.flatMap(t => [...new Set([...meta[t].fks.filter(f => f.table === 'users').map(f => f.from), ...meta[t].cols.filter(x => x.name === 'user_id').map(x => x.name)])].map(col => [t, col]));
    const fkBaseline = new Set((await q('PRAGMA old.foreign_key_check')).map(r => `${r.table}:${r.rowid}`));
    const report = { ok: false, startedAt: new Date(t0).toISOString(), offset, tables: {}, accountsMerged: [], paused: {}, missed: 0, noticed: 0, shifted: {}, skipped: [...SKIP_TABLES], notCopied: [] };

    // A merge that already ran (its marker is in the live file) changes nothing.
    const mark = (await q("SELECT v FROM main.site_settings WHERE k = 'old_data_merged_at'"))[0];
    if (mark) return { ok: true, alreadyMerged: true, mergedAt: JSON.parse(String(mark.v)), rowsCopied: 0, accountsMerged: [], paused: {}, ms: Date.now() - t0 };
    const raised = new Set((await q(`SELECT name FROM main.sqlite_sequence WHERE seq >= ${offset}`).catch(() => [])).map(r => String(r.name)));
    // 1. Id ranges.
    for (const t of theirs) {
      if (!mineSet.has(t) || !meta[t].rowid) continue;
      const k = meta[t].rowid;
      const big = await n(`SELECT COUNT(*) AS n FROM old."${t}" WHERE "${k}" >= ${offset}`);
      if (big) fail(`old ${t}: ${big} id(s) at or above ${offset}`);
      const clash = await n(`SELECT COUNT(*) AS n FROM main."${t}" m WHERE m."${k}" IN (SELECT "${k}" FROM old."${t}")`);
      if (!clash) continue;
      if (raised.has(t)) fail(`${t}: ${clash} live row(s) below ${offset} use ids the old data has`);
      // A table without the raised counter (made after the fresh start): move its live rows up.
      await q(`UPDATE main."${t}" SET "${k}" = "${k}" + ${offset} WHERE "${k}" < ${offset}`);
      for (const ct of mine) for (const f of meta[ct].fks.filter(f => f.table === t && (f.to === k || f.to == null))) await q(`UPDATE main."${ct}" SET "${f.from}" = "${f.from}" + ${offset} WHERE "${f.from}" < ${offset}`);
      report.shifted[t] = clash;
    }

    // 2. Copy the old rows.
    const before = {}; for (const t of mine) before[t] = await n(`SELECT COUNT(*) AS n FROM main."${t}"`);
    // Accounts in both, found before copying (email first, then phone).
    const norm = p => String(p || '').replace(/\D/g, '').slice(-10);
    const ucols = new Set(meta.users?.cols.map(x => x.name) || []);
    const UNIQUE = ['phone', 'ref_num', 'ref_code', 'google_sub', 'github_id'].filter(k => ucols.has(k));
    const sel = `id, lower(email) AS email${UNIQUE.map(k => `, "${k}"`).join('')}`;
    const oldUsers = theirs.includes('users') ? await q(`SELECT ${sel} FROM old.users`) : [];
    const newUsers = await q(`SELECT ${sel} FROM main.users`);
    const pairs = [], taken = new Set(), same = (a, b) => a != null && b != null && String(a) === String(b);
    for (const nu of newUsers) {
      let o = oldUsers.find(x => x.email && x.email === nu.email), by = 'email';
      if (!o && norm(nu.phone).length === 10) { o = oldUsers.find(x => norm(x.phone) === norm(nu.phone)); by = 'phone'; }
      for (const k of ['google_sub', 'github_id']) if (!o && ucols.has(k)) { o = oldUsers.find(x => same(x[k], nu[k])); by = k; }
      if (o && Number(o.id) === Number(nu.id)) continue; // already one account (a merge run before)
      if (o && !taken.has(Number(o.id))) { taken.add(Number(o.id)); pairs.push({ oldId: Number(o.id), newId: Number(nu.id), by }); }
    }
    // The new account of a person in both: keep a copy of its row, then free its unique values (the
    // old account row is copied in next); they come back where the old account has none.
    const snap = {};
    for (const p of pairs) {
      snap[p.newId] = (await q('SELECT * FROM main.users WHERE id = ?', [p.newId]))[0];
      await q(`UPDATE main.users SET email = 'merging-' || id || '@merge.invalid'${UNIQUE.map(k => `, "${k}" = NULL`).join('')} WHERE id = ?`, [p.newId]);
    }
    // Different people whose referral number or code (or phone) happen to be the same: the new one moves.
    report.uniqueMoved = {};
    for (const k of UNIQUE) {
      const clash = (await q(`SELECT m.id FROM main.users m JOIN old.users o ON o."${k}" = m."${k}" WHERE m."${k}" IS NOT NULL`)).map(r => Number(r.id));
      if (!clash.length) continue;
      const set = k === 'ref_num' ? `"${k}" = "${k}" + ${offset}` : k === 'ref_code' ? `"${k}" = "${k}" || '-' || id` : `"${k}" = NULL`;
      await q(`UPDATE main.users SET ${set} WHERE id IN (${clash.join(',')})`);
      report.uniqueMoved[k] = clash.length;
    }
    for (const t of theirs) {
      if (SKIP_TABLES.has(t)) continue;
      if (!mineSet.has(t)) { report.notCopied.push(t); continue; }
      const mc = new Set(meta[t].cols.map(x => x.name)), cols = (await info('old', t)).map(x => x.name).filter(x => mc.has(x));
      if (!cols.length) { report.notCopied.push(t); continue; }
      const blank = new Set(TOKEN_COLUMNS[t] || []);
      // A cleared column takes its default (NOT NULL columns such as locked_until have one).
      const dflt = Object.fromEntries(meta[t].cols.map(x => [x.name, x.dflt ?? 'NULL']));
      const pick = cols.map(x => (blank.has(x) ? dflt[x] : `o."${x}"`)).join(', ');
      const where = t === 'site_settings' ? ` WHERE o.k NOT IN (${LIVE_SITE_KEYS.map(k => `'${k}'`).join(', ')})` : '';
      const oldN = await n(`SELECT COUNT(*) AS n FROM old."${t}" o${where}`), m0 = await n(`SELECT COUNT(*) AS n FROM main."${t}"`);
      await q(`INSERT OR IGNORE INTO main."${t}" (${cols.map(x => `"${x}"`).join(', ')}) SELECT ${pick} FROM old."${t}" o${where}`);
      const added = (await n(`SELECT COUNT(*) AS n FROM main."${t}"`)) - m0;
      report.tables[t] = { old: await n(`SELECT COUNT(*) AS n FROM old."${t}"`), new: before[t], copied: added };
      if (added < oldN && !LIVE_WINS.has(t)) fail(`${t}: ${oldN - added} old row(s) clash with live rows and would be lost`);
    }

    // 3. Old automations paused; passed schedules marked missed (only rows from the old data).
    await q('CREATE TABLE IF NOT EXISTS main.merge_paused (tbl TEXT NOT NULL, row_key INTEGER, col TEXT NOT NULL, was TEXT, at INTEGER NOT NULL)');
    const oldRow = t => (meta[t].rowid ? `"${meta[t].rowid}" < ${offset}` : `user_id < ${offset}`);
    const touched = new Set();
    for (const [t, on, off] of PAUSE) {
      if (!mineSet.has(t) || !theirs.includes(t)) continue;
      const w = `(${on}) AND ${oldRow(t)}`;
      for (const r of await q(`SELECT DISTINCT user_id FROM main."${t}" WHERE ${w}`)) if (r.user_id != null) touched.add(Number(r.user_id));
      const cnt = await n(`SELECT COUNT(*) AS n FROM main."${t}" WHERE ${w}`);
      if (t === 'scheduled_orders' && cnt) {
        const missed = await n(`SELECT COUNT(*) AS n FROM main.scheduled_orders WHERE ${w} AND next_run <= ${Number(now)}`);
        await q(`UPDATE main.scheduled_orders SET last_result = '${MISSED}' WHERE ${w} AND next_run <= ${Number(now)}`);
        report.missed += missed;
      }
      if (cnt) {
        // What each row was before, so it can be put back exactly (merge_paused, kept in the live file).
        const col = off.split('=')[0].trim(), key = meta[t].rowid || 'user_id';
        await q(`INSERT INTO main.merge_paused (tbl, row_key, col, was, at) SELECT '${t}', "${key}", '${col}', CAST("${col}" AS TEXT), ${Number(now)} FROM main."${t}" WHERE ${w}`);
        await q(`UPDATE main."${t}" SET ${off} WHERE ${w}`); report.paused[t] = cnt;
      }
    }

    // 4. One account per person.
    for (const p of pairs) {
      const nu = snap[p.newId];
      for (const [t, col] of userCols) {
        if (t === 'users') continue;
        if (NEWER_WINS.has(t)) { await q(`UPDATE OR REPLACE main."${t}" SET "${col}" = ? WHERE "${col}" = ?`, [p.oldId, p.newId]); continue; }
        await q(`UPDATE OR IGNORE main."${t}" SET "${col}" = ? WHERE "${col}" = ?`, [p.oldId, p.newId]);
        const left = await n(`SELECT COUNT(*) AS n FROM main."${t}" WHERE "${col}" = ${p.newId}`);
        if (left) { await q(`DELETE FROM main."${t}" WHERE "${col}" = ?`, [p.newId]); (report.duplicatesDropped ||= {})[t] = (report.duplicatesDropped[t] || 0) + left; }
      }
      // A moved notice or touched automation now belongs to the old account.
      if (touched.delete(p.newId)) touched.add(p.oldId);
      await q('DELETE FROM main.users WHERE id = ?', [p.newId]);
      const has = new Set(meta.users.cols.map(x => x.name));
      const sets = ['pass_hash', 'password_set', 'totp_secret', 'totp_enabled', 'pin_hash'].filter(k => has.has(k) && nu[k] != null);
      for (const k of ['google_sub', 'github_id', 'phone']) if (has.has(k) && nu[k] != null && !(await n(`SELECT COUNT(*) AS n FROM main.users WHERE "${k}" = '${String(nu[k]).replace(/'/g, "''")}'`))) sets.push(`COALESCE:${k}`);
      const assign = sets.map(k => (k.startsWith('COALESCE:') ? `"${k.slice(9)}" = COALESCE("${k.slice(9)}", ?)` : `"${k}" = ?`)).join(', ');
      const vals = sets.map(k => nu[k.replace('COALESCE:', '')]);
      if (assign) await q(`UPDATE main.users SET ${assign} WHERE id = ?`, [...vals, p.oldId]);
      if (nu.role === 'admin') await q("UPDATE main.users SET role = 'admin' WHERE id = ?", [p.oldId]);
      await q("INSERT INTO main.audit_log (user_id, event, detail, ip, at) VALUES (?, 'account_merged', ?, 'merge', ?)", [p.oldId, JSON.stringify({ from: p.newId, by: p.by }), Number(now)]);
      report.accountsMerged.push({ kept: p.oldId, merged: p.newId, by: p.by });
    }
    for (const uid of touched) await q("INSERT OR REPLACE INTO main.user_settings (user_id, k, v, updated_at) VALUES (?, 'notice', ?, ?)", [uid, JSON.stringify({ text: NOTICE, at: Number(now) }), Number(now)]);
    report.noticed = touched.size;

    // 5. Checks.
    const integrity = String((await q('PRAGMA main.integrity_check'))[0].integrity_check);
    if (integrity !== 'ok') fail('integrity_check: ' + integrity);
    const fkNew = (await q('PRAGMA main.foreign_key_check')).map(r => `${r.table}:${r.rowid}`).filter(k => !fkBaseline.has(k));
    if (fkNew.length) fail(`foreign_key_check: ${fkNew.length} row(s) point at nothing (${fkNew.slice(0, 5).join(', ')})`);
    const dup = await n("SELECT COUNT(*) AS n FROM (SELECT lower(email) e FROM main.users WHERE email IS NOT NULL GROUP BY e HAVING COUNT(*) > 1)");
    if (dup) fail(`${dup} email(s) with two accounts`);
    for (const t of Object.keys(report.tables)) {
      const r = report.tables[t]; r.merged = await n(`SELECT COUNT(*) AS n FROM main."${t}"`);
      const expect = r.new + r.copied - (t === 'users' ? pairs.length : 0) - (report.duplicatesDropped?.[t] || 0);
      if (r.merged !== expect && !['user_settings', 'audit_log'].includes(t) && !NEWER_WINS.has(t)) fail(`${t}: ${r.merged} rows after the merge, expected ${expect}`);
    }
    if (report.tables.users) report.tables.users.accountMerges = pairs.length;
    // A stored broker key from the old data must open with this server's ENCRYPTION_KEY.
    const creds = theirs.includes('credentials') ? await q(`SELECT blob FROM main.credentials WHERE user_id < ${offset} LIMIT 5`) : [];
    if (creds.length) {
      const { tryDecrypt } = await import('../src/crypto.js');
      const opened = creds.filter(r => tryDecrypt(String(r.blob), 'credential') != null).length;
      report.credentials = { checked: creds.length, decrypted: opened };
      if (!opened) fail('no stored credential from the old data decrypts with this ENCRYPTION_KEY');
    } else report.credentials = { checked: 0, decrypted: 0 };
    report.integrity = integrity; report.foreignKeys = 'ok';
    await q("INSERT OR REPLACE INTO main.site_settings (k, v, updated_at) VALUES ('old_data_merged_at', ?, ?)", [JSON.stringify(new Date(Number(now)).toISOString()), Number(now)]);
    report.rowsCopied = Object.values(report.tables).reduce((a, r) => a + r.copied, 0);
    report.finishedAt = new Date().toISOString(); report.ms = Date.now() - t0; report.ok = true;
    return report;
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 400), check: !!e.mergeCheck, ms: Date.now() - t0 };
  } finally { c.close(); }
}

// The safe way round: the merge runs on a copy of the live file; only when every check passed does
// the copy replace it (the app stopped). On any failure the live file is not touched at all.
export async function mergeFile(live, pull, opts = {}) {
  const work = live + '.merging';
  for (const f of [work, work + '-wal', work + '-shm']) fs.rmSync(f, { force: true });
  const c = createClient({ url: 'file:' + live });
  try { await c.execute({ sql: 'VACUUM INTO ?', args: [work] }); } finally { c.close(); }
  const r = await merge(work, pull, opts);
  if (!r.ok) { for (const f of [work, work + '-wal', work + '-shm']) fs.rmSync(f, { force: true }); return r; }
  for (const f of [live + '-wal', live + '-shm']) fs.rmSync(f, { force: true });
  fs.renameSync(work, live);
  for (const f of [work + '-wal', work + '-shm']) fs.rmSync(f, { force: true });
  return r;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [live, pull] = process.argv.slice(2).map(p => path.resolve(p));
  const r = await mergeFile(live, pull);
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
