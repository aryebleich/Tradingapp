// Rule-based dynamic portfolios ("baskets"): a universe, if/then filters in the rule language,
// a ranking, top-N selection and a weighting scheme, rebalanced on a schedule. A basket can be
// backtested, deployed to an account with a dollar amount (and monthly contributions, optionally
// pulled from the bank by ACH on an Alpaca brokerage account), shared with the community and
// followed by others, who can keep receiving the creator's updates.
import express from 'express';
import { publicName } from './crypto.js';
import { one, all, run, now, audit } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import { getBars, accountSummary, placeOrder, lastPrice } from './brokers.js';
import { compile } from './engine.js';
import { roc, rsi, vol } from './ta.js';
import { symbolsOf, UNIVERSES } from './scanner.js';
import { nyTime, stockSession } from './time.js';
import { isPaid } from './fees.js';
import { killed } from './risk.js';
import { notifyUser } from './notify-user.js';
import * as B from './alpaca/broker.js';

export const RANKS = { momentum12m: '12-month momentum', momentum6m: '6-month momentum', momentum3m: '3-month momentum', lowvol: 'Lowest volatility', rsi_low: 'Most oversold (RSI)', none: 'No ranking (all that pass)' };
export const WEIGHTS = { equal: 'Equal weight', invvol: 'Inverse volatility (risk parity)', rank: 'By rank (top gets most)', manual: 'Fixed weights you set' };
export const REBALANCE = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export function cleanSpec(b) {
  const s = {
    universe: UNIVERSES[b.universe] ? b.universe : symbolsOf(b.universe).join(','), filters: String(b.filters || '').slice(0, 2000),
    rankBy: RANKS[b.rankBy] ? b.rankBy : 'momentum6m', topN: Math.max(1, Math.min(30, Math.round(+b.topN || 5))),
    weighting: WEIGHTS[b.weighting] ? b.weighting : 'equal', rebalance: REBALANCE[b.rebalance] ? b.rebalance : 'monthly',
    cashPct: Math.max(0, Math.min(90, +b.cashPct || 0)), weights: {},
  };
  if (s.weighting === 'manual') for (const [k, v] of Object.entries(b.weights || {})) if (+v > 0) s.weights[String(k).toUpperCase()] = +v;
  if (!symbolsOf(s.universe).length) throw bad('Add at least one symbol');
  if (s.filters.trim()) compile(s.filters, Array.from({ length: 300 }, (_, i) => 100 + (i % 7)));
  return s;
}

const score = (rankBy, c) => {
  const last = a => a.at(-1);
  if (rankBy === 'momentum12m') return last(roc(c, 252));
  if (rankBy === 'momentum6m') return last(roc(c, 126));
  if (rankBy === 'momentum3m') return last(roc(c, 63));
  if (rankBy === 'lowvol') { const v = vol(c, 60); return v == null ? null : -v; }
  if (rankBy === 'rsi_low') { const r = last(rsi(c, 14)); return r == null ? null : -r; }
  return 0;
};
// Target weights (summing to 1 - cash) from closes up to the decision day.
export function select(spec, closesBySymbol) {
  const pass = [];
  for (const [sym, c] of Object.entries(closesBySymbol)) {
    if (!c || c.length < 30) continue;
    if (spec.filters.trim()) { const fns = compile(spec.filters, c); if (!fns.every(f => f(c.length - 1))) continue; }
    const sc = score(spec.rankBy, c); if (sc == null || !Number.isFinite(sc)) continue;
    pass.push({ sym, score: sc, vol: vol(c, 60) || 20 });
  }
  if (spec.weighting === 'manual') {
    const keep = pass.filter(p => spec.weights[p.sym]);
    const tot = keep.reduce((a, p) => a + spec.weights[p.sym], 0);
    return Object.fromEntries(keep.map(p => [p.sym, spec.weights[p.sym] / tot * (1 - spec.cashPct / 100)]));
  }
  const top = (spec.rankBy === 'none' ? pass : pass.sort((a, b) => b.score - a.score)).slice(0, spec.topN);
  const raw = top.map((p, i) => (spec.weighting === 'invvol' ? 1 / p.vol : spec.weighting === 'rank' ? top.length - i : 1));
  const tot = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(top.map((p, i) => [p.sym, raw[i] / tot * (1 - spec.cashPct / 100)]));
}

