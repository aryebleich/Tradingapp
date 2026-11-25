// One address for the site (app.brightolio.com). Visitors on the server's own name or its bare IP get a
// 301 to the same path on the main address; health checks, the server's internal calls, webhooks, sign-in
// returns and the load test (with its header) are not redirected; while Render is not yet passing the main
// address on, visitors get a retry page and never the server's own address; and no file other than the
// history names the server's own address as the site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---------- the Caddy site file (the same function in setup.sh and migrate.sh) ----------
// The function ends at the line '}' that follows the block's '  }' (the site blocks inside it have '}' at column 0).
const fnOf = f => {
  const lines = read(f).split('\n'), start = lines.findIndex(l => l.startsWith('caddy_site() {'));
  assert.ok(start >= 0, `caddy_site in ${f}`);
  let end = start + 1; while (!(lines[end] === '}' && lines[end - 1] === '  }')) end++;
  return lines.slice(start, end + 1).join('\n') + '\n';
};
const site = (app, sslip, ip) => execFileSync('bash', ['-c', `${fnOf('deploy/vm/migrate.sh')}\ncaddy_site "$1" "$2" "$3"`, 'x', app, sslip, ip], { encoding: 'utf8' });

test('the Caddy site: the main domain serves the app; the server\'s name and its IP redirect visitors to it', () => {
  const c = site('app.brightolio.com', '138-2-233-183.sslip.io', '138.2.233.183');
  assert.match(c, /^app\.brightolio\.com \{/m, 'the main domain is a site with the app');
  assert.match(c, /^138-2-233-183\.sslip\.io \{/m);
  assert.match(c, /redir @visitor https:\/\/app\.brightolio\.com\{uri\} permanent/, 'GET and HEAD go to the main address with the same path');
  assert.match(c, /method GET HEAD/);
  // Health, internal calls, webhooks, sign-in returns and the load test stay where they are.
  for (const p of ['/healthz', '/readyz', '/internal/*', '/hook/*', '/webhooks/*', '/api/webhooks/*', '/oauth/*']) assert.ok(c.includes(p), p);
  assert.match(c, /not header x-qp-loadtest \*/);
  // Render passes the main address on with its edge secret and the server's own host name: those are never redirected (that would loop).
  assert.match(c, /not header x-edge-secret \*/);
  assert.match(c, /^http:\/\/138\.2\.233\.183 \{\n\tredir https:\/\/app\.brightolio\.com\{uri\} permanent/m, 'the bare IP redirects over HTTP');
  assert.equal((c.match(/import \/etc\/caddy\/brightolio-app\.caddy/g) || []).length, 2, 'both names run the same routing');
});
test('the Caddy site without an IP has no IP block', () => {
  assert.doesNotMatch(site('app.brightolio.com', 'x-y.sslip.io', ''), /^http:\/\//m);
});
test('setup.sh and migrate.sh write the same Caddy site function (they must not drift)', () => {
  assert.equal(fnOf('deploy/vm/setup.sh'), fnOf('deploy/vm/migrate.sh'));
});
test('the main domain is a setting: setup.sh writes APP_DOMAIN and PUBLIC_URL from it, and migrate.sh reads it', () => {
  const s = read('deploy/vm/setup.sh');
  assert.match(s, /APP_DOMAIN="\$\{APP_DOMAIN:-app\.brightolio\.com\}"/);
  assert.match(s, /PUBLIC_URL=https:\/\/\$APP_DOMAIN/);
  assert.match(s, /PUBLIC_ORIGINS=https:\/\/\$APP_DOMAIN,https:\/\/aryebleich\.github\.io/, 'the GitHub Pages origin is kept');
  assert.match(read('deploy/vm/migrate.sh'), /app_domain=\$\(val APP_DOMAIN\); app_domain=\$\{app_domain:-app\.brightolio\.com\}/);
});

// ---------- the Render forwarder ----------
const { redirectHandler, setTrusted, retryPage, FALLBACK } = await import('../src/render-redirect.js');
const call = (url, host = 'app.brightolio.com') => { const out = {}; redirectHandler({ url, headers: { host } }, { writeHead: (s, h) => { out.status = s; out.headers = h; }, end: b => { out.body = b; } }); return out; };
before(() => { setTrusted(false); });
after(() => { setTrusted(false); });

test('Render, not yet passing the main address on: visitors get the retry page, never the server\'s own address', () => {
  for (const host of ['app.brightolio.com', '138-2-233-183.sslip.io', 'something-else.example']) {
    const r = call('/app?x=1', host);
    assert.equal(r.status, 503, host);
    assert.equal(r.headers.location, undefined, host);
    assert.match(r.body, /Taking longer than usual, trying again/);
    assert.doesNotMatch(r.body, /sslip/i, 'the retry page never names the server address');
  }
});
test('the forwarder\'s retry page keeps the path and refers to the main address only', () => {
  assert.match(retryPage('https://app.brightolio.com/app?x=1&y=2'), /href="https:\/\/app\.brightolio\.com\/app\?x=1&amp;y=2"/);
  assert.doesNotMatch(retryPage('https://app.brightolio.com/'), /sslip/);
});
test('the Render address still goes to the main address (a visitor who types it)', () => {
  const r = call('/app?x=1', 'quantpocket.onrender.com');
  assert.equal(r.status, 301); assert.equal(r.headers.location, 'https://app.brightolio.com/app?x=1');
});
test('the server address is only used server to server, never as a redirect target', () => {
  const src = read('src/render-redirect.js');
  const locations = [...src.matchAll(/location:\s*([^,}]+)/g)].map(m => m[1]);
  for (const l of locations) assert.doesNotMatch(l, /FALLBACK/, `a redirect to FALLBACK: ${l}`);
  assert.ok(FALLBACK().startsWith('https://'));
});

// ---------- the Oracle server's own one-address redirect ----------
test('the server redirects GET and HEAD on its other names; health, internal, webhooks and POST are not redirected', async () => {
  const keep = process.env.PUBLIC_URL; process.env.PUBLIC_URL = 'https://app.brightolio.com';
  const S = await import('../server.js');
  const { serve } = await import('./client.js');
  const srv = await serve();
  const http = await import('node:http');
  const u = new URL(srv.base);
  const req = (p, host, method = 'GET') => new Promise((ok, no) => {
    const r = http.request({ host: u.hostname, port: u.port, path: p, method, headers: { host, 'content-type': 'application/json' } }, res => { res.resume(); ok({ status: res.statusCode, location: res.headers.location }); });
    r.on('error', no); if (method !== 'GET') r.write('{}'); r.end();
  });
  try {
    S.setMainReaches(true);
    const g = await req('/app?x=1', '138-2-233-183.sslip.io');
    assert.equal(g.status, 301); assert.equal(g.location, 'https://app.brightolio.com/app?x=1');
    const h = await req('/app', '138.2.233.183', 'HEAD');
    assert.equal(h.status, 301); assert.equal(h.location, 'https://app.brightolio.com/app');
    for (const p of ['/healthz', '/internal/maintenance', '/hook/x', '/webhooks/stripe', '/oauth/alpaca/callback']) {
      assert.notEqual((await req(p, '138-2-233-183.sslip.io')).status, 301, p);
    }
    assert.notEqual((await req('/api/auth/login', '138-2-233-183.sslip.io', 'POST')).status, 301, 'a POST is never turned into a GET');
    assert.notEqual((await req('/app', 'app.brightolio.com')).status, 301, 'the main address itself is not redirected');
    S.setMainReaches(false);
    assert.notEqual((await req('/app?x=1', '138-2-233-183.sslip.io')).status, 301, 'no redirect while the main address does not reach this app (no loop)');
  } finally {
    S.setMainReaches(false); srv.close();
    if (keep === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = keep;
  }
});

// ---------- nothing names the server's own address as the site ----------
test('no file outside the history names the server\'s own address as the site address', () => {
  // Places where the server\'s own address is used on purpose: the direct checks, the forwarder\'s target,
  // the setup and the diagnosis scripts, and the notes about them.
  const allowed = new Set(['src/render-redirect.js', 'src/edgesetup.js', 'server.js', 'render.yaml', 'deploy/vm/setup.sh', 'deploy/vm/migrate.sh',
    'deploy/vm/oracle-create.sh', 'edge/README.md', 'test/one-address.test.js', 'test/oracle.test.js', 'test/edge.test.js', 'public/pages/admin-ops.js',
    '.github/workflows/oracle.yml', '.github/workflows/oracle-migrate.yml', '.github/workflows/load-test.yml', '.github/workflows/live-mobile.yml',
    '.github/workflows/edge-check.yml', '.github/workflows/signin-check.yml', '.github/workflows/deploy.yml', '.github/workflows/scheduler.yml',
    '.github/workflows/pages.yml', '.github/workflows/android.yml', '.github/workflows/post-deploy.yml']);
  const history = /^(docs\/|CHANGELOG_AI\.md|DECISIONS\.md|MIGRATION_ORACLE\.md|README\.md|e2e-output\/|test\/golden\/)/;
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(f => /\.(js|mjs|json|html|yml|yaml|sh|md|kt|xml|caddy|example)$|^\.env/.test(f));
  const bad = [];
  for (const f of files) {
    if (history.test(f) || allowed.has(f)) continue;
    const src = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '';
    src.split('\n').forEach((line, i) => { if (/sslip/.test(line) && !/archive|history|direct|own address/i.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(bad, [], 'lines naming the server address outside the allowed places');
});
test('the Android app talks to the main address', () => {
  assert.match(read('android/app/build.gradle.kts'), /appHost|app\.brightolio\.com/);
  assert.match(read('android/app/build.gradle.kts'), /app\.brightolio\.com/);
});
