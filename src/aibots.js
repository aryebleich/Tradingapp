// AI bots: automated strategies without code, on any connected account.
//   - DCA: buy a set dollar amount on a schedule, with optional extra buys on dips;
//   - Grid: buy each step down and sell each step up between a low and a high price;
//   - Scalping: buy a quick drop below the recent average, sell at a small profit or stop;
//   - Plain English: the user writes the rules ("Buy when 14-day RSI crosses below 30 and volume
//     spikes, sell when RSI goes above 70, stop loss 5%"), the AI (or the built-in parser) turns
//     them into rules, they are backtested on years of daily prices, then run as a bot.
// The plan sets how many bots run at once, how often they check and whether they may use real
// accounts (src/aiplans.js). Every order goes through placeOrder, so risk controls always apply.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { aiLimits, upgrade, useQuota } from './aiplans.js';
import { rsiSeries, smaSeries } from './rotation/indicators.js';
import { session } from './desk.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const KINDS = { dca: 'Dollar-cost averaging', grid: 'Grid', scalp: 'Scalping', rule: 'Plain-English rules' };
const sym = s => { const x = String(s || '').trim().toUpperCase().replace(/^([A-Z]{2,6})(USD)$/, '$1/$2'); if (!/^[A-Z][A-Z0-9.\/-]{0,14}$/.test(x)) throw bad('Give a valid symbol'); return x; };
const n = (v, lo, hi, name) => { const x = +v; if (!Number.isFinite(x) || x < lo || x > hi) throw bad(`${name} must be between ${lo} and ${hi}`); return x; };

// ---------- indicators on closes ----------
export function emaSeries(c, p) { const k = 2 / (p + 1), out = []; let e = null; c.forEach((v, i) => { e = e == null ? v : v * k + e * (1 - k); out[i] = i >= p - 1 ? e : null; }); return out; }
const IND = {
  rsi: (c, p) => rsiSeries(c, p), sma: (c, p) => smaSeries(c, p), ema: (c, p) => emaSeries(c, p), price: c => c,
  // Daily change in percent over p days.
  change: (c, p) => c.map((v, i) => (i >= p ? (v / c[i - p] - 1) * 100 : null)),
};
// "Volume spike": volume above mult times its 20-day average. Without volume data the bot uses an
// unusual move instead (the day's move above mult times its 20-day average move), and says so.
function spike(c, vol, mult, p = 20) {
  const s = vol?.length === c.length ? vol : c.map((v, i) => (i ? Math.abs(v / c[i - 1] - 1) : 0));
  return s.map((v, i) => { if (i < p) return false; let a = 0; for (let j = i - p; j < i; j++) a += s[j]; return v > mult * (a / p); });
}
const val = (cond, c, cache) => {
  const key = cond.ind + ':' + (cond.period || 0);
  return (cache[key] ||= IND[cond.ind](c, cond.period || 14));
};
// One condition at bar i: true or false.
export function holds(cond, c, i, cache, vol) {
  if (cond.ind === 'volume') return (cache['vol:' + cond.mult] ||= spike(c, vol, cond.mult || 2))[i];
  const a = val(cond, c, cache), b = cond.ref ? val(cond.ref, c, cache) : null;
  const x = a[i], y = b ? b[i] : cond.value, xp = a[i - 1], yp = b ? b[i - 1] : cond.value;
  if (x == null || y == null) return false;
  switch (cond.op) {
    case 'above': return x > y;
    case 'below': return x < y;
    case 'crosses_above': return xp != null && yp != null && xp <= yp && x > y;
    case 'crosses_below': return xp != null && yp != null && xp >= yp && x < y;
    default: return false;
  }
}

// ---------- plain English → rules ----------
const STOP = new Set(['RSI', 'SMA', 'EMA', 'MA', 'MACD', 'AND', 'OR', 'THE', 'BUY', 'SELL', 'WHEN', 'IF', 'DAY', 'DAYS', 'USD', 'ETF', 'AI', 'A', 'I', 'TP', 'SL', 'US', 'OF', 'ON', 'AT', 'IN', 'TO', 'UP']);
const NAMES = { rsi: 'RSI', sma: 'SMA', ema: 'EMA', price: 'Price', change: 'Change %' };
export function describe(c) {
  if (c.ind === 'volume') return `volume spikes above ${c.mult}× its 20-day average`;
  if (c.ind === 'change') return `the ${c.period}-day move is ${c.op === 'below' ? 'below' : 'above'} ${c.value}%`;
  const side = `${NAMES[c.ind]}${c.ind === 'price' ? '' : `(${c.period})`}`;
  const op = { above: 'is above', below: 'is below', crosses_above: 'crosses above', crosses_below: 'crosses below' }[c.op];
  return `${c.ind === 'price' ? 'the price' : side} ${op} ${c.ref ? `${c.ind === 'price' ? 'its ' : ''}${c.ref.period}-day ${NAMES[c.ref.ind]}` : c.value}`;
}
const OPS = [[/crosses?\s+(?:back\s+)?(?:below|under)|falls?\s+(?:below|under)|drops?\s+(?:below|under)|dips?\s+(?:below|under)|goes\s+(?:below|under)/, 'crosses_below'],
  [/crosses?\s+(?:back\s+)?(?:above|over)|rises?\s+(?:above|over)|goes\s+(?:above|over)|breaks?\s+(?:above|over)|climbs?\s+(?:above|over)/, 'crosses_above'],
  [/is\s+below|stays?\s+below|below|under|less than|</, 'below'], [/is\s+above|stays?\s+above|above|over|greater than|more than|>/, 'above']];
