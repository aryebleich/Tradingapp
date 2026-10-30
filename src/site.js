// Site-wide settings the owner changes in Admin: extra admin emails and phones, the business mode
// (software only, or registered investment adviser), and environment values (API keys) saved from
// the admin page or synced with Render.
import { all, run, now } from './db.js';
import crypto from 'node:crypto';
import { encrypt, decrypt } from './crypto.js';

// The owner's addresses and phone are always admins, whatever ADMIN_EMAIL says. Only slow one-way
// fingerprints (scrypt) are kept in the code, so the public source never shows who the owner is.
// OWNER_HASHES (comma-separated, same fingerprint) adds more, e.g. for tests.
const OWNER_FINGERPRINTS = [
  '07b44b3df1d39cbca09297903e0030378beac400f76d65fa10fcd70898b7af07',
  '6ead6eeffce706138aefb203d48eb33aca0fae50f0ce35ea4e2d9e681e40492e',
  'a2f81020341fe4e62b231a7f3da14630b24123df14bf7a490f25b26f95718ed1',
];
export const ownerFingerprint = v => crypto.scryptSync(String(v), 'qp-owner-v1', 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
const ownerSeen = new Map();
// v is a canonical email or a normalized phone; results are remembered (scrypt is slow on purpose).
export function isOwner(v) {
  if (!v) return false;
  if (!ownerSeen.has(v)) {
    if (ownerSeen.size > 5000) ownerSeen.clear();
    const extra = String(process.env.OWNER_HASHES || '').split(/[,\s]+/).filter(Boolean);
    ownerSeen.set(v, [...OWNER_FINGERPRINTS, ...extra].includes(ownerFingerprint(v)));
  }
  return ownerSeen.get(v);
}

const cache = new Map();
let loadedAt = 0;
export async function loadSite() {
  for (const r of await all('SELECT k, v FROM site_settings')) { try { cache.set(r.k, JSON.parse(r.v)); } catch {} }
  loadedAt = now();
}
// Other servers may have changed a setting: reread at most once a minute.
export async function freshSite() { if (now() - loadedAt > 60e3) await loadSite().catch(() => {}); }
export const siteGet = (k, dflt = null) => (cache.has(k) ? cache.get(k) : dflt);
export async function siteSet(k, v) {
  await run('INSERT INTO site_settings (k, v, updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at', k, JSON.stringify(v), now());
  cache.set(k, v);
  return v;
}

// Phone numbers are kept as +1XXXXXXXXXX; ten US digits get the +1.
export const normalizePhone = p => {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(d)) return '+1' + d;
  if (/^1\d{10}$/.test(d)) return '+' + d;
  return d.startsWith('+') ? d : d ? '+' + d : '';
};
export const addedAdminEmails = () => siteGet('adminEmails', []);
export const adminPhones = () => [...new Set([...String(process.env.ADMIN_PHONE || '').split(/[,;\s]+/).filter(Boolean).map(normalizePhone), ...siteGet('adminPhones', [])])];
export const isAdminPhone = p => !!p && (adminPhones().includes(normalizePhone(p)) || isOwner(normalizePhone(p)));

// Software only (the default): no performance fee and no personal advice, so no adviser license is
// needed. Registered adviser: the owner turns this on in Admin once registered (SEC or state).
export const adviserMode = () => siteGet('adviserMode', false) === true;
// What a page shows: the owner's "View as" preview of the other business mode, else the real one.
// Only for display; automatic trading always follows the real mode.
export const adviserFor = u => (u?.role === 'admin' && typeof u.previewAdviser === 'boolean' ? u.previewAdviser : adviserMode());

