// Pricing: the plan comparison in the app (/config compare, src/fees.js COMPARE) is the same table as
// the homepage's (scripts/home.py MATRIX), and no plan is called "most popular" without data behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMPARE, PLANS } from '../src/fees.js';

test('the app and the homepage compare the plans with the same rows', () => {
  const py = fs.readFileSync('scripts/home.py', 'utf8');
  const block = py.slice(py.indexOf('MATRIX = ['), py.indexOf('\n]\n', py.indexOf('MATRIX = [')));
  const rows = [...block.matchAll(/^ \((.+)\),?$/gm)].map(m => JSON.parse('[' + m[1].replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false') + ']').map(v => (typeof v === 'string' ? v.replace(/&amp;/g, '&') : v)));
  assert.equal(rows.length, COMPARE.length);
  assert.deepEqual(rows, COMPARE);
  for (const r of COMPARE) assert.equal(r.length, 1 + Object.keys(PLANS).length, r[0]);
});

test('plans are labelled "Recommended", never "Most popular"', () => {
  for (const f of ['public/app.js', 'scripts/home.py', 'public/index.html', 'public/yi.html']) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Most popular/, f);
});
