// Private markets and real estate: the user's own investments outside the stock market, tracked
// next to their brokerage accounts. Private: stakes in private companies, startups, funds and
// loans, with every cash flow, the latest value, MOIC and IRR. Real estate: properties with value,
// mortgage, rent and costs, giving equity, cash flow, cap rate and cash-on-cash return. A net-worth
// view adds them to the brokerage accounts. Brightfolio records and calculates; it does not offer,
// sell or arrange private securities or property deals (the platforms listed are links only).
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { accountSummary } from './brokers.js';
import { accountsFor } from './ext/routes.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const num = (v, lo = -1e12, hi = 1e12) => { const n = +v; if (!Number.isFinite(n) || n < lo || n > hi) throw bad('Enter a valid number'); return Math.round(n * 100) / 100; };
const txt = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : new Date().toISOString().slice(0, 10));

export const PRIVATE_TYPES = { equity: 'Shares in a private company', safe: 'SAFE or convertible note', fund: 'Private fund (LP)', loan: 'Private loan', business: 'My own business' };
export const PROPERTY_TYPES = { rental: 'Rental property', home: 'My home', commercial: 'Commercial property', land: 'Land', fund: 'Real estate fund or platform' };
// Links only: Brightfolio has no relationship with these platforms and earns nothing from them.
export const PLATFORMS = {
  private: [
    ['Wefunder', 'https://wefunder.com', 'Startup investing for everyone (Regulation Crowdfunding)'],
    ['StartEngine', 'https://www.startengine.com', 'Startup and private company offerings'],
    ['Republic', 'https://republic.com', 'Startups, real estate and more'],
    ['EquityZen', 'https://equityzen.com', 'Shares of late-stage private companies (accredited investors)'],
    ['Forge', 'https://forgeglobal.com', 'Pre-IPO shares (accredited investors)'],
    ['AngelList', 'https://www.angellist.com', 'Venture funds and syndicates (accredited investors)'],
  ],
  realestate: [
    ['Fundrise', 'https://fundrise.com', 'Real estate funds from $10'],
    ['Arrived', 'https://arrived.com', 'Shares of single-family rentals and vacation homes'],
    ['RealtyMogul', 'https://www.realtymogul.com', 'Commercial real estate (some offerings for accredited investors)'],
    ['Public REITs', '#/trade?symbol=VNQ', 'Listed real estate trusts trade like stocks in your brokerage account (for example VNQ)'],
  ],
};

// XIRR: the yearly rate that makes the dated cash flows (money in negative, out positive) add to 0.
export function xirr(flows) {
  if (flows.length < 2 || !flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) return null;
  const t0 = Date.parse(flows[0].date), yrs = f => (Date.parse(f.date) - t0) / (365.25 * 864e5);
  const npv = r => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, yrs(f)), 0);
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return +(((lo + hi) / 2) * 100).toFixed(2);
}

