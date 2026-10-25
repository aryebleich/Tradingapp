// Scheduled work for the newer automations. Each job claims its time slot first (claimOnce),
// so the in-process timer and the external cron never run it twice.
import { accountSummary, placeOrder } from './brokers.js';
import { runGuardian } from './risk.js';
import { notifyUser } from './notify-user.js';
import { runAgents } from './ml.js';
import { runScanners, runIntradayBots } from './scanner.js';
import { runBaskets } from './baskets.js';
import { runIncomeBots } from './options.js';
import { runRoundups } from './roundup.js';
import { refreshFeed } from './halal.js';

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
  // The owner's Shariah compliance feed (HALAL_FEED_URL), once a day.
  ['halalfeed', 1440, () => refreshFeed()],
];
export async function runExtraJobs(t, claimOnce) {
  const out = {};
  for (const [name, every, fn] of JOBS) {
    if (!(await claimOnce(`${name}:${slot(t, every)}`))) continue;
    out[name] = await fn(t).catch(e => (console.error(name, e), 'error'));
  }
  return out;
}
