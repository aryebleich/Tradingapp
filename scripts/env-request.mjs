// "Copy to the server .env" from Admin → Keys (src/keystore.js requestEnvCopy): the encrypted
// request on the data volume, decrypted inside the app container (only it has ENCRYPTION_KEY) and
// printed as KEY=value lines for deploy/vm/migrate.sh set-env, which the host's update script runs.
// The request file is removed first, so a key is never copied twice; nothing is logged.
//   docker compose exec -T app node scripts/env-request.mjs   (deploy/vm/update.sh)
import fs from 'node:fs';
import path from 'node:path';
import { tryDecrypt } from '../src/crypto.js';

const dir = process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : '/app/data';
const f = path.join(dir, '.env-request');
if (!fs.existsSync(f)) process.exit(0);
const blob = fs.readFileSync(f, 'utf8').trim();
fs.rmSync(f, { force: true });
const pairs = tryDecrypt(blob, 'env request') || {};
for (const [k, v] of Object.entries(pairs)) {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(k) || k === 'ENCRYPTION_KEY' || /[\r\n]/.test(String(v))) continue;
  process.stdout.write(`${k}=${v}\n`);
}
