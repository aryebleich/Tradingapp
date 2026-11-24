// Reliability: load measurement, load shedding, circuit breakers and capacity planning.
// - Load is the worst of: requests in flight, event-loop delay and heap use (0 = idle, 1 = full).
// - At SHED_AT (85%) non-essential work (analytics, charts data, backtests, AI, background scans)
//   is refused with 503 + Retry-After so order entry, risk controls and sign-in keep working.
// - Each broker gets a circuit breaker: after repeated failures it opens for a cool-down and
//   automated orders wait in the order queue (src/orderqueue.js) instead of hammering it.
// - /metrics exposes the numbers in Prometheus format for the Kubernetes autoscaler, and
//   recommendedReplicas() scales ahead of known busy moments (open, close, macro events, VIX spikes).
import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';
import { nyTime } from './time.js';

// Limits (settings, .env.example). The heap limit is V8's real one (heap_size_limit, which follows
// --max-old-space-size; the Oracle image sets 1536 MB for its 2 GB container), not a fixed number:
// the fixed 450 MB was Render's, and on a machine where V8 may grow the heap to 1.5 GB before it
// collects, a heap of 440 MB is normal, not "full".
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
export const limits = () => ({
  maxInflight: num(process.env.MAX_INFLIGHT, 400),
  lagLimitMs: num(process.env.LAG_LIMIT_MS, 500),
  heapLimitMb: num(process.env.HEAP_LIMIT_MB, Math.round(v8.getHeapStatistics().heap_size_limit / 1048576)),
  shedAt: num(process.env.SHED_AT, 0.85),
  // Shedding starts only after the load stayed at or above SHED_AT this long, and stops after it
  // stayed below for SHED_CALM_MS: one slow moment never turns people away.
  sustainMs: num(process.env.SHED_SUSTAIN_MS, 5000),
  calmMs: num(process.env.SHED_CALM_MS, 3000),
});
const SHED_ENV = () => limits().shedAt;
export let SHED_AT = SHED_ENV();

// The event-loop delay over the last 2 seconds (a fresh window every 2 s), so a single slow moment
// counts for 2 seconds, not 10.
const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
let lagP90 = 0, lagP99 = 0, lagP50 = 0;
setInterval(() => { lagP50 = lag.percentile(50) / 1e6; lagP90 = lag.percentile(90) / 1e6; lagP99 = lag.percentile(99) / 1e6; lag.reset(); }, 2000).unref();
let inflight = 0, forced = null;
const counters = { requests: 0, shed: 0, errors5xx: 0, jobsSkipped: 0, unhandledRejections: 0 };

// The three parts of the load (0 = idle, 1 = full), for diagnosis (/internal/load).
export function loadParts() {
  const L = limits(), heap = process.memoryUsage().heapUsed / 1048576;
  return { inflight: +(inflight / L.maxInflight).toFixed(3), lag: +(lagP90 / L.lagLimitMs).toFixed(3), heap: +(heap / L.heapLimitMb).toFixed(3), lagP50Ms: +lagP50.toFixed(1), lagP90Ms: +lagP90.toFixed(1), lagP99Ms: +lagP99.toFixed(1), heapMb: Math.round(heap), heapLimitMb: L.heapLimitMb };
}
const shedLog = []; // the last 50 refused requests: when, which route, why
export const shedEvents = () => shedLog.slice();
export function load() {
  if (forced != null) return forced;
  const p = loadParts();
  return Math.min(1, Math.max(p.inflight, p.lag, p.heap));
}
// Tests and chaos drills can pin the load level (a pinned load counts as sustained at once).
export const forceLoad = v => { forced = v == null ? null : +v; };

