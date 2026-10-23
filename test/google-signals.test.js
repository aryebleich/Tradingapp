// Google sign-in (against a fake Google token endpoint) and alert webhooks.
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const http = await import('node:http');
const { app } = await import('../server.js');

let server, base, google, nextClaims = {};
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  // Fake Google: the token endpoint returns an id_token carrying whatever the test set in nextClaims.
  google = http.createServer((req, res) => {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      const p = new URLSearchParams(body);
      if (p.get('code') !== 'good-code' || p.get('client_secret') !== 'gsecret') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"invalid_grant"}'); }
      const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'x', id_token: `${enc({ alg: 'RS256' })}.${enc(nextClaims)}.sig` }));
    });
  });
  await new Promise(r => google.listen(0, r));
});
after(() => { server.close(); google.close(); });

// A tiny cookie-jar client per user.
function client() {
  const jar = {};
  const remember = r => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; } };
  const cookie = () => Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar,
    async get(path) { const r = await fetch(base + path, { redirect: 'manual', headers: { cookie: cookie() } }); remember(r); return r; },
    async call(path, body, method) {
      const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: cookie() }, body: body ? JSON.stringify(body) : undefined });
      remember(r);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
  };
}
const hook = (url, body, type = 'application/json') => fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));

// Runs the whole Google round trip; returns the final redirect target.
async function googleSignIn(c, claims, { code = 'good-code', ref } = {}) {
  const start = await c.get('/auth/google' + (ref ? '?ref=' + ref : ''));
  const to = new URL(start.headers.get('location'));
  nextClaims = { iss: 'https://accounts.google.com', aud: 'gid', exp: Math.floor(Date.now() / 1000) + 600, nonce: to.searchParams.get('nonce'), email_verified: true, ...claims };
  const cb = await c.get(`/auth/google/callback?state=${to.searchParams.get('state')}&code=${code}`);
  return decodeURIComponent(cb.headers.get('location'));
}

test('Google sign-up, sign-in, account linking and safety checks', async () => {
  const c = client();
  // Not configured: back to the sign-in page with a clear message.
  assert.match(decodeURIComponent((await c.get('/auth/google')).headers.get('location')), /#\/login\?error=Google sign-in is not set up/);
  assert.equal((await c.call('/config')).body.google, false);

  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_AUTH_URL: 'https://accounts.example/auth', GOOGLE_TOKEN_URL: `http://127.0.0.1:${google.address().port}/token` });
  assert.equal((await c.call('/config')).body.google, true);
  const start = await c.get('/auth/google');
  const to = new URL(start.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.example/auth');
  assert.equal(to.searchParams.get('client_id'), 'gid');
  assert.match(to.searchParams.get('scope'), /openid email/);

  // New user: account created, signed in, no password, email already verified.
  assert.equal(await googleSignIn(c, { sub: 'g-1', email: 'Gina@Example.com' }), '/app#/dashboard?welcome=1');
  let me = (await c.call('/auth/me')).body.user;
  assert.equal(me.email, 'gina@example.com');
  assert.equal(me.google, true); assert.equal(me.hasPassword, false); assert.equal(me.emailVerified, true);
  assert.equal((await c.call('/account?account=paper')).body.cash, 100000);
  // Password sign-in is impossible until a password is added, then both work.
  assert.equal((await c.call('/auth/login', { email: 'gina@example.com', password: 'Whatever123x' })).status, 401);
  assert.equal((await c.call('/auth/password', { next: 'GinaPassw0rd!' })).status, 200);
  assert.equal((await c.call('/auth/me')).body.user.hasPassword, true);

  // Returning user: same account, no welcome.
  const c2 = client();
  assert.equal(await googleSignIn(c2, { sub: 'g-1', email: 'gina@example.com' }), '/app#/dashboard');
  assert.equal((await c2.call('/auth/me')).body.user.email, 'gina@example.com');

  // Rejections: replayed state, missing state cookie, wrong audience, unverified email, bad code.
  const c3 = client();
  const s3 = new URL((await c3.get('/auth/google')).headers.get('location')).searchParams.get('state');
  const other = client(); // a different browser cannot finish this sign-in
  assert.match(decodeURIComponent((await other.get(`/auth/google/callback?state=${s3}&code=good-code`)).headers.get('location')), /expired/);
  assert.match(decodeURIComponent((await c3.get(`/auth/google/callback?state=${s3}&code=good-code`)).headers.get('location')), /expired/); // state is single-use
  assert.match(await googleSignIn(client(), { sub: 'g-2', email: 'x@example.com', aud: 'someone-else' }), /different app/);
  assert.match(await googleSignIn(client(), { sub: 'g-2', email: 'x@example.com', email_verified: false }), /Verify your Google email/);
  assert.match(await googleSignIn(client(), { sub: 'g-2', email: 'x@example.com' }, { code: 'bad' }), /did not accept/);
  assert.match(decodeURIComponent((await client().get('/auth/google/callback?error=access_denied')).headers.get('location')), /cancelled/);

  // Linking: an unconfirmed password account with the same email is taken over by the Google owner,
  // and the password set by whoever registered it stops working.
  const squatter = client();
  assert.equal((await squatter.call('/auth/register', { email: 'owner@example.com', password: 'Squatter123x' })).status, 200);
  const owner = client();
  assert.equal(await googleSignIn(owner, { sub: 'g-3', email: 'owner@example.com' }), '/app#/dashboard');
  assert.equal((await squatter.call('/auth/me')).body.user, null);
  assert.equal((await client().call('/auth/login', { email: 'owner@example.com', password: 'Squatter123x' })).status, 401);
  me = (await owner.call('/auth/me')).body.user;
  assert.equal(me.google, true); assert.equal(me.hasPassword, false);

  // A Google-only account confirms deletion with its email address.
  assert.equal((await owner.call('/auth/delete', { confirm: 'nope@example.com' })).status, 401);
  assert.equal((await owner.call('/auth/delete', { confirm: 'owner@example.com' })).status, 200);
});

