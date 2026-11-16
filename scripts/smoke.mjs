// Smoke test of a running site (the live one after every deploy, or a local server in tests).
//   node scripts/smoke.mjs https://app.example.com
// Checks that the pages load with their legal text and the layout, that the app's trading and payment
// code is served, that the health checks answer, and that sign-in refuses a wrong password with a normal
// answer (the sign-in route and database are alive). With SMOKE_EMAIL and SMOKE_PASSWORD set (a test
// account, never a real customer) it also signs in, reads the account and the planning tools, and signs out.
// It never places an order or moves money. Exit code 1 if anything fails; --json prints the results.
export async function smoke(base, { email = process.env.SMOKE_EMAIL, password = process.env.SMOKE_PASSWORD, timeoutMs = 20000 } = {}) {
  base = base.replace(/\/$/, '');
  const results = [];
  const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...init });
  const check = async (name, fn) => { try { const msg = await fn(); results.push({ name, ok: true, msg: msg || '' }); } catch (e) { results.push({ name, ok: false, msg: e.message }); } };
  const must = (c, m) => { if (!c) throw new Error(m); };
  const page = async (p, needles, status = 200) => {
    const r = await get(p); must(r.status === status, `${p} answered ${r.status}`);
    const t = await r.text();
    for (const n of needles) must(t.includes(n), `${p} is missing "${n}"`);
    return t;
  };
  await check('homepage: loads, risk text and link, layout', () => page('/', ['Risk Disclosure', 'layout.css', 'id="compliance"']));
  await check('risk disclosure page', () => page('/risk', ['Risk']));
  await check('terms page', () => page('/terms', ['Terms']));
  await check('privacy page', () => page('/privacy', ['Privacy']));
  await check('app shell: footer disclosures and layout', () => page('/app', ['Trading involves risk of loss', 'hypothetical', 'not a broker or investment adviser', 'layout.css']));
  for (const f of ['/app.js', '/layout.js', '/layout.css', '/pages/trading.js']) {
    await check(`asset ${f}`, async () => { const r = await get(f); must(r.status === 200, `${f} answered ${r.status}`); must((await r.text()).length > 200, `${f} is empty`); });
  }
  await check('health: /healthz', async () => { const r = await get('/healthz'); must(r.status === 200, `answered ${r.status}`); });
  await check('health: routing (paper is paper, live is live)', async () => { const r = await get('/healthz/routing'); must(r.status === 200, `answered ${r.status}`); const j = await r.json(); must(j.ok === true, 'routing check not ok: ' + JSON.stringify(j.problems || [])); });
  await check('signed out: the API refuses and answers normally', async () => { const r = await get('/api/auth/me', { headers: { 'X-Requested-With': 'qp' } }); must([200, 401].includes(r.status), `answered ${r.status}`); });
  await check('sign-in: a wrong password is refused with a normal answer', async () => {
    const r = await get('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ email: 'smoke-test-nobody@example.invalid', password: 'definitely-wrong-password' }) });
    must([400, 401, 403, 429].includes(r.status), `answered ${r.status}`);
    must((r.headers.get('content-type') || '').includes('json'), 'not a JSON answer');
  });
  if (email && password) {
    let cookie = '';
    await check('test account: sign in', async () => {
      const r = await get('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ email, password }) });
      must(r.status === 200, `sign-in answered ${r.status}`);
      cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; '); must(cookie, 'no session cookie');
    });
    const authed = (p, init = {}) => get(p, { ...init, headers: { 'X-Requested-With': 'qp', cookie, ...(init.headers || {}) } });
    await check('test account: account and planning tools answer', async () => {
      must((await authed('/api/auth/me')).status === 200, 'account');
      must((await authed('/api/tools/status')).status === 200, 'planning tools');
    });
    await check('test account: sign out', async () => { const r = await authed('/api/auth/logout', { method: 'POST' }); must(r.status < 400, `answered ${r.status}`); });
  } else results.push({ name: 'test account sign-in', ok: true, msg: 'skipped: SMOKE_EMAIL and SMOKE_PASSWORD are not set' });
  return results;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const base = process.argv[2]; if (!base) { console.error('usage: node scripts/smoke.mjs <https://site>'); process.exit(2); }
  const t0 = Date.now(), results = await smoke(base);
  if (process.argv.includes('--json')) console.log(JSON.stringify(results));
  else for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.msg ? ': ' + r.msg : ''}`);
  const bad = results.filter(r => !r.ok);
  console.log(bad.length ? `\n${bad.length} of ${results.length} checks FAILED (${Date.now() - t0} ms)` : `\nAll ${results.length} checks passed (${Date.now() - t0} ms)`);
  process.exit(bad.length ? 1 : 0);
}
