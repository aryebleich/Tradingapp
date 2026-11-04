// Hosting (Admin → Hosting): the servers the site can run on, which one is active, health and speed
// of each, deploys, switching, and the free Cloudflare edge in front.
//
//   servers   each has a name, kind (render, northflank, oracle-vm, koyeb, custom), its own https
//             address and an optional deploy hook (kept encrypted). All of them share the same
//             database (DATABASE_URL), so a switch moves no data.
//   active    only the active server runs background jobs (bots, scheduled trades, alerts,
//             snapshots); every other one serves pages only, so no order is ever sent twice.
//             Each server knows itself by HOST_ID (Render is "render" when HOST_ID is unset).
//   switching tells the edge which server to send visitors to (Cloudflare Worker, KV "origins"),
//             or points the domain's DNS record at it (Cloudflare DNS), and updates the APP_URL
//             repository variable the scheduler and deploy check use.
//   keep warm the active server calls its own public address every 9 minutes, so a free host
//             that sleeps idle apps never makes the next visitor wait for it to wake up.
import express from 'express';
import { requireUser, requireAdmin, confirmsIdentity } from './auth.js';
import { audit, now, one } from './db.js';
import { siteGet, siteSet } from './site.js';
import { encrypt, tryDecrypt } from './crypto.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
export const KINDS = {
  render: { name: 'Render', note: 'Free web service sleeps after 15 minutes without visitors; keep-warm stops that.' },
  northflank: { name: 'Northflank', note: 'Free sandbox: 2 always-on services, no sleeping. Deploys from GitHub with the Dockerfile.' },
  'oracle-vm': { name: 'Oracle Cloud VM', note: 'Always Free ARM virtual machine: never sleeps, your own server (deploy/vm/setup.sh sets it up).' },
  koyeb: { name: 'Koyeb', note: 'Free instance scales to zero when idle; keep-warm helps.' },
  custom: { name: 'Other', note: 'Any host that runs the Dockerfile or `node server.js`.' },
};
export const thisHost = () => process.env.HOST_ID || (process.env.RENDER ? 'render' : 'local');
// Read straight from the database every 30 seconds too, so a switch made on another server reaches
// this one even when nobody visits it (siteGet alone refreshes on page requests).
let synced = null;
export function startHostingSync() {
  const pull = () => one("SELECT v FROM site_settings WHERE k = 'hosting'").then(r => { synced = r ? JSON.parse(r.v) : {}; }).catch(() => {});
  pull(); const t = setInterval(pull, 30e3); t.unref?.(); return t;
}
const cfg = () => ({ active: null, keepWarm: true, servers: [], ...((synced ?? siteGet('hosting', {})) || {}) });
const save = async v => { await siteSet('hosting', v); synced = v; return v; };
export const saveHosting = save;
export const hostingConfig = () => cfg();
// Only the active server runs jobs. With no servers set up, whichever server runs is active.
export function isActiveHost() {
  const c = cfg();
  if (!c.active || !c.servers.length) return true;
  return c.active === thisHost();
}
const url = u => { const s = String(u || '').trim().replace(/\/$/, ''); if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s)) throw bad('Use the server\'s https address, e.g. https://my-app.onrender.com'); return s; };
const pub = s => ({ id: s.id, name: s.name, kind: s.kind, url: s.url, hook: !!s.hook, added: s.added });

// One request to a server's health and routing pages: is it up, how fast, which version.
export async function probe(server) {
  const t0 = Date.now();
  try {
    const r = await fetch(server.url + '/healthz/routing', { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Brightfolio-hosting-check' } });
    const ms = Date.now() - t0, d = await r.json().catch(() => ({}));
    return { id: server.id, up: r.ok || r.status === 500, ms, cold: ms > 3000, routingOk: !!d.ok, commit: d.commit ? d.commit.slice(0, 7) : null, status: r.status };
  } catch (e) { return { id: server.id, up: false, ms: Date.now() - t0, error: String(e.message).slice(0, 80) }; }
}

// ---------- the switch: edge Worker (KV), DNS record, APP_URL ----------
const CF = () => (process.env.CLOUDFLARE_API_URL || 'https://api.cloudflare.com').replace(/\/$/, '') + '/client/v4';
const cf = (path, opts = {}) => fetch(CF() + path, { ...opts, headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) })
  .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok || d.success === false) throw new Error('Cloudflare: ' + (d.errors?.[0]?.message || r.status)); return d; });
