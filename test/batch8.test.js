// Scheduled trades at a New York time, stock look-ups by text (CHART, EARNINGS), the monthly
// calendar with earnings and IPOs, credits, and the private README as a PDF saved to Google Drive.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { serve } from './client.js';
import { nyAt, nextNyRun } from '../src/time.js';
import { markdownPdf } from '../src/pdf.js';
import { one, run } from '../src/db.js';

let fake, calls = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: b, headers: req.headers });
      res.setHeader('Content-Type', 'application/json');
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/fh/calendar/earnings') return res.end(JSON.stringify({ earningsCalendar: [{ symbol: u.searchParams.get('symbol') || 'AAPL', date: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), hour: 'amc', quarter: 4, year: 2026, epsEstimate: 2.1, revenueEstimate: 125e9 }, { symbol: 'ZZZZ', date: u.searchParams.get('from'), hour: 'bmo' }] }));
      if (u.pathname === '/fh/stock/earnings') return res.end(JSON.stringify([{ period: '2026-06-30', quarter: 3, year: 2026, actual: 1.85, estimate: 1.75, surprisePercent: 5.7 }]));
      if (u.pathname === '/fh/calendar/ipo') return res.end(JSON.stringify({ ipoCalendar: [{ date: u.searchParams.get('from'), symbol: 'NEWCO', name: 'NewCo Inc', exchange: 'NASDAQ', price: '18-20', status: 'expected' }] }));
      if (u.pathname === '/token') {
        const q = new URLSearchParams(b);
        return res.end(JSON.stringify(q.get('grant_type') === 'authorization_code' ? { refresh_token: 'r-token', access_token: 'a1' } : { access_token: 'a2' }));
      }
      if (u.pathname.startsWith('/upload')) return res.end(JSON.stringify({ id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123/view' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { FINNHUB_API_KEY: 'test-key', FINNHUB_API_URL: url + '/fh', GOOGLE_TOKEN_URL: url + '/token', GOOGLE_DRIVE_UPLOAD_URL: url + '/upload', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', STRIPE_WEBHOOK_SECRET: 'whsec_test' });
});
after(() => fake.close());

test('New York times: daylight saving, weekdays and month ends', () => {
  // 9:35 in New York is 13:35 UTC in summer and 14:35 UTC in winter.
  assert.equal(new Date(nyAt('2026-07-01', 575)).toISOString(), '2026-07-01T13:35:00.000Z');
  assert.equal(new Date(nyAt('2026-12-01', 575)).toISOString(), '2026-12-01T14:35:00.000Z');
  // After Friday 10:00, the next weekday run at 9:35 is Monday.
  const fri = nyAt('2026-10-30', 600);
  assert.equal(new Date(nextNyRun(fri, { repeat: 'daily', minutes: 575 })).toISOString(), '2026-11-02T14:35:00.000Z');
  // Chosen weekdays (Tue, Thu).
  assert.equal(new Date(nextNyRun(fri, { repeat: 'weekly', minutes: 575, weekdays: [2, 4] })).toISOString(), '2026-11-03T14:35:00.000Z');
  // Monthly on the 31st: Oct 31 2026 is a Saturday (runs Monday Nov 2); November has 30 days.
  assert.equal(new Date(nextNyRun(nyAt('2026-10-30', 700), { repeat: 'monthly', minutes: 575, monthDay: 31 })).toISOString(), '2026-11-02T14:35:00.000Z');
  assert.equal(new Date(nextNyRun(nyAt('2026-11-02', 700), { repeat: 'monthly', minutes: 575, monthDay: 31 })).toISOString(), '2026-11-30T14:35:00.000Z');
  // Monthly on a day that falls on a weekend runs the next Monday (Nov 1 2026 is a Sunday).
  assert.equal(new Date(nextNyRun(nyAt('2026-10-02', 700), { repeat: 'monthly', minutes: 575, monthDay: 1 })).toISOString(), '2026-11-02T14:35:00.000Z');
  assert.equal(nextNyRun(fri, { repeat: 'once', minutes: 575 }), null);
});

test('scheduled trades take a date, a New York time and an order type', async () => {
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('sched8@example.com');
    await run("UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = ?", me.id);
    const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const r = await u('/schedule', { account: 'paper', side: 'buy', symbol: 'spy', notional: 100, date: day, time: '15:50', repeat: 'weekly', weekdays: [1, 3, 5], orderType: 'limit', limitPrice: 500, extended: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = await one('SELECT * FROM scheduled_orders WHERE id = ?', r.body.id);
    assert.equal(o.run_minutes, 950); assert.equal(o.weekdays, '1,3,5'); assert.equal(o.order_type, 'limit'); assert.equal(o.limit_price, 500); assert.equal(o.extended, 1); assert.equal(o.symbol, 'SPY');
    // The first run is on a chosen weekday at 15:50 New York time.
    const ny = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(r.body.nextRun));
    assert.match(ny, /^(Mon|Wed|Fri),? 15:50$/);
    assert.equal((await u('/schedule', { account: 'paper', side: 'buy', symbol: 'SPY', qty: 1, date: day, time: '10:00', repeat: 'once', orderType: 'limit' })).status, 400);
    assert.equal((await u('/schedule', { account: 'paper', side: 'buy', symbol: 'SPY', qty: 1, date: '2020-01-02', time: '10:00', repeat: 'once' })).status, 400);
  } finally { s.close(); }
});

