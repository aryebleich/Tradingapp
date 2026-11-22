// Rates vs stocks (Research → Research & news → Rates vs stocks): the Fed funds rate, the 2-year
// and 10-year Treasury yields and the yield curve (10y − 2y) from FRED, against the S&P 500 and three
// sectors that react to rates differently: technology (growth), utilities (dividend payers) and
// financials (banks). Also the next scheduled Fed meeting. Everything cached; FRED or prices missing
// is said on the page. Education only, not a forecast.
import express from 'express';
import { requireUser } from './auth.js';
import { getBars } from './brokers.js';

const r2 = (x, d = 2) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d));
const DAY = 864e5;
// The Federal Reserve's published 2026 FOMC calendar (second day of each meeting, when the decision
// is announced). Later years are shown as not yet published.
export const FOMC_2026 = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];
export function nextFomc(t = Date.now(), dates = FOMC_2026) {
  const today = new Date(t).toISOString().slice(0, 10);
  const next = dates.find(d => d >= today);
  return next ? { date: next, days: Math.round((Date.parse(next) - Date.parse(today)) / DAY), source: 'Federal Reserve FOMC calendar' } : { date: null, note: 'The Fed has not published its next calendar here yet; see federalreserve.gov.' };
}
// Month-end values from a daily series [[date, value], ...].
export function monthly(points) {
  const by = {}; for (const [d, v] of points) if (v != null && isFinite(v)) by[d.slice(0, 7)] = [d, v];
  return Object.keys(by).sort().map(k => by[k]);
}
// The curve: 10-year minus 2-year, by date both exist. Inverted when below zero.
export function curve(ten, two) {
  const m = new Map(two); return ten.filter(([d]) => m.has(d)).map(([d, v]) => [d, r2(v - m.get(d))]);
}
// Correlation of monthly changes: rate change (percentage points) against an asset's monthly return.
export function correlation(rate, prices) {
  const p = new Map(prices.map(([d, v]) => [d.slice(0, 7), v])), r = new Map(rate.map(([d, v]) => [d.slice(0, 7), v]));
  const months = [...r.keys()].filter(k => p.has(k)).sort(), xs = [], ys = [];
  for (let i = 1; i < months.length; i++) { xs.push(r.get(months[i]) - r.get(months[i - 1])); ys.push(p.get(months[i]) / p.get(months[i - 1]) - 1); }
  if (xs.length < 12) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? r2(sxy / Math.sqrt(sxx * syy), 2) : null;
}
export const SECTORS = [['SPY', 'S&P 500', 'The whole market.'], ['XLK', 'Technology (growth)', 'Growth companies are valued on profits far in the future; higher rates make those future profits worth less today, so they often fall when yields jump.'],
  ['XLU', 'Utilities (dividend payers)', 'Steady dividend payers compete with bonds for income; when bond yields rise, their dividends look less special, so they often lag.'],
  ['XLF', 'Financials (banks)', 'Banks earn the gap between what they pay on deposits and charge on loans; a steeper curve (long rates above short) usually helps them, an inverted one hurts.']];
export const EXPLAIN = ['When the Fed raises its rate, borrowing costs rise across the economy, and the 2-year yield usually moves first.', 'The 10-year yield reflects growth and inflation expected over years; it sets mortgage rates and the discount rate used to value stocks.', 'An inverted curve (2-year above 10-year) has come before several recessions, but not on a fixed timetable, and not every inversion was followed by one.', 'These are tendencies over many years, not rules: in any month, earnings, news and sentiment can matter more than rates.'];

async function fred(ids, years = 6) {
  if (process.env.FREE_DATA === 'off' && !process.env.FRED_URL) return null;
  const base = (process.env.FRED_URL || 'https://fred.stlouisfed.org').replace(/\/$/, ''), start = new Date(Date.now() - years * 365 * DAY).toISOString().slice(0, 10);
  const txt = await fetch(`${base}/graph/fredgraph.csv?id=${ids.join(',')}&cosd=${start}`, { headers: { 'User-Agent': 'Mozilla/5.0 Brightolio' }, signal: AbortSignal.timeout(15000) }).then(r => (r.ok ? r.text() : '')).catch(() => '');
  const lines = txt.trim().split('\n'), head = (lines[0] || '').split(','), out = {};
  for (let c = 1; c < head.length; c++) { const id = head[c].trim(), pts = []; for (const l of lines.slice(1)) { const p = l.split(','); if (p[c] && p[c] !== '.' && !isNaN(+p[c])) pts.push([p[0], +p[c]]); } if (pts.length) out[id] = pts; }
  return Object.keys(out).length ? out : null;
}
let cache = null;
export async function ratesVsStocks(userId) {
  if (cache && Date.now() - cache.at < 12 * 3600e3) return cache.v;
  const f = await fred(['DFF', 'DGS2', 'DGS10']).catch(() => null);
  const start = new Date(Date.now() - 6 * 365 * DAY).toISOString().slice(0, 10);
  const prices = {}; await Promise.all(SECTORS.map(async ([s]) => { const b = await getBars(s, start, userId).catch(() => null); if (b) prices[s] = monthly(b.closes.map((c, i) => [b.dates[i], c])); }));
  const m = f ? { fed: monthly(f.DFF || []), two: monthly(f.DGS2 || []), ten: monthly(f.DGS10 || []) } : null;
  const v = {
    available: !!m, note: m ? 'Rates: Federal Reserve Bank of St. Louis (FRED), month-end values. Prices: month-end closes.' : 'Rate history from FRED is not reachable right now; the explanations and the Fed calendar still apply.',
    rates: m, curve: m ? curve(m.ten, m.two) : null, latest: m ? { fed: m.fed.at(-1), two: m.two.at(-1), ten: m.ten.at(-1), curve: m.ten.length && m.two.length ? r2(m.ten.at(-1)[1] - m.two.at(-1)[1]) : null } : null,
    sectors: SECTORS.map(([s, name, why]) => ({ symbol: s, name, why, prices: prices[s] || null, corr10y: m && prices[s] ? correlation(m.ten, prices[s]) : null })),
    fomc: nextFomc(), explain: EXPLAIN, at: Date.now(),
  };
  if (m) cache = { at: Date.now(), v };
  return v;
}
export const ratesRouter = (() => { const r = express.Router(); r.use(requireUser); r.get('/', async (req, res) => res.json(await ratesVsStocks(req.user.id))); return r; })();
