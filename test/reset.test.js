// Forgot password end to end against a fake email service (Resend) and a fake Twilio: the link uses
// the address the request came in on, Gmail matches with dots, a refused email shows in Admin,
// the text-message code works; and the free plan's integration limits (texts, QuantConnect).
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const http = await import('node:http');

let fake, inbox = [], texts = [], refuse = false;
before(async () => {
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      if (req.url === '/emails') {
        if (refuse) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"message":"The gmail.com domain is not verified"}'); }
        inbox.push(JSON.parse(body)); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"id":"e1"}');
      }
      if (req.url.endsWith('/Messages.json')) { texts.push(Object.fromEntries(new URLSearchParams(body))); res.writeHead(201, { 'Content-Type': 'application/json' }); return res.end('{"sid":"SM1"}'); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => fake.listen(0, r));
});
after(() => fake.close());
const { serve } = await import('./client.js');
const { run } = await import('../src/db.js');

test('forgot password: email link, Gmail with dots, refused email in Admin, text-message code', async () => {
  const s = await serve(), F = `http://127.0.0.1:${fake.address().port}`;
  const keys = { RESEND_API_KEY: 're_test', RESEND_API_URL: F, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+18455550000', TWILIO_API_URL: F };
  const prevUrl = process.env.PUBLIC_URL; delete process.env.PUBLIC_URL;
  Object.assign(process.env, keys);
  try {
    const owner = s.client();
    await owner('/auth/register', { email: 'site-owner@example.com', password: 'Str0ngPassword' });
    const c = s.client();
    await c('/auth/register', { email: 'jane.doe@gmail.com', password: 'Str0ngPassword' });
    await new Promise(r => setTimeout(r, 150)); // welcome emails go out in the background
    inbox = [];
    // Typed without the dot, in capitals: still found; the link points at this server, not localhost.
    assert.deepEqual((await c('/auth/forgot', { email: 'JaneDoe@gmail.com' })).body, { ok: true });
    assert.equal(inbox.length, 1); assert.deepEqual(inbox[0].to, ['jane.doe@gmail.com']);
    const link = inbox[0].text.match(/(http\S+#\/reset\?token=(\S+))/);
    assert.ok(link[1].startsWith(s.base), link[1]);
    assert.equal((await c('/auth/reset', { token: link[2], password: 'Brand-New-Pass1' })).status, 200);
    assert.equal((await c('/auth/login', { email: 'janedoe@gmail.com', password: 'Brand-New-Pass1' })).status, 200);
    // Unknown address: the same answer, nothing sent.
    inbox = [];
    assert.deepEqual((await c('/auth/forgot', { email: 'ghost@example.com' })).body, { ok: true });
    assert.equal(inbox.length, 0);
    // The email service refuses: the owner sees why in Admin → Setup, and the test button reports it.
    refuse = true;
    await c('/auth/forgot', { email: 'jane.doe@gmail.com' });
    await new Promise(r => setTimeout(r, 100));
    assert.match((await owner('/admin/setup')).body.emailError.msg, /not verified/);
    assert.match((await owner('/admin/test-email', {})).body.error, /refused it/);
    refuse = false;
    assert.equal((await owner('/admin/test-email', {})).body.to, 'site-owner@example.com');
    assert.equal((await owner('/admin/setup')).body.emailError, null);
    // By text message: a verified phone gets a code that resets the password.
    const me = (await c('/auth/me')).body.user;
    await run("UPDATE users SET phone = '+17185550123', phone_verified = 1 WHERE id = ?", me.id);
    texts = [];
    assert.deepEqual((await c('/auth/forgot', { phone: '718-555-0123' })).body, { ok: true });
    const code = texts[0].Body.match(/(\d{6})/)[1];
    assert.equal((await c('/auth/reset', { phone: '7185550123', code: '000000', password: 'Another-Pass9' })).status, 400);
    assert.equal((await c('/auth/reset', { phone: '7185550123', code, password: 'Another-Pass9' })).status, 200);
    assert.equal((await c('/auth/login', { email: 'jane.doe@gmail.com', password: 'Another-Pass9' })).status, 200);
    // Free plan: no trading by text, no text alerts, no QuantConnect.
    texts = [];
    const { notifyUser } = await import('../src/notify-user.js');
    await notifyUser(me.id, 'Test alert');
    assert.equal(texts.length, 0);
    assert.equal((await c('/pin', { pin: '1234' })).status, 402);
    assert.equal((await c('/integrations/quantconnect', { userId: '1', token: 'x' })).status, 402);
    await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = ?", me.id);
    await notifyUser(me.id, 'Test alert');
    assert.equal(texts.length, 1);
  } finally {
    for (const k of Object.keys(keys)) delete process.env[k];
    if (prevUrl !== undefined) process.env.PUBLIC_URL = prevUrl;
    s.close();
  }
});

test('Admin → Yiddish Labs: status, runs, start a run, switch on after every push (fake GitHub)', async () => {
  const calls = [];
  let auto = null;
  const gh = http.createServer((req, res) => {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
      const json = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(o ? JSON.stringify(o) : ''); };
      const base = '/repos/aryebleich/Tradingapp/actions';
      if (req.url.startsWith(base + '/workflows/yiddish.yml/runs')) return json(200, { workflow_runs: [{ id: 7, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', created_at: '2026-10-27T10:00:00Z', html_url: 'https://github.com/x/runs/7' }] });
      if (req.url === base + '/workflows/yiddish.yml/dispatches') return json(204);
      if (req.url === base + '/variables/YL_AUTO') { if (req.method === 'GET') return auto == null ? json(404, { message: 'Not Found' }) : json(200, { value: auto }); if (auto == null) return json(404, {}); auto = JSON.parse(body).value; return json(204); }
      if (req.url === base + '/variables' && req.method === 'POST') { auto = JSON.parse(body).value; return json(201); }
      json(404, {});
    });
  });
  await new Promise(r => gh.listen(0, r));
  const s = await serve(), saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPO: process.env.GITHUB_REPO };
  delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_REPO;
  try {
    const owner = s.client();
    await owner('/auth/register', { email: 'site-owner2@example.com', password: 'Str0ngPassword' });
    assert.equal((await owner('/admin/site/yiddish')).body.configured, false);
    assert.equal((await owner('/admin/site/yiddish/run', {})).status, 400);
    Object.assign(process.env, { GITHUB_TOKEN: 'ghp_test', GITHUB_API_URL: `http://127.0.0.1:${gh.address().port}` });
    const d = (await owner('/admin/site/yiddish')).body;
    assert.equal(d.configured, true); assert.equal(d.auto, false); assert.equal(d.runs[0].conclusion, 'success');
    assert.match(d.lastRef, /^[0-9a-f]{40}$/);
    assert.equal((await owner('/admin/site/yiddish/run', { since: 'not a commit' })).status, 400);
    assert.equal((await owner('/admin/site/yiddish/run', { since: '67a78dc', limit: '50' })).body.ok, true);
    assert.deepEqual(calls.find(c => c.url.endsWith('/dispatches')).body, { ref: 'main', inputs: { since: '67a78dc', limit: '50' } });
    assert.equal(calls.at(-1).auth, 'Bearer ghp_test');
    assert.equal((await owner('/admin/site/yiddish/auto', { on: true }, 'PUT')).body.auto, true); // created
    assert.equal(auto, 'true');
    assert.equal((await owner('/admin/site/yiddish/auto', { on: false }, 'PUT')).body.auto, false); // updated
    assert.equal((await owner('/admin/site/yiddish')).body.auto, false);
    const guest = s.client(); await guest('/auth/register', { email: 'g2@example.com', password: 'Str0ngPassword' });
    assert.equal((await guest('/admin/site/yiddish')).status, 403);
  } finally {
    delete process.env.GITHUB_API_URL;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    s.close(); gh.close();
  }
});
