// Market events: earnings dates and results, IPOs, and a stock's performance over a week, a month and
// a year. Earnings and IPOs come from Finnhub (FINNHUB_API_KEY, free tier); performance from the app's
// own daily prices. Results are cached for an hour so texts and the calendar stay fast and cheap.
import { getBars, lastPrice } from './brokers.js';

const cache = new Map(); // key -> { at, v }
const HOUR = 3600e3;
const env = k => process.env[k] || '';
export const eventsEnabled = () => !!env('FINNHUB_API_KEY');
const day = t => new Date(t).toISOString().slice(0, 10);

async function finnhub(path, query = {}) {
  if (!eventsEnabled()) throw Object.assign(new Error('Earnings and IPO data need FINNHUB_API_KEY (free at finnhub.io) in Admin → Keys'), { status: 503, setup: true });
  const key = path + JSON.stringify(query), hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.v;
  const url = new URL((env('FINNHUB_API_URL') || 'https://finnhub.io/api/v1') + path);
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { 'X-Finnhub-Token': env('FINNHUB_API_KEY') }, signal: AbortSignal.timeout(12000) });
  if (r.status === 429) throw Object.assign(new Error('The earnings data service is busy; try again in a minute'), { status: 429 });
  if (!r.ok) throw Object.assign(new Error(`Earnings data service answered ${r.status}`), { status: 502 });
  const v = await r.json();
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), v });
  return v;
}

const HOURS = { bmo: 'before the open', amc: 'after the close', dmh: 'during market hours' };
// Next earnings date (with estimates) and the last four reported quarters.
export async function earnings(symbol) {
  const today = Date.now();
  const [cal, hist] = await Promise.all([
    finnhub('/calendar/earnings', { symbol, from: day(today - 2 * 86400e3), to: day(today + 120 * 86400e3) }),
    finnhub('/stock/earnings', { symbol, limit: 4 }),
  ]);
  const upcoming = (cal.earningsCalendar || []).filter(e => e.date >= day(today - 86400e3)).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  return {
    symbol,
    next: upcoming && { date: upcoming.date, when: HOURS[upcoming.hour] || '', quarter: upcoming.quarter, year: upcoming.year, epsEstimate: upcoming.epsEstimate, revenueEstimate: upcoming.revenueEstimate },
    history: (Array.isArray(hist) ? hist : []).slice(0, 4).map(h => ({ period: h.period, quarter: h.quarter, year: h.year, eps: h.actual, estimate: h.estimate, surprisePct: h.surprisePercent })),
  };
}

export async function ipos(from, to) {
  const d = await finnhub('/calendar/ipo', { from, to });
  return (d.ipoCalendar || []).map(i => ({ date: i.date, symbol: i.symbol || '', name: i.name, exchange: i.exchange || '', price: i.price || '', shares: i.numberOfShares || null, value: i.totalSharesValue || null, status: i.status || '' }));
}
export async function earningsCalendar(from, to, symbols = null) {
  const d = await finnhub('/calendar/earnings', { from, to });
  const want = symbols && new Set(symbols);
  return (d.earningsCalendar || []).filter(e => !want || want.has(e.symbol)).map(e => ({ date: e.date, symbol: e.symbol, when: HOURS[e.hour] || '', epsEstimate: e.epsEstimate, quarter: e.quarter }));
}

// Change over 1 week, 1 month and 1 year from daily closes, with today's price.
export async function performance(symbol, userId) {
  const b = await getBars(symbol, day(Date.now() - 400 * 86400e3), userId);
  if (!b?.closes?.length) throw Object.assign(new Error(`No price history for ${symbol}`), { status: 404 });
  const px = await lastPrice(symbol, userId).catch(() => b.closes[b.closes.length - 1]);
  // Measured back from the latest daily close (data can end before today).
  const end = Math.min(Date.now(), Date.parse(b.dates[b.dates.length - 1] + 'T21:00:00Z') || Date.now());
  const at = days => { const target = day(end - days * 86400e3); let i = b.dates.length - 1; while (i > 0 && b.dates[i] > target) i--; return b.closes[i]; };
  const chg = base => (base ? (px / base - 1) * 100 : null);
  const yr = b.closes.slice(-252);
  return { symbol, price: px, week: chg(at(7)), month: chg(at(30)), year: chg(at(365)), high52: Math.max(...yr), low52: Math.min(...yr), source: b.source };
}

