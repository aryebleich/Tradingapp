// Credits: a monthly allowance on every plan (unused monthly credits do not roll over) plus packs a
// user buys (they never expire). Extras that cost money to run are paid with credits:
//   ai        an AI message beyond the plan's daily allowance
//   sms       a text message QuantPocket sends you (alerts, replies to your texts)
//   call      a call to the phone line
//   filing    an AI summary of a company's 10-K or 10-Q
//   agent     training an AI agent
//   optimize  a strategy optimizer run
// Monthly credits are spent first, bought ones after. The owner sets the amounts in Admin → Money.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { PAID } from './fees.js';
import { siteGet, siteSet } from './site.js';

export const DEFAULTS = {
  monthly: { free: 100, pro: 1000, elite: 3000, ultimate: 10000 },
  costs: { ai: 1, sms: 1, call: 3, filing: 5, agent: 10, optimize: 3 },
  packs: [{ id: 'c500', credits: 500, price: 5 }, { id: 'c3000', credits: 3000, price: 25 }, { id: 'c12000', credits: 12000, price: 80 }],
};
export const LABELS = { ai: 'AI message beyond the daily allowance', sms: 'Text message sent to you', call: 'Call to the phone line', filing: 'AI summary of a 10-K or 10-Q', agent: 'Training an AI agent', optimize: 'Strategy optimizer run' };
export const config = () => { const s = siteGet('credits', {}) || {}; return { monthly: { ...DEFAULTS.monthly, ...(s.monthly || {}) }, costs: { ...DEFAULTS.costs, ...(s.costs || {}) }, packs: s.packs?.length ? s.packs : DEFAULTS.packs }; };
export async function saveConfig(b = {}) {
  const cur = config(), int = (v, lo, hi) => { const n = Math.round(+v); if (!(n >= lo && n <= hi)) throw Object.assign(new Error(`Use a whole number from ${lo} to ${hi}`), { status: 400 }); return n; };
  const out = { monthly: { ...cur.monthly }, costs: { ...cur.costs }, packs: cur.packs };
  for (const k of Object.keys(DEFAULTS.monthly)) if (b.monthly?.[k] !== undefined) out.monthly[k] = int(b.monthly[k], 0, 1e6);
  for (const k of Object.keys(DEFAULTS.costs)) if (b.costs?.[k] !== undefined) out.costs[k] = int(b.costs[k], 0, 1000);
  if (Array.isArray(b.packs)) out.packs = b.packs.slice(0, 6).map((p, i) => ({ id: String(p.id || `p${i}`).replace(/[^\w-]/g, '').slice(0, 20) || `p${i}`, credits: int(p.credits, 1, 1e7), price: Math.round(+p.price * 100) / 100 })).filter(p => p.price >= 1);
  await siteSet('credits', out);
  return out;
}

const period = (t = now()) => new Date(t).toISOString().slice(0, 7);
const planOf = u => (u?.role === 'admin' && !u.previewPlan ? 'ultimate' : PAID.includes(u?.plan) && ['active', 'trialing', null, undefined].includes(u?.plan_status) ? u.plan : 'free');

// The user's balance; the monthly allowance refills on the first use each calendar month.
export async function balance(user) {
  const allowance = config().monthly[planOf(user)] ?? 0, p = period();
  let s = await one('SELECT * FROM credit_state WHERE user_id = ?', user.id);
  if (!s) { await run('INSERT INTO credit_state (user_id, period, monthly_left, bought) VALUES (?,?,?,0) ON CONFLICT(user_id) DO NOTHING', user.id, p, allowance); s = await one('SELECT * FROM credit_state WHERE user_id = ?', user.id); }
  else if (s.period !== p) { await run('UPDATE credit_state SET period = ?, monthly_left = ? WHERE user_id = ? AND period = ?', p, allowance, user.id, s.period); s = await one('SELECT * FROM credit_state WHERE user_id = ?', user.id); }
  return { monthly: s.monthly_left, bought: s.bought, total: s.monthly_left + s.bought, allowance, plan: planOf(user), period: s.period };
}

export const outOfCredits = kind => Object.assign(new Error(`Not enough credits for this (${LABELS[kind] || kind}). Buy a credit pack under Plans & billing, or wait for next month's credits.`), { status: 402, credits: true, upgrade: true, feature: 'More credits' });
// Takes the cost of `kind` (times n); throws 402 when there are not enough credits.
export async function spend(user, kind, { n = 1, memo = null } = {}) {
  const cost = (config().costs[kind] ?? 0) * n;
  if (!cost) return balance(user);
  const b = await balance(user);
  if (b.total < cost) throw outOfCredits(kind);
  const fromMonthly = Math.min(b.monthly, cost), fromBought = cost - fromMonthly;
  // Conditional update: two requests at once can never spend the same credits twice.
  const r = await run('UPDATE credit_state SET monthly_left = monthly_left - ?, bought = bought - ? WHERE user_id = ? AND monthly_left >= ? AND bought >= ?', fromMonthly, fromBought, user.id, fromMonthly, fromBought);
  if (!r.changes) throw outOfCredits(kind);
  await run('INSERT INTO credit_ledger (user_id, delta, kind, memo, at) VALUES (?,?,?,?,?)', user.id, -cost, kind, memo, now());
  return { ...b, monthly: b.monthly - fromMonthly, bought: b.bought - fromBought, total: b.total - cost };
}
// Like spend, but answers true/false instead of throwing.
export const trySpend = (user, kind, opts) => spend(user, kind, opts).then(() => true, e => (e.credits ? false : Promise.reject(e)));
// Bought or granted credits (they never expire). ref makes a payment count once.
export async function grant(userId, credits, kind = 'purchase', memo = null, ref = null) {
  if (ref && await one('SELECT id FROM credit_ledger WHERE ref = ?', ref)) return false;
  const u = await one('SELECT * FROM users WHERE id = ?', userId);
  await balance(u);
  await run('INSERT INTO credit_ledger (user_id, delta, kind, memo, ref, at) VALUES (?,?,?,?,?,?)', userId, credits, kind, memo, ref, now());
  await run('UPDATE credit_state SET bought = bought + ? WHERE user_id = ?', credits, userId);
  return true;
}

export function creditsRouter({ checkout }) {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const c = config();
    res.json({ balance: await balance(req.user), costs: c.costs, labels: LABELS, monthly: c.monthly, packs: c.packs, history: await all('SELECT delta, kind, memo, at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 30', req.user.id) });
  });
  // A credit pack through Stripe Checkout; the webhook adds the credits once the payment succeeds.
  r.post('/buy', async (req, res) => {
    const pack = config().packs.find(p => p.id === req.body?.pack);
    if (!pack) throw Object.assign(new Error('Pick a credit pack'), { status: 400 });
    res.json(await checkout(req.user, pack));
  });
  return r;
}
