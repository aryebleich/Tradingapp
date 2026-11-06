// Business tools: the calculations, kept free of the database so they can be tested on their own.
//   ledger     a chart of accounts and double-entry journal entries (debits always equal credits)
//   reports    trial balance, profit & loss, balance sheet, cash flow with a 3-month forecast, metrics
//   invoices   totals, tax and the journal entries an invoice and its payment make
//   payroll    gross to net (federal withholding from the IRS brackets, Social Security, Medicare,
//              state), employer taxes, the journal entry, and a NACHA file for direct deposit
//   inventory  average cost, cost of goods sold, reorder alerts
//   bank       categorising transactions by rules and matching them to the books
// Estimates for running a small business; not tax, legal or accounting advice.
import { federalTable } from '../taxrates.js';

export const r2 = x => Math.round((+x || 0) * 100) / 100;
export const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
// Normal balance: assets and expenses grow with debits; the rest with credits.
const debitNormal = t => t === 'asset' || t === 'expense';

export const CHART = [
  ['1000', 'Cash and bank', 'asset'], ['1100', 'Accounts receivable', 'asset'], ['1200', 'Inventory', 'asset'], ['1500', 'Equipment', 'asset'],
  ['2000', 'Accounts payable', 'liability'], ['2100', 'Sales tax payable', 'liability'], ['2200', 'Payroll liabilities', 'liability'], ['2300', 'Credit card', 'liability'],
  ['3000', "Owner's equity", 'equity'], ['3100', 'Retained earnings', 'equity'],
  ['4000', 'Sales', 'income'], ['4100', 'Service revenue', 'income'], ['4900', 'Other income', 'income'],
  ['5000', 'Cost of goods sold', 'expense'], ['6000', 'Wages', 'expense'], ['6100', 'Payroll taxes', 'expense'], ['6200', 'Rent', 'expense'],
  ['6300', 'Utilities', 'expense'], ['6400', 'Software and subscriptions', 'expense'], ['6500', 'Advertising', 'expense'], ['6600', 'Office supplies', 'expense'],
  ['6700', 'Travel', 'expense'], ['6800', 'Meals', 'expense'], ['6900', 'Bank and payment fees', 'expense'], ['6950', 'Professional services', 'expense'], ['6990', 'Other expenses', 'expense'],
].map(([code, name, type]) => ({ code, name, type }));
export const CASH = '1000', AR = '1100', INVENTORY = '1200', AP = '2000', SALES_TAX = '2100', PAYROLL_LIAB = '2200', SALES = '4000', COGS = '5000', WAGES = '6000', PAYROLL_TAX = '6100';

const bad = m => Object.assign(new Error(m), { status: 400 });

