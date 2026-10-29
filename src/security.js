// Account protection.
// - Passkeys (FIDO2 / WebAuthn): Face ID, Touch ID, Windows Hello, Android, or a hardware key such
//   as a YubiKey. They can replace the password for sign-in, and "passkey only" turns password
//   sign-in off for the account.
// - Behavioral signals: typing rhythm on the sign-in form and the interaction pattern during a
//   session are compared with the user's own history. A sign-in that does not match asks for the
//   second factor; a session that stops matching must confirm the password or a passkey before it
//   can trade or withdraw (step-up).
// - Account lock: one tap freezes all orders and withdrawals, cancels open orders and stops the
//   automations; unlocking needs the password (and the 2FA code when it is on).
// - Support agent: answers common questions from the help guide and the user's own account state,
//   opens tickets, and fast-tracks locked or compromised accounts to the security team.
import express from 'express';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { one, all, run, now, audit } from './db.js';
import { requireUser, rateLimit, createSession, publicUser } from './auth.js';
import { verifySecret, verifyTotp, randomToken } from './crypto.js';
import { getSetting, setSetting } from './settings.js';
import { setKill } from './risk.js';
import { notifyUser } from './notify-user.js';
import { llmEnabled, toolChat } from './llm.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const b64 = buf => Buffer.from(buf).toString('base64url');
const origin = req => (process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : `${req.protocol}://${req.get('host')}`);
const rpID = req => new URL(origin(req)).hostname;
const challenges = new Map(); // key -> { challenge, userId?, at }
const putChallenge = (k, v) => { for (const [x, c] of challenges) if (now() - c.at > 5 * 60e3) challenges.delete(x); challenges.set(k, { ...v, at: now() }); };
const takeChallenge = k => { const c = challenges.get(k); challenges.delete(k); return c && now() - c.at < 5 * 60e3 ? c : null; };

// ---------- behavioral signals ----------
// Features: mean and spread of the time between key presses, and of key hold times (ms).
const FEATS = ['flightMean', 'flightSd', 'dwellMean', 'dwellSd'];
export function cleanSample(s) {
  if (!s || typeof s !== 'object') return null;
  const x = Object.fromEntries(FEATS.map(k => [k, +s[k]]));
  return FEATS.every(k => Number.isFinite(x[k]) && x[k] >= 0 && x[k] < 5000) && +s.keys >= 6 ? x : null;
}
// Distance from the user's profile: the average |z| over the features (needs 5 earlier samples).
export function anomaly(profile, x) {
  if (!profile || profile.n < 5 || !x) return null;
  const z = FEATS.map(k => Math.abs(x[k] - profile.mean[k]) / Math.max(profile.sd[k], profile.mean[k] * 0.15, 10));
  return +(z.reduce((a, b) => a + b, 0) / z.length).toFixed(2);
}
export function updateProfile(p, x) {
  const n = Math.min((p?.n || 0) + 1, 50), mean = {}, sd = {};
  for (const k of FEATS) {
    const m0 = p?.mean?.[k] ?? x[k], s0 = p?.sd?.[k] ?? 0, a = 1 / n;
    mean[k] = m0 + a * (x[k] - m0);
    sd[k] = Math.sqrt((1 - a) * (s0 ** 2 + a * (x[k] - m0) ** 2));
  }
  return { n, mean, sd };
}
export const ANOMALY_AT = +process.env.BEHAVIOR_ANOMALY_AT || 3;
const stepUp = new Map(); // session hash -> reason
export const needsStepUp = hash => stepUp.has(hash);

// Called by the sign-in route with the keystroke sample from the password field.
export async function checkLoginBehavior(userId, sample) {
  const x = cleanSample(sample); if (!x) return { score: null };
  const prof = await getSetting(userId, 'behavior');
  const score = anomaly(prof, x);
  if (score == null || score < ANOMALY_AT) await setSetting(userId, 'behavior', updateProfile(prof, x));
  return { score, unusual: score != null && score >= ANOMALY_AT };
}
export { stepUp as stepUpSessions };

// Orders and withdrawals from a session that failed the behavior check wait for a step-up.
export function stepUpGuard(req, res, next) {
  if (req.method !== 'GET' && req.sessionHash && stepUp.has(req.sessionHash)) return res.status(401).json({ error: 'For your security, confirm it is you before trading or moving money.', stepUp: true });
  next();
}

