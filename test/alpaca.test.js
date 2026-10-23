// Alpaca integration: Broker API onboarding/KYC/funding, Trading API through keys, OAuth and
// broker accounts, all order types, positions, watchlists, market data. Runs against a mock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
Object.assign(process.env, {
  BROKER_API_KEY: 'BKEY', BROKER_API_SECRET: 'BSECRET', BROKER_BASE_URL: mock.url,
  ALPACA_TRADING_URL: mock.url, ALPACA_LIVE_URL: mock.url, ALPACA_DATA_URL: mock.url, ALPACA_DATA_SANDBOX_URL: mock.url,
  ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET',
  ALPACA_OAUTH_CLIENT_ID: 'cid', ALPACA_OAUTH_CLIENT_SECRET: 'csecret', ALPACA_OAUTH_TOKEN_URL: mock.url + '/oauth/token', ALPACA_OAUTH_AUTHORIZE_URL: mock.url + '/oauth/authorize',
});
const { app } = await import('../server.js');
const { buildOrder, buildReplace } = await import('../src/alpaca/trading.js');
const { buildAccountRequest, buildDocuments, kycStep, statusInfo } = await import('../src/alpaca/broker.js');
const { startKycEvents, sseMessages } = await import('../src/alpaca/kyc.js');
const { parseOcc } = await import('../src/alpaca/data.js');
const { one } = await import('../src/db.js');

let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); mock.close(); });

function client() {
  let cookie = '';
  return async (path, body, method) => {
    const r = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null), cookie: () => cookie };
  };
}
const lastReq = (pred) => [...mock.log].reverse().find(pred);

const FORM = {
  givenName: 'Jane', familyName: 'Doe', dateOfBirth: '1990-05-01', ssn: '123-45-6789', citizenship: 'USA',
  email: 'jane@example.com', phone: '+17185550100', street: '20 N San Mateo Dr', city: 'San Mateo', state: 'CA', postalCode: '94401',
  employmentStatus: 'EMPLOYED', employerName: 'Acme', agreeCustomer: true, crypto: true, options: true,
};

