// Admin → Hosting → "Set up the edge": puts the free Cloudflare Worker (edge/worker.js) in front of
// the servers with one press. Only CLOUDFLARE_API_TOKEN is needed (Admin → Keys); this finds the
// account, makes the settings store (KV), uploads the Worker with its 5-minute keep-warm, gives it
// the list of servers and, when the domain is on Cloudflare, puts it on the domain
// (e.g. app.brightolio.com/*). Otherwise it gets a free *.workers.dev address.
// The edge proves itself to the servers with a secret every server already shares (derived from
// ENCRYPTION_KEY), so nothing has to be copied to each server by hand.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hmac } from './crypto.js';
import { siteGet, siteSet, saveEnv } from './site.js';

export const SCRIPT = 'brightfolio-edge';
const KV_TITLE = 'brightolio-config';
const WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'edge', 'worker.js');
const CF = () => (process.env.CLOUDFLARE_API_URL || 'https://api.cloudflare.com').replace(/\/$/, '') + '/client/v4';
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

// The secret the edge sends with every request; the same on every server without any copying.
export const edgeSecret = () => process.env.EDGE_SECRET || (process.env.ENCRYPTION_KEY || process.env.NODE_ENV !== 'production' ? 'e' + hmac('edge-secret:v1') : '');
// What the setup found (not secret), so every server can switch the edge.
export const edgeConfig = () => siteGet('edge', null) || {};

async function cf(p, opts = {}) {
  const headers = { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN, ...(opts.form ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) };
  const r = await fetch(CF() + p, { method: opts.method || 'GET', headers, body: opts.form || (opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)), signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) {
    const e = d.errors?.[0] || {};
    const msg = e.message || 'HTTP ' + r.status;
    const hint = /authenticat|permission|not authorized|unauthorized/i.test(msg) || e.code === 10000 || e.code === 9109 ? ` (the token is missing a permission${opts.need ? ': ' + opts.need : ''}; see the steps on this page)` : '';
    throw Object.assign(bad(`Cloudflare: ${msg}${hint}`, 502), { cfCode: e.code, cfStatus: r.status });
  }
  return d.result;
}

// The zone (domain on Cloudflare) that holds this name, e.g. brightolio.com for app.brightolio.com.
async function zoneFor(host) {
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(i).join('.');
    const z = (await cf(`/zones?name=${encodeURIComponent(name)}`, { need: 'Zone → Zone → Read' }))?.[0];
    if (z) return z;
  }
  return null;
}

// The account's free workers.dev name; Cloudflare makes one when the Workers page is first opened,
// so when there is none yet it is made here (brightolio, or brightolio-<n> when that is taken).
async function workersDevName(account) {
  const have = (await cf(`/accounts/${account}/workers/subdomain`).catch(() => null))?.subdomain;
  if (have) return have;
  for (const name of ['brightolio', 'brightolio-app', 'brightolio-' + Math.random().toString(36).slice(2, 7)]) {
    try { return (await cf(`/accounts/${account}/workers/subdomain`, { method: 'PUT', body: { subdomain: name } }))?.subdomain || name; } catch {}
  }
  throw bad('Cloudflare has no workers.dev name for this account yet: open dash.cloudflare.com → Workers & Pages once (it makes one), then press this button again.');
}

// The servers the edge forwards to: active first, then the backups. Never the edge's own address.
function originList(servers, active, edgeHost) {
  const list = [...servers].sort((a, b) => (b.id === active) - (a.id === active)).map(s => s.url).filter(u => new URL(u).host !== edgeHost);
  return [...new Set(list)];
}