// ---------- account lock ----------
export async function lockAccount(userId, reason, { cancelAlpaca, ip } = {}) {
  await setSetting(userId, 'lock', { on: true, at: now(), reason: String(reason || 'locked by the user').slice(0, 200) });
  const k = await setKill(userId, true, { cancelAlpaca }).catch(() => ({}));
  await run('UPDATE channel_subs SET active = 0 WHERE user_id = ?', userId).catch(() => {});
  await audit(userId, 'account_locked', { reason, cancelled: k.cancelled ?? null }, ip);
  await notifyUser(userId, 'Your Brightfolio account was locked: orders and withdrawals are frozen. If this was not you, reply to support right away.').catch(() => {});
  return { locked: true, cancelledOrders: k.cancelled ?? 0 };
}

// ---------- support agent ----------
const HELP = [
  ['password|forgot|reset', 'To reset your password, use "Forgot password?" on the sign-in page; the link is valid for one hour.'],
  ['2fa|two-factor|authenticator|totp', 'Turn on two-factor sign-in under Settings → Security. Passkeys (Face ID, Touch ID, a security key) are even safer.'],
  ['passkey|face id|touch id|yubikey|security key', 'Add a passkey under Security. After that you can sign in with it, and you can switch on "passkey only".'],
  ['lock|hacked|stolen|compromised|unauthori', 'Tap "Lock account" at the top of any page. It freezes orders and withdrawals immediately. Then tell us here what happened.'],
  ['withdraw|transfer|ach|deposit', 'Bank transfers are under Alpaca account → Funding. Deposits take 1 to 3 business days to settle.'],
  ['cancel|subscription|plan|billing|refund', 'Manage or cancel your plan under Plans & billing. Paid plans include a 14-day free trial.'],
  ['bot|strategy|automat', 'Bots are on the Bots page. The kill switch on the Risk page stops every automation at once.'],
  ['fee|performance fee', 'Plans charge a performance fee only on new profits above your high-water mark; deposits never count as profit.'],
];
const faq = text => HELP.find(([k]) => new RegExp(k, 'i').test(text))?.[1];
async function openTicket(user, subject, body, priority = 'normal') {
  const id = (await run('INSERT INTO messages (user_id, name, email, subject, body, at) VALUES (?,?,?,?,?,?)', user.id, priority === 'security' ? 'SECURITY' : 'Support agent', user.email, `${priority === 'security' ? '[URGENT SECURITY] ' : ''}${String(subject).slice(0, 150)}`, String(body).slice(0, 4000), now())).lastInsertRowid;
  return id;
}
async function supportAnswer(user, history, deps) {
  const last = String(history.at(-1)?.content || '');
  const defs = {
    account_status: { description: "The user's own account security state: plan, two-factor, passkeys, lock and kill switch.", schema: {}, required: [],
      run: async () => ({ plan: user.plan, twoFactor: !!user.totp_enabled, passkeys: (await one('SELECT COUNT(*) n FROM passkeys WHERE user_id = ?', user.id)).n, locked: !!(await getSetting(user.id, 'lock'))?.on, emailVerified: !!user.email_verified }) },
    help_article: { description: 'Look up the help guide for a topic (passwords, 2FA, passkeys, lock, transfers, billing, bots, fees).', schema: { topic: { type: 'string' } }, required: ['topic'], run: async ({ topic }) => ({ answer: faq(topic) || 'No article on that; open a ticket.' }) },
    open_ticket: { description: 'Send the conversation to a human. Use for anything you cannot resolve.', schema: { subject: { type: 'string' }, details: { type: 'string' } }, required: ['subject', 'details'],
      run: async ({ subject, details }) => ({ ticket: await openTicket(user, subject, details) }) },
    security_escalation: { description: 'The user reports a hacked, stolen or unauthorized account or trade: lock the account now and open an urgent ticket for the security team.', schema: { details: { type: 'string' } }, required: ['details'],
      run: async ({ details }) => { const l = await lockAccount(user.id, 'support agent: ' + details, deps); return { ...l, ticket: await openTicket(user, 'Account compromise reported', details, 'security') }; } },
  };
  if (llmEnabled()) {
    const r = await toolChat({ webSearch: false, defs, messages: history, system: `You are Brightfolio's support agent. Be brief and kind. Answer from help_article and account_status only; never invent policies.
You cannot reset passwords, change plans, move money or unlock accounts: explain the self-service step or open a ticket.
If the user says the account is hacked, stolen or has unauthorized activity, call security_escalation immediately.
Never ask for passwords, codes or full card numbers. Reply in the user's language.` });
    return { reply: r.text, actions: r.used };
  }
  if (/hack|stolen|compromis|unauthori|not me/i.test(last)) { const r = await defs.security_escalation.run({ details: last }); return { reply: `I locked your account (orders and withdrawals are frozen) and sent ticket #${r.ticket} to our security team as urgent. They will contact you by email.`, actions: ['security_escalation'] }; }
  const a = faq(last);
  if (a) return { reply: a + ' If that does not solve it, write "ticket" and I will pass this to a person.', actions: ['help_article'] };
  if (/ticket|human|person|agent/i.test(last)) { const id = await openTicket(user, 'Support request', history.map(m => `${m.role}: ${m.content}`).join('\n')); return { reply: `Ticket #${id} is open. We reply by email, usually within one business day.`, actions: ['open_ticket'] }; }
  return { reply: 'I can help with sign-in, passkeys and 2FA, locking your account, transfers, billing and bots. What do you need? Write "ticket" to reach a person.', actions: [] };
}