test('order builder enforces each order type and asset class', () => {
  assert.deepEqual(Object.keys(buildOrder({ symbol: 'aapl', qty: 5, type: 'market' })).sort(), ['client_order_id', 'qty', 'side', 'symbol', 'time_in_force', 'type']);
  assert.equal(buildOrder({ symbol: 'AAPL', qty: 1, type: 'limit', limit_price: 150 }).limit_price, '150');
  assert.throws(() => buildOrder({ symbol: 'AAPL', qty: 1, type: 'limit' }), /Limit price/);
  const sl = buildOrder({ symbol: 'AAPL', qty: 1, type: 'stop_limit', stop_price: 140, limit_price: 139 });
  assert.equal(sl.stop_price, '140'); assert.equal(sl.limit_price, '139');
  assert.equal(buildOrder({ symbol: 'AAPL', qty: 1, type: 'trailing_stop', trail_percent: 2, side: 'sell' }).trail_percent, '2');
  assert.equal(buildOrder({ symbol: 'AAPL', qty: 1, type: 'trailing_stop', trail_price: 3, side: 'sell' }).trail_price, '3');
  assert.equal(buildOrder({ symbol: 'AAPL', notional: 250 }).notional, '250.00');
  // Bracket: both legs required and on the right side of the entry.
  const br = buildOrder({ symbol: 'AAPL', qty: 2, type: 'limit', limit_price: 100, order_class: 'bracket', take_profit_price: 110, stop_loss_price: 95, stop_loss_limit_price: 94 });
  assert.deepEqual([br.order_class, br.take_profit, br.stop_loss], ['bracket', { limit_price: '110' }, { stop_price: '95', limit_price: '94' }]);
  assert.throws(() => buildOrder({ symbol: 'AAPL', qty: 2, type: 'limit', limit_price: 100, order_class: 'bracket', take_profit_price: 90, stop_loss_price: 95 }), /take-profit must be above/);
  assert.throws(() => buildOrder({ symbol: 'AAPL', notional: 100, order_class: 'bracket', take_profit_price: 1, stop_loss_price: 1 }), /share quantity/);
  // Crypto: forced to GTC, no brackets, no stop orders.
  assert.equal(buildOrder({ symbol: 'BTC/USD', qty: 0.01, type: 'limit', limit_price: 60000, time_in_force: 'day' }).time_in_force, 'gtc');
  assert.throws(() => buildOrder({ symbol: 'BTC/USD', qty: 1, type: 'stop', stop_price: 1 }), /Crypto supports/);
  // Options: whole contracts, day orders; spreads use multi-leg.
  assert.equal(buildOrder({ symbol: 'AAPL261120C00150000', qty: 1, type: 'limit', limit_price: 5, time_in_force: 'gtc' }).time_in_force, 'day');
  assert.throws(() => buildOrder({ symbol: 'AAPL261120C00150000', qty: 1.5 }), /whole contracts/);
  const ml = buildOrder({ order_class: 'mleg', qty: 1, type: 'limit', limit_price: -1.2, legs: [{ symbol: 'AAPL261120C00150000', side: 'buy', ratio_qty: 1, position_intent: 'buy_to_open' }, { symbol: 'AAPL261120C00160000', side: 'sell', ratio_qty: 1, position_intent: 'sell_to_open' }] });
  assert.equal(ml.order_class, 'mleg'); assert.equal(ml.legs.length, 2); assert.equal(ml.limit_price, '-1.2'); assert.equal(ml.symbol, undefined);
  assert.throws(() => buildOrder({ order_class: 'mleg', qty: 1, legs: [{ symbol: 'AAPL261120C00150000', side: 'buy' }] }), /2 to 4 legs/);
  assert.throws(() => buildOrder({ symbol: 'AAPL', qty: 1, type: 'market', extended_hours: true }), /Extended hours/);
  assert.deepEqual(buildReplace({ qty: 3, limit_price: 101, ignored: 1 }), { qty: '3', limit_price: '101' });
  assert.deepEqual(parseOcc('AAPL261120C00150000'), { root: 'AAPL', expiration: '2026-11-20', type: 'call', strike: 150 });
});

test('account request maps the onboarding form and protects inputs', () => {
  const r = buildAccountRequest(FORM, '1.2.3.4', new Date('2026-10-22T12:00:00Z'));
  assert.equal(r.identity.tax_id, '123-45-6789'); assert.equal(r.identity.tax_id_type, 'USA_SSN');
  assert.deepEqual(r.contact.street_address, ['20 N San Mateo Dr']);
  assert.deepEqual(r.agreements.map(a => a.agreement), ['customer_agreement', 'account_agreement', 'crypto_agreement', 'options_agreement']);
  assert.equal(r.agreements[0].ip_address, '1.2.3.4');
  assert.deepEqual(r.enabled_assets, ['us_equity', 'crypto', 'us_option']);
  assert.throws(() => buildAccountRequest({ ...FORM, ssn: '123' }), /9 digits/);
  assert.throws(() => buildAccountRequest({ ...FORM, dateOfBirth: '2015-01-01' }), /18/);
  assert.throws(() => buildAccountRequest({ ...FORM, agreeCustomer: false }), /Customer Agreement/);
  assert.deepEqual(['SUBMITTED', 'APPROVED', 'ACTIVE', 'ACTION_REQUIRED'].map(kycStep), [1, 2, 3, 0]);
});

