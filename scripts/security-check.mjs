// Weekly security check. Reads nodejs.org's release list and, for each Node.js line we allow,
// finds the newest release marked as a security release. When it is newer than our floor
// (security/node-floor.json), prints it; with --update it raises the floor and package.json engines.
//   node scripts/security-check.mjs [--update]
import fs from 'node:fs';
import { enginesRange } from '../src/runtime-check.js';

const FLOOR = new URL('../security/node-floor.json', import.meta.url), PKG = new URL('../package.json', import.meta.url);
const parts = v => v.replace(/^v/, '').split('.').map(Number);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

const doc = JSON.parse(fs.readFileSync(FLOOR, 'utf8'));
const r = await fetch(process.env.NODE_DIST_INDEX || 'https://nodejs.org/dist/index.json', { signal: AbortSignal.timeout(20000) });
if (!r.ok) { console.error(`nodejs.org answered ${r.status}`); process.exit(2); }
const releases = await r.json(), raised = {};
for (const [major, floor] of Object.entries(doc.floors)) {
  const sec = releases.filter(x => x.security && parts(x.version)[0] === +major).map(x => x.version.replace(/^v/, ''));
  const top = sec.sort((a, b) => (newer(a, b) ? -1 : 1))[0];
  if (top && newer(top, floor)) raised[major] = top;
}
if (!Object.keys(raised).length) { console.log('Node.js floors are current:', JSON.stringify(doc.floors)); process.exit(0); }
console.log('New Node.js security releases:', JSON.stringify(raised));
if (process.argv.includes('--update')) {
  Object.assign(doc.floors, raised);
  doc.since = new Date().toISOString().slice(0, 10);
  doc.reason = 'Node.js security release (see https://nodejs.org/en/blog/vulnerability)';
  fs.writeFileSync(FLOOR, JSON.stringify(doc, null, 2) + '\n');
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  pkg.engines.node = enginesRange(doc.floors);
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Raised the floor; package.json engines is now', pkg.engines.node);
}
