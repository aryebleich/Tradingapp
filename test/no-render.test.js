// Render is gone: nothing in the app, its pages or the workflows uses Render as a host; jobs run only on
// the server that is named and configured as the active one; and in production the app will not start
// without its one address (PUBLIC_URL).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Kept on purpose until app.brightolio.com points straight at the Oracle server (issue #55, the
// workflow dns-cutover.yml): Render deploys every push, and while the domain still points at it,
// this file is what passes visitors on to Oracle. It is deleted with render.yaml after the cutover.
const UNTIL_CUTOVER = new Set(['src/render-redirect.js']);
// Names Render only to check that its header is gone from the answers.
const CHECKS_FOR_RENDER = new Set(['.github/workflows/dns-cutover.yml']);

test('nothing in src/, server.js, public/ or .github/ uses Render as a host', () => {
  const files = execFileSync('git', ['ls-files', 'src', 'server.js', 'public', '.github', 'cluster.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter(f => /\.(js|mjs|json|html|yml|yaml|css)$/.test(f));
  const bad = [];
  for (const f of files) {
    if (UNTIL_CUTOVER.has(f)) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/onrender|RENDER_|render\.com|process\.env\.RENDER\b/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      if (/\bRender\b/.test(line) && !CHECKS_FOR_RENDER.has(f)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('the Render forwarder is the only Render file left, and the app does not load it', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.doesNotMatch(server, /render-redirect/, 'server.js never imports the forwarder');
  assert.equal(fs.existsSync(path.join(ROOT, '.github/workflows/render-redirect.yml')), false);
  const keys = fs.readFileSync(path.join(ROOT, 'src/keys-catalog.js'), 'utf8');
  assert.doesNotMatch(keys, /RENDER_API_KEY|RENDER_SERVICE_ID/);
});

// ---------- which server runs the jobs ----------
const keepEnv = { NODE_ENV: process.env.NODE_ENV, HOST_ID: process.env.HOST_ID, STANDBY: process.env.STANDBY };
const restore = () => { for (const [k, v] of Object.entries(keepEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
after(restore);

test('in production a server without HOST_ID never runs jobs; with nothing configured, only the Oracle server does', async () => {
  const H = await import('../src/hosting.js'), S = await import('../src/site.js');
  await S.siteSet('hosting', { servers: [], active: null, keepWarm: true });
  try {
    process.env.NODE_ENV = 'production'; delete process.env.STANDBY;
    delete process.env.HOST_ID;
    assert.equal(H.isActiveHost(), false, 'no HOST_ID in production: never active');
    assert.equal(H.thisHost(), 'unknown');
    process.env.HOST_ID = 'oracle';
    assert.equal(H.isActiveHost(), true, 'nothing configured: the Oracle server is active');
    process.env.HOST_ID = 'spare';
    assert.equal(H.isActiveHost(), false, 'nothing configured: any other server waits');
  } finally { restore(); }
});

test('with servers configured, only the configured active server runs jobs', async () => {
  const H = await import('../src/hosting.js'), S = await import('../src/site.js');
  await S.siteSet('hosting', { servers: [{ id: 'oracle', kind: 'oracle-vm', url: 'https://1-2-3-4.sslip.io' }, { id: 'spare', kind: 'custom', url: 'https://spare.example.net' }], active: 'spare', keepWarm: true });
  try {
    process.env.NODE_ENV = 'production'; delete process.env.STANDBY;
    process.env.HOST_ID = 'spare'; assert.equal(H.isActiveHost(), true);
    process.env.HOST_ID = 'oracle'; assert.equal(H.isActiveHost(), false, 'not the configured one');
    process.env.STANDBY = '1'; process.env.HOST_ID = 'spare'; assert.equal(H.isActiveHost(), false, 'standby always wins');
  } finally { restore(); await S.siteSet('hosting', { servers: [], active: null, keepWarm: true }); }
});

test('in development the one process runs everything when nothing is configured', async () => {
  const H = await import('../src/hosting.js'), S = await import('../src/site.js');
  await S.siteSet('hosting', { servers: [], active: null, keepWarm: true });
  try {
    process.env.NODE_ENV = 'test'; delete process.env.HOST_ID; delete process.env.STANDBY;
    assert.equal(H.thisHost(), 'local');
    assert.equal(H.isActiveHost(), true);
  } finally { restore(); }
});

// ---------- the one address is required in production ----------
test('PUBLIC_URL is required in production, and must be the https address of the site', async () => {
  const { missingPublicUrl } = await import('../src/origin.js');
  assert.match(missingPublicUrl({ NODE_ENV: 'production' }), /PUBLIC_URL is not set/);
  assert.match(missingPublicUrl({ NODE_ENV: 'production', PUBLIC_URL: 'http://app.brightolio.com' }), /https address/);
  assert.match(missingPublicUrl({ NODE_ENV: 'production', PUBLIC_URL: 'https://app.brightolio.com/some/path' }), /https address/);
  assert.equal(missingPublicUrl({ NODE_ENV: 'production', PUBLIC_URL: 'https://app.brightolio.com' }), null);
  assert.equal(missingPublicUrl({ NODE_ENV: 'test' }), null, 'tests and development need no address');
});

test('the app refuses to start in production without PUBLIC_URL, and says why', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'no-public-url-'));
  const env = { ...process.env, NODE_ENV: 'production', DB_FILE: path.join(tmp, 'x.db'), PORT: '0', QP_START: '1' };
  delete env.PUBLIC_URL;
  const r = spawnSync(process.execPath, ['server.js'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, `exit status ${r.status}; stderr: ${String(r.stderr).slice(-300)}`);
  assert.match(r.stderr, /PUBLIC_URL is not set/);
});