const isRebalanceDay = (rebalance, prev, day) => {
  if (!prev) return true;
  if (rebalance === 'weekly') return new Date(day).getUTCDay() < new Date(prev).getUTCDay() || Date.parse(day) - Date.parse(prev) > 6 * 864e5;
  if (rebalance === 'quarterly') return Math.floor((+day.slice(5, 7) - 1) / 3) !== Math.floor((+prev.slice(5, 7) - 1) / 3) || day.slice(0, 4) !== prev.slice(0, 4);
  return day.slice(0, 7) !== prev.slice(0, 7);
};

const yearsAgo = n => new Date(Date.now() - n * 365 * 864e5).toISOString().slice(0, 10);
async function loadCloses(userId, symbols, years) {
  const out = {};
  await Promise.all(symbols.map(async s => { try { const b = await getBars(s, yearsAgo(years), userId); out[s] = b; } catch {} }));
  return out;
}

// Backtest: rebalances on schedule using only data known on that day, holds between rebalances,
// charges 0.05% of each trade, compares with SPY.
export async function backtestBasket(userId, spec, years = 6) {
  const syms = symbolsOf(spec.universe);
  const data = await loadCloses(userId, [...new Set([...syms, 'SPY'])], years + 1);
  const avail = syms.filter(s => data[s]?.closes?.length > 260);
  if (!avail.length) throw bad('No price history for these symbols');
  // Common trading days across all symbols.
  const sets = avail.map(s => new Map(data[s].dates.map((d, i) => [d, data[s].closes[i]])));
  const days = data[avail[0]].dates.filter(d => sets.every(m => m.has(d)));
  const start = days.findIndex(d => d >= yearsAgo(years)), w0 = Math.max(260, start);
  if (days.length - w0 < 120) throw bad('Not enough overlapping history');
  const px = (s, i) => sets[avail.indexOf(s)].get(days[i]);
  let eq = 1, hold = {}, prev = null, turnover = 0, rebalances = 0, peak = 1, dd = 0;
  const curve = [], spy = data.SPY ? new Map(data.SPY.dates.map((d, i) => [d, data.SPY.closes[i]])) : null, spy0 = spy?.get(days[w0]);
  const rets = [], picks = [];
  for (let i = w0; i < days.length; i++) {
    if (i > w0) { // drift with prices
      let r = 0; for (const [s, w] of Object.entries(hold)) r += w * (px(s, i) / px(s, i - 1) - 1);
      eq *= 1 + r; rets.push(r);
      const tot = Object.entries(hold).reduce((a, [s, w]) => a + w * px(s, i) / px(s, i - 1), 0) + (1 - Object.values(hold).reduce((a, b) => a + b, 0));
      hold = Object.fromEntries(Object.entries(hold).map(([s, w]) => [s, w * px(s, i) / px(s, i - 1) / tot]));
    }
    if (isRebalanceDay(spec.rebalance, prev, days[i])) {
      const closes = Object.fromEntries(avail.map(s => [s, data[s].closes.slice(0, data[s].dates.indexOf(days[i]) + 1)]));
      const target = select(spec, closes);
      const t = [...new Set([...Object.keys(hold), ...Object.keys(target)])].reduce((a, s) => a + Math.abs((target[s] || 0) - (hold[s] || 0)), 0);
      eq *= 1 - t * 0.0005; turnover += t; rebalances++; hold = target; prev = days[i];
      if (picks.length < 400) picks.push({ day: days[i], holdings: Object.keys(target) });
    }
    peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    if ((i - w0) % 5 === 0 || i === days.length - 1) curve.push({ d: days[i], eq: +eq.toFixed(4), spy: spy && spy0 ? +(spy.get(days[i]) / spy0).toFixed(4) : null });
  }
  const yrs = (days.length - w0) / 252, m = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1));
  const spyEnd = curve.at(-1)?.spy;
  return {
    curve, picks: picks.slice(-24), from: days[w0], to: days.at(-1), symbolsUsed: avail.length, dataSource: data[avail[0]].source,
    stats: {
      totalReturn: +((eq - 1) * 100).toFixed(1), cagr: +((eq ** (1 / yrs) - 1) * 100).toFixed(1), maxDrawdown: +(dd * 100).toFixed(1),
      sharpe: sd ? +(m / sd * Math.sqrt(252)).toFixed(2) : null, volatility: +(sd * Math.sqrt(252) * 100).toFixed(1),
      spyCagr: spyEnd ? +((spyEnd ** (1 / yrs) - 1) * 100).toFixed(1) : null, rebalances, avgTurnover: +(turnover / rebalances * 100).toFixed(0),
    },
  };
}

