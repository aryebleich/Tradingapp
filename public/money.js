// All my money: net worth across banks, cards, loans, crypto wallets, brokerage accounts, private
// investments and real estate, and cash flow (money in and out by month, and where it went).
let H;
export function registerMoney(routes, helpers) { H = helpers; routes.money = page; }
const stat = (k, v, c = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`;
const LABELS = { brokerage: 'Brokerage accounts', cash: 'Bank accounts', investmentsElsewhere: 'Investments at other firms', crypto: 'Crypto wallets', private: 'Private markets', realEstate: 'Real estate', creditCards: 'Credit cards', loans: 'Loans', mortgages: 'Mortgages' };
const LINKS = { brokerage: '#/accounts', private: '#/private', realEstate: '#/realestate', mortgages: '#/realestate' };

async function page(view) {
  const d = await H.api('/money');
  const parts = Object.entries(d.parts).filter(([, v]) => v);
  const maxAbs = Math.max(1, ...parts.map(([, v]) => Math.abs(v)));
  const cf = d.cashflow, maxM = Math.max(1, ...cf.months.flatMap(m => [m.moneyIn, m.moneyOut]));
  view.innerHTML = `<div class="pagehead"><div><h1>All my money</h1><p class="mu" style="margin:4px 0 0">Banks, cards, loans, crypto, your brokerage accounts, private investments and property: one net worth, and where your money comes from and goes. Read-only: nothing here can move money.</p></div></div>
  <div class="card"><div class="stats">${stat('What you own', H.money(d.assets))}${stat('What you owe', H.money(-d.debts))}${stat('Net worth', H.money(d.netWorth), H.cls(d.netWorth))}</div>
    <div class="nwbars">${parts.map(([k, v]) => `<div class="nwrow"><a ${LINKS[k] ? `href="${LINKS[k]}"` : ''}>${H.esc(LABELS[k] || k)}</a><div class="bar"><i class="${v < 0 ? 'owe' : ''}" style="width:${Math.abs(v) / maxAbs * 100}%"></i></div><b dir="ltr">${H.money(v)}</b></div>`).join('') || '<p class="mu">Link a bank or add a wallet to see everything in one place.</p>'}</div></div>
  <div class="grid">
    <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Banks and cards</h2>${d.items.length ? '<button class="small ghost" id="refresh">Refresh</button>' : ''}</div>
      ${d.items.map(it => `<div class="bank"><div class="row" style="justify-content:space-between;align-items:center"><b>${H.esc(it.institution)}</b><button class="small ghost" data-unlink="${it.id}">Unlink</button></div>
        <table class="slim">${it.accounts.map(a => `<tr><td>${H.esc(a.name)} <span class="mu">${a.mask ? '••' + H.esc(a.mask) : ''}</span></td><td class="mu">${H.esc(a.subtype || a.type || '')}</td><td style="text-align:end" class="${a.type === 'credit' || a.type === 'loan' ? 'neg' : ''}">${a.balance == null ? '-' : H.money(a.type === 'credit' || a.type === 'loan' ? -a.balance : a.balance)}</td></tr>`).join('')}</table></div>`).join('') || '<p class="mu">No banks linked yet.</p>'}
      ${d.plaid ? '<button id="linkBank">Link a bank or card</button>' : '<p class="mu">Bank linking is not set up on this server yet.</p>'}<div class="err"></div>
      <p class="mu small-print">Linked through Plaid, read-only. Brightfolio never sees your bank password and cannot move money.</p></div>
    <div class="card"><h2>Crypto wallets</h2>
      <table class="slim">${d.wallets.map(w => `<tr><td><b>${H.esc(w.label || w.name)}</b><br><span class="mu" style="font-size:11.5px" data-no-tr dir="ltr">${H.esc(w.address.slice(0, 8))}…${H.esc(w.address.slice(-6))}</span></td><td dir="ltr">${w.amount == null ? '-' : (+w.amount).toFixed(6) + ' ' + (w.chain === 'btc' ? 'BTC' : 'ETH')}</td><td style="text-align:end">${w.value == null ? '-' : H.money(w.value)}</td><td><button class="small ghost" data-rmw="${w.id}">Remove</button></td></tr>`).join('') || '<tr><td class="mu">No wallets yet.</td></tr>'}</table>
      <form id="wf" class="row" style="margin-top:10px;flex-wrap:wrap"><label>Network<select name="chain"><option value="btc">Bitcoin</option><option value="eth">Ethereum</option></select></label><label style="flex:2">Public address<input name="address" required dir="ltr" autocomplete="off"></label><label>Name<input name="label" placeholder="Cold wallet"></label><button style="align-self:flex-end">Add</button></form><div class="err"></div>
      <p class="mu small-print">Only the public address: no keys or seed words, ever. The balance is read from the blockchain.</p></div>
  </div>
  <div class="card"><h2>Cash flow</h2>${cf.months.length ? `<div class="cfchart">${cf.months.map(m => `<div class="cfm"><div class="cfbars"><i class="in" style="height:${m.moneyIn / maxM * 100}%" title="In ${H.money(m.moneyIn)}"></i><i class="out" style="height:${m.moneyOut / maxM * 100}%" title="Out ${H.money(m.moneyOut)}"></i></div><span>${new Date(m.month + '-15').toLocaleString(undefined, { month: 'short' })}</span><b class="${H.cls(m.net)}" dir="ltr">${H.money(m.net)}</b></div>`).join('')}</div>
    <div class="cflegend"><span><i class="in"></i>Money in</span><span><i class="out"></i>Money out</span></div>
    ${cf.spendingByCategory.length ? `<h3>Where the money went (6 months)</h3><table class="slim">${cf.spendingByCategory.map(c => `<tr><td style="text-transform:capitalize">${H.esc(c.category)}</td><td style="text-align:end">${H.money(c.amount)}</td></tr>`).join('')}</table>` : ''}` : '<p class="mu">Link a bank or card to see money in and out by month.</p>'}
    <p class="mu small-print">Transfers between your own accounts and card payments are left out, so nothing counts twice.</p></div>`;

  if (H.$('#refresh', view)) H.act(H.$('#refresh', view), async () => { await H.api('/money/refresh', { body: {} }); H.render(); return ''; });
  H.$$('[data-unlink]', view).forEach(b => H.act(b, async () => { if (!confirm('Unlink this bank?')) return ''; await H.api('/money/banks/' + b.dataset.unlink, { method: 'DELETE' }); H.render(); return ''; }));
  H.$$('[data-rmw]', view).forEach(b => H.act(b, async () => { await H.api('/money/wallets/' + b.dataset.rmw, { method: 'DELETE' }); H.render(); return ''; }));
  const wf = H.$('#wf', view);
  H.act(H.$('button', wf), async () => { await H.api('/money/wallets', { body: H.form(wf) }); H.render(); return ''; });
  if (H.$('#linkBank', view)) H.act(H.$('#linkBank', view), async () => {
    const { linkToken } = await H.api('/money/link-token', { body: {} });
    if (!window.Plaid) await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; sc.onload = ok; sc.onerror = () => no(new Error('Could not load Plaid')); document.head.append(sc); });
    await new Promise((ok, no) => window.Plaid.create({
      token: linkToken,
      onSuccess: async (pt, meta) => { try { await H.api('/money/exchange', { body: { publicToken: pt, institution: meta?.institution?.name } }); ok(); } catch (e) { no(e); } },
      onExit: err => (err ? no(new Error(err.display_message || err.error_message || 'Linking stopped')) : ok()),
    }).open());
    H.render(); return '';
  });
}
