// Live ratio pair bots (Automate → Pairs & stat arb → Live ratio): the second signal model of the
// pairs engine, intraday, on live data. The first model ("Statistical (OLS z-score)", src/pairs.js)
// trades daily bars once a day; this one recalculates every few minutes during regular hours.
//
// Data: on start, a window of 1-minute history; then live quotes (midpoint = (bid + ask) / 2) from
// the Alpaca stream, or the last price polled each run when there is no stream for the account.
// Orders: always placeOrder → checkOrder (risk limits, kill switch) → order queue, never a direct
// broker call. Two legs: both are checked (buying power, shortability, risk limits) before either is
// sent; if one fails or fills only partly, the other is closed or balanced at once and the member is
// told. Limits per pair (max loss, max position) and per member (daily loss, orders per minute, the
// pattern-day-trader rule). New bots start on Paper; real money needs an intraday backtest, N days of
// paper results, the password, the step-up check and a clear confirm.
// Experimental and educational: not proven profitable, not investment advice.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, confirmsIdentity } from './auth.js';
import { placeOrder, lastPrice, accountSummary, ACCOUNT_IDS, isAlpaca, isExt, validSymbol, riskDeps } from './brokers.js';
import { checkOrder, killed } from './risk.js';
import { isPaid } from './fees.js';
import { stepUpGuard } from './security.js';
import { notifyUser } from './notify-user.js';
import { pdtAllowed } from './pdt.js';
import * as D from './alpaca/data.js';
import * as M from './pairslive-math.js';

const bad = (m, s = 400, extra = {}) => Object.assign(new Error(m), { status: s, ...extra });
export const NOTE = 'Experimental and educational: this model has not been shown to make money, and it is not investment advice. Do not use it with real money before backtesting it, running it on paper and reviewing the risks.';
export const MIN_PAPER_DAYS = () => Math.max(1, +process.env.PAIRS_LIVE_MIN_PAPER_DAYS || 5);
export const MAX_ORDERS_PER_MIN = () => Math.max(2, +process.env.PAIRS_LIVE_MAX_ORDERS_PER_MIN || 20);
export const DEFAULTS = { dollars: 2000, historyMin: 120, barMin: 5, everyMin: 1, entryPct: 0.6, exitPct: 0.1, stopPct: 2, maxLossUsd: 100, dailyLossUsd: 250, maxPositionUsd: 5000, closeBeforeMin: 10, holdOvernight: false };
const BAR_CHOICES = [1, 5, 15], EVERY_CHOICES = [1, 2, 5, 10, 15];

export function cleanParams(b = {}, prev = DEFAULTS) {
  const s = { ...DEFAULTS, ...prev }, num = (v, d, lo, hi) => { const x = v === undefined || v === '' ? d : +v; if (!Number.isFinite(x)) throw bad('Check the numbers'); return Math.min(hi, Math.max(lo, x)); };
  const o = {
    dollars: num(b.dollars, s.dollars, 100, 1e6), historyMin: Math.round(num(b.historyMin, s.historyMin, 30, 1440)),
    barMin: BAR_CHOICES.includes(+b.barMin) ? +b.barMin : s.barMin, everyMin: EVERY_CHOICES.includes(+b.everyMin) ? +b.everyMin : s.everyMin,
    entryPct: num(b.entryPct, s.entryPct, 0.05, 10), exitPct: num(b.exitPct, s.exitPct, 0, 5), stopPct: num(b.stopPct, s.stopPct, 0.2, 20),
    maxLossUsd: num(b.maxLossUsd, s.maxLossUsd, 1, 1e6), dailyLossUsd: num(b.dailyLossUsd, s.dailyLossUsd, 1, 1e6), maxPositionUsd: num(b.maxPositionUsd, s.maxPositionUsd, 100, 1e7),
    closeBeforeMin: Math.round(num(b.closeBeforeMin, s.closeBeforeMin, 1, 120)), holdOvernight: b.holdOvernight === undefined ? !!s.holdOvernight : !!b.holdOvernight,
  };
  if (o.exitPct >= o.entryPct) throw bad('The exit threshold must be below the entry threshold');
  if (o.stopPct <= o.entryPct) throw bad('The stop must be above the entry threshold');
  if (o.dollars > o.maxPositionUsd) throw bad(`The position size ($${o.dollars}) is over your maximum position ($${o.maxPositionUsd})`);
  if (o.historyMin < o.barMin * 20) throw bad(`The history window needs at least 20 bars: at least ${o.barMin * 20} minutes for ${o.barMin}-minute bars`);
  return o;
}

