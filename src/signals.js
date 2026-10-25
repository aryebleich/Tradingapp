// Webhook signals: TradingView, TrendSpider, Zapier, scripts or AI agents POST an alert to a
// private URL and it becomes orders in every account that webhook routes to, inside its risk rules.
import express from 'express';
import { one, all, run, now } from './db.js';
import { encrypt, decrypt, randomToken, sha256 } from './crypto.js';
import { placeOrder, accountSummary, lastPrice, validSymbol, ACCOUNT_IDS } from './brokers.js';
import { extName } from './ext/brokers.js';
import { isPaid } from './fees.js';
import { requireUser, rateLimit } from './auth.js';

export const HOOK_LIMITS = { free: 1, pro: 10, elite: 25, ultimate: 100 };
const ACCOUNTS = ACCOUNT_IDS;
const SIZE_MODES = ['dollars', 'qty', 'signal'];
const appUrl = () => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const limitFor = u => (u.role === 'admin' ? HOOK_LIMITS.ultimate : isPaid(u) ? HOOK_LIMITS[u.plan] || HOOK_LIMITS.pro : HOOK_LIMITS.free);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });

// Accepts TradingView-style JSON ({"ticker","action","quantity","sentiment"}), common aliases, or
// plain text like "buy AAPL 10", "sell $500 MSFT" and "exit TSLA".
export function parseSignal(raw) {
  let d = raw;
  if (typeof d === 'string') {
    const t = d.trim();
    try { d = JSON.parse(t); } catch {
      const w = t.split(/\s+/);
      d = { action: w[0], ticker: w.find((x, i) => i && /^[A-Za-z]/.test(x)) };
      const amt = w.slice(1).find(x => /^\$?\d/.test(x));
      if (amt) d[amt.startsWith('$') ? 'dollars' : 'quantity'] = amt.replace('$', '');
    }
  }
  if (!d || typeof d !== 'object') throw bad('Send JSON like {"ticker":"AAPL","action":"buy","quantity":10} or text like "buy AAPL 10".');
  const pick = (...keys) => keys.map(k => d[k]).find(v => v != null && v !== '');
  // "NASDAQ:AAPL" from TradingView's {{exchange}}:{{ticker}} becomes AAPL.
  const symbol = String(pick('ticker', 'symbol') || '').trim().toUpperCase().replace(/^[A-Z]+:/, '');
  let action = String(pick('action', 'side', 'order') || '').trim().toLowerCase();
  const sentiment = String(pick('sentiment', 'market_position') || '').trim().toLowerCase();
  if (['close', 'exit', 'flat', 'close_all'].includes(action) || sentiment === 'flat') action = 'exit';
  if (action === 'long') action = 'buy';
  if (!validSymbol(symbol)) throw bad(`Unknown ticker "${symbol || '(none)'}". Send "ticker", for example {"ticker":"AAPL",...}.`);
  if (!['buy', 'sell', 'exit'].includes(action)) throw bad(`Unknown action "${action || '(none)'}". Use buy, sell or exit.`);
  const qty = +pick('quantity', 'qty', 'contracts', 'shares'), dollars = +String(pick('dollars', 'notional', 'amount') ?? '').replace('$', '');
  return { symbol, action, qty: qty > 0 ? qty : null, dollars: dollars > 0 ? dollars : null };
}

// Turns one signal into an order for one account, applying the webhook's sizing and risk rules.
async function orderFor(hook, user, sig, account) {
  if (account !== 'paper' && !isPaid(user)) throw new Error(`Sending signals to ${account === 'alpaca' ? 'Alpaca' : extName(account)} needs Pro (paper still works)`);
  const s = await accountSummary(user.id, account);
  const pos = s.positions.find(p => p.symbol === sig.symbol), held = pos?.qty > 0 ? pos.qty : 0;
  const price = pos?.price || await lastPrice(sig.symbol, user.id);
  if (sig.action === 'exit') {
    if (!held) throw new Error(`No open ${sig.symbol} position to exit`);
    return { side: 'sell', qty: held };
  }
  // Size: the webhook's fixed size, or the size inside the alert when the webhook says so.
  let qty = null, notional = null;
  if (hook.size_mode === 'signal') {
    qty = sig.qty; notional = qty ? null : sig.dollars;
    if (!qty && !notional) throw new Error('This webhook takes its size from the alert; add "quantity" or "dollars"');
  } else if (hook.size_mode === 'qty') qty = hook.size;
  else notional = hook.size;
  if (sig.action === 'sell') {
    // Long only: a sell can close at most what is held.
    if (!held) throw new Error(`No ${sig.symbol} shares to sell (long-only)`);
    const want = qty ?? notional / price;
    return { side: 'sell', qty: +Math.min(want, held).toFixed(6) };
  }
  const value = qty ? qty * price : notional;
  if (hook.max_position && held * price + value > hook.max_position + 1e-6)
    throw new Error(`Risk rule: ${sig.symbol} position would be $${Math.round(held * price + value).toLocaleString('en-US')}, above the $${hook.max_position.toLocaleString('en-US')} limit`);
  return qty ? { side: 'buy', qty } : { side: 'buy', notional };
}

