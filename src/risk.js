// Risk guardrails: per-user limits checked on every order (manual, bots, alerts, scanners, fleet),
// a daily loss stop, an emergency kill switch, and a guardian that closes positions at a
// stop-loss or take-profit level on any connected account.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { nyTime, stockSession, isCryptoSymbol } from './time.js';
import { requireUser } from './auth.js';

export const DEFAULTS = {
  maxOrderUsd: 0,        // largest single buy, $ (0 = no limit)
  maxPositionPct: 0,     // largest position after a buy, % of account equity
  maxDailyLossUsd: 0,    // stop new buys for the day after losing this much
  maxDailyLossPct: 0,    // ... or this % of the day's starting equity
  maxOrdersPerDay: 0,    // buys per day, all sources together (sells are never capped)
  allowSymbols: [],      // when set, only these can be bought
  denySymbols: [],       // never bought
  guardStopPct: 0,       // guardian: sell a position that is down this %
  guardTakePct: 0,       // guardian: sell a position that is up this %
  guardAccounts: ['paper'],
};
const MANUAL = new Set(['web', 'manual', 'sms', 'hotline']);
const bad = msg => Object.assign(new Error(msg), { status: 409, risk: true });
const list = v => (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).map(s => String(s).trim().toUpperCase()).filter(Boolean);

export async function getRisk(userId) {
  const r = await one('SELECT settings, kill FROM risk_settings WHERE user_id = ?', userId);
  let s = {}; try { s = JSON.parse(r?.settings || '{}'); } catch {}
  return { ...DEFAULTS, ...s, kill: !!r?.kill };
}
export const killed = async userId => !!(await one('SELECT kill FROM risk_settings WHERE user_id = ?', userId))?.kill;