// Hysteresis: how long the load has stayed at or above each level. observe() is fed every 500 ms;
// a level turns on after sustainMs at or above it, and off after calmMs below it.
export function makeHysteresis() {
  const over = { shed: null, normal: null }, under = { shed: null, normal: null }, active = { shed: false, normal: false };
  return {
    active,
    observe(l, t = Date.now()) {
      const L = limits();
      for (const [k, at] of [['shed', L.shedAt], ['normal', Math.max(L.shedAt, 0.97)]]) {
        if (l >= at) { under[k] = null; over[k] ??= t; if (t - over[k] >= L.sustainMs) active[k] = true; }
        else { over[k] = null; under[k] ??= t; if (t - under[k] >= L.calmMs) active[k] = false; }
      }
      return { ...active };
    },
  };
}
const H = makeHysteresis();
setInterval(() => H.observe(load()), 500).unref();
const level = k => (forced != null ? forced >= (k === 'shed' ? SHED_ENV() : Math.max(SHED_ENV(), 0.97)) : H.active[k]);
export const shedding = () => level('shed');

// Never shed: anything that is not an API call (the pages, the app shell, scripts, styles, images,
// fonts, the manifest, the service worker, sign-in with Google), and these API calls: trading, risk
// controls, the account lock, sign-in, webhooks that carry orders, health.
const CRITICAL = [/^\/api\/admin\/aichat/, /^\/api\/admin\/ai\//, /^\/api\/orders/, /^\/api\/alpaca\/orders/, /^\/api\/alpaca\/positions/, /^\/api\/risk/, /^\/api\/security/, /^\/api\/auth/, /^\/hook\//, /^\/api\/fleet\/inbox/, /^\/healthz/, /^\/readyz/, /^\/metrics/, /^\/api\/exec/, /^\/api\/me\b/, /^\/api\/v1\/orders/];
// Shed first: heavy reads that can wait.
const OPTIONAL = [/^\/api\/insights/, /^\/api\/news/, /^\/api\/institutions/, /^\/api\/ml/, /^\/api\/scanners\/run/, /^\/api\/baskets\/backtest/, /^\/api\/backtest/, /^\/api\/alpaca\/data\/(bars|news|movers|most-actives)/,
  /^\/api\/code\/prices/, /^\/api\/ai\//, /^\/api\/options\/(scan|template)/, /^\/api\/values\/(screen|portfolio)/, /^\/api\/market/, /^\/api\/tax/, /^\/api\/longterm/];
export const classify = path => (!/^\/api(\/|$)/.test(path) || CRITICAL.some(r => r.test(path)) ? 'critical' : OPTIONAL.some(r => r.test(path)) ? 'optional' : 'normal');

export const SHED_MESSAGE = 'This is taking longer than usual. Trying again…';
// A browser that opens a refused address itself gets a small page that tries again by itself.
const retryPage = seconds => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${seconds}"><title>Brightolio</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1f2937;background:#f8fafc}@media(prefers-color-scheme:dark){body{color:#e5e7eb;background:#0f172a}}p{max-width:30em;padding:0 16px;text-align:center}</style></head><body><p>${SHED_MESSAGE}</p></body></html>`;
export function shedMiddleware(req, res, next) {
  counters.requests++;
  const kind = classify(req.path);
  if (kind === 'optional' && level('shed') || kind === 'normal' && level('normal')) {
    counters.shed++;
    shedLog.push({ at: Date.now(), method: req.method, path: req.path.slice(0, 80), kind, load: +load().toFixed(3), parts: loadParts() }); if (shedLog.length > 50) shedLog.shift();
    const wait = 3 + Math.floor(Math.random() * 3); // spread the retries out
    res.setHeader('Retry-After', String(wait));
    if (req.method === 'GET' && !req.get('x-requested-with') && req.accepts(['json', 'html']) === 'html') return res.status(503).type('html').send(retryPage(wait));
    return res.status(503).json({ error: SHED_MESSAGE, shed: true, retryAfter: wait });
  }
  inflight++;
  let done = false;
  const end = () => { if (!done) { done = true; inflight--; if (res.statusCode >= 500) counters.errors5xx++; } };
  res.on('finish', end); res.on('close', end);
  next();
}
// Background jobs that are not about money in motion pause while the server is overloaded.
export function jobAllowed(name) {
  if (!shedding() || ['guard', 'intraday', 'orderqueue', 'baskets', 'income'].includes(name)) return true;
  counters.jobsSkipped++;
  return false;
}

// ---------- circuit breakers ----------
const breakers = new Map();
export class Breaker {
  constructor(name, { failures = 5, windowMs = 60e3, coolDownMs = 30e3 } = {}) { Object.assign(this, { name, failures, windowMs, coolDownMs, fails: [], openedAt: 0, state: 'closed', trips: 0 }); }
  allow() {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.coolDownMs) this.state = 'half-open';
    return this.state !== 'open';
  }
  success() { this.fails = []; this.state = 'closed'; }
  failure() {
    const t = Date.now(); this.fails = this.fails.filter(x => t - x < this.windowMs); this.fails.push(t);
    if (this.state === 'half-open' || this.fails.length >= this.failures) { this.state = 'open'; this.openedAt = t; this.trips++; }
  }
  async run(fn) {
    if (!this.allow()) throw Object.assign(new Error(`${this.name} is not responding; trying again in a few seconds`), { status: 503, breakerOpen: true });
    try { const r = await fn(); this.success(); return r; }
    catch (e) { if (isOutage(e)) this.failure(); throw e; }
  }
  info() { this.allow(); return { name: this.name, state: this.state, recentFailures: this.fails.length, trips: this.trips, openedAt: this.openedAt || null }; }
}
// Only outages count against a broker: timeouts, network errors, 5xx and rate limits, not a
// rejected order (bad symbol, not enough cash).
export const isOutage = e => e?.breakerOpen || e?.name === 'TimeoutError' || e?.name === 'AbortError' || /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(e?.message || '') || e?.status >= 500 || e?.status === 429;
export const breaker = name => breakers.get(name) || breakers.set(name, new Breaker(name)).get(name);
export const breakerStates = () => [...breakers.values()].map(b => b.info());

// Chaos drills on a staging server: CHAOS_FAIL_RATE (0..1) makes broker calls fail at random and
// CHAOS_LATENCY_MS adds delay, so breakers, the queue and failover can be watched under stress.
export async function chaos() {
  if (process.env.NODE_ENV === 'production' && !process.env.CHAOS_ALLOW_PROD) return;
  const ms = +process.env.CHAOS_LATENCY_MS || 0, rate = +process.env.CHAOS_FAIL_RATE || 0;
  if (ms) await new Promise(r => setTimeout(r, Math.random() * ms));
  if (rate && Math.random() < rate) throw Object.assign(new Error('chaos: simulated broker outage'), { status: 503 });
}

// ---------- capacity planning ----------
// Known busy moments in New York time, plus macro-event days from ECONOMIC_EVENT_DATES
// (comma separated YYYY-MM-DD: FOMC, CPI, jobs report) and a volatility signal (VIX proxy).
let vol = { at: 0, spike: false, value: null };
export const setVolatility = v => { vol = { at: Date.now(), ...v }; };
export function recommendedReplicas(t = Date.now(), { base = +process.env.BASE_REPLICAS || 2, max = +process.env.MAX_REPLICAS || 20 } = {}) {
  const n = nyTime(t), m = n.minutes, weekday = !['Sat', 'Sun'].includes(n.weekday), reasons = [];
  let f = 1;
  if (weekday && m >= 4 * 60 && m < 9 * 60 + 20) { f = Math.max(f, 1.5); reasons.push('pre-market'); }
  if (weekday && m >= 9 * 60 + 20 && m < 10 * 60 + 15) { f = Math.max(f, 3); reasons.push('market open'); }
  if (weekday && m >= 15 * 60 + 40 && m < 16 * 60 + 10) { f = Math.max(f, 2.5); reasons.push('market close (daily bots run)'); }
  const events = String(process.env.ECONOMIC_EVENT_DATES || '').split(',').map(s => s.trim());
  if (events.includes(n.day) && weekday && m >= 8 * 60 && m < 16 * 60 + 30) { f = Math.max(f, 3); reasons.push('macro event day'); }
  if (vol.spike && Date.now() - vol.at < 3600e3) { f = Math.max(f, 4); reasons.push(`volatility spike${vol.value != null ? ` (${vol.value})` : ''}`); }
  const l = load(); if (l > 0.7) { f = Math.max(f, 1 + l * 2); reasons.push(`current load ${Math.round(l * 100)}%`); }
  return { replicas: Math.min(max, Math.max(base, Math.ceil(base * f))), base, max, factor: +f.toFixed(2), reasons: reasons.length ? reasons : ['normal'] };
}

// Promises nobody caught: logged and counted (Admin → System health, /metrics) instead of crashing.
export const countUnhandled = () => { counters.unhandledRejections++; };
export function stats() {
  const mem = process.memoryUsage();
  const L = limits();
  return { load: +load().toFixed(3), shedding: shedding(), shedAt: L.shedAt, inflight, maxInflight: L.maxInflight, eventLoopP90Ms: +lagP90.toFixed(1), eventLoopP99Ms: +lagP99.toFixed(1), lagLimitMs: L.lagLimitMs, heapMb: Math.round(mem.heapUsed / 1048576), heapLimitMb: L.heapLimitMb, uptimeSec: Math.round(process.uptime()), ...counters, breakers: breakerStates() };
}
// Prometheus text format, for the Horizontal Pod Autoscaler (through a metrics adapter) and dashboards.
export function metricsText(extra = {}) {
  const s = stats(), r = recommendedReplicas();
  const lines = [
    ['qp_load_ratio', 'Worst of in-flight, event-loop delay and heap use (0-1)', s.load], ['qp_inflight_requests', 'Requests in flight', s.inflight],
    ['qp_event_loop_p99_ms', 'Event loop delay p99', s.eventLoopP99Ms], ['qp_heap_mb', 'Heap in use', s.heapMb], ['qp_requests_total', 'Requests since start', s.requests],
    ['qp_shed_total', 'Requests refused by load shedding', s.shed], ['qp_jobs_skipped_total', 'Background jobs paused by load shedding', s.jobsSkipped],
    ['qp_recommended_replicas', 'Replicas the capacity planner recommends', r.replicas], ...Object.entries(extra).map(([k, v]) => [k, k, v]),
  ];
  let out = lines.map(([k, h, v]) => `# HELP ${k} ${h}\n# TYPE ${k} gauge\n${k} ${+v || 0}`).join('\n');
  out += '\n# HELP qp_breaker_open Circuit breaker open (1) per broker\n# TYPE qp_breaker_open gauge\n' + s.breakers.map(b => `qp_breaker_open{broker="${b.name}"} ${b.state === 'open' ? 1 : 0}`).join('\n');
  return out + '\n';
}

// ---------- response times per route (PERFORMANCE.md) ----------
// The last 400 durations of each route (ids and symbols collapsed: /api/stock/AAPL → /api/stock/:x),
// for the p50 and p95 that /internal/load and Admin → Hosting show. A few kilobytes in all.
const ROUTE_T = new Map();
export const routeKey = (method, url) => method + ' ' + String(url).split('?')[0]
  .replace(/\/hook\/.*/, '/hook/:secret').replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:n')
  .replace(/^(\/api\/(?:stock|quote|chart|analyze|desk\/quote|bars|news|options|filings|company|logo)s?)\/[^/]+/i, '$1/:x').slice(0, 80);
export function recordRoute(method, url, ms) {
  const k = routeKey(method, url);
  let a = ROUTE_T.get(k); if (!a) { if (ROUTE_T.size >= 600) return; ROUTE_T.set(k, (a = { n: 0, d: [] })); }
  a.n++; a.d.push(ms); if (a.d.length > 400) a.d.shift();
}
export function routeTimes(top = 30) {
  const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return [...ROUTE_T].map(([route, a]) => { const s = [...a.d].sort((x, y) => x - y); return { route, count: a.n, p50: q(s, 0.5), p95: q(s, 0.95), max: s[s.length - 1] }; })
    .sort((a, b) => b.count - a.count).slice(0, top);
}
export const resetRouteTimes = () => ROUTE_T.clear();
