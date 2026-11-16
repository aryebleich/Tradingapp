// Feature flags: every new feature from the website audit ships switched off. The owner turns each
// one on in Admin → SEO → Feature flags, for a percentage of visitors (0 to 100), and can switch it
// off again at once. A visitor's bucket (0..99) comes from a random cookie with no personal data,
// so the same visitor keeps the same variant.
import crypto from 'node:crypto';
import { siteGet, siteSet } from './site.js';

export const FLAGS = {
  home_v2: 'New homepage: audited section order, one main hero button, a risk link beside each sign-up, and a Trust & compliance block',
  ai_team_chat: 'Admin → AI team: the Chat job (streaming conversation with thinking). Admins with the AI team chat permission only.',
};
const clampPct = v => Math.min(100, Math.max(0, Math.round(+v || 0)));
export function flagSettings() {
  const s = siteGet('flags', {}) || {};
  return Object.fromEntries(Object.keys(FLAGS).map(k => [k, { on: s[k]?.on === true, pct: s[k] ? clampPct(s[k].pct ?? 100) : 0, about: FLAGS[k] }]));
}
export async function saveFlags(b = {}) {
  const cur = siteGet('flags', {}) || {}, next = { ...cur };
  for (const k of Object.keys(FLAGS)) if (b[k]) next[k] = { on: !!b[k].on, pct: clampPct(b[k].pct ?? cur[k]?.pct ?? 100) };
  await siteSet('flags', next);
  return flagSettings();
}
// The same bucket for the same visitor and flag; different flags spread independently.
export const bucketOf = (visitorId, flag) => parseInt(crypto.createHash('sha256').update(`${flag}|${visitorId}`).digest('hex').slice(0, 8), 16) % 100;
export function isOn(flag, visitorId) {
  const f = flagSettings()[flag];
  if (!f || !f.on) return false;
  return bucketOf(String(visitorId || ''), flag) < f.pct;
}
// The visitor's random id from the "qp_vb" cookie (set when missing).
export function visitorId(req, res) {
  const m = /(?:^|;\s*)qp_vb=([a-f0-9]{16})/.exec(req.headers.cookie || '');
  if (m) return m[1];
  const id = crypto.randomBytes(8).toString('hex');
  res?.append?.('Set-Cookie', `qp_vb=${id}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
  return id;
}
