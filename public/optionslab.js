// Options lab: tap a strategy template to build it from the live chain (or enter legs by hand),
// see the payoff at expiry and on any date with implied-volatility what-if sliders, send all legs
// as one order, scan for income trades, and run income bots (covered calls, cash-secured puts, the
// wheel) with built-in risk controls.
import { canvasNote } from './i18n.js';
let H;
// Re-render after a short delay, unless the user has moved to another page by then.
const later = ms => { const h = location.hash; setTimeout(() => location.hash === h && H.render(), ms); };
export function registerOptionsLab(routes, helpers) {
  H = helpers;
  routes.optionslab = lab;
}
const ICON = { covered_call: '📈', cash_secured_put: '💵', bull_call: '↗', bear_put: '↘', bull_put: '🛡', bear_call: '⛱', iron_condor: '🦅', straddle: '⚡', strangle: '🌩', butterfly: '🦋', collar: '🧷' };
const STRAT = { covered_call: 'Covered call', cash_secured_put: 'Cash-secured put', bull_put: 'Bull put spread', bear_call: 'Bear call spread', iron_condor: 'Iron condor' };
const usd = v => (v === 'unlimited' ? 'Unlimited' : H.money(v));

function payoffChart(canvas, p, spot) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
  if (!p?.prices?.length) { g.fillStyle = C('--mu'); canvasNote(g, 'Build a position to see its payoff'); return; }
  const all = [...p.atExpiry, ...p.atDate, 0]; let lo = Math.min(...all), hi = Math.max(...all); if (hi === lo) { hi += 1; lo -= 1; }
  const pad = 10, X = i => pad + i / (p.prices.length - 1) * (w - 2 * pad), Y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad - 14);
  const xOf = price => X((price - p.prices[0]) / (p.prices.at(-1) - p.prices[0]) * (p.prices.length - 1));
  g.strokeStyle = C('--bd'); g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
  // shade profit and loss under the expiry line
  for (const [col, clipTop, clipH] of [[C('--gr'), 0, Y(0)], [C('--rd'), Y(0), h]]) {
    g.save(); g.beginPath(); g.rect(0, clipTop, w, clipH - clipTop); g.clip();
    g.beginPath(); p.atExpiry.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.lineTo(X(p.prices.length - 1), Y(0)); g.lineTo(X(0), Y(0)); g.closePath();
    g.globalAlpha = 0.15; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
    g.beginPath(); p.atExpiry.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.strokeStyle = col; g.lineWidth = 2; g.stroke(); g.restore();
  }
  g.setLineDash([5, 4]); g.strokeStyle = C('--ac'); g.lineWidth = 1.5; g.beginPath(); p.atDate.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke(); g.setLineDash([]);
  g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = C('--mu'); g.textAlign = 'center';
  for (let k = 0; k <= 4; k++) { const i = Math.round(k / 4 * (p.prices.length - 1)); g.fillText(p.prices[i].toFixed(0), X(i), h - 2); }
  if (spot) { const x = xOf(spot); g.strokeStyle = C('--tx'); g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 14); g.stroke(); g.globalAlpha = 1; g.fillStyle = C('--tx'); g.fillText('now ' + spot.toFixed(2), x, 10); }
  for (const b of p.breakevens) { const x = xOf(b); g.fillStyle = C('--warn'); g.beginPath(); g.arc(x, Y(0), 3.5, 0, 7); g.fill(); }
}