// ---------- journal ----------
// lines: [{ account: code, debit, credit, memo }]; amounts in the base currency (rate applied).
export function checkEntry(e, accounts) {
  const codes = new Set(accounts.map(a => a.code));
  const lines = (e.lines || []).map(l => ({ account: String(l.account || ''), debit: r2(l.debit), credit: r2(l.credit), memo: String(l.memo || '').slice(0, 120) })).filter(l => l.debit || l.credit);
  if (lines.length < 2) throw bad('A journal entry needs at least two lines');
  for (const l of lines) {
    if (!codes.has(l.account)) throw bad(`Unknown account ${l.account}`);
    if (l.debit < 0 || l.credit < 0) throw bad('Amounts cannot be negative');
    if (l.debit && l.credit) throw bad('A line is either a debit or a credit');
  }
  const d = r2(lines.reduce((s, l) => s + l.debit, 0)), c = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(d - c) > 0.005) throw bad(`Debits (${d}) and credits (${c}) must be equal`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) throw bad('Give the date as YYYY-MM-DD');
  return { date: e.date, memo: String(e.memo || '').slice(0, 200), tags: [...new Set((e.tags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 10), lines, source: e.source || 'manual', ref: e.ref || null, total: d };
}

export function balances(entries, accounts, { from = null, to = null } = {}) {
  const b = Object.fromEntries(accounts.map(a => [a.code, { ...a, debit: 0, credit: 0, balance: 0 }]));
  for (const e of entries) {
    if ((from && e.date < from) || (to && e.date > to)) continue;
    for (const l of e.lines) if (b[l.account]) { b[l.account].debit += l.debit; b[l.account].credit += l.credit; }
  }
  for (const a of Object.values(b)) { a.debit = r2(a.debit); a.credit = r2(a.credit); a.balance = r2(debitNormal(a.type) ? a.debit - a.credit : a.credit - a.debit); }
  return b;
}

// ---------- reports ----------
export function profitAndLoss(entries, accounts, from, to) {
  const b = Object.values(balances(entries, accounts, { from, to }));
  const income = b.filter(a => a.type === 'income' && a.balance), expenses = b.filter(a => a.type === 'expense' && a.balance);
  const ti = r2(income.reduce((s, a) => s + a.balance, 0)), te = r2(expenses.reduce((s, a) => s + a.balance, 0));
  const cogs = r2(expenses.filter(a => a.code === COGS).reduce((s, a) => s + a.balance, 0));
  return { from, to, income, expenses, totalIncome: ti, totalExpenses: te, grossProfit: r2(ti - cogs), net: r2(ti - te), margin: ti ? +((ti - te) / ti * 100).toFixed(1) : null };
}
export function balanceSheet(entries, accounts, asOf) {
  const b = Object.values(balances(entries, accounts, { to: asOf }));
  const pick = t => b.filter(a => a.type === t && a.balance);
  const sum = xs => r2(xs.reduce((s, a) => s + a.balance, 0));
  const earnings = r2(sum(b.filter(a => a.type === 'income')) - sum(b.filter(a => a.type === 'expense')));
  const assets = pick('asset'), liabilities = pick('liability'), equity = pick('equity');
  const totalEquity = r2(sum(equity) + earnings);
  return { asOf, assets, liabilities, equity, earnings, totalAssets: sum(assets), totalLiabilities: sum(liabilities), totalEquity, balanced: Math.abs(sum(assets) - sum(liabilities) - totalEquity) < 0.01 };
}
// Money in and out of the cash accounts by month, and the next 3 months from the average of the
// last 3 plus invoices that are due (estimate).
export function cashFlow(entries, { months = 12, openInvoices = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const by = {};
  for (const e of entries) for (const l of e.lines) if (l.account === CASH) { const m = e.date.slice(0, 7); by[m] ||= { month: m, in: 0, out: 0 }; by[m].in += l.debit; by[m].out += l.credit; }
  const list = Object.values(by).sort((a, b) => a.month.localeCompare(b.month)).slice(-months).map(x => ({ ...x, in: r2(x.in), out: r2(x.out), net: r2(x.in - x.out) }));
  const recent = list.slice(-3), avgNet = recent.length ? recent.reduce((s, x) => s + x.net, 0) / recent.length : 0;
  const forecast = [1, 2, 3].map(k => {
    const d = new Date(today + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); const m = d.toISOString().slice(0, 7);
    const due = openInvoices.filter(i => (i.due || '').slice(0, 7) === m).reduce((s, i) => s + (i.balance || 0), 0);
    return { month: m, net: r2(avgNet + due), fromInvoices: r2(due) };
  });
  return { months: list, forecast, averageNet: r2(avgNet) };
}

// ---------- invoices ----------
export function invoiceTotals(inv) {
  const lines = (inv.lines || []).map(l => ({ desc: String(l.desc || '').slice(0, 200), qty: +l.qty || 0, price: r2(l.price), item: l.item ? String(l.item) : null, amount: r2((+l.qty || 0) * (+l.price || 0)) })).filter(l => l.desc || l.amount);
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0)), tax = r2(subtotal * (+inv.taxPct || 0) / 100);
  const paid = r2((inv.payments || []).reduce((s, p) => s + (+p.amount || 0), 0));
  return { lines, subtotal, tax, total: r2(subtotal + tax), paid, balance: r2(subtotal + tax - paid) };
}
// Issuing: receivable up, sales and the tax owed up; payment: cash in, receivable down.
export function invoiceEntry(inv, rate = 1) {
  const t = invoiceTotals(inv), x = v => r2(v * rate);
  return { date: inv.issue, memo: `Invoice ${inv.number} · ${inv.contact?.name || ''}`, source: 'invoice', ref: inv.id, lines: [{ account: AR, debit: x(t.total) }, { account: SALES, credit: x(t.subtotal) }, ...(t.tax ? [{ account: SALES_TAX, credit: x(t.tax) }] : [])].map(l => ({ debit: 0, credit: 0, ...l })) };
}
export function paymentEntry(inv, amount, date, rate = 1) {
  const a = r2(amount * rate);
  return { date, memo: `Payment for invoice ${inv.number}`, source: 'payment', ref: inv.id, lines: [{ account: CASH, debit: a, credit: 0 }, { account: AR, debit: 0, credit: a }] };
}
export const nextDate = (date, every) => {
  const d = new Date(date + 'T00:00:00Z'); const m = { monthly: 1, quarterly: 3, yearly: 12 }[every];
  if (!m) return null; d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10);
};

