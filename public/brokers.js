// Brokerages page: connect Tradier, tastytrade, Schwab and TradeStation next to Alpaca.
let H; // helpers from app.js

export function registerBrokers(routes, helpers) {
  H = helpers;
  routes.brokers = brokers;
}

async function brokers(view, q) {
  const [list, accounts] = await Promise.all([H.api('/brokerages'), H.api('/accounts')]);
  const alpaca = accounts.find(a => a.id === 'alpaca');
  view.innerHTML = `
  <div class="pagehead"><div><h1>Brokerages</h1><p class="mu" style="margin:4px 0 0">Connect every account you trade. Each one then shows up in the account pickers: alerts, strategies, pairs and the S&amp;P 500 plan can send orders to any of them, or to several at once.</p></div></div>
  ${q.get('connected') ? `<div class="banner">Connected. Your ${H.esc(list.find(b => b.id === q.get('connected'))?.name || 'brokerage')} account is ready.</div>` : ''}
  ${q.get('error') ? `<div class="banner err">${H.esc(q.get('error'))}</div>` : ''}
  <div class="libgrid">
    <div class="card lib"><div class="libhead"><h3>Alpaca</h3>${alpaca?.connected ? `<span class="pill pos">Connected${alpaca.live ? ' · live' : ''}</span>` : '<span class="pill">Not connected</span>'}</div>
      <p class="about">Open a new brokerage account inside Brightfolio, sign in with Alpaca, or use API keys. Stocks, ETFs, options and crypto, with fractional shares.</p>
      <a href="#/account"><button type="button">${alpaca?.connected ? 'Manage' : 'Connect Alpaca'}</button></a></div>
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
