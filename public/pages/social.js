// Top traders (copy trading) and Automated portfolios (model portfolios that rebalance themselves).
//   traders   ranked public profiles (percentages only, trades a day late); a profile shows its mix,
//             curve and recent trades, with "Copy this portfolio" (a Rules across accounts plan that
//             keeps your account at the same mix) and "Follow trades" (its signal channel).
//   robo      five questions give a risk level 1–5 and a low-cost index-fund mix; one button sets it up
//             as a plan that rebalances every quarter (or when it drifts 5%) with weekly tax-loss harvesting.
let H;
export function registerSocial(routes, helpers) { H = helpers; routes.traders = traders; routes.robo = robo; }

const P = { m1: '1 month', m3: '3 months', y1: '1 year' };
const pc = v => (v == null ? '-' : `<b class="${H.cls(v)}">${v > 0 ? '+' : ''}${v}%</b>`);

async function traders(view, q) {
  const h = q.get('h');
  if (h) return profile(view, h);
  const period = P[q.get('p')] ? q.get('p') : 'm3';
  const [top, me] = await Promise.all([H.api('/profiles/top?period=' + period), H.api('/profiles/me')]);
  const accts = await H.accounts();
  view.innerHTML = `<div class="pagehead"><div><h1>Top traders</h1><p class="mu" style="margin:4px 0 0">Ranked by return. Only percentages are public, never amounts, and trades show one day late.</p></div></div>
  ${H.marketTabs ? H.marketTabs('traders') : ''}
  <div class="chips viewtabs">${Object.entries(P).map(([k, t]) => `<a href="#/traders?p=${k}"><button type="button" class="${k === period ? 'on' : ''}">${t}</button></a>`).join('')}</div>
  <div class="card"><div class="tablewrap"><table><tr><th>#</th><th>Trader</th><th class="num">Return ${P[period]}</th><th class="num">Largest drop</th><th class="num">1 year</th><th class="num">Trades (90 days)</th><th class="num">Followers</th><th></th></tr>
  ${top.traders.map((t, i) => `<tr><td>${i + 1}</td><td><a href="#/traders?h=${t.handle}"><b>${H.esc(t.name)}</b></a><br><small class="mu">${H.esc(t.account)}${t.bio ? ' · ' + H.esc(t.bio.slice(0, 60)) : ''}</small></td><td class="num">${pc(t.perf[period].ret)}</td><td class="num">${pc(t.perf[period].drawdown)}</td><td class="num">${pc(t.perf.y1.ret)}</td><td class="num">${t.trades90}</td><td class="num">${t.followers}</td><td><a href="#/traders?h=${t.handle}"><button type="button" class="small ghost">View</button></a></td></tr>`).join('') || `<tr><td colspan="8" class="mu">No public profiles with at least 20 days of history yet. Be the first: switch yours on below.</td></tr>`}
  </table></div><p class="mu small-print">Past results are not a promise of future results. Copying someone is your own decision; check what you are buying.</p></div>
  <form class="card" id="myProf"><h2>My public profile</h2>
    <label class="chk"><input type="checkbox" name="on" ${me.on ? 'checked' : ''}> Show my profile in Top traders as <b data-no-tr>${H.esc(me.name)}</b></label>
    <div class="row"><label>Account to show<select name="account">${H.accountOptions(accts, me.account || 'paper')}</select></label><label style="flex:3">About me (280 characters)<input name="bio" maxlength="280" value="${H.esc(me.bio || '')}" placeholder="e.g. Long-term dividend investor"></label></div>
    <button>Save</button><span class="ok"></span><div class="err"></div>
    <p class="mu small-print">Shown: returns, largest drop, holding weights in %, and your trades one day later. Never shown: your name, email, dollar amounts or open orders. To let others mirror your trades as you make them, create a public channel in <a href="#/fleet">Signal fleet</a>.</p></form>`;
  const f = H.$('#myProf', view);
  H.act(H.$('button', f), async () => { const v = H.form(f); await H.api('/profiles/me', { method: 'PUT', body: { on: !!v.on, account: v.account, bio: v.bio } }); return 'Saved'; }, H.$('.ok', f));
}

