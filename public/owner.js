// Owner pages: Business mode (software only or registered adviser, and ways to earn), Admins
// (emails and phones that sign in as admin), and Keys (every environment value, .env import and
// export, and sync with Render). Admin pages stay in English.
let H;
export function registerOwner(routes, helpers) {
  H = helpers;
  const guard = fn => view => (H.me()?.role === 'admin' ? fn(view) : (location.hash = '#/dashboard'));
  Object.assign(routes, { 'admin-business': guard(business), 'admin-admins': guard(admins), 'admin-keys': guard(keys) });
}

async function business(view) {
  const [mode, sum] = await Promise.all([H.api('/admin/site/mode'), H.api('/admin/summary')]);
  const f = sum.funnel, dep = sum.depositFee;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-business')}
  <div class="card"><h2>Business mode</h2>
    <div class="modes">
      <label class="mode ${mode.adviser ? '' : 'on'}"><input type="radio" name="mode" value="software" ${mode.adviser ? '' : 'checked'}><b>Software only</b> <span class="pill">${mode.adviser ? '' : 'Current'}</span>
        <span class="mu">No investment adviser license needed. Users choose and run their own strategies on their own brokerage accounts. You earn from plans, not from their profits: no performance fee and no personal advice.</span></label>
      <label class="mode ${mode.adviser ? 'on' : ''}"><input type="radio" name="mode" value="adviser" ${mode.adviser ? 'checked' : ''}><b>Registered investment adviser</b> <span class="pill">${mode.adviser ? 'Current' : ''}</span>
        <span class="mu">Turn on after your SEC or state registration is approved. Adds the performance fee (a share of new profits above the high-water mark) to every plan, monthly fee assessment and the fee pages.</span></label>
    </div>
    <div id="advBox" ${mode.adviser ? '' : 'hidden'}>
      <label>CRD number (from your Form ADV)<input name="crd" placeholder="e.g. 123456"></label>
      <label class="check"><input type="checkbox" name="registered"> The business is registered as an investment adviser, and performance fees go only to qualified clients (SEC Rule 205-3).</label>
    </div>
    <button id="saveMode">Save mode</button><div class="err"></div>
    <p class="mu small-print">Software only is the safe default: QuantPocket is a tool, like charting or backtesting software. Keep the wording that way too: no "we will manage your money" and no personal recommendations.</p></div>
  <div class="card"><h2>Ways you earn now</h2><div class="stats">
    <div class="stat"><span>Monthly recurring revenue</span><b class="kpi">${H.money(f.mrr)}</b></div>
    <div class="stat"><span>Annual run rate</span><b>${H.money(f.arr)}</b></div>
    <div class="stat"><span>Paying users</span><b>${f.paying}</b></div>
    <div class="stat"><span>Signup → paying</span><b>${f.conversion}%</b></div></div>
    <div class="levers">${[
      ['Plans', `Starter free, Pro $53, Elite $109, Ultimate $320 a month; yearly = 2 months free.`, true],
      ['Free trial', 'Every paid plan starts with a free trial (TRIAL_DAYS). Trials are where most paying users come from.', true],
      ['Live trading on every plan', 'Free users trade their own real accounts, so they connect a brokerage early. Automation (bots, webhooks, strategies on real money) is what they upgrade for.', true],
      ['Deposit service fee', `${dep.percent}%${dep.fixed ? ' + ' + H.money(dep.fixed) : ''} on card and bank deposits (DEPOSIT_FEE_PERCENT / DEPOSIT_FEE_FIXED in Keys). Collected so far ${H.money(dep.collected)}.`, dep.percent > 0 || dep.fixed > 0],
      ['Referrals', 'Each user has an invite link; the inviter gets a credit when a friend starts paying (REFERRAL_CREDIT).', true],
      ['Performance fee', mode.adviser ? 'On: assessed monthly above each account’s high-water mark.' : 'Off in software-only mode. Turn on registered-adviser mode once licensed.', mode.adviser],
    ].map(([t, d, on]) => `<div class="lever"><span class="dot ${on ? 'on' : ''}"></span><div><b>${t}</b><p class="mu">${d}</p></div></div>`).join('')}</div>
    <h3>Grow revenue</h3><ul class="tips">
      <li>Push the yearly plan: it is paid up front and cancels less.</li>
      <li>Use Admin → Overview: fix the funnel step with the biggest drop first (usually "Connected a brokerage").</li>
      <li>Offer Elite and Ultimate to users who hit their limits; the upgrade prompt opens on every limit.</li>
      <li>Revenue share from your broker partner (Alpaca Broker API) is set by contract with Alpaca; ask them about partner revenue on the accounts you open.</li>
    </ul></div>`;
  const box = H.$('#advBox', view);
  H.$$('[name=mode]', view).forEach(r => (r.onchange = () => { box.hidden = r.value !== 'adviser' || !r.checked; }));
  H.act(H.$('#saveMode', view), async () => {
    const adviser = H.$('[name=mode]:checked', view).value === 'adviser';
    await H.api('/admin/site/mode', { method: 'PUT', body: { adviser, registered: H.$('[name=registered]', view).checked, crd: H.$('[name=crd]', view).value } });
    setTimeout(H.render, 600);
    return adviser ? 'Registered-adviser mode is on.' : 'Software-only mode is on.';
  });
}

async function admins(view) {
  const a = await H.api('/admin/site/admins');
  const li = (v, builtIn, kind) => `<li><span data-no-tr dir="ltr">${H.esc(v)}</span> ${builtIn ? `<span class="pill">${builtIn}</span>` : `<button class="small ghost" data-rm-${kind}="${H.esc(v)}">Remove</button>`}</li>`;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-admins')}
  <div class="grid">
    <div class="card"><h2>Admin emails</h2><p class="mu">Signing in with any of these (password, Google or GitHub) opens Admin.</p>
      <ul class="adminlist">${a.builtIn.map(e => li(e, 'Owner', 'email')).join('')}${a.fromEnv.filter(e => !a.builtIn.includes(e)).map(e => li(e, 'ADMIN_EMAIL', 'email')).join('')}${a.added.map(e => li(e, '', 'email')).join('')}</ul>
      <form id="addEmail" class="row"><input name="email" type="email" placeholder="name@example.com" required><button>Add admin</button></form><div class="err"></div></div>
    <div class="card"><h2>Admin phones</h2><p class="mu">Sign in with a text-message code from these numbers (Sign in → "Sign in with a text message code"). Needs Twilio for real texts.</p>
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
