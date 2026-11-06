// Every Alpaca account of a user in one picture, without counting anything twice.
//
// Duplicates: the same Alpaca account connected twice (the primary connection and an extra one, or
// keys added again) has the same account number; it is shown once and counted once.
// Master / omnibus accounts: in Alpaca's OmniSub model (and for a main account that holds its sub
// accounts) every sub-account trade is mirrored into the master for settlement, so the master's
// value and positions are the sum of its sub accounts. Adding the master and the subs together
// would double everything. A master is recognised by Alpaca's account type (omnibus) or, when that
// is not given, because its value and every position match the sum of two or more other accounts.
// Totals then use the sub accounts (each one's own detail) and leave the master out, never both.
// Paper (test) and live accounts are never mixed in one total.
import express from 'express';
import { all, one, run, now } from './db.js';
import { requireUser } from './auth.js';
import { tradingFor, extraAlpaca, tradingForAccount } from './alpaca/connections.js';

const r2 = x => +(+x || 0).toFixed(2);
const near = (a, b, rel = 0.01, abs = 1) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);

// The rows to judge: { id, label, role, live, number, type, equity, cash, lastEquity, buyingPower, positions:[{symbol, qty, value, pnl, price}] }
export function dedupe(rows) {
  const out = rows.map(r => ({ ...r, counted: !r.error, why: null }));
  // 1. The same account twice: the first one (the primary connection comes first) stays.
  const seen = new Map();
  for (const r of out) {
    if (!r.counted || !r.number) continue;
    const k = (r.live ? 'L' : 'P') + r.number;
    if (seen.has(k)) { r.counted = false; r.why = 'duplicate'; r.sameAs = seen.get(k); } else seen.set(k, r.id);
  }
  // 2. Masters: Alpaca says so, or the value and every position are the sum of 2+ other accounts.
  for (const live of [true, false]) {
    const group = out.filter(r => r.counted && !!r.live === live && r.id !== 'paper');
    for (const m of group) {
      const others = group.filter(r => r !== m && r.counted);
      const typed = /omni/i.test(m.type || '') && !/sub/i.test(m.type || '');
      if (!typed && (!others.length || !(m.equity > 0))) continue;
      const marked = others.filter(r => /sub/i.test(r.type || '') || r.role === 'sub'), subs = typed || marked.length ? marked : others;
      const eq = subs.reduce((s, r) => s + (+r.equity || 0), 0);
      const qty = {}; for (const r of subs) for (const p of r.positions || []) qty[p.symbol] = (qty[p.symbol] || 0) + (+p.qty || 0);
      const mine = Object.fromEntries((m.positions || []).map(p => [p.symbol, +p.qty || 0]));
      const symbols = new Set([...Object.keys(qty), ...Object.keys(mine)]);
      const samePositions = [...symbols].every(s => near(mine[s] || 0, qty[s] || 0, 0.001, 0.0001));
      const matches = near(m.equity, eq) && samePositions && symbols.size > 0;
      // Left out only when Alpaca says it is a master, or the user marked it Master and it matches
      // its sub accounts. Accounts that merely look alike (for example after Equalize) stay counted.
      if (typed || (m.role === 'main' && subs.length >= 1 && matches)) { m.counted = false; m.why = 'master'; m.subs = subs.map(r => r.id); }
      else if (subs.length >= 2 && matches) m.suspect = subs.map(r => r.id);
    }
  }
  return out;
}

export const WHY = {
  duplicate: 'The same Alpaca account is connected twice; it is counted once.',
  master: 'Master (omnibus) account: its value is the sum of its sub accounts, so the sub accounts are counted instead.',
};
export const SUSPECT = 'This account holds exactly what the others hold together. If it is their master account, set its type to Master so it is not added twice.';

