// /api/admin/aichat/* : the AI team "Chat" job, a normal back-and-forth conversation.
// Mounted under /api/admin, so requireUser + requireAdmin already ran (non-admins get 403 there); this
// router then requires the "AI team chat" permission (403).
// Replies stream as server-sent events over the POST response: start, thinking, text, done, error.
import * as R from '../ai/router.js';
import { answerWithFallback, failureInfo, startPing } from './failure.js';
import { noteProviderError, noteProviderOk } from '../llm.js';
import express from 'express';
import { rateLimit } from '../auth.js';
import { one, all, run, now, audit } from '../db.js';
import { isOwner } from '../site.js';
import * as E from './engine.js';

const active = new Map(); // assistant message id -> AbortController
let lastPurge = 0;
const fail = (res, e) => {
  if (!e.status) E.clog('route_failed', { reason: e?.name });
  if (res.headersSent) return;
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong', ...(e.code ? { code: e.code } : {}), ...(e.resetsAt ? { resetsAt: e.resetsAt } : {}) });
};
const route = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(e => fail(res, e));

export const aiChatRouter = express.Router();
aiChatRouter.use((req, res, next) => {
  if (!E.canChat(req.user)) return res.status(403).json({ error: 'You do not have the AI team chat permission.' });
  if (now() - lastPurge > 3600e3) { lastPurge = now(); E.purgeOld().catch(() => {}); }
  next();
});

