// One app for all your money: banks, credit cards and loans linked through Plaid (balances and
// transactions), crypto wallets watched by their public address (read-only: no keys, nothing can
// move), the brokerage accounts, private investments and real estate, as one net worth, plus cash
// flow (money in and out by month and where it went). Linking a bank is read-only too.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { encrypt, tryDecrypt } from './crypto.js';
import { plaid, plaidEnabled } from './roundup.js';
import { accountSummary, lastPrice } from './brokers.js';
import { accountsFor } from './ext/routes.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const r2 = x => +(+x || 0).toFixed(2);

// ---------- Plaid: banks, cards, loans ----------
async function refreshItem(item) {
  const token = tryDecrypt(item.token, 'bank link')?.token;
  if (!token) return;
  const a = await plaid('/accounts/get', { access_token: token });
  const accounts = (a.accounts || []).map(x => ({ id: x.account_id, name: x.official_name || x.name, mask: x.mask, type: x.type, subtype: x.subtype, balance: x.balances?.current ?? null, available: x.balances?.available ?? null, currency: x.balances?.iso_currency_code || 'USD' }));
  // New transactions since the last sync (Plaid: positive amounts are money out).
  let cursor = item.cursor, more = true, pages = 0;
  while (more && pages++ < 10) {
    const d = await plaid('/transactions/sync', { access_token: token, cursor: cursor || undefined, count: 250 });
    for (const t of [...(d.added || []), ...(d.modified || [])].filter(t => !t.pending)) {
      await run('INSERT INTO money_tx (id, user_id, item_id, account_id, day, name, amount, category) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET amount = excluded.amount, name = excluded.name, category = excluded.category',
        String(t.transaction_id), item.user_id, item.id, t.account_id, t.date, (t.merchant_name || t.name || '').slice(0, 120), +t.amount, t.personal_finance_category?.primary || (t.category || [])[0] || null);
    }
    for (const t of d.removed || []) await run('DELETE FROM money_tx WHERE id = ? AND user_id = ?', String(t.transaction_id), item.user_id);
    cursor = d.next_cursor; more = d.has_more;
  }
  await run('UPDATE money_items SET accounts = ?, cursor = ?, refreshed_at = ? WHERE id = ?', JSON.stringify(accounts), cursor || null, now(), item.id);
}
export async function refreshAll(userId) {
  for (const it of await all('SELECT * FROM money_items WHERE user_id = ?', userId)) await refreshItem(it).catch(e => console.warn('money refresh', it.id, e.message));
}

