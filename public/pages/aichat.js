// Admin → AI team → Chat (#/admin-aichat): a normal back-and-forth conversation with the AI team's model.
// Replies stream from the server (POST + server-sent events); the browser never sees an API key or the
// system prompt. Model text is rendered only through chatmd.js, which escapes everything.
import { render as md, esc } from './chatmd.js';
let H;
export function registerAiChat(routes, helpers) { H = helpers; routes['admin-aichat'] = page; }

const API = '/api/admin/aichat';
const call = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong'), { status: r.status, ...d });
  return d;
};
const fmtTime = t => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
const secs = ms => (ms < 1000 ? 'under a second' : ms < 60e3 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60e3)} min ${Math.round((ms % 60e3) / 1000)} s`);
const copy = async (text, btn) => { try { await navigator.clipboard.writeText(text); } catch { const t = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(t); t.select(); document.execCommand?.('copy'); t.remove(); } const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = o), 1500); };

export async function page(view) {
  if (!document.querySelector('link[data-aichat-css]')) { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/aichat.css' }); l.dataset.aichatCss = '1'; document.head.append(l); }
  let status;
  try { status = await call('/status'); }
  catch (e) { view.innerHTML = `<h1>AI team chat</h1><p class="err" role="alert">${esc(e.status === 403 ? 'You do not have the AI team chat permission. The owner can grant it.' : `The chat could not start: ${e.message}`)}</p><p class="row"><button type="button" class="ghost" id="acRetry">Retry</button> <a href="#/admin-agents">Back to the AI team</a></p>`; const rt = view.querySelector('#acRetry'); if (rt) rt.onclick = () => page(view); return; }
  const S = { conv: null, convs: [], msgs: [], models: status.models, model: status.models[0]?.id, busy: null, stick: true, budget: status.budget };
  view.innerHTML = `<div class="ac-wrap">
    <aside class="ac-side" id="acSide" aria-label="Conversations">
      <div class="ac-sidehead"><h2>Conversations</h2><button type="button" class="ac-close-side" aria-label="Close conversations">×</button></div>
      <button type="button" class="ac-new">New chat</button>
      <ul class="ac-convs" aria-label="Conversation list"></ul>
      <p class="mu small-print">Chats are deleted after ${status.retentionDays} days.</p>
    </aside>
    <section class="ac-main" aria-labelledby="acTitle">
      <header class="ac-top">
        <button type="button" class="ac-open-side" aria-controls="acSide" aria-expanded="false">Conversations</button>
        <div class="ac-titles"><h1 id="acTitle">AI team chat</h1><p class="mu ac-sub"></p></div>
        <label class="ac-model">Model<select id="acModel">${S.models.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>
      </header>
      <p class="ac-budget mu" aria-live="off"></p>
      <div class="ac-scroll" id="acScroll"><ol class="ac-list" aria-label="Messages"></ol><p class="ac-empty mu">Start a conversation below.</p></div>
      <button type="button" class="ac-jump" hidden>Jump to the latest message</button>
      <div class="ac-sr" role="status" aria-live="polite" aria-atomic="true"></div>
      <form class="ac-form" novalidate>
        <label for="acInput" class="ac-sr">Message</label>
        <textarea id="acInput" rows="3" maxlength="20000" placeholder="Message the AI team (Enter to send, Shift+Enter for a new line)" aria-describedby="acHelp"></textarea>
        <p id="acHelp" class="ac-sr">Enter sends the message. Shift and Enter adds a new line.</p>
        <div class="ac-actions"><button type="submit" class="ac-send">Send</button><button type="button" class="ac-stop" hidden>Stop</button></div>
      </form>
    </section></div>`;
  // A missing element never throws: the lookup gives an empty stand-in, so a handler on it does nothing.
  const $ = s => view.querySelector(s) || document.createElement('div'), list = $('.ac-list'), scroller = $('#acScroll'), input = $('#acInput'), live = $('.ac-sr[role=status]');
  const announce = t => { live.textContent = ''; setTimeout(() => (live.textContent = t), 30); };
  const modelInfo = id => S.models.find(m => m.id === id) || {};
  const showBudget = () => { $('.ac-budget').textContent = S.budget ? `Today: ${S.budget.used.toLocaleString()} of ${S.budget.limit.toLocaleString()} tokens used.` : ''; };
  showBudget();
  if (!S.models.length) {
    // No model: keep the page and its controls, say why, and disable the message box and Send.
    const note = Object.assign(document.createElement('p'), { className: 'err' });
    note.setAttribute('role', 'alert');
    note.innerHTML = 'No AI model is available to you. Add a key in <a href="#/admin-keys">Admin → Keys</a> (for example OPENAI_API_KEY for ChatGPT).';
    $('.ac-form').before(note);
    input.disabled = true; $('.ac-send').disabled = true;
  }

  // ---------- conversation list (a drawer on phones) ----------
  const side = $('#acSide'), openBtn = $('.ac-open-side');
  const setDrawer = open => { side.classList.toggle('open', open); openBtn.setAttribute('aria-expanded', String(open)); if (open) side.querySelector('.ac-new').focus(); else openBtn.focus(); };
  openBtn.onclick = () => setDrawer(!side.classList.contains('open'));
  $('.ac-close-side').onclick = () => setDrawer(false);
  side.addEventListener('keydown', e => { if (e.key === 'Escape' && side.classList.contains('open')) setDrawer(false); });
  async function loadConvs() {
    S.convs = (await call('/conversations')).conversations;
    $('.ac-convs').innerHTML = S.convs.map(c => `<li data-id="${esc(c.id)}" class="${S.conv?.id === c.id ? 'on' : ''}"><button type="button" class="ac-open" ${S.conv?.id === c.id ? 'aria-current="true"' : ''}><span class="ac-ctitle">${esc(c.title)}</span><time datetime="${new Date(c.updatedAt).toISOString()}">${esc(fmtTime(c.updatedAt))}</time></button><span class="ac-cact"><button type="button" class="ac-rename" aria-label="Rename ${esc(c.title)}">Rename</button><button type="button" class="ac-del" aria-label="Delete ${esc(c.title)}">Delete</button></span></li>`).join('') || '<li class="mu">No conversations yet.</li>';
  }
  $('.ac-convs').addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const id = li.dataset.id, c = S.convs.find(x => x.id === id);
    if (e.target.closest('.ac-open')) { await openConv(id); if (matchMedia('(max-width: 860px)').matches) setDrawer(false); input.focus(); }
    else if (e.target.closest('.ac-del')) { if (!confirm(`Delete "${c.title}"? This cannot be undone.`)) return; await call(`/conversations/${id}`, { method: 'DELETE' }); if (S.conv?.id === id) { S.conv = null; S.msgs = []; drawAll(); } await loadConvs(); announce('Conversation deleted'); $('.ac-new').focus(); }
    else if (e.target.closest('.ac-rename')) {
      const title = li.querySelector('.ac-ctitle'), old = c.title;
      title.innerHTML = `<input class="ac-rn" aria-label="New title" maxlength="120" value="${esc(old)}">`;
      const inp = title.querySelector('input'); inp.focus(); inp.select();
      const finish = async ok => { const v = inp.value.trim(); if (ok && v && v !== old) { await call(`/conversations/${id}`, { method: 'PATCH', body: { title: v } }); announce('Renamed'); if (S.conv?.id === id) { S.conv.title = v; drawHead(); } } await loadConvs(); li.isConnected || view.querySelector(`li[data-id="${CSS.escape(id)}"] .ac-rename`)?.focus(); };
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } });
      inp.addEventListener('blur', () => finish(true), { once: true });
    }
  });
  $('.ac-new').onclick = async () => { const c = await call('/conversations', { method: 'POST', body: { model: S.model } }); await openConv(c.id); await loadConvs(); if (matchMedia('(max-width: 860px)').matches) setDrawer(false); input.focus(); announce('New chat'); };
  $('#acModel').onchange = e => { S.model = e.target.value; };

  async function openConv(id) {
    const c = await call(`/conversations/${id}`);
    S.conv = c; S.msgs = c.messages; if (modelInfo(c.model).id) { S.model = c.model; $('#acModel').value = c.model; }
    drawAll(); await loadConvs(); toBottom(true);
  }
  const drawHead = () => { $('#acTitle').textContent = S.conv ? S.conv.title : 'AI team chat'; $('.ac-sub').textContent = S.conv ? `Model: ${modelInfo(S.conv.model).name || S.conv.model}` : ''; };

  // ---------- messages ----------
  const lastAssistant = () => [...S.msgs].reverse().find(m => m.role === 'assistant');
  function msgHtml(m) {
    const time = `<time datetime="${new Date(m.createdAt).toISOString()}">${esc(fmtTime(m.createdAt))}</time>`;
    if (m.role === 'user') return `<li class="ac-msg ac-user" data-id="${m.id}"><div class="ac-meta"><b>You</b> ${time}</div><div class="ac-body ac-plain">${esc(m.content)}</div><div class="ac-mact"><button type="button" class="ac-edit">Edit</button></div></li>`;
    const think = modelInfo(m.model).thinking || m.thinking;
    const streaming = m.status === 'streaming', isLast = lastAssistant()?.id === m.id;
    const st = { stopped: 'Stopped', error: 'Interrupted' }[m.status];
    return `<li class="ac-msg ac-asst" data-id="${m.id}" data-key="${esc(m.key ?? m.id)}"><div class="ac-meta"><b>Assistant</b> ${time}${st ? ` <span class="pill">${st}</span>` : ''}</div>
      ${think && (m.thinking || streaming) ? `<details class="ac-think"><summary><span class="ac-tlabel">Thinking</span> <span class="ac-tstate">${m.thinkingDone || !streaming ? (m.thinkingMs != null ? `for ${secs(m.thinkingMs)}` : '') : '<span class="ac-dot" aria-hidden="true"></span> thinking…'}</span></summary><div class="ac-tbody">${esc(m.thinking || '')}</div><button type="button" class="ac-copythink">Copy thinking</button></details>` : ''}
      <div class="ac-body md">${md(m.content)}${streaming ? '<span class="ac-cursor" aria-hidden="true"></span>' : ''}</div>
      ${routeLine(m)}
      ${m.status === 'error' ? `<p class="err ac-errline" role="alert">${esc(m.error || 'The reply was interrupted. The text so far is kept.')} <button type="button" class="ac-retry">Retry</button></p>` : ''}
      ${streaming ? '' : `<div class="ac-mact"><button type="button" class="ac-copy">Copy</button>${isLast ? '<button type="button" class="ac-regen">Regenerate</button>' : ''}${strongest() && strongest().id !== m.model ? '<button type="button" class="ac-stronger">Retry with a stronger model</button>' : ''}</div>`}</li>`;
  }
  // Under each answer: which model answered and why (the router's reason), and the size of the answer.
  function routeLine(m) {
    const why = m.routeReason || m.route?.reason || '';
    const name = m.name || modelInfo(m.model).name || '';
    const tokens = (m.inputTokens || 0) + (m.outputTokens || 0);
    if (!why && !name) return '';
    return `<p class="mu small-print ac-route">Answered by <b>${esc(why || name)}</b>${tokens ? ` · ${tokens.toLocaleString()} tokens` : ''}</p>`;
  }
  // The strongest model that has a key: Claude, then ChatGPT, then the first other one (never Auto).
  function strongest() { const list = S.models.filter(x => !x.auto); return list.find(x => x.id === 'anthropic') || list.find(x => x.id === 'openai') || list[0] || null; }
  function drawAll() {
    drawHead();
    list.innerHTML = S.msgs.map(msgHtml).join('');
    $('.ac-empty').hidden = S.msgs.length > 0;
  }
  // While streaming only the one message is redrawn, at most once per frame (no layout thrash, no per-token announcements).
  let pending = null;
  function redraw(m) {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      const li = list.querySelector(`li[data-key="${CSS.escape(String(m.key ?? m.id))}"]`), openThink = li?.querySelector('details')?.open;
      const tmp = document.createElement('template'); tmp.innerHTML = msgHtml(m).trim();
      const node = tmp.content.firstChild;
      if (openThink) node.querySelector('details')?.setAttribute('open', '');
      li ? li.replaceWith(node) : list.append(node);
      $('.ac-empty').hidden = true;
      toBottom();
    });
  }
  const atBottom = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 48;
  scroller.addEventListener('scroll', () => { S.stick = atBottom(); $('.ac-jump').hidden = S.stick || !S.busy; }, { passive: true });
  const toBottom = (force = false) => { if (force || S.stick) scroller.scrollTop = scroller.scrollHeight; };
  $('.ac-jump').onclick = () => { S.stick = true; toBottom(true); $('.ac-jump').hidden = true; input.focus(); };

  list.addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const m = S.msgs.find(x => String(x.id) === li.dataset.id);
    if (e.target.closest('[data-copy-code]')) return copy(e.target.closest('.md-code').querySelector('code').textContent, e.target);
    if (e.target.closest('.ac-copy')) return copy(m.content, e.target);             // the answer only, never the thinking
    if (e.target.closest('.ac-copythink')) return copy(m.thinking || '', e.target);
    if (e.target.closest('.ac-regen') || e.target.closest('.ac-retry')) return stream(`/conversations/${S.conv.id}/regenerate`, { model: S.model }, true);
    if (e.target.closest('.ac-stronger')) { const sm = strongest(); if (sm) return stream(`/conversations/${S.conv.id}/regenerate`, { model: sm.id }, true); }
    if (e.target.closest('.ac-edit')) {
      const body = li.querySelector('.ac-body');
      body.innerHTML = `<label class="ac-sr" for="acEdit${m.id}">Edit your message</label><textarea id="acEdit${m.id}" rows="3">${esc(m.content)}</textarea><div class="ac-mact"><button type="button" class="ac-save">Save and send as a new branch</button><button type="button" class="ac-cancel">Cancel</button></div>`;
      const ta = body.querySelector('textarea'); ta.focus();
      body.querySelector('.ac-cancel').onclick = () => { drawAll(); list.querySelector(`li[data-id="${m.id}"] .ac-edit`)?.focus(); };
      ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') body.querySelector('.ac-cancel').click(); });
      body.querySelector('.ac-save').onclick = async () => {
        const text = ta.value.trim(); if (!text) return;
        const b = await call(`/conversations/${S.conv.id}/branch`, { method: 'POST', body: { messageId: m.id } });
        await openConv(b.id); announce('Started a new branch with your edited message');
        await send(text);
      };
    }
  });

  // ---------- streaming ----------
  async function send(text) {
    if (!S.conv) { const c = await call('/conversations', { method: 'POST', body: { model: S.model } }); S.conv = { ...c, messages: [] }; S.msgs = []; }
    const now = Date.now();
    S.msgs.push({ id: `u${now}`, role: 'user', content: text, createdAt: now, status: 'complete' });
    drawAll(); toBottom(true);
    await stream(`/conversations/${S.conv.id}/messages`, { content: text, model: S.model });
    // Real ids from the server (so Edit and Regenerate work on these messages too).
    try {
      const c = await call(`/conversations/${S.conv.id}`), onRetry = document.activeElement?.classList.contains('ac-retry');
      S.conv.title = c.title; S.msgs = c.messages;
      if (!S.busy) { drawAll(); (onRetry ? list.querySelector('.ac-retry') : null)?.focus(); }
    } catch {}
    await loadConvs(); drawHead();
  }
  async function stream(path, body, regenerate = false) {
    if (S.busy) return;
    if (regenerate) { const la = lastAssistant(); if (la && S.msgs.at(-1) === la) { S.msgs.pop(); drawAll(); } }
    const ac = new AbortController(), m = { id: `a${Date.now()}`, key: `k${Date.now()}`, role: 'assistant', content: '', thinking: '', status: 'streaming', model: S.model, createdAt: Date.now() };
    S.busy = { ac, m }; setBusy(true); announce('The assistant is replying…'); S.stick = true;
    S.msgs.push(m); redraw(m);
    let r;
    try {
      r = await fetch(API + path, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw Object.assign(new Error(d.error || 'The request failed'), { status: r.status, early: true }); }
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, k); buf = buf.slice(k + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1], data = JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] || '{}');
          if (ev === 'start') { m.id = data.assistantMessageId; m.model = data.model; m.name = data.name || ''; m.route = data.route || null; redraw(m); }
          else if (ev === 'thinking') { m.thinking += data.delta; redraw(m); }
          else if (ev === 'thinking_done') { m.thinkingDone = true; m.thinkingMs = data.ms; redraw(m); }
          else if (ev === 'text') { m.content += data.delta; redraw(m); }
          else if (ev === 'done') { m.status = data.status; announce(data.status === 'stopped' ? 'Stopped. The text so far is kept.' : 'The reply is complete.'); }
          else if (ev === 'error') { m.status = 'error'; m.error = data.message; announce('The reply was interrupted. You can retry.'); }
        }
      }
      if (m.status === 'streaming') { m.status = 'error'; m.error = 'The connection closed before the reply finished. The text so far is kept.'; }
    } catch (e) {
      if (ac.signal.aborted) { m.status = 'stopped'; announce('Stopped. The text so far is kept.'); }
      else if (e.early) { S.msgs.pop(); drawAll(); showError(e.message); announce(e.message); }
      else { m.status = 'error'; m.error = 'The connection was lost. The text so far is kept.'; announce('The reply was interrupted. You can retry.'); }
    } finally {
      S.busy = null; setBusy(false);
      if (S.msgs.includes(m)) { cancelAnimationFrame(pending); pending = null; drawAll(); toBottom(); }
      call('/status').then(s => { S.budget = s.budget; showBudget(); }).catch(() => {});
      if (m.status !== 'error') input.focus(); else list.querySelector('.ac-retry')?.focus();
    }
  }
  const showError = text => { let p = $('.ac-form .err'); if (!p) { p = Object.assign(document.createElement('p'), { className: 'err' }); p.setAttribute('role', 'alert'); $('.ac-form').prepend(p); } p.textContent = text; };
  const setBusy = on => { $('.ac-send').hidden = on; $('.ac-stop').hidden = !on; input.setAttribute('aria-busy', String(on)); if (on) $('.ac-stop').focus?.(); };
  $('.ac-stop').onclick = () => { const b = S.busy; if (!b) return; b.ac.abort(); if (Number.isInteger(b.m.id)) call(`/messages/${b.m.id}/stop`, { method: 'POST', body: {} }).catch(() => {}); };
  $('.ac-form').addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text || S.busy) return;
    $('.ac-form .err')?.remove();
    input.value = ''; await send(text);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('.ac-form').requestSubmit(); } });

  // Opens as a new conversation (created on the first message); earlier ones are one click away in the list.
  await loadConvs(); drawAll(); input.focus();
}
