// Strategy library (the MULTI_STRATEGIES sheet): library, today's walkdown with typed-in values,
// orders, rule editor, backtest, Reality Check, automation settings.
let H; // helpers from app.js

export function registerStrategies(routes, helpers) {
  H = helpers;
  Object.assign(routes, { strategies: library, strategy: detail });
}

const f2 = v => (v == null || !Number.isFinite(+v) ? '-' : (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pc = (v, d = 1) => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);
const RISK = { 'very high': 'neg', high: 'warn', medium: '' };
const REB = { daily: 'Every trading day', weekly: 'Weekly', monthly: 'Monthly' };
const RC = { healthy: ['Healthy', 'pos'], watch: ['Watch', 'warn'], drifting: ['Drifting', 'neg'], learning: ['Learning', ''] };
const FN = { rsi: 'RSI', sma: 'SMA', close: 'Close', ret: 'Return %', avgret: 'Avg daily ret %', stdev: 'StdDev %', high: 'High', pstdev: 'Price StDev' };
let accName = a => ({ paper: 'Paper account', alpaca: 'Alpaca' }[a] || a);
const mLabel = m => (typeof m === 'number' ? String(m) : `${m[1]} ${m[0] === 'close' ? 'Close' : `${FN[m[0]] || m[0]}(${m[2]})`}`);
const mKey = m => m.join('|');
const where = to => (!to ? '-' : to.startsWith('@') ? `BUY ${to.slice(1)}` : `Step ${to}`);

// ---------- library ----------

async function library(view) {
  try { localStorage.setItem('qp_seen_strategies', '1'); } catch {}
  const [tpls, mine, accts] = await Promise.all([H.api('/library/templates'), H.api('/library'), H.accounts()]);
  accName = a => H.acctLabel(accts.find(x => x.id === a) || { id: a, name: a });
  view.innerHTML = `
  <div class="pagehead"><h1>Strategies</h1><p class="mu" style="margin:4px 0 0">Ready-made rotation strategies from the MULTI_STRATEGIES sheet. Run them by hand (type your own values, like the sheet's yellow cells) or let them trade automatically. Every rule and number can be changed.</p></div>
  ${mine.strategies.length ? `<div class="card tablewrap"><h2>My strategies</h2><table><tr><th>Name</th><th>Runs</th><th>Account</th><th>Money</th><th>Last result</th><th>Reality Check</th><th></th></tr>
    ${mine.strategies.map(s => `<tr><td><a href="#/strategy?id=${s.id}"><b>${H.esc(s.name)}</b></a></td><td>${s.mode === 'auto' ? '<span class="pill pos">Automatic</span>' : '<span class="pill">By hand</span>'}</td><td>${accName(s.account)}</td><td>${s.allocation}%</td>
      <td class="mu" style="font-size:13px">${s.lastResult ? H.esc(s.lastResult.summary) : 'Not run yet'}</td><td>${rcPill(s.reality)}</td><td><a href="#/strategy?id=${s.id}"><button class="small ghost" type="button">Open</button></a></td></tr>`).join('')}</table>
    <p class="mu" style="font-size:12px;margin-bottom:0">${mine.strategies.length} of ${mine.limits.saved} saved · ${mine.strategies.filter(s => s.mode === 'auto').length} of ${mine.limits.auto} automatic</p></div>` : ''}
  ${mine.strategies.length > 1 ? `<div class="card"><h2>Portfolio split <span class="mu" style="font-weight:500;font-size:14px">win-rate weighted, 10%–70% each</span></h2>
    <p class="mu" style="margin-top:0">Like the sheet's PORTFOLIO_SPLIT tab: strategies that win more often get more money. Win rates come from each strategy's live daily results.</p>
    <div class="funnel">${mine.split.map(x => `<div class="bar"><span>${H.esc(x.name)}</span><i style="width:${x.allocation}%"></i><b>${x.allocation}%</b></div>`).join('')}</div>
    <button class="ghost" id="applySplit" style="margin-top:12px">Use these allocations</button><div class="err"></div></div>` : ''}
  <h2 class="sec2">Library</h2>
  <div class="libgrid">${tpls.map(t => `
    <div class="card lib">
      <div class="libhead"><h3>${H.esc(t.name)}</h3><span class="pill ${RISK[t.risk] || ''}">${H.esc(t.risk)} risk</span></div>
      <p class="mu tag">${H.esc(t.tagline)} · ${REB[t.rebalance]}</p>
      <p class="about">${H.esc(t.about)}</p>
      ${t.qc ? `<div class="qc"><div><span>Backtest, 5 years</span><b class="pos">${pc(t.qc.cagr5y, 0)}/yr</b></div><div><span>Worst drop</span><b class="neg">-${t.qc.maxdd}%</b></div><div><span>Live, last 3 months</span><b class="${t.qc.oos3m < 0 ? 'neg' : 'pos'}">${pc(t.qc.oos3m)}</b></div></div>
        <p class="mu" style="font-size:12px">${H.esc(t.qc.ref)} figures from QuantConnect as recorded in the sheet. ${t.qc.oos3m < 0 ? '<b>Live results so far are far below the backtest</b>, a common sign of over-fitting.' : ''}</p>` : '<p class="mu" style="font-size:12px">No QuantConnect figures in the sheet. Run the backtest to see how it behaved.</p>'}
      ${t.note ? `<p class="note">${H.esc(t.note)}</p>` : ''}
      <button data-use="${t.id}">Use this strategy</button><div class="err"></div>
    </div>`).join('')}</div>
  <p class="mu" style="font-size:12px">Backtests are hypothetical and leveraged ETFs can lose most of their value quickly. Results shown are not a promise of future returns.</p>`;
  H.$$('[data-use]', view).forEach(b => H.act(b, async () => { const s = await H.api('/library', { body: { templateId: b.dataset.use } }); location.hash = '#/strategy?id=' + s.id; return ''; }));
  if (H.$('#applySplit', view)) H.act(H.$('#applySplit', view), async () => { await H.api('/library/split/apply', { body: { items: mine.split } }); setTimeout(H.render, 800); return 'Allocations updated'; });
}
const rcPill = r => { const [t, c] = RC[r.status] || [r.status, '']; return `<span class="pill ${c}">${t}</span>${r.days ? ` <span class="mu" style="font-size:12px">${r.days}d · ${pc(r.cumReturn)}</span>` : ''}`; };

// ---------- one strategy ----------

async function detail(view, q) {
  const id = q.get('id');
  const [s, accts] = await Promise.all([H.api('/library/' + id), H.accounts()]);
  accName = a => H.acctLabel(accts.find(x => x.id === a) || { id: a, name: a });
  let spec = JSON.parse(JSON.stringify(s.spec)), overrides = {}, last = null;
  const paid = isPaid(H.me());
  view.innerHTML = `
  <div class="pagehead"><div><a href="#/strategies" class="mu">&larr; Strategies</a><h1 style="margin:4px 0 0">${H.esc(s.name)}</h1>
    <p class="mu" style="margin:4px 0 0">${H.esc(s.template?.tagline || '')} · ${REB[spec.rebalance] || ''}${spec.rebalance === 'weekly' ? ` (${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][spec.weekday]})` : ''}</p></div>
    <div class="seg" id="modeSeg"><button data-m="manual" class="${s.mode === 'manual' ? 'on' : ''}">By hand</button><button data-m="auto" class="${s.mode === 'auto' ? 'on' : ''}">Automatic</button></div></div>
  ${spec.note ? `<div class="banner">${H.esc(spec.note)}</div>` : ''}
  <div class="sgrid">
    <div>
      <div class="card" id="walk"><h2>Today's walkdown</h2><div class="skel"><div></div><div></div><div class="w60"></div></div></div>
      <div class="card" id="orders"><h2>Orders</h2><div class="mu">Loading…</div></div>
      <div class="card" id="bt"><h2>Backtest</h2><div class="row"><label>Years<select id="years"><option>3</option><option selected>5</option><option>8</option></select></label><button id="runBt" style="align-self:flex-end">Run backtest</button></div><div class="err"></div><div id="btOut"></div></div>
      <div class="card" id="rules"><h2>Edit rules</h2><p class="mu" style="margin-top:0">Change any number, indicator or ticker, then preview today's result or backtest before saving.</p><div id="ruleBody"></div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="ghost" id="preview" type="button">Preview today</button><button class="ghost" id="btDraft" type="button">Backtest these rules</button><button id="saveRules" type="button">Save rules</button>${s.templateId ? '<button class="ghost" id="resetRules" type="button">Back to original</button>' : ''}</div><div class="err"></div>
        <details style="margin-top:12px"><summary class="mu">Advanced: edit as JSON</summary><textarea id="json" rows="14"></textarea><button class="small ghost" id="applyJson" type="button">Apply JSON</button><div class="err"></div></details></div>
    </div>
    <div>
      <form class="card" id="settings"><h2>Settings</h2>
        <label>Name<input name="name" value="${H.esc(s.name)}" maxlength="60"></label>
        <label>Account<select name="account">${H.accountOptions(accts, s.account, paid)}</select></label>
        <div class="grid2"><label>Money for this strategy (% of account)<input name="allocation" type="number" min="1" max="100" value="${s.allocation}"></label>
        <label>Cash kept aside (%)<input name="cashBuffer" type="number" min="0" max="90" value="${s.cashBuffer}"></label></div>
        <div class="grid2"><label>Trailing stop (%)<input name="stopPct" type="number" min="1" max="50" step="any" placeholder="Off" value="${s.stopPct ?? ''}"></label>
        <label>Trade at (New York time)<input name="runAt" type="time" min="09:30" max="15:55" value="${String(Math.floor(s.runAt / 60)).padStart(2, '0')}:${String(s.runAt % 60).padStart(2, '0')}"></label></div>
        <label class="chk2"><input type="checkbox" name="wholeShares" ${s.wholeShares ? 'checked' : ''}> Whole shares only</label>
        <button>Save settings</button><div class="err"></div>
        <p class="mu" style="font-size:12px">Automatic mode trades on each rebalance day at this time, using today's prices as the close. The sheet's backtests had no stops except where noted; adding one changes the results.</p></form>
      <div class="card" id="reality"></div>
      <div class="card tablewrap"><h2>History</h2><table>${s.runs.map(r => `<tr><td class="mu" style="white-space:nowrap">${H.date(r.at)}</td><td><span class="pill ${r.kind === 'error' ? 'neg' : r.kind === 'stop' ? 'warn' : ''}">${H.esc(r.kind)}</span></td><td style="font-size:13px">${H.esc(r.summary)}</td></tr>`).join('') || '<tr><td class="mu">No runs yet.</td></tr>'}</table>
        <button class="small ghost danger-t" id="del" type="button" style="margin-top:10px">Delete strategy</button><div class="err"></div></div>
    </div>
  </div>`;

  // --- walkdown + orders ---
  async function refresh(draft) {
    const w = H.$('#walk', view);
    try { last = await H.api(`/library/${id}/walkdown`, { body: { overrides, ...(draft ? { spec } : {}) } }); }
    catch (e) { w.innerHTML = `<h2>Today's walkdown</h2><div class="err">${H.esc(e.message)}</div>`; return; }
    w.innerHTML = `<h2>Today's walkdown <span class="mu" style="font-weight:500;font-size:13px">${last.day}${last.rebalanceDay ? '' : ' · not a rebalance day'}${draft ? ' · preview of unsaved rules' : ''}</span></h2>
      <p class="mu" style="margin-top:0;font-size:13px">Values fill in from market data${last.source?.length ? ` (${H.esc(last.source.join(', '))})` : ''}. ${spec.kind === 'tree' ? 'Type your own number in any value box to override it, like the sheet\'s yellow cells.' : ''}</p>
      ${walkHtml(last)}
      ${Object.keys(last.failed || {}).length ? `<p class="err" style="font-size:13px">No data for: ${H.esc(Object.keys(last.failed).join(', '))}</p>` : ''}
      ${Object.keys(overrides).length ? '<button class="small ghost" id="clearOv" type="button">Clear typed values</button>' : ''}`;
    H.$$('input[data-k]', w).forEach(i => i.addEventListener('change', () => { if (i.value === '') delete overrides[i.dataset.k]; else overrides[i.dataset.k] = +i.value; refresh(draft); }));
    if (H.$('#clearOv', w)) H.$('#clearOv', w).onclick = () => { overrides = {}; refresh(draft); };
    H.$$('input[data-pred]', w).forEach(i => i.addEventListener('change', () => { spec.params.predictions[i.dataset.pred] = i.value === '' ? null : +i.value; refresh(true); }));
    ordersHtml();
  }
  function ordersHtml() {
    const o = H.$('#orders', view), c = last.capital || {};
    const act = last.orders.filter(x => x.action !== 'HOLD');
    o.innerHTML = `<h2>Orders</h2>
      ${c.error ? `<div class="err">${H.esc(c.error)}</div>` : `<p class="mu" style="margin-top:0;font-size:13px">${accName(s.account)} worth ${H.money(c.equity)} · this strategy trades ${H.money(c.investable)}${c.throttle < 1 ? ` <span class="pill warn">Reality Check throttle ${c.throttle * 100}%</span>` : ''}</p>`}
      <div class="tablewrap"><table><tr><th>Ticker</th><th>Weight</th><th>Target $</th><th>Price</th><th>Target shares</th><th>Held</th><th>Order</th><th>Stop</th></tr>
      ${last.orders.map(x => `<tr><td><b>${H.esc(x.ticker)}</b></td><td>${(x.weight * 100).toFixed(1)}%</td><td>${H.money(x.dollars)}</td><td>${f2(x.price)}</td><td>${x.shares}</td><td>${x.have}</td>
        <td><span class="pill ${x.action === 'BUY' ? 'pos' : x.action === 'SELL' ? 'neg' : ''}">${x.action}${x.delta ? ' ' + Math.abs(x.delta) : ''}</span></td><td class="mu">${last.stops[x.ticker] ? `${last.stops[x.ticker].stopPct}%` : '-'}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">No position today: stay in cash.</td></tr>'}</table></div>
      <p class="mu" style="font-size:12px">Stop column: suggested trailing stop ≈ 3.5 × the ticker's daily volatility (6%–35%), as in the sheet's STOP_LOSS tab.</p>
      <button id="exec" ${act.length && !c.error ? '' : 'disabled'}>Place ${act.length} order${act.length === 1 ? '' : 's'} now</button><div class="err"></div>`;
    H.act(H.$('#exec', o), async () => {
      if (!confirm(`Place ${act.length} order(s) in your ${accName(s.account)}?${s.account !== 'paper' ? ' These are real orders.' : ''}`)) return '';
      const r = await H.api(`/library/${id}/execute`, { body: { overrides } });
      setTimeout(H.render, 1500);
      return r.summary;
    });
  }
  function walkHtml(w) {
    if (spec.kind === 'tree') return w.sleeves.map(sl => `
      ${spec.sleeves.length > 1 ? `<h3 class="sleeve">${H.esc(sl.name)} <span class="mu">${Math.round(sl.weight * 100)}%</span></h3>` : ''}
      <div class="tablewrap"><table class="walk"><tr><th>#</th><th>Signal</th><th>Value</th><th>2nd value</th><th>Decision</th></tr>
      ${sl.path.map(p => `<tr class="${p.rebuilt ? 'rebuilt' : ''}"><td><b>${H.esc(p.id)}</b></td><td>${H.esc(p.label)}${p.rebuilt ? ' <span class="pill warn" title="Not spelled out in the sheet export">check</span>' : ''}<div class="mu" style="font-size:12px">${H.esc(p.rule || '')}</div></td>
        <td>${valBox(p, 'a')}</td><td>${valBox(p, 'b')}</td><td class="${p.next?.startsWith('@') ? 'pos' : ''}">${H.esc(p.decision)}</td></tr>
        ${p.votes ? p.votes.map(v => `<tr class="sub"><td></td><td class="mu" style="font-size:13px">${H.esc(v.label)}</td><td>${f2(v.va)}</td><td>${f2(v.vb)}</td><td>${v.ok ? '✅ 1 vote' : '❌ 0 votes'}</td></tr>`).join('') : ''}`).join('')}
      </table></div>
      <div class="result ${sl.ticker ? 'done' : 'wait'}">${sl.ticker ? `DONE → BUY <b>${H.esc(sl.ticker)}</b> (${Math.round(sl.weight * 100)}%)` : H.esc(sl.error || 'Needs a rule')}</div>`).join('');
    if (spec.kind === 'momentum') return `<p>Rebalance day: <b>${w.rebalanceDay ? 'yes' : 'no, keep the current stock'}</b>. Top ${spec.params.top} by ${spec.params.lookback}-day return:</p>
      <div class="tablewrap"><table><tr><th>Rank</th><th>Ticker</th><th>${spec.params.lookback}-day return</th></tr>${w.ranking.slice(0, 15).map((r, i) => `<tr class="${i < spec.params.top ? 'win' : ''}"><td>${i + 1}</td><td><b>${H.esc(r.ticker)}</b>${i < spec.params.top ? ' 🏆' : ''}</td><td class="${H.cls(r.score)}">${pc(r.score)}</td></tr>`).join('')}</table></div>`;
    if (spec.kind === 'pullback') {
      const c = w.candidates, n = k => c.filter(x => x.checks[k]).length;
      return `<div class="funnel">${[['Uptrend: close > SMA200', n('uptrend')], ['Below the lower band', n('belowBand')], [`RSI(${spec.params.rsiLen}) ≤ ${spec.params.rsiEntry}`, n('rsi')], [`Pullback ≥ ${spec.params.minPullback}%`, n('pullback')], ['All filters = buy signal', w.entries.length]]
        .map(([t, k]) => `<div class="bar"><span>${t}</span><i style="width:${c.length ? k / c.length * 100 : 0}%"></i><b>${k}/${c.length}</b></div>`).join('')}</div>
        <p style="margin-top:12px"><b>New buys:</b> ${w.buys.length ? w.buys.map(H.esc).join(', ') : 'none today'} · <b>Exits:</b> ${w.exits.length ? w.exits.map(x => `${H.esc(x.ticker)} (${H.esc(x.why)})`).join(', ') : 'none'} · <b>Keep:</b> ${w.keep.length ? w.keep.map(x => H.esc(x.ticker)).join(', ') : 'none'}</p>
        ${w.entries.length ? `<div class="tablewrap"><table><tr><th>Ticker</th><th>Z-score</th><th>RSI</th><th>Pullback</th><th>Close</th></tr>${w.entries.map(x => `<tr><td><b>${H.esc(x.ticker)}</b></td><td>${f2(x.z)}</td><td>${f2(x.rsi)}</td><td>${pc(x.pullback)}</td><td>${f2(x.close)}</td></tr>`).join('')}</table></div>` : ''}`;
    }
    if (spec.kind === 'macro') return `<p class="mu" style="margin-top:0">Predictions: <b>${spec.params.source === 'auto' ? `automatic (recent ${spec.params.proxyDays}-day return, scaled to 21 days)` : 'typed by you each month'}</b>. Only positive predictions get money; bitcoin is capped at ${spec.params.btcCap}%.</p>
      <div class="tablewrap"><table><tr><th>Asset</th><th>Predicted 21-day return %</th><th>Weight</th></tr>${spec.params.assets.map(t => `<tr><td><b>${H.esc(t)}</b></td>
        <td>${spec.params.source === 'auto' ? pc(w.predictions[t], 2) : `<input class="cell" type="number" step="any" data-pred="${H.esc(t)}" value="${w.predictions[t] ?? ''}">`}</td><td>${((w.weights[t] || 0) * 100).toFixed(1)}%</td></tr>`).join('')}</table></div>`;
    return '';
  }
  const valBox = (p, side) => {
    const st = findStep(p.id), m = st?.[side];
    if (!Array.isArray(m)) return side === 'b' && typeof m === 'number' ? `<span class="mu">${m}</span>` : '';
    const v = p['v' + side], k = mKey(m), typed = overrides[k] !== undefined;
    return `<input class="cell ${typed ? 'typed' : ''}" type="number" step="any" data-k="${H.esc(k)}" value="${typed ? overrides[k] : Number.isFinite(v) ? (+v).toFixed(2) : ''}" title="${H.esc(mLabel(m))}" aria-label="${H.esc(mLabel(m))}">`;
  };
  const findStep = id => { for (const sl of spec.sleeves || []) { const st = sl.steps.find(x => x.id === id); if (st) return st; } return null; };

  // --- rule editor ---
  function rulesHtml() {
    const body = H.$('#ruleBody', view);
    const mEdit = (path, m) => (typeof m === 'number' || m == null)
      ? `<input class="cell" type="number" step="any" data-path="${path}" data-num value="${m ?? ''}">`
      : `<span class="medit"><select data-path="${path}.0">${Object.entries(FN).map(([k, t]) => `<option value="${k}" ${m[0] === k ? 'selected' : ''}>${t}</option>`).join('')}</select><input data-path="${path}.1" value="${H.esc(m[1])}" size="6" aria-label="Ticker"><input data-path="${path}.2" type="number" value="${m[2]}" size="3" aria-label="Length" ${m[0] === 'close' ? 'hidden' : ''}></span>`;
    const tgt = (path, v) => `<input class="tgt" data-path="${path}" value="${H.esc(v ?? '')}" placeholder="step or @TICKER" size="9">`;
    if (spec.kind === 'tree') {
      body.innerHTML = spec.sleeves.map((sl, si) => `${spec.sleeves.length > 1 ? `<h3 class="sleeve">${H.esc(sl.name)} · weight <input class="cell" type="number" step="0.05" min="0" max="1" data-path="sleeves.${si}.weight" data-num value="${sl.weight}"></h3>` : ''}
        <div class="tablewrap"><table class="rules"><tr><th>#</th><th>Rule</th></tr>${sl.steps.map((st, i) => { const P = `sleeves.${si}.steps.${i}`; return `<tr class="${st.rebuilt ? 'rebuilt' : ''}"><td><b>${H.esc(st.id)}</b></td><td><div class="rl">${
          st.t === 'cmp' ? `If ${mEdit(P + '.a', st.a)} <select data-path="${P}.op">${['>', '<', '>=', '<='].map(o => `<option ${st.op === o ? 'selected' : ''}>${o}</option>`).join('')}</select> ${mEdit(P + '.b', st.b)} → ${tgt(P + '.yes', st.yes)} otherwise → ${tgt(P + '.no', st.no)}`
          : st.t === 'band' ? `${mEdit(P + '.a', st.a)} above <input class="cell" type="number" step="any" data-path="${P}.hi" data-num value="${st.hi ?? ''}" placeholder="off"> → ${tgt(P + '.hiTo', st.hiTo)} · below <input class="cell" type="number" step="any" data-path="${P}.lo" data-num value="${st.lo ?? ''}" placeholder="off"> → ${tgt(P + '.loTo', st.loTo)} · otherwise → ${tgt(P + '.mid', st.mid)}`
          : st.t === 'higher' ? `Higher of ${mEdit(P + '.a', st.a)} → ${tgt(P + '.aTo', st.aTo)} and ${mEdit(P + '.b', st.b)} → ${tgt(P + '.bTo', st.bTo)}`
          : st.t === 'vote' ? `${st.conds.map((c, ci) => `<span class="rl">${mEdit(`${P}.conds.${ci}.a`, c.a)} ${H.esc(c.op)} ${mEdit(`${P}.conds.${ci}.b`, c.b)}</span>`).join('')} At least <input class="cell" type="number" min="1" data-path="${P}.need" data-num value="${st.need}"> true → ${tgt(P + '.yes', st.yes)} otherwise → ${tgt(P + '.no', st.no)}`
          : `<span class="pill warn">Needs a rule</span> ${H.esc(st.label || '')} <button class="small ghost" type="button" data-fill="${P}">Turn into a comparison</button>`}</div></td></tr>`; }).join('')}</table></div>`).join('');
    } else {
      const p = spec.params, fld = (k, label, attrs = '') => `<label>${label}<input data-path="params.${k}" data-num type="number" step="any" value="${p[k] ?? ''}" ${attrs}></label>`;
      body.innerHTML = spec.kind === 'momentum' ? `<label>Stocks to rank (comma separated)<textarea data-path="params.universe" data-list rows="3">${H.esc(p.universe.join(', '))}</textarea></label><div class="grid2">${fld('lookback', 'Momentum lookback (days)')}${fld('top', 'Stocks to hold')}</div>`
        : spec.kind === 'pullback' ? `<label>Stocks to scan<textarea data-path="params.universe" data-list rows="3">${H.esc(p.universe.join(', '))}</textarea></label><div class="grid2">${fld('bbLen', 'Band length (days)')}${fld('bbMult', 'Band multiplier')}${fld('rsiLen', 'RSI length')}${fld('rsiEntry', 'Buy when RSI at or below')}${fld('minPullback', 'Minimum pullback from high (%)')}${fld('highLen', 'High lookback (days)')}${fld('maxPositions', 'Max positions')}${fld('maxHoldDays', 'Max holding days')}</div>`
        : `<label>Assets<input data-path="params.assets" data-list value="${H.esc(p.assets.join(', '))}"></label><div class="grid2"><label>Predictions<select data-path="params.source"><option value="manual" ${p.source === 'manual' ? 'selected' : ''}>I type them each month</option><option value="auto" ${p.source === 'auto' ? 'selected' : ''}>Automatic (recent return)</option></select></label>${fld('proxyDays', 'Automatic: lookback days')}${fld('btcCap', 'Bitcoin cap (%)')}${fld('maxTotal', 'Max total invested (%)')}</div><label>Bitcoin ticker<input data-path="params.btc" value="${H.esc(p.btc || '')}"></label>`;
      if (spec.rebalance === 'weekly') body.innerHTML += `<label>Rebalance day<select data-path="weekday" data-num>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<option value="${i + 1}" ${spec.weekday === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>`;
    }
    H.$$('[data-path]', body).forEach(el => el.addEventListener('change', () => {
      const keys = el.dataset.path.split('.'), last = keys.pop();
      let o = spec; for (const k of keys) o = o[k];
      let v = el.value;
      if ('num' in el.dataset) v = v === '' ? null : +v;
      else if ('list' in el.dataset) v = v.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
      else if (/\.(yes|no|hiTo|loTo|mid|aTo|bTo)$/.test(el.dataset.path)) v = v.trim() ? (v.trim().startsWith('@') ? '@' + v.trim().slice(1).toUpperCase() : v.trim()) : null;
      else if (/\.1$/.test(el.dataset.path) && Array.isArray(o)) v = v.trim().toUpperCase();
      else if (/\.2$/.test(el.dataset.path) && Array.isArray(o)) v = +v;
      o[last] = v;
      if (Array.isArray(o) && last === '0') { if (v === 'close') o[2] = 0; else if (!o[2]) o[2] = 10; rulesHtml(); }
      H.$('#json', view).value = JSON.stringify(spec, null, 2);
    }));
    H.$$('[data-fill]', body).forEach(b => (b.onclick = () => {
      const keys = b.dataset.fill.split('.'); let o = spec; for (const k of keys.slice(0, -1)) o = o[k];
      const st = o[keys[keys.length - 1]];
      o[keys[keys.length - 1]] = { id: st.id, t: 'cmp', label: st.label, a: st.a || ['close', 'SPY', 0], op: '>', b: st.b || ['sma', 'SPY', 200], yes: null, no: null };
      rulesHtml();
    }));
    H.$('#json', view).value = JSON.stringify(spec, null, 2);
  }
  rulesHtml();
  H.act(H.$('#preview', view), async () => { await refresh(true); H.$('#walk', view).scrollIntoView({ behavior: 'smooth' }); return 'Preview updated above'; });
  H.act(H.$('#saveRules', view), async () => { await H.api('/library/' + id, { method: 'PUT', body: { spec } }); await refresh(); return 'Rules saved'; });
  H.act(H.$('#btDraft', view), async () => { await runBacktest(true); H.$('#bt', view).scrollIntoView({ behavior: 'smooth' }); return 'Backtest below'; });
  if (H.$('#resetRules', view)) H.act(H.$('#resetRules', view), async () => { if (!confirm('Replace your rules with the original library rules?')) return ''; await H.api(`/library/${id}/reset`, { body: {} }); H.render(); return ''; });
  H.act(H.$('#applyJson', view), async () => { spec = JSON.parse(H.$('#json', view).value); rulesHtml(); await refresh(true); return 'Applied (not saved yet)'; });

  // --- backtest ---
  async function runBacktest(draft) {
    const out = H.$('#btOut', view);
    out.innerHTML = '<p class="mu">Running… (loading several years of prices for every ticker the rules use)</p>';
    try {
      const r = await H.api(`/library/${id}/backtest`, { body: { years: +H.$('#years', view).value, ...(draft ? { spec } : {}) } });
      out.innerHTML = `<div class="stats">
        <div class="stat"><span>Return per year</span><b class="${H.cls(r.m.cagr)}">${pc(r.m.cagr)}</b></div><div class="stat"><span>S&amp;P 500 per year</span><b>${pc(r.bh.cagr)}</b></div>
        <div class="stat"><span>Worst drop</span><b class="neg">-${r.m.dd.toFixed(1)}%</b></div><div class="stat"><span>Sharpe</span><b>${f2(r.m.sharpe)}</b></div>
        <div class="stat"><span>Total return</span><b class="${H.cls(r.m.ret)}">${pc(r.m.ret, 0)}</b></div><div class="stat"><span>Switches</span><b>${r.switches}</b></div></div>
        <canvas id="btChart"></canvas>
        <p class="mu" style="font-size:12px">${r.from} to ${r.to}${draft ? ' · unsaved rules' : ''}. Decides at each close, earns the next day's return, 0.05% cost per trade. Grey: S&amp;P 500 (SPY). Data: ${H.esc((r.sources || []).join(', '))}.${spec.kind === 'macro' ? ' Uses the automatic predictions (typed predictions cannot be replayed).' : ''}${Object.keys(r.failed || {}).length ? ` No data for ${H.esc(Object.keys(r.failed).join(', '))}.` : ''} Hypothetical results with hindsight.</p>
        ${s.template?.qc ? `<p class="note">QuantConnect reported ${pc(s.template.qc.cagr5y, 0)} a year for this strategy, and ${pc(s.template.qc.oos3m)} in the 3 months after. Compare those with this backtest before trusting either.</p>` : ''}`;
      H.drawChart(H.$('#btChart', out), r.curve, { base: 10000, compare: r.bhCurve });
      if (!draft) realityHtml(await H.api('/library/' + id).then(x => x.reality));
    } catch (e) { out.innerHTML = `<p class="err">${H.esc(e.message)}</p>`; }
  }
  H.$('#runBt', view).onclick = e => { e.preventDefault(); runBacktest(false); };

  // --- Reality Check ---
  function realityHtml(rc) {
    const [t, c] = RC[rc.status] || [rc.status, ''];
    H.$('#reality', view).innerHTML = `<h2>Reality Check <span class="pill ${c}">${t}</span></h2>
      <p style="margin-top:0">${H.esc(rc.why)}</p>
      <div class="stats"><div class="stat"><span>Live days</span><b>${rc.days}</b></div><div class="stat"><span>Live return</span><b class="${H.cls(rc.cumReturn)}">${pc(rc.cumReturn)}</b></div>
        ${rc.expectedReturn != null ? `<div class="stat"><span>Backtest expected</span><b>${pc(rc.expectedReturn)}</b></div>` : ''}<div class="stat"><span>Win rate</span><b>${rc.winRate == null ? '-' : rc.winRate.toFixed(0) + '%'}</b></div></div>
      <label class="chk2" style="margin-top:12px"><input type="checkbox" id="throttle" ${rc.throttle ? 'checked' : ''}> Auto-throttle: trade 50% while on Watch, 0% while Drifting</label>
      <p class="mu" style="font-size:12px">Every trading day the strategy's live result is compared with its backtest. If the two drift apart (a sign the backtest was over-fitted or the market changed), you get a text or email, and with auto-throttle on, the money it trades is cut automatically.</p>`;
    H.$('#throttle', view).onchange = async e => { await H.api('/library/' + id, { method: 'PUT', body: { throttle: e.target.checked } }); };
  }
  realityHtml(s.reality);

  // --- settings, mode, delete ---
  const st = H.$('#settings', view);
  H.act(H.$('button', st), async () => {
    const f = H.form(st), [hh, mm] = String(f.runAt || '15:45').split(':');
    await H.api('/library/' + id, { method: 'PUT', body: { ...f, runAt: +hh * 60 + +mm, stopPct: f.stopPct === '' ? null : +f.stopPct } });
    s.account = f.account;
    await refresh();
    return 'Saved';
  });
  H.$$('#modeSeg button', view).forEach(b => (b.onclick = async () => {
    try {
      if (b.dataset.m === 'auto' && !confirm(`Trade automatically in your ${accName(s.account)} on every rebalance day?`)) return;
      await H.api('/library/' + id, { method: 'PUT', body: { mode: b.dataset.m } });
      H.$$('#modeSeg button', view).forEach(x => x.classList.toggle('on', x === b));
    } catch (e) { alert(e.message); }
  }));
  H.act(H.$('#del', view), async () => { if (!confirm('Delete this strategy? Positions it bought stay in your account.')) return ''; await H.api('/library/' + id, { method: 'DELETE' }); location.hash = '#/strategies'; return ''; });
  await refresh();
}
const isPaid = u => u && ((u.role === 'admin' && !u.previewPlan) || (['pro', 'elite', 'ultimate'].includes(u.plan) && ['active', 'trialing', null, undefined].includes(u.planStatus)));