export async function currentTargets(userId, spec) {
  const syms = symbolsOf(spec.universe), data = await loadCloses(userId, syms, 2);
  return select(spec, Object.fromEntries(Object.entries(data).map(([s, b]) => [s, b.closes])));
}

// Moves a deployed basket to its target weights: sells first, then buys. The basket tracks its own
// shares, so other positions in the same account are left alone.
export async function rebalance(bk, { t = now(), contribute = 0 } = {}) {
  const spec = JSON.parse(bk.spec), holdings = JSON.parse(bk.holdings || '{}'), log = [];
  const target = await currentTargets(bk.user_id, spec);
  const prices = {}; for (const s of new Set([...Object.keys(holdings), ...Object.keys(target)])) prices[s] = await lastPrice(s, bk.user_id).catch(() => null);
  const value = Object.entries(holdings).reduce((a, [s, q]) => a + q * (prices[s] || 0), 0);
  const budget = Math.max(value, bk.amount || 0) + contribute;
  for (const [s, q] of Object.entries(holdings)) {
    const want = (target[s] || 0) * budget / (prices[s] || Infinity), sell = q - want;
    if (sell > 1e-6 && sell * (prices[s] || 0) >= 1) {
      try { await placeOrder(bk.user_id, bk.account, { symbol: s, side: 'sell', qty: +sell.toFixed(6), expectedPrice: prices[s], signalAt: t }, `basket:${bk.id}`); holdings[s] = +(q - sell).toFixed(6); log.push(`sold ${sell.toFixed(4)} ${s}`); }
      catch (e) { log.push(`${s}: ${e.message}`); }
    }
    if (holdings[s] <= 1e-6) delete holdings[s];
  }
  for (const [s, w] of Object.entries(target)) {
    if (!prices[s]) { log.push(`${s}: no price`); continue; }
    const have = (holdings[s] || 0) * prices[s], buy = w * budget - have;
    if (buy >= 1) {
      try { const r = await placeOrder(bk.user_id, bk.account, { symbol: s, side: 'buy', notional: +buy.toFixed(2), expectedPrice: prices[s], signalAt: t }, `basket:${bk.id}`); holdings[s] = +((holdings[s] || 0) + (r.qty || buy / prices[s])).toFixed(6); log.push(`bought $${buy.toFixed(2)} ${s}`); }
      catch (e) { log.push(`${s}: ${e.message}`); }
    }
  }
  await run('UPDATE baskets SET holdings = ?, last_rebalance = ?, amount = ?, updated_at = ? WHERE id = ?', JSON.stringify(holdings), nyTime(t).day, +budget.toFixed(2), now(), bk.id);
  return { target, holdings, log };
}