export async function handleSignal(hook, user, raw, { test = false } = {}) {
  const payload = (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).slice(0, 2000);
  const log = async (status, sig, detail) => {
    await run('INSERT INTO signals (user_id, hook_id, symbol, action, status, detail, payload, test, at) VALUES (?,?,?,?,?,?,?,?,?)',
      user.id, hook.id, sig?.symbol ?? null, sig?.action ?? null, status, JSON.stringify(detail), payload, test ? 1 : 0, now());
    await run('UPDATE signal_hooks SET last_at = ? WHERE id = ?', now(), hook.id);
    return { status, symbol: sig?.symbol ?? null, action: sig?.action ?? null, ...detail };
  };
  let sig;
  try { sig = parseSignal(raw); } catch (e) { return log('rejected', null, { error: e.message }); }
  if (!hook.enabled && !test) return log('rejected', sig, { error: 'This webhook is paused' });
  const allowed = (hook.symbols || '').split(/[\s,]+/).filter(Boolean);
  if (allowed.length && !allowed.includes(sig.symbol)) return log('rejected', sig, { error: `Risk rule: ${sig.symbol} is not in this webhook's allowed tickers` });
  if (hook.max_trades_day && !test) {
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    const n = (await one("SELECT COUNT(*) n FROM signals WHERE hook_id = ? AND test = 0 AND status IN ('ok', 'partial') AND at >= ?", hook.id, day.getTime())).n;
    if (n >= hook.max_trades_day) return log('rejected', sig, { error: `Risk rule: already ${n} trades today (limit ${hook.max_trades_day})` });
  }
  const results = [];
  for (const account of JSON.parse(hook.accounts)) {
    try {
      const o = await orderFor(hook, user, sig, account);
      const r = await placeOrder(user.id, account, { symbol: sig.symbol, ...o }, 'webhook');
      results.push({ account, ok: true, side: o.side, qty: r.qty ?? o.qty ?? null, notional: o.notional ?? null, price: r.price ?? null, status: r.status });
    } catch (e) { results.push({ account, ok: false, error: e.message }); }
  }
  const ok = results.filter(r => r.ok).length;
  return log(ok === results.length ? 'ok' : ok ? 'partial' : 'rejected', sig, { results });
}

// ---------- receiving alerts ----------

// Mounted at /hook/:token. Always answers 200 for a known webhook so senders do not retry
// rejected signals; the reason is in the response and in the app's signal log.
export async function receive(req, res) {
  const token = String(req.params.token || '');
  const hook = token.length > 20 && await one('SELECT * FROM signal_hooks WHERE token_hash = ?', sha256(token));
  if (!hook) return res.status(404).json({ error: 'Unknown webhook URL' });
  if (!rateLimit('hook:' + hook.id, 60, 60e3)) return res.status(429).json({ error: 'Too many signals; at most 60 per minute' });
  const user = await one('SELECT * FROM users WHERE id = ?', hook.user_id);
  res.json(await handleSignal(hook, user, req.body));
}

// ---------- managing webhooks (JSON API, signed-in user) ----------

