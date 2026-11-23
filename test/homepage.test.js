// Homepage (the page as before the redesign; the audited-order version was not released) and the layout
// layer on every public page. There is no flag.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './client.js';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, 'public', f), 'utf8');
const ids = h => [...h.matchAll(/<section(?: class="([\w ]+)")?(?: id="([\w-]+)")?/g)].map(m => m[2] || (m[1] || 'final').split(' ')[0]);
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const S = await serve();
after(() => S.close());

for (const f of ['index.html', 'yi.html']) {
  test(`${f}: the legal links and risk text are on the page`, () => {
    const h = read(f), order = ids(h);
    assert.equal(order[0], 'hero'); assert.ok(!order.includes('compliance'), 'the unreleased audited-order version is not served');
    for (const p of ["risk", "terms", "privacy"]) assert.ok(h.includes(`href="${p}.html"`), p);
    if (f === 'index.html') for (const s of ['Illustrative paper-trading account', 'Trading involves risk', 'not a broker']) assert.ok(text(h).includes(s), s);
  });
  test(`${f}: accessibility basics`, () => {
    const h = read(f);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1);
    assert.ok(/<html[^>]+lang="(en|yi)"/.test(h));
    for (const img of h.match(/<img\b[^>]*>/g) || []) assert.ok(/\balt="/.test(img), img.slice(0, 80));
    for (const m of h.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.ok(text(m[1]).trim() || /aria-label=|data-phone-link/.test(m[0]), m[0].slice(0, 80));
    assert.equal(new Set(h.match(/\bid="[^"]+"/g)).size, (h.match(/\bid="[^"]+"/g) || []).length, 'ids are unique');
  });
}

test('every sentence of the old homepage is still on the new one (English and Yiddish)', () => {
  const gold = JSON.parse(fs.readFileSync(path.join(root, 'test/golden/homepage-v1-sentences.json'), 'utf8')).sentences;
  for (const f of ['index.html', 'yi.html']) {
    const cur = text(read(f)), missing = gold[f].filter(x => !cur.includes(x));
    assert.deepEqual(missing, [], `${f}: ${missing.length} sentence(s) of the old homepage are gone`);
    assert.ok(gold[f].length > 250, 'the golden list is not empty');
  }
});

test('every page carries the layout layer; the old homepage copies and the flag system are gone', async () => {
  for (const f of ['index.html', 'yi.html', 'terms.html', 'privacy.html', 'risk.html', 'contact.html', 'status.html', 'security.html', 'insurance.html', 'app.html', '404.html']) {
    const h = read(f);
    assert.match(h, /<html[^>]*class="lv2"/, f); assert.match(h, /layout\.css/, f); assert.match(h, /layout\.js/, f);
  }
  for (const gone of ['public/index-v2.html', 'public/yi-v2.html', 'src/flags.js', 'src/layout-rollout.js']) assert.equal(fs.existsSync(path.join(root, gone)), false, gone);
});

test('server: / and /yi serve the homepage, no cookie is set, and the layout files load', async () => {
  for (const u of ['/', '/yi']) {
    const r = await fetch(S.base + u); const h = await r.text();
    assert.ok(h.includes('class="hero"') && !h.includes('id="compliance"'), u); assert.equal(r.headers.get('set-cookie'), null, u);
    assert.ok(h.includes('layout.css') && h.includes('layout.js'), u);
  }
  const app = await (await fetch(S.base + '/app')).text();
  assert.match(app, /class="lv2"/); assert.match(app, /layout\.js\?v=/);
  // The style sheets: one minified bundle (styles, theme, layout) when the bundler runs, else the three files.
  const css = app.match(/href="(\/bundle\/app-[0-9a-f]{10}\.css)"/)?.[1];
  if (css) { const r = await fetch(S.base + css); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/css/); assert.match(await r.text(), /url\(\/fonts\/inter-latin\.woff2\)[\s\S]*body>footer:not\(\.site\)/); assert.doesNotMatch(app, /href="\/(styles|theme|layout)\.css/); }
  else assert.match(app, /layout\.css\?v=/);
  // A session cookie: the header and menu keep their place from the first paint (no layout shift).
  assert.doesNotMatch(app, /was-in/);
  assert.match(await (await fetch(S.base + '/app', { headers: { Cookie: 'qp_sid=anything' } })).text(), /<html lang="en" class="lv2 was-in">/);
  for (const f of ['/layout.css', '/layout.js']) assert.equal((await fetch(S.base + f)).status, 200, f);
});

test('the flag endpoints are gone', async () => {
  const o = S.client(); await o.signup('flags-owner@example.com'); // the first account on a fresh database is the owner
  assert.equal((await o('/admin/site/flags')).status, 404);
  assert.equal((await o('/admin/site/flags', { x: 1 }, 'PUT')).status, 404);
  assert.equal((await o('/a/cta', { cta: 'hero_main' })).status, 204);
});
