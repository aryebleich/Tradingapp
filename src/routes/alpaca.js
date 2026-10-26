// /api/alpaca/* - brokerage accounts, trading, portfolio, market data and watchlists.
import express from 'express';
import { one, run, now, audit } from '../db.js';
import { requireUser, rateLimit } from '../auth.js';
import * as B from '../alpaca/broker.js';
import * as D from '../alpaca/data.js';
import { buildOrder, buildReplace } from '../alpaca/trading.js';
import { connections, tradingFor, requireTrading, saveCred, oauthEnabled, oauthStartUrl, extraAlpaca, requireTradingFor } from '../alpaca/connections.js';
import { sseHandler, streamEnabled } from '../alpaca/stream.js';
import { syncAlpacaFills, accountSummary, lastPrice, riskDeps } from '../brokers.js';
import { breaker, chaos } from '../reliability.js';
import { quoteAt, auditAppend } from '../execution.js';
import { getSetting } from '../settings.js';
import crypto from 'node:crypto';
import { checkOrder, logOrder } from '../risk.js';
import { isPaid } from '../fees.js';
import { applyStatus, adoptAccount, history, kycBus, feedStatus } from '../alpaca/kyc.js';

export const router = express.Router();
router.use(requireUser);
// The Alpaca account a request works on: the primary connection, or an extra one picked with ?acct=alpaca:N.
const T = req => { const a = req.query.acct || req.body?.acct; return a && a !== 'alpaca' ? requireTradingFor(req.user.id, String(a)) : requireTrading(req.user.id); };
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const symParam = s => { const v = String(s || '').trim().toUpperCase(); if (!/^[A-Z0-9.\-]{1,21}(\/[A-Z]{3,4})?$/.test(v)) throw bad('Invalid symbol'); return v; };


// ---------- connection status ----------
router.get('/status', async (req, res) => {
  // An application approved while nobody was looking should unlock trading right away.
  const pending = await one("SELECT status FROM broker_accounts WHERE user_id = ? AND status != 'ACTIVE'", req.user.id);
  if (pending && B.brokerEnabled()) await refreshBrokerAccount(req.user.id).catch(e => console.warn('kyc refresh', e.message));
  const all = await connections(req.user.id), t = await tradingFor(req.user.id);
  const b = await one('SELECT account_id, account_number, status, crypto_status, updated_at FROM broker_accounts WHERE user_id = ?', req.user.id);
  res.json({
    active: t ? { type: t.type, live: t.live } : null,
    available: Object.keys(all),
    broker: { enabled: B.brokerEnabled(), account: b ? { id: b.account_id, number: b.account_number, status: b.status, cryptoStatus: b.crypto_status, step: B.kycStep(b.status), updatedAt: b.updated_at } : null },
    oauth: { enabled: oauthEnabled(), connected: !!all.oauth },
    keys: { connected: !!all.keys, live: !!all.keys?.live },
    data: D.dataEnabled(), stream: streamEnabled(),
  });
});
router.post('/connection', async (req, res) => {
  const all = await connections(req.user.id);
  if (!all[req.body.type]) throw bad('That connection is not set up');
  await run('UPDATE users SET alpaca_conn = ? WHERE id = ?', req.body.type, req.user.id);
  res.json({ ok: true });
});
router.get('/oauth/start', async (req, res) => {
  if (!oauthEnabled()) throw Object.assign(new Error('Alpaca OAuth is not configured (ALPACA_OAUTH_CLIENT_ID / SECRET)'), { status: 503 });
  res.json({ url: oauthStartUrl(req.user.id) });
});
router.delete('/oauth', async (req, res) => {
  await run("DELETE FROM credentials WHERE user_id = ? AND provider = 'alpaca_oauth'", req.user.id);
  res.json({ ok: true });
});

// ---------- brokerage account (Broker API) ----------
export async function refreshBrokerAccount(userId) {
  const b = await one('SELECT * FROM broker_accounts WHERE user_id = ?', userId);
  if (!b) return null;
  const a = await B.getAccount(b.account_id);
  await applyStatus(b.account_id, { to: a.status, source: 'poll', accountNumber: a.account_number, cryptoStatus: a.crypto_status });
  return { previous: b.status, account: a };
}

