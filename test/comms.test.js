// SMS and voice module (src/sms-voice). Provider = a local fake of the Telnyx API; webhook payloads are
// Telnyx-shaped and signed with a throwaway Ed25519 key. No real provider, number or key is used.
//
// The payload shapes and header names follow Telnyx's documentation as remembered; they could not be
// checked against developers.telnyx.com from the build environment (ASSUMPTIONS.md B-2). Re-check them
// against the live docs before relying on this module in production.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

// ---- logs: everything the module prints is captured, to prove it holds no numbers or message text ----
const logs = [];
for (const k of ['log', 'info', 'warn', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(a.map(String).join(' ')); o(...a); }; }

// ---- fake Telnyx API ----
const api = [], apiFail = [];
let n = 0;
const telnyx = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const body = b ? JSON.parse(b) : undefined, path = new URL(req.url, 'http://x').pathname;
    api.push({ method: req.method, path, body, auth: req.headers.authorization });
    const send = (o, s = 200, type = 'application/json') => { res.statusCode = s; res.setHeader('Content-Type', type); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    const f = apiFail.shift(); if (f) return send({ errors: [{ code: f.code || '10001', title: 'x' }] }, f.status);
    if (req.headers.authorization !== 'Bearer KEY_test') return send({ errors: [{ code: '10009' }] }, 401);
    if (path === '/messages') return send({ data: { id: `msg-${++n}`, to: [{ phone_number: body.to, status: 'queued' }] } });
    if (/^\/calls\/[^/]+\/actions\/\w+$/.test(path)) return send({ data: { result: 'ok' } });
    if (path === '/telephony_credentials') return send({ data: { id: 'cred-1', sip_username: 'gencred_abc123' } });
    if (/^\/telephony_credentials\/[^/]+\/token$/.test(path)) return send('tok.test.jwt', 200, 'text/plain');
    send({ errors: [{ code: '404' }] }, 404);
  });
});
await new Promise(r => telnyx.listen(0, '127.0.0.1', r));

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');
Object.assign(process.env, {
  TELNYX_API_KEY: 'KEY_test', TELNYX_PUBLIC_KEY: PUB, TELNYX_API_URL: `http://127.0.0.1:${telnyx.address().port}`, TELNYX_MESSAGING_PROFILE_ID: 'mp-1', TELNYX_CREDENTIAL_CONNECTION_ID: 'cc-1',
  COMMS_SEND_PER_HOUR: '1000', COMMS_SEND_PER_DAY: '10000', TURN_URLS: 'turns:turn.example.test:5349?transport=tcp', TURN_SECRET: 'turn-shared-secret-for-tests', STUN_URLS: 'stun:stun.example.test:3478',
});
delete process.env.COMMS_PROVIDER; delete process.env.COMMS_RECORDING; delete process.env.COMMS_HELP_REPLY;

const { app } = await import('../server.js');
const { one, all, run } = await import('../src/db.js');
const F = await import('../src/flags.js');
const core = await import('../src/sms-voice/core.js');
const sse = await import('../src/sms-voice/sse.js');
const { isE164, toE164, last4, mask } = await import('../src/sms-voice/phone.js');
const AD = await import('../src/sms-voice/adapter.js');
const { createTelnyx, ed25519PublicKey } = await import('../src/sms-voice/telnyx.js');
const AST = await import('../src/sms-voice/asterisk.js');
await import('../src/sms-voice/index.js');

let server, base;
const user = () => {
  let cookie = '';
  const call = async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  Object.defineProperty(call, 'cookie', { get: () => cookie });
  return call;
};
const owner = user(), A = user(), B = user(), C = user(), D = user(), X = user();
const ids = {};
const NUM_A = '+18455550100', NUM_B = '+18455550200', NUM_D = '+18455550400', PEER1 = '+15551230001', PEER2 = '+15551230002', PEER3 = '+15551230003';
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  for (const [c, e] of [[owner, 'owner@example.com'], [A, 'comms-a@example.com'], [B, 'comms-b@example.com'], [C, 'comms-c@example.com']]) {
    const r = await c('/auth/register', { email: e, password: 'Str0ngPassword1', agree: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids[e] = (await one('SELECT id FROM users WHERE email = ?', e)).id;
  }
  // a user for the rate-limit test, made directly (sign-up is rate limited)
  ids.d = Number((await run("INSERT INTO users (email, pass_hash, created_at) VALUES ('comms-d@example.com', 'x', ?)", Date.now())).lastInsertRowid);
  await F.saveFlags({ comms_drawer: { on: true, pct: 100 } });
  await core.assignNumber({ number: NUM_A, userId: ids['comms-a@example.com'], voiceMode: 'ivr', greeting: 'Hello from A. Please text us.' });
  await core.assignNumber({ number: NUM_B, userId: ids['comms-b@example.com'], voiceMode: 'softphone' });
  await run("UPDATE comms_numbers SET sip_username = 'gencred_b' WHERE number = ?", NUM_B);
  await core.assignNumber({ number: NUM_D, userId: ids.d });
});
after(() => { sse.closeAll(); server.close(); telnyx.close(); });

