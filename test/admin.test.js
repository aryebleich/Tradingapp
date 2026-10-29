// Admin access: ADMIN_EMAIL (one or several) grants it on every visit, also to existing accounts;
// admin pages and actions stay closed to everyone else.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_EMAIL = 'boss@example.com';
const { app } = await import('../server.js');
let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());

function client() {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

test('ADMIN_EMAIL: several addresses, any case, also for accounts made before it was set', async () => {
  const boss = client(), owner = client(), guest = client();
  assert.equal((await boss('/auth/register', { email: 'Boss@Example.com', password: 'Str0ngPassword' })).body.user.role, 'admin');
  const o = await owner('/auth/register', { email: 'owner@example.com', password: 'Str0ngPassword' });
  assert.equal(o.body.user.role, 'user');
  await guest('/auth/register', { email: 'guest@example.com', password: 'Str0ngPassword' });

  // The owner's address is added later (with spaces and capitals): the next visit is admin.
  process.env.ADMIN_EMAIL = 'boss@example.com,  OWNER@example.com';
  assert.equal((await owner('/auth/me')).body.user.role, 'admin');
  assert.equal((await owner('/admin/summary')).status, 200);
  const setup = (await owner('/admin/setup')).body;
  for (const e of ['boss@example.com', 'owner@example.com']) assert.ok(setup.admins.includes(e), e);
  // The built-in owner addresses are never written out (they exist only as fingerprints).
  assert.ok(!setup.admins.includes('site-owner@example.com'));
  assert.ok(setup.items.find(x => x.name === 'Admin email').on);
  assert.equal(JSON.stringify(setup).includes('Str0ng'), false);

  // Everyone else stays out.
  for (const p of ['/admin/summary', '/admin/setup', '/admin/messages']) assert.equal((await guest(p)).status, 403);
  const gid = (await owner('/admin/summary')).body.users.find(u => u.email === 'guest@example.com').id;
  assert.equal((await guest('/admin/users/' + gid, { plan: 'elite' })).status, 403);

  // Admin tools: give a plan, make and remove an admin, with guard rails.
  assert.equal((await owner('/admin/users/' + gid, { plan: 'pro' })).status, 200);
  assert.equal((await guest('/auth/me')).body.user.plan, 'pro');
  assert.equal((await owner('/admin/users/' + gid, { plan: 'gold' })).status, 400);
  assert.equal((await owner('/admin/users/' + gid, { role: 'admin' })).status, 200);
  assert.equal((await guest('/admin/summary')).status, 200);
  assert.equal((await owner('/admin/users/' + gid, { role: 'user' })).status, 200);
  assert.equal((await guest('/admin/summary')).status, 403);
  const me = (await owner('/auth/me')).body.user.id;
  assert.match((await owner('/admin/users/' + me, { role: 'user' })).body.error, /own admin/);
  const bid = (await owner('/admin/summary')).body.users.find(u => u.email === 'boss@example.com').id;
  assert.match((await owner('/admin/users/' + bid, { role: 'user' })).body.error, /admin list/);
});

test('Gmail admin matches with dots and +tags (Google sign-in); owner can view the app as each plan', async () => {
  const { isAdminEmail } = await import('../src/auth.js');
  const prev = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'ownerthree@gmail.com';
  try {
    assert.ok(isAdminEmail('Owner.Three@gmail.com')); assert.ok(isAdminEmail('ownerthree+x@googlemail.com'));
    assert.ok(!isAdminEmail('ownerthree@example.com'));
    const c = client();
    await c('/auth/register', { email: 'arye.bleich@gmail.com', password: 'Str0ngPassword' });
    const me = (await c('/auth/me')).body.user;
    assert.equal(me.role, 'admin');
    // Previews need the password and a confirmation (test/batch9).
    assert.equal((await c('/admin/preview-plan', { plan: 'free' }, 'PUT')).status, 400);
    assert.equal((await c('/admin/preview-plan', { plan: 'free', confirmed: true, password: 'Str0ngPassword' }, 'PUT')).body.previewPlan, 'free');
    const asFree = (await c('/auth/me')).body.user;
    assert.equal(asFree.plan, 'free'); assert.equal(asFree.previewPlan, 'free'); assert.equal(asFree.role, 'admin');
    assert.equal((await c('/schedule', { symbol: 'SPY', side: 'buy', qty: 1 })).status, 402); // gated like a Starter user
    await c('/admin/preview-plan', { plan: 'ultimate', confirmed: true, password: 'Str0ngPassword' }, 'PUT');
    assert.equal((await c('/auth/me')).body.user.plan, 'ultimate');
    assert.equal((await c('/admin/preview-plan', { plan: null }, 'PUT')).body.previewPlan, null);
    assert.equal((await c('/auth/me')).body.user.previewPlan, null);
  } finally { process.env.ADMIN_EMAIL = prev; }
});
