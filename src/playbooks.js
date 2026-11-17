// Playbooks: block-based strategies (format in src/rotation/playbook-core.js). Stored in
// user_strategies with template_id 'playbook', so they share the engine, the daily model record,
// Reality Check, trailing stops and the run log (strategy_runs) with the other strategies.
// This module adds: versions, the AI builder, backtests with costs/slippage/benchmark, deploy with
// step-up for real money, the daily run before the close (market calendar, once per day, expired if
// missed), trade previews, history, manual overrides, the community library with moderation, and
// guided discovery. Every order goes through placeOrder (via runner.execute).
import express from 'express';
import { one, all, run, now } from './db.js';
import { isPaid } from './fees.js';
import { adviserMode } from './site.js';
import { publicName } from './crypto.js';
import { stepUpGuard } from './security.js';
import { placeOrder, lastPrice, accountSummary, ACCOUNT_IDS } from './brokers.js';
import { notifyUser } from './notify-user.js';
import { Market, tickersOf, backtest } from './rotation/engine.js';
import { parse, walkdown, execute, prepare, nyNow, marginMultiple } from './rotation/runner.js';
import { STRATEGY_LIMITS, planOf } from './rotation/routes.js';
import { BLUEPRINTS, withExamples, materialize, isLeveraged } from './rotation/blueprints.js';
import { checkPlaybook, fromSpec, rebalanceDue, tickers, condLabel, REBALANCES, WEIGHTINGS } from './rotation/playbook-core.js';
import { walkForward } from './engine.js';
import { isTradingDay, prevTradingDay, sessionOf } from './market-calendar.js';
import { realityFor } from './rotation/reality.js';

export const KIND = 'playbook';
export const DISCLAIMER = 'Backtests are hypothetical and use past prices; past results do not predict future returns. Trading involves risk of loss.';
export const AI_LABEL = 'AI-generated. Not investment advice: review every rule, the backtest and the risks before you use it.';
const bad = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const J = (s, d = null) => { try { return JSON.parse(s ?? 'null') ?? d; } catch { return d; } };
const limits = u => STRATEGY_LIMITS[planOf(u)];
const MIN = 60e3;
// Run 20 minutes before the close (13:00 on early-close days), so a sleeping free server that is
// woken by the cron still has time to send the orders; nothing is sent in the last 5 minutes.
export const RUN_BEFORE_CLOSE_MIN = 20, CUTOFF_BEFORE_CLOSE_MIN = 5;

// ---------- storage ----------

const row = async (id, userId) => {
  const r = await one('SELECT * FROM user_strategies WHERE id = ? AND user_id = ? AND template_id = ?', +id, userId, KIND);
  if (!r) throw bad('Playbook not found', 404);
  return { ...parse(r), versions: J(r.versions, []), aiGenerated: !!r.ai_generated, copiedFrom: r.copied_from || null, hidden: !!r.hidden, reports: J(r.reports, []) };
};
const view = async s => ({
  id: s.id, name: s.name, playbook: s.spec, account: s.account, mode: s.mode, allocation: s.allocation, paused: !!s.state.paused, skipNext: !!s.state.skipNext,
  version: s.versions.length, versions: s.versions.map(v => ({ v: v.v, at: v.at, note: v.note })), aiGenerated: s.aiGenerated, public: s.public, notes: s.notes,
  backtest: s.state.bt?.version === s.versions.length ? s.state.bt : null, lastRun: s.lastRun, lastResult: s.lastResult, copiedFrom: s.copiedFrom,
  disclaimer: DISCLAIMER, ...(s.aiGenerated ? { label: AI_LABEL } : {}),
});
// Every saved change is a new version (the last 50 are kept, newest last).
const withVersion = (versions, pb, note) => [...versions, { v: versions.length + 1, at: now(), note: String(note || 'Edited').slice(0, 120), playbook: pb }].slice(-50).map((x, i, a) => ({ ...x, v: x.v ?? i + 1 }));
const log = (s, userId, kind, summary, detail) => run('INSERT INTO strategy_runs (strategy_id, user_id, kind, summary, detail, at) VALUES (?,?,?,?,?,?)', s.id, userId, kind, String(summary).slice(0, 500), detail ? JSON.stringify(detail) : null, now());

function valid(input) {
  const r = checkPlaybook(input);
  if (!r.ok) throw bad('This Playbook cannot run yet:\n' + r.problems.slice(0, 12).join('\n'), 400, { problems: r.problems });
  return r.playbook;
}

// ---------- backtest ----------

