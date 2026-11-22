// Growth pages (PLAN_GROWTH.md): Diversification (#/riskview/diversify), AI morning picks
// (#/signals/newspicks), AI intraday (#/bots/intraday), Passive investing (#/wealth/passive),
// Dividends & income (#/wealth/dividends) and the Active trading desk (#/active).
// Everything is information or the member's own rules, never advice; paper is the default.
let H;
const PAGES = {};
export function registerGrowth(routes, helpers) { H = helpers; Object.assign(routes, PAGES); }
const n = (v, d = 2) => (v == null || !isFinite(v) ? '-' : (+v).toLocaleString('en-US', { maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null ? '-' : `${(+v).toFixed(d)}%`);
const stat = (k, v, sub = '') => `<div class="stat"><span>${k}</span><b>${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
const card = (title, body, extra = '') => `<div class="card"><div class="dash-ch"><h2>${title}</h2>${extra}</div>${body}</div>`;
const head = (t, p) => `<div class="pagehead"><h1>${t}</h1><p class="mu" style="margin:4px 0 0">${p}</p></div>`;
const skel = '<div class="card"><div class="skel" role="status" aria-label="Loading"><div class="h1"></div><div></div><div></div><div class="w60"></div></div></div>';
const lock = (what, feature) => `<div class="empty lock"><b>${what}</b><button type="button" class="link" data-upgrade="${H.esc(feature)}">Unlock with Pro</button></div>`;
const wireUpgrade = el => H.$$('[data-upgrade]', el).forEach(b => (b.onclick = () => H.upgrade?.(b.dataset.upgrade)));
const acctSel = async (id, cur) => { const list = (await H.accounts()).filter(a => a.id === 'paper' || a.connected); return `<label class="acctpick">Account<select id="${id}">${list.map(a => `<option value="${H.esc(a.id)}" ${a.id === cur ? 'selected' : ''}>${H.esc(H.acctLabel(a))}</option>`).join('')}</select></label>`; };
const bar = (label, v, cls = '') => `<div class="bar-row"><span>${H.esc(label)}</span><i style="width:${Math.max(0, Math.min(100, v))}%" class="${cls}"></i><b>${pct(v)}</b></div>`;

// ---------- Diversification ----------
PAGES.diversify = async (view, q) => {
  const account = q.get('account') || H.state.account || 'paper';
  view.innerHTML = head('Diversification', 'How spread out your money is: across companies, sectors, countries and kinds of assets, and how alike your holdings move.') + `<form class="row card" id="dvf" style="align-items:flex-end">${await acctSel('dvAcct', account)}</form><div id="dvo">${skel}</div>`;
  H.$('#dvAcct', view).onchange = e => (location.hash = '#/riskview/diversify?account=' + encodeURIComponent(e.target.value));
  const out = H.$('#dvo', view);
  try {
    const d = await H.api('/diversify?account=' + encodeURIComponent(account));
    if (d.score == null) { out.innerHTML = card('Nothing held yet', `<div class="empty"><b>${H.esc(d.note || 'No holdings in this account.')}</b><a href="#/wealth">See index funds that spread money widely →</a></div>`); return; }
    const cls = d.score >= 75 ? 'pos' : d.score >= 50 ? '' : 'neg';
    out.innerHTML = card('Your diversification score', `<p class="big"><span class="pill ${cls}">${d.score} / 100 · ${H.esc(d.label)}</span></p>
        <div class="tablewrap"><table class="slim"><tbody>${d.parts.map(p => `<tr><th scope="row">${H.esc(p.name)}</th><td>${H.esc(p.detail)}</td><td class="num">${p.points} / ${p.of}</td></tr>`).join('')}</tbody></table></div>`)
      + `<div class="grid">${card('Sectors', d.sectors.slice(0, 8).map(s => bar(s.name, s.pct)).join(''))}${card('Countries', d.regions.map(s => bar(s.name, s.pct)).join(''))}${card('Kinds of assets', d.types.map(s => bar(s.name, s.pct)).join(''))}</div>`
      + card('Suggestions', `${d.suggestions.length ? d.suggestions.map((s, i) => `<div class="sugg"><h3>${H.esc(s.title)}</h3><p>${H.esc(s.why)}</p>
          <button type="button" class="ghost small" data-pv="${i}" aria-expanded="false">Preview</button>
          <div class="pv" id="pv${i}" hidden><div class="stats">${stat('Score', `${s.preview.scoreBefore} → <b>${s.preview.scoreAfter}</b>`)}${stat('Largest sector', `${H.esc(s.preview.topBefore?.name || '-')} ${pct(s.preview.topBefore?.pct)} → ${H.esc(s.preview.topAfter?.name || '-')} ${pct(s.preview.topAfter?.pct)}`)}${stat('In the US', `${pct(s.preview.usBefore)} → ${pct(s.preview.usAfter)}`)}</div>
            <p class="mu small-print">On paper only: ${s.sell ? `sell about ${H.money(s.sell.dollars)} of ${H.esc(s.sell.symbol)}, ` : ''}buy about ${H.money(s.buy.dollars)} of ${H.esc(s.buy.symbol)}${s.fromCash ? ' (from cash or new money)' : ''}. Nothing is sent until you place an order yourself.</p>
            <p>${s.sell ? `<a href="#/trade?symbol=${encodeURIComponent(s.sell.symbol)}">Open the ticket for ${H.esc(s.sell.symbol)} →</a> · ` : ''}<a href="#/trade?symbol=${encodeURIComponent(s.buy.symbol)}">Open the ticket for ${H.esc(s.buy.symbol)} →</a> · <a href="#/analyze?symbol=${encodeURIComponent(s.buy.symbol)}">About ${H.esc(s.buy.symbol)} →</a></p></div></div>`).join('') : '<div class="empty"><b>No changes stand out.</b><span>Your account is already spread out.</span></div>'}
        ${d.more ? lock(`${d.more} more suggestion${d.more === 1 ? '' : 's'} with previews in Pro.`, 'All diversification suggestions') : ''}<p class="mu small-print">${H.esc(d.note)}</p>`);
    H.$$('[data-pv]', out).forEach(b => (b.onclick = () => { const p = H.$('#pv' + b.dataset.pv, out); p.hidden = !p.hidden; b.setAttribute('aria-expanded', String(!p.hidden)); b.textContent = p.hidden ? 'Preview' : 'Hide preview'; }));
    wireUpgrade(out);
  } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; }
};

// ---------- AI morning picks ----------
PAGES.newspicks = async view => {
  view.innerHTML = head('AI morning picks', 'Before the open, the AI reads the news and pre-market moves of large US stocks, ranks the ones it expects to gain most today and proposes an allocation within your limits. Practice money by default.') + `<div id="npo">${skel}</div>`;
  const out = H.$('#npo', view);
  let d; try { d = await H.api('/newspicks'); } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; return; }
  const s = d.settings, R = d.record, accts = (await H.accounts()).filter(a => a.id === 'paper' || a.connected);
  const pickRow = p => `<li class="pick"><div class="pick-h"><b>#${p.rank}</b> <a href="#/analyze?symbol=${encodeURIComponent(p.symbol)}" data-no-tr><b>${H.esc(p.symbol)}</b></a> <span class="mu">score ${n(p.score, 2)}</span>${p.ret != null ? ` <span class="pill ${p.ret > 0 ? 'pos' : 'neg'}">${p.ret > 0 ? '+' : ''}${n(p.ret, 2)}% open to close</span>` : ''}</div>
    <ul class="plain small-print">${p.reasons.map(r => `<li>${H.esc(r)}</li>`).join('')}</ul>${p.sources.length ? `<p class="small-print">Sources: ${p.sources.map(x => `<a href="${H.esc(H.safeUrl(x.url))}" target="_blank" rel="noopener">${H.esc(x.title)}</a>${x.source ? ` <span class="mu">(${H.esc(x.source)})</span>` : ''}`).join(' · ')}</p>` : ''}</li>`;
  out.innerHTML = card(`Today's picks <span class="mu">${H.esc(d.day)}</span>`, d.picks.length ? `<ol class="plain picks">${d.picks.map(pickRow).join('')}</ol>
      ${d.paid && s.enabled && s.mode === 'approve' && !d.placedToday ? `<p><button id="npApprove">Approve and place today's picks on ${H.esc(s.account === 'paper' ? 'the practice account' : s.account)}</button></p><div class="err" id="npErr"></div>` : d.placedToday ? '<p class="ok">Today\'s picks were placed. They close before 3:50 PM New York time, or earlier at your stop.</p>' : ''}`
      : `<div class="empty"><b>No picks yet today.</b><span>${d.dataEnabled ? 'They are made at 9:00 New York time on trading days.' : 'Needs market data (news and pre-market prices), which is not set up on this server.'}</span></div>`)
    + card('The AI\'s real record', R.days ? `<div class="stats">${stat('Hit rate', `${R.hitRate}%`, `${R.picks} picks over ${R.days} days`)}${stat('Losing picks', String(R.losses))}${stat('Average pick', `${R.avg > 0 ? '+' : ''}${n(R.avg, 2)}%`)}${stat('Worst day', `${n(R.worst, 2)}%`)}${stat('Best day', `${R.best > 0 ? '+' : ''}${n(R.best, 2)}%`)}</div>
        <div class="tablewrap" tabindex="0" role="region" aria-label="Past picks"><table class="slim"><thead><tr><th>Day</th><th>Symbol</th><th class="num">Rank</th><th class="num">Open</th><th class="num">Close</th><th class="num">Result</th></tr></thead><tbody>${d.history.map(h => `<tr><td>${H.esc(h.day)}</td><td data-no-tr>${H.esc(h.symbol)}</td><td class="num">${h.rank}</td><td class="num">${H.money(h.open)}</td><td class="num">${H.money(h.close)}</td><td class="num ${h.ret > 0 ? 'pos' : h.ret < 0 ? 'neg' : ''}">${h.ret == null ? 'today' : (h.ret > 0 ? '+' : '') + n(h.ret, 2) + '%'}</td></tr>`).join('')}</tbody></table></div><p class="mu small-print">${H.esc(R.note)}</p>`
      : `<div class="empty"><b>${H.esc(R.note)}</b><span>Every day's picks and their result, losses included, are shown here as they happen.</span></div>`)
    + card('Your settings', d.paid ? `<form id="npf"><div class="row"><label class="chk"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Use AI morning picks</label>
        <label>How<select name="mode"><option value="approve" ${s.mode === 'approve' ? 'selected' : ''}>I approve each day</option><option value="auto" ${s.mode === 'auto' ? 'selected' : ''}>Place them automatically</option></select></label>
        <label>Account<select name="account">${accts.map(a => `<option value="${H.esc(a.id)}" ${a.id === s.account ? 'selected' : ''}>${H.esc(H.acctLabel(a))}</option>`).join('')}</select></label></div>
      <div class="row"><label>Daily budget $<input name="budget" type="number" min="10" value="${s.budget}"></label><label>Most per stock $<input name="perStock" type="number" min="5" value="${s.perStock}"></label><label>Picks a day<input name="maxPicks" type="number" min="1" max="5" value="${s.maxPicks}"></label><label>Stop loss %<input name="stopPct" type="number" min="0.5" max="20" step="0.5" value="${s.stopPct}"></label><label>Daily loss limit $<input name="dailyLoss" type="number" min="1" value="${s.dailyLoss}"></label></div>
      <fieldset class="live"><legend>Real money</legend><label class="chk"><input type="checkbox" name="live" ${s.live ? 'checked' : ''} ${d.elite ? '' : 'disabled'}> Allow a real brokerage account ${d.elite ? '' : '(Elite plan)'}</label>
        <label class="pw" hidden>Your password, to turn on real money<input name="password" type="password" autocomplete="current-password"></label>
        <p class="mu small-print">Off by default. With it on and a real account chosen, orders go to your brokerage within the limits above; the kill switch stops them at once. Day trades on a margin account under $25,000 are limited to 3 in 5 days.</p></fieldset>
      <button>Save</button><div class="err"></div></form>` : `<p>Choosing approve or automatic, your limits and the account is part of Pro. The picks and the record above are free to read.</p>${lock('Use AI morning picks with your own limits.', 'AI morning picks')}`)
    + (d.mine.length ? card('Your picks', `<div class="tablewrap"><table class="slim"><thead><tr><th>Day</th><th>Symbol</th><th>Account</th><th class="num">Amount</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Exit</th><th>Status</th></tr></thead><tbody>${d.mine.map(m => `<tr><td>${H.esc(m.day)}</td><td data-no-tr>${H.esc(m.symbol)}</td><td>${H.esc(m.account)}</td><td class="num">${H.money(m.dollars)}</td><td class="num">${H.money(m.entry)}</td><td class="num">${H.money(m.stop)}</td><td class="num">${H.money(m.exit)}</td><td>${H.esc(m.status)}${m.note ? ` <span class="mu">${H.esc(m.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`) : '')
    + `<p class="mu small-print">${H.esc(d.note)}</p>`;
  wireUpgrade(out);
  const f = H.$('#npf', out);
  if (f) {
    f.live.onchange = () => { H.$('.pw', f).hidden = !f.live.checked || s.live; };
    H.act(H.$('button', f), async () => { const v = H.form(f); const r = await H.api('/newspicks/settings', { method: 'PUT', body: v }); H.render(); return r.settings.account !== v.account ? 'Saved on the practice account (real money is off)' : 'Saved'; }, H.$('.err', f));
  }
  if (H.$('#npApprove', out)) H.act(H.$('#npApprove', out), async () => { const r = await H.api('/newspicks/approve', { body: {} }); setTimeout(H.render, 800); return `${r.results.filter(x => x.ok).length} of ${r.results.length} placed`; }, H.$('#npErr', out));
};

// ---------- AI intraday trading ----------
PAGES.intraday = async view => {
  view.innerHTML = head('AI intraday trading', 'An automatic engine that checks a short list of stocks every few minutes and buys or sells within your limits. Slow and rule-based, not high-frequency trading. Practice money by default.') + `<div id="ido">${skel}</div>`;
  const out = H.$('#ido', view);
  let d; try { d = await H.api('/intraday'); } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; return; }
  const s = d.settings, S = d.stats, accts = (await H.accounts()).filter(a => a.id === 'paper' || a.connected), open = Object.entries(d.open || {});
  const status = d.killed ? '<span class="pill neg">Stopped by the kill switch</span>' : s.enabled ? `<span class="pill pos">On · ${H.esc(s.account === 'paper' ? 'practice account' : s.account)} · every ${s.everyMin} min</span>` : '<span class="pill">Off</span>';
  out.innerHTML = card('Status', `<p>${status}</p>${d.dataEnabled ? '' : '<p class="mu">Needs 5-minute market data, which is not set up on this server, so the engine is idle.</p>'}
      <div class="stats">${stat('Orders', String(S.orders))}${stat('Closed trades', String(S.closed))}${stat('Hit rate', S.hitRate == null ? '-' : `${S.hitRate}%`, `${S.wins} wins · ${S.losses} losses`)}${stat('Result', S.pl == null ? '-' : H.money(S.pl))}${stat('Worst trade', S.worst == null ? '-' : H.money(S.worst))}</div>
      ${open.length ? `<p><b>Open now:</b> ${open.map(([k, p]) => `<span data-no-tr>${H.esc(k)}</span> ${p.qty} @ ${H.money(p.entry)}${p.held ? ' (held over ex-dividend)' : ''}`).join(' · ')}</p>` : ''}
      ${s.enabled ? '<p><button type="button" class="ghost" id="idStop">Turn off</button> <a href="#/risk">Kill switch →</a></p>' : ''}<div class="err" id="idErr"></div>`)
    + card('How it decides', `<ul class="plain small-print"><li><b>Buy</b> when the price is above its 20-bar (100-minute) average, the last 5-minute bar rose and RSI is between 50 and 70.</li><li><b>Sell</b> at your stop loss, at your target, when RSI goes over 75 or when the price falls back under the average.</li>
        <li><b>Hours:</b> ${H.esc(d.limits.hours)}.</li><li><b>Pattern-day-trader rule:</b> ${H.esc(d.limits.pdt)}; the engine stops buying when it would break it.</li>
        <li><b>Ex-dividend option:</b> for stocks on the dividend list, it can keep a position overnight to receive the dividend. The price usually drops by about the dividend on the ex-date, so this is not free money, and holding overnight carries gap risk.</li></ul>
        <p class="small-print">Dividend list: <span data-no-tr>${d.dividendList.map(H.esc).join(', ')}</span> (large US dividend payers, not a recommendation).</p>`)
    + card('Your settings', d.paid ? `<form id="idf"><div class="row"><label class="chk"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Turn on</label>
        <label>Account<select name="account">${accts.map(a => `<option value="${H.esc(a.id)}" ${a.id === s.account ? 'selected' : ''}>${H.esc(H.acctLabel(a))}</option>`).join('')}</select></label>
        <label>Stocks<select name="list"><option value="dividend" ${s.list === 'dividend' ? 'selected' : ''}>The dividend list</option><option value="custom" ${s.list === 'custom' ? 'selected' : ''}>My own list</option></select></label>
        <label>My own list (up to 10)<input name="symbols" value="${H.esc(s.symbols.join(', '))}" placeholder="AAPL, MSFT" data-no-tr></label></div>
      <div class="row"><label>Check every (minutes)<input name="everyMin" type="number" min="5" max="60" value="${s.everyMin}"></label><label>Most orders a day<input name="maxTrades" type="number" min="1" max="40" value="${s.maxTrades}"></label><label>Most per position $<input name="maxPosition" type="number" min="10" value="${s.maxPosition}"></label><label>Most open positions<input name="maxOpen" type="number" min="1" max="10" value="${s.maxOpen}"></label></div>
      <div class="row"><label>Stop loss %<input name="stopPct" type="number" min="0.3" max="10" step="0.1" value="${s.stopPct}"></label><label>Target %<input name="targetPct" type="number" min="0.3" max="20" step="0.1" value="${s.targetPct}"></label><label>Daily loss limit $<input name="dailyLoss" type="number" min="1" value="${s.dailyLoss}"></label><label class="chk"><input type="checkbox" name="holdExDiv" ${s.holdExDiv ? 'checked' : ''}> Hold dividend stocks over the ex-dividend date</label></div>
      <fieldset class="live"><legend>Real money</legend><label class="chk"><input type="checkbox" name="live" ${s.live ? 'checked' : ''} ${d.elite ? '' : 'disabled'}> Allow a real brokerage account ${d.elite ? '' : '(Elite plan)'}</label>
        <label class="pw" hidden>Your password, to turn on real money<input name="password" type="password" autocomplete="current-password"></label>
        <p class="mu small-print">Off by default. Try it on the practice account first. With real money on, orders go to your brokerage within the limits above; the kill switch stops new orders at once.</p></fieldset>
      <button>Save</button><div class="err"></div></form>` : `<p>Turning the engine on, with your own limits, is part of Pro. How it works and its limits are free to read.</p>${lock('Run AI intraday trading on the practice account.', 'AI intraday trading')}`)
    + card('Trade log', d.log.length ? `<div class="tablewrap" tabindex="0" role="region" aria-label="Trade log"><table class="slim"><thead><tr><th>When</th><th>Account</th><th>Symbol</th><th>Side</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Result</th><th>Why</th></tr></thead><tbody>${d.log.map(l => `<tr><td>${H.date(l.at)}</td><td>${H.esc(l.account)}</td><td data-no-tr>${H.esc(l.symbol)}</td><td>${l.side}</td><td class="num">${l.qty}</td><td class="num">${H.money(l.price)}</td><td class="num ${l.pl > 0 ? 'pos' : l.pl < 0 ? 'neg' : ''}">${l.pl == null ? '' : H.money(l.pl)}</td><td class="small-print">${H.esc(l.reason)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><b>No orders yet.</b><span>Every order the engine places, and why, is listed here, losses included.</span></div>')
    + `<p class="mu small-print">${H.esc(d.note)}</p>`;
  wireUpgrade(out);
  const f = H.$('#idf', out);
  if (f) {
    f.live.onchange = () => { H.$('.pw', f).hidden = !f.live.checked || s.live; };
    H.act(H.$('button', f), async () => { const v = H.form(f); const r = await H.api('/intraday/settings', { method: 'PUT', body: v }); H.render(); return r.settings.account !== v.account ? 'Saved on the practice account (real money is off)' : 'Saved'; }, H.$('.err', f));
  }
  if (H.$('#idStop', out)) H.act(H.$('#idStop', out), async () => { await H.api('/intraday/stop', { body: {} }); H.render(); return 'Turned off'; }, H.$('#idErr', out));
};

// ---------- Dividends & income ----------
PAGES.dividends = async (view, q) => {
  const account = q.get('account') || H.state.account || 'paper';
  view.innerHTML = head('Dividends & income', 'What your holdings pay: yearly income, yield, how safe each dividend looks, the next dates and a 12-month forecast by month.') + `<form class="row card" style="align-items:flex-end">${await acctSel('dvdAcct', account)}</form><div id="dvdo">${skel}</div>`;
  H.$('#dvdAcct', view).onchange = e => (location.hash = '#/wealth/dividends?account=' + encodeURIComponent(e.target.value));
  const out = H.$('#dvdo', view);
  let d; try { d = await H.api('/income?account=' + encodeURIComponent(account)); } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; return; }
  if (!d.rows.length) { out.innerHTML = card('Nothing held yet', '<div class="empty"><b>No holdings in this account.</b><a href="#/scanner/valuescan">Find dividend payers with the stock scanner →</a></div>'); return; }
  const max = Math.max(1, ...(d.monthly || []).map(m => m.income));
  const safe = s => (s ? `<span class="pill ${s.score >= 70 ? 'pos' : s.score >= 45 ? '' : 'neg'}">${s.score} · ${H.esc(s.label)}</span>` : '');
  out.innerHTML = `<div class="stats card">${stat('Yearly income, expected', H.money(d.total))}${stat('Yield on the account', pct(d.yieldOnValue, 2))}${stat('Paying holdings', String(d.rows.filter(r => r.dps).length) + ' of ' + d.rows.length)}${stat('Reinvesting (DRIP)', d.drip ? 'On' : 'Off', `<a href="#/wealth?tab=drip">${d.drip ? 'Change' : 'Turn on'} →</a>`)}</div>
      <p class="card"><label class="chk"><input type="checkbox" id="dvdRem" ${d.reminders ? 'checked' : ''}> Remind me the day before a holding goes ex-dividend or reports earnings</label></p>`
    + (d.monthly ? card('Income by month, next 12 months', `<div class="mbars" role="img" aria-label="Expected income by month: ${d.monthly.map(m => `${m.month} ${H.money(m.income)}`).join(", ")}">${d.monthly.map(m => `<div class="mb"><i style="height:${(m.income / max * 100).toFixed(1)}%" title="${H.esc(m.month)}: ${H.money(m.income)}"></i><span>${H.esc(m.month.slice(5))}</span></div>`).join('')}</div>
        <div class="tablewrap"><table class="slim"><thead><tr><th>Month</th><th class="num">Expected</th><th>From</th></tr></thead><tbody>${d.monthly.filter(m => m.income).map(m => `<tr><td>${H.esc(m.month)}</td><td class="num">${H.money(m.income)}</td><td class="small-print" data-no-tr>${m.items.map(i => `${H.esc(i.symbol)} ${H.money(i.amount)}`).join(', ')}</td></tr>`).join('')}</tbody></table></div>
        ${d.notMonthly?.length ? `<p class="mu small-print">Not in the months above (no payment dates listed, yearly amount from annual reports): <span data-no-tr>${d.notMonthly.map(H.esc).join(', ')}</span>. They are in the yearly total.</p>` : ''}`) : '')
    + card('Coming up', d.calendar.length ? `<div class="tablewrap"><table class="slim"><thead><tr><th>Ex-dividend</th><th>Paid</th><th>Symbol</th><th class="num">Per share</th><th class="num">You get</th></tr></thead><tbody>${d.calendar.map(c => `<tr><td>${H.esc(c.ex_date)}</td><td>${H.esc(c.payable_date || '-')}</td><td data-no-tr>${H.esc(c.symbol)}</td><td class="num">${H.money(c.rate)}</td><td class="num">${H.money(c.amount)}</td></tr>`).join('')}</tbody></table></div><p class="mu small-print">Own the shares before the ex-dividend date to receive the payment. The price usually drops by about the dividend that morning.</p>`
      : `<div class="empty"><b>${H.esc(d.calendarNote || 'No announced dividends in the next four months.')}</b></div>`)
    + card('Your holdings', `<div class="tablewrap" tabindex="0" role="region" aria-label="Dividends of your holdings"><table class="slim"><thead><tr><th>Symbol</th><th class="num">Shares</th><th class="num">Yearly per share</th><th class="num">Yield</th><th class="num">Yearly income</th><th>Next ex-date</th><th>Safety</th></tr></thead><tbody>${d.rows.map(r => `<tr><td><a href="#/analyze?symbol=${encodeURIComponent(r.symbol)}&view=dividends" data-no-tr>${H.esc(r.symbol)}</a></td><td class="num">${n(r.qty, 4)}</td><td class="num">${r.dps ? H.money(r.dps) : '-'}${r.dpsSource === 'filings' ? ' <span class="mu" title="From the last annual report">(report)</span>' : ''}</td><td class="num">${pct(r.yieldPct, 2)}</td><td class="num">${H.money(r.income)}</td><td>${H.esc(r.nextEx || '-')}</td><td>${r.locked ? '<button type="button" class="link" data-upgrade="Dividend safety scores">Pro</button>' : r.kind === 'stock' ? safe(r.safety) || '<span class="mu">no dividend</span>' : '<span class="mu">fund</span>'}</td></tr>`).join('')}</tbody></table></div>
      ${d.locked ? lock(`Safety scores for ${d.locked} more holding${d.locked === 1 ? '' : 's'} are in Pro.`, 'Dividend safety scores') : ''}
      <p class="mu small-print">Safety score: payout ratio, free cash flow cover, years of increases, debt and profit, from SEC annual reports. Source of payments: ${H.esc(d.source)}. ${H.esc(d.note)}</p>`)
    + H.related([['wealth?tab=drip', 'Reinvest dividends'], ['scanner/valuescan', 'Stock scanner'], ['wealth/passive', 'Passive investing'], ['tax', 'Taxes']]);
  wireUpgrade(out);
  const rem = H.$('#dvdRem', out); if (rem) rem.onchange = () => H.api('/income/reminders', { method: 'PUT', body: { on: rem.checked } }).catch(e => { rem.checked = !rem.checked; alert(e.message); });
};

// ---------- Passive investing ----------
PAGES.passive = async (view, q) => {
  const account = q.get('account') || H.state.account || 'paper';
  view.innerHTML = head('Passive investing', 'Buy a few low-cost index funds, add money regularly and hold. Everything Brightolio has for it, in one place.') + `<form class="row card" style="align-items:flex-end">${await acctSel('psAcct', account)}</form><div id="pso">${skel}</div>`;
  H.$('#psAcct', view).onchange = e => (location.hash = '#/wealth/passive?account=' + encodeURIComponent(e.target.value));
  const out = H.$('#pso', view);
  let d; try { d = await H.api('/income/passive?account=' + encodeURIComponent(account)); } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; return; }
  const c = d.check, X = d.dragExample;
  out.innerHTML = card('Your account today', c.total ? `<p><span class="pill">${H.esc(c.label)}</span></p>${bar('Broad index funds', c.broadPct, 'pos')}${bar('Other funds', c.fundsPct)}${bar('Single stocks', c.stocksPct)}${bar('Cash', c.cashPct)}
      <p class="small-print">${c.fee != null ? `Average yearly fee of the index funds you hold: <b>${c.fee}%</b>.` : 'None of the funds you hold are in the toolkit\'s fee list.'} <a href="#/riskview/diversify?account=${encodeURIComponent(account)}">Check how spread out it is →</a></p>` : '<div class="empty"><b>This account is empty.</b><span>Start with one of the example mixes below.</span></div>')
    + `<div class="card"><div class="dash-ch"><h2>Four steps</h2></div><ol class="steps">
        <li><b>Pick a mix.</b> One to three broad funds. <a href="#/lowcost">Compare index and mutual funds →</a></li>
        <li><b>Set a plan.</b> How much each month, and what it could grow to. <a href="#/wealth/sp500">S&amp;P 500 plan →</a></li>
        <li><b>Automate it.</b> Buy the mix every week or month by itself. <a href="#/wealth?tab=auto">Automatic investing →</a> or let a <a href="#/portfolios/robo">automated portfolio</a> rebalance it.</li>
        <li><b>Hold and reinvest.</b> Reinvest dividends and check twice a year. <a href="#/wealth?tab=drip">Reinvest dividends →</a> · <a href="#/insights/longterm">Long-term view →</a></li></ol></div>`
    + card('Example mixes', `<div class="grid">${d.mixes.map(m => `<div class="sugg"><h3>${H.esc(m.name)}</h3><p class="mu">${H.esc(m.about)}</p><p data-no-tr>${m.parts.map(([s, w]) => `<a href="#/analyze?symbol=${s}">${s}</a> ${w}%`).join(' · ')}</p><p class="small-print">Yearly fee about ${m.fee}%</p></div>`).join('')}</div><p class="mu small-print">${H.esc(d.note)}</p>`)
    + card('Why fees matter', `<p>${H.money(X.amount)} for ${X.years} years at ${X.ret}% a year: a 0.03% fee costs about <b>${H.money(X.low)}</b>; a 1% fee costs about <b>${H.money(X.high)}</b>.</p><p class="mu small-print">An example with a steady return to show the effect of fees; real returns go up and down and are not guaranteed.</p>`)
    + H.related([['lowcost', 'Low-cost index & mutual funds'], ['wealth/sp500', 'S&P 500 plan'], ['portfolios/robo', 'Automated portfolios'], ['wealth/dividends', 'Dividends & income']]);
};

// ---------- Active trading desk ----------
PAGES.active = async (view, q) => {
  const account = q.get('account') || H.state.account || 'paper';
  view.innerHTML = head('Active trading desk', 'Your trading day on one screen: the session, buying power, the day-trade rule, positions, today\'s movers and your automatic engines.') + `<form class="row card" style="align-items:flex-end">${await acctSel('acAcct', account)}<p><a href="#/trade">New order →</a> · <a href="#/chart">Chart →</a></p></form><div id="aco">${skel}</div>`;
  H.$('#acAcct', view).onchange = e => (location.hash = '#/active?account=' + encodeURIComponent(e.target.value));
  const out = H.$('#aco', view);
  let d; try { d = await H.api('/active?account=' + encodeURIComponent(account)); } catch (e) { out.innerHTML = `<div class="card"><p class="err">${H.esc(e.message)}</p></div>`; return; }
  const M = d.money, S = d.session, sig = v => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const mv = (t, list) => `<div><h3>${t}</h3>${list?.length ? `<ul class="plain">${list.map(x => `<li><a href="#/analyze?symbol=${encodeURIComponent(x.symbol)}" data-no-tr>${H.esc(x.symbol)}</a> <span class="${sig(x.pct)}">${x.pct > 0 ? '+' : ''}${n(x.pct, 1)}%</span> <a class="small-print" href="#/trade?symbol=${encodeURIComponent(x.symbol)}">Trade</a></li>`).join('')}</ul>` : '<p class="mu">-</p>'}</div>`;
  out.innerHTML = `<div class="stats card">${stat('Session', H.esc(S.label), S.minutesToOpen ? `opens in ${S.minutesToOpen} min` : S.minutesToClose ? `closes in ${S.minutesToClose} min` : '')}${stat('Equity', H.money(M.equity), M.today != null ? `<span class="${sig(M.today)}">${M.today > 0 ? '+' : ''}${H.money(M.today)} today (${n(M.todayPct, 2)}%)</span>` : '')}${stat('Buying power', H.money(M.buyingPower), M.dayBuyingPower ? `day-trading ${H.money(M.dayBuyingPower)}` : '')}${stat('Day-trade rule', d.pdt.applies ? (d.pdt.left != null ? `${d.pdt.left} left` : 'Applies') : 'No limit', H.esc(d.pdt.text))}</div>`
    + (d.killed ? '<div class="banner">The kill switch is on: automatic orders are stopped. <a href="#/risk">Risk controls →</a></div>' : '')
    + `<div class="grid">${card('Positions', d.positions.length ? `<div class="tablewrap"><table class="slim"><thead><tr><th>Symbol</th><th class="num">Qty</th><th class="num">Price</th><th class="num">P/L</th><th></th></tr></thead><tbody>${d.positions.slice(0, 15).map(p => `<tr><td data-no-tr><a href="#/analyze?symbol=${encodeURIComponent(p.symbol)}">${H.esc(p.symbol)}</a></td><td class="num">${n(p.qty, 4)}</td><td class="num">${H.money(p.price)}</td><td class="num ${sig(p.pnl)}">${H.money(p.pnl)}${p.pnlPct != null ? ` (${n(p.pnlPct, 1)}%)` : ''}</td><td><a class="small-print" href="#/trade?symbol=${encodeURIComponent(p.symbol)}&side=sell">Sell</a></td></tr>`).join('')}</tbody></table></div>${d.positions.length > 15 ? '<p><a href="#/positions">All positions →</a></p>' : ''}` : '<div class="empty"><b>No open positions.</b></div>')}
      ${card('Today\'s movers', d.movers ? `<div class="grid">${mv('Up most', d.movers.gainers)}${mv('Down most', d.movers.losers)}</div><p class="mu small-print">US stocks, from the market screener. Big movers are often volatile; information, not a recommendation.</p>` : '<div class="empty"><b>Movers need market data, which is not set up on this server.</b><a href="#/scanner">Use the scanners →</a></div>')}</div>`
    + card('Automatic engines', `<ul class="plain">${d.engines.map(e => `<li><a href="#/${e.href}">${H.esc(e.name)}</a> ${e.on ? `<span class="pill pos">On · ${H.esc(e.account)}</span>` : '<span class="pill">Off</span>'}</li>`).join('')}</ul>`)
    + `<p class="mu small-print">${H.esc(d.note)}</p>` + H.related([['scanner', 'Scanners'], ['chart', 'Chart'], ['bots/intraday', 'AI intraday'], ['signals/newspicks', 'AI morning picks'], ['risk', 'Risk controls'], ['riskview/margin', 'Margin center']]);
};
