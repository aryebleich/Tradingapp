// Admin → Sponsored news: paid announcements from listed companies, shown as pop-ups to free-plan
// users (paid plans never see them). Each campaign needs who paid and how much: the pop-up shows it.
let H;
export function registerSponsored(routes, helpers) {
  H = helpers;
  routes['admin-sponsored'] = view => (H.me()?.role === 'admin' ? page(view) : (location.hash = '#/dashboard'));
}

async function page(view) {
  const d = await H.api('/sponsored/admin'), s = d.settings;
  const today = new Date().toISOString().slice(0, 10);
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-sponsored')}
  <div class="card"><h2>Sponsored news</h2><p class="mu" style="margin-top:0">Companies listed on a US stock exchange pay to show a short announcement to users on the free plan, with a button to buy the stock. Paid plans never see them; upgrading is the only way to turn them off. Over-the-counter and unlisted companies are refused.</p>
    <div class="stats"><div class="stat"><span>Running</span><b>${d.ads.filter(a => a.active && a.starts <= today && (!a.ends || a.ends >= today)).length}</b></div><div class="stat"><span>Shown</span><b>${d.ads.reduce((t, a) => t + a.views, 0).toLocaleString()}</b></div><div class="stat"><span>Clicks</span><b>${d.ads.reduce((t, a) => t + a.clicks, 0).toLocaleString()}</b></div><div class="stat"><span>Paid in total</span><b>${H.money(d.ads.reduce((t, a) => t + a.paid, 0))}</b></div></div>
    <form id="spSet" class="row" style="align-items:flex-end"><label class="chk"><input type="checkbox" name="on" ${s.on ? 'checked' : ''}> Show sponsored news</label><label>Most per user a day<input name="perDay" type="number" min="1" max="20" value="${s.perDay}"></label><label>Minutes between<input name="gapMinutes" type="number" min="1" max="240" value="${s.gapMinutes}"></label><button>Save</button><span class="ok"></span></form></div>
  <form class="card" id="spNew"><h2>New campaign</h2><input type="hidden" name="id">
    <div class="row"><label>Symbol<input name="symbol" required maxlength="10" placeholder="e.g. ACME" data-no-tr></label><label style="flex:3">Headline<input name="headline" required maxlength="120" placeholder="Acme reports record third quarter"></label></div>
    <label>Text (optional)<textarea name="body" maxlength="400" rows="2"></textarea></label>
    <div class="row"><label style="flex:2">Link to read more (https, optional)<input name="url" type="url" placeholder="https://"></label><label>Starts<input name="starts" type="date" value="${today}"></label><label>Ends<input name="ends" type="date"></label><label>Weight (1–10)<input name="weight" type="number" min="1" max="10" value="1"></label></div>
    <div class="row"><label style="flex:2">Paid by<input name="sponsor" required placeholder="Acme Corp. or its agency"></label><label>Amount paid ($)<input name="paid" type="number" min="1" step="0.01" required></label></div>
    <label>Disclosure (optional, written for you if empty)<input name="disclosure" maxlength="300" placeholder="Paid promotion: Brightolio received $… from … for this message about …"></label>
    <button>Save campaign</button><div class="err"></div><p class="ok"></p>
    <p class="mu small-print">The law (Securities Act §17(b)) requires anyone paid to publish material about a stock to say they were paid, by whom and how much, so every pop-up shows the disclosure. Keep the message factual; do not promise returns.</p></form>
  <div class="card"><h2>Campaigns</h2><div class="tablewrap"><table><tr><th>Symbol</th><th>Headline</th><th>Dates</th><th class="num">Paid</th><th class="num">Shown</th><th class="num">Clicks</th><th class="num">Click rate</th><th></th></tr>
    ${d.ads.map(a => `<tr class="${a.active ? '' : 'dim'}"><td><b data-no-tr>${H.esc(a.symbol)}</b><br><small class="mu" data-no-tr>${H.esc(a.company || '')} · ${H.esc(a.exchange || '')}</small></td><td data-no-tr>${H.esc(a.headline)}<br><small class="mu">${H.esc(a.disclosureShown)}</small></td><td>${a.starts}${a.ends ? ' to ' + a.ends : ' onward'}</td><td class="num">${H.money(a.paid)}</td><td class="num">${a.views}</td><td class="num">${a.clicks}</td><td class="num">${a.ctr == null ? '-' : a.ctr + '%'}</td>
      <td><button type="button" class="small ghost" data-edit="${a.id}">Edit</button> <button type="button" class="small ghost" data-pause="${a.id}">${a.active ? 'Pause' : 'Resume'}</button> <button type="button" class="small ghost" data-del="${a.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="8" class="mu">No campaigns yet</td></tr>'}</table></div></div>`;
  const set = H.$('#spSet', view);
  H.act(H.$('button', set), async () => { const v = H.form(set); await H.api('/sponsored/admin/settings', { method: 'PUT', body: { on: v.on, perDay: +v.perDay, gapMinutes: +v.gapMinutes } }); return 'Saved'; }, H.$('.ok', set));
  const f = H.$('#spNew', view);
  H.act(H.$('button', f), async () => { const v = H.form(f), r = await H.api('/sponsored/admin', { body: { ...v, id: v.id || undefined, paid: +v.paid, weight: +v.weight } }); setTimeout(H.render, 900); return `Saved: ${r.company} (${r.exchange})`; }, H.$('.ok', f));
  const byId = id => d.ads.find(a => a.id === +id);
  H.$$('[data-edit]', view).forEach(b => (b.onclick = () => { const a = byId(b.dataset.edit); for (const k of ['id', 'symbol', 'headline', 'body', 'url', 'starts', 'ends', 'weight', 'sponsor', 'paid', 'disclosure']) if (f[k]) f[k].value = a[k] ?? ''; f.scrollIntoView({ behavior: 'smooth' }); }));
  H.$$('[data-pause]', view).forEach(b => (b.onclick = async () => { const a = byId(b.dataset.pause); await H.api('/sponsored/admin', { body: { ...a, active: !a.active } }); H.render(); }));
  H.$$('[data-del]', view).forEach(b => (b.onclick = async () => { if (!confirm('Delete this campaign?')) return; await H.api('/sponsored/admin/' + b.dataset.del, { method: 'DELETE' }); H.render(); }));
}

// Admin → Money & fees: where the Stripe Treasury setup stands, and the steps to finish it.
export async function treasuryCard(el, helpers) {
  const h = helpers || H, d = await h.api('/admin/site/stripe/treasury').catch(e => ({ step: 'error', message: e.message }));
  const order = ['key', 'connect', 'apply', 'financial-account', 'done'], at = Math.max(0, order.indexOf(d.step));
  const steps = [
    ['Secret key', 'STRIPE_SECRET_KEY is in Keys (it already is if card payments work). Start in test mode (sk_test_…): everything below can be tried there first.'],
    ['Stripe Connect', 'Dashboard → Connect → Get started. Choose a platform where Stripe handles identity checks and you control the experience ("Custom" or the Accounts v2 equivalent). Treasury accounts belong to the businesses you onboard (connected accounts), not to your own platform account.'],
    ['Apply for Treasury', 'Dashboard → Settings → Treasury (or search "Treasury"), then "Request access". Describe the use: business cash accounts for users, with money in, money out and interest if offered. Stripe and its partner bank review the application, your website and your terms; approval can take a few weeks. Ask for Issuing too if you want debit cards.'],
    ['Connected account + financial account', 'For each business: create the connected account with the capabilities "treasury", "us_bank_account_ach_payments" and (for cards) "card_issuing", let it finish Stripe\'s onboarding, then create a financial account (POST /v1/treasury/financial_accounts with supported_currencies usd and the features financial_addresses.aba, inbound_transfers.ach, outbound_transfers.ach, outbound_payments.ach, intra_stripe_flows). It gets its own account and routing number.'],
    ['Webhooks, disclosures, go live', 'Add the webhook events treasury.financial_account.features_status_updated, treasury.received_credit.created, treasury.inbound_transfer.* and treasury.outbound_payment.*. Show Stripe\'s required wording: "Brightolio is not a bank; banking services are provided by [partner bank], Member FDIC" and the account agreements Stripe gives you, and send marketing pages to Stripe for review. Then switch to the live key.'],
  ];
  el.innerHTML = `<div class="card"><h2>Stripe Treasury</h2><p class="mu" style="margin-top:0">Bank-like accounts (account and routing number, ACH in and out, optional debit cards) for the <b>businesses</b> on your platform, held at Stripe's partner banks. ${d.mode ? `Key mode: <b>${h.esc(d.mode)}</b>.` : ''}</p>
    <ol class="steps">${steps.map(([t, x], i) => `<li class="${i < at || d.step === 'done' ? 'done' : i === at ? 'now' : ''}"><b>${t}</b> ${i < at || d.step === 'done' ? '<span class="pill pos">done</span>' : i === at ? '<span class="pill warn">next</span>' : ''}<p class="mu">${x}</p></li>`).join('')}</ol>
    ${d.message ? `<p class="banner">Stripe says: ${h.esc(d.message)}</p>` : ''}
    ${d.treasuryAccounts?.length ? `<p>Connected accounts with Treasury: ${d.treasuryAccounts.map(a => `<span class="pill" data-no-tr>${h.esc(a.id)} · ${h.esc(a.treasury)}</span>`).join(' ')}</p>` : ''}
    ${d.financialAccounts?.length ? `<p>Financial accounts: ${d.financialAccounts.map(f => `<span class="pill" data-no-tr>${h.esc(f.id)} · ${h.esc(f.status)}</span>`).join(' ')}</p>` : ''}
    <p class="mu small-print"><b>Good to know:</b> Treasury is for businesses, not individual consumers. For users' brokerage cash earning interest (a cash sweep) the brokerage handles it: with the Alpaca Broker API ask Alpaca about its cash sweep and interest program. A debit card for consumers needs a bank or card-issuing partner that serves individuals.</p>
    <button type="button" class="ghost small" id="trCheck">Check again</button></div>`;
  h.$('#trCheck', el).onclick = () => treasuryCard(el, h);
}
