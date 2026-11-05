// Batch 16: AI coding agents (GitHub mocked), live WebSocket streams (a local WebSocket server),
// market overview, portfolio & risk with pretend holdings, the screener's criteria, the README's
// generated overview, and no "guaranteed returns" style claims in public text.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

// A fake GitHub API.
const ghCalls = [];
const gh = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    ghCalls.push({ method: req.method, url: req.url, body: b ? JSON.parse(b) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/workflows/ai-agent.yml/runs')) return res.end(JSON.stringify({ workflow_runs: [{ id: 11, name: 'AI coding agent', display_title: 'Fix the chart', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: 'abcdef123', html_url: 'https://github.example/run/11', created_at: '2026-11-03T10:00:00Z' }] }));
    if (req.url.includes('/workflows/web-ci.yml/runs')) return res.end(JSON.stringify({ workflow_runs: [{ id: 22, name: 'CI', status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: '1234567', created_at: '2026-11-03T09:00:00Z' }] }));
    if (req.url.includes('/workflows/e2e.yml/runs')) return res.end(JSON.stringify({ workflow_runs: [] }));
    if (req.url.startsWith('/repos/o/r/pulls')) return res.end(JSON.stringify([{ number: 5, title: 'AI agent: fix', html_url: 'u', head: { ref: 'ai-agent/99' } }, { number: 6, title: 'Human PR', head: { ref: 'feature' } }]));
    if (req.url.includes('/actions/runs/22/jobs')) return res.end(JSON.stringify({ jobs: [{ id: 7, name: 'test', conclusion: 'failure', steps: [{ name: 'npm test', conclusion: 'failure' }] }] }));
    if (req.url.includes('/actions/jobs/7/logs')) { res.setHeader('Content-Type', 'text/plain'); return res.end('2026-11-03T09:00:01.000Z line one\n##[group]x\nnot ok 3 - something broke\n'); }
    if (req.url.includes('/dispatches')) { res.statusCode = 204; return res.end(); }
    if (req.url.includes('/rerun')) { res.statusCode = 201; return res.end('{}'); }
    res.statusCode = 404; res.end('{"message":"Not Found"}');
  });
});
await new Promise(r => gh.listen(0, '127.0.0.1', r));
// A fake Finnhub stream.
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise(r => wss.on('listening', r));
const wsGot = [];
wss.on('connection', (ws, req) => { wsGot.push({ url: req.url }); ws.on('message', m => { const x = JSON.parse(String(m)); wsGot.push(x); if (x.type === 'subscribe') ws.send(JSON.stringify({ type: 'trade', data: [{ s: x.symbol, p: 123.45, t: Date.now(), v: 10 }] })); }); });
Object.assign(process.env, { GITHUB_TOKEN: 'ghtest', GITHUB_REPO: 'o/r', GITHUB_API_URL: `http://127.0.0.1:${gh.address().port}`, FINNHUB_API_KEY: 'fk', FINNHUB_WS_URL: `ws://127.0.0.1:${wss.address().port}` });

