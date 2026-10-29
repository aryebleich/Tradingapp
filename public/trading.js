// Alpaca trading pages: brokerage account & KYC, portfolio, trade ticket, orders, positions,
// markets & news, option chains, watchlists, calendar & corporate actions.
import { canvasNote } from './i18n.js';
let H; // helpers from app.js

export function registerTrading(routes, helpers) {
  H = helpers;
  Object.assign(routes, { account, 'open-account': openAccount, portfolio, trade, orders, positions, markets, options, watchlists, calendar });
}

// ---------- shared helpers ----------
const A = (path, opts) => H.api('/alpaca' + path, opts);
const fmt = (x, d = 2) => (x == null || !isFinite(x) ? '-' : (+x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const usd = x => (x == null || !isFinite(x) ? '-' : H.money(x));
const isCrypto = s => s.includes('/');
const isOption = s => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(s);
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');
const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(t).toLocaleDateString(); };
const OPEN_STATUSES = ['new', 'accepted', 'pending_new', 'partially_filled', 'held', 'accepted_for_bidding', 'pending_replace', 'calculated'];

// Live quotes over Server-Sent Events; closed automatically when the page changes.
function live(symbols, onUpdate) {
  const list = [...new Set(symbols)].filter(Boolean).slice(0, 30);
  if (!list.length || typeof EventSource !== 'function') return;
  const es = new EventSource('/api/alpaca/stream?symbols=' + encodeURIComponent(list.join(',')));
  es.onmessage = e => { try { JSON.parse(e.data).forEach(onUpdate); } catch {} };
  es.addEventListener('hello', e => { try { if (!JSON.parse(e.data).live) es.close(); } catch {} });
  H.onLeave(() => es.close());
}
// Re-run a drawing function when the window width changes, for as long as the page is open.
function onResize(fn) {
  let t, w = innerWidth;
  const h = () => { clearTimeout(t); t = setTimeout(() => { if (Math.abs(innerWidth - w) > 20) { w = innerWidth; fn(); } }, 200); };
  addEventListener('resize', h); H.onLeave(() => { removeEventListener('resize', h); clearTimeout(t); });
}
function every(ms, fn) { const t = setInterval(() => { if (!document.hidden) fn(); }, ms); H.onLeave(() => clearInterval(t)); }
function flash(el, up) { if (!el || document.body.classList.contains('calm')) return; el.classList.remove('flash-up', 'flash-dn'); void el.offsetWidth; el.classList.add(up ? 'flash-up' : 'flash-dn'); }

// Shown instead of a trading page when no Alpaca account is connected yet.
async function needConnection(view, title) {
  const s = await A('/status');
  if (s.active && !(s.active.type === 'broker' && s.broker.account?.status !== 'ACTIVE')) return s;
  const pending = s.broker.account && s.broker.account.status !== 'ACTIVE';
  view.innerHTML = `<h1>${title}</h1><div class="card"><h2>${pending ? 'Your account is being reviewed' : 'Connect a brokerage account to start'}</h2>
    <p class="mu">${pending ? `Application status: <b>${H.esc(s.broker.account.status)}</b>. Trading opens once it is ACTIVE.` : 'Open a new Alpaca brokerage account, connect your existing Alpaca account, or use API keys. Everything starts in the paper / sandbox environment.'}</p>
    <a href="#/account"><button>${pending ? 'Check status' : 'Set up brokerage'}</button></a></div>`;
  return null;
}

// Modal confirm with HTML body; resolves true/false.
function confirmBox(title, html, okText = 'Confirm', danger = false) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h2>${H.esc(title)}</h2><div>${html}</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="ghost" value="no">Cancel</button><button class="${danger ? 'danger' : ''}" value="yes">${H.esc(okText)}</button></div>`;
    document.body.append(d);
    d.querySelectorAll('button').forEach(b => (b.onclick = () => d.close(b.value)));
    d.onclose = () => { resolve(d.returnValue === 'yes'); d.remove(); };
    d.showModal();
  });
}
// Small form dialog; resolves with the field values or null.
function formBox(title, fieldsHtml, okText = 'Save') {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog"><h2>${H.esc(title)}</h2>${fieldsHtml}<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="ghost" value="no" formnovalidate>Cancel</button><button value="yes">${H.esc(okText)}</button></div></form>`;
    document.body.append(d);
    d.onclose = () => { resolve(d.returnValue === 'yes' ? H.form(d) : null); d.remove(); };
    d.showModal();
  });
}

// Candlestick chart with volume and a hover read-out.
function drawCandles(canvas, bars, tipEl) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
  if (!bars.length) { g.fillStyle = C('--mu'); canvasNote(g, 'No price data for this range.'); return; }
  const volH = h * 0.18, ph = h - volH - 16, padR = 56;
  let lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h)); if (hi === lo) { hi += 1; lo -= 1; }
  const vmax = Math.max(...bars.map(b => b.v || 0)) || 1, cw = (w - padR) / bars.length;
  const X = i => i * cw + cw / 2, Y = v => 6 + (1 - (v - lo) / (hi - lo)) * (ph - 12);
  g.font = '11px system-ui'; g.fillStyle = C('--mu'); g.strokeStyle = C('--bd'); g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(w - padR, y); g.stroke(); g.fillText(fmt(v, v < 10 ? 3 : 2), w - padR + 4, y + 4); }
  bars.forEach((b, i) => {
    const up = b.c >= b.o, col = up ? C('--gr') : C('--rd'), x = X(i), bw = Math.max(1, cw * 0.7);
    g.strokeStyle = col; g.fillStyle = col;
    g.beginPath(); g.moveTo(x, Y(b.h)); g.lineTo(x, Y(b.l)); g.stroke();
    const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
    g.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    g.globalAlpha = 0.35; g.fillRect(x - bw / 2, h - (b.v || 0) / vmax * volH, bw, (b.v || 0) / vmax * volH); g.globalAlpha = 1;
  });
  if (tipEl) canvas.onmousemove = e => {
    const r = canvas.getBoundingClientRect(), i = Math.floor((e.clientX - r.left) / cw), b = bars[i];
    if (!b) { tipEl.hidden = true; return; }
    tipEl.hidden = false; tipEl.style.left = Math.min(e.clientX - r.left + 12, w - 190) + 'px'; tipEl.style.top = '8px';
    tipEl.innerHTML = `${new Date(b.t).toLocaleString()}<br>O ${fmt(b.o)} H ${fmt(b.h)} L ${fmt(b.l)} C <b>${fmt(b.c)}</b><br>Vol ${fmt(b.v, 0)}`;
  };
  if (tipEl) canvas.onmouseleave = () => (tipEl.hidden = true);
}

// 1D looks back 5 days and keeps only the latest session, so weekends and holidays still show a chart.
const RANGES = { '1D': ['5Min', 5], '5D': ['15Min', 7], '1M': ['1Hour', 31], '6M': ['1Day', 183], '1Y': ['1Day', 366], '5Y': ['1Week', 1830] };

// =====================================================================
// Brokerage account: connection, onboarding (KYC), configuration, banking
// =====================================================================
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const COUNTRIES = [['USA', 'United States'], ['CAN', 'Canada'], ['GBR', 'United Kingdom'], ['ISR', 'Israel'], ['MEX', 'Mexico'], ['IND', 'India'], ['DEU', 'Germany'], ['FRA', 'France'], ['AUS', 'Australia'], ['BRA', 'Brazil']];

async function account(view, q) {
  const s = await A('/status');
  const me = H.me();
  const banner = q.get('connected') ? '<div class="banner">Your Alpaca account is connected.</div>' : q.get('error') ? `<div class="banner err">${H.esc(q.get('error'))}</div>` : '';
  const conn = s.active;
  const label = { broker: 'Brokerage account (Broker API)', oauth: 'Alpaca account (OAuth)', keys: 'Alpaca API keys' };
  view.innerHTML = `<h1>Brokerage account</h1>${banner}
  <div class="card"><h2>Trading connection</h2>
    ${conn ? `<p>Orders go to: <b>${label[conn.type]}</b> <span class="pill ${conn.live ? 'warn' : ''}">${conn.live ? 'LIVE MONEY' : conn.type === 'broker' ? 'Sandbox' : 'Paper'}</span></p>` : '<p class="mu">Nothing connected yet. Choose one of the options below.</p>'}
    ${s.available.length > 1 ? `<div class="chips" id="connPick">${s.available.map(t => `<button data-t="${t}" class="${conn?.type === t ? 'on' : ''}">${label[t]}</button>`).join('')}</div>` : ''}
  </div>
  <div id="brokerBox"></div>
  ${conn ? '<details class="card"><summary style="cursor:pointer"><b>Other ways to connect</b> <span class="mu">(existing Alpaca account or API keys)</span></summary><div style="margin-top:12px">' : ''}
  <div class="grid">
    <div class="card"><h2>Connect an existing Alpaca account</h2>
      ${s.oauth.enabled ? (s.oauth.connected ? '<p class="pos">Connected with OAuth.</p><button class="ghost" id="oauthOff">Disconnect</button>' : '<p class="mu">Sign in at Alpaca and approve access. We never see your Alpaca password.</p><button id="oauthGo">Connect with Alpaca</button>') : '<p class="mu">OAuth is not configured on this server yet.</p>'}<div class="err"></div></div>
    <form class="card" id="keysForm"><h2>Use API keys</h2>
      <p class="mu">${s.keys.connected ? `Keys saved (${s.keys.live ? '<b class="warn">live</b>' : 'paper'}). Enter new ones to replace them.` : 'From the Alpaca dashboard → API keys. Stored encrypted.'}</p>
      <label>API key ID<input name="keyId" autocomplete="off" required></label><label>Secret key<input name="secret" type="password" autocomplete="off" required></label>
      <label class="check"><input type="checkbox" name="live"> These are live (real money) keys</label>
      <button>Save keys</button><div class="err"></div></form>
  </div>${conn ? '</div></details>' : ''}
  <div id="configBox"></div>`;
  H.$$('#connPick button', view).forEach(b => (b.onclick = async () => { await A('/connection', { body: { type: b.dataset.t } }); H.updateBadge(true); H.render(); }));
  if (H.$('#oauthGo', view)) H.act(H.$('#oauthGo', view), async () => { location.href = (await A('/oauth/start')).url; });
  if (H.$('#oauthOff', view)) H.act(H.$('#oauthOff', view), async () => { await A('/oauth', { method: 'DELETE' }); H.updateBadge(true); H.render(); });
  H.act(H.$('#keysForm button', view), async () => { const r = await A('/keys', { body: H.form(H.$('#keysForm', view)) }); H.updateBadge(true); setTimeout(H.render, 900); return 'Connected. Equity ' + usd(r.equity); });

  const box = H.$('#brokerBox', view);
  if (!s.broker.enabled) box.innerHTML = '';
  else if (!s.broker.account) renderOnboarding(box, me);
  else await renderBrokerAccount(box);
  if (conn && !(conn.type === 'broker' && s.broker.account?.status !== 'ACTIVE')) renderConfig(H.$('#configBox', view));
}

