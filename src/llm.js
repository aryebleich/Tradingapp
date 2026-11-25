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
// Keys are trimmed: a space or line break pasted with a key makes every request fail.
const env = k => String(process.env[k] || '').trim();
// Gemini keys are also accepted under Google's own names.
const keyOf = id => env(FREE[id].key) || (id === 'gemini' ? env('GOOGLE_API_KEY') || env('GOOGLE_AI_API_KEY') : '');

export function provider() {
  const p = env('AI_PROVIDER').toLowerCase();
  if (p === 'anthropic' && env('ANTHROPIC_API_KEY')) return { id: 'anthropic', name: 'Claude' };
  if (p === 'custom' || (!p && env('AI_BASE_URL'))) return env('AI_BASE_URL') ? { id: 'custom', name: 'Custom model', base: env('AI_BASE_URL').replace(/\/$/, ''), apiKey: env('AI_API_KEY'), model: env('AI_MODEL') || 'llama3.1' } : null;
  if (p === 'openai' && openaiKey()) return openaiProvider();
  if (FREE[p] && keyOf(p)) return free(p);
  if (!p && env('ANTHROPIC_API_KEY')) return { id: 'anthropic', name: 'Claude' };
  for (const id of Object.keys(FREE)) if (keyOf(id)) return free(id);
  if (!p && openaiKey()) return openaiProvider();
  return null;
}
const free = id => ({ id, name: FREE[id].name, base: env(id.toUpperCase() + '_BASE_URL') || (env('AI_PROVIDER').toLowerCase() === id && env('AI_BASE_URL')) || FREE[id].base, apiKey: keyOf(id), model: (env('AI_PROVIDER').toLowerCase() === id && env('AI_MODEL')) || (id === 'gemini' && env('GEMINI_MODEL')) || picked[id] || FREE[id].model, free: true });
// ---------- ChatGPT (OpenAI) ----------
// Paid, through OPENAI_API_KEY (Admin → Keys). The model comes from OPENAI_MODEL. When that is not
// set, the newest chat model the key can use is read from OpenAI's model list (cached 6 hours), so
// no model name is hard-coded that could be retired. Parameters: max_completion_tokens instead of
// max_tokens; no temperature (reasoning models accept only the default); and one retry without any
// parameter the model rejects.
// OPENAI_BASE_URL (optional, not a secret) only exists so tests can point at a fake server.
export const OPENAI = { id: 'openai', name: 'ChatGPT (OpenAI)', base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY' };
// A signing secret is never sent as the API key (src/key-format.js): it is refused here too.
const openaiKey = () => { const k = env(OPENAI.key); return /^whsec_/.test(k) ? '' : k; };
export const openaiProvider = () => ({ id: 'openai', name: OPENAI.name, base: (env('OPENAI_BASE_URL') || OPENAI.base).replace(/\/$/, ''), apiKey: openaiKey(), model: env('OPENAI_MODEL') || null, paid: true });
let openaiList = { at: 0, ids: [] };
// The newest chat model in a list of model ids (newest version first, then the plain name over a dated copy).
export function pickOpenAIModel(ids) {
  const chat = (ids || []).filter(id => /^(gpt-|o\d)/.test(id) && !/(realtime|audio|transcribe|tts|image|embedding|search|instruct|moderation|whisper|dall|codex|preview)/.test(id));
  const ver = id => +(/^gpt-(\d+(?:\.\d+)?)/.exec(id)?.[1] || /^o(\d+)/.exec(id)?.[1] || 0);
  return chat.sort((a, b) => (ver(b) - ver(a)) || (/^gpt-/.test(b) - /^gpt-/.test(a)) || (a.length - b.length))[0] || null;
}
// Maps an OpenAI error answer to a clear message (the key never appears in it).
export function openaiError(status, d) {
  const code = String(d?.error?.code || d?.error?.type || ''), msg = String(d?.error?.message || '');
  const providerCode = /^[a-z][a-z_]{2,40}$/.test(code) ? code : '';
  if (status === 401) return Object.assign(new Error('The ChatGPT (OpenAI) key was refused (401). Check OPENAI_API_KEY in Admin → Keys.'), { status: 401, providerCode });
  if (status === 429 && /insufficient_quota|credit_balance_exhausted/.test(code + ' ' + msg)) return Object.assign(new Error('ChatGPT (OpenAI) is out of API credit. Add billing at platform.openai.com, then try again.'), { status: 429, quota: true, providerCode: providerCode || 'insufficient_quota' });
  if (status === 429) return Object.assign(new Error('ChatGPT (OpenAI) is rate-limited right now. Try again in a minute.'), { status: 429, providerCode });
  return Object.assign(new Error(redact(msg) || `ChatGPT (OpenAI) answered ${status}`), { status: status >= 500 ? 502 : status, providerCode });
}
export async function openaiModel(p) {
  if (p.model) return p.model;
  if (!openaiList.ids.length || Date.now() - openaiList.at > 6 * 3600e3) {
    const r = await fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${p.apiKey}` }, signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw openaiError(r.status, d);
    openaiList = { at: Date.now(), ids: (d.data || []).map(m => m.id) };
  }
  const m = pickOpenAIModel(openaiList.ids);
  if (!m) throw Object.assign(new Error('This ChatGPT key lists no chat model. Set OPENAI_MODEL in Admin → Keys.'), { status: 404 });
  return m;
}
// Body in the form the API takes today, without the parameters reasoning models refuse.
function openaiBody(body, model) {
  const b = { ...body, model };
  if (b.max_tokens != null) { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; }
  delete b.temperature;
  return b;
}
async function openaiSend(p, b) {
  const r = await fetch(`${p.base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify(b),
  });
  return { ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) };
}
// A chat request to OpenAI. A 400 that names a rejected parameter is retried once without it.
export async function openaiPost(p, body) {
  const model = await openaiModel(p);
  let b = openaiBody(body, model);
  let r = await openaiSend(p, b);
  if (!r.ok && r.status === 400) {
    const m = /'([a-z_]+)'/i.exec(String(r.d?.error?.message || ''));
    if (m && m[1] in b && /unsupported|not supported|does not support|only the default/i.test(r.d.error.message)) {
      delete b[m[1]];
      r = await openaiSend(p, b);
    }
  }
  if (!r.ok) throw openaiError(r.status, r.d);
  return r.d;
}
// Streamed reply (the chat's Stop button aborts it through the signal).
export async function openaiStream(p, { system, messages, signal, onText, maxTokens }) {
  const model = await openaiModel(p);
  const b = openaiBody({ max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'system', content: redact(system) }, ...messages.map(m => ({ ...m, content: redact(m.content) }))] }, model);
  const r = await fetch(`${p.base}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` }, body: JSON.stringify(b) });
  if (!r.ok) throw openaiError(r.status, await r.json().catch(() => ({})));
  let buf = '', input = 0, output = 0;
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim(); if (d === '[DONE]') continue;
      try { const j = JSON.parse(d); const t = j.choices?.[0]?.delta?.content; if (t) onText(t); if (j.usage) { input = j.usage.prompt_tokens || input; output = j.usage.completion_tokens || output; } } catch { /* a partial line */ }
    }
  }
  return { inputTokens: input, outputTokens: output, stopReason: 'end_turn', model };
}
// Admin Chat can explicitly choose a Codex model through the Responses API.
export function codexChatProvider() {
  const p = openaiProvider();
  return p.apiKey ? { ...p, id: 'codex', name: 'Codex (OpenAI)', model: env('OPENAI_CODEX_MODEL') || 'gpt-5.3-codex' } : null;
}

