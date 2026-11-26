// Site-wide "Require two-factor sign-in" (Admin → Security). Off by default: while it is off nothing
// changes; members may still turn on an authenticator app (TOTP) or add a passkey themselves in
// Settings → Security, and sign-in asks for a code only if they did.
// When the owner turns it on, they choose:
//   scope   admins | live (accounts with a connected real-money brokerage) | all
//   grace   days during which members in scope see a banner with "Set up now"; after it, they must set
//           it up before using the app (only the sign-in, set-up and sign-out routes answer)
// Passkeys always count as two-factor. Turning it on or off needs admin plus the password step-up
// (Admin unlock), is written to the audit log, and shows who changed it and when. Nobody is locked out:
// the set-up routes always answer, and requiring it for admins is refused while no admin has
// two-factor or a passkey (so the owner sets up first).
// Recovery codes: ten one-time codes are made when someone first sets up two-factor or a passkey, if
// they don't have any yet; only their hashes are stored.
import crypto from 'node:crypto';
import { one, all, now } from './db.js';
import { siteGet, siteSet } from './site.js';
import { getSetting, setSetting } from './settings.js';

export const SCOPES = { admins: 'Admins only', live: 'Accounts with live (real-money) trading', all: 'Everyone' };
const DEFAULT = { required: false, scope: 'admins', graceDays: 7, since: null, changedBy: null, changedAt: null };
const DAY = 864e5;
const bad = (m, s = 400, extra = {}) => Object.assign(new Error(m), { status: s, ...extra });

export const mfaPolicy = () => ({ ...DEFAULT, ...(siteGet('mfaPolicy', null) || {}) });

export async function hasSecondFactor(user) {
  if (!user) return false;
  if (user.totp_enabled) return true;
  return ((await one('SELECT COUNT(*) n FROM passkeys WHERE user_id = ?', user.id))?.n || 0) > 0;
}
async function liveTrading(user) {
  try { const { accountsFor } = await import('./ext/routes.js'); return (await accountsFor(user.id)).some(a => a.connected && a.live); } catch { return false; }
}
export async function inScope(user, p = mfaPolicy(), { isLive = liveTrading } = {}) {
  if (!user) return false;
  if (p.scope === 'all') return true;
  if (p.scope === 'admins') return user.role === 'admin';
  if (p.scope === 'live') return user.role === 'admin' || await isLive(user); // admins too: they can switch live trading on for others
  return false;
}

// What one member sees: nothing while the policy is off or they're out of scope or already set up;
// a banner during the grace period; set-up required after it. The grace starts when the policy was
// turned on, or when the member joined if that was later.
export async function mfaStatus(user, t = now(), p = mfaPolicy(), opts = {}) {
  if (!p.required || !user || !(await inScope(user, p, opts))) return { required: false };
  if (await hasSecondFactor(user)) return { required: true, done: true };
  const start = Math.max(p.since || 0, user.created_at || 0), deadline = start + p.graceDays * DAY;
  return { required: true, done: false, deadline, mustSetUp: t >= deadline, grace: t < deadline, scope: p.scope };
}

// Routes that always answer, so a member who must set up is never locked out.
const OPEN = [/^\/auth\//, /^\/security\/passkeys/, /^\/security\/recovery/, /^\/security\/?$/, /^\/me$/, /^\/public\//, /^\/health/];
export function mfaGate() {
  return async (req, res, next) => {
    try {
      if (!req.user || !mfaPolicy().required || OPEN.some(r => r.test(req.path))) return next();
      const s = await mfaStatus(req.user);
      if (s.mustSetUp) return res.status(403).json({ error: 'Set up two-factor sign-in (an authenticator app or a passkey) in Settings → Security to continue.', mfaSetupRequired: true });
      next();
    } catch (e) { next(e); }
  };
}

// The admins who have two-factor or a passkey (for the lock-out check).
export async function adminsWithFactor() {
  const admins = await all("SELECT * FROM users WHERE role = 'admin'");
  const out = [];
  for (const a of admins) if (await hasSecondFactor(a)) out.push(a.id);
  return { admins: admins.length, withFactor: out.length };
}

// Turns the policy on or off (the route checks admin + step-up and writes the audit log).
export async function setMfaPolicy(admin, body = {}) {
  const cur = mfaPolicy(), required = body.required === true;
  const scope = SCOPES[body.scope] ? body.scope : cur.scope;
  const graceDays = Math.max(0, Math.min(90, Math.round(Number.isFinite(+body.graceDays) ? +body.graceDays : cur.graceDays)));
  if (required) {
    // Every scope includes admins (live also covers admins), so at least one admin must already have a second factor.
    const a = await adminsWithFactor();
    if (!a.withFactor) throw bad('No admin has two-factor sign-in or a passkey yet. Set one up for your own account first (Settings → Security), so no admin can be locked out.', 409, { lockout: true });
  }
  const next = { required, scope, graceDays, since: required ? (cur.required ? cur.since : now()) : null, changedBy: admin.email, changedAt: now() };
  await siteSet('mfaPolicy', next);
  return next;
}

// ---------- recovery codes ----------
const hash = c => crypto.createHash('sha256').update(String(c).replace(/[\s-]/g, '').toUpperCase()).digest('hex');
const code = () => { const b = crypto.randomBytes(5).toString('hex').toUpperCase(); return b.slice(0, 5) + '-' + b.slice(5); };
// Ten new codes when the member has none (returned once, stored as hashes); null when they already have some.
export async function ensureRecoveryCodes(userId) {
  const cur = await getSetting(userId, 'recoveryCodes', null);
  if (cur?.length) return null;
  const codes = Array.from({ length: 10 }, code);
  await setSetting(userId, 'recoveryCodes', codes.map(hash));
  return codes;
}
// Uses one code (true once per code).
export async function useRecoveryCode(userId, input) {
  const cur = await getSetting(userId, 'recoveryCodes', null) || [], h = hash(input || '');
  if (!input || !cur.includes(h)) return false;
  await setSetting(userId, 'recoveryCodes', cur.filter(x => x !== h));
  return true;
}
export const recoveryCodesLeft = async userId => ((await getSetting(userId, 'recoveryCodes', null)) || []).length;
