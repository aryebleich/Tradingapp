// Admin → Users: one user's details and real-money results, totals across everyone, signing a user
// out everywhere, and deleting an account (with its data and any Stripe subscription).
//   live P&L  for every connected real-money account: equity, today's change, open (unrealized)
//             P&L from the broker, and realized P&L from the account's own fills (FIFO)
import express from 'express';
import { requireUser, requireAdmin, confirmsIdentity, isAdminEmail, deleteUserData } from './auth.js';
import { one, all, run, audit } from './db.js';
import { accountSummary } from './brokers.js';
import { realizedGains } from './tax.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const r2 = x => Math.round((+x || 0) * 100) / 100;
const cache = new Map(); // user id -> { at, v }

export async function livePnl(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.v;
  const { accountsFor } = await import('./ext/routes.js');
  const accounts = (await accountsFor(userId).catch(() => [])).filter(a => a.connected && a.live);
  const rows = [];
  for (const a of accounts) {
    const fills = await all('SELECT symbol, side, qty, price, at FROM fills WHERE user_id = ? AND account = ? ORDER BY at', userId, a.id);
    const realized = realizedGains(fills).reduce((x, g) => x + g.gain, 0);
    try {
      const s = await accountSummary(userId, a.id);
      if (!s.live) continue; // only real money counts here
      const open = s.positions.reduce((x, p) => x + (+p.pnl || 0), 0);
      rows.push({ account: a.id, name: a.name, equity: r2(s.equity), today: s.lastEquity ? r2(s.equity - s.lastEquity) : null, open: r2(open), realized: r2(realized), total: r2(open + realized), positions: s.positions.length });
    } catch (e) { rows.push({ account: a.id, name: a.name, error: String(e.message).slice(0, 120), realized: r2(realized), total: r2(realized) }); }
  }
  const sum = k => r2(rows.reduce((x, r) => x + (r[k] || 0), 0));
  const v = { userId, accounts: rows, equity: sum('equity'), today: sum('today'), open: sum('open'), realized: sum('realized'), total: sum('total'), at: Date.now() };
  cache.set(userId, { at: Date.now(), v });
  return v;
}

// Users with a real-money connection saved (live keys, OAuth or another brokerage).
async function liveUserIds() {
  const rows = await all("SELECT DISTINCT user_id FROM credentials");
  const out = [];
  for (const { user_id } of rows) {
    const { accountsFor } = await import('./ext/routes.js');
    if ((await accountsFor(user_id).catch(() => [])).some(a => a.connected && a.live)) out.push(user_id);
  }
  return out;
}

export const adminUsersRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  // Totals across every user with real money connected (5-minute cache per user).
  r.get('/live-pnl', async (req, res) => {
    const ids = (await liveUserIds()).slice(0, 300), users = [];
    for (let i = 0; i < ids.length; i += 4) users.push(...await Promise.all(ids.slice(i, i + 4).map(id => livePnl(id).catch(e => ({ userId: id, error: e.message, accounts: [] })))));
    const emails = Object.fromEntries((await all(`SELECT id, email FROM users WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'})`, ...ids)).map(u => [u.id, u.email]));
    const sum = k => r2(users.reduce((x, u) => x + (u[k] || 0), 0));
    res.json({ users: users.map(u => ({ ...u, email: emails[u.userId] })).sort((a, b) => (b.total || 0) - (a.total || 0)), count: users.length, equity: sum('equity'), today: sum('today'), open: sum('open'), realized: sum('realized'), total: sum('total') });
  });
  r.get('/:id', async (req, res) => {
    const u = await one('SELECT id, email, plan, plan_status, plan_renews, role, totp_enabled, phone, phone_verified, stripe_customer, created_at, referred_by FROM users WHERE id = ?', +req.params.id);
    if (!u) throw bad('No such user', 404);
    const { accountsFor } = await import('./ext/routes.js');
    const [accounts, sessions, lastLogin, credits, paper] = await Promise.all([
      accountsFor(u.id).catch(() => []), one('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', u.id),
      one("SELECT * FROM audit_log WHERE user_id = ? AND event LIKE 'login%' AND event != 'login_failed' ORDER BY id DESC LIMIT 1", u.id).catch(() => null),
      one('SELECT monthly_left + bought AS balance FROM credit_state WHERE user_id = ?', u.id).catch(() => null),
      accountSummary(u.id, 'paper').catch(() => null),
    ]);
    res.json({ ...u, accounts: accounts.filter(a => a.connected).map(a => ({ id: a.id, name: a.name, live: a.live })), sessions: sessions?.n || 0, lastLogin, credits: credits?.balance ?? null,
      paper: paper ? { equity: r2(paper.equity), cash: r2(paper.cash), startCash: paper.startCash, positions: paper.positions.length } : null });
  });
  r.get('/:id/pnl', async (req, res) => {
    if (req.query.fresh === '1') cache.delete(+req.params.id);
    res.json(await livePnl(+req.params.id));
  });
  r.post('/:id/signout', async (req, res) => {
    const id = +req.params.id;
    const n = (await run('DELETE FROM sessions WHERE user_id = ?', id)).changes;
    await audit(req.user.id, 'admin_user_signout', { user: id, sessions: n }, req.ip);
    res.json({ ok: true, sessions: n });
  });
  // Deleting: the admin's password (or email for Google-only admins) and the word DELETE.
  r.delete('/:id', async (req, res) => {
    const u = await one('SELECT id, email, role, stripe_customer FROM users WHERE id = ?', +req.params.id);
    if (!u) throw bad('No such user', 404);
    if (u.id === req.user.id) throw bad('You cannot delete your own account here; use Settings → Delete account');
    if (u.role === 'admin' || isAdminEmail(u.email)) throw bad('Remove admin access first (Admin → Users, or Admin → Admins)');
    if (String(req.body?.word || '').trim().toUpperCase() !== 'DELETE') throw bad('Type DELETE to confirm');
    if (!confirmsIdentity(req.user, req.body || {})) throw bad(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password', 401);
    // Stop billing first: any Stripe subscription is cancelled now.
    let stripe = null;
    if (u.stripe_customer && process.env.STRIPE_SECRET_KEY) {
      try {
        const { stripeApi } = await import('./stripesetup.js');
        const subs = (await stripeApi('GET', '/subscriptions', { customer: u.stripe_customer, status: 'all', limit: 20 })).data || [];
        let n = 0; for (const s of subs.filter(x => !['canceled', 'incomplete_expired'].includes(x.status))) { await stripeApi('DELETE', `/subscriptions/${s.id}`); n++; }
        stripe = { cancelled: n };
      } catch (e) { stripe = { error: e.message }; }
    }
    const d = await deleteUserData(u.id);
    cache.delete(u.id);
    await audit(req.user.id, 'admin_user_deleted', { user: u.id, tables: d.tables, stripe }, req.ip);
    res.json({ ok: true, email: u.email, stripe });
  });
  return r;
})();
