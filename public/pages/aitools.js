// AI tools: what-if scenarios on your holdings, news to trades, theme to watchlist, head to head.
let H;
export function registerAiTools(routes, helpers) { H = helpers; routes.aitools = page; }
const pct = v => (v == null ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(2)}%`);
const ARROW = { up: '▲', down: '▼', mixed: '◆' };
const note = r => `<p class="mu small-print">${r.engine ? `By ${H.esc(r.engine)}. ` : 'Plain rules (no AI set up). '}Education, not advice.</p>${H.evidenceHtml(r.evidence)}`;

async function page(view, q) {
  const tab = q.get('tab') || 'scenario';
  const tabs = [['scenario', 'What-if scenarios'], ['news', 'News to trades'], ['theme', 'Theme to watchlist'], ['compare', 'Head to head']];
  view.innerHTML = `<div class="pagehead"><div><h1>AI tools</h1><p class="mu" style="margin:4px 0 0">New ways to use AI on your money: test an event against your own holdings, turn news into the stocks it moves, build a watchlist from an idea, and compare two stocks for your kind of investing.</p></div></div>
    <div class="chips aitabs">${tabs.map(([k, n]) => `<a href="#/aitools?tab=${k}"><button type="button" class="${k === tab ? 'on' : ''}">${n}</button></a>`).join('')}</div><div id="ato"></div>`;
  const o = H.$('#ato', view);
  const form = (inner, btn) => `<form class="card" id="atf">${inner}<button>${btn}</button><div class="err"></div></form><div id="atr"></div>`;
  const run = (fn) => { const f = H.$('#atf', o), b = H.$('button', f); f.onsubmit = e => { e.preventDefault(); b.click(); }; H.act(b, async () => { H.$('#atr', o).innerHTML = await fn(H.form(f)); return ''; }); };
  if (tab === 'scenario') {
    o.innerHTML = form(`<h2>What happens to my holdings if…</h2><p class="mu" style="margin-top:0">Describe an event. The AI turns it into a move for each sector, and the moves are applied to your own holdings.</p>
      <label>The event<textarea name="text" rows="2" required placeholder="The Fed cuts rates by half a point / Oil jumps 20% / A recession starts">${H.esc(q.get('text') || '')}</textarea></label>
      <div class="chips">${['The Fed cuts rates by half a point', 'A recession starts next quarter', 'Oil jumps 20%', 'A sharp tech sell-off', 'Inflation comes in hot'].map(x => `<button type="button" class="chip" data-ex="${H.esc(x)}">${H.esc(x)}</button>`).join('')}</div>`, 'Run the scenario');
    H.$$('[data-ex]', o).forEach(b => (b.onclick = () => { H.$('[name=text]', o).value = b.dataset.ex; }));
    run(async f => {
      const r = await H.api('/aitools/scenario', { body: { text: f.text, account: H.state.account } });
      const sh = Object.entries(r.shocks || {}).filter(([, v]) => v).sort((a, b) => a[1] - b[1]);
      return `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${H.esc(r.name)}</h2><div class="pw-total ${H.cls(r.total)}"><b>${H.money(r.total)}</b><span>${pct(r.pct)} of your holdings</span></div></div><p>${H.esc(r.summary)}</p>
        ${r.rows.length ? `<div class="tablewrap"><table class="slim"><tr><th>Holding</th><th>Sector</th><th class="num">Value</th><th class="num">Move</th><th class="num">Estimated effect</th></tr>${r.rows.map(x => `<tr><td><b data-no-tr>${H.esc(x.symbol)}</b></td><td>${H.esc(x.sector)}</td><td class="num">${H.money(x.value)}</td><td class="num ${H.cls(x.shockPct)}">${pct(x.shockPct)}</td><td class="num ${H.cls(x.impact)}">${H.money(x.impact)}</td></tr>`).join('')}</table></div>` : '<p class="mu">This account has no holdings yet; the sector moves are below.</p>'}
        <h3>Sector moves in this scenario</h3><div class="chips">${sh.map(([k, v]) => `<span class="chip"><span>${H.esc(k)}</span> <b class="${H.cls(v)}">${pct(v)}</b></span>`).join('')}</div>
        ${r.assumptions?.length ? `<h3>Assumptions</h3><ul>${r.assumptions.map(a => `<li>${H.esc(a)}</li>`).join('')}</ul>` : ''}${note(r)}</div>`;
    });
  } else if (tab === 'news') {
    o.innerHTML = form(`<h2>Which stocks does this news move?</h2><label>Headline or article<textarea name="text" rows="5" required placeholder="Paste a headline or a whole article"></textarea></label>`, 'Read the news');
    run(async f => {
      const r = await H.api('/aitools/news', { body: { text: f.text } });
      return `<div class="card"><p>${H.esc(r.summary)}</p><div class="stats"><div class="stat"><span>Time frame</span><b>${H.esc(r.horizon)}</b></div><div class="stat"><span>Confidence</span><b>${H.esc(r.confidence)}</b></div></div>
        ${r.tickers.length ? `<div class="tablewrap"><table class="slim"><tr><th>Stock</th><th>Direction</th><th>How strongly</th><th class="num">Price</th><th class="num">Today</th><th>Why</th><th></th></tr>${r.tickers.map(t => `<tr><td><b data-no-tr>${H.esc(t.symbol)}</b></td><td class="${t.direction === 'up' ? 'pos' : t.direction === 'down' ? 'neg' : ''}">${ARROW[t.direction]} ${H.esc(t.direction)}</td><td>${H.esc(t.magnitude)}</td><td class="num">${t.price != null ? H.money(t.price) : '-'}</td><td class="num ${H.cls(t.changePct)}">${pct(t.changePct)}</td><td>${H.esc(t.why)}</td><td><a href="#/trade?symbol=${encodeURIComponent(t.symbol)}"><button type="button" class="small ghost">Trade</button></a></td></tr>`).join('')}</table></div>` : '<p class="mu">No listed stock is clearly affected.</p>'}
        ${r.sectors?.length ? `<h3>Sectors</h3><div class="chips">${r.sectors.map(s => `<span class="chip">${ARROW[s.direction]} ${H.esc(s.sector)}</span>`).join('')}</div>` : ''}${note(r)}</div>`;
    });
  } else if (tab === 'theme') {
    o.innerHTML = form(`<h2>Build a watchlist from an idea</h2><label>The theme<input name="text" required placeholder="Companies that gain from GLP-1 weight-loss drugs" value="${H.esc(q.get('text') || '')}"></label>`, 'Find the companies');
    run(async f => {
      const r = await H.api('/aitools/theme', { body: { text: f.text } });
      const html = `<div class="card"><h2 style="margin-top:0">${H.esc(r.theme)}</h2>${r.companies.length ? `<div class="tablewrap"><table class="slim"><tr><th>Company</th><th>Exposure</th><th class="num">Price</th><th class="num">Today</th><th>Why</th></tr>${r.companies.map(c => `<tr><td><b data-no-tr>${H.esc(c.symbol)}</b> <span class="mu">${H.esc(c.name)}</span>${c.checked ? '' : ' <span class="pill warn" title="Market data was not available to confirm this ticker trades">not checked</span>'}</td><td>${H.esc(c.purity)}</td><td class="num">${c.price != null ? H.money(c.price) : '-'}</td><td class="num ${H.cls(c.changePct)}">${pct(c.changePct)}</td><td>${H.esc(c.why)}</td></tr>`).join('')}</table></div>
        <button type="button" id="saveWl">Save as a watchlist</button><div class="err"></div>` : '<p class="mu">No listed companies found for that theme.</p>'}${note(r)}</div>`;
      setTimeout(() => { const b = H.$('#saveWl', o); if (b) H.act(b, async () => { const w = await H.api('/alpaca/watchlists', { body: { name: String(r.theme).slice(0, 60), symbols: r.companies.map(c => c.symbol) } }); return `Saved as the watchlist "${w.name || r.theme}" (menu → Watchlists).`; }); });
      return html;
    });
  } else {
    o.innerHTML = form(`<h2>Head to head</h2><div class="row"><label>First<input name="a" required placeholder="AAPL" data-no-tr value="${H.esc(q.get('a') || '')}"></label><label>Second<input name="b" required placeholder="MSFT" data-no-tr value="${H.esc(q.get('b') || '')}"></label></div>`, 'Compare');
    run(async f => {
      const r = await H.api('/aitools/compare', { body: { a: f.a, b: f.b } }), A = r.a, B = r.b, v = r.verdict;
      const row = (k, fa, fb) => `<tr><td>${k}</td><td class="num">${fa(A)}</td><td class="num">${fb ? fb(B) : fa(B)}</td></tr>`;
      const num = (x, d = 1, suf = '') => (x == null ? '-' : `${(+x).toFixed(d)}${suf}`);
      return `<div class="card"><div class="tablewrap"><table class="slim"><tr><th></th><th class="num"><span data-no-tr>${H.esc(A.symbol)}</span></th><th class="num"><span data-no-tr>${H.esc(B.symbol)}</span></th></tr>
        ${row('Name', s => H.esc(s.name))}${row('Price', s => (s.price != null ? H.money(s.price) : '-'))}${row('Style', s => H.esc(s.style || '-'))}${row('P/E', s => num(s.ratios?.pe))}${row('Price / sales', s => num(s.ratios?.ps, 2))}${row('Profit margin', s => num(s.ratios?.netMargin, 1, '%'))}
        ${row('Revenue growth', s => num(s.fundamentals?.revenueGrowth, 1, '%'))}${row('1 year', s => num(s.change1y, 1, '%'))}${row('Trend', s => H.esc(s.trend || '-'))}${row('RSI (14)', s => num(s.rsi, 0))}${row('Volatility', s => num(s.vol, 0, '%'))}</table></div>
        <div class="aibox"><p>${H.esc(v.summary)}</p><ul><li><b>Growth investor:</b> ${H.esc(v.growth)}</li><li><b>Value investor:</b> ${H.esc(v.value)}</li><li><b>Income investor:</b> ${H.esc(v.income)}</li><li><b>Cautious investor:</b> ${H.esc(v.safety)}</li></ul>${v.points?.length ? `<ul>${v.points.map(p => `<li>${H.esc(p)}</li>`).join('')}</ul>` : ''}</div>${note(r)}</div>`;
    });
  }
}
