// Honest trial-end notices (src/trial-notice.js, queue row REV-03): shown 3 days and 1 day before the end
// with the date and the price, never as a countdown; email only for members who opted in, once per stage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';

const T = await import('../src/trial-notice.js');
const { run } = await import('../src/db.js');
const { PLANS } = await import('../src/fees.js');
const DAY = 864e5, NOW = Date.UTC(2026, 10, 27, 15);
let srv;
before(async () => { srv = await serve(); await (await import('./prices-fixture.js')).seedPrices(); });
after(() => srv?.close());
const trial = (o = {}) => ({ id: 1, plan: 'pro', plan_status: 'trialing', plan_renews: NOW + 3 * DAY, plan_interval: 'month', ...o });

test('trial notice: timing — nothing before 3 days, the 3-day notice, the 1-day notice, nothing after it ends', () => {
  assert.equal(T.trialNotice(trial({ plan_renews: NOW + 3 * DAY + 60e3 }), NOW), null);
  assert.equal(T.trialNotice(trial({ plan_renews: NOW + 3 * DAY }), NOW).stage, '3day');
  assert.equal(T.trialNotice(trial({ plan_renews: NOW + 2 * DAY }), NOW).stage, '3day');
  assert.equal(T.trialNotice(trial({ plan_renews: NOW + DAY }), NOW).stage, '1day');
  assert.equal(T.trialNotice(trial({ plan_renews: NOW - 1 }), NOW), null);
  assert.equal(T.trialNotice(trial({ plan_status: 'active' }), NOW), null, 'only during a trial');
});

test('trial notice: the copy names the plan, the date and the real price, and promises nothing hidden', () => {
  const m = T.trialNotice(trial(), NOW), y = T.trialNotice(trial({ plan: 'elite', plan_interval: 'year' }), NOW);
  const usd = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n).replace('$', '\\$');
  assert.match(m.text, new RegExp(`free Pro trial ends on \\w+day, November 30\\..*${usd(PLANS.pro.monthly)} a month`));
  assert.match(y.text, new RegExp(`${usd(PLANS.elite.yearly)} a year`));
  assert.match(m.text, /cancel in one step/);
  assert.doesNotMatch(m.text, /hurry|only \d+ left|last chance|\d+:\d+|hours left/i, 'no countdown or pressure');
});

test('trial emails: only with the opt-in, once per stage, and the opt-out stops them', async () => {
  const c = srv.client(); const u = await c.signup('trial-mail@example.com');
  await run("UPDATE users SET plan = 'pro', plan_status = 'trialing', plan_renews = ?, plan_interval = 'month' WHERE id = ?", NOW + 2 * DAY, u.id);
  const sent = []; const send = async (to, subject, body) => sent.push({ to, subject, body });
  assert.equal(await T.trialEmails(NOW, { send }), 0, 'off by default');
  assert.equal((await c('/billing/trial-emails', { on: true }, 'PUT')).status, 200);
  assert.equal(await T.trialEmails(NOW, { send }), 1);
  assert.equal(sent[0].to, 'trial-mail@example.com'); assert.match(sent[0].body, /Cancel: .*#\/funding/); assert.match(sent[0].body, /Turn them off on Plans & billing/);
  assert.equal(await T.trialEmails(NOW + 60e3, { send }), 0, 'once per stage');
  assert.equal(await T.trialEmails(NOW + 1.5 * DAY, { send }), 1, 'the 1-day reminder');
  await c('/billing/trial-emails', { on: false }, 'PUT'); await T._cleanup(u.id);
  assert.equal(await T.trialEmails(NOW + 1.5 * DAY, { send }), 0, 'the opt-out stops them');
  const me = (await c('/auth/me')).body.user;
  assert.equal(me.trialEmails, false);
  await run("UPDATE users SET plan = 'free', plan_status = NULL, plan_renews = NULL WHERE id = ?", u.id);
});
