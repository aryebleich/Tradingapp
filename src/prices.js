// Prices (Admin → Prices; DECISIONS.md PR-1): the owner enters every plan and credit price by hand, with
// its currency and the date it takes effect. No price is written in the code: a plan or a credit pack
// with no price entered shows "Price not set yet" and can't be bought.
// Each change is a new row (the history stays); the price in force is the newest row whose date has come.
// A small in-memory copy keeps the plan objects synchronous; it is reloaded on every change and every
// 30 seconds, so all server processes agree within that time.
import { all, run, now } from './db.js';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'ILS', 'CHF', 'JPY'];
export const PLAN_KEYS = ['pro', 'elite', 'ultimate'];
// What has a price: each paid plan by month and by year, Institutional's "from" price a month, and each
// credit pack (by its id in the credits settings).
export const items = (packIds = []) => [
  ...PLAN_KEYS.flatMap(k => [`plan:${k}:month`, `plan:${k}:year`]),
  'plan:institutional:month',
  ...packIds.map(id => `credits:${id}`),
];
const VALID = /^(plan:(pro|elite|ultimate):(month|year)|plan:institutional:month|credits:[\w-]{1,20})$/;

let rows = [], loadedAt = 0, loading = null;
export async function loadPrices(force = false) {
  if (!force && Date.now() - loadedAt < 30e3) return rows;
  loading ||= all('SELECT item, amount, currency, effective_at, created_by, created_at FROM prices ORDER BY effective_at, id').then(r => { rows = r; loadedAt = Date.now(); return rows; }).catch(() => rows).finally(() => { loading = null; });
  return loading;
}
// The price in force now (or at t), from the in-memory copy: { amount, currency, effectiveAt } or null.
export function priceOf(item, t = Date.now()) {
  if (Date.now() - loadedAt > 30e3) loadPrices().catch(() => {});
  let cur = null;
  for (const r of rows) if (r.item === item && r.effective_at <= t) cur = r;
  return cur ? { amount: cur.amount, currency: cur.currency, effectiveAt: cur.effective_at } : null;
}
export const amountOf = (item, t) => priceOf(item, t)?.amount ?? null;
export const upcoming = (item, t = Date.now()) => rows.filter(r => r.item === item && r.effective_at > t).map(r => ({ amount: r.amount, currency: r.currency, effectiveAt: r.effective_at }));

export async function setPrice(admin, { item, amount, currency = 'USD', effectiveAt } = {}) {
  const bad = m => Object.assign(new Error(m), { status: 400 });
  if (!VALID.test(String(item))) throw bad('Unknown price');
  const a = Math.round(+amount * 100) / 100;
  if (!(a > 0 && a < 1e6)) throw bad('Enter a price above 0');
  const c = String(currency).toUpperCase();
  if (!CURRENCIES.includes(c)) throw bad(`Currency: one of ${CURRENCIES.join(', ')}`);
  const at = effectiveAt == null || effectiveAt === '' ? now() : typeof effectiveAt === 'number' ? effectiveAt : Date.parse(effectiveAt);
  if (!Number.isFinite(at) || at < Date.UTC(2020, 0, 1)) throw bad('Enter the date the price takes effect');
  await run('INSERT INTO prices (item, amount, currency, effective_at, created_by, created_at) VALUES (?,?,?,?,?,?)', item, a, c, at, admin?.email || null, now());
  await loadPrices(true);
  return { item, amount: a, currency: c, effectiveAt: at };
}

export async function priceBoard(packIds = []) {
  await loadPrices(true);
  return items(packIds).map(item => ({ item, current: priceOf(item), upcoming: upcoming(item), history: rows.filter(r => r.item === item).slice(-10).reverse().map(r => ({ amount: r.amount, currency: r.currency, effectiveAt: r.effective_at, by: r.created_by, at: r.created_at })) }));
}
export const format = p => (p ? new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.amount) : null);
export const _reset = () => { rows = []; loadedAt = 0; };
