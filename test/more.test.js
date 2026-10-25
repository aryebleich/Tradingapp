// Options, sentiment, halal and zakat, 13F tracking, spend-based investing, taxes, insights and the
// AI assistant's tool loop, with a local stand-in for StockTwits, SEC EDGAR, Plaid and Claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const calls = [];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null, u = req.url, json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    calls.push({ url: u, body, headers: req.headers });
    if (u.startsWith('/st/streams/symbol/AAPL.json')) return json({ symbol: { watchlist_count: 1000 }, messages: [{ entities: { sentiment: { basic: 'Bullish' } } }, { entities: { sentiment: { basic: 'Bullish' } } }, { entities: { sentiment: { basic: 'Bearish' } } }, { entities: {} }] });
    if (u === '/sec-data/submissions/CIK0001067983.json') return json({ name: 'BERKSHIRE HATHAWAY INC', filings: { recent: { form: ['4', '13F-HR', '13F-HR'], accessionNumber: ['x', '0000950123-26-000002', '0000950123-26-000001'], filingDate: ['2026-08-20', '2026-08-14', '2026-05-15'], reportDate: ['', '2026-06-30', '2026-03-31'] } } });
    if (u.endsWith('/000095012326000002/index.json')) return json({ directory: { item: [{ name: 'primary_doc.xml' }, { name: 'infotable.xml' }] } });
    if (u.endsWith('/000095012326000001/index.json')) return json({ directory: { item: [{ name: 'primary_doc.xml' }, { name: 'q1.xml' }] } });
    const row = (n, c, v, s) => `<infoTable><nameOfIssuer>${n}</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>${c}</cusip><value>${v}</value><shrsOrPrnAmt><sshPrnamt>${s}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>`;
    if (u.endsWith('/infotable.xml')) { res.writeHead(200); return res.end(`<informationTable>${row('APPLE INC', '037833100', 60000000000, 300000000)}${row('APPLE INC', '037833100', 1000000000, 5000000)}${row('BANK AMER CORP', '060505104', 30000000000, 700000000)}${row('CHEVRON CORP NEW', '166764100', 10000000000, 60000000)}</informationTable>`); }
    if (u.endsWith('/q1.xml')) { res.writeHead(200); return res.end(`<informationTable>${row('APPLE INC', '037833100', 50000000000, 300000000)}${row('BANK AMER CORP', '060505104', 35000000000, 800000000)}${row('PARAMOUNT GLOBAL', '92556H206', 500000000, 60000000)}</informationTable>`); }
    if (u === '/sec-www/files/company_tickers.json') return json({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 70858, ticker: 'BAC', title: 'BANK OF AMERICA CORP /DE/' }, 2: { cik_str: 93410, ticker: 'CVX', title: 'CHEVRON CORP' } });
    if (u === '/plaid/link/token/create') return json({ link_token: 'link-sandbox-123' });
    if (u === '/plaid/item/public_token/exchange') return json({ access_token: 'access-sandbox-abc', item_id: 'item1' });
    if (u === '/plaid/transactions/sync') return json({ added: [{ transaction_id: 't1', amount: 4.35, date: '2026-10-20', merchant_name: 'Starbucks' }, { transaction_id: 't2', amount: 52.10, date: '2026-10-21', name: 'TARGET 00012' }, { transaction_id: 't3', amount: -20, date: '2026-10-21', name: 'Refund' }], has_more: false, next_cursor: 'c1' });
    if (u === '/claude/v1/messages?beta=true' || u === '/claude/v1/messages') {
      const last = body.messages.at(-1);
      if (typeof last.content === 'string') return json({ id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'tu1', name: 'technical_snapshot', input: { symbol: 'AAPL' } }, { type: 'tool_use', id: 'tu2', name: 'propose_strategy', input: { name: 'AAPL dip', symbol: 'AAPL', entry: 'RSI(14) < 30', exit: 'RSI(14) > 55', explanation: 'Buy oversold dips.' } }], usage: { input_tokens: 1, output_tokens: 1 } });
      const results = last.content.filter(c => c.type === 'tool_result');
      return json({ id: 'm2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: `AAPL looks fine. tools=${results.length} err=${results.some(r => r.is_error)}` }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    json({ error: 'not found ' + u }, 404);
  });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const F = `http://127.0.0.1:${fake.address().port}`;