async function profile(view, handle) {
  let t; try { t = await H.api('/profiles/' + encodeURIComponent(handle)); } catch (e) { view.innerHTML = `<div class="card"><p>${H.esc(e.message)}</p><a href="#/traders">← Top traders</a></div>`; return; }
  const accts = await H.accounts();
  view.innerHTML = `<p><a href="#/traders">← Top traders</a></p><div class="pagehead"><div><h1>${H.esc(t.name)}</h1><p class="mu" style="margin:4px 0 0">${H.esc(t.account)}${t.bio ? ' · ' + H.esc(t.bio) : ''}</p></div></div>
  <div class="card"><div class="stats">${Object.entries(P).map(([k, l]) => `<div class="stat"><span>${l}</span>${pc(t.perf[k].ret)}<small class="mu">largest drop ${t.perf[k].drawdown ?? '-'}%</small></div>`).join('')}<div class="stat"><span>Trades (90 days)</span><b>${t.trades90}</b></div><div class="stat"><span>Followers</span><b>${t.followers}</b></div></div>
  ${t.curve.length > 1 ? '<canvas id="pc" style="height:220px"></canvas>' : '<p class="mu">Not enough history for a chart yet.</p>'}</div>
  <div class="grid"><div class="card"><h2>Holdings</h2><div class="tablewrap"><table class="slim"><tr><th>Symbol</th><th class="num">Weight</th></tr>${t.holdings.map(x => `<tr><td><a href="#/trade?symbol=${encodeURIComponent(x.symbol)}">${H.esc(x.symbol)}</a></td><td class="num">${x.weight}%</td></tr>`).join('')}${t.cashWeight != null ? `<tr><td class="mu">Cash</td><td class="num">${t.cashWeight}%</td></tr>` : ''}</table></div></div>
  <div class="card"><h2>Recent trades</h2><p class="mu small-print" style="margin-top:0">Shown one day late.</p><div class="tablewrap"><table class="slim"><tr><th>Day</th><th>Side</th><th>Symbol</th></tr>${t.recent.map(f => `<tr><td>${f.day}</td><td class="${f.side === 'buy' ? 'pos' : 'neg'}">${f.side === 'buy' ? 'Bought' : 'Sold'}</td><td>${H.esc(f.symbol)}</td></tr>`).join('') || '<tr><td colspan="3" class="mu">None yet</td></tr>'}</table></div></div></div>
  <div class="card" id="copy"><h2>Copy</h2><div class="row"><label>Into my account<select id="cpAcct">${H.accountOptions(accts, H.state.account || 'paper', H.paid())}</select></label></div>
    <div class="row" style="gap:8px"><button type="button" id="cpMix" ${t.holdings.length ? '' : 'disabled'}>Copy this portfolio</button>${t.channel ? `<button type="button" class="ghost" id="cpFollow">Follow trades (${H.esc(t.channel.name)})</button>` : ''}</div><div class="err"></div><p class="ok"></p>
    <p class="mu small-print"><b>Copy this portfolio</b> creates a plan in <a href="#/rules">Rules across accounts</a> with the same weights; you review and approve each rebalance before anything is traded. <b>Follow trades</b> sends each of the trader's new trades to your inbox to accept (or does it automatically in a practice account).</p></div>`;
  if (t.curve.length > 1) H.drawChart(H.$('#pc', view), t.curve.map(c => c.pct), { dates: t.curve.map(c => c.day), legend: false, base: 0 });
  const box = H.$('#copy', view), err = H.$('.err', box), ok = H.$('.ok', box);
  H.$('#cpMix', view).onclick = async () => {
    err.textContent = ''; ok.textContent = '';
    const xs = t.holdings.filter(x => x.weight > 0), sum = xs.reduce((s, x) => s + x.weight, 0);
    const targets = xs.map(x => ({ symbol: x.symbol, pct: +(x.weight / sum * 100).toFixed(2) }));
    if (targets.length) targets[0].pct = +(100 - targets.slice(1).reduce((s, x) => s + x.pct, 0)).toFixed(2);
    try { await H.api('/rules', { body: { name: `Copy of ${t.name}`.slice(0, 60), targets, accounts: [H.$('#cpAcct', view).value], schedule: 'monthly', options: { driftPct: 5 } } }); ok.innerHTML = 'Plan created. <a href="#/rules">Open Rules across accounts</a> to review the first rebalance.'; } catch (e) { err.textContent = e.message; }
  };
  const fb = H.$('#cpFollow', view);
  if (fb) fb.onclick = async () => { err.textContent = ''; ok.textContent = ''; const a = H.$('#cpAcct', view).value; try { await H.api(`/fleet/channels/${t.channel.id}/subscribe`, { body: { accounts: [a], mode: a === 'paper' ? 'auto' : 'review', sizing: 'pct', amount: 5 } }); ok.innerHTML = 'Following. New trades arrive in <a href="#/fleet">Signal fleet</a>.'; } catch (e) { err.textContent = e.message; } };
}

