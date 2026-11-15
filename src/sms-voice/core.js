// SMS and voice module, core logic. It talks to the outside world only through the provider adapter
// (adapter.js) and to the rest of the app only through: the users table (user_id), requireUser (in
// routes.js), the encryption helpers, the rate limiter and the feature flag.
//
// What is stored (see ASSUMPTIONS.md B-5): who, which number, status, timestamps and a keyed hash of the
// other party's number (thread_key) plus its last four digits. NOT stored: message text (an inbound
// text waits encrypted in sms_messages.pending_body until the browser confirms it, at most 72 hours;
// the history lives on the user's device), recordings, call audio. Logs carry ids and codes, never
// numbers or text.
import crypto from 'node:crypto';
import { run, one, all } from '../db.js';
import { encrypt, tryDecrypt, hmac } from '../crypto.js';
import { rateLimit } from '../auth.js';
import { flagSettings, isOn } from '../flags.js';
import { isE164, last4 } from './phone.js';
import { getAdapter, ProviderError } from './adapter.js';
import * as sse from './sse.js';

export const clock = { now: () => Date.now() }; // tests move it

// ---------- switch ----------
// The module is off unless the owner turns the flag on (Admin → SEO → Feature flags); a percentage
// switches it on for that share of signed-in users.
export const moduleOn = () => !!flagSettings().comms_drawer?.on;
export const userOn = user => !!user && isOn('comms_drawer', String(user.id));

// ---------- settings ----------
const int = (v, d, lo, hi) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
export function cfg(env = process.env) {
  return {
    quietStart: int(env.COMMS_QUIET_START, 21, 0, 23), quietEnd: int(env.COMMS_QUIET_END, 8, 0, 23),
    quietTz: validTz(env.COMMS_QUIET_TZ) ? env.COMMS_QUIET_TZ : 'America/New_York',
    pendingTtlMs: 72 * 3600e3, replyWindowMs: 24 * 3600e3,
    recording: env.COMMS_RECORDING === 'announce' ? 'announce' : 'off', // off unless the owner opts in
    recordingNotice: 'This call may be recorded.',
    sendPerHour: int(env.COMMS_SEND_PER_HOUR, 30, 1, 1000), sendPerDay: int(env.COMMS_SEND_PER_DAY, 200, 1, 10000),
    callsPerHour: int(env.COMMS_CALLS_PER_HOUR, 20, 1, 500), retentionDays: int(env.COMMS_RETENTION_DAYS, 365, 7, 3650),
    helpText: String(env.COMMS_HELP_TEXT || 'Brightolio messages. Msg and data rates may apply. Reply STOP to unsubscribe. See our website for contact details.').slice(0, 320),
    defaultGreeting: 'Thank you for calling. Nobody is available to take your call right now. Please send a text message instead.',
  };
}

// ---------- logging: ids, codes and counts only ----------
export function clog(level, event, meta = {}) {
  const safe = {};
  for (const k of ['kind', 'reason', 'status', 'code', 'provider', 'messageId', 'callId', 'userId', 'action', 'n']) if (meta[k] !== undefined) safe[k] = meta[k];
  (console[level] || console.log)(JSON.stringify({ at: new Date().toISOString(), src: 'comms', event, ...safe }));
}
const bad = (message, status = 400, code = null, extra = {}) => Object.assign(new Error(message), { status, code, extra });

// ---------- threads ----------
export const threadKey = (userId, peer) => hmac(`comms:${userId}:${peer}`);

// ---------- text-message keywords (CTIA opt-out words) ----------
const STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']), START = new Set(['START', 'UNSTOP']), HELP = new Set(['HELP', 'INFO']);
export function keywordOf(text) {
  const t = String(text ?? '').trim().toUpperCase().replace(/[\s.!]+$/, '');
  return STOP.has(t) ? 'stop' : START.has(t) ? 'start' : HELP.has(t) ? 'help' : null;
}

