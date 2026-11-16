// Planning tools (#/tradetools): position size, risk/reward with an ATR stop, the sector heatmap, and
// two guarded AI explainers. Nothing
// here places, changes or cancels an order. How each tool works: docs/TRADING_TOOLS.md.
let H;
export function registerTradeTools(routes, helpers) { H = helpers; routes.tradetools = page; }

const TABS = [['sizing', 'Position size'], ['rr', 'Risk / reward'], ['heatmap', 'Sector heatmap'], ['portfolio', 'Portfolio explainer (AI)'], ['indicator', 'Indicator explainer (AI)']];
export const disclaimer = text => `<aside class="tt-disclaimer" role="note" aria-label="Important information"><b>Important:</b> ${H.esc(text)}</aside>`;
const BASE = 'For planning and education only. Not investment advice and not an order: nothing is sent to your broker. Investing involves risk, including the loss of the money you invest.';
const n2 = x => (x == null ? '–' : Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const age = m => (m == null ? '' : m < 60 ? `${m} min old` : m < 2880 ? `${Math.round(m / 60)} hours old` : `${Math.round(m / 1440)} days old`);
const sign = x => (x == null ? 'no price' : `${x > 0 ? '▲ +' : x < 0 ? '▼ ' : ''}${n2(x)}%`);
const field = (label, name, attrs = '', help = '') => `<label>${label}<input name="${name}" inputmode="decimal" autocomplete="off" ${attrs}${help ? ` aria-describedby="h-${name}"` : ''}>${help ? `<small class="mu" id="h-${name}">${help}</small>` : ''}</label>`;
const side = () => `<fieldset class="tt-side"><legend>Direction</legend><label class="check"><input type="radio" name="side" value="long" checked> Long (buy first)</label><label class="check"><input type="radio" name="side" value="short"> Short (sell first)</label></fieldset>`;

async function page(view, q) {
  const tabs = TABS;
  const tab = tabs.some(([k]) => k === q.get('tab')) ? q.get('tab') : tabs[0][0];
  view.innerHTML = `<div class="pagehead"><div><h1>Planning tools</h1><p class="mu" style="margin:4px 0 0">Calculators and explainers that read data and show the arithmetic. They never place an order.</p></div></div>
    <nav class="chips" aria-label="Planning tools">${tabs.map(([k, t]) => `<a href="#/tradetools?tab=${k}" ${k === tab ? 'aria-current="page"' : ''}><button type="button" class="${k === tab ? 'on' : ''}" tabindex="-1">${t}</button></a>`).join('')}</nav>
    <div id="tto"></div>`;
  await ({ sizing, rr, heatmap, portfolio, indicator })[tab](view.querySelector('#tto'));
}
const out = (o, html) => { const r = o.querySelector('.tt-result'); r.innerHTML = html; r.hidden = false; };
const shell = (title, intro, inner, btn) => `<form class="card tt-form" novalidate><h2>${title}</h2><p class="mu" style="margin-top:0">${intro}</p>${inner}<button type="submit">${btn}</button><div class="err" role="alert"></div></form><section class="card tt-result" aria-live="polite" hidden></section>`;
function wire(o, fn) {
  const f = o.querySelector('form'), b = f.querySelector('button[type=submit]');
  f.addEventListener('submit', e => { e.preventDefault(); b.click(); });
  // H.form reads every named input; for the Long / Short radios only the checked one counts.
  const read = () => { const v = H.form(f), r = f.querySelector('[name=side]:checked'); if (r) v.side = r.value; return v; };
  H.act(b, async () => { await fn(read()); return ''; });
}

// ---------- position size ----------
async function sizing(o) {
  o.innerHTML = shell('Position size', 'How many shares keep a loss at your stop within the share of the account you choose to risk.',
    `${side()}<div class="row">${field('Account size ($)', 'equity', 'required')}${field('Risk per trade (%)', 'riskPct', 'required value="1"', 'The most you are prepared to lose if the stop is hit.')}</div>
     <div class="row">${field('Entry price', 'entry', 'required')}${field('Stop price', 'stop', 'required')}</div>
     <div class="row">${field('Largest position (% of account)', 'maxPositionPct', 'value="100"')}${field('Lot size', 'lot', 'value="1"', 'Shares are rounded down to whole lots.')}</div>`, 'Calculate')
    + disclaimer(BASE);
  wire(o, async f => {
    const r = await H.api('/tools/size', { body: f });
    out(o, `<h2>Result</h2><p class="tt-big"><b>${n2(r.shares)}</b> shares</p>
      <div class="tablewrap"><table class="slim"><caption class="mu">How it was worked out</caption>
      <tr><th scope="row">Amount you chose to risk</th><td class="num">$${n2(r.riskBudget)}</td></tr>
      <tr><th scope="row">Risk per share (entry to stop)</th><td class="num">$${n2(r.riskPerShare)}</td></tr>
      <tr><th scope="row">Shares allowed by risk</th><td class="num">${n2(r.sharesByRisk)}</td></tr>
      <tr><th scope="row">Shares allowed by the largest position</th><td class="num">${n2(r.sharesByCap)}</td></tr>
      <tr><th scope="row">Position value</th><td class="num">$${n2(r.positionValue)} (${n2(r.positionPct)}% of the account)</td></tr>
      <tr><th scope="row">Loss if the stop is hit</th><td class="num">$${n2(r.risk)} (${n2(r.riskPctActual)}%)</td></tr></table></div>
      <p class="mu">Limited by: ${H.esc(r.limitedBy)}. A stop is not guaranteed to fill at its price; gaps and fast markets can make the loss larger.</p>`);
  });
}

// ---------- risk / reward ----------
async function rr(o) {
  o.innerHTML = shell('Risk / reward', 'Compares what you could lose at the stop with what you could gain at each target, and the win rate you would need to break even.',
    `${side()}<div class="row">${field('Entry price', 'entry', 'required')}${field('Stop price', 'stop', 'required')}</div>
     <div class="row">${field('Target 1', 't1', 'required')}${field('Target 2 (optional)', 't2')}${field('Target 3 (optional)', 't3')}</div>
     <div class="row">${field('Costs per share (optional)', 'costPerShare', '', 'Commissions, fees, expected slippage.')}${field('Your win rate % (optional)', 'winRate', '', 'From your own journal. Used only to show expectancy.')}</div>
     <div class="row"><label>Symbol for an ATR stop (optional)<input name="symbol" autocomplete="off" data-no-tr placeholder="AAPL"></label>${field('ATR multiple', 'atrMultiple', 'value="2"')}</div>`, 'Calculate')
    + disclaimer(BASE);
  wire(o, async f => {
    const r = await H.api('/tools/rr', { body: { ...f, targets: [f.t1, f.t2, f.t3].filter(Boolean), symbol: f.symbol || undefined } });
    const a = r.atr;
    out(o, `<h2>Result</h2><p>Risk per share: <b>$${n2(r.risk)}</b></p>
      <div class="tablewrap"><table class="slim"><caption class="mu">Per target</caption><tr><th scope="col">Target</th><th scope="col" class="num">Reward per share</th><th scope="col" class="num">Reward ÷ risk (R)</th><th scope="col" class="num">Win rate needed to break even</th>${r.winRate != null ? `<th scope="col" class="num">Expectancy at ${n2(r.winRate)}% (in R)</th>` : ''}</tr>
      ${r.targets.map(t => `<tr><td class="num">${n2(t.target)}</td><td class="num">$${n2(t.reward)}</td><td class="num">${n2(t.r)}</td><td class="num">${n2(t.breakevenWinRate)}%</td>${t.expectancyR != null ? `<td class="num">${n2(t.expectancyR)}</td>` : ''}</tr>`).join('')}</table></div>
      ${a ? `<h3>ATR stop for <span data-no-tr>${H.esc(a.symbol)}</span></h3><p>14-day ATR: ${n2(a.atr)}. ${n2(a.stop.distance)} away from the entry (${n2(a.stop.distancePct)}%) puts the stop at <b>${n2(a.stop.stop)}</b>.</p><p class="mu"><span class="pill">${a.data.delayed ? 'Delayed data' : a.data.partial ? 'One exchange' : 'Live data'}</span> ${H.esc(a.data.source)}. Last bar ${a.asOf ? H.esc(new Date(a.asOf).toLocaleDateString()) : 'unknown'}.</p>` : f.symbol ? '<p class="mu">Not enough price history for an ATR stop.</p>' : ''}
      <p class="mu">These are simple ratios before taxes. They do not estimate how likely a target is.</p>`);
  });
}

// ---------- sector heatmap ----------
async function heatmap(o) {
  o.innerHTML = '<div class="card"><p class="mu">Loading…</p></div>';
  let d; try { d = await H.api('/tools/heatmap'); } catch (e) { o.innerHTML = `<div class="card"><p class="err" role="alert">${H.esc(e.message)}</p></div>${disclaimer(BASE)}`; return; }
  const oldest = Math.max(...d.sectors.map(s => s.ageMin ?? 0));
  o.innerHTML = `<section class="card"><h2>Sector heatmap</h2>
    <p><span class="pill">${d.data.delayed ? 'Delayed data' : d.data.partial ? 'One exchange (IEX)' : 'Live data'}</span> ${H.esc(d.data.source)}. ${H.esc(d.data.note)} ${oldest ? `Oldest price is ${age(oldest)}.` : ''}</p>
    <ul class="tt-heat" aria-label="Change today by sector">${d.sectors.map(s => `<li class="tt-tile ${s.changePct == null ? '' : s.changePct >= 0 ? 'up' : 'down'}"><b>${H.esc(s.sector)}</b><span data-no-tr>${H.esc(s.symbol)}</span><span>${sign(s.changePct)}</span><small class="mu">${s.price != null ? '$' + n2(s.price) : 'No price'}${s.ageMin != null ? ` · ${age(s.ageMin)}` : ''}</small></li>`).join('')}</ul>
    <p class="mu">${H.esc(d.note)}</p><button type="button" class="ghost" id="ttRefresh">Refresh</button></section>${disclaimer(BASE)}`;
  o.querySelector('#ttRefresh').onclick = () => heatmap(o);
}

// ---------- AI explainers ----------
const aiResult = r => `<h2>Explanation</h2>
  <p class="tt-ailabel"><span class="pill">${r.aiGenerated ? 'Written by AI' : r.outcome.startsWith('blocked') ? 'Request refused' : 'Written from rules (no AI used)'}</span></p>
  <p>${H.esc(r.explanation)}</p>${r.keyPoints?.length ? `<ul>${r.keyPoints.map(k => `<li>${H.esc(k)}</li>`).join('')}</ul>` : ''}
  <h3>Sources</h3><ul>${r.sources.map(s => `<li>${H.esc(s)}</li>`).join('')}</ul>${disclaimer(r.disclaimer)}`;
async function portfolio(o) {
  o.innerHTML = shell('Portfolio concentration explainer', 'Explains how concentrated a set of holdings is: the share in the largest ones and the concentration index. It cannot tell you what to buy or sell.',
    `<label>Holdings, one per line: symbol, value, sector (sector optional)<textarea name="holdings" rows="6" data-no-tr placeholder="AAPL, 5000, Technology&#10;XOM, 2000, Energy"></textarea></label>
     <button type="button" class="ghost" id="ttFill">Fill from my positions</button>
     <label>Question (optional)<input name="question" maxlength="300" placeholder="What does the concentration index mean?"></label>`, 'Explain')
    + disclaimer('Generated by AI where available. Educational information only, not investment advice, and it may be wrong. Investing involves risk, including the loss of the money you invest.');
  H.act(o.querySelector('#ttFill'), async () => {
    const ps = await H.api('/alpaca/positions');
    o.querySelector('[name=holdings]').value = ps.map(p => `${p.symbol}, ${Math.abs(p.marketValue).toFixed(2)}`).join('\n');
    return ps.length ? `Filled ${ps.length} holdings from your positions.` : 'No positions found.';
  });
  wire(o, async f => {
    const holdings = String(f.holdings || '').split('\n').map(l => l.split(',').map(x => x.trim())).filter(x => x[0]).map(([symbol, value, sector]) => ({ symbol, value: +String(value || '').replace(/[$,]/g, ''), sector }));
    const r = await H.api('/tools/ai/portfolio', { body: { holdings, question: f.question } });
    out(o, aiResult(r) + `<h3>Figures</h3><div class="tablewrap"><table class="slim"><tr><th scope="row">Holdings</th><td class="num">${r.concentration.count}</td></tr><tr><th scope="row">Largest 1 / 3 / 5</th><td class="num">${n2(r.concentration.top1)}% / ${n2(r.concentration.top3)}% / ${n2(r.concentration.top5)}%</td></tr><tr><th scope="row">Concentration index (HHI)</th><td class="num">${n2(r.concentration.hhi)}</td></tr><tr><th scope="row">Like this many equal holdings</th><td class="num">${n2(r.concentration.effectiveN)}</td></tr></table></div>`);
  });
}
async function indicator(o) {
  o.innerHTML = shell('Indicator explainer (educational)', 'Calculates an indicator from daily prices and explains what the reading means. It describes the past and does not predict.',
    `<div class="row"><label>Symbol<input name="symbol" required autocomplete="off" data-no-tr placeholder="AAPL"></label>
     <label>Indicator<select name="indicator"><option value="rsi">RSI (14)</option><option value="macd">MACD (12, 26, 9)</option><option value="sma">50- and 200-day averages</option><option value="bollinger">Bollinger bands (20, 2)</option></select></label></div>
     <label>Question (optional)<input name="question" maxlength="300" placeholder="What does overbought mean?"></label>`, 'Explain')
    + disclaimer('Educational. Generated by AI where available; it may be wrong. Not investment advice. Investing involves risk, including the loss of the money you invest.');
  wire(o, async f => {
    const r = await H.api('/tools/ai/indicator', { body: f });
    out(o, aiResult(r) + `<p class="mu"><span class="pill">${r.data.delayed ? 'Delayed data' : r.data.partial ? 'One exchange' : 'Live data'}</span> Prices up to ${H.esc(r.facts.asOf)}.</p>`);
  });
}
