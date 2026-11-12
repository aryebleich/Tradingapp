// Where things are (public/):
//   app.html, app.js   the app's page and its core: sign-in, menu, page switching, shared helpers
//   pages/             one file per area of the app (trading, strategies, AI studio, admin, ...)
//   chart.js, i18n.js  the price chart and languages, used everywhere
//   i18n/              translations
//   index.html, yi.html, terms.html ...   the public website; site.js, site.css, chartstates.js
//   sw.js              keeps files on the device so repeat visits open at once
// Brightolio single-page client. Hash routes, no framework.
import { registerTrading } from './pages/trading.js';
import { chartStates, RICH_STATES, richStates, blendedColors } from './chartstates.js';
import { registerBrokers } from './pages/brokers.js';
import { registerProtect, getPasskey } from './pages/protect.js';
import { registerAddons } from './pages/addons.js';
import * as OD from './pages/orderdesk.js';
import { startBell } from './pages/bell.js';
import { registerStart } from './pages/start.js';
import { initSearch } from './pages/search.js';
import { attachGlossary } from './pages/glossary.js';
import { startI18n, setLang, canvasNote, LANGS, current as currentLang } from './i18n.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = x => (x < 0 ? '-$' : '$') + Math.abs(+x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x, d = 1) => (isFinite(x) ? (x > 0 ? '+' : '') + (+x).toFixed(d) + '%' : '-');
const num = (x, d = 2) => (isFinite(x) ? (+x).toFixed(d) : '-');
const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
const date = t => new Date(t).toLocaleString();

// Pages open at once on a repeat visit: while a page is being drawn, data it read in the last 10
// minutes is used right away and fetched again in the background; if anything changed, the page is
// drawn again quietly. Saving anything (any request that is not a read) empties this memory.
// The memory also survives closing the app (this browser only, for the signed-in user, emptied on
// sign-out): opening the app shows the last numbers at once while fresh ones load.
// The background loader (see prefetchAll): a hidden copy of the app that opens every section once,
// only reads, and hands every answer to the visible app.
const PREFETCH = window.parent !== window && new URLSearchParams(location.search).has('prefetch');
if (PREFETCH) Object.assign(window, { alert: () => {}, confirm: () => false, prompt: () => null });
const SWR = new Map(), SWR_SKIP = /^\/(auth|alpaca\/stream|notifications|admin\/agents|sponsored)/;
const KEEP_KEY = 'qp_keep';
let swrOn = false, swrRedraw = null, keepTimer = null;
// Small saves (seen markers, settings of one area) only forget that area; anything else forgets all.
const LIGHT = /^\/(prefs|learn\/ack|sponsored)\//;
const keepLoad = uid => { try { const k = JSON.parse(localStorage.getItem(KEEP_KEY) || 'null'); if (!k || k.uid !== uid || Date.now() - k.at > 864e5) return; for (const [p, d] of k.e) SWR.set(p, { at: k.at, data: d, json: JSON.stringify(d), ok: true, p: Promise.resolve(d), kept: true }); } catch {} };
const keepSave = () => { clearTimeout(keepTimer); keepTimer = setTimeout(() => { if (!ME) return; try { const e = [...SWR].filter(([, v]) => v.ok && !v.kept && v.json.length < 60000).slice(-60).map(([k, v]) => [k, v.data]); localStorage.setItem(KEEP_KEY, JSON.stringify({ uid: ME.email || ME.phone, at: Date.now(), e })); } catch {} }, 1500); };
const keepClear = () => { SWR.clear(); try { localStorage.removeItem(KEEP_KEY); localStorage.removeItem('qp_me'); } catch {} };
async function api(path, opts = {}, retried) {
  const get = !opts.method && !opts.body;
  if (PREFETCH && !get) throw new Error('Read-only while loading in the background');
  if (PREFETCH && get && SWR.get(path)?.ok && Date.now() - SWR.get(path).at < 60e3) return structuredClone(SWR.get(path).data);
  // Before an order: the second opinion, the user's own habits and the tax, when switched on.
  if (!get && !retried && !opts.checked && opts.body && /^\/(orders|alpaca\/orders)$/.test(path) && (EXTRAS.devil || EXTRAS.coach || EXTRAS.taxticket)) {
    if (!(await (await import('./pages/extras.js')).beforeOrder(shared, opts.body))) throw new Error('The order was not sent.');
  }
  if (!get && ACCTS) ACCTS.at = 0; // a change may have connected or removed an account: the list is read again
  if (!get) { if (LIGHT.test(path)) { const top = path.split('/')[1]; for (const k of [...SWR.keys()]) if (k.split(/[/?]/)[1] === top) SWR.delete(k); } else SWR.clear(); }
  else if (!SWR_SKIP.test(path)) {
    const hit = SWR.get(path), age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < 3000 && !hit.kept) return structuredClone(await hit.p);
    if (hit && swrOn && (age < 600e3 || hit.kept) && hit.ok) {
      const route = location.hash;
      // Refreshed once in the background; the remembered copy stays until the fresh one arrives.
      if (!hit.refreshing) {
        hit.refreshing = true;
        apiCall(path, {}).then(d => {
          const json = JSON.stringify(d);
          SWR.set(path, { at: Date.now(), data: d, json, ok: true, p: Promise.resolve(d) }); keepSave();
          if (json !== hit.json && location.hash === route) { clearTimeout(swrRedraw); swrRedraw = setTimeout(() => location.hash === route && !userBusySince(render.startedAt) && render({ quiet: true }), 150); }
        }).catch(() => { hit.refreshing = false; });
      }
      return structuredClone(hit.data);
    }
    return structuredClone(await fetchJson(path).then(p => p));
  }
  return apiCall(path, opts, retried);
}
// A read that is remembered (see above); failures are not remembered.
function fetchJson(path) {
  const e = { at: Date.now(), ok: false };
  e.p = apiCall(path, {}).then(d => { Object.assign(e, { data: d, json: JSON.stringify(d), ok: true }); if (PREFETCH) parent.postMessage({ qpData: [path, d] }, location.origin); else keepSave(); return d; }, err => { SWR.delete(path); throw err; });
  SWR.set(path, e);
  if (SWR.size > 300) SWR.delete(SWR.keys().next().value);
  return Promise.resolve(e.p);
}
async function apiCall(path, opts = {}, retried) {
  const r = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  // Session expired (or signed out in another tab): go back to sign-in instead of showing errors.
  if (r.status === 401 && ME && !path.startsWith('/auth/')) { keepClear(); ME = null; location.hash = '#/login'; }
  if (r.status === 402 && d.upgrade) showUpgrade(d.feature);
  // Speed bump: read the risk notice (a 10-second wait), then the order is sent again once.
  if (d.needsAck && !retried && await riskNotice(d.needsAck)) { await api('/learn/ack/' + d.needsAck, { body: {} }); return apiCall(path, opts, true); }
  if (d.needsLesson && confirm(d.error + ' Open the lesson now?')) location.hash = '#/learn';
  // Step-up: the session must confirm it is the account holder before trading or moving money.
  if (d.stepUp && !retried && await stepUpBox()) return apiCall(path, opts, true);
  if (!r.ok) throw Object.assign(new Error(d.error || (r.status >= 500 ? 'The server is busy, please try again.' : r.statusText)), { status: r.status, addonOff: d.addonOff });
  return d;
}
const form = el => Object.fromEntries($$('[name]', el).map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value]));

// A modal with a countdown before the confirm button works (risk notices for options, crypto, margin).
async function riskNotice(kind) {
  const notices = (await fetch('/api/learn', { headers: { 'X-Requested-With': 'qp' } }).then(r => r.json()).catch(() => ({}))).notices || {};
  return new Promise(done => {
    const d = document.createElement('dialog'); d.className = 'upgrade';
    d.innerHTML = `<div class="top"><h2>Before you trade ${esc(kind)}</h2></div><div class="body"><p>${esc(notices[kind] || '')}</p><p class="mu">Take a moment. This order will be sent after you confirm.</p>
      <div class="row" style="justify-content:flex-end"><button class="ghost" value="no">Cancel</button><button value="yes" disabled><b>I understand</b> <span>10</span></button></div></div>`;
    document.body.append(d); d.showModal();
    const y = d.querySelector('[value=yes]'); let n = 10;
    const t = setInterval(() => { n--; y.querySelector('span').textContent = n > 0 ? n : ''; if (n <= 0) { clearInterval(t); y.disabled = false; } }, 1000);
    d.querySelector('[value=no]').onclick = () => { clearInterval(t); d.close(); d.remove(); done(false); };
    y.onclick = () => { clearInterval(t); d.close(); d.remove(); done(true); };
  });
}
function stepUpBox() {
  return new Promise(done => {
    const d = document.createElement('dialog'); d.className = 'upgrade';
    d.innerHTML = `<div class="top"><h2>Confirm it is you</h2></div><form class="body" method="dialog"><p class="mu">Something about this session looked unusual, so trading and transfers need your password${ME?.totpEnabled ? ' and 2FA code' : ''}.</p>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>${ME?.totpEnabled ? '<label>2FA code<input name="code" inputmode="numeric"></label>' : ''}
      <div class="row" style="justify-content:flex-end"><button type="button" class="ghost" value="no">Cancel</button><button value="yes">Confirm</button></div><div class="err"></div></form>`;
    document.body.append(d); d.showModal();
    d.querySelector('[value=no]').onclick = () => { d.close(); d.remove(); done(false); };
    d.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const r = await fetch('/api/security/step-up', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify(form(d)) });
      if (r.ok) { d.close(); d.remove(); done(true); } else d.querySelector('.err').textContent = (await r.json().catch(() => ({}))).error || 'Try again';
    };
  });
}

// Wire a button to an async action with an error/ok line under it.
// Wire a button to an async action with a status line under it ("Working…", then the result or error).
function act(btn, fn, out) {
  btn.onclick = async e => {
    e.preventDefault();
    let o = out || btn.__out || btn.parentElement.querySelector('.err');
    if (!o) { o = document.createElement('div'); btn.after(o); }
    btn.__out = o;
    btn.disabled = true; o.className = 'mu'; o.style.marginTop = '8px'; o.textContent = 'Working…';
    try { const m = await fn(); o.className = 'ok'; o.textContent = typeof m === 'string' ? m : ''; }
    catch (err) { o.className = 'err'; o.textContent = err.message; }
    btn.disabled = false;
  };
}

let ME = null, CFG = null;
try { if (new URLSearchParams(location.search).get('next') === 'handoff') sessionStorage.setItem('qp_next', 'handoff'); } catch {}
// The user's display preferences (Settings → Portfolio numbers), loaded once after sign-in.
const PREFS = { portfolio: { mode: 'live', hideToday: false }, chart: { mode: 'colorful', color: '#2563eb' }, loaded: false };
async function loadPrefs() {
  if (PREFS.loaded || !ME) return PREFS;
  const [v, c] = await Promise.all([api('/prefs/portfolio').catch(() => null), api('/prefs/chart').catch(() => null)]);
  if (v?.value) PREFS.portfolio = v.value;
  if (c?.value) PREFS.chart = c.value;
  PREFS.loaded = true; return PREFS;
}
// "Since you last looked": the change from the value at the previous visit. A visit lasts 30
// minutes, so reloading or switching pages keeps comparing with the same earlier visit.
async function sinceLastLook(account, equity) {
  const seen = (await api('/prefs/seen').catch(() => null))?.value || {}, s = seen[account];
  let base = s?.prevEquity ? { equity: s.prevEquity, at: s.prevAt } : null;
  if (!s || Date.now() - s.at > 30 * 60e3) {
    // A new visit: the last one becomes the comparison point.
    if (s) base = { equity: s.equity, at: s.at };
    api('/prefs/seen', { method: 'PUT', body: { value: { ...seen, [account]: { equity, at: Date.now(), ...(base ? { prevEquity: base.equity, prevAt: base.at } : {}) } } } }).catch(() => {});
  }
  return base && base.equity > 0 ? { change: equity - base.equity, pct: (equity / base.equity - 1) * 100, at: base.at } : null;
}
// The stat box for it (or nothing when this is the first look).
const sinceStat = s => (s ? `<div class="stat since"><span>Since you last looked</span><b class="${cls(s.change)}">${money(s.change)}</b><small class="mu"><span dir="ltr">${pct(s.pct, 2)}</span> · ${new Date(s.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div>` : '');
// Accounts the user can trade (paper, Alpaca, other brokerages), cached for a minute.
let ACCTS = null;
// Optional features the user switched on (Settings → Optional features; pages/extras.js).
let EXTRAS = {};
const TOOL_KEYS = ['goals', 'family', 'replay', 'coach', 'explain', 'autopsy', 'promises', 'crowd', 'shailos', 'statement'];
const loadExtras = async () => { EXTRAS = (await api('/extras').catch(() => null))?.on || EXTRAS; };
async function accounts(force) {
  if (force || !ACCTS || Date.now() - ACCTS.at > 60e3) ACCTS = { at: Date.now(), list: await api('/accounts').catch(() => [{ id: 'paper', name: 'Paper account', connected: true }]) };
  return ACCTS.list;
}
const acctLabel = a => (a.id === 'paper' ? 'Paper account' : `${a.name}${a.live ? ' (live)' : a.id === 'alpaca' ? '' : ' (test)'}`);
const accountOptions = (list, selected, paid = true) => list.filter(a => a.connected || a.id === selected || a.id === 'alpaca')
  .map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(acctLabel(a))}${a.id !== 'paper' && !paid ? ' · Pro' : ''}${!a.connected ? ' · not connected' : ''}</option>`).join('');
// Real money (the live account) is the default; the choice is remembered per browser.
const state = { account: (() => { try { return localStorage.getItem('qp_account') || ''; } catch { return ''; } })() };
// No choice made yet in this browser: the live account when one is connected, otherwise practice money.
// Until the user picks Paper or Live themselves, this follows the connection: connecting a brokerage
// moves a new user from practice money to that account without another step.
async function defaultAccount() {
  let chosen = ''; try { chosen = localStorage.getItem('qp_account') || ''; } catch { chosen = state.account; }
  if (chosen) { if (!state.account) state.account = chosen; return; }
  const list = await accounts().catch(() => []);
  state.account = list.some(a => a.id === 'alpaca' && a.connected) ? 'alpaca' : 'paper';
}

// ---------- chart: the equity line, colored by gain/loss state (chartstates.js), drawing itself in ----------
const calmMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Under charts other than the portfolio: what each color means (colorful mode only).
function chartLegend(canvas, series, states, base) {
  if (!canvas.parentElement) return;
  let el = canvas.nextElementSibling;
  if (!el?.classList.contains('chartlegend')) { el = document.createElement('div'); el.className = 'chartlegend'; canvas.after(el); }
  const rich = richStates(series, base), used = new Set(rich.slice(1)), now = rich[rich.length - 1];
  const fromBase = base ? (series[series.length - 1] / base - 1) * 100 : 0;
  el.innerHTML = `<span class="now"><i style="background:${RICH_STATES[now].color}"></i><b>${esc(RICH_STATES[now].label)}</b> <span dir="ltr">${fromBase >= 0 ? '+' : ''}${fromBase.toFixed(1)}%</span></span>`
    + Object.entries(RICH_STATES).filter(([k]) => used.has(k)).map(([k, v]) => `<span><i style="background:${v.color}"></i>${esc(v.label)}</span>`).join('');
}
// The last data drawn in each chart spot, so a refresh with the same numbers does not replay the
// drawing animation (a chart that keeps redrawing while you look at it is unsettling).
const chartSeen = new Map();
function drawChart(canvas, series, { base, compare, legend = true, dates = null, time = false, axis = true, unit = '$' } = {}) {
  cancelAnimationFrame(canvas.__anim || 0);
  const key = (canvas.id || 'chart') + location.hash.split('?')[0], sig = JSON.stringify([series, base, compare]);
  const seen = chartSeen.has(key);
  chartSeen.set(key, sig);
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
  if (series.length < 2) { canvas.__hover = null; g.fillStyle = C('--mu'); canvasNote(g, 'Your equity curve starts filling in after the first trading day.'); return; }
  base ??= series[0];
  const states = chartStates(series, base);
  if (legend && (PREFS.chart?.mode || 'colorful') === 'colorful') chartLegend(canvas, series, states, base); else canvas.nextElementSibling?.classList.contains('chartlegend') && canvas.nextElementSibling.remove();
  const all = [...series, ...(compare || []), base];
  let lo = Math.min(...all), hi = Math.max(...all); if (hi === lo) { hi += 1; lo -= 1; }
  // Price scale on both sides, in round numbers that follow the prices shown (like trading charts);
  // too narrow a chart keeps the full width for the line.
  const ticks = axis && w >= 300 && h >= 120 ? niceTicks(lo, hi, Math.max(3, Math.min(6, Math.floor(h / 45)))) : [];
  if (ticks.length) { lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks.at(-1)); }
  const tickFmt = axisFormat(ticks, unit);
  g.font = '11px Inter, system-ui, sans-serif';
  const gut = ticks.length ? Math.ceil(Math.max(...ticks.map(t => g.measureText(tickFmt(t)).width))) + 12 : 0;
  const pad = 10, padL = pad + gut, padR = pad + gut;
  const X = i => padL + (i / Math.max(series.length - 1, 1)) * (w - padL - padR), Y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
  const yb = Y(base);
  // Colors (Settings → Chart colors): one color, a color the user picked, or colorful with blending.
  const cm = PREFS.chart || {}, one = cm.mode === 'one' ? '#2563eb' : cm.mode === 'custom' && /^#[0-9a-f]{6}$/i.test(cm.color || '') ? cm.color : null;
  const rich = one ? null : richStates(series, base);
  const pts = one ? series.map(() => one.match(/\w\w/g).map(x => parseInt(x, 16))) : blendedColors(series, base);
  const colorAt = i => `rgb(${pts[i].join(',')})`;
  const grad = alpha => {
    const gr = g.createLinearGradient(X(0), 0, X(series.length - 1), 0), n = series.length - 1;
    pts.forEach((c, i) => gr.addColorStop(n ? i / n : 0, `rgba(${c.join(',')},${alpha})`));
    return gr;
  };
  const frame = t => {
    g.clearRect(0, 0, w, h);
    if (ticks.length) {
      g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = C('--mu'); g.strokeStyle = C('--bd'); g.lineWidth = 1;
      for (const t of ticks) {
        const y = Y(t); if (y < 4 || y > h - 4) continue;
        g.globalAlpha = 0.35; g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke(); g.globalAlpha = 1;
        g.textAlign = 'right'; g.fillText(tickFmt(t), padL - 6, y + 4);
        g.textAlign = 'left'; g.fillText(tickFmt(t), w - padR + 6, y + 4);
      }
    }
    g.strokeStyle = C('--bd'); g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(padL, yb); g.lineTo(w - padR, yb); g.stroke(); g.setLineDash([]);
    if (compare) { g.strokeStyle = C('--mu'); g.globalAlpha = 0.7; g.lineWidth = 1.2; g.beginPath(); compare.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke(); g.globalAlpha = 1; }
    g.save(); g.beginPath(); g.rect(0, 0, padL + t * (w - padL), h); g.clip();
    // The area between the line and the starting value, then the line, each in the blended colors.
    g.beginPath(); g.moveTo(X(0), yb); series.forEach((v, i) => g.lineTo(X(i), Y(v))); g.lineTo(X(series.length - 1), yb); g.closePath();
    g.fillStyle = grad(0.18); g.fill();
    g.beginPath(); series.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.lineWidth = 2.5; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = grad(1); g.stroke();
    g.restore();
    if (t >= 1) { const x = X(series.length - 1), y = Y(series[series.length - 1]); g.fillStyle = colorAt(series.length - 1); g.beginPath(); g.arc(x - 1, y, 4, 0, 7); g.fill(); g.globalAlpha = 0.25; g.beginPath(); g.arc(x - 1, y, 9, 0, 7); g.fill(); g.globalAlpha = 1; }
  };
  // Pointing at the chart (mouse or finger) shows the date and value at that spot.
  canvas.__hover = { series, dates, time, base, X, Y, w, h, pad, padL, padR, frame, color: colorAt, label: i => (rich ? RICH_STATES[rich[i]].label : null) };
  if (!canvas.__hoverWired) { canvas.__hoverWired = true; wireChartHover(canvas); }
  // Animate only the first time this chart is shown; later redraws (new data, resize, theme) are instant.
  if (calmMotion() || seen) return frame(1);
  const t0 = performance.now(), run = now => { const t = Math.min(1, (now - t0) / 700); frame(1 - (1 - t) ** 3); if (t < 1) canvas.__anim = requestAnimationFrame(run); };
  canvas.__anim = requestAnimationFrame(run);
}

// Round price levels for an axis: 1, 2, 2.5 or 5 times a power of ten, about `count` of them.
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / Math.max(1, count - 1), p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const out = []; for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.5; v += step) out.push(+v.toFixed(10));
  return out.length > 12 ? out.filter((_, i) => i % 2 === 0) : out;
}
// Labels for those levels: $1.2M / $45.5K for big numbers, cents only when the steps need them.
export function axisFormat(ticks, unit = '$') {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1, big = Math.max(...ticks.map(Math.abs), 0);
  if (big >= 1e6) return v => `${unit}${(v / 1e6).toFixed(step >= 1e6 ? 0 : step >= 1e5 ? 1 : 2)}M`;
  if (big >= 1e5) return v => `${unit}${(v / 1e3).toFixed(step >= 1e3 ? 0 : 1)}K`;
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4;
  return v => `${v < 0 ? '-' : ''}${unit}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
// The read-out for drawChart: a thin line, a dot and a label with the date and value.
function wireChartHover(canvas) {
  const box = canvas.parentElement;
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  const tip = document.createElement('div'); tip.className = 'charttip'; tip.hidden = true; tip.setAttribute('dir', 'ltr'); box.append(tip);
  const fmtDay = (d, time) => { const t = new Date(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d); return isNaN(t) ? '' : t.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : { timeZone: 'UTC' }) }); };
  const show = e => {
    const c = canvas.__hover; if (!c || c.series.length < 2) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left;
    const pl = c.padL ?? c.pad, pr = c.padR ?? c.pad;
    const i = Math.max(0, Math.min(c.series.length - 1, Math.round((x - pl) / (c.w - pl - pr) * (c.series.length - 1))));
    const v = c.series[i], px = c.X(i), py = c.Y(v);
    cancelAnimationFrame(canvas.__anim || 0); c.frame(1);
    const g = canvas.getContext('2d'), css = getComputedStyle(document.documentElement);
    g.save(); g.strokeStyle = css.getPropertyValue('--mu').trim(); g.globalAlpha = 0.5; g.lineWidth = 1; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, c.h); g.stroke(); g.restore();
    g.fillStyle = c.color(i); g.beginPath(); g.arc(px, py, 4.5, 0, 7); g.fill(); g.strokeStyle = css.getPropertyValue('--card').trim() || '#fff'; g.lineWidth = 2; g.stroke();
    const chg = c.base ? (v / c.base - 1) * 100 : null;
    tip.innerHTML = `${c.dates?.[i] != null ? `<span>${esc(fmtDay(c.dates[i], c.time))}</span>` : ''}<b>${money(v)}</b>${chg != null ? `<span class="${chg >= 0 ? 'up' : 'dn'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>` : ''}${c.label?.(i) ? `<span><i class="dot" style="background:${c.color(i)}"></i>${esc(c.label(i))}</span>` : ''}`;
    tip.hidden = false;
    const tw = tip.offsetWidth, left = canvas.offsetLeft + Math.min(Math.max(px - tw / 2, 0), c.w - tw);
    tip.style.left = left + 'px'; tip.style.top = Math.max(0, canvas.offsetTop + py - tip.offsetHeight - 12) + 'px';
  };
  const hide = () => { tip.hidden = true; const c = canvas.__hover; if (c) c.frame(1); };
  canvas.addEventListener('pointermove', show);
  canvas.addEventListener('pointerdown', show);
  canvas.addEventListener('pointerleave', hide);
  canvas.addEventListener('pointercancel', hide);
  // On phones the label stays a moment after the finger lifts.
  canvas.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') setTimeout(hide, 2500); });
  canvas.style.touchAction = 'pan-y';
}