// ---------- account opening (Broker API, POST /v1/accounts via our server) ----------
// Five steps in the order Alpaca's KYC needs them. Nothing here talks to Alpaca directly: the
// browser sends the form to /api/alpaca/broker/accounts and the server signs the request.
const DOC_KINDS = [['passport', 'Passport'], ['drivers_license', "Driver's license"], ['national_id_card', 'National ID card'], ['state_id', 'State ID']];
const MAX_DOC = 5 * 1024 * 1024;
const FUNDING = [['employment_income', 'Employment income'], ['investments', 'Investments'], ['inheritance', 'Inheritance'], ['business_income', 'Business income'], ['savings', 'Savings'], ['family', 'Family']];
const DISCLOSURES = [
  ['isControlPerson', 'Are you a 10% shareholder, director or officer of a public company? (control person)'],
  ['isAffiliated', 'Are you affiliated with a stock exchange or FINRA?'],
  ['isPoliticallyExposed', 'Are you a senior political figure (politically exposed person)?'],
  ['familyExposed', 'Is an immediate family member a senior political figure?'],
];
// Like H.form, but radio groups give the checked value.
const collect = el => Object.fromEntries(H.$$('[name]', el).filter(i => i.type !== 'radio' || i.checked).filter(i => i.type !== 'file').map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value]));
const readFile = file => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(new Error('Could not read ' + file.name)); r.readAsDataURL(file); });
async function pickDocs(input, kind, list) {
  for (const f of input.files) {
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)) throw new Error(`${f.name}: use a JPG, PNG or PDF`);
    if (f.size > MAX_DOC) throw new Error(`${f.name} is larger than 5 MB`);
    if (list.length >= 4) throw new Error('Upload at most 4 documents');
    list.push({ subType: kind, mimeType: f.type, content: await readFile(f), name: f.name, size: f.size });
  }
  input.value = '';
}
const docList = list => list.map((d, i) => `<div class="doc"><span>${H.esc(DOC_KINDS.find(k => k[0] === d.subType)?.[1] || d.subType)}: ${H.esc(d.name)} <span class="mu">(${Math.ceil(d.size / 1024)} KB)</span></span><button type="button" class="small ghost" data-rm="${i}">Remove</button></div>`).join('');

