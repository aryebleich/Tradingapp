// Search visibility (Admin → SEO): Google, Bing and AI search (ChatGPT, Claude, Perplexity...).
//   Each public page gets the owner's title and description, a canonical address, hreflang links
//   between English and Yiddish, Open Graph and Twitter tags, and structured data (JSON-LD:
//   Organization, WebSite, SoftwareApplication with the plans' prices, FAQPage from the homepage
//   questions). Verification tags for Google Search Console and Bing Webmaster Tools.
//   sitemap.xml with last-modified dates and language alternates; llms.txt for AI tools; IndexNow
//   (Bing, Yandex and others) to announce changed pages at once.
//   An audit scores every page against current best practice and says what to fix.
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteGet, siteSet } from './site.js';
import { requireUser, requireAdmin } from './auth.js';
import { audit as auditLog } from './db.js';
import { randomToken } from './crypto.js';
import { PLANS } from './fees.js';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
export const PAGES = [
  { key: 'index', path: '/', file: 'index.html', lang: 'en', name: 'Homepage', priority: 1.0, alt: 'yi' },
  { key: 'yi', path: '/yi', file: 'yi.html', lang: 'yi', name: 'Homepage (Yiddish)', priority: 0.9, alt: 'index' },
  { key: 'status', path: '/status', file: 'status.html', lang: 'en', name: 'Status', priority: 0.4 },
  { key: 'security', path: '/security', file: 'security.html', lang: 'en', name: 'Security', priority: 0.6 },
  { key: 'insurance', path: '/insurance', file: 'insurance.html', lang: 'en', name: 'Insurance', priority: 0.5 },
  { key: 'contact', path: '/contact', file: 'contact.html', lang: 'en', name: 'Contact', priority: 0.5 },
  { key: 'terms', path: '/terms', file: 'terms.html', lang: 'en', name: 'Terms', priority: 0.3 },
  { key: 'privacy', path: '/privacy', file: 'privacy.html', lang: 'en', name: 'Privacy', priority: 0.3 },
  { key: 'risk', path: '/risk', file: 'risk.html', lang: 'en', name: 'Risk Disclosure', priority: 0.3 },
];
export const DEFAULTS = { pages: {}, google: '', bing: '', yandex: '', twitter: '', sameAs: [], orgName: 'Brightolio', faq: true, indexnowKey: '', lastPing: null };
export const settings = () => ({ ...DEFAULTS, ...(siteGet('seo', {}) || {}) });
export const base = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export async function saveSettings(b = {}) {
  const cur = settings(), out = { ...cur, pages: { ...cur.pages } };
  if (b.pages) for (const p of PAGES) if (b.pages[p.key]) {
    const v = b.pages[p.key];
    out.pages[p.key] = { title: String(v.title || '').replace(/\s+/g, ' ').trim().slice(0, 120), description: String(v.description || '').replace(/\s+/g, ' ').trim().slice(0, 320), noindex: !!v.noindex };
  }
  const code = v => String(v || '').trim().replace(/^.*content="([^"]+)".*$/s, '$1').replace(/[^\w\-.=]/g, '').slice(0, 120);
  for (const k of ['google', 'bing', 'yandex']) if (k in b) out[k] = code(b[k]);
  if ('twitter' in b) out.twitter = String(b.twitter || '').trim().replace(/^@?/, b.twitter ? '@' : '').replace(/[^@\w]/g, '').slice(0, 30);
  if ('orgName' in b) out.orgName = String(b.orgName || 'Brightolio').trim().slice(0, 60) || 'Brightolio';
  if ('faq' in b) out.faq = !!b.faq;
  if ('sameAs' in b) {
    const list = (Array.isArray(b.sameAs) ? b.sameAs : String(b.sameAs || '').split(/[\s,]+/)).map(x => String(x).trim()).filter(Boolean).slice(0, 12);
    const wrong = list.find(u => !/^https:\/\/[^\s/]+\.[^\s]+$/.test(u));
    if (wrong) throw bad(`"${wrong}" is not a full https:// address`);
    out.sameAs = list;
  }
  if (!out.indexnowKey) out.indexnowKey = randomToken(24).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  await siteSet('seo', out);
  return out;
}
export async function indexnowKey() { const s = settings(); return s.indexnowKey || (await saveSettings({})).indexnowKey; }

