// Playbooks: Brightolio's block-based strategies. List, the visual editor (blocks: asset, cash,
// group, if/else, top/bottom-N filter; drag and drop, nesting, undo and redo, keyboard moves),
// the AI builder, backtests against a benchmark, deploy, the trade preview, history, manual
// overrides, the community library, guided discovery, and Developer API keys.
// One JSON format with the server (src/rotation/playbook-core.js).
let H, META = null;
export function registerPlaybooks(routes, helpers) { H = helpers; routes.playbooks = list; routes.playbook = editor; routes.developers = developers; }
const meta = async () => (META ||= await H.api('/playbooks/meta'));
const pct = x => (Number.isFinite(+x) ? `${(+x).toFixed(1)}%` : '-');
const FN = { rsi: 'RSI', sma: 'Moving average', close: 'Price', ret: 'Return %', avgret: 'Avg daily return %', stdev: 'Volatility %', high: 'Highest close', pstdev: 'Price st. dev.' };
const TYPES = { asset: 'Asset', cash: 'Cash', group: 'Group', if: 'If / else', filter: 'Filter (top/bottom N)' };
const uid = () => 'b' + Math.random().toString(36).slice(2, 8);
const tabs = cur => `<div class="seg" role="tablist" style="margin-bottom:12px">${[['mine', 'My Playbooks', '#/playbooks'], ['library', 'Library', '#/playbooks?tab=library'], ['discover', 'Discover', '#/playbooks?tab=discover'], ['dev', 'Developer API', '#/developers']].map(([k, n, h]) => `<a role="tab" class="${cur === k ? 'on' : ''}" aria-selected="${cur === k}" href="${h}"><button type="button" class="${cur === k ? 'on' : ''}">${n}</button></a>`).join('')}</div>`;
const disclaimer = m => `<p class="mu small-print">${H.esc(m.disclaimer)}</p>`;

// ---------- list ----------
async function list(view, q) {
  const tab = q?.get('tab') || 'mine';
  if (tab === 'library') return library(view);
  if (tab === 'discover') return discover(view);
  const [m, rows] = await Promise.all([meta(), H.api('/playbooks')]);
  view.innerHTML = `<h1>Playbooks</h1>${tabs('mine')}
  <p class="mu" style="margin-top:-4px">A Playbook is a set of blocks: what to hold, how to weight it, and rules that change it. Build one, backtest it, then run it on the practice account first.</p>
  <form class="card" id="ai"><h2>Describe an idea</h2><p class="mu">The AI builder turns your words into a Playbook you can edit. It is checked and backtested before you can save it.</p>
    <textarea name="prompt" rows="3" style="width:100%" placeholder="e.g. Hold QQQ and XLV equally while SPY is above its 200-day average, otherwise BIL. Rebalance monthly."></textarea>
    <div class="row"><button>Build it</button><a href="#/playbook?new=1"><button type="button" class="ghost">Start from blank</button></a></div><div class="err"></div><div id="aiOut"></div></form>
  <div class="card tablewrap"><table><tr><th>Playbook</th><th>Status</th><th>Backtest (CAGR / max drop)</th><th>Last run</th><th></th></tr>
    ${rows.map(p => `<tr><td><a href="#/playbook?id=${p.id}">${H.esc(p.name)}</a>${p.aiGenerated ? ' <span class="pill">AI-generated</span>' : ''}<br><span class="mu small">v${p.version} · ${H.esc(m.rebalances[p.playbook.rebalance] || '')}</span></td>
      <td>${p.mode === 'manual' ? 'Not deployed' : `${p.paused ? 'Paused' : 'Running'} on ${H.esc(p.account)}`}</td>
      <td>${p.backtest ? `${pct(p.backtest.cagr)} / ${pct(p.backtest.dd)}` : '<span class="mu">not backtested</span>'}</td>
      <td>${H.esc(p.lastResult?.summary || '-')}</td><td><a href="#/playbook?id=${p.id}"><button type="button" class="small ghost">Open</button></a></td></tr>`).join('') || '<tr><td colspan="5" class="mu">No Playbooks yet. Describe an idea above, start from blank, or copy one from the Library.</td></tr>'}
  </table></div>${disclaimer(m)}`;
  const f = H.$('#ai', view);
  H.act(H.$('button', f), async () => {
    const r = await H.api('/playbooks/ai', { body: { prompt: f.prompt.value } });
    const out = H.$('#aiOut', view);
    out.innerHTML = `<div class="banner warn">${H.esc(r.label)}${r.by === 'rules' ? ' No AI provider is set up, so this draft was read from your words.' : ''}</div>
      <h3>${H.esc(r.name)}</h3><p>${H.esc(r.summary)}</p>${outline(r.playbook)}
      ${r.valid ? `${btStats(r.backtest)}<div class="row"><button type="button" id="aiSave">Save as a Playbook</button><button type="button" class="ghost" id="aiEdit">Edit before saving</button></div>` : `<p class="err">It cannot be used yet:</p><ul>${r.problems.map(p => `<li>${H.esc(p)}</li>`).join('')}</ul>`}`;
    if (r.valid) {
      H.$('#aiSave', out).onclick = async () => { const s = await H.api('/playbooks', { body: { name: r.name, playbook: r.playbook, aiGenerated: true } }); location.hash = `#/playbook?id=${s.id}`; };
      H.$('#aiEdit', out).onclick = () => { sessionStorage.setItem('pbDraft', JSON.stringify({ name: r.name, playbook: r.playbook, ai: true })); location.hash = '#/playbook?new=1&draft=1'; };
    }
    return '';
  });
}

