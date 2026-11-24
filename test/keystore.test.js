// The key store (src/keystore.js): secret() reads Admin first, then the environment; values are
// encrypted at rest; Admin → Keys needs admin plus step-up and never returns a value; removing a key
// falls back to the server .env; ENCRYPTION_KEY can never be stored; "copy to .env" leaves only an
// encrypted request; every change is audited.
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const path = await import('node:path');
process.env.KS_TEST_FROM_ENV = 'env-value-1234';
const { app } = await import('../server.js');
const K = await import('../src/keystore.js');
const { one, all, dbFile } = await import('../src/db.js');

let server, base;
before(async () => { await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }); });
after(() => server.close());
function client() {
  const jar = {};
  return async (p, body, method) => {
    const r = await fetch(base + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json, text };
  };
}

test('secret() prefers the key store, then the environment; removing falls back to the environment', async () => {
  assert.equal(K.secret('KS_TEST_FROM_ENV'), 'env-value-1234');
  assert.equal(K.source('KS_TEST_FROM_ENV'), 'env');
  await K.setSecret('KS_TEST_FROM_ENV', 'admin-value-9876', { id: null, email: 'owner@example.com' });
  assert.equal(K.secret('KS_TEST_FROM_ENV'), 'admin-value-9876');
  assert.equal(process.env.KS_TEST_FROM_ENV, 'admin-value-9876', 'code that reads process.env sees the Admin value at once');
  assert.equal(K.source('KS_TEST_FROM_ENV'), 'admin');
  await K.removeSecret('KS_TEST_FROM_ENV');
  assert.equal(K.secret('KS_TEST_FROM_ENV'), 'env-value-1234');
  assert.equal(K.secret('KS_NEVER_SET'), '');
  assert.equal(K.source('KS_NEVER_SET'), 'missing');
});

test('values are encrypted at rest and a second worker picks a change up from the database', async () => {
  await K.setSecret('KS_TEST_AT_REST', 'sk-test-plaintext-abcdef', null);
  const row = await one('SELECT * FROM secrets WHERE name = ?', 'KS_TEST_AT_REST');
  assert.ok(row && row.blob, 'a row');
  assert.equal(JSON.stringify(row).includes('plaintext'), false, 'the value is not stored in the clear');
  assert.equal(row.last4, 'cdef');
  if (dbFile) assert.equal(fs.readFileSync(dbFile).includes(Buffer.from('sk-test-plaintext-abcdef')), false, 'not in the database file either');
  // Another worker: its memory is refreshed from the table by the version check.
  const { run } = await import('../src/db.js');
  await run('DELETE FROM secrets WHERE name = ?', 'KS_TEST_AT_REST');
  await K.refresh();
  assert.equal(K.secret('KS_TEST_AT_REST'), '');
});

test('ENCRYPTION_KEY and host settings can never go in the key store', async () => {
  await assert.rejects(K.setSecret('ENCRYPTION_KEY', 'x'.repeat(40)), /server \.env only/);
  await assert.rejects(K.setSecret('NODE_OPTIONS', '--inspect'), /set by the server/);
  await assert.rejects(K.setSecret('bad name', 'x'), /not a valid name/);
  await assert.rejects(K.setSecret('KS_MASKED', 'abc•••1234'), /masked/);
  assert.equal((await all("SELECT name FROM secrets WHERE name = 'ENCRYPTION_KEY'")).length, 0);
});

test('Admin → Keys: admin plus step-up for everything, never a value in any answer, every change audited', async () => {
  const owner = client(), member = client();
  await owner('/auth/register', { email: 'keys-owner@example.com', password: 'Str0ngPassword' });
  await member('/auth/register', { email: 'keys-member@example.com', password: 'Str0ngPassword' });
  const ownerRow = await one("SELECT role FROM users WHERE email = 'keys-owner@example.com'");
  if (ownerRow.role !== 'admin') { const { run } = await import('../src/db.js'); await run("UPDATE users SET role = 'admin' WHERE email = 'keys-owner@example.com'"); (await import('../src/auth.js')).AUTH_CACHE.clear(); }
  assert.equal((await member('/admin/keys')).status, 403, 'not for members');
  const locked = await owner('/admin/keys');
  assert.equal(locked.status, 403); assert.equal(locked.body.adminUnlock, true, 'asks for the step-up first');
  assert.equal((await owner('/admin/keys/OPENAI_API_KEY', { value: 'sk-proj-SECRET-VALUE-zz99' }, 'PUT')).status, 403, 'no change without the step-up');
  assert.equal((await owner('/admin/server/unlock', { password: 'wrong' })).status, 403);
  assert.equal((await owner('/admin/server/unlock', { password: 'Str0ngPassword' })).status, 200);

  const put = await owner('/admin/keys/OPENAI_API_KEY', { value: 'sk-proj-SECRET-VALUE-zz99' }, 'PUT');
  assert.equal(put.status, 200); assert.equal(put.body.last4, 'zz99');
  assert.equal(put.text.includes('SECRET-VALUE'), false);
  assert.equal(K.secret('OPENAI_API_KEY'), 'sk-proj-SECRET-VALUE-zz99');
  const list = await owner('/admin/keys');
  assert.equal(list.status, 200);
  assert.equal(list.text.includes('SECRET-VALUE'), false, 'the list never holds a value');
  const row = list.body.groups.flatMap(g => g.keys).find(k => k.name === 'OPENAI_API_KEY');
  assert.equal(row.source, 'admin'); assert.equal(row.last4, 'zz99'); assert.equal(row.group, 'AI'); assert.ok(row.url && row.what);
  assert.equal(row.value, null); assert.equal(row.changedBy, 'keys-owner@example.com'); assert.ok(row.changedAt);
  const enc = list.body.groups.flatMap(g => g.keys).find(k => k.name === 'ENCRYPTION_KEY');
  assert.equal(enc.envOnly, true); assert.equal(enc.value, null);
  assert.equal((await owner('/admin/keys/ENCRYPTION_KEY', { value: 'y'.repeat(40) }, 'PUT')).status, 400);
  // The test call goes to the provider; its answer never carries the value.
  const t = await owner('/admin/keys/OPENAI_API_KEY/test', {});
  assert.equal(t.status, 200); assert.equal(t.text.includes('SECRET-VALUE'), false);
  // Copy to the server .env: only an encrypted request on the data volume.
  const cp = await owner('/admin/keys/OPENAI_API_KEY/copy-env', {});
  if (dbFile) {
    assert.equal(cp.status, 200);
    const f = path.join(path.dirname(dbFile), '.env-request');
    assert.ok(fs.existsSync(f)); assert.equal(fs.readFileSync(f, 'utf8').includes('SECRET-VALUE'), false); fs.rmSync(f);
  }
  assert.equal((await owner('/admin/keys/OPENAI_API_KEY', null, 'DELETE')).status, 200);
  assert.equal(K.source('OPENAI_API_KEY'), process.env.OPENAI_API_KEY ? 'env' : 'missing');
  const events = (await all("SELECT event, detail FROM audit_log WHERE event LIKE 'key_%' ORDER BY id")).map(r => r.event);
  for (const e of ['key_set', 'key_test', 'key_removed']) assert.ok(events.includes(e), e);
  assert.equal(JSON.stringify(await all("SELECT detail FROM audit_log WHERE event LIKE 'key_%'")).includes('SECRET-VALUE'), false, 'the audit log never holds a value');
});
