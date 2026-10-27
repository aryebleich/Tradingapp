// Monthly bookkeeping, statistical arbitrage, the phone line (IVR) and the Square and Authorize.net
// card deposits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { serve } from './client.js';
import { monthlyBooks, booksCsv, taxOn } from '../src/books.js';
import { align, pairMatrix, sScores, backtest, limitsFor } from '../src/statarb.js';
import { syntheticBars } from '../src/brokers.js';
import { run, one } from '../src/db.js';

// A fake Square and Authorize.net API.
let fake, fakeUrl;
const seen = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      seen.push({ url: req.url, body: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v2/online-checkout/payment-links') return res.end(JSON.stringify({ payment_link: { url: 'https://square.link/u/abc', order_id: 'ORDER-1' } }));
      if (req.url === '/anet') return res.end('﻿' + JSON.stringify({ token: 'ANET-TOKEN-1', messages: { resultCode: 'Ok' } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, {
    SQUARE_ACCESS_TOKEN: 'sq-token', SQUARE_LOCATION_ID: 'LOC1', SQUARE_WEBHOOK_SIGNATURE_KEY: 'sq-sign', SQUARE_API_URL: fakeUrl,
    ANET_LOGIN_ID: 'login', ANET_TRANSACTION_KEY: 'tkey', ANET_SIGNATURE_KEY: 'ABCDEF0123', ANET_API_URL: fakeUrl + '/anet',
  });
});
after(() => fake.close());

const D = (s, h = 15) => Date.parse(`${s}T${String(h).padStart(2, '0')}:00:00Z`);

test('monthly books: gains by month, income, deposits, set-aside and estimated-tax periods', () => {
  const fills = [
    { symbol: 'AAPL', side: 'buy', qty: 10, price: 100, at: D('2025-03-01') },   // last year: long-term lot
    { symbol: 'MSFT', side: 'buy', qty: 5, price: 200, at: D('2026-01-10') },
    { symbol: 'MSFT', side: 'sell', qty: 5, price: 260, at: D('2026-02-20') },   // +300 short-term in February
    { symbol: 'AAPL', side: 'sell', qty: 10, price: 150, at: D('2026-05-05') },  // +500 long-term in May
  ];
  const b = monthlyBooks({ fills, ledger: [{ kind: 'deposit', amount: 1000, at: D('2026-01-02') }], income: [{ type: 'DIV', amount: 12.5, symbol: 'AAPL', at: D('2026-02-14') }, { type: 'FEE', amount: -1, at: D('2026-02-15') }], year: 2026, bracket: 0.24, stateRate: 0.05 });
  assert.equal(b.months[0].trades, 1); assert.equal(b.months[0].deposits, 1000); assert.equal(b.months[0].bought, 1000);
  assert.equal(b.months[1].shortTerm, 300); assert.equal(b.months[1].dividends, 12.5); assert.equal(b.months[1].brokerFees, 1);
  assert.equal(b.months[4].longTerm, 500); assert.equal(b.months[4].ytdRealized, 800);
  assert.equal(b.totals.realized, 800); assert.equal(b.totals.trades, 3);
  // Set-aside: 300 short-term and 11.5 of income at 29%, 500 long-term at 15% + 5%.
  assert.equal(b.totals.setAside, taxOn({ st: 300, lt: 500, ordinary: 11.5 }, { bracket: 0.24, stateRate: 0.05 }));
  assert.ok(Math.abs(b.totals.setAside - (311.5 * 0.29 + 500 * 0.2)) < 0.01);
  // Q1 (Jan-Mar) holds February's gain, Q2 (Apr-May) May's; together they make the year's set-aside.
  assert.equal(b.quarters[0].due, '2026-04-15'); assert.equal(b.quarters[3].due, '2027-01-15');
  assert.ok(Math.abs(b.quarters.reduce((a, q) => a + q.estimatedTax, 0) - b.totals.setAside) < 0.02);
  assert.ok(b.quarters[0].estimatedTax > 0 && b.quarters[1].estimatedTax > 0 && b.quarters[2].estimatedTax === 0);
  const csv = booksCsv(b);
  assert.match(csv, /^2026-02,1,0,1300,300,0,0,12.5,0,1,0,0,300,/m);
  assert.match(csv, /2026-05-05,Sell,AAPL,10,150,1500,1000,500,Long,/);
  // Losses set nothing aside.
  assert.equal(taxOn({ st: -500, lt: 0, ordinary: 0 }, {}), 0);
});

test('statistical arbitrage: pair matrix, s-scores and a walk-forward backtest', () => {
  const series = Object.fromEntries(['AAA', 'BBB', 'CCC', 'DDD'].map(s => [s, syntheticBars(s, 600)]));
  const d = align(series);
  const m = pairMatrix(d);
  assert.equal(m.length, 6);
  for (const c of m) { assert.ok(c.correlation >= -1 && c.correlation <= 1); assert.equal(typeof c.adf, 'number'); }
  const sc = sScores(d.px, d.syms, d.dates.length - 1);
  assert.equal(sc.length, 4);
  for (const x of sc) assert.ok(Number.isFinite(x.s));
  const b = backtest(d);
  assert.ok(b.curve.length > 10 && Number.isFinite(b.m.cagr));
  assert.deepEqual(limitsFor({ plan: 'free' }), { symbols: 6, refresh: 0 });
  assert.equal(limitsFor({ plan: 'elite', plan_status: 'active' }).symbols, 30);
  assert.equal(limitsFor({ role: 'admin' }).symbols, 50);
});

test('statistical arbitrage API: plan limits on basket size', async () => {
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('aryebleich@gmail.com');
    const free = s.client(); await free.signup('statarb-free@example.com');
    const info = (await free('/statarb/baskets')).body;
    assert.equal(info.limits.symbols, 6); assert.ok(info.baskets.Banks.length >= 6);
    const seven = 'KO, PEP, PG, CL, KMB, MDLZ, HSY';
    const r = await free('/statarb/analyze', { symbols: seven });
    assert.equal(r.status, 402); assert.equal(r.body.upgrade, true);
    assert.equal((await free('/statarb/analyze', { symbols: 'KO, PEP' })).status, 400);
    const ok = await owner('/statarb/analyze', { symbols: seven });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.matrix.length, 21); assert.equal(ok.body.scores.length, 7); assert.ok(ok.body.backtest.curve.length);
    assert.equal(ok.body.refresh, 15);
  } finally { s.close(); }
});

