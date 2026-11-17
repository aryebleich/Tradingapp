// Scheduled trades: the US market calendar (holidays, early closes), daylight saving, every "When" kind,
// the grace window (a missed order expires and is never sent late), once-only runs, Alpaca's opening
// and closing auction orders, and the step-up check for schedules on real-money accounts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
mock.autoFill = true;
Object.assign(process.env, { ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.liveUrl, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET' });
const { app } = await import('../server.js');
const { one, all, run } = await import('../src/db.js');
const C = await import('../src/market-calendar.js');
const T = await import('../src/time.js');
const P = await import('../src/schedule-plan.js');
const S = await import('../src/scheduler.js');
const { stepUpSessions } = await import('../src/security.js');

let server, base;
const client = () => {
  let cookie = '';
  const f = async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return f;
};
const owner = client();
let ownerId;
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  ownerId = (await owner('/auth/register', { email: 'sched-owner@example.com', password: 'Str0ngPassword1', agree: true })).body.user.id;
});
after(() => { server.close(); mock.close(); });

const ny = (day, hh, mm = 0) => T.nyAt(day, hh * 60 + mm);
const MIN = 60e3;

// ---------------------------------------------------------------- calendar
test('calendar: NYSE holidays for 2025 to 2027, observed on Friday or Monday, New Year on a Saturday not observed', () => {
  assert.deepEqual([...C.holidays(2026).keys()], ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);
  assert.equal(C.holidayName('2025-04-18'), 'Good Friday');
  assert.equal(C.holidayName('2027-06-18'), 'Juneteenth'); // June 19 2027 is a Saturday
  assert.equal(C.holidayName('2027-12-24'), 'Christmas Day'); // Dec 25 2027 is a Saturday
  assert.equal(C.holidayName('2027-12-31'), null); // Jan 1 2028 is a Saturday: not observed
  assert.equal(C.holidayName('2025-01-09'), 'Market closed'); // national day of mourning
  assert.equal(C.isTradingDay('2026-11-26'), false); assert.equal(C.isTradingDay('2026-11-28'), false); assert.equal(C.isTradingDay('2026-11-27'), true);
  assert.equal(C.nextTradingDay('2026-11-25'), '2026-11-27');
  assert.equal(C.nextTradingDay('2026-04-02'), '2026-04-06'); // over Good Friday and the weekend
});

test('calendar: early closes at 13:00 (July 3, day after Thanksgiving, Christmas Eve), and the sessions follow them', () => {
  assert.equal(C.earlyClose('2025-07-03'), 780); assert.equal(C.earlyClose('2026-07-03'), null); // 2026: July 3 is the holiday itself
  assert.equal(C.earlyClose('2026-11-27'), 780); assert.equal(C.earlyClose('2026-12-24'), 780); assert.equal(C.earlyClose('2026-12-23'), null);
  assert.equal(T.stockSession(ny('2026-11-27', 12, 59)), true);
  assert.equal(T.stockSession(ny('2026-11-27', 13, 0)), false, 'closed at 13:00 on an early-close day');
  assert.equal(T.stockSession(ny('2026-11-26', 11)), false, 'Thanksgiving');
  assert.equal(T.extendedSession(ny('2026-11-27', 16, 30)), true); assert.equal(T.extendedSession(ny('2026-11-27', 17, 30)), false, 'after hours end at 17:00 on early-close days');
  assert.equal(S.marketOpen(ny('2026-04-03', 11)), false, 'Good Friday');
  assert.equal(T.nextCloseAt(ny('2026-11-27', 10)), ny('2026-11-27', 13));
  assert.equal(T.nextOpenAt(ny('2026-11-25', 17)), ny('2026-11-27', 9, 30));
  const cd = C.closedDays('2026-11-20', '2026-12-31');
  assert.deepEqual(cd.map(d => `${d.day}:${d.closed ? 'closed' : 'early'}`), ['2026-11-26:closed', '2026-11-27:early', '2026-12-24:early', '2026-12-25:closed']);
});

