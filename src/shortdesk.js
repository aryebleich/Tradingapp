// Short-selling desk and the margin switch.
//
// Margin switch: margin (borrowing, and with it short selling) is off until the user switches it on
// for an account. On the practice account it takes effect at once. On a brokerage account the
// request goes to the broker (Alpaca: account configurations, max_margin_multiplier and
// no_shorting) and margin is in use only once the broker's account shows it (multiplier above 1),
// which needs the broker's approval and $2,000 of equity.
//
// Short desk: for one symbol, a short plan (entry, stop above resistance, targets at support,
// position size from a risk budget, Reg T margin, borrow cost, the buy-in price that would trigger a
// margin call, reward to risk), the borrow status (shortable, easy or hard to borrow) and a squeeze
// risk score; a screener of the weakest large stocks; a monitor of open shorts with cover levels;
// a beta hedge for a long portfolio; and AI features: a short thesis with the bear and bull case,
// and a cover plan for open shorts.
import express from 'express';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { aiLimits, useQuota } from './aiplans.js';

const r2 = x => Math.round((+x || 0) * 100) / 100;
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const SYM = /^[A-Z][A-Z0-9.]{0,9}$/;
export const SHORT_RULES = { initial: 1.5, maintenance: 0.3, minEquity: 2000 };

// ---------- margin switch ----------
const isBroker = a => a !== 'paper';
export async function marginState(userId, account) {
  const s = (await getSetting(userId, 'margin', {})) || {};
  const mine = s[account] || {};
  if (!isBroker(account)) return { account, on: !!mine.on, status: mine.on ? 'on' : 'off', approval: 'none', note: mine.on ? 'Practice account: margin and short selling are simulated (Reg T: up to 2x equity, shorts need 150%).' : 'Switch it on to borrow and to sell short on the practice account.' };
  let broker = null;
  if (/^alpaca/.test(account)) {
    try { const { requireTradingFor } = await import('./alpaca/connections.js'); const t = await requireTradingFor(userId, account); const [a, c] = await Promise.all([t.account(), t.configurations().catch(() => null)]); broker = { multiplier: +a.multiplier || 1, shorting: !!a.shorting_enabled, equity: +a.equity || 0, maxMultiplier: c?.max_margin_multiplier ?? null, noShorting: c?.no_shorting ?? null }; } catch { broker = null; }
  }
  const approved = broker ? broker.multiplier > 1 : !/^alpaca/.test(account);
  const status = !mine.on ? 'off' : approved ? 'on' : 'waiting';
  const note = status === 'off' ? 'Margin is off: orders use only the cash in the account and short selling is blocked.'
    : status === 'on' ? 'Margin is on and approved by the brokerage.'
    : broker && broker.equity < SHORT_RULES.minEquity ? `Requested. The brokerage approves margin from $${SHORT_RULES.minEquity.toLocaleString('en-US')} of equity; this account has $${Math.round(broker.equity).toLocaleString('en-US')}.`
    : 'Requested. Waiting for the brokerage to approve margin on this account; it switches on here by itself once approved.';
  return { account, on: !!mine.on, status, approval: 'broker', broker, requestedAt: mine.at || null, note };
}
export async function setMargin(userId, account, on) {
  const s = (await getSetting(userId, 'margin', {})) || {};
  s[account] = { ...(s[account] || {}), on: !!on, at: Date.now() };
  if (/^alpaca/.test(account)) {
    // Ask the broker: margin multiplier and shorting follow the switch.
    try {
      const { requireTradingFor } = await import('./alpaca/connections.js');
      const t = await requireTradingFor(userId, account);
      await t.updateConfigurations(on ? { max_margin_multiplier: '4', no_shorting: false } : { max_margin_multiplier: '1', no_shorting: true });
      s[account].sent = true;
    } catch (e) { s[account].sent = false; s[account].error = String(e.message || e).slice(0, 200); }
  }
  await setSetting(userId, 'margin', s);
  return marginState(userId, account);
}
// Used by every order: shorts and borrowing need margin switched on (and approved for brokerages).
export async function marginOn(userId, account) { const m = await marginState(userId, account); return m.status === 'on'; }

