// Business (menu → Business): dashboard, invoices and payments, bookkeeping (chart of accounts and
// double-entry journal), bank lines and receipts, inventory, payroll, reports and currencies.
let H;
export function registerBusiness(routes, helpers) {
  H = helpers;
  routes.currencies = view => { view.innerHTML = `<div class="pagehead"><div><h1>Currencies</h1><p class="mu" style="margin:4px 0 0">Convert between currencies at today's or a past date's reference rate, for buying shares on other markets or moving money abroad.</p></div></div>${fxCard()}`; wireFx(view); };
  for (const [k, tab] of [['business', 'overview'], ['invoices', 'invoices'], ['books', 'books'], ['bank', 'bank'], ['inventory', 'inventory'], ['payroll', 'payroll'], ['bizreports', 'reports']]) routes[k] = (view, q) => business(view, q.get('tab') || tab);
}

const TABS = [['overview', 'Dashboard', 'business'], ['invoices', 'Invoices', 'invoices'], ['books', 'Bookkeeping', 'books'], ['bank', 'Bank & receipts', 'bank'], ['inventory', 'Inventory', 'inventory'], ['payroll', 'Payroll', 'payroll'], ['reports', 'Reports', 'bizreports'], ['settings', 'Settings', 'business?tab=settings']];
const B = (p, o) => H.api('/biz' + p, o);
const today = () => new Date().toISOString().slice(0, 10);
const tile = (k, v, c = '', sub = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
const pill = s => `<span class="pill ${{ paid: 'pos', partial: 'warn', void: '', sent: '', overdue: 'neg', open: 'warn', posted: 'pos', matched: 'pos' }[s] || ''}">${H.esc(s)}</span>`;
let CUR = 'USD';
const money = v => (v == null || !isFinite(v) ? '-' : (+v).toLocaleString(undefined, { style: 'currency', currency: CUR }));

async function business(view, tab) {
  if (H.me()?.role !== 'admin') { view.innerHTML = '<div class="card"><h1>Not available</h1><p class="mu">This area is for the site owner. For your investing, see <a href="#/currencies">Currencies</a>, <a href="#/tax">Taxes</a> and <a href="#/insights">Insights & journal</a>.</p></div>'; return; }
  const s = await B('/settings');
  CUR = s.currency || 'USD';
  view.innerHTML = `<div class="pagehead"><div><h1>Business</h1><p class="mu" style="margin:4px 0 0">${H.esc(s.name || 'Your business')} · ${H.esc(CUR)} · invoices, books, payroll and reports in one place.</p></div></div>
    <div class="chips viewtabs">${TABS.map(([k, t, href]) => `<a href="#/${href}"><button type="button" class="${k === tab ? 'on' : ''}">${t}</button></a>`).join('')}</div><div id="bizBody"><p class="mu">Loading…</p></div>`;
  const body = H.$('#bizBody', view);
  await ({ overview, invoices, books, bank, inventory, payroll, reports, settings }[tab] || overview)(body, s);
}

// ---------- dashboard ----------
async function overview(el, s) {
  const d = await B('/overview');
  const cf = d.cashFlow;
  el.innerHTML = `${!s.name ? '<div class="banner">Start in <a href="#/business?tab=settings">Settings</a>: your business name, address and currency appear on invoices.</div>' : ''}
  <div class="card"><div class="stats">
    ${tile('Cash', money(d.cash))}${tile('Income this month', money(d.mtd.totalIncome))}${tile('Profit this month', money(d.mtd.net), H.cls(d.mtd.net))}
    ${tile('Profit this year', money(d.ytd.net), H.cls(d.ytd.net), d.ytd.margin == null ? '' : `margin ${d.ytd.margin}%`)}${tile('Customers owe', money(d.receivable), '', d.overdue ? `${money(d.overdue)} overdue` : '')}
    ${tile('Runway', d.runwayMonths == null ? 'Cash is growing' : d.runwayMonths + ' months', d.runwayMonths != null && d.runwayMonths < 6 ? 'neg' : '')}
  </div></div>
  <div class="grid">
    <div class="card"><h2>Cash in and out</h2><canvas id="cfc" style="height:200px"></canvas>
      <p class="mu small-print">Next 3 months (estimate from the last 3 months and invoices due): ${cf.forecast.map(f => `${f.month}: <b class="${H.cls(f.net)}">${money(f.net)}</b>`).join(' · ')}</p></div>
    <div class="card"><h2>To do</h2><ul class="plain">
      ${d.overdue ? `<li><a href="#/invoices">${money(d.overdue)} in overdue invoices</a></li>` : ''}
      ${d.reorder.map(i => `<li><a href="#/inventory">Reorder ${H.esc(i.name)}${i.variant ? ' · ' + H.esc(i.variant) : ''}: ${i.qty} left</a></li>`).join('')}
      <li><a href="#/bank">Import bank lines and match receipts</a></li><li><a href="#/invoices">Send an invoice</a></li><li><a href="#/payroll">Run payroll</a></li></ul></div>
  </div>
  ${fxCard()}`;
  if (cf.months.length) H.drawChart(H.$('#cfc', el), cf.months.map(m => m.net), { dates: cf.months.map(m => m.month + '-01'), legend: false, base: 0 });
  wireFx(el);
}
const fxCard = () => `<form class="card" id="fx"><h2>Currency converter</h2><div class="row"><label>Amount<input name="amount" type="number" step="any" value="100"></label><label>From<input name="from" value="USD" maxlength="3" data-no-tr></label><label>To<input name="to" value="EUR" maxlength="3" data-no-tr></label><label>On date (optional)<input name="date" type="date"></label></div><button>Convert</button><div class="err"></div><p id="fxOut" class="mu"></p><p class="mu small-print">European Central Bank reference rates.</p></form>`;
const wireFx = el => { const f = H.$('#fx', el); if (!f) return; H.act(H.$('button', f), async () => { const v = H.form(f), r = await B(`/fx?from=${encodeURIComponent(v.from)}&to=${encodeURIComponent(v.to)}&amount=${encodeURIComponent(v.amount)}${v.date ? '&date=' + v.date : ''}`); H.$('#fxOut', f).innerHTML = `<b>${r.amount} ${H.esc(r.from)} = ${r.converted.toLocaleString()} ${H.esc(r.to)}</b> (1 ${H.esc(r.from)} = ${r.rate} ${H.esc(r.to)})`; return ''; }); };

// ---------- invoices ----------
async function invoices(el, s) {
  const [list, contacts, items] = await Promise.all([B('/invoices'), B('/contacts'), B('/items')]);
  const status = i => i.overdue ? 'overdue' : i.status;
  el.innerHTML = `<div class="card"><div class="stats">${tile('Open', money(list.filter(i => ['sent', 'partial'].includes(i.status)).reduce((t, i) => t + i.balance, 0)))}${(o => tile('Overdue', money(o), o > 0 ? 'neg' : ''))(list.filter(i => i.overdue).reduce((t, i) => t + i.balance, 0))}${tile('Paid this year', money(list.filter(i => i.status === 'paid' && (i.issue || '').startsWith(today().slice(0, 4))).reduce((t, i) => t + i.total, 0)))}${tile('Recurring', list.filter(i => i.recurring && i.recurring !== 'none').length)}</div></div>
  <form class="card" id="newInv"><h2>New invoice</h2>
    <div class="row"><label style="flex:2">Customer<input name="cname" list="custs" placeholder="Name" required></label><label style="flex:2">Email<input name="cemail" type="email" placeholder="for sending the invoice"></label><datalist id="custs">${contacts.map(c => `<option value="${H.esc(c.name)}">`).join('')}</datalist></div>
    <div class="row"><label>Issue date<input name="issue" type="date" value="${today()}"></label><label>Due date<input name="due" type="date"></label><label>Currency<select name="currency">${s.currencies.map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>Tax %<input name="taxPct" type="number" step="0.01" min="0" value="0"></label><label>Repeats<select name="recurring"><option value="none">No</option><option value="monthly">Every month</option><option value="quarterly">Every 3 months</option><option value="yearly">Every year</option></select></label></div>
    <div class="tablewrap"><table class="slim" id="invLines"><tr><th>Description</th><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th></th></tr></table></div>
    <button type="button" class="ghost small" id="addLine">+ Line</button>
    <label>Notes<textarea name="notes" placeholder="Payment details, thank-you note"></textarea></label>
    <label class="chk"><input type="checkbox" name="email" checked> Email it to the customer with a link to view and pay</label>
    <button>Create invoice</button><div class="err"></div><div id="invOut"></div></form>
  <div class="card"><h2>Invoices</h2><div class="tablewrap"><table><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th><th></th></tr>
    ${list.map(i => `<tr><td data-no-tr>${H.esc(i.number)}${i.recurring && i.recurring !== 'none' ? ' <span class="pill">repeats ' + H.esc(i.recurring) + '</span>' : ''}</td><td>${H.esc(i.contact?.name || '')}</td><td>${H.esc(i.issue)}</td><td>${H.esc(i.due)}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.balance)}</td><td>${pill(status(i))}</td>
      <td class="nowrap"><a href="/i/${H.esc(i.token)}" target="_blank" rel="noopener"><button type="button" class="small ghost">View</button></a> <a href="/api/biz/invoices/${i.id}.pdf"><button type="button" class="small ghost">PDF</button></a>${['sent', 'partial'].includes(i.status) ? ` <button type="button" class="small" data-pay="${i.id}" data-bal="${i.balance}">Record payment</button> <button type="button" class="small ghost" data-send="${i.id}">Email</button>` : ''}${i.status === 'sent' && !i.payments?.length ? ` <button type="button" class="small ghost" data-void="${i.id}">Void</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">No invoices yet.</td></tr>'}</table></div><div class="err" id="invErr"></div>
    ${s.hasStripe ? '<p class="mu small-print">Customers can pay by card on their invoice page (your Stripe account).</p>' : '<p class="mu small-print">Add your Stripe secret key in <a href="#/business?tab=settings">Settings</a> and customers can pay by card from the invoice link.</p>'}</div>`;
  const f = H.$('#newInv', el), lines = H.$('#invLines', f);
  const addLine = () => lines.insertAdjacentHTML('beforeend', `<tr><td><input name="ldesc" placeholder="What you sold"></td><td><select name="litem"><option value="">-</option>${items.map(it => `<option value="${it.id}" data-price="${it.price}">${H.esc(it.name)}${it.variant ? ' · ' + H.esc(it.variant) : ''} (${it.qty})</option>`).join('')}</select></td><td><input name="lqty" type="number" step="any" value="1" style="width:6em"></td><td><input name="lprice" type="number" step="0.01" style="width:8em"></td><td><button type="button" class="small ghost" data-rmline>×</button></td></tr>`);
  addLine(); H.$('#addLine', f).onclick = addLine;
  lines.addEventListener('click', e => { if (e.target.matches('[data-rmline]') && H.$$('tr', lines).length > 2) e.target.closest('tr').remove(); });
  lines.addEventListener('change', e => { if (e.target.name === 'litem') { const o = e.target.selectedOptions[0], tr = e.target.closest('tr'); if (o?.dataset.price) tr.querySelector('[name=lprice]').value = o.dataset.price; if (!tr.querySelector('[name=ldesc]').value) tr.querySelector('[name=ldesc]').value = o.textContent.replace(/ \(\d.*\)$/, ''); } });
  H.act(H.$('button:not([type])', f), async () => {
    const v = H.form(f), c = contacts.find(x => x.name === v.cname);
    const body = { contact: c ? { id: c.id } : { name: v.cname, email: v.cemail }, issue: v.issue, due: v.due || undefined, currency: v.currency, taxPct: v.taxPct, recurring: v.recurring, notes: v.notes, email: f.email.checked,
      lines: H.$$('tr', lines).slice(1).map(tr => ({ desc: tr.querySelector('[name=ldesc]').value, item: tr.querySelector('[name=litem]').value || null, qty: tr.querySelector('[name=lqty]').value, price: tr.querySelector('[name=lprice]').value })) };
    if (!c && v.cname) await B('/contacts', { body: { name: v.cname, email: v.cemail } }).catch(() => {});
    const r = await B('/invoices', { body });
    H.$('#invOut', f).innerHTML = `<p class="ok">Invoice ${H.esc(r.number)} for ${money(r.total)} created. Customer link: <a href="${H.esc(r.link)}" target="_blank" rel="noopener" data-no-tr>${H.esc(r.link)}</a></p>`;
    setTimeout(H.render, 2500); return '';
  });
  const err = H.$('#invErr', el);
  H.$$('[data-pay]', el).forEach(b => (b.onclick = async () => { const a = prompt('Amount received', b.dataset.bal); if (!a) return; try { await B(`/invoices/${b.dataset.pay}/payment`, { body: { amount: +a } }); H.render(); } catch (e) { err.textContent = e.message; } }));
  H.$$('[data-send]', el).forEach(b => (b.onclick = async () => { try { const r = await B(`/invoices/${b.dataset.send}/send`, { body: {} }); err.innerHTML = `<span class="ok">${r.skipped ? 'This customer has no email; share the link instead: ' + H.esc(r.link) : 'Emailed'}</span>`; } catch (e) { err.textContent = e.message; } }));
  H.$$('[data-void]', el).forEach(b => (b.onclick = async () => { if (!confirm('Void this invoice? Its amounts are taken back out of the books.')) return; try { await B(`/invoices/${b.dataset.void}/void`, { body: {} }); H.render(); } catch (e) { err.textContent = e.message; } }));
}

