// /api/biz: the business tools (Business section of the menu). Every record belongs to one user and
// is kept in biz_docs (kind + JSON), so each tool stays small: accounts, journal entries, contacts,
// invoices, items, employees, pay runs, bank lines, receipts and the company settings.
import express from 'express';
import crypto from 'node:crypto';
import { one, all, run, now, audit } from '../db.js';
import { requireUser, confirmsIdentity } from '../auth.js';
import { encrypt, tryDecrypt } from '../crypto.js';
import * as E from './engine.js';
import { sendEmail } from '../notify.js';
import { notifyUser } from '../notify-user.js';
import { markdownPdf } from '../pdf.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const today = () => new Date().toISOString().slice(0, 10);
const KINDS = ['account', 'entry', 'contact', 'invoice', 'item', 'employee', 'payrun', 'bank', 'receipt', 'settings'];

// ---------- storage ----------
export async function list(userId, kind) { return (await all('SELECT id, data FROM biz_docs WHERE user_id = ? AND kind = ? ORDER BY id', userId, kind)).map(r => ({ ...JSON.parse(r.data), id: r.id })); }
export async function get(userId, kind, id) { const r = await one('SELECT id, data FROM biz_docs WHERE user_id = ? AND kind = ? AND id = ?', userId, kind, +id); return r ? { ...JSON.parse(r.data), id: r.id } : null; }
export async function put(userId, kind, data, id = null) {
  const { id: _drop, ...rest } = data;
  if (id) { await run('UPDATE biz_docs SET data = ?, updated_at = ? WHERE user_id = ? AND kind = ? AND id = ?', JSON.stringify(rest), now(), userId, kind, +id); return { ...rest, id: +id }; }
  if ((await one('SELECT COUNT(*) AS n FROM biz_docs WHERE user_id = ? AND kind = ?', userId, kind)).n >= 20000) throw bad('Too many records of this kind');
  const r = await run('INSERT INTO biz_docs (user_id, kind, data, created_at, updated_at) VALUES (?,?,?,?,?)', userId, kind, JSON.stringify(rest), now(), now());
  return { ...rest, id: r.lastInsertRowid };
}
const del = (userId, kind, id) => run('DELETE FROM biz_docs WHERE user_id = ? AND kind = ? AND id = ?', userId, kind, +id);

export async function settings(userId) {
  const s = (await list(userId, 'settings'))[0];
  return { id: s?.id || null, name: '', address: '', email: '', currency: 'USD', invoicePrefix: 'INV-', nextNumber: 1, paymentTerms: 30, ...s, stripeKey: undefined, hasStripe: !!s?.stripeKey, bankAch: undefined };
}
async function rawSettings(userId) { return (await list(userId, 'settings'))[0] || null; }
export async function accounts(userId) {
  const mine = await list(userId, 'account');
  if (mine.length) return mine;
  for (const a of E.CHART) await put(userId, 'account', a); // the standard chart on first use
  return list(userId, 'account');
}
export async function post(userId, entry) {
  const e = E.checkEntry(entry, await accounts(userId));
  return put(userId, 'entry', { ...e, at: now() });
}

