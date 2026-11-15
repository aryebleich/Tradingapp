// AI tools (menu → Intelligence → AI tools): four new tools, each with a plain fallback when no AI is
// set up.
//   What-if scenarios: describe an event ("the Fed cuts rates by half a point", "oil jumps 20%"); the
//     AI turns it into a move for each sector and asset class, and the app applies those moves to the
//     user's own holdings: an estimated gain or loss per holding and in total.
//   News to trades: paste a headline or an article; which stocks and sectors it touches, which way,
//     how strongly and why, with today's prices.
//   Theme to watchlist: "companies that gain from GLP-1 drugs"; a checked list of real tickers with
//     the reason for each, ready to save as a watchlist.
//   Head to head: two stocks side by side (fundamentals, trend, risk) and which fits which kind of
//     investor.
import express from 'express';
import { requireUser } from './auth.js';
import { aiLimits, useQuota } from './aiplans.js';

const r2 = x => Math.round((+x || 0) * 100) / 100;
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const SYM = /^[A-Z][A-Z0-9.]{0,9}$/;
export const SECTORS = ['Broad market', 'Technology', 'Communication', 'Consumer discretionary', 'Consumer staples', 'Health care', 'Financials', 'Industrials', 'Energy', 'Materials', 'Utilities', 'Real estate', 'Bonds', 'Gold and metals', 'Crypto', 'Leveraged index funds', 'Other'];
const ai = async () => { const L = await import('./llm.js'); return L.llmEnabled() ? L : null; };
const quota = user => useQuota(user, 'aitools', aiLimits(user).toolsAi, 'day', 'AI tools');

// ---------- what-if scenarios ----------
// Rule-of-thumb shocks (percent) for common events, used when no AI is set up.
export const PRESETS = [
  [/rate (cut|cuts)|cuts? rates|lower rates|fed (eases|cut)/i, 'Interest rates fall', { 'Broad market': 2, Technology: 3.5, 'Consumer discretionary': 3, Financials: -1, 'Real estate': 4, Utilities: 2.5, Bonds: 3, 'Gold and metals': 2, Crypto: 4 }],
  [/rate (hike|hikes|rise)|raises? rates|higher rates|fed (tightens|hike)/i, 'Interest rates rise', { 'Broad market': -2.5, Technology: -4, 'Consumer discretionary': -3, Financials: 1.5, 'Real estate': -5, Utilities: -3, Bonds: -3, 'Gold and metals': -1.5, Crypto: -5 }],
  [/recession|downturn|slowdown|unemployment/i, 'Recession', { 'Broad market': -15, Technology: -18, 'Consumer discretionary': -22, 'Consumer staples': -6, 'Health care': -7, Financials: -20, Industrials: -18, Energy: -20, Materials: -18, Utilities: -5, 'Real estate': -15, Bonds: 5, 'Gold and metals': 6, Crypto: -30, 'Leveraged index funds': -40, Other: -15 }],
  [/oil (jumps|spikes|rises|soars|surge)|oil price (up|rise)|opec cut/i, 'Oil price spike', { 'Broad market': -2, Energy: 10, 'Consumer discretionary': -4, Industrials: -3, Materials: 2, Technology: -1.5, Bonds: -1, 'Gold and metals': 2 }],
  [/tech (sell|crash|drop)|ai bubble|chips? (fall|crash)/i, 'Technology sell-off', { 'Broad market': -6, Technology: -15, Communication: -10, 'Consumer discretionary': -7, 'Consumer staples': 1, Utilities: 1.5, Bonds: 2, Crypto: -12, 'Leveraged index funds': -18 }],
  [/crypto (crash|falls|drop)|bitcoin (crash|falls|drop)/i, 'Crypto crash', { Crypto: -35, Technology: -2, Financials: -1 }],
  [/inflation (rises|jumps|hot|higher)|cpi (hot|higher|jumps)/i, 'Inflation runs hot', { 'Broad market': -3, Technology: -5, Energy: 4, Materials: 3, Bonds: -4, 'Gold and metals': 4, 'Real estate': -3, 'Consumer staples': -1 }],
  [/war|conflict|attack|geopolitic/i, 'Geopolitical shock', { 'Broad market': -5, Energy: 6, Industrials: -2, 'Gold and metals': 6, Bonds: 2, Crypto: -8, Technology: -6 }],
];
const SCEN = { type: 'object', additionalProperties: false, required: ['name', 'summary', 'shocks', 'assumptions'], properties: {
  name: { type: 'string' }, summary: { type: 'string' }, assumptions: { type: 'array', items: { type: 'string' } },
  shocks: { type: 'object', additionalProperties: false, properties: Object.fromEntries(SECTORS.map(s => [s, { type: 'number' }])) } } };
