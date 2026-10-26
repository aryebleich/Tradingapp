// Owner pages: Business mode (software only or registered adviser, and ways to earn), Admins
// (emails and phones that sign in as admin), and Keys (every environment value, .env import and
// export, and sync with Render). Admin pages stay in English.
let H;
export function registerOwner(routes, helpers) {
  H = helpers;
  const guard = fn => view => (H.me()?.role === 'admin' ? fn(view) : (location.hash = '#/dashboard'));
  Object.assign(routes, { 'admin-business': guard(business), 'admin-alpaca': guard(alpacaPlans), 'admin-yiddish': guard(yiddish), 'admin-admins': guard(admins), 'admin-keys': guard(keys) });
}

async function business(view) {
  const [mode, sum, money, ria] = await Promise.all([H.api('/admin/site/mode'), H.api('/admin/summary'), H.api('/admin/site/money'), H.api('/admin/site/ria')]);
  const f = sum.funnel, m = money.settings, st = money.stats, doneSteps = ria.steps.filter(x => x.done).length;
  const ms = [...m.milestones, { at: '', bonus: '' }, { at: '', bonus: '' }].slice(0, Math.max(3, m.milestones.length));
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-business')}
  <div class="card"><h2>Business mode</h2>
    <div class="modes">
      <label class="mode ${mode.adviser ? '' : 'on'}"><input type="radio" name="mode" value="software" ${mode.adviser ? '' : 'checked'}><b>Software only</b> <span class="pill">${mode.adviser ? '' : 'Current'}</span>
        <span class="mu">No investment adviser license needed. Users choose and run their own strategies on their own brokerage accounts. You earn from plans, deposit fees, referrals and partner commission, not from their profits.</span></label>
      <label class="mode ${mode.adviser ? 'on' : ''}"><input type="radio" name="mode" value="adviser" ${mode.adviser ? 'checked' : ''}><b>Registered investment adviser</b> <span class="pill">${mode.adviser ? 'Current' : ''}</span>
        <span class="mu">Turn on after your SEC or state registration is approved. Adds the performance fee (a share of new profits above the high-water mark) to every plan, monthly fee assessment and the fee pages.</span></label>
    </div>
    <div id="advBox" ${mode.adviser ? '' : 'hidden'}>
      <label>CRD number (from your Form ADV)<input name="crd" placeholder="e.g. 123456" value="${H.esc(ria.crd || '')}"></label>
      <label class="check"><input type="checkbox" name="registered"> The business is registered as an investment adviser, and performance fees go only to qualified clients (SEC Rule 205-3).</label>
    </div>
    <button id="saveMode">Save mode</button><div class="err"></div>
    <p class="mu small-print">Software only is the safe default: QuantPocket is a tool, like charting or backtesting software. Keep the wording that way too: no "we will manage your money" and no personal recommendations.</p></div>

  <div class="card"><h2>Upgrade to a registered investment adviser</h2><p class="mu">${doneSteps} of ${ria.steps.length} steps done. Tick each one off as you finish it; switch the mode above when the registration is approved.</p>
    <div class="ob-bar"><i style="width:${Math.round(doneSteps / ria.steps.length * 100)}%"></i></div>
    <div class="riasteps">${ria.steps.map((x, i) => `<label class="check riastep ${x.done ? 'done' : ''}"><input type="checkbox" data-ria="${x.id}" ${x.done ? 'checked' : ''}><span><b>${i + 1}.</b> ${H.esc(x.text)} <a href="${x.link}" target="_blank" rel="noopener">Open ↗</a></span></label>`).join('')}</div></div>

  <form class="card" id="money"><h2>Money levers</h2>
    <div class="stats">
      <div class="stat"><span>Deposit fees collected</span><b>${H.money(st.depositFees)}</b></div>
      <div class="stat"><span>Partner commission (expected)</span><b>${H.money(st.commissions)}</b></div>
      <div class="stat"><span>Signups from referrals</span><b>${st.referredSignups}</b></div>
      <div class="stat"><span>Referred and paying</span><b>${st.referredPaying}</b></div></div>
    <h3>Deposit service fee</h3>
    <div class="row"><label>Percent of each deposit<input name="depositFeePercent" type="number" step="0.05" min="0" max="5" value="${m.depositFeePercent}"></label>
      <label>Plus a fixed fee ($)<input name="depositFeeFixed" type="number" step="0.25" min="0" max="25" value="${m.depositFeeFixed}"></label>
      <label>Cap per deposit ($, 0 = none)<input name="depositFeeCap" type="number" step="1" min="0" max="1000" value="${m.depositFeeCap}"></label></div>
    <p class="mu small-print">Shown to the customer before they pay. Example on $1,000: <b id="feeEx"></b>. Card rules and some states limit surcharges on credit cards; the fee is charged for the deposit service.</p>
    <h3>Referrals</h3>
    <div class="row"><label>Credit per paying friend ($)<input name="referralCredit" type="number" step="1" min="0" max="500" value="${m.referralCredit}"></label>
      <label>Extra free-trial days for invited friends<input name="friendTrialBonusDays" type="number" step="1" min="0" max="76" value="${m.friendTrialBonusDays}"></label></div>
    <div class="row">${ms.map((x, i) => `<label>Bonus at friends<input name="mAt${i}" type="number" min="1" value="${x.at}"></label><label>Bonus ($)<input name="mBonus${i}" type="number" min="0" value="${x.bonus}"></label>`).join('')}</div>
    <h3>Partner commission (Alpaca Broker API)</h3>
    <div class="row"><label>Type<select name="commissionType">${[['bps', 'Basis points of the order value'], ['notional', 'Dollars per order'], ['qty', 'Dollars per share']].map(([k, t]) => `<option value="${k}" ${m.commissionType === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Amount<input name="commissionValue" type="number" step="0.01" min="0" value="${m.commissionValue}"></label></div>
    <p class="mu small-print">Added to orders in brokerage accounts opened through QuantPocket (Broker API); Alpaca collects it and pays it to you as the partner. 0 = off. Commission-free trading sells better, so keep it small (for example 5 bps), and check with Alpaca and a lawyer first: a per-trade fee can raise broker-dealer questions. Cash-interest and other revenue sharing is set in your contract with Alpaca.</p>
    <button>Save money levers</button><div class="err"></div></form>

  <div class="card tablewrap"><h2>Top referrers</h2><table><tr><th>User</th><th>Invited</th><th>Paying</th></tr>${money.leaders.map(l => `<tr><td data-no-tr>${H.esc(l.email)}</td><td>${l.invited}</td><td>${l.paying}</td></tr>`).join('') || '<tr><td colspan="3" class="mu">No referrals yet</td></tr>'}</table>
    <p class="mu small-print">Thank your best referrers personally; a free month of Elite costs you little and brings more friends.</p></div>

  <div class="card"><h2>Ways you earn now</h2><div class="stats">
    <div class="stat"><span>Monthly recurring revenue</span><b class="kpi">${H.money(f.mrr)}</b></div>
    <div class="stat"><span>Annual run rate</span><b>${H.money(f.arr)}</b></div>
    <div class="stat"><span>Paying users</span><b>${f.paying}</b></div>
    <div class="stat"><span>Signup → paying</span><b>${f.conversion}%</b></div></div>
    <div class="levers">${[
      ['Plans', `Starter free, Pro $53, Elite $109, Ultimate $320 a month; yearly = 2 months free.`, true],
      ['Free trial', 'Every paid plan starts with a free trial; invited friends get extra days, so they convert more often.', true],
      ['Live trading on every plan', 'Free users trade their own real accounts, so they connect a brokerage early. Automation (bots, webhooks, strategies on real money) is what they upgrade for.', true],
      ['Deposit service fee', `${m.depositFeePercent}%${m.depositFeeFixed ? ' + ' + H.money(m.depositFeeFixed) : ''}${m.depositFeeCap ? `, at most ${H.money(m.depositFeeCap)}` : ''} on card and bank deposits.`, m.depositFeePercent > 0 || m.depositFeeFixed > 0],
      ['Referrals', `${H.money(m.referralCredit)} per paying friend, plus bonuses at ${m.milestones.map(x => x.at).join(', ') || 'no'} friends.`, m.referralCredit > 0],
      ['Partner commission', m.commissionValue > 0 ? `${m.commissionValue} ${({ bps: 'bps', notional: '$ per order', qty: '$ per share' })[m.commissionType]} on Broker API accounts.` : 'Off.', m.commissionValue > 0],
      ['Performance fee', mode.adviser ? 'On: assessed monthly above each account’s high-water mark.' : 'Off in software-only mode. Turn on registered-adviser mode once licensed.', mode.adviser],
    ].map(([t, d, on]) => `<div class="lever"><span class="dot ${on ? 'on' : ''}"></span><div><b>${t}</b><p class="mu">${d}</p></div></div>`).join('')}</div>
    <h3>Grow revenue</h3><ul class="tips">
      <li>Push the yearly plan: it is paid up front and cancels less.</li>
      <li>Use Admin → Overview: fix the funnel step with the biggest drop first (usually "Connected a brokerage").</li>
      <li>Offer Elite and Ultimate to users who hit their limits; the upgrade prompt opens on every limit.</li>
      <li>Open brokerage accounts for customers inside QuantPocket (Broker API): each one can earn partner commission and the revenue share in your Alpaca contract.</li>
    </ul></div>`;
  const box = H.$('#advBox', view);
  H.$$('[name=mode]', view).forEach(r => (r.onchange = () => { box.hidden = r.value !== 'adviser' || !r.checked; }));
  H.act(H.$('#saveMode', view), async () => {
    const adviser = H.$('[name=mode]:checked', view).value === 'adviser';
    await H.api('/admin/site/mode', { method: 'PUT', body: { adviser, registered: H.$('[name=registered]', view).checked, crd: H.$('[name=crd]', view).value } });
    setTimeout(H.render, 600);
    return adviser ? 'Registered-adviser mode is on.' : 'Software-only mode is on.';
  });
  H.$$('[data-ria]', view).forEach(c => (c.onchange = async () => { await H.api('/admin/site/ria', { method: 'PUT', body: { id: c.dataset.ria, done: c.checked } }); H.render(); }));
  const mf = H.$('#money', view);
  const ex = () => { const p = +mf.depositFeePercent.value || 0, fx = +mf.depositFeeFixed.value || 0, cap = +mf.depositFeeCap.value || 0; let fee = 1000 * p / 100 + (p || fx ? fx : 0); if (cap) fee = Math.min(fee, cap); H.$('#feeEx', view).textContent = H.money(fee); };
  mf.oninput = ex; ex();
  H.act(H.$('button', mf), async () => {
    const v = H.form(mf);
    const milestones = ms.map((_, i) => ({ at: +v['mAt' + i], bonus: +v['mBonus' + i] })).filter(x => x.at > 0 && x.bonus > 0);
    await H.api('/admin/site/money', { method: 'PUT', body: { depositFeePercent: +v.depositFeePercent, depositFeeFixed: +v.depositFeeFixed, depositFeeCap: +v.depositFeeCap, referralCredit: +v.referralCredit, friendTrialBonusDays: +v.friendTrialBonusDays, milestones, commissionType: v.commissionType, commissionValue: +v.commissionValue } });
    setTimeout(H.render, 900);
    return 'Saved.';
  });
}

// The owner's own Alpaca account: Elite, trading plan, market data, options level, high-yield cash.
async function alpacaPlans(view) {
  const d = await H.api('/admin/site/alpaca-plans');
  const bar = (v, max) => `<div class="ob-bar"><i style="width:${Math.min(100, Math.round(v / max * 100))}%"></i></div>`;
  const tile = (title, status, body, link, label, on) => `<div class="card aplan"><div class="row" style="justify-content:space-between;align-items:center"><h2>${title}</h2><span class="pill ${on ? 'pos' : ''}">${status}</span></div>${body}<a href="${link}" target="_blank" rel="noopener"><button type="button" class="${on ? 'ghost' : ''}">${label}</button></a></div>`;
  const dash = 'https://app.alpaca.markets';
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-alpaca')}<h2>Your Alpaca account</h2>
  ${!d.connected ? '<div class="card"><p class="mu">Connect your own Alpaca account (Brokerages, or ALPACA_KEY_ID / ALPACA_SECRET in Keys) to see where it stands.</p></div>' : d.error ? `<div class="card err">${H.esc(d.error)}</div>` : `
  <p class="mu">Account <b data-no-tr>${H.esc(d.accountNumber || '')}</b> · ${d.live ? 'live' : 'paper'} · equity ${H.money(d.equity)} · net deposits ${H.money(d.netDeposits)}. Alpaca changes these plans in its own dashboard: each button opens it (Home → your account → Plans &amp; Features).</p>
  <div class="grid">
    ${tile('Alpaca Elite', d.elite.unlocked ? 'Unlocked' : 'Not enabled', `<p class="mu">Deposit $30,000 or more to unlock Alpaca Elite and its perks.</p><p>Net deposit: <b>${H.money(d.netDeposits)}</b> / $30,000</p>${bar(d.netDeposits, 30000)}`, dash, d.elite.unlocked ? 'See Elite perks' : 'Discover Alpaca Elite', d.elite.unlocked)}
    ${tile('Trading plan', 'Commission-free', '<p class="mu">$30k deposit unlocks the new trading plan. $100k unlocks a lower margin rate, a free market data subscription and white-glove support.</p>' + bar(d.netDeposits, 100000), dash, 'Change trading plan', d.premium.unlocked)}
    ${tile('Market data', H.esc(d.marketData), '<p class="mu">Basic is the free IEX feed. Algo Trader Plus adds the full SIP feed (every US exchange) and more history. After upgrading, set ALPACA_STOCK_FEED=sip in Keys.</p>', dash, d.marketData.startsWith('Algo') ? 'Manage subscription' : 'Upgrade to Algo Trader Plus', d.marketData.startsWith('Algo'))}
    ${tile('Options', d.options.approved ? `Level ${d.options.approved}` : 'Disabled', `<p class="mu">Approved level ${d.options.approved}, trading level ${d.options.trading}. Level 1: covered calls and cash-secured puts. Level 2: buying calls and puts. Level 3: spreads.</p>`, dash, 'Upgrade your options level', d.options.approved >= 3)}
    ${tile('High-yield cash', 'Enroll at Alpaca', '<p class="mu">Interest on uninvested cash (about 3.56% APY at last check, rates change), with FDIC insurance through program banks up to $1,000,000. Terms on Alpaca.</p>', dash, 'Enroll in high-yield cash', false)}
  </div>`}`;
}

async function admins(view) {
  const a = await H.api('/admin/site/admins');
  const li = (v, builtIn, kind) => `<li><span data-no-tr dir="ltr">${H.esc(v)}</span> ${builtIn ? `<span class="pill">${builtIn}</span>` : `<button class="small ghost" data-rm-${kind}="${H.esc(v)}">Remove</button>`}</li>`;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-admins')}
  <div class="grid">
    <div class="card"><h2>Admin emails</h2><p class="mu">Signing in with any of these (password, Google or GitHub) opens Admin.</p>
      <ul class="adminlist">${a.builtIn.map(e => li(e, 'Owner', 'email')).join('')}${a.fromEnv.filter(e => !a.builtIn.includes(e)).map(e => li(e, 'ADMIN_EMAIL', 'email')).join('')}${a.added.map(e => li(e, '', 'email')).join('')}</ul>
      <form id="addEmail" class="row"><input name="email" type="email" placeholder="name@example.com" required><button>Add admin</button></form><div class="err"></div></div>
    <div class="card"><h2>Admin phones</h2><p class="mu">Sign in with a text-message code from these numbers at <code data-no-tr>/app#/login-phone</code> (not shown on the sign-in page). Needs Twilio for real texts.</p>
      <ul class="adminlist">${a.phones.builtIn.map(p => li(p, 'Owner', 'phone')).join('')}${a.phones.added.map(p => li(p, '', 'phone')).join('')}</ul>
      <form id="addPhone" class="row"><input name="phone" type="tel" placeholder="845 555 1234" required><button>Add phone</button></form><div class="err"></div></div>
  </div>`;
  H.act(H.$('#addEmail button', view), async () => { await H.api('/admin/site/admins', { body: { email: H.form(H.$('#addEmail', view)).email } }); H.render(); });
  H.act(H.$('#addPhone button', view), async () => { await H.api('/admin/site/admins', { body: { phone: H.form(H.$('#addPhone', view)).phone } }); H.render(); });
  H.$$('[data-rm-email]', view).forEach(b => H.act(b, async () => { await H.api('/admin/site/admins?email=' + encodeURIComponent(b.dataset.rmEmail), { method: 'DELETE' }); H.render(); }));
  H.$$('[data-rm-phone]', view).forEach(b => H.act(b, async () => { await H.api('/admin/site/admins?phone=' + encodeURIComponent(b.dataset.rmPhone), { method: 'DELETE' }); H.render(); }));
}

async function keys(view) {
  const d = await H.api('/admin/site/env');
  const pw = H.me()?.hasPassword !== false;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-keys')}
  <div class="card"><h2>Render</h2>
    ${d.render.enabled ? '<p><span class="pill pos">Connected</span> Saving a key here also saves it on Render, so it stays after restarts.</p>'
      : '<p class="mu">Not connected. Add <code>RENDER_API_KEY</code> below (Render → Account settings → API keys)' + (d.render.onRender ? '' : ' and <code>RENDER_SERVICE_ID</code> (srv-…, from the service URL)') + '. Until then, keys saved here work at once and are kept encrypted in the database, but values set on Render win after a restart.</p>'}
    <div class="row"><button id="pull" class="ghost" ${d.render.enabled ? '' : 'disabled'}>Load from Render</button><button id="push" class="ghost" ${d.render.enabled ? '' : 'disabled'}>Send all to Render</button><button id="deploy" class="ghost" ${d.render.enabled ? '' : 'disabled'}>Restart (deploy) on Render</button></div><div class="err"></div></div>
  <div class="grid">
    <form class="card" id="imp"><h2>Import a .env file</h2><p class="mu">Paste KEY=value lines or choose a file. Masked values (abc•••1234) are skipped.</p>
      <input type="file" name="file" accept=".env,.txt,text/plain"><textarea name="text" rows="6" placeholder="STRIPE_SECRET_KEY=sk_live_...&#10;TWILIO_FROM=+18455551234" spellcheck="false" data-no-tr></textarea>
      <label class="check"><input type="checkbox" name="render" ${d.render.enabled ? 'checked' : 'disabled'}> Also save on Render</label>
      <button>Import</button><div class="err"></div></form>
    <form class="card" id="exp"><h2>Export as .env</h2><p class="mu">Downloads every key with its real value. Keep the file private.</p>
      ${pw ? '<label>Your password<input name="password" type="password" autocomplete="current-password" required></label>' : '<label>Type your email to confirm<input name="confirm" type="email" required></label>'}
      <button>Download .env</button><div class="err"></div></form>
  </div>
  ${d.groups.map(g => `<div class="card tablewrap"><h2>${H.esc(g.name)}</h2><table class="keys">${g.rows.map(r => `<tr><td><code data-no-tr>${r.key}</code>${r.restart ? ' <span class="pill">restart</span>' : ''}</td>
    <td>${r.set ? '<span class="dot on"></span>' : '<span class="dot"></span>'}</td><td class="val" data-no-tr>${H.esc(r.value) || '<span class="mu">not set</span>'}</td>
    <td><form class="keyset" data-key="${r.key}"><input name="value" ${r.secret ? 'type="password" autocomplete="new-password"' : ''} placeholder="${r.set ? 'New value' : 'Value'}" data-no-tr><button class="small">Save</button>${r.set ? `<button type="button" class="small ghost" data-clear="${r.key}">Clear</button>` : ''}</form></td></tr>`).join('')}</table></div>`).join('')}
  <form class="card" id="addKey"><h2>Add another key</h2><div class="row"><input name="key" placeholder="NAME_IN_CAPITALS" data-no-tr><input name="value" placeholder="Value" data-no-tr><button>Add</button></div><div class="err"></div></form>`;
  const say = r => `Saved ${r.keys.join(', ')}${r.render ? ' (and on Render)' : ''}.${r.restart?.length ? ` ${r.restart.join(', ')} take effect after a restart.` : ''}`;
  H.$$('.keyset', view).forEach(f => H.act(H.$('button', f), async () => { const r = await H.api('/admin/site/env', { method: 'PUT', body: { key: f.dataset.key, value: f.value.value } }); setTimeout(H.render, 900); return say(r); }));
  H.$$('[data-clear]', view).forEach(b => H.act(b, async () => { if (!confirm(`Clear ${b.dataset.clear}?`)) return ''; await H.api('/admin/site/env', { method: 'PUT', body: { key: b.dataset.clear, value: '' } }); H.render(); }));
  H.act(H.$('#addKey button', view), async () => { const f = H.form(H.$('#addKey', view)); const r = await H.api('/admin/site/env', { method: 'PUT', body: { key: f.key.trim().toUpperCase(), value: f.value } }); setTimeout(H.render, 900); return say(r); });
  const imp = H.$('#imp', view);
  imp.file.onchange = async () => { const file = imp.file.files[0]; if (file) imp.text.value = await file.text(); };
  H.act(H.$('button', imp), async () => { const r = await H.api('/admin/site/env/import', { body: { text: imp.text.value, render: imp.render.checked } }); imp.text.value = ''; setTimeout(H.render, 1500); return say(r); });
  H.act(H.$('#exp button', view), async () => {
    const r = await fetch('/api/admin/site/env/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify(H.form(H.$('#exp', view))) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Export failed');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: 'quantpocket.env' });
    document.body.append(a); a.click(); a.remove(); H.$('#exp', view).reset();
    return 'Downloaded quantpocket.env';
  });
  if (d.render.enabled) {
    H.act(H.$('#pull', view), async () => { const r = await H.api('/admin/site/env/render/pull', { body: {} }); setTimeout(H.render, 1500); return `Loaded ${r.keys.length} values from Render.`; });
    H.act(H.$('#push', view), async () => { const r = await H.api('/admin/site/env/render/push', { body: { deploy: confirm('Restart the service on Render after sending, so every value takes effect?') } }); return `Sent ${r.keys.length} values to Render${r.deploy ? '; restarting now' : ''}.`; });
    H.act(H.$('#deploy', view), async () => { if (!confirm('Restart the service on Render now?')) return ''; await H.api('/admin/site/env/render/deploy', { body: {} }); return 'Restarting on Render. The site is back in a minute or two.'; });
  }
}

// Yiddish Labs runs on its own GitHub workflow; this page starts it, switches it on for every push
// and shows how the last runs went.
async function yiddish(view) {
  const d = await H.api('/admin/site/yiddish');
  const st = d.status, when = t => (t ? new Date(t).toLocaleString() : '-');
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-yiddish')}
  <div class="card"><h2>Yiddish Labs translation</h2>
    <p class="mu">Runs on GitHub, apart from everything else. Only app text added since the last run is sent; the homepage, Admin and the README are not. Whole sentences go several at a time.</p>
    ${st ? `<div class="stats"><div class="stat"><span>Last run</span><b>${when(st.at)}</b></div><div class="stat"><span>Translated</span><b>${st.translated ?? 0}</b></div>
      <div class="stat"><span>Kept hand-written</span><b>${st.kept ?? 0}</b></div><div class="stat"><span>Credits left</span><b>${st.credits == null ? '-' : Number(st.credits).toLocaleString()}</b></div></div>
      ${st.stopped ? `<p class="banner err">Stopped: ${H.esc(st.stopped)}</p>` : ''}` : '<p class="mu">No run yet.</p>'}
    <p class="mu small-print">Next run translates text added since commit <code data-no-tr>${H.esc((d.lastRef || '').slice(0, 10) || 'the previous commit')}</code>.</p>
    ${d.configured ? `
      <div class="row"><label>Since commit (optional)<input id="ylSince" placeholder="e.g. 67a78dc" data-no-tr></label><label>At most (optional)<input id="ylLimit" type="number" min="1" placeholder="all"></label><button id="ylRun">Translate new text now</button></div><div class="err"></div>
      <label class="check"><input type="checkbox" id="ylAuto" ${d.auto ? 'checked' : ''}> Run automatically after every push to main</label>
      ${d.error ? `<p class="err">${H.esc(d.error)}</p>` : ''}`
    : `<p class="banner">To run it from here, add <code>GITHUB_TOKEN</code> in <a href="#/admin-keys">Keys</a>: a fine-grained token for <b data-no-tr>${H.esc(d.repo)}</b> with Actions and Variables (read and write). Until then, start it on GitHub: Actions → Yiddish Labs translation → Run workflow.</p>`}
    <p class="mu small-print">One-time setup on GitHub: Settings → Secrets and variables → Actions → add <code>YL_EMAIL</code> and <code>YL_PASSWORD</code> (your Yiddish Labs sign-in).</p></div>
  ${d.runs.length ? `<div class="card tablewrap"><h2>Recent runs</h2><table><tr><th>Started</th><th>How</th><th>Result</th><th></th></tr>${d.runs.map(r => `<tr><td>${when(r.at)}</td><td>${r.event === 'push' ? 'after a push' : 'started by hand'}</td>
    <td>${r.status !== 'completed' ? '<span class="pill">running</span>' : r.conclusion === 'success' ? '<span class="pill pos">done</span>' : r.conclusion === 'skipped' ? '<span class="pill">skipped</span>' : `<span class="pill warn">${H.esc(r.conclusion || '')}</span>`}</td>
    <td><a href="${r.url}" target="_blank" rel="noopener">Open log ↗</a></td></tr>`).join('')}</table></div>` : ''}`;
  if (H.$('#ylRun', view)) H.act(H.$('#ylRun', view), async () => { await H.api('/admin/site/yiddish/run', { body: { since: H.$('#ylSince', view).value, limit: H.$('#ylLimit', view).value } }); setTimeout(H.render, 4000); return 'Started on GitHub. It shows up below in a few seconds.'; });
  if (H.$('#ylAuto', view)) H.$('#ylAuto', view).onchange = async e => { try { await H.api('/admin/site/yiddish/auto', { method: 'PUT', body: { on: e.target.checked } }); } catch (x) { e.target.checked = !e.target.checked; alert(x.message); } };
}
