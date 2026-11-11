// AI signals: a quantitative engine that runs every night after the close.
//   1. For each symbol in the universe it runs a dozen trading setups (oversold bounces, breakouts,
//      trend pullbacks, squeezes, momentum and more) over its whole daily history, measuring how
//      each setup did every time it appeared: win rate and average move over its holding period,
//      blended with how the same setup did across all symbols (so a setup seen only a few times on
//      one stock is not over-trusted). With ~70 symbols, 12 setups and ~2,500 days each, that is
//      about two million scenarios a night.
//   2. It keeps the setups that appear on the latest bar, scores them, and sets a stop loss and a
//      profit target from the stock's own recent daily range.
//   3. Before the open the best ones are today's signals. Users who switch on automatic trading
//      (plan permitting) get them placed after the open; during the session stops move up as a
//      trade goes their way (to break-even after 1R, then trailing by 1R after 2R), and a trade
//      closes at its target, its stop, or the end of its holding period.
// Past results describe the past; signals are information, not advice.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, requireAdmin } from './auth.js';
import { aiLimits, upgrade } from './aiplans.js';
import { rsiSeries, smaSeries } from './rotation/indicators.js';
import { emaSeries } from './aibots.js';
import { session, orderDay } from './desk.js';
import { nyTime } from './time.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const UNIVERSE = [...new Set('AAPL MSFT NVDA AMZN GOOGL META AVGO TSLA JPM LLY V UNH XOM MA COST HD PG JNJ NFLX ABBV WMT BAC CRM ORCL AMD ADBE QCOM TXN INTU AMAT CSCO PEP KO MCD DIS NKE CAT BA GS IBM HON AMGN MRK CVX TMUS ISRG BKNG PLTR SPY QQQ IWM DIA XLE XLF XLK XLV XLY XLI XLP XLU SMH GLD TLT'.split(' '))];

// ---------- the setups (daily closes) ----------
function std(c, i, n) { let m = 0; for (let j = i - n + 1; j <= i; j++) m += c[j]; m /= n; let v = 0; for (let j = i - n + 1; j <= i; j++) v += (c[j] - m) ** 2; return Math.sqrt(v / n); }
export function features(c) {
  const ema12 = emaSeries(c, 12), ema26 = emaSeries(c, 26), macd = c.map((_, i) => (ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null));
  const sig = emaSeries(macd.map(x => x ?? 0), 9);
  return { rsi2: rsiSeries(c, 2), rsi14: rsiSeries(c, 14), sma20: smaSeries(c, 20), sma50: smaSeries(c, 50), sma200: smaSeries(c, 200), ema50: emaSeries(c, 50), macd, sig };
}
export const SETUPS = {
  rsi2_oversold: { name: 'Short-term oversold in an uptrend', horizon: 5, test: (c, f, i) => f.rsi2[i] < 10 && c[i] > f.sma200[i] },
  breakout20: { name: '20-day breakout', horizon: 10, test: (c, f, i) => { let m = -Infinity; for (let j = i - 20; j < i; j++) m = Math.max(m, c[j]); return c[i] > m && c[i - 1] <= m; } },
  trend_pullback: { name: 'Pullback in a strong trend', horizon: 10, test: (c, f, i) => f.sma50[i] > f.sma200[i] && c[i] < f.sma20[i] && c[i] > f.sma50[i] && c[i - 1] >= f.sma20[i - 1] },
  squeeze_break: { name: 'Volatility squeeze breakout', horizon: 10, test: (c, f, i) => { if (i < 140) return false; const w = std(c, i - 1, 20) / f.sma20[i - 1]; let lo = Infinity; for (let j = i - 120; j < i - 1; j += 5) lo = Math.min(lo, std(c, j, 20) / f.sma20[j]); return w <= lo * 1.05 && c[i] > f.sma20[i] + 2 * std(c, i, 20); } },
  macd_cross: { name: 'MACD bullish cross above the 50-day', horizon: 10, test: (c, f, i) => f.macd[i - 1] <= f.sig[i - 1] && f.macd[i] > f.sig[i] && c[i] > f.sma50[i] },
  three_down: { name: 'Three down days in an uptrend', horizon: 5, test: (c, f, i) => c[i] < c[i - 1] && c[i - 1] < c[i - 2] && c[i - 2] < c[i - 3] && c[i] > f.sma200[i] },
  high52: { name: 'New 52-week high', horizon: 20, test: (c, f, i) => { let m = -Infinity; for (let j = i - 252; j < i; j++) m = Math.max(m, c[j]); return c[i] > m; } },
  zscore_dip: { name: 'Stretched 2 deviations below the 20-day', horizon: 5, test: (c, f, i) => (c[i] - f.sma20[i]) / (std(c, i, 20) || 1) < -2 },
  rsi14_turn: { name: 'RSI turns up from oversold', horizon: 10, test: (c, f, i) => f.rsi14[i - 1] < 30 && f.rsi14[i] >= 30 },
  momentum: { name: '12-month momentum leader', horizon: 20, test: (c, f, i) => c[i - 21] / c[i - 252] - 1 > 0.2 && c[i] > f.sma50[i] && c[i - 1] <= f.sma50[i - 1] * 1.01 && c[i] > c[i - 1] },
  ema_pullback: { name: 'Dip to a rising 50-day EMA', horizon: 10, test: (c, f, i) => f.ema50[i] > f.ema50[i - 10] && c[i] <= f.ema50[i] * 1.01 && c[i] >= f.ema50[i] * 0.98 && f.rsi14[i] < 45 },
  gap_hold: { name: 'Big up day that holds', horizon: 5, test: (c, f, i) => c[i - 1] / c[i - 2] - 1 > 0.03 && c[i] >= c[i - 1] * 0.995 && c[i] > f.sma50[i] },
};
const WARM = 260;