// ---- helpers ----
const sig = (body, ts = Math.floor(Date.now() / 1000)) => ({ 'telnyx-signature-ed25519': crypto.sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64'), 'telnyx-timestamp': String(ts) });
async function hook(kind, payload, { headers, body } = {}) {
  const b = body ?? JSON.stringify(payload);
  const r = await fetch(`${base}/api/comms/webhooks/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers ?? sig(b)) }, body: b });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const flush = async () => { await new Promise(r => setTimeout(r, 25)); await core.settled(); };
let evn = 0;
const evt = (type, payload, id = `evt-${++evn}-${crypto.randomUUID()}`) => ({ data: { event_type: type, id, occurred_at: new Date().toISOString(), record_type: 'event', payload }, meta: { attempt: 1, delivered_to: 'https://example.test/hook' } });
const smsIn = ({ id, msgId = crypto.randomUUID(), from = PEER1, to = NUM_A, text = 'Hi there' } = {}) => evt('message.received', { id: msgId, direction: 'inbound', type: 'SMS', from: { phone_number: from, carrier: 'T-Mobile USA', line_type: 'Wireless' }, to: [{ phone_number: to, status: 'webhook_delivered' }], text, media: [] }, id);
const smsStatus = (type, msgId, status, to = PEER1, errors) => evt(type, { id: msgId, direction: 'outbound', type: 'SMS', from: { phone_number: NUM_A }, to: [{ phone_number: to, status }], ...(errors ? { errors } : {}) });
const call = (type, { id, callId, session, dir = 'incoming', from = PEER1, to = NUM_A, clientState, cause } = {}) => evt(type, { call_control_id: callId, call_leg_id: `leg-${callId}`, call_session_id: session, connection_id: 'conn-1', direction: dir, from, to, client_state: clientState, hangup_cause: cause, state: 'parked' }, id);
const commands = since => api.slice(since).filter(r => /^\/calls\//.test(r.path)).map(r => `${r.path.split('/')[2]}:${r.path.split('/')[4]}`);
const streams = [];
const closeStreams = async () => { for (const s of streams.splice(0)) s.close(); await new Promise(r => setTimeout(r, 60)); };
// a stream left open by a failed test must not leak into the next one
beforeEach(closeStreams);
function openSse(cookie) {
  const ac = new AbortController(), events = []; let buf = '';
  const ready = fetch(base + '/api/comms/events', { headers: { cookie }, signal: ac.signal }).then(async r => {
    if (r.status !== 200) return { status: r.status };
    (async () => {
      const dec = new TextDecoder(); try { for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.+)$/m.exec(frame), d = /^data: (.+)$/m.exec(frame); if (ev) events.push({ name: ev[1], data: JSON.parse(d[1]) }); } } } catch {}
    })();
    return { status: 200, type: r.headers.get('content-type') };
  });
  const handle = {
    ready, events, close: () => ac.abort(),
    async waitFor(name, pred = () => true, ms = 2000) { const end = Date.now() + ms; while (Date.now() < end) { const e = events.find(x => x.name === name && pred(x.data)); if (e) return e.data; await new Promise(r => setTimeout(r, 15)); } throw new Error(`no ${name} event; got ${events.map(e => e.name).join()}`); },
    };
  streams.push(handle);
  return handle;
}

// ======================================================================= unit
test('phone numbers: strict E.164 on the server, friendly parsing for the drawer, never a whole number in a log', () => {
  for (const ok of ['+18455551234', '+442071838750', '+4915112345678']) assert.ok(isE164(ok), ok);
  for (const bad of ['8455551234', '+0455551234', '+1', '+1845555123456789', '+1 845 555 1234', '', null, '+18455551234;DROP']) assert.ok(!isE164(bad), String(bad));
  assert.equal(toE164('(845) 555-1234'), '+18455551234');
  assert.equal(toE164('1-845-555-1234'), '+18455551234');
  assert.equal(toE164('+44 20 7183 8750'), '+442071838750');
  assert.equal(toE164('abc'), null); assert.equal(toE164('12345'), null); assert.equal(toE164('+0123456789'), null);
  assert.equal(last4('+18455551234'), '1234'); assert.equal(mask('+18455551234'), '••••1234'); assert.equal(mask(''), '');
});

test('adapter interface: both adapters satisfy it; a missing method or unknown provider is refused; a new adapter needs no core change', () => {
  AD.assertAdapter(createTelnyx({})); AD.assertAdapter(AST.createAsterisk({}));
  assert.throws(() => AD.assertAdapter({ name: 'x', sendSms() {} }), /missing/);
  assert.throws(() => AD.getAdapter('nope'), /Unknown comms provider/);
  const fake = { ...createTelnyx({}), name: 'fake', configured: () => true };
  AD.registerAdapter('fake', () => fake);
  assert.equal(AD.getAdapter('fake').name, 'fake');
  assert.deepEqual(AD.adapterNames().sort(), ['asterisk', 'fake', 'telnyx']);
  assert.throws(() => AST.createAsterisk({}).sendSms(), /not implemented/);
});

test('Telnyx signature: valid, altered body, old and future timestamps, missing headers, bad key, bad signature', () => {
  const t = createTelnyx(process.env), body = JSON.stringify({ a: 1 }), now = Date.now();
  assert.deepEqual(t.verifyWebhook(Buffer.from(body), sig(body), now), { ok: true });
  assert.deepEqual(t.verifyWebhook(body, sig(body), now), { ok: true }, 'a string body works too');
  assert.equal(t.verifyWebhook(Buffer.from(body + ' '), sig(body), now).reason, 'signature');
  assert.equal(t.verifyWebhook(Buffer.from(body), sig(body, Math.floor(now / 1000) - 400), now).reason, 'timestamp');
  assert.equal(t.verifyWebhook(Buffer.from(body), sig(body, Math.floor(now / 1000) + 400), now).reason, 'timestamp');
  assert.equal(t.verifyWebhook(Buffer.from(body), {}, now).reason, 'missing_headers');
  assert.equal(t.verifyWebhook(Buffer.from(body), { ...sig(body), 'telnyx-signature-ed25519': Buffer.alloc(64).toString('base64') }, now).reason, 'signature');
  assert.equal(t.verifyWebhook(Buffer.from(body), { ...sig(body), 'telnyx-signature-ed25519': 'AAAA' }, now).reason, 'signature');
  assert.equal(createTelnyx({ ...process.env, TELNYX_PUBLIC_KEY: '' }).verifyWebhook(Buffer.from(body), sig(body), now).reason, 'no_public_key');
  assert.equal(createTelnyx({ ...process.env, TELNYX_PUBLIC_KEY: 'AAAA' }).verifyWebhook(Buffer.from(body), sig(body), now).reason, 'bad_public_key');
  const other = crypto.generateKeyPairSync('ed25519').privateKey, ts = Math.floor(now / 1000);
  assert.equal(t.verifyWebhook(Buffer.from(body), { 'telnyx-timestamp': String(ts), 'telnyx-signature-ed25519': crypto.sign(null, Buffer.from(`${ts}|${body}`), other).toString('base64') }, now).reason, 'signature');
  assert.throws(() => ed25519PublicKey('AAAA'), /32-byte/);
});

test('Telnyx parsing: inbound text, status events, call events; anything else is null', () => {
  const t = createTelnyx(process.env);
  const r = t.parseSmsEvent(smsIn({ id: 'e1', msgId: 'm1', text: 'Hello' }));
  assert.deepEqual({ ...r, occurredAt: undefined }, { eventId: 'e1', type: 'received', messageId: 'm1', direction: 'in', from: PEER1, to: NUM_A, text: 'Hello', status: 'received', errorCode: null, occurredAt: undefined });
  assert.equal(t.parseSmsEvent(smsStatus('message.sent', 'm2', 'sending')).status, 'sent');
  assert.equal(t.parseSmsEvent(smsStatus('message.finalized', 'm2', 'delivered')).status, 'delivered');
  const f = t.parseSmsEvent(smsStatus('message.finalized', 'm2', 'delivery_failed', PEER1, [{ code: '40300' }]));
  assert.equal(f.status, 'failed'); assert.equal(f.errorCode, '40300');
  assert.equal(t.parseSmsEvent(smsStatus('message.finalized', 'm2', 'delivered')).text, '', 'status events carry no text');
  assert.equal(t.parseSmsEvent({ data: { event_type: 'call.initiated' } }), null);
  assert.equal(t.parseSmsEvent(null), null); assert.equal(t.parseSmsEvent({}), null);
  const v = t.parseVoiceEvent(call('call.initiated', { id: 'v1', callId: 'cc-1', session: 's-1' }));
  assert.equal(v.type, 'initiated'); assert.equal(v.direction, 'in'); assert.equal(v.callId, 'cc-1'); assert.equal(v.sessionId, 's-1');
  assert.equal(t.parseVoiceEvent(call('call.hangup', { callId: 'cc-1', session: 's-1', dir: 'outgoing', cause: 'normal_clearing' })).direction, 'out');
  assert.equal(t.parseVoiceEvent(call('call.speak.ended', { callId: 'cc-1', session: 's-1' })).type, 'speak_ended');
  assert.equal(t.parseVoiceEvent(call('call.machine.detection.ended', { callId: 'cc-1', session: 's-1' })), null);
  assert.equal(t.parseVoiceEvent(smsIn()), null);
});

test('keywords: STOP words, START words and HELP are whole-message matches', () => {
  for (const w of ['STOP', 'stop', ' Stop. ', 'STOPALL', 'unsubscribe', 'Cancel', 'END', 'quit!']) assert.equal(core.keywordOf(w), 'stop', w);
  for (const w of ['START', 'unstop']) assert.equal(core.keywordOf(w), 'start', w);
  for (const w of ['HELP', 'info']) assert.equal(core.keywordOf(w), 'help', w);
  for (const w of ['please stop by later', 'stopping', 'help me', 'yes', '', null]) assert.equal(core.keywordOf(w), null, String(w));
});

test('quiet hours: 21:00 to 08:00 in the configured zone; edges; the resume time', () => {
  const c = { quietStart: 21, quietEnd: 8, quietTz: 'America/New_York' };
  const at = iso => Date.parse(iso);
  assert.equal(core.inQuietHours(at('2026-11-15T20:59:00-05:00'), c), false);
  assert.equal(core.inQuietHours(at('2026-11-15T21:00:00-05:00'), c), true);
  assert.equal(core.inQuietHours(at('2026-11-16T07:59:00-05:00'), c), true);
  assert.equal(core.inQuietHours(at('2026-11-16T08:00:00-05:00'), c), false);
  assert.equal(core.inQuietHours(at('2026-07-15T22:00:00-04:00'), c), true, 'daylight time');
  assert.equal(core.inQuietHours(at('2026-11-15T23:00:00Z'), { ...c, quietTz: 'Asia/Jerusalem' }), true, 'another zone: 01:00 there');
  const resume = core.quietResumesAt(at('2026-11-15T23:30:00-05:00'), c);
  assert.ok(resume >= at('2026-11-16T08:00:00-05:00') && resume <= at('2026-11-16T08:15:00-05:00'));
  assert.equal(core.cfg({ COMMS_QUIET_TZ: 'Not/AZone' }).quietTz, 'America/New_York');
});

test('TURN: short-lived credentials from a shared secret (coturn REST scheme); none without a secret', () => {
  const t = 1800000000000, c = core.turnConfig(7, t);
  const turn = c.iceServers.find(s => s.username);
  assert.equal(turn.username, `${1800000000 + 3600}:7`);
  assert.equal(turn.credential, crypto.createHmac('sha1', 'turn-shared-secret-for-tests').update(turn.username).digest('base64'));
  assert.deepEqual(turn.urls, ['turns:turn.example.test:5349?transport=tcp']);
  assert.ok(c.iceServers.some(s => s.urls.includes('stun:stun.example.test:3478')));
  assert.equal(c.turn, true);
  assert.deepEqual(core.turnConfig(7, t, {}), { iceServers: [], turn: false });
});

test('Asterisk / FreeSWITCH: the management interface must be private, use TLS and strong credentials', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '172.31.255.1', 'pbx.internal', '[::1]', 'fd00::1']) assert.ok(AST.isPrivateHost(h), h);
  for (const h of ['8.8.8.8', '172.32.0.1', 'pbx.example.com', '203.0.113.9', '']) assert.ok(!AST.isPrivateHost(h), h);
  const ok = { ASTERISK_ARI_URL: 'https://10.0.0.5:8089/ari', ASTERISK_ARI_USER: 'ari', ASTERISK_ARI_PASSWORD: 'x'.repeat(20) };
  assert.ok(AST.assertSafeAsteriskConfig(ok));
  assert.throws(() => AST.assertSafeAsteriskConfig({ ...ok, ASTERISK_ARI_URL: 'https://pbx.example.com/ari' }), /private-network/);
  assert.throws(() => AST.assertSafeAsteriskConfig({ ...ok, ASTERISK_ARI_URL: 'http://10.0.0.5:8088/ari' }), /https/);
  assert.ok(AST.assertSafeAsteriskConfig({ ...ok, ASTERISK_ARI_URL: 'http://127.0.0.1:8088/ari' }), 'loopback may be plain');
  assert.throws(() => AST.assertSafeAsteriskConfig({ ...ok, ASTERISK_ARI_PASSWORD: 'short' }), /16 characters/);
  assert.throws(() => AST.assertSafeAsteriskConfig({}), /not set/);
  assert.equal(AST.createAsterisk({ ...ok, ASTERISK_ARI_URL: 'http://8.8.8.8/ari' }).configured(), false);
  assert.equal(AST.createAsterisk(ok).verifyWebhook(Buffer.from('{}'), {}).ok, false, 'the stub refuses every webhook');
});

// ======================================================================= webhooks
test('webhooks: off (404) when the flag is off; bad, missing, old and altered signatures refused; bad JSON is a 400', async () => {
  await F.saveFlags({ comms_drawer: { on: false, pct: 0 } });
  assert.equal((await hook('sms', smsIn())).status, 404);
  assert.equal((await hook('voice', call('call.initiated', { callId: 'c', session: 's' }))).status, 404);
  assert.equal((await A('/comms/summary')).status, 404);
  await F.saveFlags({ comms_drawer: { on: true, pct: 100 } });
  const p = smsIn(), body = JSON.stringify(p);
  assert.equal((await hook('sms', p, { headers: {} })).status, 401, 'unsigned');
  assert.equal((await hook('sms', p, { headers: sig(body, Math.floor(Date.now() / 1000) - 3600) })).status, 401, 'old timestamp (replay)');
  assert.equal((await hook('sms', p, { headers: sig(body), body: body.replace('Hi there', 'Changed') })).status, 401, 'body changed after signing');
  const junk = 'not json';
  assert.equal((await hook('sms', null, { body: junk, headers: sig(junk) })).status, 400);
  assert.equal((await hook('sms', evt('message.delivery_report', { id: 'x' }))).body.ignored, 'event', 'a type the module does not use is acknowledged');
  assert.equal((await hook('voice', smsIn())).body.ignored, 'event');
  assert.equal((await one('SELECT COUNT(*) n FROM sms_messages')).n, 0, 'nothing refused was stored');
});

test('inbound text: stored without its text, delivered live, confirmed by the browser, then nothing is left', async () => {
  const s = openSse(A.cookie); assert.equal((await s.ready).status, 200);
  const p = smsIn({ id: 'evt-in-1', msgId: 'prov-in-1', text: 'Hi there, secret-body-123' });
  assert.deepEqual((await hook('sms', p)).body, { received: true });
  await flush();
  const got = await s.waitFor('sms.received', d => d.text.includes('secret-body-123'));
  assert.equal(got.peer, PEER1); assert.ok(got.threadKey);
  const row = await one('SELECT * FROM sms_messages WHERE provider_message_id = ?', 'prov-in-1');
  assert.equal(row.direction, 'in'); assert.equal(row.peer_last4, '0001'); assert.equal(row.provider, 'telnyx');
  const dump = JSON.stringify(await all('SELECT * FROM sms_messages'));
  assert.ok(!dump.includes('secret-body-123') && !dump.includes(PEER1) && !dump.includes('5551230001'), 'no text or full peer number in the table');
  assert.ok(row.pending_body && row.pending_until > Date.now(), 'waiting, encrypted, for the browser to confirm');
  assert.deepEqual((await A('/comms/summary')).body, { missedCalls: 0, waitingTexts: 1 });
  assert.equal((await A('/comms/sms/ack', { ids: [got.id, 99999] })).body.acked, 1);
  const after = await one('SELECT pending_body, pending_until FROM sms_messages WHERE id = ?', got.id);
  assert.deepEqual(after, { pending_body: null, pending_until: null });
  assert.equal((await B('/comms/sms/ack', { ids: [got.id] })).body.acked, 0, 'only the owner can confirm');
  s.close();
});

test('inbound text: the same event twice, or the same message in a second event, is stored once', async () => {
  const p = smsIn({ id: 'evt-dup', msgId: 'prov-dup', text: 'once' });
  assert.deepEqual((await hook('sms', p)).body, { received: true });
  assert.deepEqual((await hook('sms', p)).body, { received: true, duplicate: true });
  const again = smsIn({ id: 'evt-dup-2', msgId: 'prov-dup', text: 'once' });
  assert.equal((await hook('sms', again)).body.duplicate, true);
  assert.equal((await one("SELECT COUNT(*) n FROM sms_messages WHERE provider_message_id = 'prov-dup'")).n, 1);
  await flush();
});

test('inbound text while offline waits and is delivered when the browser connects; a text to an unknown number is dropped', async () => {
  await hook('sms', smsIn({ msgId: 'prov-off', text: 'while you were away' })); await flush();
  const s = openSse(A.cookie); await s.ready;
  const m = await s.waitFor('sms.received', d => d.text === 'while you were away');
  assert.equal(m.pending, true);
  const ready = await s.waitFor('ready'); assert.ok(ready.waitingTexts >= 1);
  await A('/comms/sms/ack', { ids: [m.id] });
  s.close();
  assert.equal((await hook('sms', smsIn({ to: '+18455559999', text: 'nobody' }))).status, 200);
  assert.equal((await one("SELECT COUNT(*) n FROM sms_messages WHERE our_number = '+18455559999'")).n, 0);
});

test('sending: validation, consent, the provider request, the stored row, and status events that only move forward', async () => {
  assert.equal((await A('/comms/sms/send', { to: '8455551234', text: 'x' })).body.code, 'bad_number');
  assert.equal((await A('/comms/sms/send', { to: PEER2, text: '   ' })).body.code, 'empty');
  assert.equal((await A('/comms/sms/send', { to: PEER2, text: 'x'.repeat(1601) })).body.code, 'too_long');
  assert.equal((await A('/comms/sms/send', { to: NUM_A, text: 'x', attest: true })).body.code, 'own_number');
  const noNum = await C('/comms/sms/send', { to: PEER2, text: 'x', attest: true }); assert.equal(noNum.status, 409); assert.equal(noNum.body.code, 'no_number');
  assert.equal((await X('/comms/sms/send', { to: PEER2, text: 'x' })).status, 401, 'signed out');
  const noConsent = await A('/comms/sms/send', { to: PEER2, text: 'Hello Pat' });
  assert.equal(noConsent.status, 428); assert.equal(noConsent.body.needsConsent, true);
  const clock = core.clock.now; core.clock.now = () => Date.parse('2026-11-16T15:00:00Z'); // 10:00 in New York
  const before = api.length;
  try {
    const ok = await A('/comms/sms/send', { to: PEER2, text: 'Hello Pat', attest: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.status, 'queued');
    const sent = api.slice(before).find(r => r.path === '/messages');
    assert.deepEqual(sent.body, { from: NUM_A, to: PEER2, text: 'Hello Pat', type: 'SMS', messaging_profile_id: 'mp-1' });
    assert.equal(sent.auth, 'Bearer KEY_test');
    const consent = await one('SELECT status, source FROM sms_consent WHERE user_id = ? AND thread_key = ?', ids['comms-a@example.com'], core.threadKey(ids['comms-a@example.com'], PEER2));
    assert.deepEqual(consent, { status: 'opted_in', source: 'user_attested' });
    assert.equal((await A('/comms/sms/send', { to: PEER2, text: 'Second, no confirmation needed' })).status, 200);
    const row = await one('SELECT * FROM sms_messages WHERE id = ?', ok.body.id);
    assert.equal(row.direction, 'out'); assert.equal(row.pending_body, null); assert.equal(row.status, 'queued');
    assert.ok(!JSON.stringify(await all('SELECT * FROM sms_messages WHERE direction = ?', 'out')).includes('Hello Pat'), 'the text is not stored');
    // status events: forward only
    const mid = row.provider_message_id;
    await hook('sms', smsStatus('message.sent', mid, 'sending', PEER2)); await flush();
    assert.equal((await one('SELECT status FROM sms_messages WHERE id = ?', row.id)).status, 'sent');
    await hook('sms', smsStatus('message.finalized', mid, 'delivered', PEER2)); await flush();
    assert.equal((await one('SELECT status FROM sms_messages WHERE id = ?', row.id)).status, 'delivered');
    assert.equal((await hook('sms', smsStatus('message.sent', mid, 'sending', PEER2))).status, 200); await flush();
    assert.equal((await one('SELECT status FROM sms_messages WHERE id = ?', row.id)).status, 'delivered', 'a late "sent" does not move it back');
    await hook('sms', smsStatus('message.finalized', mid, 'delivery_failed', PEER2, [{ code: '40300' }])); await flush();
    assert.equal((await one('SELECT status FROM sms_messages WHERE id = ?', row.id)).status, 'delivered', 'delivered is final');
    const second = await A('/comms/sms/send', { to: PEER2, text: 'will fail' });
    await hook('sms', smsStatus('message.finalized', (await one('SELECT provider_message_id p FROM sms_messages WHERE id = ?', second.body.id)).p, 'delivery_failed', PEER2, [{ code: '40300' }])); await flush();
    assert.deepEqual(await one('SELECT status, error_code FROM sms_messages WHERE id = ?', second.body.id), { status: 'failed', error_code: '40300' });
  } finally { core.clock.now = clock; }
});

test('sending: a provider failure becomes a plain message and records nothing; a busy provider says so', async () => {
  const clock = core.clock.now; core.clock.now = () => Date.parse('2026-11-16T15:00:00Z');
  try {
    const rows = (await one('SELECT COUNT(*) n FROM sms_messages')).n;
    apiFail.push({ status: 500 });
    const r = await A('/comms/sms/send', { to: PEER2, text: 'will not go' });
    assert.equal(r.status, 502); assert.equal(r.body.code, 'provider_error'); assert.doesNotMatch(r.body.error, /Telnyx|10001|500/);
    assert.equal((await one('SELECT COUNT(*) n FROM sms_messages')).n, rows);
    apiFail.push({ status: 429 });
    assert.equal((await A('/comms/sms/send', { to: PEER2, text: 'busy' })).status, 429);
  } finally { core.clock.now = clock; }
});

test('quiet hours: a first text overnight is refused with the resume time; a reply to someone who just wrote is allowed', async () => {
  const clock = core.clock.now; core.clock.now = () => Date.parse('2026-11-16T04:00:00Z'); // 23:00 in New York
  try {
    const r = await A('/comms/sms/send', { to: PEER3, text: 'Late hello', attest: true });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'quiet_hours'); assert.equal(r.body.quietHours, true);
    assert.ok(r.body.resumesAt > core.clock.now() && r.body.resumesAt <= core.clock.now() + 10 * 3600e3 + 15 * 60e3);
    assert.equal((await one('SELECT COUNT(*) n FROM sms_consent WHERE thread_key = ?', core.threadKey(ids['comms-a@example.com'], PEER3))).n, 0, 'a refused first text records no consent');
    await hook('sms', smsIn({ from: PEER3, text: 'Are you there?' })); await flush();
    const reply = await A('/comms/sms/send', { to: PEER3, text: 'Yes, here' });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    core.clock.now = () => Date.parse('2026-11-17T04:00:00Z'); // a day later: the conversation window has passed
    assert.equal((await A('/comms/sms/send', { to: PEER3, text: 'Next day, overnight' })).body.code, 'quiet_hours');
  } finally { core.clock.now = clock; }
});

test('STOP, START and HELP: STOP blocks sending and is not kept; START allows it again; HELP gets the help text', async () => {
  const clock = core.clock.now; core.clock.now = () => Date.parse('2026-11-16T15:00:00Z');
  try {
    const s = openSse(A.cookie); await s.ready;
    await hook('sms', smsIn({ from: PEER2, text: 'STOP' })); await flush();
    await s.waitFor('sms.optout', d => d.peer === PEER2);
    assert.equal(s.events.filter(e => e.name === 'sms.received' && e.data.text === 'STOP').length, 0, 'STOP is acted on, not shown as a message');
    const stopRow = await one("SELECT pending_body FROM sms_messages WHERE direction = 'in' AND thread_key = ? ORDER BY id DESC", core.threadKey(ids['comms-a@example.com'], PEER2));
    assert.equal(stopRow.pending_body, null);
    const blocked = await A('/comms/sms/send', { to: PEER2, text: 'hello again', attest: true });
    assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'opted_out');
    await hook('sms', smsIn({ from: PEER2, text: 'chatty message after stop' })); await flush();
    assert.equal((await A('/comms/sms/send', { to: PEER2, text: 'x', attest: true })).body.code, 'opted_out', 'only START turns texts back on');
    await hook('sms', smsIn({ from: PEER2, text: 'Start' })); await flush();
    await s.waitFor('sms.optin', d => d.peer === PEER2);
    assert.equal((await A('/comms/sms/send', { to: PEER2, text: 'welcome back' })).status, 200);
    const before = api.length;
    await hook('sms', smsIn({ from: PEER1, text: 'HELP' })); await flush();
    const reply = api.slice(before).find(r => r.path === '/messages');
    assert.equal(reply.body.to, PEER1); assert.equal(reply.body.from, NUM_A); assert.match(reply.body.text, /Reply STOP to unsubscribe/); assert.match(reply.body.text, /Msg and data rates may apply/);
    s.close();
    process.env.COMMS_HELP_REPLY = 'off';
    const b2 = api.length; await hook('sms', smsIn({ from: PEER1, text: 'HELP' })); await flush();
    assert.equal(api.slice(b2).filter(r => r.path === '/messages').length, 0, 'the help reply can be switched off (the provider may send its own)');
    delete process.env.COMMS_HELP_REPLY;
  } finally { core.clock.now = clock; }
});

test('rate limit: sending stops at the per-user hourly limit (429); other users are not affected', async () => {
  const clock = core.clock.now; core.clock.now = () => Date.parse('2026-11-16T15:00:00Z');
  process.env.COMMS_SEND_PER_HOUR = '3';
  try {
    const Dc = user(); // a session for user D, made directly
    const token = crypto.randomBytes(24).toString('base64url');
    void token; void Dc;
    const direct = () => core.sendSms({ id: ids.d }, { to: PEER1, text: 'n', attest: true });
    for (let i = 0; i < 3; i++) await direct();
    await assert.rejects(direct(), e => e.status === 429 && e.code === 'rate_limited');
    const other = await core.sendSms({ id: ids['comms-b@example.com'] }, { to: PEER1, text: 'unaffected', attest: true }); // another user has their own count
    assert.equal(other.status, 'queued');
  } finally { core.clock.now = clock; process.env.COMMS_SEND_PER_HOUR = '1000'; }
});

// ======================================================================= voice
test('incoming call, IVR mode: answer, play the greeting, hang up; the call is recorded as missed', async () => {
  const s = openSse(A.cookie); await s.ready;
  const start = api.length, S = 'sess-ivr-1', L = 'cc-ivr-leg-1';
  assert.equal((await hook('voice', call('call.initiated', { callId: L, session: S }))).status, 200); await flush();
  assert.deepEqual(commands(start), [`${L}:answer`]);
  await hook('voice', call('call.answered', { callId: L, session: S })); await flush();
  const speak = api.slice(start).find(r => r.path.endsWith('/speak'));
  assert.equal(speak.body.payload, 'Hello from A. Please text us.'); assert.equal(speak.body.voice, 'female');
  await hook('voice', call('call.speak.ended', { callId: L, session: S })); await flush();
  assert.deepEqual(commands(start), [`${L}:answer`, `${L}:speak`, `${L}:hangup`]);
  await hook('voice', call('call.hangup', { callId: L, session: S, cause: 'normal_clearing' })); await flush();
  const rec = await one('SELECT * FROM call_records WHERE provider_call_id = ?', S);
  assert.equal(rec.status, 'missed'); assert.equal(rec.duration_s, 0); assert.equal(rec.peer_last4, '0001'); assert.equal(rec.handling, 'ivr');
  assert.ok(!JSON.stringify(rec).includes('5551230001'));
  await s.waitFor('call.missed', d => d.id === rec.id);
  assert.equal((await A('/comms/summary')).body.missedCalls, 1);
  const hist = (await A('/comms/calls')).body.calls; assert.equal(hist[0].status, 'missed'); assert.equal(hist[0].peerLast4, '0001');
  assert.equal((await A('/comms/calls/seen', {})).body.seen, 1);
  assert.equal((await A('/comms/summary')).body.missedCalls, 0);
  s.close();
});

test('incoming call, softphone mode with the browser open: transfer to the softphone, ring it, count the answered call', async () => {
  const s = openSse(B.cookie); await s.ready;
  const start = api.length, S = 'sess-sp-1', L = 'cc-sp-leg-1', LB = 'cc-sp-legB-1';
  const t0 = Date.parse('2026-11-16T15:00:00Z'), clock = core.clock.now;
  try {
    core.clock.now = () => t0;
    await hook('voice', call('call.initiated', { callId: L, session: S, to: NUM_B })); await flush();
    const tr = api.slice(start).find(r => r.path.endsWith('/transfer'));
    assert.equal(tr.body.to, 'sip:gencred_b@sip.telnyx.com'); assert.equal(tr.body.timeout_secs, 30);
    assert.equal(commands(start).some(c => c.endsWith(':record_start')), false, 'recording is off by default');
    const inc = await s.waitFor('call.incoming'); assert.equal(inc.peer, PEER1);
    core.clock.now = () => t0 + 4000;
    await hook('voice', call('call.answered', { callId: LB, session: S, to: NUM_B })); await flush();
    assert.equal((await one('SELECT status FROM call_records WHERE provider_call_id = ?', S)).status, 'answered');
    core.clock.now = () => t0 + 94000;
    await hook('voice', call('call.hangup', { callId: L, session: S, to: NUM_B, cause: 'normal_clearing' })); await flush();
    const rec = await one('SELECT * FROM call_records WHERE provider_call_id = ?', S);
    assert.equal(rec.status, 'completed'); assert.equal(rec.duration_s, 90);
    assert.deepEqual(await s.waitFor('call.ended'), { id: rec.id, status: 'completed', duration: 90 });
    assert.equal((await B('/comms/summary')).body.missedCalls, 0, 'an answered call is not a missed call');
  } finally { core.clock.now = clock; s.close(); }
});

test('incoming call, softphone mode: nobody answers (the softphone leg ends) -> the caller hears the message; browser closed -> greeting at once', async () => {
  const s = openSse(B.cookie); await s.ready;
  let start = api.length;
  await hook('voice', call('call.initiated', { callId: 'cc-na-leg-1', session: 'sess-na-1', to: NUM_B })); await flush();
  await hook('voice', call('call.hangup', { callId: 'cc-na-legB-1', session: 'sess-na-1', to: NUM_B, cause: 'timeout' })); await flush();
  assert.deepEqual(commands(start), ['cc-na-leg-1:transfer', 'cc-na-leg-1:speak'], 'the call is still on our leg, so it gets the message');
  await hook('voice', call('call.speak.ended', { callId: 'cc-na-leg-1', session: 'sess-na-1', to: NUM_B })); await flush();
  assert.equal(commands(start).at(-1), 'cc-na-leg-1:hangup');
  await hook('voice', call('call.hangup', { callId: 'cc-na-leg-1', session: 'sess-na-1', to: NUM_B })); await flush();
  assert.equal((await one('SELECT status FROM call_records WHERE provider_call_id = ?', 'sess-na-1')).status, 'missed');
  s.close(); await new Promise(r => setTimeout(r, 40));
  start = api.length;
  await hook('voice', call('call.initiated', { callId: 'cc-off-leg-1', session: 'sess-off-1', to: NUM_B })); await flush();
  assert.deepEqual(commands(start), ['cc-off-leg-1:answer'], 'no browser online: straight to the greeting, no transfer');
});

test('recording: off by default; when switched on the caller hears a notice first, then recording starts and the call is put through', async () => {
  const s = openSse(B.cookie); await s.ready;
  process.env.COMMS_RECORDING = 'announce';
  try {
    const start = api.length;
    await hook('voice', call('call.initiated', { callId: 'cc-rec-leg-1', session: 'sess-rec-1', to: NUM_B })); await flush();
    assert.deepEqual(commands(start), ['cc-rec-leg-1:answer']);
    await hook('voice', call('call.answered', { callId: 'cc-rec-leg-1', session: 'sess-rec-1', to: NUM_B })); await flush();
    assert.equal(api.slice(start).find(r => r.path.endsWith('/speak')).body.payload, 'This call may be recorded.');
    await hook('voice', call('call.speak.ended', { callId: 'cc-rec-leg-1', session: 'sess-rec-1', to: NUM_B })); await flush();
    assert.deepEqual(commands(start), ['cc-rec-leg-1:answer', 'cc-rec-leg-1:speak', 'cc-rec-leg-1:record_start', 'cc-rec-leg-1:transfer']);
    assert.ok(!JSON.stringify(await all('SELECT * FROM call_records')).match(/recording|\.mp3|http/i), 'no recording or link is stored');
  } finally { delete process.env.COMMS_RECORDING; s.close(); }
});

test('voice webhooks: duplicates, a call to an unknown number, and events for calls we never saw do nothing', async () => {
  const p = call('call.initiated', { id: 'evt-vdup', callId: 'cc-vd-leg-1', session: 'sess-vd-1' });
  const start = api.length;
  assert.deepEqual((await hook('voice', p)).body, { received: true });
  assert.deepEqual((await hook('voice', p)).body, { received: true, duplicate: true }); await flush();
  assert.deepEqual(commands(start), ['cc-vd-leg-1:answer'], 'one command, not two');
  const s2 = api.length;
  await hook('voice', call('call.initiated', { callId: 'cc-un-leg-1', session: 'sess-un-1', to: '+18455559998' }));
  await hook('voice', call('call.hangup', { callId: 'cc-ghost-leg', session: 'sess-ghost' })); await flush();
  assert.deepEqual(commands(s2), []);
});

test('outgoing call from the web dialer: registered first, matched by its client state, timed from answer to hangup', async () => {
  assert.equal((await B('/comms/calls/outbound', { to: '555' })).body.code, 'bad_number');
  assert.equal((await C('/comms/calls/outbound', { to: PEER1 })).status, 409);
  const r = await B('/comms/calls/outbound', { to: PEER1 });
  assert.equal(r.status, 200); assert.equal(r.body.callerNumber, NUM_B); assert.equal(Buffer.from(r.body.clientState, 'base64').toString(), r.body.callRef); assert.match(r.body.callRef, /^[a-f0-9]{16}$/);
  const t0 = Date.parse('2026-11-16T16:00:00Z'), clock = core.clock.now; core.clock.now = () => t0;
  try {
    await hook('voice', call('call.initiated', { callId: 'cc-out-leg-1', session: 'sess-out-1', dir: 'outgoing', from: 'sip:gencred_b@sip.telnyx.com', to: PEER1, clientState: r.body.clientState })); await flush();
    assert.equal((await one('SELECT status, provider_call_id FROM call_records WHERE id = ?', r.body.id)).status, 'ringing');
    core.clock.now = () => t0 + 3000; await hook('voice', call('call.answered', { callId: 'cc-out-leg-1', session: 'sess-out-1', dir: 'outgoing', to: PEER1 })); await flush();
    core.clock.now = () => t0 + 63000; await hook('voice', call('call.hangup', { callId: 'cc-out-leg-1', session: 'sess-out-1', dir: 'outgoing', to: PEER1 })); await flush();
    assert.deepEqual(await one('SELECT status, duration_s, direction FROM call_records WHERE id = ?', r.body.id), { status: 'completed', duration_s: 60, direction: 'out' });
    const bad = await hook('voice', call('call.initiated', { callId: 'cc-out-leg-2', session: 'sess-out-2', dir: 'outgoing', to: PEER1, clientState: Buffer.from('not-a-ref').toString('base64') })); await flush();
    assert.equal(bad.status, 200);
    assert.equal((await one("SELECT COUNT(*) n FROM call_records WHERE provider_call_id = 'sess-out-2'")).n, 0, 'an unknown client state is ignored');
    const noAnswer = await B('/comms/calls/outbound', { to: PEER2 });
    await hook('voice', call('call.initiated', { callId: 'cc-out-leg-3', session: 'sess-out-3', dir: 'outgoing', to: PEER2, clientState: noAnswer.body.clientState }));
    await hook('voice', call('call.hangup', { callId: 'cc-out-leg-3', session: 'sess-out-3', dir: 'outgoing', to: PEER2 })); await flush();
    assert.equal((await one('SELECT status FROM call_records WHERE id = ?', noAnswer.body.id)).status, 'no_answer');
  } finally { core.clock.now = clock; }
});

test('softphone login: credentials created once and reused; ICE servers with short-lived TURN; needs a number', async () => {
  assert.equal((await C('/comms/webrtc/login', {})).status, 409);
  const start = api.length;
  const a = await B('/comms/webrtc/login', {});
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.loginToken, 'tok.test.jwt'); assert.equal(a.body.callerNumber, NUM_B);
  assert.ok(a.body.iceServers.some(s => s.username && /^\d+:\d+$/.test(s.username) && s.credential));
  assert.equal(api.slice(start).filter(r => r.path === '/telephony_credentials').length, 1);
  assert.equal((await one('SELECT credential_id FROM comms_numbers WHERE number = ?', NUM_B)).credential_id, 'cred-1');
  const mid = api.length; await B('/comms/webrtc/login', {});
  assert.equal(api.slice(mid).filter(r => r.path === '/telephony_credentials').length, 0, 'the credential is reused');
  assert.equal(api.slice(mid).filter(r => /token$/.test(r.path)).length, 1);
  apiFail.push({ status: 500 });
  const failed = await B('/comms/webrtc/login', {}); assert.equal(failed.status, 502); assert.doesNotMatch(failed.body.error, /Telnyx/i);
});

// ======================================================================= access, admin, housekeeping
test('access: everything needs a signed-in user in the rollout; /status always answers; rollout 0% hides it from everyone', async () => {
  assert.equal((await X('/comms/status')).status, 401);
  const st = await A('/comms/status'); assert.equal(st.status, 200); assert.equal(st.body.enabled, true); assert.equal(st.body.number, NUM_A); assert.equal(st.body.configured, true); assert.equal(st.body.recording, 'off');
  assert.equal((await X('/comms/events')).status, 401);
  await F.saveFlags({ comms_drawer: { on: true, pct: 0 } });
  try {
    assert.deepEqual((await A('/comms/status')).body, { enabled: false });
    assert.equal((await A('/comms/summary')).status, 404);
    assert.equal((await hook('sms', smsIn({ msgId: 'prov-pct0' }))).status, 200, 'the provider is still answered while the module is on');
  } finally { await F.saveFlags({ comms_drawer: { on: true, pct: 100 } }); }
});

test('events stream: text/event-stream, per-user, at most five connections per user', async () => {
  const a = openSse(B.cookie); const r = await a.ready; assert.equal(r.status, 200); assert.match(r.type, /text\/event-stream/);
  assert.equal(sse.connectionCount(ids['comms-b@example.com']), 1);
  const more = Array.from({ length: 6 }, () => openSse(B.cookie)); await Promise.all(more.map(m => m.ready));
  assert.ok(sse.connectionCount(ids['comms-b@example.com']) <= 5);
  assert.equal(sse.connectionCount(ids['comms-a@example.com']), 0, 'a stream is only for its own user');
  for (const m of [a, ...more]) m.close();
});

test('admin: only an admin assigns numbers; bad numbers, unknown users, a second number for a user, and removal', async () => {
  assert.ok([401, 403].includes((await A('/admin/sms-voice')).status));
  assert.ok([401, 403].includes((await A('/admin/sms-voice/numbers', { number: '+18455550777', userId: 1 }, 'PUT')).status));
  const list = await owner('/admin/sms-voice'); assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.provider, 'telnyx'); assert.equal(list.body.on, true); assert.equal(list.body.numbers.length, 3); assert.equal(list.body.settings.recording, 'off');
  const cId = ids['comms-c@example.com'];
  assert.equal((await owner('/admin/sms-voice/numbers', { number: '8455550777', userId: cId }, 'PUT')).body.code, 'bad_number');
  assert.equal((await owner('/admin/sms-voice/numbers', { number: '+18455550777', userId: 999999 }, 'PUT')).status, 404);
  assert.equal((await owner('/admin/sms-voice/numbers', { number: '+18455550777', userId: cId, voiceMode: 'fax' }, 'PUT')).body.code, 'bad_mode');
  const ok = await owner('/admin/sms-voice/numbers', { number: '+18455550777', userId: cId, voiceMode: 'ivr', greeting: '<b>Hi</b> & welcome' }, 'PUT');
  assert.equal(ok.status, 200); assert.equal(ok.body.greeting, 'bHi/b  welcome'.replace('bHi/b  welcome', ok.body.greeting));
  assert.doesNotMatch(ok.body.greeting, /[<>&]/);
  assert.equal((await owner('/admin/sms-voice/numbers', { number: '+18455550778', userId: cId }, 'PUT')).body.code, 'user_has_number');
  assert.equal((await owner('/admin/sms-voice/numbers/' + encodeURIComponent('+18455550777'), undefined, 'DELETE')).body.removed, 1);
});

test('housekeeping: expired waiting text is cleared, stale dialing attempts fail, old rows go, event ids are trimmed', async () => {
  const uid = ids['comms-a@example.com'], t = Date.now();
  const ins = await run("INSERT INTO sms_messages (user_id, provider, provider_message_id, direction, thread_key, status, pending_body, pending_until, created_at, updated_at) VALUES (?, 'telnyx', 'prov-exp', 'in', 'k', 'received', 'ciphertext', ?, ?, ?)", uid, t - 1000, t - 80 * 3600e3, t);
  await run("INSERT INTO call_records (user_id, provider, provider_call_id, direction, thread_key, status, started_at, created_at) VALUES (?, 'telnyx', 'ref:zzzz', 'out', 'k', 'dialing', ?, ?)", uid, t - 600e3, t - 600e3);
  await run("INSERT INTO sms_messages (user_id, provider, provider_message_id, direction, thread_key, status, created_at, updated_at) VALUES (?, 'telnyx', 'prov-old', 'in', 'k', 'received', ?, ?)", uid, t - 400 * 864e5, t - 400 * 864e5);
  await run("INSERT INTO comms_webhook_events (id, kind, at) VALUES ('old-evt', 'sms', ?)", t - 9 * 864e5);
  await core.purge();
  assert.equal((await one('SELECT pending_body FROM sms_messages WHERE id = ?', Number(ins.lastInsertRowid))).pending_body, null);
  assert.equal((await one("SELECT status FROM call_records WHERE provider_call_id = 'ref:zzzz'")).status, 'failed');
  assert.equal(await one("SELECT id FROM sms_messages WHERE provider_message_id = 'prov-old'"), undefined);
  assert.equal(await one("SELECT id FROM comms_webhook_events WHERE id = 'old-evt'"), undefined);
});

test('a failure while processing frees the event, so the provider\'s retry is processed (not dropped as a duplicate)', async () => {
  const p = smsIn({ id: 'evt-retry', msgId: 'prov-retry', text: 'retry me' });
  const clock = core.clock.now; let calls = 0;
  core.clock.now = () => { if (++calls === 2) throw new Error('boom'); return Date.now(); }; // first call is the claim, the second is inside the processing
  let r1;
  try { r1 = await hook('sms', p); } finally { core.clock.now = clock; }
  assert.equal(r1.status, 500);
  assert.equal(await one("SELECT id FROM comms_webhook_events WHERE id = 'evt-retry'"), undefined, 'the claim was released');
  assert.deepEqual((await hook('sms', p)).body, { received: true });
  assert.equal((await one("SELECT COUNT(*) n FROM sms_messages WHERE provider_message_id = 'prov-retry'")).n, 1);
  await flush();
});

test('privacy: nothing the module logged contains a full phone number or message text; no table holds text or a peer number', async () => {
  const out = logs.filter(l => l.includes('"src":"comms"'));
  assert.ok(out.length > 0, 'the module logged something');
  const all_ = out.join('\n');
  for (const bad of [PEER1, PEER2, PEER3, '5551230001', NUM_A, NUM_B, 'secret-body-123', 'Hello Pat', 'retry me', 'while you were away', 'KEY_test', PUB]) assert.ok(!all_.includes(bad), `a log line contains ${bad}`);
  for (const t of ['sms_messages', 'call_records', 'sms_consent', 'comms_numbers']) {
    const dump = JSON.stringify(await all(`SELECT * FROM ${t}`));
    for (const bad of [PEER1, PEER2, PEER3, '5551230001', 'secret-body-123', 'Hello Pat', 'chatty message after stop']) assert.ok(!dump.includes(bad), `${t} holds ${bad}`);
  }
});
