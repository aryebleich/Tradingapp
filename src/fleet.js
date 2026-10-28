// Signal fleet: a leader broadcasts trade signals on a channel (by hand, or from TradingView and
// other tools through the channel's own webhook) and followers mirror them into one or more of their
// own accounts, automatically or after approving each one. Every order goes through the follower's
// own guardrails.
import express from 'express';
import { publicName } from './crypto.js';
import { adviserMode } from './site.js';
import crypto from 'node:crypto';
import { one, all, run, now, audit } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import { accountSummary, placeOrder, lastPrice, ACCOUNT_IDS } from './brokers.js';
import { parseSignal } from './signals.js';
import { isPaid } from './fees.js';
import { killed } from './risk.js';
import { notifyUser } from './notify-user.js';
import { sha256 } from './crypto.js';

const REVIEW_MINUTES = 30;
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });


// One follower subscription acting on one signal.
export async function execute(sub, sig) {
  const user = await one('SELECT * FROM users WHERE id = ?', sub.user_id);
  if (sub.account !== 'paper' && !isPaid(user)) throw new Error('Mirroring into real accounts needs Pro');
  if (await killed(sub.user_id)) throw new Error('Kill switch is on');
  const s = await accountSummary(sub.user_id, sub.account), pos = s.positions.find(p => p.symbol === sig.symbol);
  const price = pos?.price || await lastPrice(sig.symbol, sub.user_id);
  if (sig.side === 'buy') {
    const notional = sub.sizing === 'pct' ? s.cash * Math.min(100, sub.amount) / 100 : sub.amount;
    if (!(notional >= 1)) throw new Error('Size is under $1');
    await placeOrder(sub.user_id, sub.account, { symbol: sig.symbol, side: 'buy', notional: +notional.toFixed(2), expectedPrice: sig.price || price, signalAt: sig.at }, `fleet:${sub.channel_id}`);
    return `bought $${notional.toFixed(2)} ${sig.symbol}`;
  }
  if (!(pos?.qty > 0)) return `no ${sig.symbol} to sell`;
  const qty = sig.size_pct ? +(pos.qty * Math.min(100, sig.size_pct) / 100).toFixed(6) : pos.qty;
  await placeOrder(sub.user_id, sub.account, { symbol: sig.symbol, side: 'sell', qty, expectedPrice: sig.price || price, signalAt: sig.at }, `fleet:${sub.channel_id}`);
  return `sold ${qty} ${sig.symbol}`;
}

export async function broadcast(channel, { symbol, side, sizePct = null, note = '' }, ip) {
  const price = await lastPrice(symbol, channel.user_id).catch(() => null);
  const sigId = (await run('INSERT INTO channel_signals (channel_id, symbol, side, size_pct, price, note, at) VALUES (?,?,?,?,?,?,?)', channel.id, symbol, side, sizePct, price, String(note || '').slice(0, 300), now())).lastInsertRowid;
  const sig = { id: sigId, symbol, side, size_pct: sizePct, price, at: now() };
  const subs = await all('SELECT * FROM channel_subs WHERE channel_id = ? AND active = 1', channel.id);
  const results = [];
  for (const sub of subs) {
    // Copying another trader's signals into a real account without review is managed money: only in
    // registered-adviser mode. Otherwise each one waits for the follower to approve it.
    const auto = sub.mode === 'auto' && (sub.account === 'paper' || sub.user_id === channel.user_id || adviserMode());
    if (auto) {
      let result; try { result = await execute(sub, sig); } catch (e) { result = 'failed: ' + e.message; }
      await run("INSERT INTO channel_pending (sub_id, signal_id, user_id, status, result, at) VALUES (?,?,?, 'auto', ?, ?)", sub.id, sigId, sub.user_id, result, now());
      await notifyUser(sub.user_id, `Fleet "${channel.name}": ${side.toUpperCase()} ${symbol} - ${result} (${sub.account})`);
      results.push({ sub: sub.id, result });
    } else {
      await run("INSERT INTO channel_pending (sub_id, signal_id, user_id, status, at) VALUES (?,?,?, 'pending', ?)", sub.id, sigId, sub.user_id, now());
      await notifyUser(sub.user_id, `Fleet "${channel.name}": ${side.toUpperCase()} ${symbol}${price ? ' near ' + price : ''}. Review it in QuantPocket within ${REVIEW_MINUTES} minutes.`);
      results.push({ sub: sub.id, result: 'waiting for review' });
    }
  }
  await audit(channel.user_id, 'fleet_signal', { channel: channel.id, symbol, side, followers: subs.length }, ip);
  return { signal: sig, delivered: results.length, results };
}

