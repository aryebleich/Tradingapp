// A small in-process cache for data that is the same for everyone (market movers, most actives, news,
// a quote shared by everyone looking at the same symbol): one call to the provider at a time per key,
// and once an answer is older than ttl, the last answer is still given at once for up to stale ms while
// one refresh runs in the background (PERFORMANCE.md). Nothing per user goes in here.
const MAX = 500;
const E = new Map(); // key -> { v, at, p }
const stats = { hit: 0, stale: 0, miss: 0, errors: 0 };

function refresh(key, fn) {
  const e = E.get(key) || {};
  if (e.p) return e.p;
  const p = Promise.resolve().then(fn).then(v => { E.delete(key); E.set(key, { v, at: Date.now() }); trim(); return v; },
    err => { stats.errors++; const x = E.get(key); if (x) delete x.p; throw err; });
  E.set(key, { ...e, p });
  return p;
}
const trim = () => { for (const k of E.keys()) { if (E.size <= MAX) break; E.delete(k); } }; // oldest first

export async function shared(key, ttl, stale, fn) {
  const e = E.get(key), age = e && 'v' in e ? Date.now() - e.at : Infinity;
  if (age < ttl) { stats.hit++; return e.v; }
  if (age < ttl + stale) { stats.stale++; refresh(key, fn).catch(() => {}); return e.v; }
  stats.miss++;
  return refresh(key, fn);
}
export const sharedStats = () => ({ entries: E.size, ...stats });
export const sharedClear = () => E.clear();