// Every past appearance of each setup on one symbol: forward return over its holding period.
export function history(c) {
  const f = features(c), out = {};
  for (const [k, s] of Object.entries(SETUPS)) {
    const r = [];
    for (let i = WARM; i < c.length - s.horizon; i++) { try { if (s.test(c, f, i)) r.push(c[i + s.horizon] / c[i] - 1); } catch {} }
    let today = false; try { today = c.length > WARM && !!s.test(c, f, c.length - 1); } catch {}
    out[k] = { returns: r, today, tested: Math.max(0, c.length - s.horizon - WARM) };
  }
  return out;
}
// Average daily range, from closes (the move from one close to the next).
export const dailyRange = (c, n = 14) => { let a = 0; for (let i = c.length - n; i < c.length; i++) a += Math.abs(c[i] - c[i - 1]); return a / n; };
export function score(own, pooled, K = 20) {
  const w = own.length, wins = own.filter(r => r > 0).length, avg = w ? own.reduce((a, r) => a + r, 0) / w : 0;
  const pw = pooled.winRate, pa = pooled.avg;
  const winRate = (wins + K * pw) / (w + K), avgRet = (avg * w + pa * K) / (w + K);
  return { winRate, avgRet, samples: w, score: +((winRate - 0.5) * 100 + avgRet * 400).toFixed(3) };
}
export function signalsFrom(series, { day, max = 100 } = {}) {
  const hist = {}, pool = {};
  for (const [s, c] of Object.entries(series)) { if (c?.length > WARM + 30) hist[s] = history(c); }
  let scenarios = 0;
  for (const k of Object.keys(SETUPS)) {
    const all2 = Object.values(hist).flatMap(h => h[k].returns);
    pool[k] = { winRate: all2.length ? all2.filter(r => r > 0).length / all2.length : 0.5, avg: all2.length ? all2.reduce((a, r) => a + r, 0) / all2.length : 0 };
    scenarios += Object.values(hist).reduce((a, h) => a + h[k].tested, 0);
  }
  const out = [];
  for (const [s, h] of Object.entries(hist)) for (const [k, x] of Object.entries(h)) {
    if (!x.today) continue;
    const sc = score(x.returns, pool[k]); if (sc.winRate < 0.5 || sc.avgRet <= 0) continue;
    const c = series[s], entry = c.at(-1), atr = dailyRange(c) || entry * 0.01, H = SETUPS[k].horizon;
    const stop = entry - 2 * atr * Math.sqrt(H / 5), target = entry + 3 * atr * Math.sqrt(H / 5);
    out.push({ day, symbol: s, setup: k, side: 'buy', entry: +entry.toFixed(2), stop: +stop.toFixed(2), target: +target.toFixed(2), win_rate: +(sc.winRate * 100).toFixed(1), avg_return: +(sc.avgRet * 100).toFixed(2), samples: sc.samples, score: sc.score, horizon: H });
  }
  out.sort((a, b) => b.score - a.score);
  // One signal per symbol (its best setup).
  const seen = new Set(), best = out.filter(x => !seen.has(x.symbol) && seen.add(x.symbol));
  return { signals: best.slice(0, max), scenarios, symbols: Object.keys(hist).length };
}

async function closesFor(symbols, userId = null) {
  const { getBars } = await import('./brokers.js'), start = new Date(Date.now() - 11 * 365 * 864e5).toISOString().slice(0, 10), out = {};
  for (const s of symbols) { try { out[s] = (await getBars(s, start, userId)).closes; } catch {} }
  return out;
}

