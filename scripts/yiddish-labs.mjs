// Round trip for translating the site with Yiddish Labs (https://app.yiddishlabs.com/app/quick-action).
//   npm run yiddish:export   writes i18n/yiddish-labs/english.txt, one English string per line
//   (paste it into Yiddish Labs, save the Yiddish result as i18n/yiddish-labs/yiddish.txt, same line order)
//   npm run yiddish:import   writes public/i18n/yi-labs.js (app) and scripts/yi_labs.json (homepage)
// Add --missing to export only strings that have no Yiddish yet.
// Or all at once through the API (needs a key from Yiddish Labs → API Keys):
//   YIDDISH_LABS_API_KEY=yl_live_... npm run yiddish:translate   [--limit N] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateAll } from './yiddish-labs-lib.mjs';

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
  for (const [where, en] of todo) if (out.has(en)) res[where][en] = out.get(en);
  await save(res.app, res.home);
  console.log(`Translated ${out.size} of ${unique.length} strings with Yiddish Labs (${credits} credits). Rebuild the homepage with: python3 scripts/pages.py`);
} else {
  console.log('Usage: node scripts/yiddish-labs.mjs export [--missing] | import | translate [--limit N] [--dry]');
}

// Merges into earlier results so a partial round keeps the rest.
async function save(app, home) {
  const appFile = path.join(root, 'public/i18n/yi-labs.js'), homeFile = path.join(root, 'scripts/yi_labs.json');
  const prevApp = (await import(pathToFileURL(appFile) + '?' + Date.now())).default;
  const prevHome = fs.existsSync(homeFile) ? JSON.parse(fs.readFileSync(homeFile, 'utf8')) : {};
  fs.writeFileSync(appFile, `// Translations made with Yiddish Labs (https://app.yiddishlabs.com), written by\n// scripts/yiddish-labs.mjs. They take precedence over the hand-written strings in yi.js.\nexport default ${JSON.stringify({ ...prevApp, ...app }, null, 1)};\n`);
  fs.writeFileSync(homeFile, JSON.stringify({ ...prevHome, ...home }, null, 1) + '\n');
}
