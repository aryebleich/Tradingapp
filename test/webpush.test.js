// Web Push (src/webpush.js, queue row APP-02): the message is encrypted so only the browser can read it
// (RFC 8291, decrypted here as a browser would), every request carries a valid VAPID signature (RFC 8292),
// a member opts in per device and per kind, and a subscription the push service says is gone is removed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { serve } from './client.js';

const W = await import('../src/webpush.js');
const { one } = await import('../src/db.js');
let srv;
before(async () => { srv = await serve(); });
after(() => srv?.close());

const b64u = b => Buffer.from(b).toString('base64url');
// A browser: its P-256 key pair and auth secret, like PushManager.subscribe gives.
function browser() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}
// RFC 8291 decryption, as the browser does it.
function decrypt(body, br) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = br.ecdh.computeSecret(asPub), ua = br.ecdh.getPublicKey();
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, br.auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'the last-record delimiter');
  return plain.subarray(0, plain.length - 1).toString();
}

test('push: only the browser can read the message (RFC 8291 aes128gcm)', () => {
  const br = browser();
  const body = W.encrypt('{"title":"Hi"}', br.keys.p256dh, br.keys.auth);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, br), '{"title":"Hi"}');
  const other = browser();
  assert.throws(() => decrypt(body, other), 'another browser cannot read it');
  assert.throws(() => W.encrypt('x', 'bad', 'bad'), /Not a push subscription/);
});

test('push: each request is signed with the site key (VAPID), valid for this push service only', async () => {
  const keys = await W.vapidKeys();
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
  assert.deepEqual(await W.vapidKeys(), keys, 'made once, then kept');
  const h = W.vapidAuth('https://push.example.net/send/abc', keys);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.equal(k, keys.publicKey);
  const [head, body, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claims.aud, 'https://push.example.net'); assert.ok(claims.exp > Date.now() / 1000);
  const p = Buffer.from(keys.publicKey, 'base64url');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${body}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

test('push: opt-in per device and kind; sent encrypted; a gone subscription is removed', async () => {
  const c = srv.client(); const u = await c.signup('push-member@example.com');
  const br = browser();
  assert.equal((await c('/push')).status, 200);
  assert.equal((await c('/push/subscribe', { subscription: { endpoint: 'http://insecure.example/x', keys: br.keys } })).status, 400, 'https endpoints only');
  const endpoint = 'https://push.example.net/send/' + crypto.randomBytes(6).toString('hex');
  const r = await c('/push/subscribe', { subscription: { endpoint, keys: br.keys }, kinds: ['alerts'] });
  assert.equal(r.status, 200); assert.deepEqual(r.body.devices[0].kinds, ['alerts']);
  const sent = [];
  const fetchImpl = async (url, o) => { sent.push({ url, o }); return { ok: true, status: 201 }; };
  assert.deepEqual(await W.pushToUser(u.id, { body: 'AAPL crossed $200', kind: 'orders' }, { fetchImpl }), { sent: 0 }, 'kinds not ticked are not sent');
  assert.deepEqual(await W.pushToUser(u.id, { body: 'AAPL crossed $200', url: '/app#/watchlists' }, { fetchImpl }), { sent: 1 });
  assert.equal(sent[0].url, endpoint); assert.equal(sent[0].o.headers['Content-Encoding'], 'aes128gcm'); assert.match(sent[0].o.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(sent[0].o.body, br)), { title: 'Brightolio', body: 'AAPL crossed $200', url: '/app#/watchlists' });
  // An outside address is never put in a notification link.
  sent.length = 0; await W.pushToUser(u.id, { body: 'x', url: 'https://evil.example' }, { fetchImpl });
  assert.equal(JSON.parse(decrypt(sent[0].o.body, br)).url, '/app');
  // The push service says the subscription is gone: it is removed.
  await W.pushToUser(u.id, { body: 'x' }, { fetchImpl: async () => ({ ok: false, status: 410 }) });
  assert.equal(await one('SELECT 1 FROM push_subs WHERE endpoint = ?', endpoint), undefined);
  assert.equal((await c('/push')).body.devices.length, 0);
});
