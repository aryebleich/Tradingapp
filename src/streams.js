// Live market-data streams over WebSocket: prices arrive as they trade, instead of the app asking
// again and again. One connection per provider for the whole server; the symbols open in any
// browser and every active price alert are subscribed, updates go to browsers over the same live
// channel as Alpaca's stream (Server-Sent Events), and alerts fire on the tick that crosses them.
//   alpaca      (src/alpaca/stream.js) IEX real-time, or SIP with a market-data subscription
//   finnhub     US trades in real time and crypto (free key: 50 symbols)
//   polygon     trades and quotes (real time on paid plans; POLYGON_WS_DELAYED=1 for 15-min delayed)
//   twelvedata  prices for stocks, ETFs and crypto (free plan: 8 symbols)
// The owner picks one in Admin → Market data → Live stream (or "automatic": the first with a key).
import { siteGet, siteSet } from './site.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const toFinnhub = s => (s.includes('/') ? `BINANCE:${s.replace('/USD', 'USDT').replace('/', '')}` : s);
const fromFinnhub = s => (s.startsWith('BINANCE:') ? s.slice(8).replace(/USDT$/, '/USD') : s);

export const WS_PROVIDERS = {
  finnhub: {
    name: 'Finnhub', key: 'FINNHUB_API_KEY', realtime: true, maxSymbols: 50,
    url: k => `${process.env.FINNHUB_WS_URL || 'wss://ws.finnhub.io'}?token=${encodeURIComponent(k)}`,
    open() {}, sub: (ws, syms) => syms.forEach(s => ws.send(JSON.stringify({ type: 'subscribe', symbol: toFinnhub(s) }))),
    unsub: (ws, syms) => syms.forEach(s => ws.send(JSON.stringify({ type: 'unsubscribe', symbol: toFinnhub(s) }))),
    parse: m => (m.type === 'trade' ? (m.data || []).map(d => ({ symbol: fromFinnhub(d.s), price: d.p, time: new Date(d.t).toISOString() })) : m.type === 'error' ? { error: m.msg } : []),
  },
  polygon: {
    name: 'Polygon', key: 'POLYGON_API_KEY', realtime: !process.env.POLYGON_WS_DELAYED, maxSymbols: 100,
    url: () => process.env.POLYGON_WS_URL || (process.env.POLYGON_WS_DELAYED ? 'wss://delayed.polygon.io/stocks' : 'wss://socket.polygon.io/stocks'),
    open: (ws, k) => ws.send(JSON.stringify({ action: 'auth', params: k })),
    sub: (ws, syms) => { const s = syms.filter(x => !x.includes('/')); if (s.length) ws.send(JSON.stringify({ action: 'subscribe', params: s.flatMap(x => [`T.${x}`, `Q.${x}`]).join(',') })); },
    unsub: (ws, syms) => { const s = syms.filter(x => !x.includes('/')); if (s.length) ws.send(JSON.stringify({ action: 'unsubscribe', params: s.flatMap(x => [`T.${x}`, `Q.${x}`]).join(',') })); },
    parse: m => [].concat(m).flatMap(e => (e.ev === 'T' ? [{ symbol: e.sym, price: e.p, time: new Date(e.t).toISOString() }] : e.ev === 'Q' ? [{ symbol: e.sym, bid: e.bp, ask: e.ap, time: new Date(e.t).toISOString() }] : e.ev === 'status' && /fail|error/i.test(e.status) ? [{ error: e.message }] : [])),
  },
  twelvedata: {
    name: 'Twelve Data', key: 'TWELVEDATA_API_KEY', realtime: true, maxSymbols: 8,
    url: k => `${process.env.TWELVEDATA_WS_URL || 'wss://ws.twelvedata.com/v1/quotes/price'}?apikey=${encodeURIComponent(k)}`,
    open() {}, sub: (ws, syms) => syms.length && ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: syms.join(',') } })),
    unsub: (ws, syms) => syms.length && ws.send(JSON.stringify({ action: 'unsubscribe', params: { symbols: syms.join(',') } })),
    heartbeat: ws => ws.send(JSON.stringify({ action: 'heartbeat' })),
    parse: m => (m.event === 'price' ? [{ symbol: m.symbol, price: m.price, time: new Date((m.timestamp || Date.now() / 1000) * 1000).toISOString() }] : m.status === 'error' ? { error: m.message } : []),
  },
};
export const settings = () => ({ provider: 'auto', ...(siteGet('streams', {}) || {}) });
export async function saveSettings(b = {}) {
  const p = String(b.provider || 'auto');
  if (p !== 'auto' && p !== 'alpaca' && p !== 'off' && !WS_PROVIDERS[p]) throw bad('Unknown stream provider');
  await siteSet('streams', { provider: p });
  hub.restart();
  return settings();
}
const hasKey = id => !!process.env[WS_PROVIDERS[id]?.key];
// Which external stream runs ('alpaca' means the built-in Alpaca stream handles it).
export function chosen(alpacaReady = false) {
  const p = settings().provider;
  if (p === 'off') return null;
  if (p === 'alpaca') return alpacaReady ? 'alpaca' : null;
  if (WS_PROVIDERS[p]) return hasKey(p) ? p : null;
  if (alpacaReady) return 'alpaca';
  return Object.keys(WS_PROVIDERS).find(hasKey) || null;
}

