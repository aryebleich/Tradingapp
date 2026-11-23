// Render is no longer an app server (MIGRATION_ORACLE.md): every request gets a 301 to the same
// path on the Oracle server, so old links and bookmarks keep working, and Render has no database
// and runs no jobs, so nothing can run twice.
//
// - render.yaml starts this file directly: `node src/render-redirect.js` (no build, no packages).
// - It is also the first import of server.js: when Render (RENDER is set) starts `node server.js`
//   anyway (a service not managed by render.yaml), the redirect starts here before any other module
//   is evaluated, the database is pointed at a throwaway local file (never a shared one), and server.js does
//   not start the app (REDIRECT_ONLY). RENDER_SERVE_APP=1 turns this off.
// /healthz answers 200 so Render's health check passes; everything else is a 301.
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const TARGET = () => (process.env.REDIRECT_TO || 'https://138-2-233-183.sslip.io').replace(/\/+$/, '');
export function redirectHandler(req, res) {
  const url = req.url || '/';
  if (url === '/healthz' || url.startsWith('/healthz?')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, redirect: TARGET() }));
  }
  // Only the path and query are kept (no host header or other input goes into the address).
  const p = url.startsWith('/') && !url.startsWith('//') ? url : '/';
  res.writeHead(301, { location: TARGET() + p, 'cache-control': 'public, max-age=3600', 'content-type': 'text/plain' });
  res.end('Brightolio moved to ' + TARGET() + p + '\n');
}
export function startRedirect(port = +process.env.PORT || 10000) {
  const s = http.createServer(redirectHandler);
  s.listen(port, () => console.log(`Redirect only: every path → ${TARGET()} (port ${port})`));
  return s;
}

const direct = process.argv[1] === fileURLToPath(import.meta.url);
if (direct) startRedirect();
else if (process.env.RENDER && process.env.RENDER_SERVE_APP !== '1') {
  process.env.REDIRECT_ONLY = '1';
  process.env.STANDBY = '1';
  process.env.MAINTENANCE = '1';
  process.env.DATABASE_URL = '';
  delete process.env.DATABASE_AUTH_TOKEN;
  process.env.DB_FILE = '/tmp/redirect-only.db';
  startRedirect();
}