const due = pb => day => rebalanceDue(pb, day, isTradingDay, prevTradingDay);
export async function runBacktest(pb, userId, { years = 5, costBps = 5, slippageBps = 5, benchmark } = {}) {
  benchmark = String(benchmark || pb.benchmark || 'SPY').toUpperCase();
  const mkt = await new Market(userId).load([...tickersOf(pb), benchmark]);
  // Symbols that do not exist (no price history) make the Playbook invalid.
  const missing = tickers(pb).filter(t => mkt.failed.has(t));
  if (missing.length) throw bad(`No price history for ${missing.join(', ')}: check the ticker${missing.length > 1 ? 's' : ''}.`, 400, { problems: missing.map(t => `${t}: unknown ticker or no price history`) });
  const r = backtest(pb, mkt, { years, costBps, slippageBps, benchmark, isDue: due(pb) });
  // Walk-forward check (the one the bot backtests use): the curve split into 4 parts; a strategy whose
  // later parts lose what the first part made is flagged.
  const parts = [], step = Math.floor(r.curve.length / 4);
  for (let k = 0; k < 4 && step > 1; k++) { const a = r.curve[k * step], b = r.curve[Math.min(r.curve.length - 1, (k + 1) * step)]; parts.push(+((b / a - 1) * 100).toFixed(2)); }
  return {
    ...r, years, costBps, slippageBps,
    stats: { ret: r.m.ret, cagr: r.m.cagr, dd: r.m.dd, vol: r.m.vol, sharpe: r.m.sharpe },
    benchmarkStats: { ret: r.bh.ret, cagr: r.bh.cagr, dd: r.bh.dd, vol: r.bh.vol, sharpe: r.bh.sharpe },
    walkForward: { parts, consistent: parts.length === 4 && parts.filter(x => x > 0).length >= 3 },
    disclaimer: DISCLAIMER,
  };
}
const btSummary = (r, version) => ({ version, at: now(), years: r.years, cagr: r.m.cagr, dd: r.m.dd, vol: r.m.vol, sharpe: r.m.sharpe, ret: r.m.ret, bench: r.benchmark, benchCagr: r.bh.cagr, mean: r.dailyStats.mean, sd: r.dailyStats.sd, walkForward: r.walkForward });

// ---------- AI builder ----------

const SYSTEM = `You turn a trading idea into a Brightolio Playbook. Reply with JSON only: {"name": string, "summary": string, "playbook": Playbook}.
Playbook = {"kind":"playbook","version":1,"rebalance":"daily"|"weekly"|"monthly"|"quarterly","benchmark":"SPY","root":Block}
Block = {"type":"asset","ticker":"SPY","weight"?:number}
      | {"type":"cash","weight"?:number}
      | {"type":"group","name":string,"weighting":"equal"|"specified"|"invvol","children":[Block],"weight"?:number}
      | {"type":"if","cond":Cond,"then":Block,"else":Block,"weight"?:number}
      | {"type":"filter","metric":[fn,len],"select":"top"|"bottom","count":n,"weighting":"equal"|"invvol","children":[asset Blocks]}
Cond = {"a":Metric,"op":">"|"<"|">="|"<=","b":Metric|number} or {"need":k,"of":[Cond,...]}
Metric = [fn, "TICKER", len], fn one of rsi, sma, close (len 0), ret (% return over len days), avgret, stdev, high, pstdev.
With "specified" weighting every child has "weight" in percent and they add to exactly 100.
Use only real, liquid US stocks and ETFs. No leverage unless the user asks for it. Keep it simple and explicit.`;

