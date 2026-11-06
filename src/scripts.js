// Saved Brightolio Scripts (public/script.js) and their alerts: a script with "alert me" on is run on
// its symbol's daily prices after each trading day's close, and the user is told when one of its
// alertcondition() lines is true on the last bar (once per day and script).
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { run as runScript, firing } from '../public/script.js';
import { notifyUser } from './notify-user.js';
import { nyTime } from './time.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const SYM = /^[A-Z][A-Z0-9.]{0,9}(\/USD)?$/;

// Daily candles: Alpaca's market data when set up, otherwise closes from the other price sources.
export async function dailyBars(symbol, days = 500, userId = null) {
  const start = new Date(Date.now() - days * 864e5).toISOString();
  try {
    const D = await import('./alpaca/data.js');
    if (D.dataEnabled()) { const r = (await D.bars(symbol, { timeframe: '1Day', start, limit: 5000 }))[symbol]; if (r?.length) return r.map(x => ({ t: Date.parse(x.t), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 })); }
  } catch {}
  const { getBars } = await import('./brokers.js');
  const b = await getBars(symbol, start.slice(0, 10), userId);
  return b.closes.map((c, i) => ({ t: Date.parse(b.dates?.[i] || 0) || i, o: b.closes[i - 1] ?? c, h: c, l: c, c, v: 0 }));
}

export async function checkScript(s, t = now()) {
  const bars = await dailyBars(s.symbol, 500, s.user_id);
  if (bars.length < 30) return null;
  const out = runScript(s.source, bars), hits = firing(out);
  const day = nyTime(t).day;
  if (!hits.length || s.last_fired === day) return { hits: [] };
  await run('UPDATE scripts SET last_fired = ? WHERE id = ?', day, s.id);
  await notifyUser(s.user_id, `Script "${s.name}" on ${s.symbol}: ${hits.join('; ')} (close ${bars.at(-1).c}).`).catch(() => {});
  return { hits };
}
// Weekdays from 4:15 pm New York, once each.
export async function runScriptAlerts(t = now()) {
  const n = nyTime(t);
  if (n.weekend || n.minutes < 975) return 0;
  let done = 0;
  for (const s of await all('SELECT * FROM scripts WHERE alert = 1')) {
    if (s.last_checked === n.day) continue;
    await run('UPDATE scripts SET last_checked = ? WHERE id = ?', n.day, s.id);
    try { if ((await checkScript(s, t))?.hits?.length) done++; } catch (e) { console.warn('script alert', s.id, e.message); }
  }
  return done;
}

export const scriptsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => res.json((await all('SELECT id, name, symbol, alert, last_fired, source, updated_at FROM scripts WHERE user_id = ? ORDER BY updated_at DESC', req.user.id)).map(s => ({ ...s, alert: !!s.alert }))));
  r.post('/', async (req, res) => {
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 60) || 'My script', symbol = String(b.symbol || 'SPY').trim().toUpperCase(), source = String(b.source || '');
    if (!SYM.test(symbol)) throw bad('Check the symbol');
    if (source.length > 20000) throw bad('Scripts are limited to 20,000 characters');
    // It has to run before it is saved (so an alert can never fail every evening).
    try { runScript(source, Array.from({ length: 60 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 }))); } catch (e) { throw bad(e.message); }
    if ((await one('SELECT COUNT(*) AS n FROM scripts WHERE user_id = ?', req.user.id)).n >= 50 && !b.id) throw bad('Up to 50 saved scripts');
    if (b.id) await run('UPDATE scripts SET name = ?, symbol = ?, source = ?, alert = ?, updated_at = ? WHERE id = ? AND user_id = ?', name, symbol, source, b.alert ? 1 : 0, now(), +b.id, req.user.id);
    else b.id = (await run('INSERT INTO scripts (user_id, name, symbol, source, alert, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', req.user.id, name, symbol, source, b.alert ? 1 : 0, now(), now())).lastInsertRowid;
    await audit(req.user.id, 'script_saved', { id: b.id, alert: !!b.alert }, req.ip);
    res.json({ id: b.id });
  });
  r.delete('/:id', async (req, res) => { await run('DELETE FROM scripts WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
})();
