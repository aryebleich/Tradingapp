// Developer API (/api/v1) and account types: personal keys (hashed, scopes, rate limits, revocation),
// Playbooks over the API through the same handlers, real-money actions refused over the API, and
// business account types offered only where the broker supports them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startMock } from './mock-alpaca.js';

const mock = await startMock(); mock.autoFill = true;
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url });
const { app } = await import('../server.js');
const { one, all, run } = await import('../src/db.js');
const { sha256 } = await import('../src/crypto.js');
const { scopeFor } = await import('../src/apiv1.js');

let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const v1 = (key, path, body, method) => fetch(base + '/api/v1' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const c = client();
let uid;
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  uid = (await c('/auth/register', { email: 'apiv1@example.com', password: 'Str0ngPassword1', agree: true })).body.user.id;
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = ?", uid);
});
after(() => { server.close(); mock.close(); });

const pb = { kind: 'playbook', version: 1, rebalance: 'monthly', root: { type: 'group', weighting: 'equal', children: [{ type: 'asset', ticker: 'SPY' }, { type: 'asset', ticker: 'AGG' }] } };

test('keys: read-only by default, stored hashed, shown once; scopes are checked per request', async () => {
  assert.equal(scopeFor('GET', '/playbooks'), 'read'); assert.equal(scopeFor('POST', '/playbooks/3/deploy'), 'trade'); assert.equal(scopeFor('PUT', '/playbooks/3'), 'write');
  const k = await c('/apikeys', { name: 'Reader' });
  assert.equal(k.status, 200); assert.match(k.body.token, /^bk_/); assert.deepEqual(k.body.scopes, ['read']);
  const row = await one("SELECT token_hash, scopes FROM api_tokens WHERE user_id = ? AND kind = 'api'", uid);
  assert.equal(row.token_hash, sha256(k.body.token)); assert.ok(!JSON.stringify(row).includes(k.body.token), 'never stored in plain text');
  assert.ok(!JSON.stringify((await c('/apikeys')).body).includes(k.body.token), 'not shown again');
  assert.equal((await v1(null, '/playbooks')).status, 401);
  assert.equal((await v1('bk_nope', '/playbooks')).status, 401);
  assert.equal((await v1(k.body.token, '/playbooks')).status, 200);
  const w = await v1(k.body.token, '/playbooks', { name: 'x', playbook: pb });
  assert.equal(w.status, 403); assert.match(w.body.error, /"write" scope/);
  assert.equal((await c('/apikeys', { scopes: ['admin'] })).status, 400);
  // Agent tokens and API keys stay apart.
  assert.equal((await c('/agents/tokens')).body?.length ?? 0, 0);
});

test('Playbooks over the API: create, backtest, deploy on paper, pause, history, preview, accounts; real money refused', async () => {
  const k = (await c('/apikeys', { name: 'Trader', scopes: ['write', 'trade'], ratePerMin: 120 })).body.token;
  const p = await v1(k, '/playbooks', { name: 'From the API', playbook: pb });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const bad = await v1(k, '/playbooks', { name: 'Bad', playbook: { root: { type: 'asset', ticker: '9' } } });
  assert.equal(bad.status, 400); assert.ok(bad.body.problems.length);
  assert.equal((await v1(k, `/playbooks/${p.body.id}/backtest`, { years: 3 })).status, 200);
  const live = await v1(k, `/playbooks/${p.body.id}/deploy`, { account: 'alpaca' });
  assert.equal(live.status, 403); assert.match(live.body.error, /from the website/);
  const d = await v1(k, `/playbooks/${p.body.id}/deploy`, { account: 'paper', allocation: 25 });
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.equal(d.body.mode, 'auto');
  assert.equal((await v1(k, `/playbooks/${p.body.id}/pause`, {})).body.paused, true);
  assert.ok((await v1(k, `/playbooks/${p.body.id}/history`)).body.some(x => x.kind === 'deployed'));
  assert.equal((await v1(k, `/playbooks/${p.body.id}/preview`)).status, 200);
  const ex = await v1(k, `/playbooks/${p.body.id}/execute`, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.ok((await all('SELECT id FROM fills WHERE user_id = ? AND source = ?', uid, `strategy:${p.body.id}`)).length, 'orders through placeOrder');
  const a = await v1(k, '/accounts');
  assert.equal(a.status, 200); assert.ok(a.body.some(x => x.id === 'paper'));
});

test('rate limit per key, and revocation', async () => {
  const k = await c('/apikeys', { name: 'Slow', ratePerMin: 2 });
  assert.equal((await v1(k.body.token, '/me')).status, 200);
  assert.equal((await v1(k.body.token, '/me')).status, 200);
  const third = await v1(k.body.token, '/me');
  assert.equal(third.status, 429);
  const id = (await c('/apikeys')).body.keys.find(x => x.name === 'Slow').id;
  assert.equal((await c('/apikeys/' + id, null, 'DELETE')).status, 200);
  const r = await v1(k.body.token, '/me');
  assert.equal(r.status, 401); assert.match(r.body.error, /revoked/);
});

test('OpenAPI spec and docs page are published', async () => {
  const spec = JSON.parse(fs.readFileSync('public/openapi.json', 'utf8'));
  assert.equal(spec.openapi, '3.1.0');
  for (const p of ['/playbooks', '/playbooks/{id}/backtest', '/playbooks/{id}/deploy', '/playbooks/{id}/pause', '/playbooks/{id}/history', '/playbooks/{id}/preview', '/accounts']) assert.ok(spec.paths[p], p);
  assert.equal((await fetch(base + '/openapi.json')).status, 200);
  const d = await fetch(base + '/developers', { redirect: 'manual' });
  assert.equal(d.status, 302); assert.match(d.headers.get('location'), /#\/developers/);
});

test('account types: business types with entity name, only where the broker supports them', async () => {
  const R = await import('../src/retirement.js');
  assert.ok(R.supportFor('paper').types.includes('business_llc'));
  assert.ok(!R.supportFor('alpaca').types.includes('business_llc'));
  assert.ok(R.supportFor('alpaca').types.includes('roth_ira'), 'IRA labels are kept');
  assert.equal((await c('/retirement/accounts', { accounts: { paper: 'business_llc' } }, 'PUT')).status, 400, 'entity name needed');
  const ok = await c('/retirement/accounts', { accounts: { paper: 'family_office' }, entities: { paper: { name: 'Example Family Office', entityType: 'LLC' } } }, 'PUT');
  assert.equal(ok.status, 200); assert.equal(ok.body.entities.paper.name, 'Example Family Office');
  const no = await c('/retirement/accounts', { accounts: { alpaca: 'business_llc' }, entities: { alpaca: { name: 'X LLC' } } }, 'PUT');
  assert.equal(no.status, 400); assert.match(no.body.error, /cannot be set up/);
  assert.equal((await c('/retirement/accounts', { accounts: { alpaca: 'roth_ira' } }, 'PUT')).status, 200);
  const g = await c('/retirement');
  assert.ok(g.body.businessTypes.business_llc && g.body.support.alpaca);
});
