// Market data sources. Quotes and daily history can come from several free providers; the owner
// picks in Admin → Market data which are on and how they are used:
//   fastest  - the provider with the lowest measured response time first, then the next ones
//   order    - the owner's own order
//   race     - the two fastest are asked at once and the first good answer wins (lowest latency,
//              twice the calls)
// Every provider is measured (latency and success) on each real call and by an hourly benchmark.
// Providers that need a free key are skipped until the key is in Admin → Keys.
import { siteGet, siteSet } from './site.js';

const T = (ms = 6000) => AbortSignal.timeout(ms);
const UA = { 'User-Agent': 'Mozilla/5.0 Brightolio' };
// Tests turn real network data off (FREE_DATA=off); DATA_SOURCES_TEST lets them use fake servers.
const offline = () => process.env.FREE_DATA === 'off' && !process.env.DATA_SOURCES_TEST;
const url = (name, dflt) => (process.env[name] || dflt).replace(/\/$/, '');
const num = v => (Number.isFinite(+v) && +v > 0 ? +v : null);
const day = t => new Date(t).toISOString().slice(0, 10);
async function json(u, o = {}) { const r = await fetch(u, { headers: UA, signal: T(o.timeout), ...o }); if (r.status === 404) throw Object.assign(new Error('not found'), { status: 404 }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function text(u) { const r = await fetch(u, { headers: UA, signal: T() }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
const stooqSym = s => (s.includes('=') || s.includes('^') ? s.toLowerCase() : `${s.toLowerCase().replace('.', '-')}.us`);

// name, key needed, where to get a free key, quote(symbol) → price, bars(symbol, start) → { closes, dates }
export const PROVIDERS = {
  alpaca: { name: 'Alpaca (IEX feed)', key: 'ALPACA_KEY_ID', signup: 'https://alpaca.markets', note: 'Real-time IEX quotes; also the user\'s own Alpaca key', builtIn: true },
  yahoo: {
    name: 'Yahoo Finance', key: null, note: 'No key; unofficial, can be slow or rate-limited',
    async quote(s) { const d = await json(`${url('YAHOO_URL', 'https://query1.finance.yahoo.com')}/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=1m`, { timeout: 5000 }); return num(d.chart?.result?.[0]?.meta?.regularMarketPrice); },
    async bars(s, start) {
      const d = await json(`${url('YAHOO_URL', 'https://query1.finance.yahoo.com')}/v8/finance/chart/${encodeURIComponent(s)}?period1=${Math.floor(Date.parse(start) / 1000)}&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=split,div`, { timeout: 8000 });
      const res = d.chart?.result?.[0], ts = res?.timestamp || [], adj = res?.indicators?.adjclose?.[0]?.adjclose || res?.indicators?.quote?.[0]?.close || [];
      const closes = [], dates = []; ts.forEach((t, i) => { if (adj[i] != null) { closes.push(+adj[i].toFixed(4)); dates.push(day(t * 1000)); } });
      return { closes, dates };
    },
  },
  stooq: {
    name: 'Stooq', key: null, note: 'No key; end-of-day and delayed quotes, very reliable',
    async quote(s) { const t = await text(`${url('STOOQ_URL', 'https://stooq.com')}/q/l/?s=${stooqSym(s)}&f=sd2t2c&h&e=csv`); const row = t.trim().split('\n')[1]?.split(','); return num(row?.[3]); },
    async bars(s, start) {
      const t = await text(`${url('STOOQ_URL', 'https://stooq.com')}/q/d/l/?s=${stooqSym(s)}&d1=${start.replace(/-/g, '')}&i=d`);
      const closes = [], dates = [];
      for (const line of t.trim().split('\n').slice(1)) { const c = line.split(','); if (c.length >= 5 && num(c[4])) { dates.push(c[0]); closes.push(+c[4]); } }
      return { closes, dates };
    },
  },
  finnhub: {
    name: 'Finnhub', key: 'FINNHUB_API_KEY', signup: 'https://finnhub.io/register', note: 'Free key: real-time US quotes, 60 calls a minute',
    async quote(s) { const d = await json(`${url('FINNHUB_API_URL', 'https://finnhub.io/api/v1')}/quote?symbol=${encodeURIComponent(s)}&token=${process.env.FINNHUB_API_KEY}`); return num(d.c); },
  },
  twelvedata: {
    name: 'Twelve Data', key: 'TWELVEDATA_API_KEY', signup: 'https://twelvedata.com/register', note: 'Free key: 800 calls a day, stocks, ETFs, funds, forex',
    async quote(s) { const d = await json(`${url('TWELVEDATA_URL', 'https://api.twelvedata.com')}/price?symbol=${encodeURIComponent(s)}&apikey=${process.env.TWELVEDATA_API_KEY}`); return num(d.price); },
    async bars(s, start) {
      const d = await json(`${url('TWELVEDATA_URL', 'https://api.twelvedata.com')}/time_series?symbol=${encodeURIComponent(s)}&interval=1day&start_date=${start}&outputsize=5000&order=ASC&apikey=${process.env.TWELVEDATA_API_KEY}`, { timeout: 10000 });
      const v = d.values || []; return { closes: v.map(x => +x.close), dates: v.map(x => x.datetime.slice(0, 10)) };
    },
  },
  tiingo: {
    name: 'Tiingo', key: 'TIINGO_API_KEY', signup: 'https://www.tiingo.com/account/api/token', note: 'Free key: IEX real-time and 30+ years of adjusted history',
    async quote(s) { const d = await json(`${url('TIINGO_URL', 'https://api.tiingo.com')}/iex/${encodeURIComponent(s)}?token=${process.env.TIINGO_API_KEY}`); return num(d?.[0]?.last ?? d?.[0]?.tngoLast); },
    async bars(s, start) { const d = await json(`${url('TIINGO_URL', 'https://api.tiingo.com')}/tiingo/daily/${encodeURIComponent(s)}/prices?startDate=${start}&token=${process.env.TIINGO_API_KEY}`, { timeout: 10000 }); return { closes: d.map(x => +x.adjClose), dates: d.map(x => x.date.slice(0, 10)) }; },
  },
  alphavantage: {
    name: 'Alpha Vantage', key: 'ALPHAVANTAGE_API_KEY', signup: 'https://www.alphavantage.co/support/#api-key', note: 'Free key: 25 calls a day (backup only)',
    async quote(s) { const d = await json(`${url('ALPHAVANTAGE_URL', 'https://www.alphavantage.co')}/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(s)}&apikey=${process.env.ALPHAVANTAGE_API_KEY}`); return num(d['Global Quote']?.['05. price']); },
  },
  fmp: {
    name: 'Financial Modeling Prep', key: 'FMP_API_KEY', signup: 'https://site.financialmodelingprep.com/developer/docs', note: 'Free key: 250 calls a day; also company profiles and fundamentals',
    async quote(s) { const d = await json(`${url('FMP_URL', 'https://financialmodelingprep.com')}/stable/quote-short?symbol=${encodeURIComponent(s)}&apikey=${process.env.FMP_API_KEY}`); return num(d?.[0]?.price); },
  },
  polygon: {
    name: 'Polygon.io (Massive)', key: 'POLYGON_API_KEY', signup: 'https://polygon.io/dashboard/signup', note: 'Free key: previous close and history (5 calls a minute)',
    async quote(s) { const d = await json(`${url('POLYGON_URL', 'https://api.polygon.io')}/v2/aggs/ticker/${encodeURIComponent(s)}/prev?adjusted=true&apiKey=${process.env.POLYGON_API_KEY}`); return num(d.results?.[0]?.c); },
    async bars(s, start) { const d = await json(`${url('POLYGON_URL', 'https://api.polygon.io')}/v2/aggs/ticker/${encodeURIComponent(s)}/range/1/day/${start}/${day(Date.now())}?adjusted=true&sort=asc&limit=50000&apiKey=${process.env.POLYGON_API_KEY}`, { timeout: 10000 }); const r = d.results || []; return { closes: r.map(x => x.c), dates: r.map(x => day(x.t)) }; },
  },
};
export const MODES = { fastest: 'Fastest first (measured)', order: 'My order', race: 'Race the two fastest (lowest latency)' };

// The Alpaca provider is filled in by brokers.js (it needs the user's or platform's key).
let alpacaImpl = null;
export function registerAlpaca(impl) { alpacaImpl = impl; }

// ---------- settings and measurements ----------
const DEFAULT = { mode: 'fastest', order: Object.keys(PROVIDERS), off: [] };
export const settings = () => { const s = { ...DEFAULT, ...(siteGet('dataSources', {}) || {}) }; s.order = [...new Set([...s.order.filter(k => PROVIDERS[k]), ...Object.keys(PROVIDERS)])]; return s; };
export async function saveSettings(b = {}) {
  const cur = settings();
  const next = { mode: MODES[b.mode] ? b.mode : cur.mode, order: Array.isArray(b.order) ? b.order.filter(k => PROVIDERS[k]) : cur.order, off: Array.isArray(b.off) ? b.off.filter(k => PROVIDERS[k]) : cur.off };
  await siteSet('dataSources', next);
  return settings();
}
const stats = new Map(); // provider → { ms: [...], ok, fail, lastError, at }
function record(k, ms, ok, err) {
  const s = stats.get(k) || { ms: [], ok: 0, fail: 0, lastError: null, at: 0 };
  if (ok) { s.ms.push(ms); if (s.ms.length > 30) s.ms.shift(); s.ok++; } else { s.fail++; s.lastError = String(err?.message || err).slice(0, 120); }
  s.at = Date.now(); stats.set(k, s);
}
const median = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
export const latency = k => median(stats.get(k)?.ms || []);
const configured = k => { const p = PROVIDERS[k]; if (k === 'alpaca') return !!alpacaImpl?.enabled?.(); return !p.key || !!process.env[p.key]; };
export const usable = (k, kind) => !settings().off.includes(k) && configured(k) && (k === 'alpaca' ? !!alpacaImpl?.[kind] : typeof PROVIDERS[k][kind] === 'function') && (k === 'alpaca' || !offline());

// Providers in the order they will be tried for quotes or bars.
export function plan(kind = 'quote') {
  const s = settings(), list = s.order.filter(k => usable(k, kind));
  if (s.mode === 'order') return list;
  // Unmeasured providers sort after measured ones, keeping the owner's order among themselves.
  const rank = k => { const m = latency(k), st = stats.get(k), bad = st && st.fail > st.ok * 2 && st.fail > 2; return (bad ? 1e6 : 0) + (m ?? 5e5); };
  return [...list].sort((a, b) => rank(a) - rank(b) || list.indexOf(a) - list.indexOf(b));
}
async function call(k, kind, ...args) {
  const t0 = Date.now();
  try {
    const v = await (k === 'alpaca' ? alpacaImpl[kind] : PROVIDERS[k][kind])(...args);
    const good = kind === 'quote' ? num(v) : v && v.closes?.length;
    record(k, Date.now() - t0, !!good, good ? null : 'empty answer');
    return good ? v : null;
  } catch (e) { record(k, Date.now() - t0, false, e); return e.status === 404 ? NOT_FOUND : null; }
}
// A source that does not know the symbol is skipped; it is unknown only if every source says so.
const NOT_FOUND = Symbol('not found');
const unknown = () => Object.assign(new Error('not found'), { status: 404 });

// The latest price from the configured sources, with which one answered.
// How fresh each source's prices are, so every price on screen can say so plainly.
//   realtime      consolidated or exchange prices as they trade
//   realtime-iex  real time, but from the IEX exchange only (a few % of US volume)
//   delayed       up to about 15 minutes late
//   close         the previous day's close
export const FRESH = { alpaca: () => ((process.env.ALPACA_STOCK_FEED || 'iex') === 'sip' ? 'realtime' : 'realtime-iex'), yahoo: 'delayed', stooq: 'delayed', finnhub: 'realtime', twelvedata: 'delayed', tiingo: 'realtime-iex', alphavantage: 'delayed', fmp: 'delayed', polygon: 'close' };
const FRESH_LABEL = { realtime: 'Real-time', 'realtime-iex': 'Real-time (IEX)', delayed: 'Delayed up to 15 min', close: 'Previous close', closed: 'Market closed: last price', unknown: 'Last known price' };
export function freshness(id, marketOpen = true) {
  const f = typeof FRESH[id] === 'function' ? FRESH[id]() : FRESH[id] || 'unknown';
  const level = !marketOpen && f !== 'close' ? 'closed' : f;
  return { level, label: FRESH_LABEL[level] };
}
export const FRESH_LABELS = FRESH_LABEL;
export async function quote(symbol, userId) {
  const s = settings(), list = plan('quote');
  if (s.mode === 'race' && list.length > 1) {
    const [a, b] = list;
    let nf = 0;
    const first = await new Promise(res => { let n = 0; for (const k of [a, b]) call(k, 'quote', symbol, userId).then(v => { if (v === NOT_FOUND) nf++; if (v && v !== NOT_FOUND) res({ price: v, source: k }); else if (++n === 2) res(null); }).catch(() => { if (++n === 2) res(null); }); });
    if (first) return first;
    for (const k of list.slice(2)) { const v = await call(k, 'quote', symbol, userId).catch(() => null); if (v === NOT_FOUND) nf++; else if (v) return { price: v, source: k }; }
    if (nf && nf === list.length) throw unknown();
    return null;
  }
  let nf = 0;
  for (const k of list) { const v = await call(k, 'quote', symbol, userId); if (v === NOT_FOUND) nf++; else if (v) return { price: v, source: k }; }
  if (nf && nf === list.length) throw unknown();
  return null;
}
export async function bars(symbol, start, userId) {
  const list = plan('bars'); let nf = 0;
  for (const k of list) { const v = await call(k, 'bars', symbol, start, userId); if (v === NOT_FOUND) nf++; else if (v?.closes?.length) return { ...v, source: k }; }
  if (nf && nf === list.length) throw unknown();
  return null;
}

// Benchmark: one quote from every usable provider (hourly job and the admin "Test now" button).
export async function benchmark(symbol = 'SPY') {
  const out = [];
  for (const k of Object.keys(PROVIDERS)) {
    if (!usable(k, 'quote')) { out.push({ id: k, skipped: settings().off.includes(k) ? 'off' : !configured(k) ? 'needs key' : 'offline' }); continue; }
    const t0 = Date.now(), v = await call(k, 'quote', symbol, null).catch(() => null), ok = !!v && v !== NOT_FOUND;
    out.push({ id: k, ms: Date.now() - t0, price: ok ? v : null, ok });
  }
  return out;
}
export function report() {
  const s = settings(), order = plan('quote');
  return {
    mode: s.mode, modes: MODES, order: s.order, off: s.off, active: order,
    providers: Object.entries(PROVIDERS).map(([id, p]) => {
      const st = stats.get(id) || { ms: [], ok: 0, fail: 0 };
      return { id, name: p.name, note: p.note, key: p.key, signup: p.signup || null, configured: configured(id), on: !s.off.includes(id), quotes: id === 'alpaca' || !!p.quote, history: id === 'alpaca' || !!p.bars,
        latencyMs: latency(id), ok: st.ok, fail: st.fail, lastError: st.lastError || null, rank: order.indexOf(id) };
    }),
  };
}
export const _reset = () => stats.clear();
