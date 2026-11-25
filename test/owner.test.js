// Owner features: built-in admins, admins added in Admin, sign-in by text code (owner phone),
// GitHub sign-in against a fake GitHub, business mode, and the keys page with .env (kept on this server).
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const http = await import('node:http');
const { app } = await import('../server.js');

let server, base, fake;
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  // One fake server plays GitHub (web + API).
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/login/oauth/access_token') return new URLSearchParams(body).get('code') === 'good' ? json(200, { access_token: 'gho_x' }) : json(200, { error: 'bad_verification_code' });
      if (req.url === '/user') return json(200, { id: 4242, login: 'octo' });
      if (req.url === '/user/emails') return json(200, [{ email: 'old@example.com', verified: false, primary: false }, { email: 'Octo@Example.com', verified: true, primary: true }]);
      json(404, {});
    });
  });
  await new Promise(r => fake.listen(0, r));
});
after(() => { server.close(); fake.close(); });

function client() {
  const jar = {};
  const remember = r => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; } };
  const cookie = () => Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    async get(path) { const r = await fetch(base + path, { redirect: 'manual', headers: { cookie: cookie() } }); remember(r); return r; },
    async call(path, body, method) {
      const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: cookie() }, body: body ? JSON.stringify(body) : undefined });
      remember(r);
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      return { status: r.status, body: j, text };
    },
  };
}

test('owner emails and phone are admins; admins added in Admin; sign-in by text code', async () => {
  const owner = client();
  assert.equal((await owner.call('/auth/register', { email: 'Site-Owner2@Example.com', password: 'Str0ngPassword' })).body.user.role, 'admin');
  const guest = client();
  await guest.call('/auth/register', { email: 'friend@example.com', password: 'Str0ngPassword' });
  assert.equal((await guest.call('/admin/site/admins')).status, 403);
  // Adding an address makes that account admin at once; removing a built-in one is refused.
  assert.equal((await owner.call('/admin/site/admins', { email: 'Friend@Example.com' })).status, 200);
  assert.equal((await guest.call('/auth/me')).body.user.role, 'admin');
  assert.ok((await owner.call('/admin/site/admins')).body.added.includes('friend@example.com'));
  assert.equal((await owner.call('/admin/site/admins?email=site-owner@example.com', null, 'DELETE')).status, 400);
  assert.equal((await owner.call('/admin/site/admins', { phone: '718 555 0100' })).status, 200);
  assert.ok((await owner.call('/admin/site/admins')).body.phones.added.includes('+17185550100'));
  assert.equal((await owner.call('/admin/site/admins?phone=%2B17185550100', null, 'DELETE')).status, 200);

  // The owner's phone (written without +1) gets a code and signs in to the owner account.
  const p = client();
  const start = (await p.call('/auth/phone/start', { phone: '555-000-0001' })).body;
  assert.equal(start.ok, true); assert.match(start.devCode, /^\d{6}$/);
  assert.equal((await p.call('/auth/phone/verify', { phone: '5550000001', code: '000000' })).status, 401);
  const me = (await p.call('/auth/phone/verify', { phone: '+15550000001', code: start.devCode })).body.user;
  assert.equal(me.role, 'admin'); assert.equal(me.phone, '+15550000001'); assert.equal(me.phoneVerified, true);
  // A number without an account gets the same answer and no code.
  const unknown = (await client().call('/auth/phone/start', { phone: '2125550199' })).body;
  assert.equal(unknown.ok, true); assert.equal(unknown.devCode, undefined);
});