// ---------- currencies (European Central Bank rates through frankfurter.app, cached) ----------
const fxCache = new Map();
export async function fxRate(from, to, date = 'latest') {
  from = String(from || 'USD').toUpperCase(); to = String(to || 'USD').toUpperCase();
  if (from === to) return 1;
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw bad('Use 3-letter currency codes, e.g. USD, EUR, ILS');
  const k = `${from}${to}${date}`, hit = fxCache.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.rate;
  const base = (process.env.FX_API_URL || 'https://api.frankfurter.app').replace(/\/$/, '');
  const r = await fetch(`${base}/${date}?from=${from}&to=${to}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  const d = r?.ok ? await r.json().catch(() => null) : null;
  const rate = d?.rates?.[to];
  if (!rate) throw bad(`No exchange rate for ${from} to ${to} right now`, 502);
  fxCache.set(k, { rate, at: Date.now() }); return rate;
}
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'ILS', 'MXN', 'INR', 'CNY', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'NZD', 'ZAR', 'BRL', 'KRW', 'TRY'];

// ---------- invoices ----------
const publicUrl = () => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
async function issueInvoice(userId, inv) {
  const s = await settings(userId), rate = inv.currency && inv.currency !== s.currency ? await fxRate(inv.currency, s.currency, inv.issue).catch(() => 1) : 1;
  // Items sold come out of stock at their average cost (cost of goods sold).
  let cogs = 0;
  for (const l of inv.lines.filter(l => l.item)) {
    const it = await get(userId, 'item', l.item); if (!it) continue;
    const { item, cogs: c } = E.sellStock(it, l.qty); await put(userId, 'item', item, it.id); cogs += c;
    if (E.needsReorder(item)) await notifyUser(userId, `Reorder ${item.name}${item.variant ? ' (' + item.variant + ')' : ''}: ${item.qty} left (reorder point ${item.reorderPoint}).`).catch(() => {});
  }
  const entry = await post(userId, E.invoiceEntry(inv, rate));
  if (cogs) await post(userId, { date: inv.issue, memo: `Cost of goods for invoice ${inv.number}`, source: 'invoice', ref: inv.id, lines: [{ account: E.COGS, debit: cogs }, { account: E.INVENTORY, credit: cogs }] });
  return { rate, entry: entry.id };
}
async function recordPayment(userId, inv, amount, date, method = 'manual', ref = null) {
  const s = await settings(userId), t = E.invoiceTotals(inv);
  amount = E.r2(Math.min(+amount || t.balance, t.balance));
  if (!(amount > 0)) throw bad('Nothing is left to pay on this invoice');
  await post(userId, E.paymentEntry(inv, amount, date, inv.rate || 1));
  const payments = [...(inv.payments || []), { amount, date, method, ...(ref ? { ref } : {}) }];
  const paid = E.invoiceTotals({ ...inv, payments }).balance <= 0.005;
  const out = await put(userId, 'invoice', { ...inv, payments, status: paid ? 'paid' : 'partial', paidAt: paid ? now() : null }, inv.id);
  return out;
}
function invoiceMd(inv, s) {
  const t = E.invoiceTotals(inv), m = v => `${inv.currency || s.currency} ${(+v).toFixed(2)}`;
  return `# Invoice ${inv.number}\n\n**${s.name || 'Your business'}**${s.address ? '\n' + s.address : ''}${s.email ? '\n' + s.email : ''}\n\n**Bill to:** ${inv.contact?.name || ''}${inv.contact?.email ? ' · ' + inv.contact.email : ''}${inv.contact?.address ? '\n' + inv.contact.address : ''}\n\nIssued ${inv.issue} · Due ${inv.due}\n\n| Description | Qty | Price | Amount |\n|---|---|---|---|\n${t.lines.map(l => `| ${l.desc} | ${l.qty} | ${m(l.price)} | ${m(l.amount)} |`).join('\n')}\n\nSubtotal ${m(t.subtotal)}${t.tax ? `  \nTax (${inv.taxPct}%) ${m(t.tax)}` : ''}  \n**Total ${m(t.total)}**${t.paid ? `  \nPaid ${m(t.paid)}  \n**Balance due ${m(t.balance)}**` : ''}\n\n${inv.notes || ''}`;
}
// The customer pays by card through the business's own Stripe account (its secret key in Settings).
async function stripeCheckout(userId, inv) {
  const raw = await rawSettings(userId), key = tryDecrypt(raw?.stripeKey, 'Stripe key')?.k;
  if (!key) throw bad('Add your Stripe secret key in Business → Settings to take card payments online');
  const t = E.invoiceTotals(inv), cur = (inv.currency || 'USD').toLowerCase(), zero = ['jpy', 'krw'].includes(cur);
  const body = new URLSearchParams({ mode: 'payment', success_url: `${publicUrl()}/i/${inv.token}?paid={CHECKOUT_SESSION_ID}`, cancel_url: `${publicUrl()}/i/${inv.token}`, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': cur, 'line_items[0][price_data][unit_amount]': String(Math.round(t.balance * (zero ? 1 : 100))), 'line_items[0][price_data][product_data][name]': `Invoice ${inv.number}`, 'metadata[invoice]': String(inv.id), client_reference_id: inv.token, ...(inv.contact?.email ? { customer_email: inv.contact.email } : {}) });
  const r = await fetch((process.env.STRIPE_API_URL || 'https://api.stripe.com') + '/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw bad('Stripe: ' + (d.error?.message || r.status), 502);
  return d.url;
}
async function stripeSessionPaid(userId, sessionId) {
  const raw = await rawSettings(userId), key = tryDecrypt(raw?.stripeKey, 'Stripe key')?.k;
  if (!key || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  const r = await fetch((process.env.STRIPE_API_URL || 'https://api.stripe.com') + '/v1/checkout/sessions/' + sessionId, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  return r.ok && d.payment_status === 'paid' ? d : null;
}
async function emailInvoice(userId, inv) {
  if (!inv.contact?.email) return { skipped: 'no email' };
  const s = await settings(userId), t = E.invoiceTotals(inv);
  return sendEmail(inv.contact.email, `Invoice ${inv.number} from ${s.name || 'us'}`, `Hello ${inv.contact.name || ''},\n\nInvoice ${inv.number} for ${inv.currency || s.currency} ${t.balance.toFixed(2)} is due on ${inv.due}.\nView and pay it here: ${publicUrl()}/i/${inv.token}\n\nThank you,\n${s.name || ''}`);
}

// Daily: recurring invoices go out again, and stock below its reorder point is reported once a day.
export async function runBusiness(t = now()) {
  const day = new Date(t).toISOString().slice(0, 10);
  let n = 0;
  for (const r of await all("SELECT user_id, id, data FROM biz_docs WHERE kind = 'invoice'")) {
    const inv = { ...JSON.parse(r.data), id: r.id };
    if (!inv.recurring || inv.recurring === 'none' || inv.status === 'void' || !inv.nextDate || inv.nextDate > day) continue;
    try {
      const s = await settings(r.user_id), number = `${s.invoicePrefix}${String(s.nextNumber).padStart(4, '0')}`;
      const due = new Date(Date.parse(day) + (s.paymentTerms || 30) * 864e5).toISOString().slice(0, 10);
      const copy = await put(r.user_id, 'invoice', { ...inv, id: undefined, number, issue: day, due, recurring: 'none', nextDate: null, payments: [], status: 'sent', token: crypto.randomBytes(16).toString('base64url'), from: inv.id });
      Object.assign(copy, await issueInvoice(r.user_id, copy)); await put(r.user_id, 'invoice', copy, copy.id);
      await put(r.user_id, 'settings', { ...(await rawSettings(r.user_id)), nextNumber: s.nextNumber + 1 }, s.id || undefined);
      await put(r.user_id, 'invoice', { ...inv, nextDate: E.nextDate(inv.nextDate, inv.recurring) }, inv.id);
      await emailInvoice(r.user_id, copy).catch(() => {}); n++;
    } catch (e) { console.warn('recurring invoice', r.id, e.message); }
  }
  return n;
}

// Receipts: the AI (when one is set up and can read images) reads vendor, date, total and tax.
async function readReceipt(image) {
  const { visionJson, llmEnabled } = await import('../llm.js');
  if (!llmEnabled() || !visionJson) return null;
  return visionJson({ image, prompt: 'Read this receipt. Return vendor, date (YYYY-MM-DD), total, tax and a short category (e.g. Meals, Travel, Office supplies, Software).', schema: { type: 'object', properties: { vendor: { type: 'string' }, date: { type: 'string' }, total: { type: 'number' }, tax: { type: 'number' }, category: { type: 'string' } }, required: ['vendor', 'date', 'total'] } }).catch(() => null);
}
const CATEGORY_CODE = { meals: '6800', travel: '6700', 'office supplies': '6600', software: '6400', advertising: '6500', utilities: '6300', rent: '6200', fees: '6900' };

export const bizRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const U = req => req.user.id;

  r.get('/overview', async (req, res) => {
    const [accts, entries, invoices, items, s] = await Promise.all([accounts(U(req)), list(U(req), 'entry'), list(U(req), 'invoice'), list(U(req), 'item'), settings(U(req))]);
    const y = today().slice(0, 4), m = today().slice(0, 7);
    const ytd = E.profitAndLoss(entries, accts, `${y}-01-01`, today()), mtd = E.profitAndLoss(entries, accts, `${m}-01`, today());
    const open = invoices.filter(i => ['sent', 'partial'].includes(i.status)).map(i => ({ ...i, ...E.invoiceTotals(i) }));
    const bal = E.balances(entries, accts);
    const cf = E.cashFlow(entries, { openInvoices: open });
    const burn = cf.averageNet < 0 ? -cf.averageNet : 0;
    res.json({ settings: s, ytd, mtd, cash: bal[E.CASH]?.balance || 0, receivable: E.r2(open.reduce((t, i) => t + i.balance, 0)), overdue: E.r2(open.filter(i => i.due < today()).reduce((t, i) => t + i.balance, 0)), payable: bal[E.AP]?.balance || 0, runwayMonths: burn ? +((bal[E.CASH]?.balance || 0) / burn).toFixed(1) : null, reorder: items.filter(E.needsReorder).map(i => ({ id: i.id, name: i.name, variant: i.variant, qty: i.qty, reorderPoint: i.reorderPoint })), cashFlow: cf });
  });

  // ---------- settings ----------
  r.get('/settings', async (req, res) => res.json({ ...(await settings(U(req))), currencies: CURRENCIES }));
  r.put('/settings', async (req, res) => {
    const b = req.body || {}, raw = await rawSettings(U(req)) || {};
    const next = { ...raw, name: String(b.name ?? raw.name ?? '').slice(0, 80), address: String(b.address ?? raw.address ?? '').slice(0, 300), email: String(b.email ?? raw.email ?? '').slice(0, 120), currency: CURRENCIES.includes(b.currency) ? b.currency : raw.currency || 'USD', invoicePrefix: String(b.invoicePrefix ?? raw.invoicePrefix ?? 'INV-').slice(0, 10), nextNumber: Math.max(1, +b.nextNumber || raw.nextNumber || 1), paymentTerms: Math.max(0, Math.min(120, +(b.paymentTerms ?? raw.paymentTerms ?? 30))),
      ach: { companyId: String(b.ach?.companyId ?? raw.ach?.companyId ?? '').slice(0, 10), odfiRouting: String(b.ach?.odfiRouting ?? raw.ach?.odfiRouting ?? '').slice(0, 9), bankName: String(b.ach?.bankName ?? raw.ach?.bankName ?? '').slice(0, 23) } };
    if (b.stripeKey) { if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(b.stripeKey)) throw bad('That does not look like a Stripe secret key (sk_live_… or sk_test_…)'); next.stripeKey = encrypt({ k: String(b.stripeKey).trim() }); }
    if (b.stripeKey === '') delete next.stripeKey;
    await put(U(req), 'settings', next, raw.id);
    res.json(await settings(U(req)));
  });
  r.get('/fx', async (req, res) => { const rate = await fxRate(req.query.from, req.query.to, /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : 'latest'); res.json({ from: String(req.query.from).toUpperCase(), to: String(req.query.to).toUpperCase(), rate, amount: +req.query.amount || 1, converted: E.r2((+req.query.amount || 1) * rate) }); });

  // ---------- ledger ----------
  r.get('/accounts', async (req, res) => res.json(Object.values(E.balances(await list(U(req), 'entry'), await accounts(U(req)))).sort((a, b) => a.code.localeCompare(b.code))));
  r.post('/accounts', async (req, res) => {
    const b = req.body || {}, list0 = await accounts(U(req));
    if (!/^\d{3,6}$/.test(b.code || '')) throw bad('An account code is 3 to 6 digits');
    if (list0.some(a => a.code === b.code)) throw bad('That code is taken');
    if (!E.TYPES.includes(b.type)) throw bad('Pick asset, liability, equity, income or expense');
    res.json(await put(U(req), 'account', { code: b.code, name: String(b.name || '').slice(0, 60) || b.code, type: b.type }));
  });
  r.get('/entries', async (req, res) => { const tag = req.query.tag ? String(req.query.tag).toLowerCase() : null; res.json((await list(U(req), 'entry')).filter(e => !tag || e.tags?.includes(tag)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 500)); });
  r.post('/entries', async (req, res) => res.json(await post(U(req), req.body || {})));
  r.delete('/entries/:id', async (req, res) => { await del(U(req), 'entry', req.params.id); res.json({ ok: true }); });

  // ---------- reports ----------
  r.get('/reports', async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : `${today().slice(0, 4)}-01-01`, to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
    const [accts, entries, invoices] = await Promise.all([accounts(U(req)), list(U(req), 'entry'), list(U(req), 'invoice')]);
    const open = invoices.filter(i => ['sent', 'partial'].includes(i.status)).map(i => ({ ...i, ...E.invoiceTotals(i) }));
    const bal = E.balances(entries, accts, { to });
    res.json({ pnl: E.profitAndLoss(entries, accts, from, to), balance: E.balanceSheet(entries, accts, to), cashFlow: E.cashFlow(entries, { openInvoices: open, today: to }), trial: Object.values(bal).filter(a => a.debit || a.credit),
      byTag: Object.entries(entries.filter(e => e.date >= from && e.date <= to).reduce((m, e) => { for (const t of e.tags || []) m[t] = (m[t] || 0) + e.total; return m; }, {})).map(([tag, total]) => ({ tag, total: E.r2(total) })) });
  });
  r.get('/reports.pdf', async (req, res) => {
    const [accts, entries, s] = await Promise.all([accounts(U(req)), list(U(req), 'entry'), settings(U(req))]);
    const y = today().slice(0, 4), p = E.profitAndLoss(entries, accts, `${y}-01-01`, today()), b = E.balanceSheet(entries, accts, today());
    const row = a => `| ${a.code} ${a.name} | ${a.balance.toFixed(2)} |`;
    const md = `# ${s.name || 'Business'} reports\n\n## Profit and loss ${y} to date\n\n| Account | Amount |\n|---|---|\n${p.income.map(row).join('\n')}\n| **Total income** | **${p.totalIncome.toFixed(2)}** |\n${p.expenses.map(row).join('\n')}\n| **Total expenses** | **${p.totalExpenses.toFixed(2)}** |\n| **Net profit** | **${p.net.toFixed(2)}** |\n\n## Balance sheet ${today()}\n\n| Account | Amount |\n|---|---|\n${b.assets.map(row).join('\n')}\n| **Total assets** | **${b.totalAssets.toFixed(2)}** |\n${b.liabilities.map(row).join('\n')}\n| **Total liabilities** | **${b.totalLiabilities.toFixed(2)}** |\n${b.equity.map(row).join('\n')}\n| Earnings | ${b.earnings.toFixed(2)} |\n| **Total equity** | **${b.totalEquity.toFixed(2)}** |\n\nAmounts in ${s.currency}. Prepared from your own books; not audited.`;
    const { pdf } = markdownPdf(md, { title: `${s.name || 'Business'} reports`, toc: false });
    res.type('application/pdf').attachment(`reports-${today()}.pdf`).send(pdf);
  });

  // ---------- contacts ----------
  r.get('/contacts', async (req, res) => res.json(await list(U(req), 'contact')));
  r.post('/contacts', async (req, res) => { const b = req.body || {}; if (!String(b.name || '').trim()) throw bad('Give the customer a name'); res.json(await put(U(req), 'contact', { kind: b.kind === 'vendor' ? 'vendor' : 'customer', name: String(b.name).trim().slice(0, 80), email: String(b.email || '').trim().slice(0, 120), address: String(b.address || '').slice(0, 300) })); });
  r.delete('/contacts/:id', async (req, res) => { await del(U(req), 'contact', req.params.id); res.json({ ok: true }); });

  // ---------- invoices ----------
  r.get('/invoices', async (req, res) => res.json((await list(U(req), 'invoice')).map(i => ({ ...i, ...E.invoiceTotals(i), overdue: ['sent', 'partial'].includes(i.status) && i.due < today() })).sort((a, b) => b.id - a.id)));
  r.post('/invoices', async (req, res) => {
    const b = req.body || {}, s = await settings(U(req));
    const contact = b.contact?.id ? await get(U(req), 'contact', b.contact.id) : { name: String(b.contact?.name || '').slice(0, 80), email: String(b.contact?.email || '').slice(0, 120), address: String(b.contact?.address || '').slice(0, 300) };
    if (!contact?.name) throw bad('Who is the invoice for?');
    const issue = /^\d{4}-\d{2}-\d{2}$/.test(b.issue || '') ? b.issue : today();
    const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : new Date(Date.parse(issue) + s.paymentTerms * 864e5).toISOString().slice(0, 10);
    const t = E.invoiceTotals(b);
    if (!t.lines.length || !(t.total > 0)) throw bad('Add at least one line with an amount');
    const recurring = ['monthly', 'quarterly', 'yearly'].includes(b.recurring) ? b.recurring : 'none';
    const inv0 = { number: `${s.invoicePrefix}${String(s.nextNumber).padStart(4, '0')}`, contact, issue, due, currency: CURRENCIES.includes(b.currency) ? b.currency : s.currency, lines: t.lines, taxPct: Math.max(0, Math.min(50, +b.taxPct || 0)), notes: String(b.notes || '').slice(0, 500), status: 'sent', recurring, nextDate: recurring === 'none' ? null : E.nextDate(issue, recurring), payments: [], token: crypto.randomBytes(16).toString('base64url') };
    let inv = await put(U(req), 'invoice', inv0);
    try { Object.assign(inv, await issueInvoice(U(req), inv)); inv = await put(U(req), 'invoice', inv, inv.id); } catch (e) { await del(U(req), 'invoice', inv.id); throw e; }
    await put(U(req), 'settings', { ...(await rawSettings(U(req))), nextNumber: s.nextNumber + 1 }, s.id || undefined);
    if (b.email) await emailInvoice(U(req), inv).catch(() => {});
    await audit(U(req), 'invoice_created', { id: inv.id, total: t.total }, req.ip);
    res.json({ ...inv, ...E.invoiceTotals(inv), link: `${publicUrl()}/i/${inv.token}` });
  });
  r.post('/invoices/:id/send', async (req, res) => { const inv = await get(U(req), 'invoice', req.params.id); if (!inv) throw bad('No such invoice', 404); res.json({ ...(await emailInvoice(U(req), inv)), link: `${publicUrl()}/i/${inv.token}` }); });
  r.post('/invoices/:id/payment', async (req, res) => { const inv = await get(U(req), 'invoice', req.params.id); if (!inv) throw bad('No such invoice', 404); res.json(await recordPayment(U(req), inv, req.body?.amount, /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : today(), req.body?.method || 'manual')); });
  r.post('/invoices/:id/void', async (req, res) => {
    const inv = await get(U(req), 'invoice', req.params.id); if (!inv) throw bad('No such invoice', 404);
    if (inv.status === 'void') throw bad('Already void');
    if ((inv.payments || []).length) throw bad('This invoice has payments; record a refund instead');
    // The issuing entry is reversed (receivable, sales and tax back to zero).
    const e = E.invoiceEntry(inv, inv.rate || 1);
    await post(U(req), { ...e, date: today(), memo: `Void invoice ${inv.number}`, lines: e.lines.map(l => ({ account: l.account, debit: l.credit, credit: l.debit })) });
    res.json(await put(U(req), 'invoice', { ...inv, status: 'void', recurring: 'none', nextDate: null }, inv.id));
  });
  r.get('/invoices/:id.pdf', async (req, res) => {
    const inv = await get(U(req), 'invoice', req.params.id); if (!inv) throw bad('No such invoice', 404);
    const { pdf } = markdownPdf(invoiceMd(inv, await settings(U(req))), { title: `Invoice ${inv.number}`, toc: false });
    res.type('application/pdf').attachment(`invoice-${inv.number}.pdf`).send(pdf);
  });

  // ---------- inventory ----------
  r.get('/items', async (req, res) => res.json((await list(U(req), 'item')).map(i => ({ ...i, value: E.r2((i.qty || 0) * (i.avgCost || 0)), reorder: E.needsReorder(i) }))));
  r.post('/items', async (req, res) => { const b = req.body || {}; if (!String(b.name || '').trim()) throw bad('Give the product a name'); res.json(await put(U(req), 'item', { sku: String(b.sku || '').slice(0, 40), name: String(b.name).trim().slice(0, 80), variant: String(b.variant || '').slice(0, 60), unit: String(b.unit || 'each').slice(0, 20), price: E.r2(b.price), qty: 0, avgCost: 0, reorderPoint: b.reorderPoint === '' || b.reorderPoint == null ? null : Math.max(0, +b.reorderPoint) })); });
  r.put('/items/:id', async (req, res) => { const it = await get(U(req), 'item', req.params.id); if (!it) throw bad('No such product', 404); const b = req.body || {}; res.json(await put(U(req), 'item', { ...it, name: b.name ?? it.name, variant: b.variant ?? it.variant, sku: b.sku ?? it.sku, price: b.price != null ? E.r2(b.price) : it.price, reorderPoint: b.reorderPoint === '' ? null : b.reorderPoint != null ? Math.max(0, +b.reorderPoint) : it.reorderPoint }, it.id)); });
  // Stock in: average cost updated; paid now (cash) or on account (payable).
  r.post('/items/:id/receive', async (req, res) => {
    const it = await get(U(req), 'item', req.params.id); if (!it) throw bad('No such product', 404);
    const b = req.body || {}, next = E.receiveStock(it, b.qty, b.unitCost), cost = E.r2(+b.qty * +b.unitCost);
    await put(U(req), 'item', next, it.id);
    if (cost > 0) await post(U(req), { date: today(), memo: `Stock in: ${b.qty} ${it.name}`, source: 'inventory', ref: it.id, lines: [{ account: E.INVENTORY, debit: cost }, { account: b.onAccount ? E.AP : E.CASH, credit: cost }] });
    res.json(next);
  });
  // A stock count: the difference is written off (or back) at average cost.
  r.post('/items/:id/count', async (req, res) => {
    const it = await get(U(req), 'item', req.params.id); if (!it) throw bad('No such product', 404);
    const counted = +req.body?.qty; if (!(counted >= 0)) throw bad('Give the counted quantity');
    const diff = E.r2((counted - (it.qty || 0)) * (it.avgCost || 0));
    if (diff) await post(U(req), { date: today(), memo: `Stock count: ${it.name}`, source: 'inventory', ref: it.id, lines: diff < 0 ? [{ account: E.COGS, debit: -diff }, { account: E.INVENTORY, credit: -diff }] : [{ account: E.INVENTORY, debit: diff }, { account: E.COGS, credit: diff }] });
    res.json(await put(U(req), 'item', { ...it, qty: counted }, it.id));
  });
  r.delete('/items/:id', async (req, res) => { await del(U(req), 'item', req.params.id); res.json({ ok: true }); });

  // ---------- payroll ----------
  const pubEmp = e => ({ ...e, bank: undefined, hasBank: !!e.bank, bankLast4: e.bankLast4 || null });
  r.get('/employees', async (req, res) => res.json((await list(U(req), 'employee')).map(pubEmp)));
  r.post('/employees', async (req, res) => {
    const b = req.body || {};
    if (!String(b.name || '').trim()) throw bad('Give the employee a name');
    if (!(+b.rate > 0)) throw bad('Give the yearly salary or the hourly rate');
    const e = { name: String(b.name).trim().slice(0, 80), email: String(b.email || '').slice(0, 120), payType: b.payType === 'hourly' ? 'hourly' : 'salary', rate: E.r2(b.rate), frequency: E.PERIODS[b.frequency] ? b.frequency : 'biweekly', filing: ['single', 'mfj', 'hoh', 'mfs'].includes(b.filing) ? b.filing : 'single', extraWithholding: Math.max(0, +b.extraWithholding || 0), stateRate: Math.max(0, Math.min(15, +b.stateRate || 0)), sutaRate: Math.max(0, Math.min(15, +b.sutaRate || 0)), active: true };
    if (b.routing || b.account) {
      if (!/^\d{9}$/.test(String(b.routing || '')) || !/^\d{4,17}$/.test(String(b.account || ''))) throw bad('Bank details: a 9-digit routing number and the account number');
      e.bank = encrypt({ routing: String(b.routing), account: String(b.account), type: b.accountType === 'savings' ? 'savings' : 'checking' }); e.bankLast4 = String(b.account).slice(-4);
    }
    res.json(pubEmp(await put(U(req), 'employee', e)));
  });
  r.delete('/employees/:id', async (req, res) => { const e = await get(U(req), 'employee', req.params.id); if (e) await put(U(req), 'employee', { ...e, active: false }, e.id); res.json({ ok: true }); });
  r.get('/payruns', async (req, res) => res.json((await list(U(req), 'payrun')).sort((a, b) => b.id - a.id)));
  // Works out every paycheck; "commit" records it in the books.
  r.post('/payruns', async (req, res) => {
    const b = req.body || {}, payDate = /^\d{4}-\d{2}-\d{2}$/.test(b.payDate || '') ? b.payDate : today(), year = +payDate.slice(0, 4);
    const emps = (await list(U(req), 'employee')).filter(e => e.active !== false), runs = await list(U(req), 'payrun');
    if (!emps.length) throw bad('Add an employee first');
    const ytd = id => runs.filter(p => p.committed && p.payDate.slice(0, 4) === String(year)).flatMap(p => p.stubs).filter(s => s.employee === id).reduce((t, s) => t + s.gross, 0);
    const stubs = emps.map(e => { const h = (b.hours || {})[e.id] || {}; return E.paycheck(e, { hours: h.hours, overtime: h.overtime, bonus: h.bonus, ytd: ytd(e.id), year }); }).filter(s => s.gross > 0);
    const totals = { gross: E.r2(stubs.reduce((t, s) => t + s.gross, 0)), net: E.r2(stubs.reduce((t, s) => t + s.net, 0)), taxes: E.r2(stubs.reduce((t, s) => t + s.federal + s.ss + s.medicare + s.state, 0)), employer: E.r2(stubs.reduce((t, s) => t + s.employer.total, 0)) };
    if (!b.commit) return res.json({ payDate, stubs, totals, preview: true });
    if (!confirmsIdentity(req.user, b)) throw bad(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password', 401);
    const entry = await post(U(req), E.payrollEntry(stubs, payDate));
    const pr = await put(U(req), 'payrun', { payDate, period: String(b.period || '').slice(0, 40), stubs, totals, committed: true, entry: entry.id });
    await audit(U(req), 'payroll_run', { id: pr.id, gross: totals.gross }, req.ip);
    res.json(pr);
  });
  r.get('/payruns/:id/ach', async (req, res) => {
    const pr = await get(U(req), 'payrun', req.params.id), s = await rawSettings(U(req)); if (!pr) throw bad('No such pay run', 404);
    const emps = Object.fromEntries((await list(U(req), 'employee')).map(e => [e.id, e]));
    const payments = pr.stubs.map(st => { const e = emps[st.employee], bk = tryDecrypt(e?.bank, 'employee bank'); return bk ? { id: 'E' + e.id, name: e.name, routing: bk.routing, account: bk.account, type: bk.type, amount: st.net } : null; }).filter(Boolean);
    if (!payments.length) throw bad('No employee in this pay run has bank details for direct deposit');
    const f = E.nacha({ company: { name: s?.name || 'COMPANY', ...(s?.ach || {}) }, payments, effectiveDate: pr.payDate });
    res.type('text/plain').attachment(`payroll-${pr.payDate}.ach`).send(f.text);
  });
  r.get('/payruns/:id/stub/:emp.pdf', async (req, res) => {
    const pr = await get(U(req), 'payrun', req.params.id), s = await settings(U(req)); if (!pr) throw bad('No such pay run', 404);
    const st = pr.stubs.find(x => String(x.employee) === req.params.emp); if (!st) throw bad('Not in this pay run', 404);
    const m = v => (+v).toFixed(2);
    const md = `# Pay stub\n\n**${s.name || 'Employer'}** · Pay date ${pr.payDate}${pr.period ? ' · ' + pr.period : ''}\n\n**${st.name}**\n\n| | Amount |\n|---|---|\n| Gross pay | ${m(st.gross)} |\n| Federal income tax | -${m(st.federal)} |\n| Social Security | -${m(st.ss)} |\n| Medicare | -${m(st.medicare)} |\n| State income tax | -${m(st.state)} |\n| **Net pay** | **${m(st.net)}** |\n\nWithholding is estimated from the IRS percentage method (Form W-4, 2020 or later). Check it with your payroll adviser.`;
    const { pdf } = markdownPdf(md, { title: 'Pay stub', toc: false });
    res.type('application/pdf').attachment(`paystub-${st.name.replace(/\W+/g, '-')}-${pr.payDate}.pdf`).send(pdf);
  });
  r.get('/w2', async (req, res) => {
    const year = +req.query.year || +today().slice(0, 4), runs = (await list(U(req), 'payrun')).filter(p => p.committed && p.payDate.startsWith(String(year)));
    const emps = await list(U(req), 'employee');
    res.json({ year, employees: emps.map(e => ({ id: e.id, name: e.name, ...E.w2(runs.flatMap(p => p.stubs).filter(s => s.employee === e.id)) })).filter(x => x.wages > 0) });
  });

  // ---------- bank lines and receipts ----------
  r.get('/bank', async (req, res) => res.json((await list(U(req), 'bank')).sort((a, b) => b.date.localeCompare(a.date))));
  r.post('/bank/import', async (req, res) => {
    const txs = E.parseBankCsv(req.body?.csv), have = await list(U(req), 'bank'), entries = await list(U(req), 'entry');
    const key = t => `${t.date}|${t.amount}|${t.description}`, seen = new Set(have.map(key));
    let added = 0, matched = 0;
    // Categories: the rules first; the AI for the rest (when set up), choosing from the chart of accounts.
    const fresh = txs.filter(t => !seen.has(key(t)));
    const accts = await accounts(U(req)), ai = await aiCategories(fresh.filter(t => !E.ruleCategory(t.description, t.amount)), accts);
    for (const t of fresh) {
      const m = E.matchBank(t, entries);
      await put(U(req), 'bank', { ...t, suggested: E.ruleCategory(t.description, t.amount) || ai[t.description] || null, status: m ? 'matched' : 'open', entry: m?.id || null });
      added++; if (m) matched++;
    }
    res.json({ added, matched, skipped: txs.length - added });
  });
  r.post('/bank/:id/post', async (req, res) => {
    const t = await get(U(req), 'bank', req.params.id); if (!t) throw bad('No such line', 404);
    if (t.status !== 'open') throw bad('This line is already in the books');
    const code = String(req.body?.account || t.suggested || ''); if (!code) throw bad('Pick the category');
    const e = await post(U(req), { ...E.bankEntry(t, code), tags: req.body?.tags || [] });
    res.json(await put(U(req), 'bank', { ...t, status: 'posted', entry: e.id, suggested: code }, t.id));
  });
  r.post('/bank/post-suggested', async (req, res) => {
    let n = 0;
    for (const t of (await list(U(req), 'bank')).filter(x => x.status === 'open' && x.suggested)) { const e = await post(U(req), E.bankEntry(t, t.suggested)); await put(U(req), 'bank', { ...t, status: 'posted', entry: e.id }, t.id); n++; }
    res.json({ posted: n });
  });
  // Reconciliation: the bank's balance (all imported lines) against the books' cash account.
  r.get('/reconcile', async (req, res) => {
    const lines = await list(U(req), 'bank'), bal = E.balances(await list(U(req), 'entry'), await accounts(U(req)));
    const bank = E.r2(lines.reduce((t, l) => t + l.amount, 0) + (+req.query.opening || 0)), books = bal[E.CASH]?.balance || 0;
    res.json({ bank, books, difference: E.r2(bank - books), open: lines.filter(l => l.status === 'open').length, matched: lines.filter(l => l.status === 'matched').length, posted: lines.filter(l => l.status === 'posted').length });
  });
  r.get('/receipts', async (req, res) => res.json((await list(U(req), 'receipt')).map(({ image, ...x }) => ({ ...x, hasImage: !!image })).sort((a, b) => b.id - a.id)));
  r.get('/receipts/:id/image', async (req, res) => { const x = await get(U(req), 'receipt', req.params.id); if (!x?.image) throw bad('No image', 404); const [, mime, b64] = /^data:([^;]+);base64,(.*)$/.exec(x.image) || []; res.type(mime || 'image/jpeg').send(Buffer.from(b64 || '', 'base64')); });
  r.post('/receipts', async (req, res) => {
    const b = req.body || {}, image = String(b.image || '');
    if (image && !/^data:image\/(jpeg|png|webp|heic);base64,/.test(image)) throw bad('Upload a photo (JPEG, PNG or WebP)');
    if (image.length > 3.6e6) throw bad('The photo is too large (up to about 2.5 MB)');
    const read = image ? await readReceipt(image) : null;
    const x = { vendor: String(b.vendor || read?.vendor || '').slice(0, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : /^\d{4}-\d{2}-\d{2}$/.test(read?.date || '') ? read.date : today(), total: E.r2(b.total ?? read?.total), tax: E.r2(b.tax ?? read?.tax), category: CATEGORY_CODE[String(read?.category || '').toLowerCase()] || b.category || '6990', read: !!read, image: image || null };
    // Matched to a bank line of the same amount within 5 days.
    const bank = (await list(U(req), 'bank')).find(t => t.amount < 0 && Math.abs(-t.amount - x.total) < 0.01 && Math.abs(Date.parse(t.date) - Date.parse(x.date)) <= 5 * 864e5 && !t.receipt);
    const saved = await put(U(req), 'receipt', { ...x, bank: bank?.id || null });
    if (bank) await put(U(req), 'bank', { ...bank, receipt: saved.id, suggested: bank.suggested || x.category }, bank.id);
    const { image: _img, ...pub } = saved;
    res.json({ ...pub, matchedBank: bank ? { id: bank.id, date: bank.date, description: bank.description } : null, aiRead: !!read });
  });
  r.delete('/receipts/:id', async (req, res) => { await del(U(req), 'receipt', req.params.id); res.json({ ok: true }); });
  return r;
})();

// AI categories for bank lines the rules could not place (one request for the whole batch).
async function aiCategories(txs, accts) {
  if (!txs.length) return {};
  const { llmEnabled, jsonCall } = await import('../llm.js');
  if (!llmEnabled()) return {};
  const codes = accts.filter(a => a.type === 'expense' || a.type === 'income').map(a => `${a.code} ${a.name}`).join('; ');
  const out = await jsonCall({ system: 'You classify bank transactions of a small business into its chart of accounts. Reply with JSON only.', user: `Accounts: ${codes}\n\nTransactions:\n${txs.slice(0, 60).map((t, i) => `${i}. ${t.description} (${t.amount})`).join('\n')}\n\nReturn {"items":[{"i":index,"code":"account code"}]}.`, schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { i: { type: 'number' }, code: { type: 'string' } }, required: ['i', 'code'] } } }, required: ['items'] }, maxTokens: 1500 }).catch(() => null);
  const valid = new Set(accts.map(a => a.code)), map = {};
  for (const x of out?.items || []) if (txs[x.i] && valid.has(x.code)) map[txs[x.i].description] = x.code;
  return map;
}