// ---------- crypto wallets (public address, read-only) ----------
const BTC_API = () => (process.env.BTC_API_URL || 'https://blockstream.info/api').replace(/\/$/, '');
const ETH_RPC = () => process.env.ETH_RPC_URL || 'https://cloudflare-eth.com';
export const CHAINS = { btc: { name: 'Bitcoin', symbol: 'BTC', re: /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ }, eth: { name: 'Ethereum', symbol: 'ETH', re: /^0x[0-9a-fA-F]{40}$/ } };
export async function walletAmount(chain, address) {
  if (chain === 'btc') {
    const r = await fetch(`${BTC_API()}/address/${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw bad('Could not read the Bitcoin address', 502);
    const d = await r.json(), c = d.chain_stats || {}, m = d.mempool_stats || {};
    return ((c.funded_txo_sum || 0) - (c.spent_txo_sum || 0) + (m.funded_txo_sum || 0) - (m.spent_txo_sum || 0)) / 1e8;
  }
  const r = await fetch(ETH_RPC(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }), signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.result) throw bad('Could not read the Ethereum address', 502);
  return Number(BigInt(d.result)) / 1e18;
}
async function cryptoPrice(symbol, userId) { return lastPrice(`${symbol}/USD`, userId).catch(() => lastPrice(`${symbol}USD`, userId)).catch(() => null); }

// ---------- everything together ----------
const KIND = { depository: 'cash', credit: 'credit', loan: 'loan', investment: 'investment' };
export async function overview(user) {
  const items = (await all('SELECT id, institution, accounts, refreshed_at FROM money_items WHERE user_id = ? ORDER BY id', user.id)).map(i => ({ id: i.id, institution: i.institution, refreshedAt: i.refreshed_at, accounts: JSON.parse(i.accounts || '[]') }));
  const sums = { cash: 0, credit: 0, loan: 0, mortgage: 0, investment: 0, other: 0 };
  for (const it of items) for (const a of it.accounts) sums[a.type === 'loan' && a.subtype === 'mortgage' ? 'mortgage' : KIND[a.type] || 'other'] += +a.balance || 0;
  const wallets = [];
  for (const w of await all('SELECT * FROM crypto_wallets WHERE user_id = ? ORDER BY id', user.id)) {
    const px = await cryptoPrice(CHAINS[w.chain].symbol, user.id);
    wallets.push({ id: w.id, chain: w.chain, name: CHAINS[w.chain].name, address: w.address, label: w.label, amount: w.amount, price: px, value: px != null && w.amount != null ? r2(w.amount * px) : null, checkedAt: w.checked_at });
  }
  const brokerage = [];
  for (const a of await accountsFor(user.id).catch(() => [])) {
    if (a.id === 'paper' || a.connected === false) continue;
    const s = await accountSummary(user.id, a.id).catch(() => null);
    if (s) brokerage.push({ id: a.id, name: a.name || a.id, value: r2(s.equity) });
  }
  const { listAlts } = await import('./alts.js');
  const [priv, re] = await Promise.all([listAlts(user.id, 'private'), listAlts(user.id, 'realestate')]);
  const parts = {
    brokerage: r2(brokerage.reduce((s, a) => s + a.value, 0)), cash: r2(sums.cash), investmentsElsewhere: r2(sums.investment),
    crypto: r2(wallets.reduce((s, w) => s + (w.value || 0), 0)), private: r2(priv.reduce((s, a) => s + a.stats.value, 0)), realEstate: r2(re.reduce((s, a) => s + (+a.value || 0), 0)),
    creditCards: r2(-sums.credit), loans: r2(-sums.loan), mortgages: r2(-sums.mortgage - re.reduce((s, a) => s + (+a.mortgage || 0), 0)),
  };
  const assets = r2(parts.brokerage + parts.cash + parts.investmentsElsewhere + parts.crypto + parts.private + parts.realEstate);
  const debts = r2(parts.creditCards + parts.loans + parts.mortgages);
  return { plaid: plaidEnabled(), items, wallets, brokerage, parts, assets, debts, netWorth: r2(assets + debts), cashflow: await cashflow(user.id) };
}
// Money in and out by month for the last six months, and where the money went.
export async function cashflow(userId) {
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
  const tx = await all('SELECT day, amount, category, name FROM money_tx WHERE user_id = ? AND day >= ? ORDER BY day', userId, since);
  const transfer = c => /TRANSFER|LOAN_PAYMENTS|CREDIT_CARD/i.test(c || '');
  const months = {};
  for (const t of tx) {
    if (transfer(t.category)) continue;
    const m = (months[t.day.slice(0, 7)] ||= { month: t.day.slice(0, 7), moneyIn: 0, moneyOut: 0 });
    if (t.amount < 0) m.moneyIn += -t.amount; else m.moneyOut += t.amount;
  }
  const byCat = {};
  for (const t of tx) if (t.amount > 0 && !transfer(t.category)) byCat[t.category || 'OTHER'] = (byCat[t.category || 'OTHER'] || 0) + t.amount;
  const list = Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ ...m, moneyIn: r2(m.moneyIn), moneyOut: r2(m.moneyOut), net: r2(m.moneyIn - m.moneyOut) }));
  return { months: list, spendingByCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, amount]) => ({ category: category.replace(/_/g, ' ').toLowerCase(), amount: r2(amount) })) };
}

export const moneyRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => res.json(await overview(req.user)));
  r.post('/link-token', async (req, res) => {
    if (!plaidEnabled()) throw bad('Bank linking is not set up on this server yet (PLAID_CLIENT_ID / PLAID_SECRET)', 503);
    const d = await plaid('/link/token/create', { user: { client_user_id: String(req.user.id) }, client_name: 'Brightfolio', products: ['transactions'], country_codes: ['US'], language: 'en' });
    res.json({ linkToken: d.link_token });
  });
  r.post('/exchange', async (req, res) => {
    if (!plaidEnabled()) throw bad('Bank linking is not set up on this server yet', 503);
    if ((await one('SELECT COUNT(*) n FROM money_items WHERE user_id = ?', req.user.id)).n >= 20) throw bad('Up to 20 linked banks');
    const d = await plaid('/item/public_token/exchange', { public_token: String(req.body?.publicToken || '') });
    const id = Number((await run('INSERT INTO money_items (user_id, institution, token, created_at) VALUES (?,?,?,?)', req.user.id, String(req.body?.institution || 'Bank').slice(0, 80), encrypt({ token: d.access_token }), now())).lastInsertRowid);
    await audit(req.user.id, 'bank_linked', { id }, req.ip);
    await refreshItem(await one('SELECT * FROM money_items WHERE id = ?', id)).catch(() => {});
    res.json({ id });
  });
  r.post('/refresh', async (req, res) => { await refreshAll(req.user.id); res.json(await overview(req.user)); });
  r.delete('/banks/:id', async (req, res) => {
    const it = await one('SELECT * FROM money_items WHERE id = ? AND user_id = ?', +req.params.id, req.user.id);
    if (!it) throw bad('Not found', 404);
    const token = tryDecrypt(it.token, 'bank link')?.token;
    if (token && plaidEnabled()) await plaid('/item/remove', { access_token: token }).catch(() => {});
    await run('DELETE FROM money_tx WHERE item_id = ? AND user_id = ?', it.id, req.user.id);
    await run('DELETE FROM money_items WHERE id = ?', it.id);
    await audit(req.user.id, 'bank_unlinked', { id: it.id }, req.ip);
    res.json({ ok: true });
  });
  r.post('/wallets', async (req, res) => {
    const chain = String(req.body?.chain || ''), address = String(req.body?.address || '').trim();
    if (!CHAINS[chain]) throw bad('Pick Bitcoin or Ethereum');
    if (!CHAINS[chain].re.test(address)) throw bad(`That is not a ${CHAINS[chain].name} address`);
    if ((await one('SELECT COUNT(*) n FROM crypto_wallets WHERE user_id = ?', req.user.id)).n >= 30) throw bad('Up to 30 wallets');
    const amount = await walletAmount(chain, address);
    const id = Number((await run('INSERT INTO crypto_wallets (user_id, chain, address, label, amount, checked_at, created_at) VALUES (?,?,?,?,?,?,?)', req.user.id, chain, address, String(req.body?.label || '').slice(0, 60), amount, now(), now())).lastInsertRowid);
    res.json({ id, amount });
  });
  r.post('/wallets/:id/refresh', async (req, res) => {
    const w = await one('SELECT * FROM crypto_wallets WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!w) throw bad('Not found', 404);
    const amount = await walletAmount(w.chain, w.address);
    await run('UPDATE crypto_wallets SET amount = ?, checked_at = ? WHERE id = ?', amount, now(), w.id);
    res.json({ amount });
  });
  r.delete('/wallets/:id', async (req, res) => { await run('DELETE FROM crypto_wallets WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
})();