export function applyShocks(positions, shocks, sectorOf) {
  const rows = positions.map(p => {
    const sector = sectorOf(p.symbol), pct = shocks[sector] ?? shocks.Other ?? shocks['Broad market'] ?? 0;
    return { symbol: p.symbol, sector, value: r2(p.value), shockPct: r2(pct), impact: r2(p.value * pct / 100) };
  }).sort((a, b) => a.impact - b.impact);
  const total = r2(rows.reduce((a, r) => a + r.impact, 0)), value = r2(rows.reduce((a, r) => a + Math.abs(r.value), 0));
  return { rows, total, value, pct: value ? r2(total / value * 100) : 0 };
}
export async function scenario(user, text, account) {
  const { positionsOf } = await import('./pnlwhy.js'), { sectorOf } = await import('./portfoliorisk.js');
  const { positions, equity } = await positionsOf(user.id, account);
  let s, engine = null;
  const L = await ai();
  if (L) {
    await quota(user);
    s = await L.jsonCall({ system: 'You are a macro strategist. Turn the event the user describes into a plausible immediate price move (percent, one to four weeks) for each sector and asset class listed in the schema, from history and economics. Give a short name, a 2-sentence summary and the key assumptions. Be realistic and balanced; this is a what-if, not a forecast or advice.', user: `Event: ${String(text).slice(0, 600)}`, schema: SCEN, maxTokens: 1200 });
    engine = L.llmInfo()?.name || 'AI';
  } else {
    const hit = PRESETS.find(([re]) => re.test(text));
    if (!hit) throw bad('Without an AI set up, try a common event: rate cut, rate hike, recession, oil spike, tech sell-off, crypto crash, hot inflation or a geopolitical shock.', 422);
    s = { name: hit[1], summary: 'Rule-of-thumb moves from past episodes of this kind of event.', shocks: hit[2], assumptions: ['Moves are typical of past episodes; any real event can differ a lot.'] };
  }
  return { ...s, engine, account, equity, positions: positions.length, ...applyShocks(positions, s.shocks || {}, sectorOf) };
}

// ---------- news to trades ----------
const NEWS = { type: 'object', additionalProperties: false, required: ['summary', 'tickers', 'sectors', 'horizon', 'confidence'], properties: {
  summary: { type: 'string' }, horizon: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  tickers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['symbol', 'direction', 'magnitude', 'why'], properties: { symbol: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down', 'mixed'] }, magnitude: { type: 'string', enum: ['small', 'medium', 'large'] }, why: { type: 'string' } } } },
  sectors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sector', 'direction'], properties: { sector: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down', 'mixed'] } } } } } };
