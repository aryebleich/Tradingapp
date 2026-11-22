// Live ratio pair bots (src/pairslive-math.js, src/pairslive.js): beta and volatility-ratio math,
// bars, BUY/SELL from a quantity, time zones; entry and exit at the thresholds; a failed or partial
// second leg; no trading on weekends, holidays or after the close cutoff; the limits and the kill
// switch; the account picker; paper first and the real-money gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/pairslive-math.js';
import { nyAt } from '../src/time.js';

const close = (a, b, d = 1e-9) => assert.ok(Math.abs(a - b) <= d, `${a} vs ${b}`);

test('beta (ratio of mean prices) and volatility ratio (sd of % changes) against known numbers', () => {
  const a = [100, 102, 101, 103], b = [50, 51, 50.5, 51.5];
  close(M.betaOf(a, b), 101.5 / 50.75); // = 2
  close(M.volRatio(a, b), 1, 1e-12); // A moves exactly 2× B in price, the same in percent
  const c = [100, 110, 99, 108.9]; // ±10%, ±10%
  const r = M.volRatio(c, [100, 105, 99.75, 104.7375]); close(r, 2, 1e-9);
  close(M.divergencePct(102, 50, 2), 2); close(M.divergencePct(98, 50, 2), -2);
  const { wa, wb } = M.weights(3); close(wa, 0.25); close(wb, 0.75);
  assert.deepEqual(M.legQty(1000, 100, 50, 1, 1), { qa: 5, qb: -10 });
  assert.deepEqual(M.legQty(1000, 100, 50, 1, -1), { qa: -5, qb: 10 });
});

test('resampling into bars and aligning the legs', () => {
  const t0 = Date.UTC(2026, 10, 24, 15, 0);
  const pts = [{ t: t0, price: 10 }, { t: t0 + 30e3, price: 11 }, { t: t0 + 61e3, price: 12 }, { t: t0 + 190e3, price: 13 }, { t: t0 + 200e3, price: 0 }];
  assert.deepEqual(M.resample(pts, 60e3), [{ t: t0, close: 11 }, { t: t0 + 60e3, close: 12 }, { t: t0 + 180e3, close: 13 }]);
  const g = M.align(M.resample(pts, 60e3), [{ t: t0, close: 5 }, { t: t0 + 180e3, close: 6 }]);
  assert.deepEqual(g, { t: [t0, t0 + 180e3], ca: [11, 13], cb: [5, 6] });
});

test('BUY/SELL from a quantity, and New York / UTC conversion across daylight saving', () => {
  assert.equal(M.sideOf(5), 'BUY'); assert.equal(M.sideOf(-3), 'SELL'); assert.equal(M.sideOf(0), null);
  assert.deepEqual(M.orderOf('KO', -7), { symbol: 'KO', side: 'sell', qty: 7 }); assert.equal(M.orderOf('KO', 0), null);
  assert.equal(M.nyToUtc('2026-07-01', '09:30'), Date.UTC(2026, 6, 1, 13, 30)); // EDT, UTC-4
  assert.equal(M.nyToUtc('2026-12-01', '09:30'), Date.UTC(2026, 11, 1, 14, 30)); // EST, UTC-5
  assert.deepEqual(M.utcToNy(Date.UTC(2026, 11, 1, 21, 5)), { day: '2026-12-01', minutes: 16 * 60 + 5, hhmm: '16:05' });
});

test('entry and exit exactly at the thresholds; the stop', () => {
  const p = { entryPct: 0.5, exitPct: 0.1, stopPct: 2 };
  assert.equal(M.signal(0.5, 0, p).want, -1); assert.equal(M.signal(-0.5, 0, p).want, 1); assert.equal(M.signal(0.49, 0, p).want, 0);
  assert.equal(M.signal(0.3, -1, p).want, -1); assert.equal(M.signal(0.1, -1, p).want, 0); assert.match(M.signal(0.1, -1, p).why, /converged/);
  assert.equal(M.signal(-0.2, -1, p).want, 0); // crossed over: converged
  assert.equal(M.signal(2, -1, p).want, 0); assert.match(M.signal(2.1, -1, p).why, /stop/);
});

test('no trading on weekends or holidays or after the close cutoff (1 PM on early-close days)', () => {
  assert.equal(M.tradingWindow(nyAt('2026-11-21', 600)).open, false); // Saturday
  assert.equal(M.tradingWindow(nyAt('2026-11-26', 600)).open, false); // Thanksgiving
  assert.equal(M.tradingWindow(nyAt('2026-11-24', 590)).enter, true);
  const late = M.tradingWindow(nyAt('2026-11-24', 952), { closeBeforeMin: 10 }); assert.equal(late.enter, false); assert.equal(late.flatten, true);
  const early = M.tradingWindow(nyAt('2026-11-27', 775), { closeBeforeMin: 10 }); assert.equal(early.flatten, true); // 12:55 on the day after Thanksgiving
  assert.equal(M.tradingWindow(nyAt('2026-11-27', 790)).open, false); // after the 1 PM close
  const hold = M.tradingWindow(nyAt('2026-11-24', 955), { closeBeforeMin: 10, holdOvernight: true }); assert.equal(hold.flatten, false); assert.equal(hold.enter, false);
  assert.equal(M.tradingWindow(nyAt('2026-11-24', 540)).open, false); // before 9:30
});

