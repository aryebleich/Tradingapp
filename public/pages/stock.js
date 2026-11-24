// The stock page sections (Research → Stock & fund analyzer, #/analyze?symbol=X&view=…), the
// comparison (#/analyze/compare) and the growth-at-a-price scanner (#/scanner/valuescan).
// Data: /api/stock (src/stock.js). Every figure says where it comes from; estimates and indicative
// numbers are labelled; nothing here is advice.
let H;
export function registerStock(routes, helpers) { H = helpers; Object.assign(routes, { compare: comparePage, valuescan: valuescanPage, rates: ratesPage }); }

// ---------- rates vs stocks ----------
async function ratesPage(view) {
  view.innerHTML = `<div class="pagehead"><h1>Rates vs stocks</h1><p class="mu" style="margin:4px 0 0">The Fed funds rate, Treasury yields and the yield curve, against the S&amp;P 500 and the sectors that react to rates most.</p></div><div id="rvo"><div class="card"><div class="skel"><div class="h1"></div><div></div><div class="box"></div></div></div></div>`;
  const out = H.$('#rvo', view);
  try {
    const d = await H.api('/rates'), L = d.latest, f = d.fomc;
    const last = s => (s?.length ? s.at(-1)[1] : null), v = x => (x == null ? '-' : `${(+x).toFixed(2)}%`);
    out.innerHTML = card('Today', `<div class="stats">${stat('Fed funds rate', v(L?.fed?.[1]))}${stat('2-year Treasury', v(L?.two?.[1]))}${stat('10-year Treasury', v(L?.ten?.[1]))}${stat('Yield curve (10y − 2y)', L?.curve == null ? '-' : `${L.curve > 0 ? '+' : ''}${L.curve.toFixed(2)} pts`, L?.curve < 0 ? '<b class="neg">inverted</b>' : 'normal')}${stat('Next Fed decision', f.date ? H.esc(f.date) : '-', f.date ? `in ${f.days} days` : H.esc(f.note || ''))}</div><p class="mu small-print">${H.esc(d.note)}${f.date ? ' Meeting date from the Federal Reserve\'s published calendar.' : ''}</p>`)
      + (d.rates ? card('Rates over 6 years', svgLines([{ name: 'Fed funds', values: d.rates.fed.map(x => x[1]), cls: 'a3' }, { name: '2-year', values: d.rates.two.map(x => x[1]), cls: 'a1' }, { name: '10-year', values: d.rates.ten.map(x => x[1]), cls: 'p' }], { label: 'Fed funds rate, 2-year and 10-year yields, month ends' })
        + `<h3>Yield curve (10-year minus 2-year)</h3>${svgLines([{ name: '10y − 2y', values: d.curve.map(x => x[1]), cls: 'p' }], { h: 120, label: 'Yield curve, month ends', levels: [{ v: 0, kind: 'res' }] })}<p class="mu small-print">Below the red line the curve is inverted.</p>`) : '')
      + card('How rates tend to affect stocks', `<div class="cards rates-sec">${d.sectors.map(s => `<div class="card"><h3>${H.esc(s.name)} <span class="mu" data-no-tr>${H.esc(s.symbol)}</span></h3>${s.prices ? svgLines([{ name: s.symbol, values: s.prices.map(x => x[1]), cls: 'p' }], { h: 90, label: `${s.name} price, month ends` }) : '<p class="mu">No price history right now.</p>'}
          <p class="small-print">${H.esc(s.why)}</p>${s.corr10y != null ? `<p class="mu small-print">Over the last 6 years, its monthly returns moved ${Math.abs(s.corr10y) < 0.15 ? 'about independently of' : s.corr10y < 0 ? 'opposite to' : 'with'} monthly changes in the 10-year yield (correlation ${s.corr10y}).</p>` : ''}<p><a href="#/analyze?symbol=${encodeURIComponent(s.symbol)}">Open ${H.esc(s.symbol)} →</a></p></div>`).join('')}</div>
        <ul class="plain">${d.explain.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul><p><a href="#/invest/alpaca-tools">Bonds, rates and crypto →</a> · <a href="#/calendar">Calendar →</a></p>${NOTE}`);
  } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; }
}