const opOf = t => OPS.find(([re]) => re.test(t))?.[1];
function conditions(text) {
  const out = [], t = text.toLowerCase();
  // RSI: "14-day RSI crosses below 30", "RSI(2) < 10", "RSI below 30"
  for (const m of t.matchAll(/(?:(\d+)[- ]?(?:day|period|bar)?\s*)?rsi(?:\s*\(\s*(\d+)\s*\))?\s*(?:\(\d+\))?\s*([a-z<> ]{1,30}?)\s*(\d+(?:\.\d+)?)/g)) {
    const op = opOf(m[3]); if (op) out.push({ ind: 'rsi', period: +(m[2] || m[1]) || null, op, value: +m[4] });
  }
  // Moving-average crosses: "50-day crosses above the 200-day", "golden cross", "death cross"
  if (/golden cross/.test(t)) out.push({ ind: 'sma', period: 50, op: 'crosses_above', ref: { ind: 'sma', period: 200 } });
  if (/death cross/.test(t)) out.push({ ind: 'sma', period: 50, op: 'crosses_below', ref: { ind: 'sma', period: 200 } });
  for (const m of t.matchAll(/(\d+)[- ]?day\s*(sma|ema|moving average|ma)?\s*(crosses?\s+(?:above|below|over|under))\s*(?:the\s*)?(\d+)[- ]?day/g)) {
    const kind = m[2] === 'ema' ? 'ema' : 'sma'; out.push({ ind: kind, period: +m[1], op: opOf(m[3]), ref: { ind: kind, period: +m[4] } });
  }
  // Price against an average: "price crosses above the 50-day SMA", "close is below its 20-day EMA"
  for (const m of t.matchAll(/(?:price|close|it|stock)\s*(crosses?\s+(?:above|below|over|under)|(?:is\s+|stays?\s+)?(?:above|below|over|under)|breaks?\s+(?:above|over)|falls?\s+below|drops?\s+below)\s*(?:the\s*|its\s*)?(\d+)[- ]?day\s*(sma|ema|moving average|ma|average)/g)) {
    const kind = m[3] === 'ema' ? 'ema' : 'sma'; out.push({ ind: 'price', op: opOf(m[1]), ref: { ind: kind, period: +m[2] } });
  }
  // Moves: "drops 3% in a day", "falls 5% in 3 days", "up 4%"
  for (const m of t.matchAll(/(drops?|falls?|down|declines?|gains?|rises?|up|jumps?)\s*(?:by\s*)?(\d+(?:\.\d+)?)\s*%(?:\s*in\s*(?:a|one|(\d+))\s*days?)?/g)) {
    if (/stop|profit|target/.test(t.slice(Math.max(0, m.index - 14), m.index))) continue;
    const down = /drop|fall|down|declin/.test(m[1]);
    out.push({ ind: 'change', period: +(m[3] || 1), op: down ? 'below' : 'above', value: down ? -m[2] : +m[2] });
  }
  // Volume: "institutional volume spikes", "volume surges 3x", "volume is twice the average"
  const v = /(?:institutional\s+)?volume\s*(?:spikes?|surges?|jumps?|explodes?|is\s+(?:high|heavy|unusual)|(?:is\s+)?(?:at\s+least\s+)?(\d+(?:\.\d+)?)\s*x|(?:is\s+)?(twice|double|triple))/.exec(t);
  if (v) { const mult = v[1] ? +v[1] : v[2] === 'triple' ? 3 : 2; const m2 = /volume[^.]{0,30}?(\d+(?:\.\d+)?)\s*x/.exec(t); out.push({ ind: 'volume', mult: m2 ? +m2[1] : mult }); }
  return out.filter(c => c.op || c.ind === 'volume');
}
export function parseRules(text) {
  const raw = String(text || '').slice(0, 1000), t = raw.toLowerCase();
  if (!raw.trim()) throw bad('Write the strategy in a sentence or two');
  // Split into the buy part and the sell part.
  const sellAt = t.search(/\b(sell|exit|close|take profit)\b/), buyPart = sellAt > 0 ? raw.slice(0, sellAt) : raw, sellPart = sellAt > 0 ? raw.slice(sellAt) : '';
  const entry = conditions(buyPart), exit = conditions(sellPart).filter(c => c.ind !== 'volume');
  // "RSI" without a period means the one named before it (14 when none was).
  let rsiP = 14; for (const c of [...entry, ...exit]) if (c.ind === 'rsi') { if (c.period) rsiP = c.period; else c.period = rsiP; }
  const pct = re => { const m = re.exec(t); return m ? +m[1] : null; };
  const stopPct = pct(/stop(?:[- ]loss)?\s*(?:at|of|is)?\s*(\d+(?:\.\d+)?)\s*%/) ?? pct(/(\d+(?:\.\d+)?)\s*%\s*stop/);
  const targetPct = pct(/(?:take[- ]profit|profit target|target)\s*(?:at|of|is)?\s*(\d+(?:\.\d+)?)\s*%/) ?? pct(/(\d+(?:\.\d+)?)\s*%\s*(?:profit|gain|target)/);
  const holdDays = pct(/(?:hold|exit after|sell after|for)\s*(?:at most\s*)?(\d+)\s*(?:trading\s*)?days?/);
  const usdM = /\$\s*([\d,]+(?:\.\d+)?)/.exec(raw), usd = usdM ? +usdM[1].replace(/,/g, '') : null;
  const shares = pct(/(\d+(?:\.\d+)?)\s*shares?/);
  const tickers = [...raw.matchAll(/\b([A-Z]{1,5}(?:\/USD)?)\b/g)].map(m => m[1]).filter(x => !STOP.has(x));
  const warnings = [];
  if (!entry.length) throw bad('No buy rule found. Try for example: "Buy when 14-day RSI crosses below 30, sell when RSI is above 70, stop loss 5%".');
  if (entry.some(c => c.ind === 'volume')) warnings.push('Volume needs a market-data source with volume; without one, an unusual price move is used instead.');
  if (!exit.length && !stopPct && !targetPct && !holdDays) warnings.push('No sell rule: a 10-day hold was added. Add one, for example "sell when RSI is above 70" or "take profit 8%".');
  return {
    symbol: tickers[0] || 'SPY', entry, exit, stopPct, targetPct, holdDays: holdDays || (!exit.length && !stopPct && !targetPct ? 10 : null),
    amount: shares ? { qty: shares } : { notional: usd || 1000 }, warnings,
    summary: `Buy when ${entry.map(describe).join(' and ')}${exit.length ? `; sell when ${exit.map(describe).join(' or ')}` : ''}${stopPct ? `; stop loss ${stopPct}%` : ''}${targetPct ? `; take profit ${targetPct}%` : ''}${holdDays ? `; sell after ${holdDays} days` : ''}.`,
  };
}
// The AI reads the sentence when a model is set up (it understands more ways of saying things);
// its answer is checked like any other rule. Without a model, or if its answer does not fit, the
// built-in reader above is used.
export async function parseWithAi(text) {
  const base = parseRules(text);
  const { llmEnabled, jsonCall } = await import('./llm.js');
  if (!llmEnabled()) return { ...base, by: 'rules' };
  try {
    const cond = { type: 'object', properties: { ind: { type: 'string', enum: ['rsi', 'sma', 'ema', 'price', 'change', 'volume'] }, period: { type: 'number' }, op: { type: 'string', enum: ['above', 'below', 'crosses_above', 'crosses_below'] }, value: { type: 'number' }, mult: { type: 'number' }, ref: { type: 'object', properties: { ind: { type: 'string', enum: ['sma', 'ema', 'rsi'] }, period: { type: 'number' } } } }, required: ['ind'] };
    const out = await jsonCall({ system: 'Convert a trading idea into rules. Indicators on daily bars: rsi(period), sma(period), ema(period), price, change (percent over period days), volume (spike above mult times the 20-day average). Use only what the user wrote.', user: String(text).slice(0, 1000), schema: { type: 'object', properties: { symbol: { type: 'string' }, entry: { type: 'array', items: cond }, exit: { type: 'array', items: cond }, stopPct: { type: ['number', 'null'] }, targetPct: { type: ['number', 'null'] }, holdDays: { type: ['number', 'null'] } }, required: ['entry'] }, maxTokens: 800 });
    const ok = c => c && IND[c.ind] || c?.ind === 'volume';
    if (!Array.isArray(out?.entry) || !out.entry.length || !out.entry.every(ok) || !(out.exit || []).every(ok)) return { ...base, by: 'rules' };
    const fix = c => ({ ...c, period: c.period ? Math.max(1, Math.min(400, Math.round(c.period))) : undefined, mult: c.ind === 'volume' ? Math.max(1.1, Math.min(10, +c.mult || 2)) : undefined });
    const merged = { ...base, symbol: /^[A-Z][A-Z0-9.\/]{0,9}$/.test(out.symbol || '') ? out.symbol : base.symbol, entry: out.entry.map(fix), exit: (out.exit || []).map(fix), stopPct: out.stopPct ?? base.stopPct, targetPct: out.targetPct ?? base.targetPct, holdDays: out.holdDays ?? base.holdDays };
    merged.summary = `Buy when ${merged.entry.map(describe).join(' and ')}${merged.exit.length ? `; sell when ${merged.exit.map(describe).join(' or ')}` : ''}${merged.stopPct ? `; stop loss ${merged.stopPct}%` : ''}${merged.targetPct ? `; take profit ${merged.targetPct}%` : ''}${merged.holdDays ? `; sell after ${merged.holdDays} days` : ''}.`;
    return { ...merged, by: 'ai' };
  } catch { return { ...base, by: 'rules' }; }
}

