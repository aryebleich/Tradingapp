// "When" choice for buy, sell and close: now, at a date and time, before the close, at the next open,
// or after a delay. Saved through POST /api/schedule, which works out the timing (src/schedule-plan.js),
// runs every order through placeOrder later, and applies the same checks as a live order.
//   whenHtml({ repeat })          the fieldset (repeat options only on the Scheduled trades page)
//   wireWhen(root, ctx)           -> { kind(), when(), repeat(), weekdays(), isNow() }; shows the run time in
//                                    New York and local time, a countdown, how precise the timing is, and
//                                    the reminder that the price at run time may differ from the price now
//   scheduleOrder(order, w, api)  saves it after the review
import { timePicker, datePicker, fmtTime } from './clock.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nyDay = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const fmt = (t, tz) => new Date(t).toLocaleString('en-US', { ...(tz ? { timeZone: tz } : {}), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const countdown = ms => {
  if (ms <= 0) return 'runs now';
  const m = Math.round(ms / 60e3), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return 'runs in ' + (d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`);
};
export const KINDS = [['now', 'Now'], ['at', 'At a date and time'], ['close', 'Before the close'], ['open', 'At the next open'], ['delay', 'After a delay']];

export function whenHtml({ repeat = false, kinds = KINDS } = {}) {
  return `<fieldset class="when"><legend>When</legend>
    <div class="chips when-kinds" role="radiogroup" aria-label="When">${kinds.map(([k, n], i) => `<button type="button" role="radio" data-kind="${k}" aria-checked="${i === 0}" class="${i === 0 ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="when-at" hidden>
      <div class="chips when-quick" aria-label="Quick picks"><button type="button" data-q="open930">Market open</button><button type="button" data-q="close30">30 min before close</button><button type="button" data-q="close0">At close</button><button type="button" data-q="nextopen">Next open</button></div>
      <div class="when-pick"><div class="when-date"></div><div class="when-clock"></div></div>
      ${repeat ? `<label>Repeat<select name="repeat"><option value="once">Once</option><option value="daily">Every trading day</option><option value="weekly">On chosen weekdays</option><option value="monthly">Monthly on this date</option></select></label>
        <div class="when-wd" hidden>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<label class="check"><input type="checkbox" name="wd" value="${i + 1}"> ${d}</label>`).join('')}</div>` : ''}
    </div>
    <div class="when-close" hidden><label>Run<select name="closeOffset"><option value="0">At the close</option><option value="5">5 minutes before the close</option><option value="15">15 minutes before the close</option><option value="30">30 minutes before the close</option><option value="60">1 hour before the close</option><option value="custom">Other…</option></select></label>
      <label class="when-custom" hidden>Minutes before the close<input name="closeCustom" type="number" min="1" max="390" step="1" value="10"></label></div>
    <div class="when-delay chips" hidden role="radiogroup" aria-label="Delay"><button type="button" role="radio" data-delay="5" aria-checked="true" class="on">In 5 minutes</button><button type="button" role="radio" data-delay="60" aria-checked="false">In 1 hour</button></div>
    <div class="when-info" aria-live="polite"></div>
  </fieldset>`;
}

// The first weekday whose 9:30 AM New York open is still ahead (the date picker greys out holidays).
function firstDay(t = Date.now()) {
  const hm = +new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)).replace(':', '');
  let d = new Date(nyDay(t) + 'T12:00:00Z'); if (hm >= 930) d = new Date(+d + 864e5);
  while ([0, 6].includes(d.getUTCDay())) d = new Date(+d + 864e5);
  return d.toISOString().slice(0, 10);
}
export function wireWhen(root, { api, order = () => ({}), onChange = () => {} } = {}) {
  const box = root.querySelector('fieldset.when');
  let kind = 'now', delay = 5, date = firstDay(), time = '09:30', timer = null, seq = 0, preview = null;
  const $ = s => box.querySelector(s);
  const dp = datePicker($('.when-date'), { value: date, min: nyDay(), onChange: v => { date = v; refresh(); } });
  const tp = timePicker($('.when-clock'), { value: time, onChange: v => { time = v; refresh(); } });
  const setKind = k => {
    kind = k;
    box.querySelectorAll('[data-kind]').forEach(b => { const on = b.dataset.kind === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('.when-at').hidden = k !== 'at'; $('.when-close').hidden = k !== 'close'; $('.when-delay').hidden = k !== 'delay';
    refresh(); onChange(k);
  };
  box.querySelectorAll('[data-kind]').forEach(b => (b.onclick = () => setKind(b.dataset.kind)));
  // Arrow keys move between the choices of a radio group.
  box.querySelectorAll('[role=radiogroup]').forEach(g => (g.onkeydown = e => {
    const items = [...g.querySelectorAll('[role=radio]')], i = items.indexOf(document.activeElement), k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !k) return; e.preventDefault(); const n = items[(i + k + items.length) % items.length]; n.focus(); n.click();
  }));
  box.querySelectorAll('[data-delay]').forEach(b => (b.onclick = () => { delay = +b.dataset.delay; box.querySelectorAll('[data-delay]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); refresh(); }));
  const off = $('[name=closeOffset]'); off.onchange = () => { $('.when-custom').hidden = off.value !== 'custom'; refresh(); };
  $('[name=closeCustom]').oninput = refresh;
  const rep = $('[name=repeat]'); if (rep) rep.onchange = () => { $('.when-wd').hidden = rep.value !== 'weekly'; refresh(); };
  box.querySelectorAll('[name=wd]').forEach(c => (c.onchange = refresh));
  box.querySelectorAll('[data-q]').forEach(b => (b.onclick = () => {
    const q = b.dataset.q;
    if (q === 'open930') { time = '09:30'; tp.set(time); refresh(); }
    else if (q === 'close30') { off.value = '30'; setKind('close'); }
    else if (q === 'close0') { off.value = '0'; setKind('close'); }
    else if (q === 'nextopen') setKind('open');
  }));
  const offsetMin = () => (off.value === 'custom' ? +$('[name=closeCustom]').value || 0 : +off.value);
  const when = () => kind === 'at' ? { kind, date, time } : kind === 'close' ? { kind, offsetMin: offsetMin() } : kind === 'delay' ? { kind, delayMin: delay } : kind === 'open' ? { kind } : null;
  const weekdays = () => [...box.querySelectorAll('[name=wd]:checked')].map(c => +c.value);
  const show = () => {
    const info = $('.when-info');
    if (kind === 'now') { info.innerHTML = ''; return; }
    if (!preview) { info.innerHTML = '<p class="mu">Working out the time…</p>'; return; }
    if (preview.error) { info.innerHTML = `<p class="err" role="alert">${esc(preview.error)}</p>`; return; }
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    info.innerHTML = `<div class="when-run"><b>${esc(fmt(preview.nextRun, 'America/New_York'))}</b> <span class="mu">New York</span>
      ${local !== 'America/New_York' ? `<span class="mu">· ${esc(fmt(preview.nextRun))} your time</span>` : ''}
      <span class="pill when-cd">${countdown(preview.nextRun - Date.now())}</span></div>
      ${preview.auction ? `<p class="when-auction">${preview.auction === 'cls' ? 'Closing auction order (market on close).' : 'Opening auction order (market on open).'}</p>` : ''}
      <p class="mu when-prec"><b>Timing:</b> ${esc(preview.precision)}</p>
      <p class="mu when-price">${esc(preview.priceNote)}</p>`;
  };
  async function refresh() {
    clearTimeout(timer);
    if (kind === 'now') { preview = null; show(); return; }
    const my = ++seq; preview = null; show();
    timer = setTimeout(async () => {
      const o = order();
      try { preview = await api('/schedule/preview', { body: { ...o, qty: o.qty || undefined, notional: o.notional || undefined, symbol: o.symbol || 'SPY', side: o.side || 'buy', when: when(), repeat: rep?.value || 'once' } }); }
      catch (e) { preview = { error: e.message }; }
      if (my === seq) show();
    }, 250);
  }
  // The countdown stays current while the form is open.
  const tick = setInterval(() => { if (!box.isConnected) clearInterval(tick); else if (preview && !preview.error) { const cd = $('.when-cd'); if (cd) cd.textContent = countdown(preview.nextRun - Date.now()); } }, 30e3);
  return { kind: () => kind, when, isNow: () => kind === 'now', repeat: () => rep?.value || 'once', weekdays, refresh, preview: () => preview, setKind, fmtTime };
}

// The review text for a scheduled order, and saving it.
export function reviewHtml(p) {
  return `<p><b>Runs ${esc(fmt(p.nextRun, 'America/New_York'))}</b> New York (${countdown(p.nextRun - Date.now())}).</p>
    ${p.auction ? `<p>${p.auction === 'cls' ? 'Sent as a closing auction order.' : 'Sent as an opening auction order.'}</p>` : ''}
    <p class="mu"><b>Timing:</b> ${esc(p.precision)}</p><p class="warn">${esc(p.priceNote)}</p>`;
}
export async function scheduleOrder(api, order, w, extra = {}) {
  return api('/schedule', { body: { ...order, when: w.when(), repeat: w.repeat(), weekdays: w.weekdays(), ...extra } });
}

// Review dialog (native <dialog>: focus is trapped and Esc cancels); resolves true when confirmed.
export function reviewBox(title, html, okText = 'Schedule order') {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.setAttribute('aria-labelledby', 'whenRevTitle');
    d.innerHTML = `<h2 id="whenRevTitle">${esc(title)}</h2><div>${html}</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="ghost" value="no">Cancel</button><button value="yes">${esc(okText)}</button></div>`;
    document.body.append(d);
    d.querySelectorAll('button').forEach(b => (b.onclick = () => d.close(b.value)));
    d.onclose = () => { resolve(d.returnValue === 'yes'); d.remove(); };
    d.showModal();
  });
}
// The whole scheduled-order flow behind a "Review" button: only market and limit orders can be scheduled
// here; the preview gives the timing, the review states it with the price reminder, then it is saved.
export async function reviewAndSchedule(api, w, order, { what, live = false } = {}) {
  if (w.isNow()) throw new Error('Pick when it should run');
  if (!['market', 'limit', undefined].includes(order.orderType)) throw new Error('Only market and limit orders can be scheduled from here.');
  const body = { ...order, when: w.when(), repeat: w.repeat(), weekdays: w.weekdays() };
  const p = await api('/schedule/preview', { body });
  const ok = await reviewBox('Review scheduled order', `${live ? '<p class="warn"><b>This schedules a LIVE order with real money.</b></p>' : ''}<p><b>${esc(what)}</b></p>${reviewHtml(p)}`);
  if (!ok) return '';
  const r = await api('/schedule', { body });
  return `Scheduled: ${fmt(r.nextRun, 'America/New_York')} New York (${countdown(r.nextRun - Date.now())}). See Scheduled trades to edit or cancel it.`;
}

// "Close later" on a position: all of it, a quantity or a percentage, at a chosen time. The amount is
// worked out from the position when the order runs and never exceeds it.
export function closeLater(api, { account, symbol, qty, live = false }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'when-dialog'; d.setAttribute('aria-labelledby', 'clTitle');
    d.innerHTML = `<form method="dialog"><h2 id="clTitle">Close ${esc(symbol)} later</h2><p class="mu">Position now: ${esc(qty)}. The amount is checked again when the order runs and never exceeds the position.</p>
      <label>How much<select name="mode"><option value="all">Entire position</option><option value="qty">A quantity</option><option value="pct">A percentage</option></select></label>
      <label class="cl-amt" hidden><span class="cl-lbl">Quantity</span><input name="amount" type="number" step="any" min="0"></label>
      ${whenHtml({ kinds: KINDS.filter(([k]) => k !== 'now') })}
      <div class="err" role="alert"></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="ghost" value="no" formnovalidate>Cancel</button><button value="go" type="button" id="clGo">Review</button></div></form>`;
    document.body.append(d);
    const f = d.querySelector('form'), W = wireWhen(d, { api, order: () => ({ account, symbol, side: +qty > 0 ? 'sell' : 'buy', qty: Math.abs(+qty) }) });
    W.setKind('close');
    f.mode.onchange = () => { d.querySelector('.cl-amt').hidden = f.mode.value === 'all'; d.querySelector('.cl-lbl').textContent = f.mode.value === 'pct' ? 'Percent of the position' : 'Quantity'; };
    d.querySelector('#clGo').onclick = async () => {
      const err = d.querySelector('.err'); err.textContent = '';
      try {
        const mode = f.mode.value, amt = +f.amount.value;
        if (mode !== 'all' && !(amt > 0)) throw new Error(mode === 'pct' ? 'Enter the percentage' : 'Enter the quantity');
        const order = { account, symbol, side: +qty > 0 ? 'sell' : 'buy', qty: mode === 'qty' ? amt : Math.abs(+qty), orderType: 'market', close: { mode, pct: mode === 'pct' ? amt : undefined } };
        const what = `Close ${mode === 'all' ? 'the entire position' : mode === 'pct' ? amt + '% of the position' : amt + ' of the position'} in ${symbol}`;
        const msg = await reviewAndSchedule(api, W, order, { what, live });
        if (msg) { d.close('done'); resolve(msg); }
      } catch (e) { err.textContent = e.message; }
    };
    d.onclose = () => { if (d.returnValue !== 'done') resolve(''); d.remove(); };
    d.showModal();
  });
}