test('the intraday backtest charges costs, slippage and the short borrow fee', () => {
  const n = 400, ca = [], cb = [];
  for (let i = 0; i < n; i++) { const base = 100 + Math.sin(i / 15) * 2; cb.push(base); ca.push(base * 2 * (1 + Math.sin(i / 4) * 0.01)); }
  const free = M.backtest(ca, cb, { window: 30, entryPct: 0.5, exitPct: 0.1, stopPct: 5, costBps: 0, slipBps: 0, borrowPct: 0 });
  const paid = M.backtest(ca, cb, { window: 30, entryPct: 0.5, exitPct: 0.1, stopPct: 5, costBps: 5, slipBps: 5, borrowPct: 10 });
  assert.ok(free.trades > 3, String(free.trades)); assert.equal(free.trades, paid.trades);
  assert.ok(paid.total < free.total); assert.ok(paid.maxDrawdown <= 0); assert.equal(paid.curve.length, paid.bars);
});

// ---------- the two-leg orders, with fake brokers ----------
let openPair, closePair, rateOk;
before(async () => ({ openPair, closePair, rateOk } = await import('../src/pairslive.js')));
const fake = (script = {}) => { const sent = []; return { sent, deps: { summary: async () => ({ buyingPower: script.bp ?? 1e6 }), check: async o => { if (script.check?.[o.symbol]) throw new Error(script.check[o.symbol]); }, place: async o => { sent.push(o); const s = script.place?.[o.symbol + (o.close ? ':close' : '')]; if (s instanceof Error) throw s; return s || { status: 'filled', qty: o.qty }; } } }; };

test('a failed second leg closes the first leg at once', async () => {
  const f = fake({ place: { KO: new Error('not shortable') } });
  const r = await openPair({ a: 'PEP', b: 'KO', qa: 10, qb: -12, pa: 150, pb: 60 }, f.deps);
  assert.equal(r.ok, false); assert.deepEqual(f.sent.map(o => `${o.side} ${o.qty} ${o.symbol}${o.close ? ' (close)' : ''}`), ['sell 12 KO']);
  // Short leg first: it failed, so the long leg was never sent.
  const g = fake({ place: { PEP: new Error('insufficient buying power') } });
  const r2 = await openPair({ a: 'PEP', b: 'KO', qa: 10, qb: -12, pa: 150, pb: 60 }, g.deps);
  assert.equal(r2.ok, false); assert.deepEqual(g.sent.map(o => `${o.side} ${o.qty} ${o.symbol}${o.close ? ' (close)' : ''}`), ['sell 12 KO', 'buy 10 PEP', 'buy 12 KO (close)']);
  assert.match(r2.notes[0], /12 KO closed again/); assert.equal(r2.qb, 0);
});

test('a partly filled second leg balances the first; checks happen before anything is sent', async () => {
  const f = fake({ place: { PEP: { status: 'partially_filled', filled_qty: 5 } } });
  const r = await openPair({ a: 'PEP', b: 'KO', qa: 10, qb: -12, pa: 150, pb: 60 }, f.deps);
  assert.deepEqual(f.sent.map(o => `${o.side} ${o.qty} ${o.symbol}`), ['sell 12 KO', 'buy 10 PEP', 'buy 6 KO']); // 5 of 10 filled → keep 6 of 12
  assert.equal(r.qa, 5); assert.equal(r.qb, -6);
  const g = fake({ check: { PEP: 'Daily loss limit reached' } });
  const r2 = await openPair({ a: 'PEP', b: 'KO', qa: 10, qb: -12, pa: 150, pb: 60 }, g.deps);
  assert.equal(r2.ok, false); assert.match(r2.why, /Daily loss limit/); assert.equal(g.sent.length, 0);
  const h = fake({ bp: 100 }); const r3 = await openPair({ a: 'PEP', b: 'KO', qa: 10, qb: -12, pa: 150, pb: 60 }, h.deps);
  assert.match(r3.why, /buying power/); assert.equal(h.sent.length, 0);
  const c = fake({ place: { 'KO:close': new Error('market closed') } });
  const cr = await closePair({ a: 'PEP', b: 'KO', qa: 10, qb: -12 }, c.deps);
  assert.equal(cr.ok, false); assert.equal(cr.qa, 0); assert.equal(cr.qb, -12); assert.match(cr.notes[0], /KO was not closed/);
});

