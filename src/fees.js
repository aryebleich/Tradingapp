// Revenue: monthly plans; a performance fee on new profits above a high-water mark only in
// registered-adviser mode (Admin → Business mode).
import { one, all, run, now } from './db.js';
import { amountOf, priceOf } from './prices.js';

// Prices are not in the code (DECISIONS.md PR-1): the owner enters them in Admin → Prices (src/prices.js),
// each with its currency and effective date. monthly, yearly and currency below read the price in force;
// they are null for a plan without a price, which then shows "Price not set yet" and can't be bought.
// Stripe stays in test mode until the owner switches it live in Admin; checkout refuses a Stripe price
// that no longer matches the price in force (checkPlanPrice in src/stripesetup.js).
export const PLANS = {
  free: { name: 'Starter', monthly: 0, yearly: 0, perfFee: 0.20, tagline: 'Learn and practice', features: ['$100,000 paper account', 'Live trading on your own brokerage (your own orders)', '1 chart per layout, every indicator', 'Strategy library by hand + 1 automatic strategy on paper', 'Unlimited backtests', '1 alert webhook (paper)', '2 scanners, checked hourly', 'AI assistant: 30 messages a day', '100 credits every month'] },
  pro: { name: 'Pro', perfFee: 0.10, popular: true, tagline: 'Automate your real accounts', features: ['Everything in Starter', 'Automated trading on Alpaca, Schwab, tastytrade, Tradier & TradeStation', '2-chart layouts', '5 automatic strategies with Reality Check auto-throttle', '10 alert webhooks', 'Scanners every 5 minutes, portfolios & signal mirroring', 'AI assistant: 300 messages a day', 'Optimizer, walk-forward testing & code lab', 'Trading and alerts by text and phone, QuantConnect and bank-card linking', '1,000 credits every month'] },
  elite: { name: 'Elite', perfFee: 0.05, tagline: 'For active traders', features: ['Everything in Pro', '4-chart layouts and pop-out windows', '25 automatic strategies & 25 webhooks', 'Option income bots & multi-leg orders', 'Market-neutral pairs (long + short)', 'Tax-loss harvesting & Schedule D', 'AI assistant: 1,000 messages a day', '3,000 credits every month'] },
  ultimate: { name: 'Ultimate', perfFee: 0.025, tagline: 'For serious capital', features: ['Everything in Elite', '100 automatic strategies & 100 webhooks', 'Unlimited scanners and AI agents', 'AI assistant: 3,000 messages a day', 'Priority support', '10,000 credits every month'] },
};
for (const k of ['pro', 'elite', 'ultimate']) Object.defineProperties(PLANS[k], {
  monthly: { enumerable: true, get: () => amountOf(`plan:${k}:month`) },
  yearly: { enumerable: true, get: () => amountOf(`plan:${k}:year`) },
  currency: { enumerable: true, get: () => priceOf(`plan:${k}:month`)?.currency || priceOf(`plan:${k}:year`)?.currency || null },
});
// Teams and firms: sales-led, no self-serve checkout (DECISIONS.md MP-3). Shown on Plans & billing.
export const INSTITUTIONAL = { name: 'Institutional', get from() { return amountOf('plan:institutional:month'); }, get currency() { return priceOf('plan:institutional:month')?.currency || null; }, tagline: 'For teams and firms', features: ['Everything in Ultimate', 'Team workspaces and roles (as they are built)', 'Higher API limits', 'Single sign-on and audit exports (as they are built)', 'An annual contract and a named contact'] };
// The plan comparison table (Starter, Pro, Elite, Ultimate): true / false for a tick or a dash, or the
// limit as text. The homepage shows the same rows (scripts/home.py MATRIX); a test keeps them equal.
export const COMPARE = [
  ['$100,000 paper account', true, true, true, true],
  ['Live trading on your own brokerage', true, true, true, true],
  ['Strategy library and backtests', true, true, true, true],
  ['Automatic strategies', '1 (paper)', '5', '25', '100'],
  ['Alert webhooks', '1 (paper)', '10', '25', '100'],
  ['Charts per layout', '1', '2', '4', '4'],
  ['Scanners', '2, hourly', 'Every 5 minutes', 'Every 5 minutes', 'Unlimited'],
  ['AI assistant messages a day', '30', '300', '1,000', '3,000'],
  ['Credits every month', '100', '1,000', '3,000', '10,000'],
  ['Automation on real accounts', false, true, true, true],
  ['Reality Check auto-throttle', false, true, true, true],
  ['Trading and alerts by text and phone', false, true, true, true],
  ['Optimizer, walk-forward testing & code lab', false, true, true, true],
  ['Option income bots & multi-leg orders', false, false, true, true],
  ['Tax-loss harvesting & Schedule D', false, false, true, true],
  ['Priority support', false, false, false, true],
];
// The three tiers the plans are grouped in on Plans & billing: Free (Starter), Pro, Premium (Elite and
// Ultimate). The plan names, prices and Stripe products are unchanged (DECISIONS.md G-1).
export const TIERS = { free: 'Free', pro: 'Pro', elite: 'Premium', ultimate: 'Premium' };
// Research and AI features by plan (in the app only; the homepage table waits for sign-off, LEGAL_REVIEW.md
// L18). Each row matches the server's own check (test/pricing.test.js).
export const GROWTH_COMPARE = [
  ['Stock page: valuation, earnings, dividends, technicals', '2 years', '5 years + AI summary', '5 years + AI summary', '5 years + AI summary'],
  ['Company card before every buy', true, true, true, true],
  ['Growth-at-a-price scanner', 'Presets', 'Saved filters + daily alerts', 'Saved filters + daily alerts', 'Saved filters + daily alerts'],
  ['Diversification suggestions with previews', '1', 'All', 'All', 'All'],
  ['Dividend safety scores', 'First 3 holdings', 'All holdings', 'All holdings', 'All holdings'],
  ['AI morning picks', 'Read picks and record', 'Paper, approve or automatic', 'Paper or real money', 'Paper or real money'],
  ['AI intraday trading', 'Read rules and record', false, 'Paper or real money', 'Paper or real money'],
  ['AI long/short portfolios', true, true, true, true],
];
// Paid plans start with a free trial once per user.
export const TRIAL_DAYS = +process.env.TRIAL_DAYS || 14;
export const PAID = ['pro', 'elite', 'ultimate'];
// A user has paid features on a paid plan that is active or still in its trial.
// AI messages a day by plan.
export const AI_LIMITS = { free: 30, pro: 300, elite: 1000, ultimate: 3000 };
export const isPaid = u => (u?.role === 'admin' && !u.previewPlan) || (PAID.includes(u?.plan) && ['active', 'trialing', null, undefined].includes(u?.plan_status));
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
  const byKind = await all("SELECT kind, status, COUNT(*) n, ROUND(SUM(amount), 2) total FROM ledger WHERE kind IN ('performance_fee','subscription') AND COALESCE(livemode, 1) = 1 GROUP BY kind, status");
  const plans = await all('SELECT plan, COUNT(*) n FROM users GROUP BY plan');
  const mrr = plans.reduce((a, p) => a + (PLANS[p.plan]?.monthly || 0) * p.n, 0);
  return { byKind, plans, mrr, users: (await one('SELECT COUNT(*) n FROM users')).n };
}