// After the close (and before the open, if it did not run): the signals for the next session.
export async function runSignals(t = now(), { force = false } = {}) {
  if (session(t).open && !force) return 0;
  const day = orderDay(t);
  if (await one('SELECT 1 FROM ai_signals WHERE day = ? LIMIT 1', day)) return 0;
  const { signals, scenarios, symbols } = signalsFrom(await closesFor(UNIVERSE), { day });
  for (const x of signals) await run('INSERT OR IGNORE INTO ai_signals (day, symbol, setup, side, entry, stop, target, win_rate, avg_return, samples, score, horizon, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', x.day, x.symbol, x.setup, x.side, x.entry, x.stop, x.target, x.win_rate, x.avg_return, x.samples, x.score, x.horizon, now());
  const { siteSet } = await import('./site.js'); await siteSet('aiSignalsRun', { day, scenarios, symbols, count: signals.length, at: now() });
  return signals.length;
}

const latestDay = async () => (await one('SELECT MAX(day) d FROM ai_signals'))?.d || null;
export async function signalsFor(u) {
  const lim = aiLimits(u), day = await latestDay();
  const rows = day ? await all('SELECT * FROM ai_signals WHERE day = ? ORDER BY score DESC', day) : [];
  return { day, total: rows.length, shown: Math.min(rows.length, lim.signals), signals: rows.slice(0, lim.signals).map(r => ({ ...r, setupName: SETUPS[r.setup]?.name || r.setup })) };
}

// ---------- automatic trading from signals ----------
export const AUTO_DEFAULTS = { enabled: false, account: 'paper', perTradeUsd: 1000, maxOpen: 5, minWinRate: 55 };
export async function autoSettings(userId) {
  const r = await one('SELECT json FROM signal_auto WHERE user_id = ?', userId);
  let v = {}; try { v = r ? JSON.parse(r.json) : {}; } catch {}
  return { ...AUTO_DEFAULTS, ...v };
}
const addDays = (iso, n) => { let d = iso; for (let k = 0; k < n;) { d = new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10); const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd && wd !== 6) k++; } return d; };

// During the session: new trades after the first five minutes, then stops, targets and time exits.
export async function runSignalTrades(t = now(), deps) {
  if (!session(t).open) return 0;
  deps ||= await import('./brokers.js');
  const mins = nyTime(t).minutes, day = nyTime(t).day;
  let n = 0;
  // Manage open trades.
  for (const tr of await all("SELECT * FROM signal_trades WHERE status = 'open'")) {
    const p = await deps.lastPrice(tr.symbol, tr.user_id).catch(() => null); if (!p) continue;
    const R = tr.risk, why = p >= tr.target ? 'target' : p <= tr.stop ? 'stop' : tr.expires_day && day >= tr.expires_day && mins >= 945 ? 'time' : null;
    if (why) {
      const claim = await run("UPDATE signal_trades SET status = 'closing' WHERE id = ? AND status = 'open'", tr.id); if (!claim.changes) continue;
      try { await deps.placeOrder(tr.user_id, tr.account, { symbol: tr.symbol, side: 'sell', qty: tr.qty }, 'aisignal'); await run("UPDATE signal_trades SET status = 'closed', exit_price = ?, note = ?, closed_at = ? WHERE id = ?", p, why, now(), tr.id); n++; }
      catch (e) { await run("UPDATE signal_trades SET status = 'open', note = ? WHERE id = ?", 'sell failed: ' + e.message.slice(0, 150), tr.id); }
      continue;
    }
    // Dynamic stop: break-even after 1R, then trail 1R behind the price after 2R.
    let stop = tr.stop;
    if (p >= tr.entry + 2 * R) stop = Math.max(stop, p - R); else if (p >= tr.entry + R) stop = Math.max(stop, tr.entry);
    if (stop > tr.stop) await run('UPDATE signal_trades SET stop = ?, note = ? WHERE id = ?', +stop.toFixed(2), stop >= tr.entry ? 'stop raised' : null, tr.id);
  }
  // New trades, from 9:35 New York time.
  if (mins < 575) return n;
  const sig = await all('SELECT * FROM ai_signals WHERE day = ? ORDER BY score DESC', day);
  if (!sig.length) return n;
  for (const row of await all('SELECT * FROM signal_auto')) {
    let cfg; try { cfg = { ...AUTO_DEFAULTS, ...JSON.parse(row.json) }; } catch { continue; }
    if (!cfg.enabled) continue;
    const u = await one('SELECT * FROM users WHERE id = ?', row.user_id); if (!u) continue;
    const lim = aiLimits(u);
    if (lim.signalAuto === 'off' || (lim.signalAuto === 'paper' && cfg.account !== 'paper')) continue;
    const open = (await one("SELECT COUNT(*) n FROM signal_trades WHERE user_id = ? AND status IN ('open', 'closing')", u.id)).n;
    let room = Math.max(0, cfg.maxOpen - open);
    for (const s of sig.slice(0, lim.signals)) {
      if (!room) break;
      if (s.win_rate < cfg.minWinRate) continue;
      if (await one('SELECT 1 FROM signal_trades WHERE user_id = ? AND signal_id = ?', u.id, s.id)) continue;
      if (await one("SELECT 1 FROM signal_trades WHERE user_id = ? AND symbol = ? AND status = 'open'", u.id, s.symbol)) continue;
      const p = await deps.lastPrice(s.symbol, u.id).catch(() => null); if (!p) continue;
      // Skip when the price already ran far from the signal's entry (more than half the way to target).
      if (p > s.entry + (s.target - s.entry) / 2 || p <= s.stop) continue;
      const qty = Math.floor(cfg.perTradeUsd / p); if (qty < 1) continue;
      const risk = s.entry - s.stop;
      const id = Number((await run("INSERT INTO signal_trades (user_id, signal_id, account, symbol, qty, entry, stop, target, risk, status, opened_at, expires_day) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", u.id, s.id, cfg.account, s.symbol, qty, p, +(p - risk).toFixed(2), +(p + (s.target - s.entry)).toFixed(2), risk, 'opening', now(), addDays(day, s.horizon))).lastInsertRowid);
      try { await deps.placeOrder(u.id, cfg.account, { symbol: s.symbol, side: 'buy', qty }, 'aisignal'); await run("UPDATE signal_trades SET status = 'open' WHERE id = ?", id); room--; n++; }
      catch (e) { await run("UPDATE signal_trades SET status = 'failed', note = ? WHERE id = ?", e.message.slice(0, 200), id); }
    }
  }
  return n;
}

