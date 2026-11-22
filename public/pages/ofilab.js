// Order flow (OFI) lab (Automate → Pairs & stat arb → Order flow (OFI) lab, #/pairs/ofi): the
// academic exercise of research/hf-ofi in the browser. Data: the bundled synthetic sample, an upload
// (CSV in the same columns, at most 20 MB) or US stock quotes from Alpaca. The math (public/hfofi.js)
// matches the R project to 6 decimal places. Simulation only: this page never places orders.
import * as O from '../hfofi.js';

let H;
export function registerOfiLab(routes, helpers) { H = helpers; routes.ofi = ofiPage; }

const n = (v, d = 4) => (v == null || !Number.isFinite(v) ? '-' : (+v).toLocaleString('en-US', { maximumFractionDigits: d }));
const pc = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(d)}%`);
const card = (title, body) => `<div class="card"><h2>${title}</h2>${body}</div>`;
// A light SVG line chart: series [{ name, ys, cls }] over shared x; optional horizontal lines.
function lines(series, { h = 180, hlines = [], label = '' } = {}) {
  const len = Math.max(...series.map(s => s.ys.length)); if (!len) return '';
  const step = Math.max(1, Math.ceil(len / 700)), W = 700;
  const vals = series.flatMap(s => s.ys.filter(Number.isFinite)).concat(hlines.map(x => x.y).filter(Number.isFinite));
  let lo = Math.min(...vals), hi = Math.max(...vals); if (lo === hi) { lo -= 1; hi += 1; }
  const y = v => (h - 6 - (v - lo) / (hi - lo) * (h - 12)).toFixed(1), x = i => (i / (len - 1) * W).toFixed(1);
  const path = ys => { let d = '', pen = false; for (let i = 0; i < ys.length; i += step) { const v = ys[i]; if (!Number.isFinite(v)) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`; pen = true; } return d; };
  return `<figure class="ofi-fig"><svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${H.esc(label)}" class="ofi-chart">
    ${hlines.map(l => `<line x1="0" x2="${W}" y1="${y(l.y)}" y2="${y(l.y)}" class="hl ${l.cls || ''}"/>`).join('')}
    ${series.map(s => `<path d="${path(s.ys)}" class="ln ${s.cls}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
    <figcaption class="legend">${series.map(s => `<span><i class="sw ${s.cls}"></i>${H.esc(s.name)}</span>`).join('')}${hlines.map(l => `<span><i class="sw hl ${l.cls || ''}"></i>${H.esc(l.name)}</span>`).join('')}<span class="mu">${n(lo, 2)} to ${n(hi, 2)}</span></figcaption></figure>`;
}

async function ofiPage(view, q) {
  const today = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  view.innerHTML = `<div class="pagehead"><h1>Order flow (OFI) lab</h1><p class="mu" style="margin:4px 0 0">Build order-flow factors from top-of-book data, test whether they predict the next price moves, and backtest an OFI strategy with costs, in-sample and out-of-sample.</p></div>
    <div class="banner" role="note"><b>A simulation for study.</b> It never places orders. <span class="disclosure" lang="en" dir="ltr" data-no-tr>${H.esc(O.NOTE)}</span></div>
    <form class="card" id="ofiF">
      <fieldset class="ofi-src"><legend>Data</legend>
        <label class="chk"><input type="radio" name="src" value="sample" checked> Synthetic sample (rb2305-like futures ticks, generated)</label>
        <label class="chk"><input type="radio" name="src" value="upload"> Upload a CSV (columns datetime, last, bid, ask, bid_vol, ask_vol, volume, turnover; at most 20 MB)</label>
        <label class="ofi-up" hidden><input type="file" name="file" accept=".csv,text/csv"></label>
        <label class="chk"><input type="radio" name="src" value="alpaca"> US stock quotes from Alpaca</label>
        <div class="row ofi-al" hidden><label>Symbol<input name="symbol" value="SPY" data-no-tr></label><label>Day<input name="day" type="date" value="${today}"></label><label>From (New York)<input name="from" type="time" value="10:00"></label><label>Minutes<input name="minutes" type="number" min="5" max="120" value="30"></label>
          <p class="mu small-print">Alpaca quotes are <b>US equities</b>, not the rb2305 futures contract: the same math on a different market.</p></div>
      </fieldset>
      <div class="row"><label>Window N<input name="n" type="number" min="2" max="200" value="10"></label><label>Buy above percentile<input name="hi" type="number" min="51" max="99" value="80"></label><label>Sell below percentile<input name="lo" type="number" min="1" max="49" value="20"></label>
        <label>In-sample share %<input name="ins" type="number" min="20" max="80" value="50"></label><label>Fee (bp per trade)<input name="fee" type="number" min="0" max="50" step="0.1" value="1"></label><label>Slippage (ticks)<input name="slip" type="number" min="0" max="10" step="0.5" value="1"></label><label>Tick size<input name="tick" type="number" min="0.0001" step="any" value="1"></label></div>
      <p><button>Run</button> <a href="/api/hfofi/project.zip">Download the R project (zip, no data)</a> · <a href="/api/hfofi/report.pdf" target="_blank" rel="noopener">The rendered report (PDF, synthetic sample)</a></p><div class="err" role="alert"></div>
    </form><div id="ofiOut"></div>`;
  const f = H.$('#ofiF', view), out = H.$('#ofiOut', view), err = H.$('.err', f);
  const sync = () => { const s = f.src.value; H.$('.ofi-up', f).hidden = s !== 'upload'; H.$('.ofi-al', f).hidden = s !== 'alpaca'; };
  H.$$('[name=src]', f).forEach(r => (r.onchange = sync));
  let cache = { key: null, ticks: null, source: '' };
  const load = async () => {
    const s = f.src.value;
    if (s === 'sample') { if (cache.key !== 'sample') cache = { key: 'sample', ticks: O.parseTicks(await (await fetch('/api/hfofi/sample', { credentials: 'same-origin' })).text()), source: 'Synthetic sample (generated, not market data)' }; return cache; }
    if (s === 'upload') {
      const file = f.file.files[0]; if (!file) throw new Error('Choose a CSV file first.');
      if (file.size > O.MAX_BYTES) throw new Error(`The file is too big: at most 20 MB (this one is ${(file.size / 1048576).toFixed(1)} MB).`);
      const key = 'up:' + file.name + file.size + file.lastModified;
      if (cache.key !== key) cache = { key, ticks: O.parseTicks(await file.text(), { bytes: file.size }), source: 'Your file: ' + file.name };
      return cache;
    }
    const v = H.form(f), key = `al:${v.symbol}:${v.day}:${v.from}:${v.minutes}`;
    if (cache.key !== key) { const d = await H.api(`/hfofi/quotes?symbol=${encodeURIComponent(v.symbol)}&day=${v.day}&from=${encodeURIComponent(v.from)}&minutes=${+v.minutes}`); cache = { key, ticks: d.ticks, source: d.source }; }
    return cache;
  };
  const run = async () => {
    err.textContent = ''; out.innerHTML = '<div class="card"><div class="skel" role="status" aria-label="Loading"><div class="h1"></div><div class="box"></div><div></div></div></div>';
    try {
      const { ticks, source } = await load(), v = H.form(f);
      const tick = +v.tick || 1;
      const a = O.analyze(ticks, { n: +v.n || 10, hi: (+v.hi || 80) / 100, lo: (+v.lo || 20) / 100, inSample: (+v.ins || 50) / 100, fee: (+v.fee || 0) / 1e4, slip: +v.slip || 0, tick });
      draw(a, source);
    } catch (e) { out.innerHTML = ''; err.textContent = e.message; }
  };
  f.onsubmit = e => { e.preventDefault(); run(); };
  run();

  function draw(a, source) {
    const F = a.f, horizons = [...new Set(a.regressions.map(r => r.horizon))];
    const stats = (s, name) => `<tr><th scope="row">${name}</th><td class="num">${s.trades}</td><td class="num">${pc(s.hit_rate, 1)}</td><td class="num">${pc(s.avg_trade, 4)}</td><td class="num ${s.total > 0 ? 'pos' : s.total < 0 ? 'neg' : ''}">${pc(s.total)}</td><td class="num neg">${pc(s.max_dd)}</td><td class="num">${n(s.sharpe, 2)}</td></tr>`;
    const seg = (r, name) => card(`${name} <span class="mu">${r.curve.t.length.toLocaleString('en-US')} updates</span>`,
      lines([{ name: `OFI-${a.n} (gross)`, ys: r.curve.gross, cls: 's1' }, { name: `OFI-${a.n} (net of costs)`, ys: r.curve.net, cls: 's3' }, { name: 'Buy and hold', ys: r.curve.hold, cls: 's2' }], { label: `Cumulative return, ${name}`, h: 170 })
      + `<div class="tablewrap"><table class="slim"><thead><tr><th></th><th class="num">Trades</th><th class="num">Hit rate</th><th class="num">Avg per trade</th><th class="num">Total</th><th class="num">Max drawdown</th><th class="num">Sharpe (intraday, annualized)</th></tr></thead><tbody>${stats(r.stats.gross, 'Gross')}${stats(r.stats.net, 'Net of costs')}</tbody></table></div>`);
    out.innerHTML = `<p class="mu small-print">Data: ${H.esc(source)} · ${a.ticks.toLocaleString('en-US')} updates.</p>`
      + card('Price, bid and ask', lines([{ name: 'Bid', ys: F.bid, cls: 's2' }, { name: 'Ask', ys: F.ask, cls: 's3' }, { name: 'Microprice', ys: F.micro, cls: 's1' }], { label: 'Bid, ask and microprice over time', h: 200 }))
      + `<div class="grid">${card(`OFI-${a.n}`, lines([{ name: `OFI-${a.n}`, ys: F.ofi_n, cls: 's1' }], { label: `OFI-${a.n} over time with the in-sample thresholds`, hlines: [{ y: a.thresholds.hi, name: `${Math.round(a.thresholds.pHi * 100)}th percentile (in-sample)`, cls: 'up' }, { y: a.thresholds.lo, name: `${Math.round(a.thresholds.pLo * 100)}th percentile`, cls: 'dn' }] }))}
        ${card('Volume imbalance and VOI', lines([{ name: 'Volume imbalance', ys: F.imbalance, cls: 's2' }], { label: 'Volume imbalance over time', h: 120 }) + lines([{ name: 'VOI', ys: F.voi, cls: 's3' }], { label: 'VOI over time', h: 120 }))}</div>`
      + card('Do the factors predict the next mid-price moves?', `<p class="mu small-print" style="margin-top:0">Each cell: the slope of the mid-price change over the next h updates on the factor, its t-statistic and R². |t| above about 2 means the link is unlikely to be chance in this sample.</p>
        <div class="tablewrap" tabindex="0" role="region" aria-label="Factor regressions"><table class="slim ofi-reg"><thead><tr><th>Factor</th>${horizons.map(h => `<th class="num">h = ${h}<br><small>beta · t · R²</small></th>`).join('')}</tr></thead><tbody>
        ${O.FACTOR_NAMES.map(k => `<tr><th scope="row" data-no-tr>${k}</th>${horizons.map(h => { const r = a.regressions.find(x => x.factor === k && x.horizon === h); return `<td class="num">${n(r.beta, 4)} · <b class="${Math.abs(r.t) > 2 ? '' : 'mu'}">${n(r.t, 1)}</b> · ${n(r.r2, 4)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`)
      + `<p class="small-print">Thresholds from the in-sample part only (the first ${Math.round(a.thresholds.split / a.ticks * 100)}%): buy above ${n(a.thresholds.hi, 2)}, sell below ${n(a.thresholds.lo, 2)}. Costs per change of position: ${n(a.costs.fee * 1e4, 2)} bp fee plus ${a.costs.slip} tick(s) of ${a.costs.tick}.</p>`
      + `<div class="grid">${seg(a.inSample, 'In-sample')}${seg(a.outOfSample, 'Out-of-sample')}</div>`
      + `<p class="mu small-print">Fills are at the mid plus a fixed slippage; queue position, latency and partial fills are not modelled.</p><p class="mu small-print disclosure" lang="en" dir="ltr" data-no-tr>${H.esc(O.NOTE)}</p>`
      + H.related([['pairs', 'Pairs trading'], ['statarb', 'Statistical arbitrage'], ['backtest', 'Backtest']]);
  }
}
