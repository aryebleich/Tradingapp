// OpenAI calls made by the app outside a chat reply: a background response (a long answer that
// finishes later, announced by a webhook) and reading back its result. Keys come from the key store
// (secret), never from a file, and a signing secret (whsec_) is refused here as the API key.
import { one, all, run, now } from './db.js';
import { secret } from './keystore.js';
import { OPENAI, openaiProvider, openaiModel } from './llm.js';

const base = () => (process.env.OPENAI_BASE_URL || OPENAI.base).replace(/\/$/, '');
export function apiKey() {
  const k = secret(OPENAI.key).trim();
  if (!/^sk-/.test(k)) throw Object.assign(new Error('The OpenAI API key is missing, or the value saved is not an API key (it should start with sk-). Add it in Admin → Keys.'), { status: 503 });
  return k;
}
// One GET or POST to OpenAI. Errors carry OpenAI's message (never the key).
export async function openaiJson(path, { method = 'GET', body } = {}) {
  const r = await fetch(base() + path, {
    method, signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${apiKey()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error?.message || `OpenAI answered ${r.status}`), { status: r.status });
  return d;
}
// Plain text from OpenAI (a batch results file is JSON lines).
export async function openaiText(path) {
  const r = await fetch(base() + path, { signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${apiKey()}` } });
  if (!r.ok) throw Object.assign(new Error(`OpenAI answered ${r.status} for the results file`), { status: r.status });
  return r.text();
}
// The text of a finished response: its output_text, or the text parts of its output.
export function textOf(r) {
  if (typeof r?.output_text === 'string') return r.output_text;
  return (r?.output || []).flatMap(o => (o.content || []).map(c => c.text || '')).join('\n').trim();
}

// Starts a long answer in background mode: OpenAI works on it and announces the end with a webhook
// (response.completed, response.failed, ...). The job is kept here until that event arrives.
export async function startBackground({ input, instructions = '', owner = null, conversationId = null, messageId = null, notify = false, model = null }) {
  const p = openaiProvider();
  const m = model || await openaiModel(p);
  const r = await openaiJson('/responses', { method: 'POST', body: { model: m, instructions, input, background: true, store: true } });
  const t = now();
  await run('INSERT INTO openai_jobs (kind, openai_id, status, owner_id, conversation_id, message_id, notify, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    'response', r.id, 'running', owner, conversationId, messageId, notify ? 1 : 0, t, t);
  return { id: r.id, status: r.status, model: m };
}
export const jobFor = openaiId => one('SELECT * FROM openai_jobs WHERE openai_id = ? ORDER BY id DESC LIMIT 1', openaiId);
export const recentJobs = (limit = 20) => all('SELECT id, kind, openai_id, status, error, owner_id, message_id, created_at, updated_at FROM openai_jobs ORDER BY id DESC LIMIT ?', limit);
export const recentEvents = (limit = 20) => all('SELECT id, type, status, error, received_at, done_at FROM openai_events ORDER BY received_at DESC LIMIT ?', limit);