export function securityRouter({ cancelAlpaca }) {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const keys = await all('SELECT id, name, transports, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY id', req.user.id);
    const prof = await getSetting(req.user.id, 'behavior');
    res.json({ passkeys: keys, passkeyOnly: !!(await getSetting(req.user.id, 'passkeyOnly')), lock: await getSetting(req.user.id, 'lock', { on: false }), twoFactor: !!req.user.totp_enabled, behavior: { samples: prof?.n || 0, learning: !prof || prof.n < 5 }, stepUp: needsStepUp(req.sessionHash) });
  });
  // Passkey registration.
  r.post('/passkeys/options', async (req, res) => {
    const existing = await all('SELECT cred_id, transports FROM passkeys WHERE user_id = ?', req.user.id);
    const o = await generateRegistrationOptions({ rpName: 'Brightfolio', rpID: rpID(req), userName: req.user.email, userID: new TextEncoder().encode(String(req.user.id)), attestationType: 'none',
      excludeCredentials: existing.map(c => ({ id: c.cred_id, transports: c.transports ? JSON.parse(c.transports) : undefined })), authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } });
    putChallenge('reg:' + req.user.id, { challenge: o.challenge });
    res.json(o);
  });
  r.post('/passkeys', async (req, res) => {
    const c = takeChallenge('reg:' + req.user.id); if (!c) throw bad('This request expired; try again');
    const v = await verifyRegistrationResponse({ response: req.body.response, expectedChallenge: c.challenge, expectedOrigin: origin(req), expectedRPID: rpID(req), requireUserVerification: false });
    if (!v.verified) throw bad('The passkey could not be verified');
    const cr = v.registrationInfo.credential;
    await run('INSERT INTO passkeys (user_id, cred_id, public_key, counter, transports, name, created_at) VALUES (?,?,?,?,?,?,?)', req.user.id, cr.id, b64(cr.publicKey), cr.counter || 0, JSON.stringify(cr.transports || req.body.response?.response?.transports || []), String(req.body.name || 'Passkey').slice(0, 40), now());
    await audit(req.user.id, 'passkey_added', null, req.ip);
    res.json({ ok: true });
  });
  r.delete('/passkeys/:id', async (req, res) => {
    const n = (await one('SELECT COUNT(*) n FROM passkeys WHERE user_id = ?', req.user.id)).n;
    if (n <= 1 && await getSetting(req.user.id, 'passkeyOnly')) throw bad('Turn off "passkey only" before removing your last passkey');
    await run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', +req.params.id, req.user.id);
    await audit(req.user.id, 'passkey_removed', null, req.ip);
    res.json({ ok: true });
  });
  r.put('/passkey-only', async (req, res) => {
    if (req.body.on && !(await one('SELECT COUNT(*) n FROM passkeys WHERE user_id = ?', req.user.id)).n) throw bad('Add a passkey first');
    await setSetting(req.user.id, 'passkeyOnly', !!req.body.on);
    await audit(req.user.id, req.body.on ? 'passkey_only_on' : 'passkey_only_off', null, req.ip);
    res.json({ passkeyOnly: !!req.body.on });
  });
  // Interaction cadence from the open app, about once a minute.
  r.post('/behavior', async (req, res) => {
    const x = cleanSample(req.body); if (!x) return res.json({ ok: true });
    const prof = await getSetting(req.user.id, 'behavior'), score = anomaly(prof, x);
    if (score != null && score >= ANOMALY_AT * 1.5 && !stepUp.has(req.sessionHash)) { stepUp.set(req.sessionHash, 'interaction'); await audit(req.user.id, 'behavior_step_up', { score }, req.ip); }
    else if (score == null || score < ANOMALY_AT) await setSetting(req.user.id, 'behavior', updateProfile(prof, x));
    res.json({ ok: true, stepUp: stepUp.has(req.sessionHash) });
  });
  r.post('/step-up', async (req, res) => {
    if (!rateLimit('stepup:' + req.user.id, 8, 15 * 60e3)) throw bad('Too many attempts', 429);
    if (!verifySecret(String(req.body.password || ''), req.user.pass_hash || '') ) throw bad('Wrong password', 401);
    if (req.user.totp_enabled && !verifyTotp(req.user.totp_secret, req.body.code)) throw bad('Enter the code from your authenticator app', 401);
    stepUp.delete(req.sessionHash); await audit(req.user.id, 'step_up_ok', null, req.ip);
    res.json({ ok: true });
  });
  // The lock works from any signed-in session, even one waiting for a step-up.
  r.post('/lock', async (req, res) => res.json(await lockAccount(req.user.id, req.body.reason || 'locked by the user', { cancelAlpaca, ip: req.ip })));
  r.post('/unlock', async (req, res) => {
    if (!rateLimit('unlock:' + req.user.id, 6, 15 * 60e3)) throw bad('Too many attempts', 429);
    if (!verifySecret(String(req.body.password || ''), req.user.pass_hash || '')) throw bad('Wrong password', 401);
    if (req.user.totp_enabled && !verifyTotp(req.user.totp_secret, req.body.code)) throw bad('Enter the code from your authenticator app', 401);
    await setSetting(req.user.id, 'lock', { on: false, at: now() });
    await audit(req.user.id, 'account_unlocked', null, req.ip);
    res.json({ locked: false, note: 'Orders and withdrawals work again. The kill switch stays on until you turn it off under Risk controls.' });
  });
  r.post('/support', async (req, res) => {
    if (!rateLimit('support:' + req.user.id, 40, 3600e3)) throw bad('Too many messages this hour', 429);
    const history = (Array.isArray(req.body.messages) ? req.body.messages : []).filter(m => m?.content).slice(-12);
    if (!history.length) throw bad('Write a message');
    res.json(await supportAnswer(req.user, history, { cancelAlpaca, ip: req.ip }));
  });
  return r;
}

