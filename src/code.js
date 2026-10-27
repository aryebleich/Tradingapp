// Code lab: saved Python strategy scripts (they run in the browser, never on this server) and the
// price data they read. QuantConnect algorithms are sent through the existing /qc routes.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import { getBars } from './brokers.js';
import { isPaid } from './fees.js';
import { limitsFor } from './statarb.js';

export const codeRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
  r.get('/prices', async (req, res) => {
    if (!rateLimit('codeprices:' + req.user.id, 120, 3600e3)) throw bad('Too many data requests this hour', 429);
    const syms = String(req.query.symbols || 'SPY').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, Math.max(10, limitsFor(req.user).symbols));
    const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : '2016-01-01';
    const out = {};
    for (const s of syms) { const b = await getBars(s, start, req.user.id); out[s] = { dates: b.dates, close: b.closes, source: b.source }; }
    res.json(out);
  });
  r.get('/scripts', async (req, res) => res.json(await all('SELECT id, name, code, updated_at FROM code_scripts WHERE user_id = ? ORDER BY updated_at DESC', req.user.id)));
  r.post('/scripts', async (req, res) => {
    const code = String(req.body.code || ''), name = String(req.body.name || 'Untitled').slice(0, 60);
    if (code.length > 100e3) throw bad('Scripts are limited to 100 KB');
    if (req.body.id) {
      const s = await one('SELECT id FROM code_scripts WHERE id = ? AND user_id = ?', +req.body.id, req.user.id); if (!s) throw bad('No such script', 404);
      await run('UPDATE code_scripts SET name = ?, code = ?, updated_at = ? WHERE id = ?', name, code, now(), s.id);
      return res.json({ id: s.id });
    }
    if ((await one('SELECT COUNT(*) n FROM code_scripts WHERE user_id = ?', req.user.id)).n >= (isPaid(req.user) ? 200 : 5)) throw Object.assign(bad('The free plan keeps 5 scripts'), { status: 402, upgrade: true, feature: 'More saved scripts' });
    res.json({ id: (await run('INSERT INTO code_scripts (user_id, name, code, updated_at) VALUES (?,?,?,?)', req.user.id, name, code, now())).lastInsertRowid });
  });
  r.delete('/scripts/:id', async (req, res) => { await run('DELETE FROM code_scripts WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
})();
