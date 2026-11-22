// AI morning news picks (src/newspicks.js): settings and their safe ranges, ranking, the risk caps of
// the allocation, the daily loss limit, the honest record (losses included) and the routes' guards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, rankPicks, allocate, lossGuard, record, DEFAULTS, NOT_ADVICE } from '../src/newspicks.js';
import { pdtAllowed } from '../src/pdt.js';

test('settings: clamped, per-stock never above the budget, the practice account only', () => {
  const s = cleanSettings({ budget: 500, perStock: 900, maxPicks: 12, stopPct: 50, account: 'alpaca' });
  assert.equal(s.perStock, 500); assert.equal(s.maxPicks, 5); assert.equal(s.stopPct, 20);
  assert.equal(s.account, 'paper'); // no live opt-in: back to the practice account
  assert.equal(cleanSettings({ account: 'alpaca', live: true }).account, 'paper'); assert.equal(cleanSettings({ live: true }).live, false);
  assert.equal(cleanSettings({}).mode, 'approve'); assert.equal(DEFAULTS.account, 'paper');
  assert.throws(() => cleanSettings({ budget: 'lots' }), /Check the numbers/);
});

test('ranking: needs headlines and a positive score; reasons and sources for each pick', () => {
  const picks = rankPicks([
    { symbol: 'UP', premarketPct: 3, headlines: [{ title: 'Company beats estimates, strong growth and record profit', source: 'Wire', url: 'https://x' }] },
    { symbol: 'DOWN', premarketPct: -4, headlines: [{ title: 'Company misses, weak outlook, lawsuit and losses' }] },
    { symbol: 'QUIET', premarketPct: 2, headlines: [] },
    { symbol: 'OK', premarketPct: 1, headlines: [{ title: 'Shares rise on upgrade' }] },
  ]);
  assert.deepEqual(picks.map(p => p.symbol), ['UP', 'OK']);
  assert.equal(picks[0].rank, 1); assert.ok(picks[0].reasons.some(r => /Pre-market \+3/.test(r))); assert.equal(picks[0].sources[0].source, 'Wire');
});

test('allocation caps: the daily budget (never above cash), the per-stock limit, a stop under each entry', () => {
  const picks = [{ symbol: 'A', score: 0.6 }, { symbol: 'B', score: 0.3 }, { symbol: 'C', score: 0.1 }, { symbol: 'D', score: 0.05 }];
  const s = cleanSettings({ budget: 1000, perStock: 400, maxPicks: 3, stopPct: 5 });
  const a = allocate(picks, s, { cash: 5000, prices: { A: 100, B: 50 } });
  assert.deepEqual(a.orders.map(o => o.symbol), ['A', 'B', 'C']);
  assert.ok(a.orders.every(o => o.dollars <= 400)); assert.equal(a.orders[0].capped, true);
  assert.ok(a.orders.reduce((x, o) => x + o.dollars, 0) <= 1000);
  assert.equal(a.orders[0].stop, 95); assert.equal(a.orders[2].stop, null);
  const poor = allocate(picks, s, { cash: 120 });
  assert.ok(poor.orders.reduce((x, o) => x + o.dollars, 0) <= 120); assert.equal(poor.budget, 120);
  assert.equal(allocate(picks, s, { cash: 8 }).orders.length, 0); // under $5 a pick: nothing
});

test('the daily loss limit and the pattern-day-trader rule', () => {
  const s = cleanSettings({ dailyLoss: 100 });
  assert.equal(lossGuard(-50, s).ok, true); assert.equal(lossGuard(-100, s).ok, false);
  assert.equal(pdtAllowed({ account: 'alpaca', equity: 10000, dayTrades: 3 }).ok, false);
  assert.equal(pdtAllowed({ account: 'alpaca', equity: 30000, dayTrades: 9 }).ok, true);
  assert.equal(pdtAllowed({ account: 'paper', equity: 1, dayTrades: 9 }).ok, true);
  assert.equal(pdtAllowed({ account: 'alpaca', equity: 1000, dayTrades: 9, margin: false }).ok, true);
});

test('the record shows every pick, losses included', () => {
  const r = record([{ day: 'd1', ret: 2 }, { day: 'd1', ret: -1 }, { day: 'd2', ret: -3 }, { day: 'd3', ret: null }]);
  assert.equal(r.days, 2); assert.equal(r.picks, 3); assert.equal(r.hitRate, 33); assert.equal(r.losses, 2); assert.equal(r.worst, -3);
  assert.equal(record([]).hitRate, null);
  assert.match(NOT_ADVICE, /^For planning and education only\. Not investment advice and not an order: nothing is sent to your broker\./);
});

let s, owner, free, pro;
before(async () => {
  const { serve } = await import('./client.js'); s = await serve();
  const { run } = await import('../src/db.js');
  owner = s.client(); await owner.signup('np-owner@example.com');
  free = s.client(); await free.signup('np-free@example.com');
  pro = s.client(); await pro.signup('np-pro@example.com');
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE email = 'np-pro@example.com'");
});
after(() => s?.close());

test('routes: Pro to use, the practice account only, one placement a day, the kill switch', async () => {
  assert.equal((await free('/newspicks/settings', { enabled: true }, 'PUT')).status, 402);
  const ok = await pro('/newspicks/settings', { enabled: true, mode: 'approve', budget: 500, perStock: 200 }, 'PUT');
  assert.equal(ok.status, 200); assert.equal(ok.body.settings.account, 'paper');
  // No real-money path: a real account is refused, even on Elite with the password.
  const { run, one } = await import('../src/db.js'); const { nyTime } = await import('../src/time.js');
  await run("UPDATE users SET plan = 'elite' WHERE email = 'np-pro@example.com'");
  for (const b of [{ live: true, account: 'alpaca', password: 'Str0ngPassword' }, { account: 'alpaca' }]) { const r = await pro('/newspicks/settings', b, 'PUT'); assert.equal(r.status, 400); assert.match(r.body.error, /practice account only/); }
  await run("UPDATE users SET plan = 'pro' WHERE email = 'np-pro@example.com'");
  assert.equal((await pro('/newspicks/approve', {})).status, 409); // no picks today yet
  const day = nyTime().day;
  await run("INSERT INTO newspicks_log (day, symbol, rank, score, reasons, sources, open) VALUES (?, 'SPY', 1, 0.5, '[]', '[]', 500), (?, 'AAPL', 2, 0.3, '[]', '[]', 200)", day, day);
  const placed = await pro('/newspicks/approve', {});
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  assert.ok(placed.body.orders.length >= 1 && placed.body.orders.every(o => o.dollars <= 200));
  assert.ok(placed.body.orders.reduce((a, o) => a + o.dollars, 0) <= 500);
  assert.equal((await pro('/newspicks/approve', {})).status, 409); // not twice a day
  const g = (await pro('/newspicks')).body;
  assert.equal(g.placedToday, true); assert.equal(g.picks.length, 2); assert.match(g.note, /^For planning and education only\. Not investment advice and not an order: nothing is sent to your broker\./);
  // the kill switch stops it
  const u = await one("SELECT id FROM users WHERE email = 'np-pro@example.com'");
  await run('DELETE FROM newspicks_trades WHERE user_id = ?', u.id);
  await (await import('../src/risk.js')).setKill(u.id, true);
  const k = await pro('/newspicks/approve', {});
  assert.equal(k.status, 409); assert.match(k.body.error, /kill switch/);
});
