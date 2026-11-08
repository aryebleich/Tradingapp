// Batch 21: sponsored news (listed companies only, free plan only, disclosure), practice short
// selling with no minimum, technical analysis and earnings scores, new leaders, the margin rules,
// AI long/short books.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { technicals, rsi, earningsScore, leaders, callPrice, shortPaths, fundRows } from '../src/invest.js';
import { buildBook, tradesFor, targets } from '../src/aifunds.js';

// A fake SEC: two companies on exchanges, one over the counter.
const sec = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.endsWith('/files/company_tickers_exchange.json')) return res.end(JSON.stringify({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, 'Acme Corp', 'ACME', 'Nasdaq'], [2, 'Big Bank Inc', 'BANK', 'NYSE'], [3, 'Tiny Pink Co', 'PINK', 'OTC']] }));
  res.statusCode = 404; res.end('{}');
});
await new Promise(r => sec.listen(0, r));
process.env.SEC_WWW_URL = `http://127.0.0.1:${sec.address().port}`;

const { app } = await import('../server.js');
const { run } = await import('../src/db.js');
let server, base;
const jar = {};
const call = async (who, path, body, method) => {
  const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) jar[who] = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await call('owner', '/auth/register', { email: 'b21-owner@example.com', password: 'Str0ngPassword1', agree: true });
  await call('user', '/auth/register', { email: 'b21-user@example.com', password: 'Str0ngPassword1', agree: true });
  await run("UPDATE users SET role = 'admin' WHERE email = 'b21-owner@example.com'");
  await run("UPDATE users SET role = 'user' WHERE email = 'b21-user@example.com'");
});
after(() => { server.close(); sec.close(); });

test('sponsored news: listed companies only, disclosure required, free plan only, daily cap', async () => {
  assert.equal((await call('user', '/sponsored/admin')).status, 403);
  const base0 = { headline: 'Acme reports a record quarter', sponsor: 'Acme Corp', paid: 2500, starts: '2020-01-01' };
  assert.match((await call('owner', '/sponsored/admin', { ...base0, symbol: 'PINK' })).body.error, /not a company listed/);
  assert.match((await call('owner', '/sponsored/admin', { ...base0, symbol: 'ACME', paid: 0 })).body.error, /How much was paid/);
  const ok = await call('owner', '/sponsored/admin', { ...base0, symbol: 'ACME' });
  assert.equal(ok.status, 200); assert.equal(ok.body.exchange, 'Nasdaq');
  await call('owner', '/sponsored/admin/settings', { on: true, perDay: 2, gapMinutes: 1 }, 'PUT');
  const a = (await call('user', '/sponsored/next')).body.ad;
  assert.equal(a.symbol, 'ACME'); assert.match(a.disclosure, /Paid promotion: Brightolio received \$2,500 from Acme Corp/);
  assert.equal((await call('user', '/sponsored/next')).body.ad, null, 'minutes between pop-ups');
  await run("UPDATE sponsored_views SET last_at = 0");
  assert.ok((await call('user', '/sponsored/next')).body.ad);
  await run("UPDATE sponsored_views SET last_at = 0");
  assert.equal((await call('user', '/sponsored/next')).body.ad, null, 'at most 2 a day');
  // A paid plan never sees them.
  await run("UPDATE sponsored_views SET n = 0, last_at = 0");
  await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE email = 'b21-user@example.com'");
  assert.equal((await call('user', '/sponsored/next')).body.ad, null);
  await run("UPDATE users SET plan = 'free', plan_status = NULL WHERE email = 'b21-user@example.com'");
  assert.equal((await call('user', '/sponsored/' + ok.body.id + '/click', {})).status, 200);
  assert.equal((await call('owner', '/sponsored/admin')).body.ads[0].clicks, 1);
});

