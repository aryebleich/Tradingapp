// Background jobs: scheduled orders, auto-trading bots, price alerts, equity snapshots, monthly fees.
import { one, all, run, now } from './db.js';
import { nyTime, nextNyRun, extendedSession, stockSession, nextOpenAt, nextCloseAt } from './time.js';
import { DEFAULT_GRACE_MIN, CLS_CUTOFF_BEFORE_CLOSE_MIN, OPG_CUTOFF_BEFORE_OPEN_MIN } from './schedule-plan.js';
import { runExtraJobs } from './jobs.js';
import { shabbosBlock } from './values.js';
import { placeOrder, getBars, lastPrice, snapshotEquity, accountSummary, syncAlpacaFills } from './brokers.js';
import { latestSignal } from './engine.js';
import { sendSms, sendEmail } from './notify.js';
import { notifyUser } from './notify-user.js';
import { assessFee, isPaid } from './fees.js';
import { adviserMode } from './site.js';
import { tradingFor } from './alpaca/connections.js';
import { getAccount, brokerEnabled, FINAL_STATUSES } from './alpaca/broker.js';
import { applyStatus } from './alpaca/kyc.js';
import { runAuto, checkStops, recordDaily } from './rotation/runner.js';
import { runPairBots } from './pairs.js';

const DAY = 86400e3;

