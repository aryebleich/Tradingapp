// Morning news screen (route newspicks; Automate → Alerts & signals). Before the open the engine
// reads the news and the pre-market moves of large US stocks, ranks them by headline tone and pre-market move
// today and proposes an allocation, with the reasons and sources for each pick. Each member chooses
// "approve each day" or "automatic", a daily budget, a per-stock limit, a stop loss and a daily loss
// limit. The practice account is the default; a real account needs an explicit opt-in confirmed with
// the password, the Elite plan and the step-up check. Positions are closed before the close (day
// trades; the pattern-day-trader rule applies on real margin accounts). Every day's picks and their
// result are kept, so the real hit rate, losses included, is shown to everyone.
import express from 'express';
import { requireUser, confirmsIdentity } from './auth.js';
import { one, all, run, now, audit } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { accountSummary, placeOrder, lastPrice } from './brokers.js';
import { killed } from './risk.js';
import * as D from './alpaca/data.js';
import { scoreText } from './sentiment.js';
import { nyTime } from './time.js';
import { isTradingDay } from './market-calendar.js';
import { isPaid } from './fees.js';
import { stepUpGuard } from './security.js';
import { notifyUser } from './notify-user.js';
import { pdtAllowed } from './pdt.js';
import { TOOL_HYPOTHETICAL } from './disclosures.js';

const r2 = (x, d = 2) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d));
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
// Reviewed wording only (public/disclosures.js). The screen runs on the practice account only: a real-money
// trade is placed by the member in the order ticket, like any other order.
export const NOT_ADVICE = TOOL_HYPOTHETICAL;
export const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V', 'LLY', 'UNH', 'XOM', 'MA', 'COST', 'HD', 'PG', 'NFLX', 'AMD', 'CRM', 'ORCL', 'ADBE', 'KO', 'PEP', 'WMT', 'BAC', 'DIS', 'INTC', 'CSCO', 'QCOM'];
export const DEFAULTS = { enabled: false, mode: 'approve', account: 'paper', budget: 1000, perStock: 300, maxPicks: 3, stopPct: 3, dailyLoss: 200, live: false };
const ELITE = u => u?.role === 'admin' || (['elite', 'ultimate'].includes(u?.plan) && isPaid(u));