export const VIEWS = [['overview', 'Overview'], ['valuation', 'Valuation'], ['fundamentals', 'Fundamentals'], ['earnings', 'Earnings'], ['dividends', 'Dividends'], ['technicals', 'Technicals'], ['supply', 'Supply & demand']];
const NOTE = '<p class="mu small-print">Information and education only, not investment advice. Labels compare the stock with its own history and its sector; they do not predict the price.</p>';
const n = (v, d = 2) => (v == null || !isFinite(v) ? '-' : (+v).toLocaleString('en-US', { maximumFractionDigits: d }));
const big = v => (v == null || !isFinite(v) ? '-' : Math.abs(v) >= 1e12 ? `$${n(v / 1e12, 2)}T` : Math.abs(v) >= 1e9 ? `$${n(v / 1e9, 1)}B` : Math.abs(v) >= 1e6 ? `$${n(v / 1e6, 1)}M` : `$${n(v, 0)}`);
const pct = (v, d = 1) => (v == null ? '-' : `${(+v).toFixed(d)}%`);
const stat = (k, v, sub = '') => `<div class="stat"><span>${k}</span><b>${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
const card = (title, body, extra = '') => `<div class="card"><div class="dash-ch"><h2>${title}</h2>${extra}</div>${body}</div>`;
const lockNote = (what, feature) => `<div class="empty lock"><b>${what}</b><button type="button" class="link" data-upgrade="${H.esc(feature)}">Unlock with Pro</button></div>`;
const LABEL = { cheap: ['Cheap vs its history', 'pos'], fair: ['Fair vs its history', ''], expensive: ['Expensive vs its history', 'neg'], na: ['No comparison', ''] };

// ---------- small SVG charts (theme colours, readable in dark mode, labelled for screen readers) ----------
// Bars as HTML (crisp text at any width, right-to-left aware): value above, label below; negative
// bars hang below the zero line; an optional dashed average line.
function svgBars(items, { h = 140, label = '', fmt = v => n(v), avg = null } = {}) {
  const vals = items.map(x => x.value).filter(v => v != null && isFinite(v)); if (!vals.length) return '<p class="mu">No data.</p>';
  const max = Math.max(...vals, avg || 0, 0), min = Math.min(...vals, 0), span = (max - min) || 1, zero = (max / span) * 100;
  const bar = x => { if (x.value == null) return `<div class="hb"><div class="hb-plot"></div><span class="hb-l">${H.esc(String(x.label))}</span></div>`; const hgt = Math.abs(x.value) / span * 100;
    return `<div class="hb"><div class="hb-plot"><i class="${x.value < 0 ? 'neg' : ''}" style="${x.value < 0 ? `top:${zero}%` : `bottom:${100 - zero}%`};height:${hgt.toFixed(1)}%"><b>${fmt(x.value)}</b></i></div><span class="hb-l">${H.esc(String(x.label))}</span></div>`; };
  return `<div class="hbars" style="--h:${h}px" role="img" aria-label="${H.esc(label)}: ${items.filter(x => x.value != null).map(x => `${x.label} ${fmt(x.value)}`).join(', ')}">${avg != null ? `<div class="hb-layer"><div class="hb-avg" style="bottom:${((avg - min) / span * 100).toFixed(1)}%"><span>average ${fmt(avg)}</span></div></div>` : ''}${items.map(bar).join('')}</div>`;
}
function svgLines(lines, { h = 220, label = '', levels = [] } = {}) {
  const all = lines.flatMap(l => l.values).filter(v => v != null && isFinite(v)); if (!all.length) return '<p class="mu">No data.</p>';
  const max = Math.max(...all, ...levels.map(x => x.v)), min = Math.min(...all, ...levels.map(x => x.v)), len = Math.max(...lines.map(l => l.values.length));
  const X = i => (i / Math.max(1, len - 1)) * 1000, Y = v => 8 + (1 - (v - min) / ((max - min) || 1)) * (h - 16);
  const path = vs => vs.map((v, i) => (v == null ? '' : `${vs[i - 1] == null ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join('');
  return `<svg class="lines" viewBox="0 0 1000 ${h}" preserveAspectRatio="none" width="100%" height="${h}" role="img" aria-label="${H.esc(label)}">${levels.map(l => `<line x1="0" x2="1000" y1="${Y(l.v)}" y2="${Y(l.v)}" class="lvl ${l.kind}"/>`).join('')}${lines.map(l => `<path d="${path(l.values)}" class="ln ${l.cls || ''}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
    <div class="legend">${lines.map(l => `<span><i class="sw ${l.cls || ''}"></i>${H.esc(l.name)}</span>`).join('')}${levels.length ? '<span><i class="sw lvl"></i>support / resistance</span>' : ''}</div>`;
}
const gauge = (v, label) => `<div class="gauge" role="meter" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${v}" aria-label="${H.esc(label)}"><div class="g-track"><i style="left:${(v + 100) / 2}%"></i></div><div class="g-ends"><span>Sellers</span><span>Balanced</span><span>Buyers</span></div></div>`;

// ---------- one section of the stock page ----------
export async function stockSection(helpers, el, sym, view) {
  H = H || helpers;
  el.innerHTML = '<div class="card"><div class="skel" role="status" aria-label="Loading"><div class="h1"></div><div></div><div></div><div class="w60"></div><div class="box"></div></div></div>';
  try {
    if (view === 'technicals' || view === 'supply') { drawTech(el, sym, view, await H.api(`/stock/${encodeURIComponent(sym)}/technicals`)); return related(el, sym, view); }
    const d = await H.api('/stock/' + encodeURIComponent(sym));
    if (d.kind !== 'stock') { el.innerHTML = card('Not available', `<p class="mu">${H.esc(d.note || 'No company filings for this symbol.')}</p><p><a href="#/analyze?symbol=${encodeURIComponent(sym)}&view=technicals">Technicals still work →</a></p>`); return; }
    ({ valuation: drawValuation, fundamentals: drawFundamentals, earnings: drawEarnings, dividends: drawDividends })[view]?.(el, d, sym);
  } catch (e) { el.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; }
  related(el, sym, view);
}
// Each section links to the tools that go with it (docs/archive/STRUCTURE_AUDIT.md, related links).
function related(el, sym, view) {
  const q = encodeURIComponent(sym), REL = {
    valuation: [['scanner/valuescan', 'Growth-at-a-price scanner'], ['research/rates', 'Rates vs stocks'], [`analyze/compare?symbols=${q}`, 'Compare with others']],
    fundamentals: [[`analyze/compare?symbols=${q}`, 'Compare with others'], ['scanner/valuescan', 'Stock scanner']],
    earnings: [['calendar', 'Earnings calendar'], ['analyze/earnings', 'Earnings vs expectations']],
    dividends: [['wealth/dividends', 'Your dividend income'], ['wealth?tab=drip', 'Reinvest dividends']],
    technicals: [[`chart?symbol=${q}`, 'Full chart'], ['bots/intraday', 'AI intraday']], supply: [[`chart?symbol=${q}`, 'Full chart'], ['active', 'Active trading desk']],
  }[view];
  if (REL && H.related) el.insertAdjacentHTML('beforeend', H.related(REL));
  H.$$('[data-upgrade]', el).forEach(b => (b.onclick = () => H.upgrade?.(b.dataset.upgrade)));
}
function drawValuation(el, d, sym) {
  const v = d.valuation, [lab, cls] = LABEL[v.label.id] || LABEL.na;
  el.innerHTML = card('Valuation', `<p class="val-label"><span class="pill ${cls}">${lab}</span> ${H.esc(v.label.text)}</p>
    <div class="stats">${stat('Trailing P/E', n(v.pe, 1), 'last 4 quarters')}${stat('Forward P/E', v.forwardPe != null ? n(v.forwardPe, 1) : '-', v.forwardPe != null ? 'next quarter\'s estimate × 4' : 'needs analyst estimates')}${stat('PEG', n(v.peg, 2), 'P/E ÷ EPS growth')}
      ${stat('P/S', n(v.ps, 2), 'price ÷ sales')}${stat('EV/EBITDA', n(v.evEbitda, 1))}${stat('Market value', big(v.marketCap))}</div>
    <div class="grid2 val-cmp"><div><h3>Against its own history</h3><p>${v.avg5 != null ? `P/E <b>${n(v.pe, 1)}</b> against a ${v.history.length}-year average of <b>${n(v.avg5, 1)}</b> (${n((v.vsOwn - 1) * 100, 0)}% ${v.vsOwn >= 1 ? 'above' : 'below'}).` : 'Not enough years of P/E history.'}</p></div>
      <div><h3>Against its sector</h3><p>${v.sectorPE != null ? `P/E <b>${n(v.pe, 1)}</b> against <b>${n(v.sectorPE, 1)}</b>, the median of large ${H.esc(d.sector || 'same-industry')} companies (${n((v.vsSector - 1) * 100, 0)}% ${v.vsSector >= 1 ? 'above' : 'below'}).` : 'No sector comparison: too few large companies in its SEC industry group.'}</p></div></div>
    <h3>P/E at each fiscal year end</h3>${svgBars(v.history.map(h => ({ label: h.year, value: h.pe })), { label: `P/E by year for ${sym}`, avg: v.avg5, fmt: x => n(x, 1) })}
    ${d.locked ? lockNote('Showing 2 years. The 5-year P/E history and chart are in Pro.', '5-year valuation history') : ''}
    <details class="method"><summary>How this is worked out</summary><p class="mu">${H.esc(v.method)}</p></details>${NOTE}`);
}
function drawFundamentals(el, d) {
  const rows = d.statements.rows, R = d.ratios, s = d.summary || {};
  const line = (label, key, f = big) => `<tr><th scope="row">${label}</th>${rows.map(r => `<td class="num">${f(r[key])}</td>`).join('')}</tr>`;
  const head = `<tr><th scope="col"></th>${rows.map(r => `<th scope="col" class="num">${r.year}</th>`).join('')}</tr>`;
  const tbl = (title, body) => `<h3>${title}</h3><div class="tablewrap" tabindex="0" role="region" aria-label="${title}"><table class="slim fin"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  const rr = R.byYear.slice(-rows.length);
  el.innerHTML = card('Strengths and risks', `${s.summary ? `<p>${H.esc(s.summary)}</p>` : ''}<div class="grid2"><div><h3>Strengths</h3><ul class="ticks">${(s.strengths || []).map(x => `<li>${H.esc(x)}</li>`).join('') || '<li class="mu">Nothing stands out.</li>'}</ul></div>
      <div><h3>Risks</h3><ul class="plain risks">${(s.risks || []).map(x => `<li>${H.esc(x)}</li>`).join('') || '<li class="mu">Nothing stands out.</li>'}</ul></div></div><p class="mu small-print">${s.by === 'ai' ? 'Written by AI from the figures below; it can be wrong.' : 'From fixed rules on the figures below.'} Not investment advice.</p>
      ${!d.paid ? lockNote('The AI summary is part of Pro; these points come from fixed rules.', 'AI company summary') : ''}`)
    + card('Financial statements', `${tbl('Income', line('Revenue', 'revenue') + line('Gross profit', 'grossProfit') + line('Operating income', 'operatingIncome') + line('Net income', 'netIncome') + line('EPS (diluted)', 'eps', v => (v == null ? '-' : '$' + n(v, 2))))}
      ${tbl('Balance sheet', line('Assets', 'assets') + line('Liabilities', 'liabilities') + line('Equity', 'equity') + line('Cash', 'cash') + line('Long-term debt', 'debt'))}
      ${tbl('Cash flow', line('From operations', 'ocf') + line('Capital spending', 'capex') + line('Free cash flow', 'fcf') + line('Dividends paid', 'dividendsPaid'))}
      ${d.locked ? lockNote('Showing 2 years. Five-year trends are in Pro.', '5-year financial statements') : ''}<p class="mu small-print">From the company's annual reports filed with the SEC (10-K). Fiscal years.</p>`)
    + card('Key ratios', `<div class="stats">${stat('Revenue growth', pct(R.revenueGrowth), `a year over ${R.revenueYears} years · ${R.revenueTrend || ''}`)}${stat('EPS growth', pct(R.epsGrowth), 'a year')}${stat('Gross margin', pct(R.latest.grossMargin))}${stat('Net margin', pct(R.latest.netMargin))}${stat('Return on equity', pct(R.latest.roe))}${stat('Debt / equity', n(R.latest.debtToEquity, 2))}${stat('Free cash flow margin', pct(R.latest.fcfMargin))}${stat('Current ratio', n(R.latest.currentRatio, 2))}</div>
      <h3>Net margin by year</h3>${svgBars(rr.map(x => ({ label: x.year, value: x.netMargin })), { label: 'Net margin by year', fmt: x => n(x, 1) + '%' })}${NOTE}`);
}
function drawEarnings(el, d, sym) {
  const e = d.earnings, nx = e.next;
  el.innerHTML = card('Next report', `<p class="big">${nx ? `<b>${H.esc(nx.date)}</b> ${nx.estimated ? '<span class="pill">estimated</span>' : '<span class="pill pos">confirmed</span>'}` : 'Not known'}</p>
      ${e.upcoming?.epsEstimate != null ? `<p>Analysts expect EPS <b>$${n(e.upcoming.epsEstimate, 2)}</b>${e.upcoming.revenueEstimate ? ` and revenue <b>${big(e.upcoming.revenueEstimate)}</b>` : ''}.</p>` : ''}
      <p class="mu small-print">${H.esc(e.note)}${nx?.estimated ? ' The estimated date is about 91 days after the last report.' : ''}</p><p><a href="#/calendar">See it in the calendar →</a></p>`)
    + (e.estimates?.length ? card('Expected vs actual', `<div class="tablewrap"><table class="slim"><thead><tr><th>Quarter</th><th class="num">Expected EPS</th><th class="num">Reported EPS</th><th class="num">Surprise</th></tr></thead><tbody>${e.estimates.map(h => `<tr><td>${H.esc(h.period || '')}</td><td class="num">${h.estimate != null ? '$' + n(h.estimate, 2) : '-'}</td><td class="num">${h.eps != null ? '$' + n(h.eps, 2) : '-'}</td><td class="num ${h.surprisePct > 0 ? 'pos' : h.surprisePct < 0 ? 'neg' : ''}">${h.surprisePct != null ? (h.surprisePct > 0 ? '+' : '') + n(h.surprisePct, 1) + '%' : '-'}</td></tr>`).join('')}</tbody></table></div>`) : '')
    + card('After past reports', `<p class="mu" style="margin-top:0">Price change from the close before each report to the close the day after.</p>${svgBars(e.reports.slice(-8).map(r => ({ label: r.date.slice(2, 7), value: r.move })), { label: `Price moves after earnings for ${sym}`, fmt: x => (x > 0 ? '+' : '') + n(x, 1) + '%' })}
      <h3>Earnings per share by quarter</h3>${svgBars(e.quarters.slice(-8).map(x => ({ label: x.end.slice(2, 7), value: x.eps })), { label: 'EPS by quarter', fmt: x => '$' + n(x, 2) })}<p class="mu small-print">Report dates are the company's "Results of operations" filings with the SEC (8-K item 2.02). Past moves do not predict future ones.</p>${NOTE}`);
}
function drawDividends(el, d) {
  const v = d.dividends;
  if (!v.pays) { el.innerHTML = card('Dividends', `<div class="empty"><b>${H.esc(v.note)}</b><a href="#/wealth/dividends">See dividend payers →</a></div>`); return; }
  const sf = v.safety;
  el.innerHTML = card('Dividend', `<div class="stats">${stat('Yield', pct(v.yieldPct, 2), 'yearly dividend ÷ price')}${stat('Per share', '$' + n(v.dps, 2), `fiscal ${v.year}`)}${stat('Payout ratio', pct(v.payout, 0), 'of earnings')}${stat('Growth', pct(v.growth), 'a year')}${stat('Increases in a row', String(v.streak), 'years')}</div>
      <h3>Dividend per share by year</h3>${svgBars(v.history.map(x => ({ label: x.year, value: x.dps })), { label: 'Dividend per share by year', fmt: x => '$' + n(x, 2) })}
      <p><a href="#/wealth?tab=drip">Reinvest dividends automatically (DRIP) →</a> · <a href="#/wealth/dividends">Dividend calendar and your income forecast →</a></p>`)
    + card('Dividend safety', `<p><span class="pill ${sf.score >= 70 ? 'pos' : sf.score >= 45 ? '' : 'neg'}">${sf.score} / 100 · ${H.esc(sf.label)}</span></p>
      <div class="tablewrap"><table class="slim"><tbody>${sf.parts.map(p => `<tr><th scope="row">${H.esc(p.name)}</th><td>${H.esc(p.detail)}</td><td class="num">${p.points}</td></tr>`).join('')}</tbody></table></div>
      <p class="mu small-print">A score from five checks on the latest annual report. It is not a forecast: companies can cut or stop dividends at any time.</p>${NOTE}`);
}
function drawTech(el, sym, view, d) {
  const b = d.bars || [], c = b.map(x => x.c), t = d.technical, s = d.supply;
  const avg = k => c.map((_, i) => (i + 1 < k ? null : c.slice(i + 1 - k, i + 1).reduce((a, x) => a + x, 0) / k));
  if (view === 'technicals') {
    const rsi = (() => { const out = c.map(() => null); for (let i = 15; i < c.length; i++) { let g = 0, l = 0; for (let j = i - 13; j <= i; j++) { const dd = c[j] - c[j - 1]; if (dd > 0) g += dd; else l -= dd; } out[i] = l ? 100 - 100 / (1 + g / l) : 100; } return out; })();
    el.innerHTML = card(`Technical read <span class="mu">${H.esc(sym)}</span>`, `<p>${H.esc(t.read)}</p><div class="stats">${stat('Price', H.money(t.price))}${stat('20-day', H.money(t.sma20))}${stat('50-day', H.money(t.sma50))}${stat('200-day', H.money(t.sma200))}${stat('RSI (14)', n(t.rsi, 0))}${stat('MACD / signal', `${n(t.macd, 2)} / ${n(t.signal, 2)}`)}</div>`)
      + card('Price and averages', `${svgLines([{ name: 'Price', values: c, cls: 'p' }, { name: '20-day', values: avg(20), cls: 'a1' }, { name: '50-day', values: avg(50), cls: 'a2' }, { name: '200-day', values: avg(200), cls: 'a3' }], { label: `Price of ${sym} with moving averages`, levels: [...t.support.map(v => ({ v, kind: 'sup' })), ...t.resistance.map(v => ({ v, kind: 'res' }))] })}
        ${b[0]?.v != null ? `<h3>Volume</h3>${svgBars(b.slice(-40).map(x => ({ label: '', value: x.v })), { h: 80, label: 'Daily volume, last 40 days', fmt: () => '' })}` : ''}
        <h3>RSI (14)</h3>${svgLines([{ name: 'RSI', values: rsi.slice(-260), cls: 'p' }], { h: 90, label: 'RSI', levels: [{ v: 70, kind: 'res' }, { v: 30, kind: 'sup' }] })}
        <p><a href="#/chart?symbol=${encodeURIComponent(sym)}">Open the full chart with every indicator →</a></p><p class="mu small-print">Data: ${H.esc(d.source || '')}${d.full ? '' : ' (daily closes only: volume and ranges need market data)'}. ${H.esc(t.note)}</p>${NOTE}`);
    return;
  }
  if (!s.available) { el.innerHTML = card('Supply & demand', `<div class="empty"><b>${H.esc(s.note)}</b><a href="#/analyze?symbol=${encodeURIComponent(sym)}&view=technicals">See technicals →</a></div>`); return; }
  const maxV = Math.max(...(s.profile || [{ volume: 1 }]).map(p => p.volume));
  el.innerHTML = card(`Who is in control <span class="mu">${H.esc(sym)}</span>`, `<p class="big"><b>${H.esc(s.control)}</b> <span class="mu">(last 20 days)</span></p>${gauge(s.gauge, 'Buyers or sellers in control')}
      <div class="stats">${stat('Estimated buying', pct(s.buyPct, 0), 'of volume')}${stat('Estimated selling', pct(s.sellPct, 0), 'of volume')}${stat('Today vs normal volume', s.unusual ? n(s.unusual.ratio, 1) + '×' : '-', s.unusual?.flag ? '<b class="neg">unusual</b>' : '20-day average')}
        ${s.top ? stat('Bid / ask', `${H.money(s.top.bid)} / ${H.money(s.top.ask)}`, `sizes ${s.top.bidSize ?? '-'} / ${s.top.askSize ?? '-'} · spread ${s.top.spread ?? '-'}`) : stat('Bid / ask', '-', 'needs market data')}</div>`)
    + card('Volume profile', `<p class="mu" style="margin-top:0">Where most trading happened over the last 120 days. Busiest level: <b>${H.money(s.poc.from)}–${H.money(s.poc.to)}</b>.</p>
      ${s.profile ? `<div class="vprofile" role="img" aria-label="Volume by price level">${[...s.profile].reverse().map(p => `<div class="vp-row"><span class="vp-px">${H.money(p.from)}</span><i style="width:${(p.volume / maxV * 100).toFixed(1)}%" class="${p.from === s.poc.from ? 'poc' : ''}"></i></div>`).join('')}</div>` : lockNote('The full volume profile is part of Pro; the busiest level is shown above.', 'Volume profile')}
      <p class="mu small-print">${H.esc(s.note)}</p>${NOTE}`);
}

// ---------- compare 2–4 stocks ----------
async function comparePage(view, q) {
  const syms = (q.get('symbols') || 'AAPL,MSFT').toUpperCase();
  view.innerHTML = `<div class="pagehead"><h1>Compare stocks</h1><p class="mu" style="margin:4px 0 0">Valuation, growth, profitability and dividends side by side.</p></div>
    <form class="card row" id="cmpf" style="align-items:flex-end"><label style="flex:1">Two to four symbols<input name="s" value="${H.esc(syms)}" data-no-tr autocomplete="off" required></label><button>Compare</button></form><div id="cmpo"></div>`;
  H.$('#cmpf', view).onsubmit = e => { e.preventDefault(); location.hash = '#/analyze/compare?symbols=' + encodeURIComponent(H.$('[name=s]', view).value.replace(/\s+/g, '')); };
  const out = H.$('#cmpo', view); out.innerHTML = '<div class="card"><div class="skel"><div></div><div></div><div class="w60"></div></div></div>';
  try {
    const d = await H.api('/stock/compare?symbols=' + encodeURIComponent(syms));
    const rows = [['Sector', r => H.esc(r.sector || '-')], ['Price', r => H.money(r.price)], ['Market value', r => big(r.marketCap)], ['P/E', r => n(r.pe, 1)], ['5-year average P/E', r => n(r.avg5, 1)], ['Valuation', r => (LABEL[r.peLabel] || LABEL.na)[0]], ['P/S', r => n(r.ps, 2)], ['EV/EBITDA', r => n(r.evEbitda, 1)], ['Revenue growth', r => pct(r.revenueGrowth)], ['EPS growth', r => pct(r.epsGrowth)], ['Net margin', r => pct(r.netMargin)], ['Return on equity', r => pct(r.roe)], ['Debt / equity', r => n(r.debtToEquity, 2)], ['Dividend yield', r => pct(r.dividendYield, 2)]];
    out.innerHTML = card('Side by side', `<div class="tablewrap" tabindex="0" role="region" aria-label="Comparison"><table class="slim cmp"><thead><tr><th scope="col"></th>${d.rows.map(r => `<th scope="col"><a href="#/analyze?symbol=${encodeURIComponent(r.symbol)}" data-no-tr>${H.esc(r.symbol)}</a></th>`).join('')}</tr></thead>
      <tbody>${rows.map(([k, f]) => `<tr><th scope="row">${k}</th>${d.rows.map(r => `<td>${r.error ? '<span class="mu">-</span>' : f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${d.rows.some(r => r.error) ? `<p class="mu small-print">${d.rows.filter(r => r.error).map(r => `${H.esc(r.symbol)}: ${H.esc(r.error)}`).join(' · ')}</p>` : ''}<p><a href="#/ai/aitools">Head to head with AI →</a></p>${NOTE}`);
  } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; }
}

// ---------- growth-at-a-price scanner ----------
const FLABEL = { peMin: 'P/E at least', peMax: 'P/E at most', epsGrowthMin: 'EPS growth at least (% a year)', revenueGrowthMin: 'Revenue growth at least (% a year)', netMarginMin: 'Net margin at least (%)', beatsMin: 'Earnings beats in the last 4 (needs estimates)', dividendYieldMin: 'Dividend yield at least (%)' };
async function valuescanPage(view, q) {
  const [{ presets }, saved] = await Promise.all([H.api('/stock/presets'), H.api('/stock/filters').catch(() => ({ saved: [], paid: false }))]);
  const pick = q.get('preset') || 'growth';
  view.innerHTML = `<div class="pagehead"><h1>Growth at a price</h1><p class="mu" style="margin:4px 0 0">High P/E is not always too much: these screens check whether earnings, revenue, margins and cash flow back the price. Large US stocks, from SEC filings.</p></div>
    <div class="chips" role="group" aria-label="Presets">${Object.entries(presets).map(([k, p]) => `<button type="button" data-preset="${k}" class="${k === pick ? 'on' : ''}" title="${H.esc(p.about)}">${H.esc(p.name)}</button>`).join('')}<button type="button" data-preset="custom" class="${pick === 'custom' ? 'on' : ''}">Your own filters</button></div>
    <form class="card" id="vf"><div class="row">${Object.entries(FLABEL).map(([k, t]) => `<label>${t}<input name="${k}" type="number" step="any"></label>`).join('')}</div>
      <div class="row"><label class="chk"><input type="checkbox" name="fcfPositive"> Positive free cash flow</label><label class="chk"><input type="checkbox" name="weakening"> Earnings falling or revenue slowing</label></div>
      <div class="row" style="gap:8px"><button>Run</button><input name="name" placeholder="Name, to save these filters" style="max-width:240px"><label class="chk"><input type="checkbox" name="alert"> Tell me about new matches</label><button type="button" class="ghost" id="vsave">Save</button></div><div class="err"></div></form>
    ${saved.saved.length ? card('Your saved filters', `<ul class="plain">${saved.saved.map(s => `<li><a href="#" data-load="${H.esc(s.name)}">${H.esc(s.name)}</a>${s.alert ? ' <span class="pill">alerts on</span>' : ''} <button type="button" class="link small" data-del="${H.esc(s.name)}">Remove</button></li>`).join('')}</ul>`) : ''}
    <div id="vo"></div>`;
  const f = H.$('#vf', view), out = H.$('#vo', view);
  const fill = filters => { for (const el of H.$$('input', f)) if (el.name in FLABEL) el.value = filters[el.name] ?? ''; f.fcfPositive.checked = !!filters.fcfPositive; f.weakening.checked = !!filters.weakening; };
  const read = () => { const v = H.form(f), o = {}; for (const k of Object.keys(FLABEL)) if (v[k] !== '') o[k] = +v[k]; if (v.fcfPositive) o.fcfPositive = true; if (v.weakening) o.weakening = true; return o; };
  const runScan = async body => {
    out.innerHTML = '<div class="card"><p class="mu" role="status">Checking about 100 large stocks… the first run of the day takes a little longer.</p><div class="skel"><div></div><div></div><div></div></div></div>';
    try {
      const d = await H.api('/stock/scan', { body }); fill(d.filters);
      out.innerHTML = card(`${d.rows.length} match${d.rows.length === 1 ? '' : 'es'} <span class="mu">of ${d.scanned} checked</span>`, d.rows.length ? `<div class="tablewrap" tabindex="0" role="region" aria-label="Matches"><table class="slim"><thead><tr><th>Symbol</th><th class="num">P/E</th><th class="num">EPS growth</th><th class="num">Revenue growth</th><th class="num">Net margin</th><th>Revenue trend</th><th>Valuation</th><th></th></tr></thead><tbody>
        ${d.rows.map(r => `<tr><td><a href="#/analyze?symbol=${encodeURIComponent(r.symbol)}" data-no-tr><b>${H.esc(r.symbol)}</b></a><small class="mu pos-sub">${H.esc(r.name || '')}</small></td><td class="num">${n(r.pe, 1)}</td><td class="num">${pct(r.epsGrowth)}</td><td class="num">${pct(r.revenueGrowth)}</td><td class="num">${pct(r.netMargin)}</td><td>${H.esc(r.revenueTrend || '-')}</td><td>${(LABEL[r.peLabel] || LABEL.na)[0]}</td><td><a href="#/analyze?symbol=${encodeURIComponent(r.symbol)}&view=valuation">Valuation →</a></td></tr>`).join('')}</tbody></table></div>
        <p class="row" style="align-items:center;gap:8px"><button type="button" class="small ghost" id="vsWl">Save these ${d.rows.length} as a watchlist</button><span class="mu small-print">or set a <a href="#/schedule">price alert</a>; saved filters can alert you daily.</span></p><p class="small-print" id="vsWlMsg" role="status"></p>` : '<div class="empty"><b>No matches.</b><span>Loosen a filter, or try another preset.</span></div>') + NOTE;
      const wl = H.$('#vsWl', out);
      if (wl) wl.onclick = async () => {
        const msg = H.$('#vsWlMsg', out), name = `Scanner ${new Date().toISOString().slice(0, 10)}`;
        try { const w = await H.api('/alpaca/watchlists', { body: { name, symbols: d.rows.slice(0, 50).map(r => r.symbol) } }); msg.innerHTML = `Saved as "${H.esc(name)}". <a href="#/watchlists?id=${encodeURIComponent(w.id)}">Open it →</a>`; }
        catch (e) { msg.innerHTML = /connect|No Alpaca|not connected|409/i.test(e.message) ? 'Watchlists are kept in your Alpaca account. <a href="#/accounts">Connect Alpaca →</a>' : `<span class="err">${H.esc(e.message)}</span>`; }
      };
    } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; }
  };
  H.$$('[data-preset]', view).forEach(b => (b.onclick = () => { H.$$('[data-preset]', view).forEach(x => x.classList.toggle('on', x === b)); if (b.dataset.preset === 'custom') { fill({}); out.innerHTML = ''; } else runScan({ preset: b.dataset.preset }); }));
  f.onsubmit = e => { e.preventDefault(); runScan({ filters: read() }); };
  H.act(H.$('#vsave', view), async () => { await H.api('/stock/filters', { body: { name: f.name.value, filters: read(), alert: f.alert.checked } }); H.render(); return 'Saved'; }, H.$('.err', f));
  H.$$('[data-load]', view).forEach(a => (a.onclick = e => { e.preventDefault(); const s = saved.saved.find(x => x.name === a.dataset.load); if (s) { fill(s.filters); runScan({ filters: s.filters }); } }));
  H.$$('[data-del]', view).forEach(b => H.act(b, async () => { await H.api('/stock/filters/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); H.render(); return ''; }));
  if (pick !== 'custom') runScan({ preset: pick });
}
