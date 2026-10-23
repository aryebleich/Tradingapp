// S&P 500 page: the index's record, a monthly investing plan projected from real history, and
// automatic buys of an index fund.
let H; // helpers from app.js

export function registerSp500(routes, helpers) {
  H = helpers;
  routes.sp500 = sp500;
}

const pc = v => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(1)}%`);
const big = v => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString('en-US')}`);

// Range of outcomes: shaded 10th-90th percentile band, median line, and money put in.
function drawBands(canvas, bands, perMonth, initial) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
  const hi = Math.max(...bands.map(b => b.p90)) * 1.05, X = i => 8 + i / (bands.length - 1) * (w - 16), Y = v => h - 8 - v / hi * (h - 16);
  g.fillStyle = C('--ac'); g.globalAlpha = 0.16; g.beginPath();
  bands.forEach((b, i) => (i ? g.lineTo(X(i), Y(b.p90)) : g.moveTo(X(i), Y(b.p90))));
  [...bands].reverse().forEach((b, i) => g.lineTo(X(bands.length - 1 - i), Y(b.p10))); g.closePath(); g.fill(); g.globalAlpha = 1;
  const line = (key, col, dash = []) => { g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); bands.forEach((b, i) => (i ? g.lineTo(X(i), Y(key(b))) : g.moveTo(X(i), Y(key(b))))); g.stroke(); };
  line(b => b.p50, C('--ac')); line(b => initial + perMonth * 12 * b.year, C('--mu'), [5, 4]); g.setLineDash([]);
}