test('monthly books API and email setting', async () => {
  const s = await serve();
  try {
    const c = s.client(); const me = await c.signup('books@example.com');
    await run("INSERT INTO fills (user_id, account, symbol, side, qty, price, source, at) VALUES (?, 'paper', 'SPY', 'buy', 2, 500, 'web', ?), (?, 'paper', 'SPY', 'sell', 2, 520, 'web', ?)", me.id, D('2026-03-02'), me.id, D('2026-03-20'));
    const b = (await c('/tax/books?account=paper&year=2026')).body;
    assert.equal(b.months[2].shortTerm, 40); assert.equal(b.email, false);
    assert.equal((await c('/tax/books/email', { on: true }, 'PUT')).status, 200);
    assert.equal((await c('/tax/books?account=paper&year=2026')).body.email, true);
    const csv = await fetch(s.base + '/api/tax/books?account=paper&year=2026&format=csv', { headers: { cookie: '' } });
    assert.equal(csv.status, 401);
  } finally { s.close(); }
});

// ---------- phone line ----------
const say = x => [...x.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map(m => m[1]).join(' ');
const action = x => (/<Gather[^>]*action="([^"]+)"/.exec(x)?.[1] || '').replace(/&amp;/g, '&');
function caller(base, from, sid = 'CA' + crypto.randomBytes(6).toString('hex')) {
  return async (path, digits, extra = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: from, CallSid: sid, ...(digits != null ? { Digits: digits } : {}), ...extra }) });
    const text = await r.text();
    return { status: r.status, text, say: say(text), next: action(text) };
  };
}

