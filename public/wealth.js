// Wealth builder: ten long-term habits, each with a working tool. Index funds, compound growth,
// automatic investing, buy-and-hold, dividend reinvestment, fundamentals, tax-advantaged accounts,
// core and satellite, diversification and rebalancing.
let H;
export function registerWealth(routes, helpers) { H = helpers; routes.wealth = wealth; }

const TABS = [['funds', 'Index funds'], ['compound', 'Compound growth'], ['auto', 'Automatic investing'], ['hold', 'Buy & hold'], ['drip', 'Reinvest dividends'],
  ['understand', 'Know what you own'], ['tax', 'Tax-advantaged accounts'], ['core', 'Core & satellite'], ['diversify', 'Diversify & rebalance']];
const LESSON = {
  funds: 'Instead of spending hours picking single stocks, buy broad index funds (an S&P 500 or total-market fund). They spread your money across hundreds of companies, and over 10 to 30 years they beat most active traders.',
  compound: 'Time is the most powerful tool in the market. With compound growth your earnings earn more earnings, so starting early with small monthly amounts often beats starting late with much more.',
  auto: 'Invest a fixed amount every week or month, whatever the news. You buy more shares when prices are low and fewer when they are high: no emotions, no guessing the market.',
  hold: 'Rapid trading triggers taxes and costs that eat returns. History shows that staying invested through short downturns beats frequent buying and selling.',
  drip: 'When your companies pay dividends, use them to buy more shares automatically. Reinvested dividends make the portfolio grow faster over time.',
  understand: 'If you pick single stocks, stick to businesses whose revenue, advantage over competitors and financial statements you understand. Look for growing revenue and earnings per share, and low debt.',
  tax: 'Fill tax-sheltered accounts (401(k), IRA) before a taxable brokerage account. Growth without a yearly tax bill compounds much faster.',
  core: 'Keep a stable core in index funds (70-80%) and a smaller satellite (10-20%) in growth themes such as AI or clean energy: room to grow without risking your main savings.',
  diversify: 'Spread money across sectors and countries so one industry or country going down cannot sink you. Once or twice a year, sell a little of what grew most and buy what lagged, back to your target mix.',
};
const THEMES = [['AI & robotics', 'BOTZ'], ['Artificial intelligence', 'AIQ'], ['Semiconductors', 'SMH'], ['Clean energy', 'ICLN'], ['Cybersecurity', 'CIBR'], ['Nasdaq-100 growth', 'QQQM'], ['Emerging markets', 'VWO']];
const pctf = v => (v == null ? '-' : `${(+v).toFixed(1)}%`);

async function wealth(view, q) {
  const tab = q.get('tab') || 'funds';
  view.innerHTML = `<h1>Wealth builder</h1><p class="mu">Ten habits that build wealth over the long run, each with a tool to do it. Education only, not advice for your situation.</p>
    <div class="chips wtabs">${TABS.map(([k, t]) => `<a href="#/wealth?tab=${k}"><button type="button" class="${k === tab ? 'on' : ''}">${t}</button></a>`).join('')}</div>
    <div class="card lesson"><b>${TABS.find(t => t[0] === tab)?.[1] || ''}</b><p>${LESSON[tab] || ''}</p></div><div id="wbody"></div>`;
  const body = H.$('#wbody', view);
  await ({ funds, compound, auto, hold, drip, understand, tax, core, diversify }[tab] || funds)(body);
}

async function funds(el) {
  el.innerHTML = '<div class="card"><p class="mu">Loading fund records…</p></div>';
  const f = await H.api('/wealth/funds');
  const fee30 = fee => H.money(10000 * ((1.07) ** 30 - (1.07 - fee / 100) ** 30));
  el.innerHTML = `<div class="card tablewrap"><h2>Low-cost index funds</h2><table><tr><th>Fund</th><th>What it holds</th><th>Yearly cost</th><th>5-year return / yr</th><th>10-year return / yr</th><th>Cost over 30 years on $10,000</th><th></th></tr>
    ${f.map(x => `<tr><td><b data-no-tr>${x.symbol}</b><br><span class="mu small-print" data-no-tr>${H.esc(x.name)}</span></td><td>${H.esc(x.tracks)}</td><td>${x.fee}%</td><td>${pctf(x.cagr5)}</td><td>${pctf(x.cagr10)}</td><td>${fee30(x.fee)}</td>
      <td><a href="#/wealth?tab=auto&sym=${x.symbol}"><button type="button" class="small">Invest monthly</button></a></td></tr>`).join('')}</table>
    <p class="mu small-print">Past returns include dividends where the data has them, and do not predict the future. A 1% yearly fee would cost about ${fee30(1)} over the same 30 years.</p></div>
    <div class="card"><h2>Why funds beat most stock pickers</h2><ul class="tips"><li>Over 15 years, roughly 9 in 10 actively managed US stock funds trailed the S&P 500 (S&P SPIVA scorecards).</li><li>One fund holds hundreds of companies: a single bankruptcy barely moves it.</li><li>Costs as low as 0.03% a year: $3 on every $10,000.</li></ul></div>`;
}

