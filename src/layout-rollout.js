// Staged production rollout of the layout redesign (flag layout_v2) with automatic rollback.
//   - First production start with this code: the flag goes on for 10% of visitors (unless the owner
//     already set it in Admin → SEO → Feature flags: their setting always wins).
//   - Every minute, the new layout's visitors are compared with the old layout's visitors over the
//     same minutes: server errors (5xx) and failed order, payment and funding attempts.
//   - Every 5 minutes the live pages are fetched as a new-layout visitor and their disclosures checked.
//   - After 30 minutes at 10% AND at least 300 new-layout requests seen (stored, so restarts do not
//     reset the evidence), with no regression: 100%. A quiet site simply stays at 10%.
//   - If the owner changes the percentage in Admin, the automation stops and their setting stays. On a regression (an error rate above twice the
//     old layout's, or any disclosure check failing): the flag goes off at once, the admins get an
//     e-mail and the rollout stops; it never switches itself back on.
// State is kept in the site settings ("layoutRollout"), shown in Admin with the flags.
import { siteGet, siteSet } from './site.js';
import * as F from './flags.js';

const FLAG = 'layout_v2';
const STAGE_MIN = 30, START_PCT = 10;
// Promotion needs evidence, not just time: at least this much new-layout traffic seen during the
// 10% stage (kept in the stored state, so a restart or redeploy does not reset it to "no problems").
export const MIN_EVIDENCE = { req: 300, money: 0 };
// Order, payment and funding endpoints whose failures count as "failed attempts".
const MONEY = /^\/api\/(orders|trade|options\/orders|billing|checkout|funding|transfers|ach|deposit|withdraw|money|pay)/;
const BENIGN = new Set([401, 403, 404, 409, 429]); // signed out, not allowed, idempotent repeats, rate limits

const w = () => ({ req: 0, err: 0, money: 0, moneyFail: 0 });
let win = { old: w(), new: w() }, history = []; // one entry per minute, last 30 minutes
let deps = { alert: async () => {}, log: console };

export const state = () => siteGet('layoutRollout', null);
const variant = req => {
  const f = F.flagSettings()[FLAG];
  if (!f?.on) return 'old';
  const m = /(?:^|;\s*)qp_vb=([a-f0-9]{16})/.exec(req.headers.cookie || '');
  return m && F.bucketOf(m[1], FLAG) < f.pct ? 'new' : 'old';
};

// Counts every /api response by layout variant.
export function middleware(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const v = variant(req);
  res.on('finish', () => {
    const c = win[v]; c.req++;
    if (res.statusCode >= 500) c.err++;
    if (req.method !== 'GET' && MONEY.test(req.path)) { c.money++; if (res.statusCode >= 400 && !BENIGN.has(res.statusCode)) c.moneyFail++; }
  });
  next();
}

const sum = k => history.reduce((a, h) => { for (const f of Object.keys(a)) a[f] += h[k][f]; return a; }, w());
const rate = (n, d) => (d ? n / d : 0);
// A regression: enough new-layout traffic, and a rate above twice the old layout's (with a small floor
// so one error among a handful of requests on a quiet site is not "twice zero").
export function regression(o, n) {
  const why = [];
  if (n.req >= 50 && rate(n.err, n.req) > 2 * Math.max(rate(o.err, o.req), 0.005)) why.push(`server errors ${n.err}/${n.req} on the new layout vs ${o.err}/${o.req} on the old`);
  if (n.money >= 5 && rate(n.moneyFail, n.money) > 2 * Math.max(rate(o.moneyFail, o.money), 0.02)) why.push(`failed order/payment attempts ${n.moneyFail}/${n.money} on the new layout vs ${o.moneyFail}/${o.money} on the old`);
  return why;
}

// The live disclosure check: each page, as a new-layout visitor, must still carry its disclosures.
export const LIVE_CHECKS = [
  ['/app', ['Trading involves risk of loss', 'Backtests and projections are hypothetical', 'not a broker or investment adviser', '/risk']],
  ['/risk', ['Risk']],
  ['/terms', ['Terms']],
  ['/', ['Risk Disclosure']],
];
export async function liveCheck(base, vid) {
  const bad = [];
  for (const [url, needles] of LIVE_CHECKS) {
    try {
      const r = await fetch(base + url, { headers: { cookie: `qp_vb=${vid}` }, signal: AbortSignal.timeout(15000) });
      const html = await r.text();
      if (!r.ok) bad.push(`${url}: HTTP ${r.status}`);
      for (const s of needles) if (!html.includes(s)) bad.push(`${url}: missing "${s}"`);
      if (url === '/app' && F.flagSettings()[FLAG].on && !/class="lv2"/.test(html)) bad.push('/app: the new layout was not served to a visitor in the rollout');
    } catch (e) { bad.push(`${url}: ${e.message}`); }
  }
  return bad;
}

