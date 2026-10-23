// Reality Check: is a strategy still behaving like its backtest?
//
// Backtests of tree strategies are easy to over-fit (the sheet's own QC pages show 922% and 576%
// five-year CAGRs next to -27% and -47% in the next three months). Every trading day we record the
// strategy's live model return, and test it against the backtest's daily return distribution:
//   z = (live mean - backtest mean) / (backtest sd / sqrt(days))
//   p = chance of results this weak or weaker if the backtest were the truth (one-sided)
// With Auto-throttle on, the money a strategy trades follows the verdict:
//   Healthy 100%  ·  Watch 50%  ·  Drifting 0% (sits in cash until it recovers)
import { all } from '../db.js';

export const MIN_DAYS = 20;
export const LEVELS = { healthy: 1, watch: 0.5, drifting: 0, learning: 1 };

// Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8).
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function assess(live, bt) {
  const n = live.length;
  const cum = live.reduce((a, r) => a * (1 + r), 1) - 1;
  let peak = 1, eq = 1, dd = 0;
  for (const r of live) { eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  const wins = live.filter(r => r > 0).length, losses = live.filter(r => r < 0).length;
  const base = { days: n, cumReturn: cum * 100, maxDrawdown: dd * 100, wins, losses, winRate: wins + losses ? wins / (wins + losses) * 100 : null };
  if (!bt?.sd) return { ...base, status: 'learning', why: 'Run a backtest so there is something to compare with.', multiplier: 1 };
  if (n < MIN_DAYS) return { ...base, status: 'learning', why: `Collecting live results: ${n} of ${MIN_DAYS} trading days.`, multiplier: 1 };
  const mean = live.reduce((a, b) => a + b, 0) / n;
  const z = (mean - bt.mean) / (bt.sd / Math.sqrt(n));
  const p = normCdf(z);
  const expected = ((1 + bt.mean) ** n - 1) * 100;
  // A live drawdown well past the backtest's worst also counts, whatever the average says.
  const ddBreach = bt.dd && dd * 100 > bt.dd * 1.25;
  const status = p < 0.05 || ddBreach ? 'drifting' : p < 0.2 ? 'watch' : 'healthy';
  const why = status === 'healthy' ? `Live results are in line with the backtest (${p >= 0.5 ? 'at or above' : 'a little below'} what it expected).`
    : ddBreach ? `The live drawdown (${(dd * 100).toFixed(1)}%) is deeper than anything in the backtest (${bt.dd.toFixed(1)}%).`
    : `If the backtest were right, results this weak would happen only ${(p * 100).toFixed(1)}% of the time.`;
  return { ...base, status, why, z: +z.toFixed(2), p: +p.toFixed(4), expectedReturn: expected, multiplier: LEVELS[status] };
}

export async function realityFor(s) {
  const rows = await all('SELECT day, ret FROM strategy_days WHERE strategy_id = ? ORDER BY day', s.id);
  const live = rows.map(r => r.ret);
  const a = assess(live, s.state.bt);
  return { ...a, throttle: !!s.state.throttle, series: rows.slice(-120).map(r => ({ day: r.day, ret: r.ret })) };
}

// Win-rate weighted split across a user's strategies, like the sheet's PORTFOLIO_SPLIT tab:
// weight ∝ live win rate, each strategy kept between 10% and 70%, total 100%.
export function winRateSplit(items, { min = 10, max = 70 } = {}) {
  if (!items.length) return [];
  const rates = items.map(i => (i.winRate == null ? 50 : i.winRate));
  let w = rates.map(r => Math.max(r, 1));
  const tot = w.reduce((a, b) => a + b, 0);
  w = w.map(x => (x / tot) * 100);
  if (items.length * min <= 100) {
    // Clamp and redistribute until every weight sits inside [min, max].
    for (let k = 0; k < 20; k++) {
      const fixed = w.map(x => (x < min ? min : x > max ? max : null));
      const rest = 100 - fixed.reduce((a, x) => a + (x ?? 0), 0);
      const freeTot = w.reduce((a, x, i) => a + (fixed[i] == null ? x : 0), 0);
      const nw = w.map((x, i) => fixed[i] ?? (freeTot ? (x / freeTot) * rest : rest / w.filter((_, j) => fixed[j] == null).length));
      if (nw.every((x, i) => Math.abs(x - w[i]) < 1e-9)) break;
      w = nw;
    }
  }
  return items.map((it, i) => ({ id: it.id, name: it.name, winRate: it.winRate, allocation: +w[i].toFixed(1) }));
}
