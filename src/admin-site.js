// Admin → Admins, Business mode and Keys: who is an admin, software-only or registered-adviser
// mode, and every environment value (API keys), with .env import/export and Render sync.
import express from 'express';
import { one, all, run, audit } from './db.js';
import { requireUser, requireAdmin, confirmsIdentity, adminEmails, allAdminEmails, canonicalEmail } from './auth.js';
import * as S from './site.js';
import { upgradesRouter, bump } from './upgrades.js';

export const adminSiteRouter = express.Router();
adminSiteRouter.use(requireUser, requireAdmin);
adminSiteRouter.use(upgradesRouter);
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// ---------- admins ----------
// The built-in owner addresses are not in the code (only fingerprints), so the page lists the
// accounts that match them, partly hidden.
const hide = e => String(e).replace(/^(.{2}).*?(@.*)$/, '$1•••$2');
adminSiteRouter.get('/admins', wrap(async (req, res) => {
  const users = await all('SELECT email, phone FROM users ORDER BY id LIMIT 2000');
  res.json({
    builtIn: users.filter(u => S.isOwner(canonicalEmail(u.email))).map(u => hide(u.email)), fromEnv: adminEmails(), added: S.addedAdminEmails(),
    phones: { builtIn: users.filter(u => u.phone && S.isOwner(u.phone)).map(u => u.phone.slice(0, -4).replace(/\d/g, '•') + u.phone.slice(-4)), added: S.siteGet('adminPhones', []) },
  });
}));
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
    if (S.isOwner(canonicalEmail(e))) throw bad('The owner addresses are built in');
    await S.siteSet('adminEmails', S.addedAdminEmails().filter(x => canonicalEmail(x) !== canonicalEmail(e)));
  }
  if (req.query.phone) {
    if (S.isOwner(p)) throw bad('The owner phone is built in');
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
  const changed = on !== S.adviserMode();
  await S.siteSet('adviserMode', on);
  await audit(req.user.id, 'adviser_mode', { on, crd: req.body?.crd || null }, req.ip);
  if (changed) await bump(on ? 'Business mode: registered investment adviser' : 'Business mode: software only', req.user.id);
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
  res.type('text/plain').attachment('quantpocket.env').send(`# Brightfolio settings, exported ${new Date().toISOString()}\n# Keep this file private: it holds your secret keys.\n` + S.toDotenv(Object.fromEntries(keys.map(k => [k, process.env[k]]))));
}));
// Render → here: loads every value set on Render into this server (until its next restart, when
// Render's own values apply anyway).
adminSiteRouter.post('/env/render/pull', wrap(async (req, res) => {
  const env = await S.renderEnv();
  const keys = Object.keys(env).filter(k => S.validEnvName(k) && !S.needsRestart(k) && !S.hostOnly(k));
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

// ---------- money levers: deposit fee, referrals, partner commission ----------
adminSiteRouter.get('/money', wrap(async (req, res) => {
  const { settings } = await import('./revenue.js');
  const sum = async (kind, statuses) => (await one(`SELECT COALESCE(SUM(amount), 0) n FROM ledger WHERE kind = ? AND status IN (${statuses.map(() => '?').join(',')})`, kind, ...statuses)).n;
  res.json({
    settings: settings(),
    stats: {
      depositFees: await sum('deposit_fee', ['collected']), commissions: await sum('broker_commission', ['pending', 'collected']),
      referralCredits: await sum('referral_credit', ['earned', 'applied']), referredPaying: (await one('SELECT COUNT(*) n FROM users WHERE referral_rewarded = 1')).n,
      referredSignups: (await one('SELECT COUNT(*) n FROM users WHERE referred_by IS NOT NULL')).n,
    },
    leaders: await all(`SELECT u.email, COUNT(f.id) invited, SUM(CASE WHEN f.referral_rewarded = 1 THEN 1 ELSE 0 END) paying FROM users u JOIN users f ON f.referred_by = u.id
      GROUP BY u.id ORDER BY paying DESC, invited DESC LIMIT 10`),
  });
}));
adminSiteRouter.put('/money', wrap(async (req, res) => {
  const { saveSettings } = await import('./revenue.js');
  const s = await saveSettings(req.body || {});
  await audit(req.user.id, 'money_settings', s, req.ip);
  res.json({ settings: s });
}));

// ---------- becoming a registered adviser: the steps, ticked off as they are done ----------
export const RIA_STEPS = [
  ['entity', 'Form the business (LLC or corporation), get an EIN and a business bank account', 'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online'],
  ['regulator', 'Pick the regulator: your state (under $100M) or the SEC (internet adviser exemption)', 'https://www.sec.gov/divisions/investment/iaregulation/memoia.htm'],
  ['exam', 'Pass the Series 65 exam (each adviser representative)', 'https://www.finra.org/registration-exams-ce/qualification-exams/series65'],
  ['iard', 'Open and fund an IARD account (FINRA)', 'https://www.iard.com/'],
  ['adv', 'File Form ADV Part 1, Part 2A brochure, Part 2B and Form CRS; each person files a Form U4', 'https://www.sec.gov/iard/iard-forms'],
  ['compliance', 'Write the compliance manual, code of ethics, privacy and cybersecurity policies; name a CCO', 'https://www.sec.gov/investment/compliance-programs'],
  ['approval', 'Registration approved (CRD number received)', 'https://adviserinfo.sec.gov/'],
  ['contracts', 'Advisory agreement and qualified-client check ready for performance fees (Rule 205-3)', 'https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.205-3'],
];
adminSiteRouter.get('/ria', (req, res) => {
  const done = S.siteGet('riaSteps', {});
  res.json({ steps: RIA_STEPS.map(([id, text, link]) => ({ id, text, link, done: !!done[id] })), crd: S.siteGet('adviserCrd', ''), adviser: S.adviserMode() });
});
adminSiteRouter.put('/ria', wrap(async (req, res) => {
  const id = String(req.body?.id || '');
  if (!RIA_STEPS.some(([k]) => k === id)) throw bad('Unknown step');
  await S.siteSet('riaSteps', { ...S.siteGet('riaSteps', {}), [id]: !!req.body.done });
  res.json({ ok: true });
}));

// ---------- the owner's Alpaca account: Elite, trading plan, market data, options, high-yield cash ----------
// Alpaca changes these in its own dashboard; this page shows where the account stands and links there.
adminSiteRouter.get('/alpaca-plans', wrap(async (req, res) => {
  const { tradingFor } = await import('./alpaca/connections.js');
  const { Trading } = await import('./alpaca/trading.js');
  const t = (await tradingFor(req.user.id)) || (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET ? new Trading({ type: 'keys', k: process.env.ALPACA_KEY_ID, s: process.env.ALPACA_SECRET, live: !/paper/.test(process.env.ALPACA_TRADING_URL || 'paper') }) : null);
  if (!t) return res.json({ connected: false });
  const a = await t.account().catch(e => ({ error: e.message }));
  if (a.error) return res.json({ connected: true, error: a.error });
  // Net deposits: money in minus money out, from the account's cash activity.
  const acts = await t.activities({ activity_types: 'CSD,CSW', page_size: 100 }).catch(() => []);
  const net = (Array.isArray(acts) ? acts : []).reduce((s, x) => s + (+x.net_amount || 0), 0);
  // Market data plan: the full SIP feed answers only on a paid subscription.
  let sip = null;
  if (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET) {
    const r = await fetch(`${(process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets').replace(/\/$/, '')}/v2/stocks/SPY/quotes/latest?feed=sip`, { headers: { 'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    sip = r ? r.ok : null;
  }
  res.json({
    connected: true, live: t.live, accountNumber: a.account_number, equity: +a.equity, cash: +a.cash, netDeposits: +net.toFixed(2),
    elite: { threshold: 30000, unlocked: net >= 30000 }, premium: { threshold: 100000, unlocked: net >= 100000 },
    options: { approved: +a.options_approved_level || 0, trading: +a.options_trading_level || 0 },
    marketData: sip === null ? 'unknown' : sip ? 'Algo Trader Plus (SIP)' : 'Basic (IEX)',
    multiplier: +a.multiplier || 1, patternDayTrader: !!a.pattern_day_trader,
  });
}));

// ---------- Yiddish Labs: its own GitHub workflow, run and watched from here ----------
// GITHUB_TOKEN: a fine-grained token for this repository with Actions (read and write) and
// Variables (read and write). GITHUB_REPO defaults to aryebleich/Tradingapp.
const GH = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const repo = () => process.env.GITHUB_REPO || 'aryebleich/Tradingapp';
async function gh(method, p, body) {
  if (!process.env.GITHUB_TOKEN) throw Object.assign(new Error('Add GITHUB_TOKEN in Keys first'), { status: 400 });
  const r = await fetch(`${GH()}/repos/${repo()}${p}`, { method, headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Brightfolio', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`GitHub answered ${r.status}: ${text.slice(0, 160)}`), { status: r.status === 404 ? 404 : 502 });
  return text ? JSON.parse(text) : {};
}
adminSiteRouter.get('/yiddish', wrap(async (req, res) => {
  const fs = await import('node:fs/promises');
  const read = f => fs.readFile(new URL('../scripts/' + f, import.meta.url), 'utf8').catch(() => null);
  const status = JSON.parse((await read('yl-status.json')) || 'null'), lastRef = ((await read('yl-last-ref.txt')) || '').trim() || null;
  const out = { status, lastRef, configured: !!process.env.GITHUB_TOKEN, repo: repo(), auto: null, runs: [] };
  if (out.configured) {
    try {
      out.runs = (await gh('GET', '/actions/workflows/yiddish.yml/runs?per_page=10')).workflow_runs.map(r => ({ id: r.id, status: r.status, conclusion: r.conclusion, event: r.event, at: r.created_at, url: r.html_url }));
      out.auto = (await gh('GET', '/actions/variables/YL_AUTO').catch(e => (e.status === 404 ? { value: 'false' } : Promise.reject(e)))).value === 'true';
    } catch (e) { out.error = e.message; }
  }
  res.json(out);
}));
adminSiteRouter.post('/yiddish/run', wrap(async (req, res) => {
  const since = String(req.body?.since || '').trim(), limit = String(req.body?.limit || '').trim();
  if (since && !/^[0-9a-f]{7,40}$|^HEAD(~\d+)?$/i.test(since)) throw bad('Since must be a commit id');
  if (limit && !/^\d{1,4}$/.test(limit)) throw bad('Limit must be a number');
  await gh('POST', '/actions/workflows/yiddish.yml/dispatches', { ref: 'main', inputs: { since, limit } });
  await audit(req.user.id, 'yiddish_run', { since, limit }, req.ip);
  res.json({ ok: true });
}));
adminSiteRouter.put('/yiddish/auto', wrap(async (req, res) => {
  const value = req.body?.on ? 'true' : 'false';
  await gh('PATCH', '/actions/variables/YL_AUTO', { name: 'YL_AUTO', value }).catch(e => (e.status === 404 ? gh('POST', '/actions/variables', { name: 'YL_AUTO', value }) : Promise.reject(e)));
  await audit(req.user.id, 'yiddish_auto', { on: value === 'true' }, req.ip);
  res.json({ auto: value === 'true' });
}));

// ---------- phone line (IVR) ----------
adminSiteRouter.get('/phone', wrap(async (req, res) => {
  const H = await import('./hotline.js'), N = await import('./notify.js');
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const since = Date.now() - 30 * 86400e3;
  const counts = Object.fromEntries((await all("SELECT event, COUNT(*) n FROM audit_log WHERE event LIKE 'hotline%' AND at > ? GROUP BY event", since)).map(r => [r.event, r.n]));
  const log = await all("SELECT a.event, a.detail, a.ip, a.at, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.event LIKE 'hotline%' ORDER BY a.id DESC LIMIT 60");
  res.json({
    settings: H.settings(), defaults: H.DEFAULTS, counts, log: log.map(l => ({ ...l, detail: l.detail ? JSON.parse(l.detail) : null })),
    number: process.env.TWILIO_FROM || null, twilio: N.twilioEnabled(), signed: !!process.env.TWILIO_AUTH_TOKEN,
    voiceUrl: `${base}/twilio/voice`, statusUrl: `${base}/twilio/voice/status`, smsUrl: `${base}/twilio/sms`, publicUrl: !!process.env.PUBLIC_URL,
  });
}));
adminSiteRouter.put('/phone', wrap(async (req, res) => {
  const H = await import('./hotline.js');
  const s = await H.saveSettings(req.body || {});
  await audit(req.user.id, 'hotline_settings', s, req.ip);
  res.json({ settings: s });
}));

// ---------- AI & privacy: what AI crawlers may read, and what the assistant may send ----------
adminSiteRouter.get('/ai', wrap(async (req, res) => {
  const A = await import('./aiaccess.js'), L = await import('./llm.js');
  // Whether the code repository is public (then anyone, AI crawlers included, can read the code and README).
  let repoPublic = null;
  if (process.env.GITHUB_TOKEN) repoPublic = await gh('GET', '').then(r => !r.private).catch(() => null);
  res.json({ settings: A.settings(), crawlers: A.CRAWLERS, privatePaths: A.PRIVATE_PATHS, robots: A.robotsTxt(), llms: A.llmsTxt(), ai: L.llmInfo(), repo: repo(), repoPublic });
}));
adminSiteRouter.put('/ai', wrap(async (req, res) => {
  const A = await import('./aiaccess.js');
  const s = await A.saveSettings(req.body || {});
  await audit(req.user.id, 'ai_access', { allow: s.allow, search: s.search, llmsOn: s.llmsOn, accountData: s.accountData }, req.ip);
  res.json({ settings: s, robots: A.robotsTxt(s) });
}));

// ---------- private README (Admin → README) ----------
// The full project guide lives here, encrypted in the database, not in the public repository.
// The public README.md on GitHub is a short description; "Publish" replaces it with this text.
// FULL_README_REF: the last commit whose README.md had the whole guide, to import it once.
export const FULL_README_REF = 'cfdd4ed96a7b9f400821ba15b07d3101a19ff144';
const readme = async () => {
  const r = S.siteGet('privateReadme', null);
  if (!r) return null;
  const { tryDecrypt } = await import('./crypto.js');
  return { ...r, text: tryDecrypt(r.enc, 'private README') ?? '' };
};
const saveReadme = async (text, extra = {}) => {
  const { encrypt } = await import('./crypto.js');
  const cur = S.siteGet('privateReadme', {}) || {};
  await S.siteSet('privateReadme', { ...cur, ...extra, enc: encrypt(String(text)), updatedAt: Date.now() });
};
adminSiteRouter.get('/readme', wrap(async (req, res) => {
  const r = await readme();
  res.json({ text: r?.text ?? '', updatedAt: r?.updatedAt || null, publishedAt: r?.publishedAt || null, canPublish: !!process.env.GITHUB_TOKEN, repo: repo(), fullRef: FULL_README_REF });
}));
adminSiteRouter.put('/readme', wrap(async (req, res) => {
  const text = String(req.body?.text ?? '');
  if (text.length > 600e3) throw bad('The README is limited to 600 KB');
  await saveReadme(text);
  await audit(req.user.id, 'readme_saved', { length: text.length }, req.ip);
  res.json({ ok: true });
}));
// Imports README.md from a commit (the last full guide by default): with GITHUB_TOKEN through the
// API (works for a private repository), otherwise from the public raw file.
adminSiteRouter.post('/readme/import', wrap(async (req, res) => {
  const ref = /^[0-9a-f]{7,40}$|^[\w./-]{1,100}$/.test(req.body?.ref || '') ? req.body.ref : FULL_README_REF;
  const read = async file => {
    if (process.env.GITHUB_TOKEN) {
      const f = await gh('GET', `/contents/${file}?ref=${encodeURIComponent(ref)}`);
      return Buffer.from(f.content || '', 'base64').toString('utf8');
    }
    const r = await fetch(`${process.env.GITHUB_RAW_URL || 'https://raw.githubusercontent.com'}/${repo()}/${encodeURIComponent(ref)}/${file}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Object.assign(new Error(`Could not read ${file} at ${ref} (${r.status}). If the repository is private, add GITHUB_TOKEN in Keys.`), { status: 502 });
    return r.text();
  };
  let text = await read('README.md');
  // The plan-pricing notes used to be a separate public file; they join the private guide.
  const pricing = await read('docs/pricing-comparison.md').catch(() => '');
  if (pricing) text += `\n\n---\n\n${pricing.replace(/^# /m, '## ')}`;
  await saveReadme(text);
  await audit(req.user.id, 'readme_imported', { ref, length: text.length }, req.ip);
  res.json({ text });
}));
// Publishes the saved text as README.md on GitHub (a commit to the default branch). Anyone who can
// see the repository can read it afterwards, so it asks for the password first.
adminSiteRouter.post('/readme/publish', wrap(async (req, res) => {
  if (!confirmsIdentity(req.user, req.body || {})) throw Object.assign(new Error(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password'), { status: 401 });
  const r = await readme();
  if (!r?.text) throw bad('Save the README first');
  const cur = await gh('GET', '/contents/README.md').catch(e => (e.status === 404 ? null : Promise.reject(e)));
  const out = await gh('PUT', '/contents/README.md', { message: 'README: published from Admin', content: Buffer.from(r.text, 'utf8').toString('base64'), ...(cur?.sha ? { sha: cur.sha } : {}) });
  await saveReadme(r.text, { publishedAt: Date.now() });
  await audit(req.user.id, 'readme_published', { commit: out.commit?.sha || null }, req.ip);
  res.json({ ok: true, commit: out.commit?.sha || null, url: out.content?.html_url || null });
}));

// ---------- credits: monthly allowances, prices, packs, and gifts to a user ----------
adminSiteRouter.get('/credits', wrap(async (req, res) => {
  const C = await import('./credits.js');
  const since = Date.now() - 30 * 86400e3;
  const used = await all("SELECT kind, -SUM(delta) n FROM credit_ledger WHERE delta < 0 AND at > ? GROUP BY kind", since);
  const sold = await one("SELECT COALESCE(SUM(delta), 0) n FROM credit_ledger WHERE kind = 'purchase' AND at > ?", since);
  res.json({ config: C.config(), labels: C.LABELS, used, sold30: sold.n });
}));
adminSiteRouter.put('/credits', wrap(async (req, res) => {
  const C = await import('./credits.js');
  const c = await C.saveConfig(req.body || {});
  await audit(req.user.id, 'credits_config', c, req.ip);
  res.json({ config: c });
}));
adminSiteRouter.post('/credits/grant', wrap(async (req, res) => {
  const C = await import('./credits.js');
  const u = await one('SELECT id, email FROM users WHERE lower(email) = lower(?)', String(req.body?.email || '').trim());
  const n = Math.round(+req.body?.credits);
  if (!u) throw bad('No user with that email');
  if (!(n >= 1 && n <= 1e6)) throw bad('Give 1 to 1,000,000 credits');
  await C.grant(u.id, n, 'gift', String(req.body?.memo || 'From Brightfolio').slice(0, 80));
  await audit(req.user.id, 'credits_grant', { user: u.id, credits: n }, req.ip);
  res.json({ ok: true });
}));

// ---------- Google Drive: save the private README as a PDF with page numbers ----------
adminSiteRouter.get('/drive', wrap(async (req, res) => res.json((await import('./drive.js')).status())));
adminSiteRouter.post('/drive/disconnect', wrap(async (req, res) => { await (await import('./drive.js')).disconnect(); await audit(req.user.id, 'drive_disconnected', null, req.ip); res.json({ ok: true }); }));
adminSiteRouter.post('/readme/drive', wrap(async (req, res) => {
  const D = await import('./drive.js'), { markdownPdf } = await import('./pdf.js');
  const r = await readme();
  if (!r?.text) throw bad('Save the README first');
  const date = new Date().toISOString().slice(0, 10);
  const { pdf, pages } = markdownPdf(r.text, { title: `Brightfolio private README · ${date}`, coverTitle: 'Private README', subtitle: `${date} · For admins only` });
  const f = await D.savePdf(pdf, 'Brightfolio private README.pdf');
  await audit(req.user.id, 'readme_drive', { pages, file: f.id }, req.ip);
  res.json({ ...f, pages });
}));
// The same PDF as a download: of the text sent (the editor's, saved or not) or else the saved README.
const readmePdf = async (req, res) => {
  const { markdownPdf } = await import('./pdf.js');
  const text = typeof req.body?.text === 'string' && req.body.text.trim() ? req.body.text : (await readme())?.text;
  if (!text) throw bad('Write the README first');
  if (text.length > 600e3) throw bad('The README is limited to 600 KB');
  const date = new Date().toISOString().slice(0, 10);
  const { pdf } = markdownPdf(text, { title: `Brightfolio private README · ${date}`, coverTitle: 'Private README', subtitle: `${date} · For admins only` });
  res.type('application/pdf').attachment('Brightfolio private README.pdf').send(pdf);
};
adminSiteRouter.get('/readme/pdf', wrap(readmePdf));
adminSiteRouter.post('/readme/pdf', wrap(readmePdf));