// ---------- robo-advisor ----------
export const MODELS = {
  1: { name: 'Conservative', mix: { VTI: 15, VXUS: 5, BND: 60, BNDX: 10, SGOV: 10 } },
  2: { name: 'Moderately conservative', mix: { VTI: 28, VXUS: 12, BND: 45, BNDX: 10, SGOV: 5 } },
  3: { name: 'Balanced', mix: { VTI: 42, VXUS: 18, BND: 32, BNDX: 8 } },
  4: { name: 'Growth', mix: { VTI: 56, VXUS: 24, BND: 16, BNDX: 4 } },
  5: { name: 'Aggressive growth', mix: { VTI: 66, VXUS: 29, BND: 5 } },
};
const NAMES = { VTI: 'US total stock market', VXUS: 'International stocks', BND: 'US bonds', BNDX: 'International bonds', SGOV: '0–3 month Treasury bills' };
const QS = [
  ['horizon', 'When will you need most of this money?', [['1', 'In under 3 years'], ['3', 'In 3 to 5 years'], ['4', 'In 6 to 10 years'], ['5', 'In more than 10 years']]],
  ['drop', 'Your investments fall 20% in a month. What do you do?', [['1', 'Sell everything'], ['2', 'Sell some'], ['4', 'Wait'], ['5', 'Buy more']]],
  ['goal', 'What matters most?', [['1', 'Not losing money'], ['3', 'A balance of growth and safety'], ['5', 'As much growth as possible']]],
  ['income', 'How steady is your income?', [['2', 'Uncertain'], ['3', 'Fairly steady'], ['4', 'Very steady']]],
  ['experience', 'How much have you invested before?', [['2', 'Never'], ['3', 'A little'], ['4', 'A lot']]],
];
// The level is the average answer, capped by how soon the money is needed.
export function riskLevel(a) {
  const xs = QS.map(([k]) => +a[k]).filter(Number.isFinite);
  if (xs.length < QS.length) return null;
  let lvl = Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  if (+a.horizon <= 1) lvl = Math.min(lvl, 2); else if (+a.horizon <= 3) lvl = Math.min(lvl, 3);
  return Math.max(1, Math.min(5, lvl));
}

async function robo(view) {
  const accts = await H.accounts();
  view.innerHTML = `<div class="pagehead"><div><h1>Automated portfolios</h1><p class="mu" style="margin:4px 0 0">Answer five questions and get a low-cost index-fund mix that matches your risk. It keeps itself balanced and harvests tax losses for you.</p></div></div>
  <form class="card" id="rq">${QS.map(([k, t, opts], i) => `<fieldset class="roboq"><legend><b>${i + 1}. ${t}</b></legend>${opts.map(([v, l]) => `<label class="chk"><input type="radio" name="${k}" value="${v}" required> ${l}</label>`).join('')}</fieldset>`).join('')}<button>See my portfolio</button></form>
  <div id="rOut"></div>`;
  const f = H.$('#rq', view);
  f.onsubmit = e => {
    e.preventDefault();
    const lvl = riskLevel(Object.fromEntries(new FormData(f))), m = MODELS[lvl];
    const out = H.$('#rOut', view);
    out.innerHTML = `<div class="card"><h2>Level ${lvl} of 5: ${m.name}</h2><div class="tablewrap"><table class="slim"><tr><th>Fund</th><th>What it holds</th><th class="num">Share</th></tr>${Object.entries(m.mix).map(([s, p]) => `<tr><td><a href="#/trade?symbol=${s}">${s}</a></td><td>${NAMES[s]}</td><td class="num">${p}%</td></tr>`).join('')}</table></div>
      <p class="mu">Stocks ${Object.entries(m.mix).filter(([s]) => ['VTI', 'VXUS'].includes(s)).reduce((t, [, p]) => t + p, 0)}% · bonds and cash ${Object.entries(m.mix).filter(([s]) => !['VTI', 'VXUS'].includes(s)).reduce((t, [, p]) => t + p, 0)}%. Average fund cost about 0.05% a year.</p>
      <div class="row"><label>Account<select id="rAcct">${H.accountOptions(accts, H.state.account || 'paper', H.paid())}</select></label><label class="chk"><input type="checkbox" id="rTlh" checked> Harvest tax losses weekly (taxable accounts)</label></div>
      <button type="button" id="rGo">Set it up</button><div class="err"></div><p class="ok"></p>
      <p class="mu small-print">Set up as a plan in Rules across accounts: checked every quarter and whenever a fund drifts 5% from its share; you approve each rebalance before it trades. This is a general model portfolio, not personal advice.</p></div>`;
    const err = H.$('.err', out), ok = H.$('.ok', out);
    H.$('#rGo', out).onclick = async () => {
      err.textContent = ''; ok.textContent = '';
      try {
        const a = H.$('#rAcct', out).value;
        await H.api('/rules', { body: { name: `Automated: ${m.name}`, targets: Object.entries(m.mix).map(([symbol, pct]) => ({ symbol, pct })), accounts: [a], schedule: 'quarterly', options: { driftPct: 5, cashPct: 1 } } });
        if (H.$('#rTlh', out).checked) await H.api('/taxpilot', { method: 'PUT', body: { weekly: true } }).catch(() => {});
        ok.innerHTML = 'Done. <a href="#/rules">Review the first rebalance</a> to invest.';
      } catch (e) { err.textContent = e.message; }
    };
    out.scrollIntoView({ behavior: 'smooth' });
  };
}
