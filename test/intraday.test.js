// Intraday rule bot (src/intraday.js): settings ranges, the decision rule, every limit (hours,
// interval, daily orders, open positions, daily loss, pattern-day-trader, kill switch), holding over the
// ex-dividend date, the honest stats and the routes' guards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, decide, limitsAllow, holdOverExDiv, stats, watchList, runFor, DEFAULTS, HIGH_DIVIDEND, NOT_ADVICE } from '../src/intraday.js';
import { nyAt } from '../src/time.js';

test('settings: paper by default, 5 minutes at the fastest, at most 10 stocks', () => {
  const s = cleanSettings({ everyMin: 1, maxTrades: 500, symbols: 'aapl, msft bad! ' + 'A B C D E F G H I J K'.toLowerCase(), list: 'custom', account: 'alpaca' });
  assert.equal(s.everyMin, 5); assert.equal(s.maxTrades, 40); assert.equal(s.account, 'paper');
  assert.ok(s.symbols.length <= 10 && s.symbols[0] === 'AAPL' && !s.symbols.includes('BAD!'));
  assert.equal(DEFAULTS.enabled, false); assert.equal(DEFAULTS.account, 'paper');
  assert.deepEqual(watchList(cleanSettings({})), HIGH_DIVIDEND.slice(0, 10));
  assert.equal(cleanSettings({ list: 'custom', symbols: [] }).list, 'dividend');
  assert.match(NOT_ADVICE, /^For planning and education only\. Not investment advice and not an order: nothing is sent to your broker\./); assert.doesNotMatch(NOT_ADVICE, /high.frequency|guarantee/i);
});

const rising = Array.from({ length: 40 }, (_, i) => 100 + i * 0.05 + (i % 3 === 0 ? -0.06 : 0.04));
test('the decision: entry on a steady rise, exits at the stop, the target and under the average', () => {
  assert.equal(decide(rising.slice(0, 10)).action, 'hold');
  const zig = [100]; for (let i = 1; i < 40; i++) zig.push(zig[i - 1] + (i % 2 ? 1 : -0.8));
  assert.equal(decide(zig).action, 'buy'); assert.match(decide(zig).reason, /RSI 5\d/);
  assert.equal(decide(rising).action, 'hold'); // a straight line up is stretched: RSI too high
  const s = cleanSettings({ stopPct: 1, targetPct: 2 });
  assert.equal(decide([...rising.slice(0, -1), 97], { entry: 100 }, s).action, 'sell');
  assert.match(decide([...rising.slice(0, -1), 97], { entry: 100 }, s).reason, /Stop loss/);
  assert.match(decide([...rising.slice(0, -1), 103], { entry: 100 }, s).reason, /Target/);
  const flat = Array.from({ length: 30 }, () => 100);
  assert.equal(decide(flat).action, 'hold'); // no signal on a flat line
});

test('limits: hours, interval, daily orders, open positions, daily loss, PDT and the kill switch', () => {
  const s = cleanSettings({ everyMin: 10, maxTrades: 4, maxOpen: 2, dailyLoss: 50 });
  const base = { killed: false, minutes: 600, tradesToday: 0, lastAt: null, nowAt: 1e9, open: 0, todayPl: 0, equity: 10000, dayTrades: 0, side: 'buy' };
  assert.equal(limitsAllow(base, s).ok, true);
  assert.match(limitsAllow({ ...base, killed: true }, s).why, /kill switch/);
  assert.match(limitsAllow({ ...base, minutes: 580 }, s).why, /9:45/);
  assert.match(limitsAllow({ ...base, minutes: 950 }, s).why, /15:45/);
  assert.match(limitsAllow({ ...base, lastAt: 1e9 - 5 * 60e3 }, s).why, /10 minutes/);
  assert.equal(limitsAllow({ ...base, lastAt: 1e9 - 11 * 60e3 }, s).ok, true);
  assert.match(limitsAllow({ ...base, tradesToday: 4 }, s).why, /4 orders/);
  assert.match(limitsAllow({ ...base, open: 2 }, s).why, /open positions/);
  assert.match(limitsAllow({ ...base, todayPl: -50 }, s).why, /daily limit/);
  const live = { ...s, account: 'alpaca', live: true };
  assert.match(limitsAllow({ ...base, dayTrades: 3 }, live).why, /Pattern-day-trader/);
  assert.equal(limitsAllow({ ...base, dayTrades: 3, equity: 30000 }, live).ok, true);
  assert.equal(limitsAllow({ ...base, dayTrades: 3 }, s).ok, true); // paper is not limited by PDT
  assert.equal(limitsAllow({ ...base, killed: true, side: 'sell' }, s).ok, false);
});

