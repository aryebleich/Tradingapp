// One Node.js process per CPU core on the Oracle server (PERFORMANCE.md; deploy/vm/compose.yml runs
// `node cluster.js`). The primary only starts and watches the processes and passes their messages on:
//   leader  PORT (3000): everything stateful (jobs, scheduler, streams, webhooks, sign-in, orders, Admin)
//   helpers PORT+1, PORT+2, ...: pages, static files and the rest of the API
// Caddy sends the leader's paths to 3000 and spreads the rest over all of them
// (deploy/vm/caddy-app.caddy). WEB_WORKERS sets how many (default: the CPU cores, at most 8);
// WEB_WORKERS=1 is a single process. The leader starts first, so only it runs the database
// migrations; the helpers follow once it answers. A process that stops is started again with the same
// role and port (at most once every 5 seconds).
import cluster from 'node:cluster';
import os from 'node:os';

const N = Math.max(1, Math.min(8, +process.env.WEB_WORKERS || os.cpus().length));
const BASE = +process.env.PORT || 3000;
if (cluster.isPrimary && N > 1) {
  const slots = new Map(); // worker id -> { role, port }
  const start = (role, port) => {
    const w = cluster.fork({ QP_ROLE: role, QP_WORKERS: String(N), PORT: String(port), QP_START: '1' });
    slots.set(w.id, { role, port, at: Date.now() });
    w.on('message', m => { if (m && m.qpBus === 1) for (const o of Object.values(cluster.workers)) if (o && o.id !== w.id && o.isConnected()) o.send(m); });
    return w;
  };
  cluster.on('exit', (w, code, signal) => {
    const s = slots.get(w.id); slots.delete(w.id);
    if (!s || stopping) return;
    const wait = Math.max(0, 5000 - (Date.now() - s.at));
    console.error(`${s.role} on ${s.port} stopped (${signal || code}); starting it again in ${Math.round(wait / 1000)} s`);
    setTimeout(() => start(s.role, s.port), wait);
  });
  let stopping = false;
  const stop = () => { stopping = true; for (const w of Object.values(cluster.workers)) w?.process.kill('SIGTERM'); setTimeout(() => process.exit(0), 9000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const leader = start('leader', BASE);
  // Helpers once the leader answers (it has run the migrations by then).
  const ready = async () => { for (let i = 0; i < 120; i++) { if (await fetch(`http://127.0.0.1:${BASE}/healthz`).then(r => r.ok, () => false)) return; await new Promise(r => setTimeout(r, 500)); } };
  leader.once('listening', async () => { await ready(); for (let i = 1; i < N; i++) start('helper', BASE + i); console.log(`Brightolio: ${N} processes (leader on ${BASE}, helpers on ${BASE + 1}-${BASE + N - 1})`); });
  cluster.on('exit', () => { if (!Object.keys(cluster.workers).length && stopping) process.exit(0); });
} else {
  if (cluster.isPrimary) { process.env.QP_ROLE ||= 'single'; process.env.QP_START = '1'; }
  await import('./server.js');
}