// ---------- bookkeeping ----------
async function books(el) {
  const [accts, entries] = await Promise.all([B('/accounts'), B('/entries')]);
  const name = c => accts.find(a => a.code === c)?.name || c;
  const opts = accts.map(a => `<option value="${a.code}">${a.code} ${H.esc(a.name)}</option>`).join('');
  const types = ['asset', 'liability', 'equity', 'income', 'expense'];
  el.innerHTML = `<form class="card" id="je"><h2>New journal entry</h2><p class="mu" style="margin-top:0">Double entry: every entry's debits equal its credits. Tag entries (for example a project or a store) to report on them.</p>
    <div class="row"><label>Date<input name="date" type="date" value="${today()}"></label><label style="flex:2">Memo<input name="memo"></label><label style="flex:2">Tags<input name="tags" placeholder="project-a, store-2"></label></div>
    <div class="tablewrap"><table class="slim" id="jeLines"><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>${[0, 1].map(() => `<tr><td><select name="acc">${opts}</select></td><td><input name="dr" type="number" step="0.01" min="0" style="width:9em"></td><td><input name="cr" type="number" step="0.01" min="0" style="width:9em"></td></tr>`).join('')}</table></div>
    <button type="button" class="ghost small" id="jeAdd">+ Line</button> <span class="mu" id="jeSum"></span>
    <div><button>Post entry</button><div class="err"></div></div></form>
  <div class="card"><h2>Journal</h2><div class="tablewrap"><table class="slim"><tr><th>Date</th><th>Memo</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr>
    ${entries.slice(0, 200).map(e => e.lines.map((l, i) => `<tr class="${i ? 'sub' : ''}"><td>${i ? '' : H.esc(e.date)}</td><td>${i ? '' : H.esc(e.memo || '') + (e.tags?.length ? ' ' + e.tags.map(t => `<span class="pill">${H.esc(t)}</span>`).join(' ') : '') + ` <span class="mu small-print">${H.esc(e.source)}</span>`}</td><td>${H.esc(l.account)} ${H.esc(name(l.account))}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td><td>${!i && e.source === 'manual' ? `<button class="small ghost" data-del="${e.id}">Delete</button>` : ''}</td></tr>`).join('')).join('') || '<tr><td colspan="6" class="mu">No entries yet. Invoices, payments, payroll and bank lines add their own.</td></tr>'}</table></div></div>
  <div class="card"><h2>Chart of accounts</h2><div class="tablewrap"><table class="slim"><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Balance</th></tr>${accts.map(a => `<tr><td data-no-tr>${H.esc(a.code)}</td><td>${H.esc(a.name)}</td><td>${H.esc(a.type)}</td><td class="num">${money(a.balance)}</td></tr>`).join('')}</table></div>
    <form id="newAcc" class="row" style="align-items:flex-end"><label>Code<input name="code" placeholder="6450" style="width:7em"></label><label style="flex:2">Name<input name="name" placeholder="e.g. Insurance"></label><label>Type<select name="type">${types.map(t => `<option>${t}</option>`).join('')}</select></label><button>Add account</button><div class="err"></div></form></div>`;
  const f = H.$('#je', el), t = H.$('#jeLines', f);
  const sum = () => { const n = sel => H.$$(sel, t).reduce((s, i) => s + (+i.value || 0), 0), d = n('[name=dr]'), c = n('[name=cr]'); H.$('#jeSum', f).innerHTML = `Debits ${money(d)} · Credits ${money(c)} ${Math.abs(d - c) < 0.005 && d ? '<span class="pill pos">balanced</span>' : '<span class="pill warn">not balanced</span>'}`; };
  t.addEventListener('input', sum); sum();
  H.$('#jeAdd', f).onclick = () => t.insertAdjacentHTML('beforeend', `<tr><td><select name="acc">${opts}</select></td><td><input name="dr" type="number" step="0.01" min="0" style="width:9em"></td><td><input name="cr" type="number" step="0.01" min="0" style="width:9em"></td></tr>`);
  H.act(H.$('button:not([type])', f), async () => { const v = H.form(f); await B('/entries', { body: { date: v.date, memo: v.memo, tags: String(v.tags || '').split(','), lines: H.$$('tr', t).slice(1).map(tr => ({ account: tr.querySelector('[name=acc]').value, debit: tr.querySelector('[name=dr]').value, credit: tr.querySelector('[name=cr]').value })) } }); setTimeout(H.render, 600); return 'Posted'; });
  H.$$('[data-del]', el).forEach(b => (b.onclick = async () => { if (!confirm('Delete this entry?')) return; await B('/entries/' + b.dataset.del, { method: 'DELETE' }); H.render(); }));
  const na = H.$('#newAcc', el); H.act(H.$('button', na), async () => { await B('/accounts', { body: H.form(na) }); setTimeout(H.render, 500); return 'Added'; });
}