test('holding over the ex-dividend date: dividend list, option on, ex-date the next trading day', () => {
  const on = cleanSettings({ holdExDiv: true }), off = cleanSettings({});
  assert.equal(holdOverExDiv('KO', on, { KO: '2026-11-24' }, '2026-11-24'), true);
  assert.equal(holdOverExDiv('KO', off, { KO: '2026-11-24' }, '2026-11-24'), false);
  assert.equal(holdOverExDiv('KO', on, { KO: '2026-12-01' }, '2026-11-24'), false);
  assert.equal(holdOverExDiv('NVDA', on, { NVDA: '2026-11-24' }, '2026-11-24'), false);
});

test('stats count every closed trade, losses included', () => {
  const st = stats([{ side: 'buy' }, { side: 'sell', pl: 5 }, { side: 'buy' }, { side: 'sell', pl: -8 }, { side: 'sell', pl: -1 }]);
  assert.equal(st.closed, 3); assert.equal(st.wins, 1); assert.equal(st.losses, 2); assert.equal(st.hitRate, 33); assert.equal(st.pl, -4); assert.equal(st.worst, -8);
  assert.equal(stats([]).hitRate, null);
});

let s, owner, free, pro;
before(async () => {
  const { serve } = await import('./client.js'); s = await serve();
  const { run } = await import('../src/db.js');
  owner = s.client(); await owner.signup('id-owner@example.com');
  free = s.client(); await free.signup('id-free@example.com');
  pro = s.client(); await pro.signup('id-pro@example.com');
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE email = 'id-pro@example.com'");
});
after(() => s?.close());

test('routes: free reads, Elite saves on the practice account only; stop turns it off', async () => {
  const g = await free('/intraday'); assert.equal(g.status, 200); assert.equal(g.body.settings.account, 'paper'); assert.match(g.body.limits.pdt, /25,000/);
  assert.equal((await free('/intraday/settings', { enabled: true }, 'PUT')).status, 402);
  assert.equal((await pro('/intraday/settings', { enabled: true }, 'PUT')).status, 402); // Elite feature
  const { run, one } = await import('../src/db.js');
  await run("UPDATE users SET plan = 'elite' WHERE email = 'id-pro@example.com'");
  const ok = await pro('/intraday/settings', { enabled: true, maxTrades: 3 }, 'PUT'); assert.equal(ok.status, 200); assert.equal(ok.body.settings.enabled, true); assert.equal(ok.body.settings.account, 'paper');
  // No real-money path, even on Elite with the password.
  assert.equal((await pro('/intraday/settings', { live: true, account: 'alpaca', password: 'Str0ngPassword' }, 'PUT')).status, 400);
  assert.equal(cleanSettings({ account: 'alpaca', live: true }).account, 'paper');
  const st = await pro('/intraday/stop', {}); assert.equal(st.status, 200); assert.equal(st.body.settings.enabled, false);
  // The engine itself on the practice account: buys within the position limit, logs the reason, then the kill switch stops new buys.
  const u = await one("SELECT id FROM users WHERE email = 'id-pro@example.com'");
  const t = nyAt('2026-11-23', 600), cfg = cleanSettings({ enabled: true, list: 'custom', symbols: ['SPY'], maxPosition: 300, everyMin: 5 });
  const zig = [100]; for (let i = 1; i < 40; i++) zig.push(zig[i - 1] + (i % 2 ? 1 : -0.8)); // steady rise, RSI about 56
  const forced = { SPY: zig };
  const acted = await runFor(u.id, cfg, forced, { t });
  assert.ok(acted.find(a => a.side === 'buy'), JSON.stringify(acted));
  {
    const row = await one("SELECT * FROM intraday_log WHERE user_id = ? AND side = 'buy'", u.id);
    assert.ok(row.qty * row.price <= 300); assert.ok(row.reason);
    // At 15:50 everything is closed and the result is logged.
    const close = await runFor(u.id, cfg, forced, { t: nyAt('2026-11-23', 951) });
    assert.match(close.find(a => a.side === 'sell').reason, /before the close/);
  }
  await (await import('../src/risk.js')).setKill(u.id, true);
  const k = await runFor(u.id, cfg, forced, { t: nyAt('2026-11-24', 600) });
  assert.ok(!k.some(a => a.side === 'buy'));
});