// Settings, clamped to safe ranges. A real account is only kept when the live opt-in is on.
export function cleanSettings(b = {}, prev = DEFAULTS) {
  const num = (v, d, lo, hi) => { const x = v === undefined || v === '' ? d : +v; if (!Number.isFinite(x)) throw bad('Check the numbers'); return Math.min(hi, Math.max(lo, x)); };
  const s = { ...DEFAULTS, ...prev };
  const out = { enabled: b.enabled === undefined ? s.enabled : !!b.enabled, mode: (b.mode ?? s.mode) === 'auto' ? 'auto' : 'approve', account: String(b.account ?? s.account ?? 'paper'),
    budget: num(b.budget, s.budget, 10, 100000), perStock: num(b.perStock, s.perStock, 5, 100000), maxPicks: Math.round(num(b.maxPicks, s.maxPicks, 1, 5)), stopPct: num(b.stopPct, s.stopPct, 0.5, 20), dailyLoss: num(b.dailyLoss, s.dailyLoss, 1, 100000), live: b.live === undefined ? !!s.live : !!b.live };
  if (out.perStock > out.budget) out.perStock = out.budget;
  out.account = 'paper'; out.live = false; // the practice account only (earlier real-money settings fall back to it)
  return out;
}
// candidates: [{ symbol, premarketPct, headlines: [{ title, source, url }], volumeRatio }]. Score:
// the tone of today's headlines (−1 to 1) plus the pre-market move (capped at ±5%), plus a little
// for unusual pre-market volume. Only positive scores with at least one headline are picked.
export function rankPicks(candidates, maxPicks = 5) {
  return candidates.map(c => {
    const tones = (c.headlines || []).map(h => scoreText(h.title)), tone = tones.length ? tones.reduce((a, b) => a + b, 0) / tones.length : 0;
    const move = Math.max(-5, Math.min(5, c.premarketPct || 0)) / 5, vol = c.volumeRatio > 2 ? 0.1 : 0;
    const score = r2(0.6 * tone + 0.35 * move + vol, 3);
    const reasons = [tones.length ? `${tones.length} headline${tones.length === 1 ? '' : 's'} today, tone ${tone > 0.2 ? 'positive' : tone < -0.2 ? 'negative' : 'mixed'} (${r2(tone)})` : 'No headlines today',
      c.premarketPct != null ? `Pre-market ${c.premarketPct > 0 ? '+' : ''}${r2(c.premarketPct, 1)}%` : 'No pre-market price', vol ? 'Unusual pre-market volume' : null].filter(Boolean);
    return { symbol: c.symbol, score, reasons, sources: (c.headlines || []).slice(0, 3).map(h => ({ title: h.title, source: h.source || '', url: h.url || '' })) };
  }).filter(p => p.score > 0 && p.sources.length).sort((a, b) => b.score - a.score).slice(0, maxPicks).map((p, i) => ({ ...p, rank: i + 1 }));
}
// The allocation within the member's caps: the daily budget (never more than the cash), at most
// perStock per pick, weights by score, a stop under each entry. Picks under $5 are dropped.
export function allocate(picks, s, { cash = Infinity, prices = {} } = {}) {
  const budget = Math.max(0, Math.min(s.budget, cash)), list = picks.slice(0, s.maxPicks), total = list.reduce((a, p) => a + p.score, 0);
  const out = [];
  let left = budget;
  for (const p of list) {
    const want = total > 0 ? budget * p.score / total : 0, dollars = r2(Math.min(want, s.perStock, left));
    if (!(dollars >= 5)) continue;
    left -= dollars;
    const px = prices[p.symbol] || null;
    out.push({ symbol: p.symbol, dollars, price: px, stop: px ? r2(px * (1 - s.stopPct / 100)) : null, capped: dollars < want - 0.01 });
  }
  return { orders: out, budget: r2(budget), unused: r2(budget - out.reduce((a, o) => a + o.dollars, 0)) };
}
// Today's loss so far against the limit: stop opening new picks once it is reached.
export const lossGuard = (todayPl, s) => (todayPl <= -Math.abs(s.dailyLoss) ? { ok: false, why: `Today's loss ${r2(todayPl)} reached your daily limit of ${s.dailyLoss}.` } : { ok: true });
// The record of every day's picks: hit rate (closed up from the open), average and worst day, all kept.
export function record(rows) {
  const done = rows.filter(r => r.ret != null);
  if (!done.length) return { days: 0, picks: 0, hitRate: null, avg: null, worst: null, best: null, note: 'No completed days yet.' };
  const days = [...new Set(done.map(r => r.day))], wins = done.filter(r => r.ret > 0).length;
  const byDay = days.map(d => { const x = done.filter(r => r.day === d); return x.reduce((a, r) => a + r.ret, 0) / x.length; });
  return { days: days.length, picks: done.length, hitRate: r2(wins / done.length * 100, 0), losses: done.length - wins, avg: r2(done.reduce((a, r) => a + r.ret, 0) / done.length, 2), worst: r2(Math.min(...byDay), 2), best: r2(Math.max(...byDay), 2), note: 'Each pick from the open to the close of its day, before costs. Past results do not predict future ones.' };
}