// Scheduler: contributions on their day of the month, then rebalances when the schedule says so.
export async function runBaskets(t = now()) {
  const n = nyTime(t); if (!stockSession(t) || n.minutes < 600) return 0; // from 10:00 New York time
  const list = await all('SELECT b.*, u.plan, u.role, u.plan_status FROM baskets b JOIN users u ON u.id = b.user_id WHERE b.deployed = 1');
  let ran = 0;
  for (const bk of list) {
    if (await killed(bk.user_id)) continue;
    const spec = JSON.parse(bk.spec);
    const contribDue = bk.contribution > 0 && +n.day.slice(8) >= (bk.contrib_day || 1) && (bk.last_contrib || '').slice(0, 7) !== n.day.slice(0, 7);
    const rebalDue = !bk.last_rebalance || isRebalanceDay(spec.rebalance, bk.last_rebalance, n.day);
    if (!contribDue && !rebalDue) continue;
    if (!(await run('UPDATE baskets SET last_rebalance = ? WHERE id = ? AND (last_rebalance IS NULL OR last_rebalance = ?)', n.day, bk.id, bk.last_rebalance)).changes) continue;
    ran++;
    let note = '';
    if (bk.account !== 'paper' && !isPaid(bk)) { await run('UPDATE baskets SET deployed = 0 WHERE id = ?', bk.id); await notifyUser(bk.user_id, `Portfolio "${bk.name}" stopped: real accounts need the Pro plan.`); continue; }
    if (contribDue) {
      await run('UPDATE baskets SET last_contrib = ? WHERE id = ?', n.day, bk.id);
      if (bk.ach_relationship && bk.account === 'alpaca') {
        try { const ba = await one('SELECT account_id FROM broker_accounts WHERE user_id = ?', bk.user_id); await B.createTransfer(ba.account_id, { transfer_type: 'ach', relationship_id: bk.ach_relationship, amount: bk.contribution.toFixed(2), direction: 'INCOMING', timing: 'immediate' }); note = `ACH deposit of $${bk.contribution} requested. `; }
        catch (e) { note = `ACH deposit failed: ${e.message}. `; }
      }
    }
    try { const r = await rebalance({ ...bk, last_rebalance: n.day }, { t, contribute: contribDue ? bk.contribution : 0 }); note += r.log.join('; ') || 'no trades needed'; }
    catch (e) { note += 'rebalance failed: ' + e.message; }
    await notifyUser(bk.user_id, `Portfolio "${bk.name}": ${note}`.slice(0, 600));
  }
  return ran;
}


export async function publicBaskets() {
  const rows = await all('SELECT b.id, b.name, b.description, b.spec, b.stats, b.updated_at, u.id uid, (SELECT COUNT(*) FROM baskets f WHERE f.source_id = b.id) followers FROM baskets b JOIN users u ON u.id = b.user_id WHERE b.public = 1 ORDER BY followers DESC, b.id DESC LIMIT 100');
  return rows.map(r => ({ id: r.id, kind: 'basket', name: r.name, description: r.description, creator: publicName(r.uid), followers: r.followers, spec: JSON.parse(r.spec), stats: r.stats ? JSON.parse(r.stats) : null, updatedAt: r.updated_at }));
}

