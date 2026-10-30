// Fills the public status, security and insurance pages with live data from /api/public.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const get = p => fetch((window.QP?.api || '') + '/api/public' + p).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
const STATE = { ok: ['All good', 'ok'], degraded: ['Slower than usual', 'warn'], maintenance: ['Maintenance', 'warn'], down: ['Not working', 'bad'] };
const OVERALL = { ok: 'Everything is working', degraded: 'Some parts are slower than usual', maintenance: 'Scheduled maintenance', down: 'Some parts are not working' };
const when = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function status(el) {
  const d = await get('/status');
  el.innerHTML = `<div class="st-banner ${STATE[d.overall][1]}"><b>${OVERALL[d.overall]}</b></div>
  ${d.incidents.filter(i => i.status !== 'resolved').map(incident).join('')}
  <div class="st-list">${d.components.map(c => `<div class="st-comp"><div class="st-head"><b>${esc(c.name)}</b><span class="st-pill ${STATE[c.state][1]}">${STATE[c.state][0]}</span></div>
    <div class="st-days" aria-label="Last 90 days">${c.days.map((v, i) => `<i class="${v == null ? 'none' : v >= 99.5 ? 'ok' : v >= 95 ? 'warn' : 'bad'}" title="${v == null ? 'No checks' : v + '% of checks passed'}"></i>`).join('')}</div>
    <div class="st-foot mu"><span>90 days ago</span><span>${c.uptime == null ? 'No checks yet' : c.uptime + '% uptime'}</span><span>Today</span></div></div>`).join('')}</div>
  <h2>Past 14 days</h2>${d.incidents.filter(i => i.status === 'resolved').map(incident).join('') || '<p class="mu">No incidents.</p>'}
  <p class="mu">Checked every ${d.checkedEveryMinutes} minutes while the service is running.</p>`;
}
const incident = i => `<div class="st-inc ${i.impact}"><b>${esc(i.title)}</b> <span class="mu">${esc(i.status)} · started ${when(i.startedAt)}${i.resolvedAt ? ' · resolved ' + when(i.resolvedAt) : ''}</span>
  ${[...i.updates].reverse().map(u => `<p><b style="text-transform:capitalize">${esc(u.status)}</b> <span class="mu">${when(u.t)}</span><br>${esc(u.text)}</p>`).join('')}</div>`;

async function trust() {
  const d = await get('/trust');
  const soc = document.querySelector('[data-trust=soc2]');
  if (soc) {
    const s = d.soc2;
    soc.innerHTML = `<div class="st-banner ${s.stage === 'none' ? 'none' : s.requestable ? 'ok' : 'warn'}"><b>${esc(s.label)}</b></div>
    ${s.stage === 'none' ? '<p>Brightfolio has not had a SOC 2 audit yet. We will show the auditor and the report date here once one is done, and never before.</p>' : ''}
    ${s.auditor ? `<p>Auditor: <b>${esc(s.auditor)}</b></p>` : ''}${s.period ? `<p>Period covered: ${esc(s.period)}</p>` : ''}${s.reportDate ? `<p>Report date: ${esc(s.reportDate)}</p>` : ''}
    ${s.note ? `<p>${esc(s.note)}</p>` : ''}${s.requestable ? '<p>Customers and partners can ask for the report (under a confidentiality agreement) on the <a href="contact.html">contact page</a>.</p>' : ''}`;
  }
  const pen = document.querySelector('[data-trust=pentest]');
  if (pen && d.lastPenTest) pen.innerHTML = `<h2>Outside testing</h2><p>Latest independent penetration test: ${esc(d.lastPenTest)}.</p>`;
  const c = document.querySelector('[data-trust=contact]');
  if (c && d.securityContact) c.innerHTML = `, or write to <a href="mailto:${esc(d.securityContact)}">${esc(d.securityContact)}</a>`;
  const ins = document.querySelector('[data-trust=insurance]');
  if (ins) ins.innerHTML = d.insurance.length
    ? `<table class="st-table"><tr><th>Cover</th><th>Insurer</th><th>Limit</th></tr>${d.insurance.map(i => `<tr><td>${esc(i.kind)}${i.note ? `<br><span class="mu">${esc(i.note)}</span>` : ''}</td><td>${esc(i.carrier || '-')}</td><td>${esc(i.limit)}</td></tr>`).join('')}</table><p class="mu">These policies protect Brightfolio as a company (for example against a cyber incident). They do not insure your investments against market losses.</p>`
    : '<p>Brightfolio does not list any company insurance policies yet. Your protection comes from your broker and bank, above.</p>';
}

const st = document.querySelector('[data-trust=status]');
if (st) { const go = () => status(st).catch(() => { st.innerHTML = '<div class="st-banner bad"><b>The service did not answer.</b></div><p>It may be starting up (this can take up to a minute) or down. Refresh in a moment.</p>'; }); go(); setInterval(go, 60e3); }
if (document.querySelector('[data-trust=soc2],[data-trust=insurance],[data-trust=pentest]')) trust().catch(() => {});
