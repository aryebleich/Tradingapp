// Equalize accounts: every chosen Alpaca account holds the same mix (the same share in each stock
// and the same share in cash), sized to its own value. The mix comes from all the chosen accounts
// together, or from one model account. Duplicates and master (omnibus) accounts are left out
// (src/consolidate.js), since a master cannot trade and mirrors its sub accounts anyway.
// By hand: preview, then confirm with the password. Daily: at the market open (New York, trading
// days only), the trades either wait for one approval tap or, if the user chose it with their
// password, are placed by themselves. Sells go first so their cash pays for the buys.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, confirmsIdentity } from './auth.js';
import { placeOrder } from './brokers.js';
import { loadAccounts, WHY } from './consolidate.js';
import { tradingFor } from './alpaca/connections.js';
import { notifyUser } from './notify-user.js';
import { nyTime } from './time.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const r2 = x => +(+x || 0).toFixed(2);
const OPTION = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/; // option contracts are never equalized
export const DEFAULTS = { driftPct: 1, cashPct: null, minTrade: 25, wholeShares: false };

// rows: counted accounts { id, equity, cash, positions:[{symbol, value, price}] }; model: 'combined' or an account id.
// fixed: target weights given by the caller ({ SYMBOL: share of the account }) instead of the model's mix.
export function planEqualize(rows, { model = 'combined', options = {}, fixed = null } = {}) {
  const o = { ...DEFAULTS, ...options };
  const accts = rows.map(r => ({ id: r.id, label: r.label, equity: +r.equity || 0, cash: +r.cash || 0, pos: Object.fromEntries((r.positions || []).filter(p => !OPTION.test(p.symbol)).map(p => [p.symbol, { value: +p.value || 0, price: +p.price || 0, qty: +p.qty || 0 }])) }));
  const price = {}; for (const a of accts) for (const [k, p] of Object.entries(a.pos)) if (p.price > 0) price[k] = p.price;
  const src = model === 'combined' ? accts : accts.filter(a => a.id === model);
  if (!src.length) throw bad('The model account is not one of the chosen accounts');
  const total = src.reduce((s, a) => s + a.equity, 0);
  if (!(total > 0)) return { weights: [], accounts: [], orders: [], drift: 0, needed: false };
  const held = {}; for (const a of src) for (const [k, p] of Object.entries(a.pos)) held[k] = (held[k] || 0) + p.value;
  const invested = Object.values(held).reduce((s, v) => s + v, 0);
  // Shares of each holding; "keep X% cash" scales the stock part to leave that much in cash.
  const stockShare = o.cashPct == null ? invested / total : Math.max(0, 1 - o.cashPct / 100);
  const weights = fixed ? Object.entries(fixed).map(([k, v]) => ({ symbol: k, pct: +(v * 100).toFixed(3) })).sort((a, b) => b.pct - a.pct) : Object.entries(held).map(([k, v]) => ({ symbol: k, pct: invested ? +(v / invested * stockShare * 100).toFixed(3) : 0 })).sort((a, b) => b.pct - a.pct);
  const w = Object.fromEntries(weights.map(x => [x.symbol, x.pct / 100]));
  const orders = [], view = [];
  let drift = 0;
  const add = (a, symbol, side, dollars) => {
    if (dollars < o.minTrade) return 0;
    const px = price[symbol] || 0;
    if (o.wholeShares) { if (!(px > 0)) return 0; const q = Math.floor(dollars / px); if (q < 1) return 0; orders.push({ account: a.id, symbol, side, qty: q, price: px, dollars: r2(q * px) }); return q * px; }
    if (side === 'sell' && a.pos[symbol] && dollars >= a.pos[symbol].value - 0.01) { // the whole holding: sell by quantity
      orders.push({ account: a.id, symbol, side, qty: a.pos[symbol].qty, all: true, price: px, dollars: r2(a.pos[symbol].value) }); return a.pos[symbol].value;
    }
    orders.push({ account: a.id, symbol, side, notional: r2(dollars), price: px || null, dollars: r2(dollars) }); return dollars;
  };
  for (const a of accts) {
    const symbols = [...new Set([...Object.keys(w), ...Object.keys(a.pos)])];
    const rows2 = symbols.map(k => { const cur = a.pos[k]?.value || 0, tgt = a.equity * (w[k] || 0); return { symbol: k, current: r2(cur), target: r2(tgt), currentPct: a.equity ? +(cur / a.equity * 100).toFixed(2) : 0, targetPct: +((w[k] || 0) * 100).toFixed(2) }; });
    for (const x of rows2) drift = Math.max(drift, Math.abs(x.currentPct - x.targetPct));
    view.push({ id: a.id, label: a.label, equity: r2(a.equity), cash: r2(a.cash), rows: rows2.sort((x, y) => y.target - x.target) });
    let cash = a.cash;
    for (const x of rows2.filter(x => x.current - x.target >= o.minTrade)) cash += add(a, x.symbol, 'sell', x.current - x.target);
    for (const x of rows2.filter(x => x.target - x.current >= o.minTrade).sort((p, q) => (q.target - q.current) - (p.target - p.current))) {
      const spend = Math.min(x.target - x.current, cash - 0.5); // half a dollar of room for price moves
      if (spend >= o.minTrade) cash -= add(a, x.symbol, 'buy', spend);
    }
  }
  return { model, weights, accounts: view, orders, drift: +drift.toFixed(2), needed: orders.length > 0 && drift >= o.driftPct };
}

