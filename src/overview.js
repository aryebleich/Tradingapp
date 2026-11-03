// Market overview (works with any data source, not only Alpaca): the session, indexes, sectors
// and crypto with the day's change, the user's own watchlist, and for every price where it came
// from and whether it is real-time, delayed or the last close.
import express from 'express';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { validSymbol } from './brokers.js';
import * as DS from './datasources.js';
import { session } from './desk.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
export const INDEXES = [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq-100'], ['DIA', 'Dow 30'], ['IWM', 'Small caps'], ['TLT', 'Long bonds'], ['GLD', 'Gold']];
export const SECTORS = [['XLK', 'Technology'], ['XLC', 'Communication'], ['XLY', 'Consumer discretionary'], ['XLP', 'Consumer staples'], ['XLV', 'Health care'], ['XLF', 'Financials'], ['XLI', 'Industrials'], ['XLE', 'Energy'], ['XLB', 'Materials'], ['XLU', 'Utilities'], ['XLRE', 'Real estate']];
export const CRYPTO = [['BTC/USD', 'Bitcoin'], ['ETH/USD', 'Ether']];
const cache = new Map(); // symbol -> { at, row }
const day = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// One symbol: live price, previous close, change, source and freshness (cached 30 seconds).
export async function row(symbol, userId) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 30e3) return hit.row;
  const sess = session(), crypto = symbol.includes('/');
  let q = null, b = null;
  try { [q, b] = await Promise.all([DS.quote(symbol, userId).catch(e => (e.status === 404 ? { missing: true } : null)), DS.bars(symbol, day(Date.now() - 14 * 864e5), userId).catch(() => null)]); } catch {}
  if (q?.missing) return { symbol, error: 'Unknown symbol' };
  const closes = b?.closes || [], dates = b?.dates || [], today = day(Date.now());
  // The previous close: yesterday's bar when today's is already in the history.
  const prevClose = closes.length ? (dates.at(-1) === today && closes.length > 1 ? closes.at(-2) : closes.at(-1)) : null;
  const price = q?.price ?? closes.at(-1) ?? null;
  const fresh = q?.source ? DS.freshness(q.source, sess.open || crypto) : { level: 'close', label: 'Previous close' };
  const r = { symbol, price, prevClose, change: price && prevClose ? price - prevClose : null, changePct: price && prevClose ? (price / prevClose - 1) * 100 : null,
    source: q?.source ? DS.PROVIDERS[q.source]?.name || q.source : b?.source ? DS.PROVIDERS[b.source]?.name || b.source : null, freshness: fresh };
  cache.set(symbol, { at: Date.now(), row: r });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return r;
}
export async function rows(symbols, userId) {
  const out = [];
  for (let i = 0; i < symbols.length; i += 6) out.push(...await Promise.all(symbols.slice(i, i + 6).map(s => row(s, userId).catch(() => ({ symbol: s, error: 'No data' })))));
  return out;
}
const named = (list, data) => list.map(([s, name]) => ({ name, ...(data.find(d => d.symbol === s) || { symbol: s }) }));

export const overviewRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const watch = await getSetting(req.user.id, 'marketWatch', ['AAPL', 'MSFT', 'NVDA']) || [];
    const syms = [...new Set([...INDEXES, ...SECTORS, ...CRYPTO].map(x => x[0]).concat(watch))];
    const data = await rows(syms, req.user.id);
    const sectors = named(SECTORS, data).sort((a, b) => (b.changePct ?? -1e9) - (a.changePct ?? -1e9));
    res.json({ session: session(), indexes: named(INDEXES, data), sectors, crypto: named(CRYPTO, data), watch: watch.map(s => data.find(d => d.symbol === s) || { symbol: s }),
      labels: { realtime: 'Real-time: prices as they trade', 'realtime-iex': 'Real-time from the IEX exchange only (a small share of trading)', delayed: 'Up to about 15 minutes late', close: 'The previous day\'s closing price', closed: 'The market is closed: the last price before the close' } });
  });
  r.get('/quotes', async (req, res) => {
    const syms = [...new Set(String(req.query.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 30);
    res.json(await rows(syms, req.user.id));
  });
  r.put('/watch', async (req, res) => {
    const list = [...new Set((Array.isArray(req.body?.symbols) ? req.body.symbols : String(req.body?.symbols || '').split(/[\s,]+/)).map(s => String(s).trim().toUpperCase()).filter(Boolean))];
    if (list.length > 30) throw bad('Up to 30 symbols');
    const wrong = list.find(s => !validSymbol(s) && !/^[A-Z0-9]{2,10}\/[A-Z]{3,4}$/.test(s));
    if (wrong) throw bad(`"${wrong}" is not a valid symbol`);
    await setSetting(req.user.id, 'marketWatch', list);
    res.json({ symbols: list });
  });
  return r;
})();
