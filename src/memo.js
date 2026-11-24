// Small in-memory read caches for rows that almost every request needs (the session and its user,
// per-user settings, brokerage credentials). Each entry lives `ttl` ms and belongs to an owner (a
// user id). Any write to a watched table (src/db.js onWrite) drops the entries whose owner or key is
// among the write's values; a write that names none of them clears the table's cache entirely, so a
// change is never hidden, whichever code made it. Other servers see a change within `ttl`.
import { onWrite } from './db.js';

export function tableCache({ tables, ttl = 60e3, max = 20000 }) {
  const m = new Map(); // key -> { v, owner, at }
  const watched = new Set(tables);
  onWrite((table, args) => {
    if (!watched.has(table) || !m.size) return;
    const vals = new Set((args || []).filter(x => typeof x === 'number' || typeof x === 'string').map(String));
    let hit = false;
    for (const [k, e] of m) if (vals.has(k) || vals.has(String(e.owner))) { m.delete(k); hit = true; }
    if (!hit) m.clear();
  });
  return {
    async get(key, owner, load) {
      const e = m.get(key);
      if (e && Date.now() - e.at < ttl) return e.v;
      const v = await load();
      if (m.size >= max) m.clear();
      m.set(key, { v, owner: typeof owner === 'function' ? owner(v) : owner, at: Date.now() });
      return v;
    },
    clear: () => m.clear(),
    size: () => m.size,
  };
}

// Brokerage credentials (encrypted blobs): looked up on most pages for the account list.
import { one } from './db.js';
const CREDS = tableCache({ tables: ['credentials'] });
export const credRow = (userId, provider) => CREDS.get(`${userId}|${provider}`, userId, () => one('SELECT blob FROM credentials WHERE user_id = ? AND provider = ?', userId, provider));

// A value kept in the `cache` table (survives restarts) with an in-memory front: repeat reads within
// `ttl` never reach the database, and many users asking at once share one load (news, SEC filings).
import { run, now } from './db.js';
const MEM = new Map(), INFLIGHT = new Map();
const BIG = 1 << 20, MEM_MAX = (+process.env.MEM_CACHE_MAX_MB || 64) * 1048576; // bytes of JSON
let memBytes = 0;
const warned = new Set();
const bigOnce = (key, n) => { const p = key.split(':').slice(0, 2).join(':'); if (!warned.has(p)) { warned.add(p); console.warn(`cache: ${p}… is ${Math.round(n / 1048576)} MB, not kept in memory (trim it before caching)`); } };
function remember(key, e) {
  const old = MEM.get(key); if (old) { memBytes -= old.size || 0; MEM.delete(key); }
  MEM.set(key, e); memBytes += e.size || 0;
  for (const [k, x] of MEM) { if (memBytes <= MEM_MAX && MEM.size <= 2000) break; MEM.delete(k); memBytes -= x.size || 0; } // oldest first
}
export const memCacheStats = () => ({ entries: MEM.size, mb: +(memBytes / 1048576).toFixed(1), maxMb: MEM_MAX / 1048576 });
// Stale-while-revalidate (PERFORMANCE.md): data cached for 5 minutes or more is answered at once
// from the last copy while one refresh runs in the background, for up to 6 times its lifetime (6 h at
// most), so nobody waits for a slow provider. Short-lived data (prices) is never served stale, except
// when the source fails: then the last copy within 10 times its lifetime is better than an error.
const staleFor = ttl => (ttl >= 300e3 ? Math.min(ttl * 6, 6 * 3600e3) : 0);
async function refreshNow(key, ttl, fn) {
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    const v = await fn(), json = JSON.stringify(v);
    await run('INSERT INTO cache (k, v, at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at', key, json, now());
    // A big value is not kept in memory too (a parsed object takes several times its JSON size), and
    // the memory front holds at most MEM_MAX_MB of JSON in all: the heap can never fill up from here.
    if (json.length > BIG) { bigOnce(key, json.length); return v; }
    remember(key, { v, at: now(), size: json.length }); return v;
  })();
  INFLIGHT.set(key, p);
  try { return await p; } finally { INFLIGHT.delete(key); }
}
export async function dbCached(key, ttl, fn) {
  const m = MEM.get(key);
  if (m && now() - m.at < ttl) return m.v;
  let last = m ? { v: m.v, at: m.at } : null;
  if (!last) {
    const c = await one('SELECT v, at FROM cache WHERE k = ?', key);
    if (c) { const v = JSON.parse(c.v); if (now() - c.at < ttl) { if (c.v.length <= BIG) remember(key, { v, at: c.at, size: c.v.length }); return v; } last = { v, at: c.at }; }
  }
  if (last && now() - last.at < ttl + staleFor(ttl)) { refreshNow(key, ttl, fn).catch(() => {}); return last.v; }
  try { return await refreshNow(key, ttl, fn); }
  catch (e) { if (last && now() - last.at < ttl * 10) return last.v; throw e; }
}