// ---------- inventory ----------
export function receiveStock(item, qty, unitCost) {
  qty = +qty; unitCost = +unitCost;
  if (!(qty > 0) || !(unitCost >= 0)) throw bad('Give a quantity above 0 and a cost');
  const total = (item.qty || 0) + qty, avg = total ? ((item.qty || 0) * (item.avgCost || 0) + qty * unitCost) / total : unitCost;
  return { ...item, qty: +total.toFixed(4), avgCost: +avg.toFixed(4) };
}
export function sellStock(item, qty) {
  qty = +qty;
  if (!(qty > 0)) throw bad('Give a quantity above 0');
  if (qty > (item.qty || 0) + 1e-9) throw bad(`Only ${item.qty || 0} of ${item.name} in stock`);
  return { item: { ...item, qty: +((item.qty || 0) - qty).toFixed(4) }, cogs: r2(qty * (item.avgCost || 0)) };
}
export const needsReorder = item => item.reorderPoint != null && item.reorderPoint !== '' && (item.qty || 0) <= +item.reorderPoint;

// ---------- payroll (United States, estimates) ----------
export const PAYROLL = { ssRate: 0.062, ssWageBase: { 2025: 176100, 2026: 184500 }, medicare: 0.0145, addlMedicare: 0.009, addlMedicareOver: 200000, futa: 0.006, futaBase: 7000 };
export const PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const bracketTax = (taxable, t) => {
  const rates = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37], edges = [0, ...t.b];
  let tax = 0;
  for (let i = 0; i < rates.length; i++) { const lo = edges[i], hi = i < t.b.length ? edges[i + 1] : Infinity; if (taxable > lo) tax += (Math.min(taxable, hi) - lo) * rates[i]; }
  return tax;
};
// Federal income tax withheld for one paycheck: wages annualized, less the standard deduction
// (a 2020-or-later Form W-4 with no adjustments), through the year's brackets, per period.
export function federalWithholding(gross, frequency, filing = 'single', year = new Date().getFullYear(), extra = 0) {
  const n = PERIODS[frequency] || 26, t = federalTable(year)[filing] || federalTable(year).single;
  const taxable = Math.max(0, gross * n - t.std);
  return r2(bracketTax(taxable, t) / n + (+extra || 0));
}
// One paycheck. ytd: wages already paid this year (for the Social Security and FUTA limits).
export function paycheck(emp, { hours = 0, overtime = 0, bonus = 0, ytd = 0, year = new Date().getFullYear() } = {}) {
  const n = PERIODS[emp.frequency] || 26;
  const gross = r2(emp.payType === 'hourly' ? (+hours || 0) * emp.rate + (+overtime || 0) * emp.rate * 1.5 + (+bonus || 0) : emp.rate / n + (+bonus || 0));
  const base = PAYROLL.ssWageBase[year] || PAYROLL.ssWageBase[2026];
  const ssWages = Math.max(0, Math.min(gross, base - ytd));
  const ss = r2(ssWages * PAYROLL.ssRate);
  const medicare = r2(gross * PAYROLL.medicare + Math.max(0, ytd + gross - Math.max(ytd, PAYROLL.addlMedicareOver)) * PAYROLL.addlMedicare);
  const federal = federalWithholding(gross, emp.frequency, emp.filing, year, emp.extraWithholding);
  const state = r2(gross * (+emp.stateRate || 0) / 100);
  const net = r2(gross - ss - medicare - federal - state);
  const futa = r2(Math.max(0, Math.min(gross, PAYROLL.futaBase - ytd)) * PAYROLL.futa);
  const suta = r2(Math.max(0, Math.min(gross, (+emp.sutaBase || 7000) - ytd)) * (+emp.sutaRate || 0) / 100);
  const employer = { ss, medicare: r2(gross * PAYROLL.medicare), futa, suta, total: r2(ss + gross * PAYROLL.medicare + futa + suta) };
  return { employee: emp.id, name: emp.name, gross, federal, ss, medicare, state, net, employer, ssWages: r2(ssWages), periods: n };
}
export function payrollEntry(run, date) {
  const g = r2(run.reduce((s, p) => s + p.gross, 0)), net = r2(run.reduce((s, p) => s + p.net, 0)), er = r2(run.reduce((s, p) => s + p.employer.total, 0));
  return { date, memo: `Payroll ${date}`, source: 'payroll', lines: [{ account: WAGES, debit: g, credit: 0 }, { account: PAYROLL_TAX, debit: er, credit: 0 }, { account: CASH, debit: 0, credit: net }, { account: PAYROLL_LIAB, debit: 0, credit: r2(g - net + er) }] };
}
// W-2 boxes for a year from the pay stubs.
export function w2(stubs) {
  const s = k => r2(stubs.reduce((t, p) => t + (+p[k] || 0), 0));
  return { wages: s('gross'), federalWithheld: s('federal'), ssWages: s('ssWages'), ssTax: s('ss'), medicareWages: s('gross'), medicareTax: s('medicare'), stateWages: s('gross'), stateTax: s('state') };
}

