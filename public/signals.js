// Webhooks page: private URLs that turn TradingView / TrendSpider / Zapier alerts into orders,
// with sizing and risk rules per webhook, a test sender and the signal log.
let H; // helpers from app.js

export function registerSignals(routes, helpers) {
  H = helpers;
  routes.signals = signals;
}

const TEMPLATES = {
  'TradingView strategy': `{
  "ticker": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "quantity": "{{strategy.order.contracts}}",
  "sentiment": "{{strategy.market_position}}",
  "price": "{{close}}"
}`,
  'TradingView alert (buy)': `{ "ticker": "{{ticker}}", "action": "buy" }`,
  'Exit a position': `{ "ticker": "AAPL", "action": "exit" }`,
  'Plain text': 'buy AAPL 10',
};
let ACCTS = [];
const nm = id => (id === 'paper' ? 'Paper' : ACCTS.find(a => a.id === id)?.name || id);
const STATUS = { ok: ['Filled', 'pos'], partial: ['Partly done', 'warn'], rejected: ['Rejected', 'neg'] };

function hookForm(h, paid) {
  const v = (k, d = '') => H.esc(h?.[k] ?? d);
  const acc = h?.accounts || ['paper'];
  return `<form class="card" id="hookForm"><h2>${h ? 'Edit webhook' : 'New webhook'}</h2>
    <div class="grid2">
      <label>Name<input name="name" maxlength="60" placeholder="SPY trend strategy" value="${v('name')}"></label>
      <label>Allowed tickers <span class="mu">(optional)</span><input name="symbols" placeholder="SPY, QQQ, AAPL" value="${v('symbols')}"></label>
    </div>
    <div class="lbl">Send orders to</div>
    <div class="chips" id="accts">
      ${ACCTS.filter(a => a.connected || a.id === 'alpaca' || acc.includes(a.id)).map(a => `<label class="chk"><input type="checkbox" name="acct" value="${a.id}" ${acc.includes(a.id) ? 'checked' : ''}> ${H.esc(H.acctLabel(a))} ${a.id !== 'paper' && !paid ? '<span class="pill">Pro</span>' : ''}</label>`).join('')}
    </div>
    <div class="grid2">
      <label>Order size<select name="sizeMode">
        <option value="dollars" ${h?.sizeMode === 'dollars' || !h ? 'selected' : ''}>Fixed dollar amount</option>
        <option value="qty" ${h?.sizeMode === 'qty' ? 'selected' : ''}>Fixed number of shares</option>
        <option value="signal" ${h?.sizeMode === 'signal' ? 'selected' : ''}>Use the size in the alert</option></select></label>
      <label id="sizeL">Amount<input name="size" type="number" min="0" step="any" value="${v('size', 1000)}"></label>
    </div>
    <div class="lbl">Risk rules <span class="mu">(leave empty for no limit)</span></div>
    <div class="grid2">
      <label>Max position per ticker ($)<input name="maxPosition" type="number" min="0" step="any" placeholder="No limit" value="${v('maxPosition')}"></label>
      <label>Max trades per day<input name="maxTradesDay" type="number" min="1" step="1" placeholder="No limit" value="${v('maxTradesDay')}"></label>
    </div>
    <p class="mu" style="font-size:13px">Long only: sells never go below zero shares, and "exit" sells the whole position.</p>
    <div class="row"><button>${h ? 'Save changes' : 'Create webhook'}</button>${h ? '<button type="button" class="ghost" id="cancelEdit">Cancel</button>' : ''}</div><div class="err"></div></form>`;
}

