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
  <div class="card"><div class="tablewrap"><table><tr><th>Fund</th><th>Holds</th><th>Type</th><th class="num">Yearly cost</th><th class="num">Per $10,000</th><th class="num">Minimum</th><th class="num" title="On $100,000 growing 7% a year for 30 years">Cost over 30 years</th><th></th></tr>
  ${list.map(f => `<tr><td><a href="#/analyze?symbol=${f.symbol}"><b data-no-tr>${f.symbol}</b></a><br><small class="mu" data-no-tr>${H.esc(f.name)}</small></td><td>${H.esc(f.holds)}</td><td>${H.esc(f.kind)}<br><small class="mu">${H.esc(f.managed)}</small></td><td class="num">${f.cost}%</td><td class="num">$${n(f.per10k)}</td><td class="num">${f.min ? H.money(f.min) : 'None'}</td><td class="num">${H.money(f.cost30y)}</td><td>${f.kind === 'ETF' ? `<a href="#/trade?symbol=${f.symbol}"><button type="button" class="small ghost">Trade</button></a>` : `<a href="#/invest?tab=funds"><button type="button" class="small ghost">Practice</button></a>`}</td></tr>`).join('')}</table></div>
  <p class="mu small-print">Costs and minimums as published by each fund company in 2025; check the fund's own page before investing. Mutual funds are bought through the fund company or a brokerage that offers them (Alpaca does not); each has an ETF twin that trades like a stock. Dividends can be reinvested automatically in both.</p></div>${NOTE}`;
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

// ---------- short the market ----------
async function shortPage(view, q) {
  const accts = await H.accounts(), account = q.get('account') || H.state.account || 'paper';
  const d = await H.api('/invest/short?account=' + encodeURIComponent(account));
  view.innerHTML = head('Short the market', 'Ways to profit when prices fall, and which of them this account can use.')
  + `<div class="card row" style="align-items:center;justify-content:space-between"><label class="inline">Account <select id="sacct">${H.accountOptions(accts, account)}</select></label><span class="mu">Equity ${d.equity != null ? H.money(d.equity) : '-'}</span></div>
  <div class="cards">${d.paths.map(p => `<div class="card"><h2>${p.title} ${p.available ? '<span class="pill pos">Available</span>' : '<span class="pill">Not on this account</span>'}</h2><p>${H.esc(p.how)}</p><p class="mu small-print"><b>Risk:</b> ${H.esc(p.risk)}</p>${{ short: `<a href="#/trade"><button type="button" class="small">Open Trade</button></a>`, futures: `<a href="#/invest?tab=futures"><button type="button" class="small">Futures (practice)</button></a>`, puts: `<a href="#/options"><button type="button" class="small">Options chain</button></a>`, inverse: '' }[p.id]}</div>`).join('')}</div>
  <div class="card"><h2>Inverse ETFs</h2><div class="tablewrap"><table><tr><th>Fund</th><th>Moves opposite to</th><th class="num">Daily multiple</th><th class="num">Price</th><th></th></tr>${d.inverse.map(x => `<tr><td><b data-no-tr>${x.symbol}</b></td><td>${H.esc(x.index)}</td><td class="num">${x.leverage}x</td><td class="num">${x.price ? H.money(x.price) : '-'}</td><td><a href="#/trade?symbol=${x.symbol}"><button type="button" class="small ghost">Trade</button></a></td></tr>`).join('')}</table></div>
    <p class="mu small-print">2x and 3x funds multiply each day's move; over several days the result can differ a lot from 2x or 3x the index.</p></div>
  ${d.shorts.length ? `<div class="card"><h2>Your shorts</h2><div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Shares</th><th class="num">Price</th><th class="num">P/L</th></tr>${d.shorts.map(s => `<tr><td>${H.esc(s.symbol)}</td><td class="num">${s.qty}</td><td class="num">${H.money(s.price)}</td><td class="num ${H.cls(s.pnl)}">${H.money(s.pnl)}</td></tr>`).join('')}</table></div><p class="mu small-print">To close a short, buy the same number of shares.</p></div>` : ''}${NOTE}`;
  H.$('#sacct', view).onchange = e => (location.hash = '#/short?account=' + e.target.value);
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
  H.$('#macct', view).onchange = e => (location.hash = `#/margin?account=${e.target.value}&symbol=${sym}`);
  H.$('#qf', view).onsubmit = e => { e.preventDefault(); location.hash = `#/margin?account=${account}&symbol=${encodeURIComponent(H.$('[name=s]', e.target).value.trim().toUpperCase())}`; };
}

