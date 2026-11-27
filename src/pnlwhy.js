// Home → "Why your P/L moved today": the AI reads the user's positions, today's move of each one,
// the market and sector funds, and the news on each holding, and names the factors behind today's
// profit or loss. The numbers come from a simple attribution done here (market, sector, the stock
// itself), so the AI explains them and cannot invent them; with no AI set up, the same factors are
// written in plain words.
//
// The owner runs it (Admin → AI & privacy → AI P/L analysis on Home): on or off, how often it
// refreshes on each plan, and the credits for refreshing sooner.
import express from 'express';
import { one, run } from './db.js';
import { requireUser } from './auth.js';
import { siteGet, siteSet } from './site.js';
import { aiPlanKey } from './aiplans.js';
import { evidence } from './ai-evidence.js';

export const DEFAULTS = { on: true, every: { free: 1440, pro: 240, elite: 60, ultimate: 15 } };
// The credits for an early refresh are set with the other credit prices (Admin → Money & fees → Credits).
export const config = () => { const s = siteGet('pnlwhy', {}) || {}; return { on: s.on !== false, every: { ...DEFAULTS.every, ...(s.every || {}) } }; };
const earlyCost = async () => (await import('./credits.js')).config().costs.pnlwhy ?? 2;
export async function saveConfig(b = {}) {
  const c = config(), every = { ...c.every };
  for (const k of Object.keys(DEFAULTS.every)) if (b.every?.[k] != null) every[k] = Math.min(10080, Math.max(5, Math.round(+b.every[k]) || DEFAULTS.every[k]));
  const next = { on: b.on != null ? !!b.on : c.on, every };
  await siteSet('pnlwhy', next); return next;
}
export const minutesFor = user => config().every[aiPlanKey(user)] ?? DEFAULTS.every.free;

const r2 = x => Math.round((+x || 0) * 100) / 100;
const usd = x => (x < 0 ? '-$' : '+$') + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = x => `${x >= 0 ? '+' : ''}${(+x).toFixed(2)}%`;
const SECTOR_ETF = { Technology: 'XLK', Communication: 'XLC', 'Consumer discretionary': 'XLY', 'Consumer staples': 'XLP', 'Health care': 'XLV', Financials: 'XLF', Industrials: 'XLI', Energy: 'XLE', Materials: 'XLB', Utilities: 'XLU', 'Real estate': 'XLRE' };

// Positions of one account, or of every connected account ('all').
export async function positionsOf(userId, account) {
  const { accountSummary } = await import('./brokers.js');
  const ids = account === 'all' ? (await (await import('./ext/routes.js')).accountsFor(userId).catch(() => [])).filter(a => a.connected !== false).map(a => a.id) : [account || 'paper'];
  const rows = [];
  let equity = 0;
  for (const id of ids) {
    const s = await accountSummary(userId, id).catch(() => null); if (!s) continue;
    equity += +s.equity || 0;
    for (const p of s.positions || []) if (+p.qty) rows.push({ account: id, symbol: p.symbol, qty: +p.qty, price: +p.price, value: +p.value });
  }
  // The same symbol in several accounts counts once.
  const by = {};
  for (const p of rows) { const b = (by[p.symbol] ||= { symbol: p.symbol, qty: 0, value: 0, price: p.price }); b.qty += p.qty; b.value += p.value; }
  return { equity: r2(equity), positions: Object.values(by) };
}

// Today's attribution, from snapshots (last price vs the previous close).
// betas: symbol -> beta to SPY (60 days), sector: symbol -> sector name.
export function attribute({ positions, snaps, betas = {}, sectorOf = () => 'Other' }) {
  const spy = snaps.SPY?.changePct ?? 0;
  const rows = positions.map(p => {
    const s = snaps[p.symbol], chg = s?.changePct ?? null, prev = s?.prevDailyBar?.c ?? (s?.price && chg != null ? s.price / (1 + chg / 100) : null);
    const pnl = chg == null || !prev ? 0 : r2(p.qty * ((s.price ?? p.price) - prev));
    const base = Math.abs(p.qty * (prev || p.price));
    const sign = p.qty < 0 ? -1 : 1, beta = betas[p.symbol] ?? 1;
    const sector = sectorOf(p.symbol), etf = SECTOR_ETF[sector], sec = etf ? snaps[etf]?.changePct ?? null : null;
    const market = r2(sign * base * beta * spy / 100);
    const sectorPart = sec == null ? 0 : r2(sign * base * (sec - beta * spy) / 100);
    return { symbol: p.symbol, sector, changePct: chg == null ? null : r2(chg), pnl, value: r2(p.value), market, sector$: sectorPart, own: r2(pnl - market - sectorPart), beta: r2(beta), short: p.qty < 0 };
  });
  const total = r2(rows.reduce((a, r) => a + r.pnl, 0));
  const market = r2(rows.reduce((a, r) => a + r.market, 0)), sectors = {};
  for (const r of rows) if (r.sector$) sectors[r.sector] = r2((sectors[r.sector] || 0) + r.sector$);
  const movers = [...rows].sort((a, b) => Math.abs(b.own) - Math.abs(a.own)).slice(0, 6);
  return { total, market, spyPct: r2(spy), sectors, rows, movers };
}