const parse = r => r && { id: r.id, kind: r.kind, name: r.name, ...JSON.parse(r.data || '{}'), createdAt: r.created_at, updatedAt: r.updated_at };
// The figures for one private investment from its cash flows and latest value.
export function privateStats(a, events) {
  const invested = events.filter(e => e.kind === 'invest').reduce((s, e) => s + e.amount, 0);
  const distributions = events.filter(e => e.kind === 'distribution').reduce((s, e) => s + e.amount, 0);
  const value = +a.value || 0;
  const flows = [...events.filter(e => ['invest', 'distribution'].includes(e.kind)).map(e => ({ date: e.on, amount: e.kind === 'invest' ? -e.amount : e.amount })), ...(value ? [{ date: a.valuedOn || new Date().toISOString().slice(0, 10), amount: value }] : [])].sort((x, y) => x.date.localeCompare(y.date));
  return { invested, distributions, value, gain: +(value + distributions - invested).toFixed(2), moic: invested ? +((value + distributions) / invested).toFixed(2) : null, irr: xirr(flows) };
}
// Monthly mortgage payment for a balance, yearly rate (%) and years left.
export const mortgagePayment = (balance, ratePct, years) => { const r = ratePct / 1200, n = years * 12; if (!(balance > 0) || !(n > 0)) return 0; return +(r ? balance * r / (1 - Math.pow(1 + r, -n)) : balance / n).toFixed(2); };
export function propertyStats(p) {
  const value = +p.value || 0, mortgage = +p.mortgage || 0, rent = +p.rent || 0, costs = +p.costs || 0;
  const payment = p.payment ? +p.payment : mortgagePayment(mortgage, +p.rate || 0, +p.yearsLeft || 30);
  const noi = (rent - costs) * 12, cashFlow = +(rent - costs - payment).toFixed(2), cashIn = +p.cashInvested || 0;
  return { equity: +(value - mortgage).toFixed(2), payment, monthlyCashFlow: cashFlow, yearlyCashFlow: +(cashFlow * 12).toFixed(2), capRate: value && rent ? +(noi / value * 100).toFixed(2) : null, cashOnCash: cashIn ? +(cashFlow * 12 / cashIn * 100).toFixed(2) : null, loanToValue: value ? +(mortgage / value * 100).toFixed(1) : null, gain: p.price ? +(value - +p.price).toFixed(2) : null };
}

async function list(userId, kind) {
  const rows = (await all('SELECT * FROM alt_assets WHERE user_id = ? AND kind = ? ORDER BY id', userId, kind)).map(parse);
  const ev = await all('SELECT * FROM alt_events WHERE user_id = ? ORDER BY on_date, id', userId);
  return rows.map(a => {
    const events = ev.filter(e => e.asset_id === a.id).map(e => ({ id: e.id, kind: e.kind, amount: e.amount, on: e.on_date, memo: e.memo }));
    return { ...a, events, stats: kind === 'private' ? privateStats(a, events) : propertyStats(a) };
  });
}
export const listAlts = list;
function clean(kind, b) {
  if (kind === 'private') return { type: PRIVATE_TYPES[b.type] ? b.type : 'equity', company: txt(b.company), platform: txt(b.platform, 60), stage: txt(b.stage, 40), ownership: b.ownership === '' || b.ownership == null ? null : num(b.ownership, 0, 100), value: num(b.value || 0, 0), valuedOn: day(b.valuedOn), notes: txt(b.notes, 1000) };
  return { type: PROPERTY_TYPES[b.type] ? b.type : 'rental', address: txt(b.address, 160), price: num(b.price || 0, 0), bought: day(b.bought), value: num(b.value || 0, 0), mortgage: num(b.mortgage || 0, 0), rate: num(b.rate || 0, 0, 30), yearsLeft: num(b.yearsLeft || 30, 0, 50), payment: b.payment === '' || b.payment == null ? null : num(b.payment, 0), rent: num(b.rent || 0, 0), costs: num(b.costs || 0, 0), cashInvested: num(b.cashInvested || 0, 0), notes: txt(b.notes, 1000) };
}

