// Intraday rule bot (route intraday; Automate → Bots → Intraday rule bot). A slow intraday rule bot: every few
// minutes (5 at the fastest) it looks at 5-minute bars of a short list of stocks the member chose and
// buys or sells within hard limits. It is not high-frequency trading and is never called that: one
// decision per stock per run, market orders through the member's own account, no co-location.
// Limits, all checked on the server for every order: the kill switch, trading hours (9:45 to 15:45
// New York), a minimum time between orders, a maximum number of orders a day, a maximum per position,
// a maximum number of open positions, a stop loss, a daily loss limit and the pattern-day-trader rule
// on real margin accounts under $25,000. Everything is closed at 15:50 unless the member chose to hold
// a high-dividend stock over its ex-dividend date (the price usually drops by about the dividend on
// that day, so this is no free money; the page says so). Paper is the default; a real account needs
// the Elite plan, the password and the step-up check. Every order and its reason are logged.
import express from 'express';
import { requireUser, confirmsIdentity } from './auth.js';
import { one, all, run, now, audit } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { accountSummary, placeOrder } from './brokers.js';
import { killed } from './risk.js';
import * as D from './alpaca/data.js';
import { nyTime } from './time.js';
import { isTradingDay } from './market-calendar.js';
import { isPaid } from './fees.js';
import { stepUpGuard } from './security.js';
import { notifyUser } from './notify-user.js';
import { pdtAllowed } from './pdt.js';
import { TOOL_HYPOTHETICAL } from './disclosures.js';

const r2 = (x, d = 2) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const ELITE = u => u?.role === 'admin' || (['elite', 'ultimate'].includes(u?.plan) && isPaid(u));
// Reviewed wording only (public/disclosures.js). The rule bot trades the practice account only.
export const NOT_ADVICE = TOOL_HYPOTHETICAL;
// Large US companies known for paying dividends (a starting list, not a recommendation).
export const HIGH_DIVIDEND = ['KO', 'PEP', 'PG', 'JNJ', 'XOM', 'CVX', 'VZ', 'T', 'MO', 'PM', 'ABBV', 'PFE', 'IBM', 'O', 'DUK', 'SO', 'KMB', 'MRK'];
export const DEFAULTS = { enabled: false, account: 'paper', live: false, list: 'dividend', symbols: [], everyMin: 15, maxTrades: 10, maxPosition: 500, maxOpen: 3, stopPct: 1.5, targetPct: 2, dailyLoss: 100, holdExDiv: false };
export const OPEN_MIN = 585, LAST_ENTRY_MIN = 945, CLOSE_MIN = 950; // 9:45, 15:45, 15:50 New York

export function cleanSettings(b = {}, prev = DEFAULTS) {
  const num = (v, d, lo, hi) => { const x = v === undefined || v === '' ? d : +v; if (!Number.isFinite(x)) throw bad('Check the numbers'); return Math.min(hi, Math.max(lo, x)); };
  const s = { ...DEFAULTS, ...prev };
  const raw = b.symbols === undefined ? s.symbols : Array.isArray(b.symbols) ? b.symbols : String(b.symbols).split(/[\s,]+/);
  const symbols = [...new Set(raw.map(x => String(x).trim().toUpperCase()).filter(x => /^[A-Z]{1,5}(\.[A-Z])?$/.test(x)))].slice(0, 10);
  const out = { enabled: b.enabled === undefined ? !!s.enabled : !!b.enabled, account: String(b.account ?? s.account ?? 'paper'), live: b.live === undefined ? !!s.live : !!b.live,
    list: (b.list ?? s.list) === 'custom' ? 'custom' : 'dividend', symbols,
    everyMin: Math.round(num(b.everyMin, s.everyMin, 5, 60)), maxTrades: Math.round(num(b.maxTrades, s.maxTrades, 1, 40)), maxPosition: num(b.maxPosition, s.maxPosition, 10, 100000),
    maxOpen: Math.round(num(b.maxOpen, s.maxOpen, 1, 10)), stopPct: num(b.stopPct, s.stopPct, 0.3, 10), targetPct: num(b.targetPct, s.targetPct, 0.3, 20), dailyLoss: num(b.dailyLoss, s.dailyLoss, 1, 100000),
    holdExDiv: b.holdExDiv === undefined ? !!s.holdExDiv : !!b.holdExDiv };
  out.account = 'paper'; out.live = false; // the practice account only
  if (out.list === 'custom' && !out.symbols.length) out.list = 'dividend';
  return out;
}
export const watchList = s => (s.list === 'custom' && s.symbols.length ? s.symbols : HIGH_DIVIDEND).slice(0, 10);