// ---------- prices: history, live stream or polling ----------
const BUF = new Map(); // symbol -> [{ t, price }]
const keep = (sym, minutes) => { const a = BUF.get(sym) || []; const from = Date.now() - minutes * 60e3 - 3600e3; while (a.length && a[0].t < from) a.shift(); BUF.set(sym, a); return a; };
export const addPoint = (sym, t, price) => { if (!(price > 0)) return; const a = BUF.get(sym) || []; if (!a.length || t >= a.at(-1).t) a.push({ t, price }); BUF.set(sym, a); };
let unwatch = null, watched = '';
async function follow(symbols) {
  const key = [...new Set(symbols)].sort().join(',');
  if (key === watched) return; watched = key; unwatch?.(); unwatch = null;
  if (!symbols.length) return;
  try {
    const S = await import('./alpaca/stream.js');
    if (S.streamEnabled()) unwatch = S.watch(symbols, u => { if (u.bid > 0 && u.ask > 0) addPoint(u.symbol, Date.parse(u.time) || Date.now(), (u.bid + u.ask) / 2); });
  } catch { unwatch = null; }
}
async function loadHistory(sym, minutes) {
  if (!D.dataEnabled() || (BUF.get(sym)?.length || 0) > 5) return;
  const b = await D.bars([sym], { timeframe: '1Min', start: new Date(Date.now() - (minutes + 60) * 60e3 * 3).toISOString(), limit: 5000 }).catch(() => ({}));
  for (const x of b[sym] || []) addPoint(sym, Date.parse(x.t), x.c); // 1-minute closes stand in for midpoints in the history window
}
// The latest price of each leg: the stream's midpoint when it is fresh, otherwise a polled last price.
async function freshPrice(sym, userId) {
  const a = BUF.get(sym), last = a?.at(-1);
  if (last && Date.now() - last.t < 90e3) return { price: last.price, via: 'stream' };
  const p = await lastPrice(sym, userId).catch(() => null);
  if (p > 0) addPoint(sym, Date.now(), p);
  return { price: p, via: 'poll' };
}

