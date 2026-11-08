// Public trader profiles and the Top traders list (social and copy trading). A user opts in and picks
// which account to show. Only percentages are public (returns, drawdown, holding weights), never
// dollar amounts, and trades appear one day late so nobody can trade ahead of them. Others can copy
// the portfolio's mix into their own accounts (a Rules across accounts plan) or follow the trader's
// signal channel to mirror each trade.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { publicName } from './crypto.js';
import { accountSummary } from './brokers.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const r2 = x => +(+x || 0).toFixed(2);
const handleOf = id => publicName(id).replace(/^Trader /, '').toLowerCase();

async function setting(userId) { const r = await one("SELECT v FROM user_settings WHERE user_id = ? AND k = 'publicProfile'", userId); try { return r ? JSON.parse(r.v) : null; } catch { return null; } }

// Return over a period from the account's daily values, and the largest drop on the way.
export function performance(rows, days) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), xs = rows.filter(r => r.day >= from);
  if (xs.length < 2 || !(xs[0].equity > 0)) return { ret: null, drawdown: null, points: xs.length };
  let peak = -Infinity, dd = 0; for (const x of xs) { peak = Math.max(peak, x.equity); dd = Math.min(dd, x.equity / peak - 1); }
  return { ret: r2((xs.at(-1).equity / xs[0].equity - 1) * 100), drawdown: r2(dd * 100), points: xs.length };
}

async function card(userId, s, { detail = false } = {}) {
  const hist = await all('SELECT day, equity FROM equity_history WHERE user_id = ? AND account = ? ORDER BY day', userId, s.account || 'paper');
  const perf = { m1: performance(hist, 31), m3: performance(hist, 92), y1: performance(hist, 366) };
  const channel = await one('SELECT id, name FROM channels WHERE user_id = ? AND public = 1 ORDER BY id LIMIT 1', userId).catch(() => null);
  const followers = channel ? (await one('SELECT COUNT(DISTINCT user_id) AS n FROM channel_subs WHERE channel_id = ? AND active = 1', channel.id).catch(() => ({ n: 0 }))).n : 0;
  const trades90 = (await one('SELECT COUNT(*) AS n FROM fills WHERE user_id = ? AND account = ? AND at > ?', userId, s.account || 'paper', now() - 90 * 864e5)).n;
  const out = { handle: handleOf(userId), name: publicName(userId), bio: s.bio || '', account: s.account === 'paper' ? 'Practice account' : 'Real account', perf, trades90, followers, channel: channel ? { id: channel.id, name: channel.name } : null };
  if (!detail) return out;
  const sm = await accountSummary(userId, s.account || 'paper').catch(() => null);
  const total = sm ? sm.equity : 0;
  out.holdings = sm ? sm.positions.map(p => ({ symbol: p.symbol, weight: total ? r2(p.value / total * 100) : 0 })).sort((a, b) => b.weight - a.weight).slice(0, 25) : [];
  out.cashWeight = sm && total ? r2(sm.cash / total * 100) : null;
  out.curve = hist.slice(-366).map(x => ({ day: x.day, pct: hist.length ? r2((x.equity / hist[Math.max(0, hist.length - 366)].equity - 1) * 100) : 0 }));
  out.recent = (await all('SELECT symbol, side, at FROM fills WHERE user_id = ? AND account = ? AND at < ? ORDER BY at DESC LIMIT 30', userId, s.account || 'paper', now() - 864e5)).map(f => ({ symbol: f.symbol, side: f.side, day: new Date(f.at).toISOString().slice(0, 10) }));
  return out;
}

export const profilesRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/me', async (req, res) => res.json({ ...(await setting(req.user.id)) || { on: false, bio: '', account: 'paper' }, handle: handleOf(req.user.id), name: publicName(req.user.id) }));
  r.put('/me', async (req, res) => {
    const b = req.body || {}, s = { on: !!b.on, bio: String(b.bio || '').replace(/[<>]/g, '').slice(0, 280), account: /^(paper|alpaca(:\d{1,3})?)$/.test(b.account || '') ? b.account : 'paper', since: now() };
    await run("INSERT INTO user_settings (user_id, k, v, updated_at) VALUES (?, 'publicProfile', ?, ?) ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at", req.user.id, JSON.stringify(s), now());
    res.json({ ...s, handle: handleOf(req.user.id) });
  });
  // Ranked by the chosen period's return; at least 20 days of history to be listed.
  r.get('/top', async (req, res) => {
    const period = ['m1', 'm3', 'y1'].includes(req.query.period) ? req.query.period : 'm3';
    const rows = await all("SELECT user_id, v FROM user_settings WHERE k = 'publicProfile'");
    const cards = [];
    for (const row of rows) { let s; try { s = JSON.parse(row.v); } catch { continue; } if (!s?.on) continue; const c = await card(row.user_id, s).catch(() => null); if (c && c.perf[period].ret != null && c.perf[period].points >= 20) cards.push(c); }
    cards.sort((a, b) => b.perf[period].ret - a.perf[period].ret);
    res.json({ period, traders: cards.slice(0, 50) });
  });
  r.get('/:handle', async (req, res) => {
    const h = String(req.params.handle).toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(h)) throw bad('No such trader', 404);
    for (const row of await all("SELECT user_id, v FROM user_settings WHERE k = 'publicProfile'")) {
      if (handleOf(row.user_id) !== h) continue;
      let s; try { s = JSON.parse(row.v); } catch { break; }
      if (!s?.on) break;
      return res.json(await card(row.user_id, s, { detail: true }));
    }
    throw bad('No such trader, or the profile is private', 404);
  });
  return r;
})();