test('GitHub sign-up, linking by verified email, and failures', async () => {
  const c = client();
  assert.match(decodeURIComponent((await c.get('/auth/github')).headers.get('location')), /GitHub sign-in is not set up/);
  const port = fake.address().port;
  Object.assign(process.env, { GITHUB_CLIENT_ID: 'ghid', GITHUB_CLIENT_SECRET: 'ghsecret', GITHUB_URL: `http://127.0.0.1:${port}`, GITHUB_API_URL: `http://127.0.0.1:${port}` });
  try {
    assert.equal((await c.call('/public/features')).body.github, true);
    const to = new URL((await c.get('/auth/github')).headers.get('location'));
    assert.equal(to.pathname, '/login/oauth/authorize'); assert.equal(to.searchParams.get('client_id'), 'ghid');
    // Wrong state, then a bad code, then the real thing.
    assert.match(decodeURIComponent((await c.get('/auth/github/callback?state=nope&code=good')).headers.get('location')), /expired/);
    let s = new URL((await c.get('/auth/github')).headers.get('location')).searchParams.get('state');
    assert.match(decodeURIComponent((await c.get(`/auth/github/callback?state=${s}&code=bad`)).headers.get('location')), /did not accept/);
    s = new URL((await c.get('/auth/github')).headers.get('location')).searchParams.get('state');
    assert.equal((await c.get(`/auth/github/callback?state=${s}&code=good`)).headers.get('location'), '/app#/dashboard?welcome=1');
    const me = (await c.call('/auth/me')).body.user;
    assert.equal(me.email, 'octo@example.com'); assert.equal(me.github, true); assert.equal(me.emailVerified, true);
    // Signing in again finds the same account.
    const c2 = client();
    s = new URL((await c2.get('/auth/github')).headers.get('location')).searchParams.get('state');
    assert.equal((await c2.get(`/auth/github/callback?state=${s}&code=good`)).headers.get('location'), '/app#/dashboard');
    assert.equal((await c2.call('/auth/me')).body.user.id, me.id);
  } finally { for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_URL', 'GITHUB_API_URL']) delete process.env[k]; }
});

test('business mode, keys page and .env import (kept on this server, no Render sync)', async () => {
  const owner = client();
  await owner.call('/auth/register', { email: 'site-owner@example.com', password: 'Str0ngPassword' });
  // Software only by default; adviser mode needs the registration confirmed.
  assert.equal((await owner.call('/admin/site/mode')).body.adviser, false);
  assert.equal((await owner.call('/config')).body.adviser, false);
  assert.equal((await owner.call('/admin/site/mode', { adviser: true }, 'PUT')).status, 400);
  assert.equal((await owner.call('/admin/site/mode', { adviser: true, registered: true, crd: '123456' }, 'PUT')).body.adviser, true);
  assert.equal((await owner.call('/public/features')).body.adviser, true);
  assert.equal((await owner.call('/admin/site/mode', { adviser: false }, 'PUT')).body.adviser, false);

  // Saving a key needs the password again (step-up), then works at once; secrets show their last 4
  // characters only; host-only names are refused.
  assert.equal((await owner.call('/admin/site/env', { key: 'RESEND_API_KEY', value: 're_1234567890abcd' }, 'PUT')).status, 403);
  assert.equal((await owner.call('/admin/server/unlock', { password: 'Str0ngPassword' })).status, 200);
  assert.equal((await owner.call('/admin/site/env', { key: 'RESEND_API_KEY', value: 're_1234567890abcd' }, 'PUT')).status, 200);
  assert.equal(process.env.RESEND_API_KEY, 're_1234567890abcd');
  const env = (await owner.call('/admin/site/env')).body;
  const row = env.groups.flatMap(g => g.rows).find(r => r.key === 'RESEND_API_KEY');
  assert.equal(row.set, true); assert.equal(row.value, '•••abcd');
  assert.equal(JSON.stringify(env).includes('re_1234567890abcd'), false);
  assert.equal((await owner.call('/admin/site/env', { key: 'NODE_ENV', value: 'production' }, 'PUT')).status, 400);
  assert.equal((await owner.call('/admin/site/env', { key: 'bad name', value: 'x' }, 'PUT')).status, 400);

  // Import a .env (masked values skipped). Exporting real values is gone: keys never reach a browser.
  const imp = (await owner.call('/admin/site/env/import', { text: 'export EMAIL_FROM="Brightolio <hi@example.com>"\n# note\nTRIAL_DAYS=21 # three weeks\nRESEND_API_KEY=re_•••abcd\nMY_EXTRA=1' })).body;
  assert.deepEqual(imp.keys.sort(), ['EMAIL_FROM', 'MY_EXTRA', 'TRIAL_DAYS']);
  assert.equal(process.env.EMAIL_FROM, 'Brightolio <hi@example.com>'); assert.equal(process.env.RESEND_API_KEY, 're_1234567890abcd');
  assert.equal((await owner.call('/admin/site/env/export', { password: 'wrong' })).status, 401);
  const out = await owner.call('/admin/site/env/export', { password: 'Str0ngPassword' });
  assert.equal(out.status, 410); assert.equal(out.text.includes('re_1234567890abcd'), false);

  // No Render: the sync routes are gone, the keys page names no Render, and a key is set and cleared on this server only.
  try {
    for (const p of ['/admin/site/env/render/push', '/admin/site/env/render/pull', '/admin/site/env/render/deploy']) assert.equal((await owner.call(p, {})).status, 404, p);
    assert.equal((await owner.call('/admin/site/env')).body.render, undefined);
    await owner.call('/admin/site/env', { key: 'TWILIO_FROM', value: '+18455550000' }, 'PUT');
    assert.equal(process.env.TWILIO_FROM, '+18455550000');
    await owner.call('/admin/site/env', { key: 'TWILIO_FROM', value: '' }, 'PUT');
    assert.equal(process.env.TWILIO_FROM, undefined);
  } finally { for (const k of ['RESEND_API_KEY', 'EMAIL_FROM', 'TRIAL_DAYS', 'MY_EXTRA', 'TWILIO_FROM']) delete process.env[k]; }
});
