// Long-term investing and analysis pages:
//   analyze    Stock & fund analyzer: fundamentals, technical analysis, earnings vs expectations
//   lowcost    Low-cost index funds and mutual funds side by side
//   earnings   Earnings vs expectations for your holdings (or any symbols)
//   leaders    New leaders (scanner)
//   short      Short the market: every way to bet on a fall, for this account
//   margin     Margin center: the account's numbers and rules, bid/ask and how market makers fill orders
//   aifunds    AI long/short portfolios (hedge-fund style, in your own account)
let H;
export function registerInvest(routes, helpers) { H = helpers; Object.assign(routes, { analyze, lowcost, earnings: earningsPage, leaders: leadersPage, short: shortPage, margin: marginPage, aifunds }); }

const pc = (v, d = 1) => (v == null ? '-' : `<b class="${H.cls(v)}">${v > 0 ? '+' : ''}${(+v).toFixed(d)}%</b>`);
const n = (v, d = 2) => (v == null || !isFinite(v) ? '-' : (+v).toLocaleString(undefined, { maximumFractionDigits: d }));
const stat = (k, v, sub = '') => `<div class="stat"><span>${k}</span><b>${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
const head = (t, p) => `<div class="pagehead"><div><h1>${t}</h1><p class="mu" style="margin:4px 0 0">${p}</p></div></div>`;
const NOTE = '<p class="mu small-print">Information for your own research, not a recommendation to buy or sell. Brightolio is software, not an investment adviser.</p>';
const symForm = (sym, ph = 'Symbol, e.g. AAPL or VOO') => `<form class="card row" id="symf" style="align-items:flex-end"><label style="flex:1">Symbol<input name="s" value="${H.esc(sym || '')}" placeholder="${ph}" data-no-tr autocomplete="off" required></label><button>Analyze</button></form>`;

// ---------- analyzer ----------
async function analyze(view, q) {
  const sym = (q.get('symbol') || '').toUpperCase();
  view.innerHTML = head('Stock & fund analyzer', 'Fundamentals, technical analysis and earnings against expectations for any stock or fund, in one place.') + symForm(sym) + '<div id="an"></div>';
  H.$('#symf', view).onsubmit = e => { e.preventDefault(); location.hash = '#/analyze?symbol=' + encodeURIComponent(H.$('[name=s]', view).value.trim().toUpperCase()); };
  if (!sym) { H.$('#an', view).innerHTML = `<div class="card"><p class="mu">Try: ${['AAPL', 'MSFT', 'JPM', 'VOO', 'FXAIX', 'SCHD'].map(s => `<a href="#/analyze?symbol=${s}">${s}</a>`).join(' · ')}</p></div>`; return; }
  const out = H.$('#an', view);
  // One stock page: the overview below, and a section for valuation, fundamentals, earnings,
  // dividends, technicals and supply & demand (public/pages/stock.js).
  const { VIEWS, stockSection } = await import('./stock.js');
  const sec = VIEWS.some(([k]) => k === q.get('view')) ? q.get('view') : 'overview';
  out.insertAdjacentHTML('beforebegin', `<nav class="chips secnav" aria-label="Sections of the stock page">${VIEWS.map(([k, t]) => `<a href="#/analyze?symbol=${encodeURIComponent(sym)}${k === 'overview' ? '' : '&view=' + k}" class="${k === sec ? 'on' : ''}"${k === sec ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div class="row buyrow"><a href="#/trade?symbol=${encodeURIComponent(sym)}"><button type="button" class="small">Trade ${H.esc(sym)}</button></a><a href="#/analyze/compare?symbols=${encodeURIComponent(sym)},SPY" class="small-print">Compare →</a><a href="#/research/news" class="small-print">News →</a></div>`);
  if (sec !== 'overview') return stockSection(H, out, sym, sec);
  let d; try { d = await H.api('/invest/analyze/' + encodeURIComponent(sym)); } catch (e) { out.innerHTML = `<div class="card err">${H.esc(e.message)}</div>`; return; }
  const p = d.profile || {}, rt = p.ratios || {}, fd = p.fundamentals || {}, t = d.technical, e = d.earnings;
  out.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">${H.esc(p.name || p.company?.name || sym)} <span class="mu" data-no-tr>${H.esc(sym)}</span></h2><p class="mu" style="margin:4px 0 0">${H.esc(p.company?.industry || p.etf?.about || d.fund?.holds || '')}${rt.capClass ? ' · ' + H.esc(rt.capClass.name) : ''}</p></div><a href="#/trade?symbol=${encodeURIComponent(sym)}"><button type="button">Trade ${H.esc(sym)}</button></a></div>
    <div class="stats">${stat('Price', t ? H.money(t.price) : '-')}${stat('1 year', pc(t?.change1y))}${stat('Trend', t ? H.esc(t.trend) : '-')}${stat('Volatility', t?.volatility != null ? t.volatility + '%' : '-', 'a year')}</div></div>
  <div class="grid">
    <div class="card"><h2>Fundamentals</h2>${d.fund || p.etf ? `<div class="stats">${stat('Yearly cost', ((d.fund?.cost ?? p.etf?.expenseRatio) ?? '-') + '%', `$${n((d.fund?.cost ?? p.etf?.expenseRatio) * 100)} a year per $10,000`)}${stat('Tracks', H.esc(d.fund?.holds || p.etf?.index || '-'))}${d.fund ? stat('Minimum', d.fund.min ? H.money(d.fund.min) : 'None') + stat('Management', H.esc(d.fund.managed)) : ''}</div><p class="mu small-print">Funds have no P/E of their own; what matters most over decades is the yearly cost and what the fund holds.</p>` : `<div class="tablewrap"><table class="slim wrapcells">${[
      ['P/E (price / earnings)', n(rt.pe, 1), 'How many years of today\'s profit the price pays for. The S&P 500 has averaged roughly 15-25.'],
      ['P/B (price / book)', n(rt.pb, 1), 'Price against what the company owns minus what it owes.'],
      ['P/S (price / sales)', n(rt.ps, 1), 'Price against a year of revenue.'],
      ['Earnings per share', fd.eps != null ? H.money(fd.eps) : '-', 'The last full year.'],
      ['Revenue growth', fd.revenueGrowth != null ? pc(fd.revenueGrowth) : '-', 'Last year against the year before.'],
      ['Earnings growth', fd.epsGrowth != null ? pc(fd.epsGrowth) : '-', 'Earnings per share against the year before.'],
      ['Profit margin', rt.netMargin != null ? n(rt.netMargin, 1) + '%' : '-', 'Profit kept from each dollar of sales.'],
      ['Return on equity', fd.netIncome != null && fd.equity > 0 ? n(fd.netIncome / fd.equity * 100, 1) + '%' : '-', 'Profit against shareholders\' money.'],
      ['Market value', rt.marketCap ? '$' + n(rt.marketCap / 1e9, 1) + 'B' : '-', rt.capClass?.about || ''],
    ].map(([k, v, w]) => `<tr><td>${k}<br><small class="mu">${w}</small></td><td class="num"><b>${v}</b></td></tr>`).join('')}</table></div><p class="mu small-print">From the company's filings with the SEC (the last complete year).</p>`}</div>
    <div class="card"><h2>Technical analysis</h2>${t ? `<div class="stats">${stat('50-day avg', H.money(t.sma50))}${stat('200-day avg', H.money(t.sma200))}${stat('RSI (14)', n(t.rsi14, 0))}${stat('52-week range', `${t.rangePos ?? '-'}%`, `${H.money(t.low52)} – ${H.money(t.high52)}`)}</div>
      <div class="stats">${stat('1 month', pc(t.change1m))}${stat('3 months', pc(t.change3m))}${stat('6 months', pc(t.change6m))}${stat('MACD', `${n(t.macd, 2)} / ${n(t.macdSignal, 2)}`, 'line / signal')}</div>
      <ul class="plain">${t.notes.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul><p><a href="#/chart?symbol=${encodeURIComponent(sym)}">Open the chart with 129 indicators →</a></p>` : '<p class="mu">Not enough price history.</p>'}</div>
  </div>
  <div class="card"><h2>Earnings vs expectations</h2>${earningsBlock(e)}</div>${NOTE}`;
}
function earningsBlock(e) {
  if (!e?.available) return `<p class="mu">${H.esc(e?.note || 'Not available.')}</p>`;
  const s = e.score;
  return `${e.next ? `<p>Next report: <b>${H.esc(e.next.date)}</b> ${H.esc(e.next.when || '')}${e.next.epsEstimate != null ? ` · analysts expect EPS <b>${H.money(e.next.epsEstimate)}</b>` : ''}${e.next.revenueEstimate ? ` and revenue <b>$${n(e.next.revenueEstimate / 1e9, 2)}B</b>` : ''}</p>` : ''}
    ${s?.summary ? `<p><b>${H.esc(s.summary)}</b></p>` : ''}
    <div class="tablewrap"><table class="slim"><tr><th>Quarter</th><th class="num">Expected EPS</th><th class="num">Reported EPS</th><th class="num">Surprise</th><th>Result</th></tr>${(e.history || []).map(h => `<tr><td>${H.esc(h.period || `Q${h.quarter} ${h.year}`)}</td><td class="num">${h.estimate != null ? H.money(h.estimate) : '-'}</td><td class="num">${h.eps != null ? H.money(h.eps) : '-'}</td><td class="num">${pc(h.surprisePct)}</td><td>${h.eps == null || h.estimate == null ? '-' : h.eps > h.estimate ? '<span class="pill pos">Beat</span>' : h.eps < h.estimate ? '<span class="pill neg">Missed</span>' : '<span class="pill">In line</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No reported quarters</td></tr>'}</table></div>`;
}

// ---------- low-cost funds ----------
async function lowcost(view, q) {
  const { funds } = await H.api('/invest/funds'), kind = q.get('kind') || 'all';
  const list = funds.filter(f => kind === 'all' || (kind === 'index' ? /^Index/.test(f.managed) : kind === 'active' ? f.managed === 'Actively managed' : f.kind === (kind === 'etf' ? 'ETF' : 'Mutual fund'))).sort((a, b) => a.cost - b.cost);
  view.innerHTML = head('Low-cost index & mutual funds', 'Index funds, ETFs and well-known mutual funds side by side: what they hold, what they cost each year, and the minimum to start. Over 30 years, cost is one of the few things you control.')
  + `<div class="chips viewtabs">${[['all', 'All'], ['index', 'Index funds'], ['etf', 'ETFs'], ['mutual', 'Mutual funds'], ['active', 'Actively managed']].map(([k, t]) => `<a href="#/lowcost?kind=${k}"><button type="button" class="${k === kind ? 'on' : ''}">${t}</button></a>`).join('')}</div>
  <div class="card"><p class="row" style="align-items:center;gap:8px"><button type="button" class="small" id="fcGo" disabled>Compare selected</button><span class="mu small-print">Tick 2 to 4 funds.</span></p><div id="fcOut"></div><div class="tablewrap"><table><tr><th><span class="sr-only">Compare</span></th><th>Fund</th><th>Holds</th><th>Type</th><th class="num">Yearly cost</th><th class="num">Per $10,000</th><th class="num">Minimum</th><th class="num" title="On $100,000 growing 7% a year for 30 years">Cost over 30 years</th><th></th></tr>
  ${list.map(f => `<tr><td><input type="checkbox" class="fcPick" value="${f.symbol}" aria-label="Compare ${f.symbol}"></td><td><a href="#/analyze?symbol=${f.symbol}"><b data-no-tr>${f.symbol}</b></a><br><small class="mu" data-no-tr>${H.esc(f.name)}</small></td><td>${H.esc(f.holds)}</td><td>${H.esc(f.kind)}<br><small class="mu">${H.esc(f.managed)}</small></td><td class="num">${f.cost}%</td><td class="num">$${n(f.per10k)}</td><td class="num">${f.min ? H.money(f.min) : 'None'}</td><td class="num">${H.money(f.cost30y)}</td><td>${f.kind === 'ETF' ? `<a href="#/trade?symbol=${f.symbol}"><button type="button" class="small ghost">Trade</button></a>` : `<a href="#/invest?tab=funds"><button type="button" class="small ghost">Practice</button></a>${f.closestEtf ? `<br><small class="mu">Here: <a href="#/trade?symbol=${f.closestEtf}" data-no-tr>${f.closestEtf}</a></small>` : ''}`}</td></tr>`).join('')}</table></div>
  <p class="mu small-print">Costs and minimums as published by each fund company in 2025; check the fund's own page before investing. Mutual funds are bought through the fund company or a brokerage that offers them (Alpaca does not); each has an ETF twin that trades like a stock. Dividends can be reinvested automatically in both.</p></div>${NOTE}`;
  const picks = () => H.$$('.fcPick:checked', view).map(c => c.value), go = H.$('#fcGo', view);
  H.$$('.fcPick', view).forEach(c => (c.onchange = () => { const p = picks(); go.disabled = p.length < 2 || p.length > 4; }));
  go.onclick = () => {
    const sel = picks().map(x => funds.find(f => f.symbol === x)), row = (k, fn) => `<tr><th scope="row">${k}</th>${sel.map(f => `<td>${fn(f)}</td>`).join('')}</tr>`, low = Math.min(...sel.map(f => f.cost));
    H.$('#fcOut', view).innerHTML = `<div class="tablewrap"><table class="slim"><thead><tr><th></th>${sel.map(f => `<th data-no-tr>${f.symbol}</th>`).join('')}</tr></thead><tbody>
      ${row('Name', f => H.esc(f.name))}${row('Holds', f => H.esc(f.holds))}${row('Type', f => `${H.esc(f.kind)}, ${H.esc(f.managed)}`)}${row('Yearly cost', f => `${f.cost}%${f.cost === low ? ' <span class="pill pos">lowest</span>' : ''}`)}
      ${row('Cost over 30 years on $100,000', f => H.money(f.cost30y))}${row('Minimum', f => (f.min ? H.money(f.min) : 'None'))}
      ${row('Trade it here', f => (f.kind === 'ETF' ? `<a href="#/trade?symbol=${f.symbol}">Yes, trade ${f.symbol}</a>` : f.closestEtf ? `No (mutual fund). Closest ETF: <a href="#/trade?symbol=${f.closestEtf}" data-no-tr>${f.closestEtf}</a> <span class="mu small-print">(${H.esc(f.closestHow)})</span>` : 'No (mutual fund)'))}</tbody></table></div>
      <p class="mu small-print">Cost over 30 years: what the yearly fee takes from $100,000 growing 7% a year (an example, not a forecast).</p>`;
  };
}

// ---------- earnings vs expectations ----------
async function earningsPage(view, q) {
  const syms = q.get('symbols') || '', accts = await H.accounts(), account = q.get('account') || H.state.account || 'paper';
  view.innerHTML = head('Earnings vs expectations', 'How companies did against what analysts expected: beats, misses and the size of the surprise, for your holdings or any symbols.')
  + `<form class="card row" id="ef" style="align-items:flex-end"><label>Account<select name="account">${H.accountOptions(accts, account)}</select></label><label style="flex:2">Or symbols<input name="symbols" value="${H.esc(syms)}" placeholder="AAPL, MSFT, NVDA" data-no-tr></label><button>Show</button></form><div id="eo"><p class="mu">Loading…</p></div>`;
  H.$('#ef', view).onsubmit = e => { e.preventDefault(); const v = H.form(e.target); location.hash = `#/earnings?account=${v.account}&symbols=${encodeURIComponent(v.symbols)}`; };
  const d = await H.api(`/invest/earnings?account=${encodeURIComponent(account)}&symbols=${encodeURIComponent(syms)}`);
  const o = H.$('#eo', view);
  if (!d.available) { o.innerHTML = `<div class="card"><p class="mu">${H.esc(d.note)}</p></div>`; return; }
  if (!d.rows.length) { o.innerHTML = '<div class="card"><p class="mu">No stocks in this account; type symbols above.</p></div>'; return; }
  o.innerHTML = `<div class="card"><div class="tablewrap"><table><tr><th>Symbol</th><th>Last 4 quarters</th><th class="num">Average surprise</th><th>Next report</th><th class="num">Expected EPS</th></tr>${d.rows.map(r => `<tr><td><a href="#/analyze?symbol=${r.symbol}"><b data-no-tr>${r.symbol}</b></a></td><td>${r.available ? `${r.score.beats} beat · ${r.score.misses} missed${r.score.inLine ? ' · ' + r.score.inLine + ' in line' : ''}` : `<span class="mu">${H.esc(r.note || '')}</span>`}</td><td class="num">${pc(r.score?.avgSurprisePct)}</td><td>${r.next ? H.esc(r.next.date + ' ' + (r.next.when || '')) : '-'}</td><td class="num">${r.next?.epsEstimate != null ? H.money(r.next.epsEstimate) : '-'}</td></tr>`).join('')}</table></div></div>${NOTE}`;
}

// ---------- new leaders ----------
async function leadersPage(view) {
  view.innerHTML = head('New leaders', 'Stocks that have just become market leaders: relative strength jumped into the top fifth of the market, the price is at or near a 52-week high, and the 50-day average is above the 200-day.') + '<div id="lo"><div class="card"><p class="mu">Scanning about 120 large US stocks… (the result is kept for six hours)</p></div></div>';
  const d = await H.api('/invest/leaders');
  const rows = d.rows, fresh = rows.filter(r => r.isNew), lead = rows.filter(r => r.leader && !r.isNew);
  const table = (list, empty) => `<div class="tablewrap"><table><tr><th>Symbol</th><th class="num">Price</th><th class="num" title="1-99, against the scanned stocks">Relative strength</th><th class="num">3 months ago</th><th class="num">From 52-week high</th><th class="num">3 months</th><th></th></tr>${list.map(r => `<tr><td><a href="#/analyze?symbol=${r.symbol}"><b data-no-tr>${r.symbol}</b></a>${r.newHigh ? ' <span class="pill pos">New high</span>' : ''}</td><td class="num">${H.money(r.price)}</td><td class="num"><b>${r.rs}</b></td><td class="num">${r.rsBefore ?? '-'}${r.rsChange != null ? ` <small class="${H.cls(r.rsChange)}">(${r.rsChange > 0 ? '+' : ''}${r.rsChange})</small>` : ''}</td><td class="num">${pc(r.fromHigh)}</td><td class="num">${pc(r.change3m)}</td><td><a href="#/chart?symbol=${r.symbol}"><button type="button" class="small ghost">Chart</button></a></td></tr>`).join('') || `<tr><td colspan="7" class="mu">${empty}</td></tr>`}</table></div>`;
  H.$('#lo', view).innerHTML = `<div class="card"><h2>New leaders <span class="pill">${fresh.length}</span></h2><p class="mu small-print" style="margin-top:0">Leaders now that were not three months ago (relative strength then under 70).</p>${table(fresh, 'No new leaders today')}</div>
    <div class="card"><h2>Established leaders <span class="pill">${lead.length}</span></h2>${table(lead.slice(0, 25), 'None')}</div>
    <p class="mu small-print">${d.scanned} stocks scanned · ${new Date(d.at).toLocaleString()}. Also in the <a href="#/scanner">Scanner</a>.</p>${NOTE}`;
}

// ---------- short-selling desk ----------
// Tabs: Desk (one symbol: plan, borrow, squeeze risk, AI thesis), Screener, My shorts (with an AI
// cover plan), Hedge (beta hedge of the long holdings), Ways to short (inverse funds, futures, puts).
const SQ = { low: 'pos', medium: 'warn', high: 'neg' };
export async function marginSwitch(account, el, after) {
  const m = await H.api('/shortdesk/margin?account=' + encodeURIComponent(account));
  const pill = { off: '<span class="pill">Off</span>', on: '<span class="pill pos">On</span>', waiting: '<span class="pill warn">Waiting for the brokerage</span>' }[m.status];
  el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;gap:12px"><div><h2 style="margin:0">Margin ${pill}</h2><p class="mu" style="margin:4px 0 0">${H.esc(m.note)}</p></div>
    <label class="switch-row"><input type="checkbox" id="mgOn" ${m.on ? 'checked' : ''}> <span>${m.approval === 'broker' ? 'Use margin (asks the brokerage)' : 'Use margin'}</span></label></div>
    ${m.on ? '' : '<p class="mu small-print" style="margin:8px 0 0">With margin you can borrow up to the Reg T limit and sell short. Borrowed money costs interest, and a margin call can force sales at a loss.</p>'}<div class="err"></div>`;
  H.$('#mgOn', el).onchange = async e => {
    if (e.target.checked && !confirm('Margin lets you borrow and sell short. Losses can be larger than the money in the account, and the brokerage can sell your holdings in a margin call. Switch margin on?')) { e.target.checked = false; return; }
    try { await H.api('/shortdesk/margin', { method: 'PUT', body: { account, on: e.target.checked } }); await marginSwitch(account, el, after); after?.(); } catch (x) { H.$('.err', el).textContent = x.message; e.target.checked = !e.target.checked; }
  };
  return m;
}
async function shortPage(view, q) {
  const accts = await H.accounts(), account = q.get('account') || H.state.account || 'paper', tab = q.get('tab') || 'desk', sym = (q.get('symbol') || '').toUpperCase();
  const tabs = [['desk', 'Short desk'], ['screen', 'Screener'], ['mine', 'My shorts'], ['hedge', 'Hedge my holdings'], ['ways', 'Ways to short']];
  const go = (t, extra = '') => (location.hash = `#/short?account=${encodeURIComponent(account)}&tab=${t}${extra}`);
  view.innerHTML = head('Short selling', 'Profit from falling prices with a plan: borrow and squeeze checks, position size from your risk, margin and the price of a margin call, AI analysis, a screener of weak stocks, and cover levels for open shorts.')
  + `<div class="card row" style="align-items:center;justify-content:space-between"><label class="inline">Account <select id="sacct">${H.accountOptions(accts, account)}</select></label><div class="chips">${tabs.map(([k, n]) => `<button type="button" class="chip ${k === tab ? 'on' : ''}" data-t="${k}">${n}</button>`).join('')}</div></div>
  <div class="card" id="mgCard"></div><div id="sd"></div>${NOTE}`;
  H.$('#sacct', view).onchange = e => (location.hash = `#/short?account=${e.target.value}&tab=${tab}`);
  H.$$('[data-t]', view).forEach(b => (b.onclick = () => go(b.dataset.t)));
  const m = await marginSwitch(account, H.$('#mgCard', view), () => H.render());
  const out = H.$('#sd', view);
  if (tab === 'desk') {
    out.innerHTML = `<form class="card row" id="sdf" style="align-items:flex-end"><label>Symbol<input name="s" value="${H.esc(sym)}" placeholder="e.g. TSLA" required data-no-tr></label><label>Risk per trade (% of equity)<input name="risk" type="number" step="0.1" min="0.1" max="5" value="${H.esc(q.get('risk') || '1')}"></label><label>Borrow fee (% a year)<input name="fee" type="number" step="0.1" min="0" value="${H.esc(q.get('fee') || '0.5')}"></label><label>Days held<input name="days" type="number" min="1" value="${H.esc(q.get('days') || '20')}"></label><button>Analyze</button></form><div id="sdo"></div>`;
    H.$('#sdf', view).onsubmit = e => { e.preventDefault(); const f = e.target; go('desk', `&symbol=${encodeURIComponent(f.s.value.trim().toUpperCase())}&risk=${f.risk.value}&fee=${f.fee.value}&days=${f.days.value}`); };
    if (!sym) { H.$('#sdo', view).innerHTML = '<p class="mu card">Type a symbol to see its short plan, or pick one from the Screener.</p>'; return; }
    const o = H.$('#sdo', view); o.innerHTML = '<p class="mu card">Working it out…</p>';
    let d; try { d = await H.api(`/shortdesk/analyze/${encodeURIComponent(sym)}?account=${encodeURIComponent(account)}&risk=${q.get('risk') || 1}&fee=${q.get('fee') || 0.5}&days=${q.get('days') || 20}`); } catch (x) { o.innerHTML = `<p class="err card">${H.esc(x.message)}</p>`; return; }
    const p = d.plan, t = d.t, st = (k, v, sub = '') => `<div class="stat"><span>${k}</span><b>${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
    o.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0"><span data-no-tr>${H.esc(d.symbol)}</span>${d.borrow.name ? ` <span class="mu" style="font-weight:400">${H.esc(d.borrow.name)}</span>` : ''}</h2>
        <div>${d.borrow.known ? (d.borrow.shortable ? `<span class="pill pos">Shortable</span> ${d.borrow.easyToBorrow === false ? '<span class="pill warn">Hard to borrow</span>' : d.borrow.easyToBorrow ? '<span class="pill pos">Easy to borrow</span>' : ''}` : '<span class="pill neg">Not shortable</span>') : '<span class="pill">Borrow status: ask the brokerage</span>'}</div></div>
      <div class="stats">${st('Price', H.money(t.price))}${st('Weakness', d.weakness + '/100', 'downtrend and momentum')}${st('Squeeze risk', `<span class="${SQ[d.squeeze.level]}">${d.squeeze.score}/100 ${d.squeeze.level}</span>`)}${st('RSI (14)', t.rsi ?? '-')}${st('20 days', H.pct(t.ret20 ?? 0))}${st('60 days', H.pct(t.ret60 ?? 0))}${st('From 52-week high', H.pct((t.price / t.high52 - 1) * 100))}${st('Volatility', Math.round(t.vol20) + '%', 'a year')}</div>
      ${d.squeeze.reasons.length ? `<p class="mu small-print"><b>Squeeze risk because:</b> ${d.squeeze.reasons.map(H.esc).join('; ')}.</p>` : ''}</div>
    <div class="card"><h2>The plan</h2><div class="stats">${st('Sell short at', H.money(p.entry))}${st('Stop (buy back)', H.money(p.stop), 'above the 20-day high')}${st('First target', H.money(p.targets[0]))}${st('Second target', H.money(p.targets[1]))}${st('Shares', p.shares, `${H.money(p.value)} short`)}${st('Most you lose at the stop', `<span class="neg">${H.money(-p.maxLoss)}</span>`)}${st('Gain at first target', `<span class="pos">${H.money(p.reward1)}</span>`, `reward to risk ${p.rewardRisk ?? '-'}`)}${st('Your money needed', H.money(p.initialMargin), '50% on top of the sale (Reg T 150%)')}${st('Maintenance', H.money(p.maintenance), '30% of the short value')}${st('Borrow cost', H.money(p.borrowCost), `${p.feePct}% a year, ${p.days} days`)}${st('Margin call near', p.callPrice ? H.money(p.callPrice) : '-', 'if this were the only position')}</div>
      <p class="mu small-print">A short loses when the price rises, with no limit. The stop sits above the recent high; a gap up can open above it. Short sellers also pay any dividend paid while they are short.</p>
      <div class="row">${m.status === 'on' ? `<a href="#/trade?symbol=${encodeURIComponent(d.symbol)}&side=sell&short=1&qty=${p.shares}"><button type="button">Sell short ${p.shares} on the Trade page</button></a>` : '<p class="mu">Switch on margin above to sell short in this account.</p>'}<button type="button" class="ghost" id="aiT">AI short thesis</button></div><div id="aiTo"></div></div>`;
    H.act(H.$('#aiT', o), async () => {
      const a = await H.api('/shortdesk/thesis', { body: { symbol: d.symbol, account } });
      const li = x => (x || []).map(i => `<li>${H.esc(i)}</li>`).join('');
      H.$('#aiTo', o).innerHTML = `<div class="aibox"><p><span class="pill ${/strong/.test(a.verdict) ? 'pos' : /avoid/.test(a.verdict) ? 'neg' : 'warn'}">${H.esc(a.verdict)}</span> ${H.esc(a.summary)}</p><div class="grid2"><div><h3>Why it may fall</h3><ul>${li(a.bearCase)}</ul></div><div><h3>What could lift or squeeze it</h3><ul>${li(a.bullCase)}</ul></div></div>${a.catalysts?.length ? `<h3>Catalysts</h3><ul>${li(a.catalysts)}</ul>` : ''}<h3>Cover when</h3><ul>${li(a.coverWhen)}</ul><p class="mu small-print">${a.engine ? `By ${H.esc(a.engine)}. ` : 'Plain rules (no AI set up). '}Education, not advice.</p></div>`;
      return '';
    });
  } else if (tab === 'screen') {
    out.innerHTML = '<p class="mu card">Scanning large stocks for downtrends…</p>';
    const d = await H.api('/shortdesk/screen').catch(x => ({ error: x.message }));
    out.innerHTML = d.error ? `<p class="err card">${H.esc(d.error)}</p>` : `<div class="card"><h2>Weakest large stocks <span class="pill">${d.rows.length} of ${d.scanned}</span></h2><p class="mu" style="margin-top:0">Ranked by weakness (trend, momentum, distance from the high, selling volume) minus half the squeeze risk.</p>
      <div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Price</th><th class="num">20 days</th><th class="num">60 days</th><th class="num">From high</th><th class="num">RSI</th><th class="num">Weakness</th><th>Squeeze risk</th><th></th></tr>
      ${d.rows.map(r => `<tr><td><b data-no-tr>${r.symbol}</b></td><td class="num">${H.money(r.price)}</td><td class="num ${H.cls(r.ret20)}">${H.pct(r.ret20 ?? 0)}</td><td class="num ${H.cls(r.ret60)}">${H.pct(r.ret60 ?? 0)}</td><td class="num">${H.pct(r.offHigh ?? 0)}</td><td class="num">${r.rsi ?? '-'}</td><td class="num"><b>${r.weakness}</b></td><td><span class="${SQ[r.squeezeLevel]}">${r.squeeze} ${r.squeezeLevel}</span></td><td><button type="button" class="small ghost" data-sym="${r.symbol}">Plan</button></td></tr>`).join('')}</table></div></div>`;
    H.$$('[data-sym]', out).forEach(b => (b.onclick = () => go('desk', '&symbol=' + b.dataset.sym)));
  } else if (tab === 'mine') {
    const d = await H.api('/shortdesk/monitor?account=' + encodeURIComponent(account)).catch(x => ({ error: x.message, shorts: [] }));
    out.innerHTML = d.error ? `<p class="err card">${H.esc(d.error)}</p>` : !d.shorts.length ? '<p class="mu card">No open shorts in this account.</p>' : `<div class="card"><h2>Open shorts</h2><div class="stats"><div class="stat"><span>Short value</span><b>${H.money(d.shortValue)}</b></div><div class="stat"><span>Maintenance (30%)</span><b>${H.money(d.maintenance)}</b></div><div class="stat"><span>Equity</span><b>${H.money(d.equity)}</b></div></div>
      <div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Shares</th><th class="num">Sold at</th><th class="num">Now</th><th class="num">P/L</th><th class="num">Stop</th><th class="num">Cover levels</th><th>Squeeze risk</th><th></th></tr>
      ${d.shorts.map(p => `<tr><td><b data-no-tr>${p.symbol}</b></td><td class="num">${p.shares}</td><td class="num">${H.money(p.avgPrice)}</td><td class="num">${H.money(p.price)}</td><td class="num ${H.cls(p.pnl)}">${H.money(p.pnl)} <small>${H.pct(p.pnlPct ?? 0)}</small></td><td class="num">${p.stop ? H.money(p.stop) : '-'}</td><td class="num">${(p.cover || []).map(H.money).join(' / ') || '-'}</td><td><span class="${SQ[p.squeezeLevel] || ''}" title="${H.esc((p.squeezeWhy || []).join('; '))}">${p.squeeze ?? '-'} ${p.squeezeLevel || ''}</span></td><td><a href="#/trade?symbol=${p.symbol}&side=buy&qty=${p.shares}"><button type="button" class="small ghost">Buy to cover</button></a></td></tr>`).join('')}</table></div>
      <button type="button" id="aiC">AI cover plan</button><div id="aiCo"></div></div>`;
    if (H.$('#aiC', out)) H.act(H.$('#aiC', out), async () => {
      const a = await H.api('/shortdesk/cover-plan', { body: { account } });
      H.$('#aiCo', out).innerHTML = `<div class="aibox"><p>${H.esc(a.overview)}</p><ul>${a.positions.map(x => `<li><b data-no-tr>${H.esc(x.symbol)}</b>: <span class="pill ${/cover/.test(x.action) ? 'warn' : ''}">${H.esc(x.action)}</span> ${H.esc(x.why)}${x.stop ? ` Stop ${H.money(x.stop)}.` : ''}</li>`).join('')}</ul><p class="mu small-print">${a.engine ? `By ${H.esc(a.engine)}. ` : 'Plain rules (no AI set up). '}Education, not advice.</p></div>`;
      return '';
    });
  } else if (tab === 'hedge') {
    const d = await H.api('/shortdesk/hedge?account=' + encodeURIComponent(account)).catch(x => ({ error: x.message }));
    out.innerHTML = d.error ? `<p class="err card">${H.esc(d.error)}</p>` : d.note ? `<p class="mu card">${H.esc(d.note)}</p>` : `<div class="card"><h2>Hedge my holdings against a market fall</h2>
      <div class="stats"><div class="stat"><span>Long holdings</span><b>${H.money(d.longValue)}</b></div><div class="stat"><span>Portfolio beta</span><b>${d.portfolioBeta}</b><small class="mu">1 = moves with the S&amp;P 500</small></div><div class="stat"><span>Market exposure</span><b>${H.money(d.betaDollars)}</b><small class="mu">value x beta</small></div></div>
      <div class="tablewrap"><table class="slim"><tr><th>Hedge</th><th class="num">Shares</th><th class="num">Price</th><th></th><th></th></tr>${d.options.map(o => `<tr><td><b>${H.esc(o.how)}</b><div class="mu small-print">${H.esc(o.note)}</div></td><td class="num">${o.shares ?? '-'}</td><td class="num">${o.price ? H.money(o.price) : '-'}</td><td>${o.needsMargin ? '<span class="pill">needs margin</span>' : ''}</td><td>${o.shares ? `<a href="#/trade?symbol=${o.symbol}&side=${o.needsMargin ? 'sell&short=1' : 'buy'}&qty=${o.shares}"><button type="button" class="small ghost">Trade</button></a>` : ''}</td></tr>`).join('')}</table></div>
      <h3>Market exposure by holding</h3><div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Value</th><th class="num">Beta</th><th class="num">Exposure</th></tr>${d.rows.map(r => `<tr><td data-no-tr>${r.symbol}</td><td class="num">${H.money(r.value)}</td><td class="num">${r.beta}</td><td class="num">${H.money(r.betaDollars)}</td></tr>`).join('')}</table></div>
      <p class="mu small-print">Beta from the last 90 trading days against the S&amp;P 500. A hedge offsets the market's moves, not each company's own news.</p></div>`;
  } else {
    const d = await H.api('/invest/short?account=' + encodeURIComponent(account));
    out.innerHTML = `<div class="cards">${d.paths.map(p => `<div class="card"><h2>${p.title} ${p.available ? '<span class="pill pos">Available</span>' : '<span class="pill">Not on this account</span>'}</h2><p>${H.esc(p.how)}</p><p class="mu small-print"><b>Risk:</b> ${H.esc(p.risk)}</p>${{ short: `<button type="button" class="small" data-go="desk">Short desk</button>`, futures: `<a href="#/invest?tab=futures"><button type="button" class="small">Futures (practice)</button></a>`, puts: `<a href="#/options"><button type="button" class="small">Options chain</button></a>`, inverse: '' }[p.id]}</div>`).join('')}</div>
    <div class="card"><h2>Inverse ETFs</h2><div class="tablewrap"><table><tr><th>Fund</th><th>Moves opposite to</th><th class="num">Daily multiple</th><th class="num">Price</th><th></th></tr>${d.inverse.map(x => `<tr><td><b data-no-tr>${x.symbol}</b></td><td>${H.esc(x.index)}</td><td class="num">${x.leverage}x</td><td class="num">${x.price ? H.money(x.price) : '-'}</td><td><a href="#/trade?symbol=${x.symbol}"><button type="button" class="small ghost">Trade</button></a></td></tr>`).join('')}</table></div>
    <p class="mu small-print">2x and 3x funds multiply each day's move; over several days the result can differ a lot from 2x or 3x the index.</p></div>`;
    H.$$('[data-go]', out).forEach(b => (b.onclick = () => go(b.dataset.go)));
  }
}

// ---------- margin center ----------
async function marginPage(view, q) {
  const accts = await H.accounts(), account = q.get('account') || H.state.account || 'paper', sym = (q.get('symbol') || 'SPY').toUpperCase();
  const [m, qt] = await Promise.all([H.api('/invest/margin?account=' + encodeURIComponent(account)), H.api(`/desk/quote/${encodeURIComponent(sym)}?account=${encodeURIComponent(account)}`).catch(() => null)]);
  const Q = m.qualifies, b = m.broker;
  const spread = qt?.bid && qt?.ask ? qt.ask - qt.bid : null;
  view.innerHTML = head('Margin center', 'Borrowing against your account: what this account qualifies for, its margin numbers, the price that would trigger a margin call, and how bid, ask and market makers shape every fill.')
  + `<div class="card row" style="align-items:center;justify-content:space-between"><label class="inline">Account <select id="macct">${H.accountOptions(accts, account)}</select></label>${m.live ? '<span class="pill warn">Real money</span>' : '<span class="pill">Practice</span>'}</div>
  <div class="card"><h2>What this account qualifies for</h2><div class="stats">${stat('Margin', Q.margin ? 'Yes' : 'No')}${stat('Short selling', Q.shorting ? 'Yes' : 'No')}${stat('Pattern day trading', Q.pdt ? 'Yes ($25,000+)' : 'No')}${stat('Equity', H.money(m.equity))}</div><p>${H.esc(Q.note)}</p></div>
  <div class="card"><h2>Margin numbers</h2><div class="stats">${stat('Borrowed', H.money(m.loan))}${stat('Long', H.money(m.long))}${stat('Short', H.money(m.short))}${stat('Maintenance required', H.money(m.maintenance))}${stat('Cushion', H.money(m.cushion), m.cushionPct != null ? m.cushionPct + '% of equity' : '')}</div>
    ${b ? `<div class="stats">${stat('Multiplier', b.multiplier + 'x')}${stat('Buying power', H.money(b.buyingPower))}${stat('Reg T buying power', H.money(b.regtBuyingPower))}${stat('Day-trading buying power', H.money(b.daytradingBuyingPower))}${stat('Initial margin', H.money(b.initialMargin))}${stat('Day trades (5 days)', b.dayTrades)}</div><p class="mu small-print">Straight from your brokerage: its house rules are already in these numbers.</p>` : ''}
    ${m.positions.some(p => p.callPrice) ? `<h3>Margin-call prices</h3><div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Price</th><th class="num">Margin call near</th><th class="num">Drop to get there</th></tr>${m.positions.filter(p => p.callPrice).map(p => `<tr><td>${H.esc(p.symbol)}</td><td class="num">${H.money(p.price)}</td><td class="num">${H.money(p.callPrice)}</td><td class="num">${pc((p.callPrice / p.price - 1) * 100)}</td></tr>`).join('')}</table></div><p class="mu small-print">If that one stock fell alone, at a ${Math.round(m.rules.houseMaintenance * 100)}% house requirement. <a href="#/longterm">Margin & liquidity watch</a> stress-tests the whole account.</p>` : '<p class="mu">Nothing borrowed: no margin-call risk.</p>'}</div>
  <div class="card"><h2>The rules</h2><div class="tablewrap"><table class="slim wrapcells">${m.rules.explain.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${H.esc(v)}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h2>Bid, ask and market makers</h2><form id="qf" class="row" style="align-items:flex-end"><label>Symbol<input name="s" value="${H.esc(sym)}" data-no-tr></label><button class="ghost">Quote</button></form>
    ${qt ? `<div class="stats">${stat('Bid', qt.bid ? H.money(qt.bid) : '-', 'best price buyers offer')}${stat('Ask', qt.ask ? H.money(qt.ask) : '-', 'best price sellers want')}${stat('Spread', spread != null ? H.money(spread) : '-', spread != null && qt.price ? (spread / qt.price * 100).toFixed(3) + '% of the price' : '')}${stat('Last', H.money(qt.price), H.esc(qt.source || ''))}</div>` : ''}
    <ul class="plain">
      <li><b>Bid and ask:</b> a market buy pays about the ask, a market sell gets about the bid. The gap (the spread) is a cost on every round trip; it is narrow on busy stocks and wide on thin ones. A limit order sets your own price.</li>
      <li><b>The NBBO:</b> the best bid and best ask across all US exchanges. Brokers must seek the best price reasonably available for you (best execution).</li>
      <li><b>Market makers</b> (wholesalers) stand ready to buy and sell all day and earn the spread. Most retail orders are routed to them; they often fill a little better than the NBBO (price improvement), and may pay the broker for the flow.</li>
      <li><b>Where your order goes:</b> your brokerage routes it; Brightolio never sends orders to an exchange itself. Brokers publish where orders go and how well they were filled (SEC Rules 605 and 606). Your own fills and the quote at the moment you sent them are in <a href="#/execution">Execution & routing</a>.</li>
      <li><b>Level II depth</b> (every price level with its size) is shown for crypto on the Chart page; for stocks it needs a paid exchange data feed.</li>
    </ul></div>${NOTE}`;
  { const c = document.createElement('div'); c.className = 'card'; c.id = 'mgCard'; (H.$('#macct', view)?.closest('.card') || view.firstElementChild).after(c); await marginSwitch(account, c, () => H.render()); }
  H.$('#macct', view).onchange = e => (location.hash = `#/margin?account=${e.target.value}&symbol=${sym}`);
  H.$('#qf', view).onsubmit = e => { e.preventDefault(); location.hash = `#/margin?account=${account}&symbol=${encodeURIComponent(H.$('[name=s]', e.target).value.trim().toUpperCase())}`; };
}

// ---------- AI long/short portfolios ----------
async function aifunds(view) {
  const [d, accts] = await Promise.all([H.api('/aifunds'), H.accounts()]);
  const spark = h => { const v = [100, ...h.map(x => x.nav)]; if (v.length < 3) return ''; const lo = Math.min(...v), hi = Math.max(...v), W = 300, Ht = 60, pts = v.map((x, i) => `${(i / (v.length - 1) * W).toFixed(1)},${(Ht - (x - lo) / ((hi - lo) || 1) * (Ht - 4) - 2).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${Ht}" width="100%" height="${Ht}" role="img" aria-label="Value since the start: ${n(v.at(-1), 2)}"><polyline fill="none" stroke="var(--ac)" stroke-width="2" points="${pts}"/></svg>`; };
  view.innerHTML = head('AI long/short portfolios', 'Rules-based long/short books in your own account (not a pooled fund): long the strongest, short the weakest, a multi-strategy book, and protection with an inverse fund or S&P 500 puts. Rebuilt every week with an AI memo. Automatic on practice money; on a real account you approve each set of trades.')
  + `<div class="card"><h2>Fees and risks</h2><p>${H.esc(d.fees)}</p><ul class="plain small-print">${d.risks.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul></div>`
  + d.funds.map(f => `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${H.esc(f.name)} <span class="mu">${H.esc(d.styles[f.style].name)} · risk ${f.risk}/5 · ${H.esc(f.account)}</span></h2><span>${f.active ? '<span class="pill pos">On</span>' : '<span class="pill">Paused</span>'}</span></div>
      <div class="stats">${stat('Value (start = 100)', n(f.nav, 2), pc(f.nav - 100))}${stat('Longs', f.book.filter(b => b.weight > 0).length)}${stat('Shorts / hedge', f.book.filter(b => b.weight < 0 || b.symbol === 'SH').length)}${stat('Largest fall', f.maxDrawdown == null || !f.history.length ? '-' : `${f.maxDrawdown}%`, 'from a high, real record')}${stat('Last turn', f.last_run ? new Date(f.last_run).toLocaleDateString() : 'not yet')}</div>
      ${spark(f.history || [])}${f.history?.length ? `<p class="mu small-print">${f.account === 'paper' ? 'Practice-money record' : 'Record'} over ${f.history.length} weekly turn${f.history.length === 1 ? '' : 's'}, gains and losses as they happened.</p>` : ''}
      ${f.memo ? `<p>${H.esc(f.memo)}</p>` : ''}
      <div class="row" style="align-items:center;gap:10px"><label class="inline">Protection <select data-hedge="${f.id}">${Object.entries(d.hedges).map(([k, h]) => `<option value="${k}" ${f.hedge === k ? 'selected' : ''}>${H.esc(h.name)}</option>`).join('')}</select></label><span class="mu small-print">${H.esc(d.hedges[f.hedge]?.about || '')}</span>
        <label class="inline">Most in one position <select data-maxw="${f.id}">${[0.1, 0.15, 0.2, 0.25, 0.35, 0.5].map(w => `<option value="${w}" ${Math.abs(f.maxWeight - w) < 1e-6 ? 'selected' : ''}>${Math.round(w * 100)}%</option>`).join('')}</select></label></div>
      ${f.hedgePlan?.buy ? `<div class="banner"><b>Option hedge:</b> ${H.esc(f.hedgePlan.why)} Cost about ${H.money(f.hedgePlan.cost)} (${f.hedgePlan.costPct}% of the longs).${/^alpaca/.test(f.account) ? '' : ' Options trade on an Alpaca account; on practice money this is the plan only.'}</div>` : f.hedgePlan?.note ? `<p class="mu small-print">Option hedge: ${H.esc(f.hedgePlan.note)}</p>` : ''}
      ${f.book.length ? `<div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Weight</th><th>Why</th></tr>${f.book.map(b => `<tr><td><b data-no-tr>${H.esc(b.symbol)}</b> ${b.weight < 0 ? '<span class="pill neg">Short</span>' : b.symbol === 'SH' ? '<span class="pill">Hedge</span>' : '<span class="pill pos">Long</span>'}</td><td class="num">${(b.weight * 100).toFixed(1)}%</td><td class="mu">${H.esc(b.why || '')}</td></tr>`).join('')}</table></div>` : ''}
      ${f.pending ? `<div class="banner">${f.pending.trades.length} trades are waiting for your approval: ${f.pending.trades.slice(0, 8).map(t => `${t.side} ${t.qty} ${H.esc(t.symbol)}`).join(', ')}${f.pending.trades.length > 8 ? '…' : ''} <button type="button" class="small" data-approve="${f.id}">Approve and place</button></div>` : ''}
      <div class="row" style="gap:8px"><button type="button" class="small ghost" data-run="${f.id}">Rebuild now</button><button type="button" class="small ghost" data-pause="${f.id}" data-on="${f.active}">${f.active ? 'Pause' : 'Resume'}</button><button type="button" class="small ghost" data-del="${f.id}">Remove</button></div><p class="ok"></p><div class="err"></div></div>`).join('')
  + `<form class="card" id="nf"><h2>New portfolio</h2><div class="modes">${Object.entries(d.styles).map(([k, s], i) => `<label class="mode ${i ? '' : 'on'}"><input type="radio" name="style" value="${k}" ${i ? '' : 'checked'}><b>${H.esc(s.name)}</b><span class="mu">${H.esc(s.about)}</span></label>`).join('')}</div>
    <div class="row"><label>Name<input name="name" placeholder="My long/short"></label><label>Account<select name="account">${H.accountOptions(accts, 'paper', H.paid())}</select></label><label>Protection<select name="hedge">${Object.entries(d.hedges).map(([k, h]) => `<option value="${k}">${H.esc(h.name)}</option>`).join('')}</select></label><label>Risk<select name="risk">${[1, 2, 3, 4, 5].map(r => `<option value="${r}" ${r === 3 ? 'selected' : ''}>${r}: long ${Math.round(d.exposure[r][0] * 100)}% / short ${Math.round(d.exposure[r][1] * 100)}%</option>`).join('')}</select></label><label>Money to use ($, empty = whole account)<input name="capital" type="number" min="0"></label></div>
    <p><button type="button" class="ghost small" id="btGo">See the hypothetical backtest for this style</button></p><div id="btOut"></div>
    <button>Create</button><div class="err"></div><p class="mu small-print">Shorts need margin switched on for the account (Short selling or Margin center; a real account also needs the brokerage's approval); without it an inverse S&P 500 fund (SH) or puts are the hedge. Rules-based: past behavior does not predict results, and shorts can lose more than they make.</p></form>${NOTE}`;
  const f = H.$('#nf', view);
  H.$$('[name=style]', f).forEach(r => (r.onchange = () => H.$$('.mode', f).forEach(m => m.classList.toggle('on', m.contains(r) ? r.checked : false))));
  H.act(H.$('button', f), async () => { const v = Object.fromEntries(new FormData(f)); const r = await H.api('/aifunds', { body: { ...v, risk: +v.risk, capital: +v.capital || 0 } }); await H.api(`/aifunds/${r.id}/run`, { body: {} }).catch(() => {}); setTimeout(H.render, 300); return 'Created'; });
  const msg = (b, t) => { const c = b.closest('.card'); H.$('.ok', c).textContent = t; };
  H.$$('[data-run]', view).forEach(b => H.act(b, async () => { const r = await H.api(`/aifunds/${b.dataset.run}/run`, { body: {} }); setTimeout(H.render, 800); return r.pending ? `${r.pending.length} trades ready for your approval` : `${(r.placed || []).filter(x => x.ok).length} trades placed`; }, b.closest('.card').querySelector('.ok')));
  H.$$('[data-approve]', view).forEach(b => H.act(b, async () => { if (!confirm('Place these trades in the real account?')) return ''; const r = await H.api(`/aifunds/${b.dataset.approve}/approve`, { body: {} }); setTimeout(H.render, 800); return `${r.placed.filter(x => x.ok).length} of ${r.placed.length} placed`; }, b.closest('.card').querySelector('.ok')));
  H.$$('[data-hedge]', view).forEach(sel => (sel.onchange = async () => { await H.api('/aifunds/' + sel.dataset.hedge, { method: 'PUT', body: { hedge: sel.value } }); await H.api(`/aifunds/${sel.dataset.hedge}/run`, { body: {} }).catch(() => {}); H.render(); }));
  H.$$('[data-maxw]', view).forEach(sel => (sel.onchange = async () => { await H.api('/aifunds/' + sel.dataset.maxw, { method: 'PUT', body: { maxWeight: +sel.value } }); H.render(); }));
  H.$('#btGo', f).onclick = async () => {
    const o = H.$('#btOut', f), v = Object.fromEntries(new FormData(f)); o.innerHTML = '<div class="skel" role="status" aria-label="Loading"><div></div><div class="w60"></div></div>';
    try { const b = await H.api(`/aifunds/backtest?style=${encodeURIComponent(v.style)}&risk=${encodeURIComponent(v.risk)}`);
      o.innerHTML = b.weeks ? `<div class="stats">${stat('Hypothetical result', `${b.total > 0 ? '+' : ''}${b.total}%`, `${b.weeks} weeks`)}${stat('Largest fall', `${b.maxDrawdown}%`)}${stat('Worst week', `${b.worstWeek}%`)}${b.spy != null ? stat('S&P 500 (SPY) same time', `${b.spy > 0 ? '+' : ''}${b.spy}%`) : ''}</div>${spark(b.nav.slice(1).map(x => ({ nav: x })))}<p class="mu small-print">${H.esc(b.note)}</p>` : `<p class="mu">${H.esc(b.note)}</p>`;
    } catch (e) { o.innerHTML = `<p class="err">${H.esc(e.message)}</p>`; }
  };
  H.$$('[data-pause]', view).forEach(b => (b.onclick = async () => { await H.api('/aifunds/' + b.dataset.pause, { method: 'PUT', body: { active: b.dataset.on !== 'true' } }); H.render(); }));
  H.$$('[data-del]', view).forEach(b => (b.onclick = async () => { if (!confirm('Remove this portfolio? Its positions stay in the account.')) return; const r = await H.api('/aifunds/' + b.dataset.del, { method: 'DELETE' }); msg(b, r.note); setTimeout(H.render, 900); }));
}
