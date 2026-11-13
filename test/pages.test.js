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

test('every page asks for the stylesheet and script of the current version', async () => {
  const { createHash } = await import('node:crypto');
  const v = f => createHash('sha256').update(fs.readFileSync(new URL(`../public/${f}`, import.meta.url))).digest('hex').slice(0, 10);
  for (const page of ['index.html', 'yi.html', 'terms.html']) {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes(`site.css?v=${v('site.css')}`) && html.includes(`site.js?v=${v('site.js')}`), `${page}: run python3 scripts/pages.py after changing site.css or site.js`);
  }
});
