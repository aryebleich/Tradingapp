// Monthly bookkeeping for taxes: every month's trades, realized gains (short and long term),
// dividends, interest, broker fees, deposits and withdrawals, with a running year-to-date total,
// how much to set aside for taxes, and the four IRS estimated-payment periods. A journal CSV
// holds every line item, and an opt-in email sends last month's books on the 1st.
// Informational only: the broker's 1099 is the official record.
import { all } from './db.js';
import { realizedGains } from './tax.js';
import { nyTime } from './time.js';
import { sendEmail } from './notify.js';
import { tradingForAccount } from './alpaca/connections.js';

const r2 = x => +(+x || 0).toFixed(2);
const monthOf = t => new Date(t).toISOString().slice(0, 7);
const ltRate = bracket => (bracket <= 0.12 ? 0 : bracket <= 0.35 ? 0.15 : 0.20);
// IRS estimated-tax periods for individuals (Form 1040-ES): the months each covers and its due date.
export const PERIODS = [
  { q: 1, months: [1, 2, 3], due: y => `${y}-04-15` },
  { q: 2, months: [4, 5], due: y => `${y}-06-15` },
  { q: 3, months: [6, 7, 8], due: y => `${y}-09-15` },
  { q: 4, months: [9, 10, 11, 12], due: y => `${y + 1}-01-15` },
];

// Tax on year-to-date amounts: net short-term and ordinary income (dividends, interest) at the
// bracket, net long-term at the long-term rate, plus the state rate. Net losses set aside nothing.
export function taxOn({ st, lt, ordinary }, { bracket = 0.24, stateRate = 0.05 }) {
  const stTaxable = Math.max(0, st + Math.min(lt, 0)), ltTaxable = Math.max(0, lt + Math.min(st, 0));
  const income = Math.max(0, ordinary + Math.min(0, st + lt));
  return r2(stTaxable * (bracket + stateRate) + ltTaxable * (ltRate(bracket) + stateRate) + income * (bracket + stateRate));
}

// fills: the account's fills (all years, so lots bought earlier count); ledger: { kind, amount, at };
// income: broker activities { type: 'DIV'|'INT'|'FEE', amount, at, symbol }.
export function monthlyBooks({ fills = [], ledger = [], income = [], year, bracket = 0.24, stateRate = 0.05 }) {
  const inYear = t => new Date(t).getUTCFullYear() === year;
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, trades: 0, bought: 0, sold: 0, shortTerm: 0, longTerm: 0, washSaleDisallowed: 0, dividends: 0, interest: 0, brokerFees: 0, deposits: 0, withdrawals: 0 }));
  const at = t => months[new Date(t).getUTCMonth()];
  const journal = [];
  for (const f of fills.filter(f => inYear(f.at))) {
    const m = at(f.at), amt = f.qty * f.price;
    m.trades++; m[f.side === 'buy' ? 'bought' : 'sold'] += amt;
    if (f.side === 'buy') journal.push({ at: f.at, type: 'Buy', symbol: f.symbol, qty: f.qty, price: f.price, amount: r2(-amt) });
  }
  for (const r of realizedGains(fills).filter(r => inYear(r.sold))) {
    const m = at(r.sold);
    if (r.washSale) m.washSaleDisallowed -= r.gain; else m[r.longTerm ? 'longTerm' : 'shortTerm'] += r.gain;
    journal.push({ at: r.sold, type: 'Sell', symbol: r.symbol, qty: r.qty, price: r.qty ? r2(r.proceeds / r.qty) : 0, amount: r.proceeds, cost: r.cost, gain: r.gain, term: r.longTerm ? 'Long' : 'Short', washSale: r.washSale });
  }
  for (const x of income.filter(x => inYear(x.at))) {
    const m = at(x.at), k = { DIV: 'dividends', INT: 'interest', FEE: 'brokerFees' }[x.type];
    if (!k) continue;
    m[k] += k === 'brokerFees' ? -x.amount : x.amount;
    journal.push({ at: x.at, type: { DIV: 'Dividend', INT: 'Interest', FEE: 'Broker fee' }[x.type], symbol: x.symbol || '', amount: r2(x.amount) });
  }
  for (const l of ledger.filter(l => inYear(l.at))) {
    const k = l.kind === 'deposit' ? 'deposits' : l.kind === 'withdrawal' ? 'withdrawals' : null;
    if (!k) continue;
    at(l.at)[k] += l.amount;
    journal.push({ at: l.at, type: k === 'deposits' ? 'Deposit' : 'Withdrawal', amount: r2(k === 'deposits' ? l.amount : -l.amount) });
  }
  const ytd = { st: 0, lt: 0, ordinary: 0 };
  for (const m of months) {
    ytd.st += m.shortTerm; ytd.lt += m.longTerm; ytd.ordinary += m.dividends + m.interest - m.brokerFees;
    for (const k of Object.keys(m)) if (typeof m[k] === 'number' && k !== 'trades') m[k] = r2(m[k]);
    m.realized = r2(m.shortTerm + m.longTerm);
    m.ytdRealized = r2(ytd.st + ytd.lt);
    m.ytdSetAside = taxOn(ytd, { bracket, stateRate });
  }
  let before = 0;
  const quarters = PERIODS.map(p => {
    const end = months[p.months[p.months.length - 1] - 1].ytdSetAside, owed = r2(Math.max(0, end - before));
    before = Math.max(before, end);
    return { q: p.q, months: p.months.map(i => months[i - 1].month), due: p.due(year), estimatedTax: owed };
  });
  const sum = k => r2(months.reduce((a, m) => a + m[k], 0));
  const totals = Object.fromEntries(['trades', 'bought', 'sold', 'shortTerm', 'longTerm', 'realized', 'washSaleDisallowed', 'dividends', 'interest', 'brokerFees', 'deposits', 'withdrawals'].map(k => [k, sum(k)]));
  totals.setAside = months[11].ytdSetAside;
  journal.sort((a, b) => a.at - b.at);
  return { year, bracket, stateRate, months, quarters, totals, journal };
}

