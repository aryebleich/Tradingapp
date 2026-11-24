// One Node.js process per CPU core (cluster.js, PERFORMANCE.md). Each process has a role:
//   leader  port 3000: the background jobs, the scheduler, the market-data streams, the live
//           streams to browsers, webhooks, sign-in, orders and Admin (Caddy sends those paths here,
//           deploy/vm/caddy-app.caddy), so anything that lives in memory there stays exact
//   helper  port 3001 and up: pages, static files and the rest of the API, shared with the leader
//   single  one process (tests, development, a server without cluster.js): everything
// The processes tell each other about database writes through the primary (cluster.js relays every
// message to the others), so a cached session, user, setting or credential never outlives a change
// made in another process.
export const ROLE = process.env.QP_ROLE || 'single';
export const isLeader = () => ROLE !== 'helper';
export const workerCount = () => Math.max(1, +process.env.QP_WORKERS || 1);
const handlers = new Map();
export function publish(type, data) {
  if (ROLE === 'single' || typeof process.send !== 'function') return;
  try { process.send({ qpBus: 1, type, data }); } catch { /* the primary is gone: nothing to tell */ }
}
export function on(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); }
process.on('message', m => { if (m && m.qpBus === 1) for (const fn of handlers.get(m.type) || []) { try { fn(m.data); } catch (e) { console.warn('bus', m.type, e.message); } } });
