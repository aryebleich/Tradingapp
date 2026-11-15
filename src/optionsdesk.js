// Options desk: the chain the way professionals read it, one contract in depth, open positions with
// live return, exercise, portfolio Greeks, and AI on top.
//
//   Chain: per contract the premium (mid), bid/ask, IV and every Greek, in / at / out of the money
//   with the distance from the price, intrinsic and time value, break-even, the chance of ending in
//   the money, and the dollar time decay a day; the expected move for each expiration.
//   Contract: buy or sell to open, cost or credit, most you can lose and gain, break-even, chance of
//   profit, the time-decay curve, and a return table for price moves at today, halfway and expiry.
//   Positions: live return on investment, P/L, days left, moneyness, decay a day; close, roll and
//   exercise. Greeks: the whole account's delta, gamma, theta and vega.
//   AI: a strategist (outlook and budget in, ranked strategies built from the live chain out), a
//   plain-English explanation of any contract, and a review of open positions (hold, close, roll).
import express from 'express';
import { requireUser } from './auth.js';
import { aiLimits, useQuota } from './aiplans.js';
import * as D from './alpaca/data.js';

const r2 = x => Math.round((+x || 0) * 100) / 100;
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const R = 0.04;
const ncdf = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const npdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
export const dteOf = (exp, t = Date.now()) => Math.max(0, (Date.parse(exp + 'T20:00:00Z') - t) / 864e5);

// Black-Scholes with every Greek. theta is per calendar day, vega per 1 point of volatility.
export function greeks(S, K, T, iv, type) {
  if (!(S > 0 && K > 0)) return null;
  if (T <= 0 || !(iv > 0)) { const itm = type === 'call' ? S > K : S < K; return { price: Math.max(0, type === 'call' ? S - K : K - S), delta: itm ? (type === 'call' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, probItm: itm ? 1 : 0 }; }
  const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (R + iv * iv / 2) * T) / (iv * sq), d2 = d1 - iv * sq, disc = Math.exp(-R * T);
  const call = type === 'call';
  const price = call ? S * ncdf(d1) - K * disc * ncdf(d2) : K * disc * ncdf(-d2) - S * ncdf(-d1);
  const theta = (-(S * npdf(d1) * iv) / (2 * sq) - (call ? 1 : -1) * R * K * disc * ncdf(call ? d2 : -d2)) / 365;
  return { price, delta: call ? ncdf(d1) : ncdf(d1) - 1, gamma: npdf(d1) / (S * iv * sq), theta, vega: S * npdf(d1) * sq / 100, probItm: call ? ncdf(d2) : ncdf(-d2) };
}
// Chance the price ends above (or below) a level at expiry, from the implied volatility.
export const probAbove = (S, X, T, iv) => (T <= 0 || !(iv > 0) ? (S > X ? 1 : 0) : ncdf((Math.log(S / X) + (R - iv * iv / 2) * T) / (iv * Math.sqrt(T))));
export const mid = c => (c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.last || c.ask || c.bid || 0);

export function moneyness(type, K, S) {
  const pct = (K / S - 1) * 100;
  if (Math.abs(pct) <= 0.5) return { label: 'ATM', pct: r2(pct) };
  const itm = type === 'call' ? K < S : K > S;
  return { label: itm ? 'ITM' : 'OTM', pct: r2(pct) };
}
// One contract with everything a trader reads off it.
export function enrich(c, S, t = Date.now()) {
  const days = dteOf(c.expiration, t), T = days / 365, m = mid(c), iv = c.iv || null;
  const g = greeks(S, c.strike, T, iv || 0.3, c.type);
  const intrinsic = Math.max(0, c.type === 'call' ? S - c.strike : c.strike - S);
  const mo = moneyness(c.type, c.strike, S);
  return {
    symbol: c.symbol, type: c.type, strike: c.strike, expiration: c.expiration, dte: r2(days),
    bid: c.bid ?? null, ask: c.ask ?? null, last: c.last ?? null, mid: r2(m), spread: c.bid > 0 && c.ask > 0 ? r2(c.ask - c.bid) : null,
    iv: iv == null ? null : r2(iv * 100), volume: c.volume ?? null, openInterest: c.openInterest ?? null,
    delta: r2(c.greeks?.delta ?? g?.delta), gamma: +(c.greeks?.gamma ?? g?.gamma ?? 0).toFixed(4), theta: +(c.greeks?.theta ?? g?.theta ?? 0).toFixed(4), vega: +(c.greeks?.vega ?? g?.vega ?? 0).toFixed(4),
    moneyness: mo.label, fromSpotPct: mo.pct, intrinsic: r2(intrinsic), timeValue: r2(Math.max(0, m - intrinsic)),
    breakeven: r2(c.type === 'call' ? c.strike + m : c.strike - m), probItm: r2((g?.probItm ?? 0) * 100),
    decayPerDay: r2(Math.abs(c.greeks?.theta ?? g?.theta ?? 0) * 100), // dollars a day for one contract
  };
}

