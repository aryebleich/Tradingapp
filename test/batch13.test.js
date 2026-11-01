// Market data sources, the trading desk and sell checks, paper limit/stop orders, fundamentals and
// the growth/value screen, futures/funds/savings, tax rates, stat-arb methods and scans, the
// business inbox, keypad tickers, search and the README sections.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { serve } from './client.js';

let fake, hits = [];
const year = new Date().getUTCFullYear() - (new Date().getUTCMonth() >= 3 ? 1 : 2);
before(async () => {
  fake = http.createServer((req, res) => {
    hits.push(req.url);
    const j = x => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(x)); };
    const u = new URL(req.url, 'http://x');
    // Stooq: CSV quote; Finnhub: JSON quote (slower).
    if (u.pathname === '/stooq/q/l/') { res.setHeader('Content-Type', 'text/csv'); return res.end('Symbol,Date,Time,Close\nSPY.US,2026-10-30,22:00:00,512.34\n'); }
    if (u.pathname === '/finnhub/quote') return setTimeout(() => j({ c: 512.5 }), 60);
    // SEC: tickers, frames, submissions.
    if (u.pathname === '/sec/files/company_tickers.json') return j({ 0: { cik_str: 1, ticker: 'BIGCO', title: 'Big Company Inc' }, 1: { cik_str: 2, ticker: 'SMALLCO', title: 'Small Co' }, 2: { cik_str: 3, ticker: 'AAPL', title: 'Apple Inc.' } });
    const fr = /^\/secdata\/api\/xbrl\/frames\/[\w-]+\/(\w+)\/[\w-]+\/CY(\d+)(Q4I)?\.json$/.exec(u.pathname);
    if (fr) {
      const [, tag, y] = fr, cur = +y === year;
      const v = { Revenues: cur ? [1e11, 5e8] : [8e10, 4e8], NetIncomeLoss: [2e10, 2e7], EarningsPerShareDiluted: cur ? [10, 0.5] : [8, 0.4], StockholdersEquity: [1e11, 3e8], WeightedAverageNumberOfDilutedSharesOutstanding: [2e9, 4e7] }[tag];
      return j({ data: v ? [{ cik: 1, val: v[0] }, { cik: 2, val: v[1] }] : [] });
    }
    if (/^\/secdata\/submissions\/CIK0+1\.json$/.test(u.pathname)) return j({ name: 'Big Company Inc', sicDescription: 'Services-Prepackaged Software', exchanges: ['Nasdaq'], fiscalYearEnd: '1231' });
    res.statusCode = 404; j({});
  });
  await new Promise(r => fake.listen(0, r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { DATA_SOURCES_TEST: '1', STOOQ_URL: url + '/stooq', FINNHUB_API_URL: url + '/finnhub', FINNHUB_API_KEY: 'fk', YAHOO_URL: url + '/yahoo', SEC_WWW_URL: url + '/sec', SEC_DATA_URL: url + '/secdata' });
});
after(() => fake.close());

test('market data sources: fastest first, the owner\'s order, race, and Admin → Market data', async () => {
  const DS = await import('../src/datasources.js');
  DS._reset();
  let q = await DS.quote('SPY');
  assert.ok(q.price > 0);
  // After measuring, the fastest working source leads; Yahoo (404 here) sinks to the bottom.
  for (let i = 0; i < 3; i++) await DS.quote('SPY');
  const plan = DS.plan('quote');
  assert.ok(plan.indexOf('stooq') < plan.indexOf('finnhub'), plan.join(','));
  assert.ok(plan.indexOf('stooq') < plan.indexOf('yahoo'));
  const s = await serve();
  try {
    const owner = s.client(); await owner('/auth/register', { email: 'site-owner@example.com', password: 'Str0ngPassword' });
    let r = (await owner('/admin/site/data')).body;
    assert.equal(r.mode, 'fastest'); assert.ok(r.providers.find(p => p.id === 'tiingo').configured === false);
    r = (await owner('/admin/site/data', { mode: 'order', order: ['finnhub', 'stooq'], off: ['yahoo'] }, 'PUT')).body;
    assert.equal(r.mode, 'order'); assert.deepEqual(r.active.slice(0, 2), ['finnhub', 'stooq']); assert.ok(!r.active.includes('yahoo'));
    assert.equal((await DS.quote('SPY')).source, 'finnhub');
    await owner('/admin/site/data', { mode: 'race' }, 'PUT');
    q = await DS.quote('SPY'); assert.ok(['finnhub', 'stooq'].includes(q.source));
    const b = (await owner('/admin/site/data/test', { symbol: 'SPY' })).body;
    assert.ok(b.results.find(x => x.id === 'stooq').ok); assert.equal(b.results.find(x => x.id === 'yahoo').skipped, 'off');
    const u = s.client(); await u.signup('data-user@example.com');
    assert.equal((await u('/admin/site/data')).status, 403);
    await owner('/admin/site/data', { mode: 'fastest', off: [] }, 'PUT');
  } finally { s.close(); }
});