// ---------- indicators on daily bars ({ c, h, l, v }) ----------
const sma = (a, n) => (a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null);
function rsi(c, n = 14) {
  if (c.length <= n) return null;
  let g = 0, l = 0;
  for (let i = c.length - n; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  return l === 0 ? 100 : r2(100 - 100 / (1 + g / l));
}
function atr(b, n = 14) {
  if (b.length <= n) return null;
  let s = 0;
  for (let i = b.length - n; i < b.length; i++) s += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
  return s / n;
}
export function technicals(bars) {
  const b = (bars || []).filter(x => x && x.c > 0), c = b.map(x => x.c), last = c.at(-1);
  if (b.length < 25) return null;
  const ret = n => (c.length > n ? (last / c[c.length - 1 - n] - 1) * 100 : null);
  const r = c.slice(1).map((x, i) => Math.log(x / c[i])), r20 = r.slice(-20), mean = r20.reduce((s, x) => s + x, 0) / r20.length;
  const vol = Math.sqrt(r20.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, r20.length - 1)) * Math.sqrt(252) * 100;
  const last20 = b.slice(-20), down = last20.filter((x, i) => i && x.c < last20[i - 1].c), up = last20.filter((x, i) => i && x.c > last20[i - 1].c);
  const avgV = a => (a.length ? a.reduce((s, x) => s + (x.v || 0), 0) / a.length : 0);
  const gaps = b.slice(-60).filter((x, i, a) => i && x.o > a[i - 1].c * 1.03).length;
  const year = b.slice(-252);
  return {
    price: r2(last), sma20: r2(sma(c, 20)), sma50: sma(c, 50) == null ? null : r2(sma(c, 50)), sma200: sma(c, 200) == null ? null : r2(sma(c, 200)),
    rsi: rsi(c), atr: r2(atr(b)), vol20: r2(vol), ret20: ret(20) == null ? null : r2(ret(20)), ret60: ret(60) == null ? null : r2(ret(60)),
    high20: r2(Math.max(...b.slice(-20).map(x => x.h))), low20: r2(Math.min(...b.slice(-20).map(x => x.l))), low50: r2(Math.min(...b.slice(-50).map(x => x.l))),
    high52: r2(Math.max(...year.map(x => x.h))), low52: r2(Math.min(...year.map(x => x.l))),
    downVolRatio: avgV(up) ? r2(avgV(down) / avgV(up)) : null, gapUps60: gaps,
  };
}

// Weakness 0..100: a downtrend, momentum, distance from the high, selling volume.
export function weakness(t) {
  if (!t) return 0;
  let s = 0;
  if (t.sma50 && t.price < t.sma50) s += 18;
  if (t.sma200 && t.price < t.sma200) s += 18;
  if (t.sma50 && t.sma200 && t.sma50 < t.sma200) s += 10;
  if (t.ret60 != null) s += Math.max(0, Math.min(18, -t.ret60 * 0.9));
  if (t.ret20 != null) s += Math.max(0, Math.min(10, -t.ret20));
  if (t.high52) s += Math.max(0, Math.min(12, (1 - t.price / t.high52) * 40));
  if (t.downVolRatio != null && t.downVolRatio > 1) s += Math.min(8, (t.downVolRatio - 1) * 16);
  if (t.rsi != null && t.rsi > 35 && t.rsi < 60) s += 6; // room to fall, not yet oversold
  return Math.round(Math.min(100, s));
}
// Squeeze risk 0..100: volatile, gaps up, oversold, near the low, hard to borrow, low price.
export function squeezeRisk(t, borrow = {}) {
  if (!t) return { score: null, reasons: [] };
  let s = 0; const why = [];
  if (t.vol20 > 60) { s += 25; why.push(`very volatile (${Math.round(t.vol20)}% a year)`); } else if (t.vol20 > 40) { s += 12; why.push('volatile'); }
  if (t.gapUps60) { s += Math.min(24, t.gapUps60 * 8); why.push(`${t.gapUps60} gap${t.gapUps60 > 1 ? 's' : ''} up of 3%+ in 60 days`); }
  if (t.rsi != null && t.rsi < 30) { s += 18; why.push(`oversold (RSI ${Math.round(t.rsi)}): sharp bounces are common`); }
  if (t.low52 && t.price < t.low52 * 1.05) { s += 8; why.push('near its 52-week low'); }
  if (borrow.easyToBorrow === false) { s += 22; why.push('hard to borrow: the lender can recall the shares'); }
  if (t.price < 5) { s += 10; why.push('low-priced stock'); }
  return { score: Math.min(100, s), level: s >= 50 ? 'high' : s >= 25 ? 'medium' : 'low', reasons: why };
}

