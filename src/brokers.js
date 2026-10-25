// Market data + broker adapters: Alpaca (paper/live) and the built-in paper simulator.
import { one, all, run, now, tx } from './db.js';
import { decrypt } from './crypto.js';
import { rng } from './engine.js';
import { tradingFor, requireTrading } from './alpaca/connections.js';
import { EXT_IDS, withExt } from './ext/brokers.js';
import { checkOrder, logOrder } from './risk.js';
import { breaker, chaos, isOutage, shedding } from './reliability.js';
import { enqueue, AUTOMATED } from './orderqueue.js';
import { quoteAt, auditAppend, improvementBps, routePlan } from './execution.js';
import crypto from 'node:crypto';

// Every account a user can trade: the paper simulator, Alpaca, and the other brokerages.
export const ACCOUNT_IDS = ['paper', 'alpaca', ...EXT_IDS];
export const isExt = a => EXT_IDS.includes(a);

export const DATA = (process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets') + '/v2';

export async function getCred(userId, provider) {
  const r = await one('SELECT blob FROM credentials WHERE user_id = ? AND provider = ?', userId, provider);
  if (!r) return null;
  // A changed ENCRYPTION_KEY makes stored keys unreadable; treat them as disconnected instead of failing every page.
  try { return decrypt(r.blob); } catch { console.warn(`credentials for user ${userId}/${provider} cannot be decrypted`); return null; }
}
// Fall back to a platform-wide market-data key so demo users can backtest real history.
async function dataCred(userId) {
  const c = userId && await getCred(userId, 'alpaca');
  if (c) return c;
  if (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET) return { k: process.env.ALPACA_KEY_ID, s: process.env.ALPACA_SECRET };
  return null;
}
const hdr = c => ({ 'APCA-API-KEY-ID': c.k, 'APCA-API-SECRET-KEY': c.s, 'Content-Type': 'application/json' });

// Seeded geometric Brownian motion with regime shifts; clearly labeled as synthetic in the UI.
export function syntheticBars(symbol, n = 2520) {
  const seed = [...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = rng(seed), gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const closes = [], dates = [];
  let px = 50 + (seed % 250), mu = 0.0004, vol = 0.015;
  const d = new Date(Date.UTC(2016, 0, 4));
  for (let i = 0; i < n; i++) {
    if (i % 250 === 0) { mu = 0.0004 + (rand() - 0.5) * 0.0016; vol = 0.008 + rand() * 0.02; }
    px *= Math.exp(mu - vol * vol / 2 + vol * gauss());
    closes.push(+px.toFixed(2));
    do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    dates.push(d.toISOString().slice(0, 10));
  }
  return { closes, dates, source: 'synthetic' };
}

// Made-up prices are only acceptable in development and tests. In production a data outage
// must surface as an error instead of silently filling orders at fictional prices.
const syntheticAllowed = () => process.env.FREE_DATA === 'off' || process.env.NODE_ENV !== 'production';
const unavailable = () => Object.assign(new Error('Market data is temporarily unavailable. Please try again in a minute.'), { status: 503 });
const unknownSymbol = symbol => Object.assign(new Error(`Unknown ticker "${symbol}". Use a US stock or ETF symbol like AAPL or SPY.`), { status: 404 });
export const validSymbol = s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);

// Small bounded cache so a stream of different tickers cannot grow memory without limit.
function cache(max) {
  const m = new Map();
  return {
    get(k, ttl) { const h = m.get(k); return h && now() - h.at < ttl ? h.v : undefined; },
    set(k, v) { m.delete(k); m.set(k, { at: now(), v }); if (m.size > max) m.delete(m.keys().next().value); },
  };
}
const barCache = cache(300), quoteCache = cache(500);

// Free daily history (split/dividend adjusted). Returns null on network trouble, throws for unknown tickers.
async function yahooBars(symbol, start) {
  if (process.env.FREE_DATA === 'off') return null;
  const from = Math.floor(Date.parse(start) / 1000), to = Math.floor(Date.now() / 1000);
  let r;
  try {
    r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1d&events=split,div`,
      { headers: { 'User-Agent': 'Mozilla/5.0 QuantPocket' }, signal: AbortSignal.timeout(8000) });
  } catch { return null; }
  if (r.status === 404) throw unknownSymbol(symbol);
  if (!r.ok) return null;
  const res = (await r.json().catch(() => ({}))).chart?.result?.[0];
  const ts = res?.timestamp || [], adj = res?.indicators?.adjclose?.[0]?.adjclose || res?.indicators?.quote?.[0]?.close || [];
  const closes = [], dates = [];
  ts.forEach((t, i) => { if (adj[i] != null) { closes.push(+adj[i].toFixed(4)); dates.push(new Date(t * 1000).toISOString().slice(0, 10)); } });
  if (!closes.length) throw unknownSymbol(symbol);
  if (closes.length < 260) throw new Error(`${symbol} has only ${closes.length} days of history since ${start}; pick an earlier start date.`);
  return { closes, dates, source: 'yahoo' };
}
async function yahooQuote(symbol) {
  if (process.env.FREE_DATA === 'off') return null;
  let r;
  try {
    r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
      { headers: { 'User-Agent': 'Mozilla/5.0 QuantPocket' }, signal: AbortSignal.timeout(5000) });
  } catch { return null; }
  if (r.status === 404) throw unknownSymbol(symbol);
  if (!r.ok) return null;
  return (await r.json().catch(() => ({}))).chart?.result?.[0]?.meta?.regularMarketPrice || null;
}

async function alpacaBars(c, symbol, start) {
  const closes = [], dates = []; let tok = '';
  do {
    const r = await fetch(`${DATA}/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&start=${start}&limit=10000&adjustment=all&feed=iex${tok ? '&page_token=' + tok : ''}`, { headers: hdr(c), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Alpaca data ${r.status}`);
    const d = await r.json();
    for (const b of d.bars || []) { closes.push(b.c); dates.push(b.t.slice(0, 10)); }
    tok = d.next_page_token || '';
  } while (tok);
  if (!closes.length) throw unknownSymbol(symbol);
  if (closes.length < 260) throw new Error(`${symbol} has only ${closes.length} days of history since ${start}; pick an earlier start date.`);
  return { closes, dates, source: 'alpaca' };
}