// ---------- theme: auto (device), light or dark ----------
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  const svg = { auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor"/>', light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>' }[t];
  const b = $('#themeBtn'); if (b) { b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${svg}</svg>`; b.title = `Theme: ${t} (click to change)`; }
}
let theme = (() => { try { return localStorage.getItem('qp_theme') || 'auto'; } catch { return 'auto'; } })();
applyTheme(theme);
$('#themeBtn').onclick = () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; try { localStorage.setItem('qp_theme', theme); } catch {} applyTheme(theme); render(); };

// ---------- upgrade window: shown whenever a Pro feature is used on the free plan ----------
async function showUpgrade(feature) {
  if (document.querySelector('dialog.upgrade')) return;
  CFG ||= await api('/config').catch(() => null);
  const p = CFG?.plans?.pro || { monthly: 29, yearly: 290, features: [] }, trial = !ME?.trialUsed, days = CFG?.trialDays || 14;
  const d = document.createElement('dialog'); d.className = 'upgrade';
  d.innerHTML = `<div class="top"><h2>${esc(feature || 'This feature')} is a Pro feature</h2><div>${trial ? `Try every Pro feature free for ${days} days. Cancel anytime.` : 'Upgrade to unlock it, plus everything else in Pro.'}</div></div>
    <div class="body"><ul style="padding-left:18px;margin:0 0 14px">${p.features.slice(1, 6).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <p class="mu" style="margin:0 0 14px">$${p.monthly}/month, or $${p.yearly}/year <span class="save">2 months free</span></p>
    <div class="row" style="justify-content:flex-end"><button class="ghost" value="no">Not now</button><button value="yes">${trial ? `Start ${days}-day free trial` : 'See plans'}</button></div><div class="err"></div></div>`;
  document.body.append(d);
  d.querySelector('[value=no]').onclick = () => d.close();
  act(d.querySelector('[value=yes]'), async () => {
    if (!CFG?.stripe) { d.close(); location.hash = '#/funding'; return; }
    location.href = (await api('/billing/checkout', { body: { plan: 'pro', interval: 'month' } })).url;
  });
  d.onclose = () => d.remove();
  d.showModal();
}

// ---------- routing ----------
// Pages of add-ons the user can switch off (Settings → Add-ons) leave the menu when off.
const ADDON_PAGES = { brief: 'brief', taxpilot: 'taxPilot' };
// The menu: the everyday pages always show; every other group starts folded and opens with its arrow.
const CORE = [['dashboard', 'Home'], ['start', 'Get started'], ['trade', 'Trade'], ['positions', 'Positions'], ['orders', 'Orders'], ['watchlists', 'Watchlists'], ['markets', 'Market overview']];
// The owner's own business books (Admin only): payroll, invoices, bookkeeping and the rest.
const BIZ_NAV = ['My business', [['business', 'Business dashboard'], ['invoices', 'Invoices & payments'], ['books', 'Bookkeeping'], ['bank', 'Bank & receipts'], ['inventory', 'Inventory'], ['payroll', 'Payroll'], ['bizreports', 'Financial reports']]];
const NAV = [
  ['Investing', [['analyze', 'Stock & fund analyzer'], ['lowcost', 'Low-cost index & mutual funds'], ['earnings', 'Earnings vs expectations'], ['institutions', 'Institutional portfolios'], ['sp500', 'S&P 500 plan'], ['wealth', 'Investing toolkit'], ['robo', 'Automated portfolios'], ['longterm', 'Long-term view'], ['invest', 'Futures, funds & savings'], ['alpaca-tools', 'Bonds, rates & crypto'], ['tokenized', 'Tokenized securities'], ['values', 'Values investing'], ['spend', 'Invest as you spend']]],
  ['Trading tools', [['chart', 'Chart'], ['options', 'Options chain'], ['optionslab', 'Options lab'], ['scanner', 'Scanner'], ['leaders', 'New leaders'], ['short', 'Short the market'], ['margin', 'Margin center'], ['calendar', 'Calendar & events'], ['execution', 'Execution & routing'], ['workspace', 'Workspace']]],
  // Intelligence: research first (ask, read, follow the news), then AI predictions, then AI that trades.
  ['Intelligence', [['ai', 'AI assistant'], ['research', 'Plain-language research'], ['news', 'News & sentiment'], ['intel', 'Market intelligence'], ['aisignals', 'AI signals'], ['agents', 'Forecasts & AI agents'], ['aibots', 'AI bots'], ['agenthub', 'Agents & API']]],
  ['Automation', [['strategies', 'Strategy library'], ['backtest', 'Backtest'], ['bots', 'Bots'], ['schedule', 'Scheduled trades'], ['rules', 'Rules across accounts'], ['signals', 'Alerts to trades'], ['fleet', 'Signal fleet'], ['portfolios', 'Portfolios'], ['aifunds', 'AI long/short portfolios'], ['text', 'Text commands'], ['hotline', 'Phone hotline']]],
  // Marketplace: everything members share, to copy or follow.
  ['Marketplace', [['marketplace', 'Marketplace overview'], ['traders', 'Top traders'], ['aimarket', 'AI strategy marketplace'], ['sharedstrategies', 'Shared strategies'], ['sharedportfolios', 'Shared portfolios'], ['signalchannels', 'Signal channels']]],
  ['Quant lab', [['pairs', 'Pairs trading'], ['statarb', 'Statistical arbitrage'], ['code', 'Code lab'], ['quantconnect', 'Cloud algorithms']]],
  ['Planning', [['riskview', 'Portfolio & risk'], ['retirement', 'Retirement & IRAs'], ['money', 'All my money'], ['currencies', 'Currencies'], ['brief', 'Weekly brief'], ['insights', 'Insights & journal'], ['risk', 'Risk controls'], ['tax', 'Taxes'], ['taxpilot', 'Tax autopilot'], ['private', 'Private markets'], ['realestate', 'Real estate']]],
  ['Accounts', [['brokers', 'Choose your brokerage'], ['account', 'Alpaca account'], ['accounts', 'All accounts'], ['funding', 'Plans & billing'], ['referrals', 'Invite & earn']]],
  ['Help & settings', [['learn', 'Learning center'], ['security', 'Security & help'], ['protection', 'Investor protection'], ['android', 'Android app'], ['settings', 'Settings']]],
];
// Simple line icons (24x24 paths) for the menu.
const ICONS = {
  aimarket: '<path d="M3 9l2-5h14l2 5M3 9v11h18V9"/><circle cx="12" cy="15" r="2.5"/>', sharedstrategies: '<path d="M4 18l5-6 4 3 7-9"/><path d="M3 21h18"/>', sharedportfolios: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4"/>', signalchannels: '<path d="M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="14" r="1.5"/><path d="M12 16v5"/>',
  agenthub: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>', aibots: '<path d="M4 17l5-5 4 4 7-8"/><circle cx="20" cy="8" r="1.5"/><path d="M4 21h16"/>', aisignals: '<path d="M2 12h4l3-8 4 16 3-8h6"/>', intel: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/>',
  business: '<path d="M3 7h18v13H3z"/><path d="M8 7V4h8v3M3 12h18"/>', invoices: '<path d="M6 2h9l4 4v16H6z"/><path d="M9 10h7M9 14h7M9 18h4"/>',
  books: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6v16h6z"/>', bank: '<path d="M3 10h18L12 4z"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
  inventory: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>', payroll: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  traders: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>', robo: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
  analyze: '<circle cx="10" cy="10" r="6"/><path d="M21 21l-6.5-6.5M7.5 11l2-2 1.5 1.5 2-2.5"/>', lowcost: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3-1.6M12 6v2M12 16v2"/>',
  earnings: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/><path d="M14 6l3-3 3 3"/>', leaders: '<path d="M3 20h18M6 20V12M11 20V8M16 20V4"/><path d="M14 4h4v4"/>',
  short: '<path d="M3 6l6 6 4-4 8 8"/><path d="M21 10v6h-6"/>', margin: '<path d="M3 12h18M12 3v18"/><circle cx="12" cy="12" r="9"/>', aifunds: '<path d="M4 18l5-6 4 3 7-9"/><circle cx="18" cy="17" r="3"/><path d="M18 15.5v3M16.5 17h3"/>',
  currencies: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  bizreports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  riskview: '<path d="M12 3v9l7 4"/><circle cx="12" cy="12" r="9"/>',
  retirement: '<path d="M3 21h18M5 21V10l7-6 7 6v11"/><path d="M10 21v-6h4v6"/>',
  research: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>',
  tokenized: '<path d="M12 2l8 5v10l-8 5-8-5V7z"/><path d="M8 12h8"/>',
  protection: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  brokers: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
  sp500: '<path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h6v6"/>',
  pairs: '<path d="M7 4v16M17 4v16M4 8h6M14 16h6"/>',
  statarb: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  strategies: '<path d="M12 3v18M5 8h14M7 13h10M9 18h6"/>',
  signals: '<path d="M4 12h4l3-8 4 16 3-8h2"/>',
  dashboard: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>', trade: '<path d="M7 17 17 7M9 7h8v8"/>',
  orders: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', positions: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/>',
  watchlists: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', markets: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  options: '<path d="M3 6h18M3 12h18M3 18h18M9 3v18M15 3v18"/>', calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  backtest: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/>', bots: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 14h.01M15 14h.01"/>',
  schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', quantconnect: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  account: '<path d="M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5"/>', funding: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  referrals: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
  tax: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l6-6M9.5 9.5h.01M14.5 14.5h.01"/>',
  text: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', hotline: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4z"/>',
  extras: '<path d="M12 3l2.200 5.400 5.800.500-4.400 3.800 1.400 5.700L12 15.300 6.999 18.400l1.400-5.700L4 8.900l5.800-.500z"/>',
  'admin-phoneaccts': '<rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="10" r="2.200"/><path d="M8.500 16c.700-1.600 2-2.400 3.500-2.400s2.800.800 3.500 2.400M11 19h2"/>',
  'admin-phone': '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  'admin-ai': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  'admin-readme': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  'admin-users': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.6 3 5.2"/>',
  'admin-money': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  'admin-support': '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12.5h5"/>',
  'admin-setup': '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  admin: '<path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/>',
  wealth: '<path d="M3 20h18M5 20V10M10 20V6M15 20v-8M20 20V4"/>', 'alpaca-tools': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  'admin-alpaca': '<path d="M4 19V5l8 7 8-7v14"/>', 'admin-upgrades': '<path d="M12 19V5M5 12l7-7 7 7"/><path d="M5 21h14"/>', 'admin-sponsored': '<path d="M4 11v2a1 1 0 0 0 1 1h2l5 4V6L7 10H5a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>', 'admin-yiddish': '<path d="M4 5h8M8 3v2M5 5c1 4 4 7 7 8M11 5c-1 4-4 7-7 8M13 21l4-10 4 10M14.5 17h5"/>', 'admin-business': '<path d="M3 7h18v13H3zM8 7V4h8v3"/>', 'admin-admins': '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', 'admin-keys': '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  chart: '<path d="M7 4v16M17 6v12M4 8h6v8H4zM14 9h6v6h-6z"/>', ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  agents: '<path d="M3 17l6-6 4 4 8-8"/><circle cx="21" cy="7" r="1"/><path d="M3 21h18"/>', news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5"/>',
  scanner: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6M11 8v6"/>', optionslab: '<path d="M3 18c4 0 5-12 9-12s5 12 9 12"/><path d="M3 21h18"/>',
  institutions: '<path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M2 10l10-6 10 6z"/>', code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  portfolios: '<path d="M12 3v9l7.8 4.5A9 9 0 1 1 12 3z"/><path d="M15 3.5A9 9 0 0 1 20.5 13H15z"/>', fleet: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 11l10-5M7 13l10 5"/>',
  marketplace: '<path d="M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>', insights: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  risk: '<path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/><path d="M12 8v5M12 16h.01"/>', spend: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M16 15h2"/>',
  security: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', learn: '<path d="M2 8l10-5 10 5-10 5z"/><path d="M6 10v5c3 3 9 3 12 0v-5"/>',
  longterm: '<path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/><circle cx="20" cy="6" r="1"/>', execution: '<path d="M4 6h10M4 12h16M4 18h7"/><path d="M17 3l3 3-3 3"/>',
  workspace: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>',
  accounts: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  'admin-system': '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  private: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>', realestate: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10M10 20v-6h4v6"/>',
  money: '<path d="M3 10h18M5 10V20M9 10v10M15 10v10M19 10v10M3 20h18M12 3l9 5H3z"/>',
  luach: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M12 12l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>',
  brief: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>', taxpilot: '<path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.7 5 3.3 5 1.4 5 3.5-2.2 3.2-5 3.2-5-1.3-5-3.2"/>',
  'admin-comms': '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  'admin-hosting': '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>', 'admin-strategies': '<path d="M12 3v18M5 8h14M7 13h10M9 18h6"/>', 'admin-seo': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 12l2-2 2 2 2-3"/>', 'admin-agents': '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4"/><circle cx="12" cy="12" r="1.5"/>', 'admin-data': '<path d="M3 12h4l3-7 4 14 3-7h4"/><circle cx="12" cy="12" r="0.5"/>', 'admin-trust': '<path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
  invest: '<path d="M4 19h16M6 16V9M10 16V5M14 16v-6M18 16V7"/>',
  rules: '<path d="M4 6h16M4 12h10M4 18h6"/><path d="M17 14l2 2 3-4"/>',
  start: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  android: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  values: '<path d="M12 21s-7-4.4-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ''}</svg>`;
const isPaid = u => u && ((u.role === 'admin' && !u.previewPlan) || (['pro', 'elite', 'ultimate'].includes(u.plan) && ['active', 'trialing', null, undefined].includes(u.planStatus)));
const routes = {};
// Readable names for the security log.
const EVENT_LABELS = {
  register: 'Account created', login: 'Signed in', login_failed: 'Failed sign-in', mfa_failed: 'Wrong two-factor code', password_changed: 'Password changed',
  password_reset: 'Password reset', password_reset_requested: 'Password reset requested', email_verified: 'Email verified', phone_verified: 'Phone verified',
  totp_enabled: 'Two-factor login turned on', totp_disabled: 'Two-factor login turned off', google_linked: 'Google sign-in linked', account_deleted: 'Account deleted',
  alpaca_connected: 'Alpaca keys connected', alpaca_oauth_connected: 'Alpaca connected', brokerage_connected: 'Brokerage connected', brokerage_disconnected: 'Brokerage disconnected',
  broker_account_created: 'Brokerage application sent', broker_account_updated: 'Brokerage contact details changed', broker_documents_uploaded: 'Identity documents uploaded',
  ach_linked: 'Bank account linked', admin_user_update: 'Admin user update', transfer: 'Bank transfer', order: 'Order', alpaca_order: 'Order', alpaca_order_replaced: 'Order changed', alpaca_cancel_all: 'All orders cancelled',
  position_closed: 'Position closed', positions_closed_all: 'All positions closed', account_config: 'Account settings changed', checkout_started: 'Checkout started',
  sms_command: 'Text command', hotline_command: 'Phone command', hotline_ai: 'Phone AI request', hotline_pin_failed: 'Wrong phone PIN', ledger_update: 'Balance update',
};
// Live streams and timers belong to the page that opened them; they stop on navigation.
const cleanups = [];
const onLeave = fn => cleanups.push(fn);
// quiet: the same page drawn again in the background with fresh data (live refresh); the page on
// screen stays until the new one is ready, then they swap at the same scroll position.
// Reloads the signed-in user (plan, settings) after a change saved on any page.
const refreshMe = async () => { ME = (await api('/auth/me')).user; };
// The page's outline shown while a new page loads (it keeps the footer at the bottom too).
// Beginner guides ("How this page works") on the more advanced pages: the small text file loads once
// in the background, then each page adds its guide before it is shown.
// Notes about how the site is set up (a missing key, "not set up on this server", "Admin → Keys")
// are for the owner. For everyone else such a line becomes one plain sentence, wherever it appears.
const SETUP_NOTE = /\b[A-Z][A-Z0-9]{2,}_(?:[A-Z0-9]+_)*(?:KEY|SECRET|TOKEN|ID|URL|FROM)\b|Admin\s*→|\bon (?:this|the) server\b|\bthe owner (?:adds|needs|sets)\b/;
let setupTimer = null;
function hideSetupNotes() {
  if (!ME || ME.role === 'admin') return;
  for (const el of $$('#view p, #view li, #view small, #view .banner, #view .mu, #view .err')) {
    if (el.dataset.setup || el.closest('pre, code, [data-keep-setup]')) continue;
    const t = el.textContent; if (t.length < 12 || t.length > 700 || !SETUP_NOTE.test(t)) continue;
    if (el.querySelector('input, select, textarea, button, form, p, li, table')) continue;
    el.dataset.setup = '1'; el.textContent = 'This is not available yet.';
  }
}
new MutationObserver(() => { clearTimeout(setupTimer); setupTimer = setTimeout(hideSetupNotes, 60); }).observe(document.body, { childList: true, subtree: true });
let GUIDES = null;
const guidesP = import('./pages/guides.js').then(m => (GUIDES = m)).catch(() => null);
function addGuide(view, route) {
  const opts = { practice: state.account === 'paper' };
  if (GUIDES) return GUIDES.pageGuide(view, route, opts);
  guidesP.then(m => m && view.isConnected && m.pageGuide(view, route, opts));
}
const SKELETON = '<div class="skel"><div class="h1"></div><div class="box"></div><div class="w60"></div><div></div><div class="box"></div></div>';
async function render(opts) {
  const quiet = opts?.quiet === true;
  swrOn = !quiet; // a normal draw may use remembered data (see api); a quiet redraw always fetches
  if (!quiet) render.startedAt = Date.now();
  while (cleanups.length) { try { cleanups.pop()(); } catch {} }
  const [route, q] = (location.hash.slice(2) || 'dashboard').split('?');
  if (PREFETCH && route === 'pf-wait') return; // the hidden copy waits until it is told to start
  // Each render gets a fresh container: requests still in flight from the previous page then
  // write into a detached element instead of overwriting the page the user moved to.
  if (!render.ver) render.ver = (CFG ? Promise.resolve(CFG) : api('/config').catch(() => null)).then(c => { const v = c?.version; if (v && $('#siteVer')) $('#siteVer').textContent = 'Brightolio ' + v; });
  const view = document.createElement('div');
  // Re-drawing the same page (after pressing a button, saving, switching a tab) keeps the page on
  // screen until the new one is ready, at the same scroll position: nothing flashes empty and the
  // footer never jumps up. Moving to another page shows the loading outline at once and fades in.
  const samePage = route === render.last && !!$('#view').firstElementChild;
  // Only the newest redraw is ever shown: an older one that finishes later is dropped.
  const mine = render.seq = (render.seq || 0) + 1;
  const swap = quiet || samePage;
  if (route !== render.last) { view.className = 'enter'; render.last = route; if (!PREFETCH) countVisit(route); }
  const keepY = scrollY;
  if (swap) { $('#view').style.position = 'relative'; view.style.cssText = 'visibility:hidden;position:absolute;left:0;right:0;top:0'; $('#view').append(view); }
  else {
    view.innerHTML = SKELETON;
    $('#view').replaceChildren(view);
    // A new page starts at the top instead of keeping the previous page's scroll position.
    scrollTo(0, 0);
  }
  if (!ME && !['login', 'login-phone', 'register', 'mfa', 'forgot', 'reset', 'verify', 'open-account'].includes(route)) { location.hash = '#/login'; return; }
  // Signed in, the legal links live at the bottom of the menu: the page has no footer that could move.
  document.body.classList.toggle('signedin', !!ME); document.body.classList.toggle('signedout', !ME);
  $('#top').hidden = !ME; $('#nav').hidden = !ME; $('#tabs').hidden = !ME; $('#closeAllBtn').hidden = !ME;
  // Owner: switch between the full owner view and the view of each plan.
  const va = $('#viewAs'); va.hidden = ME?.role !== 'admin';
  if (!va.hidden) {
    CFG ||= await api('/config').catch(() => ({ plans: {} }));
    const cur = ME.previewPlan ? 'plan:' + ME.previewPlan : ME.previewAdviser === true ? 'mode:adviser' : ME.previewAdviser === false ? 'mode:software' : '';
    va.innerHTML = `<option value="">Owner view (everything)</option><optgroup label="Plans">` + Object.entries(CFG.plans || {}).map(([k, p]) => `<option value="plan:${k}" ${cur === 'plan:' + k ? 'selected' : ''}>View as ${esc(p.name)}</option>`).join('')
      + `</optgroup><optgroup label="Business mode"><option value="mode:software" ${cur === 'mode:software' ? 'selected' : ''}>View as software only</option><option value="mode:adviser" ${cur === 'mode:adviser' ? 'selected' : ''}>View as registered adviser</option></optgroup>`;
    va.classList.toggle('on', !!cur);
    // Previews need the password and a confirmation; going back to the owner view does not.
    va.onchange = async () => {
      const [kind, val] = va.value.split(':'), label = va.selectedOptions[0]?.textContent || '';
      let body = { plan: null };
      if (va.value) {
        const ok = await secureConfirm({ title: label, okText: 'Start preview', html: `<p class="mu">${kind === 'mode' ? 'Pages show the site as it looks in this business mode (fees, wording, what strategies may do). It is a preview for you only: users and real trading keep the current mode.' : 'Menus, limits and upgrade prompts as a user on this plan sees them. Only for you.'} Choose "Owner view" to stop.</p>` });
        if (!ok) { va.value = cur; return; }
        body = { ...(kind === 'plan' ? { plan: val } : { adviser: val === 'adviser' }), confirmed: true, password: ok.password, confirm: ok.confirm };
      }
      try { await api('/admin/preview-plan', { method: 'PUT', body }); } catch (e) { alert(e.message); va.value = cur; return; }
      ME = (await api('/auth/me')).user; CFG = null; render();
    };
  }
  if (!quiet) setMenu(false); // a background refresh leaves an open phone menu open
  $$('#tabs a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === route || ((route === '' || route === 'start') && a.dataset.r === 'dashboard')));
  if (ME) {
    // Signing in for the Android app: back to the app once signed in here.
    if (sessionStorage.getItem('qp_next') === 'handoff') { sessionStorage.removeItem('qp_next'); location.href = '/api/auth/app-handoff'; return; }
    const groups = ME.role === 'admin' ? [adminNav(), ...NAV] : NAV;
    await Promise.all([accounts(), loadPrefs(), loadExtras()]); await defaultAccount();
    if (EXTRAS.voice || $('#voiceBtn')) import('./pages/extras.js').then(m => m.voiceButton(shared)).catch(() => {});
    // Groups start folded; their arrow opens them (remembered). The group holding the current page opens.
    const opened = [...(() => { try { return JSON.parse(localStorage.getItem('qp_nav_open') || '[]'); } catch { return []; } })(), ...$$('#nav .grp.sec[aria-expanded="true"]').map(b => b.dataset.g)];
    const START = await import('./pages/start.js').then(m => m.startDone()).catch(() => true);
    // The menu is built again only when something in it changes (page, plan, add-ons, trading mode):
    // a background refresh of the page never rebuilds it, so a tap on the menu is never lost.
    const navKey = JSON.stringify([route, ME.role, ME.plan, ME.planStatus, ME.previewPlan, ME.previewAdviser, ME.addons, ME.email, ME.trialUsed, START, state.account, TOOL_KEYS.some(k => EXTRAS[k])]);
    if (render.navKey !== navKey || !$('#nav').firstElementChild) {
    render.navKey = navKey;
    const link = ([k, t]) => k == null ? `<div class="navsub">${esc(t)}</div>` : `<a href="#/${k}" class="${k === route ? 'on' : ''}">${icon(k)}${t}</a>`;
    const core = [...CORE.filter(([k]) => k !== 'start' || !START || route === 'start'), ...(TOOL_KEYS.some(k => EXTRAS[k]) ? [['extras', 'My tools']] : [])];
    $('#nav').innerHTML = `<div class="navcore">${core.map(link).join('')}</div>` + groups.map(([g, items]) => { const list = items.filter(([k]) => !(ADDON_PAGES[k] && ME.addons?.[ADDON_PAGES[k]] === false)), open = opened.includes(g) || list.some(([k]) => k === route);
      return `<button type="button" class="grp sec" data-g="${esc(g)}" aria-expanded="${open}"><span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span><span class="gname">${g}</span><span class="gcount" aria-hidden="true">${list.filter(([k]) => k != null).length}</span></button><div class="grpbody" ${open ? '' : 'hidden'}>${list.map(link).join('')}</div>`; }).join('')
      + (isPaid(ME) ? '' : `<a href="#/funding" class="upsell">${icon('star')}${ME.trialUsed ? 'Upgrade to Pro' : 'Try Pro free for 14 days'}</a>`)
      + `<div class="navsec"><div class="grp">Trading mode</div>${modeSwitch()}</div><div class="grp">${esc(ME.email)}</div><a href="#" id="navLogout">${icon('account')}Sign out</a>`
      + `<div class="navfoot"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/risk">Risk</a> · <a href="/contact">Support</a><p>Trading involves risk of loss. Backtests and projections are hypothetical. Brightolio is software, not a broker or investment adviser.</p></div>`;
    wireModeSwitch();
    $('#navLogout').onclick = e => { e.preventDefault(); $('#logout').click(); };
    }
    updateBadge();
  }
  const show = () => { for (const c of [...$('#view').children]) if (c !== view) c.remove(); view.style.cssText = ''; scrollTo(0, keepY); };
  try {
    await loadPrefs();
    // Owner pages open only for admins (the server refuses their data to anyone else too).
    try { await (routes[ownerOnly(route) ? 'dashboard' : route] || routes.dashboard)(view, new URLSearchParams(q)); } finally { if (render.seq === mine) swrOn = false; }
    if (!PREFETCH && ME) addGuide(view, ownerOnly(route) || !routes[route] ? 'dashboard' : route);
    if (swap) {
      if (!view.isConnected) return; // the user moved to another page meanwhile
      if (render.seq !== mine) { view.remove(); return; } // a newer redraw is on its way
      show();
    }
  }
  catch (e) {
    if (quiet) { view.remove(); return; }
    if (swap && (!view.isConnected || render.seq !== mine)) { view.remove(); return; }
    view.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
    if (swap) show();
  }
  finally { if (PREFETCH) parent.postMessage({ qpRendered: route }, location.origin); }
}
window.addEventListener('hashchange', () => render());
// Menu groups open and close from one listener on the menu, so it works even right after a rebuild.
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('.grp.sec'); if (!b) return;
  const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', open); b.nextElementSibling.hidden = !open;
  const set = new Set((() => { try { return JSON.parse(localStorage.getItem('qp_nav_open') || '[]'); } catch { return []; } })()); open ? set.add(b.dataset.g) : set.delete(b.dataset.g);
  try { localStorage.setItem('qp_nav_open', JSON.stringify([...set])); } catch {}
});

// ---------- loading every section in the background ----------
// A few seconds after the app opens, a hidden copy of it opens every section of the menu once, one
// after another; everything they read lands in this app's memory, so each section then opens at
// once. A small card of our own (a ring that fills, with the percentage) shows the progress. The
// copy can only read (no orders, no saving); it runs at most once every 3 minutes, and it stops
// when the tab is hidden.
// The hidden copy is opened together with the app itself, while the app is still opening, and then
// waits: moving it from section to section later never shows the browser's own loading line (it
// only shows while a page opens, and the copy is already open by then).
const PF_SKIP = new Set(['start', 'code', 'quantconnect', 'android', 'leaders', 'admin-agents', 'admin-upgrades', 'admin-yiddish', 'admin-seo']);
addEventListener('message', e => {
  if (e.origin !== location.origin || PREFETCH) return;
  const d = e.data?.qpData; if (!d) return;
  const [path, data] = d, json = JSON.stringify(data);
  SWR.set(path, { at: Date.now(), data, json, ok: true, p: Promise.resolve(data) }); keepSave();
});
let pfQuietUntil = 0;
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => { pfQuietUntil = Date.now() + 2000; }, { capture: true, passive: true });
// Pages a person opens most are remembered on this device (page names only), so a slow or
// metered connection loads just those in the background instead of every section.
function countVisit(route) {
  try { const v = JSON.parse(localStorage.getItem('qp_visits') || '{}'); v[route] = (v[route] || 0) + 1; localStorage.setItem('qp_visits', JSON.stringify(v)); } catch {}
}
function topVisited(n) {
  try { return Object.entries(JSON.parse(localStorage.getItem('qp_visits') || '{}')).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k); } catch { return []; }
}
// Data Saver on, or a slow mobile connection: background loading stays small.
function lightData() {
  const c = navigator.connection; if (!c) return false;
  return !!c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType || '');
}
function pfFrameEarly() {
  if (PREFETCH || location.pathname !== '/app' || $('#pfFrame')) return;
  let known = false; try { known = !!localStorage.getItem('qp_me'); } catch {}
  if (!known && lightData()) return; // a first visit on a slow or metered connection skips it
  // Not when this tab already loaded everything in the last 3 minutes (it would only sit idle).
  try { if (Date.now() - +sessionStorage.getItem('qp_pf') < 180e3) return; } catch {}
  const frame = Object.assign(document.createElement('iframe'), { id: 'pfFrame', title: 'Background loading', tabIndex: -1, src: '/app?prefetch=1#/pf-wait' });
  frame.setAttribute('aria-hidden', 'true'); document.body.append(frame);
}
// The waiting copy starts on the first section when told to (and reads who is signed in again, for
// a sign-in that happened after it opened).
if (PREFETCH) addEventListener('message', async e => {
  if (e.origin !== location.origin || e.source !== parent || !e.data?.qpGo) return;
  if (!ME) await refreshMe().catch(() => {});
  location.hash = '#/' + e.data.qpGo;
});
function prefetchAll() {
  const frame = $('#pfFrame');
  if (PREFETCH || !frame || frame.dataset.used) return;
  // Every way out without loading removes the hidden copy, so it never runs a second app for nothing.
  const skip = () => { frame.remove(); };
  if (!ME || document.hidden) return skip();
  try { if (Date.now() - +sessionStorage.getItem('qp_pf') < 180e3) return skip(); sessionStorage.setItem('qp_pf', Date.now()); } catch {}
  const groups = ME.role === 'admin' ? [adminNav(), ...NAV] : NAV;
  const light = lightData();
  if (light && navigator.connection?.saveData && !topVisited(1).length) return skip();
  const all = light ? [...CORE.slice(0, 5).map(([k]) => k), ...topVisited(6)] : [...CORE, ...groups.flatMap(g => g[1])].map(([k]) => k);
  const list = [...new Set(all)].filter(k => routes[k] && !PF_SKIP.has(k) && !(ADDON_PAGES[k] && ME.addons?.[ADDON_PAGES[k]] === false));
  if (!list.length) return skip();
  frame.dataset.used = '1';
  const bar = document.createElement('div'); bar.id = 'pfbar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Loading your data'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
  // r = 15.9155 makes the ring's length 100, so the filled part is simply the percentage.
  bar.innerHTML = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="pf-track" cx="18" cy="18" r="15.9155"/><circle class="pf-fill" cx="18" cy="18" r="15.9155" pathLength="100"/></svg><span class="pf-t">Loading your data...</span><b class="pf-n">0%</b>';
  document.body.append(bar);
  let i = 0, timer = null;
  const set = () => { const pct = Math.round(i / list.length * 100); bar.querySelector('.pf-fill').style.strokeDasharray = `${pct} 100`; bar.querySelector('.pf-n').textContent = pct + '%'; bar.setAttribute('aria-valuenow', pct); };
  const finish = () => { clearTimeout(timer); removeEventListener('message', onMsg); frame.remove(); i = list.length; set(); bar.classList.add('done'); setTimeout(() => bar.remove(), 900); };
  const next = () => {
    i++; set();
    if (i >= list.length || document.hidden) return finish();
    clearTimeout(timer); timer = setTimeout(next, 10000); // a section that never finishes is skipped
    try { frame.contentWindow.postMessage({ qpGo: list[i] }, location.origin); } catch { finish(); }
  };
  const later = () => setTimeout(() => (Date.now() < pfQuietUntil ? later() : next()), Math.max(120, pfQuietUntil - Date.now()));
  const onMsg = e => { if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.qpRendered === list[i]) later(); };
  addEventListener('message', onMsg);
  timer = setTimeout(next, 15000);
  try { frame.contentWindow.postMessage({ qpGo: list[0] }, location.origin); } catch { finish(); }
  set();
}