const KINDS = ['private', 'realestate'];
export const altsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/platforms', (req, res) => res.json({ ...PLATFORMS, privateTypes: PRIVATE_TYPES, propertyTypes: PROPERTY_TYPES }));
  // Net worth: brokerage accounts (real money only) plus private investments and real-estate equity.
  r.get('/networth', async (req, res) => {
    const accounts = [];
    for (const a of await accountsFor(req.user.id).catch(() => [])) {
      if (a.id === 'paper' || a.connected === false) continue;
      const s = await accountSummary(req.user.id, a.id).catch(() => null);
      if (s) accounts.push({ id: a.id, name: a.name || a.id, equity: +(+s.equity).toFixed(2) });
    }
    const [p, re] = await Promise.all([list(req.user.id, 'private'), list(req.user.id, 'realestate')]);
    const priv = +p.reduce((s, a) => s + a.stats.value, 0).toFixed(2), reEq = +re.reduce((s, a) => s + a.stats.equity, 0).toFixed(2);
    const brokerage = +accounts.reduce((s, a) => s + a.equity, 0).toFixed(2);
    res.json({ accounts, brokerage, private: priv, realEstate: reEq, total: +(brokerage + priv + reEq).toFixed(2) });
  });
  r.get('/:kind', async (req, res) => {
    if (!KINDS.includes(req.params.kind)) throw bad('Not found', 404);
    const items = await list(req.user.id, req.params.kind);
    const sum = k => +items.reduce((s, a) => s + (a.stats[k] || 0), 0).toFixed(2);
    res.json({ items, totals: req.params.kind === 'private' ? { invested: sum('invested'), distributions: sum('distributions'), value: sum('value'), gain: sum('gain') } : { equity: sum('equity'), value: +items.reduce((s, a) => s + (+a.value || 0), 0).toFixed(2), mortgage: +items.reduce((s, a) => s + (+a.mortgage || 0), 0).toFixed(2), monthlyCashFlow: sum('monthlyCashFlow') } });
  });
  r.post('/:kind', async (req, res) => {
    if (!KINDS.includes(req.params.kind)) throw bad('Not found', 404);
    const n = (await one('SELECT COUNT(*) n FROM alt_assets WHERE user_id = ?', req.user.id)).n;
    if (n >= 200) throw bad('Up to 200 investments');
    const name = txt(req.body?.name, 80); if (!name) throw bad('Give it a name');
    const r2 = await run('INSERT INTO alt_assets (user_id, kind, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)', req.user.id, req.params.kind, name, JSON.stringify(clean(req.params.kind, req.body || {})), now(), now());
    const id = Number(r2.lastInsertRowid);
    // A private investment usually starts with the money put in.
    if (req.params.kind === 'private' && +req.body?.invested > 0) await run('INSERT INTO alt_events (asset_id, user_id, kind, amount, on_date, memo, at) VALUES (?,?,?,?,?,?,?)', id, req.user.id, 'invest', num(req.body.invested, 0), day(req.body.investedOn), 'First investment', now());
    await audit(req.user.id, 'alt_added', { kind: req.params.kind, id }, req.ip);
    res.json({ id });
  });
  const mine = async (req) => { const a = await one('SELECT * FROM alt_assets WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!a) throw bad('Not found', 404); return a; };
  r.put('/item/:id', async (req, res) => {
    const a = await mine(req), cur = JSON.parse(a.data || '{}');
    await run('UPDATE alt_assets SET name = ?, data = ?, updated_at = ? WHERE id = ?', txt(req.body?.name, 80) || a.name, JSON.stringify(clean(a.kind, { ...cur, ...req.body })), now(), a.id);
    res.json({ ok: true });
  });
  r.delete('/item/:id', async (req, res) => { const a = await mine(req); await run('DELETE FROM alt_events WHERE asset_id = ?', a.id); await run('DELETE FROM alt_assets WHERE id = ?', a.id); res.json({ ok: true }); });
  // Money in, money out, or a new value (a valuation also updates the current value).
  r.post('/item/:id/events', async (req, res) => {
    const a = await mine(req), kind = ['invest', 'distribution', 'valuation'].includes(req.body?.kind) ? req.body.kind : null;
    if (!kind) throw bad('Pick money in, money out or a new value');
    const amount = num(req.body.amount, 0), on = day(req.body.on);
    if (kind === 'valuation') { const d = JSON.parse(a.data || '{}'); await run('UPDATE alt_assets SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify({ ...d, value: amount, valuedOn: on }), now(), a.id); }
    await run('INSERT INTO alt_events (asset_id, user_id, kind, amount, on_date, memo, at) VALUES (?,?,?,?,?,?,?)', a.id, req.user.id, kind, amount, on, txt(req.body.memo, 200), now());
    res.json({ ok: true });
  });
  r.delete('/item/:id/events/:eid', async (req, res) => { const a = await mine(req); await run('DELETE FROM alt_events WHERE id = ? AND asset_id = ?', +req.params.eid, a.id); res.json({ ok: true }); });
  return r;
})();