test('broker account: open, KYC to ACTIVE, ACH, transfers, then trade through the Broker API', async () => {
  const call = client();
  await call('/auth/register', { email: 'broker@t.co', password: 'Str0ngPassword' });
  assert.equal((await call('/alpaca/orders', { symbol: 'AAPL', qty: 1 })).status, 409); // nothing connected yet

  const opened = await call('/alpaca/broker/accounts', FORM);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.status, 'SUBMITTED');
  const sent = lastReq(r => r.path === '/v1/accounts' && r.method === 'POST');
  assert.equal(sent.headers.authorization, 'Basic ' + Buffer.from('BKEY:BSECRET').toString('base64'));
  assert.equal(sent.body.identity.tax_id, '123-45-6789');
  assert.equal((await call('/alpaca/broker/accounts', FORM)).status, 400); // only one per user

  // Trading is blocked until the account is ACTIVE.
  assert.match((await call('/alpaca/orders', { symbol: 'AAPL', qty: 1 })).body.error, /SUBMITTED/);
  const s1 = (await call('/alpaca/broker/account')).body;
  assert.equal(s1.status, 'APPROVED'); assert.equal(s1.step, 2);
  assert.equal(JSON.stringify(s1).includes('123-45-6789'), false); // SSN never returned
  const s2 = (await call('/alpaca/broker/account')).body;
  assert.equal(s2.status, 'ACTIVE'); assert.equal(s2.step, 3);
  assert.equal((await call('/alpaca/status')).body.active.type, 'broker');

  assert.equal((await call('/alpaca/broker/account', { city: 'Palo Alto' }, 'PATCH')).status, 200);
  assert.equal((await call('/alpaca/broker/ach', { routingNumber: '12345', accountNumber: '1' })).status, 400);
  const achRel = (await call('/alpaca/broker/ach', { ownerName: 'Jane Doe', routingNumber: '121000358', accountNumber: '32131231abc'.replace(/\D/g, ''), accountType: 'CHECKING' })).body;
  assert.equal(achRel.status, 'APPROVED');
  assert.equal((await call('/alpaca/broker/ach')).body.length, 1);
  const tr = (await call('/alpaca/broker/transfers', { relationshipId: achRel.id, amount: 1000 })).body;
  assert.deepEqual([tr.direction, tr.amount, tr.timing, tr.transfer_type], ['INCOMING', '1000.00', 'immediate', 'ach']);
  assert.equal((await call('/alpaca/broker/transfers')).body.length, 1);
  assert.equal((await call('/alpaca/broker/transfers/' + tr.id, null, 'DELETE')).status, 200);

  // Orders route through /v1/trading/accounts/{id}/orders with Basic auth.
  const o = await call('/alpaca/orders', { symbol: 'AAPL', qty: 2, type: 'limit', limit_price: 150, time_in_force: 'gtc' });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const req = lastReq(r => r.method === 'POST' && /\/v1\/trading\/accounts\/.+\/orders$/.test(r.path));
  assert.ok(req.headers.authorization.startsWith('Basic '));
  assert.equal(req.body.limit_price, '150');
  assert.equal((await call('/alpaca/account')).body.buyingPower, 200000);
  assert.equal((await call('/alpaca/clock')).body.is_open, true);
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
test('onboarding spec: yes/no disclosures, tax residence, agreements, documents, status messages', () => {
  const r = buildAccountRequest({ ...FORM, crypto: false, options: 'no', margin: 'yes', isControlPerson: 'yes', isAffiliated: 'no', taxResidence: 'usa',
    documents: [{ subType: 'passport', mimeType: 'image/png', content: 'data:image/png;base64,' + PNG }] }, '5.6.7.8', new Date('2026-10-22T12:00:00Z'));
  assert.deepEqual(r.agreements.map(a => a.agreement), ['customer_agreement', 'account_agreement', 'margin_agreement']);
  assert.ok(r.agreements.every(a => a.signed_at === '2026-10-22T12:00:00.000Z' && a.ip_address === '5.6.7.8'));
  assert.deepEqual([r.disclosures.is_control_person, r.disclosures.is_affiliated_exchange_or_finra], [true, false]);
  assert.equal(r.identity.country_of_tax_residence, 'USA');
  assert.deepEqual(r.documents, [{ document_type: 'identity_verification', document_sub_type: 'passport', content: PNG, mime_type: 'image/png' }]);
  assert.deepEqual(r.enabled_assets, ['us_equity']);
  assert.equal(buildAccountRequest({ ...FORM, phone: '(718) 555-0100' }).contact.phone_number, '+17185550100');
  assert.throws(() => buildDocuments([{ mimeType: 'text/html', content: PNG }]), /JPG, PNG or PDF/);
  assert.throws(() => buildDocuments([{ mimeType: 'image/png', content: 'not base64!' }]), /not valid/);
  assert.throws(() => buildDocuments([{ mimeType: 'image/png', content: 'A'.repeat(7.2e6) }]), /under 5 MB/);
  assert.throws(() => buildAccountRequest({ ...FORM, postalCode: '123' }), /ZIP/);
  assert.equal(statusInfo('SUBMITTED').title, 'Application under review');
  assert.equal(statusInfo('APPROVED').title, 'Account approved! Ready to trade');
  assert.equal(statusInfo('ACTIVE').title, 'Account approved! Ready to trade');
  assert.equal(statusInfo('ACTION_REQUIRED').action, 'documents');
  assert.equal(statusInfo('APPROVAL_PENDING').title, 'Pending manual review');
  assert.equal(statusInfo('REJECTED').title, 'Application rejected');
});

// Reads this user's live status stream (our SSE endpoint, which relays Alpaca's feed).
async function statusStream(cookie) {
  const ctrl = new AbortController();
  const r = await fetch(base + '/api/alpaca/broker/events/stream', { headers: { cookie }, signal: ctrl.signal });
  assert.equal(r.headers.get('content-type'), 'text/event-stream');
  const it = sseMessages(r.body);
  const seen = [];
  return {
    seen,
    async until(status) {
      for (const m of seen) if (m.status === status) return m;
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        for (;;) {
          const { value, done } = await it.next();
          if (done) throw new Error('stream ended before ' + status + ' seen ' + JSON.stringify(seen));
          const d = JSON.parse(value.data); seen.push(d);
          if (d.status === status) return d;
        }
      } catch (e) { throw new Error(status + ' not seen; got ' + JSON.stringify(seen) + ' ' + e.message); } finally { clearTimeout(timer); }
    },
    close: () => ctrl.abort(),
  };
}
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 25)); } };

