// End-to-end API flow against an in-memory database, with no external services.
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { app } = await import('../server.js');
const { totp } = await import('../src/crypto.js');
const { run } = await import('../src/db.js');

let server, base, cookie = '';
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());

async function call(path, body, method) {
  const r = await fetch(base + '/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('register, trade, schedule, tax, 2FA login', async () => {
  assert.equal((await call('/auth/register', { email: 'a@b.co', password: 'short' })).status, 400);
  const reg = await call('/auth/register', { email: 'a@b.co', password: 'Str0ngPassword' });
  assert.equal(reg.body.user.role, 'admin');

  const csrf = await fetch(base + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
  assert.equal(csrf.status, 403);

  const bt = await call('/backtest', { symbol: 'SPY', entry: 'SMA(20) crosses_above SMA(100)', exit: 'SMA(20) crosses_below SMA(100)' });
  assert.equal(bt.body.source, 'synthetic');
  assert.ok(bt.body.projection.median !== undefined);

  const buy = await call('/orders', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 10 });
  assert.equal(buy.body.status, 'filled');
  const sell = await call('/orders', { account: 'paper', symbol: 'SPY', side: 'sell', qty: 4 });
  assert.equal(sell.body.status, 'filled');
  assert.equal((await call('/orders', { account: 'paper', symbol: 'SPY', side: 'sell', qty: 100 })).status, 400);

  const acct = await call('/account?account=paper');
  assert.equal(acct.body.positions[0].qty, 6);

  const tax = await call('/tax?account=paper');
  assert.equal(tax.body.rows.length, 1);

  const sch = await call('/schedule', { account: 'paper', symbol: 'QQQ', side: 'buy', notional: 50, repeat: 'weekly', at: new Date(Date.now() + 60e3).toISOString() });
  assert.ok(sch.body.id);

  const cmd = await call('/command', { text: 'BAL' });
  assert.match(cmd.body.reply, /^Paper: equity \$/);
  assert.match((await call('/command', { text: 'BUY 1 SPY 9999' })).body.reply, /PIN/);

  const ph = await call('/phone', { phone: '+17185551234' });
  assert.equal((await call('/phone/verify', { code: ph.body.devCode })).status, 200);

  const setup = await call('/auth/totp/setup', {});
  assert.equal((await call('/auth/totp/enable', { code: totp(setup.body.secret) })).status, 200);
  await call('/auth/logout', {});
  const login = await call('/auth/login', { email: 'a@b.co', password: 'Str0ngPassword' });
  assert.equal(login.body.mfaRequired, true);
  assert.equal((await call('/account')).status, 401);
  assert.equal((await call('/auth/mfa', { code: '000000' })).status, 401);
  assert.equal((await call('/auth/mfa', { code: totp(setup.body.secret) })).status, 200);
  assert.equal((await call('/account')).status, 200);

  run("UPDATE paper_accounts SET cash = cash + 5000 WHERE user_id = 1");
  // Software-only mode (the default) charges no performance fee; registered-adviser mode does.
  assert.deepEqual((await call('/admin/assess-fees', {})).body, []);
  const { siteSet } = await import('../src/site.js');
  await siteSet('adviserMode', true);
  try {
    const fees = await call('/admin/assess-fees', {});
    assert.ok(fees.body.find(f => f.account === 'paper').fee > 0);
  } finally { await siteSet('adviserMode', false); }
});

test('lockout after repeated bad passwords', async () => {
  await call('/auth/register', { email: 'c@d.co', password: 'Str0ngPassword' });
  for (let i = 0; i < 5; i++) await call('/auth/login', { email: 'c@d.co', password: 'wrongWrong1' });
  assert.equal((await call('/auth/login', { email: 'c@d.co', password: 'Str0ngPassword' })).status, 423);
});

