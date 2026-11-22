// The stock page's math (src/stock.js): statements from SEC company facts, valuation and its label,
// dividends and their safety score, technicals, supply and demand, earnings reactions, the
// growth-at-a-price filters and the company card shown before a buy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annualSeries, quarterlySeries, statements, keyRatios, valuation, dividendView, incomeForecast, technicalRead, supplyDemand, levels,
  earningsReactions, nextEarnings, strengthsRisks, applyFilters, cleanFilters, PRESETS, buildCard, range52, reportDatesFrom, NOT_ADVICE } from '../src/stock.js';

// SEC company facts in their real shape: one row per figure, with the form, the period and the filing date.
const fy = (y, val, extra = {}) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, form: '10-K', fy: y, fp: 'FY', filed: `${y + 1}-02-15`, ...extra });
const pt = (y, val) => ({ end: `${y}-12-31`, val, form: '10-K', fy: y, fp: 'FY', filed: `${y + 1}-02-15` });
const years = [2020, 2021, 2022, 2023, 2024, 2025];
const usd = (k, vals) => ({ [k]: { units: { USD: years.map((y, i) => fy(y, vals[i])) } } });
const facts = { 'us-gaap': {
  ...usd('Revenues', [100, 110, 125, 140, 160, 185].map(x => x * 1e9)),
  ...usd('GrossProfit', [40, 45, 52, 59, 68, 80].map(x => x * 1e9)),
  ...usd('OperatingIncomeLoss', [20, 23, 27, 31, 36, 42].map(x => x * 1e9)),
  ...usd('NetIncomeLoss', [15, 17, 20, 23, 27, 32].map(x => x * 1e9)),
  ...usd('DepreciationDepletionAndAmortization', [5, 5, 6, 6, 7, 8].map(x => x * 1e9)),
  ...usd('NetCashProvidedByUsedInOperatingActivities', [22, 24, 28, 31, 36, 42].map(x => x * 1e9)),
  ...usd('PaymentsToAcquirePropertyPlantAndEquipment', [5, 6, 7, 7, 8, 9].map(x => x * 1e9)),
  ...usd('PaymentsOfDividendsCommonStock', [4, 4.4, 4.8, 5.3, 5.8, 6.4].map(x => x * 1e9)),
  Assets: { units: { USD: years.map((y, i) => pt(y, [200, 210, 230, 250, 270, 300][i] * 1e9)) } },
  StockholdersEquity: { units: { USD: years.map((y, i) => pt(y, [80, 85, 92, 100, 110, 120][i] * 1e9)) } },
  LongTermDebtNoncurrent: { units: { USD: years.map((y, i) => pt(y, [40, 40, 38, 36, 35, 30][i] * 1e9)) } },
  CashAndCashEquivalentsAtCarryingValue: { units: { USD: years.map((y, i) => pt(y, [20, 22, 24, 25, 28, 30][i] * 1e9)) } },
  EarningsPerShareDiluted: { units: { 'USD/shares': [...years.map((y, i) => fy(y, [1.5, 1.7, 2.0, 2.3, 2.7, 3.2][i])),
    // Quarterly EPS (about 90 days) for the trailing twelve months.
    ...[['2025-01-01', '2025-03-31', 0.75], ['2025-04-01', '2025-06-30', 0.8], ['2025-07-01', '2025-09-30', 0.8], ['2025-10-01', '2025-12-31', 0.85]].map(([start, end, val]) => ({ start, end, val, form: '10-Q', filed: end }))] } },
  CommonStockDividendsPerShareDeclared: { units: { 'USD/shares': years.map((y, i) => fy(y, [0.4, 0.44, 0.48, 0.53, 0.58, 0.64][i])) } },
  WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: years.map(y => fy(y, 10e9)) } },
} };

test('annual series take one fiscal-year figure per year, the latest filing winning, and skip quarters', () => {
  const f = { 'us-gaap': { Revenues: { units: { USD: [fy(2024, 100), { ...fy(2024, 105), filed: '2026-02-01' }, { start: '2024-10-01', end: '2024-12-31', val: 30, form: '10-K', filed: '2025-02-15' }, fy(2025, 120)] } } } };
  assert.deepEqual(annualSeries(f, ['Revenues']).map(x => [x.year, x.value]), [[2024, 105], [2025, 120]]);
  assert.deepEqual(annualSeries(f, ['Missing']), []);
  assert.equal(quarterlySeries(facts).length, 4);
});