// Equalize positions: inside one account, every holding gets the same dollar amount. The money
// for the holdings stays what it is now (or the account's value less the cash to keep), and is
// split evenly among the stocks and funds held. Option contracts and short positions are left alone.
export function planPositions(row, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const longs = (row.positions || []).filter(p => !OPTION.test(p.symbol) && +p.value > 0 && +p.qty > 0);
  const equity = +row.equity || 0;
  if (longs.length < 2) throw bad(longs.length ? 'There is only one holding to equalize' : 'This account has no stock or fund holdings to equalize');
  if (!(equity > 0)) throw bad('This account has no value to work with');
  const invested = longs.reduce((s, p) => s + +p.value, 0);
  const share = (o.cashPct == null ? invested / equity : Math.max(0, 1 - o.cashPct / 100)) / longs.length;
  const fixed = Object.fromEntries(longs.map(p => [p.symbol, share]));
  const p = planEqualize([{ ...row, positions: longs }], { model: 'combined', options: o, fixed });
  const skipped = (row.positions || []).filter(x => !longs.includes(x)).map(x => x.symbol);
  return { ...p, account: row.id, label: row.label, each: +(equity * share).toFixed(2), skipped };
}
async function positionsPlan(userId, b = {}) {
  const id = String(b.account || 'alpaca');
  if (!(id === 'alpaca' || /^alpaca:\d{1,3}$/.test(id))) throw bad('Pick an Alpaca account');
  const list = await loadAccounts(userId), row = list.find(r => r.id === id);
  if (!row) throw bad('That account is not connected', 404);
  if (row.error) throw bad(row.error, 409);
  const n = (v, d, lo, hi) => (v === undefined || v === '' || v === null ? d : Math.min(hi, Math.max(lo, +v)));
  return planPositions(row, { cashPct: b.cashPct === '' || b.cashPct == null ? null : n(b.cashPct, 0, 0, 90), minTrade: n(b.minTrade, 5, 1, 100000), wholeShares: !!b.wholeShares });
}

// ---------- settings ----------
const parse = r => r ? { accounts: JSON.parse(r.accounts || '[]'), model: r.model, options: { ...DEFAULTS, ...JSON.parse(r.options || '{}') }, daily: !!r.daily, mode: r.mode, pending: r.pending ? JSON.parse(r.pending) : null, lastRun: r.last_run, lastResult: r.last_result ? JSON.parse(r.last_result) : null }
  : { accounts: [], model: 'combined', options: { ...DEFAULTS }, daily: false, mode: 'approve', pending: null, lastRun: null, lastResult: null };