test('KYC events: Alpaca SSE feed drives status, ACTION_REQUIRED upload, live relay, resume after a drop', async () => {
  let stop = startKycEvents({ maxDelay: 50 });
  try {
    const call = client();
    await call('/auth/register', { email: 'kyc@t.co', password: 'Str0ngPassword' });
    const cookie = (await call('/auth/me')).cookie();
    const s = await statusStream(cookie);
    const opened = await call('/alpaca/broker/accounts', { ...FORM, givenName: 'Action', documents: [{ subType: 'drivers_license', mimeType: 'image/png', content: PNG }] });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.info.title, 'Application under review');
    assert.equal(lastReq(r => r.path === '/v1/accounts' && r.method === 'POST').body.documents[0].document_type, 'identity_verification');
    // The feed reports ACTION_REQUIRED; the user's open tab hears it without polling.
    const ar = await s.until('ACTION_REQUIRED');
    assert.equal(ar.action, 'documents');
    assert.equal((await call('/alpaca/broker/documents', { documents: [] })).status, 400);
    const up = await call('/alpaca/broker/documents', { documents: [{ subType: 'passport', mimeType: 'image/png', content: PNG }] });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.ok(lastReq(r => /\/documents\/upload$/.test(r.path)));
    await s.until('RESUBMITTED');
    mock.setStatus(opened.body.id, 'ACTIVE');
    assert.equal((await s.until('ACTIVE')).title, 'Account approved! Ready to trade');
    s.close();
    const hist = (await call('/alpaca/broker/events')).body.events.map(e => e.status_to);
    assert.deepEqual(hist, ['SUBMITTED', 'ACTION_REQUIRED', 'RESUBMITTED', 'APPROVED', 'ACTIVE']); // the read after the upload saw APPROVED
    const acct = (await call('/alpaca/broker/account')).body;
    assert.equal(acct.info.title, 'Account approved! Ready to trade');
    assert.equal(acct.history.length, 5);
    assert.equal(JSON.stringify(acct).includes(PNG), false);

    // Manual review, then a decision made while our feed connection is down: on reconnect the
    // feed resumes from the last event id and the decision still arrives.
    const call2 = client();
    await call2('/auth/register', { email: 'kyc2@t.co', password: 'Str0ngPassword' });
    const o2 = (await call2('/alpaca/broker/accounts', { ...FORM, givenName: 'Review' })).body;
    await waitFor(async () => (await one('SELECT status FROM broker_accounts WHERE account_id = ?', o2.id)).status === 'APPROVAL_PENDING');
    stop();
    mock.setStatus(o2.id, 'REJECTED', 'identity mismatch');
    stop = startKycEvents({ maxDelay: 50 });
    await waitFor(async () => (await one('SELECT status FROM broker_accounts WHERE account_id = ?', o2.id)).status === 'REJECTED');
    assert.ok(lastReq(r => r.path === '/v1/events/accounts/status' && r.query.since_id));
    const ev = (await call2('/alpaca/broker/events')).body.events.at(-1);
    assert.deepEqual([ev.status_to, ev.reason, ev.source], ['REJECTED', 'identity mismatch', 'sse']);
    assert.equal(statusInfo(ev.status_to).title, 'Application rejected');
  } finally { stop(); }
});

