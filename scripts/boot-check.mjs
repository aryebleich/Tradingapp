// Check 1: boots server.js against the mock broker (test/mock-alpaca.js) with a throwaway database
// and confirms /healthz answers. No real accounts or keys are used.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { startMock } from '../test/mock-alpaca.js';

const mock = await startMock();
const PORT = 3190 + Math.floor(Math.random() * 50), B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...process.env, PORT: String(PORT), NODE_ENV: 'test', FREE_DATA: 'off', DB_FILE: path.join(os.tmpdir(), `boot-${Date.now()}.db`),
  ALPACA_TRADING_URL: mock.url, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url, ALPACA_KEY_ID: 'BOOT', ALPACA_SECRET: 'BOOT', ALPACA_STREAM_URL: 'ws://127.0.0.1:1',
} });
let log = ''; srv.stdout.on('data', d => (log += d)); srv.stderr.on('data', d => (log += d));
let ok = false;
for (let i = 0; i < 120 && !ok; i++) {
  ok = await fetch(B + '/healthz').then(r => r.ok, () => false);
  if (!ok) await new Promise(r => setTimeout(r, 250));
}
srv.kill(); mock.close();
if (!ok) { console.error('server.js did not answer /healthz within 30 s\n' + log.slice(-3000)); process.exit(1); }
console.log('OK: server.js boots and /healthz answers.');
process.exit(0);