// Without an AI provider: a plain reading of the idea (tickers named in it, equal weight, and a
// trend filter when it mentions a moving average), so the builder still works and says so.
export function ruleDraft(prompt) {
  const text = String(prompt || '');
  const STOP = new Set(['I', 'A', 'AND', 'OR', 'THE', 'IF', 'ETF', 'ETFS', 'US', 'USA', 'AI', 'SMA', 'RSI', 'DAY', 'MA', 'CASH', 'BUY', 'SELL', 'S&P', 'NOT', 'TO', 'IN', 'OF', 'ON', 'WHEN']);
  let tick = [...new Set((text.match(/\b[A-Z]{1,5}\b/g) || []).filter(t => !STOP.has(t)))].slice(0, 12);
  if (!tick.length) tick = /bond/i.test(text) ? ['SPY', 'AGG'] : ['SPY', 'QQQ', 'AGG'];
  const reb = /daily|every day/i.test(text) ? 'daily' : /weekly|every week/i.test(text) ? 'weekly' : /quarter/i.test(text) ? 'quarterly' : 'monthly';
  const ma = text.match(/(\d{2,3})[- ]?day/i);
  // Tickers named only in the trend rule (the signal and the fallback) are not holdings.
  const trendRule = ma && /average|trend|sma/i.test(text);
  if (trendRule) { const rest = tick.filter(t => !['SPY', 'BIL'].includes(t) || !new RegExp(`\\b${t}\\b[^.]*\\b(above|below|average|otherwise)|otherwise[^.]*\\b${t}\\b`, 'i').test(text)); if (rest.length) tick = rest; }
  let root = { type: 'group', name: 'Holdings', weighting: /volatil|risk parity/i.test(text) ? 'invvol' : 'equal', children: tick.map(t => ({ type: 'asset', ticker: t })) };
  const top = text.match(/top (\d+)/i);
  if (top && tick.length > +top[1]) root = { type: 'filter', name: 'Strongest', metric: ['ret', 63], select: 'top', count: +top[1], weighting: 'equal', children: tick.map(t => ({ type: 'asset', ticker: t })) };
  if (ma && /average|trend|sma/i.test(text)) root = { type: 'if', cond: { a: ['close', 'SPY', 0], op: '>', b: ['sma', 'SPY', +ma[1]] }, then: root, else: { type: 'asset', ticker: 'BIL' } };
  return { name: text.slice(0, 40).trim() || 'My Playbook', summary: 'Draft read from your words (no AI provider is set up).', playbook: { kind: 'playbook', version: 1, rebalance: reb, benchmark: 'SPY', root } };
}
export async function aiBuild(prompt, userId) {
  if (!String(prompt || '').trim()) throw bad('Describe your idea first');
  const { llmEnabled, jsonCall } = await import('./llm.js');
  let draft, by = 'rules';
  if (llmEnabled()) {
    try { draft = await jsonCall({ system: SYSTEM, user: String(prompt).slice(0, 2000), maxTokens: 2500 }); by = 'ai'; }
    catch (e) { draft = null; }
  }
  if (!draft?.playbook) draft = ruleDraft(prompt);
  const check = checkPlaybook(draft.playbook);
  const out = { name: String(draft.name || 'AI Playbook').slice(0, 60), summary: String(draft.summary || '').slice(0, 500), playbook: check.playbook, by, label: AI_LABEL, valid: check.ok, problems: check.problems };
  if (!check.ok) return out;
  // Backtested before it can be saved or deployed.
  try { out.backtest = await runBacktest(check.playbook, userId, { years: 3 }); }
  catch (e) { out.valid = false; out.problems = e.problems || [e.message]; }
  return out;
}

// ---------- the daily run (scheduler) ----------

export async function runPlaybooks(t = now(), claim) {
  const n = nyNow(t);
  const rows = await all("SELECT * FROM user_strategies WHERE template_id = ? AND mode IN ('auto', 'approve')", KIND);
  let ran = 0;
  for (const raw of rows) {
    const s = parse(raw);
    const isDue = due(s.spec);
    try {
      // A rebalance day that passed without a run (the server slept through it): expired, with a
      // notification. Orders are never sent late.
      const prev = prevTradingDay(n.day);
      if (isDue(prev) && s.lastRun !== prev && raw.created_at < Date.parse(prev + 'T21:00:00Z') && !s.state.paused && await claim(`playbook:${s.id}:${prev}`)) {
        await log(s, s.userId, 'expired', `Missed the ${prev} rebalance (the server was not running before the close); nothing was traded. It runs again on the next rebalance day.`);
        await notifyUser(s.userId, `Brightolio: Playbook "${s.name}" missed its rebalance on ${prev}; nothing was traded.`).catch(() => {});
      }
      const sess = sessionOf(n.day);
      if (!sess || !isDue(n.day) || s.state.paused) continue;
      if (n.minutes < sess.close - RUN_BEFORE_CLOSE_MIN) continue;
      if (!await claim(`playbook:${s.id}:${n.day}`)) continue; // at most once per day
      if (n.minutes > sess.close - CUTOFF_BEFORE_CLOSE_MIN) {
        await log(s, s.userId, 'expired', `Too close to the close (${n.minutes > sess.close ? 'after' : 'within 5 minutes of'} it) to trade safely; nothing was sent.`);
        await notifyUser(s.userId, `Brightolio: Playbook "${s.name}" could not rebalance before the close today; nothing was traded.`).catch(() => {});
        continue;
      }
      if (s.state.skipNext) {
        await run('UPDATE user_strategies SET state = ?, last_run = ? WHERE id = ?', JSON.stringify({ ...s.state, skipNext: false }), n.day, s.id);
        await log(s, s.userId, 'skipped', 'Skipped this rebalance, as you asked');
        continue;
      }
      // Copies of ready-made or shared Playbooks follow real accounts by approval unless the business
      // runs as a registered adviser (the same rule as the ready-made strategies).
      const approve = s.mode === 'approve' || (s.account !== 'paper' && raw.copied_from && !adviserMode());
      if (approve) await prepare(s, n.day); else await execute(s, s.userId, { kind: 'auto' });
      ran++;
    } catch (e) {
      await log(s, s.userId, 'failed', `The rebalance failed: ${e.message}`).catch(() => {});
      await notifyUser(s.userId, `Brightolio: Playbook "${s.name}" could not rebalance: ${e.message}`).catch(() => {});
    }
  }
  return ran;
}

