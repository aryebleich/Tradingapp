// Rules across accounts: one target mix (for example 60% stocks / 40% bonds) for several accounts
// together, checked on a schedule. When the mix has drifted more than the user allows, the trades
// are worked out across the accounts (sell where there is too much, buy where cash is free) and
// wait for one approval tap; nothing trades without it. Options: how far it may drift, cash kept
// aside, whole shares only, buy-only (no selling), skip selling at a gain, smallest trade, and
// whether to sell holdings outside the plan.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { accountSummary, placeOrder, lastPrice, ACCOUNT_IDS } from './brokers.js';
import { notifyUser } from './notify-user.js';
import { nyTime } from './time.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const r2 = x => +(+x || 0).toFixed(2);
export const TEMPLATES = {
  '60/40': { name: '60/40 stocks and bonds', targets: [['VTI', 60], ['BND', 40]] },
  '80/20': { name: '80/20 growth', targets: [['VTI', 80], ['BND', 20]] },
  'three-fund': { name: 'Three-fund portfolio', targets: [['VTI', 50], ['VXUS', 30], ['BND', 20]] },
  'all-weather': { name: 'All-weather', targets: [['VTI', 30], ['TLT', 40], ['IEF', 15], ['GLD', 7.5], ['DBC', 7.5]] },
  'sp500': { name: 'Everything in the S&P 500', targets: [['VOO', 100]] },
};
export const SCHEDULES = { monthly: 1, quarterly: 3, yearly: 12, manual: 0 };
const DEFAULT_OPTIONS = { driftPct: 5, cashPct: 1, wholeShares: false, buyOnly: false, skipGains: false, minTrade: 25, sellOthers: false };

const parse = r => r && { id: r.id, userId: r.user_id, name: r.name, targets: JSON.parse(r.targets), accounts: JSON.parse(r.accounts), schedule: r.schedule, options: { ...DEFAULT_OPTIONS, ...JSON.parse(r.options || '{}') }, pending: r.pending ? JSON.parse(r.pending) : null, lastRun: r.last_run, active: !!r.active };
function cleanRule(b) {
  const targets = (Array.isArray(b.targets) ? b.targets : []).map(t => ({ symbol: String(t.symbol || '').trim().toUpperCase(), pct: +t.pct })).filter(t => t.symbol && t.pct > 0);
  if (!targets.length || targets.length > 20) throw bad('Give 1 to 20 holdings with their share');
  if (targets.some(t => !/^[A-Z][A-Z0-9.\/-]{0,14}$/.test(t.symbol))) throw bad('Check the symbols');
  if (new Set(targets.map(t => t.symbol)).size !== targets.length) throw bad('Each symbol once');
  const sum = targets.reduce((s, t) => s + t.pct, 0);
  if (Math.abs(sum - 100) > 0.01) throw bad(`The shares add up to ${+sum.toFixed(2)}%; make them 100%`);
  const accounts = [...new Set((Array.isArray(b.accounts) ? b.accounts : []).filter(a => ACCOUNT_IDS.includes(a)))];
  if (!accounts.length) throw bad('Pick at least one account');
  const o = b.options || {}, n = (v, d, lo, hi) => (v === undefined || v === '' ? d : Math.min(hi, Math.max(lo, +v)));
  return {
    name: String(b.name || 'My mix').trim().slice(0, 60) || 'My mix', targets, accounts, schedule: SCHEDULES[b.schedule] !== undefined ? b.schedule : 'quarterly',
    options: { driftPct: n(o.driftPct, 5, 0, 50), cashPct: n(o.cashPct, 1, 0, 50), wholeShares: !!o.wholeShares, buyOnly: !!o.buyOnly, skipGains: !!o.skipGains, minTrade: n(o.minTrade, 25, 1, 100000), sellOthers: !!o.sellOthers },
  };
}

