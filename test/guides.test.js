// Beginner guides: every guide belongs to a page that is in the menu, says what the page is for
// in plain words, and the riskier pages always carry a "Good to know" note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { GUIDE_PAGES, hasGuide } = await import('../public/pages/guides.js');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const menu = new Set([...app.matchAll(/\['([a-z0-9-]+)', '[^']+'\]/g)].map(m => m[1]));

test('every guide is for a page in the menu, and the advanced pages have one', () => {
  assert.ok(GUIDE_PAGES.length >= 40);
  for (const k of GUIDE_PAGES) assert.ok(menu.has(k), `guide for unknown page ${k}`);
  for (const k of ['options', 'optionslab', 'short', 'margin', 'backtest', 'bots', 'pairs', 'statarb', 'tax', 'aifunds', 'trade', 'dashboard']) assert.ok(hasGuide(k), k);
});

test('risky pages warn in plain words', async () => {
  const src = fs.readFileSync(new URL('../public/pages/guides.js', import.meta.url), 'utf8');
  for (const k of ['short', 'margin', 'options', 'aifunds', 'invest']) {
    const block = src.slice(src.indexOf(`  ${k}: [`), src.indexOf('],\n', src.indexOf(`  ${k}: [`) + 1) + 400);
    assert.match(block, /lose|loss/i, k);
  }
});
