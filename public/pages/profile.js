// "About this stock / ETF": what it is, its size (market-cap class, blue chip), valuation and
// growth from its SEC filings, how the price has behaved (returns, 52-week range, volatility,
// drawdown, beta), and for ETFs the index, the yearly cost and what $10,000 costs a year.
const big = v => (v == null ? '-' : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v)}`);
export async function profileCard(box, symbol, H) {
  if (!box) return;
  if (symbol.includes('/')) { box.remove(); return; }
  box.innerHTML = `<h2>About ${H.esc(symbol)}</h2><p class="mu">Loading…</p>`;
  const p = await H.api('/fundamentals/profile/' + encodeURIComponent(symbol)).catch(e => ({ error: e.message }));
  if (!box.isConnected) return;
  if (p.error) { box.innerHTML = `<h2>About ${H.esc(symbol)}</h2><p class="mu">${H.esc(p.error)}</p>`; return; }
  const st = (k, v, c = '', tip = '') => `<div class="stat"${tip ? ` title="${H.esc(tip)}"` : ''}><span>${k}</span><b class="${c}">${v}</b></div>`;
  const pc = v => (v == null ? '-' : `${v >= 0 ? '+' : ''}${v}%`), f = p.perf, r = p.ratios, fd = p.fundamentals, cc = r?.capClass;
  box.innerHTML = `<h2>About ${H.esc(symbol)} <span class="mu" style="font-weight:400">${H.esc(p.name)}</span></h2>
    <div class="chips" style="margin:4px 0 10px">${p.kind === 'etf' ? `<span class="pill">ETF</span><span class="pill">${H.esc(p.etf.about)}</span>` : ''}${cc ? `<span class="pill cap-${cc.id}" title="${H.esc(cc.about)}">${H.esc(cc.name)}</span>` : ''}${p.blueChip ? '<span class="pill blue">Blue chip</span>' : ''}${p.style ? `<span class="pill">${H.esc(p.style)}</span>` : ''}${p.company?.industry ? `<span class="pill">${H.esc(p.company.industry)}</span>` : ''}${p.company?.exchanges?.length ? `<span class="pill">${H.esc(p.company.exchanges.join(', '))}</span>` : ''}</div>
    ${p.kind === 'etf' ? `<div class="stats">${st('Tracks', H.esc(p.etf.index))}${st('Yearly cost (expense ratio)', p.etf.expenseRatio + '%', '', 'Taken from the fund each year')}${st('Cost on $10,000 a year', '$' + (p.etf.expenseRatio * 100).toFixed(2))}${st('Issuer', H.esc(p.etf.issuer))}</div>` : ''}
    ${r ? `<div class="stats">${st('Market cap', big(r.marketCap), '', cc?.about || '')}${st('P/E', r.pe ?? '-', '', 'Price divided by last year\'s earnings per share')}${st('Price / book', r.pb ?? '-')}${st('Price / sales', r.ps ?? '-')}${st('Profit margin', r.netMargin == null ? '-' : r.netMargin + '%')}${st(`Revenue growth ${fd.year}`, pc(fd.revenueGrowth), H.cls(fd.revenueGrowth || 0))}${st('Earnings growth', pc(fd.epsGrowth), H.cls(fd.epsGrowth || 0))}${st(`Revenue ${fd.year}`, big(fd.revenue))}</div>` : ''}
    ${f ? `<h3>How the price has behaved</h3><div class="stats">${st('1 month', pc(f.change1m), H.cls(f.change1m || 0))}${st('6 months', pc(f.change6m), H.cls(f.change6m || 0))}${st('1 year', pc(f.change1y), H.cls(f.change1y || 0))}${st('52-week range', `${H.money(f.low52)} – ${H.money(f.high52)}`)}${st('From the 52-week high', pc(f.fromHigh))}${st('Volatility (yearly)', f.volatility + '%', '', 'How much the price swings; the S&P 500 is usually 15-20%')}${st('Worst drop in a year', pc(f.maxDrawdown1y))}${f.beta != null ? st('Beta vs S&P 500', f.beta, '', 'Above 1 moves more than the market; below 1 moves less') : ''}</div>` : ''}
    <p class="mu small-print">${p.kind === 'etf' ? 'Fund details: issuer documents.' : `Financials from the company's own SEC filings (calendar ${fd?.year || ''}); ratios at today's price.`} Size classes: mega over $200B, large $10–200B, mid $2–10B, small $300M–2B, micro under $300M. Information, not a recommendation.</p>`;
}
