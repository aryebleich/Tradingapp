// Strategy library: library, today's walkdown with typed-in values,
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
  const [tpls, mine, accts, plans, community] = await Promise.all([H.api('/library/templates'), H.api('/library'), H.accounts(), H.api('/library/plans'), H.api('/library/community').catch(() => [])]);
  accName = a => H.acctLabel(accts.find(x => x.id === a) || { id: a, name: a });
  const slotCount = t => (t.slots ? `${t.slots.filter(x => x.kind === 'lev').length} leveraged + ${t.slots.filter(x => x.kind === 'etf').length} ETF/stock tickers` : 'Your list of ETFs and stocks, and a list of leveraged ETFs');
  view.innerHTML = `
  <div class="pagehead"><h1>Strategy builder</h1><p class="mu" style="margin:4px 0 0">Build your own strategies. Start from a design (or from one rule), choose your own tickers, and change every rule and number. Then follow it by hand, approve each trade, or let it run.</p></div>
  ${mine.strategies.length ? `<div class="card tablewrap"><h2>My strategies</h2><table><tr><th>Name</th><th>Status</th><th>Runs</th><th>Account</th><th>Money</th><th>Last result</th><th>Reality Check</th><th></th></tr>
    ${mine.strategies.map(s => `<tr><td><a href="#/strategy?id=${s.id}"><b>${H.esc(s.name)}</b></a>${s.public ? ' <span class="pill">Public</span>' : ''}</td><td>${s.ready ? '<span class="pill pos">Ready</span>' : `<span class="pill warn" title="${H.esc((s.missing || []).join(', '))}">Needs tickers</span>`}</td><td>${s.mode === 'auto' ? '<span class="pill pos">Automatic</span>' : s.mode === 'approve' ? '<span class="pill">You approve</span>' : '<span class="pill">By hand</span>'}</td><td>${accName(s.account)}</td><td>${s.allocation}%</td>
      <td class="mu" style="font-size:13px">${s.lastResult ? H.esc(s.lastResult.summary) : 'Not run yet'}</td><td>${rcPill(s.reality)}</td><td><a href="#/strategy?id=${s.id}"><button class="small ghost" type="button">Open</button></a></td></tr>`).join('')}</table>
    <p class="mu" style="font-size:12px;margin-bottom:0">${mine.strategies.length} of ${mine.limits.saved} saved · ${mine.strategies.filter(s => s.mode !== 'manual').length} of ${mine.limits.auto} automatic or approve-each-trade</p></div>` : ''}
  ${mine.strategies.length > 1 ? `<div class="card"><h2>Portfolio split <span class="mu" style="font-weight:500;font-size:14px">win-rate weighted, 10%–70% each</span></h2>
    <p class="mu" style="margin-top:0">Strategies that win more often get more money. Win rates come from each strategy's live daily results.</p>
    <div class="funnel">${mine.split.map(x => `<div class="bar"><span>${H.esc(x.name)}</span><i style="width:${x.allocation}%"></i><b>${x.allocation}%</b></div>`).join('')}</div>
    <button class="ghost" id="applySplit" style="margin-top:12px">Use these allocations</button><div class="err"></div></div>` : ''}
  <h2 class="sec2">Start a new strategy</h2>
  <p class="mu" style="margin-top:-6px">Each design is a set of rules with empty ticker slots. You choose the tickers (leveraged ETFs and ordinary ETFs or stocks are asked separately), then adjust any indicator, number or step.</p>
  <div class="libgrid">${tpls.map(t => `
    <div class="card lib">
      <div class="libhead"><h3>${H.esc(t.name)}</h3><span class="pill ${RISK[t.risk] || ''}">${H.esc(t.risk)} risk</span></div>
      <p class="mu tag">${H.esc(t.tagline)} · ${REB[t.rebalance]}</p>
      <p class="about">${H.esc(t.about)}</p>
      <p class="mu" style="font-size:13px">${t.kind === 'tree' ? `${t.sleeves} sleeve${t.sleeves === 1 ? '' : 's'} · ${t.steps} step${t.steps === 1 ? '' : 's'} · ` : ''}${slotCount(t)}</p>
      <label style="margin:6px 0">Name<input data-name="${t.id}" value="${H.esc(t.id === 'bp_blank' ? 'My strategy' : t.name)}" maxlength="60"></label>
      <button data-use="${t.id}">Start with this design</button><div class="err"></div>
    </div>`).join('')}</div>
  <div class="card"><h2>Community strategies</h2><p class="mu" style="margin-top:0">Strategies other people chose to publish: their rules and tickers (never their account or money). Copy one, then make it your own.</p>
    ${community.length ? `<div class="tablewrap"><table><tr><th>Name</th><th>By</th><th>Tickers</th><th>Backtest</th><th></th></tr>${community.map(c => `<tr><td><b>${H.esc(c.name)}</b>${c.notes ? `<div class="mu" style="font-size:12px;max-width:360px">${H.esc(c.notes)}</div>` : ''}</td><td class="mu">${H.esc(c.by)}${c.mine ? ' (you)' : ''}</td><td data-no-tr style="font-size:13px">${H.esc(c.tickers.join(', '))}</td>
      <td>${c.backtest ? `${pc(c.backtest.cagr)}/yr · worst ${pc(-c.backtest.dd)} <span class="mu">(${c.backtest.years}y)</span>` : '<span class="mu">-</span>'}</td><td>${c.mine ? '' : `<button class="small ghost" data-copy="${c.id}">Copy</button>`}</td></tr>`).join('')}</table></div>` : '<p class="mu">Nothing published yet. Publish one of yours from its Settings.</p>'}<div class="err"></div></div>
  <details class="card"><summary><b>What each plan includes</b> <span class="mu">(you are on ${H.esc(plans.plans.find(p => p.id === plans.current)?.label || plans.current)})</span></summary>
    <div class="tablewrap"><table><tr><th></th>${plans.plans.map(p => `<th class="${p.id === plans.current ? 'pos' : ''}">${H.esc(p.label)}</th>`).join('')}</tr>${plans.rows.map(r => `<tr><td>${H.esc(r[0])}</td>${r.slice(1).map((v, i) => `<td class="${plans.plans[i].id === plans.current ? 'on' : ''}">${H.esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>
    ${plans.current !== 'ultimate' ? '<a href="#/funding"><button class="small ghost" type="button">See plans</button></a>' : ''}</details>
  <p class="mu" style="font-size:12px">Backtests are hypothetical and leveraged ETFs can lose most of their value quickly. Results shown are not a promise of future returns.</p>`;
  H.$$('[data-use]', view).forEach(b => H.act(b, async () => { const name = H.$(`[data-name="${b.dataset.use}"]`, view)?.value; const s = await H.api('/library', { body: { blueprintId: b.dataset.use, name } }); location.hash = '#/strategy?id=' + s.id; return ''; }));
  H.$$('[data-copy]', view).forEach(b => H.act(b, async () => { const s = await H.api(`/library/community/${b.dataset.copy}/copy`, { body: {} }); location.hash = '#/strategy?id=' + s.id; return ''; }));
  if (H.$('#applySplit', view)) H.act(H.$('#applySplit', view), async () => { await H.api('/library/split/apply', { body: { items: mine.split } }); setTimeout(H.render, 800); return 'Allocations updated'; });
}
const rcPill = r => { const [t, c] = RC[r.status] || [r.status, '']; return `<span class="pill ${c}">${t}</span>${r.days ? ` <span class="mu" style="font-size:12px">${r.days}d · ${pc(r.cumReturn)}</span>` : ''}`; };

// ---------- one strategy ----------

async function detail(view, q) {
  const id = q.get('id');
  const [s, accts] = await Promise.all([H.api('/library/' + id), H.accounts()]);
  accName = a => H.acctLabel(accts.find(x => x.id === a) || { id: a, name: a });
  // The rules you edit (with your ticker slots); the engine runs them once every slot has a ticker.
  let spec = JSON.parse(JSON.stringify(s.design || s.spec)), overrides = {}, last = null;
  const paid = isPaid(H.me()), lim = s.limits || {};
  const margin = await H.api('/library/margin?account=' + encodeURIComponent(s.account)).catch(() => ({ allowed: 1, why: '' }));
  const tick = t => { const m = /^\$([LE]\d+)$/.exec(t || ''); return m ? spec.slots?.[m[1]]?.ticker || t : t; };
  const real = m => (Array.isArray(m) ? [m[0], tick(m[1]), m[2]] : m);
  view.innerHTML = `
  <div class="pagehead"><div><a href="#/strategies" class="mu">&larr; Strategies</a><h1 style="margin:4px 0 0">${H.esc(s.name)}</h1>
    <p class="mu" style="margin:4px 0 0">${H.esc(s.template?.tagline || '')} · ${REB[spec.rebalance] || ''}${spec.rebalance === 'weekly' ? ` (${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][spec.weekday]})` : ''}</p></div>
    <div class="seg" id="modeSeg"><button data-m="manual" class="${s.mode === 'manual' ? 'on' : ''}">By hand</button><button data-m="approve" class="${s.mode === 'approve' ? 'on' : ''}">Approve each trade</button><button data-m="auto" class="${s.mode === 'auto' ? 'on' : ''}">Automatic</button></div></div>
    ${s.autoRealAllowed ? '' : `<p class="banner" style="font-size:13px">${s.account !== 'paper' && s.mode === 'auto' ? '<b>On this real account, each rebalance waits for your approval.</b> ' : ''}Ready-made strategies run automatically on the paper account. On a real account choose <b>Approve each trade</b>: on every rebalance day Brightfolio works out the orders, tells you by text or email, and you approve them with one tap (or follow it by hand).</p>`}
  ${s.state?.pending ? `<div class="card approvebox" id="pending"><h2>Waiting for your approval</h2><p class="mu" style="margin-top:0">Prepared ${H.date(s.state.pending.at)} for ${accName(s.account)}. Approving places these orders now, at current prices. They expire at the close.</p>
    <ul class="cal-list">${s.state.pending.orders.map(o => `<li><b>${o.side.toUpperCase()}</b> ${o.qty} <b data-no-tr>${H.esc(o.ticker)}</b>${o.price ? ` <span class="mu">about ${H.money(o.price)}</span>` : ''}</li>`).join('')}</ul>
    <div class="row" style="gap:8px"><button id="approveGo">Approve and place orders</button><button class="ghost" id="approveSkip" type="button">Skip today</button></div><div class="err"></div></div>` : ''}
  ${spec.note ? `<div class="banner">${H.esc(spec.note)}</div>` : ''}
  ${tickersCard()}
  <div class="sgrid">
    <div>
      <div class="card" id="walk"><h2>Today's walkdown</h2><div class="skel"><div></div><div></div><div class="w60"></div></div></div>
      <div class="card" id="orders"><h2>Orders</h2><div class="mu">Loading…</div></div>
      <div class="card" id="bt"><h2>Backtest</h2><div class="row"><label>Years<select id="years">${[1, 3, 5, 8, 10].map(y => `<option value="${y}" ${y > (lim.backtestYears || 10) ? 'disabled' : ''} ${y === Math.min(5, lim.backtestYears || 5) ? 'selected' : ''}>${y}${y > (lim.backtestYears || 10) ? ' (upgrade)' : ''}</option>`).join('')}</select></label><button id="runBt" style="align-self:flex-end">Run backtest</button></div><div class="err"></div><div id="btOut"></div></div>
      <div class="card" id="rules"><h2>Edit rules</h2><p class="mu" style="margin-top:0">Change any number with − and + (or type it), any indicator, ticker or target. Add, remove or change steps. In a rule, <b data-no-tr>$L1</b> means your leveraged ticker 1 and <b data-no-tr>@$E2</b> means "buy your ETF/stock ticker 2"; you can also type any ticker. Preview or backtest before saving.</p><div id="ruleBody"></div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="ghost" id="preview" type="button">Preview today</button><button class="ghost" id="btDraft" type="button">Backtest these rules</button><button id="saveRules" type="button">Save rules</button>${s.templateId ? '<button class="ghost" id="resetRules" type="button">Back to the design\'s rules</button>' : ''}</div><div class="err"></div>
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
        <label>Margin<select name="leverage">${[1, 1.25, 1.5, 2].map(x => `<option value="${x}" ${x === (s.leverage || 1) ? 'selected' : ''} ${x > margin.allowed && x !== (s.leverage || 1) ? 'disabled' : ''}>${x === 1 ? 'No margin (1x)' : `${x}x`}${x > margin.allowed ? (x > (margin.planMax || 1) ? ' (upgrade)' : ' (not on this account)') : ''}</option>`).join('')}</select></label>
        <p class="mu" style="font-size:12px;margin-top:-4px">${H.esc(margin.why || '')} Margin borrows money: gains and losses grow, and you pay interest.</p>
        <label class="chk2"><input type="checkbox" name="public" ${s.public ? 'checked' : ''} ${lim.publish ? '' : 'disabled'}> Publish to the community${lim.publish ? '' : ' (Pro plan)'}</label>
        <label>Description for others (optional)<textarea name="notes" rows="2" maxlength="1000">${H.esc(s.notes || '')}</textarea></label>
        <p class="mu" style="font-size:12px;margin-top:-4px">Publishing shows the name, description, rules and tickers. Never your account, money or results in your account.</p>
        <button>Save settings</button><div class="err"></div>
        <p class="mu" style="font-size:12px">Automatic mode trades on each rebalance day at this time, using today's prices as the close. The recorded backtests had no stops except where noted; adding one changes the results.</p></form>
      <div class="card" id="reality"></div>
      <div class="card tablewrap"><h2>History</h2><table>${s.runs.map(r => `<tr><td class="mu" style="white-space:nowrap">${H.date(r.at)}</td><td><span class="pill ${r.kind === 'error' ? 'neg' : r.kind === 'stop' ? 'warn' : ''}">${H.esc(r.kind)}</span></td><td style="font-size:13px">${H.esc(r.summary)}</td></tr>`).join('') || '<tr><td class="mu">No runs yet.</td></tr>'}</table>
        <button class="small ghost danger-t" id="del" type="button" style="margin-top:10px">Delete strategy</button><div class="err"></div></div>
    </div>
  </div>`;

  // --- walkdown + orders ---
  async function refresh(draft) {
    const w = H.$('#walk', view);
    if (!s.ready && !draft) {
      w.innerHTML = `<h2>Today's walkdown</h2><p class="banner">Choose your tickers above to see today's result: ${H.esc((s.missing || []).join(', '))}.</p>`;
      H.$('#orders', view).innerHTML = '<h2>Orders</h2><p class="mu">Orders appear once every ticker is chosen.</p>';
      return;
    }
    try { last = await H.api(`/library/${id}/walkdown`, { body: { overrides, ...(draft ? { spec } : {}) } }); }
    catch (e) { w.innerHTML = `<h2>Today's walkdown</h2><div class="err">${H.esc(e.message)}</div>`; return; }
    w.innerHTML = `<h2>Today's walkdown <span class="mu" style="font-weight:500;font-size:13px">${last.day}${last.rebalanceDay ? '' : ' · not a rebalance day'}${draft ? ' · preview of unsaved rules' : ''}</span></h2>
      <p class="mu" style="margin-top:0;font-size:13px">Values fill in from market data${last.source?.length ? ` (${H.esc(last.source.join(', '))})` : ''}. ${spec.kind === 'tree' ? 'Type your own number in any value box to override it.' : ''}</p>
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
      <p class="mu" style="font-size:12px">Stop column: suggested trailing stop ≈ 3.5 × the ticker's daily volatility (6%–35%).</p>
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
      ${sl.path.map(p => `<tr class="${p.rebuilt ? 'rebuilt' : ''}"><td><b>${H.esc(p.id)}</b></td><td>${H.esc(p.label)}${p.rebuilt ? ' <span class="pill warn" title="Not spelled out in the original rules">check</span>' : ''}<div class="mu" style="font-size:12px">${H.esc(p.rule || '')}</div></td>
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
    const v = p['v' + side], k = mKey(real(m)), typed = overrides[k] !== undefined;
    return `<input class="cell ${typed ? 'typed' : ''}" type="number" step="any" data-k="${H.esc(k)}" value="${typed ? overrides[k] : Number.isFinite(v) ? (+v).toFixed(2) : ''}" title="${H.esc(mLabel(real(m)))}" aria-label="${H.esc(mLabel(real(m)))}">`;
  };
  const findStep = id => { for (const sl of spec.sleeves || []) { const st = sl.steps.find(x => x.id === id); if (st) return st; } return null; };

  // --- your tickers ---
  function tickersCard() {
    if (spec.slots) {
      const row = ([k, v]) => `<label class="slotrow"><span><b data-no-tr>${k}</b> · ${H.esc(v.role || 'Your ticker')}</span><input data-slot="${k}" value="${H.esc(v.ticker || '')}" placeholder="${v.example ? 'e.g. ' + H.esc(v.example) : 'Ticker'}" dir="ltr" autocomplete="off"></label>`;
      const ents = Object.entries(spec.slots);
      return `<div class="card" id="tickers"><h2>Your tickers ${s.ready ? '<span class="pill pos">Ready</span>' : '<span class="pill warn">Choose them to start</span>'}</h2>
        <p class="mu" style="margin-top:0">Each slot is used by the rules below. Put a ticker in each one: leveraged ETFs (2x, 3x, inverse or volatility funds) on the left, ordinary ETFs and stocks on the right. The grey text is the kind of ticker the design was made for.</p>
        <div class="grid2"><div><h3>Leveraged ETFs</h3>${ents.filter(([, v]) => v.kind === 'lev').map(row).join('') || '<p class="mu">None in this design.</p>'}<button type="button" class="small ghost" data-addslot="L">+ Add a leveraged slot</button></div>
          <div><h3>ETFs and stocks</h3>${ents.filter(([, v]) => v.kind !== 'lev').map(row).join('') || '<p class="mu">None in this design.</p>'}<button type="button" class="small ghost" data-addslot="E">+ Add an ETF / stock slot</button></div></div>
        <div class="row" style="gap:8px;margin-top:10px"><button id="saveTk" type="button">Save tickers</button><button class="ghost" id="exTk" type="button">Fill the empty ones with the examples</button></div><div class="err"></div></div>`;
    }
    if (spec.lists) return `<div class="card" id="tickers"><h2>Your tickers ${s.ready ? '<span class="pill pos">Ready</span>' : '<span class="pill warn">Choose them to start</span>'}</h2>
      <p class="mu" style="margin-top:0">${spec.kind === 'macro' ? 'The assets this strategy weighs.' : 'The tickers this strategy scans.'} Put ordinary ETFs and stocks in one box and leveraged ETFs in the other (comma or space separated).</p>
      <div class="grid2"><label>ETFs and stocks<textarea data-list="etf" rows="3" dir="ltr" placeholder="${H.esc((spec.examples?.etf || []).slice(0, 8).join(', '))}">${H.esc((spec.lists.etf || []).join(', '))}</textarea></label>
        <label>Leveraged ETFs<textarea data-list="lev" rows="3" dir="ltr" placeholder="${H.esc((spec.examples?.lev || []).slice(0, 8).join(', ') || 'e.g. TQQQ, SOXL')}">${H.esc((spec.lists.lev || []).join(', '))}</textarea></label></div>
      ${spec.kind === 'macro' ? `<label>Asset to cap (optional, e.g. a bitcoin fund)<input data-btc value="${H.esc(spec.params.btc || '')}" placeholder="${H.esc(spec.examples?.btc || '')}" dir="ltr"></label>` : ''}
      <div class="row" style="gap:8px;margin-top:10px"><button id="saveTk" type="button">Save tickers</button><button class="ghost" id="exTk" type="button">Fill with the examples</button></div><div class="err"></div></div>`;
    return '';
  }
  function wireTickers() {
    const card = H.$('#tickers', view); if (!card) return;
    const read = () => {
      H.$$('[data-slot]', card).forEach(i => { spec.slots[i.dataset.slot].ticker = i.value.trim().toUpperCase(); });
      H.$$('[data-list]', card).forEach(t => { spec.lists[t.dataset.list] = t.value.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean); });
      const b = H.$('[data-btc]', card); if (b) spec.params.btc = b.value.trim().toUpperCase();
    };
    H.act(H.$('#saveTk', card), async () => { read(); await H.api('/library/' + id, { method: 'PUT', body: { spec } }); setTimeout(H.render, 400); return 'Tickers saved'; });
    H.$('#exTk', card).onclick = () => {
      H.$$('[data-slot]', card).forEach(i => { if (!i.value) i.value = spec.slots[i.dataset.slot].example || ''; });
      H.$$('[data-list]', card).forEach(t => { if (!t.value) t.value = (spec.examples?.[t.dataset.list] || []).join(', '); });
      const b = H.$('[data-btc]', card); if (b && !b.value) b.value = spec.examples?.btc || '';
      if (spec.kind === 'macro' && spec.examples?.predictions) spec.params.predictions = { ...spec.examples.predictions, ...(spec.params.predictions || {}) };
    };
    H.$$('[data-addslot]', card).forEach(b => (b.onclick = () => {
      read();
      const kind = b.dataset.addslot; let n = 1; while (spec.slots[kind + n]) n++;
      spec.slots[kind + n] = { kind: kind === 'L' ? 'lev' : 'etf', role: 'Your ticker (use $' + kind + n + ' in a rule)', example: '', ticker: '' };
      card.outerHTML = tickersCard(); wireTickers(); rulesHtml();
    }));
  }

  // --- rule editor ---
  const slotOpts = () => Object.entries(spec.slots || {}).map(([k, v]) => `<option value="$${k}">${H.esc(v.ticker || v.role || k)}</option>`).join('');
  const stepIds = () => (spec.sleeves || []).flatMap(sl => sl.steps.map(st => st.id));
  function rulesHtml() {
    const body = H.$('#ruleBody', view);
    // A number with − and + (lengths and levels move by 1, weights by 0.05).
    const numIn = (path, v, { step = 1, ph = '' } = {}) => `<span class="stepper"><button type="button" class="stp" data-dir="-1" aria-label="Down ${step}">−</button><input class="cell" type="number" step="any" data-step="${step}" data-path="${path}" data-num value="${v ?? ''}" placeholder="${ph}"><button type="button" class="stp" data-dir="1" aria-label="Up ${step}">+</button></span>`;
    const mEdit = (path, m) => (typeof m === 'number' || m == null)
      ? `${numIn(path, m)} <button type="button" class="small ghost" data-toind="${path}" title="Compare with an indicator instead of a number">ƒ</button>`
      : `<span class="medit"><select data-path="${path}.0">${Object.entries(FN).map(([k, t]) => `<option value="${k}" ${m[0] === k ? 'selected' : ''}>${t}</option>`).join('')}</select><input data-path="${path}.1" value="${H.esc(m[1])}" size="6" list="slotList" aria-label="Ticker" dir="ltr">${m[0] === 'close' ? '' : numIn(path + '.2', m[2])}</span>${path.endsWith('.b') ? ` <button type="button" class="small ghost" data-tonum="${path}" title="Compare with a number instead">#</button>` : ''}`;
    const tgt = (path, v) => `<input class="tgt" data-path="${path}" value="${H.esc(v ?? '')}" placeholder="step or @$E1" size="9" list="tgtList" dir="ltr">`;
    const opSel = (path, op) => `<select data-path="${path}">${['>', '<', '>=', '<='].map(o => `<option ${op === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    const typeSel = (P, t) => `<select data-type="${P}" aria-label="Step type">${[['cmp', 'If … then'], ['band', 'Above / below levels'], ['higher', 'Pick the higher'], ['vote', 'Vote'], ['missing', 'To do']].map(([k, n]) => `<option value="${k}" ${t === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const lists = `<datalist id="slotList">${slotOpts()}</datalist><datalist id="tgtList">${stepIds().map(x => `<option value="${H.esc(x)}">Step ${H.esc(x)}</option>`).join('')}${Object.entries(spec.slots || {}).map(([k, v]) => `<option value="@$${k}">Buy ${H.esc(v.ticker || k)}</option>`).join('')}</datalist>`;
    if (spec.kind === 'tree') {
      body.innerHTML = lists + spec.sleeves.map((sl, si) => `<div class="sleevebox"><h3 class="sleeve"><input data-path="sleeves.${si}.name" value="${H.esc(sl.name)}" size="18" aria-label="Sleeve name"> · weight ${numIn(`sleeves.${si}.weight`, sl.weight, { step: 0.05 })} ${spec.sleeves.length > 1 ? `<button type="button" class="small ghost" data-delsleeve="${si}">Remove sleeve</button>` : ''}</h3>
        <div class="tablewrap"><table class="rules"><tr><th>#</th><th>Rule</th><th></th></tr>${sl.steps.map((st, i) => { const P = `sleeves.${si}.steps.${i}`; return `<tr class="${st.rebuilt ? 'rebuilt' : ''}"><td><b>${H.esc(st.id)}</b><br>${typeSel(P, st.t)}</td><td><div class="rl">${
          st.t === 'cmp' ? `If ${mEdit(P + '.a', st.a)} ${opSel(P + '.op', st.op)} ${mEdit(P + '.b', st.b)} → ${tgt(P + '.yes', st.yes)} otherwise → ${tgt(P + '.no', st.no)}`
          : st.t === 'band' ? `${mEdit(P + '.a', st.a)} above ${numIn(P + '.hi', st.hi, { ph: 'off' })} → ${tgt(P + '.hiTo', st.hiTo)} · below ${numIn(P + '.lo', st.lo, { ph: 'off' })} → ${tgt(P + '.loTo', st.loTo)} · otherwise → ${tgt(P + '.mid', st.mid)}`
          : st.t === 'higher' ? `Higher of ${mEdit(P + '.a', st.a)} → ${tgt(P + '.aTo', st.aTo)} and ${mEdit(P + '.b', st.b)} → ${tgt(P + '.bTo', st.bTo)}`
          : st.t === 'vote' ? `${st.conds.map((c, ci) => `<span class="rl">${mEdit(`${P}.conds.${ci}.a`, c.a)} ${opSel(`${P}.conds.${ci}.op`, c.op)} ${mEdit(`${P}.conds.${ci}.b`, c.b)} <button type="button" class="small ghost" data-delcond="${P}.${ci}" aria-label="Remove condition">×</button></span>`).join('')} <button type="button" class="small ghost" data-addcond="${P}">+ condition</button> At least ${numIn(P + '.need', st.need)} true → ${tgt(P + '.yes', st.yes)} otherwise → ${tgt(P + '.no', st.no)}`
          : `<span class="pill warn">Needs a rule</span> ${H.esc(st.label || '')}`}</div></td><td><button type="button" class="small ghost" data-delstep="${si}.${i}" aria-label="Remove step ${H.esc(st.id)}">×</button></td></tr>`; }).join('')}</table></div>
        <button type="button" class="small ghost" data-addstep="${si}">+ Add a step</button></div>`).join('') + '<button type="button" class="small ghost" id="addSleeve" style="margin-top:10px">+ Add a sleeve (a separate model with its own share of the money)</button>';
    } else {
      const p = spec.params, fld = (k, label, step = 1) => `<label>${label}${numIn('params.' + k, p[k], { step })}</label>`;
      body.innerHTML = spec.kind === 'momentum' ? `<p class="mu">The stocks to rank are your tickers above.</p><div class="grid2">${fld('lookback', 'Momentum lookback (days)')}${fld('top', 'Stocks to hold')}</div>`
        : spec.kind === 'pullback' ? `<p class="mu">The stocks to scan are your tickers above.</p><div class="grid2">${fld('bbLen', 'Band length (days)')}${fld('bbMult', 'Band multiplier', 0.05)}${fld('rsiLen', 'RSI length')}${fld('rsiEntry', 'Buy when RSI at or below')}${fld('minPullback', 'Minimum pullback from high (%)', 0.5)}${fld('highLen', 'High lookback (days)')}${fld('maxPositions', 'Max positions')}${fld('maxHoldDays', 'Max holding days')}</div>`
        : `<p class="mu">The assets are your tickers above.</p><div class="grid2"><label>Predictions<select data-path="params.source"><option value="manual" ${p.source === 'manual' ? 'selected' : ''}>I type them each month</option><option value="auto" ${p.source === 'auto' ? 'selected' : ''}>Automatic (recent return)</option></select></label>${fld('proxyDays', 'Automatic: lookback days')}${fld('btcCap', 'Cap on the capped asset (%)')}${fld('maxTotal', 'Max total invested (%)', 5)}</div>`;
      if (spec.rebalance === 'weekly') body.innerHTML += `<label>Rebalance day<select data-path="weekday" data-num>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<option value="${i + 1}" ${spec.weekday === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>`;
    }
    body.innerHTML += `<label style="margin-top:10px">Rebalance<select data-path="rebalance">${[['daily', 'Every trading day'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([k, n]) => `<option value="${k}" ${spec.rebalance === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
    const at = path => { const keys = path.split('.'); let o = spec; for (const k of keys.slice(0, -1)) o = o[k]; return [o, keys[keys.length - 1]]; };
    const sync = () => { H.$('#json', view).value = JSON.stringify(spec, null, 2); };
    H.$$('[data-path]', body).forEach(el => el.addEventListener('change', () => {
      const [o, last] = at(el.dataset.path);
      let v = el.value;
      if ('num' in el.dataset) v = v === '' ? null : +v;
      else if (/\.(yes|no|hiTo|loTo|mid|aTo|bTo)$/.test(el.dataset.path)) v = v.trim() ? (v.trim().startsWith('@') ? '@' + v.trim().slice(1).toUpperCase() : v.trim()) : null;
      else if (/\.1$/.test(el.dataset.path) && Array.isArray(o)) v = v.trim().toUpperCase();
      o[last] = v;
      if (Array.isArray(o) && last === '0') { if (v === 'close') o[2] = 0; else if (!o[2]) o[2] = 10; rulesHtml(); }
      if (el.dataset.path === 'rebalance' && v === 'weekly' && !spec.weekday) spec.weekday = 3;
      sync();
    }));
    // − / +: one step at a time (RSI 10 → 11 or 9).
    H.$$('.stp', body).forEach(b => (b.onclick = () => {
      const i = b.parentElement.querySelector('input'), st = +i.dataset.step || 1;
      const cur = i.value === '' ? 0 : +i.value, nv = +(cur + st * +b.dataset.dir).toFixed(4);
      i.value = /\.2$/.test(i.dataset.path) || i.dataset.path.endsWith('.need') ? Math.max(1, Math.round(nv)) : nv;
      i.dispatchEvent(new Event('change'));
    }));
    H.$$('[data-type]', body).forEach(sel => (sel.onchange = () => {
      const [o, k] = at(sel.dataset.type), old = o[k], a = old.a || ['close', Object.keys(spec.slots || {})[0] ? '$' + Object.keys(spec.slots)[0] : 'SPY', 0];
      const base = { id: old.id, t: sel.value, ...(old.label ? { label: old.label } : {}) };
      o[k] = sel.value === 'cmp' ? { ...base, a, op: '>', b: old.b || ['sma', a[1], 200], yes: old.yes || old.hiTo || null, no: old.no || old.mid || null }
        : sel.value === 'band' ? { ...base, a: Array.isArray(a) && a[0] === 'rsi' ? a : ['rsi', a[1], 10], hi: 79, hiTo: old.yes || null, lo: null, loTo: null, mid: old.no || null }
        : sel.value === 'higher' ? { ...base, a, b: old.b && Array.isArray(old.b) ? old.b : ['rsi', a[1], 10], aTo: old.yes || null, bTo: old.no || null }
        : sel.value === 'vote' ? { ...base, conds: [{ a, op: '>', b: ['sma', a[1], 200] }], need: 1, yes: old.yes || null, no: old.no || null }
        : { ...base, a: old.a, b: old.b };
      rulesHtml(); sync();
    }));
    H.$$('[data-toind]', body).forEach(b => (b.onclick = () => { const [o, k] = at(b.dataset.toind); o[k] = ['sma', Object.keys(spec.slots || {})[0] ? '$' + Object.keys(spec.slots)[0] : 'SPY', 50]; rulesHtml(); sync(); }));
    H.$$('[data-tonum]', body).forEach(b => (b.onclick = () => { const [o, k] = at(b.dataset.tonum); o[k] = 0; rulesHtml(); sync(); }));
    H.$$('[data-addcond]', body).forEach(b => (b.onclick = () => { const [o, k] = at(b.dataset.addcond); const st = o[k]; st.conds.push({ ...JSON.parse(JSON.stringify(st.conds[0] || { a: ['close', 'SPY', 0], op: '>', b: ['sma', 'SPY', 200] })) }); rulesHtml(); sync(); }));
    H.$$('[data-delcond]', body).forEach(b => (b.onclick = () => { const parts = b.dataset.delcond.split('.'), ci = +parts.pop(); const [o, k] = at(parts.join('.')); o[k].conds.splice(ci, 1); rulesHtml(); sync(); }));
    H.$$('[data-addstep]', body).forEach(b => (b.onclick = () => {
      const sl = spec.sleeves[+b.dataset.addstep], ids = new Set(stepIds()); let n = sl.steps.length + 1, idv = String(n);
      const pre = sl.steps[0]?.id.replace(/\d+$/, '') || ''; while (ids.has(pre + idv)) idv = String(++n);
      const first = Object.keys(spec.slots || {})[0] ? '$' + Object.keys(spec.slots)[0] : 'SPY';
      sl.steps.push({ id: pre + idv, t: 'cmp', a: ['close', first, 0], op: '>', b: ['sma', first, 200], yes: null, no: null }); rulesHtml(); sync();
    }));
    H.$$('[data-delstep]', body).forEach(b => (b.onclick = () => {
      const [si, i] = b.dataset.delstep.split('.').map(Number), sl = spec.sleeves[si];
      if (sl.steps.length === 1) return alert('A sleeve needs at least one step. Remove the sleeve instead.');
      const gone = sl.steps[i].id; sl.steps.splice(i, 1);
      if (stepIds().length && JSON.stringify(sl.steps).includes(`"${gone}"`)) alert(`Other steps still point to step ${gone}. Change those targets before saving.`);
      rulesHtml(); sync();
    }));
    H.$$('[data-delsleeve]', body).forEach(b => (b.onclick = () => { spec.sleeves.splice(+b.dataset.delsleeve, 1); rulesHtml(); sync(); }));
    const add = H.$('#addSleeve', body);
    if (add) add.onclick = () => {
      const n = spec.sleeves.length + 1, first = Object.keys(spec.slots || {})[0] ? '$' + Object.keys(spec.slots)[0] : 'SPY';
      spec.sleeves.push({ name: `Sleeve ${n}`, weight: 0, steps: [{ id: `S${n}A`, t: 'cmp', a: ['close', first, 0], op: '>', b: ['sma', first, 200], yes: null, no: null }] });
      rulesHtml(); sync();
    };
    sync();
  }
  rulesHtml(); wireTickers();
  H.act(H.$('#preview', view), async () => { await refresh(true); H.$('#walk', view).scrollIntoView({ behavior: 'smooth' }); return 'Preview updated above'; });
  H.act(H.$('#saveRules', view), async () => { await H.api('/library/' + id, { method: 'PUT', body: { spec } }); setTimeout(H.render, 500); return 'Rules saved'; });
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
    await H.api('/library/' + id, { method: 'PUT', body: { ...f, runAt: +hh * 60 + +mm, stopPct: f.stopPct === '' ? null : +f.stopPct, leverage: +f.leverage || 1, public: !!f.public, wholeShares: !!f.wholeShares } });
    s.account = f.account;
    await refresh();
    return 'Saved';
  });
  H.$$('#modeSeg button', view).forEach(b => (b.onclick = async () => {
    try {
      if (b.dataset.m === 'auto' && !confirm(`Trade automatically in your ${accName(s.account)} on every rebalance day?`)) return;
      if (b.dataset.m === 'approve' && !confirm(`On every rebalance day, prepare the orders for your ${accName(s.account)} and ask you to approve them?`)) return;
      await H.api('/library/' + id, { method: 'PUT', body: { mode: b.dataset.m } });
      H.$$('#modeSeg button', view).forEach(x => x.classList.toggle('on', x === b));
    } catch (e) { alert(e.message); }
  }));
  if (H.$('#pending', view)) {
    const ask = approve => async () => {
      if (approve && !confirm(`Place ${s.state.pending.orders.length} order(s) in your ${accName(s.account)} now?`)) return '';
      const r = await H.api('/library/' + id + '/approve', { body: { approve } });
      setTimeout(H.render, 1200);
      return approve ? r.summary : 'Skipped for today';
    };
    H.act(H.$('#approveGo', view), ask(true)); H.act(H.$('#approveSkip', view), ask(false));
  }
  H.act(H.$('#del', view), async () => { if (!confirm('Delete this strategy? Positions it bought stay in your account.')) return ''; await H.api('/library/' + id, { method: 'DELETE' }); location.hash = '#/strategies'; return ''; });
  await refresh();
}
const isPaid = u => u && ((u.role === 'admin' && !u.previewPlan) || (['pro', 'elite', 'ultimate'].includes(u.plan) && ['active', 'trialing', null, undefined].includes(u.planStatus)));
