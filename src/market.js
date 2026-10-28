// Strategy marketplace: strategies, rule-based portfolios and signal channels that members
// publish, with backtest figures, followers and one-click copy / follow / subscribe.
import express from 'express';
import { publicName } from './crypto.js';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { getBars } from './brokers.js';
import { backtest, warmupFor } from './engine.js';
import { publicBaskets } from './baskets.js';
import { publicChannels } from './fleet.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });


async function strategyStats(s, userId) {
  const b = await getBars(s.symbol, '2016-01-01', userId), cfg = { entry: s.entry, exit: s.exit, sl: s.sl, tp: s.tp, ts: s.ts, capital: 10000 };
  const r = backtest(b.closes, cfg, warmupFor(cfg), b.closes.length, b.dates);
  return { ...r.m, from: b.dates[0], to: b.dates.at(-1), dataSource: b.source };
}

export const marketRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const strategies = await all(`SELECT s.id, s.name, s.symbol, s.entry, s.exit, s.sl, s.tp, s.ts, s.description, u.id uid, u.email, c.v stats,
      (SELECT COUNT(*) FROM cache x WHERE x.k LIKE 'copy:' || s.id || ':%') copies FROM strategies s JOIN users u ON u.id = s.user_id LEFT JOIN cache c ON c.k = 'stratstats:' || s.id
      WHERE s.public = 1 ORDER BY copies DESC, s.id DESC LIMIT 100`);
    res.json({
      strategies: strategies.map(s => ({ id: s.id, kind: 'strategy', name: s.name, symbol: s.symbol, entry: s.entry, exit: s.exit, sl: s.sl, tp: s.tp, ts: s.ts, description: s.description, creator: publicName(s.uid), ...(req.user.role === 'admin' ? { creatorEmail: s.email } : {}), copies: s.copies, stats: s.stats ? JSON.parse(s.stats) : null })),
      baskets: await publicBaskets(req.user), channels: await publicChannels(req.user),
    });
  });
  // Publish (or withdraw) one of your rule strategies; its backtest is computed once and shown.
  r.post('/strategies/:id/publish', async (req, res) => {
    const s = await one('SELECT * FROM strategies WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!s) throw bad('No such strategy', 404);
    const on = req.body.public !== false;
    if (on) await run('INSERT INTO cache (k, v, at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at', 'stratstats:' + s.id, JSON.stringify(await strategyStats(s, req.user.id)), now());
    await run('UPDATE strategies SET public = ?, description = ? WHERE id = ?', on ? 1 : 0, String(req.body.description ?? s.description ?? '').slice(0, 600), s.id);
    await audit(req.user.id, on ? 'strategy_published' : 'strategy_unpublished', { id: s.id }, req.ip);
    res.json({ ok: true });
  });
  r.post('/strategies/:id/copy', async (req, res) => {
    const s = await one('SELECT * FROM strategies WHERE id = ? AND public = 1', +req.params.id); if (!s) throw bad('That strategy is not published', 404);
    const id = (await run('INSERT INTO strategies (user_id, name, symbol, entry, exit, sl, tp, ts, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', req.user.id, s.name, s.symbol, s.entry, s.exit, s.sl, s.tp, s.ts, s.size, now())).lastInsertRowid;
    await run('INSERT OR IGNORE INTO cache (k, v, at) VALUES (?,?,?)', `copy:${s.id}:${req.user.id}`, '1', now());
    res.json({ id });
  });
  return r;
})();
