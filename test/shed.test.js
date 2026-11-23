// Load shedding never turns pages away: only API calls can be refused, and only after the load
// stayed high for a few seconds. The heap limit is V8's real one. A refused call is retried quietly
// by the front end. (src/reliability.js, public/shed-retry.js)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { serve } from './client.js';
const R = await import('../src/reliability.js');
const { withShedRetry, SHED_TEXT } = await import('../public/shed-retry.js');

let srv; before(async () => { srv = await serve(); }); after(() => { R.forceLoad(null); srv.close(); });

test('classify: pages, the app shell and static files are critical; only API calls can be shed', () => {
  for (const p of ['/', '/app', '/app.html', '/app.js', '/pages/trading.js', '/styles.css', '/layout.css', '/icon-512.png', '/hero-brightolio.webp', '/fonts/inter.woff2', '/manifest.webmanifest', '/sw.js', '/auth/google', '/terms'])
    assert.equal(R.classify(p), 'critical', p);
  assert.equal(R.classify('/api/insights'), 'optional'); assert.equal(R.classify('/api/news'), 'optional');
  assert.equal(R.classify('/api/orders'), 'critical'); assert.equal(R.classify('/api/auth/me'), 'critical'); assert.equal(R.classify('/api/risk'), 'critical');
  assert.equal(R.classify('/api/watchlist'), 'normal');
});

test('at a load of 0.99 pages still load; optional API calls get 503 with Retry-After (HTML for a browser)', async () => {
  process.env.SHED_AT = '0.85'; R.forceLoad(0.99);
  try {
    for (const p of ['/', '/app.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/sw.js']) assert.equal((await fetch(srv.base + p)).status, 200, p);
    const a = await fetch(srv.base + '/api/insights', { headers: { 'x-requested-with': 'qp', accept: 'application/json' } });
    assert.equal(a.status, 503); assert.ok(+a.headers.get('retry-after') >= 1);
    const b = await a.json(); assert.equal(b.shed, true); assert.equal(b.error, SHED_TEXT); assert.doesNotMatch(b.error, /market/i);
    const h = await fetch(srv.base + '/api/insights', { headers: { accept: 'text/html' } });
    assert.equal(h.status, 503); assert.match(h.headers.get('content-type'), /html/); const t = await h.text();
    assert.match(t, /http-equiv="refresh"/); assert.match(t, /taking longer than usual/);
    assert.equal((await fetch(srv.base + '/api/watchlist', { headers: { 'x-requested-with': 'qp' } })).status, 503, 'ordinary API calls only at 0.97 and above (this is 0.99)');
    R.forceLoad(0.9);
    assert.notEqual((await fetch(srv.base + '/api/watchlist', { headers: { 'x-requested-with': 'qp' } })).status, 503, 'at 0.9 ordinary API calls still answer');
    assert.equal((await fetch(srv.base + '/api/insights', { headers: { 'x-requested-with': 'qp' } })).status, 503, 'optional ones are shed from SHED_AT');
  } finally { R.forceLoad(null); process.env.SHED_AT = '1.01'; }
});

test('the heap limit is V8\'s real limit, not a fixed 450 MB', () => {
  const keep = process.env.HEAP_LIMIT_MB; delete process.env.HEAP_LIMIT_MB;
  try {
    const real = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
    assert.equal(R.limits().heapLimitMb, real); assert.notEqual(R.limits().heapLimitMb, 450);
    assert.equal(R.stats().heapLimitMb, real);
    process.env.HEAP_LIMIT_MB = '900'; assert.equal(R.limits().heapLimitMb, 900);
  } finally { if (keep === undefined) delete process.env.HEAP_LIMIT_MB; else process.env.HEAP_LIMIT_MB = keep; }
});

test('a short spike does not start shedding; a sustained one does, and it stops after a calm spell', () => {
  const keep = process.env.SHED_AT; process.env.SHED_AT = '0.85';
  try {
    const h = R.makeHysteresis(), t = 1_000_000;
    assert.equal(h.observe(0.99, t).shed, false);
    assert.equal(h.observe(0.99, t + 2000).shed, false, 'a 2-second spike');
    assert.equal(h.observe(0.2, t + 2500).shed, false);
    assert.equal(h.observe(0.99, t + 3000).shed, false, 'the spike timer starts again');
    assert.equal(h.observe(0.99, t + 8100).shed, true, 'stayed high for 5 seconds');
    assert.equal(h.observe(0.2, t + 9000).shed, true, 'still on right after it drops');
    assert.equal(h.observe(0.2, t + 12100).shed, false, 'off after 3 calm seconds');
  } finally { process.env.SHED_AT = keep; }
});

test('the front-end helper retries a shed 503 quietly, then succeeds; it gives up after 3 tries', async () => {
  const waits = [];
  let n = 0;
  const send = async () => (++n <= 2 ? { status: 503, retryAfter: '3', data: { shed: true } } : { status: 200, data: { ok: true } });
  const r = await withShedRetry(send, { sleep: async ms => waits.push(ms) });
  assert.equal(r.status, 200); assert.equal(n, 3); assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 3000 && waits[0] < 3500, String(waits[0])); assert.ok(waits[1] > waits[0], 'a little longer each time');
  let m = 0; const always = async () => { m++; return { status: 503, retryAfter: '60', data: { shed: true } }; };
  const w2 = []; const last = await withShedRetry(always, { sleep: async ms => w2.push(ms) });
  assert.equal(last.status, 503); assert.equal(m, 4); assert.ok(w2.every(ms => ms <= 8 * 1000 * 2 + 400), 'Retry-After is capped');
  let k = 0; const other = await withShedRetry(async () => { k++; return { status: 500, data: {} }; }, { sleep: async () => {} });
  assert.equal(other.status, 500); assert.equal(k, 1, 'other errors are not retried');
});

test('SEC company facts are trimmed before they are cached (the 941 MB heap and 526 MB cache table)', async () => {
  const { trimFacts, FACT_CONCEPTS } = await import('../src/institutions.js');
  const row = (y, extra = {}) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val: y, form: '10-K', fy: y, fp: 'FY', filed: `${y + 1}-02-01`, accn: 'x'.repeat(20), frame: `CY${y}`, ...extra });
  const big = { cik: 1, entityName: 'Big Co', facts: { 'us-gaap': {}, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [row(2024)] } } } } };
  for (let i = 0; i < 3000; i++) big.facts['us-gaap']['Unused' + i] = { label: 'x'.repeat(200), units: { USD: Array.from({ length: 30 }, (_, j) => row(1995 + j)) } };
  big.facts['us-gaap'].Revenues = { label: 'Revenues', description: 'x'.repeat(2000), units: { USD: [...Array.from({ length: 30 }, (_, j) => row(1995 + j)), row(2024, { form: '8-K' })] } };
  const t = trimFacts(big, Date.parse('2026-11-23T00:00:00Z'));
  assert.deepEqual(Object.keys(t.facts['us-gaap']), ['Revenues']); assert.ok(FACT_CONCEPTS.has('Revenues'));
  const rows = t.facts['us-gaap'].Revenues.units.USD;
  assert.ok(rows.every(r => r.form === '10-K' && r.end >= '2014-11-23'), 'only 10-K/10-Q of the last 12 years');
  assert.equal(rows[0].accn, undefined, 'only the fields that are read');
  assert.equal(t.entityName, 'Big Co');
  assert.ok(JSON.stringify(t).length < JSON.stringify(big).length / 100, `${JSON.stringify(t).length} vs ${JSON.stringify(big).length}`);
});
