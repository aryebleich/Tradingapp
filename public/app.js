// QuantPocket single-page client. Hash routes, no framework.
import { registerTrading } from './trading.js';
import { registerSignals } from './signals.js';
import { registerStrategies } from './strategies.js';
import { registerPairs } from './pairs.js';
import { registerSp500 } from './sp500.js';
import { registerBrokers } from './brokers.js';
import { registerStudio } from './studio.js';
import { registerBuild } from './build.js';
import { registerAnalytics } from './analytics.js';
import { registerChart } from './chart.js';
import { registerOptionsLab } from './optionslab.js';
import { startI18n, setLang, canvasNote, LANGS, current as currentLang } from './i18n.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = x => (x < 0 ? '-$' : '$') + Math.abs(+x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x, d = 1) => (isFinite(x) ? (x > 0 ? '+' : '') + (+x).toFixed(d) + '%' : '-');
const num = (x, d = 2) => (isFinite(x) ? (+x).toFixed(d) : '-');
const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
const date = t => new Date(t).toLocaleString();

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  // Session expired (or signed out in another tab): go back to sign-in instead of showing errors.
  if (r.status === 401 && ME && !path.startsWith('/auth/')) { ME = null; location.hash = '#/login'; }
  if (r.status === 402 && d.upgrade) showUpgrade(d.feature);
  if (!r.ok) throw new Error(d.error || (r.status >= 500 ? 'The server is busy, please try again.' : r.statusText));
  return d;
}
const form = el => Object.fromEntries($$('[name]', el).map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value]));

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
// Accounts the user can trade (paper, Alpaca, other brokerages), cached for a minute.
let ACCTS = null;
async function accounts(force) {
  if (force || !ACCTS || Date.now() - ACCTS.at > 60e3) ACCTS = { at: Date.now(), list: await api('/accounts').catch(() => [{ id: 'paper', name: 'Paper account', connected: true }]) };
  return ACCTS.list;
}
const acctLabel = a => (a.id === 'paper' ? 'Paper account' : `${a.name}${a.live ? ' (live)' : a.id === 'alpaca' ? '' : ' (test)'}`);
const accountOptions = (list, selected, paid = true) => list.filter(a => a.connected || a.id === selected || a.id === 'alpaca')
  .map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(acctLabel(a))}${a.id !== 'paper' && !paid ? ' · Pro' : ''}${!a.connected ? ' · not connected' : ''}</option>`).join('');
const state = { account: localStorage.getItem('qp_account') || 'paper' };

// ---------- chart: line is green above the starting value and red below it ----------
function drawChart(canvas, series, { base, compare } = {}) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
  if (series.length < 2) { g.fillStyle = C('--mu'); canvasNote(g, 'Your equity curve starts filling in after the first trading day.'); return; }
  base ??= series[0];
  const all = [...series, ...(compare || []), base];
  let lo = Math.min(...all), hi = Math.max(...all); if (hi === lo) { hi += 1; lo -= 1; }
  const pad = 8, X = i => pad + (i / Math.max(series.length - 1, 1)) * (w - 2 * pad), Y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
  const yb = Y(base);
  g.strokeStyle = C('--bd'); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, yb); g.lineTo(w, yb); g.stroke(); g.setLineDash([]);
  if (compare) { g.strokeStyle = C('--mu'); g.lineWidth = 1; g.beginPath(); compare.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke(); }
  const path = () => { g.beginPath(); series.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); };
  for (const [color, y0, y1] of [[C('--gr'), 0, yb], [C('--rd'), yb, h]]) {
    g.save(); g.beginPath(); g.rect(0, y0, w, y1 - y0); g.clip();
    path(); g.lineTo(X(series.length - 1), yb); g.lineTo(X(0), yb); g.closePath();
    g.globalAlpha = 0.14; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    path(); g.lineWidth = 2; g.strokeStyle = color; g.stroke(); g.restore();
  }
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
const NAV = [
  ['Trading', [['dashboard', 'Portfolio'], ['trade', 'Trade'], ['chart', 'Chart'], ['orders', 'Orders'], ['positions', 'Positions'], ['watchlists', 'Watchlists']]],
  ['AI', [['ai', 'AI assistant'], ['agents', 'Forecasts & AI agents'], ['news', 'News & sentiment']]],
  ['Markets', [['sp500', 'S&P 500 plan'], ['markets', 'Markets & news'], ['scanner', 'Scanner'], ['options', 'Options chain'], ['optionslab', 'Options lab'], ['institutions', 'Institutional portfolios'], ['calendar', 'Calendar & events']]],
  ['Strategies', [['strategies', 'Strategy library'], ['backtest', 'Backtest'], ['bots', 'Bots'], ['code', 'Code lab'], ['portfolios', 'Portfolios'], ['signals', 'Alerts to trades'], ['fleet', 'Signal fleet'], ['marketplace', 'Marketplace'], ['pairs', 'Pairs trading'], ['schedule', 'Scheduled trades'], ['quantconnect', 'Cloud algorithms']]],
  ['Money', [['insights', 'Insights & journal'], ['risk', 'Risk controls'], ['spend', 'Invest as you spend'], ['halal', 'Halal investing'], ['tax', 'Taxes']]],
  ['Account', [['brokers', 'Brokerages'], ['account', 'Alpaca account'], ['funding', 'Plans & billing'], ['referrals', 'Invite & earn'], ['text', 'Text & hotline'], ['settings', 'Settings']]],
];
// Simple line icons (24x24 paths) for the menu.
const ICONS = {
  brokers: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
  sp500: '<path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h6v6"/>',
  pairs: '<path d="M7 4v16M17 4v16M4 8h6M14 16h6"/>',
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
  text: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4z"/>',
  'admin-users': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.6 3 5.2"/>',
  'admin-money': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  'admin-support': '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12.5h5"/>',
  'admin-setup': '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  admin: '<path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/>',
  chart: '<path d="M7 4v16M17 6v12M4 8h6v8H4zM14 9h6v6h-6z"/>', ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  agents: '<path d="M3 17l6-6 4 4 8-8"/><circle cx="21" cy="7" r="1"/><path d="M3 21h18"/>', news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5"/>',
  scanner: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6M11 8v6"/>', optionslab: '<path d="M3 18c4 0 5-12 9-12s5 12 9 12"/><path d="M3 21h18"/>',
  institutions: '<path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M2 10l10-6 10 6z"/>', code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  portfolios: '<path d="M12 3v9l7.8 4.5A9 9 0 1 1 12 3z"/><path d="M15 3.5A9 9 0 0 1 20.5 13H15z"/>', fleet: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 11l10-5M7 13l10 5"/>',
  marketplace: '<path d="M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>', insights: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  risk: '<path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/><path d="M12 8v5M12 16h.01"/>', spend: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M16 15h2"/>',
  halal: '<path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/><path d="M17 4l.7 1.5 1.6.2-1.2 1.1.3 1.6L17 7.6l-1.4.8.3-1.6-1.2-1.1 1.6-.2z"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ''}</svg>`;
