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
