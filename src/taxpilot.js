// Tax-saving autopilot (an add-on): year-round tax-loss harvesting across all accounts, and the
// best order to sell lots in.
//  - Each week (when switched on) it looks for holdings at a loss worth harvesting, checks every
//    account for a purchase of the same stock in the last 30 days (a wash sale would cancel the
//    loss), and prepares the trades: sell, and optionally buy a similar fund that tracks a
//    different index, so the money stays invested. Nothing trades until the user approves.
//  - After a harvest, buying the same stock back in any real account within 31 days is stopped
//    (it would be a wash sale), unless the user overrides it.
//  - Lots: for a sale, which shares to sell first to owe the least tax, next to FIFO and HIFO.
// Estimates only: the broker's 1099-B is the official record.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { accountSummary, placeOrder, lastPrice, ACCOUNT_IDS } from './brokers.js';
import { accountsFor } from './ext/routes.js';
import { addonOn, requireAddon } from './addons.js';
import { notifyUser } from './notify-user.js';
import { isPaid } from './fees.js';
import { nyTime } from './time.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const DAY = 864e5, r2 = x => +(+x || 0).toFixed(2);
// Similar funds that follow a different index (so not "substantially identical").
export const SWAPS = {
  SPY: 'VTI', VOO: 'VTI', IVV: 'VTI', SPLG: 'VTI', VTI: 'SCHB', ITOT: 'SCHB', SCHB: 'VTI', DIA: 'VTI',
  QQQ: 'VGT', QQQM: 'VGT', VGT: 'XLK', XLK: 'VGT', VUG: 'SCHG', SCHG: 'VUG', VTV: 'SCHV', SCHV: 'VTV',
  IWM: 'VB', VB: 'IJR', IJR: 'VB', VO: 'IJH', IJH: 'VO',
  VXUS: 'IXUS', IXUS: 'VXUS', VEA: 'IEFA', IEFA: 'VEA', VWO: 'IEMG', IEMG: 'VWO',
  BND: 'AGG', AGG: 'BND', TLT: 'VGLT', VGLT: 'TLT', VNQ: 'SCHH', SCHH: 'VNQ', XLE: 'VDE', VDE: 'XLE', XLF: 'VFH', VFH: 'XLF', XLV: 'VHT', VHT: 'XLV',
};
const DEFAULTS = { minLoss: 200, minLossPct: 5, swap: true, weekly: false, accounts: null };
const ltRate = b => (b <= 0.12 ? 0 : b <= 0.35 ? 0.15 : 0.2);

async function state(userId) {
  const r = await one('SELECT * FROM tax_pilot WHERE user_id = ?', userId);
  const o = { ...DEFAULTS, ...(r ? JSON.parse(r.options) : {}) };
  return { options: o, blocked: o.blocked || {}, pending: r?.pending ? JSON.parse(r.pending) : null, lastScan: r?.last_scan || null, harvested: r?.harvested || 0 };
}
async function save(userId, patch) {
  const s = await state(userId), options = { ...s.options, ...(patch.options || {}) };
  if (patch.blocked) options.blocked = patch.blocked;
  await run('INSERT INTO tax_pilot (user_id, options, pending, last_scan, harvested) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET options = excluded.options, pending = excluded.pending, last_scan = excluded.last_scan, harvested = excluded.harvested',
    userId, JSON.stringify(options), 'pending' in patch ? (patch.pending ? JSON.stringify(patch.pending) : null) : (s.pending ? JSON.stringify(s.pending) : null), patch.lastScan ?? s.lastScan, patch.harvested ?? s.harvested);
}

// Buying a stock harvested in the last 31 days (any real account) would be a wash sale.
export async function washBlock(userId, account, symbol, side) {
  if (side !== 'buy' || account === 'paper') return null;
  const r = await one('SELECT options FROM tax_pilot WHERE user_id = ?', userId); if (!r) return null;
  const until = (JSON.parse(r.options).blocked || {})[symbol];
  return until && until > now() ? until : null;
}

// Open lots from the fills recorded here (FIFO), per account and symbol.
export function openLots(fills) {
  const book = {};
  for (const f of [...fills].sort((a, b) => a.at - b.at)) {
    const k = `${f.account}|${f.symbol}`, lots = (book[k] ||= []);
    if (f.side === 'buy') { lots.push({ account: f.account, symbol: f.symbol, qty: +f.qty, price: +f.price, at: f.at }); continue; }
    let left = +f.qty;
    while (left > 1e-9 && lots.length) { const l = lots[0], q = Math.min(left, l.qty); l.qty -= q; left -= q; if (l.qty <= 1e-9) lots.shift(); }
  }
  return Object.values(book).flat().filter(l => l.qty > 1e-9);
}

