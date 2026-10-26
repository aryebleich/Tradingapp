// Admin → Admins, Business mode and Keys: who is an admin, software-only or registered-adviser
// mode, and every environment value (API keys), with .env import/export and Render sync.
import express from 'express';
import { all, run, audit } from './db.js';
import { requireUser, requireAdmin, confirmsIdentity, adminEmails, allAdminEmails, canonicalEmail } from './auth.js';
import * as S from './site.js';

export const adminSiteRouter = express.Router();
adminSiteRouter.use(requireUser, requireAdmin);
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// ---------- admins ----------
adminSiteRouter.get('/admins', wrap(async (req, res) => res.json({
  builtIn: S.OWNER_EMAILS, fromEnv: adminEmails(), added: S.addedAdminEmails(),
  phones: { builtIn: S.OWNER_PHONES, added: S.siteGet('adminPhones', []) },
})));
adminSiteRouter.post('/admins', wrap(async (req, res) => {
  const { email, phone } = req.body || {};
  if (email) {
    const e = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('Enter a valid email');
    if (!allAdminEmails().map(canonicalEmail).includes(canonicalEmail(e))) await S.siteSet('adminEmails', [...S.addedAdminEmails(), e]);
    // An existing account with this address becomes admin at once.
    for (const u of await all('SELECT id, email FROM users')) if (canonicalEmail(u.email) === canonicalEmail(e)) await run("UPDATE users SET role = 'admin' WHERE id = ?", u.id);
  }
  if (phone) {
    const p = S.normalizePhone(phone);
    if (!/^\+\d{10,15}$/.test(p)) throw bad('Enter a valid phone number');
    if (!S.adminPhones().includes(p)) await S.siteSet('adminPhones', [...S.siteGet('adminPhones', []), p]);
    await run("UPDATE users SET role = 'admin' WHERE phone = ? AND phone_verified = 1", p);
  }
  if (!email && !phone) throw bad('Enter an email or a phone number');
  await audit(req.user.id, 'admin_added', { email, phone }, req.ip);
  res.json({ ok: true });
}));
// Removing takes the address off the list; the account keeps admin until changed in Users.
adminSiteRouter.delete('/admins', wrap(async (req, res) => {
  const e = String(req.query.email || '').toLowerCase(), p = S.normalizePhone(req.query.phone);
  if (e) {
    if (S.OWNER_EMAILS.map(canonicalEmail).includes(canonicalEmail(e))) throw bad('The owner addresses are built in');
    await S.siteSet('adminEmails', S.addedAdminEmails().filter(x => canonicalEmail(x) !== canonicalEmail(e)));
  }
  if (req.query.phone) {
    if (S.OWNER_PHONES.includes(p)) throw bad('The owner phone is built in');
    await S.siteSet('adminPhones', S.siteGet('adminPhones', []).filter(x => x !== p));
  }
  await audit(req.user.id, 'admin_removed', { email: e || undefined, phone: p || undefined }, req.ip);
  res.json({ ok: true });
}));

// ---------- business mode ----------
adminSiteRouter.get('/mode', (req, res) => res.json({ adviser: S.adviserMode() }));
adminSiteRouter.put('/mode', wrap(async (req, res) => {
  const on = req.body?.adviser === true;
  // Switching to adviser mode is a statement that the business is registered.
  if (on && req.body?.registered !== true) throw bad('Confirm that the business is a registered investment adviser (SEC or state) first');
  await S.siteSet('adviserMode', on);
  await audit(req.user.id, 'adviser_mode', { on, crd: req.body?.crd || null }, req.ip);
  if (req.body?.crd !== undefined) await S.siteSet('adviserCrd', String(req.body.crd || '').slice(0, 20));
  res.json({ adviser: on });
}));