// ---------- backtests on daily closes ----------
const stats = (equity, trades, closes, from) => {
  let peak = equity[0], dd = 0; for (const e of equity) { peak = Math.max(peak, e); dd = Math.min(dd, e / peak - 1); }
  const wins = trades.filter(x => x.ret > 0).length;
  return { totalReturn: +((equity.at(-1) / equity[0] - 1) * 100).toFixed(2), buyHold: +((closes.at(-1) / closes[from] - 1) * 100).toFixed(2), maxDrawdown: +(dd * 100).toFixed(2), trades: trades.length, winRate: trades.length ? +(wins / trades.length * 100).toFixed(1) : null, avgTrade: trades.length ? +(trades.reduce((a, x) => a + x.ret, 0) / trades.length * 100).toFixed(2) : null };
};
const sample = (arr, k = 120) => arr.filter((_, i) => i % Math.max(1, Math.ceil(arr.length / k)) === 0 || i === arr.length - 1);
export function backtestRule(rule, c, dates, vol) {
  const warm = Math.max(30, ...[...rule.entry, ...rule.exit].map(x => (x.ind === 'rsi' ? (x.period || 14) * 4 : x.period || 0) + 2), ...[...rule.entry, ...rule.exit].map(x => (x.ref?.period || 0) + 2));
  if (c.length < warm + 30) throw bad('Not enough price history for these rules');
  const cache = {}, trades = [], equity = [1]; let pos = null, cash = 1;
  for (let i = warm; i < c.length; i++) {
    if (pos) {
      const r = c[i] / pos.price - 1, held = i - pos.i;
      const exit = rule.exit.length && rule.exit.some(x => holds(x, c, i, cache, vol));
      if (exit || (rule.stopPct && r <= -rule.stopPct / 100) || (rule.targetPct && r >= rule.targetPct / 100) || (rule.holdDays && held >= rule.holdDays) || i === c.length - 1) {
        cash *= 1 + r; trades.push({ in: dates?.[pos.i], out: dates?.[i], ret: r, days: held }); pos = null;
      }
    } else if (i < c.length - 1 && rule.entry.every(x => holds(x, c, i, cache, vol))) pos = { i, price: c[i] };
    equity.push(pos ? cash * c[i] / pos.price : cash);
  }
  return { ...stats(equity, trades, c, warm), curve: sample(equity.map(e => +(e * 100).toFixed(2))), recent: trades.slice(-10).map(x => ({ ...x, ret: +(x.ret * 100).toFixed(2) })) };
}
export function backtestDca(cfg, c) {
  const every = Math.max(1, Math.round(cfg.everyDays || 7)); let units = 0, spent = 0, last = -Infinity, lastDip = -Infinity, buys = 0; const curve = [];
  for (let i = 0; i < c.length; i++) {
    const avg = units ? spent / units : null;
    let usd = 0;
    if (i - last >= every) { usd = cfg.amountUsd; last = i; }
    else if (cfg.dipPct && avg && c[i] <= avg * (1 - cfg.dipPct / 100) && i - lastDip >= 3) { usd = cfg.dipExtraUsd || cfg.amountUsd; lastDip = i; }
    if (usd) { units += usd / c[i]; spent += usd; buys++; }
    curve.push(spent ? units * c[i] / spent * 100 : 100);
  }
  return { invested: +spent.toFixed(2), value: +(units * c.at(-1)).toFixed(2), totalReturn: +((units * c.at(-1) / spent - 1) * 100).toFixed(2), avgCost: +(spent / units).toFixed(2), buys, curve: sample(curve.map(x => +x.toFixed(2))) };
}
export function gridLevels(cfg) { const step = (cfg.upper - cfg.lower) / (cfg.levels - 1); return Array.from({ length: cfg.levels }, (_, i) => +(cfg.lower + i * step).toFixed(4)); }
export const levelOf = (cfg, p) => Math.max(-1, Math.min(cfg.levels, Math.floor((p - cfg.lower) / ((cfg.upper - cfg.lower) / (cfg.levels - 1)))));
// One grid step at price p. Each level bought is sold one level higher; a level is bought again
// only after its lot was sold. st: { level (last level index), open: [levels holding a lot] }.
export function gridStep(cfg, st, p) {
  const grid = gridLevels(cfg), k = levelOf(cfg, p), out = { buy: [], sell: [] };
  st.open ||= [];
  for (const L of [...st.open]) if (L + 1 < cfg.levels && p >= grid[L + 1]) { out.sell.push(L); st.open = st.open.filter(x => x !== L); }
  // Falling from level s to level k crosses the level prices s, s-1, ... k+1: one lot at each.
  if (st.level != null && k < st.level) for (let L = Math.min(st.level, cfg.levels - 2); L >= Math.max(k + 1, 0); L--) if (!st.open.includes(L)) { out.buy.push(L); st.open.push(L); }
  st.level = k;
  return out;
}
export function backtestGrid(cfg, c) {
  const st = {}, paid = {}; let cash = 0, buys = 0, sells = 0, profit = 0;
  for (const p of c) {
    const r = gridStep(cfg, st, p);
    for (const L of r.sell) { cash += cfg.qtyPerLevel * p; profit += cfg.qtyPerLevel * (p - paid[L]); sells++; }
    for (const L of r.buy) { cash -= cfg.qtyPerLevel * p; paid[L] = p; buys++; }
  }
  const held = st.open.length * cfg.qtyPerLevel;
  return { buys, sells, gridProfit: +profit.toFixed(2), openQty: +held.toFixed(4), openValue: +(held * c.at(-1)).toFixed(2), net: +(cash + held * c.at(-1)).toFixed(2) };
}

