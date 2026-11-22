// Dividends & income (Grow → Investing toolkit → Dividends & income). For one account: each holding's
// yearly dividend, yield, safety score (stocks, from SEC filings), the next ex-dividend and pay dates,
// a 12-month income forecast by month and the dividend reinvestment (DRIP) setting that already lives
// in the Investing toolkit. Sources: Alpaca corporate actions (cash dividends, funds included) when
// market data is set up, otherwise the dividends per share in SEC annual reports. Forecasts repeat the
// last 12 months; companies can raise, cut or stop dividends.
import express from 'express';
import { requireUser } from './auth.js';
import { accountSummary, ACCOUNT_IDS } from './brokers.js';
import { getSetting } from './settings.js';
import * as D from './alpaca/data.js';
import { stockData } from './stock.js';
import { isPaid } from './fees.js';

const r2 = (x, d = 2) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d));
const iso = t => new Date(t).toISOString().slice(0, 10);
export const NOTE = 'Forecast from the dividends of the last 12 months. Companies can raise, cut or stop dividends; this is not investment advice.';

// payments: [{ symbol, rate, ex_date, payable_date }] over the last 12 months. Each payment is
// expected again 12 months later; returns 12 months from `from` with the expected income.
export function monthlyForecast(holdings, payments, from = new Date()) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)); return { month: iso(d).slice(0, 7), income: 0, items: [] }; });
  const qty = Object.fromEntries(holdings.map(h => [h.symbol, h.qty]));
  for (const p of payments) {
    if (!qty[p.symbol] || !(p.rate > 0)) continue;
    const when = new Date((p.payable_date || p.ex_date) + 'T12:00:00Z'); const next = new Date(when); while (next < from) next.setUTCFullYear(next.getUTCFullYear() + 1);
    const m = months.find(x => x.month === iso(next).slice(0, 7)); if (!m) continue;
    const amt = r2(qty[p.symbol] * p.rate); m.income = r2(m.income + amt); m.items.push({ symbol: p.symbol, amount: amt });
  }
  return { months, total: r2(months.reduce((a, m) => a + m.income, 0)) };
}
// Yearly dividend per share from the last 12 months of payments.
export const yearlyDps = (payments, symbol) => r2(payments.filter(p => p.symbol === symbol).reduce((a, p) => a + (+p.rate || 0), 0), 4);

async function payments(symbols, from, to) {
  if (!D.dataEnabled() || !symbols.length) return null;
  const out = [];
  for (let i = 0; i < symbols.length; i += 25) {
    const ca = await D.corporateActions({ symbols: symbols.slice(i, i + 25), types: 'cash_dividend', start: from, end: to, limit: 1000 }).catch(() => null);
    if (!ca) return null; out.push(...(ca.cash_dividends || []).map(c => ({ symbol: c.symbol, rate: +c.rate, ex_date: c.ex_date, payable_date: c.payable_date || null })));
  }
  return out;
}

export async function incomeFor(userId, account, paid = false) {
  const sum = await accountSummary(userId, account), now = Date.now();
  const hold = (sum.positions || []).filter(p => p.qty > 0 && !String(p.symbol).includes('/') && !/\d{6}[CP]\d{8}$/.test(p.symbol))
    .map(p => ({ symbol: p.symbol, qty: +p.qty, price: +p.price || (p.value && p.qty ? p.value / p.qty : null), value: +p.value || null }));
  const syms = hold.map(h => h.symbol);
  const past = await payments(syms, iso(now - 365 * 864e5), iso(now));
  const ahead = await payments(syms, iso(now), iso(now + 120 * 864e5));
  const source = past ? 'Alpaca corporate actions, or SEC annual reports where no payments are listed' : 'SEC annual reports';
  const rows = [];
  for (const h of hold) {
    let dps = past ? yearlyDps(past, h.symbol) || null : null, safety = null, kind = 'fund-or-foreign', dpsSource = dps ? 'payments' : null;
    // Stocks: the safety score from filings; for free members the score of the first 3 holdings only.
    const sd = await stockData(h.symbol, userId, { sector: false }).catch(() => null);
    if (sd?.kind === 'stock') { kind = 'stock'; if (!dps && sd.dividends?.dps) { dps = sd.dividends.dps; dpsSource = 'filings'; } if (sd.dividends?.pays) safety = sd.dividends.safety; }
    const today = iso(now), next = (ahead || []).filter(p => p.symbol === h.symbol && p.ex_date >= today).sort((a, b) => a.ex_date.localeCompare(b.ex_date))[0] || null;
    rows.push({ ...h, kind, dps, dpsSource, income: dps ? r2(h.qty * dps) : 0, yieldPct: dps && h.price ? r2(dps / h.price * 100) : null, safety, nextEx: next?.ex_date || null, nextPay: next?.payable_date || null, nextRate: next?.rate || null });
  }
  rows.sort((a, b) => b.income - a.income);
  let locked = 0; if (!paid) rows.forEach((r, i) => { if (i >= 3 && r.safety) { r.safety = null; r.locked = true; locked++; } });
  const fc = past ? monthlyForecast(hold, past) : null;
  const total = r2(rows.reduce((a, r) => a + r.income, 0)), value = rows.reduce((a, r) => a + (r.value || 0), 0);
  const calendar = (ahead || []).filter(p => syms.includes(p.symbol) && p.ex_date >= iso(now)).sort((a, b) => a.ex_date.localeCompare(b.ex_date)).map(p => ({ ...p, amount: r2((hold.find(h => h.symbol === p.symbol)?.qty || 0) * p.rate) }));
  const inMonthly = new Set((fc?.months || []).flatMap(m => m.items.map(i => i.symbol))), notMonthly = rows.filter(r => r.dps && !inMonthly.has(r.symbol)).map(r => r.symbol);
  return { account, rows, total, notMonthly, yieldOnValue: value ? r2(total / value * 100) : null, monthly: fc?.months || null, calendar, calendarNote: ahead ? null : 'Upcoming ex-dividend dates need market data (Alpaca), which is not set up on this server.', source, locked,
    drip: (((await getSetting(userId, 'drip', { accounts: [] })) || {}).accounts || []).includes(account), note: NOTE };
}

