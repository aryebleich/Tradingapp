// Round trip for translating the site with Yiddish Labs (https://app.yiddishlabs.com/app/quick-action).
//   npm run yiddish:export   writes i18n/yiddish-labs/english.txt, one English string per line
//   (paste it into Yiddish Labs, save the Yiddish result as i18n/yiddish-labs/yiddish.txt, same line order)
//   npm run yiddish:import   writes public/i18n/yi-labs.js (app) and scripts/yi_labs.json (homepage)
// Add --missing to export only strings that have no Yiddish yet.
// Or all at once through the API (needs a key from Yiddish Labs → API Keys):
//   YIDDISH_LABS_API_KEY=yl_live_... npm run yiddish:translate   [--limit N] [--dry]
// Without the API (any plan), in parts sized for the Quick Action box:
//   npm run yiddish:parts          writes i18n/yiddish-labs/parts/part-01.txt, part-02.txt, ...
//   paste each part into Quick Action → "Translate to Yiddish", save the answer as part-01.yi.txt, ...
//   npm run yiddish:import-parts   reads every part-NN.yi.txt there is (partial rounds are fine)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateAll, buildBatch, parseBatch } from './yiddish-labs-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'i18n', 'yiddish-labs');
const [cmd, flag] = process.argv.slice(2);

const app = (await import(pathToFileURL(path.join(root, 'public/i18n/yi.js')))).strings;
const home = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; sys.path.insert(0, "scripts"); from yi_home import YI; print(json.dumps(YI))'], { cwd: root }));
// Each line is one string; strings that contain line breaks cannot make the round trip.
const entries = [...Object.entries(app).map(([en, yi]) => ['app', en, yi]), ...Object.entries(home).map(([en, yi]) => ['home', en, yi])].filter(([, en]) => !/\n/.test(en));

