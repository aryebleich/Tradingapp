// Durable order queue. Automated orders (bots, alerts, scanners, portfolios, mirrored signals)
// are written here instead of failing when a brokerage's circuit breaker is open, or when the
// server is shedding load during a surge; workers on every server replica drain it in order with
// bounded concurrency. Each order has a short time-to-live so a stale signal is never sent late.
// The table is the message log: rows are claimed atomically, so several replicas can share it.
import { one, all, run, now } from './db.js';
import { notifyUser } from './notify-user.js';

const TTL = () => (+process.env.ORDER_QUEUE_TTL_SEC || 120) * 1000;
const WORKERS = () => +process.env.ORDER_WORKERS || 4;
export const AUTOMATED = s => !['web', 'manual', 'sms', 'hotline', 'guard'].includes(String(s || '').split(':')[0]);

export async function enqueue(userId, account, order, source, reason) {
  const t = now();
  const id = (await run('INSERT INTO order_queue (user_id, account, payload, source, reason, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    userId, account, JSON.stringify(order), source, String(reason || '').slice(0, 200), t + TTL(), t, t)).lastInsertRowid;
  return { status: 'queued', queueId: id, symbol: String(order.symbol).toUpperCase(), side: order.side, broker: account, note: 'Queued: the brokerage is busy or the server is under heavy load. It will be sent within ' + Math.round(TTL() / 1000) + ' seconds or dropped.' };
}

// place(userId, account, order, source) sends one order; it throws { breakerOpen } while the broker is down.
export async function drain(place, t = now()) {
  await run("UPDATE order_queue SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at < ?", t, t);
  for (const x of await all("SELECT id, user_id, payload FROM order_queue WHERE status = 'expired' AND result IS NULL LIMIT 50")) {
    await run("UPDATE order_queue SET result = 'not sent: too old' WHERE id = ?", x.id);
    const o = JSON.parse(x.payload);
    await notifyUser(x.user_id, `A queued ${o.side} order for ${o.symbol} was not sent because the brokerage stayed unavailable.`).catch(() => {});
  }
  const rows = await all("SELECT * FROM order_queue WHERE status = 'pending' ORDER BY id LIMIT 100");
  let sent = 0, i = 0;
  const work = async () => {
    while (i < rows.length) {
      const q = rows[i++];
      if (!(await run("UPDATE order_queue SET status = 'working', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'", now(), q.id)).changes) continue;
      try {
        const r = await place(q.user_id, q.account, { ...JSON.parse(q.payload), _fromQueue: true }, q.source);
        await run("UPDATE order_queue SET status = 'sent', result = ?, updated_at = ? WHERE id = ?", JSON.stringify(r).slice(0, 500), now(), q.id); sent++;
      } catch (e) {
        const retry = e.breakerOpen || e.status >= 500 || e.status === 429;
        await run('UPDATE order_queue SET status = ?, result = ?, updated_at = ? WHERE id = ?', retry ? 'pending' : 'failed', retry ? null : e.message.slice(0, 300), now(), q.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS(), rows.length) }, work));
  return sent;
}
export async function queueStats() {
  const by = Object.fromEntries((await all('SELECT status, COUNT(*) n FROM order_queue GROUP BY status')).map(r => [r.status, r.n]));
  const oldest = await one("SELECT MIN(created_at) t FROM order_queue WHERE status = 'pending'");
  return { pending: by.pending || 0, working: by.working || 0, sent: by.sent || 0, failed: by.failed || 0, expired: by.expired || 0, oldestPendingSec: oldest?.t ? Math.round((now() - oldest.t) / 1000) : null };
}
export const userQueue = userId => all('SELECT id, account, payload, source, reason, status, result, created_at FROM order_queue WHERE user_id = ? ORDER BY id DESC LIMIT 30', userId);
