// Accounts, sessions, TOTP two-factor, lockout, rate limits, CSRF guard.
import express from 'express';
import crypto from 'node:crypto';
import { one, all, run, now, audit, tx } from './db.js';
import { hashSecret, verifySecret, randomToken, sha256, newTotpSecret, verifyTotp } from './crypto.js';
import { sendEmail, emailEnabled, sendSms, twilioEnabled as smsEnabled } from './notify.js';
import { OWNER_EMAILS, addedAdminEmails, isAdminPhone, normalizePhone, freshSite, siteSet } from './site.js';
// The last email the service refused (wrong sender, unverified domain), shown in Admin → Setup.
const noteEmailError = msg => siteSet('emailError', { msg: String(msg).slice(0, 300), at: now() }).catch(() => {});

// Signed-in sessions last 30 days and renew themselves while used, so a refresh never asks again.
const SESSION_MS = 30 * 86400e3;
const RENEW_MS = 86400e3;
const MFA_MS = 5 * 60e3;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const COOKIE = 'qp_sid';
const secure = process.env.NODE_ENV === 'production';

// Fixed-window limiter keyed by caller-supplied string.
const hits = new Map();
export function rateLimit(key, max, windowMs) {
  const t = now(), h = hits.get(key);
  if (!h || t - h.start > windowMs) { hits.set(key, { start: t, n: 1 }); return true; }
  h.n++;
  return h.n <= max;
}
setInterval(() => { const t = now(); for (const [k, h] of hits) if (t - h.start > 3600e3) hits.delete(k); }, 600e3).unref();