test('texting a ticker: CHART, EARNINGS and plain words', async () => {
  const s = await serve();
  try {
    const u = s.client(); await u.signup('lookup8@example.com');
    const say = async text => (await u('/command', { text })).body.reply;
    const chart = await say('aapl chart');
    assert.match(chart, /^AAPL \$[\d,.]+\n1 week [+-]\d+\.\d% \| 1 month [+-]\d+\.\d% \| 1 year [+-]\d+\.\d%\n52-week range/);
    assert.match(await say('CHART TSLA'), /^TSLA \$/);
    const earn = await say('AAPL EARNINGS');
    assert.match(earn, /AAPL earnings\nNext: .+, after the close \(Q4 2026\)\nEPS estimate \$2\.10, revenue estimate \$125\.0B\nLast quarters: Q3 \$1\.85 \(\+5\.7% vs est\.\)/);
    assert.match(await say('MSFT'), /^MSFT \$[\d,.]+ \(1 week .*Text MSFT CHART or MSFT EARNINGS/);
    // Conversation words are not tickers.
    assert.doesNotMatch(await say('thanks'), /Could not look up|THANKS \$/);
    assert.match(await say('help'), /CHART/);
  } finally { s.close(); }
});

test('the calendar month lists IPOs and earnings of well-known and held stocks', async () => {
  const s = await serve();
  try {
    const u = s.client(); await u.signup('cal8@example.com');
    const r = await u('/events/month?ym=2026-11');
    assert.equal(r.status, 200);
    assert.equal(r.body.from, '2026-11-01'); assert.equal(r.body.to, '2026-11-30');
    assert.deepEqual(r.body.ipos.map(i => i.symbol), ['NEWCO']);
    assert.ok(r.body.earnings.every(e => e.symbol !== 'ZZZZ'), 'only well-known or held symbols');
    assert.ok(calls.some(c => c.headers['x-finnhub-token'] === 'test-key'));
    assert.ok(!calls.some(c => /token=/.test(c.url)), 'the key is sent in a header, not the address');
  } finally { s.close(); }
});

test('credits: monthly allowance, spending, packs bought once per payment', async () => {
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('credits8@example.com');
    let c = (await u('/credits')).body;
    assert.equal(c.balance.allowance, 100); assert.equal(c.balance.total, 100); assert.equal(c.costs.sms, 1);
    const CR = await import('../src/credits.js');
    const user = await one('SELECT * FROM users WHERE id = ?', me.id);
    await CR.spend(user, 'agent', { n: 9 });
    assert.equal((await CR.balance(user)).total, 10);
    await assert.rejects(CR.spend(user, 'agent', { n: 2 }), e => e.status === 402 && e.credits);
    assert.equal(await CR.trySpend(user, 'sms'), true);
    // A paid credit pack through the Stripe webhook; Stripe retries count once.
    const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', client_reference_id: String(me.id), payment_status: 'paid', metadata: { kind: 'credits', credits: '500' } } } });
    const send = () => { const t = Math.floor(Date.now() / 1000), sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${ev}`).digest('hex'); return fetch(s.base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: ev }); };
    assert.equal((await send()).status, 200); assert.equal((await send()).status, 200);
    c = (await u('/credits')).body;
    assert.equal(c.balance.bought, 500); assert.equal(c.balance.total, 509);
    assert.equal(c.history[0].delta, 500);
    // Monthly credits are used before bought ones.
    await CR.spend(user, 'agent');
    const b = await CR.balance(user); assert.equal(b.monthly, 0); assert.equal(b.bought, 499);
    // A new month refills the allowance; bought credits stay.
    await run("UPDATE credit_state SET period = '2000-01' WHERE user_id = ?", me.id);
    assert.deepEqual([(await CR.balance(user)).monthly, (await CR.balance(user)).bought], [100, 499]);
    // Owner settings.
    const owner = s.client(); await owner.signup('site-owner@example.com');
    assert.equal((await u('/admin/site/credits')).status, 403);
    assert.equal((await owner('/admin/site/credits', { monthly: { free: 50 } }, 'PUT')).status, 200);
    assert.equal((await owner('/admin/site/credits/grant', { email: 'CREDITS8@example.com', credits: 25, memo: 'Thanks' })).status, 200);
    assert.equal((await u('/credits')).body.balance.bought, 524);
  } finally { s.close(); }
});

test('a Markdown PDF has numbered pages', () => {
  const md = '# Title\n\n' + Array.from({ length: 200 }, (_, i) => `- Item ${i} → with an arrow and “quotes”`).join('\n') + '\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\ncode line\n```\n';
  const { pdf, pages } = markdownPdf(md, { title: 'Guide' });
  assert.ok(pages >= 3);
  const t = pdf.toString('latin1');
  assert.match(t, /^%PDF-1\.4/); assert.match(t, /%%EOF\n$/);
  for (let i = 1; i <= pages; i++) assert.ok(t.includes(`(Page ${i} of ${pages}) Tj`), `footer on page ${i}`);
  assert.equal((t.match(/\/Type \/Page\b/g) || []).length, pages);
  // The cross-reference offsets point at the objects.
  const xref = +t.match(/startxref\n(\d+)/)[1];
  assert.equal(t.slice(xref, xref + 4), 'xref');
});

test('a long PDF starts with contents that give the right page for each section', () => {
  const sec = n => `## Section ${n}\n\n` + Array.from({ length: 60 }, (_, i) => `Line ${i} of section ${n}.`).join('\n\n');
  const { pdf, pages } = markdownPdf('# Guide\n\n' + [1, 2, 3, 4].map(sec).join('\n\n'), { title: 'Guide', cover: false });
  const t = pdf.toString('latin1');
  // Content streams in page order: find where each heading is drawn and the number listed for it.
  const streams = [...t.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(m => m[1]);
  assert.equal(streams.length, pages);
  assert.match(streams[0], /\(Contents\) Tj/);
  for (const n of [1, 2, 3, 4]) {
    const listed = +new RegExp(`\\(Section ${n} \\.+\\) Tj ET BT /F2 [\\d.]+ Tf [\\d.]+ [\\d.]+ Td \\((\\d+)\\) Tj`).exec(streams[0])[1];
    const actual = streams.findIndex((st, i) => i > 0 && st.includes(`(Section ${n}) Tj`)) + 1;
    assert.equal(listed, actual, `section ${n}`);
  }
  // Short documents have no contents page.
  assert.doesNotMatch(markdownPdf('# One\n\nHi').pdf.toString('latin1'), /\(Contents\)/);
});

test('the portfolio chart refreshes quietly instead of rebuilding the page', async () => {
  const fs = await import('node:fs');
  const tr = fs.readFileSync('public/trading.js', 'utf8'), app = fs.readFileSync('public/app.js', 'utf8');
  const portfolio = tr.slice(tr.indexOf('async function portfolio('), tr.indexOf('\n}\n', tr.indexOf('async function portfolio(')));
  assert.doesNotMatch(portfolio, /every\(\d+, \(\) => H\.render\(\)\)/);
  assert.match(portfolio, /if \(holding \|\| P\.mode === 'since'\) return/);
  // The drawing animation plays only the first time a chart is shown.
  assert.match(app, /if \(calmMotion\(\) \|\| seen\) return frame\(1\)/);
});

test('the owner connects Google Drive and saves the private README there as a PDF', async () => {
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('site-owner2@example.com');
    assert.equal((await owner('/admin/site/readme', { text: '# Private guide\n\nSecret setup steps.\n' }, 'PUT')).status, 200);
    assert.equal((await owner('/admin/site/readme/drive', {})).status, 400, 'not connected yet');
    const D = await import('../src/drive.js');
    const me = (await owner('/auth/me')).body.user;
    const state = new URL(D.authUrl(me.id)).searchParams.get('state');
    assert.match(D.authUrl(me.id), /scope=https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fdrive\.file/);
    await assert.rejects(D.finish(me.id + 1, { code: 'c', state }), /expired/);
    const state2 = new URL(D.authUrl(me.id)).searchParams.get('state');
    await D.finish(me.id, { code: 'the-code', state: state2 });
    assert.equal((await owner('/admin/site/drive')).body.connected, true);
    const r = await owner('/admin/site/readme/drive', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.id, 'file123'); assert.ok(r.body.pages >= 1);
    const up = calls.filter(c => c.url.startsWith('/upload'));
    assert.equal(up[0].method, 'POST'); assert.equal(up[0].headers.authorization, 'Bearer a2');
    assert.match(up[0].body, /%PDF-1\.4[\s\S]*Page \d+ of/);
    // A second save updates the same file.
    await owner('/admin/site/readme/drive', {});
    assert.equal(calls.filter(c => c.url.startsWith('/upload')).pop().method, 'PATCH');
    // Download PDF: the editor's text (saved or not) as a PDF.
    const pdf = await owner('/admin/site/readme/pdf', { text: '# Draft\n\nNot saved yet.' });
    assert.equal(pdf.status, 200);
    const raw = await fetch(s.base + '/api/admin/site/readme/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: '' }, body: '{}' });
    assert.notEqual(raw.status, 200);
    const dl = await fetch(s.base + '/api/admin/site/readme/pdf', { headers: { cookie: '' } });
    assert.notEqual(dl.status, 200, 'the PDF download needs the owner');
  } finally { s.close(); }
});