if (cmd === 'export') {
  const list = flag === '--missing' ? entries.filter(([, en, yi]) => !yi || yi === en) : entries;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'english.txt'), list.map(([, en]) => en).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify(list.map(([where, en]) => [where, en]), null, 1));
  console.log(`Wrote ${list.length} lines to i18n/yiddish-labs/english.txt.\nTranslate it at https://app.yiddishlabs.com/app/quick-action and save the result as i18n/yiddish-labs/yiddish.txt (same line order), then run: npm run yiddish:import`);
} else if (cmd === 'import') {
  const keys = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'), 'utf8'));
  const lines = fs.readFileSync(path.join(dir, 'yiddish.txt'), 'utf8').replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  if (lines.length !== keys.length) { console.error(`yiddish.txt has ${lines.length} lines but english.txt has ${keys.length}. Keep one translation per line, in the same order.`); process.exit(1); }
  const out = { app: {}, home: {} };
  keys.forEach(([where, en], i) => { const yi = lines[i].trim(); if (yi) out[where][en] = yi; });
  await save(out.app, out.home);
  console.log(`Imported ${Object.keys(out.app).length} app and ${Object.keys(out.home).length} homepage strings. Rebuild the homepage with: python3 scripts/pages.py`);
} else if (cmd === 'translate' && flag === '--new') {
  // After each push (GitHub Actions): strings that have no Yiddish Labs translation yet, skipping the
  // owner's admin pages (they stay in English) and anything without letters to translate.
  const key = process.env.YIDDISH_LABS_API_KEY, base = process.env.YIDDISH_LABS_URL || 'https://app.yiddishlabs.com';
  if (!key) { console.log('YIDDISH_LABS_API_KEY is not set: nothing to do.'); process.exit(0); }
  const labsApp = (await import(pathToFileURL(path.join(root, 'public/i18n/yi-labs.js')))).default;
  const homeFile = path.join(root, 'scripts/yi_labs.json'), labsHome = fs.existsSync(homeFile) ? JSON.parse(fs.readFileSync(homeFile, 'utf8')) : {};
  const adminOnly = adminStrings();
  const todo = entries.filter(([where, en, yi]) => /[A-Za-z]{2}/.test(en) && yi !== en && !(where === 'app' ? labsApp[en] : labsHome[en]) && !(where === 'app' && adminOnly.has(en)));
  const unique = [...new Set(todo.map(([, en]) => en))];
  console.log(`${unique.length} new strings for Yiddish Labs.`);
  if (!unique.length) process.exit(0);
  const { out, credits, stopped } = await translateAll(unique, { base, key, log: m => console.log(m) });
  const res = { app: {}, home: {} };
  for (const [where, en] of todo) if (out.has(en) && out.get(en) !== en) res[where][en] = out.get(en);
  await save(res.app, res.home);
  console.log(`Translated ${out.size} of ${unique.length} (${credits} credits)${stopped ? '; stopped early: ' + stopped : ''}.`);
} else if (cmd === 'translate') {
  const key = process.env.YIDDISH_LABS_API_KEY, base = process.env.YIDDISH_LABS_URL || 'https://app.yiddishlabs.com';
  const args = process.argv.slice(3), limit = +(args[args.indexOf('--limit') + 1]) || Infinity;
  // Only strings that are translated today; names that stay English (Alpaca, QuantConnect...) are skipped.
  const todo = entries.filter(([, en, yi]) => yi && yi !== en).slice(0, limit);
  const unique = [...new Set(todo.map(([, en]) => en))];
  console.log(`${unique.length} strings to translate (${unique.join('').length.toLocaleString()} characters).`);
  if (args.includes('--dry')) process.exit(0);
  if (!key) { console.error('Set YIDDISH_LABS_API_KEY (Yiddish Labs → API Keys).'); process.exit(1); }
  const { out, credits } = await translateAll(unique, { base, key, log: m => console.log(m) });
  const res = { app: {}, home: {} };
  for (const [where, en] of todo) if (out.has(en) && out.get(en) !== en) res[where][en] = out.get(en);
  await save(res.app, res.home);
  console.log(`Translated ${out.size} of ${unique.length} strings with Yiddish Labs (${credits} credits). Rebuild the homepage with: python3 scripts/pages.py`);
} else if (cmd === 'parts') {
  // Numbered lines ([[1]] ...) with names, tickers and HTML swapped for ⟦n⟧ so they come back unchanged.
  const pdir = path.join(dir, 'parts'), maxChars = 2500;
  fs.rmSync(pdir, { recursive: true, force: true }); fs.mkdirSync(pdir, { recursive: true });
  const todo = entries.filter(([, en, yi]) => yi && yi !== en), unique = [...new Set(todo.map(([, en]) => en))];
  const groups = [[]];
  for (const en of unique) { const g = groups.at(-1); if (g.length && g.join('\n').length + en.length > maxChars) groups.push([en]); else g.push(en); }
  const index = groups.map((g, i) => {
    const { parts, text } = buildBatch(g), name = `part-${String(i + 1).padStart(2, '0')}`;
    fs.writeFileSync(path.join(pdir, name + '.txt'), 'Translate each numbered line to Yiddish. Keep the [[number]] at the start of every line and keep every ⟦n⟧ exactly as it is.\n\n' + text + '\n');
    return { name, strings: g, saved: parts.map(p => p.saved), texts: parts.map(p => p.text) };
  });
  fs.writeFileSync(path.join(pdir, 'index.json'), JSON.stringify({ todo, index }, null, 1));
  console.log(`Wrote ${index.length} parts (${unique.length} strings) to i18n/yiddish-labs/parts/.\nPaste each part-NN.txt into https://app.yiddishlabs.com/app/quick-action, translate to Yiddish, save the answer as part-NN.yi.txt next to it, then run: npm run yiddish:import-parts`);
} else if (cmd === 'import-parts') {
  const pdir = path.join(dir, 'parts'), { todo, index } = JSON.parse(fs.readFileSync(path.join(pdir, 'index.json'), 'utf8'));
  const got = new Map(); let missing = 0, files = 0;
  for (const p of index) {
    const f = path.join(pdir, p.name + '.yi.txt');
    if (!fs.existsSync(f)) continue;
    files++;
    const res = parseBatch(fs.readFileSync(f, 'utf8'), p.texts.map((text, i) => ({ text, saved: p.saved[i] })));
    res.forEach((yi, i) => { if (yi != null) got.set(p.strings[i], yi); else { missing++; console.log(`  ${p.name} line ${i + 1} kept as before: ${p.strings[i].slice(0, 60)}`); } });
  }
  const res = { app: {}, home: {} };
  for (const [where, en] of todo) if (got.has(en) && got.get(en) !== en) res[where][en] = got.get(en); // unchanged English keeps the current Yiddish
  await save(res.app, res.home);
  console.log(`Imported ${got.size} strings from ${files} of ${index.length} parts (${missing} lines kept as before). Rebuild the homepage with: python3 scripts/pages.py`);
} else if (cmd === 'import-json') {
  // A {"English": "Yiddish"} file (e.g. from a Quick Action run). Strings already set by hand in
  // the parts (*.yi.txt) win, and names, tickers and tags must come back exactly as written.
  const file = process.argv[3], got = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = got.ok || got, prev = (await import(pathToFileURL(path.join(root, 'public/i18n/yi-labs.js')) + '?' + Date.now())).default;
  const hand = new Set(); const pdir = path.join(dir, 'parts');
  if (fs.existsSync(path.join(pdir, 'index.json'))) for (const p of JSON.parse(fs.readFileSync(path.join(pdir, 'index.json'), 'utf8')).index) {
    const f = path.join(pdir, p.name + '.yi.txt');
    if (!fs.existsSync(f)) continue;
    parseBatch(fs.readFileSync(f, 'utf8'), p.texts.map((text, i) => ({ text, saved: p.saved[i] }))).forEach((yi, i) => { if (yi != null && yi !== p.strings[i]) hand.add(p.strings[i]); });
  }
  const res = { app: {}, home: {} };
  for (const [where, en] of entries) if (map[en] && map[en] !== en && !hand.has(en)) res[where][en] = map[en];
  await save(res.app, res.home);
  console.log(`Imported ${Object.keys(res.app).length} app and ${Object.keys(res.home).length} homepage strings (${hand.size} set by hand kept). Rebuild the homepage with: python3 scripts/pages.py`);
} else {
  console.log('Usage: node scripts/yiddish-labs.mjs export [--missing] | import | translate [--limit N] [--dry] | parts | import-parts | import-json <file>');
}