const pct = x => (x == null || !Number.isFinite(x) ? 'n/a' : `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`);
const usd = x => '$' + (+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const big = x => (x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(0)}M` : usd(x));
// Short replies for text messages.
export const chartText = p => `${p.symbol} ${usd(p.price)}\n1 week ${pct(p.week)} | 1 month ${pct(p.month)} | 1 year ${pct(p.year)}\n52-week range ${usd(p.low52)} - ${usd(p.high52)}${p.source === 'synthetic' ? '\n(simulated prices)' : ''}`;
export function earningsText(e) {
  const lines = [`${e.symbol} earnings`];
  if (e.next) {
    const d = new Date(e.next.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    lines.push(`Next: ${d}${e.next.when ? ', ' + e.next.when : ''}${e.next.quarter ? ` (Q${e.next.quarter} ${e.next.year})` : ''}`);
    if (e.next.epsEstimate != null) lines.push(`EPS estimate ${usd(e.next.epsEstimate)}${e.next.revenueEstimate ? `, revenue estimate ${big(e.next.revenueEstimate)}` : ''}`);
  } else lines.push('No earnings date announced in the next 4 months.');
  const h = e.history.filter(x => x.eps != null);
  if (h.length) lines.push('Last quarters: ' + h.slice(0, 4).map(x => `Q${x.quarter} ${usd(x.eps)}${x.surprisePct != null ? ` (${pct(x.surprisePct)} vs est.)` : ''}`).join('; '));
  return lines.join('\n');
}

// ---------- API: a month of events for the calendar ----------
import express from 'express';
import { requireUser } from './auth.js';
import { accountSummary } from './brokers.js';
import { tradingForAccount } from './alpaca/connections.js';

// Earnings shown for the user's holdings and the best-known large companies.
const WELL_KNOWN = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V', 'WMT', 'COST', 'NFLX', 'AMD'];
export const eventsRouter = express.Router();
eventsRouter.use(requireUser);
eventsRouter.get('/month', async (req, res) => {
  const ym = /^\d{4}-\d{2}$/.test(req.query.ym || '') ? req.query.ym : new Date().toISOString().slice(0, 7);
  const from = `${ym}-01`, to = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
  const held = new Set();
  for (const a of ['paper', 'alpaca']) (await accountSummary(req.user.id, a).catch(() => ({ positions: [] }))).positions.forEach(p => held.add(p.symbol));
  const symbols = [...new Set([...held, ...WELL_KNOWN])];
  const out = { ym, from, to, enabled: eventsEnabled(), held: [...held], ipos: [], earnings: [], tradingDays: null, actions: [] };
  if (out.enabled) {
    const [i, e] = await Promise.allSettled([ipos(from, to), earningsCalendar(from, to, symbols)]);
    if (i.status === 'fulfilled') out.ipos = i.value; else out.error = i.reason.message;
    if (e.status === 'fulfilled') out.earnings = e.value; else out.error ||= e.reason.message;
  }
  // With an Alpaca connection: trading days (holidays, early closes) and dividends/splits.
  const t = await tradingForAccount(req.user.id, 'alpaca').catch(() => null);
  if (t) {
    out.tradingDays = await t.calendar({ start: from, end: to }).catch(() => null);
    const ann = await t.announcements({ ca_types: 'Dividend,Split,Merger,Spinoff', since: from, until: to, date_type: 'ex' }).catch(() => []);
    out.actions = (Array.isArray(ann) ? ann : []).map(a => ({ date: a.ex_date, symbol: a.initiating_symbol || a.target_symbol || '', type: a.ca_type, detail: a.cash ? `$${a.cash}/sh` : a.new_rate && a.old_rate ? `${a.new_rate}:${a.old_rate}` : '' })).filter(a => a.date);
  }
  res.json(out);
});
