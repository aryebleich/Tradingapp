// Pairs trading page: analysis, z-score chart, walk-forward backtest, scanner and pair bots.
let H; // helpers from app.js

export function registerPairs(routes, helpers) {
  H = helpers;
  routes.pairs = pairs;
  routes.statarb = statarb;
  routes.livepairs = livePairs;
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
  <div class="card tablewrap"><h2>Pair bots</h2>
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
        <button>Start pair bot</button>${paid ? '' : '<p class="mu small-print">Every plan runs pair bots on practice money; a brokerage account needs Pro.</p>'}<div class="err"></div></form></div>`;
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
// The live market scan for pairs: progress, the stock being loaded, and the best pairs so far.
async function scanSetup(view) {
  const meta = await H.api('/statscan/meta'), f = H.$('#scanf', view), out = H.$('#scanLive', view);
  H.$('#scanU', view).innerHTML = Object.entries(meta.universes).map(([k, t]) => `<option value="${H.esc(k)}">${H.esc(t)}</option>`).join('');
  H.$('#scanM', view).innerHTML = Object.entries(meta.methods).map(([k, t]) => `<option value="${k}">${H.esc(t)}</option>`).join('');
  f.size.max = meta.limit; f.size.value = Math.min(100, meta.limit);
  const sync = () => { H.$('#scanSymsL', view).hidden = f.universe.value !== 'custom'; H.$('#scanSizeL', view).hidden = f.universe.value !== 'market'; };
  f.universe.onchange = sync; sync();
  let timer = null, id = null;
  const show = j => {
    const pct = j.total ? Math.round((j.loaded / j.total) * (j.status === 'loading' ? 70 : 70) + (j.status === 'loading' ? 0 : j.pairs ? 30 * j.tested / j.pairs : 30)) : 0;
    out.innerHTML = `<div class="scanbar"><i style="width:${j.status === 'done' ? 100 : pct}%"></i></div>
      <p class="scanstat">${j.status === 'loading' ? `Loading prices <b data-no-tr>${H.esc(j.current || '')}</b> · ${j.loaded} of ${j.total} stocks` : j.status === 'testing' ? `Testing pairs · ${j.tested} of ${j.pairs} (${H.esc(j.methodName)})` : j.status === 'done' ? `Done in ${j.seconds} s · ${j.total} stocks, ${j.pairs} related pairs tested` : `Stopped: ${H.esc(j.error || '')}`}${j.synthetic ? ' · simulated prices' : ''}</p>
      ${j.top.length ? `<div class="tablewrap"><table class="slim"><tr><th>Pair</th><th>Score</th><th>Correlation</th><th>Cointegration t</th><th>Half-life</th><th>Gap today (z)</th><th>Signal</th><th></th></tr>${j.top.map(r => `<tr><td data-no-tr><b>${H.esc(r.a)}</b> / <b>${H.esc(r.b)}</b></td><td>${r.score}</td><td>${r.correlation}</td><td class="${r.cointegrated ? 'pos' : ''}">${r.adf}${r.cointegrated ? ' ✓' : ''}</td><td>${r.halfLife ?? '-'} d</td><td class="${Math.abs(r.z) >= 2 ? 'neg' : ''}"><b>${r.z}</b></td><td>${H.esc(r.signal)}</td><td><a href="#/pairs?a=${encodeURIComponent(r.a)}&b=${encodeURIComponent(r.b)}">Open</a></td></tr>`).join('')}</table></div>` : ''}
      ${j.limit ? `<p class="mu small-print">Your plan scans up to ${j.limit} stocks at once. A cointegration t below -3.34 means a lasting relationship (5% level); half-life is how many days a gap usually takes to close by half. Past relationships can break.</p>` : ''}`;
    H.$('#scanStop', view).hidden = !['loading', 'testing'].includes(j.status);
  };
  H.act(H.$('#scanGo', view), async () => {
    clearInterval(timer);
    const j = await H.api('/statscan', { body: H.form(f) }); id = j.id; show(j);
    timer = setInterval(async () => { if (!out.isConnected) return clearInterval(timer); const s = await H.api('/statscan/' + id).catch(() => null); if (!s) return; show(s); if (['done', 'error'].includes(s.status)) clearInterval(timer); }, 800);
    return '';
  });
  H.$('#scanStop', view).onclick = async () => { if (id) await H.api('/statscan/' + id, { method: 'DELETE' }); clearInterval(timer); H.$('#scanStop', view).hidden = true; };
}

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
    <label>Exit at |s| ≤<input name="exit" type="number" step="0.05" value="${info.defaults.exit}"></label>
    <label>Gap detection<select name="method"><option value="ols">Cointegration (Engle-Granger)</option><option value="kalman">Kalman filter (adaptive hedge)</option><option value="distance">Distance (normalized prices)</option><option value="ratio">Price ratio, Bollinger bands</option></select></label>
    <label>Common move<select name="factor"><option value="basket">Equal-weight basket</option><option value="pca">First principal component (PCA)</option></select></label></div>
    <button>Analyze basket</button>
    <label class="chk" style="display:inline-flex;margin-inline-start:12px"><input type="checkbox" id="live" ${lim.refresh ? '' : 'disabled'}> Live: refresh ${lim.refresh ? `every ${lim.refresh} seconds` : '(Pro)'}</label>
    <p class="mu" style="font-size:12.5px;margin:8px 0 0">Your plan: up to ${lim.symbols} stocks${lim.refresh ? `, live every ${lim.refresh} s` : ', refresh by hand'}. ${Object.entries(info.plans).filter(([k]) => k !== 'free').map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)}: ${v.symbols} stocks, every ${v.refresh} s`).join(' · ')}.</p>
    <div class="err"></div></form>
  <div id="sOut"></div>
  <form class="card" id="scanf"><h2>Scan the market for pairs</h2><p class="mu" style="margin-top:0">Loads every stock you choose, finds the ones that move together, tests each pair for a lasting relationship, and ranks the ones stretched apart today. You can watch it work.</p>
    <div class="row"><label>What to scan<select name="universe" id="scanU"></select></label><label id="scanSizeL">How many (biggest first)<input name="size" type="number" min="10" step="10" value="100"></label><label>Gap detection<select name="method" id="scanM"></select></label></div>
    <label id="scanSymsL" hidden>My stocks<input name="symbols" placeholder="AAPL, MSFT, GOOGL, …" data-no-tr></label>
    <div class="row" style="gap:8px"><button id="scanGo">Start scan</button><button type="button" class="ghost" id="scanStop" hidden>Stop</button></div><div class="err"></div>
    <div id="scanLive"></div></form>`;
  scanSetup(view);
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
  const body = () => { const d = H.form(f); return { symbols: d.symbols, window: d.window, entry: d.entry, exit: d.exit, method: d.method, factor: d.factor }; };
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

// ---------- Live ratio: the intraday model on live data (src/pairslive.js) ----------
const pct2 = v => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(2)}%`);
const usd = v => (v == null || !Number.isFinite(+v) ? '-' : H.money(+v));
function svgLines(series, { h = 150, hlines = [], label = '' } = {}) {
  const len = Math.max(0, ...series.map(s => s.ys.length)); if (len < 2) return '<p class="mu">The chart fills in as the bot runs.</p>';
  const vals = series.flatMap(s => s.ys.filter(Number.isFinite)).concat(hlines.map(l => l.y));
  let lo = Math.min(...vals), hi = Math.max(...vals); if (lo === hi) { lo -= 1; hi += 1; }
  const W = 600, y = v => (h - 6 - (v - lo) / (hi - lo) * (h - 12)).toFixed(1), x = i => (i / (len - 1) * W).toFixed(1);
  const path = ys => ys.map((v, i) => (Number.isFinite(v) ? `${i ? 'L' : 'M'}${x(i)},${y(v)}` : '')).join('');
  return `<figure class="ofi-fig"><svg class="ofi-chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${H.esc(label)}">${hlines.map(l => `<line x1="0" x2="${W}" y1="${y(l.y)}" y2="${y(l.y)}" class="hl ${l.cls || ''}"/>`).join('')}${series.map(s => `<path d="${path(s.ys)}" class="ln ${s.cls}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
    <figcaption class="legend">${series.map(s => `<span><i class="sw ${s.cls}"></i>${H.esc(s.name)}</span>`).join('')}${hlines.map(l => `<span><i class="sw hl ${l.cls || ''}"></i>${H.esc(l.name)}</span>`).join('')}</figcaption></figure>`;
}
async function livePairs(view, q) {
  const [d, accts] = await Promise.all([H.api('/pairslive'), H.api('/pairslive/accounts')]);
  const D0 = d.defaults, liveAccts = accts.filter(a => a.id !== 'paper');
  const field = (name, label, v, extra = '') => `<label>${label}<input name="${name}" type="number" value="${v}" ${extra}></label>`;
  view.innerHTML = `<div class="pagehead"><h1>Live ratio pairs</h1><p class="mu" style="margin:4px 0 0">The intraday model: every few minutes it compares A with its fair value (beta × B, from the ratio of their average prices) and, past your thresholds, buys the cheap one and sells the rich one, sized by their volatility ratio. It closes them when they converge. The daily OLS z-score model is on the Pairs trading tab.</p></div>
    <div class="banner warn" role="note"><b>${H.esc(d.note)}</b></div>
    <form class="card" id="lpf"><h2>New live-ratio bot <span class="pill">starts on Paper</span></h2>
      <div class="pairrow"><label>Stock A<input name="a" value="${H.esc(q.get('a') || 'KO')}" maxlength="10" autocomplete="off" data-no-tr></label><label>Stock B<input name="b" value="${H.esc(q.get('b') || 'PEP')}" maxlength="10" autocomplete="off" data-no-tr></label>
        <p class="lp-sug"><button type="button" class="ghost small" id="lpSug">Suggest pairs from the scanner</button> <span id="lpSugOut"></span></p></div>
      <div class="row">${field('dollars', 'Position size $', D0.dollars, 'min="100"')}${field('maxPositionUsd', 'Max position $', D0.maxPositionUsd, 'min="100"')}
        <label>Bar length<select name="barMin">${[1, 5, 15].map(m => `<option value="${m}" ${m === D0.barMin ? 'selected' : ''}>${m} minute${m > 1 ? 's' : ''}</option>`).join('')}</select></label>
        ${field('historyMin', 'History window (minutes)', D0.historyMin, 'min="30"')}<label>Recalculate every<select name="everyMin">${[1, 2, 5, 10, 15].map(m => `<option value="${m}" ${m === D0.everyMin ? 'selected' : ''}>${m} min</option>`).join('')}</select></label></div>
      <div class="row">${field('entryPct', 'Enter at divergence %', D0.entryPct, 'step="0.05" min="0.05"')}${field('exitPct', 'Exit at %', D0.exitPct, 'step="0.05" min="0"')}${field('stopPct', 'Stop at %', D0.stopPct, 'step="0.1"')}
        ${field('maxLossUsd', 'Max loss per pair $', D0.maxLossUsd, 'min="1"')}${field('dailyLossUsd', 'Daily loss limit $', D0.dailyLossUsd, 'min="1"')}${field('closeBeforeMin', 'Close minutes before the close', D0.closeBeforeMin, 'min="1"')}
        <label class="chk"><input type="checkbox" name="holdOvernight"> Hold overnight</label></div>
      <button>Create on Paper</button><div class="err"></div></form>
    <div id="lpBots">${d.bots.length ? '' : '<div class="card empty"><b>No live-ratio bots yet.</b><span>Create one above; it starts on the practice account.</span></div>'}</div>
    <p class="mu small-print">Live prices: ${d.stream ? 'the Alpaca stream (bid/ask midpoint), with the last price polled when it is quiet' : 'the last price, polled at each run (no live stream on this server)'}. Trades only in regular hours on trading days (the shared market calendar), at least ${H.esc(String(d.minPaperDays))} trading days on Paper before real money. ${H.esc(d.note)}</p>
    ${H.related ? H.related([['pairs', 'Pairs trading'], ['risk', 'Risk controls'], ['riskview/margin', 'Margin center']]) : ''}`;
  const f = H.$('#lpf', view);
  H.act(H.$('button:not([type])', f), async () => { const b = H.form(f); await H.api('/pairslive', { body: b }); H.render(); return 'Created on Paper'; }, H.$('.err', f));
  H.$('#lpSug', view).onclick = async () => {
    const o = H.$('#lpSugOut', view); o.textContent = 'Scanning…';
    try { const r = (await H.api('/pairs/scan', { body: {} })).filter(x => !x.error).slice(0, 6); o.innerHTML = r.map(x => `<button type="button" class="chip small" data-a="${H.esc(x.a)}" data-b="${H.esc(x.b)}">${H.esc(x.a)}/${H.esc(x.b)}${x.cointegrated ? ' ✓' : ''}</button>`).join(' ') || 'No pairs found.';
      H.$$('[data-a]', o).forEach(c => (c.onclick = () => { f.a.value = c.dataset.a; f.b.value = c.dataset.b; })); }
    catch (e) { o.textContent = e.message; }
  };
  const box = H.$('#lpBots', view);
  for (const b of d.bots) {
    const st = b.state || {}, ch = st.chart || [], p = b.params, L = st.last, legs = [[b.a, st.qa, st.ea, L?.pa], [b.b, st.qb, st.eb, L?.pb]];
    const el = document.createElement('div'); el.className = 'card lpbot';
    const status = b.status === 'running' ? '<span class="pill pos">Running</span>' : b.status === 'paused' ? '<span class="pill">Paused</span>' : '<span class="pill">Stopped</span>';
    el.innerHTML = `<div class="dash-ch"><h2><span data-no-tr>${H.esc(b.a)} / ${H.esc(b.b)}</span> ${status} <span class="pill ${b.account === 'paper' ? '' : 'neg'}">${b.account === 'paper' ? 'Paper' : 'Real money: ' + H.esc(b.account)}</span></h2></div>
      <div class="stats">${[['Beta (fair ratio)', L ? L.beta.toFixed(4) : '-'], ['Volatility ratio', L?.volRatio != null ? L.volRatio.toFixed(3) : '-'], ['Divergence', L ? pct2(L.divergence) : '-', `enter ±${p.entryPct}%, exit ±${p.exitPct}%`], ['Open P&L', usd(st.unrealized)], ['Realized today', usd(st.realizedDay)], ['Realized in total', usd(st.realizedTotal)]].map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${v}</b>${s ? `<small class="mu">${s}</small>` : ''}</div>`).join('')}</div>
      ${svgLines([{ name: `${b.a} (scaled)`, ys: ch.map(x => x.pa / (ch[0]?.pa || 1) * 100), cls: 's1' }, { name: `${b.b} (scaled)`, ys: ch.map(x => x.pb / (ch[0]?.pb || 1) * 100), cls: 's2' }], { label: `${b.a} and ${b.b}, scaled to 100 at the start of the chart`, h: 130 })}
      ${svgLines([{ name: 'Divergence %', ys: ch.map(x => x.div), cls: 's1' }], { label: 'Divergence from the fair value with the thresholds', h: 110, hlines: [{ y: p.entryPct, name: 'Enter', cls: 'dn' }, { y: -p.entryPct, name: 'Enter', cls: 'dn' }, { y: p.exitPct, name: 'Exit', cls: 'up' }, { y: -p.exitPct, name: 'Exit', cls: 'up' }] })}
      <div class="grid">${svgLines([{ name: 'Beta', ys: ch.map(x => x.beta), cls: 's2' }], { label: 'Beta over time', h: 80 })}${svgLines([{ name: 'Volatility ratio', ys: ch.map(x => x.vr), cls: 's3' }], { label: 'Volatility ratio over time', h: 80 })}</div>
      <div class="tablewrap"><table class="slim"><thead><tr><th>Leg</th><th class="num">Shares</th><th class="num">Entry</th><th class="num">Now</th><th class="num">P&amp;L</th></tr></thead><tbody>${legs.map(([s, qn, e, now]) => `<tr><td data-no-tr>${H.esc(s)} ${qn > 0 ? '<span class="pill pos">long</span>' : qn < 0 ? '<span class="pill neg">short</span>' : ''}</td><td class="num">${qn || 0}</td><td class="num">${qn ? usd(e) : '-'}</td><td class="num">${usd(now)}</td><td class="num">${qn && now ? usd(qn * (now - e)) : '-'}</td></tr>`).join('')}</tbody></table></div>
      <div class="row lp-act" style="gap:8px">${b.status === 'running' ? '<button type="button" class="ghost small" data-do="pause">Pause</button>' : '<button type="button" class="small" data-do="start">Start</button>'}<button type="button" class="ghost small" data-do="stop">Stop and close</button><button type="button" class="ghost small" data-do="backtest">Intraday backtest</button>
        ${b.account === 'paper' ? '<button type="button" class="ghost small" data-do="live">Use real money…</button>' : '<button type="button" class="ghost small" data-do="paper">Back to Paper</button>'}<button type="button" class="ghost small" data-do="delete">Delete</button></div>
      <p class="ok" role="status"></p><div class="err" role="alert"></div><div class="lp-bt"></div>
      ${st.backtest ? `<p class="small-print">Last intraday backtest (${new Date(st.backtest.at).toLocaleDateString()}): ${pct2(st.backtest.total * 100)} over ${st.backtest.bars} bars, ${st.backtest.trades} trades, largest fall ${pct2(st.backtest.maxDrawdown * 100)}. Hypothetical.</p>` : ''}
      ${b.account === 'paper' ? `<p class="mu small-print">Days on Paper: ${(st.paperDays || []).length} of the ${b.minPaperDays} needed before real money.</p>` : ''}
      <details><summary>Trade log (${b.log.length})</summary><div class="tablewrap"><table class="slim"><thead><tr><th>When</th><th>What</th><th>Detail</th></tr></thead><tbody>${b.log.map(l => { let x = l.detail; try { const j = JSON.parse(l.detail); x = [j.why, j.realized != null ? `P&L ${usd(j.realized)}` : '', j.qa != null ? `${b.a} ${j.qa}, ${b.b} ${j.qb}` : '', ...(j.notes || [])].filter(Boolean).join(' · '); } catch {} return `<tr><td>${new Date(l.at).toLocaleString()}</td><td>${H.esc(l.kind)}</td><td class="small-print">${H.esc(x)}</td></tr>`; }).join('')}</tbody></table></div></details>`;
    box.append(el);
    const ok = H.$('.ok', el), err = H.$('.err', el), say = (m, bad) => { ok.textContent = bad ? '' : m; err.textContent = bad ? m : ''; };
    H.$$('[data-do]', el).forEach(btn => (btn.onclick = async () => {
      const act = btn.dataset.do; say('');
      try {
        if (act === 'delete') { if (!confirm('Delete this bot and its log?')) return; await H.api('/pairslive/' + b.id, { method: 'DELETE' }); return H.render(); }
        if (act === 'stop' && (st.qa || st.qb) && !confirm('Close both legs now and stop?')) return;
        if (act === 'backtest') {
          btn.disabled = true; const r = await H.api(`/pairslive/${b.id}/backtest`, { body: {} }); btn.disabled = false;
          const L2 = r.live, O = r.ols?.neutral;
          H.$('.lp-bt', el).innerHTML = `<div class="tablewrap"><table class="slim"><thead><tr><th></th><th class="num">Total</th><th class="num">Trades</th><th class="num">Hit rate</th><th class="num">Largest fall</th><th class="num">Sharpe</th></tr></thead><tbody>
            <tr><th scope="row">Live ratio (intraday, ${L2.bars} bars)</th><td class="num">${pct2(L2.total * 100)}</td><td class="num">${L2.trades}</td><td class="num">${L2.hitRate == null ? '-' : Math.round(L2.hitRate * 100) + '%'}</td><td class="num">${pct2(L2.maxDrawdown * 100)}</td><td class="num">${L2.sharpe == null ? '-' : L2.sharpe.toFixed(2)}</td></tr>
            <tr><th scope="row">OLS z-score (daily${r.ols?.from ? `, ${H.esc(r.ols.from)} to ${H.esc(r.ols.to)}` : ''})</th>${O ? `<td class="num">${pct2(O.m?.ret)}</td><td class="num">${O.trades ?? '-'}</td><td class="num">${O.winRate != null ? Math.round(O.winRate) + '%' : '-'}</td><td class="num">${pct2(O.m?.dd != null ? -Math.abs(O.m.dd) : null)}</td><td class="num">${Number.isFinite(O.m?.sharpe) ? O.m.sharpe.toFixed(2) : '-'}</td>` : `<td colspan="5" class="mu">${H.esc(r.ols?.error || 'not available')}</td>`}</tr></tbody></table></div>
            ${svgLines([{ name: 'Live ratio, cumulative', ys: L2.curve.map(v => v * 100), cls: 's1' }], { label: 'Intraday backtest cumulative return', h: 100 })}<p class="mu small-print">${H.esc(r.note)}</p>`;
          return;
        }
        if (act === 'live') {
          if (!liveAccts.length) return say('Connect a brokerage account first (Accounts).', true);
          const sel = `<label>Account<select name="acct">${liveAccts.map(a => `<option value="${H.esc(a.id)}">${H.esc(a.name)}${a.live ? ' (live)' : ' (paper)'}</option>`).join('')}</select></label>`;
          const c = await H.secureConfirm({ title: `Run ${b.a}/${b.b} with real money?`, okText: 'Move to this account', html: `<p>${H.esc(d.note)}</p><p class="mu">It needs a recent intraday backtest and at least ${b.minPaperDays} trading days on Paper. Orders still pass your risk limits and the kill switch.</p>${sel}`, onOpen: ({ dialog }) => { dialog.dataset.acct = liveAccts[0].id; dialog.querySelector('[name=acct]').onchange = e => (dialog.dataset.acct = e.target.value); } });
          if (!c) return;
          const acct = document.querySelector('dialog.secure')?.dataset.acct || liveAccts[0].id;
          await H.api(`/pairslive/${b.id}/live`, { body: { account: acct, understood: true, password: c.password, confirm: c.confirm } }); return H.render();
        }
        await H.api(`/pairslive/${b.id}/${act}`, { body: {} }); H.render();
      } catch (e) { btn.disabled = false; say(e.message + (e.problems?.length > 1 ? ' ' + e.problems.slice(1).join(' ') : ''), true); }
    }));
  }
  // While a bot runs, the page refreshes itself every 20 seconds.
  if (d.bots.some(b => b.status === 'running')) { const t = setTimeout(() => view.isConnected && location.hash.includes('livepairs') && H.render?.(), 20000); H.onLeave?.(() => clearTimeout(t)); }
}
