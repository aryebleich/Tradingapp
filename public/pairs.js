// Pairs trading page: analysis, z-score chart, walk-forward backtest, scanner and pair bots.
let H; // helpers from app.js

export function registerPairs(routes, helpers) {
  H = helpers;
  routes.pairs = pairs;
  routes.statarb = statarb;
}

const f2 = v => (v == null || !Number.isFinite(+v) ? '-' : (+v).toFixed(2));
const pc = v => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(1)}%`);
const SIG = { short_spread: ['Gap is wide: sell A, buy B', 'neg'], long_spread: ['Gap is wide: buy A, sell B', 'pos'], flat: ['Gap is normal: no position', ''], hold: ['In between: keep what you have', 'warn'] };

// z-score line with the entry (solid) and exit (dashed) levels.
function drawZ(canvas, pts, entry, exit) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
  const lim = Math.max(entry + 1, ...pts.map(p => Math.abs(p.z))), X = i => 6 + i / (pts.length - 1) * (w - 12), Y = z => h / 2 - z / lim * (h / 2 - 8);
  const line = (z, dash, col) => { g.setLineDash(dash); g.strokeStyle = col; g.beginPath(); g.moveTo(0, Y(z)); g.lineTo(w, Y(z)); g.stroke(); };
  g.lineWidth = 1; line(0, [], C('--bd'));
  [entry, -entry].forEach(z => line(z, [], C('--rd'))); [exit, -exit].forEach(z => line(z, [4, 4], C('--mu')));
  g.setLineDash([]); g.lineWidth = 2; g.strokeStyle = C('--ac'); g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.z)) : g.moveTo(X(i), Y(p.z)))); g.stroke();
}

async function pairs(view, q) {
  const me = H.me(), paid = (me.role === 'admin' && !me.previewPlan) || (['pro', 'elite', 'ultimate'].includes(me.plan) && ['active', 'trialing', null, undefined].includes(me.planStatus));
  const [bots, accts] = await Promise.all([H.api('/pairs/bots'), H.accounts()]);
  view.innerHTML = `
  <div class="pagehead"><div><h1>Pairs trading</h1><p class="mu" style="margin:4px 0 0">Two stocks that usually move together. When the gap between them stretches far from normal, sell the expensive one and buy the cheap one, then close when the gap returns.</p></div><a href="#/statarb"><button class="ghost" type="button">Whole basket: statistical arbitrage</button></a></div>
  <form class="card" id="pf"><div class="pairrow">
    <label>Stock A<input name="a" value="${H.esc(q.get('a') || 'KO')}" maxlength="10" autocomplete="off"></label><label>Stock B<input name="b" value="${H.esc(q.get('b') || 'PEP')}" maxlength="10" autocomplete="off"></label>
    <label>Fit window (days)<input name="lookback" type="number" value="252"></label><label>z window (days)<input name="zWindow" type="number" value="60"></label>
    <label>Enter at |z| ≥<input name="entryZ" type="number" step="0.1" value="2"></label><label>Exit at |z| ≤<input name="exitZ" type="number" step="0.1" value="0.5"></label>
    <label>Stop at |z| ≥<input name="stopZ" type="number" step="0.1" value="3.5"></label><label>Max days in a trade<input name="maxDays" type="number" value="30"></label></div>
    <button>Analyze pair</button> <button type="button" class="ghost" id="scan">Scan 20 popular pairs</button><div class="err"></div></form>
  <div id="out"></div>
  <div id="scanOut"></div>
  <div class="card tablewrap"><h2>Pair bots ${paid ? '' : '<span class="pill">Pro</span>'}</h2>
    <p class="mu" style="margin-top:0">A pair bot checks its pair every trading day at 3:45 pm New York time and trades when the gap crosses your levels.</p>
    <table><tr><th>Pair</th><th>Account</th><th>Mode</th><th>Money</th><th>Position</th><th>Last run</th><th></th></tr>
    ${bots.map(b => `<tr data-bot="${b.id}"><td><b>${H.esc(b.a)} / ${H.esc(b.b)}</b><div class="mu" style="font-size:12px">enter ${b.params.entryZ} · exit ${b.params.exitZ} · stop ${b.params.stopZ}</div></td><td>${H.esc(H.acctLabel(accts.find(a => a.id === b.account) || { id: b.account, name: b.account }))}</td>
      <td>${b.mode === 'neutral' ? 'Market-neutral' : 'Long only'}</td><td>${H.money(b.capital)}</td><td>${b.state.pos ? `${b.state.qa ? `${b.state.qa > 0 ? 'Long' : 'Short'} ${Math.abs(b.state.qa)} ${H.esc(b.a)}` : ''} ${b.state.qb ? `${b.state.qb > 0 ? 'Long' : 'Short'} ${Math.abs(b.state.qb)} ${H.esc(b.b)}` : ''}` : 'Flat'}</td>
      <td class="mu" style="font-size:13px">${b.last_run ? `${H.esc(b.last_run)}: ${H.esc(b.last_summary || '')}` : 'Not yet'}</td>
      <td><label class="switch" title="${b.active ? 'On' : 'Paused'}"><input type="checkbox" data-act ${b.active ? 'checked' : ''}><i></i></label> <button class="small ghost" data-run>Run now</button> <button class="small ghost danger-t" data-del>Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="mu">No pair bots yet. Analyze a pair, then start a bot from the result.</td></tr>'}</table></div>
  <p class="mu" style="font-size:12px">Pairs that moved together in the past can stop doing so (a merger, a lawsuit, a new product). The stop level and the time limit exist for that. Short selling needs a margin account and has borrowing costs; the paper account trades the long-only version. Backtests are hypothetical.</p>`;
  const f = H.$('#pf', view), body = () => { const d = H.form(f); return { ...d, a: d.a.trim().toUpperCase(), b: d.b.trim().toUpperCase() }; };
  H.act(H.$('button', f), async () => {
    const r = await H.api('/pairs/analyze', { body: body() });
    const [st, sc] = SIG[r.signal];
    H.$('#out', view).innerHTML = `<div class="card"><h2>${H.esc(r.a)} / ${H.esc(r.b)} <span class="pill ${r.cointegrated ? 'pos' : 'neg'}">${H.esc(r.verdict)}</span></h2>
      <div class="stats">
        <div class="stat"><span>Today's z-score</span><b class="${Math.abs(r.z) >= r.params.entryZ ? 'neg' : ''}">${f2(r.z)}</b></div>
        <div class="stat"><span>Signal</span><b class="${sc}" style="font-size:15px">${st}</b></div>
        <div class="stat"><span>Hedge ratio (β)</span><b>${f2(r.beta)}</b></div>
        <div class="stat"><span>Half-life</span><b>${Number.isFinite(r.halfLife) ? r.halfLife.toFixed(1) + ' days' : 'never'}</b></div>
        <div class="stat"><span>Correlation</span><b>${f2(r.correlation)}</b></div>
        <div class="stat"><span>Cointegration t-stat</span><b>${f2(r.adf)}</b></div></div>
      <h3 style="margin-top:18px">z-score of the gap, last ${r.params.lookback} days</h3><canvas id="zc" style="height:220px"></canvas>
      <p class="mu" style="font-size:12px">Red lines: enter at ±${r.params.entryZ}. Dashed: exit at ±${r.params.exitZ}. Cointegration t-stat below -3.34 means the gap has reliably closed in the past (5% level). Data: ${H.esc(r.source.join(', '))}.</p>
      <h3>Backtest ${r.backtest.from} to ${r.backtest.to} <span class="mu" style="font-weight:500">(hedge ratio re-fitted monthly on past data only, 0.05% cost per trade)</span></h3>
      <div class="tablewrap"><table><tr><th>Version</th><th>Return per year</th><th>Worst drop</th><th>Sharpe</th><th>Trades</th><th>Win rate</th></tr>
        ${[['Market-neutral (long + short)', r.backtest.neutral], ['Long only (buy the cheap one)', r.backtest.longOnly]].map(([n, b]) => `<tr><td>${n}</td><td class="${H.cls(b.m.cagr)}">${pc(b.m.cagr)}</td><td class="neg">-${b.m.dd.toFixed(1)}%</td><td>${f2(b.m.sharpe)}</td><td>${b.trades}</td><td>${b.winRate == null ? '-' : b.winRate.toFixed(0) + '%'}</td></tr>`).join('')}</table></div>
      <canvas id="pc" style="height:200px"></canvas><p class="mu" style="font-size:12px">Colored: market-neutral. Grey: long only.</p>
      <form id="botf" class="botf"><h3>Run this pair automatically</h3><div class="pairrow">
        <label>Account<select name="account">${H.accountOptions(accts, 'paper', paid)}</select></label>
        <label>Mode<select name="mode"><option value="long_only">Long only (no shorting)</option><option value="neutral">Market-neutral (needs margin)</option></select></label>
        <label>Money for this pair ($)<input name="capital" type="number" value="10000" min="100"></label></div>
        <button>${paid ? 'Start pair bot' : 'Start pair bot (Pro)'}</button><div class="err"></div></form></div>`;
    drawZ(H.$('#zc', view), r.zHistory, r.params.entryZ, r.params.exitZ);
    H.drawChart(H.$('#pc', view), r.backtest.neutral.curve, { base: 10000, compare: r.backtest.longOnly.curve });
    const bf = H.$('#botf', view);
    H.act(H.$('button', bf), async () => { await H.api('/pairs/bots', { body: { ...body(), ...H.form(bf) } }); setTimeout(H.render, 800); return 'Pair bot started'; });
    return '';
  });
  H.act(H.$('#scan', view), async () => {
    const rows = await H.api('/pairs/scan', { body: body() });
    H.$('#scanOut', view).innerHTML = `<div class="card tablewrap"><h2>Popular pairs, strongest first</h2><table><tr><th>Pair</th><th>Cointegrated</th><th>t-stat</th><th>Half-life</th><th>Correlation</th><th>z today</th><th>Signal</th><th></th></tr>
      ${rows.map(r => r.error ? `<tr><td>${H.esc(r.a)} / ${H.esc(r.b)}</td><td colspan="7" class="mu">${H.esc(r.error)}</td></tr>` : `<tr><td><b>${H.esc(r.a)} / ${H.esc(r.b)}</b></td><td>${r.cointegrated ? `<span class="pill pos">${r.cointegrated}% level</span>` : '<span class="pill">no</span>'}</td><td>${f2(r.adf)}</td>
        <td>${Number.isFinite(r.halfLife) ? r.halfLife.toFixed(1) + 'd' : '-'}</td><td>${f2(r.correlation)}</td><td class="${Math.abs(r.z) >= 2 ? 'neg' : ''}">${f2(r.z)}</td><td><span class="pill ${SIG[r.signal][1]}">${SIG[r.signal][0]}</span></td>
        <td><a href="#/pairs?a=${encodeURIComponent(r.a)}&b=${encodeURIComponent(r.b)}"><button class="small ghost" type="button">Open</button></a></td></tr>`).join('')}</table></div>`;
    return `Scanned ${rows.length} pairs`;
  });
  H.$$('[data-bot]', view).forEach(tr => {
    const id = tr.dataset.bot;
    H.$('[data-act]', tr).onchange = async e => { await H.api(`/pairs/bots/${id}/active`, { body: { active: e.target.checked } }); };
    H.act(H.$('[data-run]', tr), async () => { const r = await H.api(`/pairs/bots/${id}/run`, { body: {} }); setTimeout(H.render, 1500); return r.summary; });
    H.act(H.$('[data-del]', tr), async () => { if (!confirm('Delete this pair bot? Open positions stay in your account.')) return ''; await H.api(`/pairs/bots/${id}`, { method: 'DELETE' }); H.render(); return ''; });
  });
  if (q.get('a')) H.$('button', f).click();
}

// ---------- statistical arbitrage: a whole basket at once ----------
// Heat-map colors: blue for negative, orange for positive, stronger with the size of the value.
const heat = (v, max) => { const x = Math.max(-1, Math.min(1, v / max)); return `hsl(${x < 0 ? 215 : 28} 85% ${Math.round(96 - Math.abs(x) * 46)}%)`; };
const METRICS = {
  correlation: ['Correlation of daily returns', c => c.correlation, 1, v => v.toFixed(2)],
  adf: ['Cointegration t-stat (below -3.34 = cointegrated)', c => c.adf, 6, v => v.toFixed(1)],
  z: ['Gap z-score today', c => c.z, 3, v => v.toFixed(1)],
};
const SSIG = { buy: ['Buy (cheap)', 'pos'], sell: ['Sell short (rich)', 'neg'], hold: ['Hold', 'warn'], flat: ['No position', ''] };

// Python version for the code lab (numpy): the same s-score model as a portfolio(prices) function.
export function statArbPython(syms, o) {
  return `# symbols: ${syms.join(', ')}
# Statistical arbitrage with numpy: each stock's daily return is split into the basket's common
# move and its own residual. Buy stocks whose summed residual is far below its normal level,
# sell short those far above, and close when they come back (Avellaneda and Lee, 2010).
import numpy as np

WINDOW, ENTRY, EXIT = ${o.window}, ${o.entry}, ${o.exit}

def portfolio(prices):
    syms = list(prices)
    n = min(len(prices[s]['close']) for s in syms)
    P = np.array([prices[s]['close'][:n] for s in syms], dtype=float)
    R = P[:, 1:] / P[:, :-1] - 1           # R[:, j] = return from day j to day j + 1
    w = {s: [0.0] * n for s in syms}
    pos = np.zeros(len(syms))
    for t in range(WINDOW, n - 1):
        r = R[:, t - WINDOW:t]              # only returns known on day t
        mkt = r.mean(axis=0)
        for k in range(len(syms)):
            beta = np.cov(r[k], mkt)[0, 1] / mkt.var(ddof=1)
            x = np.cumsum(r[k] - beta * mkt)
            b, a = np.polyfit(x[:-1], x[1:], 1)
            if not 0 < b < 1:
                pos[k] = 0
                continue
            e = x[1:] - (a + b * x[:-1])
            s = (x[-1] - a / (1 - b)) / (e.std() / np.sqrt(1 - b * b))
            if pos[k] == 0:
                pos[k] = 1 if s < -ENTRY else -1 if s > ENTRY else 0
            elif abs(s) < EXIT or np.sign(s) == pos[k]:
                pos[k] = 0
        held = np.count_nonzero(pos)
        for k, sym in enumerate(syms):
            w[sym][t] = pos[k] / held if held else 0.0
    print('Positions today:', {syms[k]: 'long' if pos[k] > 0 else 'short' for k in range(len(syms)) if pos[k]})
    return w
`;
}

let liveTimer = null;
async function statarb(view, q) {
  clearInterval(liveTimer);
  const info = await H.api('/statarb/baskets');
  const first = Object.keys(info.baskets)[3], lim = info.limits;
  view.innerHTML = `
  <div class="pagehead"><div><h1>Statistical arbitrage</h1><p class="mu" style="margin:4px 0 0">Pairs trading for a whole basket. Every stock is measured against the basket's common move: buy the ones that fell unusually far behind, sell short the ones that ran unusually far ahead, and close when they come back.</p></div>
    <a href="#/pairs"><button class="ghost" type="button">Two-stock pairs</button></a></div>
  <form class="card" id="sf"><div class="pairrow">
    <label>Basket<select name="preset"><option value="">Your own list</option>${Object.keys(info.baskets).map(b => `<option ${b === first ? 'selected' : ''}>${H.esc(b)}</option>`).join('')}</select></label>
    <label style="grid-column:span 2">Stocks (3 to ${lim.symbols})<input name="symbols" value="${H.esc(q.get('symbols') || info.baskets[first].join(', '))}" autocomplete="off"></label>
    <label>Window (days)<input name="window" type="number" value="${info.defaults.window}"></label>
    <label>Enter at |s| ≥<input name="entry" type="number" step="0.05" value="${info.defaults.entry}"></label>
    <label>Exit at |s| ≤<input name="exit" type="number" step="0.05" value="${info.defaults.exit}"></label></div>
    <button>Analyze basket</button>
    <label class="chk" style="display:inline-flex;margin-inline-start:12px"><input type="checkbox" id="live" ${lim.refresh ? '' : 'disabled'}> Live: refresh ${lim.refresh ? `every ${lim.refresh} seconds` : '(Pro)'}</label>
    <p class="mu" style="font-size:12.5px;margin:8px 0 0">Your plan: up to ${lim.symbols} stocks${lim.refresh ? `, live every ${lim.refresh} s` : ', refresh by hand'}. ${Object.entries(info.plans).filter(([k]) => k !== 'free').map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)}: ${v.symbols} stocks, every ${v.refresh} s`).join(' · ')}.</p>
    <div class="err"></div></form>
  <div id="sOut"></div>`;
  const f = H.$('#sf', view), out = H.$('#sOut', view);
  f.preset.onchange = () => { if (f.preset.value) f.symbols.value = info.baskets[f.preset.value].join(', '); };
  let metric = 'correlation', last = null;
  const drawMatrix = r => {
    const [label, get, max, fmt] = METRICS[metric], cell = new Map(r.matrix.map(c => [c.a + '|' + c.b, c]));
    const find = (a, b) => cell.get(a + '|' + b) || cell.get(b + '|' + a);
    return `<div class="seg" id="metric">${Object.entries(METRICS).map(([k, v]) => `<button type="button" data-m="${k}" class="${k === metric ? 'on' : ''}">${v[0].split(' (')[0]}</button>`).join('')}</div>
      <p class="mu" style="font-size:13px">${H.esc(label)}. Click a square to open that pair.</p>
      <div class="tablewrap"><table class="heat" dir="ltr"><tr><th></th>${r.symbols.map(s => `<th>${H.esc(s)}</th>`).join('')}</tr>
      ${r.symbols.map(a => `<tr><th>${H.esc(a)}</th>${r.symbols.map(b => { if (a === b) return '<td class="diag"></td>'; const c = find(a, b), v = get(c); return `<td style="background:${heat(metric === 'adf' ? -(v + 2) : v, metric === 'adf' ? 4 : max)}" title="${H.esc(a)} / ${H.esc(b)}" data-a="${H.esc(a)}" data-b="${H.esc(b)}" class="${metric === 'adf' && c.cointegrated ? 'co' : ''}">${fmt(v)}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
  };
  const draw = (r, keepBacktest) => {
    if (keepBacktest && last?.backtest) r.backtest = last.backtest;
    last = r;
    const b = r.backtest;
    out.innerHTML = `<div class="card"><h2>Pair matrix <span class="mu" style="font-weight:500;font-size:14px">as of ${H.esc(r.asOf)}</span></h2><div id="mx">${drawMatrix(r)}</div></div>
      <div class="card tablewrap"><h2>Signals today</h2><table><tr><th>Stock</th><th>s-score</th><th></th><th>Beta to basket</th><th>Half-life</th><th>Signal</th></tr>
      ${[...r.scores].sort((x, y) => x.s - y.s).map(x => `<tr><td><b>${H.esc(x.symbol)}</b></td><td>${f2(x.s)}</td><td style="min-width:120px"><div class="sbar" dir="ltr"><i style="${x.s < 0 ? 'right:50%' : 'left:50%'};width:${Math.min(50, Math.abs(x.s) / 3 * 50)}%" class="${x.s < 0 ? 'lo' : 'hi'}"></i></div></td><td>${f2(x.beta)}</td><td>${x.halfLife != null ? x.halfLife + ' days' : '-'}</td><td><span class="pill ${SSIG[x.signal][1]}">${x.meanReverting ? SSIG[x.signal][0] : 'Not mean-reverting'}</span></td></tr>`).join('')}</table>
      <p class="mu" style="font-size:12px">s-score: how many standard deviations a stock sits from its own normal level against the basket. Stocks whose residual does not pull back within half the window are skipped.</p></div>
      ${b ? `<div class="card"><h2>Backtest ${H.esc(b.from)} to ${H.esc(b.to)}</h2><div class="stats"><div class="stat"><span>Return per year</span><b class="${H.cls(b.m.cagr)}">${pc(b.m.cagr)}</b></div><div class="stat"><span>Worst drop</span><b class="neg">-${b.m.dd.toFixed(1)}%</b></div><div class="stat"><span>Sharpe</span><b>${f2(b.m.sharpe)}</b></div><div class="stat"><span>Trades</span><b>${b.trades}</b></div></div>
        <canvas id="sc" style="height:200px"></canvas><p class="mu" style="font-size:12px">Long and short positions, equal money each, re-fitted every day on past data only, 0.05% cost per trade. Short selling needs a margin account. Data: ${H.esc(r.source.join(', '))}.</p>
        <button type="button" class="ghost" id="toPy">Run it in Python (code lab)</button></div>` : ''}`;
    if (b) { H.drawChart(H.$('#sc', view), b.curve, { base: 10000 }); H.$('#toPy', view).onclick = () => { try { sessionStorage.setItem('qp_code_draft', JSON.stringify({ name: 'Statistical arbitrage', code: statArbPython(r.symbols, r.params) })); } catch {} location.hash = '#/code'; }; }
    wire();
  };
  const wire = () => {
    H.$$('#metric button', view).forEach(x => (x.onclick = () => { metric = x.dataset.m; H.$('#mx', view).innerHTML = drawMatrix(last); wire(); }));
    H.$$('td[data-a]', view).forEach(td => (td.onclick = () => (location.hash = `#/pairs?a=${encodeURIComponent(td.dataset.a)}&b=${encodeURIComponent(td.dataset.b)}`)));
  };
  const body = () => { const d = H.form(f); return { symbols: d.symbols, window: d.window, entry: d.entry, exit: d.exit }; };
  H.act(H.$('button', f), async () => { const r = await H.api('/statarb/analyze', { body: body() }); draw(r); return ''; });
  H.$('#live', view).onchange = e => {
    clearInterval(liveTimer);
    if (!e.target.checked || !lim.refresh) return;
    liveTimer = setInterval(async () => {
      if (!document.body.contains(f)) return clearInterval(liveTimer);
      if (document.hidden || !last) return;
      try { draw(await H.api('/statarb/analyze', { body: { ...body(), live: true } }), true); } catch (x) { H.$('.err', f).textContent = x.message; }
    }, lim.refresh * 1000);
  };
  H.$('button', f).click();
}
