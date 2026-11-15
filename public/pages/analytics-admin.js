// Admin → Analytics: overview, website, sections of the app, phone line, texts, profit and loss,
// and (its own tab) system health.
let H;
export const ANALYTICS_TABS = [['overview', 'Overview'], ['web', 'Website & traffic'], ['sections', 'Section usage'], ['voice', 'Phone line'], ['sms', 'Text messages'], ['pnl', 'P&L'], ['health', 'System health']];
export const analyticsNav = (tab, days = 30) => `<div class="chips antabs">${ANALYTICS_TABS.map(([k, n]) => `<a href="${k === 'health' ? '#/admin-system' : `#/admin-analytics?tab=${k}&days=${days}`}"><button type="button" class="${k === tab ? 'on' : ''}">${n}</button></a>`).join('')}</div>`;
export function registerAnalyticsAdmin(routes, helpers) { H = helpers; routes['admin-analytics'] = page; }

const n0 = v => Math.round(+v || 0).toLocaleString('en-US');
const st = (k, v, sub = '') => `<div class="stat"><span>${k}</span><b>${v}</b>${sub ? `<small class="mu">${sub}</small>` : ''}</div>`;
// Daily bars (no library): each day a bar, the tallest day full height.
function bars(list, label) {
  const max = Math.max(1, ...list.map(x => x.n));
  return `<div class="anbars" role="img" aria-label="${H.esc(label)}">${list.map(x => `<i style="height:${Math.max(2, x.n / max * 100).toFixed(1)}%" title="${x.day}: ${x.n}"></i>`).join('')}</div><div class="anaxis mu"><span>${list[0]?.day.slice(5) || ''}</span><span>${list.at(-1)?.day.slice(5) || ''}</span></div>`;
}
const table = (rows, a, b) => (rows.length ? `<table class="slim"><tr><th>${a}</th><th class="num">${b}</th></tr>${rows.map(r => `<tr><td data-no-tr>${H.esc(r.key || r.event)}</td><td class="num">${n0(r.n)}</td></tr>`).join('')}</table>` : '<p class="mu">Nothing recorded yet.</p>');
// Page names as the menu shows them (the key itself for pages not in the menu).
const SECTION_NAMES = () => Object.fromEntries([...document.querySelectorAll('#nav a[href^="#/"]')].map(a => [a.getAttribute('href').slice(2).split('?')[0], a.textContent.trim()]));