test('daylight saving: New York times stay at the exchange clock across both changes', () => {
  assert.equal(new Date(ny('2026-03-06', 9, 30)).toISOString(), '2026-03-06T14:30:00.000Z'); // EST
  assert.equal(new Date(ny('2026-03-09', 9, 30)).toISOString(), '2026-03-09T13:30:00.000Z'); // EDT
  assert.equal(new Date(ny('2026-11-02', 9, 30)).toISOString(), '2026-11-02T14:30:00.000Z'); // back to EST
  // A daily order at 9:35 keeps 9:35 New York over the March change, and skips the weekend.
  const n = T.nextNyRun(ny('2026-03-06', 9, 35), { repeat: 'daily', minutes: 575 });
  assert.equal(new Date(n).toISOString(), '2026-03-09T13:35:00.000Z');
  assert.equal(new Date(T.nextNyRun(ny('2026-10-30', 9, 35), { repeat: 'daily', minutes: 575 })).toISOString(), '2026-11-02T14:35:00.000Z');
  // Repeats skip market holidays: Wednesday before Thanksgiving to Friday.
  assert.equal(T.nextNyRun(ny('2026-11-25', 10), { repeat: 'daily', minutes: 600 }), ny('2026-11-27', 10));
  assert.equal(T.nextNyRun(ny('2026-03-20', 10), { repeat: 'monthly', minutes: 600, monthDay: 3 }), ny('2026-04-06', 10), 'April 3 2026 is Good Friday, the weekend follows');
});

// ---------------------------------------------------------------- "When" plans
test('plans: at the close uses Alpaca\'s closing auction before the 15:50 cut-off; other accounts send just before the close', () => {
  const t = ny('2026-11-24', 11);
  const a = P.planWhen({ kind: 'close', offsetMin: 0 }, { account: 'alpaca', qty: 10, t });
  assert.equal(a.tif, 'cls'); assert.equal(a.nextRun, ny('2026-11-24', 15, 30));
  assert.ok(a.nextRun + a.graceMin * MIN < ny('2026-11-24', 15, 50), 'always before the cut-off');
  assert.match(a.precision, /closing auction/);
  const early = P.planWhen({ kind: 'close', offsetMin: 0 }, { account: 'alpaca', qty: 10, t: ny('2026-11-27', 9) });
  assert.equal(early.nextRun, ny('2026-11-27', 12, 30), 'early close: 30 minutes before 13:00');
  const paper = P.planWhen({ kind: 'close', offsetMin: 0 }, { account: 'paper', qty: 10, t });
  assert.equal(paper.tif, null); assert.equal(paper.nextRun, ny('2026-11-24', 15, 59)); assert.match(paper.precision, /no closing-auction order/);
  assert.equal(P.planWhen({ kind: 'close', offsetMin: 0 }, { account: 'alpaca', notional: 500, t }).tif, null, 'dollar amounts cannot go to the auction');
  const before = P.planWhen({ kind: 'close', offsetMin: 30 }, { account: 'paper', qty: 1, t });
  assert.equal(before.nextRun, ny('2026-11-24', 15, 30)); assert.equal(before.graceMin, 15);
  // After today's close (or its cut-off) the plan moves to the next session.
  assert.equal(P.planWhen({ kind: 'close', offsetMin: 0 }, { account: 'paper', qty: 1, t: ny('2026-11-25', 17) }).day, '2026-11-27');
});

test('plans: next open uses the opening auction (9:28 cut-off) on Alpaca; delays wait for the open when the market is closed', () => {
  const o = P.planWhen({ kind: 'open' }, { account: 'alpaca', qty: 5, t: ny('2026-11-25', 18) });
  assert.equal(o.tif, 'opg'); assert.equal(o.day, '2026-11-27'); assert.equal(o.nextRun, ny('2026-11-27', 8, 40));
  assert.ok(o.nextRun + o.graceMin * MIN < ny('2026-11-27', 9, 28));
  const po = P.planWhen({ kind: 'open' }, { account: 'paper', qty: 5, t: ny('2026-11-25', 18) });
  assert.equal(po.tif, null); assert.equal(po.nextRun, ny('2026-11-27', 9, 30));
  const d = P.planWhen({ kind: 'delay', delayMin: 60 }, { account: 'paper', qty: 1, t: ny('2026-11-24', 15, 30) });
  assert.equal(d.nextRun, ny('2026-11-25', 9, 30)); assert.match(d.precision, /waits for the next open/);
  assert.equal(P.planWhen({ kind: 'delay', delayMin: 5 }, { account: 'paper', qty: 1, t: ny('2026-11-24', 11) }).nextRun, ny('2026-11-24', 11, 5));
  assert.match(P.planWhen({ kind: 'at', date: '2026-11-26', time: '10:00' }, { t: ny('2026-11-20', 10) }).precision, /Thanksgiving/);
});

