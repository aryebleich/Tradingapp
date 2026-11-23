// Merge-only (removed by scripts/old-db-cleanup.sh after the merge): copying the old database by
// sync only (scripts/turso-pull.mjs), with a fake sync source and a refused sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-olddb-'));
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