// ---------- quiet hours ----------
// Texts are paused from quietStart:00 to quietEnd:00 (default 21:00 to 08:00) in COMMS_QUIET_TZ, unless
// the other person wrote to us within the last 24 hours (a reply in a conversation they started).
export function hourIn(tz, at) { return +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(at); }
export function inQuietHours(at, { quietStart, quietEnd, quietTz }) {
  const h = hourIn(quietTz, at);
  return quietStart > quietEnd ? h >= quietStart || h < quietEnd : h >= quietStart && h < quietEnd;
}
export function quietResumesAt(at, c) { let t = at; for (let i = 0; i < 26 * 4 && inQuietHours(t, c); i++) t += 15 * 60e3; return t; }

// ---------- consent ----------
const consentOf = (userId, key) => one('SELECT status, source, last_inbound_at FROM sms_consent WHERE user_id = ? AND thread_key = ?', userId, key);
async function setConsent(userId, key, status, source, inboundAt = null) {
  const t = clock.now();
  await run('INSERT INTO sms_consent (user_id, thread_key, status, source, last_inbound_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, thread_key) DO UPDATE SET status = excluded.status, source = excluded.source, last_inbound_at = COALESCE(excluded.last_inbound_at, sms_consent.last_inbound_at), updated_at = excluded.updated_at',
    userId, key, status, source, inboundAt, t);
}

