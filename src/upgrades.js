// Admin → Upgrades: every change to how the business runs, in one place. Business mode (software
// only or registered adviser), the owner's Alpaca plans and the GitHub plan.
// Each upgrade needs the owner's password (or email, for Google/GitHub sign-ins) and a typed
// confirmation, is written to the audit log, and moves the site version up: v0.1, v0.2, ...
import express from 'express';
import { audit, now } from './db.js';
import { confirmsIdentity } from './auth.js';
import * as S from './site.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// ---------- the site version ----------
const state = () => { const v = S.siteGet('version', null); return { n: v?.n >= 1 ? v.n : 1, history: Array.isArray(v?.history) ? v.history : [] }; };
export const versionOf = n => `v0.${n}`;
export const version = () => versionOf(state().n);
export const versionHistory = () => state().history;
export async function bump(what, userId = null) {
  const s = state(), n = s.n + 1;
  const entry = { v: versionOf(n), what: String(what).slice(0, 200), at: now(), by: userId };
  await S.siteSet('version', { n, history: [entry, ...s.history].slice(0, 200) });
  return entry;
}

// ---------- GitHub plans ----------
export const GITHUB_PLANS = [
  ['free', 'Free', 0, '2,000 Actions minutes a month for private repositories (public ones are free). Enough for the checks after every push.'],
  ['pro', 'Pro', 4, '3,000 Actions minutes, more Pages and Codespaces hours, required reviewers on private repositories.'],
  ['team', 'Team', 4, 'Per person. For a team: shared repositories, code owners and protected branches on private repositories.'],
  ['enterprise', 'Enterprise', 21, 'Per person. Single sign-on, audit log, 50,000 Actions minutes.'],
].map(([id, name, price, text]) => ({ id, name, price, text }));
const GH = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
async function githubPlan() {
  if (!process.env.GITHUB_TOKEN) return { configured: false };
  const r = await fetch(`${GH()}/user`, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'Brightolio' }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  const u = r?.ok ? await r.json() : null;
  return { configured: true, login: u?.login || null, plan: u?.plan?.name || null };
}
// ---------- routes (under /api/admin/site, admins only) ----------
export const upgradesRouter = express.Router();
const KINDS = ['mode', 'github', 'alpaca'];
const ALPACA = { elite: 'Alpaca Elite', trading: 'Trading plan', data: 'Market data: Algo Trader Plus', options: 'Options level', cash: 'High-yield cash' };

upgradesRouter.get('/upgrades', wrap(async (req, res) => {
  const github = await githubPlan();
  res.json({ version: version(), history: versionHistory(), adviser: S.adviserMode(), crd: S.siteGet('adviserCrd', ''), github, githubPlans: GITHUB_PLANS, alpaca: ALPACA, recorded: S.siteGet('upgradesDone', {}) });
}));

// One upgrade. Body: { kind, to, password | confirm, typed: 'UPGRADE' } (+ registered, crd for adviser mode).
upgradesRouter.post('/upgrades', wrap(async (req, res) => {
  const b = req.body || {}, kind = String(b.kind || ''), to = String(b.to || '');
  if (!KINDS.includes(kind)) throw bad('Pick an upgrade');
  if (String(b.typed || '').trim().toUpperCase() !== 'UPGRADE') throw bad('Type UPGRADE to confirm');
  if (!confirmsIdentity(req.user, b)) throw bad(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password', 401);
  let what;
  if (kind === 'mode') {
    const on = to === 'adviser';
    if (!['adviser', 'software'].includes(to)) throw bad('Pick a business mode');
    // Switching to adviser mode is a statement that the business is registered.
    if (on && b.registered !== true) throw bad('Confirm that the business is a registered investment adviser (SEC or state) first');
    if (on === S.adviserMode()) throw bad(`Already in ${on ? 'registered-adviser' : 'software-only'} mode`);
    await S.siteSet('adviserMode', on);
    if (b.crd !== undefined) await S.siteSet('adviserCrd', String(b.crd || '').slice(0, 20));
    what = on ? `Business mode: registered investment adviser${b.crd ? ` (CRD ${String(b.crd).slice(0, 20)})` : ''}` : 'Business mode: software only';
  } else {
    // GitHub and Alpaca plans change in their own dashboards; this records that it was done.
    const name = kind === 'github' ? GITHUB_PLANS.find(x => x.id === to)?.name : ALPACA[to];
    if (!name) throw bad('Pick a plan');
    const label = kind === 'github' ? `GitHub plan: ${name}` : `Alpaca: ${name}${b.detail ? ` (${String(b.detail).slice(0, 60)})` : ''}`;
    await S.siteSet('upgradesDone', { ...S.siteGet('upgradesDone', {}), [`${kind}:${to}`]: now() });
    what = label;
  }
  const entry = await bump(what, req.user.id);
  await audit(req.user.id, 'upgrade', { kind, to, version: entry.v }, req.ip);
  res.json({ ok: true, version: entry.v, entry });
}));