// NACHA (ACH) file for direct deposit: one PPD batch of credits to employees' checking accounts.
const pad = (v, n, right = false) => { const s = String(v ?? '').slice(0, n); return right ? s.padEnd(n) : s.padStart(n, '0'); };
const abaOk = r => /^\d{9}$/.test(r) && [...r].reduce((s, d, i) => s + +d * [3, 7, 1][i % 3], 0) % 10 === 0;
export function nacha({ company, payments, effectiveDate, fileId = 'A', now = new Date() }) {
  if (!abaOk(String(company.odfiRouting || ''))) throw bad("Your bank's routing number (9 digits) is needed for the direct-deposit file");
  if (!company.companyId) throw bad('Your company ID for ACH (usually your EIN with a 1 in front) is needed');
  const yymmdd = d => d.toISOString().slice(2, 10).replace(/-/g, ''), eff = effectiveDate.replace(/-/g, '').slice(2);
  const lines = [], dest = String(company.odfiRouting);
  // File header: destination (your bank), origin (your company ID), date, time, format.
  lines.push('1' + '01' + (' ' + dest) + String(company.companyId).slice(0, 10).padStart(10) + yymmdd(now) + now.toISOString().slice(11, 16).replace(':', '') + fileId + '094' + '10' + '1' + pad(company.bankName || 'BANK', 23, true) + pad(company.name, 23, true) + pad('', 8, true));
  const odfi8 = dest.slice(0, 8);
  lines.push('5' + '220' + pad(company.name, 16, true) + pad('', 20, true) + pad(company.companyId, 10, true) + 'PPD' + pad('PAYROLL', 10, true) + pad('', 6, true) + eff + '   ' + '1' + odfi8 + pad(1, 7));
  let hash = 0, total = 0, n = 0;
  for (const p of payments) {
    if (!abaOk(String(p.routing || ''))) throw bad(`Routing number for ${p.name} is not valid`);
    if (!/^\d{4,17}$/.test(String(p.account || ''))) throw bad(`Account number for ${p.name} is not valid`);
    const cents = Math.round(p.amount * 100); if (cents <= 0) continue;
    n++; hash += +String(p.routing).slice(0, 8); total += cents;
    lines.push('6' + (p.type === 'savings' ? '32' : '22') + String(p.routing).slice(0, 8) + String(p.routing)[8] + pad(p.account, 17, true) + pad(cents, 10) + pad(p.id || n, 15, true) + pad(p.name, 22, true) + '  ' + '0' + odfi8 + pad(n, 7));
  }
  lines.push('8' + '220' + pad(n, 6) + pad(hash % 1e10, 10) + pad(0, 12) + pad(total, 12) + pad(company.companyId, 10, true) + pad('', 19, true) + pad('', 6, true) + odfi8 + pad(1, 7));
  const blocks = Math.ceil((lines.length + 1) / 10);
  lines.push('9' + pad(1, 6) + pad(blocks, 6) + pad(n, 8) + pad(hash % 1e10, 10) + pad(0, 12) + pad(total, 12) + pad('', 39, true));
  while (lines.length % 10) lines.push('9'.repeat(94));
  return { text: lines.map(l => l.padEnd(94).slice(0, 94)).join('\n') + '\n', count: n, total: r2(total / 100) };
}