export async function newsImpact(user, text) {
  const t = String(text || '').trim().slice(0, 6000);
  if (t.length < 15) throw bad('Paste a headline or an article');
  let out, engine = null;
  const L = await ai();
  if (L) {
    await quota(user);
    out = await L.jsonCall({ system: 'Read the news the user pastes and say which US-listed stocks and ETFs it most directly affects (up to 8, real tickers only), which way, how strongly and why in one sentence each; the sectors affected; over what time frame; and how confident a reader can be. Only what the text supports; no advice.', user: t, schema: NEWS, maxTokens: 1200 });
    engine = L.llmInfo()?.name || 'AI';
  } else {
    const { scoreText } = await import('./sentiment.js');
    const score = scoreText(t), dir = score > 0.15 ? 'up' : score < -0.15 ? 'down' : 'mixed';
    const syms = [...new Set((t.match(/\b[A-Z]{2,5}\b/g) || []).filter(s => !['THE', 'AND', 'CEO', 'CFO', 'USA', 'SEC', 'FED', 'GDP', 'CPI', 'ETF', 'IPO', 'AI', 'US', 'EU', 'UK'].includes(s)))].slice(0, 8);
    out = { summary: `Plain reading (no AI set up): the tone of the text is ${dir === 'up' ? 'positive' : dir === 'down' ? 'negative' : 'mixed'}.`, tickers: syms.map(s => ({ symbol: s, direction: dir, magnitude: 'small', why: 'Named in the text.' })), sectors: [], horizon: 'days', confidence: 'low' };
  }
  out.tickers = (out.tickers || []).map(x => ({ ...x, symbol: String(x.symbol).toUpperCase() })).filter(x => SYM.test(x.symbol)).slice(0, 8);
  const D = await import('./alpaca/data.js');
  const snaps = D.dataEnabled() && out.tickers.length ? await D.snapshots(out.tickers.map(x => x.symbol)).catch(() => ({})) : {};
  out.tickers = out.tickers.map(x => ({ ...x, price: snaps[x.symbol]?.price ?? null, changePct: snaps[x.symbol]?.changePct != null ? r2(snaps[x.symbol].changePct) : null, known: !D.dataEnabled() || !!snaps[x.symbol] })).filter(x => x.known);
  return { ...out, engine };
}

// ---------- theme to watchlist ----------
export const THEMES = {
  'artificial intelligence': ['NVDA', 'MSFT', 'GOOGL', 'META', 'AMD', 'AVGO', 'TSM', 'PLTR', 'SMCI', 'ARM'],
  semiconductors: ['NVDA', 'AMD', 'AVGO', 'TSM', 'INTC', 'QCOM', 'MU', 'ASML', 'TXN', 'AMAT'],
  'clean energy': ['ENPH', 'FSLR', 'NEE', 'SEDG', 'PLUG', 'RUN', 'BEP', 'ICLN'],
  'weight-loss drugs': ['LLY', 'NVO', 'AMGN', 'VKTX', 'PFE'],
  cybersecurity: ['CRWD', 'PANW', 'FTNT', 'ZS', 'OKTA', 'S', 'CIBR'],
  cloud: ['AMZN', 'MSFT', 'GOOGL', 'ORCL', 'SNOW', 'NET', 'DDOG', 'MDB'],
  'electric vehicles': ['TSLA', 'RIVN', 'LCID', 'NIO', 'GM', 'F', 'ALB'],
  banks: ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC'],
  dividends: ['JNJ', 'PG', 'KO', 'PEP', 'XOM', 'CVX', 'VZ', 'ABBV', 'SCHD'],
  gold: ['GLD', 'NEM', 'GOLD', 'AEM', 'WPM'],
  defense: ['LMT', 'RTX', 'NOC', 'GD', 'LHX', 'ITA'],
};
const THEME = { type: 'object', additionalProperties: false, required: ['theme', 'companies'], properties: { theme: { type: 'string' },
  companies: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['symbol', 'name', 'why', 'purity'], properties: { symbol: { type: 'string' }, name: { type: 'string' }, why: { type: 'string' }, purity: { type: 'string', enum: ['pure play', 'large part', 'small part'] } } } } } };
export async function theme(user, text) {
  const t = String(text || '').trim().slice(0, 300);
  if (t.length < 3) throw bad('Describe a theme');
  let out, engine = null;
  const L = await ai();
  if (L) {
    await quota(user);
    out = await L.jsonCall({ system: 'List up to 12 US-listed companies or ETFs (real tickers only) that are most exposed to the theme the user describes, from pure plays to large companies where it is a big part of the business. One sentence each on why. Not advice.', user: t, schema: THEME, maxTokens: 1400 });
    engine = L.llmInfo()?.name || 'AI';
  } else {
    const key = Object.keys(THEMES).find(k => t.toLowerCase().includes(k) || k.split(' ').some(w => w.length > 4 && t.toLowerCase().includes(w)));
    if (!key) throw bad(`Without an AI set up, pick one of: ${Object.keys(THEMES).join(', ')}.`, 422);
    out = { theme: key, companies: THEMES[key].map(s => ({ symbol: s, name: s, why: `A well-known name in ${key}.`, purity: 'large part' })) };
  }
  out.companies = (out.companies || []).map(x => ({ ...x, symbol: String(x.symbol).toUpperCase() })).filter(x => SYM.test(x.symbol)).slice(0, 12);
  // Only tickers that really trade: each must have a price today.
  const D = await import('./alpaca/data.js');
  if (D.dataEnabled() && out.companies.length) {
    const snaps = await D.snapshots(out.companies.map(x => x.symbol)).catch(() => null);
    if (snaps) out.companies = out.companies.filter(x => snaps[x.symbol]).map(x => ({ ...x, checked: true, price: snaps[x.symbol].price ?? null, changePct: snaps[x.symbol].changePct != null ? r2(snaps[x.symbol].changePct) : null }));
  }
  // Without market data the tickers could not be checked: say so on each one.
  out.companies = out.companies.map(x => ({ ...x, checked: x.checked === true }));
  return { ...out, engine };
}

