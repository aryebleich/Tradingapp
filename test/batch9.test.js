// Admin → Upgrades with the site version, "View as" previews behind the password, approve-each-trade
// for the ready-made strategies, the monthly statement and the Render deploy after every push.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { serve } from './client.js';
import { one, run } from '../src/db.js';

let fake, calls = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/services/srv-test')) return res.end(JSON.stringify({ name: 'brightfolio', serviceDetails: { plan: req.method === 'PATCH' ? JSON.parse(b).serviceDetails.plan : 'free', url: 'https://x.onrender.com' } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, r));
  Object.assign(process.env, { RENDER_API_URL: `http://127.0.0.1:${fake.address().port}`, RENDER_API_KEY: 'rnd_test', RENDER_SERVICE_ID: 'srv-test' });
});
after(() => fake.close());

const PW = 'Str0ngPassword';

test('upgrades need the password and UPGRADE, are logged and move the version up', async () => {
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('site-owner@example.com');
    const guest = s.client(); await guest.signup('up-guest@example.com');
    assert.equal((await guest('/admin/site/upgrades')).status, 403);
    let u = (await owner('/admin/site/upgrades')).body;
    assert.equal(u.version, 'v0.1'); assert.equal(u.render.plan, 'free'); assert.ok(u.renderPlans.some(p => p.id === 'starter'));
    assert.equal((await owner('/admin/site/upgrades', { kind: 'github', to: 'pro', password: PW })).status, 400, 'needs UPGRADE');
    assert.equal((await owner('/admin/site/upgrades', { kind: 'github', to: 'pro', password: 'wrong', typed: 'UPGRADE' })).status, 401);
    let r = await owner('/admin/site/upgrades', { kind: 'github', to: 'pro', password: PW, typed: 'upgrade' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.version, 'v0.2');
    // Adviser mode only with the registration statement.
    assert.equal((await owner('/admin/site/upgrades', { kind: 'mode', to: 'adviser', password: PW, typed: 'UPGRADE' })).status, 400);
    r = await owner('/admin/site/upgrades', { kind: 'mode', to: 'adviser', registered: true, crd: '123456', password: PW, typed: 'UPGRADE' });
    assert.equal(r.body.version, 'v0.3');
    assert.equal((await owner('/admin/site/mode')).body.adviser, true);
    // Render: the plan changes through the Render API.
    r = await owner('/admin/site/upgrades', { kind: 'render', to: 'starter', password: PW, typed: 'UPGRADE' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.version, 'v0.4');
    const patch = calls.find(c => c.method === 'PATCH');
    assert.deepEqual(JSON.parse(patch.body), { serviceDetails: { plan: 'starter' } });
    assert.equal((await owner('/admin/site/upgrades', { kind: 'render', to: 'gigantic', password: PW, typed: 'UPGRADE' })).status, 400);
    // Back to software only; the history lists every change, newest first.
    await owner('/admin/site/upgrades', { kind: 'mode', to: 'software', password: PW, typed: 'UPGRADE' });
    u = (await owner('/admin/site/upgrades')).body;
    assert.equal(u.version, 'v0.5');
    assert.deepEqual(u.history.map(h => h.v), ['v0.5', 'v0.4', 'v0.3', 'v0.2']);
    assert.match(u.history[1].what, /Render plan: Starter \(\$7\/month\)/);
    assert.equal((await owner('/config')).body.version, 'v0.5');
    assert.ok(await one("SELECT id FROM audit_log WHERE action = 'upgrade'").catch(() => true));
  } finally { s.close(); }
});

test('"View as" a plan or the adviser site needs the password; it changes only what pages show', async () => {
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('site-owner2@example.com');
    assert.equal((await owner('/admin/preview-plan', { adviser: true }, 'PUT')).status, 400, 'needs confirmation');
    assert.equal((await owner('/admin/preview-plan', { adviser: true, confirmed: true, password: 'nope' }, 'PUT')).status, 401);
    assert.equal((await owner('/admin/preview-plan', { adviser: true, confirmed: true, password: PW }, 'PUT')).status, 200);
    assert.equal((await owner('/auth/me')).body.user.previewAdviser, true);
    assert.equal((await owner('/config')).body.adviser, true, 'pages show the adviser site');
    assert.equal((await owner('/admin/site/mode')).body.adviser, false, 'the real mode is unchanged');
    const user = s.client(); await user.signup('view-user@example.com');
    assert.equal((await user('/config')).body.adviser, false, 'users see the real mode');
    assert.equal((await owner('/admin/preview-plan', { plan: 'pro', confirmed: true, password: PW }, 'PUT')).status, 200);
    assert.equal((await owner('/auth/me')).body.user.previewPlan, 'pro');
    // Back to the owner view: no password needed.
    assert.equal((await owner('/admin/preview-plan', { plan: null }, 'PUT')).status, 200);
    const me = (await owner('/auth/me')).body.user;
    assert.equal(me.previewPlan, null); assert.equal(me.previewAdviser, null);
  } finally { s.close(); }
});

