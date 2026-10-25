// Spend-based investing: everyday card purchases turn into investments. Round-ups invest the spare
// change of each purchase (times a multiplier) in a fund you pick; brand mode invests a share of
// what you spend at a company in that company's stock (coffee at Starbucks buys SBUX). Purchases
// come from cards linked through Plaid, or from a statement CSV you upload. Buys are batched weekly.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import { encrypt, decrypt } from './crypto.js';
import { placeOrder, ACCOUNT_IDS } from './brokers.js';
import { nyTime, stockSession } from './time.js';
import { isPaid } from './fees.js';
import { killed } from './risk.js';
import { notifyUser } from './notify-user.js';

export const MERCHANTS = [
  [/starbucks/i, 'SBUX'], [/amazon|amzn|whole foods/i, 'AMZN'], [/apple\.com|apple store|itunes|app store/i, 'AAPL'], [/walmart|wal-mart|sam's club/i, 'WMT'], [/target/i, 'TGT'],
  [/mcdonald/i, 'MCD'], [/netflix/i, 'NFLX'], [/costco/i, 'COST'], [/nike/i, 'NKE'], [/home depot/i, 'HD'], [/lowe'?s/i, 'LOW'], [/uber/i, 'UBER'], [/lyft/i, 'LYFT'],
  [/spotify/i, 'SPOT'], [/disney|hulu/i, 'DIS'], [/chipotle/i, 'CMG'], [/exxon|mobil/i, 'XOM'], [/chevron/i, 'CVX'], [/shell/i, 'SHEL'], [/cvs/i, 'CVS'], [/walgreens/i, 'WBA'],
  [/microsoft|xbox/i, 'MSFT'], [/google|youtube/i, 'GOOGL'], [/meta|facebook|instagram/i, 'META'], [/paypal/i, 'PYPL'], [/airbnb/i, 'ABNB'], [/booking\.com|priceline/i, 'BKNG'],
  [/delta air/i, 'DAL'], [/united airlines/i, 'UAL'], [/southwest/i, 'LUV'], [/marriott/i, 'MAR'], [/hilton/i, 'HLT'], [/domino/i, 'DPZ'], [/yum|taco bell|kfc|pizza hut/i, 'YUM'],
  [/kroger/i, 'KR'], [/best buy/i, 'BBY'], [/ulta/i, 'ULTA'], [/lululemon/i, 'LULU'], [/tesla/i, 'TSLA'], [/verizon/i, 'VZ'], [/at&t|att\b/i, 'T'], [/t-mobile/i, 'TMUS'],
  [/comcast|xfinity/i, 'CMCSA'], [/dollar general/i, 'DG'], [/dollar tree/i, 'DLTR'], [/chewy/i, 'CHWY'], [/etsy/i, 'ETSY'], [/ebay/i, 'EBAY'], [/doordash/i, 'DASH'],
];
export const tickerFor = merchant => MERCHANTS.find(([re]) => re.test(String(merchant || '')))?.[1] || null;
export const DEFAULTS = { mode: 'both', multiplier: 1, brandPct: 5, defaultSymbol: 'SPY', account: 'paper', weeklyCap: 100, minBatch: 5, active: true };

// What one purchase invests: spare change to the next dollar (x multiplier), plus brandPct% of the
// purchase in the brand's stock when the merchant is a listed company.
const cents = x => Math.round((x + Number.EPSILON) * 100) / 100; // 0.435 -> 0.44, not 0.43
export function plan(tx, s) {
  const amt = +tx.amount; if (!(amt > 0)) return [];
  const out = [], ticker = tickerFor(tx.merchant);
  if (s.mode !== 'brand') { const spare = cents(Math.ceil(amt) - amt); if (spare > 0) out.push({ ticker: s.defaultSymbol, invest: cents(spare * s.multiplier), kind: 'roundup' }); }
  if (s.mode !== 'roundup' && ticker) out.push({ ticker, invest: cents(amt * s.brandPct / 100), kind: 'brand' });
  return out.filter(x => x.invest > 0);
}

async function getSettings(userId) {
  const r = await one('SELECT * FROM roundup_settings WHERE user_id = ?', userId);
  let s = {}; try { s = JSON.parse(r?.settings || '{}'); } catch {}
  return { settings: { ...DEFAULTS, ...s }, linked: !!r?.plaid_token, cursor: r?.cursor || null, token: r?.plaid_token ? decrypt(r.plaid_token).token : null };
}
export async function addTransactions(userId, txs, settings) {
  let added = 0;
  for (const tx of txs) {
    for (const p of plan(tx, settings)) {
      const r = await run('INSERT OR IGNORE INTO roundup_tx (user_id, tx_id, day, merchant, amount, ticker, invest, status, at) VALUES (?,?,?,?,?,?,?,?,?)', userId, `${tx.id}:${p.kind}`, tx.date, String(tx.merchant || '').slice(0, 80), +tx.amount, p.ticker, p.invest, 'pending', now());
      added += r.changes;
    }
  }
  return added;
}

// ---------- Plaid ----------
const PLAID = () => `https://${['production', 'development'].includes(process.env.PLAID_ENV) ? process.env.PLAID_ENV : 'sandbox'}.plaid.com`;
export const plaidEnabled = () => !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
async function plaid(path, body) {
  const base = process.env.PLAID_BASE_URL || PLAID();
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }), signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Plaid: ${d.error_message || d.error_code || r.status}`), { status: 502 });
  return d;
}
// New card purchases since the last sync (Plaid amounts are positive for money spent).
export async function syncPlaid(userId) {
  const { settings, token, cursor } = await getSettings(userId);
  if (!token) return 0;
  let c = cursor, more = true, added = 0, pages = 0;
  while (more && pages++ < 10) {
    const d = await plaid('/transactions/sync', { access_token: token, cursor: c || undefined, count: 250 });
    const spends = (d.added || []).filter(t => t.amount > 0 && !t.pending).map(t => ({ id: t.transaction_id, date: t.date, merchant: t.merchant_name || t.name, amount: t.amount }));
    added += await addTransactions(userId, spends, settings);
    c = d.next_cursor; more = d.has_more;
  }
  await run('UPDATE roundup_settings SET cursor = ?, updated_at = ? WHERE user_id = ?', c, now(), userId);
  return added;
}

// Weekly (or when enough is waiting): one buy per ticker, up to the weekly cap.
export async function investPending(userId, t = now()) {
  const { settings: s } = await getSettings(userId);
  if (!s.active || await killed(userId)) return [];
  const pending = await all("SELECT * FROM roundup_tx WHERE user_id = ? AND status = 'pending' ORDER BY id", userId);
  const total = pending.reduce((a, x) => a + x.invest, 0);
  if (total < s.minBatch) return [];
  const byTicker = {}; let left = s.weeklyCap > 0 ? s.weeklyCap : Infinity; const used = [];
  for (const x of pending) { if (left <= 0) break; const take = Math.min(x.invest, left); byTicker[x.ticker] = (byTicker[x.ticker] || 0) + take; left -= take; used.push(x.id); }
  const out = [];
  for (const [ticker, amount] of Object.entries(byTicker)) {
    let result;
    if (amount < 1) { result = 'under $1, carried over'; out.push({ ticker, amount, result }); continue; }
    try { await placeOrder(userId, s.account, { symbol: ticker, side: 'buy', notional: +amount.toFixed(2), signalAt: t }, 'roundup'); result = `bought $${amount.toFixed(2)}`; }
    catch (e) { result = 'failed: ' + e.message; }
    out.push({ ticker, amount: +amount.toFixed(2), result });
    const ok = result.startsWith('bought');
    const ids = pending.filter(x => used.includes(x.id) && x.ticker === ticker).map(x => x.id);
    if (ok && ids.length) await run(`UPDATE roundup_tx SET status = 'invested', result = ? WHERE id IN (${ids.map(() => '?').join(',')})`, result, ...ids);
  }
  return out;
}
export async function runRoundups(t = now()) {
  const n = nyTime(t);
  const users = await all('SELECT user_id FROM roundup_settings');
  let done = 0;
  for (const u of users) {
    try { if (plaidEnabled()) await syncPlaid(u.user_id); } catch (e) { console.warn('plaid sync', u.user_id, e.message); }
    if (n.weekday === 'Mon' && stockSession(t)) {
      const r = await investPending(u.user_id, t);
      if (r.length) { done++; await notifyUser(u.user_id, `Spend-based investing: ${r.map(x => `${x.ticker} ${x.result}`).join(', ')}`); }
    }
  }
  return done;
}

export const roundupRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
  r.get('/', async (req, res) => {
    const { settings, linked } = await getSettings(req.user.id);
    const tx = await all('SELECT * FROM roundup_tx WHERE user_id = ? ORDER BY id DESC LIMIT 200', req.user.id);
    const pending = tx.filter(x => x.status === 'pending').reduce((a, x) => a + x.invest, 0), invested = (await one("SELECT COALESCE(SUM(invest), 0) n FROM roundup_tx WHERE user_id = ? AND status = 'invested'", req.user.id)).n;
    res.json({ settings, linked, plaid: plaidEnabled(), pending: +pending.toFixed(2), invested: +invested.toFixed(2), transactions: tx, brands: MERCHANTS.map(m => m[1]) });
  });
  r.put('/', async (req, res) => {
    const b = req.body || {};
    const s = { mode: ['roundup', 'brand', 'both'].includes(b.mode) ? b.mode : 'both', multiplier: Math.max(1, Math.min(10, Math.round(+b.multiplier || 1))), brandPct: Math.max(0.5, Math.min(50, +b.brandPct || 5)),
      defaultSymbol: String(b.defaultSymbol || 'SPY').toUpperCase().slice(0, 10), account: ACCOUNT_IDS.includes(b.account) ? b.account : 'paper', weeklyCap: Math.max(0, Math.min(10000, +b.weeklyCap || 0)), minBatch: Math.max(1, Math.min(500, +b.minBatch || 5)), active: b.active !== false };
    if (s.account !== 'paper' && !isPaid(req.user)) throw Object.assign(bad('Investing real money from purchases is part of Pro'), { status: 402, upgrade: true, feature: 'Spend-based investing on real accounts' });
    await run('INSERT INTO roundup_settings (user_id, settings, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at', req.user.id, JSON.stringify(s), now());
    res.json({ settings: s });
  });
  // CSV from a card statement: date,description,amount (spending as positive amounts).
  r.post('/import', async (req, res) => {
    const { settings } = await getSettings(req.user.id), txs = [];
    for (const [i, line] of String(req.body.csv || '').split(/\r?\n/).entries()) {
      const c = line.split(',').map(x => x.trim().replace(/^"|"$/g, '')); if (c.length < 3 || !/\d/.test(c[2])) continue;
      const amount = Math.abs(+c[2].replace(/[$\s]/g, '')); if (!(amount > 0)) continue;
      txs.push({ id: `csv:${c[0]}:${c[1]}:${amount}:${i}`, date: c[0], merchant: c[1], amount });
    }
    if (!txs.length) throw bad('No purchases found. Use lines like: 2026-10-20,STARBUCKS #1234,5.45');
    await run('INSERT OR IGNORE INTO roundup_settings (user_id, settings, updated_at) VALUES (?,?,?)', req.user.id, JSON.stringify(settings), now());
    res.json({ purchases: txs.length, added: await addTransactions(req.user.id, txs.slice(0, 2000), settings) });
  });
  r.post('/invest', async (req, res) => {
    if (!rateLimit('roundinv:' + req.user.id, 10, 3600e3)) throw bad('Try again later', 429);
    res.json({ orders: await investPending(req.user.id) });
  });
  r.post('/plaid/link-token', async (req, res) => {
    if (!plaidEnabled()) throw bad('Card linking is not set up on this server (PLAID_CLIENT_ID / PLAID_SECRET)', 503);
    const d = await plaid('/link/token/create', { user: { client_user_id: String(req.user.id) }, client_name: 'QuantPocket', products: ['transactions'], country_codes: ['US'], language: 'en' });
    res.json({ linkToken: d.link_token });
  });
  r.post('/plaid/exchange', async (req, res) => {
    if (!plaidEnabled()) throw bad('Card linking is not set up on this server', 503);
    const d = await plaid('/item/public_token/exchange', { public_token: String(req.body.publicToken || '') });
    const { settings } = await getSettings(req.user.id);
    await run('INSERT INTO roundup_settings (user_id, settings, plaid_token, cursor, updated_at) VALUES (?,?,?,NULL,?) ON CONFLICT(user_id) DO UPDATE SET plaid_token = excluded.plaid_token, cursor = NULL, updated_at = excluded.updated_at', req.user.id, JSON.stringify(settings), encrypt({ token: d.access_token, item: d.item_id }), now());
    await audit(req.user.id, 'card_linked', null, req.ip);
    res.json({ linked: true, added: await syncPlaid(req.user.id).catch(() => 0) });
  });
  r.delete('/plaid', async (req, res) => {
    const { token } = await getSettings(req.user.id);
    if (token && plaidEnabled()) await plaid('/item/remove', { access_token: token }).catch(() => {});
    await run('UPDATE roundup_settings SET plaid_token = NULL, cursor = NULL WHERE user_id = ?', req.user.id);
    res.json({ ok: true });
  });
  return r;
})();