// ---------- config checks per kind ----------
export function checkConfig(kind, cfg = {}) {
  if (kind === 'dca') return { amountUsd: n(cfg.amountUsd, 1, 1e6, 'Amount'), everyDays: n(cfg.everyDays ?? 7, 1, 365, 'Days between buys'), dipPct: cfg.dipPct ? n(cfg.dipPct, 1, 90, 'Dip %') : null, dipExtraUsd: cfg.dipExtraUsd ? n(cfg.dipExtraUsd, 1, 1e6, 'Extra on dips') : null };
  if (kind === 'grid') {
    const lower = n(cfg.lower, 0.0001, 1e7, 'Lowest price'), upper = n(cfg.upper, 0.0001, 1e7, 'Highest price');
    if (upper <= lower * 1.005) throw bad('The highest price must be above the lowest');
    return { lower, upper, levels: Math.round(n(cfg.levels ?? 10, 3, 100, 'Levels')), qtyPerLevel: n(cfg.qtyPerLevel, 0.0001, 1e6, 'Quantity per level') };
  }
  if (kind === 'scalp') return { amountUsd: n(cfg.amountUsd, 1, 1e6, 'Amount'), dropPct: n(cfg.dropPct ?? 0.5, 0.05, 20, 'Entry drop %'), takePct: n(cfg.takePct ?? 0.6, 0.05, 50, 'Take profit %'), stopPct: n(cfg.stopPct ?? 0.8, 0.05, 50, 'Stop %'), window: Math.round(n(cfg.window ?? 20, 5, 240, 'Average of the last checks')) };
  if (kind === 'rule') {
    const ok = c => c && (c.ind === 'volume' || (IND[c.ind] && ['above', 'below', 'crosses_above', 'crosses_below'].includes(c.op) && (c.ref ? IND[c.ref.ind] : Number.isFinite(+c.value))));
    if (!Array.isArray(cfg.entry) || !cfg.entry.length || !cfg.entry.every(ok) || !(cfg.exit || []).every(ok)) throw bad('The rules are not complete');
    return { entry: cfg.entry, exit: cfg.exit || [], stopPct: cfg.stopPct ? n(cfg.stopPct, 0.1, 90, 'Stop loss %') : null, targetPct: cfg.targetPct ? n(cfg.targetPct, 0.1, 1000, 'Take profit %') : null, holdDays: cfg.holdDays ? Math.round(n(cfg.holdDays, 1, 500, 'Days to hold')) : null, amount: cfg.amount?.qty ? { qty: n(cfg.amount.qty, 0.0001, 1e6, 'Shares') } : { notional: n(cfg.amount?.notional ?? 1000, 1, 1e7, 'Amount') }, summary: String(cfg.summary || '').slice(0, 400) };
  }
  throw bad('Pick DCA, grid, scalping or plain-English rules');
}

