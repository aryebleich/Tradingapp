// "Continue with GitHub": OAuth authorization-code flow for sign-in and sign-up.
// Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (github.com → Settings → Developer settings →
// OAuth Apps); the callback URL is PUBLIC_URL/auth/github/callback.
import express from 'express';
import crypto from 'node:crypto';
import { one, run, now, audit } from './db.js';
import { hashSecret, randomToken, safeEqual } from './crypto.js';
import { createSession, createUser, rateLimit } from './auth.js';

export const githubEnabled = () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
const WEB = () => (process.env.GITHUB_URL || 'https://github.com').replace(/\/$/, '');
const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const appUrl = () => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const redirectUri = () => appUrl() + '/auth/github/callback';
const STATE_COOKIE = 'qp_ghstate';
const STATE_MS = 10 * 60e3;
const states = new Map(); // state -> { ref, at }

function stateCookie(res, value, ms) {
  res.append('Set-Cookie', `${STATE_COOKIE}=${value}; Path=/auth/github; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ms / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === name)?.[1] || '';
const fail = (res, msg) => res.redirect('/app#/login?error=' + encodeURIComponent(msg));

// GitHub's id and its primary, verified email. Unverified addresses are never used to link accounts.
async function identity(token) {
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'Brightfolio' };
  const [u, emails] = await Promise.all([
    fetch(API() + '/user', { headers: h, signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : null),
    fetch(API() + '/user/emails', { headers: h, signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : []),
  ]);
  if (!u?.id) throw new Error('GitHub did not share your profile. Please try again.');
  const e = (Array.isArray(emails) ? emails : []).find(x => x.primary && x.verified) || (Array.isArray(emails) ? emails : []).find(x => x.verified);
  if (!e?.email) throw new Error('Add and verify an email address on GitHub first.');
  return { id: String(u.id), email: String(e.email).trim().toLowerCase() };
}

// Finds the account for this GitHub user, links it to an account with the same verified email, or
// creates a new one. Returns { user, created }.
async function accountFor({ id, email }, ref, ip) {
  let u = await one('SELECT * FROM users WHERE github_id = ?', id);
  if (u) return { user: u, created: false };
  u = await one('SELECT * FROM users WHERE email = ?', email);
  if (u) {
    // Same rule as Google: an unconfirmed password account with this email loses its password and sessions.
    if (!u.email_verified) {
      await run('UPDATE users SET pass_hash = ?, password_set = 0 WHERE id = ?', hashSecret(randomToken()), u.id);
      await run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    await run('UPDATE users SET github_id = ?, email_verified = 1, verify_hash = NULL WHERE id = ?', id, u.id);
    await audit(u.id, 'github_linked', null, ip);
    return { user: await one('SELECT * FROM users WHERE id = ?', u.id), created: false };
  }
  const uid = await createUser({ email, ref, verified: true });
  await run('UPDATE users SET github_id = ? WHERE id = ?', id, uid);
  await audit(uid, 'register', { github: true }, ip);
  return { user: await one('SELECT * FROM users WHERE id = ?', uid), created: true };
}

export const router = express.Router();

router.get('/', (req, res) => {
  if (!githubEnabled()) return fail(res, 'GitHub sign-in is not set up yet. Use your email instead.');
  if (!rateLimit('github:' + req.ip, 30, 15 * 60e3)) return fail(res, 'Too many attempts, try again in a few minutes.');
  for (const [k, v] of states) if (now() - v.at > STATE_MS) states.delete(k);
  const state = crypto.randomBytes(24).toString('base64url');
  const ref = /^[a-z0-9]{6,12}$/.test(String(req.query.ref || '')) ? String(req.query.ref) : null;
  states.set(state, { ref, at: now() });
  stateCookie(res, state, STATE_MS);
  const p = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: redirectUri(), scope: 'read:user user:email', state, allow_signup: 'true' });
  res.redirect(`${WEB()}/login/oauth/authorize?${p}`);
});

router.get('/callback', async (req, res) => {
  const state = String(req.query.state || ''), saved = states.get(state);
  states.delete(state);
  stateCookie(res, '', 0);
  if (req.query.error) return fail(res, req.query.error === 'access_denied' ? 'GitHub sign-in was cancelled.' : 'GitHub sign-in failed. Please try again.');
  if (!saved || now() - saved.at > STATE_MS || !safeEqual(cookie(req, STATE_COOKIE), state)) return fail(res, 'This GitHub sign-in expired. Please try again.');
  try {
    const r = await fetch(WEB() + '/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: String(req.query.code || ''), redirect_uri: redirectUri() }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error('GitHub did not accept the sign-in. Please try again.');
    const { user, created } = await accountFor(await identity(d.access_token), saved.ref, req.ip);
    await createSession(res, req, user.id, !!user.totp_enabled);
    await audit(user.id, user.totp_enabled ? 'login_github_ok' : 'login', { github: true }, req.ip);
    res.redirect(user.totp_enabled ? '/app#/mfa' : created ? '/app#/dashboard?welcome=1' : '/app#/dashboard');
  } catch (e) { fail(res, e.message); }
});