function compound(el) {
  el.innerHTML = `<form class="card" id="cg"><h2>Start early vs. start late</h2>
    <div class="row"><label>Monthly amount ($)<input name="m" type="number" value="300" min="1"></label><label>Yearly return (%)<input name="r" type="number" value="7" step="0.5"></label>
      <label>Start at age<input name="a1" type="number" value="25"></label><label>Late start at age<input name="a2" type="number" value="35"></label><label>Late monthly amount ($)<input name="m2" type="number" value="600"></label><label>Until age<input name="end" type="number" value="65"></label></div>
    <div class="stats" id="cgOut"></div><canvas id="cgChart"></canvas>
    <p class="mu small-print">Assumes the return is the same every year; real markets go up and down. Colored line: early start. Grey: late start.</p></form>`;
  const f = H.$('#cg', el);
  const series = (m, r, from, to) => { const i = (1 + r / 100) ** (1 / 12) - 1, out = []; let v = 0; for (let age = 18; age <= to; age++) { if (age >= from) for (let k = 0; k < 12; k++) v = v * (1 + i) + m; out.push(v); } return out; };
  const draw = () => {
    const v = Object.fromEntries([...new FormData(f)].map(([k, x]) => [k, +x]));
    const a = series(v.m, v.r, v.a1, v.end), b = series(v.m2, v.r, v.a2, v.end);
    const putA = v.m * 12 * Math.max(0, v.end - v.a1), putB = v.m2 * 12 * Math.max(0, v.end - v.a2);
    H.$('#cgOut', el).innerHTML = `<div class="stat"><span>Early: you put in</span><b>${H.money(putA)}</b></div><div class="stat"><span>Early: you end with</span><b class="kpi">${H.money(a.at(-1))}</b></div>
      <div class="stat"><span>Late: you put in</span><b>${H.money(putB)}</b></div><div class="stat"><span>Late: you end with</span><b>${H.money(b.at(-1))}</b></div>`;
    H.drawChart(H.$('#cgChart', el), a, { base: 0, compare: b, legend: false });
  };
  f.oninput = draw; draw();
}

async function auto(el) {
  const accts = await H.accounts(), paid = H.paid(), sym = new URLSearchParams(location.hash.split('?')[1]).get('sym');
  const mix = sym ? [[sym, 100]] : [['VTI', 60], ['VXUS', 30], ['BND', 10]];
  el.innerHTML = `<form class="card" id="ai"><h2>Automatic investing (dollar-cost averaging)</h2>
    <div class="row"><label>Account<select name="account">${H.accountOptions(accts, H.state.account, paid)}</select></label><label>Amount each time ($)<input name="amount" type="number" value="500" min="5"></label>
      <label>How often<select name="repeat"><option value="monthly">Every month</option><option value="weekly">Every week</option></select></label><label>Day of the month<input name="day" type="number" value="1" min="1" max="28"></label></div>
    <h3>Mix</h3><div id="mix">${mix.map(([s, w]) => row(s, w)).join('')}</div><button type="button" class="ghost small" id="addRow">+ Add a fund</button>
    <p class="mu" id="split"></p><button id="aiGo">Start automatic investing</button><div class="err"></div>
    <p class="mu small-print">Each fund becomes a recurring buy under <a href="#/schedule">Scheduled trades</a>, where you can pause or delete it. Free on the paper account; real accounts are part of Pro.</p></form>`;
  function row(s = '', w = '') { return `<div class="row mixrow"><label>Fund<input name="sym" value="${s}" data-no-tr></label><label>Share (%)<input name="w" type="number" value="${w}" min="1" max="100"></label></div>`; }
  const f = H.$('#ai', el);
  const read = () => H.$$('.mixrow', f).map(r => ({ symbol: r.querySelector('[name=sym]').value.trim().toUpperCase(), weight: +r.querySelector('[name=w]').value })).filter(x => x.symbol && x.weight > 0);
  const show = () => { const items = read(), tot = items.reduce((a, x) => a + x.weight, 0), amt = +f.amount.value || 0; H.$('#split', f).textContent = items.map(x => `${x.symbol} ${H.money(amt * x.weight / (tot || 1))}`).join(' · ') + (tot !== 100 ? ` (shares add up to ${tot}%, split proportionally)` : ''); };
  H.$('#addRow', f).onclick = () => { H.$('#mix', f).insertAdjacentHTML('beforeend', row()); show(); };
  f.oninput = show; show();
  H.act(H.$('#aiGo', f), async () => {
    const r = await H.api('/wealth/autoinvest', { body: { account: f.account.value, amount: +f.amount.value, repeat: f.repeat.value, day: +f.day.value, items: read() } });
    return `Done. First buy on ${new Date(r.nextRun).toLocaleDateString()}.`;
  });
}

