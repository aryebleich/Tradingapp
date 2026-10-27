// AI studio: the AI assistant (chat or voice, live market tools, strategy drafts you can backtest,
// save and deploy), forecasts and trainable AI agents, and the Python code lab.
import { canvasNote } from './i18n.js';
import { statArbPython } from './pairs.js';
let H;
export function registerStudio(routes, helpers) {
  H = helpers;
  Object.assign(routes, { ai: assistant, agents, code: codeLab });
}
const pc = (v, d = 1) => (v == null || !Number.isFinite(+v) ? '-' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);

// Minimal Markdown for assistant replies: escaped text with bold, code, links, lists and tables.
export function md(src) {
  const inline = s => H.esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [], lines = String(src || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:-|]+\|\s*$/.test(lines[i + 1] || '')) {
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l); i += 2; const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      i--; out.push(`<div class="tablewrap"><table><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`);
    } else if (/^\s*[-*] /.test(l)) {
      const items = []; while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, '')); i--;
      out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`);
    } else if (/^#{1,4} /.test(l)) out.push(`<p><b>${inline(l.replace(/^#+ /, ''))}</b></p>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('');
}

// ---------- AI assistant ----------
const SUGGEST = ['How does NVDA look technically?', 'What did Apple report last quarter?', 'Forecast SPY for the next 10 days', 'Build a strategy that buys QQQ dips in an uptrend', 'Explain the Sharpe ratio simply', 'How is my paper portfolio doing?'];
async function assistant(view) {
  const [st, accts] = await Promise.all([H.api('/ai/status'), H.accounts()]);
  let msgs = []; try { msgs = JSON.parse(sessionStorage.getItem('qp_chat') || '[]'); } catch {}
  let draft = null, speak = false;
  try { speak = localStorage.getItem('qp_speak') === '1'; } catch {}
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  view.innerHTML = `<div class="pagehead"><h1>AI assistant</h1><p class="mu" style="margin:4px 0 0">Ask about markets, a stock's technicals or fundamentals, trading ideas, or have it design a strategy with you. ${st.ai ? '' : '<b>Basic mode:</b> set a free AI key on the server (GROQ_API_KEY or GEMINI_API_KEY) for the full assistant.'}</p></div>
  <div class="chatwrap"><div class="card chat"><div id="log" class="chatlog"></div>
    <div class="chips" id="sugg">${SUGGEST.map(s => `<button type="button">${H.esc(s)}</button>`).join('')}</div>
    <form id="ask" class="chatin"><textarea name="q" rows="2" placeholder="Ask anything, or describe a strategy..." aria-label="Message"></textarea>
      <div class="chatbtns">${Rec ? '<button type="button" class="ghost" id="mic" title="Speak">🎤</button>' : ''}<button type="button" class="ghost ${speak ? 'on' : ''}" id="spk" title="Read answers aloud">🔊</button><button id="send">Send</button></div></form>
    <div class="err" id="chatErr"></div><p class="mu small-print">Information and education, not investment advice. The assistant never places orders: you do, with the buttons.</p></div>
    <div id="draftBox"></div></div>`;
  const log = H.$('#log', view), box = H.$('#draftBox', view), ta = H.$('textarea', view);
  const save = () => { try { sessionStorage.setItem('qp_chat', JSON.stringify(msgs.slice(-30))); } catch {} };
  const draw = () => {
    log.innerHTML = msgs.length ? msgs.map(m => `<div class="msg ${m.role}">${m.role === 'user' ? H.esc(m.content) : md(m.content)}${m.sources?.length ? `<div class="mu srcs">Sources: ${m.sources.map(s => `<a href="${H.esc(s.url)}" target="_blank" rel="noopener">${H.esc(s.title || new URL(s.url).hostname)}</a>`).join(' · ')}</div>` : ''}</div>`).join('')
      : '<div class="mu" style="padding:12px">Start with a question, or tap a suggestion.</div>';
    log.scrollTop = log.scrollHeight;
  };
  const say = text => { if (!speak || !window.speechSynthesis) return; const u = new SpeechSynthesisUtterance(text.replace(/[*`#|]/g, '').slice(0, 1500)); speechSynthesis.cancel(); speechSynthesis.speak(u); };
  const showDraft = () => {
    if (!draft) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card draft"><h2>Strategy draft</h2><div class="kv"><span>Name</span><span>${H.esc(draft.name)}</span><span>Symbol</span><span>${H.esc(draft.symbol)}</span>
      <span>Enter when</span><span><code>${H.esc(draft.entry).replace(/\n/g, '<br>')}</code></span><span>Exit when</span><span><code>${H.esc(draft.exit).replace(/\n/g, '<br>')}</code></span>
      <span>Stop / target / trail</span><span>${draft.sl || 0}% / ${draft.tp || 0}% / ${draft.ts || 0}%</span></div><p class="mu">${H.esc(draft.explanation || '')}</p>
      <div class="row"><button id="dBt" class="ghost">Backtest</button><button id="dSave">Save as bot</button></div><div class="err"></div><div id="dOut"></div></div>`;
    H.act(H.$('#dBt', box), async () => {
      const r = await H.api('/backtest', { body: { symbol: draft.symbol, entry: draft.entry, exit: draft.exit, sl: draft.sl, tp: draft.tp, ts: draft.ts } });
      H.$('#dOut', box).innerHTML = `<div class="stats"><div class="stat"><span>Return</span><b class="${H.cls(r.m.ret)}">${pc(r.m.ret)}</b></div><div class="stat"><span>Buy & hold</span><b>${pc(r.m.bh)}</b></div><div class="stat"><span>Max drawdown</span><b class="neg">-${r.m.dd.toFixed(1)}%</b></div><div class="stat"><span>Trades</span><b>${r.m.trades}</b></div></div><canvas class="chart" id="dCh" style="height:180px"></canvas>`;
      H.drawChart(H.$('#dCh', box), r.curve.map(p => p.eq), { compare: r.curve.map(p => p.bh) });
    });
    H.act(H.$('#dSave', box), async () => {
      const s = await H.api('/strategies', { body: { name: draft.name, symbol: draft.symbol, entry: draft.entry, exit: draft.exit, sl: draft.sl, tp: draft.tp, ts: draft.ts } });
      H.$('#dOut', box).innerHTML = `<form id="dDep" class="row" style="margin-top:10px"><label>Run on<select name="account">${H.accountOptions(accts, 'paper')}</select></label>
        <label>Check<select name="freq"><option value="daily">Daily, near the close</option><option value="1Hour">Every hour</option><option value="15Min">Every 15 minutes</option></select></label><button>Deploy</button></form><div class="err"></div>`;
      H.act(H.$('#dDep button', box), async () => { await H.api(`/strategies/${s.id}/deploy`, { body: H.form(H.$('#dDep', box)) }); return 'Deployed. Manage it under Bots.'; });
      return 'Saved under Bots.';
    });
  };
  const send = async text => {
    if (!text.trim()) return;
    msgs.push({ role: 'user', content: text.trim() }); draw(); ta.value = '';
    log.insertAdjacentHTML('beforeend', '<div class="msg assistant typing"><span></span><span></span><span></span></div>'); log.scrollTop = log.scrollHeight;
    try {
      const r = await H.api('/ai/chat', { body: { messages: msgs.map(({ role, content }) => ({ role, content })) } });
      msgs.push({ role: 'assistant', content: r.reply || '(no answer)', sources: r.sources });
      if (r.draft) { draft = r.draft; showDraft(); }
      say(r.reply || '');
    } catch (e) { msgs.pop(); H.$('#chatErr', view).textContent = e.message; }
    save(); draw();
  };
  H.$('#ask', view).onsubmit = e => { e.preventDefault(); send(ta.value); };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ta.value); } };
  H.$$('#sugg button', view).forEach(b => (b.onclick = () => send(b.textContent)));
  H.$('#spk', view).onclick = e => { speak = !speak; e.currentTarget.classList.toggle('on', speak); try { localStorage.setItem('qp_speak', speak ? '1' : '0'); } catch {} if (!speak) speechSynthesis?.cancel(); };
  if (Rec) H.$('#mic', view).onclick = e => {
    const r = new Rec(); r.lang = document.documentElement.lang === 'yi' ? 'yi' : 'en-US'; r.interimResults = false;
    e.currentTarget.classList.add('on'); r.onresult = ev => send(ev.results[0][0].transcript); r.onend = () => H.$('#mic', view)?.classList.remove('on'); r.start();
  };
  H.onLeave(() => window.speechSynthesis?.cancel());
  draw();
}

// ---------- forecasts and AI agents ----------
async function agents(view, q) {
  const [meta, list, accts] = await Promise.all([H.api('/ml/features'), H.api('/ml/agents'), H.accounts()]);
  const sym = (q.get('symbol') || 'SPY').toUpperCase();
  view.innerHTML = `<div class="pagehead"><h1>Forecasts & AI agents</h1><p class="mu" style="margin:4px 0 0">Train a model on a symbol's history: it learns from indicator features how often prices were higher N days later, is tested on the years it never saw, and gives today's odds. Save it as an agent to trade it automatically.</p></div>
  <form class="card" id="fc"><div class="row"><label>Symbol<input name="symbol" value="${H.esc(sym)}" required></label><label>Days ahead<select name="horizon">${[1, 5, 10, 20].map(n => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Buy when the chance is above<select name="threshold">${[0.52, 0.55, 0.6, 0.65].map(n => `<option value="${n}" ${n === 0.55 ? 'selected' : ''}>${Math.round(n * 100)}%</option>`).join('')}</select></label><label>Years of history<select name="years">${[5, 8, 12].map(n => `<option ${n === 8 ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
    <details><summary>Features the model can use</summary><div class="chips feats">${Object.entries(meta.features).map(([k, v]) => `<label class="check"><input type="checkbox" name="f_${k}" checked> ${H.esc(v)}</label>`).join('')}</div></details>
    <button>Train and forecast</button><div class="err"></div></form>
  <div id="fcOut"></div>
  <div class="card tablewrap"><h2>My agents</h2><table><tr><th>Agent</th><th>Out-of-sample</th><th>Today</th><th>Account</th><th>Status</th><th>Last action</th><th></th></tr>
    ${list.map(a => `<tr><td><b>${H.esc(a.name)}</b><div class="mu">${H.esc(a.symbol)} · ${a.config.horizon}-day · buy above ${Math.round(a.config.threshold * 100)}%</div></td>
      <td>${a.metrics ? `${a.metrics.accuracy}% right · ${pc(a.metrics.strategyReturn)} vs ${pc(a.metrics.buyHoldReturn)}` : '-'}</td><td>${a.metrics?.forecast ? `${a.metrics.forecast.probUp}% up · ${H.esc(a.metrics.forecast.signal)}` : '-'}</td>
      <td>${H.esc(H.acctLabel(accts.find(x => x.id === a.account) || { id: a.account, name: a.account }))}</td><td>${a.deployed ? '<span class="pill pos">Trading</span>' : '<span class="pill">Off</span>'}</td><td class="mu">${H.esc(a.last_action || '-')}</td>
      <td><button class="small ${a.deployed ? 'ghost' : ''}" data-dep="${a.id}" data-on="${a.deployed ? 0 : 1}">${a.deployed ? 'Stop' : 'Start'}</button> <button class="small ghost" data-del="${a.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="mu">No agents yet. Train a forecast above, then save it.</td></tr>'}</table><div class="err" id="agErr"></div>
    <p class="mu small-print">Agents decide once a day (stocks in the last half hour of the session, crypto at any time) and retrain weekly. Past patterns can stop working; the out-of-sample test shows how it did on data it never trained on.</p></div>`;
  const body = () => { const f = H.form(H.$('#fc', view)); return { symbol: f.symbol, horizon: +f.horizon, threshold: +f.threshold, years: +f.years, features: Object.keys(meta.features).filter(k => f['f_' + k]) }; };
  H.act(H.$('#fc button', view), async () => {
    const r = await H.api('/ml/forecast', { body: body() }), m = r.metrics, f = r.forecast;
    H.$('#fcOut', view).innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>${H.esc(r.symbol)}: ${f.probUp}% chance of being higher in ${m.horizon} days</h2><span class="pill ${f.signal === 'buy' ? 'pos' : f.signal === 'avoid' ? 'neg' : ''}">${H.esc(f.signal)}</span></div>
      <div class="stats"><div class="stat"><span>Typical move at these odds</span><b>${pc(f.expectedMovePct, 2)}</b></div><div class="stat"><span>Right on unseen data</span><b>${m.accuracy}%</b></div><div class="stat"><span>Up days base rate</span><b>${m.baseRate}%</b></div><div class="stat"><span>AUC</span><b>${m.auc ?? '-'}</b></div>
        <div class="stat"><span>Model trading (test)</span><b class="${H.cls(m.strategyReturn)}">${pc(m.strategyReturn)}</b></div><div class="stat"><span>Buy & hold (test)</span><b>${pc(m.buyHoldReturn)}</b></div><div class="stat"><span>Max drawdown</span><b class="neg">-${m.maxDrawdown}%</b></div><div class="stat"><span>Sharpe</span><b>${m.sharpe ?? '-'}</b></div></div>
      <canvas class="chart" id="fcCh" style="height:200px"></canvas><p class="mu small-print">Test period ${H.esc(m.testFrom)} to ${H.esc(m.testTo)} (${m.testDays} days the model never saw). ${r.dataSource === 'synthetic' ? '<b>Simulated prices:</b> no market data source is set.' : ''}</p>
      <h3>What drives it</h3><div class="funnel">${r.importance.map(x => `<div class="bar"><span>${H.esc(x.label)}</span><i style="width:${Math.min(100, Math.abs(x.weight) / Math.abs(r.importance[0].weight || 1) * 100)}%;${x.weight < 0 ? 'background:var(--rd)' : ''}"></i><b>${x.weight > 0 ? '+' : ''}${x.weight}</b></div>`).join('')}</div>
      <form id="sv" class="row" style="margin-top:14px"><label>Agent name<input name="name" value="${H.esc(r.symbol)} ${m.horizon}-day agent"></label><label>Trade on<select name="account">${H.accountOptions(accts, 'paper')}</select></label><label>Size (% of cash)<input name="size" type="number" min="1" max="100" value="25"></label><button>Save as agent</button></form><div class="err"></div></div>`;
    H.drawChart(H.$('#fcCh', view), r.curve.map(p => p.eq), { base: 1, compare: r.curve.map(p => p.bh) });
    H.act(H.$('#sv button', view), async () => { const s = H.form(H.$('#sv', view)); const a = await H.api('/ml/agents', { body: { ...body(), name: s.name, account: s.account, size: +s.size } }); if (s.account) await H.api(`/ml/agents/${a.id}/deploy`, { body: { account: s.account, size: +s.size } }); H.render(); });
  });
  H.$$('[data-dep]', view).forEach(b => (b.onclick = async () => { try { await H.api(`/ml/agents/${b.dataset.dep}/deploy`, { body: { on: b.dataset.on === '1' } }); H.render(); } catch (e) { H.$('#agErr', view).textContent = e.message; } }));
  H.$$('[data-del]', view).forEach(b => (b.onclick = async () => { await H.api('/ml/agents/' + b.dataset.del, { method: 'DELETE' }); H.render(); }));
}

// ---------- code lab ----------
const TEMPLATES = {
  'SMA crossover (one symbol)': `# symbols: SPY
# Return a list with your position for each day: 1 = invested, 0 = in cash (fractions are fine).
def signals(close):
    fast, slow = 20, 100
    out = []
    for i in range(len(close)):
        if i < slow:
            out.append(0)
            continue
        f = sum(close[i - fast + 1:i + 1]) / fast
        s = sum(close[i - slow + 1:i + 1]) / slow
        out.append(1 if f > s else 0)
    return out
`,
  'RSI dip buyer': `# symbols: QQQ
def rsi(close, n=14):
    gains, losses, out = 0.0, 0.0, [None] * len(close)
    for i in range(1, len(close)):
        d = close[i] - close[i - 1]
        g, l = max(d, 0), max(-d, 0)
        if i <= n:
            gains += g; losses += l
            if i == n: out[i] = 100 - 100 / (1 + gains / max(losses, 1e-9))
        else:
            gains = (gains * (n - 1) + g) / n; losses = (losses * (n - 1) + l) / n
            out[i] = 100 - 100 / (1 + gains / max(losses, 1e-9))
    return out

def signals(close):
    r, pos, out = rsi(close), 0, []
    for v in r:
        if v is not None and v < 30: pos = 1
        elif v is not None and v > 60: pos = 0
        out.append(pos)
    return out
`,
  'Momentum rotation (several symbols)': `# symbols: SPY, QQQ, TLT, GLD
# Return weights per symbol per day. Each day the weights should add up to 1 or less.
def portfolio(prices):
    syms = list(prices)
    n = len(prices[syms[0]]['close'])
    w = {s: [0.0] * n for s in syms}
    for i in range(126, n):
        if i % 21: # rebalance monthly, keep weights in between
            for s in syms: w[s][i] = w[s][i - 1]
            continue
        mom = {s: prices[s]['close'][i] / prices[s]['close'][i - 126] - 1 for s in syms}
        best = sorted(syms, key=lambda s: mom[s], reverse=True)[:2]
        for s in best:
            if mom[s] > 0: w[s][i] = 0.5
    return w
`,
  'Statistical arbitrage (numpy, several symbols)': statArbPython(['KO', 'PEP', 'PG', 'CL', 'KMB', 'MDLZ'], { window: 60, entry: 1.25, exit: 0.5 }),
  'QuantConnect algorithm': `# Runs on QuantConnect, not in the browser: use "Send to QuantConnect".
from AlgorithmImports import *

class SmaCross(QCAlgorithm):
    def initialize(self):
        self.set_start_date(2018, 1, 1)
        self.set_cash(10000)
        self.spy = self.add_equity("SPY", Resolution.DAILY).symbol
        self.fast = self.sma(self.spy, 20, Resolution.DAILY)
        self.slow = self.sma(self.spy, 100, Resolution.DAILY)
        self.set_warm_up(100)

    def on_data(self, data):
        if self.is_warming_up: return
        if self.fast.current.value > self.slow.current.value and not self.portfolio.invested:
            self.set_holdings(self.spy, 1)
        elif self.fast.current.value < self.slow.current.value and self.portfolio.invested:
            self.liquidate(self.spy)
`,
};
let pyodide = null;
async function loadPython(status) {
  if (pyodide) return pyodide;
  status('Loading Python (first run downloads about 10 MB)...');
  if (!window.loadPyodide) await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js'; s.onload = ok; s.onerror = () => fail(new Error('Could not load Python')); document.head.appendChild(s); });
  pyodide = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });
  return pyodide;
}
// Daily equity from per-day positions (position decided on day i earns day i+1's return).
export function equityFrom(prices, weights) {
  const syms = Object.keys(weights), n = Math.min(...syms.map(s => prices[s].close.length));
  let eq = 1, peak = 1, dd = 0; const curve = [1], rets = [];
  for (let i = 0; i < n - 1; i++) {
    let r = 0; for (const s of syms) { const w = +weights[s][i] || 0; r += w * (prices[s].close[i + 1] / prices[s].close[i] - 1); }
    eq *= 1 + r; rets.push(r); curve.push(eq); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  const m = rets.reduce((a, b) => a + b, 0) / (rets.length || 1), sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1));
  const first = syms[0], bh = prices[first].close.slice(0, n).map(x => x / prices[first].close[0]);
  return { curve, bh, stats: { totalReturn: (eq - 1) * 100, cagr: (eq ** (252 / Math.max(1, rets.length)) - 1) * 100, maxDrawdown: dd * 100, sharpe: sd ? m / sd * Math.sqrt(252) : null, buyHold: (bh.at(-1) - 1) * 100 } };
}
async function codeLab(view) {
  const scripts = await H.api('/code/scripts');
  let cur = scripts[0] || { id: null, name: 'SMA crossover', code: TEMPLATES['SMA crossover (one symbol)'] };
  // A script handed over from another page (Statistical arbitrage → "Run it in Python").
  try { const d = JSON.parse(sessionStorage.getItem('qp_code_draft') || 'null'); if (d?.code) { cur = { id: null, name: d.name, code: d.code }; sessionStorage.removeItem('qp_code_draft'); } } catch {}
  view.innerHTML = `<div class="pagehead"><h1>Code lab</h1><p class="mu" style="margin:4px 0 0">Write strategies in Python and backtest them on daily prices. Your code runs in your browser (Pyodide), not on the server. Send QuantConnect algorithms to your QuantConnect account to run them on their engine.</p></div>
  <div class="codegrid"><div class="card"><div class="row" style="justify-content:space-between;align-items:center"><input id="cname" value="${H.esc(cur.name)}" aria-label="Script name" style="max-width:280px;margin:0">
      <span class="row" style="gap:6px"><select id="tpl" aria-label="Templates"><option value="">Start from a template...</option>${Object.keys(TEMPLATES).map(t => `<option>${H.esc(t)}</option>`).join('')}</select>
      <select id="open" aria-label="My scripts"><option value="">My scripts (${scripts.length})</option>${scripts.map(s => `<option value="${s.id}">${H.esc(s.name)}</option>`).join('')}</select></span></div>
    <div class="editor"><pre class="gutter" id="gut" aria-hidden="true"></pre><textarea id="src" spellcheck="false" aria-label="Python code" data-no-tr>${H.esc(cur.code)}</textarea></div>
    <div class="row"><label>Start date<input id="start" type="date" value="2016-01-01"></label><button id="runPy">Run backtest</button><button class="ghost" id="saveCode">Save</button><button class="ghost" id="qcSend">Send to QuantConnect</button><button class="ghost danger" id="delCode" ${cur.id ? '' : 'hidden'}>Delete</button></div>
    <div class="err" id="codeErr"></div></div>
    <div class="card"><h2>Results</h2><div id="codeOut" class="mu">Run the script to see its equity curve and statistics.</div><pre id="stdout" class="stdout" data-no-tr hidden></pre></div></div>
  <div class="card"><h2>How scripts work</h2><ul class="mu"><li>The first line <code># symbols: SPY, QQQ</code> chooses the daily prices you get.</li><li>Define <code>signals(close)</code> for one symbol: return a position (0 to 1) for each day.</li><li>Or define <code>portfolio(prices)</code>: <code>prices[sym]['close']</code> and <code>['dates']</code>; return weights per symbol per day.</li><li>A position decided on a day earns the next day's return, so there is no look-ahead. <code>print()</code> output is shown under the results.</li></ul></div>`;
  const src = H.$('#src', view), gut = H.$('#gut', view), err = H.$('#codeErr', view);
  const lines = () => { gut.textContent = Array.from({ length: src.value.split('\n').length }, (_, i) => i + 1).join('\n'); gut.scrollTop = src.scrollTop; };
  src.oninput = lines; src.onscroll = () => (gut.scrollTop = src.scrollTop); lines();
  src.onkeydown = e => { if (e.key === 'Tab') { e.preventDefault(); const s = src.selectionStart; src.setRangeText('    ', s, src.selectionEnd, 'end'); lines(); } };
  H.$('#tpl', view).onchange = e => { if (!e.target.value) return; src.value = TEMPLATES[e.target.value]; H.$('#cname', view).value = e.target.value; cur = { id: null }; lines(); };
  H.$('#open', view).onchange = e => { const s = scripts.find(x => x.id === +e.target.value); if (s) { cur = s; src.value = s.code; H.$('#cname', view).value = s.name; H.$('#delCode', view).hidden = false; lines(); } };
  const out = H.$('#codeOut', view), so = H.$('#stdout', view);
  H.act(H.$('#runPy', view), async () => {
    const code = src.value;
    if (/QCAlgorithm/.test(code)) throw new Error('This is a QuantConnect algorithm: use "Send to QuantConnect".');
    const syms = ((code.match(/^#\s*symbols:\s*(.+)$/m) || [])[1] || 'SPY').split(/[\s,]+/).filter(Boolean).slice(0, 10).map(s => s.toUpperCase());
    const prices = await H.api(`/code/prices?symbols=${encodeURIComponent(syms.join(','))}&start=${H.$('#start', view).value}`);
    const py = await loadPython(m => (out.textContent = m)); out.textContent = 'Running...';
    await py.loadPackagesFromImports(code); // numpy, pandas, scipy... are downloaded the first time they are imported
    let printed = ''; py.setStdout({ batched: s => (printed += s + '\n') }); py.setStderr({ batched: s => (printed += s + '\n') });
    py.globals.set('__prices_json', JSON.stringify(prices));
    await py.runPythonAsync('import json\nprices = json.loads(__prices_json)\n' + code + `
__out = None
if 'portfolio' in globals():
    __out = portfolio(prices)
elif 'signals' in globals():
    __first = list(prices)[0]
    __out = {__first: signals(prices[__first]['close'])}
__result = json.dumps(__out)`);
    const weights = JSON.parse(py.globals.get('__result'));
    if (!weights) throw new Error('Define signals(close) or portfolio(prices).');
    const r = equityFrom(prices, weights), s = r.stats;
    out.innerHTML = `<div class="stats"><div class="stat"><span>Total return</span><b class="${H.cls(s.totalReturn)}">${pc(s.totalReturn)}</b></div><div class="stat"><span>Per year</span><b>${pc(s.cagr)}</b></div><div class="stat"><span>Max drawdown</span><b class="neg">-${s.maxDrawdown.toFixed(1)}%</b></div><div class="stat"><span>Sharpe</span><b>${s.sharpe?.toFixed(2) ?? '-'}</b></div><div class="stat"><span>Buy & hold ${H.esc(syms[0])}</span><b>${pc(s.buyHold)}</b></div></div>
      <canvas class="chart" id="pyCh" style="height:220px"></canvas><p class="mu small-print">${Object.values(prices).some(p => p.source === 'synthetic') ? 'Simulated prices (no market data source is set). ' : ''}Grey line: buy and hold ${H.esc(syms[0])}.</p>`;
    H.drawChart(H.$('#pyCh', view), r.curve, { base: 1, compare: r.bh });
    so.hidden = !printed; so.textContent = printed;
  }, err);
  H.act(H.$('#saveCode', view), async () => { const r = await H.api('/code/scripts', { body: { id: cur.id, name: H.$('#cname', view).value, code: src.value } }); cur = { ...cur, id: r.id }; H.$('#delCode', view).hidden = false; return 'Saved'; }, err);
  H.act(H.$('#qcSend', view), async () => { const r = await H.api('/qc/projects', { body: { name: H.$('#cname', view).value, code: src.value } }); return `Created QuantConnect project ${r.id}. Open the QuantConnect page to backtest it.`; }, err);
  H.$('#delCode', view).onclick = async () => { if (cur.id && confirm('Delete this script?')) { await H.api('/code/scripts/' + cur.id, { method: 'DELETE' }); H.render(); } };
}