export function validPassword(p) {
  return typeof p === 'string' && p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function setCookie(res, token, ms) {
  res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ms / 1000)}${secure ? '; Secure' : ''}`);
}
export async function createSession(res, req, userId, mfaPending) {
  const token = randomToken();
  const ttl = mfaPending ? MFA_MS : SESSION_MS;
  await run('INSERT INTO sessions (token_hash, user_id, mfa_pending, ip, ua, created_at, expires_at) VALUES (?,?,?,?,?,?,?)',
    sha256(token), userId, mfaPending ? 1 : 0, req.ip, (req.headers['user-agent'] || '').slice(0, 200), now(), now() + ttl);
  setCookie(res, token, ttl);
  return sha256(token);
}

// Attaches req.user for fully-authenticated sessions and req.pending for sessions awaiting 2FA.
export async function sessionMiddleware(req, res, next) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const s = await one('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
    if (s && s.expires_at > now()) {
      req.sessionHash = s.token_hash;
      if (!s.mfa_pending && s.expires_at - now() < SESSION_MS - RENEW_MS) {
        await run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', now() + SESSION_MS, s.token_hash);
        setCookie(res, token, SESSION_MS);
      }
      const u = await one('SELECT * FROM users WHERE id = ?', s.user_id);
      // ADMIN_EMAIL counts on every visit, so an account made before it was set becomes admin too.
      await freshSite();
      if (u && u.role !== 'admin' && (isAdminEmail(u.email) || (u.phone_verified && isAdminPhone(u.phone)))) { await run("UPDATE users SET role = 'admin' WHERE id = ?", u.id); u.role = 'admin'; }
      // "View as plan": the owner sees the app (menus, limits, upgrade prompts) exactly as a user on that plan would.
      if (u?.role === 'admin') { const pv = await one("SELECT v FROM user_settings WHERE user_id = ? AND k = 'previewPlan'", u.id).catch(() => null); const plan = pv ? JSON.parse(pv.v) : null; if (plan) { u.previewPlan = plan; u.plan = plan; u.plan_status = plan === 'free' ? null : 'active'; } }
      if (s.mfa_pending) req.pending = u; else req.user = u;
    }
  }
  next();
}

// State-changing API calls must carry a custom header, which cross-site forms cannot set.
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'qp') return res.status(403).json({ error: 'Missing CSRF header' });
  next();
}

// ADMIN_EMAIL may list several addresses, separated by commas; case and spaces do not matter.
// Gmail ignores dots and anything after "+" in the name, and Google may report the address with
// dots (arye.b@gmail.com) even when ADMIN_EMAIL is written without them, so Gmail is compared canonically.
export const canonicalEmail = e => {
  const [name, domain] = String(e || '').trim().toLowerCase().split('@');
  if (!domain) return String(e || '').trim().toLowerCase();
  return ['gmail.com', 'googlemail.com'].includes(domain) ? `${name.split('+')[0].replace(/\./g, '')}@gmail.com` : `${name}@${domain}`;
};
export const adminEmails = () => String(process.env.ADMIN_EMAIL || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
// Admins: ADMIN_EMAIL, the owner's built-in addresses, and addresses added in Admin → Admins.
export const allAdminEmails = () => [...new Set([...OWNER_EMAILS, ...adminEmails(), ...addedAdminEmails()].map(e => e.trim().toLowerCase()))];
export const isAdminEmail = email => !!email && allAdminEmails().map(canonicalEmail).includes(canonicalEmail(email));

export const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Not signed in' });
export const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

export const publicUser = u => u && ({
  id: u.id, email: u.email, role: u.role, totpEnabled: !!u.totp_enabled, phone: u.phone, phoneVerified: !!u.phone_verified,
  previewPlan: u.previewPlan || null, hasPin: !!u.pin_hash, hasPassword: u.password_set !== 0, google: !!u.google_sub, github: !!u.github_id, emailVerified: !!u.email_verified, planStatus: u.plan_status, planInterval: u.plan_interval, trialUsed: !!u.trial_used, refCode: u.ref_code, plan: u.plan, planRenews: u.plan_renews, taxBracket: u.tax_bracket, stateTax: u.state_tax,
});

export const router = express.Router();
const newRefCode = () => randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8).padEnd(8, '7');
const DUMMY_HASH = hashSecret('timing-equalizer');

// Creates a user with a $100,000 paper account. Without a password (Google sign-up) the stored
// hash is of a random secret nobody knows, so password sign-in stays impossible until one is set.
export async function createUser({ email, password, ref, googleSub = null, verified = false }) {
  // Admin is whoever matches ADMIN_EMAIL; outside production the first account also qualifies.
  const admin = isAdminEmail(email) || (!adminEmails().length && process.env.NODE_ENV !== 'production' && !await one('SELECT id FROM users LIMIT 1'));
  // Referral: ?ref=CODE on the sign-up link credits whoever invited this user once they pay.
  const referrer = /^[a-z0-9]{6,12}$/.test(String(ref || '')) ? await one('SELECT id FROM users WHERE ref_code = ?', ref) : null;
  const r = await run('INSERT INTO users (email, pass_hash, password_set, google_sub, email_verified, role, created_at, ref_code, referred_by) VALUES (?,?,?,?,?,?,?,?,?)',
    email, hashSecret(password || randomToken()), password ? 1 : 0, googleSub, verified ? 1 : 0, admin ? 'admin' : 'user', now(), newRefCode(), referrer?.id ?? null);
  const id = Number(r.lastInsertRowid);
  await run('INSERT INTO paper_accounts (user_id, cash, start_cash) VALUES (?,?,?)', id, 100000, 100000);
  await run('INSERT INTO fee_state (user_id, account, high_water, net_contrib) VALUES (?,?,?,?)', id, 'paper', 100000, 100000);
  return id;
}
// Sensitive actions re-check the password; accounts created with Google confirm with their email instead.
export const confirmsIdentity = (u, body) => u.password_set === 0
  ? String(body.confirm || '').trim().toLowerCase() === u.email
  : verifySecret(String(body.password || ''), u.pass_hash);

router.post('/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  if (!rateLimit('reg:' + req.ip, 10, 3600e3)) return res.status(429).json({ error: 'Too many sign-ups from this address' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password needs 10+ characters with upper, lower and a digit' });
  if (await one('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'Email already registered' });
  const id = await createUser({ email, password, ref: req.body.ref });
  await audit(id, 'register', null, req.ip);
  // No confirmation step: the account works at once. A welcome email points to the first steps.
  sendEmail(email, 'Welcome to QuantPocket', `Your account is ready, with a $100,000 paper account to practice.\n\nGet started: ${appUrl(req)}/app#/dashboard\n\nIf you did not sign up, reply to this email and we will remove the account.`).catch(e => console.warn('welcome email', e.message));
  await createSession(res, req, id, false);
  res.json({ user: publicUser(await one('SELECT * FROM users WHERE id = ?', id)) });
});

