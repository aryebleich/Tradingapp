// Live data on the Real estate and Private markets pages (add-ons): home value and rent estimates,
// a cap table for each private company, and K-1 forms from private funds.
const offNote = (what, e) => (e?.addonOff ? '' : `<div class="card"><h2>${what}</h2><p class="err">${e.message}</p></div>`);

export async function propertyExtras(box, a, H) {
  let d;
  try { d = await H.api('/altlive/estimate/' + a.id); } catch (e) { box.insertAdjacentHTML('beforeend', offNote('Live value', e)); return; }
  const e = d.estimate, el = document.createElement('div'); el.className = 'card';
  el.innerHTML = `<h2>Live value and rent</h2>
    ${!d.enabled ? '<p class="mu">Automatic home values are not set up on this server yet (the owner adds a RentCast key in Admin → Keys).</p>' : e
      ? `<div class="stats"><div class="stat"><span>Estimated value</span><b>${H.money(e.value)}</b></div><div class="stat"><span>Range</span><b style="font-size:15px">${H.money(e.valueLow)} – ${H.money(e.valueHigh)}</b></div>${e.rent ? `<div class="stat"><span>Estimated rent a month</span><b>${H.money(e.rent)}</b></div>` : ''}<div class="stat"><span>You entered</span><b>${H.money(a.value)}</b></div></div>
        <p class="mu small-print">From RentCast on ${new Date(e.at).toLocaleDateString()}, based on nearby sales and rentals. An estimate, not an appraisal.</p>
        <label class="check"><input type="checkbox" id="estAuto" ${e.auto ? 'checked' : ''}> Update every month</label>
        <label class="check"><input type="checkbox" id="estApply" ${e.apply ? 'checked' : ''}> Use the estimate as this property's value${a.type === 'home' ? '' : ' and rent'}</label>`
      : `<p class="mu">Get today's estimated value and rent for ${a.address ? `<b>${H.esc(a.address)}</b>` : 'this property (add its full address above first)'}.</p>`}
    ${d.enabled ? `<button class="small" id="estGo">${e ? 'Update now' : 'Get the estimate'}</button>` : ''}<div class="err"></div>`;
  box.append(el);
  if (H.$('#estGo', el)) H.act(H.$('#estGo', el), async () => { await H.api('/altlive/estimate/' + a.id, { body: {} }); H.render(); return ''; });
  const flags = () => H.api('/altlive/estimate/' + a.id, { method: 'PUT', body: { auto: H.$('#estAuto', el).checked, apply: H.$('#estApply', el).checked } }).then(() => H.$('#estApply', el).checked && H.render());
  if (H.$('#estAuto', el)) { H.$('#estAuto', el).onchange = flags; H.$('#estApply', el).onchange = flags; }
}

export async function privateExtras(box, a, H) {
  // Cap table.
  try {
    const d = await H.api('/altlive/cap/' + a.id), c = d.cap, s = d.stats, el = document.createElement('form'); el.className = 'card'; el.id = 'capf';
    let rounds = c.rounds.length ? c.rounds : [{ date: '', name: 'Seed', price: '', raised: '', preMoney: '', sharesAfter: '', myNewShares: '' }];
    const draw = () => {
      el.innerHTML = `<h2>Cap table</h2><p class="mu" style="margin-top:0">Your shares, each funding round, and your ownership after every round. The latest share price gives what your stake is worth on paper.</p>
        ${s.lastPrice ? `<div class="stats"><div class="stat"><span>Your ownership</span><b>${s.ownership == null ? '-' : s.ownership.toFixed(3) + '%'}</b></div><div class="stat"><span>Latest price a share</span><b>${H.money(s.lastPrice)}</b></div><div class="stat"><span>Your stake on paper</span><b>${H.money(s.impliedValue)}</b></div></div>` : ''}
        <div class="row"><label>Share class<input name="shareClass" value="${H.esc(c.shareClass)}" placeholder="Common, Series A preferred…"></label><label>Your shares (total)<input name="myShares" type="number" min="0" step="any" value="${c.myShares || ''}"></label><label>Your options<input name="options" type="number" min="0" step="any" value="${c.options || ''}"></label><label>Option strike ($)<input name="strike" type="number" min="0" step="any" value="${c.strike ?? ''}"></label></div>
        <div class="tablewrap"><table class="slim captab"><tr><th>Date</th><th>Round</th><th>Price a share ($)</th><th>Raised ($)</th><th>Pre-money ($)</th><th>All shares after</th><th>Shares you bought</th><th></th></tr>
          ${rounds.map((r, i) => `<tr data-i="${i}"><td><input type="date" data-k="date" value="${r.date || ''}"></td><td><input data-k="name" value="${H.esc(r.name || '')}"></td>${['price', 'raised', 'preMoney', 'sharesAfter', 'myNewShares'].map(k => `<td><input type="number" min="0" step="any" data-k="${k}" value="${r[k] ?? ''}"></td>`).join('')}<td><button type="button" class="small ghost" data-rm="${i}">✕</button></td></tr>`).join('')}</table></div>
        <button type="button" class="small ghost" id="addR">Add a round</button>
        ${s.rounds.some(r => r.ownership != null) ? `<p class="mu">Ownership after each round: ${s.rounds.map(r => `${H.esc(r.name)} ${r.ownership == null ? '-' : r.ownership.toFixed(3) + '%'}`).join(' → ')}</p>` : ''}
        <div class="row" style="gap:8px;margin-top:10px"><button id="capSave">Save cap table</button>${s.impliedValue ? `<button type="button" class="ghost" id="capUse">Use ${H.money(s.impliedValue)} as the value now</button>` : ''}</div><div class="err"></div>`;
      H.$$('[data-k]', el).forEach(inp => (inp.oninput = () => { const r = rounds[+inp.closest('tr').dataset.i]; r[inp.dataset.k] = inp.value; }));
      H.$$('[data-rm]', el).forEach(b => (b.onclick = () => { rounds.splice(+b.dataset.rm, 1); draw(); }));
      H.$('#addR', el).onclick = () => { rounds.push({ date: '', name: '', price: '', raised: '', preMoney: '', sharesAfter: '', myNewShares: '' }); draw(); };
      H.act(H.$('#capSave', el), async () => { const v = H.form(el); await H.api('/altlive/cap/' + a.id, { method: 'PUT', body: { shareClass: v.shareClass, myShares: v.myShares, options: v.options, strike: v.strike, rounds } }); H.render(); return ''; });
      if (H.$('#capUse', el)) H.act(H.$('#capUse', el), async () => { await H.api(`/altlive/cap/${a.id}/use-value`, { body: {} }); H.render(); return ''; });
    };
    draw(); box.append(el);
  } catch (e) { box.insertAdjacentHTML('beforeend', offNote('Cap table', e)); }
  // K-1 for this holding.
  try {
    const year = new Date().getFullYear() - 1, d = await H.api('/altlive/k1?year=' + year), row = d.rows.find(r => r.assetId === a.id), f = row?.form;
    const el = document.createElement('form'); el.className = 'card'; el.id = 'k1f';
    el.innerHTML = `<h2>K-1 for ${year}</h2><p class="mu" style="margin-top:0">Partnerships and funds send a Schedule K-1 each year (often late, from March to September). Record it here with the PDF; your tax preparer can have the CSV.</p>
      <div class="row"><label>Tax year<select name="year">${[0, 1, 2, 3].map(i => `<option ${i === 0 ? 'selected' : ''}>${year - i}</option>`).join('')}</select></label><label>Status<select name="status"><option value="received" ${f?.status === 'received' ? 'selected' : ''}>Received</option><option value="expected" ${f?.status !== 'received' ? 'selected' : ''}>Still waiting</option></select></label><label>PDF<input type="file" name="pdf" accept="application/pdf"></label></div>
      <div class="k1grid">${Object.entries(d.boxes).map(([k, n]) => `<label>Box ${k}: ${H.esc(n)}<input type="number" step="any" data-box="${k}" value="${f?.boxes[k] ?? ''}"></label>`).join('')}</div>
      ${f?.hasFile ? `<p><a href="/api/altlive/k1/${a.id}/${year}/file" target="_blank" rel="noopener">Open the K-1 PDF</a></p>` : ''}
      <button>Save K-1</button><div class="err"></div>`;
    box.append(el);
    H.act(H.$('button', el), async () => {
      const v = H.form(el), file = el.pdf.files[0];
      const data = file ? await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(file); }) : null;
      await H.api(`/altlive/k1/${a.id}/${v.year}`, { method: 'PUT', body: { status: v.status, boxes: Object.fromEntries(H.$$('[data-box]', el).map(i => [i.dataset.box, i.value])), ...(data ? { file: data, fileName: file.name } : {}) } });
      return 'Saved';
    });
  } catch (e) { box.insertAdjacentHTML('beforeend', offNote('K-1', e)); }
}

// K-1s for a tax year, on the Private markets page.
export async function k1Overview(box, H) {
  let d;
  try { d = await H.api('/altlive/k1'); } catch { return; }
  if (!d.rows.length) return;
  box.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">K-1 forms for ${d.year}</h2><a href="/api/altlive/k1.csv?year=${d.year}" download><button class="small ghost">CSV for your tax preparer</button></a></div>
    <p class="mu">${d.received} of ${d.rows.length} received${d.missing.length ? `; still waiting for ${d.missing.map(H.esc).join(', ')}. You get a reminder on the 1st of each month until they arrive.` : '.'}</p>
    <div class="tablewrap"><table class="slim"><tr><th>Fund</th><th>Status</th><th>Ordinary income</th><th>Rental</th><th>Long-term gain</th><th>Distributions</th></tr>${d.rows.map(r => `<tr><td>${H.esc(r.name)}</td><td>${r.form?.status === 'received' ? '✓ received' : '<span class="mu">waiting</span>'}</td><td>${r.form?.boxes[1] != null ? H.money(r.form.boxes[1]) : '-'}</td><td>${r.form?.boxes[2] != null ? H.money(r.form.boxes[2]) : '-'}</td><td>${r.form?.boxes['9a'] != null ? H.money(r.form.boxes['9a']) : '-'}</td><td>${r.form?.boxes[19] != null ? H.money(r.form.boxes[19]) : '-'}</td></tr>`).join('')}</table></div></div>`;
}
