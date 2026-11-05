// The app's own addresses. A sign-in with Google finishes on the address the user started on, so
// the session cookie lands where they are (Render, Oracle, the custom domain), as long as that
// address is one of ours; any other address falls back to PUBLIC_URL.
import { hostingConfig } from './hosting.js';

const hostOf = u => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };
export const publicUrl = () => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

export function ownHosts() {
  const list = [publicUrl(), process.env.RENDER_EXTERNAL_URL, process.env.SITE_DOMAIN && 'https://' + process.env.SITE_DOMAIN,
    ...String(process.env.APP_HOSTS || '').split(',').map(h => h.trim() && (h.includes('://') ? h : 'https://' + h.trim())),
    ...((hostingConfig().servers || []).map(s => s.url))];
  if (process.env.RENDER_EXTERNAL_HOSTNAME) list.push('https://' + process.env.RENDER_EXTERNAL_HOSTNAME);
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