test('trading desk: session with holidays and early closes, costs, holdings and sells that match the account', async () => {
  const D = await import('../src/desk.js');
  assert.equal(D.session(Date.parse('2026-11-02T15:00:00Z')).open, true);
  assert.equal(D.session(Date.parse('2026-11-26T15:00:00Z')).holiday, true);
  assert.equal(new Date(D.session(Date.parse('2026-11-27T15:00:00Z')).nextClose).toISOString(), '2026-11-27T18:00:00.000Z');
  assert.equal(D.session(Date.parse('2026-11-02T22:00:00Z')).status, 'after-hours');
  const c = D.costs({ side: 'sell', qty: 100, price: 50, bid: 49.98, ask: 50.02 });
  assert.equal(c.secFee, 0.139); assert.equal(c.finraTaf, 0.0166); assert.equal(c.spreadBps, 8); assert.equal(c.halfSpread, 2);
  assert.equal(D.costs({ side: 'buy', qty: 100, price: 50 }).regulatory, 0, 'no regulatory fees on buys');
  // Alpaca: a sell beyond what is held (or of something not held) is refused unless shorting.
  const { sellCheck } = await import('../src/alpaca/trading.js');
  const t = { position: async s => (s === 'AAPL' ? { qty: '10', qty_available: '7', current_price: '180' } : Promise.reject(Object.assign(new Error('position does not exist'), { status: 404 }))) };
  await assert.rejects(sellCheck(t, { side: 'sell', symbol: 'MSFT', qty: '1' }), /do not own any MSFT/);
  await assert.rejects(sellCheck(t, { side: 'sell', symbol: 'AAPL', qty: '8' }), /up to 7 AAPL.*set aside/);
  assert.equal((await sellCheck(t, { side: 'sell', symbol: 'AAPL', qty: '7' })).held, 7);
  assert.equal((await sellCheck(t, { side: 'sell', symbol: 'MSFT', qty: '1' }, { allowShort: true })).held, 0);
  await assert.rejects(sellCheck(t, { side: 'sell', symbol: 'AAPL', notional: '1500' }), /up to 7/);
  assert.equal(await sellCheck(t, { side: 'buy', symbol: 'MSFT', qty: '1' }), null);
});

