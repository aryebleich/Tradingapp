// Revenue: monthly plans + performance fee on new profits above a high-water mark.
import { one, all, run, now } from './db.js';

// Prices are the average of comparable platforms (charting, signal routing, quant and options tools;
// see docs/pricing-comparison.md): entry tiers average about $53, middle tiers $109, top tiers $320.
// Yearly billing is 10x the monthly price (two months free).
export const PLANS = {
  free: { name: 'Starter', monthly: 0, yearly: 0, perfFee: 0.20, tagline: 'Learn and practice', features: ['$100,000 paper account', '1 chart per layout, every indicator', 'Strategy library by hand + 1 automatic strategy on paper', 'Unlimited backtests', '1 alert webhook (paper)', '2 scanners, checked hourly', 'AI assistant: 30 messages a day', 'English & Yiddish'] },
  pro: { name: 'Pro', monthly: 53, yearly: 530, perfFee: 0.10, popular: true, tagline: 'Automate your real accounts', features: ['Everything in Starter', 'Live trading on Alpaca, Schwab, tastytrade, Tradier & TradeStation', '2-chart layouts', '5 automatic strategies with Reality Check auto-throttle', '10 alert webhooks', 'Scanners every 5 minutes, portfolios & signal mirroring', 'AI assistant: 300 messages a day', 'Optimizer, walk-forward testing & code lab'] },
  elite: { name: 'Elite', monthly: 109, yearly: 1090, perfFee: 0.05, tagline: 'For active traders', features: ['Everything in Pro', '4-chart layouts and pop-out windows', '25 automatic strategies & 25 webhooks', 'Option income bots & multi-leg orders', 'Market-neutral pairs (long + short)', 'Tax-loss harvesting & Schedule D', 'AI assistant: 1,000 messages a day'] },
  ultimate: { name: 'Ultimate', monthly: 320, yearly: 3200, perfFee: 0.025, tagline: 'For serious capital', features: ['Everything in Elite', 'Lowest performance fee (2.5%)', '100 automatic strategies & 100 webhooks', 'Unlimited scanners and AI agents', 'AI assistant: 3,000 messages a day', 'Priority support'] },
};
// Paid plans start with a free trial once per user.
export const TRIAL_DAYS = +process.env.TRIAL_DAYS || 14;
export const PAID = ['pro', 'elite', 'ultimate'];
// A user has paid features on a paid plan that is active or still in its trial.
// AI messages a day by plan.
export const AI_LIMITS = { free: 30, pro: 300, elite: 1000, ultimate: 3000 };
export const isPaid = u => u?.role === 'admin' || (PAID.includes(u?.plan) && ['active', 'trialing', null, undefined].includes(u?.plan_status));
// Referral reward: credited to the referrer when someone they invited starts paying.
export const REFERRAL_CREDIT = +process.env.REFERRAL_CREDIT || 10;

// Fee = rate x (equity - high-water mark), where the HWM moves with deposits/withdrawals so
// users never pay on their own contributions or on recovering an earlier loss.
export function computePerformanceFee({ equity, highWater, rate }) {
  const gain = equity - highWater;
  return gain > 0 ? { fee: +(gain * rate).toFixed(2), gain: +gain.toFixed(2), newHighWater: equity - gain * rate } : { fee: 0, gain: 0, newHighWater: highWater };
}

export async function adjustForCashflow(userId, account, amount) {
  await run('INSERT INTO cashflows (user_id, account, amount, at) VALUES (?,?,?,?)', userId, account, amount, Date.now());
  const s = await one('SELECT * FROM fee_state WHERE user_id = ? AND account = ?', userId, account);
  if (!s) await run('INSERT INTO fee_state (user_id, account, high_water, net_contrib) VALUES (?,?,?,?)', userId, account, Math.max(amount, 0), amount);
  else await run('UPDATE fee_state SET high_water = high_water + ?, net_contrib = net_contrib + ? WHERE user_id = ? AND account = ?', amount, amount, userId, account);
}

// Charge one account; records the fee in the ledger and raises the high-water mark.
export async function assessFee(userId, account, equity) {
  const u = await one('SELECT plan FROM users WHERE id = ?', userId);
  const rate = PLANS[u.plan]?.perfFee ?? PLANS.free.perfFee;
  let s = await one('SELECT * FROM fee_state WHERE user_id = ? AND account = ?', userId, account);
  if (!s) { await run('INSERT INTO fee_state (user_id, account, high_water, net_contrib) VALUES (?,?,?,?)', userId, account, equity, equity); return { fee: 0, initialized: true }; }
  const r = computePerformanceFee({ equity, highWater: s.high_water, rate });
  if (r.fee > 0) {
    await run('UPDATE fee_state SET high_water = ? WHERE user_id = ? AND account = ?', r.newHighWater, userId, account);
    await run('INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?,?,?,?,?,?)', userId, 'performance_fee', r.fee,
      account === 'paper' ? 'simulated' : 'due', `${(rate * 100).toFixed(0)}% of $${r.gain} new profit on ${account}`, now());
    if (account === 'paper') await run('UPDATE paper_accounts SET cash = cash - ? WHERE user_id = ?', r.fee, userId);
  }
  return { ...r, rate };
}

export async function revenueSummary() {
  const byKind = await all("SELECT kind, status, COUNT(*) n, ROUND(SUM(amount), 2) total FROM ledger WHERE kind IN ('performance_fee','subscription') GROUP BY kind, status");
  const plans = await all('SELECT plan, COUNT(*) n FROM users GROUP BY plan');
  const mrr = plans.reduce((a, p) => a + (PLANS[p.plan]?.monthly || 0) * p.n, 0);
  return { byKind, plans, mrr, users: (await one('SELECT COUNT(*) n FROM users')).n };
}