// Questions and answers from the homepage's FAQ (<details><summary>Q</summary><p>A</p>).
export const faqFrom = html => [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map(m => ({ q: strip(m[1]), a: strip(m[2]) })).filter(x => x.q && x.a).slice(0, 20);

export function jsonLd(page, html, s = settings(), b = base()) {
  const org = { '@type': 'Organization', '@id': `${b}/#org`, name: s.orgName, url: `${b}/`, logo: `${b}/icon-512.png`, ...(s.sameAs.length ? { sameAs: s.sameAs } : {}) };
  const graph = [org, { '@type': 'WebSite', '@id': `${b}/#site`, url: `${b}/`, name: s.orgName, inLanguage: ['en', 'yi'], publisher: { '@id': `${b}/#org` } }];
  if (page.key === 'index' || page.key === 'yi') {
    graph.push({ '@type': 'SoftwareApplication', name: s.orgName, applicationCategory: 'FinanceApplication', operatingSystem: 'Web, Android', url: `${b}/`, publisher: { '@id': `${b}/#org` },
      offers: Object.entries(PLANS).map(([, p]) => ({ '@type': 'Offer', name: p.name, price: String(p.monthly), priceCurrency: 'USD', ...(p.monthly ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: String(p.monthly), priceCurrency: 'USD', billingDuration: 'P1M' } } : {}) })) });
    const faq = s.faq ? faqFrom(html) : [];
    if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  } else graph.push({ '@type': 'WebPage', url: `${b}${page.path}`, name: titleOf(html), isPartOf: { '@id': `${b}/#site` } });
  return { '@context': 'https://schema.org', '@graph': graph };
}
const titleOf = html => strip(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] || '');
const descOf = html => /<meta name="description" content="([^"]*)"/.exec(html)?.[1] || '';

// The page as served: the owner's title and description, and every tag search engines read.
export function transform(html, key, s = settings(), b = base()) {
  const page = PAGES.find(p => p.key === key); if (!page) return html;
  const o = s.pages[key] || {};
  let out = html;
  if (o.title) out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(o.title)}</title>`).replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(o.title)}$2`);
  if (o.description) out = out.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(o.description)}$2`).replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(o.description)}$2`);
  if (!b) return out;
  const url = `${b}${page.path}`, title = o.title || titleOf(out), desc = o.description || descOf(out);
  // Language versions point to each other with full addresses, and x-default to English.
  out = out.replace(/<link rel="alternate" hreflang="[^"]+" href="[^"]*">\s*/g, '');
  const tags = [
    `<link rel="canonical" href="${esc(url)}">`,
    ...(page.alt || page.key === 'index' ? [`<link rel="alternate" hreflang="en" href="${esc(b)}/">`, `<link rel="alternate" hreflang="yi" href="${esc(b)}/yi">`, `<link rel="alternate" hreflang="x-default" href="${esc(b)}/">`] : []),
    `<meta property="og:url" content="${esc(url)}">`, `<meta property="og:site_name" content="${esc(s.orgName)}">`, `<meta property="og:locale" content="${page.lang === 'yi' ? 'yi_US' : 'en_US'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(desc)}">`, `<meta name="twitter:image" content="${esc(b)}/og.png">`,
    ...(s.twitter ? [`<meta name="twitter:site" content="${esc(s.twitter)}">`] : []),
    ...(s.google ? [`<meta name="google-site-verification" content="${esc(s.google)}">`] : []),
    ...(s.bing ? [`<meta name="msvalidate.01" content="${esc(s.bing)}">`] : []),
    ...(s.yandex ? [`<meta name="yandex-verification" content="${esc(s.yandex)}">`] : []),
    `<meta name="robots" content="${o.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1'}">`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd(page, out, s, b)).replace(/</g, '\\u003c')}</script>`,
  ];
  out = out.replace(/<link rel="canonical"[^>]*>\s*/g, '').replace(/<meta name="robots"[^>]*>\s*/g, '');
  return out.replace('</head>', `  ${tags.join('\n  ')}\n</head>`);
}

export async function sitemap(b = base(), s = settings()) {
  const rows = [];
  for (const p of PAGES) {
    if (s.pages[p.key]?.noindex) continue;
    const st = await fs.stat(path.join(PUB, p.file)).catch(() => null);
    const alts = p.alt || p.key === 'index' ? `<xhtml:link rel="alternate" hreflang="en" href="${b}/"/><xhtml:link rel="alternate" hreflang="yi" href="${b}/yi"/><xhtml:link rel="alternate" hreflang="x-default" href="${b}/"/>` : '';
    rows.push(`<url><loc>${b}${p.path}</loc>${st ? `<lastmod>${st.mtime.toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${p.priority.toFixed(1)}</priority>${alts}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${rows.join('')}</urlset>\n`;
}
// llms.txt: a short, accurate description and the pages that matter, for AI tools.
export function llms(text, s = settings(), b = base()) {
  return `# ${s.orgName}\n\n> ${String(text || '').replace(/\n+/g, ' ')}\n\n## Pages\n${PAGES.filter(p => !s.pages[p.key]?.noindex).map(p => `- [${p.name}](${b}${p.path})`).join('\n')}\n`;
}

