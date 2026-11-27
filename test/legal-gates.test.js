// Legal gates (src/legal-gates.js, LEGAL_REVIEW.md L-MP1 to L-MP4): every gate is off by default, the
// risky parts need both their gate and (where it applies) registered-adviser mode, and only an admin
// who passed the password step-up can turn one on, with an audit record.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serve } from './client.js';

const G = await import('../src/legal-gates.js');
const S = await import('../src/site.js');
const { run, one } = await import('../src/db.js');
let srv;
before(async () => { srv = await serve(); await S.siteSet('legalGates', {}); await S.siteSet('adviserMode', false); });
after(async () => { await S.siteSet('legalGates', {}); await S.siteSet('adviserMode', false); srv?.close(); });

test('legal gates: all off by default; an unknown gate is always off', () => {
  assert.deepEqual(G.legalGates().map(g => [g.id, g.on]), Object.keys(G.GATES).map(k => [k, false]));
  assert.equal(G.legalGate('nope'), false);
  assert.equal(G.realCopyAllowed(), false); assert.equal(G.performanceFeeAllowed(), false); assert.equal(G.brokerCommissionAllowed(), false);
});

test('legal gates: copies and the performance fee need adviser mode and the gate together', async () => {
  await S.siteSet('adviserMode', true);
  assert.equal(G.realCopyAllowed(), false, 'adviser mode alone is not enough');
  await S.siteSet('legalGates', { copyTrading: { on: true, at: Date.now() } });
  assert.equal(G.realCopyAllowed(), true);
  assert.equal(G.performanceFeeAllowed(), false, 'each gate is separate');
  await S.siteSet('adviserMode', false);
  assert.equal(G.realCopyAllowed(), false, 'the gate alone is not enough');
  await S.siteSet('legalGates', {});
});

test('legal gates: admin + step-up only, audited; members never reach the switch', async () => {
  const c = srv.client(); const a = await c.signup('gates-admin@example.com');
  await run("UPDATE users SET role = 'admin' WHERE id = ?", a.id);
  const member = srv.client(); await member.signup('gates-member@example.com');
  assert.equal((await member('/admin/security/legal-gates/copyTrading', { on: true }, 'PUT')).status, 403);
  const locked = await c('/admin/security/legal-gates/copyTrading', { on: true }, 'PUT');
  assert.equal(locked.status, 403); assert.equal(locked.body.adminUnlock, true);
  assert.equal((await c('/admin/server/unlock', { password: 'Str0ngPassword' })).status, 200);
  assert.equal((await c('/admin/security/legal-gates/nope', { on: true }, 'PUT')).status, 400);
  assert.equal((await c('/admin/security/legal-gates/paidIdeas', { on: 'yes' }, 'PUT')).status, 400);
  const on = await c('/admin/security/legal-gates/paidIdeas', { on: true }, 'PUT');
  assert.equal(on.status, 200); assert.equal(on.body.gate.on, true); assert.equal(G.legalGate('paidIdeas'), true);
  const view = (await c('/admin/security/legal-gates')).body;
  assert.equal(view.gates.find(g => g.id === 'paidIdeas').changedBy, 'gates-admin@example.com');
  assert.ok(view.log.some(l => JSON.parse(l.detail).gate === 'paidIdeas'));
  await c('/admin/security/legal-gates/paidIdeas', { on: false }, 'PUT');
  assert.equal(G.legalGate('paidIdeas'), false);
  assert.equal((await one("SELECT COUNT(*) n FROM audit_log WHERE event = 'legal_gate_changed' AND user_id = ?", a.id)).n, 2);
});

test('legal gates: every gate is a review item in LEGAL_REVIEW.md, and its rows are flagged legal in the registry', () => {
  const legal = fs.readFileSync(new URL('../LEGAL_REVIEW.md', import.meta.url), 'utf8');
  const reg = fs.readFileSync(new URL('../docs/FEATURE_REGISTRY.md', import.meta.url), 'utf8');
  for (const g of Object.values(G.GATES)) {
    assert.ok(legal.includes(`| ${g.review} |`), g.review);
    for (const id of g.rows) assert.match(reg, new RegExp(`^\\| ${id} \\|.*\\| legal \\|`, 'm'), `${id} is flagged legal`);
  }
});
