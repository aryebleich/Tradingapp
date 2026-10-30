// Reliability: load measurement, load shedding, circuit breakers and capacity planning.
// - Load is the worst of: requests in flight, event-loop delay and heap use (0 = idle, 1 = full).
// - At SHED_AT (85%) non-essential work (analytics, charts data, backtests, AI, background scans)
//   is refused with 503 + Retry-After so order entry, risk controls and sign-in keep working.
// - Each broker gets a circuit breaker: after repeated failures it opens for a cool-down and
//   automated orders wait in the order queue (src/orderqueue.js) instead of hammering it.
// - /metrics exposes the numbers in Prometheus format for the Kubernetes autoscaler, and
//   recommendedReplicas() scales ahead of known busy moments (open, close, macro events, VIX spikes).
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { nyTime } from './time.js';

const MAX_INFLIGHT = +process.env.MAX_INFLIGHT || 200;
const LAG_LIMIT_MS = +process.env.LAG_LIMIT_MS || 500;
const HEAP_LIMIT_MB = +process.env.HEAP_LIMIT_MB || 450;
const SHED_ENV = () => +process.env.SHED_AT || 0.85;
export let SHED_AT = SHED_ENV();

const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
let inflight = 0, forced = null;
const counters = { requests: 0, shed: 0, errors5xx: 0, jobsSkipped: 0, unhandledRejections: 0 };

export function load() {
  if (forced != null) return forced;
  const lagMs = lag.percentile(90) / 1e6, heap = process.memoryUsage().heapUsed / 1048576;
  return Math.min(1, Math.max(inflight / MAX_INFLIGHT, lagMs / LAG_LIMIT_MS, heap / HEAP_LIMIT_MB));
}
// Tests and chaos drills can pin the load level.
export const forceLoad = v => { forced = v == null ? null : +v; };
setInterval(() => lag.reset(), 10e3).unref();
export const shedding = () => load() >= SHED_ENV();

// Never shed: trading, risk controls, the account lock, sign-in, webhooks that carry orders, health.
const CRITICAL = [/^\/api\/orders/, /^\/api\/alpaca\/orders/, /^\/api\/alpaca\/positions/, /^\/api\/risk/, /^\/api\/security/, /^\/api\/auth/, /^\/hook\//, /^\/api\/fleet\/inbox/, /^\/healthz/, /^\/readyz/, /^\/metrics/, /^\/api\/exec/];
// Shed first: heavy reads that can wait.
const OPTIONAL = [/^\/api\/insights/, /^\/api\/news/, /^\/api\/institutions/, /^\/api\/ml/, /^\/api\/scanners\/run/, /^\/api\/baskets\/backtest/, /^\/api\/backtest/, /^\/api\/alpaca\/data\/(bars|news|movers|most-actives)/,
  /^\/api\/code\/prices/, /^\/api\/ai\//, /^\/api\/options\/(scan|template)/, /^\/api\/values\/(screen|portfolio)/, /^\/api\/market/, /^\/api\/tax/, /^\/api\/longterm/];
export const classify = path => (CRITICAL.some(r => r.test(path)) ? 'critical' : OPTIONAL.some(r => r.test(path)) ? 'optional' : 'normal');

export function shedMiddleware(req, res, next) {
  counters.requests++;
  const kind = classify(req.path), l = load();
  const at = SHED_ENV();
  if (kind === 'optional' && l >= at || kind === 'normal' && l >= Math.max(at, 0.97)) {
    counters.shed++;
    res.setHeader('Retry-After', '15');
    return res.status(503).json({ error: 'The market is very busy right now. Trading stays available; this page will be back in a few seconds.', shed: true });
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
  return { load: +load().toFixed(3), shedding: shedding(), shedAt: SHED_ENV(), inflight, maxInflight: MAX_INFLIGHT, eventLoopP99Ms: +(lag.percentile(99) / 1e6).toFixed(1), heapMb: Math.round(mem.heapUsed / 1048576), heapLimitMb: HEAP_LIMIT_MB, uptimeSec: Math.round(process.uptime()), ...counters, breakers: breakerStates() };
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
