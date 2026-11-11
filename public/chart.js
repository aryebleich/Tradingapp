// Advanced chart: candlesticks with volume, moving averages, Bollinger bands, RSI and MACD panes,
// candlestick pattern markers, drawing tools (trend line, horizontal line, box, Fibonacci) kept
// per symbol on this device, 1/2/4-chart layouts, pop-out windows for more monitors, click-to-trade
// and a live order-book ladder (depth for crypto, top of book for stocks).
import { detect, PATTERNS } from './patterns.js';
import { analyze } from './chartai.js';
import { canvasNote } from './i18n.js';
import { INDICATORS, GROUPS, byId, compute } from './indicators.js';
import { run as runScript, backtest as scriptBacktest, EXAMPLE as SCRIPT_EXAMPLE } from './script.js';
let H;
// Round price levels (1, 2, 2.5 or 5 × a power of ten) and their labels with just enough decimals.
function niceTicks(lo, hi, count = 6) {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / Math.max(1, count - 1), p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function tickLabel(ticks) {
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1, d = step >= 1 ? (Math.max(...ticks) >= 1000 ? 0 : 2) : step >= 0.1 ? 2 : step >= 0.01 ? 2 : 4;
  return v => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function registerChart(routes, helpers) {
  H = helpers;
  routes.chart = chartPage;
}

// ---------- indicators ----------
const sma = (c, n) => c.map((_, i) => (i < n - 1 ? null : c.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
const ema = (c, n) => { const k = 2 / (n + 1), out = []; let e = null; c.forEach((v, i) => { e = e == null ? v : v * k + e * (1 - k); out.push(i < n - 1 ? null : e); }); return out; };
// Bull and bear markets: above or below the 200-day average (with the 50-day agreeing), golden and
// death crosses of the 50- and 200-day averages, and the 20% rule (a 20% fall from a peak starts a
// bear market; a 20% rise from a low starts a bull market).
export function regimes(c) {
  const s50 = sma(c, 50), s200 = sma(c, 200), state = [], marks = [];
  let peak = c[0], trough = c[0], phase = null;
  for (let i = 0; i < c.length; i++) {
    state.push(s200[i] == null ? null : c[i] > s200[i] && s50[i] > s200[i] ? 'bull' : c[i] < s200[i] && s50[i] < s200[i] ? 'bear' : null);
    if (i && s200[i] != null && s200[i - 1] != null && s50[i - 1] != null) {
      if (s50[i - 1] <= s200[i - 1] && s50[i] > s200[i]) marks.push({ i, kind: 'golden', label: 'Golden cross' });
      if (s50[i - 1] >= s200[i - 1] && s50[i] < s200[i]) marks.push({ i, kind: 'death', label: 'Death cross' });
    }
    peak = Math.max(peak, c[i]); trough = Math.min(trough, c[i]);
    if (phase !== 'bear' && c[i] <= peak * 0.8) { phase = 'bear'; marks.push({ i, kind: 'bear', label: 'Bear market (-20%)' }); trough = c[i]; }
    else if (phase !== 'bull' && trough > 0 && c[i] >= trough * 1.2 && (phase === 'bear' || i > 0)) { if (phase === 'bear') marks.push({ i, kind: 'bull', label: 'Bull market (+20%)' }); phase = 'bull'; peak = c[i]; }
  }
  return { s200, state, marks, now: state.at(-1) };
}
function rsi(c, n = 14) {
  const out = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l ? 100 - 100 / (1 + g / l) : 100; continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l ? 100 - 100 / (1 + g / l) : 100;
  }
  return out;
}
function bands(c, n = 20, k = 2) {
  const m = sma(c, n);
  return m.map((v, i) => { if (v == null) return null; const s = Math.sqrt(c.slice(i - n + 1, i + 1).reduce((a, x) => a + (x - v) ** 2, 0) / n); return { u: v + k * s, l: v - k * s }; });
}
function macd(c) {
  const f = ema(c, 12), s = ema(c, 26), line = c.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const start = line.findIndex(v => v != null), sig = Array(c.length).fill(null);
  if (start >= 0) ema(line.slice(start), 9).forEach((v, j) => (sig[start + j] = v));
  return line.map((v, i) => ({ m: v, s: sig[i], h: v != null && sig[i] != null ? v - sig[i] : null }));
}

// ---------- data ----------
const TFS = { '5Min': [5, 6], '15Min': [15, 15], '1Hour': [60, 45], '1Day': [1440, 730], '1Week': [10080, 3650] };
// Size of the company (mega to micro cap) and blue chip, from the profile.
const capCache = new Map();
async function capBadge(sym, el) {
  if (!el || sym.includes('/')) { if (el) el.textContent = ''; return; }
  if (!capCache.has(sym)) capCache.set(sym, H.api('/fundamentals/profile/' + encodeURIComponent(sym)).catch(() => null));
  const p = await capCache.get(sym); if (!p || !el.isConnected) return;
  const mc = p.ratios?.marketCap, cc = p.ratios?.capClass;
  const big = v => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
  el.innerHTML = p.kind === 'etf' ? `<span class="pill" title="${H.esc(p.etf.about)}">ETF · ${H.esc(p.etf.index)} · ${p.etf.expenseRatio}% a year</span>`
    : cc ? `<span class="pill cap-${cc.id}" title="${H.esc(cc.about)}">${H.esc(cc.name)} · ${big(mc)}</span>${p.blueChip ? ' <span class="pill blue" title="A large, long-established company with a record of steady results">Blue chip</span>' : ''}${p.style ? ` <span class="pill">${H.esc(p.style[0].toUpperCase() + p.style.slice(1))}</span>` : ''}` : '';
}
async function loadBars(symbol, tf) {
  const start = new Date(Date.now() - TFS[tf][1] * 864e5).toISOString();
  try {
    const d = await H.api(`/alpaca/data/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${tf}&start=${start}&limit=5000`);
    const rows = d[symbol] || Object.values(d)[0];
    if (rows?.length) return { bars: rows.map(r => ({ t: Date.parse(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v || 0 })), ohlc: true };
  } catch (e) { if (tf !== '1Day') throw new Error('Intraday charts need the market-data source on the server'); }
  if (tf !== '1Day') throw new Error('Intraday charts need the market-data source on the server');
  const p = (await H.api(`/code/prices?symbols=${encodeURIComponent(symbol)}&start=${start.slice(0, 10)}`))[symbol];
  return { bars: p.close.map((c, i) => ({ t: Date.parse(p.dates[i]), o: p.close[i - 1] ?? c, h: Math.max(c, p.close[i - 1] ?? c), l: Math.min(c, p.close[i - 1] ?? c), c, v: 0 })), ohlc: false, synthetic: p.source === 'synthetic' };
}

// ---------- settings (remembered on this device) ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const DEF = { tf: '1Day', layout: 1, studies: [], symbols: ['SPY', 'QQQ', 'AAPL', 'BTC/USD'], ind: { sma20: true, sma50: true, ema20: false, bb: false, vol: true, rsi: true, macd: false, pat: true, regime: true, ai: false } };

async function chartPage(view, q) {
  const cfg = { ...DEF, ...load('qp_chart', {}) }; cfg.ind = { ...DEF.ind, ...cfg.ind }; cfg.studies = (cfg.studies || []).filter(x => byId(x.id));
  if (q.get('symbol')) cfg.symbols[0] = q.get('symbol').toUpperCase();
  if (q.get('layout')) cfg.layout = +q.get('layout');
  // Charts per layout by plan: 1 on Starter, 2 on Pro, 4 on Elite and Ultimate.
  const me = H.me(), maxLayout = (me?.role === 'admin' && !me?.previewPlan) || ['elite', 'ultimate'].includes(me?.plan) && H.paid() ? 4 : H.paid() ? 2 : 1;
  cfg.layout = Math.min(cfg.layout, maxLayout);
  const popout = q.get('popout') === '1';
  document.body.classList.toggle('popout', popout);
  H.onLeave(() => document.body.classList.remove('popout'));
  const accts = await H.accounts();
  const IND = { regime: 'Bull / bear', sma20: 'SMA 20', sma50: 'SMA 50', ema20: 'EMA 20', bb: 'Bollinger', vol: 'Volume', rsi: 'RSI', macd: 'MACD', pat: 'Candle patterns', ai: 'Auto support, resistance & chart patterns' };
  view.innerHTML = `<div class="charttop">
      ${popout ? '' : '<h1 style="margin:0">Chart</h1>'}
      <div class="seg" id="tf">${Object.keys(TFS).map(t => `<button type="button" data-tf="${t}" class="${t === cfg.tf ? 'on' : ''}">${{ '5Min': '5m', '15Min': '15m', '1Hour': '1h', '1Day': '1D', '1Week': '1W' }[t]}</button>`).join('')}</div>
      <div class="seg" id="tools" title="Drawing tools">${[['none', '↖', 'Pointer'], ['trend', '╱', 'Trend line'], ['hline', '―', 'Horizontal line'], ['rect', '▭', 'Box'], ['fib', 'Fib', 'Fibonacci retracement'], ['trade', '$', 'Click to trade'], ['erase', '⌫', 'Erase drawing']].map(([k, s, t]) => `<button type="button" data-tool="${k}" title="${t}" aria-label="${t}" class="${k === 'none' ? 'on' : ''}">${s}</button>`).join('')}</div>
      <div class="seg" id="lay" title="Layout">${[1, 2, 4].map(n => `<button type="button" data-l="${n}" class="${n === cfg.layout ? 'on' : ''}" ${n > maxLayout ? 'data-locked="1" title="More charts per layout come with a higher plan"' : ''}>${n === 1 ? '▢' : n === 2 ? '▥' : '▦'}</button>`).join('')}</div>
      <button type="button" class="ghost small" id="indBtn" title="Add any of ${INDICATORS.length} indicators">ƒ Indicators (${INDICATORS.length})</button>
      <button type="button" class="ghost small" id="rpBtn" title="Replay the price history bar by bar">⏵ Replay</button>
      <button type="button" class="ghost small" id="scBtn" title="Write your own indicator, strategy or alert">{ } Script</button>
      ${popout ? '' : '<button type="button" class="ghost small" id="pop" title="Open in a new window (drag it to another monitor)">⧉ Pop out</button>'}
    </div>
    <div class="replaybar" id="rpBar" hidden><b>Replay</b> <input type="range" id="rpPos" min="20" max="100" value="60" aria-label="Start point"> <button type="button" class="small ghost" id="rpBack" title="One bar back">⏮</button><button type="button" class="small" id="rpPlay">⏵ Play</button><button type="button" class="small ghost" id="rpStep" title="One bar forward">⏭</button>
      <select id="rpSpeed" aria-label="Speed"><option value="1000">1×</option><option value="500">2×</option><option value="200" selected>5×</option><option value="100">10×</option></select><span class="mu small-print" id="rpAt"></span><button type="button" class="small ghost" id="rpExit">Exit replay</button></div>
    <div class="chips studies" id="studies"></div>
    <div class="chips inds">${Object.entries(IND).map(([k, t]) => `<label class="chk"><input type="checkbox" data-ind="${k}" ${cfg.ind[k] ? 'checked' : ''}>${t}</label>`).join('')}</div>
    <form class="copilot" id="cpForm"><span class="cp-ic" aria-hidden="true">✦</span><input id="cpQ" maxlength="500" autocomplete="off" placeholder="Ask the chart: &quot;Highlight head-and-shoulders patterns from the last quarter and short volume spikes&quot;" aria-label="Ask the chart co-pilot"><button>Ask</button><button type="button" class="ghost small" id="cpClear" hidden>Clear</button></form>
    <div class="copilot-out mu" id="cpOut" hidden></div>
    <div class="chartgrid l${cfg.layout}" id="grid"></div>
    <div class="card scriptcard" id="scCard" hidden><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Brightolio Script <span class="mu small-print">Pine-style syntax</span></h2><select id="scSaved" aria-label="Saved scripts"><option value="">Saved scripts…</option></select></div>
      <textarea id="scSrc" spellcheck="false" rows="14" data-no-tr></textarea>
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><button type="button" id="scRun">Run on the chart</button><input id="scName" placeholder="Name" style="max-width:180px"><label class="chk"><input type="checkbox" id="scAlert"> Alert me after each close when an alertcondition() is true</label><button type="button" class="ghost" id="scSave">Save</button><button type="button" class="ghost small" id="scEx">Example</button><button type="button" class="ghost small" id="scClear">Remove from chart</button></div>
      <div class="err" id="scErr"></div><div id="scOut"></div>
      <details class="mu small-print"><summary>What you can write</summary><p>indicator("Name", overlay=false) or strategy("Name") · len = input(14, "Length") · ta.sma / ema / wma / rma / rsi / macd / bb / stoch / atr / tr / stdev / highest / lowest / change / roc / mom / sum / crossover / crossunder / cci / mfi / obv / vwap / adx / dmi / supertrend / psar · ind("keltner", "Upper", length=20) for any of the ${INDICATORS.length} indicators · open high low close volume hl2 hlc3 ohlc4 bar_index · close[1] = the bar before · a ? b : c · and or not · plot(series, "Title", color=color.blue) · hline(70) · strategy.entry("Long", strategy.long, when=cond) · strategy.close("Long", when=cond) · alertcondition(cond, "Message"). Backtests enter and exit at the next bar's open, all money in, no fees. Brightolio Script is its own language with a familiar style; it is not TradingView's Pine Script.</p></details></div>
    <div class="chartside" id="side"></div>`;
  let tool = 'none', active = 0;
  const panels = [];
  const save = () => keep('qp_chart', { tf: cfg.tf, layout: cfg.layout, symbols: cfg.symbols, ind: cfg.ind, studies: cfg.studies });
  const grid = H.$('#grid', view);
  for (let i = 0; i < cfg.layout; i++) {
    const el = document.createElement('div'); el.className = 'card cpanel'; el.innerHTML = `<div class="chead"><input class="csym" value="${H.esc(cfg.symbols[i] || 'SPY')}" aria-label="Symbol" data-no-tr><span class="ohlc mu" data-no-tr></span><span class="capbadge"></span><span class="regbadge"></span></div><div class="cwrap"><canvas></canvas></div><div class="cnote mu small-print"></div>`;
    grid.append(el);
    const p = new Panel(el, i, cfg, () => tool, () => setActive(i));
    panels.push(p);
    H.$('.csym', el).onchange = e => { cfg.symbols[i] = e.target.value.trim().toUpperCase() || 'SPY'; save(); p.load(); if (i === active) side(); };
  }
  const setActive = i => { if (active === i) return; active = i; panels.forEach((p, j) => p.el.classList.toggle('active', j === i)); side(); };
  // The chart co-pilot: the question about the active chart becomes drawings and a short answer.
  const cpOut = H.$('#cpOut', view), cpClear = H.$('#cpClear', view);
  H.$('#cpForm', view).onsubmit = async e => {
    e.preventDefault();
    const q = H.$('#cpQ', view).value.trim(), p = panels[active]; if (!q || !p) return;
    const btn = e.target.querySelector('button'); btn.disabled = true; cpOut.hidden = false; cpOut.textContent = 'Reading the chart...';
    try {
      const r = await H.api('/chartai/ask', { body: { symbol: p.sym, prompt: q } });
      p.copilot = r; p.draw(); cpClear.hidden = false;
      cpOut.innerHTML = `<b>${H.esc(r.symbol)}:</b> ${H.esc(r.answer)} <span class="small-print">(${r.left} question${r.left === 1 ? '' : 's'} left today)</span>`;
    } catch (err) { cpOut.innerHTML = `<span class="err">${H.esc(err.message)}</span>${err.upgrade ? ' <a href="#/funding">See plans</a>' : ''}`; }
    btn.disabled = false;
  };
  cpClear.onclick = () => { panels.forEach(p => { p.copilot = null; p.draw(); }); cpOut.hidden = true; cpClear.hidden = true; };
  panels[0].el.classList.add('active');
  panels.forEach(p => p.load());
  H.$$('[data-tf]', view).forEach(b => (b.onclick = () => { cfg.tf = b.dataset.tf; save(); H.$$('[data-tf]', view).forEach(x => x.classList.toggle('on', x === b)); panels.forEach(p => p.load()); }));
  H.$$('[data-tool]', view).forEach(b => (b.onclick = () => { tool = b.dataset.tool; H.$$('[data-tool]', view).forEach(x => x.classList.toggle('on', x === b)); panels.forEach(p => p.cursor()); }));
  H.$$('[data-l]', view).forEach(b => (b.onclick = () => { if (b.dataset.locked) { location.hash = '#/funding'; return; } cfg.layout = +b.dataset.l; save(); H.render(); }));
  H.$$('[data-ind]', view).forEach(c => (c.onchange = () => { cfg.ind[c.dataset.ind] = c.checked; save(); panels.forEach(p => p.draw()); }));
  // Added indicators: a chip each, with its settings and a remove button.
  const studiesEl = H.$('#studies', view);
  const drawStudies = () => {
    studiesEl.innerHTML = cfg.studies.map((st, k) => { const d = byId(st.id); return `<span class="chip study"><b>${H.esc(d.name)}</b>${Object.keys(d.params).length ? ` <span class="mu">${Object.values({ ...d.params, ...st.params }).join(', ')}</span> <button type="button" class="small ghost" data-edit="${k}" aria-label="Settings">⚙</button>` : ''}<button type="button" class="small ghost" data-rm="${k}" aria-label="Remove">×</button></span>`; }).join('');
    H.$$('[data-rm]', studiesEl).forEach(b => (b.onclick = () => { cfg.studies.splice(+b.dataset.rm, 1); save(); drawStudies(); panels.forEach(p => p.draw()); }));
    H.$$('[data-edit]', studiesEl).forEach(b => (b.onclick = () => editStudy(+b.dataset.edit)));
  };
  const editStudy = k => {
    const st = cfg.studies[k], d = byId(st.id), cur = { ...d.params, ...st.params };
    const dlg = document.createElement('dialog'); dlg.className = 'secure';
    dlg.innerHTML = `<form method="dialog"><h2>${H.esc(d.name)}</h2>${Object.entries(cur).map(([n, v]) => `<label>${H.esc(n)}<input name="${H.esc(n)}" type="number" step="any" value="${v}"></label>`).join('')}<div class="row"><button value="ok">Apply</button><button value="cancel" class="ghost">Cancel</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.onclose = () => { if (dlg.returnValue === 'ok') { st.params = Object.fromEntries(Object.keys(cur).map(n => [n, +dlg.querySelector(`[name="${n}"]`).value])); save(); drawStudies(); panels.forEach(p => p.draw()); } dlg.remove(); };
  };
  drawStudies();
  H.$('#indBtn', view).onclick = () => {
    const dlg = document.createElement('dialog'); dlg.className = 'secure indlib';
    dlg.innerHTML = `<form method="dialog"><h2>Indicators <span class="mu">${INDICATORS.length}</span></h2><input name="q" placeholder="Search: RSI, bands, volume…" autocomplete="off"><div class="indlist">${GROUPS.map(g => `<h3>${H.esc(g)}</h3>${INDICATORS.filter(x => x.group === g).map(x => `<button type="button" class="ghost small indadd" data-id="${x.id}" data-n="${H.esc(x.name.toLowerCase())} ${x.id}">${H.esc(x.name)} <span class="mu">${x.pane === 'price' ? 'on price' : 'own pane'}</span></button>`).join('')}`).join('')}</div><div class="row"><button value="close" class="ghost">Done</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.querySelector('[name=q]').oninput = e => { const q = e.target.value.trim().toLowerCase(); dlg.querySelectorAll('.indadd').forEach(b => (b.hidden = !!q && !b.dataset.n.includes(q))); dlg.querySelectorAll('.indlist h3').forEach(h => { let n = h.nextElementSibling, any = false; while (n && n.tagName !== 'H3') { if (!n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; }); };
    dlg.querySelectorAll('.indadd').forEach(b => (b.onclick = () => { if (cfg.studies.length >= 12) { alert('Up to 12 indicators at a time'); return; } cfg.studies.push({ id: b.dataset.id, params: {} }); save(); drawStudies(); panels.forEach(p => p.draw()); b.classList.add('on'); }));
    dlg.onclose = () => dlg.remove();
  };
  // Replay: the active chart is cut back to a point in its history, then plays forward bar by bar.
  const rpBar = H.$('#rpBar', view); let rpTimer = null;
  const rpPanel = () => panels[active];
  const rpShow = () => { const p = rpPanel(); H.$('#rpAt', view).textContent = p.full ? `${tlabel(p.bars.at(-1).t, cfg.tf, true)} · ${p.bars.length} of ${p.full.length}` : ''; };
  const rpStop = () => { clearInterval(rpTimer); rpTimer = null; H.$('#rpPlay', view).textContent = '⏵ Play'; };
  H.$('#rpBtn', view).onclick = () => { rpBar.hidden = false; rpPanel().replay(+H.$('#rpPos', view).value / 100); rpShow(); };
  H.$('#rpPos', view).oninput = e => { rpStop(); rpPanel().replay(+e.target.value / 100); rpShow(); };
  H.$('#rpStep', view).onclick = () => { rpStop(); rpPanel().stepReplay(1); rpShow(); };
  H.$('#rpBack', view).onclick = () => { rpStop(); rpPanel().stepReplay(-1); rpShow(); };
  H.$('#rpPlay', view).onclick = () => { if (rpTimer) return rpStop(); if (!rpPanel().full) rpPanel().replay(+H.$('#rpPos', view).value / 100); H.$('#rpPlay', view).textContent = '⏸ Pause'; rpTimer = setInterval(() => { if (!rpPanel().stepReplay(1)) rpStop(); rpShow(); }, +H.$('#rpSpeed', view).value); };
  H.$('#rpSpeed', view).onchange = () => { if (rpTimer) { rpStop(); H.$('#rpPlay', view).click(); } };
  H.$('#rpExit', view).onclick = () => { rpStop(); rpPanel().endReplay(); rpBar.hidden = true; };
  H.onLeave(() => clearInterval(rpTimer));
  // Script: runs on the active chart's bars; plots and buy/sell points are drawn on it.
  const scCard = H.$('#scCard', view), src = H.$('#scSrc', view), scOut = H.$('#scOut', view), scErr = H.$('#scErr', view);
  src.value = load('qp_script', SCRIPT_EXAMPLE);
  let saved = [], savedId = null;
  const loadSaved = async () => { saved = await H.api('/scripts').catch(() => []); H.$('#scSaved', view).innerHTML = '<option value="">Saved scripts…</option>' + saved.map(x => `<option value="${x.id}">${H.esc(x.name)} · ${H.esc(x.symbol)}${x.alert ? ' · alert' : ''}</option>`).join(''); };
  H.$('#scBtn', view).onclick = () => { scCard.hidden = !scCard.hidden; if (!scCard.hidden) { loadSaved(); src.focus(); } };
  const runIt = () => {
    scErr.textContent = ''; keep('qp_script', src.value);
    const p = panels[active]; if (!p.bars.length) { scErr.textContent = 'The chart has no prices yet'; return; }
    try {
      const r = runScript(src.value, p.bars), bt = r.entries.length ? scriptBacktest(r, p.bars) : null;
      p.script = { r, bt, src: src.value, len: p.bars.length }; p.draw();
      scOut.innerHTML = `<p class="mu">${H.esc(r.title)} on ${H.esc(p.sym)}: ${r.plots.length} line${r.plots.length === 1 ? '' : 's'}${r.alerts.length ? `, ${r.alerts.length} alert${r.alerts.length === 1 ? '' : 's'}` : ''}${r.inputs.length ? ' · inputs: ' + r.inputs.map(x => `${H.esc(x.title)} ${x.value}`).join(', ') : ''}</p>` + (bt ? `<div class="stats">${[['Return', bt.totalReturn + '%', bt.totalReturn >= 0 ? 'pos' : 'neg'], ['Buy and hold', bt.buyHold + '%'], ['Trades', bt.trades.length], ['Win rate', bt.winRate == null ? '-' : bt.winRate + '%'], ['Profit factor', bt.profitFactor ?? (bt.trades.length ? '∞' : '-')], ['Largest drop', bt.maxDrawdown + '%', 'neg']].map(([k, v, c]) => `<div class="stat"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('')}</div>
        <div class="tablewrap"><table class="slim"><tr><th>Side</th><th>In</th><th class="num">Price</th><th>Out</th><th class="num">Price</th><th class="num">Result</th></tr>${bt.trades.slice(-30).reverse().map(t => `<tr><td>${t.dir}</td><td>${tlabel(t.entryT, cfg.tf, true)}</td><td class="num">${fmt(t.entry)}</td><td>${tlabel(t.exitT, cfg.tf, true)}</td><td class="num">${fmt(t.exit)}</td><td class="num ${t.ret >= 0 ? 'pos' : 'neg'}">${t.ret}%</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No trades in this period</td></tr>'}</table></div><p class="mu small-print">Past results on these prices, not a promise of future results.</p>` : '');
    } catch (e) { scErr.textContent = e.message; }
  };
  H.$('#scRun', view).onclick = runIt;
  src.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runIt(); } };
  H.$('#scEx', view).onclick = () => { src.value = SCRIPT_EXAMPLE; runIt(); };
  H.$('#scClear', view).onclick = () => { panels[active].script = null; panels[active].draw(); scOut.innerHTML = ''; };
  H.$('#scSaved', view).onchange = e => { const x = saved.find(y => String(y.id) === e.target.value); if (!x) return; savedId = x.id; src.value = x.source; H.$('#scName', view).value = x.name; H.$('#scAlert', view).checked = x.alert; };
  H.$('#scSave', view).onclick = async () => { scErr.textContent = ''; try { const r = await H.api('/scripts', { body: { id: savedId, name: H.$('#scName', view).value, symbol: panels[active].sym, source: src.value, alert: H.$('#scAlert', view).checked } }); savedId = r.id; await loadSaved(); scOut.insertAdjacentHTML('afterbegin', '<p class="ok">Saved</p>'); } catch (e) { scErr.textContent = e.message; } };
  if (H.$('#pop', view)) H.$('#pop', view).onclick = () => window.open(`${location.pathname}#/chart?symbol=${encodeURIComponent(cfg.symbols[active])}&layout=${cfg.layout}&popout=1`, '_blank', 'width=1200,height=760');
  const ro = new ResizeObserver(() => panels.forEach(p => p.draw())); ro.observe(grid); H.onLeave(() => ro.disconnect());

  // Order ticket + order-book ladder for the active chart.
  let timer = null; H.onLeave(() => clearInterval(timer));
  const sideEl = H.$('#side', view);
  function side(price) {
    const sym = cfg.symbols[active] || 'SPY', crypto = sym.includes('/'), alp = accts.find(a => a.id === 'alpaca' && a.connected);
    sideEl.innerHTML = `<div class="card"><h2>Trade ${H.esc(sym)}</h2><form id="tk">
      <div class="seg"><button type="button" class="buy on" data-side="buy">Buy</button><button type="button" class="sell" data-side="sell">Sell</button></div>
      <label>Account<select name="account">${H.accountOptions(accts, alp ? 'alpaca' : 'paper')}<option value="smart">Smart route (best of my brokerages)</option></select></label>
      <div class="row"><label>Quantity<input name="qty" type="number" step="any" min="0" value="1"></label><label class="lim">Limit price<input name="limit" type="number" step="any" value="${price ? price.toFixed(price < 10 ? 4 : 2) : ''}" placeholder="market"></label></div>
      <button>Place order</button><div class="err"></div>
      <p class="mu small-print">Pick the $ tool and click the chart, or click a price in the ladder, to set a limit price. Limit orders go to Alpaca; paper and other brokerages fill at market.</p></form></div>
      <div class="card"><h2>${crypto ? 'Order book' : 'Top of book'}</h2><div id="dom" class="dom mu">Loading...</div></div>`;
    const tk = H.$('#tk', sideEl); let sideV = 'buy';
    H.$$('[data-side]', tk).forEach(b => (b.onclick = () => { sideV = b.dataset.side; H.$$('[data-side]', tk).forEach(x => x.classList.toggle('on', x === b)); }));
    H.act(H.$('button:not([type])', tk), async () => {
      const f = H.form(tk), lim = +f.limit;
      if (!(+f.qty > 0)) throw new Error('Enter a quantity');
      if (!confirm(`${sideV.toUpperCase()} ${f.qty} ${sym} ${lim ? '@ ' + lim : 'at market'} on ${f.account}?`)) return;
      if (f.account === 'alpaca') {
        const r = await H.api('/alpaca/orders', { body: { symbol: sym, side: sideV, qty: f.qty, type: lim ? 'limit' : 'market', limit_price: lim || undefined, time_in_force: crypto ? 'gtc' : 'day' } });
        return `Order ${r.status}`;
      }
      const r = await H.api('/orders', { body: { account: f.account, symbol: sym, side: sideV, qty: f.qty } });
      return `${r.side} ${r.symbol}: ${r.status}${r.price ? ' @ ' + H.money(r.price) : ''}${r.routedTo ? ' via ' + r.routedTo : ''}${r.notes ? ' · ' + r.notes.join(' ') : ''}`;
    });
    clearInterval(timer);
    const dom = async () => {
      const el = H.$('#dom', sideEl); if (!el) return;
      try {
        const d = await H.api('/alpaca/data/orderbook?symbol=' + encodeURIComponent(sym));
        if (d.depth) {
          const asks = d.asks.slice(0, 12).reverse(), bids = d.bids.slice(0, 12), max = Math.max(...[...asks, ...bids].map(x => x.size), 1e-9);
          const row = (x, k) => `<div class="lv ${k}" data-p="${x.price}"><i style="width:${(x.size / max * 100).toFixed(0)}%"></i><span>${x.price}</span><span>${(+x.size).toFixed(4)}</span></div>`;
          el.innerHTML = asks.map(x => row(x, 'ask')).join('') + `<div class="spread">${asks.length && bids.length ? 'spread ' + (asks.at(-1).price - bids[0].price).toFixed(2) : ''}</div>` + bids.map(x => row(x, 'bid')).join('');
        } else if (d.quote) {
          el.innerHTML = `<div class="lv ask" data-p="${d.quote.ap}"><span>Ask</span><span>${d.quote.ap}</span><span>${d.quote.as ?? ""}</span></div><div class="lv bid" data-p="${d.quote.bp}"><span>Bid</span><span>${d.quote.bp}</span><span>${d.quote.bs ?? ""}</span></div><p class="small-print">Full depth (Level II) for stocks needs a paid data feed; crypto shows the full book.</p>`;
        } else el.textContent = 'No quote right now.';
        H.$$('[data-p]', el).forEach(x => (x.onclick = () => (H.$('[name=limit]', sideEl).value = x.dataset.p)));
      } catch (e) { el.textContent = /market-data|key|401|403|503/i.test(e.message) ? 'Live quotes need the market-data source on the server.' : e.message; clearInterval(timer); }
    };
    dom(); timer = setInterval(dom, 3000);
  }
  panels.forEach(p => (p.onPrice = price => { setActive(p.i); side(price); }));
  side();
}

class Panel {
  constructor(el, i, cfg, tool, focus) {
    Object.assign(this, { el, i, cfg, tool, focus, bars: [], view: { end: 0, n: 120 }, drag: null, temp: null, mouse: null });
    this.cv = H.$('canvas', el);
    const cv = this.cv;
    cv.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY > 0 ? 1.15 : 0.87; this.view.n = Math.max(20, Math.min(this.bars.length, Math.round(this.view.n * f))); this.draw(); }, { passive: false });
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e));
    cv.addEventListener('pointerleave', () => { this.mouse = null; this.draw(); });
    this.cursor();
  }
  get sym() { return this.cfg.symbols[this.i] || 'SPY'; }
  replay(frac) {
    if (!this.full) this.full = this.bars;
    if (!this.full?.length) return;
    const k = Math.max(20, Math.min(this.full.length, Math.round(this.full.length * frac)));
    this.bars = this.full.slice(0, k); this.view = { end: k, n: Math.min(k, this.view.n || 120) }; this.memo = null; this.draw();
  }
  stepReplay(d) {
    if (!this.full) return false;
    const k = Math.max(20, Math.min(this.full.length, this.bars.length + d));
    if (k === this.bars.length) return false;
    const atEnd = this.view.end >= this.bars.length;
    this.bars = this.full.slice(0, k); if (atEnd) this.view.end = k; this.memo = null; this.draw();
    return k < this.full.length;
  }
  endReplay() { if (this.full) { this.bars = this.full; this.full = null; this.view = { end: this.bars.length, n: Math.min(this.bars.length, this.view.n || 120) }; this.memo = null; this.draw(); } }
  // Indicator results are kept until the bars or the settings change.
  studies() {
    const key = this.bars.length + ':' + (this.bars.at(-1)?.t || 0) + ':' + JSON.stringify(this.cfg.studies);
    if (this.memo?.key === key) return this.memo.out;
    const out = this.cfg.studies.map(st => { try { return compute(st.id, this.bars, st.params); } catch { return null; } }).filter(Boolean);
    this.memo = { key, out }; return out;
  }
  get dkey() { return `qp_draw:${this.sym}:${this.cfg.tf}`; }
  // Support/resistance, trendlines and patterns of the bars shown, worked out here (no request).
  autoLayer() {
    const b = this.bars, key = b.length + ':' + (b.at(-1)?.t || 0);
    if (this.auto?.key === key) return this.auto.layer;
    const a = analyze(b, { from: Math.max(0, b.length - 260) }), T = i => b[Math.max(0, Math.min(b.length - 1, i))].t;
    const layer = { zones: a.zones.map(z => ({ ...z, from: T(z.from) })), trendlines: a.trendlines.map(l => ({ ...l, a: { t: T(l.a.i), p: l.a.p }, b: { t: T(l.b.i), p: l.b.p } })), patterns: a.patterns.map(p => ({ ...p, points: p.points.map(q => ({ t: T(q.i), p: q.p })), from: T(p.from), to: T(p.to) })) };
    this.auto = { key, layer }; return layer;
  }
  cursor() { this.cv.style.cursor = this.tool() === 'none' ? 'grab' : this.tool() === 'erase' ? 'not-allowed' : 'crosshair'; }
  async load() {
    const note = H.$('.cnote', this.el); note.textContent = 'Loading...'; this.bars = [];
    // A new symbol or timeframe starts without the last one's co-pilot drawings.
    if (this.copilot && (this.copilot.symbol !== this.sym)) this.copilot = null; this.auto = null;
    this.draw();
    try {
      const d = await loadBars(this.sym, this.cfg.tf);
      this.full = null; this.memo = null; this.script = null; this.bars = d.bars; this.ohlc = d.ohlc; this.view = { end: this.bars.length, n: Math.min(this.bars.length, this.cfg.layout > 1 ? 90 : 140) };
      this.pats = d.ohlc ? detect(this.bars, Math.max(0, this.bars.length - 400)) : [];
      this.reg = regimes(this.bars.map(x => x.c));
      const rb = H.$('.regbadge', this.el), rn = this.reg.now;
      if (rb) { rb.className = `regbadge ${rn || ''}`; rb.textContent = this.cfg.tf === '1Day' || this.cfg.tf === '1Week' ? (rn === 'bull' ? '▲ Bull trend' : rn === 'bear' ? '▼ Bear trend' : 'Mixed trend') : ''; rb.title = 'Bull: price and the 50-day average above the 200-day average. Bear: both below.'; }
      capBadge(this.sym, H.$('.capbadge', this.el));
      note.textContent = !d.ohlc ? (d.synthetic ? 'Simulated daily prices: connect a market-data source for real candles and volume.' : 'Daily closes only: connect a market-data source for full candles and volume.') : 'Scroll to zoom, drag to pan.';
      this.drawings = load(this.dkey, []);
    } catch (e) { note.textContent = e.message; }
    this.draw();
  }
  // Layout: price pane on top, optional RSI and MACD panes below.
  geom() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight, ind = this.cfg.ind, subs = (ind.rsi ? 1 : 0) + (ind.macd ? 1 : 0) + Math.min(4, this.cfg.studies.filter(x => byId(x.id)?.pane === 'sub').length) + (this.script && !this.script.r.overlay && this.script.r.plots.length ? 1 : 0), sub = subs ? Math.min(90, h * (subs > 2 ? 0.5 : 0.4) / subs) : 0;
    // Price scale on both sides (left one dropped on narrow screens to keep room for the candles).
    const axis = 58, axisL = w >= 520 ? 58 : 0, top = 6, priceH = h - subs * sub - 22;
    const from = Math.max(0, this.view.end - this.view.n), to = this.view.end, n = to - from, bw = (w - axis - axisL) / Math.max(n, 1);
    const vis = this.bars.slice(from, to);
    let lo = Math.min(...vis.map(b => b.l)), hi = Math.max(...vis.map(b => b.h)); if (!(hi > lo)) { hi = (hi || 1) * 1.01; lo = (lo || 1) * 0.99; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const ticks = niceTicks(lo, hi, Math.max(4, Math.min(9, Math.floor((priceH - top) / 50))));
    return { w, h, axis, axisL, top, priceH, sub, from, to, n, bw, lo, hi, ticks, X: i => axisL + (i - from + 0.5) * bw, Y: p => top + (1 - (p - lo) / (hi - lo)) * (priceH - top), P: y => lo + (1 - (y - top) / (priceH - top)) * (hi - lo), I: x => Math.floor((x - axisL) / bw) + from };
  }
  draw() {
    const cv = this.cv, dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
    if (!this.bars.length) { g.fillStyle = C('--mu'); canvasNote(g, 'Loading chart...'); return; }
    // A script follows the bars (replay): it is run again when their number changes.
    if (this.script && this.script.len !== this.bars.length) { try { const r = runScript(this.script.src, this.bars); this.script = { ...this.script, r, bt: r.entries.length ? scriptBacktest(r, this.bars) : null, len: this.bars.length }; } catch { this.script = null; } }
    const G = this.geom(), b = this.bars, c = b.map(x => x.c), ind = this.cfg.ind;
    g.font = '11px Inter, system-ui, sans-serif';
    // grid + price axis
    g.strokeStyle = C('--bd'); g.fillStyle = C('--mu'); g.lineWidth = 1; g.textAlign = 'left';
    // Round price levels that follow the prices on screen, labelled on both sides.
    const tf = tickLabel(G.ticks);
    for (const p of G.ticks) {
      const y = G.Y(p); if (y < G.top || y > G.priceH) continue;
      g.globalAlpha = 0.5; g.beginPath(); g.moveTo(G.axisL, y); g.lineTo(G.w - G.axis, y); g.stroke(); g.globalAlpha = 1;
      g.textAlign = 'left'; g.fillText(tf(p), G.w - G.axis + 6, y + 4);
      if (G.axisL) { g.textAlign = 'right'; g.fillText(tf(p), G.axisL - 6, y + 4); }
    }
    g.textAlign = 'left';
    // time axis
    g.textAlign = 'center';
    const step = Math.max(1, Math.ceil(G.n / Math.max(2, Math.floor((G.w - G.axis - G.axisL) / 90))));
    for (let i = G.from; i < G.to; i += step) g.fillText(tlabel(b[i].t, this.cfg.tf), G.X(i), G.h - 6);
    // volume
    if (ind.vol && this.ohlc) {
      const vmax = Math.max(...b.slice(G.from, G.to).map(x => x.v), 1), vh = (G.priceH - G.top) * 0.18;
      for (let i = G.from; i < G.to; i++) { g.fillStyle = b[i].c >= b[i].o ? C('--gr') : C('--rd'); g.globalAlpha = 0.22; const hh = b[i].v / vmax * vh; g.fillRect(G.X(i) - G.bw * 0.35, G.priceH - hh, G.bw * 0.7, hh); }
      g.globalAlpha = 1;
    }
    // Bollinger
    g.save(); g.beginPath(); g.rect(G.axisL, G.top, G.w - G.axis - G.axisL, G.priceH - G.top); g.clip();
    if (ind.bb) { const bb = bands(c); g.fillStyle = C('--ac'); g.globalAlpha = 0.08; g.beginPath(); let s = false; for (let i = G.from; i < G.to; i++) if (bb[i]) { s ? g.lineTo(G.X(i), G.Y(bb[i].u)) : g.moveTo(G.X(i), G.Y(bb[i].u)); s = true; } for (let i = G.to - 1; i >= G.from; i--) if (bb[i]) g.lineTo(G.X(i), G.Y(bb[i].l)); g.fill(); g.globalAlpha = 1; }
    // Bull and bear: shaded background, the 200-day average, crosses and 20% turns.
    if (ind.regime && this.reg && (this.cfg.tf === '1Day' || this.cfg.tf === '1Week')) {
      const R = this.reg;
      for (let i = G.from; i < G.to; i++) if (R.state[i]) { g.fillStyle = R.state[i] === 'bull' ? 'rgba(34,197,94,.07)' : 'rgba(239,68,68,.08)'; g.fillRect(G.X(i) - G.bw / 2, G.top, G.bw + 0.5, G.priceH - G.top); }
      line(g, G, R.s200, '#64748b', 1.6);
      g.font = '10.5px Inter, system-ui, sans-serif'; g.textAlign = 'center';
      for (const m of R.marks) {
        if (m.i < G.from || m.i >= G.to) continue;
        const X = G.X(m.i), up = m.kind === 'golden' || m.kind === 'bull', y = up ? G.Y(b[m.i].l ?? c[m.i]) + 22 : G.Y(b[m.i].h ?? c[m.i]) - 16;
        g.fillStyle = up ? '#16a34a' : '#dc2626'; g.beginPath(); g.arc(X, y, 4, 0, 7); g.fill();
        g.fillText(m.label, X, up ? y + 14 : y - 7);
      }
      g.font = '11px Inter, system-ui, sans-serif';
    }
    // candles (or a line for close-only data)
    if (this.ohlc) {
      for (let i = G.from; i < G.to; i++) {
        const x = b[i], up = x.c >= x.o, col = up ? C('--gr') : C('--rd'), X = G.X(i);
        g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(X, G.Y(x.h)); g.lineTo(X, G.Y(x.l)); g.stroke();
        const y1 = G.Y(Math.max(x.o, x.c)), y2 = G.Y(Math.min(x.o, x.c)), bw = Math.max(1, G.bw * 0.66);
        g.fillRect(X - bw / 2, y1, bw, Math.max(1, y2 - y1));
      }
    } else line(g, G, c, C('--ac'), 2);
    if (ind.sma20) line(g, G, sma(c, 20), '#f59e0b');
    if (ind.sma50) line(g, G, sma(c, 50), '#3b82f6');
    if (ind.ema20) line(g, G, ema(c, 20), '#ec4899');
    const ST = this.studies(), PAL = ['#8b5cf6', '#0ea5e9', '#f97316', '#14b8a6', '#e11d48', '#84cc16', '#a855f7', '#06b6d4'];
    ST.filter(r => r.def.pane === 'price').forEach((r, k) => {
      const col = PAL[k % PAL.length];
      if (r.def.fill && r.lines.length >= 2) { const a = r.lines[0].values, z = r.lines.at(-1).values; g.fillStyle = col; g.globalAlpha = 0.07; g.beginPath(); let st = false; for (let i = G.from; i < G.to; i++) if (a[i] != null) { st ? g.lineTo(G.X(i), G.Y(a[i])) : g.moveTo(G.X(i), G.Y(a[i])); st = true; } for (let i = G.to - 1; i >= G.from; i--) if (z[i] != null) g.lineTo(G.X(i), G.Y(z[i])); g.fill(); g.globalAlpha = 1; }
      r.lines.forEach((l, j) => {
        if (r.def.dots) { g.fillStyle = col; for (let i = G.from; i < G.to; i++) if (l.values[i] != null) { g.beginPath(); g.arc(G.X(i), G.Y(l.values[i]), 1.8, 0, 7); g.fill(); } return; }
        g.globalAlpha = j && r.lines.length > 2 && j === 1 && r.def.fill ? 0.6 : 1; line(g, G, l.values, col, 1.3); g.globalAlpha = 1;
      });
    });
    // pattern markers
    if (ind.pat && this.pats) {
      const seen = new Set();
      for (const p of this.pats) {
        if (p.i < G.from || p.i >= G.to || seen.has(p.i) || p.bias === 'neutral') continue; seen.add(p.i);
        const X = G.X(p.i), bull = p.bias === 'bull', y = bull ? G.Y(b[p.i].l) + 10 : G.Y(b[p.i].h) - 10;
        g.fillStyle = bull ? C('--gr') : C('--rd'); g.beginPath(); g.moveTo(X, y + (bull ? -5 : 5)); g.lineTo(X - 4, y + (bull ? 3 : -3)); g.lineTo(X + 4, y + (bull ? 3 : -3)); g.fill();
      }
    }
    // automatic structure (support/resistance zones, trendlines, chart patterns) and co-pilot answers
    if (ind.ai) drawAi(g, G, b, this.autoLayer(), C);
    if (this.copilot) drawAi(g, G, b, this.copilot, C);
    // script lines on the price, and its backtest's buys and sells
    if (this.script && this.script.r.overlay) this.script.r.plots.forEach((pl, k) => line(g, G, pl.values, pl.color || ['#7c3aed', '#0891b2', '#ea580c', '#16a34a'][k % 4], 1.6));
    if (this.script?.bt) {
      for (const t of this.script.bt.trades.concat(this.script.bt.open ? [] : [])) for (const [tt, kind] of [[t.entryT, 'in'], [t.exitT, 'out']]) {
        const i = idx(b, tt); if (i < G.from || i >= G.to) continue;
        const X = G.X(i), up = (kind === 'in') === (t.dir === 'long'), y = up ? G.Y(b[i].l) + 14 : G.Y(b[i].h) - 14;
        g.fillStyle = up ? '#16a34a' : '#dc2626'; g.beginPath(); g.moveTo(X, y + (up ? -7 : 7)); g.lineTo(X - 5, y + (up ? 3 : -3)); g.lineTo(X + 5, y + (up ? 3 : -3)); g.fill();
      }
    }
    // drawings
    for (const d of [...(this.drawings || []), ...(this.temp ? [this.temp] : [])]) drawShape(g, G, d, b, C);
    g.restore();
    // last price tag
    const last = b.at(-1).c, ly = G.Y(last);
    g.fillStyle = b.at(-1).c >= b.at(-1).o ? C('--gr') : C('--rd'); g.fillRect(G.w - G.axis + 1, ly - 9, G.axis - 2, 18); if (G.axisL) g.fillRect(1, ly - 9, G.axisL - 2, 18); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(fmt(last), G.w - G.axis + 6, ly + 4); if (G.axisL) { g.textAlign = 'right'; g.fillText(fmt(last), G.axisL - 6, ly + 4); g.textAlign = 'left'; }
    // sub panes
    let y0 = G.priceH;
    if (ind.rsi) { sub(g, G, y0, rsi(c), 0, 100, [30, 70], C, 'RSI 14'); y0 += G.sub; }
    if (ind.macd) { const m = macd(c), vals = m.slice(G.from, G.to).flatMap(x => [x.m, x.s]).filter(v => v != null), a = Math.max(...vals.map(Math.abs), 1e-9); sub(g, G, y0, m, -a, a, [0], C, 'MACD 12/26/9'); y0 += G.sub; }
    ST.filter(r => r.def.pane === 'sub').slice(0, 4).forEach(r => { studyPane(g, G, y0, r, C); y0 += G.sub; });
    if (this.script && !this.script.r.overlay && this.script.r.plots.length) { const R = this.script.r; studyPane(g, G, y0, { def: { levels: R.hlines.map(h => h.price) }, lines: R.plots.map(pl => ({ name: pl.title, values: pl.values })) }, C); y0 += G.sub; }
    // crosshair + readout
    const ro = H.$('.ohlc', this.el);
    if (this.mouse) {
      const { x, y } = this.mouse, i = Math.max(G.from, Math.min(G.to - 1, G.I(x)));
      g.strokeStyle = C('--mu'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(G.X(i), 0); g.lineTo(G.X(i), G.h - 18); if (y < G.priceH) { g.moveTo(G.axisL, y); g.lineTo(G.w - G.axis, y); } g.stroke(); g.setLineDash([]);
      if (y < G.priceH) { g.fillStyle = C('--tx'); g.fillRect(G.w - G.axis + 1, y - 9, G.axis - 2, 18); if (G.axisL) g.fillRect(1, y - 9, G.axisL - 2, 18); g.fillStyle = C('--card'); g.textAlign = 'left'; g.fillText(fmt(G.P(y)), G.w - G.axis + 6, y + 4); if (G.axisL) { g.textAlign = 'right'; g.fillText(fmt(G.P(y)), G.axisL - 6, y + 4); g.textAlign = 'left'; } }
      const x0 = b[i], pat = (this.pats || []).filter(p => p.i === i).map(p => PATTERNS[p.name]);
      ro.textContent = `${tlabel(x0.t, this.cfg.tf, true)}  O ${fmt(x0.o)}  H ${fmt(x0.h)}  L ${fmt(x0.l)}  C ${fmt(x0.c)}${x0.v ? '  V ' + compact(x0.v) : ''}${pat.length ? '  · ' + pat.join(', ') : ''}`;
    } else { const x0 = b.at(-1), ch = b.length > 1 ? (x0.c / b.at(-2).c - 1) * 100 : 0; ro.textContent = `${fmt(x0.c)}  ${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`; }
  }
  pt(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  down(e) {
    this.focus();
    if (!this.bars.length) return;
    const m = this.pt(e), G = this.geom(), tool = this.tool();
    if (m.y > G.priceH) return;
    const at = { t: this.bars[Math.max(0, Math.min(this.bars.length - 1, G.I(m.x)))].t, p: G.P(m.y) };
    if (tool === 'none') { this.drag = { x: m.x, end: this.view.end }; this.cv.setPointerCapture(e.pointerId); this.cv.style.cursor = 'grabbing'; return; }
    if (tool === 'trade') { this.onPrice?.(at.p); return; }
    if (tool === 'erase') { const k = this.hit(m, G); if (k >= 0) { this.drawings.splice(k, 1); keep(this.dkey, this.drawings); this.draw(); } return; }
    if (tool === 'hline') { this.drawings.push({ type: 'hline', a: at }); keep(this.dkey, this.drawings); this.draw(); return; }
    this.temp = { type: tool, a: at, b: at }; this.cv.setPointerCapture(e.pointerId);
  }
  move(e) {
    const m = this.pt(e); this.mouse = m;
    if (this.drag) { const G = this.geom(); this.view.end = Math.max(Math.min(this.view.n, this.bars.length), Math.min(this.bars.length, Math.round(this.drag.end - (m.x - this.drag.x) / G.bw))); }
    else if (this.temp) { const G = this.geom(); this.temp.b = { t: this.bars[Math.max(0, Math.min(this.bars.length - 1, G.I(m.x)))].t, p: G.P(m.y) }; }
    this.draw();
  }
  up() {
    if (this.drag) { this.drag = null; this.cursor(); }
    if (this.temp) { if (this.temp.a.t !== this.temp.b.t || Math.abs(this.temp.a.p - this.temp.b.p) > 1e-9) { this.drawings.push(this.temp); keep(this.dkey, this.drawings); } this.temp = null; this.draw(); }
  }
  hit(m, G) {
    const xi = t => G.X(idx(this.bars, t));
    return (this.drawings || []).findIndex(d => {
      if (d.type === 'hline') return Math.abs(G.Y(d.a.p) - m.y) < 6;
      const x1 = xi(d.a.t), x2 = xi(d.b.t), y1 = G.Y(d.a.p), y2 = G.Y(d.b.p);
      if (d.type === 'trend') { const L = Math.hypot(x2 - x1, y2 - y1) || 1; return Math.abs((y2 - y1) * m.x - (x2 - x1) * m.y + x2 * y1 - y2 * x1) / L < 6 && m.x >= Math.min(x1, x2) - 6 && m.x <= Math.max(x1, x2) + 6; }
      return m.x >= Math.min(x1, x2) && m.x <= Math.max(x1, x2) && m.y >= Math.min(y1, y2) - 6 && m.y <= Math.max(y1, y2) + 6;
    });
  }
}
// Co-pilot and automatic layers: shaded zones, dashed trendlines, pattern outlines with their name
// and neckline, option open-interest strikes and short-volume spike days. Points are by date.
function drawAi(g, G, bars, L, C) {
  if (!L || !bars.length) return;
  const X = t => G.X(idx(bars, t)), right = G.w - G.axis, tone = bias => (bias === 'bull' ? '#16a34a' : bias === 'bear' ? '#dc2626' : '#7c3aed');
  g.save(); g.font = '11px system-ui, sans-serif';
  for (const z of L.zones || []) {
    const y1 = G.Y(z.hi), y2 = G.Y(z.lo), x = Math.max(G.axisL, X(z.from));
    g.fillStyle = z.kind === 'support' ? 'rgba(22,163,74,.10)' : 'rgba(220,38,38,.10)'; g.fillRect(x, y1, right - x, Math.max(2, y2 - y1));
    g.fillStyle = z.kind === 'support' ? '#15803d' : '#b91c1c'; g.textAlign = 'right'; g.fillText(`${z.kind} ×${z.touches}`, right - 4, y1 - 3);
  }
  g.setLineDash([6, 4]); g.lineWidth = 1.4;
  for (const l of L.trendlines || []) { g.strokeStyle = l.kind === 'support' ? '#15803d' : '#b91c1c'; g.beginPath(); g.moveTo(X(l.a.t), G.Y(l.a.p)); g.lineTo(X(l.b.t), G.Y(l.b.p)); g.stroke(); }
  g.setLineDash([]);
  for (const p of L.patterns || []) {
    const col = tone(p.bias); g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
    p.points.forEach((q, k) => (k ? g.lineTo(X(q.t), G.Y(q.p)) : g.moveTo(X(q.t), G.Y(q.p)))); g.stroke();
    if (p.neckline) { g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(p.from), G.Y(p.neckline)); g.lineTo(Math.min(right, X(p.to) + 30), G.Y(p.neckline)); g.stroke(); g.setLineDash([]); }
    const top = p.points.reduce((a, q) => (q.p > a.p ? q : a), p.points[0]);
    g.fillStyle = col; g.textAlign = 'center'; g.fillText(p.name + (p.shortSpikes?.length ? ' · short spike' : ''), X(top.t), G.Y(top.p) - 8);
  }
  const oi = L.options; if (oi) for (const [list, col, name] of [[oi.calls || [], '#0891b2', 'Call OI'], [oi.puts || [], '#ea580c', 'Put OI']]) for (const x of list) {
    const y = G.Y(x.strike); if (y < G.top || y > G.priceH) continue; g.strokeStyle = col; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(G.axisL, y); g.lineTo(right, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.textAlign = 'left'; g.fillText(`${name} ${x.strike} (${x.oi.toLocaleString()})`, G.axisL + 4, y - 3);
  }
  for (const s of L.short?.spikes || []) { const x = X(Date.parse(s.day)); g.fillStyle = '#7c3aed'; g.fillRect(x - 2, G.Y(bars[idx(bars, Date.parse(s.day))].l) + 8, 4, 8); }
  g.restore();
}
const idx = (bars, t) => { let lo = 0, hi = bars.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].t < t) lo = m + 1; else hi = m; } return lo; };
function drawShape(g, G, d, bars, C) {
  g.strokeStyle = C('--ac'); g.lineWidth = 1.5; g.fillStyle = C('--ac');
  if (d.type === 'hline') { const y = G.Y(d.a.p); g.beginPath(); g.moveTo(G.axisL, y); g.lineTo(G.w - G.axis, y); g.stroke(); g.textAlign = 'left'; g.fillText(fmt(d.a.p), G.axisL + 4, y - 4); return; }
  const x1 = G.X(idx(bars, d.a.t)), x2 = G.X(idx(bars, d.b.t)), y1 = G.Y(d.a.p), y2 = G.Y(d.b.p);
  if (d.type === 'trend') { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); return; }
  if (d.type === 'rect') { g.globalAlpha = 0.1; g.fillRect(x1, y1, x2 - x1, y2 - y1); g.globalAlpha = 1; g.strokeRect(x1, y1, x2 - x1, y2 - y1); return; }
  if (d.type === 'fib') {
    g.textAlign = 'left';
    for (const r of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) { const p = d.b.p + (d.a.p - d.b.p) * r, y = G.Y(p); g.globalAlpha = r === 0 || r === 1 ? 1 : 0.6; g.beginPath(); g.moveTo(Math.min(x1, x2), y); g.lineTo(G.w - G.axis, y); g.stroke(); g.fillText(`${(r * 100).toFixed(1)}%  ${fmt(p)}`, Math.min(x1, x2) + 4, y - 3); }
    g.globalAlpha = 1;
  }
}
function line(g, G, s, color, w = 1.3) {
  g.strokeStyle = color; g.lineWidth = w; g.beginPath(); let on = false;
  for (let i = G.from; i < G.to; i++) { const v = s[i]; if (v == null) { on = false; continue; } on ? g.lineTo(G.X(i), G.Y(v)) : g.moveTo(G.X(i), G.Y(v)); on = true; }
  g.stroke(); g.lineWidth = 1;
}
function sub(g, G, y0, s, lo, hi, levels, C, label) {
  const Y = v => y0 + 6 + (1 - (v - lo) / (hi - lo)) * (G.sub - 12);
  g.strokeStyle = C('--bd'); g.beginPath(); g.moveTo(0, y0); g.lineTo(G.w, y0); g.stroke();
  g.setLineDash([3, 3]); for (const l of levels) { g.beginPath(); g.moveTo(G.axisL, Y(l)); g.lineTo(G.w - G.axis, Y(l)); g.stroke(); } g.setLineDash([]);
  g.fillStyle = C('--mu'); g.textAlign = 'left'; g.fillText(label, G.axisL + 4, y0 + 13);
  if (typeof s[0] === 'object' && s[0] !== null) {
    for (let i = G.from; i < G.to; i++) { const h = s[i].h; if (h == null) continue; g.fillStyle = h >= 0 ? C('--gr') : C('--rd'); g.globalAlpha = 0.5; g.fillRect(G.X(i) - G.bw * 0.3, Math.min(Y(0), Y(h)), G.bw * 0.6, Math.abs(Y(h) - Y(0))); }
    g.globalAlpha = 1;
    const GG = { ...G, Y }; line(g, GG, s.map(x => x.m), C('--ac')); line(g, GG, s.map(x => x.s), '#f59e0b');
  } else line(g, { ...G, Y }, s, C('--ac2'));
}
function studyPane(g, G, y0, r, C) {
  const vis = r.lines.flatMap(l => l.values.slice(G.from, G.to)).filter(v => v != null && isFinite(v));
  let [lo, hi] = r.def.range || [Math.min(...vis), Math.max(...vis)];
  if (!(hi > lo)) { hi = (hi || 1) + 1; lo = (lo || 0) - 1; }
  if (r.lines.some(l => l.hist) && !r.def.range) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const Y = v => y0 + 6 + (1 - (v - lo) / (hi - lo)) * (G.sub - 12), GG = { ...G, Y }, PAL = [C('--ac'), '#f59e0b', '#0ea5e9', '#e11d48'];
  g.strokeStyle = C('--bd'); g.beginPath(); g.moveTo(0, y0); g.lineTo(G.w, y0); g.stroke();
  g.setLineDash([3, 3]); for (const l of r.def.levels || []) if (l >= lo && l <= hi) { g.beginPath(); g.moveTo(G.axisL, Y(l)); g.lineTo(G.w - G.axis, Y(l)); g.stroke(); } g.setLineDash([]);
  r.lines.forEach((l, k) => {
    if (l.hist) { for (let i = G.from; i < G.to; i++) { const v = l.values[i]; if (v == null) continue; g.fillStyle = v >= 0 ? C('--gr') : C('--rd'); g.globalAlpha = 0.45; g.fillRect(G.X(i) - G.bw * 0.3, Math.min(Y(Math.max(lo, 0)), Y(v)), G.bw * 0.6, Math.abs(Y(v) - Y(Math.max(lo, 0)))); } g.globalAlpha = 1; }
    else line(g, GG, l.values, PAL[k % PAL.length]);
  });
  const lastV = r.lines[0].values[G.to - 1];
  g.fillStyle = C('--mu'); g.textAlign = 'left'; g.fillText(`${r.lines.map(l => l.name).join(' · ')}${lastV != null ? '  ' + fmt(lastV) : ''}`, G.axisL + 4, y0 + 13);
}
const fmt = p => (Math.abs(p) >= 1000 ? p.toFixed(0) : Math.abs(p) >= 10 ? p.toFixed(2) : p.toFixed(4));
const compact = v => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : (+v).toFixed(2));
const tlabel = (t, tf, full) => { const d = new Date(t); return tf === '1Day' || tf === '1Week' ? d.toISOString().slice(full ? 0 : 2, 10) : (full ? d.toISOString().slice(5, 10) + ' ' : '') + d.toTimeString().slice(0, 5); };
