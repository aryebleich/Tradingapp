// /api/tools/* : planning tools (position size, risk/reward, sector heatmap) and the AI explainers.
// Read-only: market data is read, nothing is ordered, no account or balance is changed. Each tool has
// its own feature flag (Admin → SEO → Feature flags), all off by default; a tool that is off answers 404.
// /api/admin/tools/* : the AI kill switches and the compliance log (admins only, via the /admin guard).
import express from 'express';
import { requireUser, rateLimit } from '../auth.js';
import { isOn } from '../flags.js';
import { count } from '../analytics.js';
import * as M from './math.js';
import * as G from './aiguard.js';

export const TOOL_FLAGS = { sizing: 'tools_sizing', rr: 'tools_rr', heatmap: 'tools_heatmap', portfolio: 'ai_portfolio_explainer', indicator: 'ai_indicator_explainer' };
export const DISCLOSURE = 'For planning and education only. Not investment advice and not an order: nothing is sent to your broker. Investing involves risk, including the loss of the money you invest.';
const on = (user, key) => !!user && isOn(TOOL_FLAGS[key], String(user.id));

const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong', ...(e.field ? { field: e.field } : {}), ...(e.code ? { code: e.code } : {}) });
const tool = (key, fn) => [requireUser, (req, res, next) => (on(req.user, key) ? next() : res.status(404).json({ error: 'Not found' })),
  (req, res) => { if (!rateLimit(`tools:${key}:${req.user.id}`, 120, 600e3)) return res.status(429).json({ error: 'Too many requests. Please wait a little.' }); return Promise.resolve().then(() => fn(req, res)).catch(e => fail(res, e)); }];

// Where the prices come from and how fresh they are, in words (shown on every page that uses them).
export async function dataLabel() {
  const D = await import('../alpaca/data.js');
  if (!D.dataEnabled()) return { source: "the site's free price sources (end-of-day prices)", delayed: true, note: 'End-of-day or delayed prices. Not suitable for timing trades.' };
  const feed = process.env.ALPACA_STOCK_FEED || 'iex';
  return feed === 'sip'
    ? { source: 'Alpaca market data, consolidated feed (SIP)', delayed: false, note: 'Consolidated prices from all US exchanges.' }
    : { source: 'Alpaca market data, IEX feed', delayed: false, partial: true, note: 'Prices from the IEX exchange only. They can differ from the price on other exchanges.' };
}

export const toolsRouter = express.Router();
toolsRouter.get('/flags', requireUser, (req, res) => {
  const f = Object.fromEntries(Object.keys(TOOL_FLAGS).map(k => [k, on(req.user, k)]));
  res.json({ ...f, any: Object.values(f).some(Boolean), killed: G.killStates() });
});

toolsRouter.post('/size', ...tool('sizing', (req, res) => { const r = M.positionSize(req.body || {}); count('tool', 'sizing:used'); res.json({ ...r, disclosure: DISCLOSURE }); }));

toolsRouter.post('/rr', ...tool('rr', async (req, res) => {
  const b = req.body || {}, r = M.riskReward(b);
  let atr = null;
  if (b.symbol) {
    const sym = String(b.symbol).toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{0,9}(\/USD)?$/.test(sym)) throw Object.assign(new Error('Unknown symbol'), { status: 400, field: 'symbol' });
    const { dailyBars } = await import('../scripts.js');
    const bars = (await dailyBars(sym, 60, req.user.id).catch(() => [])) || [];
    const a = M.atr(bars, 14);
    if (a) atr = { symbol: sym, atr: Math.round(a * 1e4) / 1e4, asOf: bars.at(-1)?.t || null, stop: M.atrStop({ entry: b.entry, atrValue: a, multiple: b.atrMultiple ?? 2, side: r.side }), data: await dataLabel() };
  }
  count('tool', 'rr:used');
  res.json({ ...r, atr, disclosure: DISCLOSURE });
}));

