// The service worker (public/sw.js), run in a stand-in service-worker scope: the app page and the
// watchlists open offline from the last visit (marked X-QP-Offline), signing out empties that copy,
// other API calls are never cached, and a push becomes a notification that opens the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function scope({ online }) {
  const handlers = {}, stores = new Map(), shown = [];
  const cacheOf = name => { if (!stores.has(name)) stores.set(name, new Map()); const m = stores.get(name);
    return { match: async k => m.get(typeof k === 'string' ? k : new URL(k.url).pathname)?.clone(), put: async (k, r) => m.set(typeof k === 'string' ? k : new URL(k.url).pathname, r) }; };
  const self = {
    addEventListener: (t, f) => (handlers[t] = f), skipWaiting() {}, clients: { claim: async () => {} },
    registration: { showNotification: async (title, o) => shown.push({ title, ...o }) },
  };
  const ctx = vm.createContext({
    self, location: new URL('https://app.example'), URL, Headers, Response, console,
    caches: { open: async n => cacheOf(n), delete: async n => stores.delete(n) },
    fetch: async req => { if (!online.value) throw new TypeError('offline'); const u = new URL(req.url); return new Response(JSON.stringify({ path: u.pathname, at: online.stamp }), { status: 200, headers: { 'X-QP-Build': 'b1' } }); },
  });
  vm.runInContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), ctx);
  const fire = async (path, mode = 'cors') => {
    let p = null;
    handlers.fetch({ request: { url: 'https://app.example' + path, method: 'GET', mode }, respondWith: x => (p = x) });
    return p && (await p);
  };
  return { handlers, stores, shown, fire };
}

test('sw: the app page and watchlists open offline from the last visit, marked offline', async () => {
  const online = { value: true, stamp: 'first' }, s = scope({ online });
  assert.equal((await s.fire('/app', 'navigate')).status, 200);
  const live = await s.fire('/api/alpaca/watchlists');
  assert.equal((await live.json()).at, 'first');
  assert.equal(live.headers.get('X-QP-Offline'), null);
  online.value = false;
  const page = await s.fire('/app', 'navigate');
  assert.equal(page.status, 200); assert.equal(page.headers.get('X-QP-Offline'), '1');
  const lists = await s.fire('/api/alpaca/watchlists');
  assert.equal(lists.headers.get('X-QP-Offline'), '1'); assert.equal((await lists.json()).path, '/api/alpaca/watchlists');
  // Nothing saved yet for this address: a network error, never someone else's data.
  assert.equal((await s.fire('/api/alpaca/watchlists/abc')).type, 'error');
});

test('sw: other API calls are never kept, and signing out empties the offline copy', async () => {
  const online = { value: true, stamp: 'x' }, s = scope({ online });
  assert.equal(await s.fire('/api/alpaca/positions'), null, 'not handled: straight to the network');
  await s.fire('/api/alpaca/watchlists');
  assert.ok(s.stores.has('qp-offline'));
  let wait; s.handlers.message({ data: 'qp-clear-user', waitUntil: p => (wait = p) }); await wait;
  assert.equal(s.stores.has('qp-offline'), false);
});

test('sw: a push becomes a notification; tapping it opens the page it names', async () => {
  const s = scope({ online: { value: true } });
  let wait; s.handlers.push({ data: { json: () => ({ title: 'Brightolio', body: 'AAPL crossed $200', url: '/app#/watchlists' }) }, waitUntil: p => (wait = p) }); await wait;
  assert.deepEqual(s.shown.map(n => [n.title, n.body, n.data.url]), [['Brightolio', 'AAPL crossed $200', '/app#/watchlists']]);
});
