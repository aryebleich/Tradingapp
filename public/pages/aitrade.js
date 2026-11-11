// The AI pages of the Intelligence section:
//   agenthub   Agents & API: connect Claude, ChatGPT, Cursor, Codex or your own agent (MCP), set
//              the boundaries agents trade within, approve or reject their orders
//   aibots     AI bots: DCA, grid, scalping and plain-English bots, the builder with backtests, and
//              the AI strategy marketplace
//   aisignals  AI signals: tonight's high-probability setups with stops and targets, automatic trades
//   intel      Market intelligence: earnings-call summaries, unusual options flow, dark-pool
//              (off-exchange) volume, whale wallets, and questions in plain words
// Each page shows what the user's plan includes, and the same limits are checked on the server.
let H;
export function registerAiTrade(routes, helpers) { H = helpers; Object.assign(routes, { agenthub, aibots, aisignals, intel }); }

const head = (t, p) => `<div class="pagehead"><div><h1>${t}</h1><p class="mu" style="margin:4px 0 0">${p}</p></div></div>`;
const NOTE = '<p class="mu small-print">Automated and AI-driven trading can lose money quickly. Past results and backtests do not promise future returns. Brightolio is software, not an investment adviser.</p>';
const when = t => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-');
const pc = v => (v == null ? '-' : `<b class="${H.cls(v)}">${v > 0 ? '+' : ''}${(+v).toFixed(2)}%</b>`);
const planLine = (lim, items) => `<p class="mu small-print">Your plan (${H.esc(lim.label)}): ${items.join(' · ')}. <a href="#/funding">Compare plans</a></p>`;
const STATUS = { placed: 'pos', approved: 'pos', pending: 'warn', blocked: 'neg', rejected: '', failed: 'neg' };
const pill = s => `<span class="pill ${STATUS[s] || ''}">${H.esc(s)}</span>`;

