// AI team Chat: permission, models, token budget, the streaming model call, and storage.
// Model calls happen only here, on the server; keys never reach the browser.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { one, all, run, now } from '../db.js';
import { siteGet, siteSet, isOwner } from '../site.js';
import { canonicalEmail } from '../auth.js';
import { providers } from '../llm.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let cfgCache = null;
export function config() {
  if (!cfgCache) cfgCache = JSON.parse(fs.readFileSync(path.join(root, 'src/aichat/config.json'), 'utf8'));
  return cfgCache;
}
export const bad = (m, status = 400, code) => Object.assign(new Error(m), { status, code });

// Errors are logged with ids and codes only, never message text.
export function clog(event, meta = {}) {
  const safe = {}; for (const k of ['conversation', 'message', 'model', 'code', 'status', 'reason']) if (meta[k] !== undefined) safe[k] = meta[k];
  console.warn(JSON.stringify({ at: new Date().toISOString(), src: 'aichat', event, ...safe }));
}

// ---------- permission ----------
// "AI team chat" permission: the owner always has it; other admins only when the owner grants it.
const granted = () => (siteGet('aiChatAllowed', []) || []).map(canonicalEmail);
export function canChat(user) {
  if (!user || user.role !== 'admin') return false;
  const e = canonicalEmail(user.email || '');
  return isOwner(e) || granted().includes(e);
}
export async function setAccess(email, allowed) {
  const e = canonicalEmail(String(email || ''));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('Enter an e-mail address');
  const list = new Set(granted()); allowed ? list.add(e) : list.delete(e);
  await siteSet('aiChatAllowed', [...list]);
  return [...list];
}
export const accessList = granted;

// ---------- models ----------
// Only providers that have a key, that the config lists, and (if adminModels names this admin) that are in their list.
export function models(user) {
  const c = config(), list = [...providers().map(p => ({ id: p.id, name: p.name, model: p.model, thinking: p.id === 'anthropic' }))];
  if (process.env.NODE_ENV === 'test' && process.env.AI_CHAT_FAKE_MODEL) list.push({ id: 'fake', name: 'Test model (thinks)', model: 'fake-thinker', thinking: true }, { id: 'fake-plain', name: 'Test model', model: 'fake-plain', thinking: false });
  const mine = c.adminModels?.[canonicalEmail(user?.email || '')];
  return list.filter(m => (c.models.includes(m.id) || m.id.startsWith('fake')) && (!mine || mine.includes(m.id)));
}

// ---------- token budget ----------
const dayStart = (t = now()) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
export async function tokensToday(userId, t = now()) {
  const r = await one('SELECT COALESCE(SUM(m.input_tokens + m.output_tokens), 0) n FROM ai_chat_messages m JOIN ai_chat_conversations c ON c.id = m.conversation_id WHERE c.owner_id = ? AND m.created_at >= ?', userId, dayStart(t));
  return r?.n || 0;
}
export function budgetLeft(used, budget = config().dailyTokenBudget) { return Math.max(0, budget - used); }
export function checkBudget(used, budget = config().dailyTokenBudget, t = now()) {
  if (used >= budget) {
    const reset = dayStart(t) + 864e5;
    throw Object.assign(bad(`You have used today's AI chat allowance (${budget.toLocaleString('en-US')} tokens). It resets at ${new Date(reset).toISOString().slice(11, 16)} UTC.`, 429, 'budget'), { resetsAt: reset });
  }
}
// A rough count before the real usage arrives (about four characters per token).
export const estimateTokens = s => Math.ceil(String(s || '').length / 4);