export const incomeRouter = (() => {
  const r = express.Router(); r.use(requireUser);
  r.get('/', async (req, res) => {
    const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper';
    try { res.json(await incomeFor(req.user.id, account, isPaid(req.user))); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Not available right now.' }); }
  });
  r.get('/passive', async (req, res) => {
    const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper';
    try { res.json(await passiveFor(req.user.id, account)); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Not available right now.' }); }
  });
  return r;
})();

// ---------- passive investing ----------
// Model mixes of low-cost index funds (examples to learn from, not advice for anyone's situation).
export const MIXES = [
  { id: 'cautious', name: 'Cautious', parts: [['VT', 40], ['BND', 60]], about: 'More bonds: smaller falls, slower growth.' },
  { id: 'balanced', name: 'Balanced', parts: [['VTI', 45], ['VXUS', 25], ['BND', 30]], about: 'The classic three-fund mix.' },
  { id: 'growth', name: 'Growth', parts: [['VTI', 60], ['VXUS', 30], ['BND', 10]], about: 'Mostly stocks: bigger swings, for long horizons.' },
  { id: 'allstock', name: 'All stocks', parts: [['VT', 100]], about: 'One fund holding the whole world\'s stock market.' },
];
// What part of an account is in broad funds, single stocks and cash, and the weighted yearly fund fee.
// funds: { SYMBOL: { fee, broad } } for the funds known to the toolkit.
export function passiveCheck(positions, cash, funds) {
  let broad = 0, otherFunds = 0, stocks = 0, feeDollars = 0, feeKnown = 0;
  for (const p of positions) {
    const v = Math.abs(+p.value || 0), f = funds[p.symbol];
    if (f) { if (f.broad) broad += v; else otherFunds += v; if (f.fee != null) { feeDollars += v * f.fee / 100; feeKnown += v; } } else stocks += v;
  }
  const total = broad + otherFunds + stocks + Math.max(0, cash || 0);
  const pc = x => (total ? r2(x / total * 100, 1) : null);
  return { total: r2(total), broadPct: pc(broad), fundsPct: pc(otherFunds), stocksPct: pc(stocks), cashPct: pc(Math.max(0, cash || 0)), fee: feeKnown ? r2(feeDollars / feeKnown * 100, 3) : null,
    label: !total ? null : broad / total >= 0.6 ? 'Mostly passive' : broad / total >= 0.25 ? 'Part passive' : 'Mostly hand-picked' };
}
// What a yearly fee costs over the years on a starting amount and a yearly return (an example).
export const feeDrag = (amount, years, ret, fee) => r2(amount * (Math.pow(1 + ret / 100, years) - Math.pow(1 + (ret - fee) / 100, years)));

export async function passiveFor(userId, account) {
  const { INDEX_FUNDS, ETF_CLASS } = await import('./wealth.js');
  const funds = {};
  for (const [k, [cls]] of Object.entries(ETF_CLASS)) funds[k] = { broad: /^Broad|^Bonds|^Cash/.test(cls), fee: null };
  for (const f of INDEX_FUNDS) funds[f.symbol] = { ...(funds[f.symbol] || { broad: f.kind !== 'growth' }), fee: f.fee };
  const sum = await accountSummary(userId, account);
  const check = passiveCheck(sum.positions || [], sum.cash, funds);
  return { account, check, mixes: MIXES.map(m => ({ ...m, fee: r2(m.parts.reduce((a, [s, w]) => a + (INDEX_FUNDS.find(f => f.symbol === s)?.fee || 0) * w / 100, 0), 3) })), funds: INDEX_FUNDS.slice(0, 8),
    dragExample: { amount: 10000, years: 30, ret: 7, low: feeDrag(10000, 30, 7, 0.03), high: feeDrag(10000, 30, 7, 1.0) },
    note: 'Examples to learn from, not advice for your situation. Returns are not guaranteed and index funds fall when markets fall.' };
}