// Plain-words factors from the attribution (no AI needed).
export function plainFactors(a, news = {}) {
  const f = [];
  if (Math.abs(a.market) >= 1) f.push({ name: `The whole market (S&P 500 ${pct(a.spyPct)})`, impact: a.market, kind: 'market', text: `Your holdings move with the market; today that ${a.market >= 0 ? 'added' : 'took'} about ${usd(a.market).replace(/^[+-]/, '')}.` });
  for (const [s, v] of Object.entries(a.sectors).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 2)) if (Math.abs(v) >= 1) f.push({ name: `${s} stocks`, impact: v, kind: 'sector', text: `${s} ${v >= 0 ? 'did better' : 'did worse'} than the market today.` });
  for (const m of a.movers.slice(0, 4)) if (Math.abs(m.own) >= 1) {
    const h = news[m.symbol]?.[0];
    f.push({ name: m.symbol, symbols: [m.symbol], impact: m.own, kind: 'stock', text: `${m.symbol} moved ${pct(m.changePct ?? 0)} on its own, beyond the market and its sector${h ? `. In the news: "${h.headline}"` : ''}.` });
  }
  return f.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact));
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['headline', 'summary', 'factors'], properties: {
  headline: { type: 'string' }, summary: { type: 'string' },
  factors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'impact', 'kind', 'text'], properties: {
    name: { type: 'string' }, impact: { type: 'number' }, kind: { type: 'string', enum: ['market', 'sector', 'stock', 'news', 'rates', 'other'] }, text: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } } } } },
  watch: { type: 'array', items: { type: 'string' } } } };