const view = h => ({
  id: h.id, name: h.name, url: `${appUrl()}/hook/${decrypt(h.token_enc).t}`, accounts: JSON.parse(h.accounts), sizeMode: h.size_mode, size: h.size,
  maxPosition: h.max_position, maxTradesDay: h.max_trades_day, symbols: h.symbols || '', enabled: !!h.enabled, lastAt: h.last_at, createdAt: h.created_at,
});
function settings(b, user) {
  const name = String(b.name ?? '').trim().slice(0, 60);
  if (!name) throw bad('Give the webhook a name');
  const accounts = [...new Set([].concat(b.accounts || []))].filter(a => ACCOUNTS.includes(a));
  if (!accounts.length) throw bad('Pick at least one account');
  if (accounts.some(a => a !== 'paper') && !isPaid(user)) throw upgrade('Sending alerts to your brokerage account');
  const sizeMode = SIZE_MODES.includes(b.sizeMode) ? b.sizeMode : 'dollars', size = +b.size || 0;
  if (sizeMode !== 'signal' && !(size > 0)) throw bad('Order size must be above zero');
  const pos = b.maxPosition === '' || b.maxPosition == null ? null : +b.maxPosition, trades = b.maxTradesDay === '' || b.maxTradesDay == null ? null : Math.floor(+b.maxTradesDay);
  if (pos != null && !(pos > 0)) throw bad('Max position must be above zero, or empty for no limit');
  if (trades != null && !(trades > 0)) throw bad('Max trades per day must be at least 1, or empty for no limit');
  const symbols = String(b.symbols || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
  const wrong = symbols.find(s => !validSymbol(s));
  if (wrong) throw bad(`"${wrong}" is not a valid ticker`);
  return { name, accounts: JSON.stringify(accounts), sizeMode, size: sizeMode === 'signal' ? 0 : size, pos, trades, symbols: symbols.join(',') || null, enabled: b.enabled === false ? 0 : 1 };
}
const mine = async (req) => {
  const h = await one('SELECT * FROM signal_hooks WHERE id = ? AND user_id = ?', +req.params.id, req.user.id);
  if (!h) throw bad('Webhook not found', 404);
  return h;
};
const newToken = () => { const t = randomToken(24); return { hash: sha256(t), enc: encrypt({ t }) }; };

export const router = express.Router();
router.use(requireUser);
router.get('/hooks', async (req, res) => {
  res.json({ hooks: (await all('SELECT * FROM signal_hooks WHERE user_id = ? ORDER BY id', req.user.id)).map(view), limit: limitFor(req.user) });
});
router.post('/hooks', async (req, res) => {
  const s = settings(req.body, req.user);
  const n = (await one('SELECT COUNT(*) n FROM signal_hooks WHERE user_id = ?', req.user.id)).n;
  if (n >= limitFor(req.user)) throw isPaid(req.user) ? bad(`Your plan allows ${limitFor(req.user)} webhooks`) : upgrade('More than one webhook');
  const t = newToken();
  const r = await run('INSERT INTO signal_hooks (user_id, name, token_hash, token_enc, accounts, size_mode, size, max_position, max_trades_day, symbols, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    req.user.id, s.name, t.hash, t.enc, s.accounts, s.sizeMode, s.size, s.pos, s.trades, s.symbols, s.enabled, now());
  res.json(view(await one('SELECT * FROM signal_hooks WHERE id = ?', r.lastInsertRowid)));
});
router.put('/hooks/:id', async (req, res) => {
  const h = await mine(req), s = settings(req.body, req.user);
  await run('UPDATE signal_hooks SET name = ?, accounts = ?, size_mode = ?, size = ?, max_position = ?, max_trades_day = ?, symbols = ?, enabled = ? WHERE id = ?',
    s.name, s.accounts, s.sizeMode, s.size, s.pos, s.trades, s.symbols, s.enabled, h.id);
  res.json(view(await one('SELECT * FROM signal_hooks WHERE id = ?', h.id)));
});
router.post('/hooks/:id/pause', async (req, res) => {
  const h = await mine(req);
  await run('UPDATE signal_hooks SET enabled = ? WHERE id = ?', req.body.enabled ? 1 : 0, h.id);
  res.json({ ok: true });
});
// A new URL; the old one stops working at once (for a URL that leaked).
router.post('/hooks/:id/rotate', async (req, res) => {
  const h = await mine(req), t = newToken();
  await run('UPDATE signal_hooks SET token_hash = ?, token_enc = ? WHERE id = ?', t.hash, t.enc, h.id);
  res.json(view(await one('SELECT * FROM signal_hooks WHERE id = ?', h.id)));
});
router.delete('/hooks/:id', async (req, res) => {
  const h = await mine(req);
  await run('DELETE FROM signal_hooks WHERE id = ?', h.id);
  res.json({ ok: true });
});
// Runs a message through the same path as a real alert (orders are real in the chosen accounts).
router.post('/hooks/:id/test', async (req, res) => {
  const h = await mine(req);
  res.json(await handleSignal(h, req.user, req.body.message ?? '', { test: true }));
});
router.get('/log', async (req, res) => {
  const rows = await all('SELECT s.*, h.name FROM signals s LEFT JOIN signal_hooks h ON h.id = s.hook_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 50', req.user.id);
  res.json(rows.map(r => ({ id: r.id, hook: r.name, symbol: r.symbol, action: r.action, status: r.status, detail: JSON.parse(r.detail || '{}'), test: !!r.test, at: r.at })));
});
