// SEO (pages, structured data, sitemap, robots for AI search, audit, IndexNow), "Close all
// positions", and the live quote's bid/ask sanity check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let pinged = null;
const ix = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { pinged = JSON.parse(b); res.statusCode = 202; res.end(); }); });
await new Promise(r => ix.listen(0, '127.0.0.1', r));
Object.assign(process.env, { PUBLIC_URL: 'https://brightfolio.example', INDEXNOW_URL: `http://127.0.0.1:${ix.address().port}/indexnow` });
const { app } = await import('../server.js');
const SEO = await import('../src/seo.js');
const { one } = await import('../src/db.js');

let server, base;
const client = () => {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
};
const owner = client(), user = client();
before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  await owner('/auth/register', { email: 'seo-owner@example.com', password: 'Str0ngPassword1', agree: true });
  await user('/auth/register', { email: 'seo-user@example.com', password: 'Str0ngPassword1', agree: true });
});
after(() => { server.close(); ix.close(); });

test('public pages carry canonical, hreflang, Open Graph, verification and valid structured data', async () => {
  assert.equal((await owner('/admin/seo', { google: '<meta name="google-site-verification" content="abc123XYZ" />', bing: 'BING42', sameAs: 'https://www.linkedin.com/company/brightfolio', pages: { index: { title: 'Brightolio: paper trading, backtests and automation', description: 'Practice with $100,000 of paper money, backtest strategies and automate them on the brokerage you choose.' } } }, 'PUT')).status, 200);
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<title>Brightolio: paper trading, backtests and automation<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/brightfolio\.example\/">/);
  assert.match(html, /hreflang="yi" href="https:\/\/brightfolio\.example\/yi"/); assert.match(html, /hreflang="x-default"/);
  assert.match(html, /<meta name="google-site-verification" content="abc123XYZ">/); assert.match(html, /<meta name="msvalidate\.01" content="BING42">/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const types = ld['@graph'].map(x => x['@type']);
  assert.ok(types.includes('Organization') && types.includes('WebSite') && types.includes('SoftwareApplication'));
  assert.ok(ld['@graph'].find(x => x['@type'] === 'Organization').sameAs[0].includes('linkedin'));
  const app = ld['@graph'].find(x => x['@type'] === 'SoftwareApplication');
  assert.ok(app.offers.some(o => o.name === 'Pro' && o.price === '53'));
  const faq = ld['@graph'].find(x => x['@type'] === 'FAQPage');
  assert.ok(faq && faq.mainEntity.length > 2 && faq.mainEntity[0].acceptedAnswer.text.length > 10);
  // Other pages: their own canonical, and no FAQ.
  const terms = await (await fetch(base + '/terms')).text();
  assert.match(terms, /<link rel="canonical" href="https:\/\/brightfolio\.example\/terms">/); assert.doesNotMatch(terms, /FAQPage/);
  // A non-admin cannot change SEO.
  assert.equal((await user('/admin/seo', { google: 'x' }, 'PUT')).status, 403);
});

test('sitemap, robots for AI search, llms.txt and noindex', async () => {
  let sm = await (await fetch(base + '/sitemap.xml')).text();
  assert.match(sm, /<loc>https:\/\/brightfolio\.example\/<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod>/);
  assert.match(sm, /xhtml:link rel="alternate" hreflang="yi"/);
  await owner('/admin/seo', { pages: { status: { noindex: true } }, llmsOn: true, llms: 'Brightolio is software for paper trading and automation on your own brokerage account.' }, 'PUT');
  sm = await (await fetch(base + '/sitemap.xml')).text();
  assert.doesNotMatch(sm, /\/status</);
  assert.match(await (await fetch(base + '/status')).text(), /<meta name="robots" content="noindex, follow">/);
  const robots = await (await fetch(base + '/robots.txt')).text();
  assert.match(robots, /AI search assistants[\s\S]*User-agent: OAI-SearchBot[\s\S]*?Allow: \//);
  assert.match(robots, /User-agent: GPTBot[\s\S]*?Disallow: \/\n/);
  const llms = await (await fetch(base + '/llms.txt')).text();
  assert.match(llms, /^# Brightolio/); assert.match(llms, /\(https:\/\/brightfolio\.example\/terms\)/); assert.doesNotMatch(llms, /\/status\)/);
});

test('the audit scores the site and says what to fix; IndexNow announces the pages', async () => {
  const d = (await owner('/admin/seo')).body;
  assert.ok(d.audit.score > 0 && d.audit.score <= 100);
  assert.ok(d.audit.checks.find(c => c.title.startsWith('Google Search Console') && c.ok));
  assert.ok(d.audit.checks.find(c => /Announced|IndexNow/.test(c.title) && !c.ok));
  const key = d.settings.indexnowKey;
  assert.equal(await (await fetch(`${base}/${key}.txt`)).text(), key);
  assert.equal((await fetch(`${base}/notthekeyatall123456.txt`)).status, 404);
  const r = await owner('/admin/seo/indexnow', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pinged.host, 'brightfolio.example'); assert.equal(pinged.key, key); assert.ok(pinged.urlList.includes('https://brightfolio.example/'));
  assert.ok(!pinged.urlList.includes('https://brightfolio.example/status'), 'noindex pages are not announced');
  assert.ok((await owner('/admin/seo')).body.audit.checks.find(c => /IndexNow/.test(c.title)).ok);
});

test('FAQ extraction and transform keep the page intact without a site address', () => {
  const html = '<html><head><title>T</title><meta name="description" content="D"></head><body><details><summary>Is it free?</summary><p>Yes, <b>Starter</b> is free.</p></details></body></html>';
  assert.deepEqual(SEO.faqFrom(html), [{ q: 'Is it free?', a: 'Yes, Starter is free.' }]);
  assert.equal(SEO.transform(html, 'index', SEO.DEFAULTS, ''), html);
});

test('close all positions: typed CLOSE needed, then everything in the account is sold', async () => {
  const c = client(); await c('/auth/register', { email: 'closeall@example.com', password: 'Str0ngPassword1', agree: true });
  await c('/orders', { account: 'paper', symbol: 'AAPL', side: 'buy', qty: 3 });
  await c('/orders', { account: 'paper', symbol: 'MSFT', side: 'buy', qty: 1 });
  assert.equal((await c('/account?account=paper')).body.positions.length, 2);
  assert.equal((await c('/positions/close-all', { account: 'paper' })).status, 400);
  const r = await c('/positions/close-all', { account: 'paper', confirmWord: 'close' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.closed, 2);
  assert.equal((await c('/account?account=paper')).body.positions.length, 0);
  const u = await one("SELECT id FROM users WHERE email = 'closeall@example.com'");
  assert.ok(await one("SELECT 1 FROM audit_log WHERE user_id = ? AND event = 'positions_closed_all'", u.id));
  // A brokerage that is not connected is refused.
  assert.equal((await c('/positions/close-all', { account: 'alpaca', confirmWord: 'CLOSE' })).status, 409);
});