class Hub {
  constructor() { this.ws = null; this.id = null; this.subscribed = new Set(); this.stats = { messages: 0, ticks: 0, errors: 0, lastTick: null, lastLatencyMs: null, connectedAt: null, lastError: null }; this.backoff = 1000; this.sink = () => {}; this.wantFn = () => new Set(); this.timer = null; }
  configure({ sink, want, alpacaReady }) { if (sink) this.sink = sink; if (want) this.wantFn = want; if (alpacaReady) this.alpacaReady = alpacaReady; }
  provider() { const c = chosen(this.alpacaReady?.()); return c && c !== 'alpaca' ? c : null; }
  restart() { if (this.ws) { try { this.ws.close(); } catch {} } this.ws = null; this.subscribed.clear(); this.sync(); }
  sync() {
    const id = this.provider();
    const want = new Set([...this.wantFn()].slice(0, id ? WS_PROVIDERS[id].maxSymbols : 0));
    if (!id || !want.size) { if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; } return; }
    if (this.id !== id && this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    if (!this.ws) return this.connect(id);
    if (!this.ready) return;
    const P = WS_PROVIDERS[id], add = [...want].filter(s => !this.subscribed.has(s)), del = [...this.subscribed].filter(s => !want.has(s));
    try { if (add.length) P.sub(this.ws, add); if (del.length) P.unsub(this.ws, del); this.subscribed = want; } catch (e) { this.stats.lastError = e.message; }
  }
  connect(id) {
    if (typeof WebSocket !== 'function') return;
    const P = WS_PROVIDERS[id], key = process.env[P.key];
    this.id = id; this.ready = false;
    let ws;
    try { ws = this.ws = new WebSocket(P.url(key)); } catch (e) { this.stats.lastError = e.message; return; }
    ws.onopen = () => { this.ready = true; this.backoff = 1000; this.stats.connectedAt = Date.now(); this.subscribed.clear(); try { P.open(ws, key); } catch {} this.sync();
      if (P.heartbeat) { clearInterval(this.timer); this.timer = setInterval(() => { try { P.heartbeat(ws); } catch {} }, 10000); this.timer.unref?.(); } };
    ws.onmessage = ev => {
      this.stats.messages++;
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      const out = P.parse(m);
      if (out && !Array.isArray(out)) { this.stats.errors++; this.stats.lastError = out.error || 'error'; return; }
      for (const u of out || []) {
        if (!u.symbol) continue;
        this.stats.ticks++; this.stats.lastTick = Date.now();
        if (u.time) this.stats.lastLatencyMs = Math.max(0, Date.now() - Date.parse(u.time));
        this.sink({ ...u, source: P.name, realtime: P.realtime });
      }
    };
    ws.onclose = () => {
      clearInterval(this.timer);
      if (this.ws === ws) { this.ws = null; this.ready = false; }
      if (this.provider() && this.wantFn().size) setTimeout(() => this.sync(), this.backoff = Math.min(this.backoff * 2, 60000)).unref?.();
    };
    ws.onerror = e => { this.stats.errors++; this.stats.lastError = e?.message || 'connection error'; };
  }
  status() {
    const id = this.provider();
    return { provider: settings().provider, active: id || (chosen(this.alpacaReady?.()) === 'alpaca' ? 'alpaca' : null), connected: !!(this.ws && this.ready), subscribed: [...this.subscribed], ...this.stats,
      available: Object.fromEntries(Object.entries(WS_PROVIDERS).map(([k, v]) => [k, { name: v.name, key: v.key, configured: hasKey(k), realtime: v.realtime, maxSymbols: v.maxSymbols }])) };
  }
}
export const hub = new Hub();

// ---------- price alerts on the tick ----------
let alertCache = { at: 0, list: [] };
export async function alertSymbols() {
  if (Date.now() - alertCache.at > 60e3) {
    const { all } = await import('./db.js');
    alertCache = { at: Date.now(), list: await all('SELECT * FROM alerts WHERE active = 1').catch(() => []) };
  }
  return alertCache.list;
}
export function resetAlertCache() { alertCache.at = 0; }
// Called on every tick with a price: fires (once) the alerts it crosses.
export async function checkTick(symbol, price, notify) {
  if (!(price > 0)) return 0;
  let n = 0;
  for (const a of (await alertSymbols()).filter(x => x.symbol === symbol && x.active)) {
    if (!((a.op === 'above' && price >= a.price) || (a.op === 'below' && price <= a.price))) continue;
    const { run } = await import('./db.js');
    if (!(await run('UPDATE alerts SET active = 0 WHERE id = ? AND active = 1', a.id)).changes) continue;
    a.active = 0; n++;
    await notify(a.user_id, `Alert: ${symbol} is ${(+price).toFixed(2)} (${a.op} ${a.price}), live price`).catch(() => {});
  }
  return n;
}
