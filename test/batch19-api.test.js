// Batch 19 through the API (fake Alpaca): the same account cannot be added twice, the combined
// portfolio and groups, and Equalize (preview, password, run).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET' });
const { app } = await import('../server.js');
let server, base, cookie = '';
const call = async (path, body, method) => {
  const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await call('/auth/register', { email: 'many@t.co', password: 'Str0ngPassword' });
  const { run } = await import('../src/db.js'); await run("UPDATE users SET plan = 'pro' WHERE email = 'many@t.co'");
});
after(() => { server.close(); mock.close(); });

test('accounts: no duplicates, combined view, groups, equalize', async () => {
  assert.equal((await call('/alpaca/keys', { keyId: 'MAINKEY', secret: 'S' })).status, 200);
  assert.equal((await call('/alpaca/accounts', { keyId: 'SUBKEY1', secret: 'S1', label: 'Kids' })).status, 200);
  assert.equal((await call('/alpaca/accounts', { keyId: 'SUBKEY2', secret: 'S2', label: 'Retirement' })).status, 200);
  // The primary account's keys again under another name: the same account, refused.
  const dup = await call('/alpaca/accounts', { keyId: 'MAINKEY', secret: 'other', label: 'Again' });
  assert.equal(dup.status, 400); assert.match(dup.body.error, /same Alpaca account/);

  const all = (await call('/combined?view=all&period=1M')).body;
  assert.equal(all.accounts.length, 3); assert.ok(all.history.points.length > 0);
  assert.equal(all.totals.count, all.accounts.filter(a => a.counted).length);
  const counted = all.accounts.filter(a => a.counted);
  assert.equal(all.totals.equity, +counted.reduce((s, a) => s + a.equity, 0).toFixed(2));

  // A group with its own view and totals.
  const g = await call('/combined/groups', { name: 'Family', accounts: ['alpaca:2', 'alpaca:3'] });
  assert.equal(g.status, 200);
  const gv = (await call(`/combined?view=g:${g.body.id}&history=0`)).body;
  assert.equal(gv.group.name, 'Family'); assert.deepEqual(gv.accounts.map(a => a.id), ['alpaca:2', 'alpaca:3']);
  assert.equal((await call('/combined/groups', { name: '', accounts: ['alpaca:2'] })).status, 400);

  // Equalize: settings, preview, the password for "place by itself every morning", run.
  assert.equal((await call('/equalize', { accounts: ['alpaca', 'alpaca:2'], daily: true, mode: 'auto' }, 'PUT')).status, 401);
  const s = await call('/equalize', { accounts: ['alpaca', 'alpaca:2'], daily: true, mode: 'auto', password: 'Str0ngPassword' }, 'PUT');
  assert.equal(s.status, 200); assert.equal(s.body.daily, true); assert.equal(s.body.mode, 'auto');
  const pv = await call('/equalize/preview', {});
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.accounts.length, 2);
  assert.equal((await call('/equalize/run', { password: 'nope' })).status, 401);
  const run = await call('/equalize/run', { password: 'Str0ngPassword' });
  assert.equal(run.status, 200); assert.ok(Array.isArray(run.body.results));
  assert.equal((await call('/equalize/preview', { accounts: ['alpaca'] })).status, 400); // one account is not enough
});
