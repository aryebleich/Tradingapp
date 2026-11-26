// The feature registry (docs/FEATURE_REGISTRY.md): its summary is rebuilt from its rows, and every
// page and route of the app must be listed in its "Every page" tables (test/feature-registry.test.js).
//   node scripts/registry.mjs           rewrite the summary
//   node scripts/registry.mjs --check   exit 1 when the summary is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { literal } from '../src/readme-overview.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILE = path.join(root, 'docs/FEATURE_REGISTRY.md');
export const STATES = ['done', 'partial', 'missing'];
export const TIERS = ['Free', 'Pro', 'Elite', 'Ultimate', 'Institutional'];
export const FLAGS = ['legal', 'licensed', 'delayed', 'member', '—'];
export const PRODUCTS = ['Terminal', 'AI', 'Scanner', 'AutoTrade', 'Portfolio', 'Intelligence', 'Social', 'Marketplace', 'Academy', 'Enterprise', 'Developer Cloud', 'Apps', 'Security'];

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

// Every feature row, with the section it is in.
export function parseRegistry(md) {
  const rows = []; let section = null;
  for (const line of md.split('\n')) {
    const h = /^## (\d+)\. (.+)$/.exec(line);
    if (h) { section = { n: +h[1], title: h[2] }; continue; }
    if (/^## /.test(line)) { section = null; continue; }
    if (!section || !/^\| [A-Z]+-\d+ \|/.test(line)) continue;
    const [id, feature, status, where, missing, product, tier, flag, ve] = cells(line);
    const [v, e] = String(ve).split('/').map(Number);
    rows.push({ section: section.n, sectionTitle: section.title, id, feature, status, where, missing, product, tier, flag, value: v, effort: e });
  }
  return rows;
}

// The pages listed in "Every page" (route names and page files).
export function listedPages(md) {
  const i = md.indexOf('\n## Every page'); const part = i < 0 ? '' : md.slice(i);
  return {
    routes: new Set([...part.matchAll(/^\| #\/([a-z0-9-]+) \|/gm)].map(m => m[1])),
    files: new Set([...part.matchAll(/^\| ([a-z0-9-]+\.js) \|/gm)].map(m => m[1])),
  };
}

// Every route of the app: the menu (CORE, NAV), the hub tabs (HUBS), the owner's pages (ADMIN_GROUPS,
// BIZ_NAV) and the routes the lazily loaded page modules register (lazyRoutes).
export function appRoutes(src = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8')) {
  const k = new Set();
  for (const [a] of literal(src, 'CORE') || []) k.add(a);
  for (const [, items] of literal(src, 'NAV') || []) for (const [a] of items) k.add(a);
  for (const [h, [, tabs]] of Object.entries(literal(src, 'HUBS') || {})) { k.add(h); for (const [a] of tabs) k.add(a); }
  for (const [, t] of literal(src, 'ADMIN_GROUPS') || []) for (const [a] of t) k.add(a);
  const biz = literal(src, 'BIZ_NAV'); if (biz) for (const [a] of biz[1]) k.add(a);
  for (const m of src.matchAll(/lazyRoutes\([^[]*\[([^\]]*)\]/g)) for (const x of m[1].matchAll(/"([^"]+)"|'([^']+)'/g)) k.add(x[1] || x[2]);
  return k;
}
export const pageFiles = () => fs.readdirSync(path.join(root, 'public/pages')).filter(f => f.endsWith('.js'));

const ratio = r => (r.effort ? r.value / r.effort : 0);
export function summary(rows) {
  const sections = [...new Map(rows.map(r => [r.section, r.sectionTitle])).entries()].sort((a, b) => a[0] - b[0]);
  const count = (list, s) => list.filter(r => r.status === s).length;
  const lines = ['## Summary', '', `Rebuilt by \`node scripts/registry.mjs\` from the rows below: ${rows.length} features.`, '',
    '| Section | Done | Partial | Missing |', '| --- | --- | --- | --- |'];
  for (const [n, title] of sections) { const l = rows.filter(r => r.section === n); lines.push(`| ${n}. ${title} | ${count(l, 'done')} | ${count(l, 'partial')} | ${count(l, 'missing')} |`); }
  lines.push(`| **All** | **${count(rows, 'done')}** | **${count(rows, 'partial')}** | **${count(rows, 'missing')}** |`);
  // The best value for the effort first, then the higher value, then missing before partial; legal and
  // licensed rows wait for a sign-off or a license.
  const missingFirst = r => (r.status === 'missing' ? 0 : 1);
  const gaps = rows.filter(r => r.status !== 'done' && r.flag !== 'legal' && r.flag !== 'licensed')
    .sort((a, b) => ratio(b) - ratio(a) || b.value - a.value || missingFirst(a) - missingFirst(b))
    .slice(0, 20);
  lines.push('', '### The 20 biggest gaps', '', 'Missing or partial rows with the highest value for the effort (V/E), legal and licensed rows left out (they wait for sign-off or a license):', '',
    '| # | ID | Feature | Status | V/E |', '| --- | --- | --- | --- | --- |');
  gaps.forEach((r, i) => lines.push(`| ${i + 1} | ${r.id} | ${r.feature} | ${r.status} | ${r.value}/${r.effort} |`));
  return { text: lines.join('\n'), gaps };
}

export function rebuild(md) {
  const a = md.indexOf('<!-- summary:start -->'), b = md.indexOf('<!-- summary:end -->');
  if (a < 0 || b < 0) throw new Error('summary markers missing');
  return md.slice(0, a) + '<!-- summary:start -->\n' + summary(parseRegistry(md)).text + '\n' + md.slice(b);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const md = fs.readFileSync(FILE, 'utf8'), next = rebuild(md);
  if (process.argv.includes('--check')) { if (next !== md) { console.error('docs/FEATURE_REGISTRY.md: the summary is out of date; run node scripts/registry.mjs'); process.exit(1); } console.log('registry summary is current'); }
  else { fs.writeFileSync(FILE, next); console.log(`wrote the summary: ${parseRegistry(next).length} features`); }
}