test('phone line: open an account by phone, then trade on paper with the PIN', async () => {
  const s = await serve();
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  try {
    const owner = s.client(); await owner.signup('kk5185920061@gmail.com');
    // Free-plan callers may use the paper menu once the owner allows it.
    assert.equal((await owner('/admin/site/phone', { freePaper: true, tickers: 'AAPL, SPY', maxQty: 50 }, 'PUT')).status, 200);
    const call = caller(s.base, '+18455550123');
    let r = await call('/twilio/voice');
    assert.match(r.say, /does not have an account yet. Press 1 to open a free account/);
    r = await call(r.next, '1');
    const code = /QuantPocket code: (\d{6})/.exec(logs.join('\n'))?.[1];
    assert.ok(code, 'the code was texted');
    // A wrong code first, then the right one.
    let w = await call(r.next, '000000'); assert.match(w.say, /not right/);
    r = await call(w.next, code); assert.match(r.say, /choose a 4-digit PIN/);
    const weak = await call(r.next, '1111'); assert.match(weak.say, /harder to guess/);
    r = await call(weak.next, '2468'); assert.match(r.say, /same PIN again/);
    r = await call(r.next, '2468'); assert.match(r.say, /Your account is ready/); assert.match(r.say, /Main menu, paper trading/);
    const u = await one("SELECT * FROM users WHERE phone = '+18455550123'");
    assert.ok(u && u.phone_verified === 1 && u.pin_hash); assert.match(u.email, /@phone\.invalid$/);
    // A second call from the same number goes straight to the paper menu (free plan).
    const call2 = caller(s.base, '+18455550123');
    r = await call2('/twilio/voice'); assert.match(r.say, /paper account/);
    const menu = r.next;
    assert.match((await call2(menu, '3')).say, /market is (open|closed)/);
    assert.match((await call2(menu, '1')).say, /equity 100,000 dollars/);
    // Trade: stock 1 (AAPL) → buy → 60 shares is over the limit → 5 shares → confirm → PIN.
    r = await call2(menu, '4'); assert.match(r.say, /Press 1 for Apple/);
    r = await call2(r.next, '1'); r = await call2(r.next, '1'); assert.match(r.say, /How many shares/);
    const over = await call2(r.next, '60'); assert.match(over.say, /up to 50 shares/);
    r = await call2(over.next, '5'); assert.match(r.say, /Buy 5 shares of Apple/);
    r = await call2(r.next, '1'); assert.match(r.say, /enter your 4-digit PIN/);
    const bad = await call2(r.next, '9999'); assert.match(bad.say, /Wrong PIN/);
    r = await call2(bad.next, '2468'); assert.match(r.say, /Done\. Bought 5 Apple/);
    assert.equal((await one("SELECT SUM(qty) q FROM fills WHERE user_id = ? AND symbol = 'AAPL'", u.id)).q, 5);
    // Live is not available on the free plan: 9 keeps the caller on paper.
    assert.match((await call2(menu, '9')).say, /part of the Pro plan/);
    // Close all: confirm, then PIN.
    r = await call2(menu, '6'); assert.match(r.say, /sells every position/);
    r = await call2(r.next, '1'); r = await call2(r.next, '2468'); assert.match(r.say, /Closing 1 positions/);
    assert.equal((await one("SELECT SUM(CASE side WHEN 'buy' THEN qty ELSE -qty END) q FROM fills WHERE user_id = ? AND symbol = 'AAPL'", u.id)).q, 0);
    // Changing a signed step's URL (here the share count) is refused by the PIN step's own checks.
    const forged = await call2('/twilio/voice/pin?e=paper&do=trade&s=AAPL&side=buy&n=999999', '2468');
    assert.match(forged.say, /no longer valid/);
    // Three wrong PINs end the call.
    r = await call2(menu, '5'); let p = await call2(r.next, '0000'); p = await call2(p.next, '0001'); p = await call2(p.next, '0002');
    assert.match(p.say, /Too many wrong PINs/); assert.match(p.text, /<Hangup\/>/);
    // Admin sees the calls.
    const adm = (await owner('/admin/site/phone')).body;
    assert.ok(adm.counts.hotline_signup >= 1 && adm.counts.hotline_order >= 1 && adm.counts.hotline_pin_failed >= 1);
    assert.match(adm.voiceUrl, /\/twilio\/voice$/);
    // Switched off: callers hear it is closed.
    await owner('/admin/site/phone', { enabled: false }, 'PUT');
    assert.match((await call2('/twilio/voice')).say, /closed right now/);
    assert.equal((await owner('/admin/site/phone', { tickers: 'A,B,C,D,E,F,G,H,I,J' }, 'PUT')).status, 400);
  } finally { console.log = orig; s.close(); }
});

