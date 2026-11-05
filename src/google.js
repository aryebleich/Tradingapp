// "Continue with Google": OpenID Connect authorization-code flow for sign-in and sign-up.
// Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; the redirect URI is <each app address>/auth/google/callback.
import express from 'express';
import crypto from 'node:crypto';
import { one, run, now, audit } from './db.js';
import { hashSecret, randomToken, safeEqual, hmac } from './crypto.js';
import { createSession, createUser, rateLimit } from './auth.js';

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
import { ownBase, publicUrl as appUrl } from './origin.js';
// Finishes on the address the user is on when it is one of ours (each one is listed in Google's
// "Authorized redirect URIs"), otherwise on PUBLIC_URL.
const redirectUri = req => (ownBase(req) || appUrl()) + '/auth/google/callback';
const STATE_COOKIE = 'qp_gstate';
// A sign-in may take up to an hour at Google (choosing an account, 2-step verification).
const STATE_MS = 60 * 60e3;

// The state is signed by the server (no server memory), so a restart or a deploy while the user is
// at Google does not break the sign-in. It is also kept in a cookie on this browser, so a callback
// started in someone else's browser (login CSRF) is rejected.
export function makeState(ref, t = now()) {
  const body = Buffer.from(JSON.stringify({ n: crypto.randomBytes(16).toString('base64url'), r: ref || null, t })).toString('base64url');
  return `${body}.${hmac('gstate:' + body)}`;
}
export function readState(state, t = now()) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || !safeEqual(sig, hmac('gstate:' + body))) return null;
  let d; try { d = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!(t - d.t < STATE_MS) || d.t > t + 60e3) return null;
  return { nonce: d.n, ref: d.r, at: d.t };
}
function stateCookie(res, value, ms) {
  res.append('Set-Cookie', `${STATE_COOKIE}=${value}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ms / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === name)?.[1] || '';
const fail = (res, msg) => res.redirect('/app#/login?error=' + encodeURIComponent(msg));

// Google's id_token comes straight from Google's token endpoint over TLS, authenticated with our
// client secret, so its claims can be read without checking the signature (Google's OIDC guide).
function claims(idToken, nonce) {
  let c;
  try { c = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString()); } catch { throw new Error('Google sent an unreadable sign-in token.'); }
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(c.iss)) throw new Error('Sign-in token was not issued by Google.');
  if (c.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('Sign-in token is for a different app.');
  if (!(c.exp * 1000 > now())) throw new Error('Google sign-in expired. Please try again.');
  if (!c.nonce || !safeEqual(c.nonce, nonce)) throw new Error('Google sign-in could not be verified. Please try again.');
  if (!c.sub || !c.email) throw new Error('Google did not share an email address.');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new Error('Verify your Google email address first.');
  return { sub: String(c.sub), email: String(c.email).trim().toLowerCase() };
}

// Finds the account for this Google identity, links it to an existing account with the same
// email, or creates a new one. Returns { user, created }.
async function accountFor({ sub, email }, ref, ip) {
  let u = await one('SELECT * FROM users WHERE google_sub = ?', sub);
  if (u) return { user: u, created: false };
  u = await one('SELECT * FROM users WHERE email = ?', email);
  if (u) {
    // Someone could have registered this email with a password before its owner arrived. Google has
    // now proven ownership, so an unconfirmed account's password and sessions are discarded.
    if (!u.email_verified) {
      await run('UPDATE users SET pass_hash = ?, password_set = 0 WHERE id = ?', hashSecret(randomToken()), u.id);
      await run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    await run('UPDATE users SET google_sub = ?, email_verified = 1, verify_hash = NULL WHERE id = ?', sub, u.id);
    await audit(u.id, 'google_linked', null, ip);
    return { user: await one('SELECT * FROM users WHERE id = ?', u.id), created: false };
  }
  const id = await createUser({ email, ref, googleSub: sub, verified: true });
  await audit(id, 'register', { google: true }, ip);
  return { user: await one('SELECT * FROM users WHERE id = ?', id), created: true };
}

export const router = express.Router();

router.get('/', (req, res) => {
  if (!googleEnabled()) return fail(res, 'Google sign-in is not set up yet. Use your email instead.');
  if (!rateLimit('google:' + req.ip, 30, 15 * 60e3)) return fail(res, 'Too many attempts, try again in a few minutes.');
  // An address that is not ours starts again on PUBLIC_URL, where Google sends the user back.
  if (!ownBase(req) && process.env.PUBLIC_URL && req.get('host') !== new URL(appUrl()).host) return res.redirect(appUrl() + req.originalUrl);
  const ref = /^[a-z0-9]{6,12}$/.test(String(req.query.ref || '')) ? String(req.query.ref) : null;
  const state = makeState(ref), nonce = readState(state).nonce;
  stateCookie(res, state, STATE_MS);
  const p = new URLSearchParams({ response_type: 'code', client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), scope: 'openid email profile', state, nonce, prompt: 'select_account' });
  res.redirect(`${AUTH_URL()}?${p}`);
});

router.get('/callback', async (req, res) => {
  const state = String(req.query.state || ''), saved = readState(state);
  stateCookie(res, '', 0);
  if (req.query.error) return fail(res, req.query.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed. Please try again.');
  // A sign-in that ran out (or lost its cookie) starts again by itself once; Google remembers the
  // account, so this is one quick hop instead of an error.
  if (!saved || !safeEqual(cookie(req, STATE_COOKIE), state)) {
    if (cookie(req, 'qp_gretry') !== '1') { res.append('Set-Cookie', `qp_gretry=1; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=120${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); return res.redirect('/auth/google'); }
    return fail(res, 'Google sign-in could not be completed. Please try again.');
  }
  try {
    const r = await fetch(TOKEN_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code || ''), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req) }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.id_token) throw new Error('Google did not accept the sign-in. Please try again.');
    const { user, created } = await accountFor(claims(d.id_token, saved.nonce), saved.ref, req.ip);
    await createSession(res, req, user.id, !!user.totp_enabled);
    res.append('Set-Cookie', 'qp_gretry=; Path=/auth/google; Max-Age=0');
    await audit(user.id, user.totp_enabled ? 'login_google_ok' : 'login', { google: true }, req.ip);
    res.redirect(user.totp_enabled ? '/app#/mfa' : created ? '/app#/dashboard?welcome=1' : '/app#/dashboard');
  } catch (e) { fail(res, e.message); }
});
