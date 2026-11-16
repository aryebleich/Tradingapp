// Webhook safety for /webhooks/stripe. Stripe may deliver an event more than once, late, or out of
// order, so each event is claimed by its id before it is processed, state-changing events for one
// object are applied in order, and the handlers for the events the older code did not read live here.
//
//   claimEvent     'new' | 'retry' | 'duplicate'; a failed or abandoned event can be retried by Stripe
//   isStale        a late customer.subscription.* (or invoice.*) event never overwrites newer state
//   modeMismatch   a live event on a test key (or the reverse) is acknowledged and ignored
//   tagLivemode    marks ledger rows with the event's mode so test payments stay out of revenue reports
//   handleExtra    payment_intent.*, charge.refunded, charge.dispute.created, invoice.payment_failed,
//                  checkout.session.expired
//
// Reference: https://docs.stripe.com/webhooks (duplicate events, ordering, retries, signatures) and
// https://docs.stripe.com/api/events/types (event objects).
import { run, one, all, now } from './db.js';
import { declineMessage, keyMode, stripeGet, logStripe } from './stripe-client.js';

const STALE_MS = 2 * 60e3; // a claim that was never finished (the process died) can be taken over after this

export async function claimEvent(ev) {
  if (!ev.id) return 'new'; // never true for real Stripe events; kept so hand-made test payloads still work
  const t = now();
  // Stripe stops retrying an event after a few days, so claims older than 30 days are not needed; trimmed now and then.
  if (Math.random() < 0.01) await run("DELETE FROM stripe_events WHERE status = 'done' AND done_at < ?", t - 30 * 864e5).catch(() => {});
  const ins = await run('INSERT OR IGNORE INTO stripe_events (id, type, livemode, created, status, received_at) VALUES (?,?,?,?,?,?)', ev.id, ev.type, ev.livemode ? 1 : 0, ev.created ?? null, 'processing', t);
  if (ins.changes) return 'new';
  const take = await run("UPDATE stripe_events SET status = 'processing', received_at = ? WHERE id = ? AND (status = 'failed' OR (status = 'processing' AND received_at < ?))", t, ev.id, t - STALE_MS);
  return take.changes ? 'retry' : 'duplicate';
}
export const finishEvent = ev => (ev.id ? run("UPDATE stripe_events SET status = 'done', done_at = ? WHERE id = ?", now(), ev.id) : null);
export const failEvent = ev => (ev.id ? run("UPDATE stripe_events SET status = 'failed' WHERE id = ?", ev.id) : null);

export function modeMismatch(ev, key = process.env.STRIPE_SECRET_KEY) {
  const m = keyMode(key || '');
  return (m === 'test' && ev.livemode === true) || (m === 'live' && ev.livemode === false);
}

// ---- ordering ----
// Subscription events are ordered per subscription; invoice.paid / invoice.payment_failed per customer
// (a failure that arrives after the payment that fixed it must not mark the plan past due again).
const orderKey = ev => {
  const o = ev.data?.object || {};
  if (/^customer\.subscription\./.test(ev.type) && o.id) return `sub:${o.id}`;
  if (/^invoice\.(paid|payment_failed)$/.test(ev.type) && o.customer) return `inv:${o.customer}`;
  return null;
};
export async function isStale(ev) {
  const k = orderKey(ev);
  if (!k) return false;
  const row = await one('SELECT last_created, terminal FROM stripe_object_state WHERE object_id = ?', k);
  if (!row) return false;
  if (row.terminal && ev.type !== 'customer.subscription.deleted') return true; // a deleted subscription stays deleted
  return (ev.created ?? 0) < row.last_created;
}
// Called after an event was applied, so a failed event does not move the state forward.
export async function commitOrder(ev) {
  const k = orderKey(ev);
  if (!k) return;
  await run('INSERT INTO stripe_object_state (object_id, last_created, terminal) VALUES (?,?,?) ON CONFLICT(object_id) DO UPDATE SET last_created = MAX(last_created, excluded.last_created), terminal = MAX(terminal, excluded.terminal)',
    k, ev.created ?? 0, ev.type === 'customer.subscription.deleted' ? 1 : 0);
}

