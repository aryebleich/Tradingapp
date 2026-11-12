// Optional features (src/extras.js): the calculations, and the switches over the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myDay, replayTrades, habits, devilPoints, taxOfSale, openLots, parseGoal, goalPlan, promiseCheck, autopsyOf, shailos, shape, crowdCompare, EXTRAS, extrasFor } from '../src/extras.js';

const DAY = 864e5, T = Date.UTC(2026, 10, 12);

test('every optional feature starts switched off', async () => {
  assert.equal(Object.keys(EXTRAS).length, 14);
  assert.ok(Object.values(await extrasFor(987654)).every(v => v === false));
});

test('My day: three sentences and a next step', () => {
  const d = myDay({ equity: 10500, lastEquity: 10000, cash: 500, positions: [{ symbol: 'AAPL', value: 8000, pnl: 900 }, { symbol: 'MSFT', value: 2000, pnl: -50 }] });
  assert.equal(d.lines.length, 3);
  assert.match(d.lines[0], /up \$500\.00 \(\+5\.00%\)/);
  assert.match(d.lines[1], /AAPL matters most/);
  assert.match(d.next.text, /AAPL is a large share/); // 76% in one stock
  assert.match(myDay({ equity: 100000, cash: 100000, positions: [] }).next.text, /first small practice trade/);
});

test('mistake replay: what a stop would have saved', () => {
  const rows = [{ symbol: 'XYZ', qty: 10, acquired: T - 30 * DAY, sold: T - 10 * DAY, cost: 1000, proceeds: 800, gain: -200 }, { symbol: 'OK', qty: 1, acquired: T - 9 * DAY, sold: T - 8 * DAY, cost: 100, proceeds: 120, gain: 20 }];
  const bars = { XYZ: [{ t: T - 29 * DAY, l: 99, h: 101, c: 100 }, { t: T - 20 * DAY, l: 85, h: 95, c: 88 }, { t: T - 10 * DAY, l: 79, h: 82, c: 80 }] };
  const [t, ...rest] = replayTrades(rows, bars, 8);
  assert.equal(rest.length, 0); // winners are not listed
  assert.deepEqual([t.buy, t.sell, t.loss, t.stop, t.saved], [100, 80, -200, 92, 120]); // sold at 92 instead of 80, on 10 shares
  assert.match(t.lesson, /saved \$120\.00/);
});

test('behaviour coach: finds losers held longer than winners, and buying after a run', () => {
  const fills = [], bars = { S: [] };
  for (let i = 0; i < 4; i++) { // winners sold after 2 days, losers after 30
    fills.push({ symbol: 'W' + i, side: 'buy', qty: 1, price: 100, at: T - (200 - i * 10) * DAY }, { symbol: 'W' + i, side: 'sell', qty: 1, price: 105, at: T - (198 - i * 10) * DAY });
    fills.push({ symbol: 'L' + i, side: 'buy', qty: 1, price: 100, at: T - (150 - i) * DAY }, { symbol: 'L' + i, side: 'sell', qty: 1, price: 80, at: T - (120 - i) * DAY });
  }
  const h = habits(fills.sort((a, b) => a.at - b.at), bars);
  assert.deepEqual([h.wins, h.losses], [4, 4]);
  assert.ok(h.habits.some(x => x.key === 'earlyWinners') && h.habits.some(x => x.key === 'bigLosses'));
  assert.equal(habits([]).habits.length, 0);
});

test('second opinion: the case against a buy at a stretched high', () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.2).concat([160, 165, 170, 176, 182]);
  const pts = devilPoints({ symbol: 'NVDA', side: 'buy', dollars: 4000, equity: 10000, held: 0, closes });
  assert.ok(pts.length >= 2 && pts.length <= 4);
  assert.ok(pts.some(p => /RSI/.test(p)) && pts.some(p => /40% of the account/.test(p)));
  assert.equal(devilPoints({ symbol: 'SPY', side: 'buy', closes: [] }).length, 1); // nothing known: one plain line
});

