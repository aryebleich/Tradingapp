// Language choice (Part A2): detection from the browser, the saved choice, Yiddish is right-to-left,
// and the plain-words English entry exists. The in-place switch itself is covered by the browser suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function setNav(languages) {
  Object.defineProperty(globalThis, 'navigator', { value: { languages, language: languages[0] }, configurable: true });
}

test('the browser language is pre-selected when the app has it; Yiddish code "ji" maps to Yiddish', async () => {
  const { detect } = await import('../public/i18n.js');
  setNav(['ji-US', 'en']); assert.equal(detect(), 'yi');
  setNav(['fr-CA']); assert.equal(detect(), 'fr');
  setNav(['xx-YY', 'de']); assert.equal(detect(), 'de');
  setNav(['xx-YY']); assert.equal(detect(), 'en', 'an unsupported language falls back to English');
  setNav(['en-plain']); assert.equal(detect(), 'en', 'the plain-words option is never chosen by detection');
});

test('Yiddish is right-to-left; English and plain English are left-to-right; plain English is offered', async () => {
  const { LANGS } = await import('../public/i18n.js');
  assert.equal(LANGS.yi.dir, 'rtl');
  assert.equal(LANGS.en.dir, 'ltr');
  assert.equal(LANGS['en-plain'].dir, 'ltr');
  assert.equal(LANGS['en-plain'].plain, true);
  assert.equal(typeof LANGS.yi.load, 'function');
});

test('the account only accepts languages the app has', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/settings.js', import.meta.url), 'utf8');
  const m = src.match(/const LANG_CODES = (\[[^\]]*\])/);
  assert.ok(m, 'LANG_CODES is defined');
  const codes = JSON.parse(m[1].replace(/'/g, '"'));
  const { LANGS } = await import('../public/i18n.js');
  assert.deepEqual(codes.filter(c => !LANGS[c]), [], 'every saved code is a language the app has');
  assert.deepEqual(Object.keys(LANGS).filter(c => !codes.includes(c)), [], 'every language the app has can be saved');
});