// ---------- safety ----------
const recent = new Map(); // userId -> [times of orders]
export function rateOk(userId, n = 1, t = Date.now()) {
  const a = (recent.get(userId) || []).filter(x => t - x < 60e3);
  if (a.length + n > MAX_ORDERS_PER_MIN()) { recent.set(userId, a); return false; }
  for (let i = 0; i < n; i++) a.push(t); recent.set(userId, a); return true;
}
// Can this account short these symbols? Margin on (Margin center); on Alpaca also the account's
// shorting and each symbol's shortable / easy-to-borrow flags.
export async function shortability(userId, account, symbols) {
  const problems = [];
  const { marginOn } = await import('./shortdesk.js');
  if (!(await marginOn(userId, account).catch(() => false))) problems.push('Short selling needs margin: switch it on for this account in Trading tools → Margin center (a brokerage account also needs the brokerage\'s approval).');
  if (isAlpaca(account)) {
    try {
      const { requireTradingFor } = await import('./alpaca/connections.js'), t = await requireTradingFor(userId, account);
      const a = await t.account(); if (a && a.shorting_enabled === false) problems.push('Shorting is not enabled on this Alpaca account.');
      for (const s of symbols) { const x = await t.asset(s).catch(() => null); if (!x) problems.push(`${s}: Alpaca does not list this symbol.`); else { if (!x.tradable) problems.push(`${s} is not tradable on Alpaca.`); if (!x.shortable || x.easy_to_borrow === false) problems.push(`${s} cannot be sold short on Alpaca right now (not shortable or hard to borrow).`); } }
    } catch (e) { problems.push('Could not reach the Alpaca account: ' + e.message); }
  } else if (isExt(account)) {
    // Other brokerages: some do not take short sales through their API here at all.
    const { EXT } = await import('./ext/brokers.js'), b = EXT[account];
    if (!b?.shorts) problems.push(`${b?.name || account} does not support short selling through Brightolio, so it cannot run a pair (one leg is always short).`);
  }
  return problems;
}
// Everything checked before starting: the account, shorting, prices.
export async function preflight(userId, pair) {
  const p = JSON.parse(pair.params), problems = [];
  const { accountsFor } = await import('./ext/routes.js'), acct = (await accountsFor(userId)).find(x => x.id === pair.account);
  if (!acct?.connected) problems.push(`The account "${pair.account}" is not connected.`);
  else problems.push(...await shortability(userId, pair.account, [pair.a, pair.b]));
  for (const s of [pair.a, pair.b]) if (!((await lastPrice(s, userId).catch(() => null)) > 0)) problems.push(`No price for ${s} right now.`);
  if (p.dollars > p.maxPositionUsd) problems.push('The position size is over the maximum position.');
  return problems;
}
const filledQty = (r, want) => (r?.status === 'filled' ? +(r.qty || want) : r?.filled_qty != null && r.status === 'partially_filled' ? +r.filled_qty : ['accepted', 'new', 'pending_new', 'filled'].includes(r?.status) ? want : 0);
// Two legs. Both are checked first (buying power, risk limits); then the short leg is sent first (the
// one most likely to be refused), then the long leg. If the second fails or fills only partly, the
// first is closed or reduced to match at once. deps: { place(order), check(order), summary() }.
export async function openPair({ a, b, qa, qb, pa, pb }, deps) {
  const legs = [{ symbol: a, qty: qa, price: pa }, { symbol: b, qty: qb, price: pb }].filter(l => l.qty).sort((x, y) => (x.qty < 0 ? -1 : 1) - (y.qty < 0 ? -1 : 1));
  if (legs.length !== 2) return { ok: false, why: 'One of the legs is less than one share: raise the position size.' };
  const s = await deps.summary(); const need = legs.reduce((t, l) => t + Math.abs(l.qty) * l.price, 0);
  if (s && Number.isFinite(s.buyingPower) && s.buyingPower < need) return { ok: false, why: `Not enough buying power: $${need.toFixed(0)} needed, $${(+s.buyingPower).toFixed(0)} available.` };
  for (const l of legs) { try { await deps.check(M.orderOf(l.symbol, l.qty)); } catch (e) { return { ok: false, why: `${l.symbol}: ${e.message}` }; } }
  const [first, second] = legs, done = { [a]: 0, [b]: 0 }, notes = [];
  let r1;
  try { r1 = await deps.place({ ...M.orderOf(first.symbol, first.qty), short: first.qty < 0 }); } catch (e) { return { ok: false, why: `${first.symbol} was not sent: ${e.message}` }; }
  const f1 = filledQty(r1, Math.abs(first.qty)); done[first.symbol] = Math.sign(first.qty) * f1;
  if (!f1) return { ok: false, why: `${first.symbol} did not fill (${r1?.status || 'no answer'}); nothing else was sent.` };
  let f2 = 0, err = null;
  try { const r2 = await deps.place({ ...M.orderOf(second.symbol, second.qty), short: second.qty < 0 }); f2 = filledQty(r2, Math.abs(second.qty)); if (!f2) err = `${second.symbol} did not fill (${r2?.status || 'no answer'})`; } catch (e) { err = `${second.symbol} failed: ${e.message}`; }
  done[second.symbol] = Math.sign(second.qty) * f2;
  // Balance: the first leg is reduced to the share of the second that filled (all of it when none did).
  const keepFirst = Math.floor(f1 * (f2 / Math.abs(second.qty))), undo = f1 - keepFirst;
  if (undo > 0) {
    try { await deps.place({ ...M.orderOf(first.symbol, -Math.sign(first.qty) * undo), close: true }); done[first.symbol] = Math.sign(first.qty) * keepFirst || 0; notes.push(`${err || `${second.symbol} filled ${f2} of ${Math.abs(second.qty)}`}: ${undo} ${first.symbol} closed again to keep the pair balanced.`); }
    catch (e) { notes.push(`${err || 'Partial fill'}; closing ${undo} ${first.symbol} also failed (${e.message}). Close it by hand.`); }
  }
  const ok = !!done[a] && !!done[b];
  return { ok, qa: done[a], qb: done[b], notes, why: ok ? 'opened' : notes[0] || err };
}
// Closing: both legs; a leg that fails is reported and kept in the state so the next run retries it.
export async function closePair({ a, b, qa, qb }, deps) {
  const left = { qa, qb }, notes = [];
  for (const [k, sym, q] of [['qa', a, qa], ['qb', b, qb]]) {
    if (!q) continue;
    try { const r = await deps.place({ ...M.orderOf(sym, -q), close: true }); const f = filledQty(r, Math.abs(q)); left[k] = q - Math.sign(q) * f; if (left[k]) notes.push(`${sym}: ${f} of ${Math.abs(q)} closed`); }
    catch (e) { notes.push(`${sym} was not closed: ${e.message}`); }
  }
  return { ok: !left.qa && !left.qb, ...left, notes };
}