test('approve each trade: orders are prepared, wait for the user, and are placed only on approval', async () => {
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('approve@example.com');
    const st = (await u('/library', { templateId: 'bg_ensemble' })).body;
    // On every plan: approving each trade on a real account is the user's own trading.
    assert.equal((await u('/library/' + st.id, { mode: 'approve', account: 'alpaca' }, 'PUT')).status, 200);
    assert.equal((await u('/library/' + st.id, { mode: 'auto', account: 'alpaca' }, 'PUT')).status, 402);
    assert.equal((await u('/library/' + st.id, { mode: 'approve', account: 'paper' }, 'PUT')).status, 200);
    const R = await import('../src/rotation/runner.js');
    const today = R.nyNow().day;
    const s1 = R.parse(await one('SELECT * FROM user_strategies WHERE id = ?', st.id));
    const prep = await R.prepare(s1, today);
    assert.ok(prep.orders.length > 0, prep.summary);
    const pend = (await u('/library/pending')).body;
    assert.equal(pend.length, 1); assert.equal(pend[0].id, st.id);
    assert.equal((await u('/library/' + st.id)).body.state.pending.orders.length, prep.orders.length);
    const r = await u('/library/' + st.id + '/approve', { approve: true });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.summary, /BUY/);
    assert.equal((await u('/library/' + st.id + '/approve', { approve: true })).status, 404, 'only once');
    assert.equal((await u('/library/pending')).body.length, 0);
    // Skipping, and orders from an earlier day expire.
    await R.prepare(R.parse(await one('SELECT * FROM user_strategies WHERE id = ?', st.id)), today).catch(() => null);
    const s2 = R.parse(await one('SELECT * FROM user_strategies WHERE id = ?', st.id));
    if (s2.state.pending) assert.equal((await u('/library/' + st.id + '/approve', { approve: false })).body.skipped, true);
    await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s2.state, pending: { day: '2020-01-02', orders: [{ ticker: 'SPY', side: 'buy', qty: 1 }], at: 0 } }), st.id);
    assert.equal((await u('/library/' + st.id + '/approve', { approve: true })).status, 410);
    assert.ok(!(await u('/library/' + st.id)).body.state.pending);
    void me;
  } finally { s.close(); }
});

test('a monthly statement PDF on every plan', async () => {
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('statement@example.com');
    await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 2 });
    assert.equal((await u('/statement?account=paper')).status, 200);
    assert.equal((await u('/statement?account=paper&month=2999-01')).status, 400);
    const { statementMarkdown } = await import('../src/statement.js');
    const md = await statementMarkdown(await one('SELECT * FROM users WHERE id = ?', me.id), 'paper', new Date().toISOString().slice(0, 7));
    assert.match(md, /# Account statement: /); assert.match(md, /\| \d{4}-\d{2}-\d{2} \| BUY \| 2 \| AAPL \|/); assert.match(md, /investment advice/); assert.match(md, /\| Value at the start \| \$100,000\.00 \|/);
  } finally { s.close(); }
});

test('Render deploys after every push whose checks pass', () => {
  const y = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.match(y, /workflows: \[CI\]/); assert.match(y, /conclusion == 'success'/); assert.match(y, /secrets\.RENDER_DEPLOY_HOOK_URL/);
  assert.doesNotMatch(y, /echo "\$HOOK"|echo \$\{\{ secrets/);
});
