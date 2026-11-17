// Check 1 (fast CI): picks the tests to run for the files changed in a push.
// Usage: node scripts/ci-select.mjs <base-sha> [head-sha]
// Prints one line: "full" (run the whole suite) or the test files to run, separated by spaces.
// Always included: core, security, health. Changed order, money, auth or payment code adds the
// tests that cover it; any test that imports a changed module is added too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [base, head = 'HEAD'] = process.argv.slice(2);
const sh = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
let changed;
try { changed = base && !/^0+$/.test(base) ? sh('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean) : null; }
catch { changed = null; }
if (!changed) { console.log('full'); process.exit(0); } // first push or unknown base: everything

const FULL = /^(package(-lock)?\.json|server\.js|src\/db\.js)$/;
if (changed.some(f => FULL.test(f))) { console.log('full'); process.exit(0); }

const tests = new Set(['test/core.test.js', 'test/security.test.js', 'test/health.test.js']);
const SENSITIVE = /^src\/(brokers|execution|orderqueue|money|auth|risk|stripe-[\w-]+)\.js$/;
const all = fs.readdirSync('test').filter(f => f.endsWith('.test.js')).map(f => 'test/' + f);
const src = Object.fromEntries(all.map(f => [f, fs.readFileSync(f, 'utf8')]));
const covering = rel => {
  const base = path.basename(rel).replace(/\.(m?js)$/, '');
  return all.filter(t => src[t].includes(`${base}.js`) || src[t].includes(`/${base}'`));
};
for (const f of changed) {
  if (f.startsWith('test/') && f.endsWith('.test.js') && fs.existsSync(f)) tests.add(f);
  if (!/\.(m?js)$/.test(f) || !fs.existsSync(f)) continue;
  if (f.startsWith('src/') || f.startsWith('public/')) covering(f).forEach(t => tests.add(t));
  // Order, money, auth and payment code: every test that touches orders or payments as well.
  if (SENSITIVE.test(f)) all.filter(t => /placeOrder|\/orders|stripe|auth\/register/.test(src[t]) && /brokers|risk|stripe|orders/.test(src[t])).slice(0, 40).forEach(t => tests.add(t));
}
console.log([...tests].filter(t => fs.existsSync(t)).join(' '));
