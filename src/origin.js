// The app's own addresses. A sign-in with Google finishes on the address the user started on, so
// the session cookie lands where they are, as long as that address is one of ours; any other
// address falls back to PUBLIC_URL.
import { hostingConfig } from './hosting.js';

const hostOf = u => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };
export const publicUrl = () => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
// The site's one address is required in production: payment return links, the Stripe webhook,
// sign-in and every link in an email use it. Without it the server refuses to start with this
// message, instead of sending people to localhost. Returns the message, or null when all is well.
export function missingPublicUrl(env = process.env) {
  if (env.NODE_ENV !== 'production') return null;
  const u = String(env.PUBLIC_URL || '').trim();
  if (!u) return 'PUBLIC_URL is not set. Set it in the server .env to the site address (https://app.brightolio.com), then start again.';
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(u)) return `PUBLIC_URL must be the site's https address (https://app.brightolio.com), not ${u.slice(0, 80)}.`;
  return null;
}

export function ownHosts() {
  const list = [publicUrl(), process.env.SITE_DOMAIN && 'https://' + process.env.SITE_DOMAIN,
    ...String(process.env.APP_HOSTS || '').split(',').map(h => h.trim() && (h.includes('://') ? h : 'https://' + h.trim())),
    ...((hostingConfig().servers || []).map(s => s.url))];
  return [...new Set(list.filter(Boolean).map(hostOf).filter(Boolean))];
}

// The base address for this request when it is one of ours (https, or http on this computer), else null.
export function ownBase(req) {
  const host = String(req.get('host') || '').toLowerCase();
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!local && !ownHosts().includes(host)) return null;
  return `${local ? req.protocol : 'https'}://${host}`;
}
