// The admin chat's failed replies explain themselves: a specific reason for each kind of failure, the
// reason kept with the reply (shown when the conversation is reopened), a keep-alive for long replies,
// Auto that skips a failing model and falls back when the first one fails before any text, and nothing
// secret or user-written in the logs or in the saved reasons.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
process.env.NODE_ENV = 'test'; process.env.AI_CHAT_FAKE_MODEL = '1';
for (const k of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AI_BASE_URL', 'AI_PROVIDER', 'OPENAI_API_KEY']) delete process.env[k];

const logs = []; const warn = console.warn.bind(console); console.warn = (...a) => { logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); warn(...a); };
const F = await import('../src/aichat/failure.js');
const L = await import('../src/llm.js');
const R = await import('../src/ai/router.js');
const { serve } = await import('./client.js');
const S = await serve();
after(() => S.close());

const KEY = 'sk-proj-SECRETVALUEdonotprint1234567890';
const err = (status, message = 'bad', extra = {}) => Object.assign(new Error(message), { status, ...extra });

// ===================================================================== the reasons
test('a 401 names the setting to check, for each provider', () => {
  const t = F.failureText('Gemini', 'gemini', err(401));
  assert.equal(t, 'Gemini refused the key (401). Check GEMINI_API_KEY in Admin → Keys.');
  assert.match(F.failureText('ChatGPT (OpenAI)', 'openai', err(401)), /OPENAI_API_KEY/);
});
test('a 429 says whether it is out of credit or only over its limit, and shows the provider\'s short code', () => {
  assert.match(F.failureText('ChatGPT (OpenAI)', 'openai', err(429, 'quota', { quota: true, providerCode: 'insufficient_quota' })), /out of credit or over its quota \(429\) \(insufficient_quota\)/);
  assert.match(F.failureText('Groq', 'groq', err(429, 'slow down', { providerCode: 'rate_limit_exceeded' })), /over its limit right now \(429\) \(rate_limit_exceeded\)\. Try again later, or pick another model\./);
});
test('a timeout says how long it waited', () => {
  const t = F.failureText('ChatGPT (OpenAI)', 'openai', Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
  assert.equal(t, 'ChatGPT (OpenAI) took too long to answer (timeout after 60 s).');
});
test('a 5xx says it is the provider\'s server error', () => {
  assert.equal(F.failureText('Claude', 'anthropic', err(503)), 'Claude had a server error (503). Try again, or pick another model.');
});
test('a dropped connection reads as the connection closing during the reply, or as not reachable before any text', () => {
  const net = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  assert.match(F.failureText('Groq', 'groq', net, { midReply: true }), /The connection to Groq closed during the reply/);
  assert.match(F.failureText('Groq', 'groq', net, { midReply: false }), /could not be reached from this server \(ECONNRESET\)/);
});
test('the reason never carries a key, and a provider\'s short code is kept only when it is a plain word', () => {
  const t = F.failureText('X', 'custom', err(429, `bad key ${KEY}`, { providerCode: `${KEY}` }));
  assert.ok(!t.includes('sk-proj-'), t);
  assert.ok(!t.includes(KEY));
});

// ===================================================================== the keep-alive
test('a comment line is sent while the reply is waited for, and stops when told to', async () => {
  const written = [];
  const stop = F.startPing(s => written.push(s), 15);
  await new Promise(r => setTimeout(r, 70));
  stop();
  const n = written.length;
  assert.ok(n >= 2, `pings: ${n}`);
  assert.ok(written.every(s => s === ': ping\n\n'));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(written.length, n, 'no ping after stop');
});

// ===================================================================== the fallback
test('a model that fails before any text is skipped and the next one answers, with the skipped ones named', async () => {
  const tried = [];
  const out = await F.answerWithFallback(['a', 'b'], async (c, onStart) => {
    tried.push(c);
    if (c === 'a') throw err(401);
    onStart();
  });
  assert.equal(out.answered, 'b');
  assert.deepEqual(out.skipped.map(s => s.candidate), ['a']);
  assert.deepEqual(tried, ['a', 'b']);
});
test('a failure after text has started is not retried on another model (the text so far is kept)', async () => {
  const tried = [];
  await assert.rejects(F.answerWithFallback(['a', 'b'], async (c, onStart) => { tried.push(c); onStart(); throw err(502); }), e => e.failedAfterText === true);
  assert.deepEqual(tried, ['a']);
});
test('when every model fails, the last reason is returned with the list of the others', async () => {
  await assert.rejects(F.answerWithFallback(['a', 'b'], async () => { throw err(429); }), e => e.status === 429 && e.skipped.length === 2);
});

// ===================================================================== Auto and the health record
test('a failing model is recorded, skipped by Auto, and back once it recovers', () => {
  const now = Date.now();
  L.noteProviderError('openai', err(401));
  const cand = (provider, id, name) => ({ ...R.catalogFor(provider, id), provider, id, name });
  const pick = R.decide({ text: 'Fix this bug:\n```js\nx\n```' }, { candidates: [cand('openai', 'gpt-x', 'ChatGPT'), cand('anthropic', 'claude-opus-5-5', 'Claude')], health: R.healthOf(L.lastErrors, now) });
  assert.equal(pick.model.provider, 'anthropic', 'Auto skips the failing provider');
  L.noteProviderOk('openai');
  assert.deepEqual(R.healthOf(L.lastErrors, now), {}, 'recovered');
});

// ===================================================================== the routes, end to end (scripted model)
let owner, conv;
async function mk(email) {
  let cookie = '';
  const call = async (path, body, method) => {
    const r = await fetch(S.base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  Object.defineProperty(call, 'cookie', { get: () => cookie });
  const r = await call('/auth/register', { email, password: 'Str0ngPassword1', agree: true });
  assert.equal(r.status, 200);
  return call;
}
async function sse(client, path, body) {
  const r = await fetch(S.base + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: client.cookie }, body: JSON.stringify(body) });
  const text = await r.text();
  return text.split('\n\n').filter(f => f.startsWith('event:')).map(f => ({ event: /^event: (.+)$/m.exec(f)[1], data: JSON.parse(/^data: (.+)$/m.exec(f)[1]) }));
}
before(async () => {
  process.env.ADMIN_EMAIL = [process.env.ADMIN_EMAIL, 'chat-err-owner@example.com'].filter(Boolean).join(',');
  const { ownerFingerprint } = await import('../src/site.js');
  process.env.OWNER_HASHES = [process.env.OWNER_HASHES, ownerFingerprint('chat-err-owner@example.com')].filter(Boolean).join(',');
  owner = await mk('chat-err-owner@example.com');
  conv = (await owner('/admin/aichat/conversations', { model: 'fake' })).body;
});

test('a failed reply saves its reason; reopening the conversation shows that reason, not the generic line', async () => {
  const events = await sse(owner, `/admin/aichat/conversations/${conv.id}/messages`, { content: 'please fail now', model: 'fake' });
  const err = events.find(e => e.event === 'error');
  assert.ok(err, JSON.stringify(events));
  assert.match(err.data.message, /had a server error \(502\)/);
  const again = (await owner(`/admin/aichat/conversations/${conv.id}`)).body;
  const saved = again.messages.at(-1);
  assert.equal(saved.status, 'error');
  assert.equal(saved.error, err.data.message, 'the same reason is kept with the reply');
});

test('the reply shows the model that failed, and a long wait sends nothing secret or the user\'s text into the logs', async () => {
  const before = logs.length;
  await sse(owner, `/admin/aichat/conversations/${conv.id}/messages`, { content: 'fail please, with a secret like sk-abcdefghijklmnopqrstuvwx', model: 'fake' });
  const newLogs = logs.slice(before).join('\n');
  assert.match(newLogs, /stream_failed/);
  assert.ok(!newLogs.includes('sk-abcdefghijklmnopqrstuvwx'), 'no key-like text in the log');
  assert.ok(!newLogs.includes('please, with a secret'), 'no message text in the log');
  const saved = (await owner(`/admin/aichat/conversations/${conv.id}`)).body.messages.at(-1);
  assert.ok(!String(saved.error).includes('please, with a secret'), 'no message text in the saved reason');
});

test('the chat stream is never shed under load (the admin chat is a critical path)', async () => {
  const rel = await import('../src/reliability.js');
  assert.equal(rel.classify('/api/admin/aichat/conversations/x/messages'), 'critical');
  assert.equal(rel.classify('/api/admin/ai/diagnose'), 'critical');
});


// A small scripted provider: the compatible-stream path answers with an HTTP error when asked.
test('a provider that answers 401 gives the key reason through the streaming path', async () => {
  const srv = http.createServer((req, res) => { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end('{"error":{"message":"Incorrect API key"}}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.OPENAI_API_KEY = 'sk-proj-testonlyNotARealKey1234567890';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${srv.address().port}/v1`;
  process.env.OPENAI_MODEL = 'gpt-test-model';
  try {
    const { openaiStream, providers } = await import('../src/llm.js');
    const p = providers().find(x => x.id === 'openai');
    await assert.rejects(openaiStream(p, { system: 's', messages: [{ role: 'user', content: 'hi' }], onText: () => {}, maxTokens: 10, signal: AbortSignal.timeout(5000) }), e => {
      assert.equal(e.status, 401);
      assert.match(F.failureText('ChatGPT (OpenAI)', 'openai', e), /refused the key \(401\)\. Check OPENAI_API_KEY/);
      return true;
    });
  } finally {
    srv.close(); delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_BASE_URL; delete process.env.OPENAI_MODEL;
  }
});
