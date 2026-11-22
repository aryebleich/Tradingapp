// Growth pages (PLAN_GROWTH.md): Diversification (#/riskview/diversify), AI morning picks
// (#/signals/newspicks), AI intraday (#/bots/intraday), Passive investing (#/wealth/passive),
// Dividends & income (#/wealth/dividends) and the Active trading desk (#/active).
// Everything is information or the member's own rules, never advice; paper is the default.
let H;
const PAGES = {};
export function registerGrowth(routes, helpers) { H = helpers; Object.assign(routes, PAGES); }
const n = (v, d = 2) => (v == null || !isFinite(v) ? '-' : (+v).toLocaleString('en-US', { maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null ? '-' : `${(+v).toFixed(d)}%`);
const stat = (k, v, sub = '') => `<div class="stat"><span>${k}</span><b>${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
const card = (title, body, extra = '') => `<div class="card"><div class="dash-ch"><h2>${title}</h2>${extra}</div>${body}</div>`;
const head = (t, p) => `<div class="pagehead"><h1>${t}</h1><p class="mu" style="margin:4px 0 0">${p}</p></div>`;
const skel = '<div class="card"><div class="skel" role="status" aria-label="Loading"><div class="h1"></div><div></div><div></div><div class="w60"></div></div></div>';
const lock = (what, feature) => `<div class="empty lock"><b>${what}</b><button type="button" class="link" data-upgrade="${H.esc(feature)}">Unlock with Pro</button></div>`;
const wireUpgrade = el => H.$$('[data-upgrade]', el).forEach(b => (b.onclick = () => H.upgrade?.(b.dataset.upgrade)));
const acctSel = async (id, cur) => { const list = (await H.accounts()).filter(a => a.id === 'paper' || a.connected); return `<label class="acctpick">Account<select id="${id}">${list.map(a => `<option value="${H.esc(a.id)}" ${a.id === cur ? 'selected' : ''}>${H.esc(H.acctLabel(a))}</option>`).join('')}</select></label>`; };
const bar = (label, v, cls = '') => `<div class="bar-row"><span>${H.esc(label)}</span><i style="width:${Math.max(0, Math.min(100, v))}%" class="${cls}"></i><b>${pct(v)}</b></div>`;

// ---------- Diversification ----------
PAGES.diversify = async (view, q) => {
  const account = q.get('account') || H.state.account || 'paper';
  view.innerHTML = head('Diversification', 'How spread out your money is: across companies, sectors, countries and kinds of assets, and how alike your holdings move.') + `<form class="row card" id="dvf" style="align-items:flex-end">${await acctSel('dvAcct', account)}</form><div id="dvo">${skel}</div>`;
  H.$('#dvAcct', view).onchange = e => (location.hash = '#/riskview/diversify?account=' + encodeURIComponent(e.target.value));
  const out = H.$('#dvo', view);
  try {
    const d = await H.api('/diversify?account=' + encodeURIComponent(account));
    if (d.score == null) { out.innerHTML = card('Nothing held yet', `<div class="empty"><b>${H.esc(d.note || 'No holdings in this account.')}</b><a href="#/wealth">See index funds that spread money widely →</a></div>`); return; }
    const cls = d.score >= 75 ? 'pos' : d.score >= 50 ? '' : 'neg';
    out.innerHTML = card('Your diversification score', `<p class="big"><span class="pill ${cls}">${d.score} / 100 · ${H.esc(d.label)}</span></p>
        <div class="tablewrap"><table class="slim"><tbody>${d.parts.map(p => `<tr><th scope="row">${H.esc(p.name)}</th><td>${H.esc(p.detail)}</td><td class="num">${p.points} / ${p.of}</td></tr>`).join('')}</tbody></table></div>`)
      + `<div class="grid">${card('Sectors', d.sectors.slice(0, 8).map(s => bar(s.name, s.pct)).join(''))}${card('Countries', d.regions.map(s => bar(s.name, s.pct)).join(''))}${card('Kinds of assets', d.types.map(s => bar(s.name, s.pct)).join(''))}</div>`
      + card('Suggestions', `${d.suggestions.length ? d.suggestions.map((s, i) => `<div class="sugg"><h3>${H.esc(s.title)}</h3><p>${H.esc(s.why)}</p>
          <button type="button" class="ghost small" data-pv="${i}" aria-expanded="false">Preview</button>
          <div class="pv" id="pv${i}" hidden><div class="stats">${stat('Score', `${s.preview.scoreBefore} → <b>${s.preview.scoreAfter}</b>`)}${stat('Largest sector', `${H.esc(s.preview.topBefore?.name || '-')} ${pct(s.preview.topBefore?.pct)} → ${H.esc(s.preview.topAfter?.name || '-')} ${pct(s.preview.topAfter?.pct)}`)}${stat('In the US', `${pct(s.preview.usBefore)} → ${pct(s.preview.usAfter)}`)}</div>
            <p class="mu small-print">On paper only: ${s.sell ? `sell about ${H.money(s.sell.dollars)} of ${H.esc(s.sell.symbol)}, ` : ''}buy about ${H.money(s.buy.dollars)} of ${H.esc(s.buy.symbol)}${s.fromCash ? ' (from cash or new money)' : ''}. Nothing is sent until you place an order yourself.</p>
            <p>${s.sell ? `<a href="#/trade?symbol=${encodeURIComponent(s.sell.symbol)}">Open the ticket for ${H.esc(s.sell.symbol)} →</a> · ` : ''}<a href="#/trade?symbol=${encodeURIComponent(s.buy.symbol)}">Open the ticket for ${H.esc(s.buy.symbol)} →</a> · <a href="#/analyze?symbol=${encodeURIComponent(s.buy.symbol)}">About ${H.esc(s.buy.symbol)} →</a></p></div></div>`).join('') : '<div class="empty"><b>No changes stand out.</b><span>Your account is already spread out.</span></div>'}
        ${d.more ? lock(`${d.more} more suggestion${d.more === 1 ? '' : 's'} with previews in Pro.`, 'All diversification suggestions') : ''}<p class="mu small-print">${H.esc(d.note)}</p>`);
    H.$$('[data-pv]', out).forEach(b => (b.onclick = () => { const p = H.$('#pv' + b.dataset.pv, out); p.hidden = !p.hidden; b.setAttribute('aria-expanded', String(!p.hidden)); b.textContent = p.hidden ? 'Preview' : 'Hide preview'; }));
    wireUpgrade(out);
  } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; }
};
