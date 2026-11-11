// All accounts: every Alpaca account in one portfolio (each counted once: duplicates and master
// accounts are recognised), the user's own groups as separate views, and Equalize accounts.
let H;
export function registerCombined(routes, helpers) {
  H = helpers;
  Object.assign(routes, { accounts: combined });
}

const usd = x => (x == null || !isFinite(x) ? '-' : H.money(x));
const pc = (x, d = 2) => (x == null || !isFinite(x) ? '' : `${x > 0 ? '+' : ''}${(+x).toFixed(d)}%`);
const tile = (k, v, c = '', sub = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
const bar = (pct, c = '') => `<span class="sharebar ${c}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></span>`;
const PERIODS = [['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1A', '1Y'], ['all', 'All']];

async function combined(view, q) {
  const v = q.get('view') || 'all';
  let period = q.get('period') || (() => { try { return localStorage.getItem('qp_period') || '1M'; } catch { return '1M'; } })();
  const [d, eq] = await Promise.all([H.api(`/combined?view=${encodeURIComponent(v)}&period=${period}`), H.api('/equalize').catch(() => null)]);
  const t = d.totals, money = d.live ? 'Real money' : 'Paper (test) money';
  const tabs = [['all', 'All accounts'], ...d.groups.map(g => ['g:' + g.id, g.name])];
  const status = a => a.counted ? '<span class="pill pos">Counted</span>' : a.why ? `<span class="pill ${/same Alpaca|Master/.test(a.why) ? 'warn' : ''}" title="${H.esc(a.why)}">${/Master/.test(a.why) ? 'Master · not added' : /same Alpaca/.test(a.why) ? 'Duplicate · not added' : 'Not added'}</span>` : '';
  view.innerHTML = `<div class="pagehead"><div><h1>All accounts <span class="pill ${d.live ? 'warn' : ''}">${d.live ? 'LIVE' : 'Paper'}</span></h1>
      <p class="mu" style="margin:4px 0 0">${money}: every Alpaca account together, each counted once. The same account connected twice, or a master account that holds its sub accounts, is never added twice.</p></div></div>
    <div class="chips viewtabs" id="views">${tabs.map(([k, n]) => `<a href="#/accounts?view=${encodeURIComponent(k)}"><button type="button" class="${k === v ? 'on' : ''}">${H.esc(n)}</button></a>`).join('')}<a href="#grpCard"><button type="button" class="ghost">+ Group</button></a></div>
    <div class="card">
      <div class="stats">
        ${tile('Total value', usd(t.equity), '', `${t.count} account${t.count === 1 ? '' : 's'}`)}
        ${tile('Today', t.dayPlPct == null ? '-' : `${usd(t.dayPl)}`, H.cls(t.dayPl), pc(t.dayPlPct))}
        ${tile('Open profit / loss', usd(t.unrealized), H.cls(t.unrealized))}
        ${tile('Cash', usd(t.cash), '', t.equity ? (t.cash / t.equity * 100).toFixed(1) + '% of the total' : '')}
        ${tile('Buying power', usd(t.buyingPower))}
        ${tile('Holdings', t.positions.length)}
      </div>
      <div class="chips" id="periods" style="margin-top:12px">${PERIODS.map(([p, n]) => `<button data-p="${p}" class="${p === period ? 'on' : ''}">${n}</button>`).join('')}</div>
      <canvas id="eqAll"></canvas>
      <p class="mu small-print" style="margin:6px 0 0">One line for the accounts in this view, added together at each moment.</p>
    </div>
    <div class="card"><h2>Accounts</h2><div class="tablewrap"><table class="accts"><tr><th>Account</th><th class="num">Value</th><th>Share</th><th class="num">Today</th><th class="num">Open P/L</th><th class="num">Holdings</th><th></th></tr>
      ${d.accounts.map(a => `<tr class="${a.counted ? '' : 'dim'}"><td><b>${H.esc(a.label)}</b> <span class="mu small-print" data-no-tr>${H.esc(a.number || a.id)}</span><div>${status(a)} ${a.live ? '<span class="pill warn">live</span>' : '<span class="pill">paper</span>'}</div>${a.why && !a.counted ? `<div class="mu small-print">${H.esc(a.why)}</div>` : ''}${a.note ? `<div class="warn small-print">${H.esc(a.note)}</div>` : ''}
          <label class="small-print roleset">Type <select data-role="${H.esc(a.id)}"><option value="separate" ${a.role !== 'main' && a.role !== 'sub' ? 'selected' : ''}>Separate account</option><option value="main" ${a.role === 'main' ? 'selected' : ''}>Master of sub accounts</option><option value="sub" ${a.role === 'sub' ? 'selected' : ''}>Sub account</option></select></label></td>
        <td class="num">${usd(a.equity)}</td><td>${a.share == null ? '' : `${bar(a.share)} <span class="small-print">${a.share}%</span>`}</td>
        <td class="num ${H.cls(a.dayPl)}">${a.dayPl == null ? '-' : usd(a.dayPl)} <span class="small-print">${pc(a.dayPlPct)}</span></td><td class="num ${H.cls(a.unrealized)}">${usd(a.unrealized)}</td><td class="num">${a.positions ?? '-'}</td>
        <td class="nowrap"><button class="small ghost" data-open="${H.esc(a.id)}">Open</button>${/^alpaca:/.test(a.id) ? ` <button class="small ghost" data-rm="${H.esc(a.id)}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">No Alpaca account connected yet. Add one below.</td></tr>'}
      </table></div><div class="err" id="accErr"></div></div>
    <div class="card"><h2>Holdings across these accounts</h2><div class="tablewrap"><table><tr><th>Symbol</th><th class="num">Shares</th><th class="num">Value</th><th>Weight</th><th class="num">Open P/L</th><th class="num">In accounts</th></tr>
      ${t.positions.map(p => `<tr><td><a href="#/trade?symbol=${encodeURIComponent(p.symbol)}" data-no-tr>${H.esc(p.symbol)}</a></td><td class="num">${p.qty}</td><td class="num">${usd(p.value)}</td><td>${bar(p.weight)} <span class="small-print">${p.weight}%</span></td><td class="num ${H.cls(p.pnl)}">${usd(p.pnl)} <span class="small-print">${pc(p.pnlPct)}</span></td><td class="num">${p.accounts.length}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No holdings in these accounts.</td></tr>'}</table></div></div>
    ${eq ? equalizeCard(eq) : ''}
    <form class="card" id="grpCard"><h2>Groups</h2><p class="mu" style="margin-top:0">Your own sub accounts: put accounts together (for example Retirement, Kids, Trading) and each group gets its own view above, with its own totals and chart.</p>
      ${d.groups.length ? `<ul class="plain grouplist">${d.groups.map(g => `<li><b>${H.esc(g.name)}</b> <span class="mu small-print">${g.accounts.length} account${g.accounts.length === 1 ? '' : 's'}</span> <button type="button" class="small ghost" data-gedit="${g.id}">Edit</button> <button type="button" class="small ghost" data-gdel="${g.id}">Delete</button></li>`).join('')}</ul>` : ''}
      <input type="hidden" name="id"><div class="row"><label style="flex:1">Group name<input name="name" placeholder="e.g. Retirement" maxlength="40"></label></div>
      <div class="checks" id="grpAccts">${(eq?.available || d.accounts).map(a => `<label class="chk"><input type="checkbox" name="acc" value="${H.esc(a.id)}"> ${H.esc(a.label)}</label>`).join('')}</div>
      <button>Save group</button><div class="err"></div></form>
    <form class="card" id="addAcc"><h2>Add an Alpaca account</h2><p class="mu" style="margin-top:0">Create API keys for the account in Alpaca (each sub account has its own keys), then add them here. Keys are encrypted and never shown again. The same account cannot be added twice.</p>
      <div class="row"><label>Name<input name="label" placeholder="e.g. Sub account 2"></label><label>Type<select name="role"><option value="separate">Separate account</option><option value="sub">Sub account</option><option value="main">Master of sub accounts</option></select></label></div>
      <div class="row"><label>API key id<input name="keyId" autocomplete="off" data-no-tr></label><label>Secret key<input name="secret" type="password" autocomplete="off"></label></div>
      <label class="chk"><input type="checkbox" name="live"> Live account (real money). Leave unticked for an Alpaca paper account.</label>
      <button>Add account</button><div class="err"></div></form>`;

  // Chart
  const draw = () => { const pts = d.history?.points || []; if (pts.length) H.drawChart(H.$('#eqAll', view), pts.map(p => p.equity), { base: d.history.baseValue || pts[0].equity, dates: pts.map(p => p.t), time: ['1D', '1W'].includes(period), legend: false }); };
  draw(); const onR = () => draw(); addEventListener('resize', onR); H.onLeave(() => removeEventListener('resize', onR));
  H.$$('#periods button', view).forEach(b => (b.onclick = () => { try { localStorage.setItem('qp_period', b.dataset.p); } catch {} location.hash = `#/accounts?view=${encodeURIComponent(v)}&period=${b.dataset.p}`; }));
  // Accounts
  H.$$('[data-open]', view).forEach(b => (b.onclick = () => { H.state.account = b.dataset.open; try { localStorage.setItem('qp_account', b.dataset.open); } catch {} location.hash = '#/dashboard'; }));
  H.$$('[data-rm]', view).forEach(b => (b.onclick = async () => { if (!confirm('Remove this account from Brightolio? Nothing changes at Alpaca.')) return; try { await H.api('/alpaca/accounts/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); H.render(); } catch (e) { H.$('#accErr', view).textContent = e.message; } }));
  // An account's type decides how it is added up: a master is never added together with its sub accounts.
  H.$$('[data-role]', view).forEach(sel => (sel.onchange = async () => { try { await H.api('/combined/role', { method: 'PUT', body: { id: sel.dataset.role, role: sel.value } }); H.render(); } catch (e) { H.$('#accErr', view).textContent = e.message; } }));
  const add = H.$('#addAcc', view);
  H.act(H.$('button', add), async () => { const r = await H.api('/alpaca/accounts', { body: H.form(add) }); setTimeout(H.render, 800); return `Added ${r.accountNumber ? '…' + String(r.accountNumber).slice(-4) : r.id}`; });
  // Groups
  const gf = H.$('#grpCard', view);
  H.act(H.$('button:not([type])', gf) || H.$('button', gf), async () => {
    const body = { name: gf.name.value, accounts: H.$$('[name=acc]:checked', gf).map(c => c.value) };
    if (gf.id.value) await H.api('/combined/groups/' + gf.id.value, { method: 'PUT', body }); else await H.api('/combined/groups', { body });
    setTimeout(H.render, 500); return 'Saved';
  });
  H.$$('[data-gedit]', view).forEach(b => (b.onclick = () => { const g = d.groups.find(x => String(x.id) === b.dataset.gedit); gf.id.value = g.id; gf.name.value = g.name; H.$$('[name=acc]', gf).forEach(c => (c.checked = g.accounts.includes(c.value))); gf.name.focus(); }));
  H.$$('[data-gdel]', view).forEach(b => (b.onclick = async () => { if (!confirm('Delete this group? The accounts stay as they are.')) return; await H.api('/combined/groups/' + b.dataset.gdel, { method: 'DELETE' }); if (v === 'g:' + b.dataset.gdel) location.hash = '#/accounts'; else H.render(); }));
  if (eq) wireEqualize(view, eq);
}

// ---------- Equalize accounts ----------
function equalizeCard(s) {
  const usable = s.available.filter(a => a.counted);
  const live = usable.filter(a => a.live), chosen = s.accounts.length ? s.accounts : (live.length ? live : usable).map(a => a.id);
  const last = s.lastResult;
  return `<form class="card" id="eqCard"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Equalize accounts</h2>${s.daily ? `<span class="pill pos">Every market open · ${s.mode === 'auto' ? 'places the trades' : 'waits for your approval'}</span>` : ''}</div>
    <p class="mu">Every chosen account gets the same mix: the same share in each holding and in cash, sized to its own value. The mix comes from the chosen accounts together, or from one model account. Sells go first, so their cash pays for the buys.</p>
    ${s.pending ? `<div class="banner"><b>${s.pending.orders.length} trades are waiting</b> to equalize your accounts (they were ${s.pending.drift} points apart). <button type="button" id="eqApprove">Review and approve</button> <button type="button" class="ghost small" id="eqDrop">Discard</button></div>` : ''}
    <div class="checks">${s.available.map(a => `<label class="chk ${a.counted ? '' : 'dim'}"><input type="checkbox" name="acc" value="${H.esc(a.id)}" ${chosen.includes(a.id) ? 'checked' : ''} ${a.counted ? '' : 'disabled'}> ${H.esc(a.label)} ${a.live ? '<span class="pill warn">live</span>' : '<span class="pill">paper</span>'}${a.why ? ` <span class="mu small-print">${H.esc(a.why)}</span>` : ''}</label>`).join('')}</div>
    <div class="row">
      <label>The mix comes from<select name="model"><option value="combined">All chosen accounts together</option>${usable.map(a => `<option value="${H.esc(a.id)}" ${s.model === a.id ? 'selected' : ''}>${H.esc(a.label)} (model account)</option>`).join('')}</select></label>
      <label>Cash to keep in each account %<input name="cashPct" type="number" min="0" max="90" step="0.5" value="${s.options.cashPct ?? ''}" placeholder="same as now"></label>
      <label>Smallest trade $<input name="minTrade" type="number" min="1" step="1" value="${s.options.minTrade}"></label>
      <label>Only when accounts differ by % points<input name="driftPct" type="number" min="0" max="50" step="0.5" value="${s.options.driftPct}"></label>
    </div>
    <label class="chk"><input type="checkbox" name="wholeShares" ${s.options.wholeShares ? 'checked' : ''}> Whole shares only</label>
    <label class="chk"><input type="checkbox" name="daily" ${s.daily ? 'checked' : ''}> Equalize every trading day at the market open (9:30 New York)</label>
    <div class="seg" id="eqMode" ${s.daily ? '' : 'hidden'}><label class="chk"><input type="radio" name="mode" value="approve" ${s.mode !== 'auto' ? 'checked' : ''}> Prepare the trades and wait for my approval</label><label class="chk"><input type="radio" name="mode" value="auto" ${s.mode === 'auto' ? 'checked' : ''}> Place the trades by themselves (asks for your password once)</label></div>
    <div class="row" style="gap:8px;margin-top:10px"><button type="button" id="eqSave" class="ghost">Save settings</button><button type="button" id="eqPreview" class="ghost">Preview</button><button type="button" id="eqRun">Equalize now</button></div>
    <div class="err" id="eqErr"></div><div id="eqOut"></div>
    ${last ? `<p class="mu small-print">Last run ${new Date(last.at).toLocaleString()}: ${last.sent} trade${last.sent === 1 ? '' : 's'} sent${last.failed ? `, ${last.failed} could not be placed` : ''}.</p>` : ''}
  </form>`;
}

function planHtml(p) {
  const name = id => H.esc(p.accounts.find(a => a.id === id)?.label || id);
  return `${p.weights.length ? `<h3>The mix</h3><div class="chips">${p.weights.map(w => `<span class="pill" data-no-tr>${H.esc(w.symbol)} ${w.pct}%</span>`).join('')}<span class="pill">Cash ${(100 - p.weights.reduce((s, w) => s + w.pct, 0)).toFixed(2)}%</span></div>` : ''}
    ${p.left?.length ? `<p class="mu small-print">Left out: ${p.left.map(x => `${H.esc(x.label)} (${H.esc(x.why)})`).join('; ')}</p>` : ''}
    <div class="grid">${p.accounts.filter(a => a.rows.length).map(a => `<div class="card"><h3 style="margin-top:0">${H.esc(a.label)} <span class="mu small-print">${usd(a.equity)}</span></h3><div class="tablewrap"><table class="slim"><tr><th>Holding</th><th class="num">Now</th><th class="num">Target</th></tr>${a.rows.map(r => `<tr><td data-no-tr>${H.esc(r.symbol)}</td><td class="num">${r.currentPct}%</td><td class="num">${r.targetPct}%</td></tr>`).join('')}</table></div></div>`).join('')}</div>
    <h3>${p.orders.length ? `${p.orders.length} trade${p.orders.length === 1 ? '' : 's'}` : 'No trades needed: the accounts already hold the same mix'}</h3>
    ${p.orders.length ? `<div class="tablewrap"><table class="slim"><tr><th>Account</th><th>Side</th><th>Symbol</th><th class="num">Amount</th></tr>${p.orders.map(o => `<tr><td>${name(o.account)}</td><td class="${o.side === 'sell' ? 'neg' : 'pos'}">${o.side === 'sell' ? 'Sell' : 'Buy'}${o.all ? ' all' : ''}</td><td data-no-tr>${H.esc(o.symbol)}</td><td class="num">${o.qty ? `${o.qty} sh · ` : ''}${usd(o.dollars)}</td></tr>`).join('')}</table></div>` : ''}
    <p class="mu small-print">Amounts use the latest prices; the market price at the time of each order applies. Not investment advice.</p>`;
}

function wireEqualize(view, s) {
  const f = H.$('#eqCard', view), out = H.$('#eqOut', view), err = H.$('#eqErr', view);
  const body = () => ({ accounts: H.$$('[name=acc]:checked', f).map(c => c.value), model: f.model.value, options: { cashPct: f.cashPct.value, minTrade: f.minTrade.value, driftPct: f.driftPct.value, wholeShares: f.wholeShares.checked }, daily: f.daily.checked, mode: H.$('[name=mode]:checked', f)?.value || 'approve' });
  f.daily.onchange = () => (H.$('#eqMode', f).hidden = !f.daily.checked);
  const save = async () => {
    const b = body();
    if (b.daily && b.mode === 'auto' && !(s.daily && s.mode === 'auto')) {
      const c = await H.secureConfirm({ title: 'Equalize by itself every morning?', html: '<p>At each market open, Brightolio will place the trades that bring your chosen accounts back to the same mix, without asking first. You can turn this off at any time.</p>', okText: 'Turn on' });
      if (!c) return false;
      Object.assign(b, { password: c.password, confirm: c.confirm });
    }
    Object.assign(s, await H.api('/equalize', { method: 'PUT', body: b })); return true;
  };
  H.$('#eqSave', f).onclick = async () => { err.textContent = ''; try { if (await save()) out.innerHTML = '<p class="ok">Saved</p>'; } catch (e) { err.textContent = e.message; } };
  H.$('#eqPreview', f).onclick = async () => { err.textContent = ''; out.innerHTML = '<p class="mu">Working it out…</p>'; try { await save(); out.innerHTML = planHtml(await H.api('/equalize/preview', { body: {} })); } catch (e) { out.innerHTML = ''; err.textContent = e.message; } };
  H.$('#eqRun', f).onclick = async () => {
    err.textContent = '';
    try {
      if (!(await save())) return;
      const p = await H.api('/equalize/preview', { body: {} });
      if (!p.orders.length) { out.innerHTML = planHtml(p); return; }
      const c = await H.secureConfirm({ title: `Place ${p.orders.length} trades to equalize?`, html: planHtml(p), okText: 'Place the trades' });
      if (!c) return;
      out.innerHTML = '<p class="mu">Placing the trades…</p>';
      const r = await H.api('/equalize/run', { body: { password: c.password, confirm: c.confirm } });
      out.innerHTML = results(r);
    } catch (e) { out.innerHTML = ''; err.textContent = e.message; }
  };
  if (H.$('#eqApprove', f)) H.$('#eqApprove', f).onclick = async () => {
    const p = { ...s.pending, weights: [], accounts: s.available.map(a => ({ id: a.id, label: a.label, rows: [] })) };
    const c = await H.secureConfirm({ title: `Approve ${s.pending.orders.length} trades?`, html: planHtml(p), okText: 'Approve' });
    if (!c) return;
    try { out.innerHTML = results(await H.api('/equalize/approve', { body: { password: c.password, confirm: c.confirm } })); setTimeout(H.render, 3000); } catch (e) { err.textContent = e.message; }
  };
  if (H.$('#eqDrop', f)) H.$('#eqDrop', f).onclick = async () => { await H.api('/equalize/pending', { method: 'DELETE' }); H.render(); };
}
const results = r => r.message ? `<p class="ok">${H.esc(r.message)}</p>` : `<ul class="plain">${r.results.map(x => `<li>${x.ok ? '✓' : '✗'} ${x.side === 'sell' ? 'Sell' : 'Buy'} ${H.esc(x.symbol)} ${usd(x.dollars)}${x.ok ? '' : ` <span class="err">${H.esc(x.error)}</span>`}</li>`).join('')}</ul>`;

// ---------- Equalize, from other pages ----------
// Home: "Equalize now" with the settings saved on All accounts (or every live account the first time).
export async function equalizeNow(helpers, out) {
  H = H || helpers;
  out.innerHTML = '<p class="mu">Working it out…</p>';
  try {
    const p = await H.api('/equalize/preview', { body: {} });
    if (!p.orders.length) { out.innerHTML = `<p class="ok">Your accounts already hold the same mix.</p>`; return; }
    out.innerHTML = '';
    const c = await H.secureConfirm({ title: `Place ${p.orders.length} trades to equalize your accounts?`, html: planHtml(p) + '<p class="mu small-print">Which accounts and where the mix comes from are set in <a href="#/accounts">All accounts</a>.</p>', okText: 'Place the trades' });
    if (!c) return;
    out.innerHTML = '<p class="mu">Placing the trades…</p>';
    out.innerHTML = results(await H.api('/equalize/run', { body: { password: c.password, confirm: c.confirm } }));
  } catch (e) { out.innerHTML = `<p class="err">${H.esc(e.message)}</p>`; }
}

// Positions: the same dollar amount in every holding of one account.
function positionsHtml(p) {
  const rows = p.accounts[0]?.rows || [];
  return `<p>Each holding gets about <b>${usd(p.each)}</b>${p.weights.length ? ` (${p.weights[0].pct}% of the account each)` : ''}.</p>
    <div class="tablewrap"><table class="slim"><tr><th>Holding</th><th class="num">Now</th><th class="num">Target</th></tr>${rows.map(r => `<tr><td data-no-tr>${H.esc(r.symbol)}</td><td class="num">${usd(r.current)}</td><td class="num">${usd(r.target)}</td></tr>`).join('')}</table></div>
    ${p.skipped?.length ? `<p class="mu small-print">Left as they are (options and short positions): <span data-no-tr>${p.skipped.map(H.esc).join(', ')}</span></p>` : ''}
    <h3>${p.orders.length ? `${p.orders.length} trade${p.orders.length === 1 ? '' : 's'}` : 'No trades needed'}</h3>
    ${p.orders.length ? `<div class="tablewrap"><table class="slim"><tr><th>Side</th><th>Symbol</th><th class="num">Amount</th></tr>${p.orders.map(o => `<tr><td class="${o.side === 'sell' ? 'neg' : 'pos'}">${o.side === 'sell' ? 'Sell' : 'Buy'}${o.all ? ' all' : ''}</td><td data-no-tr>${H.esc(o.symbol)}</td><td class="num">${o.qty ? `${o.qty} sh · ` : ''}${usd(o.dollars)}</td></tr>`).join('')}</table></div>` : ''}
    <p class="mu small-print">Sells go first so their cash pays for the buys. Amounts use the latest prices; each order fills at the market price. Not investment advice.</p>`;
}
export async function equalizePositions(helpers, account, out, opts = {}) {
  H = H || helpers;
  out.innerHTML = '<p class="mu">Working it out…</p>';
  try {
    const body = { account, ...opts };
    const p = await H.api('/equalize/positions/preview', { body });
    if (!p.orders.length) { out.innerHTML = `<p class="ok">Every holding already has about the same amount.</p>`; return false; }
    out.innerHTML = '';
    const c = await H.secureConfirm({ title: `Equalize the ${p.accounts[0]?.rows.length || ''} holdings in ${p.label}?`, html: positionsHtml(p), okText: `Place ${p.orders.length} trade${p.orders.length === 1 ? '' : 's'}` });
    if (!c) return false;
    out.innerHTML = '<p class="mu">Placing the trades…</p>';
    out.innerHTML = results(await H.api('/equalize/positions/run', { body: { ...body, password: c.password, confirm: c.confirm } }));
    return true;
  } catch (e) { out.innerHTML = `<p class="err">${H.esc(e.message)}</p>`; return false; }
}
