// The performance targets (PERFORMANCE.md), checked on a load-test result and a Lighthouse result:
//   - p95 under 300 ms for cached routes (static files, the app shell, and the API answers served from
//     the shared caches), under 800 ms for every other route
//   - no shed answers and no 5xx
//   - Lighthouse mobile performance 90 or more on every page measured
//   node scripts/perf-targets.mjs loadtest.json [lighthouse.json]
import fs from 'node:fs';

// API routes answered from a cache shared by everyone (precomputed or stale-while-revalidate).
export const CACHED = [/^\/api\/(market\/overview|alpaca\/data\/(movers|most-actives|news)|news|scanners(\/meta)?|stock\/[^/]+\/card|config|public\/|insights|plain-research\/screen|dividends\/)/];
export const isCached = r => r.kind !== 'api' || CACHED.some(re => re.test(r.route));
export function check(load, lh) {
  const fails = [];
  for (const r of load.routes || []) {
    if (r.n < 5) continue; // too few answers to judge
    const lim = isCached(r) ? 300 : 800;
    if (r.p95 > lim) fails.push(`${r.route}: p95 ${r.p95} ms (target ${lim} ms${isCached(r) ? ', cached' : ''})`);
  }
  if (load.shed) fails.push(`${load.shed} shed answers (target 0)`);
  const fives = Object.entries(load.codes || {}).filter(([c]) => +c >= 500).reduce((a, [, n]) => a + n, 0);
  if (fives) fails.push(`${fives} answers 5xx (target 0)`);
  for (const [page, s] of Object.entries(lh?.scores || {})) if (page.startsWith('mobile') && s.performance < 90) fails.push(`Lighthouse ${page}: performance ${s.performance} (target 90)`);
  return fails;
}
if (process.argv[1]?.endsWith('perf-targets.mjs')) {
  const load = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const lh = process.argv[3] && fs.existsSync(process.argv[3]) ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
  const fails = check(load, lh);
  console.log(fails.length ? `Targets missed (${fails.length}):\n- ${fails.join('\n- ')}` : 'Every target met.');
  process.exit(fails.length ? 1 : 0);
}