// ---------- jobs ----------
async function candidates() {
  if (!D.dataEnabled()) return null;
  const snaps = await D.snapshots(UNIVERSE).catch(() => null); if (!snaps) return null;
  const since = new Date(Date.now() - 18 * 3600e3).toISOString();
  const news = await D.news({ symbols: UNIVERSE, limit: 50, start: since }).catch(() => []);
  return UNIVERSE.map(s => { const x = snaps[s]; return x ? { symbol: s, premarketPct: x.changePct ?? null, volumeRatio: null, price: x.price ?? null, headlines: news.filter(n => (n.symbols || []).includes(s)).map(n => ({ title: n.headline, source: n.source, url: n.url })) } : null; }).filter(Boolean);
}
// 9:00 New York on trading days: today's picks (once).
export async function generate(t = now()) {
  const n = nyTime(t); if (!isTradingDay(n.day) || n.minutes < 540 || n.minutes > 565) return null;
  if ((await one('SELECT COUNT(*) c FROM newspicks_log WHERE day = ?', n.day)).c) return null;
  const c = await candidates(); if (!c) return null;
  const picks = rankPicks(c, 5), price = Object.fromEntries(c.map(x => [x.symbol, x.price]));
  for (const p of picks) await run('INSERT OR IGNORE INTO newspicks_log (day, symbol, rank, score, reasons, sources, open) VALUES (?,?,?,?,?,?,?)', n.day, p.symbol, p.rank, p.score, JSON.stringify(p.reasons), JSON.stringify(p.sources), price[p.symbol] ?? null);
  return picks;
}
const todays = async day => (await all('SELECT * FROM newspicks_log WHERE day = ? ORDER BY rank', day)).map(r => ({ ...r, reasons: JSON.parse(r.reasons || '[]'), sources: JSON.parse(r.sources || '[]') }));
async function dayTradesLast5(userId, account) { return (await one("SELECT COUNT(*) c FROM newspicks_trades WHERE user_id = ? AND account = ? AND status = 'closed' AND at > ?", userId, account, now() - 7 * 864e5)).c + (await one('SELECT COUNT(*) c FROM intraday_log WHERE user_id = ? AND account = ? AND side = \'sell\' AND at > ?', userId, account, now() - 7 * 864e5).catch(() => ({ c: 0 }))).c; }
// Places one member's allocation (approve or automatic). Every guard runs here, on the server.
export async function placeFor(userId, s, picks, { source = 'newspicks' } = {}) {
  const u = await one('SELECT * FROM users WHERE id = ?', userId); const day = nyTime().day;
  if (await killed(userId)) throw bad('The kill switch is on: no automatic orders.', 409);
  if (s.account !== 'paper') throw bad('The morning news screen places orders on the practice account only. For real money, open a stock in the order ticket.', 403);
  if ((await one('SELECT COUNT(*) c FROM newspicks_trades WHERE user_id = ? AND day = ?', userId, day)).c) throw bad('Today\'s picks were already placed.', 409);
  const sum = await accountSummary(userId, s.account);
  const pl = (await all("SELECT dollars, entry, exit FROM newspicks_trades WHERE user_id = ? AND day = ? AND status = 'closed'", userId, day)).reduce((a, r) => a + (r.entry ? r.dollars * (r.exit / r.entry - 1) : 0), 0);
  const g = lossGuard(pl, s); if (!g.ok) throw bad(g.why, 409);
  const p = pdtAllowed({ account: s.account, equity: sum.equity, dayTrades: await dayTradesLast5(userId, s.account) }); if (!p.ok) throw bad(p.why, 409);
  const prices = {}; for (const x of picks) prices[x.symbol] = await lastPrice(x.symbol, userId).catch(() => null);
  const a = allocate(picks, s, { cash: sum.cash, prices }), results = [];
  for (const o of a.orders) {
    try { const r = await placeOrder(userId, s.account, { symbol: o.symbol, side: 'buy', notional: o.dollars, expectedPrice: o.price }, source); results.push({ ...o, ok: true, status: r.status });
      await run("INSERT INTO newspicks_trades (user_id, day, account, symbol, dollars, entry, stop, status, at) VALUES (?,?,?,?,?,?,?, 'open', ?)", userId, day, s.account, o.symbol, o.dollars, r.price || o.price, o.stop, now()); }
    catch (e) { results.push({ ...o, ok: false, error: e.message }); }
  }
  await audit(userId, 'newspicks_placed', { account: s.account, orders: results.length }).catch(() => {});
  return { ...a, results };
}
// 9:35 New York: approve mode leaves the proposal waiting; automatic mode places it.
export async function runUsers(t = now()) {
  const n = nyTime(t); if (!isTradingDay(n.day) || n.minutes < 575 || n.minutes > 600) return 0;
  const picks = await todays(n.day); if (!picks.length) return 0;
  const users = await all("SELECT user_id FROM user_settings WHERE k = 'newspicks'"); let done = 0;
  for (const { user_id: uid } of users) {
    const s = cleanSettings((await getSetting(uid, 'newspicks', {})) || {}); if (!s.enabled) continue;
    if (s.mode === 'approve') { if (!(await getSetting(uid, 'newspicks:told', null) === n.day)) { await setSetting(uid, 'newspicks:told', n.day); await notifyUser(uid, `Today's morning news screen is ready for your approval (practice account): ${picks.map(p => p.symbol).join(', ')}. ${NOT_ADVICE}`).catch(() => {}); } continue; }
    try { await placeFor(uid, s, picks); done++; } catch (e) { await notifyUser(uid, `The morning news screen was not placed today: ${e.message}`).catch(() => {}); }
  }
  return done;
}
// Every 5 minutes in the session: stops; 15:50 (or 10 minutes before an early close): close the day's picks.
export async function manage(t = now()) {
  const n = nyTime(t); if (!isTradingDay(n.day) || n.minutes < 575) return 0;
  const open = await all("SELECT * FROM newspicks_trades WHERE day = ? AND status = 'open'", n.day); let closed = 0;
  const closing = n.minutes >= 950;
  for (const tr of open) {
    const px = await lastPrice(tr.symbol, tr.user_id).catch(() => null); if (!px) continue;
    if (!(closing || (tr.stop && px <= tr.stop))) continue;
    try {
      const sum = await accountSummary(tr.user_id, tr.account), pos = sum.positions.find(p => p.symbol === tr.symbol);
      if (pos) await placeOrder(tr.user_id, tr.account, { symbol: tr.symbol, side: 'sell', qty: Math.min(pos.qty, tr.entry ? tr.dollars / tr.entry : pos.qty), expectedPrice: px }, 'newspicks');
      await run("UPDATE newspicks_trades SET status = 'closed', exit = ?, note = ? WHERE id = ?", px, closing ? 'closed before the close' : 'stop loss', tr.id); closed++;
    } catch (e) { await run('UPDATE newspicks_trades SET note = ? WHERE id = ?', 'close failed: ' + e.message, tr.id); }
  }
  // After the close: each logged pick's result from the open (its public record).
  if (n.minutes >= 965) for (const r of await all('SELECT * FROM newspicks_log WHERE day = ? AND ret IS NULL', n.day)) {
    const px = await lastPrice(r.symbol, null).catch(() => null); if (px && r.open) await run('UPDATE newspicks_log SET close = ?, ret = ? WHERE day = ? AND symbol = ?', px, r2((px / r.open - 1) * 100, 2), r.day, r.symbol);
  }
  return closed;
}
export async function tick(t = now()) { await generate(t); await runUsers(t); return manage(t); }

