// Money levers (deposit fee, referrals, partner commission), the QuantPocket MCP server, the
// wealth builder (fundamentals from a fake SEC, habits, diversification, automatic investing)
// and the owner's adviser checklist.
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const http = await import('node:http');

let fake;
before(async () => {
  fake = http.createServer((req, res) => {
    const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.endsWith('/files/company_tickers.json')) return json({ 0: { cik_str: 320193, ticker: 'ACME', title: 'Acme Inc' } });
    if (req.url.includes('/api/xbrl/companyfacts/CIK0000320193.json')) {
      const fy = (vals, unit = 'USD') => ({ units: { [unit]: vals.map((v, i) => ({ fy: 2021 + i, fp: 'FY', form: '10-K', val: v, frame: `CY${2021 + i}` })) } });
      return json({ entityName: 'Acme Inc', facts: { 'us-gaap': { Revenues: fy([100, 110, 125, 140]), NetIncomeLoss: fy([10, 12, 15, 18]), EarningsPerShareDiluted: fy([1, 1.2, 1.5, 1.8], 'USD/shares'), LongTermDebt: fy([20, 20, 20, 20]), StockholdersEquity: fy([80, 90, 100, 110]) } } });
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r => fake.listen(0, r));
  Object.assign(process.env, { SEC_DATA_URL: `http://127.0.0.1:${fake.address().port}`, SEC_WWW_URL: `http://127.0.0.1:${fake.address().port}` });
});
after(() => fake.close());
const { serve } = await import('./client.js');
const { run, one } = await import('../src/db.js');

test('money levers: deposit fee with a cap, referral milestones, longer trial for friends, partner commission', async () => {
  const s = await serve();
  try {
    const owner = s.client();
    await owner('/auth/register', { email: 'aryebleich@gmail.com', password: 'Str0ngPassword' });
    const put = await owner('/admin/site/money', { depositFeePercent: 1, depositFeeFixed: 0.5, depositFeeCap: 5, referralCredit: 15, friendTrialBonusDays: 16, milestones: [{ at: 2, bonus: 40 }], commissionType: 'bps', commissionValue: 999 }, 'PUT');
    assert.equal(put.status, 200);
    assert.equal(put.body.settings.commissionValue, 50); // capped
    const { serviceFee, trialDaysFor, withCommission, referralReward, nextMilestone } = await import('../src/revenue.js');
    assert.equal(serviceFee(100), 1.5); assert.equal(serviceFee(10000), 5);
    assert.equal(trialDaysFor({ referred_by: 3 }, 14), 30); assert.equal(trialDaysFor({}, 14), 14);
    assert.deepEqual(withCommission({ symbol: 'AAPL' }), { symbol: 'AAPL', commission: '50', commission_type: 'bps' });
    assert.deepEqual(nextMilestone(1), { at: 2, bonus: 40 });
    // Two friends subscribe: the second one reaches the milestone.
    const me = (await owner('/auth/me')).body.user;
    for (const e of ['f1@example.com', 'f2@example.com']) { const c = s.client(); await c('/auth/register', { email: e, password: 'Str0ngPassword', ref: me.refCode }); }
    await run('UPDATE users SET referral_rewarded = 1 WHERE referred_by = ?', me.id);
    assert.deepEqual(await referralReward(me.id), { credit: 15, bonus: 40, paying: 2, milestone: { at: 2, bonus: 40 } });
    const r = (await owner('/referrals')).body;
    assert.equal(r.reward, 15); assert.equal(r.friendDays, 30); assert.equal(r.invited, 2);
    const m = (await owner('/admin/site/money')).body;
    assert.equal(m.leaders[0].invited, 2); assert.equal(m.stats.referredSignups, 2);
    await owner('/admin/site/money', { commissionValue: 0, depositFeePercent: 0, depositFeeFixed: 0 }, 'PUT');
    assert.deepEqual(withCommission({ symbol: 'AAPL' }), { symbol: 'AAPL' });
    // The adviser checklist is ticked off step by step.
    assert.equal((await owner('/admin/site/ria', { id: 'exam', done: true }, 'PUT')).status, 200);
    assert.equal((await owner('/admin/site/ria')).body.steps.find(x => x.id === 'exam').done, true);
    assert.equal((await owner('/admin/site/ria', { id: 'nope', done: true }, 'PUT')).status, 400);
    assert.equal((await owner('/admin/site/alpaca-plans')).body.connected, false);
    const guest = s.client(); await guest('/auth/register', { email: 'nosy@example.com', password: 'Str0ngPassword' });
    assert.equal((await guest('/admin/site/money')).status, 403);
  } finally { s.close(); }
});

test('MCP server: tokens for paid plans, initialize, tools, paper-only orders', async () => {
  const s = await serve();
  try {
    const c = s.client();
    const u = await c.signup('mcp@example.com');
    assert.equal((await c('/tokens', { name: 'Claude' })).status, 402);
    await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = ?", u.id);
    const { token } = (await c('/tokens', { name: 'Claude' })).body;
    assert.match(token, /^qpk_/);
    assert.equal((await c('/tokens')).body[0].hint, token.slice(-4));
    const rpc = (body, tok = token) => fetch(s.base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
    assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 'qpk_wrong')).status, 401);
    const init = (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).body;
    assert.equal(init.result.serverInfo.name, 'quantpocket');
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const names = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result.tools.map(t => t.name);
    assert.ok(names.includes('place_paper_order') && names.includes('get_account'));
    const order = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'place_paper_order', arguments: { symbol: 'SPY', side: 'buy', qty: 1 } } })).body.result;
    assert.notEqual(order.isError, true, JSON.stringify(order));
    const acct = JSON.parse((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_account', arguments: {} } })).body.result.content[0].text);
    assert.ok(acct.positions.some(p => p.symbol === 'SPY'));
    assert.equal((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'place_real_order', arguments: {} } })).body.error.code, -32602);
    assert.equal((await rpc({ jsonrpc: '2.0', id: 6, method: 'nope' })).body.error.code, -32601);
    const id = (await c('/tokens')).body[0].id;
    await c('/tokens/' + id, null, 'DELETE');
    assert.equal((await rpc({ jsonrpc: '2.0', id: 7, method: 'ping' })).status, 401);
  } finally { s.close(); }
});