// ---------- the audit ----------
export async function auditSite(s = settings(), ai = null, b = base()) {
  const checks = [], add = (ok, title, fix, where = 'Site', weight = 1) => checks.push({ ok: !!ok, title, fix: ok ? '' : fix, where, weight });
  const pages = [];
  for (const p of PAGES) {
    const raw = await fs.readFile(path.join(PUB, p.file), 'utf8').catch(() => '');
    const html = transform(raw, p.key, s, b || 'https://example.com'), t = titleOf(html), d = descOf(html), text = strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''));
    const h1 = (html.match(/<h1[\s>]/g) || []).length, imgs = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]), noAlt = imgs.filter(i => !/\balt="/.test(i)).length;
    const words = text.split(' ').length;
    pages.push({ key: p.key, name: p.name, path: p.path, title: t, description: d, noindex: !!s.pages[p.key]?.noindex, words });
    add(t.length >= 30 && t.length <= 60, `Title is 30-60 characters (${t.length})`, t.length < 30 ? 'Make the title longer: name what the page offers and the brand.' : 'Shorten the title so Google shows it whole (about 60 characters).', p.name);
    add(d.length >= 70 && d.length <= 160, `Description is 70-160 characters (${d.length})`, d.length < 70 ? 'Write a fuller description: what the visitor gets, in one or two sentences.' : 'Shorten the description to about 155 characters so it is not cut off.', p.name);
    add(h1 === 1, `One main heading (h1) (${h1})`, 'Each page should have exactly one h1 that says what the page is about.', p.name);
    add(noAlt === 0, `Images have alt text (${imgs.length - noAlt}/${imgs.length})`, 'Describe each image in its alt text (screen readers and image search use it).', p.name);
    if (p.key === 'index' || p.key === 'yi') add(words >= 300, `Enough text to rank (${words} words)`, 'Pages with useful, specific text rank better: add answers to the questions customers ask.', p.name);
  }
  const titles = pages.map(p => p.title);
  add(new Set(titles).size === titles.length, 'Every page has its own title', 'Two pages share a title; give each one a title that says what is different about it.');
  const descs = pages.map(p => p.description);
  add(new Set(descs).size === descs.length, 'Every page has its own description', 'Two pages share a description; write one per page.');
  add(/^https:\/\//.test(b), 'The site address (PUBLIC_URL) is set and uses https', 'Set PUBLIC_URL (Admin → Keys) to the https address people use, so canonical links and the sitemap are right.', 'Site', 2);
  add(!!s.google, 'Google Search Console is verified', 'Add the site in Google Search Console (URL-prefix), choose "HTML tag", and paste its content code below. Then submit the sitemap there.', 'Site', 2);
  add(!!s.bing, 'Bing Webmaster Tools is verified', 'Add the site in Bing Webmaster Tools (it also feeds ChatGPT search, DuckDuckGo and Yahoo), choose the meta tag, and paste its code below.', 'Site', 2);
  if (ai) {
    add(ai.search !== false, 'Search engines may list the public pages', 'Turn on "Search engines may list the public pages" (AI & privacy).', 'Site', 3);
    add(ai.aiSearch !== false, 'AI search (ChatGPT, Claude, Perplexity) may read and cite the public pages', 'Turn on AI search below. Training crawlers stay blocked.', 'Site', 2);
    add(!!ai.llmsOn, 'llms.txt is published', 'Publish llms.txt below: a short, accurate description AI tools can use.', 'Site');
  }
  add(s.sameAs.length > 0, 'Social profiles are linked (sameAs)', 'Add the business\'s profiles (LinkedIn, X, YouTube...) so search engines connect them to the brand.', 'Site');
  add(!!s.lastPing, 'Changed pages were announced with IndexNow', 'Press "Announce pages now" after you change pages.', 'Site');
  const total = checks.reduce((a, c) => a + c.weight, 0), got = checks.filter(c => c.ok).reduce((a, c) => a + c.weight, 0);
  return { score: Math.round(got / total * 100), checks, pages };
}

