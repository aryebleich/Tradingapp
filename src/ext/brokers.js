// More brokerages next to Alpaca. Each adapter turns its broker's API into the same small shape the
// rest of the app uses: summary (equity, cash, positions), orders, and market orders.
//
//   Tradier       personal API token                         api.tradier.com / sandbox.tradier.com
//   tastytrade    OAuth personal grant (client secret + refresh token)   api.tastyworks.com / api.cert.tastyworks.com
//   Schwab        OAuth (the platform registers one app; SCHWAB_APP_KEY / SCHWAB_APP_SECRET)
//   TradeStation  OAuth (TRADESTATION_CLIENT_ID / TRADESTATION_CLIENT_SECRET), live or simulator
//
// Credentials are stored encrypted per user (credentials table, provider = broker id), including
// refreshed access tokens. Base URLs can be overridden with *_BASE_URL for testing.
import crypto from 'node:crypto';
import { one, run, now } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';

const env = k => process.env[k];
const appUrl = () => (env('PUBLIC_URL') || 'http://localhost:3000').replace(/\/$/, '');
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

export async function getExtCred(userId, id) {
  const r = await one('SELECT blob FROM credentials WHERE user_id = ? AND provider = ?', userId, id);
  if (!r) return null;
  try { return decrypt(r.blob); } catch { return null; }
}
export const saveExtCred = (userId, id, value) =>
  run('INSERT INTO credentials (user_id, provider, blob) VALUES (?,?,?) ON CONFLICT DO UPDATE SET blob = excluded.blob', userId, id, encrypt(value));
export const removeExtCred = (userId, id) => run('DELETE FROM credentials WHERE user_id = ? AND provider = ?', userId, id);

