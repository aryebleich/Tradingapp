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