test('practice short selling: no minimum, needs the box ticked, 50% equity rule, covers at the right price', async () => {
  await call('user', '/account?account=paper');
  assert.equal((await call('user', '/orders', { symbol: 'AAPL', side: 'sell', qty: 2, account: 'paper' })).status, 409);
  const s = await call('user', '/orders', { symbol: 'AAPL', side: 'sell', qty: 2, account: 'paper', allowShort: true });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  let pos = (await call('user', '/account?account=paper')).body.positions.find(p => p.symbol === 'AAPL');
  assert.equal(pos.qty, -2); assert.ok(Math.abs(pos.avgPrice - s.body.price) < 1e-6);
  // Far beyond half the equity: refused.
  assert.match((await call('user', '/orders', { symbol: 'AAPL', side: 'sell', notional: 250000, account: 'paper', allowShort: true })).body.error, /Not enough equity to short/);
  assert.equal((await call('user', '/orders', { symbol: 'AAPL', side: 'buy', qty: 2, account: 'paper' })).status, 200);
  pos = (await call('user', '/account?account=paper')).body.positions.find(p => p.symbol === 'AAPL');
  assert.ok(!pos || pos.qty === 0);
  // "Close all positions" buys a short back.
  await call('user', '/orders', { symbol: 'MSFT', side: 'sell', qty: 1, account: 'paper', allowShort: true });
  const ca = await call('user', '/positions/close-all', { account: 'paper', confirmWord: 'CLOSE' });
  assert.equal(ca.status, 200, JSON.stringify(ca.body)); assert.ok(ca.body.results.some(r => r.symbol === 'MSFT' && r.ok));
  assert.ok(!(await call('user', '/account?account=paper')).body.positions.some(p => p.symbol === 'MSFT' && p.qty));
  const sp = (await call('user', '/invest/short?account=paper')).body;
  assert.equal(sp.paths.find(p => p.id === 'short').available, true);
  assert.equal(shortPaths({ account: 'alpaca', equity: 1500 }).find(p => p.id === 'short').available, false);
  assert.equal(shortPaths({ account: 'alpaca', equity: 1500 }).find(p => p.id === 'inverse').available, true);
});

test('technical analysis, RSI, earnings scores and margin-call price', () => {
  const up = Array.from({ length: 300 }, (_, i) => 100 + i);
  const t = technicals(up);
  assert.equal(t.trend, 'Uptrend'); assert.equal(t.rsi14, 100); assert.equal(t.rangePos, 100); assert.ok(t.sma50 > t.sma200);
  assert.equal(rsi([1, 2, 3], 14), null);
  const e = earningsScore([{ eps: 1.2, estimate: 1, surprisePct: 20 }, { eps: 0.9, estimate: 1, surprisePct: -10 }, { eps: 1, estimate: 1, surprisePct: 0 }]);
  assert.deepEqual([e.beats, e.misses, e.inLine, e.avgSurprisePct], [1, 1, 1, 3.3]);
  // $5,000 borrowed against 100 shares at a 30% requirement: a call near $71.43.
  assert.equal(callPrice(5000, 100, 0.3), 71.43);
  assert.ok(fundRows().every(f => f.cost > 0 && f.cost < 1 && f.per10k === +(f.cost * 100).toFixed(2)));
});

test('new leaders: strength that just moved into the top fifth near a high', () => {
  const mk = f => Array.from({ length: 320 }, (_, i) => f(i));
  const series = {
    NEW: mk(i => (i < 250 ? 100 - i * 0.05 : 87.5 + (i - 250) * 1.2)), // weak for a year, then a strong run to new highs
    OLD: mk(i => 50 + i * 0.5), // strong all along
    DOWN: mk(i => 300 - i * 0.5),
    ...Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`M${k}`, mk(i => 100 + Math.sin(i / (10 + k)) * 5 + k)])),
  };
  const rows = leaders(series), by = Object.fromEntries(rows.map(r => [r.symbol, r]));
  assert.equal(by.NEW.leader, true); assert.equal(by.NEW.isNew, true); assert.ok(by.NEW.newHigh);
  assert.equal(by.OLD.leader, true); assert.equal(by.OLD.isNew, false);
  assert.equal(by.DOWN.leader, false);
  assert.equal(rows[0].symbol, 'NEW');
});

