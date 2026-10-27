// Scheduled work for the newer automations. Each job claims its time slot first (claimOnce),
// so the in-process timer and the external cron never run it twice.
import { accountSummary, placeOrder, lastPrice } from './brokers.js';
import { drain } from './orderqueue.js';
import { jobAllowed, setVolatility } from './reliability.js';
import { snapshotMargins } from './margin.js';
import { runGuardian } from './risk.js';
import { notifyUser } from './notify-user.js';
import { runAgents } from './ml.js';
import { runScanners, runIntradayBots } from './scanner.js';
import { runBaskets } from './baskets.js';
import { runIncomeBots } from './options.js';
import { runRoundups } from './roundup.js';
import { refreshFeed } from './halal.js';
import { runDrip, rebalanceReminders } from './wealth.js';
import { monthlyBooksEmail } from './books.js';

const slot = (t, min) => Math.floor(t / (min * 60e3));
export const JOBS = [
  // Guardian: stop-loss / take-profit on whole accounts, every 5 minutes.
  ['guard', 5, async () => {
    const r = await runGuardian({ summarize: accountSummary, place: placeOrder });
    for (const x of r) await notifyUser(x.userId, `Risk guardian (${x.account}): ${x.result}`);
    return r.length;
  }],
  // AI agents: once a day (stocks in the last half hour of the session, crypto at any time).
  ['agents', 5, t => runAgents(t)],
  // Scanners and intraday bots check every minute whether their own interval has come round.
  ['scanners', 1, t => runScanners(t)],
  ['intraday', 1, t => runIntradayBots(t)],
  // Rule-based portfolios: contributions and scheduled rebalances, from 10:00 New York time.
  ['baskets', 15, t => runBaskets(t)],
  // Option income bots: once a day from 10:30 New York time.
  ['income', 15, t => runIncomeBots(t)],
  // Card purchases sync every few hours; the week's buys go out on Monday during the session.
  ['roundups', 180, t => runRoundups(t)],
  // Queued automated orders (broker outage or load surge), every minute; the in-process timer drains faster.
  ['orderqueue', 1, () => drain(placeOrder)],
  // Volatility watch for the capacity planner: a jump in the VIX futures ETF counts as a spike.
  ['volwatch', 5, async () => {
    const sym = process.env.VOL_PROXY || 'VIXY', px = await lastPrice(sym).catch(() => null);
    if (!px) return 0;
    const prev = globalThis.__volPrev; globalThis.__volPrev = px;
    if (prev) setVolatility({ spike: px / prev - 1 > +(process.env.VOL_SPIKE_PCT || 8) / 100, value: `${sym} ${px}` });
    return 1;
  }],
  // Margin and buying-power snapshots for the liquidity forecast, once a day.
  ['margin', 1440, () => snapshotMargins()],
  // Dividends paid in the last week are bought back into the same stock (opt-in), every 6 hours.
  ['drip', 360, () => runDrip()],
  // Opt-in reminder to rebalance, on January 15 and July 15.
  ['rebalremind', 1440, t => rebalanceReminders(t)],
  // Last month's books by email (opt-in), on the 1st.
  ['books', 1440, t => monthlyBooksEmail(t)],
  // The owner's Shariah compliance feed (HALAL_FEED_URL), once a day.
  ['halalfeed', 1440, () => refreshFeed()],
];
export async function runExtraJobs(t, claimOnce) {
  const out = {};
  for (const [name, every, fn] of JOBS) {
    if (!jobAllowed(name)) continue; // paused while the server sheds load
    if (!(await claimOnce(`${name}:${slot(t, every)}`))) continue;
    out[name] = await fn(t).catch(e => (console.error(name, e), 'error'));
  }
  return out;
}
