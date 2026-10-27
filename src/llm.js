// One place that talks to a language model. Free providers come first (Groq, Google Gemini,
// OpenRouter, or any OpenAI-compatible server such as a local Ollama); Claude is the upgrade and
// is used whenever ANTHROPIC_API_KEY is set. Keys stay on the server.
//   AI_PROVIDER   anthropic | groq | gemini | openrouter | custom   (optional: picked from the keys set)
//   GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY
//   AI_BASE_URL, AI_API_KEY, AI_MODEL   for "custom" (e.g. http://localhost:11434/v1 for Ollama), or to override a model
import Anthropic from '@anthropic-ai/sdk';
import { redact } from './aiaccess.js';

export const FREE = {
  groq: { name: 'Groq (free tier)', base: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'openai/gpt-oss-120b', signup: 'https://console.groq.com/keys' },
  gemini: { name: 'Google Gemini (free tier)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', signup: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter (free models)', base: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: 'meta-llama/llama-3.3-70b-instruct:free', signup: 'https://openrouter.ai/keys' },
};
const env = k => process.env[k] || '';

export function provider() {
  const p = env('AI_PROVIDER').toLowerCase();
  if (p === 'anthropic' && env('ANTHROPIC_API_KEY')) return { id: 'anthropic', name: 'Claude' };
  if (p === 'custom' || (!p && env('AI_BASE_URL'))) return env('AI_BASE_URL') ? { id: 'custom', name: 'Custom model', base: env('AI_BASE_URL').replace(/\/$/, ''), apiKey: env('AI_API_KEY'), model: env('AI_MODEL') || 'llama3.1' } : null;
  if (FREE[p] && env(FREE[p].key)) return free(p);
  if (!p && env('ANTHROPIC_API_KEY')) return { id: 'anthropic', name: 'Claude' };
  for (const id of Object.keys(FREE)) if (env(FREE[id].key)) return free(id);
  return null;
}
const free = id => ({ id, name: FREE[id].name, base: env('AI_BASE_URL') || FREE[id].base, apiKey: env(FREE[id].key), model: env('AI_MODEL') || FREE[id].model, free: true });
export const llmEnabled = () => !!provider();
export const llmInfo = () => { const p = provider(); return p ? { provider: p.id, name: p.name, free: !!p.free, model: p.model || 'claude-opus-5-5' } : null; };

let claude;
const anthropic = () => (claude ||= new Anthropic());
const failed = (e, p) => (e.status === 401 || e.status === 403 ? Object.assign(new Error(`The AI service refused the request; check the API key for ${p.name}`), { status: 502 }) : e);

// OpenAI-compatible chat completions (Groq, Gemini, OpenRouter, Ollama...).
async function completions(p, body) {
  const r = await fetch(`${p.base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}), ...(p.id === 'openrouter' ? { 'X-Title': 'QuantPocket' } : {}) },
    body: JSON.stringify({ model: p.model, ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error?.message || `AI service answered ${r.status}`), { status: r.status === 429 ? 429 : r.status });
  return d;
}
// The first JSON object in a reply (free models sometimes wrap it in prose or a code fence).
export function parseJson(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('The AI did not return valid JSON');
}

// A structured answer that matches a JSON schema.
export async function jsonCall({ system, user, schema, maxTokens = 3000 }) {
  const p = provider(); if (!p) throw Object.assign(new Error('No AI provider is set up'), { status: 503 });
  // Personal details never leave the server (Admin → AI & privacy).
  system = redact(system); user = redact(user);
  try {
    if (p.id === 'anthropic') {
      const res = await anthropic().beta.messages.create({
        model: 'claude-opus-5-5', max_tokens: maxTokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema } }, system, messages: [{ role: 'user', content: user }],
      });
      if (res.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request'), { status: 422, refusal: true });
      return JSON.parse(res.content.find(b => b.type === 'text').text);
    }
    const d = await completions(p, {
      max_tokens: maxTokens, temperature: 0.2, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `${system}\n\nAnswer with one JSON object only, matching this JSON schema:\n${JSON.stringify(schema)}` }, { role: 'user', content: user }],
    });
    return parseJson(d.choices?.[0]?.message?.content);
  } catch (e) { throw failed(e, p); }
}

// A conversation with tools. defs: { name: { description, schema, required, run } }.
// Returns { text, sources, used }. Web search is available with Claude only.
export async function toolChat({ system, messages: history, defs, webSearch = true, maxRounds = 8 }) {
  const p = provider(); if (!p) throw Object.assign(new Error('No AI provider is set up'), { status: 503 });
  system = redact(system); history = history.map(m => ({ ...m, content: redact(m.content) }));
  const used = [], sources = [];
  const runTool = async (name, input) => {
    used.push(name);
    if (!defs[name]) return { content: `Error: unknown tool ${name}`, error: true };
    try { return { content: redact(JSON.stringify(await defs[name].run(input || {}))).slice(0, 12000) }; } catch (e) { return { content: 'Error: ' + e.message, error: true }; }
  };
  try {
    if (p.id === 'anthropic') {
      const tools = [...Object.entries(defs).map(([name, d]) => ({ name, description: d.description, input_schema: { type: 'object', properties: d.schema, required: d.required } })),
        ...(webSearch ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] : [])];
      const messages = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }));
      for (let round = 0; round < maxRounds; round++) {
        const res = await anthropic().beta.messages.create({
          model: 'claude-opus-5-5', max_tokens: 4000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
          output_config: { effort: 'low' }, system, tools, messages,
        });
        for (const b of res.content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.push({ title: r.title, url: r.url });
        if (res.stop_reason === 'refusal') return { text: "Sorry, I can't help with that request.", sources, used };
        if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
        const calls = res.content.filter(b => b.type === 'tool_use');
        if (res.stop_reason !== 'tool_use' || !calls.length) return { text: res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), sources, used };
        messages.push({ role: 'assistant', content: res.content });
        const results = [];
        for (const c of calls) { const r = await runTool(c.name, c.input); results.push({ type: 'tool_result', tool_use_id: c.id, content: r.content, is_error: !!r.error }); }
        messages.push({ role: 'user', content: results });
      }
      return { text: 'That took too many steps. Please ask a narrower question.', sources, used };
    }
    const tools = Object.entries(defs).map(([name, d]) => ({ type: 'function', function: { name, description: d.description, parameters: { type: 'object', properties: d.schema, required: d.required || [] } } }));
    const messages = [{ role: 'system', content: system + '\nYou have no web access: say so if a question needs current information the tools cannot give.' },
      ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))];
    for (let round = 0; round < maxRounds; round++) {
      const d = await completions(p, { max_tokens: 3000, temperature: 0.3, messages, tools, tool_choice: 'auto' });
      const msg = d.choices?.[0]?.message || {}, calls = msg.tool_calls || [];
      if (!calls.length) return { text: String(msg.content || '').trim() || 'No answer came back. Please try again.', sources, used };
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      for (const c of calls) {
        let input = {}; try { input = JSON.parse(c.function?.arguments || '{}'); } catch {}
        const r = await runTool(c.function?.name, input);
        messages.push({ role: 'tool', tool_call_id: c.id, content: r.content });
      }
    }
    return { text: 'That took too many steps. Please ask a narrower question.', sources, used };
  } catch (e) { throw failed(e, p); }
}