// Next run time, skipping weekends so orders land on trading days.
export function nextRunAfter(t, repeat) {
  const d = new Date(t);
  if (repeat === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (repeat === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else return null;
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

// Regular session from the market calendar: weekends, holidays and early closes included.
export const marketOpen = (t = now()) => stockSession(t);

// Text message when the user has a verified phone, otherwise email.
async function notify(userId, msg) {
  const u = await one('SELECT email, phone, phone_verified FROM users WHERE id = ?', userId);
  if (u?.phone && u.phone_verified) await sendSms(u.phone, msg).catch(e => console.warn('sms', e.message));
  else if (u?.email) await sendEmail(u.email, 'Brightolio: ' + msg.slice(0, 60), msg).catch(e => console.warn('email', e.message));
}

// Each job is claimed with a conditional UPDATE before it runs, so the in-process timer and the
// GitHub Actions cron calling /internal/tick at the same moment can never execute it twice.
// The next run of a scheduled order: at its New York time when it has one (newer orders), otherwise
// the same clock time a day, week or month later (older orders).
export const nextRunOf = (o, after) => (o.run_minutes != null
  ? nextNyRun(after, { repeat: o.repeat, minutes: o.run_minutes, weekdays: String(o.weekdays || '').split(',').filter(Boolean).map(Number), monthDay: o.month_day || 1 })
  : nextRunAfter(after, o.repeat));
// Market orders run in the regular session (9:30-16:00 New York). Limit orders marked "extended
// hours" on an Alpaca account may also run pre-market (from 4:00) and after hours (to 20:00).
const canRunNow = (o, t) => marketOpen(t) || (o.extended && o.order_type === 'limit' && o.account !== 'paper' && extendedSession(t));
const MIN = 60e3;
// When a job's run window starts: its time, or the next open when the market is closed then. Auction
// orders (Alpaca 'opg' / 'cls') are sent at their own time, before the broker's cut-off.
export function windowStart(o, at = o.next_run) {
  if (o.tif === 'opg' || o.tif === 'cls') return at;
  return canRunNow(o, at) ? at : nextOpenAt(at);
}
// The latest moment a job may still be sent: its window start plus its grace window, and never past
// the broker's auction cut-off.
export function latestSend(o, start = windowStart(o)) {
  let last = start + (o.grace_min ?? DEFAULT_GRACE_MIN) * MIN;
  if (o.tif === 'cls') { const c = nextCloseAt(start); last = Math.min(last, c - CLS_CUTOFF_BEFORE_CLOSE_MIN * MIN); }
  if (o.tif === 'opg') last = Math.min(last, nextOpenAt(start) - OPG_CUTOFF_BEFORE_OPEN_MIN * MIN);
  return last;
}
export function orderOf(o) {
  const order = { symbol: o.symbol, side: o.side, qty: o.qty, notional: o.notional };
  if (o.order_type === 'limit' && o.limit_price > 0) Object.assign(order, { type: 'limit', limit_price: o.limit_price, time_in_force: 'day', ...(o.extended ? { extended_hours: true } : {}) });
  if (o.tif === 'opg' || o.tif === 'cls') order.time_in_force = o.tif;
  return order;
}

// A scheduled close never sells more than the position holds at run time (rule 3). Returns the order to
// send, or a note when there is nothing left to close.
export async function closeOrderOf(o) {
  const held = (await accountSummary(o.user_id, o.account).catch(() => ({ positions: [] }))).positions.find(p => p.symbol === o.symbol);
  const size = Math.abs(+held?.qty || 0);
  if (!(size > 0)) return { note: `done: no ${o.symbol} position left to close` };
  let qty = o.close_mode === 'all' ? size : o.close_mode === 'pct' ? size * Math.min(100, Math.max(0, +o.close_pct || 0)) / 100 : Math.min(+o.qty || 0, size);
  qty = +qty.toFixed(6);
  if (o.tif === 'opg' || o.tif === 'cls') qty = Math.floor(qty); // auction orders take whole shares
  if (!(qty > 0)) return { note: `done: nothing to close (${o.symbol} position is ${size})` };
  return { order: { ...orderOf(o), symbol: o.symbol, side: +held.qty > 0 ? 'sell' : 'buy', qty, notional: null }, capped: o.close_mode === 'qty' && +o.qty > size };
}

// The run history of a schedule (replaces the single last_result, which is kept as the latest line).
export async function recordRun(id, status, detail = '', t = now()) {
  const row = await one('SELECT history FROM scheduled_orders WHERE id = ?', id);
  let h = []; try { h = JSON.parse(row?.history || '[]'); } catch { h = []; }
  h.push({ at: t, status, detail: String(detail).slice(0, 300) }); h = h.slice(-50);
  await run('UPDATE scheduled_orders SET history = ?, last_result = ? WHERE id = ?', JSON.stringify(h), detail ? `${status}: ${detail}` : status, id);
}
const label = o => o.close_mode ? `scheduled close of ${o.symbol}` : `scheduled ${o.side} ${o.symbol}`;

export async function runScheduledOrders(t = now()) {
  const due = await all('SELECT * FROM scheduled_orders WHERE active = 1 AND COALESCE(paused, 0) = 0 AND next_run <= ?', t);
  let ran = 0;
  for (const o of due) {
    // Past its end date: the schedule ends without running.
    if (o.end_at && o.next_run > o.end_at) {
      const c = await run('UPDATE scheduled_orders SET active = 0 WHERE id = ? AND next_run = ? AND active = 1', o.id, o.next_run);
      if (c.changes) { await recordRun(o.id, 'ended', 'end date reached', t); await notifyUser(o.user_id, `Your ${label(o)} reached its end date and has stopped.`); }
      continue;
    }
    const start = windowStart(o);
    if (t < start) continue; // waits for the session to open
    const missed = t > latestSend(o, start);
    if (!missed && o.tif !== 'opg' && !canRunNow(o, t)) continue;
    // Shabbos and Yom Tov (Values investing): the order waits and runs when it is over.
    if (!missed && await shabbosBlock(o.user_id, t)) continue;
    // A repeating order moves to its next time (runs missed while the app was asleep are skipped);
    // a run after the end date is not scheduled.
    let next = nextRunOf(o, o.next_run);
    while (next && next <= t) next = nextRunOf(o, next);
    const ends = !!(next && o.end_at && next > o.end_at);
    if (ends) next = null;
    // Claimed with a conditional UPDATE: the in-process timer, the cron tick and a restart can never run it twice.
    const claim = await run('UPDATE scheduled_orders SET next_run = ?, active = ? WHERE id = ? AND next_run = ? AND active = 1 AND COALESCE(paused, 0) = 0', next ?? o.next_run, next ? 1 : 0, o.id, o.next_run);
    if (!claim.changes) continue;
    const tail = next ? ' The next run is still scheduled.' : ends ? ' This was its last run before the end date.' : '';
    if (missed) {
      // Never sent late: the window was missed (the app was asleep or the broker's cut-off passed).
      const late = Math.round((t - start) / MIN), win = o.grace_min ?? DEFAULT_GRACE_MIN;
      await recordRun(o.id, 'expired', `not sent, ${late} min after its time (window ${win} min)`, t);
      await notifyUser(o.user_id, `Your ${label(o)} was not sent: its time passed ${late} min ago, more than its ${win}-minute window.${tail}`);
      continue;
    }
    ran++;
    try {
      let order = orderOf(o), capped = false;
      if (o.close_mode) {
        const c = await closeOrderOf(o);
        if (c.note) { await recordRun(o.id, 'done', c.note.replace(/^done: /, ''), t); await notifyUser(o.user_id, `Your ${label(o)}: ${c.note.replace(/^done: /, '')}.${tail}`); continue; }
        order = c.order; capped = c.capped;
      }
      const r = await placeOrder(o.user_id, o.account, order, 'schedule');
      const detail = `${r.status}${r.price ? ' @ ' + r.price.toFixed(2) : ''}${capped ? ` (capped at the ${order.qty} held)` : ''}`;
      await recordRun(o.id, 'sent', detail, t);
      await notifyUser(o.user_id, `Your ${label(o)} ran: ${detail}.${tail}`);
    } catch (e) {
      // Recorded and notified, never retried blindly.
      await recordRun(o.id, 'failed', e.message, t);
      await notifyUser(o.user_id, `Your ${label(o)} failed: ${e.message}.${tail}`);
    }
  }
  return ran;
}


// Bots evaluate their rules once per trading day, in the last half hour before the 4 pm close.
export async function runBots(t = now()) {
  const n = nyTime(t);
  if (['Sat', 'Sun'].includes(n.weekday) || n.minutes < 930 || n.minutes >= 960) return 0;
  const bots = await all('SELECT s.*, u.plan, u.role, u.plan_status FROM strategies s JOIN users u ON u.id = s.user_id WHERE s.deployed IS NOT NULL AND (s.freq IS NULL OR s.freq = ?) AND (s.last_run IS NULL OR s.last_run != ?)', 'daily', n.day);
  let ran = 0;
  for (const b of bots) {
    const claim = await run('UPDATE strategies SET last_run = ? WHERE id = ? AND (last_run IS NULL OR last_run != ?)', n.day, b.id, n.day);
    if (!claim.changes) continue;
    ran++;
    let action = 'hold';
    try {
      if (b.deployed === 'alpaca' && !isPaid(b)) {
        await run('UPDATE strategies SET deployed = NULL WHERE id = ?', b.id);
        throw new Error('stopped: live bots need the Pro plan');
      }
      const bars = await getBars(b.symbol, new Date(t - 3 * 365 * DAY).toISOString().slice(0, 10), b.user_id);
      const sig = latestSignal(bars.closes, b);
      const s = await accountSummary(b.user_id, b.deployed);
      const pos = s.positions.find(p => p.symbol === b.symbol);
      if (pos && sig.exit) { await placeOrder(b.user_id, b.deployed, { symbol: b.symbol, side: 'sell', qty: pos.qty }, 'bot'); action = 'sold'; }
      else if (!pos && sig.enter) {
        const notional = +(s.cash * Math.min(b.size, 100) / 100 * 0.98).toFixed(2);
        if (notional >= 1) { await placeOrder(b.user_id, b.deployed, { symbol: b.symbol, side: 'buy', notional }, 'bot'); action = `bought $${notional}`; }
      }
    } catch (e) { action = 'error: ' + e.message; }
    await run('UPDATE strategies SET last_action = ? WHERE id = ?', action, b.id);
    if (action !== 'hold') await notify(b.user_id, `Bot "${b.name}" ${b.symbol}: ${action}`);
  }
  return ran;
}

export async function runAlerts() {
  const alerts = await all('SELECT * FROM alerts WHERE active = 1');
  for (const a of alerts) {
    const px = await lastPrice(a.symbol, a.user_id).catch(() => null);
    if (px == null) continue;
    if ((a.op === 'above' && px >= a.price) || (a.op === 'below' && px <= a.price)) {
      if (!(await run('UPDATE alerts SET active = 0 WHERE id = ? AND active = 1', a.id)).changes) continue;
      await notify(a.user_id, `Alert: ${a.symbol} is ${px.toFixed(2)} (${a.op} ${a.price})`);
    }
  }
}

export async function snapshotAll() {
  for (const u of await all('SELECT id FROM users')) await snapshotEquity(u.id).catch(() => {});
}

// Monthly: assess performance fees on every account with a high-water mark.
export async function assessAllFees() {
  const out = [];
  // Software-only mode charges no performance fee (that needs a registered investment adviser).
  if (!adviserMode()) return out;
  for (const s of await all('SELECT user_id, account FROM fee_state')) {
    try {
      if (s.account === 'alpaca' && !(await tradingFor(s.user_id))) continue;
      const sum = await accountSummary(s.user_id, s.account);
      out.push({ userId: s.user_id, account: s.account, ...(await assessFee(s.user_id, s.account, sum.equity)) });
    } catch (e) { out.push({ userId: s.user_id, account: s.account, error: e.message }); }
  }
  return out;
}

// Once-per-period jobs are claimed in the database, so restarts (common on free hosts) and the
// cron endpoint running alongside the in-process timer never repeat them.
const claimOnce = async key => (await run('INSERT OR IGNORE INTO job_runs (k, at) VALUES (?, ?)', key, now())).changes > 0;
let lastAlerts = 0, lastStops = 0;

export async function runDueJobs(t = now()) {
  const n = nyTime(t), out = { orders: await runScheduledOrders(t), bots: await runBots(t) };
  if (marketOpen(t) && t - lastAlerts > 5 * 60e3) { lastAlerts = t; await runAlerts(); }
  // Library strategies: automatic rebalances, trailing stops, and the after-close record for Reality Check.
  out.strategies = await runAuto(t, claimOnce).catch(e => (console.error('strategies', e), 0));
  out.pairs = await runPairBots(t, claimOnce).catch(e => (console.error('pairs', e), 0));
  if (marketOpen(t) && t - lastStops > 5 * 60e3) { lastStops = t; await checkStops(t).catch(e => console.error('strategy stops', e)); }
  if (n.minutes >= 975 && !['Sat', 'Sun'].includes(n.weekday) && await claimOnce('strategydays:' + n.day)) await recordDaily(t).catch(e => console.error('strategy days', e));
  if (n.minutes >= 965 && !['Sat', 'Sun'].includes(n.weekday) && await claimOnce('snapshot:' + n.day)) await snapshotAll();
  // Monthly fees on the 1st (days 2-3 cover an app that was asleep), never mid-month after a deploy.
  if (+n.day.slice(8) <= 3 && n.minutes >= 600 && await claimOnce('fees:' + n.day.slice(0, 7))) out.fees = (await assessAllFees()).length;
  if (await claimOnce('hourly:' + new Date(t).toISOString().slice(0, 13))) await hourly();
  out.extra = await runExtraJobs(t, claimOnce);
  return out;
}

// KYC: follow brokerage applications until they are final. The Alpaca event feed normally reports
// changes first; this hourly read is the safety net and records through the same path.
export async function refreshKyc() {
  if (!brokerEnabled()) return 0;
  const pending = await all(`SELECT * FROM broker_accounts WHERE status NOT IN (${FINAL_STATUSES.map(() => '?').join(',')})`, ...FINAL_STATUSES);
  for (const b of pending) {
    try {
      const a = await getAccount(b.account_id);
      await applyStatus(b.account_id, { to: a.status, source: 'poll', accountNumber: a.account_number, cryptoStatus: a.crypto_status });
    } catch (e) { console.warn('kyc refresh', b.user_id, e.message); }
  }
  return pending.length;
}

// Housekeeping: drop expired sessions and import Alpaca fills placed outside the app.
async function hourly() {
  await run('DELETE FROM sessions WHERE expires_at < ?', now());
  await run('DELETE FROM job_runs WHERE at < ?', now() - 90 * DAY);
  const users = await all("SELECT user_id FROM credentials WHERE provider IN ('alpaca', 'alpaca_oauth') UNION SELECT user_id FROM broker_accounts");
  for (const c of users) await syncAlpacaFills(c.user_id).catch(e => console.warn('alpaca sync', c.user_id, e.message));
  for (const c of await all("SELECT user_id, provider FROM credentials WHERE provider LIKE 'alpaca:%'")) await syncAlpacaFills(c.user_id, c.provider).catch(e => console.warn('alpaca sync', c.user_id, c.provider, e.message));
  await refreshKyc();
}

// active(): false on a standby server (Admin → Hosting), which then runs no jobs at all.
export function startScheduler(active = () => true) {
  let busy = false;
  return setInterval(async () => {
    if (busy || !active()) return; // a slow tick (many users) must not overlap with the next one
    busy = true;
    try { await runDueJobs(); } catch (e) { console.error('scheduler', e); }
    busy = false;
  }, 30e3);
}