export async function codexChatStream(p, { system, messages, signal, onText, maxTokens }) {
  const r = await fetch(`${p.base}/responses`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      instructions: redact(system),
      input: messages.map(({ role, content }) => ({ role, content: redact(content) })),
      max_output_tokens: maxTokens,
      store: false,
      stream: true,
    }),
  });
  if (!r.ok) throw openaiError(r.status, await r.json().catch(() => ({})));

  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of r.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data);
      if (event.type === 'response.output_text.delta') onText(event.delta);
      if (event.type === 'response.refusal.delta') {
        throw Object.assign(new Error('The model declined to answer this message.'), { status: 422, code: 'refusal' });
      }
      if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
        const error = event.response?.error || event;
        throw openaiError(502, { error });
      }
      if (event.type === 'response.completed') {
        const usage = event.response?.usage;
        return { inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0, stopReason: 'end_turn', model: p.model };
      }
    }
  }
  throw new Error('The Codex stream ended before the response completed.');
}

const picked = {}; // a model found to work when the default one is retired
export const llmEnabled = () => !!provider();
// The provider the owner chose in Admin → AI (AI_PROVIDER), or null for automatic.
export const activeId = () => { const p = env('AI_PROVIDER').toLowerCase(); return p && p !== 'auto' ? p : null; };
export const llmInfo = () => { const p = provider(); return p ? { provider: p.id, name: p.name, free: !!p.free, model: p.model || (p.id === 'anthropic' ? 'claude-opus-5-5' : 'newest chat model') } : null; };

