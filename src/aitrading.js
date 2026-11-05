// The AI assistant's trading tools, in plain words:
//   live_quote          the price right now (with bid and ask when the feed has them), the market's
//                       open/closed state, and how much of it the user holds in the chosen account
//   price_history       how the price moved over a period (start, end, change, high, low, points)
//   prepare_paper_order an order for PRACTICE money, shown to the user as a card; it is sent only
//                       when the user presses "Place paper order". Goes to the user's Alpaca paper
//                       account through Alpaca's Trading API when one is connected (stocks, ETFs,
//                       crypto and options), otherwise to the Brightolio practice account
//   paper_orders        recent practice orders: status, how much filled and at what price
//   paper_buying_power  cash and buying power in the practice account
//   live_balances       read only: balances and positions of the user's real-money accounts
//   prepare_live_order  Ultimate plan, once the user turned it on (Assistant → Real-money orders):
//                       a REAL order shown as a card; placed only when the user presses
//                       "Place real order" and confirms, within the per-order limit they set
// Without that setting the assistant never places real-money orders.
import express from 'express';
import { one, audit } from './db.js';
import { requireUser, confirmsIdentity } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { getBars, lastPrice, accountSummary, listOrders, placeOrder } from './brokers.js';
import { tradingFor } from './alpaca/connections.js';
import { isOptionSymbol, isCryptoSymbol } from './alpaca/trading.js';
import { quoteAt } from './execution.js';
import { session } from './desk.js';
import * as DS from './datasources.js';
import { mayShareAccount } from './aiaccess.js';
import { provider } from './llm.js';

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const sym = s => String(s || '').trim().toUpperCase().replace(/^([A-Z]{2,6})USD$/, '$1/USD');
const assetClass = s => (isOptionSymbol(s) ? 'option' : isCryptoSymbol(s) ? 'crypto' : 'stock or ETF');
const r2 = x => (x == null || !Number.isFinite(+x) ? null : Math.round(+x * 100) / 100);
const PERIODS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '5Y': 1827 };

// Where practice orders go: the user's Alpaca paper account when connected, else the built-in one.
export async function paperDestination(userId) {
  const t = await tradingFor(userId).catch(() => null);
  if (t && !t.live) return { kind: 'alpaca', t, name: 'your Alpaca paper account' };
  return { kind: 'builtin', name: 'your Brightolio practice account' };
}

// Checks an order for practice money and fills in the defaults. Returns a clean order.
export function cleanPaperOrder(o, kind) {
  const symbol = sym(o.symbol), side = o.side === 'sell' ? 'sell' : o.side === 'buy' ? 'buy' : null;
  if (!/^[A-Z0-9./]{1,21}$/.test(symbol)) throw bad('Check the symbol');
  if (!side) throw bad('Say buy or sell');
  const cls = assetClass(symbol), type = ['market', 'limit', 'stop', 'stop_limit'].includes(o.type) ? o.type : 'market';
  const qty = +o.qty > 0 ? +o.qty : null, dollars = +o.dollars > 0 ? +o.dollars : null;
  if (!qty && !dollars) throw bad('Say how many shares, or how many dollars');
  if (qty && dollars) throw bad('Use shares or dollars, not both');
  const limit = +o.limit_price > 0 ? +o.limit_price : null, stop = +o.stop_price > 0 ? +o.stop_price : null;
  if ((type === 'limit' || type === 'stop_limit') && !limit) throw bad('A limit order needs a limit price');
  if ((type === 'stop' || type === 'stop_limit') && !stop) throw bad('A stop order needs a stop price');
  if (cls === 'option') {
    if (kind !== 'alpaca') throw bad('Practice options trades need an Alpaca paper account. Connect one on the Account page.');
    if (!qty || !Number.isInteger(qty)) throw bad('Options trade in whole contracts');
    if (!['market', 'limit'].includes(type)) throw bad('Options orders can be market or limit');
  }
  if (dollars && type !== 'market') throw bad('Dollar amounts work with market orders; for a limit or stop order give the number of shares');
  if (qty && qty > 1e6) throw bad('That is too many shares');
  if (dollars && dollars > 1e7) throw bad('That amount is too large');
  const tif = cls === 'crypto' ? (o.time_in_force === 'ioc' ? 'ioc' : 'gtc') : o.time_in_force === 'gtc' ? 'gtc' : 'day';
  return { symbol, side, type, qty, dollars, limit_price: limit, stop_price: stop, time_in_force: tif, assetClass: cls };
}
const describe = (o, dest) => `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.dollars ? `$${o.dollars.toLocaleString('en-US')} of` : `${o.qty} ${o.assetClass === 'option' ? 'contract' + (o.qty === 1 ? '' : 's') : o.assetClass === 'crypto' ? '' : 'share' + (o.qty === 1 ? '' : 's') + ' of'}`} ${o.symbol}`.replace(/\s+/g, ' ')
  + `, ${{ market: 'at the current price (market order)', limit: `only at $${o.limit_price} or better (limit order)`, stop: `when the price reaches $${o.stop_price} (stop order)`, stop_limit: `when it reaches $${o.stop_price}, at $${o.limit_price} or better (stop limit order)` }[o.type]}`
  + `${o.type !== 'market' ? `, good ${o.time_in_force === 'gtc' ? 'until cancelled' : 'for today'}` : ''}. Practice money, in ${dest.name}.`;