// ---------- the running bots ----------
async function priceHistory(symbol, userId, years = 3) {
  const { getBars } = await import('./brokers.js');
  const start = new Date(Date.now() - Math.max(2, years) * 365 * 864e5).toISOString().slice(0, 10);
  const b = await getBars(symbol, start, userId);
  let vol = null;
  try {
    const D = await import('./alpaca/data.js');
    if (D.dataEnabled()) { const r = (await D.bars([symbol], { timeframe: '1Day', start: new Date(Date.parse(b.dates[0])).toISOString(), limit: 10000 }))?.[symbol]; if (r?.length === b.closes.length) vol = r.map(x => x.v); }
  } catch {}
  return { closes: b.closes, dates: b.dates, vol };
}
const crypto = s => s.includes('/');
const S = b => { try { return JSON.parse(b.state || '{}'); } catch { return {}; } };

export async function stepBot(b, deps, t = now()) {
  const cfg = JSON.parse(b.config), st = S(b), user = await one('SELECT * FROM users WHERE id = ?', b.user_id);
  if (!user) return 'no user';
  const lim = aiLimits(user);
  if (b.account !== 'paper' && !lim.botsLive) return 'paused: AI bots on real accounts need the Pro plan';
  if (!crypto(b.symbol) && !session(t).open) return 'waiting for the market to open';
  const price = await deps.lastPrice(b.symbol, b.user_id);
  const order = async (side, o) => { const r = await deps.placeOrder(b.user_id, b.account, { symbol: b.symbol, side, ...o }, 'aibot'); return r; };
  let note = 'no trade';
  if (b.kind === 'dca') {
    const due = !st.lastBuy || t - st.lastBuy >= cfg.everyDays * 864e5 - 60e3;
    const avg = st.units ? st.spent / st.units : null, dip = cfg.dipPct && avg && price <= avg * (1 - cfg.dipPct / 100) && (!st.lastDip || t - st.lastDip > 3 * 864e5);
    if (due || dip) {
      const usd = due ? cfg.amountUsd : cfg.dipExtraUsd || cfg.amountUsd;
      await order('buy', { notional: usd });
      Object.assign(st, { units: (st.units || 0) + usd / price, spent: (st.spent || 0) + usd, [due ? 'lastBuy' : 'lastDip']: t });
      note = `bought $${usd} at ${price.toFixed(2)}${due ? '' : ' (dip)'}`;
    }
  } else if (b.kind === 'grid') {
    const first = st.level == null, r = gridStep(cfg, st, price);
    if (first) note = `grid started at level ${Math.max(0, st.level) + 1} of ${cfg.levels}`;
    if (r.sell.length) await order('sell', { qty: +(cfg.qtyPerLevel * r.sell.length).toFixed(6) });
    if (r.buy.length) await order('buy', { qty: +(cfg.qtyPerLevel * r.buy.length).toFixed(6) });
    if (r.sell.length || r.buy.length) note = [r.sell.length && `sold ${r.sell.length} level${r.sell.length > 1 ? 's' : ''}`, r.buy.length && `bought ${r.buy.length} level${r.buy.length > 1 ? 's' : ''}`].filter(Boolean).join(', ') + ` at ${price.toFixed(2)}`;
    else if (st.level < 0 || st.level >= cfg.levels - 1) note = `price ${price.toFixed(2)} is outside the grid`;
  } else if (b.kind === 'scalp') {
    st.prices = [...(st.prices || []), price].slice(-cfg.window);
    const avg = st.prices.reduce((a, x) => a + x, 0) / st.prices.length;
    if (st.pos) {
      const r = (price / st.pos.price - 1) * 100;
      if (r >= cfg.takePct || r <= -cfg.stopPct) { await order('sell', { qty: st.pos.qty }); note = `sold at ${price.toFixed(2)} (${r >= 0 ? '+' : ''}${r.toFixed(2)}%)`; st.pos = null; }
    } else if (st.prices.length >= Math.ceil(cfg.window / 2) && price <= avg * (1 - cfg.dropPct / 100)) {
      const qty = +(cfg.amountUsd / price).toFixed(crypto(b.symbol) ? 6 : 4);
      await order('buy', { qty }); st.pos = { qty, price }; note = `bought ${qty} at ${price.toFixed(2)} (${((price / avg - 1) * 100).toFixed(2)}% below the average)`;
    }
  } else if (b.kind === 'rule') {
    // Rules use daily bars: checked once per trading day, near the close.
    const h = await priceHistory(b.symbol, b.user_id, 2), c = [...h.closes]; c[c.length - 1] = price;
    const i = c.length - 1, cache = {};
    if (st.pos) {
      const r = price / st.pos.price - 1, days = Math.round((t - st.pos.at) / 864e5);
      const why = cfg.exit.some(x => holds(x, c, i, cache, h.vol)) ? 'sell rule' : cfg.stopPct && r <= -cfg.stopPct / 100 ? 'stop loss' : cfg.targetPct && r >= cfg.targetPct / 100 ? 'take profit' : cfg.holdDays && days >= cfg.holdDays ? 'holding time' : null;
      if (why) { await order('sell', { qty: st.pos.qty }); note = `sold at ${price.toFixed(2)} (${why}, ${(r * 100).toFixed(2)}%)`; st.pos = null; }
    } else if (cfg.entry.every(x => holds(x, c, i, cache, h.vol))) {
      const qty = cfg.amount.qty || +(cfg.amount.notional / price).toFixed(crypto(b.symbol) ? 6 : 4);
      await order('buy', { qty }); st.pos = { qty, price, at: t }; note = `bought ${qty} at ${price.toFixed(2)}`;
    }
  }
  await run('UPDATE ai_bots SET state = ? WHERE id = ?', JSON.stringify(st), b.id);
  return note;
}