test('statements and ratios: 5-year trends, margins, ROE, debt and free cash flow', () => {
  const st = statements(facts);
  assert.deepEqual(st.years, years);
  const last = st.rows.at(-1);
  assert.equal(last.fcf, 33e9); assert.equal(last.ebitda, 50e9);
  const rt = keyRatios(st.rows);
  assert.equal(rt.latest.grossMargin, 43.2); assert.equal(rt.latest.netMargin, 17.3);
  assert.equal(rt.latest.debtToEquity, 0.25);
  assert.equal(rt.latest.roe, 27.8); // 32 / average equity (110 + 120) / 2
  assert.equal(rt.revenueGrowth, 13.1); // 100 → 185 over 5 years
  assert.equal(rt.revenueTrend, 'speeding up');
});

test('valuation: trailing P/E from four quarters, PEG, P/S, EV/EBITDA and the label against its own history', () => {
  const rows = statements(facts).rows;
  const fyPrices = Object.fromEntries(rows.map((x, i) => [x.end, [30, 40, 44, 46, 54, 64][i]])); // P/E 20, 23.5, 22, 20, 20, 20
  const v = valuation({ price: 96, rows, ttmEps: 3.2, fyPrices, sectorPE: 24 });
  assert.equal(v.pe, 30); assert.equal(v.marketCap, 960e9);
  assert.equal(v.history.length, 5);
  assert.equal(v.avg5, 21.1);
  assert.equal(v.label.id, 'expensive'); // 30 / 21.1 > 1.15
  assert.equal(v.vsSector, 1.25);
  assert.equal(v.ps, 5.19); // 960 / 185
  assert.equal(v.evEbitda, 19.2); // (960 + 30 − 30) / 50
  assert.ok(v.peg > 0 && v.peg < 3);
  assert.match(v.method, /85%/);
  // Cheap and fair, and no P/E for a loss.
  assert.equal(valuation({ price: 50, rows, ttmEps: 3.2, fyPrices }).label.id, 'cheap');
  assert.equal(valuation({ price: 67.5, rows, ttmEps: 3.2, fyPrices }).label.id, 'fair');
  const loss = valuation({ price: 10, rows, ttmEps: -1, fyPrices });
  assert.equal(loss.pe, null); assert.equal(loss.label.id, 'na'); assert.match(loss.label.text, /lost money/);
  // Forward P/E only with an estimate.
  assert.equal(v.forwardPe, null); assert.equal(valuation({ price: 96, rows, ttmEps: 3.2, forwardEps: 4 }).forwardPe, 24);
});

test('dividends: yield, payout, growth streak and a safety score with its parts; income forecast', () => {
  const rows = statements(facts).rows;
  const d = dividendView(rows, 64);
  assert.equal(d.pays, true); assert.equal(d.yieldPct, 1); assert.equal(d.payout, 20); assert.equal(d.streak, 5);
  assert.ok(d.safety.score >= 70, JSON.stringify(d.safety)); assert.equal(d.safety.parts.length, 5);
  assert.equal(dividendView(rows.map(x => ({ ...x, dps: null })), 64).pays, false);
  const f = incomeForecast([{ symbol: 'X', qty: 100, price: 64 }, { symbol: 'Y', qty: 10, price: 5 }], { X: 0.64 });
  assert.equal(f.total, 64); assert.equal(f.rows[0].symbol, 'X'); assert.match(f.note, /cut/);
});

const series = (n, f) => Array.from({ length: n }, (_, i) => { const c = f(i); return { t: `2025-${String(1 + Math.floor(i / 28) % 12).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`, o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6 + (i % 5) * 1e5 }; });

test('technicals: trend, RSI, MACD and support / resistance in plain words', () => {
  const up = technicalRead(series(260, i => 100 + i * 0.5 + Math.sin(i / 3) * 2));
  assert.equal(up.trend, 'up'); assert.match(up.read, /uptrend/); assert.ok(up.rsi > 50);
  const down = technicalRead(series(260, i => 300 - i * 0.5));
  assert.equal(down.trend, 'down'); assert.match(down.note, /not a forecast/);
  const lv = levels(series(120, i => 100 + Math.sin(i / 4) * 10));
  assert.ok(lv.support.length + lv.resistance.length > 0);
});

test('supply and demand: buyer/seller gauge, volume profile, unusual volume, labelled indicative', () => {
  const buying = series(60, i => 100 + i).map(b => ({ ...b, c: b.h })); // every close at the high
  const s = supplyDemand(buying, { bid: 159.9, ask: 160.1, bidSize: 3, askSize: 5 });
  assert.equal(s.available, true); assert.equal(s.control, 'Buyers in control'); assert.ok(s.gauge > 90); assert.equal(s.buyPct, 100);
  assert.equal(s.profile.length, 24); assert.ok(s.poc.from < s.poc.to);
  assert.equal(s.top.spread, 0.2); assert.equal(s.depth, null); assert.match(s.note, /Indicative/);
  const spike = series(30, () => 50); spike[29] = { ...spike[29], v: 5e6 };
  assert.equal(supplyDemand(spike).unusual.flag, true);
  assert.equal(supplyDemand([{ c: 1 }]).available, false);
});

