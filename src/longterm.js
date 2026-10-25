// Long-term view of an account: multi-year growth against the S&P 500, risk-adjusted returns
// (Sharpe, Sortino, max drawdown), and how diversified the holdings are (largest position,
// concentration index, effective number of independent bets from return correlations).
import express from 'express';
import { all } from './db.js';
import { requireUser } from './auth.js';
import { accountSummary, getBars, ACCOUNT_IDS } from './brokers.js';
import { stressTest } from './research.js';

const yearsAgo = n => new Date(Date.now() - n * 365 * 864e5).toISOString().slice(0, 10);
export function riskStats(values) {
  const r = values.slice(1).map((v, i) => v / values[i] - 1).filter(Number.isFinite);
  if (r.length < 2) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  const down = Math.sqrt(r.filter(x => x < 0).reduce((a, b) => a + b * b, 0) / r.length);
  let peak = values[0], dd = 0; for (const v of values) { peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak); }
  const years = r.length / 252, total = values.at(-1) / values[0] - 1;
  return { totalReturn: +(total * 100).toFixed(2), cagr: years >= 0.5 ? +(((1 + total) ** (1 / years) - 1) * 100).toFixed(2) : null, volatility: +(sd * Math.sqrt(252) * 100).toFixed(2),
    sharpe: sd ? +(((m - 0.04 / 252) / sd) * Math.sqrt(252)).toFixed(2) : null, sortino: down ? +(((m - 0.04 / 252) / down) * Math.sqrt(252)).toFixed(2) : null, maxDrawdown: +(dd * 100).toFixed(2), days: r.length };
}
export function diversification(positions, returnsBySymbol) {
  const tot = positions.reduce((a, p) => a + Math.abs(p.value), 0) || 1, w = positions.map(p => Math.abs(p.value) / tot);
  const hhi = w.reduce((a, x) => a + x * x, 0);
  // Effective number of bets: 1 / (w' C w) with C the correlation matrix (1 when everything moves together).
  let eff = null;
  const syms = positions.map(p => p.symbol), rs = syms.map(s => returnsBySymbol[s]);
  if (rs.length > 1 && rs.every(Boolean)) {
    const n = Math.min(...rs.map(x => x.length)), z = rs.map(x => { const a = x.slice(-n), m = a.reduce((p, q) => p + q, 0) / n, sd = Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / n) || 1; return a.map(v => (v - m) / sd); });
    let q = 0; for (let i = 0; i < z.length; i++) for (let j = 0; j < z.length; j++) q += w[i] * w[j] * z[i].reduce((a, v, k) => a + v * z[j][k], 0) / n;
    eff = q > 0 ? +(1 / q).toFixed(2) : null;
  }
  const crypto = positions.filter(p => p.symbol.includes('/')).reduce((a, p) => a + Math.abs(p.value), 0) / tot;
  return { positions: positions.length, largestPct: positions.length ? +(Math.max(...w) * 100).toFixed(1) : 0, hhi: +hhi.toFixed(3), effectiveBets: eff, cryptoPct: +(crypto * 100).toFixed(1),
    verdict: !positions.length ? 'No holdings yet' : Math.max(...w) > 0.4 ? 'Concentrated: one holding is over 40% of the account' : eff != null && eff < 3 ? 'Holdings tend to move together' : 'Reasonably spread out' };
}

export const longtermRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper';
    const hist = await all('SELECT day, equity FROM equity_history WHERE user_id = ? AND account = ? ORDER BY day', req.user.id, account);
    const s = await accountSummary(req.user.id, account).catch(() => ({ positions: [], equity: null }));
    const spy = await getBars('SPY', hist[0]?.day && hist[0].day < yearsAgo(2) ? hist[0].day : yearsAgo(2), req.user.id);
    const spyBy = new Map(spy.dates.map((d, i) => [d, spy.closes[i]]));
    const aligned = hist.filter(h => spyBy.has(h.day));
    const rets = {};
    for (const p of s.positions.slice(0, 25)) { try { const b = await getBars(p.symbol, yearsAgo(2), req.user.id); rets[p.symbol] = b.closes.slice(1).map((x, i) => x / b.closes[i] - 1); } catch {} }
    // Rolling yearly returns: each calendar year's change in equity.
    const years = {}; for (const h of hist) { const y = h.day.slice(0, 4); (years[y] ||= { first: h.equity, last: h.equity }).last = h.equity; }
    res.json({
      account, since: hist[0]?.day || null, points: hist.length,
      curve: aligned.map(h => ({ day: h.day, equity: h.equity, spy: spyBy.get(h.day) })),
      you: riskStats(hist.map(h => h.equity)), sp500: riskStats(aligned.length > 2 ? aligned.map(h => spyBy.get(h.day)) : spy.closes.slice(-252 * 5)),
      byYear: Object.entries(years).map(([y, v]) => ({ year: y, returnPct: +((v.last / v.first - 1) * 100).toFixed(2) })),
      diversification: diversification(s.positions, rets),
    });
  });
  r.get('/stress', async (req, res) => res.json(await stressTest(req.user.id, ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper')));
  return r;
})();