Object.assign(process.env, { STOCKTWITS_URL: F + '/st', SEC_DATA_URL: F + '/sec-data', SEC_WWW_URL: F + '/sec-www', PLAID_CLIENT_ID: 'pc', PLAID_SECRET: 'ps', PLAID_BASE_URL: F + '/plaid' });
const { serve } = await import('./client.js');
const { payoff, buildTemplate, incomeCandidates, bs } = await import('../src/options.js');
const { scoreText } = await import('../src/sentiment.js');
const { zakat, screen } = await import('../src/halal.js');
const { plan, tickerFor } = await import('../src/roundup.js');
const { roundTrips, twr, execution } = await import('../src/insights.js');
const { run } = await import('../src/db.js');

let srv; before(async () => { srv = await serve(); await srv.client().signup('owner@example.com'); }); after(() => { srv.close(); fake.close(); });

test('options: pricing, payoff, templates and income candidates', () => {
  const c = bs(100, 100, 30 / 365, 0.3, 'call'), p = bs(100, 100, 30 / 365, 0.3, 'put');
  assert.ok(Math.abs(c.price - p.price - (100 - 100 * Math.exp(-0.04 * 30 / 365))) < 0.01); // put-call parity
  const exp = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const chain = []; for (let k = 80; k <= 120; k += 5) for (const type of ['call', 'put']) {
    const g = bs(100, k, 30 / 365, 0.3, type); chain.push({ symbol: `XYZ${k}${type[0]}`, root: 'XYZ', expiration: exp, type, strike: k, bid: g.price * 0.97, ask: g.price * 1.03, iv: 0.3, greeks: { delta: g.delta } });
  }
  const ic = buildTemplate('iron_condor', chain, 100, exp);
  assert.equal(ic.legs.length, 4); assert.ok(ic.payoff.netCredit > 0);
  assert.equal(typeof ic.payoff.maxLoss, 'number'); assert.ok(ic.payoff.maxLoss < 0 && ic.payoff.maxProfit > 0);
  assert.equal(ic.payoff.breakevens.length, 2);
  const longCall = payoff([{ kind: 'call', side: 'buy', qty: 1, strike: 100, premium: 3, iv: 0.3, expiration: exp }], { spot: 100 });
  assert.equal(longCall.maxProfit, 'unlimited'); assert.equal(longCall.maxLoss, -300);
  const csp = incomeCandidates({ expirations: [exp], contracts: chain }, 100, { strategy: 'cash_secured_put', dteMin: 10, dteMax: 60 })[0];
  assert.ok(csp.annualizedPct > 0 && csp.popPct > 50 && csp.legs[0].side === 'sell');
  assert.ok(incomeCandidates({ expirations: [exp], contracts: chain }, 100, { strategy: 'iron_condor', dteMin: 10, dteMax: 60 })[0].credit > 0);
});

test('news sentiment words, StockTwits share and the brief without AI', async () => {
  assert.ok(scoreText('Apple beats estimates, shares surge to a record') > 0.5);
  assert.ok(scoreText('Regulators open probe; stock plunges after guidance cut') < -0.5);
  assert.ok(scoreText('Company did not miss estimates') > 0);
  const c = srv.client(); await c.signup('news@example.com');
  const s = (await c('/news/sentiment?symbols=AAPL')).body;
  assert.equal(s.bySymbol[0].social.bullishPct, 67);
  const b = (await c('/news/brief', { symbols: 'AAPL' })).body;
  assert.equal(b.ai, false); assert.match(b.script, /market brief/);
});