// Harvest candidates across accounts, with the wash-sale check and the swap.
export async function scan(user, opts) {
  const o = { ...DEFAULTS, ...opts };
  const accts = (await accountsFor(user.id).catch(() => [])).filter(a => a.connected !== false && a.id !== 'paper' && (!o.accounts || o.accounts.includes(a.id))).map(a => a.id);
  const use = accts.length ? accts : o.includePaper ? ['paper'] : [];
  const fills = await all('SELECT account, symbol, side, qty, price, at FROM fills WHERE user_id = ?', user.id);
  const lots = openLots(fills), recentBuys = fills.filter(f => f.side === 'buy' && f.at > now() - 30 * DAY);
  const rate = { st: (user.tax_bracket ?? 0.24) + (user.state_tax ?? 0.05), lt: ltRate(user.tax_bracket ?? 0.24) + (user.state_tax ?? 0.05) };
  const out = [];
  for (const account of use) {
    const s = await accountSummary(user.id, account).catch(() => null); if (!s) continue;
    for (const p of s.positions || []) {
      if (!(p.qty > 0)) continue;
      const cost = p.value - p.pnl, lossPct = cost > 0 ? -p.pnl / cost * 100 : 0;
      if (!(-p.pnl >= o.minLoss && lossPct >= o.minLossPct)) continue;
      const wash = recentBuys.filter(f => f.symbol === p.symbol);
      const myLots = lots.filter(l => l.account === account && l.symbol === p.symbol);
      const longTerm = myLots.length ? myLots.every(l => now() - l.at > 365 * DAY) : false;
      const swap = o.swap ? SWAPS[p.symbol] || null : null;
      out.push({
        account, symbol: p.symbol, qty: p.qty, value: r2(p.value), cost: r2(cost), loss: r2(-p.pnl), lossPct: +lossPct.toFixed(1), longTerm,
        taxSaved: r2(-p.pnl * (longTerm ? rate.lt : rate.st)), swap,
        wash: wash.length ? `Bought ${wash.length > 1 ? wash.length + ' times' : ''} in the last 30 days (${[...new Set(wash.map(w => w.account))].join(', ')}): selling now would be a wash sale` : null,
      });
    }
  }
  return out.sort((a, b) => b.taxSaved - a.taxSaved);
}

export async function prepare(user, { notify = false } = {}) {
  const s = await state(user.id), c = (await scan(user, { ...s.options, includePaper: true })).filter(x => !x.wash);
  if (!c.length) { await save(user.id, { lastScan: now(), pending: null }); return { trades: [], candidates: 0 }; }
  const trades = c.map(x => ({ account: x.account, symbol: x.symbol, qty: x.qty, value: x.value, loss: x.loss, taxSaved: x.taxSaved, swap: x.swap }));
  const plan = { at: now(), trades, taxSaved: r2(trades.reduce((t, x) => t + x.taxSaved, 0)), loss: r2(trades.reduce((t, x) => t + x.loss, 0)) };
  await save(user.id, { lastScan: now(), pending: plan });
  if (notify) await notifyUser(user.id, `Tax-saving autopilot: ${trades.length} holding${trades.length > 1 ? 's are' : ' is'} down ${'$' + Math.round(plan.loss).toLocaleString('en-US')} in total. Harvesting the loss could save about $${Math.round(plan.taxSaved).toLocaleString('en-US')} in tax. Review and approve in the app (Taxes → Autopilot).`).catch(() => {});
  return plan;
}

export async function approve(user) {
  const s = await state(user.id), p = s.pending;
  if (!p) throw bad('Nothing is waiting for approval', 404);
  if (now() - p.at > 3 * DAY) { await save(user.id, { pending: null }); throw bad('These trades are more than 3 days old. Check again for today\'s prices.', 410); }
  if (p.trades.some(t => t.account !== 'paper') && !isPaid(user)) throw Object.assign(bad('Harvesting on real accounts is part of the paid plans'), { status: 402, upgrade: true, feature: 'Tax-saving autopilot' });
  await save(user.id, { pending: null });
  const results = [], blocked = { ...s.blocked };
  for (const t of p.trades) {
    try {
      const r = await placeOrder(user.id, t.account, { symbol: t.symbol, side: 'sell', qty: t.qty }, 'taxpilot');
      results.push({ ...t, side: 'sell', ok: true, status: r.status });
      blocked[t.symbol] = now() + 31 * DAY;
      if (t.swap) {
        try { await placeOrder(user.id, t.account, { symbol: t.swap, side: 'buy', notional: r2(t.value * 0.99) }, 'taxpilot'); results.push({ account: t.account, symbol: t.swap, side: 'buy', ok: true }); }
        catch (e) { results.push({ account: t.account, symbol: t.swap, side: 'buy', ok: false, error: e.message }); }
      }
    } catch (e) { results.push({ ...t, side: 'sell', ok: false, error: e.message }); }
  }
  for (const [k, v] of Object.entries(blocked)) if (v < now()) delete blocked[k];
  const done = results.filter(r => r.side === 'sell' && r.ok);
  await save(user.id, { blocked, harvested: r2(s.harvested + done.reduce((a, t) => a + t.loss, 0)) });
  await audit(user.id, 'tax_harvest', { sold: done.map(d => d.symbol), loss: r2(done.reduce((a, t) => a + t.loss, 0)) });
  return { results, blockedUntil: Object.fromEntries(done.map(d => [d.symbol, blocked[d.symbol]])) };
}