async function page(view, q) {
  const tab = q.get('tab') || 'overview', days = [7, 30, 90, 365].includes(+q.get('days')) ? +q.get('days') : 30;
  view.innerHTML = `<h1>Admin</h1>${H.adminTabs('admin-analytics')}<div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Analytics</h2>
    <label class="inline">Period <select id="andays">${[7, 30, 90, 365].map(d => `<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`).join('')}</select></label></div>${analyticsNav(tab, days)}<div id="ano"><p class="mu card">Loading…</p></div>`;
  H.$('#andays', view).onchange = e => (location.hash = `#/admin-analytics?tab=${tab}&days=${e.target.value}`);
  let d; try { d = await H.api('/a/admin?days=' + days); } catch (x) { H.$('#ano', view).innerHTML = `<p class="err card">${H.esc(x.message)}</p>`; return; }
  const o = H.$('#ano', view), O = d.overview;
  if (tab === 'overview') {
    o.innerHTML = `<div class="card"><div class="stats">${st('Users', n0(O.users), `+${n0(O.newUsers)} in ${days} days`)}${st('Paying', n0(O.paying))}${st('Monthly revenue (MRR)', H.money(O.mrr))}${st('Active today', n0(O.activeToday))}${st(`Active in ${days} days`, n0(O.activeRange))}${st('Website visits', n0(O.webVisits), `${n0(O.uniqueVisitors)} unique a day, added up`)}${st('Calls', n0(O.calls))}${st('Text messages', n0(O.texts))}</div></div>
      <div class="grid"><div class="card"><h3>New sign-ups a day</h3>${bars(O.signups, 'Sign-ups a day')}</div><div class="card"><h3>Website visits a day</h3>${bars(d.web.visits, 'Visits a day')}</div><div class="card"><h3>Pages opened in the app a day</h3>${bars(d.sections.views, 'App page views a day')}</div></div>`;
  } else if (tab === 'web') {
    o.innerHTML = `<div class="grid"><div class="card"><h3>Visits a day</h3>${bars(d.web.visits, 'Visits a day')}</div><div class="card"><h3>Unique visitors a day</h3>${bars(d.web.unique, 'Unique visitors a day')}</div></div>
      <div class="grid"><div class="card"><h3>Pages</h3>${table(d.web.pages, 'Page', 'Visits')}</div><div class="card"><h3>Where visitors come from</h3>${table(d.web.referrers, 'Site', 'Visits')}</div></div>
      <p class="mu small-print">Counted on this server without cookies or outside trackers: a visitor is one browser a day (a one-way hash that changes every day). Search engines and bots are left out.</p>`;
  } else if (tab === 'sections') {
    const names = SECTION_NAMES(), max = Math.max(1, ...d.sections.top.map(x => x.n));
    o.innerHTML = `<div class="card"><h3>Pages opened a day</h3>${bars(d.sections.views, 'App page views a day')}</div>
      <div class="card"><h3>Most used sections</h3>${d.sections.top.length ? `<div class="anrank">${d.sections.top.map(r => `<div><span>${H.esc(names[r.key] || r.key)}</span><i style="width:${(r.n / max * 100).toFixed(1)}%"></i><b>${n0(r.n)}</b></div>`).join('')}</div>` : '<p class="mu">Nothing recorded yet.</p>'}</div>`;
  } else if (tab === 'voice') {
    o.innerHTML = `<div class="card"><div class="stats">${st('Calls in', n0(d.voice.inbound))}${st('Calls out', n0(d.voice.outbound))}${st('Minutes', n0(d.voice.minutes))}</div>${bars(d.voice.days, 'Calls a day')}</div>
      <div class="card"><h3>What callers did</h3>${table(d.voice.events.map(e => ({ key: e.event.replace(/^hotline_?/, '').replace(/_/g, ' ') || 'call', n: e.n })), 'Action', 'Times')}<p class="mu small-print">Full call log: Admin → Phone line.</p></div>`;
  } else if (tab === 'sms') {
    o.innerHTML = `<div class="card"><div class="stats">${st('Texts in', n0(d.sms.inbound))}${st('Texts out', n0(d.sms.outbound))}</div>${bars(d.sms.days, 'Texts a day')}</div>
      <div class="card"><h3>Text events</h3>${table(d.sms.events.map(e => ({ key: e.event.replace(/_/g, ' '), n: e.n })), 'Event', 'Times')}<p class="mu small-print">Every message: Admin → Calls, texts &amp; email.</p></div>`;
  } else if (tab === 'pnl') {
    const U = d.pnl.users, uc = (k, x) => (x ? st(k, `<span class="${H.cls(x.pnl)}">${H.money(x.pnl)}</span>`, `${x.pct != null ? H.pct(x.pct) : ''} on ${H.money(x.start)}`) : st(k, '-', 'no history yet'));
    o.innerHTML = `<div class="card"><h3>The business</h3><div class="stats">${st('Monthly revenue (MRR)', H.money(d.pnl.mrr))}${st('Credit packs sold', n0(d.pnl.creditPacks.n), `${n0(d.pnl.creditPacks.credits)} credits`)}</div>
      ${d.pnl.ledger.length ? `<table class="slim"><tr><th>Kind</th><th>Status</th><th class="num">Count</th><th class="num">Total</th></tr>${d.pnl.ledger.map(r => `<tr><td>${H.esc(r.kind.replace(/_/g, ' '))}</td><td>${H.esc(r.status)}</td><td class="num">${n0(r.n)}</td><td class="num">${H.money(r.total)}</td></tr>`).join('')}</table>` : '<p class="mu">No payments in this period.</p>'}</div>
      <div class="card"><h3>Users' accounts</h3><div class="stats">${uc('Real-money accounts', U.live)}${uc('Practice accounts', U.paper)}</div><p class="mu small-print">All accounts added up, from the daily snapshots: the first day of the period against the latest. Deposits and withdrawals count as changes too.</p></div>`;
  }
}
