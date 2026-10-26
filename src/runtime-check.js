// Is this Node.js new enough? security/node-floor.json lists the lowest release with the latest
// security fixes for each supported major line (even majors only; odd ones never get LTS fixes).
import fs from 'node:fs';

const FILE = new URL('../security/node-floor.json', import.meta.url);
export const floors = () => JSON.parse(fs.readFileSync(FILE, 'utf8')).floors;
const parts = v => String(v).replace(/^v/, '').split('.').map(Number);
const atLeast = (v, min) => { const a = parts(v), b = parts(min); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return true; };
export function nodeStatus(version = process.version, f = floors()) {
  const major = parts(version)[0], majors = Object.keys(f).map(Number).sort((x, y) => x - y);
  const min = f[major];
  if (min) return { ok: atLeast(version, min), version, min };
  // A newer even line than any listed is fine; an odd line or one older than the oldest listed is not.
  return { ok: major > majors.at(-1) && major % 2 === 0, version, min: f[majors.at(-1)] };
}
// The engines range package.json should carry for these floors.
export const enginesRange = (f = floors()) => Object.entries(f).sort(([a], [b]) => a - b).map(([m, v], i, all) => (i === all.length - 1 ? `>=${v}` : `>=${v} <${+m + 1}`)).join(' || ');
