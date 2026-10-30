// Private markets and real estate: the user's investments outside the stock market, with a net
// worth across everything. Brightfolio records and calculates; it does not offer or arrange deals.
let H;
export function registerAlts(routes, helpers) {
  H = helpers;
  Object.assign(routes, { private: view => page(view, 'private'), realestate: view => page(view, 'realestate') });
}
const stat = (k, v, c = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`;
const pc = v => (v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

async function page(view, kind) {
  const priv = kind === 'private';
  const [d, nw, meta] = await Promise.all([H.api('/alts/' + kind), H.api('/alts/networth').catch(() => null), H.api('/alts/platforms')]);
  const types = priv ? meta.privateTypes : meta.propertyTypes, t = d.totals;
  view.innerHTML = `<div class="pagehead"><div><h1>${priv ? 'Private markets' : 'Real estate'}</h1><p class="mu" style="margin:4px 0 0">${priv ? 'Stakes in private companies, startups, funds, loans and your own business: what you put in, what came back, today\'s value, multiple and yearly return.' : 'Your properties next to your stocks: equity, rent, costs and mortgage, with cash flow, cap rate and cash-on-cash return.'}</p></div></div>
  ${nw ? `<div class="card"><h2>Net worth</h2><div class="stats">${stat('Brokerage accounts', H.money(nw.brokerage))}${stat('Private markets', H.money(nw.private))}${stat('Real estate equity', H.money(nw.realEstate))}${stat('Total', H.money(nw.total))}</div><p class="mu small-print">Brokerage accounts count real money only (not the paper account). Values of private investments and property are the ones you enter.</p></div>` : ''}
  <div class="card"><div class="stats">${priv ? stat('Put in', H.money(t.invested)) + stat('Paid back to you', H.money(t.distributions)) + stat('Value now', H.money(t.value)) + stat('Gain', H.money(t.gain), H.cls(t.gain))
    : stat('Property value', H.money(t.value)) + stat('Mortgages', H.money(t.mortgage)) + stat('Equity', H.money(t.equity)) + stat('Cash flow a month', H.money(t.monthlyCashFlow), H.cls(t.monthlyCashFlow))}</div>
    <div class="tablewrap"><table>${priv ? '<tr><th>Investment</th><th>Type</th><th>Put in</th><th>Back</th><th>Value</th><th>Multiple</th><th>Yearly return</th><th></th></tr>' : '<tr><th>Property</th><th>Type</th><th>Value</th><th>Mortgage</th><th>Equity</th><th>Cash flow / month</th><th>Cap rate</th><th>Cash-on-cash</th><th></th></tr>'}
    ${d.items.map(a => priv ? `<tr><td><b>${H.esc(a.name)}</b>${a.company ? `<br><span class="mu" style="font-size:12px">${H.esc(a.company)}</span>` : ''}</td><td>${H.esc(types[a.type] || '')}</td><td>${H.money(a.stats.invested)}</td><td>${H.money(a.stats.distributions)}</td><td>${H.money(a.stats.value)}</td><td>${a.stats.moic == null ? '-' : a.stats.moic + 'x'}</td><td>${pc(a.stats.irr)}</td><td><button class="small ghost" data-open="${a.id}">Open</button></td></tr>`
      : `<tr><td><b>${H.esc(a.name)}</b>${a.address ? `<br><span class="mu" style="font-size:12px">${H.esc(a.address)}</span>` : ''}</td><td>${H.esc(types[a.type] || '')}</td><td>${H.money(a.value)}</td><td>${H.money(a.mortgage)}</td><td>${H.money(a.stats.equity)}</td><td class="${H.cls(a.stats.monthlyCashFlow)}">${H.money(a.stats.monthlyCashFlow)}</td><td>${pc(a.stats.capRate)}</td><td>${pc(a.stats.cashOnCash)}</td><td><button class="small ghost" data-open="${a.id}">Open</button></td></tr>`).join('') || `<tr><td colspan="9" class="mu">Nothing added yet.</td></tr>`}</table></div></div>
  <div id="detail"></div>
  <form class="card" id="add"><h2>Add ${priv ? 'a private investment' : 'a property'}</h2>${fields(kind, {}, types)}
    ${priv ? '<div class="row"><label>Amount put in ($)<input name="invested" type="number" min="0" step="any"></label><label>On<input name="investedOn" type="date"></label></div>' : ''}
    <button>Add</button><div class="err"></div></form>
  <div class="card"><h2>Where to invest</h2><p class="mu" style="margin-top:0">${priv ? 'Platforms where people invest in private companies. Some are open to everyone (Regulation Crowdfunding); others need an accredited investor.' : 'Ways to invest in real estate without buying a whole building.'} Brightfolio is not connected with them and earns nothing from them; check each one yourself. Private investments are hard to sell and can lose everything.</p>
    <div class="grid">${meta[priv ? 'private' : 'realestate'].map(([n, url, about]) => `<a class="card platform" href="${url}" ${url.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}><b>${H.esc(n)}${url.startsWith('http') ? ' ↗' : ''}</b><span class="mu">${H.esc(about)}</span></a>`).join('')}</div></div>`;

  const f = H.$('#add', view);
  H.act(H.$('button', f), async () => { await H.api('/alts/' + kind, { body: H.form(f) }); H.render(); return ''; });
  H.$$('[data-open]', view).forEach(b => (b.onclick = () => detail(view, kind, d.items.find(x => x.id === +b.dataset.open), types)));
}

function fields(kind, a, types) {
  const v = k => H.esc(a[k] ?? ''), sel = `<select name="type">${Object.entries(types).map(([k, t]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${H.esc(t)}</option>`).join('')}</select>`;
  if (kind === 'private') return `<div class="row"><label>Name<input name="name" value="${v('name')}" required maxlength="80"></label><label>Type${sel}</label></div>
    <div class="row"><label>Company<input name="company" value="${v('company')}"></label><label>Platform or broker<input name="platform" value="${v('platform')}"></label><label>Stage<input name="stage" value="${v('stage')}" placeholder="Seed, Series A…"></label></div>
    <div class="row"><label>Your ownership (%)<input name="ownership" type="number" min="0" max="100" step="any" value="${v('ownership')}"></label><label>Value of your stake now ($)<input name="value" type="number" min="0" step="any" value="${v('value')}"></label><label>Valued on<input name="valuedOn" type="date" value="${v('valuedOn')}"></label></div>`;
  return `<div class="row"><label>Name<input name="name" value="${v('name')}" required maxlength="80"></label><label>Type${sel}</label><label>Address<input name="address" value="${v('address')}"></label></div>
    <div class="row"><label>Price paid ($)<input name="price" type="number" min="0" step="any" value="${v('price')}"></label><label>Bought on<input name="bought" type="date" value="${v('bought')}"></label><label>Value now ($)<input name="value" type="number" min="0" step="any" value="${v('value')}"></label><label>Cash you put in ($)<input name="cashInvested" type="number" min="0" step="any" value="${v('cashInvested')}"></label></div>
    <div class="row"><label>Mortgage left ($)<input name="mortgage" type="number" min="0" step="any" value="${v('mortgage')}"></label><label>Rate (%)<input name="rate" type="number" min="0" max="30" step="any" value="${v('rate')}"></label><label>Years left<input name="yearsLeft" type="number" min="0" max="50" value="${v('yearsLeft') || 30}"></label><label>Monthly payment ($, optional)<input name="payment" type="number" min="0" step="any" value="${v('payment')}"></label></div>
    <div class="row"><label>Rent a month ($)<input name="rent" type="number" min="0" step="any" value="${v('rent')}"></label><label>Costs a month ($: taxes, insurance, repairs, management)<input name="costs" type="number" min="0" step="any" value="${v('costs')}"></label></div>`;
}

function detail(view, kind, a, types) {
  const box = H.$('#detail', view), priv = kind === 'private';
  box.innerHTML = `<form class="card" id="ed"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${H.esc(a.name)}</h2><button type="button" class="small ghost" id="del">Delete</button></div>
    ${fields(kind, a, types)}<label>Notes<textarea name="notes" rows="2">${H.esc(a.notes || '')}</textarea></label><button>Save</button><div class="err"></div></form>
    ${priv ? `<div class="card tablewrap"><h2>Money in and out</h2><table><tr><th>Date</th><th>What</th><th>Amount</th><th>Note</th><th></th></tr>${a.events.map(e => `<tr><td>${H.esc(e.on)}</td><td>${({ invest: 'Money in', distribution: 'Paid back to you', valuation: 'New value' })[e.kind]}</td><td>${H.money(e.amount)}</td><td>${H.esc(e.memo || '')}</td><td><button class="small ghost" data-rmev="${e.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="mu">Nothing yet</td></tr>'}</table>
      <form class="row" id="ev" style="margin-top:10px"><label>What<select name="kind"><option value="invest">Money in</option><option value="distribution">Paid back to you</option><option value="valuation">New value</option></select></label><label>Amount ($)<input name="amount" type="number" min="0" step="any" required></label><label>On<input name="on" type="date"></label><label>Note<input name="memo"></label><button style="align-self:flex-end">Add</button></form><div class="err"></div></div>` : ''}`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  H.act(H.$('#ed > button', box), async () => { await H.api('/alts/item/' + a.id, { method: 'PUT', body: H.form(H.$('#ed', box)) }); H.render(); return ''; });
  H.act(H.$('#del', box), async () => { if (!confirm(`Delete ${a.name}?`)) return ''; await H.api('/alts/item/' + a.id, { method: 'DELETE' }); H.render(); return ''; });
  if (H.$('#ev', box)) H.act(H.$('#ev button', box), async () => { await H.api(`/alts/item/${a.id}/events`, { body: H.form(H.$('#ev', box)) }); H.render(); return ''; });
  H.$$('[data-rmev]', box).forEach(b => (b.onclick = async () => { await H.api(`/alts/item/${a.id}/events/${b.dataset.rmev}`, { method: 'DELETE' }); H.render(); }));
}
