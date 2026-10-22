// Real-time quotes and trades. The server holds one WebSocket per feed (stocks, crypto) to
// Alpaca's market data stream (free plans allow a single connection) and fans updates out to
// browsers over Server-Sent Events, coalesced to at most two pushes per second per browser.
import { URLS } from './http.js';
import { brokerEnabled } from './broker.js';

const MAX_SYMBOLS = +process.env.ALPACA_STREAM_MAX_SYMBOLS || 30;
const clients = new Set(); // { res, symbols:Set, pending:Map, timer }

function creds() {
  if (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET) return { key: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET, base: URLS.stream() };
  if (brokerEnabled()) return { key: process.env.BROKER_API_KEY, secret: process.env.BROKER_API_SECRET, base: URLS.stream().replace('stream.data.', 'stream.data.sandbox.') };
  return null;
}
export const streamEnabled = () => !!creds() && typeof WebSocket === 'function';

class Feed {
  constructor(name, path) { this.name = name; this.path = path; this.ws = null; this.ready = false; this.subscribed = new Set(); this.backoff = 1000; }
  connect() {
    const c = creds();
    if (!c || this.ws) return;
    const ws = this.ws = new WebSocket(c.base + this.path);
    ws.onmessage = ev => {
      let msgs; try { msgs = JSON.parse(ev.data); } catch { return; }
      for (const m of [].concat(msgs)) {
        if (m.T === 'success' && m.msg === 'connected') ws.send(JSON.stringify({ action: 'auth', key: c.key, secret: c.secret }));
        else if (m.T === 'success' && m.msg === 'authenticated') { this.ready = true; this.backoff = 1000; this.subscribed.clear(); this.sync(); }
        else if (m.T === 'error') console.warn(`stream ${this.name}:`, m.code, m.msg);
        else if (m.T === 't' || m.T === 'q' || m.T === 'b') dispatch(m);
      }
    };
    ws.onclose = () => {
      this.ws = null; this.ready = false;
      if (wanted(this.name).size) setTimeout(() => this.connect(), this.backoff = Math.min(this.backoff * 2, 60000));
    };
    ws.onerror = () => {};
  }
  sync() {
    const want = wanted(this.name);
    if (!want.size) { if (this.ws) this.ws.close(); return; }
    if (!this.ws) return this.connect();
    if (!this.ready) return;
    const add = [...want].filter(s => !this.subscribed.has(s)), del = [...this.subscribed].filter(s => !want.has(s));
    if (add.length) this.ws.send(JSON.stringify({ action: 'subscribe', trades: add, quotes: add }));
    if (del.length) this.ws.send(JSON.stringify({ action: 'unsubscribe', trades: del, quotes: del }));
    this.subscribed = new Set(want);
  }
}
const feeds = { stocks: new Feed('stocks', `/v2/${process.env.ALPACA_STOCK_FEED || 'iex'}`), crypto: new Feed('crypto', '/v1beta3/crypto/us') };

function wanted(name) {
  const all = new Set();
  for (const c of clients) for (const s of c.symbols) if ((name === 'crypto') === s.includes('/')) all.add(s);
  return new Set([...all].slice(0, MAX_SYMBOLS));
}

function dispatch(m) {
  const update = m.T === 't' ? { symbol: m.S, price: m.p, size: m.s, time: m.t } : m.T === 'q' ? { symbol: m.S, bid: m.bp, ask: m.ap, time: m.t } : { symbol: m.S, price: m.c, time: m.t };
  for (const c of clients) {
    if (!c.symbols.has(m.S)) continue;
    c.pending.set(m.S, { ...(c.pending.get(m.S) || {}), ...update });
    c.timer ||= setTimeout(() => flush(c), 500);
  }
}
function flush(c) {
  c.timer = null;
  if (!c.pending.size) return;
  c.res.write(`data: ${JSON.stringify([...c.pending.values()])}\n\n`);
  c.pending.clear();
}

// Express handler: GET /api/alpaca/stream?symbols=AAPL,BTC/USD
export function sseHandler(req, res) {
  const symbols = new Set(String(req.query.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.\-]{1,12}(\/[A-Z]{3,4})?$/.test(s)).slice(0, MAX_SYMBOLS));
  const uid = req.user?.id;
  if (uid && [...clients].filter(c => c.uid === uid).length >= 5) return res.status(429).json({ error: 'Too many live price streams open; close some tabs.' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ live: streamEnabled(), symbols: [...symbols] })}\n\n`);
  if (!streamEnabled()) return res.end();
  const c = { res, symbols, pending: new Map(), timer: null, uid };
  clients.add(c);
  feeds.stocks.sync(); feeds.crypto.sync();
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clearTimeout(c.timer); clients.delete(c); feeds.stocks.sync(); feeds.crypto.sync(); });
}
