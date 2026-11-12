// Admin → Phone & text accounts: the accounts opened by a phone call (hotline) or by a text
// message, with where each one stands (email, password, brokerage application) and the switches
// that allow or stop new sign-ups by phone and by text. Mounted under /api/admin (admins only).
import express from 'express';
import { all, one, run, audit } from './db.js';
import { siteGet, siteSet } from './site.js';
import { setPasswordEmail } from './smssignup.js';
import { settings as lineSettings, saveSettings as saveLine } from './hotline.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(e.status || 400).json({ error: e.message }));
const placeholder = email => /\.invalid$/i.test(String(email || ''));
export const signupSettings = () => ({ text: siteGet('smsSignup', { enabled: true })?.enabled !== false, phone: !!lineSettings().allowSignup });

export async function phoneAccounts() {
  // The first sign-up event of each account says how it was opened.
  const rows = await all(`SELECT u.id, u.email, u.phone, u.phone_verified, u.password_set, u.plan, u.plan_status, u.created_at, u.pin_hash IS NOT NULL AS has_pin,
      a.event, a.at AS opened_at, b.status AS broker_status,
      (SELECT MAX(at) FROM audit_log x WHERE x.user_id = u.id) AS last_at
    FROM audit_log a JOIN users u ON u.id = a.user_id LEFT JOIN broker_accounts b ON b.user_id = u.id
    WHERE a.event IN ('sms_signup', 'hotline_signup') AND a.id = (SELECT MIN(id) FROM audit_log y WHERE y.user_id = u.id AND y.event IN ('sms_signup', 'hotline_signup'))
    ORDER BY a.at DESC LIMIT 500`);
  const apps = Object.fromEntries((await all('SELECT phone, updated_at FROM text_applications')).map(t => [t.phone, t.updated_at]));
  return rows.map(r => ({
    id: r.id, how: r.event === 'sms_signup' ? 'text' : 'phone', openedAt: r.opened_at, phone: r.phone, phoneVerified: !!r.phone_verified,
    email: placeholder(r.email) ? null : r.email, hasPassword: r.password_set !== 0 && !placeholder(r.email), hasPin: !!r.has_pin,
    plan: r.plan || 'free', planStatus: r.plan_status || null, brokerage: r.broker_status || (apps[r.phone] ? 'application by text in progress' : null), lastActivity: r.last_at,
  }));
}

export const phoneAccountsRouter = express.Router();
phoneAccountsRouter.get('/', wrap(async (req, res) => {
  const accounts = await phoneAccounts();
  res.json({ settings: signupSettings(), accounts, totals: { all: accounts.length, text: accounts.filter(a => a.how === 'text').length, phone: accounts.filter(a => a.how === 'phone').length, noEmail: accounts.filter(a => !a.email).length, noPassword: accounts.filter(a => !a.hasPassword).length } });
}));
phoneAccountsRouter.put('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  if (typeof b.text === 'boolean') await siteSet('smsSignup', { enabled: b.text });
  if (typeof b.phone === 'boolean') await saveLine({ allowSignup: b.phone }); // the same switch as Admin → Phone line
  await audit(req.user.id, 'phone_signup_settings', signupSettings(), req.ip);
  res.json(signupSettings());
}));
const account = async id => { const u = await one("SELECT u.* FROM users u WHERE u.id = ? AND EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id = u.id AND a.event IN ('sms_signup', 'hotline_signup'))", +id); if (!u) throw bad('That account was not opened by phone or text', 404); return u; };
// The email with the link to choose a password (again), for an account that has a real address.
phoneAccountsRouter.post('/:id/password-email', wrap(async (req, res) => {
  const u = await account(req.params.id);
  if (placeholder(u.email)) throw bad('This account has no email address yet. Add one first.');
  await setPasswordEmail(u.id, u.email);
  await audit(req.user.id, 'admin_password_email', { user: u.id }, req.ip);
  res.json({ ok: true });
}));
// An account opened by a call has no email: the admin can add the one the customer gave.
phoneAccountsRouter.post('/:id/email', wrap(async (req, res) => {
  const u = await account(req.params.id), email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 || placeholder(email)) throw bad('Enter a valid email address');
  if (await one('SELECT 1 FROM users WHERE email = ? AND id != ?', email, u.id)) throw bad('Another account already uses that email');
  await run('UPDATE users SET email = ? WHERE id = ?', email, u.id);
  await setPasswordEmail(u.id, email);
  await audit(req.user.id, 'admin_set_email', { user: u.id }, req.ip);
  res.json({ ok: true });
}));
// Takes the phone off the account: texts and calls from that number are a stranger again.
phoneAccountsRouter.post('/:id/unlink', wrap(async (req, res) => {
  const u = await account(req.params.id);
  if (placeholder(u.email)) throw bad('This account signs in only by phone. Add an email first, or delete the account on the Users page.');
  await run('UPDATE users SET phone = NULL, phone_verified = 0 WHERE id = ?', u.id);
  await audit(req.user.id, 'admin_phone_unlinked', { user: u.id }, req.ip);
  res.json({ ok: true });
}));