// ---------- live pages: account pages refresh themselves while they are open ----------
// Prices stream live everywhere; balances, positions, orders and similar pages are drawn again
// with fresh data every 20 seconds (and when you come back to the tab), but never while you are
// typing, clicking, have a dialog or a section open, or the tab is hidden.
const LIVE_PAGES = new Set(['dashboard', 'positions', 'orders', 'accounts', 'account', 'money', 'bots', 'schedule', 'signals', 'fleet', 'riskview', 'insights', 'admin', 'admin-users', 'admin-hosting', 'admin-system']);
let lastTouch = Date.now(), hiddenAt = 0, liveBusy = false;
// The user has used the page since it opened (tapped, typed, has a dialog or a field in use): a
// background refresh then leaves the page alone, so nothing they are doing is wiped.
const userBusySince = t => lastTouch > (t || 0) || !!document.querySelector('dialog[open]') || !!document.activeElement?.closest?.('#view input, #view textarea, #view select');
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input']) addEventListener(ev, () => (lastTouch = Date.now()), { passive: true, capture: true });
// A page where the user typed or picked something is never redrawn under them (it would lose it).
addEventListener('input', e => { const v = e.target?.closest?.('#view > div'); if (v) v.dataset.dirty = '1'; }, true);
addEventListener('change', e => { const v = e.target?.closest?.('#view > div'); if (v) v.dataset.dirty = '1'; }, true);
async function liveRefresh() {
  const route = (location.hash.slice(2) || 'dashboard').split('?')[0];
  if (liveBusy || !ME || document.hidden || !LIVE_PAGES.has(route) || PREFS.live === false) return;
  if (Date.now() - lastTouch < 8000 || document.querySelector('#view > div[data-dirty]') || document.querySelector('dialog[open]') || document.querySelector('#view details[open], #view .userMore:not([hidden])')) return;
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select, [contenteditable="true"]')) return;
  liveBusy = true;
  try { await render({ quiet: true }); } finally { liveBusy = false; }
}
setInterval(liveRefresh, 20e3);
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 15e3) liveRefresh(); });

// ---------- news pop-ups: today's headlines about the stocks in the open account ----------
const newsToasts = { list: [], at: 0, acct: null, timer: null, shown: new Set(JSON.parse(sessionStorage.getItem('qp_news_seen') || '[]')) };
const toastsOn = () => { try { return localStorage.getItem('qp_news_toasts') !== '0'; } catch { return true; } };
async function nextNewsToast() {
  if (!ME || !toastsOn() || document.hidden || document.querySelector('.newstoast')) return;
  if (newsToasts.acct !== state.account || Date.now() - newsToasts.at > 10 * 60e3) {
    newsToasts.acct = state.account; newsToasts.at = Date.now();
    newsToasts.list = await api('/wealth/holdings-news?account=' + state.account).catch(() => []);
  }
  const n = newsToasts.list.find(x => !newsToasts.shown.has(x.id));
  if (!n) return;
  newsToasts.shown.add(n.id); try { sessionStorage.setItem('qp_news_seen', JSON.stringify([...newsToasts.shown].slice(-200))); } catch {}
  const t = document.createElement('div'); t.className = 'newstoast'; t.setAttribute('role', 'status');
  t.innerHTML = `<div class="nt-top"><span class="nt-syms" data-no-tr>${n.symbols.map(esc).join(' · ')}</span><span class="mu">${esc(n.source || '')} · ${new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="nt-x" aria-label="Close">×</button></div>
    <a href="${esc(n.url || '#/news')}" target="_blank" rel="noopener" class="nt-head" data-no-tr>${esc(n.headline)}</a>
    <div class="nt-foot"><a href="#/news" class="mu">More news</a><button class="nt-off ghost small">Turn off pop-ups</button></div>`;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const close = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); };
  t.querySelector('.nt-x').onclick = close;
  t.querySelector('.nt-off').onclick = () => { try { localStorage.setItem('qp_news_toasts', '0'); } catch {} close(); };
  let hide = setTimeout(close, 12000);
  t.onmouseenter = () => clearTimeout(hide); t.onmouseleave = () => (hide = setTimeout(close, 5000));
}
// Sponsored news (free plan only): a paid announcement from a listed company, with its "paid
// promotion" disclosure and a link to the stock. Only upgrading turns these off.
async function sponsoredToast() {
  if (!ME || isPaid(ME) || document.hidden || document.querySelector('.newstoast')) return false;
  const { ad } = await api('/sponsored/next').catch(() => ({}));
  if (!ad) return false;
  const t = document.createElement('div'); t.className = 'newstoast sponsored'; t.setAttribute('role', 'status');
  t.innerHTML = `<div class="nt-top"><span class="pill">Sponsored</span><span class="nt-syms" data-no-tr>${esc(ad.symbol)}</span><span class="mu" data-no-tr>${esc(ad.company || '')}${ad.exchange ? ' · ' + esc(ad.exchange) : ''}</span><button class="nt-x" aria-label="Close">×</button></div>
    <b class="nt-head" data-no-tr>${esc(ad.headline)}</b>${ad.body ? `<p class="nt-body" data-no-tr>${esc(ad.body)}</p>` : ''}
    <div class="nt-foot"><a href="#/trade?symbol=${encodeURIComponent(ad.symbol)}" class="nt-buy"><button type="button" class="small">Buy ${esc(ad.symbol)}</button></a>${ad.url ? `<a href="${esc(ad.url)}" target="_blank" rel="noopener sponsored" class="mu">Read more</a>` : ''}<a href="#/funding" class="mu">Hide sponsored news: upgrade</a></div>
    <p class="nt-disc mu" data-no-tr>${esc(ad.disclosure)}</p>`;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const close = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); };
  t.querySelector('.nt-x').onclick = close;
  t.querySelectorAll('.nt-buy, a[rel~=sponsored]').forEach(a => a.addEventListener('click', () => { api('/sponsored/' + ad.id + '/click', { body: {} }).catch(() => {}); close(); }));
  let hide = setTimeout(close, 15000);
  t.onmouseenter = () => clearTimeout(hide); t.onmouseleave = () => (hide = setTimeout(close, 6000));
  return true;
}
let toastTick = 0;
const nextToast = async () => { if (++toastTick % 4 === 0 && await sponsoredToast()) return; nextNewsToast(); };
if (!PREFETCH) setTimeout(() => { nextToast(); newsToasts.timer = setInterval(nextToast, 45000); }, 8000);
// Phone layout: the sidebar becomes a drawer opened from the header or the bottom "Menu" tab.
function setMenu(open) {
  $('#nav').classList.toggle('open', open); $('#scrim').hidden = !open;
  $('#menuBtn').setAttribute('aria-expanded', open); document.body.classList.toggle('noscroll', open);
}
$('#menuBtn').onclick = () => setMenu(!$('#nav').classList.contains('open'));
$('#moreTab').onclick = e => { e.preventDefault(); setMenu(!$('#nav').classList.contains('open')); };
$('#scrim').onclick = () => setMenu(false);
addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

// On phones, tables render as stacked cards. Each cell gets its column name as a label; a
// MutationObserver keeps labels on tables that pages re-render (e.g. auto-refreshing orders).
function labelTables(root) {
  for (const t of root.querySelectorAll('table:not(.chain):not(.heat):not([data-labeled])')) {
    const head = [...t.rows].find(r => r.querySelector('th'));
    if (!head) continue;
    const names = [];
    for (const th of head.cells) for (let i = 0; i < (th.colSpan || 1); i++) names.push(th.textContent.trim());
    for (const r of t.rows) {
      if (r === head) { r.classList.add('head'); continue; }
      let i = 0;
      for (const td of r.cells) { if (names[i]) td.dataset.label = names[i]; i += td.colSpan || 1; }
    }
    t.classList.add('stack'); t.dataset.labeled = '1';
  }
}
new MutationObserver(() => { labelTables($('#view')); attachGlossary($('#view')); }).observe($('#view'), { childList: true, subtree: true });
// Shows which Alpaca account trading goes to (sandbox, paper or live).
let badgeAt = 0;
async function updateBadge(force) {
  if (!force && Date.now() - badgeAt < 60e3) return;
  badgeAt = Date.now();
  // Any brokerage the user connected (Alpaca, Schwab, tastytrade, Tradier, TradeStation).
  const list = (await api('/accounts').catch(() => [])).filter(a => a.id !== 'paper' && a.connected), b = $('#connBadge');
  b.onclick = () => { location.hash = '#/brokers'; }; b.style.cursor = 'pointer'; b.title = 'Choose your brokerage';
  if (!list.length) { b.textContent = 'No brokerage connected'; b.className = 'pill'; return; }
  const live = list.some(a => a.live), first = list.find(a => a.live) || list[0];
  b.innerHTML = `<span class="long">${esc(first.name)}${list.length > 1 ? ` +${list.length - 1}` : ''} · </span>${live ? 'LIVE' : 'Test money'}`;
  b.className = 'pill' + (live ? ' warn' : '');
}
// "Close all positions", on every page: the account in view, after a typed confirmation.
$('#closeAllBtn').onclick = async () => {
  if (!ME) return;
  await accounts();
  const acct = (ACCTS?.list || []).find(a => a.id === state.account) || { id: state.account, name: state.account };
  const live = !!acct.live;
  const ok = await secureConfirm({ title: 'Close all positions', word: 'CLOSE', okText: 'Close all positions',
    html: `<p>This sells <b>everything</b> in <b>${esc(acct.name || acct.id)}</b> at the market price and cancels its open orders.${live ? ' <b class="warn">This is a real-money account.</b>' : ''}</p><p class="mu">To freeze your account instead, use Lock under Security &amp; help.</p>` });
  if (!ok) return;
  try {
    const r = await api('/positions/close-all', { body: { account: acct.id, confirmWord: ok.typed, password: ok.password, confirm: ok.confirm } });
    alert(`${r.closed} position${r.closed === 1 ? '' : 's'} closed in ${r.account}.${r.failed.length ? ` Not closed: ${r.failed.map(f => `${f.symbol} (${f.error || 'refused'})`).join(', ')}.` : ''}`);
    render();
  } catch (e) { alert(e.message); }
};
// Calm mode (default on): no flashing prices or celebratory effects.
const setCalm = on => { document.body.classList.toggle('calm', on); try { localStorage.setItem('qp_calm', on ? '1' : '0'); } catch {} };
setCalm((() => { try { return localStorage.getItem('qp_calm') !== '0'; } catch { return true; } })());
$('#logout').onclick = async () => { keepClear(); await api('/auth/logout', { body: {} }); ME = null; location.href = '/'; };