const { app } = await import('../server.js');
let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const owner = client(), user = client();
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await owner('/auth/register', { email: 'owner@example.com', password: 'Str0ngPassword1', agree: true });
  await user('/auth/register', { email: 'b16-user@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); gh.close(); wss.close(); });

test('AI coding agents: overview, starting a task, failed-run log, re-run; admins only', async () => {
  assert.equal((await user('/admin/agents')).status, 403);
  const o = (await owner('/admin/agents')).body;
  assert.equal(o.configured, true);
  assert.equal(o.agentRuns[0].title, 'Fix the chart');
  assert.equal(o.ci[0].conclusion, 'failure');
  assert.deepEqual(o.pulls.map(p => p.number), [5]); // only the agent's own pull requests
  const t = await owner('/admin/agents/task', { task: 'Make the chart legend readable on phones', kind: 'write' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const d = ghCalls.find(c => c.url.includes('/actions/workflows/ai-agent.yml/dispatches'));
  assert.equal(d.body.ref, 'main'); assert.equal(d.body.inputs.kind, 'write'); assert.match(d.body.inputs.task, /legend/);
  assert.equal((await owner('/admin/agents/task', { task: 'x', kind: 'write' })).status, 400); // too short to act on
  assert.equal((await owner('/admin/agents/task', { task: 'Something reasonable to do here', kind: 'nuke' })).status, 400);
  const log = (await owner('/admin/agents/runs/22/log')).body;
  assert.match(JSON.stringify(log), /something broke/);
  assert.doesNotMatch(JSON.stringify(log), /##\[group\]/);
  assert.equal((await owner('/admin/agents/runs/abc/log')).status, 400);
  assert.equal((await owner('/admin/agents/runs/22/rerun', {})).status, 200);
});

test('a WebSocket provider streams trades into the hub', async () => {
  const { hub } = await import('../src/streams.js');
  const got = [];
  hub.configure({ sink: u => got.push(u), want: () => new Set(['AAPL']), alpacaReady: () => false });
  hub.restart();
  for (let i = 0; i < 50 && !got.length; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(wsGot.some(x => x.type === 'subscribe' && x.symbol === 'AAPL'));
  assert.equal(got[0].symbol, 'AAPL'); assert.equal(got[0].price, 123.45); assert.equal(got[0].source, 'Finnhub');
  const st = (await owner('/admin/streams')).body;
  assert.equal(st.connected, true); assert.equal(st.active, 'finnhub');
  assert.equal((await owner('/admin/streams', { provider: 'nope' }, 'PUT')).status, 400);
  assert.equal((await owner('/admin/streams', { provider: 'off' }, 'PUT')).status, 200);
  assert.equal(hub.provider(), null);
  assert.equal((await user('/admin/streams')).status, 403);
});

test('price labels say real-time, delayed or closed', async () => {
  const DS = await import('../src/datasources.js');
  assert.equal(DS.freshness('yahoo').level, 'delayed');
  assert.equal(DS.freshness('finnhub').level, 'realtime');
  assert.equal(DS.freshness('yahoo', false).level, 'closed');
  assert.equal(DS.freshness('alpaca').level, 'realtime-iex');
});

test('market overview: session, indexes, sectors, labels and the watchlist', async () => {
  const d = (await user('/market/overview')).body;
  assert.ok(d.session && 'open' in d.session);
  assert.equal(d.indexes[0].symbol, 'SPY'); assert.equal(d.sectors.length, 11);
  assert.ok(d.labels.delayed);
  assert.deepEqual(d.watch.map(w => w.symbol), ['AAPL', 'MSFT', 'NVDA']);
  assert.equal((await user('/market/overview/watch', { symbols: ['TSLA', 'BTC/USD', 'tsla'] }, 'PUT')).status, 200);
  assert.deepEqual((await user('/market/overview')).body.watch.map(w => w.symbol), ['TSLA', 'BTC/USD']);
  assert.equal((await user('/market/overview/watch', { symbols: ['NOT A SYMBOL!'] }, 'PUT')).status, 400);
});

test('portfolio & risk: pretend holdings, concentration, scenarios', async () => {
  const empty = (await user('/portfolio-risk?account=paper')).body;
  assert.equal(empty.holdings.length, 0);
  const r = await user('/portfolio-risk?account=paper&add=SPY:5000,TQQQ:3000');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.deepEqual(d.holdings.map(h => h.symbol).sort(), ['SPY', 'TQQQ']);
  assert.ok(d.holdings.every(h => h.pretend));
  assert.equal(d.equity, 100000); assert.equal(d.cash, 92000);
  assert.ok(d.byKind.find(k => k.name === 'Leveraged funds'));
  assert.ok(d.concentration.warnings.some(w => /leveraged/.test(w)));
  assert.equal(d.scenarios.length, 5); assert.ok(d.scenarios.every(s => s.loss <= 0 && s.after <= d.equity));
  assert.equal((await user('/portfolio-risk?add=SPY:-5')).status, 400);
  assert.equal((await user('/portfolio-risk?add=$$$:100')).status, 400);
  assert.equal((await user('/portfolio-risk?account=nope')).status, 400);
  const { concentration } = await import('../src/portfoliorisk.js');
  const c = concentration([{ symbol: 'A', value: 80 }, { symbol: 'B', value: 10 }, { symbol: 'C', value: 10 }], 100);
  assert.equal(c.top.symbol, 'A'); assert.ok(c.actsLike < 2); assert.match(c.warnings[0], /A is 80%/);
});

test('screener criteria filter by range and sector', async () => {
  const { applyCriteria } = await import('../src/plainresearch.js');
  const rows = [{ symbol: 'A', marketCap: 300e9, pe: 12, sector: 'Technology' }, { symbol: 'B', marketCap: 5e9, pe: 40, sector: 'Energy' }, { symbol: 'C', marketCap: 50e9, pe: null, sector: 'Technology' }];
  assert.deepEqual(applyCriteria(rows, { marketCap: [100, null] }).map(r => r.symbol), ['A']);
  assert.deepEqual(applyCriteria(rows, { pe: [null, 20] }).map(r => r.symbol), ['A']); // no P/E means it can't pass a P/E filter
  assert.deepEqual(applyCriteria(rows, {}, ['Technology']).map(r => r.symbol), ['A', 'C']);
  const s = await user('/plain-research/screen');
  assert.equal(s.status, 200); assert.ok(Array.isArray(s.body.criteria) && s.body.criteria.length >= 5);
  assert.equal((await user('/plain-research/filing/$$$')).status, 400);
  const n = (await user('/plain-research/news/AAPL')).body;
  assert.ok(Array.isArray(n.items));
  for (const i of n.items) { assert.ok(i.url && i.at && i.source !== undefined); }
});

test('the private README starts with a full, generated product overview', async () => {
  const { overviewMd, literal } = await import('../src/readme-overview.js');
  const { mergeSections } = await import('../src/readme-auto.js');
  const md = await overviewMd();
  for (const s of ['Portfolio & risk', 'Plain-language research', 'Tokenized securities', 'Investor protection', 'AI coding agents', 'Ultimate', 'Finnhub', 'ai-agent.yml']) assert.ok(md.includes(s), s);
  assert.doesNotMatch(md, /sk-|ghp_|BEGIN PRIVATE/); // names of keys only
  const once = mergeSections('# Guide\n\nHello\n', md);
  assert.match(once, /^# Guide\n\n<!-- auto:overview -->\n## Product overview/);
  const twice = mergeSections(once, md.replace('Tokenized', 'Tokenised'));
  assert.equal(twice.split('<!-- auto:overview -->').length, 2); // replaced, not added again
  assert.ok(twice.includes('Tokenised securities')); assert.ok(twice.includes('Hello'));
  assert.deepEqual(literal("const X = [['a', 'b ] c'], ['d', `e`]];", 'X'), [['a', 'b ] c'], ['d', 'e']]);
});

test('public text never claims guaranteed or risk-free returns', () => {
  const files = [...fs.readdirSync('public').filter(f => /\.(html|js)$/.test(f)).map(f => 'public/' + f), ...fs.readdirSync('public/pages').map(f => 'public/pages/' + f), 'scripts/pages.py', 'scripts/home.py'];
  // Quoted phrases are warnings about such claims ("Guaranteed" returns are a red flag), not claims.
  const strip = t => t.replace(/“[^”]{0,60}”/g, '').replace(/"[^"\n]{0,40}"/g, '');
  const bad = [/\bguaranteed? (returns?|profits?|income|gains?|winners?)\b/i, /\brisk[- ]free (returns?|profits?|trading|income|gains?)\b/i, /\b(can(no|')?t|never|won'?t) lose\b/i, /\b(we|brightfolio|our (ai|bots?|strategies)) (guarantees?|promises?) /i, /\bget rich quick\b/i];
  const hits = [];
  for (const f of files) {
    const t = strip(fs.readFileSync(f, 'utf8'));
    for (const re of bad) { const m = re.exec(t); if (m) { const i = m.index; const ctx = t.slice(Math.max(0, i - 50), i + 40); if (!/\b(no|not|never|nobody|no one|can't|cannot|claims?|promises? of|warn|fraud|scam)\b/i.test(ctx)) hits.push(`${f}: …${ctx}…`); } }
  }
  assert.deepEqual(hits, []);
  const risk = fs.readFileSync('public/risk.html', 'utf8');
  assert.match(risk, /No one can guarantee returns, including AI/);
  assert.match(risk, /brokercheck\.finra\.org/); assert.match(risk, /adviserinfo\.sec\.gov/);
  assert.match(fs.readFileSync('public/privacy.html', 'utf8'), /do not sell your personal information/);
});