test('the order rate limit per member', () => {
  const t = 1e12; let n = 0; while (rateOk(987654, 2, t)) n++;
  assert.equal(n, 10); assert.equal(rateOk(987654, 1, t + 61e3), true);
});

// ---------- the routes and the engine on the practice account ----------
let s, owner, u;
before(async () => { const { serve } = await import('./client.js'); s = await serve(); owner = s.client(); await owner.signup('lp-owner@example.com'); u = s.client(); await u.signup('lp@example.com'); });
after(() => s?.close());

test('the account picker lists only connected accounts; new bots start on Paper; start checks shorting', async () => {
  const acc = (await u('/pairslive/accounts')).body; assert.deepEqual(acc.map(a => a.id), ['paper']);
  assert.equal((await u('/pairslive', { a: 'KO', b: 'KO' })).status, 400);
  assert.equal((await u('/pairslive', { a: 'KO', b: 'PEP', entryPct: 0.5, exitPct: 0.6 })).status, 400);
  const bot = (await u('/pairslive', { a: 'KO', b: 'PEP', account: 'alpaca', dollars: 1000 })).body;
  assert.equal(bot.account, 'paper'); assert.equal(bot.status, 'stopped'); assert.match((await u('/pairslive')).body.note, /^For planning and education only\. Not investment advice and not an order: nothing is sent to your broker\./);
  const st = await u(`/pairslive/${bot.id}/start`, {}); assert.equal(st.status, 409); assert.match(st.body.error, /margin/); // shorting needs margin on, even on Paper
  // No real-money path: the bot stays on the practice account.
  const live = await u(`/pairslive/${bot.id}/live`, { account: 'alpaca', understood: true, password: 'Str0ngPassword' });
  assert.equal(live.status, 409); assert.match(live.body.error, /practice account only/);
});

test('the engine on Paper: opens both legs, closes at the cutoff, and the kill switch blocks it', async () => {
  const { one, run } = await import('../src/db.js'), E = await import('../src/pairslive.js');
  const me = await one("SELECT id FROM users WHERE email = 'lp@example.com'");
  await (await import('../src/shortdesk.js')).setMargin(me.id, 'paper', true);
  const bot = (await u('/pairslive', { a: 'KO', b: 'PEP', dollars: 2000, historyMin: 100, barMin: 5, entryPct: 0.5, exitPct: 0.1, stopPct: 5 })).body;
  assert.equal((await u(`/pairslive/${bot.id}/start`, {})).status, 200);
  // A known history: KO steady, PEP steady, then KO jumps 1% above its fair value.
  const day = '2026-11-24', t = nyAt(day, 11 * 60);
  for (let i = 120; i > 0; i--) { E.addPoint('KO', t - i * 60e3, 60 + Math.sin(i) * 0.02); E.addPoint('PEP', t - i * 60e3, 150 + Math.sin(i) * 0.05); }
  const P = await import('../src/brokers.js'); const realLast = P.lastPrice;
  E.addPoint('KO', t - 1000, 60.6); E.addPoint('PEP', t - 1000, 150);
  let row = await one('SELECT * FROM live_pairs WHERE id = ?', bot.id);
  const r = await E.runPair(row, t);
  assert.equal(r.opened, true, JSON.stringify(r));
  row = await one('SELECT * FROM live_pairs WHERE id = ?', bot.id); const st = JSON.parse(row.state);
  assert.ok(st.qa < 0 && st.qb > 0, JSON.stringify(st)); // KO rich: short KO, long PEP
  const fills = (await import('../src/db.js')).all; const orders = await fills("SELECT symbol, side, qty FROM fills WHERE user_id = ? ORDER BY id", me.id);
  assert.deepEqual(orders.map(o => o.side + ' ' + o.symbol), ['sell KO', 'buy PEP']);
  // 5 minutes before the close: both legs are closed.
  for (let m = 661; m <= 955; m++) { E.addPoint('KO', nyAt(day, m) - 1000, 60.6); E.addPoint('PEP', nyAt(day, m) - 1000, 150); } // the stream keeps coming during the day
  const c = await E.runPair(row, nyAt(day, 955)); assert.equal(c.closed, true, JSON.stringify(c));
  row = await one('SELECT * FROM live_pairs WHERE id = ?', bot.id); assert.equal(JSON.parse(row.state).qa, 0);
  // Weekend: nothing happens.
  assert.ok((await E.runPair(row, nyAt('2026-11-28', 600))).idle);
  // Kill switch: the bot pauses and sends nothing.
  await (await import('../src/risk.js')).setKill(me.id, true);
  const before = (await fills('SELECT COUNT(*) n FROM fills WHERE user_id = ?', me.id))[0].n;
  const k = await E.runPair(row, nyAt(day, 11 * 60)); assert.equal(k.paused, 'kill switch');
  assert.equal((await fills('SELECT COUNT(*) n FROM fills WHERE user_id = ?', me.id))[0].n, before);
  assert.equal((await one('SELECT status FROM live_pairs WHERE id = ?', bot.id)).status, 'paused');
  await (await import('../src/risk.js')).setKill(me.id, false);
  void realLast; void run;
});