test('tax-aware selling: waiting for long-term and cheaper lots', () => {
  const lots = [{ qty: 10, price: 100, at: T - 400 * DAY }, { qty: 10, price: 150, at: T - 300 * DAY }];
  const all = taxOfSale(lots, 20, 200, { bracket: 0.24, stateRate: 0.05 }, T);
  // 10 long-term ($1,000 gain at 15%+5%) + 10 short-term ($500 gain at 24%+5%)
  assert.deepEqual([all.gain, all.tax, all.shortTermQty], [1500, 345, 10]);
  assert.equal(all.wait.days, 66); assert.equal(all.wait.saves, 45); // the second lot turns long-term: 20% instead of 29%
  const ten = taxOfSale(lots, 10, 200, { bracket: 0.24, stateRate: 0.05 }, T);
  assert.equal(ten.tax, 200); assert.equal(ten.cheaperLots.saves, 55); // the $150 lot costs $145
  assert.equal(taxOfSale(lots, 30, 200, {}, T).covered, false);
  assert.deepEqual(openLots([{ symbol: 'A', side: 'buy', qty: 5, price: 10, at: 1 }, { symbol: 'A', side: 'buy', qty: 5, price: 20, at: 2 }, { symbol: 'A', side: 'sell', qty: 7, price: 30, at: 3 }, { symbol: 'B', side: 'buy', qty: 1, price: 1, at: 4 }], 'A'), [{ qty: 3, price: 20, at: 2 }]);
});

test('goals in plain words: amount, time, mix, monthly amount and chance', () => {
  assert.deepEqual(parseGoal('I need $40,000 for a wedding in three years'), { amount: 40000, years: 3, what: 'wedding' });
  assert.deepEqual(parseGoal('250k for a house in 10 years'), { amount: 250000, years: 10, what: 'house' });
  assert.equal(parseGoal('6000 dollars in 18 months').years, 1.5);
  assert.equal(parseGoal('I want to be rich'), null);
  const p = goalPlan({ amount: 40000, years: 3 });
  assert.equal(p.stocks, 30); assert.equal(p.months, 36);
  assert.ok(p.monthlyNeeded > 1000 && p.monthlyNeeded < 1111, String(p.monthlyNeeded)); // under $40,000 / 36 thanks to growth
  assert.ok(p.chance >= 45 && p.chance <= 60);
  assert.equal(p.mix.reduce((s, m) => s + m[1], 0), 100);
  assert.ok(goalPlan({ amount: 40000, years: 3, monthly: 500 }).chance < 10);
  assert.ok(goalPlan({ amount: 40000, years: 3, saved: 45000 }).chance > 90);
  assert.equal(goalPlan({ amount: 1e6, years: 30 }).stocks, 85);
});

test('earnings-call promise check: dropped promises first', () => {
  const prev = 'Thank you all for joining the call today and welcome. We expect to open forty new stores in Texas by year-end and we remain confident in that plan. We will launch the loyalty program nationwide next quarter with our retail partners. Revenue grew nine percent in the period compared with last year.';
  const cur = 'Thank you for joining. The loyalty program launched nationwide with our retail partners and early sign-ups are strong across every region. Revenue grew seven percent this period. We are focused on margins and on our digital channel going forward.';
  const d = promiseCheck(prev, cur);
  assert.equal(d.promises, 2); assert.equal(d.dropped, 1);
  assert.match(d.list[0].promise, /forty new stores in Texas/); assert.equal(d.list[0].status, 'dropped');
  assert.match(d.list[1].promise, /loyalty program/); assert.notEqual(d.list[1].status, 'dropped');
});

test('strategy autopsy: a grid in a one-way market; too little history', () => {
  const closes = Array.from({ length: 220 }, (_, i) => 100 + Math.sin(i / 3) * 2).concat(Array.from({ length: 41 }, (_, i) => 100 - i * 0.6));
  const a = autopsyOf('grid', closes);
  assert.equal(a.ok, true); assert.ok(a.numbers.twoMonths < -12);
  assert.ok(a.failing.some(f => /out of the range/.test(f)) && a.changed.some(c => /trend is down/.test(c)));
  assert.equal(autopsyOf('grid', [1, 2, 3]).ok, false);
});

test('questions for a rav; crowd check needs five members', () => {
  const list = shailos([{ symbol: 'JPM', value: 1000 }, { symbol: 'AAPL', value: 5000 }, { symbol: 'BND', value: 300 }]);
  assert.deepEqual(list.map(x => [x.symbol, x.topic]), [['JPM', 'Banks'], ['BND', 'Bonds']]);
  const me = shape({ equity: 20000, cash: 1000, positions: [{ value: 15000 }, { value: 4000 }] });
  assert.deepEqual(me, { holdings: 2, top: 75, cash: 5, band: '$10,000 to $100,000' });
  assert.equal(crowdCompare(me, [me, me]).enough, false);
  const others = Array.from({ length: 6 }, (_, i) => ({ holdings: 8 + i, top: 18 + i, cash: 6, band: '$10,000 to $100,000' }));
  const c = crowdCompare(me, others);
  assert.equal(c.enough, true); assert.equal(c.members, 6);
  assert.ok(c.notes.some(n => /largest holding is 75%/.test(n)) && c.notes.some(n => /You hold 2 positions/.test(n)));
});
