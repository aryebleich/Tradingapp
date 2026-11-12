// Optional features (Settings → Optional features): the switches, the "My tools" page, the
// My day card on Home, the check before an order, and voice commands. Server: src/extras.js.
let H;
const usd = x => (x == null || !isFinite(x) ? '-' : H.money(x));
const pc = (x, d = 1) => (x == null || !isFinite(x) ? '-' : `${x > 0 ? '+' : ''}${(+x).toFixed(d)}%`);
const day = t => new Date(t).toLocaleDateString();
// Tools that have their own tab on the My tools page, in this order.
const TOOLS = [['goals', 'Goals'], ['family', 'Family'], ['replay', 'Mistake replay'], ['coach', 'My habits'], ['explain', 'Explain a move'], ['autopsy', 'Strategy autopsy'], ['promises', 'Promise check'], ['crowd', 'Crowd check'], ['shailos', 'Questions for a rav'], ['statement', 'Statement']];
export const hasTools = on => TOOLS.some(([k]) => on?.[k]);

// ---------- Settings: the switches ----------
export async function settingsCard(helpers, box) {
  H = helpers;
  const d = await H.api('/extras');
  const groups = [...new Set(d.list.map(x => x.group))];
  box.innerHTML = `<div class="card" id="extrasCard"><h2 style="margin-top:0">Optional features</h2>
    <p class="mu" style="margin-top:0">Each one is off until you switch it on. Switch on only what you want to use; you can switch it off again at any time.</p>
    ${groups.map(g => `<h3 class="ex-g">${H.esc(g)}</h3><div class="ex-list">${d.list.filter(x => x.group === g).map(x => `<label class="ex-item"><input type="checkbox" data-ex="${x.key}" ${d.on[x.key] ? 'checked' : ''}><span><b>${H.esc(x.name)}</b><small class="mu">${H.esc(x.what)}</small></span></label>`).join('')}</div>`).join('')}
    <p class="mu small-print" id="exNote">Tools you switch on appear under <a href="#/extras">My tools</a> in the menu.</p><div class="err"></div></div>`;
  H.$$('[data-ex]', box).forEach(c => (c.onchange = async () => {
    const err = H.$('.err', box); err.textContent = '';
    try { const r = await H.api('/extras', { method: 'PUT', body: { on: { [c.dataset.ex]: c.checked } } }); H.setExtras(r.on); }
    catch (e) { c.checked = !c.checked; err.textContent = e.message; }
  }));
}

// ---------- Home: My day ----------
export async function myDayCard(helpers, view) {
  H = helpers;
  const d = await H.api('/extras/myday?account=' + encodeURIComponent(H.state.account)).catch(() => null);
  if (!d || !view.isConnected || H.$('#myDay', view)) return;
  const el = document.createElement('div'); el.className = 'card myday'; el.id = 'myDay';
  el.innerHTML = `<h2 style="margin-top:0">My day</h2>${d.lines.map(l => `<p>${H.esc(l)}</p>`).join('')}<p class="myday-next"><b>Next step:</b> ${H.esc(d.next.text)} <a href="${H.esc(d.next.href)}">Open →</a></p>`;
  const anchor = H.$('#homeClock', view) || H.$('.pguide', view) || H.$('h1', view)?.closest('.row') || H.$('h1', view);
  anchor ? anchor.after(el) : view.prepend(el);
}

