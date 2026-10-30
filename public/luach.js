// The luach: today's Hebrew date and zmanim, the coming Yom Tov and fasts, a month calendar,
// reminders before Shabbos and Yom Tov, and the tzedakah ledger (it counts toward maaser).
let H;
export function registerLuach(routes, helpers) { H = helpers; routes.luach = page; }
const TABS = [['today', 'Today'], ['month', 'Month'], ['tzedakah', 'Tzedakah ledger']];
const ZMANIM = [['alos', 'Alos hashachar (dawn, 16.1°)'], ['misheyakir', 'Misheyakir (11°)'], ['sunrise', 'Netz (sunrise)'], ['shemaMGA', 'Latest Shema (Magen Avraham)'], ['shemaGRA', 'Latest Shema (Gra)'], ['tefilaMGA', 'Latest Shacharis (Magen Avraham)'], ['tefilaGRA', 'Latest Shacharis (Gra)'], ['chatzos', 'Chatzos (midday)'], ['minchaGedola', 'Mincha gedola'], ['minchaKetana', 'Mincha ketana'], ['plag', 'Plag hamincha'], ['candles', 'Candle lighting (on Erev Shabbos and Yom Tov)'], ['sunset', 'Shkia (sunset)'], ['tzeis', 'Tzeis hakochavim (nightfall, 8.5°)'], ['rabbeinuTam', 'Rabbeinu Tam (72 minutes)']];
const KIND = { yomtov: 'Yom Tov', fast: 'Fast', chanukah: 'Chanukah', purim: 'Purim', roshchodesh: 'Rosh Chodesh', cholhamoed: 'Chol Hamoed', minor: '' };