// The full analysis for one user and account.
export async function analyze(user, account) {
  const D = await import('./alpaca/data.js');
  const { positions, equity } = await positionsOf(user.id, account);
  const at = Date.now();
  if (!positions.length) return { at, account, empty: true, headline: 'No open positions', summary: 'When you hold stocks, funds or crypto, this box explains what moved your profit or loss today.', factors: [], total: 0 };
  if (!D.dataEnabled()) return { at, account, empty: true, headline: 'Market data is not available right now', summary: '', factors: [], total: 0 };
  const { sectorOf } = await import('./portfoliorisk.js');
  const syms = positions.map(p => p.symbol).slice(0, 40);
  const etfs = [...new Set(syms.map(s => SECTOR_ETF[sectorOf(s)]).filter(Boolean))];
  const snaps = await D.snapshots([...new Set([...syms, 'SPY', 'QQQ', 'IWM', 'TLT', ...etfs])]).catch(() => ({}));
  // Beta to SPY over about 60 trading days, for the largest holdings.
  const betas = {};
  const top = [...positions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 12).map(p => p.symbol).filter(s => !s.includes('/'));
  try {
    const bars = await D.bars([...top, 'SPY'], { timeframe: '1Day', start: new Date(at - 110 * 864e5).toISOString().slice(0, 10) });
    const ret = b => (b || []).slice(1).map((x, i) => x.c / b[i].c - 1);
    const m = ret(bars.SPY).slice(-60), vm = m.reduce((a, x) => a + x * x, 0) / (m.length || 1) - (m.reduce((a, x) => a + x, 0) / (m.length || 1)) ** 2;
    for (const s of top) {
      const r = ret(bars[s]).slice(-m.length); if (r.length < 20 || !vm) continue;
      const n = Math.min(r.length, m.length), mm = m.slice(-n), rr = r.slice(-n), ma = mm.reduce((a, x) => a + x, 0) / n, ra = rr.reduce((a, x) => a + x, 0) / n;
      betas[s] = Math.max(-3, Math.min(4, mm.reduce((a, x, i) => a + (x - ma) * (rr[i] - ra), 0) / n / vm));
    }
  } catch {}
  const a = attribute({ positions, snaps, betas, sectorOf });
  // News on the holdings that moved most, and on the market.
  const news = {};
  try {
    const items = await D.news({ symbols: a.movers.map(m => m.symbol).filter(s => !s.includes('/')).slice(0, 6), limit: 30, start: new Date(at - 36 * 3600e3).toISOString() });
    for (const n of items) for (const s of n.symbols || []) (news[s] ||= []).length < 3 && news[s].push({ headline: n.headline, source: n.source, url: n.url, at: n.created_at });
  } catch {}
  const market = Object.fromEntries(['SPY', 'QQQ', 'IWM', 'TLT'].map(s => [s, snaps[s]?.changePct != null ? r2(snaps[s].changePct) : null]));
  const base = { at, account, total: a.total, equity, totalPct: equity ? r2(a.total / (equity - a.total) * 100) : null, market, attribution: { market: a.market, sectors: a.sectors, movers: a.movers }, news };
  const plain = plainFactors(a, news);
  const { llmEnabled, jsonCall, llmInfo } = await import('./llm.js');
  if (llmEnabled()) {
    try {
      const out = await jsonCall({
        system: 'You explain to one investor why their portfolio gained or lost money today. Use only the numbers and headlines given: never invent prices, news or reasons, and when the cause is not in the data say the stock moved with no clear news. Name 3 to 6 factors, biggest first, each with its dollar impact from the data (negative for a loss). Plain English a beginner understands, calm, no hype. Never recommend buying or selling. "watch" lists up to 3 things to keep an eye on (earnings dates, a big holding that moves a lot), as facts.',
        user: JSON.stringify({ todayPnl: a.total, equity, sp500Pct: a.spyPct, nasdaqPct: market.QQQ, smallCapsPct: market.IWM, longBondsPct: market.TLT, marketPart: a.market, sectorParts: a.sectors, holdings: a.rows.map(r => ({ symbol: r.symbol, sector: r.sector, changePct: r.changePct, pnl: r.pnl, value: r.value, marketPart: r.market, sectorPart: r.sector$, ownPart: r.own, beta: r.beta, short: r.short })).slice(0, 25), news }),
        schema: SCHEMA, maxTokens: 1500,
      });
      return { ...base, ...out, factors: (out.factors || []).slice(0, 6), engine: llmInfo()?.name || 'AI' };
    } catch (e) { base.aiError = e.message; }
  }
  return { ...base, headline: `${a.total >= 0 ? 'Up' : 'Down'} ${usd(a.total).replace(/^[+-]/, '')} today`, summary: `The S&P 500 is ${pct(a.spyPct)} today. Here is what moved your holdings.`, factors: plain, engine: null };
}

// Saved answer, refreshed when older than the plan allows; sooner costs credits.
export async function getAnalysis(user, account, { refresh = false } = {}) {
  const c = config();
  if (!c.on) return { off: true };
  c.cost = await earlyCost();
  const every = minutesFor(user) * 60e3;
  const row = await one('SELECT data, at FROM pnl_why WHERE user_id = ? AND account = ?', user.id, account);
  const due = !row || Date.now() - row.at >= every;
  let charged = 0;
  if (row && !due && !refresh) return { ...JSON.parse(row.data), nextAt: row.at + every, everyMin: every / 60e3, cost: c.cost };
  if (row && !due && refresh && c.cost > 0) { const CR = await import('./credits.js'); await CR.spend(user, 'pnlwhy', { memo: 'AI P/L analysis refreshed early' }); charged = c.cost; }
  const data = await analyze(user, account);
  await run('INSERT INTO pnl_why (user_id, account, data, at) VALUES (?,?,?,?) ON CONFLICT(user_id, account) DO UPDATE SET data = excluded.data, at = excluded.at', user.id, account, JSON.stringify(data), data.at);
  return { ...data, nextAt: data.at + every, everyMin: every / 60e3, cost: c.cost, charged };
}

const okAccount = a => (a === 'all' || a === 'paper' || a === 'alpaca' || /^alpaca:\d{1,3}$/.test(a) || ['tradier', 'tastytrade', 'schwab', 'tradestation'].includes(a) ? a : 'paper');
export const pnlWhyRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  // Each answer says what it was built on and how sure it is (src/ai-evidence.js, registry A-19).
  const ev = a => (a?.summary ? { ...a, evidence: evidence({ by: a.engine ? 'ai' : 'rules', data: ['Your account holdings', "Today's prices", a.engine ? 'News headlines' : null].filter(Boolean) }) } : a);
  r.get('/', wrap(async (req, res) => res.json(ev(await getAnalysis(req.user, okAccount(String(req.query.account || 'paper')))))));
  r.post('/refresh', wrap(async (req, res) => res.json(ev(await getAnalysis(req.user, okAccount(String(req.body?.account || 'paper')), { refresh: true })))));
  return r;
})();
