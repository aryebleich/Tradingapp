// The post-deploy smoke test (scripts/smoke.mjs) against a local server: it passes on a healthy site and
// fails when a disclosure is missing or the sign-in route is down.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { serve } from './client.js';
import { smoke } from '../scripts/smoke.mjs';

const S = await serve();
after(() => S.close());

test('smoke passes on a healthy site', async () => {
  const r = await smoke(S.base);
  const bad = r.filter(x => !x.ok);
  assert.deepEqual(bad, [], JSON.stringify(bad));
  assert.ok(r.length >= 14);
});

test('smoke fails when the page loses its risk text, and when the site is down', async () => {
  const srv = http.createServer(async (req, res) => {
    const up = await fetch(S.base + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] || '', 'x-requested-with': 'qp' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(ok => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => ok(b)); }) });
    let body = await up.text();
    if (req.url === '/app') body = body.replace('Trading involves risk of loss', 'Trading is fine');
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'text/html' }); res.end(body);
  }).listen(0);
  try {
    const r = await smoke(`http://127.0.0.1:${srv.address().port}`);
    const bad = r.filter(x => !x.ok);
    assert.deepEqual(bad.map(x => x.name), ['app shell: footer disclosures and layout']);
    assert.match(bad[0].msg, /Trading involves risk of loss/);
  } finally { srv.close(); }
  const down = await smoke('http://127.0.0.1:1', { timeoutMs: 2000 });
  assert.ok(down.filter(x => !x.ok).length >= 10);
});
