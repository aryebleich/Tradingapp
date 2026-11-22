// Clock time picker and market date picker (plain JS, no library). Used everywhere a schedule time is
// chosen (src/schedule-plan.js decides what the time means).
//   timePicker(el, { value: 'HH:MM', onChange })  analog dial (hour, then minute; tap or drag) and a
//                                                   digital input, with a toggle; 12- or 24-hour by setting
//   datePicker(el, { value: 'YYYY-MM-DD', min, onChange })  month grid; weekends and market holidays
//                                                   are greyed out, early-close days marked
// Keyboard: the dial is a slider (arrows, Page Up/Down for 5 minutes, Enter to go from hour to minute);
// the date grid moves with the arrow keys. Motion stops under prefers-reduced-motion (theme.css).
import { closedDays } from '../market-calendar.js';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const KEY24 = 'qp_clock24';
export const use24h = () => { try { return localStorage.getItem(KEY24) === '1'; } catch { return false; } };
const set24h = on => { try { localStorage.setItem(KEY24, on ? '1' : '0'); } catch {} };
export const fmtTime = (hhmm, h24 = use24h()) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h24 ? `${pad(h)}:${pad(m)}` : `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
};
let uid = 0;

export function timePicker(el, { value = '09:30', onChange = () => {}, label = 'Time (New York)' } = {}) {
  const id = 'clk' + ++uid;
  let [h, m] = value.split(':').map(Number), mode = 'hour', view = 'dial', h24 = use24h();
  el.classList.add('clk');
  const emit = () => onChange(`${pad(h)}:${pad(m)}`);
  const draw = () => {
    const R = 92, cx = 110, cy = 110;
    const marks = mode === 'hour'
      ? (h24 ? [...Array(24).keys()] : [...Array(12).keys()].map(i => i + 1))
      : [...Array(12).keys()].map(i => i * 5);
    const pos = (i, n, r) => { const a = (i / n) * 2 * Math.PI - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const labels = marks.map((v, i) => {
      const inner = mode === 'hour' && h24 && (v === 0 || v > 12);
      const idx = mode === 'hour' ? (h24 ? v % 12 : v % 12) : i, [x, y] = pos(idx, 12, inner ? R - 30 : R);
      const on = mode === 'hour' ? (h24 ? v === h : v === ((h + 11) % 12) + 1) : v === m;
      return `<text x="${x}" y="${y}" class="${on ? 'on' : ''}${inner ? ' in' : ''}" dominant-baseline="central" text-anchor="middle">${mode === 'hour' ? v : pad(v)}</text>`;
    }).join('');
    const frac = mode === 'hour' ? (h % 12) / 12 : m / 60, inner = mode === 'hour' && h24 && (h === 0 || h > 12);
    const ang = frac * 360, len = inner ? R - 30 : R;
    const txt = mode === 'hour' ? (h24 ? `${h} hours` : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`) : `${m} minutes`;
    el.innerHTML = `<div class="clk-head">
        <button type="button" class="clk-part ${mode === 'hour' ? 'on' : ''}" data-mode="hour" aria-pressed="${mode === 'hour'}">${h24 ? pad(h) : ((h + 11) % 12) + 1}</button><span aria-hidden="true">:</span>
        <button type="button" class="clk-part ${mode === 'minute' ? 'on' : ''}" data-mode="minute" aria-pressed="${mode === 'minute'}">${pad(m)}</button>
        ${h24 ? '' : `<span class="seg clk-ampm" role="group" aria-label="AM or PM"><button type="button" data-ap="am" class="${h < 12 ? 'on' : ''}" aria-pressed="${h < 12}">AM</button><button type="button" data-ap="pm" class="${h >= 12 ? 'on' : ''}" aria-pressed="${h >= 12}">PM</button></span>`}
        <span class="clk-sp"></span>
        <span class="seg clk-view" role="group" aria-label="Clock style"><button type="button" data-view="dial" class="${view === 'dial' ? 'on' : ''}" aria-pressed="${view === 'dial'}">Dial</button><button type="button" data-view="digital" class="${view === 'digital' ? 'on' : ''}" aria-pressed="${view === 'digital'}">Digital</button></span>
      </div>
      ${view === 'dial' ? `<div class="clk-face" id="${id}" role="slider" tabindex="0" aria-label="${mode === 'hour' ? 'Hour' : 'Minute'} (${esc(label)})" aria-valuemin="0" aria-valuemax="${mode === 'hour' ? 23 : 59}" aria-valuenow="${mode === 'hour' ? h : m}" aria-valuetext="${txt}">
        <svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="106" class="clk-bg"/>
          <g class="clk-hand" style="transform: rotate(${ang}deg)"><line x1="110" y1="110" x2="110" y2="${110 - len}"/><circle cx="110" cy="${110 - len}" r="15"/></g>
          <circle cx="110" cy="110" r="3.5" class="clk-pin"/>${labels}</svg></div>
        <p class="mu clk-hint">${mode === 'hour' ? 'Pick the hour, then the minute.' : 'Pick the minute. Drag for single minutes.'}</p>`
      : `<label class="clk-digital">${esc(label)}<input type="time" step="60" value="${pad(h)}:${pad(m)}"></label>`}
      <label class="check clk-24"><input type="checkbox" ${h24 ? 'checked' : ''}> 24-hour clock</label>`;
    wire();
  };
  const setFromAngle = (x, y, rect) => {
    const dx = x - rect.left - rect.width / 2, dy = y - rect.top - rect.height / 2;
    let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += 2 * Math.PI;
    const r = Math.hypot(dx, dy) / (rect.width / 2);
    if (mode === 'hour') {
      let v = Math.round((a / (2 * Math.PI)) * 12) % 12;
      if (h24) h = r < 0.66 ? (v === 0 ? 0 : v + 12) : (v === 0 ? 12 : v);
      else h = (h >= 12 ? 12 : 0) + v;
    } else m = Math.round((a / (2 * Math.PI)) * 60) % 60;
  };
  function wire() {
    el.querySelectorAll('[data-mode]').forEach(b => (b.onclick = () => { mode = b.dataset.mode; draw(); el.querySelector('.clk-face')?.focus(); }));
    el.querySelectorAll('[data-ap]').forEach(b => (b.onclick = () => { h = b.dataset.ap === 'am' ? h % 12 : (h % 12) + 12; draw(); emit(); }));
    el.querySelectorAll('[data-view]').forEach(b => (b.onclick = () => { view = b.dataset.view; draw(); }));
    el.querySelector('.clk-24 input').onchange = e => { h24 = e.target.checked; set24h(h24); draw(); };
    const dig = el.querySelector('.clk-digital input');
    if (dig) dig.onchange = () => { if (/^\d{2}:\d{2}$/.test(dig.value)) { [h, m] = dig.value.split(':').map(Number); emit(); } };
    const face = el.querySelector('.clk-face'); if (!face) return;
    let drag = false;
    const move = e => { setFromAngle(e.clientX, e.clientY, face.getBoundingClientRect()); refresh(); };
    // Updates the hand and the labels without rebuilding (keeps the pointer capture while dragging).
    const refresh = () => {
      const keep = drag; const f = el.querySelector('.clk-face'); const had = document.activeElement === f;
      draw(); emit(); if (had || keep) el.querySelector('.clk-face')?.focus({ preventScroll: true });
    };
    face.onpointerdown = e => { drag = true; face.setPointerCapture?.(e.pointerId); move(e); };
    face.onpointermove = e => { if (drag && e.buttons) { setFromAngle(e.clientX, e.clientY, face.getBoundingClientRect()); const hand = el.querySelector('.clk-hand'); const frac = mode === 'hour' ? (h % 12) / 12 : m / 60; if (hand) hand.style.transform = `rotate(${frac * 360}deg)`; } };
    face.onpointerup = e => { if (!drag) return; drag = false; move(e); if (mode === 'hour') { mode = 'minute'; draw(); el.querySelector('.clk-face')?.focus({ preventScroll: true }); } };
    face.onkeydown = e => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (step) {
        e.preventDefault();
        if (mode === 'hour') h = (h + Math.sign(step) + 24) % 24; else m = (m + step + 60) % 60;
        draw(); emit(); el.querySelector('.clk-face').focus();
      } else if (e.key === 'Enter' && mode === 'hour') { e.preventDefault(); mode = 'minute'; draw(); el.querySelector('.clk-face').focus(); }
    };
  }
  draw();
  return { get value() { return `${pad(h)}:${pad(m)}`; }, set(v) { [h, m] = v.split(':').map(Number); draw(); } };
}