// ---------- the engine ----------
const J = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
async function log(pair, kind, detail) { await run('INSERT INTO live_pair_log (pair_id, user_id, kind, detail, at) VALUES (?,?,?,?,?)', pair.id, pair.user_id, kind, typeof detail === 'string' ? detail : JSON.stringify(detail), now()); }
async function save(pair, st, status = pair.status) { await run('UPDATE live_pairs SET state = ?, status = ?, updated_at = ? WHERE id = ?', JSON.stringify(st), status, now(), pair.id); pair.status = status; pair.state = JSON.stringify(st); }
const depsFor = (pair, source) => ({
  place: o => placeOrder(pair.user_id, pair.account, { symbol: o.symbol, side: o.side, qty: o.qty, allowShort: !!o.short }, source),
  check: o => checkOrder(pair.user_id, pair.account, o, source, riskDeps(pair.user_id)),
  summary: () => accountSummary(pair.user_id, pair.account).catch(() => null),
});
const pnlOf = (st, pa, pb) => (st.qa ? st.qa * (pa - st.ea) : 0) + (st.qb ? st.qb * (pb - st.eb) : 0);
async function dayTrades(userId, account, t) { return 2 * (await one("SELECT COUNT(*) c FROM live_pair_log l JOIN live_pairs p ON p.id = l.pair_id WHERE l.user_id = ? AND p.account = ? AND l.kind = 'close' AND l.detail LIKE '%\"sameDay\":true%' AND l.at > ?", userId, account, t - 7 * 864e5)).c; }

