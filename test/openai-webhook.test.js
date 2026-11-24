// The OpenAI webhook receiver (Part 3): a valid signature is accepted, a bad or old one is refused
// with 400, a repeated event id is ignored, and response.completed finishes the waiting job.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

const SECRET = 'whsec_' + Buffer.from('webhook-test-secret-material-0001').toString('base64');
const sign = (id, ts, raw, secret = SECRET) => 'v1,' + crypto.createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${ts}.${raw}`).digest('base64');
const nowS = () => Math.floor(Date.now() / 1000);
const evBody = (id, type = 'response.completed', resp = 'resp_T0') => JSON.stringify({ id, object: 'event', type, created_at: nowS(), data: { id: resp, type: 'response' } });
const headersFor = (id, raw, { ts = nowS(), sig } = {}) => ({ 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': sig ?? sign(id, ts, raw) });

let W, K, DB, s, fake, fakeBase;
before(async () => {
  // A fake OpenAI API: the finished response and the failed one for the job tests.
  fake = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/responses/resp_T1') return res.end(JSON.stringify({ id: 'resp_T1', status: 'completed', output_text: 'Hello from the background' }));
    if (req.url === '/v1/responses/resp_T2') return res.end(JSON.stringify({ id: 'resp_T2', status: 'failed', error: { message: 'The model ran out of time' } }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${fake.address().port}/v1`;
  process.env.OPENAI_BASE_URL = fakeBase;
  W = await import('../src/openai-webhook.js');
  K = await import('../src/keystore.js');
  DB = await import('../src/db.js');
  await K.initKeystore({ every: 0 }); // creates the secrets table, as the server does at start
  await K.setSecret('OPENAI_WEBHOOK_SECRET', SECRET);
  await K.setSecret('OPENAI_API_KEY', 'sk-proj-testonlyNotARealKey1234567890');
  const app = await import('../server.js');
  s = await new Promise(r => { const srv = app.app.listen(0, () => r(srv)); });
});
after(async () => {
  s?.close(); fake?.close();
  delete process.env.OPENAI_BASE_URL;
  await K.removeSecret('OPENAI_WEBHOOK_SECRET').catch(() => {});
  await K.removeSecret('OPENAI_API_KEY').catch(() => {});
});

test('a valid signature is accepted; a bad signature, an old event and missing headers are refused', () => {
  const raw = evBody('evt_v1');
  const ts = nowS();
  assert.equal(W.verifyStandardWebhook({ raw, headers: headersFor('evt_v1', raw, { ts }), secret: SECRET }).ok, true);
  assert.equal(W.verifyStandardWebhook({ raw: raw + ' ', headers: headersFor('evt_v1', raw, { ts }), secret: SECRET }).ok, false, 'the body is signed exactly');
  assert.equal(W.verifyStandardWebhook({ raw, headers: headersFor('evt_v1', raw, { ts, sig: 'v1,AAAA' }), secret: SECRET }).ok, false);
  const old = nowS() - 600;
  const r = W.verifyStandardWebhook({ raw, headers: headersFor('evt_v1', raw, { ts: old }), secret: SECRET });
  assert.equal(r.ok, false); assert.match(r.reason, /too old/);
  assert.equal(W.verifyStandardWebhook({ raw, headers: {}, secret: SECRET }).ok, false);
  assert.equal(W.verifyStandardWebhook({ raw, headers: headersFor('evt_v1', raw, { ts }), secret: '' }).ok, false, 'no secret, no acceptance');
});

test('a rotated key (two signatures, one valid) is accepted', () => {
  const raw = evBody('evt_rot'), ts = nowS();
  const sig = `v1,AAAAold ${sign('evt_rot', ts, raw)}`;
  assert.equal(W.verifyStandardWebhook({ raw, headers: headersFor('evt_rot', raw, { ts, sig }), secret: SECRET }).ok, true);
});

test('the route: valid is answered 200; a bad signature gets 400; a repeated event id is ignored', async () => {
  const url = s.address().port;
  const post = (raw, headers) => fetch(`http://127.0.0.1:${url}/api/webhooks/openai`, { method: 'POST', headers, body: raw });
  const raw = evBody('evt_route_1', 'response.completed', 'resp_none');
  const ok = await post(raw, headersFor('evt_route_1', raw));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).received, true);
  const again = await post(raw, headersFor('evt_route_1', raw));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true, 'a repeat is not handled twice');
  const bad = await post(raw, headersFor('evt_route_2', raw, { sig: 'v1,AAAAbad' }));
  assert.equal(bad.status, 400);
  const oldRaw = evBody('evt_route_3');
  const old = await post(oldRaw, headersFor('evt_route_3', oldRaw, { ts: nowS() - 900 }));
  assert.equal(old.status, 400);
});

test('response.completed finishes the waiting job with the answer', async () => {
  await DB.run("INSERT INTO openai_jobs (kind, openai_id, status, notify, created_at, updated_at) VALUES ('response', 'resp_T1', 'running', 0, ?, ?)", Date.now(), Date.now());
  const ev = { id: 'evt_T1', type: 'response.completed', data: { id: 'resp_T1' } };
  assert.equal(await W.receive(ev), 'accepted');
  assert.equal(await W.processEvent(ev), 'done');
  const job = await DB.one("SELECT status, result FROM openai_jobs WHERE openai_id = 'resp_T1'");
  assert.equal(job.status, 'done');
  assert.equal(job.result, 'Hello from the background');
  const evRow = await DB.one("SELECT status FROM openai_events WHERE id = 'evt_T1'");
  assert.equal(evRow.status, 'done');
});

test('response.failed marks the job failed with the reason, so the user can retry', async () => {
  await DB.run("INSERT INTO openai_jobs (kind, openai_id, status, notify, created_at, updated_at) VALUES ('response', 'resp_T2', 'running', 0, ?, ?)", Date.now(), Date.now());
  const ev = { id: 'evt_T2', type: 'response.failed', data: { id: 'resp_T2' } };
  assert.equal(await W.receive(ev), 'accepted');
  assert.equal(await W.processEvent(ev), 'failed');
  const job = await DB.one("SELECT status, error FROM openai_jobs WHERE openai_id = 'resp_T2'");
  assert.equal(job.status, 'failed');
  assert.match(job.error, /ran out of time/);
});

test('a duplicate event id is recorded once', async () => {
  const ev = { id: 'evt_dup', type: 'response.cancelled', data: { id: 'resp_none' } };
  assert.equal(await W.receive(ev), 'accepted');
  assert.equal(await W.receive(ev), 'duplicate');
});