export const basketsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/meta', (req, res) => res.json({ ranks: RANKS, weights: WEIGHTS, rebalance: REBALANCE, universes: Object.fromEntries(Object.entries(UNIVERSES).map(([k, v]) => [k, v.name])) }));
  r.post('/backtest', async (req, res) => {
    if (!rateLimit('bkt:' + req.user.id, 30, 3600e3)) throw bad('Too many backtests this hour', 429);
    const spec = cleanSpec(req.body || {});
    res.json({ spec, ...(await backtestBasket(req.user.id, spec, Math.max(2, Math.min(15, +req.body.years || 6)))), today: await currentTargets(req.user.id, spec) });
  });
  r.get('/', async (req, res) => res.json((await all('SELECT * FROM baskets WHERE user_id = ? ORDER BY id DESC', req.user.id)).map(b => ({ ...b, spec: JSON.parse(b.spec), holdings: JSON.parse(b.holdings || '{}'), stats: b.stats ? JSON.parse(b.stats) : null }))));
  r.get('/community', async (req, res) => res.json(await publicBaskets()));
  const limitFor = u => (isPaid(u) ? 50 : 2);
  r.post('/', async (req, res) => {
    if ((await one('SELECT COUNT(*) n FROM baskets WHERE user_id = ?', req.user.id)).n >= limitFor(req.user)) throw Object.assign(bad('The free plan has 2 portfolios'), { status: 402, upgrade: true, feature: 'More rule-based portfolios' });
    const spec = cleanSpec(req.body || {});
    const bt = await backtestBasket(req.user.id, spec).catch(() => null);
    const id = (await run('INSERT INTO baskets (user_id, name, description, spec, stats, public, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', req.user.id, String(req.body.name || 'My portfolio').slice(0, 60), String(req.body.description || '').slice(0, 600), JSON.stringify(spec), bt ? JSON.stringify({ ...bt.stats, from: bt.from, to: bt.to }) : null, req.body.public ? 1 : 0, now(), now())).lastInsertRowid;
    res.json({ id });
  });
  const mine = async (req) => { const b = await one('SELECT * FROM baskets WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!b) throw bad('No such portfolio', 404); return b; };
  r.put('/:id', async (req, res) => {
    const b = await mine(req), spec = cleanSpec(req.body || {});
    const bt = await backtestBasket(req.user.id, spec).catch(() => null);
    await run('UPDATE baskets SET name = ?, description = ?, spec = ?, stats = ?, public = ?, updated_at = ? WHERE id = ?', String(req.body.name || b.name).slice(0, 60), String(req.body.description ?? b.description ?? '').slice(0, 600), JSON.stringify(spec), bt ? JSON.stringify({ ...bt.stats, from: bt.from, to: bt.to }) : b.stats, req.body.public ? 1 : 0, now(), b.id);
    // Followers who chose to receive updates get the new rules.
    await run('UPDATE baskets SET spec = ?, updated_at = ? WHERE source_id = ? AND follow_updates = 1', JSON.stringify(spec), now(), b.id);
    res.json({ ok: true });
  });
  r.post('/:id/deploy', async (req, res) => {
    const b = await mine(req), on = req.body.on !== false, account = String(req.body.account || 'paper');
    if (on && account !== 'paper' && !isPaid(req.user)) throw Object.assign(bad('Running portfolios on real accounts is part of Pro'), { status: 402, upgrade: true, feature: 'Automated portfolios on real accounts' });
    const amount = Math.max(10, +req.body.amount || 0), contribution = Math.max(0, +req.body.contribution || 0), day = Math.max(1, Math.min(28, +req.body.contribDay || 1));
    if (on && !(amount > 0)) throw bad('Enter an amount');
    await run('UPDATE baskets SET deployed = ?, account = ?, amount = ?, contribution = ?, contrib_day = ?, ach_relationship = ?, last_rebalance = CASE WHEN ? THEN NULL ELSE last_rebalance END, updated_at = ? WHERE id = ?',
      on ? 1 : 0, account, amount, contribution || null, day, req.body.achRelationship || null, on ? 1 : 0, now(), b.id);
    await audit(req.user.id, on ? 'basket_deployed' : 'basket_stopped', { id: b.id, account, amount }, req.ip);
    res.json({ ok: true });
  });
  r.post('/:id/rebalance', async (req, res) => {
    const b = await mine(req); if (!b.deployed) throw bad('Deploy the portfolio first');
    if (await killed(req.user.id)) throw bad('Kill switch is on', 409);
    res.json(await rebalance(b));
  });
  r.post('/:id/follow', async (req, res) => {
    const src = await one('SELECT * FROM baskets WHERE id = ? AND public = 1', +req.params.id); if (!src) throw bad('That portfolio is not shared', 404);
    if ((await one('SELECT COUNT(*) n FROM baskets WHERE user_id = ?', req.user.id)).n >= limitFor(req.user)) throw Object.assign(bad('The free plan has 2 portfolios'), { status: 402, upgrade: true, feature: 'More rule-based portfolios' });
    const id = (await run('INSERT INTO baskets (user_id, name, description, spec, stats, source_id, follow_updates, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', req.user.id, src.name, src.description, src.spec, src.stats, src.id, req.body.followUpdates === false ? 0 : 1, now(), now())).lastInsertRowid;
    res.json({ id });
  });
  r.delete('/:id', async (req, res) => { await mine(req); await run('DELETE FROM baskets WHERE id = ?', +req.params.id); res.json({ ok: true }); });
  return r;
})();