// The customer's invoice page (no sign-in): view, download, and pay by card when the business set up Stripe.
export const publicInvoiceRouter = (() => {
  const r = express.Router();
  const find = async token => { if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null; const row = await one("SELECT user_id, id, data FROM biz_docs WHERE kind = 'invoice' AND json_extract(data, '$.token') = ?", token); return row ? { userId: row.user_id, inv: { ...JSON.parse(row.data), id: row.id } } : null; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  r.get('/:token', async (req, res) => {
    const f = await find(req.params.token); if (!f) return res.status(404).send('This invoice link is not valid.');
    let { inv } = f; const s = await settings(f.userId);
    if (req.query.paid && !['paid', 'void'].includes(inv.status)) { const ses = await stripeSessionPaid(f.userId, String(req.query.paid)).catch(() => null); if (ses && !(inv.payments || []).some(p => p.ref === ses.id)) inv = await recordPayment(f.userId, { ...inv }, ses.amount_total / (['jpy', 'krw'].includes(ses.currency) ? 1 : 100), today(), 'card', ses.id); }
    const t = E.invoiceTotals(inv), m = v => `${esc(inv.currency || s.currency)} ${(+v).toFixed(2)}`;
    res.type('html').set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Invoice ${esc(inv.number)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f6fb;color:#0f1729;margin:0;padding:24px 16px}.c{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.06)}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:8px 6px;border-bottom:1px solid #e6e9f0;text-align:left}td.n,th.n{text-align:right}.b{display:inline-block;background:#5b5bf7;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;margin-right:8px}.g{background:#eef0f6;color:#0f1729}.p{display:inline-block;padding:2px 10px;border-radius:999px;background:#e8f7ee;color:#0f7a3d;font-size:13px}.mu{color:#5b6475}</style></head><body><div class="c">
<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><h1 style="margin:0">Invoice ${esc(inv.number)}</h1><p class="mu" style="margin:4px 0">${esc(s.name)}${s.email ? ' · ' + esc(s.email) : ''}</p></div><div>${inv.status === 'paid' ? '<span class="p">Paid</span>' : inv.status === 'void' ? '<span class="p" style="background:#fdecec;color:#a11">Void</span>' : `<b>${m(t.balance)}</b><div class="mu">due ${esc(inv.due)}</div>`}</div></div>
<p>Bill to <b>${esc(inv.contact?.name)}</b>${inv.contact?.address ? '<br>' + esc(inv.contact.address) : ''}<br><span class="mu">Issued ${esc(inv.issue)}</span></p>
<table><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr>${t.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="n">${l.qty}</td><td class="n">${m(l.price)}</td><td class="n">${m(l.amount)}</td></tr>`).join('')}
<tr><td colspan="3" class="n">Subtotal</td><td class="n">${m(t.subtotal)}</td></tr>${t.tax ? `<tr><td colspan="3" class="n">Tax ${inv.taxPct}%</td><td class="n">${m(t.tax)}</td></tr>` : ''}<tr><td colspan="3" class="n"><b>Total</b></td><td class="n"><b>${m(t.total)}</b></td></tr>${t.paid ? `<tr><td colspan="3" class="n">Paid</td><td class="n">${m(t.paid)}</td></tr><tr><td colspan="3" class="n"><b>Balance due</b></td><td class="n"><b>${m(t.balance)}</b></td></tr>` : ''}</table>
${inv.notes ? `<p>${esc(inv.notes)}</p>` : ''}
${!['paid', 'void'].includes(inv.status) && s.hasStripe ? `<a class="b" href="/i/${esc(inv.token)}/pay">Pay ${m(t.balance)} by card</a>` : ''}<a class="b g" href="/i/${esc(inv.token)}/pdf">Download PDF</a>
<p class="mu" style="font-size:13px;margin-top:24px">Sent with Brightolio.</p></div></body></html>`);
  });
  r.get('/:token/pay', async (req, res) => { const f = await find(req.params.token); if (!f) return res.status(404).send('Not found'); try { res.redirect(await stripeCheckout(f.userId, f.inv)); } catch (e) { res.status(400).send(esc(e.message)); } });
  r.get('/:token/pdf', async (req, res) => { const f = await find(req.params.token); if (!f) return res.status(404).send('Not found'); const { pdf } = markdownPdf(invoiceMd(f.inv, await settings(f.userId)), { title: `Invoice ${f.inv.number}`, toc: false }); res.type('application/pdf').attachment(`invoice-${f.inv.number}.pdf`).send(pdf); });
  return r;
})();