async function page(view, q) {
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'today';
  const head = `<div class="pagehead"><div><h1>Luach</h1><p class="mu" style="margin:4px 0 0">The Hebrew date, zmanim for your city, Yom Tov and fasts, reminders before Shabbos and Yom Tov, and your tzedakah.</p></div></div>
    <div class="chips" style="margin-bottom:14px">${TABS.map(([k, t]) => `<a href="#/luach?tab=${k}"><button type="button" class="${k === tab ? 'on' : ''}">${t}</button></a>`).join('')}</div>`;
  if (tab === 'month') return month(view, q, head);
  if (tab === 'tzedakah') return tzedakah(view, q, head);
  const d = await H.api('/luach' + (q.get('date') ? '?date=' + encodeURIComponent(q.get('date')) : ''));
  const tm = x => (x ? new Date(x).toLocaleTimeString(undefined, { timeZone: d.tz, hour: 'numeric', minute: '2-digit' }) : '-');
  const dt = x => new Date(x).toLocaleString(undefined, { timeZone: d.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const t = d.today, s = d.settings;
  view.innerHTML = `${head}
  <div class="card luachtoday"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
    <div><div class="hdate" data-no-tr dir="rtl" lang="yi">${H.esc(t.hebrew.yi)}</div><p style="margin:4px 0 0"><b>${H.esc(t.hebrew.text)}</b> · ${new Date(t.date + 'T12:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      ${t.events.length ? `<p style="margin:6px 0 0">${t.events.map(e => `<span class="pill">${H.esc(e.name)}</span>`).join(' ')}</p>` : ''}</div>
    <form id="ld" class="row" style="gap:8px"><label>Date<input type="date" name="date" value="${t.date}"></label><button class="small ghost" style="align-self:flex-end">Show</button></form></div>
    <table class="slim zmanim">${ZMANIM.map(([k, n]) => `<tr><td>${n}</td><td style="text-align:end" dir="ltr"><b>${tm(t.zmanim[k])}</b></td></tr>`).join('')}</table>
    <p class="mu small-print">For ${H.esc(d.cities[s.city])}. Calculated from the sun's position; check your local luach or Rav for halachic decisions, and allow a few minutes' margin.</p></div>
  <div class="grid">
    <div class="card"><h2>Shabbos and Yom Tov</h2><table class="slim">${d.shabbos.map(x => `<tr><td><b>${H.esc(x.name)}</b></td><td><span>Candles</span> <span dir="ltr">${dt(x.starts)}</span><br><span>Ends</span> <span dir="ltr">${dt(x.ends)}</span></td></tr>`).join('')}</table>
      <form id="ls"><div class="row"><label>City<select name="city">${Object.entries(d.cities).map(([k, n]) => `<option value="${k}" ${k === s.city ? 'selected' : ''}>${H.esc(n)}</option>`).join('')}</select></label>
        <label>Remind me<select name="remindHours">${[2, 4, 6, 24].map(h => `<option value="${h}" ${h === s.remindHours ? 'selected' : ''}>${h === 24 ? 'The day before' : h + ' hours before'}</option>`).join('')}</select></label></div>
        <label class="chk"><input type="checkbox" name="remind" ${s.remind ? 'checked' : ''}> Send me candle lighting and end times before every Shabbos and Yom Tov</label>
        <button class="small">Save</button><div class="err"></div></form></div>
    <div class="card"><h2>Coming up</h2><table class="slim">${d.coming.map(e => `<tr><td>${new Date(e.date + 'T12:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })}</td><td><b>${H.esc(e.name)}</b></td><td class="mu">${KIND[e.kind] || ''}</td></tr>`).join('') || '<tr><td class="mu">Nothing special in the next 45 days.</td></tr>'}</table></div>
  </div>`;
  const ld = H.$('#ld', view);
  ld.onsubmit = e => { e.preventDefault(); location.hash = '#/luach?date=' + ld.date.value; };
  const f = H.$('#ls', view);
  H.act(H.$('button', f), async () => { const v = H.form(f); await H.api('/luach/settings', { method: 'PUT', body: { city: v.city, remind: v.remind, remindHours: +v.remindHours } }); H.render(); return 'Saved'; });
}

async function month(view, q, head) {
  const now = new Date(), y = +q.get('y') || now.getFullYear(), m = +q.get('m') || now.getMonth() + 1;
  const d = await H.api(`/luach/month?y=${y}&m=${m}`);
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1], next = m === 12 ? [y + 1, 1] : [y, m + 1];
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const hm = [...new Set(d.days.map(x => x.hebrew.month))].join(' – ');
  const blanks = d.days[0].weekday, wd = [...Array(7)].map((_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' }));
  view.innerHTML = `${head}<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><a href="#/luach?tab=month&y=${prev[0]}&m=${prev[1]}"><button class="small ghost">‹</button></a>
      <div style="text-align:center"><h2 style="margin:0">${name}</h2><span class="mu">${H.esc(hm)}</span></div><a href="#/luach?tab=month&y=${next[0]}&m=${next[1]}"><button class="small ghost">›</button></a></div>
    <div class="lgrid">${wd.map(w => `<div class="lwd">${w}</div>`).join('')}${'<div></div>'.repeat(blanks)}${d.days.map(x => `<a class="lday ${x.weekday === 6 ? 'shab' : ''} ${x.events.map(e => 'k-' + e.kind).join(' ')}" href="#/luach?date=${x.date}">
      <span class="ln">${+x.date.slice(8)}</span><span class="lh" data-no-tr dir="rtl">${H.esc(x.hebrew.yi.split(' ')[0])}</span>${x.events.map(e => `<span class="le">${H.esc(e.name)}</span>`).join('')}</a>`).join('')}</div></div>`;
}

async function tzedakah(view, q, head) {
  const year = +q.get('year') || new Date().getFullYear(), d = await H.api('/luach/tzedakah?year=' + year);
  view.innerHTML = `${head}<div class="grid">
    <form class="card" id="tz"><h2>Record a gift</h2>
      <div class="row"><label>Date<input type="date" name="day" value="${new Date().toISOString().slice(0, 10)}"></label><label>Amount ($)<input name="amount" type="number" min="0.01" step="0.01" required></label></div>
      <label>Given to<input name="recipient" maxlength="100" required list="tzr" placeholder="Name of the tzedakah or person"></label><datalist id="tzr">${d.byRecipient.map(r => `<option value="${H.esc(r.recipient)}">`).join('')}</datalist>
      <label>Note<input name="note" maxlength="300"></label><button>Add</button><div class="err"></div>
      <p class="mu small-print">Your ledger counts toward the <a href="#/values?tab=maaser">maaser calculator</a>. Keep the receipts for tax-deductible gifts.</p></form>
    <div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${year}</h2>
        <div class="row" style="gap:6px"><a href="#/luach?tab=tzedakah&year=${year - 1}"><button class="small ghost">${year - 1}</button></a>${year < new Date().getFullYear() ? `<a href="#/luach?tab=tzedakah&year=${year + 1}"><button class="small ghost">${year + 1}</button></a>` : ''}<a href="/api/luach/tzedakah.csv?year=${year}" download><button class="small ghost">CSV</button></a></div></div>
      <div class="stats">${`<div class="stat"><span>Given in ${year}</span><b>${H.money(d.total)}</b></div><div class="stat"><span>Gifts</span><b>${d.items.length}</b></div>`}</div>
      ${d.byRecipient.length ? `<h3>By recipient</h3><table class="slim">${d.byRecipient.map(r => `<tr><td>${H.esc(r.recipient)}</td><td style="text-align:end">${H.money(r.amount)}</td></tr>`).join('')}</table>` : ''}</div></div>
  <div class="card"><h2>Every gift</h2><div class="tablewrap"><table class="slim">${d.items.map(i => `<tr><td>${new Date(i.day + 'T12:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })}</td><td>${H.esc(i.recipient)}${i.note ? `<br><span class="mu">${H.esc(i.note)}</span>` : ''}</td><td style="text-align:end">${H.money(i.amount)}</td><td><button class="small ghost" data-rm="${i.id}">Remove</button></td></tr>`).join('') || '<tr><td class="mu">Nothing recorded for this year yet.</td></tr>'}</table></div></div>`;
  const f = H.$('#tz', view);
  H.act(H.$('button', f), async () => { await H.api('/luach/tzedakah', { body: H.form(f) }); H.render(); return ''; });
  H.$$('[data-rm]', view).forEach(b => H.act(b, async () => { await H.api('/luach/tzedakah/' + b.dataset.rm, { method: 'DELETE' }); H.render(); return ''; }));
}
