// The Cloudflare edge set up from Admin → Hosting with one press (src/edgesetup.js), and servers
// trusting the public address only when it comes signed from the edge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const calls = [];
let onCloudflare = true, sub = null;
const cf = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace('/client/v4', '');
    calls.push({ method: req.method, p, q: u.search, body: b, auth: req.headers.authorization });
    const ok = result => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, result })); };
    if (p === '/user/tokens/verify') return ok({ status: 'active' });
    if (p === '/accounts') return ok([{ id: 'acc9', name: 'Mine' }]);
    if (p === '/accounts/acc9/storage/kv/namespaces' && req.method === 'GET') return ok([]);
    if (p === '/accounts/acc9/storage/kv/namespaces' && req.method === 'POST') return ok({ id: 'kv9', title: JSON.parse(b).title });
    if (p === '/zones') return ok(onCloudflare && u.searchParams.get('name') === 'example.com' ? [{ id: 'z9', name: 'example.com' }] : []);
    if (p === '/zones/z9/dns_records' && req.method === 'GET') return ok([{ id: 'r1', type: 'A', name: 'app.example.com', proxied: false }]);
    if (p === '/zones/z9/workers/routes' && req.method === 'GET') return ok([]);
    if (p === '/accounts/acc9/workers/subdomain' && req.method === 'PUT') { sub = JSON.parse(b).subdomain; return ok({ subdomain: sub }); }
    if (p === '/accounts/acc9/workers/subdomain') { if (!sub) { res.statusCode = 404; return res.end(JSON.stringify({ success: false, errors: [{ code: 10007, message: 'This account does not have a workers.dev subdomain' }] })); } return ok({ subdomain: sub }); }
    if (/\/scripts\/brightfolio-edge(\/subdomain|\/schedules)?$/.test(p) && req.method !== 'GET' && !sub) { res.statusCode = 400; return res.end(JSON.stringify({ success: false, errors: [{ code: 10063, message: 'You need a workers.dev subdomain in order to proceed.' }] })); }
    return ok({});
  });
});
await new Promise(r => cf.listen(0, '127.0.0.1', r));
Object.assign(process.env, { CLOUDFLARE_API_URL: `http://127.0.0.1:${cf.address().port}`, PUBLIC_URL: 'https://app.example.com', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' });
for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_KV_ID', 'CLOUDFLARE_ZONE_ID', 'SITE_DOMAIN', 'EDGE_SECRET', 'HOST_ID']) delete process.env[k];

const { app } = await import('../server.js');
const { edgeSecret } = await import('../src/edgesetup.js');
let server, base, cookie = '';
const api = async (path, body, method) => {
  const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await api('/auth/register', { email: 'owner@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); cf.close(); });

test('Set up the edge: one token, then account, store, Worker, keep-warm, servers and the domain', async () => {
  // Without the token: a clear message, nothing sent to Cloudflare.
  let r = await api('/admin/hosting/edge', { domain: 'app.example.com', password: 'Str0ngPassword1' });
  assert.equal(r.status, 400); assert.match(r.body.error, /CLOUDFLARE_API_TOKEN/);
  process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
  // Wrong password: refused.
  assert.equal((await api('/admin/hosting/edge', { domain: 'app.example.com', password: 'nope' })).status, 401);
  // No servers yet: says to add them with their own addresses.
  r = await api('/admin/hosting/edge', { domain: 'app.example.com', password: 'Str0ngPassword1' });
  assert.equal(r.status, 400); assert.match(r.body.error, /Add your servers/);

  await api('/admin/hosting/servers', { id: 'oracle', kind: 'oracle-vm', url: 'https://1-2-3-4.sslip.io' });
  await api('/admin/hosting/servers', { id: 'render', kind: 'render', url: 'https://demo.onrender.com' });
  await api('/admin/hosting/servers', { id: 'self', kind: 'custom', url: 'https://app.example.com' }); // the edge's own name: never an origin
  calls.length = 0;
  r = await api('/admin/hosting/edge', { domain: 'app.example.com', password: 'Str0ngPassword1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.url, 'https://app.example.com'); assert.equal(r.body.route, true);
  assert.deepEqual(r.body.origins, ['https://1-2-3-4.sslip.io', 'https://demo.onrender.com']);
  assert.ok(calls.every(c => c.auth === 'Bearer cf-token'));
  const upload = calls.find(c => c.method === 'PUT' && c.p === '/accounts/acc9/workers/scripts/brightfolio-edge');
  assert.ok(upload, 'Worker uploaded');
  assert.match(upload.body, /"namespace_id":"kv9"/); assert.match(upload.body, /"name":"EDGE_SECRET"/); assert.match(upload.body, /export default/);
  assert.ok(upload.body.includes(edgeSecret()), 'the edge gets the secret the servers already share');
  assert.ok(calls.find(c => c.p.endsWith('/schedules') && /\*\/5/.test(c.body)), 'keep-warm schedule');
  assert.equal(calls.find(c => c.p.endsWith('/values/origins')).body, JSON.stringify(['https://1-2-3-4.sslip.io', 'https://demo.onrender.com']));
  assert.ok(calls.find(c => c.method === 'PATCH' && c.p === '/zones/z9/dns_records/r1' && /"proxied":true/.test(c.body)), 'the name goes through Cloudflare');
  assert.ok(calls.find(c => c.method === 'POST' && c.p === '/zones/z9/workers/routes' && /app\.example\.com\/\*/.test(c.body)), 'route on the domain');

  // Admin → Hosting shows it; switching now updates the edge's list and leaves the domain alone.
  const page = (await api('/admin/hosting')).body;
  assert.equal(page.edge.setup.url, 'https://app.example.com'); assert.equal(page.edge.ready, true);

  // A domain that is not on Cloudflare, on an account without a workers.dev name yet: the name is
  // made, and the edge gets the free workers.dev address; the steps say how to add the domain.
  onCloudflare = false;
  r = await api('/admin/hosting/edge', { domain: 'app.example.com', password: 'Str0ngPassword1' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.url, 'https://brightfolio-edge.brightolio.workers.dev'); assert.equal(r.body.route, false);
  assert.ok(r.body.steps.some(x => /not on this Cloudflare account yet.*Add a domain → example\.com/.test(x)));
  onCloudflare = true;
});

test('The public address is trusted only from the edge (signed)', async () => {
  const start = async headers => new URL((await fetch(base + '/auth/google', { redirect: 'manual', headers })).headers.get('location')).searchParams.get('redirect_uri');
  // Straight to the server: its own address.
  assert.match(await start({}), /^http:\/\/127\.0\.0\.1:\d+\/auth\/google\/callback$/);
  // Through the edge: the address the visitor used.
  assert.equal(await start({ 'x-forwarded-host': 'app.example.com', 'x-edge-secret': edgeSecret() }), 'https://app.example.com/auth/google/callback');
  // A faked header without the right secret changes nothing.
  assert.match(await start({ 'x-forwarded-host': 'evil.example.net', 'x-edge-secret': 'guess' }), /^http:\/\/127\.0\.0\.1/);
});