// ---------- bank lines and receipts ----------
async function bank(el) {
  const [lines, accts, rec, receipts] = await Promise.all([B('/bank'), B('/accounts'), B('/reconcile'), B('/receipts')]);
  const opts = sel => accts.filter(a => a.type === 'income' || a.type === 'expense').map(a => `<option value="${a.code}" ${a.code === sel ? 'selected' : ''}>${a.code} ${H.esc(a.name)}</option>`).join('');
  el.innerHTML = `<div class="card"><div class="stats">${tile('Bank lines', lines.length)}${tile('To review', rec.open, rec.open ? 'neg' : '')}${tile('Matched', rec.matched)}${tile('Posted', rec.posted)}${tile('Bank vs books', money(rec.difference), Math.abs(rec.difference) < 0.01 ? 'pos' : '', 'difference')}</div></div>
  <div class="grid">
    <form class="card" id="imp"><h2>Import bank or card lines</h2><p class="mu" style="margin-top:0">A CSV from your bank (Date, Description, Amount, or Debit and Credit). Each line is matched to the books when the same amount moved within 5 days, and the rest get a suggested category (rules, then the AI when set up).</p>
      <input type="file" name="file" accept=".csv,text/csv"><button>Import</button><div class="err"></div></form>
    <form class="card" id="rcp"><h2>Snap a receipt</h2><p class="mu" style="margin-top:0">Take a photo or upload it. The AI reads the vendor, date and total when an AI service is set up (Admin → Keys); otherwise type them. It is matched to the bank line of the same amount.</p>
      <input type="file" name="photo" accept="image/*" capture="environment"><div class="row"><label>Vendor<input name="vendor"></label><label>Total<input name="total" type="number" step="0.01"></label><label>Date<input name="date" type="date"></label></div><button>Save receipt</button><div class="err"></div><div id="rcpOut"></div></form>
  </div>
  <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Bank lines</h2>${lines.some(l => l.status === 'open' && l.suggested) ? '<button class="small" id="postAll">Post all suggested</button>' : ''}</div>
    <div class="tablewrap"><table class="slim"><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Category</th><th>Status</th><th></th></tr>
    ${lines.slice(0, 300).map(l => `<tr><td>${H.esc(l.date)}</td><td>${H.esc(l.description)}${l.receipt ? ' <span class="pill">receipt</span>' : ''}</td><td class="num ${H.cls(l.amount)}">${money(l.amount)}</td><td>${l.status === 'open' ? `<select data-cat="${l.id}"><option value="">Pick…</option>${opts(l.suggested)}</select>` : H.esc(l.suggested || '')}</td><td>${pill(l.status)}</td><td>${l.status === 'open' ? `<button class="small" data-post="${l.id}">Post</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No bank lines yet.</td></tr>'}</table></div><div class="err" id="bankErr"></div></div>
  <div class="card"><h2>Receipts</h2><div class="tablewrap"><table class="slim"><tr><th>Date</th><th>Vendor</th><th class="num">Total</th><th>Matched</th><th></th></tr>${receipts.map(r => `<tr><td>${H.esc(r.date)}</td><td>${H.esc(r.vendor)}${r.read ? ' <span class="pill">read by AI</span>' : ''}</td><td class="num">${money(r.total)}</td><td>${r.bank ? '<span class="pill pos">bank line</span>' : '<span class="mu">-</span>'}</td><td>${r.hasImage ? `<a href="/api/biz/receipts/${r.id}/image" target="_blank" rel="noopener">Photo</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No receipts yet.</td></tr>'}</table></div></div>`;
  const imp = H.$('#imp', el);
  H.act(H.$('button', imp), async () => { const file = imp.file.files[0]; if (!file) throw new Error('Pick the CSV file'); const r = await B('/bank/import', { body: { csv: await file.text() } }); setTimeout(H.render, 1200); return `${r.added} added, ${r.matched} matched to the books${r.skipped ? `, ${r.skipped} already here` : ''}`; });
  const rc = H.$('#rcp', el);
  H.act(H.$('button', rc), async () => {
    const file = rc.photo.files[0], v = H.form(rc);
    const image = file ? await shrink(file) : null;
    if (!image && !v.total) throw new Error('Add a photo or type the total');
    const r = await B('/receipts', { body: { image, vendor: v.vendor || undefined, total: v.total || undefined, date: v.date || undefined } });
    H.$('#rcpOut', rc).innerHTML = `<p class="ok">${H.esc(r.vendor || 'Receipt')} ${money(r.total)} on ${H.esc(r.date)}${r.aiRead ? ' (read by AI)' : ''}${r.matchedBank ? ` · matched to "${H.esc(r.matchedBank.description)}"` : ' · no bank line of that amount yet'}</p>`;
    setTimeout(H.render, 2500); return '';
  });
  const err = H.$('#bankErr', el);
  H.$$('[data-post]', el).forEach(b => (b.onclick = async () => { const sel = H.$(`[data-cat="${b.dataset.post}"]`, el); try { await B(`/bank/${b.dataset.post}/post`, { body: { account: sel?.value } }); H.render(); } catch (e) { err.textContent = e.message; } }));
  if (H.$('#postAll', el)) H.$('#postAll', el).onclick = async () => { try { const r = await B('/bank/post-suggested', { body: {} }); err.innerHTML = `<span class="ok">${r.posted} posted</span>`; setTimeout(H.render, 800); } catch (e) { err.textContent = e.message; } };
}
// Photos are made smaller (about 1600 px) before upload.
function shrink(file) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82)); };
    img.onerror = () => no(new Error('That photo could not be read'));
    img.src = url;
  });
}