// A read-only outline of a Playbook (AI results, library entries).
function outline(pb) {
  const cl = c => (c.of ? `${c.need} of: ${c.of.map(cl).join('; ')}` : `${side(c.a)} ${c.op} ${side(c.b)}`);
  const side = x => (Array.isArray(x) ? `${FN[x[0]] || x[0]}${x[0] === 'close' ? '' : `(${x[2]})`} of ${x[1]}` : x);
  const node = b => {
    const w = b.weight != null ? ` <span class="mu">${b.weight}%</span>` : '';
    if (b.type === 'asset') return `<li><b data-no-tr>${H.esc(b.ticker)}</b>${w}</li>`;
    if (b.type === 'cash') return `<li>Cash${w}</li>`;
    if (b.type === 'if') return `<li>If ${H.esc(cl(b.cond))}${w}<ul><li>then<ul>${node(b.then)}</ul></li><li>else<ul>${node(b.else)}</ul></li></ul></li>`;
    if (b.type === 'filter') return `<li>${b.select === 'top' ? 'Top' : 'Bottom'} ${b.count} by ${FN[b.metric[0]]}(${b.metric[1]}), ${b.weighting}${w}<ul>${b.children.map(node).join('')}</ul></li>`;
    return `<li>${H.esc(b.name || 'Group')} (${b.weighting})${w}<ul>${b.children.map(node).join('')}</ul></li>`;
  };
  return `<ul class="pb-outline">${node(pb.root)}</ul>`;
}
const btStats = r => (r ? `<div class="stats">${[['Return', pct(r.stats.ret)], ['CAGR', pct(r.stats.cagr)], ['Max drawdown', pct(r.stats.dd)], ['Volatility', pct(r.stats.vol)], ['Sharpe', (+r.stats.sharpe).toFixed(2)], [`${H.esc(r.benchmark)} CAGR`, pct(r.benchmarkStats.cagr)]].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('')}</div><p class="mu small">${H.esc(r.from)} to ${H.esc(r.to)} · costs ${r.costBps} bp + slippage ${r.slippageBps} bp per trade · walk-forward: ${r.walkForward.parts.map(pct).join(', ')} (${r.walkForward.consistent ? 'consistent' : 'uneven across periods'}). ${H.esc(r.disclaimer)}</p>` : '');

// ---------- editor ----------
const blank = () => ({ kind: 'playbook', version: 1, rebalance: 'monthly', benchmark: 'SPY', root: { id: uid(), type: 'group', name: 'Portfolio', weighting: 'equal', children: [{ id: uid(), type: 'asset', ticker: 'SPY' }, { id: uid(), type: 'asset', ticker: 'AGG' }] } });
const ensureIds = b => { if (!b) return b; b.id ||= uid(); (b.children || []).forEach(ensureIds); if (b.type === 'if') { ensureIds(b.then); ensureIds(b.else); } return b; };
const newBlock = t => ({ asset: { type: 'asset', ticker: '' }, cash: { type: 'cash' }, group: { type: 'group', name: 'Group', weighting: 'equal', children: [] }, if: { type: 'if', cond: { a: ['close', 'SPY', 0], op: '>', b: ['sma', 'SPY', 200] }, then: { type: 'cash' }, else: { type: 'cash' } }, filter: { type: 'filter', metric: ['ret', 63], select: 'top', count: 1, weighting: 'equal', children: [] } }[t]);

