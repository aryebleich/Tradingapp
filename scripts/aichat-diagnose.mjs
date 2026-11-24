// Ops: the AI providers as the admin chat uses them, one line each (run inside the app container by
// deploy/vm/migrate.sh aichat-diagnose). Shows key shapes and reasons only, never a key, a message or a reply.
import { initKeystore } from '../src/keystore.js';
import { diagnose, plainLine } from '../src/aichat/diagnose.js';
await initKeystore({ every: 0 });
const d = await diagnose();
console.log(`active setting: ${d.active}; in use now: ${d.inUse ? d.inUse.name : 'none'}`);
if (!d.providers.length) console.log('no provider has a key');
for (const row of d.providers) console.log(plainLine(row));
process.exit(0);