// Daily closes from the user's Alpaca key, the platform key, or free Yahoo data, in that order.
export async function getBars(symbol, start, userId) {
  symbol = String(symbol || '').trim().toUpperCase();
  if (!validSymbol(symbol)) throw unknownSymbol(symbol);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || isNaN(Date.parse(start)) || Date.parse(start) > Date.now() - 400 * 86400e3)
    throw new Error('Pick a start date at least about 1.5 years in the past (YYYY-MM-DD).');
  const key = symbol + start, hit = barCache.get(key, 3600e3);
  if (hit) return hit;
  let v;
  const c = await dataCred(userId);
  if (c) {
    try { v = await alpacaBars(c, symbol, start); }
    catch (e) { if (e.status === 404 || /history since/.test(e.message)) throw e; console.warn('alpaca bars, falling back:', e.message); }
  }
  v ||= await yahooBars(symbol, start);
  if (!v) { if (!syntheticAllowed()) throw unavailable(); v = syntheticBars(symbol); }
  barCache.set(key, v);
  return v;
}

export async function lastPrice(symbol, userId) {
  symbol = String(symbol || '').trim().toUpperCase();
  if (!validSymbol(symbol)) throw unknownSymbol(symbol);
  const hit = quoteCache.get(symbol, 15e3);
  if (hit) return hit;
  let p = null;
  const c = await dataCred(userId);
  if (c) {
    const r = await fetch(`${DATA}/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`, { headers: hdr(c), signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (r?.ok) p = (await r.json()).trade?.p || null;
  }
  p ||= await yahooQuote(symbol);
  if (!p) {
    if (!syntheticAllowed()) throw unavailable();
    const b = syntheticBars(symbol); p = b.closes[b.closes.length - 1];
  }
  quoteCache.set(symbol, p);
  return p;
}


// --- unified account interface; account is 'paper' (built-in sim) or 'alpaca' ---

export async function accountSummary(userId, account) {
  if (isExt(account)) return withExt(userId, account, async (b, c, save) => ({ account, live: !!c.live, broker: b.name, ...(await b.summary(c, save)) }));
  if (account === 'alpaca') {
    const t = await requireTrading(userId);
    const [a, pos] = await Promise.all([t.account(), t.positions()]);
    return {
      account, live: t.live, cash: +a.cash, equity: +a.equity, buyingPower: +a.buying_power, lastEquity: +a.last_equity,
      positions: pos.map(p => ({ symbol: p.symbol, qty: +p.qty, avgPrice: +p.avg_entry_price, price: +p.current_price, value: +p.market_value, pnl: +p.unrealized_pl })),
    };
  }
  const acct = await one('SELECT * FROM paper_accounts WHERE user_id = ?', userId);
  const pos = await all("SELECT * FROM positions WHERE user_id = ? AND account = 'paper' AND qty != 0", userId);
  const priced = await Promise.all(pos.map(async p => {
    const price = await lastPrice(p.symbol, userId).catch(() => p.avg_price);
    return { symbol: p.symbol, qty: p.qty, avgPrice: p.avg_price, price, value: p.qty * price, pnl: (price - p.avg_price) * p.qty };
  }));
  const equity = acct.cash + priced.reduce((a, p) => a + p.value, 0);
  return { account, live: false, cash: acct.cash, equity, buyingPower: acct.cash, startCash: acct.start_cash, positions: priced };
}

// Records a fill and updates the average-cost position inside one transaction. `check` runs first
// in the same transaction, so two simultaneous paper orders cannot both spend the same cash.
export async function recordFill(userId, account, symbol, side, qty, price, source, { brokerId = null, check, at = now(), expected = null, signalAt = null } = {}) {
  await tx(async ({ one, run }) => {
    if (check) await check(one);
    if (brokerId && await one('SELECT id FROM fills WHERE broker_order_id = ?', brokerId)) return;
    // An order placed by an automation left its expected price and real source behind.
    const intent = brokerId ? await one('SELECT expected_price, signal_at, source FROM order_intents WHERE broker_order_id = ?', brokerId) : null;
    if (intent) { expected ??= intent.expected_price; signalAt ??= intent.signal_at; if (source === 'alpaca' && intent.source) source = intent.source; }
    const p = await one('SELECT * FROM positions WHERE user_id = ? AND account = ? AND symbol = ?', userId, account, symbol);
    const cur = p?.qty || 0, avg = p?.avg_price || 0;
    const nq = +(side === 'buy' ? cur + qty : cur - qty).toFixed(6);
    const navg = side === 'buy' ? (cur * avg + qty * price) / nq : avg;
    await run('INSERT INTO positions (user_id, account, symbol, qty, avg_price) VALUES (?,?,?,?,?) ON CONFLICT(user_id, account, symbol) DO UPDATE SET qty = excluded.qty, avg_price = excluded.avg_price',
      userId, account, symbol, nq, nq ? navg : 0);
    await run('INSERT INTO fills (user_id, account, symbol, side, qty, price, source, broker_order_id, at, expected_price, signal_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', userId, account, symbol, side, qty, price, source, brokerId, at, expected, signalAt);
    if (account === 'paper') await run('UPDATE paper_accounts SET cash = cash + ? WHERE user_id = ?', +((side === 'buy' ? -1 : 1) * qty * price).toFixed(6), userId);
  });
}

// Annualized 20-day volatility of a symbol, cached for the day (used by the graduated risk limits).
const volCache = new Map();
export async function volatility(symbol, userId) {
  const k = symbol + ':' + new Date().toISOString().slice(0, 10);
  if (volCache.has(k)) return volCache.get(k);
  const c = (await getBars(symbol, new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10), userId)).closes.slice(-21);
  const r = c.slice(1).map((x, i) => Math.log(x / c[i])), m = r.reduce((a, b) => a + b, 0) / (r.length || 1);
  const v = r.length > 5 ? Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(symbol.includes('/') ? 365 : 252) * 100 : null;
  if (volCache.size > 2000) volCache.clear();
  volCache.set(k, v);
  return v;
}
export const riskDeps = userId => ({ summarize: accountSummary, price: s => lastPrice(s, userId), volatility: s => volatility(s, userId) });

// order: { symbol, side, qty?, notional? }. Account "smart" routes to the best connected brokerage.
export async function placeOrder(userId, account, order, source = 'manual') {
  const symbol = String(order.symbol || '').trim().toUpperCase();
  const side = order.side === 'sell' ? 'sell' : 'buy';
  let q = +order.qty, n = +order.notional;
  if (!validSymbol(symbol)) throw new Error('Invalid symbol');
  if (!(Number.isFinite(q) && q > 0) && !(Number.isFinite(n) && n > 0)) throw new Error('Give a quantity or dollar amount');
  if (account === 'smart') return smartOrder(userId, { ...order, symbol, side }, source);
  // Guardrails first (account lock, limits, speed bumps, daily loss stop, kill switch), for every source.
  const chk = await checkOrder(userId, account, { symbol, side, qty: q, notional: n }, source, riskDeps(userId));
  if (chk?.resize) { if (chk.resize.notional) { n = chk.resize.notional; q = 0; } else { q = chk.resize.qty; n = 0; } }
  // During a surge, automated orders wait in the queue so manual trading and risk controls stay fast.
  if (AUTOMATED(source) && !order._fromQueue && shedding()) return enqueue(userId, account, { ...order, symbol, side }, source, 'server under heavy load');
  const ref = crypto.randomUUID(), quote = await quoteAt(symbol, D_ENABLED() ? null : await lastPrice(symbol, userId).catch(() => null));
  await auditAppend(userId, 'order', { event: 'sent', orderRef: ref, venue: account, symbol, side, qty: q || null, notional: n || null, source, quote, at: now() });
  let r;
  try { r = await breaker(account).run(async () => { await chaos(); return sendOrder(userId, account, symbol, side, q, n, source, order); }); }
  catch (e) {
    const outage = e.breakerOpen || isOutage(e);
    await auditAppend(userId, 'order', { event: outage ? 'deferred' : 'rejected', orderRef: ref, venue: account, symbol, side, reason: e.message.slice(0, 200), at: now() });
    if (outage && AUTOMATED(source) && !order._fromQueue) return enqueue(userId, account, { ...order, symbol, side }, source, e.message);
    throw e;
  }
  const value = n || (q * (r.price || quote.ask || quote.last || 0));
  await logOrder(userId, account, { symbol, side, value }, source);
  const filled = r.status === 'filled' && r.price > 0;
  await auditAppend(userId, 'order', { event: filled ? 'filled' : 'accepted', orderRef: ref, brokerOrderId: r.id ? String(r.id) : null, venue: account, symbol, side, qty: r.qty || q || null, price: r.price || null, status: r.status, improvementBps: filled ? improvementBps(side, quote, r.price) : null, at: now() });
  return { ...r, ...(chk?.notes?.length ? { notes: chk.notes } : {}) };
}
const D_ENABLED = () => !!(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET);

// Smart routing: try brokerages in score order; buys fail over to the next one on an outage.
async function smartOrder(userId, order, source) {
  const { accountsFor } = await import('./ext/routes.js');
  const accounts = await accountsFor(userId), holdings = {};
  if (order.side === 'sell') for (const a of accounts.filter(x => x.connected && x.id !== 'paper')) holdings[a.id] = (await accountSummary(userId, a.id).catch(() => ({ positions: [] }))).positions.find(p => p.symbol === order.symbol)?.qty || 0;
  const plan = await routePlan(userId, order.symbol, order.side, { accounts, holdings });
  let last;
  for (const [i, venue] of plan.order.entries()) {
    try { const r = await placeOrder(userId, venue, { ...order, _fromQueue: true }, source); return { ...r, routedTo: venue, routing: plan.scores }; }
    catch (e) {
      last = e;
      if (!(plan.failover && (e.breakerOpen || isOutage(e))) || i === plan.order.length - 1) throw e;
      await auditAppend(userId, 'order', { event: 'failover', from: venue, to: plan.order[i + 1], symbol: order.symbol, side: order.side, reason: e.message.slice(0, 200), at: now() });
    }
  }
  throw last || new Error('No brokerage available');
}
// Automations pass the price they expected (expectedPrice) and when the signal fired (signalAt),
// so the execution report can measure slippage and delay.
async function sendOrder(userId, account, symbol, side, q, n, source, order) {
  const expected = +order.expectedPrice > 0 ? +order.expectedPrice : null, signalAt = +order.signalAt || (expected ? now() : null);
  const intent = (brokerId, acct) => (expected || source !== 'web') && brokerId
    ? run('INSERT INTO order_intents (user_id, account, broker_order_id, symbol, side, expected_price, signal_at, source, at) VALUES (?,?,?,?,?,?,?,?,?)', userId, acct, String(brokerId), symbol, side, expected, signalAt, source, now()).catch(() => {}) : null;
  if (isExt(account)) {
    return withExt(userId, account, async (b, c, save) => {
      // Other brokerages take whole shares. A sell beyond what is held opens a short; a buy
      // against a short position covers it (each broker names these differently).
      const qty = q > 0 ? Math.floor(q) : Math.floor(n / await lastPrice(symbol, userId));
      if (!(qty >= 1)) throw new Error('Amount is less than one share');
      const held = (await b.summary(c, save)).positions.find(p => p.symbol === symbol)?.qty || 0;
      const kind = side === 'buy' ? (held < 0 ? 'buy_to_cover' : 'buy') : held > 0 ? 'sell' : 'sell_short';
      if (kind === 'sell_short' && !b.shorts) throw new Error(`${b.name} does not support short selling here`);
      const r = await b.place(c, { symbol, side: kind, qty }, save);
      await intent(r.id, account);
      return { id: r.id, status: r.status, symbol, side, qty, broker: account, live: !!c.live };
    });
  }
  if (account === 'alpaca') {
    const t = await requireTrading(userId);
    const body = { symbol, side, type: 'market', time_in_force: 'day', ...(q > 0 ? { qty: String(q) } : { notional: n.toFixed(2) }) };
    const o = await t.placeOrder(body);
    await intent(o.id, 'alpaca');
    // Usually fills within seconds; anything still open is picked up later by syncAlpacaFills.
    setTimeout(() => syncAlpacaFills(userId).catch(() => {}), 4000);
    return { id: o.id, status: o.status, symbol, side, broker: 'alpaca', live: t.live };
  }
  const price = await lastPrice(symbol, userId);
  const qty = q > 0 ? q : +(n / price).toFixed(6);
  if (!(qty > 0)) throw new Error('Amount is too small');
  await recordFill(userId, 'paper', symbol, side, qty, price, source, { expected, signalAt, check: async one => {
    if (side === 'buy') {
      const a = await one('SELECT cash FROM paper_accounts WHERE user_id = ?', userId);
      if (qty * price > a.cash + 1e-6) throw new Error(`Not enough paper cash ($${a.cash.toFixed(2)})`);
    } else {
      const p = await one("SELECT qty FROM positions WHERE user_id = ? AND account = 'paper' AND symbol = ?", userId, symbol);
      if (!p || p.qty < qty - 1e-9) throw new Error(`You hold ${p?.qty || 0} ${symbol}`);
    }
  } });
  return { status: 'filled', symbol, side, qty, price, broker: 'paper' };
}

// Copies filled Alpaca orders into local fills so tax lots stay complete, including orders that
// filled later (placed after hours, by bots, or directly in Alpaca).
export async function syncAlpacaFills(userId) {
  const t = await tradingFor(userId);
  if (!t || (t.type === 'broker' && t.conn.status !== 'ACTIVE')) return 0;
  const orders = await t.orders({ status: 'closed', limit: 200, direction: 'desc', nested: false });
  let added = 0;
  for (const o of orders.reverse()) {
    if (o.status !== 'filled' && !(+o.filled_qty > 0)) continue;
    if (await one('SELECT id FROM fills WHERE broker_order_id = ?', o.id)) continue;
    if (!o.symbol || o.order_class === 'mleg') continue; // spreads: legs are recorded by Alpaca per contract
    await recordFill(userId, 'alpaca', o.symbol, o.side, +o.filled_qty, +o.filled_avg_price, 'alpaca', { brokerId: o.id, at: Date.parse(o.filled_at) || now() });
    await auditFill(userId, o).catch(() => {});
    added++;
  }
  return added;
}

export async function listOrders(userId, account) {
  if (isExt(account)) return withExt(userId, account, (b, c, save) => b.orders(c, save));
  if (account === 'alpaca') {
    const t = await requireTrading(userId);
    syncAlpacaFills(userId).catch(e => console.warn('alpaca sync', e.message));
    return (await t.orders({ status: 'all', limit: 50, nested: false })).map(o => ({ id: o.id, symbol: o.symbol, side: o.side, qty: +o.qty || null, notional: +o.notional || null, status: o.status, price: +o.filled_avg_price || null, at: o.submitted_at }));
  }
  return (await all("SELECT id, symbol, side, qty, price, source, at FROM fills WHERE user_id = ? AND account = 'paper' ORDER BY id DESC LIMIT 50", userId)).map(f => ({ ...f, status: 'filled' }));
}

export async function portfolioHistory(userId, account) {
  if (isExt(account)) return [];
  if (account === 'alpaca') {
    const t = await requireTrading(userId);
    const h = await t.portfolioHistory({ period: '1A', timeframe: '1D' });
    return h.timestamp.map((t, i) => ({ day: new Date(t * 1000).toISOString().slice(0, 10), equity: h.equity[i] })).filter(x => x.equity != null);
  }
  return await all("SELECT day, equity FROM equity_history WHERE user_id = ? AND account = 'paper' ORDER BY day", userId);
}

export async function snapshotEquity(userId) {
  const s = await accountSummary(userId, 'paper');
  await run("INSERT INTO equity_history (user_id, account, day, equity) VALUES (?, 'paper', ?, ?) ON CONFLICT DO UPDATE SET equity = excluded.equity", userId, new Date().toISOString().slice(0, 10), s.equity);
  return s;
}

// A broker fill that arrives later is added to the execution log next to the order it belongs to.
async function auditFill(userId, o) {
  const sent = await one("SELECT data FROM exec_audit WHERE user_id = ? AND kind = 'order' AND data LIKE ? ORDER BY id DESC LIMIT 1", userId, `%"brokerOrderId":"${o.id}"%`);
  const prev = sent ? JSON.parse(sent.data) : null;
  if (await one("SELECT 1 FROM exec_audit WHERE user_id = ? AND kind = 'fill' AND data LIKE ?", userId, `%"brokerOrderId":"${o.id}"%`)) return;
  let quote = null;
  if (prev) { const s0 = await one("SELECT data FROM exec_audit WHERE user_id = ? AND data LIKE ? AND data LIKE '%\"event\":\"sent\"%'", userId, `%"orderRef":"${prev.orderRef}"%`); quote = s0 ? JSON.parse(s0.data).quote : null; }
  await auditAppend(userId, 'fill', { event: 'filled', orderRef: prev?.orderRef || o.id, brokerOrderId: String(o.id), venue: 'alpaca', symbol: o.symbol, side: o.side, qty: +o.filled_qty, price: +o.filled_avg_price, filledAt: o.filled_at, improvementBps: improvementBps(o.side, quote, +o.filled_avg_price), at: Date.parse(o.filled_at) || now() });
}
