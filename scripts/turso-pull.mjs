#!/usr/bin/env node
// Copies the whole Turso database into a local SQLite file without a single SQL read: an embedded
// replica (libSQL) asks Turso for the database's pages ("sync"), which Turso bills as syncs, not as
// rows read, so it still works when the monthly read limit blocks every SELECT.
//
//   node scripts/turso-pull.mjs [dest]     dest defaults to <DB dir>/pull.db (data/pull.db)
//
// Needs DATABASE_URL (libsql://...) and DATABASE_AUTH_TOKEN. sync() runs until no frames are left,
// the replica is closed, then the file is opened on its own and must pass PRAGMA integrity_check.
// Prints one JSON line: { ok, method, file, bytes, ms, syncs, frames, tables, rows, counts } or
// { ok: false, refused, error } (refused = Turso said no, e.g. the plan blocks syncs too).
// Never prints the URL's token or any value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const REFUSED = /BLOCKED|forbidden|upgrade your plan|quota|limit|401|403|unauthori[sz]ed|permission/i;
export async function countRows(file, makeClient = createClient) {
  const c = makeClient({ url: 'file:' + file });
  try {
    const integrity = String((await c.execute('PRAGMA integrity_check')).rows[0][0]);
    const names = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' ORDER BY name")).rows.map(r => r.name ?? r[0]);
    const counts = {};
    for (const t of names) counts[t] = Number((await c.execute(`SELECT COUNT(*) FROM "${t}"`)).rows[0][0]);
    return { integrity, counts };
  } finally { c.close(); }
}

export async function pull({ dest, syncUrl = process.env.DATABASE_URL, authToken = process.env.DATABASE_AUTH_TOKEN, makeClient = createClient, maxSyncs = 500 } = {}) {
  const t0 = Date.now();
  if (!syncUrl || !/^(libsql|https?|wss?):\/\//.test(syncUrl)) return { ok: false, refused: false, error: 'DATABASE_URL is not a Turso address (libsql://...)' };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (const f of [dest, dest + '-wal', dest + '-shm', dest + '-info', dest + '-client_wal_index']) fs.rmSync(f, { force: true });
  let c, syncs = 0, frames = 0;
  try {
    c = makeClient({ url: 'file:' + dest, syncUrl, authToken });
    for (;;) {
      const r = await c.sync(); syncs++;
      const n = Number(r?.frames_synced ?? r?.framesSynced ?? 0); frames += n;
      if (!n || syncs >= maxSyncs) break;
    }
  } catch (e) {
    const msg = String(e?.message || e).replace(/(authToken|token|Bearer)\S*/gi, '$1[hidden]').slice(0, 300);
    return { ok: false, refused: REFUSED.test(msg), error: msg, syncs, ms: Date.now() - t0 };
  } finally { try { c?.close(); } catch {} }
  if (!fs.existsSync(dest)) return { ok: false, refused: false, error: 'sync finished but wrote no file', syncs };
  const { integrity, counts } = await countRows(dest, makeClient);
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  return { ok: integrity === 'ok' && Object.keys(counts).length > 0, method: 'embedded-replica-sync', file: dest, bytes: fs.statSync(dest).size, ms: Date.now() - t0, syncs, frames, integrity, tables: Object.keys(counts).length, rows, counts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : path.resolve('data');
  const dest = path.resolve(process.argv[2] || path.join(dataDir, 'pull.db'));
  const r = await pull({ dest });
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : r.refused ? 3 : 1);
}