// Opens the account at Alpaca (POST /v1/accounts) and links the returned account id to the user.
// The request is built and sent here on the server; Broker API keys never reach the browser.
router.post('/broker/accounts', async (req, res) => {
  if (!rateLimit('acct-open:' + req.user.id, 5, 3600e3)) throw Object.assign(new Error('Too many attempts, try again later'), { status: 429 });
  if (await one('SELECT 1 FROM broker_accounts WHERE user_id = ?', req.user.id)) throw bad('You already have a brokerage account');
  const body = B.buildAccountRequest(req.body || {}, req.ip);
  const a = await B.createAccount(body);
  await run('INSERT INTO broker_accounts (user_id, account_id, account_number, status, crypto_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    req.user.id, a.id, a.account_number, a.status, a.crypto_status ?? null, now(), now());
  await applyStatus(a.id, { to: a.status, source: 'created' });
  await adoptAccount(a.id);
  await run("UPDATE users SET alpaca_conn = 'broker' WHERE id = ?", req.user.id);
  await audit(req.user.id, 'broker_account_created', { account: a.account_number, status: a.status, documents: body.documents?.length || 0 }, req.ip);
  res.json({ id: a.id, accountNumber: a.account_number, status: a.status, step: B.kycStep(a.status), info: B.statusInfo(a.status) });
});
router.get('/broker/account', async (req, res) => {
  const r = await refreshBrokerAccount(req.user.id);
  if (!r) return res.json(null);
  const a = r.account;
  // Only what the UI needs; the SSN is never sent back to the browser.
  res.json({
    id: a.id, accountNumber: a.account_number, status: a.status, cryptoStatus: a.crypto_status, step: B.kycStep(a.status), info: B.statusInfo(a.status), createdAt: a.created_at,
    kyc: a.kyc_results ? { reject: a.kyc_results.reject, accept: a.kyc_results.accept, indeterminate: a.kyc_results.indeterminate, summary: a.kyc_results.summary } : null,
    contact: a.contact, name: a.identity ? `${a.identity.given_name} ${a.identity.family_name}` : null,
    enabledAssets: a.enabled_assets, agreements: (a.agreements || []).map(g => g.agreement),
    history: await history(req.user.id), live: feedStatus().connected,
  });
});
// Status history for the dashboard timeline.
router.get('/broker/events', async (req, res) => res.json({ events: await history(req.user.id), feed: feedStatus() }));
// Live status for this user's open tabs: changes from the Alpaca feed are relayed here as they arrive.
const kycClients = new Map();
router.get('/broker/events/stream', async (req, res) => {
  const uid = req.user.id;
  if ((kycClients.get(uid) || 0) >= 5) return res.status(429).json({ error: 'Too many status streams open; close some tabs.' });
  kycClients.set(uid, (kycClients.get(uid) || 0) + 1);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const b = await one('SELECT status FROM broker_accounts WHERE user_id = ?', uid);
  res.write(`event: hello\ndata: ${JSON.stringify({ status: b?.status || null, live: feedStatus().connected })}\n\n`);
  const on = e => { if (e.userId === uid) res.write(`event: status\ndata: ${JSON.stringify({ status: e.status, previous: e.previous, title: e.title, detail: e.detail, tone: e.tone, action: e.action, reason: e.reason, at: e.at })}\n\n`); };
  kycBus.on('status', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => { clearInterval(ping); kycBus.off('status', on); kycClients.set(uid, kycClients.get(uid) - 1); });
});
// Extra identity documents, e.g. when Alpaca marks the application ACTION_REQUIRED.
router.post('/broker/documents', async (req, res) => {
  if (!rateLimit('acct-docs:' + req.user.id, 10, 3600e3)) throw Object.assign(new Error('Too many uploads, try again later'), { status: 429 });
  const b = await one('SELECT account_id FROM broker_accounts WHERE user_id = ?', req.user.id);
  if (!b) throw bad('Open a brokerage account first');
  const docs = B.buildDocuments(req.body?.documents);
  if (!docs.length) throw bad('Choose a file to upload');
  await B.uploadDocuments(b.account_id, docs);
  await audit(req.user.id, 'broker_documents_uploaded', { count: docs.length, kinds: docs.map(d => d.document_sub_type) }, req.ip);
  const r = await refreshBrokerAccount(req.user.id);
  res.json({ ok: true, status: r.account.status, info: B.statusInfo(r.account.status) });
});
router.patch('/broker/account', async (req, res) => {
  const b = await one('SELECT account_id FROM broker_accounts WHERE user_id = ?', req.user.id);
  if (!b) throw bad('No brokerage account');
  const f = req.body || {}, contact = {};
  if (f.email) contact.email_address = String(f.email);
  if (f.phone) contact.phone_number = String(f.phone);
  if (f.street) contact.street_address = [String(f.street)];
  for (const [k, v] of [['unit', 'unit'], ['city', 'city'], ['state', 'state'], ['postalCode', 'postal_code']]) if (f[k]) contact[v] = String(f[k]);
  if (!Object.keys(contact).length) throw bad('Nothing to update');
  await B.updateAccount(b.account_id, { contact });
  await audit(req.user.id, 'broker_account_updated', { fields: Object.keys(contact) }, req.ip);
  res.json({ ok: true });
});

const brokerId = async req => {
  const b = await one('SELECT account_id FROM broker_accounts WHERE user_id = ?', req.user.id);
  if (!b) throw bad('Open a brokerage account first');
  return b.account_id;
};
router.get('/broker/ach', async (req, res) => res.json(await B.listAch(await brokerId(req))));
router.post('/broker/ach', async (req, res) => {
  const f = req.body || {};
  if (!/^\d{9}$/.test(String(f.routingNumber || ''))) throw bad('Routing number must have 9 digits');
  if (!/^\d{4,17}$/.test(String(f.accountNumber || ''))) throw bad('Enter a valid bank account number');
  const r = await B.createAch(await brokerId(req), {
    account_owner_name: String(f.ownerName || '').trim() || req.user.email, bank_account_type: f.accountType === 'SAVINGS' ? 'SAVINGS' : 'CHECKING',
    bank_account_number: String(f.accountNumber), bank_routing_number: String(f.routingNumber), nickname: f.nickname || undefined,
  });
  await audit(req.user.id, 'ach_linked', { last4: String(f.accountNumber).slice(-4) }, req.ip);
  res.json(r);
});
router.delete('/broker/ach/:id', async (req, res) => { await B.deleteAch(await brokerId(req), req.params.id); res.json({ ok: true }); });
router.get('/broker/transfers', async (req, res) => res.json(await B.listTransfers(await brokerId(req), { limit: 50 })));
router.post('/broker/transfers', async (req, res) => {
  const amount = +req.body.amount, direction = req.body.direction === 'OUTGOING' ? 'OUTGOING' : 'INCOMING';
  if (!(amount >= 1 && amount <= 50000)) throw bad('Transfers are $1 - $50,000');
  if (!req.body.relationshipId) throw bad('Pick a linked bank account');
  if (direction === 'OUTGOING' && (await getSetting(req.user.id, 'lock'))?.on) throw bad('Your account is locked: withdrawals are frozen. Unlock it under Security.', 423);
  const r = await B.createTransfer(await brokerId(req), { transfer_type: 'ach', relationship_id: req.body.relationshipId, amount: amount.toFixed(2), direction, timing: 'immediate' });
  await audit(req.user.id, 'transfer', { amount, direction }, req.ip);
  res.json(r);
});
router.delete('/broker/transfers/:id', async (req, res) => { await B.cancelTransfer(await brokerId(req), req.params.id); res.json({ ok: true }); });

// ---------- account, configuration, portfolio ----------
router.get('/account', async (req, res) => {
  const t = await T(req), a = await t.account();
  const n = k => (a[k] == null ? null : +a[k]);
  res.json({
    connection: { type: t.type, live: t.live }, id: a.id, accountNumber: a.account_number, status: a.status, currency: a.currency,
    equity: n('equity'), lastEquity: n('last_equity'), cash: n('cash'), buyingPower: n('buying_power'), regtBuyingPower: n('regt_buying_power'),
    daytradingBuyingPower: n('daytrading_buying_power'), nonMarginableBuyingPower: n('non_marginable_buying_power'), optionsBuyingPower: n('options_buying_power'),
    longMarketValue: n('long_market_value'), shortMarketValue: n('short_market_value'), initialMargin: n('initial_margin'), maintenanceMargin: n('maintenance_margin'),
    multiplier: n('multiplier'), sma: n('sma'), daytradeCount: n('daytrade_count'), patternDayTrader: !!a.pattern_day_trader, tradingBlocked: !!a.trading_blocked,
    shortingEnabled: !!a.shorting_enabled, cryptoStatus: a.crypto_status, optionsLevel: a.options_trading_level ?? a.options_approved_level ?? null,
  });
});
router.get('/account/config', async (req, res) => res.json(await (await T(req)).configurations()));
router.patch('/account/config', async (req, res) => {
  const allowed = { dtbp_check: ['both', 'entry', 'exit'], trade_confirm_email: ['all', 'none'], pdt_check: ['both', 'entry', 'exit'], max_margin_multiplier: ['1', '2', '4'] };
  const body = {};
  for (const [k, vals] of Object.entries(allowed)) if (req.body[k] !== undefined) { if (!vals.includes(String(req.body[k]))) throw bad(`Bad value for ${k}`); body[k] = String(req.body[k]); }
  for (const k of ['suspend_trade', 'no_shorting', 'fractional_trading']) if (req.body[k] !== undefined) body[k] = !!req.body[k];
  if (req.body.max_options_trading_level !== undefined) body.max_options_trading_level = Math.max(0, Math.min(3, Math.trunc(+req.body.max_options_trading_level)));
  const r = await (await T(req)).updateConfigurations(body);
  await audit(req.user.id, 'account_config', body, req.ip);
  res.json(r);
});
router.get('/portfolio/history', async (req, res) => {
  const period = ['1D', '1W', '1M', '3M', '6M', '1A', 'all'].includes(req.query.period) ? req.query.period : '1M';
  const timeframe = { '1D': '5Min', '1W': '1H', '1M': '1D', '3M': '1D', '6M': '1D', '1A': '1D', all: '1D' }[period];
  const h = await (await T(req)).portfolioHistory({ period: period === 'all' ? undefined : period, timeframe, extended_hours: period === '1D' ? true : undefined });
  const points = (h.timestamp || []).map((t, i) => ({ t: t * 1000, equity: h.equity[i], pl: h.profit_loss?.[i], plPct: h.profit_loss_pct?.[i] })).filter(p => p.equity != null);
  res.json({ period, baseValue: h.base_value, points });
});

// ---------- orders ----------
router.get('/orders', async (req, res) => {
  const status = ['open', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'all';
  res.json(await (await T(req)).orders({ status, limit: Math.min(+req.query.limit || 100, 500), symbols: req.query.symbols || undefined }));
});
router.get('/orders/:id', async (req, res) => res.json(await (await T(req)).order(req.params.id)));
router.post('/orders', async (req, res) => {
  const t = await T(req);
  if (!rateLimit('order:' + req.user.id, 60, 60e3)) throw Object.assign(new Error('Too many orders in a minute'), { status: 429 });
  const body = buildOrder(req.body || {});
  const chk = await checkOrder(req.user.id, 'alpaca', { symbol: body.symbol || '', side: body.side || 'buy', qty: +body.qty || 0, notional: +body.notional || 0, limitPrice: +body.limit_price || 0, order_class: body.order_class, legs: body.legs }, 'web', riskDeps(req.user.id));
  if (chk?.resize && !body.order_class) { if (chk.resize.notional && body.notional) body.notional = chk.resize.notional.toFixed(2); else if (chk.resize.qty && body.qty) body.qty = String(chk.resize.qty); }
  const ref = crypto.randomUUID(), quote = body.symbol ? await quoteAt(body.symbol, null) : null;
  await auditAppend(req.user.id, 'order', { event: 'sent', orderRef: ref, venue: 'alpaca', symbol: body.symbol || 'mleg', legs: body.legs || null, side: body.side || null, qty: body.qty || null, notional: body.notional || null, type: body.type, limitPrice: body.limit_price || null, source: 'web', quote, at: Date.now() });
  let o;
  try { o = await breaker('alpaca').run(async () => { await chaos(); return t.placeOrder(body); }); }
  catch (e) { await auditAppend(req.user.id, 'order', { event: 'rejected', orderRef: ref, venue: 'alpaca', symbol: body.symbol || 'mleg', reason: String(e.message).slice(0, 200), at: Date.now() }); throw e; }
  await auditAppend(req.user.id, 'order', { event: 'accepted', orderRef: ref, brokerOrderId: String(o.id), venue: 'alpaca', symbol: o.symbol || 'mleg', side: o.side, status: o.status, at: Date.now() });
  await logOrder(req.user.id, 'alpaca', { symbol: body.symbol || 'mleg', side: body.side, value: +body.notional || 0 }, 'web');
  await audit(req.user.id, 'alpaca_order', { id: o.id, symbol: o.symbol || 'mleg', side: o.side, type: o.type, class: o.order_class, live: t.live }, req.ip);
  if (chk?.notes?.length) o.notes = chk.notes;
  setTimeout(() => syncAlpacaFills(req.user.id).catch(() => {}), 4000);
  res.json(o);
});
router.patch('/orders/:id', async (req, res) => {
  const t = await T(req);
  const o = await t.replaceOrder(req.params.id, buildReplace(req.body || {}));
  await audit(req.user.id, 'alpaca_order_replaced', { id: req.params.id, newId: o.id }, req.ip);
  res.json(o);
});
router.delete('/orders/:id', async (req, res) => { await (await T(req)).cancelOrder(req.params.id); res.json({ ok: true }); });
router.delete('/orders', async (req, res) => {
  const r = await (await T(req)).cancelAllOrders();
  await audit(req.user.id, 'alpaca_cancel_all', { count: Array.isArray(r) ? r.length : null }, req.ip);
  res.json(r || []);
});

// ---------- positions ----------
router.get('/positions', async (req, res) => {
  const ps = await (await T(req)).positions();
  res.json(ps.map(p => ({
    symbol: p.symbol, assetClass: p.asset_class, side: p.side, qty: +p.qty, qtyAvailable: +(p.qty_available ?? p.qty), avgEntry: +p.avg_entry_price, price: +p.current_price,
    marketValue: +p.market_value, costBasis: +p.cost_basis, unrealizedPl: +p.unrealized_pl, unrealizedPlPct: +p.unrealized_plpc * 100,
    todayPl: +p.unrealized_intraday_pl, todayPlPct: +p.unrealized_intraday_plpc * 100, changeToday: +p.change_today * 100,
  })));
});
router.delete('/positions/:symbol', async (req, res) => {
  const t = await T(req);
  const q = {};
  if (req.query.qty) { if (!(+req.query.qty > 0)) throw bad('Quantity must be positive'); q.qty = String(+req.query.qty); }
  else if (req.query.percentage) { const p = +req.query.percentage; if (!(p > 0 && p <= 100)) throw bad('Percentage must be 1-100'); q.percentage = String(p); }
  const o = await t.closePosition(symParam(req.params.symbol).replace('/', ''), q);
  await audit(req.user.id, 'position_closed', { symbol: req.params.symbol, ...q }, req.ip);
  res.json(o);
});
router.delete('/positions', async (req, res) => {
  const t = await T(req);
  const r = await t.closeAllPositions(true);
  await audit(req.user.id, 'positions_closed_all', null, req.ip);
  res.json(r || []);
});
router.post('/positions/:symbol/exercise', async (req, res) => { res.json(await (await T(req)).exerciseOption(symParam(req.params.symbol)) || { ok: true }); });

// ---------- watchlists ----------
router.get('/watchlists', async (req, res) => res.json(await (await T(req)).watchlists()));
router.get('/watchlists/:id', async (req, res) => res.json(await (await T(req)).watchlist(req.params.id)));
router.post('/watchlists', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 64);
  if (!name) throw bad('Name the watchlist');
  res.json(await (await T(req)).createWatchlist(name, (req.body.symbols || []).map(symParam)));
});
router.put('/watchlists/:id', async (req, res) => {
  const body = {};
  if (req.body.name) body.name = String(req.body.name).trim().slice(0, 64);
  if (Array.isArray(req.body.symbols)) body.symbols = req.body.symbols.map(symParam);
  res.json(await (await T(req)).updateWatchlist(req.params.id, body));
});
router.delete('/watchlists/:id', async (req, res) => { await (await T(req)).deleteWatchlist(req.params.id); res.json({ ok: true }); });
router.post('/watchlists/:id/assets', async (req, res) => res.json(await (await T(req)).addToWatchlist(req.params.id, symParam(req.body.symbol))));
router.delete('/watchlists/:id/assets/:symbol', async (req, res) => res.json(await (await T(req)).removeFromWatchlist(req.params.id, symParam(req.params.symbol))));