async function http(url, { method = 'GET', headers = {}, body, form, json } = {}) {
  const h = { Accept: 'application/json', 'User-Agent': 'Brightfolio/1.0', ...headers };
  let payload;
  if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (json !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(json); }
  else payload = body;
  const r = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let d = null; try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  if (!r.ok) {
    const msg = d?.error?.message || d?.error_description || d?.message || d?.Message || d?.fault?.faultstring || (typeof d?.error === 'string' ? d.error : null) || d?.errors?.[0]?.message || `HTTP ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status === 401 ? 409 : r.status >= 500 ? 502 : 400, http: r.status });
  }
  return { data: d, headers: r.headers };
}
const arr = x => (x == null || x === 'null' ? [] : Array.isArray(x) ? x : [x]);
const pos = (symbol, qty, avg, price) => ({ symbol, qty, avgPrice: avg, price, value: qty * price, pnl: (price - avg) * qty });

// ---------- Tradier ----------
const tradierBase = c => env('TRADIER_BASE_URL') || (c.sandbox ? 'https://sandbox.tradier.com/v1' : 'https://api.tradier.com/v1');
const tradier = {
  id: 'tradier', name: 'Tradier', kind: 'token', shorts: true,
  about: 'Stocks, ETFs and options. Create a token at dash.tradier.com → API Access (use a sandbox token to test).',
  fields: [{ k: 'token', label: 'API access token', secret: true }, { k: 'sandbox', label: 'Sandbox (paper) account', type: 'checkbox' }],
  hdr: c => ({ Authorization: `Bearer ${c.token}` }),
  async connect(body) {
    const c = { token: String(body.token || '').trim(), sandbox: !!body.sandbox };
    if (!c.token) throw bad('Paste your Tradier token');
    const p = (await http(`${tradierBase(c)}/user/profile`, { headers: this.hdr(c) })).data;
    const acct = arr(p?.profile?.account)[0];
    if (!acct?.account_number) throw bad('No Tradier account found for this token');
    return { ...c, account: acct.account_number, live: !c.sandbox };
  },
  async summary(c) {
    const [b, p] = await Promise.all([http(`${tradierBase(c)}/accounts/${c.account}/balances`, { headers: this.hdr(c) }), http(`${tradierBase(c)}/accounts/${c.account}/positions`, { headers: this.hdr(c) })]);
    const bal = b.data.balances || {};
    const raw = arr(p.data?.positions?.position);
    const quotes = raw.length ? arr((await http(`${tradierBase(c)}/markets/quotes?symbols=${raw.map(x => encodeURIComponent(x.symbol)).join(',')}`, { headers: this.hdr(c) })).data?.quotes?.quote) : [];
    const last = Object.fromEntries(quotes.map(q => [q.symbol, +q.last]));
    const positions = raw.map(x => { const avg = x.cost_basis / x.quantity; return pos(x.symbol, +x.quantity, avg, last[x.symbol] || avg); });
    return { equity: +bal.total_equity || 0, cash: +bal.total_cash || 0, buyingPower: +(bal.margin?.stock_buying_power ?? bal.cash?.cash_available ?? bal.total_cash) || 0, positions };
  },
  async orders(c) {
    const d = (await http(`${tradierBase(c)}/accounts/${c.account}/orders`, { headers: this.hdr(c) })).data;
    return arr(d?.orders?.order).slice(-50).reverse().map(o => ({ id: String(o.id), symbol: o.symbol, side: /buy/.test(o.side) ? 'buy' : 'sell', qty: +o.quantity, status: o.status, price: +o.avg_fill_price || null, at: o.create_date }));
  },
  async place(c, o) {
    const d = (await http(`${tradierBase(c)}/accounts/${c.account}/orders`, { method: 'POST', headers: this.hdr(c), form: { class: 'equity', symbol: o.symbol, side: o.side, quantity: String(o.qty), type: 'market', duration: 'day' } })).data;
    return { id: String(d?.order?.id), status: d?.order?.status || 'submitted' };
  },
};

// ---------- tastytrade ----------
const tastyBase = c => env('TASTYTRADE_BASE_URL') || (c.sandbox ? 'https://api.cert.tastyworks.com' : 'https://api.tastyworks.com');
const tasty = {
  id: 'tastytrade', name: 'tastytrade', kind: 'token', shorts: true,
  about: 'Stocks, ETFs and options. At my.tastytrade.com → Manage → My Profile → API, create an OAuth application and a personal grant, then paste its client secret and refresh token.',
  fields: [{ k: 'clientSecret', label: 'OAuth client secret', secret: true }, { k: 'refreshToken', label: 'Refresh token (personal grant)', secret: true }, { k: 'sandbox', label: 'Sandbox (cert) environment', type: 'checkbox' }],
  // Access tokens last 15 minutes; a fresh one is fetched from the refresh token when needed.
  async token(c, save) {
    if (c.access && c.accessExp > now() + 30e3) return c.access;
    const d = (await http(`${tastyBase(c)}/oauth/token`, { method: 'POST', json: { grant_type: 'refresh_token', refresh_token: c.refreshToken, client_secret: c.clientSecret } })).data;
    c.access = d.access_token; c.accessExp = now() + (d.expires_in || 900) * 1000;
    if (save) await save(c);
    return c.access;
  },
  async hdr(c, save) { return { Authorization: `Bearer ${await this.token(c, save)}` }; },
  async connect(body) {
    const c = { clientSecret: String(body.clientSecret || '').trim(), refreshToken: String(body.refreshToken || '').trim(), sandbox: !!body.sandbox };
    if (!c.clientSecret || !c.refreshToken) throw bad('Paste the client secret and the refresh token');
    const d = (await http(`${tastyBase(c)}/customers/me/accounts`, { headers: await this.hdr(c) })).data;
    const a = arr(d?.data?.items)[0]?.account;
    if (!a?.['account-number']) throw bad('No tastytrade account found for this grant');
    return { ...c, account: a['account-number'], live: !c.sandbox };
  },
  async summary(c, save) {
    const h = await this.hdr(c, save);
    const [b, p] = await Promise.all([http(`${tastyBase(c)}/accounts/${c.account}/balances`, { headers: h }), http(`${tastyBase(c)}/accounts/${c.account}/positions`, { headers: h })]);
    const bal = b.data?.data || {};
    const positions = arr(p.data?.data?.items).map(x => { const q = +x.quantity * (x['quantity-direction'] === 'Short' ? -1 : 1), price = +x['close-price'] || +x['average-open-price']; return pos(x.symbol, q, +x['average-open-price'], price); });
    return { equity: +bal['net-liquidating-value'] || 0, cash: +bal['cash-balance'] || 0, buyingPower: +bal['equity-buying-power'] || 0, positions };
  },
  async orders(c, save) {
    const d = (await http(`${tastyBase(c)}/accounts/${c.account}/orders/live`, { headers: await this.hdr(c, save) })).data;
    return arr(d?.data?.items).map(o => ({ id: String(o.id), symbol: o['underlying-symbol'] || o.legs?.[0]?.symbol, side: /Buy/.test(o.legs?.[0]?.action) ? 'buy' : 'sell', qty: +o.size || +o.legs?.[0]?.quantity, status: o.status, price: null, at: o['received-at'] }));
  },
  async place(c, o, save) {
    const action = { buy: 'Buy to Open', sell: 'Sell to Close', sell_short: 'Sell to Open', buy_to_cover: 'Buy to Close' }[o.side];
    const d = (await http(`${tastyBase(c)}/accounts/${c.account}/orders`, { method: 'POST', headers: await this.hdr(c, save), json: { 'time-in-force': 'Day', 'order-type': 'Market', legs: [{ 'instrument-type': 'Equity', symbol: o.symbol, quantity: o.qty, action }] } })).data;
    return { id: String(d?.data?.order?.id ?? ''), status: d?.data?.order?.status || 'Received' };
  },
};

// ---------- OAuth brokers (redirect flow) ----------
const states = new Map(); // state -> { userId, broker, at, opts }
function oauthState(userId, broker, opts = {}) {
  for (const [k, v] of states) if (now() - v.at > 10 * 60e3) states.delete(k);
  const s = crypto.randomBytes(24).toString('base64url');
  states.set(s, { userId, broker, at: now(), opts });
  return s;
}
export function takeState(s) { const v = states.get(s); states.delete(s); return v && now() - v.at < 10 * 60e3 ? v : null; }

// ---------- Schwab ----------
const schwabAuth = () => env('SCHWAB_AUTH_URL') || 'https://api.schwabapi.com/v1/oauth';
const schwabBase = () => env('SCHWAB_BASE_URL') || 'https://api.schwabapi.com/trader/v1';
const schwabBasic = () => 'Basic ' + Buffer.from(`${env('SCHWAB_APP_KEY')}:${env('SCHWAB_APP_SECRET')}`).toString('base64');
const schwab = {
  id: 'schwab', name: 'Charles Schwab', kind: 'oauth', shorts: true,
  about: 'Your Schwab brokerage account (stocks and ETFs). You sign in at Schwab; Schwab asks you to sign in again every 7 days.',
  enabled: () => !!(env('SCHWAB_APP_KEY') && env('SCHWAB_APP_SECRET')),
  startUrl(userId) {
    const p = new URLSearchParams({ client_id: env('SCHWAB_APP_KEY'), redirect_uri: `${appUrl()}/oauth/schwab/callback`, response_type: 'code', state: oauthState(userId, 'schwab') });
    return `${schwabAuth()}/authorize?${p}`;
  },
  async exchange(code) {
    const d = (await http(`${schwabAuth()}/token`, { method: 'POST', headers: { Authorization: schwabBasic() }, form: { grant_type: 'authorization_code', code, redirect_uri: `${appUrl()}/oauth/schwab/callback` } })).data;
    const c = { access: d.access_token, accessExp: now() + (d.expires_in || 1800) * 1000, refresh: d.refresh_token, refreshExp: now() + 7 * 86400e3, live: true };
    const accts = (await http(`${schwabBase()}/accounts/accountNumbers`, { headers: { Authorization: `Bearer ${c.access}` } })).data;
    if (!arr(accts)[0]?.hashValue) throw bad('No Schwab account was shared');
    return { ...c, account: accts[0].hashValue, accountNumber: String(accts[0].accountNumber).slice(-4) };
  },
  async token(c, save) {
    if (c.access && c.accessExp > now() + 30e3) return c.access;
    if (c.refreshExp && c.refreshExp < now()) throw bad('Your Schwab sign-in expired (Schwab requires it every 7 days). Connect Schwab again.', 409);
    const d = (await http(`${schwabAuth()}/token`, { method: 'POST', headers: { Authorization: schwabBasic() }, form: { grant_type: 'refresh_token', refresh_token: c.refresh } })).data;
    c.access = d.access_token; c.accessExp = now() + (d.expires_in || 1800) * 1000; if (d.refresh_token) c.refresh = d.refresh_token;
    if (save) await save(c);
    return c.access;
  },
  async summary(c, save) {
    const d = (await http(`${schwabBase()}/accounts/${c.account}?fields=positions`, { headers: { Authorization: `Bearer ${await this.token(c, save)}` } })).data;
    const a = d.securitiesAccount || {}, b = a.currentBalances || {};
    const positions = arr(a.positions).map(x => { const q = (+x.longQuantity || 0) - (+x.shortQuantity || 0); return pos(x.instrument?.symbol, q, +x.averagePrice, q ? +x.marketValue / q : +x.averagePrice); });
    return { equity: +b.liquidationValue || 0, cash: +(b.cashBalance ?? b.cashAvailableForTrading) || 0, buyingPower: +(b.buyingPower ?? b.cashAvailableForTrading) || 0, positions };
  },
  async orders(c, save) {
    const to = new Date(), from = new Date(now() - 30 * 86400e3);
    const d = (await http(`${schwabBase()}/accounts/${c.account}/orders?fromEnteredTime=${from.toISOString()}&toEnteredTime=${to.toISOString()}`, { headers: { Authorization: `Bearer ${await this.token(c, save)}` } })).data;
    return arr(d).slice(0, 50).map(o => ({ id: String(o.orderId), symbol: o.orderLegCollection?.[0]?.instrument?.symbol, side: /BUY/.test(o.orderLegCollection?.[0]?.instruction) ? 'buy' : 'sell', qty: +o.quantity, status: String(o.status).toLowerCase(), price: null, at: o.enteredTime }));
  },
  async place(c, o, save) {
    const instruction = { buy: 'BUY', sell: 'SELL', sell_short: 'SELL_SHORT', buy_to_cover: 'BUY_TO_COVER' }[o.side];
    const r = await http(`${schwabBase()}/accounts/${c.account}/orders`, { method: 'POST', headers: { Authorization: `Bearer ${await this.token(c, save)}` }, json: { orderType: 'MARKET', session: 'NORMAL', duration: 'DAY', orderStrategyType: 'SINGLE', orderLegCollection: [{ instruction, quantity: o.qty, instrument: { symbol: o.symbol, assetType: 'EQUITY' } }] } });
    return { id: (r.headers.get('location') || '').split('/').pop() || null, status: 'accepted' };
  },
};

// ---------- TradeStation ----------
const tsAuth = () => env('TRADESTATION_AUTH_URL') || 'https://signin.tradestation.com';
const tsBase = c => env('TRADESTATION_BASE_URL') || (c.sim ? 'https://sim-api.tradestation.com/v3' : 'https://api.tradestation.com/v3');
const tradestation = {
  id: 'tradestation', name: 'TradeStation', kind: 'oauth', shorts: true,
  about: 'Stocks and ETFs at TradeStation, live or in its simulator. You sign in at TradeStation.',
  enabled: () => !!(env('TRADESTATION_CLIENT_ID') && env('TRADESTATION_CLIENT_SECRET')),
  startUrl(userId, opts = {}) {
    const p = new URLSearchParams({ response_type: 'code', client_id: env('TRADESTATION_CLIENT_ID'), audience: 'https://api.tradestation.com', redirect_uri: `${appUrl()}/oauth/tradestation/callback`, scope: 'openid offline_access profile MarketData ReadAccount Trade', state: oauthState(userId, 'tradestation', opts) });
    return `${tsAuth()}/authorize?${p}`;
  },
  async exchange(code, opts = {}) {
    const d = (await http(`${tsAuth()}/oauth/token`, { method: 'POST', form: { grant_type: 'authorization_code', client_id: env('TRADESTATION_CLIENT_ID'), client_secret: env('TRADESTATION_CLIENT_SECRET'), code, redirect_uri: `${appUrl()}/oauth/tradestation/callback` } })).data;
    const c = { access: d.access_token, accessExp: now() + (d.expires_in || 1200) * 1000, refresh: d.refresh_token, sim: !!opts.sim, live: !opts.sim };
    const a = (await http(`${tsBase(c)}/brokerage/accounts`, { headers: { Authorization: `Bearer ${c.access}` } })).data;
    const acct = arr(a?.Accounts).find(x => /Cash|Margin/i.test(x.AccountType)) || arr(a?.Accounts)[0];
    if (!acct) throw bad('No TradeStation account was shared');
    return { ...c, account: acct.AccountID };
  },
  async token(c, save) {
    if (c.access && c.accessExp > now() + 30e3) return c.access;
    const d = (await http(`${tsAuth()}/oauth/token`, { method: 'POST', form: { grant_type: 'refresh_token', client_id: env('TRADESTATION_CLIENT_ID'), client_secret: env('TRADESTATION_CLIENT_SECRET'), refresh_token: c.refresh } })).data;
    c.access = d.access_token; c.accessExp = now() + (d.expires_in || 1200) * 1000; if (d.refresh_token) c.refresh = d.refresh_token;
    if (save) await save(c);
    return c.access;
  },
  async summary(c, save) {
    const h = { Authorization: `Bearer ${await this.token(c, save)}` };
    const [b, p] = await Promise.all([http(`${tsBase(c)}/brokerage/accounts/${c.account}/balances`, { headers: h }), http(`${tsBase(c)}/brokerage/accounts/${c.account}/positions`, { headers: h })]);
    const bal = arr(b.data?.Balances)[0] || {};
    const positions = arr(p.data?.Positions).map(x => { const q = +x.Quantity * (x.LongShort === 'Short' ? -1 : 1); return pos(x.Symbol, q, +x.AveragePrice, +x.Last || +x.AveragePrice); });
    return { equity: +bal.Equity || 0, cash: +bal.CashBalance || 0, buyingPower: +bal.BuyingPower || 0, positions };
  },
  async orders(c, save) {
    const d = (await http(`${tsBase(c)}/brokerage/accounts/${c.account}/orders`, { headers: { Authorization: `Bearer ${await this.token(c, save)}` } })).data;
    return arr(d?.Orders).slice(0, 50).map(o => ({ id: String(o.OrderID), symbol: o.Legs?.[0]?.Symbol, side: /BUY/i.test(o.Legs?.[0]?.BuyOrSell || o.Legs?.[0]?.TradeAction) ? 'buy' : 'sell', qty: +o.Legs?.[0]?.QuantityOrdered, status: o.StatusDescription || o.Status, price: +o.FilledPrice || null, at: o.OpenedDateTime }));
  },
  async place(c, o, save) {
    const TradeAction = { buy: 'BUY', sell: 'SELL', sell_short: 'SELLSHORT', buy_to_cover: 'BUYTOCOVER' }[o.side];
    const d = (await http(`${tsBase(c)}/orderexecution/orders`, { method: 'POST', headers: { Authorization: `Bearer ${await this.token(c, save)}` }, json: { AccountID: c.account, Symbol: o.symbol, Quantity: String(o.qty), OrderType: 'Market', TradeAction, TimeInForce: { Duration: 'DAY' }, Route: 'Intelligent' } })).data;
    const r = arr(d?.Orders)[0] || {};
    if (r.Error) throw bad(r.Message || 'TradeStation rejected the order');
    return { id: String(r.OrderID || ''), status: 'submitted' };
  },
};

export const EXT = { tradier, tastytrade: tasty, schwab, tradestation };
export const EXT_IDS = Object.keys(EXT);
export const extName = id => EXT[id]?.name || id;

// Public list for the Brokerages page.
export const catalog = () => Object.values(EXT).map(b => ({ id: b.id, name: b.name, kind: b.kind, about: b.about, fields: b.fields || [], available: b.kind === 'token' || b.enabled() }));

// Calls an adapter method with the user's stored credentials; refreshed tokens are saved back.
export async function withExt(userId, id, fn) {
  const b = EXT[id];
  if (!b) throw bad('Unknown brokerage');
  const c = await getExtCred(userId, id);
  if (!c) throw bad(`Connect ${b.name} first (Brokerages page)`, 409);
  return fn(b, c, v => saveExtCred(userId, id, v));
}
