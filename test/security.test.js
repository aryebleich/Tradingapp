// The October 2026 advisories (Node.js TLS and Brotli fixes, eMudhra certificates) and the guards that
// keep them from coming back: the patched-Node.js floor everywhere, no compressed request bodies,
// and no way to weaken HTTPS from Admin → Keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { nodeStatus, enginesRange, floors } from '../src/runtime-check.js';
import { serve } from './client.js';

test('Node.js floor: patched releases pass, older ones and odd lines do not', () => {
  const f = { 22: '22.23.4', 24: '24.22.1', 26: '26.12.1' };
  for (const [v, ok] of [['v22.22.0', false], ['v22.23.3', false], ['v22.23.4', true], ['v22.30.0', true], ['v23.9.0', false], ['v24.22.0', false], ['v24.22.1', true], ['v26.12.1', true], ['v28.1.0', true], ['v20.19.5', false]])
    assert.equal(nodeStatus(v, f).ok, ok, v);
  assert.equal(nodeStatus('v22.22.0', f).min, '22.23.4');
});

test('engines, Render, Docker and CI all follow the floor', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.engines.node, enginesRange(floors()));
  assert.match(fs.readFileSync('.npmrc', 'utf8'), /^engine-strict=true$/m);
  assert.equal(fs.readFileSync('.node-version', 'utf8').trim(), '22');
  assert.match(fs.readFileSync('render.yaml', 'utf8'), /key: NODE_VERSION, value: "22"/);
  const docker = fs.readFileSync('Dockerfile', 'utf8');
  assert.match(docker, /ca-certificates/); assert.match(docker, /nodeStatus\(\)/);
  for (const f of fs.readdirSync('.github/workflows')) {
    const y = fs.readFileSync('.github/workflows/' + f, 'utf8');
    if (y.includes('setup-node')) { assert.match(y, /node-version-file: \.node-version/, f); assert.match(y, /check-latest: true/, f); }
  }
  assert.ok(fs.existsSync('.github/dependabot.yml'));
});

test('compressed request bodies are refused; HTTPS cannot be weakened from Admin → Keys', async () => {
  const s = await serve();
  try {
    const body = zlib.brotliCompressSync(Buffer.from(JSON.stringify({ email: 'x@y.co', password: 'Str0ngPassword' })));
    const r = await fetch(s.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'br', 'X-Requested-With': 'qp' }, body });
    assert.equal(r.status, 415);
    const g = await fetch(s.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'X-Requested-With': 'qp' }, body: zlib.gzipSync('{}') });
    assert.equal(g.status, 415);
    const owner = s.client();
    await owner('/auth/register', { email: 'site-owner@example.com', password: 'Str0ngPassword' });
    for (const k of ['NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'SSL_CERT_FILE', 'NODE_VERSION'])
      assert.equal((await owner('/admin/site/env', { key: k, value: '0' }, 'PUT')).status, 400, k);
    assert.equal((await owner('/admin/site/env/import', { text: 'NODE_TLS_REJECT_UNAUTHORIZED=0\nSAFE_NAME=1' })).status, 400);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
    const setup = (await owner('/admin/setup')).body;
    assert.ok(setup.items.some(x => x.name.startsWith('Node.js ')));
  } finally { s.close(); }
});

test('workflows use actions that run on Node.js 24 and a pinned Ubuntu', () => {
  // The first major of each action that runs on Node.js 24 (Node.js 20 is retired on GitHub runners).
  const MIN = { checkout: 5, 'setup-node': 5, 'setup-python': 6, cache: 5, 'upload-artifact': 6, 'configure-pages': 6, 'upload-pages-artifact': 4, 'deploy-pages': 5 };
  for (const f of fs.readdirSync('.github/workflows')) {
    const y = fs.readFileSync('.github/workflows/' + f, 'utf8');
    assert.doesNotMatch(y, /runs-on: ubuntu-latest/, `${f}: pin the runner (ubuntu-24.04)`);
    for (const [, name, v] of y.matchAll(/uses: actions\/([a-z-]+)@v(\d+)/g)) if (MIN[name]) assert.ok(+v >= MIN[name], `${f}: actions/${name}@v${v} still runs on Node.js 20`);
  }
});
