// Add-ons: the switches in Settings (and the phone line language), the weekly money brief, and the
// tax-saving autopilot. Live property values, cap tables and K-1s are in altlive.js.
let H;
const stat = (k, v, c = '') => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`;
export function registerAddons(routes, helpers) {
  H = helpers;
  const settings = routes.settings;
  routes.settings = async (view, q) => { await settings(view, q); await settingsCard(view).catch(() => {}); };
  Object.assign(routes, { brief, taxpilot });
}
const off = (e, what) => (e?.addonOff ? `<div class="card"><h2>${what}</h2><p>This add-on is switched off. Turn it on in <a href="#/settings">Settings → Add-ons</a>.</p></div>` : null);

async function settingsCard(view) {
  const d = await H.api('/addons');
  const box = document.createElement('form'); box.className = 'card'; box.id = 'addonsCard';
  box.innerHTML = `<h2>Add-ons</h2><p class="mu" style="margin-top:0">Switch off what you do not use; it disappears from the menus and stops running in the background.</p>
    ${Object.entries(d.labels).map(([k, t]) => `<label class="check"><input type="checkbox" name="${k}" ${d.addons[k] ? 'checked' : ''}> ${H.esc(t)}</label>`).join('')}
    <label>Phone line language<select name="phoneLang"><option value="en" ${d.phoneLang === 'en' ? 'selected' : ''}>English</option><option value="yi" ${d.phoneLang === 'yi' ? 'selected' : ''}>Yiddish (אידיש)</option></select></label>
    <p class="mu small-print">On a call you can also press 8 to switch, when the line offers Yiddish.</p>
    <button>Save</button><div class="err"></div>`;
  (H.$('.grid', view) || view).append(box);
  H.act(H.$('button', box), async () => {
    const v = H.form(box);
    await H.api('/addons', { method: 'PUT', body: { addons: Object.fromEntries(Object.keys(d.labels).map(k => [k, v[k]])), phoneLang: v.phoneLang } });
    setTimeout(() => location.reload(), 700); return 'Saved';
  });
}

// ---------- the weekly brief ----------
async function brief(view, q) {
  let d;
  try { d = await H.api('/brief'); } catch (e) { const o = off(e, 'Weekly money brief'); if (o) { view.innerHTML = o; return; } throw e; }
  const b = q.get('week') ? await H.api('/brief/week/' + encodeURIComponent(q.get('week'))) : d.latest;
  view.innerHTML = `<div class="pagehead"><div><h1>Weekly money brief</h1><p class="mu" style="margin:4px 0 0">Once a week, everything you have linked, read and written up in plain English: what changed and why. Facts from your own accounts, never advice.</p></div></div>
  ${b ? `<article class="card briefcard"><span class="mu">Week of ${new Date(b.week + 'T12:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}${b.byAi ? ' · written by AI from your numbers' : ''}</span>
      <h2 style="margin:6px 0 12px">${H.esc(b.headline)}</h2>${b.paragraphs.map(p => `<p>${H.esc(p)}</p>`).join('')}
      ${b.watch?.length ? `<h3>To keep an eye on</h3><ul>${b.watch.map(w => `<li>${H.esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="stats" style="margin-top:14px">${stat('Net worth', H.money(b.data.netWorth))}${b.data.netWorthChange != null ? stat('Since the last brief', H.money(b.data.netWorthChange), H.cls(b.data.netWorthChange)) : ''}${stat('Money in (week)', H.money(b.data.moneyIn))}${stat('Money out (week)', H.money(b.data.moneyOut))}</div>
      ${b.data.waiting.rules || b.data.waiting.taxHarvest ? `<p class="approvebox">Waiting for you: ${b.data.waiting.rules ? `<a href="#/rules">${b.data.waiting.rules} rule${b.data.waiting.rules > 1 ? 's' : ''}</a>` : ''}${b.data.waiting.rules && b.data.waiting.taxHarvest ? ' and ' : ''}${b.data.waiting.taxHarvest ? `<a href="#/taxpilot">${b.data.waiting.taxHarvest} tax-saving trades</a>` : ''}</p>` : ''}</article>`
    : '<div class="card"><p>No brief yet. Write this week\'s now; it reads your linked accounts, banks, cards, crypto, private investments and property.</p></div>'}
  <div class="card"><div class="row" style="gap:8px;flex-wrap:wrap"><button id="write">${d.latest?.week === d.thisWeek ? 'Write this week\'s again' : 'Write this week\'s brief'}</button>
    <label class="check" style="margin:0"><input type="checkbox" id="mail" ${d.email ? 'checked' : ''}> Email it to me every Monday morning</label></div><div class="err"></div>
    ${d.past.length ? `<h3>Earlier weeks</h3><ul class="plain">${d.past.map(p => `<li><a href="#/brief?week=${p.week}">${p.week}</a> · ${H.esc(p.headline)}</li>`).join('')}</ul>` : ''}</div>`;
  H.act(H.$('#write', view), async () => { await H.api('/brief/write', { body: { force: d.latest?.week === d.thisWeek } }); location.hash = '#/brief'; H.render(); return ''; });
  H.$('#mail', view).onchange = e => H.api('/brief/email', { method: 'PUT', body: { on: e.target.checked } });
}

// ---------- tax-saving autopilot ----------
async function taxpilot(view, q) {
  let d;
  try { d = await H.api('/taxpilot'); } catch (e) { const o = off(e, 'Tax-saving autopilot'); if (o) { view.innerHTML = o; return; } throw e; }
  const accts = await H.accounts(), o = d.options, p = d.pending;
  const name = id => H.acctLabel(accts.find(a => a.id === id) || { id, name: id });
  view.innerHTML = `<div class="pagehead"><div><h1>Tax-saving autopilot</h1><p class="mu" style="margin:4px 0 0">All year, across all your accounts: sell holdings that are down to book the loss for taxes (tax-loss harvesting), keep the money invested in a similar fund, and never trip the wash-sale rule. Nothing trades until you approve.</p></div></div>
  <div class="card"><div class="stats">${stat('Losses harvested so far', H.money(d.harvested))}${stat('Could harvest now', H.money(d.candidates.filter(c => !c.wash).reduce((s, c) => s + c.loss, 0)))}${stat('Tax it could save (about)', H.money(d.candidates.filter(c => !c.wash).reduce((s, c) => s + c.taxSaved, 0)))}</div>
    ${p ? `<div class="approvebox"><b>${p.trades.length} trades ready</b> <span class="mu">(prepared ${H.date(p.at)}; about ${H.money(p.taxSaved)} less tax)</span>
      <table class="slim">${p.trades.map(t => `<tr><td>${H.esc(name(t.account))}</td><td>Sell <b data-no-tr>${H.esc(t.symbol)}</b> (${t.qty} shares, loss ${H.money(t.loss)})</td><td>${t.swap ? `then buy <b data-no-tr>${H.esc(t.swap)}</b>` : '<span class="mu">stays in cash</span>'}</td></tr>`).join('')}</table>
      <div class="row" style="gap:8px;margin-top:8px"><button id="approve">Approve all</button><button class="ghost" id="skip">Skip</button></div><div class="err"></div></div>` : ''}
    <h3>Holdings at a loss</h3><div class="tablewrap"><table class="slim"><tr><th>Account</th><th>Holding</th><th>Loss</th><th>Tax saved (about)</th><th>Similar fund</th><th></th></tr>
      ${d.candidates.map(c => `<tr><td>${H.esc(name(c.account))}</td><td data-no-tr><b>${H.esc(c.symbol)}</b></td><td class="neg">${H.money(-c.loss)} (${c.lossPct}%)</td><td>${H.money(c.taxSaved)} <span class="mu">${c.longTerm ? 'long-term' : 'short-term'}</span></td><td data-no-tr>${H.esc(c.swap || '-')}</td><td>${c.wash ? `<span class="mu">${H.esc(c.wash)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">Nothing is down enough to be worth harvesting right now.</td></tr>'}</table></div>
    ${!p && d.candidates.some(c => !c.wash) ? '<button id="prep">Prepare these trades for approval</button><div class="err"></div>' : ''}</div>
  ${Object.keys(d.blocked).length ? `<div class="card"><h2>Wash-sale guard</h2><p class="mu">Buying these back in any real account is stopped until the date shown, so the tax loss counts.</p><table class="slim">${Object.entries(d.blocked).map(([s, u]) => `<tr><td data-no-tr><b>${H.esc(s)}</b></td><td>until ${new Date(u).toLocaleDateString()}</td><td><button class="small ghost" data-unblock="${H.esc(s)}">Remove guard</button></td></tr>`).join('')}</table></div>` : ''}
  <form class="card" id="tpo"><h2>Settings</h2>
    <div class="row"><label>Harvest losses of at least ($)<input name="minLoss" type="number" min="1" value="${o.minLoss}"></label><label>and at least (%)<input name="minLossPct" type="number" min="0" max="90" step="0.5" value="${o.minLossPct}"></label></div>
    <label class="check"><input type="checkbox" name="swap" ${o.swap ? 'checked' : ''}> Buy a similar fund (different index) with the money, so it stays invested</label>
    <label class="check"><input type="checkbox" name="weekly" ${o.weekly ? 'checked' : ''}> Check every Monday and send me the trades to approve</label>
    <button>Save</button><div class="err"></div></form>
  <form class="card" id="lotf"><h2>Best order to sell lots</h2><p class="mu" style="margin-top:0">When you sell part of a holding bought at different times and prices, which shares you sell changes the tax. This compares selling the lowest-tax lots first with first-in-first-out and highest-cost-first.</p>
    <div class="row"><label>Account<select name="account">${H.accountOptions ? H.accountOptions(accts) : accts.map(a => `<option value="${H.esc(a.id)}">${H.esc(H.acctLabel(a))}</option>`).join('')}</select></label><label>Symbol<input name="symbol" required dir="ltr" placeholder="AAPL"></label><label>Shares to sell<input name="qty" type="number" min="0" step="any" placeholder="all"></label><button style="align-self:flex-end">Compare</button></div><div class="err"></div><div id="lotOut"></div>
    <p class="mu small-print">Tell your broker which lots to sell (specific identification) before you sell; many brokers, Alpaca included, use first-in-first-out unless you change the account's cost-basis method. Estimates only; the 1099-B from your broker is the official record. Not tax advice.</p></form>`;
  if (H.$('#prep', view)) H.act(H.$('#prep', view), async () => { await H.api('/taxpilot/prepare', { body: {} }); H.render(); return ''; });
  if (H.$('#approve', view)) H.act(H.$('#approve', view), async () => {
    if (!confirm('Sell these holdings now to book the losses?')) return '';
    const r = await H.api('/taxpilot/approve', { body: {} }); setTimeout(H.render, 1500);
    return `${r.results.filter(x => x.ok).length} of ${r.results.length} orders placed${r.results.some(x => !x.ok) ? ': ' + r.results.filter(x => !x.ok).map(x => `${x.symbol} ${x.error}`).join('; ') : ''}`;
  });
  if (H.$('#skip', view)) H.act(H.$('#skip', view), async () => { await H.api('/taxpilot/skip', { body: {} }); H.render(); return ''; });
  H.$$('[data-unblock]', view).forEach(b => H.act(b, async () => { if (!confirm(`Remove the guard? Buying ${b.dataset.unblock} back now would be a wash sale.`)) return ''; await H.api('/taxpilot/blocked/' + encodeURIComponent(b.dataset.unblock), { method: 'DELETE' }); H.render(); return ''; }));
  const f = H.$('#tpo', view);
  H.act(H.$('button', f), async () => { const v = H.form(f); await H.api('/taxpilot', { method: 'PUT', body: { minLoss: +v.minLoss, minLossPct: +v.minLossPct, swap: v.swap, weekly: v.weekly } }); return 'Saved'; });
  const lf = H.$('#lotf', view);
  H.act(H.$('button', lf), async () => {
    const v = H.form(lf), r = await H.api(`/taxpilot/lots?account=${encodeURIComponent(v.account)}&symbol=${encodeURIComponent(v.symbol)}${v.qty ? '&qty=' + encodeURIComponent(v.qty) : ''}`);
    const M = { tax: 'Lowest tax first', fifo: 'First in, first out', hifo: 'Highest cost first' };
    H.$('#lotOut', view).innerHTML = `<p>Selling ${r.qty} of ${r.have} shares at about ${H.money(r.price)}.${r.saves > 0 ? ` <b>Lowest-tax order saves about ${H.money(r.saves)}</b> compared with first-in-first-out.` : ''}</p>
      <table class="slim"><tr><th>Order</th><th>Gain or loss</th><th>Tax (about)</th></tr>${Object.entries(r.methods).map(([k, m]) => `<tr><td>${M[k]}</td><td class="${H.cls(m.gain)}">${H.money(m.gain)}</td><td>${H.money(m.tax)}</td></tr>`).join('')}</table>
      <h3>Lots to sell, lowest tax first</h3><table class="slim">${r.methods.tax.lots.map(l => `<tr><td>${new Date(l.at).toLocaleDateString()}</td><td>${l.qty} shares at ${H.money(l.price)}</td><td class="mu">${l.longTerm ? 'long-term' : 'short-term'}</td></tr>`).join('')}</table>`;
    return '';
  });
}
