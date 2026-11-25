// ChatGPT (OpenAI) as a provider (Part 1): it is used when OPENAI_API_KEY is set, streams through a
// fake server, gives clear errors for a bad key and for quota or rate limits, retries once without a
// rejected parameter, and every message is redacted before it is sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let srv, base, seen = [], script = [];
// Each request takes the next scripted answer (status, body or stream text); the request is recorded.
before(async () => {
  srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ url: req.url, auth: req.headers.authorization || '', body });
      const step = script.shift() || { status: 200, json: { choices: [{ message: { content: '{"ok":true}' } }] } };
      if (step.events) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const event of step.events) res.write(`data: ${JSON.stringify(event)}\r\n\r\n`);
        return res.end();
      }
      if (step.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const t of step.stream) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      if (step.models) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: step.models.map(id => ({ id })) })); }
      res.writeHead(step.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(step.json || {}));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-test-openai-key-1234567890';
  process.env.OPENAI_BASE_URL = base;
  process.env.OPENAI_MODEL = 'gpt-test-model';
  delete process.env.ANTHROPIC_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY; delete process.env.AI_BASE_URL;
});
after(() => { srv?.close(); delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_BASE_URL; });

test('OpenAI is a provider when its key is set, and is listed for the chat', async () => {
  const L = await import('../src/llm.js');
  assert.equal(L.provider()?.id, 'openai');
  assert.ok(L.providers().some(p => p.id === 'openai' && p.name === 'ChatGPT (OpenAI)'));
  const cfg = JSON.parse((await import('node:fs')).readFileSync(new URL('../src/aichat/config.json', import.meta.url), 'utf8'));
  assert.ok(cfg.models.includes('openai'), 'the chat config lists openai');
});

test('the newest chat model is picked from the list, and dated, image and embedding models are skipped', async () => {
  const { pickOpenAIModel } = await import('../src/llm.js');
  assert.equal(pickOpenAIModel(['text-embedding-3-large', 'gpt-4o', 'gpt-5.1', 'gpt-5.1-2025-11-13', 'gpt-image-1', 'whisper-1', 'o3']), 'gpt-5.1');
  assert.equal(pickOpenAIModel(['dall-e-3', 'tts-1']), null);
});

test('a bad key gives a clear 401 message that names the setting, not the key', async () => {
  const L = await import('../src/llm.js');
  script.push({ status: 401, json: { error: { message: 'Incorrect API key provided: sk-test-openai-key-1234567890' } } });
  seen = [];
  await assert.rejects(() => L.textWith('openai', { system: 's', user: 'u' }), e => {
    assert.equal(e.status, 401);
    assert.match(e.message, /refused \(401\)/);
    assert.match(e.message, /OPENAI_API_KEY/);
    assert.ok(!e.message.includes('sk-test-openai-key'), 'the key is never in the message');
    return true;
  });
});

test('insufficient quota and rate limits give different, clear messages', async () => {
  const L = await import('../src/llm.js');
  script.push({ status: 429, json: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } } });
  await assert.rejects(() => L.textWith('openai', { system: 's', user: 'u' }), e => { assert.equal(e.status, 429); assert.match(e.message, /out of credit/); assert.equal(e.quota, true); return true; });
  script.push({ status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached' } } });
  await assert.rejects(() => L.textWith('openai', { system: 's', user: 'u' }), e => { assert.equal(e.status, 429); assert.match(e.message, /rate-limited/); return true; });
});

test('a 400 that names a rejected parameter is retried once without it', async () => {
  const L = await import('../src/llm.js');
  script.push({ status: 400, json: { error: { message: "Unsupported parameter: 'max_completion_tokens' is not supported with this model." } } });
  seen = [];
  const text = await L.textWith('openai', { system: 's', user: 'u', maxTokens: 50 });
  assert.equal(text, '{"ok":true}');
  assert.equal(seen.length, 2, 'one retry');
  assert.equal(seen[0].body.max_completion_tokens, 50, 'the first try uses max_completion_tokens, not max_tokens');
  assert.equal(seen[0].body.max_tokens, undefined);
  assert.equal('max_completion_tokens' in seen[1].body, false, 'the retry drops the rejected parameter');
  assert.equal('temperature' in seen[0].body, false, 'no custom temperature is sent');
});

