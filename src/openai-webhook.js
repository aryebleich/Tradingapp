// The OpenAI webhook receiver (POST /api/webhooks/openai, wired in server.js). Standard Webhooks
// signing: the webhook-id, webhook-timestamp and webhook-signature headers, HMAC-SHA256 of
// "<id>.<timestamp>.<raw body>" with the key that follows "whsec_" (base64). Events older than
// 5 minutes are refused, each event id is handled once, and the answer goes out before the work
// (which fetches the finished response or batch from OpenAI and updates the waiting chat answer).
import crypto from 'node:crypto';
import { one, all, run, now } from './db.js';
import { siteGet, siteSet } from './site.js';
import { openaiJson, openaiText, textOf, jobFor } from './openai-jobs.js';
import { notifyUser } from './notify-user.js';
import { allAdminEmails } from './auth.js';

export const TOLERANCE_S = 300;

// { ok: true } or { ok: false, reason }. raw is the exact body text; headers are the request headers.
export function verifyStandardWebhook({ raw, headers = {}, secret = '', nowMs = Date.now() }) {
  if (!/^whsec_/.test(secret)) return { ok: false, reason: 'no webhook signing secret is set (OPENAI_WEBHOOK_SECRET)' };
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sig = headers['webhook-signature'];
  if (!id || !ts || !sig) return { ok: false, reason: 'the signature headers are missing' };
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > TOLERANCE_S) return { ok: false, reason: 'the event is too old (or from the future)' };
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  // The header can carry several signatures ("v1,<base64> v1,<base64>"), for example during a key rotation.
  const given = String(sig).split(' ').map(x => x.split(',')).filter(([v, s]) => v === 'v1' && s).map(([, s]) => s);
  const ok = given.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  return ok ? { ok: true } : { ok: false, reason: 'the signature does not match' };
}

// Records an event once. Returns 'accepted', or 'duplicate' when the same id was already received.
export async function receive(ev) {
  if (!ev || typeof ev.id !== 'string' || typeof ev.type !== 'string') throw Object.assign(new Error('bad event'), { status: 400 });
  const r = await run("INSERT INTO openai_events (id, type, status, received_at) VALUES (?, ?, 'received', ?) ON CONFLICT(id) DO NOTHING", ev.id, ev.type, now());
  if (!r.changes) return 'duplicate';
  await siteSet('openaiLastEvent', { type: ev.type, id: ev.id, at: now() }).catch(() => {});
  return 'accepted';
}

// The work for one event, after the answer has gone out. Records the outcome on the event.
export async function processEvent(ev) {
  try {
    const outcome = await apply(ev);
    await run('UPDATE openai_events SET status = ?, done_at = ? WHERE id = ?', outcome, now(), ev.id);
    return outcome;
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await run("UPDATE openai_events SET status = 'failed', error = ?, done_at = ? WHERE id = ?", msg, now(), ev.id).catch(() => {});
    await siteSet('openaiFailures', { count: ((siteGet('openaiFailures', null) || {}).count || 0) + 1, last: msg, type: ev.type, at: now() }).catch(() => {});
    return 'failed';
  }
}

async function apply(ev) {
  const id = ev.data?.id;
  if (!id) return 'ignored';
  switch (ev.type) {
    case 'response.completed': {
      const r = await openaiJson(`/responses/${id}`);
      await finish(id, 'done', { result: textOf(r) || '(The answer was empty.)' });
      return 'done';
    }
    case 'response.failed':
    case 'response.cancelled':
    case 'response.incomplete': {
      const r = await openaiJson(`/responses/${id}`).catch(() => ({}));
      const reason = r.error?.message || r.incomplete_details?.reason || ev.type.split('.')[1];
      await finish(id, 'failed', { error: reason });
      return 'failed';
    }
    case 'batch.completed': {
      const b = await openaiJson(`/batches/${id}`);
      if (!b.output_file_id) throw new Error('the batch has no results file');
      await finish(id, 'done', { result: await openaiText(`/files/${b.output_file_id}/content`) });
      return 'done';
    }
    case 'batch.failed':
    case 'batch.expired':
    case 'batch.cancelled': {
      const what = ev.type.split('.')[1];
      await finish(id, 'failed', { error: what });
      await notifyAdmins(`An OpenAI batch job ${what} (${id}). Check Admin → AI.`);
      return 'failed';
    }
    default:
      return 'ignored';
  }
}

// Updates the job, the waiting chat answer, and tells the owner if they asked to be told.
async function finish(openaiId, status, { result = null, error = null }) {
  const job = await jobFor(openaiId);
  if (!job) return; // not one of ours (another project on the same key)
  const t = now();
  await run('UPDATE openai_jobs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?', status, result, error, t, job.id);
  if (job.message_id) {
    if (status === 'done') await run("UPDATE ai_chat_messages SET content = ?, status = 'complete', updated_at = ? WHERE id = ?", result, t, job.message_id);
    else await run("UPDATE ai_chat_messages SET content = ?, status = 'error', updated_at = ? WHERE id = ?",
      `The background answer did not finish (${error}). Use Retry to ask again.`, t, job.message_id);
  }
  if (job.notify && job.owner_id) {
    const msg = status === 'done' ? 'Your AI answer is ready in the AI team chat.' : `A background AI answer did not finish (${error}). Open the chat to retry.`;
    await notifyUser(job.owner_id, msg).catch(() => {});
  }
}

async function notifyAdmins(msg) {
  for (const email of allAdminEmails()) {
    const u = await one('SELECT id FROM users WHERE email = ?', email).catch(() => null);
    if (u) await notifyUser(u.id, msg).catch(() => {});
  }
}

// Status for Admin → AI: the URL to enter at OpenAI, whether the secret is set, the last event, the
// failures and the recent events (names and outcomes only).
export async function webhookStatus(publicUrl, secretSet) {
  const lastBad = siteGet('openaiBadSignature', null);
  const failures = siteGet('openaiFailures', null);
  return {
    url: `${publicUrl}/api/webhooks/openai`,
    secretSet: !!secretSet,
    lastEvent: siteGet('openaiLastEvent', null),
    lastBadSignature: lastBad,
    failures: failures ? { count: failures.count, last: failures.last, at: failures.at } : null,
    recent: await all('SELECT id, type, status, error, received_at FROM openai_events ORDER BY received_at DESC LIMIT 15'),
  };
}
