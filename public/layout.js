// Layout v2 (flag layout_v2), loaded only for visitors in the rollout. Presentation only: it wraps
// wide tables in a scroll box, turns "Loading…" lines into skeletons (the words stay for screen
// readers) and gives empty lists their next step. It never changes text, numbers, controls or what
// a button does, and never touches forms, dialogs or the order ticket.
const SKIP = 'form, dialog, #tk, .ticket, #tradeBar, [data-no-layout]';
const EMPTY = [
  [/^No positions\b/i, '#/trade', 'Go to Trade'],
  [/^No orders\b/i, '#/trade', 'Go to Trade'],
  [/^No runs\b/i, '#/backtest', 'Run a backtest'],
  [/^No signals\b/i, '#/signals', 'Open Signals'],
];

// Accessible names only (no visible text changes): the logo link, and fields inside table cells
// that are labelled by their column (the cell's data-label).
function names(root) {
  for (const a of root.querySelectorAll('a.brand:not([aria-label]), a.logo:not([aria-label])')) a.setAttribute('aria-label', 'Brightolio home');
  for (const f of root.querySelectorAll('td[data-label] > :is(input, select, textarea):not([aria-label]):not([id])')) f.setAttribute('aria-label', f.parentElement.dataset.label);
}

function tidy(root) {
  names(root);
  const all = sel => (root.matches?.(sel) ? [root] : []).concat([...root.querySelectorAll(sel)]);
  for (const t of all('table')) {
    if (t.closest('.tablewrap, ' + SKIP) || t.classList.contains('stack')) continue;
    const box = document.createElement('div');
    box.className = 'tablewrap'; box.tabIndex = 0; box.setAttribute('role', 'region');
    const name = t.caption?.textContent || t.closest('.card')?.querySelector('h2, h3')?.textContent || 'Table';
    box.setAttribute('aria-label', name.trim().slice(0, 80));
    t.replaceWith(box); box.append(t);
  }
  for (const el of all('.mu, .pf-t, .wbody')) {
    if (el.closest(SKIP) || el.children.length) continue;
    const s = el.textContent.trim();
    const loading = /^Loading\b.*(…|\.\.\.)$/.test(s);
    if (el.classList.contains('lv2-load') !== loading) { el.classList.toggle('lv2-load', loading); if (loading) el.setAttribute('role', 'status'); else el.removeAttribute('role'); }
    if (!loading && el.matches('.mu') && !el.classList.contains('lv2-empty')) {
      const hit = EMPTY.find(([re]) => re.test(s));
      if (hit && !location.hash.startsWith(hit[1])) {
        el.classList.add('lv2-empty');
        const a = document.createElement('a'); a.className = 'lv2-next'; a.href = hit[1]; a.textContent = hit[2];
        el.append(' ', a);
      }
    }
  }
}

// Only new elements are looked at (live price ticks change text, not elements, and are ignored),
// at most once per frame, and in idle time when the browser has some.
let pending = new Set(), queued = false;
const later = window.requestIdleCallback || (f => setTimeout(f, 50));
const run = () => { queued = false; const roots = [...pending]; pending = new Set(); for (const r of roots) if (r.isConnected) tidy(r); };
new MutationObserver(list => {
  for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n); else if (n.nodeType === 3 && n.parentElement) pending.add(n.parentElement);
  if (pending.size && !queued) { queued = true; later(run, { timeout: 200 }); }
}).observe(document.body, { childList: true, subtree: true });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => tidy(document.body)); else tidy(document.body);
