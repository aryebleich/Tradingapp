// Round-the-clock market scanning and intraday bots. A scanner checks a list of symbols on a
// schedule (stocks during the session, crypto at any hour) against rule lines and candlestick
// patterns, then alerts or buys. Intraday bots run the existing rule strategies on hourly or
// 15-minute bars instead of once a day.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import { getBars, accountSummary, placeOrder } from './brokers.js';
import { compile, latestSignal } from './engine.js';
import { snapshot } from './ta.js';
import { detect, PATTERNS } from '../public/patterns.js';
import { nyTime, stockSession, isCryptoSymbol } from './time.js';
import { isPaid } from './fees.js';
import { killed } from './risk.js';
import { notifyUser } from './notify-user.js';
import * as D from './alpaca/data.js';

export const UNIVERSES = {
  dow30: { name: 'Dow 30', symbols: 'AAPL AMGN AMZN AXP BA CAT CRM CSCO CVX DIS GS HD HON IBM JNJ JPM KO MCD MMM MRK MSFT NKE NVDA PG SHW TRV UNH V VZ WMT'.split(' ') },
  mega: { name: 'US mega caps', symbols: 'AAPL MSFT NVDA AMZN GOOGL META AVGO TSLA BRK.B JPM LLY V UNH XOM MA COST HD PG JNJ NFLX ABBV WMT BAC CRM ORCL'.split(' ') },
  nasdaq: { name: 'Nasdaq-100 leaders', symbols: 'NVDA MSFT AAPL AMZN AVGO META NFLX TSLA GOOGL COST PLTR CSCO AMD TMUS LIN INTU ISRG PEP TXN BKNG QCOM ADBE AMGN HON AMAT'.split(' ') },
  etfs: { name: 'Major ETFs', symbols: 'SPY QQQ IWM DIA TLT GLD SLV USO XLE XLF XLK XLV XLY XLI XLP XLU XLB XLRE SMH ARKK'.split(' ') },
  crypto: { name: 'Crypto (24/7)', symbols: 'BTC/USD ETH/USD SOL/USD LTC/USD DOGE/USD AVAX/USD LINK/USD BCH/USD UNI/USD AAVE/USD XRP/USD DOT/USD'.split(' ') },
};
const TF = { '1Day': 1440, '1Hour': 60, '15Min': 15 };
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
export const symbolsOf = u => (UNIVERSES[u] ? UNIVERSES[u].symbols : String(u || '').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)).slice(0, 60);
const since = days => new Date(Date.now() - days * 864e5).toISOString();

// Bars with open/high/low/close when a market-data source is configured; daily closes otherwise.
export async function loadBars(userId, symbols, timeframe = '1Day') {
  const out = {};
  if (D.dataEnabled()) {
    try {
      const days = timeframe === '1Day' ? 400 : timeframe === '1Hour' ? 30 : 8;
      const b = await D.bars(symbols, { timeframe, start: since(days), limit: 10000 });
      for (const [s, rows] of Object.entries(b || {})) if (rows?.length) out[s] = { ohlc: rows.map(r => ({ o: r.o, h: r.h, l: r.l, c: r.c, t: r.t })), closes: rows.map(r => r.c), source: 'alpaca' };
    } catch (e) { console.warn('scanner bars', e.message); }
  }
  if (timeframe !== '1Day') return out; // intraday needs the market-data source
  for (const s of symbols) if (!out[s]) {
    try { const b = await getBars(s, new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10), userId); out[s] = { ohlc: null, closes: b.closes, source: b.source }; } catch {}
  }
  return out;
}

// Every rule line must hold on the latest bar; with patterns, at least one must appear on it.
export function evaluate(series, rules, patterns = []) {
  const c = series.closes; if (!c || c.length < 30) return { match: false, reason: 'not enough data' };
  const fns = rules.trim() ? compile(rules, c) : [], i = c.length - 1;
  const rulesOk = fns.every(f => f(i));
  let found = [];
  if (patterns.length) {
    if (!series.ohlc) return { match: false, reason: 'patterns need open/high/low data' };
    found = detect(series.ohlc, series.ohlc.length - 1).filter(p => p.i === series.ohlc.length - 1 && patterns.includes(p.name)).map(p => p.name);
  }
  return { match: rulesOk && (!patterns.length || found.length > 0), patterns: found };
}