toolsRouter.get('/heatmap', ...tool('heatmap', async (req, res) => {
  const D = await import('../alpaca/data.js');
  if (!D.dataEnabled()) return res.status(503).json({ error: 'Live market data is not set up, so the heatmap is not available.', code: 'no_data' });
  const snaps = await D.snapshots(M.SECTOR_ETFS.map(([s]) => s));
  count('tool', 'heatmap:used');
  res.json({ sectors: M.heatmap(snaps), data: await dataLabel(), disclosure: DISCLOSURE, note: 'Each sector is shown by its Select Sector SPDR fund. Past moves do not predict future moves.' });
}));

// ---------- AI explainers ----------
const SYSTEM = 'You explain financial data in plain language for a general audience. You never recommend, suggest or rank trades or securities, never say what to buy, sell or hold, never predict prices or returns, and never promise results. Use only the facts given; if something is not in the facts, say you do not know. Reply as JSON: {"explanation": string (at most 120 words), "keyPoints": [up to 4 short strings]}.';
async function aiExplain(facts, question, { mayUseAccount = true } = {}) {
  const L = await import('../llm.js');
  if (!L.llmEnabled() || !mayUseAccount) return null;
  const out = await L.jsonCall({ system: SYSTEM, user: `Facts (JSON): ${JSON.stringify(facts)}\nQuestion: ${String(question || 'Explain these figures.').slice(0, 500)}` });
  return out?.explanation ? { text: String(out.explanation).slice(0, 1500), keyPoints: (Array.isArray(out.keyPoints) ? out.keyPoints : []).map(String).slice(0, 4), model: L.llmInfo()?.model } : null;
}
toolsRouter.post('/ai/portfolio', ...tool('portfolio', async (req, res) => {
  const c = M.concentration(req.body?.holdings);
  const facts = { holdings: c.count, largest: c.largest, top3Pct: c.top3, top5Pct: c.top5, hhi: c.hhi, effectiveHoldings: c.effectiveN, sectors: c.sectors.slice(0, 6) };
  const { mayShareAccount } = await import('../aiaccess.js'), L = await import('../llm.js');
  const allowed = mayShareAccount(L.provider?.()); // Admin → AI & privacy: account figures reach an AI only if allowed
  const r = await G.runGuarded({
    tool: 'portfolio', userId: req.user.id, question: req.body?.question || '', facts, count,
    sources: ['Your holdings as shown on your positions page when you asked (values are not stored).', 'Herfindahl-Hirschman index: the sum of each holding’s squared share of the total.'],
    ai: () => aiExplain(facts, req.body?.question, { mayUseAccount: allowed }),
    fallback: () => ({
      text: `Your largest holding, ${c.largest.symbol}, is ${c.largest.weight}% of the value you entered. The largest three make up ${c.top3}%. The concentration index is ${c.hhi} on a scale from near 0 (spread out) to 1 (a single holding), which works out to about ${c.effectiveN} equally sized holdings. The more of the total sits in a few holdings, the more a move in one of them changes the whole.`,
      keyPoints: [`${c.count} holdings`, `Largest: ${c.largest.symbol} ${c.largest.weight}%`, `Top 3: ${c.top3}%`, ...(c.sectors[0] ? [`Largest sector: ${c.sectors[0].sector} ${c.sectors[0].weight}%`] : [])],
    }),
  });
  res.json({ ...r, concentration: c });
}));

