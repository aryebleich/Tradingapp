// Small per-user settings (JSON values by key): routing preferences, trading speed bumps,
// lessons finished, the workspace layout, the behavioral sign-in profile.
import { one, run, now } from './db.js';

export async function getSetting(userId, k, dflt = null) {
  const r = await one('SELECT v FROM user_settings WHERE user_id = ? AND k = ?', userId, k);
  if (!r) return dflt;
  try { return JSON.parse(r.v); } catch { return dflt; }
}
export async function setSetting(userId, k, v) {
  await run('INSERT INTO user_settings (user_id, k, v, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at', userId, k, JSON.stringify(v), now());
  return v;
}

// Preferences the app saves for itself (workspace layout, calm mode).
import express from 'express';
import { requireUser } from './auth.js';
const PREFS = { workspace: v => (Array.isArray(v) ? v.slice(0, 16).map(p => ({ w: String(p.w || '').slice(0, 20), size: p.size === 2 ? 2 : 1, sym: String(p.sym || '').toUpperCase().slice(0, 12) })) : []), calm: v => !!v,
  // Portfolio numbers: update live, show the change since the last look, or both; hide "Today".
  portfolio: v => ({ mode: ['live', 'since', 'both'].includes(v?.mode) ? v.mode : 'live', hideToday: !!v?.hideToday }),
  // The value of each account the last time the user looked (for "Since you last looked").
  // prev is what "Since you last looked" compares with; cur is this visit.
  seen: v => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).slice(0, 12).filter(([k, x]) => /^[a-z0-9_-]{1,20}$/.test(k) && Number.isFinite(+x?.equity) && Number.isFinite(+x?.at))
    .map(([k, x]) => [k, { equity: +x.equity, at: +x.at, ...(Number.isFinite(+x.prevEquity) && Number.isFinite(+x.prevAt) && x.prevEquity !== null ? { prevEquity: +x.prevEquity, prevAt: +x.prevAt } : {}) }])) };
export const prefsRouter = express.Router();
prefsRouter.use(requireUser);
prefsRouter.get('/:key', async (req, res) => { if (!PREFS[req.params.key]) return res.status(404).json({ error: 'Unknown setting' }); res.json({ value: await getSetting(req.user.id, 'pref:' + req.params.key) }); });
prefsRouter.put('/:key', async (req, res) => { const f = PREFS[req.params.key]; if (!f) return res.status(404).json({ error: 'Unknown setting' }); res.json({ value: await setSetting(req.user.id, 'pref:' + req.params.key, f(req.body.value)) }); });
