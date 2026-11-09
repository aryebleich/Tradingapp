// Production checks: migration failures are kept and reported (not swallowed), every migrated
// column is verified, and /healthz/full combines database, schema and paper/live routing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';

const { schemaReport, migrationProblems, persistentDb, db } = await import('../src/db.js');
const s = await serve();
after(() => s.close());

test('all migrated columns exist and no migration failed on a fresh database', async () => {
  const r = await schemaReport();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.checkedColumns >= 30);
  assert.deepEqual(r.missingColumns, []);
  assert.equal(migrationProblems.length, 0);
  assert.equal(persistentDb, false); // tests use a local file
});

test('a failed migration is kept and shows in the full health check', async () => {
  // Recorded the way the start-up loop records a failure that is not "already applied".
  migrationProblems.push({ migration: 'ALTER TABLE x ADD COLUMN y', error: 'test' });
  try {
    const r = await schemaReport(); assert.equal(r.ok, false); assert.equal(r.failedMigrations, 1);
    const h = await fetch(s.base + '/healthz/full'); assert.equal(h.status, 500);
    const j = await h.json(); assert.match(j.problems.join(' '), /migration\(s\) failed/);
  } finally { migrationProblems.pop(); }
});

test('/healthz/full: database, schema and routing together; /healthz stays a simple liveness check', async () => {
  const h = await fetch(s.base + '/healthz/full'); const j = await h.json();
  assert.equal(h.status, 200, JSON.stringify(j));
  assert.equal(j.database.reachable, true); assert.equal(j.database.schemaOk, true); assert.equal(j.routing.ok, true);
  assert.equal((await fetch(s.base + '/healthz')).status, 200);
  // On Render without DATABASE_URL the full check fails (data would be lost on restart).
  process.env.RENDER = '1';
  try { const r = await fetch(s.base + '/healthz/full'); assert.equal(r.status, 500); assert.match((await r.json()).problems.join(' '), /DATABASE_URL is not set/); }
  finally { delete process.env.RENDER; }
});