// A short plan for one symbol. riskPct: the share of equity lost if the stop is hit.
export function shortPlan({ t, equity, riskPct = 1, feePct = 0.5, days = 20, entry = null }) {
  if (!t) return null;
  const px = +entry > 0 ? +entry : t.price, a = t.atr || px * 0.02;
  const stop = r2(Math.max(t.high20 * 1.005, px + 2 * a));
  const t1 = r2(t.low20 < px ? t.low20 : px - 2 * a), t2 = r2(Math.min(t1 - a, t.low50 < t1 ? t.low50 : px - 4 * a));
  const perShare = stop - px;
  const shares = perShare > 0 ? Math.max(0, Math.floor((equity * riskPct / 100) / perShare)) : 0;
  const value = r2(shares * px);
  return {
    entry: r2(px), stop, targets: [t1, t2], riskPerShare: r2(perShare), shares, value,
    maxLoss: r2(shares * perShare), reward1: r2(shares * (px - t1)), reward2: r2(shares * (px - t2)),
    rewardRisk: perShare > 0 ? r2((px - t1) / perShare) : null,
    initialMargin: r2(value * (SHORT_RULES.initial - 1)), maintenance: r2(value * SHORT_RULES.maintenance),
    borrowCost: r2(value * feePct / 100 * days / 365), feePct, days,
    // Alone in the account: margin call when equity falls to 30% of the short value.
    callPrice: shares ? r2((equity + value) / (shares * (1 + SHORT_RULES.maintenance))) : null,
  };
}

// Borrow status from the brokerage's asset list.
async function borrowOf(userId, symbol) {
  try {
    const { tradingFor } = await import('./alpaca/connections.js');
    const t = await tradingFor(userId).catch(() => null); if (!t) return { known: false };
    const a = await t.asset(symbol);
    return { known: true, shortable: !!a.shortable, easyToBorrow: a.easy_to_borrow == null ? null : !!a.easy_to_borrow, name: a.name || null };
  } catch { return { known: false }; }
}
async function barsFor(symbols, days = 400) {
  const D = await import('./alpaca/data.js');
  if (!D.dataEnabled()) throw bad('Market data is not available right now', 503);
  return D.bars(symbols, { timeframe: '1Day', start: new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), limit: 10000 });
}
export async function analyzeShort(userId, symbol, account, opts = {}) {
  const { accountSummary } = await import('./brokers.js');
  const [bars, s, borrow] = await Promise.all([barsFor([symbol]), accountSummary(userId, account).catch(() => null), borrowOf(userId, symbol)]);
  const t = technicals(bars[symbol]);
  if (!t) throw bad(`Not enough price history for ${symbol}`, 404);
  const equity = s?.equity || 0;
  return { symbol, account, equity: r2(equity), t, weakness: weakness(t), squeeze: squeezeRisk(t, borrow), borrow, plan: shortPlan({ t, equity, ...opts }), margin: await marginState(userId, account) };
}

