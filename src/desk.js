// The trading desk: what the order ticket needs to look and behave like a professional terminal.
//  - session: is the US stock market open, the next open and close (NYSE holidays and early
//    closes), used for the opening and closing bell banners;
//  - quote: price with the data source it came from and how long it took, bid/ask and spread when
//    the account has a live quote feed;
//  - holding: what the chosen account holds of the symbol (for "Sell all" and the sell check);
//  - costs: commission, SEC and FINRA fees on sales, the bid/ask spread and an estimate of
//    slippage, from rates the owner keeps current in Admin → Market data → Trading fees.
import { shared } from './shared-cache.js';
import express from 'express';
import { one, all } from './db.js';
import { requireUser } from './auth.js';
import { siteGet, siteSet } from './site.js';
import { nyTime, nyAt } from './time.js';
import * as DS from './datasources.js';
import { isTradingDay, earlyClose as earlyCloseMin, holidays, addDays, nextTradingDay, marketStatus } from './market-calendar.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
// The market calendar is the shared one (public/market-calendar.js): weekends, NYSE holidays and
// 1 PM early closes, computed by rule, the same in the browser. No second list is kept here.
const tradingDay = isTradingDay;
export const closeMin = iso => earlyCloseMin(iso) ?? 960;
// Kept for older callers: the holidays and early-close days of this year and the next two.
const yrs = (() => { const y = new Date().getUTCFullYear(); return [y - 1, y, y + 1, y + 2]; })();
export const HOLIDAYS = new Set(yrs.flatMap(y => [...holidays(y).keys()]));
export const EARLY_CLOSE = new Set(yrs.flatMap(y => { const out = []; for (let d = `${y}-01-01`; d <= `${y}-12-31`; d = addDays(d, 1)) if (earlyCloseMin(d)) out.push(d); return out; }));
// The New York date of the session an order placed now belongs to: today until today's close,
// after that (or on a weekend or holiday) the next trading day.
export function orderDay(t = Date.now()) {
  const n = nyTime(t);
  if (tradingDay(n.day) && n.minutes < closeMin(n.day)) return n.day;
  return nextTradingDay(n.day);
}

// The market session now: open or not, the next open and close, and the one label used everywhere
// (marketStatus in the shared calendar). Weekends and holidays are "closed", with the holiday's name.
export function session(t = Date.now()) {
  const m = marketStatus(t), today = m.day;
  const nextOpen = nyAt(m.nextOpenDay, 570);
  const nextClose = m.open ? nyAt(today, closeMin(today)) : nyAt(m.nextOpenDay, closeMin(m.nextOpenDay));
  return { open: m.open, status: m.status, nextOpen, nextClose, earlyClose: m.earlyClose, holiday: m.holiday, holidayName: m.holidayName, weekend: m.weekend, nextOpenEarly: m.nextOpenEarly, label: m.label, now: t };
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
    const t0 = Date.now();
    // Everyone looking at the same symbol shares one trip to the data sources (src/shared-cache.js):
    // the price and the bid/ask are fetched together, kept 1 s, and for 2 s more the last ones are
    // shown at once while one refresh runs. Orders never use this: they price themselves.
    const live = await shared(`desk:quote:${symbol}`, 1000, 2000, async () => {
      let q = null;
      try { q = await DS.quote(symbol, req.user.id); } catch (e) { if (e.status === 404) throw bad(`Unknown symbol ${symbol}`, 404); }
      const { quoteAt } = await import('./execution.js');
      return { q, nb: await quoteAt(symbol, q?.price).catch(() => null) };
    });
    let q = live.q, nb = live.nb;
    if (!q) { const { lastPrice } = await import('./brokers.js'); q = { price: await lastPrice(symbol, req.user.id), source: 'Last known price (no live source)' }; }
    const ms = Date.now() - t0;
    let bid = null, ask = null;
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