// ---------- inventory ----------
async function inventory(el) {
  const items = await B('/items');
  el.innerHTML = `<div class="card"><div class="stats">${tile('Products', items.length)}${tile('Stock value', money(items.reduce((t, i) => t + i.value, 0)), '', 'at average cost')}${tile('To reorder', items.filter(i => i.reorder).length, items.some(i => i.reorder) ? 'neg' : '')}</div></div>
  <form class="card" id="newItem"><h2>New product</h2><div class="row"><label style="flex:2">Name<input name="name" required></label><label>Variant<input name="variant" placeholder="size, color"></label><label>SKU<input name="sku" data-no-tr></label><label>Price<input name="price" type="number" step="0.01"></label><label>Reorder at<input name="reorderPoint" type="number" step="any" min="0"></label></div><button>Add product</button><div class="err"></div></form>
  <div class="card"><h2>Stock</h2><div class="tablewrap"><table><tr><th>Product</th><th>SKU</th><th class="num">In stock</th><th class="num">Avg cost</th><th class="num">Value</th><th class="num">Price</th><th></th></tr>
    ${items.map(i => `<tr><td><b>${H.esc(i.name)}</b>${i.variant ? ` <span class="mu">${H.esc(i.variant)}</span>` : ''}${i.reorder ? ' <span class="pill neg">reorder</span>' : ''}</td><td data-no-tr>${H.esc(i.sku || '')}</td><td class="num">${i.qty}</td><td class="num">${money(i.avgCost)}</td><td class="num">${money(i.value)}</td><td class="num">${money(i.price)}</td>
      <td class="nowrap"><button class="small" data-recv="${i.id}">Stock in</button> <button class="small ghost" data-count="${i.id}" data-qty="${i.qty}">Count</button></td></tr>`).join('') || '<tr><td colspan="7" class="mu">No products yet. Products sold on an invoice come out of stock, and their cost goes to cost of goods sold.</td></tr>'}</table></div><div class="err" id="invtErr"></div></div>`;
  const f = H.$('#newItem', el); H.act(H.$('button', f), async () => { await B('/items', { body: H.form(f) }); setTimeout(H.render, 500); return 'Added'; });
  const err = H.$('#invtErr', el);
  H.$$('[data-recv]', el).forEach(b => (b.onclick = async () => { const q = prompt('How many came in?'); if (!q) return; const c = prompt('Cost of each'); if (c == null) return; try { await B(`/items/${b.dataset.recv}/receive`, { body: { qty: +q, unitCost: +c, onAccount: confirm('Bought on account (pay later)? OK = on account, Cancel = paid now') } }); H.render(); } catch (e) { err.textContent = e.message; } }));
  H.$$('[data-count]', el).forEach(b => (b.onclick = async () => { const q = prompt('Counted quantity', b.dataset.qty); if (q == null) return; try { await B(`/items/${b.dataset.count}/count`, { body: { qty: +q } }); H.render(); } catch (e) { err.textContent = e.message; } }));
}

