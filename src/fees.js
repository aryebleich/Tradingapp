// Revenue: monthly plans + performance fee on new profits above a high-water mark.
import { one, all, run, now } from './db.js';

export const PLANS = {
  free: { name: 'Starter', monthly: 0, yearly: 0, perfFee: 0.20, tagline: 'Learn and practice', features: ['$100,000 paper account', 'Strategy library by hand + 1 automatic strategy on paper', 'S&P 500 auto-invest on paper', 'Pairs analysis & backtests', '1 alert webhook (paper)', 'AI text assistant for questions & balances', 'English & Yiddish'] },
  pro: { name: 'Pro', monthly: 29, yearly: 290, perfFee: 0.10, popular: true, tagline: 'Automate your real accounts', features: ['Everything in Starter', 'Live trading on Alpaca, Schwab, tastytrade, Tradier & TradeStation', '5 automatic strategies with Reality Check auto-throttle', '10 alert webhooks (TradingView, Zapier)', 'Pair bots, scheduled trades & live S&P 500 auto-invest', 'Trade by text & phone with the AI assistant', 'Optimizer, walk-forward testing & QuantConnect'] },
  elite: { name: 'Elite', monthly: 99, yearly: 990, perfFee: 0.05, tagline: 'For serious capital', features: ['Everything in Pro', 'Lowest performance fee (5%)', '50 automatic strategies & 50 webhooks', 'Market-neutral pairs (long + short)', 'Tax-loss harvesting report', 'Priority AI & priority support'] },
};
// Paid plans start with a free trial once per user.
export const TRIAL_DAYS = +process.env.TRIAL_DAYS || 14;
export const PAID = ['pro', 'elite'];
// A user has paid features on a paid plan that is active or still in its trial.
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
