// Gemini: a retired model is replaced by one the key can use, thinking leaves room for the answer,
// keys are trimmed, and when a provider fails the next one with a key answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let gem, groq; const gemSeen = [], groqSeen = [];
let gemMode = 'retired';
const json = (res, st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
before(async () => {
  gem = http.createServer((req, res) => {
    let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
      if (req.url.startsWith('/native/models')) return json(res, 200, { models: [
        { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.0-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }] });
      const body = JSON.parse(b); gemSeen.push({ auth: req.headers.authorization, body });
      if (gemMode === 'badkey') return json(res, 400, [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }]);
      if (body.model === 'gemini-2.5-flash') return json(res, 404, { error: { message: 'models/gemini-2.5-flash is not found for API version v1beta' } });
      json(res, 200, { choices: [{ message: { role: 'assistant', content: body.response_format ? '{"ok":true}' : 'It works.' } }] });
    });
  });
  groq = http.createServer((req, res) => {
    let b = ''; req.on('data', d => (b += d)); req.on('end', () => { groqSeen.push(JSON.parse(b)); json(res, 200, { choices: [{ message: { role: 'assistant', content: '{"ok":"groq"}' } }] }); });
  });
  await Promise.all([new Promise(r => gem.listen(0, r)), new Promise(r => groq.listen(0, r))]);
  for (const k of ['ANTHROPIC_API_KEY', 'AI_PROVIDER', 'AI_BASE_URL', 'GROQ_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
  Object.assign(process.env, { GEMINI_API_KEY: '  AIza-test-key\n', GEMINI_BASE_URL: `http://127.0.0.1:${gem.address().port}`, GEMINI_NATIVE_URL: `http://127.0.0.1:${gem.address().port}/native` });
});
after(() => { gem.close(); groq.close(); for (const k of ['GEMINI_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_NATIVE_URL', 'GROQ_API_KEY', 'GROQ_BASE_URL', 'AI_PROVIDER']) delete process.env[k]; });

test('Gemini: trimmed key, room to think, and a retired model replaced by the best one the key can use', async () => {
  const L = await import('../src/llm.js');
  assert.equal(L.llmInfo().provider, 'gemini');
  const r = await L.jsonCall({ system: 's', user: 'u', schema: { type: 'object' }, maxTokens: 500 });
  assert.deepEqual(r, { ok: true });
  assert.equal(gemSeen[0].auth, 'Bearer AIza-test-key');           // no spaces or line break
  assert.equal(gemSeen[0].body.reasoning_effort, 'low');
  assert.ok(gemSeen[0].body.max_tokens > 500);                      // room for the thinking
  assert.equal(gemSeen.at(-1).body.model, 'gemini-3.0-flash');       // newest flash, not pro or embedding
  assert.equal(L.llmInfo().model, 'gemini-3.0-flash');               // remembered
  assert.deepEqual(await L.geminiModels('k'), ['gemini-3.0-flash', 'gemini-2.0-flash', 'gemini-3.0-pro']);
});

test('a refused key falls through to the next provider, and the test shows the exact error', async () => {
  const L = await import('../src/llm.js');
  gemMode = 'badkey';
  Object.assign(process.env, { AI_PROVIDER: 'gemini', GROQ_API_KEY: 'gsk_x', GROQ_BASE_URL: `http://127.0.0.1:${groq.address().port}` });
  const r = await L.jsonCall({ system: 's', user: 'u', schema: { type: 'object' } });
  assert.deepEqual(r, { ok: 'groq' });
  assert.match(L.lastErrors.gemini.message, /API key not valid/);
  const t = await L.testProviders();
  const g = t.results.find(x => x.id === 'gemini'), q = t.results.find(x => x.id === 'groq');
  assert.equal(g.ok, false); assert.match(g.error, /API key not valid/);
  assert.equal(q.ok, true);
  assert.equal(t.keyNames.gemini, 'GEMINI_API_KEY');
});
