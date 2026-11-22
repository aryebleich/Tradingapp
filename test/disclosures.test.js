// Designed so it needs no new legal review: the growth, OFI and live-pairs features use only the
// disclosure wording that is already reviewed (public/disclosures.js: the trading tools' sentence and
// the footer's), they trade the practice account only, and they suggest no products.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOOL, HYPOTHETICAL, TOOL_HYPOTHETICAL } from '../public/disclosures.js';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the wording is the reviewed one, word for word', () => {
  // The trading tools' sentence (COMPLIANCE_REVIEW.md) is in the reviewed tools' code, and the footer's sentence in the app.
  assert.ok(read('src/tradetools/routes.js').includes(TOOL), 'TOOL comes from the reviewed trading tools');
  assert.ok(read('public/app.js').includes('Backtests and projections are hypothetical.'), 'HYPOTHETICAL is the footer\'s');
  assert.equal(TOOL_HYPOTHETICAL, `${TOOL} ${HYPOTHETICAL}`);
});

test('every new feature uses the shared wording, and none writes its own disclaimer', async () => {
  for (const [f, k] of [['src/newspicks.js', 'NOT_ADVICE'], ['src/intraday.js', 'NOT_ADVICE'], ['src/pairslive.js', 'NOTE'], ['src/diversify.js', 'NOTE'], ['src/stock.js', 'NOT_ADVICE'], ['src/hfofi.js', 'NOTE']]) {
    const m = await import('../' + f); assert.ok([TOOL, TOOL_HYPOTHETICAL].includes(m[k]), `${f} ${k}`);
  }
  const NEW = ['src/newspicks.js', 'src/intraday.js', 'src/pairslive.js', 'src/pairslive-math.js', 'src/diversify.js', 'src/income.js', 'src/active.js', 'src/hfofilab.js', 'public/hfofi.js', 'public/pages/growth.js', 'public/pages/ofilab.js', 'public/pages/guides-more.js'];
  for (const f of NEW) {
    const code = read(f).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /not investment advice|not advice|not a recommendation|not a prediction|guaranteed|risk-free|AI picks|AI morning picks|AI intraday/i, f);
  }
});

test('no real-money path in the new automated features; what-if previews name no product', async () => {
  for (const f of ['src/newspicks.js', 'src/intraday.js']) { const { cleanSettings } = await import('../' + f); assert.equal(cleanSettings({ account: 'alpaca', live: true }).account, 'paper', f); }
  assert.match(read('src/pairslive.js'), /r\.post\('\/:id\/live', wrap\(async \(\) => \{ throw bad\('Live-ratio bots run on the practice account only/);
  const { suggestions, score } = await import('../src/diversify.js');
  const h = [{ symbol: 'NVDA', value: 9000, sector: 'Technology', region: 'United States', type: 'Stocks' }, { symbol: 'AAPL', value: 1000, sector: 'Technology', region: 'United States', type: 'Stocks' }];
  for (const s of suggestions(h, score(h))) { assert.match(s.title, /^What if/); assert.match(s.buy.symbol, /^_|^(NVDA|AAPL)$/); }
});

test('the OFI project needs no data licence: the bundled synthetic sample is the default', () => {
  assert.match(read('research/hf-ofi/hf.Rmd'), /data: "data\/sample\.Rds"/);
  assert.doesNotMatch(read('research/hf-ofi/data/README.md') + read('research/hf-ofi/README.md'), /licensed|df_rb2305_am1/);
});
