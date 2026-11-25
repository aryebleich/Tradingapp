// One worker thread of the CPU pool (src/cpu.js). Runs an exported function of an allowed module
// with plain data and sends the answer back. Nothing here touches the database or the network.
import { parentPort } from 'node:worker_threads';

const ALLOWED = new Set(['engine', 'pairslive-math', 'dividend-math', 'cpu-tasks', 'baskets-math']); // pure modules only (no database, auth or network)
const mods = new Map();
parentPort.on('message', async ({ id, mod, fn, args }) => {
  try {
    if (!ALLOWED.has(mod)) throw new Error(`${mod} cannot run in the CPU pool`);
    const m = mods.get(mod) || (await import(`./${mod}.js`));
    mods.set(mod, m);
    if (typeof m[fn] !== 'function') throw new Error(`${mod}.${fn} is not a function`);
    parentPort.postMessage({ id, result: await m[fn](...args) });
  } catch (e) { parentPort.postMessage({ id, error: e.message, status: e.status }); }
});
