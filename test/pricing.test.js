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

test('Free / Pro / Premium labels and the research & AI rows match the server checks', async () => {
  const { TIERS, GROWTH_COMPARE } = await import('../src/fees.js');
  assert.deepEqual(TIERS, { free: 'Free', pro: 'Pro', elite: 'Premium', ultimate: 'Premium' });
  for (const r of GROWTH_COMPARE) assert.equal(r.length, 1 + Object.keys(PLANS).length, r[0]);
  const row = name => GROWTH_COMPARE.find(r => r[0] === name).slice(1);
  assert.equal(row('Intraday rule bot')[1], false); assert.ok(row('Intraday rule bot')[2]); // Elite, not Pro (src/intraday.js)
  assert.match(row('Morning news screen')[0], /Read/); assert.match(row('Morning news screen')[1], /Practice account/); // Pro uses the practice account (src/newspicks.js)
  assert.ok(!GROWTH_COMPARE.flat().some(x => typeof x === 'string' && /real money/i.test(x))); // the new features trade the practice account only
  assert.equal(row('Diversification suggestions with previews')[0], '1'); // free gets one (src/diversify.js)
  assert.ok(!GROWTH_COMPARE.flat().some(x => typeof x === 'string' && /guarantee|risk-free/i.test(x)));
});