export async function scanOnce(userId, { universe, rules = '', patterns = [], timeframe = '1Day' }) {
  const symbols = symbolsOf(universe);
  if (!symbols.length) throw bad('Pick a universe or type symbols');
  if (!TF[timeframe]) throw bad('Unknown timeframe');
  if (timeframe !== '1Day' && !D.dataEnabled()) throw bad('Intraday scans need a market-data source (ALPACA_KEY_ID / ALPACA_SECRET)');
  const pats = (patterns || []).filter(p => PATTERNS[p]);
  if (rules.trim()) compile(rules, Array.from({ length: 300 }, (_, i) => 100 + (i % 5))); // readable error for a bad rule
  const bars = await loadBars(userId, symbols, timeframe), rows = [];
  for (const s of symbols) {
    const b = bars[s]; if (!b) { rows.push({ symbol: s, match: false, reason: 'no data' }); continue; }
    let e; try { e = evaluate(b, rules, pats); } catch (err) { e = { match: false, reason: err.message }; }
    rows.push({ symbol: s, ...e, ...snapshot(b.closes), dataSource: b.source });
  }
  return rows.sort((a, b) => (b.match - a.match) || ((b.roc1m ?? -1e9) - (a.roc1m ?? -1e9)));
}

// Scheduler: each active scanner runs when its interval has passed. Stock symbols are skipped
// outside the session; a symbol triggers at most once per scanner per day.
export async function runScanners(t = now()) {
  const list = await all('SELECT s.*, u.plan, u.role, u.plan_status FROM scanners s JOIN users u ON u.id = s.user_id WHERE s.active = 1');
  const open = stockSession(t), day = nyTime(t).day;
  let n = 0;
  for (const s of list) {
    if (s.last_run_at && t - s.last_run_at < s.every_min * 60e3 - 15e3) continue;
    const syms = symbolsOf(s.universe).filter(x => open || isCryptoSymbol(x));
    if (!syms.length) continue;
    if (!(await run('UPDATE scanners SET last_run_at = ? WHERE id = ? AND (last_run_at IS NULL OR last_run_at = ?)', t, s.id, s.last_run_at)).changes) continue;
    n++;
    let rows; try { const cfg = JSON.parse(s.patterns || '{}'); rows = await scanOnce(s.user_id, { universe: syms.join(','), rules: s.rules, patterns: cfg.patterns || [], timeframe: cfg.timeframe || '1Day' }); }
    catch (e) { console.warn('scanner', s.id, e.message); continue; }
    for (const r of rows.filter(x => x.match)) {
      if (await one('SELECT 1 FROM scan_hits WHERE scanner_id = ? AND symbol = ? AND day = ?', s.id, r.symbol, day)) continue;
      let result = 'alert';
      if (s.action === 'buy' && s.account && s.notional > 0) {
        if (await killed(s.user_id)) result = 'skipped: kill switch on';
        else if (s.account !== 'paper' && !isPaid(s)) result = 'skipped: real-account scanners need Pro';
        else try {
          const a = await accountSummary(s.user_id, s.account);
          if (a.positions.find(p => p.symbol === r.symbol)) result = 'already held';
          else { await placeOrder(s.user_id, s.account, { symbol: r.symbol, side: 'buy', notional: s.notional, expectedPrice: r.price, signalAt: t }, `scanner:${s.id}`); result = `bought $${s.notional}`; }
        } catch (e) { result = 'order failed: ' + e.message; }
      }
      await run('INSERT INTO scan_hits (scanner_id, user_id, symbol, price, day, result, at) VALUES (?,?,?,?,?,?,?)', s.id, s.user_id, r.symbol, r.price, day, result, t);
      await notifyUser(s.user_id, `Scanner "${s.name}": ${r.symbol} at ${r.price}${r.patterns?.length ? ' (' + r.patterns.map(p => PATTERNS[p]).join(', ') + ')' : ''} - ${result}`);
    }
  }
  return n;
}

