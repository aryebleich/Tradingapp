// Advanced chart: candlesticks with volume, moving averages, Bollinger bands, RSI and MACD panes,
// candlestick pattern markers, drawing tools (trend line, horizontal line, box, Fibonacci) kept
// per symbol on this device, 1/2/4-chart layouts, pop-out windows for more monitors, click-to-trade
// and a live order-book ladder (depth for crypto, top of book for stocks).
import { detect, PATTERNS } from './patterns.js';
import { canvasNote } from './i18n.js';
let H;
export function registerChart(routes, helpers) {
  H = helpers;
  routes.chart = chartPage;
}

// ---------- indicators ----------
const sma = (c, n) => c.map((_, i) => (i < n - 1 ? null : c.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
const ema = (c, n) => { const k = 2 / (n + 1), out = []; let e = null; c.forEach((v, i) => { e = e == null ? v : v * k + e * (1 - k); out.push(i < n - 1 ? null : e); }); return out; };
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
const DEF = { tf: '1Day', layout: 1, symbols: ['SPY', 'QQQ', 'AAPL', 'BTC/USD'], ind: { sma20: true, sma50: true, ema20: false, bb: false, vol: true, rsi: true, macd: false, pat: true } };

async function chartPage(view, q) {
  const cfg = { ...DEF, ...load('qp_chart', {}) }; cfg.ind = { ...DEF.ind, ...cfg.ind };
  if (q.get('symbol')) cfg.symbols[0] = q.get('symbol').toUpperCase();
  if (q.get('layout')) cfg.layout = +q.get('layout');
  // Charts per layout by plan: 1 on Starter, 2 on Pro, 4 on Elite and Ultimate.
  const me = H.me(), maxLayout = me?.role === 'admin' || ['elite', 'ultimate'].includes(me?.plan) && H.paid() ? 4 : H.paid() ? 2 : 1;
  cfg.layout = Math.min(cfg.layout, maxLayout);
  const popout = q.get('popout') === '1';
  document.body.classList.toggle('popout', popout);
  H.onLeave(() => document.body.classList.remove('popout'));
  const accts = await H.accounts();
  const IND = { sma20: 'SMA 20', sma50: 'SMA 50', ema20: 'EMA 20', bb: 'Bollinger', vol: 'Volume', rsi: 'RSI', macd: 'MACD', pat: 'Patterns' };
  view.innerHTML = `<div class="charttop">
      ${popout ? '' : '<h1 style="margin:0">Chart</h1>'}
      <div class="seg" id="tf">${Object.keys(TFS).map(t => `<button type="button" data-tf="${t}" class="${t === cfg.tf ? 'on' : ''}">${{ '5Min': '5m', '15Min': '15m', '1Hour': '1h', '1Day': '1D', '1Week': '1W' }[t]}</button>`).join('')}</div>
      <div class="seg" id="tools" title="Drawing tools">${[['none', '↖', 'Pointer'], ['trend', '╱', 'Trend line'], ['hline', '―', 'Horizontal line'], ['rect', '▭', 'Box'], ['fib', 'Fib', 'Fibonacci retracement'], ['trade', '$', 'Click to trade'], ['erase', '⌫', 'Erase drawing']].map(([k, s, t]) => `<button type="button" data-tool="${k}" title="${t}" aria-label="${t}" class="${k === 'none' ? 'on' : ''}">${s}</button>`).join('')}</div>
      <div class="seg" id="lay" title="Layout">${[1, 2, 4].map(n => `<button type="button" data-l="${n}" class="${n === cfg.layout ? 'on' : ''}" ${n > maxLayout ? 'data-locked="1" title="More charts per layout come with a higher plan"' : ''}>${n === 1 ? '▢' : n === 2 ? '▥' : '▦'}</button>`).join('')}</div>
      ${popout ? '' : '<button type="button" class="ghost small" id="pop" title="Open in a new window (drag it to another monitor)">⧉ Pop out</button>'}
    </div>
    <div class="chips inds">${Object.entries(IND).map(([k, t]) => `<label class="chk"><input type="checkbox" data-ind="${k}" ${cfg.ind[k] ? 'checked' : ''}>${t}</label>`).join('')}</div>
    <div class="chartgrid l${cfg.layout}" id="grid"></div>
    <div class="chartside" id="side"></div>`;
  let tool = 'none', active = 0;
  const panels = [];
  const save = () => keep('qp_chart', { tf: cfg.tf, layout: cfg.layout, symbols: cfg.symbols, ind: cfg.ind });
  const grid = H.$('#grid', view);
  for (let i = 0; i < cfg.layout; i++) {
    const el = document.createElement('div'); el.className = 'card cpanel'; el.innerHTML = `<div class="chead"><input class="csym" value="${H.esc(cfg.symbols[i] || 'SPY')}" aria-label="Symbol" data-no-tr><span class="ohlc mu" data-no-tr></span></div><div class="cwrap"><canvas></canvas></div><div class="cnote mu small-print"></div>`;
    grid.append(el);
    const p = new Panel(el, i, cfg, () => tool, () => setActive(i));
    panels.push(p);
    H.$('.csym', el).onchange = e => { cfg.symbols[i] = e.target.value.trim().toUpperCase() || 'SPY'; save(); p.load(); if (i === active) side(); };
  }
  const setActive = i => { if (active === i) return; active = i; panels.forEach((p, j) => p.el.classList.toggle('active', j === i)); side(); };
  panels[0].el.classList.add('active');
  panels.forEach(p => p.load());
  H.$$('[data-tf]', view).forEach(b => (b.onclick = () => { cfg.tf = b.dataset.tf; save(); H.$$('[data-tf]', view).forEach(x => x.classList.toggle('on', x === b)); panels.forEach(p => p.load()); }));
  H.$$('[data-tool]', view).forEach(b => (b.onclick = () => { tool = b.dataset.tool; H.$$('[data-tool]', view).forEach(x => x.classList.toggle('on', x === b)); panels.forEach(p => p.cursor()); }));
  H.$$('[data-l]', view).forEach(b => (b.onclick = () => { if (b.dataset.locked) { location.hash = '#/funding'; return; } cfg.layout = +b.dataset.l; save(); H.render(); }));
  H.$$('[data-ind]', view).forEach(c => (c.onchange = () => { cfg.ind[c.dataset.ind] = c.checked; save(); panels.forEach(p => p.draw()); }));
  if (H.$('#pop', view)) H.$('#pop', view).onclick = () => window.open(`${location.pathname}#/chart?symbol=${encodeURIComponent(cfg.symbols[active])}&layout=${cfg.layout}&popout=1`, '_blank', 'width=1200,height=760');
  const ro = new ResizeObserver(() => panels.forEach(p => p.draw())); ro.observe(grid); H.onLeave(() => ro.disconnect());

  // Order ticket + order-book ladder for the active chart.
  let timer = null; H.onLeave(() => clearInterval(timer));
  const sideEl = H.$('#side', view);
  function side(price) {
    const sym = cfg.symbols[active] || 'SPY', crypto = sym.includes('/'), alp = accts.find(a => a.id === 'alpaca' && a.connected);
    sideEl.innerHTML = `<div class="card"><h2>Trade ${H.esc(sym)}</h2><form id="tk">
      <div class="seg"><button type="button" class="buy on" data-side="buy">Buy</button><button type="button" class="sell" data-side="sell">Sell</button></div>
      <label>Account<select name="account">${H.accountOptions(accts, alp ? 'alpaca' : 'paper')}</select></label>
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
      return `${r.side} ${r.symbol}: ${r.status}${r.price ? ' @ ' + H.money(r.price) : ''}`;
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
  get dkey() { return `qp_draw:${this.sym}:${this.cfg.tf}`; }
  cursor() { this.cv.style.cursor = this.tool() === 'none' ? 'grab' : this.tool() === 'erase' ? 'not-allowed' : 'crosshair'; }
  async load() {
    const note = H.$('.cnote', this.el); note.textContent = 'Loading...'; this.bars = [];
    this.draw();
    try {
      const d = await loadBars(this.sym, this.cfg.tf);
      this.bars = d.bars; this.ohlc = d.ohlc; this.view = { end: this.bars.length, n: Math.min(this.bars.length, this.cfg.layout > 1 ? 90 : 140) };
      this.pats = d.ohlc ? detect(this.bars, Math.max(0, this.bars.length - 400)) : [];
      note.textContent = !d.ohlc ? (d.synthetic ? 'Simulated daily prices: connect a market-data source for real candles and volume.' : 'Daily closes only: connect a market-data source for full candles and volume.') : 'Scroll to zoom, drag to pan.';
      this.drawings = load(this.dkey, []);
    } catch (e) { note.textContent = e.message; }
    this.draw();
  }
  // Layout: price pane on top, optional RSI and MACD panes below.
  geom() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight, ind = this.cfg.ind, subs = (ind.rsi ? 1 : 0) + (ind.macd ? 1 : 0), sub = subs ? Math.min(90, h * 0.2) : 0;
    const axis = 58, top = 6, priceH = h - subs * sub - 22;
    const from = Math.max(0, this.view.end - this.view.n), to = this.view.end, n = to - from, bw = (w - axis) / Math.max(n, 1);
    const vis = this.bars.slice(from, to);
    let lo = Math.min(...vis.map(b => b.l)), hi = Math.max(...vis.map(b => b.h)); if (!(hi > lo)) { hi = (hi || 1) * 1.01; lo = (lo || 1) * 0.99; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    return { w, h, axis, top, priceH, sub, from, to, n, bw, lo, hi, X: i => (i - from + 0.5) * bw, Y: p => top + (1 - (p - lo) / (hi - lo)) * (priceH - top), P: y => lo + (1 - (y - top) / (priceH - top)) * (hi - lo), I: x => Math.floor(x / bw) + from };
  }
  draw() {
    const cv = this.cv, dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
    if (!this.bars.length) { g.fillStyle = C('--mu'); canvasNote(g, 'Loading chart...'); return; }
    const G = this.geom(), b = this.bars, c = b.map(x => x.c), ind = this.cfg.ind;
    g.font = '11px Inter, system-ui, sans-serif';
    // grid + price axis
    g.strokeStyle = C('--bd'); g.fillStyle = C('--mu'); g.lineWidth = 1; g.textAlign = 'left';
    for (let k = 0; k <= 5; k++) { const p = G.lo + (G.hi - G.lo) * k / 5, y = G.Y(p); g.globalAlpha = 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(G.w - G.axis, y); g.stroke(); g.globalAlpha = 1; g.fillText(fmt(p), G.w - G.axis + 6, y + 4); }
    // time axis
    g.textAlign = 'center';
    const step = Math.max(1, Math.ceil(G.n / Math.max(2, Math.floor((G.w - G.axis) / 90))));
    for (let i = G.from; i < G.to; i += step) g.fillText(tlabel(b[i].t, this.cfg.tf), G.X(i), G.h - 6);
    // volume
    if (ind.vol && this.ohlc) {
      const vmax = Math.max(...b.slice(G.from, G.to).map(x => x.v), 1), vh = (G.priceH - G.top) * 0.18;
      for (let i = G.from; i < G.to; i++) { g.fillStyle = b[i].c >= b[i].o ? C('--gr') : C('--rd'); g.globalAlpha = 0.22; const hh = b[i].v / vmax * vh; g.fillRect(G.X(i) - G.bw * 0.35, G.priceH - hh, G.bw * 0.7, hh); }
      g.globalAlpha = 1;
    }
    // Bollinger
    g.save(); g.beginPath(); g.rect(0, G.top, G.w - G.axis, G.priceH - G.top); g.clip();
    if (ind.bb) { const bb = bands(c); g.fillStyle = C('--ac'); g.globalAlpha = 0.08; g.beginPath(); let s = false; for (let i = G.from; i < G.to; i++) if (bb[i]) { s ? g.lineTo(G.X(i), G.Y(bb[i].u)) : g.moveTo(G.X(i), G.Y(bb[i].u)); s = true; } for (let i = G.to - 1; i >= G.from; i--) if (bb[i]) g.lineTo(G.X(i), G.Y(bb[i].l)); g.fill(); g.globalAlpha = 1; }
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
    // pattern markers
    if (ind.pat && this.pats) {
      const seen = new Set();
      for (const p of this.pats) {
        if (p.i < G.from || p.i >= G.to || seen.has(p.i) || p.bias === 'neutral') continue; seen.add(p.i);
        const X = G.X(p.i), bull = p.bias === 'bull', y = bull ? G.Y(b[p.i].l) + 10 : G.Y(b[p.i].h) - 10;
        g.fillStyle = bull ? C('--gr') : C('--rd'); g.beginPath(); g.moveTo(X, y + (bull ? -5 : 5)); g.lineTo(X - 4, y + (bull ? 3 : -3)); g.lineTo(X + 4, y + (bull ? 3 : -3)); g.fill();
      }
    }
    // drawings
    for (const d of [...(this.drawings || []), ...(this.temp ? [this.temp] : [])]) drawShape(g, G, d, b, C);
    g.restore();
    // last price tag
    const last = b.at(-1).c, ly = G.Y(last);
    g.fillStyle = b.at(-1).c >= b.at(-1).o ? C('--gr') : C('--rd'); g.fillRect(G.w - G.axis + 1, ly - 9, G.axis - 2, 18); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(fmt(last), G.w - G.axis + 6, ly + 4);
    // sub panes
    let y0 = G.priceH;
    if (ind.rsi) { sub(g, G, y0, rsi(c), 0, 100, [30, 70], C, 'RSI 14'); y0 += G.sub; }
    if (ind.macd) { const m = macd(c), vals = m.slice(G.from, G.to).flatMap(x => [x.m, x.s]).filter(v => v != null), a = Math.max(...vals.map(Math.abs), 1e-9); sub(g, G, y0, m, -a, a, [0], C, 'MACD 12/26/9'); }
    // crosshair + readout
    const ro = H.$('.ohlc', this.el);
    if (this.mouse) {
      const { x, y } = this.mouse, i = Math.max(G.from, Math.min(G.to - 1, G.I(x)));
      g.strokeStyle = C('--mu'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(G.X(i), 0); g.lineTo(G.X(i), G.h - 18); if (y < G.priceH) { g.moveTo(0, y); g.lineTo(G.w - G.axis, y); } g.stroke(); g.setLineDash([]);
      if (y < G.priceH) { g.fillStyle = C('--tx'); g.fillRect(G.w - G.axis + 1, y - 9, G.axis - 2, 18); g.fillStyle = C('--card'); g.fillText(fmt(G.P(y)), G.w - G.axis + 6, y + 4); }
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
const idx = (bars, t) => { let lo = 0, hi = bars.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].t < t) lo = m + 1; else hi = m; } return lo; };
function drawShape(g, G, d, bars, C) {
  g.strokeStyle = C('--ac'); g.lineWidth = 1.5; g.fillStyle = C('--ac');
  if (d.type === 'hline') { const y = G.Y(d.a.p); g.beginPath(); g.moveTo(0, y); g.lineTo(G.w - G.axis, y); g.stroke(); g.textAlign = 'left'; g.fillText(fmt(d.a.p), 4, y - 4); return; }
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
  g.setLineDash([3, 3]); for (const l of levels) { g.beginPath(); g.moveTo(0, Y(l)); g.lineTo(G.w - G.axis, Y(l)); g.stroke(); } g.setLineDash([]);
  g.fillStyle = C('--mu'); g.textAlign = 'left'; g.fillText(label, 4, y0 + 13);
  if (typeof s[0] === 'object' && s[0] !== null) {
    for (let i = G.from; i < G.to; i++) { const h = s[i].h; if (h == null) continue; g.fillStyle = h >= 0 ? C('--gr') : C('--rd'); g.globalAlpha = 0.5; g.fillRect(G.X(i) - G.bw * 0.3, Math.min(Y(0), Y(h)), G.bw * 0.6, Math.abs(Y(h) - Y(0))); }
    g.globalAlpha = 1;
    const GG = { ...G, Y }; line(g, GG, s.map(x => x.m), C('--ac')); line(g, GG, s.map(x => x.s), '#f59e0b');
  } else line(g, { ...G, Y }, s, C('--ac2'));
}
const fmt = p => (Math.abs(p) >= 1000 ? p.toFixed(0) : Math.abs(p) >= 10 ? p.toFixed(2) : p.toFixed(4));
const compact = v => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : (+v).toFixed(2));
const tlabel = (t, tf, full) => { const d = new Date(t); return tf === '1Day' || tf === '1Week' ? d.toISOString().slice(full ? 0 : 2, 10) : (full ? d.toISOString().slice(5, 10) + ' ' : '') + d.toTimeString().slice(0, 5); };
