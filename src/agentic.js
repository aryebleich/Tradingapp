// Agentic AI execution: AI agents the user connects (Claude, ChatGPT, Cursor, Codex or their own,
// through the MCP server in src/mcp.js) can scan the market, read order books and news, and draft
// or submit orders. Every order goes through the user's own boundaries first:
//   - per account: off, ask me (each order waits for the user's approval), or automatic;
//   - the largest order, the most per day (dollars and orders), allowed and blocked symbols,
//     short selling and extended hours;
//   - the plan: practice orders on every plan, real-money orders with approval on Pro, automatic
//     real-money orders and extended hours on Elite and Ultimate (src/aiplans.js);
//   - then the account's own risk controls and kill switch (placeOrder → checkOrder), as always.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { aiLimits, upgrade } from './aiplans.js';
import { nyTime } from './time.js';
import { session } from './desk.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const DEFAULTS = { accounts: { paper: 'auto' }, maxOrderUsd: 1000, maxDailyUsd: 5000, maxOrdersPerDay: 20, symbols: [], blocked: [], allowShort: false, extendedHours: false };
const MODES = ['off', 'approve', 'auto'];
const clean = s => [...new Set((Array.isArray(s) ? s : String(s || '').split(/[\s,]+/)).map(x => String(x).trim().toUpperCase()).filter(x => /^[A-Z][A-Z0-9.\/-]{0,14}$/.test(x)))].slice(0, 200);

export async function boundaries(userId) {
  const row = await one('SELECT json FROM agent_settings WHERE user_id = ?', userId);
  let b = {}; try { b = row ? JSON.parse(row.json) : {}; } catch {}
  return { ...DEFAULTS, ...b, accounts: { ...DEFAULTS.accounts, ...(b.accounts || {}) } };
}
export async function saveBoundaries(user, body = {}) {
  const lim = aiLimits(user), cur = await boundaries(user.id), next = { ...cur };
  if (body.accounts && typeof body.accounts === 'object') {
    next.accounts = {};
    for (const [a, m] of Object.entries(body.accounts)) {
      if (!/^[a-z0-9:_-]{2,40}$/.test(a) || !MODES.includes(m)) continue;
      if (a !== 'paper' && m !== 'off' && lim.agentLive === 'off') throw upgrade('AI agent orders on real accounts', p => p.agentLive !== 'off');
      if (a !== 'paper' && m === 'auto' && lim.agentLive !== 'auto') throw upgrade('Automatic AI agent orders on real accounts', p => p.agentLive === 'auto');
      next.accounts[a] = m;
    }
  }
  const num = (k, max) => { if (body[k] !== undefined) { const v = +body[k]; if (!(v >= 0 && v <= max)) throw bad(`${k} must be between 0 and ${max}`); next[k] = v; } };
  num('maxOrderUsd', 1e7); num('maxDailyUsd', 1e8); num('maxOrdersPerDay', 1000);
  if (body.symbols !== undefined) next.symbols = clean(body.symbols);
  if (body.blocked !== undefined) next.blocked = clean(body.blocked);
  if (body.allowShort !== undefined) next.allowShort = !!body.allowShort;
  if (body.extendedHours !== undefined) {
    if (body.extendedHours && !lim.extendedHours) throw upgrade('Extended-hours automation', p => p.extendedHours);
    next.extendedHours = !!body.extendedHours;
  }
  await run('INSERT INTO agent_settings (user_id, json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json', user.id, JSON.stringify(next));
  await audit(user.id, 'agent_boundaries', { accounts: next.accounts, maxOrderUsd: next.maxOrderUsd, maxDailyUsd: next.maxDailyUsd }, null);
  return next;
}

// The mode that applies to an account after the plan: the user's choice, never more than the plan.
export function effectiveMode(b, lim, account) {
  const want = b.accounts[account] || (account === 'paper' ? 'auto' : 'off');
  if (account === 'paper' || want === 'off') return want;
  if (lim.agentLive === 'off') return 'off';
  if (lim.agentLive === 'approve' && want === 'auto') return 'approve';
  return want;
}

// Everything an order must pass before it is placed or queued. Returns the problems in plain words.
export async function check(user, o, b, { price, held = 0, spentToday = 0, ordersToday = 0 }) {
  const lim = aiLimits(user), problems = [];
  const est = o.notional > 0 ? o.notional : (o.qty || 0) * (o.limit_price || price || 0);
  if (b.symbols.length && !b.symbols.includes(o.symbol)) problems.push(`${o.symbol} is not on your list of symbols agents may trade`);
  if (b.blocked.includes(o.symbol)) problems.push(`${o.symbol} is blocked for agents`);
  if (est > b.maxOrderUsd) problems.push(`$${est.toFixed(2)} is above your largest agent order ($${b.maxOrderUsd})`);
  if (spentToday + est > b.maxDailyUsd) problems.push(`it would take today's agent orders to $${(spentToday + est).toFixed(2)}, above your daily limit ($${b.maxDailyUsd})`);
  if (ordersToday + 1 > b.maxOrdersPerDay) problems.push(`agents already placed ${ordersToday} orders today (limit ${b.maxOrdersPerDay})`);
  if (o.side === 'sell' && !o.symbol.includes('/') && (o.qty || 0) > held + 1e-9 && !b.allowShort) problems.push(`selling more than the ${held} shares held would be a short sale, which your boundaries do not allow`);
  if (o.extended) {
    if (!lim.extendedHours) problems.push('extended-hours automation is part of the Elite plan');
    else if (!b.extendedHours) problems.push('extended hours are off in your agent boundaries');
    else if (o.type !== 'limit') problems.push('extended-hours orders must be limit orders');
  }
  return { problems, est };
}