// ---------- trade preview ----------

export async function preview(s, userId) {
  const w = await walkdown(s, userId);
  if (w.capital?.error) throw bad(w.capital.error, 409);
  const eq = w.capital.equity || 0, sess = sessionOf(nyNow().day);
  const rows = w.orders.map(o => ({
    ticker: o.ticker, price: o.price, currentShares: o.have, targetShares: o.shares, change: o.delta, action: o.action,
    currentPct: eq ? +((o.have * (o.price || 0)) / eq * 100).toFixed(2) : 0, targetPct: +(o.weight * (w.capital.investable / (eq || 1)) * 100).toFixed(2),
    dollars: +((o.delta * (o.price || 0))).toFixed(2),
  }));
  return { day: w.day, rebalanceDue: due(s.spec)(w.day), runsAtNy: sess ? `${Math.floor((sess.close - RUN_BEFORE_CLOSE_MIN) / 60)}:${String((sess.close - RUN_BEFORE_CLOSE_MIN) % 60).padStart(2, '0')}` : null,
    trades: rows, investable: w.capital.investable, equity: eq, trace: w.trace || [], estimate: 'Estimate from the latest prices: actual fills may differ, and the trades are worked out again when the Playbook runs.' };
}

// ---------- library ----------

// Brightolio's own designs (the blueprints with their example tickers) converted to Playbooks. The
// original strategies (Admin → Original strategies) are never published.
let SEED = null;
export function seedLibrary() {
  if (SEED) return SEED;
  SEED = BLUEPRINTS.map(bp => {
    try {
      const spec = materialize(withExamples(JSON.parse(JSON.stringify(bp))));
      const pb = fromSpec(spec);
      const c = pb && checkPlaybook(pb);
      return c?.ok ? { id: `bp:${bp.id}`, name: bp.name, about: bp.about, tagline: bp.tagline, by: 'Brightolio', playbook: c.playbook, leveraged: tickers(c.playbook, { reads: false }).some(isLeveraged) } : null;
    } catch { return null; }
  }).filter(Boolean);
  return SEED;
}
const btCache = new Map();
async function cachedBacktest(key, pb, userId) {
  const hit = btCache.get(key);
  if (hit && now() - hit.at < 6 * 3600e3) return hit.r;
  const r = await runBacktest(pb, userId, { years: 5 }).catch(e => ({ error: e.message }));
  btCache.set(key, { at: now(), r });
  return r;
}
async function libraryList(userId, sort = 'newest') {
  const pubs = (await all("SELECT * FROM user_strategies WHERE template_id = ? AND public = 1 AND COALESCE(hidden, 0) = 0 ORDER BY published_at DESC LIMIT 200", KIND)).map(r => ({ ...parse(r), copies: r.copies || 0 }));
  const items = [
    ...seedLibrary().map(x => ({ id: x.id, name: x.name, about: x.about, by: 'Brightolio', official: true, playbook: x.playbook, leveraged: x.leveraged, bt: null, publishedAt: 0, copies: 0 })),
    ...pubs.map(s => ({ id: String(s.id), name: s.name, about: s.notes, by: publicName(s.userId), official: false, playbook: s.spec, leveraged: tickers(s.spec, { reads: false }).some(isLeveraged), bt: s.state.bt || null, publishedAt: s.publishedAt, copies: s.copies, mine: s.userId === userId })),
  ];
  for (const it of items) if (!it.bt && it.official) {
    const r = await cachedBacktest(it.id, it.playbook, userId);
    it.bt = r.error ? null : btSummary(r, 0);
  }
  const key = { newest: x => -(x.publishedAt || 0), cagr: x => -(x.bt?.cagr ?? -1e9), drawdown: x => x.bt?.dd ?? 1e9, sharpe: x => -(x.bt?.sharpe ?? -1e9), name: x => x.name };
  const k = key[sort] || key.newest;
  items.sort((a, b) => { const x = k(a), y = k(b); return typeof x === 'string' ? x.localeCompare(y) : x - y; });
  return items.map(x => ({ ...x, tickers: tickers(x.playbook, { reads: false }).slice(0, 15), rebalance: x.playbook.rebalance, disclaimer: DISCLAIMER }));
}
const libraryItem = async (id, userId) => {
  if (String(id).startsWith('bp:')) { const x = seedLibrary().find(y => y.id === id); if (!x) throw bad('Not in the library', 404); return { name: x.name, about: x.about, playbook: x.playbook, srcId: null }; }
  const r = await one("SELECT * FROM user_strategies WHERE id = ? AND template_id = ? AND public = 1 AND COALESCE(hidden, 0) = 0", +id, KIND);
  if (!r) throw bad('That Playbook is no longer published', 404);
  const s = parse(r);
  return { name: s.name, about: s.notes, playbook: s.spec, srcId: s.id };
};