function rsi(c, n = 14) {
  if (c.length <= n) return null; let g = 0, l = 0;
  for (let i = c.length - n; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
// The decision for one stock from its 5-minute closes. Entry: price above its 20-bar average, the
// last bar up and RSI between 50 and 70 (rising, not stretched). Exit: the stop, the target, RSI over
// 75 or the price back under the average. Returns { action: 'buy' | 'sell' | 'hold', reason }.
export function decide(closes, pos = null, s = DEFAULTS) {
  if (!closes || closes.length < 21) return { action: 'hold', reason: 'Not enough 5-minute bars yet' };
  const px = closes.at(-1), avg = closes.slice(-20).reduce((a, b) => a + b, 0) / 20, r = rsi(closes);
  if (pos) {
    const ch = (px / pos.entry - 1) * 100;
    if (ch <= -s.stopPct) return { action: 'sell', reason: `Stop loss: ${r2(ch)}% from the entry` };
    if (ch >= s.targetPct) return { action: 'sell', reason: `Target reached: +${r2(ch)}%` };
    if (r != null && r > 75) return { action: 'sell', reason: `RSI ${r2(r, 0)}: stretched, taking the gain or loss (${r2(ch)}%)` };
    if (px < avg) return { action: 'sell', reason: `Back under its 20-bar average (${r2(ch)}%)` };
    return { action: 'hold', reason: `Holding: ${r2(ch)}% from the entry` };
  }
  if (px > avg && px > closes.at(-2) && r != null && r >= 50 && r <= 70) return { action: 'buy', reason: `Above its 20-bar average, last bar up, RSI ${r2(r, 0)}` };
  return { action: 'hold', reason: 'No entry signal' };
}
// The limits for a new order. state: { killed, minutes, tradesToday, lastAt, nowAt, open, todayPl,
// equity, dayTrades, side, sameDay (a sell of a position bought today) }.
export function limitsAllow(state, s) {
  if (state.killed) return { ok: false, why: 'The kill switch is on.' };
  if (state.side === 'buy') {
    if (state.minutes < OPEN_MIN || state.minutes > LAST_ENTRY_MIN) return { ok: false, why: 'New positions only between 9:45 and 15:45 New York time.' };
    if (state.tradesToday >= s.maxTrades) return { ok: false, why: `Daily limit of ${s.maxTrades} orders reached.` };
    if (state.lastAt && state.nowAt - state.lastAt < s.everyMin * 60e3) return { ok: false, why: `At most one order every ${s.everyMin} minutes.` };
    if (state.open >= s.maxOpen) return { ok: false, why: `Already ${state.open} open positions (your limit).` };
    if (state.todayPl <= -Math.abs(s.dailyLoss)) return { ok: false, why: `Today's loss reached your daily limit of $${s.dailyLoss}.` };
    // A buy that would have to be sold today is a day trade: check before buying, never trap a sell.
    const p = pdtAllowed({ account: s.account, equity: state.equity, dayTrades: state.dayTrades }); if (!p.ok) return p;
  }
  return { ok: true };
}
// Hold over the ex-dividend date: only for a stock on the dividend list, with the option on, when its
// ex-dividend date is the next trading day (buy before it to receive the dividend).
export const holdOverExDiv = (symbol, s, exDates = {}, nextDay) => !!(s.holdExDiv && HIGH_DIVIDEND.includes(symbol) && exDates[symbol] && exDates[symbol] === nextDay);
export function stats(log) {
  const sells = log.filter(l => l.side === 'sell' && l.pl != null), wins = sells.filter(l => l.pl > 0), losses = sells.filter(l => l.pl < 0);
  return { orders: log.length, closed: sells.length, wins: wins.length, losses: losses.length, hitRate: sells.length ? Math.round(wins.length / sells.length * 100) : null,
    pl: r2(sells.reduce((a, l) => a + l.pl, 0)), worst: sells.length ? r2(Math.min(...sells.map(l => l.pl))) : null, best: sells.length ? r2(Math.max(...sells.map(l => l.pl))) : null };
}

const POS = 'intraday:pos';
const nextTradingDay = day => { let d = new Date(day + 'T12:00:00Z'); for (let i = 0; i < 10; i++) { d = new Date(+d + 864e5); const k = d.toISOString().slice(0, 10); if (isTradingDay(k)) return k; } return null; };
async function exDividendDates(symbols, day) {
  const out = {}; if (!D.dataEnabled()) return out;
  const ca = await D.corporateActions({ symbols, types: 'cash_dividend', start: day, end: nextTradingDay(day) || day }).catch(() => ({}));
  for (const c of ca.cash_dividends || []) if (c.symbol && c.ex_date) out[c.symbol] = c.ex_date;
  return out;
}
async function log(userId, account, symbol, side, qty, price, reason, pl = null) {
  await run('INSERT INTO intraday_log (user_id, account, symbol, side, qty, price, reason, pl, at) VALUES (?,?,?,?,?,?,?,?,?)', userId, account, symbol, side, qty, price, reason, pl, now());
}
const dayStart = t => { const n = nyTime(t); return t - n.minutes * 60e3 - 60e3; };
async function dayTrades(userId, account, t) {
  return (await one("SELECT COUNT(*) c FROM intraday_log WHERE user_id = ? AND account = ? AND side = 'sell' AND reason NOT LIKE 'Held over%' AND at > ?", userId, account, t - 7 * 864e5)).c
    + (await one("SELECT COUNT(*) c FROM newspicks_trades WHERE user_id = ? AND account = ? AND status = 'closed' AND at > ?", userId, account, t - 7 * 864e5).catch(() => ({ c: 0 }))).c;
}

// One member, one run. closes: { SYM: [5-minute closes] } shared across members in the same run.
export async function runFor(userId, s, closes, { t = now(), exDates = {} } = {}) {
  const n = nyTime(t), acted = [];
  if (s.account !== 'paper') return [{ skipped: 'The intraday rule bot runs on the practice account only.' }];
  const pos = (await getSetting(userId, POS, {})) || {};
  const isKilled = await killed(userId), closing = n.minutes >= CLOSE_MIN, next = nextTradingDay(n.day);
  const sell = async (sym, p, px, reason) => {
    const pl = r2((px - p.entry) * p.qty);
    await placeOrder(userId, s.account, { symbol: sym, side: 'sell', qty: p.qty, expectedPrice: px }, 'intraday');
    await log(userId, s.account, sym, 'sell', p.qty, px, reason, pl); delete pos[sym]; acted.push({ symbol: sym, side: 'sell', reason, pl });
  };
  // Exits first; the kill switch stops new buys, never a protective sell.
  for (const [sym, p] of Object.entries(pos)) {
    const c = closes[sym], px = c?.at(-1); if (!px) continue;
    try {
      if (closing) {
        if (p.day === n.day && holdOverExDiv(sym, s, exDates, next)) { if (!p.held) { p.held = true; acted.push({ symbol: sym, side: 'hold', reason: 'Held overnight over its ex-dividend date' }); } continue; }
        await sell(sym, p, px, p.held ? 'Held over the ex-dividend date, sold before the close' : 'Closed before the close'); continue;
      }
      const d = decide(c, p, s); if (d.action === 'sell') await sell(sym, p, px, p.held ? `Held over the ex-dividend date, sold: ${d.reason}` : d.reason);
    } catch (e) { acted.push({ symbol: sym, error: e.message }); }
  }
  if (!closing && s.enabled) {
    const sum = await accountSummary(userId, s.account).catch(() => null);
    for (const sym of watchList(s)) {
      if (pos[sym]) continue; const c = closes[sym], d = decide(c, null, s); if (d.action !== 'buy') continue;
      const todayRows = await all('SELECT * FROM intraday_log WHERE user_id = ? AND at > ? ORDER BY id', userId, dayStart(t));
      const state = { killed: isKilled, minutes: n.minutes, tradesToday: todayRows.length, lastAt: todayRows.at(-1)?.at || null, nowAt: t, open: Object.keys(pos).length,
        todayPl: todayRows.reduce((a, r) => a + (r.pl || 0), 0), equity: sum?.equity || 0, dayTrades: await dayTrades(userId, s.account, t), side: 'buy' };
      const g = limitsAllow(state, s); if (!g.ok) { acted.push({ symbol: sym, skipped: g.why }); break; }
      const px = c.at(-1), dollars = Math.min(s.maxPosition, sum?.cash ?? 0), qty = Math.floor(dollars / px);
      if (qty < 1) { acted.push({ symbol: sym, skipped: 'Not enough cash for one share within your position limit.' }); continue; }
      try { await placeOrder(userId, s.account, { symbol: sym, side: 'buy', qty, expectedPrice: px }, 'intraday');
        pos[sym] = { qty, entry: px, day: n.day, at: t }; await log(userId, s.account, sym, 'buy', qty, px, d.reason); acted.push({ symbol: sym, side: 'buy', reason: d.reason }); }
      catch (e) { acted.push({ symbol: sym, error: e.message }); }
    }
  }
  await setSetting(userId, POS, pos);
  return acted;
}

// The job, every 5 minutes: members whose own interval is due. Bars are fetched once per run for all.
let lastRun = {};
export async function tick(t = now()) {
  const n = nyTime(t); if (!isTradingDay(n.day) || n.minutes < OPEN_MIN || n.minutes > CLOSE_MIN + 5 || !D.dataEnabled()) return 0;
  const rows = await all("SELECT user_id FROM user_settings WHERE k = 'intraday'"), members = [];
  for (const { user_id: uid } of rows) {
    const s = cleanSettings((await getSetting(uid, 'intraday', {})) || {}), held = Object.keys((await getSetting(uid, POS, {})) || {});
    if (!s.enabled && !held.length) continue;
    if (n.minutes < CLOSE_MIN && lastRun[uid] && t - lastRun[uid] < s.everyMin * 60e3 - 30e3) continue;
    members.push({ uid, s, syms: [...new Set([...watchList(s), ...held])] });
  }
  if (!members.length) return 0;
  const syms = [...new Set(members.flatMap(m => m.syms))];
  const b = await D.bars(syms, { timeframe: '5Min', start: new Date(t - 3 * 864e5).toISOString(), limit: 5000 }).catch(() => ({}));
  const closes = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, (v || []).map(x => x.c)]));
  const exDates = n.minutes >= CLOSE_MIN - 5 ? await exDividendDates(syms.filter(x => HIGH_DIVIDEND.includes(x)), n.day) : {};
  for (const m of members) {
    lastRun[m.uid] = t;
    const acted = await runFor(m.uid, m.s, closes, { t, exDates }).catch(e => [{ error: e.message }]);
    const errs = acted.filter(a => a.error); if (errs.length) await notifyUser(m.uid, `Intraday rule bot: ${errs.map(e => `${e.symbol || ''} ${e.error}`).join('; ')}`).catch(() => {});
  }
  return members.length;
}
export const _resetIntraday = () => { lastRun = {}; };