test('halal screening, data feed, portfolio and zakat', async () => {
  assert.equal(screen('JPM').status, 'not_compliant'); assert.equal(screen('SPUS').status, 'compliant'); assert.equal(screen('ZZZZ').status, 'unknown');
  assert.equal(screen('MSFT', { status: '', debt_ratio: 12, cash_ratio: 35, receivables_ratio: 10, nonhalal_pct: 1 }).status, 'not_compliant'); // cash over 30%
  const admin = srv.client(); // first account in this database is the admin
  await admin('/auth/login', { email: 'owner@example.com', password: 'Str0ngPassword' });
  assert.equal((await admin('/halal/feed', { csv: 'symbol,status,debt,cash,recv,nonhalal,source,as_of\nAAPL,halal,2,25,15,0.5,TestFeed,2026-09-30\nMSFT,,10,20,20,1,TestFeed,2026-09-30' })).body.imported, 2);
  const u = srv.client(); await u.signup('halal@example.com');
  assert.equal((await u('/halal/feed', { csv: 'X' })).status, 403);
  const r = (await u('/halal/screen?symbols=AAPL,MSFT,BAC')).body.results;
  assert.deepEqual(r.map(x => x.status), ['compliant', 'compliant', 'not_compliant']);
  await u('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', notional: 3000 });
  await u('/orders', { account: 'paper', symbol: 'BAC', side: 'buy', notional: 1000 });
  const p = (await u('/halal/portfolio?account=paper')).body;
  assert.ok(Math.abs(p.compliantPct - 75) < 1 && Math.abs(p.notCompliantPct - 25) < 1);
  const z = zakat({ cash: 10000, holdings: 20000, holdingsMethod: 'longterm', zakatablePct: 30, goldPerGram: 100, debts: 1000 });
  assert.deepEqual([z.wealth, z.nisab, z.due, z.zakat], [15000, 8500, true, 375]);
  assert.equal(zakat({ cash: 1000, goldPerGram: 100 }).due, false);
  const zz = (await u('/halal/zakat', { includeAccounts: ['paper'], goldPerGram: 100 })).body;
  assert.ok(zz.due && zz.zakat > 2000);
});

test('13F holdings, changes and ticker mapping', async () => {
  const c = srv.client(); await c.signup('inst@example.com');
  const h = (await c('/institutions/0001067983')).body;
  assert.equal(h.period, '2026-06-30'); assert.equal(h.previousPeriod, '2026-03-31');
  const aapl = h.holdings.find(x => x.cusip === '037833100');
  assert.equal(aapl.ticker, 'AAPL'); assert.equal(aapl.value, 61e9); assert.equal(aapl.change, 'added');
  assert.equal(h.holdings.find(x => x.cusip === '060505104').change, 'reduced');
  assert.equal(h.holdings.find(x => x.cusip === '166764100').change, 'new');
  assert.equal(h.holdings.find(x => x.cusip === '166764100').ticker, 'CVX');
  assert.equal(h.soldOut[0].issuer, 'PARAMOUNT GLOBAL');
  assert.match(calls.find(x => x.url.includes('submissions')).headers['user-agent'], /^QuantPocket /);
});

test('spend-based investing: CSV, Plaid link and weekly buys', async () => {
  assert.equal(tickerFor('STARBUCKS STORE 123'), 'SBUX');
  assert.deepEqual(plan({ amount: 4.35, merchant: 'Starbucks' }, { mode: 'both', multiplier: 2, brandPct: 10, defaultSymbol: 'SPY' }), [{ ticker: 'SPY', invest: 1.3, kind: 'roundup' }, { ticker: 'SBUX', invest: 0.44, kind: 'brand' }]);
  const c = srv.client(); await c.signup('spend@example.com');
  await c('/roundups', { mode: 'both', multiplier: 1, brandPct: 10, defaultSymbol: 'SPY', account: 'paper', weeklyCap: 100, minBatch: 1 }, 'PUT');
  assert.equal((await c('/roundups/import', { csv: '2026-10-20,AMAZON MKTPLACE,23.40\n2026-10-21,Local diner,12.75\nnot a line' })).body.purchases, 2);
  assert.equal((await c('/roundups/plaid/link-token', {})).body.linkToken, 'link-sandbox-123');
  const ex = (await c('/roundups/plaid/exchange', { publicToken: 'public-sandbox' })).body;
  assert.equal(ex.linked, true); assert.ok(ex.added >= 3);
  const before_ = (await c('/roundups')).body; assert.ok(before_.pending > 10 && before_.linked);
  const inv = (await c('/roundups/invest', {})).body.orders;
  assert.ok(inv.find(o => o.ticker === 'AMZN' && /bought/.test(o.result)));
  assert.ok(inv.find(o => o.ticker === 'TGT' && /bought \$5\.21/.test(o.result)));
  const after_ = (await c('/roundups')).body; assert.equal(after_.invested, 9.95); // SBUX $0.44 waits until it reaches $1
  assert.equal(after_.pending, 0.44);
  assert.ok(calls.some(x => x.url === '/plaid/transactions/sync' && x.body.access_token === 'access-sandbox-abc'));
});