test('wealth builder: fundamentals, habits, diversification, automatic investing, settings', async () => {
  const s = await serve();
  try {
    const c = s.client();
    const u = await c.signup('wealth@example.com');
    const f = (await c('/wealth/fundamentals/ACME')).body;
    assert.equal(f.company, 'Acme Inc'); assert.equal(f.score, 5); assert.equal(f.of, 5);
    assert.match(f.checks.find(x => x.name === 'Low debt').detail, /0\.18/);
    assert.equal((await c('/wealth/fundamentals/ZZZZ')).status, 404);
    await c('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 5 });
    await c('/orders', { account: 'paper', symbol: 'VTI', side: 'buy', qty: 1 });
    const d = (await c('/wealth/diversify?account=paper')).body;
    assert.equal(d.positions, 2); assert.ok(d.sectors.some(x => x.name === 'Technology')); assert.ok(d.regions.some(x => x.name === 'United States'));
    await c('/orders', { account: 'paper', symbol: 'AAPL', side: 'sell', qty: 2 });
    const h = (await c('/wealth/habits?account=paper')).body;
    assert.equal(h.trades, 3); assert.equal(h.medianHoldDays, 0);
    const a = await c('/wealth/autoinvest', { account: 'paper', amount: 100, repeat: 'monthly', day: 3, items: [{ symbol: 'VTI', weight: 60 }, { symbol: 'VXUS', weight: 40 }] });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const rows = await (await import('../src/db.js')).all('SELECT symbol, notional FROM scheduled_orders WHERE user_id = ? ORDER BY symbol', u.id);
    assert.deepEqual(rows.map(r => [r.symbol, r.notional]), [['VTI', 60], ['VXUS', 40]]);
    assert.equal((await c('/wealth/autoinvest', { account: 'alpaca', amount: 100, items: [{ symbol: 'VTI', weight: 1 }] })).status, 402);
    assert.equal((await c('/wealth/settings', { drip: { accounts: ['alpaca'] } }, 'PUT')).status, 402);
    assert.equal((await c('/wealth/settings', { rebalanceReminder: true }, 'PUT')).status, 200);
    assert.equal((await c('/wealth/settings')).body.rebalanceReminder, true);
    assert.deepEqual((await c('/wealth/holdings-news?account=paper')).body, []);
    const { rebalanceReminders } = await import('../src/wealth.js');
    assert.equal(await rebalanceReminders(Date.UTC(2026, 6, 15, 16)), 1);
    assert.equal(await rebalanceReminders(Date.UTC(2026, 6, 16, 16)), 0);
    assert.ok(await one('SELECT id FROM users WHERE id = ?', u.id));
  } finally { s.close(); }
});
