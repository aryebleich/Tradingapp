// Home → "Why your P/L moved today": the AI's read of today's profit or loss, factor by factor.
let H;
const usd = x => (x < 0 ? '-$' : '+$') + Math.abs(+x || 0).toLocaleString('en-US', { maximumFractionDigits: Math.abs(x) < 100 ? 2 : 0 });
const pct = x => (x == null ? '' : `${x >= 0 ? '+' : ''}${(+x).toFixed(2)}%`);
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const left = t => { const m = Math.max(0, Math.round((t - Date.now()) / 60e3)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} days`; };
const every = m => (m >= 1440 ? 'once a day' : m >= 60 ? `every ${m / 60} hour${m === 60 ? '' : 's'}` : `every ${m} minutes`);
const KIND = { market: 'Market', sector: 'Sector', stock: 'Stock', news: 'News', rates: 'Rates', other: 'Other' };

function draw(el, d) {
  if (d.off) { el.remove(); return; }
  const max = Math.max(1, ...(d.factors || []).map(f => Math.abs(f.impact)));
  const early = d.nextAt && d.nextAt > Date.now();
  el.innerHTML = `<div class="pw-head"><div><span class="kicker">AI analysis</span><h2>Why your P/L moved today</h2></div>
      ${d.empty ? '' : `<div class="pw-total ${H.cls(d.total)}"><b>${usd(d.total)}</b>${d.totalPct != null ? `<span>${pct(d.totalPct)}</span>` : ''}</div>`}</div>
    <p class="pw-headline"><b>${H.esc(d.headline || '')}</b></p>${d.summary ? `<p class="mu">${H.esc(d.summary)}</p>` : ''}
    ${d.market && !d.empty ? `<div class="pw-mkt">${[['SPY', 'S&P 500'], ['QQQ', 'Nasdaq-100'], ['IWM', 'Small caps'], ['TLT', 'Long bonds']].filter(([s]) => d.market[s] != null).map(([s, n]) => `<span class="chip"><span>${n}</span> <b class="${H.cls(d.market[s])}">${pct(d.market[s])}</b></span>`).join('')}</div>` : ''}
    ${(d.factors || []).length ? `<ol class="pw-factors">${d.factors.map(f => `<li><div class="pw-row"><span class="pill">${KIND[f.kind] || 'Other'}</span><b>${H.esc(f.name)}</b><span class="pw-imp ${H.cls(f.impact)}">${usd(f.impact)}</span></div>
      <div class="pw-bar"><i class="${f.impact >= 0 ? 'up' : 'down'}" style="width:${Math.max(3, Math.abs(f.impact) / max * 100).toFixed(0)}%"></i></div>
      <p>${H.esc(f.text)}</p>${(f.symbols || []).flatMap(s => (d.news?.[s] || []).slice(0, 1).map(n => `<a class="pw-news" href="${H.esc(H.safeUrl(n.url))}" target="_blank" rel="noopener">${H.esc(n.source || 'News')}: ${H.esc(n.headline)} ↗</a>`)).join('')}</li>`).join('')}</ol>` : ''}
    ${(d.watch || []).length ? `<p class="mu small-print"><b>Keep an eye on:</b> ${d.watch.map(H.esc).join(' · ')}</p>` : ''}
    ${H.evidenceHtml ? H.evidenceHtml(d.evidence) : ''}
    <div class="pw-foot"><span class="mu small-print">Updated ${ago(d.at)}${d.engine ? ` by ${H.esc(d.engine)}` : ' (plain summary; no AI answer)'} · refreshes ${every(d.everyMin)} on your plan${early ? `, next in ${left(d.nextAt)}` : ''}</span>
      <button type="button" class="ghost small" id="pwRefresh">${early && d.cost ? `Refresh now (${d.cost} credit${d.cost === 1 ? '' : 's'})` : 'Refresh now'}</button></div>
    <p class="mu small-print pw-note">Worked out from today's prices, your positions and recent headlines. Not advice to buy or sell.</p><div class="err"></div>`;
  H.$('#pwRefresh', el).onclick = async e => {
    const b = e.target; b.disabled = true; b.textContent = 'Working it out…';
    try { draw(el, await H.api('/pnlwhy/refresh', { body: { account: H.state.account } })); } catch (x) { b.disabled = false; b.textContent = 'Refresh now'; H.$('.err', el).textContent = x.message; }
  };
}

export async function pnlWhyCard(helpers, view) {
  H = helpers;
  if (H.$('#pnlWhy', view)) return;
  const el = document.createElement('div'); el.className = 'card pnlwhy'; el.id = 'pnlWhy';
  el.innerHTML = '<div class="pw-head"><div><span class="kicker">AI analysis</span><h2>Why your P/L moved today</h2></div></div><p class="mu">Reading your positions and today\'s news…</p>';
  // On the home grid the card goes into its own slot; elsewhere it follows the page heading.
  const slot = H.$('[data-slot=pnlwhy]', view);
  const anchor = slot ? null : H.$('#myDay', view) || H.$('#homeClock', view) || H.$('.pguide', view) || H.$('h1', view)?.closest('.row') || H.$('h1', view);
  if (slot) slot.replaceChildren(el); else if (anchor) anchor.after(el); else view.prepend(el); // on Home it takes the place of its skeleton
  try { const d = await H.api('/pnlwhy?account=' + encodeURIComponent(H.state.account)); if (el.isConnected) draw(el, d); } catch (x) { el.innerHTML = `<h2>Why your P/L moved today</h2><p class="mu">${H.esc(x.message)}</p>`; }
}