// Every minute: bots whose own interval has come round (never more often than the plan allows).
export async function runAiBots(t = now(), deps) {
  deps ||= await import('./brokers.js');
  const due = await all('SELECT * FROM ai_bots WHERE active = 1 AND (last_run IS NULL OR last_run + every_min * 60000 <= ?)', t + 1000);
  const { nyTime } = await import('./time.js'), sess = session(t), mins = nyTime(t).minutes;
  let ran = 0;
  for (const b of due) {
    // Stock bots wait for the session (their turn is kept, not used up); plain-English rules read
    // daily bars, so they decide in the last half hour, when the day's bar is nearly complete.
    if (!crypto(b.symbol) && (!sess.open || (b.kind === 'rule' && mins < 930))) continue;
    const claim = await run('UPDATE ai_bots SET last_run = ? WHERE id = ? AND (last_run IS ? OR last_run = ?)', t, b.id, b.last_run, b.last_run);
    if (!claim.changes) continue;
    let result;
    try { result = await stepBot(b, deps, t); } catch (e) { result = 'error: ' + e.message.slice(0, 200); }
    await run('UPDATE ai_bots SET last_result = ? WHERE id = ?', `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${result}`, b.id);
    if (/^(bought|sold)/.test(result)) { const { notifyUser } = await import('./notify-user.js'); await notifyUser(b.user_id, `AI bot "${b.name}" ${result} ${b.symbol}`).catch(() => {}); }
    ran++;
  }
  return ran;
}