async function hold(el) {
  const h = await H.api('/wealth/habits?account=' + H.state.account);
  el.innerHTML = `<div class="card"><h2>Your trading habits (${H.state.account === 'paper' ? 'paper' : 'live'})</h2><div class="stats">
    <div class="stat"><span>Trades</span><b>${h.trades}</b></div><div class="stat"><span>Trades a year</span><b>${h.tradesPerYear}</b></div>
    <div class="stat"><span>Typical holding time</span><b>${h.medianHoldDays == null ? '-' : h.medianHoldDays + ' days'}</b></div>
    <div class="stat"><span>Short-term gains (taxed at your rate)</span><b>${H.money(h.shortGain)}</b></div><div class="stat"><span>Long-term gains (lower tax)</span><b>${H.money(h.longGain)}</b></div>
    <div class="stat"><span>Extra tax from selling within a year</span><b>${H.money(h.extraTax)}</b></div></div>
    <p class="banner">${H.esc(h.verdict)}</p>
    <p class="mu small-print">Estimate: short-term gains at your ${(h.bracket * 100).toFixed(0)}% bracket versus 15% for long-term (set your bracket in <a href="#/tax">Taxes</a>).</p></div>
    <div class="card"><h2>Staying invested</h2><ul class="tips"><li>The S&P 500 fell in about 1 of every 4 years since 1950, and still grew more than a thousand-fold with dividends.</li><li>Missing just the 10 best days of a 20-year stretch roughly halves the result, and the best days often come right after the worst.</li><li>Calm mode (Settings) hides flashing prices so short moves are easier to ignore.</li></ul></div>`;
}