// One pair, one run. Returns what it did.
export async function runPair(pair, t = Date.now()) {
  const p = JSON.parse(pair.params), st = J(pair.state, {}), source = `livepair:${pair.id}`, deps = depsFor(pair, source);
  const day = M.utcToNy(t).day; if (st.day !== day) { st.day = day; st.realizedDay = 0; }
  const w = M.tradingWindow(t, p);
  if (await killed(pair.user_id)) { await save(pair, st, 'paused'); await log(pair, 'paused', 'The kill switch is on: the bot is paused and sends no orders. Close any open legs by hand.'); return { paused: 'kill switch' }; }
  if (!w.open) return { idle: w.why };
  await loadHistory(pair.a, p.historyMin); await loadHistory(pair.b, p.historyMin);
  const A = await freshPrice(pair.a, pair.user_id), B = await freshPrice(pair.b, pair.user_id);
  if (!(A.price > 0 && B.price > 0)) { await log(pair, 'skip', 'No price for one of the legs'); return { skip: 'no price' }; }
  const barMs = p.barMin * 60e3, from = t - p.historyMin * 60e3;
  const g = M.align(M.resample(keep(pair.a, p.historyMin).filter(x => x.t >= from), barMs), M.resample(keep(pair.b, p.historyMin).filter(x => x.t >= from), barMs));
  const m = M.model(g.ca, g.cb);
  // Paper results count per day the bot ran on paper in regular hours.
  if (pair.account === 'paper') { st.paperDays = [...new Set([...(st.paperDays || []), day])].slice(-60); }
  const pos = st.pos || 0, open = !!(st.qa || st.qb);
  const unreal = open ? pnlOf(st, A.price, B.price) : 0; st.unrealized = unreal;
  // Without enough history the model waits, but closing (the cutoff, a loss limit) never does.
  if (!m && !(open && (w.flatten || unreal <= -p.maxLossUsd))) { await save(pair, st); return { skip: `history: ${g.ca.length} of 20 bars` }; }
  if (m) {
    st.chart = [...(st.chart || []), { t, pa: A.price, pb: B.price, beta: m.beta, vr: m.volRatio, div: m.divergence }].slice(-300);
    st.last = { ...m, pa: A.price, pb: B.price, via: A.via === 'stream' && B.via === 'stream' ? 'stream' : 'poll', at: t };
  }
  // Limits: the pair's max loss, the member's daily loss over all live-ratio bots, then the signal.
  let want = m ? M.signal(m.divergence, pos, p) : { want: 0, why: 'closing' }, why = want.why; want = want.want;
  if (open && unreal <= -p.maxLossUsd) { want = 0; why = `max loss for this pair reached ($${unreal.toFixed(2)})`; }
  const mine = await all("SELECT state FROM live_pairs WHERE user_id = ? AND status = 'running'", pair.user_id);
  const dayPl = mine.reduce((s, r) => { const x = J(r.state, {}); return s + (x.day === day ? (x.realizedDay || 0) : 0) + (x.unrealized || 0); }, 0);
  if (dayPl <= -p.dailyLossUsd) { if (open) { want = 0; why = `daily loss limit reached ($${dayPl.toFixed(2)})`; } else { await save(pair, st, 'paused'); await log(pair, 'paused', `Daily loss limit reached ($${dayPl.toFixed(2)}): paused until you start it again.`); return { paused: 'daily loss' }; } }
  if (w.flatten && open) { want = 0; why = w.why; }
  if (!w.enter && !open) want = 0;
  if (want === pos || (want && !w.enter)) { await save(pair, st); return { hold: why }; }
  if (open) {
    if (!rateOk(pair.user_id, 2, t)) { await save(pair, st); await log(pair, 'skip', 'Order rate limit: waiting for the next run'); return { skip: 'rate' }; }
    const c = await closePair({ a: pair.a, b: pair.b, qa: st.qa, qb: st.qb }, deps);
    const realized = pnlOf(st, A.price, B.price);
    const sameDay = M.utcToNy(st.openedAt || 0).day === day;
    if (c.ok) { st.realizedDay = (st.realizedDay || 0) + realized; st.realizedTotal = (st.realizedTotal || 0) + realized; Object.assign(st, { pos: 0, qa: 0, qb: 0, unrealized: 0 }); await log(pair, 'close', { why, realized: +realized.toFixed(2), sameDay, pa: A.price, pb: B.price }); }
    else { Object.assign(st, { qa: c.qa, qb: c.qb }); await log(pair, 'error', { why: 'Closing did not complete', notes: c.notes }); await notifyUser(pair.user_id, `Live pair ${pair.a}/${pair.b}: closing did not complete. ${c.notes.join(' ')}`).catch(() => {}); }
    await save(pair, st); return { closed: c.ok, why };
  }
  // Opening: PDT, rate limit, size, then both legs.
  if (pair.account !== 'paper') {
    const s = await accountSummary(pair.user_id, pair.account).catch(() => ({ equity: 0 }));
    const pdt = pdtAllowed({ account: pair.account, equity: s.equity, dayTrades: (await dayTrades(pair.user_id, pair.account, t)) + (p.holdOvernight ? 0 : 1) });
    if (!pdt.ok) { await log(pair, 'skip', pdt.why); await save(pair, st); return { skip: 'pdt' }; }
  }
  if (!rateOk(pair.user_id, 2, t)) { await log(pair, 'skip', 'Order rate limit: waiting for the next run'); await save(pair, st); return { skip: 'rate' }; }
  const q = M.legQty(Math.min(p.dollars, p.maxPositionUsd), A.price, B.price, m.volRatio, want);
  const r = await openPair({ a: pair.a, b: pair.b, qa: q.qa, qb: q.qb, pa: A.price, pb: B.price }, deps);
  if (r.qa || r.qb) Object.assign(st, { pos: r.ok ? want : 0, qa: r.qa || 0, qb: r.qb || 0, ea: A.price, eb: B.price, openedAt: t });
  await log(pair, r.ok ? 'open' : 'error', { why: r.ok ? why : r.why, qa: r.qa || 0, qb: r.qb || 0, pa: A.price, pb: B.price, notes: r.notes || [] });
  if (!r.ok && (r.notes?.length || r.qa || r.qb)) await notifyUser(pair.user_id, `Live pair ${pair.a}/${pair.b}: ${r.why} ${(r.notes || []).join(' ')}`).catch(() => {});
  await save(pair, st); return { opened: r.ok, why: r.ok ? why : r.why };
}

