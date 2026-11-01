// Paper account order types beyond market: limit, stop and stop-limit, kept open until the price
// reaches them (checked every minute), Day orders expiring at the 4 PM New York close and
// Good-till-cancelled orders staying up to 90 days. A sell can never be for more shares than the
// paper account holds, counting shares already promised to other open sell orders.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { placeOrder, lastPrice, validSymbol } from './brokers.js';
import { nyTime } from './time.js';
import { orderDay, closeMin } from './desk.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const TYPES = ['limit', 'stop', 'stop_limit'];

// What happens to an order at a price: 'fill', 'trigger' (a stop-limit becomes a limit) or null.
export function evaluate(o, px) {
  const buy = o.side === 'buy';
  if (o.type === 'limit') return (buy ? px <= o.limit_price : px >= o.limit_price) ? 'fill' : null;
  const stopHit = buy ? px >= o.stop_price : px <= o.stop_price;
  if (o.type === 'stop') return stopHit ? 'fill' : null;
  if (!o.triggered) return stopHit ? ((buy ? px <= o.limit_price : px >= o.limit_price) ? 'fill' : 'trigger') : null;
  return (buy ? px <= o.limit_price : px >= o.limit_price) ? 'fill' : null;
}

async function reservedSells(userId, symbol) {
  return (await one("SELECT COALESCE(SUM(qty), 0) q FROM paper_orders WHERE user_id = ? AND symbol = ? AND side = 'sell' AND status = 'open'", userId, symbol)).q;
}
export async function place(userId, b) {
  const symbol = String(b.symbol || '').trim().toUpperCase(), side = b.side === 'sell' ? 'sell' : 'buy', type = b.type;
  if (!validSymbol(symbol)) throw bad('Check the symbol');
  if (!TYPES.includes(type)) throw bad('Pick limit, stop or stop limit');
  const qty = +b.qty; if (!(qty > 0)) throw bad('Enter how many shares (dollar amounts are for market orders)');
  const limit = +b.limit_price || null, stop = +b.stop_price || null;
  if ((type === 'limit' || type === 'stop_limit') && !(limit > 0)) throw bad('Enter the limit price');
  if ((type === 'stop' || type === 'stop_limit') && !(stop > 0)) throw bad('Enter the stop price');
  const tif = b.time_in_force === 'gtc' ? 'gtc' : 'day';
  if (side === 'sell') {
    const p = await one("SELECT qty FROM positions WHERE user_id = ? AND account = 'paper' AND symbol = ?", userId, symbol);
    const free = (p?.qty || 0) - await reservedSells(userId, symbol);
    if (qty > free + 1e-9) throw bad(p?.qty ? `You can sell up to ${+free.toFixed(6)} ${symbol} (you hold ${p.qty}${free < p.qty ? '; the rest is promised to open sell orders' : ''})` : `You hold no ${symbol} in the paper account`, 409);
  } else {
    const a = await one('SELECT cash FROM paper_accounts WHERE user_id = ?', userId);
    const px = limit || stop || await lastPrice(symbol, userId);
    if (qty * px > (a?.cash || 0) + 1e-6) throw bad(`Not enough paper cash ($${(a?.cash || 0).toFixed(2)})`, 409);
  }
  const id = Number((await run('INSERT INTO paper_orders (user_id, symbol, side, qty, type, limit_price, stop_price, tif, day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', userId, symbol, side, qty, type, limit, stop, tif, orderDay(), now())).lastInsertRowid);
  // A marketable order fills right away.
  const px = await lastPrice(symbol, userId).catch(() => null);
  if (px) await check(await one('SELECT * FROM paper_orders WHERE id = ?', id), px);
  return parse(await one('SELECT * FROM paper_orders WHERE id = ?', id));
}
async function check(o, px) {
  const r = evaluate(o, px);
  if (r === 'trigger') { await run('UPDATE paper_orders SET triggered = 1 WHERE id = ?', o.id); return 'triggered'; }
  if (r !== 'fill') return null;
  // Claim the order first so two checks can never fill it twice.
  const claim = await run("UPDATE paper_orders SET status = 'filling' WHERE id = ? AND status = 'open'", o.id);
  if (!claim.changes) return null;
  try {
    const f = await placeOrder(o.user_id, 'paper', { symbol: o.symbol, side: o.side, qty: o.qty }, 'paper-' + o.type);
    await run("UPDATE paper_orders SET status = 'filled', fill_price = ?, filled_at = ? WHERE id = ?", f.price, now(), o.id);
    return 'filled';
  } catch (e) {
    await run("UPDATE paper_orders SET status = 'rejected', note = ? WHERE id = ?", String(e.message).slice(0, 200), o.id);
    return 'rejected';
  }
}
// Every minute: fill what reached its price; Day orders end at the close, GTC after 90 days.
export async function runPaperOrders(t = now()) {
  const n = nyTime(t); let done = 0;
  await run("UPDATE paper_orders SET status = 'expired' WHERE status = 'open' AND ((tif = 'day' AND (day < ? OR (day = ? AND ?))) OR created_at < ?)", n.day, n.day, n.minutes >= closeMin(n.day) ? 1 : 0, t - 90 * 864e5);
  const open = await all("SELECT * FROM paper_orders WHERE status = 'open' ORDER BY id LIMIT 500");
  const prices = new Map();
  for (const o of open) {
    if (!prices.has(o.symbol)) prices.set(o.symbol, await lastPrice(o.symbol, o.user_id).catch(() => null));
    const px = prices.get(o.symbol); if (!px) continue;
    if (await check(o, px) === 'filled') done++;
  }
  return done;
}
const parse = o => o && ({ id: o.id, symbol: o.symbol, side: o.side, qty: o.qty, type: o.type, limitPrice: o.limit_price, stopPrice: o.stop_price, tif: o.tif, status: o.status === 'filling' ? 'open' : o.status, triggered: !!o.triggered, fillPrice: o.fill_price, note: o.note, at: o.created_at, filledAt: o.filled_at });
export async function openOrders(userId) { return (await all("SELECT * FROM paper_orders WHERE user_id = ? AND status IN ('open', 'filling') ORDER BY id DESC", userId)).map(parse); }

export const paperOrdersRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => res.json((await all('SELECT * FROM paper_orders WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id)).map(parse)));
  r.post('/', async (req, res) => res.json(await place(req.user.id, req.body || {})));
  r.delete('/:id', async (req, res) => {
    const x = await run("UPDATE paper_orders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'open'", +req.params.id, req.user.id);
    if (!x.changes) throw bad('That order is no longer open', 404);
    res.json({ ok: true });
  });
  r.delete('/', async (req, res) => { const x = await run("UPDATE paper_orders SET status = 'cancelled' WHERE user_id = ? AND status = 'open'", req.user.id); res.json({ cancelled: x.changes }); });
  return r;
})();