// ---------- Before an order: second opinion, your habits, the tax ----------
// Resolves true to send the order, false to stop.
export async function beforeOrder(helpers, body) {
  H = helpers;
  const d = await H.api('/extras/before-order', { body: { account: body.account || H.state.account, symbol: body.symbol, side: body.side, qty: body.qty, notional: body.notional, limit_price: body.limit_price } }).catch(() => null);
  if (!d || !(d.devil?.length || d.coach?.length || d.tax)) return true;
  return new Promise(resolve => {
    const dlg = document.createElement('dialog'); dlg.className = 'secure beforeorder';
    const t = d.tax;
    dlg.innerHTML = `<form method="dialog"><h2>Before you ${body.side === 'sell' ? 'sell' : 'buy'} <span data-no-tr>${H.esc(String(body.symbol || '').toUpperCase())}</span></h2>
      ${d.devil?.length ? `<h3>The case against this trade</h3><ul class="warnlist">${d.devil.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul>` : ''}
      ${d.coach?.length ? `<h3>Your own pattern</h3><ul class="warnlist">${d.coach.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul>` : ''}
      ${t ? `<h3>The tax on this sale</h3><div class="stats"><div class="stat"><span>${t.gain >= 0 ? 'Gain' : 'Loss'}</span><b class="${H.cls(t.gain)}">${usd(t.gain)}</b></div><div class="stat"><span>Estimated tax</span><b>${usd(Math.max(0, t.tax))}</b></div></div>
        ${t.wait ? `<p>Waiting <b>${t.wait.days} days</b> (until ${day(t.wait.until)}) makes the gain long-term and saves about <b>${usd(t.wait.saves)}</b>.</p>` : ''}
        ${t.cheaperLots ? `<p>Selling other lots first (specific identification, set at your brokerage) would save about <b>${usd(t.cheaperLots.saves)}</b>.</p>` : ''}
        ${t.tax < 0 ? '<p class="mu">A loss lowers your tax, unless you buy the same stock back within 30 days (a wash sale).</p>' : ''}` : ''}
      <p class="mu small-print">Information from prices and your own history, not advice. The decision is yours.</p>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="ghost" value="no">Do not send</button><button value="yes">Send the order</button></div></form>`;
    document.body.append(dlg);
    dlg.onclose = () => { resolve(dlg.returnValue === 'yes'); dlg.remove(); };
    dlg.showModal();
  });
}

// ---------- Voice ----------
const PAGES = { home: 'dashboard', positions: 'positions', orders: 'orders', trade: 'trade', markets: 'markets', market: 'markets', watchlist: 'watchlists', watchlists: 'watchlists', chart: 'chart', settings: 'settings', taxes: 'tax', tax: 'tax', bots: 'bots', strategies: 'strategies', news: 'news', assistant: 'ai', accounts: 'accounts', billing: 'funding', plans: 'funding', scanner: 'scanner', options: 'options', learn: 'learn', tools: 'extras', goals: 'extras?tab=goals', family: 'extras?tab=family' };
const NAMES = { apple: 'AAPL', microsoft: 'MSFT', google: 'GOOGL', amazon: 'AMZN', tesla: 'TSLA', nvidia: 'NVDA', meta: 'META', facebook: 'META', netflix: 'NFLX', 'the market': 'SPY', 's and p': 'SPY', 'the s and p': 'SPY', nasdaq: 'QQQ', bitcoin: 'BTC/USD' };
// What a spoken sentence means: a page to open, a symbol to look up, or a question for the assistant.
export function voiceIntent(said) {
  const t = String(said || '').toLowerCase().replace(/[.?!,]/g, '').trim();
  if (!t) return null;
  const open = /^(?:open|show|go to|show me|take me to)\s+(?:the |my )?(.+?)(?: page)?$/.exec(t);
  if (open && PAGES[open[1]]) return { go: '#/' + PAGES[open[1]] };
  const px = /^(?:price of|quote for|quote|how is|how's|what is|what's)\s+(?:the price of\s+)?(.+?)(?:\s+(?:doing|trading|at|today|now))*$/.exec(t);
  const sym = s => NAMES[s] || (/^[a-z]{1,5}$/.test(s) && !PAGES[s] ? s.toUpperCase() : null);
  if (px && sym(px[1])) return { go: '#/analyze?symbol=' + encodeURIComponent(sym(px[1])) };
  const ch = /^chart (?:of |for )?(.+)$/.exec(t);
  if (ch && sym(ch[1])) return { go: '#/chart?symbol=' + encodeURIComponent(sym(ch[1])) };
  const bs = /^(buy|sell)\s+(.+)$/.exec(t);
  if (bs) { const s = sym(bs[2].replace(/^(?:some |shares of )/, '')); if (s) return { go: `#/trade?symbol=${encodeURIComponent(s)}`, note: 'Opened the ticket. You confirm every order yourself.' }; }
  return { ask: said };
}
export function voiceButton(helpers) {
  H = helpers;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, old = document.getElementById('voiceBtn');
  if (!H.extras().voice || !SR) { old?.remove(); return; }
  if (old) return;
  const b = document.createElement('button'); b.id = 'voiceBtn'; b.className = 'ghost hdrbtn'; b.type = 'button'; b.title = 'Voice command'; b.setAttribute('aria-label', 'Voice command');
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  (document.getElementById('themeBtn') || document.querySelector('header')?.lastElementChild)?.before(b);
  b.onclick = () => {
    const r = new SR(); r.lang = document.documentElement.lang === 'yi' ? 'yi' : 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    b.classList.add('listening');
    r.onresult = e => {
      const said = e.results[0][0].transcript, i = voiceIntent(said);
      if (!i) return;
      if (i.go) { location.hash = i.go; return; }
      // A question: opened in the assistant, ready to send.
      location.hash = '#/ai'; setTimeout(() => { const ta = document.querySelector('#ask textarea'); if (ta) { ta.value = i.ask; ta.focus(); } }, 900);
    };
    r.onend = r.onerror = () => b.classList.remove('listening');
    try { r.start(); } catch { b.classList.remove('listening'); }
  };
}

// ---------- My tools ----------
export async function page(view, q, helpers) {
  H = helpers;
  const on = (await H.api('/extras')).on, tabs = TOOLS.filter(([k]) => on[k]);
  if (!tabs.length) {
    view.innerHTML = `<div class="pagehead"><h1>My tools</h1><p class="mu">Optional tools you switch on yourself.</p></div><div class="card"><p>No tools are switched on yet.</p><a href="#/settings"><button type="button">Choose tools in Settings</button></a></div>`;
    return;
  }
  const tab = tabs.some(([k]) => k === q.get('tab')) ? q.get('tab') : tabs[0][0];
  view.innerHTML = `<div class="pagehead"><h1>My tools</h1><p class="mu">The optional tools you switched on. Add or remove them in <a href="#/settings">Settings</a>.</p></div>
    <div class="chips viewtabs">${tabs.map(([k, t]) => `<a href="#/extras?tab=${k}"><button type="button" class="${k === tab ? 'on' : ''}">${t}</button></a>`).join('')}</div><div id="exBody"><p class="mu">Loading…</p></div>
    <p class="mu small-print">Information from prices and your own history. Not investment, tax or halachic advice.</p>`;
  const body = H.$('#exBody', view), acct = encodeURIComponent(H.state.account);
  try { await ({ goals, family, replay, coach, explain, autopsy, promises, crowd, shailos, statement })[tab](body, acct, q); }
  catch (e) { body.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; }
}

async function goals(body) {
  const d = await H.api('/extras/goals');
  const planHtml = (g, p) => `<div class="stats"><div class="stat"><span>Each month</span><b>${usd(p.monthly)}</b></div><div class="stat"><span>Chance of reaching it</span><b class="${p.chance >= 70 ? 'pos' : p.chance < 40 ? 'neg' : ''}">${p.chance}%</b></div><div class="stat"><span>Expected at the end</span><b>${usd(p.expected)}</b></div><div class="stat"><span>You put in</span><b>${usd(p.paidIn)}</b></div></div>
    <p class="mu">A mix for ${g.years} year${g.years === 1 ? '' : 's'}: ${p.mix.filter(m => m[1] > 0).map(m => `<span class="pill" data-no-tr>${m[0]} ${m[1]}%</span>`).join(' ')} (${p.stocks}% stocks, ${p.bonds}% bonds and cash, about ${p.returnPct}% a year expected).</p>`;
  body.innerHTML = `<form class="card" id="gForm"><h2 style="margin-top:0">Say your goal</h2><p class="mu" style="margin-top:0">In your own words: how much, for what, and when.</p>
      <label>Your goal<input name="text" placeholder="I need $40,000 for a wedding in three years" autocomplete="off"></label>
      <label>Already saved for it ($)<input name="saved" type="number" min="0" step="any" value="0" style="max-width:200px"></label>
      <button>Work it out</button><div class="err"></div><div id="gOut"></div></form>
    ${d.goals.map(g => `<div class="card" data-g="${g.id}"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${H.esc(g.what)}: ${usd(g.amount)} in ${g.years} year${g.years === 1 ? '' : 's'}</h2><button type="button" class="ghost small" data-del>Remove</button></div>${planHtml(g, g.plan)}</div>`).join('')}`;
  const f = H.$('#gForm', body), out = H.$('#gOut', body), err = H.$('.err', f);
  f.onsubmit = async e => {
    e.preventDefault(); err.textContent = ''; out.innerHTML = '';
    try {
      const g = await H.api('/extras/goals/plan', { body: H.form(f) });
      out.innerHTML = `<h3>${H.esc(g.what)}: ${usd(g.amount)} in ${g.years} year${g.years === 1 ? '' : 's'}</h3>${planHtml(g, g.plan)}<button type="button" id="gSave">Keep this goal</button>
        <p class="mu small-print">The chance is an estimate from how such a mix has behaved; markets can do worse. The shorter the time, the more is kept out of stocks.</p>`;
      H.$('#gSave', out).onclick = async () => { await H.api('/extras/goals', { body: g }); H.render(); };
    } catch (x) { err.textContent = x.message; }
  };
  H.$$('[data-del]', body).forEach(b => (b.onclick = async () => { await H.api('/extras/goals/' + b.closest('[data-g]').dataset.g, { method: 'DELETE' }); H.render(); }));
}

async function family(body) {
  const [d, accts] = await Promise.all([H.api('/extras/family'), H.accounts()]);
  body.innerHTML = `<div class="card"><h2 style="margin-top:0">Family</h2><p class="mu" style="margin-top:0">Each child has an allowance that buys a fund on a schedule from one of your accounts. The shares stay in your account; this page keeps track of which are whose. (An account in the child's own name, a custodial account, is opened at a brokerage.)</p>
    ${d.members.length ? `<div class="tablewrap"><table><tr><th>Name</th><th>Allowance</th><th>Buys</th><th class="num">Put in</th><th class="num">Worth now</th><th class="num">Gain</th><th></th></tr>${d.members.map(m => `<tr data-m="${m.id}"><td><b>${H.esc(m.name)}</b>${m.goal ? `<div class="mu">${H.esc(m.goal)}</div>` : ''}</td><td>${usd(m.amount)} ${m.everyDays === 7 ? 'a week' : m.everyDays === 14 ? 'every two weeks' : 'a month'}${m.active ? '' : ' <span class="pill warn">paused</span>'}</td><td data-no-tr>${H.esc(m.symbol)}</td><td class="num">${usd(m.paidIn)}</td><td class="num">${usd(m.value)}</td><td class="num ${H.cls(m.gain)}">${usd(m.gain)}</td><td class="nowrap"><button class="small ghost" data-pause="${m.active ? 0 : 1}">${m.active ? 'Pause' : 'Resume'}</button> <button class="small ghost" data-rm>Remove</button></td></tr>`).join('')}</table></div>` : '<p class="mu">No one added yet.</p>'}</div>
    <form class="card" id="famF"><h2 style="margin-top:0">Add a child</h2>
      <div class="row"><label>Name<input name="name" maxlength="40" required></label><label>Saving for (optional)<input name="goal" maxlength="80" placeholder="e.g. first car, wedding"></label></div>
      <div class="row"><label>Allowance ($)<input name="amount" type="number" min="1" max="10000" step="any" value="10" required></label><label>How often<select name="everyDays"><option value="7">Every week</option><option value="14">Every two weeks</option><option value="30">Every month</option></select></label>
        <label>Buys<input name="symbol" value="VTI" dir="ltr" data-no-tr required></label><label>From account<select name="account">${H.accountOptions(accts, 'paper')}</select></label></div>
      <button>Add</button><div class="err"></div><p class="mu small-print">The first purchase is made at the next market session, then on the schedule. Start with the practice account to see how it works.</p></form>`;
  const f = H.$('#famF', body);
  f.onsubmit = async e => { e.preventDefault(); H.$('.err', f).textContent = ''; try { await H.api('/extras/family', { body: H.form(f) }); H.render(); } catch (x) { H.$('.err', f).textContent = x.message; } };
  H.$$('[data-pause]', body).forEach(b => (b.onclick = async () => { await H.api('/extras/family/' + b.closest('tr').dataset.m, { method: 'PUT', body: { active: b.dataset.pause === '1' } }); H.render(); }));
  H.$$('[data-rm]', body).forEach(b => (b.onclick = async () => { if (!confirm('Remove this child from the list? The shares stay in your account.')) return; await H.api('/extras/family/' + b.closest('tr').dataset.m, { method: 'DELETE' }); H.render(); }));
}

async function replay(body, acct) {
  const d = await H.api('/extras/replay?account=' + acct);
  body.innerHTML = `<div class="card"><h2 style="margin-top:0">Mistake replay</h2><p class="mu" style="margin-top:0">Your losing trades in this account, largest first: what you paid, how low it went while you held it, and what a stop 8% under your price would have changed.</p>
    ${d.trades.length ? `<div class="tablewrap"><table><tr><th>Stock</th><th>Held</th><th class="num">Bought at</th><th class="num">Sold at</th><th class="num">Lowest</th><th class="num">Loss</th><th>What to take from it</th><th></th></tr>${d.trades.map(t => `<tr><td data-no-tr><b>${H.esc(t.symbol)}</b></td><td>${day(t.bought)} to ${day(t.sold)}<div class="mu">${t.days} day${t.days === 1 ? '' : 's'}</div></td><td class="num">${usd(t.buy)}</td><td class="num">${usd(t.sell)}</td><td class="num">${t.low == null ? '-' : usd(t.low)}</td><td class="num neg">${usd(t.loss)}<div class="mu">${pc(t.lossPct)}</div></td><td>${H.esc(t.lesson)}</td><td><a href="#/chart?symbol=${encodeURIComponent(t.symbol)}">Chart</a></td></tr>`).join('')}</table></div>` : '<p class="ok">No losing trades in this account yet.</p>'}</div>`;
}

async function coach(body, acct) {
  const d = await H.api('/extras/coach?account=' + acct);
  body.innerHTML = `<div class="card"><h2 style="margin-top:0">My habits</h2><div class="stats"><div class="stat"><span>Closed trades</span><b>${d.trades}</b></div><div class="stat"><span>Winners</span><b class="pos">${d.wins}</b></div><div class="stat"><span>Losers</span><b class="neg">${d.losses}</b></div></div>
    ${d.habits.length ? `<h3>Patterns in your own trades</h3><ul class="warnlist">${d.habits.map(h => `<li>${H.esc(h.text)}</li>`).join('')}</ul><p class="mu">When you are about to repeat one of these, you see it before you confirm the order.</p>` : `<p class="mu">${d.trades < 6 ? 'There are not enough closed trades in this account yet to see a pattern. It needs about six.' : 'No repeated pattern stands out in this account.'}</p>`}</div>`;
}

async function explain(body, acct, q) {
  body.innerHTML = `<form class="card" id="exF"><h2 style="margin-top:0">Explain a move</h2><p class="mu" style="margin-top:0">Pick a stock and a day. Leave the day empty for its biggest move of the last three months.</p>
    <div class="row" style="align-items:end"><label>Symbol<input name="symbol" value="${H.esc(q.get('symbol') || 'AAPL')}" dir="ltr" data-no-tr required style="max-width:140px"></label><label>Day (optional)<input name="day" type="date" style="max-width:190px"></label><button>Explain</button></div><div class="err"></div><div id="exOut"></div></form>`;
  const f = H.$('#exF', body), out = H.$('#exOut', body);
  const go = async () => {
    H.$('.err', f).textContent = ''; out.innerHTML = '<p class="mu">Looking…</p>';
    try {
      const v = H.form(f), d = await H.api(`/extras/explain?symbol=${encodeURIComponent(v.symbol.trim().toUpperCase())}${v.day ? '&day=' + v.day : ''}`);
      if (d.empty) { out.innerHTML = `<p class="mu">${H.esc(d.empty)}</p>`; return; }
      out.innerHTML = `<div class="stats" style="margin-top:12px"><div class="stat"><span data-no-tr>${H.esc(d.symbol)} on ${d.day}</span><b class="${H.cls(d.pct)}">${pc(d.pct, 2)}</b></div><div class="stat"><span>The market that day</span><b>${d.market == null ? '-' : pc(d.market, 2)}</b></div><div class="stat"><span>Compared with a usual day</span><b>${d.unusual}×</b></div></div>
        <h3>Most likely why</h3><ul>${d.causes.map(c => `<li>${H.esc(c)}</li>`).join('')}</ul>
        ${d.news.length ? `<h3>Headlines around that day</h3><ul class="plain" data-no-tr>${d.news.map(n => `<li>${n.url ? `<a href="${H.esc(n.url)}" target="_blank" rel="noopener">${H.esc(n.headline)}</a>` : H.esc(n.headline)} <span class="mu">${H.esc(n.source || '')}</span></li>`).join('')}</ul>` : ''}
        <h3>Its biggest days lately</h3><div class="chips">${d.biggest.map(b => `<button type="button" data-day="${b.day}"><span data-no-tr>${b.day}</span> ${pc(b.pct)}</button>`).join('')}</div>`;
      H.$$('[data-day]', out).forEach(b => (b.onclick = () => { f.day.value = b.dataset.day; go(); }));
    } catch (e) { out.innerHTML = ''; H.$('.err', f).textContent = e.message; }
  };
  f.onsubmit = e => { e.preventDefault(); go(); };
}

const autopsyHtml = d => (d.ok ? `<h3>What changed in the market</h3><ul>${d.changed.map(c => `<li>${H.esc(c)}</li>`).join('')}</ul><h3>Which rule is struggling</h3><ul class="warnlist">${d.failing.map(c => `<li>${H.esc(c)}</li>`).join('')}</ul>` : `<p class="mu">${H.esc(d.text)}</p>`);
async function autopsy(body) {
  const d = await H.api('/extras/autopsy');
  body.innerHTML = `${d.bots.map(b => `<div class="card"><h2 style="margin-top:0">${H.esc(b.name)} <span class="pill" data-no-tr>${H.esc(b.symbol)}</span> ${b.active ? '' : '<span class="pill warn">paused</span>'}</h2>${autopsyHtml(b)}</div>`).join('')}
    <form class="card" id="auF"><h2 style="margin-top:0">${d.bots.length ? 'Check another strategy' : 'Check a strategy'}</h2><p class="mu" style="margin-top:0">${d.bots.length ? '' : 'You have no AI bots yet. '}Pick what kind of strategy it is and the symbol it trades.</p>
      <div class="row" style="align-items:end"><label>Kind<select name="kind"><option value="rule">Rules (trend or signals)</option><option value="grid">Grid</option><option value="scalp">Scalping</option><option value="dca">Regular buying (DCA)</option></select></label><label>Symbol<input name="symbol" value="SPY" dir="ltr" data-no-tr style="max-width:140px"></label><button>Check</button></div><div class="err"></div><div id="auOut"></div></form>`;
  const f = H.$('#auF', body);
  f.onsubmit = async e => { e.preventDefault(); H.$('.err', f).textContent = ''; try { H.$('#auOut', f).innerHTML = autopsyHtml(await H.api('/extras/autopsy', { body: H.form(f) })); } catch (x) { H.$('.err', f).textContent = x.message; } };
}

async function promises(body) {
  body.innerHTML = `<form class="card" id="prF"><h2 style="margin-top:0">Earnings-call promise check</h2><p class="mu" style="margin-top:0">Paste the text of the earlier call and of the latest one. You get the promises made last time, with the ones the latest call no longer mentions first.</p>
    <div class="grid"><label>The earlier call<textarea name="previous" rows="9" placeholder="Paste the transcript of last quarter's call"></textarea></label><label>The latest call<textarea name="current" rows="9" placeholder="Paste the transcript of this quarter's call"></textarea></label></div>
    <button>Compare</button><div class="err"></div><div id="prOut"></div></form>`;
  const f = H.$('#prF', body);
  f.onsubmit = async e => {
    e.preventDefault(); H.$('.err', f).textContent = '';
    try {
      const d = await H.api('/extras/promises', { body: H.form(f) });
      H.$('#prOut', f).innerHTML = `<div class="stats" style="margin-top:12px"><div class="stat"><span>Promises last time</span><b>${d.promises}</b></div><div class="stat"><span>No longer mentioned</span><b class="${d.dropped ? 'neg' : 'pos'}">${d.dropped}</b></div></div>
        ${d.list.length ? `<div class="tablewrap"><table class="slim"><tr><th>What was said last time</th><th>In the latest call</th></tr>${d.list.map(p => `<tr><td data-no-tr>${H.esc(p.promise)}</td><td><span class="pill ${p.status === 'dropped' ? 'warn' : p.status === 'kept in view' ? 'pos' : ''}">${p.status === 'dropped' ? 'Dropped' : p.status === 'kept in view' ? 'Still talked about' : 'Mentioned less'}</span></td></tr>`).join('')}</table></div>` : '<p class="mu">No forward-looking promises were found in the earlier call.</p>'}
        <p class="mu small-print">"Dropped" means the latest call does not use the same words. Read the passage yourself before drawing a conclusion: the goal may have been met, renamed or quietly abandoned.</p>`;
    } catch (x) { H.$('.err', f).textContent = x.message; }
  };
}

async function crowd(body, acct) {
  const d = await H.api('/extras/crowd?account=' + acct);
  body.innerHTML = `<div class="card"><h2 style="margin-top:0">Crowd check</h2>${d.enough ? `<p class="mu" style="margin-top:0">Compared with ${d.members} members (${H.esc(d.group)}) who also switched this on. Only three numbers are shared, never names, amounts or holdings.</p>
      <div class="tablewrap"><table class="slim"><tr><th></th><th class="num">You</th><th class="num">Typical</th></tr><tr><td>Number of holdings</td><td class="num">${d.me.holdings}</td><td class="num">${d.median.holdings}</td></tr><tr><td>Largest holding, share of the account</td><td class="num">${d.me.top}%</td><td class="num">${d.median.top}%</td></tr><tr><td>In cash</td><td class="num">${d.me.cash}%</td><td class="num">${d.median.cash}%</td></tr></table></div>
      <ul>${d.notes.map(n => `<li>${H.esc(n)}</li>`).join('')}</ul><p class="mu small-print">What others hold is not a reason to hold it. This only shows where you differ.</p>`
    : `<p>Not enough members have switched this on yet to compare (${d.members} so far; it needs five). Your three numbers are counted from now on, without your name.</p>`}</div>`;
}

async function shailos(body, acct) {
  const d = await H.api('/extras/shailos?account=' + acct);
  body.innerHTML = `<div class="card"><h2 style="margin-top:0">Questions for your rav</h2><p class="mu" style="margin-top:0">Holdings in this account whose business is lending at interest, or which commonly raise a question. This is a list to ask about, not a ruling: the answer depends on the details and on your rav.</p>
    ${d.list.length ? `<div class="tablewrap"><table><tr><th>Holding</th><th class="num">Value</th><th>Topic</th><th>Why it is on the list</th></tr>${d.list.map(x => `<tr><td data-no-tr><b>${H.esc(x.symbol)}</b></td><td class="num">${usd(x.value)}</td><td>${H.esc(x.topic)}</td><td>${H.esc(x.why)}</td></tr>`).join('')}</table></div>` : '<p class="ok">Nothing in this account is on the list.</p>'}
    <h3>Shabbos and Yom Tov</h3><p>${d.shabbosOn ? `Automatic trading is paused on Shabbos and Yom Tov by the times of your city${d.restingNow ? ' (paused right now)' : ''}.` : 'Automatic trading is not paused on Shabbos and Yom Tov.'} <a href="#/values?tab=shabbos">${d.shabbosOn ? 'Change' : 'Switch it on'} in Values investing →</a></p></div>`;
}

async function statement(body) {
  const d = await H.api('/extras/statement');
  body.innerHTML = `<div class="card"><h2 style="margin-top:0">Monthly statement</h2><p class="mu" style="margin-top:0">This is what is sent to you on the 1st of each month, by email (or by text when your plan includes texts).</p>
    <pre class="stmt" data-no-tr>${H.esc(d.text)}</pre><button type="button" id="stSend">Send it to me now</button><span class="ok"></span><div class="err"></div></div>`;
  H.act(H.$('#stSend', body), async () => { await H.api('/extras/statement/send', { body: {} }); return 'Sent'; }, H.$('.ok', body));
}