// Large, easy-to-borrow names the screener looks through, plus the user's watchlist.
export const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'INTC', 'QCOM', 'CSCO', 'IBM', 'NFLX', 'DIS', 'NKE', 'SBUX', 'MCD', 'HD', 'LOW', 'TGT', 'WMT', 'COST', 'PG', 'KO', 'PEP', 'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'V', 'MA', 'PYPL', 'UNH', 'JNJ', 'PFE', 'MRK', 'ABBV', 'LLY', 'CVS', 'XOM', 'CVX', 'COP', 'CAT', 'DE', 'BA', 'GE', 'UPS', 'FDX', 'F', 'GM', 'T', 'VZ', 'BABA', 'SHOP', 'UBER', 'ABNB', 'SNOW', 'PLTR', 'COIN', 'RIVN'];
export async function screen(userId, extra = []) {
  const syms = [...new Set([...extra.filter(s => SYM.test(s)), ...UNIVERSE])].slice(0, 90);
  const bars = await barsFor(syms);
  const rows = [];
  for (const s of syms) {
    const t = technicals(bars[s]); if (!t) continue;
    const w = weakness(t), sq = squeezeRisk(t);
    rows.push({ symbol: s, price: t.price, ret20: t.ret20, ret60: t.ret60, rsi: t.rsi, belowSma200: t.sma200 ? t.price < t.sma200 : null, offHigh: t.high52 ? r2((t.price / t.high52 - 1) * 100) : null, weakness: w, squeeze: sq.score, squeezeLevel: sq.level, score: Math.round(w - (sq.score || 0) * 0.5) });
  }
  return { at: Date.now(), scanned: rows.length, rows: rows.sort((a, b) => b.score - a.score).slice(0, 30) };
}

// Open shorts: P/L, cover levels and squeeze risk.
export async function monitor(userId, account) {
  const { accountSummary } = await import('./brokers.js');
  const s = await accountSummary(userId, account);
  const shorts = (s.positions || []).filter(p => p.qty < 0 && !p.symbol.includes('/'));
  if (!shorts.length) return { account, equity: r2(s.equity), shorts: [] };
  const bars = await barsFor(shorts.map(p => p.symbol)).catch(() => ({}));
  const shortValue = shorts.reduce((a, p) => a - p.value, 0);
  return {
    account, equity: r2(s.equity), shortValue: r2(shortValue), maintenance: r2(shortValue * SHORT_RULES.maintenance),
    shorts: shorts.map(p => {
      const t = technicals(bars[p.symbol]), plan = t ? shortPlan({ t, equity: s.equity, entry: p.avgPrice || p.price }) : null, sq = squeezeRisk(t);
      return { symbol: p.symbol, shares: -p.qty, avgPrice: r2(p.avgPrice), price: r2(p.price), value: r2(-p.value), pnl: r2(p.pnl), pnlPct: p.avgPrice ? r2((p.avgPrice - p.price) / p.avgPrice * 100) : null,
        stop: t ? r2(Math.max(t.high20 * 1.005, p.price + 2 * (t.atr || 0))) : null, cover: plan?.targets || null, squeeze: sq.score, squeezeLevel: sq.level, squeezeWhy: sq.reasons, rsi: t?.rsi ?? null };
    }),
  };
}

// Hedge a long portfolio against a market fall, weighted by each holding's beta.
export async function hedge(userId, account) {
  const { accountSummary } = await import('./brokers.js');
  const D = await import('./alpaca/data.js');
  const s = await accountSummary(userId, account);
  const longs = (s.positions || []).filter(p => p.qty > 0 && !p.symbol.includes('/'));
  if (!longs.length) return { account, longs: 0, note: 'There are no stock or fund holdings to hedge in this account.' };
  const syms = longs.map(p => p.symbol).slice(0, 30);
  const bars = await barsFor([...syms, 'SPY'], 140).catch(() => ({}));
  const ret = b => (b || []).slice(1).map((x, i) => x.c / b[i].c - 1);
  const m = ret(bars.SPY).slice(-90), mm = m.reduce((a, x) => a + x, 0) / (m.length || 1), vm = m.reduce((a, x) => a + (x - mm) ** 2, 0) / (m.length || 1);
  const rows = longs.map(p => {
    const r = ret(bars[p.symbol]).slice(-m.length), n = Math.min(r.length, m.length);
    let beta = 1;
    if (n >= 20 && vm) { const a = m.slice(-n), b = r.slice(-n), am = a.reduce((x, y) => x + y, 0) / n, bm = b.reduce((x, y) => x + y, 0) / n; beta = a.reduce((x, y, i) => x + (y - am) * (b[i] - bm), 0) / n / vm; }
    return { symbol: p.symbol, value: r2(p.value), beta: r2(beta), betaDollars: r2(p.value * beta) };
  });
  const betaDollars = r2(rows.reduce((a, x) => a + x.betaDollars, 0)), longValue = r2(rows.reduce((a, x) => a + x.value, 0));
  const snaps = D.dataEnabled() ? await D.snapshots(['SPY', 'SH']).catch(() => ({})) : {};
  const spy = snaps.SPY?.price || null, sh = snaps.SH?.price || null;
  return {
    account, longValue, betaDollars, portfolioBeta: longValue ? r2(betaDollars / longValue) : null, rows: rows.sort((a, b) => b.betaDollars - a.betaDollars),
    options: [
      { how: 'Short SPY', symbol: 'SPY', shares: spy ? Math.round(betaDollars / spy) : null, price: spy, needsMargin: true, note: 'Cancels the market part of your holdings; needs margin.' },
      { how: 'Buy SH (inverse S&P 500 fund)', symbol: 'SH', shares: sh ? Math.round(betaDollars / sh) : null, price: sh, needsMargin: false, note: 'Works in a cash account; resets daily, so it fits short periods.' },
      { how: 'Half hedge with SH', symbol: 'SH', shares: sh ? Math.round(betaDollars / sh / 2) : null, price: sh, needsMargin: false, note: 'Halves the market risk and keeps half the upside.' },
    ],
  };
}