let claude;
const anthropic = () => (claude ||= new Anthropic());
const failed = (e, p) => (p.id === 'openai' ? e : e.status === 401 || e.status === 403 ? Object.assign(new Error(`The AI service refused the request; check the API key for ${p.name}`), { status: 502 }) : e);

// OpenAI-compatible chat completions (Groq, Gemini, OpenRouter, Ollama...).
async function post(p, body) {
  const r = await fetch(`${p.base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}), ...(p.id === 'openrouter' ? { 'X-Title': 'Brightolio' } : {}) },
    body: JSON.stringify({ model: p.model, ...body }),
  });
  const d = await r.json().catch(() => ({}));
  const err = Array.isArray(d) ? d[0]?.error : d.error; // Gemini sometimes answers with an array
  if (!r.ok) throw Object.assign(new Error(err?.message || `AI service answered ${r.status}`), { status: r.status === 429 ? 429 : r.status, providerCode: String(err?.code || err?.type || '') });
  return d;
}
// The models a Gemini key can use, best first (newest flash, then other flash, then pro).
export async function geminiModels(apiKey) {
  const r = await fetch(`${env('GEMINI_NATIVE_URL') || 'https://generativelanguage.googleapis.com/v1beta'}/models?pageSize=200&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error?.message || `Gemini answered ${r.status}`), { status: r.status });
  const ver = n => +(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] || 0);
  return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-/.test(n) && !/(tts|image|embedding|audio|live|exp|preview|lite)/.test(n))
    .sort((a, b) => ((/flash/.test(b) ? 1 : 0) - (/flash/.test(a) ? 1 : 0)) || ver(b) - ver(a) || a.length - b.length);
}
async function completions(p, body) {
  if (p.id === 'openai') return openaiPost(p, body);
  if (p.id !== 'gemini') return post(p, body);
  // Gemini "thinks" before it answers and the thinking counts against max_tokens: keep it short and
  // leave room, or the answer comes back empty.
  const g = { ...body, reasoning_effort: 'low', max_tokens: (body.max_tokens || 2000) + 2048 };
  try { return await post(p, g); } catch (e) {
    if (e.status === 400 && /reasoning|thinking/i.test(e.message)) return post(p, { ...body, max_tokens: g.max_tokens });
    // The model was retired or is not open to this key: use the best one the key can reach.
    if (e.status === 404 || /not found|not supported|is not available/i.test(e.message)) {
      const best = (await geminiModels(p.apiKey)).find(m => m !== p.model);
      if (!best) throw e;
      picked.gemini = best; p.model = best;
      return post(p, g).catch(e2 => (e2.status === 400 && /reasoning|thinking/i.test(e2.message) ? post(p, { ...body, max_tokens: g.max_tokens }) : Promise.reject(e2)));
    }
    throw e;
  }
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
async function jsonCallOne({ system, user, schema, maxTokens = 3000 }, p) {
  if (!p) throw Object.assign(new Error('No AI provider is set up'), { status: 503 });
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

// Reads an image (a receipt, a document) and answers in JSON. Claude, Gemini and OpenRouter models
// can see images; for a provider that cannot, the call fails and the caller falls back to typing.
async function visionJsonOne({ image, prompt, schema, maxTokens = 800 }, p) {
  if (!p) throw Object.assign(new Error('No AI provider is set up'), { status: 503 });
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(String(image || ''));
  if (!m) throw Object.assign(new Error('Not an image'), { status: 400 });
  try {
    if (p.id === 'anthropic') {
      const res = await anthropic().beta.messages.create({
        model: 'claude-opus-5-5', max_tokens: maxTokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: prompt }] }],
      });
      return JSON.parse(res.content.find(b => b.type === 'text').text);
    }
    const d = await completions(p, { max_tokens: maxTokens, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `Answer with one JSON object only, matching this JSON schema:\n${JSON.stringify(schema)}` }, { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }] });
    return parseJson(d.choices?.[0]?.message?.content);
  } catch (e) { throw failed(e, p); }
}

// A conversation with tools. defs: { name: { description, schema, required, run } }.
// Returns { text, sources, used }. Web search is available with Claude only.
async function toolChatOne({ system, messages: history, defs, webSearch = true, maxRounds = 8 }, p) {
  if (!p) throw Object.assign(new Error('No AI provider is set up'), { status: 503 });
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
      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
      for (const c of calls) {
        let input = {}; try { input = JSON.parse(c.function?.arguments || '{}'); } catch {}
        const r = await runTool(c.function?.name, input);
        messages.push({ role: 'tool', tool_call_id: c.id, content: r.content });
      }
    }
    return { text: 'That took too many steps. Please ask a narrower question.', sources, used };
  } catch (e) { throw failed(e, p); }
}