async function sp500(view) {
  const me = H.me(), paid = me.role === 'admin' || (['pro', 'elite'].includes(me.plan) && ['active', 'trialing', null, undefined].includes(me.planStatus));
  const [s, accts] = await Promise.all([H.api('/sp500'), H.accounts()]);
  view.innerHTML = `
  <div class="pagehead"><div><h1>S&amp;P 500</h1><p class="mu" style="margin:4px 0 0">The 500 largest US companies in one fund. The simplest long-term plan: buy a little every month, whatever the market does.</p></div></div>
  <div class="card"><div class="stats">
    <div class="stat"><span>SPY today</span><b>${H.money(s.price)}</b></div><div class="stat"><span>This year</span><b class="${H.cls(s.ytd)}">${pc(s.ytd)}</b></div>
    <div class="stat"><span>Last 12 months</span><b class="${H.cls(s.y1)}">${pc(s.y1)}</b></div><div class="stat"><span>5 years, per year</span><b class="${H.cls(s.cagr5)}">${pc(s.cagr5)}</b></div>
    <div class="stat"><span>10 years, per year</span><b class="${H.cls(s.cagr10)}">${pc(s.cagr10)}</b></div><div class="stat"><span>Worst drop since ${s.since.slice(0, 4)}</span><b class="neg">-${s.maxDrawdown.toFixed(0)}%</b></div></div>
    <canvas id="spx" style="height:220px;margin-top:14px"></canvas>
    <p class="mu" style="font-size:12px">Dividends included (adjusted prices). Best year ${s.bestYear.year}: ${pc(s.bestYear.ret)} · worst year ${s.worstYear.year}: ${pc(s.worstYear.ret)}. Data: ${H.esc(s.source)}.</p>
    <div class="years">${s.years.slice(-20).map(y => `<span class="${y.ret >= 0 ? 'up' : 'down'}" title="${y.year}: ${pc(y.ret)}"><i style="height:${Math.min(50, Math.abs(y.ret) * 1.2)}%"></i><em>${String(y.year).slice(2)}</em></span>`).join('')}</div>
  </div>
  <div class="sgrid">
    <form class="card" id="pf"><h2>Your investment plan</h2>
      <div class="grid2"><label>Start with ($)<input name="initial" type="number" min="0" value="1000"></label><label>Add every month ($)<input name="perMonth" type="number" min="0" value="300"></label>
      <label>For how many years<input name="years" type="number" min="1" max="50" value="20"></label><label>Goal (optional, $)<input name="goal" type="number" min="0" placeholder="1000000"></label></div>
      <label>Fund<select name="fund">${s.funds.map(f => `<option value="${f.symbol}">${f.symbol}: ${H.esc(f.name)} (${f.fee}% a year)</option>`).join('')}</select></label>
      <button>Show my range</button><div class="err"></div>
      <div id="proj"></div></form>
    <div>
      <form class="card" id="auto"><h2>Invest automatically</h2>
        <p class="mu" style="margin-top:0">Buys your fund on the same day every month, in dollars (fractional shares), so every dollar is invested.</p>
        <div class="grid2"><label>Amount ($)<input name="amount" type="number" min="1" value="300"></label><label>Day of the month<input name="day" type="number" min="1" max="28" value="1"></label></div>
        <div class="grid2"><label>Fund<select name="fund">${s.funds.map(f => `<option>${f.symbol}</option>`).join('')}</select></label>
        <label>Account<select name="account">${H.accountOptions(accts, 'paper', paid)}</select></label></div>
        <label>How often<select name="repeat"><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></label>
        <button>Start investing</button><div class="err"></div></form>
      <div class="card tablewrap"><h2>Active plans</h2><table><tr><th>Fund</th><th>Amount</th><th>Repeats</th><th>Next buy</th><th></th></tr>
        ${s.plans.map(p => `<tr><td><b>${H.esc(p.symbol)}</b> <span class="mu">${H.esc(H.acctLabel(accts.find(a => a.id === p.account) || { id: p.account, name: p.account }))}</span></td><td>${H.money(p.notional)}</td><td>${H.esc(p.repeat)}</td><td>${new Date(p.next_run).toLocaleDateString()}</td><td><button class="small ghost" data-stop="${p.id}">Stop</button></td></tr>`).join('') || '<tr><td colspan="5" class="mu">No automatic plan yet.</td></tr>'}</table></div>
    </div>
  </div>
  <p class="mu" style="font-size:12px">Projections resample real 12-month stretches of S&amp;P 500 history (crashes included) 2,000 times. They are not a forecast or a promise; the market can fall for years.</p>`;
  H.drawChart(H.$('#spx', view), s.chart, { base: s.chart[0] });
  const pf = H.$('#pf', view);
  H.act(H.$('button', pf), async () => {
    const f = H.form(pf), r = await H.api('/sp500/projection', { body: f });
    H.$('#proj', view).innerHTML = `<div class="stats" style="margin-top:14px">
      <div class="stat"><span>You put in</span><b>${big(r.contributed)}</b></div><div class="stat"><span>Typical result</span><b class="pos">${big(r.p50)}</b></div>
      <div class="stat"><span>Bad case (1 in 10)</span><b>${big(r.p10)}</b></div><div class="stat"><span>Good case (1 in 10)</span><b>${big(r.p90)}</b></div></div>
      <canvas id="bands" style="height:220px;margin-top:12px"></canvas>
      <p class="mu" style="font-size:12px">Shaded: 8 out of 10 outcomes. Line: the middle outcome. Dashed: money you put in. Chance of ending below what you put in: ${r.lossChance.toFixed(1)}%. Fund costs (${r.fund.fee}%/yr) included; taxes not.</p>
      ${r.goal ? `<p class="note">To reach ${big(r.goal.goal)} in ${r.years} years at the long-run average, invest about <b>${H.money(r.goal.perMonthTypical)}</b> a month.</p>` : ''}`;
    drawBands(H.$('#bands', view), r.bands, +f.perMonth || 0, +f.initial || 0);
    return '';
  });
  H.$('button', pf).click();
  const af = H.$('#auto', view);
  H.act(H.$('button', af), async () => { const r = await H.api('/sp500/plan', { body: H.form(af) }); setTimeout(H.render, 1200); return `Started. First buy ${new Date(r.nextRun).toLocaleDateString()}.`; });
  H.$$('[data-stop]', view).forEach(b => (b.onclick = async () => { await H.api('/schedule/' + b.dataset.stop, { method: 'DELETE' }); H.render(); }));
}
