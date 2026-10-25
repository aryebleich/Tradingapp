// Options tools: Black-Scholes pricing and payoff/what-if curves, one-tap strategy templates built
// from the live chain, a scanner for income trades (covered calls, cash-secured puts, credit
// spreads, iron condors), and income bots that open and manage those trades on an Alpaca account
// with built-in risk controls (target delta, days to expiry, profit take, stop, size limits).
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import { lastPrice, accountSummary } from './brokers.js';
import { tradingFor } from './alpaca/connections.js';
import { nyTime, stockSession } from './time.js';
import { isPaid } from './fees.js';
import { killed, getRisk } from './risk.js';
import { notifyUser } from './notify-user.js';
import * as D from './alpaca/data.js';

// ---------- pricing ----------
const ncdf = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
export function bs(S, K, T, iv, type, r = 0.04) {
  if (T <= 0 || iv <= 0) return { price: Math.max(0, type === 'call' ? S - K : K - S), delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0) };
  const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / (iv * Math.sqrt(T)), d2 = d1 - iv * Math.sqrt(T);
  return type === 'call' ? { price: S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2), delta: ncdf(d1) } : { price: K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1), delta: ncdf(d1) - 1 };
}
const dte = exp => Math.max(0, (Date.parse(exp + 'T20:00:00Z') - Date.now()) / 864e5);

// legs: { kind: 'call'|'put'|'stock', side: 'buy'|'sell', qty, strike?, premium (per share), iv?, expiration? }
export function payoff(legs, { spot, daysForward = 0, ivShift = 0, points = 81, range = 0.35 } = {}) {
  const lo = spot * (1 - range), hi = spot * (1 + range), xs = Array.from({ length: points }, (_, i) => lo + (hi - lo) * i / (points - 1));
  const sign = l => (l.side === 'buy' ? 1 : -1), mult = l => (l.kind === 'stock' ? 1 : 100);
  const valueAt = (S, l, atExpiry) => {
    if (l.kind === 'stock') return S;
    if (atExpiry) return Math.max(0, l.kind === 'call' ? S - l.strike : l.strike - S);
    const T = Math.max(0, dte(l.expiration) - daysForward) / 365;
    return bs(S, l.strike, T, Math.max(0.01, (l.iv || 0.3) + ivShift / 100), l.kind).price;
  };
  const pnl = (S, atExpiry) => legs.reduce((a, l) => a + sign(l) * l.qty * mult(l) * (valueAt(S, l, atExpiry) - l.premium), 0);
  const expiry = xs.map(S => pnl(S, true)), now_ = xs.map(S => pnl(S, false));
  const breakevens = []; for (let i = 1; i < xs.length; i++) if (Math.sign(expiry[i]) !== Math.sign(expiry[i - 1])) breakevens.push(+(xs[i - 1] + (xs[i] - xs[i - 1]) * (-expiry[i - 1] / (expiry[i] - expiry[i - 1]))).toFixed(2));
  const net = legs.reduce((a, l) => a - sign(l) * l.qty * mult(l) * l.premium, 0);
  // Beyond the chart: a rising (falling) right edge means unlimited gain (loss); the left edge stops at a price of 0.
  const slope = expiry.at(-1) - expiry.at(-2), atZero = pnl(0, true);
  return {
    prices: xs.map(x => +x.toFixed(2)), atExpiry: expiry.map(x => +x.toFixed(2)), atDate: now_.map(x => +x.toFixed(2)), breakevens, netCredit: +net.toFixed(2),
    maxProfit: slope > 1e-6 ? 'unlimited' : +Math.max(...expiry, atZero).toFixed(2), maxLoss: slope < -1e-6 ? 'unlimited' : +Math.min(...expiry, atZero).toFixed(2),
  };
}

