// Yiddish Labs batch translation: placeholders survive, bad lines are retried or rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protect, restore, buildBatch, parseBatch, translateAll } from '../scripts/yiddish-labs-lib.mjs';

test('protects HTML, entities, brands and tickers', () => {
  const p = protect('<b>Auto-throttle:</b> buy TQQQ on Alpaca &amp; Brightfolio, see quantconnect.com');
  assert.equal(p.text, '⟦0⟧Auto-throttle:⟦1⟧ buy ⟦2⟧ on ⟦3⟧ ⟦4⟧ ⟦5⟧, see ⟦6⟧');
  assert.equal(restore('⟦0⟧אויטא:⟦1⟧ קויפט ⟦2⟧ אויף ⟦3⟧ ⟦4⟧ ⟦5⟧, זעט ⟦6⟧', p.saved), '<b>אויטא:</b> קויפט TQQQ אויף Alpaca &amp; Brightfolio, זעט quantconnect.com');
  assert.equal(restore('⟦0⟧ only one', p.saved), null); // placeholders lost
});

test('parses numbered batches, rejects untranslated lines', () => {
  const short = buildBatch(['Buy', 'or']);
  assert.deepEqual(parseBatch('[[1]] Buy\n[[2]] אדער', short.parts), [null, 'אדער']); // short lines left in English are rejected too
  const { parts, text } = buildBatch(['Open a brokerage account', 'Sell **all** of SPY', 'Settings']);
  assert.match(text, /^\[\[1\]\] Open a brokerage account\n\[\[2\]\] Sell \*\*all\*\* of ⟦0⟧\n\[\[3\]\] Settings$/);
  const got = parseBatch('[[1]] עפנט א בראוקער קאנטע\n[[2]] פארקויפט **אלעס** פון ⟦0⟧\n[[3]] Settings', parts);
  assert.deepEqual(got, ['עפנט א בראוקער קאנטע', 'פארקויפט אלעס פון SPY', null]);
});

test('translateAll retries lines a batch dropped and reports credits', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    assert.equal(opts.headers['X-API-KEY'], 'yl_live_test'); assert.equal(body.action, 'translate-yiddish'); assert.match(url, /\/api\/v1\/process\/text$/);
    const lines = body.text_content.split('\n');
    // The batch reply loses its second line; single retries answer properly.
    const reply = lines.filter((_, i) => lines.length === 1 || i !== 1).map(l => l.replace(/\] .*/, '] יידיש ' + (l.match(/⟦\d+⟧/g) || []).join(' '))).join('\n');
    return { ok: true, status: 200, json: async () => ({ text: reply, credits_consumed: 2 }) };
  };
  const { out, credits } = await translateAll(['Trade AAPL', 'Orders', 'Positions'], { base: 'https://x', key: 'yl_live_test', fetchImpl });
  assert.equal(calls.length, 2);
  assert.deepEqual([...out], [['Trade AAPL', 'יידיש AAPL'], ['Orders', 'יידיש'], ['Positions', 'יידיש']]);
  assert.equal(credits, 4);
});