// ---------- payroll ----------
async function payroll(el) {
  const [emps, runs, w2] = await Promise.all([B('/employees'), B('/payruns'), B('/w2')]);
  const active = emps.filter(e => e.active !== false);
  el.innerHTML = `<div class="banner">Payroll here works out each paycheck (federal withholding from the IRS brackets, Social Security, Medicare, state), records it in the books, and makes the direct-deposit file (NACHA) for your bank and the pay stubs. You still file and pay payroll taxes (Form 941, 940, W-2) yourself or through your accountant. Estimates; check them with a payroll adviser.</div>
  <form class="card" id="run"><h2>Run payroll</h2>${active.length ? `<div class="row"><label>Pay date<input name="payDate" type="date" value="${today()}"></label><label style="flex:2">Period<input name="period" placeholder="e.g. Nov 1-14"></label></div>
    <div class="tablewrap"><table class="slim"><tr><th>Employee</th><th>Pay</th><th class="num">Hours</th><th class="num">Overtime</th><th class="num">Bonus</th></tr>${active.map(e => `<tr data-emp="${e.id}"><td>${H.esc(e.name)}${e.hasBank ? ' <span class="pill">direct deposit ··' + H.esc(e.bankLast4) + '</span>' : ''}</td><td>${e.payType === 'hourly' ? money(e.rate) + '/hour' : money(e.rate) + '/year'} · ${H.esc(e.frequency)}</td><td>${e.payType === 'hourly' ? '<input name="hours" type="number" step="any" min="0" style="width:6em">' : '-'}</td><td>${e.payType === 'hourly' ? '<input name="overtime" type="number" step="any" min="0" style="width:6em">' : '-'}</td><td><input name="bonus" type="number" step="any" min="0" style="width:7em"></td></tr>`).join('')}</table></div>
    <button type="button" id="pvRun" class="ghost">Work out paychecks</button> <button type="button" id="goRun">Record payroll</button><div class="err"></div><div id="runOut"></div>` : '<p class="mu">Add an employee below first.</p>'}</form>
  <form class="card" id="newEmp"><h2>Add an employee</h2>
    <div class="row"><label style="flex:2">Name<input name="name" required></label><label style="flex:2">Email<input name="email" type="email"></label></div>
    <div class="row"><label>Pay<select name="payType"><option value="salary">Salary (yearly)</option><option value="hourly">Hourly</option></select></label><label>Amount<input name="rate" type="number" step="0.01" required placeholder="65000 or 25"></label><label>Paid<select name="frequency"><option value="weekly">Every week</option><option value="biweekly" selected>Every 2 weeks</option><option value="semimonthly">Twice a month</option><option value="monthly">Monthly</option></select></label><label>Filing (W-4)<select name="filing"><option value="single">Single</option><option value="mfj">Married filing jointly</option><option value="hoh">Head of household</option></select></label></div>
    <div class="row"><label>Extra federal withholding per check<input name="extraWithholding" type="number" step="0.01" min="0"></label><label>State tax %<input name="stateRate" type="number" step="0.01" min="0"></label><label>Your state unemployment rate %<input name="sutaRate" type="number" step="0.01" min="0"></label></div>
    <details><summary>Direct deposit</summary><div class="row"><label>Routing number<input name="routing" inputmode="numeric" autocomplete="off" data-no-tr></label><label>Account number<input name="account" inputmode="numeric" autocomplete="off" data-no-tr></label><label>Type<select name="accountType"><option value="checking">Checking</option><option value="savings">Savings</option></select></label></div><p class="mu small-print">Stored encrypted; only the last 4 digits are shown.</p></details>
    <button>Add employee</button><div class="err"></div></form>
  <div class="card"><h2>Pay runs</h2><div class="tablewrap"><table class="slim"><tr><th>Pay date</th><th>Period</th><th class="num">Gross</th><th class="num">Net</th><th class="num">Employer taxes</th><th></th></tr>${runs.map(r => `<tr><td>${H.esc(r.payDate)}</td><td>${H.esc(r.period || '')}</td><td class="num">${money(r.totals.gross)}</td><td class="num">${money(r.totals.net)}</td><td class="num">${money(r.totals.employer)}</td><td class="nowrap"><a href="/api/biz/payruns/${r.id}/ach"><button type="button" class="small ghost">Direct-deposit file</button></a> ${r.stubs.map(st => `<a href="/api/biz/payruns/${r.id}/stub/${st.employee}.pdf"><button type="button" class="small ghost">Stub: ${H.esc(st.name)}</button></a>`).join(' ')}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No pay runs yet.</td></tr>'}</table></div></div>
  <div class="card"><h2>W-2 totals ${w2.year}</h2><div class="tablewrap"><table class="slim"><tr><th>Employee</th><th class="num">Wages (box 1)</th><th class="num">Federal withheld (2)</th><th class="num">SS wages (3)</th><th class="num">SS tax (4)</th><th class="num">Medicare tax (6)</th><th class="num">State tax (17)</th></tr>${w2.employees.map(e => `<tr><td>${H.esc(e.name)}</td><td class="num">${money(e.wages)}</td><td class="num">${money(e.federalWithheld)}</td><td class="num">${money(e.ssWages)}</td><td class="num">${money(e.ssTax)}</td><td class="num">${money(e.medicareTax)}</td><td class="num">${money(e.stateTax)}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">No payroll recorded this year.</td></tr>'}</table></div><p class="mu small-print">For filing W-2s (SSA Business Services Online) and your year-end forms.</p></div>`;
  const ne = H.$('#newEmp', el); H.act(H.$('button:not([type])', ne), async () => { await B('/employees', { body: H.form(ne) }); setTimeout(H.render, 500); return 'Added'; });
  const run = H.$('#run', el); if (!H.$('#pvRun', run)) return;
  const body = () => { const v = H.form(run); return { payDate: v.payDate, period: v.period, hours: Object.fromEntries(H.$$('tr[data-emp]', run).map(tr => [tr.dataset.emp, { hours: tr.querySelector('[name=hours]')?.value, overtime: tr.querySelector('[name=overtime]')?.value, bonus: tr.querySelector('[name=bonus]')?.value }])) }; };
  const show = r => `<div class="tablewrap"><table class="slim"><tr><th>Employee</th><th class="num">Gross</th><th class="num">Federal</th><th class="num">Soc. Sec.</th><th class="num">Medicare</th><th class="num">State</th><th class="num">Net pay</th><th class="num">Employer taxes</th></tr>${r.stubs.map(s => `<tr><td>${H.esc(s.name)}</td><td class="num">${money(s.gross)}</td><td class="num">${money(s.federal)}</td><td class="num">${money(s.ss)}</td><td class="num">${money(s.medicare)}</td><td class="num">${money(s.state)}</td><td class="num"><b>${money(s.net)}</b></td><td class="num">${money(s.employer.total)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="num"><b>${money(r.totals.gross)}</b></td><td colspan="4"></td><td class="num"><b>${money(r.totals.net)}</b></td><td class="num"><b>${money(r.totals.employer)}</b></td></tr></table></div>`;
  const out = H.$('#runOut', run), err = H.$('.err', run);
  H.$('#pvRun', run).onclick = async () => { err.textContent = ''; try { out.innerHTML = show(await B('/payruns', { body: body() })); } catch (e) { err.textContent = e.message; } };
  H.$('#goRun', run).onclick = async () => {
    err.textContent = '';
    try {
      const pv = await B('/payruns', { body: body() });
      const c = await H.secureConfirm({ title: `Record payroll of ${money(pv.totals.gross)}?`, html: show(pv) + '<p class="mu">It goes into the books; then download the direct-deposit file for your bank.</p>', okText: 'Record payroll' });
      if (!c) return;
      await B('/payruns', { body: { ...body(), commit: true, password: c.password, confirm: c.confirm } }); H.render();
    } catch (e) { err.textContent = e.message; }
  };
}

// ---------- reports ----------
async function reports(el) {
  const y = today().slice(0, 4);
  el.innerHTML = `<form class="card row" id="rp" style="align-items:flex-end"><label>From<input name="from" type="date" value="${y}-01-01"></label><label>To<input name="to" type="date" value="${today()}"></label><button>Show</button> <a href="/api/biz/reports.pdf"><button type="button" class="ghost">Download PDF</button></a></form><div id="rpOut"><p class="mu">Loading…</p></div>`;
  const f = H.$('#rp', el), out = H.$('#rpOut', el);
  const row = a => `<tr><td>${H.esc(a.code)} ${H.esc(a.name)}</td><td class="num">${money(a.balance)}</td></tr>`;
  const draw = async () => {
    const v = H.form(f), r = await B(`/reports?from=${v.from}&to=${v.to}`), p = r.pnl, b = r.balance;
    out.innerHTML = `<div class="card"><div class="stats">${tile('Income', money(p.totalIncome))}${tile('Expenses', money(p.totalExpenses))}${tile('Gross profit', money(p.grossProfit))}${tile('Net profit', money(p.net), H.cls(p.net), p.margin == null ? '' : `margin ${p.margin}%`)}</div></div>
    <div class="grid"><div class="card"><h2>Profit and loss</h2><table class="slim">${p.income.map(row).join('')}<tr><td><b>Total income</b></td><td class="num"><b>${money(p.totalIncome)}</b></td></tr>${p.expenses.map(row).join('')}<tr><td><b>Total expenses</b></td><td class="num"><b>${money(p.totalExpenses)}</b></td></tr><tr><td><b>Net profit</b></td><td class="num"><b class="${H.cls(p.net)}">${money(p.net)}</b></td></tr></table></div>
    <div class="card"><h2>Balance sheet <span class="pill ${b.balanced ? 'pos' : 'neg'}">${b.balanced ? 'balances' : 'does not balance'}</span></h2><table class="slim">${b.assets.map(row).join('')}<tr><td><b>Total assets</b></td><td class="num"><b>${money(b.totalAssets)}</b></td></tr>${b.liabilities.map(row).join('')}<tr><td><b>Total liabilities</b></td><td class="num"><b>${money(b.totalLiabilities)}</b></td></tr>${b.equity.map(row).join('')}<tr><td>Earnings to date</td><td class="num">${money(b.earnings)}</td></tr><tr><td><b>Total equity</b></td><td class="num"><b>${money(b.totalEquity)}</b></td></tr></table></div></div>
    <div class="card"><h2>Cash flow by month</h2><div class="tablewrap"><table class="slim"><tr><th>Month</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th></tr>${r.cashFlow.months.map(m => `<tr><td>${m.month}</td><td class="num">${money(m.in)}</td><td class="num">${money(m.out)}</td><td class="num ${H.cls(m.net)}">${money(m.net)}</td></tr>`).join('')}${r.cashFlow.forecast.map(m => `<tr class="dim"><td>${m.month} (forecast)</td><td colspan="2" class="mu small-print">average of the last 3 months${m.fromInvoices ? ` + ${money(m.fromInvoices)} invoices due` : ''}</td><td class="num ${H.cls(m.net)}">${money(m.net)}</td></tr>`).join('')}</table></div></div>
    ${r.byTag.length ? `<div class="card"><h2>By tag</h2><table class="slim">${r.byTag.map(t => `<tr><td><span class="pill">${H.esc(t.tag)}</span></td><td class="num">${money(t.total)}</td></tr>`).join('')}</table></div>` : ''}
    <div class="card"><h2>Trial balance</h2><div class="tablewrap"><table class="slim"><tr><th>Account</th><th class="num">Debits</th><th class="num">Credits</th></tr>${r.trial.map(a => `<tr><td>${H.esc(a.code)} ${H.esc(a.name)}</td><td class="num">${money(a.debit)}</td><td class="num">${money(a.credit)}</td></tr>`).join('')}</table></div></div>`;
  };
  f.onsubmit = e => { e.preventDefault(); draw().catch(x => (out.innerHTML = `<p class="err">${H.esc(x.message)}</p>`)); };
  await draw();
}

// ---------- settings ----------
async function settings(el, s) {
  el.innerHTML = `<form class="card" id="bs"><h2>Business settings</h2>
    <div class="row"><label style="flex:2">Business name<input name="name" value="${H.esc(s.name)}"></label><label style="flex:2">Email on invoices<input name="email" type="email" value="${H.esc(s.email)}"></label></div>
    <label>Address<textarea name="address">${H.esc(s.address)}</textarea></label>
    <div class="row"><label>Currency of the books<select name="currency">${s.currencies.map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>Invoice prefix<input name="invoicePrefix" value="${H.esc(s.invoicePrefix)}"></label><label>Next number<input name="nextNumber" type="number" min="1" value="${s.nextNumber}"></label><label>Days to pay<input name="paymentTerms" type="number" min="0" max="120" value="${s.paymentTerms}"></label></div>
    <h3>Card payments on invoices</h3><p class="mu" style="margin-top:0">Your own Stripe account: payments go straight to you. ${s.hasStripe ? '<span class="pill pos">connected</span>' : ''}</p>
    <label>Stripe secret key<input name="stripeKey" type="password" autocomplete="off" placeholder="${s.hasStripe ? '(saved; type a new one to replace it)' : 'sk_live_…'}" data-no-tr></label>
    <h3>Direct deposit (payroll)</h3><div class="row"><label>Your bank's routing number<input name="odfiRouting" value="${H.esc(s.ach?.odfiRouting || '')}" inputmode="numeric" data-no-tr></label><label>Company ID for ACH<input name="companyId" value="${H.esc(s.ach?.companyId || '')}" placeholder="1 + your EIN" data-no-tr></label><label>Bank name<input name="bankName" value="${H.esc(s.ach?.bankName || '')}"></label></div>
    <button>Save</button><div class="err"></div></form>`;
  const f = H.$('#bs', el);
  H.act(H.$('button', f), async () => { const v = H.form(f); await B('/settings', { method: 'PUT', body: { ...v, ach: { odfiRouting: v.odfiRouting, companyId: v.companyId, bankName: v.bankName }, stripeKey: v.stripeKey || undefined } }); return 'Saved'; });
}
