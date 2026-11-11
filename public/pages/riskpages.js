// Portfolio & risk (with practice tools), plain-language research, tokenized securities and
// investor protection. Every number is explained in plain words; every summary links its source.
let H;
export function registerRiskPages(routes, helpers) { H = helpers; Object.assign(routes, { riskview, research, tokenized, protection }); }
const fmtM = x => (x == null ? '-' : H.money(x));
const pc = (x, d = 1) => (x == null ? '-' : `${(+x).toFixed(d)}%`);
const bar = (pct, cls = '') => `<span class="secbar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></span>`;
const ESTIMATE = '<p class="mu small-print">Estimates from the last year of prices. Real losses can be bigger, and the past does not predict the future. This is not advice.</p>';

// ---------------------------------------------------------------- Portfolio & risk
async function riskview(view, q) {
  const accts = await H.accounts().catch(() => []);
  const account = q.get('account') || 'paper', add = q.get('add') || '';
  view.innerHTML = `<div class="pagehead"><h1>Portfolio &amp; risk</h1><p class="mu">What you own, how spread out it is, how it has done, and what could happen if the market fell. Start with your practice (paper) account: nothing here places a trade.</p></div>
  <form class="card row" id="rf" style="gap:10px;align-items:end;flex-wrap:wrap">
    <label>Account<select name="account">${H.accountOptions(accts, account)}</select></label>
    <label style="flex:1;min-width:220px">What if I added… <span class="mu">(pretend, nothing is bought)</span><input name="add" value="${H.esc(add)}" placeholder="TSLA:1000, AAPL:500" dir="ltr" data-no-tr></label>
    <button>Show</button></form>
  <div id="rOut"><p class="mu">Working it out…</p></div>`;
  H.$('#rf', view).onsubmit = e => { e.preventDefault(); const f = H.form(e.target); location.hash = `#/riskview?account=${encodeURIComponent(f.account)}${f.add.trim() ? '&add=' + encodeURIComponent(f.add.replace(/\s+/g, '').replace(/\$/g, '')) : ''}`; };
  const out = H.$('#rOut', view);
  let d;
  try { d = await H.api(`/portfolio-risk?account=${encodeURIComponent(account)}${add ? '&add=' + encodeURIComponent(add) : ''}`); } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p><p class="mu">Connect an account, or use the paper account to practice.</p></div>`; return; }
  if (!d.holdings.length) { out.innerHTML = `<div class="card"><h2>Nothing held yet</h2><p>This account holds only cash (${fmtM(d.cash)}). Try “What if I added…” above to see the risk of a portfolio before you buy anything, or practice with a <a href="#/trade">paper trade</a>.</p></div>`; return; }
  const c = d.concentration, r = d.risk, p = d.performance;
  const beta = r.beta, betaWords = beta < 0.6 ? 'calmer than the market' : beta < 0.9 ? 'a bit calmer than the market' : beta <= 1.15 ? 'about like the market' : beta <= 1.6 ? 'more than the market' : 'much more than the market';
  out.innerHTML = `${d.pretend ? `<div class="callout">Including pretend holdings: ${d.pretend.map(x => `${H.esc(x.symbol)} ${fmtM(x.value)}`).join(', ')} (paid for from cash in this picture).</div>` : ''}
  <div class="stats">
    <div class="stat"><span>Total value</span><b>${fmtM(d.equity)}</b><span class="mu">${fmtM(d.cash)} cash</span></div>
    <div class="stat"><span>Moves with the market</span><b>${beta?.toFixed(2) ?? '-'}×</b><span class="mu">${betaWords}</span></div>
    <div class="stat"><span>A bad day (1 in 20)</span><b class="neg">${fmtM(r.badDay)}</b><span class="mu">${pc(r.badDayPct)} or worse</span></div>
    <div class="stat"><span>Worst day last year</span><b class="neg">${fmtM(r.worstDay)}</b><span class="mu">${pc(r.worstDayPct)}</span></div>
    <div class="stat"><span>Bumpiness (yearly)</span><b>${pc(r.volatilityYearPct, 0)}</b><span class="mu">the S&amp;P 500 is usually 15-20%</span></div>
  </div>
  <div class="grid" style="margin-top:12px">
    <div class="card"><h2>How spread out is it?</h2>
      <p>You have <b>${c.holdings}</b> holding${c.holdings === 1 ? '' : 's'}, but they act like about <b>${c.actsLike}</b> equal ones${c.actsLike < c.holdings * 0.6 ? ', because a few are much bigger than the rest' : ''}. The biggest, <b data-no-tr>${H.esc(c.top?.symbol || '-')}</b>, is ${pc(c.top?.pct)} of what you hold; the top 3 are ${pc(c.top3Pct)}.</p>
      ${c.warnings.length ? `<ul class="warnlist">${c.warnings.map(w => `<li>${H.esc(w)}</li>`).join('')}</ul>` : '<p class="pos">No single holding, sector or risky kind of fund stands out.</p>'}
      <details><summary>Why it matters</summary><p class="mu">When most of your money is in one company, fund or part of the market, one piece of bad news can hit most of it. Spreading money across many different holdings means a single loss hurts less. It does not stop the whole market falling.</p></details></div>
    <div class="card"><h2>What could happen if the market fell?</h2>
      <table class="slim"><tr><th>If…</th><th class="num">Estimated loss</th><th class="num">You'd have</th></tr>${d.scenarios.map(s => `<tr><td>${H.esc(s.name)}</td><td class="num neg">${fmtM(s.loss)} (${pc(s.pct)})</td><td class="num">${fmtM(s.after)}</td></tr>`).join('')}</table>
      <label style="margin-top:12px">Pick your own: the market moves <b id="mv">-15</b>%<input type="range" id="mvR" min="-60" max="30" step="1" value="-15"></label>
      <p id="mvOut"></p>${ESTIMATE}</div>
  </div>
  <div class="grid" style="margin-top:12px">
    <div class="card"><h2>By kind</h2><div class="sectors">${d.byKind.map(k => `<div class="secrow"><span>${H.esc(k.name)}</span>${bar(k.pct, 'up')}<span class="num">${pc(k.pct)}</span></div>`).join('')}</div></div>
    <div class="card"><h2>By sector</h2><div class="sectors">${d.bySector.map(k => `<div class="secrow"><span>${H.esc(k.name)}</span>${bar(k.pct, 'up')}<span class="num">${pc(k.pct)}</span></div>`).join('')}</div><p class="mu small-print">Share of the money invested (cash left out).</p></div>
  </div>
  <div class="card" style="margin-top:12px"><h2>How has it done?</h2>${p ? `<p>From ${H.esc(p.from)} to ${H.esc(p.to)} this account went <b class="${H.cls(p.returnPct)}">${H.pct(p.returnPct)}</b>${p.spyPct != null ? `; the S&amp;P 500 went <b class="${H.cls(p.spyPct)}">${H.pct(p.spyPct)}</b>` : ''}. The biggest drop from a high point along the way was <b class="neg">${pc(p.maxDrawdownPct)}</b>.</p><p class="mu small-print">Deposits and withdrawals can make these numbers look better or worse than the investments did.</p>` : '<p class="mu">Not enough history in this account yet.</p>'}</div>
  <div class="card"><h2>Holdings</h2><div class="tablewrap"><table><tr><th>Symbol</th><th>Kind</th><th>Sector</th><th class="num">Value</th><th class="num">Share</th><th class="num">Moves with market</th></tr>${d.holdings.map(h => `<tr><td><a href="#/trade?symbol=${encodeURIComponent(h.symbol)}" data-no-tr>${H.esc(h.symbol)}</a>${h.pretend ? ' <span class="pill">pretend</span>' : ''}</td><td>${H.esc(h.kind)}</td><td>${H.esc(h.sector)}</td><td class="num">${fmtM(h.value)}</td><td class="num">${pc(h.pct)}</td><td class="num">${h.beta?.toFixed(2) ?? '-'}×</td></tr>`).join('')}</table></div>
    <p class="mu small-print">“Moves with the market” (beta): 1.0 means it tends to rise and fall like the S&amp;P 500; 2.0 means about twice as much.</p></div>
  <div class="card"><h2>Practice</h2><p>Want to try an idea without risking money? <a href="#/trade">Place a paper trade</a> in your practice account, then come back here to see how it changed your risk. Or type a pretend holding above.</p></div>`;
  const slide = H.$('#mvR', out), show = () => {
    const m = +slide.value, loss = d.holdings.reduce((a, h) => a + h.value * Math.max(-1, (h.beta ?? 1) * m / 100), 0);
    H.$('#mv', out).textContent = m > 0 ? '+' + m : m;
    H.$('#mvOut', out).innerHTML = `Your holdings would ${loss < 0 ? 'lose' : 'gain'} about <b class="${H.cls(loss)}">${fmtM(Math.abs(loss))}</b> (${pc(d.equity ? loss / d.equity * 100 : 0)} of the total), leaving about ${fmtM(d.equity + loss)}.`;
  };
  slide.oninput = show; show();
}

// ---------------------------------------------------------------- Plain-language research
async function research(view, q) {
  const sym0 = (q.get('symbol') || '').toUpperCase();
  view.innerHTML = `<div class="pagehead"><h1>Plain-language research</h1><p class="mu">Find stocks by numbers you can check, and read short summaries of a company's latest report and news. Every summary links to the original source with its date. Summaries can miss things; read the source before deciding.</p></div>
  <div class="card"><h2>Look up a company</h2><form id="lf" class="row" style="gap:8px"><input name="s" value="${H.esc(sym0)}" placeholder="AAPL" dir="ltr" autocomplete="off" style="max-width:160px" data-no-tr><select name="form"><option value="10-K">Yearly report (10-K)</option><option value="10-Q">Quarterly report (10-Q)</option></select><button>Summarize</button></form>
    <div class="grid" style="margin-top:12px"><div id="fOut"></div><div id="nOut"></div></div></div>
  <div class="card"><h2>Find stocks by the numbers</h2><div id="sOut"><p class="mu">Loading company numbers from SEC filings…</p></div></div>`;
  const lookup = async (s, form) => {
    const fOut = H.$('#fOut', view), nOut = H.$('#nOut', view);
    fOut.innerHTML = '<p class="mu">Reading the filing…</p>'; nOut.innerHTML = '<p class="mu">Reading the news…</p>';
    H.api(`/plain-research/filing/${encodeURIComponent(s)}?form=${form}`).then(f => {
      const S = f.summary, list = (t, a) => (a?.length ? `<h3>${t}</h3><ul>${a.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul>` : '');
      fOut.innerHTML = `<h3>${H.esc(f.company)}: ${H.esc(f.form)}</h3><p class="mu">Filed ${H.esc(f.filed)} · period ending ${H.esc(f.period)} · <a href="${H.esc(f.url)}" target="_blank" rel="noopener">Read the original on SEC.gov ↗</a></p>
        ${S ? `<p>${H.esc(S.plain)}</p>${S.business ? `<h3>The business</h3><p>${H.esc(S.business)}</p>` : ''}${list('Key numbers (as stated)', S.numbers)}${list('Risks the company names', S.risks)}${list('What the company says to watch', S.watch)}<p class="mu small-print">AI summary of the filing above. It can leave things out or get things wrong.</p>`
          : `<p class="mu">${H.esc(f.note || '')}</p>${['business', 'riskFactors', 'mdna'].map(k => f.excerpts[k] ? `<h3>${{ business: 'The business', riskFactors: 'Risk factors', mdna: "Management's discussion" }[k]}</h3><p class="small-print">${H.esc(f.excerpts[k])}…</p>` : '').join('')}`}`;
    }).catch(e => (fOut.innerHTML = `<p class="err">${H.esc(e.message)}</p>`));
    H.api(`/plain-research/news/${encodeURIComponent(s)}`).then(n => {
      if (n.unavailable || !n.items.length) { nOut.innerHTML = `<h3>News</h3><p class="mu">${H.esc(n.message || 'No recent news found.')}</p>`; return; }
      const ref = i => `<a href="#n${i}" class="mu">[${i}]</a>`;
      nOut.innerHTML = `<h3>News in short</h3>${n.summary?.points?.length ? `<ul>${n.summary.points.map(p => `<li>${H.esc(p.text)} ${p.refs.map(ref).join(' ')}</li>`).join('')}</ul><p class="mu small-print">AI summary of the headlines below; the numbers point to its sources.</p>` : ''}
        <ol class="newslist">${n.items.map(i => `<li id="n${i.n}"><a href="${H.esc(i.url)}" target="_blank" rel="noopener">${H.esc(i.headline)}</a> <span class="mu">${H.esc(i.source || '')} · ${i.at ? new Date(i.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span></li>`).join('')}</ol>`;
    }).catch(e => (nOut.innerHTML = `<p class="err">${H.esc(e.message)}</p>`));
  };
  H.$('#lf', view).onsubmit = e => { e.preventDefault(); const f = H.form(e.target), s = f.s.trim().toUpperCase(); if (s) lookup(s, f.form); };
  if (sym0) lookup(sym0, '10-K');

  const sOut = H.$('#sOut', view);
  let d;
  try { d = await H.api('/plain-research/screen'); } catch (e) { sOut.innerHTML = `<p class="err">${H.esc(e.message)}</p>`; return; }
  if (d.unavailable || !d.rows.length) { sOut.innerHTML = `<p class="mu">${H.esc(d.message || 'No company numbers right now.')}</p>`; return; }
  const PRESETS = { cheap: { pe: [0, 15] }, growing: { revenueGrowth: [15, null] }, profitable: { netMargin: [20, null] }, giants: { marketCap: [200, null] } };
  sOut.innerHTML = `<p class="mu">${d.rows.length} large US companies, from their ${H.esc(String(d.year))} SEC filings and today's prices. Leave a box empty to ignore it.</p>
    <div class="chips" id="pre"><button type="button" data-p="cheap">Cheap vs. profits</button><button type="button" data-p="growing">Fast-growing sales</button><button type="button" data-p="profitable">Very profitable</button><button type="button" data-p="giants">The giants</button><button type="button" data-p="">Clear</button></div>
    <form id="cf" class="crit">${d.criteria.map(c => `<div class="critrow"><span title="${H.esc(c.about)}">${H.esc(c.name)} <span class="mu">(${H.esc(c.unit)})</span></span><input name="${c.id}_lo" type="number" step="any" placeholder="min"><input name="${c.id}_hi" type="number" step="any" placeholder="max"><span class="mu small-print">${H.esc(c.about)}</span></div>`).join('')}
      <label>Sector<select name="sector"><option value="">Any</option>${d.sectors.map(s => `<option>${H.esc(s)}</option>`).join('')}</select></label></form>
    <p id="cCount" class="mu"></p><div class="tablewrap"><table id="cT"></table></div>
    <p class="mu small-print">Source: <a href="${H.esc(d.source.url)}" target="_blank" rel="noopener">${H.esc(d.source.name)}</a>. Numbers are from the latest yearly filings and can be out of date. A stock passing a screen is not a recommendation.</p>`;
  const cf = H.$('#cf', view), num = v => (v === '' || v == null ? null : +v);
  const draw = () => {
    const f = H.form(cf), list = d.rows.filter(r => (!f.sector || r.sector === f.sector) && d.criteria.every(c => {
      const lo = num(f[c.id + '_lo']), hi = num(f[c.id + '_hi']); if (lo == null && hi == null) return true;
      const v = r[c.id] == null ? null : r[c.id] / (c.scale || 1); return v != null && (lo == null || v >= lo) && (hi == null || v <= hi);
    }));
    H.$('#cCount', view).textContent = `${list.length} match${list.length === 1 ? '' : 'es'}`;
    const n1 = x => (x == null ? '-' : (+x).toFixed(1));
    H.$('#cT', view).innerHTML = `<tr><th>Company</th><th>Sector</th><th class="num">Size</th><th class="num">P/E</th><th class="num">Margin</th><th class="num">Sales growth</th><th></th></tr>${list.slice(0, 60).map(r => `<tr><td><b data-no-tr>${H.esc(r.symbol)}</b> <span class="mu">${H.esc(r.name || '')}</span></td><td>${H.esc(r.sector)}</td><td class="num">${r.marketCap ? '$' + Math.round(r.marketCap / 1e9) + 'B' : '-'}</td><td class="num">${n1(r.pe)}</td><td class="num">${r.netMargin == null ? '-' : n1(r.netMargin) + '%'}</td><td class="num ${H.cls(r.revenueGrowth)}">${r.revenueGrowth == null ? '-' : n1(r.revenueGrowth) + '%'}</td><td><a href="#/research?symbol=${encodeURIComponent(r.symbol)}">Summary</a></td></tr>`).join('')}`;
  };
  cf.oninput = draw; draw();
  H.$$('#pre button', view).forEach(b => (b.onclick = () => {
    cf.reset(); const p = PRESETS[b.dataset.p] || {};
    for (const [k, [lo, hi]] of Object.entries(p)) { if (lo != null) cf[k + '_lo'].value = lo; if (hi != null) cf[k + '_hi'].value = hi; }
    draw();
  }));
}

// ---------------------------------------------------------------- Tokenized securities
const TOKEN_EXAMPLES = [
  ['Tokenized stocks and ETFs', 'A token that tracks one share of a company or fund (for example a token for Apple or the S&P 500). Usually issued outside the US by a company that holds the real shares.', 'Mostly not offered to US residents.'],
  ['Tokenized Treasury and money-market funds', 'Shares of a fund that holds US government debt, recorded on a blockchain. Some pay interest daily.', 'Some are open to US investors; others need high minimums or "qualified purchaser" status.'],
  ['Tokenized private funds and credit', 'Pieces of private loans, real estate or private funds.', 'Usually for accredited investors only, and hard to sell.'],
];
// Laid out top to bottom in the order a beginner needs it: what a token is (the two kinds side by
// side), why people use them, the main kinds, the extra risks with the checklist next to them, and
// the price check, with a row of links to jump to each part.
const TOKEN_WHY = [['🕒', 'Any hour', 'Trading at any hour, on some platforms'], ['🧩', 'Small pieces', 'Buying small fractions of a share'], ['🔁', 'Portable', 'Moving them between crypto wallets and apps'], ['⚡', 'Fast', 'Faster settlement than the usual one business day']];
const TOKEN_RISKS = [
  ['The issuer', 'If the company that holds the real shares fails or misbehaves, the token can lose value even when the share does not.'],
  ['Custody', 'Who holds the real shares, and is it checked by an independent auditor?'],
  ['Redemption', 'Can you swap the token for the real share or cash, and who is allowed to?'],
  ['Price gaps', 'A token can trade above or below the value of what it tracks, especially when the stock market is closed.'],
  ['Your wallet', 'Lose the keys, or send to the wrong address, and the tokens are usually gone for good.'],
  ['Protection', 'SIPC covers securities held at a SIPC member broker; tokens in your own wallet or on a crypto exchange usually are not covered.'],
  ['Rules', 'Many tokens may not be sold to US residents, and the rules are still changing.'],
];
const TOKEN_CHECKS = ['Who issues the token, and in which country is it regulated?', 'Is it the security itself, or a promise that tracks it?', 'Who holds the real assets, and is there an independent audit you can read?', 'Can you redeem it for the real thing or cash, how, and for what fee?', 'Is it offered to people where you live? (Many are not for US residents.)', 'Is the platform registered? Check FINRA BrokerCheck or the SEC.', 'What happens to the token in a stock split, dividend or merger?', 'How will you store it, and what happens if you lose access?', 'How is it taxed where you live?'];
async function tokenized(view) {
  view.innerHTML = `<div class="pagehead"><h1>Tokenized securities</h1><p class="mu">Shares, funds and bonds recorded on a blockchain, explained simply: what they are, who can buy them, the extra risks, and how to check a token's price against the real thing.</p></div>
  <nav class="chips tk-nav" aria-label="On this page">${[['tkWhat', '1. What it is'], ['tkKinds', '2. The main kinds'], ['tkRisks', '3. Risks & checklist'], ['tkPrice', '4. Check a price']].map(([id, t]) => `<button type="button" data-jump="${id}">${t}</button>`).join('')}</nav>
  <div class="banner">A tokenized security is still a security. The token is a record of ownership (or a promise from an issuer); the rules that protect investors still apply, and so do the risks of what it represents.</div>

  <section class="card" id="tkWhat"><h2>What it is</h2>
    <p>Instead of your broker's records saying you own a share, a token on a blockchain does. There are two very different kinds:</p>
    <div class="tk-vs">
      <div class="tk-side"><span class="pill pos">The safer kind</span><h3>The security itself</h3><p>The issuer keeps its list of shareholders on the blockchain. You are a shareholder, with the usual rights.</p></div>
      <div class="tk-side"><span class="pill warn">Check carefully</span><h3>A promise that tracks it</h3><p>A company holds the real shares and issues a token that follows their price. You may have no voting or other shareholder rights, and you depend on that company.</p></div>
    </div>
    <h3>Why people use them</h3>
    <div class="tk-tiles">${TOKEN_WHY.map(([i, t, d]) => `<div class="tk-tile"><span class="tk-ico" aria-hidden="true">${i}</span><b>${t}</b><span class="mu">${d}</span></div>`).join('')}</div>
  </section>

  <section id="tkKinds"><h2 class="tk-h">The main kinds</h2>
    <div class="tk-kinds">${TOKEN_EXAMPLES.map(([a, b, c], i) => `<div class="card tk-kind"><span class="tk-num">${i + 1}</span><h3>${a}</h3><p>${b}</p><div class="tk-who"><b>Who can buy</b><span>${c}</span></div></div>`).join('')}</div>
    <p class="mu small-print">What is offered changes often and depends on where you live. Brightolio does not sell tokens.</p>
  </section>

  <section class="tk-two" id="tkRisks">
    <div class="card"><h2>The extra risks</h2><ul class="warnlist">${TOKEN_RISKS.map(([t, d]) => `<li><b>${t}:</b> ${d}</li>`).join('')}</ul></div>
    <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Before you buy: a checklist</h2><span class="pill" id="tkCount">0 of ${TOKEN_CHECKS.length}</span></div>
      <div class="ob-bar" style="margin:10px 0"><i id="tkBar" style="width:0%"></i></div>
      <ol class="checklist">${TOKEN_CHECKS.map(t => `<li><label class="chk"><input type="checkbox" data-tkc> ${t}</label></li>`).join('')}</ol>
      <p class="mu small-print" id="tkDone" hidden>All checked. If any answer worried you, it is fine to walk away.</p></div>
  </section>

  <section class="card" id="tkPrice"><h2>Check a token's price against the real thing</h2><p class="mu">Type the real stock or fund and the token's price on the platform you are looking at. You'll see how far above or below it trades.</p>
    <form id="tk" class="row" style="gap:8px;align-items:end;flex-wrap:wrap"><label>Real stock or fund<input name="s" placeholder="AAPL" dir="ltr" style="max-width:120px" data-no-tr></label><label>Token price ($)<input name="p" type="number" step="any" min="0" style="max-width:140px"></label><label>Shares per token<input name="r" type="number" step="any" min="0" value="1" style="max-width:110px"></label><button>Compare</button></form>
    <div id="tkOut"></div></section>
  <p class="mu small-print">Education only, not advice or an offer to buy or sell any token. See the <a href="/risk.html" target="_blank">risk disclosure</a>.</p>`;
  H.$$('[data-jump]', view).forEach(b => (b.onclick = () => H.$('#' + b.dataset.jump, view)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  const boxes = H.$$('[data-tkc]', view), tick = () => {
    const n = boxes.filter(c => c.checked).length;
    H.$('#tkCount', view).textContent = `${n} of ${boxes.length}`; H.$('#tkBar', view).style.width = `${Math.round(n / boxes.length * 100)}%`; H.$('#tkDone', view).hidden = n < boxes.length;
  };
  boxes.forEach(c => (c.onchange = tick));
  H.$('#tk', view).onsubmit = async e => {
    e.preventDefault(); const f = H.form(e.target), s = f.s.trim().toUpperCase(), tp = +f.p, ratio = +f.r || 1, o = H.$('#tkOut', view);
    if (!s || !(tp > 0)) { o.innerHTML = '<p class="err">Type a symbol and the token price.</p>'; return; }
    try {
      const qd = await H.api('/market/overview/quotes?symbols=' + encodeURIComponent(s)), row = qd[0];
      if (!row || row.price == null) throw new Error('No price for ' + s);
      const fair = row.price * ratio, gap = (tp / fair - 1) * 100;
      o.innerHTML = `<div class="stats" style="margin-top:12px"><div class="stat"><span>${H.esc(s)} now</span><b>${H.money(row.price)}</b><small class="mu"><span class="fresh ${H.esc(row.freshness?.level || '')}">${H.esc(row.freshness?.label || '')}</span></small></div>
        <div class="stat"><span>The token should be worth</span><b>${H.money(fair)}</b></div>
        <div class="stat"><span>The token trades</span><b class="${Math.abs(gap) < 0.5 ? '' : 'neg'}">${Math.abs(gap).toFixed(2)}% ${gap >= 0 ? 'above' : 'below'}</b></div></div>
        ${Math.abs(gap) > 2 ? '<p class="mu">A gap this big can mean low trading, a closed stock market, or doubts about the issuer.</p>' : ''}`;
    } catch (err) { o.innerHTML = `<p class="err">${H.esc(err.message)}</p>`; }
  };
}

// ---------------------------------------------------------------- Investor protection
async function protection(view) {
  view.innerHTML = `<div class="pagehead"><h1>Investor protection</h1><p class="mu">What Brightolio is and is not, the risks to know, how to spot investment fraud, and what we do with your data.</p></div>
  <div class="callout"><b>No one can guarantee returns, and neither can AI.</b> Our AI assistant, forecasts and bots can be wrong. Anyone who promises high returns with little or no risk is showing a classic sign of fraud.</div>
  <div class="grid">
    <div class="card"><h2>What Brightolio is</h2><ul><li>Software that connects to the broker <b>you</b> choose.</li><li><b>Not</b> a broker-dealer: your money and securities stay with your broker, which is a FINRA member with SIPC coverage (SIPC does not cover market losses or crypto).</li><li><b>Not</b> personal investment advice. Strategies, screens and summaries are tools; the decisions are yours.</li></ul></div>
    <div class="card"><h2>Spot the warning signs</h2><ul class="warnlist"><li>“Guaranteed” or “risk-free” returns</li><li>Pressure to act now or keep it secret</li><li>Claims that AI or a secret system “can't lose”</li><li>A platform you can't find on a regulator's list</li><li>Requests to pay in crypto, gift cards or wire to a person</li><li>A video or voice of someone you know asking for money (AI can fake these)</li></ul></div>
  </div>
  <div class="grid" style="margin-top:12px">
    <div class="card"><h2>Check before you send money</h2><ul>
      <li><a href="https://brokercheck.finra.org/" target="_blank" rel="noopener">FINRA BrokerCheck</a>: brokers and their records</li>
      <li><a href="https://adviserinfo.sec.gov/" target="_blank" rel="noopener">SEC adviser search</a>: investment advisers</li>
      <li><a href="https://www.investor.gov/" target="_blank" rel="noopener">Investor.gov</a>: the SEC's site for investors</li>
      <li><a href="https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/artificial-intelligence-fraud" target="_blank" rel="noopener">Investor alert: AI and investment fraud</a> (SEC, FINRA and state regulators)</li>
      <li>Report possible fraud: <a href="https://www.sec.gov/tcr" target="_blank" rel="noopener">sec.gov/tcr</a></li></ul></div>
    <div class="card"><h2>Your data</h2><ul><li>We do not sell your personal information.</li><li>No advertising or tracking cookies.</li><li>Your Social Security and bank numbers go straight to the broker; we don't keep them.</li><li>Emails, phone and account numbers are removed before anything goes to an AI provider.</li><li>Download or delete everything from <a href="#/settings">Settings</a>.</li></ul>
      <p><a href="/privacy.html" target="_blank">Privacy policy</a> · <a href="/risk.html" target="_blank">Risk disclosure</a> · <a href="/security.html" target="_blank">Security</a> · <a href="/insurance.html" target="_blank">How your money is protected</a></p></div>
  </div>
  <div class="card"><h2>The risks in plain words</h2><ul>
    <li><b>You can lose money</b>, including all of it. Leveraged funds, options, margin and crypto can lose it fast.</li>
    <li><b>Backtests and paper results are not real.</b> They use hindsight and leave out the stress, slippage and partial fills of real trading.</li>
    <li><b>Prices may be late.</b> Each price is labeled real-time, delayed or previous close. Your broker's confirmation is what counts.</li>
    <li><b>Automation can fail</b>: bots and scheduled trades can run late, twice, or on bad data. Keep an eye on your account.</li>
    <li><b>Scenarios are estimates.</b> Real crashes can be worse than any “what if”.</li></ul></div>`;
}