test('AI team: the best model per role, learning from grades, a plan run by the agents', async () => {
  const { assign, score, parsePlan, gradeOf, runJob, learn } = await import('../src/aiteam.js');
  // With Claude and Groq keys, Claude leads coding and Yiddish; a pin wins while its key exists.
  let t = assign(['anthropic', 'groq'], {}, {});
  assert.equal(t.write.provider, 'anthropic'); assert.equal(t.yiddish.provider, 'anthropic');
  assert.equal(assign(['anthropic', 'groq'], {}, { ideas: 'groq' }).ideas.provider, 'groq');
  assert.equal(assign(['gemini'], {}, { ideas: 'groq' }).ideas.provider, 'gemini');
  // Results move the score: many bad grades for one model hand the role to the other.
  const st = { anthropic: { write: { n: 20, sum: 0 } } };
  assert.ok(score('anthropic', 'write', st) < score('groq', 'write', st));
  assert.equal(assign(['anthropic', 'groq'], st, {}).write.provider, 'groq');
  assert.deepEqual(parsePlan('Here: [{"role":"write","task":"add it"},{"role":"review","task":"check"},{"role":"bogus","task":"x"}]').map(s => s.role), ['write', 'review']);
  assert.equal(gradeOf('Looks fine.\nGRADE: 4'), 4);
  // A whole job with a fake model: plan, write, review (grade 5 trains "write"), final answer.
  process.env.GROQ_API_KEY = 'test';
  const calls = [];
  const fake = async (provider, { system, user }) => {
    calls.push({ provider, system: system.slice(0, 30), sawEarlier: user.includes('--- Writes code') });
    if (user.includes('Reply with a JSON array')) return '[{"role":"write","task":"Write the function"},{"role":"review","task":"Review it"}]';
    if (system.startsWith('You review')) return 'No bugs.\nGRADE: 5';
    if (user.includes('Write the final answer')) return 'Done: here is the function.';
    return 'function add(a, b) { return a + b; }';
  };
  const { run, one } = await import('../src/db.js');
  const id = Number((await run("INSERT INTO ai_team_jobs (job, status, plan, messages, created_at, updated_at) VALUES ('Add an add() helper', 'working', '[]', '[]', 0, 0)")).lastInsertRowid);
  await runJob(id, fake);
  const j = await one('SELECT * FROM ai_team_jobs WHERE id = ?', id), msgs = JSON.parse(j.messages);
  assert.equal(j.status, 'done'); assert.equal(j.result, 'Done: here is the function.');
  assert.deepEqual(msgs.map(m => m.role), ['manager', 'write', 'review', 'manager']);
  assert.ok(calls[2].sawEarlier, 'the reviewer sees what the writer wrote');
  const { siteGet } = await import('../src/site.js');
  assert.equal(siteGet('aiTeamStats', {}).groq.write.n, 1);
  await learn('groq', 'ideas', 1);
  delete process.env.GROQ_API_KEY;
});

test('AI long/short book: longs and shorts, an inverse-fund hedge when the account cannot short, and the trades', () => {
  const mk = f => Array.from({ length: 300 }, (_, i) => f(i));
  const series = { A: mk(i => 50 + i), B: mk(i => 60 + i * 0.8), C: mk(i => 300 - i * 0.6), D: mk(i => 250 - i * 0.5), E: mk(i => 100 + Math.sin(i / 9)) };
  const book = buildBook('neutral', 3, series, { canShort: true, names: 2 });
  assert.ok(book.some(b => b.weight > 0) && book.some(b => b.weight < 0));
  assert.ok(Math.abs(book.filter(b => b.weight > 0).reduce((s, b) => s + b.weight, 0) - 0.9) < 1e-3);
  const hedged = buildBook('neutral', 3, series, { canShort: false, names: 2 });
  assert.ok(hedged.every(b => b.weight > 0)); assert.ok(hedged.some(b => b.symbol === 'SH'));
  const tgt = targets([{ symbol: 'A', weight: 0.5 }, { symbol: 'C', weight: -0.25 }], 10000, { A: 100, C: 50 });
  assert.deepEqual(tgt, { A: 50, C: -50 });
  const tr = tradesFor({ A: 20, Z: 5 }, tgt);
  assert.deepEqual(tr.map(t => `${t.side} ${t.qty} ${t.symbol}${t.short ? ' short' : ''}`), ['sell 5 Z', 'sell 50 C short', 'buy 30 A']);
});