function renderOnboarding(box, me) {
  const data = { email: me.email, citizenship: 'USA', countryOfBirth: 'USA', taxResidence: 'USA', fundingSource: 'employment_income', employmentStatus: 'EMPLOYED', docKind: 'passport', documents: [] };
  for (const [k] of DISCLOSURES) data[k] = 'no';
  let step = 0;
  const STEPS = ['Contact', 'Identity', 'Disclosures', 'Agreements', 'Documents'];
  const sel = (name, opts) => `<select name="${name}">${opts.map(([v, t]) => `<option value="${v}" ${data[name] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const val = k => H.esc(data[k] ?? '');
  const yes = k => (data[k] ? 'checked' : '');
  const yn = (k, q) => `<div class="yn"><span>${q}</span><span class="seg" role="radiogroup"><label><input type="radio" name="${k}" value="no" ${data[k] !== 'yes' ? 'checked' : ''}> No</label><label><input type="radio" name="${k}" value="yes" ${data[k] === 'yes' ? 'checked' : ''}> Yes</label></span></div>`;
  const pages = [
    () => `<div class="row"><label>Email<input name="email" type="email" value="${val('email')}" required autocomplete="email"></label><label>Mobile phone<input name="phone" type="tel" value="${val('phone')}" required placeholder="+17185551234" autocomplete="tel"></label></div>
      <div class="row"><label style="flex:3">Street address<input name="street" value="${val('street')}" required autocomplete="address-line1"></label><label>Apt / unit<input name="unit" value="${val('unit')}" autocomplete="address-line2"></label></div>
      <div class="row"><label>City<input name="city" value="${val('city')}" required autocomplete="address-level2"></label><label>State${sel('state', STATES.map(x => [x, x]))}</label><label>ZIP code<input name="postalCode" value="${val('postalCode')}" required inputmode="numeric" pattern="\\d{5}(-\\d{4})?" autocomplete="postal-code"></label></div>`,
    () => `<div class="row"><label>First name<input name="givenName" value="${val('givenName')}" required autocomplete="given-name"></label><label>Middle name<input name="middleName" value="${val('middleName')}" autocomplete="additional-name"></label><label>Last name<input name="familyName" value="${val('familyName')}" required autocomplete="family-name"></label></div>
      <div class="row"><label>Date of birth<input name="dateOfBirth" type="date" value="${val('dateOfBirth')}" required autocomplete="bday"></label>
      <label>Social Security number<input name="ssn" value="${val('ssn')}" required inputmode="numeric" autocomplete="off" placeholder="123-45-6789" pattern="\\d{3}-?\\d{2}-?\\d{4}"></label></div>
      <div class="row"><label>Country of citizenship${sel('citizenship', COUNTRIES)}</label><label>Country of birth${sel('countryOfBirth', COUNTRIES)}</label><label>Tax residence${sel('taxResidence', COUNTRIES)}</label></div>
      <label>Main source of funds${sel('fundingSource', FUNDING)}</label>
      <p class="mu" style="font-size:13px">Required by law to verify your identity (KYC). Your SSN goes to Alpaca over an encrypted connection and is not stored by Brightfolio.</p>`,
    () => `<fieldset><legend>Disclosures</legend>${DISCLOSURES.map(([k, q]) => yn(k, q)).join('')}</fieldset>
      <details><summary>Employment (optional)</summary><div class="row"><label>Employment${sel('employmentStatus', [['EMPLOYED', 'Employed'], ['UNEMPLOYED', 'Unemployed'], ['STUDENT', 'Student'], ['RETIRED', 'Retired']])}</label>
      <label>Employer<input name="employerName" value="${val('employerName')}"></label><label>Position<input name="employmentPosition" value="${val('employmentPosition')}"></label></div></details>`,
    () => `<fieldset><legend>Account features</legend>
        <label class="check"><input type="checkbox" name="margin" ${yes('margin')}> Apply for a margin account (Margin Agreement)</label>
        <label class="check"><input type="checkbox" name="options" ${yes('options')}> Enable options trading (Options Agreement)</label>
        <label class="check"><input type="checkbox" name="crypto" ${yes('crypto')}> Enable crypto trading (Crypto Agreement)</label></fieldset>
      <fieldset><legend>Agreements</legend>
        <p style="font-size:14px">Read the <a href="https://alpaca.markets/disclosures" target="_blank" rel="noopener">Alpaca Customer Agreement and disclosures</a>${data.margin ? ', the Margin Agreement' : ''}${data.options ? ', the Options Agreement' : ''}${data.crypto ? ', the Crypto Agreement' : ''}.</p>
        <label class="check"><input type="checkbox" name="agreeCustomer" ${yes('agreeCustomer')} required> I have read and agree to the Alpaca agreements above and the Brightfolio Terms. I certify the information I provided is true.</label>
        <p class="mu" style="font-size:12px">Your agreement is recorded with the time you submit and your IP address, as Alpaca requires.</p></fieldset>`,
    () => `<p class="mu">Optional: adding a photo of your ID now can speed up approval. You can also upload later if Alpaca asks for it.</p>
      <div class="row"><label>Document${sel('docKind', DOC_KINDS)}</label><label>File (JPG, PNG or PDF, up to 5 MB)<input type="file" id="docFile" accept="image/jpeg,image/png,application/pdf" multiple></label></div>
      <div id="docs">${docList(data.documents)}</div>
      <h3>Review</h3><div class="kv">
        <span>Name</span><span>${val('givenName')} ${val('familyName')}</span><span>Date of birth</span><span>${val('dateOfBirth')}</span>
        <span>SSN</span><span>•••-••-${H.esc(String(data.ssn || '').replace(/\D/g, '').slice(-4))}</span><span>Address</span><span>${val('street')}, ${val('city')} ${val('state')} ${val('postalCode')}</span>
        <span>Email / phone</span><span>${val('email')} · ${val('phone')}</span>
        <span>Disclosures</span><span>${DISCLOSURES.filter(([k]) => data[k] === 'yes').length ? DISCLOSURES.filter(([k]) => data[k] === 'yes').length + ' answered yes' : 'None apply'}</span>
        <span>Agreements</span><span>Customer${data.margin ? ', Margin' : ''}${data.options ? ', Options' : ''}${data.crypto ? ', Crypto' : ''}</span></div>`,
  ];
  const last = STEPS.length - 1;
  const draw = () => {
    box.innerHTML = `<form class="card" id="onb" novalidate><h2>Open a brokerage account</h2>
      <p class="mu">Takes about 3 minutes. Accounts are held by Alpaca Securities LLC, member FINRA/SIPC.</p>
      <div class="steps">${STEPS.map((t, i) => `<div class="${i < step ? 'done' : i === step ? 'cur' : ''}">${t}</div>`).join('')}</div>
      <p class="mu stepof">Step ${step + 1} of ${STEPS.length}: <b>${STEPS[step]}</b></p>
      ${pages[step]()}
      <div class="row" style="justify-content:space-between;margin-top:10px">${step ? '<button type="button" class="ghost" id="back">Back</button>' : '<span></span>'}<button id="next">${step === last ? 'Submit application' : 'Continue'}</button></div><div class="err" id="onbErr"></div></form>`;
    const f = H.$('#onb', box);
    const save = () => Object.assign(data, collect(f));
    if (H.$('#back', box)) H.$('#back', box).onclick = () => { save(); step--; draw(); };
    H.$$('input[name=options],input[name=margin],input[name=crypto]', f).forEach(i => (i.onchange = () => { save(); draw(); }));
    const file = H.$('#docFile', f);
    if (file) file.onchange = async () => {
      const err = H.$('#onbErr', box); err.textContent = '';
      try { save(); await pickDocs(file, data.docKind, data.documents); } catch (e) { err.textContent = e.message; }
      draw();
    };
    H.$$('[data-rm]', f).forEach(b => (b.onclick = () => { save(); data.documents.splice(+b.dataset.rm, 1); draw(); }));
    H.act(H.$('#next', box), async () => {
      const bad = [...f.querySelectorAll('input:not([type=file]),select')].find(i => !i.checkValidity());
      if (bad) { bad.focus(); throw new Error(`Check "${bad.closest('label')?.textContent.trim().split('\n')[0] || bad.name}"`); }
      save();
      if (step < last) { step++; draw(); return; }
      if (!(await confirmBox('Submit application?', '<p>Your information will be sent to Alpaca for identity verification.</p>', 'Submit'))) return;
      const { docKind, documents, ...body } = data;
      await A('/broker/accounts', { body: { ...body, documents: documents.map(({ subType, mimeType, content }) => ({ subType, mimeType, content })) } });
      H.updateBadge(true); H.render();
    }, H.$('#onbErr', box));
  };
  draw();
}

// Status dashboard: where the application stands, what to do next, and its history. Changes
// arrive live from /broker/events/stream (relayed from Alpaca's event feed); a slow poll is the backup.
const KYC_TRACK = [['SUBMITTED', 'Submitted'], ['REVIEW', 'Under review'], ['APPROVED', 'Approved'], ['ACTIVE', 'Active']];
const trackPos = s => (s === 'ACTIVE' ? 3 : s === 'APPROVED' ? 2 : ['APPROVAL_PENDING', 'REAPPROVAL_PENDING', 'ACTION_REQUIRED', 'RESUBMITTED', 'AML_REVIEW', 'KYC_SUBMITTED'].includes(s) ? 1 : 0);
async function renderBrokerAccount(box) {
  const a = await A('/broker/account');
  const info = a.info, pos = trackPos(a.status), final = ['ACTIVE', 'REJECTED', 'ACCOUNT_CLOSED', 'DISABLED'].includes(a.status);
  const bad = info.tone === 'bad';
  box.innerHTML = `<div class="card kycstat ${info.tone}" id="kycStatus"><div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><div class="mu" style="font-size:13px">Brokerage account ${H.esc(a.accountNumber || '')}</div><h2 style="margin:4px 0">${H.esc(info.title)}</h2></div>
      <span class="pill ${info.tone === 'ok' ? '' : 'warn'}">${H.esc(a.status)}</span></div>
    <p>${H.esc(info.detail)}${a.kyc?.summary && bad ? ' Result: ' + H.esc(a.kyc.summary) + '.' : ''}${info.action === 'support' ? ' <a href="/contact">Contact support</a>.' : ''}</p>
    <div class="steps">${KYC_TRACK.map(([, t], i) => `<div class="${bad ? '' : pos > i || a.status === 'ACTIVE' ? 'done' : pos === i ? 'cur' : ''}">${t}</div>`).join('')}</div>
    ${final ? '' : `<p class="mu live-note"><span class="dot ${a.live ? 'on' : ''}"></span> ${a.live ? 'Live: this page updates the moment Alpaca decides.' : 'This page checks for updates automatically.'}</p>`}
  </div>
  ${info.action === 'documents' ? `<form class="card" id="docForm"><h2>Upload documents</h2><p class="mu">A clear photo or scan of a government ID. JPG, PNG or PDF, up to 5 MB each.</p>
    <div class="row"><label>Document<select name="docKind">${DOC_KINDS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label><label>File<input type="file" id="docFile" accept="image/jpeg,image/png,application/pdf" multiple></label></div>
    <div id="docs"></div><button>Upload</button><div class="err"></div></form>` : ''}
  <div class="grid">
    <div class="card"><h2>Account details</h2><div class="kv"><span>Name</span><span>${H.esc(a.name || '')}</span><span>Account number</span><span>${H.esc(a.accountNumber || '-')}</span><span>Crypto</span><span>${H.esc(a.cryptoStatus || 'not enabled')}</span><span>Enabled assets</span><span>${H.esc((a.enabledAssets || []).join(', '))}</span><span>Agreements</span><span>${H.esc((a.agreements || []).map(x => x.replace('_agreement', '')).join(', '))}</span><span>Opened</span><span>${H.date(a.createdAt)}</span></div>
      <details style="margin-top:10px"><summary>Update contact details</summary><form id="contactForm">
      <div class="row"><label>Email<input name="email" value="${H.esc(a.contact?.email_address || '')}"></label><label>Phone<input name="phone" value="${H.esc(a.contact?.phone_number || '')}"></label></div>
      <div class="row"><label style="flex:3">Street<input name="street" value="${H.esc(a.contact?.street_address?.[0] || '')}"></label><label>Unit<input name="unit" value="${H.esc(a.contact?.unit || '')}"></label></div>
      <div class="row"><label>City<input name="city" value="${H.esc(a.contact?.city || '')}"></label><label>State<input name="state" value="${H.esc(a.contact?.state || '')}"></label><label>ZIP<input name="postalCode" value="${H.esc(a.contact?.postal_code || '')}"></label></div>
      <button>Save changes</button><div class="err"></div></form></details></div>
    <div class="card"><h2>Application history</h2><ol class="timeline">${(a.history || []).slice().reverse().map(e => `<li><b>${H.esc(e.status_to)}</b>${e.reason ? ` <span class="mu">${H.esc(e.reason)}</span>` : ''}<div class="mu">${new Date(e.at).toLocaleString()} · ${e.source === 'sse' ? 'Alpaca event' : e.source === 'created' ? 'Application sent' : 'Status check'}</div></li>`).join('') || '<li class="mu">No updates yet</li>'}</ol></div>
  </div>
  ${a.status === 'ACTIVE' ? '<div class="grid"><div class="card" id="achBox"></div><div class="card" id="trBox"></div></div>' : ''}`;
  H.act(H.$('#contactForm button', box), async () => { await A('/broker/account', { body: H.form(H.$('#contactForm', box)), method: 'PATCH' }); return 'Saved'; });
  const df = H.$('#docForm', box);
  if (df) {
    const docs = [], file = H.$('#docFile', df), list = H.$('#docs', df);
    const redraw = () => { list.innerHTML = docList(docs); H.$$('[data-rm]', list).forEach(b => (b.onclick = () => { docs.splice(+b.dataset.rm, 1); redraw(); })); };
    file.onchange = async () => { const err = H.$('.err', df); err.textContent = ''; try { await pickDocs(file, df.docKind.value, docs); } catch (e) { err.textContent = e.message; } redraw(); };
    H.act(H.$('button:not([data-rm])', df), async () => {
      if (!docs.length) throw new Error('Choose a file to upload');
      await A('/broker/documents', { body: { documents: docs.map(({ subType, mimeType, content }) => ({ subType, mimeType, content })) } });
      H.render();
    });
  }
  if (!final) {
    // Live updates; the stream closes when the user leaves the page.
    let es = null;
    try {
      es = new EventSource('/api/alpaca/broker/events/stream');
      const refresh = () => { es.close(); H.updateBadge(true); H.render(); };
      es.addEventListener('status', refresh);
      // A change between loading this page and the stream connecting would otherwise be missed.
      es.addEventListener('hello', e => { try { if (JSON.parse(e.data).status !== a.status) refresh(); } catch {} });
    } catch {}
    const t = setInterval(() => { if (!document.hidden) H.render(); }, a.live ? 60000 : 15000);
    H.onLeave(() => { clearInterval(t); es?.close(); });
  }
  if (a.status === 'ACTIVE') await renderBanking(H.$('#achBox', box), H.$('#trBox', box));
}

// Public page for new customers: create the Brightfolio login (if needed), then the application.
async function openAccount(view) {
  const me = H.me();
  if (!me) {
    view.innerHTML = `<div class="hero"><h1>Open a brokerage account</h1><p class="mu">Commission-free US stocks and ETFs, plus options and crypto, at Alpaca Securities LLC (member FINRA/SIPC). Apply in about 3 minutes, all from Brightfolio.</p></div>
      <form class="card auth" id="oaReg"><h2>1. Create your Brightfolio login</h2>
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>Password (10+ chars, upper, lower, digit)<input name="password" type="password" autocomplete="new-password" required></label>
      <label><input type="checkbox" name="agree" style="width:auto"> I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a> and have read the <a href="/risk" target="_blank">Risk Disclosure</a>.</label>
      <button>Continue to application</button><div class="err"></div>
      <p class="mu">Already have a login? <a href="#/login">Sign in</a>, then open Account → Alpaca account.</p></form>`;
    H.act(H.$('#oaReg button', view), async () => {
      const f = H.form(H.$('#oaReg', view));
      if (!f.agree) throw new Error('Please accept the Terms to continue');
      let ref = null; try { ref = localStorage.getItem('qp_ref'); } catch {}
      await H.api('/auth/register', { body: { ...f, ref } });
      location.reload(); // signed in now; the page reopens on the application
    });
    return;
  }
  const s = await A('/status');
  if (!s.broker.enabled) { view.innerHTML = '<h1>Open a brokerage account</h1><div class="card"><p>Brokerage accounts are not available on this server yet. You can still <a href="#/account">connect an existing Alpaca account</a>.</p></div>'; return; }
  view.innerHTML = '<h1>Open a brokerage account</h1><div id="brokerBox"></div>';
  const box = H.$('#brokerBox', view);
  if (s.broker.account) await renderBrokerAccount(box); else renderOnboarding(box, me);
}

async function renderBanking(achBox, trBox) {
  const [rels, trs] = await Promise.all([A('/broker/ach'), A('/broker/transfers')]);
  achBox.innerHTML = `<h2>Bank accounts (ACH)</h2>
    ${rels.map(r => `<div class="row" style="justify-content:space-between"><span>${H.esc(r.nickname || r.bank_account_type)} ${H.esc(r.bank_account_number || '')} <span class="pill">${H.esc(r.status)}</span></span><button class="small ghost" data-del="${H.esc(r.id)}">Remove</button></div>`).join('') || '<p class="mu">No bank linked yet.</p>'}
    <details ${rels.length ? '' : 'open'}><summary>Link a bank account</summary><form id="achForm">
      <label>Account holder name<input name="ownerName" required autocomplete="name"></label>
      <div class="row"><label>Routing number<input name="routingNumber" required inputmode="numeric" pattern="\\d{9}"></label><label>Account number<input name="accountNumber" required inputmode="numeric"></label></div>
      <div class="row"><label>Type<select name="accountType"><option>CHECKING</option><option>SAVINGS</option></select></label><label>Nickname<input name="nickname" placeholder="My checking"></label></div>
      <button>Link bank</button><div class="err"></div><p class="mu" style="font-size:12px">Sandbox accepts test numbers, e.g. routing 121000358.</p></form></details>`;
  H.act(H.$('#achForm button', achBox), async () => { await A('/broker/ach', { body: H.form(H.$('#achForm', achBox)) }); H.render(); });
  H.$$('[data-del]', achBox).forEach(b => (b.onclick = async () => { if (await confirmBox('Remove bank account?', '<p>Pending transfers may be cancelled.</p>', 'Remove', true)) { await A('/broker/ach/' + b.dataset.del, { method: 'DELETE' }); H.render(); } }));
  const approved = rels.filter(r => r.status === 'APPROVED');
  trBox.innerHTML = `<h2>Transfers</h2>
    ${approved.length ? `<form id="trForm"><div class="row"><label>Direction<select name="direction"><option value="INCOMING">Deposit to brokerage</option><option value="OUTGOING">Withdraw to bank</option></select></label>
      <label>Bank<select name="relationshipId">${approved.map(r => `<option value="${H.esc(r.id)}">${H.esc(r.nickname || r.bank_account_type)} ${H.esc(r.bank_account_number || '')}</option>`).join('')}</select></label><label>Amount (USD)<input name="amount" type="number" min="1" max="50000" step="0.01" required></label></div>
      <button>Submit transfer</button><div class="err"></div></form>` : '<p class="mu">Link and approve a bank account first.</p>'}
    <div class="tablewrap"><table><tr><th>Date</th><th>Direction</th><th class="num">Amount</th><th>Status</th><th></th></tr>
    ${trs.map(t => `<tr><td>${H.date(t.created_at)}</td><td>${t.direction === 'INCOMING' ? 'Deposit' : 'Withdrawal'}</td><td class="num">${usd(+t.amount)}</td><td>${H.esc(t.status)}</td><td>${['QUEUED', 'PENDING', 'SENT_TO_CLEARING', 'APPROVAL_PENDING'].includes(t.status) ? `<button class="small ghost" data-cx="${H.esc(t.id)}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No transfers yet</td></tr>'}</table></div>`;
  if (H.$('#trForm', trBox)) H.act(H.$('#trForm button', trBox), async () => {
    const f = H.form(H.$('#trForm', trBox));
    if (!(await confirmBox('Confirm transfer', `<p>${f.direction === 'INCOMING' ? 'Deposit' : 'Withdraw'} <b>${usd(+f.amount)}</b>?</p>`))) return;
    await A('/broker/transfers', { body: f }); H.render();
  });
  H.$$('[data-cx]', trBox).forEach(b => (b.onclick = async () => { await A('/broker/transfers/' + b.dataset.cx, { method: 'DELETE' }); H.render(); }));
}

async function renderConfig(box) {
  const c = await A('/account/config').catch(() => null);
  if (!c) return;
  const opt = (name, vals) => `<select name="${name}">${vals.map(([v, t]) => `<option value="${v}" ${String(c[name]) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  box.innerHTML = `<form class="card" id="cfg"><h2>Account settings</h2>
    <div class="row"><label>Day-trade buying power check${opt('dtbp_check', [['entry', 'On entry'], ['exit', 'On exit'], ['both', 'Both']])}</label>
      <label>Pattern day trader check${opt('pdt_check', [['entry', 'On entry'], ['exit', 'On exit'], ['both', 'Both']])}</label>
      <label>Max margin${opt('max_margin_multiplier', [['1', '1x (cash)'], ['2', '2x'], ['4', '4x']])}</label>
      <label>Trade confirmations${opt('trade_confirm_email', [['all', 'Email every fill'], ['none', 'None']])}</label>
      ${c.max_options_trading_level !== undefined ? `<label>Max options level${opt('max_options_trading_level', [['0', '0 (disabled)'], ['1', '1 (covered)'], ['2', '2 (long)'], ['3', '3 (spreads)']])}</label>` : ''}</div>
    <label class="check"><input type="checkbox" name="fractional_trading" ${c.fractional_trading ? 'checked' : ''}> Fractional shares</label>
    <label class="check"><input type="checkbox" name="no_shorting" ${c.no_shorting ? 'checked' : ''}> Disable short selling</label>
    <label class="check"><input type="checkbox" name="suspend_trade" ${c.suspend_trade ? 'checked' : ''}> Suspend all trading (kill switch)</label>
    <button>Save settings</button><div class="err"></div></form>`;
  H.act(H.$('#cfg button', box), async () => { await A('/account/config', { body: H.form(H.$('#cfg', box)), method: 'PATCH' }); return 'Saved'; });
}

// =====================================================================
// Portfolio: balances, margin, equity history, positions summary
// =====================================================================
async function portfolio(view, q) {
  const s = await needConnection(view, 'Portfolio');
  if (!s) return;
  const period = q.get('period') || localStorage.getItem('qp_period') || '1M';
  const [a, h, ps, clock] = await Promise.all([A('/account'), A('/portfolio/history?period=' + period).catch(() => ({ points: [] })), A('/positions'), A('/clock').catch(() => null)]);
  const day = a.lastEquity ? a.equity - a.lastEquity : null;
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Portfolio <span class="pill ${a.connection.live ? 'warn' : ''}">${a.connection.live ? 'LIVE' : a.connection.type === 'broker' ? 'Sandbox' : 'Paper'}</span></h1></div>
  ${clock ? `<p class="mu">Market is <b class="${clock.is_open ? 'pos' : ''}">${clock.is_open ? 'open' : 'closed'}</b> · ${clock.is_open ? 'closes ' + new Date(clock.next_close).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'opens ' + new Date(clock.next_open).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>` : ''}
  ${a.tradingBlocked ? '<div class="banner err">Trading is blocked on this account. Check your brokerage account status.</div>' : ''}
  <div class="card">
    <div class="stats">
      <div class="stat"><span>Equity</span><b>${usd(a.equity)}</b></div>
      <div class="stat"><span>Today</span><b class="${H.cls(day)}">${day == null ? '-' : `${usd(day)} (${H.pct(day / a.lastEquity * 100, 2)})`}</b></div>
      <div class="stat"><span>Buying power</span><b>${usd(a.buyingPower)}</b></div>
      <div class="stat"><span>Cash</span><b>${usd(a.cash)}</b></div>
    </div>
    <div class="chips" id="periods" style="margin-top:12px">${['1D', '1W', '1M', '3M', '6M', '1A', 'all'].map(p => `<button data-p="${p}" class="${p === period ? 'on' : ''}">${p === '1A' ? '1Y' : p === 'all' ? 'All' : p}</button>`).join('')}</div>
    <canvas id="eq"></canvas>
    <p class="mu" id="eqUpdated" style="font-size:12px;margin:6px 0 0;text-align:end" aria-live="off">Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
  </div>
  <div class="grid">
    <div class="card"><h2>Balances & margin</h2><div class="kv">
      <span>Long market value</span><span>${usd(a.longMarketValue)}</span><span>Short market value</span><span>${usd(a.shortMarketValue)}</span>
      <span>Reg T buying power</span><span>${usd(a.regtBuyingPower)}</span><span>Day-trading buying power</span><span>${usd(a.daytradingBuyingPower)}</span>
      <span>Non-marginable buying power</span><span>${usd(a.nonMarginableBuyingPower)}</span><span>Options buying power</span><span>${usd(a.optionsBuyingPower)}</span>
      <span>Initial margin</span><span>${usd(a.initialMargin)}</span><span>Maintenance margin</span><span>${usd(a.maintenanceMargin)}</span>
      <span>Margin multiplier</span><span>${a.multiplier ?? '-'}x</span><span>Day trades (5 days)</span><span>${a.daytradeCount ?? 0}${a.patternDayTrader ? ' · PDT' : ''}</span>
      <span>Options level</span><span>${a.optionsLevel ?? '-'}</span><span>Crypto</span><span>${H.esc(a.cryptoStatus || '-')}</span></div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Positions</h2><a href="#/positions">All positions →</a></div>
      <div class="tablewrap"><table><tr><th>Symbol</th><th class="num">Value</th><th class="num">Today</th><th class="num">Total P/L</th></tr>
      ${ps.slice(0, 8).map(p => `<tr><td><a href="#/trade?symbol=${encodeURIComponent(p.symbol)}">${H.esc(p.symbol)}</a></td><td class="num">${usd(p.marketValue)}</td><td class="num ${H.cls(p.todayPl)}">${usd(p.todayPl)}</td><td class="num ${H.cls(p.unrealizedPl)}">${usd(p.unrealizedPl)} (${H.pct(p.unrealizedPlPct)})</td></tr>`).join('') || '<tr><td colspan="4" class="mu">No positions. <a href="#/trade">Place a trade</a></td></tr>'}</table></div></div>
  </div>`;
  let pts = h.points, hist = h;
  const drawEq = () => H.drawChart(H.$('#eq', view), pts.map(p => p.equity), { base: hist.baseValue || pts[0]?.equity });
  drawEq(); onResize(drawEq);
  H.$$('#periods button', view).forEach(b => (b.onclick = () => { try { localStorage.setItem('qp_period', b.dataset.p); } catch {} location.hash = '#/dashboard?period=' + b.dataset.p; }));
  // Quiet refresh: numbers change in place and the chart redraws only when its data changed. Nothing
  // updates while a finger or the mouse is on the chart, so it never shifts while you read it.
  const chart = H.$('#eq', view); let holding = false;
  chart.addEventListener('pointerenter', () => (holding = true)); chart.addEventListener('pointerleave', () => (holding = false));
  chart.addEventListener('touchstart', () => (holding = true), { passive: true }); chart.addEventListener('touchend', () => setTimeout(() => (holding = false), 4000), { passive: true });
  const stamp = H.$('#eqUpdated', view), stats = H.$$('.stats .stat b', view);
  const tick = async () => {
    if (holding) return;
    const [a2, h2] = await Promise.all([A('/account'), A('/portfolio/history?period=' + period).catch(() => null)]).catch(() => []);
    if (!a2 || !H.$('#eq', view)) return;
    const d2 = a2.lastEquity ? a2.equity - a2.lastEquity : null;
    const vals = [usd(a2.equity), d2 == null ? '-' : `${usd(d2)} (${H.pct(d2 / a2.lastEquity * 100, 2)})`, usd(a2.buyingPower), usd(a2.cash)];
    stats.forEach((b, i) => { if (vals[i] != null && b.textContent !== vals[i]) b.textContent = vals[i]; });
    if (stats[1]) stats[1].className = H.cls(d2);
    if (h2?.points && JSON.stringify(h2.points) !== JSON.stringify(pts)) { pts = h2.points; hist = h2; drawEq(); }
    if (stamp) stamp.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  every(60000, tick);
}

// =====================================================================
// Trade: search, live quote, candlestick chart, news, order ticket
// =====================================================================
async function trade(view, q) {
  const s = await needConnection(view, 'Trade');
  if (!s) return;
  const symbol = (q.get('symbol') || localStorage.getItem('qp_symbol') || 'AAPL').toUpperCase();
  try { localStorage.setItem('qp_symbol', symbol); } catch {}
  const range = q.get('range') || '6M';
  const kind = isOption(symbol) ? 'option' : isCrypto(symbol) ? 'crypto' : 'stock';
  view.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h1>Trade</h1>
    <form id="search" class="row" style="flex:0 1 420px"><label style="flex:1">Symbol or company<input name="q" list="symList" placeholder="AAPL, BTC/USD, Apple…" autocomplete="off" value=""></label><datalist id="symList"></datalist><button>Go</button></form></div>
  <div class="cols tradegrid">
      <div class="card" id="chartCard"><div class="quote"><h2 style="margin:0">${H.esc(symbol)}</h2><span class="px" id="px">-</span><span id="chg"></span><span class="mu" id="ba"></span><span class="mu" id="assetName"></span></div>
        ${kind === 'option' ? '' : `<div class="chips" id="ranges" style="margin:10px 0">${Object.keys(RANGES).map(r => `<button data-r="${r}" class="${r === range ? 'on' : ''}">${r}</button>`).join('')}</div>
        <div class="chartbox"><canvas id="candles" style="height:340px"></canvas><div class="tip" id="tip" hidden></div></div>`}
      </div>
      <div class="card ticket" id="ticket"></div>
      <div class="card" id="ordersCard"><div class="row" style="justify-content:space-between"><h2>Open orders for ${H.esc(symbol)}</h2><a href="#/orders">All orders →</a></div><div id="symOrders" class="tablewrap"></div></div>
      ${kind === 'option' ? '' : '<div class="card news" id="newsCard"><h2>News</h2><div id="news"><p class="mu">Loading…</p></div></div>'}
  </div>
  <div class="actionbar" id="tradeBar" hidden><button class="buy" data-s="buy">Buy</button><button class="sell danger" data-s="sell">Sell</button></div>`;

  const sf = H.$('#search', view), dl = H.$('#symList', view);
  let tmr;
  sf.q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
    const v = sf.q.value.trim(); if (!v) return;
    const hits = await A('/assets/search?q=' + encodeURIComponent(v) + (v.includes('/') ? '&class=crypto' : '')).catch(() => []);
    dl.innerHTML = hits.map(a => `<option value="${H.esc(a.symbol)}">${H.esc(a.name || '')}</option>`).join('');
  }, 250); };
  sf.onsubmit = e => { e.preventDefault(); const v = sf.q.value.trim().toUpperCase(); if (v) location.hash = '#/trade?symbol=' + encodeURIComponent(v); };

  // Quote header from a snapshot, then live updates.
  let last = null;
  const showPx = (p, prev) => {
    const el = H.$('#px', view); if (!el || p == null) return;
    if (last != null && p !== last) flash(el, p > last);
    last = p; el.textContent = usd(p);
    if (prev) { const c = p - prev; H.$('#chg', view).innerHTML = `<b class="${H.cls(c)}">${c >= 0 ? '+' : ''}${fmt(c)} (${H.pct(c / prev * 100, 2)})</b>`; }
  };
  let prevClose = null;
  if (kind !== 'option') {
    A('/data/snapshots?symbols=' + encodeURIComponent(symbol)).then(snap => {
      const sn = snap[symbol]; if (!sn) return;
      prevClose = sn.prevDailyBar?.c; showPx(sn.price ?? sn.latestTrade?.p, prevClose);
      if (sn.latestQuote) H.$('#ba', view).textContent = `Bid ${fmt(sn.latestQuote.bp)} · Ask ${fmt(sn.latestQuote.ap)}`;
    }).catch(e => (H.$('#ba', view).textContent = e.message));
    live([symbol], u => { if (u.price != null) showPx(u.price, prevClose); if (u.bid != null) H.$('#ba', view).textContent = `Bid ${fmt(u.bid)} · Ask ${fmt(u.ask)}`; });
    const [tf, days] = RANGES[range];
    A(`/data/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${tf}&start=${new Date(Date.now() - days * 86400e3).toISOString()}`).then(b => {
      let bars = b[symbol] || [];
      if (range === '1D' && bars.length) { const lastDay = bars[bars.length - 1].t.slice(0, 10); bars = bars.filter(x => x.t.slice(0, 10) === lastDay); }
      const draw = () => H.$('#candles', view) && drawCandles(H.$('#candles', view), bars, H.$('#tip', view));
      draw(); onResize(draw);
      if (last == null && bars.length) showPx(bars[bars.length - 1].c, prevClose);
    }).catch(e => { const c = H.$('#candles', view); if (c) c.replaceWith(Object.assign(document.createElement('p'), { className: 'err', textContent: e.message })); });
    H.$$('#ranges button', view).forEach(b => (b.onclick = () => (location.hash = `#/trade?symbol=${encodeURIComponent(symbol)}&range=${b.dataset.r}`)));
    A('/data/news?limit=8&symbols=' + encodeURIComponent(symbol.replace('/', ''))).then(n => (H.$('#news', view).innerHTML = newsHtml(n))).catch(() => (H.$('#news', view).innerHTML = '<p class="mu">News unavailable.</p>'));
    A('/assets/search?q=' + encodeURIComponent(symbol) + (kind === 'crypto' ? '&class=crypto' : '')).then(r => { const a = r.find(x => x.symbol === symbol); if (a) H.$('#assetName', view).textContent = `${a.name} · ${a.exchange}${a.tradable ? '' : ' · not tradable'}`; }).catch(() => {});
  } else {
    const [, root] = /^([A-Z]+)/.exec(symbol);
    H.$('#assetName', view).innerHTML = `Option on <a href="#/options?underlying=${root}">${root}</a>`;
  }

  const acct = await A('/account').catch(() => null);
  const loadOrders = async () => {
    const os = await A('/orders?status=open&symbols=' + encodeURIComponent(symbol)).catch(() => []);
    const el = H.$('#symOrders', view); if (!el) return;
    el.innerHTML = os.length ? ordersTable(os) : '<p class="mu">None</p>';
    wireOrderActions(el, loadOrders);
  };
  renderTicket(H.$('#ticket', view), symbol, kind, acct, () => last, q, () => setTimeout(loadOrders, 800));
  // Phones: a Buy/Sell bar stays on screen until the order form itself is visible.
  const bar = H.$('#tradeBar', view), tk = H.$('#ticket', view);
  if ('IntersectionObserver' in window) {
    // Hidden once at least half of the order form is on screen (its Review button is then reachable).
    const io = new IntersectionObserver(([e]) => (bar.hidden = e.intersectionRatio >= 0.5 || innerWidth > 900), { threshold: [0, 0.25, 0.5, 0.75, 1] });
    io.observe(tk); H.onLeave(() => io.disconnect());
  }
  H.$$('button', bar).forEach(b => (b.onclick = () => { H.$(`#sideSeg [data-s=${b.dataset.s}]`, tk)?.click(); tk.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  loadOrders();
  every(5000, loadOrders);
}

function renderTicket(box, symbol, kind, acct, lastPx, q, onPlaced) {
  const st = { side: q.get('side') === 'sell' ? 'sell' : 'buy', type: 'market', mode: 'qty', cls: 'simple' };
  const typesFor = { stock: [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop'], ['stop_limit', 'Stop limit'], ['trailing_stop', 'Trailing stop']], crypto: [['market', 'Market'], ['limit', 'Limit'], ['stop_limit', 'Stop limit']], option: [['market', 'Market'], ['limit', 'Limit']] }[kind];
  const tifFor = { stock: [['day', 'Day'], ['gtc', 'Good till cancelled'], ['opg', 'Market on open'], ['cls', 'Market on close'], ['ioc', 'Immediate or cancel'], ['fok', 'Fill or kill']], crypto: [['gtc', 'Good till cancelled'], ['ioc', 'Immediate or cancel']], option: [['day', 'Day']] }[kind];
  const draw = () => {
    const t = st.type, needLimit = t === 'limit' || t === 'stop_limit', needStop = t === 'stop' || t === 'stop_limit';
    const dollars = kind !== 'option' && t === 'market' && st.cls === 'simple';
    if (!dollars) st.mode = 'qty';
    box.innerHTML = `<h2>${st.side === 'buy' ? 'Buy' : 'Sell'} ${H.esc(symbol)}</h2>
      <div class="seg" id="sideSeg"><button type="button" class="buy ${st.side === 'buy' ? 'on' : ''}" data-s="buy">Buy</button><button type="button" class="sell ${st.side === 'sell' ? 'on' : ''}" data-s="sell">Sell</button></div>
      <form id="tk">
        <label>Order type<select name="type">${typesFor.map(([v, n]) => `<option value="${v}" ${v === t ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${dollars ? `<div class="chips" style="margin-top:8px"><button type="button" data-m="qty" class="${st.mode === 'qty' ? 'on' : ''}">${kind === 'crypto' ? 'Quantity' : 'Shares'}</button><button type="button" data-m="notional" class="${st.mode === 'notional' ? 'on' : ''}">Dollars</button></div>` : ''}
        ${st.mode === 'notional' ? '<label>Amount (USD)<input name="notional" type="number" min="1" step="0.01" required></label>' : `<label>${kind === 'option' ? 'Contracts' : kind === 'crypto' ? 'Quantity' : 'Shares'}<input name="qty" type="number" min="0" step="${kind === 'option' ? '1' : 'any'}" required></label>`}
        ${needLimit ? '<label>Limit price<input name="limit_price" type="number" step="any" min="0" required></label>' : ''}
        ${needStop ? '<label>Stop price<input name="stop_price" type="number" step="any" min="0" required></label>' : ''}
        ${t === 'trailing_stop' ? '<div class="row"><label>Trail %<input name="trail_percent" type="number" step="any" min="0"></label><label>or Trail $<input name="trail_price" type="number" step="any" min="0"></label></div>' : ''}
        <label>Time in force<select name="time_in_force">${tifFor.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
        ${kind === 'stock' ? `<details ${st.cls !== 'simple' ? 'open' : ''}><summary class="mu" style="margin-top:10px;cursor:pointer">Advanced: bracket, OCO, OTO, extended hours</summary>
          <label>Order class<select name="order_class">${[['simple', 'Simple'], ['bracket', 'Bracket (entry + take-profit + stop-loss)'], ['oco', 'OCO (one cancels other)'], ['oto', 'OTO (one triggers other)']].map(([v, n]) => `<option value="${v}" ${v === st.cls ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          ${st.cls !== 'simple' ? `<div class="row"><label>Take-profit limit<input name="take_profit_price" type="number" step="any" min="0"></label><label>Stop-loss stop<input name="stop_loss_price" type="number" step="any" min="0"></label></div>
            <label>Stop-loss limit (optional)<input name="stop_loss_limit_price" type="number" step="any" min="0"></label>` : ''}
          ${t === 'limit' ? '<label class="check" style="margin-top:8px"><input type="checkbox" name="extended_hours"> Allow pre-market & after-hours (Day orders)</label>' : ''}
        </details>` : ''}
        ${kind === 'option' ? `<label>Position intent<select name="position_intent"><option value="">Automatic</option><option value="${st.side}_to_open">${st.side === 'buy' ? 'Buy' : 'Sell'} to open</option><option value="${st.side}_to_close">${st.side === 'buy' ? 'Buy' : 'Sell'} to close</option></select></label>` : ''}
        <div class="kv" style="margin-top:12px"><span>Estimated ${st.side === 'buy' ? 'cost' : 'proceeds'}</span><span id="est">-</span>
          ${acct ? `<span>Buying power</span><span>${usd(kind === 'option' ? acct.optionsBuyingPower ?? acct.buyingPower : kind === 'crypto' ? acct.nonMarginableBuyingPower ?? acct.cash : acct.buyingPower)}</span>` : ''}</div>
        <button style="width:100%;margin-top:12px" class="${st.side === 'sell' ? 'danger' : ''}" id="review">Review order</button><div class="err" id="tkErr"></div>
      </form>`;
    const f = H.$('#tk', box);
    H.$$('#sideSeg button', box).forEach(b => (b.onclick = () => { st.side = b.dataset.s; draw(); }));
    H.$$('[data-m]', box).forEach(b => (b.onclick = () => { st.mode = b.dataset.m; draw(); }));
    f.type.onchange = () => { st.type = f.type.value; draw(); };
    if (f.order_class) f.order_class.onchange = () => { st.cls = f.order_class.value; draw(); };
    const est = () => {
      const px = +f.limit_price?.value || +f.stop_price?.value || lastPx(), mult = kind === 'option' ? 100 : 1;
      H.$('#est', box).textContent = st.mode === 'notional' ? usd(+f.notional.value || 0) : px && +f.qty?.value ? `~${usd(px * f.qty.value * mult)}` : '-';
    };
    f.oninput = est; est();
    H.act(H.$('#review', box), async () => {
      const bad = [...f.querySelectorAll('input,select')].find(i => !i.checkValidity()); if (bad) { bad.focus(); throw new Error('Fill in the highlighted field'); }
      const o = { ...H.form(f), symbol, side: st.side, order_class: f.order_class?.value || 'simple' };
      for (const k of Object.keys(o)) if (o[k] === '') delete o[k];
      if (o.order_class === 'bracket' && lastPx()) o.ref_price = o.limit_price || lastPx();
      const live = H.$('.pill.warn', document.getElementById('top')) ? '<p class="warn"><b>This is a LIVE order with real money.</b></p>' : '';
      const desc = `${o.side.toUpperCase()} ${o.notional ? usd(+o.notional) + ' of' : o.qty} ${H.esc(symbol)} · ${o.type.replace('_', ' ')}${o.limit_price ? ' @ ' + o.limit_price : ''}${o.stop_price ? ' stop ' + o.stop_price : ''}${o.trail_percent ? ' trail ' + o.trail_percent + '%' : o.trail_price ? ' trail $' + o.trail_price : ''} · ${o.time_in_force.toUpperCase()}`;
      const extra = o.order_class !== 'simple' ? `<p>${o.order_class.toUpperCase()}${o.take_profit_price ? ' · take-profit ' + o.take_profit_price : ''}${o.stop_loss_price ? ' · stop-loss ' + o.stop_loss_price : ''}</p>` : '';
      if (!(await confirmBox('Review order', `${live}<p><b>${desc}</b></p>${extra}<p class="mu">Estimated: ${H.$('#est', box).textContent}</p>`, 'Place order', st.side === 'sell'))) return;
      const r = await A('/orders', { body: o });
      onPlaced();
      return `Order ${r.status}. ID ${String(r.id).slice(0, 8)}…`;
    }, H.$('#tkErr', box));
  };
  draw();
}

function newsHtml(items) {
  return items.map(n => `<div class="item"><a href="${H.esc(safeUrl(n.url))}" target="_blank" rel="noopener noreferrer">${H.esc(n.headline)}</a>
    <div class="mu" style="font-size:13px">${H.esc(n.source || '')} · ${ago(n.created_at)} ${(n.symbols || []).slice(0, 5).map(s => `<a class="pill" href="#/trade?symbol=${encodeURIComponent(s)}" style="font-weight:400">${H.esc(s)}</a>`).join(' ')}</div>
    ${n.summary ? `<div style="font-size:14px">${H.esc(n.summary.slice(0, 220))}</div>` : ''}</div>`).join('') || '<p class="mu">No recent news.</p>';
}

// =====================================================================
// Orders: view, modify, cancel one or all (bracket children nested)
// =====================================================================
function orderRow(o, sub) {
  const open = OPEN_STATUSES.includes(o.status);
  const what = o.order_class === 'mleg' ? `${(o.legs || []).length}-leg spread` : `<a href="#/trade?symbol=${encodeURIComponent(o.symbol)}">${H.esc(o.symbol)}</a>`;
  const px = [o.limit_price && 'L ' + fmt(+o.limit_price), o.stop_price && 'S ' + fmt(+o.stop_price), o.trail_percent && 'T ' + o.trail_percent + '%', o.trail_price && 'T $' + o.trail_price].filter(Boolean).join(' ');
  return `<tr class="${sub ? 'sub' : ''}"><td>${sub ? '↳ ' : ''}${H.date(o.submitted_at || o.created_at)}</td><td>${what}</td><td class="${o.side === 'buy' ? 'pos' : 'neg'}">${H.esc(o.side || '')}</td>
    <td>${H.esc((o.type || '').replace('_', ' '))}${o.order_class && o.order_class !== 'simple' && !sub ? ` <span class="pill">${H.esc(o.order_class)}</span>` : ''}</td>
    <td class="num">${o.qty ? fmt(+o.qty, +o.qty % 1 ? 4 : 0) : o.notional ? usd(+o.notional) : '-'}${+o.filled_qty ? ` <span class="mu">(${fmt(+o.filled_qty, +o.filled_qty % 1 ? 4 : 0)} filled${o.filled_avg_price ? ' @ ' + fmt(+o.filled_avg_price) : ''})</span>` : ''}</td>
    <td>${px || '-'}</td><td>${H.esc((o.time_in_force || '').toUpperCase())}</td><td>${H.esc(o.status)}</td>
    <td>${open ? `<button class="small ghost" data-mod="${H.esc(o.id)}" data-type="${H.esc(o.type)}">Modify</button> <button class="small ghost" data-cancel="${H.esc(o.id)}">Cancel</button>` : ''}</td></tr>`;
}
function ordersTable(list) {
  const rows = list.map(o => orderRow(o) + (o.legs || []).map(l => orderRow(l, true)).join('')).join('');
  return `<table><tr><th>Submitted</th><th>Symbol</th><th>Side</th><th>Type</th><th class="num">Qty</th><th>Prices</th><th>TIF</th><th>Status</th><th></th></tr>${rows}</table>`;
}
function wireOrderActions(el, reload) {
  H.$$('[data-cancel]', el).forEach(b => (b.onclick = async () => { b.disabled = true; try { await A('/orders/' + b.dataset.cancel, { method: 'DELETE' }); } catch (e) { alert(e.message); } reload(); }));
  H.$$('[data-mod]', el).forEach(b => (b.onclick = async () => {
    const t = b.dataset.type;
    const f = await formBox('Modify order', `<label>New quantity<input name="qty" type="number" step="any" min="0"></label>
      ${['limit', 'stop_limit'].includes(t) ? '<label>New limit price<input name="limit_price" type="number" step="any" min="0"></label>' : ''}
      ${['stop', 'stop_limit'].includes(t) ? '<label>New stop price<input name="stop_price" type="number" step="any" min="0"></label>' : ''}
      ${t === 'trailing_stop' ? '<label>New trail<input name="trail" type="number" step="any" min="0"></label>' : ''}
      <label>Time in force<select name="time_in_force"><option value="">Unchanged</option><option value="day">Day</option><option value="gtc">GTC</option></select></label>`, 'Replace order');
    if (!f) return;
    for (const k of Object.keys(f)) if (f[k] === '') delete f[k];
    try { await A('/orders/' + b.dataset.mod, { body: f, method: 'PATCH' }); } catch (e) { alert(e.message); }
    reload();
  }));
}

async function orders(view, q) {
  const s = await needConnection(view, 'Orders');
  if (!s) return;
  const status = q.get('status') || 'open';
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Orders</h1><div class="row">
    <div class="chips" id="orderTabs">${[['open', 'Open'], ['closed', 'Filled & closed'], ['all', 'All']].map(([k, t]) => `<button data-k="${k}" class="${k === status ? 'on' : ''}">${t}</button>`).join('')}</div>
    <button class="danger small" id="cancelAll">Cancel all open</button></div></div>
    <div class="card tablewrap" id="list"><p class="mu">Loading…</p></div>`;
  H.$$('#orderTabs button', view).forEach(b => (b.onclick = () => (location.hash = '#/orders?status=' + b.dataset.k)));
  const load = async () => {
    const list = await A('/orders?status=' + status + '&limit=200');
    const el = H.$('#list', view); if (!el) return;
    el.innerHTML = list.length ? ordersTable(list) : '<p class="mu">No orders.</p>';
    wireOrderActions(el, load);
  };
  await load();
  every(5000, load);
  H.$('#cancelAll', view).onclick = async () => {
    if (!(await confirmBox('Cancel all open orders?', '<p>Every open order on this account will be cancelled.</p>', 'Cancel all', true))) return;
    const r = await A('/orders', { method: 'DELETE' }); alert(`Cancelling ${r.length} order(s).`); load();
  };
}

// =====================================================================
// Positions: live P/L, close full or partial, close all, exercise
// =====================================================================
async function positions(view) {
  const s = await needConnection(view, 'Positions');
  if (!s) return;
  const ps = await A('/positions');
  const tot = k => ps.reduce((a, p) => a + (p[k] || 0), 0);
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Positions</h1>${ps.length ? '<button class="danger small" id="closeAll">Close all positions</button>' : ''}</div>
  <div class="card"><div class="stats"><div class="stat"><span>Market value</span><b>${usd(tot('marketValue'))}</b></div><div class="stat"><span>Today</span><b class="${H.cls(tot('todayPl'))}">${usd(tot('todayPl'))}</b></div>
    <div class="stat"><span>Unrealized P/L</span><b class="${H.cls(tot('unrealizedPl'))}">${usd(tot('unrealizedPl'))}</b></div><div class="stat"><span>Positions</span><b>${ps.length}</b></div></div></div>
  <div class="card tablewrap"><table><tr><th>Symbol</th><th>Side</th><th class="num">Qty</th><th class="num">Avg entry</th><th class="num">Price</th><th class="num">Market value</th><th class="num">Today</th><th class="num">Total P/L</th><th></th></tr>
  ${ps.map(p => `<tr data-sym="${H.esc(p.symbol)}"><td><a href="#/trade?symbol=${encodeURIComponent(p.symbol)}">${H.esc(p.symbol)}</a> <span class="mu" style="font-size:12px">${H.esc(p.assetClass)}</span></td><td>${H.esc(p.side)}</td>
    <td class="num">${fmt(p.qty, p.qty % 1 ? 4 : 0)}</td><td class="num">${fmt(p.avgEntry)}</td><td class="num" data-px>${fmt(p.price)}</td><td class="num">${usd(p.marketValue)}</td>
    <td class="num ${H.cls(p.todayPl)}">${usd(p.todayPl)}</td><td class="num ${H.cls(p.unrealizedPl)}">${usd(p.unrealizedPl)} (${H.pct(p.unrealizedPlPct)})</td>
    <td><button class="small ghost" data-close="${H.esc(p.symbol)}" data-qty="${p.qtyAvailable}">Close</button>${p.assetClass === 'us_option' && p.side === 'long' ? ` <button class="small ghost" data-ex="${H.esc(p.symbol)}">Exercise</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="mu">No open positions. <a href="#/trade">Place a trade</a></td></tr>'}
  </table></div>`;
  // Crypto positions are reported as BTCUSD; the price stream uses BTC/USD.
  const streamSym = p => (p.assetClass === 'crypto' && !p.symbol.includes('/') ? p.symbol.replace(/(USDT|USDC|USD|BTC)$/, '/$1') : p.symbol);
  const back = Object.fromEntries(ps.filter(p => p.assetClass !== 'us_option').map(p => [streamSym(p), p.symbol]));
  live(Object.keys(back), u => {
    const cell = H.$(`tr[data-sym="${CSS.escape(back[u.symbol] || u.symbol)}"] [data-px]`, view);
    if (cell && u.price != null) { const old = +cell.textContent.replace(/,/g, ''); cell.textContent = fmt(u.price); flash(cell, u.price >= old); }
  });
  H.$$('[data-close]', view).forEach(b => (b.onclick = async () => {
    const f = await formBox(`Close ${b.dataset.close}`, `<p class="mu">Available: ${b.dataset.qty}</p>
      <label>How much<select name="mode"><option value="all">Entire position</option><option value="qty">A quantity</option><option value="percentage">A percentage</option></select></label>
      <label>Quantity or percent (for partial)<input name="amount" type="number" step="any" min="0"></label>`, 'Close position');
    if (!f) return;
    const qs = f.mode === 'qty' ? '?qty=' + f.amount : f.mode === 'percentage' ? '?percentage=' + f.amount : '';
    try { await A('/positions/' + encodeURIComponent(b.dataset.close) + qs, { method: 'DELETE' }); } catch (e) { return alert(e.message); }
    setTimeout(H.render, 1200);
  }));
  H.$$('[data-ex]', view).forEach(b => (b.onclick = async () => {
    if (!(await confirmBox('Exercise option?', `<p>Exercise <b>${H.esc(b.dataset.ex)}</b> now?</p>`, 'Exercise'))) return;
    try { await A('/positions/' + encodeURIComponent(b.dataset.ex) + '/exercise', { body: {} }); H.render(); } catch (e) { alert(e.message); }
  }));
  if (H.$('#closeAll', view)) H.$('#closeAll', view).onclick = async () => {
    if (!(await confirmBox('Close ALL positions?', '<p>Market orders will be sent to close every position, and open orders will be cancelled.</p>', 'Close everything', true))) return;
    await A('/positions', { method: 'DELETE' }); setTimeout(H.render, 1500);
  };
}

// =====================================================================
// Markets: overview, most active, movers, news
// =====================================================================
const OVERVIEW = ['SPY', 'QQQ', 'DIA', 'IWM', 'BTC/USD', 'ETH/USD'];
async function markets(view, q) {
  const by = q.get('by') === 'trades' ? 'trades' : 'volume', mk = q.get('market') === 'crypto' ? 'crypto' : 'stocks';
  view.innerHTML = `<h1>Markets & news</h1><p class="mu" id="clock"></p>
  <div class="stats" id="ov">${OVERVIEW.map(s => `<a class="stat" href="#/trade?symbol=${encodeURIComponent(s)}" data-s="${s}" style="text-decoration:none;color:inherit"><span>${s}</span><b data-px>-</b><span data-chg></span></a>`).join('')}</div>
  <div class="grid" style="margin-top:16px">
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Most active</h2><div class="chips" id="by"><button data-v="volume" class="${by === 'volume' ? 'on' : ''}">Volume</button><button data-v="trades" class="${by === 'trades' ? 'on' : ''}">Trades</button></div></div><div id="active" class="tablewrap"><p class="mu">Loading…</p></div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Top movers</h2><div class="chips" id="mk"><button data-v="stocks" class="${mk === 'stocks' ? 'on' : ''}">Stocks</button><button data-v="crypto" class="${mk === 'crypto' ? 'on' : ''}">Crypto</button></div></div><div id="movers"><p class="mu">Loading…</p></div></div>
  </div>
  <div class="card news"><div class="row" style="justify-content:space-between"><h2>News</h2><form id="nf" class="row"><input name="symbols" placeholder="Filter: AAPL, TSLA, BTCUSD" style="max-width:240px"><button class="small">Filter</button></form></div><div id="news"><p class="mu">Loading…</p></div></div>`;
  const link = s => `<a href="#/trade?symbol=${encodeURIComponent(s)}">${H.esc(s)}</a>`;
  A('/clock').then(c => (H.$('#clock', view).innerHTML = `US market is <b class="${c.is_open ? 'pos' : ''}">${c.is_open ? 'open' : 'closed'}</b> · next ${c.is_open ? 'close ' + new Date(c.next_close).toLocaleString() : 'open ' + new Date(c.next_open).toLocaleString()}`)).catch(() => {});
  const ovSet = (sym, p, chg) => {
    const el = H.$(`[data-s="${CSS.escape(sym)}"]`, view); if (!el) return;
    if (p != null) { const b = H.$('[data-px]', el), old = +b.dataset.v; b.textContent = fmt(p); b.dataset.v = p; if (old) flash(b, p >= old); }
    if (chg != null) { const c = H.$('[data-chg]', el); c.textContent = H.pct(chg, 2); c.className = H.cls(chg); }
  };
  const prev = {};
  A('/data/snapshots?symbols=' + encodeURIComponent(OVERVIEW.join(','))).then(sn => { for (const [k, v] of Object.entries(sn)) { prev[k] = v.prevDailyBar?.c; ovSet(k, v.price, v.changePct); } }).catch(e => (H.$('#ov', view).insertAdjacentHTML('afterend', `<p class="err">${H.esc(e.message)}</p>`)));
  live(OVERVIEW, u => u.price != null && ovSet(u.symbol, u.price, prev[u.symbol] ? (u.price / prev[u.symbol] - 1) * 100 : null));
  A('/data/most-actives?top=15&by=' + by).then(d => (H.$('#active', view).innerHTML = `<table><tr><th>Symbol</th><th class="num">Volume</th><th class="num">Trades</th></tr>${(d.most_actives || []).map(a => `<tr><td>${link(a.symbol)}</td><td class="num">${fmt(a.volume, 0)}</td><td class="num">${fmt(a.trade_count, 0)}</td></tr>`).join('')}</table>`)).catch(e => (H.$('#active', view).innerHTML = `<p class="err">${H.esc(e.message)}</p>`));
  A('/data/movers?top=8&market=' + mk).then(d => (H.$('#movers', view).innerHTML = `<div class="movers">${[['Gainers', d.gainers], ['Losers', d.losers]].map(([t, l]) => `<div><h3>${t}</h3><table><tr><th>Symbol</th><th class="num">Price</th><th class="num">Change</th></tr>${(l || []).map(m => `<tr><td>${link(m.symbol)}</td><td class="num">${fmt(m.price)}</td><td class="num ${H.cls(m.percent_change)}">${H.pct(m.percent_change)}</td></tr>`).join('')}</table></div>`).join('')}</div>`)).catch(e => (H.$('#movers', view).innerHTML = `<p class="err">${H.esc(e.message)}</p>`));
  const loadNews = syms => A('/data/news?limit=25' + (syms ? '&symbols=' + encodeURIComponent(syms) : '')).then(n => (H.$('#news', view).innerHTML = newsHtml(n))).catch(e => (H.$('#news', view).innerHTML = `<p class="err">${H.esc(e.message)}</p>`));
  loadNews();
  H.$('#nf', view).onsubmit = e => { e.preventDefault(); loadNews(H.form(e.target).symbols.replace(/\s/g, '').toUpperCase()); };
  H.$$('#by button', view).forEach(b => (b.onclick = () => (location.hash = `#/markets?by=${b.dataset.v}&market=${mk}`)));
  H.$$('#mk button', view).forEach(b => (b.onclick = () => (location.hash = `#/markets?by=${by}&market=${b.dataset.v}`)));
}

// =====================================================================
// Options: chain with Greeks/IV, single-leg and multi-leg order builder
// =====================================================================
async function options(view, q) {
  const s = await needConnection(view, 'Options chain');
  if (!s) return;
  const und = (q.get('underlying') || 'AAPL').toUpperCase();
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Options chain</h1>
    <form id="uf" class="row"><label>Underlying<input name="u" value="${H.esc(und)}" style="max-width:120px"></label><label>Expiration<select name="exp" id="exp"><option>Loading…</option></select></label><button>Load</button></form></div>
  <p class="mu" id="spot"></p>
  <div class="cols"><div class="card tablewrap" id="chain"><p class="mu">Loading…</p></div>
    <div class="card" id="builder"></div></div>
  <div class="actionbar" id="legBar" hidden><button id="legGo"></button></div>`;
  const legs = [];
  let spot = null;
  A('/data/snapshots?symbols=' + und).then(sn => { spot = sn[und]?.price; if (spot) H.$('#spot', view).innerHTML = `${H.esc(und)} last <b>${fmt(spot)}</b> <span class="${H.cls(sn[und].changePct)}">${H.pct(sn[und].changePct, 2)}</span>. Click a bid to sell or an ask to buy; add 2-4 legs for a spread.`; }).catch(() => {});
  const all = await A('/data/options/' + encodeURIComponent(und)).catch(e => ({ error: e.message }));
  if (all.error) { H.$('#chain', view).innerHTML = `<p class="err">${H.esc(all.error)}</p>`; return; }
  const sel = H.$('#exp', view);
  const exp = q.get('exp') && all.expirations.includes(q.get('exp')) ? q.get('exp') : all.expirations[0];
  sel.innerHTML = all.expirations.map(e => `<option ${e === exp ? 'selected' : ''}>${e}</option>`).join('') || '<option value="">No contracts in the next 75 days</option>';
  H.$('#uf', view).onsubmit = e => { e.preventDefault(); const f = H.form(e.target); location.hash = `#/options?underlying=${encodeURIComponent(f.u.toUpperCase())}${f.u.toUpperCase() === und && f.exp ? '&exp=' + f.exp : ''}`; };
  sel.onchange = () => (location.hash = `#/options?underlying=${und}&exp=${sel.value}`);
  if (!exp) { H.$('#chain', view).innerHTML = '<p class="mu">No option contracts found.</p>'; return; }
  const chain = all.contracts.some(c => c.expiration === exp && c.greeks) ? all : await A(`/data/options/${encodeURIComponent(und)}?expiration=${exp}`);
  const rows = {};
  for (const c of chain.contracts.filter(c => c.expiration === exp)) (rows[c.strike] ||= {})[c.type] = c;
  const g = (c, k, d = 2) => (c?.greeks?.[k] != null ? fmt(c.greeks[k], d) : '-');
  const half = (c, t) => !c ? `<td colspan="5" class="mu ${t}">-</td>` :
    `<td class="num pick ${t}" data-sym="${c.symbol}" data-side="sell" title="Sell at bid">${fmt(c.bid)}</td><td class="num pick ${t}" data-sym="${c.symbol}" data-side="buy" title="Buy at ask">${fmt(c.ask)}</td><td class="num ${t}">${c.iv != null ? fmt(c.iv * 100, 1) + '%' : '-'}</td><td class="num ${t}">${g(c, 'delta')}</td><td class="num ${t}">${g(c, 'theta', 3)}</td>`;
  H.$('#chain', view).innerHTML = `<table class="chain"><tr><th colspan="5" style="text-align:center">Calls</th><th></th><th colspan="5" style="text-align:center">Puts</th></tr>
    <tr><th class="num">Bid</th><th class="num">Ask</th><th class="num">IV</th><th class="num">Δ</th><th class="num">Θ</th><th style="text-align:center">Strike</th><th class="num">Bid</th><th class="num">Ask</th><th class="num">IV</th><th class="num">Δ</th><th class="num">Θ</th></tr>
    ${Object.keys(rows).map(Number).sort((a, b) => a - b).map(k => `<tr class="${spot && k < spot ? 'itm' : ''} ${spot && k > spot ? 'itmp' : ''}">${half(rows[k].call, 'call')}<td class="strike">${fmt(k)}</td>${half(rows[k].put, 'put')}</tr>`).join('')}</table>
    <p class="mu" style="font-size:12px">Shaded cells are in the money. Greeks and IV from Alpaca's options data feed.</p>`;
  const byS = Object.fromEntries(chain.contracts.map(c => [c.symbol, c]));
  const drawBuilder = () => {
    const b = H.$('#builder', view), lb = H.$('#legBar', view);
    lb.hidden = !legs.length || innerWidth > 1100;
    H.$('#legGo', view).textContent = `${legs.length} leg${legs.length === 1 ? '' : 's'} selected · Review order ↓`;
    H.$('#legGo', view).onclick = () => b.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const net = legs.reduce((a, l) => a + (l.side === 'buy' ? 1 : -1) * l.ratio * ((byS[l.symbol]?.bid + byS[l.symbol]?.ask) / 2 || 0), 0);
    b.innerHTML = `<h2>Order builder</h2>${legs.length ? '' : '<p class="mu">Click a bid or ask in the chain to add a leg.</p>'}
      ${legs.map((l, i) => { const c = byS[l.symbol]; return `<div class="row" style="align-items:center;margin-bottom:6px"><span class="${l.side === 'buy' ? 'pos' : 'neg'}" style="flex:1">${l.side.toUpperCase()} ${l.ratio}× ${c ? `${c.expiration} ${fmt(c.strike)} ${c.type}` : H.esc(l.symbol)}</span><input type="number" min="1" step="1" value="${l.ratio}" data-ratio="${i}" style="width:60px;margin:0"><button class="small ghost" data-rm="${i}">✕</button></div>`; }).join('')}
      ${legs.length ? `<form id="of"><div class="row"><label>${legs.length > 1 ? 'Spreads' : 'Contracts'}<input name="qty" type="number" min="1" step="1" value="1" required></label><label>Type<select name="type"><option value="limit">Limit</option><option value="market">Market</option></select></label></div>
        <label>Limit price ${legs.length > 1 ? '(net; negative = credit)' : ''}<input name="limit_price" type="number" step="0.01" value="${(legs.length > 1 ? net : Math.abs(net)).toFixed(2)}"></label>
        <p class="mu" style="font-size:13px">Mid ${net >= 0 ? 'debit' : 'credit'} ≈ ${usd(Math.abs(net) * 100)} per ${legs.length > 1 ? 'spread' : 'contract'}</p>
        <button style="width:100%">Review order</button><div class="err"></div></form>` : ''}`;
    H.$$('[data-rm]', b).forEach(x => (x.onclick = () => { legs.splice(+x.dataset.rm, 1); drawBuilder(); }));
    H.$$('[data-ratio]', b).forEach(x => (x.onchange = () => { legs[+x.dataset.ratio].ratio = Math.max(1, Math.trunc(+x.value || 1)); drawBuilder(); }));
    const of = H.$('#of', b);
    if (of) H.act(H.$('button', of), async () => {
      const f = H.form(of);
      const body = legs.length === 1
        ? { symbol: legs[0].symbol, side: legs[0].side, qty: f.qty * legs[0].ratio, type: f.type, limit_price: f.type === 'limit' ? f.limit_price : undefined, time_in_force: 'day' }
        : { order_class: 'mleg', qty: f.qty, type: f.type, limit_price: f.type === 'limit' ? f.limit_price : undefined, legs: legs.map(l => ({ symbol: l.symbol, side: l.side, ratio_qty: l.ratio })) };
      const desc = legs.map(l => `${l.side} ${l.ratio}× ${H.esc(l.symbol)}`).join('<br>');
      if (!(await confirmBox('Review options order', `<p>${desc}</p><p><b>${f.qty} × ${f.type}${f.type === 'limit' ? ' @ ' + f.limit_price : ''}</b> · DAY</p><p class="mu">Options can expire worthless. Max loss on long options is the premium paid.</p>`, 'Place order'))) return;
      const r = await A('/orders', { body });
      legs.length = 0; setTimeout(drawBuilder, 1500);
      return `Order ${r.status}`;
    });
  };
  H.$('#chain', view).onclick = e => {
    const td = e.target.closest('td.pick'); if (!td) return;
    if (legs.length >= 4) return alert('Up to 4 legs');
    const ex = legs.find(l => l.symbol === td.dataset.sym);
    if (ex) ex.side = td.dataset.side; else legs.push({ symbol: td.dataset.sym, side: td.dataset.side, ratio: 1 });
    drawBuilder();
  };
  drawBuilder();
}

// =====================================================================
// Watchlists: create, rename, delete; add/remove symbols; live prices
// =====================================================================
async function watchlists(view, q) {
  const s = await needConnection(view, 'Watchlists');
  if (!s) return;
  const lists = await A('/watchlists');
  const id = q.get('id') || lists[0]?.id;
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Watchlists</h1><form id="nw" class="row"><input name="name" placeholder="New watchlist name" required style="max-width:220px"><button class="small">Create</button></form></div>
    <div class="chips" style="margin-bottom:12px">${lists.map(w => `<button data-id="${H.esc(w.id)}" class="${w.id === id ? 'on' : ''}">${H.esc(w.name)}</button>`).join('') || '<span class="mu">No watchlists yet. Create one above.</span>'}</div>
    <div id="wl"></div>`;
  H.$('#nw', view).onsubmit = async e => { e.preventDefault(); try { const w = await A('/watchlists', { body: H.form(e.target) }); location.hash = '#/watchlists?id=' + w.id; } catch (err) { alert(err.message); } };
  H.$$('.chips [data-id]', view).forEach(b => (b.onclick = () => (location.hash = '#/watchlists?id=' + b.dataset.id)));
  if (!id) return;
  const w = await A('/watchlists/' + encodeURIComponent(id));
  const syms = (w.assets || []).map(a => a.symbol);
  const box = H.$('#wl', view);
  box.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>${H.esc(w.name)}</h2><div class="row"><button class="small ghost" id="ren">Rename</button><button class="small danger" id="del">Delete</button></div></div>
    <form id="add" class="row"><input name="symbol" placeholder="Add symbol (AAPL, BTC/USD)" required style="max-width:240px"><button class="small">Add</button></form><div class="err" id="wlErr"></div>
    <div class="tablewrap"><table><tr><th>Symbol</th><th class="num">Last</th><th class="num">Change</th><th class="num">Bid / Ask</th><th class="num">Volume</th><th></th></tr>
    ${syms.map(s => `<tr data-s="${H.esc(s)}"><td><a href="#/trade?symbol=${encodeURIComponent(s)}">${H.esc(s)}</a></td><td class="num" data-px>-</td><td class="num" data-chg>-</td><td class="num" data-ba>-</td><td class="num" data-v>-</td>
      <td><a href="#/trade?symbol=${encodeURIComponent(s)}"><button class="small">Trade</button></a> <button class="small ghost" data-rm="${H.esc(s)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="mu">Empty. Add a symbol above.</td></tr>'}</table></div></div>`;
  const row = sym => H.$(`tr[data-s="${CSS.escape(sym)}"]`, box);
  const prev = {};
  if (syms.length) A('/data/snapshots?symbols=' + encodeURIComponent(syms.join(','))).then(sn => {
    for (const [k, v] of Object.entries(sn)) {
      const r = row(k); if (!r) continue; prev[k] = v.prevDailyBar?.c;
      H.$('[data-px]', r).textContent = fmt(v.price); const c = H.$('[data-chg]', r); c.textContent = H.pct(v.changePct, 2); c.className = 'num ' + H.cls(v.changePct);
      if (v.latestQuote) H.$('[data-ba]', r).textContent = `${fmt(v.latestQuote.bp)} / ${fmt(v.latestQuote.ap)}`;
      H.$('[data-v]', r).textContent = fmt(v.dailyBar?.v, 0);
    }
  }).catch(e => (H.$('#wlErr', box).textContent = e.message));
  live(syms, u => {
    const r = row(u.symbol); if (!r) return;
    if (u.price != null) { const el = H.$('[data-px]', r), old = +el.textContent.replace(/,/g, ''); el.textContent = fmt(u.price); if (old) flash(el, u.price >= old); if (prev[u.symbol]) { const c = H.$('[data-chg]', r), pc = (u.price / prev[u.symbol] - 1) * 100; c.textContent = H.pct(pc, 2); c.className = 'num ' + H.cls(pc); } }
    if (u.bid != null) H.$('[data-ba]', r).textContent = `${fmt(u.bid)} / ${fmt(u.ask)}`;
  });
  H.$('#add', box).onsubmit = async e => { e.preventDefault(); try { await A(`/watchlists/${encodeURIComponent(id)}/assets`, { body: H.form(e.target) }); H.render(); } catch (err) { H.$('#wlErr', box).textContent = err.message; } };
  H.$$('[data-rm]', box).forEach(b => (b.onclick = async () => { await A(`/watchlists/${encodeURIComponent(id)}/assets/${encodeURIComponent(b.dataset.rm)}`, { method: 'DELETE' }); H.render(); }));
  H.$('#ren', box).onclick = async () => { const f = await formBox('Rename watchlist', `<label>Name<input name="name" value="${H.esc(w.name)}" required></label>`); if (f) { await A('/watchlists/' + encodeURIComponent(id), { body: f, method: 'PUT' }); H.render(); } };
  H.$('#del', box).onclick = async () => { if (await confirmBox('Delete watchlist?', `<p>Delete <b>${H.esc(w.name)}</b>?</p>`, 'Delete', true)) { await A('/watchlists/' + encodeURIComponent(id), { method: 'DELETE' }); location.hash = '#/watchlists'; } };
}

// =====================================================================
// Calendar & events: clock, trading days, corporate actions
// =====================================================================
async function calendar(view, q) {
  const ym = /^\d{4}-\d{2}$/.test(q.get('m') || '') ? q.get('m') : new Date().toISOString().slice(0, 7);
  const sym = (q.get('symbol') || '').toUpperCase();
  const mon = await H.api('/events/month?ym=' + ym).catch(e => ({ error: e.message, ipos: [], earnings: [], actions: [] }));
  const conn = await A('/status').then(s => !!(s.active && !(s.active.type === 'broker' && s.broker.account?.status !== 'ACTIVE'))).catch(() => false);
  const [clock, days, ann] = conn ? await Promise.all([A('/clock').catch(() => null), A('/calendar').catch(() => []), A('/announcements' + (sym ? '?symbol=' + encodeURIComponent(sym) : '')).catch(e => ({ error: e.message }))]) : [null, [], null];
  const shift = k => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return d.toISOString().slice(0, 7); };
  const held = new Set(mon.held || []);
  // Everything on each day of the month.
  const byDay = {};
  const add = (d, e) => { (byDay[d] ||= []).push(e); };
  (mon.earnings || []).forEach(e => add(e.date, { k: held.has(e.symbol) ? 'earn held' : 'earn', t: e.symbol, d: `${e.symbol} earnings${e.when ? ' ' + e.when : ''}${e.epsEstimate != null ? ` · EPS est. $${(+e.epsEstimate).toFixed(2)}` : ''}`, link: e.symbol }));
  (mon.ipos || []).forEach(i => add(i.date, { k: 'ipo', t: i.symbol || i.name, d: `IPO: ${i.name}${i.symbol ? ` (${i.symbol})` : ''}${i.exchange ? ' on ' + i.exchange : ''}${i.price ? ' · $' + i.price : ''}${i.status ? ' · ' + i.status : ''}`, link: i.symbol }));
  (mon.actions || []).forEach(a => add(a.date, { k: a.type === 'dividend' || /div/i.test(a.type) ? 'div' : 'split', t: a.symbol, d: `${a.symbol} ${a.type}${a.detail ? ' ' + a.detail : ''} (ex-date)`, link: a.symbol }));
  const open = mon.tradingDays ? new Map(mon.tradingDays.map(d => [d.date, d])) : null;
  const first = new Date(ym + '-01T12:00:00Z'), lead = first.getUTCDay(), last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-d out"></div>');
  for (let d = 1; d <= last; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`, wd = (lead + d - 1) % 7, ev = byDay[ds] || [];
    const tday = open && open.get(ds), closed = open && wd > 0 && wd < 6 && !tday, early = tday && tday.close < '16:00';
    cells.push(`<button type="button" class="cal-d${wd === 0 || wd === 6 ? ' wkend' : ''}${ds === today ? ' today' : ''}${closed ? ' closed' : ''}" data-day="${ds}"><span class="n">${d}</span>
      ${closed ? '<span class="tag hol">Closed</span>' : early ? '<span class="tag early">Early close</span>' : ''}
      ${ev.slice(0, 3).map(e => `<span class="ev ${e.k}" data-no-tr>${H.esc(e.t)}</span>`).join('')}${ev.length > 3 ? `<span class="more">+${ev.length - 3}</span>` : ''}</button>`);
  }
  const title = new Date(ym + '-15T12:00:00Z').toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const early = d => d.close && d.close < '16:00';
  view.innerHTML = `<div class="pagehead"><div><h1>📅 Calendar & events</h1><p class="mu" style="margin:4px 0 0">Earnings, IPOs, dividends, splits and market holidays for the month.</p></div></div>
  <div class="card">
    <div class="row cal-head"><a href="#/calendar?m=${shift(-1)}"><button type="button" class="ghost small" aria-label="Previous month">‹</button></a><h2 style="margin:0;min-width:180px;text-align:center">${H.esc(title)}</h2><a href="#/calendar?m=${shift(1)}"><button type="button" class="ghost small" aria-label="Next month">›</button></a>
      ${ym !== today.slice(0, 7) ? `<a href="#/calendar"><button type="button" class="ghost small">Today</button></a>` : ''}</div>
    <div class="cal-legend"><span><i class="ev earn held"></i>Earnings (you own it)</span><span><i class="ev earn"></i>Earnings</span><span><i class="ev ipo"></i>IPO</span><span><i class="ev div"></i>Dividend</span><span><i class="ev split"></i>Split or other action</span></div>
    ${mon.enabled === false ? '<p class="banner">Earnings dates and IPOs appear once the owner adds a market-events key (Admin → Keys → FINNHUB_API_KEY).</p>' : mon.error ? `<p class="err">${H.esc(mon.error)}</p>` : ''}
    <div class="cal" dir="ltr">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-w">${d}</div>`).join('')}${cells.join('')}</div>
    <div id="calDay"></div>
    ${!conn ? '<p class="mu" style="font-size:12.5px">Connect an Alpaca account to add market holidays, early closes, dividends and splits.</p>' : ''}</div>
  ${conn && clock ? `<div class="card"><div class="stats"><div class="stat"><span>Market</span><b class="${clock.is_open ? 'pos' : ''}">${clock.is_open ? 'Open' : 'Closed'}</b></div>
    <div class="stat"><span>Next open</span><b style="font-size:15px">${new Date(clock.next_open).toLocaleString()}</b></div><div class="stat"><span>Next close</span><b style="font-size:15px">${new Date(clock.next_close).toLocaleString()}</b></div></div></div>
  <div class="grid">
    <div class="card tablewrap"><h2>Trading days (next 30 days)</h2><table><tr><th>Date</th><th>Open</th><th>Close</th><th></th></tr>
      ${days.map(d => `<tr><td>${new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${H.esc(d.open)}</td><td>${H.esc(d.close)}</td><td>${early(d) ? '<span class="pill warn">Early close</span>' : ''}</td></tr>`).join('')}</table>
      <p class="mu" style="font-size:12px">Days not listed are market holidays or weekends. Times are New York time.</p></div>
    <div class="card tablewrap"><div class="row" style="justify-content:space-between"><h2>Corporate actions</h2><form id="cf" class="row"><input name="symbol" value="${H.esc(sym)}" placeholder="Symbol" style="max-width:110px"><button class="small">Filter</button></form></div>
      ${ann?.error ? `<p class="err">${H.esc(ann.error)}</p>` : `<table><tr><th>Symbol</th><th>Type</th><th>Ex-date</th><th>Payable</th><th>Details</th></tr>
      ${(ann || []).map(a => `<tr><td><a href="#/trade?symbol=${encodeURIComponent(a.initiating_symbol || a.target_symbol || '')}">${H.esc(a.initiating_symbol || a.target_symbol || '')}</a></td><td>${H.esc(a.ca_type)}${a.ca_sub_type ? ' · ' + H.esc(a.ca_sub_type) : ''}</td><td>${H.esc(a.ex_date || '-')}</td><td>${H.esc(a.payable_date || '-')}</td>
        <td>${a.cash ? '$' + H.esc(a.cash) + '/sh' : a.new_rate && a.old_rate ? H.esc(a.new_rate) + ':' + H.esc(a.old_rate) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">No announcements in this window.</td></tr>'}</table>`}
      <p class="mu" style="font-size:12px">Dividends, splits, mergers and spinoffs announced from 30 days ago to 60 days ahead.</p></div>
  </div>` : ''}`;
  const showDay = ds => {
    const ev = byDay[ds] || [];
    H.$$('.cal-d', view).forEach(c => c.classList.toggle('sel', c.dataset.day === ds));
    H.$('#calDay', view).innerHTML = `<h3 style="margin:16px 0 6px">${new Date(ds + 'T12:00:00Z').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}</h3>${ev.length ? `<ul class="cal-list">${ev.map(e => `<li><i class="ev ${e.k}"></i><span data-no-tr>${H.esc(e.d)}</span>${e.link ? ` <a href="#/trade?symbol=${encodeURIComponent(e.link)}">Trade</a>` : ''}</li>`).join('')}</ul>` : '<p class="mu">Nothing scheduled.</p>'}`;
  };
  H.$$('.cal-d[data-day]', view).forEach(c => (c.onclick = () => showDay(c.dataset.day)));
  const firstEv = Object.keys(byDay).filter(d => d >= today).sort()[0];
  if (ym === today.slice(0, 7)) showDay(today); else if (firstEv) showDay(firstEv);
  if (H.$('#cf', view)) H.$('#cf', view).onsubmit = e => { e.preventDefault(); location.hash = '#/calendar?symbol=' + encodeURIComponent(H.form(e.target).symbol.trim()); };
}
