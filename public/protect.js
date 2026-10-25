// Protection & long-term pages: security (passkeys, account lock, support agent), execution and
// routing (audit log with hashes, routing preferences, order queue), lessons, the long-term view
// with stress test and margin watch, the drag-and-drop workspace, and the owner's system health.
let H;
const later = ms => { const h = location.hash; setTimeout(() => location.hash === h && H.render(), ms); };
export function registerProtect(routes, helpers) {
  H = helpers;
  Object.assign(routes, { security, execution, learn, longterm, workspace, accounts: allAccounts, 'admin-system': system });
}
const pc = (v, d = 1) => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);
const stat = (k, v, c = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`;

// ---------- WebAuthn helpers ----------
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
export async function createPasskey(o) {
  const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64u(o.challenge), user: { ...o.user, id: unb64u(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: unb64u(c.id) })) } });
  return { id: cred.id, rawId: b64u(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), response: { clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject), transports: cred.response.getTransports?.() || [] } };
}
export async function getPasskey(o) {
  const a = await navigator.credentials.get({ publicKey: { ...o, challenge: unb64u(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: unb64u(c.id) })) } });
  return { id: a.id, rawId: b64u(a.rawId), type: a.type, clientExtensionResults: a.getClientExtensionResults(), response: { clientDataJSON: b64u(a.response.clientDataJSON), authenticatorData: b64u(a.response.authenticatorData), signature: b64u(a.response.signature), userHandle: a.response.userHandle ? b64u(a.response.userHandle) : undefined } };
}

// ---------- security ----------
async function security(view) {
  const d = await H.api('/security');
  const pk = !!window.PublicKeyCredential;
  view.innerHTML = `<div class="pagehead"><h1>Security</h1><p class="mu">Passkeys, the account lock, and help from our support agent.</p></div>
  <div class="card killcard ${d.lock.on ? 'on' : ''}"><div><h2>Account lock ${d.lock.on ? '<span class="pill warn">LOCKED</span>' : ''}</h2>
    <p class="mu">${d.lock.on ? 'Orders and withdrawals are frozen. Unlock with your password' + (d.twoFactor ? ' and your 2FA code.' : '.') : 'If anything looks wrong, lock the account: all orders and withdrawals freeze at once, open orders are cancelled and automations stop.'}</p></div>
    ${d.lock.on ? `<form class="row" id="unl"><label>Password<input name="password" type="password" autocomplete="current-password"></label>${d.twoFactor ? '<label>2FA code<input name="code" inputmode="numeric"></label>' : ''}<button>Unlock</button></form>` : '<button id="lockNow" class="danger">Lock account</button>'}<div class="err"></div></div>
  <div class="card"><h2>Passkeys</h2><p class="mu">Sign in with Face ID, Touch ID, Windows Hello, your phone, or a hardware security key such as a YubiKey. Passkeys cannot be phished.</p>
    <div class="tablewrap"><table><tr><th>Name</th><th>Added</th><th>Last used</th><th></th></tr>${d.passkeys.map(k => `<tr><td>${H.esc(k.name)}</td><td>${H.date(k.created_at)}</td><td>${k.last_used_at ? H.date(k.last_used_at) : '-'}</td><td><button class="small ghost" data-rm="${k.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="mu">No passkeys yet</td></tr>'}</table></div>
    ${pk ? '<div class="row"><label>Name<input id="pkName" value="My device"></label><button id="addPk">Add a passkey</button></div>' : '<p class="mu">This browser does not support passkeys.</p>'}
    <label class="chk"><input type="checkbox" id="pkOnly" ${d.passkeyOnly ? 'checked' : ''} ${d.passkeys.length ? '' : 'disabled'}> Passkey only (turn off password sign-in)</label><div class="err" id="pkErr"></div>
    <p class="mu small-print">Two-factor codes are in <a href="#/settings">Settings</a>. Sign-in typing rhythm is learned from your own sign-ins (${d.behavior.learning ? 'still learning' : d.behavior.samples + ' samples'}); an unusual pattern asks you to confirm it is you before trading or withdrawing.</p></div>
  <div class="card"><h2>Help & support</h2><div class="chatlog" id="slog" style="min-height:120px"></div>
    <form id="sask" class="chatin"><textarea name="q" rows="2" placeholder="Ask about sign-in, passkeys, transfers, billing..." aria-label="Message"></textarea><div class="chatbtns"><button>Send</button></div></form><div class="err"></div>
    <p class="mu small-print">The support agent never asks for passwords or codes. If you report a hacked account it locks the account and alerts our security team right away.</p></div>`;
  if (H.$('#lockNow', view)) H.act(H.$('#lockNow', view), async () => { if (!confirm('Lock your account now? Orders and withdrawals freeze immediately.')) return; await H.api('/security/lock', { body: { reason: 'locked from the Security page' } }); H.render(); });
  if (H.$('#unl', view)) H.act(H.$('#unl button', view), async () => { const r = await H.api('/security/unlock', { body: H.form(H.$('#unl', view)) }); later(1500); return r.note; });
  if (H.$('#addPk', view)) H.act(H.$('#addPk', view), async () => { const o = await H.api('/security/passkeys/options', { body: {} }); const response = await createPasskey(o); await H.api('/security/passkeys', { body: { response, name: H.$('#pkName', view).value } }); later(600); return 'Passkey added'; }, H.$('#pkErr', view));
  H.$$('[data-rm]', view).forEach(b => (b.onclick = async () => { if (!confirm('Remove this passkey?')) return; try { await H.api('/security/passkeys/' + b.dataset.rm, { method: 'DELETE' }); H.render(); } catch (e) { H.$('#pkErr', view).textContent = e.message; } }));
  H.$('#pkOnly', view).onchange = async e => { try { await H.api('/security/passkey-only', { method: 'PUT', body: { on: e.target.checked } }); } catch (x) { e.target.checked = !e.target.checked; H.$('#pkErr', view).textContent = x.message; } };
  const msgs = [], log = H.$('#slog', view), f = H.$('#sask', view);
  const draw = () => { log.innerHTML = msgs.map(m => `<div class="msg ${m.role}">${H.esc(m.content)}</div>`).join('') || '<div class="mu" style="padding:8px">How can we help?</div>'; log.scrollTop = log.scrollHeight; };
  draw();
  H.act(H.$('button', f), async () => {
    const q = f.q.value.trim(); if (!q) return; msgs.push({ role: 'user', content: q }); f.q.value = ''; draw();
    const r = await H.api('/security/support', { body: { messages: msgs } }); msgs.push({ role: 'assistant', content: r.reply }); draw();
    if (r.actions?.includes('security_escalation')) later(2500);
  });
}

// ---------- execution & routing ----------
async function execution(view) {
  const [d, q] = await Promise.all([H.api('/exec'), H.api('/queue')]), p = d.routing;
  view.innerHTML = `<div class="pagehead"><h1>Execution & routing</h1><p class="mu">Every order records the bid and ask at the moment it was sent, then the fill, in a log that cannot be edited: each entry carries the fingerprint (SHA-256) of the one before.</p></div>
  <form class="card" id="rt"><h2>Smart order routing</h2><p class="mu">Choose "Smart route" as the account on a ticket and buys go to whichever of your connected brokerages scores best on price improvement, fill rate and speed, falling back to the next one if it is down. Sells go to the brokerage holding the shares.</p>
    <div class="row"><label>Price improvement weight<input name="price" type="number" step="0.1" min="0" value="${p.weights.price}"></label><label>Fill rate weight<input name="fillRate" type="number" step="0.1" min="0" value="${p.weights.fillRate}"></label><label>Speed weight<input name="speed" type="number" step="0.1" min="0" value="${p.weights.speed}"></label></div>
    <label class="chk"><input type="checkbox" name="failover" ${p.failover ? 'checked' : ''}> Fall back to my next brokerage if one is down</label>
    <label class="chk"><input type="checkbox" name="directOnly" ${p.directOnly ? 'checked' : ''}> Direct to exchange only: route only to brokerages that send orders straight to public exchanges without payment for order flow${d.directBrokers.length ? ` (${d.directBrokers.map(H.esc).join(', ')})` : ' (none listed yet)'}</label>
    <button>Save routing</button><div class="err"></div></form>
  <div class="card"><h2>Your brokerages, scored</h2><div class="tablewrap"><table><tr><th>Brokerage</th><th>Score</th><th>Price</th><th>Fill rate</th><th>Speed</th><th>Status</th><th>Orders measured</th></tr>
    ${d.venues.map(v => `<tr><td>${H.esc(v.venue)}</td><td><b>${v.score}</b></td><td>${v.priceScore}</td><td>${v.fillScore}</td><td>${v.speedScore}</td><td>${v.breaker === 'open' ? '<span class="pill warn">unavailable</span>' : '<span class="pill ok">ok</span>'}</td><td>${v.basedOn}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">Connect a brokerage to compare</td></tr>'}</table></div>
    <p class="mu small-print">Quotes come from ${d.quoteFeed === 'sip' ? 'the consolidated feed (NBBO)' : "the free IEX feed, one exchange's quote rather than the full NBBO; set ALPACA_STOCK_FEED=sip on the server for the NBBO"}.</p></div>
  <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Execution log</h2><span class="row" style="gap:6px"><button class="ghost small" id="ver">Verify chain</button><a href="/api/exec/export"><button type="button" class="ghost small">Download</button></a></span></div><div class="err" id="vOut"></div>
    <div class="tablewrap"><table><tr><th>When</th><th>Event</th><th>Order</th><th>Bid / ask</th><th>Price</th><th>Improvement</th><th>Fingerprint</th></tr>
    ${d.log.map(x => { const v = x.data, qt = v.quote || {}; return `<tr><td>${H.date(x.at)}</td><td>${H.esc(v.event)}</td><td>${H.esc(v.side || '')} ${H.esc(v.symbol || '')} · ${H.esc(v.venue || v.from || '')}${v.reason ? `<div class="mu small-print">${H.esc(v.reason)}</div>` : ''}</td><td>${qt.bid || qt.ask ? `${qt.bid ?? '-'} / ${qt.ask ?? '-'}` : qt.last ? 'last ' + qt.last : '-'}</td><td>${v.price ?? '-'}</td><td>${v.improvementBps != null ? v.improvementBps + ' bps' : '-'}</td><td class="mono" data-no-tr title="${H.esc(x.hash)}">${x.hash.slice(0, 10)}…</td></tr>`; }).join('') || '<tr><td colspan="7" class="mu">No orders yet</td></tr>'}</table></div></div>
  <div class="card"><h2>Order queue</h2><p class="mu">When a brokerage is down or the market is very busy, orders from your bots and alerts wait here for up to two minutes instead of failing.</p>
    <div class="tablewrap"><table><tr><th>When</th><th>Order</th><th>Source</th><th>Status</th><th>Result</th></tr>${q.map(x => { const o = JSON.parse(x.payload); return `<tr><td>${H.date(x.created_at)}</td><td>${H.esc(o.side)} ${H.esc(o.symbol)} · ${H.esc(x.account)}</td><td>${H.esc(x.source)}</td><td>${H.esc(x.status)}</td><td class="small-print">${H.esc(x.result || x.reason || '')}</td></tr>`; }).join('') || '<tr><td colspan="5" class="mu">Nothing queued</td></tr>'}</table></div></div>`;
  const f = H.$('#rt', view);
  H.act(H.$('button', f), async () => { const x = H.form(f); await H.api('/exec/routing', { method: 'PUT', body: { directOnly: x.directOnly, failover: x.failover, weights: { price: x.price, fillRate: x.fillRate, speed: x.speed } } }); later(500); return 'Saved'; });
  H.act(H.$('#ver', view), async () => { const r = await H.api('/exec/verify'); if (!r.ok) throw new Error(`Chain broken at entry ${r.brokenAt}`); return `All ${r.entries} entries check out.`; }, H.$('#vOut', view));
}

// ---------- lessons ----------
async function learn(view) {
  const d = await H.api('/learn');
  view.innerHTML = `<div class="pagehead"><h1>Learn</h1><p class="mu">Short lessons. Each high-risk instrument unlocks for real money after its lesson; paper trading is always open.</p></div>
    <div class="cards">${d.lessons.map(l => `<form class="card lesson" data-id="${l.id}"><h2>${H.esc(l.title)} ${l.done ? '<span class="pill ok">done</span>' : `<span class="pill">${l.minutes} min</span>`}</h2>
      <ul>${l.body.map(b => `<li>${H.esc(b)}</li>`).join('')}</ul>
      ${l.quiz.map((q, i) => `<fieldset><legend>${i + 1}. ${H.esc(q.q)}</legend>${q.a.map((a, j) => `<label class="chk"><input type="radio" name="q${i}" value="${j}"> ${H.esc(a)}</label>`).join('')}</fieldset>`).join('')}
      <button>${l.done ? 'Take it again' : 'Check answers'}</button><div class="err"></div></form>`).join('')}</div>`;
  H.$$('form.lesson', view).forEach(f => H.act(H.$('button', f), async () => {
    const n = H.$$('fieldset', f).length, answers = Array.from({ length: n }, (_, i) => +(H.$(`[name=q${i}]:checked`, f)?.value ?? -1));
    await H.api('/learn/' + f.dataset.id, { body: { answers } }); later(1200); return 'Well done: lesson complete.';
  }));
}

// ---------- long-term view ----------
async function longterm(view, q) {
  const accts = await H.accounts(), account = q.get('account') || 'paper';
  const [d, s, m] = await Promise.all([H.api('/longterm?account=' + account), H.api('/longterm/stress?account=' + account).catch(() => null), account === 'alpaca' ? H.api('/margin').catch(() => null) : null]);
  const you = d.you || {}, sp = d.sp500 || {}, dv = d.diversification;
  view.innerHTML = `<div class="pagehead row" style="justify-content:space-between;align-items:flex-end"><div><h1>Long-term view</h1><p class="mu">Your account over years, not minutes: growth against the S&P 500, risk-adjusted returns and how spread out your money is.</p></div><label class="inline">Account <select id="acct">${H.accountOptions(accts, account)}</select></label></div>
  <div class="card"><h2>Growth since ${H.esc(d.since || '-')}</h2><canvas class="chart" id="ltc"></canvas><p class="mu small-print">Colored line: your account. Grey: the S&P 500 (SPY) over the same days, scaled to your start.</p></div>
  <div class="card"><h2>Risk-adjusted returns</h2><div class="tablewrap"><table><tr><th></th><th>You</th><th>S&P 500</th></tr>
    ${[['Total return', 'totalReturn'], ['Per year', 'cagr'], ['Volatility', 'volatility'], ['Max drawdown', 'maxDrawdown'], ['Sharpe ratio', 'sharpe'], ['Sortino ratio', 'sortino']].map(([k, f]) => `<tr><td>${k}</td><td>${['sharpe', 'sortino'].includes(f) ? (you[f] ?? '-') : pc(f === 'maxDrawdown' && you[f] ? -you[f] : you[f])}</td><td>${['sharpe', 'sortino'].includes(f) ? (sp[f] ?? '-') : pc(f === 'maxDrawdown' && sp[f] ? -sp[f] : sp[f])}</td></tr>`).join('')}</table></div>
    ${d.byYear.length ? `<h3>By year</h3><div class="stats">${d.byYear.map(y => stat(y.year, pc(y.returnPct), H.cls(y.returnPct))).join('')}</div>` : ''}${!d.you ? '<p class="mu">Your history fills in day by day.</p>' : ''}</div>
  <div class="card"><h2>Diversification</h2><div class="stats">${stat('Holdings', dv.positions)}${stat('Largest holding', dv.largestPct + '%')}${stat('Effective independent bets', dv.effectiveBets ?? '-')}${stat('Crypto share', dv.cryptoPct + '%')}</div><p><b>${H.esc(dv.verdict)}</b></p></div>
  ${s ? `<div class="card"><h2>Stress test</h2><p class="mu">Portfolio beta ${s.portfolioBeta}. ${H.esc(s.note)}</p><div class="tablewrap"><table><tr><th>Scenario</th><th>Estimated loss</th><th>Account after</th></tr>${s.scenarios.map(x => `<tr><td>${H.esc(x.name)}</td><td class="neg">${H.money(x.estimatedLoss)} (${x.pctOfEquity}%)</td><td>${H.money(x.equityAfter)}</td></tr>`).join('')}</table></div></div>` : ''}
  ${m?.connected ? `<div class="card"><h2>Margin & liquidity watch</h2>${m.error ? `<p class="err">${H.esc(m.error)}</p>` : `<div class="stats">${stat('Equity', H.money(m.equity))}${stat('Maintenance requirement', H.money(m.maintenance))}${stat('Buying power', H.money(m.buyingPower))}${stat('Leverage', m.leverage + 'x')}${stat('Market drop to a margin call', m.stress.dropToCallPct == null ? '-' : m.stress.dropToCallPct + '%')}${stat('Days to a call at this trend', m.forecast.daysToCall ?? 'not shrinking')}</div>
    <p class="mu small-print">Brokers pass clearinghouse requirements on as your maintenance margin; it is tracked daily so a shrinking cushion shows up days ahead.${m.feed ? ' Includes per-symbol requirements from the margin data feed.' : ''}</p>`}</div>` : ''}`;
  if (d.curve.length > 1) { const k = d.curve[0].equity / d.curve[0].spy; H.drawChart(H.$('#ltc', view), d.curve.map(x => x.equity), { compare: d.curve.map(x => x.spy * k) }); } else H.drawChart(H.$('#ltc', view), []);
  H.$('#acct', view).onchange = e => (location.hash = '#/longterm?account=' + e.target.value);
}

// ---------- workspace ----------
const WIDGETS = { chart: 'Chart', watch: 'Watchlist', ticket: 'Order ticket', positions: 'Positions', news: 'Headlines', risk: 'Risk status' };
async function workspace(view) {
  let layout = (await H.api('/prefs/workspace')).value;
  if (!layout?.length) layout = [{ w: 'chart', size: 2, sym: 'SPY' }, { w: 'ticket', size: 1, sym: 'SPY' }, { w: 'watch', size: 1 }, { w: 'positions', size: 1 }, { w: 'news', size: 1 }];
  const accts = await H.accounts();
  const save = () => H.api('/prefs/workspace', { method: 'PUT', body: { value: layout } }).catch(() => {});
  view.innerHTML = `<div class="pagehead row" style="justify-content:space-between;align-items:flex-end"><div><h1>Workspace</h1><p class="mu">Drag panels to arrange them, make them wide or narrow, add or remove them. Your layout is saved to your account.</p></div>
    <span class="row" style="gap:6px"><select id="addW">${Object.entries(WIDGETS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><button id="addBtn" class="ghost">Add panel</button></span></div><div class="wsgrid" id="ws"></div>`;
  const ws = H.$('#ws', view);
  const draw = () => {
    ws.innerHTML = layout.map((p, i) => `<div class="card wpanel s${p.size}" draggable="true" data-i="${i}"><div class="whead"><span class="grip" aria-hidden="true">⠿</span><b>${WIDGETS[p.w] || p.w}</b>${['chart', 'ticket'].includes(p.w) ? `<input class="wsym" value="${H.esc(p.sym || 'SPY')}" aria-label="Symbol" data-no-tr>` : ''}<span class="row" style="gap:4px;margin-inline-start:auto"><button class="small ghost" data-size title="Wide or narrow">⇔</button><button class="small ghost" data-del title="Remove">✕</button></span></div><div class="wbody">Loading...</div></div>`).join('');
    H.$$('.wpanel', ws).forEach(el => fill(el, layout[+el.dataset.i]));
  };
  async function fill(el, p) {
    const b = H.$('.wbody', el);
    try {
      if (p.w === 'chart') { const pr = (await H.api(`/code/prices?symbols=${encodeURIComponent(p.sym || 'SPY')}&start=${new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10)}`))[p.sym || 'SPY']; b.innerHTML = `<canvas class="chart" style="height:220px"></canvas><a href="#/chart?symbol=${encodeURIComponent(p.sym || 'SPY')}">Open full chart</a>`; H.drawChart(H.$('canvas', b), pr.close.slice(-250)); }
      if (p.w === 'watch') { const syms = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'GLD']; const rows = await Promise.all(syms.map(s => H.api(`/code/prices?symbols=${encodeURIComponent(s)}&start=${new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10)}`).then(x => x[s]).catch(() => null))); b.innerHTML = `<table>${syms.map((s, i) => { const c = rows[i]?.close || []; const ch = c.length > 1 ? (c.at(-1) / c.at(-2) - 1) * 100 : null; return `<tr><td><a href="#/chart?symbol=${encodeURIComponent(s)}">${H.esc(s)}</a></td><td>${c.length ? c.at(-1).toFixed(2) : '-'}</td><td class="${H.cls(ch)}">${pc(ch, 2)}</td></tr>`; }).join('')}</table>`; }
      if (p.w === 'ticket') { b.innerHTML = `<form class="wt"><div class="row"><select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select><input name="notional" type="number" min="1" placeholder="$ amount"><select name="account"><option value="smart">Smart route</option>${H.accountOptions(accts, 'paper')}</select></div><button>Review order</button><div class="err"></div></form>`;
        H.act(H.$('button', b), async () => { const f = H.form(H.$('form', b)); if (!confirm(`${f.side} $${f.notional} of ${p.sym || 'SPY'} on ${f.account}?`)) return; const r = await H.api('/orders', { body: { ...f, symbol: p.sym || 'SPY' } }); return `${r.status}${r.routedTo ? ' via ' + r.routedTo : ''}${r.notes ? ' · ' + r.notes.join(' ') : ''}`; }); }
      if (p.w === 'positions') { const a = await H.api('/account?account=paper'); b.innerHTML = `<table>${(a.positions || []).map(x => `<tr><td>${H.esc(x.symbol)}</td><td>${(+x.qty).toFixed(4)}</td><td>${H.money(x.value)}</td></tr>`).join('') || '<tr><td class="mu">No positions</td></tr>'}</table>`; }
      if (p.w === 'news') { const n = await H.api('/news/sentiment?symbols=SPY,AAPL,NVDA'); b.innerHTML = `<ul class="news">${n.items.slice(0, 6).map(i => `<li><a href="${H.esc(i.url)}" target="_blank" rel="noopener">${H.esc(i.headline)}</a></li>`).join('') || '<li class="mu">No headlines</li>'}</ul>`; }
      if (p.w === 'risk') { const r = await H.api('/risk'); b.innerHTML = `<p>${r.settings.kill ? '<span class="pill warn">Kill switch ON</span>' : '<span class="pill ok">Trading on</span>'} ${r.ordersToday} buys today</p><a href="#/risk">Risk controls</a>`; }
    } catch (e) { b.innerHTML = `<p class="mu">${H.esc(e.message)}</p>`; }
  }
  let from = null;
  ws.addEventListener('dragstart', e => { from = +e.target.closest('.wpanel')?.dataset.i; e.dataTransfer.effectAllowed = 'move'; });
  ws.addEventListener('dragover', e => { if (e.target.closest('.wpanel')) e.preventDefault(); });
  ws.addEventListener('drop', e => { e.preventDefault(); const to = +e.target.closest('.wpanel')?.dataset.i; if (from == null || Number.isNaN(to) || from === to) return; const [x] = layout.splice(from, 1); layout.splice(to, 0, x); from = null; save(); draw(); });
  ws.addEventListener('click', e => {
    const el = e.target.closest('.wpanel'); if (!el) return; const i = +el.dataset.i;
    if (e.target.closest('[data-del]')) { layout.splice(i, 1); save(); draw(); }
    if (e.target.closest('[data-size]')) { layout[i].size = layout[i].size === 2 ? 1 : 2; save(); draw(); }
  });
  ws.addEventListener('change', e => { if (!e.target.classList.contains('wsym')) return; const i = +e.target.closest('.wpanel').dataset.i; layout[i].sym = e.target.value.trim().toUpperCase() || 'SPY'; save(); draw(); });
  H.$('#addBtn', view).onclick = () => { layout.push({ w: H.$('#addW', view).value, size: 1, sym: 'SPY' }); save(); draw(); };
  draw();
}

// ---------- all accounts: paper + several Alpaca accounts ----------
async function allAccounts(view) {
  const d = await H.api('/alpaca/accounts/summary');
  const row = a => `<tr data-id="${H.esc(a.id)}"><td><b>${H.esc(a.label)}</b><div class="mu small-print">${H.esc(a.id)} · ${a.role === 'paper' ? 'simulated' : a.role === 'main' ? 'main account' : 'sub account'}</div></td>
    <td>${a.id === 'paper' ? '<span class="pill">paper</span>' : a.live ? '<span class="pill warn">live</span>' : '<span class="pill">paper (Alpaca)</span>'}</td>
    ${a.error ? `<td colspan="5" class="err">${H.esc(a.error)}</td>` : `<td>${H.money(a.equity)}</td><td>${H.money(a.cash)}</td><td class="${H.cls(a.dayPl)}">${a.dayPl == null ? '-' : H.money(a.dayPl) + ` <span class="small-print">${pc(a.dayPlPct, 2)}</span>`}</td><td class="${H.cls(a.unrealized)}">${H.money(a.unrealized)}</td><td>${a.positions}</td>`}
    <td class="nowrap"><button class="small ghost" data-open="${H.esc(a.id)}">Open</button>${/^alpaca:/.test(a.id) ? ` <button class="small ghost" data-rm="${H.esc(a.id)}">Remove</button>` : ''}</td></tr>`;
  view.innerHTML = `<div class="pagehead"><h1>All accounts</h1><p class="mu">Your paper account and every Alpaca account (a main account and its sub accounts, each with its own API keys) in one place.</p></div>
  <div class="card"><h2>Live accounts together</h2><div class="stats">${stat('Live accounts', d.live.count)}${stat('Total value', H.money(d.live.equity))}${stat('Cash', H.money(d.live.cash))}${stat('Today', H.money(d.live.dayPl), H.cls(d.live.dayPl))}${stat('Open profit / loss', H.money(d.live.unrealized), H.cls(d.live.unrealized))}${stat('Positions', d.live.positions)}</div>
    ${d.test.count ? `<p class="mu small-print">Plus ${d.test.count} Alpaca paper account(s) worth ${H.money(d.test.equity)}, not counted above.</p>` : ''}</div>
  <div class="card"><h2>Each account</h2><div class="tablewrap"><table><tr><th>Account</th><th>Type</th><th>Value</th><th>Cash</th><th>Today</th><th>Open P/L</th><th>Positions</th><th></th></tr>${d.accounts.map(row).join('')}</table></div><div class="err" id="accErr"></div></div>
  <form class="card" id="addAcc"><h2>Add an Alpaca account</h2><p class="mu">Create API keys for the account in Alpaca (each sub account has its own keys), then add them here. Keys are encrypted and never shown again.</p>
    <div class="row"><label>Name<input name="label" placeholder="e.g. Sub account 2"></label><label>Type<select name="role"><option value="sub">Sub account</option><option value="main">Main account</option></select></label></div>
    <div class="row"><label>API key id<input name="keyId" autocomplete="off" data-no-tr></label><label>Secret key<input name="secret" type="password" autocomplete="off"></label></div>
    <label class="chk"><input type="checkbox" name="live"> Live account (real money). Leave unticked for an Alpaca paper account.</label>
    <button>Add account</button><div class="err"></div></form>`;
  const f = H.$('#addAcc', view);
  H.act(H.$('button', f), async () => { const r = await H.api('/alpaca/accounts', { body: H.form(f) }); later(800); return `Added ${r.accountNumber || r.id}`; });
  H.$$('[data-rm]', view).forEach(b => (b.onclick = async () => { if (!confirm('Remove this account from QuantPocket? Nothing changes at Alpaca.')) return; try { await H.api('/alpaca/accounts/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); H.render(); } catch (e) { H.$('#accErr', view).textContent = e.message; } }));
  H.$$('[data-open]', view).forEach(b => (b.onclick = () => { H.state.account = b.dataset.open; try { localStorage.setItem('qp_account', b.dataset.open); } catch {} location.hash = '#/dashboard'; }));
}

// ---------- owner: system health ----------
async function system(view) {
  if (H.me()?.role !== 'admin') { location.hash = '#/dashboard'; return; }
  const d = await H.api('/admin/system');
  view.innerHTML = `<h1>System health</h1>
  <div class="stats">${stat('Load', Math.round(d.load * 100) + '%', d.load >= d.shedAt ? 'neg' : '')}${stat('Shedding', d.shedding ? 'yes' : 'no')}${stat('Requests in flight', `${d.inflight} / ${d.maxInflight}`)}${stat('Event loop delay (p99)', d.eventLoopP99Ms + ' ms')}${stat('Memory', `${d.heapMb} / ${d.heapLimitMb} MB`)}${stat('Requests refused under load', d.shed)}</div>
  <div class="card"><h2>Capacity plan</h2><p>Recommended replicas: <b>${d.capacity.replicas}</b> (base ${d.capacity.base}, max ${d.capacity.max}) · ${d.capacity.reasons.map(H.esc).join(', ')}</p><p class="mu small-print">On Kubernetes the predictive scaler sets this as the autoscaler floor every 5 minutes (deploy/k8s). Add macro event days in ECONOMIC_EVENT_DATES.</p></div>
  <div class="card"><h2>Brokerage circuit breakers</h2><div class="tablewrap"><table><tr><th>Brokerage</th><th>State</th><th>Recent failures</th><th>Times tripped</th></tr>${d.breakers.map(b => `<tr><td>${H.esc(b.name)}</td><td>${b.state === 'open' ? '<span class="pill warn">open</span>' : H.esc(b.state)}</td><td>${b.recentFailures}</td><td>${b.trips}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">No broker calls yet</td></tr>'}</table></div></div>
  <div class="card"><h2>Order queue</h2><div class="stats">${stat('Pending', d.queue.pending)}${stat('Sent', d.queue.sent)}${stat('Expired', d.queue.expired)}${stat('Failed', d.queue.failed)}${stat('Oldest pending', d.queue.oldestPendingSec == null ? '-' : d.queue.oldestPendingSec + ' s')}</div></div>
  <p class="mu small-print">Uptime ${Math.round(d.uptimeSec / 60)} minutes${d.replicaId ? ' · replica ' + H.esc(d.replicaId) : ''}. Prometheus metrics at /metrics. Run a chaos drill from GitHub Actions ("Chaos drill").</p>`;
  const t = setInterval(() => location.hash === '#/admin-system' && H.render(), 15000); H.onLeave(() => clearInterval(t));
}