// Sends a confirmed practice order.
export async function placePaper(user, input, ip) {
  const dest = await paperDestination(user.id), o = cleanPaperOrder(input, dest.kind);
  if (dest.kind === 'alpaca') {
    const { placeAlpacaOrder } = await import('./routes/alpaca.js');
    const r = await placeAlpacaOrder(user, dest.t, { symbol: o.symbol, side: o.side, type: o.type, time_in_force: o.time_in_force, ...(o.qty ? { qty: o.qty } : { notional: o.dollars }), ...(o.limit_price ? { limit_price: o.limit_price } : {}), ...(o.stop_price ? { stop_price: o.stop_price } : {}) }, { ip, source: 'ai' });
    return { destination: dest.name, id: r.id, symbol: r.symbol, status: r.status, filledQty: +r.filled_qty || 0, avgPrice: +r.filled_avg_price || null };
  }
  if (o.type !== 'market') {
    const { place } = await import('./paperorders.js');
    const r = await place(user.id, { symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, limit_price: o.limit_price, stop_price: o.stop_price, time_in_force: o.time_in_force });
    await audit(user.id, 'paper_order', { id: r.id, type: r.type, status: r.status, source: 'ai' }, ip);
    return { destination: dest.name, id: r.id, symbol: r.symbol, status: r.status === 'filled' ? 'filled' : 'open (waiting for its price)', filledQty: r.status === 'filled' ? r.qty : 0, avgPrice: r.fillPrice || null };
  }
  const r = await placeOrder(user.id, 'paper', { symbol: o.symbol, side: o.side, ...(o.qty ? { qty: o.qty } : { notional: o.dollars }) }, 'ai');
  await audit(user.id, 'order', { ...r, source: 'ai' }, ip);
  return { destination: dest.name, symbol: o.symbol, status: 'filled', filledQty: r.qty, avgPrice: r.price };
}

async function holdingIn(userId, account, symbol) {
  if (account === 'paper') { const p = await one("SELECT qty, avg_price FROM positions WHERE user_id = ? AND account = 'paper' AND symbol = ?", userId, symbol); return p ? { qty: p.qty, avgPrice: r2(p.avg_price) } : { qty: 0 }; }
  const s = await accountSummary(userId, account).catch(() => null);
  const p = s?.positions?.find(x => x.symbol === symbol || x.symbol === symbol.replace('/', ''));
  return p ? { qty: p.qty, avgPrice: r2(p.avgPrice), value: r2(p.value), gainOrLoss: r2(p.pnl) } : { qty: 0 };
}

