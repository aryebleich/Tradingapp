// Build & share: the 24/7 scanner, rule-based portfolios (backtest, deploy with scheduled
// contributions, community), the signal fleet (channels, mirroring into many accounts) and the
// strategy marketplace.
let H;
// Re-render after a short delay, unless the user has moved to another page by then.
const later = ms => { const h = location.hash; setTimeout(() => location.hash === h && H.render(), ms); };
export function registerBuild(routes, helpers) {
  H = helpers;
  Object.assign(routes, { scanner, portfolios, fleet, marketplace });
}
const pc = (v, d = 1) => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);
const tabsHtml = (list, on) => `<div class="seg pagetabs">${list.map(([k, t]) => `<button type="button" data-tab="${k}" class="${k === on ? 'on' : ''}">${t}</button>`).join('')}</div>`;
const wireTabs = (view, route) => H.$$('[data-tab]', view).forEach(b => (b.onclick = () => (location.hash = `#/${route}?tab=${b.dataset.tab}`)));
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : H.date(t); };

// ---------- scanner ----------
async function scanner(view) {
  const [meta, saved, accts] = await Promise.all([H.api('/scanners/meta'), H.api('/scanners'), H.accounts()]);
  view.innerHTML = `<div class="pagehead"><h1>Scanner</h1><p class="mu">Check a list of stocks or crypto against your rules and candlestick patterns. Saved scanners run around the clock: stocks during market hours, crypto any time, and alert you or buy.</p></div>
  <form class="card" id="scan">
    <div class="row">
      <label>Universe<select name="universe">${Object.entries(meta.universes).map(([k, u]) => `<option value="${k}">${H.esc(u.name)} (${u.count})</option>`).join('')}<option value="custom">My symbols...</option></select></label>
      <label id="symsL" hidden>Symbols<input name="symbols" placeholder="AAPL, MSFT, BTC/USD" data-no-tr></label>
      <label>Bars<select name="timeframe">${meta.timeframes.map(t => `<option value="${t}" ${!meta.intraday && t !== '1Day' ? 'disabled' : ''}>${{ '1Day': 'Daily', '1Hour': 'Hourly', '15Min': '15 minutes' }[t]}</option>`).join('')}</select></label>
    </div>
    <label>Rules (every line must be true on the latest bar)<textarea name="rules" rows="3" placeholder="RSI(14) < 35&#10;Close > SMA(200)" data-no-tr></textarea></label>
    <div class="mu small-print">Candlestick patterns (any of the ticked ones must appear on the latest bar; needs open/high/low data):</div>
    <div class="chips pats">${Object.entries(meta.patterns).map(([k, t]) => `<label class="chk"><input type="checkbox" value="${k}">${H.esc(t)}</label>`).join('')}</div>
    <div class="row"><button id="runScan">Scan now</button></div><div class="err"></div>
  </form>
  <div id="scanOut"></div>
  <form class="card" id="saveScan"><h2>Run it automatically</h2>
    <div class="row">
      <label>Name<input name="name" value="My scanner"></label>
      <label>Check every<select name="everyMin">${[5, 15, 30, 60, 240, 1440].map(m => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m < 60 ? m + ' minutes' : m === 1440 ? 'day' : m / 60 + ' hours'}</option>`).join('')}</select></label>
      <label>When it finds a match<select name="action"><option value="alert">Alert me</option><option value="buy">Buy</option></select></label>
      <label class="buyOnly" hidden>Account<select name="account">${H.accountOptions(accts, 'paper')}</select></label>
      <label class="buyOnly" hidden>Amount per buy ($)<input name="notional" type="number" value="100" min="1"></label>
    </div>
    <button>Save scanner</button><div class="err"></div>
    <p class="mu small-print">The free plan has 2 scanners checked hourly. Pro checks as often as every 5 minutes and can buy on real accounts. Each symbol triggers at most once a day per scanner. Risk limits from the Risk page apply to every buy.</p>
  </form>
  <div class="card"><h2>My scanners</h2><div class="tablewrap"><table><tr><th>Name</th><th>Universe</th><th>Rules</th><th>Every</th><th>Action</th><th>Last run</th><th></th></tr>
    ${saved.scanners.map(s => `<tr data-id="${s.id}"><td>${H.esc(s.name)}</td><td>${H.esc(meta.universes[s.universe]?.name || s.universe)}</td><td><code>${H.esc(s.rules || '-')}</code>${s.config.patterns?.length ? `<div class="mu small-print">${s.config.patterns.map(p => H.esc(meta.patterns[p])).join(', ')}</div>` : ''}</td>
      <td>${s.every_min} min</td><td>${s.action === 'buy' ? `buy $${s.notional} · ${H.esc(s.account)}` : 'alert'}</td><td>${s.last_run_at ? ago(s.last_run_at) : '-'}</td>
      <td class="nowrap"><button class="small ghost" data-act="${s.active ? 'pause' : 'resume'}">${s.active ? 'Pause' : 'Resume'}</button> <button class="small ghost" data-act="del">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="mu">No saved scanners yet</td></tr>'}
  </table></div>
  <h2 style="margin-top:18px">Recent matches</h2><div class="tablewrap"><table><tr><th>When</th><th>Symbol</th><th>Price</th><th>Result</th></tr>
    ${saved.hits.slice(0, 30).map(h => `<tr><td>${ago(h.at)}</td><td><a href="#/chart?symbol=${encodeURIComponent(h.symbol)}">${H.esc(h.symbol)}</a></td><td>${H.money(h.price)}</td><td>${H.esc(h.result)}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">Nothing yet</td></tr>'}
  </table></div></div>`;
  const f = H.$('#scan', view), sf = H.$('#saveScan', view);
  f.universe.onchange = () => (H.$('#symsL', view).hidden = f.universe.value !== 'custom');
  sf.action.onchange = () => H.$$('.buyOnly', sf).forEach(x => (x.hidden = sf.action.value !== 'buy'));
  const spec = () => ({ universe: f.universe.value === 'custom' ? f.symbols.value : f.universe.value, timeframe: f.timeframe.value, rules: f.rules.value, patterns: H.$$('.pats input:checked', f).map(i => i.value) });
  H.act(H.$('#runScan', view), async () => {
    const rows = await H.api('/scanners/run', { body: spec() }), hits = rows.filter(r => r.match).length;
    H.$('#scanOut', view).innerHTML = `<div class="card"><h2>${hits} of ${rows.length} match</h2><div class="tablewrap"><table><tr><th>Symbol</th><th>Match</th><th>Price</th><th>RSI</th><th>1 month</th><th>From 52w high</th><th>Above 200-day</th><th>Patterns</th></tr>
      ${rows.map(r => `<tr class="${r.match ? 'hit' : ''}"><td><a href="#/chart?symbol=${encodeURIComponent(r.symbol)}">${H.esc(r.symbol)}</a></td><td>${r.match ? '<span class="pill ok">match</span>' : `<span class="mu">${H.esc(r.reason || 'no')}</span>`}</td>
        <td>${r.price != null ? H.money(r.price) : '-'}</td><td>${r.rsi14 ?? '-'}</td><td class="${H.cls(r.roc1m)}">${pc(r.roc1m)}</td><td>${pc(r.fromHighPct)}</td><td>${r.aboveSma200 == null ? '-' : r.aboveSma200 ? 'yes' : 'no'}</td><td>${(r.patterns || []).map(p => H.esc(meta.patterns[p])).join(', ')}</td></tr>`).join('')}
      </table></div>${rows.some(r => r.dataSource === 'synthetic') ? '<p class="mu small-print">Simulated prices: no market data source is set on the server.</p>' : ''}</div>`;
  });
  H.act(H.$('button', sf), async () => {
    await H.api('/scanners', { body: { ...spec(), ...H.form(sf) } });
    later(600); return 'Saved. It runs on its schedule from now on.';
  });
  H.$$('[data-act]', view).forEach(b => (b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    if (b.dataset.act === 'del') { if (!confirm('Delete this scanner?')) return; await H.api('/scanners/' + id, { method: 'DELETE' }); }
    else await H.api('/scanners/' + id, { method: 'PATCH', body: { active: b.dataset.act === 'resume' } });
    H.render();
  }));
}

// ---------- rule-based portfolios ----------
const parseWeights = s => Object.fromEntries(String(s || '').split(/[\n,]+/).map(x => x.trim().match(/^([A-Za-z0-9.\/-]+)\s*[:= ]\s*([\d.]+)%?$/)).filter(Boolean).map(m => [m[1].toUpperCase(), +m[2]]));
async function portfolios(view, q) {
  const tab = q.get('tab') || 'build';
  const [meta, mine, accts] = await Promise.all([H.api('/baskets/meta'), H.api('/baskets'), H.accounts()]);
  let pre = null; try { pre = JSON.parse(sessionStorage.getItem('qp_basket') || 'null'); sessionStorage.removeItem('qp_basket'); } catch {}
  const s = pre || { universe: 'mega', filters: 'Close > SMA(200)', rankBy: 'momentum6m', topN: 5, weighting: 'equal', rebalance: 'monthly', cashPct: 0 };
  const opts = (o, v) => Object.entries(o).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${H.esc(t)}</option>`).join('');
  const custom = !meta.universes[s.universe];
  const head = `<div class="pagehead"><h1>Portfolios</h1><p class="mu">Build a portfolio from rules: pick a universe, filter it, rank it, hold the top names with the weighting you choose, and rebalance on a schedule. Backtest it, run it with monthly contributions, or follow one from the community.</p></div>
    ${tabsHtml([['build', 'Build'], ['mine', `My portfolios (${mine.length})`], ['community', 'Community']], tab)}`;
  if (tab === 'mine') { await myBaskets(view, head, mine, accts, meta); return wireTabs(view, 'portfolios'); }
  if (tab === 'community') { await community(view, head); return wireTabs(view, 'portfolios'); }
  view.innerHTML = `${head}
  <form class="card" id="bk">${pre?.name ? `<div class="banner">Loaded "${H.esc(pre.name)}". Backtest it, then save.</div>` : ''}
    <div class="row">
      <label>Universe<select name="universe">${opts(meta.universes, s.universe)}<option value="custom" ${custom ? 'selected' : ''}>My symbols...</option></select></label>
      <label id="bkSyms" ${custom ? '' : 'hidden'} style="flex:2">Symbols<input name="symbols" value="${custom ? H.esc(s.universe) : ''}" placeholder="AAPL, MSFT, GLD, TLT" data-no-tr></label>
    </div>
    <label>Only hold symbols where (every line true)<textarea name="filters" rows="2" data-no-tr>${H.esc(s.filters || '')}</textarea></label>
    <div class="row">
      <label>Rank by<select name="rankBy">${opts(meta.ranks, s.rankBy)}</select></label>
      <label>Hold the top<input name="topN" type="number" min="1" max="30" value="${s.topN}"></label>
      <label>Weighting<select name="weighting">${opts(meta.weights, s.weighting)}</select></label>
      <label>Rebalance<select name="rebalance">${opts(meta.rebalance, s.rebalance)}</select></label>
      <label>Keep in cash %<input name="cashPct" type="number" min="0" max="90" value="${s.cashPct || 0}"></label>
      <label>Years to test<input name="years" type="number" min="2" max="15" value="6"></label>
    </div>
    <label id="bkW" ${s.weighting === 'manual' ? '' : 'hidden'}>Weights (symbol and %, one per line)<textarea name="weightsText" rows="4" data-no-tr>${H.esc(Object.entries(s.weights || {}).map(([k, v]) => `${k} ${+(+v).toFixed(2)}`).join('\n'))}</textarea></label>
    <div class="row"><button id="bkTest">Backtest</button></div><div class="err"></div>
  </form>
  <div id="bkOut"></div>
  <form class="card" id="bkSave"><h2>Save</h2><div class="row"><label>Name<input name="name" value="${H.esc(pre?.name || 'My portfolio')}"></label><label style="flex:2">Description<input name="description" value="${H.esc(pre?.description || '')}"></label></div>
    <label class="chk"><input type="checkbox" name="public"> Share with the community (others see the rules and results, never your money or trades)</label>
    <button>Save portfolio</button><div class="err"></div></form>`;
  wireTabs(view, 'portfolios');
  const f = H.$('#bk', view);
  f.universe.onchange = () => (H.$('#bkSyms', view).hidden = f.universe.value !== 'custom');
  f.weighting.onchange = () => (H.$('#bkW', view).hidden = f.weighting.value !== 'manual');
  const spec = () => { const x = H.form(f); return { ...x, universe: x.universe === 'custom' ? x.symbols : x.universe, weights: parseWeights(x.weightsText) }; };
  H.act(H.$('#bkTest', view), async () => {
    const r = await H.api('/baskets/backtest', { body: spec() }), st = r.stats;
    H.$('#bkOut', view).innerHTML = `<div class="card"><h2>Backtest ${H.esc(r.from)} to ${H.esc(r.to)} ${r.dataSource === 'synthetic' ? '<span class="pill warn">simulated prices</span>' : ''}</h2>
      <div class="stats"><div class="stat"><span>Total return</span><b class="${H.cls(st.totalReturn)}">${pc(st.totalReturn)}</b></div><div class="stat"><span>Per year</span><b class="${H.cls(st.cagr)}">${pc(st.cagr)}</b></div>
        <div class="stat"><span>S&P 500 per year</span><b>${pc(st.spyCagr)}</b></div><div class="stat"><span>Max drawdown</span><b class="neg">-${(+st.maxDrawdown).toFixed(1)}%</b></div>
        <div class="stat"><span>Sharpe</span><b>${st.sharpe ?? '-'}</b></div><div class="stat"><span>Rebalances / turnover</span><b>${st.rebalances} / ${st.avgTurnover}%</b></div></div>
      <canvas class="chart" id="bkCh"></canvas><p class="mu small-print">Colored line: this portfolio, growth of $1. Grey: S&P 500 (SPY). ${r.symbolsUsed} symbols had data. Past results do not predict future returns.</p>
      <h3>If you started today it would hold</h3><div class="tablewrap"><table><tr><th>Symbol</th><th>Weight</th></tr>${Object.entries(r.today).map(([k, w]) => `<tr><td>${H.esc(k)}</td><td>${(w * 100).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="2" class="mu">Nothing passes the filters today (all cash)</td></tr>'}</table></div></div>`;
    H.drawChart(H.$('#bkCh', view), r.curve.map(c => c.eq), { base: 1, compare: r.curve.every(c => c.spy != null) ? r.curve.map(c => c.spy) : undefined });
  });
  const sv = H.$('#bkSave', view);
  H.act(H.$('button', sv), async () => { await H.api('/baskets', { body: { ...spec(), ...H.form(sv) } }); location.hash = '#/portfolios?tab=mine'; });
}
async function myBaskets(view, head, list, accts, meta) {
  const st = await H.api('/alpaca/status').catch(() => null);
  const ach = st?.active?.type === 'broker' ? await H.api('/alpaca/broker/ach').catch(() => []) : [];
  view.innerHTML = `${head}${list.map(b => `<div class="card" data-id="${b.id}">
    <div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${H.esc(b.name)} ${b.deployed ? `<span class="pill ok">running · ${H.esc(b.account)}</span>` : '<span class="pill">not running</span>'} ${b.public ? '<span class="pill">shared</span>' : ''} ${b.source_id ? `<span class="pill">following${b.follow_updates ? ' with updates' : ''}</span>` : ''}</h2>
      <span class="row" style="gap:6px">${b.deployed ? '<button class="small ghost" data-a="rebal">Rebalance now</button><button class="small danger" data-a="stop">Stop</button>' : ''}${b.source_id ? '' : `<button class="small ghost" data-a="share">${b.public ? 'Stop sharing' : 'Share'}</button>`}<button class="small ghost" data-a="del">Delete</button></span></div>
    <p class="mu">${H.esc(meta.universes[b.spec.universe] || b.spec.universe)} · ${H.esc(meta.ranks[b.spec.rankBy])} · top ${b.spec.topN} · ${H.esc(meta.weights[b.spec.weighting])} · ${H.esc(meta.rebalance[b.spec.rebalance])}${b.spec.filters ? ` · <code>${H.esc(b.spec.filters)}</code>` : ''}</p>
    ${b.stats ? `<div class="stats"><div class="stat"><span>Backtest per year</span><b class="${H.cls(b.stats.cagr)}">${pc(b.stats.cagr)}</b></div><div class="stat"><span>Max drawdown</span><b>-${b.stats.maxDrawdown}%</b></div><div class="stat"><span>Sharpe</span><b>${b.stats.sharpe ?? '-'}</b></div>${b.deployed ? `<div class="stat"><span>Invested</span><b>${H.money(b.amount)}</b></div>` : ''}</div>` : ''}
    ${Object.keys(b.holdings).length ? `<p class="mu small-print">Holding: ${Object.entries(b.holdings).map(([k, v]) => `${H.esc(k)} ${(+v).toFixed(3)}`).join(', ')}${b.last_rebalance ? ` · last rebalance ${H.esc(b.last_rebalance)}` : ''}</p>` : ''}
    ${b.deployed ? '' : `<form class="row dep"><label>Account<select name="account">${H.accountOptions(accts, 'paper', H.paid())}</select></label><label>Starting amount ($)<input name="amount" type="number" min="10" value="1000"></label>
      <label>Add every month ($)<input name="contribution" type="number" min="0" value="0"></label><label>On day<input name="contribDay" type="number" min="1" max="28" value="1"></label>
      ${ach.length ? `<label>Pull from bank (ACH)<select name="achRelationship"><option value="">No, use account cash</option>${ach.map(a => `<option value="${H.esc(a.id)}">${H.esc(a.nickname || a.bank_account_type || 'Bank')} ${H.esc(a.bank_account_number ? '••' + String(a.bank_account_number).slice(-4) : '')}</option>`).join('')}</select></label>` : ''}
      <button data-a="deploy">Start</button></form>`}<div class="err"></div><div class="out mu"></div></div>`).join('') || `<div class="card mu">No portfolios yet. Build one, or follow one from the community.</div>`}
    <p class="mu small-print">Portfolios rebalance after 10:00 New York time on trading days. Monthly contributions buy on their day; with a linked bank on an Alpaca brokerage account the money is pulled by ACH first (deposits take 1 to 3 business days to settle).</p>`;
  H.$$('[data-a]', view).forEach(b => (b.onclick = async e => {
    e.preventDefault();
    const card = b.closest('[data-id]'), id = card.dataset.id, bk = list.find(x => x.id == id), err = H.$('.err', card), a = b.dataset.a;
    err.textContent = ''; b.disabled = true;
    try {
      if (a === 'del') { if (!confirm('Delete this portfolio? Positions already bought stay in the account.')) return; await H.api('/baskets/' + id, { method: 'DELETE' }); }
      else if (a === 'stop') await H.api(`/baskets/${id}/deploy`, { body: { on: false } });
      else if (a === 'deploy') { const f = H.form(H.$('form.dep', card)); if (f.account !== 'paper' && !confirm('This portfolio will place real orders on that account. Continue?')) return; await H.api(`/baskets/${id}/deploy`, { body: f }); }
      else if (a === 'share') await H.api('/baskets/' + id, { method: 'PUT', body: { ...bk.spec, name: bk.name, description: bk.description, public: !bk.public } });
      else if (a === 'rebal') { const r = await H.api(`/baskets/${id}/rebalance`, { body: {} }); H.$('.out', card).textContent = r.log.join('; ') || 'Already on target.'; return; }
      H.render();
    } catch (x) { err.textContent = x.message; } finally { b.disabled = false; }
  }));
}
async function community(view, head) {
  const list = await H.api('/baskets/community');
  view.innerHTML = `${head}<div class="cards">${list.map(b => `<div class="card" data-id="${b.id}"><h2>${H.esc(b.name)}</h2><p class="mu">${H.esc(b.description || '')}</p>
    <div class="stats"><div class="stat"><span>Backtest per year</span><b class="${H.cls(b.stats?.cagr)}">${pc(b.stats?.cagr)}</b></div><div class="stat"><span>Max drawdown</span><b>${b.stats ? '-' + b.stats.maxDrawdown + '%' : '-'}</b></div><div class="stat"><span>Followers</span><b>${b.followers}</b></div></div>
    <p class="mu small-print">By ${H.esc(b.creator)} · top ${b.spec.topN} by ${H.esc(b.spec.rankBy)} · rebalanced ${H.esc(b.spec.rebalance)}</p>
    <label class="chk"><input type="checkbox" checked> Keep receiving the creator's rule changes</label><button class="small">Follow</button><div class="err"></div></div>`).join('') || '<div class="card mu">Nobody has shared a portfolio yet. Share yours from My portfolios.</div>'}</div>
    <p class="mu small-print">Community portfolios are shared by other members and are not recommendations. Following copies the rules; you choose whether and where to run them.</p>`;
  H.$$('[data-id] button', view).forEach(b => H.act(b, async () => { const c = b.closest('[data-id]'); await H.api(`/baskets/${c.dataset.id}/follow`, { body: { followUpdates: H.$('input', c).checked } }); location.hash = '#/portfolios?tab=mine'; }));
}

// ---------- signal fleet ----------
async function fleet(view) {
  const [d, accts] = await Promise.all([H.api('/fleet'), H.accounts()]);
  const pend = d.inbox.filter(p => p.status === 'pending' && !p.expired);
  const hookUrl = p => location.origin + p;
  view.innerHTML = `<div class="pagehead"><h1>Signal fleet</h1><p class="mu">Send buy and sell signals to every account that follows you, from here or from TradingView and other tools by webhook. Follow a channel to mirror its signals into one or many of your accounts, automatically or after you approve each one.</p></div>
  ${pend.length ? `<div class="card"><h2>Waiting for your approval (${pend.length})</h2><div class="tablewrap"><table><tr><th>Channel</th><th>Signal</th><th>Account</th><th>Sent</th><th></th></tr>
    ${pend.map(p => `<tr data-p="${p.id}"><td>${H.esc(p.channel)}</td><td><b>${p.side.toUpperCase()}</b> ${H.esc(p.symbol)}${p.price ? ' @ ' + H.money(p.price) : ''}${p.note ? `<div class="mu small-print">${H.esc(p.note)}</div>` : ''}</td><td>${H.esc(p.account)}</td><td>${ago(p.signal_at)}</td>
      <td class="nowrap"><button class="small" data-ok="1">Approve</button> <button class="small ghost" data-ok="0">Decline</button></td></tr>`).join('')}</table></div><p class="mu small-print">Signals expire 30 minutes after they are sent.</p><div class="err" id="inErr"></div></div>` : ''}
  <div class="grid">
  <div class="card"><h2>My channels</h2>
    ${d.channels.map(c => `<div class="chan" data-c="${c.id}"><div class="row" style="justify-content:space-between;align-items:center"><b>${H.esc(c.name)}</b><span class="mu">${c.followers} following${c.public ? '' : ' · private'}</span></div>
      <form class="row sig"><label>Symbol<input name="symbol" placeholder="AAPL" data-no-tr></label><label>Side<select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label><label>Sell %<input name="sizePct" type="number" min="1" max="100" placeholder="100"></label><label style="flex:2">Note<input name="note"></label><button>Send signal</button></form>
      <div class="row" style="gap:6px"><button class="small ghost" data-c-act="token">New webhook link</button><button class="small ghost" data-c-act="del">Delete</button></div><div class="err"></div><div class="hook"></div></div>`).join('') || '<p class="mu">You have no channel yet.</p>'}
    <form class="row" id="newChan"><label>Name<input name="name" value="My signals"></label><label style="flex:2">Description<input name="description"></label><label class="chk"><input type="checkbox" name="public" checked> Public</label><button>Create channel</button></form><div class="err"></div><div id="newHook"></div>
  </div>
  <div class="card"><h2>Following</h2><div class="tablewrap"><table><tr><th>Channel</th><th>Account</th><th>Size</th><th>Mode</th><th></th></tr>
    ${d.subscriptions.filter(s => s.active).map(s => `<tr><td>${H.esc(s.channel)}</td><td>${H.esc(s.account)}</td><td>${s.sizing === 'pct' ? s.amount + '% of cash' : H.money(s.amount)}</td><td>${s.mode === 'auto' ? 'automatic' : 'I approve each'}</td><td><button class="small ghost" data-unsub="${s.id}">Stop</button></td></tr>`).join('') || '<tr><td colspan="5" class="mu">Not following any channel</td></tr>'}</table></div>
    <h3 style="margin-top:16px">Recent results</h3><div class="tablewrap"><table><tr><th>When</th><th>Signal</th><th>Result</th></tr>${d.inbox.filter(p => p.status !== 'pending' || p.expired).slice(0, 15).map(p => `<tr><td>${ago(p.signal_at)}</td><td>${p.side} ${H.esc(p.symbol)} · ${H.esc(p.account)}</td><td>${H.esc(p.result || (p.expired ? 'expired' : p.status))}</td></tr>`).join('') || '<tr><td colspan="3" class="mu">Nothing yet</td></tr>'}</table></div></div>
  </div>
  <div class="card"><h2>Public channels</h2><div class="tablewrap"><table><tr><th>Channel</th><th>By</th><th>Followers</th><th>Signals</th><th></th></tr>
    ${d.public.map(c => `<tr data-pub="${c.id}"><td><b>${H.esc(c.name)}</b><div class="mu small-print">${H.esc(c.description || '')}</div></td><td>${H.esc(c.creator)}</td><td>${c.followers}</td><td>${c.signals}</td><td><button class="small">Follow</button></td></tr>`).join('') || '<tr><td colspan="5" class="mu">No public channels yet</td></tr>'}</table></div>
    <form class="card sub" id="subForm" hidden><h2>Follow <span id="subName"></span></h2>
      <div class="mu small-print">Mirror into these accounts:</div><div class="chips">${accts.filter(a => a.connected).map(a => `<label class="chk"><input type="checkbox" name="acc" value="${a.id}" ${a.id === 'paper' ? 'checked' : ''}>${H.esc(H.acctLabel(a))}</label>`).join('')}</div>
      <div class="row"><label>Size each buy by<select name="sizing"><option value="fixed">Fixed dollars</option><option value="pct">% of account cash</option></select></label><label>Amount<input name="amount" type="number" value="100" min="1"></label>
        <label>Mode<select name="mode"><option value="review">I approve each signal</option><option value="auto">Trade automatically</option></select></label></div>
      <button>Follow</button><div class="err"></div></form>
    <p class="mu small-print">Signals come from other members, not from QuantPocket, and are not advice. Your risk limits and kill switch apply to every mirrored order.</p></div>`;
  H.$$('[data-p] button', view).forEach(b => (b.onclick = async () => { try { await H.api('/fleet/inbox/' + b.closest('tr').dataset.p, { body: { approve: b.dataset.ok === '1' } }); H.render(); } catch (e) { H.$('#inErr', view).textContent = e.message; } }));
  H.$$('[data-c]', view).forEach(c => {
    const id = c.dataset.c, err = H.$('.err', c);
    H.act(H.$('form.sig button', c), async () => { const r = await H.api(`/fleet/channels/${id}/signals`, { body: H.form(H.$('form.sig', c)) }); return `Sent to ${r.delivered} follower accounts`; }, err);
    H.$$('[data-c-act]', c).forEach(b => (b.onclick = async () => {
      try {
        if (b.dataset.cAct === 'del') { if (!confirm('Delete this channel? Followers stop receiving signals.')) return; await H.api('/fleet/channels/' + id, { method: 'DELETE' }); return H.render(); }
        if (!confirm('The old webhook link stops working. Continue?')) return;
        const r = await H.api(`/fleet/channels/${id}/token`, { body: {} }); H.$('.hook', c).innerHTML = hookBox(hookUrl(r.webhookPath));
      } catch (e) { err.textContent = e.message; }
    }));
  });
  const nc = H.$('#newChan', view);
  H.act(H.$('button', nc), async () => { const r = await H.api('/fleet/channels', { body: H.form(nc) }); try { sessionStorage.setItem('qp_hook', r.webhookPath); } catch {} H.render(); });
  // A new channel's webhook link is shown once, right after it is created.
  let fresh = null; try { fresh = sessionStorage.getItem('qp_hook'); sessionStorage.removeItem('qp_hook'); } catch {}
  if (fresh) H.$('#newHook', view).innerHTML = hookBox(hookUrl(fresh));
  H.$$('[data-unsub]', view).forEach(b => (b.onclick = async () => { await H.api('/fleet/subscriptions/' + b.dataset.unsub, { method: 'DELETE' }); H.render(); }));
  const sf = H.$('#subForm', view); let subId = null;
  H.$$('[data-pub] button', view).forEach(b => (b.onclick = () => { const tr = b.closest('tr'); subId = tr.dataset.pub; H.$('#subName', view).textContent = H.$('b', tr).textContent; sf.hidden = false; sf.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  H.act(H.$('button', sf), async () => {
    const f = H.form(sf), acc = H.$$('[name=acc]:checked', sf).map(i => i.value);
    if (f.mode === 'auto' && acc.some(a => a !== 'paper') && !confirm('Signals from this channel will place real orders automatically. Continue?')) return;
    await H.api(`/fleet/channels/${subId}/subscribe`, { body: { accounts: acc, sizing: f.sizing, amount: f.amount, mode: f.mode } }); later(500); return 'Following';
  });
}
const hookBox = url => `<div class="banner"><b>Webhook link (shown once, keep it secret):</b><div class="refbox"><input readonly value="${H.esc(url)}" data-no-tr onclick="this.select()"></div>
  <p class="mu small-print">POST JSON like <code>{"symbol":"AAPL","side":"buy"}</code> to this link, e.g. from a TradingView alert, to send a signal to every follower.</p></div>`;

// ---------- marketplace ----------
async function marketplace(view, q) {
  const tab = q.get('tab') || 'strategies';
  const d = await H.api('/market');
  const stat = (k, v, c) => `<div class="stat"><span>${k}</span><b class="${c || ''}">${v}</b></div>`;
  const body = {
    strategies: () => d.strategies.map(s => `<div class="card" data-s="${s.id}"><h2>${H.esc(s.name)} <span class="pill">${H.esc(s.symbol)}</span></h2><p class="mu">${H.esc(s.description || '')}</p>
      <div class="kv"><span>Enter when</span><span><code>${H.esc(s.entry)}</code></span><span>Exit when</span><span><code>${H.esc(s.exit)}</code></span></div>
      ${s.stats ? `<div class="stats">${stat('Backtest return', pc(s.stats.ret), H.cls(s.stats.ret))}${stat('Buy & hold', pc(s.stats.bh))}${stat('Max drawdown', '-' + (+s.stats.dd).toFixed(1) + '%')}${stat('Sharpe', (+s.stats.sharpe).toFixed(2))}</div><p class="mu small-print">Backtest ${H.esc(s.stats.from)} to ${H.esc(s.stats.to)}${s.stats.dataSource === 'synthetic' ? ' on simulated prices' : ''}.</p>` : ''}
      <p class="mu small-print">By ${H.esc(s.creator)} · copied ${s.copies} times</p><button class="small">Copy to my strategies</button><div class="err"></div></div>`).join('') || '<div class="card mu">No published strategies yet. Publish one from the Bots page.</div>',
    portfolios: () => d.baskets.map(b => `<div class="card"><h2>${H.esc(b.name)}</h2><p class="mu">${H.esc(b.description || '')}</p><div class="stats">${stat('Backtest per year', pc(b.stats?.cagr), H.cls(b.stats?.cagr))}${stat('Followers', b.followers)}</div><p class="mu small-print">By ${H.esc(b.creator)}</p><a href="#/portfolios?tab=community">Follow on the Portfolios page</a></div>`).join('') || '<div class="card mu">No shared portfolios yet.</div>',
    channels: () => d.channels.map(c => `<div class="card"><h2>${H.esc(c.name)}</h2><p class="mu">${H.esc(c.description || '')}</p><div class="stats">${stat('Followers', c.followers)}${stat('Signals sent', c.signals)}</div><p class="mu small-print">By ${H.esc(c.creator)}</p><a href="#/fleet">Follow on the Signal fleet page</a></div>`).join('') || '<div class="card mu">No public signal channels yet.</div>',
  };
  view.innerHTML = `<div class="pagehead"><h1>Marketplace</h1><p class="mu">Strategies, portfolios and signal channels shared by other members. Copy one, test it on paper, and decide for yourself. Nothing here is a recommendation.</p></div>
    ${tabsHtml([['strategies', `Strategies (${d.strategies.length})`], ['portfolios', `Portfolios (${d.baskets.length})`], ['channels', `Signal channels (${d.channels.length})`]], tab)}<div class="cards">${body[tab] ? body[tab]() : ''}</div>`;
  wireTabs(view, 'marketplace');
  H.$$('[data-s] button', view).forEach(b => H.act(b, async () => { await H.api(`/market/strategies/${b.closest('[data-s]').dataset.s}/copy`, { body: {} }); return 'Copied. Find it on the Bots page.'; }));
}
export { wireTabs };