async function signals(view, q) {
  const me = H.me(), paid = me.role === 'admin' || (['pro', 'elite', 'ultimate'].includes(me.plan) && ['active', 'trialing', null, undefined].includes(me.planStatus));
  const [{ hooks, limit }, log, accts] = await Promise.all([H.api('/signals/hooks'), H.api('/signals/log'), H.accounts()]);
  ACCTS = accts;
  const editing = hooks.find(h => h.id === +q.get('edit'));
  view.innerHTML = `
  <div class="pagehead"><div><h1>Alerts to trades</h1><p class="mu" style="margin:4px 0 0">Send an alert from TradingView, TrendSpider, Zapier, a script or an AI agent. It becomes an order in the accounts you choose, inside your risk rules.</p></div></div>
  <div class="flow">
    <div><b>1</b><span><strong>Create</strong> a webhook with sizing and risk rules</span></div>
    <div><b>2</b><span><strong>Paste</strong> its URL into your alert</span></div>
    <div><b>3</b><span><strong>Trade</strong>: every alert is executed and logged</span></div>
  </div>
  <div id="hooks">${hooks.map(h => `
    <div class="card hook ${h.enabled ? '' : 'off'}" data-id="${h.id}">
      <div class="hookhead"><div><h2 style="margin:0">${H.esc(h.name)}</h2>
        <div class="mu" style="font-size:13px">${h.accounts.map(a => `<span class="pill">${H.esc(nm(a))}</span>`).join(' ')}
        ${h.sizeMode === 'signal' ? 'Size from alert' : h.sizeMode === 'qty' ? `${h.size} shares` : `${H.money(h.size)} per order`}
        ${h.maxPosition ? ` · max ${H.money(h.maxPosition)}/ticker` : ''}${h.maxTradesDay ? ` · ${h.maxTradesDay} trades/day` : ''}${h.symbols ? ` · ${H.esc(h.symbols)}` : ''}</div></div>
        <label class="switch" title="${h.enabled ? 'On' : 'Paused'}"><input type="checkbox" data-pause ${h.enabled ? 'checked' : ''}><i></i></label></div>
      <div class="refbox"><input readonly value="${H.esc(h.url)}" aria-label="Webhook URL"><button class="small" data-copy="${H.esc(h.url)}">Copy URL</button></div>
      <p class="mu" style="font-size:12px;margin:6px 0 0">Keep this URL private: anyone who has it can send orders within this webhook's rules. ${h.lastAt ? 'Last signal ' + H.date(h.lastAt) : 'No signals yet'}.</p>
      <div class="row" style="margin-top:12px"><button class="small ghost" data-test>Send test signal</button><a class="small" href="#/signals?edit=${h.id}"><button class="small ghost" type="button">Edit</button></a><button class="small ghost" data-rotate>New URL</button><button class="small ghost danger-t" data-del>Delete</button></div>
    </div>`).join('') || ''}</div>
  ${hooks.length < limit || editing ? hookForm(editing, paid) : `<div class="card upsellcard"><h2>You are using ${hooks.length} of ${limit} webhook${limit > 1 ? 's' : ''}</h2><p class="mu">${paid ? 'Delete one to create another.' : 'Pro includes 10 webhooks and can send alerts to your Alpaca account.'}</p>${paid ? '' : '<a href="#/funding"><button type="button">See Pro</button></a>'}</div>`}
  <div class="card"><h2>Alert message</h2><p class="mu" style="margin-top:0">In TradingView: create an alert, turn on <b>Webhook URL</b> and paste your URL, then use one of these as the message. Accepted actions are <code>buy</code>, <code>sell</code> and <code>exit</code>; size with <code>quantity</code> or <code>dollars</code>.</p>
    <div class="chips" id="tpls">${Object.keys(TEMPLATES).map((k, i) => `<button type="button" class="${i ? '' : 'on'}" data-t="${H.esc(k)}">${H.esc(k)}</button>`).join('')}</div>
    <pre id="tpl">${H.esc(TEMPLATES['TradingView strategy'])}</pre><button class="small ghost" id="copyTpl">Copy message</button>
    ${hooks[0] ? `<details style="margin-top:12px"><summary class="mu">Send from a script, Zapier or an AI agent</summary><pre>curl -X POST ${H.esc(hooks[0].url)} \\
  -H "Content-Type: application/json" \\
  -d '{"ticker":"AAPL","action":"buy","quantity":1}'</pre><p class="mu" style="font-size:13px">In Zapier use <b>Webhooks by Zapier → POST</b> with the same URL and fields.</p></details>` : ''}</div>
  <div class="card tablewrap"><h2>Signal log</h2><table><tr><th>When</th><th>Webhook</th><th>Signal</th><th>Result</th><th>Details</th></tr>
    ${log.map(r => `<tr><td>${H.date(r.at)}</td><td>${H.esc(r.hook || '(deleted)')}${r.test ? ' <span class="pill">test</span>' : ''}</td><td>${r.action ? `<b>${H.esc(r.action.toUpperCase())}</b> ${H.esc(r.symbol)}` : '-'}</td>
      <td><span class="pill ${STATUS[r.status]?.[1] || ''}">${STATUS[r.status]?.[0] || H.esc(r.status)}</span></td>
      <td class="mu" style="font-size:13px">${r.detail.error ? H.esc(r.detail.error) : (r.detail.results || []).map(x => `${H.esc(nm(x.account))}: ${x.ok ? `${x.side} ${x.qty != null ? +(+x.qty).toFixed(4) + ' sh' : H.money(x.notional)}${x.price ? ' @ ' + H.money(x.price) : ''}` : H.esc(x.error)}`).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No signals yet. Send a test signal from a webhook above.</td></tr>'}</table></div>`;

  // Webhook cards
  H.$$('[data-copy]', view).forEach(b => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; } catch { b.previousElementSibling.select(); } setTimeout(() => (b.textContent = 'Copy URL'), 1500); }));
  H.$$('.hook', view).forEach(card => {
    const id = card.dataset.id;
    H.$('[data-pause]', card).onchange = async e => { await H.api(`/signals/hooks/${id}/pause`, { body: { enabled: e.target.checked } }); H.render(); };
    H.act(H.$('[data-test]', card), async () => {
      const msg = prompt('Test message (this places a real order in the chosen accounts; paper is play money):', '{"ticker":"AAPL","action":"buy","quantity":1}');
      if (msg == null) return '';
      const r = await H.api(`/signals/hooks/${id}/test`, { body: { message: msg } });
      setTimeout(H.render, 1500);
      return r.status === 'ok' ? 'Done: order placed' : r.error || (r.results || []).map(x => x.error).filter(Boolean).join('; ') || r.status;
    });
    H.act(H.$('[data-rotate]', card), async () => {
      if (!confirm('Create a new URL? The current URL stops working immediately, so update your alerts.')) return '';
      await H.api(`/signals/hooks/${id}/rotate`, { body: {} }); H.render(); return '';
    });
    H.act(H.$('[data-del]', card), async () => {
      if (!confirm('Delete this webhook? Alerts sent to its URL will stop working.')) return '';
      await H.api(`/signals/hooks/${id}`, { method: 'DELETE' }); H.render(); return '';
    });
  });

  // Create / edit form
  const f = H.$('#hookForm', view);
  if (f) {
    const size = () => { const m = f.sizeMode.value; H.$('#sizeL', f).hidden = m === 'signal'; H.$('#sizeL', f).firstChild.textContent = m === 'qty' ? 'Shares per order' : 'Dollars per order'; };
    f.sizeMode.onchange = size; size();
    if (H.$('#cancelEdit', f)) H.$('#cancelEdit', f).onclick = () => (location.hash = '#/signals');
    H.act(H.$('button', f), async () => {
      const d = H.form(f);
      const body = { ...d, accounts: H.$$('[name=acct]:checked', f).map(i => i.value), enabled: editing ? editing.enabled : true };
      delete body.acct;
      await H.api('/signals/hooks' + (editing ? '/' + editing.id : ''), { method: editing ? 'PUT' : 'POST', body });
      if (editing) location.hash = '#/signals'; else H.render();
      return 'Saved';
    });
  }
  // Message templates
  const tpls = H.$('#tpls', view);
  tpls.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    H.$$('button', tpls).forEach(x => x.classList.toggle('on', x === b));
    H.$('#tpl', view).textContent = TEMPLATES[b.dataset.t];
  };
  H.$('#copyTpl', view).onclick = async e => { try { await navigator.clipboard.writeText(H.$('#tpl', view).textContent); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy message'), 1500); } catch {} };
}