// ---------- real-money orders from the chat (Ultimate) ----------
export const LIVE_DEFAULTS = { enabled: false, maxOrder: 1000, account: null };
const ultimate = u => (u.role === 'admin' && !u.previewPlan) || (u.plan === 'ultimate' && ['active', 'trialing', null, undefined].includes(u.plan_status));
export async function liveSettings(user) { return { ...LIVE_DEFAULTS, ...((await getSetting(user.id, 'aiLiveOrders', {})) || {}), allowed: ultimate(user) }; }
async function liveAccounts(userId) {
  const { accountsFor } = await import('./ext/routes.js');
  return (await accountsFor(userId)).filter(a => a.connected && a.live);
}
// Places a confirmed real-money order: same checks as the Trade page, plus the user's limit.
export async function placeLive(user, input, ip) {
  const st = await liveSettings(user);
  if (!st.allowed) throw bad('Real-money orders from the assistant are part of the Ultimate plan', 402);
  if (!st.enabled) throw bad('Turn on real-money orders in the assistant first');
  const accounts = await liveAccounts(user.id), account = input.account || st.account || accounts[0]?.id;
  const acct = accounts.find(a => a.id === account);
  if (!acct) throw bad('That real-money account is not connected');
  const o = cleanPaperOrder(input, /^alpaca/.test(account) ? 'alpaca' : 'other');
  const px = o.limit_price || o.stop_price || await lastPrice(o.symbol, user.id).catch(() => null);
  const value = o.dollars || (px ? o.qty * px * (o.assetClass === 'option' ? 100 : 1) : null);
  if (!value) throw bad('Could not price this order; try again in a moment');
  if (value > st.maxOrder + 0.01) throw bad(`This order is about $${Math.round(value).toLocaleString('en-US')}, above your limit of $${st.maxOrder.toLocaleString('en-US')} per order from the assistant`);
  let r;
  if (/^alpaca/.test(account)) {
    const { tradingForAccount } = await import('./alpaca/connections.js'), { placeAlpacaOrder } = await import('./routes/alpaca.js');
    const t = await tradingForAccount(user.id, account);
    if (!t?.live) throw bad('That Alpaca account is not a real-money account');
    const x = await placeAlpacaOrder(user, t, { symbol: o.symbol, side: o.side, type: o.type, time_in_force: o.time_in_force, ...(o.qty ? { qty: o.qty } : { notional: o.dollars }), ...(o.limit_price ? { limit_price: o.limit_price } : {}), ...(o.stop_price ? { stop_price: o.stop_price } : {}) }, { ip, source: 'ai-live' });
    r = { id: x.id, status: x.status, filledQty: +x.filled_qty || 0, avgPrice: +x.filled_avg_price || null };
  } else {
    if (o.type !== 'market') throw bad('From the assistant, this brokerage takes market orders; use the Trade page for other types');
    const x = await placeOrder(user.id, account, { symbol: o.symbol, side: o.side, ...(o.qty ? { qty: o.qty } : { notional: o.dollars }) }, 'ai-live');
    r = { status: x.status || 'sent', filledQty: x.qty || 0, avgPrice: x.price || null };
  }
  await audit(user.id, 'ai_live_order', { account, symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, dollars: o.dollars, value: Math.round(value), status: r.status }, ip);
  return { destination: acct.name, symbol: o.symbol, ...r };
}

