// Lighthouse scores of the live server (PERFORMANCE.md): the sign-in page, the dashboard, the scanner
// and a stock page, on mobile (Lighthouse's slow-4G phone) and desktop, median of RUNS runs.
// The signed-in pages use the paper-only load-test account (POST /internal/loadtest-session with the
// server's CRON_SECRET). Read-only.
// Env: BASE, LOADTEST_TOKEN, RUNS (default 3), LIGHTHOUSE (the CLI), CHROME_PATH, OUT.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''), TOKEN = process.env.LOADTEST_TOKEN || '', RUNS = +(process.env.RUNS || 3);
// LIGHTHOUSE may be a command with arguments ("npx --yes lighthouse@12"): the first word runs, the rest go first.
const [LH, ...LH_ARGS] = (process.env.LIGHTHOUSE || 'lighthouse').trim().split(/\s+/), OUT = process.env.OUT || 'lighthouse-live.json';
let cookie = '';
if (TOKEN) {
  const r = await fetch(BASE + '/internal/loadtest-session', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-qp-loadtest': TOKEN } });
  if (r.ok) cookie = (await r.json()).cookie;
}
const PAGES = [['sign-in', '/app#/login', false], ['dashboard', '/app#/dashboard', true], ['scanner', '/app#/scanner', true], ['stock page', '/app#/analyze?symbol=AAPL', true]];
const CATS = ['performance', 'accessibility', 'best-practices'];
const median = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = {};
for (const form of ['mobile', 'desktop']) for (const [name, url, auth] of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const headers = { ...(auth && cookie ? { Cookie: cookie } : {}), ...(TOKEN ? { 'x-qp-loadtest': TOKEN } : {}) };
    try {
      const json = execFileSync(LH, [...LH_ARGS, BASE + url, '--quiet', '--output=json', '--output-path=stdout', `--only-categories=${CATS.join(',')}`, ...(form === 'desktop' ? ['--preset=desktop'] : []),
        `--extra-headers=${JSON.stringify(headers)}`, '--chrome-flags=--headless=new --no-sandbox', '--max-wait-for-load=45000'], { maxBuffer: 64 << 20, env: process.env }).toString();
      const r = JSON.parse(json);
      runs.push({ ...Object.fromEntries(CATS.map(c => [c, Math.round((r.categories[c]?.score ?? 0) * 100)])), lcp: Math.round(r.audits['largest-contentful-paint']?.numericValue || 0), cls: +(r.audits['cumulative-layout-shift']?.numericValue || 0).toFixed(3), tbt: Math.round(r.audits['total-blocking-time']?.numericValue || 0) });
    } catch (e) { console.warn(`${form} ${name}: ${e.message.split('\n')[0]}`); }
  }
  if (!runs.length) continue;
  out[`${form} ${name}`] = Object.fromEntries(['performance', 'accessibility', 'best-practices', 'lcp', 'cls', 'tbt'].map(k => [k, median(runs.map(r => r[k]))]));
  console.log(`${form.padEnd(8)} ${name.padEnd(11)} ${JSON.stringify(out[`${form} ${name}`])}`);
}
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, runs: RUNS, scores: out }, null, 1));