// Public sign-in with a passkey (discoverable credential, no email needed).
export function passkeyLoginRouter() {
  const r = express.Router();
  r.post('/options', async (req, res) => {
    if (!rateLimit('pkopt:' + req.ip, 30, 15 * 60e3)) throw bad('Too many attempts', 429);
    const o = await generateAuthenticationOptions({ rpID: rpID(req), userVerification: 'preferred' });
    const id = randomToken(); putChallenge('auth:' + id, { challenge: o.challenge });
    res.json({ ...o, challengeId: id });
  });
  r.post('/verify', async (req, res) => {
    const c = takeChallenge('auth:' + req.body.challengeId); if (!c) throw bad('This sign-in expired; try again');
    const cred = await one('SELECT * FROM passkeys WHERE cred_id = ?', String(req.body.response?.id || ''));
    if (!cred) throw bad('This passkey is not registered here', 401);
    const v = await verifyAuthenticationResponse({ response: req.body.response, expectedChallenge: c.challenge, expectedOrigin: origin(req), expectedRPID: rpID(req), requireUserVerification: false,
      credential: { id: cred.cred_id, publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')), counter: cred.counter, transports: cred.transports ? JSON.parse(cred.transports) : undefined } });
    if (!v.verified) throw bad('The passkey could not be verified', 401);
    await run('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?', v.authenticationInfo.newCounter, now(), cred.id);
    const u = await one('SELECT * FROM users WHERE id = ?', cred.user_id);
    await createSession(res, req, u.id, false); // a passkey is already phishing-resistant multi-factor
    await audit(u.id, 'login', { passkey: true }, req.ip);
    res.json({ user: publicUser(u) });
  });
  return r;
}