// Signals sent to a channel's own webhook (TradingView, TrendSpider, scripts).
export async function channelHook(req, res) {
  if (!rateLimit('chook:' + req.ip, 120, 60e3)) return res.status(429).json({ error: 'Too many signals' });
  const ch = await one('SELECT * FROM channels WHERE token_hash = ?', sha256(String(req.params.token || '')));
  if (!ch) return res.status(404).json({ error: 'Unknown channel' });
  let sig; try { sig = parseSignal(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json(await broadcast(ch, { symbol: sig.symbol, side: sig.action === 'buy' ? 'buy' : 'sell', note: 'webhook' }, req.ip));
}

// Everyone sees the creator's nickname; admins also see the email, to contact them.
export async function publicChannels(viewer) {
  const rows = await all(`SELECT c.id, c.name, c.description, c.created_at, u.id uid, u.email, (SELECT COUNT(DISTINCT user_id) FROM channel_subs s WHERE s.channel_id = c.id AND s.active = 1) followers,
    (SELECT COUNT(*) FROM channel_signals g WHERE g.channel_id = c.id) signals FROM channels c JOIN users u ON u.id = c.user_id WHERE c.public = 1 ORDER BY followers DESC, c.id DESC LIMIT 100`);
  return rows.map(r => ({ id: r.id, kind: 'channel', name: r.name, description: r.description, creator: publicName(r.uid), ...(viewer?.role === 'admin' ? { creatorEmail: r.email } : {}), followers: r.followers, signals: r.signals }));
}

export const fleetRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const uid = req.user.id;
    const mine = await all('SELECT c.*, (SELECT COUNT(*) FROM channel_subs s WHERE s.channel_id = c.id AND s.active = 1) followers FROM channels c WHERE user_id = ? ORDER BY id DESC', uid);
    const subs = await all('SELECT s.*, c.name channel FROM channel_subs s JOIN channels c ON c.id = s.channel_id WHERE s.user_id = ? ORDER BY s.id DESC', uid);
    const pending = await all(`SELECT p.*, g.symbol, g.side, g.price, g.note, g.at signal_at, c.name channel, s.account FROM channel_pending p JOIN channel_signals g ON g.id = p.signal_id
      JOIN channel_subs s ON s.id = p.sub_id JOIN channels c ON c.id = s.channel_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 100`, uid);
    const recent = mine.length ? await all(`SELECT * FROM channel_signals WHERE channel_id IN (${mine.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 50`, ...mine.map(c => c.id)) : [];
    res.json({ channels: mine.map(c => ({ ...c, token_hash: undefined })), subscriptions: subs, inbox: pending.map(p => ({ ...p, expired: p.status === 'pending' && now() - p.signal_at > REVIEW_MINUTES * 60e3 })), sent: recent, public: await publicChannels(req.user) });
  });
  r.post('/channels', async (req, res) => {
    if (!isPaid(req.user) && (await one('SELECT COUNT(*) n FROM channels WHERE user_id = ?', req.user.id)).n >= 1) throw Object.assign(bad('The free plan has 1 channel'), { status: 402, upgrade: true, feature: 'More signal channels' });
    const token = crypto.randomBytes(18).toString('base64url');
    const id = (await run('INSERT INTO channels (user_id, name, description, public, token_hash, created_at) VALUES (?,?,?,?,?,?)', req.user.id, String(req.body.name || 'My signals').slice(0, 60), String(req.body.description || '').slice(0, 600), req.body.public === false ? 0 : 1, sha256(token), now())).lastInsertRowid;
    res.json({ id, webhookPath: `/hook/c/${token}` });
  });
  const myChannel = async req => { const c = await one('SELECT * FROM channels WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!c) throw bad('No such channel', 404); return c; };
  r.post('/channels/:id/signals', async (req, res) => {
    const c = await myChannel(req);
    if (!rateLimit('fleet:' + req.user.id, 60, 3600e3)) throw bad('Too many signals this hour', 429);
    const symbol = String(req.body.symbol || '').trim().toUpperCase(), side = req.body.side === 'sell' ? 'sell' : 'buy';
    if (!/^[A-Z0-9.\-]{1,12}(\/[A-Z]{3,4})?$/.test(symbol)) throw bad('Enter a symbol');
    const sizePct = side === 'sell' && +req.body.sizePct > 0 ? Math.min(100, +req.body.sizePct) : null;
    res.json(await broadcast(c, { symbol, side, sizePct, note: req.body.note }, req.ip));
  });
  r.post('/channels/:id/token', async (req, res) => {
    const c = await myChannel(req), token = crypto.randomBytes(18).toString('base64url');
    await run('UPDATE channels SET token_hash = ? WHERE id = ?', sha256(token), c.id);
    res.json({ webhookPath: `/hook/c/${token}` });
  });
  r.delete('/channels/:id', async (req, res) => { await myChannel(req); await run('DELETE FROM channels WHERE id = ?', +req.params.id); res.json({ ok: true }); });
  r.post('/channels/:id/subscribe', async (req, res) => {
    const c = await one('SELECT * FROM channels WHERE id = ? AND (public = 1 OR user_id = ?)', +req.params.id, req.user.id); if (!c) throw bad('No such channel', 404);
    const accounts = (Array.isArray(req.body.accounts) ? req.body.accounts : [req.body.account || 'paper']).filter(a => ACCOUNT_IDS.includes(a));
    if (!accounts.length) throw bad('Pick an account');
    if (req.body.mode === 'auto' && accounts.some(a => a !== 'paper') && c.user_id !== req.user.id && !adviserMode()) throw Object.assign(bad('Copying another trader\'s signals into a real account automatically needs the business to be a registered investment adviser. Choose "review each signal" for real accounts, or automatic on paper.'), { status: 403, adviserOnly: true });
    if (accounts.some(a => a !== 'paper') && !isPaid(req.user)) throw Object.assign(bad('Mirroring into real accounts is part of Pro'), { status: 402, upgrade: true, feature: 'Signal mirroring to real accounts' });
    const sizing = req.body.sizing === 'pct' ? 'pct' : 'fixed', amount = Math.max(1, Math.min(sizing === 'pct' ? 100 : 1e7, +req.body.amount || 100)), mode = req.body.mode === 'auto' ? 'auto' : 'review';
    for (const a of accounts) await run('INSERT INTO channel_subs (channel_id, user_id, account, sizing, amount, mode, active, created_at) VALUES (?,?,?,?,?,?,1,?) ON CONFLICT(channel_id, user_id, account) DO UPDATE SET sizing = excluded.sizing, amount = excluded.amount, mode = excluded.mode, active = 1', c.id, req.user.id, a, sizing, amount, mode, now());
    await audit(req.user.id, 'fleet_subscribe', { channel: c.id, accounts, mode }, req.ip);
    res.json({ ok: true });
  });
  r.delete('/subscriptions/:id', async (req, res) => { await run('UPDATE channel_subs SET active = 0 WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  r.post('/inbox/:id', async (req, res) => {
    const p = await one('SELECT p.*, g.symbol, g.side, g.size_pct, g.price, g.at FROM channel_pending p JOIN channel_signals g ON g.id = p.signal_id WHERE p.id = ? AND p.user_id = ?', +req.params.id, req.user.id);
    if (!p || p.status !== 'pending') throw bad('Nothing to review', 404);
    if (req.body.approve && now() - p.at > REVIEW_MINUTES * 60e3) { await run("UPDATE channel_pending SET status = 'expired' WHERE id = ?", p.id); throw bad('This signal expired', 410); }
    if (!req.body.approve) { await run("UPDATE channel_pending SET status = 'declined' WHERE id = ?", p.id); return res.json({ ok: true }); }
    const sub = await one('SELECT * FROM channel_subs WHERE id = ?', p.sub_id);
    let result; try { result = await execute(sub, { symbol: p.symbol, side: p.side, size_pct: p.size_pct, price: p.price, at: p.at }); } catch (e) { result = 'failed: ' + e.message; }
    await run("UPDATE channel_pending SET status = 'approved', result = ? WHERE id = ?", result, p.id);
    res.json({ result });
  });
  return r;
})();