test('alert webhooks: orders, sizing, risk rules, plan limits and the log', async () => {
  const c = client();
  await c.call('/auth/register', { email: 'trader@example.com', password: 'Trader12345x' });
  // Free plan: paper only, one webhook.
  const up = await c.call('/signals/hooks', { name: 'Live', accounts: ['alpaca'], sizeMode: 'dollars', size: 100 });
  assert.equal(up.status, 402); assert.equal(up.body.upgrade, true);
  assert.equal((await c.call('/signals/hooks', { name: '', accounts: ['paper'] })).status, 400);
  const h = (await c.call('/signals/hooks', { name: 'SPY trend', accounts: ['paper'], sizeMode: 'qty', size: 5, maxTradesDay: 4 })).body;
  assert.match(h.url, /\/hook\/[\w-]{30,}$/);
  const url = h.url.replace(/^https?:\/\/[^/]+/, base);
  assert.equal((await c.call('/signals/hooks', { name: 'Second', accounts: ['paper'], size: 100 })).status, 402);

  // TradingView JSON with an exchange prefix, fixed 5 shares.
  let r = await hook(url, { ticker: 'NASDAQ:AAPL', action: 'buy', quantity: '99' });
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.symbol, 'AAPL'); assert.equal(r.body.results[0].qty, 5);
  // Plain text (TradingView sends text/plain for non-JSON messages); sells are capped at what is held.
  r = await hook(url, 'sell AAPL 2', 'text/plain');
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.results[0].qty, 5);
  r = await hook(url, { ticker: 'AAPL', action: 'sell' });
  assert.equal(r.body.status, 'rejected'); assert.match(r.body.results[0].error, /No AAPL shares/);
  // Strategy "flat" closes the position.
  await hook(url, { ticker: 'MSFT', action: 'buy' });
  r = await hook(url, { ticker: 'MSFT', action: 'sell', quantity: 1, sentiment: 'flat' });
  assert.equal(r.body.action, 'exit'); assert.equal(r.body.results[0].qty, 5);
  assert.equal((await c.call('/account?account=paper')).body.positions.filter(p => p.qty > 0).length, 0);
  // Risk rule: trades per day (4 executed so far: buy, sell, buy, exit).
  r = await hook(url, { ticker: 'AAPL', action: 'buy' });
  assert.equal(r.body.status, 'rejected'); assert.match(r.body.error, /already 4 trades today/);
  // Bad messages are logged, not executed.
  assert.match((await hook(url, { ticker: 'AAPL', action: 'hold' })).body.error, /Unknown action/);
  assert.match((await hook(url, 'hello', 'text/plain')).body.error, /Unknown/);

  // Edit: dollar sizing, a max position and allowed tickers.
  const e = await c.call(`/signals/hooks/${h.id}`, { name: 'SPY trend', accounts: ['paper'], sizeMode: 'dollars', size: 1000, maxPosition: 1500, symbols: 'spy, qqq' }, 'PUT');
  assert.equal(e.body.symbols, 'SPY,QQQ');
  assert.match((await hook(url, { ticker: 'AAPL', action: 'buy' })).body.error, /not in this webhook's allowed tickers/);
  // Test signals skip the daily limit; the second $1,000 buy would exceed the $1,500 position cap.
  r = (await c.call(`/signals/hooks/${h.id}/test`, { message: '{"ticker":"SPY","action":"buy"}' })).body;
  assert.equal(r.status, 'ok'); assert.ok(r.results[0].qty > 0);
  r = (await c.call(`/signals/hooks/${h.id}/test`, { message: 'buy SPY' })).body;
  assert.equal(r.status, 'rejected'); assert.match(r.results[0].error, /above the \$1,500 limit/);

  // Paused webhooks reject real alerts.
  await c.call(`/signals/hooks/${h.id}/pause`, { enabled: false });
  assert.match((await hook(url, { ticker: 'SPY', action: 'exit' })).body.error, /paused/);

  const log = (await c.call('/signals/log')).body;
  assert.ok(log.length >= 10);
  assert.equal(log.filter(x => x.test).length, 2);

  // A new URL retires the old one; other users cannot touch this webhook.
  const rot = (await c.call(`/signals/hooks/${h.id}/rotate`, {})).body;
  assert.notEqual(rot.url, h.url);
  assert.equal((await hook(url, { ticker: 'SPY', action: 'buy' })).status, 404);
  const intruder = client();
  await intruder.call('/auth/register', { email: 'intruder@example.com', password: 'Intruder123x' });
  assert.equal((await intruder.call(`/signals/hooks/${h.id}`, null, 'DELETE')).status, 404);
  assert.equal((await intruder.call('/signals/log')).body.length, 0);
  assert.equal((await c.call(`/signals/hooks/${h.id}`, null, 'DELETE')).status, 200);
});
