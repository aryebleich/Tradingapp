// Background jobs: scheduled orders, auto-trading bots, price alerts, equity snapshots, monthly fees.
import { one, all, run, now } from './db.js';
import { nyTime } from './time.js';
import { runExtraJobs } from './jobs.js';
import { placeOrder, getBars, lastPrice, snapshotEquity, accountSummary, getCred, syncAlpacaFills } from './brokers.js';
import { latestSignal } from './engine.js';
import { sendSms, sendEmail } from './notify.js';
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

export const marketOpen = (t = now()) => { const n = nyTime(t); return !['Sat', 'Sun'].includes(n.weekday) && n.minutes >= 570 && n.minutes < 960; };

// Text message when the user has a verified phone, otherwise email.
async function notify(userId, msg) {
  const u = await one('SELECT email, phone, phone_verified FROM users WHERE id = ?', userId);
  if (u?.phone && u.phone_verified) await sendSms(u.phone, msg).catch(e => console.warn('sms', e.message));
  else if (u?.email) await sendEmail(u.email, 'QuantPocket: ' + msg.slice(0, 60), msg).catch(e => console.warn('email', e.message));
}

// Each job is claimed with a conditional UPDATE before it runs, so the in-process timer and the
// GitHub Actions cron calling /internal/tick at the same moment can never execute it twice.
export async function runScheduledOrders(t = now()) {
  if (!marketOpen(t)) return 0; // market orders wait for the regular session
  const due = await all('SELECT * FROM scheduled_orders WHERE active = 1 AND next_run <= ?', t);
  let ran = 0;
  for (const o of due) {
    // Skip runs missed while the app was asleep instead of firing them all at once.
    let next = nextRunAfter(o.next_run, o.repeat);
    while (next && next <= t) next = nextRunAfter(next, o.repeat);
    const claim = await run('UPDATE scheduled_orders SET next_run = ?, active = ? WHERE id = ? AND next_run = ? AND active = 1', next ?? o.next_run, next ? 1 : 0, o.id, o.next_run);
    if (!claim.changes) continue;
    ran++;
    let result;
    try {
      const r = await placeOrder(o.user_id, o.account, { symbol: o.symbol, side: o.side, qty: o.qty, notional: o.notional }, 'schedule');
      result = `${r.status}${r.price ? ' @ ' + r.price.toFixed(2) : ''}`;
    } catch (e) { result = 'error: ' + e.message; }
    await run('UPDATE scheduled_orders SET last_result = ? WHERE id = ?', result, o.id);
    await notify(o.user_id, `Scheduled ${o.side} ${o.symbol}: ${result}`);
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
  // Sheet strategies: automatic rebalances, trailing stops, and the after-close record for Reality Check.
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

export function startScheduler() {
  let busy = false;
  return setInterval(async () => {
    if (busy) return; // a slow tick (many users) must not overlap with the next one
    busy = true;
    try { await runDueJobs(); } catch (e) { console.error('scheduler', e); }
    busy = false;
  }, 30e3);
}