// ---------- streaming a reply ----------
// stream({ model, system, messages, signal, onThinking, onText }) -> { inputTokens, outputTokens, stopReason }
let anthropicClient;
async function streamAnthropic({ system, messages, signal, onThinking, onText, maxTokens }) {
  anthropicClient ||= new Anthropic();
  const s = anthropicClient.messages.stream({ model: 'claude-opus-5-5', max_tokens: maxTokens, thinking: { type: 'adaptive', display: 'summarized' }, system, messages }, { signal });
  let input = 0, output = 0, stop = null;
  for await (const ev of s) {
    if (ev.type === 'message_start') input = ev.message?.usage?.input_tokens || 0;
    else if (ev.type === 'content_block_delta' && ev.delta.type === 'thinking_delta') onThinking(ev.delta.thinking);
    else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onText(ev.delta.text);
    else if (ev.type === 'message_delta') { output = ev.usage?.output_tokens || output; stop = ev.delta?.stop_reason || stop; }
  }
  if (stop === 'refusal') throw bad('The model declined to answer this message.', 422, 'refusal');
  return { inputTokens: input, outputTokens: output, stopReason: stop };
}
// OpenAI-compatible services (Gemini, Groq, OpenRouter, a custom server): server-sent chunks, no thinking.
async function streamCompatible(p, { system, messages, signal, onText, maxTokens }) {
  const r = await fetch(`${p.base}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
    body: JSON.stringify({ model: p.model, stream: true, max_tokens: maxTokens, stream_options: { include_usage: true }, messages: [{ role: 'system', content: system }, ...messages] }) });
  if (!r.ok) throw bad(`The AI service answered ${r.status}`, r.status === 429 ? 429 : 502, 'provider');
  let buf = '', input = 0, output = 0;
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim(); if (d === '[DONE]') continue;
      try { const j = JSON.parse(d); const t = j.choices?.[0]?.delta?.content; if (t) onText(t); if (j.usage) { input = j.usage.prompt_tokens || input; output = j.usage.completion_tokens || output; } } catch {}
    }
  }
  return { inputTokens: input, outputTokens: output, stopReason: 'end_turn' };
}
// A scripted model for tests only (NODE_ENV=test and AI_CHAT_FAKE_MODEL set): never available otherwise.
const fakeFailed = new Set();
async function streamFake(id, { messages, signal, onThinking, onText }) {
  const last = String(messages.at(-1)?.content || ''), wait = ms => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); });
  if (id === 'fake') for (const w of ['Reading ', 'the ', 'question.']) { await wait(15); onThinking(w); }
  const answer = /slow/i.test(last) ? 'This answer streams slowly '.repeat(40) : `## Answer\n\nYou wrote **${last.length}** characters.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`\`\`js\nconst x = 1; // done\n\`\`\`\n`;
  const words = answer.match(/\S+\s*/g) || [];
  for (let k = 0; k < words.length; k++) {
    await wait(/slow/i.test(last) ? 60 : 5);
    if (/fail/i.test(last) && k === 4 && !fakeFailed.has(last)) { fakeFailed.add(last); throw bad('The AI service stopped responding.', 502, 'provider'); } // fails once, so Retry works
    onText(words[k]);
  }
  return { inputTokens: estimateTokens(messages.map(m => m.content).join(' ')), outputTokens: estimateTokens(answer), stopReason: 'end_turn' };
}
export async function streamReply(modelId, args) {
  if (modelId.startsWith('fake') && process.env.NODE_ENV === 'test' && process.env.AI_CHAT_FAKE_MODEL) return streamFake(modelId, args);
  const p = providers().find(x => x.id === modelId);
  if (!p) throw bad('That model is not available.', 400, 'model');
  return p.id === 'anthropic' ? streamAnthropic(args) : streamCompatible(p, args);
}

// ---------- storage ----------
export const newId = () => crypto.randomUUID();
export const titleFrom = text => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return (t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, '') + '…' : t) || 'New chat'; };
export async function conversation(id, userId) {
  const c = await one('SELECT * FROM ai_chat_conversations WHERE id = ? AND owner_id = ?', String(id), userId);
  if (!c) throw bad('Not found', 404);
  return c;
}
export async function messages(convId, { withThinking = true } = {}) {
  const rows = await all('SELECT m.*, t.content AS thinking, t.duration_ms AS thinking_ms FROM ai_chat_messages m LEFT JOIN ai_chat_thinking t ON t.message_id = m.id WHERE m.conversation_id = ? ORDER BY m.id', convId);
  return rows.map(r => ({ id: r.id, role: r.role, content: r.content, status: r.status, model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens, createdAt: r.created_at, updatedAt: r.updated_at, ...(withThinking && r.thinking ? { thinking: r.thinking, thinkingMs: r.thinking_ms } : {}) }));
}
export async function purgeOld(t = now()) {
  const cutoff = t - config().retentionDays * 864e5;
  const old = await all('SELECT id FROM ai_chat_conversations WHERE updated_at < ?', cutoff);
  for (const { id } of old) await deleteConversation(id);
  return old.length;
}
export async function deleteConversation(id) {
  await run('DELETE FROM ai_chat_thinking WHERE message_id IN (SELECT id FROM ai_chat_messages WHERE conversation_id = ?)', id);
  await run('DELETE FROM ai_chat_messages WHERE conversation_id = ?', id);
  await run('DELETE FROM ai_chat_conversations WHERE id = ?', id);
}