// ---------- keys (environment values) ----------
const row = k => {
  const v = process.env[k];
  return { key: k, set: v !== undefined && v !== '', secret: S.isSecretName(k), value: v === undefined ? '' : S.isSecretName(k) ? S.mask(v) : v, restart: S.needsRestart(k), fromHost: S.fromHost(k) };
};
adminSiteRouter.get('/env', (req, res) => {
  const known = new Set(S.ENV_GROUPS.flatMap(([, keys]) => keys));
  const saved = Object.keys(process.env).filter(k => !known.has(k) && S.siteGet('envKeys', []).includes(k));
  res.json({
    groups: [...S.ENV_GROUPS, ...(saved.length ? [['Added', saved]] : [])].map(([name, keys]) => ({ name, rows: keys.map(row) })),
    render: { enabled: S.renderEnabled(), onRender: !!process.env.RENDER },
  });
});
// Saves values: they work at once in this server, are kept (encrypted) in the database, and are
// sent to Render when it is connected, so they survive restarts.
async function apply(req, changes, toRender) {
  for (const k of Object.keys(changes)) S.checkEnvChange(k);
  const live = {};
  for (const [k, v] of Object.entries(changes)) {
    if (!S.needsRestart(k)) { if (v === null || v === '') delete process.env[k]; else process.env[k] = String(v); }
    live[k] = v;
  }
  await S.saveEnv(live);
  await S.siteSet('envKeys', [...new Set([...S.siteGet('envKeys', []), ...Object.keys(changes)])]);
  let render = null;
  if (toRender && S.renderEnabled()) render = await S.renderPut(changes);
  await audit(req.user.id, 'env_changed', { keys: Object.keys(changes), render: !!render }, req.ip);
  return { ok: true, keys: Object.keys(changes), render, restart: Object.keys(changes).filter(S.needsRestart) };
}
adminSiteRouter.put('/env', wrap(async (req, res) => {
  const { key, value, render = true } = req.body || {};
  const k = String(key || '').trim().toUpperCase();
  res.json(await apply(req, { [k]: value == null ? '' : String(value) }, render));
}));
adminSiteRouter.post('/env/import', wrap(async (req, res) => {
  const parsed = S.parseDotenv(req.body?.text);
  // Masked values copied from this page (abc•••1234) are never saved over the real ones.
  const changes = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => !v.includes('•') && !['NODE_ENV', 'PORT', 'RENDER', 'HOSTNAME', 'RENDER_SERVICE_ID'].includes(k)));
  if (!Object.keys(changes).length) throw bad('No KEY=value lines found');
  res.json(await apply(req, changes, req.body?.render !== false));
}));
// The real values, as a .env file. Asks for the password (or email, for Google-only accounts).
adminSiteRouter.post('/env/export', wrap(async (req, res) => {
  if (!confirmsIdentity(req.user, req.body || {})) throw Object.assign(new Error(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password'), { status: 401 });
  const keys = [...new Set([...S.ENV_GROUPS.flatMap(([, k]) => k), ...S.siteGet('envKeys', [])])].filter(k => process.env[k]);
  await audit(req.user.id, 'env_exported', { n: keys.length }, req.ip);
  res.type('text/plain').attachment('quantpocket.env').send(`# QuantPocket settings, exported ${new Date().toISOString()}\n# Keep this file private: it holds your secret keys.\n` + S.toDotenv(Object.fromEntries(keys.map(k => [k, process.env[k]]))));
}));
// Render → here: loads every value set on Render into this server (until its next restart, when
// Render's own values apply anyway).
adminSiteRouter.post('/env/render/pull', wrap(async (req, res) => {
  const env = await S.renderEnv();
  const keys = Object.keys(env).filter(k => S.validEnvName(k) && !S.needsRestart(k) && !['NODE_ENV', 'PORT'].includes(k));
  for (const k of keys) process.env[k] = env[k];
  await audit(req.user.id, 'env_render_pull', { n: keys.length }, req.ip);
  res.json({ ok: true, keys });
}));
// Here → Render: sends every known value to Render, then optionally redeploys.
adminSiteRouter.post('/env/render/push', wrap(async (req, res) => {
  const keys = [...new Set([...S.ENV_GROUPS.flatMap(([, k]) => k), ...S.siteGet('envKeys', [])])].filter(k => process.env[k] && !['RENDER_SERVICE_ID'].includes(k));
  const done = await S.renderPut(Object.fromEntries(keys.map(k => [k, process.env[k]])));
  const deploy = req.body?.deploy ? await S.renderDeploy() : null;
  await audit(req.user.id, 'env_render_push', { n: done.length, deploy: !!deploy }, req.ip);
  res.json({ ok: true, keys: done, deploy: deploy?.id || null });
}));
adminSiteRouter.post('/env/render/deploy', wrap(async (req, res) => {
  const d = await S.renderDeploy();
  await audit(req.user.id, 'render_deploy', null, req.ip);
  res.json({ ok: true, deploy: d?.id || null });
}));
