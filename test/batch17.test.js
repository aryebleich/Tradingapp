// Batch 17: paper stays paper and live stays live (per request and per order), no typing step-up,
// Admin → Users (delete with all data, live P&L, sign out), sign-up by text with a 5-digit
// referral code and the commands every plan gets, Retirement & IRAs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
mock.autoFill = true;
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET' });
const { app } = await import('../server.js');
const { one, all, run } = await import('../src/db.js');
const { assertVenue } = await import('../src/alpaca/trading.js');
const R = await import('../src/retirement.js');

let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const text = async (from, body) => {
  const r = await fetch(base + '/twilio/sms', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: from, Body: body, NumMedia: '0' }) });
  return (/<Message>([\s\S]*)<\/Message>/.exec(await r.text())?.[1] || '').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
};
const owner = client();
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await owner('/auth/register', { email: 'owner@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); mock.close(); });

test('paper is paper, live is live: the server guard, the account-number check and the order path', async () => {
  assert.throws(() => assertVenue('https://paper-api.alpaca.markets', true), /real-money request was about to go to a paper server/);
  assert.throws(() => assertVenue('https://api.alpaca.markets', false), /paper request was about to go to the real-money server/);
  assert.doesNotThrow(() => assertVenue('https://api.alpaca.markets', true));
  const rr = await (await fetch(base + '/healthz/routing')).json();
  assert.equal(rr.ok, true, JSON.stringify(rr.problems));

  const u = client(); await u('/auth/register', { email: 'route@example.com', password: 'Str0ngPassword1', agree: true });
  // The practice account fills inside Brightolio: nothing reaches the broker.
  const before = mock.log.filter(x => /\/orders$/.test(x.path) && x.method === 'POST').length;
  const p = await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 1 });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(mock.log.filter(x => /\/orders$/.test(x.path) && x.method === 'POST').length, before);
  // Paper keys saved as paper: the paper server, a PA account.
  assert.equal((await u('/alpaca/keys', { keyId: 'PAPERKEY', secret: 'S' })).status, 200);
  const a = await u('/orders', { account: 'alpaca', symbol: 'AAPL', side: 'buy', qty: 1 });
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.live, false);
  const lastPaper = mock.log.filter(x => x.method === 'POST' && x.path === '/v2/orders').at(-1);
  assert.equal(lastPaper.headers['apca-api-key-id'], 'PAPERKEY'); assert.equal(lastPaper.live, false);

  // Keys saved as live that open a paper account (PA…) are refused before anything is sent.
  const v = client(); await v('/auth/register', { email: 'mixup@example.com', password: 'Str0ngPassword1', agree: true });
  const was = process.env.ALPACA_LIVE_URL; process.env.ALPACA_LIVE_URL = mock.url; // a "live" URL that answers with a paper account
  try {
    assert.equal((await v('/alpaca/keys', { keyId: 'MIXKEY', secret: 'S', live: true })).status, 200);
    const n = mock.log.filter(x => x.method === 'POST' && /orders$/.test(x.path)).length;
    const bad = await v('/orders', { account: 'alpaca', symbol: 'AAPL', side: 'buy', qty: 1 });
    assert.equal(bad.status, 409); assert.match(bad.body.error, /paper \(practice\) account but are saved as real money/);
    assert.equal(mock.log.filter(x => x.method === 'POST' && /orders$/.test(x.path)).length, n, 'nothing was sent');
  } finally { process.env.ALPACA_LIVE_URL = was; }
  // Real live keys: the live server, a real account number, marked live.
  const w = client(); await w('/auth/register', { email: 'livekeys@example.com', password: 'Str0ngPassword1', agree: true });
  assert.equal((await w('/alpaca/keys', { keyId: 'LIVEKEY2', secret: 'S', live: true })).status, 200);
  const l = await w('/orders', { account: 'alpaca', symbol: 'AAPL', side: 'buy', qty: 1 });
  assert.equal(l.status, 200, JSON.stringify(l.body)); assert.equal(l.body.live, true);
  assert.ok(mock.log.some(x => x.method === 'POST' && x.path === '/v2/orders' && x.live && x.headers['apca-api-key-id'] === 'LIVEKEY2'));
});

