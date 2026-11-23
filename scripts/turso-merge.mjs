#!/usr/bin/env node
// Brings the old Turso data (a copy made by scripts/turso-pull.mjs) into the live database file
// that was started fresh (scripts/fresh-db.mjs), with the app stopped:
//   node scripts/turso-merge.mjs <live.db> <pull.db>
// - Old rows keep their ids (new rows started at 10,000,000, so they cannot collide).
// - A person who signed up again with the same email keeps the new account: the old account's rows
//   are moved onto it (every user_id column), so nothing they had is lost.
// - Where both have the same unique value (a site setting, a session), the live one stays.
// - Only columns both files have are copied; tables only in the copy are skipped and listed.
// Not one transaction (the client runs each statement on its own): migrate.sh backs the live file up
// first and puts it back if the merge fails.
// Prints one JSON line with the rows added per table and the accounts that were joined.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

export async function merge(live, pull) {
  const c = createClient({ url: 'file:' + live });
  const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
  try {
    await q('PRAGMA foreign_keys = OFF');
    await q('ATTACH DATABASE ? AS old', [pull]);
    const tablesOf = async s => (await q(`SELECT name FROM ${s}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'`)).map(r => String(r.name));
    const colsOf = async (s, t) => (await q(`PRAGMA ${s}.table_info("${t}")`)).map(r => String(r.name));
    const mine = new Set(await tablesOf('main')), theirs = await tablesOf('old');
    await q('CREATE TEMP TABLE umap (old_id INTEGER PRIMARY KEY, new_id INTEGER)');
    await q('INSERT INTO umap SELECT o.id, m.id FROM old.users o JOIN main.users m ON lower(m.email) = lower(o.email) WHERE o.id <> m.id');
    const joined = Number((await q('SELECT COUNT(*) AS n FROM umap'))[0].n);
    const added = {}, skipped = [];
    for (const t of theirs) {
      if (!mine.has(t)) { skipped.push(t); continue; }
      const mc = new Set(await colsOf('main', t)), cols = (await colsOf('old', t)).filter(x => mc.has(x));
      if (!cols.length) { skipped.push(t); continue; }
      const list = cols.map(x => `"${x}"`).join(', ');
      const pick = cols.map(x => (x === 'user_id' ? 'COALESCE((SELECT new_id FROM umap WHERE old_id = o."user_id"), o."user_id")' : `o."${x}"`)).join(', ');
      // Users that were joined to a new account by email are not copied as a second account.
      const where = t === 'users' ? ' WHERE o.id NOT IN (SELECT old_id FROM umap)' : '';
      const before = Number((await q(`SELECT COUNT(*) AS n FROM main."${t}"`))[0].n);
      await q(`INSERT OR IGNORE INTO main."${t}" (${list}) SELECT ${pick} FROM old."${t}" o${where}`);
      const n = Number((await q(`SELECT COUNT(*) AS n FROM main."${t}"`))[0].n) - before;
      if (n) added[t] = n;
    }
    const integrity = String((await q('PRAGMA integrity_check'))[0].integrity_check ?? 'ok');
    return { ok: integrity === 'ok', integrity, joinedAccounts: joined, rowsAdded: Object.values(added).reduce((a, b) => a + b, 0), added, skipped };
  } finally { c.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [live, pull] = process.argv.slice(2).map(p => path.resolve(p));
  const r = await merge(live, pull).catch(e => ({ ok: false, error: e.message }));
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