test('insights math, Schedule D and mark-to-market', async () => {
  const f = [{ id: 1, account: 'paper', symbol: 'A', side: 'buy', qty: 10, price: 10, at: 1, source: 'bot' }, { id: 2, account: 'paper', symbol: 'A', side: 'sell', qty: 4, price: 12, at: 2, source: 'web' }, { id: 3, account: 'paper', symbol: 'A', side: 'sell', qty: 6, price: 9, at: 3, source: 'web' }];
  const t = roundTrips(f); assert.deepEqual(t.map(x => x.pnl), [8, -6]); assert.equal(t[0].source, 'bot');
  const w = twr([{ day: '2026-01-01', equity: 100 }, { day: '2026-01-02', equity: 210 }, { day: '2026-01-03', equity: 220 }], [{ day: '2026-01-02', amount: 100 }]);
  assert.ok(Math.abs(w.total - ((110 / 100) * (220 / 210) - 1) * 100) < 0.01);
  const e = execution([{ symbol: 'A', side: 'buy', qty: 10, price: 10.1, expected_price: 10, source: 'scanner:1', at: 5000, signal_at: 2000 }]);
  assert.equal(e.bySource[0].avgSlipBps, 100); assert.equal(e.bySource[0].medianDelaySec, 3);

  const c = srv.client(); await c.signup('tax@example.com');
  await c('/orders', { account: 'paper', symbol: 'SPY', side: 'buy', qty: 10 });
  await c('/orders', { account: 'paper', symbol: 'SPY', side: 'sell', qty: 4 });
  const tx = (await c('/tax?account=paper')).body;
  assert.equal(tx.scheduleD.line1b_shortTerm.lots, 1); assert.equal(typeof tx.markToMarket.ordinaryIncome, 'number');
  const csv = await fetch(srv.base + '/api/tax?account=paper&format=scheduled');
  assert.equal(csv.status, 401); // needs a session; the page downloads it with the cookie
  const ins = (await c('/insights?account=paper')).body;
  assert.equal(ins.bySymbol[0].symbol, 'SPY'); assert.equal(ins.stats.trades, 1); assert.equal(ins.whatIf.length, 9);
  const j = (await c('/insights/journal?account=paper')).body;
  assert.equal((await c(`/insights/journal/${j.trips[0].exitFill}`, { note: 'took profit early', tags: 'swing, discipline' }, 'PUT')).status, 200);
  assert.equal((await c('/insights/journal?account=paper')).body.trips[0].tags, 'swing,discipline');
});

test('AI assistant tool loop with Claude (stand-in)', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.ANTHROPIC_BASE_URL = F + '/claude';
  try {
    const c = srv.client(); await c.signup('chat@example.com');
    const r = (await c('/ai/chat', { messages: [{ role: 'user', content: 'Analyze AAPL and give me a dip-buying strategy' }] })).body;
    assert.equal(r.reply, 'AAPL looks fine. tools=2 err=false');
    assert.deepEqual(r.tools, ['technical_snapshot', 'propose_strategy']);
    assert.equal(r.draft.entry, 'RSI(14) < 30');
    const sent = calls.filter(x => x.url.startsWith('/claude')).at(-1).body;
    assert.ok(sent.tools.some(t => t.type === 'web_search_20260209') && sent.tools.some(t => t.name === 'forecast'));
  } finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL; }
});