test('a 400 that is not about a parameter is not retried', async () => {
  const L = await import('../src/llm.js');
  script.push({ status: 400, json: { error: { message: 'This model does not exist' } } });
  seen = [];
  await assert.rejects(() => L.textWith('openai', { system: 's', user: 'u' }), e => e.status === 400);
  assert.equal(seen.length, 1);
});

test('streaming returns the text as it arrives, with usage, through the chat engine', async () => {
  const { openaiStream, providers } = await import('../src/llm.js');
  script.push({ stream: ['Hello', ', ', 'world'] });
  const got = [];
  const p = providers().find(x => x.id === 'openai');
  const r = await openaiStream(p, { system: 'be brief', messages: [{ role: 'user', content: 'hi' }], onText: t => got.push(t), maxTokens: 100, signal: AbortSignal.timeout(20000) });
  assert.equal(got.join(''), 'Hello, world');
  assert.equal(r.inputTokens, 7);
  assert.equal(r.outputTokens, 3);
});

test('secrets in a message are redacted before anything is sent', async () => {
  const L = await import('../src/llm.js');
  script.push({ status: 200, json: { choices: [{ message: { content: '{"ok":true}' } }] } });
  seen = [];
  await L.textWith('openai', { system: 'sys', user: 'my key is sk-abcdefghijklmnopqrstuvwx and mail me at person@example.com' });
  const sent = JSON.stringify(seen[0].body);
  assert.ok(!sent.includes('sk-abcdefghijklmnopqrstuvwx'), 'the key is removed');
  assert.ok(!sent.includes('person@example.com'), 'the email is removed');
});


test('Admin AI Chat offers Codex and streams a Responses API reply with usage', async () => {
  const E = await import('../src/aichat/engine.js');
  assert.equal(E.models({}).find(m => m.id === 'codex')?.name, 'Codex (OpenAI)');
  script.push({ events: [
    { type: 'response.output_text.delta', delta: 'Hello' },
    { type: 'response.output_text.delta', delta: ' from Codex.' },
    { type: 'response.completed', response: { usage: { input_tokens: 13, output_tokens: 4 } } },
  ] });
  const key = process.env.OPENAI_API_KEY;
  let text = '';
  const usage = await E.streamReply('codex', {
    system: 'Help Brightolio developers.',
    messages: [{ role: 'user', content: `My key is ${key}` }],
    onText: delta => { text += delta; }, maxTokens: 800,
  });
  assert.equal(text, 'Hello from Codex.');
  assert.equal(usage.inputTokens, 13);
  assert.equal(usage.outputTokens, 4);
  const request = seen.at(-1);
  assert.equal(request.url, '/v1/responses');
  assert.equal(request.body.model, 'gpt-5.3-codex');
  assert.equal(request.body.max_output_tokens, 800);
  assert.equal(request.body.store, false);
  assert.ok(!JSON.stringify(request.body).includes(key));
  assert.equal(request.body.tools, undefined);
});

test('Codex rejects an interrupted stream and is unavailable without the OpenAI API key', async () => {
  const E = await import('../src/aichat/engine.js');
  script.push({ events: [{ type: 'response.output_text.delta', delta: 'Partial' }] });
  await assert.rejects(E.streamReply('codex', {
    system: '', messages: [], onText() {}, maxTokens: 800,
  }), /ended before the response completed/);
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.ok(!E.models({}).some(m => m.id === 'codex'));
    await assert.rejects(E.streamReply('codex', {}), /model is not available/);
  } finally {
    process.env.OPENAI_API_KEY = key;
  }
});