export const newspicksRouter = (() => {
  const r = express.Router(); r.use(requireUser);
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(e.status || 500).json({ error: e.status ? e.message : 'Not available right now.', ...(e.upgrade ? { upgrade: true, feature: e.feature } : {}) }));
  r.get('/', wrap(async (req, res) => {
    const day = nyTime().day, s = cleanSettings((await getSetting(req.user.id, 'newspicks', {})) || {});
    const picks = await todays(day), hist = await all('SELECT * FROM newspicks_log ORDER BY day DESC, rank LIMIT 300');
    const mine = await all('SELECT * FROM newspicks_trades WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user.id);
    res.json({ day, picks, settings: s, record: record(hist), history: hist.slice(0, 40), mine, dataEnabled: D.dataEnabled(), elite: ELITE(req.user), paid: isPaid(req.user), placedToday: mine.some(m => m.day === day), note: NOT_ADVICE });
  }));
  // Saving settings. Turning on a real account needs the Elite plan, the password and the step-up check.
  r.put('/settings', wrap(async (req, res) => {
    if (!isPaid(req.user)) throw Object.assign(bad('The morning news screen is part of the Pro plan'), { status: 402, upgrade: true, feature: 'Morning news screen' });
    if (req.body?.live || (req.body?.account && req.body.account !== 'paper')) throw bad('The morning news screen runs on the practice account only. For real money, open a stock in the order ticket.', 400);
    const prev = (await getSetting(req.user.id, 'newspicks', {})) || {}, s = cleanSettings(req.body || {}, prev);
    await setSetting(req.user.id, 'newspicks', s); await audit(req.user.id, 'newspicks_settings', { enabled: s.enabled, mode: s.mode }, req.ip).catch(() => {});
    res.json({ settings: s });
  }));
  // Approve today's proposal (approve mode): the same guards as automatic.
  r.post('/approve', stepUpGuard, wrap(async (req, res) => {
    if (!isPaid(req.user)) throw Object.assign(bad('The morning news screen is part of the Pro plan'), { status: 402, upgrade: true, feature: 'Morning news screen' });
    const s = cleanSettings((await getSetting(req.user.id, 'newspicks', {})) || {}), picks = await todays(nyTime().day);
    if (!picks.length) throw bad('No picks today yet. They are made at 9:00 New York time on trading days.', 409);
    res.json(await placeFor(req.user.id, s, picks));
  }));
  return r;
})();
