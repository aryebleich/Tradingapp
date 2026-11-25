// Whole calculations for the CPU pool (src/cpu.js): one trip to a worker thread instead of several.
import { backtest, projectAnnual, walkForward, optimize } from './engine.js';

// POST /api/backtest: the backtest, its curve thinned to about 400 points, the Monte Carlo projection
// and the walk-forward test (the slowest part of the page).
export function fullBacktest(closes, cfg, warm, dates) {
  const r = backtest(closes, cfg, warm, closes.length, dates);
  const step = Math.max(1, Math.floor(r.eq.length / 400));
  const idx = r.eq.map((_, i) => i).filter(i => i % step === 0 || i === r.eq.length - 1);
  return {
    m: r.m, holding: r.holding, trades: r.trades.slice(-100),
    curve: idx.map(i => ({ d: r.dates[i], eq: r.eq[i], bh: r.bh[i] })),
    projection: projectAnnual(r.eq), walkForward: walkForward(closes, cfg, warm, 4, dates),
  };
}
export const optimizeRun = (closes, cfg, warm, dates) => optimize(closes, cfg, warm, dates);

// POST /api/public/backtest (the landing page demo): the backtest, its projection and a 200-point curve.
export function demoBacktest(closes, cfg, warm, dates) {
  const r = backtest(closes, cfg, warm, closes.length, dates);
  const step = Math.max(1, Math.floor(r.eq.length / 200));
  return { m: r.m, projection: projectAnnual(r.eq), curve: r.eq.filter((_, i) => i % step === 0), bh: r.bh.filter((_, i) => i % step === 0) };
}