// ---------- templates ----------
export const TEMPLATES = {
  covered_call: { name: 'Covered call', desc: 'Own 100 shares, sell a call above the price. Income, gives up gains above the strike.' },
  cash_secured_put: { name: 'Cash-secured put', desc: 'Sell a put below the price with cash set aside. Income, or buy the shares cheaper.' },
  bull_call: { name: 'Bull call spread', desc: 'Buy a call, sell a higher call. Limited cost and limited gain.' },
  bear_put: { name: 'Bear put spread', desc: 'Buy a put, sell a lower put. Profits if the price falls, limited risk.' },
  bull_put: { name: 'Bull put credit spread', desc: 'Sell a put, buy a lower put. Income if the price stays above the short strike.' },
  bear_call: { name: 'Bear call credit spread', desc: 'Sell a call, buy a higher call. Income if the price stays below the short strike.' },
  iron_condor: { name: 'Iron condor', desc: 'Credit spreads on both sides. Income if the price stays in a range.' },
  straddle: { name: 'Long straddle', desc: 'Buy a call and a put at the same strike. Profits from a big move either way.' },
  strangle: { name: 'Long strangle', desc: 'Buy an out-of-the-money call and put. Cheaper bet on a big move.' },
  butterfly: { name: 'Call butterfly', desc: 'Buy 1 low, sell 2 middle, buy 1 high call. Profits if the price ends near the middle.' },
  collar: { name: 'Collar', desc: 'Own shares, buy a protective put, sell a call to pay for it.' },
};
const mid = c => (c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.last || c.ask || c.bid || 0);
const byDelta = (list, target) => list.filter(c => c.greeks?.delta != null).sort((a, b) => Math.abs(Math.abs(a.greeks.delta) - target) - Math.abs(Math.abs(b.greeks.delta) - target))[0];
const nearStrike = (list, k) => [...list].sort((a, b) => Math.abs(a.strike - k) - Math.abs(b.strike - k))[0];
const leg = (c, side, qty = 1) => c && { kind: c.type, side, qty, strike: c.strike, premium: +mid(c).toFixed(2), iv: c.iv || 0.3, expiration: c.expiration, symbol: c.symbol, delta: c.greeks?.delta ?? null };
const wing = (list, from, dir, steps = 2) => { const s = list.map(c => c.strike).filter(k => (dir > 0 ? k > from : k < from)).sort((a, b) => dir * (a - b)); return list.find(c => c.strike === s[Math.min(steps, s.length) - 1]); };

export function buildTemplate(id, contracts, spot, expiration) {
  const exp = expiration || [...new Set(contracts.map(c => c.expiration))].find(e => dte(e) >= 20) || contracts[0]?.expiration;
  const calls = contracts.filter(c => c.type === 'call' && c.expiration === exp), puts = contracts.filter(c => c.type === 'put' && c.expiration === exp);
  if (!calls.length || !puts.length) throw Object.assign(new Error('No contracts for that expiration'), { status: 404 });
  const atmC = nearStrike(calls, spot), atmP = nearStrike(puts, spot), stock = { kind: 'stock', side: 'buy', qty: 100, premium: spot, symbol: contracts[0].root };
  const L = {
    covered_call: () => [stock, leg(byDelta(calls, 0.3) || wing(calls, spot, 1), 'sell')],
    cash_secured_put: () => [leg(byDelta(puts, 0.3) || wing(puts, spot, -1), 'sell')],
    bull_call: () => [leg(atmC, 'buy'), leg(wing(calls, atmC.strike, 1, 3), 'sell')],
    bear_put: () => [leg(atmP, 'buy'), leg(wing(puts, atmP.strike, -1, 3), 'sell')],
    bull_put: () => { const s = byDelta(puts, 0.3) || wing(puts, spot, -1); return [leg(s, 'sell'), leg(wing(puts, s.strike, -1, 2), 'buy')]; },
    bear_call: () => { const s = byDelta(calls, 0.3) || wing(calls, spot, 1); return [leg(s, 'sell'), leg(wing(calls, s.strike, 1, 2), 'buy')]; },
    iron_condor: () => { const sp = byDelta(puts, 0.2) || wing(puts, spot, -1, 3), sc = byDelta(calls, 0.2) || wing(calls, spot, 1, 3); return [leg(wing(puts, sp.strike, -1, 2), 'buy'), leg(sp, 'sell'), leg(sc, 'sell'), leg(wing(calls, sc.strike, 1, 2), 'buy')]; },
    straddle: () => [leg(atmC, 'buy'), leg(nearStrike(puts, atmC.strike), 'buy')],
    strangle: () => [leg(byDelta(calls, 0.25) || wing(calls, spot, 1, 2), 'buy'), leg(byDelta(puts, 0.25) || wing(puts, spot, -1, 2), 'buy')],
    butterfly: () => [leg(wing(calls, atmC.strike, -1, 2), 'buy'), leg(atmC, 'sell', 2), leg(wing(calls, atmC.strike, 1, 2), 'buy')],
    collar: () => [stock, leg(byDelta(puts, 0.25) || wing(puts, spot, -1, 2), 'buy'), leg(byDelta(calls, 0.25) || wing(calls, spot, 1, 2), 'sell')],
  }[id];
  if (!L) throw Object.assign(new Error('Unknown template'), { status: 400 });
  const legs = L().filter(Boolean);
  if (legs.some(l => l.kind !== 'stock' && !l.symbol)) throw Object.assign(new Error('The chain does not have the strikes this template needs'), { status: 404 });
  return { template: id, ...TEMPLATES[id], expiration: exp, dte: +dte(exp).toFixed(1), spot, legs, payoff: payoff(legs, { spot }) };
}

