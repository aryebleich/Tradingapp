// The free, OpenAI-compatible AI path (Groq, Gemini, OpenRouter, Ollama): JSON answers and tool calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let fake, seen = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
      const body = JSON.parse(b); seen.push({ auth: req.headers.authorization, body });
      const last = body.messages.at(-1);
      let message;
      if (body.response_format) message = { role: 'assistant', content: '```json\n{"name":"Dip buyer","symbol":"QQQ","entry":"RSI(14) < 30","exit":"RSI(14) > 60","stopLoss":8,"takeProfit":0,"trailingStop":0,"explanation":"Buys dips."}\n```' };
      else if (last.role === 'tool') message = { role: 'assistant', content: `SPY is at ${JSON.parse(last.content).price}.` };
      else message = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_quote', arguments: '{"symbol":"spy"}' } }] };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise(r => fake.listen(0, r));
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_PROVIDER = 'groq'; process.env.GROQ_API_KEY = 'gsk_test'; process.env.AI_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
});
after(() => { fake.close(); for (const k of ['AI_PROVIDER', 'GROQ_API_KEY', 'AI_BASE_URL']) delete process.env[k]; });

test('free provider: structured JSON and a tool-calling conversation', async () => {
  const { llmInfo, toolChat, parseJson } = await import('../src/llm.js');
  const { buildStrategy } = await import('../src/ai.js');
  assert.deepEqual(llmInfo(), { provider: 'groq', name: 'Groq (free tier)', free: true, model: 'openai/gpt-oss-120b' });
  const s = await buildStrategy('buy QQQ dips');
  assert.equal(s.symbol, 'QQQ'); assert.equal(s.engine, 'groq'); assert.equal(seen[0].auth, 'Bearer gsk_test');
  const r = await toolChat({ system: 'test', messages: [{ role: 'user', content: 'price of SPY?' }], defs: { get_quote: { description: 'quote', schema: { symbol: { type: 'string' } }, required: ['symbol'], run: async ({ symbol }) => ({ symbol, price: 512.5 }) } } });
  assert.equal(r.text, 'SPY is at 512.5.'); assert.deepEqual(r.used, ['get_quote']);
  assert.equal(seen.at(-1).body.messages.at(-1).tool_call_id, 'c1');
  assert.deepEqual(parseJson('Sure! {"a":1} done'), { a: 1 });
});