test('earnings: report dates from 8-K item 2.02, the price move after each, the next date estimated without a key', () => {
  const subs = { filings: { recent: { form: ['8-K', '10-Q', '8-K', '8-K'], items: ['2.02,9.01', '', '5.02', '2.02'], filingDate: ['2025-07-30', '2025-07-31', '2025-08-10', '2025-10-29'] } } };
  assert.deepEqual(reportDatesFrom(subs), ['2025-07-30', '2025-10-29']);
  const dates = ['2025-07-28', '2025-07-29', '2025-07-30', '2025-07-31', '2025-08-01'], closes = [100, 100, 101, 110, 111];
  assert.deepEqual(earningsReactions(['2025-07-30'], closes, dates), [{ date: '2025-07-30', move: 10 }]);
  const nx = nextEarnings(['2025-10-29'], null, Date.parse('2025-11-15'));
  assert.equal(nx.estimated, true); assert.equal(nx.date, '2026-01-28');
  assert.deepEqual(nextEarnings(['2025-10-29'], '2026-02-01'), { date: '2026-02-01', estimated: false });
});

test('growth-at-a-price filters: presets, validation and every filter', () => {
  const rows = [
    { symbol: 'FAST', pe: 45, epsGrowth: 30, revenueGrowth: 25, netMargin: 22, fcf: 5e9, beats: 4, revenueTrend: 'speeding up', dividendYield: 0 },
    { symbol: 'TIRED', pe: 40, epsGrowth: -5, revenueGrowth: 3, netMargin: 8, fcf: 1e9, beats: 1, revenueTrend: 'slowing', dividendYield: 1 },
    { symbol: 'CHEAP', pe: 11, epsGrowth: 4, revenueGrowth: 2, netMargin: 12, fcf: 2e9, beats: 2, revenueTrend: 'steady', dividendYield: 3.5 },
    { symbol: 'LOSS', pe: null, epsGrowth: null, revenueGrowth: 40, netMargin: -10, fcf: -1e9, beats: null, revenueTrend: 'speeding up', dividendYield: 0 },
  ];
  assert.deepEqual(applyFilters(rows, PRESETS.growth.filters).map(r => r.symbol), ['FAST']);
  assert.deepEqual(applyFilters(rows, PRESETS.weakening.filters).map(r => r.symbol), ['TIRED']);
  assert.deepEqual(applyFilters(rows, PRESETS.value.filters).map(r => r.symbol), ['CHEAP']);
  assert.deepEqual(applyFilters(rows, { dividendYieldMin: 3 }).map(r => r.symbol), ['CHEAP']);
  assert.deepEqual(applyFilters(rows, { beatsMin: 3 }).map(r => r.symbol), ['FAST']);
  assert.deepEqual(applyFilters(rows, {}).length, 4);
  assert.deepEqual(cleanFilters({ peMin: '30', fcfPositive: 'true', junk: 1, peMax: '' }), { peMin: 30, fcfPositive: true });
  assert.throws(() => cleanFilters({ peMin: 'lots' }), /must be a number/);
});

test('the company card before a buy: the essentials, never advice, and safe for funds', () => {
  const rows = statements(facts).rows;
  const val = valuation({ price: 96, rows, ttmEps: 3.2, sectorPE: 24 }), div = dividendView(rows, 96), rt = keyRatios(rows);
  const sr = strengthsRisks({ ratios: rt, val, div });
  assert.ok(sr.strengths.length && sr.strengths.every(s => !/guarantee|will rise/i.test(s)));
  const c = buildCard({ symbol: 'ACME', name: 'Acme Corp', about: 'Acme Corp · Widgets.', sector: 'Widgets', val, div, earn: { last: '2025-10-29', next: { date: '2026-01-28', estimated: true } }, range52: range52([90, 80, 100, 95]), headlines: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }], sr });
  assert.equal(c.pe, 30); assert.equal(c.sectorPE, 24); assert.equal(c.headlines.length, 3); assert.equal(c.nextEarnings.estimated, true);
  assert.deepEqual(c.range52, { low: 80, high: 100, at: 75 });
  assert.ok(c.strength); assert.match(c.note, /never blocks/);
  const fund = buildCard({ symbol: 'VOO', name: 'VOO', etf: true });
  assert.equal(fund.etf, true); assert.equal(fund.pe, null);
  assert.match(NOT_ADVICE, /^For planning and education only\. Not investment advice and not an order: nothing is sent to your broker\./);
});
