// Rows read: every index the read audit added exists after the migrations run, and the queries the
// background jobs run most often use an index instead of scanning their table (READS_AUDIT.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
const WANT = [...src.matchAll(/CREATE INDEX IF NOT EXISTS (ix_\w+) ON (\w+)/g)].map(m => [m[1], m[2]]);

test('every new index exists after the migrations', async () => {
  const { db, ready } = await import('../src/db.js'); await ready;
  assert.ok(WANT.length >= 90, String(WANT.length));
  const have = new Set((await db.execute("SELECT name FROM sqlite_master WHERE type = 'index'")).rows.map(r => r.name));
  const missing = WANT.filter(([n]) => !have.has(n)).map(([n]) => n);
  assert.deepEqual(missing, []);
});

test('the hot queries use an index (no full table scan)', async () => {
  const { db, ready } = await import('../src/db.js'); await ready;
  const plan = async sql => (await db.execute({ sql: 'EXPLAIN QUERY PLAN ' + sql, args: Array((sql.match(/\?/g) || []).length).fill(1) })).rows.map(r => String(r.detail ?? r[3])).join(' | ');
  for (const sql of [
    'SELECT * FROM sessions WHERE token_hash = ?',
    'DELETE FROM job_runs WHERE at < ?',
    'DELETE FROM sessions WHERE expires_at < ?',
    'SELECT id FROM scheduled_orders WHERE active = 1 AND next_run <= ?',
    'SELECT * FROM alerts WHERE active = 1',
    "SELECT user_id, v FROM user_settings WHERE k = 'drip'",
    'SELECT * FROM fills WHERE user_id = ? AND account = ? AND at > ?',
    'SELECT * FROM equalize WHERE daily = 1',
    "SELECT * FROM live_pairs WHERE status = 'running'",
    'SELECT * FROM pair_bots WHERE active = 1',
    'SELECT component, MAX(t) t FROM status_checks GROUP BY component',
  ]) {
    const p = await plan(sql);
    assert.ok(!/\bSCAN (TABLE )?\w+(?! USING)( |$|\|)/.test(p.replace(/USING (COVERING )?INDEX \w+( \([^)]*\))?/g, 'USING')), `${sql} → ${p}`);
  }
});
