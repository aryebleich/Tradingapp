// Batch 18: hosting (servers, health, switching through the edge's KV and DNS, only the active
// server runs jobs), the visitor's real address from the edge, and the edge Worker's failover.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Two fake servers that answer /healthz/routing, and a fake Cloudflare API.
const mk = commit => http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, commit })); });
const s1 = mk('aaaaaaa1'), s2 = mk('bbbbbbb2');
const cfCalls = [];
const cf = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    cfCalls.push({ method: req.method, url: req.url, body: b });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/dns_records?')) return res.end(JSON.stringify({ success: true, result: [{ id: 'rec1', type: 'A', name: 'app.example.com' }] }));
    res.end(JSON.stringify({ success: true, result: {} }));
  });
});
for (const s of [s1, s2, cf]) await new Promise(r => s.listen(0, '127.0.0.1', r));
const addr = s => `http://127.0.0.1:${s.address().port}`;
Object.assign(process.env, { CRON_SECRET: 'tick-secret', EDGE_SECRET: 'edge-secret-123', CLOUDFLARE_API_URL: addr(cf), CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acc1', CLOUDFLARE_KV_ID: 'kv1', CLOUDFLARE_ZONE_ID: 'zone1', SITE_DOMAIN: 'app.example.com' });
delete process.env.HOST_ID;

const { app } = await import('../server.js');
const H = await import('../src/hosting.js');
let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method, headers = {}) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const owner = client();
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await owner('/auth/register', { email: 'owner@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); s1.close(); s2.close(); cf.close(); });

test('hosting: servers, health, switching through the edge and DNS; only the active server runs jobs', async () => {
  assert.equal(H.isActiveHost(), true, 'no servers set up: whoever runs is active');
  assert.equal(H.thisHost(), 'local');
  const tick = () => fetch(base + '/internal/tick', { method: 'POST', headers: { Authorization: 'Bearer tick-secret' } }).then(r => r.json());
  assert.notEqual((await tick()).skipped, true);
  // Addresses must be https (the fakes are http, so the health check is pointed at them directly).
  assert.equal((await owner('/admin/hosting/servers', { id: 'local', kind: 'render', url: 'http://insecure.example' })).status, 400);
  assert.equal((await owner('/admin/hosting/servers', { id: 'Bad Id!', kind: 'render', url: 'https://a.example' })).status, 400);
  assert.equal((await owner('/admin/hosting/servers', { id: 'local', kind: 'render', name: 'Render', url: 'https://local.example' })).status, 200);
  assert.equal((await owner('/admin/hosting/servers', { id: 'oracle', kind: 'oracle-vm', url: 'https://oracle.example', hook: 'https://hooks.example/deploy?key=secret' })).status, 200);
  const siteGet = () => H.hostingConfig(), siteSet = (k, v) => H.saveHosting(v);
  const c = siteGet('hosting');
  assert.equal(c.active, 'local');
  assert.ok(!JSON.stringify(c).includes('key=secret'), 'the deploy hook is stored encrypted');
  // Point the health checks at the fakes.
  await siteSet('hosting', { ...c, servers: c.servers.map(s => ({ ...s, url: s.id === 'local' ? addr(s1) : addr(s2) })) });
  const list = (await owner('/admin/hosting')).body;
  assert.equal(list.servers.length, 2); assert.equal(list.servers.find(s => s.id === 'oracle').hook, true);
  assert.ok(list.servers.every(s => s.health.up)); assert.equal(list.servers.find(s => s.id === 'oracle').health.commit, 'bbbbbbb');
  assert.equal(list.edge.ready, true); assert.equal(list.edge.dns, true);
  // Switching needs the password; then the edge's KV gets the new order and DNS follows.
  assert.equal((await owner('/admin/hosting/switch', { id: 'oracle', password: 'wrong' })).status, 401);
  const sw = await owner('/admin/hosting/switch', { id: 'oracle', password: 'Str0ngPassword1' });
  assert.equal(sw.status, 200, JSON.stringify(sw.body));
  const kv = cfCalls.find(x => x.url.includes('/storage/kv/namespaces/kv1/values/origins'));
  assert.deepEqual(JSON.parse(kv.body), [addr(s2), addr(s1)]);
  const dns = cfCalls.find(x => x.url.includes('/dns_records/rec1'));
  assert.equal(dns.method, 'PUT'); assert.equal(JSON.parse(dns.body).content, '127.0.0.1'); assert.equal(JSON.parse(dns.body).proxied, true);
  // This server ("local") is now a standby: no jobs, no alerts.
  assert.equal(H.isActiveHost(), false);
  assert.equal((await tick()).skipped, true);
  // A server that does not answer is never switched to.
  await siteSet('hosting', { ...siteGet('hosting'), servers: siteGet('hosting').servers.map(s => (s.id === 'local' ? { ...s, url: 'http://127.0.0.1:1' } : s)) });
  const dead = await owner('/admin/hosting/switch', { id: 'local', password: 'Str0ngPassword1' });
  assert.equal(dead.status, 400); assert.match(dead.body.error, /not answering/);
  assert.equal((await owner('/admin/hosting/servers/oracle', null, 'DELETE')).status, 400, 'the active server cannot be removed');
  const u = client(); await u('/auth/register', { email: 'host-user@example.com', password: 'Str0ngPassword1', agree: true });
  assert.equal((await u('/admin/hosting')).status, 403);
  // Back to normal for the other tests.
  await siteSet('hosting', { servers: [], active: null, keepWarm: true });
  assert.equal(H.isActiveHost(), true);
});

test('the visitor\'s real address is trusted only from the edge (EDGE_SECRET)', async () => {
  const a = client();
  await a('/auth/register', { email: 'edgeip@example.com', password: 'Str0ngPassword1', agree: true }, undefined, { 'x-edge-client-ip': '203.0.113.9', 'x-edge-secret': 'edge-secret-123' });
  const s = (await a('/auth/sessions')).body;
  assert.equal(s[0].ip, '203.0.113.9');
  const b = client();
  await b('/auth/register', { email: 'edgefake@example.com', password: 'Str0ngPassword1', agree: true }, undefined, { 'x-edge-client-ip': '198.51.100.7', 'x-edge-secret': 'guess' });
  assert.notEqual((await b('/auth/sessions')).body[0].ip, '198.51.100.7');
});

test('the edge Worker: backup on a failed read, never repeats a change, passes the real address', async () => {
  const seen = [];
  const mkO = (name, status) => http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { seen.push({ name, method: req.method, url: req.url, ip: req.headers['x-edge-client-ip'], secret: req.headers['x-edge-secret'], host: req.headers['x-forwarded-host'] }); res.statusCode = status; res.setHeader('Content-Type', 'text/plain'); res.end(name); }); });
  const down = mkO('primary', 503), up = mkO('backup', 200);
  for (const s of [down, up]) await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const W = (await import('../edge/worker.js')).default, { _test } = await import('../edge/worker.js');
    _test.reset();
    const env = { ORIGINS: `${addr(down)},${addr(up)}`, EDGE_SECRET: 's3cret' };
    const ctx = { waitUntil() {} };
    const get = await W.fetch(new Request('https://edge.example/api/positions', { headers: { 'cf-connecting-ip': '192.0.2.5' } }), env, ctx);
    assert.equal(get.status, 200); assert.equal(await get.text(), 'backup'); assert.equal(get.headers.get('x-brightfolio-origin'), 'backup'); assert.equal(get.headers.get('x-brightolio-edge'), 'on', 'every answer carries the edge mark');
    assert.deepEqual(seen.map(x => x.name), ['primary', 'backup']);
    assert.equal(seen[0].ip, '192.0.2.5'); assert.equal(seen[0].secret, 's3cret'); assert.equal(seen[0].host, 'edge.example');
    seen.length = 0;
    const post = await W.fetch(new Request('https://edge.example/api/orders', { method: 'POST', body: '{"symbol":"AAPL"}', headers: { 'content-type': 'application/json' } }), env, ctx);
    assert.equal(post.status, 503); assert.equal(post.headers.get('x-brightolio-edge'), 'on');
    assert.deepEqual(seen.map(x => x.name), ['primary'], 'an order is never sent to a second server');
    // KV wins over ORIGINS once Admin → Hosting has written it.
    _test.reset();
    const kvEnv = { ...env, CONFIG: { get: async () => JSON.stringify([addr(up)]) } };
    assert.deepEqual(await _test.origins(kvEnv), [addr(up)]);
  } finally { down.close(); up.close(); }
});
