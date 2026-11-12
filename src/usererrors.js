// What a customer may read in an error, and what only the owner should see.
// A customer sees errors about what they typed (a missing field, a wrong symbol, not enough cash).
// Errors about how the site is set up (a missing key, a service that is not configured, a server
// fault) show the customer one plain sentence; the full text goes to Admin → System health.
import { siteGet, siteSet } from './site.js';

export const GENERIC = 'This is not available right now. We have been notified and are looking into it.';
// Names of settings and keys, the admin area, set-up wording, and faults from inside the server.
const SETUP = /\b[A-Z][A-Z0-9]{2,}_(?:[A-Z0-9]+_)*(?:KEY|SECRET|TOKEN|ID|URL|FROM|SID|NUMBER|HOOK|CONFIG)\b|Admin\s*(?:→|->|&rarr;)|\bon (?:this|the) server\b|\bnot (?:set up|configured)\b|\b(?:is|are) not set\b|\bthe owner\b|\benvironment variable|\bRender\b.*\b(?:env|deploy|dashboard)|\bAPI key\b.*\b(?:missing|needed|required|set)\b|\b(?:needs?|requires?) (?:a|an|the) .{0,40}\bkey\b/i;
const INTERNAL = /SQLITE|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|is not a function|is not defined|Cannot read prop|of undefined|of null|Unexpected token|TypeError|ReferenceError|SyntaxError|no such (?:table|column)|at \w+ \(.+:\d+:\d+\)/;

export const isSetupError = (message, status = 400) => SETUP.test(String(message || '')) || (status >= 500 && INTERNAL.test(String(message || ''))) || INTERNAL.test(String(message || ''));

// The owner's list: each distinct message once, with how often and where it last happened.
let issues = null;
const load = () => (issues ||= [...(siteGet('setupIssues', []) || [])]);
let saveTimer = null;
export function noteIssue(message, { path = '', status = 0, user = null } = {}) {
  const list = load(), text = String(message).slice(0, 400), hit = list.find(i => i.message === text);
  if (hit) Object.assign(hit, { count: hit.count + 1, at: Date.now(), path, status, user });
  else { list.unshift({ message: text, count: 1, first: Date.now(), at: Date.now(), path, status, user }); list.length = Math.min(list.length, 60); }
  clearTimeout(saveTimer); saveTimer = setTimeout(() => siteSet('setupIssues', list).catch(() => {}), 3000); saveTimer.unref?.();
}
export const listIssues = () => [...load()].sort((a, b) => b.at - a.at);
export async function clearIssues() { issues = []; await siteSet('setupIssues', []); }

// Express: every JSON error passes here on its way out.
export function filterErrors(req, res, next) {
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && typeof body.error === 'string' && !body.upgrade && isSetupError(body.error, res.statusCode)) {
      noteIssue(body.error, { path: `${req.method} ${req.baseUrl || ''}${req.path}`.slice(0, 120), status: res.statusCode, user: req.user?.id ?? null });
      if (req.user?.role !== 'admin') body = { ...body, error: GENERIC };
    }
    return json(body);
  };
  next();
}