test('paper orders: limit, stop and stop-limit wait for their price; sells never exceed holdings', async () => {
  const P = await import('../src/paperorders.js');
  const o = { side: 'buy', type: 'limit', limit_price: 100 };
  assert.equal(P.evaluate(o, 101), null); assert.equal(P.evaluate(o, 99.5), 'fill');
  assert.equal(P.evaluate({ side: 'sell', type: 'stop', stop_price: 90 }, 89), 'fill');
  assert.equal(P.evaluate({ side: 'sell', type: 'stop_limit', stop_price: 90, limit_price: 88 }, 87), 'trigger', 'stopped through the limit: waits');
  assert.equal(P.evaluate({ side: 'sell', type: 'stop_limit', stop_price: 90, limit_price: 88, triggered: 1 }, 88.5), 'fill');
  const s = await serve();
  try {
    const u = s.client(); await u.signup('paperorders@example.com');
    await u('/account');
    const px = (await u('/quote/AAPL')).body.price;
    assert.equal((await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'sell', qty: 1, type: 'limit', limit_price: px })).status, 409, 'nothing to sell');
    assert.equal((await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 5 })).status, 200);
    const far = await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 2, type: 'limit', limit_price: +(px * 0.5).toFixed(2), time_in_force: 'gtc' });
    assert.match(far.body.status, /open/);
    const now = await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limit_price: +(px * 1.1).toFixed(2) });
    assert.equal(now.body.status, 'filled', 'a marketable limit fills at once');
    // Sells: 6 held; a resting sell of 4 leaves only 2 free to sell.
    const st = await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'sell', qty: 4, type: 'stop', stop_price: +(px * 0.5).toFixed(2) });
    assert.match(st.body.status, /open/);
    const tooMany = await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'sell', qty: 3, type: 'limit', limit_price: +(px * 2).toFixed(2) });
    assert.equal(tooMany.status, 409); assert.match(tooMany.body.error, /up to 2/);
    assert.equal((await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'sell', qty: 7 })).status, 409, 'market sell above holdings refused');
    const list = (await u('/orders?account=paper')).body;
    assert.equal(list.filter(o => o.status === 'open').length, 2);
    assert.equal((await u('/paper/orders/' + far.body.id, null, 'DELETE')).status, 200);
    const d = (await u('/desk/quote/AAPL?account=paper&side=sell&qty=2')).body;
    assert.equal(d.holding.qty, 6); assert.equal(d.holding.available, 2); assert.ok(d.costs.secFee > 0); assert.ok(d.session.status);
    // A sell of all that is free goes through and matches the account.
    assert.equal((await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'sell', qty: 6 })).status, 200);
    assert.equal((await u('/desk/quote/AAPL?account=paper')).body.holding.qty, 0);
  } finally { s.close(); }
});

test('fundamentals from SEC filings: profile, size classes, blue chips, growth and value screen', async () => {
  const F = await import('../src/fundamentals.js');
  assert.equal(F.capClass(3e12).id, 'mega'); assert.equal(F.capClass(5e9).id, 'mid'); assert.equal(F.capClass(1e9).id, 'small'); assert.equal(F.capClass(1e8).id, 'micro');
  assert.ok(F.isBlueChip('JNJ', { id: 'large' })); assert.ok(!F.isBlueChip('JNJ', { id: 'small' }));
  const f = await F.frames(), big = F.fundamentalsFromFrames(f, 1);
  assert.equal(big.revenueGrowth, 25); assert.equal(big.epsGrowth, 25); assert.equal(big.shares, 2e9);
  const r = F.ratios(big, 150);
  assert.equal(r.marketCap, 3e11); assert.equal(r.pe, 15); assert.equal(r.pb, 3); assert.equal(r.capClass.id, 'mega');
  const s = await serve();
  try {
    const u = s.client(); await u.signup('fundamentals@example.com');
    const p = (await u('/fundamentals/profile/BIGCO')).body;
    assert.equal(p.company.industry, 'Services-Prepackaged Software'); assert.ok(p.ratios.marketCap > 0); assert.ok(p.perf.volatility > 0);
    const e = (await u('/fundamentals/profile/VOO')).body;
    assert.equal(e.kind, 'etf'); assert.equal(e.etf.expenseRatio, 0.03);
  } finally { s.close(); }
});

test('futures, mutual funds and savings; rates and a local mortgage view', async () => {
  const I = await import('../src/instruments.js');
  const m = I.contractMath('ES', 5000);
  assert.equal(m.notional, 250000); assert.equal(m.tickValue, 12.5); assert.equal(m.margin, 20000);
  assert.equal(I.mortgageMonthly(500000, 20, 6, 30), 2398.2);
  const s = await serve();
  try {
    const u = s.client(); await u.signup('futures@example.com');
    await u('/account');
    const f = (await u('/instruments/futures')).body;
    assert.ok(f.contracts.find(c => c.root === 'MES'));
    assert.equal((await u('/instruments/futures/trade', { root: 'ES', contracts: 50 })).status, 409, 'not enough margin');
    assert.equal((await u('/instruments/futures/trade', { root: 'MES', contracts: 2 })).body.position, 2);
    assert.equal((await u('/instruments/futures/trade', { root: 'MES', contracts: -2 })).body.position, 0);
    assert.equal((await u('/instruments/futures')).body.positions.length, 0);
    const funds = (await u('/instruments/funds')).body.funds;
    assert.equal(funds.find(x => x.symbol === 'FXAIX').etf, 'IVV');
    assert.ok((await u('/instruments/savings')).body.cashFunds.includes('SGOV'));
    await u('/taxrates', { state: 'NJ', filing: 'single', income: 90000 }, 'PUT');
    const loc = (await u('/instruments/rates?price=600000&down=10')).body.local;
    assert.equal(loc.state, 'NJ'); assert.equal(loc.propertyTaxPct, 2.23); assert.equal(loc.jumbo, false);
  } finally { s.close(); }
});

