// Analysis & money: portfolio insights (time-weighted return, P/L by symbol and strategy, the
// trade journal, live-vs-expected execution, what-if), risk guardrails and the kill switch, values
// investing (screens, maaser, Shabbos and Yom Tov), institutional 13F portfolios, spend-based
// investing and news sentiment.
import { canvasNote } from './i18n.js';
let H;
// Re-render after a short delay, unless the user has moved to another page by then.
const later = ms => { const h = location.hash; setTimeout(() => location.hash === h && H.render(), ms); };
export function registerAnalytics(routes, helpers) {
  H = helpers;
  Object.assign(routes, { insights, risk, values, halal: () => (location.hash = '#/values'), institutions, spend, news });
}
const pc = (v, d = 1) => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);
const tabsHtml = (list, on) => `<div class="seg pagetabs">${list.map(([k, t]) => `<button type="button" data-tab="${k}" class="${k === on ? 'on' : ''}">${t}</button>`).join('')}</div>`;
const wireTabs = (view, route, extra = '') => H.$$('[data-tab]', view).forEach(b => (b.onclick = () => (location.hash = `#/${route}?tab=${b.dataset.tab}${extra}`)));
const stat = (k, v, c = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`;
const acctPicker = (accts, cur) => `<label class="inline">Account <select id="acct">${H.accountOptions(accts, cur)}</select></label>`;

// Horizontal bars for a signed value per label (P/L by symbol, what-if).
function bars(canvas, rows) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
  if (!rows.length) { g.fillStyle = C('--mu'); canvasNote(g, 'No data yet'); return; }
  const max = Math.max(...rows.map(r => Math.abs(r.v)), 1e-9), bw = (w - 20) / rows.length, y0 = h / 2;
  g.strokeStyle = C('--bd'); g.beginPath(); g.moveTo(0, y0); g.lineTo(w, y0); g.stroke();
  g.font = '11px Inter, system-ui, sans-serif'; g.textAlign = 'center';
  rows.forEach((r, i) => {
    const x = 10 + i * bw, bh = (Math.abs(r.v) / max) * (h / 2 - 22);
    g.fillStyle = r.v >= 0 ? C('--gr') : C('--rd'); g.fillRect(x + bw * 0.18, r.v >= 0 ? y0 - bh : y0, bw * 0.64, bh);
    g.fillStyle = C('--mu'); g.fillText(r.k, x + bw / 2, r.v >= 0 ? y0 + 14 : y0 - 6);
  });
}

// ---------- insights + journal ----------
async function insights(view, q) {
  const accts = await H.accounts(), account = q.get('account') || H.state.account || 'paper', tab = q.get('tab') || 'overview';
  const head = `<div class="pagehead row" style="justify-content:space-between;align-items:flex-end"><div><h1>Insights</h1><p class="mu">How your trading is really going: time-weighted return, profit by symbol and by strategy, your journal, and how live fills compare with the prices your signals expected.</p></div>${acctPicker(accts, account)}</div>
    ${tabsHtml([['overview', 'Overview'], ['journal', 'Journal'], ['execution', 'Live vs expected']], tab)}`;
  if (tab === 'journal') return journal(view, head, account);
  const d = await H.api('/insights?account=' + encodeURIComponent(account)), s = d.stats;
  if (tab === 'execution') {
    const e = d.execution;
    view.innerHTML = `${head}<div class="card"><h2>Live fills vs the price the signal expected</h2><p class="mu">Every bot, alert, scanner and fleet order records the price when its signal fired. The gap to the fill is slippage plus delay: the difference between a backtest and real trading.</p>
      <div class="tablewrap"><table><tr><th>Source</th><th>Fills</th><th>Avg slippage</th><th>Total cost</th><th>Median delay</th></tr>
      ${e.bySource.map(g => `<tr><td>${H.esc(g.source)}</td><td>${g.fills}</td><td class="${H.cls(-g.avgSlipBps)}">${g.avgSlipBps} bps</td><td class="${H.cls(-g.costUsd)}">${H.money(g.costUsd)}</td><td>${g.medianDelaySec == null ? '-' : g.medianDelaySec + ' s'}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No automated fills with an expected price yet</td></tr>'}</table></div>
      <h3 style="margin-top:16px">Recent fills</h3><div class="tablewrap"><table><tr><th>When</th><th>Symbol</th><th>Side</th><th>Expected</th><th>Filled</th><th>Slippage</th><th>Delay</th><th>Source</th></tr>
      ${e.recent.map(r => `<tr><td>${H.date(r.at)}</td><td>${H.esc(r.symbol)}</td><td>${r.side}</td><td>${H.money(r.expected)}</td><td>${H.money(r.price)}</td><td class="${H.cls(-r.slipBps)}">${r.slipBps} bps</td><td>${r.delaySec ?? '-'} s</td><td>${H.esc(r.source)}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">Nothing yet</td></tr>'}</table></div>
      <p class="mu small-print">Positive slippage (red) means you paid more on a buy, or got less on a sell, than the signal price.</p></div>`;
    return wire();
  }
  view.innerHTML = `${head}${d.error ? `<div class="banner">${H.esc(d.error)}</div>` : ''}
  <div class="stats">${stat('Time-weighted return', pc(d.twr.total, 2), H.cls(d.twr.total))}${stat('Per year', pc(d.twr.annualized, 1), H.cls(d.twr.annualized))}${stat('Closed trades', s.trades)}${stat('Win rate', s.winRate == null ? '-' : s.winRate + '%')}
    ${stat('Avg win / loss', `${s.avgWin == null ? '-' : H.money(s.avgWin)} / ${s.avgLoss == null ? '-' : H.money(s.avgLoss)}`)}${stat('Profit factor', s.profitFactor ?? '-')}${stat('Expectancy per trade', s.expectancy == null ? '-' : H.money(s.expectancy), H.cls(s.expectancy))}${stat('Avg hold', s.avgHoldDays == null ? '-' : s.avgHoldDays + ' days')}</div>
  <div class="card"><h2>Time-weighted return</h2><canvas class="chart" id="twrCh"></canvas><p class="mu small-print">Deposits and withdrawals are taken out, so this measures your decisions, not your contributions.</p></div>
  <div class="grid">
    <div class="card"><h2>Profit by symbol</h2><canvas class="chart" id="symCh" style="height:200px"></canvas><div class="tablewrap"><table><tr><th>Symbol</th><th>Realized</th><th>Open</th><th>Total</th><th>Trades</th></tr>
      ${d.bySymbol.map(r => `<tr><td>${H.esc(r.symbol)}</td><td class="${H.cls(r.realized)}">${H.money(r.realized)}</td><td class="${H.cls(r.unrealized)}">${H.money(r.unrealized)}</td><td class="${H.cls(r.total)}"><b>${H.money(r.total)}</b></td><td>${r.trades}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No trades yet</td></tr>'}</table></div></div>
    <div class="card"><h2>Profit by strategy</h2><div class="tablewrap"><table><tr><th>Source</th><th>Trades</th><th>Win rate</th><th>P/L</th></tr>
      ${d.bySource.map(r => `<tr><td>${H.esc(r.source)}</td><td>${r.trades}</td><td>${r.winRate}%</td><td class="${H.cls(r.pnl)}">${H.money(r.pnl)}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">No closed trades yet</td></tr>'}</table></div>
      <h3 style="margin-top:16px">By weekday</h3><div class="tablewrap"><table><tr><th>Day</th><th>Trades</th><th>Win rate</th><th>P/L</th></tr>${s.byWeekday.map(r => `<tr><td>${H.esc(r.key)}</td><td>${r.trades}</td><td>${r.winRate}%</td><td class="${H.cls(r.pnl)}">${H.money(r.pnl)}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">-</td></tr>'}</table></div></div>
  </div>
  <div class="card"><h2>What if the market moves?</h2><p class="mu">Profit or loss on today's holdings if every position moved by the same percentage.</p><canvas class="chart" id="wiCh" style="height:200px"></canvas></div>`;
  H.drawChart(H.$('#twrCh', view), d.twr.series.map(x => 100 + x.twr), { base: 100 });
  bars(H.$('#symCh', view), d.bySymbol.slice(0, 12).map(r => ({ k: r.symbol, v: r.total })));
  bars(H.$('#wiCh', view), d.whatIf.map(r => ({ k: (r.move > 0 ? '+' : '') + r.move + '%', v: r.pnl })));
  wire();
  function wire() { wireTabs(view, 'insights', '&account=' + encodeURIComponent(account)); H.$('#acct', view).onchange = e => (location.hash = `#/insights?tab=${tab}&account=${e.target.value}`); }
}
async function journal(view, head, account) {
  const d = await H.api('/insights/journal?account=' + encodeURIComponent(account));
  view.innerHTML = `${head}<div class="card"><h2>Trade journal</h2><p class="mu">Every closed trade is logged automatically with its entry, exit, holding time and the strategy that opened it. Add what you were thinking and tags like <i>FOMO</i> or <i>earnings</i> to find your patterns.</p>
    <div class="row"><input id="jFind" placeholder="Filter by symbol, tag or note" style="max-width:320px"></div>
    <div class="tablewrap"><table id="jt"><tr><th>Closed</th><th>Symbol</th><th>Qty</th><th>Entry → exit</th><th>P/L</th><th>Held</th><th>Opened by</th><th>Notes</th></tr>
    ${d.trips.map(t => `<tr data-f="${t.exitFill}" data-text="${H.esc(`${t.symbol} ${t.tags} ${t.note} ${t.source}`.toLowerCase())}"><td>${H.date(t.closedAt)}</td><td>${H.esc(t.symbol)}</td><td>${+t.qty}</td><td>${H.money(t.entry)} → ${H.money(t.exit)}</td>
      <td class="${H.cls(t.pnl)}">${H.money(t.pnl)} <span class="small-print">${pc(t.pnlPct)}</span></td><td>${t.holdDays < 1 ? Math.round(t.holdDays * 24) + ' h' : t.holdDays + ' d'}</td><td>${H.esc(t.source)}</td>
      <td class="jn"><input class="note" value="${H.esc(t.note)}" placeholder="What happened?" aria-label="Note"><input class="tags" value="${H.esc(t.tags)}" placeholder="tags, comma separated" aria-label="Tags"></td></tr>`).join('') || '<tr><td colspan="8" class="mu">No closed trades yet. Trades appear here automatically.</td></tr>'}
    </table></div><div class="err" id="jErr"></div></div>`;
  wireTabs(view, 'insights', '&account=' + encodeURIComponent(account));
  H.$('#acct', view).onchange = e => (location.hash = `#/insights?tab=journal&account=${e.target.value}`);
  H.$('#jFind', view).oninput = e => { const s = e.target.value.trim().toLowerCase(); H.$$('#jt tr[data-f]', view).forEach(tr => (tr.hidden = !!s && !tr.dataset.text.includes(s))); };
  H.$$('#jt tr[data-f] input', view).forEach(i => (i.onchange = async () => {
    const tr = i.closest('tr');
    try { await H.api('/insights/journal/' + tr.dataset.f, { method: 'PUT', body: { note: H.$('.note', tr).value, tags: H.$('.tags', tr).value } }); i.classList.add('saved'); setTimeout(() => i.classList.remove('saved'), 1200); }
    catch (e) { H.$('#jErr', view).textContent = e.message; }
  }));
}

// ---------- risk guardrails ----------
async function risk(view) {
  const [d, accts] = await Promise.all([H.api('/risk'), H.accounts()]), s = d.settings;
  view.innerHTML = `<div class="pagehead"><h1>Risk controls</h1><p class="mu">Limits checked on every order, whether you place it or a bot, alert, scanner, portfolio or followed channel does. Leave a field at 0 for no limit.</p></div>
  <div class="card killcard ${s.kill ? 'on' : ''}"><div><h2>Kill switch ${s.kill ? '<span class="pill warn">ON</span>' : ''}</h2>
    <p class="mu">${s.kill ? 'All automated trading and all new buys are stopped. You can still sell to close positions.' : 'One tap stops every bot, scanner, portfolio and mirrored signal, blocks new buys and cancels open Alpaca orders.'}</p></div>
    <button id="kill" class="${s.kill ? 'ghost' : 'danger'}">${s.kill ? 'Turn trading back on' : 'Stop all trading'}</button></div>
  <form class="card" id="rk"><h2>Limits</h2>
    <div class="row"><label>Largest single buy ($)<input name="maxOrderUsd" type="number" min="0" value="${s.maxOrderUsd}"></label><label>Largest position (% of account)<input name="maxPositionPct" type="number" min="0" max="100" value="${s.maxPositionPct}"></label><label>Buys per day<input name="maxOrdersPerDay" type="number" min="0" value="${s.maxOrdersPerDay}"></label></div>
    <h3>Daily loss limit</h3><p class="mu small-print">After losing this much in a day, new buys stop until the next trading day. This is the protection we offer for day trading; we don't sell loss insurance.</p>
    <div class="row"><label>Stop after losing ($)<input name="maxDailyLossUsd" type="number" min="0" value="${s.maxDailyLossUsd}"></label><label>... or this % of the day's starting value<input name="maxDailyLossPct" type="number" min="0" max="100" step="0.1" value="${s.maxDailyLossPct}"></label></div>
    <div class="row"><label style="flex:1 1 260px">Only allow buying these symbols<input name="allowSymbols" value="${H.esc(s.allowSymbols.join(', '))}" placeholder="empty = any" data-no-tr></label><label style="flex:1 1 260px">Never buy<input name="denySymbols" value="${H.esc(s.denySymbols.join(', '))}" placeholder="e.g. GME, AMC" data-no-tr></label></div>
    <h3>Budget guardrails</h3><p class="mu small-print">How much new money you put to work, and a pause after a losing trade before high-risk buys (options, crypto, margin).</p>
    <div class="row"><label>New buys per day ($)<input name="maxBuyUsdDay" type="number" min="0" value="${s.maxBuyUsdDay || 0}"></label><label>New buys per week ($)<input name="maxBuyUsdWeek" type="number" min="0" value="${s.maxBuyUsdWeek || 0}"></label><label>Cool-down after a loss (minutes)<input name="cooldownMin" type="number" min="0" max="1440" value="${s.cooldownMin ?? 15}"></label></div>
    <label class="chk"><input type="checkbox" name="tiered" ${s.tiered !== false ? 'checked' : ''}> Graduated limits: in very volatile markets or with high leverage, make buys smaller instead of blocking them</label>
    <p class="mu small-print">Options, crypto and margin with real money also need their short lesson on the <a href="#/learn">Learn</a> page.</p>
    <h3>Automatic stop-loss and take-profit</h3><p class="mu small-print">Checked every 5 minutes on the accounts you tick: a position down (or up) this much from your average price is sold.</p>
    <div class="row"><label>Sell when down %<input name="guardStopPct" type="number" min="0" max="95" step="0.1" value="${s.guardStopPct}"></label><label>Sell when up %<input name="guardTakePct" type="number" min="0" step="0.1" value="${s.guardTakePct}"></label></div>
    <div class="chips">${accts.filter(a => a.connected).map(a => `<label class="chk"><input type="checkbox" name="ga" value="${a.id}" ${s.guardAccounts.includes(a.id) ? 'checked' : ''}>${H.esc(H.acctLabel(a))}</label>`).join('')}</div>
    <button>Save limits</button><div class="err"></div></form>
  <div class="card"><h2>Today</h2><p>${d.ordersToday} buys placed today${s.maxOrdersPerDay ? ` of ${s.maxOrdersPerDay} allowed` : ''}.</p>
    <h3>Recent automatic sells</h3><div class="tablewrap"><table><tr><th>When</th><th>Account</th><th>Symbol</th><th>Result</th></tr>${d.guardRecent.map(g => `<tr><td>${H.date(g.at)}</td><td>${H.esc(g.account)}</td><td>${H.esc(g.symbol)}</td><td>${H.esc(g.result || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">None</td></tr>'}</table></div></div>`;
  H.act(H.$('#kill', view), async () => {
    const on = !s.kill;
    if (on && !confirm('Stop all automated trading and block new buys now?')) return;
    const r = await H.api('/risk/kill', { body: { on } }); later(900);
    return on ? `Trading stopped${r.cancelled ? `, ${r.cancelled} open orders cancelled` : ''}.` : 'Trading is back on.';
  });
  const f = H.$('#rk', view);
  H.act(H.$('button', f), async () => { await H.api('/risk', { method: 'PUT', body: { ...H.form(f), guardAccounts: H.$$('[name=ga]:checked', f).map(i => i.value) } }); return 'Saved'; });
}

// ---------- values investing: screens, maaser, Shabbos and Yom Tov ----------
const VB = { avoid: ['Avoid', 'bad'], clear: ['No flags found', 'ok'] };
const vbadge = s => `<span class="pill ${VB[s][1]}">${VB[s][0]}</span>`;
const nyTime = (t, tz) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz, timeZoneName: 'short' } : {}) });
async function values(view, q) {
  const tab = q.get('tab') || 'screen', accts = await H.accounts(), admin = H.me()?.role === 'admin', v = await H.api('/values');
  const head = `<div class="pagehead"><h1>Values investing</h1><p class="mu">Invest by your values: screen stocks and your portfolio, work out maaser, and pause trading on Shabbos and Yom Tov.</p></div>
    <p class="mu" style="margin:-6px 0 10px">Your values: <b>${H.esc(v.presets[v.preset].label)}</b> · <a href="#/values?tab=settings">change</a>${v.shabbos ? ` · <span class="pill">Shabbos and Yom Tov pause on</span>` : ''}</p>
    ${v.now ? `<div class="banner">${H.esc(v.now.name)}: trading is paused until ${nyTime(v.now.until, v.tz)}.</div>` : ''}
    ${tabsHtml([['screen', 'Screen'], ['portfolio', 'My portfolio'], ['maaser', 'Maaser'], ['shabbos', 'Shabbos & Yom Tov'], ['settings', 'My values'], ...(admin ? [['lists', 'Lists']] : [])], tab)}`;
  const note = '<p class="mu small-print">Screens use lists of companies by their main business. "No flags found" means the company is not on a list you avoid; it is not a religious or ethical approval. For questions of halacha, ask your rav.</p>';
  if (tab === 'settings') {
    view.innerHTML = `${head}<form class="card" id="vs"><h2>My values</h2>
      <div class="modes">${Object.entries(v.presets).map(([k, p]) => `<label class="mode ${v.preset === k ? 'on' : ''}"><input type="radio" name="preset" value="${k}" ${v.preset === k ? 'checked' : ''}><b>${H.esc(p.label)}</b><span class="mu">${H.esc(p.about)}</span></label>`).join('')}</div>
      <div id="customBox" ${v.preset === 'custom' ? '' : 'hidden'}><h3>Avoid</h3><div class="row" style="flex-wrap:wrap;gap:6px 18px">${Object.entries(v.categories).map(([k, t]) => `<label class="chk"><input type="checkbox" name="avoid" value="${k}" ${v.avoid.includes(k) ? 'checked' : ''}> ${H.esc(t)}</label>`).join('')}</div></div>
      <button>Save</button><div class="err"></div></form>`;
    const f = H.$('#vs', view);
    H.$$('[name=preset]', f).forEach(r => (r.onchange = () => { H.$('#customBox', view).hidden = r.value !== 'custom'; }));
    H.act(H.$('button', f), async () => { await H.api('/values', { method: 'PUT', body: { preset: H.$('[name=preset]:checked', f).value, avoid: H.$$('[name=avoid]:checked', f).map(c => c.value) } }); later(700); return 'Saved'; });
    return wireTabs(view, 'values');
  }
  if (tab === 'shabbos') {
    view.innerHTML = `${head}<form class="card" id="sh"><h2>No trading on Shabbos and Yom Tov</h2>
      <p class="mu" style="margin-top:0">When this is on, nothing trades in your accounts from candle lighting until 72 minutes after sunset at the end of Shabbos or Yom Tov: no orders, no automatic strategies, no bots, no alerts turned into trades and no crypto. Scheduled trades wait and run afterwards.</p>
      <label class="chk"><input type="checkbox" name="shabbos" ${v.shabbos ? 'checked' : ''}> Pause all trading on Shabbos and Yom Tov</label>
      <label style="max-width:320px">Times for<select name="city">${Object.entries(v.cities).map(([k, n]) => `<option value="${k}" ${v.city === k ? 'selected' : ''}>${H.esc(n)}</option>`).join('')}</select></label>
      <button>Save</button><div class="err"></div></form>
      <div class="card tablewrap"><h2>Coming up</h2><table><tr><th></th><th>Trading stops</th><th>Trading resumes</th></tr>${v.upcoming.map(x => `<tr><td><b>${H.esc(x.name)}</b></td><td>${nyTime(x.starts, v.tz)}</td><td>${nyTime(x.ends, v.tz)}</td></tr>`).join('')}</table>
      <p class="mu small-print">Times are calculated for the city you pick (candle lighting 18 minutes before sunset, 40 in Jerusalem; the end 72 minutes after sunset) and shown in that city's time. Your local luach is the authority.</p></div>`;
    const f = H.$('#sh', view);
    H.act(H.$('button', f), async () => { await H.api('/values', { method: 'PUT', body: { shabbos: f.shabbos.checked, city: f.city.value } }); later(700); return 'Saved'; });
    return wireTabs(view, 'values');
  }
  if (tab === 'maaser') {
    const y = new Date().getFullYear();
    view.innerHTML = `${head}<form class="card" id="mz"><h2>Maaser calculator</h2>
      <p class="mu" style="margin-top:0">A tenth (or a fifth, chomesh) of what your investments earned this year: realized gains, dividends and interest, less losses, from your accounts here. Add other income if you want it in the same count.</p>
      <div class="row"><label>Year<select name="year">${[0, 1, 2].map(i => `<option>${y - i}</option>`).join('')}</select></label>
        <label>Share<select name="pct"><option value="10" ${v.maaserPct === 10 ? 'selected' : ''}>Maaser (10%)</option><option value="20" ${v.maaserPct === 20 ? 'selected' : ''}>Chomesh (20%)</option></select></label>
        <label>Other income ($)<input name="otherIncome" type="number" min="0" step="any" value="0"></label><label>Given outside the tzedakah ledger ($)<input name="alreadyGiven" type="number" min="0" step="any" value="0"></label></div>
      <div class="row" style="flex-wrap:wrap;gap:6px 18px">${accts.filter(a => a.connected !== false).map(a => `<label class="chk"><input type="checkbox" name="acc" value="${H.esc(a.id)}" ${a.id === 'paper' ? '' : 'checked'}> ${H.esc(H.acctLabel(a))}</label>`).join('')}</div>
      <button>Calculate</button><div class="err"></div><div id="mzOut"></div></form>`;
    const f = H.$('#mz', view);
    H.act(H.$('button', f), async () => {
      const r = await H.api('/values/maaser', { body: { year: +f.year.value, pct: +f.pct.value, otherIncome: +f.otherIncome.value, alreadyGiven: +f.alreadyGiven.value, accounts: H.$$('[name=acc]:checked', f).map(c => c.value) } });
      H.$('#mzOut', view).innerHTML = `<div class="stats" style="margin-top:12px">${stat('Profit counted', H.money(r.profit), H.cls(r.profit))}${stat(r.pct === 20 ? 'Chomesh' : 'Maaser', H.money(r.maaser))}${stat('Already given', H.money(r.given))}${stat('Still to give', H.money(r.remaining))}</div>${r.ledger ? `<p class="mu">Includes ${H.money(r.ledger)} from your <a href="#/luach?tab=tzedakah">tzedakah ledger</a>.</p>` : `<p class="mu">Keep track of what you give in the <a href="#/luach?tab=tzedakah">tzedakah ledger</a>; it counts here.</p>`}`;
      return '';
    });
    return wireTabs(view, 'values');
  }
  if (tab === 'portfolio') {
    const account = q.get('account') || 'paper', d = await H.api('/values/portfolio?account=' + encodeURIComponent(account));
    view.innerHTML = `${head}<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Portfolio screen</h2>${acctPicker(accts, account)}</div>
      <div class="stats">${stat('On your avoid list', d.avoidPct + '%', d.avoidPct ? 'neg' : '')}${stat('No flags found', (100 - d.avoidPct).toFixed(1) + '%')}</div>
      <div class="tablewrap"><table><tr><th>Symbol</th><th>Status</th><th>Why</th><th>Value</th><th>Weight</th></tr>${d.holdings.map(h => `<tr><td><b>${H.esc(h.symbol)}</b></td><td>${vbadge(h.status)}</td><td>${H.esc(h.reasons.join(', '))}</td><td>${H.money(h.value)}</td><td>${h.weight}%</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No positions</td></tr>'}</table></div>${note}</div>`;
    H.$('#acct', view).onchange = e => (location.hash = `#/values?tab=portfolio&account=${e.target.value}`);
    return wireTabs(view, 'values');
  }
  if (tab === 'lists' && admin) {
    view.innerHTML = `${head}<form class="card" id="vl"><h2>Add companies to the lists</h2><p class="mu">One per line: <code>symbol,category</code>. Categories: ${Object.keys(v.categories).map(k => `<code>${k}</code>`).join(', ')}.</p>
      <textarea id="csv" rows="6" data-no-tr></textarea><button>Add</button><div class="err"></div></form>`;
    H.act(H.$('#vl button', view), async () => `Added ${(await H.api('/values/lists', { body: { csv: H.$('#csv', view).value } })).added}`);
    return wireTabs(view, 'values');
  }
  view.innerHTML = `${head}<form class="card" id="hs"><h2>Screen stocks</h2><div class="row"><label style="flex:3">Symbols<input name="symbols" value="${H.esc(q.get('symbols') || 'AAPL, MSFT, DKNG, HRL, SPY')}"></label><button style="align-self:flex-end">Screen</button></div><div class="err"></div><div id="hsOut"></div>${note}</form>`;
  const f = H.$('#hs', view);
  H.act(H.$('button', f), async () => {
    const r = await H.api('/values/screen?symbols=' + encodeURIComponent(f.symbols.value));
    H.$('#hsOut', view).innerHTML = `<div class="tablewrap"><table><tr><th>Symbol</th><th>Status</th><th>Why</th></tr>${r.results.map(x => `<tr><td><b>${H.esc(x.symbol)}</b></td><td>${vbadge(x.status)}</td><td>${H.esc(x.reasons.join(', '))}</td></tr>`).join('')}</table></div>`;
    return '';
  });
  if (q.get('symbols')) H.$('button', f).click();
  wireTabs(view, 'values');
}

// ---------- institutional 13F ----------
async function institutions(view, q) {
  const managers = await H.api('/institutions'), cik = q.get('cik');
  view.innerHTML = `<div class="pagehead"><h1>Institutional portfolios</h1><p class="mu">What well-known investors held at the end of the last quarter, from their SEC 13F filings, what they bought and sold, and a one-tap copy as a portfolio you can backtest and run. 13F filings come out up to 45 days after the quarter ends, so they show the past, not today.</p></div>
    <div class="cards mgr">${managers.map(m => `<a class="card ${m.cik === cik ? 'on' : ''}" href="#/institutions?cik=${m.cik}"><b>${H.esc(m.person)}</b><span class="mu">${H.esc(m.name)}</span></a>`).join('')}</div>
    <form class="row" id="cikF"><label>Or any manager by SEC CIK number<input name="cik" placeholder="0001067983" value="${H.esc(cik && !managers.some(m => m.cik === cik) ? cik : '')}" data-no-tr></label><button>Look up</button></form>
    <div id="hold">${cik ? '<div class="skel"><div class="box"></div></div>' : ''}</div>`;
  H.$('#cikF', view).onsubmit = e => { e.preventDefault(); location.hash = '#/institutions?cik=' + encodeURIComponent(H.$('[name=cik]', view).value.trim()); };
  if (!cik) return;
  let d; try { d = await H.api('/institutions/' + encodeURIComponent(cik)); } catch (e) { H.$('#hold', view).innerHTML = `<div class="card err">${H.esc(e.message)}</div>`; return; }
  const ch = c => ({ new: '<span class="pill ok">new</span>', added: '<span class="pill ok">added</span>', reduced: '<span class="pill warn">reduced</span>', same: '' }[c] || '');
  const stocks = d.holdings.filter(h => !h.putCall);
  H.$('#hold', view).innerHTML = `<div class="card"><h2>${H.esc(d.name)}</h2><p class="mu">Quarter ending ${H.esc(d.period)} · filed ${H.esc(d.filed)} · ${d.positions} positions · ${H.money(d.totalValue)} reported</p>
    <form class="row" id="mir"><label>Copy the top<input name="n" type="number" min="1" max="30" value="10"></label><label>Weighting<select name="w"><option value="manual">Same weights as the manager</option><option value="equal">Equal weight</option></select></label><button>Copy as a portfolio</button></form>
    <div class="tablewrap"><table><tr><th>Company</th><th>Symbol</th><th>Value</th><th>Weight</th><th>Shares</th><th>Change</th></tr>
    ${d.holdings.slice(0, 60).map(h => `<tr><td>${H.esc(h.issuer)}${h.putCall ? ` <span class="pill">${H.esc(h.putCall)}</span>` : ''}</td><td>${h.ticker ? `<a href="#/chart?symbol=${encodeURIComponent(h.ticker)}">${H.esc(h.ticker)}</a>` : '<span class="mu">-</span>'}</td><td>${H.money(h.value)}</td><td>${h.weight == null ? '-' : h.weight + '%'}</td><td>${(+h.shares).toLocaleString()}</td><td>${ch(h.change)}${h.sharesChangePct && h.change !== 'new' ? ` <span class="small-print ${H.cls(h.sharesChangePct)}">${pc(h.sharesChangePct)}</span>` : ''}</td></tr>`).join('')}</table></div>
    ${d.soldOut.length ? `<h3 style="margin-top:16px">Sold out since ${H.esc(d.previousPeriod)}</h3><p class="mu">${d.soldOut.map(s => H.esc(s.ticker || s.issuer)).join(', ')}</p>` : ''}
    <p class="mu small-print">Source: SEC EDGAR. Symbols are matched from company names and may miss some holdings.</p></div>`;
  H.$('#mir', view).onsubmit = e => {
    e.preventDefault();
    const f = H.form(e.target), top = stocks.filter(h => h.ticker).slice(0, Math.max(1, +f.n || 10));
    sessionStorage.setItem('qp_basket', JSON.stringify({ name: `${d.name.slice(0, 40)} 13F top ${top.length}`, description: `Top ${top.length} holdings from ${d.name}'s 13F for ${d.period}.`, universe: top.map(h => h.ticker).join(','), filters: '', rankBy: 'none', topN: top.length, weighting: f.w, rebalance: 'quarterly', cashPct: 0, weights: Object.fromEntries(top.map(h => [h.ticker, h.weight])) }));
    location.hash = '#/portfolios?tab=build';
  };
}

// ---------- spend-based investing ----------
async function spend(view) {
  const [d, accts] = await Promise.all([H.api('/roundups'), H.accounts()]), s = d.settings;
  view.innerHTML = `<div class="pagehead"><h1>Invest as you spend</h1><p class="mu">Round up every card purchase to the next dollar and invest the change, and invest a percentage of what you spend at brands you love in their own stock.</p></div>
  <div class="stats">${stat('Waiting to invest', H.money(d.pending))}${stat('Invested so far', H.money(d.invested), 'pos')}${stat('Card', d.linked ? 'Linked' : 'Not linked')}</div>
  <form class="card" id="ru"><h2>Settings</h2>
    <div class="row"><label>Invest<select name="mode"><option value="both">Round-ups and brand purchases</option><option value="roundup">Round-ups only</option><option value="brand">Brand purchases only</option></select></label>
      <label>Round-up multiplier<select name="multiplier">${[1, 2, 3, 5, 10].map(m => `<option value="${m}" ${m === s.multiplier ? 'selected' : ''}>${m}×</option>`).join('')}</select></label>
      <label>Brand purchases: invest %<input name="brandPct" type="number" min="0.5" max="50" step="0.5" value="${s.brandPct}"></label>
      <label>Round-ups buy<input name="defaultSymbol" value="${H.esc(s.defaultSymbol)}" data-no-tr></label></div>
    <div class="row"><label>Account<select name="account">${H.accountOptions(accts, s.account, H.paid())}</select></label><label>Invest once at least ($)<input name="minBatch" type="number" min="1" value="${s.minBatch}"></label><label>Weekly cap ($, 0 = none)<input name="weeklyCap" type="number" min="0" value="${s.weeklyCap}"></label>
      <label class="chk"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> On</label></div>
    <button>Save</button><div class="err"></div>
    <p class="mu small-print"><span>Brands we recognize:</span> <span data-no-tr>${d.brands.slice(0, 30).map(H.esc).join(', ')}</span> <span>and more.</span> <span>Pending amounts are invested every 3 hours during market hours once they reach your minimum.</span></p></form>
  <div class="grid"><div class="card"><h2>Link a card</h2>${d.plaid ? (d.linked ? '<p>Your card is linked. New purchases sync automatically.</p><button class="ghost" id="unlink">Unlink card</button>' : '<p class="mu">Securely connect your bank or card with Plaid. We only read purchases; we can\'t move money.</p><button id="link">Link with Plaid</button>') : '<p class="mu">Card linking needs Plaid keys on the server (PLAID_CLIENT_ID, PLAID_SECRET). Meanwhile, import a statement.</p>'}<div class="err"></div></div>
    <div class="card"><h2>Import a statement</h2><label>CSV lines: date,description,amount<textarea id="csv" rows="4" data-no-tr placeholder="2026-10-20,STARBUCKS #1234,5.45&#10;2026-10-21,AMAZON MKTPLACE,23.10"></textarea></label><input type="file" id="csvFile" accept=".csv,text/csv"><div class="row"><button id="imp">Import</button><button class="ghost" id="inv">Invest now</button></div><div class="err"></div></div></div>
  <div class="card"><h2>Purchases</h2><div class="tablewrap"><table><tr><th>Date</th><th>Merchant</th><th>Spent</th><th>Invest</th><th>In</th><th>Status</th></tr>
    ${d.transactions.map(t => `<tr><td>${H.esc(t.day)}</td><td>${H.esc(t.merchant)}</td><td>${H.money(t.amount)}</td><td>${H.money(t.invest)}</td><td>${H.esc(t.ticker)}</td><td>${H.esc(t.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No purchases yet</td></tr>'}</table></div></div>`;
  const f = H.$('#ru', view); f.mode.value = s.mode;
  H.act(H.$('button', f), async () => { await H.api('/roundups', { method: 'PUT', body: H.form(f) }); return 'Saved'; });
  H.$('#csvFile', view).onchange = async e => { const x = e.target.files[0]; if (x) H.$('#csv', view).value = await x.text(); };
  H.act(H.$('#imp', view), async () => { const r = await H.api('/roundups/import', { body: { csv: H.$('#csv', view).value } }); later(1200); return `${r.purchases} purchases read, ${r.added} new amounts to invest`; });
  H.act(H.$('#inv', view), async () => { const r = await H.api('/roundups/invest', { body: {} }); later(1500); return r.orders.length ? r.orders.map(o => `${o.ticker} ${H.money(o.amount)}: ${o.result}`).join('; ') : 'Nothing ready to invest yet (below your minimum).'; });
  if (H.$('#unlink', view)) H.act(H.$('#unlink', view), async () => { await H.api('/roundups/plaid', { method: 'DELETE' }); H.render(); });
  if (H.$('#link', view)) H.act(H.$('#link', view), async () => {
    const { linkToken } = await H.api('/roundups/plaid/link-token', { body: {} });
    if (!window.Plaid) await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; sc.onload = ok; sc.onerror = () => no(new Error('Could not load Plaid')); document.head.append(sc); });
    await new Promise((ok, no) => window.Plaid.create({ token: linkToken, onSuccess: async pt => { try { await H.api('/roundups/plaid/exchange', { body: { publicToken: pt } }); ok(); H.render(); } catch (e) { no(e); } }, onExit: err => (err ? no(new Error(err.display_message || err.error_message || 'Linking cancelled')) : ok()) }).open());
  });
}

// ---------- news, sentiment, brief and podcast ----------
async function news(view, q) {
  const syms = q.get('symbols') || 'SPY, AAPL, NVDA, TSLA';
  view.innerHTML = `<div class="pagehead"><h1>News & sentiment</h1><p class="mu">Headlines scored for tone, what traders on StockTwits are saying, and an AI brief you can read or listen to like a short podcast.</p></div>
    <form class="card row" id="nf"><label style="flex:3">Symbols<input name="symbols" value="${H.esc(syms)}" data-no-tr></label><button>Update</button><button type="button" class="ghost" id="brief">Brief me</button></form>
    <div id="briefOut"></div><div id="sent"><div class="skel"><div class="box"></div></div></div>`;
  const f = H.$('#nf', view), list = () => f.symbols.value;
  f.onsubmit = e => { e.preventDefault(); location.hash = '#/news?symbols=' + encodeURIComponent(list()); };
  H.onLeave(() => window.speechSynthesis?.cancel());
  const tone = l => ({ positive: 'ok', negative: 'bad' }[l] || '');
  const d = await H.api('/news/sentiment?symbols=' + encodeURIComponent(syms)).catch(e => ({ error: e.message }));
  if (d.error) { H.$('#sent', view).innerHTML = `<div class="card err">${H.esc(d.error)}</div>`; }
  else H.$('#sent', view).innerHTML = `<div class="cards">${d.bySymbol.map(b => `<div class="card"><h2>${H.esc(b.symbol)}</h2><div class="stats">${stat('News tone', b.newsLabel ? `<span class="pill ${tone(b.newsLabel)}">${H.esc(b.newsLabel)}</span>` : '-')}${stat('Articles', b.articles)}${stat('StockTwits bullish', b.social.bullishPct == null ? '-' : b.social.bullishPct + '%')}</div>
      ${b.social.available ? `<div class="meter"><i style="width:${b.social.bullishPct ?? 50}%"></i></div><p class="mu small-print">${b.social.bullish} bullish · ${b.social.bearish} bearish of the last ${b.social.posts} posts</p>` : '<p class="mu small-print">Social sentiment unavailable right now</p>'}</div>`).join('')}</div>
    <div class="card"><h2>Headlines</h2>${d.newsAvailable ? '' : '<p class="mu">News needs the market-data source (ALPACA_KEY_ID / ALPACA_SECRET) on the server.</p>'}
      <ul class="news">${d.items.slice(0, 40).map(i => `<li><span class="pill ${tone(i.label)}">${H.esc(i.label)}</span> <a href="${H.esc(i.url)}" target="_blank" rel="noopener">${H.esc(i.headline)}</a> <span class="mu small-print">${H.esc(i.source || '')} · ${(i.symbols || []).slice(0, 4).map(H.esc).join(', ')} · ${H.date(i.at)}</span></li>`).join('') || '<li class="mu">No headlines</li>'}</ul>
      <p class="mu small-print">Tone is scored automatically from the wording and can be wrong. Not investment advice.</p></div>`;
  H.act(H.$('#brief', view), async () => {
    const r = await H.api('/news/brief', { body: { symbols: list() } });
    const { md } = await import('./studio.js');
    H.$('#briefOut', view).innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Your brief ${r.ai ? '<span class="pill">AI</span>' : ''}</h2>${window.speechSynthesis ? '<span class="row" style="gap:6px"><button class="ghost small" id="play">▶ Listen</button><button class="ghost small" id="stop">■ Stop</button></span>' : ''}</div><div class="md">${md(r.brief)}</div></div>`;
    if (H.$('#play', view)) {
      H.$('#play', view).onclick = () => { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(r.script); u.rate = 1.02; speechSynthesis.speak(u); };
      H.$('#stop', view).onclick = () => speechSynthesis.cancel();
    }
  });
}
