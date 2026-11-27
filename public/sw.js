// Repeat visits open at once: code, styles and images come from the cache while a fresh copy
// downloads in the background. Pages and the API use the network. Each deploy has its own build
// number (X-QP-Build on the app page): a new one empties the cache before the page's code loads.
// The installable app (queue row APP-02):
//   - Offline: the app page and the member's watchlists are kept from the last visit, so they open
//     without a connection (marked X-QP-Offline so the page can say "Offline: last saved ...").
//     Signing out empties that copy ('qp-clear-user').
//   - Push: a notification the member turned on (src/webpush.js) is shown; tapping it opens the page.
const CACHE = 'qp-static', OFFLINE = 'qp-offline';
const KEEP_OFFLINE = /^\/api\/alpaca\/watchlists(\/[\w-]+)?$/;
let build = null;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const offlineCopy = async (key, r) => { if (r.ok) await (await caches.open(OFFLINE)).put(key, r.clone()); return r; };
const fromOffline = async key => {
  const hit = await (await caches.open(OFFLINE)).match(key);
  if (!hit) return Response.error();
  const h = new Headers(hit.headers); h.set('X-QP-Offline', '1');
  return new Response(await hit.blob(), { status: hit.status, headers: h });
};
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    const app = u.pathname === '/app' || u.pathname === '/app/';
    e.respondWith(fetch(e.request).then(async r => {
      const b = r.headers.get('X-QP-Build');
      if (b && b !== build) { if (build !== null || !(await (await caches.open(CACHE)).match('/__build/' + b))) await caches.delete(CACHE); build = b; await (await caches.open(CACHE)).put('/__build/' + b, new Response('')); }
      return app ? offlineCopy('/app', r) : r;
    }).catch(() => (app ? fromOffline('/app') : Response.error())));
    return;
  }
  if (KEEP_OFFLINE.test(u.pathname)) {
    e.respondWith(fetch(e.request).then(r => offlineCopy(u.pathname, r)).catch(() => fromOffline(u.pathname)));
    return;
  }
  if (!/\.(js|css|svg|png|webp|woff2?)$/.test(u.pathname) || u.pathname === '/sw.js' || u.pathname === '/config.js') return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  }));
});
self.addEventListener('message', e => { if (e.data === 'qp-clear-user') e.waitUntil(caches.delete(OFFLINE)); });
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Brightolio', { body: d.body || '', icon: '/icon-512.png', badge: '/favicon.svg', data: { url: d.url || '/app' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/app', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(location.origin + '/app'));
    return open ? open.navigate(url).then(c => (c || open).focus()) : self.clients.openWindow(url);
  }));
});