const csvCell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function booksCsv(b) {
  const day = t => new Date(t).toISOString().slice(0, 10);
  const lines = [`Monthly books ${b.year}`, 'Month,Trades,Bought,Sold,Short-term gain,Long-term gain,Wash-sale disallowed,Dividends,Interest,Broker fees,Deposits,Withdrawals,Realized year to date,Set aside for taxes (year to date)',
    ...b.months.map(m => [m.month, m.trades, m.bought, m.sold, m.shortTerm, m.longTerm, m.washSaleDisallowed, m.dividends, m.interest, m.brokerFees, m.deposits, m.withdrawals, m.ytdRealized, m.ytdSetAside].join(',')),
    '', 'Estimated tax payments (Form 1040-ES)', 'Period,Months,Due,Estimated amount',
    ...b.quarters.map(q => [`Q${q.q}`, csvCell(q.months.join(' ')), q.due, q.estimatedTax].join(',')),
    '', 'Journal', 'Date,Type,Symbol,Quantity,Price,Amount,Cost basis,Gain or loss,Term,Wash sale',
    ...b.journal.map(j => [day(j.at), j.type, csvCell(j.symbol), j.qty ?? '', j.price ?? '', j.amount, j.cost ?? '', j.gain ?? '', j.term ?? '', j.washSale ? 'yes' : ''].join(','))];
  return lines.join('\n');
}

// Dividends, interest and fees from an Alpaca account (paper or live); nothing for other accounts.
export async function brokerIncome(userId, account, year) {
  const t = await tradingForAccount(userId, account).catch(() => null);
  if (!t) return [];
  const acts = await t.activities({ activity_types: 'DIV,INT,FEE', after: `${year}-01-01`, until: `${year}-12-31`, page_size: 100 }).catch(() => []);
  return (Array.isArray(acts) ? acts : []).map(a => ({ type: String(a.activity_type).slice(0, 3), amount: +a.net_amount || 0, symbol: a.symbol || '', at: Date.parse(a.date || a.transaction_time) || 0 })).filter(a => a.at);
}

export async function booksFor(user, account, year) {
  const fills = await all('SELECT * FROM fills WHERE user_id = ? AND account = ?', user.id, account);
  // Paper deposits are simulated; brokerage deposits count once the money arrived.
  const ledger = await all(`SELECT kind, amount, at FROM ledger WHERE user_id = ? AND kind IN ('deposit', 'withdrawal') AND status IN (${account === 'paper' ? "'simulated'" : "'received', 'transferred', 'paid'"})`, user.id);
  const income = account === 'paper' ? [] : await brokerIncome(user.id, account, year);
  return monthlyBooks({ fills, ledger, income, year, bracket: user.tax_bracket ?? 0.24, stateRate: user.state_tax ?? 0.05 });
}

// On the 1st (New York time), last month's books by email to everyone who switched it on.
export async function monthlyBooksEmail(t = Date.now()) {
  const n = nyTime(t);
  if (+n.day.slice(8) !== 1) return 0;
  const y = +n.day.slice(0, 4), mo = +n.day.slice(5, 7), year = mo === 1 ? y - 1 : y, month = mo === 1 ? 12 : mo - 1;
  const key = `${year}-${String(month).padStart(2, '0')}`, label = new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const money = x => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let sent = 0;
  for (const u of await all("SELECT u.* FROM users u JOIN user_settings s ON s.user_id = u.id WHERE s.k = 'booksMonthly' AND s.v = 'true'")) {
    const accounts = (await all('SELECT DISTINCT account FROM fills WHERE user_id = ?', u.id)).map(r => r.account);
    const parts = [];
    for (const a of accounts.length ? accounts : ['paper']) {
      const b = await booksFor(u, a, year), m = b.months[month - 1];
      if (!m.trades && !m.dividends && !m.interest && !m.deposits) continue;
      parts.push(`${a === 'paper' ? 'Paper' : a}: ${m.trades} trades, realized ${money(m.realized)} (short-term ${money(m.shortTerm)}, long-term ${money(m.longTerm)}), dividends ${money(m.dividends)}, interest ${money(m.interest)}. Year to date: realized ${money(m.ytdRealized)}, set aside about ${money(m.ytdSetAside)} for taxes.`);
      const due = b.quarters.find(q => q.months[q.months.length - 1] === key);
      if (due && due.estimatedTax > 0) parts.push(`Estimated tax payment for Q${due.q} (about ${money(due.estimatedTax)}) is due ${due.due}.`);
    }
    if (!parts.length || !u.email) continue;
    await sendEmail(u.email, `Brightfolio: your books for ${label}`, `Your monthly books for ${label}\n\n${parts.join('\n\n')}\n\nThe full month-by-month table and a journal CSV are in the app under Taxes → Monthly bookkeeping. Estimates for planning only; your broker's 1099 is the official record.`).catch(e => console.warn('books email', e.message));
    sent++;
  }
  return sent;
}
