// QuickBooks Online for the bookkeeping and tax pages: each user connects their own QuickBooks
// company (Intuit OAuth 2.0, accounting scope), maps their accounts once (gains, dividends,
// interest, broker fees, and the brokerage account itself), and sends a month of bookkeeping or a
// tax year as one balanced journal entry. A month or year is sent once (send again replaces it on
// purpose only). Keys: QBO_CLIENT_ID and QBO_CLIENT_SECRET from developer.intuit.com; QBO_ENV is
// "sandbox" while testing. Add PUBLIC_URL/oauth/quickbooks/callback as the app's redirect URI.
import crypto from 'node:crypto';
import express from 'express';
import { audit, now } from './db.js';
import { requireUser } from './auth.js';
import { encrypt, tryDecrypt } from './crypto.js';
import { getSetting, setSetting } from './settings.js';
import { booksFor } from './books.js';
import { ACCOUNT_IDS } from './brokers.js';

const env = k => process.env[k] || '';
export const qboReady = () => !!(env('QBO_CLIENT_ID') && env('QBO_CLIENT_SECRET'));
const AUTH = () => env('QBO_AUTH_URL') || 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = () => env('QBO_TOKEN_URL') || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API = () => (env('QBO_API_URL') || (env('QBO_ENV') === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com')).replace(/\/$/, '');
export const redirectUri = () => (env('PUBLIC_URL') || 'http://localhost:3000').replace(/\/$/, '') + '/oauth/quickbooks/callback';
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const states = new Map(); // state -> { userId, at }
const MAP_KEYS = { gains: 'Investment gains and losses', dividends: 'Dividend income', interest: 'Interest income', fees: 'Broker fees', cash: 'Brokerage account (asset)' };

const conn = async userId => (await getSetting(userId, 'qbo', null)) || null;
const basic = () => 'Basic ' + Buffer.from(`${env('QBO_CLIENT_ID')}:${env('QBO_CLIENT_SECRET')}`).toString('base64');

export function authUrl(userId) {
  const state = crypto.randomBytes(18).toString('base64url');
  for (const [k, v] of states) if (now() - v.at > 10 * 60e3) states.delete(k);
  states.set(state, { userId, at: now() });
  return `${AUTH()}?${new URLSearchParams({ client_id: env('QBO_CLIENT_ID'), redirect_uri: redirectUri(), response_type: 'code', scope: 'com.intuit.quickbooks.accounting', state })}`;
}
async function token(body) {
  const r = await fetch(TOKEN(), { method: 'POST', headers: { Authorization: basic(), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw bad('QuickBooks did not accept the connection' + (d.error ? ` (${d.error})` : ''), 502);
  return d;
}
export async function finish(userId, { code, state, realmId }) {
  const s = states.get(state); states.delete(state);
  if (!s || s.userId !== userId || now() - s.at > 10 * 60e3) throw bad('The QuickBooks connection expired. Please try again.');
  if (!/^\d{1,30}$/.test(String(realmId || ''))) throw bad('QuickBooks did not say which company to use.');
  const d = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  const cur = await conn(userId) || {};
  await setSetting(userId, 'qbo', { ...cur, realm: String(realmId), refresh: encrypt(d.refresh_token), at: now(), map: cur.realm === String(realmId) ? cur.map || {} : {}, sent: cur.realm === String(realmId) ? cur.sent || {} : {} });
}
// A fresh access token; Intuit may rotate the refresh token, so the new one is saved.
async function access(userId) {
  const c = await conn(userId), refresh = c?.refresh && tryDecrypt(c.refresh, 'QuickBooks token');
  if (!refresh) throw bad('Connect QuickBooks first');
  const d = await token({ grant_type: 'refresh_token', refresh_token: refresh }).catch(() => { throw bad('QuickBooks access ended. Connect it again.', 401); });
  if (d.refresh_token && d.refresh_token !== refresh) await setSetting(userId, 'qbo', { ...c, refresh: encrypt(d.refresh_token) });
  return { token: d.access_token, realm: c.realm };
}
async function qbo(userId, method, path, body) {
  const a = await access(userId);
  const r = await fetch(`${API()}/v3/company/${a.realm}${path}${path.includes('?') ? '&' : '?'}minorversion=75`, { method, headers: { Authorization: `Bearer ${a.token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw bad(`QuickBooks answered ${r.status}${d.Fault?.Error?.[0]?.Detail ? ': ' + d.Fault.Error[0].Detail : ''}`, 502);
  return d;
}

// The journal entry for a month ("2026-10") or a tax year ("2026"): one line per kind of money and
// the balancing line on the brokerage account.
export function journalFor(books, period, map, account) {
  const months = period.length === 7 ? books.months.filter(m => m.month === period) : books.months;
  const sum = k => +months.reduce((s, m) => s + (m[k] || 0), 0).toFixed(2);
  const st = sum('shortTerm'), lt = sum('longTerm'), div = sum('dividends'), int = sum('interest'), fees = sum('brokerFees');
  const lines = [];
  const line = (amount, credit, key, description) => { if (!amount) return; lines.push({ Amount: Math.abs(amount), DetailType: 'JournalEntryLineDetail', Description: description, JournalEntryLineDetail: { PostingType: (amount > 0) === credit ? 'Credit' : 'Debit', AccountRef: { value: String(map[key]) } } }); };
  line(st, true, 'gains', `Short-term gains and losses (${account})`);
  line(lt, true, 'gains', `Long-term gains and losses (${account})`);
  line(div, true, 'dividends', `Dividends (${account})`);
  line(int, true, 'interest', `Interest (${account})`);
  line(fees, false, 'fees', `Broker fees (${account})`);
  const net = +(st + lt + div + int - fees).toFixed(2);
  line(net, false, 'cash', `Net result in the brokerage account (${account})`);
  const y = +period.slice(0, 4), m = period.length === 7 ? +period.slice(5, 7) : 12;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
  return { lines, totals: { shortTerm: st, longTerm: lt, dividends: div, interest: int, fees, net }, entry: { DocNumber: `BF${period.replace('-', '')}${account.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`.slice(0, 21), TxnDate: last < today ? last : today, PrivateNote: `Brightfolio ${period.length === 7 ? 'bookkeeping' : 'tax year'} ${period}, ${account} account`, Line: lines } };
}

export const quickbooksRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const c = await conn(req.user.id);
    res.json({ ready: qboReady(), connected: !!c?.refresh, realm: c?.realm || null, map: c?.map || {}, mapKeys: MAP_KEYS, sent: c?.sent || {}, redirectUri: redirectUri(), sandbox: env('QBO_ENV') === 'sandbox' });
  });
  r.get('/connect', (req, res) => { if (!qboReady()) throw bad('QuickBooks is not set up on this server yet'); res.json({ url: authUrl(req.user.id) }); });
  r.post('/disconnect', async (req, res) => { await setSetting(req.user.id, 'qbo', null); await audit(req.user.id, 'quickbooks_disconnected', null, req.ip); res.json({ ok: true }); });
  // The company's active accounts, for mapping.
  r.get('/accounts', async (req, res) => {
    const d = await qbo(req.user.id, 'GET', `/query?query=${encodeURIComponent('select Id, Name, AccountType, AccountSubType from Account where Active = true maxresults 1000')}`);
    res.json((d.QueryResponse?.Account || []).map(a => ({ id: a.Id, name: a.Name, type: a.AccountType })));
  });
  r.put('/map', async (req, res) => {
    const c = await conn(req.user.id); if (!c?.refresh) throw bad('Connect QuickBooks first');
    const map = Object.fromEntries(Object.keys(MAP_KEYS).map(k => [k, String(req.body?.[k] || '').replace(/\D/g, '').slice(0, 20)]).filter(([, v]) => v));
    await setSetting(req.user.id, 'qbo', { ...c, map });
    res.json({ map });
  });
  // Send a month ("2026-10") of bookkeeping, or a tax year ("2026"), for one account.
  r.post('/send', async (req, res) => {
    const b = req.body || {}, period = String(b.period || ''), account = ACCOUNT_IDS.includes(b.account) ? b.account : 'paper';
    if (!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period)) throw bad('Pick a month or a year');
    const c = await conn(req.user.id); if (!c?.refresh) throw bad('Connect QuickBooks first');
    const missing = Object.keys(MAP_KEYS).filter(k => !c.map?.[k]);
    if (missing.length) throw bad('Choose a QuickBooks account for: ' + missing.map(k => MAP_KEYS[k]).join(', '));
    const key = `${account}:${period}`;
    if (c.sent?.[key] && b.replace !== true) throw bad(`Already sent on ${new Date(c.sent[key].at).toLocaleDateString('en-US')} (QuickBooks entry ${c.sent[key].id}). Delete it in QuickBooks, then send again.`, 409);
    const j = journalFor(await booksFor(req.user, account, +period.slice(0, 4)), period, c.map, account);
    if (j.lines.length < 2) throw bad('Nothing to send for this period: no gains, dividends, interest or fees.');
    const d = await qbo(req.user.id, 'POST', '/journalentry', j.entry);
    const id = d.JournalEntry?.Id || null;
    await setSetting(req.user.id, 'qbo', { ...(await conn(req.user.id)), sent: { ...(c.sent || {}), [key]: { id, at: now() } } });
    await audit(req.user.id, 'quickbooks_sent', { account, period, id }, req.ip);
    res.json({ id, totals: j.totals, lines: j.lines.length });
  });
  return r;
})();
