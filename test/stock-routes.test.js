// The stock page's routes against a stand-in SEC (test/mock-sec.js): the page, free vs Pro, the card
// shown before a buy (and "don't show for this stock"), the scanner and its saved filters.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSecMock } from './mock-sec.js';

let sec, s, free, pro;
before(async () => {
  sec = await startSecMock(); process.env.SEC_DATA_URL = sec.url; process.env.SEC_WWW_URL = sec.url;
  const { serve } = await import('./client.js'); s = await serve();
  const { run } = await import('../src/db.js');
  await s.client().signup('stock-owner@example.com'); // the first account is the owner (counts as paid)
  free = s.client(); await free.signup('stock-free@example.com');
  pro = s.client(); await pro.signup('stock-pro@example.com');
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE email = 'stock-pro@example.com'");
});
after(() => { s?.close(); sec?.close(); });

test('the stock page: valuation, statements, earnings, dividends; free sees two years, Pro five', async () => {
  const p = await pro('/stock/MSFT');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const d = p.body;
  assert.equal(d.kind, 'stock'); assert.equal(d.name, 'Microsoft Corp'); assert.equal(d.locked, false);
  assert.equal(d.statements.rows.length, 6);
  assert.ok(d.valuation.pe > 0); assert.ok(['cheap', 'fair', 'expensive', 'na'].includes(d.valuation.label.id)); assert.match(d.valuation.method, /Trailing P\/E/);
  assert.deepEqual(d.earnings.reports.map(r => r.date), ['2025-05-01', '2025-07-31', '2025-10-30']);
  assert.equal(d.earnings.next.estimated, true); assert.match(d.earnings.note, /Finnhub/);
  assert.equal(d.dividends.pays, true); assert.ok(d.dividends.safety.score >= 0);
  assert.ok(d.summary.strengths.length); assert.equal(d.summary.by, 'rules');
  assert.match(d.note, /not investment advice/);
  const f = (await free('/stock/MSFT')).body;
  assert.equal(f.locked, true); assert.equal(f.statements.rows.length, 2); assert.ok(f.valuation.history.length <= 2);
  assert.equal((await free('/stock/NOT$A')).status, 400);
});

test('the card before a buy: the essentials, cached, and "don\'t show for this stock"', async () => {
  const c = (await free('/stock/KO/card')).body;
  assert.equal(c.symbol, 'KO'); assert.equal(c.name, 'Coca-Cola Co'); assert.equal(c.sector, 'Beverages');
  assert.ok(c.dividendYield > 0); assert.ok(c.range52.high >= c.range52.low); assert.match(c.note, /never blocks/);
  assert.ok(c.nextEarnings?.date);
  assert.deepEqual((await free('/stock/card/hidden', { symbol: 'ko' })).body.hidden, ['KO']);
  assert.deepEqual((await free('/stock/KO/card')).body, { symbol: 'KO', hidden: true });
  assert.deepEqual((await free('/stock/card/hidden', { symbol: 'KO', hide: false })).body.hidden, []);
  assert.equal((await free('/stock/KO/card')).body.name, 'Coca-Cola Co');
  assert.equal((await free('/stock/card/hidden', { symbol: '???' })).status, 400);
});

test('a cold request worker reads a fresh precomputed card and ignores an expired one', async () => {
  const { run, now } = await import('../src/db.js');
  const names = ['ALPACA_KEY_ID', 'ALPACA_SECRET'];
  const saved = names.map(name => process.env[name]);
  for (const name of names) process.env[name] = 'fixture-only';
  try {
    await run('INSERT INTO cache (k, v, at) VALUES (?, ?, ?)', 'stock-card:AAPL',
      JSON.stringify({ symbol: 'AAPL', name: 'Precomputed Apple' }), now());
    const response = await free('/stock/AAPL/card');
    assert.equal(response.status, 200);
    assert.equal(response.body.name, 'Precomputed Apple');
    await run('INSERT INTO cache (k, v, at) VALUES (?, ?, ?)', 'stock-card:MSFT',
      JSON.stringify({ symbol: 'MSFT', name: 'Expired Microsoft' }), now() - 4 * 3600e3);
    const oldDataUrl = process.env.ALPACA_DATA_URL;
    process.env.ALPACA_DATA_URL = sec.url;
    try {
      assert.equal((await free('/stock/MSFT/card')).body.name, 'Microsoft Corp');
    } finally {
      if (oldDataUrl === undefined) delete process.env.ALPACA_DATA_URL;
      else process.env.ALPACA_DATA_URL = oldDataUrl;
    }
  } finally {
    for (const [i, name] of names.entries()) {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    }
  }
});

test('compare and the growth-at-a-price scanner; saving filters with alerts is Pro', async () => {
  const cmp = (await free('/stock/compare?symbols=AAPL,MSFT,NOPE')).body;
  assert.equal(cmp.rows.length, 3); assert.ok(cmp.rows[0].pe > 0); assert.ok(cmp.rows[2].error);
  assert.equal((await free('/stock/compare?symbols=AAPL')).status, 400);
  const scan = (await free('/stock/scan', { filters: { peMin: 0.1, revenueGrowthMin: 30 } })).body;
  assert.ok(scan.scanned >= 3, JSON.stringify(scan).slice(0, 200));
  assert.deepEqual(scan.rows.map(r => r.symbol), ['NVDA']);
  assert.equal((await free('/stock/scan', { filters: { peMin: 'lots' } })).status, 400);
  assert.ok((await free('/stock/scan', { preset: 'growth' })).body.filters.peMin === 30);
  const locked = await free('/stock/filters', { name: 'Fast growers', filters: { revenueGrowthMin: 30 }, alert: true });
  assert.equal(locked.status, 402); assert.equal(locked.body.upgrade, true);
  const ok = await pro('/stock/filters', { name: 'Fast growers', filters: { revenueGrowthMin: 30 }, alert: true });
  assert.equal(ok.status, 200); assert.equal(ok.body.saved[0].alert, true);
  const { runValueAlerts } = await import('../src/stock.js');
  assert.equal(await runValueAlerts(), 1); // NVDA is a new match
  assert.equal(await runValueAlerts(), 0); // and is not announced twice
  assert.deepEqual((await pro('/stock/filters/Fast%20growers', null, 'DELETE')).body.saved, []);
});

test('technicals and supply & demand: honest when only daily closes are available', async () => {
  const t = (await pro('/stock/AAPL/technicals')).body;
  assert.ok(t.technical.read.length > 10); assert.equal(t.full, false);
  assert.equal(t.supply.available, false); assert.match(t.supply.note, /high, low and volume/);
});