// ---------- market info (clock, calendar, assets, corporate actions) ----------
router.get('/clock', async (req, res) => res.json(await (await T(req)).clock()));
router.get('/calendar', async (req, res) => {
  const start = req.query.start || new Date().toISOString().slice(0, 10), end = req.query.end || new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  res.json(await (await T(req)).calendar({ start, end }));
});
router.get('/assets/search', async (req, res) => {
  const q = String(req.query.q || '').trim().toUpperCase();
  if (q.length < 1) return res.json([]);
  const cls = req.query.class === 'crypto' ? 'crypto' : 'us_equity';
  const t = await T(req);
  // The asset list is large; cache it per class for an hour.
  const key = t.type + cls;
  if (!assetCache[key] || now() - assetCache[key].at > 3600e3) assetCache[key] = { at: now(), list: await t.assets({ status: 'active', asset_class: cls }) };
  const list = assetCache[key].list;
  const hits = list.filter(a => a.symbol.startsWith(q)).concat(list.filter(a => !a.symbol.startsWith(q) && a.name?.toUpperCase().includes(q))).slice(0, 15);
  res.json(hits.map(a => ({ symbol: a.symbol, name: a.name, exchange: a.exchange, class: a.class, tradable: a.tradable, fractionable: a.fractionable, shortable: a.shortable })));
});
const assetCache = {};
router.get('/announcements', async (req, res) => {
  const since = req.query.since || new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10), until = req.query.until || new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
  const types = String(req.query.types || 'dividend,merger,spinoff,split').split(',').filter(x => ['dividend', 'merger', 'spinoff', 'split'].includes(x));
  res.json(await (await T(req)).announcements({ ca_types: types, since, until, symbol: req.query.symbol ? symParam(req.query.symbol) : undefined }));
});