// ---------- bank ----------
export const RULES = [
  [/\b(stripe|square|paypal)\b.*(payout|transfer)|\bdeposit\b|\bpayout\b/i, '4000'], [/\brent\b|\blease\b/i, '6200'],
  [/electric|\bgas\b|water|con ?ed|pg&e|utility|comcast|verizon|at&t|t-mobile|internet/i, '6300'],
  [/google|microsoft|adobe|aws|amazon web|github|slack|zoom|notion|dropbox|openai|anthropic|figma|shopify|quickbooks|software|subscription/i, '6400'],
  [/facebook|meta ads|google ads|linkedin|advert|marketing/i, '6500'], [/staples|office depot|supplies|printer|ink/i, '6600'],
  [/airline|delta|united|american air|uber|lyft|hotel|airbnb|marriott|hilton|amtrak|travel/i, '6700'], [/restaurant|cafe|coffee|starbucks|doordash|grubhub|meal|pizza|bar\b/i, '6800'],
  [/\bfee\b|interest charge|service charge|wire fee/i, '6900'], [/attorney|lawyer|cpa|accountant|consult/i, '6950'], [/payroll|gusto|adp|paychex/i, '6000'],
];
export const ruleCategory = (description, amount) => { for (const [re, code] of RULES) if (re.test(description)) return code === '4000' && amount < 0 ? null : code; return amount > 0 ? '4900' : null; };
// A bank line matches a journal entry that moved the same amount of cash within 5 days.
export function matchBank(tx, entries) {
  const day = d => Date.parse(d + 'T00:00:00Z');
  return entries.find(e => Math.abs(day(e.date) - day(tx.date)) <= 5 * 864e5 && e.lines.some(l => l.account === CASH && Math.abs((tx.amount > 0 ? l.debit : l.credit) - Math.abs(tx.amount)) < 0.01)) || null;
}
// A bank line, posted: cash against its category.
export const bankEntry = (tx, code) => ({ date: tx.date, memo: tx.description.slice(0, 120), source: 'bank', ref: tx.id, lines: tx.amount > 0 ? [{ account: CASH, debit: r2(tx.amount), credit: 0 }, { account: code, debit: 0, credit: r2(tx.amount) }] : [{ account: code, debit: r2(-tx.amount), credit: 0 }, { account: CASH, debit: 0, credit: r2(-tx.amount) }] });
// CSV from a bank: a date column, a description, and one amount column (or debit and credit).
export function parseBankCsv(text) {
  const rows = String(text || '').split(/\r?\n/).filter(l => l.trim()).map(l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); });
  if (rows.length < 2) throw bad('The file has no transactions');
  const h = rows[0].map(x => x.toLowerCase()), col = re => h.findIndex(x => re.test(x));
  const di = col(/date/), de = col(/desc|memo|payee|name|details/), am = col(/^amount|amount$/), dr = col(/debit|withdraw/), cr = col(/credit|deposit/);
  if (di < 0 || de < 0 || (am < 0 && dr < 0 && cr < 0)) throw bad('Columns needed: Date, Description and Amount (or Debit and Credit)');
  const num = v => +String(v || '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1') || 0;
  const date = v => { const s = String(v); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  return rows.slice(1).map(r => ({ date: date(r[di]), description: r[de] || '', amount: r2(am >= 0 ? num(r[am]) : num(r[cr]) - num(r[dr])) })).filter(t => t.date && t.amount);
}
