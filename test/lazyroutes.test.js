// Page files load on demand (lazyRoutes in public/app.js). This keeps the list of pages each lazy
// file serves in step with the pages that file really registers, so no page is left unreachable
// and no static import of a lazy file sneaks back into the app's first download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PUB = fileURLToPath(new URL('../public/', import.meta.url));
const app = fs.readFileSync(PUB + 'app.js', 'utf8');
const calls = [...app.matchAll(/lazyRoutes\(\(\) => import\('\.\/([^']+)'\), '(\w+)', .*, (\[[^\]]*\])\);$/gm)]
  .map(m => ({ file: m[1], fn: m[2], keys: JSON.parse(m[3]) }));

// A stand-in browser: anything touched while a page file registers its pages does nothing.
const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub), apply: () => stub, construct: () => stub, set: () => true });
for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'matchMedia', 'requestAnimationFrame', 'addEventListener', 'removeEventListener', 'getComputedStyle', 'customElements', 'HTMLElement', 'Element', 'Node', 'CSS', 'speechSynthesis', 'Image', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver'])
  if (!(k in globalThis)) Object.defineProperty(globalThis, k, { value: stub, configurable: true, writable: true });

test('the app loads page files on demand', () => {
  assert.ok(calls.length >= 20, 'lazy page files found: ' + calls.length);
  for (const { file } of calls) assert.ok(!new RegExp(`^import .* from '\\./${file.replace(/[.]/g, '\\.')}';`, 'm').test(app), file + ' is also imported up front');
});

test('each lazy file lists exactly the pages it registers', async () => {
  for (const { file, fn, keys } of calls) {
    const m = await import(pathToFileURL(PUB + file).href);
    assert.equal(typeof m[fn], 'function', `${file} exports ${fn}`);
    const got = {}; m[fn](got, stub);
    assert.deepEqual(Object.keys(got).sort(), [...keys].sort(), file);
  }
});