// ---------- several providers at once (Admin → AI team) ----------
// Every provider that has a key, so different jobs can go to different models.
export function providers() {
  const out = [];
  if (env('ANTHROPIC_API_KEY')) out.push({ id: 'anthropic', name: 'Claude', model: 'claude-opus-5-5' });
  for (const id of Object.keys(FREE)) if (keyOf(id)) out.push(free(id));
  if (openaiKey()) out.push(openaiProvider());
  if (env('AI_BASE_URL')) out.push({ id: 'custom', name: 'Custom model', base: env('AI_BASE_URL').replace(/\/$/, ''), apiKey: env('AI_API_KEY'), model: env('AI_MODEL') || 'default' });
  return out;
}
// A plain-text answer from one named provider.
export async function textWith(id, { system, user, maxTokens = 3000 }) {
  const p = providers().find(x => x.id === id); if (!p) throw Object.assign(new Error(`${id} has no key set`), { status: 503 });
  system = redact(system); user = redact(user);
  try {
    if (p.id === 'anthropic') {
      const res = await anthropic().beta.messages.create({ model: 'claude-opus-5-5', max_tokens: maxTokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', thinking: { type: 'adaptive' }, system, messages: [{ role: 'user', content: user }] });
      if (res.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request'), { status: 422, refusal: true });
      return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    }
    const d = await completions(p, { max_tokens: maxTokens, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    return String(d.choices?.[0]?.message?.content || '').trim();
  } catch (e) { throw failed(e, p); }
}

// ---------- one provider fails: the next one with a key answers ----------
// The provider chosen by provider() goes first; when it refuses the key, is out of quota, has no
// such model or is down, the request goes to the next provider that has a key. The last error of
// each provider is kept for Admin → AI & privacy → Test the AI.
export const lastErrors = {};
// The chat's own stream failures feed the same health record, so Auto stops choosing a provider that is failing.
export function noteProviderError(id, e) {
  lastErrors[id] = { at: Date.now(), status: e?.status || null, message: redact(String(e?.message || e || '')).slice(0, 200) };
}
export function noteProviderOk(id) { delete lastErrors[id]; }
const retryable = e => !e.refusal && (!e.status || [401, 402, 403, 404, 408, 429].includes(e.status) || e.status >= 500 || /quota|exhausted|overloaded|unavailable|fetch failed|timeout|aborted|api key|api_key|permission|not found|not supported|location is not supported|billing/i.test(e.message));
function chain() {
  const all = providers(), first = provider() || all[0];
  if (!first) return [];
  return [first, ...all.filter(x => x.id !== first.id)];
}
async function viaChain(fn, args) {
  const list = chain(); if (!list.length) throw Object.assign(new Error('No AI provider is set up'), { status: 503 });
  let last;
  for (const p of list) {
    try { const r = await fn(args, p); delete lastErrors[p.id]; return r; } catch (e) {
      lastErrors[p.id] = { at: Date.now(), status: e.status || null, message: String(e.message || e).slice(0, 300) };
      last = e; if (!retryable(e)) throw e;
    }
  }
  throw last;
}
export const jsonCall = args => viaChain(jsonCallOne, args);
export const visionJson = args => viaChain(visionJsonOne, args);
export const toolChat = args => viaChain(toolChatOne, args);

// Admin test: a tiny request to every provider that has a key, with the exact answer or error.
export async function testProviders() {
  const out = [];
  for (const p of providers()) {
    const t0 = Date.now();
    try {
      const text = await textWith(p.id, { system: 'Answer in one short sentence.', user: 'Say that the connection works.', maxTokens: 60 });
      out.push({ id: p.id, name: p.name, model: p.id === 'anthropic' ? 'claude-opus-5-5' : (providers().find(x => x.id === p.id) || p).model, ok: !!text, ms: Date.now() - t0, text: text.slice(0, 160) || 'Empty answer' });
    } catch (e) { out.push({ id: p.id, name: p.name, model: p.model || null, ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 300), status: e.status || null }); }
  }
  const gem = keyOf('gemini');
  let gemini = null;
  if (gem) { try { gemini = { models: (await geminiModels(gem)).slice(0, 8) }; } catch (e) { gemini = { error: e.message }; } }
  return { active: llmInfo(), results: out, gemini, keyNames: { gemini: env('GEMINI_API_KEY') ? 'GEMINI_API_KEY' : env('GOOGLE_API_KEY') ? 'GOOGLE_API_KEY' : env('GOOGLE_AI_API_KEY') ? 'GOOGLE_AI_API_KEY' : null }, provider: env('AI_PROVIDER') || null };
}