const isPaid = u => u && (u.role === 'admin' || (['pro', 'elite', 'ultimate'].includes(u.plan) && ['active', 'trialing', null, undefined].includes(u.planStatus)));
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
async function render() {
  while (cleanups.length) { try { cleanups.pop()(); } catch {} }
  const [route, q] = (location.hash.slice(2) || 'dashboard').split('?');
  // Each render gets a fresh container: requests still in flight from the previous page then
  // write into a detached element instead of overwriting the page the user moved to.
  const view = document.createElement('div');
  $('#view').replaceChildren(view);
  // A new page starts at the top instead of keeping the previous page's scroll position.
  scrollTo(0, 0);
  if (!ME && !['login', 'register', 'mfa', 'forgot', 'reset', 'verify', 'open-account'].includes(route)) { location.hash = '#/login'; return; }
  $('#top').hidden = !ME; $('#nav').hidden = !ME; $('#tabs').hidden = !ME;
  setMenu(false);
  $$('#tabs a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === route || (route === '' && a.dataset.r === 'dashboard')));
  if (ME) {
    const groups = ME.role === 'admin' ? [['Owner', ADMIN_TABS], ...NAV] : NAV;
    $('#nav').innerHTML = groups.map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([k, t]) => `<a href="#/${k}" class="${k === route ? 'on' : ''}">${icon(k)}${t}</a>`).join('')).join('')
      + (isPaid(ME) ? '' : `<a href="#/funding" class="upsell">${icon('star')}${ME.trialUsed ? 'Upgrade to Pro' : 'Try Pro free for 14 days'}</a>`)
      + `<div class="grp">${esc(ME.email)}</div><a href="#" id="navLogout">${icon('account')}Sign out</a>`;
    $('#navLogout').onclick = e => { e.preventDefault(); $('#logout').click(); };
    updateBadge();
  }
  view.innerHTML = '<div class="skel"><div class="h1"></div><div class="box"></div><div class="w60"></div><div></div><div class="box"></div></div>';
  try {
    await (routes[route] || routes.dashboard)(view, new URLSearchParams(q));
  }
  catch (e) { view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);
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
  for (const t of root.querySelectorAll('table:not(.chain):not([data-labeled])')) {
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
new MutationObserver(() => labelTables($('#view'))).observe($('#view'), { childList: true, subtree: true });
// Shows which Alpaca account trading goes to (sandbox, paper or live).
let badgeAt = 0;
async function updateBadge(force) {
  if (!force && Date.now() - badgeAt < 60e3) return;
  badgeAt = Date.now();
  const s = await api('/alpaca/status').catch(() => null), b = $('#connBadge');
  if (!s?.active) { b.textContent = 'No brokerage connected'; b.className = 'pill'; return; }
  const kind = { broker: 'Brokerage account', oauth: 'Alpaca (OAuth)', keys: 'Alpaca (API keys)' }[s.active.type];
  b.innerHTML = `<span class="long">${kind} · </span>${s.active.live ? 'LIVE' : s.active.type === 'broker' ? 'Sandbox' : 'Paper'}`;
  b.className = 'pill' + (s.active.live ? ' warn' : '');
}
$('#logout').onclick = async () => { await api('/auth/logout', { body: {} }); ME = null; location.href = '/'; };

const accountSwitch = () => `<div class="seg" id="acctseg">${[['paper', 'Paper'], ['alpaca', 'Alpaca'], ...(ACCTS?.list || []).filter(a => a.connected && !['paper', 'alpaca'].includes(a.id)).map(a => [a.id, a.name])].map(([k, t]) => `<button class="${state.account === k ? 'on' : ''}" data-a="${k}">${t}</button>`).join('')}</div>`;
function wireAccountSwitch(view) {
  $$('#acctseg button', view).forEach(b => (b.onclick = () => { state.account = b.dataset.a; localStorage.setItem('qp_account', state.account); render(); }));
}

// ---------- auth ----------
// "Continue with Google" (shown only when the server has Google sign-in set up).
const G_LOGO = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
async function googleButton(label) {
  CFG ||= await api('/config').catch(() => null);
  if (!CFG?.google) return '';
  let ref = null; try { ref = localStorage.getItem('qp_ref'); } catch {}
  return `<a class="gbtn" href="/auth/google${ref ? '?ref=' + encodeURIComponent(ref) : ''}">${G_LOGO}<span>${label}</span></a><div class="or"><span>or</span></div>`;
}
routes.login = async (view, q) => {
  const g = await googleButton('Continue with Google');
  view.innerHTML = `
  <div class="hero"><h1 data-no-tr>Quant<span style="color:var(--ac)">Pocket</span></h1><p class="mu">Backtest, paper trade and automate stock strategies. Connect your brokerage, trade by text or phone.</p></div>
  <form class="card auth"><h2>Sign in</h2>${g}
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button>Sign in</button><div class="err"></div>
    <p class="mu"><a href="#/forgot">Forgot password?</a> · New here? <a href="#/register">Create an account</a></p></form>`;
  if (q.get('error')) $('.err', view).textContent = q.get('error');
  act($('button', view), async () => {
    const r = await api('/auth/login', { body: form(view) });
    if (r.mfaRequired) { location.hash = '#/mfa'; return; }
    ME = r.user; location.hash = '#/dashboard';
  });
};
routes.register = async (view, q) => {
  const g = await googleButton('Sign up with Google');
  view.innerHTML = `
  <form class="card auth"><h2>Create account</h2>
    ${g ? g.replace('<div class="or">', '<p class="mu small-print">By continuing with Google you agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a> and have read the <a href="/risk" target="_blank">Risk Disclosure</a>.</p><div class="or">') : ''}
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
    ME = (await api('/auth/register', { body: { ...f, ref } })).user; location.hash = '#/dashboard';
  });
};
routes.forgot = view => {
  view.innerHTML = `<form class="card auth"><h2>Reset your password</h2><p class="mu">Enter your email and we will send you a reset link.</p>
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <button>Send reset link</button><div class="err"></div><p class="mu"><a href="#/login">Back to sign in</a></p></form>`;
  act($('button', view), async () => { await api('/auth/forgot', { body: form(view) }); return 'If that email has an account, a reset link is on its way.'; });
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
routes.dashboard = async (view, q) => {
  await accounts();
  if (state.account === 'alpaca') return routes.portfolio(view, q, accountSwitch, wireAccountSwitch);
  const a = await api('/account?account=' + state.account).catch(e => ({ error: e.message }));
  if (a.error) {
    view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Portfolio</h1>${accountSwitch()}</div><div class="card"><p class="err">${esc(a.error)}</p><a href="#/settings">Open Settings</a></div>`;
    return wireAccountSwitch(view);
  }
  const base = a.startCash ?? a.history[0]?.equity ?? a.equity;
  const pnl = a.equity - base, pnlPct = base ? pnl / base * 100 : 0;
  // Today's change: Alpaca reports yesterday's close; for paper use the last snapshot before today.
  const today = new Date().toISOString().slice(0, 10);
  const prev = a.lastEquity || [...a.history].reverse().find(x => x.day < today)?.equity;
  const dayChg = prev ? a.equity - prev : null;
  const steps = [[!!localStorage.getItem('qp_seen_strategies'), 'Try a ready-made strategy', '#/strategies'], [ME.totpEnabled, 'Turn on two-factor login', '#/settings'], [a.positions.length > 0 || state.account !== 'paper', 'Place your first paper trade', '#/dashboard'],
    [ME.phoneVerified && ME.hasPin, 'Add your phone and PIN for SMS', '#/settings'], [!!sessionStorage.getItem('qp_strategy'), 'Backtest a strategy', '#/backtest']];
  const todo = steps.filter(x => !x[0]).length > 1 && !localStorage.getItem('qp_onboard_done');
  view.innerHTML = `
  ${todo ? `<div class="card onboard"><div class="ob-head"><div><h2>Get started</h2><p class="mu">${steps.filter(x => x[0]).length} of ${steps.length} done</p></div><button class="ghost small" id="hideOnboard">Hide</button></div>
    <div class="ob-bar"><i style="width:${Math.round(steps.filter(x => x[0]).length / steps.length * 100)}%"></i></div>
    <div class="ob-list">${steps.map(([done, t, href]) => `<a class="ob-item${done ? ' done' : ''}" href="${href}"><span class="ob-check" aria-hidden="true"></span><span class="ob-t">${t}</span><span class="ob-go" aria-hidden="true">→</span></a>`).join('')}</div></div>` : ''}
  <div class="row" style="justify-content:space-between"><h1>Portfolio ${a.live ? '<span class="pill warn">LIVE MONEY</span>' : state.account === 'alpaca' ? '<span class="pill">Alpaca paper</span>' : '<span class="pill">Simulated</span>'}</h1>${accountSwitch()}</div>
  <div class="card">
    <div class="stats">
      <div class="stat"><span>Equity</span><b>${money(a.equity)}</b></div>
      <div class="stat"><span>Profit / loss</span><b class="${cls(pnl)}">${money(pnl)} (${pct(pnlPct, 2)})</b></div>
      <div class="stat"><span>Today</span><b class="${cls(dayChg)}">${dayChg == null ? '-' : `${money(dayChg)} (${pct(dayChg / prev * 100, 2)})`}</b></div>
      <div class="stat"><span>Cash</span><b>${money(a.cash)}</b></div>
      <div class="stat"><span>Positions</span><b>${a.positions.length}</b></div>
    </div>
    <canvas id="eqc"></canvas>
    <p class="mu" style="font-size:12px">The line turns green above your starting value and red below it.</p>
  </div>
  <div class="grid">
    <div class="card"><h2>Positions</h2><div class="tablewrap"><table><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>Price</th><th>Value</th><th>P/L</th></tr>
      ${a.positions.map(p => `<tr><td>${esc(p.symbol)}</td><td>${num(p.qty, 4)}</td><td>${money(p.avgPrice)}</td><td>${money(p.price)}</td><td>${money(p.value)}</td><td class="${cls(p.pnl)}">${money(p.pnl)}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No positions</td></tr>'}
    </table></div></div>
    <form class="card" id="ticket"><h2>Trade</h2>
      <div class="row"><label>Symbol<input name="symbol" value="SPY" required></label>
        <label>Side<select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label></div>
      <div class="row"><label>Shares<input name="qty" type="number" step="any" min="0"></label><label>or Dollars<input name="notional" type="number" step="any" min="0"></label></div>
      <button>Place market order</button> <button type="button" class="ghost" id="quote">Quote</button><div class="err"></div>
      ${a.live ? '<p class="warn">This sends a real order with real money.</p>' : ''}
    </form>
  </div>
  <div class="card"><h2>Recent orders</h2><div class="tablewrap" id="orders"><p class="mu">Loading…</p></div>
    ${state.account === 'paper' ? '<button class="ghost small" id="reset">Reset paper account</button>' : ''}</div>`;
  wireAccountSwitch(view);
  if ($('#hideOnboard', view)) $('#hideOnboard', view).onclick = () => { try { localStorage.setItem('qp_onboard_done', '1'); } catch {} render(); };
  drawChart($('#eqc', view), a.history.map(x => x.equity), { base });
  const t = $('#ticket', view);
  act($('button', t), async () => {
    const f = form(t);
    if (a.live && !confirm(`Send a LIVE ${f.side} order for ${f.symbol}?`)) return;
    const r = await api('/orders', { body: { ...f, account: state.account } });
    setTimeout(render, 600);
    return `${r.side} ${r.symbol}: ${r.status}${r.price ? ' @ ' + money(r.price) : ''}`;
  });
  act($('#quote', t), async () => { const q = await api('/quote/' + encodeURIComponent(form(t).symbol)); return `${q.symbol} ${money(q.price)}`; });
  if ($('#reset', view)) act($('#reset', view), async () => { if (confirm('Reset paper account to $100,000?')) { await api('/paper/reset', { body: {} }); render(); } });
  const orders = await api('/orders?account=' + state.account).catch(() => []);
  $('#orders', view).innerHTML = `<table><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Status</th><th>Source</th></tr>${orders.map(o => `<tr><td>${date(o.at)}</td><td>${esc(o.symbol)}</td><td>${o.side}</td><td>${o.qty ? num(o.qty, 4) : money(o.notional)}</td><td>${o.price ? money(o.price) : '-'}</td><td>${esc(o.status)}</td><td>${esc(o.source || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">None yet</td></tr>'}</table>`;
};

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
    <canvas id="btc"></canvas><p class="mu" style="font-size:12px">Colored line: strategy (green above starting capital, red below). Grey: buy & hold. ${r.holding ? 'Currently in a position.' : 'Currently flat.'}</p></div>
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
  const [rows, alerts] = await Promise.all([api('/schedule'), api('/alerts')]);
  const soon = new Date(Date.now() + 3600e3); soon.setMinutes(30, 0, 0);
  const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  view.innerHTML = `<h1>Scheduled trades</h1>
  <form class="card" id="sch"><h2>New scheduled order</h2>
    <div class="row"><label>Account<select name="account"><option value="paper">Paper</option><option value="alpaca">Alpaca</option></select></label>
      <label>Side<select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
      <label>Symbol<input name="symbol" value="SPY"></label></div>
    <div class="row"><label>Shares<input name="qty" type="number" step="any"></label><label>or Dollars<input name="notional" type="number" step="any" value="100"></label>
      <label>First run<input name="at" type="datetime-local" value="${local}"></label>
      <label>Repeat<select name="repeat"><option value="once">Once</option><option value="daily">Every trading day</option><option value="weekly" selected>Weekly (DCA)</option><option value="monthly">Monthly</option></select></label></div>
    <button>Schedule</button><div class="err"></div></form>
  <div class="card tablewrap"><table><tr><th>#</th><th>Order</th><th>Account</th><th>Repeat</th><th>Next run</th><th>Last result</th><th></th></tr>
    ${rows.map(o => `<tr class="${o.active ? '' : 'mu'}"><td>${o.id}</td><td>${o.side} ${o.qty ? num(o.qty, 4) : money(o.notional)} ${esc(o.symbol)}</td><td>${o.account}</td><td>${o.repeat}</td><td>${o.active ? date(o.next_run) : 'done'}</td><td>${esc(o.last_result || '')}</td><td>${o.active ? `<button class="small ghost" data-c="${o.id}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="mu">Nothing scheduled</td></tr>'}
  </table></div>
  <form class="card" id="al"><h2>Price alerts (sent by SMS)</h2>
    <div class="row"><label>Symbol<input name="symbol" value="AAPL"></label><label>When price is<select name="op"><option>above</option><option>below</option></select></label><label>Price<input name="price" type="number" step="any"></label><button>Add alert</button></div><div class="err"></div>
    <table>${alerts.map(a => `<tr class="${a.active ? '' : 'mu'}"><td>${esc(a.symbol)} ${a.op} ${money(a.price)}</td><td>${a.active ? 'watching' : 'triggered'}</td><td><button class="small ghost" data-a="${a.id}">Remove</button></td></tr>`).join('')}</table></form>`;
  act($('button', $('#sch', view)), async () => { const f = form($('#sch', view)); await api('/schedule', { body: { ...f, at: new Date(f.at).toISOString() } }); render(); });
  act($('button', $('#al', view)), async () => { await api('/alerts', { body: form($('#al', view)) }); render(); });
  $$('[data-c]', view).forEach(b => (b.onclick = async () => { await api('/schedule/' + b.dataset.c, { method: 'DELETE' }); render(); }));
  $$('[data-a]', view).forEach(b => (b.onclick = async e => { e.preventDefault(); await api('/alerts/' + b.dataset.a, { method: 'DELETE' }); render(); }));
};

// ---------- text & hotline ----------
routes.text = async view => {
  CFG ||= await api('/config');
  const { help } = await api('/command/help');
  view.innerHTML = `<h1>Text & Hotline</h1>
  <div class="grid">
    <div class="card"><h2>Manage your account by SMS or phone</h2>
      ${CFG.hotline ? `<div class="hotline"><span class="mu">QuantPocket's number</span><b dir="ltr">${esc(CFG.hotline)}</b><div class="row" style="gap:8px"><a href="sms:${esc(CFG.hotline)}"><button type="button">Text us</button></a><a href="tel:${esc(CFG.hotline)}"><button type="button" class="ghost">Call</button></a></div></div>
        <p>Text or call from your verified phone.</p>${CFG.assistant ? '<p>The AI assistant understands plain language: "how am I doing this month?", "put $200 into the S&amp;P every week", "what does RSI mean?". Trades always need your PIN.</p>' : ''}` : '<p class="warn">The SMS/voice number is not configured on this server yet (Twilio).</p>'}
      <p class="mu"><span>Phone:</span> ${ME.phone ? `<span dir="ltr">${esc(ME.phone)}</span>` : '<span>not set</span>'} ${ME.phoneVerified ? '<span class="pill">verified</span>' : ''} · <span>PIN:</span> <span>${ME.hasPin ? 'set' : 'not set'}</span> · <a href="#/settings">change in Settings</a></p>
      <pre>${esc(help)}</pre>
      <p class="mu">On the hotline: enter your PIN, then press 1 balance, 2 positions, 3 scheduled trades, 9 pause bots, or say a command like "buy five shares of Apple".</p></div>
    <div class="card"><h2>Try it here</h2>
      <label>Message<input id="cmd" placeholder="${CFG.assistant ? 'How is my account doing?' : 'BAL'}"></label><button id="send">Send</button><div class="err"></div><pre id="reply"></pre></div>
  </div>`;
  act($('#send', view), async () => { $('#reply', view).textContent = (await api('/command', { body: { text: $('#cmd', view).value } })).reply; });
  $('#cmd', view).onkeydown = e => { if (e.key === 'Enter') $('#send', view).click(); };
};

// ---------- tax ----------
routes.tax = async (view, q) => {
  const year = +(q.get('year') || new Date().getFullYear());
  const t = await api(`/tax?account=${state.account}&year=${year}`);
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Tax information</h1>${accountSwitch()}</div>
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
  wireAccountSwitch(view);
  $('#yr', view).onchange = e => (location.hash = '#/tax?year=' + e.target.value);
  if ($('#mtm', view)) $('#mtm', view).onchange = async e => {
    try { await api('/tax/settings', { body: { bracket: t.bracket, stateTax: t.stateRate, mtm: e.target.checked } }); render(); }
    catch (x) { e.target.closest('.card').querySelector('.err').textContent = x.message; }
  };
};

// ---------- funding & plans ----------
routes.funding = routes.billing = async (view, q) => {
  CFG ||= await api('/config');
  const [ledger, fees, pay, accts] = await Promise.all([api('/ledger'), api('/fees'), api('/funding/methods').catch(() => ({ methods: [], fee: {} })), accounts()]);
  let yearly = q.get('interval') === 'year';
  const days = CFG.trialDays || 14, trial = !ME.trialUsed, paid = isPaid(ME);
  const status = ME.planStatus === 'trialing' ? `Free trial · renews ${ME.planRenews ? new Date(ME.planRenews).toLocaleDateString() : ''}` : ME.planStatus === 'past_due' ? 'Payment failed - update your card' : ME.planRenews ? `Renews ${new Date(ME.planRenews).toLocaleDateString()}` : '';
  const draw = () => {
    view.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h1>Plans & billing</h1>${ME.plan !== 'free' ? '<button class="ghost" id="portal">Manage billing</button>' : ''}</div>
    ${q.get('ok') ? '<div class="banner">Thank you! Your plan is being activated. It can take a few seconds to show here.</div>' : ''}
    ${ME.plan !== 'free' ? `<div class="banner">You are on <b>${esc(CFG.plans[ME.plan]?.name || ME.plan)}</b>${ME.planInterval === 'year' ? ' (yearly)' : ''}. ${esc(status)}</div>` : trial ? `<div class="banner">Every paid plan starts with a <b>${days}-day free trial</b>. You won't be charged until it ends, and you can cancel anytime.</div>` : ''}
    <div class="billing-toggle"><div class="seg" id="interval"><button data-i="month" class="${yearly ? '' : 'on'}">Monthly</button><button data-i="year" class="${yearly ? 'on' : ''}">Yearly <span class="save">2 months free</span></button></div></div>
    <div class="plans">${Object.entries(CFG.plans).map(([k, p]) => {
      const price = yearly ? p.yearly : p.monthly, cur = ME.plan === k;
      return `<div class="card plan ${p.popular ? 'best' : ''}">${p.popular ? '<div class="ribbon">Most popular</div>' : ''}
        <h2 style="margin:0">${esc(p.name)} ${cur ? '<span class="pill">Current</span>' : ''}</h2><div class="mu" style="font-size:14px">${esc(p.tagline || '')}</div>
        <div class="price">${price ? '$' + price : '$0'}<small>${price ? (yearly ? '/year' : '/month') : ' forever'}</small></div>
        ${yearly && p.yearly ? `<div class="mu" style="font-size:13px">$${(p.yearly / 12).toFixed(2)}/month billed yearly</div>` : '<div style="height:19px"></div>'}
        <div class="mu" style="font-size:13px;margin-top:6px">+ ${p.perfFee * 100}% of new profits above your high-water mark</div>
        <ul>${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        ${p.monthly && !cur ? `<button data-plan="${k}" class="${p.popular ? '' : 'ghost'}">${trial ? `Start ${days}-day free trial` : `Choose ${esc(p.name)}`}</button>` : cur ? '<button class="ghost" disabled>Your plan</button>' : ''}</div>`;
    }).join('')}</div>
    <div class="err" id="planErr"></div>
    <p class="mu" style="text-align:center;font-size:13px">Secure checkout by Stripe. Cancel anytime from "Manage billing". Prices in USD.</p>
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
      <div class="card"><h2>Performance fee</h2><p>Your rate: <b>${fees.rate * 100}%</b> of new profit. You only pay when an account is above its previous peak, after deposits and withdrawals.</p>
        ${fees.accounts.map(a => `<p class="mu">${esc(a.account)}: high-water mark ${money(a.high_water)}</p>`).join('')}</div>
    </div>
    <div class="card tablewrap"><h2>Billing history</h2><table><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Note</th></tr>
      ${ledger.map(l => `<tr><td>${date(l.at)}</td><td>${esc(l.kind.replace(/_/g, ' '))}</td><td>${money(l.amount)}</td><td>${esc(l.status)}</td><td>${esc(l.memo || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">Nothing yet</td></tr>'}</table></div>`;
    $$('#interval button', view).forEach(b => (b.onclick = () => { yearly = b.dataset.i === 'year'; draw(); }));
    $$('[data-plan]', view).forEach(b => act(b, async () => { location.href = (await api('/billing/checkout', { body: { plan: b.dataset.plan, interval: yearly ? 'year' : 'month' } })).url; }, $('#planErr', view)));
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
  <div class="card" style="background:var(--grad);color:#fff;border:0"><h2 style="color:#fff;font-size:20px">Give your friends a head start. Get $${r.reward} for each one who subscribes.</h2>
    <p style="margin:0;opacity:.9">Share your link. When someone signs up with it and starts a paid plan, $${r.reward} is credited to your account and taken off your next bill.</p></div>
  <div class="card"><h2>Your invite link</h2><div class="refbox"><input id="reflink" readonly value="${esc(r.link)}"><button id="copy">Copy</button>${navigator.share ? '<button class="ghost" id="share">Share</button>' : ''}</div><div class="err"></div></div>
  <div class="card"><div class="stats">
    <div class="stat"><span>Friends who joined</span><b>${r.invited}</b></div>
    <div class="stat"><span>Friends who subscribed</span><b>${r.paying}</b></div>
    <div class="stat"><span>Credit earned</span><b class="pos">${money(r.credit)}</b></div></div></div>`;
  act($('#copy', view), async () => { await navigator.clipboard.writeText(r.link).catch(() => { $('#reflink', view).select(); document.execCommand('copy'); }); return 'Link copied'; });
  if ($('#share', view)) $('#share', view).onclick = () => navigator.share({ title: 'QuantPocket', text: 'Backtest and automate your trading ideas with QuantPocket:', url: r.link }).catch(() => {});
};

// ---------- settings ----------
routes.settings = async view => {
  const [integ, sessions, log] = await Promise.all([api('/integrations'), api('/auth/sessions'), api('/auth/audit')]);
  // Accounts created with Google have no password until they add one; they confirm with their email.
  const pw = ME.hasPassword, confirmLabel = what => pw ? `Password to ${what}` : `Type your email to ${what}`, confirmType = pw ? 'password' : 'email';
  view.innerHTML = `<h1>Settings</h1>
  <div class="grid">
    <div class="card" id="language"><h2>Language</h2>
      <p class="mu">The language of the app on this device.</p>
      <div class="langpick" data-no-tr>${Object.entries(LANGS).map(([k, v]) => `<button type="button" class="${k === currentLang() ? 'on' : ''}" data-setlang="${k}" lang="${k}" dir="${v.dir}" aria-pressed="${k === currentLang()}"><b>${v.name}</b><small>${k === 'yi' ? 'איבערגעזעצט פאר אידישע באניצער' : 'Original'}</small></button>`).join('')}</div></div>
    <div class="card"><h2>Alpaca brokerage</h2>
      <p class="mu">Open a brokerage account, connect your Alpaca account with one click, or use API keys.</p>
      <a href="#/account"><button type="button">Manage brokerage connection</button></a></div>
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
    <form class="card" id="taxs"><h2>Tax rates</h2>
      <label>Federal bracket<select name="bracket">${[0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37].map(b => `<option value="${b}" ${b === ME.taxBracket ? 'selected' : ''}>${b * 100}%</option>`).join('')}</select></label>
      <label>State rate %<input name="stateTax" type="number" step="0.1" value="${ME.stateTax * 100}"></label><button>Save</button><div class="err"></div></form>
    <form class="card" id="pw"><h2>${pw ? 'Password' : 'Add a password'}</h2>${ME.google ? '<p class="mu"><span class="pill">Google</span> Sign in with Google is connected.</p>' : ''}
      ${pw ? '<label>Current<input type="password" name="current" autocomplete="current-password"></label>' : '<p class="mu">Add one to also sign in with your email and password.</p>'}<label>New<input type="password" name="next" autocomplete="new-password"></label><button>${pw ? 'Change password' : 'Save password'}</button><div class="err"></div>
      <p class="mu" style="font-size:12px">${pw ? 'Changing it signs out every other device.' : '10+ characters with upper, lower and a digit.'}</p></form>
  </div>
  <div class="card"><h2>Your data</h2><p class="mu">Download everything we store about you, or permanently delete your account.</p>
    <a href="/api/auth/export"><button type="button" class="ghost">Download my data</button></a>
    <label>${confirmLabel('delete your account')}<input type="${confirmType}" id="delpw" autocomplete="${pw ? 'current-password' : 'off'}"></label><button class="danger" id="delacct">Delete my account</button><div class="err"></div></div>
  <div class="card tablewrap"><h2>Active sessions</h2><table><tr><th>IP address</th><th>Device</th><th>Signed in</th><th></th></tr>${sessions.map(s => `<tr><td>${esc(s.ip)}</td><td data-no-tr>${esc(s.ua.slice(0, 60))}</td><td>${date(s.createdAt)}</td><td>${s.current ? '<span class="pill">this device</span>' : `<button class="small ghost" data-s="${s.id}">Sign out</button>`}</td></tr>`).join('')}</table></div>
  <div class="card tablewrap"><h2>Security log</h2><table><tr><th>When</th><th>Event</th><th>IP address</th></tr>${log.map(l => `<tr><td>${date(l.at)}</td><td>${esc(EVENT_LABELS[l.event] || l.event.replace(/_/g, ' '))}</td><td>${esc(l.ip || '')}</td></tr>`).join('')}</table></div>`;
  $$('[data-setlang]', view).forEach(b => (b.onclick = () => { if (b.dataset.setlang !== currentLang()) setLang(b.dataset.setlang); }));
  const refreshMe = async () => { ME = (await api('/auth/me')).user; };
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
  act($('button', $('#taxs', view)), async () => { const f = form($('#taxs', view)); await api('/tax/settings', { body: { bracket: +f.bracket, stateTax: f.stateTax / 100 } }); await refreshMe(); return 'Saved'; });
  act($('button', $('#pw', view)), async () => { await api('/auth/password', { body: form($('#pw', view)) }); if (!pw) { await refreshMe(); setTimeout(render, 1200); } return pw ? 'Password changed' : 'Password saved'; });
  $$('[data-s]', view).forEach(b => (b.onclick = async () => { await api('/auth/sessions/' + b.dataset.s, { method: 'DELETE' }); render(); }));
  act($('#delacct', view), async () => {
    if (!confirm('Delete your account and all data permanently? This cannot be undone. Your Alpaca account is not affected.')) return;
    const v = $('#delpw', view).value; await api('/auth/delete', { body: { password: v, confirm: v } }); location.href = '/';
  });
};

// ---------- admin ----------
// Owner pages: one route per section so each has its own place in the menu.
const ADMIN_TABS = [['admin', 'Overview'], ['admin-users', 'Users'], ['admin-money', 'Money & fees'], ['admin-support', 'Support inbox'], ['admin-setup', 'Setup']];
async function adminPage(view, tab) {
  const [s, msgs, setup] = await Promise.all([api('/admin/summary'), api('/admin/messages'), tab === 'admin-setup' ? api('/admin/setup') : null]);
  const total = (kind, status) => s.byKind.filter(x => x.kind === kind && (!status || x.status === status)).reduce((a, x) => a + x.total, 0);
  const f = s.funnel, steps = [['Signed up', f.signups], ['Connected a brokerage', f.connected], ['Placed a trade', f.traded], ['In free trial', f.trialing], ['Paying', f.paying]];
  const open = msgs.filter(m => m.status === 'open');
  const tabs = `<div class="chips admintabs">${ADMIN_TABS.map(([k, t]) => `<a href="#/${k}"><button type="button" class="${k === tab ? 'on' : ''}">${t}${k === 'admin-support' && open.length ? ` <span class="pill warn">${open.length}</span>` : ''}</button></a>`).join('')}</div>`;
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
  <div class="card tablewrap"><div class="row" style="justify-content:space-between;align-items:center"><h2>Users</h2><input id="userFind" type="search" placeholder="Search email" style="max-width:260px;margin:0"></div>
    <table id="userTable"><tr><th>Email</th><th>Plan</th><th>Role</th><th>2FA</th><th>Phone</th><th>Joined</th></tr>${s.users.map(u => `<tr data-email="${esc(u.email)}"><td data-no-tr>${esc(u.email)}${u.google ? ' <span class="pill">Google</span>' : ''}</td>
      <td><select data-plan="${u.id}" style="margin:0;min-width:110px">${['free', 'pro', 'elite', 'ultimate'].map(p => `<option value="${p}" ${u.plan === p ? 'selected' : ''}>${p === 'free' ? 'Starter' : p === 'pro' ? 'Pro' : 'Elite'}</option>`).join('')}</select></td>
      <td>${u.role === 'admin' ? `<span class="pill">Admin</span>${u.id !== ME.id ? ` <button class="small ghost" data-role="${u.id}" data-to="user">Remove admin</button>` : ''}` : `<button class="small ghost" data-role="${u.id}" data-to="admin">Make admin</button>`}</td>
      <td>${u.totp_enabled ? 'yes' : '-'}</td><td>${u.phone_verified ? 'yes' : '-'}</td><td>${date(u.created_at)}</td></tr>`).join('')}</table><div class="err" id="userErr"></div>
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
    <p class="mu" style="font-size:12px">Helcim's figure assumes a regulated (big-bank) debit card; cards from small banks and credit cards cost more. Card-network rules and some states limit surcharges on cards, so the service fee is shown up front and charged for the deposit service.</p></div>`,
    'admin-support': () => `
  <div class="card tablewrap"><h2>Support inbox</h2><table>${open.map(m => `<tr><td>${date(m.at)}</td><td data-no-tr>${esc(m.name)} &lt;<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>&gt;</td><td data-no-tr><b>${esc(m.subject)}</b><br><span class="mu" style="white-space:pre-wrap">${esc(m.body)}</span></td><td><button class="small ghost" data-m="${m.id}">Done</button></td></tr>`).join('') || '<tr><td class="mu">Inbox zero</td></tr>'}</table></div>`,
    'admin-setup': () => `
  <div class="card"><h2>Setup</h2><p class="mu" style="margin-top:0">What is switched on, from the environment variables in Render (values are never shown). Admins: <b data-no-tr>${esc(setup.admins.join(', ') || 'none')}</b></p>
    <div class="setup">${setup.items.map(x => `<div class="setup-row"><span class="dot ${x.on ? 'on' : ''}"></span><span class="setup-name">${esc(x.name)}</span><code data-no-tr>${esc(x.env)}</code><span class="pill ${x.on ? '' : 'warn'}">${x.on ? 'On' : 'Not set'}</span></div>`).join('')}</div>
    <p class="mu" style="font-size:12.5px">To change one: Render → your service → Environment → add or edit the variable → Save. The server restarts by itself.</p></div>`,
  };
  view.innerHTML = `<h1>Admin</h1>${tabs}${sections[tab]()}`;
  if ($('#assess', view)) act($('#assess', view), async () => { const r = await api('/admin/assess-fees', { body: {} }); setTimeout(render, 1200); return `Assessed ${r.length} accounts, ${money(r.reduce((a, x) => a + (x.fee || 0), 0))} in new fees`; });
  $$('[data-l]', view).forEach(b => (b.onclick = async () => { await api('/admin/ledger/' + b.dataset.l, { body: { status: b.dataset.s } }); render(); }));
  $$('[data-m]', view).forEach(b => (b.onclick = async () => { await api('/admin/messages/' + b.dataset.m, { body: {} }); render(); }));
  const uerr = $('#userErr', view);
  const userCall = async (id, body) => { uerr.textContent = ''; try { await api('/admin/users/' + id, { body }); render(); } catch (e) { uerr.textContent = e.message; } };
  $$('[data-plan]', view).forEach(sel => (sel.onchange = () => userCall(sel.dataset.plan, { plan: sel.value })));
  $$('[data-role]', view).forEach(b => (b.onclick = () => userCall(b.dataset.role, { role: b.dataset.to })));
  if ($('#userFind', view)) $('#userFind', view).oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('#userTable tr[data-email]', view).forEach(tr => (tr.hidden = !!q && !tr.dataset.email.toLowerCase().includes(q))); };
}
for (const [k] of ADMIN_TABS) routes[k] = view => (ME?.role === 'admin' ? adminPage(view, k) : routes.dashboard(view, new URLSearchParams()));

registerStrategies(routes, { accounts, accountOptions, acctLabel, $, $$, esc, money, cls, date, api, form, act, render, drawChart, onLeave, me: () => ME });
registerBrokers(routes, { $, $$, esc, money, api, form, act, render, accounts });
registerSp500(routes, { accounts, accountOptions, acctLabel, $, $$, esc, money, cls, api, form, act, render, drawChart, me: () => ME });
registerPairs(routes, { accounts, accountOptions, acctLabel, $, $$, esc, money, cls, api, form, act, render, drawChart, me: () => ME });
registerSignals(routes, { accounts, accountOptions, acctLabel, $, $$, esc, money, date, api, form, act, render, me: () => ME });
registerTrading(routes, { $, $$, esc, money, pct, num, cls, date, api, form, act, drawChart, onLeave, render, updateBadge, me: () => ME, state });
const shared = { $, $$, esc, money, pct, num, cls, date, api, form, act, drawChart, onLeave, render, accounts, accountOptions, acctLabel, state, me: () => ME, paid: () => isPaid(ME) };
registerStudio(routes, shared);
registerBuild(routes, shared);
registerAnalytics(routes, shared);
registerChart(routes, shared);
registerOptionsLab(routes, shared);

(async () => {
  // Remember an invite code from a referral link (/app?ref=CODE) for sign-up.
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[a-z0-9]{6,12}$/.test(ref)) { try { localStorage.setItem('qp_ref', ref); } catch {} }
  // Language: chosen in Settings → Language.
  await startI18n().catch(e => console.warn('i18n', e));
  const me = await api('/auth/me').catch(() => ({}));
  ME = me.user;
  if (!ME && me.mfaPending) location.hash = '#/mfa';
  render();
  // Redraw the simulator chart only when the width really changes (not on scrollbar or zoom
  // noise), and only if that page is still showing when the debounce fires.
  let lastW = innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(window.__rt);
    const hash = location.hash;
    window.__rt = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40 && location.hash === hash && /^#\/(dashboard)?$/.test(hash) && state.account !== 'alpaca') { lastW = innerWidth; render(); } }, 300);
  });
})();