// Which shares to sell first: lowest tax (losses first, short-term losses before long-term, then
// long-term gains, then short-term gains), next to FIFO and HIFO, with the tax each would cost.
export function bestLots(lots, qty, price, { bracket = 0.24, stateRate = 0.05 } = {}) {
  const st = bracket + stateRate, lt = ltRate(bracket) + stateRate, t = now();
  const rows = lots.map(l => { const longTerm = t - l.at > 365 * DAY, per = price - l.price; return { ...l, longTerm, gainPerShare: r2(per), taxPerShare: per * (longTerm ? lt : st) }; });
  const take = order => {
    let left = qty, gain = 0, tax = 0; const used = [];
    for (const l of order) { if (left <= 1e-9) break; const q = Math.min(left, l.qty); left -= q; gain += l.gainPerShare * q; tax += l.taxPerShare * q; used.push({ at: l.at, price: l.price, qty: +q.toFixed(6), longTerm: l.longTerm }); }
    return { lots: used, gain: r2(gain), tax: r2(tax), short: left > 1e-9 ? +left.toFixed(6) : 0 };
  };
  const methods = {
    tax: take([...rows].sort((a, b) => a.taxPerShare - b.taxPerShare)),
    fifo: take([...rows].sort((a, b) => a.at - b.at)),
    hifo: take([...rows].sort((a, b) => b.price - a.price)),
  };
  return { qty, price, methods, saves: r2(methods.fifo.tax - methods.tax.tax), lots: rows.map(({ taxPerShare, ...l }) => l) };
}

// Weekly, Monday late morning New York: prepare and notify for users who switched it on.
export async function weeklyScan(t = now()) {
  const n = nyTime(t);
  if (new Date(n.day + 'T12:00:00Z').getUTCDay() !== 1 || n.minutes < 660 || n.minutes > 900) return 0;
  let k = 0;
  for (const r of await all('SELECT user_id, options, last_scan FROM tax_pilot')) {
    if (!JSON.parse(r.options).weekly || (r.last_scan && t - r.last_scan < 5 * DAY)) continue;
    if (!(await addonOn(r.user_id, 'taxPilot'))) continue;
    const u = await one('SELECT * FROM users WHERE id = ?', r.user_id); if (!u) continue;
    const p = await prepare(u, { notify: true }).catch(e => (console.warn('taxpilot', e.message), null));
    if (p?.trades?.length) k++;
  }
  return k;
}

export const taxPilotRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAddon('taxPilot'));
  r.get('/', async (req, res) => {
    const s = await state(req.user.id);
    res.json({ options: { ...s.options, blocked: undefined }, pending: s.pending, lastScan: s.lastScan, harvested: s.harvested, blocked: Object.fromEntries(Object.entries(s.blocked).filter(([, v]) => v > now())), candidates: await scan(req.user, { ...s.options, includePaper: true }) });
  });
  r.put('/', async (req, res) => {
    const b = req.body || {}, n = (v, d, lo, hi) => (v === undefined || v === '' ? d : Math.min(hi, Math.max(lo, +v)));
    const s = await state(req.user.id);
    const options = { minLoss: n(b.minLoss, s.options.minLoss, 1, 1e7), minLossPct: n(b.minLossPct, s.options.minLossPct, 0, 90), swap: b.swap === undefined ? s.options.swap : !!b.swap, weekly: b.weekly === undefined ? s.options.weekly : !!b.weekly, accounts: Array.isArray(b.accounts) ? b.accounts.filter(a => ACCOUNT_IDS.includes(a)) : s.options.accounts };
    await save(req.user.id, { options });
    res.json({ options });
  });
  r.post('/prepare', async (req, res) => res.json(await prepare(req.user)));
  r.post('/approve', async (req, res) => res.json(await approve(req.user)));
  r.post('/skip', async (req, res) => { await save(req.user.id, { pending: null }); res.json({ ok: true }); });
  r.delete('/blocked/:symbol', async (req, res) => { const s = await state(req.user.id), b = { ...s.blocked }; delete b[String(req.params.symbol).toUpperCase()]; await save(req.user.id, { blocked: b }); await audit(req.user.id, 'wash_guard_removed', { symbol: req.params.symbol }, req.ip); res.json({ ok: true }); });
  // Best lots for a sale.
  r.get('/lots', async (req, res) => {
    const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper', symbol = String(req.query.symbol || '').toUpperCase();
    const fills = await all('SELECT account, symbol, side, qty, price, at FROM fills WHERE user_id = ? AND account = ? AND symbol = ?', req.user.id, account, symbol);
    const lots = openLots(fills);
    if (!lots.length) throw bad(`No purchases of ${symbol || 'that stock'} recorded in this account. Lots are known only for shares bought through Brightfolio.`, 404);
    const have = lots.reduce((s, l) => s + l.qty, 0), qty = Math.min(+req.query.qty || have, have);
    const price = +req.query.price || await lastPrice(symbol, req.user.id);
    res.json({ symbol, account, have: +have.toFixed(6), ...bestLots(lots, qty, price, { bracket: req.user.tax_bracket ?? 0.24, stateRate: req.user.state_tax ?? 0.05 }) });
  });
  return r;
})();
