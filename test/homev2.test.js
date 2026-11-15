// Website audit, Phase 4: homepage v2 behind the "home_v2" flag (off by default).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './client.js';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, 'public', f), 'utf8');
const ids = h => [...h.matchAll(/<section(?: class="([\w ]+)")?(?: id="([\w-]+)")?/g)].map(m => m[2] || (m[1] || 'final').split(' ')[0]);
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const F = await import('../src/flags.js');
const S = await serve();
after(() => S.close());

test('flags: off by default, stable buckets, rollout percentage respected', async () => {
  assert.deepEqual(Object.keys(F.FLAGS), ['home_v2']);
  assert.equal(F.flagSettings().home_v2.on, false);
  assert.equal(F.isOn('home_v2', 'abc'), false);
  assert.equal(F.bucketOf('abc', 'home_v2'), F.bucketOf('abc', 'home_v2'));
  await F.saveFlags({ home_v2: { on: true, pct: 30 } });
  const on = Array.from({ length: 2000 }, (_, i) => F.isOn('home_v2', 'v' + i)).filter(Boolean).length;
  assert.ok(on > 450 && on < 750, `about 30% in rollout, got ${on}`);
  await F.saveFlags({ home_v2: { on: false, pct: 0 } });
});

for (const [a, b] of [['index.html', 'index-v2.html'], ['yi.html', 'yi-v2.html']]) {
  test(`${b}: same sections plus Trust & compliance, every disclosure kept`, () => {
    const v1 = read(a).replace(/<div class="cta">[\s\S]*?<\/div>/, ""), v2 = read(b); // the hero buttons are the one intended change
    assert.deepEqual([...ids(v1), 'compliance'].sort(), ids(v2).sort());
    assert.ok(ids(v2).indexOf('pricing') < ids(v2).indexOf('trust'));
    // Every sentence of v1 still appears in v2 (nothing removed, risk text included).
    const t2 = text(v2);
    const blocks = h => h.replace(/<script[\s\S]*?<\/script>/g, '').split(/<\/?(?:p|h\d|li|div|section|td|th|summary|span|a|b|label)\b[^>]*>/).map(text);
    const missing = blocks(v1).flatMap(c => c.split(/(?<=[.!?])\s/)).map(s => s.trim()).filter(s => s.length > 25 && !t2.includes(s));
    assert.deepEqual(missing.filter(s => !/Start free with email|Sign up with (Google|GitHub)/.test(s)), []);
    assert.equal((v2.match(/href="risk" data-cta="risk_link"/g) || []).length, 3, 'risk link beside hero, pricing and final sign-ups');
    for (const h of ['risk', 'terms', 'privacy', 'security', 'insurance']) assert.ok(v2.includes(`<li><a href="${h}">`));
  });
  test(`${b}: accessibility basics`, () => {
    const v2 = read(b);
    assert.equal((v2.match(/<h1[\s>]/g) || []).length, 1);
    assert.ok(/<html[^>]+lang="(en|yi)"/.test(v2));
    for (const img of v2.match(/<img\b[^>]*>/g) || []) assert.ok(/\balt="/.test(img), img.slice(0, 80));
    for (const m of v2.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.ok(text(m[1]).trim() || /aria-label=|data-phone-link/.test(m[0]), m[0].slice(0, 80));
    assert.equal(new Set(v2.match(/\bid="[^"]+"/g)).size, (v2.match(/\bid="[^"]+"/g) || []).length, 'ids are unique');
  });
}

test('server: flag off serves v1 with no cookie; on at 100% serves v2, private', async () => {
  let r = await fetch(S.base + '/');
  assert.ok(!(await r.text()).includes('id="compliance"'));
  assert.equal(r.headers.get('set-cookie'), null);
  await F.saveFlags({ home_v2: { on: true, pct: 100 } });
  r = await fetch(S.base + '/');
  assert.ok((await r.text()).includes('id="compliance"'));
  assert.match(r.headers.get('set-cookie') || '', /qp_vb=[a-f0-9]{16}; .*HttpOnly/);
  assert.match(r.headers.get('cache-control') || '', /private/);
  r = await fetch(S.base + '/yi', { headers: { cookie: 'qp_vb=0123456789abcdef' } });
  assert.ok((await r.text()).includes('id="compliance"'));
  await F.saveFlags({ home_v2: { on: false, pct: 0 } });
  r = await fetch(S.base + '/');
  assert.ok(!(await r.text()).includes('id="compliance"'), 'switching off rolls back at once');
});

test('admin flag endpoints are admin-only; CTA counter accepts names only', async () => {
  await S.client().signup('flags-owner@example.com'); // the first account on a fresh database is the owner
  const u = S.client(); await u.signup('flags-visitor@example.com');
  assert.ok([401, 403].includes((await u('/admin/site/flags')).status));
  assert.ok([401, 403].includes((await u('/admin/site/flags', { home_v2: { on: true } }, 'PUT')).status));
  assert.equal(F.flagSettings().home_v2.on, false);
  assert.equal((await u('/a/cta', { cta: 'hero_main' })).status, 204);
  assert.equal((await u('/a/cta', { cta: '<x>' })).status, 204);
});