async function rollback(why) {
  await F.saveFlags({ [FLAG]: { on: false, pct: 0 } });
  await siteSet('layoutRollout', { ...state(), stage: 'rolled_back', at: Date.now(), why });
  deps.log.error(`[layout-rollout] ROLLED BACK: ${why.join('; ')}`);
  await deps.alert('Layout redesign rolled back automatically', `The new layout (flag ${FLAG}) was switched off at ${new Date().toISOString()}.\n\nReason:\n- ${why.join('\n- ')}\n\nEveryone now sees the previous layout. It will not switch itself back on; turn it on again in Admin → SEO → Feature flags once the cause is fixed.`).catch(() => {});
}

export async function tick({ base, now = Date.now() } = {}) {
  history.push(win); win = { old: w(), new: w() };
  if (history.length > STAGE_MIN) history.shift();
  const s = state();
  if (!s || !['10', '100'].includes(String(s.stage))) return s;
  const f = F.flagSettings()[FLAG];
  if (!f.on) { await siteSet('layoutRollout', { ...s, stage: 'stopped', at: now, why: ['switched off in Admin'] }); return state(); }
  // The owner changed the percentage in Admin: their setting wins and the automation stops for good.
  if (f.pct !== (String(s.stage) === '10' ? START_PCT : 100)) { await siteSet('layoutRollout', { ...s, stage: 'manual', at: now, why: [`the owner set ${f.pct}% in Admin`] }); return state(); }
  // Evidence seen during this stage, added to what earlier server runs stored.
  const last = history[history.length - 1], ev = { old: { ...w(), ...(s.ev?.old || {}) }, new: { ...w(), ...(s.ev?.new || {}) } };
  for (const v of ['old', 'new']) for (const k of Object.keys(w())) ev[v][k] += last[v][k];
  await siteSet('layoutRollout', { ...s, ev });
  // A regression over the last 30 minutes, or over the whole stage so far.
  const why = regression(sum('old'), sum('new'));
  if (!why.length) why.push(...regression(ev.old, ev.new).map(x => x + ' (whole stage)'));
  if (base && (now - (s.checkedAt || 0)) >= 5 * 60e3) {
    const vid = vidIn(true);
    why.push(...(await liveCheck(base, vid)).map(x => 'live disclosure check: ' + x));
    await siteSet('layoutRollout', { ...state(), checkedAt: now });
  }
  if (why.length) { await rollback(why); return state(); }
  if (String(s.stage) === '10' && now - s.since >= STAGE_MIN * 60e3 && ev.new.req >= MIN_EVIDENCE.req) {
    await F.saveFlags({ [FLAG]: { on: true, pct: 100 } });
    await siteSet('layoutRollout', { ...state(), stage: '100', since: now, ev: null });
    deps.log.log('[layout-rollout] 30 minutes at 10% with no regression: now 100%');
    await deps.alert('Layout redesign now at 100%', 'The new layout ran for 30 minutes at 10% of visitors with no rise in errors or failed orders and payments, and the live disclosure checks passed. It is now on for everyone. Monitoring and automatic rollback stay on.').catch(() => {});
  }
  return state();
}
// A visitor id inside (or outside) the rollout bucket, for the live check.
function vidIn(inside) { const pct = F.flagSettings()[FLAG].pct || 0; for (let i = 0; ; i++) { const v = i.toString(16).padStart(16, '0'); if ((F.bucketOf(v, FLAG) < pct) === inside || i > 5000) return v; } }

// Called once at server start (production only, and not when LAYOUT_V2_AUTOSTART=0).
export async function start({ base, alert, log = console, now = Date.now() } = {}) {
  deps = { alert: alert || deps.alert, log };
  if (!state()) {
    const saved = (siteGet('flags', {}) || {})[FLAG];
    if (saved) await siteSet('layoutRollout', { stage: 'manual', since: now, why: ['the owner set the flag before the automatic rollout began'] });
    else {
      await F.saveFlags({ [FLAG]: { on: true, pct: START_PCT } });
      await siteSet('layoutRollout', { stage: '10', since: now });
      log.log(`[layout-rollout] started: ${FLAG} on for ${START_PCT}% of visitors`);
    }
  }
  const t = setInterval(() => tick({ base }).catch(e => log.error('[layout-rollout]', e.message)), 60e3);
  t.unref?.();
  return state();
}
export const _reset = () => { win = { old: w(), new: w() }; history = []; };
