// Admin → Trust: what the public security and insurance pages show (audit stage, insurance, security
// contact) and the incidents on the public status page. Admin pages stay in English.
let H;
export function registerTrustAdmin(routes, helpers) { H = helpers; routes['admin-trust'] = (view, q) => (H.me()?.role === 'admin' ? page(view, q) : (location.hash = '#/dashboard')); }

async function page(view) {
  const [d, st] = await Promise.all([H.api('/admin/trust'), H.api('/public/status')]);
  const s = d.soc2, ins = [...d.raw.insurance || [], {}, {}].slice(0, Math.max(2, (d.raw.insurance || []).length + 1));
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-trust')}
  <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Status page</h2><a href="/status" target="_blank" rel="noopener"><button class="small ghost">Open /status</button></a></div>
    <p class="mu">The app checks itself every 5 minutes. Right now: <b>${H.esc(st.overall)}</b>. ${st.components.map(c => `${H.esc(c.name)} ${c.uptime == null ? '-' : c.uptime + '%'}`).join(' · ')}</p>
    <h3>Post an incident</h3>
    <form id="inc"><label>What is happening<input name="title" maxlength="140" placeholder="Orders are slow to reach the broker"></label>
      <div class="row"><label>Impact<select name="impact">${d.impacts.map(x => `<option>${x}</option>`).join('')}</select></label><label>Status<select name="status">${d.statuses.map(x => `<option>${x}</option>`).join('')}</select></label></div>
      <div class="row" style="flex-wrap:wrap;gap:6px 18px">${Object.entries(d.components).map(([k, n]) => `<label class="chk"><input type="checkbox" name="comp" value="${k}"> ${H.esc(n)}</label>`).join('')}</div>
      <label>First update (shown publicly)<textarea name="text" maxlength="2000"></textarea></label><button>Post incident</button><div class="err"></div></form>
    ${d.incidents.map(i => `<div class="approvebox" style="margin-top:12px" data-inc="${i.id}"><b>${H.esc(i.title)}</b> <span class="mu">${H.esc(i.impact)} · ${H.esc(i.status)} · ${H.date(i.startedAt)}</span>
      ${i.updates.map(u => `<p style="margin:6px 0"><b>${H.esc(u.status)}</b> <span class="mu">${H.date(u.t)}</span> ${H.esc(u.text)}</p>`).join('')}
      <div class="row"><label>Status<select name="status">${d.statuses.map(x => `<option ${x === i.status ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label style="flex:3">Update<input name="text" maxlength="2000"></label></div>
      <div class="row" style="gap:8px"><button class="small" data-upd="${i.id}">Post update</button><button class="small ghost danger-t" data-delinc="${i.id}">Delete</button></div><div class="err"></div></div>`).join('')}</div>
  <form class="card" id="tr"><h2>Security and insurance pages</h2>
    <p class="mu">Only what you enter here is shown. Never pick an audit stage that has not happened: the public page says "Not audited yet" until you do.</p>
    <h3>SOC 2</h3><div class="row"><label>Stage<select name="stage">${Object.entries(d.stages).map(([k, n]) => `<option value="${k}" ${k === s.stage ? 'selected' : ''}>${H.esc(n)}</option>`).join('')}</select></label><label>Audit firm<input name="auditor" value="${H.esc(s.auditor)}"></label></div>
    <div class="row"><label>Period covered<input name="period" value="${H.esc(s.period)}" placeholder="Jan 1 to Jun 30, 2027"></label><label>Report date<input name="reportDate" type="date" value="${H.esc(s.reportDate)}"></label></div>
    <label>Note<input name="note" maxlength="400" value="${H.esc(s.note)}"></label>
    <div class="row"><label>Security contact email<input name="securityContact" type="email" value="${H.esc(d.securityContact)}"></label><label>Latest penetration test<input name="lastPenTest" value="${H.esc(d.lastPenTest)}" placeholder="March 2027, by …"></label></div>
    <h3>Company insurance</h3><p class="mu">For example cyber liability or errors &amp; omissions. Leave empty if there is none.</p>
    <div id="insRows">${ins.map(i => `<div class="row insrow"><label>Cover<input data-k="kind" value="${H.esc(i.kind || '')}" placeholder="Cyber liability"></label><label>Insurer<input data-k="carrier" value="${H.esc(i.carrier || '')}"></label><label>Limit<input data-k="limit" value="${H.esc(i.limit || '')}" placeholder="$1,000,000"></label><label style="flex:2">Note<input data-k="note" value="${H.esc(i.note || '')}"></label></div>`).join('')}</div>
    <button id="saveTrust">Save</button><div class="err"></div></form>`;

  const inc = H.$('#inc', view);
  H.act(H.$('button', inc), async () => { const v = H.form(inc); await H.api('/admin/trust/incidents', { body: { ...v, components: H.$$('[name=comp]:checked', inc).map(c => c.value) } }); H.render(); return ''; });
  H.$$('[data-upd]', view).forEach(b => H.act(b, async () => { const box = b.closest('[data-inc]'); await H.api(`/admin/trust/incidents/${b.dataset.upd}/update`, { body: { status: H.$('[name=status]', box).value, text: H.$('[name=text]', box).value } }); H.render(); return ''; }));
  H.$$('[data-delinc]', view).forEach(b => H.act(b, async () => { if (!confirm('Delete this incident from the status page?')) return ''; await H.api('/admin/trust/incidents/' + b.dataset.delinc, { method: 'DELETE' }); H.render(); return ''; }));
  const f = H.$('#tr', view);
  H.act(H.$('#saveTrust', view), async () => {
    const v = H.form(f);
    const insurance = H.$$('.insrow', f).map(r => Object.fromEntries(H.$$('[data-k]', r).map(i => [i.dataset.k, i.value])));
    await H.api('/admin/trust', { method: 'PUT', body: { soc2: { stage: v.stage, auditor: v.auditor, period: v.period, reportDate: v.reportDate, note: v.note }, securityContact: v.securityContact, lastPenTest: v.lastPenTest, insurance } });
    H.render(); return 'Saved';
  });
}