// ---------- date picker ----------
// The shared market calendar (market-calendar.js, the same file the server uses), so there is no
// request and no second list of holidays.
async function calendar(from, to) { return { days: closedDays(from, to).map(d => (d.early ? { ...d, early: '13:00' } : d)) }; }
const addDays = (day, k) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function datePicker(el, { value, min, onChange = () => {} } = {}) {
  let sel = value, month = value.slice(0, 7);
  el.classList.add('dpk');
  const draw = async () => {
    const [y, mo] = month.split('-').map(Number), first = `${month}-01`, days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const c = await calendar(first, `${month}-${pad(days)}`), info = new Map((c.days || []).map(d => [d.day, d]));
    const lead = new Date(first + 'T12:00:00Z').getUTCDay();
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const day = `${month}-${pad(d)}`, wd = (lead + d - 1) % 7, x = info.get(day), past = min && day < min;
      const closed = wd === 0 || wd === 6 || x?.closed, why = x?.closed ? x.name : wd === 0 || wd === 6 ? 'Weekend' : x?.early ? 'Closes early, 1:00 PM New York' : '';
      cells += `<button type="button" data-day="${day}" class="${closed || past ? 'off' : ''}${x?.early ? ' early' : ''}${day === sel ? ' on' : ''}" ${closed || past ? 'aria-disabled="true"' : ''} aria-pressed="${day === sel}"
        aria-label="${MONTHS[mo - 1]} ${d}${why ? ', ' + why : ''}" ${why ? `title="${esc(why)}"` : ''} tabindex="${day === sel ? 0 : -1}">${d}</button>`;
    }
    el.innerHTML = `<div class="dpk-head"><button type="button" class="ghost small" data-mv="-1" aria-label="Previous month">‹</button><b aria-live="polite">${MONTHS[mo - 1]} ${y}</b><button type="button" class="ghost small" data-mv="1" aria-label="Next month">›</button></div>
      <div class="dpk-grid" role="group" aria-label="Pick a trading day">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => `<span class="dpk-wd" aria-hidden="true">${w}</span>`).join('')}${cells}</div>
      <p class="mu dpk-key"><span class="dpk-sw off"></span> Market closed <span class="dpk-sw early"></span> Closes at 1:00 PM</p>`;
    el.querySelectorAll('[data-mv]').forEach(b => (b.onclick = () => { const d = new Date(Date.UTC(y, mo - 1 + +b.dataset.mv, 1)); month = d.toISOString().slice(0, 7); draw(); }));
    el.querySelectorAll('[data-day]').forEach(b => {
      b.onclick = () => { if (b.getAttribute('aria-disabled')) return; sel = b.dataset.day; onChange(sel); draw().then(() => el.querySelector(`[data-day="${sel}"]`)?.focus()); };
      b.onkeydown = e => {
        const k = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if (!k) return;
        e.preventDefault(); const to = addDays(b.dataset.day, k);
        if (to.slice(0, 7) !== month) { month = to.slice(0, 7); draw().then(() => el.querySelector(`[data-day="${to}"]`)?.focus()); }
        else el.querySelector(`[data-day="${to}"]`)?.focus();
      };
    });
  };
  draw();
  return { get value() { return sel; }, set(v) { sel = v; month = v.slice(0, 7); draw(); } };
}
