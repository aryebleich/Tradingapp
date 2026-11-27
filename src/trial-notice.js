// Honest trial-end notices (queue row REV-03, docs/research/growth-plan.md "the trust layer"):
//   - in the app, 3 days and 1 day before a free trial ends: the date, the price that will be charged,
//     and a one-tap "Manage or cancel" that opens the billing portal. A plain date, never a countdown.
//   - by email at the same two moments, only if the member ticked "Email me before my trial ends"
//     (off by default), once per moment.
// The trial end comes from Stripe (users.plan_renews while plan_status is 'trialing').
import { all, run } from './db.js';
import { PLANS } from './fees.js';
import { getSetting, setSetting } from './settings.js';

const DAY = 864e5;
const dateOf = t => new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

// The notice for this member right now, or null. stage: '3day' (2 or 3 days left) or '1day' (1 day or less).
export function trialNotice(u, t = Date.now()) {
  if (!u || u.plan_status !== 'trialing' || !u.plan_renews || !PLANS[u.plan]) return null;
  const fmt = (n, c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(n);
  const left = u.plan_renews - t;
  if (left <= 0 || left > 3 * DAY) return null;
  const p = PLANS[u.plan], yearly = u.plan_interval === 'year', price = yearly ? p.yearly : p.monthly;
  const stage = left <= DAY ? '1day' : '3day';
  return {
    stage, endsAt: u.plan_renews, plan: p.name, price, interval: yearly ? 'year' : 'month',
    text: `Your free ${p.name} trial ends on ${dateOf(u.plan_renews)}. After that, ${price > 0 ? `${fmt(price, p.currency)} a ${yearly ? 'year' : 'month'}` : 'the plan price'} is charged unless you cancel. You can cancel in one step, and nothing is charged before that date.`,
  };
}

// The reminder emails (a daily job): only members who opted in, once per trial and stage.
export async function trialEmails(t = Date.now(), { send } = {}) {
  const sendEmail = send || (await import('./notify.js')).sendEmail;
  let sent = 0;
  for (const u of await all("SELECT id, email, plan, plan_status, plan_renews, plan_interval FROM users WHERE plan_status = 'trialing' AND plan_renews IS NOT NULL")) {
    const n = trialNotice(u, t);
    if (!n || !u.email || (await getSetting(u.id, 'trialEmails', false)) !== true) continue;
    const key = `trialEmail:${u.plan_renews}:${n.stage}`;
    if (await getSetting(u.id, key, false)) continue;
    await setSetting(u.id, key, true); // claimed first, so a second server never sends it twice
    const base = process.env.PUBLIC_URL || 'https://app.brightolio.com';
    await sendEmail(u.email, `Your Brightolio ${n.plan} trial ends ${n.stage === '1day' ? 'tomorrow' : 'soon'}`,
      `${n.text}\n\nKeep it: you don't need to do anything.\nCancel: ${base}/app#/funding (Manage billing → Cancel plan).\n\nYou get this email because you asked for trial reminders. Turn them off on Plans & billing.`).then(() => sent++, e => console.warn(JSON.stringify({ src: 'trial', event: 'email_failed', reason: e.message?.slice(0, 80) })));
  }
  return sent;
}
export const setTrialEmails = (userId, on) => setSetting(userId, 'trialEmails', on === true);
export const _cleanup = userId => run("DELETE FROM user_settings WHERE user_id = ? AND k LIKE 'trialEmail%'", userId);