// ---------- market data ----------
const dataLimit = (req) => { if (!rateLimit('data:' + req.user.id, 240, 60e3)) throw Object.assign(new Error('Too many market data requests'), { status: 429 }); };
router.get('/data/bars', async (req, res) => { dataLimit(req); res.json(await D.bars(req.query.symbols, { timeframe: req.query.timeframe, start: req.query.start, end: req.query.end, limit: req.query.limit })); });
router.get('/data/orderbook', async (req, res) => {
  dataLimit(req);
  const sym = symParam(req.query.symbol);
  if (!sym.includes('/')) return res.json({ symbol: sym, depth: false, quote: (await D.latest(sym))[sym]?.quote || null });
  res.json({ depth: true, ...(await D.orderbook(sym)) });
});
router.get('/data/latest', async (req, res) => { dataLimit(req); res.json(await D.latest(req.query.symbols)); });
router.get('/data/snapshots', async (req, res) => { dataLimit(req); res.json(await D.snapshots(req.query.symbols)); });
router.get('/data/most-actives', async (req, res) => { dataLimit(req); res.json(await D.mostActives(req.query.by, req.query.top)); });
router.get('/data/movers', async (req, res) => { dataLimit(req); res.json(await D.movers(req.query.market, req.query.top)); });
router.get('/data/news', async (req, res) => { dataLimit(req); res.json(await D.news({ symbols: req.query.symbols, limit: req.query.limit })); });
router.get('/data/options/:underlying', async (req, res) => {
  dataLimit(req);
  res.json(await D.optionChain(symParam(req.params.underlying), { expiration: req.query.expiration, type: ['call', 'put'].includes(req.query.type) ? req.query.type : undefined, strikeMin: req.query.strikeMin, strikeMax: req.query.strikeMax }));
});
router.get('/data/corporate-actions', async (req, res) => { dataLimit(req); res.json(await D.corporateActions({ symbols: req.query.symbols, start: req.query.start, end: req.query.end })); });
router.get('/stream', sseHandler);

