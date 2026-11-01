// The opening and closing bell: a banner slides in when the US stock market opens (9:30 AM New
// York) and closes (4 PM, or 1 PM on early-close days), with the main indexes. It shows once per
// event, also when the app is opened within 10 minutes after it, and can be switched off from the
// banner itself.
let H, last = null;
const KEY = 'qp_bell_seen', OFF = 'qp_bell_off';
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export function startBell(helpers) {
  H = helpers;
  if (get(OFF) === '1') return;
  const tick = async () => {
    if (document.hidden || !H.me()) return;
    const s = await H.api('/desk/session').catch(() => null); if (!s) return;
    const day = new Date().toISOString().slice(0, 10);
    // A change while the app is open, or the app opened within 10 minutes after the bell.
    let event = null;
    if (last && last.open !== s.open) event = s.open ? 'open' : 'close';
    else if (!last) {
      const m = nyMinutes(), close = s.earlyClose ? 780 : 960;
      if (s.open && m >= 570 && m < 580) event = 'open';
      if (!s.open && s.status === 'after-hours' && m >= close && m < close + 10) event = 'close';
    }
    last = s;
    if (!event || get(KEY) === `${day}:${event}`) return;
    set(KEY, `${day}:${event}`);
    show(event, s);
  };
  tick(); setInterval(tick, 30000);
}
const nyMinutes = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return +p.hour * 60 + +p.minute; };
async function show(event, s) {
  document.querySelector('.bell')?.remove();
  const el = document.createElement('div');
  el.className = `bell ${event}`; el.setAttribute('role', 'status');
  const when = t => new Date(t).toLocaleTimeString(undefined, { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  el.innerHTML = `<div class="bellin"><span class="bico" aria-hidden="true">🔔</span><div><b>${event === 'open' ? 'Opening bell: the US stock market is open' : 'Closing bell: the US stock market is closed'}</b>
    <span class="mu">${event === 'open' ? `Regular trading until ${when(s.nextClose)} New York time.` : `After-hours trading until 8 PM; next open ${new Date(s.nextOpen).toLocaleString(undefined, { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })} New York time.`}</span>
    <span class="bellidx" id="bellIdx"></span></div><button type="button" class="small ghost" data-x aria-label="Close">✕</button></div>
    <label class="belloff"><input type="checkbox"> Don't show the bell again</label>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 500); };
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('.belloff input').onchange = e => { set(OFF, e.target.checked ? '1' : '0'); };
  setTimeout(close, 14000);
  const idx = [];
  for (const s of ['SPY', 'QQQ', 'DIA']) { const q = await H.api(`/desk/quote/${s}`).catch(() => null); if (q) idx.push(`${s} ${q.price.toFixed(2)}`); }
  const box = el.querySelector('#bellIdx'); if (box && idx.length) box.textContent = idx.join(' · ');
}
// For tests and the Settings page: show it now.
export const previewBell = (event = 'open') => H.api('/desk/session').then(s => show(event, s));
