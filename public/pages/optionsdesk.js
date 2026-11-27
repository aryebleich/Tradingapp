// Options desk: chain, one contract in depth, my options (live return, close, roll, exercise),
// and the AI strategist. Prices refresh every 20 seconds while the page is open, so in / at / out of
// the money, value and return follow the market.
let H;
const A = (p, o) => H.api('/alpaca' + p, o);
const f2 = v => (v == null || !Number.isFinite(+v) ? '-' : (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const usd = v => (v === 'unlimited' ? 'Unlimited' : v == null ? '-' : (v < 0 ? '-$' : '$') + Math.abs(+v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const MON = { ITM: ['In the money', 'pos'], ATM: ['At the money', 'warn'], OTM: ['Out of the money', ''] };
const ODD = 'https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document';
const DISCLOSE = `<details class="optrisk"><summary><b>Options risk disclosure</b> (read before you trade)</summary><ul>
  <li>Options are not suitable for every investor. Buyers can lose the whole premium; sellers of calls without the shares face unlimited loss, and sellers of puts can be made to buy the shares at the strike.</li>
  <li>An option loses time value every day (time decay), faster near expiry. Changes in implied volatility move the price even when the stock does not.</li>
  <li>Short options can be assigned at any time before expiry (American style). Options in the money at expiry are usually exercised automatically.</li>
  <li>Spreads limit risk but also gain; early assignment of one leg can leave the rest of a spread open. Commissions and the bid/ask spread reduce returns.</li>
  <li>Read <a href="${ODD}" target="_blank" rel="noopener">Characteristics and Risks of Standardized Options</a> (the Options Disclosure Document). A real account needs options approval from the brokerage.</li></ul></details>`;

export function registerOptionsDesk(routes, helpers) { H = helpers; routes.options = desk; }

let timer = null;
const every = (fn, ms, view) => { clearInterval(timer); timer = setInterval(() => { if (!view.isConnected || document.hidden) { if (!view.isConnected) clearInterval(timer); return; } fn().catch(() => {}); }, ms); };

async function desk(view, q) {
  const und = (q.get('underlying') || q.get('symbol') || 'SPY').toUpperCase(), tab = q.get('tab') || 'chain', account = q.get('account') || H.state.account || 'paper';
  const tabs = [['chain', 'Chain'], ['mine', 'My options'], ['ai', 'AI strategist'], ['spread', 'Spread builder'], ['lab', 'Strategies']];
  view.innerHTML = `<div class="pagehead"><div><h1>Options desk</h1><p class="mu" style="margin:4px 0 0">Calls and puts with strike, premium, expiration, every Greek, in / at / out of the money, time decay and live return; buy or sell contracts, close, roll or exercise; and AI that builds and reviews trades.</p></div></div>
    <div class="card row" style="align-items:center;justify-content:space-between"><form id="uf" class="row" style="align-items:flex-end"><label>Underlying<input name="u" value="${H.esc(und)}" style="max-width:120px" data-no-tr></label><button class="small">Load</button></form>
      <div class="chips">${tabs.map(([k, n]) => `<button type="button" class="chip ${k === tab ? 'on' : ''}" data-t="${k}">${n}</button>`).join('')}</div></div>
    <div id="od"></div>${DISCLOSE}`;
  const go = (extra = '') => (location.hash = `#/options?underlying=${encodeURIComponent(und)}&tab=${tab}${extra}`);
  H.$('#uf', view).onsubmit = e => { e.preventDefault(); location.hash = `#/options?underlying=${encodeURIComponent(H.form(e.target).u.trim().toUpperCase())}&tab=${tab === 'mine' ? 'chain' : tab}`; };
  H.$$('[data-t]', view).forEach(b => (b.onclick = () => { if (b.dataset.t === 'lab') { location.hash = '#/optionslab?symbol=' + encodeURIComponent(und); return; } if (b.dataset.t === 'spread') { location.hash = '#/optionschain?underlying=' + encodeURIComponent(und); return; } location.hash = `#/options?underlying=${encodeURIComponent(und)}&tab=${b.dataset.t}`; }));
  const out = H.$('#od', view);
  if (tab === 'mine') return mine(out, account, view);
  if (tab === 'ai') return strategist(out, und, q, view);
  return chainTab(out, und, q, view, go);
}

// ---------- chain ----------
async function chainTab(out, und, q, view, go) {
  const range = q.get('range') || '10', exp = q.get('exp') || '';
  out.innerHTML = '<p class="mu card">Loading the chain…</p>';
  let d;
  const load = async () => { d = await H.api(`/optdesk/chain/${encodeURIComponent(und)}${exp ? '?expiration=' + exp : ''}`); return d; };
  try { await load(); } catch (x) { out.innerHTML = `<p class="err card">${H.esc(x.message)}</p>`; return; }
  if (!d.contracts.length) { out.innerHTML = '<p class="mu card">No option contracts found for this symbol.</p>'; return; }
  const draw = () => {
    const lim = range === 'all' ? Infinity : +range;
    const all = [...new Set(d.contracts.map(c => c.strike))].sort((a, b) => a - b);
    let strikes = all.filter(k => Math.abs(k / d.spot - 1) * 100 <= lim);
    // No strike that close to the price: show them all rather than an empty table.
    const widened = !strikes.length && all.length;
    if (widened) strikes = all;
    const by = {}; for (const c of d.contracts) (by[c.strike] ||= {})[c.type] = c;
    const cells = (c, t) => !c ? `<td colspan="7" class="mu">-</td>` : `<td class="num pick ${t} ${c.moneyness === 'ITM' ? 'itm' : ''}" data-sym="${c.symbol}">${f2(c.bid)}</td><td class="num pick ${t} ${c.moneyness === 'ITM' ? 'itm' : ''}" data-sym="${c.symbol}">${f2(c.ask)}</td><td class="num ${c.moneyness === 'ITM' ? 'itm' : ''}"><b>${f2(c.mid)}</b></td><td class="num ${c.moneyness === 'ITM' ? 'itm' : ''}">${c.iv != null ? c.iv.toFixed(1) + '%' : '-'}</td><td class="num ${c.moneyness === 'ITM' ? 'itm' : ''}">${f2(c.delta)}</td><td class="num ${c.moneyness === 'ITM' ? 'itm' : ''}">${usd(-c.decayPerDay)}</td><td class="num ${c.moneyness === 'ITM' ? 'itm' : ''}">${Math.round(c.probItm)}%</td>`;
    const head = '<th class="num">Bid</th><th class="num">Ask</th><th class="num">Premium</th><th class="num">IV</th><th class="num">Delta</th><th class="num">Decay / day</th><th class="num">Chance ITM</th>';
    H.$('#cb', out).innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center;gap:10px">
        <div><b data-no-tr>${H.esc(d.underlying)}</b> <b>${f2(d.spot)}</b> · expires ${H.esc(d.expiration)} (${Math.round(d.dte)} days)${d.expectedMove.straddle ? ` · expected move ±${f2(d.expectedMove.straddle)} (${d.expectedMove.pct}%)` : ''}</div>
        <div class="row"><label class="inline">Strikes <select id="rg">${[['5', '±5%'], ['10', '±10%'], ['20', '±20%'], ['all', 'All']].map(([v, n]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${n}</option>`).join('')}</select></label><span class="mu small-print" id="upd">Live · updates every 20 s</span></div></div>
      <div class="chips expchips">${d.expirations.map(e => `<button type="button" class="chip ${e.date === d.expiration ? 'on' : ''}" data-e="${e.date}">${e.date.slice(5)} <small>${e.dte}d</small></button>`).join('')}</div>
      <div class="tablewrap"><table class="chain optchain"><tr><th colspan="7" class="ctr">Calls</th><th class="ctr">Strike</th><th colspan="7" class="ctr">Puts</th></tr><tr>${head}<th class="ctr">Price</th>${head}</tr>
      ${strikes.map(k => `<tr class="${k === d.atmStrike ? 'atmrow' : ''}">${cells(by[k].call, 'call')}<td class="strike"><b>${f2(k)}</b><small class="mu">${(k / d.spot - 1) * 100 >= 0 ? '+' : ''}${((k / d.spot - 1) * 100).toFixed(1)}%</small></td>${cells(by[k].put, 'put')}</tr>`).join('')}</table></div>
      <p class="mu small-print">Shaded: in the money. Highlighted row: at the money. Click a call's or put's bid or ask to open the contract. Premium is the mid price, per share (one contract is 100 shares).${widened ? ' No strikes are that close to the price, so all strikes are shown.' : ''}</p></div>`;
    H.$('#rg', out).onchange = e => go(`&range=${e.target.value}&exp=${d.expiration}`);
    H.$$('[data-e]', out).forEach(b => (b.onclick = () => go(`&range=${range}&exp=${b.dataset.e}`)));
    H.$$('td.pick', out).forEach(td => (td.onclick = () => contract(H.$('#ct', out), td.dataset.sym, q.get('account') || H.state.account)));
  };
  out.innerHTML = '<div id="cb"></div><div id="ct"></div>';
  draw();
  const ct = H.$('#ct', out);
  if (q.get('contract')) contract(ct, q.get('contract'), q.get('account') || H.state.account);
  // Live: the chain and the open contract follow the market (not while the user is typing in it).
  every(async () => { await load(); draw(); if (ct.dataset.sym && !ct.contains(document.activeElement)) await contract(ct, ct.dataset.sym, q.get('account') || H.state.account, true); }, 20000, view);
}

// ---------- one contract ----------
async function contract(box, sym, account, quiet) {
  const side = box.dataset.side || 'buy', qty = +box.dataset.qty || 1;
  box.dataset.sym = sym;
  if (!quiet) box.innerHTML = '<p class="mu card">Working out the contract…</p>';
  let d; try { d = await H.api(`/optdesk/contract/${encodeURIComponent(sym)}?side=${side}&qty=${qty}`); } catch (x) { box.innerHTML = `<p class="err card">${H.esc(x.message)}</p>`; return; }
  const c = d.contract, a = d.analysis, [mlabel, mcls] = MON[c.moneyness];
  const st = (k, v, sub = '') => `<div class="stat"><span>${k}</span><b>${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
  const maxDecay = Math.max(1, ...a.decay.map(x => x.value));
  box.innerHTML = `<div class="card optct"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0"><span data-no-tr>${H.esc(c.symbol)}</span></h2><span class="pill ${mcls}">${mlabel} · ${c.fromSpotPct >= 0 ? '+' : ''}${c.fromSpotPct}%</span></div>
    <p class="mu" style="margin:4px 0 10px">${c.type === 'call' ? 'Call' : 'Put'} · strike <b>${f2(c.strike)}</b> · expires <b>${H.esc(c.expiration)}</b> (${Math.round(c.dte)} days) · underlying ${f2(d.spot)}</p>
    <div class="stats">${st('Premium (mid)', f2(c.mid), `bid ${f2(c.bid)} / ask ${f2(c.ask)}`)}${st('Intrinsic value', f2(c.intrinsic))}${st('Time value', f2(c.timeValue))}${st('Implied volatility', c.iv != null ? c.iv + '%' : '-')}${st('Delta', f2(c.delta), 'moves per $1 in the stock')}${st('Gamma', c.gamma)}${st('Theta', f2(c.theta), 'per share a day')}${st('Vega', f2(c.vega), 'per 1 point of IV')}${st('Chance in the money', Math.round(c.probItm) + '%')}${st('Volume / open interest', `${c.volume ?? '-'} / ${c.openInterest ?? '-'}`)}</div>
    <div class="seg" style="margin:12px 0"><button type="button" data-side="buy" class="${side === 'buy' ? 'on' : ''}">Buy to open</button><button type="button" data-side="sell" class="${side === 'sell' ? 'on' : ''}">Sell to open</button></div>
    <div class="row" style="align-items:flex-end"><label>Contracts<input id="cq" type="number" min="1" step="1" value="${qty}" style="max-width:100px"></label><label>Limit price<input id="cl" type="number" step="0.01" min="0.01" value="${f2(c.mid).replace(/,/g, '')}" style="max-width:120px"></label></div>
    <div class="stats">${st(side === 'buy' ? 'Cost' : 'Credit received', usd(Math.abs(a.cost)))}${st('Most you can lose', `<span class="neg">${usd(a.maxLoss)}</span>`)}${st('Most you can gain', `<span class="pos">${usd(a.maxGain)}</span>`)}${st('Break-even at expiry', f2(a.breakeven))}${st('Chance of profit', a.probProfit + '%', 'at expiry, from IV')}${st('Time decay', usd(a.thetaPerDay) + ' / day', side === 'buy' ? 'works against you' : 'works for you')}${st('Acts like', `${a.deltaShares} shares`)}</div>
    ${a.assignment ? `<p class="banner">${H.esc(a.assignment)}</p>` : ''}
    <div class="grid2"><div><h3>Time decay (price unchanged)</h3><table class="slim"><tr><th>Days left</th><th class="num">Value</th><th class="num">P/L</th><th></th></tr>${a.decay.map(x => `<tr><td>${x.daysLeft}</td><td class="num">${f2(x.value)}</td><td class="num ${H.cls(x.pnl)}">${usd(x.pnl)}</td><td style="width:40%"><span class="decaybar" style="width:${(x.value / maxDecay * 100).toFixed(0)}%"></span></td></tr>`).join('')}</table></div>
      <div><h3>Return if the price moves</h3><div class="tablewrap"><table class="slim scen"><tr><th>Move</th><th class="num">Price</th>${a.scenarios[0].cells.map(x => `<th class="num">${x.label}</th>`).join('')}</tr>${a.scenarios.map(s => `<tr class="${s.move === 0 ? 'atmrow' : ''}"><td>${s.move > 0 ? '+' : ''}${s.move}%</td><td class="num">${f2(s.price)}</td>${s.cells.map(x => `<td class="num ${H.cls(x.pnl)}">${usd(x.pnl)}<small>${x.roi != null ? ` ${x.roi > 0 ? '+' : ''}${x.roi}%` : ''}</small></td>`).join('')}</tr>`).join('')}</table></div><p class="mu small-print">Return on ${side === 'buy' ? 'the premium paid' : c.type === 'put' ? 'the cash set aside to buy the shares' : 'an estimated 20% margin'}.</p></div></div>
    <label class="check"><input type="checkbox" id="ack"> I have read the options risk disclosure below and understand that ${side === 'buy' ? 'I can lose the whole premium' : c.type === 'call' ? 'a call sold without the shares has unlimited risk' : 'I may have to buy 100 shares a contract at the strike'}.</label>
    <div class="row"><button type="button" id="place">${side === 'buy' ? 'Buy' : 'Sell'} ${qty} contract${qty > 1 ? 's' : ''} to open</button><button type="button" class="ghost" id="aiX">AI: explain this trade</button></div><div class="err" id="cerr"></div><div id="aiXo"></div></div>`;
  H.$$('[data-side]', box).forEach(b => (b.onclick = () => { box.dataset.side = b.dataset.side; contract(box, sym, account); }));
  H.$('#cq', box).onchange = e => { box.dataset.qty = Math.max(1, Math.round(+e.target.value || 1)); contract(box, sym, account); };
  H.act(H.$('#aiX', box), async () => { const r = await H.api('/optdesk/ai/explain', { body: { symbol: sym, side } }); H.$('#aiXo', box).innerHTML = `<div class="aibox"><p>${H.esc(r.text)}</p><p class="mu small-print">${r.engine ? 'By ' + H.esc(r.engine) + '. ' : 'Plain summary (no AI set up). '}Education, not advice.</p>${H.evidenceHtml ? H.evidenceHtml(r.evidence) : ''}</div>`; return ''; });
  H.act(H.$('#place', box), async () => {
    if (!H.$('#ack', box).checked) throw new Error('Tick the box to confirm you read the risk disclosure.');
    const limit = +H.$('#cl', box).value;
    if (!(limit > 0)) throw new Error('Enter a limit price');
    if (!confirm(`${side === 'buy' ? 'Buy' : 'Sell'} ${qty} ${c.symbol} to open at ${f2(limit)} a share (limit, day order)? Total about ${usd(limit * 100 * qty)}.`)) return '';
    const r = await A('/orders', { body: { symbol: c.symbol, side, qty, type: 'limit', limit_price: limit, time_in_force: 'day', position_intent: side === 'buy' ? 'buy_to_open' : 'sell_to_open' } });
    return `Order ${r.status || 'sent'}. Options trade on your Alpaca account.`;
  });
}

// ---------- my options ----------
async function mine(out, account, view) {
  const draw = async () => {
    const d = await H.api('/optdesk/positions?account=' + encodeURIComponent(account));
    const g = d.greeks;
    out.innerHTML = !d.positions.length ? `<p class="mu card">No open option positions in this account. ${account === 'paper' ? 'Options trade on an Alpaca account; the Options lab lets you practice strategies.' : ''}</p>` : `<div class="card"><h2>My options <span class="mu small-print" style="font-weight:400">live · updates every 20 s</span></h2>
      <div class="stats"><div class="stat"><span>Delta</span><b>${g.delta}</b><small class="mu">share-equivalent</small></div><div class="stat"><span>Gamma</span><b>${g.gamma}</b></div><div class="stat"><span>Theta</span><b class="${H.cls(g.theta)}">${usd(g.theta)}</b><small class="mu">a day</small></div><div class="stat"><span>Vega</span><b>${usd(g.vega)}</b><small class="mu">per IV point</small></div></div>
      <div class="tablewrap"><table class="slim"><tr><th>Contract</th><th class="num">Qty</th><th class="num">Paid / now</th><th class="num">P/L</th><th class="num">Return</th><th>Moneyness</th><th class="num">Days left</th><th class="num">Decay / day</th><th></th></tr>
      ${d.positions.map((p, i) => { const [ml, mc] = MON[p.moneyness] || ['', '']; return `<tr><td><b data-no-tr>${H.esc(p.underlying)}</b> ${f2(p.strike)} ${p.type} <small class="mu">${H.esc(p.expiration)}</small></td><td class="num">${p.qty}</td><td class="num">${f2(p.avgPrice)} / ${f2(p.mid)}</td><td class="num ${H.cls(p.pnl)}">${usd(p.pnl)}</td><td class="num ${H.cls(p.roi)}"><b>${p.roi != null ? (p.roi > 0 ? '+' : '') + p.roi + '%' : '-'}</b></td><td><span class="pill ${mc}">${ml}</span></td><td class="num">${Math.round(p.dte)}</td><td class="num ${H.cls(p.decayPerDay)}">${usd(p.decayPerDay)}</td>
        <td class="nowrap"><button type="button" class="small ghost" data-close="${i}">Close</button> <a href="#/options?underlying=${encodeURIComponent(p.underlying)}&tab=chain"><button type="button" class="small ghost">Roll</button></a>${p.canExercise ? ` <button type="button" class="small ghost" data-ex="${i}">Exercise</button>` : ''}</td></tr>`; }).join('')}</table></div>
      <button type="button" id="aiR">AI review of my options</button><div id="aiRo"></div></div>`;
    H.$$('[data-close]', out).forEach(b => H.act(b, async () => { const p = d.positions[+b.dataset.close]; if (!confirm(`Close ${Math.abs(p.qty)} ${p.symbol} at about ${f2(p.mid)}?`)) return ''; const r = await A('/orders', { body: { symbol: p.symbol, side: p.qty > 0 ? 'sell' : 'buy', qty: Math.abs(p.qty), type: 'limit', limit_price: +p.mid.toFixed(2), time_in_force: 'day', position_intent: p.qty > 0 ? 'sell_to_close' : 'buy_to_close' } }); return `Order ${r.status || 'sent'}`; }));
    H.$$('[data-ex]', out).forEach(b => H.act(b, async () => { const p = d.positions[+b.dataset.ex]; if (!confirm(`Exercise ${p.qty} ${p.symbol}? You ${p.type === 'call' ? 'buy' : 'sell'} ${p.qty * 100} shares at ${f2(p.strike)}. ${p.moneyness !== 'ITM' ? 'It is out of the money: selling it would usually be worth more.' : ''}`)) return ''; return (await H.api('/optdesk/exercise', { body: { account, symbol: p.symbol } })).note; }));
    if (H.$('#aiR', out)) H.act(H.$('#aiR', out), async () => { const r = await H.api('/optdesk/ai/review', { body: { account } }); H.$('#aiRo', out).innerHTML = `<div class="aibox"><p>${H.esc(r.overview)}</p><ul>${r.positions.map(x => `<li><b data-no-tr>${H.esc(x.symbol)}</b>: <span class="pill">${H.esc(x.action)}</span> ${H.esc(x.why)}</li>`).join('')}</ul><p class="mu small-print">${r.engine ? 'By ' + H.esc(r.engine) + '. ' : 'Plain rules (no AI set up). '}Education, not advice.</p>${H.evidenceHtml ? H.evidenceHtml(r.evidence) : ''}</div>`; return ''; });
  };
  try { await draw(); } catch (x) { out.innerHTML = `<p class="err card">${H.esc(x.message)}</p>`; return; }
  every(() => (H.$('#aiRo', out)?.innerHTML ? Promise.resolve() : draw()), 20000, view);
}

// ---------- AI strategist ----------
async function strategist(out, und, q, view) {
  clearInterval(timer);
  out.innerHTML = `<form class="card" id="sf"><h2>AI options strategist</h2><p class="mu" style="margin-top:0">Say what you expect and how much you are willing to risk; the AI builds strategies from the live chain, prices them and picks the best fit.</p>
    <div class="row" style="align-items:flex-end"><label>Underlying<input name="underlying" value="${H.esc(und)}" data-no-tr></label><label>I expect the price to<select name="outlook">${[['bullish', 'Rise'], ['bearish', 'Fall'], ['neutral', 'Stay in a range'], ['volatile', 'Move a lot, either way'], ['income', 'Earn income']].map(([v, n]) => `<option value="${v}" ${q.get('outlook') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Most I want to risk ($)<input name="budget" type="number" min="50" value="${H.esc(q.get('budget') || '1000')}"></label><button>Build strategies</button></div><div class="err"></div></form><div id="so"></div>`;
  const sf = H.$('#sf', out), btn = H.$('button', sf);
  sf.onsubmit = e => { e.preventDefault(); btn.click(); };
  {
    H.act(btn, async () => {
      const r = await H.api('/optdesk/ai/strategy', { body: H.form(sf) });
      const li = x => (x || []).map(i => `<li>${H.esc(i)}</li>`).join('');
      H.$('#so', out).innerHTML = `<div class="card">${H.evidenceHtml ? H.evidenceHtml(r.evidence) : ''}${r.why ? `<div class="aibox"><p><b>${H.esc((r.candidates.find(c => c.id === r.pick) || r.candidates[0]).name)}</b>: ${H.esc(r.why)}</p>${r.howToProfit ? `<p>${H.esc(r.howToProfit)}</p>` : ''}${r.risks ? `<h3>What can go wrong</h3><ul>${li(r.risks)}</ul>` : ''}${r.manage ? `<h3>How to manage it</h3><ul>${li(r.manage)}</ul>` : ''}<p class="mu small-print">${r.engine ? 'By ' + H.esc(r.engine) + '. ' : 'Ranked by rules (no AI set up). '}Education, not advice.</p></div>` : ''}
        <div class="cards">${r.candidates.map((c, i) => `<div class="card ${c.id === r.pick ? 'picked' : ''}"><h3 style="margin-top:0">${H.esc(c.name)} ${c.id === r.pick ? '<span class="pill pos">AI pick</span>' : ''} ${c.undefinedRisk ? '<span class="pill neg">Unlimited risk</span>' : ''}</h3><p class="mu small-print">${H.esc(c.desc)}</p>
          <p data-no-tr style="font-size:13px">${c.legs.map(l => `${l.side} ${l.qty} ${l.kind}${l.strike ? ' ' + f2(l.strike) : ''}`).join(' · ')} · ${H.esc(c.expiration)}</p>
          <div class="stats"><div class="stat"><span>Max gain</span><b class="pos">${usd(c.maxProfit)}</b></div><div class="stat"><span>Max loss</span><b class="neg">${usd(c.maxLoss)}</b></div><div class="stat"><span>Chance of profit</span><b>${c.probProfit}%</b></div><div class="stat"><span>${c.netCredit >= 0 ? 'Credit' : 'Cost'}</span><b>${usd(Math.abs(c.netCredit))}</b></div></div>
          <p class="mu small-print">Break-even ${c.breakevens.map(f2).join(' and ') || '-'}${c.fitsBudget ? '' : ' · <b>more risk than your budget</b>'}</p><button type="button" class="small" data-lab="${i}">Open in the Options lab</button></div>`).join('')}</div></div>`;
      H.$$('[data-lab]', out).forEach(b => (b.onclick = () => { const c = r.candidates[+b.dataset.lab]; sessionStorage.setItem('qp_opt', JSON.stringify({ underlying: r.underlying, spot: r.spot, legs: c.legs })); location.hash = '#/optionslab?symbol=' + encodeURIComponent(r.underlying); }));
      return '';
    });
  }
}
