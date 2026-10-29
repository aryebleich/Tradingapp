// What AI may see and say (Admin → AI & privacy).
//
//  Crawlers  AI companies' crawlers (Gemini, ChatGPT, Claude, Perplexity, Common Crawl...) are blocked
//            by default in robots.txt and with an X-Robots-Tag header; the owner allows each one.
//            Search engines may list the public pages. The app, the API, Admin and webhooks are
//            never open to any crawler.
//  llms.txt  the short public description the owner allows AI tools to use, nothing more.
//  Assistant what the app's own AI assistant may send to its AI provider: personal details (emails,
//            phone numbers, long numbers, keys) are always removed; account figures go only to
//            providers that do not train on what they receive, unless the owner allows it.
import { siteGet, siteSet } from './site.js';

export { CRAWLERS, PRIVATE_PATHS, DEFAULTS } from './crawlers.js';
import { CRAWLERS, DEFAULTS, robotsTxt as robotsFor } from './crawlers.js';
export const robotsTxt = (s = settings()) => robotsFor(s);
export const settings = () => {
  const s = siteGet('aiAccess', {}) || {};
  return { ...DEFAULTS, ...s, allow: { ...DEFAULTS.allow, ...(s.allow || {}) } };
};
export async function saveSettings(b = {}) {
  const cur = settings(), out = { ...cur, allow: { ...cur.allow } };
  if (b.allow) for (const k of Object.keys(CRAWLERS)) if (k in b.allow) out.allow[k] = !!b.allow[k];
  if ('search' in b) out.search = !!b.search;
  if ('llmsOn' in b) out.llmsOn = !!b.llmsOn;
  if ('llms' in b) out.llms = redact(String(b.llms || '')).slice(0, 2000);
  if ('accountData' in b) out.accountData = ['private', 'always', 'never'].includes(b.accountData) ? b.accountData : 'private';
  await siteSet('aiAccess', out);
  return out;
}

// Sent with every page: tells AI tools not to use the content unless the owner allowed AI.
export const xRobots = (s = settings()) => (Object.values(s.allow).some(Boolean) ? null : 'noai, noimageai');
export const llmsTxt = (s = settings()) => (s.llmsOn ? `# Brightfolio\n\n> ${s.llms.replace(/\n+/g, ' ')}\n` : null);

// ---------- what the app's assistant may send ----------
// Emails, phone numbers, long numbers (cards, accounts) and key-like strings never leave the server.
export function redact(text) {
  return String(text ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:sk|rk|pk|rnd|re|ghp|gho|github_pat|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{12,}\b/g, '[key]')
    .replace(/(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g, m => (m.replace(/\D/g, '').length >= 9 ? '[number]' : m));
}
// Account figures (balances, positions) for this provider?
export function mayShareAccount(p) {
  const s = settings();
  if (s.accountData === 'never') return false;
  if (s.accountData === 'always') return true;
  return !!p && !p.free;
}