// Rule strategies (bots) on hourly / 15-minute bars. Crypto runs around the clock.
export async function runIntradayBots(t = now()) {
  if (!D.dataEnabled()) return 0;
  const bots = await all("SELECT s.*, u.plan, u.role, u.plan_status FROM strategies s JOIN users u ON u.id = s.user_id WHERE s.deployed IS NOT NULL AND s.freq IN ('1Hour', '15Min')");
  let ran = 0;
  for (const b of bots) {
    const every = TF[b.freq] * 60e3;
    if (b.last_run_at && Math.floor(t / every) <= Math.floor(b.last_run_at / every)) continue;
    if (!isCryptoSymbol(b.symbol) && !stockSession(t)) continue;
    if (await killed(b.user_id)) continue;
    if (!(await run('UPDATE strategies SET last_run_at = ? WHERE id = ? AND (last_run_at IS NULL OR last_run_at = ?)', t, b.id, b.last_run_at)).changes) continue;
    ran++;
    let action = 'hold';
    try {
      if (b.deployed !== 'paper' && !isPaid(b)) { await run('UPDATE strategies SET deployed = NULL WHERE id = ?', b.id); throw new Error('stopped: live bots need the Pro plan'); }
      const series = (await loadBars(b.user_id, [b.symbol], b.freq))[b.symbol];
      if (!series) throw new Error('no intraday data');
      const sig = latestSignal(series.closes, b), px = series.closes.at(-1);
      const s = await accountSummary(b.user_id, b.deployed), pos = s.positions.find(p => p.symbol === b.symbol);
      if (pos && sig.exit) { await placeOrder(b.user_id, b.deployed, { symbol: b.symbol, side: 'sell', qty: pos.qty, expectedPrice: px, signalAt: t }, 'bot'); action = 'sold'; }
      else if (!pos && sig.enter) {
        const notional = +(s.cash * Math.min(b.size, 100) / 100 * 0.98).toFixed(2);
        if (notional >= 1) { await placeOrder(b.user_id, b.deployed, { symbol: b.symbol, side: 'buy', notional, expectedPrice: px, signalAt: t }, 'bot'); action = `bought $${notional}`; }
      }
    } catch (e) { action = 'error: ' + e.message; }
    await run('UPDATE strategies SET last_action = ?, last_run = ? WHERE id = ?', action, nyTime(t).day, b.id);
    if (action !== 'hold') await notifyUser(b.user_id, `Bot "${b.name}" ${b.symbol} (${b.freq}): ${action}`);
  }
  return ran;
}

export const scannerRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/meta', (req, res) => res.json({ universes: Object.fromEntries(Object.entries(UNIVERSES).map(([k, v]) => [k, { name: v.name, count: v.symbols.length }])), patterns: PATTERNS, timeframes: Object.keys(TF), intraday: D.dataEnabled() }));
  r.post('/run', async (req, res) => {
    if (!rateLimit('scan:' + req.user.id, 30, 3600e3)) throw bad('Too many scans this hour', 429);
    res.json(await scanOnce(req.user.id, req.body || {}));
  });
  r.get('/', async (req, res) => {
    const list = await all('SELECT * FROM scanners WHERE user_id = ? ORDER BY id DESC', req.user.id);
    const hits = await all('SELECT * FROM scan_hits WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id);
    res.json({ scanners: list.map(s => ({ ...s, config: JSON.parse(s.patterns || '{}') })), hits });
  });
  r.post('/', async (req, res) => {
    const b = req.body || {}, paid = isPaid(req.user);
    const count = (await one('SELECT COUNT(*) n FROM scanners WHERE user_id = ?', req.user.id)).n;
    if (count >= (paid ? 50 : 2)) throw Object.assign(bad(paid ? 'Scanner limit reached' : 'The free plan has 2 scanners'), { status: 402, upgrade: !paid, feature: 'More scanners' });
    const every = Math.max(paid ? 5 : 60, Math.min(1440, +b.everyMin || 60));
    if (b.action === 'buy' && b.account && b.account !== 'paper' && !paid) throw Object.assign(bad('Scanners that buy on real accounts are part of Pro'), { status: 402, upgrade: true, feature: 'Auto-trading scanners' });
    const cfg = { patterns: (b.patterns || []).filter(p => PATTERNS[p]), timeframe: TF[b.timeframe] ? b.timeframe : '1Day' };
    await scanOnce(req.user.id, { universe: b.universe, rules: b.rules || '', patterns: cfg.patterns, timeframe: cfg.timeframe }); // validates
    const id = (await run('INSERT INTO scanners (user_id, name, universe, rules, patterns, every_min, action, account, notional, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      req.user.id, String(b.name || 'My scanner').slice(0, 60), UNIVERSES[b.universe] ? b.universe : symbolsOf(b.universe).join(','), String(b.rules || ''), JSON.stringify(cfg), every,
      b.action === 'buy' ? 'buy' : 'alert', b.account || null, b.action === 'buy' ? Math.max(1, +b.notional || 100) : null, now())).lastInsertRowid;
    await audit(req.user.id, 'scanner_created', { id, every }, req.ip);
    res.json({ id });
  });
  r.patch('/:id', async (req, res) => { await run('UPDATE scanners SET active = ? WHERE id = ? AND user_id = ?', req.body.active ? 1 : 0, +req.params.id, req.user.id); res.json({ ok: true }); });
  r.delete('/:id', async (req, res) => { await run('DELETE FROM scanners WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
})();
