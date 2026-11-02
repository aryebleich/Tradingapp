// Admin → Market data (which free sources, in what order, fastest first; trading fees; savings
// offers) and Admin → Calls, texts & email (the business inbox with AI drafts). English only.
let H;
export function registerAdmin13(routes, helpers) {
  H = helpers;
  const guard = fn => (view, q) => (H.me()?.role === 'admin' ? fn(view, q) : (location.hash = '#/dashboard'));
  Object.assign(routes, { 'admin-data': guard(dataPage), 'admin-comms': guard(commsPage) });
}

async function dataPage(view) {
  const [d, f, sv] = await Promise.all([H.api('/admin/site/data'), H.api('/admin/site/fees'), H.api('/admin/site/savings')]);
  let order = [...d.order];
  const prov = id => d.providers.find(p => p.id === id);
  const draw = () => {
    view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-data')}
    <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Market data sources</h2><button class="small" id="bench">Test all now</button></div>
      <p class="mu">Prices and history come from these, in this order or fastest first. Free keys go in <a href="#/admin-keys">Keys</a>. Every call is timed; the hourly test keeps "fastest first" current.</p>
      <label>How to choose<select id="mode">${Object.entries(d.modes).map(([k, t]) => `<option value="${k}" ${k === d.mode ? 'selected' : ''}>${H.esc(t)}</option>`).join('')}</select></label>
      <div class="tablewrap"><table class="slim datasrc"><tr><th></th><th>Source</th><th>Quotes</th><th>History</th><th>Key</th><th>Speed (median)</th><th>OK / failed</th><th>Now used</th><th>On</th></tr>
        ${order.map((id, i) => { const p = prov(id); return `<tr><td style="white-space:nowrap"><button type="button" class="small ghost" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Up">▲</button><button type="button" class="small ghost" data-down="${i}" ${i < order.length - 1 ? '' : 'disabled'} aria-label="Down">▼</button></td>
          <td><b>${H.esc(p.name)}</b><br><span class="mu" style="font-size:12px">${H.esc(p.note)}</span>${p.lastError ? `<br><span class="neg" style="font-size:12px">${H.esc(p.lastError)}</span>` : ''}</td><td>${p.quotes ? '✓' : ''}</td><td>${p.history ? '✓' : ''}</td>
          <td>${!p.key ? 'Not needed' : p.configured ? '<span class="pos">Set</span>' : `<a href="${H.esc(p.signup || '#')}" target="_blank" rel="noopener">Get free key</a> <code data-no-tr>${H.esc(p.key)}</code>`}</td>
          <td>${p.latencyMs == null ? '-' : `<b>${p.latencyMs} ms</b>`}</td><td>${p.ok} / ${p.fail}</td><td>${p.rank >= 0 ? `#${p.rank + 1}` : '-'}</td><td><input type="checkbox" data-on="${id}" ${p.on ? 'checked' : ''}></td></tr>`; }).join('')}</table></div>
      <button id="saveData">Save</button><div class="err"></div><div id="benchOut"></div></div>
    <form class="card" id="fees"><h2>Trading fees shown on the order ticket</h2><p class="mu">Brokers like Alpaca charge no commission on US stocks; regulators charge small fees on sales. Keep these current (SEC Section 31 rate: sec.gov fee rate advisories; FINRA trading activity fee: finra.org). Last updated ${H.esc(f.fees.updated)}.</p>
      <div class="row"><label>Commission per share ($)<input name="commissionPerShare" type="number" step="any" min="0" value="${f.fees.commissionPerShare}"></label><label>Minimum commission ($)<input name="commissionMin" type="number" step="any" min="0" value="${f.fees.commissionMin}"></label><label>Expected slippage (basis points)<input name="slippageBps" type="number" step="any" min="0" value="${f.fees.slippageBps}"></label></div>
      <div class="row"><label>SEC fee per $1 million sold ($)<input name="secPerMillion" type="number" step="any" min="0" value="${f.fees.secPerMillion}"></label><label>FINRA fee per share sold ($)<input name="finraTafPerShare" type="number" step="any" min="0" value="${f.fees.finraTafPerShare}"></label><label>FINRA fee maximum per trade ($)<input name="finraTafMax" type="number" step="any" min="0" value="${f.fees.finraTafMax}"></label></div>
      <button>Save fees</button><div class="err"></div></form>
    <form class="card" id="sav"><h2>Savings offers (Futures, funds & savings → Savings)</h2><p class="mu">Banks with high-yield savings you want to show. Leave empty to show general guidance only. Rates change often; keep them current.</p>
      <div id="savRows">${[...sv.offers, {}, {}].slice(0, Math.max(3, sv.offers.length + 1)).map(o => `<div class="row savrow"><label>Bank<input data-k="bank" value="${H.esc(o.bank || '')}"></label><label>APY %<input data-k="apy" type="number" step="0.01" value="${o.apy ?? ''}"></label><label style="flex:2">Note<input data-k="note" value="${H.esc(o.note || '')}"></label><label style="flex:2">Link (https)<input data-k="url" value="${H.esc(o.url || '')}"></label></div>`).join('')}</div>
      <button>Save offers</button><div class="err"></div></form>`;
    H.$$('[data-up]', view).forEach(b => (b.onclick = () => { const i = +b.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); }));
    H.$$('[data-down]', view).forEach(b => (b.onclick = () => { const i = +b.dataset.down; [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); }));
    H.act(H.$('#saveData', view), async () => { const off = H.$$('[data-on]', view).filter(c => !c.checked).map(c => c.dataset.on); Object.assign(d, await H.api('/admin/site/data', { method: 'PUT', body: { mode: H.$('#mode', view).value, order, off } })); order = [...d.order]; draw(); return 'Saved'; });
    H.act(H.$('#bench', view), async () => { const r = await H.api('/admin/site/data/test', { body: { symbol: 'SPY' } }); Object.assign(d, r); order = [...d.order]; draw(); H.$('#benchOut', view).innerHTML = `<p class="mu">SPY from each: ${r.results.map(x => `${H.esc(prov(x.id).name)} ${x.skipped ? `(${x.skipped})` : x.ok ? `${x.price} in ${x.ms} ms` : `failed after ${x.ms} ms`}`).join(' · ')}</p>`; return ''; });
    const ff = H.$('#fees', view); H.act(H.$('button', ff), async () => { await H.api('/admin/site/fees', { method: 'PUT', body: H.form(ff) }); return 'Saved'; });
    const sf = H.$('#sav', view); H.act(H.$('button', sf), async () => { const offers = H.$$('.savrow', sf).map(r => Object.fromEntries(H.$$('[data-k]', r).map(i => [i.dataset.k, i.value]))); await H.api('/admin/site/savings', { method: 'PUT', body: { offers } }); return 'Saved'; });
  };
  draw();
}

const CH = { sms: 'Text', email: 'Email', call: 'Call', voicemail: 'Voicemail', form: 'Contact form' };
async function commsPage(view, q) {
  const ch = q.get('channel') || '', status = q.get('status') || 'open';
  const d = await H.api(`/admin/comms?${ch ? 'channel=' + ch + '&' : ''}status=${status}`), s = d.settings;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-comms')}
  <div class="card"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap"><h2 style="margin:0">Calls, texts & email</h2>
    <div class="chips">${[['', 'All'], ...Object.entries(CH)].map(([k, t]) => `<a href="#/admin-comms?channel=${k}&status=${status}"><button type="button" class="${k === ch ? 'on' : ''}">${t}${k && (d.counts[k] || 0) ? ` (${d.counts[k]})` : ''}</button></a>`).join('')}
      <a href="#/admin-comms?channel=${ch}&status=${status === 'open' ? 'all' : 'open'}"><button type="button" class="ghost">${status === 'open' ? 'Show answered too' : 'Open only'}</button></a></div></div>
    ${d.twilio ? '' : '<p class="banner">Texts and calls need Twilio (Admin → Keys). Email replies need RESEND_API_KEY.</p>'}
    <div class="inbox">${d.items.map(m => `<div class="msg ${m.direction}" data-id="${m.id}"><div class="row" style="justify-content:space-between"><span><span class="pill">${CH[m.channel] || m.channel}${m.direction === 'out' ? ' sent' : ''}</span> <b data-no-tr>${H.esc(m.name || '')} ${H.esc(m.party)}</b></span><span class="mu">${H.date(m.at)}</span></div>
      ${m.subject ? `<div><b>${H.esc(m.subject)}</b></div>` : ''}<div class="mbody" style="white-space:pre-wrap">${H.esc(m.body)}</div>${m.media ? `<audio controls preload="none" src="${H.esc(m.media)}.mp3"></audio>` : ''}
      ${m.direction === 'in' ? `<div class="row" style="gap:6px;margin-top:6px">${m.status === 'open' ? `<button class="small" data-reply="${m.id}">Reply</button><button class="small ghost" data-done="${m.id}">Done</button>` : '<span class="mu">Answered</span>'}${/^\+\d+$/.test(m.party) ? ` <a href="tel:${H.esc(m.party)}"><button class="small ghost" type="button">Call back</button></a>` : ''}</div><div class="replybox" hidden></div>` : ''}</div>`).join('') || '<p class="mu">Nothing waiting. 🎉</p>'}</div></div>
  <form class="card" id="newMsg"><h2>New message</h2><div class="row"><label>To (phone or email)<input name="to" required></label><label>Subject (email)<input name="subject"></label></div><label>Message<textarea name="body" rows="3" required></textarea></label><button>Send</button><div class="err"></div></form>
  <form class="card" id="ta"><h2>Apply by text</h2>
    <p class="mu" style="margin-top:0">Anyone who texts your number and is not a customer yet gets the brokerage application by text (photo of the ID and Social Security card, the missing details, a check of what we have, then the agreement); customers without a brokerage account start it by texting APPLY. Texting TALK reaches this inbox instead. ${d.apply.open ? `<b>${d.apply.open}</b> in progress.` : ''}</p>
    ${d.apply.brokerEnabled ? '' : '<p class="banner">Needs the Alpaca Broker API keys (Admin → Keys: BROKER_API_KEY and BROKER_API_SECRET). Until then texts go to the inbox.</p>'}
    <label class="check"><input type="checkbox" name="enabled" ${d.apply.enabled ? 'checked' : ''}> Answer texts from new numbers with the application</label>
    <label class="check"><input type="checkbox" name="aiRead" ${d.apply.aiRead ? 'checked' : ''}> Read the ID and card photos with AI (otherwise every detail is asked by text)</label>
    <label class="check"><input type="checkbox" name="aiAnyProvider" ${d.apply.aiAnyProvider ? 'checked' : ''}> Also with a free AI provider (by default only Claude, whose API does not train on your data, reads ID photos)</label>
    <p class="mu small-print">${d.apply.aiReady ? 'Photos are read automatically.' : 'Photos are not read now (no Claude key, or AI reading is off); the details are asked by text.'} Answers are kept encrypted only while the application is open (at most 7 days) and deleted once it is sent; the Social Security card photo is never kept.</p>
    <button>Save</button><div class="err"></div></form>
  <form class="card" id="cs"><h2>Settings</h2>
    <div class="row"><label>Forward calls to (your phone)<input name="forwardTo" value="${H.esc(s.forwardTo)}" placeholder="+18455551234" dir="ltr"></label><label>Ring for (seconds)<input name="ringSeconds" type="number" min="5" max="60" value="${s.ringSeconds}"></label></div>
    <label class="check"><input type="checkbox" name="forwardAll" ${s.forwardAll ? 'checked' : ''}> Forward every call to this phone (otherwise only callers who are not customers can press 9 to reach you; customers get the trading line)</label>
    <label>Voicemail greeting (when you do not answer)<input name="voicemailGreeting" value="${H.esc(s.voicemailGreeting)}"></label>
    <label class="check"><input type="checkbox" name="aiSms" ${s.aiSms ? 'checked' : ''}> AI answers texts from people who are not customers</label>
    <label class="check"><input type="checkbox" name="aiEmail" ${s.aiEmail ? 'checked' : ''}> AI answers incoming email (anything it cannot answer stays in the inbox for you)</label>
    <label>What the AI should know (prices, hours, policies, common questions)<textarea name="notes" rows="5">${H.esc(s.notes)}</textarea></label>
    <p class="mu small-print">Incoming email: point your email forwarding service (SendGrid Inbound Parse, Mailgun routes, Postmark or a Cloudflare Email Worker) at <code data-no-tr>${H.esc(d.inboundUrl)}</code> with fields from, subject and text. Keep this address private.</p>
    <button>Save</button> <button type="button" class="ghost" id="newTok">New email address</button><div class="err"></div></form>`;
  H.$$('[data-done]', view).forEach(b => H.act(b, async () => { await H.api(`/admin/comms/${b.dataset.done}/done`, { body: {} }); H.render(); return ''; }));
  H.$$('[data-reply]', view).forEach(b => (b.onclick = () => {
    const box = b.closest('.msg').querySelector('.replybox'), m = d.items.find(x => String(x.id) === b.dataset.reply);
    box.hidden = false;
    box.innerHTML = `<textarea rows="4" placeholder="Your reply"></textarea><div class="row" style="gap:6px"><button type="button" class="small ghost" data-ai>AI draft</button><select data-via>${/@/.test(m.party) ? '<option value="email">Email</option>' : '<option value="sms">Text</option>'}</select><button type="button" class="small" data-send>Send</button></div><div class="err"></div>`;
    H.act(box.querySelector('[data-ai]'), async () => { const r = await H.api(`/admin/comms/${m.id}/draft`, { body: {} }); box.querySelector('textarea').value = r.reply; return r.needsHuman ? 'The AI thinks you should look at this one yourself.' : ''; }, box.querySelector('.err'));
    H.act(box.querySelector('[data-send]'), async () => { await H.api(`/admin/comms/${m.id}/reply`, { body: { body: box.querySelector('textarea').value, via: box.querySelector('[data-via]').value } }); setTimeout(H.render, 600); return 'Sent'; }, box.querySelector('.err'));
  }));
  const nm = H.$('#newMsg', view); H.act(H.$('button', nm), async () => { await H.api('/admin/comms/send', { body: H.form(nm) }); nm.reset(); return 'Sent'; });
  const ta = H.$('#ta', view);
  H.act(H.$('button', ta), async () => { const v = H.form(ta); await H.api('/admin/comms/apply', { method: 'PUT', body: { enabled: !!v.enabled, aiRead: !!v.aiRead, aiAnyProvider: !!v.aiAnyProvider } }); setTimeout(H.render, 500); return 'Saved'; });
  const cs = H.$('#cs', view);
  H.act(H.$('button', cs), async () => { await H.api('/admin/comms/settings', { method: 'PUT', body: H.form(cs) }); setTimeout(H.render, 500); return 'Saved'; });
  H.act(H.$('#newTok', view), async () => { if (!confirm('Make a new incoming-email address? The old one stops working.')) return ''; await H.api('/admin/comms/settings', { method: 'PUT', body: { newToken: true } }); H.render(); return ''; });
}
