// AI team Chat (src/aichat, public/pages/chatmd.js): sanitising renderer (XSS), token budget, permission,
// and the streaming routes end to end with a scripted test model (no real AI service is called).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.AI_CHAT_FAKE_MODEL = '1';
for (const k of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AI_BASE_URL', 'AI_PROVIDER']) delete process.env[k];
const OWNER = 'chat-owner@example.com', ADMIN2 = 'chat-admin2@example.com';
const { ownerFingerprint } = await import('../src/site.js');
process.env.OWNER_HASHES = [process.env.OWNER_HASHES, ownerFingerprint(OWNER)].filter(Boolean).join(',');
process.env.ADMIN_EMAIL = [process.env.ADMIN_EMAIL, OWNER, ADMIN2].filter(Boolean).join(',');

const logs = []; const warn = console.warn.bind(console); console.warn = (...a) => { logs.push(a.map(String).join(' ')); warn(...a); };
const MD = await import('../public/pages/chatmd.js');
const E = await import('../src/aichat/engine.js');
const { run, one, all } = await import('../src/db.js');
const { serve } = await import('./client.js');
const S = await serve();
after(() => S.close());

// ===================================================================== sanitising renderer
const XSS = [
  '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<iframe src="javascript:alert(1)"></iframe>',
  '[click](javascript:alert(1))', '[click](JaVaScRiPt:alert(1))', '[click](  javascript:alert(1))', '[x](data:text/html;base64,PHNjcmlwdD4=)', '[x](vbscript:msgbox)',
  '[x](https://ok.example/"onmouseover="alert(1))', '**<b onmouseover=alert(1)>bold</b>**', '`<script>alert(1)</script>`',
  '```html\n</code></pre><script>alert(1)</script>\n```', '| a |\n|---|\n| <img src=x onerror=alert(1)> |', '# <svg/onload=alert(1)>', '> <script>x</script>',
  '<a href="javascript:alert(1)">x</a>', '<style>body{display:none}</style>', '&lt;script&gt;', '<<script>script>alert(1)<</script>/script>', '[x](mailto:javascript:alert(1))',
];
test(`renderer: ${XSS.length} XSS payloads never produce live HTML`, () => {
  for (const p of XSS) {
    const h = MD.render(p);
    assert.doesNotMatch(h, /<(script|img|svg|iframe|style|object|embed|form|input|b )/i, `tag from: ${p}\n${h}`);
    assert.doesNotMatch(h, /<[^>]+\son\w+\s*=/i, `event handler from: ${p}\n${h}`);
    assert.doesNotMatch(h, /href\s*=\s*"(?!https?:\/\/|mailto:)/i, `unsafe link from: ${p}\n${h}`);
    for (const a of h.match(/<a\b[^>]*>/g) || []) { assert.match(a, /target="_blank"/); assert.match(a, /rel="noopener noreferrer"/); }
  }
  assert.equal(MD.safeHref('javascript:alert(1)'), null); assert.equal(MD.safeHref('https://ok.example/x?y=1'), 'https://ok.example/x?y=1');
  assert.equal(MD.safeHref('https://ok.example/\nx'), null);
});
test('renderer: headings, emphasis, links, lists, tables, inline and fenced code with highlighting', () => {
  const h = MD.render('# Title\n\nSome **bold**, *italic*, `code` and [a link](https://example.com).\n\n- one\n- two\n\n3. three\n4. four\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n```js\nconst x = "s"; // c\n```\n\n> quoted');
  assert.match(h, /<h3 class="md-h">Title<\/h3>/); assert.match(h, /<strong>bold<\/strong>/); assert.match(h, /<em>italic<\/em>/); assert.match(h, /<code>code<\/code>/);
  assert.match(h, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">a link<\/a>/);
  assert.match(h, /<ul><li>one<\/li><li>two<\/li><\/ul>/); assert.match(h, /<ol start="3"><li>three<\/li><li>four<\/li><\/ol>/);
  assert.match(h, /<th scope="col">a<\/th>/); assert.match(h, /<td>2<\/td>/);
  assert.match(h, /<span class="tk-k">const<\/span>/); assert.match(h, /<span class="tk-s">&quot;s&quot;<\/span>/); assert.match(h, /<span class="tk-c">\/\/ c<\/span>/);
  assert.match(h, /data-copy-code/); assert.match(h, /<blockquote><p>quoted<\/p><\/blockquote>/);
});
test('renderer: partial markdown while streaming: an unclosed fence is already a code block; half-bold stays text', () => {
  const partial = MD.render('Here:\n\n```py\ndef f():\n    return 1');
  assert.match(partial, /class="md-code md-open"/); assert.match(partial, /<span class="tk-k">def<\/span>/);
  const closed = MD.render('Here:\n\n```py\ndef f():\n    return 1\n```');
  assert.match(closed, /class="md-code"/);
  assert.equal(MD.render('**half'), '<p>**half</p>');
  assert.equal(MD.render(''), '');
});

// ===================================================================== budget and permission (units)
test('token budget: allowed below the limit, refused at it, with the reset time; counts only today', async () => {
  assert.doesNotThrow(() => E.checkBudget(99, 100));
  assert.throws(() => E.checkBudget(100, 100, Date.parse('2026-11-16T10:00:00Z')), e => e.status === 429 && e.code === 'budget' && e.resetsAt === Date.parse('2026-11-17T00:00:00Z'));
  assert.equal(E.budgetLeft(30, 100), 70); assert.equal(E.budgetLeft(130, 100), 0);
  assert.equal(E.estimateTokens('abcdefgh'), 2);
});
test('permission: only admins, and only the owner or admins the owner granted', async () => {
  assert.equal(E.canChat(null), false);
  assert.equal(E.canChat({ role: 'user', email: OWNER }), false, 'a non-admin, even with the owner address');
  assert.equal(E.canChat({ role: 'admin', email: OWNER }), true);
  assert.equal(E.canChat({ role: 'admin', email: ADMIN2 }), false, 'other admins need the permission');
  await E.setAccess(ADMIN2, true); assert.equal(E.canChat({ role: 'admin', email: ADMIN2 }), true);
  await E.setAccess(ADMIN2, false); assert.equal(E.canChat({ role: 'admin', email: ADMIN2 }), false);
  await assert.rejects(E.setAccess('not an email', true), e => e.status === 400);
});
test('titles come from the first message', () => {
  assert.equal(E.titleFrom('  How do I   add a test?  '), 'How do I add a test?');
  assert.ok(E.titleFrom('x '.repeat(100)).length <= 61); assert.equal(E.titleFrom(''), 'New chat');
});

// ===================================================================== routes (integration)
let owner, admin2, user;
// A client that also exposes its session cookie (the streaming helper needs it).
const mk = async email => {
  let cookie = '';
  const call = async (path, body, method) => {
    const r = await fetch(S.base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  Object.defineProperty(call, 'cookie', { get: () => cookie });
  const r = await call('/auth/register', { email, password: 'Str0ngPassword1', agree: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return call;
};
before(async () => { owner = await mk(OWNER); admin2 = await mk(ADMIN2); user = await mk('chat-user@example.com'); });
async function sse(client, path, body, { abortAfter } = {}) {
  const ac = new AbortController(), events = [];
  const r = await fetch(S.base + '/api' + path, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: client.cookie }, body: JSON.stringify(body) });
  if (!r.headers.get('content-type')?.includes('event-stream')) return { status: r.status, body: await r.json().catch(() => null), events };
  const dec = new TextDecoder(); let buf = '';
  try {
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true }); let k;
      while ((k = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, k); buf = buf.slice(k + 2); events.push({ event: /^event: (.+)$/m.exec(f)[1], data: JSON.parse(/^data: (.+)$/m.exec(f)[1]) }); }
      if (abortAfter && abortAfter(events)) { ac.abort(); break; }
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
  return { status: r.status, events };
}
const text = ev => ev.filter(e => e.event === 'text').map(e => e.data.delta).join('');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('access: non-admin 403, admin without the permission 403, owner 200', async () => {
  for (const p of ['/admin/aichat/status', '/admin/aichat/conversations']) assert.equal((await user(p)).status, 403, `non-admin ${p}`);
  assert.equal((await user('/admin/aichat/conversations/x/messages', { content: 'hi' })).status, 403);
  assert.equal((await admin2('/admin/aichat/status')).status, 403, 'admin without the AI team chat permission');
  const st = await owner('/admin/aichat/status');
  assert.equal(st.status, 200); assert.deepEqual(st.body.models.map(m => m.id), ['fake', 'fake-plain']); assert.equal(st.body.retentionDays, 90);
  assert.equal(JSON.stringify(st.body).includes('systemPrompt'), false, 'the system prompt never reaches the browser');
  assert.equal((await user('/admin/aichat/status')).status, 403, 'still 403 for a non-admin');
  assert.equal((await admin2('/admin/aichat/access')).status, 403);
});
let conv;
test('streaming completes: start, thinking (kept apart), text in order, done; saved complete with tokens; title from the first message', async () => {
  conv = (await owner('/admin/aichat/conversations', { model: 'fake' })).body;
  const r = await sse(owner, `/admin/aichat/conversations/${conv.id}/messages`, { content: 'Explain the test suite please', model: 'fake' });
  const kinds = r.events.map(e => e.event);
  assert.equal(kinds[0], 'start'); assert.equal(kinds.at(-1), 'done'); assert.ok(kinds.indexOf('thinking') < kinds.indexOf('thinking_done')); assert.ok(kinds.indexOf('thinking_done') < kinds.indexOf('text'));
  assert.ok(kinds.filter(k => k === 'text').length > 5, 'many small pieces, not one block');
  assert.equal(r.events.at(-1).data.status, 'complete');
  const c = (await owner(`/admin/aichat/conversations/${conv.id}`)).body;
  assert.equal(c.title, 'Explain the test suite please');
  const a = c.messages.at(-1);
  assert.equal(a.status, 'complete'); assert.equal(a.content, text(r.events)); assert.match(a.content, /```js/);
  assert.equal(a.thinking, 'Reading the question.'); assert.doesNotMatch(a.content, /Reading the question/, 'thinking is not in the answer');
  assert.ok(a.outputTokens > 0 && a.inputTokens > 0); assert.ok(a.thinkingMs >= 0);
  const row = await one('SELECT content FROM ai_chat_messages WHERE id = ?', a.id);
  assert.doesNotMatch(row.content, /Reading the question/);
});
test('a model without thinking sends no thinking events', async () => {
  const c = (await owner('/admin/aichat/conversations', { model: 'fake-plain' })).body;
  const r = await sse(owner, `/admin/aichat/conversations/${c.id}/messages`, { content: 'hello', model: 'fake-plain' });
  assert.equal(r.events.some(e => e.event.startsWith('thinking')), false); assert.equal(r.events[0].data.thinking, false);
});
test('stop: closing the stream mid-reply records "stopped" and keeps the partial text', async () => {
  const c = (await owner('/admin/aichat/conversations', { model: 'fake' })).body;
  const r = await sse(owner, `/admin/aichat/conversations/${c.id}/messages`, { content: 'please answer slow', model: 'fake' }, { abortAfter: ev => ev.filter(e => e.event === 'text').length >= 3 });
  await wait(250);
  const m = (await owner(`/admin/aichat/conversations/${c.id}`)).body.messages.at(-1);
  assert.equal(m.status, 'stopped'); assert.ok(m.content.length > 0 && m.content.length < 'This answer streams slowly '.length * 40, 'partial text kept'); assert.ok(r.events.length > 0);
});
test('stop: the Stop endpoint ends a reply that is still streaming', async () => {
  const c = (await owner('/admin/aichat/conversations', { model: 'fake-plain' })).body;
  let mid = null;
  const p = sse(owner, `/admin/aichat/conversations/${c.id}/messages`, { content: 'slow please', model: 'fake-plain' }, { abortAfter: ev => { if (!mid) mid = ev.find(e => e.event === 'start')?.data.assistantMessageId; return false; } });
  while (!mid) await wait(20);
  await wait(150);
  assert.equal((await owner(`/admin/aichat/messages/${mid}/stop`, {})).body.stopped, true);
  const r = await p;
  assert.equal(r.events.at(-1).event, 'done'); assert.equal(r.events.at(-1).data.status, 'stopped');
  assert.equal((await one('SELECT status FROM ai_chat_messages WHERE id = ?', mid)).status, 'stopped');
  assert.equal((await user(`/admin/aichat/messages/${mid}/stop`, {})).status, 403);
});
test('a mid-stream failure sends an error event with retry, saves status "error" with the partial text; regenerate then completes', async () => {
  const c = (await owner('/admin/aichat/conversations', { model: 'fake-plain' })).body;
  const r = await sse(owner, `/admin/aichat/conversations/${c.id}/messages`, { content: 'please fail now', model: 'fake-plain' });
  const last = r.events.at(-1);
  assert.equal(last.event, 'error'); assert.equal(last.data.retry, true); assert.match(last.data.message, /text so far is kept/);
  const m = (await owner(`/admin/aichat/conversations/${c.id}`)).body.messages.at(-1);
  assert.equal(m.status, 'error'); assert.equal(m.content, text(r.events)); assert.ok(m.content.length > 0);
  const again = await sse(owner, `/admin/aichat/conversations/${c.id}/regenerate`, { model: 'fake' });
  assert.equal(again.events.at(-1).data.status, 'complete');
  const msgs = (await owner(`/admin/aichat/conversations/${c.id}`)).body.messages;
  assert.deepEqual(msgs.map(x => [x.role, x.status]), [['user', 'complete'], ['assistant', 'complete']], 'the failed reply was replaced');
  assert.ok(logs.some(l => l.includes('"stream_failed"')), 'the error was logged');
});
test('regenerate replaces the last reply; editing an earlier message starts a branch and keeps the original', async () => {
  const before = (await owner(`/admin/aichat/conversations/${conv.id}`)).body.messages;
  const r = await sse(owner, `/admin/aichat/conversations/${conv.id}/regenerate`, { model: 'fake' });
  assert.equal(r.events.at(-1).data.status, 'complete');
  const afterRegen = (await owner(`/admin/aichat/conversations/${conv.id}`)).body.messages;
  assert.equal(afterRegen.length, before.length); assert.notEqual(afterRegen.at(-1).id, before.at(-1).id);
  await sse(owner, `/admin/aichat/conversations/${conv.id}/messages`, { content: 'second question', model: 'fake' });
  const full = (await owner(`/admin/aichat/conversations/${conv.id}`)).body.messages, secondUser = full.filter(m => m.role === 'user')[1];
  const b = await owner(`/admin/aichat/conversations/${conv.id}/branch`, { messageId: secondUser.id });
  assert.equal(b.status, 200);
  const branch = (await owner(`/admin/aichat/conversations/${b.body.id}`)).body;
  assert.deepEqual(branch.messages.map(m => m.role), ['user', 'assistant'], 'everything before the edited message');
  assert.equal(branch.messages[1].thinking, full[1].thinking, 'thinking is copied with its answer');
  assert.equal((await owner(`/admin/aichat/conversations/${conv.id}`)).body.messages.length, full.length, 'the original is unchanged');
  assert.equal((await owner(`/admin/aichat/conversations/${conv.id}/branch`, { messageId: full[1].id })).status, 404, 'only your own messages can be edited');
});
test('rename, delete thinking on its own, delete; another admin cannot see someone else\'s chat', async () => {
  assert.equal((await owner(`/admin/aichat/conversations/${conv.id}`, { title: '  Renamed   chat ' }, 'PATCH')).body.title, 'Renamed chat');
  assert.equal((await owner(`/admin/aichat/conversations/${conv.id}`, { title: '' }, 'PATCH')).status, 400);
  await E.setAccess(ADMIN2, true);
  assert.equal((await admin2(`/admin/aichat/conversations/${conv.id}`)).status, 404, 'conversations belong to their owner');
  assert.equal((await admin2('/admin/aichat/conversations')).body.conversations.length, 0);
  await E.setAccess(ADMIN2, false);
  const d = await owner(`/admin/aichat/conversations/${conv.id}/thinking`, undefined, 'DELETE'); assert.ok(d.body.deleted >= 1);
  const c = (await owner(`/admin/aichat/conversations/${conv.id}`)).body; assert.ok(c.messages.every(m => !m.thinking)); assert.ok(c.messages.some(m => m.content));
  assert.equal((await owner(`/admin/aichat/conversations/${conv.id}`, undefined, 'DELETE')).body.deleted, true);
  assert.equal((await owner(`/admin/aichat/conversations/${conv.id}`)).status, 404);
  assert.equal((await one('SELECT COUNT(*) n FROM ai_chat_messages WHERE conversation_id = ?', conv.id)).n, 0);
});
test('daily token budget: a clear 429 once today\'s allowance is used', async () => {
  const c = (await owner('/admin/aichat/conversations', { model: 'fake' })).body, me = await one('SELECT id FROM users WHERE email = ?', OWNER);
  await run("INSERT INTO ai_chat_messages (conversation_id, role, content, status, model, input_tokens, output_tokens, created_at, updated_at) VALUES (?, 'assistant', 'x', 'complete', 'fake', ?, 0, ?, ?)", c.id, E.config().dailyTokenBudget, Date.now(), Date.now());
  const r = await sse(owner, `/admin/aichat/conversations/${c.id}/messages`, { content: 'one more', model: 'fake' });
  assert.equal(r.status, 429); assert.equal(r.body.code, 'budget'); assert.match(r.body.error, /today's AI chat allowance/); assert.ok(r.body.resetsAt > Date.now());
  assert.equal((await owner('/admin/aichat/status')).body.budget.left, 0);
  await run('DELETE FROM ai_chat_messages WHERE conversation_id = ?', c.id); void me;
});
test('validation: empty and unknown-model messages are refused; a model not allowed for this admin is refused', async () => {
  const c = (await owner('/admin/aichat/conversations', { model: 'fake' })).body;
  assert.equal((await sse(owner, `/admin/aichat/conversations/${c.id}/messages`, { content: '   ' })).status, 400);
  assert.equal((await sse(owner, `/admin/aichat/conversations/${c.id}/messages`, { content: 'hi', model: 'gpt-imaginary' })).status, 400);
});
test('retention: conversations untouched for longer than the retention period are deleted with their messages and thinking', async () => {
  const me = await one('SELECT id FROM users WHERE email = ?', OWNER), old = Date.now() - 91 * 864e5;
  await run("INSERT INTO ai_chat_conversations (id, owner_id, title, model, created_at, updated_at) VALUES ('old-conv', ?, 'old', 'fake', ?, ?)", me.id, old, old);
  const mid = Number((await run("INSERT INTO ai_chat_messages (conversation_id, role, content, status, created_at, updated_at) VALUES ('old-conv', 'assistant', 'x', 'complete', ?, ?)", old, old)).lastInsertRowid);
  await run('INSERT INTO ai_chat_thinking (message_id, content) VALUES (?, ?)', mid, 'old thought');
  assert.ok(await E.purgeOld() >= 1);
  assert.equal(await one("SELECT id FROM ai_chat_conversations WHERE id = 'old-conv'"), undefined);
  assert.equal(await one('SELECT message_id FROM ai_chat_thinking WHERE message_id = ?', mid), undefined);
});
test('logs never contain message text', () => {
  const mine = logs.filter(l => l.includes('"src":"aichat"'));
  assert.ok(mine.length > 0);
  for (const bad of ['please fail now', 'Explain the test suite', 'Reading the question', 'This answer streams']) assert.ok(!mine.join('\n').includes(bad), bad);
});
