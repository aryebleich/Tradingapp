// Keeps the code base clean: every file in the repository must be used by something.
//   - server code (src/) is followed from server.js and the other entry points through every import
//   - app code (public/) is followed from the pages (script tags), app.js and the service worker
//   - pictures, styles and pages in public/ must be referenced somewhere
//   - scripts/ and tests must be run by package.json or a workflow
// Prints every file nothing uses and exits with 1 (CI fails), so old files are deleted instead of
// piling up under the new ones. `node scripts/clean-check.mjs --delete` removes them.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
const exists = f => tracked.includes(f);

// Files that are entry points or configuration on their own.
const KEEP = [/^\.github\//, /^android\//, /^deploy\//, /^\.devcontainer\//, /^security\//, /^edge\//, /^i18n\//, /^README\.md$/, /^[^/]+$/, /^test\/(setup|mock-[\w-]+)\.js$/, /^test\/[\w-]+\.test\.js$/, /^test\/e2e\/run\.mjs$/,
  /^scripts\/yi_more\.json$/];

// Follow imports (static, dynamic, and import('./x' + ...) prefixes) from a set of starting files.
function follow(starts) {
  const seen = new Set(), todo = [...starts];
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f) || !exists(f)) continue; seen.add(f);
    const src = read(f), dir = path.posix.dirname(f);
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"`](\.{1,2}\/[^'"`?$]+)['"`?$]/g)) {
      let dep = path.posix.normalize(path.posix.join(dir, m[1]));
      if (!/\.\w+$/.test(dep)) dep += '.js';
      todo.push(dep);
    }
    // Absolute app paths inside public code ('/pages/x.js', "/chart.js") and server code naming public files.
    for (const m of src.matchAll(/['"`(]\/((?:pages|i18n)\/[\w./-]+\.js|[\w-]+\.(?:js|css|html|png|svg|webp|webmanifest))/g)) todo.push('public/' + m[1]);
    for (const m of src.matchAll(/['"`]((?:src|public|scripts|test)\/[\w./-]+\.(?:js|mjs|py|json|html))/g)) todo.push(m[1]);
    // Pages: <script src="x.js">, <link href="x.css">, <img src="x.png"> (relative or absolute).
    if (f.endsWith('.html')) for (const m of src.matchAll(/(?:src|href|content)=["'](?:https?:\/\/[^"']*?)?\/?([\w./-]+\.(?:js|css|png|svg|webp|webmanifest|ico))["'?]/g)) todo.push(path.posix.normalize(path.posix.join(dir, m[1])));
    // Dynamic imports built from a folder ('./i18n/' + lang + '.js'): everything in that folder counts.
    for (const m of src.matchAll(/import\s*\(\s*['"`](\.{1,2}\/[\w/-]+\/)['"`]\s*\+/g)) { const d = path.posix.normalize(path.posix.join(dir, m[1])); tracked.filter(x => x.startsWith(d)).forEach(x => todo.push(x)); }
  }
  return seen;
}

const pages = tracked.filter(f => /^public\/[\w-]+\.html$/.test(f));
const used = follow(['server.js', ...pages, 'public/app.js', 'public/sw.js', ...tracked.filter(f => /^(test|scripts)\//.test(f)), ...tracked.filter(f => f.startsWith('.github/workflows/'))]);
// Everything named in package.json scripts and the workflows.
const runners = read('package.json') + tracked.filter(f => f.startsWith('.github/workflows/')).map(read).join('\n') + read('Dockerfile') + read('render.yaml');
const named = (f, text) => text.includes(f) || text.includes(path.basename(f));
// Pictures, styles, pages and other public files: named anywhere in the code or pages.
const allText = [...used].filter(f => /\.(js|mjs|html|css|json|webmanifest)$/.test(f)).map(read).join('\n') + runners;

const unused = tracked.filter(f => {
  if (KEEP.some(r => r.test(f))) return false;
  // Python modules are imported by name without the extension (from yi_home import YI).
  if (/\.py$/.test(f)) { const mod = path.basename(f, '.py'); const any = tracked.filter(x => /\.(mjs|js|py|yml)$/.test(x) && x !== f).map(read).join('\n'); return !(any.includes(path.basename(f)) || new RegExp(`(from|import)\\s+${mod}\\b`).test(any)); }
  if (used.has(f)) {
    // A test or script that is followed only because the starting list includes them must also be run.
    if (/^scripts\//.test(f) && !named(f, runners) && ![...used].some(u => u !== f && !/^scripts\//.test(u) && read(u).includes(path.basename(f)))) return true;
    return false;
  }
  if (/^public\//.test(f) && !/\.js$/.test(f)) return !allText.includes(path.basename(f));
  if (/^test\//.test(f)) return !allText.includes(path.basename(f));
  return true;
});

if (process.argv.includes('--delete')) for (const f of unused) fs.rmSync(path.join(root, f));
if (unused.length) { console.log(`${unused.length} file(s) nothing uses:\n` + unused.map(f => '  ' + f).join('\n')); if (!process.argv.includes('--delete')) process.exitCode = 1; }
else console.log('Clean: every file is used.');
