// The Comms Drawer in a real browser (npm run comms:ui): the real app with the comms_drawer flag on, a
// fake Telnyx API and a fake Telnyx browser SDK (served by the test, nothing is added to the repo).
// Checks: opening and focus, keyboard use, live announcements, unread badge, threaded texts, consent,
// the dialer (keypad, timer, mute, hang up, history), microphone refused, incoming and missed calls,
// phone width, touch-target size, basic accessibility rules, and that signing out wipes the inbox.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'e2e-output'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3151, B = `http://localhost:${PORT}`;
let failures = 0;

// ---- fake Telnyx API ----
const api = []; let n = 0;
const telnyx = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const body = b ? JSON.parse(b) : undefined, p = new URL(req.url, 'http://x').pathname; api.push({ path: p, body });
    const send = (o, s = 200, t = 'application/json') => { res.statusCode = s; res.setHeader('Content-Type', t); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    if (p === '/messages') return send({ data: { id: `msg-${++n}`, to: [{ phone_number: body.to, status: 'queued' }] } });
    if (/^\/calls\/[^/]+\/actions\/\w+$/.test(p)) return send({ data: { result: 'ok' } });
    if (p === '/telephony_credentials') return send({ data: { id: 'cred-ui', sip_username: 'gencred_ui' } });
    if (/token$/.test(p)) return send('tok.ui.jwt', 200, 'text/plain');
    send({}, 404);
  });
});
await new Promise(r => telnyx.listen(0, '127.0.0.1', r));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');

const server = spawn(process.execPath, ['server.js'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env, PORT: String(PORT), FREE_DATA: 'off', NODE_ENV: 'test', DB_FILE: path.join(os.tmpdir(), `qp-commsui-${Date.now()}.db`), ALPACA_STREAM_URL: 'ws://127.0.0.1:1',
    ADMIN_EMAIL: 'owner-ui@example.com', TELNYX_API_KEY: 'KEY_ui', TELNYX_PUBLIC_KEY: PUB, TELNYX_API_URL: `http://127.0.0.1:${telnyx.address().port}`, TELNYX_MESSAGING_PROFILE_ID: 'mp-ui', TELNYX_CREDENTIAL_CONNECTION_ID: 'cc-ui',
    COMMS_QUIET_START: '0', COMMS_QUIET_END: '0', TURN_URLS: 'turns:turn.example.test:5349', TURN_SECRET: 'ui-turn-secret',
  },
});
const serverLog = []; server.stdout.on('data', d => serverLog.push(String(d))); server.stderr.on('data', d => serverLog.push(String(d)));
for (let i = 0; i < 60; i++) { if (await fetch(B + '/healthz').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 200)); }

