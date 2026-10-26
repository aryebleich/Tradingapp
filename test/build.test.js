// Scanner, rule-based portfolios, signal fleet and marketplace.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';
const { detect } = await import('../public/patterns.js');
const { runScanners } = await import('../src/scanner.js');
const { rebalance } = await import('../src/baskets.js');
const { one, all, run } = await import('../src/db.js');

let srv; before(async () => { srv = await serve(); }); after(() => srv.close());
const FRI = Date.parse('2026-10-23T15:00:00Z'); // a Friday, 11:00 New York

test('candlestick patterns', () => {
  const down = [{ o: 110, h: 111, l: 105, c: 106 }, { o: 106, h: 107, l: 101, c: 102 }, { o: 102, h: 103, l: 97, c: 98 }, { o: 98, h: 99, l: 93, c: 94 }, { o: 94, h: 95, l: 89, c: 90 }, { o: 90, h: 91, l: 86, c: 87 }];
  const hammer = [...down, { o: 86, h: 86.6, l: 80, c: 86.4 }];
  assert.ok(detect(hammer).some(p => p.name === 'hammer' && p.i === 6));
  const engulf = [...down, { o: 85, h: 92, l: 84.5, c: 91.5 }];
  assert.ok(detect(engulf).some(p => p.name === 'bull_engulfing' && p.bias === 'bull'));
  assert.ok(detect([...down, { o: 87, h: 89, l: 85, c: 87.05 }]).some(p => p.name === 'doji'));
});

test('scanner: preview, saved scanner buys once per day', async () => {
  const c = srv.client(); await c.signup('scan@example.com');
  const all1 = (await c('/scanners/run', { universe: 'SPY,QQQ,AAPL', rules: '' })).body;
  assert.equal(all1.length, 3); assert.ok(all1.every(r => r.match && r.price > 0));
  assert.match((await c('/scanners/run', { universe: 'SPY', rules: 'RSI(14) < < 5' })).body.error, /Bad (rule|operand)/);
  const id = (await c('/scanners', { name: 'Everything', universe: 'SPY,QQQ', rules: 'Close > 0', action: 'buy', account: 'paper', notional: 100, everyMin: 60 })).body.id;
  assert.ok(id);
  await runScanners(FRI);
  const r = (await c('/scanners')).body;
  assert.equal(r.hits.length, 2); assert.ok(r.hits.every(h => h.result === 'bought $100'));
  await run('UPDATE scanners SET last_run_at = 0 WHERE id = ?', id);
  await runScanners(FRI + 3600e3);
  assert.equal((await c('/scanners')).body.hits.length, 2); // not again the same day
});

test('rule-based portfolio: backtest, deploy, rebalance, share and follow', async () => {
  const c = srv.client(); await c.signup('bask@example.com');
  const spec = { universe: 'SPY,QQQ,IWM,TLT,GLD', filters: 'Close > SMA(200)', rankBy: 'momentum6m', topN: 2, weighting: 'invvol', rebalance: 'monthly' };
  const bt = (await c('/baskets/backtest', { ...spec, years: 4 })).body;
  assert.ok(bt.stats.cagr != null && bt.curve.length > 50, JSON.stringify(bt).slice(0, 200));
  assert.ok(Object.keys(bt.today).length <= 2);
  const id = (await c('/baskets', { ...spec, name: 'Trend top 2', public: true })).body.id;
  assert.equal((await c(`/baskets/${id}/deploy`, { account: 'paper', amount: 5000, contribution: 200 })).status, 200);
  const r = (await c(`/baskets/${id}/rebalance`, {})).body;
  const held = Object.keys(r.holdings);
  assert.ok(held.length >= 1 && held.length <= 2, JSON.stringify(r));
  const f = srv.client(); await f.signup('follower@example.com');
  assert.ok((await f('/baskets/community')).body.find(b => b.id === id));
  const fid = (await f(`/baskets/${id}/follow`, {})).body.id;
  await c(`/baskets/${id}`, { ...spec, topN: 3, name: 'Trend top 3', public: true }, 'PUT');
  assert.equal((await f('/baskets')).body.find(b => b.id === fid).spec.topN, 3); // follower got the update
});

test('signal fleet: auto and review followers, channel webhook; marketplace', async () => {
  const lead = srv.client(); await lead.signup('lead@example.com');
  const ch = (await lead('/fleet/channels', { name: 'Swing ideas', description: 'Daily swing trades' })).body;
  const a = srv.client(); await a.signup('auto@example.com');
  const b = srv.client(); await b.signup('review@example.com');
  assert.equal((await a(`/fleet/channels/${ch.id}/subscribe`, { account: 'paper', sizing: 'fixed', amount: 250, mode: 'auto' })).status, 200);
  assert.equal((await b(`/fleet/channels/${ch.id}/subscribe`, { account: 'paper', mode: 'review' })).status, 200);
  assert.equal((await a(`/fleet/channels/${ch.id}/subscribe`, { account: 'alpaca' })).status, 402); // real accounts need Pro
  const sent = (await lead(`/fleet/channels/${ch.id}/signals`, { symbol: 'AAPL', side: 'buy' })).body;
  assert.equal(sent.delivered, 2);
  assert.match((await a('/fleet')).body.inbox[0].result, /bought \$250\.00 AAPL/);
  const inbox = (await b('/fleet')).body.inbox; assert.equal(inbox[0].status, 'pending');
  assert.match((await b(`/fleet/inbox/${inbox[0].id}`, { approve: true })).body.result, /bought \$100\.00 AAPL/);
  // The channel's own webhook (e.g. TradingView) broadcasts too.
  const hook = await fetch(srv.base + ch.webhookPath, { method: 'POST', body: '{"ticker":"NASDAQ:AAPL","action":"exit"}' });
  assert.equal((await hook.json()).delivered, 2);
  assert.match((await a('/fleet')).body.inbox[0].result, /sold .* AAPL/);
  // Marketplace lists the channel, and published strategies can be copied.
  const sid = (await lead('/strategies', { name: 'Cross', symbol: 'SPY', entry: 'SMA(20) crosses_above SMA(100)', exit: 'SMA(20) crosses_below SMA(100)' })).body.id;
  assert.equal((await lead(`/market/strategies/${sid}/publish`, { description: 'Classic crossover' })).status, 200);
  const m = (await a('/market')).body;
  assert.ok(m.channels.find(x => x.id === ch.id && x.followers === 2));
  const st = m.strategies.find(x => x.id === sid); assert.ok(st.stats.trades >= 0);
  const copy = (await a(`/market/strategies/${sid}/copy`, {})).body.id;
  assert.equal((await a('/strategies')).body.find(x => x.id === copy).entry, 'SMA(20) crosses_above SMA(100)');
});

test('every GitHub workflow is valid YAML', async () => {
  const fs = await import('node:fs');
  // No YAML parser in the dependencies: catch the usual mistake, ${{ }} inside a { } flow mapping.
  for (const f of fs.readdirSync('.github/workflows')) {
    const text = fs.readFileSync('.github/workflows/' + f, 'utf8');
    for (const [i, line] of text.split('\n').entries()) if (/:\s*\{[^}]*\$\{\{/.test(line)) assert.fail(`${f}:${i + 1} has \${{ }} inside a { } mapping; use block style`);
  }
});