// The job, every minute: running bots whose interval is due.
const lastRun = new Map();
export async function tick(t = Date.now()) {
  const rows = await all("SELECT * FROM live_pairs WHERE status = 'running'");
  await follow(rows.flatMap(r => [r.a, r.b]));
  let n = 0;
  for (const pair of rows) {
    const p = JSON.parse(pair.params);
    if (lastRun.has(pair.id) && t - lastRun.get(pair.id) < p.everyMin * 60e3 - 5e3) continue;
    lastRun.set(pair.id, t);
    try { await runPair(pair, t); n++; } catch (e) { await log(pair, 'error', e.message.slice(0, 300)).catch(() => {}); }
  }
  return n;
}

// ---------- API ----------
export const liveRouter = (() => {
  const r = express.Router(); r.use(requireUser);
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(e.status || 500).json({ error: e.status ? e.message : 'Not available right now.', ...(e.problems ? { problems: e.problems } : {}), ...(e.upgrade ? { upgrade: true, feature: e.feature } : {}) }));
  const mine = async req => { const x = await one('SELECT * FROM live_pairs WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!x) throw bad('Not found', 404); return x; };
  const view = async x => ({ ...x, params: JSON.parse(x.params), state: J(x.state, {}), log: await all('SELECT kind, detail, at FROM live_pair_log WHERE pair_id = ? ORDER BY id DESC LIMIT 100', x.id), minPaperDays: MIN_PAPER_DAYS() });
  const sym = v => { const s = String(v || '').trim().toUpperCase(); if (!validSymbol(s)) throw bad(`"${v}" is not a valid ticker`); return s; };
  // The account picker: only the member's connected accounts.
  r.get('/accounts', wrap(async (req, res) => { const { accountsFor } = await import('./ext/routes.js'); res.json((await accountsFor(req.user.id)).filter(a => a.connected).map(a => ({ id: a.id, name: a.name, live: !!a.live }))); }));
  r.get('/', wrap(async (req, res) => res.json({ bots: await Promise.all((await all('SELECT * FROM live_pairs WHERE user_id = ? ORDER BY id', req.user.id)).map(view)), defaults: DEFAULTS, note: NOTE, minPaperDays: MIN_PAPER_DAYS(), stream: (await import('./alpaca/stream.js')).streamEnabled() })));
  // New bots always start on Paper.
  r.post('/', wrap(async (req, res) => {
    const a = sym(req.body.a), b = sym(req.body.b); if (a === b) throw bad('Pick two different tickers');
    if ((await one('SELECT COUNT(*) n FROM live_pairs WHERE user_id = ?', req.user.id)).n >= 10) throw bad('Up to 10 live-ratio bots');
    const params = cleanParams(req.body);
    const x = await run("INSERT INTO live_pairs (user_id, a, b, account, params, status, state, created_at, updated_at) VALUES (?,?,?,'paper',?,'stopped','{}',?,?)", req.user.id, a, b, JSON.stringify(params), now(), now());
    res.json(await view(await one('SELECT * FROM live_pairs WHERE id = ?', Number(x.lastInsertRowid))));
  }));
  r.put('/:id', wrap(async (req, res) => {
    const x = await mine(req); if (x.status === 'running') throw bad('Pause the bot before changing its settings', 409);
    const params = cleanParams(req.body, JSON.parse(x.params));
    await run('UPDATE live_pairs SET params = ?, updated_at = ? WHERE id = ?', JSON.stringify(params), now(), x.id); res.json(await view(await mine(req)));
  }));
  r.get('/:id', wrap(async (req, res) => res.json(await view(await mine(req)))));
  // Start: everything is checked first; nothing starts when shorting or the account is not ready.
  r.post('/:id/start', (req, res, next) => (req.body?.account && req.body.account !== 'paper' ? stepUpGuard(req, res, next) : next()), wrap(async (req, res) => {
    const x = await mine(req), problems = await preflight(req.user.id, x);
    if (problems.length) throw bad('The bot cannot start: ' + problems[0], 409, { problems });
    if (await killed(req.user.id)) throw bad('The kill switch is on (Risk controls): turn it off first.', 409);
    await run("UPDATE live_pairs SET status = 'running', updated_at = ? WHERE id = ?", now(), x.id);
    await log(x, 'start', `Started on ${x.account === 'paper' ? 'Paper' : x.account}`); res.json(await view(await mine(req)));
  }));
  r.post('/:id/pause', wrap(async (req, res) => { const x = await mine(req); await run("UPDATE live_pairs SET status = 'paused', updated_at = ? WHERE id = ?", now(), x.id); await log(x, 'paused', 'Paused by you: open legs are kept'); res.json(await view(await mine(req))); }));
  // Stop: closes both legs (through the same checks) and stops.
  r.post('/:id/stop', wrap(async (req, res) => {
    const x = await mine(req), st = J(x.state, {});
    let notes = [];
    if (st.qa || st.qb) { const c = await closePair({ a: x.a, b: x.b, qa: st.qa, qb: st.qb }, depsFor(x, `livepair:${x.id}`)); notes = c.notes; Object.assign(st, { qa: c.qa, qb: c.qb, pos: c.ok ? 0 : st.pos }); }
    await save(x, st, 'stopped'); await log(x, 'stop', notes.length ? { notes } : 'Stopped by you'); res.json({ ...(await view(await mine(req))), notes });
  }));
  r.delete('/:id', wrap(async (req, res) => { const x = await mine(req), st = J(x.state, {}); if (st.qa || st.qb) throw bad('Stop the bot first: it still holds positions', 409); await run('DELETE FROM live_pairs WHERE id = ?', x.id); res.json({ ok: true }); }));
  // Intraday backtest (Alpaca 1-minute bars) next to the OLS model's daily backtest for the same pair.
  r.post('/:id/backtest', wrap(async (req, res) => {
    const x = await mine(req), p = JSON.parse(x.params), days = Math.min(30, Math.max(3, +req.body?.days || 10));
    if (!D.dataEnabled()) throw bad('Intraday backtests need Alpaca market data, which is not set up on this server.', 503);
    const b = await D.bars([x.a, x.b], { timeframe: p.barMin === 1 ? '1Min' : p.barMin === 5 ? '5Min' : '15Min', start: new Date(Date.now() - days * 1.6 * 864e5).toISOString(), limit: 10000 });
    const pts = s => (b[s] || []).map(v => ({ t: Date.parse(v.t), close: v.c })), g = M.align(pts(x.a), pts(x.b));
    if (g.ca.length < 60) throw bad(`Only ${g.ca.length} shared bars for ${x.a} and ${x.b}: not enough for a backtest`, 409);
    const window = Math.max(20, Math.round(p.historyMin / p.barMin)), live = M.backtest(g.ca, g.cb, { window, entryPct: p.entryPct, exitPct: p.exitPct, stopPct: p.stopPct, costBps: +req.body?.costBps || 1, slipBps: +req.body?.slipBps || 2, borrowPct: +req.body?.borrowPct || 3, barsPerDay: Math.round(390 / p.barMin) });
    let ols = null; try { const P = await import('./pairs.js'); const d = await P.loadPair(x.a, x.b, req.user.id); const bt = P.backtestPair(d); ols = { from: bt.from, to: bt.to, neutral: bt.neutral }; } catch (e) { ols = { error: e.message }; }
    const st = J(x.state, {}); st.backtest = { at: Date.now(), days, bars: live.bars, total: live.total, trades: live.trades, hitRate: live.hitRate, maxDrawdown: live.maxDrawdown, sharpe: live.sharpe };
    await save(x, st); res.json({ live: { ...live, curve: live.curve.filter((_, i, a) => i % Math.ceil(a.length / 300) === 0) }, ols, note: 'Hypothetical: past bars, with the costs, slippage and short borrow fee shown. Not a prediction.' });
  }));
  // Real money: an intraday backtest in the last 30 days, at least N days on Paper, Pro, the
  // password, the step-up check and a clear confirm.
  r.post('/:id/live', stepUpGuard, wrap(async (req, res) => {
    const x = await mine(req), st = J(x.state, {}), account = String(req.body?.account || '');
    if (!isPaid(req.user)) throw bad('Real-money pair bots are part of the Pro plan', 402, { upgrade: true, feature: 'Live pair bots on your brokerage account' });
    if (!ACCOUNT_IDS.includes(account) || account === 'paper') throw bad('Pick a brokerage account');
    const { accountsFor } = await import('./ext/routes.js'); if (!(await accountsFor(req.user.id)).some(a => a.id === account && a.connected)) throw bad('That account is not connected');
    if (!(st.backtest?.at > Date.now() - 30 * 864e5)) throw bad('Run the intraday backtest first (in the last 30 days).', 409);
    const days = (st.paperDays || []).length; if (days < MIN_PAPER_DAYS()) throw bad(`Run it on Paper for at least ${MIN_PAPER_DAYS()} trading days first (${days} so far).`, 409);
    if (x.status === 'running' || st.qa || st.qb) throw bad('Stop the paper bot first (it must hold no positions).', 409);
    if (req.body?.understood !== true) throw bad('Confirm that you understand this is experimental and can lose money.', 400);
    if (!confirmsIdentity(req.user, req.body || {})) throw bad('Enter your password to turn on real money.', 401);
    const problems = await shortability(req.user.id, account, [x.a, x.b]); if (problems.length) throw bad('This account cannot run the pair: ' + problems[0], 409, { problems });
    await run("UPDATE live_pairs SET account = ?, status = 'stopped', updated_at = ? WHERE id = ?", account, now(), x.id);
    await audit(req.user.id, 'live_pair_real_money', { id: x.id, account, a: x.a, b: x.b }, req.ip).catch(() => {});
    await log(x, 'live', `Moved to ${account} (real money) after ${days} days on Paper. Press Start to run it.`);
    res.json(await view(await mine(req)));
  }));
  // Back to Paper at any time.
  r.post('/:id/paper', wrap(async (req, res) => { const x = await mine(req), st = J(x.state, {}); if (st.qa || st.qb || x.status === 'running') throw bad('Stop the bot first', 409); await run("UPDATE live_pairs SET account = 'paper', updated_at = ? WHERE id = ?", now(), x.id); res.json(await view(await mine(req))); }));
  return r;
})();
