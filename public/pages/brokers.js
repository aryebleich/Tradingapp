// Choose your brokerage: Alpaca (suggested), Schwab, tastytrade, Tradier and TradeStation.
let H; // helpers from app.js

export function registerBrokers(routes, helpers) {
  H = helpers;
  routes.brokers = brokers;
}

async function brokers(view, q) {
  const [list, accounts] = await Promise.all([H.api('/brokerages'), H.api('/accounts')]);
  const alpaca = accounts.find(a => a.id === 'alpaca');
  view.innerHTML = `
  <div class="pagehead"><div><h1>Choose your brokerage</h1><p class="mu" style="margin:4px 0 0">Brightolio works with the brokerage you prefer. Connect the account you already have, or open a new one: we suggest Alpaca (commission-free, opens in minutes inside the app). Connect as many as you like; each shows up in the account pickers, so alerts, strategies, pairs and the S&amp;P 500 plan can send orders to any of them.</p></div></div>
  ${q.get('connected') ? `<div class="banner">Connected. Your ${H.esc(list.find(b => b.id === q.get('connected'))?.name || 'brokerage')} account is ready.</div>` : ''}
  ${q.get('error') ? `<div class="banner err">${H.esc(q.get('error'))}</div>` : ''}
  <div class="libgrid">
    <div class="card lib suggested"><div class="libhead"><h3>Alpaca <span class="pill">Suggested</span></h3>${alpaca?.connected ? `<span class="pill pos">Connected${alpaca.live ? ' · live' : ''}</span>` : '<span class="pill">Not connected</span>'}</div>
      <p class="about">The easiest start: open a new commission-free account right here, sign in to an Alpaca account you have, or use API keys. Stocks, ETFs, options and crypto, with fractional shares.</p>
      <a href="#/account"><button type="button" class="alpbtn"><svg class="alp-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 2h2v3h3V2h2v4.500c1.200.900 2 2.300 2 3.900V13h-3.500v9h-4v-7.200C7.400 14.300 6 12.400 6 10.200c0-1.600.800-2.900 2-3.700V2zm2 7.200a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg><span>${alpaca?.connected ? 'Manage' : 'Open or connect Alpaca'}</span></button></a></div>
    ${list.map(b => `
    <div class="card lib" data-b="${b.id}"><div class="libhead"><h3>${H.esc(b.name)}</h3>${b.connected ? `<span class="pill pos">Connected${b.live ? ' · live' : ' · test'}${b.account ? ' · …' + H.esc(b.account) : ''}</span>` : '<span class="pill">Not connected</span>'}</div>
      <p class="about">${H.esc(b.about)}</p>
      ${b.connected ? `<div class="sum mu" style="font-size:13px">Loading balance…</div><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="ghost" data-dis>Disconnect</button></div><div class="err"></div>`
        : b.kind === 'token' ? `<form>${b.fields.map(f => f.type === 'checkbox' ? `<label class="chk2"><input type="checkbox" name="${f.k}"> ${H.esc(f.label)}</label>` : `<label>${H.esc(f.label)}<input name="${f.k}" type="${f.secret ? 'password' : 'text'}" autocomplete="off"></label>`).join('')}<button>Connect ${H.esc(b.name)}</button><div class="err"></div></form>`
        : b.available ? `${b.id === 'tradestation' ? '<label class="chk2"><input type="checkbox" data-sim> Use the TradeStation simulator</label>' : ''}<button type="button" data-oauth>Sign in with ${H.esc(b.name)}</button><div class="err"></div>`
        : `<p class="mu" style="font-size:13px">Not available yet on this server: the owner needs to register a ${H.esc(b.name)} developer app first.</p>`}
    </div>`).join('')}
  </div>
  <p class="mu" style="font-size:12px">Keys and tokens are encrypted before they are stored, and you can disconnect at any time (also revoke access at the broker). Orders on these brokerages are whole shares only. Live accounts trade real money.</p>`;
  for (const card of H.$$('[data-b]', view)) {
    const id = card.dataset.b, f = H.$('form', card);
    if (f) H.act(H.$('button', f), async () => { const r = await H.api(`/brokerages/${id}/connect`, { body: H.form(f) }); setTimeout(H.render, 900); return `Connected (${r.live ? 'live' : 'test'} account)`; });
    if (H.$('[data-oauth]', card)) H.act(H.$('[data-oauth]', card), async () => { location.href = (await H.api(`/brokerages/${id}/start`, { body: { sim: !!H.$('[data-sim]', card)?.checked } })).url; return 'Opening sign-in…'; });
    if (H.$('[data-dis]', card)) {
      H.act(H.$('[data-dis]', card), async () => { if (!confirm('Disconnect this brokerage? Strategies and alerts using it will stop sending orders there.')) return ''; await H.api(`/brokerages/${id}`, { method: 'DELETE' }); H.render(); return ''; });
      H.api(`/brokerages/${id}/summary`).then(s => { H.$('.sum', card).innerHTML = `Equity <b>${H.money(s.equity)}</b> · cash ${H.money(s.cash)} · ${s.positions.length} position${s.positions.length === 1 ? '' : 's'}`; })
        .catch(e => { H.$('.sum', card).innerHTML = `<span class="err">${H.esc(e.message)}</span>`; });
    }
  }
}