// Paper or live, chosen once in the side panel for every page. "Live" is the brokerage account
// (Alpaca, or another connected broker picked in the list under it).
function modeSwitch() {
  const live = (ACCTS?.list || []).filter(a => a.id !== 'paper' && (a.connected || a.id === 'alpaca'));
  const isLive = state.account !== 'paper';
  return `<div class="modeswitch"><div class="seg" id="modeSeg"><button class="${isLive ? '' : 'on'}" data-mode="paper">Paper</button><button class="${isLive ? 'on live' : ''}" data-mode="live">Live</button></div>
    ${isLive && live.filter(a => a.connected).length > 1 ? `<select id="liveAcct" aria-label="Live account">${live.filter(a => a.connected).map(a => `<option value="${a.id}" ${a.id === state.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}</div>`;
}
function setAccount(id) { state.account = id; try { localStorage.setItem('qp_account', id); if (id !== 'paper') localStorage.setItem('qp_live_account', id); } catch {} render(); }
function wireModeSwitch() {
  $$('#modeSeg button').forEach(b => (b.onclick = () => {
    if (b.dataset.mode === 'paper') return setAccount('paper');
    let last = 'alpaca'; try { last = localStorage.getItem('qp_live_account') || 'alpaca'; } catch {}
    setAccount((ACCTS?.list || []).some(a => a.id === last && a.connected) ? last : 'alpaca');
  }));
  if ($('#liveAcct')) $('#liveAcct').onchange = e => setAccount(e.target.value);
}

// ---------- auth ----------
// "Continue with Google" (shown only when the server has Google sign-in set up).
const G_LOGO = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const GH_LOGO = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>';
// Google and GitHub buttons, each shown only when the server has it set up.
async function oauthButtons(verb) {
  CFG ||= await api('/config').catch(() => null);
  let ref = null; try { ref = localStorage.getItem('qp_ref'); } catch {}
  const q = ref ? '?ref=' + encodeURIComponent(ref) : '';
  const b = [CFG?.google ? `<a class="gbtn" href="/auth/google${q}">${G_LOGO}<span>${verb} with Google</span></a>` : '', CFG?.github ? `<a class="gbtn ghbtn" href="/auth/github${q}">${GH_LOGO}<span>${verb} with GitHub</span></a>` : ''].join('');
  return b ? `<div class="oauth">${b}</div><div class="or"><span>or</span></div>` : '';
}
routes.login = async (view, q) => {
  const g = await oauthButtons('Continue');
  view.innerHTML = `
  <div class="hero"><h1 data-no-tr>Bright<span style="color:var(--ac)">olio</span></h1><p class="mu">Backtest, paper trade and automate stock strategies. Connect your brokerage, trade by text or phone.</p></div>
  <form class="card auth"><h2>Sign in</h2>${g}
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button>Sign in</button><div class="err"></div>
    ${window.PublicKeyCredential ? '<button type="button" class="ghost" id="pkLogin" style="width:100%;margin-top:8px">Sign in with a passkey</button>' : ''}
    <p class="mu"><a href="#/forgot">Forgot password?</a> · New here? <a href="#/register">Create an account</a></p></form>`;
  if (q.get('error')) $('.err', view).textContent = q.get('error');
  if ($('#pkLogin', view)) act($('#pkLogin', view), async () => {
    const o = await api('/auth/passkey/options', { body: {} });
    const response = await getPasskey(o);
    ME = (await api('/auth/passkey/verify', { body: { challengeId: o.challengeId, response } })).user; location.hash = '#/dashboard';
  });
  act($('button', view), async () => {
    const r = await api('/auth/login', { body: form(view) });
    if (r.mfaRequired) { location.hash = '#/mfa'; return; }
    ME = r.user; location.hash = '#/dashboard';
  });
};
routes.register = async (view, q) => {
  const g = await oauthButtons('Sign up');
  view.innerHTML = `
  <form class="card auth"><h2>Create account</h2>
    ${g ? g.replace('<div class="or">', '<p class="mu small-print">By continuing with Google or GitHub you agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a> and have read the <a href="/risk" target="_blank">Risk Disclosure</a>.</p><div class="or">') : ''}
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password (10+ chars, upper, lower, digit)<input name="password" type="password" autocomplete="new-password" required></label>
    <label><input type="checkbox" name="agree" style="width:auto"> I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a> and have read the <a href="/risk" target="_blank">Risk Disclosure</a>.</label>
    <button>Create account</button><div class="err"></div>
    <p class="mu">You start with a $100,000 paper account. <a href="#/login">Sign in instead</a></p></form>`;
  if (q.get('email')) { view.querySelector('[name=email]').value = q.get('email'); view.querySelector('[name=password]').focus(); }
  act($('button', view), async () => {
    const f = form(view);
    if (!f.agree) throw new Error('Please accept the Terms to continue');
    let ref = null; try { ref = localStorage.getItem('qp_ref'); } catch {}
    ME = (await api('/auth/register', { body: { ...f, ref } })).user; location.hash = '#/start';
  });
};
// Sign in with a code sent by text message to a verified phone number.
routes['login-phone'] = view => {
  let phone = '';
  view.innerHTML = `<form class="card auth" id="ph"><h2>Sign in by text message</h2><p class="mu">For accounts with a verified phone number (Settings → Phone).</p>
    <label>Phone number<input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="845 555 1234" required></label>
    <button>Text me a code</button><div class="err"></div><p class="mu"><a href="#/login">Back to sign in</a></p></form>
    <form class="card auth" id="pc" hidden><h2>Enter the code</h2><p class="mu" id="pcNote">We sent a 6-digit code if this number has an account.</p>
    <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
    <button>Sign in</button><div class="err"></div></form>`;
  act($('#ph button', view), async () => {
    phone = form($('#ph', view)).phone;
    const r = await api('/auth/phone/start', { body: { phone } });
    $('#ph', view).hidden = true; $('#pc', view).hidden = false;
    if (r.devCode) $('#pcNote', view).textContent = `Test mode (texts are off): your code is ${r.devCode}`;
    $('#pc [name=code]', view).focus();
  });
  act($('#pc button', view), async () => {
    const r = await api('/auth/phone/verify', { body: { phone, code: form($('#pc', view)).code } });
    if (r.mfaRequired) { location.hash = '#/mfa'; return; }
    ME = r.user; location.hash = '#/dashboard';
  });
};
routes.forgot = view => {
  view.innerHTML = `<form class="card auth" id="fe"><h2>Reset your password</h2><p class="mu">Enter your email and we will send you a reset link.</p>
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <button>Send reset link</button><div class="err"></div>
    <p class="mu">No email? <a href="#" id="byPhone">Get a code by text message</a> (for accounts with a verified phone). · <a href="#/login">Back to sign in</a></p></form>
    <form class="card auth" id="fp" hidden><h2>Reset by text message</h2>
    <label>Phone number<input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="845 555 1234" required></label>
    <button>Text me a code</button><div class="err"></div>
    <div id="fpCode" hidden><label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
      <label>New password (10+ chars, upper, lower, digit)<input name="password" type="password" autocomplete="new-password"></label>
      <button type="button" id="fpSave">Save password</button><div class="err"></div></div>
    <p class="mu"><a href="#/login">Back to sign in</a></p></form>`;
  const fe = $('#fe', view), fp = $('#fp', view);
  $('#byPhone', view).onclick = e => { e.preventDefault(); fe.hidden = true; fp.hidden = false; };
  act($('button', fe), async () => {
    const r = await api('/auth/forgot', { body: { email: fe.email.value } });
    if (r.unavailable) throw new Error('Reset emails are not available right now. Use a text message code, or write to support from the Contact page.');
    return 'If that email has an account, a reset link is on its way. Check your spam folder too.';
  });
  act($('button', fp), async () => {
    const r = await api('/auth/forgot', { body: { phone: fp.phone.value } });
    if (r.unavailable) throw new Error('Text messages are not available right now. Use the email link instead.');
    $('#fpCode', fp).hidden = false; fp.code.focus();
    return r.devCode ? `Test mode (texts are off): your code is ${r.devCode}` : 'If that number belongs to an account, a code is on its way.';
  });
  act($('#fpSave', fp), async () => {
    await api('/auth/reset', { body: { phone: fp.phone.value, code: fp.code.value, password: fp.password.value } });
    setTimeout(() => (location.hash = '#/login'), 1500);
    return 'Password changed. You can sign in now.';
  });
};
routes.reset = (view, q) => {
  view.innerHTML = `<form class="card auth"><h2>Choose a new password</h2>
    <label>New password (10+ chars, upper, lower, digit)<input name="password" type="password" autocomplete="new-password" required></label>
    <button>Save password</button><div class="err"></div></form>`;
  act($('button', view), async () => { await api('/auth/reset', { body: { ...form(view), token: q.get('token') } }); setTimeout(() => (location.hash = '#/login'), 1500); return 'Password changed. You can sign in now.'; });
};
routes.verify = async (view, q) => {
  try { await api('/auth/verify', { body: { token: q.get('token') } }); if (ME) ME.emailVerified = true; view.innerHTML = `<div class="card auth"><h2>Email confirmed</h2><p><a href="#/dashboard">Continue</a></p></div>`; }
  catch (e) { view.innerHTML = `<div class="card auth"><h2>Link problem</h2><p class="err">${esc(e.message)}</p></div>`; }
};
routes.mfa = view => {
  view.innerHTML = `<form class="card auth"><h2>Two-factor code</h2><p class="mu">Open your authenticator app.</p>
    <label>6-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
    <button>Verify</button><div class="err"></div></form>`;
  act($('button', view), async () => { ME = (await api('/auth/mfa', { body: form(view) })).user; location.hash = '#/dashboard'; });
};

// ---------- portfolio ----------
// For changes that matter (upgrades, "View as"): the password (or email, for Google/GitHub
// sign-ins), a tick box and, for upgrades, the word UPGRADE. Resolves with the fields or null.
function secureConfirm({ title, html = '', word = null, okText = 'Confirm' }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog'); d.className = 'secure';
    const pw = ME?.hasPassword !== false;
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${html}
      ${pw ? '<label>Your password<input type="password" name="password" autocomplete="current-password" required></label>' : `<label>Type your email address<input type="email" name="confirm" autocomplete="off" required dir="ltr"></label>`}
      ${word ? `<label>Type <b>${esc(word)}</b> to confirm<input name="typed" autocomplete="off" required pattern="${esc(word)}|${esc(word.toLowerCase())}"></label>` : ''}
      <label class="check"><input type="checkbox" name="ok" required> I understand what this changes</label>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="ghost" value="no" formnovalidate>Cancel</button><button value="yes">${esc(okText)}</button></div></form>`;
    document.body.append(d);
    d.onclose = () => { const f = form(d.querySelector('form')); resolve(d.returnValue === 'yes' ? { password: f.password, confirm: f.confirm, typed: f.typed } : null); d.remove(); };
    d.showModal();
  });
}
// Ready-made strategies waiting for the user's approval today ("Approve each trade").
// Monthly statement (PDF) for the account in view.
function statementRow(account) {
  const ym = new Date().toISOString().slice(0, 7);
  return `<form class="row statement" id="stmt" style="margin-top:10px;align-items:flex-end;gap:8px"><label style="max-width:180px">Monthly statement<input type="month" name="month" value="${ym}" max="${ym}"></label>
    <a id="stmtGo" href="/api/statement?account=${encodeURIComponent(account)}&month=${ym}" download><button type="button" class="ghost small">Download PDF</button></a></form>`;
}
function wireStatement(view, account) {
  const f = $('#stmt', view); if (!f) return;
  f.month.onchange = () => { $('#stmtGo', view).href = `/api/statement?account=${encodeURIComponent(account)}&month=${f.month.value}`; };
  f.onsubmit = e => e.preventDefault();
}
async function approvalsBanner() {
  const p = await api('/library/pending').catch(() => []);
  return p.length ? `<div class="banner approvals">${p.map(x => `<span><b>${esc(x.name)}</b> is ready: ${x.orders.slice(0, 3).map(o => `${o.side.toUpperCase()} ${o.qty} <span data-no-tr>${esc(o.ticker)}</span>`).join(', ')}${x.orders.length > 3 ? '…' : ''} <a href="#/strategy?id=${x.id}">Review and approve</a></span>`).join('')}</div>` : '';
}
// Home: one row of boxes (value, today, total P/L, cash) for every Alpaca account and every group
// of accounts the user made, and the total of all of them. Filled in after the page shows.
async function accountBoxes(box) {
  if (!box) return;
  const list = (await accounts()).filter(x => /^alpaca/.test(x.id) && x.connected);
  const groups = list.length ? await api('/combined/groups').catch(() => []) : [];
  if (list.length < 2 && !groups.length) return;
  const d = await api('/combined?view=all&history=0').catch(() => null);
  if (!d || !box.isConnected) return;
  const sum = ids => { const rs = d.accounts.filter(a => a.counted && ids.includes(a.id)); return { equity: rs.reduce((t, a) => t + (a.equity || 0), 0), dayPl: rs.reduce((t, a) => t + (a.dayPl || 0), 0), unrealized: rs.reduce((t, a) => t + (a.unrealized || 0), 0), cash: rs.reduce((t, a) => t + (a.cash || 0), 0), n: rs.length }; };
  const tile = (title, sub, v, href, dim = '') => `<a class="acctbox ${dim}" href="${href}"><div class="ab-head"><b>${esc(title)}</b><span class="mu small-print">${esc(sub)}</span></div>
    <div class="ab-stats"><div><span>Value</span><b>${money(v.equity)}</b></div><div><span>Today</span><b class="${cls(v.dayPl)}">${v.dayPl == null ? '-' : money(v.dayPl)}</b></div><div><span>Total P/L</span><b class="${cls(v.unrealized)}">${money(v.unrealized)}</b></div><div><span>Cash</span><b>${money(v.cash)}</b></div></div></a>`;
  const t = d.totals, canEq = d.accounts.filter(a => a.counted).length >= 2;
  // Equalize now: the same mix in every chosen account (settings on All accounts).
  box.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Your accounts</h2><div class="row" style="gap:10px;align-items:center">${canEq ? '<button type="button" class="small" id="eqNow" title="Give every chosen account the same mix of holdings and cash">Equalize now</button>' : ''}<a href="#/accounts">All accounts →</a></div></div>
    <div id="eqNowOut"></div>
    <div class="acctboxes">
      ${tile('All accounts', `${t.count} counted · ${d.live ? 'real money' : 'test money'}`, { equity: t.equity, dayPl: t.dayPl, unrealized: t.unrealized, cash: t.cash }, '#/accounts', 'total')}
      ${groups.map(g => { const v = sum(g.accounts); return tile(g.name, `group · ${v.n} account${v.n === 1 ? '' : 's'}`, v, `#/accounts?view=g:${g.id}`); }).join('')}
      ${d.accounts.map(a => tile(a.label, a.counted ? (a.number || a.id) : (a.why || 'not added'), { equity: a.equity, dayPl: a.dayPl, unrealized: a.unrealized, cash: a.cash }, `#/accounts`, a.counted ? '' : 'dim')).join('')}
    </div></div>`;
  const eb = $('#eqNow', box);
  if (eb) eb.onclick = async () => { eb.disabled = true; try { await (await import('./pages/combined.js')).equalizeNow(shared, $('#eqNowOut', box)); } finally { eb.disabled = false; } };
}
// A live clock on Home: the time here to the second, and the time at the New York exchange with
// the market's state. The state comes from the server's market calendar (/desk/session: NYSE
// holidays, 1 PM early closes, pre-market and after-hours), checked again whenever an open or a
// close passes; until it answers, New York's weekday and time are worked out here.
function nyParts(t) {
  // The New York wall time as plain numbers (never a 12-hour hour some browsers return).
  const w = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return { weekday: w.getDay(), minutes: w.getHours() * 60 + w.getMinutes() };
}
function marketState(t, s) {
  if (s && t < s.until) return s;
  const { weekday, minutes } = nyParts(t), wd = weekday >= 1 && weekday <= 5;
  return { status: wd && minutes >= 570 && minutes < 960 ? 'open' : wd && minutes >= 240 && minutes < 570 ? 'pre-market' : wd && minutes >= 960 && minutes < 1200 ? 'after-hours' : 'closed' };
}
const MKT_LABEL = { open: 'market open', 'pre-market': 'pre-market (regular hours from 9:30)', 'after-hours': 'after hours (market closed)', closed: 'market closed' };
function homeClock(view) {
  if (!view || $('#homeClock', view)) return;
  const el = document.createElement('div'); el.id = 'homeClock'; el.className = 'homeclock'; el.setAttribute('role', 'timer'); el.setAttribute('aria-label', 'Current time');
  el.innerHTML = '<b class="hc-time" dir="ltr"></b><span class="hc-date"></span><span class="hc-ny" dir="ltr"></span>';
  const anchor = $('h1', view)?.closest('.row') || $('h1', view);
  anchor ? anchor.after(el) : view.prepend(el);
  const t = el.querySelector('.hc-time'), d = el.querySelector('.hc-date'), ny = el.querySelector('.hc-ny');
  // The calendar's answer holds until the next open or close; then it is asked again.
  let sess = null, asking = false;
  const ask = () => {
    if (asking) return; asking = true;
    api('/desk/session').then(r => {
      const now = Date.now(), until = Math.min(...[r.nextOpen, r.nextClose].filter(x => x > now), now + 600e3);
      const label = r.open ? 'market open' + (r.earlyClose ? ' (closes early, 1 PM)' : '') : r.holiday ? 'market closed (holiday)' : MKT_LABEL[r.status] || MKT_LABEL.closed;
      sess = { status: r.open ? 'open' : r.status, label, until };
    }).catch(() => {}).finally(() => { asking = false; });
  };
  ask();
  const tick = () => {
    if (!el.isConnected) return stop();
    const n = new Date();
    t.textContent = n.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const day = n.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); if (d.textContent !== day) d.textContent = day;
    if (sess && n.getTime() >= sess.until) { sess = null; ask(); }
    const m = marketState(n.getTime(), sess), open = m.status === 'open';
    ny.textContent = 'New York ' + n.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' · ' + (m.label || MKT_LABEL[m.status]);
    ny.classList.toggle('open', open);
  };
  // Each tick lands just after the second changes, so the seconds never skip or lag.
  let timer = null; const loop = () => { tick(); timer = setTimeout(loop, 1000 - Date.now() % 1000 + 5); };
  const stop = () => clearTimeout(timer);
  loop(); onLeave(stop);
}
routes.dashboard = async (view, q) => {
  await accounts();
  if (state.account === 'alpaca') { await routes.portfolio(view, q); return homeClock(view); }
  const approvalsP = approvalsBanner().catch(() => '');
  const a = await api('/account?account=' + state.account).catch(e => ({ error: e.message }));
  if (a.error) {
    view.innerHTML = `<h1>Portfolio</h1><div class="card"><p class="err">${esc(a.error)}</p><a href="#/settings">Open Settings</a></div>`;
    return;
  }
  const base = a.startCash ?? a.history[0]?.equity ?? a.equity;
  const pnl = a.equity - base, pnlPct = base ? pnl / base * 100 : 0;
  // Today's change: Alpaca reports yesterday's close; for paper use the last snapshot before today.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const prev = a.lastEquity || [...a.history].reverse().find(x => x.day < today)?.equity;
  const dayChg = prev ? a.equity - prev : null;
  const steps = [[!!localStorage.getItem('qp_seen_strategies'), 'Try a ready-made strategy', '#/strategies'], [ME.totpEnabled, 'Turn on two-factor login', '#/settings'], [a.positions.length > 0 || state.account !== 'paper', 'Place your first paper trade', '#/dashboard'],
    [ME.phoneVerified && ME.hasPin, 'Add your phone and PIN for SMS', '#/settings'], [!!sessionStorage.getItem('qp_strategy'), 'Backtest a strategy', '#/backtest']];
  const START = await import('./pages/start.js').then(m => m.startDone()).catch(() => true);
  const fresh = !START && state.account === 'paper' && a.positions.length === 0;
  const todo = !fresh && steps.filter(x => !x[0]).length > 1 && !localStorage.getItem('qp_onboard_done');
  const approvals = await approvalsP, P = PREFS.portfolio;
  const since = P.mode !== 'live' ? sinceStat(await sinceLastLook(state.account, a.equity)) : '';
  view.innerHTML = `${approvals}
  ${fresh ? `<div class="card onboard welcome-hero"><div><h2>Welcome! Let's get you started</h2><p class="mu" style="margin:0">A 2-minute guided setup: what you want to do, how practice money works, and your first practice purchase. Nothing uses real money.</p></div><a href="#/start"><button type="button">Start the guided setup</button></a></div>` : ''}
  ${todo ? `<div class="card onboard"><div class="ob-head"><div><h2>Get started</h2><p class="mu">${steps.filter(x => x[0]).length} of ${steps.length} done</p></div><button class="ghost small" id="hideOnboard">Hide</button></div>
    <div class="ob-bar"><i style="width:${Math.round(steps.filter(x => x[0]).length / steps.length * 100)}%"></i></div>
    <div class="ob-list">${steps.map(([done, t, href]) => `<a class="ob-item${done ? ' done' : ''}" href="${href}"><span class="ob-check" aria-hidden="true"></span><span class="ob-t">${t}</span><span class="ob-go" aria-hidden="true">→</span></a>`).join('')}</div></div>` : ''}
  <div class="row" style="justify-content:space-between"><h1>Portfolio ${a.live ? '<span class="pill warn">LIVE MONEY</span>' : state.account === 'paper' ? '<span class="pill">Paper</span>' : '<span class="pill">Live account, test money</span>'}</h1></div>
  <div class="card">
    <div class="stats">
      <div class="stat"><span>Equity</span><b data-k="eq">${money(a.equity)}</b></div>
      <div class="stat"><span>Profit / loss</span><b data-k="pnl" class="${cls(pnl)}">${money(pnl)} (${pct(pnlPct, 2)})</b></div>
      ${P.hideToday ? '' : `<div class="stat"><span>Today</span><b data-k="day" class="${cls(dayChg)}">${dayChg == null ? '-' : `${money(dayChg)} (${pct(dayChg / prev * 100, 2)})`}</b></div>`}
      ${since}
      <div class="stat"><span>Cash</span><b data-k="cash">${money(a.cash)}</b></div>
      <div class="stat"><span>Positions</span><b>${a.positions.length}</b></div>
    </div>
    <canvas id="eqc"></canvas>
    ${statementRow(state.account)}
  </div>
  <div id="acctBoxes"></div>
  <div class="grid">
    <div class="card"><h2>Positions</h2><div class="tablewrap"><table><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>Price</th><th>Value</th><th>P/L</th></tr>
      ${a.positions.map(p => `<tr><td>${esc(p.symbol)}</td><td>${num(p.qty, 4)}</td><td>${money(p.avgPrice)}</td><td>${money(p.price)}</td><td>${money(p.value)}</td><td class="${cls(p.pnl)}">${money(p.pnl)}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No positions</td></tr>'}
    </table></div></div>
    ${ticketHtml(a)}
  </div>
  <div class="card"><h2>Recent orders</h2><div class="tablewrap" id="orders"><p class="mu">Loading…</p></div>
    ${state.account === 'paper' ? '<button class="ghost small" id="reset">Reset paper account</button>' : ''}</div>`;
  homeClock(view);
  if ($('#hideOnboard', view)) $('#hideOnboard', view).onclick = () => { try { localStorage.setItem('qp_onboard_done', '1'); } catch {} render(); };
  drawChart($('#eqc', view), a.history.map(x => x.equity), { base, dates: a.history.map(x => x.day), legend: false });
  wireStatement(view, state.account); accountBoxes($('#acctBoxes', view)).catch(() => {});
  // Live mode: the numbers update quietly every minute (never the whole page).
  if (P.mode !== 'since') {
    const acct = state.account, t = setInterval(async () => {
      if (document.hidden || !$('[data-k=eq]', view)) return;
      const b = await api('/account?account=' + acct).catch(() => null); if (!b || b.error) return;
      const pl = b.equity - base, prv = b.lastEquity || prev, dc = prv ? b.equity - prv : null;
      const set = (k, txt, c) => { const el = $(`[data-k=${k}]`, view); if (el && el.textContent !== txt) el.textContent = txt; if (el && c !== undefined) el.className = c; };
      set('eq', money(b.equity)); set('pnl', `${money(pl)} (${pct(base ? pl / base * 100 : 0, 2)})`, cls(pl)); set('cash', money(b.cash));
      if (dc != null) set('day', `${money(dc)} (${pct(dc / prv * 100, 2)})`, cls(dc));
    }, 60000);
    onLeave(() => clearInterval(t));
  }
  const t = $('#ticket', view);
  wireQuickTicket(t, view, a);
  if ($('#reset', view)) act($('#reset', view), async () => { if (confirm('Reset paper account to $100,000?')) { await api('/paper/reset', { body: {} }); render(); } });
  const orders = await api('/orders?account=' + state.account).catch(() => []);
  $('#orders', view).innerHTML = `<table><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Status</th><th>Source</th></tr>${orders.map(o => `<tr><td>${date(o.at)}</td><td>${esc(o.symbol)}</td><td>${o.side}</td><td>${o.qty ? num(o.qty, 4) : money(o.notional)}</td><td>${o.price ? money(o.price) : '-'}</td><td>${esc(o.status)}${o.orderId ? ` <button class="small ghost" data-pcancel="${o.orderId}">Cancel</button>` : ''}</td><td>${esc(o.source || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">None yet</td></tr>'}</table>`;
  $$('[data-pcancel]', view).forEach(b => act(b, async () => { await api('/paper/orders/' + b.dataset.pcancel, { method: 'DELETE' }); render(); return ''; }));
};

// The order ticket used on Home and on the simple Trade page (paper and the other brokerages).
const ticketHtml = (a, symbol = 'SPY') => `<form class="card ticket" id="ticket"><h2>Trade</h2>
      <div id="deskStrip"></div>
      <div class="row"><label>Symbol<input name="symbol" value="${esc(symbol)}" required autocomplete="off" dir="ltr"></label>
        <label>Order type<select name="type">${['market', 'limit', 'stop', 'stop_limit'].map(t => `<option value="${t}">${{ market: 'Market', limit: 'Limit', stop: 'Stop', stop_limit: 'Stop limit' }[t]}</option>`).join('')}</select></label></div>
      <div class="seg" id="qSide"><button type="button" class="buy on" data-s="buy">Buy</button><button type="button" class="sell" data-s="sell">Sell</button></div><input type="hidden" name="side" value="buy">
      <div id="qHold"></div>
      <div class="row"><label>Shares<input name="qty" type="number" step="any" min="0"></label><label class="qnot">or Dollars<input name="notional" type="number" step="any" min="0"></label></div>
      <div class="row qpx"><label class="qlim" hidden>Limit price<input name="limit_price" type="number" step="any" min="0"></label><label class="qstp" hidden>Stop price<input name="stop_price" type="number" step="any" min="0"></label><label class="qtif" hidden>Good for<select name="time_in_force"><option value="day">Today (Day)</option><option value="gtc">Until cancelled (GTC)</option></select></label></div>
      <label class="check qshort" hidden><input type="checkbox" name="allow_short"> ${state.account === 'paper' ? 'Sell short (practice money: no minimum balance)' : 'Sell short (I do not own it; margin account with $2,000+ needed)'}</label>
      <div id="qGuide"></div><div id="qCost"></div><div id="qBear"></div>
      <button id="qPlace">Review order</button> <button type="button" class="ghost" id="quote">Quote</button><div class="err"></div>
      ${a.live ? '<p class="warn">This sends a real order with real money.</p>' : ''}
    </form>`;
// The quick ticket: order types, the desk strip, a guide to the chosen type, costs, what the
// account holds (with "Sell all") and, for sells of something not held, the alternatives.
function wireQuickTicket(t, view, a) {
  const st = { side: 'buy', type: 'market', last: null };
  let tmr = null, seq = 0;
  const refresh = async () => {
    const f = form(t), sym = f.symbol.trim().toUpperCase(); if (!sym) return;
    const my = ++seq;
    const d = await api(`/desk/quote/${encodeURIComponent(sym)}?account=${state.account}&side=${st.side}&type=${st.type}&qty=${+f.qty || (f.notional && st.last ? f.notional / st.last : 0)}&price=${+f.limit_price || +f.stop_price || ''}`).catch(e => ({ error: e.message }));
    if (my !== seq || !$('#qGuide', t)) return;
    if (d.error) { $('#deskStrip', t).innerHTML = `<p class="err">${esc(d.error)}</p>`; return; }
    st.last = d.price; st.hold = d.holding;
    $('#deskStrip', t).innerHTML = OD.deskStrip(d);
    $('#qHold', t).innerHTML = OD.holdingLine(d.holding, sym, st.side);
    $('#qGuide', t).innerHTML = OD.guide(st.type, st.side, d.price, f.limit_price, f.stop_price);
    $('#qCost', t).innerHTML = OD.costBox(d.costs, st.side);
    $('#qBear', t).innerHTML = st.side === 'sell' && !(d.holding?.qty > 0) ? OD.bearishAlternatives(sym) : '';
    const all = $('#sellAll', t); if (all) all.onclick = () => { t.qty.value = d.holding.available ?? d.holding.qty; t.notional.value = ''; schedule(); };
  };
  const schedule = () => { clearTimeout(tmr); tmr = setTimeout(refresh, 300); };
  const layout = () => {
    const ty = st.type, lim = ty === 'limit' || ty === 'stop_limit', stp = ty === 'stop' || ty === 'stop_limit';
    $('.qlim', t).hidden = !lim; $('.qstp', t).hidden = !stp; $('.qtif', t).hidden = ty === 'market'; $('.qnot', t).hidden = ty !== 'market';
    if (ty !== 'market') t.notional.value = '';
    if ($('.qshort', t)) $('.qshort', t).hidden = st.side !== 'sell';
    $('#qPlace', t).className = st.side === 'sell' ? 'danger' : '';
  };
  $$('#qSide button', t).forEach(b => (b.onclick = () => { st.side = b.dataset.s; t.side.value = st.side; $$('#qSide button', t).forEach(x => x.classList.toggle('on', x === b)); layout(); schedule(); }));
  t.type.onchange = () => { st.type = t.type.value; layout(); schedule(); };
  t.oninput = e => { if (e.target.name !== 'type') schedule(); };
  layout(); refresh();
  act($('#qPlace', t), async () => {
    const f = form(t); for (const k of Object.keys(f)) if (f[k] === '' || f[k] === false) delete f[k];
    f.symbol = f.symbol.trim().toUpperCase(); f.type = st.type; f.side = st.side;
    if (!(+f.qty > 0) && !(+f.notional > 0)) throw new Error('Enter shares or dollars');
    if (st.side === 'sell' && !f.allow_short && st.hold && +f.qty > (st.hold.available ?? st.hold.qty) + 1e-9) throw new Error(st.hold.qty > 0 ? `You can sell up to ${st.hold.available ?? st.hold.qty} ${f.symbol}` : `You do not own ${f.symbol} in this account`);
    const what = `${f.side.toUpperCase()} ${f.qty ? f.qty + ' shares of' : money(+f.notional) + ' of'} ${f.symbol} · ${OD.ORDER_TYPES[st.type].name}${f.limit_price ? ' limit ' + money(+f.limit_price) : ''}${f.stop_price ? ' stop ' + money(+f.stop_price) : ''}${st.type !== 'market' ? ' · ' + (f.time_in_force === 'gtc' ? 'GTC' : 'Day') : ''}`;
    if (!confirm(`${a.live ? 'LIVE ORDER WITH REAL MONEY\n' : ''}${what}\n\nPlace this order?`)) return '';
    if (f.allow_short) { f.allowShort = true; f.allow_short = true; }
    let r;
    if (st.type !== 'market' && state.account === 'alpaca') r = await api('/alpaca/orders', { body: { ...f, time_in_force: f.time_in_force || 'day' } });
    // Limit orders go to every brokerage; stop orders only where they are supported here.
    else if (!['market', 'limit'].includes(st.type) && state.account !== 'paper') throw new Error('Stop orders on this account: use the brokerage\'s own app for now. Market and limit orders work here.');
    else r = await api('/orders', { body: { ...f, account: state.account } });
    setTimeout(render, 900);
    return `${r.side || f.side} ${r.symbol || f.symbol}: ${r.status}${r.price ? ' @ ' + money(r.price) : r.fillPrice ? ' @ ' + money(r.fillPrice) : ''}`;
  });
  act($('#quote', t), async () => { await refresh(); return st.last ? `${form(t).symbol.toUpperCase()} ${money(st.last)}` : ''; });
}

// Settings → Taxes: state, filing status and income set the rates automatically each year.
async function taxSettings(f) {
  const d = await api('/taxrates'), p = d.profile, r = d.rates;
  const pc = x => (x * 100).toFixed(x * 100 % 1 ? 2 : 0) + '%';
  $('#taxBox', f).innerHTML = `<div class="row"><label>State<select name="state"><option value="">Pick…</option>${d.states.map(s => `<option ${s === p.state ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>City (optional)<input name="city" value="${esc(p.city || '')}"></label></div>
    <div class="row"><label>Filing status<select name="filing">${Object.entries(d.filing).map(([k, t]) => `<option value="${k}" ${k === p.filing ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Yearly income before deductions ($)<input name="income" type="number" min="0" step="1000" value="${p.income || ''}"></label></div>
    <label class="check"><input type="checkbox" name="auto" ${p.auto !== false ? 'checked' : ''}> Set my rates automatically and update them every January</label>
    ${r ? `<div class="stats">${['Federal bracket', 'Long-term gains', 'State', 'Net investment income tax'].map((k, i) => `<div class="stat"><span>${k}</span><b>${[pc(r.federal), pc(r.longTerm), pc(r.stateRate), r.niit ? '3.8%' : 'None'][i]}</b></div>`).join('')}</div>
      <p class="mu small-print">${r.year} ${r.estimated ? 'rates estimated from last year\'s tables indexed for inflation (the official tables are added when the IRS publishes them)' : 'IRS tables'}; standard deduction ${money(r.standardDeduction)}. ${esc(r.stateNote)}. Estimates for planning, not tax advice.</p>` : ''}
    <div id="manualTax" ${p.auto !== false && p.state ? 'hidden' : ''}><div class="row"><label>Federal bracket (manual)<select name="bracket">${[0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37].map(b => `<option value="${b}" ${b === ME.taxBracket ? 'selected' : ''}>${b * 100}%</option>`).join('')}</select></label><label>State rate % (manual)<input name="stateTax" type="number" step="0.1" value="${(ME.stateTax * 100).toFixed(2)}"></label></div></div>
    <button>Save</button><div class="err"></div>`;
  f.auto.onchange = () => ($('#manualTax', f).hidden = f.auto.checked);
  act($('button', f), async () => {
    const v = form(f);
    if (v.auto) { if (!v.state) throw new Error('Pick your state'); await api('/taxrates', { method: 'PUT', body: { state: v.state, city: v.city, filing: v.filing, income: +v.income, auto: true } }); }
    else { if (v.state) await api('/taxrates', { method: 'PUT', body: { state: v.state, city: v.city, filing: v.filing, income: +v.income, auto: false } }); await api('/tax/settings', { body: { bracket: +v.bracket, stateTax: v.stateTax / 100 } }); }
    await refreshMe(); setTimeout(() => taxSettings(f), 300); return 'Saved';
  });
}

// ---------- backtest + AI builder ----------
routes.backtest = async (view, q) => {
  CFG ||= await api('/config');
  const s = JSON.parse(sessionStorage.getItem('qp_strategy') || 'null') || { symbol: 'SPY', ...CFG.presets['SMA cross'], sl: 0, tp: 0, ts: 0, size: 100 };
  view.innerHTML = `
  <h1>Backtest</h1>
  ${CFG.marketData ? '' : '<div class="banner">No market-data key on the server: backtests use synthetic prices until you connect Alpaca in Settings.</div>'}
  <div class="card"><h2>Describe a strategy in plain English ${CFG.ai ? `<span class="pill">AI · ${esc(CFG.aiModel?.free ? 'free' : 'Claude')}</span>` : ''}</h2>
    <div class="row"><label style="flex:4">Idea<input id="idea" placeholder="Buy AAPL when RSI drops below 30 in an uptrend, 8% stop loss"></label><button id="build">Build rules</button></div><div class="err"></div><p id="explain" class="mu"></p></div>
  <form class="card" id="bt">
    <div class="row">
      <label>Symbol<input name="symbol" value="${esc(s.symbol)}"></label>
      <label>Start<input name="start" type="date" value="${s.start || '2016-01-01'}"></label>
      <label>Capital<input name="capital" type="number" value="${s.capital || 10000}"></label>
      <label>Preset<select id="preset"><option value="">-</option>${Object.keys(CFG.presets).map(k => `<option>${esc(k)}</option>`).join('')}</select></label>
    </div>
    <div class="row">
      <label style="flex:1 1 300px">Entry rules (all must be true)<textarea name="entry">${esc(s.entry)}</textarea></label>
      <label style="flex:1 1 300px">Exit rules (any)<textarea name="exit">${esc(s.exit)}</textarea></label>
    </div>
    <div class="row">
      <label>Stop loss %<input name="sl" type="number" step="any" value="${s.sl || 0}"></label>
      <label>Take profit %<input name="tp" type="number" step="any" value="${s.tp || 0}"></label>
      <label>Trailing stop %<input name="ts" type="number" step="any" value="${s.ts || 0}"></label>
      <label>Position size %<input name="size" type="number" value="${s.size || 100}"></label>
      <label>Cost per side %<input name="cost" type="number" step="any" value="0.15"></label>
    </div>
    <p class="mu" style="font-size:12px">Indicators: Close, SMA(n), EMA(n), RSI(n), BBU(n,k), BBL(n,k), HIGH(n), LOW(n), ROC(n), MACD(f,s), MACDSIG(f,s,sig). Ops: &gt; &lt; &gt;= &lt;= crosses_above crosses_below.
    Optimizer: put choices in braces, e.g. <code>SMA({10,20,50}) crosses_above SMA({100,200})</code>.</p>
    <button>Run backtest</button> <button type="button" class="ghost" id="save">Save strategy</button><div class="err"></div>
  </form>
  <div id="result"></div>`;
  const f = $('#bt', view);
  $('#preset', view).onchange = e => { const p = CFG.presets[e.target.value]; if (p) { f.entry.value = p.entry; f.exit.value = p.exit; } };
  act($('#build', view), async () => {
    const r = await api('/ai/strategy', { body: { prompt: $('#idea', view).value } });
    f.symbol.value = r.symbol; f.entry.value = r.entry; f.exit.value = r.exit; f.sl.value = r.stopLoss; f.tp.value = r.takeProfit; f.ts.value = r.trailingStop;
    $('#explain', view).textContent = `${r.name}: ${r.explanation}`;
    return 'Rules filled in below. Run the backtest to check them.';
  });
  act($('#save', view), async () => {
    const name = prompt('Name this strategy', f.symbol.value + ' strategy'); if (!name) return;
    await api('/strategies', { body: { ...form(f), name } }); return 'Saved. Deploy it from Strategies & Bots.';
  });
  act($('button', f), async () => {
    const body = form(f); sessionStorage.setItem('qp_strategy', JSON.stringify(body));
    const r = await api('/backtest', { body });
    $('#result', view).innerHTML = r.optimize ? optimizeHtml(r.optimize) : resultHtml(r);
    if (!r.optimize) drawChart($('#btc', view), r.curve.map(x => x.eq), { base: +body.capital, compare: r.curve.map(x => x.bh) });
  });
  // Edit while you look: after the first run, changing any input re-runs the backtest.
  let ran = false, tmr;
  f.addEventListener('submit', e => e.preventDefault());
  $('button', f).addEventListener('click', () => (ran = true));
  f.addEventListener('input', () => { if (!ran) return; clearTimeout(tmr); tmr = setTimeout(() => { if (f.isConnected && /^#\/backtest/.test(location.hash)) $('button', f).click(); }, 700); });
  if (q.get('run')) $('button', f).click();
};
function resultHtml(r) {
  const m = r.m, p = r.projection, w = r.walkForward;
  return `<div class="card"><h2>${esc(r.symbol)} results ${r.source === 'synthetic' ? '<span class="pill warn">synthetic data</span>' : ''}</h2>
    <div class="stats">
      <div class="stat"><span>Total return</span><b class="${cls(m.ret)}">${pct(m.ret)}</b></div>
      <div class="stat"><span>Buy & hold</span><b class="${cls(m.bh)}">${pct(m.bh)}</b></div>
      <div class="stat"><span>CAGR</span><b class="${cls(m.cagr)}">${pct(m.cagr)}</b></div>
      <div class="stat"><span>Max drawdown</span><b class="${cls(-m.dd)}">-${num(m.dd, 1)}%</b></div>
      <div class="stat"><span>Sharpe / Sortino</span><b>${num(m.sharpe)} / ${num(m.sortino)}</b></div>
      <div class="stat"><span>Volatility</span><b>${num(m.vol, 1)}%</b></div>
      <div class="stat"><span>Trades / win rate</span><b>${m.trades} / ${num(m.win, 0)}%</b></div>
      <div class="stat"><span>Profit factor</span><b>${num(m.profitFactor)}</b></div>
      <div class="stat"><span>Time in market</span><b>${num(m.exposure, 0)}%</b></div>
    </div>
    <canvas id="btc"></canvas><p class="mu" style="font-size:12px">Colored line: strategy. Grey: buy & hold. Dashed: starting capital. ${r.holding ? 'Currently in a position.' : 'Currently flat.'}</p></div>
  <div class="grid">
    ${p ? `<div class="card"><h2>Projected next-year return</h2>
      <p class="mu" style="font-size:13px">2,000 simulated years built by resampling this strategy's own daily returns. A range of outcomes, not a promise.</p>
      <div class="stats">
        <div class="stat"><span>Bad year (5th pct)</span><b class="${cls(p.p5)}">${pct(p.p5)}</b></div>
        <div class="stat"><span>Typical (median)</span><b class="${cls(p.median)}">${pct(p.median)}</b></div>
        <div class="stat"><span>Good year (95th)</span><b class="${cls(p.p95)}">${pct(p.p95)}</b></div>
        <div class="stat"><span>Chance of a loss</span><b>${num(p.probLoss, 0)}%</b></div>
      </div></div>` : ''}
    ${w ? `<div class="card"><h2>Walk-forward check</h2><p class="mu" style="font-size:13px">Beat buy & hold in ${num(w.beatRate, 0)}% of out-of-sample periods.</p>
      <div class="tablewrap"><table><tr><th>Period</th><th>Strategy</th><th>Buy & hold</th><th>Max DD</th></tr>
      ${w.folds.map(x => `<tr><td>${esc(x.from)} → ${esc(x.to)}</td><td class="${cls(x.ret)}">${pct(x.ret)}</td><td class="${cls(x.bh)}">${pct(x.bh)}</td><td>-${num(x.dd, 1)}%</td></tr>`).join('')}</table></div></div>` : ''}
  </div>
  <div class="card"><h2>Trades</h2><div class="tablewrap"><table><tr><th>Entry</th><th>Exit</th><th>Buy</th><th>Sell</th><th>P/L</th><th>Reason</th></tr>
    ${r.trades.slice().reverse().map(t => `<tr><td>${esc(t.entryDate)}</td><td>${esc(t.exitDate)}</td><td>${num(t.entry)}</td><td>${num(t.exit)}</td><td class="${cls(t.pnlPct)}">${pct(t.pnlPct)}</td><td>${esc(t.reason)}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No closed trades</td></tr>'}
  </table></div></div>`;
}
function optimizeHtml(o) {
  return `<div class="card"><h2>Optimizer (${o.runs} combinations)</h2><p class="mu">${esc(o.note)}</p><div class="tablewrap"><table>
    <tr><th>Entry</th><th>Exit</th><th>In-sample Sharpe</th><th>In-sample return</th><th>Out-of-sample Sharpe</th><th>Out-of-sample return</th></tr>
    ${o.best.map(b => `<tr><td><code>${esc(b.entry)}</code></td><td><code>${esc(b.exit)}</code></td><td>${num(b.inSharpe)}</td><td class="${cls(b.inRet)}">${pct(b.inRet)}</td><td>${num(b.oosSharpe)}</td><td class="${cls(b.oosRet)}">${pct(b.oosRet)}</td></tr>`).join('')}
  </table></div></div>`;
}

// ---------- saved strategies / bots ----------
routes.bots = async view => {
  const [list, accts] = await Promise.all([api('/strategies'), accounts()]);
  CFG ||= await api('/config').catch(() => ({}));
  const freqName = { daily: 'daily', '1Hour': 'hourly', '15Min': 'every 15 min' };
  view.innerHTML = `<h1>Strategies & Bots</h1>
  <div class="banner">A deployed bot checks its rules once a day shortly before the 4 pm New York close, or every hour or 15 minutes, and buys or sells on the chosen account. Crypto bots (e.g. BTC/USD) run around the clock. Text BOTS to see them, PAUSE &lt;PIN&gt; to stop all, or use the kill switch on the Risk page.</div>
  <div class="card tablewrap"><table><tr><th>Name</th><th>Symbol</th><th>Entry</th><th>Exit</th><th>Running on</th><th>Last action</th><th></th></tr>
  ${list.map(s => `<tr data-id="${s.id}"><td>${esc(s.name)}${s.public ? ' <span class="pill">published</span>' : ''}</td><td>${esc(s.symbol)}</td><td><code>${esc(s.entry)}</code></td><td><code>${esc(s.exit)}</code></td>
    <td>${s.deployed ? `<span class="pill ${s.deployed === 'paper' ? '' : 'warn'}">${esc(s.deployed)} · ${freqName[s.freq || 'daily']}</span>` : '<span class="mu">off</span>'}</td><td>${esc(s.last_action || '')}</td>
    <td class="nowrap"><button class="small ghost" data-do="test">Backtest</button> ${s.deployed ? '<button class="small danger" data-do="stop">Stop</button>' : '<button class="small" data-do="run">Run…</button>'} <button class="small ghost" data-do="pub">${s.public ? 'Unpublish' : 'Publish'}</button> <button class="small ghost" data-do="del">Delete</button></td></tr>
    <tr class="runrow" data-for="${s.id}" hidden><td colspan="7"><form class="row"><label>Account<select name="account">${accountOptions(accts, 'paper', isPaid(ME))}</select></label>
      <label>Check<select name="freq"><option value="daily">Once a day, before the close</option><option value="1Hour" ${CFG.marketData ? '' : 'disabled'}>Every hour</option><option value="15Min" ${CFG.marketData ? '' : 'disabled'}>Every 15 minutes</option></select></label><button data-do="deploy">Start bot</button></form></td></tr>`).join('') || '<tr><td colspan="7" class="mu">Save a strategy from the Backtest page, the AI assistant or the Marketplace.</td></tr>'}
  </table><div class="err" id="botErr"></div></div>`;
  $$('button[data-do]', view).forEach(b => (b.onclick = async e => {
    e.preventDefault();
    const tr = b.closest('tr'), id = tr.dataset.id || tr.dataset.for, s = list.find(x => x.id == id), d = b.dataset.do;
    try {
      if (d === 'test') { sessionStorage.setItem('qp_strategy', JSON.stringify(s)); location.hash = '#/backtest?run=1'; return; }
      if (d === 'run') { const r = $(`tr[data-for="${id}"]`, view); r.hidden = !r.hidden; return; }
      if (d === 'del') { if (!confirm('Delete?')) return; await api('/strategies/' + id, { method: 'DELETE' }); }
      else if (d === 'pub') {
        const desc = s.public ? undefined : prompt('Describe this strategy for others (optional)', s.description || '');
        if (!s.public && desc === null) return;
        await api(`/market/strategies/${id}/publish`, { body: { public: !s.public, description: desc } });
      } else if (d === 'deploy') {
        const f = form(b.closest('form'));
        if (f.account !== 'paper' && !confirm('This bot will place orders on that account automatically. Continue?')) return;
        await api(`/strategies/${id}/deploy`, { body: f });
      } else await api(`/strategies/${id}/deploy`, { body: { account: null } });
      render();
    } catch (e) { $('#botErr', view).textContent = e.message; }
  }));
};

// ---------- QuantConnect ----------
routes.quantconnect = async view => {
  const integ = await api('/integrations');
  if (!integ.quantconnect.connected) {
    view.innerHTML = `<h1>Cloud algorithms</h1><div class="card"><p>Run full LEAN algorithms (Python or C#, multi-asset, universe selection, options, futures) in QuantConnect's cloud with institutional data.</p>
      <p class="mu">Connect your QuantConnect user id and API token in <a href="#/settings">Settings</a>. Find them at quantconnect.com → Account → API Access.</p></div>`;
    return;
  }
  const [projects, templates] = await Promise.all([api('/qc/projects'), api('/qc/templates')]);
  view.innerHTML = `<h1>Cloud algorithms</h1>
  <form class="card" id="newp"><h2>New cloud project</h2>
    <div class="row"><label>Template<select name="template">${templates.map(t => `<option>${esc(t)}</option>`).join('')}<option value="">Paste my own code…</option></select></label><label>Name<input name="name" placeholder="My algorithm"></label></div>
    <label>Python code (only when pasting your own)<textarea name="code" rows="8" placeholder="from AlgorithmImports import *"></textarea></label>
    <button>Create project</button><div class="err"></div></form>
  <div class="card"><h2>Your projects</h2><div class="tablewrap"><table><tr><th>Name</th><th>Language</th><th>Modified</th><th></th></tr>
    ${projects.map(p => `<tr data-id="${p.id}"><td>${esc(p.name)}</td><td>${esc(p.language)}</td><td>${esc(p.modified)}</td><td><button class="small" data-do="run">Backtest</button> <button class="small ghost" data-do="list">Results</button></td></tr>`).join('')}
  </table></div><div class="err" id="qcErr"></div></div><div id="qcOut"></div>`;
  act($('button', $('#newp', view)), async () => { const r = await api('/qc/projects', { body: form($('#newp', view)) }); setTimeout(render, 800); return 'Created project ' + r.id; });
  const out = $('#qcOut', view);
  const show = async (pid, bid) => {
    const b = await api(`/qc/projects/${pid}/backtests/${bid}`);
    out.innerHTML = `<div class="card"><h2>${esc(b.name)} ${b.completed ? '' : `<span class="pill">${num(b.progress * 100, 0)}%</span>`}</h2>${b.error ? `<pre class="err">${esc(b.error)}</pre>` : ''}
      <div class="stats">${Object.entries(b.statistics).map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>`;
    if (!b.completed && !b.error) setTimeout(() => location.hash === '#/quantconnect' && show(pid, bid), 4000);
  };
  $$('button[data-do]', view).forEach(btn => (btn.onclick = async () => {
    const pid = btn.closest('tr').dataset.id;
    btn.disabled = true; $('#qcErr', view).textContent = '';
    try {
      if (btn.dataset.do === 'run') { const r = await api(`/qc/projects/${pid}/backtest`, { body: {} }); await show(pid, r.backtestId); }
      else {
        const list = await api(`/qc/projects/${pid}/backtests`);
        out.innerHTML = `<div class="card"><h2>Backtests</h2>${list.map(b => `<p><a href="#" data-b="${esc(b.id)}">${esc(b.name)}</a> <span class="mu">${esc(b.created)}</span></p>`).join('') || '<p class="mu">None yet</p>'}</div>`;
        $$('a[data-b]', out).forEach(a => (a.onclick = e => { e.preventDefault(); show(pid, a.dataset.b); }));
      }
    } catch (e) { $('#qcErr', view).textContent = e.message; }
    btn.disabled = false;
  }));
};

// ---------- scheduled trades + alerts ----------
routes.schedule = async view => {
  const [rows, alerts, accts] = await Promise.all([api('/schedule'), api('/alerts'), accounts()]);
  // New York date and time for the form (orders run at exchange time, whatever the browser's zone).
  const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const when = o => {
    const t = o.run_minutes != null ? `${String(Math.floor(o.run_minutes / 60)).padStart(2, '0')}:${String(o.run_minutes % 60).padStart(2, '0')} ET` : '';
    const rep = { once: 'Once', daily: 'Every weekday', weekly: o.weekdays ? o.weekdays.split(',').map(d => DAYS[+d]).join(', ') : 'Weekly', monthly: o.month_day ? `Monthly on the ${o.month_day}` : 'Monthly' }[o.repeat] || o.repeat;
    return `${rep}${t ? ' at ' + t : ''}`;
  };
  view.innerHTML = `<h1>Scheduled trades</h1>
  <form class="card" id="sch"><h2>New scheduled order</h2>
    <div class="row"><label>Account<select name="account">${accountOptions(accts, 'paper', isPaid(ME))}</select></label>
      <label>Side<select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
      <label>Symbol<input name="symbol" value="SPY" autocomplete="off"></label>
      <label>Shares<input name="qty" type="number" step="any"></label><label>or Dollars<input name="notional" type="number" step="any" value="100"></label></div>
    <div class="row"><label>Date<input name="date" type="date" value="${ny}" min="${ny}"></label>
      <label>Time (New York)<input name="time" type="time" value="09:35" step="60"></label>
      <label>Quick pick<select id="preset"><option value="">Choose…</option><option value="09:30">At the open (9:30)</option><option value="09:35">Just after the open (9:35)</option><option value="12:00">Midday (12:00)</option><option value="15:50">Before the close (15:50)</option><option value="08:00">Pre-market (8:00, limit + extended)</option><option value="17:00">After hours (17:00, limit + extended)</option></select></label>
      <label>Repeat<select name="repeat"><option value="once">Once</option><option value="daily">Every weekday</option><option value="weekly" selected>On chosen weekdays</option><option value="monthly">Monthly on this date</option></select></label></div>
    <div id="wdRow" style="display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin:2px 0 12px"><span class="mu">Weekdays:</span>${[1, 2, 3, 4, 5].map(d => `<label class="chk"><input type="checkbox" name="wd" value="${d}" ${d === new Date(ny + 'T12:00').getDay() || (d === 1 && [0, 6].includes(new Date(ny + 'T12:00').getDay())) ? 'checked' : ''}> ${DAYS[d]}</label>`).join('')}</div>
    <div class="row"><label>Order type<select name="orderType"><option value="market">Market</option><option value="limit">Limit</option></select></label>
      <label id="lpL" hidden>Limit price<input name="limitPrice" type="number" step="any"></label>
      <label class="chk" id="exL" hidden><input type="checkbox" name="extended"> Extended hours (4:00–9:30 and 16:00–20:00, Alpaca)</label></div>
    <p class="mu" style="font-size:12.5px;margin:4px 0 10px">Times are New York (exchange) time. Market orders run during the regular session (9:30–16:00); a time outside it runs at the next open. Limit orders with extended hours can run pre-market and after hours on an Alpaca account.</p>
    <button>Schedule</button><div class="err"></div></form>
  <div class="card tablewrap"><table><tr><th>#</th><th>Order</th><th>Account</th><th>When</th><th>Next run</th><th>Last result</th><th></th></tr>
    ${rows.map(o => `<tr class="${o.active ? '' : 'mu'}"><td>${o.id}</td><td>${o.side} ${o.qty ? num(o.qty, 4) : money(o.notional)} ${esc(o.symbol)}${o.order_type === 'limit' ? ` · limit ${money(o.limit_price)}${o.extended ? ' · ext. hours' : ''}` : ''}</td><td>${esc(o.account)}</td><td>${esc(when(o))}</td><td>${o.active ? new Date(o.next_run).toLocaleString([], { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'done'}</td><td>${esc(o.last_result || '')}</td><td>${o.active ? `<button class="small ghost" data-c="${o.id}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">No scheduled trades yet</td></tr>'}
  </table></div>
  <form class="card" id="al"><h2>Price alerts (sent by SMS)</h2>
    <div class="row"><label>Symbol<input name="symbol" value="AAPL"></label><label>When price is<select name="op"><option>above</option><option>below</option></select></label><label>Price<input name="price" type="number" step="any"></label><button>Add alert</button></div><div class="err"></div>
    <table>${alerts.map(a => `<tr class="${a.active ? '' : 'mu'}"><td>${esc(a.symbol)} ${a.op} ${money(a.price)}</td><td>${a.active ? 'watching' : 'triggered'}</td><td><button class="small ghost" data-a="${a.id}">Remove</button></td></tr>`).join('')}</table></form>`;
  const sf = $('#sch', view), sync = () => {
    $('#wdRow', view).hidden = sf.repeat.value !== 'weekly';
    const lim = sf.orderType.value === 'limit'; $('#lpL', view).hidden = !lim; $('#exL', view).hidden = !lim;
  };
  sf.repeat.onchange = sf.orderType.onchange = sync; sync();
  $('#preset', view).onchange = e => {
    if (!e.target.value) return; sf.time.value = e.target.value;
    const ext = /^(08|17)/.test(e.target.value); if (ext) { sf.orderType.value = 'limit'; sf.extended.checked = true; } sync();
  };
  act($('button', sf), async () => {
    const f = form(sf), weekdays = $$('[name=wd]:checked', view).map(c => +c.value);
    const r = await api('/schedule', { body: { account: f.account, side: f.side, symbol: f.symbol, qty: f.qty, notional: f.notional, date: f.date, time: f.time, repeat: f.repeat, weekdays, orderType: f.orderType, limitPrice: f.limitPrice, extended: sf.extended.checked } });
    setTimeout(render, 900);
    return 'Scheduled. First run ' + new Date(r.nextRun).toLocaleString([], { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' New York time.';
  });
  act($('button', $('#al', view)), async () => { await api('/alerts', { body: form($('#al', view)) }); render(); });
  $$('[data-c]', view).forEach(b => (b.onclick = async () => { await api('/schedule/' + b.dataset.c, { method: 'DELETE' }); render(); }));
  $$('[data-a]', view).forEach(b => (b.onclick = async e => { e.preventDefault(); await api('/alerts/' + b.dataset.a, { method: 'DELETE' }); render(); }));
};

// ---------- text & hotline ----------
// Text commands and the Phone hotline: two pages (Automation menu) built from the same parts.
routes.hotline = view => routes.text(view, new URLSearchParams('mode=phone'));
routes.text = async (view, q) => {
  CFG ||= await api('/config');
  const phone = q?.get('mode') === 'phone';
  const { help } = await api('/command/help');
  view.innerHTML = `<h1>${phone ? 'Phone hotline' : 'Text commands'}</h1><p class="mu" style="margin-top:-4px">${phone ? 'Call Brightolio from your verified phone: hear your account, positions and the market, and place or cancel trades with your PIN.' : 'Text Brightolio from your verified phone: look up stocks, get your account and positions, and trade with your PIN.'} <a href="#/${phone ? 'text' : 'hotline'}">${phone ? 'Text commands' : 'Phone hotline'} →</a></p>
  ${isPaid(ME) ? '' : '<div class="banner">Texting and calling Brightolio is part of Pro. You can try the commands below here in the app; <a href="#/funding">start a free trial</a> to use them from your phone and get alerts by text.</div>'}
  <div class="grid">
    <div class="card"><h2>Manage your account by SMS or phone</h2>
      ${CFG.hotline ? `<div class="hotline"><span class="mu">Brightolio's number</span><b dir="ltr">${esc(CFG.hotline)}</b><div class="row" style="gap:8px"><a href="sms:${esc(CFG.hotline)}"><button type="button">Text us</button></a><a href="tel:${esc(CFG.hotline)}"><button type="button" class="ghost">Call</button></a></div></div>
        <p>Text or call from your verified phone.</p>${CFG.assistant ? '<p>The AI assistant understands plain language: "how am I doing this month?", "put $200 into the S&amp;P every week", "what does RSI mean?". Trades always need your PIN.</p>' : ''}` : '<p class="warn">The SMS/voice number is not configured on this server yet (Twilio).</p>'}
      <p class="mu"><span>Phone:</span> ${ME.phone ? `<span dir="ltr">${esc(ME.phone)}</span>` : '<span>not set</span>'} ${ME.phoneVerified ? '<span class="pill">verified</span>' : ''} · <span>PIN:</span> <span>${ME.hasPin ? 'set' : 'not set'}</span> · <a href="#/settings">change in Settings</a></p>
      ${phone ? '' : `<pre>${esc(help)}</pre>`}
      <p class="mu" ${phone ? '' : 'hidden'}>On the phone line: press 1 for paper or 2 for live, then 1 account info, 2 positions, 3 market clock, 4 place a trade, 5 cancel orders, 6 close all, 9 switch account. Every change needs your PIN.</p></div>
    <div class="card" ${phone ? 'hidden' : ''}><h2>Look up any stock</h2>
      <p class="mu" style="margin-top:0">Text a ticker and a word. Try any stock!</p>
      <div class="lookups">${[['AAPL CHART', '1 week, 1 month and 1 year performance'], ['NVDA EARNINGS', 'Next earnings date, estimates and the last results'], ['TSLA NEWS', 'The latest headlines'], ['SPY', 'Price and this week\'s move']].map(([c, d]) => `<button type="button" class="lookup" data-cmd="${c}"><b data-no-tr>${c}</b><span>${d}</span></button>`).join('')}</div>
      <h3 style="margin:18px 0 6px">Try it here</h3>
      <div class="row"><input id="cmd" placeholder="${CFG.assistant ? 'AAPL CHART, or: how is my account doing?' : 'AAPL CHART'}" style="flex:1;margin:0"><button id="send">Send</button></div><div class="err"></div><pre id="reply" class="smsreply" hidden></pre></div>
  </div>`;
  act($('#send', view), async () => { const r = $('#reply', view); r.hidden = false; r.textContent = (await api('/command', { body: { text: $('#cmd', view).value } })).reply; });
  $$('.lookup', view).forEach(b => (b.onclick = () => { $('#cmd', view).value = b.dataset.cmd; $('#send', view).click(); }));
  $('#cmd', view).onkeydown = e => { if (e.key === 'Enter') $('#send', view).click(); };
};

// ---------- tax ----------
// QuickBooks Online on the tax page: connect, map accounts once, send a month of bookkeeping or
// the tax year as a journal entry.
async function qboCard(view, year, q) {
  const s = await api('/quickbooks').catch(() => null);
  if (!s || !document.body.contains(view)) return;
  const el = document.createElement('div'); el.className = 'card'; el.id = 'qbo';
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter(m => m <= new Date().toISOString().slice(0, 7));
  const sentNote = k => (s.sent[`${state.account}:${k}`] ? ` <span class="pill">sent ${new Date(s.sent[`${state.account}:${k}`].at).toLocaleDateString()}</span>` : '');
  if (!s.connected) {
    el.innerHTML = `<h2>QuickBooks</h2><p class="mu" style="margin-top:0">Send your monthly books and your tax year to QuickBooks Online as journal entries: gains and losses, dividends, interest and broker fees, balanced against your brokerage account.</p>
      ${s.ready ? '<button id="qboGo">Connect QuickBooks</button>' : '<p class="mu">QuickBooks is not set up on this server yet.</p>'}<div class="err"></div>`;
    { const bk = $('#books', view); if (bk) bk.after(el); else view.append(el); }
    if ($('#qboGo', el)) act($('#qboGo', el), async () => { location.href = (await api('/quickbooks/connect')).url; return ''; });
    return;
  }
  const accts = await api('/quickbooks/accounts').catch(e => ({ error: e.message }));
  const opts = k => `<select name="${k}"><option value="">Choose…</option>${(accts.error ? [] : accts).map(a => `<option value="${esc(a.id)}" ${s.map[k] === a.id ? 'selected' : ''}>${esc(a.name)} (${esc(a.type)})</option>`).join('')}</select>`;
  el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">QuickBooks</h2><button class="small ghost" id="qboOff" type="button">Disconnect</button></div>
    <p class="mu">Connected${s.sandbox ? ' (sandbox)' : ''} · company ${esc(s.realm)}. Entries go to the account shown in the menu at the top: ${esc(state.account)}.</p>
    ${accts.error ? `<p class="err">${esc(accts.error)}</p>` : `<form id="qboMap"><h3>Your QuickBooks accounts</h3><div class="row" style="flex-wrap:wrap">${Object.entries(s.mapKeys).map(([k, t]) => `<label>${esc(t)}${opts(k)}</label>`).join('')}</div><button class="small">Save accounts</button><div class="err"></div></form>`}
    <h3>Send</h3><div class="row" style="align-items:flex-end;gap:8px"><label>Month<select id="qboMonth">${months.map(m => `<option value="${m}">${new Date(m + '-15').toLocaleString(undefined, { month: 'long', year: 'numeric' })}</option>`).join('')}</select></label>
      <button id="qboSendM" type="button">Send month (bookkeeping)</button><button id="qboSendY" type="button" class="ghost">Send ${year} (tax year)${sentNote(String(year))}</button></div><div class="err" id="qboErr"></div>
    <p class="mu small-print">A month or a year is sent once; to send it again, delete the entry in QuickBooks first. Your accountant should review entries before closing the books.</p>`;
  { const bk = $('#books', view); if (bk) bk.after(el); else view.append(el); }
  act($('#qboOff', el), async () => { if (!confirm('Disconnect QuickBooks?')) return ''; await api('/quickbooks/disconnect', { body: {} }); render(); return ''; });
  if ($('#qboMap', el)) act($('#qboMap button', el), async () => { await api('/quickbooks/map', { method: 'PUT', body: form($('#qboMap', el)) }); return 'Saved'; });
  const send = async period => { const r = await api('/quickbooks/send', { body: { account: state.account, period } }); return `Sent: QuickBooks journal entry ${r.id}`; };
  act($('#qboSendM', el), () => send($('#qboMonth', el).value), $('#qboErr', el));
  act($('#qboSendY', el), () => send(String(year)), $('#qboErr', el));
}
// Android app: from Google Play when it is listed there (installs and updates like any app),
// otherwise the signed file from GitHub with step-by-step install help.
routes.android = async view => {
  const isAndroid = /Android/i.test(navigator.userAgent);
  CFG ||= await api('/config').catch(() => null);
  const play = CFG?.androidPlay;
  view.innerHTML = `<h1>Android app</h1><div class="card androidcard"><div class="row" style="gap:18px;align-items:center;flex-wrap:wrap">
    <img src="/icon-512.png" width="72" height="72" alt="" style="border-radius:18px"><div style="flex:1;min-width:220px"><h2 style="margin:0">Brightolio for Android</h2>
    <p class="mu" style="margin:4px 0 0">A real Android app: your portfolio, quotes, buying and selling, orders and a watchlist on native screens, with everything else a tap away. Sign in with your email, or with Google, GitHub or a phone code.</p></div>
    ${play ? `<a href="${esc(play)}" target="_blank" rel="noopener" class="playbadge" aria-label="Get it on Google Play"><span>GET IT ON</span><b>Google Play</b></a>` : '<a href="/download/android"><button>Download the Android app</button></a>'}</div>
    ${play ? `<h3>Install</h3><ol class="installsteps"><li>${isAndroid ? 'Tap' : 'On your Android phone, open this page and tap'} <b>Get it on Google Play</b> (or search “Brightolio” in the Play Store).</li><li>Tap <b>Install</b>. The app appears with your other apps and updates itself from the Play Store.</li><li>Open Brightolio and sign in.</li></ol>
      <p class="mu small-print">Can't use Google Play? <a href="/download/android">Download the app file</a> instead.</p>`
    : `<h3>Install (about a minute)</h3><ol class="installsteps">
      <li>${isAndroid ? 'Tap' : 'On your Android phone, open this page and tap'} <b>Download the Android app</b>. If Chrome says the file might be harmful, tap <b>Download anyway</b>: it is the app signed by Brightolio.</li>
      <li>Tap <b>Open</b> when the download finishes (or find <b>brightfolio.apk</b> in Downloads).</li>
      <li>The first time, Android asks to allow your browser to install apps: tap <b>Settings</b>, switch on <b>Allow from this source</b>, then go back.</li>
      <li>Tap <b>Install</b>. If Google Play Protect asks, tap <b>More details → Install anyway</b> (it asks about any app that is not from the Play Store yet).</li>
      <li>Tap <b>Open</b>. Brightolio is now with your other apps; new versions install over it and keep you signed in.</li></ol>
      <p class="mu small-print">Brightolio is on its way to Google Play; once it is listed there this page shows the Play Store button, and installing works like any other app.</p>`}
    <p class="mu small-print">On iPhone: open Brightolio in Safari, tap Share, then Add to Home Screen.</p></div>`;
};
routes.tax = async (view, q) => {
  const year = +(q.get('year') || new Date().getFullYear());
  const [t, bk] = await Promise.all([api(`/tax?account=${state.account}&year=${year}`), api(`/tax/books?account=${state.account}&year=${year}`).catch(() => null)]);
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Tax information</h1></div>
  ${q.get('qbo') ? `<div class="banner${q.get('qbo') === 'connected' ? '' : ' err'}">${q.get('qbo') === 'connected' ? 'QuickBooks is connected. Choose your accounts below, then send.' : esc(q.get('qbo'))}</div>` : ''}
  ${t.ira ? `<div class="banner">This account is marked as a <b>${esc(t.ira.name)}</b>. ${esc(t.ira.note)} <a href="#/retirement">Retirement &amp; IRAs</a></div>` : ''}
  <div class="banner">Estimates for planning only (US federal + flat state rate, FIFO lots). Your broker's 1099-B is the official record; check with a tax professional.</div>
  <div class="card"><div class="row"><label>Year<select id="yr">${[0, 1, 2, 3].map(i => new Date().getFullYear() - i).map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
    <a href="/api/tax?account=${state.account}&year=${year}&format=csv"><button type="button" class="ghost">Download Form 8949 CSV</button></a>
    <a href="/api/tax?account=${state.account}&year=${year}&format=scheduled"><button type="button" class="ghost">Download Schedule D CSV</button></a></div>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><span>Short-term gains</span><b class="${cls(t.shortTerm)}">${money(t.shortTerm)}</b></div>
      <div class="stat"><span>Long-term gains</span><b class="${cls(t.longTerm)}">${money(t.longTerm)}</b></div>
      <div class="stat"><span>Wash-sale disallowed</span><b>${money(t.washSaleDisallowed)}</b></div>
      <div class="stat"><span>Net</span><b class="${cls(t.net)}">${money(t.net)}</b></div>
      <div class="stat"><span>Estimated tax</span><b>${money(t.estimatedTax)}</b></div>
      <div class="stat"><span>Loss carryforward</span><b>${money(t.carryforward)}</b></div>
    </div>
    <p class="mu" style="font-size:13px">Rates used: ordinary ${num(t.bracket * 100, 0)}%, long-term ${num(t.ltRate * 100, 0)}%, state ${num(t.stateRate * 100, 1)}%. Change them in Settings.</p></div>
  ${bk ? `<div class="card" id="books"><div class="row" style="justify-content:space-between;align-items:center"><h2>Monthly bookkeeping</h2>
    <a href="/api/tax/books?account=${state.account}&year=${year}&format=csv"><button type="button" class="ghost">Download books CSV</button></a></div>
    <p class="mu" style="margin-top:0">Every month's trades, gains, dividends, interest and deposits, with how much to set aside for taxes so far this year.</p>
    <div class="tablewrap"><table><tr><th>Month</th><th>Trades</th><th>Short-term</th><th>Long-term</th><th>Dividends</th><th>Interest</th><th>Deposits</th><th>Realized this year</th><th>Set aside so far</th></tr>
    ${bk.months.filter(m => m.trades || m.dividends || m.interest || m.deposits || m.withdrawals).map(m => `<tr><td>${new Date(m.month + '-15').toLocaleString(undefined, { month: 'long' })}</td><td>${m.trades}</td><td class="${cls(m.shortTerm)}">${money(m.shortTerm)}</td><td class="${cls(m.longTerm)}">${money(m.longTerm)}</td><td>${money(m.dividends)}</td><td>${money(m.interest)}</td><td>${money(m.deposits)}</td><td class="${cls(m.ytdRealized)}">${money(m.ytdRealized)}</td><td>${money(m.ytdSetAside)}</td></tr>`).join('') || '<tr><td colspan="9" class="mu">Nothing recorded this year yet</td></tr>'}</table></div>
    <h3 style="margin:16px 0 6px">Estimated tax payments (Form 1040-ES)</h3>
    <div class="stats">${bk.quarters.map(x => `<div class="stat"><span>Q${x.q} · due ${new Date(x.due + 'T12:00').toLocaleDateString()}</span><b>${money(x.estimatedTax)}</b></div>`).join('')}</div>
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="booksMail" ${bk.email ? 'checked' : ''}> Email me last month's books on the 1st of every month</label>
    <p class="mu" style="font-size:12.5px">Set-aside amounts use your rates above and count dividends and interest as ordinary income. You may owe no estimated tax if your withholding covers it; check with a tax professional.</p><div class="err"></div></div>` : ''}
  ${t.scheduleD ? `<div class="card"><h2>Schedule D summary</h2><div class="tablewrap"><table><tr><th>Line</th><th>Lots</th><th>Proceeds</th><th>Cost</th><th>Wash-sale adjustments</th><th>Gain or loss</th></tr>
    <tr><td>1b / 7: Short-term (Form 8949 box A)</td><td>${t.scheduleD.line1b_shortTerm.lots}</td><td>${money(t.scheduleD.line1b_shortTerm.proceeds)}</td><td>${money(t.scheduleD.line1b_shortTerm.cost)}</td><td>${money(t.scheduleD.line1b_shortTerm.adjustments)}</td><td class="${cls(t.scheduleD.line7_netShortTerm)}">${money(t.scheduleD.line7_netShortTerm)}</td></tr>
    <tr><td>8b / 15: Long-term (Form 8949 box D)</td><td>${t.scheduleD.line8b_longTerm.lots}</td><td>${money(t.scheduleD.line8b_longTerm.proceeds)}</td><td>${money(t.scheduleD.line8b_longTerm.cost)}</td><td>${money(t.scheduleD.line8b_longTerm.adjustments)}</td><td class="${cls(t.scheduleD.line15_netLongTerm)}">${money(t.scheduleD.line15_netLongTerm)}</td></tr>
    <tr><td><b>16: Total</b></td><td></td><td></td><td></td><td></td><td class="${cls(t.scheduleD.line16_total)}"><b>${money(t.scheduleD.line16_total)}</b></td></tr>
    ${t.scheduleD.line21_allowedLoss != null ? `<tr><td>21: Loss you can deduct this year</td><td></td><td></td><td></td><td></td><td class="neg">${money(t.scheduleD.line21_allowedLoss)}</td></tr>` : ''}</table></div></div>` : ''}
  ${t.markToMarket ? `<div class="card"><h2>Trader mark-to-market (Section 475(f))</h2><label class="chk"><input type="checkbox" id="mtm" ${t.mtmElection ? 'checked' : ''}> I made the mark-to-market election</label>
    <p class="mu" style="font-size:13px">With the election, gains and losses are ordinary income, open positions are treated as sold at year end, wash-sale rules don't apply and the $3,000 loss limit is lifted. It must be filed with the IRS by the tax deadline for the year before it applies.</p>
    ${t.mtmElection ? `<div class="stats"><div class="stat"><span>Realized</span><b class="${cls(t.markToMarket.realized)}">${money(t.markToMarket.realized)}</b></div><div class="stat"><span>Open positions marked</span><b class="${cls(t.markToMarket.markedToMarket)}">${money(t.markToMarket.markedToMarket)}</b></div><div class="stat"><span>Ordinary income</span><b class="${cls(t.markToMarket.ordinaryIncome)}">${money(t.markToMarket.ordinaryIncome)}</b></div><div class="stat"><span>Estimated tax</span><b>${money(t.markToMarket.estimatedTax)}</b></div></div><p class="mu" style="font-size:12.5px">${esc(t.markToMarket.note)}</p>` : ''}<div class="err"></div></div>` : ''}
  ${t.harvest.length ? `<div class="card"><h2>Tax-loss harvesting ideas</h2>${t.harvest.map(h => `<p><b>${esc(h.symbol)}</b> <span class="neg">${money(h.unrealized)}</span> <span class="mu">${esc(h.note)}</span></p>`).join('')}</div>` : ''}
  <div class="card tablewrap"><h2>Realized sales</h2><table><tr><th>Symbol</th><th>Qty</th><th>Acquired</th><th>Sold</th><th>Proceeds</th><th>Cost</th><th>Gain</th><th>Term</th><th></th></tr>
    ${t.rows.map(r => `<tr><td>${esc(r.symbol)}</td><td>${num(r.qty, 4)}</td><td>${new Date(r.acquired).toLocaleDateString()}</td><td>${new Date(r.sold).toLocaleDateString()}</td><td>${money(r.proceeds)}</td><td>${money(r.cost)}</td><td class="${cls(r.gain)}">${money(r.gain)}</td><td>${r.longTerm ? 'Long' : 'Short'}</td><td>${r.washSale ? '<span class="pill warn">wash sale</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="mu">No sales this year</td></tr>'}
  </table></div>`;
  $('#yr', view).onchange = e => (location.hash = '#/tax?year=' + e.target.value);
  qboCard(view, year, q);
  if ($('#booksMail', view)) $('#booksMail', view).onchange = async e => {
    try { await api('/tax/books/email', { method: 'PUT', body: { on: e.target.checked } }); }
    catch (x) { e.target.checked = !e.target.checked; $('#books .err', view).textContent = x.message; }
  };
  if ($('#mtm', view)) $('#mtm', view).onchange = async e => {
    try { await api('/tax/settings', { body: { bracket: t.bracket, stateTax: t.stateRate, mtm: e.target.checked } }); render(); }
    catch (x) { e.target.closest('.card').querySelector('.err').textContent = x.message; }
  };
};

// ---------- funding & plans ----------
routes.funding = routes.billing = async (view, q) => {
  CFG ||= await api('/config');
  const [ledger, fees, pay, accts, cr, aip] = await Promise.all([api('/ledger'), api('/fees'), api('/funding/methods').catch(() => ({ methods: [], fee: {} })), accounts(), api('/credits').catch(() => null), api('/aiplans').catch(() => null)]);
  let yearly = q.get('interval') === 'year';
  const days = CFG.trialDays || 14, trial = !ME.trialUsed, paid = isPaid(ME);
  const status = ME.planStatus === 'trialing' ? `Free trial · renews ${ME.planRenews ? new Date(ME.planRenews).toLocaleDateString() : ''}` : ME.planStatus === 'past_due' ? 'Payment failed - update your card' : ME.planRenews ? `Renews ${new Date(ME.planRenews).toLocaleDateString()}` : '';
  const draw = () => {
    view.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h1>Plans & billing</h1>${ME.plan !== 'free' ? '<button class="ghost" id="portal">Manage billing</button>' : ''}</div>
    ${q.get('ok') ? '<div class="banner">Thank you! Your plan is being activated. It can take a few seconds to show here.</div>' : ''}
    ${q.get('credits') ? '<div class="banner">Thank you! Your credits are being added. It can take a few seconds to show here.</div>' : ''}
    ${ME.plan !== 'free' ? `<div class="banner">You are on <b>${esc(CFG.plans[ME.plan]?.name || ME.plan)}</b>${ME.planInterval === 'year' ? ' (yearly)' : ''}. ${esc(status)}</div>` : trial ? `<div class="banner">Every paid plan starts with a <b>${days}-day free trial</b>. You won't be charged until it ends, and you can cancel anytime.</div>` : ''}
    <div class="billing-toggle"><div class="seg" id="interval"><button data-i="month" class="${yearly ? '' : 'on'}">Monthly</button><button data-i="year" class="${yearly ? 'on' : ''}">Yearly <span class="save">2 months free</span></button></div></div>
    <div class="plans">${Object.entries(CFG.plans).map(([k, p]) => {
      const price = yearly ? p.yearly : p.monthly, cur = ME.plan === k;
      return `<div class="card plan ${p.popular ? 'best' : ''}">${p.popular ? '<div class="ribbon">Most popular</div>' : ''}
        <h2 style="margin:0">${esc(p.name)} ${cur ? '<span class="pill">Current</span>' : ''}</h2><div class="mu" style="font-size:14px">${esc(p.tagline || '')}</div>
        <div class="price">${price ? '$' + price : '$0'}<small>${price ? (yearly ? '/year' : '/month') : ' forever'}</small></div>
        ${yearly && p.yearly ? `<div class="mu" style="font-size:13px">$${(p.yearly / 12).toFixed(2)}/month billed yearly</div>` : '<div style="height:19px"></div>'}
        <ul>${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        ${p.monthly && !cur ? `<button data-plan="${k}" class="${p.popular ? '' : 'ghost'}">${trial ? `Start ${days}-day free trial` : `Choose ${esc(p.name)}`}</button>` : cur ? '<button class="ghost" disabled>Your plan</button>' : ''}</div>`;
    }).join('')}</div>
    <div class="err" id="planErr"></div><p class="mu small-print">Payment is on Stripe's secure page. On a phone, if the card numbers you type don't show, turn off your browser's dark theme for websites (Chrome: Settings → Theme; Samsung Internet: dark mode off) or open the page in another browser.</p>
    <p class="mu" style="text-align:center;font-size:13px">Secure checkout by Stripe. Cancel anytime from "Manage billing". Prices in USD.</p>
    ${aip ? `<details class="card aiplans"><summary><b>Intelligence and AI in each plan</b> <span class="mu">agents and API, AI bots, signals, market intelligence, chart co-pilot</span></summary><div class="tablewrap"><table><tr><th></th>${Object.values(aip.plans).map(n => `<th>${esc(n)}</th>`).join('')}</tr>${aip.rows.map(([n, ...v]) => `<tr><th scope="row">${esc(n)}</th>${v.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table></div></details>` : ''}
    ${cr ? `<div class="card" id="credits"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Credits</h2><b class="credbal">${cr.balance.total.toLocaleString()} <span class="mu" style="font-weight:500;font-size:14px">credits</span></b></div>
      <div class="credbar" title="Monthly credits left"><i style="width:${cr.balance.allowance ? Math.min(100, cr.balance.monthly / cr.balance.allowance * 100) : 0}%"></i></div>
      <p class="mu" style="margin:6px 0 14px;font-size:13px">${cr.balance.monthly.toLocaleString()} of ${cr.balance.allowance.toLocaleString()} monthly credits left (they refill on the 1st)${cr.balance.bought ? ` · ${cr.balance.bought.toLocaleString()} bought credits (never expire)` : ''}.</p>
      <div class="grid2"><div><h3 style="margin:0 0 6px">What credits pay for</h3><table class="slim">${Object.entries(cr.costs).filter(([, c]) => c > 0).map(([k, c]) => `<tr><td>${esc(cr.labels[k] || k)}</td><td style="text-align:end"><b>${c}</b></td></tr>`).join('')}</table></div>
        <div><h3 style="margin:0 0 6px">Buy credits</h3><div class="packs">${cr.packs.map(p => `<button type="button" class="pack ghost" data-pack="${esc(p.id)}"><b>${p.credits.toLocaleString()}</b><span>credits</span><em>$${p.price}</em></button>`).join('')}</div>
          <p class="mu" style="font-size:12.5px">Bought credits never expire and are used after your monthly ones.</p><div class="err" id="credErr"></div></div></div>
      ${cr.history.length ? `<details style="margin-top:10px"><summary class="mu">Recent credit use</summary><table class="slim">${cr.history.map(h => `<tr><td>${date(h.at)}</td><td>${esc(cr.labels[h.kind] || (h.kind === 'purchase' ? 'Credits bought' : h.kind))}${h.memo ? ` <span class="mu" data-no-tr>${esc(h.memo)}</span>` : ''}</td><td style="text-align:end" class="${h.delta > 0 ? 'pos' : ''}">${h.delta > 0 ? '+' : ''}${h.delta}</td></tr>`).join('')}</table></details>` : ''}</div>` : ''}
    <div class="grid">
      <form class="card" id="dep"><h2>Add paper money</h2>
        <div class="row"><label>Amount (USD)<input name="amount" type="number" min="10" max="10000" value="10000"></label><input type="hidden" name="account" value="paper"></div>
        <button>Add to paper account</button><div class="err"></div>
        <p class="mu" style="font-size:13px">Real money goes to your brokerage account by bank transfer on the <a href="#/account">Brokerage account</a> page.</p></form>
      <form class="card" id="realDep"><h2>Deposit to your brokerage</h2>
        ${pay.methods.length ? `<label>Amount (USD)<input name="amount" type="number" min="10" max="10000" value="500"></label>
        <div class="methods">${pay.methods.map((m, i) => `<label class="method"><input type="radio" name="method" value="${m.id}" ${i ? '' : 'checked'}><span><b>${esc(m.name)}</b> <span class="mu">via ${esc(m.via)}</span><br><span class="mu" style="font-size:13px">${esc(m.note)}</span></span></label>`).join('')}</div>
        <p class="mu" id="feeLine" style="font-size:13px"></p>
        <input type="hidden" name="account" value="${esc(accts.find(a => a.connected && a.id !== 'paper')?.id || 'alpaca')}">
        <button>Continue to payment</button><div class="err"></div>` : '<p class="mu">Card and bank deposits are not set up on this server yet. You can fund your brokerage account by bank transfer on the <a href="#/account">Alpaca account</a> page.</p>'}</form>
      ${fees.adviser ? `<div class="card"><h2>Performance fee</h2><p>Your rate: <b>${fees.rate * 100}%</b> of new profit. You only pay when an account is above its previous peak, after deposits and withdrawals.</p>
        ${fees.accounts.map(a => `<p class="mu">${esc(a.account)}: high-water mark ${money(a.high_water)}</p>`).join('')}</div>` : ''}
    </div>
    <div class="card tablewrap"><h2>Billing history</h2><table><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Note</th></tr>
      ${ledger.map(l => `<tr><td>${date(l.at)}</td><td>${esc(l.kind.replace(/_/g, ' '))}</td><td>${money(l.amount)}</td><td>${esc(l.status)}</td><td>${esc(l.memo || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">Nothing yet</td></tr>'}</table></div>`;
    $$('#interval button', view).forEach(b => (b.onclick = () => { yearly = b.dataset.i === 'year'; draw(); }));
    $$('[data-plan]', view).forEach(b => act(b, async () => { location.href = (await api('/billing/checkout', { body: { plan: b.dataset.plan, interval: yearly ? 'year' : 'month' } })).url; }, $('#planErr', view)));
    $$('[data-pack]', view).forEach(b => act(b, async () => { location.href = (await api('/credits/buy', { body: { pack: b.dataset.pack } })).url; }, $('#credErr', view)));
    if ($('#portal', view)) act($('#portal', view), async () => { location.href = (await api('/billing/portal', { body: {} })).url; }, $('#planErr', view));
    act($('button', $('#dep', view)), async () => { await api('/funding/deposit', { body: form($('#dep', view)) }); setTimeout(render, 500); return 'Paper money added.'; });
    const rd = $('#realDep', view);
    if (rd && pay.methods.length) {
      const feeOf = a => +(a * (pay.fee.percent || 0) / 100 + (pay.fee.percent || pay.fee.fixed ? pay.fee.fixed || 0 : 0)).toFixed(2);
      const show = () => { const a = +rd.amount.value || 0, f = feeOf(a); $('#feeLine', rd).textContent = f ? `You pay ${money(a + f)}: ${money(a)} deposit + ${money(f)} service fee. ${money(a)} goes to your account.` : `You pay ${money(a)}. No service fee.`; };
      rd.amount.oninput = show; show();
      act($('button', rd), async () => {
        const r = await api('/funding/deposit', { body: form(rd) });
        if (r.url) { location.href = r.url; return 'Opening secure checkout…'; }
        if (r.helcim) { await helcimPay(r.helcim.checkoutToken, r.ledgerId); setTimeout(render, 800); return 'Payment received. Thank you!'; }
      });
    }
  };
  draw();
};

// Helcim's secure payment window (HelcimPay.js); the result is verified on the server.
function helcimPay(checkoutToken, ledgerId) {
  return new Promise((resolve, reject) => {
    const open = () => window.appendHelcimPayIframe(checkoutToken);
    const onMsg = async e => {
      if (e.data?.eventName !== 'helcim-pay-js-' + checkoutToken) return;
      if (e.data.eventStatus === 'ABORTED') { window.removeEventListener('message', onMsg); window.removeHelcimPayIframe?.(); reject(new Error('Payment cancelled')); }
      if (e.data.eventStatus === 'SUCCESS') {
        window.removeEventListener('message', onMsg); window.removeHelcimPayIframe?.();
        const m = typeof e.data.eventMessage === 'string' ? JSON.parse(e.data.eventMessage) : e.data.eventMessage;
        try { await api('/funding/helcim/confirm', { body: { ledgerId, data: m?.data?.data ?? m?.data, hash: m?.data?.hash ?? m?.hash } }); resolve(); } catch (err) { reject(err); }
      }
    };
    window.addEventListener('message', onMsg);
    if (window.appendHelcimPayIframe) return open();
    const s = document.createElement('script'); s.src = 'https://secure.helcim.app/helcim-pay/services/start.js'; s.onload = open; s.onerror = () => reject(new Error('Could not load the payment window'));
    document.head.append(s);
  });
}

// ---------- invite & earn ----------
routes.referrals = async view => {
  const r = await api('/referrals');
  view.innerHTML = `<h1>Invite & earn</h1>
  <div class="card" style="background:var(--grad);color:#fff;border:0"><h2 style="color:#fff;font-size:20px">Give your friends ${r.friendDays} days free. Get $${r.reward} for each one who subscribes.</h2>
    <p style="margin:0;opacity:.9">Share your link. Friends who sign up with it get a ${r.friendDays}-day free trial. When one starts a paid plan, $${r.reward} is credited to your account and taken off your next bill.</p></div>
  <div class="card"><h2>Your invite link</h2><div class="refbox"><input id="reflink" readonly value="${esc(r.link)}"><button id="copy">Copy</button>${navigator.share ? '<button class="ghost" id="share">Share</button>' : ''}</div><div class="err"></div></div>
  <div class="card"><div class="stats">
    <div class="stat"><span>Friends who joined</span><b>${r.invited}</b></div>
    <div class="stat"><span>Friends who subscribed</span><b>${r.paying}</b></div>
    <div class="stat"><span>Credit earned</span><b class="pos">${money(r.credit)}</b></div></div></div>
  ${r.milestones?.length ? `<div class="card"><h2>Bonus milestones</h2>${r.next ? `<p class="mu">${r.next.at - r.paying} more subscribed ${r.next.at - r.paying === 1 ? 'friend' : 'friends'} to your next bonus of <b>$${r.next.bonus}</b>.</p><div class="ob-bar"><i style="width:${Math.round(r.paying / r.next.at * 100)}%"></i></div>` : '<p class="mu">You reached every bonus. Thank you!</p>'}
    <div class="milestones">${r.milestones.map(m => `<div class="milestone ${r.paying >= m.at ? 'done' : ''}"><b>${m.at}</b><span>friends</span><em>+$${m.bonus}</em></div>`).join('')}</div></div>` : ''}`;
  act($('#copy', view), async () => { await navigator.clipboard.writeText(r.link).catch(() => { $('#reflink', view).select(); document.execCommand('copy'); }); return 'Link copied'; });
  if ($('#share', view)) $('#share', view).onclick = () => navigator.share({ title: 'Brightolio', text: 'Backtest and automate your trading ideas with Brightolio:', url: r.link }).catch(() => {});
};

// ---------- settings ----------
routes.settings = async view => {
  const [integ, sessions, log] = await Promise.all([api('/integrations'), api('/auth/sessions'), api('/auth/audit')]);
  // Accounts created with Google have no password until they add one; they confirm with their email.
  const pw = ME.hasPassword, confirmLabel = what => pw ? `Password to ${what}` : `Type your email to ${what}`, confirmType = pw ? 'password' : 'email';
  view.innerHTML = `<h1>Settings</h1>
  <div class="grid masonry">
    <div class="card"><h2>Page guides</h2><label class="chk"><input type="checkbox" id="guidesT" ${(() => { try { return localStorage.getItem('qp_guides') !== 'off'; } catch { return true; } })() ? 'checked' : ''}> Show the "How this page works" guide on each page</label><p class="mu small-print">Switch it off to hide every guide on every page.</p></div>
    <div class="card"><h2>News pop-ups</h2><label class="chk"><input type="checkbox" id="newsT" ${toastsOn() ? 'checked' : ''}> Show today's headlines about the stocks I own</label></div>
    <div class="card" id="pnlPrefs"><h2>Portfolio numbers</h2>
      <p class="mu" style="margin-top:0">How your account value changes on the screen.</p>
      <div style="display:grid;gap:6px">${[['live', 'Live: numbers update every minute while the page is open'], ['since', 'Since you last looked: the change since your last visit; numbers stay still while you look'], ['both', 'Both']].map(([k, t]) => `<label class="chk"><input type="radio" name="pnlMode" value="${k}" ${PREFS.portfolio.mode === k ? 'checked' : ''}> ${t}</label>`).join('')}</div>
      <label class="chk" style="margin-top:12px;display:flex"><input type="checkbox" id="hideToday" ${PREFS.portfolio.hideToday ? 'checked' : ''}> Hide today's profit and loss</label>
      <p class="mu small-print">Checking every small move often leads to worse decisions. Many long-term investors hide today's number.</p></div>
    <div class="card" id="chartPrefs"><h2>Chart colors</h2>
      <p class="mu" style="margin-top:0">How your account charts are colored.</p>
      <div style="display:grid;gap:6px">${[['colorful', 'Colorful: the color follows what your money is doing (new high, near its high, pulling back, rebounding, sliding, deep loss) and blends from one to the next'], ['one', 'One color'], ['custom', 'A color I pick']].map(([k, t]) => `<label class="chk"><input type="radio" name="chartMode" value="${k}" ${(PREFS.chart.mode || 'colorful') === k ? 'checked' : ''}> ${t}</label>`).join('')}</div>
      <div id="chartColorL" ${PREFS.chart.mode === 'custom' ? '' : 'hidden'} style="margin-top:10px"><div class="colorpicks">${['#2563eb', '#0891b2', '#059669', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#0f172a'].map(c => `<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}" class="${(PREFS.chart.color || '').toLowerCase() === c ? 'on' : ''}"></button>`).join('')}<label class="anycolor" title="Any color">Any color<input type="color" id="chartColor" value="${esc(PREFS.chart.color || '#2563eb')}"></label></div></div>
      <div class="swatches" ${PREFS.chart.mode === 'colorful' || !PREFS.chart.mode ? '' : 'hidden'} id="chartSw">${Object.values(RICH_STATES).map(v => `<span><i style="background:${v.color}"></i>${esc(v.label)}</span>`).join('')}</div></div>
    <div class="card"><h2>Calm mode</h2><label class="chk"><input type="checkbox" id="calmT" ${document.body.classList.contains('calm') ? 'checked' : ''}> No flashing prices, colors or celebrations (recommended)</label>
      <p class="mu small-print">Trading decisions go better without constant movement on the screen. Your long-term results are on the <a href="#/longterm">Long-term view</a>.</p></div>
    <div class="card" id="language"><h2>Language</h2>
      <p class="mu">The language of the app on this device.</p>
      <label>Language<select id="langSel" data-no-tr>${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === currentLang() ? 'selected' : ''} lang="${k}">${v.name}${k === 'en' ? ' (original)' : k === 'yi' ? ' (full translation)' : ''}</option>`).join('')}</select></label>
      ${LANGS[currentLang()]?.simple ? '<p class="mu small-print">Simple translation: menus and main buttons are translated; the rest of the app stays in English.</p>' : ''}</div>
    <div class="card"><h2>Your brokerage</h2>
      <p class="mu">Connect the brokerage you use (Alpaca, Schwab, tastytrade, Tradier or TradeStation), or open a new account; we suggest Alpaca.</p>
      <a href="#/brokers"><button type="button">Choose your brokerage</button></a></div>
    <form class="card" id="qcf"><h2>QuantConnect</h2>
      <p class="mu">${integ.quantconnect.connected ? 'Connected as user ' + esc(integ.quantconnect.userId) : 'quantconnect.com → Account → API Access'}</p>
      <label>User id<input name="userId" autocomplete="off"></label><label>API token<input name="token" type="password" autocomplete="off"></label>
      <button>${integ.quantconnect.connected ? 'Replace' : 'Connect QuantConnect'}</button> ${integ.quantconnect.connected ? '<button type="button" class="ghost" data-dis="quantconnect">Disconnect</button>' : ''}<div class="err"></div></form>
    <div class="card" id="mfa"><h2>Two-factor authentication</h2>
      ${ME.totpEnabled ? `<p class="pos">Enabled</p><label>${confirmLabel('disable')}<input type="${confirmType}" id="mfapw"></label><button class="danger" id="mfaoff">Disable 2FA</button><div class="err"></div>`
        : `<p class="mu">Protect your account with an authenticator app (Google Authenticator, 1Password, Authy).</p><button id="mfaset">Set up 2FA</button><div class="err"></div><div id="mfabox"></div>`}</div>
    <form class="card" id="ph"><h2>Phone for SMS & hotline</h2>
      <p class="mu">${ME.phone ? esc(ME.phone) + (ME.phoneVerified ? ' · verified' : ' · not verified') : 'Not set'}</p>
      <label>Mobile number<input name="phone" placeholder="+17185551234" value="${esc(ME.phone || '')}"></label><button>Send code</button>
      <label>Code<input name="code" inputmode="numeric"></label><button type="button" id="phv">Verify</button><div class="err"></div>
      <h3>Trading PIN</h3>${pw ? '' : '<p class="mu">Add a password in the Password card first.</p>'}<label>Account password<input type="password" name="pinpw"></label><label>New PIN (4-8 digits)<input name="pin" inputmode="numeric"></label><button type="button" id="pinb">Save PIN</button><div class="err"></div></form>
    <form class="card" id="taxs"><h2>Taxes</h2><p class="mu" style="margin-top:0">Where you live and roughly what you earn set your tax rates automatically, and they update every January.</p>
      <div id="taxBox"><p class="mu">Loading…</p></div></form>
    <form class="card" id="pw"><h2>${pw ? 'Password' : 'Add a password'}</h2>${ME.google ? '<p class="mu"><span class="pill">Google</span> Sign in with Google is connected.</p>' : ''}${ME.github ? '<p class="mu"><span class="pill">GitHub</span> Sign in with GitHub is connected.</p>' : ''}
      ${pw ? '<label>Current<input type="password" name="current" autocomplete="current-password"></label>' : '<p class="mu">Add one to also sign in with your email and password.</p>'}<label>New<input type="password" name="next" autocomplete="new-password"></label><button>${pw ? 'Change password' : 'Save password'}</button><div class="err"></div>
      <p class="mu" style="font-size:12px">${pw ? 'Changing it signs out every other device.' : '10+ characters with upper, lower and a digit.'}</p></form>
  </div>
  <div class="card"><h2>Your data</h2><p class="mu">Download everything we store about you, or permanently delete your account.</p>
    <a href="/api/auth/export"><button type="button" class="ghost">Download my data</button></a>
    <label>${confirmLabel('delete your account')}<input type="${confirmType}" id="delpw" autocomplete="${pw ? 'current-password' : 'off'}"></label><button class="danger" id="delacct">Delete my account</button><div class="err"></div></div>
  <div class="card tablewrap"><h2>Active sessions</h2><table><tr><th>IP address</th><th>Device</th><th>Signed in</th><th></th></tr>${sessions.map(s => `<tr><td>${esc(s.ip)}</td><td data-no-tr>${esc(s.ua.slice(0, 60))}</td><td>${date(s.createdAt)}</td><td>${s.current ? '<span class="pill">this device</span>' : `<button class="small ghost" data-s="${s.id}">Sign out</button>`}</td></tr>`).join('')}</table></div>
  <div class="card tablewrap"><h2>Security log</h2><table><tr><th>When</th><th>Event</th><th>IP address</th></tr>${log.map(l => `<tr><td>${date(l.at)}</td><td>${esc(EVENT_LABELS[l.event] || l.event.replace(/_/g, ' '))}</td><td>${esc(l.ip || '')}</td></tr>`).join('')}</table></div>`;
  $('#langSel', view).onchange = e => { if (e.target.value !== currentLang()) setLang(e.target.value); };
  act($('button', $('#qcf', view)), async () => { await api('/integrations/quantconnect', { body: form($('#qcf', view)) }); setTimeout(render, 800); return 'Connected'; });
  $$('[data-dis]', view).forEach(b => (b.onclick = async () => { await api('/integrations/' + b.dataset.dis, { method: 'DELETE' }); render(); }));
  if ($('#mfaset', view)) act($('#mfaset', view), async () => {
    const r = await api('/auth/totp/setup', { body: {} });
    $('#mfabox', view).innerHTML = `<p>Add this key to your authenticator app (or open the link on your phone):</p><pre>${esc(r.secret)}</pre><p><a href="${esc(r.uri)}">${esc(r.uri.slice(0, 40))}…</a></p>
      <label>Code from the app<input id="mfacode" inputmode="numeric" maxlength="6"></label><button id="mfaon">Turn on 2FA</button><div class="err"></div>`;
    act($('#mfaon', view), async () => { await api('/auth/totp/enable', { body: { code: $('#mfacode', view).value } }); await refreshMe(); render(); });
  });
  if ($('#mfaoff', view)) act($('#mfaoff', view), async () => { const v = $('#mfapw', view).value; await api('/auth/totp/disable', { body: { password: v, confirm: v } }); await refreshMe(); render(); });
  const ph = $('#ph', view);
  act($('button', ph), async () => { const r = await api('/phone', { body: { phone: ph.phone.value } }); await refreshMe(); return r.devCode ? `SMS is off on this server - your dev code is ${r.devCode}` : 'Code sent'; }, $$('.err', ph)[0]);
  act($('#phv', view), async () => { await api('/phone/verify', { body: { code: ph.code.value } }); await refreshMe(); return 'Phone verified'; }, $$('.err', ph)[0]);
  act($('#pinb', view), async () => { await api('/pin', { body: { password: ph.pinpw.value, pin: ph.pin.value } }); await refreshMe(); return 'PIN saved'; }, $$('.err', ph)[1]);
  taxSettings($('#taxs', view));
  act($('button', $('#pw', view)), async () => { await api('/auth/password', { body: form($('#pw', view)) }); if (!pw) { await refreshMe(); setTimeout(render, 1200); } return pw ? 'Password changed' : 'Password saved'; });
  $$('[data-s]', view).forEach(b => (b.onclick = async () => { await api('/auth/sessions/' + b.dataset.s, { method: 'DELETE' }); render(); }));
  act($('#delacct', view), async () => {
    if (!confirm('Delete your account and all data permanently? This cannot be undone. Your Alpaca account is not affected.')) return;
    const v = $('#delpw', view).value; await api('/auth/delete', { body: { password: v, confirm: v } }); location.href = '/';
  });
  if ($('#calmT', view)) $('#calmT', view).onchange = e => setCalm(e.target.checked);
  const savePnl = async () => { PREFS.portfolio = (await api('/prefs/portfolio', { method: 'PUT', body: { value: { mode: $('[name=pnlMode]:checked', view)?.value, hideToday: $('#hideToday', view).checked } } })).value; };
  $$('[name=pnlMode]', view).forEach(r => (r.onchange = savePnl));
  const saveChart = async () => {
    const mode = $('[name=chartMode]:checked', view)?.value || 'colorful';
    $('#chartColorL', view).hidden = mode !== 'custom'; $('#chartSw', view).hidden = mode !== 'colorful';
    PREFS.chart = (await api('/prefs/chart', { method: 'PUT', body: { value: { mode, color: $('#chartColor', view).value } } })).value;
    chartSeen.clear();
  };
  $$('[name=chartMode]', view).forEach(r => (r.onchange = saveChart)); if ($('#chartColor', view)) $('#chartColor', view).onchange = saveChart;
  $$('[data-color]', view).forEach(b => (b.onclick = () => { $('#chartColor', view).value = b.dataset.color; $$('[data-color]', view).forEach(x => x.classList.toggle('on', x === b)); saveChart(); })); if ($('#hideToday', view)) $('#hideToday', view).onchange = savePnl;
  if ($('#guidesT', view)) $('#guidesT', view).onchange = e => { try { e.target.checked ? localStorage.removeItem('qp_guides') : localStorage.setItem('qp_guides', 'off'); } catch {} };
  if ($('#newsT', view)) $('#newsT', view).onchange = e => { try { localStorage.setItem('qp_news_toasts', e.target.checked ? '1' : '0'); } catch {} };
};

// ---------- admin ----------
// Owner pages: one route per section so each has its own place in the menu.
// The owner's pages, in four groups (each its own menu section; the tab row shows its group).
const ADMIN_GROUPS = [
  ['Owner: people', [['admin', 'Overview'], ['admin-users', 'Users'], ['admin-admins', 'Admins'], ['admin-support', 'Support inbox'], ['admin-comms', 'Calls, texts & email'], ['admin-phone', 'Phone line'], ['admin-phoneaccts', 'Phone & text accounts']]],
  ['Owner: money', [['admin-money', 'Money & fees'], ['admin-sponsored', 'Sponsored news'], ['admin-upgrades', 'Upgrades']]],
  ['Owner: site & content', [['admin-readme', 'README'], ['admin-seo', 'SEO'], ['admin-strategies', 'Original strategies'], ['admin-trust', 'Trust'], ['admin-yiddish', 'Yiddish Labs']]],
  ['Owner: technical', [['admin-agents', 'AI team'], ['admin-ai', 'AI & privacy'], ['admin-keys', 'Keys'], ['admin-data', 'Market data'], ['admin-hosting', 'Hosting'], ['admin-system', 'System health'], ['admin-setup', 'Setup']]],
];
const ADMIN_TABS = ADMIN_GROUPS.flatMap(([, t]) => t);
// The menu shows all of the owner's pages in one Admin section (only for admins), with a small
// heading for each group: people, money, site, technical and the business books.
const ownerOnly = k => ME?.role !== 'admin' && [...ADMIN_GROUPS, BIZ_NAV].some(([, t]) => t.some(([x]) => x === k));
const adminNav = () => ['Admin', [...ADMIN_GROUPS, BIZ_NAV].flatMap(([g, items]) => [[null, g.replace(/^Owner: /, '')], ...items])];
const adminGroup = k => (ADMIN_GROUPS.find(([, t]) => t.some(([x]) => x === k)) || ADMIN_GROUPS[0])[1];
// Pages with their own module (owner.js, protect.js) draw themselves under the same tabs.
const adminTabs = current => `<div class="chips admintabs">${adminGroup(current).map(([k, t]) => `<a href="#/${k}"><button type="button" class="${k === current ? 'on' : ''}">${t}</button></a>`).join('')}</div>`;
async function adminPage(view, tab) {
  const [s, msgs, setup] = await Promise.all([api('/admin/summary'), api('/admin/messages'), tab === 'admin-setup' ? api('/admin/setup') : null]);
  const total = (kind, status) => s.byKind.filter(x => x.kind === kind && (!status || x.status === status)).reduce((a, x) => a + x.total, 0);
  const f = s.funnel, steps = [['Signed up', f.signups], ['Connected a brokerage', f.connected], ['Placed a trade', f.traded], ['In free trial', f.trialing], ['Paying', f.paying]];
  const open = msgs.filter(m => m.status === 'open');
  const tabs = `<div class="chips admintabs">${adminGroup(tab).map(([k, t]) => `<a href="#/${k}"><button type="button" class="${k === tab ? 'on' : ''}">${t}${k === 'admin-support' && open.length ? ` <span class="pill warn">${open.length}</span>` : ''}</button></a>`).join('')}</div>`;
  const sections = {
    admin: () => `
  <div class="card"><h2>Revenue</h2><div class="stats">
    <div class="stat"><span>Monthly recurring revenue</span><b class="kpi">${money(f.mrr)}</b></div>
    <div class="stat"><span>Annual run rate</span><b>${money(f.arr)}</b></div>
    <div class="stat"><span>Revenue, last 30 days</span><b>${money(f.revenue30)}</b></div>
    <div class="stat"><span>Signup → paying</span><b>${f.conversion}%</b></div></div></div>
  <div class="card"><div class="stats">
    <div class="stat"><span>Users</span><b>${s.users.length}</b></div>
    <div class="stat"><span>Performance fees due</span><b>${money(total('performance_fee', 'due'))}</b></div>
    <div class="stat"><span>Open support messages</span><b>${open.length}</b></div>
    <div class="stat"><span>Deposits awaiting transfer</span><b>${s.pendingTransfers.length}</b></div></div></div>
  <div class="card"><h2>Funnel</h2><p class="mu" style="margin-top:0">${f.signups30} new signups in the last 30 days. Find the biggest drop and improve that step first.</p><div class="funnel">
    ${steps.map(([t, n]) => `<div class="bar"><span>${t}</span><i style="width:${f.signups ? Math.max(1, n / f.signups * 100) : 0}%"></i><b>${n}</b></div>`).join('')}</div></div>`,
    'admin-users': () => `
  <div class="card tablewrap"><div class="row" style="justify-content:space-between;align-items:center"><h2>Users</h2><input id="userFind" type="search" placeholder="Search email or nickname" style="max-width:260px;margin:0"></div>
    <div class="card" id="livePnlCard" style="margin:0 0 12px"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Real-money results across users</h3><button class="small" id="livePnlLoad">Load live P&amp;L</button></div><div id="livePnlOut" class="mu">Totals of every user's connected real-money accounts: open (unrealized) and realized P&amp;L, today's change and equity. Paper accounts are left out.</div></div>
    <table id="userTable"><tr><th>Email</th><th>Nickname</th><th>Plan</th><th>Role</th><th>2FA</th><th>Phone</th><th>Joined</th><th></th></tr>${s.users.map(u => `<tr data-email="${esc(u.email + ' ' + u.nickname)}"><td data-no-tr>${esc(u.email)}${u.google ? ' <span class="pill">Google</span>' : ''}${u.github ? ' <span class="pill">GitHub</span>' : ''}</td><td data-no-tr class="mu">${esc(u.nickname)}</td>
      <td><select data-plan="${u.id}" style="margin:0;min-width:110px">${['free', 'pro', 'elite', 'ultimate'].map(p => `<option value="${p}" ${u.plan === p ? 'selected' : ''}>${{ free: 'Starter', pro: 'Pro', elite: 'Elite', ultimate: 'Ultimate' }[p]}</option>`).join('')}</select></td>
      <td>${u.role === 'admin' ? `<span class="pill">Admin</span>${u.id !== ME.id ? ` <button class="small ghost" data-role="${u.id}" data-to="user">Remove admin</button>` : ''}` : `<button class="small ghost" data-role="${u.id}" data-to="admin">Make admin</button>`}</td>
      <td>${u.totp_enabled ? 'yes' : '-'}</td><td>${u.phone_verified ? 'yes' : '-'}</td><td>${date(u.created_at)}</td><td><button class="small ghost" data-more="${u.id}" aria-expanded="false">Details</button></td></tr><tr class="userMore" data-for="${u.id}" hidden><td colspan="8"><div class="mu">Loading…</div></td></tr>`).join('')}</table><div class="err" id="userErr"></div>
    <p class="mu" style="font-size:12.5px">Changing a plan here gives it without payment (for friends, testers or support cases). Paying customers change plans themselves under Plans &amp; billing.</p></div>`,
    'admin-money': () => `
  <div class="card"><div class="stats">
    <div class="stat"><span>Monthly recurring revenue</span><b>${money(s.mrr)}</b></div>
    <div class="stat"><span>Performance fees due</span><b>${money(total('performance_fee', 'due'))}</b></div>
    <div class="stat"><span>Performance fees collected</span><b>${money(total('performance_fee', 'collected'))}</b></div>
  </div><button id="assess">Assess performance fees now</button><div class="err"></div></div>
  <div class="card tablewrap"><h2>Fees due</h2><table>${s.feesDue.map(l => `<tr><td data-no-tr>${esc(l.email)}</td><td>${money(l.amount)}</td><td>${esc(l.memo)}</td><td><button class="small" data-l="${l.id}" data-s="collected">Mark collected</button> <button class="small ghost" data-l="${l.id}" data-s="waived">Waive</button></td></tr>`).join('') || '<tr><td class="mu">None</td></tr>'}</table></div>
  <div class="card tablewrap"><h2>Card deposits awaiting brokerage transfer</h2><table>${s.pendingTransfers.map(l => `<tr><td data-no-tr>${esc(l.email)}</td><td>${money(l.amount)}</td><td>${date(l.at)}</td><td><button class="small" data-l="${l.id}" data-s="transferred">Mark transferred</button></td></tr>`).join('') || '<tr><td class="mu">None</td></tr>'}</table></div>
  <div class="card tablewrap"><h2>Payment processors</h2><p class="mu" style="margin-top:0">What each way of taking a $500 deposit costs you. Your service fee: <b>${s.depositFee.percent}%${s.depositFee.fixed ? ' + ' + money(s.depositFee.fixed) : ''}</b> (DEPOSIT_FEE_PERCENT / DEPOSIT_FEE_FIXED) · collected so far ${money(s.depositFee.collected)}.</p>
    <table><tr><th>Method</th><th>Processor</th><th>Their price</th><th>Cost on $500</th><th>Status</th></tr>${s.payments.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.via)}</td><td>${esc(p.cost)}</td><td>${money(p.on500)}</td><td>${p.enabled ? '<span class="pill pos">On</span>' : '<span class="pill">Not set up</span>'}</td></tr>`).join('')}</table>
    <p class="mu" style="font-size:12px">Helcim's figure assumes a regulated (big-bank) debit card; cards from small banks and credit cards cost more. Card-network rules and some states limit surcharges on cards, so the service fee is shown up front and charged for the deposit service.</p></div><div id="treasuryBox"></div>`,
    'admin-support': () => `
  <div class="card tablewrap"><h2>Support inbox</h2><table>${open.map(m => `<tr><td>${date(m.at)}</td><td data-no-tr>${esc(m.name)} &lt;<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>&gt;</td><td data-no-tr><b>${esc(m.subject)}</b><br><span class="mu" style="white-space:pre-wrap">${esc(m.body)}</span></td><td><button class="small ghost" data-m="${m.id}">Done</button></td></tr>`).join('') || '<tr><td class="mu">Inbox zero</td></tr>'}</table></div>`,
    'admin-setup': () => `
  <div class="card"><h2>Setup</h2><p class="mu" style="margin-top:0">What is switched on, from the environment variables in Render (values are never shown). Admins: <b data-no-tr>${esc(setup.admins.join(', ') || 'none')}</b></p>
    <div class="setup">${setup.items.map(x => `<div class="setup-row"><span class="dot ${x.on ? 'on' : ''}"></span><span class="setup-name">${esc(x.name)}</span><code data-no-tr>${esc(x.env)}</code><span class="pill ${x.on ? '' : 'warn'}">${x.on ? 'On' : 'Not set'}</span></div>`).join('')}</div>
    ${setup.googleRedirects?.length ? `<details style="margin-top:10px"><summary>Sign-in return addresses (paste into Google and GitHub)</summary><p class="mu">Google Cloud console → APIs &amp; Services → Credentials → your OAuth client → <b>Authorized redirect URIs</b>: add each line.</p><pre data-no-tr style="white-space:pre-wrap">${esc(setup.googleRedirects.join('\n'))}</pre><p class="mu">GitHub → Settings → Developer settings → OAuth Apps → your app → <b>Authorization callback URL</b>:</p><pre data-no-tr>${esc(setup.githubRedirect)}</pre></details>` : ''}
    ${setup.emailError?.msg ? `<p class="banner err">Last email failed: ${esc(setup.emailError.msg)}</p>` : ''}
    <p><button class="ghost" id="testEmail">Send me a test email</button><span class="err"></span></p>
    <p class="mu small-print">Password-reset emails need RESEND_API_KEY and EMAIL_FROM on a domain you verified at resend.com (e.g. <span data-no-tr>Brightolio &lt;no-reply@yourdomain.com&gt;</span>). Without EMAIL_FROM, Resend's test sender only delivers to your own Resend address.</p>
    <p class="mu" style="font-size:12.5px">To change one: open <a href="#/admin-keys">Keys</a> (saves here and on Render), or Render → your service → Environment → add or edit the variable → Save.</p></div>`,
  };
  view.innerHTML = `<h1>Admin</h1>${tabs}${sections[tab]()}`;
  if ($('#treasuryBox', view)) import('./pages/sponsored.js').then(m => m.treasuryCard($('#treasuryBox', view), shared)).catch(() => {});
  if ($('#testEmail', view)) act($('#testEmail', view), async () => `Sent to ${(await api('/admin/test-email', { body: {} })).to}. Check the inbox (and spam).`, $('#testEmail', view).nextElementSibling);
  if ($('#assess', view)) act($('#assess', view), async () => { const r = await api('/admin/assess-fees', { body: {} }); setTimeout(render, 1200); return `Assessed ${r.length} accounts, ${money(r.reduce((a, x) => a + (x.fee || 0), 0))} in new fees`; });
  $$('[data-l]', view).forEach(b => (b.onclick = async () => { await api('/admin/ledger/' + b.dataset.l, { body: { status: b.dataset.s } }); render(); }));
  $$('[data-m]', view).forEach(b => (b.onclick = async () => { await api('/admin/messages/' + b.dataset.m, { body: {} }); render(); }));
  const uerr = $('#userErr', view);
  const userCall = async (id, body) => { uerr.textContent = ''; try { await api('/admin/users/' + id, { body }); render(); } catch (e) { uerr.textContent = e.message; } };
  $$('[data-plan]', view).forEach(sel => (sel.onchange = () => userCall(sel.dataset.plan, { plan: sel.value })));
  $$('[data-role]', view).forEach(b => (b.onclick = () => userCall(b.dataset.role, { role: b.dataset.to })));
  if ($('#livePnlLoad', view)) act($('#livePnlLoad', view), async () => {
    const d = await api('/admin/users/live-pnl'), sg = x => `<b class="${cls(x)}">${money(x)}</b>`;
    $('#livePnlOut', view).innerHTML = d.count ? `<div class="stats"><div class="stat"><span>Users with real money</span><b>${d.count}</b></div><div class="stat"><span>Total P&amp;L</span>${sg(d.total)}</div><div class="stat"><span>Open (unrealized)</span>${sg(d.open)}</div><div class="stat"><span>Realized</span>${sg(d.realized)}</div><div class="stat"><span>Today</span>${sg(d.today)}</div><div class="stat"><span>Equity</span><b>${money(d.equity)}</b></div></div>
      <div class="tablewrap"><table class="slim"><tr><th>User</th><th class="num">Total</th><th class="num">Open</th><th class="num">Realized</th><th class="num">Today</th><th class="num">Equity</th></tr>${d.users.map(u => `<tr><td data-no-tr>${esc(u.email || '#' + u.userId)}${u.error ? ` <span class="err">${esc(u.error)}</span>` : ''}</td><td class="num">${sg(u.total)}</td><td class="num">${sg(u.open)}</td><td class="num">${sg(u.realized)}</td><td class="num">${sg(u.today)}</td><td class="num">${money(u.equity)}</td></tr>`).join('')}</table></div>` : 'No users have a real-money account connected yet.';
    return 'Loaded';
  });
  $$('[data-more]', view).forEach(b => (b.onclick = async () => {
    const id = b.dataset.more, row = $(`.userMore[data-for="${id}"]`, view), open = row.hidden;
    row.hidden = !open; b.setAttribute('aria-expanded', String(open)); if (!open) return;
    const box = row.firstElementChild;
    const draw = async (fresh = false) => {
      const [u, p] = await Promise.all([api('/admin/users/' + id), api(`/admin/users/${id}/pnl${fresh ? '?fresh=1' : ''}`).catch(e => ({ error: e.message, accounts: [] }))]);
      const sg = x => (x == null ? '-' : `<b class="${cls(x)}">${money(x)}</b>`);
      box.innerHTML = `<div class="grid" style="gap:12px">
        <div><h3 style="margin:0 0 6px">Account</h3><ul class="plain"><li>Plan: <b>${esc(u.plan || 'free')}</b>${u.plan_status ? ` (${esc(u.plan_status)})` : ''}${u.plan_renews ? ` · renews ${date(u.plan_renews)}` : ''}</li><li>Last sign-in: ${u.lastLogin ? `${date(u.lastLogin.at)} (${esc(u.lastLogin.event)})` : '-'}</li><li>Signed in on ${u.sessions} device${u.sessions === 1 ? '' : 's'}</li><li>Credits: ${u.credits ?? '-'}</li><li>Paper account: ${u.paper ? `${money(u.paper.equity)} (${u.paper.positions} positions)` : '-'}</li><li>Connected: ${u.accounts.map(a => `${esc(a.name)} <span class="pill ${a.live ? 'warn' : ''}">${a.live ? 'real money' : 'paper'}</span>`).join(', ') || 'only the paper account'}</li>${u.stripe_customer ? `<li>Stripe customer: <code>${esc(u.stripe_customer)}</code></li>` : ''}</ul></div>
        <div><h3 style="margin:0 0 6px">Real-money P&amp;L</h3>${p.accounts?.length ? `<div class="stats"><div class="stat"><span>Total</span>${sg(p.total)}</div><div class="stat"><span>Open</span>${sg(p.open)}</div><div class="stat"><span>Realized</span>${sg(p.realized)}</div><div class="stat"><span>Today</span>${sg(p.today)}</div></div><table class="slim">${p.accounts.map(a => `<tr><td>${esc(a.name)}</td><td class="num">${a.error ? `<span class="err">${esc(a.error)}</span>` : `${sg(a.total)} · equity ${money(a.equity)}`}</td></tr>`).join('')}</table>` : `<p class="mu">${p.error ? esc(p.error) : 'No real-money account connected.'}</p>`}<button class="small ghost" data-fresh>Refresh</button></div></div>
        <div class="row" style="margin-top:10px;gap:8px"><button class="small ghost" data-signout>Sign out everywhere</button>${u.role === 'admin' ? '' : '<button class="small danger" data-del>Delete account…</button>'}</div><div class="err"></div>`;
      const err = $('.err', box);
      $('[data-fresh]', box).onclick = () => draw(true);
      $('[data-signout]', box).onclick = async () => { try { const r = await api(`/admin/users/${id}/signout`, { body: {} }); err.textContent = ''; $('[data-signout]', box).textContent = `Signed out (${r.sessions})`; } catch (e) { err.textContent = e.message; } };
      if ($('[data-del]', box)) $('[data-del]', box).onclick = async () => {
        const c = await secureConfirm({ title: `Delete ${u.email}?`, html: `<p>This deletes the account and all its data (strategies, bots, alerts, paper account, connections, settings) for good.${u.stripe_customer ? ' Their Stripe subscription is cancelled now.' : ''} Brokerage accounts at the broker are not closed. The security and order audit logs are kept.</p>`, word: 'DELETE', okText: 'Delete account' });
        if (!c) return;
        try {
          const r = await api('/admin/users/' + id, { method: 'DELETE', body: { word: c.typed, password: c.password, confirm: c.confirm } });
          b.closest('tr').hidden = true; row.hidden = true;
          uerr.textContent = `Deleted ${r.email}.${r.stripe?.cancelled ? ` Cancelled ${r.stripe.cancelled} subscription(s).` : ''}${r.stripe?.error ? ' Stripe: ' + r.stripe.error : ''}`;
        } catch (e) { err.textContent = e.message; }
      };
    };
    try { await draw(); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }));
  if ($('#userFind', view)) $('#userFind', view).oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('#userTable tr[data-email]', view).forEach(tr => (tr.hidden = !!q && !tr.dataset.email.toLowerCase().includes(q))); };
}
for (const [k] of ADMIN_TABS.filter(([k]) => !['admin-system', 'admin-trust', 'admin-data', 'admin-comms', 'admin-upgrades', 'admin-yiddish', 'admin-admins', 'admin-keys'].includes(k))) routes[k] = view => (ME?.role === 'admin' ? adminPage(view, k) : routes.dashboard(view, new URLSearchParams()));

lazyRoutes(() => import('./pages/strategies.js'), 'registerStrategies', { accounts, accountOptions, acctLabel, $, $$, esc, money, cls, date, api, form, act, render, drawChart, onLeave, me: () => ME }, ["strategies", "strategy"]);
registerBrokers(routes, { $, $$, esc, money, api, form, act, render, accounts });
lazyRoutes(() => import('./pages/sp500.js'), 'registerSp500', { accounts, accountOptions, acctLabel, $, $$, esc, money, cls, api, form, act, render, drawChart, me: () => ME }, ["sp500"]);
lazyRoutes(() => import('./pages/pairs.js'), 'registerPairs', { accounts, accountOptions, acctLabel, $, $$, esc, money, cls, api, form, act, render, drawChart, me: () => ME }, ["pairs", "statarb"]);
lazyRoutes(() => import('./pages/signals.js'), 'registerSignals', { accounts, accountOptions, acctLabel, $, $$, esc, money, date, api, form, act, render, me: () => ME }, ["signals"]);
// Page code loads when a page is first opened (one small file per area), not with the app: the
// app itself downloads much less, and nobody downloads pages they cannot open (owner pages, the
// business books). Each area's file is cached by the browser after the first time.
function lazyRoutes(load, fn, helpers, keys) {
  let loading = null;
  const ensure = () => (loading ||= load().then(m => {
    const own = {}; m[fn](own, helpers);
    // Only this area's pages are swapped in (a page another area took over stays with it).
    for (const k of keys) if (routes[k]?.lazyOf === fn) routes[k] = own[k];
  }).catch(e => { loading = null; throw e; }));
  for (const k of keys) routes[k] = Object.assign(async (view, q) => { await ensure(); return routes[k](view, q); }, { lazyOf: fn });
}
registerTrading(routes, { accountBoxes, secureConfirm, accounts, $, $$, esc, money, pct, num, cls, date, api, form, act, drawChart, approvalsBanner, statementRow, wireStatement, prefs: () => PREFS.portfolio, sinceLastLook, sinceStat, onLeave, render, updateBadge, me: () => ME, refreshMe, state });
// Trade, Positions and Orders follow the account chosen in the side panel: the full screens for an
// Alpaca account, simple pages (pages/simple.js) for practice money and the other brokerages.
for (const k of ['trade', 'positions', 'orders']) {
  const full = routes[k];
  routes[k] = async (view, q) => { await accounts(); return /^alpaca/.test(state.account) ? full(view, q) : (await import('./pages/simple.js'))[k](view, q, { ...shared, ticketHtml, wireQuickTicket }); };
}
// The tabs on top of every Marketplace page.
const marketTabs = on => `<div class="chips viewtabs">${NAV.find(([g]) => g === 'Marketplace')[1].map(([k, t]) => `<a href="#/${k}"><button type="button" class="${k === on ? 'on' : ''}">${esc({ marketplace: 'Overview', sharedstrategies: 'Strategies', sharedportfolios: 'Portfolios' }[k] || t)}</button></a>`).join('')}</div>`;
const shared = { extras: () => EXTRAS, setExtras: on => { EXTRAS = on; render.navKey = null; }, marketTabs, $, $$, esc, money, pct, num, cls, date, api, form, act, drawChart, onLeave, render, refreshMe, accounts, accountOptions, acctLabel, state, adminTabs, adminPage, secureConfirm, me: () => ME, paid: () => isPaid(ME) };
lazyRoutes(() => import('./pages/studio.js'), 'registerStudio', shared, ["ai", "agents", "code"]);
lazyRoutes(() => import('./pages/build.js'), 'registerBuild', shared, ["scanner", "portfolios", "fleet", "marketplace", "aimarket", "sharedstrategies", "sharedportfolios", "signalchannels"]);
lazyRoutes(() => import('./pages/analytics.js'), 'registerAnalytics', shared, ["insights", "risk", "values", "halal", "institutions", "spend", "news"]);
lazyRoutes(() => import('./chart.js'), 'registerChart', shared, ["chart"]);
lazyRoutes(() => import('./pages/optionslab.js'), 'registerOptionsLab', shared, ["optionslab"]);
registerProtect(routes, shared);
lazyRoutes(() => import('./pages/owner.js'), 'registerOwner', shared, ["admin-upgrades", "admin-business", "admin-alpaca", "admin-money", "admin-yiddish", "admin-phone", "admin-phoneaccts", "admin-ai", "admin-readme", "admin-admins", "admin-keys"]);
lazyRoutes(() => import('./pages/alts.js'), 'registerAlts', shared, ["private", "realestate"]);
lazyRoutes(() => import('./pages/money.js'), 'registerMoney', shared, ["money"]);
lazyRoutes(() => import('./pages/rules.js'), 'registerRules', shared, ["rules"]);
lazyRoutes(() => import('./pages/trust-admin.js'), 'registerTrustAdmin', shared, ["admin-trust"]);
lazyRoutes(() => import('./pages/luach.js'), 'registerLuach', shared, ["luach"]);
registerAddons(routes, shared);
lazyRoutes(() => import('./pages/instruments.js'), 'registerInstruments', shared, ["invest"]);
registerStart(routes, shared);
lazyRoutes(() => import('./pages/admin-ops.js'), 'registerAdminOps', shared, ["admin-data", "admin-comms", "admin-strategies", "admin-seo", "admin-agents", "admin-hosting"]);
initSearch(shared, [['Main', [...CORE, ['extras', 'My tools']]], ...NAV]);
// My tools: the optional features that have a page.
routes.extras = async (view, q) => (await import('./pages/extras.js')).page(view, q, shared);
// Home: the My day card, when switched on.
{ const home = routes.dashboard; routes.dashboard = async (view, q) => { await home(view, q); if (EXTRAS.myday && view.isConnected) (await import('./pages/extras.js')).myDayCard(shared, view).catch(() => {}); }; }
// Settings in sections: optional features first, then how it looks, trading and taxes, sign-in
// and security, connections, your data. Each card keeps its form and its buttons; only its place changes.
const SET_SECTIONS = [
  ['look', 'Display and language', ['Page guides', 'News pop-ups', 'Portfolio numbers', 'Chart colors', 'Calm mode', 'Language']],
  ['trade', 'Trading and taxes', ['Taxes', 'Add-ons']],
  ['signin', 'Sign-in and security', ['Password', 'Add a password', 'Two-factor authentication', 'Passkeys', 'Phone for SMS & hotline', 'Active sessions', 'Security log']],
  ['links', 'Connections', ['Your brokerage', 'QuantConnect']],
  ['data', 'Your data', ['Your data']],
];
{ const base = routes.settings; routes.settings = async (view, q) => {
  await base(view, q);
  if (!view.isConnected || $('.set-sec', view)) return;
  const cards = $$('.card', view).filter(c => !c.classList.contains('pguide') && (c.parentElement === view || (c.parentElement.classList.contains('grid') && c.parentElement.parentElement === view)));
  const title = c => (c.querySelector('h2')?.textContent || '').trim();
  const secs = [['extras', 'Optional features', []], ...SET_SECTIONS.map(([id, t, names]) => [id, t, cards.filter(c => names.includes(title(c)))])];
  const placed = new Set(secs.flatMap(x => x[2])), rest = cards.filter(c => !placed.has(c));
  if (rest.length) secs.push(['more', 'More', rest]);
  const frag = document.createDocumentFragment(), nav = document.createElement('nav');
  nav.className = 'chips set-nav'; nav.setAttribute('aria-label', 'Sections');
  nav.innerHTML = secs.filter(x => x[0] === 'extras' || x[2].length).map(([id, t]) => `<button type="button" data-sec="set-${id}">${t}</button>`).join('');
  frag.append(nav);
  for (const [id, t, list] of secs) {
    if (id !== 'extras' && !list.length) continue;
    const sec = document.createElement('section'); sec.className = 'set-sec'; sec.id = 'set-' + id;
    sec.innerHTML = `<h2 class="set-h">${t}</h2><div class="${id === 'extras' ? 'set-extras' : list.length > 1 ? 'grid masonry' : 'set-one'}"></div>`;
    for (const c of list) sec.lastElementChild.append(c);
    frag.append(sec);
  }
  $$(':scope > .grid', view).forEach(g => { if (!g.children.length) g.remove(); });
  view.append(frag);
  $$('[data-sec]', nav).forEach(b => (b.onclick = () => $('#' + b.dataset.sec, view)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  await (await import('./pages/extras.js')).settingsCard(shared, $('#set-extras .set-extras', view)).catch(e => console.warn('extras', e));
}; }
startBell(shared);
lazyRoutes(() => import('./pages/wealth.js'), 'registerWealth', shared, ["wealth"]);
lazyRoutes(() => import('./pages/tools.js'), 'registerTools', shared, ["alpaca-tools"]);
lazyRoutes(() => import('./pages/riskpages.js'), 'registerRiskPages', shared, ["riskview", "research", "tokenized", "protection"]);
lazyRoutes(() => import('./pages/retirement.js'), 'registerRetirement', shared, ["retirement"]);
lazyRoutes(() => import('./pages/combined.js'), 'registerCombined', shared, ["accounts"]);
lazyRoutes(() => import('./pages/business.js'), 'registerBusiness', shared, ["currencies", "business", "invoices", "books", "bank", "inventory", "payroll", "bizreports"]);
lazyRoutes(() => import('./pages/social.js'), 'registerSocial', shared, ["traders", "robo"]);
lazyRoutes(() => import('./pages/sponsored.js'), 'registerSponsored', shared, ["admin-sponsored"]);
lazyRoutes(() => import('./pages/aitrade.js'), 'registerAiTrade', shared, ["agenthub", "aibots", "aisignals", "intel"]);
lazyRoutes(() => import('./pages/invest.js'), 'registerInvest', shared, ["analyze", "lowcost", "earnings", "leaders", "short", "margin", "aifunds"]);

// Static files are cached for instant repeat visits (sw.js); pages and data always come fresh.
if (!PREFETCH && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
// The hidden copy opens with the app; a few seconds later it starts loading every section.
if (!PREFETCH) { pfFrameEarly(); setTimeout(() => prefetchAll(), 3000); }

(async () => {
  // Remember an invite code from a referral link (/app?ref=CODE) for sign-up.
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[a-z0-9]{6,12}$/.test(ref)) { try { localStorage.setItem('qp_ref', ref); } catch {} }
  // Language: chosen in Settings → Language.
  await startI18n().catch(e => console.warn('i18n', e));
  let me = null;
  const known = (() => { try { return JSON.parse(localStorage.getItem('qp_me') || 'null'); } catch { return null; } })();
  const getMe = () => fetch('/api/auth/me', { headers: { 'X-Requested-With': 'qp' } }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const knownId = known && (known.email || known.phone);
  if (knownId) {
    // Signed in last time: the page draws at once from what this browser remembers, while the
    // server confirms the sign-in (signed out elsewhere: back to the sign-in page).
    ME = known; keepLoad(knownId); render();
    getMe().then(fresh => {
      if (!fresh) return; // server still waking up: the next request retries
      if (!fresh.user) { keepClear(); ME = null; if (fresh.mfaPending) location.hash = '#/mfa'; render(); return; }
      try { localStorage.setItem('qp_me', JSON.stringify(fresh.user)); } catch {}
      if (JSON.stringify(fresh.user) !== JSON.stringify(known)) { ME = fresh.user; render({ quiet: true }); }
    });
  } else {
    // A server that is waking up (free hosting sleeps) answers late or with an error: keep trying
    // for a while instead of sending a signed-in user back to the sign-in page.
    for (let i = 0; i < 8 && !me; i++) {
      me = await getMe();
      if (!me) { $('#view').innerHTML = '<div class="card auth"><p class="mu">Connecting to Brightolio…</p></div>'; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    me ||= {};
    ME = me.user;
    try { if (ME) localStorage.setItem('qp_me', JSON.stringify(ME)); } catch {}
    if (!ME && me.mfaPending) location.hash = '#/mfa';
    render();
  }
  // Redraw the simulator chart only when the width really changes (not on scrollbar or zoom
  // noise), and only if that page is still showing when the debounce fires.
  let lastW = innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(window.__rt);
    const hash = location.hash;
    window.__rt = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40 && location.hash === hash && /^#\/(dashboard)?$/.test(hash) && state.account !== 'alpaca') { lastW = innerWidth; render(); } }, 300);
  });
})();