async function lab(view, q) {
  const tab = q.get('tab') || 'build';
  const tabs = `<div class="seg pagetabs">${[['build', 'Strategy builder'], ['scan', 'Income scanner'], ['bots', 'Income bots']].map(([k, t]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const head = `<div class="pagehead"><h1>Options lab</h1><p class="mu">Build multi-leg strategies in one tap, see exactly what you can make or lose, scan for income trades, and let an income bot run covered calls and cash-secured puts for you.</p></div>${tabs}`;
  if (tab === 'scan') return scan(view, head);
  if (tab === 'bots') return bots(view, head);
  const templates = await H.api('/options/templates');
  let pos = null; try { pos = JSON.parse(sessionStorage.getItem('qp_opt') || 'null'); sessionStorage.removeItem('qp_opt'); } catch {}
  view.innerHTML = `${head}
  <div class="card"><div class="row"><label>Underlying<input id="und" value="${H.esc(q.get('symbol') || pos?.underlying || 'SPY')}" data-no-tr></label><label>Expiration<select id="exp"><option value="">About a month out</option></select></label></div>
    <div class="tpls">${Object.entries(templates).map(([k, t]) => `<button type="button" class="tpl" data-t="${k}"><span class="ic">${ICON[k] || '◆'}</span><b>${H.esc(t.name)}</b><span class="mu">${H.esc(t.desc)}</span></button>`).join('')}</div><div class="err" id="tErr"></div></div>
  <div class="grid optgrid">
    <div class="card"><h2 id="pname">Position</h2><div class="tablewrap"><table id="legs"></table></div>
      <div class="row"><button type="button" class="ghost small" id="addLeg">+ Add leg</button><label class="inline">Price now<input id="spot" type="number" step="0.01" style="width:110px"></label></div>
      <div id="ordBox"></div></div>
    <div class="card"><h2>Payoff</h2><div class="stats" id="pstats"></div><canvas class="chart" id="pay" style="height:260px"></canvas>
      <p class="mu small-print">Solid line: profit or loss at expiration. Dashed: on the date below, from Black-Scholes with each leg's implied volatility.</p>
      <label>Days from today: <b id="dfv">0</b><input type="range" id="df" min="0" max="60" value="0"></label>
      <label>Implied volatility change: <b id="ivv">0</b> pts<input type="range" id="iv" min="-30" max="50" value="0"></label></div>
  </div>`;
  let legs = pos?.legs || [], spot = pos?.spot || 0, last = null, tmr;
  const und = H.$('#und', view), expSel = H.$('#exp', view), err = H.$('#tErr', view);
  const drawLegs = () => {
    H.$('#legs', view).innerHTML = `<tr><th>Side</th><th>Type</th><th>Qty</th><th>Strike</th><th>Expiration</th><th>Price</th><th>IV %</th><th></th></tr>` + (legs.map((l, i) => `<tr data-i="${i}">
      <td><select data-k="side"><option value="buy" ${l.side === 'buy' ? 'selected' : ''}>Buy</option><option value="sell" ${l.side === 'sell' ? 'selected' : ''}>Sell</option></select></td>
      <td><select data-k="kind">${['call', 'put', 'stock'].map(k => `<option ${l.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
      <td><input data-k="qty" type="number" min="1" value="${l.qty}" style="width:70px"></td>
      <td>${l.kind === 'stock' ? '-' : `<input data-k="strike" type="number" step="0.5" value="${l.strike ?? ''}" style="width:90px">`}</td>
      <td>${l.kind === 'stock' ? '-' : `<input data-k="expiration" type="date" value="${l.expiration || ''}">`}</td>
      <td><input data-k="premium" type="number" step="0.01" value="${l.premium ?? 0}" style="width:90px"></td>
      <td>${l.kind === 'stock' ? '-' : `<input data-k="iv" type="number" step="1" value="${Math.round((l.iv || 0.3) * 100)}" style="width:70px">`}</td>
      <td><button type="button" class="small ghost" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="8" class="mu">Tap a template above, or add legs by hand.</td></tr>');
    H.$$('#legs [data-k]', view).forEach(inp => (inp.onchange = () => { const l = legs[+inp.closest('tr').dataset.i], k = inp.dataset.k; l[k] = k === 'iv' ? +inp.value / 100 : ['qty', 'strike', 'premium'].includes(k) ? +inp.value : inp.value; if (k === 'kind') { delete l.symbol; drawLegs(); } recalc(); }));
    H.$$('[data-rm]', view).forEach(b => (b.onclick = () => { legs.splice(+b.dataset.rm, 1); drawLegs(); recalc(); }));
    H.$('#spot', view).value = spot || '';
    orderBox();
  };
  const recalc = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      if (!legs.length || !(spot > 0)) { last = null; payoffChart(H.$('#pay', view), null); H.$('#pstats', view).innerHTML = ''; return; }
      try {
        last = await H.api('/options/payoff', { body: { legs, spot, daysForward: +H.$('#df', view).value, ivShift: +H.$('#iv', view).value } });
        H.$('#pstats', view).innerHTML = `<div class="stat"><span>Max profit</span><b class="pos">${usd(last.maxProfit)}</b></div><div class="stat"><span>Max loss</span><b class="neg">${usd(last.maxLoss)}</b></div><div class="stat"><span>${last.netCredit >= 0 ? 'Credit received' : 'Cost'}</span><b>${H.money(Math.abs(last.netCredit))}</b></div><div class="stat"><span>Break-even</span><b>${last.breakevens.map(b => b.toFixed(2)).join(' / ') || '-'}</b></div>`;
        payoffChart(H.$('#pay', view), last, spot);
      } catch (e) { err.textContent = e.message; }
    }, 150);
  };
  const orderBox = () => {
    const opt = legs.filter(l => l.kind !== 'stock'), ready = opt.length && opt.every(l => l.symbol);
    H.$('#ordBox', view).innerHTML = !legs.length ? '' : !ready ? '<p class="mu small-print">Legs built from the live chain can be sent as an order. Hand-entered legs are for what-if only.</p>'
      : `<form class="row" id="of"><label>Contracts<input name="qty" type="number" min="1" value="1" style="width:90px"></label><label>Limit (net per share; negative = credit)<input name="limit" type="number" step="0.01" value="${opt.reduce((a, l) => a + (l.side === 'buy' ? 1 : -1) * l.qty * l.premium, 0).toFixed(2)}"></label><button>Send ${opt.length}-leg order to Alpaca</button></form>
        ${legs.some(l => l.kind === 'stock') ? '<p class="mu small-print">The stock part is not included: buy the shares on the Trade page first.</p>' : ''}<div class="err"></div>`;
    const of = H.$('#of', view); if (!of) return;
    H.act(H.$('button', of), async () => {
      const f = H.form(of);
      if (!confirm(`Send this ${opt.length}-leg order (${f.qty} × ${f.limit >= 0 ? 'debit' : 'credit'} ${Math.abs(f.limit)}) to your Alpaca account? Options can lose their full value.`)) return;
      const body = opt.length === 1 ? { symbol: opt[0].symbol, side: opt[0].side, qty: f.qty * opt[0].qty, type: 'limit', limit_price: Math.abs(+f.limit).toFixed(2), time_in_force: 'day' }
        : { order_class: 'mleg', qty: f.qty, type: 'limit', limit_price: (+f.limit).toFixed(2), legs: opt.map(l => ({ symbol: l.symbol, side: l.side, ratio_qty: l.qty })) };
      const r = await H.api('/alpaca/orders', { body }); return `Order ${r.status}`;
    });
  };
  H.$('#spot', view).onchange = e => { spot = +e.target.value; recalc(); };
  H.$('#addLeg', view).onclick = () => { legs.push({ kind: 'call', side: 'buy', qty: 1, strike: Math.round(spot || 100), premium: 1, iv: 0.3, expiration: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }); drawLegs(); recalc(); };
  H.$('#df', view).oninput = e => { H.$('#dfv', view).textContent = e.target.value; recalc(); };
  H.$('#iv', view).oninput = e => { H.$('#ivv', view).textContent = (e.target.value > 0 ? '+' : '') + e.target.value; recalc(); };
  H.$$('[data-t]', view).forEach(b => (b.onclick = async () => {
    err.textContent = ''; H.$$('[data-t]', view).forEach(x => x.classList.toggle('on', x === b)); b.disabled = true;
    try {
      const r = await H.api('/options/template', { body: { template: b.dataset.t, underlying: und.value.trim(), expiration: expSel.value || undefined } });
      legs = r.legs; spot = r.spot; H.$('#pname', view).textContent = `${r.name}: ${und.value.toUpperCase()} ${r.expiration} (${r.dte} days)`;
      if (expSel.options.length <= 1) expSel.innerHTML = '<option value="">About a month out</option>' + r.expirations.map(e => `<option>${e}</option>`).join('');
      H.$('#df', view).max = Math.max(1, Math.floor(r.dte)); drawLegs(); recalc();
    } catch (e) { err.textContent = e.message + (/market-data/.test(e.message) ? ' You can still add legs by hand below to see a payoff.' : ''); }
    b.disabled = false;
  }));
  und.onchange = () => (expSel.innerHTML = '<option value="">About a month out</option>');
  H.$$('[data-tab]', view).forEach(b => (b.onclick = () => (location.hash = '#/optionslab?tab=' + b.dataset.tab)));
  drawLegs(); recalc();
}

async function scan(view, head) {
  view.innerHTML = `${head}<form class="card" id="sc"><div class="row"><label style="flex:3">Underlyings<input name="underlyings" value="SPY, QQQ, AAPL, MSFT, AMD" data-no-tr></label><label>Days to expiry<input name="dteMin" type="number" value="20" style="width:80px"> to <input name="dteMax" type="number" value="50" style="width:80px"></label><button>Find income trades</button></div><div class="err"></div></form><div id="scOut"></div>`;
  H.$$('[data-tab]', view).forEach(b => (b.onclick = () => (location.hash = '#/optionslab?tab=' + b.dataset.tab)));
  const f = H.$('#sc', view);
  H.act(H.$('button', f), async () => {
    const rows = await H.api('/options/scan', { body: H.form(f) });
    H.$('#scOut', view).innerHTML = `<div class="card"><div class="tablewrap"><table><tr><th>Underlying</th><th>Strategy</th><th>Expiration</th><th>Strikes</th><th>Credit</th><th>Capital at risk</th><th>Return</th><th>Per year</th><th>Chance of profit</th><th></th></tr>
      ${rows.map((r, i) => r.error ? `<tr><td>${H.esc(r.underlying)}</td><td colspan="9" class="mu">${H.esc(r.error)}</td></tr>` : `<tr><td>${H.esc(r.underlying)}</td><td>${H.esc(STRAT[r.strategy] || r.strategy)}</td><td>${H.esc(r.expiration)} (${r.dte}d)</td><td>${r.legs.map(l => `${l.side === 'sell' ? '-' : '+'}${l.strike}${l.kind[0].toUpperCase()}`).join(' ')}</td>
        <td>${H.money(r.credit)}</td><td>${H.money(r.capital)}</td><td>${r.returnPct}%</td><td><b>${r.annualizedPct}%</b></td><td>${r.popPct}%</td><td><button class="small ghost" data-load="${i}">Open</button></td></tr>`).join('') || '<tr><td colspan="10" class="mu">Nothing found</td></tr>'}</table></div>
      <p class="mu small-print">Chance of profit is a rough estimate from option delta. Income strategies can lose much more than they collect when the market moves sharply.</p></div>`;
    H.$$('[data-load]', view).forEach(b => (b.onclick = () => { const r = rows[+b.dataset.load]; sessionStorage.setItem('qp_opt', JSON.stringify({ underlying: r.underlying, spot: r.spot, legs: r.legs })); location.hash = '#/optionslab?tab=build&symbol=' + encodeURIComponent(r.underlying); }));
  });
}

async function bots(view, head) {
  const list = await H.api('/options/bots');
  view.innerHTML = `${head}<div class="card"><h2>My income bots</h2><div class="tablewrap"><table><tr><th>Underlying</th><th>Strategy</th><th>Rules</th><th>Status</th><th>Last action</th><th></th></tr>
    ${list.map(b => `<tr data-id="${b.id}"><td><b>${H.esc(b.underlying)}</b></td><td>${H.esc({ wheel: 'The wheel', ...STRAT }[b.kind] || b.kind)}</td><td class="mu small-print">delta ${b.config.targetDelta}, ${b.config.dteMin}-${b.config.dteMax} days, take profit ${b.config.takeProfitPct}%, stop at ${b.config.stopMultiple}× credit, close ${b.config.closeDte} days before expiry, ${b.config.contracts} contract(s)</td>
      <td>${b.active ? '<span class="pill ok">running</span>' : '<span class="pill">paused</span>'}${b.state.open ? `<div class="small-print">open: ${H.esc(b.state.open.symbol)}</div>` : ''}</td><td class="small-print">${H.esc(b.last_action || '-')}</td>
      <td class="nowrap"><button class="small ghost" data-a="${b.active ? 'pause' : 'resume'}">${b.active ? 'Pause' : 'Resume'}</button> <button class="small ghost" data-a="del">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="mu">No income bots yet</td></tr>'}</table></div></div>
  <form class="card" id="nb"><h2>New income bot</h2><div class="row">
    <label>Underlying<input name="underlying" value="SPY" data-no-tr></label><label>Strategy<select name="kind"><option value="cash_secured_put">Cash-secured puts</option><option value="covered_call">Covered calls (on shares you own)</option><option value="wheel">The wheel (puts, then calls if assigned)</option></select></label>
    <label>Target delta<input name="targetDelta" type="number" step="0.05" min="0.05" max="0.5" value="0.25"></label><label>Contracts<input name="contracts" type="number" min="1" max="10" value="1"></label></div>
    <div class="row"><label>Days to expiry from<input name="dteMin" type="number" value="25"></label><label>to<input name="dteMax" type="number" value="45"></label><label>Take profit at % of credit<input name="takeProfitPct" type="number" value="50"></label><label>Stop when loss is × credit<input name="stopMultiple" type="number" step="0.5" value="2"></label><label>Close days before expiry<input name="closeDte" type="number" value="7"></label></div>
    <button>Start bot</button><div class="err"></div>
    <p class="mu small-print">Income bots trade options on your Alpaca account (Pro plan, options approval needed). They check after 10:30 New York time each trading day, open one position at a time, and respect your risk limits and kill switch.</p></form>`;
  H.$$('[data-tab]', view).forEach(b => (b.onclick = () => (location.hash = '#/optionslab?tab=' + b.dataset.tab)));
  H.$$('[data-a]', view).forEach(b => (b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    if (b.dataset.a === 'del') { if (!confirm('Delete this bot? An open position stays in your account.')) return; await H.api('/options/bots/' + id, { method: 'DELETE' }); }
    else await H.api('/options/bots/' + id, { method: 'PATCH', body: { active: b.dataset.a === 'resume' } });
    H.render();
  }));
  const f = H.$('#nb', view);
  H.act(H.$('button', f), async () => { if (!confirm('This bot will sell options on your Alpaca account automatically. Continue?')) return; await H.api('/options/bots', { body: H.form(f) }); later(500); return 'Bot started'; });
}
