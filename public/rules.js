// Rules across accounts: a target mix for several accounts, checked on a schedule; the trades wait
// for one approval tap, with options for drift, cash, whole shares, buy-only and taxes.
let H;
export function registerRules(routes, helpers) { H = helpers; routes.rules = page; }
const SCHED = { monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Once a year', manual: 'Only when I ask' };

async function page(view, q) {
  const [d, accts] = await Promise.all([H.api('/rules'), H.accounts()]);
  const edit = q.get('edit') ? d.rules.find(r => r.id === +q.get('edit')) : null;
  view.innerHTML = `<div class="pagehead"><div><h1>Rules across accounts</h1><p class="mu" style="margin:4px 0 0">One mix for several accounts, for example 60% stocks and 40% bonds. When it drifts, Brightfolio works out the trades across your accounts and they wait for your one-tap approval.</p></div></div>
  ${d.rules.map(r => `<div class="card rulecard" data-id="${r.id}"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">${H.esc(r.name)}</h2>
      <p class="mu" style="margin:4px 0 0">${r.targets.map(t => `${H.esc(t.symbol)} ${t.pct}%`).join(' · ')} · ${r.accounts.map(a => H.esc(H.acctLabel(accts.find(x => x.id === a) || { id: a, name: a }))).join(', ')} · ${SCHED[r.schedule]}${r.active ? '' : ' · paused'}</p></div>
      <div class="row" style="gap:6px"><button class="small ghost" data-preview="${r.id}">Check now</button><a href="#/rules?edit=${r.id}"><button class="small ghost">Edit</button></a></div></div>
    ${r.pending ? `<div class="approvebox" style="margin-top:12px"><b>${r.pending.orders.length} trades are waiting for your approval</b> <span class="mu">(drifted ${r.pending.drift} points; prepared ${H.date(r.pending.at)})</span>
      <table class="slim">${r.pending.orders.map(o => `<tr><td>${H.esc(H.acctLabel(accts.find(x => x.id === o.account) || { id: o.account, name: o.account }))}</td><td><b>${o.side.toUpperCase()}</b> <span data-no-tr>${H.esc(o.symbol)}</span></td><td style="text-align:end">${o.qty ? o.qty + ' shares' : ''} ${H.money(o.dollars)}</td></tr>`).join('')}</table>
      <div class="row" style="gap:8px;margin-top:8px"><button data-approve="${r.id}">Approve all trades</button><button class="ghost" data-skip="${r.id}">Skip</button></div><div class="err"></div></div>` : ''}
    <div id="pv${r.id}"></div></div>`).join('')}
  <form class="card" id="rf"><h2>${edit ? 'Edit ' + H.esc(edit.name) : 'New rule'}</h2>
    ${edit ? '' : `<div class="chips" style="margin-bottom:10px">${Object.entries(d.templates).map(([k, t]) => `<button type="button" data-tpl="${k}">${H.esc(t.name)}</button>`).join('')}</div>`}
    <label>Name<input name="name" value="${H.esc(edit?.name || '60/40 stocks and bonds')}" maxlength="60"></label>
    <h3>The mix</h3><div id="targets"></div><button type="button" class="small ghost" id="addT">Add a holding</button> <span class="mu" id="sum"></span>
    <h3>Accounts</h3><div class="row" style="flex-wrap:wrap;gap:6px 18px">${accts.filter(a => a.connected !== false).map(a => `<label class="chk"><input type="checkbox" name="acct" value="${H.esc(a.id)}" ${(edit ? edit.accounts.includes(a.id) : a.id === 'paper') ? 'checked' : ''}> ${H.esc(H.acctLabel(a))}</label>`).join('')}</div>
    <h3>When</h3><div class="row"><label>Check<select name="schedule">${d.schedules.map(s => `<option value="${s}" ${(edit?.schedule || 'quarterly') === s ? 'selected' : ''}>${SCHED[s]}</option>`).join('')}</select></label>
      <label>Rebalance only when off by more than (points)<input name="driftPct" type="number" min="0" max="50" step="0.5" value="${edit?.options.driftPct ?? d.defaults.driftPct}"></label></div>
    <details class="opts"><summary>More options</summary>
      <div class="row"><label>Keep in cash (%)<input name="cashPct" type="number" min="0" max="50" step="0.5" value="${edit?.options.cashPct ?? d.defaults.cashPct}"></label><label>Smallest trade ($)<input name="minTrade" type="number" min="1" step="1" value="${edit?.options.minTrade ?? d.defaults.minTrade}"></label></div>
      ${[['wholeShares', 'Whole shares only'], ['buyOnly', 'Buy only (use free cash; never sell)'], ['skipGains', 'Do not sell holdings that are at a gain (avoids tax)'], ['sellOthers', 'Sell holdings that are not in the mix']].map(([k, t]) => `<label class="chk"><input type="checkbox" name="${k}" ${(edit ? edit.options[k] : d.defaults[k]) ? 'checked' : ''}> ${t}</label>`).join('')}
      ${edit ? `<label class="chk"><input type="checkbox" name="active" ${edit.active ? 'checked' : ''}> Rule is on</label>` : ''}</details>
    <div class="row" style="gap:8px;margin-top:12px"><button id="save">${edit ? 'Save' : 'Create rule'}</button>${edit ? '<button type="button" class="ghost danger-t" id="del">Delete rule</button>' : ''}</div><div class="err"></div>
    <p class="mu small-print">Nothing trades without your approval. Trades are prepared at today's prices and expire after 5 days. Selling in a taxable account can create a tax bill.</p></form>`;

  // The mix editor.
  let targets = edit ? edit.targets.map(t => ({ ...t })) : d.templates['60/40'].targets.map(([symbol, pct]) => ({ symbol, pct }));
  const f = H.$('#rf', view), box = H.$('#targets', view);
  const draw = () => {
    box.innerHTML = targets.map((t, i) => `<div class="row tgt"><label>Symbol<input data-i="${i}" data-k="symbol" value="${H.esc(t.symbol)}" dir="ltr"></label><label>Share (%)<input data-i="${i}" data-k="pct" type="number" min="0" max="100" step="0.5" value="${t.pct}"></label><button type="button" class="small ghost" data-rm="${i}" style="align-self:flex-end">Remove</button></div>`).join('');
    const sum = targets.reduce((s, t) => s + (+t.pct || 0), 0); H.$('#sum', view).textContent = `Total ${+sum.toFixed(2)}%${Math.abs(sum - 100) > 0.01 ? ' (make it 100%)' : ''}`;
    H.$$('[data-k]', box).forEach(inp => (inp.oninput = () => { targets[+inp.dataset.i][inp.dataset.k] = inp.dataset.k === 'pct' ? +inp.value : inp.value.toUpperCase(); const s = targets.reduce((a, t) => a + (+t.pct || 0), 0); H.$('#sum', view).textContent = `Total ${+s.toFixed(2)}%${Math.abs(s - 100) > 0.01 ? ' (make it 100%)' : ''}`; }));
    H.$$('[data-rm]', box).forEach(b => (b.onclick = () => { targets.splice(+b.dataset.rm, 1); draw(); }));
  };
  draw();
  H.$('#addT', view).onclick = () => { targets.push({ symbol: '', pct: 0 }); draw(); };
  H.$$('[data-tpl]', view).forEach(b => (b.onclick = () => { const t = d.templates[b.dataset.tpl]; targets = t.targets.map(([symbol, pct]) => ({ symbol, pct })); f.name.value = t.name; draw(); }));
  H.act(H.$('#save', view), async () => {
    const v = H.form(f);
    const body = { name: v.name, targets, accounts: H.$$('[name=acct]:checked', f).map(c => c.value), schedule: v.schedule, options: { driftPct: +v.driftPct, cashPct: +v.cashPct, minTrade: +v.minTrade, wholeShares: v.wholeShares, buyOnly: v.buyOnly, skipGains: v.skipGains, sellOthers: v.sellOthers }, ...(edit ? { active: v.active } : {}) };
    if (edit) await H.api('/rules/' + edit.id, { method: 'PUT', body }); else await H.api('/rules', { body });
    location.hash = '#/rules'; H.render(); return '';
  });
  if (H.$('#del', view)) H.act(H.$('#del', view), async () => { if (!confirm('Delete this rule?')) return ''; await H.api('/rules/' + edit.id, { method: 'DELETE' }); location.hash = '#/rules'; return ''; });
  H.$$('[data-preview]', view).forEach(b => H.act(b, async () => {
    const p = await H.api(`/rules/${b.dataset.preview}/preview`), out = H.$('#pv' + b.dataset.preview, view);
    out.innerHTML = `<div class="tablewrap" style="margin-top:12px"><table class="slim"><tr><th>Holding</th><th>Now</th><th>Target</th><th>Now %</th><th>Target %</th></tr>${p.rows.map(x => `<tr><td data-no-tr>${H.esc(x.symbol)}</td><td>${H.money(x.current)}</td><td>${H.money(x.target)}</td><td>${x.currentPct}%</td><td>${x.targetPct}%</td></tr>`).join('')}</table></div>
      <p>${p.needed ? `Off by up to <b>${p.drift}</b> points: ${p.orders.length} trades would bring it back.` : `Off by up to ${p.drift} points: within your limit, no trades needed.`}</p>
      ${p.orders.length ? `<button data-prep="${b.dataset.preview}">Prepare these ${p.orders.length} trades for approval</button><div class="err"></div>` : ''}`;
    const prep = H.$('[data-prep]', out); if (prep) H.act(prep, async () => { await H.api(`/rules/${prep.dataset.prep}/prepare`, { body: {} }); H.render(); return ''; });
    return '';
  }));
  H.$$('[data-approve]', view).forEach(b => H.act(b, async () => {
    if (!confirm('Place all these trades now?')) return '';
    const r = await H.api(`/rules/${b.dataset.approve}/approve`, { body: {} });
    setTimeout(H.render, 1500);
    return `${r.results.filter(x => x.ok).length} of ${r.results.length} trades placed${r.results.some(x => !x.ok) ? ': ' + r.results.filter(x => !x.ok).map(x => `${x.symbol} ${x.error}`).join('; ') : ''}`;
  }));
  H.$$('[data-skip]', view).forEach(b => H.act(b, async () => { await H.api(`/rules/${b.dataset.skip}/skip`, { body: {} }); H.render(); return ''; }));
}
