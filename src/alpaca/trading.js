// Trading API v2 behind one interface for all three ways a user can connect:
//   keys   - their own Alpaca API key (APCA-API-KEY-ID / APCA-API-SECRET-KEY headers)
//   oauth  - an OAuth2 access token for their existing Alpaca account (Bearer)
//   broker - an account this platform opened through the Broker API; its trading endpoints
//            live under /v1/trading/accounts/{id} and use the broker's Basic auth.
import { URLS, request } from './http.js';
import { brokerAuth } from './broker.js';

const enc = encodeURIComponent;

export class Trading {
  constructor(conn) {
    this.conn = conn;
    this.type = conn.type;
    // Broker accounts are live only against the production Broker API host.
    this.live = conn.type === 'broker' ? new URL(URLS.broker()).hostname === 'broker-api.alpaca.markets' : !!conn.live;
  }

  // Account-scoped resources (account, orders, positions, watchlists, portfolio history).
  acct(path, opts = {}) {
    const c = this.conn;
    if (c.type === 'broker') return request(URLS.broker(), `/v1/trading/accounts/${enc(c.accountId)}${path}`, { ...opts, auth: brokerAuth() });
    return request(URLS.trading(c.live), '/v2' + path, { ...opts, auth: c.type === 'oauth' ? { bearer: c.token } : { keys: [c.k, c.s] } });
  }
  // Market-wide resources (clock, calendar, assets, option contracts, corporate actions).
  global(path, opts = {}) {
    const c = this.conn;
    if (c.type === 'broker') return request(URLS.broker(), '/v1' + path, { ...opts, auth: brokerAuth() });
    return request(URLS.trading(c.live), '/v2' + path, { ...opts, auth: c.type === 'oauth' ? { bearer: c.token } : { keys: [c.k, c.s] } });
  }

  account() { return this.acct('/account'); }
  configurations() { return this.acct('/account/configurations'); }
  updateConfigurations(body) { return this.acct('/account/configurations', { method: 'PATCH', body }); }

  orders(query) { return this.acct('/orders', { query: { status: 'all', limit: 100, nested: true, ...query } }); }
  order(id) { return this.acct(`/orders/${enc(id)}`, { query: { nested: true } }); }
  placeOrder(body) { return this.acct('/orders', { method: 'POST', body }); }
  replaceOrder(id, body) { return this.acct(`/orders/${enc(id)}`, { method: 'PATCH', body }); }
  cancelOrder(id) { return this.acct(`/orders/${enc(id)}`, { method: 'DELETE' }); }
  cancelAllOrders() { return this.acct('/orders', { method: 'DELETE' }); }

  positions() { return this.acct('/positions'); }
  position(symbol) { return this.acct(`/positions/${enc(symbol)}`); }
  // Full close by default; pass { qty } or { percentage } for a partial close.
  closePosition(symbol, query) { return this.acct(`/positions/${enc(symbol)}`, { method: 'DELETE', query }); }
  closeAllPositions(cancelOrders = true) { return this.acct('/positions', { method: 'DELETE', query: { cancel_orders: cancelOrders } }); }
  exerciseOption(symbol) { return this.acct(`/positions/${enc(symbol)}/exercise`, { method: 'POST' }); }

  portfolioHistory(query) { return this.acct('/account/portfolio/history', { query }); }

  watchlists() { return this.acct('/watchlists'); }
  watchlist(id) { return this.acct(`/watchlists/${enc(id)}`); }
  createWatchlist(name, symbols = []) { return this.acct('/watchlists', { method: 'POST', body: { name, symbols } }); }
  updateWatchlist(id, body) { return this.acct(`/watchlists/${enc(id)}`, { method: 'PUT', body }); }
  deleteWatchlist(id) { return this.acct(`/watchlists/${enc(id)}`, { method: 'DELETE' }); }
  addToWatchlist(id, symbol) { return this.acct(`/watchlists/${enc(id)}`, { method: 'POST', body: { symbol } }); }
  removeFromWatchlist(id, symbol) { return this.acct(`/watchlists/${enc(id)}/${enc(symbol)}`, { method: 'DELETE' }); }

  clock() { return this.global('/clock'); }
  calendar(query) { return this.global('/calendar', { query }); }
  assets(query) { return this.global('/assets', { query }); }
  asset(symbol) { return this.global(`/assets/${enc(symbol)}`); }
  optionContracts(query) { return this.global('/options/contracts', { query }); }
  announcements(query) { return this.global('/corporate_actions/announcements', { query }); }
}

// ---------- order building and validation ----------

const TYPES = ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop'];
const TIFS = ['day', 'gtc', 'opg', 'cls', 'ioc', 'fok'];
const num = v => (v === undefined || v === null || v === '' ? undefined : Number(v));
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const price = (v, name) => { const n = num(v); if (n === undefined) throw bad(`${name} is required for this order type`); if (!(n > 0)) throw bad(`${name} must be positive`); return String(n); };

// OCC option symbol, e.g. AAPL250117C00150000.
export const isOptionSymbol = s => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(s);
export const isCryptoSymbol = s => /^[A-Z0-9]{2,10}\/[A-Z]{3,4}$/.test(s);