test('password reset, email verification, export and delete', async () => {
  cookie = '';
  const { one } = await import('../src/db.js');
  const { sha256 } = await import('../src/crypto.js');
  await call('/auth/register', { email: 'r@s.co', password: 'Str0ngPassword' });
  const u = await one('SELECT * FROM users WHERE email = ?', 'r@s.co');
  // No confirmation is required to use the account; the optional verify endpoint still works.
  assert.equal(u.verify_hash, null);
  // Tokens are stored hashed; plant a known one to exercise the endpoints.
  await run('UPDATE users SET verify_hash = ? WHERE id = ?', sha256('vtok'), u.id);
  assert.equal((await call('/auth/verify', { token: 'vtok' })).status, 200);
  assert.equal((await call('/auth/me')).body.user.emailVerified, true);

  assert.equal((await call('/auth/forgot', { email: 'nobody@x.co' })).body.ok, true);
  await call('/auth/forgot', { email: 'r@s.co' });
  await run('UPDATE users SET reset_hash = ? WHERE id = ?', sha256('rtok'), u.id);
  assert.equal((await call('/auth/reset', { token: 'rtok', password: 'N3wPasswordXyz' })).status, 200);
  assert.equal((await call('/auth/me')).body.user, null); // all sessions revoked
  assert.equal((await call('/auth/reset', { token: 'rtok', password: 'N3wPasswordXyz' })).status, 400);
  assert.equal((await call('/auth/login', { email: 'r@s.co', password: 'N3wPasswordXyz' })).status, 200);

  const exp = await fetch(base + '/api/auth/export', { headers: { cookie } });
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal((await exp.json()).profile.email, 'r@s.co');
  assert.equal((await call('/auth/delete', { password: 'wrong' })).status, 401);
  assert.equal((await call('/auth/delete', { password: 'N3wPasswordXyz' })).status, 200);
  assert.equal(await one('SELECT id FROM users WHERE email = ?', 'r@s.co'), undefined);
});