// ---------- environment values ----------
// Known settings, grouped for the admin page. Any other UPPER_CASE name can be added too.
export const ENV_GROUPS = [
  ['Basics', ['PUBLIC_URL', 'ADMIN_EMAIL', 'ADMIN_PHONE', 'ENCRYPTION_KEY', 'CRON_SECRET', 'DATABASE_URL', 'DATABASE_AUTH_TOKEN', 'PUBLIC_ORIGINS']],
  ['Alpaca Broker API', ['BROKER_API_KEY', 'BROKER_API_SECRET', 'BROKER_BASE_URL', 'BROKER_CLIENT_ID', 'BROKER_CLIENT_SECRET', 'BROKER_TOKEN_URL', 'BROKER_EVENTS']],
  ['Alpaca data and trading', ['ALPACA_KEY_ID', 'ALPACA_SECRET', 'ALPACA_TRADING_URL', 'ALPACA_STOCK_FEED', 'ALPACA_OPTIONS_FEED', 'ALPACA_OAUTH_CLIENT_ID', 'ALPACA_OAUTH_CLIENT_SECRET', 'ALPACA_OAUTH_ENV']],
  ['Sign-in', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']],
  ['Payments', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_PRO_YEARLY', 'STRIPE_PRICE_ELITE', 'STRIPE_PRICE_ELITE_YEARLY', 'STRIPE_PRICE_ULTIMATE', 'STRIPE_PRICE_ULTIMATE_YEARLY', 'STRIPE_ACH', 'HELCIM_API_TOKEN', 'SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID', 'SQUARE_WEBHOOK_SIGNATURE_KEY', 'SQUARE_ENV', 'ANET_LOGIN_ID', 'ANET_TRANSACTION_KEY', 'ANET_SIGNATURE_KEY', 'ANET_ENV', 'DEPOSIT_FEE_PERCENT', 'DEPOSIT_FEE_FIXED', 'TRIAL_DAYS', 'REFERRAL_CREDIT']],
  ['Messages', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'RESEND_API_KEY', 'EMAIL_FROM']],
  ['AI', ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AI_PROVIDER', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'ANTHROPIC_API_KEY']],
  ['Other brokerages', ['SCHWAB_APP_KEY', 'SCHWAB_APP_SECRET', 'TRADESTATION_CLIENT_ID', 'TRADESTATION_CLIENT_SECRET', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV']],
  ['Market events (earnings, IPOs)', ['FINNHUB_API_KEY']],
  ['QuickBooks (bookkeeping and taxes)', ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_ENV']],
  ['Extras', ['YIDDISH_CREDIT', 'MARGIN_FEED_URL', 'METRICS_TOKEN', 'SEC_CONTACT']],
  ['Render', ['RENDER_API_KEY', 'RENDER_SERVICE_ID']],
  ['GitHub (Yiddish Labs runs)', ['GITHUB_TOKEN', 'GITHUB_REPO']],
];
export const validEnvName = k => /^[A-Z][A-Z0-9_]{1,63}$/.test(k);
// Never changed from the app: the host sets these, or changing them would lock out the data.
// Also never: settings that would weaken HTTPS or change how Node.js itself runs.
const HOST_ONLY = new Set(['NODE_ENV', 'PORT', 'HOSTNAME', 'RENDER', 'RENDER_SERVICE_ID', 'RENDER_EXTERNAL_URL', 'PATH', 'HOME',
  'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'NODE_PATH', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_VERSION', 'ALLOW_UNPATCHED_NODE', 'LD_PRELOAD']);
// Need a restart to take effect (read once at start-up), or would break stored data if changed live.
const RESTART = new Set(['ENCRYPTION_KEY', 'DATABASE_URL', 'DATABASE_AUTH_TOKEN', 'DB_FILE']);
export const isSecretName = k => /SECRET|TOKEN|PASSWORD|_KEY$|_KEY_|KEY_ID|_SID$/.test(k) && !/_URL$/.test(k);
export const mask = v => { const s = String(v ?? ''); return !s ? '' : s.length <= 8 ? '•'.repeat(s.length) : s.slice(0, 3) + '•••' + s.slice(-4); };

// What the real environment held at start-up, before anything saved in the app was applied.
const bootEnv = new Set(Object.keys(process.env));
const savedEnv = () => { const b = siteGet('env'); if (!b) return {}; try { return decrypt(b); } catch { return {}; } };
// Values saved in the app fill in what the host did not set (Render values win after a restart).
export async function applySavedEnv() {
  for (const [k, v] of Object.entries(savedEnv())) if (!bootEnv.has(k) && !HOST_ONLY.has(k) && !RESTART.has(k)) process.env[k] = v;
}
export async function saveEnv(changes) {
  const cur = savedEnv();
  for (const [k, v] of Object.entries(changes)) { if (v === null || v === '') delete cur[k]; else cur[k] = v; }
  await siteSet('env', encrypt(cur));
}
export function checkEnvChange(k) {
  if (!validEnvName(k)) throw Object.assign(new Error(`"${k}" is not a valid name (capital letters, digits and _)`), { status: 400 });
  if (HOST_ONLY.has(k)) throw Object.assign(new Error(`${k} is set by the host and cannot be changed here`), { status: 400 });
}
export const needsRestart = k => RESTART.has(k);
export const hostOnly = k => HOST_ONLY.has(k);
export const fromHost = k => bootEnv.has(k);

// .env text: KEY=value lines, optional "export", quotes and # comments.
export function parseDotenv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (/^"/.test(v)) v = v.replace(/^"((?:\\.|[^"\\])*)".*$/, '$1').replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1');
    else if (/^'/.test(v)) v = v.replace(/^'([^']*)'.*$/, '$1');
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1].toUpperCase()] = v;
  }
  return out;
}
export const toDotenv = obj => Object.entries(obj).map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join('\n') + '\n';

// ---------- Render ----------
// RENDER_API_KEY comes from Render → Account settings → API keys. RENDER_SERVICE_ID is set by
// Render on every service; outside Render it can be given by hand (srv-...).
const RENDER_API = () => (process.env.RENDER_API_URL || 'https://api.render.com/v1').replace(/\/$/, '');
export const renderEnabled = () => !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID);
async function renderCall(method, p, body) {
  if (!renderEnabled()) throw Object.assign(new Error('Add RENDER_API_KEY (and RENDER_SERVICE_ID outside Render) first'), { status: 400 });
  const r = await fetch(`${RENDER_API()}/services/${encodeURIComponent(process.env.RENDER_SERVICE_ID)}${p}`, {
    method, headers: { authorization: `Bearer ${process.env.RENDER_API_KEY}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Render answered ${r.status}: ${text.slice(0, 200)}`), { status: 502 });
  return text ? JSON.parse(text) : {};
}
export async function renderEnv() {
  const out = {};
  let cursor = '';
  for (let i = 0; i < 20; i++) {
    const page = await renderCall('GET', `/env-vars?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    for (const row of page) out[row.envVar.key] = row.envVar.value;
    if (page.length < 100) break;
    cursor = page[page.length - 1].cursor;
  }
  return out;
}
// One key at a time, so values set only on Render are never wiped.
export async function renderPut(changes) {
  const done = [];
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === '') await renderCall('DELETE', `/env-vars/${encodeURIComponent(k)}`).catch(e => { if (!/404/.test(e.message)) throw e; });
    else await renderCall('PUT', `/env-vars/${encodeURIComponent(k)}`, { value: String(v) });
    done.push(k);
  }
  return done;
}
export const renderDeploy = () => renderCall('POST', '/deploys', { clearCache: 'do_not_clear' });
export const renderService = () => renderCall('GET', '');
// A new instance type; Render moves the service to it with a fresh deploy.
export const renderSetPlan = plan => renderCall('PATCH', '', { serviceDetails: { plan } });