export async function chain(underlying, expiration) {
  if (!D.dataEnabled()) throw bad('Option data needs market data (ALPACA_KEY_ID / ALPACA_SECRET in Admin → Keys)', 503);
  const u = String(underlying).toUpperCase();
  const [all, snaps] = await Promise.all([D.optionChain(u, expiration ? { expiration } : {}), D.snapshots([u]).catch(() => ({}))]);
  const spot = snaps[u]?.price || null;
  const exp = expiration && all.expirations.includes(expiration) ? expiration : all.expirations.find(e => dteOf(e) >= 1) || all.expirations[0];
  if (!exp) return { underlying: u, spot, expirations: [], contracts: [] };
  const list = all.contracts.filter(c => c.expiration === exp);
  const S = spot || list.reduce((a, c) => a + c.strike, 0) / (list.length || 1);
  const rows = list.map(c => enrich(c, S));
  // Expected move by expiry: the at-the-money straddle, and the one-standard-deviation move from IV.
  const strikes = [...new Set(rows.map(r => r.strike))], atm = strikes.sort((a, b) => Math.abs(a - S) - Math.abs(b - S))[0];
  const ac = rows.find(r => r.strike === atm && r.type === 'call'), ap = rows.find(r => r.strike === atm && r.type === 'put');
  const straddle = ac && ap ? r2(ac.mid + ap.mid) : null, ivAtm = ac?.iv || ap?.iv || null;
  return {
    underlying: u, spot: r2(S), expiration: exp, dte: r2(dteOf(exp)), atmStrike: atm,
    expirations: all.expirations.map(e => ({ date: e, dte: Math.round(dteOf(e)) })),
    expectedMove: { straddle, pct: straddle && S ? r2(straddle / S * 100) : null, oneSd: ivAtm ? r2(S * ivAtm / 100 * Math.sqrt(dteOf(exp) / 365)) : null },
    contracts: rows.sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type)),
  };
}

// One contract in depth, for buying or selling (to open). qty in contracts.
export function analyzeContract(c, S, { side = 'buy', qty = 1, t = Date.now() } = {}) {
  const sign = side === 'sell' ? -1 : 1, m = c.mid, n = 100 * qty, days = dteOf(c.expiration, t), iv = (c.iv || 30) / 100;
  const be = c.type === 'call' ? c.strike + m : c.strike - m;
  const cost = r2(m * n);
  let maxLoss, maxGain;
  if (side === 'buy') { maxLoss = cost; maxGain = c.type === 'call' ? 'unlimited' : r2((c.strike - m) * n); }
  else { maxGain = cost; maxLoss = c.type === 'call' ? 'unlimited' : r2((c.strike - m) * n); }
  const pAbove = probAbove(S, be, days / 365, iv);
  const probProfit = r2(100 * (c.type === 'call' ? (side === 'buy' ? pAbove : 1 - pAbove) : (side === 'buy' ? 1 - pAbove : pAbove)));
  const valueAt = (price, daysLeft) => greeks(price, c.strike, Math.max(0, daysLeft) / 365, iv, c.type).price;
  // Time decay: the contract's value with the price unchanged, as expiry nears.
  const steps = [...new Set([days, days * 0.75, days * 0.5, days * 0.25, Math.min(days, 7), Math.min(days, 1), 0].map(d => r2(d)))].sort((a, b) => b - a);
  const decay = steps.map(d => ({ daysLeft: d, value: r2(valueAt(S, d)), pnl: r2(sign * (valueAt(S, d) - m) * n) }));
  // Return table: price moves at today, halfway and expiry.
  const moves = [-15, -10, -5, -2, 0, 2, 5, 10, 15], when = [['Today', days], ['Halfway', days / 2], ['At expiry', 0]];
  const basis = side === 'buy' ? cost : (c.type === 'put' ? r2(c.strike * n) : r2(S * n * 0.2)); // capital at risk for a seller: cash for a put, rough margin for a call
  const scenarios = moves.map(mv => {
    const price = S * (1 + mv / 100);
    return { move: mv, price: r2(price), cells: when.map(([label, d]) => { const pnl = r2(sign * (valueAt(price, d) - m) * n); return { label, pnl, roi: basis ? r2(pnl / basis * 100) : null }; }) };
  });
  return {
    side, qty, premium: r2(m), cost: side === 'buy' ? cost : -cost, maxLoss, maxGain, breakeven: r2(be), probProfit, dte: r2(days),
    capital: basis, thetaPerDay: r2(-sign * c.decayPerDay * qty), deltaShares: r2(sign * c.delta * n),
    decay, scenarios, assignment: side === 'sell' ? (c.type === 'put' ? `If assigned you buy ${n} shares at ${c.strike} (${r2(c.strike * n).toLocaleString('en-US')} dollars).` : `If assigned you sell ${n} shares at ${c.strike}; without the shares this is a naked call with unlimited risk.`) : null,
  };
}