export function tradingTools(user, ctx) {
  const share = () => mayShareAccount(provider());
  const hidden = { note: 'The owner keeps account numbers away from this AI service (Admin → AI & privacy). The user can see them in the app.' };
  return {
    live_quote: {
      description: 'The price right now for a stock, ETF or crypto (like AAPL, SPY, BTC/USD), with bid and ask when available, whether the market is open, and how much the user owns in the chosen account (paper, alpaca, or a connected account id).',
      schema: { symbol: { type: 'string' }, account: { type: 'string' } }, required: ['symbol'],
      run: async ({ symbol, account = 'paper' }) => {
        const s = sym(symbol);
        let q = null; try { q = await DS.quote(s, user.id); } catch (e) { if (e.status === 404) return { error: `Unknown symbol ${s}` }; }
        const price = q?.price ?? await lastPrice(s, user.id).catch(() => null);
        const nb = await quoteAt(s, price).catch(() => null), m = session();
        return { symbol: s, kind: assetClass(s), price: r2(price), bid: r2(nb?.bid), ask: r2(nb?.ask), quoteFeed: nb?.feed || null, priceSource: q ? (DS.PROVIDERS[q.source]?.name || q.source) : 'last known price',
          market: s.includes('/') ? 'crypto trades around the clock' : m.open ? 'open' : m.status, youOwn: share() ? await holdingIn(user.id, account, s) : undefined, account };
      },
    },
    price_history: {
      description: 'How the price moved over a period: 1M, 3M, 6M, 1Y or 5Y. Gives the start and end price, the change in percent, the high and low, and up to 40 points to describe the trend.',
      schema: { symbol: { type: 'string' }, period: { type: 'string', enum: Object.keys(PERIODS) } }, required: ['symbol'],
      run: async ({ symbol, period = '1Y' }) => {
        const s = sym(symbol), days = PERIODS[period] || 366;
        // The bar source needs a long window; fetch enough and keep the period asked for.
        const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
        const b = await getBars(s, new Date(Date.now() - Math.max(days, 730) * 864e5).toISOString().slice(0, 10), user.id);
        const keep = (b.dates || []).findIndex(x => String(x).slice(0, 10) >= from), k = keep < 0 ? 0 : keep;
        const c = (b.closes || []).slice(k), d = (b.dates || []).slice(k);
        if (!c.length) return { symbol: s, error: 'No price history found' };
        const step = Math.max(1, Math.ceil(c.length / 40));
        return { symbol: s, period, from: d[0], to: d.at(-1), startPrice: r2(c[0]), endPrice: r2(c.at(-1)), changePercent: r2((c.at(-1) / c[0] - 1) * 100), high: r2(Math.max(...c)), low: r2(Math.min(...c)),
          points: c.map((v, i) => [d[i], r2(v)]).filter((_, i) => i % step === 0 || i === c.length - 1), dataSource: b.source };
      },
    },
    prepare_paper_order: {
      description: 'Prepare an order with PRACTICE money. The user sees it as a card and must press "Place paper order" to send it, so tell them to check it and press the button. Works for stocks and ETFs, crypto (BTC/USD) and, with an Alpaca paper account, options contracts. Give qty (shares, coins or contracts) or dollars (market orders only).',
      schema: { symbol: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] }, qty: { type: 'number' }, dollars: { type: 'number' }, type: { type: 'string', enum: ['market', 'limit', 'stop', 'stop_limit'] }, limit_price: { type: 'number' }, stop_price: { type: 'number' }, time_in_force: { type: 'string', enum: ['day', 'gtc'] } },
      required: ['symbol', 'side'],
      run: async a => {
        const dest = await paperDestination(user.id), o = cleanPaperOrder(a, dest.kind);
        ctx.order = { ...o, destination: dest.name, summary: describe(o, dest) };
        return { shownToUser: true, summary: ctx.order.summary, note: 'Not sent yet: the user presses the button to send it.' };
      },
    },
    paper_orders: {
      description: "The user's recent practice orders: status, how many shares filled and the average fill price. Optionally for one symbol.",
      schema: { symbol: { type: 'string' } }, required: [],
      run: async ({ symbol } = {}) => {
        const dest = await paperDestination(user.id), s = symbol ? sym(symbol) : null;
        if (dest.kind === 'alpaca') {
          const list = await dest.t.orders({ status: 'all', limit: 20, ...(s ? { symbols: s } : {}) });
          return { account: dest.name, orders: list.map(o => ({ id: o.id, symbol: o.symbol, side: o.side, type: o.type, status: o.status, qty: +o.qty || null, dollars: +o.notional || null, filledQty: +o.filled_qty || 0, avgFillPrice: r2(o.filled_avg_price), limitPrice: r2(o.limit_price), stopPrice: r2(o.stop_price), submitted: o.submitted_at })) };
        }
        const list = (await listOrders(user.id, 'paper')).filter(o => !s || o.symbol === s).slice(0, 20);
        return { account: dest.name, orders: list.map(o => ({ symbol: o.symbol, side: o.side, status: o.status, qty: o.qty, filledQty: o.status === 'filled' ? o.qty : 0, avgFillPrice: o.status === 'filled' ? r2(o.price) : null, waitingAt: o.status === 'open' ? o.source : undefined, at: o.at ? new Date(o.at).toISOString() : undefined })) };
      },
    },
    paper_buying_power: {
      description: 'How much the user can buy with practice money now: cash, buying power and total value of the practice account.',
      schema: {}, required: [],
      run: async () => {
        const dest = await paperDestination(user.id);
        if (dest.kind === 'alpaca') {
          const a = await dest.t.account();
          return { account: dest.name, cash: r2(a.cash), buyingPower: r2(a.buying_power), cryptoBuyingPower: r2(a.non_marginable_buying_power), dayTradingBuyingPower: r2(a.daytrading_buying_power), totalValue: r2(a.equity), optionsBuyingPower: r2(a.options_buying_power) };
        }
        const p = await one('SELECT cash FROM paper_accounts WHERE user_id = ?', user.id);
        const s = await accountSummary(user.id, 'paper').catch(() => null);
        return { account: dest.name, cash: r2(p?.cash), buyingPower: r2(p?.cash), totalValue: r2(s?.equity), note: 'The practice account has no margin: buying power is the cash.' };
      },
    },
    ...(ctx.live ? { prepare_live_order: {
      description: `Prepare a REAL-MONEY order in the user's real account (${ctx.live.accounts.map(a => a.name).join(', ') || 'none connected'}). The user sees it as a red card and must press "Place real order" and confirm. Only use it when the user clearly asks to trade real money. The limit is $${ctx.live.maxOrder} per order. Give qty or dollars (market orders only).`,
      schema: { symbol: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] }, qty: { type: 'number' }, dollars: { type: 'number' }, type: { type: 'string', enum: ['market', 'limit', 'stop', 'stop_limit'] }, limit_price: { type: 'number' }, stop_price: { type: 'number' }, time_in_force: { type: 'string', enum: ['day', 'gtc'] }, account: { type: 'string', description: 'Account id; leave empty for the default' } },
      required: ['symbol', 'side'],
      run: async a => {
        const account = a.account || ctx.live.account || ctx.live.accounts[0]?.id, acct = ctx.live.accounts.find(x => x.id === account);
        if (!acct) return { error: 'No real-money account is connected (or that one is not). The user can connect one on the Account page.' };
        const o = cleanPaperOrder(a, /^alpaca/.test(account) ? 'alpaca' : 'other');
        const summary = describe(o, { name: acct.name }).replace('Practice money, in', 'REAL MONEY, in');
        ctx.order = { ...o, live: true, account, destination: acct.name, summary, maxOrder: ctx.live.maxOrder };
        return { shownToUser: true, summary, note: 'Not sent yet: the user presses "Place real order" and confirms.' };
      },
    } } : {}),
    live_balances: {
      description: "Read only: the user's real-money accounts with their total value, cash, buying power and positions. The assistant cannot trade these.",
      schema: { account: { type: 'string', description: 'Optional: one account id' } }, required: [],
      run: async ({ account } = {}) => {
        if (!share()) return hidden;
        const { accountsFor } = await import('./ext/routes.js');
        const live = (await accountsFor(user.id)).filter(a => a.connected && a.live && (!account || a.id === account));
        if (!live.length) return { note: 'No real-money account is connected. The user can open or connect one on the Account page.' };
        const out = [];
        for (const a of live) {
          const s = await accountSummary(user.id, a.id).catch(e => ({ error: e.message }));
          out.push(s.error ? { account: a.name, error: s.error } : { account: a.name, totalValue: r2(s.equity), cash: r2(s.cash), buyingPower: r2(s.buyingPower ?? s.buying_power), positions: (s.positions || []).map(p => ({ symbol: p.symbol, qty: p.qty, value: r2(p.value), gainOrLoss: r2(p.pnl) })) });
        }
        return { accounts: out };
      },
    },
  };
}