export function cleanSettings(b) {
  const num = (v, max) => { const n = +v; return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  return {
    maxOrderUsd: num(b.maxOrderUsd, 1e8), maxPositionPct: num(b.maxPositionPct, 100), maxDailyLossUsd: num(b.maxDailyLossUsd, 1e8),
    maxDailyLossPct: num(b.maxDailyLossPct, 100), maxOrdersPerDay: Math.floor(num(b.maxOrdersPerDay, 10000)),
    allowSymbols: list(b.allowSymbols).slice(0, 500), denySymbols: list(b.denySymbols).slice(0, 500),
    guardStopPct: num(b.guardStopPct, 95), guardTakePct: num(b.guardTakePct, 1000),
    guardAccounts: (Array.isArray(b.guardAccounts) ? b.guardAccounts : String(b.guardAccounts || 'paper').split(',')).map(s => String(s).trim()).filter(Boolean).slice(0, 10),
  };
}
export async function saveRisk(userId, body) {
  const s = cleanSettings(body || {});
  await run('INSERT INTO risk_settings (user_id, settings, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at', userId, JSON.stringify(s), now());
  return s;
}

// Equity at the start of the day: the last snapshot before today, else the current equity.
async function dayStart(userId, account, equity) {
  const r = await one('SELECT equity FROM equity_history WHERE user_id = ? AND account = ? AND day < ? ORDER BY day DESC LIMIT 1', userId, account, nyTime().day);
  return r?.equity ?? equity;
}

// Throws a clear error when an order breaks a rule. `summarize` and `price` are injected to avoid
// an import cycle with brokers.js (which calls this before every order).
export async function checkOrder(userId, account, order, source, { summarize, price }) {
  const s = await getRisk(userId);
  const side = order.side === 'sell' ? 'sell' : 'buy', symbol = String(order.symbol || '').toUpperCase();
  if (s.kill && (side === 'buy' || !MANUAL.has(source))) throw bad('Kill switch is on: new orders are blocked (you can still sell by hand). Turn it off under Risk controls.');
  const day = nyTime().day;
  if (s.maxOrdersPerDay && side === 'buy') { // selling to reduce risk is never capped
    const n = (await one("SELECT COUNT(*) n FROM risk_log WHERE user_id = ? AND day = ? AND kind = 'order' AND detail LIKE '%\"side\":\"buy\"%'", userId, day)).n;
    if (n >= s.maxOrdersPerDay) throw bad(`Daily order limit reached (${s.maxOrdersPerDay})`);
  }
  if (side === 'buy') {
    if (s.denySymbols.includes(symbol)) throw bad(`${symbol} is on your blocked list`);
    if (s.allowSymbols.length && !s.allowSymbols.includes(symbol)) throw bad(`${symbol} is not on your allowed list`);
    const needsPrice = s.maxOrderUsd || s.maxPositionPct;
    const px = needsPrice && !(+order.notional > 0) ? (+order.limitPrice > 0 ? +order.limitPrice : await price(symbol).catch(() => null)) : null;
    const value = +order.notional > 0 ? +order.notional : +order.qty * (px || 0);
    if (s.maxOrderUsd && value > s.maxOrderUsd + 1e-6) throw bad(`Order of $${value.toFixed(2)} is over your $${s.maxOrderUsd} limit per order`);
    if (s.maxPositionPct || s.maxDailyLossUsd || s.maxDailyLossPct) {
      const a = await summarize(userId, account);
      if (s.maxPositionPct && a.equity > 0 && symbol) {
        const held = a.positions.find(p => p.symbol === symbol)?.value || 0;
        const pct = (held + value) / a.equity * 100;
        if (pct > s.maxPositionPct + 1e-6) throw bad(`${symbol} would be ${pct.toFixed(1)}% of the account (limit ${s.maxPositionPct}%)`);
      }
      if (s.maxDailyLossUsd || s.maxDailyLossPct) {
        const start = await dayStart(userId, account, a.equity), loss = start - a.equity;
        if ((s.maxDailyLossUsd && loss >= s.maxDailyLossUsd) || (s.maxDailyLossPct && start > 0 && loss / start * 100 >= s.maxDailyLossPct))
          throw bad(`Daily loss limit reached (down $${loss.toFixed(2)} today): no new buys until tomorrow`);
      }
    }
  }
}
export async function logOrder(userId, account, order, source) {
  await run("INSERT INTO risk_log (user_id, day, kind, detail, at) VALUES (?,?, 'order', ?, ?)", userId, nyTime().day, JSON.stringify({ account, symbol: order.symbol, side: order.side, source }), now());
}

// Kill switch: blocks orders, pauses every automation that checks it, cancels open Alpaca orders.
export async function setKill(userId, on, { cancelAlpaca } = {}) {
  await run('INSERT INTO risk_settings (user_id, kill, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET kill = excluded.kill, updated_at = excluded.updated_at', userId, on ? 1 : 0, now());
  let cancelled = null;
  if (on && cancelAlpaca) cancelled = await cancelAlpaca(userId).then(r => (Array.isArray(r) ? r.length : 0), () => null);
  return { kill: !!on, cancelled };
}

// Guardian: sells a whole position at the stop-loss or take-profit level. Stocks are checked in
// market hours, crypto at any time; each position is sold at most once per day.
export async function runGuardian({ summarize, place, t = now() }) {
  const rows = await all("SELECT user_id, settings FROM risk_settings WHERE kill = 0 AND (settings LIKE '%guardStopPct%' OR settings LIKE '%guardTakePct%')");
  const day = nyTime(t).day, open = stockSession(t), out = [];
  for (const r of rows) {
    let s; try { s = { ...DEFAULTS, ...JSON.parse(r.settings) }; } catch { continue; }
    if (!s.guardStopPct && !s.guardTakePct) continue;
    for (const account of s.guardAccounts) {
      let a; try { a = await summarize(r.user_id, account); } catch { continue; }
      for (const p of a.positions) {
        if (!(p.qty > 0) || !(p.avgPrice > 0) || !(p.price > 0)) continue;
        if (!open && !isCryptoSymbol(p.symbol)) continue;
        const ch = (p.price / p.avgPrice - 1) * 100;
        const why = s.guardStopPct && ch <= -s.guardStopPct ? `stop-loss ${ch.toFixed(1)}%` : s.guardTakePct && ch >= s.guardTakePct ? `take-profit +${ch.toFixed(1)}%` : null;
        if (!why) continue;
        const key = JSON.stringify({ account, symbol: p.symbol });
        if (await one("SELECT 1 FROM risk_log WHERE user_id = ? AND day = ? AND kind = 'guard' AND detail = ?", r.user_id, day, key)) continue;
        await run("INSERT INTO risk_log (user_id, day, kind, detail, at) VALUES (?,?, 'guard', ?, ?)", r.user_id, day, key, now());
        let result;
        try { await place(r.user_id, account, { symbol: p.symbol, side: 'sell', qty: p.qty }, 'guard'); result = `sold ${p.qty} ${p.symbol} (${why})`; }
        catch (e) { result = `could not sell ${p.symbol}: ${e.message}`; }
        out.push({ userId: r.user_id, account, symbol: p.symbol, result });
      }
    }
  }
  return out;
}

export function riskRouter({ summarize, cancelAlpaca }) {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const s = await getRisk(req.user.id), day = nyTime().day;
    const orders = (await one("SELECT COUNT(*) n FROM risk_log WHERE user_id = ? AND day = ? AND kind = 'order'", req.user.id, day)).n;
    const guard = await all("SELECT detail, at FROM risk_log WHERE user_id = ? AND kind = 'guard' ORDER BY id DESC LIMIT 20", req.user.id);
    res.json({ settings: s, ordersToday: orders, guardRecent: guard.map(x => ({ ...JSON.parse(x.detail), at: x.at })) });
  });
  r.put('/', async (req, res) => { const s = await saveRisk(req.user.id, req.body); await audit(req.user.id, 'risk_settings', s, req.ip); res.json({ settings: { ...s, kill: await killed(req.user.id) } }); });
  r.post('/kill', async (req, res) => {
    const on = !!req.body?.on;
    const out = await setKill(req.user.id, on, { cancelAlpaca: on ? cancelAlpaca : null });
    await audit(req.user.id, on ? 'kill_switch_on' : 'kill_switch_off', out, req.ip);
    res.json(out);
  });
  return r;
}
