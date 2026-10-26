// Repeat visits open at once: code, styles and images come from the cache while a fresh copy
// downloads in the background. Pages and the API always use the network. Each deploy has its own
// build number (X-QP-Build on the app page): a new one empties the cache before the page's code loads.
const CACHE = 'qp-static';
let build = null;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(async r => {
      const b = r.headers.get('X-QP-Build');
      if (b && b !== build) { if (build !== null || !(await (await caches.open(CACHE)).match('/__build/' + b))) await caches.delete(CACHE); build = b; await (await caches.open(CACHE)).put('/__build/' + b, new Response('')); }
      return r;
    }));
    return;
  }
  if (!/\.(js|css|svg|png|webp|woff2?)$/.test(u.pathname) || u.pathname === '/sw.js' || u.pathname === '/config.js') return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  }));
});