// The trades that bring the accounts back to the mix. summaries: { accountId: accountSummary }.
export function planRebalance(rule, summaries, prices = {}) {
  const o = rule.options, want = new Map(rule.targets.map(t => [t.symbol, t.pct / 100]));
  const accts = rule.accounts.filter(a => summaries[a]).map(a => {
    const s = summaries[a];
    return { id: a, cash: +s.cash || 0, pos: Object.fromEntries((s.positions || []).map(p => [p.symbol, { value: +p.value || 0, pnl: +p.pnl || 0, price: +p.price || prices[p.symbol] || 0 }])) };
  });
  // The money the plan covers: cash plus the planned holdings (and the others too, when they are sold).
  const inPlan = sym => want.has(sym) || o.sellOthers;
  const total = accts.reduce((s, a) => s + a.cash + Object.entries(a.pos).filter(([k]) => inPlan(k)).reduce((x, [, p]) => x + p.value, 0), 0);
  const investable = total * (1 - o.cashPct / 100);
  const current = {}; for (const a of accts) for (const [k, p] of Object.entries(a.pos)) if (inPlan(k)) current[k] = (current[k] || 0) + p.value;
  const symbols = [...new Set([...want.keys(), ...Object.keys(current)])];
  const rows = symbols.map(k => ({ symbol: k, target: r2(investable * (want.get(k) || 0)), current: r2(current[k] || 0), targetPct: +((want.get(k) || 0) * 100).toFixed(2), currentPct: total ? +((current[k] || 0) / total * 100).toFixed(2) : 0 }));
  const drift = rows.reduce((m, r) => Math.max(m, Math.abs(r.currentPct - r.targetPct)), 0);
  const orders = [];
  if (total <= 0) return { total: 0, rows, drift: 0, orders, needed: false };
  const price = (a, k) => a.pos[k]?.price || prices[k] || 0;
  const add = (acct, symbol, side, dollars) => {
    if (dollars < o.minTrade) return 0;
    const px = price(acct, symbol);
    if (o.wholeShares) { if (!(px > 0)) return 0; const q = Math.floor(dollars / px); if (q < 1) return 0; orders.push({ account: acct.id, symbol, side, qty: q, price: px, dollars: r2(q * px) }); return q * px; }
    orders.push({ account: acct.id, symbol, side, notional: r2(dollars), price: px || null, dollars: r2(dollars) }); return dollars;
  };
  // Sells first (largest holding first), so their cash can pay for the buys in the same account.
  if (!o.buyOnly) for (const r of rows.filter(x => x.current - x.target > 0)) {
    let left = r.current - r.target;
    for (const a of [...accts].sort((x, y) => (y.pos[r.symbol]?.value || 0) - (x.pos[r.symbol]?.value || 0))) {
      const p = a.pos[r.symbol]; if (!p || left < o.minTrade) continue;
      if (o.skipGains && p.pnl > 0) continue; // selling at a gain would cost tax
      const done = add(a, r.symbol, 'sell', Math.min(left, p.value)); a.cash += done; left -= done;
    }
  }
  for (const r of rows.filter(x => x.target - x.current > 0)) {
    let left = r.target - r.current;
    for (const a of [...accts].sort((x, y) => y.cash - x.cash)) {
      const free = a.cash - (a.cash + Object.values(a.pos).reduce((s, p) => s + p.value, 0)) * o.cashPct / 100;
      if (free < o.minTrade || left < o.minTrade) continue;
      const done = add(a, r.symbol, 'buy', Math.min(left, free)); a.cash -= done; left -= done;
    }
  }
  return { total: r2(total), rows, drift: +drift.toFixed(2), orders, needed: drift >= o.driftPct && orders.length > 0 };
}

async function summariesFor(userId, accounts) {
  const out = {};
  for (const a of accounts) out[a] = await accountSummary(userId, a).catch(() => null);
  return out;
}
async function prices(userId, rule) {
  const out = {};
  for (const t of rule.targets) out[t.symbol] = await lastPrice(t.symbol, userId).catch(() => 0);
  return out;
}
export async function preview(rule) { return planRebalance(rule, await summariesFor(rule.userId, rule.accounts), await prices(rule.userId, rule)); }

