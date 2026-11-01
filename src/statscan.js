// Statistical arbitrage scanner: finds pairs whose prices move together and have pulled apart,
// across a basket the user picks, a sector, the large caps, or the whole US market (the biggest
// companies by value, up to the plan's limit). It runs in the background and reports as it goes,
// so the page can show the scan live: which stock it is loading, how many pairs it has tested, and
// the best pairs found so far. Ways to measure the gap ("methods"):
//   ols       Engle-Granger: fixed hedge ratio by least squares, cointegration test, z-score
//   kalman    Kalman filter: a hedge ratio that adapts every day; z-score of today's surprise
//   distance  Gatev et al.: both prices rebased to 1, the gap between them in standard deviations
//   ratio     price ratio with Bollinger bands (z-score of the ratio)
// and, for a basket, s-scores against the basket's first principal component (PCA) or the equal
// weight basket (see statarb.js).
import crypto from 'node:crypto';
import express from 'express';
import { getBars } from './brokers.js';
import { requireUser, rateLimit } from './auth.js';
import { PAID } from './fees.js';
import { align, BASKETS } from './statarb.js';

const mean = x => x.reduce((a, b) => a + b, 0) / x.length;
const sd = x => { const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); };
function ols(y, x) {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const beta = sxx ? sxy / sxx : 0, alpha = my - beta * mx;
  return { alpha, beta, res: y.map((v, i) => v - alpha - beta * x[i]) };
}
function adf(s) {
  const y = s.slice(1).map((v, i) => v - s[i]), x = s.slice(0, -1), { beta: g, res } = ols(y, x);
  const mx = mean(x), sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0), se = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / Math.max(1, res.length - 2) / (sxx || 1));
  return { t: se ? g / se : 0, halfLife: g < 0 ? -Math.log(2) / Math.log(1 + g) : Infinity };
}
const zOf = (s, w) => { const t = s.slice(-w), m = mean(t), d = sd(t); return d ? (s.at(-1) - m) / d : 0; };
const CRIT5 = -3.34;

// Kalman filter regression y = a + b x with slowly drifting a and b.
export function kalman(y, x, delta = 1e-4, ve = 1e-3) {
  let th = [0, 0], P = [[1, 0], [0, 1]]; const Vw = delta / (1 - delta), e = [], q = [], beta = [];
  for (let t = 0; t < y.length; t++) {
    const F = [1, x[t]];
    P = [[P[0][0] + Vw, P[0][1]], [P[1][0], P[1][1] + Vw]];
    const yhat = F[0] * th[0] + F[1] * th[1], err = y[t] - yhat;
    const PF = [P[0][0] * F[0] + P[0][1] * F[1], P[1][0] * F[0] + P[1][1] * F[1]], Q = F[0] * PF[0] + F[1] * PF[1] + ve, K = [PF[0] / Q, PF[1] / Q];
    th = [th[0] + K[0] * err, th[1] + K[1] * err];
    P = [[P[0][0] - K[0] * PF[0], P[0][1] - K[0] * PF[1]], [P[1][0] - K[1] * PF[0], P[1][1] - K[1] * PF[1]]];
    e.push(err); q.push(Math.sqrt(Q)); beta.push(th[1]);
  }
  return { e, q, beta };
}
export const METHODS = { ols: 'Cointegration (Engle-Granger)', kalman: 'Kalman filter (adaptive hedge ratio)', distance: 'Distance (normalized prices)', ratio: 'Price ratio with Bollinger bands' };