// Lets users keep their own API keys as before (stored encrypted).
// ---------- several Alpaca accounts (main + sub accounts) ----------
// Each extra account has its own API keys (paper or live). The primary connection stays "alpaca".
router.get('/accounts', async (req, res) => res.json((await extraAlpaca(req.user.id)).map(({ k, s, ...x }) => ({ ...x, keyId: k.slice(0, 4) + '…' + k.slice(-3) }))));
router.post('/accounts', async (req, res) => {
  const { keyId, secret, live, label, role } = req.body || {};
  if (!keyId || !secret) throw bad('Key id and secret are required');
  const list = await extraAlpaca(req.user.id);
  if (list.length >= 20) throw bad('Up to 20 extra Alpaca accounts');
  // Live trading is on every plan; the free plan links one extra live account, paid plans up to 20.
  if (live && !isPaid(req.user) && list.some(x => x.live)) throw Object.assign(new Error('More than one extra live Alpaca account is part of Pro'), { status: 402, upgrade: true, feature: 'Several live Alpaca accounts' });
  const c = { type: 'keys', k: String(keyId).trim(), s: String(secret).trim(), live: !!live };
  if (list.some(x => x.k === c.k)) throw bad('These keys are already connected');
  const { Trading } = await import('../alpaca/trading.js');
  const a = await new Trading(c).account(); // verifies the keys
  const used = new Set(list.map(x => +x.id.split(':')[1])); let n = 2; while (used.has(n)) n++;
  const id = 'alpaca:' + n;
  await saveCred(req.user.id, id, { ...c, label: String(label || (role === 'main' ? 'Main account' : 'Sub account ' + (n - 1))).slice(0, 40), role: role === 'main' ? 'main' : 'sub' });
  await audit(req.user.id, 'alpaca_account_added', { id, live: c.live, role }, req.ip);
  res.json({ id, accountNumber: a.account_number, equity: +a.equity });
});
router.delete('/accounts/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!/^alpaca:\d{1,3}$/.test(id)) throw bad('Unknown account');
  await run('DELETE FROM credentials WHERE user_id = ? AND provider = ?', req.user.id, id);
  await audit(req.user.id, 'alpaca_account_removed', { id }, req.ip);
  res.json({ ok: true });
});
// Every account side by side, with totals for the live ones (and separately for paper/test ones).
router.get('/accounts/summary', async (req, res) => {
  const extras = await extraAlpaca(req.user.id), primary = await tradingFor(req.user.id);
  const list = [{ id: 'paper', label: 'Paper account (simulated)', role: 'paper', live: false }, ...(primary ? [{ id: 'alpaca', label: 'Primary Alpaca connection', role: 'main', live: primary.live }] : []), ...extras.map(({ k, s, ...x }) => x)];
  const rows = await Promise.all(list.map(async x => {
    try {
      const sm = await accountSummary(req.user.id, x.id);
      const day = sm.lastEquity ? sm.equity - sm.lastEquity : null;
      return { ...x, live: x.id === 'paper' ? false : sm.live ?? x.live, equity: +sm.equity.toFixed(2), cash: +sm.cash.toFixed(2), buyingPower: sm.buyingPower != null ? +(+sm.buyingPower).toFixed(2) : null, dayPl: day == null ? null : +day.toFixed(2), dayPlPct: day == null || !sm.lastEquity ? null : +(day / sm.lastEquity * 100).toFixed(2), positions: sm.positions.length, unrealized: +sm.positions.reduce((a, p) => a + (p.pnl || 0), 0).toFixed(2) };
    } catch (e) { return { ...x, error: e.message }; }
  }));
  const sum = (arr, k) => +arr.reduce((a, r) => a + (+r[k] || 0), 0).toFixed(2);
  const live = rows.filter(r => r.live && !r.error), test = rows.filter(r => !r.live && !r.error && r.id !== 'paper');
  res.json({ accounts: rows, live: { count: live.length, equity: sum(live, 'equity'), cash: sum(live, 'cash'), dayPl: sum(live, 'dayPl'), unrealized: sum(live, 'unrealized'), positions: sum(live, 'positions') }, test: { count: test.length, equity: sum(test, 'equity'), dayPl: sum(test, 'dayPl') } });
});

router.post('/keys', async (req, res) => {
  const { keyId, secret, live } = req.body || {};
  if (!keyId || !secret) throw bad('Key id and secret are required');
  const c = { type: 'keys', k: String(keyId).trim(), s: String(secret).trim(), live: !!live };
  const { Trading } = await import('../alpaca/trading.js');
  const a = await new Trading(c).account(); // verifies the keys
  await saveCred(req.user.id, 'alpaca', { k: c.k, s: c.s, live: c.live });
  await run("UPDATE users SET alpaca_conn = 'keys' WHERE id = ?", req.user.id);
  await audit(req.user.id, 'alpaca_connected', { live: c.live }, req.ip);
  res.json({ ok: true, equity: +a.equity });
});