// ---------- AI ----------
const THESIS = { type: 'object', additionalProperties: false, required: ['verdict', 'summary', 'bearCase', 'bullCase', 'catalysts', 'coverWhen'], properties: {
  verdict: { type: 'string', enum: ['strong short setup', 'moderate short setup', 'weak short setup', 'avoid shorting'] }, summary: { type: 'string' },
  bearCase: { type: 'array', items: { type: 'string' } }, bullCase: { type: 'array', items: { type: 'string' } }, catalysts: { type: 'array', items: { type: 'string' } }, coverWhen: { type: 'array', items: { type: 'string' } } } };
export async function aiThesis(user, a) {
  const { llmEnabled, jsonCall, llmInfo } = await import('./llm.js');
  const D = await import('./alpaca/data.js');
  const news = D.dataEnabled() ? (await D.news({ symbols: [a.symbol], limit: 8 }).catch(() => [])).map(n => ({ headline: n.headline, source: n.source, at: n.created_at })) : [];
  if (!llmEnabled()) {
    const t = a.t, bear = [], bull = [];
    if (t.sma200 && t.price < t.sma200) bear.push('Below its 200-day average: the long trend is down.'); else bull.push('Above its 200-day average: the long trend is up.');
    if (t.ret60 != null) (t.ret60 < 0 ? bear : bull).push(`${t.ret60 < 0 ? 'Down' : 'Up'} ${Math.abs(t.ret60).toFixed(1)}% over 60 days.`);
    if (a.squeeze.score >= 25) bull.push(`Squeeze risk ${a.squeeze.level}: ${a.squeeze.reasons.join(', ')}.`);
    const verdict = a.squeeze.score >= 50 ? 'avoid shorting' : a.weakness >= 65 ? 'strong short setup' : a.weakness >= 45 ? 'moderate short setup' : 'weak short setup';
    return { verdict, summary: `Weakness ${a.weakness}/100, squeeze risk ${a.squeeze.score}/100.`, bearCase: bear, bullCase: bull, catalysts: news.slice(0, 3).map(n => n.headline), coverWhen: [`The price closes above ${a.plan.stop} (the stop).`, `It reaches ${a.plan.targets[0]} (first target).`], engine: null, news };
  }
  await useQuota(user, 'shortai', aiLimits(user).shortAi, 'day', 'AI short analysis');
  const out = await jsonCall({
    system: 'You are a careful short-selling analyst. From the technical data, borrow status, squeeze risk, plan and headlines given, judge whether this is a good short setup. Use only the data; do not invent numbers or news. Give the bear case (why it may fall), the bull case (what could squeeze or lift it), near-term catalysts and when to cover. Be balanced: shorting has unlimited risk. This is education, not advice; never tell the user to trade.',
    user: JSON.stringify({ symbol: a.symbol, technicals: a.t, weakness: a.weakness, squeeze: a.squeeze, borrow: a.borrow, plan: a.plan, news }), schema: THESIS, maxTokens: 1400,
  });
  return { ...out, engine: llmInfo()?.name || 'AI', news };
}
const COVER = { type: 'object', additionalProperties: false, required: ['overview', 'positions'], properties: { overview: { type: 'string' },
  positions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['symbol', 'action', 'why'], properties: { symbol: { type: 'string' }, action: { type: 'string', enum: ['hold', 'tighten stop', 'cover part', 'cover all'] }, why: { type: 'string' }, stop: { type: 'number' } } } } } };
