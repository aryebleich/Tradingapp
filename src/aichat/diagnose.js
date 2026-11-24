// Diagnosis of the AI providers, as the chat uses them (Admin → AI → Test the chat, and the ops step
// aichat-diagnose). For each provider with a key it shows the key's shape (the prefix and the length,
// never the value), the models endpoint answer, and one tiny chat request through the same code path
// the chat uses. Errors become a short plain reason and a redacted message. Nothing here prints or
// saves a key, a message or a reply.
import { providers, textWith, geminiModels, activeId, llmInfo } from '../llm.js';
import { redact } from '../aiaccess.js';

// The known shapes of key values, so the prefix shown is one of these or "other".
const KNOWN = [['whsec_', 'webhook signing secret'], ['sk-proj-', 'OpenAI project key'], ['sk-ant-', 'Anthropic key'], ['sk-or-', 'OpenRouter key'], ['sk-', 'OpenAI-style key'], ['gsk_', 'Groq key'], ['AIza', 'Google key']];
export function keyShape(value) {
  const s = String(value ?? '').trim();
  if (!s) return { present: false };
  const hit = KNOWN.find(([p]) => s.startsWith(p));
  return { present: true, prefix: hit ? hit[0] : 'other', kind: hit ? hit[1] : 'unrecognised', length: s.length, isSigningSecret: s.startsWith('whsec_') };
}

// The plain reason for an error from a provider: a status or a network code, never the message text.
export function reasonOf(e) {
  const st = e?.status;
  const cause = e?.cause?.code || e?.code || '';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|aborted/i.test(String(e?.message))) return { code: 'timeout', text: 'took too long to answer (timeout)' };
  if (st === 401 || st === 403) return { code: `http-${st}`, text: `refused the key (${st})` };
  if (st === 429 && (e?.quota || /insufficient_quota|quota|exhausted/i.test(String(e?.message)))) return { code: 'http-429-quota', text: 'is out of credit or over its quota (429)' };
  if (st === 429) return { code: 'http-429', text: 'is rate-limited right now (429)' };
  if (st === 404) return { code: 'http-404', text: 'does not have that model or address (404)' };
  if (st === 400) return { code: 'http-400', text: 'rejected the request (400)' };
  if (st >= 500) return { code: `http-${st}`, text: `had a server error (${st})` };
  if (cause || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(String(e?.message))) return { code: `network${cause ? '-' + String(cause).replace(/[^A-Z_]/g, '') : ''}`, text: `could not be reached from this server (${cause || 'network error'})` };
  return { code: 'unknown', text: 'failed for a reason the app did not recognise' };
}

// Safe text for a message from a provider: redacted, short, one line.
export const safeMessage = m => redact(String(m || '')).replace(/\s+/g, ' ').slice(0, 200);

// One provider: its key shape, its models answer, and one tiny chat request.
export async function probe(p) {
  const row = { id: p.id, name: p.name, key: keyShape(p.apiKey ?? (p.id === 'anthropic' ? process.env.ANTHROPIC_API_KEY : '')), model: p.model || null };
  // The models endpoint (where there is one): a fast answer that the key and the address work.
  const m0 = Date.now();
  try {
    if (p.id === 'gemini') await geminiModels(p.apiKey);
    else if (p.id === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Object.assign(new Error(`models ${r.status}`), { status: r.status });
    } else if (p.base) {
      const r = await fetch(`${p.base}/models`, { headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Object.assign(new Error(`models ${r.status}`), { status: r.status });
    }
    row.models = { ok: true, ms: Date.now() - m0 };
  } catch (e) { row.models = { ok: false, ms: Date.now() - m0, ...reasonOf(e), status: e.status || null }; }
  // One tiny chat request through the same code the chat uses.
  const t0 = Date.now();
  try {
    const text = await textWith(p.id, { system: 'Answer in one word.', user: 'Say ok.', maxTokens: 20 });
    row.chat = { ok: true, ms: Date.now() - t0, answered: !!text };
  } catch (e) {
    const r = reasonOf(e);
    row.chat = { ok: false, ms: Date.now() - t0, status: e.status || null, code: r.code, reason: r.text, message: safeMessage(e.message) };
  }
  return row;
}

// Every provider that has a key, probed one at a time (never in parallel: a slow provider must not hide the others).
export async function diagnose() {
  const out = [];
  for (const p of providers()) out.push(await probe(p));
  return { at: new Date().toISOString(), active: activeId() || 'auto', inUse: llmInfo(), providers: out };
}

// Plain words for the admin page and the ops log.
export function plainLine(row) {
  const k = row.key.present ? `key ${row.key.kind}, starts "${row.key.prefix}", ${row.key.length} characters` : 'no key';
  const m = row.models ? (row.models.ok ? `models answered in ${row.models.ms} ms` : `models ${row.models.text || 'failed'}`) : 'no models check';
  const c = row.chat?.ok ? `chat answered in ${row.chat.ms} ms` : `chat ${row.chat?.reason || 'failed'}${row.chat?.message ? ': ' + row.chat.message : ''}`;
  return `${row.name}: ${k}; ${m}; ${c}`;
}