// ---- test-mode data ----
export async function tagLivemode(ev) {
  const o = ev.data?.object || {}, lm = ev.livemode ? 1 : 0;
  const refs = [o.id, o.invoice, o.payment_intent, typeof o.latest_invoice === 'string' ? o.latest_invoice : null].filter(x => typeof x === 'string' && x);
  const lid = +o.metadata?.ledger_id;
  if (lid) {
    await run('UPDATE ledger SET livemode = ? WHERE livemode IS NULL AND (id = ? OR (kind = ? AND ref = ?))', lm, lid, 'deposit_fee', `fee:${lid}`);
  }
  for (const ref of refs) await run('UPDATE ledger SET livemode = ? WHERE livemode IS NULL AND ref = ?', lm, ref);
}

// ---- events the older handler did not read ----
export const EXTRA_EVENTS = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded', 'charge.dispute.created', 'invoice.payment_failed', 'checkout.session.expired']);
const money = cents => (Math.round(+cents || 0) / 100).toFixed(2);
const baseMemo = m => String(m || '').split(' – ')[0];
const NOTE = ' – ';

// deps: { audit(userId, event, detail), alertOwner(subject, text), emailUser(to, subject, text), fetchCharge(id) }
export async function handleExtra(ev, deps = {}) {
  const o = ev.data?.object || {};
  const alertOwner = deps.alertOwner || (async () => {});
  const audit = deps.audit || (async () => {});
  switch (ev.type) {
    case 'payment_intent.succeeded': {
      // Fulfilment stays on checkout.session.* (one source of truth, so nothing is credited twice).
      // A payment that finally went through after a declined attempt drops the "declined" note.
      const id = +o.metadata?.ledger_id;
      if (id) await run("UPDATE ledger SET memo = substr(memo, 1, instr(memo, ?) - 1) WHERE id = ? AND memo LIKE ?", NOTE + 'last attempt', id, `%${NOTE}last attempt%`);
      return 'recorded';
    }
    case 'payment_intent.payment_failed': {
      // Checkout lets the customer try another card on the same session, so a failed attempt is a
      // note, not an end state: the deposit stays pending until paid or the session expires.
      const id = +o.metadata?.ledger_id;
      if (!id) return 'ignored';
      const e = o.last_payment_error || {};
      const row = await one('SELECT memo, user_id, status FROM ledger WHERE id = ?', id);
      if (!row || !['pending', 'processing'].includes(row.status)) return 'ignored';
      await run('UPDATE ledger SET memo = ? WHERE id = ?', `${baseMemo(row.memo)}${NOTE}last attempt declined: ${declineMessage(e.code, e.decline_code)}`.slice(0, 240), id);
      await audit(row.user_id, 'payment_declined', { ledger_id: id, code: e.code || null, decline_code: e.decline_code || null });
      return 'noted';
    }
    case 'checkout.session.expired': {
      const id = +o.metadata?.ledger_id;
      if (!id || o.metadata?.kind !== 'deposit') return 'ignored';
      const r = await run("UPDATE ledger SET status = 'failed', memo = 'The payment page expired before the payment was made' WHERE id = ? AND status = 'pending'", id);
      if (r.changes) await run("UPDATE ledger SET status = 'failed' WHERE kind = 'deposit_fee' AND ref = ?", `fee:${id}`);
      return r.changes ? 'expired' : 'ignored';
    }
    case 'charge.refunded': {
      // Refunds made in the Stripe dashboard (or by the automatic credit-card refund) are reflected here.
      const full = o.refunded === true || (o.amount > 0 && o.amount_refunded >= o.amount);
      const rows = [];
      for (const ref of [o.payment_intent, o.invoice].filter(Boolean)) rows.push(...(await all("SELECT id, kind, memo, status, user_id FROM ledger WHERE ref = ? AND kind IN ('deposit', 'subscription')", ref)));
      for (const r of rows) {
        if (full) await run("UPDATE ledger SET status = 'refunded' WHERE id = ? AND status != 'refunded'", r.id);
        else await run('UPDATE ledger SET memo = ? WHERE id = ?', `${baseMemo(r.memo)}${NOTE}partly refunded $${money(o.amount_refunded)}`.slice(0, 240), r.id);
        if (full && r.kind === 'deposit') await run("UPDATE ledger SET status = 'refunded' WHERE kind = 'deposit_fee' AND ref = ? AND status != 'refunded'", `fee:${r.id}`);
        await audit(r.user_id, full ? 'stripe_refund' : 'stripe_partial_refund', { ledger_id: r.id, amount: +money(o.amount_refunded) });
      }
      // Credit packs are not clawed back automatically: that is a decision for the owner (AUDIT note D3).
      if (!rows.length) logStripe('info', 'refund_no_ledger_row', { eventId: ev.id, livemode: ev.livemode });
      return rows.length ? (full ? 'refunded' : 'partly_refunded') : 'no_ledger_row';
    }
    case 'charge.dispute.created': {
      // Only flagged and reported; no money is moved and no account is changed automatically.
      let rows = o.payment_intent ? await all("SELECT id, user_id FROM ledger WHERE ref = ? AND kind IN ('deposit', 'subscription')", o.payment_intent) : [];
      if (!rows.length && o.charge) {
        try { const c = await (deps.fetchCharge || (id => stripeGet(`/charges/${encodeURIComponent(id)}`)))(o.charge); if (c?.invoice) rows = await all("SELECT id, user_id FROM ledger WHERE ref = ? AND kind = 'subscription'", c.invoice); } catch (e) { logStripe('warn', 'dispute_charge_lookup_failed', { eventId: ev.id, reason: e.name }); }
      }
      for (const r of rows) {
        await run("UPDATE ledger SET status = 'disputed' WHERE id = ? AND status NOT IN ('refunded', 'failed')", r.id);
        await audit(r.user_id, 'stripe_dispute', { ledger_id: r.id, reason: o.reason || null });
      }
      const due = o.evidence_details?.due_by ? new Date(o.evidence_details.due_by * 1000).toISOString().slice(0, 10) : 'see the Stripe dashboard';
      await alertOwner('A payment was disputed', `Stripe opened dispute ${o.id} for ${money(o.amount)} ${String(o.currency || '').toUpperCase()} (reason: ${o.reason || 'unknown'}). Send evidence by ${due}. ${rows.length ? `${rows.length} ledger row(s) are marked disputed.` : 'No matching ledger row was found.'} ${ev.livemode ? '' : '(test mode)'}`);
      return rows.length ? 'disputed' : 'no_ledger_row';
    }
    case 'invoice.payment_failed': {
      const u = o.customer ? await one('SELECT id, email, plan_status FROM users WHERE stripe_customer = ?', o.customer) : null;
      if (!u) return 'ignored';
      // Stripe retries the payment by itself (Smart Retries); the plan is only downgraded when the
      // subscription ends (customer.subscription.updated / deleted), as before.
      await run("UPDATE users SET plan_status = 'past_due' WHERE id = ? AND plan_status IN ('active', 'trialing')", u.id);
      await audit(u.id, 'plan_payment_failed', { attempt: o.attempt_count || null });
      if (deps.emailUser) await deps.emailUser(u.email, 'We could not charge your card', 'We could not charge your card for your Brightolio plan. Please update your payment method in Funding > Manage billing. Stripe will try the payment again automatically.').catch(() => {});
      return 'past_due';
    }
  }
  return 'ignored';
}