// Adds the counted accounts: value, cash, today, open profit, and positions merged by symbol.
export function totals(rows) {
  const t = { count: rows.length, equity: 0, cash: 0, lastEquity: 0, buyingPower: 0, unrealized: 0, positions: [] };
  const bySym = new Map();
  for (const r of rows) {
    t.equity += +r.equity || 0; t.cash += +r.cash || 0; t.lastEquity += +r.lastEquity || +r.equity || 0; t.buyingPower += +r.buyingPower || 0;
    for (const p of r.positions || []) {
      const x = bySym.get(p.symbol) || { symbol: p.symbol, qty: 0, value: 0, pnl: 0, cost: 0, accounts: [] };
      x.qty += +p.qty || 0; x.value += +p.value || 0; x.pnl += +p.pnl || 0; x.cost += (+p.value || 0) - (+p.pnl || 0); x.accounts.push(r.id);
      bySym.set(p.symbol, x);
    }
  }
  t.positions = [...bySym.values()].map(x => ({ ...x, qty: +x.qty.toFixed(6), value: r2(x.value), pnl: r2(x.pnl), pnlPct: x.cost ? +(x.pnl / x.cost * 100).toFixed(2) : null, weight: t.equity ? +(x.value / t.equity * 100).toFixed(2) : 0 })).sort((a, b) => b.value - a.value);
  t.unrealized = r2(t.positions.reduce((s, p) => s + p.pnl, 0));
  t.dayPl = r2(t.equity - t.lastEquity); t.dayPlPct = t.lastEquity ? +(t.dayPl / t.lastEquity * 100).toFixed(2) : null;
  for (const k of ['equity', 'cash', 'lastEquity', 'buyingPower']) t[k] = r2(t[k]);
  return t;
}

// One equity line for several accounts: their histories added at each time. An account with no
// value yet at a time (opened later) adds nothing; a gap carries its last value forward.
export function combineHistories(list) {
  const times = [...new Set(list.flatMap(h => h.points.map(p => p.t)))].sort((a, b) => a - b);
  const idx = list.map(() => 0), last = list.map(() => null);
  const points = times.map(t => {
    let eq = 0;
    list.forEach((h, i) => { while (idx[i] < h.points.length && h.points[idx[i]].t <= t) { last[i] = h.points[idx[i]].equity; idx[i]++; } if (last[i] != null) eq += last[i]; });
    return { t, equity: r2(eq) };
  });
  return { baseValue: list.reduce((s, h) => s + (+h.baseValue || 0), 0) || points[0]?.equity || 0, points };
}

