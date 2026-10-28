// Predictive models and trainable agents. A logistic regression learns, from indicator features on
// daily bars, the chance that a symbol is higher after N days. It is tested walk-forward (trained on
// the first 70% of history, scored on the last 30% it never saw), then refitted on everything to
// forecast today. An agent is a saved model plus trading settings; deployed agents trade daily.
import express from 'express';
import { spend } from './credits.js';
import { one, all, run, now, audit } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import { getBars, accountSummary, placeOrder } from './brokers.js';
import { sma, rsi, bollinger, macd, stdev } from './ta.js';
import { nyTime, stockSession, isCryptoSymbol } from './time.js';
import { isPaid } from './fees.js';
import { killed } from './risk.js';
import { notifyUser } from './notify-user.js';

export const FEATURES = {
  ret1: 'Return, 1 day', ret5: 'Return, 5 days', ret20: 'Return, 20 days', ret60: 'Return, 60 days',
  rsi14: 'RSI(14)', dist20: 'Distance from 20-day average', dist50: 'Distance from 50-day average', dist200: 'Distance from 200-day average',
  vol20: 'Volatility, 20 days', bbpos: 'Position in Bollinger band', macdh: 'MACD histogram',
};
export const DEFAULT_CONFIG = { features: Object.keys(FEATURES), horizon: 5, threshold: 0.55, years: 8, l2: 0.01 };

export function featureMatrix(closes) {
  const c = closes, s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c, 14), bb = bollinger(c, 20, 2), m = macd(c);
  const rows = [];
  for (let i = 0; i < c.length; i++) {
    if (i < 200 || s200[i] == null || r[i] == null || !bb[i] || m[i].signal == null) { rows.push(null); continue; }
    const rets = []; for (let k = i - 19; k <= i; k++) rets.push(c[k] / c[k - 1] - 1);
    rows.push({
      ret1: c[i] / c[i - 1] - 1, ret5: c[i] / c[i - 5] - 1, ret20: c[i] / c[i - 20] - 1, ret60: c[i] / c[i - 60] - 1,
      rsi14: r[i] / 100 - 0.5, dist20: c[i] / s20[i] - 1, dist50: c[i] / s50[i] - 1, dist200: c[i] / s200[i] - 1,
      vol20: stdev(rets), bbpos: bb[i].up > bb[i].lo ? (c[i] - bb[i].lo) / (bb[i].up - bb[i].lo) - 0.5 : 0, macdh: (m[i].macd - m[i].signal) / c[i],
    });
  }
  return rows;
}

const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
// Logistic regression by full-batch gradient descent on standardized features.
export function fit(X, y, { l2 = 0.01, iters = 400, lr = 0.5 } = {}) {
  const d = X[0].length, mean = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) x.forEach((v, j) => (mean[j] += v / X.length));
  for (const x of X) x.forEach((v, j) => (sd[j] += (v - mean[j]) ** 2 / X.length));
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map(x => x.map((v, j) => (v - mean[j]) / sd[j]));
  const w = Array(d).fill(0); let b = 0;
  for (let t = 0; t < iters; t++) {
    const gw = Array(d).fill(0); let gb = 0;
    for (let i = 0; i < Z.length; i++) { const e = sigmoid(Z[i].reduce((a, v, j) => a + v * w[j], b)) - y[i]; gb += e; Z[i].forEach((v, j) => (gw[j] += e * v)); }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / Z.length + l2 * w[j]);
    b -= lr * gb / Z.length;
  }
  return { w, b, mean, sd };
}
export const predict = (model, x) => sigmoid(x.reduce((a, v, j) => a + (v - model.mean[j]) / model.sd[j] * model.w[j], model.b));

// Area under the ROC curve: the chance a random "up" day scores above a random "down" day.
function auc(p, y) {
  const pos = p.filter((_, i) => y[i]), neg = p.filter((_, i) => !y[i]);
  if (!pos.length || !neg.length) return null;
  let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / pos.length / neg.length;
}