export const intradayRouter = (() => {
  const r = express.Router(); r.use(requireUser);
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(e.status || 500).json({ error: e.status ? e.message : 'Not available right now.', ...(e.upgrade ? { upgrade: true, feature: e.feature } : {}) }));
  r.get('/', wrap(async (req, res) => {
    const s = cleanSettings((await getSetting(req.user.id, 'intraday', {})) || {});
    const rows = await all('SELECT * FROM intraday_log WHERE user_id = ? ORDER BY id DESC LIMIT 500', req.user.id);
    res.json({ settings: s, watch: watchList(s), dividendList: HIGH_DIVIDEND, open: (await getSetting(req.user.id, POS, {})) || {}, log: rows.slice(0, 100), stats: stats(rows),
      killed: await killed(req.user.id), paid: isPaid(req.user), elite: ELITE(req.user), dataEnabled: D.dataEnabled(), note: NOT_ADVICE,
      limits: { fastest: 5, hours: '9:45 to 15:45 New York for new positions; everything closed at 15:50', pdt: 'Margin accounts under $25,000: at most 3 day trades in 5 trading days' } });
  }));
  r.put('/settings', wrap(async (req, res) => {
    if (!ELITE(req.user)) throw Object.assign(bad('The intraday rule bot is part of the Elite plan. You can read how it works, its limits and its log for free.', 402), { upgrade: true, feature: 'Intraday rule bot' });
    if (req.body?.live || (req.body?.account && req.body.account !== 'paper')) throw bad('The intraday rule bot runs on the practice account only.', 400);
    const prev = cleanSettings((await getSetting(req.user.id, 'intraday', {})) || {}), s = cleanSettings(req.body || {}, prev);
    await setSetting(req.user.id, 'intraday', s);
    await audit(req.user.id, 'intraday_settings', { enabled: s.enabled, maxTrades: s.maxTrades, maxPosition: s.maxPosition }, req.ip).catch(() => {});
    res.json({ settings: s });
  }));
  // Stop: turn the engine off. Open positions stay as they are (sell them from Positions, or the
  // engine closes them at 15:50 as usual).
  r.post('/stop', wrap(async (req, res) => {
    const s = cleanSettings((await getSetting(req.user.id, 'intraday', {})) || {}); s.enabled = false;
    await setSetting(req.user.id, 'intraday', s); await audit(req.user.id, 'intraday_stop', {}, req.ip).catch(() => {});
    res.json({ settings: s });
  }));
  return r;
})();
