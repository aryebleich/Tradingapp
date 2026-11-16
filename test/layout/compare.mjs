// Release gates 2, 4, 5 and 6 for the layout redesign: reads pair.json from run.mjs --pair and checks,
// for every page and width, the new layout against the old one on the same server and data.
//   - disclosures: every one still present, visible if it was, above the fold if it was, readable
//     (at least 12 px and the WCAG AA contrast of 4.5:1, or no worse than before)
//   - figures: the same list of numbers, character for character
//   - controls: every control of the old page is still on the new one
//   - axe: no rule with more violations than before; no new page-level horizontal scroll
//   - screenshots: pixel difference, listed for review (gate 5 needs a written reason for each)
// Writes REPORT.md and visual.json next to pair.json. Exit code 1 if a hard gate fails.
//   node test/layout/compare.mjs [DIR]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DIR = path.resolve(process.argv[2] || 'e2e-output/layout');
const { results, pages, widths } = JSON.parse(fs.readFileSync(path.join(DIR, 'pair.json'), 'utf8'));
const fail = { disclosure: [], figures: [], controls: [], axe: [], overflow: [], load: [] };
const info = { h1: [], targets: [], live: [] };
const multiset = a => a.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());

for (const pg of pages) for (const w of widths) {
  const o = results[pg.id]?.[w]?.old, n = results[pg.id]?.[w]?.new, at = `${pg.id} @${w}`;
  if (!o || !n || o.failed || n.failed) { fail.load.push(`${at}: ${o?.failed || n?.failed || 'missing'}`); continue; }
  if (!n.lv2) fail.load.push(`${at}: the new layout was not applied`);
  // Disclosures
  const pool = [...n.disclosures];
  for (const d of o.disclosures) {
    const i = pool.findIndex(x => x.text === d.text);
    if (i < 0) { fail.disclosure.push(`${at}: missing "${d.text.slice(0, 90)}"`); continue; }
    const x = pool.splice(i, 1)[0];
    if (d.visible && !x.visible) fail.disclosure.push(`${at}: no longer visible "${d.text.slice(0, 90)}"`);
    if (d.aboveFold && !x.aboveFold) fail.disclosure.push(`${at}: moved below the fold "${d.text.slice(0, 90)}"`);
    if (x.visible && x.fontPx < Math.min(12, d.fontPx)) fail.disclosure.push(`${at}: text smaller than 12 px (${x.fontPx}) "${d.text.slice(0, 60)}"`);
    if (x.visible && x.contrast < Math.min(4.5, d.contrast) - 0.05) fail.disclosure.push(`${at}: contrast ${x.contrast} < ${Math.min(4.5, d.contrast)} "${d.text.slice(0, 60)}"`);
    if (x.clipped && !d.clipped) fail.disclosure.push(`${at}: clipped "${d.text.slice(0, 60)}"`);
  }
  // Figures
  const val = a => a.map(f => f.split('\t')[0]), ctx = (a, k) => a.find(f => f.startsWith(k + '\t'))?.split('\t')[1] || '';
  const of = multiset(val(o.figures)), nf = multiset(val(n.figures)), diff = [];
  for (const k of new Set([...of.keys(), ...nf.keys()])) if ((of.get(k) || 0) !== (nf.get(k) || 0)) diff.push(`${k} ${of.get(k) || 0}→${nf.get(k) || 0} ("${ctx(o.figures, k) || ctx(n.figures, k)}")`);
  // Reviewed exception: Admin → Data shows a live counter of incoming stream events ("0 / 75"); it rises
  // between the old and the new page load a second apart. Only differences in that counter are excused.
  const live = pg.id === 'app/admin-data' && diff.every(x => /\("0 \/ \d+"\)$/.test(x));
  if (diff.length && live) info.live.push(`${at}: ${diff.join(', ')} (live event counter)`);
  else if (diff.length) fail.figures.push(`${at}: ${diff.slice(0, 12).join(', ')}`);
  // Controls
  const nc = multiset(n.controls);
  for (const [k, c] of multiset(o.controls)) if ((nc.get(k) || 0) < c) fail.controls.push(`${at}: control "${k}" ${c}→${nc.get(k) || 0}`);
  // axe and overflow
  if (o.axe && n.axe) {
    const before = Object.fromEntries(o.axe.map(v => [v.id, v.n]));
    for (const v of n.axe) if (v.n > (before[v.id] || 0)) fail.axe.push(`${at}: ${v.id} ${before[v.id] || 0}→${v.n} (${v.targets.slice(0, 2).join(' | ')})`);
  }
  if (n.overflowX && !o.overflowX) fail.overflow.push(`${at}: page scrolls sideways`);
  if (n.h1 !== 1) info.h1.push(`${at}: ${n.h1} (before ${o.h1})`);
  if (n.smallTargets > o.smallTargets) info.targets.push(`${at}: ${o.smallTargets}→${n.smallTargets}`);
}

