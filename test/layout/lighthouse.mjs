// Lighthouse gate: scores of the current site (mobile emulation, Lighthouse defaults, median of RUNS runs per
// page) against test/golden/lighthouse-baseline.json, the scores before the redesign. A drop of more than
// 3 points in performance, or any drop in the other categories, fails. Lighthouse is not a
// dependency of the app: point LIGHTHOUSE at an installed CLI (npx lighthouse@12 works too).
//   LIGHTHOUSE=/path/to/lighthouse node test/layout/lighthouse.mjs --base http://localhost:3172 --cookie "qp_s=..." [--runs 3] [--out DIR]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const B = arg('--base'), RUNS = +arg('--runs', 3);
// A signed-in test account for the app pages (sandbox data only).
let SESSION = arg('--cookie', '');
if (!SESSION) {
  const r = await fetch(B + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ email: `lh-${Date.now()}@example.com`, password: 'Str0ngPassword1', agree: true }) });
  SESSION = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).filter(c => !c.startsWith('qp_vb=')).join('; ');
  if (!SESSION) throw new Error('could not create the Lighthouse test account: ' + r.status);
}
const OUT = path.resolve(arg('--out', 'e2e-output/layout'));
const LH = process.env.LIGHTHOUSE || 'lighthouse';
const GOLD = JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../golden/lighthouse-baseline.json'), 'utf8')).scores;
const PAGES = [['home', '/'], ['risk', '/risk'], ['terms', '/terms'], ['login', '/app#/login'], ['dashboard', '/app#/dashboard', true], ['trade', '/app#/trade', true]];
const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];
const median = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

const out = {};
for (const [name, url, auth] of PAGES) {
  const cookie = auth ? SESSION : '';
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const json = execFileSync(LH, [B + url, '--quiet', '--output=json', '--output-path=stdout', `--only-categories=${CATS.join(',')}`,
      ...(cookie ? [`--extra-headers=${JSON.stringify({ Cookie: cookie })}`] : []), '--chrome-flags=--headless=new --no-sandbox', '--max-wait-for-load=30000'],
      { maxBuffer: 64 << 20, env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' } }).toString();
    const r = JSON.parse(json);
    runs.push(Object.fromEntries(CATS.map(c => [c, Math.round((r.categories[c]?.score ?? 0) * 100)])));
  }
  out[name] = Object.fromEntries(CATS.map(c => [c, median(runs.map(r => r[c]))]));
  process.stdout.write(`${name} ${JSON.stringify(out[name])}\n`);
}
const drops = [];
for (const [name, v] of Object.entries(out)) for (const c of CATS) {
  const tol = c === 'performance' ? 3 : 0;
  if (v[c] < GOLD[name][c] - tol) drops.push(`${name} ${c}: ${GOLD[name][c]} → ${v[c]}`);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'lighthouse.json'), JSON.stringify({ at: new Date().toISOString(), base: B, runs: RUNS, scores: out, drops }, null, 1));
console.log(drops.length ? `DROPS: ${drops.join('; ')}` : 'Lighthouse: no score dropped');
process.exit(drops.length ? 1 : 0);
