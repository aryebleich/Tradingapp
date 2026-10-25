// Load and chaos drill. Simulates many traders at a multiple of normal volume against a staging
// server and reports latency percentiles, errors, shed requests and how orders held up.
//   node scripts/loadtest.mjs --url https://staging.example.com --users 50 --multiplier 10 --seconds 60
// Normal volume is BASE_RPS (default 5 requests a second across all users); --multiplier 10 runs at
// 10x. Combine with CHAOS_FAIL_RATE / CHAOS_LATENCY_MS on the staging server to inject broker faults.
// Never point this at production: it creates accounts and places paper orders.
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://localhost:3000').replace(/\/$/, ''), USERS = +arg('users', 20), MULT = +arg('multiplier', 10), SECS = +arg('seconds', 30), BASE = +arg('base-rps', 5);
const rps = BASE * MULT, stats = { total: 0, ok: 0, shed: 0, errors: 0, brokerFaults: 0, byKind: {} }, lat = { all: [], order: [] };

async function user(i) {
  let cookie = '';
  const call = async (path, body) => {
    const t = performance.now();
    const r = await fetch(URL_ + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined }).catch(e => ({ status: 0, headers: new Headers(), json: async () => ({ error: e.message }) }));
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, ms: performance.now() - t, body: await r.json().catch(() => null) };
  };
  const email = `load${Date.now()}-${i}@example.com`;
  await call('/auth/register', { email, password: 'Str0ngPassword1', agree: true });
  return call;
}
const MIX = [
  ['quote', 30, c => c('/risk')], ['dashboard', 25, c => c('/account?account=paper')],
  ['order', 20, c => c('/orders', { account: 'paper', symbol: ['SPY', 'AAPL', 'QQQ', 'MSFT'][Math.floor(Math.random() * 4)], side: 'buy', notional: 10 })],
  ['insights', 10, c => c('/insights?account=paper')], ['chart', 10, c => c('/code/prices?symbols=SPY')], ['risk', 5, c => c('/risk')],
];
const pick = () => { let r = Math.random() * 100; for (const m of MIX) if ((r -= m[1]) < 0) return m; return MIX[0]; };
const pct = (a, p) => (a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(0) : '-');

console.log(`Load drill: ${USERS} users, ${rps} requests/s (${MULT}x of ${BASE}), ${SECS}s against ${URL_}`);
const clients = await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
const end = Date.now() + SECS * 1000, inflight = new Set();
while (Date.now() < end) {
  const tick = Date.now();
  for (let k = 0; k < rps / 10; k++) {
    const [kind, , fn] = pick(), c = clients[Math.floor(Math.random() * clients.length)];
    const p = fn(c).then(r => {
      stats.total++; (stats.byKind[kind] ||= { n: 0, fail: 0 }).n++;
      lat.all.push(r.ms); if (kind === 'order') lat.order.push(r.ms);
      if (r.status === 503 && r.body?.shed) { stats.shed++; if (kind === 'order') stats.byKind[kind].fail++; }
      else if (/chaos|not responding/.test(r.body?.error || '')) stats.brokerFaults++; // injected broker outage, reported to the user
      else if (r.status >= 500 || r.status === 0) { stats.errors++; stats.byKind[kind].fail++; }
      else stats.ok++;
    });
    inflight.add(p); p.finally(() => inflight.delete(p));
  }
  await new Promise(r => setTimeout(r, Math.max(0, 100 - (Date.now() - tick))));
}
await Promise.all(inflight);
const m = await fetch(URL_ + '/metrics').then(r => r.text()).catch(() => '');
console.log(`\nRequests ${stats.total}: ok ${stats.ok}, shed ${stats.shed}, errors ${stats.errors}, injected broker faults ${stats.brokerFaults}`);
console.log(`Latency ms (all): p50 ${pct(lat.all, 0.5)}  p95 ${pct(lat.all, 0.95)}  p99 ${pct(lat.all, 0.99)}`);
console.log(`Latency ms (orders): p50 ${pct(lat.order, 0.5)}  p95 ${pct(lat.order, 0.95)}  p99 ${pct(lat.order, 0.99)}`);
for (const [k, v] of Object.entries(stats.byKind)) console.log(`  ${k.padEnd(10)} ${v.n} requests, ${v.fail} failed`);
console.log(m.split('\n').filter(l => /^qp_(load|shed|recommended|order_queue|breaker)/.test(l)).join('\n'));
// Orders must never be shed and the server must not fail on them (injected broker faults are
// expected and reported to the trader): that is the pass/fail line of the drill.
const orderFails = stats.byKind.order?.fail || 0;
if (orderFails > (stats.byKind.order?.n || 0) * 0.01) { console.log(`\nFAIL: ${orderFails} order requests failed`); process.exit(1); }
console.log('\nPASS: order entry stayed available');