// Visual differences, measured in a browser canvas (no image library needed).
const browser = await chromium.launch();
const p = await browser.newPage();
const visual = [];
for (const pg of pages) for (const w of widths) {
  const o = results[pg.id]?.[w]?.old, n = results[pg.id]?.[w]?.new;
  if (!o?.shot || !n?.shot) continue;
  const [a, b] = [o.shot, n.shot].map(f => 'data:image/png;base64,' + fs.readFileSync(path.join(DIR, 'shots', f)).toString('base64'));
  const r = await p.evaluate(async ([a, b]) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    const W = Math.min(x.width, y.width), H = Math.min(x.height, y.height, 6000);
    const px = img => { const c = new OffscreenCanvas(W, H), g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, W, H).data; };
    const d1 = px(x), d2 = px(y); let diff = 0;
    for (let i = 0; i < d1.length; i += 4) if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 30) diff++;
    return { pct: +(100 * diff / (W * H)).toFixed(2), hOld: x.height, hNew: y.height };
  }, [a, b]);
  visual.push({ page: pg.id, width: w, ...r, old: o.shot, new: n.shot });
}
await browser.close();
fs.writeFileSync(path.join(DIR, 'visual.json'), JSON.stringify(visual, null, 1));

const hard = Object.entries(fail).filter(([, v]) => v.length);
const sec = (t, a) => `### ${t} (${a.length})\n\n${a.length ? a.map(x => '- ' + x).join('\n') : '- none'}\n`;
const md = [`# Layout v2 comparison\n\n${pages.length} pages × ${widths.length} widths (${widths.join(', ')} px), old and new layout on the same server and data.\n`,
  `**Result: ${hard.length ? 'FAIL' : 'PASS'}**\n`,
  sec('Disclosures (gate 2)', fail.disclosure), sec('Figures (gate 4)', fail.figures), sec('Controls still present (rule 2)', fail.controls),
  sec('New axe violations (gate 6)', fail.axe), sec('New sideways page scroll', fail.overflow), sec('Pages that failed to load', fail.load),
  sec('Figures that are live counters (reviewed, excused)', info.live), sec('Pages without exactly one visible h1 (information)', info.h1), sec('More small targets than before (information)', info.targets),
  `### Visual differences (gate 5)\n\n| Page | Width | Pixels changed | Height old → new |\n|---|---|---|---|\n` +
  visual.sort((a, b) => b.pct - a.pct).map(v => `| ${v.page} | ${v.width} | ${v.pct}% | ${v.hOld} → ${v.hNew} |`).join('\n') + '\n'].join('\n');
fs.writeFileSync(path.join(DIR, 'REPORT.md'), md);
console.log(hard.length ? `FAIL: ${hard.map(([k, v]) => `${k} ${v.length}`).join(', ')}` : 'PASS', '→', path.join(DIR, 'REPORT.md'));
process.exit(hard.length ? 1 : 0);