test('tax rates: set from state, filing status and income, and the new year\'s tables each January', async () => {
  const T = await import('../src/taxrates.js');
  const r = T.ratesFor({ state: 'NY', filing: 'single', income: 75000 }, 2026);
  assert.equal(r.taxable, 58900); assert.equal(r.federal, 0.22); assert.equal(r.longTerm, 0.15); assert.equal(r.stateRate, 0.055); assert.equal(r.niit, 0);
  assert.equal(T.ratesFor({ state: 'TX', filing: 'mfj', income: 120000 }, 2026).federal, 0.12);
  assert.equal(T.ratesFor({ state: 'TX', filing: 'mfj', income: 120000 }, 2026).stateRate, 0);
  assert.equal(T.ratesFor({ state: 'CA', filing: 'single', income: 600000 }, 2026).niit, 0.038);
  const e = T.federalTable(2028);
  assert.equal(e.estimated, true); assert.ok(e.single.b[0] > 12400, 'indexed for inflation');
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('taxrates@example.com');
    assert.equal((await u('/taxrates', { state: 'XX' }, 'PUT')).status, 400);
    const p = (await u('/taxrates', { state: 'IL', filing: 'single', income: 120000 }, 'PUT')).body;
    assert.equal(p.rates.stateRate, 0.0495); assert.equal(p.applied, true);
    const { one } = await import('../src/db.js');
    const row = await one('SELECT tax_bracket, state_tax FROM users WHERE id = ?', me.id);
    assert.equal(row.tax_bracket, 0.22); assert.equal(row.state_tax, 0.0495);
    assert.ok((await T.yearlyUpdate(Date.parse('2027-01-02T12:00:00Z'))) >= 1);
  } finally { s.close(); }
});

test('stat arb: four gap methods, PCA factor, and a live scan of a custom list', async () => {
  const S = await import('../src/statscan.js');
  const n = 400, a = [], b = [];
  let x = 100; for (let i = 0; i < n; i++) { x *= 1 + Math.sin(i * 1.7) * 0.01; const noise = Math.sin(i * 0.9) * 0.6; a.push(x * 1.5 + noise); b.push(x); }
  for (const m of Object.keys(S.METHODS)) { const r = S.testPair(a, b, m); assert.ok(Number.isFinite(r.z), m); assert.ok(r.correlation > 0.5, m); }
  assert.ok(S.testPair(a, b, 'ols').cointegrated);
  const k = S.kalman(b.map(v => v * 2 + 1), b); assert.ok(Math.abs(k.beta.at(-1) - 2) < 0.3);
  const f = S.pcaFactor({ A: [0.01, -0.02, 0.03, 0], B: [0.012, -0.018, 0.028, 0.001], C: [0.009, -0.021, 0.031, -0.001] });
  assert.equal(f.length, 4);
  const s = await serve();
  try {
    const u = s.client(); await u.signup('statscan@example.com');
    const meta = (await u('/statscan/meta')).body; assert.ok(meta.methods.kalman); assert.equal(meta.limit, 40);
    let j = (await u('/statscan', { universe: 'custom', symbols: 'KO, PEP, PG, CL, KMB, MDLZ', method: 'kalman' })).body;
    for (let i = 0; i < 80 && !['done', 'error'].includes(j.status); i++) { await new Promise(r => setTimeout(r, 100)); j = (await u('/statscan/' + j.id)).body; }
    assert.equal(j.status, 'done', j.error); assert.equal(j.total, 6); assert.equal(j.method, 'kalman');
    const an = (await u('/statarb/analyze', { symbols: 'KO, PEP, PG, CL', method: 'distance', factor: 'pca' })).body;
    assert.equal(an.params.method, 'distance'); assert.equal(an.params.factor, 'pca'); assert.equal(an.matrix.length, 6);
  } finally { s.close(); }
});