test('risk limits block the opening: the max position and the risk-control order cap', async () => {
  const { one } = await import('../src/db.js'), E = await import('../src/pairslive.js');
  assert.throws(() => E.cleanParams({ dollars: 9000, maxPositionUsd: 5000 }), /over your maximum position/);
  const me = await one("SELECT id FROM users WHERE email = 'lp@example.com'");
  const R = await import('../src/risk.js'); await R.saveRisk(me.id, { maxOrderUsd: 100 });
  const bot = (await u('/pairslive', { a: 'KO', b: 'PEP', dollars: 2000, historyMin: 100, barMin: 5, entryPct: 0.5, exitPct: 0.1, stopPct: 5 })).body;
  await u(`/pairslive/${bot.id}/start`, {});
  const day = '2026-11-25', t = nyAt(day, 11 * 60);
  for (let i = 120; i > 0; i--) { E.addPoint('KO', t - i * 60e3, 60); E.addPoint('PEP', t - i * 60e3, 150); }
  E.addPoint('KO', t - 1000, 60.6);
  const row = await one('SELECT * FROM live_pairs WHERE id = ?', bot.id);
  const r = await E.runPair(row, t);
  assert.equal(r.opened, false); assert.match(r.why, /limit per order/);
  await R.saveRisk(me.id, { maxOrderUsd: 0 });
});

test('the practice account only: real money is refused, and a bot on another account pauses without trading', async () => {
  const { one, run } = await import('../src/db.js'), E = await import('../src/pairslive.js');
  const bot = (await u('/pairslive', { a: 'XOM', b: 'CVX' })).body;
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE email = 'lp@example.com'");
  const r = await u(`/pairslive/${bot.id}/live`, { account: 'alpaca', understood: true, password: 'Str0ngPassword' });
  assert.equal(r.status, 409); assert.equal((await one('SELECT account FROM live_pairs WHERE id = ?', bot.id)).account, 'paper');
  await run("UPDATE live_pairs SET account = 'alpaca', status = 'running' WHERE id = ?", bot.id); // an older bot moved before this change
  const x = await E.runPair(await one('SELECT * FROM live_pairs WHERE id = ?', bot.id), nyAt('2026-11-24', 600));
  assert.equal(x.paused, 'practice account only'); assert.equal((await one('SELECT status FROM live_pairs WHERE id = ?', bot.id)).status, 'paused');
});

test('closing at the cutoff never waits for history', async () => {
  const { one, run } = await import('../src/db.js'), E = await import('../src/pairslive.js');
  const me = await one("SELECT id FROM users WHERE email = 'lp@example.com'");
  const bot = (await u('/pairslive', { a: 'T', b: 'VZ', dollars: 1000 })).body;
  await run("UPDATE live_pairs SET status = 'running', state = ? WHERE id = ?", JSON.stringify({ pos: 1, qa: 0, qb: 0 }), bot.id); // nothing open: stays idle
  const day = '2026-11-23'; E.addPoint('T', nyAt(day, 955) - 500, 25); E.addPoint('VZ', nyAt(day, 955) - 500, 40);
  await (await import('../src/shortdesk.js')).setMargin(me.id, 'paper', true);
  // Open by hand on paper, then ask the engine at 15:55 with only one price point each.
  const P = await import('../src/brokers.js');
  await P.placeOrder(me.id, 'paper', { symbol: 'T', side: 'buy', qty: 10 }, 'test'); await P.placeOrder(me.id, 'paper', { symbol: 'VZ', side: 'sell', qty: 6, allowShort: true }, 'test');
  await run('UPDATE live_pairs SET state = ? WHERE id = ?', JSON.stringify({ pos: 1, qa: 10, qb: -6, ea: 25, eb: 40, openedAt: nyAt(day, 600) }), bot.id);
  const r = await E.runPair(await one('SELECT * FROM live_pairs WHERE id = ?', bot.id), nyAt(day, 955));
  assert.equal(r.closed, true, JSON.stringify(r));
  const st = JSON.parse((await one('SELECT state FROM live_pairs WHERE id = ?', bot.id)).state); assert.equal(st.qa, 0); assert.equal(st.qb, 0);
});