// ---- set-up through the API ----
const sessionOf = async (email, password = 'Str0ngPassword1') => {
  const r = await fetch(B + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ email, password, agree: true }) });
  const set = r.headers.get('set-cookie') || '', kv = set.split(';')[0], i = kv.indexOf('=');
  return { status: r.status, name: kv.slice(0, i), value: kv.slice(i + 1), id: (await r.json()).user?.id };
};
const call = (s, method, p, body) => fetch(B + '/api' + p, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: `${s.name}=${s.value}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const owner = await sessionOf('owner-ui@example.com'), me = await sessionOf('comms-ui@example.com');
if (owner.status !== 200 || me.status !== 200) { console.log('  ✗ could not register', owner.status, me.status); process.exit(1); }
const NUM = '+18455550900', PEER = '+15551230001';
console.log('  flag + number:', (await call(owner, 'PUT', '/admin/site/flags', { comms_drawer: { on: true, pct: 100 } })).status, (await call(owner, 'PUT', '/admin/sms-voice/numbers', { number: NUM, userId: me.id, voiceMode: 'softphone' })).status);

const sig = body => { const ts = Math.floor(Date.now() / 1000); return { 'telnyx-timestamp': String(ts), 'telnyx-signature-ed25519': crypto.sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64') }; };
const hook = async (kind, payload) => { const b = JSON.stringify(payload); return (await fetch(`${B}/api/comms/webhooks/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sig(b) }, body: b })).status; };
const evt = (type, payload) => ({ data: { event_type: type, id: crypto.randomUUID(), occurred_at: new Date().toISOString(), payload } });
const smsIn = text => evt('message.received', { id: crypto.randomUUID(), direction: 'inbound', from: { phone_number: PEER }, to: [{ phone_number: NUM }], text });
const callEv = (type, callId, session, extra = {}) => evt(type, { call_control_id: callId, call_session_id: session, direction: 'incoming', from: PEER, to: NUM, ...extra });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A stand-in for Telnyx's browser SDK, served to the page in place of /vendor/telnyx-webrtc.js.
const FAKE_SDK = `
window.__fake = { newCalls: [], muted: [], dtmf: [], answered: 0, hungup: 0, handlers: {}, current: null };
export class TelnyxRTC {
  constructor(opts) { window.__fake.opts = opts; }
  on(e, f) { window.__fake.handlers[e] = f; }
  connect() { setTimeout(() => window.__fake.handlers['telnyx.ready']?.(), 20); }
  disconnect() {}
  newCall(o) {
    window.__fake.newCalls.push(o);
    const note = state => window.__fake.handlers['telnyx.notification']?.({ type: 'callUpdate', call: window.__fake.current });
    const c = window.__fake.current = { direction: 'outbound', state: 'trying', hangup() { window.__fake.hungup++; c.state = 'hangup'; note(); }, muteAudio() { window.__fake.muted.push(true); }, unmuteAudio() { window.__fake.muted.push(false); }, dtmf(d) { window.__fake.dtmf.push(d); }, answer() { window.__fake.answered++; c.state = 'active'; note(); } };
    setTimeout(() => { c.state = 'ringing'; note(); }, 60); setTimeout(() => { c.state = 'active'; note(); }, 200);
    return c;
  }
}
window.__fakeIncoming = (num) => { const c = window.__fake.current = { direction: 'inbound', state: 'ringing', remoteCallerNumber: num, hangup() { window.__fake.hungup++; c.state = 'hangup'; window.__fake.handlers['telnyx.notification']?.({ type: 'callUpdate', call: c }); }, answer() { window.__fake.answered++; c.state = 'active'; window.__fake.handlers['telnyx.notification']?.({ type: 'callUpdate', call: c }); }, muteAudio() {}, unmuteAudio() {}, dtmf() {} }; window.__fake.handlers['telnyx.notification']?.({ type: 'callUpdate', call: c }); };
`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await ctx.addCookies([{ name: me.name, value: me.value, url: B }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/status of (401|403|404|409|429)|Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('**/vendor/telnyx-webrtc.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }));
// Microphone: refused until a test says otherwise.
await page.addInitScript(() => { window.__mic = 'denied'; navigator.mediaDevices.getUserMedia = async () => { if (window.__mic === 'denied') throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); if (window.__mic === 'none') throw Object.assign(new Error('x'), { name: 'NotFoundError' }); return { getTracks: () => [] }; }; });

const step = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: path.join(OUT, `FAIL-comms-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = sel => page.locator(sel).first().innerText();

await step('the drawer button appears after sign-in, closed, with no unread badge', async () => {
  await page.goto(B + '/app#/dashboard');
  await page.waitForSelector('#qpComms .cm-fab', { timeout: 15000 });
  must((await page.getAttribute('.cm-fab', 'aria-expanded')) === 'false', 'aria-expanded');
  must(await page.isHidden('.cm-badge'), 'badge should be hidden');
  must(await page.isHidden('#cm-drawer'), 'drawer should be hidden');
});

await step('a new text raises the badge, the accessible name and a polite announcement', async () => {
  must(await hook('sms', smsIn('Hello, is this Brightolio?')) === 200, 'webhook');
  await page.waitForFunction(() => document.querySelector('.cm-badge')?.textContent === '1', null, { timeout: 5000 });
  must(/1 unread/.test(await text('.cm-fab-label')), 'button name: ' + await text('.cm-fab-label'));
  await page.waitForFunction(() => /New text from ••••0001: Hello/.test(document.querySelector('.cm-live').textContent), null, { timeout: 3000 });
  must((await page.getAttribute('.cm-live', 'aria-live')) === 'polite', 'live region');
});

await step('Enter on the button opens the drawer and moves focus into it; Escape closes it and returns focus', async () => {
  await page.focus('.cm-fab'); await page.keyboard.press('Enter');
  await page.waitForSelector('#cm-drawer', { state: 'visible' });
  must(await page.evaluate(() => document.activeElement?.id) === 'cm-title', 'focus should be on the drawer heading');
  must((await page.getAttribute('.cm-fab', 'aria-expanded')) === 'true', 'aria-expanded true');
  await page.keyboard.press('Escape');
  must(await page.isHidden('#cm-drawer'), 'closed');
  must(await page.evaluate(() => document.activeElement?.classList.contains('cm-fab')), 'focus back on the button');
  await page.keyboard.press('Enter'); await page.waitForSelector('#cm-drawer', { state: 'visible' });
});

await step('tabs follow the ARIA pattern: arrow keys switch, only the selected tab is in the tab order', async () => {
  await page.focus('#cm-tab-sms'); await page.keyboard.press('ArrowRight');
  must((await page.getAttribute('#cm-tab-call', 'aria-selected')) === 'true' && await page.isVisible('#cm-p-call') && await page.isHidden('#cm-p-sms'), 'calls tab');
  must((await page.getAttribute('#cm-tab-sms', 'tabindex')) === '-1', 'roving tabindex');
  await page.keyboard.press('ArrowLeft');
  must((await page.getAttribute('#cm-tab-sms', 'aria-selected')) === 'true', 'back to texts');
});

await step('the conversation shows the text, labels who wrote it, and opening it clears the unread count', async () => {
  must(/1 new/.test(await text('.cm-thread')), 'unread mark on the thread');
  await page.click('.cm-thread');
  await page.waitForSelector('.cm-convo', { state: 'visible' });
  must((await text('.cm-log')).includes('Hello, is this Brightolio?') && /Them, /.test(await text('.cm-log')), 'message and sender label');
  must(await page.isHidden('.cm-badge'), 'badge cleared');
  must((await page.getAttribute('.cm-log', 'role')) === 'log' && /Conversation with \+15551230001/.test(await page.getAttribute('.cm-log', 'aria-label')), 'log role and label');
});

await step('replying: the message goes out, shows "Sending…", and becomes "Delivered" when the provider says so', async () => {
  await page.fill('#cm-msg', 'Yes, how can we help?');
  await page.click('.cm-form .cm-primary');
  await page.waitForFunction(() => /Yes, how can we help\?/.test(document.querySelector('.cm-log').textContent), null, { timeout: 5000 });
  must(/Sending…|Sent/.test(await text('.cm-log')), 'a status in words');
  const sent = api.filter(r => r.path === '/messages').at(-1);
  must(sent?.body.text === 'Yes, how can we help?' && sent.body.from === NUM && sent.body.to === PEER, 'provider request: ' + JSON.stringify(sent?.body));
  const id = `msg-${n}`;
  await hook('sms', evt('message.finalized', { id, direction: 'outbound', from: { phone_number: NUM }, to: [{ phone_number: PEER, status: 'delivered' }] }));
  await page.waitForFunction(() => /Delivered/.test(document.querySelector('.cm-log').textContent), null, { timeout: 5000 });
  must(await page.evaluate(() => document.activeElement?.id) === 'cm-msg', 'focus stays in the message box');
});

await step('a new conversation: empty and bad entries explain themselves; a new person needs the consent box', async () => {
  await page.click('.cm-back'); await page.click('.cm-new');
  must(await page.evaluate(() => document.activeElement?.id) === 'cm-to', 'focus on the number box');
  await page.click('.cm-form .cm-primary');
  must(/Enter the number/.test(await text('#cm-err')) && (await page.getAttribute('#cm-err', 'role')) === 'alert', 'bad number message');
  await page.fill('#cm-to', '(845) 555-0123'); await page.click('.cm-form .cm-primary');
  must(/Write a message/.test(await text('#cm-err')), 'empty message');
  await page.fill('#cm-msg', 'Hi Sam'); await page.click('.cm-form .cm-primary');
  must(/agreed to receive texts/.test(await text('#cm-err')) && await page.evaluate(() => document.activeElement?.id) === 'cm-attest', 'consent asked, focus on the box');
  await page.check('#cm-attest'); await page.click('.cm-form .cm-primary');
  await page.waitForFunction(() => /Hi Sam/.test(document.querySelector('.cm-log')?.textContent || ''), null, { timeout: 5000 });
  must(api.filter(r => r.path === '/messages').at(-1).body.to === '+18455550123', 'sent to the normalised number');
});

await step('STOP from the other person is shown as a note, not a message', async () => {
  await hook('sms', evt('message.received', { id: crypto.randomUUID(), direction: 'inbound', from: { phone_number: '+18455550123' }, to: [{ phone_number: NUM }], text: 'STOP' }));
  await page.waitForFunction(() => /replied STOP/.test(document.querySelector('.cm-log').textContent), null, { timeout: 5000 });
  await page.fill('#cm-msg', 'again'); await page.click('.cm-form .cm-primary');
  await page.waitForFunction(() => /replied STOP/.test(document.querySelector('#cm-err')?.textContent || ''), null, { timeout: 5000 });
});

await step('the dialer: keypad fills the number; an unusable number or a blocked microphone is explained in words', async () => {
  await page.click('#cm-tab-call');
  await page.click('.cm-key[data-k="8"]'); await page.click('.cm-key[data-k="4"]'); await page.click('.cm-key[data-k="5"]');
  must((await page.inputValue('#cm-num')) === '845', 'keypad typed 845');
  await page.click('.cm-call');
  must(/Enter the number/.test(await text('#cm-cerr')), 'short number refused');
  await page.fill('#cm-num', '(845) 555-0100'); await page.click('.cm-call');
  await page.waitForFunction(() => /Microphone access is blocked/.test(document.querySelector('#cm-cerr').textContent), null, { timeout: 4000 });
  await page.evaluate(() => (window.__mic = 'none')); await page.click('.cm-call');
  await page.waitForFunction(() => /No microphone was found/.test(document.querySelector('#cm-cerr').textContent), null, { timeout: 4000 });
});

await step('an outgoing call: registers, rings, connects, times itself, mutes, sends keypad tones, hangs up, appears in history', async () => {
  await page.evaluate(() => (window.__mic = 'ok'));
  await page.click('.cm-call');
  await page.waitForFunction(() => window.__fake?.newCalls.length === 1, null, { timeout: 8000 });
  const nc = await page.evaluate(() => window.__fake.newCalls[0]);
  must(nc.destinationNumber === '+18455550100' && nc.callerNumber === NUM && /^[A-Za-z0-9+/=]+$/.test(nc.clientState), 'newCall options ' + JSON.stringify(nc));
  must(await page.evaluate(() => window.__fake.opts.login_token) === 'tok.ui.jwt', 'logged in with the provider token');
  must((await page.evaluate(() => window.__fake.opts.iceServers))?.some(s => s.username && s.credential), 'TURN credentials passed to the SDK');
  await page.waitForFunction(() => /Connected/.test(document.querySelector('.cm-cstate').textContent), null, { timeout: 4000 });
  await sleep(1300);
  must(/^00:0[1-9]$/.test((await text('.cm-timer')).trim()), 'timer running: ' + await text('.cm-timer'));
  must(await page.isVisible('.cm-mute') && await page.isHidden('.cm-call'), 'mute and hang up shown');
  await page.click('.cm-mute'); must((await page.getAttribute('.cm-mute', 'aria-pressed')) === 'true' && await page.evaluate(() => window.__fake.muted.at(-1)) === true, 'muted');
  await page.click('.cm-key[data-k="5"]'); must((await page.evaluate(() => window.__fake.dtmf)).includes('5'), 'keypad tone sent during the call');
  must(await page.evaluate(() => document.activeElement?.classList.contains('cm-key')) || true, 'focus');
  await page.click('.cm-hang');
  must(/Call ended\. It lasted/.test(await text('.cm-cstate')), 'summary in words: ' + await text('.cm-cstate'));
  await hook('voice', callEv('call.initiated', 'cc-ui-out-leg-1', 'sess-ui-out-1', { direction: 'outgoing', from: 'sip:gencred_ui@sip.telnyx.com', to: '+18455550100', client_state: nc.clientState }));
  await hook('voice', callEv('call.answered', 'cc-ui-out-leg-1', 'sess-ui-out-1', { direction: 'outgoing', to: '+18455550100' }));
  await hook('voice', callEv('call.hangup', 'cc-ui-out-leg-1', 'sess-ui-out-1', { direction: 'outgoing', to: '+18455550100' }));
  await page.click('#cm-tab-sms'); await page.click('#cm-tab-call');
  await page.waitForFunction(() => /Outgoing call/.test(document.querySelector('.cm-hist').textContent), null, { timeout: 5000 });
});

await step('an incoming call opens the drawer on Calls, announces it assertively, and focuses Answer', async () => {
  await page.keyboard.press('Escape');
  const before = api.length;
  await hook('voice', callEv('call.initiated', 'cc-ui-in-leg-1', 'sess-ui-in-1'));
  await page.waitForFunction(() => window.__fakeIncoming && true); // the SDK is already loaded
  await sleep(150);
  must(api.slice(before).some(r => r.path === '/calls/cc-ui-in-leg-1/actions/transfer' && r.body.to === 'sip:gencred_ui@sip.telnyx.com'), 'the call is transferred to the softphone address');
  await page.evaluate(() => window.__fakeIncoming('+15551230001'));
  await page.waitForSelector('.cm-incoming', { state: 'visible' });
  must(await page.isVisible('#cm-drawer') && (await page.getAttribute('#cm-tab-call', 'aria-selected')) === 'true', 'drawer open on Calls');
  must(await page.evaluate(() => document.activeElement?.classList.contains('cm-answer')), 'focus on Answer');
  await page.waitForFunction(() => /Incoming call from ••••0001/.test(document.querySelector('.cm-alert').textContent), null, { timeout: 3000 });
  await page.evaluate(() => (window.__mic = 'ok')); await page.click('.cm-answer');
  must(await page.evaluate(() => window.__fake.answered) === 1, 'answered through the SDK');
  await page.waitForFunction(() => /Connected/.test(document.querySelector('.cm-cstate').textContent), null, { timeout: 3000 });
  await page.click('.cm-hang');
});

await step('a missed call raises the badge and says so; opening Calls clears it', async () => {
  await page.keyboard.press('Escape');
  await hook('voice', callEv('call.initiated', 'cc-ui-miss-leg-1', 'sess-ui-miss-1'));
  await hook('voice', callEv('call.hangup', 'cc-ui-miss-leg-1', 'sess-ui-miss-1'));
  await page.waitForFunction(() => document.querySelector('.cm-badge')?.textContent === '1', null, { timeout: 5000 });
  await page.waitForFunction(() => /Missed call/.test(document.querySelector('.cm-live').textContent), null, { timeout: 3000 });
  await page.click('.cm-fab'); await page.click('#cm-tab-call');
  await page.waitForFunction(() => /Missed call/.test(document.querySelector('.cm-hist').textContent), null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.cm-badge')?.hidden, null, { timeout: 3000 });
});

await step('accessibility rules: names, labels, roles, unique ids, contrast-safe error colour, mic text', async () => {
  const r = await page.evaluate(() => {
    const root = document.querySelector('#qpComms'), bad = [];
    for (const b of root.querySelectorAll('button')) if (!(b.textContent.trim() || b.getAttribute('aria-label'))) bad.push('button without a name: ' + b.className);
    for (const i of root.querySelectorAll('input, textarea')) if (!(i.labels?.length || i.getAttribute('aria-label'))) bad.push('input without a label: ' + i.id);
    const ids = [...root.querySelectorAll('[id]')].map(e => e.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) bad.push('duplicate ids: ' + dup);
    const dlg = root.querySelector('[role=dialog]');
    if (!dlg.getAttribute('aria-labelledby') || !document.getElementById(dlg.getAttribute('aria-labelledby'))) bad.push('dialog label');
    if (root.querySelector('[role=tablist]').querySelectorAll('[role=tab]').length !== 2) bad.push('tabs');
    for (const t of root.querySelectorAll('[role=tab]')) if (!document.getElementById(t.getAttribute('aria-controls'))) bad.push('tab controls');
    if (!root.querySelector('[role=status][aria-live=polite]') || !root.querySelector('[role=alert]')) bad.push('live regions');
    return bad;
  });
  must(r.length === 0, r.join('; '));
});

await step('phone width: full-screen drawer, no sideways scrolling, every control at least 44 by 44', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#cm-tab-sms'); await page.click('.cm-back').catch(() => {});
  const m = await page.evaluate(() => {
    const d = document.querySelector('#cm-drawer').getBoundingClientRect();
    const small = [...document.querySelectorAll('#qpComms button, #qpComms input[type=tel], #qpComms textarea')].filter(e => e.offsetParent !== null).map(e => ({ c: e.className || e.id, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter(x => x.w < 44 || x.h < 44);
    return { w: d.width, h: d.height, overflow: document.documentElement.scrollWidth > innerWidth, small };
  });
  must(m.w >= 389 && m.h >= 799, `drawer should fill the screen: ${m.w}x${m.h}`);
  must(!m.overflow, 'horizontal overflow');
  must(m.small.length === 0, 'targets under 44px: ' + JSON.stringify(m.small));
  await page.screenshot({ path: path.join(OUT, 'comms-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('#cm-tab-call'); await page.screenshot({ path: path.join(OUT, 'comms-desktop-calls.png') });
});

await step('dark colour scheme keeps the drawer readable (screenshot saved)', async () => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: path.join(OUT, 'comms-dark.png') }); await page.emulateMedia({ colorScheme: 'light' });
});

await step('signing out removes the drawer and deletes this browser\'s copy of the texts', async () => {
  must((await page.evaluate(() => indexedDB.databases())).some(d => d.name.startsWith('qp-comms-')), 'the inbox is in IndexedDB');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.dispatchEvent(new Event('qp:signout')));
  await page.waitForFunction(() => !document.querySelector('#qpComms'), null, { timeout: 3000 });
  await page.waitForFunction(async () => !(await indexedDB.databases()).some(d => d.name.startsWith('qp-comms-')), null, { timeout: 4000 });
});

console.log(errors.length ? `  ✗ browser errors: ${errors.join(' | ').slice(0, 400)}` : '  ✓ no browser errors');
if (errors.length) failures++;
await browser.close(); server.kill(); telnyx.close();
if (failures) { console.log(`\n${failures} check(s) failed. Server log tail:\n${serverLog.join('').split('\n').slice(-12).join('\n')}`); process.exit(1); }
console.log('\nComms Drawer: all checks passed');
