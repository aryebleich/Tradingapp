// Website audit (docs/archive/BUG_REPORT.md): one test per bug, written before the fix. The review-required bugs
// are "todo" tests: they show the bug and do not fail the suite until a person decides the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));

test('BUG-001: links built from outside data only open http(s) addresses', () => {
  const bad = [];
  for (const f of [...walk('public/pages'), 'public/app.js']) {
    read(f).split('\n').forEach((l, i) => { for (const m of l.matchAll(/href="\$\{(?:H\.)?esc\(([^)]*\.url)\)\}"/g)) bad.push(`${f}:${i + 1} ${m[1]}`); });
  }
  assert.deepEqual(bad, [], 'wrap each outside URL in safeUrl()');
  const { safeUrl } = { safeUrl: u => (/^https?:\/\//i.test(u || '') ? u : '#') };
  assert.equal(safeUrl('javascript:alert(1)'), '#');
});

test('BUG-006: the daily visitor hash uses a server secret (cannot be rebuilt from an IP)', async () => {
  const A = await import('../src/analytics.js');
  const d = new Date().toISOString().slice(0, 10), id = '203.0.113.7|Mozilla';
  const plain = crypto.createHash('sha256').update(`${d}|web|${id}`).digest('hex').slice(0, 20);
  assert.equal(typeof A.visitorHash, 'function');
  assert.notEqual(A.visitorHash(d, 'web', id), plain);
  assert.equal(A.visitorHash(d, 'web', id), A.visitorHash(d, 'web', id));
});

test('BUG-007: theme to watchlist marks tickers it could not check', async () => {
  for (const k of ['ALPACA_KEY_ID', 'ALPACA_SECRET', 'BROKER_API_KEY', 'BROKER_API_SECRET']) delete process.env[k];
  const { theme } = await import('../src/aitools.js');
  const r = await theme({ id: 1, role: 'user' }, 'cybersecurity');
  assert.ok(r.companies.length && r.companies.every(c => c.checked === false));
});

test('BUG-008: the hidden hero still image is not fetched with high priority', () => {
  const html = read('public/index.html');
  const fig = /<figure class="shot" data-live>[\s\S]*?<\/figure>/.exec(html)[0];
  assert.doesNotMatch(fig, /fetchpriority="high"/);
});

test('BUG-009: config.js does not block rendering', () => {
  for (const f of ['public/index.html', 'public/yi.html']) assert.match(read(f), /<script defer src="config.js"><\/script>/);
});

test('BUG-011: logo lookups are rate-limited per address', async () => {
  const { logoRoute } = await import('../src/logos.js');
  const express = (await import('express')).default, app = express();
  logoRoute(app);
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  let limited = false;
  for (let i = 0; i < 260 && !limited; i++) { const t = 'Z' + i.toString(36).toUpperCase().padStart(3, 'A'); if ((await fetch(`${base}/logo/${t}`)).status === 429) limited = true; }
  srv.close();
  assert.ok(limited, 'many different tickers from one address are refused after a while');
});

test('BUG-012: the live homepage dashboard has a pause button', () => {
  const js = read('public/site.js');
  assert.match(js, /ld-pause/); assert.match(js, /aria-pressed/);
});

test('BUG-013: superseded, the homepage ad video was removed (no video means no captions to miss)', () => {
  for (const f of ['public/index.html', 'public/yi.html', 'scripts/home.py']) assert.doesNotMatch(read(f), /data-adreel|class="adbox"|<video/);
  // The media files stay for the admin page and other uses.
  const vtt = read('public/media/brightolio-ad.en.vtt');
  assert.match(vtt, /^WEBVTT/);
});

test('BUG-014: Organization and FAQPage structured data on the homepage', () => {
  const html = read('public/index.html');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const org = blocks.find(b => b['@type'] === 'Organization'), faq = blocks.find(b => b['@type'] === 'FAQPage');
  assert.ok(org && org.name === 'Brightolio' && /^https:\/\//.test(org.url));
  assert.ok(faq && faq.mainEntity.length >= 5 && faq.mainEntity.every(q => q.name && q.acceptedAnswer?.text));
});

// ---------- review required: documented, not fixed ----------
test('BUG-002: account data is kept only for this browser session (sessionStorage), not 24 h on the device', () => {
  const src = read('public/app.js');
  assert.doesNotMatch(src, /localStorage\.(set|get)Item\(KEEP_KEY/);
  assert.match(src, /sessionStorage\.setItem\(KEEP_KEY/);
});
test('BUG-003 (review required): practice margin room is worked out outside the fill transaction', { todo: 'Review: margin logic' }, () => {
  assert.doesNotMatch(read('src/brokers.js'), /const marginRoom = margin \? await accountSummary/);
});
test('BUG-004 (review required): early P/L refresh charges credits before the analysis succeeds', { todo: 'Review: billing' }, () => {
  const s = read('src/pnlwhy.js');
  assert.ok(s.indexOf("CR.spend(user, 'pnlwhy'") > s.indexOf('const data = await analyze(user, account);'));
});
test('BUG-005 (review required): options orders use a plain browser confirm', { todo: 'Review: order entry' }, () => {
  assert.doesNotMatch(read('public/pages/optionsdesk.js'), /if \(!confirm\(`\$\{side === 'buy'/);
});