export const settingsFor = async userId => parse(await one('SELECT * FROM equalize WHERE user_id = ?', userId));

async function chosen(userId, s) {
  const list = await loadAccounts(userId);
  const live = list.filter(r => r.counted && r.live), test = list.filter(r => r.counted && !r.live);
  const ids = s.accounts.length ? s.accounts : (live.length ? live : test).map(r => r.id);
  const rows = list.filter(r => ids.includes(r.id) && r.counted);
  const left = list.filter(r => ids.includes(r.id) && !r.counted).map(r => ({ id: r.id, label: r.label, why: r.error || WHY[r.why] }));
  if (rows.some(r => r.live) && rows.some(r => !r.live)) throw bad('Pick only live accounts or only paper accounts: real and test money are never mixed');
  return { list, rows, left };
}
export async function preview(userId, s) {
  const { rows, left } = await chosen(userId, s);
  if (rows.length < 2) throw bad('Pick at least two accounts to equalize');
  return { ...planEqualize(rows, s), left };
}
async function place(userId, orders, source) {
  const results = [];
  for (const o of [...orders].sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1))) {
    try {
      const body = { symbol: o.symbol, side: o.side, ...(o.qty ? { qty: o.qty } : { notional: o.notional }) };
      const r = await placeOrder(userId, o.account, body, source);
      results.push({ ...o, ok: true, status: r?.status || 'sent' });
    } catch (e) { results.push({ ...o, ok: false, error: e.message }); }
  }
  return results;
}
const summary = results => ({ at: now(), sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results: results.slice(0, 60) });

// ---------- the daily run at the market open ----------
export async function runEqualize(t = now()) {
  const n = nyTime(t);
  if (n.weekend || n.minutes < 570 || n.minutes >= 600) return 0; // 9:30 to 10:00 New York
  let done = 0;
  for (const r of await all('SELECT * FROM equalize WHERE daily = 1')) {
    const s = parse(r), userId = r.user_id;
    if (s.lastRun && nyTime(s.lastRun).day === n.day) continue; // once a day
    try {
      const t0 = await tradingFor(userId); const clock = t0 ? await t0.clock().catch(() => null) : null;
      if (clock && !clock.is_open) continue; // a market holiday: try again tomorrow
      const p = await preview(userId, s);
      await run('UPDATE equalize SET last_run = ? WHERE user_id = ?', now(), userId);
      if (!p.needed) continue;
      if (s.mode === 'auto') {
        const res = await place(userId, p.orders, 'equalize');
        await run('UPDATE equalize SET last_result = ?, pending = NULL WHERE user_id = ?', JSON.stringify(summary(res)), userId);
        await audit(userId, 'equalize_auto', { orders: res.length, failed: res.filter(x => !x.ok).length });
        await notifyUser(userId, `Equalize accounts: ${res.filter(x => x.ok).length} trades placed at the open so your accounts hold the same mix again${res.some(x => !x.ok) ? ` (${res.filter(x => !x.ok).length} could not be placed)` : ''}.`).catch(() => {});
      } else {
        await run('UPDATE equalize SET pending = ? WHERE user_id = ?', JSON.stringify({ at: now(), orders: p.orders, drift: p.drift }), userId);
        await notifyUser(userId, `Your accounts are ${p.drift} points apart. ${p.orders.length} trades are ready to equalize them; approve them in the app (All accounts).`).catch(() => {});
      }
      done++;
    } catch (e) { console.warn('equalize', userId, e.message); }
  }
  return done;
}

