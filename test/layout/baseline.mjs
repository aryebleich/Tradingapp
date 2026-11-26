// Writes the page gate's golden baseline (test/golden/layout-baseline.json) from a run of run.mjs.
// Only after the differences against the old baseline are reviewed, so a lost disclosure is restored
// instead of being written into the baseline: run the gate, read its REPORT.md, fix what is wrong,
// record what changed on purpose in DECISIONS.md, then:
//   node test/layout/run.mjs --out DIR && node test/layout/baseline.mjs DIR "why, in a few words"
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [dir, why] = process.argv.slice(2);
if (!dir || !why) { console.error('usage: node test/layout/baseline.mjs DIR "why"'); process.exit(2); }
const cur = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'));
const failed = cur.pages.filter(pg => cur.widths.some(w => !cur.results[pg.id]?.[w]?.new || cur.results[pg.id][w].new.failed)).map(pg => pg.id);
if (failed.length) { console.error('Pages that failed to load (not written): ' + failed.join(', ')); process.exit(1); }
let sha = 'unknown'; try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const golden = {
  note: `Every page at ${cur.widths.join('/')}px measured on commit ${sha} with test/layout/run.mjs (browser date fixed to the gate's FIXED_DAY). ${why}. test/layout/compare.mjs checks the current site against it. Regenerate only after reviewing the differences (test/layout/baseline.mjs).`,
  at: cur.at, widths: cur.widths, pages: cur.pages,
  results: Object.fromEntries(cur.pages.map(pg => [pg.id, Object.fromEntries(cur.widths.map(w => [w, { old: cur.results[pg.id][w].new }]))])),
};
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../golden/layout-baseline.json');
fs.writeFileSync(out, JSON.stringify(golden));
console.log(`wrote ${path.relative(process.cwd(), out)}: ${cur.pages.length} pages × ${cur.widths.length} widths`);
