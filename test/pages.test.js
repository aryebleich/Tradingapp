// The GitHub Pages build copies every file its published pages link to (no 404s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('every local link on the published pages is copied by the Pages build', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const line = /cp ((?:[\w.-]+ )+)\.\.\/_site\//.exec(wf)[1].trim().split(/\s+/);
  const made = new Set([...line, 'config.js', 'engine.js', 'robots.txt', 'sitemap.xml', 'llms.txt']);
  const missing = [];
  for (const page of line.filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    for (const [, ref] of html.matchAll(/(?:href|src)="(?![a-z]+:)([^"#?]+)/g)) {
      if (ref.startsWith('//') || /^\/?app\/?$/.test(ref)) continue;
      const p = ref.replace(/^\//, '') || 'index.html';
      // Folders copied whole (cp -r fonts ../_site/fonts): the file must exist in public/.
      const dir = p.includes('/') && new RegExp(`cp -r ${p.split('/')[0]} \\.\\./_site/`).test(wf) && fs.existsSync(new URL(`../public/${p}`, import.meta.url));
      const ok = dir || made.has(p) || (!/\.\w+$/.test(p) && made.has(p + '.html'));
      if (!ok) missing.push(`${page} → ${ref}`);
    }
  }
  assert.deepEqual(missing, []);
});
