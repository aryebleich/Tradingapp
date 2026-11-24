// Part 1 of the OpenAI brief: the key formats are checked, and a signing secret saved under an API-key
// name is moved to its own name once. Only prefixes and names are ever checked or logged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormat, misfileTarget, openAIWarnings, kindOf } from '../src/key-format.js';

const WHSEC = 'whsec_' + Buffer.from('signing-secret-for-tests-0001').toString('base64');
const SK = 'sk-proj-testonlyNotARealKey1234567890';

test('a whsec_ value is refused in OPENAI_API_KEY and the message names OPENAI_WEBHOOK_SECRET', () => {
  const r = checkFormat('OPENAI_API_KEY', WHSEC);
  assert.equal(r.ok, false);
  assert.match(r.message, /webhook signing secret/);
  assert.match(r.message, /OPENAI_WEBHOOK_SECRET/);
  assert.equal(misfileTarget('OPENAI_API_KEY', WHSEC), 'OPENAI_WEBHOOK_SECRET');
});

test('a real sk- key is accepted in OPENAI_API_KEY, and refused in the signing-secret field', () => {
  assert.deepEqual(checkFormat('OPENAI_API_KEY', SK), { ok: true });
  assert.equal(kindOf(SK), 'sk');
  const r = checkFormat('OPENAI_WEBHOOK_SECRET', SK);
  assert.equal(r.ok, false);
  assert.match(r.message, /OPENAI_API_KEY/);
});

test('the signing secret is accepted in its own field', () => {
  assert.deepEqual(checkFormat('OPENAI_WEBHOOK_SECRET', WHSEC), { ok: true });
  assert.equal(misfileTarget('OPENAI_WEBHOOK_SECRET', WHSEC), null);
});

test('a value that is neither sk- nor whsec_ is not refused (other providers use other formats)', () => {
  assert.deepEqual(checkFormat('ANTHROPIC_API_KEY', 'sk-ant-something'), { ok: true });
  assert.deepEqual(checkFormat('GROQ_API_KEY', 'gsk_something'), { ok: true });
});

test('warnings: a signing secret in the API-key place gives the exact message from the brief', () => {
  const w = openAIWarnings({ apiKey: WHSEC, signingSecret: WHSEC, movedFrom: true });
  assert.ok(w.includes('The OpenAI API key is missing (the value saved was a webhook signing secret). Add your API key from platform.openai.com → API keys.'));
  assert.equal(w.length, 1, 'no second warning when the signing secret is set');
});

test('warnings: no key and no signing secret are both reported; a real key gives none', () => {
  assert.equal(openAIWarnings({ apiKey: '', signingSecret: '' }).length, 2);
  assert.deepEqual(openAIWarnings({ apiKey: SK, signingSecret: WHSEC }), []);
});

let K, DB;
before(async () => {
  K = await import('../src/keystore.js');
  DB = await import('../src/db.js');
  await K.initKeystore({ every: 0 }); // creates the secrets table, as the server does at start
});
after(async () => {
  await K.removeSecret('OPENAI_WEBHOOK_SECRET').catch(() => {});
  await K.removeSecret('OPENAI_API_KEY').catch(() => {});
});

test('the key store refuses a signing secret in the API-key field and an API key in the signing-secret field', async () => {
  await assert.rejects(() => K.setSecret('OPENAI_API_KEY', WHSEC), e => e.status === 400 && /OPENAI_WEBHOOK_SECRET/.test(e.message));
  await assert.rejects(() => K.setSecret('OPENAI_WEBHOOK_SECRET', SK), e => e.status === 400 && /OPENAI_API_KEY/.test(e.message));
  await K.setSecret('OPENAI_API_KEY', SK);
  assert.equal(K.secret('OPENAI_API_KEY'), SK);
});

test('a signing secret saved under OPENAI_API_KEY before the check existed is moved once to OPENAI_WEBHOOK_SECRET', async () => {
  const { encrypt } = await import('../src/crypto.js');
  const t = Date.now();
  // Written straight into the table, the way an old save would have stored it.
  await DB.run('INSERT INTO secrets (name, blob, last4, updated_at, created_at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET blob = excluded.blob, last4 = excluded.last4, updated_at = excluded.updated_at',
    'OPENAI_API_KEY', encrypt({ v: WHSEC }), WHSEC.slice(-4), t, t);
  await K.refresh(); // load the row just written
  const moved = await K.moveMisfiled();
  assert.deepEqual(moved.map(m => [m.from, m.to]), [['OPENAI_API_KEY', 'OPENAI_WEBHOOK_SECRET']]);
  assert.equal(K.secret('OPENAI_WEBHOOK_SECRET'), WHSEC);
  assert.notEqual(K.secret('OPENAI_API_KEY'), WHSEC, 'the signing secret no longer stands as the API key');
  // Running it again changes nothing.
  assert.deepEqual(await K.moveMisfiled(), []);
});