// ---------- income scanner ----------
// Ranks income trades by return on capital at risk, annualized, with a rough chance of profit from delta.
export function incomeCandidates(chain, spot, { strategy = 'cash_secured_put', dteMin = 20, dteMax = 50, targetDelta = 0.3 } = {}) {
  const out = [];
  for (const exp of chain.expirations) {
    const d = dte(exp); if (d < dteMin || d > dteMax) continue;
    const calls = chain.contracts.filter(c => c.type === 'call' && c.expiration === exp), puts = chain.contracts.filter(c => c.type === 'put' && c.expiration === exp);
    const ann = (credit, capital) => +(credit / capital * 365 / d * 100).toFixed(1);
    if (strategy === 'covered_call' || strategy === 'cash_secured_put') {
      const c = byDelta(strategy === 'covered_call' ? calls : puts, targetDelta); if (!c || !(mid(c) > 0)) continue;
      const credit = mid(c) * 100, capital = strategy === 'covered_call' ? spot * 100 : c.strike * 100;
      out.push({ strategy, expiration: exp, dte: Math.round(d), legs: [leg(c, 'sell')], credit: +credit.toFixed(2), capital: +capital.toFixed(0), returnPct: +(credit / capital * 100).toFixed(2), annualizedPct: ann(credit, capital), popPct: +((1 - Math.abs(c.greeks.delta)) * 100).toFixed(0), iv: c.iv });
    } else if (strategy === 'bull_put' || strategy === 'bear_call' || strategy === 'iron_condor') {
      const sp = byDelta(puts, strategy === 'iron_condor' ? 0.2 : targetDelta), sc = byDelta(calls, strategy === 'iron_condor' ? 0.2 : targetDelta);
      const lp = sp && wing(puts, sp.strike, -1, 2), lc = sc && wing(calls, sc.strike, 1, 2);
      const legs = strategy === 'bull_put' ? [sp && leg(sp, 'sell'), lp && leg(lp, 'buy')] : strategy === 'bear_call' ? [sc && leg(sc, 'sell'), lc && leg(lc, 'buy')] : [lp && leg(lp, 'buy'), sp && leg(sp, 'sell'), sc && leg(sc, 'sell'), lc && leg(lc, 'buy')];
      if (legs.some(l => !l)) continue;
      const credit = legs.reduce((a, l) => a + (l.side === 'sell' ? 1 : -1) * l.premium * 100, 0);
      const width = Math.max(strategy !== 'bear_call' ? sp.strike - lp.strike : 0, strategy !== 'bull_put' ? lc.strike - sc.strike : 0) * 100;
      if (!(credit > 0) || !(width > credit)) continue;
      const pop = strategy === 'iron_condor' ? 1 - Math.abs(sp.greeks.delta) - Math.abs(sc.greeks.delta) : 1 - Math.abs((strategy === 'bull_put' ? sp : sc).greeks.delta);
      out.push({ strategy, expiration: exp, dte: Math.round(d), legs, credit: +credit.toFixed(2), capital: +(width - credit).toFixed(0), returnPct: +(credit / (width - credit) * 100).toFixed(2), annualizedPct: ann(credit, width - credit), popPct: +(pop * 100).toFixed(0) });
    }
  }
  return out.sort((a, b) => b.annualizedPct - a.annualizedPct);
}

// ---------- income bots ----------
export const BOT_DEFAULTS = { targetDelta: 0.25, dteMin: 25, dteMax: 45, takeProfitPct: 50, stopMultiple: 2, closeDte: 7, contracts: 1 };
const occMid = async (symbol, underlying, expiration) => { const ch = await D.optionChain(underlying, { expiration }); const c = ch.contracts.find(x => x.symbol === symbol); return c ? { mid: mid(c), ask: c.ask, bid: c.bid } : null; };