export const INDICATORS = {
  rsi: f => ({ text: `RSI(14) for ${f.symbol} is ${f.rsi}. RSI compares the size of recent up days with recent down days on a scale of 0 to 100. Readings above 70 are often described as "overbought" and below 30 as "oversold". These words describe how prices have moved; they do not say what happens next.`, keyPoints: [`RSI(14): ${f.rsi}`, 'Above 70: often called overbought', 'Below 30: often called oversold', 'Describes the past, does not predict'] }),
  macd: f => ({ text: `For ${f.symbol}, the MACD line is ${f.macd} and its signal line is ${f.signal}. MACD is the 12-day average price minus the 26-day average; the signal line is a 9-day average of MACD. MACD above its signal line means the shorter average has been rising faster recently.`, keyPoints: [`MACD: ${f.macd}`, `Signal: ${f.signal}`, `MACD minus signal: ${f.histogram}`] }),
  sma: f => ({ text: `${f.symbol} closed at ${f.close}. Its 50-day average is ${f.sma50 ?? 'not available'} and its 200-day average is ${f.sma200 ?? 'not available'}. A moving average is the mean closing price over that many days; comparing price with it shows the recent direction, not the future one.`, keyPoints: [`Close: ${f.close}`, `50-day: ${f.sma50 ?? 'n/a'}`, `200-day: ${f.sma200 ?? 'n/a'}`] }),
  bollinger: f => ({ text: `For ${f.symbol}, the Bollinger bands (20 days, 2 standard deviations) are ${f.lower} to ${f.upper}, with ${f.middle} in the middle; the close was ${f.close}. The bands widen when prices have moved more and narrow when they have moved less.`, keyPoints: [`Upper: ${f.upper}`, `Middle: ${f.middle}`, `Lower: ${f.lower}`, `Close: ${f.close}`] }),
};
toolsRouter.post('/ai/indicator', ...tool('indicator', async (req, res) => {
  const sym = String(req.body?.symbol || '').toUpperCase(), ind = String(req.body?.indicator || 'rsi').toLowerCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}(\/USD)?$/.test(sym)) throw Object.assign(new Error('Enter a ticker symbol, like AAPL'), { status: 400, field: 'symbol' });
  if (!INDICATORS[ind]) throw Object.assign(new Error('Choose RSI, MACD, moving averages or Bollinger bands'), { status: 400, field: 'indicator' });
  const { dailyBars } = await import('../scripts.js'), T = await import('../ta.js');
  const bars = (await dailyBars(sym, 400, req.user.id).catch(() => [])) || [];
  if (bars.length < 30) throw Object.assign(new Error('Not enough price history for this symbol.'), { status: 404, code: 'no_history' });
  const c = bars.map(b => b.c), r2 = x => (x == null ? null : Math.round(x * 100) / 100), lastOf = a => a[a.length - 1];
  const m = lastOf(T.macd(c)), b = lastOf(T.bollinger(c)), s50 = lastOf(T.sma(c, 50)), s200 = lastOf(T.sma(c, 200));
  const facts = { symbol: sym, indicator: ind, asOf: new Date(bars.at(-1).t).toISOString().slice(0, 10), close: r2(lastOf(c)), rsi: r2(lastOf(T.rsi(c, 14))), macd: r2(m?.macd), signal: r2(m?.signal), histogram: r2(m?.macd != null && m?.signal != null ? m.macd - m.signal : null), sma50: r2(s50), sma200: r2(s200), upper: r2(b?.up), middle: r2(b?.mid), lower: r2(b?.lo) };
  const data = await dataLabel();
  const r = await G.runGuarded({
    tool: 'indicator', userId: req.user.id, question: req.body?.question || '', facts, count,
    sources: [`Daily closing prices for ${sym} up to ${facts.asOf}, from ${data.source}.`, 'Indicator formulas: src/ta.js (RSI and MACD as defined by Wilder and Appel).'],
    ai: () => aiExplain(facts, req.body?.question), fallback: () => INDICATORS[ind](facts),
  });
  res.json({ ...r, data, educational: true });
}));

// ---------- admin ----------
export const toolsAdminRouter = express.Router();
toolsAdminRouter.get('/', async (req, res) => res.json({ tools: G.AI_TOOLS, killed: G.killStates(), flags: TOOL_FLAGS, envKill: process.env.AI_TOOLS_KILL || null }));
toolsAdminRouter.put('/kill', async (req, res) => { try { res.json({ killed: await G.setKill(String(req.body?.tool || ''), !!req.body?.killed) }); } catch (e) { fail(res, e); } });
toolsAdminRouter.get('/log', async (req, res) => res.json({ log: await G.readLog({ limit: Math.min(500, +req.query.limit || 100), tool: req.query.tool && G.AI_TOOLS[req.query.tool] ? req.query.tool : undefined }) }));
