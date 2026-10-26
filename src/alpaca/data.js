// Market Data API: stock and crypto bars/quotes/trades, snapshots, screeners, news, option
// chains (with Greeks and IV) and corporate actions. Uses the platform data key (header auth)
// or, when only Broker API keys are configured, the data sandbox with Basic auth.
import { URLS, request, paged } from './http.js';
import { brokerEnabled, brokerAuth } from './broker.js';

export function dataSource() {
  if (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET) return { base: URLS.data(), auth: { keys: [process.env.ALPACA_KEY_ID, process.env.ALPACA_SECRET] } };
  if (brokerEnabled()) return { base: URLS.dataSandbox(), auth: brokerAuth() };
  return null;
}
export const dataEnabled = () => !!dataSource();
const src = () => {
  const s = dataSource();
  if (!s) throw Object.assign(new Error('Market data is not configured (set ALPACA_KEY_ID / ALPACA_SECRET or Broker API keys).'), { status: 503 });
  return s;
};
const get = (path, query) => { const s = src(); return request(s.base, path, { auth: s.auth, query }); };
const getPaged = (path, query, key, maxPages) => { const s = src(); return paged(s.base, path, { auth: s.auth, query }, key, maxPages); };

const feed = () => process.env.ALPACA_STOCK_FEED || 'iex';
export const isCrypto = s => s.includes('/');
const list = symbols => (Array.isArray(symbols) ? symbols : String(symbols || '').split(',')).map(s => s.trim().toUpperCase()).filter(Boolean);
const split = syms => ({ stocks: syms.filter(s => !isCrypto(s)), crypto: syms.filter(isCrypto) });

export const TIMEFRAMES = ['1Min', '5Min', '15Min', '30Min', '1Hour', '4Hour', '1Day', '1Week', '1Month'];

// OHLCV bars for any mix of stock and crypto symbols, keyed by symbol.
export async function bars(symbols, { timeframe = '1Day', start, end, limit = 1000 } = {}) {
  if (!TIMEFRAMES.includes(timeframe)) throw Object.assign(new Error('Unknown timeframe'), { status: 400 });
  const { stocks, crypto } = split(list(symbols)), out = {};
  const q = { timeframe, start, end, limit: Math.min(+limit || 1000, 10000) };
  if (stocks.length) Object.assign(out, await getPaged('/v2/stocks/bars', { ...q, symbols: stocks, adjustment: 'all', feed: feed() }, 'bars', 5));
  if (crypto.length) Object.assign(out, await getPaged('/v1beta3/crypto/us/bars', { ...q, symbols: crypto }, 'bars', 5));
  return out;
}

// Latest quote and trade per symbol.
export async function latest(symbols) {
  const { stocks, crypto } = split(list(symbols)), out = {};
  const put = (sym, k, v) => { (out[sym] ||= {})[k] = v; };
  await Promise.all([
    stocks.length && get('/v2/stocks/quotes/latest', { symbols: stocks, feed: feed() }).then(d => Object.entries(d.quotes || {}).forEach(([s, q]) => put(s, 'quote', q))),
    stocks.length && get('/v2/stocks/trades/latest', { symbols: stocks, feed: feed() }).then(d => Object.entries(d.trades || {}).forEach(([s, t]) => put(s, 'trade', t))),
    crypto.length && get('/v1beta3/crypto/us/latest/quotes', { symbols: crypto }).then(d => Object.entries(d.quotes || {}).forEach(([s, q]) => put(s, 'quote', q))),
    crypto.length && get('/v1beta3/crypto/us/latest/trades', { symbols: crypto }).then(d => Object.entries(d.trades || {}).forEach(([s, t]) => put(s, 'trade', t))),
  ]);
  return out;
}

// Snapshot = latest trade + quote + minute bar + daily bar + previous daily bar.
export async function snapshots(symbols) {
  const { stocks, crypto } = split(list(symbols)), out = {};
  if (stocks.length) Object.assign(out, await get('/v2/stocks/snapshots', { symbols: stocks, feed: feed() }));
  if (crypto.length) Object.assign(out, (await get('/v1beta3/crypto/us/snapshots', { symbols: crypto })).snapshots || {});
  for (const s of Object.values(out)) {
    const last = s?.latestTrade?.p ?? s?.dailyBar?.c, prev = s?.prevDailyBar?.c;
    if (s && last != null && prev) { s.change = last - prev; s.changePct = (last / prev - 1) * 100; s.price = last; }
  }
  return out;
}

export const mostActives = (by = 'volume', top = 20) => get('/v1beta1/screener/stocks/most-actives', { by: by === 'trades' ? 'trades' : 'volume', top: Math.min(+top || 20, 100) });
export const movers = (market = 'stocks', top = 10) => get(`/v1beta1/screener/${market === 'crypto' ? 'crypto' : 'stocks'}/movers`, { top: Math.min(+top || 10, 50) });