// Open option positions with live value.
export async function positions(userId, account) {
  const { accountSummary } = await import('./brokers.js');
  const s = await accountSummary(userId, account);
  const opts = (s.positions || []).map(p => ({ ...p, occ: D.parseOcc(p.symbol) })).filter(p => p.occ);
  if (!opts.length) return { account, positions: [], greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 } };
  const groups = {};
  for (const p of opts) (groups[`${p.occ.root}|${p.occ.expiration}`] ||= []).push(p);
  const out = [], tot = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const [k, list] of Object.entries(groups)) {
    const [root, exp] = k.split('|');
    const ch = await chain(root, exp).catch(() => null);
    for (const p of list) {
      const c = ch?.contracts.find(x => x.symbol === p.symbol) || enrich({ symbol: p.symbol, ...p.occ, last: p.price }, ch?.spot || p.occ.strike);
      const qty = p.qty, n = Math.abs(qty) * 100, avg = +p.avgPrice || 0, now = c.mid || p.price;
      const roi = avg ? r2((qty > 0 ? now - avg : avg - now) / avg * 100) : null;
      const sgn = qty > 0 ? 1 : -1;
      tot.delta += sgn * c.delta * n; tot.gamma += sgn * c.gamma * n; tot.theta += sgn * c.theta * n; tot.vega += sgn * c.vega * n;
      out.push({ symbol: p.symbol, underlying: root, type: c.type, strike: c.strike, expiration: c.expiration, dte: c.dte, qty, avgPrice: r2(avg), mid: r2(now), value: r2(now * n * sgn), pnl: r2((now - avg) * n * sgn), roi,
        moneyness: c.moneyness, fromSpotPct: c.fromSpotPct, spot: ch?.spot ?? null, delta: c.delta, theta: c.theta, decayPerDay: r2(c.decayPerDay * Math.abs(qty) * -sgn), probItm: c.probItm, canExercise: qty > 0 && /^alpaca/.test(account) });
    }
  }
  return { account, positions: out.sort((a, b) => a.dte - b.dte), greeks: { delta: r2(tot.delta), gamma: r2(tot.gamma), theta: r2(tot.theta), vega: r2(tot.vega) } };
}

