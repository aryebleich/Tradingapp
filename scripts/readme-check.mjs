// The private README describes only what exists: every page it names ("menu → X", "Admin → X",
// "Settings → X") must be a page in the current menu or an admin tab, and sections about removed
// things (src/readme-auto.js OBSOLETE) must not come back in the code's own sections.
import { SECTIONS, OBSOLETE } from '../src/readme-auto.js';
import { overviewMd, literal } from '../src/readme-overview.js';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const labels = new Set([...(literal(app, 'CORE') || []), ...(literal(app, 'NAV') || []).flatMap(g => g[1]), ...(literal(app, 'ADMIN_GROUPS') || []).flatMap(g => g[1]), ...((literal(app, 'BIZ_NAV') || [])[1] || [])].map(x => x[1].toLowerCase()));
const groups = new Set([...(literal(app, 'NAV') || []).map(g => g[0].toLowerCase()), 'accounts', 'settings', 'admin', 'menu', 'home']);
const text = SECTIONS.map(s => s.md).join('\n') + '\n' + await overviewMd();
const problems = [];
for (const m of text.matchAll(/\b(?:menu|Admin|Settings|Owner)\s*→\s*([A-Z][\w &,'-]+?)(?=[).,:;\n]| →| \(|$)/g)) {
  const name = m[1].trim().toLowerCase();
  if (![...labels, ...groups].some(l => name === l || name.startsWith(l + " ") || name.startsWith(l + ","))) problems.push(`names a page that no longer exists: "${m[0]}"`);
}
for (const h of OBSOLETE) if (new RegExp(`^## ${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(text)) problems.push(`a removed section is back: "## ${h}"`);
if (/competitor|average of (?:the )?(?:other|competing)/i.test(text)) problems.push('mentions competitor prices or averages');
if (problems.length) { console.log(problems.map(p => '- ' + p).join('\n')); process.exitCode = 1; }
else console.log('README: only current pages and features.');