async function drip(el) {
  const [s, accts] = await Promise.all([H.api('/wealth/settings'), H.accounts()]);
  const live = accts.filter(a => a.connected && a.id !== 'paper');
  el.innerHTML = `<form class="card" id="dr"><h2>Reinvest dividends automatically (DRIP)</h2>
    ${live.length ? live.map(a => `<label class="check"><input type="checkbox" name="acct" value="${a.id}" ${s.drip.accounts.includes(a.id) ? 'checked' : ''}> ${H.esc(a.name)}</label>`).join('') : '<p class="mu">Connect a brokerage account first (dividends are not simulated on paper).</p>'}
    <button ${live.length ? '' : 'disabled'}>Save</button><div class="err"></div>
    <p class="mu small-print">Every few hours Brightfolio checks for dividends paid in the last week and buys the same stock with the cash (fractional shares, $1 and up). Part of Pro.</p></form>
    <div class="card tablewrap"><h2>Reinvested</h2><table><tr><th>Date</th><th>Stock</th><th>Amount</th></tr>${s.dripLog.map(d => `<tr><td>${H.date(d.at)}</td><td data-no-tr>${d.symbol}</td><td>${H.money(d.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="mu">Nothing yet</td></tr>'}</table></div>`;
  const f = H.$('#dr', el);
  H.act(H.$('button', f), async () => { await H.api('/wealth/settings', { method: 'PUT', body: { drip: { accounts: H.$$('[name=acct]:checked', f).map(c => c.value) } } }); return 'Saved.'; });
}

function understand(el) {
  el.innerHTML = `<form class="card" id="fu"><h2>Fundamentals checklist</h2><div class="row"><label>Stock ticker<input name="s" value="AAPL" data-no-tr></label><button>Check</button></div><div class="err"></div><div id="fuOut"></div>
    <p class="mu small-print">From the company's own annual reports (10-K) filed with the SEC. Numbers can be restated; read the filing before you buy.</p></form>`;
  const f = H.$('#fu', el);
  H.act(H.$('button', f), async () => {
    const d = await H.api('/wealth/fundamentals/' + encodeURIComponent(f.s.value.trim()));
    H.$('#fuOut', f).innerHTML = `<h3 data-no-tr>${H.esc(d.company)} (${d.symbol}) · ${d.score} of ${d.of} checks pass</h3>
      <div class="checks">${d.checks.map(c => `<div class="checkrow"><span class="dot ${c.pass ? 'on' : ''} ${c.pass === false ? 'bad' : ''}"></span><b>${c.name}</b><span class="mu">${H.esc(c.detail)}</span></div>`).join('')}</div>
      <div class="tablewrap"><table><tr><th>Year</th><th>Revenue</th><th>Net income</th><th>EPS</th></tr>${d.revenue.map(r => `<tr><td>${r.year}</td><td>${H.money(r.value)}</td><td>${H.money(d.income.find(x => x.year === r.year)?.value ?? null)}</td><td>${d.eps.find(x => x.year === r.year)?.value ?? '-'}</td></tr>`).join('')}</table></div>
      <p class="mu">Ask yourself: how does it make money, and why can competitors not easily take that away (its moat)?</p>`;
    return '';
  });
}

function tax(el) {
  el.innerHTML = `<form class="card" id="tx"><h2>Fill the tax-advantaged accounts first</h2>
    <div class="row"><label>Age<input name="age" type="number" value="35"></label><label>Yearly salary ($)<input name="sal" type="number" value="90000"></label><label>Employer match (% of salary)<input name="match" type="number" value="4" step="0.5"></label>
      <label>You can invest a year ($)<input name="budget" type="number" value="15000"></label><label>Tax bracket (%)<input name="br" type="number" value="22"></label></div>
    <div id="txOut"></div>
    <p class="mu small-print">2026 limits: 401(k) $24,500 (+$8,000 from age 50, +$11,250 at 60-63 instead); IRA $7,500 (+$1,100 from age 50). Check irs.gov for your income limits (Roth IRA) and current numbers. Outside the US: ISAs (UK), TFSA/RRSP (Canada) work the same way.</p></form>`;
  const f = H.$('#tx', el);
  const draw = () => {
    const age = +f.age.value, sal = +f.sal.value, budget = +f.budget.value, br = +f.br.value / 100;
    const k401 = 24500 + (age >= 60 && age <= 63 ? 11250 : age >= 50 ? 8000 : 0), ira = 7500 + (age >= 50 ? 1100 : 0), matchAmt = sal * (+f.match.value) / 100;
    let left = budget; const steps = [];
    const take = (label, cap, why) => { const a = Math.max(0, Math.min(left, cap)); if (a > 0) steps.push([label, a, why]); left -= a; };
    take('401(k) up to the employer match', matchAmt, `free money: your employer adds ${H.money(matchAmt)}`);
    take('IRA (Roth or traditional)', ira, 'tax-free or tax-deferred growth');
    take('Rest of the 401(k)', k401 - matchAmt, 'up to the yearly limit');
    take('Taxable brokerage account', Infinity, 'only after the sheltered accounts are full');
    const saved = steps.filter(s => !s[0].startsWith('Taxable')).reduce((a, s) => a + s[1], 0) * br;
    H.$('#txOut', f).innerHTML = `<ol class="txsteps">${steps.map(([l, a, w]) => `<li><b>${l}:</b> ${H.money(a)} <span class="mu">(${w})</span></li>`).join('')}</ol>
      <p>Tax you defer or avoid this year: about <b>${H.money(saved)}</b>.</p>`;
  };
  f.oninput = draw; draw();
}

async function core(el) {
  const accts = await H.accounts();
  el.innerHTML = `<form class="card" id="cs"><h2>Core & satellite plan</h2>
    <div class="row"><label>Core fund<select name="core">${['VTI', 'VOO', 'VT', 'SPLG'].map(s => `<option>${s}</option>`).join('')}</select></label><label>Core share (%)<input name="corePct" type="number" value="80" min="50" max="95"></label>
      <label>Bonds (BND) share (%)<input name="bondPct" type="number" value="0" min="0" max="40"></label></div>
    <h3>Satellite themes (the rest, split equally)</h3><div class="themes">${THEMES.map(([t, s], i) => `<label class="check"><input type="checkbox" name="theme" value="${s}" ${i < 2 ? 'checked' : ''}> ${t} <span class="mu" data-no-tr>${s}</span></label>`).join('')}</div>
    <p id="csSplit" class="mu"></p>
    <div class="row"><label>Account<select name="account">${H.accountOptions(accts, H.state.account, H.paid())}</select></label><label>Starting amount ($)<input name="amount" type="number" value="10000"></label></div>
    <button id="csGo">Create this portfolio</button><div class="err"></div>
    <p class="mu small-print">Saved under <a href="#/portfolios?tab=mine">Portfolios</a> as a fixed-weight portfolio that rebalances back to these shares every quarter once you deploy it.</p></form>`;
  const f = H.$('#cs', el);
  const weights = () => {
    const corePct = +f.corePct.value, bond = +f.bondPct.value, th = H.$$('[name=theme]:checked', f).map(c => c.value), sat = Math.max(0, 100 - corePct - bond);
    const w = { [f.core.value]: corePct }; if (bond) w.BND = bond; th.forEach(s => (w[s] = +(sat / th.length).toFixed(2)));
    return w;
  };
  const show = () => { H.$('#csSplit', f).textContent = Object.entries(weights()).map(([s, w]) => `${s} ${w}%`).join(' · '); };
  f.oninput = show; show();
  H.act(H.$('#csGo', f), async () => {
    const w = weights(), syms = Object.keys(w);
    const r = await H.api('/baskets', { body: { name: 'Core & satellite', description: 'Index-fund core with growth satellites (Wealth builder).', universe: syms.join(','), rankBy: 'none', topN: syms.length, weighting: 'manual', weights: w, rebalance: 'quarterly' } });
    await H.api(`/baskets/${r.id}/deploy`, { body: { on: true, account: f.account.value, amount: +f.amount.value } });
    return 'Created and deployed. It rebalances every quarter.';
  });
}

async function diversify(el) {
  const [d, s] = await Promise.all([H.api('/wealth/diversify?account=' + H.state.account), H.api('/wealth/settings')]);
  const bars = list => list.map((x, i) => `<div class="dbar"><span>${H.esc(x.name)}</span><i style="width:${Math.max(2, x.pct)}%;background:${['#7c5cff', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'][i % 8]}"></i><b>${x.pct}%</b></div>`).join('');
  el.innerHTML = `<div class="grid"><div class="card"><h2>By sector</h2>${d.positions ? bars(d.sectors) : '<p class="mu">No positions yet in this account.</p>'}</div>
    <div class="card"><h2>By region</h2>${d.positions ? bars(d.regions) : '<p class="mu">-</p>'}</div></div>
    ${d.warnings.length ? `<div class="card"><h2>Worth a look</h2><ul class="tips">${d.warnings.map(w => `<li>${H.esc(w)}</li>`).join('')}</ul></div>` : d.positions ? '<div class="card"><p class="pos">Nicely spread out.</p></div>' : ''}
    <div class="card"><h2>Rebalancing</h2><p>Portfolios you build here (Core & satellite, or any fixed-weight portfolio) rebalance by themselves on their schedule. For everything else:</p>
      <label class="check"><input type="checkbox" id="remind" ${s.rebalanceReminder ? 'checked' : ''}> Remind me twice a year (January 15 and July 15) to check my mix</label>
      <a href="#/portfolios?tab=mine"><button type="button" class="ghost">Open my portfolios</button></a></div>`;
  H.$('#remind', el).onchange = e => H.api('/wealth/settings', { method: 'PUT', body: { rebalanceReminder: e.target.checked } });
}
