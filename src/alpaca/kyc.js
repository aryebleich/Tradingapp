// KYC status tracking for brokerage applications. Alpaca pushes every account status change on
// its Server-Sent Events feed (GET /v1/events/accounts/status); this module keeps one server-side
// connection to it, resumes after a drop from the last event id it saw, records each change in
// broker_events, tells the user by text or email and relays the change to that user's open
// browser tabs. Polling (page loads and the hourly job) records changes through the same path,
// so the history is complete even while the feed is down.
import { EventEmitter } from 'node:events';
import { one, all, run, now } from '../db.js';
import { URLS } from './http.js';
import { brokerEnabled, brokerHeaders, statusInfo } from './broker.js';
import { sendSms, sendEmail } from '../notify.js';

export const kycBus = new EventEmitter();
kycBus.setMaxListeners(0);

async function notifyUser(userId, msg) {
  const u = await one('SELECT email, phone, phone_verified FROM users WHERE id = ?', userId);
  if (u?.phone && u.phone_verified) await sendSms(u.phone, msg).catch(e => console.warn('sms', e.message));
  else if (u?.email) await sendEmail(u.email, 'Brightfolio: ' + msg.slice(0, 60), msg).catch(e => console.warn('email', e.message));
}

// One status observation for an account, from the feed ('sse'), a read ('poll') or account
// creation ('created'). Returns true when the stored status changed.
export async function applyStatus(accountId, { to, from, reason, eventId, source, at, accountNumber, cryptoStatus }) {
  if (!to) return false;
  const b = await one('SELECT user_id, status, crypto_status, account_number FROM broker_accounts WHERE account_id = ?', accountId);
  if (!b) {
    // Alpaca can report a new account's first change before the request that opened it has saved
    // the row; keep feed events for unknown accounts briefly so adoptAccount() can replay them.
    if (source === 'sse') {
      const list = orphans.get(accountId) || [];
      list.push({ to, from, reason, eventId, source, at, accountNumber, cryptoStatus, kept: now() });
      orphans.set(accountId, list.slice(-10));
      for (const [k, v] of orphans) if (now() - v.at(-1).kept > 10 * 60e3) orphans.delete(k);
    }
    return false; // otherwise another platform's customer
  }
  const last = await one('SELECT id, status_to, event_id FROM broker_events WHERE account_id = ? ORDER BY id DESC LIMIT 1', accountId);
  if (last?.status_to === to) {
    // Already recorded (seen by a read first): keep one row, but remember the feed position.
    if (eventId && !last.event_id) await run('UPDATE broker_events SET event_id = ? WHERE id = ?', String(eventId), last.id).catch(() => {});
  } else {
    await run('INSERT OR IGNORE INTO broker_events (user_id, account_id, event_id, status_from, status_to, reason, source, at) VALUES (?,?,?,?,?,?,?,?)',
      b.user_id, accountId, eventId == null ? null : String(eventId), from || b.status, to, reason || null, source, at || now());
  }
  const changed = b.status !== to;
  if (changed || (cryptoStatus && cryptoStatus !== b.crypto_status))
    await run('UPDATE broker_accounts SET status = ?, crypto_status = ?, account_number = ?, updated_at = ? WHERE account_id = ?',
      to, cryptoStatus || b.crypto_status, accountNumber || b.account_number, now(), accountId);
  if (!changed) return false;
  const info = statusInfo(to);
  kycBus.emit('status', { userId: b.user_id, accountId, status: to, previous: b.status, reason: reason || null, ...info, at: at || now() });
  if (source !== 'created') await notifyUser(b.user_id, `Brokerage account: ${info.title}. ${info.detail}`);
  return true;
}

const orphans = new Map();
export async function adoptAccount(accountId) {
  const list = orphans.get(accountId) || [];
  orphans.delete(accountId);
  for (const e of list) await applyStatus(accountId, e);
}

export const history = userId => all('SELECT status_from, status_to, reason, source, at FROM broker_events WHERE user_id = ? ORDER BY id', userId);

// ---------- the Alpaca feed ----------
// Parses an SSE byte stream into { id, event, data } messages.
export async function* sseMessages(body, signal) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    if (signal?.aborted) return;
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const msg = { data: '' };
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const c = line.indexOf(':'), k = c < 0 ? line : line.slice(0, c), v = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
        if (k === 'data') msg.data += (msg.data ? '\n' : '') + v; else msg[k] = v;
      }
      if (msg.data) yield msg;
    }
  }
}

// Feed events carry event_id (numeric, older accounts) and/or event_ulid; resume with the matching
// since_* parameter so nothing is missed or replayed twice after a reconnect.
async function cursor() {
  const r = await one("SELECT event_id FROM broker_events WHERE event_id IS NOT NULL ORDER BY id DESC LIMIT 1");
  if (!r) return {};
  return /^\d+$/.test(r.event_id) ? { since_id: r.event_id } : { since_ulid: r.event_id };
}

export async function handleFeedEvent(e) {
  if (!e?.account_id) return false;
  const at = e.at ? Date.parse(e.at) || now() : now();
  return applyStatus(e.account_id, {
    to: e.status_to, from: e.status_from, reason: e.reason || e.kyc_results?.summary || null,
    eventId: e.event_ulid || e.event_id, source: 'sse', at, accountNumber: e.account_number, cryptoStatus: e.crypto_status_to || undefined,
  });
}

let feedState = { connected: false, since: null, events: 0, error: null };
export const feedStatus = () => ({ ...feedState });

async function consume(signal, idleMs) {
  const q = new URLSearchParams(await cursor());
  const url = `${URLS.broker()}/v1/events/accounts/status${q.size ? '?' + q : ''}`;
  const r = await fetch(url, { headers: { ...(await brokerHeaders()), Accept: 'text/event-stream' }, signal });
  if (!r.ok) throw new Error(`events feed ${r.status}`);
  feedState = { ...feedState, connected: true, since: now(), error: null };
  // A silent connection is assumed dead after idleMs and reopened.
  let idle;
  const kick = () => { clearTimeout(idle); idle = setTimeout(() => r.body.cancel().catch(() => {}), idleMs); };
  kick();
  try {
    for await (const m of sseMessages(r.body, signal)) {
      kick();
      let e; try { e = JSON.parse(m.data); } catch { continue; }
      feedState.events++;
      await handleFeedEvent(e).catch(err => console.warn('kyc event', err.message));
    }
  } finally { clearTimeout(idle); feedState.connected = false; }
}

// Starts the feed when Broker API credentials are configured. Returns a stop function.
export function startKycEvents({ idleMs = 5 * 60e3, maxDelay = 60e3 } = {}) {
  if (!brokerEnabled() || process.env.BROKER_EVENTS === 'off') return () => {};
  let stopped = false, ctrl = null, delay = 1000;
  (async () => {
    while (!stopped) {
      ctrl = new AbortController();
      try { await consume(ctrl.signal, idleMs); delay = 1000; }
      catch (e) { if (!stopped) { feedState.error = e.message; console.warn('kyc events:', e.message); } }
      if (stopped) break;
      await new Promise(r => setTimeout(r, delay).unref?.());
      delay = Math.min(delay * 2, maxDelay);
    }
  })();
  return () => { stopped = true; ctrl?.abort(); };
}