// Once a day in the session: open a trade when none is open, otherwise manage the open one.
export async function runIncomeBots(t = now()) {
  const n = nyTime(t); if (!stockSession(t) || n.minutes < 630) return 0; // from 10:30 New York time
  const bots = await all('SELECT b.*, u.plan, u.role, u.plan_status FROM income_bots b JOIN users u ON u.id = b.user_id WHERE b.active = 1 AND (b.last_run IS NULL OR b.last_run != ?)', n.day);
  let ran = 0;
  for (const b of bots) {
    if (!(await run('UPDATE income_bots SET last_run = ? WHERE id = ? AND (last_run IS NULL OR last_run != ?)', n.day, b.id, n.day)).changes) continue;
    ran++;
    let action;
    try { action = await stepIncomeBot(b); } catch (e) { action = 'error: ' + e.message; }
    await run('UPDATE income_bots SET last_action = ? WHERE id = ?', action, b.id);
    if (!/^hold/.test(action)) await notifyUser(b.user_id, `Option income bot ${b.underlying} (${b.kind}): ${action}`);
  }
  return ran;
}
export async function stepIncomeBot(b) {
  if (!isPaid(b)) throw new Error('option income bots are part of Pro');
  if (await killed(b.user_id)) return 'hold: kill switch on';
  const t = await tradingFor(b.user_id); if (!t) throw new Error('connect Alpaca first');
  const cfg = { ...BOT_DEFAULTS, ...JSON.parse(b.config) }, state = JSON.parse(b.state || '{}'), save = s => run('UPDATE income_bots SET state = ? WHERE id = ?', JSON.stringify(s), b.id);
  // An order sent earlier: keep it once filled, cancel it if the day passed unfilled.
  if (state.pending) {
    const o = await t.order(state.pending.orderId);
    if (o.status === 'filled') { if (state.pending.close) { (state.history ||= []).push({ ...state.open, closedAt: Date.now(), closePrice: +o.filled_avg_price }); delete state.open; } else state.open = { ...state.pending, credit: +o.filled_avg_price }; delete state.pending; await save(state); }
    else if (['canceled', 'expired', 'rejected'].includes(o.status) || Date.now() - state.pending.at > 20 * 3600e3) { await t.cancelOrder(o.id).catch(() => {}); delete state.pending; await save(state); return 'previous order did not fill; will try again'; }
    else return 'hold: order still working';
  }
  if (state.open) {
    const q = await occMid(state.open.symbol, b.underlying, state.open.expiration); if (!q) throw new Error('no quote for the open contract');
    const why = q.mid <= state.open.credit * (1 - cfg.takeProfitPct / 100) ? `take profit (${cfg.takeProfitPct}% of credit)` : q.mid >= state.open.credit * (1 + cfg.stopMultiple) ? `stop (${cfg.stopMultiple}x credit)` : dte(state.open.expiration) <= cfg.closeDte ? `${cfg.closeDte} days to expiry` : null;
    if (!why) return `hold: ${state.open.symbol} worth ${q.mid.toFixed(2)} vs credit ${state.open.credit.toFixed(2)}`;
    const o = await t.placeOrder({ symbol: state.open.symbol, qty: String(state.open.qty), side: 'buy', type: 'limit', limit_price: (q.ask || q.mid).toFixed(2), time_in_force: 'day', position_intent: 'buy_to_close' });
    state.pending = { ...state.open, orderId: o.id, at: Date.now(), close: true }; await save(state);
    return `closing ${state.open.symbol}: ${why}`;
  }
  const spot = await lastPrice(b.underlying, b.user_id), chain = await D.optionChain(b.underlying);
  const acct = await accountSummary(b.user_id, 'alpaca'), shares = acct.positions.find(p => p.symbol === b.underlying)?.qty || 0;
  const kind = b.kind === 'wheel' ? (shares >= 100 * cfg.contracts ? 'covered_call' : 'cash_secured_put') : b.kind;
  if (kind === 'covered_call' && shares < 100 * cfg.contracts) return `hold: needs ${100 * cfg.contracts} shares of ${b.underlying} for covered calls`;
  const best = incomeCandidates(chain, spot, { strategy: kind, dteMin: cfg.dteMin, dteMax: cfg.dteMax, targetDelta: cfg.targetDelta })[0];
  if (!best) return 'hold: no contract matches the delta and expiry settings';
  if (kind === 'cash_secured_put' && best.legs[0].strike * 100 * cfg.contracts > acct.cash) return 'hold: not enough cash to secure the put';
  const r = await getRisk(b.user_id);
  if (r.maxOrderUsd && kind === 'cash_secured_put' && best.legs[0].strike * 100 * cfg.contracts > r.maxOrderUsd) return 'hold: over your per-order limit';
  const l = best.legs[0];
  const o = await t.placeOrder({ symbol: l.symbol, qty: String(cfg.contracts), side: 'sell', type: 'limit', limit_price: l.premium.toFixed(2), time_in_force: 'day', position_intent: 'sell_to_open' });
  state.pending = { symbol: l.symbol, expiration: l.expiration, strike: l.strike, kind, qty: cfg.contracts, credit: l.premium, orderId: o.id, at: Date.now() };
  await save(state);
  return `sold to open ${cfg.contracts} ${l.symbol} at ${l.premium.toFixed(2)} (about ${best.popPct}% chance of profit, ${best.annualizedPct}%/yr)`;
}