test('business inbox: texts from strangers, inbound email, replies; keypad tickers; search; README sections', async () => {
  const s = await serve();
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  try {
    const sms = await fetch(s.base + '/twilio/sms', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: '+18455550777', Body: 'Hi, do you have an app for iPhone?' }) });
    assert.match(await sms.text(), /Thanks for your message/);
    const owner = s.client(); await owner('/auth/register', { email: 'site-owner2@example.com', password: 'Str0ngPassword' });
    const st = (await owner('/admin/comms/settings', { forwardTo: '+18455551234', notes: 'We have an Android app.' }, 'PUT')).body;
    assert.ok(st.emailToken.length > 10);
    assert.equal((await fetch(s.base + '/hooks/email/inbound?token=wrong', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const em = await fetch(`${s.base}/hooks/email/inbound?token=${st.emailToken}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ from: 'Dana <dana@example.com>', subject: 'Pricing', text: 'How much is Pro?' }) });
    assert.equal(em.status, 200);
    let inbox = (await owner('/admin/comms')).body;
    assert.ok(inbox.items.find(m => m.channel === 'sms' && m.party === '+18455550777'));
    const mail = inbox.items.find(m => m.channel === 'email'); assert.equal(mail.party, 'dana@example.com');
    assert.equal((await owner(`/admin/comms/${mail.id}/draft`, {})).status, 503, 'no AI provider in tests');
    assert.equal((await owner(`/admin/comms/${mail.id}/reply`, { body: 'Pro is $29 a month.' })).status, 200);
    inbox = (await owner('/admin/comms')).body;
    assert.ok(!inbox.items.find(m => m.id === mail.id), 'answered leaves the open inbox');
    assert.ok((await owner('/admin/comms?status=all')).body.items.find(m => m.direction === 'out' && m.party === 'dana@example.com'));
    const u = s.client(); await u.signup('comms-user@example.com');
    assert.equal((await u('/admin/comms')).status, 403);
    // Keypad tickers (AAPL is 2275).
    const H = await import('../src/hotline.js');
    assert.equal(H.keypadOf('AAPL'), '2275');
    assert.ok((await H.keypadTickers('2275')).includes('AAPL'));
    // Search: stocks and funds by name, the user's own rule; never admin pages.
    await u('/rules', { name: 'Grandkids college fund', targets: [{ symbol: 'VTI', pct: 100 }], accounts: ['paper'] });
    let r = (await u('/search?q=big company')).body; assert.ok(r.symbols.find(x => x.symbol === 'BIGCO'));
    r = (await u('/search?q=FXAIX')).body; assert.equal(r.symbols[0].kind, 'Mutual fund');
    r = (await u('/search?q=college')).body; assert.equal(r.mine[0].kind, 'Rule');
    // README sections merge in once and are replaced, not duplicated.
    const R = await import('../src/readme-auto.js');
    const once = R.mergeSections('# My README\n\nPrivate notes.'), twice = R.mergeSections(once);
    assert.equal(once, twice); assert.match(once, /Private notes/); assert.match(once, /What does "interchange" mean/);
    const { markdownPdf } = await import('../src/pdf.js');
    const pdf = Buffer.from(markdownPdf('| Plan | Price |\n|---|---|\n| Pro | $29 |\n\n```\nA ──▶ B\n```', { title: 'x', toc: false }).pdf).toString('latin1');
    assert.match(pdf, /Price: \$29/); assert.match(pdf, /A to B/); assert.doesNotMatch(pdf, /\| *\$29/);
  } finally { console.log = orig; s.close(); }
});

test('a paper Day order placed after the close stays for the next session', async () => {
  const { orderDay } = await import('../src/desk.js');
  const { nyAt } = await import('../src/time.js');
  assert.equal(orderDay(nyAt('2026-11-02', 600)), '2026-11-02'); // Monday 10 AM
  assert.equal(orderDay(nyAt('2026-11-02', 1000)), '2026-11-03'); // Monday after the close
  assert.equal(orderDay(nyAt('2026-11-06', 1000)), '2026-11-09'); // Friday evening → Monday
  assert.equal(orderDay(nyAt('2026-11-26', 600)), '2026-11-27'); // Thanksgiving
  assert.equal(orderDay(nyAt('2026-11-27', 800)), '2026-11-30'); // after the 1 PM early close
});