// ---------- AI long/short portfolios ----------
async function aifunds(view) {
  const [d, accts] = await Promise.all([H.api('/aifunds'), H.accounts()]);
  view.innerHTML = head('AI long/short portfolios', 'Hedge-fund style rules in your own account: long the strongest, short the weakest (or hedge with an inverse fund), rebuilt every week with an AI memo. Automatic on practice money; on a real account you approve each set of trades.')
  + d.funds.map(f => `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${H.esc(f.name)} <span class="mu">${H.esc(d.styles[f.style].name)} · risk ${f.risk}/5 · ${H.esc(f.account)}</span></h2><span>${f.active ? '<span class="pill pos">On</span>' : '<span class="pill">Paused</span>'}</span></div>
      <div class="stats">${stat('Value (start = 100)', n(f.nav, 2), pc(f.nav - 100))}${stat('Longs', f.book.filter(b => b.weight > 0).length)}${stat('Shorts / hedge', f.book.filter(b => b.weight < 0 || b.symbol === 'SH').length)}${stat('Last turn', f.last_run ? new Date(f.last_run).toLocaleDateString() : 'not yet')}</div>
      ${f.memo ? `<p>${H.esc(f.memo)}</p>` : ''}
      ${f.book.length ? `<div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Weight</th><th>Why</th></tr>${f.book.map(b => `<tr><td><b data-no-tr>${H.esc(b.symbol)}</b> ${b.weight < 0 ? '<span class="pill neg">Short</span>' : b.symbol === 'SH' ? '<span class="pill">Hedge</span>' : '<span class="pill pos">Long</span>'}</td><td class="num">${(b.weight * 100).toFixed(1)}%</td><td class="mu">${H.esc(b.why || '')}</td></tr>`).join('')}</table></div>` : ''}
      ${f.pending ? `<div class="banner">${f.pending.trades.length} trades are waiting for your approval: ${f.pending.trades.slice(0, 8).map(t => `${t.side} ${t.qty} ${H.esc(t.symbol)}`).join(', ')}${f.pending.trades.length > 8 ? '…' : ''} <button type="button" class="small" data-approve="${f.id}">Approve and place</button></div>` : ''}
      <div class="row" style="gap:8px"><button type="button" class="small ghost" data-run="${f.id}">Rebuild now</button><button type="button" class="small ghost" data-pause="${f.id}" data-on="${f.active}">${f.active ? 'Pause' : 'Resume'}</button><button type="button" class="small ghost" data-del="${f.id}">Remove</button></div><p class="ok"></p><div class="err"></div></div>`).join('')
  + `<form class="card" id="nf"><h2>New portfolio</h2><div class="modes">${Object.entries(d.styles).map(([k, s], i) => `<label class="mode ${i ? '' : 'on'}"><input type="radio" name="style" value="${k}" ${i ? '' : 'checked'}><b>${H.esc(s.name)}</b><span class="mu">${H.esc(s.about)}</span></label>`).join('')}</div>
    <div class="row"><label>Name<input name="name" placeholder="My long/short"></label><label>Account<select name="account">${H.accountOptions(accts, 'paper', H.paid())}</select></label><label>Risk<select name="risk">${[1, 2, 3, 4, 5].map(r => `<option value="${r}" ${r === 3 ? 'selected' : ''}>${r}: long ${Math.round(d.exposure[r][0] * 100)}% / short ${Math.round(d.exposure[r][1] * 100)}%</option>`).join('')}</select></label><label>Money to use ($, empty = whole account)<input name="capital" type="number" min="0"></label></div>
    <button>Create</button><div class="err"></div><p class="mu small-print">Shorting a real account needs a margin account with $2,000 or more; below that, an inverse S&P 500 fund (SH) is the hedge. Rules-based: past behavior does not predict results, and shorts can lose more than they make.</p></form>${NOTE}`;
  const f = H.$('#nf', view);
  H.$$('[name=style]', f).forEach(r => (r.onchange = () => H.$$('.mode', f).forEach(m => m.classList.toggle('on', m.contains(r) ? r.checked : false))));
  H.act(H.$('button', f), async () => { const v = Object.fromEntries(new FormData(f)); const r = await H.api('/aifunds', { body: { ...v, risk: +v.risk, capital: +v.capital || 0 } }); await H.api(`/aifunds/${r.id}/run`, { body: {} }).catch(() => {}); setTimeout(H.render, 300); return 'Created'; });
  const msg = (b, t) => { const c = b.closest('.card'); H.$('.ok', c).textContent = t; };
  H.$$('[data-run]', view).forEach(b => H.act(b, async () => { const r = await H.api(`/aifunds/${b.dataset.run}/run`, { body: {} }); setTimeout(H.render, 800); return r.pending ? `${r.pending.length} trades ready for your approval` : `${(r.placed || []).filter(x => x.ok).length} trades placed`; }, b.closest('.card').querySelector('.ok')));
  H.$$('[data-approve]', view).forEach(b => H.act(b, async () => { if (!confirm('Place these trades in the real account?')) return ''; const r = await H.api(`/aifunds/${b.dataset.approve}/approve`, { body: {} }); setTimeout(H.render, 800); return `${r.placed.filter(x => x.ok).length} of ${r.placed.length} placed`; }, b.closest('.card').querySelector('.ok')));
  H.$$('[data-pause]', view).forEach(b => (b.onclick = async () => { await H.api('/aifunds/' + b.dataset.pause, { method: 'PUT', body: { active: b.dataset.on !== 'true' } }); H.render(); }));
  H.$$('[data-del]', view).forEach(b => (b.onclick = async () => { if (!confirm('Remove this portfolio? Its positions stay in the account.')) return; const r = await H.api('/aifunds/' + b.dataset.del, { method: 'DELETE' }); msg(b, r.note); setTimeout(H.render, 900); }));
}