// ---------- guided discovery ----------

export const QUESTIONS = {
  goal: { growth: 'Grow my money', income: 'Steadier, income-like returns', preserve: 'Protect what I have' },
  risk: { low: 'Low: I would lose sleep over a 10% drop', medium: 'Medium: I can live with a 20% drop', high: 'High: I accept drops of 30% or more' },
  horizon: { short: 'Under 3 years', medium: '3 to 10 years', long: 'More than 10 years' },
};
export function match(items, { goal, risk, horizon }) {
  if (!QUESTIONS.goal[goal] || !QUESTIONS.risk[risk] || !QUESTIONS.horizon[horizon]) throw bad('Answer the three questions');
  const maxDd = { low: 15, medium: 30, high: 100 }[risk] - (horizon === 'short' ? 5 : 0);
  const out = items.filter(x => x.bt).map(x => {
    const why = [], dd = x.bt.dd, cagr = x.bt.cagr, vol = x.bt.vol;
    let score = 0;
    if (x.leveraged && risk !== 'high') return null;
    if (dd > maxDd) return null;
    why.push(`Its largest backtested drop was ${dd.toFixed(1)}%, within what you said you can accept.`);
    if (goal === 'growth') { score += cagr; why.push(`It aims for growth: ${cagr.toFixed(1)}% a year in the backtest.`); }
    if (goal === 'income' || goal === 'preserve') { score += 20 - vol; why.push(`It moved less than most (volatility ${vol.toFixed(1)}% a year).`); }
    if (horizon === 'short') score -= dd; else if (horizon === 'long') score += cagr / 2;
    if (x.leveraged) why.push('It uses leveraged funds, which can lose value quickly.');
    return { ...x, score, why };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 3);
  return out;
}
export const EDUCATION = 'These are examples to learn from, matched only on your three answers and their past backtests. They are not personal investment advice or a recommendation to buy anything. ' + DISCLAIMER;

// ---------- overrides ----------

async function closeAll(s, userId) {
  const holdings = { ...(s.state.holdings || {}) }, results = [];
  for (const [t, q] of Object.entries(holdings)) {
    if (!(q > 0)) continue;
    try { const r = await placeOrder(userId, s.account, { symbol: t, side: 'sell', qty: q }, `strategy:${s.id}:close`); results.push({ ticker: t, qty: q, ok: true, status: r.status }); delete holdings[t]; }
    catch (e) { results.push({ ticker: t, qty: q, ok: false, error: e.message }); }
  }
  return { holdings, results };
}
const swapTicker = (pb, from, to) => JSON.parse(JSON.stringify(pb), (k, v) => (v === from && (k === 'ticker' || k === '1' || k === 'benchmark') ? to : v));

// ---------- router ----------
// Mounted at /api/playbooks (signed-in users) and /api/v1/playbooks (personal API keys). For API keys
// `req.apiKey` is set; real-money actions are refused there (they need the website's step-up check).

const realMoneyGuard = (req, res, next, account) => {
  if (account === 'paper') return next();
  if (req.apiKey) return res.status(403).json({ error: 'Real-money Playbooks are deployed, resumed and closed from the website, which asks you to confirm it is you. The API can do this on the practice account.' });
  return stepUpGuard(req, res, next);
};
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(e.status || 400).json({ error: e.message, ...(e.problems ? { problems: e.problems } : {}), ...(e.upgrade ? { upgrade: true, feature: e.feature } : {}) }));
const upgrade = feature => bad(`${feature} is part of the Pro plan`, 402, { upgrade: true, feature });