// One pair with one method: how strong the relationship is and how stretched it is today.
export function testPair(pa, pb, method = 'ols', { lookback = 252, zWindow = 60 } = {}) {
  const n = Math.min(pa.length, pb.length), L = Math.min(lookback, n), a = pa.slice(n - L), b = pb.slice(n - L);
  const la = a.map(Math.log), lb = b.map(Math.log);
  const ra = la.slice(1).map((v, i) => v - la[i]), rb = lb.slice(1).map((v, i) => v - lb[i]);
  const ma = mean(ra), mb = mean(rb); let cov = 0, va = 0, vb = 0; for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; }
  const correlation = va && vb ? cov / Math.sqrt(va * vb) : 0;
  let spread, z, hedge, strength;
  if (method === 'kalman') {
    const k = kalman(la, lb); spread = k.e.slice(30); z = k.e.at(-1) / k.q.at(-1); hedge = k.beta.at(-1);
  } else if (method === 'distance') {
    const na = a.map(v => v / a[0]), nb = b.map(v => v / b[0]); spread = na.map((v, i) => v - nb[i]); z = zOf(spread, zWindow); hedge = a[0] / b[0];
  } else if (method === 'ratio') {
    spread = a.map((v, i) => v / b[i]); z = zOf(spread, Math.min(zWindow, 20)); hedge = spread.at(-1);
  } else { const f = ols(la, lb); spread = f.res; z = zOf(spread, zWindow); hedge = f.beta; }
  const df = adf(spread);
  strength = method === 'distance' ? spread.reduce((s, v) => s + v * v, 0) : df.t;
  return { correlation: +correlation.toFixed(3), adf: +df.t.toFixed(2), cointegrated: df.t < CRIT5, halfLife: Number.isFinite(df.halfLife) ? +df.halfLife.toFixed(1) : null, z: +z.toFixed(2), hedge: +(+hedge).toFixed(4), strength: +strength.toFixed(3) };
}
// Rank: a real relationship (cointegrated, half-life of days to weeks) that is stretched today.
export const pairScore = r => (r.cointegrated ? 2 : r.adf < -2.5 ? 1 : 0) + (r.halfLife && r.halfLife >= 2 && r.halfLife <= 40 ? 1 : 0) + Math.min(3, Math.abs(r.z)) / 1.5 + Math.max(0, r.correlation - 0.6);

// First principal component of returns (power iteration), for PCA s-scores.
export function pcaFactor(R) {
  const syms = Object.keys(R), T = R[syms[0]].length, Z = syms.map(s => { const m = mean(R[s]), d = sd(R[s]) || 1; return R[s].map(v => (v - m) / d); });
  let w = syms.map(() => 1 / Math.sqrt(syms.length));
  for (let it = 0; it < 50; it++) {
    const f = Array.from({ length: T }, (_, t) => Z.reduce((s, z, i) => s + w[i] * z[t], 0));
    const nw = Z.map(z => z.reduce((s, v, t) => s + v * f[t], 0)), norm = Math.sqrt(nw.reduce((s, v) => s + v * v, 0)) || 1;
    w = nw.map(v => v / norm);
  }
  return Array.from({ length: T }, (_, t) => syms.reduce((s, sym, i) => s + w[i] * R[sym][t], 0) / syms.length);
}

// ---------- universes ----------
export const SCAN_LIMITS = { free: 40, pro: 300, elite: 1000, ultimate: 2000 };
const scanLimit = u => SCAN_LIMITS[u?.role === 'admin' && !u.previewPlan ? 'ultimate' : PAID.includes(u?.plan) && ['active', 'trialing', null, undefined].includes(u?.plan_status) ? u.plan : 'free'];
export async function universe(kind, { symbols = [], size = 100 } = {}) {
  if (kind === 'custom') return symbols;
  if (BASKETS[kind]) return BASKETS[kind];
  const F = await import('./fundamentals.js');
  if (kind === 'large') return F.UNIVERSE;
  if (kind === 'market') {
    // The SEC's list runs roughly from the most valuable companies down: the top N common stocks.
    const all = Object.keys(await F.tickerCiks()).filter(t => /^[A-Z]{1,5}$/.test(t));
    return all.slice(0, size);
  }
  if (kind === 'sectors') return Object.values(BASKETS).flat();
  throw Object.assign(new Error('Pick what to scan'), { status: 400 });
}