// Turns the order ticket into an Alpaca order body, enforcing the rules each asset class has
// (crypto: gtc/ioc and no shorting; options: whole contracts, day orders, market/limit).
export function buildOrder(f) {
  const o = {};
  const cls = f.order_class || 'simple';
  if (!['simple', 'bracket', 'oco', 'oto', 'mleg'].includes(cls)) throw bad('Unknown order class');
  const type = f.type || 'market';
  if (!TYPES.includes(type)) throw bad('Unknown order type');
  const tif = f.time_in_force || 'day';
  if (!TIFS.includes(tif)) throw bad('Unknown time in force');
  o.type = type; o.time_in_force = tif;
  o.client_order_id = 'qp-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  if (cls === 'mleg') {
    const legs = (f.legs || []).filter(l => l && l.symbol);
    if (legs.length < 2 || legs.length > 4) throw bad('Multi-leg orders need 2 to 4 legs');
    o.order_class = 'mleg';
    o.qty = String(Math.trunc(num(f.qty) || 0));
    if (!(+o.qty > 0)) throw bad('Quantity must be a whole number of spreads');
    if (!['market', 'limit'].includes(type)) throw bad('Multi-leg orders can be market or limit');
    if (type === 'limit') o.limit_price = String(num(f.limit_price)); // may be negative for a credit
    if (type === 'limit' && !Number.isFinite(+o.limit_price)) throw bad('Limit price is required');
    o.time_in_force = 'day';
    o.legs = legs.map(l => {
      const sym = String(l.symbol).toUpperCase();
      if (!isOptionSymbol(sym)) throw bad(`Leg ${sym} is not an option contract symbol`);
      const ratio = Math.trunc(num(l.ratio_qty) || 1);
      if (!['buy', 'sell'].includes(l.side)) throw bad('Each leg needs a side');
      const leg = { symbol: sym, ratio_qty: String(ratio), side: l.side };
      if (l.position_intent) leg.position_intent = l.position_intent;
      return leg;
    });
    return o;
  }

  const symbol = String(f.symbol || '').trim().toUpperCase();
  if (!symbol) throw bad('Symbol is required');
  o.symbol = symbol;
  o.side = f.side === 'sell' ? 'sell' : 'buy';
  const qty = num(f.qty), notional = num(f.notional);
  if (qty !== undefined) { if (!(qty > 0)) throw bad('Quantity must be positive'); o.qty = String(qty); }
  else if (notional !== undefined) { if (!(notional > 0)) throw bad('Amount must be positive'); o.notional = notional.toFixed(2); }
  else throw bad('Enter a quantity or a dollar amount');

  if (type === 'limit' || type === 'stop_limit') o.limit_price = price(f.limit_price, 'Limit price');
  if (type === 'stop' || type === 'stop_limit') o.stop_price = price(f.stop_price, 'Stop price');
  if (type === 'trailing_stop') {
    if (num(f.trail_percent) !== undefined) o.trail_percent = price(f.trail_percent, 'Trail percent');
    else o.trail_price = price(f.trail_price, 'Trail amount');
  }
  if (f.extended_hours) {
    if (type !== 'limit' || tif !== 'day') throw bad('Extended hours needs a limit order with time in force DAY');
    o.extended_hours = true;
  }

  if (isCryptoSymbol(symbol)) {
    if (!['market', 'limit', 'stop_limit'].includes(type)) throw bad('Crypto supports market, limit and stop limit orders');
    if (!['gtc', 'ioc'].includes(tif)) o.time_in_force = 'gtc';
    if (cls !== 'simple') throw bad('Bracket orders are not available for crypto');
    return o;
  }
  if (isOptionSymbol(symbol)) {
    if (!['market', 'limit', 'stop', 'stop_limit'].includes(type)) throw bad('Options support market, limit, stop and stop limit orders');
    if (o.notional || !Number.isInteger(+o.qty)) throw bad('Options trade in whole contracts');
    o.time_in_force = 'day';
    if (f.position_intent) o.position_intent = f.position_intent;
    if (cls !== 'simple') throw bad('Use a multi-leg order for option spreads');
    return o;
  }

  if (cls === 'bracket' || cls === 'oco' || cls === 'oto') {
    if (o.notional) throw bad('Bracket, OCO and OTO orders need a share quantity');
    if (!['day', 'gtc'].includes(tif)) throw bad('Bracket orders use DAY or GTC');
    o.order_class = cls;
    const tp = num(f.take_profit_price), sl = num(f.stop_loss_price), sll = num(f.stop_loss_limit_price);
    if (cls === 'bracket' && (tp === undefined || sl === undefined)) throw bad('A bracket needs both a take-profit and a stop-loss price');
    if (cls === 'oco' && (tp === undefined || sl === undefined)) throw bad('An OCO order needs both a take-profit and a stop-loss price');
    if (cls === 'oto' && tp === undefined && sl === undefined) throw bad('An OTO order needs a take-profit or a stop-loss price');
    if (tp !== undefined) o.take_profit = { limit_price: price(tp, 'Take-profit price') };
    if (sl !== undefined) o.stop_loss = { stop_price: price(sl, 'Stop-loss price'), ...(sll !== undefined ? { limit_price: price(sll, 'Stop-loss limit') } : {}) };
    const ref = num(f.limit_price) ?? num(f.ref_price);
    if (cls === 'bracket' && ref && tp && sl) {
      if (o.side === 'buy' && !(tp > ref && sl < ref)) throw bad('For a buy bracket, take-profit must be above and stop-loss below the entry price');
      if (o.side === 'sell' && !(tp < ref && sl > ref)) throw bad('For a sell bracket, take-profit must be below and stop-loss above the entry price');
    }
  }
  return o;
}

// Only fields Alpaca allows on PATCH /orders/{id}.
export function buildReplace(f) {
  const o = {};
  for (const k of ['qty', 'limit_price', 'stop_price', 'trail']) if (num(f[k]) !== undefined) { if (!(num(f[k]) > 0)) throw bad(`${k} must be positive`); o[k] = String(num(f[k])); }
  if (f.time_in_force) { if (!TIFS.includes(f.time_in_force)) throw bad('Unknown time in force'); o.time_in_force = f.time_in_force; }
  if (!Object.keys(o).length) throw bad('Nothing to change');
  return o;
}