export function playbooksRouter() {
  const r = express.Router();
  r.get('/meta', (req, res) => res.json({ weightings: WEIGHTINGS, rebalances: REBALANCES, questions: QUESTIONS, disclaimer: DISCLAIMER, aiLabel: AI_LABEL, education: EDUCATION }));
  r.get('/', wrap(async (req, res) => {
    const rows = await all('SELECT * FROM user_strategies WHERE user_id = ? AND template_id = ? ORDER BY id', req.user.id, KIND);
    res.json(await Promise.all(rows.map(async x => view({ ...parse(x), versions: J(x.versions, []), aiGenerated: !!x.ai_generated, copiedFrom: x.copied_from }))));
  }));
  r.post('/check', wrap(async (req, res) => res.json(checkPlaybook(req.body.playbook))));
  r.post('/ai', wrap(async (req, res) => res.json(await aiBuild(req.body.prompt, req.user.id))));
  // Create: from the editor, the AI builder (backtested first), or a copy from the library.
  r.post('/', wrap(async (req, res) => {
    const n = (await one('SELECT COUNT(*) n FROM user_strategies WHERE user_id = ?', req.user.id)).n;
    if (n >= limits(req.user).saved) throw isPaid(req.user) ? bad(`Your plan holds ${limits(req.user).saved} strategies and Playbooks`) : upgrade('More saved Playbooks');
    const pb = valid(req.body.playbook), ai = !!req.body.aiGenerated;
    let bt = null;
    if (ai) bt = await runBacktest(pb, req.user.id, { years: 3 }); // AI output is backtested before it is saved
    const versions = withVersion([], pb, ai ? 'Created by the AI builder' : 'Created');
    const name = String(req.body.name || 'My Playbook').trim().slice(0, 60) || 'My Playbook';
    const ins = await run('INSERT INTO user_strategies (user_id, template_id, name, spec, versions, ai_generated, notes, state, created_at) VALUES (?,?,?,?,?,?,?,?,?)', req.user.id, KIND, name, JSON.stringify(pb), JSON.stringify(versions), ai ? 1 : 0, String(req.body.notes || '').slice(0, 1000),
      JSON.stringify(bt ? { bt: btSummary(bt, 1) } : {}), now());
    res.json(await view(await row(ins.lastInsertRowid, req.user.id)));
  }));
  // Library and discovery (before /:id).
  r.get('/library', wrap(async (req, res) => res.json(await libraryList(req.user.id, String(req.query.sort || 'newest')))));
  r.post('/library/:id/backtest', wrap(async (req, res) => { const it = await libraryItem(req.params.id, req.user.id); res.json(await runBacktest(it.playbook, req.user.id, { years: Math.min(limits(req.user).backtestYears, Math.max(1, +req.body.years || 5)) })); }));
  r.post('/library/:id/copy', wrap(async (req, res) => {
    const it = await libraryItem(req.params.id, req.user.id);
    const n = (await one('SELECT COUNT(*) n FROM user_strategies WHERE user_id = ?', req.user.id)).n;
    if (n >= limits(req.user).saved) throw isPaid(req.user) ? bad(`Your plan holds ${limits(req.user).saved} strategies and Playbooks`) : upgrade('More saved Playbooks');
    const pb = valid(it.playbook), versions = withVersion([], pb, 'Copied from the library');
    const ins = await run('INSERT INTO user_strategies (user_id, template_id, name, spec, versions, notes, copied_from, created_at) VALUES (?,?,?,?,?,?,?,?)', req.user.id, KIND, `${it.name} (copy)`.slice(0, 60), JSON.stringify(pb), JSON.stringify(versions), String(it.about || '').slice(0, 1000), it.srcId || -1, now());
    if (it.srcId) await run('UPDATE user_strategies SET copies = COALESCE(copies, 0) + 1 WHERE id = ?', it.srcId);
    res.json(await view(await row(ins.lastInsertRowid, req.user.id)));
  }));
  r.post('/library/:id/report', wrap(async (req, res) => {
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (reason.length < 5) throw bad('Say briefly what is wrong');
    const x = await one("SELECT id, user_id, reports FROM user_strategies WHERE id = ? AND template_id = ? AND public = 1", +req.params.id, KIND);
    if (!x) throw bad('Not in the library', 404);
    const reps = J(x.reports, []);
    if (reps.some(p => p.by === req.user.id)) return res.json({ ok: true, already: true });
    reps.push({ by: req.user.id, reason, at: now() });
    // Three reports from different people hide it until a moderator looks.
    await run('UPDATE user_strategies SET reports = ?, hidden = ? WHERE id = ?', JSON.stringify(reps), reps.length >= 3 ? 1 : 0, x.id);
    res.json({ ok: true, hidden: reps.length >= 3 });
  }));
  r.get('/moderation', wrap(async (req, res) => {
    if (req.user.role !== 'admin') throw bad('Admin only', 403);
    const rows = await all("SELECT id, user_id, name, notes, reports, hidden, public FROM user_strategies WHERE template_id = ? AND (reports IS NOT NULL OR hidden = 1) ORDER BY id DESC LIMIT 200", KIND);
    res.json(rows.map(x => ({ id: x.id, name: x.name, notes: x.notes, by: publicName(x.user_id), reports: J(x.reports, []).map(p => ({ reason: p.reason, at: p.at })), hidden: !!x.hidden, public: !!x.public })));
  }));
  r.post('/moderation/:id', wrap(async (req, res) => {
    if (req.user.role !== 'admin') throw bad('Admin only', 403);
    const act = req.body.action;
    if (act === 'hide') await run('UPDATE user_strategies SET hidden = 1 WHERE id = ? AND template_id = ?', +req.params.id, KIND);
    else if (act === 'restore') await run('UPDATE user_strategies SET hidden = 0, reports = NULL WHERE id = ? AND template_id = ?', +req.params.id, KIND);
    else if (act === 'unpublish') await run('UPDATE user_strategies SET public = 0, hidden = 0 WHERE id = ? AND template_id = ?', +req.params.id, KIND);
    else throw bad('Use hide, restore or unpublish');
    res.json({ ok: true });
  }));
  r.post('/discover', wrap(async (req, res) => {
    const items = await libraryList(req.user.id, 'sharpe');
    res.json({ matches: match(items, req.body || {}).map(x => ({ id: x.id, name: x.name, about: x.about, by: x.by, why: x.why, bt: x.bt, tickers: x.tickers })), education: EDUCATION, answers: req.body });
  }));

  r.get('/:id', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    res.json({ ...(await view(s)), reality: await realityFor(s).catch(() => null), versionsFull: s.versions.slice(-10) });
  }));
  r.put('/:id', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id), b = req.body;
    const pb = b.playbook ? valid(b.playbook) : s.spec;
    const changed = b.playbook && JSON.stringify(pb) !== JSON.stringify(s.spec);
    const versions = changed ? withVersion(s.versions, pb, b.note || 'Edited') : s.versions;
    let pub = s.public;
    if (b.public !== undefined) { pub = !!b.public; if (pub && !limits(req.user).publish) throw upgrade('Publishing Playbooks'); if (pub && !(s.state.bt?.version === versions.length)) throw bad('Run a backtest of this version before publishing it, so others can see it'); }
    const alloc = b.allocation === undefined ? s.allocation : Math.min(100, Math.max(1, +b.allocation || 0));
    await run('UPDATE user_strategies SET name = ?, spec = ?, versions = ?, notes = ?, public = ?, published_at = ?, allocation = ? WHERE id = ?',
      String(b.name ?? s.name).trim().slice(0, 60) || s.name, JSON.stringify(pb), JSON.stringify(versions), b.notes === undefined ? s.notes : String(b.notes).slice(0, 1000), pub ? 1 : 0, pub ? (s.publishedAt || now()) : null, alloc, s.id);
    if (changed && s.mode !== 'manual') await log(s, req.user.id, 'override', `Edited the rules (version ${versions.length}); takes effect at the next run`);
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.delete('/:id', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    if (s.mode !== 'manual' && Object.keys(s.state.holdings || {}).length) throw bad('Stop it (and close its positions if you want) before deleting it', 409);
    await run('DELETE FROM strategy_days WHERE strategy_id = ?', s.id); await run('DELETE FROM strategy_runs WHERE strategy_id = ?', s.id); await run('DELETE FROM user_strategies WHERE id = ?', s.id);
    res.json({ ok: true });
  }));
  r.post('/:id/restore', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id), v = s.versions.find(x => x.v === +req.body.version);
    if (!v) throw bad('No such version', 404);
    const versions = withVersion(s.versions, v.playbook, `Restored version ${v.v}`);
    await run('UPDATE user_strategies SET spec = ?, versions = ? WHERE id = ?', JSON.stringify(v.playbook), JSON.stringify(versions), s.id);
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.post('/:id/backtest', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id), b = req.body || {};
    const maxYears = limits(req.user).backtestYears, years = Math.min(maxYears, Math.max(1, +b.years || Math.min(5, maxYears)));
    const pb = b.playbook ? valid(b.playbook) : s.spec;
    const r = await runBacktest(pb, req.user.id, { years, costBps: Math.min(100, Math.max(0, +(b.costBps ?? 5))), slippageBps: Math.min(100, Math.max(0, +(b.slippageBps ?? 5))), benchmark: b.benchmark });
    // The saved version's backtest: Reality Check's yardstick, and needed to deploy or publish.
    if (!b.playbook) await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s.state, bt: btSummary(r, s.versions.length) }), s.id);
    res.json(r);
  }));
  r.get('/:id/preview', wrap(async (req, res) => res.json(await preview(await row(req.params.id, req.user.id), req.user.id))));
  r.get('/:id/history', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    const runs = await all('SELECT kind, summary, detail, at FROM strategy_runs WHERE strategy_id = ? ORDER BY id DESC LIMIT 200', s.id);
    res.json(runs.map(x => { const d = J(x.detail, {}) || {}; return { kind: x.kind, summary: x.summary, at: x.at, trades: d.results || [], weights: d.weights || null, triggers: d.trace || [] }; }));
  }));
  // Deploy: runs by itself each rebalance day. Needs a backtest of the current version; a real-money
  // account needs the same step-up confirmation as a live order.
  r.post('/:id/deploy', (req, res, next) => realMoneyGuard(req, res, next, String(req.body?.account || 'paper')), wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id), account = String(req.body.account || 'paper'), mode = req.body.mode === 'approve' ? 'approve' : 'auto';
    if (!ACCOUNT_IDS.includes(account)) throw bad('Pick an account');
    if (!(s.state.bt?.version === s.versions.length)) throw bad('Backtest this version first: a Playbook is backtested before it is deployed', 409);
    if (account !== 'paper' && !isPaid(req.user)) throw upgrade('Running Playbooks on your brokerage account');
    const autos = (await one("SELECT COUNT(*) n FROM user_strategies WHERE user_id = ? AND mode IN ('auto', 'approve') AND id != ?", req.user.id, s.id)).n;
    if (autos >= limits(req.user).auto) throw isPaid(req.user) ? bad(`Your plan runs ${limits(req.user).auto} automatic strategies at once`) : upgrade('More than one automatic Playbook');
    await run('UPDATE user_strategies SET account = ?, mode = ?, state = ?, allocation = ? WHERE id = ?', account, mode, JSON.stringify({ ...s.state, paused: false, skipNext: false }), Math.min(100, Math.max(1, +(req.body.allocation ?? s.allocation) || 100)), s.id);
    await log(s, req.user.id, 'deployed', `Deployed on ${account === 'paper' ? 'the practice account' : account} (${mode === 'approve' ? 'you approve each rebalance' : 'trades by itself'}), version ${s.versions.length}`);
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.post('/:id/stop', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    await run("UPDATE user_strategies SET mode = 'manual' WHERE id = ?", s.id);
    await log(s, req.user.id, 'override', 'Stopped: it no longer runs by itself (positions are kept)');
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.post('/:id/pause', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s.state, paused: true }), s.id);
    await log(s, req.user.id, 'override', 'Paused: no rebalancing until resumed (immediately)');
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.post('/:id/resume', (req, res, next) => row(req.params.id, req.user.id).then(s => realMoneyGuard(req, res, next, s.account), e => res.status(e.status || 400).json({ error: e.message })), wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s.state, paused: false }), s.id);
    await log(s, req.user.id, 'override', 'Resumed: rebalances again from the next run');
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.post('/:id/skip', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id), skip = req.body?.skip !== false;
    await run('UPDATE user_strategies SET state = ? WHERE id = ?', JSON.stringify({ ...s.state, skipNext: skip }), s.id);
    await log(s, req.user.id, 'override', skip ? 'The next rebalance will be skipped' : 'The next rebalance will run as usual');
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.post('/:id/swap', wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id), from = String(req.body.from || '').toUpperCase(), to = String(req.body.to || '').toUpperCase();
    if (!tickers(s.spec).includes(from)) throw bad(`${from || 'That ticker'} is not in this Playbook`);
    const pb = valid(swapTicker(s.spec, from, to));
    const versions = withVersion(s.versions, pb, `Swapped ${from} for ${to}`);
    await run('UPDATE user_strategies SET spec = ?, versions = ? WHERE id = ?', JSON.stringify(pb), JSON.stringify(versions), s.id);
    await log(s, req.user.id, 'override', `Swapped ${from} for ${to} (version ${versions.length}); takes effect at the next run`);
    res.json(await view(await row(s.id, req.user.id)));
  }));
  r.post('/:id/close', (req, res, next) => row(req.params.id, req.user.id).then(s => realMoneyGuard(req, res, next, s.account), e => res.status(e.status || 400).json({ error: e.message })), wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    const { holdings, results } = await closeAll(s, req.user.id);
    await run("UPDATE user_strategies SET mode = 'manual', state = ? WHERE id = ?", JSON.stringify({ ...s.state, holdings, paused: true }), s.id);
    const summary = results.length ? `Closed all positions now: ${results.map(x => `${x.ok ? '' : '✗ '}SELL ${x.qty} ${x.ticker}`).join(', ')}; stopped` : 'Nothing to close; stopped';
    await log(s, req.user.id, 'override', summary, { results });
    res.json({ ...(await view(await row(s.id, req.user.id))), results });
  }));
  // Rebalance now by hand (the user's own orders; same path as the automatic run).
  r.post('/:id/execute', (req, res, next) => row(req.params.id, req.user.id).then(s => realMoneyGuard(req, res, next, s.account), e => res.status(e.status || 400).json({ error: e.message })), wrap(async (req, res) => {
    const s = await row(req.params.id, req.user.id);
    res.json(await execute(s, req.user.id, { kind: 'manual' }));
  }));
  return r;
}
export { marginMultiple, accountSummary, lastPrice, condLabel };
