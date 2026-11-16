// The Comms Drawer: a floating button that opens a panel with two tabs, Texts (threaded two-way
// SMS inbox) and Calls (keypad, call timer, mute, hang up, call history). Loaded only after the
// server says the module is on for this user (flag comms_drawer, off by default).
//
// Privacy: message text never lives on the server for good. It arrives over the live stream, is saved
// in THIS browser (IndexedDB, one database per user, deleted at sign-out), and the browser then tells
// the server it has it. A new device starts with an empty inbox.
//
// Accessibility (WCAG 2.2 AA): everything works from the keyboard (tabs with arrow keys, keypad
// buttons, Escape closes); focus moves into the drawer when it opens and back to the button when it
// closes; new messages and call changes are announced in a polite live region (an incoming call in an
// assertive one); status is words as well as colour; targets are at least 44 px; reduced motion is respected.
const E164 = /^\+[1-9]\d{7,14}$/;
export const toE164 = input => {
  const raw = String(input ?? '').trim();
  if (!raw || /[^\d\s().+-]/.test(raw)) return null;
  const d = raw.replace(/\D/g, '');
  const n = raw.startsWith('+') ? '+' + d : d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : null;
  return n && E164.test(n) ? n : null;
};
const mask = n => (n ? '••••' + String(n).replace(/\D/g, '').slice(-4) : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
const fmtClock = secs => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
const spoken = secs => (secs < 60 ? `${secs} seconds` : `${Math.floor(secs / 60)} minutes ${secs % 60} seconds`);

const MIC = {
  denied: 'Microphone access is blocked. Allow the microphone for this site in your browser settings (the lock icon beside the address), then try again.',
  none: 'No microphone was found. Connect one, then try again.',
  insecure: 'Calls need a secure (https) page.',
  unsupported: 'This browser cannot make calls from a web page.',
  other: 'The microphone could not be started. Please try again.',
};
async function ensureMic() {
  const fail = k => Object.assign(new Error(MIC[k]), { mic: k });
  if (!window.isSecureContext) throw fail('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw fail('unsupported');
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks?.().forEach(t => t.stop()); }
  catch (e) { throw fail(e?.name === 'NotFoundError' ? 'none' : ['NotAllowedError', 'SecurityError'].includes(e?.name) ? 'denied' : 'other'); }
}

// ---------- the softphone engine ----------
// An engine is { call(number, { callerNumber, clientState }), hangup(), answer(), mute(on), dtmf(digit), on(event, fn), destroy() }
// and emits 'state' ('ringing' | 'active' | 'ended' | 'error') and 'incoming' ({ peer }). The default engine
// wraps Telnyx's WebRTC SDK (@telnyx/webrtc), which is NOT bundled: the owner copies its browser build to
// /vendor/telnyx-webrtc.js (docs/COMMS_SETUP.md). The SDK calls below are from memory of its documentation
// and must be checked against it (ASSUMPTIONS.md B-2).
export async function telnyxEngine({ loginToken, iceServers }) {
  let mod; try { mod = await import('/vendor/telnyx-webrtc.js'); } catch { throw Object.assign(new Error('The softphone is not installed on this server yet. Ask the site owner (docs/COMMS_SETUP.md).'), { notInstalled: true }); }
  const TelnyxRTC = mod.TelnyxRTC || mod.default?.TelnyxRTC || mod.default;
  const audio = Object.assign(document.createElement('audio'), { autoplay: true }); audio.hidden = true; document.body.append(audio);
  const client = new TelnyxRTC({ login_token: loginToken, ...(iceServers?.length ? { iceServers } : {}) });
  client.remoteElement = audio;
  const subs = {}, emit = (e, d) => (subs[e] || []).forEach(f => f(d));
  let current = null;
  const ready = new Promise((res, rej) => { client.on('telnyx.ready', res); client.on('telnyx.error', rej); client.on('telnyx.socket.error', rej); setTimeout(() => rej(new Error('The softphone did not connect.')), 15000); });
  client.on('telnyx.notification', n => {
    if (n.type !== 'callUpdate' || !n.call) return;
    const c = n.call; current = c;
    if (c.direction === 'inbound' && c.state === 'ringing') emit('incoming', { peer: c.remoteCallerNumber || c.options?.remoteCallerNumber || '' });
    else if (c.state === 'ringing' || c.state === 'trying' || c.state === 'early') emit('state', 'ringing');
    else if (c.state === 'active') emit('state', 'active');
    else if (c.state === 'hangup' || c.state === 'destroy') { emit('state', 'ended'); current = null; }
  });
  client.connect();
  await ready;
  return {
    call: (number, { callerNumber, clientState }) => { current = client.newCall({ destinationNumber: number, callerNumber, clientState }); },
    hangup: () => current?.hangup(), answer: () => current?.answer(), mute: on => (on ? current?.muteAudio() : current?.unmuteAudio()), dtmf: d => current?.dtmf(d),
    on: (e, f) => (subs[e] ||= []).push(f), destroy: () => { try { client.disconnect(); audio.remove(); } catch {} },
  };
}

// ---------- this browser's copy of the inbox ----------
function openStore(userId) {
  let db = null, msgs = [];
  const ready = new Promise(res => {
    try {
      const r = indexedDB.open('qp-comms-' + userId, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('msgs', { keyPath: 'k' });
      r.onsuccess = () => { db = r.result; const all = db.transaction('msgs').objectStore('msgs').getAll(); all.onsuccess = () => { msgs = all.result || []; res(); }; all.onerror = () => res(); };
      r.onerror = () => res();
    } catch { res(); }
  });
  const put = m => { try { db?.transaction('msgs', 'readwrite').objectStore('msgs').put(m); } catch {} };
  return {
    ready, all: () => msgs, put,
    add(m) { m.k = m.k || (crypto.randomUUID?.() ?? String(Math.random()).slice(2)); msgs.push(m); put(m); return m; },
    async clear() { msgs = []; try { db?.close(); indexedDB.deleteDatabase('qp-comms-' + userId); } catch {} },
  };
}

export async function startComms({ userId, status = null, engineFactory = telnyxEngine, mount = document.body } = {}) {
  if (document.getElementById('qpComms')) return null;
  if (!document.querySelector('link[data-comms-css]')) { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/comms.css' }); l.dataset.commsCss = '1'; document.head.append(l); }

  const request = async (path, body) => {
    const r = await fetch('/api/comms' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong'), { status: r.status, ...d });
    return d;
  };
  const store = openStore(userId); await store.ready;
  const S = { open: false, tab: 'sms', peer: null, composing: false, status: null, missed: 0, offline: false, call: { state: 'idle', peer: '', since: 0, muted: false, callerNumber: '', secs: 0 }, history: [] };
  const peerByKey = new Map(); for (const m of store.all()) if (m.threadKey) peerByKey.set(m.threadKey, m.peer);
  try { S.status = status || await request('/status'); } catch { S.status = { enabled: false }; }
  if (!S.status.enabled) return null;

  // ---------- markup ----------
  const root = document.createElement('div'); root.id = 'qpComms'; root.className = 'cm-root';
  root.innerHTML = `
    <button type="button" class="cm-fab" aria-haspopup="dialog" aria-expanded="false" aria-controls="cm-drawer"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg><span class="cm-badge" aria-hidden="true" hidden></span><span class="cm-sr cm-fab-label">Messages and calls</span></button>
    <div class="cm-sr cm-live" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="cm-sr cm-alert" role="alert" aria-live="assertive" aria-atomic="true"></div>
    <section id="cm-drawer" class="cm-drawer" role="dialog" aria-modal="false" aria-labelledby="cm-title" tabindex="-1" hidden>
      <header class="cm-head"><h2 id="cm-title" tabindex="-1">Messages and calls</h2><span class="cm-conn" hidden>Reconnecting…</span><button type="button" class="cm-x" aria-label="Close messages and calls">×</button></header>
      <div class="cm-tabs" role="tablist" aria-label="Messages or calls">
        <button type="button" role="tab" id="cm-tab-sms" aria-controls="cm-p-sms" aria-selected="true" tabindex="0">Texts <span class="cm-n" data-n="sms"></span></button>
        <button type="button" role="tab" id="cm-tab-call" aria-controls="cm-p-call" aria-selected="false" tabindex="-1">Calls <span class="cm-n" data-n="call"></span></button>
      </div>
      <p class="cm-setup" hidden></p>
      <div role="tabpanel" id="cm-p-sms" aria-labelledby="cm-tab-sms" class="cm-panel">
        <div class="cm-threads"><div class="cm-bar"><button type="button" class="cm-btn cm-new">New message</button></div><ul class="cm-tlist" aria-label="Conversations"></ul></div>
        <div class="cm-convo" hidden>
          <div class="cm-bar"><button type="button" class="cm-btn cm-back">‹ All conversations</button><h3 class="cm-with"></h3></div>
          <div class="cm-log" role="log" aria-live="off" aria-label="Conversation" tabindex="0"></div>
          <form class="cm-form" novalidate>
            <div class="cm-field cm-to-field" hidden><label for="cm-to">To (phone number)</label><input id="cm-to" type="tel" inputmode="tel" autocomplete="off" placeholder="+1 845 555 0100" aria-describedby="cm-err"></div>
            <div class="cm-field"><label for="cm-msg">Message</label><textarea id="cm-msg" rows="3" maxlength="1600" aria-describedby="cm-err"></textarea></div>
            <label class="cm-check" hidden><input type="checkbox" id="cm-attest"> This person agreed to receive text messages from me.</label>
            <p id="cm-err" class="cm-err" role="alert" hidden></p>
            <button type="submit" class="cm-btn cm-primary">Send</button>
          </form>
        </div>
      </div>
      <div role="tabpanel" id="cm-p-call" aria-labelledby="cm-tab-call" class="cm-panel" hidden>
        <div class="cm-incoming" hidden><p class="cm-inc-text"></p><button type="button" class="cm-btn cm-primary cm-answer">Answer</button><button type="button" class="cm-btn cm-decline">Decline</button></div>
        <div class="cm-dial">
          <div class="cm-field"><label for="cm-num">Number to call</label><input id="cm-num" type="tel" inputmode="tel" autocomplete="off" placeholder="+1 845 555 0100" aria-describedby="cm-cerr"></div>
          <p class="cm-note">This dialer cannot place emergency calls. Use your phone to call 911 (or your local emergency number).</p>
          <div class="cm-pad" role="group" aria-label="Keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(k => `<button type="button" class="cm-key" data-k="${k}"><span>${k}</span><small>${{ 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '+' }[k] || ''}</small></button>`).join('')}</div>
          <p class="cm-cstate" aria-live="off">Ready to call.</p>
          <output class="cm-timer" role="timer" aria-live="off" aria-label="Call time">00:00</output>
          <p id="cm-cerr" class="cm-err" role="alert" hidden></p>
          <div class="cm-actions"><button type="button" class="cm-btn cm-primary cm-call">Call</button><button type="button" class="cm-btn cm-mute" aria-pressed="false" hidden>Mute</button><button type="button" class="cm-btn cm-hang" hidden>Hang up</button></div>
        </div>
        <h3 class="cm-h">Recent calls</h3><ul class="cm-hist" aria-label="Recent calls"></ul>
      </div>
    </section>`;
  mount.append(root);
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const fab = $('.cm-fab'), drawer = $('#cm-drawer'), live = $('.cm-live'), alertEl = $('.cm-alert');
  const announce = (t, assertive = false) => { const el = assertive ? alertEl : live; el.textContent = ''; setTimeout(() => (el.textContent = t), 40); };
  const showErr = (el, text) => { el.textContent = text || ''; el.hidden = !text; };

  // ---------- state helpers ----------
  const threads = () => {
    const by = new Map();
    for (const m of store.all()) { const t = by.get(m.peer) || { peer: m.peer, last: m, unread: 0 }; if (m.at >= t.last.at) t.last = m; if (m.unread) t.unread++; by.set(m.peer, t); }
    return [...by.values()].sort((a, b) => b.last.at - a.last.at);
  };
  const unreadTexts = () => store.all().filter(m => m.unread).length;
  const total = () => unreadTexts() + S.missed;
  const updateBadge = () => {
    const n = total(), b = $('.cm-badge');
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
    $('.cm-fab-label').textContent = n ? `Messages and calls, ${n} unread` : 'Messages and calls';
    const t = unreadTexts();
    $('[data-n=sms]').textContent = t ? `(${t} new)` : ''; $('[data-n=call]').textContent = S.missed ? `(${S.missed} missed)` : '';
  };

  // ---------- Texts ----------
  const STATUS_TEXT = { queued: 'Sending…', sent: 'Sent', delivered: 'Delivered', failed: 'Not delivered' };
  function renderThreads() {
    const ts = threads(), ul = $('.cm-tlist');
    ul.innerHTML = ts.length ? ts.map(t => `<li><button type="button" class="cm-thread" data-peer="${esc(t.peer)}"><span class="cm-who">${esc(t.peer)}</span>${t.unread ? `<span class="cm-new">${t.unread} new</span>` : ''}<span class="cm-snip">${esc(t.last.dir === 'out' ? 'You: ' : '')}${esc(t.last.text.slice(0, 60))}</span><time>${esc(fmtTime(t.last.at))}</time></button></li>`).join('') : '<li class="cm-empty">No conversations on this device yet. Choose “New message”, or wait for a text.</li>';
  }
  function renderConvo() {
    const convo = $('.cm-convo'), list = $('.cm-threads');
    const show = S.peer !== null || S.composing;
    convo.hidden = !show; list.hidden = show;
    $('.cm-to-field').hidden = !S.composing;
    if (!show) return;
    $('.cm-with').textContent = S.composing ? 'New message' : S.peer;
    $('.cm-log').setAttribute('aria-label', S.composing ? 'New conversation' : `Conversation with ${S.peer}`);
    const msgs = S.composing ? [] : store.all().filter(m => m.peer === S.peer).sort((a, b) => a.at - b.at);
    $('.cm-log').innerHTML = msgs.map(m => m.sys ? `<p class="cm-sys">${esc(m.text)}</p>` : `<div class="cm-msg cm-${m.dir}"><p>${esc(m.text)}</p><small>${m.dir === 'out' ? 'You' : 'Them'}, ${esc(fmtTime(m.at))}${m.dir === 'out' && m.status ? ' · ' + esc(STATUS_TEXT[m.status] || m.status) : ''}</small></div>`).join('') || '<p class="cm-empty">No messages yet.</p>';
    const log = $('.cm-log'); log.scrollTop = log.scrollHeight;
    const known = !S.composing && msgs.length > 0;
    $('.cm-check').hidden = known;
  }
  function openThread(peer) {
    S.peer = peer; S.composing = false;
    for (const m of store.all()) if (m.peer === peer && m.unread) { m.unread = false; store.put(m); }
    renderConvo(); updateBadge(); showErr($('#cm-err'), '');
    $('.cm-log').focus();
  }
  function render() { renderThreads(); renderConvo(); updateBadge(); }

  let ackQ = [], ackT = null;
  const ack = id => { ackQ.push(id); clearTimeout(ackT); ackT = setTimeout(() => { const ids = ackQ.splice(0); request('/sms/ack', { ids }).catch(() => ackQ.unshift(...ids)); }, 250); };
  function onReceived(d) {
    if (d.id && store.all().some(m => m.dir === 'in' && m.sid === d.id)) { ack(d.id); return; } // replay after a reconnect
    if (d.threadKey) peerByKey.set(d.threadKey, d.peer);
    const viewing = S.open && S.tab === 'sms' && S.peer === d.peer;
    store.add({ peer: d.peer, threadKey: d.threadKey, dir: 'in', text: String(d.text ?? ''), at: d.at || Date.now(), sid: d.id, unread: !viewing });
    ack(d.id); render();
    announce(`New text from ${mask(d.peer)}: ${String(d.text ?? '').slice(0, 140)}`);
  }
  function systemNote(peer, text) { store.add({ peer, dir: 'in', text, at: Date.now(), sys: true }); render(); announce(text); }

  $('.cm-tlist').addEventListener('click', e => { const b = e.target.closest('.cm-thread'); if (b) openThread(b.dataset.peer); });
  $('.cm-new').addEventListener('click', () => { S.composing = true; S.peer = null; renderConvo(); $('#cm-to').focus(); });
  $('.cm-back').addEventListener('click', () => { S.peer = null; S.composing = false; renderThreads(); renderConvo(); showErr($('#cm-err'), ''); $('.cm-new').focus(); });
  $('.cm-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#cm-err'), btn = $('.cm-form .cm-primary'), text = $('#cm-msg').value;
    const to = S.composing ? toE164($('#cm-to').value) : S.peer;
    if (!to) { showErr(err, 'Enter the number with its area code, like (845) 555-0100, or with a country code, like +44 20 7183 8750.'); $('#cm-to').focus(); return; }
    if (!text.trim()) { showErr(err, 'Write a message first.'); $('#cm-msg').focus(); return; }
    const isNew = !store.all().some(m => m.peer === to && !m.sys);
    if (isNew && !$('#cm-attest').checked) { $('.cm-check').hidden = false; showErr(err, 'Please confirm that this person agreed to receive texts from you.'); $('#cm-attest').focus(); return; }
    btn.disabled = true; showErr(err, '');
    try {
      const r = await request('/sms/send', { to, text, attest: isNew ? true : undefined });
      if (r.threadKey) peerByKey.set(r.threadKey, to);
      store.add({ peer: to, threadKey: r.threadKey, dir: 'out', text, at: Date.now(), sid: r.id, status: r.status || 'queued' });
      $('#cm-msg').value = ''; $('#cm-attest').checked = false; S.composing = false; S.peer = to;
      render(); $('#cm-msg').focus(); announce('Message sent.');
    } catch (ex) {
      if (ex.needsConsent) { $('.cm-check').hidden = false; $('#cm-attest').focus(); }
      const when = ex.resumesAt ? ` You can send again at ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ex.resumesAt)}.` : '';
      showErr(err, ex.message + (ex.quietHours ? when : ''));
    } finally { btn.disabled = false; }
  });
  $('#cm-msg').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('.cm-form').requestSubmit(); } });

  // ---------- Calls ----------
  let engine = null, tick = null;
  const cstate = text => { $('.cm-cstate').textContent = text; };
  function renderCall() {
    const c = S.call, active = ['dialing', 'ringing', 'active'].includes(c.state);
    $('.cm-call').hidden = active; $('.cm-hang').hidden = !active; $('.cm-mute').hidden = c.state !== 'active';
    $('#cm-num').disabled = active;
    $('.cm-mute').setAttribute('aria-pressed', String(c.muted)); $('.cm-mute').textContent = c.muted ? 'Unmute' : 'Mute';
    const timer = $('.cm-timer'); timer.textContent = fmtClock(c.secs); timer.hidden = !(c.state === 'active' || c.state === 'ended');
    $('.cm-incoming').hidden = c.state !== 'incoming';
  }
  const startTimer = () => { clearInterval(tick); S.call.since = Date.now(); S.call.secs = 0; tick = setInterval(() => { S.call.secs = Math.round((Date.now() - S.call.since) / 1000); $('.cm-timer').textContent = fmtClock(S.call.secs); }, 1000); };
  const endCall = (why = 'Call ended.') => {
    if (S.call.state === 'ended' || S.call.state === 'idle') return; // the SDK also reports the hang-up: say it once
    clearInterval(tick); const had = S.call.state === 'active', secs = S.call.secs;
    S.call = { ...S.call, state: 'ended', muted: false };
    cstate(had ? `${why} It lasted ${spoken(secs)}.` : why); announce(had ? `${why} It lasted ${spoken(secs)}.` : why);
    renderCall(); loadHistory(); setTimeout(() => { if (S.call.state === 'ended') { S.call.state = 'idle'; renderCall(); } }, 4000);
  };
  function hook(eng) {
    eng.on('state', s => {
      if (s === 'ringing' && S.call.state !== 'incoming') { S.call.state = 'ringing'; cstate('Ringing…'); announce('Ringing'); }
      else if (s === 'active') { S.call.state = 'active'; startTimer(); cstate('Connected.'); announce('Call connected'); }
      else if (s === 'ended') endCall(); else if (s === 'error') { endCall('The call could not be completed.'); }
      renderCall();
    });
    eng.on('incoming', d => {
      S.call = { ...S.call, state: 'incoming', peer: d.peer || '' };
      $('.cm-inc-text').textContent = `Incoming call from ${d.peer ? mask(d.peer) : 'an unknown number'}`;
      announce($('.cm-inc-text').textContent, true); openDrawer('call'); renderCall(); $('.cm-answer').focus();
    });
  }
  async function getEngine() {
    if (engine) return engine;
    const login = await request('/webrtc/login', {});
    S.call.callerNumber = login.callerNumber;
    engine = await engineFactory({ loginToken: login.loginToken, iceServers: login.iceServers });
    hook(engine); return engine;
  }
  $('.cm-pad').addEventListener('click', e => {
    const k = e.target.closest('.cm-key')?.dataset.k; if (!k) return;
    if (S.call.state === 'active') { engine?.dtmf(k); announce(`Sent ${k}`); return; }
    const i = $('#cm-num'); i.value += k; i.focus();
  });
  $('.cm-call').addEventListener('click', async () => {
    const err = $('#cm-cerr'), to = toE164($('#cm-num').value); showErr(err, '');
    if (!to) { showErr(err, 'Enter the number with its area code, or with a country code like +44.'); $('#cm-num').focus(); return; }
    const btn = $('.cm-call'); btn.disabled = true;
    try {
      await ensureMic();
      const eng = await getEngine();
      const reg = await request('/calls/outbound', { to });
      S.call = { ...S.call, state: 'dialing', peer: to, muted: false, secs: 0 }; cstate(`Calling ${mask(to)}…`); announce(`Calling ${mask(to)}`); renderCall();
      eng.call(to, { callerNumber: reg.callerNumber, clientState: reg.clientState });
      $('.cm-hang').focus();
    } catch (ex) { showErr(err, ex.message); if (ex.mic) alertEl.textContent = ex.message; $('.cm-call').focus(); }
    finally { btn.disabled = false; }
  });
  $('.cm-hang').addEventListener('click', () => { engine?.hangup(); endCall('Call ended.'); $('.cm-call').focus(); });
  $('.cm-mute').addEventListener('click', () => { S.call.muted = !S.call.muted; engine?.mute(S.call.muted); renderCall(); announce(S.call.muted ? 'Microphone muted' : 'Microphone on'); });
  $('.cm-answer').addEventListener('click', async () => { try { await ensureMic(); engine?.answer(); S.call.state = 'ringing'; renderCall(); $('.cm-hang').focus(); } catch (ex) { showErr($('#cm-cerr'), ex.message); } });
  $('.cm-decline').addEventListener('click', () => { engine?.hangup(); S.call.state = 'idle'; renderCall(); $('.cm-call').focus(); });
  $('#cm-num').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('.cm-call').click(); } });

  async function loadHistory() {
    try {
      const { calls } = await request('/calls'); S.history = calls;
      $('.cm-hist').innerHTML = calls.length ? calls.map(c => {
        const peer = peerByKey.get(c.threadKey), kind = c.status === 'missed' ? 'Missed call' : c.direction === 'in' ? 'Incoming call' : 'Outgoing call';
        return `<li><span class="cm-kind${c.status === 'missed' ? ' cm-missed' : ''}">${kind}</span> <span>${esc(peer || '••••' + (c.peerLast4 || '????'))}</span> <time>${esc(fmtTime(c.startedAt))}</time>${c.durationS ? `<span>${esc(fmtClock(c.durationS))}</span>` : ''}${peer ? `<button type="button" class="cm-btn cm-cb" data-peer="${esc(peer)}">Call back</button>` : ''}</li>`;
      }).join('') : '<li class="cm-empty">No calls yet.</li>';
    } catch {}
  }
  $('.cm-hist').addEventListener('click', e => { const b = e.target.closest('.cm-cb'); if (b) { $('#cm-num').value = b.dataset.peer; $('#cm-num').focus(); } });

  // ---------- drawer, tabs, focus ----------
  let lastFocus = null;
  function setTab(tab, focus = false) {
    S.tab = tab;
    for (const t of ['sms', 'call']) { const on = t === tab; const b = $('#cm-tab-' + t); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; $('#cm-p-' + t).hidden = !on; if (on && focus) b.focus(); }
    if (tab === 'call') { loadHistory(); if (S.missed) { S.missed = 0; request('/calls/seen', {}).catch(() => {}); updateBadge(); } }
  }
  function openDrawer(tab) {
    if (!S.open) lastFocus = document.activeElement;
    S.open = true; drawer.hidden = false; fab.setAttribute('aria-expanded', 'true');
    if (tab) setTab(tab); render(); drawer.querySelector('#cm-title').focus();
  }
  function closeDrawer() { S.open = false; drawer.hidden = true; fab.setAttribute('aria-expanded', 'false'); (lastFocus && document.contains(lastFocus) ? lastFocus : fab).focus(); }
  fab.addEventListener('click', () => (S.open ? closeDrawer() : openDrawer()));
  $('.cm-x').addEventListener('click', closeDrawer);
  drawer.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); } });
  const tabs = $$('[role=tab]');
  $('.cm-tabs').addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const j = { ArrowRight: (i + 1) % 2, ArrowLeft: (i + 1) % 2, Home: 0, End: 1 }[e.key]; if (j === undefined) return;
    e.preventDefault(); setTab(j ? 'call' : 'sms', true);
  });
  tabs.forEach((t, i) => t.addEventListener('click', () => setTab(i ? 'call' : 'sms')));

  // ---------- setup notes ----------
  const note = $('.cm-setup');
  if (!S.status.configured) { note.hidden = false; note.textContent = 'Texts and calls are not connected to a provider yet. Ask the site owner to finish the setup.'; }
  else if (!S.status.number) { note.hidden = false; note.textContent = 'No phone number has been assigned to your account yet. Ask the site owner.'; }

  // In softphone mode the browser registers with the provider as soon as the drawer starts, so an incoming call can ring it.
  if (S.status.configured && S.status.number && S.status.voiceMode === 'softphone') {
    getEngine().catch(ex => { if (ex.notInstalled) { note.hidden = false; note.textContent = ex.message; } });
  }

  // ---------- live stream ----------
  const es = new EventSource('/api/comms/events');
  es.addEventListener('ready', e => { S.offline = false; $('.cm-conn').hidden = true; try { S.missed = JSON.parse(e.data).missedCalls || 0; } catch {} updateBadge(); });
  es.addEventListener('sms.received', e => onReceived(JSON.parse(e.data)));
  es.addEventListener('sms.status', e => { const d = JSON.parse(e.data), m = store.all().find(x => x.dir === 'out' && x.sid === d.id); if (m) { m.status = d.status; store.put(m); renderConvo(); if (d.status === 'failed') announce('A message was not delivered.'); } });
  es.addEventListener('sms.optout', e => { const d = JSON.parse(e.data); systemNote(d.peer, `${d.peer} replied STOP. You cannot text this number until they reply START.`); });
  es.addEventListener('sms.optin', e => { const d = JSON.parse(e.data); systemNote(d.peer, `${d.peer} replied START. You can text this number again.`); });
  es.addEventListener('call.incoming', e => { const d = JSON.parse(e.data); if (d.threadKey) peerByKey.set(d.threadKey, d.peer); });
  es.addEventListener('call.missed', e => { const d = JSON.parse(e.data); S.missed++; updateBadge(); announce('Missed call'); if (S.open && S.tab === 'call') loadHistory(); void d; });
  es.addEventListener('call.ended', () => { if (S.open && S.tab === 'call') loadHistory(); });
  es.onerror = () => { S.offline = true; $('.cm-conn').hidden = false; };

  const onSignOut = () => destroy(true);
  document.addEventListener('qp:signout', onSignOut);
  function destroy(wipe) { es.close(); engine?.destroy?.(); clearInterval(tick); root.remove(); document.removeEventListener('qp:signout', onSignOut); if (wipe) store.clear(); }
  render(); renderCall();
  return { open: openDrawer, close: closeDrawer, destroy, state: () => S };
}