aiChatRouter.get('/status', route(async (req, res) => {
  const used = await E.tokensToday(req.user.id), c = E.config();
  res.json({ models: E.models(req.user), budget: { used, limit: c.dailyTokenBudget, left: E.budgetLeft(used) }, retentionDays: c.retentionDays, owner: isOwner(req.user.email) });
}));
aiChatRouter.get('/conversations', route(async (req, res) => res.json({ conversations: await all('SELECT id, title, model, created_at AS createdAt, updated_at AS updatedAt FROM ai_chat_conversations WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200', req.user.id) })));
aiChatRouter.post('/conversations', route(async (req, res) => {
  const m = E.models(req.user), model = m.find(x => x.id === req.body?.model)?.id || m.find(x => x.id === 'auto')?.id || m[0]?.id;
  if (!model) throw E.bad('No AI model is available. Add a key in Admin → Keys.', 503, 'no_model');
  const id = E.newId(), t = now();
  await run('INSERT INTO ai_chat_conversations (id, owner_id, title, model, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, req.user.id, 'New chat', model, t, t);
  res.json({ id, title: 'New chat', model });
}));
aiChatRouter.get('/conversations/:id', route(async (req, res) => {
  const c = await E.conversation(req.params.id, req.user.id);
  res.json({ id: c.id, title: c.title, model: c.model, createdAt: c.created_at, updatedAt: c.updated_at, messages: await E.messages(c.id) });
}));
aiChatRouter.patch('/conversations/:id', route(async (req, res) => {
  const c = await E.conversation(req.params.id, req.user.id), title = String(req.body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!title) throw E.bad('Enter a title');
  await run('UPDATE ai_chat_conversations SET title = ? WHERE id = ?', title, c.id);
  res.json({ id: c.id, title });
}));
aiChatRouter.delete('/conversations/:id', route(async (req, res) => { const c = await E.conversation(req.params.id, req.user.id); await E.deleteConversation(c.id); res.json({ deleted: true }); }));
// Thinking can be deleted on its own; the answers stay.
aiChatRouter.delete('/conversations/:id/thinking', route(async (req, res) => {
  const c = await E.conversation(req.params.id, req.user.id);
  const r = await run('DELETE FROM ai_chat_thinking WHERE message_id IN (SELECT id FROM ai_chat_messages WHERE conversation_id = ?)', c.id);
  res.json({ deleted: r.changes });
}));

// ---------- streaming a reply ----------
function history(msgs, limit) {
  const out = [];
  for (const m of msgs.slice(-limit)) {
    if (m.role === 'assistant' && (m.status === 'error' || !m.content)) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user', last = out.at(-1);
    if (last && last.role === role) last.content += '\n\n' + m.content; else out.push({ role, content: m.content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
async function streamInto(req, res, conv, modelId) {
  const c = E.config();
  E.checkBudget(await E.tokensToday(req.user.id));
  if (!rateLimit(`aichat:${req.user.id}`, c.messagesPerMinute, 60e3)) throw E.bad('You are sending messages too quickly. Please wait a minute.', 429, 'rate_limited');
  const msgs = history(await E.messages(conv.id, { withThinking: false }), c.historyMessages);
  if (!msgs.length || msgs.at(-1).role !== 'user') throw E.bad('Nothing to answer.');
  // Auto: the router picks the model for this message and says why (src/ai/router.js). If the first
  // model fails before any text, the next one it ranked answers, and the reply says so.
  let route = null, candidates;
  if (modelId === 'auto') {
    route = await R.route({ text: msgs.at(-1).content, member: false });
    if (!route.model) throw E.bad('No AI model is available. Add a key in Admin → Keys.', 503, 'no_model');
    candidates = [route.model.provider, ...route.alternatives.map(a => a.provider)];
  } else candidates = [modelId];
  const all = E.models(req.user);
  candidates = [...new Set(candidates)].filter(id => all.some(m => m.id === id));
  if (!candidates.length) throw E.bad('That model is not available to you.', 400, 'model');
  const first = all.find(m => m.id === candidates[0]);
  const t0 = now();
  const aid = Number((await run("INSERT INTO ai_chat_messages (conversation_id, role, content, status, model, input_tokens, output_tokens, created_at, updated_at, route_reason) VALUES (?, 'assistant', '', 'streaming', ?, 0, 0, ?, ?, ?)", conv.id, first.id, t0, t0, route?.reason || null)).lastInsertRowid);
  await run('UPDATE ai_chat_conversations SET model = ?, updated_at = ? WHERE id = ?', route ? 'auto' : first.id, t0, conv.id);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => { if (res.writableEnded) return; res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); res.flush?.(); };
  const ac = new AbortController(); active.set(aid, ac);
  // A connection that closes during the reply is an error (saved with its own reason), not a stop by the user.
  let closedEarly = false;
  res.on('close', () => { if (!res.writableEnded) { closedEarly = true; ac.abort(); } });
  // While the reply is written: a comment every 15 s keeps proxies and browsers from closing an idle
  // stream; a reply silent for 60 s is stopped and reported as a timeout.
  const stopPing = startPing(s => { if (!res.writableEnded) res.write(s); }, 15000);
  let lastActivity = Date.now(), timedOut = false;
  const watchdog = setInterval(() => { if (!ac.signal.aborted && Date.now() - lastActivity > 60e3) { timedOut = true; ac.abort(); } }, 5000);
  watchdog.unref?.();
  let text = '', thinking = '', thinkStart = null, thinkEnd = null, lastSave = Date.now(), started = false;
  const touch = () => { lastActivity = Date.now(); };
  const save = (status, extra = {}) => run('UPDATE ai_chat_messages SET content = ?, status = ?, input_tokens = ?, output_tokens = ?, updated_at = ? WHERE id = ?', text, status, extra.inputTokens || 0, extra.outputTokens || E.estimateTokens(text + thinking), now(), aid);
  const saveThinking = () => (thinking ? run('INSERT INTO ai_chat_thinking (message_id, content, duration_ms) VALUES (?,?,?) ON CONFLICT(message_id) DO UPDATE SET content = excluded.content, duration_ms = excluded.duration_ms', aid, thinking, (thinkEnd || now()) - (thinkStart || now())) : null);
  send('start', { assistantMessageId: aid, model: first.id, name: first.name, thinking: first.thinking, route: route ? { need: route.need, reason: route.reason } : null });
  const notes = [];
  let answered = null, usage = null, attempted = first.id;
  const attempt = async (cand, onStart) => {
    attempted = cand;
    const m = all.find(x => x.id === cand);
    return E.streamReply(m.id, {
      system: c.systemPrompt, messages: msgs, maxTokens: c.maxOutputTokens, signal: ac.signal,
      onThinking: d => { touch(); if (!started) { started = true; onStart(); } thinkStart ??= Date.now(); thinking += d; send('thinking', { delta: d }); },
      onText: d => {
        touch(); if (!started) { started = true; onStart(); }
        if (thinkStart && !thinkEnd) { thinkEnd = Date.now(); send('thinking_done', { ms: thinkEnd - thinkStart }); }
        text += d; send('text', { delta: d });
        if (Date.now() - lastSave > 1000) { lastSave = Date.now(); save('streaming').catch(() => {}); }
      },
    });
  };
  try {
    const out = await answerWithFallback(candidates, async (cand, onStart) => {
      try {
        usage = await attempt(cand, onStart);
        noteProviderOk(providerOf(cand));
      } catch (e) {
        if (!started && !ac.signal.aborted) noteProviderError(providerOf(cand), e);
        throw e;
      }
    }, {
      onFail: (cand, e) => { const f = failureInfo((all.find(m => m.id === cand) || {}).name || cand, providerOf(cand), e); if (cand !== candidates.at(-1)) notes.push(`${(all.find(m => m.id === cand) || {}).name || cand} didn't answer (${f.code}); trying the next model`); },
    });
    answered = out.answered;
    if (out.skipped.length) {
      const m = all.find(x => x.id === answered);
      const reason = `${m.name} answered instead: ${out.skipped.map(s => (all.find(x => x.id === s.candidate) || {}).name || s.candidate).join(', ')} did not answer`;
      await run('UPDATE ai_chat_messages SET model = ?, route_reason = ? WHERE id = ?', answered, reason, aid);
      send('route', { model: answered, name: m.name, note: reason });
    }
    if (thinkStart && !thinkEnd) { thinkEnd = Date.now(); send('thinking_done', { ms: thinkEnd - thinkStart }); }
    await save('complete', usage || {}); await saveThinking();
    send('done', { status: 'complete', assistantMessageId: aid, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens });
  } catch (e) {
    const stopped = ac.userStopped === true || (!timedOut && !closedEarly && (ac.signal.aborted || e.name === 'AbortError'));
    const last = { cand: attempted, e };
    const name = (all.find(m => m.id === last.cand) || {}).name || last.cand;
    const info = closedEarly
      ? { text: 'The connection to the server closed during the reply. The text so far is kept.', code: 'closed', status: null }
      : failureInfo(name, providerOf(last.cand), timedOut ? Object.assign(new Error('timeout'), { name: 'TimeoutError' }) : e, { seconds: 60, midReply: started });
    await save(stopped ? 'stopped' : 'error', { outputTokens: E.estimateTokens(text + thinking), inputTokens: E.estimateTokens(msgs.map(m => m.content).join(' ')) }).catch(() => {});
    await saveThinking()?.catch?.(() => {});
    if (stopped) send('done', { status: 'stopped', assistantMessageId: aid });
    else {
      // The reason is kept with the reply, so reopening the conversation shows it (no message text, no key).
      const kept = text.length && !closedEarly ? ' The text so far is kept.' : '';
      const shown = (notes.length ? `${notes.join('. ')}. ${info.text}` : info.text) + kept;
      await run('UPDATE ai_chat_messages SET error = ?, model = ? WHERE id = ?', shown, last.cand, aid).catch(() => {});
      E.clog('stream_failed', { conversation: conv.id, message: aid, model: last.cand, status: info.status, reason: info.code, code: e.code || e.status || e.name });
      send('error', { message: shown, code: info.code, status: info.status, assistantMessageId: aid, model: last.cand, retry: true });
    }
  } finally { active.delete(aid); clearInterval(watchdog); stopPing(); res.end(); }
}
// Keep model-specific failures, such as Codex availability, separate from Auto's provider health.
const providerOf = id => id;

aiChatRouter.post('/conversations/:id/messages', route(async (req, res) => {
  const conv = await E.conversation(req.params.id, req.user.id), content = String(req.body?.content ?? '').trim();
  if (!content) throw E.bad('Write a message first.');
  if (content.length > 20000) throw E.bad('That message is too long (20,000 characters at most).');
  E.checkBudget(await E.tokensToday(req.user.id));
  const t = now();
  await run("INSERT INTO ai_chat_messages (conversation_id, role, content, status, model, input_tokens, output_tokens, created_at, updated_at) VALUES (?, 'user', ?, 'complete', NULL, 0, 0, ?, ?)", conv.id, content, t, t);
  if (conv.title === 'New chat') await run('UPDATE ai_chat_conversations SET title = ? WHERE id = ?', E.titleFrom(content), conv.id);
  if (req.body?.background === true) return backgroundInto(req, res, conv);
  await streamInto(req, res, conv, req.body?.model || conv.model);
}));
// "Run in background" (long questions): OpenAI works on it and the answer arrives through its webhook
// (src/openai-webhook.js), so no connection is held open. The reply shows a waiting note until then.
async function backgroundInto(req, res, conv) {
  const c = E.config();
  if (!rateLimit(`aichat:${req.user.id}`, c.messagesPerMinute, 60e3)) throw E.bad('You are sending messages too quickly. Please wait a minute.', 429, 'rate_limited');
  const msgs = history(await E.messages(conv.id, { withThinking: false }), c.historyMessages);
  if (!msgs.length || msgs.at(-1).role !== 'user') throw E.bad('Nothing to answer.');
  const L = await import('../llm.js');
  if (!L.providers().some(p => p.id === 'openai')) throw E.bad('Background answers use ChatGPT (OpenAI). Add its key in Admin → Keys.', 400, 'no_model');
  const OJ = await import('../openai-jobs.js');
  const t0 = now(), note = 'Working on it in the background. This answer appears here when OpenAI finishes (usually a few minutes). You can leave this page.';
  const aid = Number((await run("INSERT INTO ai_chat_messages (conversation_id, role, content, status, model, input_tokens, output_tokens, created_at, updated_at, route_reason) VALUES (?, 'assistant', ?, 'background', 'openai', 0, 0, ?, ?, ?)", conv.id, note, t0, t0, 'Background answer (ChatGPT)')).lastInsertRowid);
  await run('UPDATE ai_chat_conversations SET model = ?, updated_at = ? WHERE id = ?', 'openai', t0, conv.id);
  try {
    await OJ.startBackground({ input: msgs.map(m => ({ role: m.role, content: m.content })), instructions: c.systemPrompt, owner: req.user.id, conversationId: conv.id, messageId: aid, notify: true });
  } catch (e) {
    await run("UPDATE ai_chat_messages SET content = ?, status = 'error', updated_at = ? WHERE id = ?", `The background answer could not start: ${e.message}`, now(), aid);
    throw e;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  send('start', { assistantMessageId: aid, model: 'openai', name: 'ChatGPT (OpenAI)', thinking: false, route: { need: 'background', reason: 'Background answer (ChatGPT)' } });
  send('text', { delta: note });
  send('done', { status: 'background', assistantMessageId: aid });
  res.end();
}
// Regenerate (or retry after an error / a stop): the last assistant reply is replaced.
aiChatRouter.post('/conversations/:id/regenerate', route(async (req, res) => {
  const conv = await E.conversation(req.params.id, req.user.id);
  const last = await one('SELECT id, role FROM ai_chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', conv.id);
  if (last?.role === 'assistant') { if (active.has(last.id)) throw E.bad('A reply is still being written.', 409); await run('DELETE FROM ai_chat_thinking WHERE message_id = ?', last.id); await run('DELETE FROM ai_chat_messages WHERE id = ?', last.id); }
  await streamInto(req, res, conv, req.body?.model || conv.model);
}));
// Editing an earlier message starts a new conversation (a branch) with everything before it; the original stays.
aiChatRouter.post('/conversations/:id/branch', route(async (req, res) => {
  const conv = await E.conversation(req.params.id, req.user.id), mid = +req.body?.messageId;
  const target = await one("SELECT id FROM ai_chat_messages WHERE id = ? AND conversation_id = ? AND role = 'user'", mid, conv.id);
  if (!target) throw E.bad('Choose one of your own messages to edit.', 404);
  const id = E.newId(), t = now();
  await run('INSERT INTO ai_chat_conversations (id, owner_id, title, model, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, req.user.id, E.titleFrom(`${conv.title} (edited)`), conv.model, t, t);
  for (const m of await all("SELECT * FROM ai_chat_messages WHERE conversation_id = ? AND id < ? AND status IN ('complete', 'stopped') ORDER BY id", conv.id, mid)) {
    const nid = Number((await run('INSERT INTO ai_chat_messages (conversation_id, role, content, status, model, input_tokens, output_tokens, created_at, updated_at) VALUES (?,?,?,?,?,0,0,?,?)', id, m.role, m.content, m.status, m.model, m.created_at, m.updated_at)).lastInsertRowid);
    const th = await one('SELECT content, duration_ms FROM ai_chat_thinking WHERE message_id = ?', m.id);
    if (th) await run('INSERT INTO ai_chat_thinking (message_id, content, duration_ms) VALUES (?,?,?)', nid, th.content, th.duration_ms);
  }
  res.json({ id, model: conv.model });
}));
aiChatRouter.post('/messages/:id/stop', route(async (req, res) => {
  const m = await one('SELECT m.id FROM ai_chat_messages m JOIN ai_chat_conversations c ON c.id = m.conversation_id WHERE m.id = ? AND c.owner_id = ?', +req.params.id, req.user.id);
  if (!m) throw E.bad('Not found', 404);
  const ac = active.get(m.id); if (ac) { ac.userStopped = true; ac.abort(); }
  res.json({ stopped: !!ac });
}));

// ---------- the permission (owner only) ----------
aiChatRouter.get('/access', route(async (req, res) => { if (!isOwner(req.user.email)) throw E.bad('Only the owner manages this permission.', 403); res.json({ allowed: E.accessList() }); }));
aiChatRouter.put('/access', route(async (req, res) => {
  if (!isOwner(req.user.email)) throw E.bad('Only the owner manages this permission.', 403);
  const allowed = await E.setAccess(req.body?.email, !!req.body?.allowed);
  await audit(req.user.id, 'ai_chat_access', { allowed: !!req.body?.allowed }, req.ip);
  res.json({ allowed });
}));