// The button on the order card.
export const aiTradingRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.post('/paper-order', async (req, res) => res.json(await placePaper(req.user, req.body || {}, req.ip)));
  r.get('/live-settings', async (req, res) => res.json({ ...(await liveSettings(req.user)), accounts: (await liveAccounts(req.user.id)).map(a => ({ id: a.id, name: a.name })) }));
  r.put('/live-settings', async (req, res) => {
    const b = req.body || {}, cur = await liveSettings(req.user);
    if (!cur.allowed) throw bad('Real-money orders from the assistant are part of the Ultimate plan', 402);
    // Turning it on, or raising the limit, needs the password (or the email for accounts without one).
    const max = b.maxOrder === undefined ? cur.maxOrder : Math.round(+b.maxOrder);
    if (!(max >= 10 && max <= 1000000)) throw bad('Set a limit per order from $10 to $1,000,000');
    if ((b.enabled && !cur.enabled) || max > cur.maxOrder) { if (!confirmsIdentity(req.user, b)) throw bad(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password', 401); }
    const accounts = await liveAccounts(req.user.id), account = b.account === undefined ? cur.account : b.account || null;
    if (account && !accounts.some(a => a.id === account)) throw bad('That real-money account is not connected');
    const next = { enabled: b.enabled === undefined ? cur.enabled : !!b.enabled, maxOrder: max, account };
    await setSetting(req.user.id, 'aiLiveOrders', next);
    await audit(req.user.id, 'ai_live_settings', next, req.ip);
    res.json({ ...next, allowed: true });
  });
  r.post('/live-order', async (req, res) => res.json(await placeLive(req.user, req.body || {}, req.ip)));
  r.get('/paper-destination', async (req, res) => { const d = await paperDestination(req.user.id); res.json({ kind: d.kind, name: d.name }); });
  return r;
})();