export async function news({ symbols, limit = 20, start, end } = {}) {
  const d = await get('/v1beta1/news', { symbols: list(symbols), limit: Math.min(+limit || 20, 50), start, end, sort: 'desc', include_content: false });
  return d.news || [];
}

// Level II for crypto: the latest order book (bids and asks with sizes). US stock depth is not part
// of Alpaca's data, so stocks show the best bid and ask only.
export async function orderbook(symbol) {
  const d = await get('/v1beta3/crypto/us/latest/orderbooks', { symbols: symbol });
  const b = d.orderbooks?.[symbol];
  return b ? { symbol, at: b.t, bids: (b.b || []).slice(0, 25).map(x => ({ price: x.p, size: x.s })), asks: (b.a || []).slice(0, 25).map(x => ({ price: x.p, size: x.s })) } : { symbol, bids: [], asks: [] };
}

// Option chain for an underlying: one row per contract with quote, Greeks and implied volatility.
export async function optionChain(underlying, { expiration, type, strikeMin, strikeMax } = {}) {
  const q = { feed: process.env.ALPACA_OPTIONS_FEED || 'indicative', limit: 1000, type, strike_price_gte: strikeMin, strike_price_lte: strikeMax };
  if (expiration) q.expiration_date = expiration;
  else { q.expiration_date_gte = new Date().toISOString().slice(0, 10); q.expiration_date_lte = new Date(Date.now() + 75 * 86400e3).toISOString().slice(0, 10); }
  const snaps = await getPaged(`/v1beta1/options/snapshots/${encodeURIComponent(String(underlying).toUpperCase())}`, q, 'snapshots', 5);
  const rows = Object.entries(snaps).map(([symbol, s]) => {
    const p = parseOcc(symbol);
    return p && { symbol, ...p, bid: s.latestQuote?.bp, ask: s.latestQuote?.ap, last: s.latestTrade?.p, iv: s.impliedVolatility, greeks: s.greeks || null, volume: s.dailyBar?.v, openInterest: s.openInterest };
  }).filter(Boolean);
  rows.sort((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike || a.type.localeCompare(b.type));
  return { underlying: String(underlying).toUpperCase(), expirations: [...new Set(rows.map(r => r.expiration))], contracts: rows };
}

// OCC symbol: ROOT + YYMMDD + C/P + strike*1000 (8 digits).
export function parseOcc(sym) {
  const m = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(sym);
  if (!m) return null;
  return { root: m[1], expiration: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] === 'C' ? 'call' : 'put', strike: +m[6] / 1000 };
}

export const corporateActions = ({ symbols, types, start, end, limit = 100 } = {}) =>
  get('/v1/corporate-actions', { symbols: list(symbols), types, start, end, limit: Math.min(+limit || 100, 1000) }).then(d => d.corporate_actions || {});

// ---------- bonds and Treasuries (Fixed Income Data API, beta), by ISIN ----------
const isins = v => list(v).filter(x => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(x)).slice(0, 50);
export async function fixedIncome(ids) {
  const want = isins(ids);
  if (!want.length) throw Object.assign(new Error('Enter one or more ISINs, e.g. US912797KJ59'), { status: 400 });
  const [p, q] = await Promise.all([get('/v1beta1/fixed_income/latest/prices', { isins: want }).catch(() => ({})), get('/v1beta1/fixed_income/latest/quotes', { isins: want }).catch(() => ({}))]);
  return want.map(isin => ({ isin, price: p.prices?.[isin] || null, quote: q.quotes?.[isin] || null }));
}

// ---------- crypto from several liquidity sources (v1beta3) ----------
// us: Alpaca US · us-1: Kraken US · eu-1: Kraken EU
export const CRYPTO_LOCATIONS = { us: 'Alpaca US', 'us-1': 'Kraken US', 'eu-1': 'Kraken EU' };
export async function cryptoQuotes(symbols, locations = Object.keys(CRYPTO_LOCATIONS)) {
  const syms = list(symbols).filter(isCrypto).slice(0, 20);
  if (!syms.length) throw Object.assign(new Error('Enter crypto pairs such as BTC/USD'), { status: 400 });
  const out = {};
  await Promise.all(locations.filter(l => CRYPTO_LOCATIONS[l]).map(async l => {
    const d = await get(`/v1beta3/crypto/${l}/latest/quotes`, { symbols: syms }).catch(() => ({}));
    for (const [s, q] of Object.entries(d.quotes || {})) (out[s] ||= {})[l] = q;
  }));
  return syms.map(s => ({ symbol: s, venues: Object.entries(out[s] || {}).map(([loc, q]) => ({ location: loc, name: CRYPTO_LOCATIONS[loc], bid: q.bp, ask: q.ap, bidSize: q.bs, askSize: q.as, at: q.t })) }));
}