const today = () => nyTime().day;
async function usage(userId, account) {
  const r = await one("SELECT COALESCE(SUM(est_usd), 0) usd, COUNT(*) n FROM agent_orders WHERE user_id = ? AND day = ? AND status IN ('placed', 'pending', 'approved')", userId, today());
  return { spentToday: r.usd, ordersToday: r.n };
}
const parseOrder = a => {
  const symbol = String(a.symbol || '').trim().toUpperCase().replace(/^([A-Z]{2,6})(USD)$/, '$1/$2');
  if (!/^[A-Z][A-Z0-9.\/-]{0,14}$/.test(symbol)) throw bad('Give a valid symbol');
  const side = a.side === 'sell' ? 'sell' : a.side === 'buy' ? 'buy' : null; if (!side) throw bad('side must be buy or sell');
  const qty = +a.qty > 0 ? +a.qty : null, notional = +a.notional > 0 ? +a.notional : null;
  if (!qty && !notional) throw bad('Give qty (shares) or notional (dollars)');
  const type = a.type === 'limit' ? 'limit' : 'market', limit_price = type === 'limit' ? +a.limit_price : null;
  if (type === 'limit' && !(limit_price > 0)) throw bad('A limit order needs limit_price');
  return { symbol, side, qty, notional, type, limit_price, extended: !!a.extended_hours, account: String(a.account || 'paper'), reason: String(a.reason || '').slice(0, 500) };
};

