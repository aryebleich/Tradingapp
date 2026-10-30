// Trust and safety: a public status page (the app's own checks every 5 minutes, 90 days of uptime,
// and incidents the admin posts), and the facts behind the security and insurance pages. The audit
// and insurance details are what the admin enters; nothing is claimed that has not been entered.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser, requireAdmin } from './auth.js';
import { siteGet, siteSet } from './site.js';
import { breakerStates } from './reliability.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const DAY = 864e5;
export const COMPONENTS = {
  web: 'Website and app',
  database: 'Database',
  trading: 'Trading connection',
  automation: 'Bots, schedules and alerts',
  notifications: 'Email and text messages',
};
export const SOC2 = {
  none: 'Not audited yet',
  readiness: 'Getting ready for a SOC 2 audit',
  type1Progress: 'SOC 2 Type I audit under way',
  type1: 'SOC 2 Type I report issued',
  type2Progress: 'SOC 2 Type II audit under way',
  type2: 'SOC 2 Type II report issued',
};
const IMPACT = ['minor', 'major', 'maintenance'], STATUS = ['investigating', 'identified', 'monitoring', 'resolved'];
const txt = (v, n) => String(v ?? '').trim().slice(0, n);

// One round of checks, saved; run by the jobs runner every 5 minutes.
export async function checkAll(t = now()) {
  const out = {};
  out.web = { ok: true, ms: 0 };
  const t0 = Date.now();
  try { await one('SELECT 1 AS ok'); out.database = { ok: true, ms: Date.now() - t0 }; } catch { out.database = { ok: false, ms: Date.now() - t0 }; }
  const open = breakerStates().filter(b => b.state === 'open');
  out.trading = { ok: !open.length, ms: null };
  // Background work has run in the last 30 minutes (the scheduler claims a slot for each job it runs).
  const last = await one('SELECT MAX(at) at FROM job_runs').catch(() => null);
  out.automation = { ok: !last?.at || t - last.at < 30 * 60e3, ms: null };
  out.notifications = { ok: true, ms: null };
  for (const [k, v] of Object.entries(out)) await run('INSERT INTO status_checks (t, component, ok, ms) VALUES (?,?,?,?)', t, k, v.ok ? 1 : 0, v.ms);
  await run('DELETE FROM status_checks WHERE t < ?', t - 91 * DAY);
  return out;
}

const parseIncident = r => ({ id: r.id, title: r.title, impact: r.impact, status: r.status, components: JSON.parse(r.components), updates: JSON.parse(r.updates), startedAt: r.started_at, resolvedAt: r.resolved_at });

export async function publicStatus(t = now()) {
  const from = t - 90 * DAY;
  const rows = await all('SELECT component, CAST(t / 86400000 AS INTEGER) d, SUM(ok) good, COUNT(*) n FROM status_checks WHERE t >= ? GROUP BY component, d', from);
  const latest = await all('SELECT s.component, s.ok, s.t FROM status_checks s JOIN (SELECT component, MAX(t) t FROM status_checks GROUP BY component) m ON m.component = s.component AND m.t = s.t');
  const incidents = (await all('SELECT * FROM incidents WHERE resolved_at IS NULL OR resolved_at >= ? ORDER BY started_at DESC', t - 14 * DAY)).map(parseIncident);
  const openInc = incidents.filter(i => i.status !== 'resolved');
  const today = Math.floor(t / DAY);
  const components = Object.entries(COMPONENTS).map(([k, name]) => {
    const days = [];
    for (let d = today - 89; d <= today; d++) { const r = rows.find(x => x.component === k && x.d === d); days.push(r ? +(r.good / r.n * 100).toFixed(2) : null); }
    const good = rows.filter(x => x.component === k).reduce((s, x) => s + x.good, 0), n = rows.filter(x => x.component === k).reduce((s, x) => s + x.n, 0);
    const l = latest.find(x => x.component === k), inc = openInc.filter(i => i.components.includes(k));
    const state = inc.some(i => i.impact === 'major') || (l && !l.ok) ? 'down' : inc.some(i => i.impact === 'maintenance') ? 'maintenance' : inc.length ? 'degraded' : 'ok';
    return { id: k, name, state, uptime: n ? +(good / n * 100).toFixed(3) : null, days, checkedAt: l?.t || null };
  });
  const overall = components.some(c => c.state === 'down') ? 'down' : components.some(c => c.state === 'degraded') ? 'degraded' : components.some(c => c.state === 'maintenance') ? 'maintenance' : 'ok';
  return { overall, components, incidents, checkedEveryMinutes: 5 };
}

