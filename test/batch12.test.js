// All my money (banks through Plaid, crypto wallets, net worth, cash flow) and rules across accounts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { serve } from './client.js';
import { planRebalance } from '../src/rules.js';

let fake;
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const send = x => res.end(JSON.stringify(x));
      if (req.url === '/link/token/create') return send({ link_token: 'link-1' });
      if (req.url === '/item/public_token/exchange') return send({ access_token: 'access-1' });
      if (req.url === '/accounts/get') return send({ accounts: [
        { account_id: 'chk', name: 'Checking', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 5000 } },
        { account_id: 'cc', name: 'Card', mask: '9876', type: 'credit', subtype: 'credit card', balances: { current: 800 } },
        { account_id: 'mtg', name: 'Home loan', type: 'loan', subtype: 'mortgage', balances: { current: 200000 } }] });
      if (req.url === '/transactions/sync') return send({ added: [
        { transaction_id: 't1', account_id: 'chk', date: new Date().toISOString().slice(0, 10), name: 'Payroll', amount: -4000, personal_finance_category: { primary: 'INCOME' } },
        { transaction_id: 't2', account_id: 'chk', date: new Date().toISOString().slice(0, 10), name: 'Grocer', amount: 300, personal_finance_category: { primary: 'FOOD_AND_DRINK' } },
        { transaction_id: 't3', account_id: 'chk', date: new Date().toISOString().slice(0, 10), name: 'Card payment', amount: 700, personal_finance_category: { primary: 'LOAN_PAYMENTS' } }], removed: [], next_cursor: 'c1', has_more: false });
      if (req.url === '/item/remove') return send({});
      if (req.url.startsWith('/address/')) return send({ chain_stats: { funded_txo_sum: 150000000, spent_txo_sum: 50000000 }, mempool_stats: {} });
      if (req.url === '/eth') return send({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' }); // 1 ETH
      res.statusCode = 404; send({});
    });
  });
  await new Promise(r => fake.listen(0, r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { PLAID_CLIENT_ID: 'pc', PLAID_SECRET: 'ps', PLAID_BASE_URL: url, BTC_API_URL: url, ETH_RPC_URL: url + '/eth' });
});
after(() => fake.close());