// ---------- Agents & API ----------
async function agenthub(view) {
  const d = await H.api('/agent'), lim = d.limits, b = d.boundaries, origin = location.origin;
  const modeSel = a => `<select name="mode:${H.esc(a.id)}" aria-label="Agents on ${H.esc(a.name)}">${[['off', 'Off'], ['approve', 'Ask me first'], ['auto', 'Automatic']].map(([v, t]) => `<option value="${v}" ${(b.accounts[a.id] || (a.id === 'paper' ? 'auto' : 'off')) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const pending = d.orders.filter(o => o.status === 'pending');
  view.innerHTML = head('Agents & API', 'Connect your own AI agent (Claude, ChatGPT, Cursor, Codex or a custom one) to your brokerage accounts. It can scan the market, read order books and news, and draft or place orders, only inside the limits you set here.') + `
  ${pending.length ? `<div class="card" id="pend"><h2>Waiting for your approval (${pending.length})</h2><div class="tablewrap"><table><tr><th>Agent</th><th>Order</th><th>Account</th><th>Why</th><th></th></tr>${pending.map(o => `<tr><td>${H.esc(o.agent || '')}</td><td><b>${o.side}</b> ${o.qty ? H.num(o.qty, 4) : H.money(o.notional) + ' of'} <span data-no-tr>${H.esc(o.symbol)}</span>${o.type === 'limit' ? ` limit ${H.money(o.limit_price)}` : ''}<div class="mu">≈ ${H.money(o.est_usd)}</div></td><td>${H.esc(o.account)}</td><td class="mu">${H.esc(o.reason || '')}</td><td><button class="small" data-ok="${o.id}">Approve</button> <button class="small ghost" data-no="${o.id}">Reject</button></td></tr>`).join('')}</table></div></div>` : ''}
  <div class="grid">
    <form class="card" id="bnd"><h2>Boundaries</h2><p class="mu" style="margin-top:0">Every agent order is checked against these first, then against your <a href="#/risk">risk controls</a> and kill switch.</p>
      <h3>Per account</h3>${d.accounts.map(a => `<label>${H.esc(a.name)}${a.live ? ' <span class="pill warn">real money</span>' : ''}${modeSel(a)}${d.effective[a.id] !== (b.accounts[a.id] || (a.id === 'paper' ? 'auto' : 'off')) ? `<small class="mu">Your plan runs this as: ${H.esc(d.effective[a.id])}</small>` : ''}</label>`).join('')}
      <div class="row"><label>Largest order ($)<input name="maxOrderUsd" type="number" min="0" step="any" value="${b.maxOrderUsd}"></label><label>Most per day ($)<input name="maxDailyUsd" type="number" min="0" step="any" value="${b.maxDailyUsd}"></label><label>Orders per day<input name="maxOrdersPerDay" type="number" min="0" value="${b.maxOrdersPerDay}"></label></div>
      <label>Only these symbols (empty = any)<input name="symbols" value="${H.esc(b.symbols.join(', '))}" placeholder="e.g. SPY, QQQ, AAPL, BTC/USD" data-no-tr></label>
      <label>Never these symbols<input name="blocked" value="${H.esc(b.blocked.join(', '))}" placeholder="e.g. GME, AMC" data-no-tr></label>
      <label class="check"><input type="checkbox" name="allowShort" ${b.allowShort ? 'checked' : ''}> Agents may sell short</label>
      <label class="check"><input type="checkbox" name="extendedHours" ${b.extendedHours ? 'checked' : ''} ${lim.extendedHours ? '' : 'disabled'}> Extended hours (limit orders before and after the session)${lim.extendedHours ? '' : ' · Elite'}</label>
      <button>Save boundaries</button><div class="err"></div>
      <p class="mu small-print">Today: ${d.usage.ordersToday} agent orders, ${H.money(d.usage.spentToday)}. Market ${d.session.open ? 'open' : 'closed'}.</p></form>
    <div class="card"><h2>Connect an agent</h2>
      <p>Create a token, then add Brightolio as an MCP server in your agent. Each token is one connected agent.</p>
      <div class="row"><input id="tokName" placeholder="Name, e.g. Claude Desktop, ChatGPT, Cursor" style="max-width:300px"><button id="newTok">Create a token</button></div><div class="err"></div><div id="tokOut"></div>
      <div class="tablewrap"><table><tr><th>Agent</th><th>Ends with</th><th>Last used</th><th></th></tr>${d.tokens.map(t => `<tr><td>${H.esc(t.name)}</td><td data-no-tr>…${H.esc(t.hint || '')}</td><td>${when(t.last_used_at)}</td><td><button class="small ghost" data-revoke="${t.id}">Disconnect</button></td></tr>`).join('') || '<tr><td colspan="4" class="mu">No agents connected yet.</td></tr>'}</table></div>
      <details><summary>How to add it to your agent</summary>
        <p><b>Claude Desktop, Cursor, VS Code</b> (settings file):</p><pre class="code" data-no-tr>${H.esc(JSON.stringify({ mcpServers: { brightolio: { type: 'http', url: origin + '/mcp', headers: { Authorization: 'Bearer YOUR_TOKEN' } } } }, null, 2))}</pre>
        <p><b>ChatGPT, Codex and other agents</b>: add a custom MCP connector with the address <code data-no-tr>${H.esc(origin)}/mcp</code> and the header <code data-no-tr>Authorization: Bearer YOUR_TOKEN</code>.</p>
        <p><b>Your own code</b>: send JSON-RPC 2.0 requests (MCP "tools/call") to the same address.</p></details>
      <p class="mu small-print">Tools: list_accounts, get_account, get_quote, get_order_book, scan_market, get_news, get_signals, get_boundaries, submit_order, list_agent_orders, list_orders, place_paper_order.</p></div>
  </div>
  <div class="card"><h2>Agent activity</h2><div class="tablewrap"><table><tr><th>When</th><th>Agent</th><th>Order</th><th>Account</th><th>Status</th><th>Result</th></tr>${d.orders.map(o => `<tr><td>${when(o.created_at)}</td><td>${H.esc(o.agent || '')}</td><td>${o.side} ${o.qty ? H.num(o.qty, 4) : H.money(o.notional)} <span data-no-tr>${H.esc(o.symbol)}</span></td><td>${H.esc(o.account)}</td><td>${pill(o.status)}</td><td class="mu">${H.esc(o.result || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">Nothing yet. Orders your agents submit appear here.</td></tr>'}</table></div>
    <p class="mu small-print">Simple if/then automation without an agent: <a href="#/rules">Rules across accounts</a>, <a href="#/signals">Alerts to trades</a> and <a href="#/aibots">AI bots</a>.</p></div>
  ${planLine(lim, [`${lim.agentTokens} connected agent${lim.agentTokens === 1 ? '' : 's'}`, { off: 'practice orders only', approve: 'real-money orders with your approval', auto: 'automatic real-money orders within your limits' }[lim.agentLive], `${lim.apiPerMin} requests a minute`, lim.extendedHours ? 'extended hours' : 'regular hours'])}${NOTE}`;
  const f = H.$('#bnd', view);
  H.act(H.$('button', f), async () => {
    const v = H.form(f), accounts = {};
    for (const [k, m] of Object.entries(v)) if (k.startsWith('mode:')) accounts[k.slice(5)] = m;
    await H.api('/agent/boundaries', { method: 'PUT', body: { accounts, maxOrderUsd: +v.maxOrderUsd, maxDailyUsd: +v.maxDailyUsd, maxOrdersPerDay: +v.maxOrdersPerDay, symbols: v.symbols, blocked: v.blocked, allowShort: !!v.allowShort, extendedHours: !!v.extendedHours } });
    setTimeout(H.render, 600); return 'Saved';
  });
  H.act(H.$('#newTok', view), async () => {
    const r = await H.api('/tokens', { body: { name: H.$('#tokName', view).value } });
    H.$('#tokOut', view).innerHTML = `<p class="banner">Copy it now; it is shown only once: <code data-no-tr>${H.esc(r.token)}</code></p>`; return '';
  });
  H.$$('[data-revoke]', view).forEach(b => H.act(b, async () => { await H.api('/tokens/' + b.dataset.revoke, { method: 'DELETE' }); H.render(); }));
  H.$$('[data-ok]', view).forEach(b => H.act(b, async () => { const r = await H.api(`/agent/orders/${b.dataset.ok}/approve`, { body: {} }); setTimeout(H.render, 800); return r.status === 'placed' ? 'Placed' : r.reason || r.status; }));
  H.$$('[data-no]', view).forEach(b => H.act(b, async () => { await H.api(`/agent/orders/${b.dataset.no}/reject`, { body: {} }); H.render(); }));
}

// ---------- AI bots ----------
const KIND_HELP = {
  dca: 'Buys a set dollar amount on a schedule; optional extra buys when the price is well below your average cost.',
  grid: 'Places a ladder of levels between a low and a high price: buys each step down and sells each step up. Works best when prices move sideways.',
  scalp: 'Watches short moves: buys a quick drop below the recent average and sells a small gain or cuts at a stop. Needs frequent checks (Pro and up).',
  rule: 'Write the rules in plain English. They are turned into a strategy you can backtest, then run as a bot.',
};
const fields = {
  dca: c => `<div class="row"><label>Dollars each time<input name="amountUsd" type="number" min="1" step="any" value="${c.amountUsd ?? 100}"></label><label>Every (days)<input name="everyDays" type="number" min="1" value="${c.everyDays ?? 7}"></label><label>Extra buy when below my average by (%)<input name="dipPct" type="number" min="0" step="any" value="${c.dipPct ?? ''}"></label><label>Extra dollars<input name="dipExtraUsd" type="number" min="0" step="any" value="${c.dipExtraUsd ?? ''}"></label></div>`,
  grid: c => `<div class="row"><label>Lowest price<input name="lower" type="number" step="any" value="${c.lower ?? ''}" required></label><label>Highest price<input name="upper" type="number" step="any" value="${c.upper ?? ''}" required></label><label>Levels<input name="levels" type="number" min="3" max="100" value="${c.levels ?? 10}"></label><label>Quantity per level<input name="qtyPerLevel" type="number" step="any" value="${c.qtyPerLevel ?? 1}"></label></div>`,
  scalp: c => `<div class="row"><label>Dollars per trade<input name="amountUsd" type="number" min="1" step="any" value="${c.amountUsd ?? 200}"></label><label>Buy when below the average by (%)<input name="dropPct" type="number" step="any" value="${c.dropPct ?? 0.5}"></label><label>Take profit (%)<input name="takePct" type="number" step="any" value="${c.takePct ?? 0.6}"></label><label>Stop (%)<input name="stopPct" type="number" step="any" value="${c.stopPct ?? 0.8}"></label><label>Average of the last checks<input name="window" type="number" min="5" max="240" value="${c.window ?? 20}"></label></div>`,
};
async function aibots(view, q) {
  const [d, accts] = await Promise.all([H.api('/aibots'), H.accounts()]), lim = d.limits;
  const tab = q.get('tab') || 'builder';
  const tabs = `<div class="chips">${[['builder', 'Plain-English builder'], ['new', 'DCA, grid & scalping'], ['mine', `My bots (${d.bots.length})`], ['market', 'AI strategy marketplace →']].map(([k, t]) => `<a href="${k === 'market' ? '#/aimarket' : `#/aibots?tab=${k}`}"><button type="button" class="${k === tab ? 'on' : ''}">${t}</button></a>`).join('')}</div>`;
  const acctSel = `<label>Account<select name="account">${accts.filter(a => a.connected).map(a => `<option value="${a.id}" ${a.id === 'paper' ? 'selected' : ''} ${a.id !== 'paper' && !lim.botsLive ? 'disabled' : ''}>${H.esc(H.acctLabel(a))}${a.id !== 'paper' && !lim.botsLive ? ' · Pro' : ''}</option>`).join('')}</select></label>`;
  view.innerHTML = head('AI bots', 'Automated strategies without code: dollar-cost averaging, grid and scalping bots, or rules you write in plain English, backtested and then run on the account you choose.') + tabs + '<div id="botBody"></div>' +
    planLine(lim, [`${lim.bots} bot${lim.bots === 1 ? '' : 's'} at once (${d.active} running)`, `checks ${lim.botEveryMin >= 1440 ? 'once a day' : `every ${lim.botEveryMin} min`}`, lim.botsLive ? 'real accounts' : 'practice account', `${lim.nlBuilds} plain-English builds a day`, lim.marketplaceCopy ? 'marketplace copy' : 'marketplace browsing']) + NOTE;
  const body = H.$('#botBody', view);
  const create = async (kind, f, extra = {}) => {
    const v = H.form(f), config = kind === 'rule' ? extra.config : Object.fromEntries(Object.entries(v).filter(([k]) => !['name', 'symbol', 'account', 'everyMin', 'kind'].includes(k)).map(([k, x]) => [k, x === '' ? null : +x]));
    const b = await H.api('/aibots', { body: { kind, name: v.name, symbol: v.symbol || extra.symbol, account: v.account, everyMin: +v.everyMin || undefined, config } });
    return b;
  };
  if (tab === 'builder') {
    body.innerHTML = `<form class="card" id="nl"><h2>Describe your strategy</h2><p class="mu" style="margin-top:0">${KIND_HELP.rule} Daily prices; the bot decides once a day in the last half hour of the session.</p>
      <textarea name="text" rows="3" placeholder="Buy AAPL when 14-day RSI crosses below 30 and institutional volume spikes, sell when RSI goes above 70, stop loss 5%">${H.esc(q.get('text') || '')}</textarea>
      <div class="chips">${['Buy SPY when the price crosses above the 50-day SMA, sell when it crosses below', 'Buy QQQ when 2-day RSI crosses below 10, sell when RSI is above 70, stop loss 6%', 'Buy $500 of NVDA when it drops 4% in a day, take profit 8%, sell after 10 days'].map(x => `<button type="button" class="small ghost" data-ex="${H.esc(x)}">${H.esc(x.slice(0, 48))}…</button>`).join('')}</div>
      <button>Read my rules</button><div class="err"></div></form><div id="nlOut"></div>`;
    const f = H.$('#nl', body);
    H.$$('[data-ex]', f).forEach(b => (b.onclick = () => { f.text.value = b.dataset.ex; }));
    H.act(H.$('button:not([type])', f), async () => {
      const r = await H.api('/aibots/parse', { body: { text: f.text.value } });
      const out = H.$('#nlOut', body);
      out.innerHTML = `<form class="card" id="nlBot"><h2>Your rules</h2><p><b>${H.esc(r.summary)}</b></p>${r.warnings.map(w => `<p class="banner">${H.esc(w)}</p>`).join('')}<p class="mu small-print">Read by ${r.by === 'ai' ? 'the AI' : 'the built-in rule reader'}.</p>
        <div class="row"><label>Symbol<input name="symbol" value="${H.esc(r.symbol)}" data-no-tr></label><label>Backtest years<input name="years" type="number" min="1" max="${lim.backtestYears}" value="${Math.min(10, lim.backtestYears)}"></label></div>
        <button type="button" id="nlBt">Backtest</button><div class="err"></div><div id="nlRes"></div>
        <h3>Run it as a bot</h3><div class="row"><label>Name<input name="name" value="${H.esc(r.symbol)} rules"></label>${acctSel}</div><button type="button" id="nlGo">Create the bot</button><div class="err"></div></form>`;
      const g = H.$('#nlBot', out), cfg = { entry: r.entry, exit: r.exit, stopPct: r.stopPct, targetPct: r.targetPct, holdDays: r.holdDays, amount: r.amount, summary: r.summary };
      H.act(H.$('#nlBt', g), async () => {
        const v = H.form(g), b = await H.api('/aibots/backtest', { body: { kind: 'rule', symbol: v.symbol, years: +v.years, config: cfg } });
        H.$('#nlRes', g).innerHTML = `<div class="stats"><div class="stat"><span>Strategy</span><b>${pc(b.totalReturn)}</b></div><div class="stat"><span>Buy and hold</span><b>${pc(b.buyHold)}</b></div><div class="stat"><span>Max drawdown</span><b>${pc(b.maxDrawdown)}</b></div><div class="stat"><span>Trades</span><b>${b.trades}</b></div><div class="stat"><span>Win rate</span><b>${b.winRate ?? '-'}%</b></div><div class="stat"><span>Average trade</span><b>${pc(b.avgTrade)}</b></div></div><canvas id="nlCv" style="height:180px"></canvas>${b.volume ? '' : '<p class="mu small-print">No volume data: volume rules used unusual price moves instead.</p>'}`;
        H.drawChart(H.$('#nlCv', g), b.curve, { base: 100, legend: false }); return '';
      });
      H.act(H.$('#nlGo', g), async () => { await create('rule', g, { config: cfg }); location.hash = '#/aibots?tab=mine'; return 'Created'; });
      return '';
    });
  } else if (tab === 'new') {
    body.innerHTML = `<div class="card"><h2>Ready-made bots</h2><div class="grid">${d.templates.map(t => `<div class="card tpl"><h3>${H.esc(t.name)}</h3><p class="mu">${H.esc(t.about)}</p><p><span class="pill">${H.esc(d.kinds[t.kind])}</span> <span data-no-tr>${H.esc(t.symbol)}</span></p><button class="small" data-tpl="${t.key}">Use this</button></div>`).join('')}</div></div>
      <form class="card" id="nb"><h2>New bot</h2><div class="row"><label>Type<select name="kind">${['dca', 'grid', 'scalp'].map(k => `<option value="${k}">${H.esc(d.kinds[k])}</option>`).join('')}</select></label><label>Symbol<input name="symbol" value="SPY" data-no-tr></label><label>Name<input name="name" placeholder="optional"></label>${acctSel}<label>Check every (min)<input name="everyMin" type="number" min="${lim.botEveryMin}" value="${Math.max(lim.botEveryMin, 15)}"></label></div>
        <p class="mu" id="kh"></p><div id="kf"></div><button type="button" id="nbBt">Backtest</button> <button id="nbGo">Create the bot</button><div class="err"></div><div id="nbRes"></div></form>`;
    const f = H.$('#nb', body), draw = (k, c = {}) => { H.$('#kh', f).textContent = KIND_HELP[k]; H.$('#kf', f).innerHTML = fields[k](c); H.$('#nbBt', f).hidden = k === 'scalp'; };
    draw('dca'); f.kind.onchange = () => draw(f.kind.value);
    H.$$('[data-tpl]', body).forEach(b => (b.onclick = async () => {
      const t = d.templates.find(x => x.key === b.dataset.tpl);
      if (t.kind === 'rule') { location.hash = '#/aibots?tab=builder&text=' + encodeURIComponent(t.text); return; }
      let c = { ...t.config };
      if (t.kind === 'grid') { const p = (await H.api('/quote/' + encodeURIComponent(t.symbol)).catch(() => null))?.price; if (p) c = { lower: +(p * (1 + c.lowerPct / 100)).toFixed(2), upper: +(p * (1 + c.upperPct / 100)).toFixed(2), levels: c.levels, qtyPerLevel: c.qtyPerLevel }; }
      f.kind.value = t.kind; f.symbol.value = t.symbol; f.name.value = t.name; draw(t.kind, c); f.scrollIntoView({ behavior: 'smooth' });
    }));
    H.act(H.$('#nbBt', f), async () => {
      const v = H.form(f), config = Object.fromEntries(Object.entries(v).filter(([k]) => !['name', 'symbol', 'account', 'everyMin', 'kind'].includes(k)).map(([k, x]) => [k, x === '' ? null : +x]));
      const b = await H.api('/aibots/backtest', { body: { kind: v.kind, symbol: v.symbol, years: 5, config } });
      H.$('#nbRes', f).innerHTML = v.kind === 'dca' ? `<div class="stats"><div class="stat"><span>Invested</span><b>${H.money(b.invested)}</b></div><div class="stat"><span>Worth now</span><b>${H.money(b.value)}</b></div><div class="stat"><span>Return</span><b>${pc(b.totalReturn)}</b></div><div class="stat"><span>Average cost</span><b>${H.money(b.avgCost)}</b></div><div class="stat"><span>Buys</span><b>${b.buys}</b></div></div>`
        : `<div class="stats"><div class="stat"><span>Grid buys</span><b>${b.buys}</b></div><div class="stat"><span>Grid sells</span><b>${b.sells}</b></div><div class="stat"><span>Profit from the grid</span><b>${H.money(b.gridProfit)}</b></div><div class="stat"><span>Still held</span><b>${H.num(b.openQty, 4)}</b></div></div><p class="mu small-print">${H.esc(b.note || '')}</p>`;
      return '';
    });
    H.act(H.$('#nbGo', f), async () => { const v = H.form(f); await create(v.kind, f); location.hash = '#/aibots?tab=mine'; return 'Created'; });
  } else if (tab === 'mine') {
    body.innerHTML = `<div class="card"><div class="tablewrap"><table><tr><th>Bot</th><th>Account</th><th>Checks</th><th>Last</th><th></th></tr>${d.bots.map(b => `<tr><td><b>${H.esc(b.name)}</b><div class="mu">${H.esc(d.kinds[b.kind])} · <span data-no-tr>${H.esc(b.symbol)}</span>${b.config.summary ? ' · ' + H.esc(b.config.summary) : ''}</div></td><td>${H.esc(b.account)}</td><td>${b.every_min >= 1380 ? 'daily' : `every ${b.every_min} min`}</td><td class="mu">${H.esc(b.last_result || 'not run yet')}</td>
      <td style="white-space:nowrap"><button class="small ${b.active ? 'ghost' : ''}" data-on="${b.id}" data-v="${b.active ? 0 : 1}">${b.active ? 'Pause' : 'Start'}</button> <button class="small ghost" data-share="${b.id}" data-v="${b.shared ? 0 : 1}">${b.shared ? 'Unshare' : 'Share'}</button> <button class="small ghost" data-del="${b.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="mu">No bots yet. Start with the plain-English builder or a ready-made bot.</td></tr>'}</table></div></div>`;
    H.$$('[data-on]', body).forEach(b => H.act(b, async () => { await H.api('/aibots/' + b.dataset.on, { method: 'PUT', body: { active: b.dataset.v === '1' } }); H.render(); }));
    H.$$('[data-share]', body).forEach(b => H.act(b, async () => { const on = b.dataset.v === '1', desc = on ? prompt('A sentence about this bot for the marketplace:') ?? '' : ''; await H.api(`/aibots/${b.dataset.share}/publish`, { body: { shared: on, description: desc } }); H.render(); }));
    H.$$('[data-del]', body).forEach(b => H.act(b, async () => { if (!confirm('Delete this bot? Positions it bought stay in the account.')) return ''; await H.api('/aibots/' + b.dataset.del, { method: 'DELETE' }); H.render(); }));
  } else {
    // The AI strategy marketplace lives in the Marketplace section now.
    location.replace('#/aimarket');
  }
}

// ---------- AI signals ----------
async function aisignals(view) {
  const [d, accts] = await Promise.all([H.api('/aisignals'), H.accounts()]), lim = d.limits, a = d.auto;
  const run = d.lastRun;
  view.innerHTML = head('AI signals', 'Every night the engine tests a dozen trading setups across years of history for each stock and fund, then picks today\'s highest-probability trades, each with a stop loss and a profit target.') + `
  <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Signals for ${H.esc(d.day || '-')}</h2><span class="mu">${run ? `${(run.scenarios || 0).toLocaleString()} historical scenarios over ${run.symbols} symbols` : 'The first run is tonight after the close.'}</span></div>
    <div class="tablewrap"><table><tr><th>Symbol</th><th>Setup</th><th>Entry</th><th>Stop</th><th>Target</th><th>Won before</th><th>Average move</th><th>Times seen</th><th>Holding</th></tr>${d.signals.map(s => `<tr><td><a href="#/chart?symbol=${encodeURIComponent(s.symbol)}" data-no-tr><b>${H.esc(s.symbol)}</b></a></td><td>${H.esc(s.setupName)}</td><td>${H.money(s.entry)}</td><td>${H.money(s.stop)}</td><td>${H.money(s.target)}</td><td>${s.win_rate}%</td><td>${pc(s.avg_return)}</td><td>${s.samples}</td><td>${s.horizon} days</td></tr>`).join('') || '<tr><td colspan="9" class="mu">No signals yet for this session.</td></tr>'}</table></div>
    ${d.total > d.shown ? `<p class="banner">${d.total - d.shown} more signals today with a higher plan. <a href="#/funding">See plans</a></p>` : ''}
    <p class="mu small-print">"Won before" blends this symbol's own record with how the setup did across all symbols. Stops and targets come from each stock's recent daily range.</p></div>
  <div class="grid">
    <form class="card" id="auto"><h2>Automatic trades</h2><p class="mu" style="margin-top:0">After the first five minutes of the session, open signals become orders. Stops move to break-even once a trade gains as much as it risked, then trail it; trades close at the target, the stop or the end of the holding period.</p>
      <label class="check"><input type="checkbox" name="enabled" ${a.enabled ? 'checked' : ''} ${lim.signalAuto === 'off' ? 'disabled' : ''}> Trade the signals automatically${lim.signalAuto === 'off' ? ' · Pro' : ''}</label>
      <div class="row"><label>Account<select name="account">${accts.filter(x => x.connected).map(x => `<option value="${x.id}" ${x.id === a.account ? 'selected' : ''} ${x.id !== 'paper' && lim.signalAuto !== 'live' ? 'disabled' : ''}>${H.esc(H.acctLabel(x))}${x.id !== 'paper' && lim.signalAuto !== 'live' ? ' · Elite' : ''}</option>`).join('')}</select></label>
        <label>Dollars per trade<input name="perTradeUsd" type="number" min="10" value="${a.perTradeUsd}"></label><label>Most open trades<input name="maxOpen" type="number" min="1" max="50" value="${a.maxOpen}"></label><label>Only signals that won at least (%)<input name="minWinRate" type="number" min="50" max="90" value="${a.minWinRate}"></label></div>
      <button>Save</button><div class="err"></div></form>
    <form class="card" id="cust"><h2>Custom signal engine</h2><p class="mu" style="margin-top:0">Run the same setups now on your own list of up to 30 symbols.</p>
      <label>Symbols<input name="symbols" placeholder="e.g. SHOP, UBER, COIN, ARM" data-no-tr></label>
      <div class="chips">${Object.entries(d.setups).map(([k, s]) => `<label class="chk"><input type="checkbox" name="s:${k}" checked>${H.esc(s.name)}</label>`).join('')}</div>
      <button ${lim.customSignals ? '' : 'disabled'}>Run</button>${lim.customSignals ? '' : ' <span class="mu">Elite</span>'}<div class="err"></div><div id="custOut"></div></form>
  </div>
  <div class="card"><h2>My signal trades</h2><div class="tablewrap"><table><tr><th>Opened</th><th>Symbol</th><th>Shares</th><th>Entry</th><th>Stop</th><th>Target</th><th>Status</th><th>Exit</th></tr>${d.trades.map(t => `<tr><td>${when(t.opened_at)}</td><td data-no-tr>${H.esc(t.symbol)}</td><td>${H.num(t.qty, 4)}</td><td>${H.money(t.entry)}</td><td>${H.money(t.stop)}</td><td>${H.money(t.target)}</td><td>${H.esc(t.status)}${t.note ? ` <span class="mu">(${H.esc(t.note)})</span>` : ''}</td><td>${t.exit_price ? H.money(t.exit_price) : '-'}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">None yet.</td></tr>'}</table></div></div>
  ${planLine(lim, [`${lim.signals} signals a day`, { off: 'no automatic trades', paper: 'automatic trades on the practice account', live: 'automatic trades on real accounts' }[lim.signalAuto], lim.customSignals ? 'custom engines' : 'standard engine'])}${NOTE}`;
  const f = H.$('#auto', view);
  H.act(H.$('button', f), async () => { const v = H.form(f); await H.api('/aisignals/auto', { method: 'PUT', body: { ...v, enabled: !!v.enabled } }); return 'Saved'; });
  const c = H.$('#cust', view);
  H.act(H.$('button', c), async () => {
    const v = H.form(c), setups = Object.keys(v).filter(k => k.startsWith('s:') && v[k]).map(k => k.slice(2));
    const r = await H.api('/aisignals/custom', { body: { symbols: v.symbols, setups } });
    H.$('#custOut', c).innerHTML = `<p class="mu">${r.scenarios.toLocaleString()} scenarios over ${r.symbols} symbols.</p>` + (r.signals.length ? `<div class="tablewrap"><table><tr><th>Symbol</th><th>Setup</th><th>Entry</th><th>Stop</th><th>Target</th><th>Won before</th></tr>${r.signals.map(s => `<tr><td data-no-tr>${H.esc(s.symbol)}</td><td>${H.esc(s.setupName)}</td><td>${H.money(s.entry)}</td><td>${H.money(s.stop)}</td><td>${H.money(s.target)}</td><td>${s.win_rate}%</td></tr>`).join('')}</table></div>` : '<p class="mu">None of the setups appear on these symbols today.</p>');
    return '';
  });
}

// ---------- Market intelligence ----------
async function intel(view, q) {
  const d = await H.api('/intel'), lim = d.limits;
  const sym = (q.get('symbol') || '').toUpperCase();
  view.innerHTML = head('Market intelligence', 'The data professionals read, turned into plain answers: earnings calls, unusual options activity, dark-pool volume and whale wallets.') + `
  <form class="card row" id="askF" style="align-items:flex-end"><label style="flex:1">Ask<input name="q" placeholder="e.g. unusual options on NVDA · dark pool activity in AAPL · my whale wallets" value="${H.esc(q.get('q') || '')}"></label><button>Ask</button></form><div id="askOut"></div>
  <div class="grid">
    <form class="card" id="flowF"><h2>Unusual options flow</h2><p class="mu" style="margin-top:0">Contracts trading far above their open interest, with the premium paid. ${{ realtime: 'Real time', delayed: 'Updated every 15 minutes', eod: 'End of day' }[lim.optionsFlow]} on your plan.</p>
      <div class="row"><label>Symbol<input name="symbol" value="${H.esc(sym || 'SPY')}" data-no-tr></label><button>Show</button></div><div class="err"></div><div id="flowOut"></div></form>
    <form class="card" id="dpF"><h2>Dark-pool (off-exchange) volume</h2><p class="mu" style="margin-top:0">Daily volume dark pools and wholesalers report to FINRA, and the share sold short. Spikes are marked.</p>
      <div class="row"><label>Symbol<input name="symbol" value="${H.esc(sym || 'AAPL')}" data-no-tr></label><button>Show</button></div><div class="err"></div><div id="dpOut"></div></form>
  </div>
  <form class="card" id="ecF"><h2>AI earnings-call summary</h2><p class="mu" style="margin-top:0">Paste a transcript (even an 80-page one). You get the numbers, guidance, risks, tone and what analysts pressed on.${lim.earningsSummaries ? ` ${lim.earningsSummaries} a month on your plan.` : ''}</p>
    ${lim.earningsSummaries ? `<div class="row"><label>Symbol<input name="symbol" data-no-tr placeholder="optional"></label><label style="flex:2">Title<input name="title" placeholder="e.g. Q3 2026 earnings call"></label></div><textarea name="text" rows="6" placeholder="Paste the transcript here"></textarea><button>Summarize</button><div class="err"></div>` : '<p class="banner">AI earnings-call summaries are part of Pro. <a href="#/funding">See plans</a></p>'}
    <div id="ecOut"></div>${d.summaries.length ? `<h3>Earlier summaries</h3>${d.summaries.map(s => `<a href="#" data-sum="${s.id}">${H.esc([s.symbol, s.title].filter(Boolean).join(' · ') || 'Summary')} (${when(s.created_at)})</a>`).join(' · ')}` : ''}</form>
  <form class="card" id="whF"><h2>Whale wallets</h2><p class="mu" style="margin-top:0">Follow large Bitcoin or Ethereum addresses; you get a message when one moves more than your threshold. Up to ${lim.whales} on your plan.</p>
    <div class="row"><label>Chain<select name="chain"><option value="btc">Bitcoin</option><option value="eth">Ethereum</option></select></label><label style="flex:2">Address<input name="address" data-no-tr></label><label>Name<input name="label" placeholder="optional"></label><label>Alert when it moves at least<input name="threshold" type="number" step="any" placeholder="100 BTC / 1000 ETH"></label><button>Follow</button></div><div class="err"></div>
    <div class="tablewrap"><table><tr><th>Wallet</th><th>Balance</th><th>Last move</th><th></th></tr>${d.whales.map(w => `<tr><td><b>${H.esc(w.label || '')}</b> <span class="mu" data-no-tr>${H.esc(w.chain.toUpperCase())} ${H.esc(w.address.slice(0, 12))}…</span></td><td>${w.balance != null ? H.num(w.balance, 4) : '-'}${w.prev_balance != null && w.balance != null && w.balance !== w.prev_balance ? ` <span class="${H.cls(w.balance - w.prev_balance)}">(${w.balance - w.prev_balance > 0 ? '+' : ''}${H.num(w.balance - w.prev_balance, 4)})</span>` : ''}</td><td>${when(w.moved_at)}</td><td><button class="small ghost" data-unw="${w.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="mu">No wallets yet.</td></tr>'}</table></div></form>
  <p class="mu small-print">Institutional holdings (13F): <a href="#/institutions">Institutional portfolios</a>.</p>${NOTE}`;
  const flowHtml = r => `<p><b>${H.esc(r.lean)}</b> · calls ${H.money(r.callPremium)} · puts ${H.money(r.putPremium)} <span class="mu">(${new Date(r.at).toLocaleTimeString()})</span></p><div class="tablewrap"><table><tr><th>Contract</th><th>Volume</th><th>Open interest</th><th>× OI</th><th>Premium</th><th>IV</th></tr>${r.rows.map(x => `<tr><td>${x.type} ${x.strike} · ${x.expiration}<div class="mu">${x.moneyness || ''}</div></td><td>${x.volume.toLocaleString()}</td><td>${x.openInterest.toLocaleString()}</td><td>${x.ratio}</td><td>${H.money(x.premium)}</td><td>${x.iv ?? '-'}%</td></tr>`).join('') || '<tr><td colspan="6" class="mu">Nothing unusual right now.</td></tr>'}</table></div>`;
  const dpHtml = r => `<p class="mu">20-day average: ${(r.avgOffExchange || 0).toLocaleString()} shares a day off-exchange.</p><div class="tablewrap"><table><tr><th>Day</th><th>Off-exchange volume</th><th>Sold short</th></tr>${r.days.slice(-12).reverse().map(x => `<tr><td>${x.day}${x.spike ? ' <span class="pill warn">spike</span>' : ''}</td><td>${(x.offExchange || 0).toLocaleString()}</td><td>${x.shortPct ?? '-'}%</td></tr>`).join('')}</table></div><p class="mu small-print">${H.esc(r.note)}</p>`;
  const fl = H.$('#flowF', view); H.act(H.$('button', fl), async () => { H.$('#flowOut', fl).innerHTML = flowHtml(await H.api('/intel/flow?symbol=' + encodeURIComponent(fl.symbol.value))); return ''; });
  const dp = H.$('#dpF', view); H.act(H.$('button', dp), async () => { H.$('#dpOut', dp).innerHTML = dpHtml(await H.api('/intel/darkpool?symbol=' + encodeURIComponent(dp.symbol.value))); return ''; });
  const summary = (s, words) => `<div class="card"><h3>Summary${s.tone ? ` · tone: ${H.esc(s.tone)}` : ''}</h3>${[['Highlights', s.highlights], ['Key numbers', s.keyNumbers], ['Guidance', s.guidance], ['Risks', s.risks], ['What analysts asked', s.analystQuestions]].filter(([, x]) => x?.length).map(([t, x]) => `<h4>${t}</h4><ul>${x.map(y => `<li>${H.esc(y)}</li>`).join('')}</ul>`).join('')}<p class="mu small-print">By ${H.esc(s.by || 'AI')}${words ? ` · ${words.toLocaleString()} words read` : ''}. Check figures against the company's release.</p></div>`;
  const ec = H.$('#ecF', view);
  if (lim.earningsSummaries) H.act(H.$('button', ec), async () => { const v = H.form(ec); const r = await H.api('/intel/earnings', { body: v }); H.$('#ecOut', ec).innerHTML = summary(r.summary, r.words); return `${r.left} left this month`; });
  H.$$('[data-sum]', ec).forEach(a => (a.onclick = async e => { e.preventDefault(); const r = await H.api('/intel/earnings/' + a.dataset.sum); H.$('#ecOut', ec).innerHTML = summary(r.summary); }));
  const wh = H.$('#whF', view); H.act(H.$('button', wh), async () => { const v = H.form(wh); await H.api('/intel/whales', { body: v }); H.render(); return 'Following'; });
  H.$$('[data-unw]', view).forEach(b => H.act(b, async () => { await H.api('/intel/whales/' + b.dataset.unw, { method: 'DELETE' }); H.render(); }));
  const af = H.$('#askF', view);
  const ask = async () => {
    const out = H.$('#askOut', view); out.innerHTML = '<div class="card mu">Working…</div>';
    try {
      const r = await H.api('/intel/ask', { body: { q: af.q.value } });
      out.innerHTML = `<div class="card">${r.intent === 'flow' && r.result ? `<h2>Options flow · ${H.esc(r.symbol)}</h2>${flowHtml(r.result)}` : r.intent === 'darkpool' && r.result ? `<h2>Off-exchange volume · ${H.esc(r.symbol)}</h2>${dpHtml(r.result)}` : r.intent === 'whales' && r.result ? `<p>${r.result?.length ? `${r.result.length} wallets followed; see below.` : 'No whale wallets followed yet; add one below.'}</p>` : `<p>${H.esc(r.hint || '')}${r.intent === 'assistant' ? ' Or ask the <a href="#/ai">AI assistant</a>.' : r.intent === 'institutions' ? ' <a href="#/institutions">Open institutional portfolios</a>.' : ''}</p>`}</div>`;
    } catch (e) { out.innerHTML = `<div class="card err">${H.esc(e.message)}</div>`; }
  };
  af.onsubmit = e => { e.preventDefault(); ask(); };
  if (q.get('q')) ask();
}