async function editor(view, q) {
  const m = await meta();
  const id = q?.get('id');
  let saved = id ? await H.api('/playbooks/' + id) : null;
  let name = saved?.name || 'My Playbook', aiDraft = false;
  let pb = saved ? JSON.parse(JSON.stringify(saved.playbook)) : blank();
  if (!saved && q?.get('draft')) { try { const d = JSON.parse(sessionStorage.getItem('pbDraft') || 'null'); if (d) { pb = d.playbook; name = d.name; aiDraft = !!d.ai; } } catch { /* blank */ } }
  ensureIds(pb.root);
  const undo = [], redo = [];
  const snap = () => { undo.push(JSON.stringify(pb)); if (undo.length > 100) undo.shift(); redo.length = 0; };
  const find = (b, bid, parent = null, slot = null) => {
    if (!b) return null;
    if (b.id === bid) return { b, parent, slot };
    for (const [i, c] of (b.children || []).entries()) { const r = find(c, bid, b, i); if (r) return r; }
    if (b.type === 'if') return find(b.then, bid, b, 'then') || find(b.else, bid, b, 'else');
    return null;
  };
  const contains = (b, bid) => !!find(b, bid);
  const detach = bid => { const f = find(pb.root, bid); if (!f || !f.parent) return null; if (typeof f.slot === 'number') f.parent.children.splice(f.slot, 1); else f.parent[f.slot] = { id: uid(), type: 'cash' }; return f.b; };
  const place = (blk, targetId, where) => { // where: 'into' (group/filter children end) | 'then' | 'else' | 'before'
    const t = find(pb.root, targetId); if (!t) return false;
    if (where === 'into' && t.b.children) t.b.children.push(blk);
    else if ((where === 'then' || where === 'else') && t.b.type === 'if') t.b[where] = blk;
    else if (where === 'before' && t.parent && typeof t.slot === 'number') t.parent.children.splice(t.slot, 0, blk);
    else return false;
    return true;
  };

  view.innerHTML = `<h1>${saved ? 'Playbook' : 'New Playbook'}</h1>${tabs('mine')}
  <div class="card"><div class="row"><label>Name<input id="pbName" value="${H.esc(name)}" maxlength="60"></label>
    <label>Rebalance<select id="pbReb">${Object.entries(m.rebalances).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label id="pbWdL">Weekday<select id="pbWd">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select></label>
    <label>Benchmark<input id="pbBench" value="${H.esc(pb.benchmark || 'SPY')}" maxlength="10" style="width:7em"></label></div>
    ${saved?.aiGenerated || aiDraft ? `<div class="banner warn">${H.esc(m.aiLabel)}</div>` : ''}
    <div class="row pb-tools" role="toolbar" aria-label="Editor"><button type="button" class="small ghost" id="pbUndo" title="Undo (Ctrl+Z)">Undo</button><button type="button" class="small ghost" id="pbRedo" title="Redo (Ctrl+Y)">Redo</button>
      <span class="mu small">Drag blocks to move them, or use the arrows. Alt+↑/↓ moves the focused block.</span></div>
    <div id="pbTree" class="pb-tree"></div>
    <div id="pbProblems" aria-live="polite"></div>
    <div class="row"><button id="pbSave">${saved ? 'Save as a new version' : 'Save'}</button>${saved ? '<input id="pbNote" placeholder="What changed (optional)" maxlength="120">' : ''}</div><div class="err"></div></div>
  <div id="pbMore"></div>${disclaimer(m)}`;
  H.$('#pbReb', view).value = pb.rebalance; H.$('#pbWd', view).value = pb.weekday || 3;
  const syncWd = () => { H.$('#pbWdL', view).hidden = H.$('#pbReb', view).value !== 'weekly'; };
  syncWd();
  H.$('#pbReb', view).onchange = () => { snap(); pb.rebalance = H.$('#pbReb', view).value; if (pb.rebalance === 'weekly') pb.weekday ||= 3; syncWd(); check(); };
  H.$('#pbWd', view).onchange = () => { snap(); pb.weekday = +H.$('#pbWd', view).value; };
  H.$('#pbBench', view).onchange = () => { snap(); pb.benchmark = H.$('#pbBench', view).value.trim().toUpperCase(); check(); };

  const tree = H.$('#pbTree', view);
  const metricHtml = (mv, key) => {
    const isNum = !Array.isArray(mv);
    return `<span class="pb-metric" data-key="${key}"><select data-f="${key}.kind" aria-label="Value type"><option value="ind" ${isNum ? '' : 'selected'}>Indicator</option><option value="num" ${isNum ? 'selected' : ''}>Number</option></select>
      ${isNum ? `<input data-f="${key}.num" type="number" step="any" value="${H.esc(mv)}" aria-label="Number" style="width:6em">` : `<select data-f="${key}.fn" aria-label="Indicator">${Object.entries(FN).map(([k, v]) => `<option value="${k}" ${mv[0] === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${mv[0] === 'close' ? '' : `<input data-f="${key}.len" type="number" min="1" max="400" value="${H.esc(mv[2])}" aria-label="Days" style="width:4.5em">d`} of <input data-f="${key}.t" value="${H.esc(mv[1])}" aria-label="Ticker" style="width:5.5em">`}</span>`;
  };
  const row = (b, parentType, parentWeighting, depth) => {
    const w = parentWeighting === 'specified' ? `<label class="pb-w">Weight %<input data-f="weight" type="number" step="any" min="0" max="100" value="${H.esc(b.weight ?? '')}" style="width:5em"></label>` : '';
    const head = `<div class="pb-head"><span class="pb-grip" aria-hidden="true">⋮⋮</span><b>${TYPES[b.type]}</b>${w}
      <span class="pb-btns"><button type="button" class="small ghost" data-act="up" aria-label="Move up">↑</button><button type="button" class="small ghost" data-act="down" aria-label="Move down">↓</button>${depth ? '<button type="button" class="small ghost" data-act="del" aria-label="Delete block">✕</button>' : ''}</span></div>`;
    let body = '';
    if (b.type === 'asset') body = `<label>Ticker<input data-f="ticker" value="${H.esc(b.ticker)}" style="width:6em" placeholder="SPY"></label>`;
    if (b.type === 'group' || b.type === 'filter') {
      body = `${b.type === 'group' ? `<label>Name<input data-f="name" value="${H.esc(b.name || '')}" maxlength="60"></label>` : `<label>Keep<select data-f="select"><option value="top" ${b.select === 'top' ? 'selected' : ''}>Top</option><option value="bottom" ${b.select === 'bottom' ? 'selected' : ''}>Bottom</option></select></label><input data-f="count" type="number" min="1" value="${b.count}" aria-label="How many" style="width:4em"> <label>by<select data-f="mfn">${Object.entries(FN).filter(([k]) => k !== 'close').map(([k, v]) => `<option value="${k}" ${b.metric[0] === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><input data-f="mlen" type="number" min="1" max="400" value="${b.metric[1]}" aria-label="Days" style="width:4.5em">d`}
        <label>Weighting<select data-f="weighting">${Object.entries(m.weightings).filter(([k]) => b.type === 'group' || k !== 'specified').map(([k, v]) => `<option value="${k}" ${b.weighting === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div class="pb-kids" data-drop="into">${b.children.map(c => row(c, b.type, b.weighting, depth + 1)).join('')}</div>
        <div class="row pb-add"><label class="mu small">Add<select data-add="into" aria-label="Add a block">${(b.type === 'filter' ? ['asset'] : Object.keys(TYPES)).map(t => `<option value="${t}">${TYPES[t]}</option>`).join('')}</select></label><button type="button" class="small" data-act="add">Add</button></div>`;
    }
    if (b.type === 'if') {
      const c = b.cond;
      body = c.of ? `<p class="mu">A vote: ${c.need} of ${c.of.length} conditions (edit in the JSON below).</p>`
        : `<div class="pb-cond">If ${metricHtml(c.a, 'a')} <select data-f="op" aria-label="Comparison">${['>', '<', '>=', '<='].map(o => `<option ${c.op === o ? 'selected' : ''}>${o}</option>`).join('')}</select> ${metricHtml(c.b, 'b')}</div>`;
      body += `<div class="pb-branch"><span class="mu">then</span><div class="pb-kids" data-drop="then">${row(b.then, 'if', null, depth + 1)}</div></div><div class="pb-branch"><span class="mu">else</span><div class="pb-kids" data-drop="else">${row(b.else, 'if', null, depth + 1)}</div></div>`;
    }
    return `<div class="pb-block pb-${b.type}" data-id="${b.id}" draggable="${depth ? 'true' : 'false'}" tabindex="0" role="group" aria-label="${TYPES[b.type]}${b.ticker ? ' ' + H.esc(b.ticker) : ''}">${head}<div class="pb-body">${body}</div></div>`;
  };
  const draw = () => { tree.innerHTML = row(pb.root, null, null, 0); H.$('#pbUndo', view).disabled = !undo.length; H.$('#pbRedo', view).disabled = !redo.length; };
  const blockOf = el => find(pb.root, el.closest('.pb-block').dataset.id).b;
  const setPath = (b, f, v) => {
    if (['weight', 'count'].includes(f)) b[f] = v === '' ? undefined : +v;
    else if (f === 'ticker') b.ticker = v.trim().toUpperCase();
    else if (f === 'mfn') b.metric[0] = v; else if (f === 'mlen') b.metric[1] = +v;
    else if (f === 'op') b.cond.op = v;
    else if (/^[ab]\./.test(f)) {
      const [k, part] = f.split('.'), cur = b.cond[k];
      if (part === 'kind') b.cond[k] = v === 'num' ? 0 : ['sma', 'SPY', 200];
      else if (part === 'num') b.cond[k] = +v;
      else if (part === 'fn') b.cond[k] = [v, cur[1], v === 'close' ? 0 : cur[2] || 20];
      else if (part === 'len') b.cond[k] = [cur[0], cur[1], +v];
      else if (part === 't') b.cond[k] = [cur[0], v.trim().toUpperCase(), cur[2]];
      return true; // structure may change: redraw
    } else b[f] = v;
    return f === 'weighting';
  };
  tree.addEventListener('change', e => {
    const f = e.target.dataset.f; if (!f) return;
    snap(); const redraw = setPath(blockOf(e.target), f, e.target.value);
    if (redraw) draw(); check();
  });
  tree.addEventListener('click', e => {
    const act = e.target.dataset.act; if (!act) return;
    const el = e.target.closest('.pb-block'), bid = el.dataset.id;
    snap();
    if (act === 'add') { const t = el.querySelector(':scope > .pb-body > .pb-add select').value; find(pb.root, bid).b.children.push({ id: uid(), ...newBlock(t) }); }
    if (act === 'del') detach(bid);
    if (act === 'up' || act === 'down') move(bid, act === 'up' ? -1 : 1);
    draw(); check();
    const again = tree.querySelector(`[data-id="${bid}"]`); if (again && act !== 'del') again.focus();
  });
  const move = (bid, dir) => { const f = find(pb.root, bid); if (!f?.parent || typeof f.slot !== 'number') return; const k = f.parent.children, j = f.slot + dir; if (j < 0 || j >= k.length) return; [k[f.slot], k[j]] = [k[j], k[f.slot]]; };
  tree.addEventListener('keydown', e => {
    const el = e.target.closest?.('.pb-block'); if (!el || e.target !== el) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); snap(); move(el.dataset.id, e.key === 'ArrowUp' ? -1 : 1); draw(); tree.querySelector(`[data-id="${el.dataset.id}"]`)?.focus(); }
    if (e.key === 'Delete' && el.getAttribute('draggable') === 'true') { e.preventDefault(); snap(); detach(el.dataset.id); draw(); check(); }
  });
  // Drag and drop: onto a group or filter (inside), an if's then/else slot (replaces it), or a block (before it).
  let dragId = null;
  tree.addEventListener('dragstart', e => { const el = e.target.closest('.pb-block'); if (!el) return; dragId = el.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  tree.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); tree.querySelectorAll('.pb-over').forEach(x => x.classList.remove('pb-over')); (e.target.closest('.pb-kids') || e.target.closest('.pb-block'))?.classList.add('pb-over'); } });
  tree.addEventListener('drop', e => {
    e.preventDefault(); tree.querySelectorAll('.pb-over').forEach(x => x.classList.remove('pb-over'));
    const id0 = dragId; dragId = null; if (!id0) return;
    const zone = e.target.closest('.pb-kids'), onBlock = e.target.closest('.pb-block');
    const target = zone ? zone.closest('.pb-block').dataset.id : onBlock?.dataset.id;
    const moving = find(pb.root, id0)?.b; if (!moving || !target || contains(moving, target)) return;
    snap();
    const blk = detach(id0);
    const where = zone && !zone.querySelector(`:scope > .pb-block[data-id="${onBlock?.dataset.id}"]`) ? zone.dataset.drop : zone && onBlock && onBlock.dataset.id !== target ? 'before' : zone ? zone.dataset.drop : 'before';
    if (!place(blk, where === 'before' ? onBlock.dataset.id : target, where)) { pb = JSON.parse(undo.pop()); }
    draw(); check();
  });
  const doUndo = () => { if (!undo.length) return; redo.push(JSON.stringify(pb)); pb = JSON.parse(undo.pop()); draw(); check(); };
  const doRedo = () => { if (!redo.length) return; undo.push(JSON.stringify(pb)); pb = JSON.parse(redo.pop()); draw(); check(); };
  H.$('#pbUndo', view).onclick = doUndo; H.$('#pbRedo', view).onclick = doRedo;
  view.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input,textarea')) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !e.target.matches('input,textarea')) { e.preventDefault(); doRedo(); } });
  let ct;
  const check = () => { clearTimeout(ct); ct = setTimeout(async () => { const r = await H.api('/playbooks/check', { body: { playbook: pb } }).catch(() => null); const el = H.$('#pbProblems', view); if (!r) return; el.innerHTML = r.ok ? '<p class="ok">Every rule can run.</p>' : `<p class="err">Fix these before it can run:</p><ul class="err">${r.problems.map(p => `<li>${H.esc(p)}</li>`).join('')}</ul>`; }, 300); };
  draw(); check();
  H.act(H.$('#pbSave', view), async () => {
    const body = { name: H.$('#pbName', view).value, playbook: pb, ...(saved ? { note: H.$('#pbNote', view)?.value || 'Edited' } : { aiGenerated: aiDraft }) };
    const r = saved ? await H.api('/playbooks/' + saved.id, { method: 'PUT', body }) : await H.api('/playbooks', { body });
    sessionStorage.removeItem('pbDraft');
    if (!saved) { location.hash = `#/playbook?id=${r.id}`; return ''; }
    saved = { ...saved, ...r }; panels(); return `Saved as version ${r.version}.`;
  });
  const panels = () => (saved ? more(H.$('#pbMore', view), saved.id, m) : null);
  panels();
}

// Backtest, deploy, preview, overrides, history, versions and publishing for a saved Playbook.
async function more(el, id, m) {
  const p = await H.api('/playbooks/' + id);
  const accts = await H.accounts().catch(() => []);
  const running = p.mode !== 'manual';
  el.innerHTML = `<div class="card" id="pbBt"><h2>Backtest</h2><div class="row"><label>Years<input name="years" type="number" min="1" max="20" value="5" style="width:5em"></label><label>Costs (bp)<input name="costBps" type="number" min="0" max="100" value="5" style="width:5em"></label><label>Slippage (bp)<input name="slippageBps" type="number" min="0" max="100" value="5" style="width:5em"></label><label>Benchmark<input name="benchmark" value="${H.esc(p.playbook.benchmark || 'SPY')}" style="width:6em"></label><button>Run backtest</button></div><div class="err"></div><div id="btOut">${p.backtest ? `<p class="mu">Version ${p.backtest.version}: CAGR ${pct(p.backtest.cagr)}, max drawdown ${pct(p.backtest.dd)}, Sharpe ${(+p.backtest.sharpe).toFixed(2)}.</p>` : '<p class="mu">Not backtested yet. A Playbook is backtested before it can be deployed or published.</p>'}</div></div>
  <div class="card" id="pbRun"><h2>Run it</h2>
    ${running ? `<p><b>${p.paused ? 'Paused' : 'Running'}</b> on ${H.esc(p.account)} (${p.mode === 'approve' ? 'you approve each rebalance' : 'trades by itself'}), about 20 minutes before each rebalance day's close.${p.skipNext ? ' The next rebalance will be skipped.' : ''}</p>
      <div class="row">${p.paused ? '<button type="button" data-o="resume">Resume</button>' : '<button type="button" class="ghost" data-o="pause">Pause</button>'}<button type="button" class="ghost" data-o="skip">${p.skipNext ? 'Run the next rebalance' : 'Skip the next rebalance'}</button><button type="button" class="ghost" data-o="stop">Stop running</button><button type="button" class="ghost danger" data-o="close">Close all positions</button></div>`
    : `<div class="row"><label>Account<select name="account">${H.accountOptions ? H.accountOptions(accts, 'paper') : '<option value="paper">Practice account</option>'}</select></label><label>Allocation %<input name="allocation" type="number" min="1" max="100" value="${H.esc(p.allocation || 100)}" style="width:5em"></label><label>Mode<select name="mode"><option value="auto">Trades by itself</option><option value="approve">I approve each rebalance</option></select></label><button type="button" id="pbDeploy">Deploy</button></div>
      <p class="mu small">Start on the practice account. A real-money account asks you to confirm it is you, like a live order.</p>`}
    <div class="row"><label>Swap an asset<input id="swFrom" placeholder="From" style="width:6em"></label><input id="swTo" placeholder="To" style="width:6em" aria-label="To"><button type="button" class="ghost small" id="swGo">Swap</button><button type="button" class="ghost small" id="pbNow">Rebalance now</button></div><div class="err"></div></div>
  <div class="card" id="pbPrev"><h2>Next rebalance preview</h2><button type="button" class="ghost small" id="pvGo">Show the expected trades</button><div id="pvOut"></div></div>
  <div class="card"><h2>History</h2><div id="hist"></div></div>
  <div class="card"><h2>Versions</h2><table class="slim">${[...p.versions].reverse().map(v => `<tr><td>v${v.v}</td><td>${H.date ? H.date(v.at) : new Date(v.at).toLocaleString()}</td><td>${H.esc(v.note)}</td><td>${v.v === p.version ? '<span class="pill">current</span>' : `<button type="button" class="small ghost" data-v="${v.v}">Restore</button>`}</td></tr>`).join('')}</table></div>
  <div class="card"><h2>Share</h2><label class="chk"><input type="checkbox" id="pbPub" ${p.public ? 'checked' : ''}> Publish in the Library (rules and tickers only, never your account or money)</label><label>Description<textarea id="pbNotes" rows="2" style="width:100%" maxlength="1000">${H.esc(p.notes || '')}</textarea></label><button type="button" class="ghost" id="pbPubGo">Save</button><div class="err"></div>
    <p class="mu"><button type="button" class="ghost small danger" id="pbDel">Delete this Playbook</button></p></div>`;
  const bt = H.$('#pbBt', el);
  H.act(H.$('button', bt), async () => {
    const r = await H.api(`/playbooks/${id}/backtest`, { body: H.form(bt) });
    H.$('#btOut', el).innerHTML = `${btStats(r)}<canvas id="pbChart" style="width:100%;height:240px"></canvas><p class="mu small">Line: this Playbook; compared with ${H.esc(r.benchmark)}.</p>`;
    H.drawChart(H.$('#pbChart', el), r.curve, { compare: r.bhCurve, dates: r.dates });
    return '';
  });
  const o = async (path, body = {}) => { await H.api(`/playbooks/${id}/${path}`, { body }); return more(el, id, m); };
  H.$$('[data-o]', el).forEach(b => H.act(b, async () => {
    const a = b.dataset.o;
    if (a === 'close' && !confirm('Sell every position this Playbook holds now, and stop it?')) return '';
    await o(a, a === 'skip' ? { skip: !p.skipNext } : {}); return '';
  }));
  if (H.$('#pbDeploy', el)) H.act(H.$('#pbDeploy', el), async () => { const run = H.$('#pbRun', el); await o('deploy', { account: run.querySelector('[name=account]').value, allocation: +run.querySelector('[name=allocation]').value, mode: run.querySelector('[name=mode]').value }); return ''; });
  H.act(H.$('#swGo', el), async () => { await o('swap', { from: H.$('#swFrom', el).value, to: H.$('#swTo', el).value }); location.reload(); return ''; });
  H.act(H.$('#pbNow', el), async () => { const r = await H.api(`/playbooks/${id}/execute`, { body: {} }); await more(el, id, m); return r.summary; });
  H.act(H.$('#pvGo', el), async () => {
    const r = await H.api(`/playbooks/${id}/preview`);
    H.$('#pvOut', el).innerHTML = `<p class="warn">${H.esc(r.estimate)}</p><p class="mu">${r.rebalanceDue ? 'Today is a rebalance day' : 'Not a rebalance day today'}${r.runsAtNy ? `; it runs at about ${r.runsAtNy} New York time` : ''}.</p>
      <div class="tablewrap"><table><tr><th>Ticker</th><th>Price</th><th>Now</th><th>Target</th><th>Shares now → target</th><th>Change</th><th>About</th></tr>${r.trades.map(t => `<tr><td data-no-tr>${H.esc(t.ticker)}</td><td>${H.money(t.price)}</td><td>${pct(t.currentPct)}</td><td>${pct(t.targetPct)}</td><td>${t.currentShares} → ${t.targetShares}</td><td>${t.action} ${Math.abs(t.change)}</td><td>${H.money(Math.abs(t.dollars))}</td></tr>`).join('')}</table></div>
      ${r.trace.length ? `<p class="mu small">Why: ${r.trace.map(x => H.esc(`${x.rule} → ${x.result}`)).join(' · ')}</p>` : ''}`;
    return '';
  });
  H.$$('[data-v]', el).forEach(b => H.act(b, async () => { await H.api(`/playbooks/${id}/restore`, { body: { version: +b.dataset.v } }); location.reload(); return ''; }));
  H.act(H.$('#pbPubGo', el), async () => { await H.api('/playbooks/' + id, { method: 'PUT', body: { public: H.$('#pbPub', el).checked, notes: H.$('#pbNotes', el).value } }); return 'Saved'; });
  H.act(H.$('#pbDel', el), async () => { if (!confirm('Delete this Playbook and its history?')) return ''; await H.api('/playbooks/' + id, { method: 'DELETE' }); location.hash = '#/playbooks'; return ''; });
  const h = await H.api(`/playbooks/${id}/history`);
  H.$('#hist', el).innerHTML = h.length ? `<ul class="runs">${h.map(x => `<li><span class="mu">${new Date(x.at).toLocaleString([], { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</span> <b>${H.esc(x.kind)}</b> · ${H.esc(x.summary)}${x.triggers?.length ? `<br><span class="mu small">Because: ${x.triggers.map(t => H.esc(`${t.rule} → ${t.result}`)).join(' · ')}</span>` : ''}</li>`).join('')}</ul>` : '<p class="mu">Nothing yet.</p>';
}

// ---------- library ----------
async function library(view) {
  const m = await meta();
  const draw = async sort => {
    const items = await H.api('/playbooks/library?sort=' + sort);
    view.innerHTML = `<h1>Playbook library</h1>${tabs('library')}
    <p class="mu" style="margin-top:-4px">Brightolio's own designs and Playbooks members chose to share. Copies are yours and independent. ${H.esc(m.disclaimer)}</p>
    <label>Sort<select id="lbSort">${[['newest', 'Newest'], ['cagr', 'Highest backtest CAGR'], ['drawdown', 'Smallest drawdown'], ['sharpe', 'Best Sharpe'], ['name', 'Name']].map(([k, v]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="grid">${items.map(x => `<div class="card" data-lib="${H.esc(x.id)}"><h3>${H.esc(x.name)}</h3><p class="mu small">by ${H.esc(x.by)}${x.leveraged ? ' · <b>uses leveraged funds</b>' : ''} · ${H.esc(m.rebalances[x.rebalance] || '')}</p><p>${H.esc(x.about || '')}</p>
      <p class="small"><span data-no-tr>${x.tickers.map(H.esc).join(', ')}</span></p>
      ${x.bt ? `<p>Backtest: CAGR ${pct(x.bt.cagr)}, max drawdown ${pct(x.bt.dd)}, Sharpe ${(+x.bt.sharpe).toFixed(2)}</p>` : '<p class="mu">No backtest yet</p>'}
      <p class="mu small">Past results do not predict future returns.</p>
      <div class="row"><button type="button" class="small" data-copy>Copy to my Playbooks</button><button type="button" class="small ghost" data-bt>Backtest</button>${x.official || x.mine ? '' : '<button type="button" class="small ghost" data-rep>Report</button>'}</div><div class="err"></div><div class="lbOut"></div></div>`).join('')}</div>`;
    H.$('#lbSort', view).onchange = e => draw(e.target.value);
    H.$$('[data-lib]', view).forEach(card => {
      const id = card.dataset.lib;
      H.act(H.$('[data-copy]', card), async () => { const r = await H.api(`/playbooks/library/${encodeURIComponent(id)}/copy`, { body: {} }); location.hash = `#/playbook?id=${r.id}`; return ''; });
      H.act(H.$('[data-bt]', card), async () => { const r = await H.api(`/playbooks/library/${encodeURIComponent(id)}/backtest`, { body: { years: 5 } }); H.$('.lbOut', card).innerHTML = btStats(r); return ''; });
      const rep = H.$('[data-rep]', card);
      if (rep) H.act(rep, async () => { const why = prompt('What is wrong with this Playbook?'); if (!why) return ''; await H.api(`/playbooks/library/${encodeURIComponent(id)}/report`, { body: { reason: why } }); return 'Thank you: a moderator will look at it.'; });
    });
  };
  await draw('newest');
}

// ---------- guided discovery ----------
async function discover(view) {
  const m = await meta(), Q = m.questions;
  view.innerHTML = `<h1>Find a Playbook to learn from</h1>${tabs('discover')}
  <form class="card" id="dq">${[['goal', 'What is your goal?'], ['risk', 'How much of a drop can you live with?'], ['horizon', 'How long will the money stay invested?']].map(([k, t]) => `<fieldset><legend>${t}</legend>${Object.entries(Q[k]).map(([v, n], i) => `<label class="chk"><input type="radio" name="${k}" value="${v}" ${i === 0 ? 'checked' : ''}> ${H.esc(n)}</label>`).join('')}</fieldset>`).join('')}
    <button>Show matching examples</button><div class="err"></div></form><div id="dOut"></div>
  <p class="mu small-print">${H.esc(m.education)}</p>`;
  const f = H.$('#dq', view);
  H.act(H.$('button', f), async () => {
    const r = await H.api('/playbooks/discover', { body: H.form(f) });
    H.$('#dOut', view).innerHTML = `<div class="banner">${H.esc(r.education)}</div>${r.matches.length ? r.matches.map(x => `<div class="card"><h3>${H.esc(x.name)}</h3><p class="mu small">by ${H.esc(x.by)} · <span data-no-tr>${x.tickers.map(H.esc).join(', ')}</span></p><ul>${x.why.map(w => `<li>${H.esc(w)}</li>`).join('')}</ul><p class="mu small">Backtest: CAGR ${pct(x.bt.cagr)}, max drawdown ${pct(x.bt.dd)}. Past results do not predict future returns.</p><a href="#/playbooks?tab=library">See it in the Library</a></div>`).join('') : '<p class="mu">No example in the library fits these answers yet.</p>'}`;
    return '';
  });
}

// ---------- Developer API (also linked from Settings) ----------
export async function keysCard(el) {
  const d = await H.api('/apikeys');
  el.innerHTML = `<h2>Developer API keys</h2><p class="mu">Use Brightolio from your own code: <a href="#/developers">API docs</a> · <a href="/openapi.json" target="_blank" rel="noopener">OpenAPI spec</a>. Keys are stored only as a hash and shown once. Real-money actions are refused over the API.</p>
    <table class="slim">${d.keys.map(k => `<tr class="${k.revokedAt ? 'mu' : ''}"><td>${H.esc(k.name)} <span class="mu">…${H.esc(k.hint)}</span></td><td>${k.scopes.map(H.esc).join(', ')}</td><td>${k.ratePerMin}/min</td><td>${k.revokedAt ? 'revoked' : `<button type="button" class="small ghost" data-rev="${k.id}">Revoke</button>`}</td></tr>`).join('') || '<tr><td class="mu">No keys yet.</td></tr>'}</table>
    <form class="row" id="kNew"><label>Name<input name="name" maxlength="40" placeholder="My script"></label>${Object.entries(d.scopes).map(([k, v]) => `<label class="chk" title="${H.esc(v)}"><input type="checkbox" name="sc" value="${k}" ${k === 'read' ? 'checked disabled' : ''}> ${k}</label>`).join('')}<label>Requests a minute<input name="ratePerMin" type="number" min="1" max="${d.maxRate}" value="60" style="width:5em"></label><button>Create key</button></form><div class="err"></div><div id="kOut"></div>`;
  const f = H.$('#kNew', el);
  H.act(H.$('button', f), async () => {
    const scopes = H.$$('[name=sc]:checked', f).map(x => x.value);
    const r = await H.api('/apikeys', { body: { name: f.name.value, scopes, ratePerMin: +f.ratePerMin.value } });
    await keysCard(el);
    H.$('#kOut', el).innerHTML = `<p class="banner">Your new key (copy it now, it is not shown again): <code id="kTok" data-no-tr>${H.esc(r.token)}</code></p>`;
    return '';
  });
  H.$$('[data-rev]', el).forEach(b => H.act(b, async () => { await H.api('/apikeys/' + b.dataset.rev, { method: 'DELETE' }); await keysCard(el); return ''; }));
}
async function developers(view) {
  const spec = await fetch('/openapi.json').then(r => r.json()).catch(() => null);
  view.innerHTML = `<h1>Developer API</h1>${tabs('dev')}<div class="card" id="keys"></div>
  <div class="card"><h2>How it works</h2><p>Base URL <code>/api/v1</code>. Send <code>Authorization: Bearer bk_…</code>. Scopes: <b>read</b> (always), <b>write</b> (create, edit, backtest), <b>trade</b> (deploy, pause, resume, rebalance, close). Each key has its own rate limit. Orders go through the same checks as the website; real-money actions are refused over the API. Backtests are hypothetical; trading involves risk of loss.</p>
    <pre data-no-tr>curl -H "Authorization: Bearer bk_…" ${location.origin}/api/v1/playbooks</pre>
    ${spec ? `<table class="slim"><tr><th>Method</th><th>Path</th><th>What</th><th>Scope</th></tr>${Object.entries(spec.paths).flatMap(([p, ops]) => Object.entries(ops).map(([mth, o]) => `<tr><td data-no-tr>${mth.toUpperCase()}</td><td data-no-tr><code>${H.esc(p)}</code></td><td>${H.esc(o.summary)}</td><td>${H.esc(o['x-scope'])}</td></tr>`)).join('')}</table>` : ''}
    <p><a href="/openapi.json" target="_blank" rel="noopener">Download the OpenAPI spec</a></p></div>`;
  await keysCard(H.$('#keys', view));
}
