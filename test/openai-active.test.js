// The active AI provider (Part 2): ChatGPT (OpenAI) is used when chosen and working; when it fails
// (a server error here), the next provider with a key answers; the router prefers the active provider
// where it fits the need; and automatic keeps the free providers first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let openai, custom, openaiHits = 0, customHits = 0, openaiFails = true;
const okChat = { choices: [{ message: { content: '{"answer":"from the second provider"}' } }] };
before(async () => {
  // The first OpenAI-style server fails with a server error while openaiFails is set.
  openai = http.createServer((req, res) => {
    openaiHits++;
    res.setHeader('Content-Type', 'application/json');
    if (openaiFails) { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: 'internal error' } })); }
    res.end(JSON.stringify(okChat));
  });
  custom = http.createServer((req, res) => {
    customHits++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(okChat));
  });
  await new Promise(r => openai.listen(0, '127.0.0.1', r));
  await new Promise(r => custom.listen(0, '127.0.0.1', r));
  process.env.OPENAI_API_KEY = 'sk-proj-testonlyNotARealKey1234567890';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${openai.address().port}/v1`;
  process.env.OPENAI_MODEL = 'gpt-test-model';
  process.env.AI_BASE_URL = `http://127.0.0.1:${custom.address().port}/v1`;
  process.env.AI_API_KEY = 'custom-test-key';
  process.env.AI_MODEL = 'custom-test-model';
  for (const k of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
});
after(() => {
  openai?.close(); custom?.close();
  for (const k of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_PROVIDER']) delete process.env[k];
});

test('when OpenAI is chosen and has a key, it is the provider in use, and the choice is reported', async () => {
  const L = await import('../src/llm.js');
  process.env.AI_PROVIDER = 'openai';
  assert.equal(L.activeId(), 'openai');
  assert.equal(L.provider()?.id, 'openai');
  process.env.AI_PROVIDER = 'auto';
  assert.equal(L.activeId(), null, 'auto means no fixed choice');
  delete process.env.AI_PROVIDER;
});

test('when the chosen OpenAI fails, the next provider with a key answers', async () => {
  const L = await import('../src/llm.js');
  process.env.AI_PROVIDER = 'openai';
  openaiFails = true; openaiHits = 0; customHits = 0;
  const out = await L.jsonCall({ system: 'Answer in JSON.', user: 'hi', schema: { type: 'object', properties: { answer: { type: 'string' } } } });
  assert.equal(out.answer, 'from the second provider');
  assert.ok(openaiHits >= 1, 'OpenAI was tried first');
  assert.ok(customHits >= 1, 'then the next provider answered');
  openaiFails = false;
  delete process.env.AI_PROVIDER;
});

test('when OpenAI works again, it answers first', async () => {
  const L = await import('../src/llm.js');
  process.env.AI_PROVIDER = 'openai';
  openaiFails = false; openaiHits = 0; customHits = 0;
  const out = await L.jsonCall({ system: 'Answer in JSON.', user: 'hi', schema: { type: 'object' } });
  assert.equal(out.answer, 'from the second provider');
  assert.ok(openaiHits >= 1);
  assert.equal(customHits, 0, 'the fallback is not used while OpenAI works');
  delete process.env.AI_PROVIDER;
});

test('the router prefers the active provider where it fits the need, and still ranks the others', async () => {
  const R = await import('../src/ai/router.js');
  const cand = (provider, id, name) => ({ ...R.catalogFor(provider, id), provider, id, name });
  const CLAUDE = cand('anthropic', 'claude-opus-5-5', 'Claude');
  const OPENAI = cand('openai', 'gpt-test', 'ChatGPT (OpenAI)');
  const text = 'Fix this bug:\n```js\nconst x = ;\n```';
  const plain = R.decide({ text }, { candidates: [CLAUDE, OPENAI], health: {} });
  const pref = R.decide({ text }, { candidates: [CLAUDE, OPENAI], health: {}, preferred: 'openai' });
  assert.equal(pref.model.provider, 'openai', pref.reason);
  assert.ok(['anthropic', 'openai'].includes(plain.model.provider));
  assert.equal(pref.alternatives[0].provider, 'anthropic', 'the other strong model is still the fallback');
});

test('automatic keeps the free providers first, and ChatGPT is only one choice among them', async () => {
  const L = await import('../src/llm.js');
  delete process.env.AI_PROVIDER;
  const base = process.env.AI_BASE_URL; delete process.env.AI_BASE_URL; // a custom server is a separate, earlier choice
  process.env.GROQ_API_KEY = 'gsk_test_groq_key_000000000000';
  try {
    assert.equal(L.provider()?.id, 'groq', 'automatic picks the free provider first');
    assert.equal(L.activeId(), null);
  } finally {
    delete process.env.GROQ_API_KEY; process.env.AI_BASE_URL = base;
  }
});