// ---------- loading from Alpaca ----------
async function connectionsFor(userId) {
  const list = [];
  const primary = await tradingFor(userId).catch(() => null);
  if (primary) list.push({ id: 'alpaca', label: 'Primary Alpaca connection', role: (await one("SELECT v FROM user_settings WHERE user_id = ? AND k = 'primaryRole'", userId).catch(() => null))?.v?.replace(/"/g, '') || 'separate', t: primary });
  for (const x of await extraAlpaca(userId)) list.push({ id: x.id, label: x.label, role: x.role, t: await tradingForAccount(userId, x.id) });
  return list;
}

export async function loadAccounts(userId) {
  const conns = await connectionsFor(userId);
  const rows = await Promise.all(conns.map(async c => {
    try {
      const [a, pos] = await Promise.all([c.t.account(), c.t.positions()]);
      return { id: c.id, label: c.label, role: c.role, live: !!c.t.live, number: a.account_number || null, type: a.account_type || a.account_sub_type || null,
        equity: +a.equity, cash: +a.cash, lastEquity: +a.last_equity, buyingPower: +a.buying_power,
        positions: (pos || []).map(p => ({ symbol: p.symbol, qty: +p.qty, value: +p.market_value, pnl: +p.unrealized_pl, price: +p.current_price })) };
    } catch (e) { return { id: c.id, label: c.label, role: c.role, live: !!c.t?.live, error: e.message, positions: [] }; }
  }));
  return dedupe(rows);
}

const PERIODS = { '1D': '5Min', '1W': '1H', '1M': '1D', '3M': '1D', '6M': '1D', '1A': '1D', all: '1D' };
export async function historyFor(userId, ids, period = '1M') {
  if (!PERIODS[period]) period = '1M';
  const conns = (await connectionsFor(userId)).filter(c => ids.includes(c.id));
  const list = (await Promise.all(conns.map(async c => {
    try {
      const h = await c.t.portfolioHistory({ period: period === 'all' ? undefined : period, timeframe: PERIODS[period], extended_hours: period === '1D' ? true : undefined });
      return { baseValue: h.base_value, points: (h.timestamp || []).map((t, i) => ({ t: t * 1000, equity: h.equity?.[i] })).filter(p => p.equity != null) };
    } catch { return null; }
  }))).filter(Boolean);
  return { period, ...combineHistories(list) };
}

// ---------- the user's own groups ("sub accounts" of their choosing, e.g. Retirement, Kids) ----------
export async function groups(userId) {
  return (await all('SELECT * FROM account_groups WHERE user_id = ? ORDER BY id', userId)).map(g => ({ id: g.id, name: g.name, accounts: JSON.parse(g.accounts), color: g.color }));
}
export async function saveGroup(userId, b, id = null) {
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) throw Object.assign(new Error('Give the group a name'), { status: 400 });
  const accounts = [...new Set((Array.isArray(b.accounts) ? b.accounts : []).map(String).filter(a => a === 'alpaca' || /^alpaca:\d{1,3}$/.test(a)))];
  if (!accounts.length) throw Object.assign(new Error('Pick at least one account for the group'), { status: 400 });
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : null;
  if (id) { await run('UPDATE account_groups SET name = ?, accounts = ?, color = ? WHERE id = ? AND user_id = ?', name, JSON.stringify(accounts), color, id, userId); return id; }
  if ((await one('SELECT COUNT(*) AS n FROM account_groups WHERE user_id = ?', userId)).n >= 12) throw Object.assign(new Error('Up to 12 groups'), { status: 400 });
  return (await run('INSERT INTO account_groups (user_id, name, accounts, color, created_at) VALUES (?,?,?,?,?)', userId, name, JSON.stringify(accounts), color, now())).lastInsertRowid;
}

// ---------- /api/combined: the portfolio of all accounts, or of one group ----------
export const combinedRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const view = String(req.query.view || 'all'), list = await loadAccounts(req.user.id), gs = await groups(req.user.id);
    const g = view.startsWith('g:') ? gs.find(x => String(x.id) === view.slice(2)) : null;
    if (view.startsWith('g:') && !g) throw Object.assign(new Error('That group does not exist any more'), { status: 404 });
    const inView = list.filter(x => !g || g.accounts.includes(x.id));
    // Live money first; when there is none, the Alpaca paper accounts (never both in one total).
    const live = inView.some(x => x.counted && x.live);
    const counted = inView.filter(x => x.counted && !!x.live === live);
    const t = totals(counted);
    const history = req.query.history === '0' ? null : await historyFor(req.user.id, counted.map(x => x.id), String(req.query.period || '1M'));
    res.json({
      view, group: g, live, groups: gs, totals: t, history,
      accounts: inView.map(x => ({ id: x.id, label: x.label, role: x.role, live: x.live, number: x.number ? '…' + String(x.number).slice(-4) : null, counted: x.counted && !!x.live === live, note: x.suspect ? SUSPECT : null, why: x.error || (x.why ? WHY[x.why] : !!x.live !== live ? (x.live ? 'Live account (shown with live money)' : 'Paper account (not added to real money)') : null),
        equity: x.equity ?? null, cash: x.cash ?? null, dayPl: x.lastEquity ? r2(x.equity - x.lastEquity) : null, dayPlPct: x.lastEquity ? +((x.equity - x.lastEquity) / x.lastEquity * 100).toFixed(2) : null, positions: (x.positions || []).length, unrealized: r2((x.positions || []).reduce((s, p) => s + (p.pnl || 0), 0)), share: t.equity && x.counted ? +((x.equity || 0) / t.equity * 100).toFixed(1) : null })),
    });
  });
  r.get('/groups', async (req, res) => res.json(await groups(req.user.id)));
  // An account's type: separate (counted on its own), main (master of sub accounts) or sub.
  r.put('/role', async (req, res) => {
    const id = String(req.body?.id || ''), role = ['separate', 'main', 'sub'].includes(req.body?.role) ? req.body.role : null;
    if (!role) throw Object.assign(new Error('Pick Separate, Master or Sub'), { status: 400 });
    if (id === 'alpaca') await run("INSERT INTO user_settings (user_id, k, v, updated_at) VALUES (?, 'primaryRole', ?, ?) ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", req.user.id, JSON.stringify(role), now());
    else if (/^alpaca:\d{1,3}$/.test(id)) {
      const { setExtraRole } = await import('./alpaca/connections.js');
      if (!(await setExtraRole(req.user.id, id, role))) throw Object.assign(new Error('That account is not connected'), { status: 404 });
    } else throw Object.assign(new Error('Unknown account'), { status: 400 });
    res.json({ ok: true });
  });
  r.post('/groups', async (req, res) => res.json({ id: await saveGroup(req.user.id, req.body || {}) }));
  r.put('/groups/:id', async (req, res) => { await saveGroup(req.user.id, req.body || {}, +req.params.id); res.json({ ok: true }); });
  r.delete('/groups/:id', async (req, res) => { await run('DELETE FROM account_groups WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
})();