export const aiSignalsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const lim = aiLimits(req.user), { siteGet } = await import('./site.js');
    res.json({ ...(await signalsFor(req.user)), limits: lim, auto: await autoSettings(req.user.id), lastRun: siteGet('aiSignalsRun', null), setups: Object.fromEntries(Object.entries(SETUPS).map(([k, s]) => [k, { name: s.name, horizon: s.horizon }])),
      trades: await all('SELECT * FROM signal_trades WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id) });
  });
  r.put('/auto', async (req, res) => {
    const lim = aiLimits(req.user), b = req.body || {}, cur = await autoSettings(req.user.id);
    const next = { ...cur, enabled: !!b.enabled, account: String(b.account || cur.account), perTradeUsd: Math.max(10, Math.min(1e6, +b.perTradeUsd || cur.perTradeUsd)), maxOpen: Math.max(1, Math.min(50, Math.round(+b.maxOpen || cur.maxOpen))), minWinRate: Math.max(50, Math.min(90, +b.minWinRate || cur.minWinRate)) };
    if (next.enabled && lim.signalAuto === 'off') throw upgrade('Automatic trades from AI signals', p => p.signalAuto !== 'off');
    if (next.enabled && next.account !== 'paper' && lim.signalAuto !== 'live') throw upgrade('Automatic AI-signal trades on real accounts', p => p.signalAuto === 'live');
    await run('INSERT INTO signal_auto (user_id, json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json', req.user.id, JSON.stringify(next));
    await audit(req.user.id, 'signal_auto', { enabled: next.enabled, account: next.account }, req.ip);
    res.json(next);
  });
  // Custom signal engine (Elite and up): the same setups on the user's own list of symbols, now.
  r.post('/custom', async (req, res) => {
    if (!aiLimits(req.user).customSignals) throw upgrade('Custom AI signal engines', p => p.customSignals);
    const syms = [...new Set(String(req.body?.symbols || '').toUpperCase().split(/[\s,]+/).filter(s => /^[A-Z][A-Z0-9.]{0,9}$/.test(s)))].slice(0, 30);
    if (!syms.length) throw bad('Give up to 30 symbols');
    const setups = Array.isArray(req.body?.setups) && req.body.setups.length ? req.body.setups.filter(k => SETUPS[k]) : Object.keys(SETUPS);
    const series = await closesFor(syms, req.user.id), { signals, scenarios } = signalsFrom(series, { day: nyTime().day });
    res.json({ scenarios, symbols: Object.keys(series).length, signals: signals.filter(s => setups.includes(s.setup)).map(s => ({ ...s, setupName: SETUPS[s.setup].name })) });
  });
  r.post('/run', requireAdmin, async (req, res) => { await run('DELETE FROM ai_signals WHERE day = ?', orderDay()); res.json({ count: await runSignals(Date.now(), { force: true }) }); });
  return r;
})();