// ---------- Square and Authorize.net deposits ----------
test('card deposits through Square and Authorize.net count only after a signed webhook with the right amount', async () => {
  const s = await serve();
  try {
    const c = s.client(); const me = await c.signup('cards@example.com');
    const methods = (await c('/funding/methods')).body.methods.map(m => m.id);
    assert.ok(methods.includes('square') && methods.includes('authorizenet'));
    const sq = await c('/funding/deposit', { amount: 100, method: 'square', account: 'alpaca' });
    assert.equal(sq.status, 200, JSON.stringify(sq.body)); assert.equal(sq.body.url, 'https://square.link/u/abc');
    const dep = await one("SELECT * FROM ledger WHERE user_id = ? AND kind = 'deposit' ORDER BY id DESC", me.id);
    const total = Math.round((100 + (sq.body.fee || 0)) * 100);
    const send = (body, sig) => fetch(s.base + '/webhooks/square', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sig }, body });
    const sign = body => crypto.createHmac('sha256', 'sq-sign').update('http://localhost:3000/webhooks/square' + body).digest('base64');
    const ev = amt => JSON.stringify({ type: 'payment.updated', data: { object: { payment: { id: 'PAY1', status: 'COMPLETED', order_id: 'ORDER-1', amount_money: { amount: amt } } } } });
    assert.equal((await send(ev(total), 'forged')).status, 403);
    await send(ev(total - 100), sign(ev(total - 100)));
    assert.equal((await one('SELECT status FROM ledger WHERE id = ?', dep.id)).status, 'pending', 'a short payment does not count');
    assert.equal((await send(ev(total), sign(ev(total)))).status, 200);
    assert.equal((await one('SELECT status, ref FROM ledger WHERE id = ?', dep.id)).status, 'received');

    const an = await c('/funding/deposit', { amount: 50, method: 'authorizenet', account: 'alpaca' });
    assert.equal(an.status, 200); assert.match(an.body.url, /^\/api\/funding\/authorizenet\/\d+$/);
    const id = +an.body.url.split('/').pop();
    assert.match(JSON.parse(seen.find(x => x.url === '/anet').body).getHostedPaymentPageRequest.transactionRequest.order.invoiceNumber, new RegExp(`QP-${id}`));
    const anBody = JSON.stringify({ eventType: 'net.authorize.payment.authcapture.created', payload: { responseCode: 1, invoiceNumber: `QP-${id}`, authAmount: 50 + (an.body.fee || 0), id: 'T1' } });
    const hex = crypto.createHmac('sha512', 'ABCDEF0123').update(anBody).digest('hex').toUpperCase();
    assert.equal((await fetch(s.base + '/webhooks/authorizenet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ANET-Signature': 'sha512=0' }, body: anBody })).status, 403);
    assert.equal((await fetch(s.base + '/webhooks/authorizenet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ANET-Signature': 'sha512=' + hex }, body: anBody })).status, 200);
    assert.equal((await one('SELECT status FROM ledger WHERE id = ?', id)).status, 'received');
  } finally { s.close(); }
});
