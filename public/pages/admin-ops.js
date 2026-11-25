// Admin → Market data (which free sources, in what order, fastest first; trading fees; savings
// offers) and Admin → Calls, texts & email (the business inbox with AI drafts). English only.
let H;
export function registerAdminOps(routes, helpers) {
  H = helpers;
  const guard = fn => (view, q) => (H.me()?.role === 'admin' ? fn(view, q) : (location.hash = '#/dashboard'));
  Object.assign(routes, { 'admin-data': guard(dataPage), 'admin-comms': guard(commsPage), 'admin-strategies': guard(originalsPage), 'admin-seo': guard(seoPage), 'admin-agents': guard(agentsPage), 'admin-hosting': guard(hostingPage), 'admin-database': guard(databasePage) });
}

async function dataPage(view) {
  const [d, f, sv, st] = await Promise.all([H.api('/admin/site/data'), H.api('/admin/site/fees'), H.api('/admin/site/savings'), H.api('/admin/streams').catch(() => null)]);
  let order = [...d.order];
  const prov = id => d.providers.find(p => p.id === id);
  const wireStream = () => { const sf = H.$('#streamForm', view); if (sf) H.act(H.$('button', sf), async () => { await H.api('/admin/streams', { method: 'PUT', body: { provider: sf.provider.value } }); setTimeout(H.render, 600); return 'Saved'; }); };
  const draw = () => {
    const streamCard = st ? `<form class="card" id="streamForm"><h2>Live stream (WebSocket)</h2>
      <p class="mu" style="margin-top:0">Prices pushed the moment they trade, to every open page and to price alerts, instead of asking again and again. One connection for the whole server.</p>
      <p>${st.connected ? `<span class="pill pos">Connected</span> ${H.esc(st.available[st.active]?.name || st.active)} · ${st.subscribed.length} symbols · ${st.ticks} updates${st.lastLatencyMs != null ? ` · last one ${st.lastLatencyMs} ms after the trade` : ''}` : st.active === 'alpaca' ? '<span class="pill pos">Alpaca stream</span> (opens when a page follows a price)' : st.active ? `<span class="pill">Waiting</span> ${H.esc(st.available[st.active]?.name)}: connects when a page or an alert follows a price` : '<span class="pill warn">Off</span> no stream key; prices refresh every 15 seconds instead'}${st.lastError ? ` <span class="err">${H.esc(st.lastError)}</span>` : ''}</p>
      <label>Provider<select name="provider"><option value="auto" ${st.provider === 'auto' ? 'selected' : ''}>Automatic (Alpaca, else the first with a key)</option><option value="alpaca" ${st.provider === 'alpaca' ? 'selected' : ''}>Alpaca</option>${Object.entries(st.available).map(([k, v]) => `<option value="${k}" ${st.provider === k ? 'selected' : ''} ${v.configured ? '' : 'disabled'}>${H.esc(v.name)}${v.configured ? '' : ` (add ${v.key} in Keys)`} · ${v.realtime ? 'real-time' : 'delayed'} · up to ${v.maxSymbols} symbols</option>`).join('')}<option value="off" ${st.provider === 'off' ? 'selected' : ''}>Off</option></select></label>
      <button>Save</button><div class="err"></div></form>` : '';
    view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-data')}${streamCard}
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
    wireStream();
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

// ---------- Admin → Original strategies ----------
// The library's original strategies with their recorded figures and full rules, kept for the owner.
// Users build from the renamed designs (blueprints) with their own tickers.
async function originalsPage(view) {
  const list = await H.api('/library/originals');
  const fmtM = m => (typeof m === 'number' ? String(m) : `${m[1]} ${m[0] === 'close' ? 'Close' : `${m[0].toUpperCase()}(${m[2]})`}`);
  const stepTxt = st => st.t === 'cmp' ? `If ${fmtM(st.a)} ${st.op} ${fmtM(st.b)} → ${st.yes} else → ${st.no}`
    : st.t === 'band' ? `${fmtM(st.a)}${st.hi != null ? ` > ${st.hi} → ${st.hiTo}` : ''}${st.lo != null ? ` · < ${st.lo} → ${st.loTo}` : ''} · else → ${st.mid}`
    : st.t === 'higher' ? `Higher of ${fmtM(st.a)} → ${st.aTo} / ${fmtM(st.b)} → ${st.bTo}`
    : st.t === 'vote' ? `${st.conds.map(c => `${fmtM(c.a)} ${c.op} ${fmtM(c.b)}`).join('; ')}: ${st.need}+ → ${st.yes} else → ${st.no}` : `(missing) ${st.label || ''}`;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-strategies')}
  <div class="card"><h2>Original strategies</h2><p class="mu" style="margin-top:0">The library's original strategies, saved here with their tickers, recorded figures and rules. Users now start from the renamed designs with empty tickers (Strategy builder). You can open a working copy of an original for yourself.</p></div>
  ${list.map(t => `<div class="card"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap"><h2 style="margin:0">${H.esc(t.name)} <span class="mu" style="font-size:13px;font-weight:500" data-no-tr>${H.esc(t.id)}</span></h2><button class="small" data-open="${t.id}">Open a copy</button></div>
    <p class="mu">${H.esc(t.tagline)} · ${H.esc(t.rebalance)} · ${H.esc(t.risk)} risk${t.blueprint ? ` · now the design <b>${H.esc(t.blueprint)}</b>` : ''}</p><p>${H.esc(t.about)}</p>
    ${t.qc ? `<p class="mu">Recorded: ${t.qc.cagr5y}%/yr over 5 years · worst drop ${t.qc.maxdd}% · Sharpe (1y) ${t.qc.sharpe1y} · 3 months live ${t.qc.oos3m}%</p>` : ''}
    ${t.sleeves ? t.sleeves.map(sl => `<h3 class="sleeve">${H.esc(sl.name)} <span class="mu">${Math.round(sl.weight * 100)}%</span></h3><table class="slim">${sl.steps.map(st => `<tr><td><b>${H.esc(st.id)}</b></td><td class="rule" data-no-tr>${H.esc(stepTxt(st))}</td></tr>`).join('')}</table>`).join('') : `<pre style="white-space:pre-wrap;font-size:12px" data-no-tr>${H.esc(JSON.stringify(t.params, null, 1))}</pre>`}
    ${t.note ? `<p class="note">${H.esc(t.note)}</p>` : ''}<div class="err"></div></div>`).join('')}`;
  H.$$('[data-open]', view).forEach(b => H.act(b, async () => { const s = await H.api('/library', { body: { templateId: b.dataset.open } }); location.hash = '#/strategy?id=' + s.id; return ''; }));
}

// ---------- Admin → SEO ----------
// Google and AI search visibility: an audit with fixes, each page's title and description with a
// search-result preview, verification codes, profiles, AI search and llms.txt, IndexNow and tools.
async function seoPage(view) {
  const d = await H.api('/admin/seo'), s = d.settings, a = d.audit, B = d.base || location.origin;
  const bad = a.checks.filter(c => !c.ok), good = a.checks.filter(c => c.ok);
  const enc = encodeURIComponent;
  const pageRow = p => {
    const cur = a.pages.find(x => x.key === p.key) || {}, o = s.pages[p.key] || {};
    return `<div class="seopage" data-key="${p.key}"><h3>${H.esc(p.name)} <span class="mu" data-no-tr style="font-size:13px;font-weight:500">${H.esc(p.path)}</span></h3>
      <label>Title <span class="cnt" data-for="t"></span><input data-f="title" maxlength="120" value="${H.esc(o.title || '')}" placeholder="${H.esc(cur.title || '')}"></label>
      <label>Description <span class="cnt" data-for="d"></span><textarea data-f="description" rows="2" maxlength="320" placeholder="${H.esc(cur.description || '')}">${H.esc(o.description || '')}</textarea></label>
      <label class="chk2"><input type="checkbox" data-f="noindex" ${o.noindex ? 'checked' : ''}> Hide from search engines (noindex)</label>
      <div class="serp"><div class="serp-url" data-no-tr>${H.esc(B.replace(/^https?:\/\//, ''))}${H.esc(p.path === '/' ? '' : ' › ' + p.path.slice(1))}</div><div class="serp-title"></div><div class="serp-desc"></div></div></div>`;
  };
  const ad = await H.api('/admin/site/ad').catch(() => ({ files: [] }));
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-seo')}
  <div class="card adcard"><h2>Advertisement video</h2><div class="adgrid"><video controls playsinline preload="metadata" poster="/media/brightolio-ad.jpg"><source src="/media/brightolio-ad.webm" type="video/webm"><source src="/media/brightolio-ad.mp4" type="video/mp4"></video>
    <div><p class="mu" style="margin-top:0">The 20-second ad on the homepage, in every version. Use it on social media, in ads or in emails.</p>
    <ul class="adfiles">${ad.files.map(f => `<li><span>${H.esc(f.label)} <small class="mu">${(f.size / 1048576).toFixed(1)} MB</small></span><a href="/api/admin/site/ad/${encodeURIComponent(f.file)}" download="${H.esc(f.file)}"><button type="button" class="small">Download</button></a></li>`).join('') || '<li class="mu">No files found on this server.</li>'}</ul></div></div></div>
  <div class="card seoscore"><div class="row" style="gap:18px;align-items:center;flex-wrap:wrap">
    <div class="ring" style="--p:${a.score}"><b>${a.score}</b><span>/100</span></div>
    <div style="flex:1;min-width:240px"><h2 style="margin:0">Search visibility</h2><p class="mu" style="margin:4px 0 0">How ready the public pages are for Google, Bing and AI search (ChatGPT, Claude, Perplexity). ${bad.length ? `<b>${bad.length}</b> thing${bad.length === 1 ? '' : 's'} to fix, most important first.` : 'Everything checked is in place.'}</p></div></div>
    ${bad.length ? `<ul class="seochecks">${bad.sort((x, y) => y.weight - x.weight).map(c => `<li class="no"><b>${H.esc(c.title)}</b> <span class="mu">· ${H.esc(c.where)}</span><div>${H.esc(c.fix)}</div></li>`).join('')}</ul>` : ''}
    <details><summary class="mu">${good.length} checks passed</summary><ul class="seochecks">${good.map(c => `<li class="yes">${H.esc(c.title)} <span class="mu">· ${H.esc(c.where)}</span></li>`).join('')}</ul></details></div>

  <form class="card" id="seoSite"><h2>Search engines and AI search</h2>
    <label class="chk2"><input type="checkbox" name="search" ${d.ai.search !== false ? 'checked' : ''}> Search engines may list the public pages (Google, Bing...)</label>
    <label class="chk2"><input type="checkbox" name="aiSearch" ${d.ai.aiSearch ? 'checked' : ''}> AI search may read and cite the public pages (ChatGPT search, Claude, Perplexity). AI <b>training</b> crawlers stay blocked (AI &amp; privacy).</label>
    <label class="chk2"><input type="checkbox" name="llmsOn" ${d.ai.llmsOn ? 'checked' : ''}> Publish llms.txt (a short description and the page list for AI tools)</label>
    <label>What AI tools should say about the business (llms.txt)<textarea name="llms" rows="3" maxlength="2000">${H.esc(d.ai.llms || '')}</textarea></label>
    <div class="grid2"><label>Google Search Console code<input name="google" value="${H.esc(s.google)}" placeholder="the content=&quot;…&quot; part of the HTML tag" dir="ltr"></label>
      <label>Bing Webmaster Tools code<input name="bing" value="${H.esc(s.bing)}" placeholder="msvalidate.01 code" dir="ltr"></label>
      <label>Yandex code (optional)<input name="yandex" value="${H.esc(s.yandex)}" dir="ltr"></label>
      <label>X / Twitter handle (optional)<input name="twitter" value="${H.esc(s.twitter)}" placeholder="@brightolio" dir="ltr"></label></div>
    <label>Business name in search<input name="orgName" value="${H.esc(s.orgName)}"></label>
    <label>Social and business profiles (one per line: LinkedIn, X, YouTube, Crunchbase…)<textarea name="sameAs" rows="2" dir="ltr">${H.esc((s.sameAs || []).join('\n'))}</textarea></label>
    <label class="chk2"><input type="checkbox" name="faq" ${s.faq ? 'checked' : ''}> Show the homepage questions as an FAQ in search (structured data)</label>
    <button>Save</button><div class="err"></div></form>

  <div class="card" id="seoPages"><h2>Pages: titles and descriptions</h2>
    <p class="mu" style="margin-top:0">Leave a box empty to keep the page's own text (shown in grey). Titles: 30–60 characters with the main words first; descriptions: 70–160 characters that say what the visitor gets. Each page should be different.</p>
    ${d.pages.map(pageRow).join('')}
    <button id="savePages">Save pages</button><div class="err"></div></div>

  <div class="card"><h2>Announce and check</h2>
    <p class="mu" style="margin-top:0">After changing pages, announce them: IndexNow tells Bing (which also powers ChatGPT search and DuckDuckGo), Yandex and others at once. For Google, submit the sitemap once in Search Console; it then re-reads it by itself.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button id="ping" type="button">Announce pages now (IndexNow)</button>
      <a href="/sitemap.xml" target="_blank" rel="noopener"><button class="ghost" type="button">sitemap.xml</button></a><a href="/robots.txt" target="_blank" rel="noopener"><button class="ghost" type="button">robots.txt</button></a><a href="/llms.txt" target="_blank" rel="noopener"><button class="ghost" type="button">llms.txt</button></a></div><div class="err"></div>
    <p class="mu small-print">${s.lastPing ? `Last announced ${H.date(s.lastPing)}.` : 'Not announced yet.'}</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <a href="https://search.google.com/search-console" target="_blank" rel="noopener"><button class="small ghost" type="button">Google Search Console</button></a>
      <a href="https://www.bing.com/webmasters" target="_blank" rel="noopener"><button class="small ghost" type="button">Bing Webmaster Tools</button></a>
      <a href="https://search.google.com/test/rich-results?url=${enc(B + '/')}" target="_blank" rel="noopener"><button class="small ghost" type="button">Rich results test</button></a>
      <a href="https://pagespeed.web.dev/analysis?url=${enc(B + '/')}" target="_blank" rel="noopener"><button class="small ghost" type="button">PageSpeed Insights</button></a></div></div>

  <details class="card"><summary><b>What ranks well (current best practice)</b></summary><ul class="tips">
    <li><b>Helpful, specific content</b> that answers what people search for ("how to backtest a strategy", "paper trading app"), written by people who know the subject; show who is behind the business (about, contact, licences).</li>
    <li><b>One topic per page</b>, one h1, a clear title and description, and plain internal links between pages.</li>
    <li><b>Fast and mobile-friendly</b>: good Core Web Vitals (check PageSpeed Insights); the site is served over https.</li>
    <li><b>Structured data</b> (already added: organization, website, the app with its prices, FAQ) helps Google show rich results and helps AI tools describe the business correctly.</li>
    <li><b>AI search</b>: allow the AI search bots (on above), keep facts consistent across the site and profiles, publish llms.txt, and get mentioned on trusted sites (reviews, comparisons, news): AI answers cite pages that others cite.</li>
    <li><b>Links from other sites</b> still matter most: partner pages, app directories, fintech reviews, guest articles. Never buy links.</li>
    <li>Nothing guarantees a top position; these are the things search engines say they reward.</li></ul></details>`;

  const site = H.$('#seoSite', view);
  H.act(H.$('button', site), async () => {
    const v = H.form(site);
    await H.api('/admin/seo', { method: 'PUT', body: { search: !!v.search, aiSearch: !!v.aiSearch, llmsOn: !!v.llmsOn, llms: v.llms, google: v.google, bing: v.bing, yandex: v.yandex, twitter: v.twitter, orgName: v.orgName, sameAs: v.sameAs, faq: !!v.faq } });
    setTimeout(H.render, 500); return 'Saved';
  });
  // Live counters and the search-result preview.
  H.$$('.seopage', view).forEach(box => {
    const t = H.$('[data-f=title]', box), dsc = H.$('[data-f=description]', box);
    const upd = () => {
      const tv = t.value || t.placeholder, dv = dsc.value || dsc.placeholder;
      const ct = H.$('[data-for=t]', box), cd = H.$('[data-for=d]', box);
      ct.textContent = `${tv.length} characters`; ct.className = 'cnt ' + (tv.length >= 30 && tv.length <= 60 ? 'pos' : 'warn');
      cd.textContent = `${dv.length} characters`; cd.className = 'cnt ' + (dv.length >= 70 && dv.length <= 160 ? 'pos' : 'warn');
      H.$('.serp-title', box).textContent = tv.length > 62 ? tv.slice(0, 60) + '…' : tv;
      H.$('.serp-desc', box).textContent = dv.length > 160 ? dv.slice(0, 157) + '…' : dv;
    };
    t.oninput = dsc.oninput = upd; upd();
  });
  H.act(H.$('#savePages', view), async () => {
    const pages = Object.fromEntries(H.$$('.seopage', view).map(box => [box.dataset.key, { title: H.$('[data-f=title]', box).value, description: H.$('[data-f=description]', box).value, noindex: H.$('[data-f=noindex]', box).checked }]));
    await H.api('/admin/seo', { method: 'PUT', body: { pages } }); setTimeout(H.render, 500); return 'Saved. The pages now show these.';
  });
  H.act(H.$('#ping', view), async () => { const r = await H.api('/admin/seo/indexnow', { body: {} }); setTimeout(H.render, 800); return `Announced ${r.sent} pages.`; });
  await questionsCard(view);
}
// Open questions from the website audit: the owner records the answer and status for each one.
async function questionsCard(view) {
  const qs = await H.api('/admin/questions');
  const label = { open: 'Open', answered: 'Answered', not_needed: 'Not needed' };
  view.insertAdjacentHTML('beforeend', `<div class="card" id="questionsCard"><h2>Open questions</h2><p class="mu" style="margin-top:0">Questions from the audit that need a decision or a source. Your answers are saved here; they are not shown on the website.</p>
    ${qs.map(q => `<div class="qrow" data-q="${H.esc(q.id)}" style="border-top:1px solid var(--line,#2a2f3a);padding:12px 0">
      <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${H.esc(q.question)}</b><span class="pill ${q.status === 'open' ? 'warn' : 'pos'}">${label[q.status] || q.status}</span></div>
      <p class="mu small-print" style="margin:4px 0">${H.esc(q.area)} · ${H.esc(q.ref)}${q.updatedAt ? ' · updated ' + H.esc(new Date(q.updatedAt).toLocaleDateString()) : ''}</p>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
        ${q.options ? `<label>Decision<select data-f="choice"><option value="">Choose…</option>${q.options.map(o => `<option ${o === q.choice ? 'selected' : ''}>${H.esc(o)}</option>`).join('')}</select></label>` : ''}
        <label>Status<select data-f="status">${Object.entries(label).map(([k, v]) => `<option value="${k}" ${k === q.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label style="flex:1;min-width:220px">Answer or source<input data-f="answer" maxlength="1000" value="${H.esc(q.answer)}"></label>
        <button type="button" class="small" data-save>Save</button>
      </div><div class="err"></div></div>`).join('')}
    </div>`);
  for (const row of H.$$('[data-q]', view)) {
    const btn = H.$('[data-save]', row);
    H.act(btn, async () => {
      const body = { status: H.$('[data-f=status]', row).value, answer: H.$('[data-f=answer]', row).value };
      const sel = H.$('[data-f=choice]', row); if (sel) body.choice = sel.value;
      await H.api('/admin/questions/' + encodeURIComponent(row.dataset.q), { method: 'PUT', body });
      return 'Saved.';
    });
  }
}
// ---------- Admin → AI team (nine agents and their manager), then the coding agent on GitHub ----------
async function agentsPage(view) {
  await codingAgentsPage(view);
  const at = H.$('.admintabs', view); if (!at) return;
  at.insertAdjacentHTML('afterend', '<div id="aiTeam"></div>');
  await teamCard(H.$('#aiTeam', view));
  // The Chat job: shown only when the server says this admin may use it.
  const st = await fetch('/api/admin/aichat/status', { headers: { 'X-Requested-With': 'qp' } }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (st) H.$('#aiTeam', view).insertAdjacentHTML('afterbegin', '<div class="card"><h2>Chat</h2><p class="mu" style="margin-top:0">A normal conversation with the AI team\'s model: replies stream as they are written, with the model\'s thinking shown separately.</p><a href="#/admin-aichat"><button type="button" tabindex="-1">Open chat</button></a></div>');
}
const jobPill = s => `<span class="pill ${s === 'done' ? 'pos' : s === 'failed' ? 'neg' : 'warn'}">${H.esc(s)}</span>`;
async function teamCard(el, openId) {
  const d = await H.api('/admin/aiteam');
  const pname = id => d.providers.find(p => p.id === id)?.name || id;
  const roleRow = ([k, name]) => {
    const t = d.team[k];
    const opts = Object.keys(d.scores).map(p => `<option value="${p}" ${d.pins[k] === p ? 'selected' : ''}>${H.esc(pname(p))} (${Math.round(d.scores[p][k].score * 100)}, ${d.scores[p][k].results} results)</option>`).join('');
    return `<tr><td><b>${H.esc(name)}</b></td><td>${t ? H.esc(pname(t.provider)) + (t.pinned ? ' <span class="pill">pinned</span>' : '') : '<span class="mu">no key</span>'}</td><td class="num">${t ? Math.round(t.score * 100) : '-'}</td><td><select data-pin="${k}"><option value="">Best by score</option>${opts}</select></td></tr>`;
  };
  el.innerHTML = `<div class="card"><h2>AI team</h2><p class="mu" style="margin-top:0">Nine agents: the Manager splits each job into steps and hands them out; the agents see each other's work and can ask each other questions; the Reviewer grades the code. Every AI service with a key in <a href="#/admin-keys">Keys</a> is a candidate for every role, and the Manager learns which is best from the grades and your thumbs up or down.</p>
    ${d.providers.length ? `<p>AI services with a key: ${d.providers.map(p => `<span class="pill">${H.esc(p.name)} <small class="mu" data-no-tr>${H.esc(p.model || '')}</small></span>`).join(' ')}</p>` : '<p class="banner">No AI keys yet: add Claude (ANTHROPIC_API_KEY), Gemini, Groq or OpenRouter in Keys.</p>'}
    <div class="tablewrap"><table class="slim"><tr><th>Agent</th><th>Works with</th><th class="num">Score</th><th>Pin a model</th></tr>${Object.entries(d.roles).map(roleRow).join('')}</table></div></div>
  <form class="card" id="tmJob"><h2>New job for the team</h2><textarea name="job" rows="4" maxlength="8000" placeholder="For example: Add a weekly email that lists each user's best and worst position, with a test. Or: Translate the new Margin center page into Yiddish. Or: Suggest three ways to make the Trade page simpler on phones."></textarea><button>Give it to the Manager</button><div class="err"></div></form>
  <div class="card"><h2>Jobs</h2><div class="tablewrap"><table class="slim"><tr><th>Job</th><th>Status</th><th>When</th><th></th></tr>${d.jobs.map(j => `<tr><td>${H.esc(j.job.slice(0, 110))}${j.job.length > 110 ? '…' : ''}</td><td>${jobPill(j.status)}</td><td>${new Date(j.created_at).toLocaleString()}</td><td><button type="button" class="small ghost" data-job="${j.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="4" class="mu">No jobs yet</td></tr>'}</table></div><div id="tmOpen"></div></div>`;
  H.$$('[data-pin]', el).forEach(s => (s.onchange = async () => { const pins = Object.fromEntries(H.$$('[data-pin]', el).map(x => [x.dataset.pin, x.value]).filter(([, v]) => v)); await H.api('/admin/aiteam/pins', { method: 'PUT', body: pins }); teamCard(el); }));
  const f = H.$('#tmJob', el);
  H.act(H.$('button', f), async () => { const r = await H.api('/admin/aiteam/jobs', { body: { job: f.job.value } }); f.job.value = ''; await teamCard(el, r.id); return ''; });
  const open = async id => {
    const box = H.$('#tmOpen', el), j = await H.api('/admin/aiteam/jobs/' + id);
    const msg = (m, i) => `<details class="tmmsg" ${i === j.messages.length - 1 ? 'open' : ''}><summary><b>${H.esc(m.name)}</b> · ${H.esc(m.task)} <span class="mu" data-no-tr>${H.esc(m.provider ? pname(m.provider) : '')}${m.ms ? ' · ' + (m.ms / 1000).toFixed(1) + 's' : ''}</span></summary><pre class="tmtext" data-no-tr>${H.esc(m.text)}</pre>${m.provider ? `<div class="row" style="gap:6px"><button type="button" class="small ghost" data-rate="${i}" data-good="1">👍 Good</button><button type="button" class="small ghost" data-rate="${i}" data-good="">👎 Not good</button><span class="ok"></span></div>` : ''}</details>`;
    box.innerHTML = `<h3>Job ${j.id}: ${jobPill(j.status)}</h3><p class="mu">${H.esc(j.job)}</p>
      ${j.plan.length ? `<p><b>Plan:</b> ${j.plan.map((s, i) => `${i + 1}. ${H.esc(d.roles[s.role] || s.role)}: ${H.esc(s.task)}`).join(' · ')}</p>` : ''}
      ${j.messages.map(msg).join('')}${j.status === 'working' ? '<p class="mu">The team is working… this updates by itself.</p>' : ''}`;
    H.$$('[data-rate]', box).forEach(b => (b.onclick = async () => { await H.api(`/admin/aiteam/jobs/${id}/rate`, { body: { index: +b.dataset.rate, good: !!b.dataset.good } }); b.parentElement.querySelector('.ok').textContent = 'Thanks: the Manager learns from this'; }));
    if (j.status === 'working') { const h = location.hash; setTimeout(() => location.hash === h && el.isConnected && open(id), 4000); }
  };
  H.$$('[data-job]', el).forEach(b => (b.onclick = () => open(+b.dataset.job)));
  if (openId) open(openId);
}

// ---------- Admin → AI coding agents (GitHub) ----------
async function codingAgentsPage(view) {
  const d = await H.api('/admin/agents');
  const pill = r => r.status !== 'completed' ? `<span class="pill">${H.esc(r.status.replace('_', ' '))}</span>` : `<span class="pill ${r.conclusion === 'success' ? 'pos' : r.conclusion === 'failure' ? 'neg' : ''}">${H.esc(r.conclusion || '')}</span>`;
  const row = r => `<tr><td>${pill(r)}</td><td><a href="${H.esc(H.safeUrl(r.url))}" target="_blank" rel="noopener">${H.esc(r.title || r.name)}</a><div class="mu" style="font-size:12px" data-no-tr>${H.esc(r.sha)} · ${H.date(Date.parse(r.at))}</div></td>
    <td>${r.conclusion === 'failure' ? `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="small ghost" data-log="${r.id}">Log</button><button class="small ghost" data-explain="${r.id}">Explain</button><button class="small" data-fix="${r.id}">Send to agent to fix</button><button class="small ghost" data-rerun="${r.id}">Re-run</button></div>` : ''}</td></tr>`;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-agents')}
  <div class="card"><h2>Coding agent on GitHub</h2><p class="mu" style="margin-top:0">Tools that help write, test and debug the app's code. Give the agent (Claude Code) a task: it works on its own branch in GitHub, runs the tests and the end-to-end run, and opens a pull request for you to review and merge. It never changes the live site by itself.</p>
    ${d.configured ? '' : '<p class="banner">Add <b>GITHUB_TOKEN</b> in Admin → Keys (a fine-grained token for this repository: Actions read and write, Contents read, Pull requests read). The agent also needs the repository secret <b>CLAUDE_CODE_OAUTH_TOKEN</b> (run <code>claude setup-token</code>) or <b>ANTHROPIC_API_KEY</b> in GitHub → Settings → Secrets → Actions.</p>'}
    ${d.agentError ? `<p class="banner err">${H.esc(d.agentError)}</p>` : ''}</div>
  ${d.configured ? `
  <form class="card" id="agTask"><h2>New task</h2>
    <label>What kind<select name="kind">${Object.entries(d.kinds).map(([k, v]) => `<option value="${k}">${H.esc(v)}</option>`).join('')}</select></label>
    <label>Task<textarea name="task" rows="4" maxlength="4000" placeholder="For example: On the Orders page, add a filter for filled orders in the last 7 days, with a test."></textarea></label>
    <label id="agRunPick" hidden>Failed run to debug<select name="runId">${[...d.ci, ...d.e2e].filter(r => r.conclusion === 'failure').map(r => `<option value="${r.id}">${H.esc(r.name)}: ${H.esc(r.title)} (${H.esc(r.sha)})</option>`).join('') || '<option value="">No failed runs</option>'}</select></label>
    <button>Start the agent</button><div class="err"></div>
    <p class="mu small-print">Write the task like a ticket: what should change, where, and how you will know it works. The agent runs up to an hour; its pull request appears below.</p></form>
  <div class="card"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap"><h2 style="margin:0">Tests</h2>
      <div class="row" style="gap:8px"><button class="ghost" id="runCi" type="button">Run the tests</button><button class="ghost" id="runE2e" type="button">Run the end-to-end check</button></div></div><div class="err"></div>
    <h3>Tests (CI)</h3><div class="tablewrap"><table class="slim">${d.ci.map(row).join('') || '<tr><td class="mu">No runs yet.</td></tr>'}</table></div>
    <h3>End-to-end (the app in a real browser)</h3><div class="tablewrap"><table class="slim">${d.e2e.map(row).join('') || '<tr><td class="mu">No runs yet.</td></tr>'}</table></div>
    <div id="agOut"></div></div>
  <div class="card"><h2>Agent work</h2>
    ${d.pulls.length ? `<h3>Waiting for your review</h3><ul>${d.pulls.map(p => `<li><a href="${H.esc(H.safeUrl(p.url))}" target="_blank" rel="noopener">#${p.number} ${H.esc(p.title)}</a> <span class="mu">${H.date(Date.parse(p.at))}</span></li>`).join('')}</ul>` : '<p class="mu">No pull requests from the agent waiting.</p>'}
    <h3>Recent agent runs</h3><div class="tablewrap"><table class="slim">${d.agentRuns.map(row).join('') || '<tr><td class="mu">No agent runs yet.</td></tr>'}</table></div></div>` : ''}`;
  if (!d.configured) return;
  const f = H.$('#agTask', view);
  f.kind.onchange = () => { H.$('#agRunPick', view).hidden = f.kind.value !== 'debug'; };
  H.act(H.$('button', f), async () => { const v = H.form(f); await H.api('/admin/agents/task', { body: { task: v.task, kind: v.kind, runId: v.kind === 'debug' ? v.runId : '' } }); f.task.value = ''; setTimeout(H.render, 3000); return 'Started. It shows under Recent agent runs in a few seconds.'; });
  H.act(H.$('#runCi', view), async () => { await H.api('/admin/agents/tests', { body: { which: 'ci' } }); setTimeout(H.render, 3000); return 'Tests started'; });
  H.act(H.$('#runE2e', view), async () => { await H.api('/admin/agents/tests', { body: { which: 'e2e' } }); setTimeout(H.render, 3000); return 'End-to-end check started'; });
  const out = H.$('#agOut', view);
  H.$$('[data-log]', view).forEach(b => H.act(b, async () => { const l = await H.api(`/admin/agents/runs/${b.dataset.log}/log`); out.innerHTML = l.map(j => `<h3>${H.esc(j.job)} ${j.steps.length ? `<span class="mu">· failed at ${H.esc(j.steps.join(', '))}</span>` : ''}</h3><pre class="logbox" data-no-tr>${H.esc(j.log)}</pre>`).join(''); out.scrollIntoView({ behavior: 'smooth' }); return ''; }));
  H.$$('[data-explain]', view).forEach(b => H.act(b, async () => {
    const e = await H.api(`/admin/agents/runs/${b.dataset.explain}/explain`, { body: {} });
    out.innerHTML = `<div class="card explain"><h3>${H.esc(e.summary)}</h3><p><b>Likely cause:</b> ${H.esc(e.cause)}</p><p><b>Where to look:</b> ${H.esc(e.where)}</p><p><b>How to fix:</b> ${H.esc(e.fix)}</p>${e.flaky ? '<p class="banner">This looks like a network or runner problem: try Re-run first.</p>' : ''}</div>`;
    out.scrollIntoView({ behavior: 'smooth' }); return '';
  }));
  H.$$('[data-fix]', view).forEach(b => H.act(b, async () => { if (!confirm('Start the agent to find and fix this failure? It opens a pull request for you to review.')) return ''; await H.api('/admin/agents/task', { body: { kind: 'debug', runId: b.dataset.fix, task: 'Find the root cause of this failed run and fix it, with a test that would have caught it.' } }); setTimeout(H.render, 3000); return 'Agent started'; }));
  H.$$('[data-rerun]', view).forEach(b => H.act(b, async () => { await H.api(`/admin/agents/runs/${b.dataset.rerun}/rerun`, { body: {} }); setTimeout(H.render, 3000); return 'Re-running'; }));
}

// Admin → Hosting: the servers the site runs on, live health and speed, deploys, switching the
// active server, keep-warm, and the free Cloudflare edge in front.
async function hostingPage(view) {
  const [d, m] = await Promise.all([H.api('/admin/hosting'), H.api('/admin/server/metrics').catch(() => null)]);
  const health = h => !h ? '' : h.up ? `<span class="pill pos">Up</span> <b>${h.ms} ms</b>${h.cold ? ' <span class="pill warn">was asleep</span>' : ''}${h.commit ? ` · version <code>${H.esc(h.commit)}</code>` : ''}${h.routingOk === false ? ' <span class="pill neg">paper/live check failed</span>' : ''}` : `<span class="pill neg">Down</span> <span class="mu">${H.esc(h.error || String(h.status || ''))}</span>`;
  const kindOpts = sel => Object.entries(d.kinds).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${H.esc(v.name)}</option>`).join('');
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-hosting')}
  <div class="card"><h2>Servers</h2><p class="mu" style="margin-top:0">Every server runs the same code and shares one database, so switching moves no data. Only the <b>active</b> server runs bots, scheduled trades and alerts; the others only serve pages, so nothing is sent twice. This page is served by <b data-no-tr>${H.esc(d.thisHost)}</b>.</p>
    ${/^local file/.test(d.database) ? `<p class="banner err">${H.esc(d.database)}</p>` : ''}
    <div class="tablewrap"><table><tr><th>Server</th><th>Address</th><th>Health</th><th></th></tr>${d.servers.map(s => `<tr><td><b>${H.esc(s.name)}</b> <span class="mu" data-no-tr>${H.esc(s.id)}</span><div class="mu small-print">${H.esc(d.kinds[s.kind]?.name || s.kind)}</div>${d.active === s.id ? '<span class="pill pos">Active</span>' : ''}</td>
      <td><a href="${H.esc(H.safeUrl(s.url))}" target="_blank" rel="noopener" data-no-tr>${H.esc(s.url.replace('https://', ''))}</a></td><td>${health(s.health)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:wrap">${d.active === s.id ? '' : `<button class="small" data-switch="${H.esc(s.id)}">Make active</button>`}${s.hook ? `<button class="small ghost" data-deploy="${H.esc(s.id)}">Deploy now</button>` : ''}<button class="small ghost" data-edit="${H.esc(s.id)}">Edit</button>${d.active === s.id ? '' : `<button class="small ghost" data-rm="${H.esc(s.id)}">Remove</button>`}</div></td></tr>`).join('') || '<tr><td colspan="4" class="mu">No servers yet. Add the one you use now (for Render: id <b>render</b>, its onrender.com address and its deploy hook).</td></tr>'}</table></div>
    <div class="err" id="hErr"></div><div id="hOut"></div>
    ${m ? serverCard(m) : ''}
    <label class="chk"><input type="checkbox" id="warm" ${d.keepWarm ? 'checked' : ''}> Keep the active server awake (it calls itself every 9 minutes, so a free host never makes the next visitor wait while it wakes up)</label></div>
  <form class="card" id="srv"><h2>Add or edit a server</h2>
    <div class="row"><label>Id <span class="mu">(= HOST_ID on that server)</span><input name="id" placeholder="oracle" required data-no-tr></label><label>Kind<select name="kind">${kindOpts('oracle-vm')}</select></label><label>Name<input name="name" placeholder="Oracle Cloud"></label></div>
    <div class="row"><label style="flex:2">Address<input name="url" placeholder="https://app.brightolio.com" required data-no-tr></label><label style="flex:2">Deploy hook <span class="mu">(optional, kept encrypted)</span><input name="hook" type="password" placeholder="https://..." autocomplete="off" data-no-tr></label></div>
    <p class="mu small-print" id="kindNote"></p><button>Save server</button><div class="err"></div></form>
  <div class="card" id="edgeCard"><h2>The edge: a free mini server on Cloudflare</h2>
    <p class="mu" style="margin-top:0">A small server on Cloudflare's network sits in front of your servers. The app's files come from the Cloudflare location nearest each visitor, so pages open fast. Everything else goes to the active server. If that server is down, pages are read from the backup (an order is never sent twice). Cloudflare blocks attacks and floods, and the edge wakes every server every 5 minutes. Free: 100,000 visits a day.</p>
    ${d.mainAddress?.warning ? `<p class="banner err" role="alert">${H.esc(d.mainAddress.warning)}</p>` : ''}
    <p class="mu small-print">The site's address for visitors: <b data-no-tr>${H.esc(d.mainAddress?.url || 'not set')}</b>. Each server also has its own address, used for checks only.</p>
    ${d.edge.setup ? `<ul class="plain"><li><span class="pill pos">On</span> <a href="${H.esc(H.safeUrl(d.edge.setup.url))}" target="_blank" rel="noopener" data-no-tr>${H.esc(d.edge.setup.url.replace('https://', ''))}</a> ${d.edge.check ? (d.edge.check.up ? `<span class="pill pos">Answering</span> <b>${d.edge.check.ms} ms</b> ${d.edge.check.edge ? '<span class="pill pos">through the edge</span>' : '<span class="pill warn">not through the edge yet: press Update the edge</span>'}` : `<span class="pill neg">Not answering</span> <span class="mu">${H.esc(d.edge.check.error || String(d.edge.check.status || ''))}</span>`) : ''}</li>
      <li>Sends visitors to: <span data-no-tr>${d.edge.setup.origins.map(H.esc).join(' → ')}</span></li></ul>` : '<p><span class="pill warn">Not set up yet</span></p>'}
    <details ${d.edge.token ? '' : 'open'}><summary><b>${d.edge.token ? 'How it was set up' : 'Set it up (about 5 minutes, free)'}</b></summary><ol>
      <li>Make a free account at <b>dash.cloudflare.com</b> (email and password).</li>
      <li>If your domain is not on Cloudflare yet: <b>Add a domain</b> → <span data-no-tr>brightolio.com</span> → Free plan. Cloudflare shows two name servers: put them at the company where you bought the domain (it can take up to a few hours). Without this, the edge gets a free <span data-no-tr>workers.dev</span> address instead.</li>
      <li>Profile (top right) → <b>API Tokens</b> → Create Token → template <b>Edit Cloudflare Workers</b> → Use template. Under Permissions, also add <b>Zone → DNS → Edit</b> and <b>Zone → Zone → Read</b>. Account Resources: your account; Zone Resources: All zones. → Continue → Create Token, and copy it.</li>
      <li>Here: <a href="#/admin-keys">Admin → Keys</a> → add <code>CLOUDFLARE_API_TOKEN</code> with the token.</li>
      <li>Add your servers above, each with <b>its own</b> address (Oracle: <span data-no-tr>https://app.brightolio.com</span> is the site address; the server's own address (for checks only) is <span data-no-tr>https://138-2-233-183.sslip.io</span>. Render: <span data-no-tr>https://quantpocket.onrender.com</span>), then press the button below.</li></ol></details>
    <form id="edgeForm" class="row" style="align-items:flex-end"><label style="flex:2">Address of the site <span class="mu">(on Cloudflare)</span><input name="domain" value="${H.esc(d.edge.setup?.route ? d.edge.setup.url.replace('https://', '') : (d.edge.publicUrl || '').replace(/^https?:\/\//, ''))}" placeholder="app.brightolio.com" data-no-tr></label>
      <button ${d.edge.token ? '' : 'disabled'}>${d.edge.setup ? 'Update the edge' : 'Set up the edge'}</button></form>
    ${d.edge.token ? '' : '<p class="mu small-print">The button works once CLOUDFLARE_API_TOKEN is in Admin → Keys.</p>'}
    <div class="err" id="eErr"></div><div id="eOut"></div></div>
  <details class="card"><summary><b>Free servers that do not sleep</b></summary>
    <ul><li><b>Oracle Cloud Always Free</b>: an ARM virtual machine that is yours and always on (in 2026 the free allowance is 2 CPUs and 12 GB of memory). Run <code>deploy/vm/setup.sh</code> on it: firewall, keys-only SSH, automatic security updates, HTTPS and auto-deploy from GitHub. Idle free machines can be reclaimed; keep-warm and a pay-as-you-go account (still free within the limits) help.</li>
      <li><b>Northflank</b> free sandbox: 2 always-on services. Connect the GitHub repository; it builds the Dockerfile.</li>
      <li><b>Render</b> (now): free, but sleeps after 15 minutes without visitors; keep-warm and the edge stop that.</li>
      <li><b>Koyeb</b> free: scales to zero when idle.</li></ul>
    <p class="mu small-print">Every server needs the same DATABASE_URL, DATABASE_AUTH_TOKEN and ENCRYPTION_KEY (otherwise saved keys cannot be read), and its own HOST_ID. Free plans change; check each host's current terms.</p></details>`;
  const out = H.$('#hOut', view), err = H.$('#hErr', view), f = H.$('#srv', view);
  const note = () => (H.$('#kindNote', view).textContent = d.kinds[f.kind.value]?.note || '');
  f.kind.onchange = note; note();
  f.onsubmit = async e => { e.preventDefault(); const b = H.form(f); try { await H.api('/admin/hosting/servers', { body: b }); H.render(); } catch (x) { H.$('.err', f).textContent = x.message; } };
  H.$$('[data-edit]', view).forEach(b => (b.onclick = () => { const s = d.servers.find(x => x.id === b.dataset.edit); f.id.value = s.id; f.kind.value = s.kind; f.name.value = s.name; f.url.value = s.url; f.hook.placeholder = s.hook ? '(saved; leave empty to keep)' : 'https://...'; note(); f.scrollIntoView({ behavior: 'smooth' }); }));
  H.$$('[data-rm]', view).forEach(b => (b.onclick = async () => { try { await H.api('/admin/hosting/servers/' + b.dataset.rm, { method: 'DELETE' }); H.render(); } catch (x) { err.textContent = x.message; } }));
  H.$$('[data-deploy]', view).forEach(b => H.act(b, async () => (await H.api(`/admin/hosting/servers/${b.dataset.deploy}/deploy`, { body: {} })).message, out));
  H.$$('[data-switch]', view).forEach(b => (b.onclick = async () => {
    const s = d.servers.find(x => x.id === b.dataset.switch);
    const c = await H.secureConfirm({ title: `Make ${s.name} the active server?`, html: `<p>Visitors are sent to ${H.esc(s.url)} and it takes over bots, scheduled trades and alerts. The other servers keep serving pages as backups.</p>`, okText: 'Switch' });
    if (!c) return;
    try { const r = await H.api('/admin/hosting/switch', { body: { id: s.id, password: c.password, confirm: c.confirm } }); err.textContent = ''; out.innerHTML = `<ul class="plain">${r.steps.map(x => `<li>✓ ${H.esc(x)}</li>`).join('')}</ul>`; setTimeout(H.render, 2500); }
    catch (x) { err.textContent = x.message; }
  }));
  H.$('#edgeForm', view).onsubmit = async e => {
    e.preventDefault();
    const eo = H.$('#eOut', view), ee = H.$('#eErr', view), domain = e.target.domain.value.trim();
    const c = await H.secureConfirm({ title: 'Put the edge in front of your servers?', html: `<p>Visitors to ${H.esc(domain || 'the workers.dev address')} will go through the Cloudflare edge to the active server. You can update it again at any time.</p>`, okText: 'Set up' });
    if (!c) return;
    ee.textContent = ''; eo.innerHTML = '<p class="mu">Setting up… (up to a minute)</p>';
    try { const r = await H.api('/admin/hosting/edge', { body: { domain, password: c.password, confirm: c.confirm } }); eo.innerHTML = `<ul class="plain">${r.steps.map(x => `<li>✓ ${H.esc(x)}</li>`).join('')}</ul>`; setTimeout(H.render, 4000); }
    catch (x) { eo.innerHTML = ''; ee.textContent = x.message; }
  };
  H.$$('[data-vm]', view).forEach(b => H.act(b, async () => { const k = b.dataset.vm; if (!confirm(k === 'deploy' ? 'Build and start the newest version on this server now?' : 'Restart the app on this server? It is away for about 20 seconds.')) return ''; return (await H.adminUnlocked('/admin/server/' + k, { body: {} })).message; }, out));
  H.$('#warm', view).onchange = e => H.api('/admin/hosting/settings', { method: 'PUT', body: { keepWarm: e.target.checked } }).catch(x => (err.textContent = x.message));
}

// ---------- the server's own numbers (Hosting) and Admin → Database ----------
const gb = n => (n == null ? '-' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB');
const ago = t => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 90 ? s + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 172800 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
const pctUsed = (used, total) => (total ? Math.round(used / total * 100) + '%' : '-');
function serverCard(m) {
  const mem = m.memory || {}, disk = m.disk || {};
  return `<div class="card" style="margin:12px 0 0"><h3 style="margin-top:0">This server: <span data-no-tr>${H.esc(m.host)}</span> ${m.standby ? '<span class="pill warn">Standby (STANDBY=1): pages only</span>' : m.active ? '<span class="pill pos">Runs the jobs</span>' : '<span class="pill">Pages only</span>'}</h3>
    <div class="stats"><div class="stat"><span>CPU load (1, 5, 15 min)</span><b>${m.load.join(' · ')}</b><span class="mu">${m.cpus} CPUs</span></div>
      <div class="stat"><span>Memory used</span><b>${pctUsed(mem.total - mem.available, mem.total)}</b><span class="mu">of ${gb(mem.total)}</span></div>
      <div class="stat"><span>Disk used</span><b>${disk.total ? pctUsed(disk.total - disk.free, disk.total) : '-'}</b><span class="mu">${gb(disk.free)} free</span></div>
      <div class="stat"><span>Version</span><b data-no-tr>${H.esc(m.version || '-')}</b><span class="mu">up ${Math.round(m.appUptimeSec / 60)} min</span></div>
      <div class="stat"><span>Last deploy</span><b>${m.lastDeploy ? (m.lastDeploy.ok ? '<span class="pos">OK</span>' : '<span class="neg">' + H.esc(m.lastDeploy.action) + '</span>') : '-'}</b><span class="mu">${m.lastDeploy ? ago(m.lastDeploy.at) : ''}</span></div></div>
    ${m.canRequest ? `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="small" data-vm="deploy">Deploy now</button><button class="small ghost" data-vm="restart">Restart</button>${m.pending.length ? `<span class="pill warn">Waiting: ${m.pending.map(H.esc).join(', ')}</span>` : ''}</div>
      <p class="mu small-print">The server's update script carries these out within 2 minutes (it also deploys every new version by itself). <a href="#/admin-database">Database and backups</a></p>` : ''}
    ${m.hostActions?.length ? `<details><summary class="mu">Recent host actions</summary><pre class="logbox" data-no-tr>${H.esc(m.hostActions.join('\n'))}</pre></details>` : ''}</div>`;
}

async function databasePage(view) {
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-database')}<div class="card"><p class="mu">Loading…</p></div>`;
  let d, k;
  try { [d, k] = await Promise.all([H.adminUnlocked('/admin/server'), null]); k = await H.adminUnlocked('/admin/server/keys'); }
  catch (e) { view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-database')}<div class="card"><p class="err">${H.esc(e.message)}</p><button id="retry">Try again</button></div>`; H.$('#retry', view).onclick = () => H.render(); return; }
  const db = d.database, b = db.backups || {}, mt = db.maintenance || {};
  const files = (b.files || []).slice(0, 30);
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-database')}
  ${db.mergePending ? '<p class="banner">This server started on a new database on 2026-11-23 because the old database refused every read. The old data (accounts, trades, settings) is merged in automatically once Turso allows it again (tried every day, or Actions → Oracle database move → merge-turso). Anyone who signs up again with the same email keeps one account with both.</p>' : ''}
  ${mt.on ? `<p class="banner">Maintenance is on${mt.reason ? ': ' + H.esc(mt.reason) : ''}. Trading is paused and new orders are refused.</p>` : ''}
  ${k.warnings.filter(w => w.level === 'error').map(w => `<p class="banner err">${H.esc(w.text)}</p>`).join('')}
  <div class="card"><h2>Database</h2><div class="stats">
    <div class="stat"><span>Type</span><b>${db.kind === 'file' ? 'SQLite file on this server' : 'Shared database server'}</b><span class="mu" data-no-tr>${H.esc(db.file || '')}</span></div>
    <div class="stat"><span>Size</span><b>${gb(db.bytes)}</b><span class="mu">${db.walBytes ? 'log ' + gb(db.walBytes) : ''}</span></div>
    <div class="stat"><span>Lasting disk</span><b>${db.persistentDisk ? '<span class="pos">Yes</span>' : db.kind === 'file' ? '<span class="neg">No</span>' : '-'}</b></div>
    <div class="stat"><span>Last statement</span><b>${db.health.ok ? '<span class="pos">OK</span>' : '<span class="neg">Failed</span>'}</b><span class="mu">${ago(db.health.okAt)}</span></div></div>
    ${db.sizes.counted ? `<details><summary><b>Tables</b> (${db.sizes.tables.length})</summary><div class="tablewrap"><table class="slim"><tr><th>Table</th><th>Rows</th></tr>${db.sizes.tables.map(t => `<tr><td data-no-tr>${H.esc(t.name)}</td><td>${t.rows.toLocaleString()}</td></tr>`).join('')}</table></div></details>` : `<p class="mu">${H.esc(db.sizes.reason || '')}</p>`}</div>
  <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Backups</h2>${b.enabled ? '<button class="small" id="bkNow">Back up now</button>' : ''}</div>
    ${!b.enabled ? `<p class="mu">${H.esc(b.reason || '')}</p>` : `
    <p class="mu">Every hour, an online copy (the app keeps running), checked before it counts. Kept here: 48 hourly and 30 daily. ${b.offsite ? 'Each daily copy is also encrypted and sent to ' + H.esc(b.offsite) + '.' : '<b class="neg">No off-site copy:</b> add OCI_BACKUP_PAR_URL (Oracle Object Storage → bucket → pre-authenticated request, write) in Keys.'}</p>
    <ul class="plain"><li>Last backup: ${b.last ? `${b.last.ok ? '<span class="pill pos">OK</span>' : '<span class="pill neg">Failed</span>'} <span data-no-tr>${H.esc(b.last.file || '')}</span> · ${ago(b.last.at)}${b.last.ok ? ` · ${gb(b.last.bytes)} · ${b.last.tables} tables · ${(b.last.rows || 0).toLocaleString()} rows` : ` · ${H.esc(b.last.error || '')}`}` : 'none yet (the first runs a few minutes after start)'}</li>
      <li>Last off-site upload: ${b.lastUpload ? (b.lastUpload.ok ? `<span class="pill pos">OK</span> ${ago(b.lastUpload.at)}` : `<span class="pill warn">${H.esc(b.lastUpload.warning || b.lastUpload.error || 'failed')}</span>`) : 'none yet'}</li></ul>
    <div class="tablewrap"><table class="slim"><tr><th>File</th><th>Kind</th><th>Size</th><th>Made</th><th></th></tr>${files.map(f => `<tr><td data-no-tr>${H.esc(f.name)}</td><td>${H.esc(f.kind)}</td><td>${gb(f.bytes)}</td><td>${ago(f.at)}</td>
      <td><div class="row" style="gap:6px"><button class="small ghost" data-dl="${H.esc(f.name)}">Download</button><button class="small ghost" data-restore="${H.esc(f.name)}">Restore</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="mu">No backups yet.</td></tr>'}</table></div>`}
    <div class="err" id="dbErr"></div><div id="dbOut"></div></div>
  <div class="card"><h2>Maintenance mode</h2><p class="mu" style="margin-top:0">Pauses every trading job (bots, scheduled trades, Playbooks, pairs) and refuses new orders, with a banner for everyone. Pages and data stay available.</p>
    <div class="row" style="align-items:flex-end"><label style="flex:2">Reason<input id="mtReason" value="${H.esc(mt.reason || '')}" placeholder="Database maintenance"></label><button id="mtToggle" class="${mt.on ? '' : 'ghost'}">${mt.on ? 'Turn maintenance off' : 'Turn maintenance on'}</button></div>
    ${mt.source === 'env' ? '<p class="mu small-print">On because MAINTENANCE=1 is in the server settings: remove it there to turn it off.</p>' : ''}</div>
  <div class="card tablewrap"><h2>Keys on this server</h2><p class="mu" style="margin-top:0">Names only: set or missing. Values are never shown here (change them in <a href="#/admin-keys">Keys</a>).</p>
    ${k.warnings.length ? `<ul class="plain">${k.warnings.map(w => `<li><span class="pill ${w.level === 'error' ? 'neg' : 'warn'}">${w.level === 'error' ? 'Required' : 'Check'}</span> ${H.esc(w.text)}</li>`).join('')}</ul>` : '<p><span class="pill pos">All required keys are set</span></p>'}
    <details><summary>Every key</summary>${k.groups.map(g => `<h3>${H.esc(g.name)}</h3><p data-no-tr>${g.keys.map(x => `<span class="pill ${x.set ? 'pos' : x.required ? 'neg' : ''}">${H.esc(x.name)} ${x.set ? '✓' : '·'}</span>`).join(' ')}</p>`).join('')}</details></div>`;
  const out = H.$('#dbOut', view), err = H.$('#dbErr', view);
  if (H.$('#bkNow', view)) H.act(H.$('#bkNow', view), async () => { const r = await H.adminUnlocked('/admin/server/backup', { body: {} }); setTimeout(H.render, 1200); return `Backed up: ${r.file} (${gb(r.bytes)})`; }, out);
  H.$$('[data-dl]', view).forEach(btn => (btn.onclick = async () => {
    err.textContent = '';
    try {
      await H.adminUnlocked('/admin/server/keys'); // opens the window first when it closed
      const r = await fetch('/api/admin/server/download', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ name: btn.dataset.dl }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = btn.dataset.dl; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (x) { err.textContent = x.message; }
  }));
  H.$$('[data-restore]', view).forEach(btn => (btn.onclick = async () => {
    const name = btn.dataset.restore;
    const c = await H.secureConfirm({ title: `Restore ${name}?`, word: 'RESTORE', okText: 'Restore', html: `<p>The app stops for about a minute, the current database is kept on the server (quantpocket.db.before-restore-…), and this backup becomes the live database. Anything saved after it was made is not in it.</p>` });
    if (!c) return;
    try { const r = await H.adminUnlocked('/admin/server/restore', { body: { name, typed: String(c.typed || '').toUpperCase() } }); err.textContent = ''; out.innerHTML = `<p class="banner">${H.esc(r.message)}</p>`; }
    catch (x) { err.textContent = x.message; }
  }));
  H.$('#mtToggle', view).onclick = async () => {
    const on = !mt.on;
    if (on && !confirm('Pause all trading and refuse new orders until you turn it off?')) return;
    try { await H.adminUnlocked('/admin/server/maintenance', { body: { on, reason: H.$('#mtReason', view).value } }); H.render(); } catch (x) { err.textContent = x.message; }
  };
}
