#!/usr/bin/env node
// A new, empty database file with the full schema, ready to run before the old data can be copied:
//   node scripts/fresh-db.mjs <dest.db> [offset]
// 1. the app's own migrations create every table and index in <dest.db>
// 2. every empty table with an INTEGER PRIMARY KEY is rebuilt with AUTOINCREMENT and its counter
//    set to <offset> (default 10,000,000), so rows made from now on never take an id an older
//    database already uses, and its rows can be brought in later with their own ids.
// Prints one JSON line: { ok, file, tables, converted, offset }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function freshDb(dest, offset = 10_000_000) {
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  process.env.DB_FILE = dest; process.env.DATABASE_URL = ''; delete process.env.DATABASE_AUTH_TOKEN;
  const { db, ready } = await import('../src/db.js');
  await ready;
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
  await q('PRAGMA foreign_keys = OFF');
  const tables = await q("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name");
  const converted = [];
  for (const t of tables) {
    const name = String(t.name), sql = String(t.sql);
    if (/AUTOINCREMENT/i.test(sql) || !/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(sql)) continue;
    if (Number((await q(`SELECT COUNT(*) AS n FROM "${name}"`))[0].n) > 0) continue;
    const extras = (await q("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL", [name])).map(r => String(r.sql));
    const next = sql.replace(/\bINTEGER\s+PRIMARY\s+KEY\b(?!\s+AUTOINCREMENT)/i, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    await db.batch([`DROP TABLE "${name}"`, next, ...extras], 'write');
    converted.push(name);
  }
  for (const name of converted) await q('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', [name, offset]);
  const integrity = String((await q('PRAGMA integrity_check'))[0].integrity_check ?? 'ok');
  await q('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => {});
  db.close();
  return { ok: integrity === 'ok', file: dest, tables: tables.length, converted: converted.length, offset, integrity };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dest = path.resolve(process.argv[2] || 'data/fresh.db');
  const r = await freshDb(dest, +process.argv[3] || 10_000_000).catch(e => ({ ok: false, error: e.message }));
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
