// Futures, mutual funds and savings, next to stocks and ETFs; and the rates card on the bonds page.
let H;
export function registerInstruments(routes, helpers) { H = helpers; routes.invest = page; }
const TABS = [['futures', 'Futures'], ['funds', 'Mutual funds'], ['savings', 'Savings & T-bills']];
const st = (k, v, c = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`;

async function page(view, q) {
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'futures';
  const head = `<div class="pagehead"><div><h1>Futures, funds & savings</h1><p class="mu" style="margin:4px 0 0">Beyond stocks and ETFs: futures contracts, mutual funds, and where cash earns the most safely.</p></div></div>
    <div class="chips" style="margin-bottom:14px">${TABS.map(([k, t]) => `<a href="#/invest?tab=${k}"><button type="button" class="${k === tab ? 'on' : ''}">${t}</button></a>`).join('')}</div>`;
  if (tab === 'funds') return funds(view, head);
  if (tab === 'savings') return savings(view, head);
  const d = await H.api('/instruments/futures');
  const groups = [...new Set(d.contracts.map(c => c.group))];
  view.innerHTML = `${head}
  <div class="card"><h2>What a futures contract is</h2><p class="mu" style="margin-top:0">An agreement to buy or sell something (an index, oil, gold, Treasury bonds) at a set price on a future date. You put up only a deposit (<b>margin</b>, often 5–12% of the contract's value), so gains and losses are multiplied: a 1% move in the E-mini S&amp;P 500 is about a 12% gain or loss on the margin. <b>Micro</b> contracts are one-tenth the size. Practise here on paper first.</p></div>
  ${d.positions.length ? `<div class="card"><h2>Your practice positions</h2><table class="slim"><tr><th>Contract</th><th>Position</th><th>Entry</th><th>Now</th><th>P/L</th><th>Margin</th><th></th></tr>${d.positions.map(p => `<tr><td><b data-no-tr>${H.esc(p.root)}</b> ${H.esc(p.name)}</td><td>${p.contracts > 0 ? 'Long' : 'Short'} ${Math.abs(p.contracts)}</td><td>${H.money(p.entry)}</td><td>${p.price == null ? '-' : H.money(p.price)}</td><td class="${H.cls(p.pnl || 0)}">${p.pnl == null ? '-' : H.money(p.pnl)}</td><td>${p.margin == null ? '-' : H.money(p.margin)}</td><td><button class="small ghost" data-close="${H.esc(p.root)}" data-n="${-p.contracts}">Close</button></td></tr>`).join('')}</table><div class="err"></div></div>` : ''}
  ${groups.map(g => `<div class="card"><h2>${H.esc(g)}</h2><div class="tablewrap"><table class="slim"><tr><th>Contract</th><th>Price</th><th>$ per 1.00 move</th><th>One tick</th><th>Contract value</th><th>Margin (about)</th><th></th></tr>
    ${d.contracts.filter(c => c.group === g).map(c => `<tr><td><b data-no-tr>${H.esc(c.root)}</b> ${H.esc(c.name)} <span class="mu">${H.esc(c.exchange)}</span></td><td>${c.price == null ? '-' : c.price.toLocaleString('en-US')}</td><td>${H.money(c.pointValue)}</td><td>${H.money(c.tickValue ?? c.tick * c.pointValue)}</td><td>${c.notional ? H.money(c.notional, 0) : '-'}</td><td>${c.margin ? H.money(c.margin, 0) : '-'}</td>
      <td style="white-space:nowrap"><button class="small" data-trade="${H.esc(c.root)}" data-n="1">Buy 1</button> <button class="small ghost" data-trade="${H.esc(c.root)}" data-n="-1">Sell 1</button></td></tr>`).join('')}</table></div></div>`).join('')}
  <p class="mu small-print">Practice trades use the paper account's cash for margin (about ${Math.round(d.marginRate * 100)}% of the contract value; exchanges set the real figure and brokers may ask more). Prices are delayed. Live futures need a futures brokerage (for example Interactive Brokers, tastytrade, Tradovate or Schwab with futures approval); Alpaca does not offer futures. Futures can lose more than the margin.</p>`;
  H.$$('[data-trade],[data-close]', view).forEach(b => H.act(b, async () => {
    const root = b.dataset.trade || b.dataset.close, n = +b.dataset.n;
    if (!confirm(`${b.dataset.close ? 'Close' : n > 0 ? 'Buy' : 'Sell'} ${Math.abs(n)} ${root} on paper?`)) return '';
    const r = await H.api('/instruments/futures/trade', { body: { root, contracts: n } }); setTimeout(H.render, 500);
    return `${root} at ${r.price}${r.realized ? `, realized ${H.money(r.realized)}` : ''}`;
  }));
}

async function funds(view, head) {
  const [d, accts] = await Promise.all([H.api('/instruments/funds'), H.accounts()]);
  view.innerHTML = `${head}<div class="card"><h2>Mutual funds</h2><p class="mu" style="margin-top:0">A mutual fund pools money from many investors and is priced once a day after the close (its NAV). Index funds that follow the whole market cost very little; actively managed funds cost more and most trail their index over time. Every fund here has a matching ETF that trades all day and works in any brokerage account.</p>
    <div class="tablewrap"><table class="slim"><tr><th>Fund</th><th>Invests in</th><th>Price (NAV)</th><th>Yearly cost</th><th>Cost on $10,000</th><th>Minimum</th><th>Matching ETF</th><th></th></tr>
    ${d.funds.map(f => `<tr><td><b data-no-tr>${H.esc(f.symbol)}</b> ${H.esc(f.name)}</td><td>${H.esc(f.category)}</td><td>${f.nav == null ? '-' : H.money(f.nav)}</td><td>${f.expenseRatio}%</td><td>${H.money(f.costPer10k)}</td><td>${f.minimum ? H.money(f.minimum, 0) : 'None'}</td><td><a href="#/trade?symbol=${f.etf}" data-no-tr>${f.etf}</a></td>
      <td><button class="small" data-buy="${H.esc(f.symbol)}">Invest on paper</button></td></tr>`).join('')}</table></div>
    <form class="row" id="mf" style="margin-top:12px" hidden><label>Fund<input name="symbol" readonly data-no-tr></label><label>Amount ($)<input name="notional" type="number" min="1" step="0.01" required></label><button style="align-self:flex-end">Invest</button></form><div class="err"></div>
    <p class="mu small-print">Mutual funds are bought from the fund company or a broker such as Fidelity, Vanguard or Schwab; Alpaca and most trading apps offer the matching ETF instead, which is usually as cheap or cheaper. Costs are the funds' published expense ratios and can change; check the fund's site. Not a recommendation.</p></div>`;
  const f = H.$('#mf', view);
  H.$$('[data-buy]', view).forEach(b => (b.onclick = () => { f.hidden = false; f.symbol.value = b.dataset.buy; f.notional.focus(); }));
  H.act(H.$('button', f), async () => { const v = H.form(f); const r = await H.api('/orders', { body: { account: 'paper', symbol: v.symbol, side: 'buy', notional: v.notional } }); return `Bought ${(+r.qty).toFixed(3)} shares of ${r.symbol} at ${H.money(r.price)} (paper)`; });
}

async function savings(view, head) {
  const d = await H.api('/instruments/savings');
  const pctv = s => (s ? `${s.rate.toFixed(2)}%` : '-');
  view.innerHTML = `${head}<div class="card"><h2>What safe cash earns today</h2><div class="stats">${st('3-month T-bill', pctv(d.tbill3m))}${st('6-month T-bill', pctv(d.tbill6m))}${st('1-year Treasury', pctv(d.treasury1y))}${st('Fed funds rate', pctv(d.fedFunds))}</div>
    <p class="mu small-print">Treasury bills are loans to the US government, backed by it, and their interest is free of state income tax. Cash-like ETFs that hold them: ${d.cashFunds.map(s => `<a href="#/trade?symbol=${s}" data-no-tr>${s}</a>`).join(', ')}. ${d.tbill3m ? `As of ${H.esc(d.tbill3m.date)}.` : ''}</p></div>
  <div class="grid"><div class="card"><h2>High-yield savings</h2>${d.offers.length ? `<table class="slim">${d.offers.map(o => `<tr><td><b>${H.esc(o.bank)}</b>${o.note ? `<br><span class="mu">${H.esc(o.note)}</span>` : ''}</td><td><b>${o.apy.toFixed(2)}% APY</b></td><td>${o.url ? `<a href="${H.esc(o.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</td></tr>`).join('')}</table>` : '<p class="mu">Online banks often pay several times what big banks do on savings, insured by the FDIC up to $250,000. Compare current rates on the banks\' own sites.</p>'}
      <p class="mu small-print">Rates change often; check before opening an account. Brightolio earns nothing from these banks.</p></div>
    <form class="card" id="sg"><h2>Savings goal</h2><div class="row"><label>Start with ($)<input name="start" type="number" min="0" value="1000"></label><label>Add each month ($)<input name="monthly" type="number" min="0" value="300"></label></div>
      <div class="row"><label>Yearly rate (%)<input name="apy" type="number" min="0" max="20" step="0.01" value="${d.tbill3m ? d.tbill3m.rate.toFixed(2) : '4'}"></label><label>Years<input name="years" type="number" min="1" max="50" value="5"></label></div><div id="sgOut"></div></form></div>
  ${d.linked.length ? `<div class="card"><h2>Your bank accounts</h2><table class="slim">${d.linked.map(a => `<tr><td>${H.esc(a.institution)} · ${H.esc(a.name)}</td><td class="mu">${H.esc(a.subtype || '')}</td><td style="text-align:end">${a.balance == null ? '-' : H.money(a.balance)}</td></tr>`).join('')}</table></div>` : '<div class="card"><p class="mu">Link your bank in <a href="#/money">All my money</a> to see your savings here.</p></div>'}`;
  const f = H.$('#sg', view);
  const calc = () => {
    const v = H.form(f), r = +v.apy / 1200, n = +v.years * 12;
    let bal = +v.start; for (let i = 0; i < n; i++) bal = bal * (1 + r) + +v.monthly;
    const put = +v.start + +v.monthly * n;
    H.$('#sgOut', view).innerHTML = `<div class="stats">${st('You put in', H.money(put, 0))}${st('Interest earned', H.money(bal - put, 0), 'pos')}${st('You will have', H.money(bal, 0))}</div>`;
  };
  f.oninput = calc; calc();
}

// The rates and news card on the bonds page: Treasury yields, mortgage rates, the Fed, and what a
// mortgage costs where the user lives.
export async function ratesCard(box, helpers, query = '') {
  H = helpers || H;
  const d = await H.api('/instruments/rates' + query).catch(e => ({ error: e.message }));
  if (d.error) { box.innerHTML = `<div class="card"><p class="err">${H.esc(d.error)}</p></div>`; return; }
  const S = d.series, L = d.local, ch = x => (x == null ? '' : `<span class="${x > 0 ? 'neg' : x < 0 ? 'pos' : ''}">${x > 0 ? '▲' : x < 0 ? '▼' : ''} ${Math.abs(x).toFixed(2)} in a year</span>`);
  const row = id => (S[id] ? `<tr><td>${H.esc(S[id].name)}</td><td><b>${S[id].rate.toFixed(2)}%</b></td><td class="mu">${ch(S[id].change1y)}</td></tr>` : '');
  box.innerHTML = `<div class="card"><h2>Rates today</h2>${Object.keys(S).length ? `<table class="slim">${['DFF', 'DTB3', 'DGS2', 'DGS10', 'DGS30', 'MORTGAGE30US', 'MORTGAGE15US'].map(row).join('')}</table>` : '<p class="mu">Rates are not available right now.</p>'}<p class="mu small-print">${H.esc(d.source)}.</p></div>
  <form class="card" id="loc"><h2>Mortgage where you live</h2><div class="row"><label>State<input name="state" maxlength="2" value="${H.esc(L.state)}" dir="ltr" style="text-transform:uppercase"></label><label>City<input name="city" value="${H.esc(L.city)}"></label><label>Home price ($)<input name="price" type="number" min="10000" value="${L.price}"></label><label>Down payment (%)<input name="down" type="number" min="0" max="100" value="${L.down}"></label><button style="align-self:flex-end">Update</button></div>
    ${L.rate30 ? `<div class="stats">${st('30-year fixed', L.rate30.toFixed(2) + '%')}${st('Payment (principal + interest)', H.money(L.monthly30, 0) + '/mo')}${st(`Property tax in ${H.esc(L.state)} (about ${L.propertyTaxPct}%)`, H.money(L.taxMonthly, 0) + '/mo')}${st('Total about', H.money(L.total30, 0) + '/mo')}${L.rate15 ? st('15-year fixed', `${L.rate15.toFixed(2)}% · ${H.money(L.monthly15, 0)}/mo`) : ''}</div>` : '<p class="mu">Mortgage rates are not available right now.</p>'}
    <p class="mu small-print">National average rates (Freddie Mac); lenders in ${H.esc(L.city ? L.city + ', ' : '')}${H.esc(L.state)} quote around these depending on your credit and down payment. ${L.jumbo ? `This loan is above the ${H.money(L.conformingLimit, 0)} conforming limit, so it is a jumbo loan (rates can differ).` : `Loans up to ${H.money(L.conformingLimit, 0)} are conforming in most counties (2026).`} Insurance and HOA are extra. Your state comes from Settings → Taxes.</p></form>
  <div class="card"><h2>Federal Reserve and rate news</h2>${d.news.length ? `<ul class="plain">${d.news.map(n => `<li><a href="${H.esc(n.url)}" target="_blank" rel="noopener">${H.esc(n.title)}</a> <span class="mu">${H.esc(n.date.slice(0, 16))}</span></li>`).join('')}</ul>` : '<p class="mu">No news right now.</p>'}
    <p class="mu small-print">Rate cuts lower T-bill and savings yields within weeks; mortgage rates follow the 10-year Treasury more than the Fed.</p></div>`;
  const f = H.$('#loc', box);
  H.act(H.$('button', f), async () => { const v = H.form(f); await ratesCard(box, H, '?' + new URLSearchParams({ state: v.state.toUpperCase(), city: v.city, price: v.price, down: v.down })); return ''; });
}