test('Broker API OAuth: client-credentials token from authx replaces Basic auth', async () => {
  Object.assign(process.env, { BROKER_CLIENT_ID: 'BCID', BROKER_CLIENT_SECRET: 'BCSECRET', BROKER_TOKEN_URL: mock.url + '/v1/oauth2/token' });
  try {
    const call = client();
    await call('/auth/register', { email: 'oauthbroker@t.co', password: 'Str0ngPassword' });
    const r = await call('/alpaca/broker/accounts', { ...FORM, email: 'ob@example.com' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(lastReq(x => x.path === '/v1/accounts' && x.method === 'POST').headers.authorization, 'Bearer broker-token');
    assert.equal(lastReq(x => x.path === '/v1/oauth2/token').body.grant_type, 'client_credentials');
    await call('/alpaca/broker/account');
    assert.equal(mock.log.filter(x => x.path === '/v1/oauth2/token').length, 1); // token cached
  } finally { for (const k of ['BROKER_CLIENT_ID', 'BROKER_CLIENT_SECRET', 'BROKER_TOKEN_URL']) delete process.env[k]; }
});

test('API keys: every order type, modify/cancel, positions, portfolio, watchlists, config', async () => {
  const call = client();
  await call('/auth/register', { email: 'keys@t.co', password: 'Str0ngPassword' });
  assert.equal((await call('/alpaca/keys', { keyId: 'UKEY', secret: 'USECRET' })).status, 200);
  assert.equal(lastReq(r => r.path === '/v2/account').headers['apca-api-key-id'], 'UKEY');
  const st = (await call('/alpaca/status')).body;
  assert.deepEqual([st.active.type, st.data, st.broker.enabled, st.oauth.enabled], ['keys', true, true, true]);

  const orders = [
    { symbol: 'AAPL', qty: 1, type: 'market' },
    { symbol: 'AAPL', qty: 1, type: 'stop', stop_price: 140, side: 'sell' },
    { symbol: 'AAPL', qty: 1, type: 'trailing_stop', trail_percent: 3, side: 'sell' },
    { symbol: 'AAPL', qty: 1, type: 'limit', limit_price: 100, order_class: 'bracket', take_profit_price: 120, stop_loss_price: 90 },
    { symbol: 'ETH/USD', qty: 0.5, type: 'limit', limit_price: 3000 },
    { order_class: 'mleg', qty: 1, type: 'limit', limit_price: 1.5, legs: [{ symbol: 'AAPL261120C00150000', side: 'buy', ratio_qty: 1 }, { symbol: 'AAPL261120P00150000', side: 'buy', ratio_qty: 1 }] },
  ];
  const ids = [];
  for (const o of orders) { const r = await call('/alpaca/orders', o); assert.equal(r.status, 200, JSON.stringify(r.body)); ids.push(r.body.id); }
  assert.equal((await call('/alpaca/orders', { symbol: 'AAPL', qty: 1, type: 'limit' })).status, 400);
  assert.equal((await call('/alpaca/orders?status=open')).body.length, orders.length);
  const rep = await call('/alpaca/orders/' + ids[1], { stop_price: 145 }, 'PATCH');
  assert.equal(rep.body.replaces, ids[1]);
  assert.equal((await call('/alpaca/orders/' + ids[0], null, 'DELETE')).status, 200);
  assert.equal((await call('/alpaca/orders/nope', null, 'DELETE')).status, 404);
  const cancelled = (await call('/alpaca/orders', null, 'DELETE')).body;
  assert.ok(cancelled.length >= 4);

  const pos = (await call('/alpaca/positions')).body;
  assert.deepEqual([pos[0].symbol, pos[0].qty, pos[0].unrealizedPl, pos[0].unrealizedPlPct], ['AAPL', 10, 300, 20]);
  assert.equal((await call('/alpaca/positions/AAPL?qty=4', null, 'DELETE')).body.qty, '4');
  assert.equal(lastReq(r => r.method === 'DELETE' && r.path === '/v2/positions/AAPL').query.qty, '4');
  assert.equal((await call('/alpaca/positions/AAPL?percentage=50', null, 'DELETE')).body.qty, '3');
  assert.equal((await call('/alpaca/positions/AAPL?percentage=500', null, 'DELETE')).status, 400);
  assert.equal((await call('/alpaca/positions', null, 'DELETE')).status, 200);

  const h = (await call('/alpaca/portfolio/history?period=1M')).body;
  assert.equal(h.points.length, 3); assert.equal(h.baseValue, 100000);
  const acct = (await call('/alpaca/account')).body;
  assert.deepEqual([acct.equity, acct.maintenanceMargin, acct.optionsLevel], [101800, 540, 2]);
  assert.equal((await call('/alpaca/account/config', { pdt_check: 'both', no_shorting: true }, 'PATCH')).body.no_shorting, true);
  assert.equal((await call('/alpaca/account/config', { pdt_check: 'nope' }, 'PATCH')).status, 400);

  const wl = (await call('/alpaca/watchlists', { name: 'Tech', symbols: ['AAPL'] })).body;
  await call(`/alpaca/watchlists/${wl.id}/assets`, { symbol: 'msft' });
  assert.deepEqual((await call('/alpaca/watchlists/' + wl.id)).body.assets.map(a => a.symbol), ['AAPL', 'MSFT']);
  await call(`/alpaca/watchlists/${wl.id}/assets/AAPL`, null, 'DELETE');
  assert.equal((await call('/alpaca/watchlists/' + wl.id, { name: 'Big tech' }, 'PUT')).body.name, 'Big tech');
  assert.equal((await call('/alpaca/watchlists/' + wl.id, null, 'DELETE')).status, 200);
  assert.equal((await call('/alpaca/watchlists')).body.length, 0);

  assert.equal((await call('/alpaca/calendar')).body.length, 2);
  assert.equal((await call('/alpaca/assets/search?q=AM')).body[0].symbol, 'AMZN');
  assert.equal((await call('/alpaca/announcements')).body[0].ca_type, 'dividend');
});

test('market data: bars (paginated), quotes, snapshots, movers, news, option chain, corporate actions', async () => {
  const call = client();
  await call('/auth/register', { email: 'data@t.co', password: 'Str0ngPassword' });
  const b = (await call('/alpaca/data/bars?symbols=AAPL,BTC/USD&timeframe=1Day')).body;
  assert.equal(b.AAPL.length, 4); assert.equal(b['BTC/USD'].length, 4); // two pages merged
  assert.equal(lastReq(r => r.path === '/v2/stocks/bars').headers['apca-api-key-id'], 'DKEY');
  assert.equal((await call('/alpaca/data/bars?symbols=AAPL&timeframe=2Day')).status, 400);
  const l = (await call('/alpaca/data/latest?symbols=AAPL,BTC/USD')).body;
  assert.deepEqual([l.AAPL.quote.ap, l['BTC/USD'].trade.p], [100.5, 100]);
  const s = (await call('/alpaca/data/snapshots?symbols=AAPL,BTC/USD')).body;
  assert.equal(Math.round(s.AAPL.changePct), 10); assert.equal(Math.round(s['BTC/USD'].changePct), 20);
  assert.equal((await call('/alpaca/data/most-actives')).body.most_actives[0].symbol, 'NVDA');
  assert.equal((await call('/alpaca/data/movers')).body.gainers[0].symbol, 'XYZ');
  assert.equal((await call('/alpaca/data/news?symbols=AAPL')).body[0].headline, 'Apple beats estimates');
  const ch = (await call('/alpaca/data/options/AAPL')).body;
  assert.deepEqual(ch.expirations, ['2026-11-20', '2026-12-18']);
  const c = ch.contracts.find(x => x.symbol === 'AAPL261120C00150000');
  assert.deepEqual([c.type, c.strike, c.iv, c.greeks.delta], ['call', 150, 0.31, 0.55]);
  assert.ok((await call('/alpaca/data/corporate-actions?symbols=AAPL')).body.cash_dividends);
});

test('OAuth2: state-checked authorization code flow, then trading with the Bearer token', async () => {
  const call = client();
  await call('/auth/register', { email: 'oauth@t.co', password: 'Str0ngPassword' });
  const start = (await call('/alpaca/oauth/start')).body.url;
  const u = new URL(start);
  assert.deepEqual([u.searchParams.get('response_type'), u.searchParams.get('client_id')], ['code', 'cid']);
  const state = u.searchParams.get('state');
  const cookie = call.length && (await call('/auth/me')).cookie();
  // Wrong state is rejected; the right state with a valid code connects the account.
  let r = await fetch(`${base}/oauth/alpaca/callback?state=bad&code=good-code`, { redirect: 'manual', headers: { cookie } });
  assert.match(r.headers.get('location'), /error=/);
  r = await fetch(`${base}/oauth/alpaca/callback?state=${state}&code=good-code`, { redirect: 'manual', headers: { cookie } });
  assert.equal(r.headers.get('location'), '/app#/account?connected=oauth');
  const tok = lastReq(x => x.path === '/oauth/token');
  assert.deepEqual([tok.body.grant_type, tok.body.client_secret], ['authorization_code', 'csecret']);
  assert.equal((await call('/alpaca/status')).body.active.type, 'oauth');
  await call('/alpaca/orders', { symbol: 'AAPL', qty: 1 });
  assert.equal(lastReq(x => x.method === 'POST' && x.path === '/v2/orders').headers.authorization, 'Bearer oauth-token-123');
  // A replayed state is rejected.
  r = await fetch(`${base}/oauth/alpaca/callback?state=${state}&code=good-code`, { redirect: 'manual', headers: { cookie } });
  assert.match(r.headers.get('location'), /error=/);
});

test('SSE stream endpoint answers even without a live feed', async () => {
  const call = client();
  await call('/auth/register', { email: 'sse@t.co', password: 'Str0ngPassword' });
  const r = await fetch(base + '/api/alpaca/stream?symbols=AAPL', { headers: { cookie: (await call('/auth/me')).cookie(), Accept: 'text/event-stream' } });
  assert.equal(r.headers.get('content-type'), 'text/event-stream');
  const reader = r.body.getReader(), first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: hello/);
  reader.cancel();
});