// ---------- head to head ----------
const H2H = { type: 'object', additionalProperties: false, required: ['summary', 'growth', 'value', 'income', 'safety', 'points'], properties: { summary: { type: 'string' },
  growth: { type: 'string' }, value: { type: 'string' }, income: { type: 'string' }, safety: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } } };
export async function compare(user, a, b) {
  const { profile } = await import('./fundamentals.js'), { technicals } = await import('./invest.js'), { getBars } = await import('./brokers.js');
  const start = new Date(Date.now() - 560 * 864e5).toISOString().slice(0, 10);
  const one = async s => {
    const [p, bars] = await Promise.all([profile(s, user.id).catch(e => ({ error: e.message })), getBars(s, start, user.id).catch(() => null)]);
    const t = bars ? technicals(bars.closes) : null;
    return { symbol: s, name: p.name || s, kind: p.kind || null, price: p.price ?? null, style: p.style || null, ratios: p.ratios || null, fundamentals: p.fundamentals || null, perf: p.perf || null, trend: t?.trend || null, rsi: t?.rsi14 ?? null, vol: t?.volatility ?? null, change1y: t?.change1y ?? null };
  };
  const [A, B] = await Promise.all([one(a), one(b)]);
  const L = await ai();
  let verdict, engine = null;
  if (L) {
    await quota(user);
    verdict = await L.jsonCall({ system: 'Compare the two stocks or funds from the data given only. Say in one sentence each which better fits a growth investor, a value investor, an income investor and a cautious investor, and why; then 3 to 5 key differences. Balanced; not advice; no invented numbers.', user: JSON.stringify({ a: A, b: B }), schema: H2H, maxTokens: 1200 });
    engine = L.llmInfo()?.name || 'AI';
  } else {
    const pick = (f, hi = true) => { const x = f(A), y = f(B); if (x == null || y == null) return 'Not enough data to say.'; const w = (hi ? x >= y : x <= y) ? A : B; return `${w.symbol}.`; };
    verdict = { summary: 'Plain comparison (no AI set up) from the numbers below.', growth: pick(s => s.fundamentals?.revenueGrowth), value: pick(s => s.ratios?.pe, false), income: pick(s => s.ratios?.dividendYield), safety: pick(s => s.vol, false), points: [] };
  }
  return { a: A, b: B, verdict, engine };
}

// ---------- routes ----------
const okAccount = a => (a === 'all' || a === 'paper' || a === 'alpaca' || /^alpaca:\d{1,3}$/.test(a) || ['tradier', 'tastytrade', 'schwab', 'tradestation'].includes(a) ? a : 'paper');
export const aiToolsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  r.post('/scenario', wrap(async (req, res) => res.json(await scenario(req.user, String(req.body?.text || '').trim() || bad('Describe an event'), okAccount(String(req.body?.account || 'paper'))))));
  r.post('/news', wrap(async (req, res) => res.json(await newsImpact(req.user, req.body?.text))));
  r.post('/theme', wrap(async (req, res) => res.json(await theme(req.user, req.body?.text))));
  r.post('/compare', wrap(async (req, res) => {
    const a = String(req.body?.a || '').toUpperCase().trim(), b = String(req.body?.b || '').toUpperCase().trim();
    if (!SYM.test(a) || !SYM.test(b) || a === b) throw bad('Enter two different symbols');
    res.json(await compare(req.user, a, b));
  }));
  return r;
})();
