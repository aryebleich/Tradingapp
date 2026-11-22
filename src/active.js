// Active trading desk (Trade tools → Active trading desk, #/active). One screen for a trading day:
// the market session, the account's buying power and today's change, the pattern-day-trader status
// (the broker's own day-trade count on Alpaca), open positions with their P/L, today's biggest movers
// and the automatic engines running on the account. It reuses what exists: accountSummary, the
// screener movers, the PDT rule (src/pdt.js), AI intraday and AI morning picks.
import express from 'express';
import { requireUser } from './auth.js';
import { accountSummary, ACCOUNT_IDS } from './brokers.js';
import { getSetting } from './settings.js';
import { killed } from './risk.js';
import * as D from './alpaca/data.js';
import { nyTime, stockSession } from './time.js';
import { isTradingDay } from './market-calendar.js';
import { pdtAllowed, PDT_EQUITY, PDT_MAX } from './pdt.js';

const r2 = (x, d = 2) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d));

// Where the day stands, New York time: pre-market, open, after hours or closed.
export function sessionState(n, tradingDay) {
  if (!tradingDay) return { state: 'closed', label: 'Market closed today' };
  const m = n.minutes;
  if (m < 240) return { state: 'closed', label: 'Closed (pre-market from 4:00)' };
  if (m < 570) return { state: 'pre', label: 'Pre-market', minutesToOpen: 570 - m };
  if (m < 960) return { state: 'open', label: 'Market open', minutesToClose: 960 - m };
  if (m < 1200) return { state: 'after', label: 'After hours' };
  return { state: 'closed', label: 'Closed' };
}
// The PDT status for the desk, from the broker's numbers when there are any.
export function pdtStatus({ account, equity, dayTrades = null, margin = true }) {
  if (account === 'paper') return { applies: false, text: 'Practice account: no day-trade limit.' };
  if (equity >= PDT_EQUITY) return { applies: false, text: 'At or above $25,000: no day-trade limit.' };
  if (dayTrades == null) return { applies: true, text: `Under $25,000: at most ${PDT_MAX} day trades in 5 trading days on a margin account. Your brokerage keeps the official count.` };
  const p = pdtAllowed({ account, equity, margin, dayTrades });
  return { applies: true, dayTrades, left: Math.max(0, PDT_MAX - dayTrades), ok: p.ok, text: p.ok ? `${Math.max(0, PDT_MAX - dayTrades)} of ${PDT_MAX} day trades left in this 5-day window.` : p.why };
}

let moverCache = { at: 0, v: null };
async function movers() {
  if (!D.dataEnabled()) return null;
  if (moverCache.v && Date.now() - moverCache.at < 120e3) return moverCache.v;
  const m = await D.movers('stocks', 8).catch(() => null);
  if (m) moverCache = { at: Date.now(), v: { gainers: (m.gainers || []).map(x => ({ symbol: x.symbol, price: x.price, pct: r2(x.percent_change) })), losers: (m.losers || []).map(x => ({ symbol: x.symbol, price: x.price, pct: r2(x.percent_change) })) } };
  return moverCache.v;
}

export async function desk(userId, account) {
  const t = Date.now(), n = nyTime(t), sum = await accountSummary(userId, account);
  let broker = null;
  if (/^alpaca/.test(account)) { try { const { requireTradingFor } = await import('./alpaca/connections.js'); const a = await (await requireTradingFor(userId, account)).account(); broker = { dayTrades: +a.daytrade_count, margin: +a.multiplier > 1, dayBuyingPower: +a.daytrading_buying_power }; } catch { broker = null; } }
  const positions = (sum.positions || []).map(p => ({ symbol: p.symbol, qty: p.qty, price: r2(p.price), value: r2(p.value), pnl: r2(p.pnl), pnlPct: p.avgPrice ? r2((p.price / p.avgPrice - 1) * 100 * Math.sign(p.qty)) : null })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const intr = (await getSetting(userId, 'intraday', {})) || {}, np = (await getSetting(userId, 'newspicks', {})) || {};
  return {
    account, session: sessionState(n, isTradingDay(n.day)), live: stockSession(t), killed: await killed(userId),
    money: { equity: r2(sum.equity), cash: r2(sum.cash), buyingPower: r2(sum.buyingPower ?? sum.cash), dayBuyingPower: broker?.dayBuyingPower ?? null, today: sum.lastEquity ? r2(sum.equity - sum.lastEquity) : null, todayPct: sum.lastEquity ? r2((sum.equity / sum.lastEquity - 1) * 100) : null },
    pdt: pdtStatus({ account, equity: sum.equity || 0, dayTrades: broker?.dayTrades ?? null, margin: broker?.margin ?? true }),
    positions, movers: await movers(),
    engines: [{ id: 'intraday', name: 'Intraday rule bot', on: !!intr.enabled, account: intr.account || 'paper', href: 'bots/intraday' }, { id: 'newspicks', name: 'Morning news screen', on: !!np.enabled, account: np.account || 'paper', href: 'signals/newspicks' }],
    note: 'Prices may be delayed depending on your data plan. Trading involves risk of loss.', // the footer's wording
  };
}

export const activeRouter = (() => {
  const r = express.Router(); r.use(requireUser);
  r.get('/', async (req, res) => {
    const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper';
    try { res.json(await desk(req.user.id, account)); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Not available right now.' }); }
  });
  return r;
})();