// Announces the pages to IndexNow (Bing, Yandex, Seznam, Naver; shared between them).
export async function pingIndexNow() {
  const b = base(); if (!/^https:\/\//.test(b)) throw bad('Set PUBLIC_URL to the site\'s https address first');
  const key = await indexnowKey(), s = settings();
  const urlList = PAGES.filter(p => !s.pages[p.key]?.noindex).map(p => b + p.path);
  const r = await fetch(process.env.INDEXNOW_URL || 'https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ host: new URL(b).host, key, keyLocation: `${b}/${key}.txt`, urlList }),
  });
  if (![200, 202].includes(r.status)) throw bad(`IndexNow answered ${r.status}${r.status === 403 ? ' (the key file could not be read yet; try again after the deploy)' : ''}`, 502);
  await siteSet('seo', { ...settings(), lastPing: Date.now() });
  return { sent: urlList.length, status: r.status };
}

export function seoAdminRouter({ onChange } = {}) {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  r.get('/', async (req, res) => {
    const AI = await import('./aiaccess.js'), ai = AI.settings();
    res.json({ settings: { ...settings(), indexnowKey: await indexnowKey() }, base: base(), pages: PAGES, audit: await auditSite(settings(), ai), ai: { search: ai.search, aiSearch: ai.aiSearch !== false, llmsOn: ai.llmsOn, llms: ai.llms } });
  });
  r.put('/', async (req, res) => {
    const b = req.body || {}, out = await saveSettings(b);
    if ('aiSearch' in b || 'llmsOn' in b || 'llms' in b || 'search' in b) await (await import('./aiaccess.js')).saveSettings({ ...('aiSearch' in b ? { aiSearch: b.aiSearch } : {}), ...('llmsOn' in b ? { llmsOn: b.llmsOn } : {}), ...('llms' in b ? { llms: b.llms } : {}), ...('search' in b ? { search: b.search } : {}) });
    onChange?.();
    await auditLog(req.user.id, 'seo_settings', { pages: Object.keys(b.pages || {}), verification: { google: !!out.google, bing: !!out.bing } }, req.ip);
    res.json({ ok: true });
  });
  r.post('/indexnow', async (req, res) => res.json(await pingIndexNow()));
  return r;
}
