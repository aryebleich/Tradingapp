// Gate 6 (Lighthouse part): scores of the old and new layout on the same server, by visitor cookie.
// Median of RUNS runs per page and layout (mobile emulation, Lighthouse defaults). Lighthouse is not a
// dependency of the app: point LIGHTHOUSE at an installed CLI (npx lighthouse@12 works too).
//   LIGHTHOUSE=/path/to/lighthouse node test/layout/lighthouse.mjs --base http://localhost:3172 --cookie "qp_s=..." [--runs 3] [--out DIR]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bucketOf } from '../../src/flags.js';

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
const vid = want => { for (let i = 0; ; i++) { const v = i.toString(16).padStart(16, '0'); if ((bucketOf(v, 'layout_v2') < 50) === want) return v; } };
const PAGES = [['home', '/'], ['risk', '/risk'], ['terms', '/terms'], ['login', '/app#/login'], ['dashboard', '/app#/dashboard', true], ['trade', '/app#/trade', true]];
const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];
const median = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

const out = {};
for (const [name, url, auth] of PAGES) for (const [variant, want] of [['old', false], ['new', true]]) {
  const cookie = [`qp_vb=${vid(want)}`, auth && SESSION].filter(Boolean).join('; ');
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const json = execFileSync(LH, [B + url, '--quiet', '--output=json', '--output-path=stdout', `--only-categories=${CATS.join(',')}`,
      `--extra-headers=${JSON.stringify({ Cookie: cookie })}`, '--chrome-flags=--headless=new --no-sandbox', '--max-wait-for-load=30000'],
      { maxBuffer: 64 << 20, env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' } }).toString();
    const r = JSON.parse(json);
    runs.push(Object.fromEntries(CATS.map(c => [c, Math.round((r.categories[c]?.score ?? 0) * 100)])));
  }
  (out[name] ||= {})[variant] = Object.fromEntries(CATS.map(c => [c, median(runs.map(r => r[c]))]));
  process.stdout.write(`${name}/${variant} ${JSON.stringify(out[name][variant])}\n`);
}
const drops = [];
for (const [name, v] of Object.entries(out)) for (const c of CATS) {
  // Performance varies by a few points between identical runs; a drop of more than 3 points counts.
  const tol = c === 'performance' ? 3 : 0;
  if (v.new[c] < v.old[c] - tol) drops.push(`${name} ${c}: ${v.old[c]} → ${v.new[c]}`);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'lighthouse.json'), JSON.stringify({ at: new Date().toISOString(), base: B, runs: RUNS, scores: out, drops }, null, 1));
console.log(drops.length ? `DROPS: ${drops.join('; ')}` : 'Lighthouse: no score dropped');
process.exit(drops.length ? 1 : 0);