export const optionsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const needData = () => { if (!D.dataEnabled()) throw bad('Option data needs the market-data source (ALPACA_KEY_ID / ALPACA_SECRET)', 503); };
  r.get('/templates', (req, res) => res.json(TEMPLATES));
  r.post('/template', async (req, res) => {
    needData();
    const u = String(req.body.underlying || '').toUpperCase(), spot = await lastPrice(u, req.user.id), chain = await D.optionChain(u, req.body.expiration ? { expiration: req.body.expiration } : {});
    res.json({ ...buildTemplate(String(req.body.template), chain.contracts, spot, req.body.expiration), expirations: chain.expirations });
  });
  r.post('/payoff', (req, res) => {
    const legs = (req.body.legs || []).slice(0, 8).map(l => ({ kind: ['call', 'put', 'stock'].includes(l.kind) ? l.kind : 'call', side: l.side === 'sell' ? 'sell' : 'buy', qty: Math.max(1, +l.qty || 1), strike: +l.strike, premium: +l.premium || 0, iv: +l.iv || 0.3, expiration: l.expiration }));
    res.json(payoff(legs, { spot: +req.body.spot, daysForward: +req.body.daysForward || 0, ivShift: +req.body.ivShift || 0 }));
  });
  r.post('/scan', async (req, res) => {
    needData();
    if (!rateLimit('optscan:' + req.user.id, 20, 3600e3)) throw bad('Too many option scans this hour', 429);
    const unders = String(req.body.underlyings || 'SPY,QQQ,AAPL,MSFT').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 10), out = [];
    for (const u of unders) {
      try { const spot = await lastPrice(u, req.user.id), chain = await D.optionChain(u); for (const c of incomeCandidates(chain, spot, req.body).slice(0, 3)) out.push({ underlying: u, spot, ...c }); }
      catch (e) { out.push({ underlying: u, error: e.message }); }
    }
    res.json(out.sort((a, b) => (b.annualizedPct || -1) - (a.annualizedPct || -1)));
  });
  r.get('/bots', async (req, res) => res.json((await all('SELECT * FROM income_bots WHERE user_id = ? ORDER BY id DESC', req.user.id)).map(b => ({ ...b, config: JSON.parse(b.config), state: JSON.parse(b.state || '{}') }))));
  r.post('/bots', async (req, res) => {
    if (!isPaid(req.user)) throw Object.assign(bad('Option income bots are part of Pro'), { status: 402, upgrade: true, feature: 'Automated option income' });
    if (!(await tradingFor(req.user.id))) throw bad('Connect your Alpaca account first (options trade on Alpaca)');
    const kind = ['covered_call', 'cash_secured_put', 'wheel'].includes(req.body.kind) ? req.body.kind : 'cash_secured_put';
    const cfg = {
      targetDelta: Math.max(0.05, Math.min(0.5, +req.body.targetDelta || BOT_DEFAULTS.targetDelta)), dteMin: Math.max(1, +req.body.dteMin || BOT_DEFAULTS.dteMin), dteMax: Math.max(2, +req.body.dteMax || BOT_DEFAULTS.dteMax),
      takeProfitPct: Math.max(10, Math.min(95, +req.body.takeProfitPct || BOT_DEFAULTS.takeProfitPct)), stopMultiple: Math.max(0.5, Math.min(5, +req.body.stopMultiple || BOT_DEFAULTS.stopMultiple)),
      closeDte: Math.max(0, Math.min(30, +req.body.closeDte ?? BOT_DEFAULTS.closeDte)), contracts: Math.max(1, Math.min(10, Math.round(+req.body.contracts || 1))),
    };
    if (cfg.dteMax <= cfg.dteMin) throw bad('Maximum days must be above the minimum');
    const id = (await run('INSERT INTO income_bots (user_id, underlying, kind, config, created_at) VALUES (?,?,?,?,?)', req.user.id, String(req.body.underlying || 'SPY').toUpperCase(), kind, JSON.stringify(cfg), now())).lastInsertRowid;
    await audit(req.user.id, 'income_bot_created', { id, kind }, req.ip);
    res.json({ id });
  });
  r.patch('/bots/:id', async (req, res) => { await run('UPDATE income_bots SET active = ? WHERE id = ? AND user_id = ?', req.body.active ? 1 : 0, +req.params.id, req.user.id); res.json({ ok: true }); });
  r.delete('/bots/:id', async (req, res) => { await run('DELETE FROM income_bots WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
})();