// ---------- ready-made bots (open to every plan) ----------
export const TEMPLATES = [
  { key: 'spy-dca', name: 'S&P 500 weekly DCA', kind: 'dca', symbol: 'SPY', config: { amountUsd: 100, everyDays: 7, dipPct: 8, dipExtraUsd: 100 }, about: 'Buys $100 of SPY every week, and $100 more when it is 8% below your average cost.' },
  { key: 'qqq-dip', name: 'Nasdaq oversold bounce', kind: 'rule', symbol: 'QQQ', text: 'Buy QQQ when 2-day RSI crosses below 10, sell when RSI is above 70, stop loss 6%, hold at most 10 days', about: 'Buys short, sharp dips in the Nasdaq-100 and sells the rebound.' },
  { key: 'golden', name: 'Golden cross trend follower', kind: 'rule', symbol: 'SPY', text: 'Buy SPY on a golden cross, sell on a death cross', about: 'Owns the market while the 50-day average is above the 200-day.' },
  { key: 'rsi-volume', name: 'RSI dip with a volume spike', kind: 'rule', symbol: 'AAPL', text: 'Buy AAPL when 14-day RSI crosses below 30 and volume spikes 2x, sell when RSI is above 60, stop loss 7%', about: 'The example from the plain-English builder: oversold with heavy volume.' },
  { key: 'btc-grid', name: 'Bitcoin range grid', kind: 'grid', symbol: 'BTC/USD', config: { lowerPct: -12, upperPct: 12, levels: 12, qtyPerLevel: 0.001 }, about: '12 levels from 12% below to 12% above today\'s price; buys each step down, sells each step up.' },
  { key: 'eth-scalp', name: 'Ether quick scalper', kind: 'scalp', symbol: 'ETH/USD', config: { amountUsd: 200, dropPct: 0.6, takePct: 0.7, stopPct: 1, window: 30 }, about: 'Buys a 0.6% drop below the recent average and sells 0.7% higher (stop 1%).' },
];