const edgeReady = () => !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_KV_ID);
const dnsReady = () => !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID && process.env.SITE_DOMAIN);
async function pointEdge(order) {
  // The Worker reads this list (first = active, the rest are backups it falls back to).
  await fetch(`${CF()}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_ID}/values/origins`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'text/plain' }, body: JSON.stringify(order), signal: AbortSignal.timeout(15000),
  }).then(async r => { if (!r.ok) throw new Error('Cloudflare KV: ' + r.status + ' ' + (await r.text()).slice(0, 120)); });
}
async function pointDns(target) {
  const zone = process.env.CLOUDFLARE_ZONE_ID, name = process.env.SITE_DOMAIN, host = new URL(target).hostname;
  const found = (await cf(`/zones/${zone}/dns_records?name=${encodeURIComponent(name)}`)).result || [];
  const rec = found.find(x => ['CNAME', 'A', 'AAAA'].includes(x.type));
  const body = { type: 'CNAME', name, content: host, proxied: true, ttl: 1, comment: 'Brightfolio: active server (Admin → Hosting)' };
  if (rec) await cf(`/zones/${zone}/dns_records/${rec.id}`, { method: rec.type === 'CNAME' ? 'PATCH' : 'PUT', body: JSON.stringify(body) });
  else await cf(`/zones/${zone}/dns_records`, { method: 'POST', body: JSON.stringify(body) });
}
async function setAppUrl(value) {
  const repo = process.env.GITHUB_REPO || 'aryebleich/Tradingapp', api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const h = { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const r = await fetch(`${api}/repos/${repo}/actions/variables/APP_URL`, { method: 'PATCH', headers: h, body: JSON.stringify({ name: 'APP_URL', value }), signal: AbortSignal.timeout(15000) });
  if (r.status === 404) { const c = await fetch(`${api}/repos/${repo}/actions/variables`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'APP_URL', value }) }); if (!c.ok) throw new Error('GitHub: ' + c.status); }
  else if (!r.ok) throw new Error('GitHub: ' + r.status);
}
export async function switchTo(id) {
  const c = cfg(), s = c.servers.find(x => x.id === id);
  if (!s) throw bad('No such server');
  const p = await probe(s);
  if (!p.up) throw bad(`${s.name} is not answering (${p.error || p.status}); nothing was switched`);
  const steps = [];
  const order = [s.url, ...c.servers.filter(x => x.id !== id).map(x => x.url)];
  if (edgeReady()) { await pointEdge(order); steps.push('The edge now sends visitors to ' + s.name + ' (backups: ' + (order.length - 1) + ')'); }
  if (dnsReady()) { await pointDns(s.url); steps.push(`${process.env.SITE_DOMAIN} now points at ${new URL(s.url).hostname}`); }
  const front = edgeReady() || dnsReady();
  if (process.env.GITHUB_TOKEN) { await setAppUrl(front ? (process.env.PUBLIC_URL || s.url) : s.url).then(() => steps.push('APP_URL (scheduler and deploy check) updated'), e => steps.push('APP_URL not updated: ' + e.message)); }
  await save( { ...c, active: id, switchedAt: now() });
  steps.push(`${s.name} now runs the background jobs (bots, scheduled trades, alerts)`);
  if (!front) steps.push('No Cloudflare edge or domain is set up, so visitors keep using the old address until you share the new one: ' + s.url);
  return { active: id, steps };
}