export function train(closes, dates, cfg = DEFAULT_CONFIG) {
  const c = { ...DEFAULT_CONFIG, ...cfg }, h = Math.max(1, Math.min(60, Math.round(c.horizon)));
  const feats = c.features.filter(f => FEATURES[f]);
  if (!feats.length) throw Object.assign(new Error('Pick at least one feature'), { status: 400 });
  const F = featureMatrix(closes), idx = [];
  for (let i = 0; i < closes.length - h; i++) if (F[i]) idx.push(i);
  if (idx.length < 300) throw Object.assign(new Error('Not enough history to train (need about 2 years after the 200-day warm-up)'), { status: 400 });
  const X = idx.map(i => feats.map(f => F[i][f])), y = idx.map(i => (closes[i + h] > closes[i] ? 1 : 0));
  const cut = Math.floor(idx.length * 0.7);
  const m = fit(X.slice(0, cut), y.slice(0, cut), { l2: c.l2 });
  const pTest = X.slice(cut).map(x => predict(m, x)), yTest = y.slice(cut);
  const hits = pTest.filter((p, i) => (p > 0.5 ? 1 : 0) === yTest[i]).length, signals = pTest.map(p => p > c.threshold);
  const sigHits = yTest.filter((v, i) => signals[i] && v).length, sigN = signals.filter(Boolean).length;
  // Out-of-sample trading: hold the next day whenever the model's chance is above the threshold.
  let eq = 1, bh = 1, peak = 1, dd = 0; const rets = [], curve = [];
  for (let k = 0; k < pTest.length; k++) {
    const i = idx[cut + k]; if (i + 1 >= closes.length) break;
    const r = closes[i + 1] / closes[i] - 1, sr = signals[k] ? r : 0;
    eq *= 1 + sr; bh *= 1 + r; rets.push(sr); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    if (k % 5 === 0) curve.push({ d: dates[i + 1], eq: +eq.toFixed(4), bh: +bh.toFixed(4) });
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const metrics = {
    testFrom: dates[idx[cut]], testTo: dates[idx.at(-1)], testDays: yTest.length, horizon: h,
    accuracy: +(hits / yTest.length * 100).toFixed(1), baseRate: +(yTest.filter(Boolean).length / yTest.length * 100).toFixed(1),
    auc: auc(pTest, yTest) != null ? +auc(pTest, yTest).toFixed(3) : null,
    signalDays: sigN, signalHitRate: sigN ? +(sigHits / sigN * 100).toFixed(1) : null,
    strategyReturn: +((eq - 1) * 100).toFixed(1), buyHoldReturn: +((bh - 1) * 100).toFixed(1), maxDrawdown: +(dd * 100).toFixed(1),
    sharpe: rets.length > 20 ? +(mean / (stdev(rets) || 1) * Math.sqrt(252)).toFixed(2) : null,
  };
  // Refit on all history for today's forecast; calibrate the expected move by probability bucket.
  const full = fit(X, y, { l2: c.l2 });
  const pAll = X.map(x => predict(full, x)), fwd = idx.map(i => closes[i + h] / closes[i] - 1);
  const xNow = feats.map(f => F.at(-1)?.[f]);
  if (xNow.some(v => v == null || !Number.isFinite(v))) throw Object.assign(new Error('Not enough recent data to forecast'), { status: 400 });
  const pNow = predict(full, xNow), near = fwd.filter((_, i) => Math.abs(pAll[i] - pNow) < 0.05);
  const importance = feats.map((f, j) => ({ feature: f, label: FEATURES[f], weight: +full.w[j].toFixed(3) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    config: { ...c, horizon: h, features: feats }, model: { ...full, features: feats }, metrics, curve, importance,
    forecast: { asOf: dates.at(-1), price: closes.at(-1), probUp: +(pNow * 100).toFixed(1), expectedMovePct: near.length >= 20 ? +(near.reduce((a, b) => a + b, 0) / near.length * 100).toFixed(2) : null, similarDays: near.length, signal: pNow > c.threshold ? 'buy' : pNow < 1 - c.threshold ? 'avoid' : 'neutral' },
  };
}

const yearsAgo = n => new Date(Date.now() - n * 365 * 864e5).toISOString().slice(0, 10);
export async function forecastSymbol(userId, symbol, cfg = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const b = await getBars(symbol, yearsAgo(Math.min(15, Math.max(3, c.years))), userId);
  const r = train(b.closes, b.dates, c);
  return { symbol: symbol.toUpperCase(), dataSource: b.source, ...r };
}

// Daily: each deployed agent retrains weekly, scores today and trades its symbol.
export async function runAgents(t = now()) {
  const n = nyTime(t), list = await all('SELECT a.*, u.plan, u.role, u.plan_status FROM agents a JOIN users u ON u.id = a.user_id WHERE a.deployed = 1 AND (a.last_run IS NULL OR a.last_run != ?)', n.day);
  let ran = 0;
  for (const a of list) {
    const crypto = isCryptoSymbol(a.symbol);
    if (!crypto && !(stockSession(t) && n.minutes >= 930)) continue; // stocks: last half hour of the session
    if (await killed(a.user_id)) continue;
    if (!(await run('UPDATE agents SET last_run = ? WHERE id = ? AND (last_run IS NULL OR last_run != ?)', n.day, a.id, n.day)).changes) continue;
    ran++;
    let action = 'hold';
    try {
      if (a.account !== 'paper' && !isPaid(a)) { await run('UPDATE agents SET deployed = 0 WHERE id = ?', a.id); throw new Error('stopped: agents on real accounts need the Pro plan'); }
      const cfg = JSON.parse(a.config);
      const r = await forecastSymbol(a.user_id, a.symbol, cfg);
      if (!a.trained_at || t - a.trained_at > 7 * 864e5) await run('UPDATE agents SET model = ?, metrics = ?, trained_at = ? WHERE id = ?', JSON.stringify(r.model), JSON.stringify({ ...r.metrics, forecast: r.forecast }), t, a.id);
      const s = await accountSummary(a.user_id, a.account), pos = s.positions.find(p => p.symbol === a.symbol.toUpperCase());
      const p = r.forecast.probUp / 100;
      if (pos && p < 0.5) { await placeOrder(a.user_id, a.account, { symbol: a.symbol, side: 'sell', qty: pos.qty, expectedPrice: r.forecast.price }, `agent:${a.id}`); action = `sold (chance up ${r.forecast.probUp}%)`; }
      else if (!pos && p > cfg.threshold) {
        const notional = +(s.cash * Math.min(a.size, 100) / 100 * 0.98).toFixed(2);
        if (notional >= 1) { await placeOrder(a.user_id, a.account, { symbol: a.symbol, side: 'buy', notional, expectedPrice: r.forecast.price }, `agent:${a.id}`); action = `bought $${notional} (chance up ${r.forecast.probUp}%)`; }
      } else action = `hold (chance up ${r.forecast.probUp}%)`;
    } catch (e) { action = 'error: ' + e.message; }
    await run('UPDATE agents SET last_action = ? WHERE id = ?', action, a.id);
    if (!action.startsWith('hold')) await notifyUser(a.user_id, `AI agent "${a.name}" ${a.symbol}: ${action}`);
  }
  return ran;
}

const cleanCfg = b => ({
  features: (Array.isArray(b.features) ? b.features : DEFAULT_CONFIG.features).filter(f => FEATURES[f]),
  horizon: Math.max(1, Math.min(60, +b.horizon || DEFAULT_CONFIG.horizon)), threshold: Math.max(0.5, Math.min(0.9, +b.threshold || DEFAULT_CONFIG.threshold)),
  years: Math.max(3, Math.min(15, +b.years || DEFAULT_CONFIG.years)), l2: Math.max(0, Math.min(1, b.l2 == null ? DEFAULT_CONFIG.l2 : +b.l2)),
});
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const mlRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/features', (req, res) => res.json({ features: FEATURES, defaults: DEFAULT_CONFIG }));
  r.post('/forecast', async (req, res) => {
    if (!rateLimit('ml:' + req.user.id, 40, 3600e3)) throw bad('Too many model runs this hour, try again later', 429);
    const symbol = String(req.body.symbol || '').trim().toUpperCase(); if (!symbol) throw bad('Pick a symbol');
    res.json(await forecastSymbol(req.user.id, symbol, cleanCfg(req.body)));
  });
  r.get('/agents', async (req, res) => res.json((await all('SELECT * FROM agents WHERE user_id = ? ORDER BY id DESC', req.user.id)).map(a => ({ ...a, config: JSON.parse(a.config), metrics: a.metrics ? JSON.parse(a.metrics) : null, model: undefined }))));
  r.post('/agents', async (req, res) => {
    const n = (await one('SELECT COUNT(*) n FROM agents WHERE user_id = ?', req.user.id)).n;
    if (n >= (isPaid(req.user) ? 50 : 3)) throw Object.assign(bad(isPaid(req.user) ? 'Agent limit reached' : 'The free plan has 3 AI agents'), { upgrade: !isPaid(req.user), feature: 'More AI agents', status: 402 });
    const symbol = String(req.body.symbol || '').trim().toUpperCase(), cfg = cleanCfg(req.body);
    await spend(req.user, 'agent', { memo: symbol.slice(0, 10) });
    const r0 = await forecastSymbol(req.user.id, symbol, cfg); // trains and validates before saving
    const id = (await run('INSERT INTO agents (user_id, name, symbol, config, model, metrics, account, size, trained_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      req.user.id, String(req.body.name || `${symbol} ${cfg.horizon}-day agent`).slice(0, 60), symbol, JSON.stringify(cfg), JSON.stringify(r0.model), JSON.stringify({ ...r0.metrics, forecast: r0.forecast }), String(req.body.account || 'paper'), Math.max(1, Math.min(100, +req.body.size || 25)), now(), now())).lastInsertRowid;
    res.json({ id, ...r0 });
  });
  r.post('/agents/:id/deploy', async (req, res) => {
    const a = await one('SELECT * FROM agents WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!a) throw bad('No such agent', 404);
    const account = String(req.body.account || a.account || 'paper'), on = req.body.on !== false;
    if (on && account !== 'paper' && !isPaid(req.user)) throw Object.assign(bad('Agents on real accounts are part of Pro'), { status: 402, upgrade: true, feature: 'AI agents on real accounts' });
    await run('UPDATE agents SET deployed = ?, account = ?, size = ? WHERE id = ?', on ? 1 : 0, account, Math.max(1, Math.min(100, +req.body.size || a.size)), a.id);
    await audit(req.user.id, on ? 'agent_deployed' : 'agent_stopped', { id: a.id, account }, req.ip);
    res.json({ ok: true });
  });
  r.delete('/agents/:id', async (req, res) => { await run('DELETE FROM agents WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
})();
