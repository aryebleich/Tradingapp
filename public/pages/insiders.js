// Insider trades (Research → Research & news → Insider trades, #/insiders; src/insiders.js, FEAT-02).
// The market list of recent Form 4 transactions (open-market buys by default) with filters and the
// cluster view, and one stock's latest filings (#/insiders?symbol=AAPL). Every row shows the trade date,
// the filing date and the days between, the 10b5-1 flag and a link to the filing. Not advice.
let H;
export function registerInsiders(routes, helpers) { H = helpers; routes.insiders = insiders; }

const money = n => (n ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n) : '—');
const num = n => (n ? Math.round(n).toLocaleString('en-US') : '—');
const rowHtml = (r, withSymbol) => `<tr>${withSymbol ? `<td><a href="#/insiders?symbol=${encodeURIComponent(r.symbol)}" data-no-tr><b>${H.esc(r.symbol)}</b></a></td>` : ''}
  <td>${H.esc(r.insider || '')}<br><span class="mu small-print">${H.esc(r.role || '')}</span></td>
  <td>${H.esc(r.codeName || r.code)}${r.plan10b51 ? ' <span class="pill" title="A trading plan set up in advance (Rule 10b5-1), not a fresh decision">10b5-1 plan</span>' : ''}${r.amended ? ' <span class="pill">amended</span>' : ''}</td>
  <td class="num">${num(r.shares)}</td><td class="num">${r.price ? H.money(r.price) : '—'}</td><td class="num">${money(r.value)}</td>
  <td>${H.esc(r.date || '—')}</td><td>${H.esc(r.filed || '—')}${r.lag != null ? `<br><span class="mu small-print">${r.lag} day${r.lag === 1 ? '' : 's'} later</span>` : ''}</td>
  <td>${r.url ? `<a href="${H.esc(H.safeUrl ? H.safeUrl(r.url) : r.url)}" target="_blank" rel="noopener">Filing</a>` : ''}</td></tr>`;
const table = (rows, withSymbol) => `<div class="tablewrap" tabindex="0" role="region" aria-label="Insider trades"><table class="slim"><thead><tr>${withSymbol ? '<th>Symbol</th>' : ''}<th>Insider</th><th>Transaction</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th><th>Traded</th><th>Filed</th><th></th></tr></thead><tbody data-no-fig>${rows.map(r => rowHtml(r, withSymbol)).join('')}</tbody></table></div>`;

async function insiders(view, q) {
  const symbol = (q?.get('symbol') || '').toUpperCase();
  view.innerHTML = `<div class="pagehead"><h1>Insider trades</h1><p class="mu" style="margin:4px 0 0">What company officers, directors and large owners bought and sold, from their Form 4 filings.</p></div>
    <form class="card row" id="insSym" style="align-items:flex-end"><label>One stock<input name="symbol" value="${H.esc(symbol)}" placeholder="AAPL" autocomplete="off" spellcheck="false"></label><button>Show filings</button>${symbol ? ' <a href="#/insiders">Back to the market list</a>' : ''}</form>
    <div id="insOut"><div class="card"><p class="mu">Loading…</p></div></div>`;
  H.$('#insSym', view).onsubmit = e => { e.preventDefault(); const s = H.$('#insSym', view).symbol.value.trim().toUpperCase(); location.hash = s ? '#/insiders?symbol=' + encodeURIComponent(s) : '#/insiders'; };
  const out = H.$('#insOut', view);
  if (symbol) {
    const d = await H.api('/insiders/' + encodeURIComponent(symbol)).catch(e => ({ error: e.message }));
    out.innerHTML = `<div class="card"><h2>${H.esc(d.issuer || symbol)}</h2>${d.error ? `<p class="err">${H.esc(d.error)}</p>` : d.rows?.length ? table(d.rows, false) : `<p class="mu">${H.esc(d.reason || 'No Form 4 transactions in its latest filings.')}</p>`}
      <p class="mu small-print">${H.esc(d.note || '')}</p></div>`;
    return;
  }
  const draw = async (f = {}) => {
    const qs = new URLSearchParams({ code: f.code || 'P', minValue: f.minValue || '', role: f.role || '', cluster: f.cluster ? '1' : '', days: f.days || '30' });
    const d = await H.api('/insiders?' + qs).catch(e => ({ error: e.message, rows: [] }));
    out.innerHTML = `<form class="card" id="insF"><div class="row" style="align-items:flex-end">
        <label>Transaction<select name="code">${[['P', 'Buys (open market)'], ['S', 'Sales (open market)']].map(([k, v]) => `<option value="${k}" ${(f.code || 'P') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>At least ($)<input name="minValue" type="number" min="0" step="1000" value="${H.esc(f.minValue || '')}"></label>
        <label>Role<select name="role">${[['', 'Anyone'], ['Chief Executive', 'CEO'], ['Chief Financial', 'CFO'], ['Director', 'Director'], ['10% owner', '10% owner']].map(([k, v]) => `<option value="${k}" ${(f.role || '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Filed in the last<select name="days">${[7, 30, 90].map(n => `<option value="${n}" ${String(f.days || 30) === String(n) ? 'selected' : ''}>${n} days</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" name="cluster" ${f.cluster ? 'checked' : ''}> Clusters only (2 or more insiders within 14 days)</label><button>Show</button></div></form>
      <div class="card">${d.error ? `<p class="err">${H.esc(d.error)}</p>` : d.rows.length ? table(d.rows, true) : '<p class="mu">No filings match yet. The list fills from SEC EDGAR every 30 minutes.</p>'}
      <p class="mu small-print">${H.esc(d.note || '')} Grants, option exercises and shares withheld for tax are not buys or sales and are left out of these two lists.</p></div>`;
    H.$('#insF', out).onsubmit = e => { e.preventDefault(); const v = H.form(H.$('#insF', out)); draw({ ...v, cluster: !!v.cluster }); };
  };
  await draw();
}
