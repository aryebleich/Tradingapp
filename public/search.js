// Search everything (Ctrl+K, "/" or the 🔎 button): the app's pages, glossary terms, stocks, ETFs,
// mutual funds and futures, and the user's own strategies, bots, rules, notes and more. Admin pages,
// the homepage and the private README are not searched.
import { TERMS } from './glossary.js';
let H, pages = [];
// Words people type that should find a page even when its title differs.
const ALIASES = { dashboard: 'home portfolio balance equity', trade: 'buy sell order ticket market limit stop', orders: 'open orders cancel', positions: 'holdings shares sell all', chart: 'candles indicators technical bull bear market cap', scanner: 'screen growth value stocks', statarb: 'pairs basket cointegration arbitrage scan', invest: 'futures mutual funds savings t-bills treasury hysa', 'alpaca-tools': 'bonds treasury rates mortgage fed', tax: 'taxes 8949 schedule d harvesting', taxpilot: 'tax loss harvesting wash sale lots', money: 'net worth bank crypto wallet cash flow', luach: 'zmanim shabbos yom tov hebrew date tzedakah', settings: 'tax rates state phone language add-ons theme', funding: 'plans billing upgrade pro subscription credits', text: 'sms hotline phone', ai: 'assistant chat ask question', brief: 'weekly summary ai report', rules: 'rebalance 60/40 allocation', security: 'passkey 2fa password lock', learn: 'lessons education beginner' };
export function initSearch(helpers, nav) {
  H = helpers;
  pages = nav.flatMap(([g, items]) => items.map(([k, t]) => ({ k, t, g, words: `${t} ${g} ${ALIASES[k] || ''}`.toLowerCase() })));
  const top = document.getElementById('top'), btn = document.createElement('button');
  btn.id = 'searchBtn'; btn.className = 'ghost hdrbtn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Search'); btn.title = 'Search (Ctrl+K)';
  btn.innerHTML = '🔎<span class="long"> Search</span>';
  top.insertBefore(btn, document.getElementById('viewAs'));
  btn.onclick = open;
  addEventListener('keydown', e => {
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName))) { if (!H.me()) return; e.preventDefault(); open(); }
  });
}
function open() {
  document.querySelector('dialog.search')?.remove();
  const d = document.createElement('dialog'); d.className = 'search';
  d.innerHTML = `<form method="dialog"><input id="sq" type="search" placeholder="Search pages, stocks, funds, your strategies…" autocomplete="off" aria-label="Search"><div id="sres" role="listbox"></div><p class="mu small-print">Enter opens the first result · Esc closes</p></form>`;
  document.body.append(d); d.showModal();
  const inp = d.querySelector('#sq'), res = d.querySelector('#sres');
  let tmr = null, seq = 0, first = null;
  const go = url => { d.close(); d.remove(); location.hash = url; };
  const render = (q, server) => {
    const ql = q.toLowerCase(), words = ql.split(/\s+/).filter(Boolean);
    const pg = !q ? [] : pages.filter(p => words.every(w => p.words.includes(w))).slice(0, 8);
    const terms = q.length < 2 ? [] : Object.entries(TERMS).filter(([k]) => k.toLowerCase().includes(ql)).slice(0, 4);
    const sec = (title, rows) => (rows.length ? `<h4>${title}</h4>${rows.join('')}` : '');
    const row = (url, main, sub) => `<a href="${H.esc(url)}" class="sitem" role="option"><b>${main}</b>${sub ? `<span class="mu">${sub}</span>` : ''}</a>`;
    res.innerHTML = sec('Pages', pg.map(p => row('#/' + p.k, H.esc(p.t), H.esc(p.g))))
      + sec('Stocks, funds & futures', (server?.symbols || []).map(s => row(s.url, `<span data-no-tr>${H.esc(s.symbol)}</span>`, `${H.esc(s.name)} · ${H.esc(s.kind)}`)))
      + sec('Yours', (server?.mine || []).map(m => row(m.url, H.esc(m.title), H.esc(m.kind))))
      + sec('Glossary', terms.map(([k, v]) => `<div class="sitem term"><b>${H.esc(k)}</b><span class="mu">${H.esc(String(v).slice(0, 160))}</span></div>`))
      || (q ? `<p class="mu">${server ? 'Nothing found.' : 'Searching…'}</p>` : '<p class="mu">Try "sell all", "AAPL", "futures", "tax" or the name of one of your strategies.</p>');
    first = res.querySelector('a.sitem');
    res.querySelectorAll('a.sitem').forEach(a => (a.onclick = e => { e.preventDefault(); go(a.getAttribute('href')); }));
  };
  inp.oninput = () => {
    const q = inp.value.trim(); render(q, null); clearTimeout(tmr);
    if (!q) return;
    const my = ++seq; tmr = setTimeout(async () => { const r = await H.api('/search?q=' + encodeURIComponent(q)).catch(() => ({ symbols: [], mine: [] })); if (my === seq) render(q, r); }, 220);
  };
  d.querySelector('form').onsubmit = e => { e.preventDefault(); if (first) go(first.getAttribute('href')); };
  // Escape closes at once (in a search box it would first only clear the text).
  inp.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); d.close(); } };
  d.addEventListener('close', () => d.remove());
  render('', null); inp.focus();
}
