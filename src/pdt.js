// The pattern-day-trader rule (FINRA 4210) as the automatic engines apply it: a margin account under
// $25,000 may make at most 3 day trades (buy and sell the same stock the same day) in any 5 trading
// days. The practice account and cash accounts are not limited by it here (cash accounts have
// settlement rules instead, which the broker enforces).
export const PDT_EQUITY = 25000, PDT_MAX = 3;
// dayTrades: day trades already made in the last 5 trading days.
export function pdtAllowed({ account, equity, margin = true, dayTrades = 0 }) {
  if (account === 'paper') return { ok: true, why: 'practice account' };
  if (!margin) return { ok: true, why: 'cash account' };
  if (equity >= PDT_EQUITY) return { ok: true, why: 'account at or above $25,000' };
  if (dayTrades >= PDT_MAX) return { ok: false, why: `Pattern-day-trader rule: ${dayTrades} day trades in the last 5 trading days on a margin account under $25,000. No more day trades until one drops off.` };
  return { ok: true, why: `${PDT_MAX - dayTrades} day trade${PDT_MAX - dayTrades === 1 ? '' : 's'} left in this 5-day window` };
}
