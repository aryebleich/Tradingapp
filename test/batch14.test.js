// Opening a brokerage account by text, and the phone line's caller-ID sign-up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startMock } from './mock-alpaca.js';

const mock = await startMock();
let media;
const IMG = Buffer.from('\xff\xd8\xff\xe0fake-jpeg', 'binary');
media = http.createServer((req, res) => { res.setHeader('Content-Type', req.url.includes('png') ? 'image/png' : 'image/jpeg'); res.end(IMG); });
await new Promise(r => media.listen(0, '127.0.0.1', r));
const mediaUrl = `http://127.0.0.1:${media.address().port}`;
Object.assign(process.env, { BROKER_API_KEY: 'BKEY', BROKER_API_SECRET: 'BSECRET', BROKER_BASE_URL: mock.url, TWILIO_API_URL: mediaUrl, ALPACA_DATA_URL: mock.url, ALPACA_KEY_ID: 'DKEY', ALPACA_SECRET: 'DSECRET' });
const { app } = await import('../server.js');
const TA = await import('../src/textapply.js');
const { one } = await import('../src/db.js');

let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); mock.close(); media.close(); });

const text = async (from, body = '', urls = []) => {
  const p = new URLSearchParams({ From: from, Body: body, NumMedia: String(urls.length) });
  urls.forEach((u, i) => { p.set('MediaUrl' + i, mediaUrl + u); p.set('MediaContentType' + i, 'image/jpeg'); });
  const r = await fetch(base + '/twilio/sms', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
  const x = await r.text();
  return (/<Message>([\s\S]*)<\/Message>/.exec(x)?.[1] || '').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
};

test('apply by text: photos read, missing details asked, a fix, then sent to Alpaca', async () => {
  // The ID shows the name and date of birth but not all four corners; the card shows the SSN.
  TA.setReader(async () => null);
  const reads = { '/id.jpg': { kind: 'id', idType: 'drivers_license', fullCardVisible: false, givenName: 'Example', middleName: '', familyName: 'Person', dateOfBirth: '1990-04-27', street: '', unit: '', city: '', state: '', postalCode: '', ssn: '' },
    '/card.jpg': { kind: 'ssn_card', idType: 'none', fullCardVisible: true, givenName: 'Example', middleName: '', familyName: 'Person', dateOfBirth: '', street: '', unit: '', city: '', state: '', postalCode: '', ssn: '123-45-1234' },
    '/full.jpg': { kind: 'id', idType: 'drivers_license', fullCardVisible: true, givenName: 'Example', middleName: '', familyName: 'Person', dateOfBirth: '1990-04-27', street: '', unit: '', city: '', state: '', postalCode: '', ssn: '' },
    '/spouse.jpg': { kind: 'ssn_card', idType: 'none', fullCardVisible: true, givenName: 'Other', middleName: '', familyName: 'Person', dateOfBirth: '', street: '', unit: '', city: '', state: '', postalCode: '', ssn: '123-45-9999' } };
  let last;
  const http0 = TA.setReader;
  http0(async () => reads[last]);
  const send = async (body, url) => { last = url; return text('+18455550199', body, url ? [url] : []); };

  // Strangers get the sign-up by text; APPLY starts the brokerage application.
  assert.match(await send('hi'), /Welcome to Brightolio!/);
  let r = await send('APPLY');
  assert.match(r, /^Welcome to Brightolio - apply by text\./);
  assert.match(r, /Reply NO ID/); assert.match(r, /Reply CONTINUE/); assert.match(r, /Reply RESTART/);
  r = await send('', '/id.jpg'); assert.match(r, /Got your ID\. Now please text a clear photo of your Social Security card/);
  r = await send('', '/card.jpg'); assert.match(r, /Got your Social Security card and ID\./); assert.match(r, /FULL ID/);
  // CONTINUE repeats the question.
  assert.match(await send('CONTINUE'), /FULL ID/);
  r = await send('', '/full.jpg'); assert.match(r, /We could not read everything from the photos, so we need a few details\./); assert.match(r, /street address/);
  // Nothing sensitive is stored in the clear.
  const row = await one("SELECT data FROM text_applications WHERE phone = '+18455550199'");
  assert.ok(row && !row.data.includes('123451234') && !row.data.includes('Example'));
  assert.match(await send('1 Example Ct #101'), /What city\?/);
  assert.match(await send('Monroe'), /What state\? \(2 letters, like NY\)/);
  assert.match(await send('ZZ'), /2-letter state code/);
  assert.match(await send('ny'), /5-digit ZIP code/);
  r = await send('10950'); assert.match(r, /email address/);
  r = await send('example@example.com');
  assert.match(r, /Please check what we have:\nName: EXAMPLE PERSON\nDate of birth: 04\/27\/1990\nAddress: 1 EXAMPLE CT #101, MONROE, NY 10950\nSSN: xxx-xx-1234\n1\. All correct\n2\. Something is wrong\nReply with the NUMBER 1 or 2\./);
  // Something is wrong: the date of birth.
  assert.match(await send('2'), /What is wrong\?/);
  assert.match(await send('2'), /date of birth/);
  assert.match(await send('13/45/1990'), /like 04\/27\/1990/);
  r = await send('04/28/1990'); assert.match(r, /Date of birth: 04\/28\/1990/);
  assert.match(await send('1'), /Is ANY of these true\?/);
  assert.match(await send('1'), /work status/);
  assert.match(await send('1'), /employer/);
  assert.match(await send('Example Co'), /job title/);
  assert.match(await send('Manager'), /Are you married\?/);
  assert.match(await send('1'), /spouse's Social Security card/);
  r = await send('', '/spouse.jpg'); assert.match(r, /spouse's phone number/);
  assert.match(await send('845 555 0100'), /Reply AGREE/);
  r = await send('AGREE');
  assert.match(r, /Your application was sent/);
  const sent = mock.log.filter(x => x.method === 'POST' && x.path === '/v1/accounts').at(-1).body;
  assert.equal(sent.identity.given_name, 'Example'); assert.equal(sent.identity.date_of_birth, '1990-04-28'); assert.equal(sent.identity.tax_id, '123-45-1234');
  assert.deepEqual(sent.contact.street_address, ['1 Example Ct']); assert.equal(sent.contact.unit, '#101'); assert.equal(sent.contact.state, 'NY');
  assert.equal(sent.documents.length, 1); assert.equal(sent.documents[0].document_sub_type, 'drivers_license');
  assert.equal(sent.trusted_contact.given_name, 'Other'); assert.equal(sent.trusted_contact.phone_number, '+18455550100');
  assert.equal(sent.disclosures.employer_name, 'Example Co');
  // The application data is gone; the phone now has an account linked to the brokerage account.
  assert.equal(await one("SELECT 1 FROM text_applications WHERE phone = '+18455550199'"), undefined);
  const u = await one("SELECT * FROM users WHERE phone = '+18455550199'");
  assert.ok(u?.phone_verified); assert.ok(await one('SELECT 1 FROM broker_accounts WHERE user_id = ?', u.id));
});

test('apply by text without photos, RESTART, CANCEL and the in-app hand-off', async () => {
  TA.setReader(async () => null);
  const t = (b, u) => text('+18455550188', b, u);
  assert.match(await t('APPLY'), /Welcome to Brightolio - apply by text/);
  assert.match(await t('NO ID'), /Social Security card/);
  {
    const x = await t('NO CARD'); assert.match(x, /We need a few details\./); assert.match(x, /first name/);
  }
  assert.match(await t('Sam'), /last name/);
  assert.match(await t('RESTART'), /cleared[\s\S]*Welcome/);
  assert.match(await t('CONTINUE'), /photo of your ID and of your Social Security card/);
  assert.match(await t('CANCEL'), /cancelled/);
  assert.equal(await one("SELECT 1 FROM text_applications WHERE phone = '+18455550188'"), undefined);
  // A photo nobody can read (AI off) still counts, and the details are asked.
  await t('APPLY');
  assert.match(await t('', ['/a.jpg']), /Got your ID/);
  assert.match(await t('', ['/b.jpg']), /Got your Social Security card and ID\.[\s\S]*We could not read everything/);
  for (const v of ['Sam', 'Tester', '01/02/1980', '5 Main St', 'Albany', 'NY', '12207', '123456789', 'sam@example.com']) await t(v);
  assert.match(await t('1'), /Is ANY/);
  assert.match(await t('2'), /finish your application in the Brightolio app/);
  assert.equal(await one("SELECT 1 FROM text_applications WHERE phone = '+18455550188'"), undefined);
  // TALK reaches the business inbox instead.
  assert.match(await t('TALK to someone'), /Thanks for your message/);
});

test('phone line: a caller the carrier vouches for opens an account on the call, no code', async () => {
  const from = '+18455550177';
  const post = async (path, extra = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: from, CallSid: 'CAstir', StirVerstat: 'TN-Validation-Passed-A', ...extra }) });
    const x = await r.text();
    return { say: [...x.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map(m => m[1]).join(' '), next: (/<Gather[^>]*action="([^"]+)"/.exec(x)?.[1] || '').replace(/&amp;/g, '&') };
  };
  let r = await post('/twilio/voice'); r = await post(r.next, { Digits: '1' });
  assert.match(r.say, /choose a 4-digit PIN/);
  r = await post(r.next, { Digits: '2580' }); r = await post(r.next, { Digits: '2580' });
  assert.match(r.say, /Your free account is ready/);
  const u = await one('SELECT * FROM users WHERE phone = ?', from);
  assert.ok(u?.pin_hash && u.phone_verified);
});

test('android app: a browser sign-in hands the app a one-time code for its own session', async () => {
  const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' };
  let r = await fetch(base + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ email: 'droid@example.com', password: 'Str0ngPassword1', agree: true }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  // Not signed in: to the sign-in page, which comes back here afterwards.
  r = await fetch(base + '/api/auth/app-handoff', { redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/app?next=handoff#/login');
  r = await fetch(base + '/api/auth/app-handoff', { redirect: 'manual', headers: { cookie } });
  const loc = r.headers.get('location'); assert.match(loc, /^brightfolio:\/\/signin\?code=/);
  const code = decodeURIComponent(loc.split('code=')[1]);
  const x = await (await fetch(base + '/api/auth/app-exchange', { method: 'POST', headers: H, body: JSON.stringify({ code }) })).json();
  assert.ok(x.token && x.user.email === 'droid@example.com');
  const me = await (await fetch(base + '/api/auth/me', { headers: { cookie: 'qp_sid=' + x.token } })).json();
  assert.equal(me.user.email, 'droid@example.com');
  // A code works once.
  assert.equal((await fetch(base + '/api/auth/app-exchange', { method: 'POST', headers: H, body: JSON.stringify({ code }) })).status, 401);
  // Email sign-in from the app: the session arrives as a cookie.
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ email: 'droid@example.com', password: 'Str0ngPassword1' }) });
  assert.match(r.headers.get('set-cookie'), /^qp_sid=[^;]+/);
});