export const aiBotsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const mine = async (req, id) => { const b = await one('SELECT * FROM ai_bots WHERE id = ? AND user_id = ?', +id, req.user.id); if (!b) throw bad('Not found', 404); return b; };
  const out = b => ({ ...b, config: JSON.parse(b.config), state: S(b) });
  r.get('/', async (req, res) => {
    const bots = (await all('SELECT * FROM ai_bots WHERE user_id = ? ORDER BY id DESC', req.user.id)).map(out);
    res.json({ bots, limits: aiLimits(req.user), kinds: KINDS, templates: TEMPLATES, active: bots.filter(b => b.active).length });
  });
  r.post('/parse', async (req, res) => {
    const lim = aiLimits(req.user);
    await useQuota(req.user, 'nlbuild', lim.nlBuilds, 'day', 'Plain-English bot builds');
    res.json(await parseWithAi(req.body?.text));
  });
  r.post('/backtest', async (req, res) => {
    const lim = aiLimits(req.user), kind = req.body?.kind || 'rule', symbol = sym(req.body?.symbol || 'SPY');
    const years = Math.min(lim.backtestYears, Math.max(1, +req.body?.years || 5));
    const h = await priceHistory(symbol, req.user.id, years), c = h.closes;
    if (kind === 'rule') return res.json({ symbol, years, ...backtestRule(checkConfig('rule', req.body.config), c, h.dates, h.vol), volume: !!h.vol });
    if (kind === 'dca') return res.json({ symbol, years, ...backtestDca(checkConfig('dca', req.body.config), c) });
    if (kind === 'grid') return res.json({ symbol, years, ...backtestGrid(checkConfig('grid', req.body.config), c.slice(-252)), note: 'Last 12 months of daily closes; a live grid also trades moves within the day.' });
    throw bad('Scalping needs intraday prices: try it on the practice account instead');
  });
  r.post('/', async (req, res) => {
    const b = req.body || {}, kind = b.kind, lim = aiLimits(req.user);
    if (!KINDS[kind]) throw bad('Pick a bot type');
    const symbol = sym(b.symbol), account = String(b.account || 'paper');
    if (account !== 'paper' && !lim.botsLive) throw upgrade('AI bots on real accounts', p => p.botsLive);
    const config = checkConfig(kind, b.config);
    const every = Math.max(lim.botEveryMin, kind === 'rule' ? 1380 : Math.round(+b.everyMin || (kind === 'dca' ? 1380 : kind === 'grid' ? 15 : 5)));
    const r2 = await run('INSERT INTO ai_bots (user_id, kind, name, account, symbol, config, every_min, created_at) VALUES (?,?,?,?,?,?,?,?)', req.user.id, kind, String(b.name || `${KINDS[kind]} · ${symbol}`).slice(0, 60), account, symbol, JSON.stringify(config), every, now());
    await audit(req.user.id, 'aibot_created', { kind, symbol, account }, req.ip);
    res.json(out(await one('SELECT * FROM ai_bots WHERE id = ?', Number(r2.lastInsertRowid))));
  });
  r.put('/:id', async (req, res) => {
    const b = await mine(req, req.params.id), lim = aiLimits(req.user), body = req.body || {};
    if (body.active) {
      const n2 = (await one('SELECT COUNT(*) n FROM ai_bots WHERE user_id = ? AND active = 1 AND id != ?', req.user.id, b.id)).n;
      if (n2 >= lim.bots) throw upgrade(`More than ${lim.bots} AI bot${lim.bots === 1 ? '' : 's'} running at once`, p => p.bots > lim.bots);
      if (b.account !== 'paper' && !lim.botsLive) throw upgrade('AI bots on real accounts', p => p.botsLive);
    }
    const every = body.everyMin !== undefined ? Math.max(lim.botEveryMin, b.kind === 'rule' ? 1380 : Math.round(n(body.everyMin, 1, 10080, 'Minutes between checks'))) : b.every_min;
    await run('UPDATE ai_bots SET active = ?, name = ?, every_min = ? WHERE id = ?', body.active === undefined ? b.active : body.active ? 1 : 0, body.name ? String(body.name).slice(0, 60) : b.name, every, b.id);
    res.json(out(await one('SELECT * FROM ai_bots WHERE id = ?', b.id)));
  });
  r.delete('/:id', async (req, res) => { const b = await mine(req, req.params.id); await run('DELETE FROM ai_bots WHERE id = ?', b.id); res.json({ ok: true }); });
  // Marketplace: bots people shared (name, rules and description; never their account or results).
  r.get('/market', async (req, res) => {
    const { publicName } = await import('./crypto.js');
    const rows = await all('SELECT b.id, b.user_id, b.kind, b.name, b.symbol, b.config, b.description, b.copies FROM ai_bots b WHERE b.shared = 1 ORDER BY b.copies DESC, b.id DESC LIMIT 100');
    // Authors appear by their public nickname only.
    res.json({ items: rows.map(({ user_id, ...i }) => ({ ...i, config: JSON.parse(i.config), author: publicName(user_id), mine: user_id === req.user.id })), canCopy: aiLimits(req.user).marketplaceCopy });
  });
  r.post('/:id/publish', async (req, res) => {
    const b = await mine(req, req.params.id);
    if (!aiLimits(req.user).marketplaceCopy) throw upgrade('Sharing bots in the AI strategy marketplace', p => p.marketplaceCopy);
    await run('UPDATE ai_bots SET shared = ?, description = ? WHERE id = ?', req.body?.shared === false ? 0 : 1, String(req.body?.description || '').slice(0, 400), b.id);
    res.json({ ok: true });
  });
  r.post('/market/:id/copy', async (req, res) => {
    if (!aiLimits(req.user).marketplaceCopy) throw upgrade('Copying bots from the AI strategy marketplace', p => p.marketplaceCopy);
    const s = await one('SELECT * FROM ai_bots WHERE id = ? AND shared = 1', +req.params.id); if (!s) throw bad('Not found', 404);
    const r2 = await run('INSERT INTO ai_bots (user_id, kind, name, account, symbol, config, every_min, copied_from, created_at) VALUES (?,?,?,?,?,?,?,?,?)', req.user.id, s.kind, s.name, 'paper', s.symbol, s.config, Math.max(aiLimits(req.user).botEveryMin, s.every_min), s.id, now());
    await run('UPDATE ai_bots SET copies = copies + 1 WHERE id = ?', s.id);
    res.json(out(await one('SELECT * FROM ai_bots WHERE id = ?', Number(r2.lastInsertRowid))));
  });
  return r;
})();
