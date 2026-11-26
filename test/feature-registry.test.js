// The feature registry (docs/FEATURE_REGISTRY.md) stays the one current list of what Brightolio has:
// every page and route is listed, every row is well formed, and the summary matches the rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../scripts/registry.mjs';

const md = fs.readFileSync(R.FILE, 'utf8');
const rows = R.parseRegistry(md);

test('registry: every route and page file of the app is listed under "Every page"', () => {
  const listed = R.listedPages(md);
  const routes = [...R.appRoutes()].filter(r => !listed.routes.has(r));
  assert.deepEqual(routes, [], `add these routes to "Every page" in docs/FEATURE_REGISTRY.md (and their feature rows): ${routes.map(r => '#/' + r).join(', ')}`);
  const files = R.pageFiles().filter(f => !listed.files.has(f));
  assert.deepEqual(files, [], `add these page files to "Every page" in docs/FEATURE_REGISTRY.md: ${files.join(', ')}`);
  // A listed route that no longer exists is a stale row.
  const gone = [...listed.routes].filter(r => !R.appRoutes().has(r));
  assert.deepEqual(gone, [], `routes listed in the registry that the app no longer has: ${gone.join(', ')}`);
});

test('registry: every row has a known status, product, tier, flag and a value/effort score', () => {
  assert.ok(rows.length >= 250, `the registry covers the master plan's 19 sections (${rows.length} rows)`);
  assert.equal(new Set(rows.map(r => r.section)).size, 19);
  const ids = rows.map(r => r.id);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'row IDs are unique');
  for (const r of rows) {
    assert.ok(R.STATES.includes(r.status), `${r.id}: status ${r.status}`);
    assert.ok(R.PRODUCTS.includes(r.product), `${r.id}: product ${r.product}`);
    assert.ok(R.TIERS.includes(r.tier), `${r.id}: tier ${r.tier}`);
    assert.ok(R.FLAGS.includes(r.flag), `${r.id}: flag ${r.flag}`);
    assert.ok(r.value >= 1 && r.value <= 5 && r.effort >= 1 && r.effort <= 5, `${r.id}: V/E`);
    if (r.status !== 'missing') assert.notEqual(r.where, '—', `${r.id}: a feature that exists says where it lives`);
  }
  // Every row that a page refers to exists.
  const refs = [...md.slice(md.indexOf('\n## Every page')).matchAll(/\b([A-Z]{1,3}-\d{2})\b/g)].map(m => m[1]);
  assert.deepEqual([...new Set(refs.filter(x => !ids.includes(x)))], [], 'pages point at existing rows');
});

test('registry: legal rows are named in LEGAL_REVIEW.md, and the summary is current', () => {
  const legal = fs.readFileSync(new URL('../LEGAL_REVIEW.md', import.meta.url), 'utf8');
  for (const r of rows.filter(x => x.flag === 'legal')) assert.ok(legal.includes(r.id), `${r.id} (${r.feature}) is flagged legal: list it in LEGAL_REVIEW.md`);
  assert.equal(R.rebuild(md), md, 'the summary is out of date: run node scripts/registry.mjs');
});

test('registry: the gaps list leaves out rows that wait for a sign-off or a license', () => {
  const { gaps } = R.summary(rows);
  assert.equal(gaps.length, 20);
  assert.ok(gaps.every(g => g.status !== 'done' && g.flag !== 'legal' && g.flag !== 'licensed'));
});