test('public demo, contact, health and cron tick', async () => {
  const demo = await call('/public/backtest', { symbol: 'QQQ', preset: 'Breakout' });
  assert.equal(demo.status, 200);
  assert.ok(demo.body.curve.length > 10);
  assert.equal((await call('/public/contact', { email: 'bad', body: 'x' })).status, 400);
  assert.equal((await call('/public/contact', { email: 'a@b.co', body: 'Hi' })).status, 200);
  const pre = await fetch(base + '/api/public/backtest', { method: 'OPTIONS', headers: { Origin: 'https://aryebleich.github.io' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://aryebleich.github.io');
  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await fetch(base + '/internal/tick', { method: 'POST' })).status, 401);
  process.env.CRON_SECRET = 's3cret';
  const tick = await fetch(base + '/internal/tick', { method: 'POST', headers: { Authorization: 'Bearer s3cret' } });
  assert.equal(tick.status, 200);
  assert.equal((await fetch(base + '/no-such-page')).status, 404);
});

test('fixes: no double execution, deposits, phone code limits, rule validation', async () => {
  cookie = '';
  const { one } = await import('../src/db.js');
  const { runScheduledOrders, runBots } = await import('../src/scheduler.js');
  await call('/auth/register', { email: 'fix@t.co', password: 'Str0ngPassword' });
  const u = await one('SELECT id FROM users WHERE email = ?', 'fix@t.co');

  // A paper deposit is a contribution, not profit.
  await call('/funding/deposit', { account: 'paper', amount: 1000 });
  const a = (await call('/account?account=paper')).body;
  assert.equal(a.startCash, 101000);
  assert.equal(a.equity, 101000);

  // Two schedulers firing at once (in-process timer + cron) must place the order only once.
  const tue = Date.UTC(2026, 9, 20, 15, 0); // Tuesday 11:00 New York, market open
  await run("INSERT INTO scheduled_orders (user_id, account, symbol, side, notional, repeat, next_run, created_at) VALUES (?, 'paper', 'SPY', 'buy', 100, 'daily', ?, ?)", u.id, tue - 10 * 86400e3, tue);
  const ran = await Promise.all([runScheduledOrders(tue), runScheduledOrders(tue)]);
  assert.equal(ran[0] + ran[1], 1);
  assert.equal((await one("SELECT COUNT(*) n FROM fills WHERE user_id = ? AND source = 'schedule'", u.id)).n, 1);
  // Missed runs while asleep are skipped, not replayed: next run is in the future.
  assert.ok((await one('SELECT next_run FROM scheduled_orders WHERE user_id = ?', u.id)).next_run > tue);
  // Outside market hours nothing runs.
  assert.equal(await runScheduledOrders(Date.UTC(2026, 9, 24, 15, 0)), 0); // Saturday

  // Bots: one evaluation per day even when two ticks overlap.
  await run("INSERT INTO strategies (user_id, name, symbol, entry, exit, size, deployed, created_at) VALUES (?, 'b', 'SPY', 'Close > 0', '', 50, 'paper', ?)", u.id, tue);
  const close = Date.UTC(2026, 9, 20, 19, 40); // 15:40 New York
  const bots = await Promise.all([runBots(close), runBots(close)]);
  assert.equal(bots[0] + bots[1], 1);

  // Strategy rules are validated when saved.
  assert.match((await call('/strategies', { name: 'x', symbol: 'SPY', entry: 'FOO(3) > 1' })).body.error, /Unknown indicator/);
  assert.equal((await call('/strategies', { name: 'x', symbol: 'SPY', entry: 'RSI(14) < 30' })).status, 200);

  // Phone codes expire and allow only a few attempts.
  await call('/phone', { phone: '+17185550000' });
  for (let i = 0; i < 5; i++) await call('/phone/verify', { code: '000000' });
  assert.match((await call('/phone/verify', { code: '000000' })).body.error, /Too many attempts/);

  // Bad tickers get a clear message.
  assert.match((await call('/backtest', { symbol: '../etc', entry: 'Close > 0', exit: '' })).body.error, /Unknown ticker/);
  assert.match((await call('/orders', { account: 'paper', symbol: 'SPY', side: 'buy', notional: 0.000001 })).body.error, /too small/);
});

test('monetization: trial, paid invoice, referral credit once, cancellation, upgrade prompt', async () => {
  const crypto = (await import('node:crypto')).default;
  const { one } = await import('../src/db.js');
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const hook = async ev => {
    const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
    return fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: raw });
  };
  // Referrer A invites B.
  cookie = ''; await call('/auth/register', { email: 'refa@t.co', password: 'Str0ngPassword' });
  const a = (await call('/referrals')).body;
  assert.match(a.link, /\?ref=[a-z0-9]{8}$/);
  cookie = ''; await call('/auth/register', { email: 'refb@t.co', password: 'Str0ngPassword', ref: a.code });
  const b = await one('SELECT * FROM users WHERE email = ?', 'refb@t.co');
  assert.equal(b.referred_by, (await one('SELECT id FROM users WHERE email = ?', 'refa@t.co')).id);

  // Free user hitting a Pro feature gets the upgrade prompt.
  const blocked = await call('/schedule', { account: 'paper', symbol: 'SPY', side: 'buy', notional: 5, repeat: 'once', at: new Date(Date.now() + 864e5).toISOString() });
  assert.equal(blocked.status, 402); assert.equal(blocked.body.upgrade, true); assert.equal(blocked.body.feature, 'Scheduled trades');

  // Bad signature is rejected.
  assert.equal((await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' }, body: '{}' })).status, 400);

  // Trial checkout ($0 today): Pro unlocked, trial used, no revenue recorded yet.
  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', customer: 'cus_b', client_reference_id: String(b.id), amount_total: 0, metadata: { kind: 'subscription', plan: 'pro', interval: 'year' } } } });
  const me = (await call('/auth/me')).body.user;
  assert.deepEqual([me.plan, me.planStatus, me.planInterval, me.trialUsed], ['pro', 'trialing', 'year', true]);
  assert.equal((await call('/schedule', { account: 'paper', symbol: 'SPY', side: 'buy', notional: 5, repeat: 'once', at: new Date(Date.now() + 864e5).toISOString() })).status, 200);
  assert.equal((await one("SELECT COUNT(*) n FROM ledger WHERE user_id = ? AND kind = 'subscription'", b.id)).n, 0);

  // First real payment: active, revenue recorded, referrer credited exactly once (retries ignored).
  const inv = { type: 'invoice.paid', data: { object: { id: 'in_1', customer: 'cus_b', amount_paid: 29000, billing_reason: 'subscription_cycle', lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 365 * 86400 } }] } } } };
  await hook(inv); await hook(inv);
  assert.equal((await one('SELECT plan_status FROM users WHERE id = ?', b.id)).plan_status, 'active');
  assert.equal((await one("SELECT COUNT(*) n, SUM(amount) s FROM ledger WHERE user_id = ? AND kind = 'subscription'", b.id)).s, 290);
  cookie = ''; await call('/auth/login', { email: 'refa@t.co', password: 'Str0ngPassword' });
  const a2 = (await call('/referrals')).body;
  assert.deepEqual([a2.invited, a2.paying, a2.credit], [1, 1, 10]);

  // Cancellation returns the user to the free plan.
  await hook({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_b', status: 'canceled', metadata: { plan: 'pro' } } } });
  const after = await one('SELECT plan, plan_status FROM users WHERE id = ?', b.id);
  assert.deepEqual([after.plan, after.plan_status], ['free', 'canceled']);
});