// ---------- sending ----------
export async function sendSms(user, body = {}, { adapter = getAdapter() } = {}) {
  const to = String(body.to ?? '').trim(), text = String(body.text ?? '').replace(/\u0000/g, '');
  if (!isE164(to)) throw bad('Enter the number with its country code, like +18455551234.', 400, 'bad_number');
  if (!text.trim()) throw bad('Write a message first.', 400, 'empty');
  if (text.length > 1600) throw bad('That message is too long (1,600 characters at most).', 400, 'too_long');
  const mine = await one('SELECT number FROM comms_numbers WHERE user_id = ?', user.id);
  if (!mine) throw bad('No text-message number is set up for your account yet.', 409, 'no_number');
  if (to === mine.number) throw bad('That is your own number.', 400, 'own_number');
  const c = cfg();
  if (!rateLimit(`comms:sms:h:${user.id}`, c.sendPerHour, 3600e3) || !rateLimit(`comms:sms:d:${user.id}`, c.sendPerDay, 864e5)) throw bad('You are sending messages too quickly. Please wait a little.', 429, 'rate_limited');
  const key = threadKey(user.id, to), consent = await consentOf(user.id, key), at = clock.now();
  if (consent?.status === 'opted_out') throw bad('This person replied STOP, so you cannot text them. They can send START to turn texts back on.', 403, 'opted_out');
  if (!consent && body.attest !== true) throw bad('Confirm that this person agreed to receive texts from you.', 428, 'consent_required', { needsConsent: true });
  const replying = consent?.last_inbound_at && at - consent.last_inbound_at < c.replyWindowMs;
  if (!replying && inQuietHours(at, c)) {
    throw bad(`Texts to new people are paused from ${c.quietStart}:00 to ${c.quietEnd}:00 (${c.quietTz}). You can send again later, or reply once they text you.`, 403, 'quiet_hours', { quietHours: true, resumesAt: quietResumesAt(at, c) });
  }
  let sent;
  try { sent = await adapter.sendSms({ from: mine.number, to, text }); }
  catch (e) {
    clog('warn', 'sms_send_failed', { userId: user.id, provider: adapter.name, status: e.status, code: e.code });
    if (e instanceof ProviderError) throw bad(e.status === 429 ? 'The messaging service is busy. Please try again in a moment.' : 'The message could not be sent right now. Please try again.', e.status === 429 ? 429 : 502, 'provider_error');
    throw e;
  }
  if (!consent) await setConsent(user.id, key, 'opted_in', 'user_attested'); // recorded only once the send went through
  const r = await run('INSERT OR IGNORE INTO sms_messages (user_id, provider, provider_message_id, direction, thread_key, peer_last4, our_number, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    user.id, adapter.name, sent.messageId, 'out', key, last4(to), mine.number, sent.status || 'queued', at, at);
  return { id: Number(r.lastInsertRowid) || null, status: sent.status || 'queued', threadKey: key };
}

// ---------- webhook ingestion ----------
// ingestSms / ingestVoice do the database work that must be done before the provider gets its 200,
// and return `after`: side effects (live updates, API commands, auto-replies) run once the response is sent.
const inflight = new Set();
export function runAfter(after = []) {
  for (const fn of after) {
    const p = Promise.resolve().then(fn).catch(e => clog('warn', 'after_failed', { reason: e?.name, status: e?.status, code: e?.code })).finally(() => inflight.delete(p));
    inflight.add(p);
  }
}
export const settled = () => Promise.allSettled([...inflight]);

// The id a webhook event is remembered by (the provider's own id; a derived one if it sent none).
export const eventKey = (ev, kind) => ev.eventId || (kind === 'sms' ? `sms:${ev.messageId}:${ev.type}:${ev.status}` : `voice:${ev.callId}:${ev.type}`);
// If processing failed after the event was claimed, forget it so the provider's retry is handled.
export const releaseClaim = (ev, kind) => run('DELETE FROM comms_webhook_events WHERE id = ?', eventKey(ev, kind));
async function claim(id, kind) {
  const r = await run('INSERT OR IGNORE INTO comms_webhook_events (id, kind, at) VALUES (?,?,?)', id, kind, clock.now());
  return r.changes === 1;
}

export async function ingestSms(ev, adapter = getAdapter()) {
  if (!(await claim(eventKey(ev, 'sms'), 'sms'))) return { outcome: 'duplicate', after: [] };
  return ev.type === 'received' ? receiveSms(ev, adapter) : statusSms(ev, adapter);
}

async function receiveSms(ev, adapter) {
  const at = clock.now(), peer = ev.from, to = ev.to;
  if (!isE164(to) || !isE164(peer) || !ev.messageId) return { outcome: 'invalid', after: [] };
  const num = await one('SELECT user_id, number FROM comms_numbers WHERE number = ?', to);
  if (!num) { clog('info', 'sms_unrouted', { provider: adapter.name }); return { outcome: 'unrouted', after: [] }; }
  const userId = num.user_id, key = threadKey(userId, peer), kw = keywordOf(ev.text), c = cfg();
  const pending = kw === 'stop' ? null : encrypt({ t: String(ev.text).slice(0, 1600), p: peer, at: ev.occurredAt }); // a STOP is acted on, not kept
  const ins = await run('INSERT OR IGNORE INTO sms_messages (user_id, provider, provider_message_id, direction, thread_key, peer_last4, our_number, status, pending_body, pending_until, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    userId, adapter.name, ev.messageId, 'in', key, last4(peer), to, 'received', pending, pending ? at + c.pendingTtlMs : null, at, at);
  if (!ins.changes) return { outcome: 'duplicate', after: [] };
  const id = Number(ins.lastInsertRowid), after = [];
  if (kw === 'stop') { await setConsent(userId, key, 'opted_out', 'inbound_stop', at); after.push(() => sse.publish(userId, 'sms.optout', { id, peer, threadKey: key, at: ev.occurredAt })); }
  else if (kw === 'start') { await setConsent(userId, key, 'opted_in', 'inbound_start', at); after.push(() => sse.publish(userId, 'sms.optin', { id, peer, threadKey: key, at: ev.occurredAt })); }
  else {
    // They wrote to us: that is consent to answer in this conversation (unless they had opted out).
    if (!(await consentOf(userId, key))) await setConsent(userId, key, 'opted_in', 'inbound_reply', at);
    else await run('UPDATE sms_consent SET last_inbound_at = ? WHERE user_id = ? AND thread_key = ?', at, userId, key);
    after.push(() => sse.publish(userId, 'sms.received', { id, peer, threadKey: key, text: ev.text, at: ev.occurredAt }));
  }
  if (kw === 'help' && process.env.COMMS_HELP_REPLY !== 'off') {
    after.push(async () => {
      const sent = await adapter.sendSms({ from: to, to: peer, text: c.helpText });
      await run('INSERT OR IGNORE INTO sms_messages (user_id, provider, provider_message_id, direction, thread_key, peer_last4, our_number, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', userId, adapter.name, sent.messageId, 'out', key, last4(peer), to, sent.status || 'queued', clock.now(), clock.now());
    });
  }
  return { outcome: kw === 'stop' ? 'opt_out' : kw === 'start' ? 'opt_in' : kw === 'help' ? 'help' : 'received', userId, id, after };
}

const SMS_RANK = { queued: 1, sent: 2, delivered: 3, failed: 3 };
async function statusSms(ev, adapter) {
  const row = await one("SELECT id, user_id, status FROM sms_messages WHERE provider = ? AND provider_message_id = ? AND direction = 'out'", adapter.name, ev.messageId);
  if (!row) return { outcome: 'unknown_message', after: [] };
  // Provider events can arrive late or twice: a status only moves forward, and delivered / failed are final.
  if (!SMS_RANK[ev.status] || SMS_RANK[row.status] >= SMS_RANK[ev.status]) return { outcome: 'stale', after: [] };
  await run('UPDATE sms_messages SET status = ?, error_code = ?, updated_at = ? WHERE id = ?', ev.status, ev.errorCode, clock.now(), row.id);
  return { outcome: 'status', userId: row.user_id, id: row.id, after: [() => sse.publish(row.user_id, 'sms.status', { id: row.id, status: ev.status, errorCode: ev.errorCode })] };
}

// ---------- calls ----------
const callRow = (provider, id) => one('SELECT * FROM call_records WHERE provider = ? AND provider_call_id = ?', provider, id);
const cmd = (adapter, callId, action, params = {}) => () => adapter.voiceCommand(callId, action, params);
const say = (adapter, callId, text) => cmd(adapter, callId, 'speak', { payload: text, voice: 'female', language: 'en-US' });

export async function ingestVoice(ev, adapter = getAdapter()) {
  if (!(await claim(eventKey(ev, 'voice'), 'voice'))) return { outcome: 'duplicate', after: [] };
  const at = clock.now(), c = cfg();
  if (ev.type === 'initiated') return ev.direction === 'in' ? incomingCall(ev, adapter, at, c) : outgoingCall(ev, adapter, at);
  const row = await callRow(adapter.name, ev.sessionId || ev.callId);
  if (!row) return { outcome: 'unknown_call', after: [] };
  const mine = ev.callId === row.leg_id, after = [];

  if (ev.type === 'answered') {
    if (row.direction === 'in' && mine && ['greeting', 'notice'].includes(row.stage)) {
      // We answered the caller ourselves: play the greeting, or the recording notice before the call is put through.
      const num = await one('SELECT greeting FROM comms_numbers WHERE user_id = ? AND number = ?', row.user_id, row.our_number);
      if (row.stage === 'greeting') after.push(say(adapter, ev.callId, num?.greeting || c.defaultGreeting));
      else if (row.stage === 'notice') after.push(say(adapter, ev.callId, c.recordingNotice));
      await run("UPDATE call_records SET stage = 'speaking' WHERE id = ?", row.id);
      return { outcome: 'system_answer', userId: row.user_id, id: row.id, after };
    }
    if (row.status !== 'ringing' && row.status !== 'dialing') return { outcome: 'stale', after: [] };
    // A person picked up (the softphone leg of an incoming call, or the far end of an outgoing one).
    await run("UPDATE call_records SET status = 'answered', answered_at = ? WHERE id = ?", at, row.id);
    after.push(() => sse.publish(row.user_id, 'call.answered', { id: row.id, at }));
    return { outcome: 'answered', userId: row.user_id, id: row.id, after };
  }

  if (ev.type === 'speak_ended' && mine) {
    if (row.handling === 'ivr') after.push(cmd(adapter, ev.callId, 'hangup'));
    else if (row.handling === 'softphone') {
      const num = await one('SELECT sip_username FROM comms_numbers WHERE user_id = ?', row.user_id);
      if (c.recording === 'announce') after.push(cmd(adapter, ev.callId, 'record_start', { format: 'mp3', channels: 'dual' }));
      after.push(cmd(adapter, ev.callId, 'transfer', { to: adapter.sipTarget(num?.sip_username || ''), timeout_secs: 30 }));
      await run("UPDATE call_records SET stage = 'ringing' WHERE id = ?", row.id);
    }
    return { outcome: 'speak_ended', userId: row.user_id, id: row.id, after };
  }

  if (ev.type === 'hangup') {
    if (row.direction === 'in' && !mine) {
      // The softphone leg ended. If nobody answered, the caller is still on the line: play the message and hang up.
      if (row.status === 'ringing' && row.handling === 'softphone') {
        const num = await one('SELECT greeting FROM comms_numbers WHERE user_id = ? AND number = ?', row.user_id, row.our_number);
        await run("UPDATE call_records SET handling = 'ivr', stage = 'speaking' WHERE id = ?", row.id);
        after.push(say(adapter, row.leg_id, num?.greeting || c.defaultGreeting));
        return { outcome: 'fallback_to_greeting', userId: row.user_id, id: row.id, after };
      }
      return { outcome: 'other_leg', after: [] };
    }
    if (row.ended_at) return { outcome: 'stale', after: [] };
    const answered = !!row.answered_at, status = answered ? 'completed' : row.direction === 'in' ? 'missed' : 'no_answer';
    const duration = answered ? Math.max(0, Math.round((at - row.answered_at) / 1000)) : 0;
    await run('UPDATE call_records SET status = ?, ended_at = ?, duration_s = ? WHERE id = ?', status, at, duration, row.id);
    after.push(() => sse.publish(row.user_id, 'call.ended', { id: row.id, status, duration }));
    if (status === 'missed') after.push(() => sse.publish(row.user_id, 'call.missed', { id: row.id, at }));
    return { outcome: status, userId: row.user_id, id: row.id, after };
  }
  return { outcome: 'ignored', after: [] };
}

async function incomingCall(ev, adapter, at, c) {
  const num = await one('SELECT user_id, number, voice_mode, sip_username FROM comms_numbers WHERE number = ?', ev.to);
  if (!num) { clog('info', 'call_unrouted', { provider: adapter.name }); return { outcome: 'unrouted', after: [] }; }
  const peer = isE164(ev.from) ? ev.from : 'unknown';
  // Ring the browser softphone only if the user has it open and a softphone address; otherwise the greeting.
  const ring = num.voice_mode === 'softphone' && sse.online(num.user_id) && !!num.sip_username;
  const handling = ring ? 'softphone' : 'ivr', stage = !ring ? 'greeting' : c.recording === 'announce' ? 'notice' : 'ringing';
  const ins = await run('INSERT OR IGNORE INTO call_records (user_id, provider, provider_call_id, leg_id, direction, thread_key, peer_last4, our_number, status, handling, stage, started_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    num.user_id, adapter.name, ev.sessionId || ev.callId, ev.callId, 'in', threadKey(num.user_id, peer), last4(peer), num.number, 'ringing', handling, stage, at, at);
  if (!ins.changes) return { outcome: 'duplicate', after: [] };
  const id = Number(ins.lastInsertRowid), after = [];
  if (ring && stage === 'ringing') after.push(cmd(adapter, ev.callId, 'transfer', { to: adapter.sipTarget(num.sip_username), timeout_secs: 30 }));
  else after.push(cmd(adapter, ev.callId, 'answer'));
  if (ring) after.push(() => sse.publish(num.user_id, 'call.incoming', { id, peer, at, threadKey: threadKey(num.user_id, peer) }));
  return { outcome: ring ? 'ring_softphone' : 'greeting', userId: num.user_id, id, after };
}

async function outgoingCall(ev, adapter, at) {
  let ref = ''; try { ref = Buffer.from(ev.clientState, 'base64').toString('utf8'); } catch {}
  if (!/^[a-f0-9]{16}$/.test(ref)) return { outcome: 'ignored', after: [] };
  const r = await run("UPDATE call_records SET provider_call_id = ?, leg_id = ?, status = 'ringing' WHERE provider = ? AND provider_call_id = ? AND direction = 'out' AND status = 'dialing'", ev.sessionId || ev.callId, ev.callId, adapter.name, 'ref:' + ref);
  return { outcome: r.changes ? 'outgoing' : 'ignored', after: [] };
}

// A call placed from the web dialer is registered first, so its events can be matched to the user.
export async function startOutboundCall(user, to, { adapter = getAdapter() } = {}) {
  if (!isE164(String(to ?? ''))) throw bad('Enter the number with its country code, like +18455551234.', 400, 'bad_number');
  const mine = await one('SELECT number FROM comms_numbers WHERE user_id = ?', user.id);
  if (!mine) throw bad('No phone number is set up for your account yet.', 409, 'no_number');
  if (!rateLimit(`comms:call:${user.id}`, cfg().callsPerHour, 3600e3)) throw bad('You are calling too often. Please wait a little.', 429, 'rate_limited');
  const ref = crypto.randomBytes(8).toString('hex'), at = clock.now();
  const r = await run('INSERT INTO call_records (user_id, provider, provider_call_id, direction, thread_key, peer_last4, our_number, status, handling, started_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    user.id, adapter.name, 'ref:' + ref, 'out', threadKey(user.id, to), last4(to), mine.number, 'dialing', 'web', at, at);
  return { id: Number(r.lastInsertRowid), callRef: ref, clientState: Buffer.from(ref).toString('base64'), callerNumber: mine.number };
}

// ---------- softphone login, TURN ----------
export async function webRtcLogin(user, { adapter = getAdapter() } = {}) {
  const num = await one('SELECT number, credential_id, sip_username FROM comms_numbers WHERE user_id = ?', user.id);
  if (!num) throw bad('No phone number is set up for your account yet.', 409, 'no_number');
  if (!rateLimit(`comms:login:${user.id}`, 30, 3600e3)) throw bad('Too many softphone sign-ins. Please wait a little.', 429, 'rate_limited');
  try {
    const l = await adapter.createWebRtcLogin({ userId: user.id, existing: num.credential_id ? { credentialId: num.credential_id, sipUsername: num.sip_username } : undefined });
    if (l.credentialId !== num.credential_id) await run('UPDATE comms_numbers SET credential_id = ?, sip_username = ? WHERE user_id = ?', l.credentialId, l.sipUsername, user.id);
    return { loginToken: l.loginToken, callerNumber: num.number, ...turnConfig(user.id) };
  } catch (e) {
    clog('warn', 'webrtc_login_failed', { userId: user.id, provider: adapter.name, status: e.status, code: e.code });
    throw e instanceof ProviderError ? bad('The softphone could not be started. Please try again.', e.status === 503 ? 503 : 502, 'provider_error') : e;
  }
}
// Short-lived TURN credentials (the coturn "REST API" scheme: user = expiry:id, password = base64 HMAC-SHA1
// of it with a shared secret), so no permanent TURN password reaches a browser.
export function turnConfig(userId, nowMs = clock.now(), env = process.env) {
  const turn = String(env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean), stun = String(env.STUN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  const iceServers = [];
  if (stun.length) iceServers.push({ urls: stun });
  if (turn.length && env.TURN_SECRET) {
    const ttl = 3600, username = `${Math.floor(nowMs / 1000) + ttl}:${userId}`;
    iceServers.push({ urls: turn, username, credential: crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
  }
  return { iceServers, turn: turn.length > 0 && !!env.TURN_SECRET };
}

// ---------- the browser's side of delivery ----------
export async function pendingFor(userId, limit = 200) {
  const rows = await all('SELECT id, thread_key, pending_body, created_at FROM sms_messages WHERE user_id = ? AND direction = ? AND pending_body IS NOT NULL AND pending_until > ? ORDER BY id LIMIT ?', userId, 'in', clock.now(), limit);
  return rows.map(r => { const b = tryDecrypt(r.pending_body, 'text message'); return b ? { id: r.id, peer: b.p, text: b.t, at: b.at || r.created_at, threadKey: r.thread_key } : null; }).filter(Boolean);
}
export async function ackMessages(userId, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 100);
  if (!list.length) return 0;
  const r = await run(`UPDATE sms_messages SET pending_body = NULL, pending_until = NULL WHERE user_id = ? AND pending_body IS NOT NULL AND id IN (${list.map(() => '?').join(',')})`, userId, ...list);
  return r.changes;
}
export async function callHistory(userId, limit = 50) {
  return all('SELECT id, direction, thread_key AS threadKey, peer_last4 AS peerLast4, status, started_at AS startedAt, duration_s AS durationS, seen FROM call_records WHERE user_id = ? ORDER BY started_at DESC LIMIT ?', userId, limit);
}
export async function markCallsSeen(userId) { return (await run('UPDATE call_records SET seen = 1 WHERE user_id = ? AND seen = 0', userId)).changes; }
export async function summary(userId) {
  const missed = await one("SELECT COUNT(*) n FROM call_records WHERE user_id = ? AND status = 'missed' AND seen = 0", userId);
  const waiting = await one('SELECT COUNT(*) n FROM sms_messages WHERE user_id = ? AND direction = ? AND pending_body IS NOT NULL AND pending_until > ?', userId, 'in', clock.now());
  return { missedCalls: missed.n, waitingTexts: waiting.n };
}

// Run now and then: expired pending text, old event ids, dialing attempts that never connected, retention.
export async function purge() {
  const t = clock.now(), c = cfg(), old = t - c.retentionDays * 864e5;
  await run('UPDATE sms_messages SET pending_body = NULL, pending_until = NULL WHERE pending_body IS NOT NULL AND pending_until <= ?', t);
  await run('DELETE FROM comms_webhook_events WHERE at < ?', t - 7 * 864e5);
  await run("UPDATE call_records SET status = 'failed', ended_at = ? WHERE status = 'dialing' AND started_at < ?", t, t - 120e3);
  await run('DELETE FROM sms_messages WHERE created_at < ?', old);
  await run('DELETE FROM call_records WHERE started_at < ?', old);
}

// ---------- admin: which number belongs to which user ----------
export async function assignNumber({ number, userId, voiceMode = 'ivr', greeting = null }) {
  if (!isE164(number)) throw bad('The number must be in E.164 form, like +18455551234.', 400, 'bad_number');
  if (!['ivr', 'softphone'].includes(voiceMode)) throw bad('voiceMode must be "ivr" or "softphone".', 400, 'bad_mode');
  if (!(await one('SELECT id FROM users WHERE id = ?', +userId))) throw bad('No such user.', 404, 'no_user');
  const g = greeting ? String(greeting).replace(/[<>&]/g, '').slice(0, 300) : null;
  try {
    await run('INSERT INTO comms_numbers (number, user_id, voice_mode, greeting, created_at) VALUES (?,?,?,?,?) ON CONFLICT(number) DO UPDATE SET user_id = excluded.user_id, voice_mode = excluded.voice_mode, greeting = excluded.greeting', number, +userId, voiceMode, g, clock.now());
  } catch (e) { if (/UNIQUE/i.test(String(e.message))) throw bad('That user already has a number.', 409, 'user_has_number'); throw e; }
  return one('SELECT number, user_id AS userId, voice_mode AS voiceMode, greeting FROM comms_numbers WHERE number = ?', number);
}
export const listNumbers = () => all('SELECT number, user_id AS userId, voice_mode AS voiceMode, greeting FROM comms_numbers ORDER BY created_at');
export const removeNumber = async number => (await run('DELETE FROM comms_numbers WHERE number = ?', number)).changes;