// ---------------------------------------------------------------- running
const sched = (userId, o) => run(`INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, notional, repeat, next_run, created_at, order_type, grace_min, tif, when_kind, run_minutes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, userId, o.account || 'paper', o.symbol || 'SPY', o.side || 'buy', o.qty ?? 1, o.notional ?? null, o.repeat || 'once', o.next_run, 0, 'market', o.grace_min ?? null, o.tif ?? null, o.when_kind ?? 'at', o.run_minutes ?? null).then(r => Number(r.lastInsertRowid));
const row = id => one('SELECT * FROM scheduled_orders WHERE id = ?', id);
const fills = (u, sym) => one("SELECT COUNT(*) n FROM fills WHERE user_id = ? AND symbol = ? AND source = 'schedule'", u, sym).then(r => r.n);

test('grace window: on time it runs once; missed by more than the window it expires, is never sent, and the user is told', async () => {
  const u = ownerId, t = ny('2026-11-24', 11);
  const ok = await sched(u, { symbol: 'AAPL', next_run: t - 5 * MIN });
  const late = await sched(u, { symbol: 'MSFT', next_run: t - 40 * MIN });
  const ran = await Promise.all([S.runScheduledOrders(t), S.runScheduledOrders(t)]);
  assert.equal(ran[0] + ran[1], 1, 'only the on-time order is sent, once');
  assert.equal(await fills(u, 'AAPL'), 1); assert.equal(await fills(u, 'MSFT'), 0);
  assert.match((await row(late)).last_result, /^expired: not sent, 40 min after its time \(window 15 min\)/);
  assert.equal((await row(late)).active, 0); assert.equal((await row(ok)).active, 0);
  // A repeating order that missed today's window stays on, with its next run in the future.
  const daily = await sched(u, { symbol: 'NVDA', repeat: 'daily', run_minutes: 600, next_run: ny('2026-11-24', 10) });
  await S.runScheduledOrders(ny('2026-11-24', 10, 45));
  const d = await row(daily);
  assert.equal(d.active, 1); assert.equal(d.next_run, ny('2026-11-25', 10)); assert.match(d.last_result, /^expired/); assert.equal(await fills(u, 'NVDA'), 0);
});

test('closed market: an order timed on a holiday waits for the next open and then counts its window from the open', async () => {
  const u = ownerId;
  const id = await sched(u, { symbol: 'AMZN', next_run: ny('2026-11-26', 10) }); // Thanksgiving
  assert.equal(await S.runScheduledOrders(ny('2026-11-26', 11)), 0);
  assert.equal((await row(id)).active, 1);
  assert.equal(await S.runScheduledOrders(ny('2026-11-27', 9, 40)), 1);
  assert.equal(await fills(u, 'AMZN'), 1);
  // Before-the-open orders (legacy rows had no grace column) run at the open, not "late".
  const pre = await sched(u, { symbol: 'META', next_run: ny('2026-11-30', 8) });
  assert.equal(await S.runScheduledOrders(ny('2026-11-30', 9, 35)), 1);
  assert.equal((await row(pre)).active, 0);
});

test('auction orders reach Alpaca with time in force opg or cls; past the cut-off they expire', async () => {
  const c = client(); const reg = await c('/auth/register', { email: 'sched-alpaca@example.com', password: 'Str0ngPassword1', agree: true });
  assert.equal((await c('/alpaca/keys', { keyId: 'SCHEDKEY', secret: 'S' })).status, 200);
  const u = reg.body.user.id;
  const sent = () => mock.log.filter(x => x.method === 'POST' && x.path === '/v2/orders' && x.headers['apca-api-key-id'] === 'SCHEDKEY');
  const cls = await sched(u, { account: 'alpaca', symbol: 'AAPL', qty: 3, tif: 'cls', grace_min: 9, when_kind: 'close', next_run: ny('2026-11-24', 15, 30) });
  await S.runScheduledOrders(ny('2026-11-24', 15, 35));
  assert.equal(sent().at(-1)?.body.time_in_force, 'cls'); assert.equal(sent().at(-1)?.body.qty, '3');
  assert.doesNotMatch((await row(cls)).last_result, /error|expired/);
  const opg = await sched(u, { account: 'alpaca', symbol: 'MSFT', qty: 2, tif: 'opg', grace_min: 45, when_kind: 'open', next_run: ny('2026-11-25', 8, 40) });
  await S.runScheduledOrders(ny('2026-11-25', 8, 50)); // pre-market: the auction order is sent before the open
  assert.equal(sent().at(-1)?.body.time_in_force, 'opg'); assert.equal(sent().at(-1)?.body.symbol, 'MSFT');
  assert.equal((await row(opg)).active, 0);
  const n = sent().length;
  const lateCls = await sched(u, { account: 'alpaca', symbol: 'NVDA', qty: 1, tif: 'cls', grace_min: 30, when_kind: 'close', next_run: ny('2026-11-24', 15, 30) });
  await S.runScheduledOrders(ny('2026-11-24', 15, 52)); // within its grace, but past Alpaca's 15:50 cut-off
  assert.equal(sent().length, n, 'nothing sent after the cut-off');
  assert.match((await row(lateCls)).last_result, /^expired/);
  // The auction is refused anywhere but Alpaca, and for fractional shares.
  const { auctionOf } = await import('../src/brokers.js');
  assert.throws(() => auctionOf({ time_in_force: 'cls', qty: 1 }, 'paper'), /Alpaca accounts only/);
  assert.throws(() => auctionOf({ time_in_force: 'opg', qty: 1.5 }, 'alpaca'), /whole number of shares/);
});

// ---------------------------------------------------------------- scheduled close
test('scheduled close: never more than the position at run time; a closed position marks the order done with a note', async () => {
  const c = client(); const reg = await c('/auth/register', { email: 'sched-close@example.com', password: 'Str0ngPassword1', agree: true });
  const u = reg.body.user.id, t = ny('2026-11-24', 11);
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = ?", u); // Scheduled trades is a paid feature
  assert.equal((await c('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 10 })).status, 200);
  const held = async s => (await one("SELECT qty FROM positions WHERE user_id = ? AND account = 'paper' AND symbol = ?", u, s))?.qty || 0;
  // A quantity larger than the position is capped at what is held.
  const big = await run("INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, repeat, next_run, created_at, order_type, close_mode) VALUES (?, 'paper', 'AAPL', 'sell', 25, 'once', ?, 0, 'market', 'qty')", u, t - MIN).then(r => Number(r.lastInsertRowid));
  assert.equal(await S.runScheduledOrders(t), 1);
  assert.equal(await held('AAPL'), 0, 'sold the 10 held, not 25');
  assert.match((await row(big)).last_result, /capped at the 10 held/);
  // Nothing left: done with a note, nothing sent.
  const none = await run("INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, repeat, next_run, created_at, order_type, close_mode) VALUES (?, 'paper', 'AAPL', 'sell', 5, 'once', ?, 0, 'market', 'all')", u, t - MIN).then(r => Number(r.lastInsertRowid));
  const before = await fills(u, 'AAPL');
  await S.runScheduledOrders(t + MIN);
  assert.equal(await fills(u, 'AAPL'), before);
  assert.match((await row(none)).last_result, /^done: no AAPL position left to close/);
  assert.equal((await row(none)).active, 0);
  // A percentage closes that share of what is held then.
  assert.equal((await c('/orders', { account: 'paper', symbol: 'MSFT', side: 'buy', qty: 8 })).status, 200);
  await run("INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, repeat, next_run, created_at, order_type, close_mode, close_pct) VALUES (?, 'paper', 'MSFT', 'sell', 8, 'once', ?, 0, 'market', 'pct', 25)", u, t + MIN);
  await S.runScheduledOrders(t + 2 * MIN);
  assert.equal(await held('MSFT'), 6);
  // Through the API: a close of the entire position needs no amount.
  const s = await c('/schedule', { account: 'paper', symbol: 'MSFT', side: 'sell', close: { mode: 'all' }, when: { kind: 'close', offsetMin: 30 } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal((await row(s.body.id)).close_mode, 'all');
  assert.equal((await c('/schedule', { account: 'paper', symbol: 'MSFT', side: 'sell', notional: 100, close: { mode: 'qty' }, when: { kind: 'open' } })).status, 400, 'a close is in shares, not dollars');
});

// ---------------------------------------------------------------- API
test('API: preview states the timing precision and the price reminder; every kind can be saved on paper', async () => {
  for (const when of [{ kind: 'close', offsetMin: 0 }, { kind: 'close', offsetMin: 15 }, { kind: 'open' }, { kind: 'delay', delayMin: 5 }, { kind: 'delay', delayMin: 60 }]) {
    const pv = await owner('/schedule/preview', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, when });
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.match(pv.body.priceNote, /price when the order runs may differ/); assert.ok(pv.body.precision.length > 20); assert.ok(pv.body.nextRun > Date.now() - 60e3);
    const s = await owner('/schedule', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, when });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const r = await row(s.body.id);
    assert.equal(r.when_kind, when.kind); assert.ok(r.grace_min >= 1); assert.equal(r.tif, null, 'paper never uses auction orders');
  }
  // The old form (date, time, repeat) still works.
  const d = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  const old = await owner('/schedule', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, date: d, time: '10:00', repeat: 'daily' });
  assert.equal(old.status, 200, JSON.stringify(old.body));
  assert.equal((await row(old.body.id)).repeat, 'daily');
  // The preview shows a bad choice as a message on the form; saving it is refused.
  const bad = await owner('/schedule/preview', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, when: { kind: 'later' } });
  assert.equal(bad.body.error, 'Pick when it should run'); assert.equal(bad.body.nextRun, undefined);
  assert.equal((await owner('/schedule', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, when: { kind: 'later' } })).status, 400);
  const cal = await (await fetch(base + '/api/trading-calendar?from=2026-11-20&to=2026-12-31')).json();
  assert.deepEqual(cal.days.filter(x => x.closed).map(x => x.day), ['2026-11-26', '2026-12-25']);
});

test('step-up: a schedule on a real-money account needs the same confirmation as a live order; paper does not', async () => {
  const c = client(); const reg = await c('/auth/register', { email: 'sched-live@example.com', password: 'Str0ngPassword1', agree: true });
  const u = reg.body.user.id;
  assert.equal((await c('/alpaca/keys', { keyId: 'SCHEDLIVE', secret: 'S', live: true })).status, 200);
  await run("UPDATE users SET plan = 'pro' WHERE id = ?", u).catch(() => {});
  const { token_hash } = await one('SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', u);
  stepUpSessions.set(token_hash, 'test: unusual session');
  try {
    const live = await c('/schedule', { account: 'alpaca', symbol: 'SPY', side: 'buy', qty: 1, when: { kind: 'delay', delayMin: 60 } });
    assert.equal(live.status, 401); assert.equal(live.body.stepUp, true);
    const order = await c('/orders', { account: 'alpaca', symbol: 'SPY', side: 'buy', qty: 1 });
    assert.equal(order.status, 401, 'the same check a live order gets');
    const paper = await c('/schedule', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 1, when: { kind: 'delay', delayMin: 60 } });
    assert.notEqual(paper.status, 401, 'paper schedules are not held by the step-up');
  } finally { stepUpSessions.delete(token_hash); }
  assert.equal(await one('SELECT COUNT(*) n FROM scheduled_orders WHERE user_id = ? AND account = ?', u, 'alpaca').then(r => r.n), 0);
});