export async function aiCoverPlan(user, mon) {
  if (!mon.shorts.length) return { overview: 'No open shorts in this account.', positions: [] };
  const { llmEnabled, jsonCall, llmInfo } = await import('./llm.js');
  if (!llmEnabled()) return { overview: 'Plain rules: cover when the stop is hit or squeeze risk turns high; take part off at the first cover level.', positions: mon.shorts.map(p => ({ symbol: p.symbol, action: p.stop && p.price >= p.stop ? 'cover all' : p.squeezeLevel === 'high' ? 'cover part' : p.pnlPct > 15 ? 'tighten stop' : 'hold', why: p.squeezeLevel === 'high' ? `Squeeze risk is high: ${p.squeezeWhy.join(', ')}.` : p.pnlPct > 15 ? `Up ${p.pnlPct}% on the short: protect the gain.` : 'Within the plan.', stop: p.stop })), engine: null };
  await useQuota(user, 'shortai', aiLimits(user).shortAi, 'day', 'AI short analysis');
  const out = await jsonCall({ system: 'You review a trader\'s open short positions and suggest, for each, hold / tighten stop / cover part / cover all, with one plain reason from the data and a stop level. Only the data given; this is education, not advice.', user: JSON.stringify(mon), schema: COVER, maxTokens: 1500 });
  return { ...out, engine: llmInfo()?.name || 'AI' };
}

// ---------- routes ----------
const okAccount = a => (a === 'paper' || a === 'alpaca' || /^alpaca:\d{1,3}$/.test(a) || ['tradier', 'tastytrade', 'schwab', 'tradestation'].includes(a) ? a : 'paper');
export const shortRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  r.get('/margin', wrap(async (req, res) => res.json(await marginState(req.user.id, okAccount(String(req.query.account || 'paper'))))));
  r.put('/margin', wrap(async (req, res) => res.json(await setMargin(req.user.id, okAccount(String(req.body?.account || 'paper')), !!req.body?.on))));
  r.get('/analyze/:symbol', wrap(async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase(); if (!SYM.test(symbol)) throw bad('Check the symbol');
    res.json(await analyzeShort(req.user.id, symbol, okAccount(String(req.query.account || 'paper')), { riskPct: Math.min(5, Math.max(0.1, +req.query.risk || 1)), feePct: Math.min(200, Math.max(0, +req.query.fee || 0.5)), days: Math.min(365, Math.max(1, +req.query.days || 20)) }));
  }));
  r.post('/thesis', wrap(async (req, res) => {
    const symbol = String(req.body?.symbol || '').toUpperCase(); if (!SYM.test(symbol)) throw bad('Check the symbol');
    const a = await analyzeShort(req.user.id, symbol, okAccount(String(req.body?.account || 'paper')));
    res.json(await aiThesis(req.user, a));
  }));
  r.get('/screen', wrap(async (req, res) => res.json(await screen(req.user.id, String(req.query.add || '').toUpperCase().split(/[\s,]+/).filter(Boolean)))));
  r.get('/monitor', wrap(async (req, res) => res.json(await monitor(req.user.id, okAccount(String(req.query.account || 'paper'))))));
  r.post('/cover-plan', wrap(async (req, res) => res.json(await aiCoverPlan(req.user, await monitor(req.user.id, okAccount(String(req.body?.account || 'paper')))))));
  r.get('/hedge', wrap(async (req, res) => res.json(await hedge(req.user.id, okAccount(String(req.query.account || 'paper'))))));
  return r;
})();
