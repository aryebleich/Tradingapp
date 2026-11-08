// Batch 20 (part 2): business tools are the owner's only (the currency converter is for everyone),
// public trader profiles and Top traders, and the robo-advisor's risk level.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from '../src/profiles.js';
import { riskLevel, MODELS } from '../public/pages/social.js';

const { app } = await import('../server.js');
let server, base, cookie = '';
const call = async (path, body, method) => {
  const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await call('/auth/register', { email: 'social-a@example.com', password: 'Str0ngPassword1', agree: true });
  const me = (await call('/auth/me')).body;
  if (me?.user?.role === 'admin') { cookie = ''; await call('/auth/register', { email: 'social-b@example.com', password: 'Str0ngPassword1', agree: true }); }
});
after(() => server.close());

test('business books are for admins only; the currency converter is not', async () => {
  assert.equal((await call('/biz/overview')).status, 403);
  assert.equal((await call('/biz/invoices')).status, 403);
  assert.notEqual((await call('/biz/fx?from=USD&to=USD&amount=5')).status, 403);
});

test('profiles: off by default, percentages only, private profile is not found', async () => {
  const me = (await call('/profiles/me')).body;
  assert.equal(me.on, false); assert.match(me.handle, /^[0-9a-f]{6}$/);
  assert.equal((await call('/profiles/' + me.handle)).status, 404);
  const put = await call('/profiles/me', { on: true, bio: 'Index <b>fan</b>', account: 'paper' }, 'PUT');
  assert.equal(put.status, 200); assert.equal(put.body.bio, 'Index bfan/b');
  const p = (await call('/profiles/' + me.handle)).body;
  assert.equal(p.handle, me.handle); assert.ok(Array.isArray(p.holdings)); assert.ok(!('equity' in p));
  assert.ok(JSON.stringify(p).indexOf('@') === -1, 'no email');
  const top = (await call('/profiles/top?period=y1')).body;
  assert.equal(top.period, 'y1'); assert.ok(Array.isArray(top.traders));
});

test('performance: return and largest drop over a period', () => {
  const day = i => new Date(Date.now() - (30 - i) * 864e5).toISOString().slice(0, 10);
  const rows = [100, 110, 99, 120].map((equity, i) => ({ day: day(i * 5), equity }));
  const p = performance(rows, 31);
  assert.equal(p.ret, 20); assert.equal(p.drawdown, -10); assert.equal(p.points, 4);
  assert.equal(performance(rows.slice(0, 1), 31).ret, null);
});

test('robo-advisor: risk level from the answers, capped by the horizon; every mix adds up to 100', () => {
  for (const m of Object.values(MODELS)) assert.equal(Object.values(m.mix).reduce((s, x) => s + x, 0), 100, m.name);
  assert.equal(riskLevel({ horizon: 5, drop: 5, goal: 5, income: 4, experience: 4 }), 5);
  assert.equal(riskLevel({ horizon: 1, drop: 5, goal: 5, income: 4, experience: 4 }), 2);
  assert.equal(riskLevel({ horizon: 3, drop: 5, goal: 5, income: 4, experience: 4 }), 3);
  assert.equal(riskLevel({ horizon: 5, drop: 1, goal: 1, income: 2, experience: 2 }), 2);
  assert.equal(riskLevel({ horizon: 5 }), null);
});