// Saves the trades for approval and tells the user; they expire after 5 days.
export async function prepare(rule, { force = false } = {}) {
  const p = await preview(rule);
  if (!p.needed && !force) { await run('UPDATE rules SET last_run = ? WHERE id = ?', now(), rule.id); return { ...p, prepared: false }; }
  if (!p.orders.length) return { ...p, prepared: false };
  await run('UPDATE rules SET pending = ?, last_run = ? WHERE id = ?', JSON.stringify({ at: now(), orders: p.orders, drift: p.drift }), now(), rule.id);
  await notifyUser(rule.userId, `"${rule.name}" has drifted ${p.drift} points from its mix. ${p.orders.length} trades are ready across your accounts; approve them in the app (Rules across accounts).`).catch(() => {});
  return { ...p, prepared: true };
}
export async function approve(rule, userId) {
  const p = rule.pending;
  if (!p) throw bad('Nothing is waiting for approval', 404);
  if (now() - p.at > 5 * 864e5) { await run('UPDATE rules SET pending = NULL WHERE id = ?', rule.id); throw bad('These trades are more than 5 days old. Prepare them again for today\'s prices.', 410); }
  await run('UPDATE rules SET pending = NULL WHERE id = ?', rule.id);
  const results = [];
  for (const o of [...p.orders].sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1))) {
    try { const r = await placeOrder(userId, o.account, { symbol: o.symbol, side: o.side, ...(o.qty ? { qty: o.qty } : { notional: o.notional }) }, `rule:${rule.id}`); results.push({ ...o, ok: true, status: r.status }); }
    catch (e) { results.push({ ...o, ok: false, error: e.message }); }
  }
  await audit(userId, 'rule_approved', { rule: rule.id, orders: results.length, failed: results.filter(r => !r.ok).length });
  return { results };
}

// Scheduled check (from the jobs runner): rules whose month has come, on a weekday after 10:30 New York.
export async function runRules(t = now()) {
  const n = nyTime(t);
  if (n.weekend || n.minutes < 630 || n.minutes > 900) return 0;
  const month = +n.day.slice(5, 7);
  let done = 0;
  for (const r of (await all("SELECT * FROM rules WHERE active = 1 AND schedule != 'manual'")).map(parse)) {
    const every = SCHEDULES[r.schedule]; if (!every || (month - 1) % every !== 0) continue;
    if (r.lastRun && nyTime(r.lastRun).day.slice(0, 7) === n.day.slice(0, 7)) continue; // once in its month
    if (r.pending) continue;
    await prepare(r).catch(e => console.warn('rule', r.id, e.message)); done++;
  }
  return done;
}

export const rulesRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const mine = async req => { const x = parse(await one('SELECT * FROM rules WHERE id = ? AND user_id = ?', +req.params.id, req.user.id)); if (!x) throw bad('Not found', 404); return x; };
  r.get('/', async (req, res) => res.json({ rules: (await all('SELECT * FROM rules WHERE user_id = ? ORDER BY id', req.user.id)).map(parse), templates: TEMPLATES, schedules: Object.keys(SCHEDULES), defaults: DEFAULT_OPTIONS }));
  r.post('/', async (req, res) => {
    if ((await one('SELECT COUNT(*) n FROM rules WHERE user_id = ?', req.user.id)).n >= 20) throw bad('Up to 20 rules');
    const c = cleanRule(req.body || {});
    const id = Number((await run('INSERT INTO rules (user_id, name, targets, accounts, schedule, options, active, created_at) VALUES (?,?,?,?,?,?,1,?)', req.user.id, c.name, JSON.stringify(c.targets), JSON.stringify(c.accounts), c.schedule, JSON.stringify(c.options), now())).lastInsertRowid);
    await audit(req.user.id, 'rule_created', { id }, req.ip);
    res.json({ id });
  });
  r.put('/:id', async (req, res) => {
    const x = await mine(req), c = cleanRule({ ...x, ...req.body, options: { ...x.options, ...(req.body?.options || {}) } });
    await run('UPDATE rules SET name = ?, targets = ?, accounts = ?, schedule = ?, options = ?, active = ?, pending = NULL WHERE id = ?', c.name, JSON.stringify(c.targets), JSON.stringify(c.accounts), c.schedule, JSON.stringify(c.options), req.body?.active === false ? 0 : 1, x.id);
    res.json({ ok: true });
  });
  r.delete('/:id', async (req, res) => { const x = await mine(req); await run('DELETE FROM rules WHERE id = ?', x.id); res.json({ ok: true }); });
  r.get('/:id/preview', async (req, res) => res.json(await preview(await mine(req))));
  r.post('/:id/prepare', async (req, res) => res.json(await prepare(await mine(req), { force: true })));
  r.post('/:id/approve', async (req, res) => res.json(await approve(await mine(req), req.user.id)));
  r.post('/:id/skip', async (req, res) => { const x = await mine(req); await run('UPDATE rules SET pending = NULL WHERE id = ?', x.id); res.json({ ok: true }); });
  return r;
})();