test('no typing-rhythm step-up: odd typing never asks for the password again', async () => {
  const u = client(); await u('/auth/register', { email: 'typing@example.com', password: 'Str0ngPassword1', agree: true });
  for (let i = 0; i < 3; i++) assert.equal((await u('/security/behavior', { flightMean: 900 + i, flightSd: 400, dwellMean: 500, dwellSd: 300, keys: 50 })).body.stepUp, false);
  const login = await u('/auth/login', { email: 'typing@example.com', password: 'Str0ngPassword1', kd: { flightMean: 2000, flightSd: 900, dwellMean: 900, dwellSd: 400, keys: 30 } });
  assert.equal(login.status, 200);
  assert.equal((await u('/security')).body.stepUp, false);
  assert.equal((await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 1 })).status, 200);
});

test('Admin → Users: details, live P&L, sign out everywhere, delete with all data', async () => {
  const u = client(); const reg = await u('/auth/register', { email: 'gone@example.com', password: 'Str0ngPassword1', agree: true });
  const id = reg.body.user.id;
  await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 2 });
  await u('/alerts', { symbol: 'AAPL', op: 'above', price: 500 });
  await run("INSERT INTO user_settings (user_id, k, v) VALUES (?, 'marketWatch', '[\"AAPL\"]') ON CONFLICT DO NOTHING", id).catch(() => {});
  const d = (await owner('/admin/users/' + id)).body;
  assert.equal(d.email, 'gone@example.com'); assert.equal(d.paper.positions, 1); assert.ok(d.sessions >= 1);
  assert.deepEqual((await owner(`/admin/users/${id}/pnl`)).body.accounts, []); // paper only: no real money
  // Live P&L from a live account: open P&L from the broker.
  const lv = client(); const lr = await lv('/auth/register', { email: 'livepnl@example.com', password: 'Str0ngPassword1', agree: true });
  await lv('/alpaca/keys', { keyId: 'PNLKEY', secret: 'S', live: true });
  const pn = (await owner(`/admin/users/${lr.body.user.id}/pnl`)).body;
  assert.equal(pn.accounts.length, 1); assert.equal(pn.accounts[0].account, 'alpaca'); assert.ok(Number.isFinite(pn.total));
  const all17 = (await owner('/admin/users/live-pnl')).body;
  assert.ok(all17.users.some(x => x.email === 'livepnl@example.com'));
  assert.equal((await u('/admin/users/live-pnl')).status, 403);
  // Sign out everywhere.
  assert.ok((await owner(`/admin/users/${id}/signout`, {})).body.sessions >= 1);
  assert.equal((await u('/auth/me')).body.user, null);
  // Delete: needs DELETE and the admin's password; never yourself.
  assert.equal((await owner('/admin/users/' + id, { word: 'nope', password: 'Str0ngPassword1' }, 'DELETE')).status, 400);
  assert.equal((await owner('/admin/users/' + id, { word: 'DELETE', password: 'wrong' }, 'DELETE')).status, 401);
  const me = (await owner('/auth/me')).body.user;
  assert.equal((await owner('/admin/users/' + me.id, { word: 'DELETE', password: 'Str0ngPassword1' }, 'DELETE')).status, 400);
  const del = await owner('/admin/users/' + id, { word: 'DELETE', password: 'Str0ngPassword1' }, 'DELETE');
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(await one('SELECT 1 FROM users WHERE id = ?', id), undefined);
  for (const t of ['positions', 'fills', 'alerts', 'paper_accounts', 'sessions', 'user_settings', 'exec_audit']) {
    const n = (await one(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`, id)).n;
    assert.equal(n, t === 'exec_audit' ? n : 0, t);
  }
  assert.ok((await one('SELECT COUNT(*) n FROM exec_audit WHERE user_id = ?', id)).n > 0, 'the order audit chain is kept');
  assert.equal((await owner('/admin/users/' + id)).status, 404);
});

test('sign up by text: welcome, email with a 5-digit referral code, commands for every plan', async () => {
  const w = await text('+18455550601', 'hello');
  assert.match(w, /Welcome to Brightolio!/); assert.match(w, /reply with your email address/); assert.match(w, /name@example\.com 12345/);
  // A referrer's 5-digit code.
  const ref = client(); const rr = await ref('/auth/register', { email: 'referrer@example.com', password: 'Str0ngPassword1', agree: true });
  const { refNumFor } = await import('../src/smssignup.js');
  const code = await refNumFor(rr.body.user.id);
  assert.match(code, /^\d{5}$/); assert.equal(await refNumFor(rr.body.user.id), code, 'stable');
  assert.match(await text('+18455550601', 'sam@example.com 99999'), /could not find referral code 99999/);
  const ok = await text('+18455550601', `Sam@Example.com ${code}`);
  assert.match(ok, /You're in!/); assert.match(ok, /sam@example\.com/); assert.match(ok, /AAPL INFO/);
  const u = await one('SELECT * FROM users WHERE email = ?', 'sam@example.com');
  assert.equal(u.phone, '+18455550601'); assert.equal(u.phone_verified, 1); assert.equal(u.referred_by, rr.body.user.id);
  assert.ok(u.reset_hash, 'a set-password link was emailed');
  assert.match(await text('+18455550602', 'sam@example.com'), /already has a Brightolio account/);
  // Starter (free) by text: look-ups, watchlist, alerts, plan, referral code.
  assert.match(await text('+18455550601', 'AAPL'), /AAPL \$/);
  assert.match(await text('+18455550601', 'WATCH TSLA'), /Added TSLA[\s\S]*TSLA \$/);
  assert.match(await text('+18455550601', 'LIST'), /Your watchlist:[\s\S]*TSLA/);
  assert.match(await text('+18455550601', 'ALERT AAPL 500'), /Alert set: we'll text you when AAPL goes above \$500\.00/);
  assert.match(await text('+18455550601', 'ALERTS'), /AAPL above \$500\.00/);
  assert.match(await text('+18455550601', 'PLAN'), /Your plan: Starter/);
  assert.match(await text('+18455550601', 'MY CODE'), /Your referral code: \d{5}/);
  assert.match(await text('+18455550601', 'how is the market doing today?'), /part of Brightolio Pro/);
  assert.match(await text('+18455550601', 'HELP'), /every plan/);
  // TALK still reaches a person; APPLY still opens the brokerage application flow when it is on.
  assert.match(await text('+18455550603', 'TALK please'), /Thanks for your message/);
});

test('Retirement & IRAs: limits, phase-outs, planner, IRA accounts on the tax page', async () => {
  assert.equal(R.LIMITS.ira, 7500); assert.equal(R.LIMITS.k401, 24500);
  assert.equal(R.phaseOut(7500, 100000, [153000, 168000]), 7500);
  assert.equal(R.phaseOut(7500, 160500, [153000, 168000]), 3750);
  assert.equal(R.phaseOut(7500, 167990, [153000, 168000]), 200); // the $200 floor
  assert.equal(R.phaseOut(7500, 170000, [153000, 168000]), 0);
  const e = R.eligibility({ age: 55, filing: 'single', magi: 85000, covered: true });
  assert.equal(e.limit, 8600); assert.equal(e.rothMax, 8600); assert.ok(e.traditionalDeductible < 8600 && e.traditionalDeductible > 0);
  assert.equal(R.eligibility({ age: 61 }).k401Max, 35750);
  assert.equal(R.eligibility({ age: 30, earned: 3000 }).limit, 3000);
  const p = R.plan({ age: 30, retireAge: 65, saved: 0, monthly: 500, returnPct: 6, inflationPct: 0 });
  assert.equal(p.paidIn, 210000); assert.ok(p.balance > 600000 && p.balance < 800000); assert.equal(p.path.length, 36);
  assert.equal(R.plan({ taxNowPct: 30, taxLaterPct: 10 }).compare.better, 'traditional');
  assert.equal(R.plan({ taxNowPct: 10, taxLaterPct: 30 }).compare.better, 'roth');
  assert.throws(() => R.plan({ age: 60, retireAge: 50 }), /retirement age after/);

  const u = client(); await u('/auth/register', { email: 'ira@example.com', password: 'Str0ngPassword1', agree: true });
  assert.equal((await u('/retirement')).body.limits.year, 2026);
  assert.equal((await u('/retirement/eligibility', { age: 40, filing: 'married', magi: 300000 })).body.rothMax, 0);
  assert.equal((await u('/retirement/plan', { age: 40, retireAge: 30 })).status, 400);
  assert.equal((await u('/retirement/accounts', { accounts: { paper: 'roth_ira' } }, 'PUT')).status, 200);
  assert.equal((await u('/retirement/accounts', { accounts: { paper: 'crypto_ira' } }, 'PUT')).status, 400);
  const t = (await u('/tax?account=paper')).body;
  assert.equal(t.accountType, 'roth_ira'); assert.match(t.ira.note, /not taxed/); assert.equal(t.estimatedTax, 0);
});
