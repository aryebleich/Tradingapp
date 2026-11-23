// One disclaimer, never two (D-FOOT-1). The app's legal links and disclaimer live only in the
// <footer> of public/app.html, and every rule for it in layout.css. The browser check of every page
// (signed in and signed out, on phones) is test/e2e/mobile.mjs; this test catches a copy in the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PUB = path.resolve('public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const MARK = /not a broker or investment adviser/g;
const SITE_DISC = /Backtests and projections are hypothetical, are built with the benefit of hindsight/g;
const files = dir => fs.readdirSync(path.join(PUB, dir)).flatMap(f => {
  const rel = path.join(dir, f);
  return fs.statSync(path.join(PUB, rel)).isDirectory() ? (f === 'i18n' || f === 'vendor' ? [] : files(rel)) : [rel];
});
const sources = files('.').filter(f => /\.(html|js|mjs)$/.test(f) && f !== 'openapi.json');

test('the app disclaimer exists once, in the app.html footer', () => {
  const html = read('app.html');
  assert.equal((html.match(MARK) || []).length, 1, 'app.html holds the disclaimer once');
  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)?.[1] || '';
  assert.match(footer, MARK, 'it is inside the <footer>');
  for (const [href, text] of [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/risk', 'Risk Disclosure'], ['/contact', 'Support']]) {
    assert.ok(footer.includes(`<a href="${href}">${text}</a>`), `the footer links ${text}`);
  }
  assert.match(footer, /id="siteVer"/, 'the footer keeps #siteVer');
  assert.match(footer, /Trading involves risk of loss\. Backtests and projections are hypothetical and do not guarantee future results\./);
  assert.match(html, /only copy of the legal links and the disclaimer/, 'the footer says it is the only copy');
});

test('no other app source repeats the disclaimer or the menu footer', () => {
  const copies = sources.filter(f => f !== 'app.html' && (read(f).match(MARK) || []).length);
  assert.deepEqual(copies, [], 'files holding a second copy of the disclaimer');
  const js = read('app.js');
  assert.doesNotMatch(js, /class="navfoot"/, 'the menu has no footer of its own');
  assert.doesNotMatch(js, /Trading involves risk of loss\. Backtests and projections/, 'app.js does not rebuild the disclaimer');
});

test('every marketing page has its own disclaimer exactly once', () => {
  for (const f of sources.filter(f => f.endsWith('.html') && f !== 'app.html')) {
    const n = (read(f).match(SITE_DISC) || []).length;
    assert.ok(n <= 1, `${f} has ${n} copies of the site disclaimer`);
  }
});

test('the footer rules are in layout.css only (hidden in popouts, clear of the tab bar)', () => {
  for (const f of ['theme.css', 'styles.css']) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /(^|[\s,>}])footer(?![.\w-])/m, `${f} has no rule for the app footer`);
    assert.doesNotMatch(css, /navfoot/, `${f} has no menu footer`);
  }
  const layout = read('layout.css');
  assert.match(layout, /body\.popout > footer \{ display: none !important; \}/);
  assert.match(layout, /footer \{[^}]*env\(safe-area-inset-bottom\)/, 'phones leave room for the tab bar and the safe area');
  assert.match(layout, /body > footer:not\(\.site\) \{ display: none; \}/, 'the marketing site footer is not touched');
});
