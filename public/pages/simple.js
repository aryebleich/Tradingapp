// Trade, Positions and Orders for the practice account and the brokerages other than Alpaca
// (Schwab, tastytrade, Tradier, TradeStation). The account is the one chosen in the side panel;
// Alpaca accounts get the full screens in trading.js.
const acctName = async H => { const a = (await H.accounts()).find(x => x.id === H.state.account); return a ? H.acctLabel(a) : 'Paper account'; };
const badge = a => (a.live ? '<span class="pill warn">LIVE MONEY</span>' : '<span class="pill">Practice money</span>');
const failed = (view, title, e, H) => { view.innerHTML = `<h1>${title}</h1><div class="card"><p class="err">${H.esc(e.message)}</p><a href="#/brokers"><button type="button" class="ghost">Choose your brokerage</button></a></div>`; };

export async function trade(view, q, H) {
  const account = H.state.account;
  let a; try { a = await H.api('/account?account=' + account); } catch (e) { return failed(view, 'Trade', e, H); }
  const symbol = (q.get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9./-]/g, '').slice(0, 15) || 'SPY';
  const held = a.positions.find(p => p.symbol === symbol);
  view.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h1>Trade ${badge(a)}</h1><span class="mu">${H.esc(await acctName(H))}</span></div>
  <div class="grid">
    ${H.ticketHtml(a, symbol)}
    <div>
      <div class="card"><h2>This account</h2><div class="stats"><div class="stat"><span>Cash</span><b>${H.money(a.cash)}</b></div><div class="stat"><span>Buying power</span><b>${H.money(a.buyingPower ?? a.cash)}</b></div><div class="stat"><span>Value</span><b>${H.money(a.equity)}</b></div></div>
        ${held ? `<p class="mu" style="margin-bottom:0">You hold <b>${H.num(held.qty, 4)}</b> <span data-no-tr>${H.esc(symbol)}</span>, worth ${H.money(held.value)}.</p>` : ''}</div>
      <div class="card"><h2>Positions</h2>${a.positions.length ? `<div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Qty</th><th class="num">Value</th><th class="num">P/L</th></tr>${a.positions.slice(0, 12).map(p => `<tr><td><a href="#/trade?symbol=${encodeURIComponent(p.symbol)}" data-no-tr>${H.esc(p.symbol)}</a></td><td class="num">${H.num(p.qty, 4)}</td><td class="num">${H.money(p.value)}</td><td class="num ${H.cls(p.pnl)}">${H.money(p.pnl)}</td></tr>`).join('')}</table></div><p style="margin-bottom:0"><a href="#/positions">All positions →</a></p>` : '<p class="mu" style="margin-bottom:0">Nothing held yet. Your first purchase shows up here.</p>'}</div>
      ${/^(paper)$/.test(account) ? '<p class="mu small-print">Charts, options and every order type on one screen come with an Alpaca account: switch the Trading mode to Live after you <a href="#/brokers">connect one</a>.</p>' : ''}
    </div>
  </div>`;
  H.wireQuickTicket(H.$('#ticket', view), view, a);
}

export async function positions(view, q, H) {
  const account = H.state.account;
  let a; try { a = await H.api('/account?account=' + account); } catch (e) { return failed(view, 'Positions', e, H); }
  const ps = [...a.positions].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const value = ps.reduce((s, p) => s + (p.value || 0), 0), pnl = ps.reduce((s, p) => s + (p.pnl || 0), 0);
  view.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h1>Positions ${badge(a)}</h1><span class="mu">${H.esc(await acctName(H))}</span></div>
  <div class="card"><div class="stats"><div class="stat"><span>Market value</span><b>${H.money(value)}</b></div><div class="stat"><span>Unrealized P/L</span><b class="${H.cls(pnl)}">${H.money(pnl)}</b></div><div class="stat"><span>Cash</span><b>${H.money(a.cash)}</b></div><div class="stat"><span>Positions</span><b>${ps.length}</b></div></div></div>
  <div class="card tablewrap"><table><tr><th>Symbol</th><th class="num">Qty</th><th class="num">Avg price</th><th class="num">Price</th><th class="num">Value</th><th class="num">Share</th><th class="num">P/L</th><th></th></tr>
  ${ps.map(p => { const cost = p.avgPrice * p.qty, pct = cost ? p.pnl / Math.abs(cost) * 100 : null; return `<tr><td><a href="#/trade?symbol=${encodeURIComponent(p.symbol)}" data-no-tr>${H.esc(p.symbol)}</a></td><td class="num">${H.num(p.qty, 4)}</td><td class="num">${H.money(p.avgPrice)}</td><td class="num">${H.money(p.price)}</td><td class="num">${H.money(p.value)}</td><td class="num">${a.equity ? (p.value / a.equity * 100).toFixed(1) + '%' : '-'}</td>
    <td class="num ${H.cls(p.pnl)}">${H.money(p.pnl)}${pct == null ? '' : ` (${H.pct(pct, 1)})`}</td><td><button class="small ghost" data-close="${H.esc(p.symbol)}" data-qty="${p.qtyAvailable ?? p.qty}">Close</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="mu">No positions yet. <a href="#/trade">Place a trade</a> and it shows up here.</td></tr>'}
  </table></div><div class="err" id="posErr"></div>`;
  H.$$('[data-close]', view).forEach(b => (b.onclick = async () => {
    const qty = +b.dataset.qty, sym = b.dataset.close, short = qty < 0;
    if (!confirm(`${a.live ? 'LIVE ORDER WITH REAL MONEY\n' : ''}${short ? 'Buy back' : 'Sell'} ${Math.abs(qty)} ${sym} at the market price?`)) return;
    b.disabled = true;
    try { await H.api('/orders', { body: { account, symbol: sym, side: short ? 'buy' : 'sell', qty: Math.abs(qty) } }); setTimeout(H.render, 800); }
    catch (e) { b.disabled = false; H.$('#posErr', view).textContent = e.message; }
  }));
}

export async function orders(view, q, H) {
  const account = H.state.account;
  let list; try { list = await H.api('/orders?account=' + account); } catch (e) { return failed(view, 'Orders', e, H); }
  const open = list.filter(o => o.orderId || /^(open|new|accepted|pending|partially_filled|filling|working|queued)/i.test(o.status || ''));
  const tab = q.get('status') === 'all' ? 'all' : q.get('status') === 'closed' ? 'closed' : open.length ? (q.get('status') || 'open') : 'all';
  const rows = tab === 'open' ? open : tab === 'closed' ? list.filter(o => !open.includes(o)) : list;
  view.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h1>Orders</h1><div class="row" style="gap:10px;align-items:center"><span class="mu">${H.esc(await acctName(H))}</span>
    <div class="chips">${[['open', `Open (${open.length})`], ['closed', 'Filled & closed'], ['all', 'All']].map(([k, t]) => `<a href="#/orders?status=${k}"><button type="button" class="${k === tab ? 'on' : ''}">${t}</button></a>`).join('')}</div></div></div>
  <div class="card tablewrap"><table><tr><th>Time</th><th>Symbol</th><th>Side</th><th class="num">Amount</th><th class="num">Price</th><th>Status</th><th>Source</th><th></th></tr>
  ${rows.map(o => `<tr><td>${o.at ? H.date(o.at) : '-'}</td><td><a href="#/trade?symbol=${encodeURIComponent(o.symbol)}" data-no-tr>${H.esc(o.symbol)}</a></td><td class="${o.side === 'sell' ? 'neg' : 'pos'}">${o.side === 'sell' ? 'Sell' : 'Buy'}</td><td class="num">${o.qty ? H.num(o.qty, 4) : o.notional ? H.money(o.notional) : '-'}</td><td class="num">${o.price ? H.money(o.price) : '-'}</td><td>${H.esc(String(o.status || '').replace(/_/g, ' '))}</td><td class="mu">${H.esc(o.source || '')}</td><td>${o.orderId ? `<button class="small ghost" data-pcancel="${o.orderId}">Cancel</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="8" class="mu">${tab === 'open' ? 'No open orders.' : 'No orders yet.'} <a href="#/trade">Place a trade</a></td></tr>`}
  </table></div><p class="mu small-print">The latest 50 orders of this account.</p>`;
  H.$$('[data-pcancel]', view).forEach(b => H.act(b, async () => { await H.api('/paper/orders/' + b.dataset.pcancel, { method: 'DELETE' }); H.render(); return ''; }));
}