router.post('/login', async (req, res) => {
  if (!rateLimit('login:' + req.ip, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts, try later' });
  const u = await userByEmail(req.body.email);
  if (u && u.locked_until > now()) return res.status(423).json({ error: 'Account temporarily locked after failed attempts' });
  // Hash against a dummy when the email is unknown so response time does not reveal registered emails.
  if (!verifySecret(String(req.body.password || ''), u?.pass_hash || DUMMY_HASH) || !u) {
    if (u) {
      const fails = u.failed_logins + 1;
      await run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now() + LOCK_MS : 0, u.id);
      await audit(u.id, 'login_failed', null, req.ip);
    }
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  await run('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?', u.id);
  const sec = await import('./security.js'), { getSetting } = await import('./settings.js');
  if (await getSetting(u.id, 'passkeyOnly')) return res.status(403).json({ error: 'This account signs in with a passkey only. Use "Sign in with a passkey".', passkeyRequired: true });
  // Typing rhythm that does not match the account's history asks for the second factor (or a
  // passkey); without either, the session must confirm itself before trading or moving money.
  const beh = await sec.checkLoginBehavior(u.id, req.body.kd).catch(() => ({}));
  const hash = await createSession(res, req, u.id, !!u.totp_enabled);
  if (beh.unusual) {
    await audit(u.id, 'login_unusual_typing', { score: beh.score }, req.ip);
    if (!u.totp_enabled) sec.stepUpSessions.set(hash, 'login');
  }
  await audit(u.id, u.totp_enabled ? 'login_password_ok' : 'login', null, req.ip);
  res.json(u.totp_enabled ? { mfaRequired: true } : { user: publicUser(u) });
});

router.post('/mfa', async (req, res) => {
  const u = req.pending;
  if (!u) return res.status(401).json({ error: 'Sign in first' });
  if (!rateLimit('mfa:' + u.id, 6, 5 * 60e3)) return res.status(429).json({ error: 'Too many codes' });
  if (!verifyTotp(u.totp_secret, req.body.code)) { await audit(u.id, 'mfa_failed', null, req.ip); return res.status(401).json({ error: 'Invalid code' }); }
  await run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
  await createSession(res, req, u.id, false);
  await audit(u.id, 'login', { mfa: true }, req.ip);
  res.json({ user: publicUser(u) });
});

// Sign in with a text-message code, for accounts with a verified phone. The owner's phone numbers
// (Admin → Admins) sign in to the owner account even before the number is linked to it.
const phoneCodes = new Map(); // phone -> { userId, hash, exp, tries }
router.post('/phone/start', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'Enter your phone number, e.g. 845 555 1234' });
  if (!rateLimit('plogin:' + req.ip, 10, 3600e3) || !rateLimit('plogin:' + phone, 5, 3600e3)) return res.status(429).json({ error: 'Too many codes requested, try later' });
  let u = await one('SELECT id FROM users WHERE phone = ? AND phone_verified = 1', phone);
  if (!u && isAdminPhone(phone)) {
    const emails = allAdminEmails();
    // The owner's account (an admin email, made admin on its next visit if not yet), or a new one.
    u = await one(`SELECT id FROM users WHERE email IN (${emails.map(() => '?').join(',')}) ORDER BY role = 'admin' DESC, id LIMIT 1`, ...emails)
      || { id: await createUser({ email: OWNER_EMAILS[0], verified: true }) };
  }
  // Same answer whether or not the number has an account, so the form cannot reveal who signed up.
  let devCode;
  if (u) {
    const code = String(crypto.randomInt(100000, 1000000));
    phoneCodes.set(phone, { userId: u.id, hash: sha256(code), exp: now() + 10 * 60e3, tries: 0 });
    const sent = await sendSms(phone, `QuantPocket sign-in code: ${code}`).catch(e => { console.warn('sms', e.message); return {}; });
    if (sent.simulated && process.env.NODE_ENV !== 'production') devCode = code;
  }
  res.json({ ok: true, devCode });
});
router.post('/phone/verify', async (req, res) => {
  const phone = normalizePhone(req.body.phone), p = phoneCodes.get(phone);
  if (!p || p.exp < now()) return res.status(400).json({ error: 'This code expired. Request a new one.' });
  if (++p.tries > 5) { phoneCodes.delete(phone); return res.status(429).json({ error: 'Too many attempts. Request a new code.' }); }
  if (sha256(String(req.body.code || '').trim()) !== p.hash) return res.status(401).json({ error: 'Wrong code' });
  phoneCodes.delete(phone);
  const u = await one('SELECT * FROM users WHERE id = ?', p.userId);
  if (!u) return res.status(400).json({ error: 'Account not found' });
  if (u.locked_until > now()) return res.status(423).json({ error: 'Account temporarily locked after failed attempts' });
  // The code proved the number belongs to this person: link it if the account has none yet.
  if (!u.phone || u.phone === phone) {
    await run('UPDATE users SET phone = NULL WHERE phone = ? AND id != ? AND phone_verified = 0', phone, u.id);
    await run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', phone, u.id);
  }
  await createSession(res, req, u.id, !!u.totp_enabled);
  await audit(u.id, u.totp_enabled ? 'login_phone_ok' : 'login', { phone: true }, req.ip);
  res.json(u.totp_enabled ? { mfaRequired: true } : { user: publicUser(await one('SELECT * FROM users WHERE id = ?', u.id)) });
});