// ---------- background scans ----------
const jobs = new Map();
export function startScan(user, b) {
  const lim = scanLimit(user), size = Math.min(+b.size || 100, lim), method = METHODS[b.method] ? b.method : 'ols';
  const id = crypto.randomUUID(), job = { id, userId: user.id, method, status: 'loading', loaded: 0, total: 0, tested: 0, pairs: 0, current: null, top: [], failed: [], startedAt: Date.now(), limit: lim };
  jobs.set(id, job);
  for (const [k, j] of jobs) if (Date.now() - j.startedAt > 3600e3) jobs.delete(k);
  run(job, user, b, size).catch(e => { job.status = 'error'; job.error = e.message; });
  return job;
}
async function run(job, user, b, size) {
  const syms = [...new Set((await universe(b.universe, { symbols: (Array.isArray(b.symbols) ? b.symbols : String(b.symbols || '').split(/[\s,]+/)).map(s => s.trim().toUpperCase()).filter(Boolean), size })).filter(s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)))].slice(0, size);
  if (syms.length < 2) throw new Error('Pick at least 2 stocks');
  job.total = syms.length;
  const start = `${new Date().getUTCFullYear() - 2}-01-01`, series = {};
  for (let i = 0; i < syms.length; i += 6) {
    if (job.cancelled) return;
    await Promise.all(syms.slice(i, i + 6).map(async s => {
      job.current = s;
      try { const bars = await getBars(s, start, user.id); if (bars.closes.length >= 260) series[s] = bars; if (bars.source === 'synthetic') job.synthetic = true; } catch { job.failed.push(s); }
      job.loaded++;
    }));
  }
  const names = Object.keys(series);
  if (names.length < 2) throw new Error('Not enough price history loaded');
  job.status = 'testing'; job.current = null;
  const d = align(series), keep = d.syms.filter(s => d.px[s].length >= 200);
  // Correlation of returns first; only strongly related pairs get the full test (10 best partners each).
  const R = Object.fromEntries(keep.map(s => { const p = d.px[s].slice(-253); return [s, p.slice(1).map((v, i) => Math.log(v / p[i]))]; }));
  const Z = Object.fromEntries(keep.map(s => { const m = mean(R[s]), v = sd(R[s]) || 1; return [s, R[s].map(x => (x - m) / v)]; }));
  const cand = new Map();
  for (let i = 0; i < keep.length; i++) {
    const near = [];
    for (let j = 0; j < keep.length; j++) if (i !== j) { const a = Z[keep[i]], c = Z[keep[j]]; let s = 0; for (let t = 0; t < a.length; t++) s += a[t] * c[t]; near.push([s / a.length, keep[j]]); }
    near.sort((x, y) => y[0] - x[0]);
    // Small lists: every pair is tested; large ones only the 10 most related partners of each stock.
    for (const [c, o] of keep.length <= 30 ? near : near.slice(0, 10)) if (keep.length <= 30 || c > 0.5) cand.set([keep[i], o].sort().join('|'), c);
    if (i % 25 === 0) await new Promise(r => setImmediate(r));
  }
  job.pairs = cand.size;
  const found = [];
  let k = 0;
  for (const key of cand.keys()) {
    if (job.cancelled) return;
    const [a, bb] = key.split('|'), r = testPair(d.px[a], d.px[bb], job.method);
    found.push({ a, b: bb, ...r, score: +pairScore(r).toFixed(2), signal: Math.abs(r.z) >= 2 ? (r.z > 0 ? `Sell ${a}, buy ${bb}` : `Buy ${a}, sell ${bb}`) : Math.abs(r.z) >= 1.25 ? 'Getting stretched' : 'Normal' });
    job.tested++;
    if (++k % 40 === 0) { job.top = [...found].sort((x, y) => y.score - x.score).slice(0, 25); await new Promise(r => setImmediate(r)); }
  }
  job.top = found.sort((x, y) => y.score - x.score).slice(0, 25);
  job.status = 'done'; job.finishedAt = Date.now();
}
export const view = j => ({ id: j.id, method: j.method, methodName: METHODS[j.method], status: j.status, error: j.error || null, loaded: j.loaded, total: j.total, tested: j.tested, pairs: j.pairs, current: j.current, top: j.top, failed: j.failed.slice(0, 20), seconds: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000), limit: j.limit, synthetic: !!j.synthetic });

export const statScanRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/meta', (req, res) => res.json({ methods: METHODS, universes: { large: 'Large US companies (about 130)', market: 'Whole US market (biggest companies first)', sectors: 'All sector baskets', custom: 'My own list', ...Object.fromEntries(Object.keys(BASKETS).map(k => [k, `Basket: ${k}`])) }, limit: scanLimit(req.user), limits: SCAN_LIMITS }));
  r.post('/', (req, res) => {
    if (!rateLimit('statscan:' + req.user.id, 20, 3600e3)) throw Object.assign(new Error('Too many scans this hour'), { status: 429 });
    for (const j of jobs.values()) if (j.userId === req.user.id && !['done', 'error'].includes(j.status)) j.cancelled = true;
    res.json(view(startScan(req.user, req.body || {})));
  });
  r.get('/:id', (req, res) => { const j = jobs.get(req.params.id); if (!j || j.userId !== req.user.id) throw Object.assign(new Error('Scan not found'), { status: 404 }); res.json(view(j)); });
  r.delete('/:id', (req, res) => { const j = jobs.get(req.params.id); if (j && j.userId === req.user.id) j.cancelled = true; res.json({ ok: true }); });
  return r;
})();
