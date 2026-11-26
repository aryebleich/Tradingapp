// One price ladder everywhere (DECISIONS.md MP-3): the plans in src/fees.js, the table in the revenue
// strategy (docs/research/growth-plan.md "Revenue"), the homepage, the "Unlock with ..." labels and the
// monthly credits all name the same plans and prices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLANS, INSTITUTIONAL } from '../src/fees.js';
import { requiredPlan } from '../public/paid-controls.js';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const money = n => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2));

test('ladder: the revenue strategy lists each plan at the price in src/fees.js', () => {
  const doc = read('docs/research/growth-plan.md');
  const row = name => doc.split('\n').find(l => l.startsWith(`| ${name} |`));
  for (const [key, p] of Object.entries(PLANS)) {
    const r = row(key === 'free' ? 'Free' : p.name);
    assert.ok(r, `growth-plan.md lists ${p.name}`);
    assert.ok(r.includes(money(p.monthly)) && r.includes(money(p.yearly)), `${p.name}: ${r}`);
  }
  assert.ok(row('Institutional').includes(money(INSTITUTIONAL.from)));
});

test('ladder: the homepage shows each paid plan at its price, and yearly stays about two months free', () => {
  const home = read('public/index.html');
  for (const p of Object.values(PLANS).filter(x => x.monthly)) {
    assert.ok(home.includes(money(p.monthly)) && home.includes(money(p.yearly)), `homepage price for ${p.name}`);
    const months = p.yearly / p.monthly; assert.ok(months >= 9.5 && months <= 10.5, `${p.name}: yearly is ${months.toFixed(1)} months`);
  }
  const order = Object.values(PLANS).map(p => p.monthly);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'each plan costs more than the one before');
});

test('ladder: "Unlock with" labels and monthly credits use the plans that exist', async () => {
  const names = new Set(Object.values(PLANS).map(p => p.name));
  for (const [feature, plan] of Object.entries(requiredPlan)) assert.ok(names.has(plan), `${feature}: "${plan}" is a plan`);
  const { config } = await import('../src/credits.js');
  assert.deepEqual(Object.keys(config().monthly).sort(), Object.keys(PLANS).sort());
});