router.post('/logout', async (req, res) => {
  if (req.sessionHash) await run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
  setCookie(res, '', 0);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => res.json({ user: publicUser(req.user) || null, mfaPending: !!req.pending }));

router.post('/totp/setup', requireUser, async (req, res) => {
  const secret = newTotpSecret();
  await run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', secret, req.user.id);
  const uri = `otpauth://totp/QuantPocket:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=QuantPocket`;
  res.json({ secret, uri });
});
router.post('/totp/enable', requireUser, async (req, res) => {
  if (!verifyTotp(req.user.totp_secret, req.body.code)) return res.status(400).json({ error: 'Code does not match' });
  await run('UPDATE users SET totp_enabled = 1 WHERE id = ?', req.user.id);
  await audit(req.user.id, 'totp_enabled', null, req.ip);
  res.json({ ok: true });
});
router.post('/totp/disable', requireUser, async (req, res) => {
  if (!confirmsIdentity(req.user, req.body)) return res.status(401).json({ error: req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password' });
  await run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', req.user.id);
  await audit(req.user.id, 'totp_disabled', null, req.ip);
  res.json({ ok: true });
});

router.post('/password', requireUser, async (req, res) => {
  // Google-only accounts have no current password to check; they are adding their first one.
  if (req.user.password_set !== 0 && !verifySecret(String(req.body.current || ''), req.user.pass_hash)) return res.status(401).json({ error: 'Wrong current password' });
  if (!validPassword(req.body.next)) return res.status(400).json({ error: 'Password needs 10+ characters with upper, lower and a digit' });
  await run('UPDATE users SET pass_hash = ?, password_set = 1 WHERE id = ?', hashSecret(req.body.next), req.user.id);
  await run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, req.sessionHash);
  await audit(req.user.id, 'password_changed', null, req.ip);
  res.json({ ok: true });
});

router.get('/sessions', requireUser, async (req, res) => {
  res.json((await all('SELECT token_hash, ip, ua, created_at, expires_at FROM sessions WHERE user_id = ? AND mfa_pending = 0 AND expires_at > ? ORDER BY created_at DESC', req.user.id, now()))
    .map(s => ({ id: s.token_hash.slice(0, 16), current: s.token_hash === req.sessionHash, ip: s.ip, ua: s.ua, createdAt: s.created_at })));
});
router.delete('/sessions/:id', requireUser, async (req, res) => {
  await run("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?", req.user.id, req.params.id);
  res.json({ ok: true });
});
router.get('/audit', requireUser, async (req, res) => {
  res.json(await all('SELECT event, detail, ip, at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id));
});

// Links in emails point at PUBLIC_URL; without it, at the address the request came in on (never localhost on a real host).
const appUrl = req => (process.env.PUBLIC_URL || (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000')).replace(/\/$/, '');
// Finds an account by email the way people type it: any case, and for Gmail with or without dots or +tags.
export async function userByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const exact = await one('SELECT * FROM users WHERE email = ?', e);
  if (exact || !/@(gmail|googlemail)\.com$/.test(e)) return exact;
  const want = canonicalEmail(e);
  for (const u of await all("SELECT * FROM users WHERE email LIKE '%@gmail.com' OR email LIKE '%@googlemail.com'")) if (canonicalEmail(u.email) === want) return u;
  return null;
}

async function sendVerification(userId, email) {
  const token = randomToken();
  await run('UPDATE users SET verify_hash = ? WHERE id = ?', sha256(token), userId);
  return sendEmail(email, 'Confirm your QuantPocket email',
    `Welcome to QuantPocket.\n\nConfirm your email address:\n${appUrl()}/app#/verify?token=${token}\n\nIf you did not sign up, ignore this message.`);
}

router.post('/verify/resend', requireUser, async (req, res) => {
  if (!rateLimit('verify:' + req.user.id, 3, 3600e3)) return res.status(429).json({ error: 'Try again later' });
  await sendVerification(req.user.id, req.user.email);
  res.json({ ok: true, simulated: !emailEnabled() });
});
router.post('/verify', async (req, res) => {
  const u = await one('SELECT id FROM users WHERE verify_hash = ?', sha256(String(req.body.token || '')));
  if (!u) return res.status(400).json({ error: 'This link is invalid or was already used' });
  await run('UPDATE users SET email_verified = 1, verify_hash = NULL WHERE id = ?', u.id);
  await audit(u.id, 'email_verified', null, req.ip);
  res.json({ ok: true });
});

// Always answers the same way so the form cannot be used to discover registered emails.
// Always answers the same way, so the form cannot reveal who has an account. By email: a link
// valid for an hour. By phone (an account's verified number): a 6-digit code valid for 15 minutes.
router.post('/forgot', async (req, res) => {
  if (!rateLimit('forgot:' + req.ip, 5, 3600e3)) return res.status(429).json({ error: 'Too many requests, try later' });
  if (req.body.phone) {
    const phone = normalizePhone(req.body.phone);
    if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'Enter your phone number, e.g. 845 555 1234' });
    if (!smsEnabled()) return res.json({ ok: true, unavailable: true });
    const u = await one('SELECT id FROM users WHERE phone = ? AND phone_verified = 1', phone);
    let devCode;
    if (u && rateLimit('forgotsms:' + phone, 3, 3600e3)) {
      const code = String(crypto.randomInt(100000, 1000000));
      await run('UPDATE users SET reset_hash = ?, reset_expires = ? WHERE id = ?', sha256('sms:' + code), now() + 15 * 60e3, u.id);
      const sent = await sendSms(phone, `QuantPocket password reset code: ${code} (valid 15 minutes)`).catch(e => { console.warn('reset sms', e.message); return {}; });
      if (sent.simulated && process.env.NODE_ENV !== 'production') devCode = code;
      await audit(u.id, 'password_reset_requested', { by: 'sms' }, req.ip);
    }
    return res.json({ ok: true, devCode });
  }
  // Without an email service nothing could arrive: say so (the same for every address).
  if (!emailEnabled()) { console.warn('Password reset requested but RESEND_API_KEY is not set'); return res.json({ ok: true, unavailable: true }); }
  const u = await userByEmail(req.body.email);
  if (u) {
    const token = randomToken();
    await run('UPDATE users SET reset_hash = ?, reset_expires = ? WHERE id = ?', sha256(token), now() + 3600e3, u.id);
    await sendEmail(u.email, 'Reset your QuantPocket password',
      `Someone asked to reset your password.\n\nChoose a new one (link valid for 1 hour):\n${appUrl(req)}/app#/reset?token=${token}\n\nIf this was not you, ignore this message.`)
      .catch(e => { console.warn('reset email', e.message); noteEmailError(e.message); });
    await audit(u.id, 'password_reset_requested', null, req.ip);
  }
  res.json({ ok: true });
});
router.post('/reset', async (req, res) => {
  // A link token, or a texted code together with the phone number it was sent to.
  let u;
  if (req.body.phone) {
    if (!rateLimit('resetcode:' + req.ip, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts, try later' });
    u = await one('SELECT * FROM users WHERE phone = ? AND phone_verified = 1 AND reset_hash = ? AND reset_expires > ?', normalizePhone(req.body.phone), sha256('sms:' + String(req.body.code || '').trim()), now());
    if (!u) return res.status(400).json({ error: 'Wrong or expired code' });
  } else {
    u = await one('SELECT * FROM users WHERE reset_hash = ? AND reset_expires > ?', sha256(String(req.body.token || '')), now());
    if (!u) return res.status(400).json({ error: 'This link is invalid or expired' });
  }
  if (!validPassword(req.body.password)) return res.status(400).json({ error: 'Password needs 10+ characters with upper, lower and a digit' });
  await run('UPDATE users SET pass_hash = ?, password_set = 1, reset_hash = NULL, reset_expires = NULL, failed_logins = 0, locked_until = 0, email_verified = 1 WHERE id = ?', hashSecret(req.body.password), u.id);
  await run('DELETE FROM sessions WHERE user_id = ?', u.id);
  await audit(u.id, 'password_reset', null, req.ip);
  res.json({ ok: true });
});

// Privacy: download everything stored about the account, or delete it.
router.get('/export', requireUser, async (req, res) => {
  const id = req.user.id, t = sql => all(sql, id);
  const data = {
    profile: publicUser(req.user),
    strategies: await t('SELECT * FROM strategies WHERE user_id = ?'),
    fills: await t('SELECT * FROM fills WHERE user_id = ?'),
    positions: await t('SELECT * FROM positions WHERE user_id = ?'),
    scheduled: await t('SELECT * FROM scheduled_orders WHERE user_id = ?'),
    alerts: await t('SELECT * FROM alerts WHERE user_id = ?'),
    webhooks: await t('SELECT id, name, accounts, size_mode, size, max_position, max_trades_day, symbols, enabled, created_at FROM signal_hooks WHERE user_id = ?'),
    signals: await t('SELECT * FROM signals WHERE user_id = ?'),
    libraryStrategies: await t('SELECT id, name, template_id, spec, account, allocation, cash_buffer, mode, stop_pct, created_at FROM user_strategies WHERE user_id = ?'),
    ledger: await t('SELECT * FROM ledger WHERE user_id = ?'),
    securityLog: await t('SELECT event, ip, at FROM audit_log WHERE user_id = ?'),
  };
  res.attachment('quantpocket-export.json').json(data);
});
router.post('/delete', requireUser, async (req, res) => {
  if (!confirmsIdentity(req.user, req.body)) return res.status(401).json({ error: req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password' });
  await audit(null, 'account_deleted', { id: req.user.id }, req.ip);
  // Explicit deletes: hosted libSQL does not always enforce ON DELETE CASCADE.
  await tx(async ({ run }) => {
    await run('DELETE FROM strategy_days WHERE strategy_id IN (SELECT id FROM user_strategies WHERE user_id = ?)', req.user.id);
    for (const t of ['sessions', 'api_tokens', 'drip_log', 'credentials', 'strategies', 'paper_accounts', 'positions', 'fills', 'equity_history', 'scheduled_orders', 'fee_state', 'ledger', 'alerts', 'signal_hooks', 'signals', 'user_strategies', 'strategy_runs', 'pair_bots'])
      await run(`DELETE FROM ${t} WHERE user_id = ?`, req.user.id);
    await run('DELETE FROM users WHERE id = ?', req.user.id);
  });
  setCookie(res, '', 0);
  res.json({ ok: true });
});