// ---------- AI ----------
const OUTLOOKS = {
  bullish: ['long_call', 'bull_call', 'bull_put', 'risk_reversal'], bearish: ['long_put', 'bear_put', 'bear_call'],
  neutral: ['iron_condor', 'iron_butterfly', 'butterfly', 'short_strangle'], volatile: ['straddle', 'strangle'], income: ['cash_secured_put', 'bull_put', 'iron_condor', 'covered_call'],
};
export async function strategist(user, { underlying, outlook = 'bullish', budget = 1000, expiration, userId }) {
  const O = await import('./options.js');
  const ch = await D.optionChain(underlying, expiration ? { expiration } : {});
  const snaps = await D.snapshots([underlying]).catch(() => ({}));
  const spot = snaps[underlying]?.price;
  if (!spot) throw bad('No price for ' + underlying, 404);
  const cands = [];
  for (const id of OUTLOOKS[outlook] || OUTLOOKS.bullish) {
    try {
      const t = O.buildTemplate(id, ch.contracts, spot, expiration);
      const p = t.payoff, ivAvg = t.legs.filter(l => l.iv).reduce((a, l, _, arr) => a + l.iv / arr.length, 0) || 0.3;
      // Chance of profit at expiry: the share of the price range (weighted by the lognormal) where the payoff is above zero.
      let prob = 0, prev = 0; const T = t.dte / 365;
      p.prices.forEach((x, i) => { const cdf = 1 - probAbove(spot, x, T, ivAvg); if (i && p.atExpiry[i] > 0) prob += cdf - prev; prev = cdf; });
      const maxLoss = p.maxLoss === 'unlimited' ? null : Math.abs(p.maxLoss);
      const scale = maxLoss ? Math.max(1, Math.floor(budget / maxLoss)) : 1;
      cands.push({ id, name: t.name, desc: t.desc, expiration: t.expiration, dte: t.dte, legs: t.legs, netCredit: p.netCredit, maxProfit: p.maxProfit, maxLoss: p.maxLoss, breakevens: p.breakevens, probProfit: r2(prob * 100), fitsBudget: maxLoss != null && maxLoss <= budget, units: scale, undefinedRisk: p.maxLoss === 'unlimited' });
    } catch {}
  }
  if (!cands.length) throw bad('The chain does not have the strikes these strategies need', 404);
  cands.sort((a, b) => (b.fitsBudget - a.fitsBudget) || (b.probProfit - a.probProfit));
  const { llmEnabled, jsonCall, llmInfo } = await import('./llm.js');
  if (!llmEnabled()) return { underlying, spot: r2(spot), outlook, budget, candidates: cands, pick: cands[0].id, why: `Ranked by whether the most you can lose fits $${budget} and by the chance of profit at expiry.`, engine: null };
  await useQuota(user, 'optionsai', aiLimits(user).optionsAi, 'day', 'AI options analysis');
  const out = await jsonCall({
    system: 'You are an options strategist. From the candidate strategies given (already priced from the live chain), pick the best fit for the outlook and budget and explain it in plain English: why, what has to happen to make money, what can go wrong, and how to manage it (when to take profit, when to cut, when to roll). Prefer defined risk unless the user can carry the risk. Use only the numbers given. Education, not advice.',
    user: JSON.stringify({ underlying, spot, outlook, budget, candidates: cands.map(({ legs, ...c }) => ({ ...c, legs: legs.map(l => `${l.side} ${l.qty} ${l.kind}${l.strike ? ' ' + l.strike : ''}`) })) }),
    schema: { type: 'object', additionalProperties: false, required: ['pick', 'why', 'howToProfit', 'risks', 'manage'], properties: { pick: { type: 'string' }, why: { type: 'string' }, howToProfit: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } }, manage: { type: 'array', items: { type: 'string' } } } },
    maxTokens: 1400,
  });
  return { underlying, spot: r2(spot), outlook, budget, candidates: cands, ...out, engine: llmInfo()?.name || 'AI' };
}
export async function explain(user, c, a, spot) {
  const { llmEnabled, jsonCall, llmInfo } = await import('./llm.js');
  const plain = `${a.side === 'buy' ? 'Buying' : 'Selling'} this ${c.type} gives ${c.type === 'call' ? 'the right to buy' : 'the right to sell'} 100 shares at ${c.strike} until ${c.expiration} (${Math.round(c.dte)} days). It is ${c.moneyness === 'ITM' ? 'in the money' : c.moneyness === 'ATM' ? 'at the money' : 'out of the money'} (${c.fromSpotPct}% from the price). The premium is ${c.mid} a share; ${c.timeValue} of that is time value, which shrinks about ${c.decayPerDay} dollars a day. Break-even at expiry: ${a.breakeven}. Chance of profit at expiry: about ${a.probProfit}%.`;
  if (!llmEnabled()) return { text: plain, engine: null };
  await useQuota(user, 'optionsai', aiLimits(user).optionsAi, 'day', 'AI options analysis');
  const out = await jsonCall({ system: 'Explain this option trade to a beginner in 4 to 6 short sentences: what it is, what has to happen to profit, how time decay and volatility affect it, the most that can be lost, and one thing to watch. Use only the numbers given. Education, not advice.', user: JSON.stringify({ spot, contract: c, analysis: { ...a, scenarios: undefined, decay: a.decay.slice(0, 4) } }), schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, maxTokens: 700 });
  return { text: out.text, engine: llmInfo()?.name || 'AI' };
}
export async function review(user, pos) {
  if (!pos.positions.length) return { overview: 'No open option positions in this account.', positions: [] };
  const { llmEnabled, jsonCall, llmInfo } = await import('./llm.js');
  const rule = p => (p.dte <= 3 && p.moneyness !== 'ITM' && p.qty > 0 ? ['close', 'Little time left and out of the money: the rest of its value is time value that is about to go.'] : p.roi != null && p.roi >= 50 && p.qty < 0 ? ['close', 'Most of the premium is already earned; the rest is not worth the risk.'] : p.roi != null && p.roi <= -50 ? ['close', 'Down half or more: review whether the reason for the trade still holds.'] : p.dte <= 10 && p.qty < 0 && p.moneyness === 'ITM' ? ['roll', 'Short and in the money near expiry: assignment is likely; roll out in time to keep the position.'] : ['hold', 'Within normal range.']);
  if (!llmEnabled()) return { overview: 'Plain rules (no AI set up): take most of a credit early, cut big losers, do not let long options decay to zero, roll short options that are in the money near expiry.', positions: pos.positions.map(p => { const [action, why] = rule(p); return { symbol: p.symbol, action, why }; }), engine: null };
  await useQuota(user, 'optionsai', aiLimits(user).optionsAi, 'day', 'AI options analysis');
  const out = await jsonCall({ system: 'Review these option positions. For each, suggest hold / close / roll / take profit with one plain reason from the data (return, days left, moneyness, decay). Then one overview sentence on the account\'s Greeks. Only the data; education, not advice.', user: JSON.stringify(pos),
    schema: { type: 'object', additionalProperties: false, required: ['overview', 'positions'], properties: { overview: { type: 'string' }, positions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['symbol', 'action', 'why'], properties: { symbol: { type: 'string' }, action: { type: 'string', enum: ['hold', 'close', 'roll', 'take profit'] }, why: { type: 'string' } } } } } }, maxTokens: 1500 });
  return { ...out, engine: llmInfo()?.name || 'AI' };
}