// ---------- keep warm ----------
let warmTimer = null;
export function startKeepWarm() {
  if (warmTimer) return warmTimer;
  warmTimer = setInterval(() => {
    const c = cfg(), target = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
    if (!c.keepWarm || !/^https:/.test(target) || !isActiveHost()) return;
    fetch(target + '/healthz', { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Brightfolio-keep-warm' } }).catch(() => {});
  }, 9 * 60e3);
  warmTimer.unref?.();
  return warmTimer;
}

export const hostingRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  r.get('/', async (req, res) => {
    const c = cfg();
    const health = await Promise.all(c.servers.map(probe));
    res.json({
      thisHost: thisHost(), active: c.active, keepWarm: c.keepWarm !== false, switchedAt: c.switchedAt || null,
      servers: c.servers.map(s => ({ ...pub(s), health: health.find(h => h.id === s.id) })), kinds: KINDS,
      edge: { ready: edgeReady(), dns: dnsReady(), domain: process.env.SITE_DOMAIN || null, publicUrl: process.env.PUBLIC_URL || null, secret: !!process.env.EDGE_SECRET },
      database: process.env.DATABASE_URL ? 'shared (DATABASE_URL)' : 'local file: every server would have its own data, set DATABASE_URL first',
    });
  });
  r.post('/servers', async (req, res) => {
    const b = req.body || {}, c = cfg();
    const id = String(b.id || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{2,30}$/.test(id)) throw bad('Server id: 2-30 letters, numbers or dashes (it must match HOST_ID on that server; Render can use "render")');
    if (!KINDS[b.kind]) throw bad('Pick the kind of host');
    const name = String(b.name || KINDS[b.kind].name).trim().slice(0, 40);
    const hook = b.hook === undefined || b.hook === '' ? undefined : String(b.hook).trim();
    if (hook && !/^https:\/\//.test(hook)) throw bad('The deploy hook is an https address');
    const old = c.servers.find(x => x.id === id);
    const s = { id, name, kind: b.kind, url: url(b.url), hook: hook === undefined ? old?.hook || null : encrypt({ u: hook }), added: old?.added || now() };
    const servers = old ? c.servers.map(x => (x.id === id ? s : x)) : [...c.servers, s];
    if (servers.length > 6) throw bad('Up to 6 servers');
    await save( { ...c, servers, active: c.active || id });
    await audit(req.user.id, 'hosting_server_saved', { id, kind: b.kind }, req.ip);
    res.json({ ok: true });
  });
  r.delete('/servers/:id', async (req, res) => {
    const c = cfg();
    if (c.active === req.params.id && c.servers.length > 1) throw bad('Switch to another server first');
    await save( { ...c, servers: c.servers.filter(x => x.id !== req.params.id), active: c.active === req.params.id ? null : c.active });
    await audit(req.user.id, 'hosting_server_removed', { id: req.params.id }, req.ip);
    res.json({ ok: true });
  });
  r.post('/servers/:id/deploy', async (req, res) => {
    const s = cfg().servers.find(x => x.id === req.params.id);
    if (!s?.hook) throw bad('Add this server\'s deploy hook first');
    const hook = tryDecrypt(s.hook, 'deploy hook')?.u;
    if (!hook) throw bad('The saved deploy hook cannot be read; save it again');
    const r2 = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(20000) }).catch(e => ({ ok: false, status: e.message }));
    if (!r2.ok) throw bad(`The host did not accept the deploy (${r2.status})`, 502);
    await audit(req.user.id, 'hosting_deploy', { id: s.id }, req.ip);
    res.json({ ok: true, message: `Deploy started on ${s.name}` });
  });
  // Switching changes where every visitor goes: the admin's password is asked.
  r.post('/switch', async (req, res) => {
    if (!confirmsIdentity(req.user, req.body || {})) throw bad(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password', 401);
    const out = await switchTo(String(req.body?.id || ''));
    await audit(req.user.id, 'hosting_switch', { to: out.active }, req.ip);
    res.json(out);
  });
  r.put('/settings', async (req, res) => {
    const c = cfg();
    await save( { ...c, keepWarm: !!req.body?.keepWarm });
    res.json({ keepWarm: !!req.body?.keepWarm });
  });
  return r;
})();
