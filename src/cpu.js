// Heavy number crunching off the request thread (PERFORMANCE.md): backtests, the optimizer, the
// Monte Carlo projection, walk-forward tests, the pairs and order-flow math and the big rankings run
// in a small pool of worker threads, so one long calculation never delays anybody else's page.
//   await cpu('engine', 'optimize', [closes, cfg, warm, dates])
// Only the modules listed in src/cpu-worker.js can run there (pure functions: data in, data out).
// CPU_THREADS sets the pool size (default: the cores minus one, 1 to 4); CPU_THREADS=0 runs inline.
import os from 'node:os';
import { Worker } from 'node:worker_threads';

const SIZE = Number.isFinite(+process.env.CPU_THREADS) && process.env.CPU_THREADS !== '' ? Math.max(0, Math.min(8, +process.env.CPU_THREADS)) : Math.max(1, Math.min(4, os.cpus().length - 1));
const TIMEOUT = +(process.env.CPU_TASK_MS || 60000);
const pool = [], queue = [];
let seq = 0;
const stats = { ran: 0, inline: 0, queuedMax: 0, failed: 0, timedOut: 0 };

function spawn() {
  const w = new Worker(new URL('./cpu-worker.js', import.meta.url));
  w.unref();
  const slot = { w, busy: null };
  w.on('message', m => {
    const job = slot.busy; if (!job || m.id !== job.id) return;
    clearTimeout(job.timer); slot.busy = null;
    if (m.error) { stats.failed++; job.reject(Object.assign(new Error(m.error), { status: m.status || 500 })); } else { stats.ran++; job.resolve(m.result); }
    next();
  });
  w.on('error', e => { const job = slot.busy; slot.busy = null; if (job) { clearTimeout(job.timer); stats.failed++; job.reject(e); } replace(slot); });
  w.on('exit', code => { if (code !== 0) replace(slot); });
  pool.push(slot);
  return slot;
}
function replace(slot) { const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1); try { slot.w.terminate(); } catch {} spawn(); next(); }
function next() {
  while (queue.length) {
    const slot = pool.find(s => !s.busy) || (pool.length < SIZE ? spawn() : null);
    if (!slot) return;
    const job = queue.shift(); slot.busy = job;
    job.timer = setTimeout(() => { stats.timedOut++; job.reject(Object.assign(new Error('That calculation took too long. Try a shorter period or fewer settings.'), { status: 504 })); slot.busy = null; replace(slot); }, TIMEOUT);
    job.timer.unref?.();
    slot.w.postMessage({ id: job.id, mod: job.mod, fn: job.fn, args: job.args });
  }
}
export async function cpu(mod, fn, args = []) {
  if (!SIZE) { stats.inline++; const m = await import(`./${mod}.js`); return m[fn](...args); }
  return new Promise((resolve, reject) => { queue.push({ id: ++seq, mod, fn, args, resolve, reject }); stats.queuedMax = Math.max(stats.queuedMax, queue.length); next(); });
}
export const cpuStats = () => ({ threads: pool.length, size: SIZE, busy: pool.filter(s => s.busy).length, queued: queue.length, ...stats });