// An agent's order: checked, then placed (automatic), queued for approval (ask me), or refused.
export async function submit(user, agent, args, deps) {
  const o = parseOrder(args), lim = aiLimits(user), b = await boundaries(user.id);
  const known = (await deps.accountsFor(user.id)).filter(x => x.connected).map(x => x.id);
  if (!known.includes(o.account)) throw bad(`Unknown or unconnected account "${o.account}". Use list_accounts.`);
  const mode = effectiveMode(b, lim, o.account);
  const record = (status, extra = {}) => run('INSERT INTO agent_orders (user_id, agent, account, symbol, side, qty, notional, type, limit_price, extended, est_usd, reason, status, result, day, created_at, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    user.id, agent, o.account, o.symbol, o.side, o.qty, o.notional, o.type, o.limit_price, o.extended ? 1 : 0, extra.est || null, o.reason, status, extra.result || null, today(), now(), extra.decided || null).then(r => Number(r.lastInsertRowid));
  if (mode === 'off') {
    const why = o.account !== 'paper' && lim.agentLive === 'off' ? 'AI agent orders on real accounts are part of the Pro plan' : `agents are switched off for the ${o.account} account (Agents & API → Boundaries)`;
    const id = await record('blocked', { result: why }); return { id, status: 'blocked', reason: why };
  }
  const price = await deps.lastPrice(o.symbol, user.id).catch(() => null);
  const held = o.side === 'sell' ? (await deps.accountSummary(user.id, o.account).catch(() => ({ positions: [] }))).positions.find(p => p.symbol === o.symbol)?.qty || 0 : 0;
  const { problems, est } = await check(user, o, b, { price, held, ...(await usage(user.id, o.account)) });
  if (problems.length) { const why = problems.join('; '); const id = await record('blocked', { est, result: why }); return { id, status: 'blocked', reason: why }; }
  if (mode === 'approve') {
    const id = await record('pending', { est });
    await deps.notify(user.id, `AI agent ${agent} wants to ${o.side} ${o.qty ? o.qty + ' ' : '$' + o.notional + ' of '}${o.symbol} on ${o.account}${o.reason ? ` (${o.reason.slice(0, 80)})` : ''}. Approve or reject in Agents & API.`).catch(() => {});
    return { id, status: 'pending', message: 'Waiting for the user\'s approval in Agents & API.' };
  }
  return place(user, { ...o, est }, deps, await record('approved', { est, decided: now() }));
}

async function place(user, o, deps, id) {
  try {
    const order = { symbol: o.symbol, side: o.side, qty: o.qty || undefined, notional: o.qty ? undefined : o.notional, allowShort: o.side === 'sell' && (await boundaries(user.id)).allowShort, ...(o.type === 'limit' ? { type: 'limit', limit_price: o.limit_price, time_in_force: 'day', extended_hours: o.extended } : {}) };
    const r = await deps.placeOrder(user.id, o.account, order, 'agent');
    const result = `${r.status || 'sent'}${r.price ? ' @ ' + Number(r.price).toFixed(2) : ''}`;
    await run("UPDATE agent_orders SET status = 'placed', result = ?, decided_at = ? WHERE id = ?", result, now(), id);
    await audit(user.id, 'agent_order', { id, symbol: o.symbol, side: o.side, account: o.account }, null);
    return { id, status: 'placed', result, order: r };
  } catch (e) {
    await run("UPDATE agent_orders SET status = 'failed', result = ?, decided_at = ? WHERE id = ?", e.message.slice(0, 300), now(), id);
    return { id, status: 'failed', reason: e.message };
  }
}

export async function decide(user, id, approve, deps) {
  const o = await one("SELECT * FROM agent_orders WHERE id = ? AND user_id = ?", +id, user.id);
  if (!o) throw bad('Not found', 404);
  if (o.status !== 'pending') throw bad(`This order is already ${o.status}`, 409);
  if (!approve) { await run("UPDATE agent_orders SET status = 'rejected', decided_at = ? WHERE id = ?", now(), o.id); return { id: o.id, status: 'rejected' }; }
  // The plan may have changed since: an approval still needs real-money agent orders on the plan.
  if (o.account !== 'paper' && aiLimits(user).agentLive === 'off') throw upgrade('AI agent orders on real accounts', p => p.agentLive !== 'off');
  const claim = await run("UPDATE agent_orders SET status = 'approved' WHERE id = ? AND status = 'pending'", o.id);
  if (!claim.changes) throw bad('This order was decided already', 409);
  return place(user, { ...o, est: o.est_usd, extended: !!o.extended }, deps, o.id);
}

// Market scan for agents: change, RSI and trend over a universe (up to 60 symbols).
export async function scan(userId, { universe = 'mega', sort = 'change1d', limit = 20 } = {}) {
  const { symbolsOf, loadBars } = await import('./scanner.js'), { rsiSeries, smaSeries } = await import('./rotation/indicators.js');
  const syms = symbolsOf(universe), bars = await loadBars(userId, syms, '1Day');
  const rows = [];
  for (const s of syms) {
    const c = bars[s]?.closes; if (!c || c.length < 60) continue;
    const n = c.length - 1, pct = k => +((c[n] / c[n - k] - 1) * 100).toFixed(2);
    rows.push({ symbol: s, price: c[n], change1d: pct(1), change5d: pct(5), change20d: pct(20), rsi14: +rsiSeries(c, 14)[n]?.toFixed(1), aboveSma50: c[n] > smaSeries(c, 50)[n] });
  }
  const key = ['change1d', 'change5d', 'change20d', 'rsi14'].includes(sort) ? sort : 'change1d';
  rows.sort((a, b) => (key === 'rsi14' ? a[key] - b[key] : Math.abs(b[key]) - Math.abs(a[key])));
  return { universe, scanned: rows.length, results: rows.slice(0, Math.min(60, +limit || 20)) };
}

// Order book: depth for crypto (Alpaca), bid/ask for stocks when a quote feed has them.
export async function orderBook(userId, symbol, deps) {
  symbol = String(symbol || '').toUpperCase();
  const price = await deps.lastPrice(symbol, userId).catch(() => null);
  if (symbol.includes('/')) {
    const D = await import('./alpaca/data.js');
    if (D.dataEnabled()) { const b = await D.orderbook(symbol).catch(() => null); if (b) return { ...b, price, depth: true }; }
  }
  const { quoteAt } = await import('./execution.js');
  const q = await quoteAt(symbol, price).catch(() => null);
  return { symbol, price, bid: q?.bid ?? null, ask: q?.ask ?? null, spread: q?.bid && q?.ask ? +(q.ask - q.bid).toFixed(4) : null, depth: false, note: q?.bid ? 'Best bid and ask (top of the book).' : 'No live quote feed: last price only.' };
}

export const agentRouter = deps => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const lim = aiLimits(req.user), b = await boundaries(req.user.id);
    const [orders, tokens, accounts] = await Promise.all([
      all('SELECT * FROM agent_orders WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id),
      all('SELECT id, name, hint, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id DESC', req.user.id),
      deps.accountsFor(req.user.id)]);
    res.json({ boundaries: b, limits: lim, effective: Object.fromEntries(accounts.filter(a => a.connected).map(a => [a.id, effectiveMode(b, lim, a.id)])), accounts: accounts.filter(a => a.connected).map(a => ({ id: a.id, name: a.name, live: !!a.live })), orders, tokens, session: session(), usage: await usage(req.user.id) });
  });
  r.put('/boundaries', async (req, res) => res.json(await saveBoundaries(req.user, req.body || {})));
  r.post('/orders/:id/approve', async (req, res) => res.json(await decide(req.user, req.params.id, true, deps)));
  r.post('/orders/:id/reject', async (req, res) => res.json(await decide(req.user, req.params.id, false, deps)));
  return r;
};