// ---------- routes ----------
const OCC = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
const okAccount = a => (a === 'paper' || a === 'alpaca' || /^alpaca:\d{1,3}$/.test(a) ? a : 'paper');
export const optionsDeskRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  const und = s => { const u = String(s || '').toUpperCase(); if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(u)) throw bad('Check the symbol'); return u; };
  r.get('/chain/:u', wrap(async (req, res) => res.json(await chain(und(req.params.u), /^\d{4}-\d{2}-\d{2}$/.test(req.query.expiration || '') ? req.query.expiration : undefined))));
  r.get('/contract/:sym', wrap(async (req, res) => {
    const sym = String(req.params.sym).toUpperCase(); if (!OCC.test(sym)) throw bad('Not an option symbol');
    const p = D.parseOcc(sym), ch = await chain(p.root, p.expiration), c = ch.contracts.find(x => x.symbol === sym);
    if (!c) throw bad('That contract is not trading now', 404);
    const side = req.query.side === 'sell' ? 'sell' : 'buy', qty = Math.min(500, Math.max(1, Math.round(+req.query.qty || 1)));
    res.json({ spot: ch.spot, contract: c, analysis: analyzeContract(c, ch.spot, { side, qty }) });
  }));
  r.get('/positions', wrap(async (req, res) => res.json(await positions(req.user.id, okAccount(String(req.query.account || 'paper'))))));
  r.post('/exercise', wrap(async (req, res) => {
    const account = okAccount(String(req.body?.account || '')), sym = String(req.body?.symbol || '').toUpperCase();
    if (!/^alpaca/.test(account)) throw bad('Exercising is done on an Alpaca account');
    if (!OCC.test(sym)) throw bad('Not an option symbol');
    const { requireTradingFor } = await import('./alpaca/connections.js');
    await (await requireTradingFor(req.user.id, account)).exerciseOption(sym);
    res.json({ ok: true, note: 'Exercise sent. The shares (or the sale) show up after the broker processes it, usually by the next morning.' });
  }));
  r.post('/ai/strategy', wrap(async (req, res) => {
    const b = req.body || {};
    res.json(await strategist(req.user, { underlying: und(b.underlying), outlook: Object.keys(OUTLOOKS).includes(b.outlook) ? b.outlook : 'bullish', budget: Math.min(1e7, Math.max(50, +b.budget || 1000)), expiration: /^\d{4}-\d{2}-\d{2}$/.test(b.expiration || '') ? b.expiration : undefined }));
  }));
  r.post('/ai/explain', wrap(async (req, res) => {
    const sym = String(req.body?.symbol || '').toUpperCase(); if (!OCC.test(sym)) throw bad('Not an option symbol');
    const p = D.parseOcc(sym), ch = await chain(p.root, p.expiration), c = ch.contracts.find(x => x.symbol === sym);
    if (!c) throw bad('That contract is not trading now', 404);
    res.json(await explain(req.user, c, analyzeContract(c, ch.spot, { side: req.body?.side === 'sell' ? 'sell' : 'buy' }), ch.spot));
  }));
  r.post('/ai/review', wrap(async (req, res) => res.json(await review(req.user, await positions(req.user.id, okAccount(String(req.body?.account || 'paper')))))));
  return r;
})();
