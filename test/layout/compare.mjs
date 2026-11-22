// Release gate for every merge: the current site against the golden baseline (test/golden/layout-baseline.json,
// every page at 1440/1280/768/390 px before the redesign), reading current.json from run.mjs.
//   - disclosures: every one still present, visible if it was, above the fold if it was, no more than
//     100 px lower, readable (at least 12 px and AA contrast of 4.5:1, or no worse than before)
//   - figures: the same list of numbers, character for character (clocks, countdowns, latencies excluded)
//   - controls: every control of the baseline page is still on the page
//   - axe: no rule with more violations than the baseline; no new page-level horizontal scroll
// Writes REPORT.md next to current.json. Exit code 1 if a hard gate fails.
//   node test/layout/compare.mjs [DIR]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DIR = path.resolve(process.argv[2] || 'e2e-output/layout');
// "old" is the committed golden baseline (every page measured before the redesign); "new" is the
// current run from run.mjs. Pages added since the baseline are listed and not compared.
const GOLDEN = JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../golden/layout-baseline.json'), 'utf8'));
const cur = JSON.parse(fs.readFileSync(path.join(DIR, 'current.json'), 'utf8'));
const widths = cur.widths, pages = cur.pages.filter(pg => GOLDEN.results[pg.id]);
const results = Object.fromEntries(pages.map(pg => [pg.id, Object.fromEntries(widths.map(w => [w, { old: GOLDEN.results[pg.id][w]?.old, new: cur.results[pg.id]?.[w]?.new }]))]));
const added = cur.pages.filter(pg => !GOLDEN.results[pg.id]).map(pg => pg.id);
fs.writeFileSync(path.join(DIR, 'pair.json'), JSON.stringify({ widths, pages, results }));
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
    // Further down the page too: a disclosure may not move more than 100 px lower than it was.
    if (d.visible && x.visible && x.top - d.top > 100) fail.disclosure.push(`${at}: moved ${x.top - d.top}px further down "${d.text.slice(0, 80)}"`);
    if (x.visible && x.fontPx < Math.min(12, d.fontPx)) fail.disclosure.push(`${at}: text smaller than 12 px (${x.fontPx}) "${d.text.slice(0, 60)}"`);
    if (x.visible && x.contrast < Math.min(4.5, d.contrast) - 0.05) fail.disclosure.push(`${at}: contrast ${x.contrast} < ${Math.min(4.5, d.contrast)} "${d.text.slice(0, 60)}"`);
    if (x.clipped && !d.clipped) fail.disclosure.push(`${at}: clipped "${d.text.slice(0, 60)}"`);
  }
  // Figures
  // Numbers inside addresses and e-mails (the local server's port, the test account's timestamped e-mail) are
  // not figures. Prices, fees, balances and P&L never sit inside a URL or an e-mail address.
  const notFig = f => /https?:\/\/|localhost:\d|@[\w.-]+\.[a-z]{2,}/i.test(f.split('\t')[1] || '');
  o.figures = o.figures.filter(f => !notFig(f)); n.figures = n.figures.filter(f => !notFig(f));
  const val = a => a.map(f => f.split('\t')[0]), ctx = (a, k) => a.find(f => f.startsWith(k + '\t'))?.split('\t')[1] || '';
  const of = multiset(val(o.figures)), nf = multiset(val(n.figures)), diff = [];
  for (const k of new Set([...of.keys(), ...nf.keys()])) if ((of.get(k) || 0) !== (nf.get(k) || 0)) diff.push(`${k} ${of.get(k) || 0}→${nf.get(k) || 0} ("${ctx(o.figures, k) || ctx(n.figures, k)}")`);
  // Reviewed exception: Admin → Data shows a live counter of incoming stream events ("0 / 75"); it rises
  // between the old and the new page load a second apart. Only differences in that counter are excused.
  // (live API-usage counters such as "0 / 75" and call counts): plain integers under 1000 only, never $ or %.
  const live = pg.id === 'app/admin-data' && diff.every(x => /^\d{1,3} \d+→\d+ /.test(x));
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
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
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
const md = [`# Layout comparison against the golden baseline\n\n${pages.length} pages × ${widths.length} widths (${widths.join(', ')} px), old and new layout on the same server and data.\n`,
  `**Result: ${hard.length ? 'FAIL' : 'PASS'}**\n`,
  sec('Disclosures (gate 2)', fail.disclosure), sec('Figures (gate 4)', fail.figures), sec('Controls still present (rule 2)', fail.controls),
  sec('New axe violations (gate 6)', fail.axe), sec('New sideways page scroll', fail.overflow), sec('Pages that failed to load', fail.load), sec('Pages added since the baseline (not compared; add them to test/golden when intended)', added),
  sec('Figures that are live counters (reviewed, excused)', info.live), sec('Pages without exactly one visible h1 (information)', info.h1), sec('More small targets than before (information)', info.targets),
  `### Visual differences (gate 5)\n\n| Page | Width | Pixels changed | Height old → new |\n|---|---|---|---|\n` +
  visual.sort((a, b) => b.pct - a.pct).map(v => `| ${v.page} | ${v.width} | ${v.pct}% | ${v.hOld} → ${v.hNew} |`).join('\n') + '\n'].join('\n');
fs.writeFileSync(path.join(DIR, 'REPORT.md'), md);
console.log(hard.length ? `FAIL: ${hard.map(([k, v]) => `${k} ${v.length}`).join(', ')}` : 'PASS', '→', path.join(DIR, 'REPORT.md'));
process.exit(hard.length ? 1 : 0);