export const equalizeRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const pw = (req) => { if (!confirmsIdentity(req.user, req.body || {})) throw bad(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password', 401); };
  r.get('/', async (req, res) => {
    const s = await settingsFor(req.user.id);
    const list = await loadAccounts(req.user.id);
    res.json({ ...s, available: list.map(x => ({ id: x.id, label: x.label, live: x.live, counted: x.counted, why: x.error || (x.why ? WHY[x.why] : null), equity: x.equity ?? null })) });
  });
  r.put('/', async (req, res) => {
    const b = req.body || {}, cur = await settingsFor(req.user.id);
    const accounts = [...new Set((Array.isArray(b.accounts) ? b.accounts : []).map(String).filter(a => a === 'alpaca' || /^alpaca:\d{1,3}$/.test(a)))];
    const model = b.model === 'combined' || accounts.includes(b.model) ? b.model : 'combined';
    const o = b.options || {}, n = (v, d, lo, hi) => (v === undefined || v === '' || v === null ? d : Math.min(hi, Math.max(lo, +v)));
    const options = { driftPct: n(o.driftPct, 1, 0, 50), cashPct: o.cashPct === '' || o.cashPct == null ? null : n(o.cashPct, 0, 0, 90), minTrade: n(o.minTrade, 25, 1, 100000), wholeShares: !!o.wholeShares };
    const mode = b.mode === 'auto' ? 'auto' : 'approve';
    // Trades placed by themselves every morning: only after the password.
    if (mode === 'auto' && !!b.daily && !(cur.mode === 'auto' && cur.daily)) pw(req);
    await run(`INSERT INTO equalize (user_id, accounts, model, options, daily, mode) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET accounts = excluded.accounts, model = excluded.model, options = excluded.options, daily = excluded.daily, mode = excluded.mode`,
      req.user.id, JSON.stringify(accounts), model, JSON.stringify(options), b.daily ? 1 : 0, mode);
    await audit(req.user.id, 'equalize_settings', { accounts: accounts.length, daily: !!b.daily, mode }, req.ip);
    res.json(await settingsFor(req.user.id));
  });
  r.post('/preview', async (req, res) => res.json(await preview(req.user.id, { ...(await settingsFor(req.user.id)), ...(req.body?.accounts ? { accounts: req.body.accounts } : {}), ...(req.body?.model ? { model: req.body.model } : {}) })));
  // Equalize now: worked out again with this moment's prices, then placed.
  r.post('/run', async (req, res) => {
    pw(req);
    const p = await preview(req.user.id, await settingsFor(req.user.id));
    if (!p.orders.length) return res.json({ results: [], message: 'Your accounts already hold the same mix.' });
    const results = await place(req.user.id, p.orders, 'equalize');
    await run('INSERT INTO equalize (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', req.user.id);
    await run('UPDATE equalize SET last_result = ?, pending = NULL, last_run = ? WHERE user_id = ?', JSON.stringify(summary(results)), now(), req.user.id);
    await audit(req.user.id, 'equalize_run', { orders: results.length, failed: results.filter(x => !x.ok).length }, req.ip);
    res.json({ results });
  });
  r.post('/approve', async (req, res) => {
    pw(req);
    const s = await settingsFor(req.user.id);
    if (!s.pending) throw bad('Nothing is waiting for approval', 404);
    if (now() - s.pending.at > 864e5) { await run('UPDATE equalize SET pending = NULL WHERE user_id = ?', req.user.id); throw bad('These trades are from an earlier day. Preview again for today\'s prices.', 410); }
    const results = await place(req.user.id, s.pending.orders, 'equalize');
    await run('UPDATE equalize SET pending = NULL, last_result = ? WHERE user_id = ?', JSON.stringify(summary(results)), req.user.id);
    await audit(req.user.id, 'equalize_approved', { orders: results.length }, req.ip);
    res.json({ results });
  });
  // Equalize positions in one account.
  r.post('/positions/preview', async (req, res) => res.json(await positionsPlan(req.user.id, req.body || {})));
  r.post('/positions/run', async (req, res) => {
    pw(req);
    const p = await positionsPlan(req.user.id, req.body || {});
    if (!p.orders.length) return res.json({ results: [], message: 'Every holding already has about the same amount.' });
    const results = await place(req.user.id, p.orders, 'equalize');
    await audit(req.user.id, 'equalize_positions', { account: p.account, orders: results.length, failed: results.filter(x => !x.ok).length }, req.ip);
    res.json({ results });
  });
  r.delete('/pending', async (req, res) => { await run('UPDATE equalize SET pending = NULL WHERE user_id = ?', req.user.id); res.json({ ok: true }); });
  return r;
})();
