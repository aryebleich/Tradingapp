// The trading desk: what the order ticket needs to look and behave like a professional terminal.
//  - session: is the US stock market open, the next open and close (NYSE holidays and early
//    closes), used for the opening and closing bell banners;
//  - quote: price with the data source it came from and how long it took, bid/ask and spread when
//    the account has a live quote feed;
//  - holding: what the chosen account holds of the symbol (for "Sell all" and the sell check);
//  - costs: commission, SEC and FINRA fees on sales, the bid/ask spread and an estimate of
//    slippage, from rates the owner keeps current in Admin → Market data → Trading fees.
import express from 'express';
import { one, all } from './db.js';
import { requireUser } from './auth.js';
import { siteGet, siteSet } from './site.js';
import { nyTime, nyAt } from './time.js';
import * as DS from './datasources.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
// NYSE full holidays and 1 PM early closes.
export const HOLIDAYS = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24']);
export const EARLY_CLOSE = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const tradingDay = iso => { const wd = new Date(iso + 'T12:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso); };
export const closeMin = iso => (EARLY_CLOSE.has(iso) ? 780 : 960);
// The New York date of the session an order placed now belongs to: today until today's close,
// after that (or on a weekend or holiday) the next trading day.
export function orderDay(t = Date.now()) {
  const n = nyTime(t);
  if (tradingDay(n.day) && n.minutes < closeMin(n.day)) return n.day;
  let d = addDays(n.day, 1); while (!tradingDay(d)) d = addDays(d, 1);
  return d;
}

export function session(t = Date.now()) {
  const n = nyTime(t), today = n.day, open = tradingDay(today) && n.minutes >= 570 && n.minutes < closeMin(today);
  let d = today;
  // Next open: today if before 9:30 on a trading day, else the next trading day.
  if (!(tradingDay(d) && n.minutes < 570)) { d = addDays(d, 1); while (!tradingDay(d)) d = addDays(d, 1); }
  const nextOpen = nyAt(d, 570);
  const nextClose = open ? nyAt(today, closeMin(today)) : nyAt(d, closeMin(d));
  const status = open ? 'open' : tradingDay(today) && n.minutes >= 240 && n.minutes < 570 ? 'pre-market' : tradingDay(today) && n.minutes >= closeMin(today) && n.minutes < 1200 ? 'after-hours' : 'closed';
  return { open, status, nextOpen, nextClose, earlyClose: EARLY_CLOSE.has(today), holiday: HOLIDAYS.has(today), now: t };
}

// Trading fees. Brightolio does not charge per trade; brokers like Alpaca charge no commission on
// US stocks and ETFs. Regulators charge small fees on SALES only (SEC Section 31 and FINRA TAF).
export const FEE_DEFAULTS = { commissionPerShare: 0, commissionMin: 0, secPerMillion: 27.8, finraTafPerShare: 0.000166, finraTafMax: 8.3, slippageBps: 2, updated: '2026-11-01' };
export const fees = () => ({ ...FEE_DEFAULTS, ...(siteGet('tradingFees', {}) || {}) });
export async function saveFees(b = {}) {
  const cur = fees(), n = (v, d, max) => (v === undefined || v === '' ? d : Math.min(max, Math.max(0, +v || 0)));
  const next = { commissionPerShare: n(b.commissionPerShare, cur.commissionPerShare, 1), commissionMin: n(b.commissionMin, cur.commissionMin, 50), secPerMillion: n(b.secPerMillion, cur.secPerMillion, 500), finraTafPerShare: n(b.finraTafPerShare, cur.finraTafPerShare, 0.01), finraTafMax: n(b.finraTafMax, cur.finraTafMax, 100), slippageBps: n(b.slippageBps, cur.slippageBps, 500), updated: new Date().toISOString().slice(0, 10) };
  await siteSet('tradingFees', next);
  return next;
}
// What a trade costs beyond the price: fees, half the spread, and expected slippage.
export function costs({ side, qty, price, bid, ask, type = 'market' }, f = fees()) {
  const value = qty * price, sell = side === 'sell';
  const commission = qty > 0 ? Math.max(f.commissionMin, f.commissionPerShare * qty) : 0;
  const sec = sell ? value * f.secPerMillion / 1e6 : 0;
  const taf = sell ? Math.min(f.finraTafMax, Math.ceil(qty) * f.finraTafPerShare) : 0;
  const spread = bid > 0 && ask > bid ? ask - bid : null;
  const halfSpread = type === 'market' && spread ? spread / 2 * qty : 0;
  const slippage = type === 'market' ? value * f.slippageBps / 1e4 : 0;
  const r = x => +x.toFixed(4);
  return { value: +value.toFixed(2), commission: r(commission), secFee: r(sec), finraTaf: r(taf), regulatory: r(sec + taf), spread: spread == null ? null : r(spread), spreadBps: spread && price ? +(spread / price * 1e4).toFixed(1) : null, halfSpread: r(halfSpread), slippage: r(slippage), total: r(commission + sec + taf + halfSpread + slippage) };
}

async function holding(userId, account, symbol) {
  if (account === 'paper') {
    const p = await one("SELECT qty, avg_price FROM positions WHERE user_id = ? AND account = 'paper' AND symbol = ?", userId, symbol);
    const reserved = (await one("SELECT COALESCE(SUM(qty), 0) q FROM paper_orders WHERE user_id = ? AND symbol = ? AND side = 'sell' AND status = 'open'", userId, symbol)).q;
    return { qty: p?.qty || 0, available: Math.max(0, (p?.qty || 0) - reserved), avgPrice: p?.avg_price || null };
  }
  const { accountSummary } = await import('./brokers.js');
  const s = await accountSummary(userId, account).catch(() => null);
  const p = s?.positions?.find(x => x.symbol === symbol || x.symbol === symbol.replace('/', ''));
  return { qty: p?.qty || 0, available: p?.qtyAvailable ?? p?.qty ?? 0, avgPrice: p?.avgPrice || null };
}

// Order round trips from this user's own audit log (sent → accepted at the broker).
async function latencies(userId) {
  const rows = await all("SELECT data FROM exec_audit WHERE user_id = ? AND kind = 'order' ORDER BY id DESC LIMIT 60", userId).catch(() => []);
  const sent = new Map(), out = [];
  for (const r of rows.reverse()) { const d = JSON.parse(r.data || '{}'); if (d.event === 'sent') sent.set(d.orderRef, d.at); else if (d.event === 'accepted' && sent.has(d.orderRef)) out.push(d.at - sent.get(d.orderRef)); }
  out.sort((a, b) => a - b);
  return out.length ? { orders: out.length, medianMs: out[Math.floor(out.length / 2)], bestMs: out[0] } : null;
}

export const deskRouter = (() => {
  const r = express.Router();
  r.get('/session', (req, res) => res.json(session()));
  r.get('/fees', (req, res) => res.json(fees()));
  r.get('/quote/:symbol', requireUser, async (req, res) => {
    const symbol = String(req.params.symbol || '').toUpperCase().slice(0, 15), account = String(req.query.account || 'paper');
    const t0 = Date.now(); let q = null;
    try { q = await DS.quote(symbol, req.user.id); } catch (e) { if (e.status === 404) throw bad(`Unknown symbol ${symbol}`, 404); }
    if (!q) { const { lastPrice } = await import('./brokers.js'); q = { price: await lastPrice(symbol, req.user.id), source: 'Last known price (no live source)' }; }
    const ms = Date.now() - t0;
    let bid = null, ask = null;
    const { quoteAt } = await import('./execution.js');
    const nb = await quoteAt(symbol, q.price).catch(() => null);
    // A bid/ask far from the live price is stale or from another market: not shown.
    if (nb?.bid && nb?.ask && q.price > 0 && Math.abs((nb.bid + nb.ask) / 2 - q.price) / q.price <= 0.03) { bid = nb.bid; ask = nb.ask; }
    const qty = +req.query.qty || 0, side = req.query.side === 'sell' ? 'sell' : 'buy';
    const sess = session(), fresh = DS.PROVIDERS[q.source] ? DS.freshness(q.source, sess.open || symbol.includes('/')) : { level: 'unknown', label: DS.FRESH_LABELS.unknown };
    res.json({ symbol, price: q.price, source: DS.PROVIDERS[q.source]?.name || q.source, sourceId: q.source, latencyMs: ms, freshness: fresh, bid, ask, feed: nb?.feed || null, holding: await holding(req.user.id, account, symbol), session: session(),
      // A limit or stop order is valued at its own price.
      costs: qty ? costs({ side, qty, price: +req.query.price > 0 ? +req.query.price : q.price, bid, ask, type: req.query.type || 'market' }) : null, fees: fees(), orderLatency: await latencies(req.user.id) });
  });
  return r;
})();
