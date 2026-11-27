// Web Push for the installable app (registry AL-12, AP-02..AP-04; queue row APP-02): alerts reach a
// member's phone or computer even when Brightolio isn't open. Built on node:crypto, no dependency:
//   - VAPID (RFC 8292): the server signs each request with its own P-256 key. The key pair is made once
//     and kept, encrypted, in the key store (Admin → Keys: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
//   - Message encryption (RFC 8291, aes128gcm): only the member's browser can read the text; the push
//     service (Google, Apple, Mozilla) only passes it on.
// Push is opt-in per device (Settings → Notifications) and per kind of alert. It is free: no credits.
// A subscription the push service says is gone (404 or 410) is removed.
import crypto from 'node:crypto';
import { run, one, all, now } from './db.js';
import { secret, setSecret } from './keystore.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s || ''), 'base64url');
export const KINDS = { alerts: 'Price and scanner alerts', orders: 'Order fills and rejections', reports: 'Daily and weekly reports' };

// The site's VAPID key pair, made once. The private key never leaves the server.
export async function vapidKeys() {
  let pub = secret('VAPID_PUBLIC_KEY').trim(), priv = secret('VAPID_PRIVATE_KEY').trim();
  if (!pub || !priv) {
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    pub = b64u(ecdh.getPublicKey()); priv = b64u(ecdh.getPrivateKey());
    await setSecret('VAPID_PRIVATE_KEY', priv); await setSecret('VAPID_PUBLIC_KEY', pub);
  }
  return { publicKey: pub, privateKey: priv };
}

// A private key object from the raw public point and private scalar (JWK, so no PEM juggling).
const signingKey = (pub, priv) => {
  const p = unb64u(pub);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)), d: priv }, format: 'jwk' });
};

// "vapid t=<JWT>, k=<public key>" for one push service (RFC 8292). The JWT is valid for 12 hours.
export function vapidAuth(endpoint, keys, subject = process.env.PUBLIC_URL || 'https://app.brightolio.com') {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: /^https:|^mailto:/.test(subject) ? subject : 'https://app.brightolio.com' }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: signingKey(keys.publicKey, keys.privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

// RFC 8291: the payload encrypted for one browser (its p256dh key and auth secret), one record.
export function encrypt(payload, p256dh, auth, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const ua = unb64u(p256dh), authSecret = unb64u(auth);
  if (ua.length !== 65 || authSecret.length < 16) throw Object.assign(new Error('Not a push subscription'), { status: 400 });
  const as = ecdh || crypto.createECDH('prime256v1'); if (!ecdh) as.generateKeys();
  const asPub = as.getPublicKey(), shared = as.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

// A browser's subscription (from PushManager.subscribe) for this member. Only https endpoints.
export async function subscribe(userId, sub, kinds = Object.keys(KINDS), ua = '') {
  const endpoint = String(sub?.endpoint || ''), p256dh = String(sub?.keys?.p256dh || ''), auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\/[^\s]{8,1000}$/.test(endpoint) || unb64u(p256dh).length !== 65 || unb64u(auth).length < 16) throw Object.assign(new Error('That is not a push subscription from a browser.'), { status: 400 });
  const k = (Array.isArray(kinds) ? kinds : []).filter(x => Object.hasOwn(KINDS, x)).join(',');
  await run(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, kinds, ua, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, kinds = excluded.kinds, ua = excluded.ua`,
  userId, endpoint, p256dh, auth, k, String(ua).slice(0, 120), now());
  return devices(userId);
}
export const unsubscribe = (userId, endpoint) => run('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?', userId, String(endpoint || ''));
export async function devices(userId) {
  return (await all('SELECT id, ua, kinds, created_at, last_ok_at FROM push_subs WHERE user_id = ? ORDER BY id', userId))
    .map(d => ({ id: d.id, device: d.ua || 'A browser', kinds: String(d.kinds || '').split(',').filter(Boolean), since: d.created_at, lastSent: d.last_ok_at }));
}

// Sends one notification to every device of the member that opted in to this kind. Never throws.
export async function pushToUser(userId, { title = 'Brightolio', body = '', url = '/app', kind = 'alerts' } = {}, { fetchImpl = fetch } = {}) {
  const subs = (await all('SELECT * FROM push_subs WHERE user_id = ?', userId).catch(() => [])).filter(s => String(s.kinds || '').split(',').includes(kind));
  if (!subs.length) return { sent: 0 };
  const keys = await vapidKeys(), payload = JSON.stringify({ title: String(title).slice(0, 80), body: String(body).slice(0, 300), url: /^\/[^/]/.test(url) ? url : '/app' });
  let sent = 0;
  for (const s of subs) {
    try {
      const r = await fetchImpl(s.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuth(s.endpoint, keys) }, body: encrypt(payload, s.p256dh, s.auth), signal: AbortSignal.timeout(8000) });
      if (r.status === 404 || r.status === 410) await run('DELETE FROM push_subs WHERE id = ?', s.id);
      else if (r.ok) { sent++; await run('UPDATE push_subs SET last_ok_at = ? WHERE id = ?', now(), s.id); }
      else console.warn(JSON.stringify({ src: 'push', event: 'push_failed', status: r.status, userId }));
    } catch (e) { console.warn(JSON.stringify({ src: 'push', event: 'push_failed', reason: e.name, userId })); }
  }
  return { sent };
}
export const hasPush = async userId => !!(await one('SELECT 1 FROM push_subs WHERE user_id = ? LIMIT 1', userId).catch(() => null));