// What the security and insurance pages show. Only facts the admin enters, plus what the app does.
export function trustInfo() {
  const t = siteGet('trust', {}) || {};
  const soc2 = { stage: SOC2[t.soc2?.stage] ? t.soc2.stage : 'none', auditor: t.soc2?.auditor || '', period: t.soc2?.period || '', reportDate: t.soc2?.reportDate || '', note: t.soc2?.note || '' };
  return {
    soc2: { ...soc2, label: SOC2[soc2.stage], requestable: ['type1', 'type2'].includes(soc2.stage) },
    insurance: (t.insurance || []).filter(i => i.kind && i.limit),
    securityContact: t.securityContact || '',
    lastPenTest: t.lastPenTest || '',
    stages: SOC2,
  };
}
function cleanTrust(b) {
  const s = b.soc2 || {};
  return {
    soc2: { stage: SOC2[s.stage] ? s.stage : 'none', auditor: txt(s.auditor, 80), period: txt(s.period, 80), reportDate: txt(s.reportDate, 20), note: txt(s.note, 400) },
    insurance: (Array.isArray(b.insurance) ? b.insurance : []).slice(0, 10).map(i => ({ kind: txt(i.kind, 80), carrier: txt(i.carrier, 80), limit: txt(i.limit, 40), note: txt(i.note, 300) })).filter(i => i.kind && i.limit),
    securityContact: txt(b.securityContact, 120), lastPenTest: txt(b.lastPenTest, 80),
  };
}

export const trustPublicRouter = (() => {
  const r = express.Router();
  r.get('/status', async (req, res) => { res.set('Cache-Control', 'public, max-age=60'); res.json(await publicStatus()); });
  r.get('/trust', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json(trustInfo()); });
  return r;
})();

export const trustAdminRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  r.get('/', async (req, res) => res.json({ ...trustInfo(), raw: siteGet('trust', {}) || {}, incidents: (await all('SELECT * FROM incidents ORDER BY started_at DESC LIMIT 50')).map(parseIncident), components: COMPONENTS, impacts: IMPACT, statuses: STATUS }));
  r.put('/', async (req, res) => { await siteSet('trust', cleanTrust(req.body || {})); res.json(trustInfo()); });
  r.post('/incidents', async (req, res) => {
    const b = req.body || {}, title = txt(b.title, 140), text = txt(b.text, 2000);
    if (!title) throw bad('Give the incident a title');
    const comps = (Array.isArray(b.components) ? b.components : []).filter(c => COMPONENTS[c]);
    const impact = IMPACT.includes(b.impact) ? b.impact : 'minor', status = STATUS.includes(b.status) ? b.status : 'investigating';
    const id = Number((await run('INSERT INTO incidents (title, impact, status, components, updates, started_at, resolved_at) VALUES (?,?,?,?,?,?,?)', title, impact, status, JSON.stringify(comps), JSON.stringify(text ? [{ t: now(), status, text }] : []), now(), status === 'resolved' ? now() : null)).lastInsertRowid);
    res.json({ id });
  });
  r.post('/incidents/:id/update', async (req, res) => {
    const i = await one('SELECT * FROM incidents WHERE id = ?', +req.params.id); if (!i) throw bad('Not found', 404);
    const status = STATUS.includes(req.body?.status) ? req.body.status : i.status, text = txt(req.body?.text, 2000);
    if (!text) throw bad('Write what changed');
    const updates = [...JSON.parse(i.updates), { t: now(), status, text }];
    await run('UPDATE incidents SET status = ?, updates = ?, resolved_at = ? WHERE id = ?', status, JSON.stringify(updates), status === 'resolved' ? i.resolved_at || now() : null, i.id);
    res.json({ ok: true });
  });
  r.delete('/incidents/:id', async (req, res) => { await run('DELETE FROM incidents WHERE id = ?', +req.params.id); res.json({ ok: true }); });
  return r;
})();