test('all my money: banks, cards, loans, wallets, net worth and cash flow', async () => {
  const s = await serve();
  try {
    const u = s.client(); await u.signup('money@example.com');
    assert.equal((await u('/money/link-token', {})).body.linkToken, 'link-1');
    assert.equal((await u('/money/exchange', { publicToken: 'pub', institution: 'Test Bank' })).status, 200);
    assert.equal((await u('/money/wallets', { chain: 'btc', address: 'not-an-address' })).status, 400);
    assert.equal((await u('/money/wallets', { chain: 'btc', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', label: 'Cold' })).body.amount, 1);
    assert.equal((await u('/money/wallets', { chain: 'eth', address: '0x' + 'a'.repeat(40) })).body.amount, 1);
    const d = (await u('/money')).body;
    assert.equal(d.parts.cash, 5000); assert.equal(d.parts.creditCards, -800); assert.equal(d.parts.mortgages, -200000);
    assert.equal(d.wallets.length, 2);
    assert.equal(d.debts, -200800); assert.equal(d.netWorth, +(d.assets + d.debts).toFixed(2));
    const m = d.cashflow.months.at(-1);
    assert.equal(m.moneyIn, 4000); assert.equal(m.moneyOut, 300, 'the card payment is not counted twice');
    // Another user sees none of it.
    const o = s.client(); await o.signup('money-other@example.com');
    const od = (await o('/money')).body; assert.equal(od.items.length, 0); assert.equal(od.wallets.length, 0);
    assert.equal((await o('/money/banks/' + d.items[0].id, null, 'DELETE')).status, 404);
    assert.equal((await u('/money/banks/' + d.items[0].id, null, 'DELETE')).status, 200);
    assert.equal((await u('/money')).body.items.length, 0);
  } finally { s.close(); }
});

test('planRebalance: sells first, then buys with the freed cash, within the options', () => {
  const rule = { targets: [{ symbol: 'VTI', pct: 60 }, { symbol: 'BND', pct: 40 }], accounts: ['a', 'b'], options: { driftPct: 5, cashPct: 0, wholeShares: false, buyOnly: false, skipGains: false, minTrade: 25, sellOthers: false } };
  const sums = { a: { cash: 0, positions: [{ symbol: 'VTI', value: 8000, pnl: 500, price: 100 }] }, b: { cash: 2000, positions: [] } };
  const p = planRebalance(rule, sums);
  assert.equal(p.total, 10000); assert.equal(p.drift, 40); assert.ok(p.needed);
  const sell = p.orders.find(o => o.side === 'sell'), buy = p.orders.filter(o => o.side === 'buy');
  assert.equal(sell.symbol, 'VTI'); assert.equal(sell.dollars, 2000);
  assert.equal(buy.reduce((s, o) => s + o.dollars, 0), 4000);
  // Buy only: no sells; skip gains: the VTI at a gain is not sold.
  assert.ok(!planRebalance({ ...rule, options: { ...rule.options, buyOnly: true } }, sums).orders.some(o => o.side === 'sell'));
  assert.ok(!planRebalance({ ...rule, options: { ...rule.options, skipGains: true } }, sums).orders.some(o => o.side === 'sell'));
  // Whole shares round down; a small drift needs nothing.
  assert.ok(planRebalance({ ...rule, options: { ...rule.options, wholeShares: true } }, sums, { BND: 70 }).orders.every(o => Number.isInteger(o.qty)));
  assert.equal(planRebalance({ ...rule, options: { ...rule.options, driftPct: 45 } }, sums).needed, false);
});

test('rules across accounts: create, check, prepare, approve on the paper account', async () => {
  const s = await serve();
  try {
    const u = s.client(); await u.signup('rules@example.com');
    const d = (await u('/rules')).body;
    assert.ok(d.templates['60/40'] && d.schedules.includes('quarterly'));
    assert.equal((await u('/rules', { name: 'x', targets: [{ symbol: 'VTI', pct: 60 }, { symbol: 'BND', pct: 30 }], accounts: ['paper'] })).status, 400, 'must add up to 100');
    assert.equal((await u('/rules', { name: 'x', targets: [{ symbol: 'VTI', pct: 100 }], accounts: [] })).status, 400);
    const c = await u('/rules', { name: 'Everything in VTI', targets: [{ symbol: 'VTI', pct: 100 }], accounts: ['paper'], schedule: 'quarterly', options: { driftPct: 1, cashPct: 0 } });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const id = c.body.id;
    const pv = await u(`/rules/${id}/preview`);
    assert.equal(pv.status, 200);
    assert.ok(pv.body.orders.some(o => o.side === 'buy' && o.symbol === 'VTI'), JSON.stringify(pv.body));
    assert.equal((await u(`/rules/${id}/prepare`, {})).status, 200);
    const pending = (await u('/rules')).body.rules[0].pending;
    assert.ok(pending.orders.length >= 1);
    const o = s.client(); await o.signup('rules-other@example.com');
    assert.equal((await o(`/rules/${id}/approve`, {})).status, 404);
    const a = await u(`/rules/${id}/approve`, {});
    assert.equal(a.status, 200); assert.ok(a.body.results.length >= 1);
    assert.equal((await u('/rules')).body.rules[0].pending, null);
    assert.equal((await u(`/rules/${id}/approve`, {})).status, 404, 'approved once only');
    assert.equal((await u(`/rules/${id}`, { name: 'Renamed', targets: [{ symbol: 'VTI', pct: 100 }], accounts: ['paper'], active: false }, 'PUT')).status, 200);
    assert.equal((await u('/rules')).body.rules[0].active, false);
    assert.equal((await u(`/rules/${id}`, null, 'DELETE')).status, 200);
  } finally { s.close(); }
});

test('trust: status checks, incidents, and only the audit stage the admin enters', async () => {
  const { checkAll } = await import('../src/trust.js');
  const s = await serve();
  try {
    await checkAll(Date.now() - 864e5); await checkAll();
    const guest = s.client();
    let st = (await guest('/public/status')).body;
    assert.equal(st.overall, 'ok'); assert.equal(st.components.length, 5);
    assert.equal(st.components[0].days.length, 90); assert.equal(st.components[0].uptime, 100);
    let t = (await guest('/public/trust')).body;
    assert.equal(t.soc2.stage, 'none'); assert.equal(t.soc2.label, 'Not audited yet'); assert.deepEqual(t.insurance, []);
    assert.equal((await guest('/admin/trust')).status, 401);
    const u = s.client(); await u.signup('trust-user@example.com');
    assert.equal((await u('/admin/trust', { soc2: { stage: 'type2' } }, 'PUT')).status, 403);
    const owner = s.client(); await owner.signup('site-owner@example.com');
    const i = await owner('/admin/trust/incidents', { title: 'Orders slow', impact: 'major', status: 'investigating', components: ['trading', 'nope'], text: 'Looking into it' });
    assert.equal(i.status, 200);
    st = (await guest('/public/status')).body;
    assert.equal(st.overall, 'down'); assert.equal(st.components.find(c => c.id === 'trading').state, 'down');
    assert.deepEqual(st.incidents[0].components, ['trading']);
    assert.equal((await owner(`/admin/trust/incidents/${i.body.id}/update`, { status: 'resolved', text: 'Fixed' })).status, 200);
    st = (await guest('/public/status')).body;
    assert.equal(st.overall, 'ok'); assert.equal(st.incidents[0].updates.length, 2); assert.ok(st.incidents[0].resolvedAt);
    await owner('/admin/trust', { soc2: { stage: 'readiness', auditor: 'Example CPA' }, insurance: [{ kind: 'Cyber liability', limit: '$1,000,000' }, { kind: 'No limit given' }], securityContact: 'security@example.com' }, 'PUT');
    t = (await guest('/public/trust')).body;
    assert.equal(t.soc2.label, 'Getting ready for a SOC 2 audit'); assert.equal(t.soc2.requestable, false);
    assert.equal(t.insurance.length, 1); assert.equal(t.securityContact, 'security@example.com');
    for (const p of ['/status', '/security', '/insurance']) { const r = await fetch(s.base + p); assert.equal(r.status, 200); assert.match(await r.text(), /trust-page\.js/); }
  } finally { s.close(); }
});

test('the luach: Hebrew dates, zmanim, the year\'s days and the tzedakah ledger in maaser', async () => {
  const { hebrewDate, gematria, yearDays, zmanim } = await import('../src/zmanim.js');
  assert.equal(hebrewDate('2026-10-30').text, '19 Cheshvan 5787');
  assert.equal(hebrewDate('2026-10-30').yi, 'י״ט חשון תשפ״ז');
  assert.equal(hebrewDate('2027-03-23').text, '14 Adar II 5787');
  assert.equal(hebrewDate('2026-09-11').text, '29 Elul 5786');
  assert.deepEqual([gematria(15), gematria(16), gematria(1)], ['ט״ו', 'ט״ז', 'א׳']);
  const y = yearDays(5787), on = n => y.filter(d => d.name === n).map(d => d.date);
  assert.deepEqual(on('Purim'), ['2027-03-23']);
  assert.equal(on('Chanukah (1 candle)')[0], '2026-12-05');
  assert.deepEqual(on('Tisha B\'Av'), ['2027-08-12']);
  assert.deepEqual(on('Rosh Chodesh Kislev'), ['2026-11-10', '2026-11-11']);
  assert.deepEqual(on('Rosh Chodesh Teves'), ['2026-12-10', '2026-12-11'], 'during Chanukah too');
  // New York, 30 October 2026: sunrise about 7:24, sunset about 5:54 (EDT, UTC-4).
  const z = zmanim('2026-10-30'), hm = t => new Date(t - 4 * 3600e3).toISOString().slice(11, 16);
  assert.ok(['07:23', '07:24', '07:25'].includes(hm(z.sunrise)), hm(z.sunrise));
  assert.ok(['17:53', '17:54', '17:55'].includes(hm(z.sunset)), hm(z.sunset));
  assert.ok(z.alos < z.sunrise && z.shemaMGA < z.shemaGRA && z.chatzos < z.plag && z.sunset < z.tzeis && z.tzeis < z.rabbeinuTam);

  const s = await serve();
  try {
    const u = s.client(); await u.signup('luach@example.com');
    const d = (await u('/luach?date=2026-12-05')).body;
    assert.equal(d.today.hebrew.text, '25 Kislev 5787'); assert.ok(d.today.events.some(e => /Chanukah/.test(e.name)));
    assert.equal(d.settings.city, 'brooklyn'); assert.equal(d.settings.remind, false);
    const mth = (await u('/luach/month?y=2027&m=3')).body;
    assert.equal(mth.days.length, 31); assert.ok(mth.days[22].events.some(e => e.name === 'Purim'));
    assert.equal((await u('/luach/settings', { city: 'jerusalem', remind: true }, 'PUT')).body.city, 'jerusalem');
    assert.equal((await u('/luach/tzedakah', { amount: 0, recipient: 'x' })).status, 400);
    const yr = new Date().getFullYear();
    await u('/luach/tzedakah', { day: `${yr}-01-05`, amount: 180, recipient: 'Yeshiva' });
    await u('/luach/tzedakah', { day: `${yr}-02-05`, amount: 20, recipient: 'Yeshiva' });
    const t = (await u('/luach/tzedakah?year=' + yr)).body;
    assert.equal(t.total, 200); assert.deepEqual(t.byRecipient, [{ recipient: 'Yeshiva', amount: 200 }]);
    const m = (await u('/values/maaser', { year: yr, otherIncome: 5000, alreadyGiven: 100 })).body;
    assert.equal(m.ledger, 200); assert.equal(m.given, 300); assert.equal(m.remaining, 200);
    const o = s.client(); await o.signup('luach-other@example.com');
    assert.equal((await o('/luach/tzedakah?year=' + yr)).body.items.length, 0);
    await o('/luach/tzedakah/' + t.items[0].id, null, 'DELETE');
    assert.equal((await u('/luach/tzedakah?year=' + yr)).body.items.length, 2, 'cannot remove another user\'s gift');
    // Reminders: due a few hours before candle lighting, once.
    const { runLuachReminders } = await import('../src/luach.js');
    const { upcoming } = await import('../src/zmanim.js');
    const next = upcoming('jerusalem', Date.now(), 1)[0];
    assert.equal(await runLuachReminders(next.starts - 3 * 3600e3), 1);
    assert.equal(await runLuachReminders(next.starts - 2 * 3600e3), 0);
  } finally { s.close(); }
});

test('add-ons: switches, live property values, cap table, K-1s, weekly brief, tax autopilot', async () => {
  const { capStats } = await import('../src/altlive.js');
  const { bestLots, openLots, SWAPS } = await import('../src/taxpilot.js');
  // Cap table: 1,000,000 shares before; bought 50,000 more in the A round; ownership after each round.
  const st = capStats({ myShares: 1050000, options: 10000, strike: 0.5, rounds: [{ name: 'Seed', price: 1, sharesAfter: 10e6, myNewShares: 0 }, { name: 'A', price: 3, sharesAfter: 15e6, myNewShares: 50000, preMoney: 30e6, raised: 15e6 }] });
  assert.equal(st.rounds[0].ownership, 10); assert.equal(st.rounds[1].ownership, 7); assert.equal(st.rounds[1].postMoney, 45e6);
  assert.equal(st.sharesValue, 3150000); assert.equal(st.optionsValue, 25000); assert.equal(st.impliedValue, 3175000);
  // Lots: the lowest-tax order sells the loss lot first.
  const day = 864e5, t = Date.now();
  const lots = openLots([{ account: 'a', symbol: 'X', side: 'buy', qty: 10, price: 50, at: t - 400 * day }, { account: 'a', symbol: 'X', side: 'buy', qty: 10, price: 120, at: t - 30 * day }, { account: 'a', symbol: 'X', side: 'buy', qty: 10, price: 90, at: t - 10 * day }, { account: 'a', symbol: 'X', side: 'sell', qty: 5, price: 100, at: t - 5 * day }]);
  assert.equal(lots.length, 3); assert.equal(lots[0].qty, 5);
  const b = bestLots(lots, 10, 100);
  assert.equal(b.methods.tax.lots[0].price, 120); assert.ok(b.methods.tax.tax < b.methods.fifo.tax); assert.ok(b.saves > 0);
  assert.equal(SWAPS.VOO, 'VTI'); assert.notEqual(SWAPS.VTI, 'VTI');

  let fake; const calls = [];
  fake = http.createServer((req, res) => { calls.push(req.url); res.setHeader('Content-Type', 'application/json'); if (req.headers['x-api-key'] !== 'rk') { res.statusCode = 401; return res.end('{}'); } if (req.url.startsWith('/avm/value')) return res.end(JSON.stringify({ price: 612000, priceRangeLow: 580000, priceRangeHigh: 640000 })); if (req.url.startsWith('/avm/rent')) return res.end(JSON.stringify({ rent: 3900, rentRangeLow: 3600, rentRangeHigh: 4200 })); res.statusCode = 404; res.end('{}'); });
  await new Promise(r => fake.listen(0, r));
  Object.assign(process.env, { RENTCAST_API_KEY: 'rk', RENTCAST_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  const s = await serve();
  try {
    const u = s.client(); const me = await u.signup('addons@example.com');
    let a = (await u('/addons')).body; assert.ok(Object.values(a.addons).every(Boolean), 'all on by default'); assert.equal(a.phoneLang, 'en');
    assert.ok((await u('/auth/me')).body.user.addons.brief);
    // Live property value.
    const home = (await u('/alts/realestate', { name: 'Two-family', type: 'rental', address: '12 Main St, Monsey, NY 10952', value: 550000, rent: 3500 })).body.id;
    const e = (await u('/altlive/estimate/' + home, {})).body;
    assert.equal(e.value, 612000); assert.equal(e.rent, 3900); assert.match(calls[0], /address=12%20Main/);
    assert.equal((await u('/altlive/estimate/' + home, { auto: true, apply: true }, 'PUT')).status, 200);
    const prop = (await u('/alts/realestate')).body.items[0];
    assert.equal(prop.value, 612000); assert.equal(prop.rent, 3900);
    // Cap table and using its value.
    const co = (await u('/alts/private', { name: 'Acme', type: 'equity', invested: 10000 })).body.id;
    const cap = (await u('/altlive/cap/' + co, { myShares: 10000, rounds: [{ name: 'Seed', price: 2, sharesAfter: 1e6, date: '2025-01-10' }] }, 'PUT')).body;
    assert.equal(cap.stats.ownership, 1); assert.equal(cap.stats.impliedValue, 20000);
    assert.equal((await u(`/altlive/cap/${co}/use-value`, {})).body.value, 20000);
    assert.equal((await u('/alts/private')).body.items[0].stats.value, 20000);
    // K-1: a fund is expected; a non-PDF upload is refused; boxes saved and totalled.
    const fund = (await u('/alts/private', { name: 'Real estate fund LP', type: 'fund', invested: 50000 })).body.id;
    const yr = new Date().getFullYear() - 1;
    let k = (await u('/altlive/k1?year=' + yr)).body; assert.deepEqual(k.missing, ['Real estate fund LP']);
    assert.equal((await u(`/altlive/k1/${fund}/${yr}`, { file: Buffer.from('not a pdf, just text that is long enough').toString('base64') }, 'PUT')).status, 400);
    const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(600)).toString('base64');
    k = (await u(`/altlive/k1/${fund}/${yr}`, { status: 'received', boxes: { 1: 1200, 2: -3400.5, '9a': 800, bogus: 5 }, file: pdf, fileName: 'k1.pdf' }, 'PUT')).body;
    assert.equal(k.received, 1); assert.deepEqual(k.missing, []); assert.equal(k.totals[2], -3400.5); assert.equal(k.totals.bogus, undefined);
    const f = await fetch(`${s.base}/api/altlive/k1/${fund}/${yr}/file`); assert.equal(f.status, 401, 'needs sign-in');
    // Weekly brief without an AI provider: a plain summary of the same numbers.
    const br = (await u('/brief/write', {})).body;
    assert.ok(br.headline && br.paragraphs.length >= 1); assert.equal(br.byAi, false); assert.match(br.paragraphs[0], /Net worth/);
    assert.equal((await u('/brief')).body.latest.week, br.week);
    // Tax autopilot page data, and the wash-sale guard on buying back.
    const tp = (await u('/taxpilot')).body; assert.ok(Array.isArray(tp.candidates)); assert.equal(tp.options.minLoss, 200);
    const { run } = await import('../src/db.js');
    await run('INSERT INTO tax_pilot (user_id, options) VALUES (?, ?)', me.id, JSON.stringify({ blocked: { VOO: Date.now() + 5 * day } })).catch(() => run('UPDATE tax_pilot SET options = ? WHERE user_id = ?', JSON.stringify({ blocked: { VOO: Date.now() + 5 * day } }), me.id));
    const { washBlock } = await import('../src/taxpilot.js');
    assert.ok(await washBlock(me.id, 'alpaca', 'VOO', 'buy')); assert.equal(await washBlock(me.id, 'paper', 'VOO', 'buy'), null); assert.equal(await washBlock(me.id, 'alpaca', 'VOO', 'sell'), null);
    assert.ok((await u('/taxpilot')).body.blocked.VOO);
    assert.equal((await u('/taxpilot/blocked/VOO', null, 'DELETE')).status, 200);
    assert.equal(await washBlock(me.id, 'alpaca', 'VOO', 'buy'), null);
    // Switching add-ons off closes their pages; phone language saved.
    a = (await u('/addons', { addons: { brief: false, taxPilot: false }, phoneLang: 'yi' }, 'PUT')).body;
    assert.equal(a.addons.brief, false); assert.equal(a.addons.capTable, true); assert.equal(a.phoneLang, 'yi');
    const off = await u('/brief'); assert.equal(off.status, 403); assert.equal(off.body.addonOff, 'brief');
    assert.equal((await u('/taxpilot')).status, 403);
  } finally { s.close(); fake.close(); }
});

test('Yiddish on the phone line: numbers in Yiddish order, clips played, missing pieces in English', async () => {
  const V = await import('../src/voice-yi.js');
  assert.deepEqual(V.numberKeys(25), ['n:5', 'w:and', 'n:20']);
  assert.deepEqual(V.numberKeys(21), ['n:1c', 'w:and', 'n:20']);
  assert.deepEqual(V.numberKeys(1250), ['n:1000', 'n:2', 'n:100', 'n:50']);
  assert.deepEqual(V.numberAsKeys('-3.5'), ['w:minus', 'n:3', 'w:point', 'n:5']);
  const wav = Buffer.alloc(2000, 1).toString('base64');
  for (const k of ['press', 'for account info', 'n:1']) await V.saveClip(k, 'audio/wav', wav);
  await assert.rejects(V.saveClip('press', 'audio/webm', wav), /MP3 or WAV/);
  const x = V.sayYiddish('Press 1 for account info. 2 for positions. Prices are delayed.', { base: 'https://x.test', voice: 'Polly.Joanna' });
  assert.equal((x.match(/<Play>/g) || []).length, 3, x);
  assert.match(x, /<Say voice="Polly.Joanna">2<\/Say>/); assert.match(x, /for positions/);
  const s = await serve();
  try {
    const r = await fetch(`${s.base}/voice/yi/${V.clipId('press')}`); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav');
    assert.equal((await fetch(`${s.base}/voice/yi/0123456789abcdef`)).status, 404);
    const owner = s.client(); await owner.signup('site-owner2@example.com');
    const l = (await owner('/admin/site/phone/clips')).body;
    assert.ok(l.sentences.find(x => x.k === 'press').id); assert.ok(l.numbers.find(x => x.k === 'n:1').id);
    await new Promise(r => setTimeout(r, 50));
    const h = (await owner('/admin/site/phone/clips')).body.heard;
    assert.ok(h.some(x => x.k === 'prices are delayed'), 'missing piece listed'); assert.ok(!h.some(x => x.k === 'for positions'), 'scripted pieces are listed under Sentences');
    assert.equal((await owner('/admin/site/phone', { yiddish: true, freePaper: true }, 'PUT')).body.settings.yiddish, true);
    // A caller: the menu offers 8 for Yiddish; pressing it plays the recordings and keeps the choice.
    const { createUser } = await import('../src/auth.js'), { run } = await import('../src/db.js');
    const me = { id: await createUser({ email: 'yi-caller@example.com' }) };
    await run("UPDATE users SET phone = '+18455550999', phone_verified = 1 WHERE id = ?", me.id);
    const post = async (path, digits) => { const r = await fetch(s.base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: '+18455550999', CallSid: 'CAyi1', ...(digits ? { Digits: digits } : {}) }) }); const t = await r.text(); return { t, next: (/<Gather[^>]*action="([^"]+)"/.exec(t)?.[1] || '').replace(/&amp;/g, '&') }; };
    let c = await post('/twilio/voice');
    assert.match(c.t, /8 for Yiddish/); assert.doesNotMatch(c.t, /<Play>/);
    c = await post(c.next, '8');
    assert.match(c.t, /<Play>/); assert.match(c.next, /l=yi/); assert.match(c.t, /for English/);
    const { getSetting } = await import('../src/settings.js');
    assert.equal(await getSetting(me.id, 'phoneLang'), 'yi');
    c = await post('/twilio/voice'); assert.match(c.t, /<Play>/, 'the next call starts in Yiddish');
  } finally { s.close(); }
});