// English text of the owner's admin pages, which stay in English.
function adminStrings() {
  const src = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8'), prot = fs.readFileSync(path.join(root, 'public/protect.js'), 'utf8');
  const sections = [src.slice(src.indexOf('async function adminPage'), src.indexOf('\nfor (const [k] of ADMIN_TABS')), prot.slice(prot.indexOf('async function system'))];
  const out = new Set();
  for (const s of sections) for (const m of s.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) for (const piece of m[2].split(/<[^>]+>|\$\{[^}]*\}/)) { const t = piece.trim().replace(/\s+/g, ' '); if (/[A-Za-z]{2}/.test(t)) out.add(t); }
  return out;
}

// Merges into earlier results so a partial round keeps the rest.
async function save(app, home) {
  const appFile = path.join(root, 'public/i18n/yi-labs.js'), homeFile = path.join(root, 'scripts/yi_labs.json');
  const prevApp = (await import(pathToFileURL(appFile) + '?' + Date.now())).default;
  const prevHome = fs.existsSync(homeFile) ? JSON.parse(fs.readFileSync(homeFile, 'utf8')) : {};
  fs.writeFileSync(appFile, `// Translations made with Yiddish Labs (https://app.yiddishlabs.com), written by\n// scripts/yiddish-labs.mjs. They take precedence over the hand-written strings in yi.js.\nexport default ${JSON.stringify({ ...prevApp, ...app }, null, 1)};\n`);
  fs.writeFileSync(homeFile, JSON.stringify({ ...prevHome, ...home }, null, 1) + '\n');
}