export async function setupEdge({ domain, servers = [], active = null } = {}) {
  if (!process.env.CLOUDFLARE_API_TOKEN) throw bad('Add CLOUDFLARE_API_TOKEN in Admin → Keys first (the steps are on this page).');
  const secret = edgeSecret();
  if (!secret) throw bad('ENCRYPTION_KEY is not set on this server');
  const steps = [];
  await cf('/user/tokens/verify');

  // 1. Account
  const accounts = await cf('/accounts');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || accounts?.[0]?.id;
  if (!account) throw bad('This token cannot see any Cloudflare account. Give it "Account" permissions for your account.');

  // 2. Where it will answer
  domain = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw bad('The address looks wrong: use a name like app.brightolio.com');
  const origins = originList(servers, active, domain || null);
  if (!origins.length) throw bad(`Add your servers above first, each with its own address (not ${domain || 'the edge address'}), e.g. Oracle: https://138-2-233-183.sslip.io and Render: https://quantpocket.onrender.com`);

  // 3. Settings store (the list of servers Admin → Hosting switches)
  let kv = process.env.CLOUDFLARE_KV_ID || edgeConfig().kv;
  if (!kv) {
    const all = await cf(`/accounts/${account}/storage/kv/namespaces?per_page=100`);
    kv = all?.find(n => n.title === KV_TITLE)?.id || (await cf(`/accounts/${account}/storage/kv/namespaces`, { method: 'POST', body: { title: KV_TITLE } })).id;
    steps.push('Settings store ready');
  }

  // 4. The Worker itself, with its settings and the keep-warm schedule
  const code = await fs.readFile(WORKER_FILE, 'utf8');
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    main_module: 'worker.js', compatibility_date: '2026-10-01',
    bindings: [{ type: 'kv_namespace', name: 'CONFIG', namespace_id: kv }, { type: 'secret_text', name: 'EDGE_SECRET', text: secret }, { type: 'plain_text', name: 'ORIGINS', text: origins.join(',') }],
  })], { type: 'application/json' }));
  form.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');
  await cf(`/accounts/${account}/workers/scripts/${SCRIPT}`, { method: 'PUT', form });
  await cf(`/accounts/${account}/workers/scripts/${SCRIPT}/schedules`, { method: 'PUT', body: [{ cron: '*/5 * * * *' }] });
  await putOrigins(account, kv, origins);
  steps.push(`Edge uploaded; it sends visitors to ${origins[0]}${origins.length > 1 ? ` (backup: ${origins.slice(1).join(', ')})` : ''} and wakes every server every 5 minutes`);

  // 5. The address: the domain when it is on Cloudflare, else the free workers.dev one
  let url = null, zone = null, route = false;
  if (domain) {
    zone = await zoneFor(domain);
    if (zone) {
      const recs = await cf(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}`);
      const rec = recs?.find(r => ['A', 'AAAA', 'CNAME'].includes(r.type));
      // The Worker answers only for names that go through Cloudflare (orange cloud).
      if (!rec) await cf(`/zones/${zone.id}/dns_records`, { method: 'POST', body: { type: 'A', name: domain, content: '192.0.2.1', proxied: true, ttl: 1, comment: 'Brightolio edge (Admin → Hosting)' } });
      else if (!rec.proxied) await cf(`/zones/${zone.id}/dns_records/${rec.id}`, { method: 'PATCH', body: { proxied: true } });
      const pattern = domain + '/*', routes = await cf(`/zones/${zone.id}/workers/routes`);
      const old = routes?.find(r => r.pattern === pattern);
      if (old) await cf(`/zones/${zone.id}/workers/routes/${old.id}`, { method: 'PUT', body: { pattern, script: SCRIPT } });
      else await cf(`/zones/${zone.id}/workers/routes`, { method: 'POST', body: { pattern, script: SCRIPT } });
      url = 'https://' + domain; route = true;
      steps.push(zone.status === 'active' ? `${domain} now goes through the edge`
        : `${domain} is ready for the edge, but Cloudflare is still waiting for ${zone.name}'s name servers to change (status: ${zone.status}). Put Cloudflare's two name servers at the company where you bought ${zone.name}; the edge starts by itself when Cloudflare sees them (minutes to a few hours).`);
    } else steps.push(`${domain} is not on this Cloudflare account yet, so for now the edge uses a free workers.dev address. To use ${domain}: Cloudflare → Add a domain → ${domain.split('.').slice(-2).join('.')}, then press this button again.`);
  }
  if (!url) {
    const sub = await workersDevName(account);
    await cf(`/accounts/${account}/workers/scripts/${SCRIPT}/subdomain`, { method: 'POST', body: { enabled: true } });
    url = `https://${SCRIPT}.${sub}.workers.dev`;
  }

  // 6. Remember it, so every server can switch the edge (the token stays in Admin → Keys)
  const conf = { account, kv, zone: zone?.id || null, domain: route ? domain : null, url, route, origins, at: Date.now() };
  await siteSet('edge', conf);
  const keep = { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_KV_ID: kv };
  for (const [k, v] of Object.entries(keep)) if (!process.env[k]) process.env[k] = v;
  await saveEnv(keep).catch(() => {});
  steps.push(`The edge answers at ${url}`);
  return { url, route, steps, origins };
}

export async function putOrigins(account, kv, order) {
  const r = await fetch(`${CF()}/accounts/${account}/storage/kv/namespaces/${kv}/values/origins`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'text/plain' }, body: JSON.stringify(order), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw bad('Cloudflare KV: ' + r.status + ' ' + (await r.text()).slice(0, 120), 502);
}

// Is the edge there and answering? (Admin → Hosting shows it.)
export async function edgeCheck() {
  const c = edgeConfig();
  if (!c.url) return null;
  const t0 = Date.now();
  try {
    const r = await fetch(c.url + '/healthz', { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Brightolio-edge-check' } });
    return { url: c.url, up: r.ok, ms: Date.now() - t0, status: r.status };
  } catch (e) { return { url: c.url, up: false, ms: Date.now() - t0, error: String(e.message).slice(0, 80) }; }
}
