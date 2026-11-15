// Admin → SEO: the open questions from the audit. Answers are stored, choices are checked, nothing is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import { serve } from './client.js';

const Q = await import('../src/questions.js');
const S = await serve();
after(() => S.close());

test('every audit question is listed, open by default', () => {
  const list = Q.questionList();
  assert.deepEqual(list.map(q => q.id), ['regulatory', 'alpaca_referral', 'src_922', 'src_sp500', 'bug002', 'bug003', 'bug004', 'bug005']);
  assert.ok(list.every(q => q.status === 'open' || q.updatedAt));
});

test('saving keeps the answer and status; a choice must be one of the options', async () => {
  const a = await Q.saveQuestion('alpaca_referral', { status: 'answered', answer: 'Checked with the owner', choice: 'No arrangement' });
  assert.equal(a.status, 'answered'); assert.equal(a.choice, 'No arrangement'); assert.equal(a.answer, 'Checked with the owner');
  const b = await Q.saveQuestion('alpaca_referral', { status: 'answered', choice: 'Made up' });
  assert.equal(b.choice, '');
  const c = await Q.saveQuestion('regulatory', { status: 'bogus', answer: 'x'.repeat(1500) });
  assert.equal(c.status, 'open'); assert.equal(c.answer.length, 1000);
  assert.equal(await Q.saveQuestion('nope', {}), null);
});

test('admin routes exist and refuse non-admins', async () => {
  const u = S.client(); // signed out: never an admin

  assert.ok([401, 403].includes((await u('/admin/questions')).status));
  assert.ok([401, 403].includes((await u('/admin/questions/regulatory', { status: 'answered' }, 'PUT')).status));
});

test('BUG-002 fix: account data is not kept in localStorage', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /localStorage\.setItem\(KEEP_KEY/);
});
