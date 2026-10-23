// Language switching for the app. English is the source; other languages are dictionaries of
// exact phrases (plus a few patterns for sentences with numbers), applied to every text node and
// to placeholder/title/aria-label attributes, also on content that loads later (MutationObserver).
// Right-to-left languages flip the layout with dir="rtl".
export const LANGS = {
  en: { name: 'English', dir: 'ltr' },
  yi: { name: 'ייִדיש', dir: 'rtl', load: () => import('./i18n/yi.js') },
};
const KEY = 'qp_lang';
export const current = () => { try { const l = localStorage.getItem(KEY); return LANGS[l] ? l : 'en'; } catch { return 'en'; } };

let dict = null, patterns = [], obs = null;
const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEXTAREA', 'CANVAS', 'svg']);

let rtl = false;
function tr(s) {
  const t = s.trim();
  if (!t) return null;
  // Arrows show reading direction, so they flip in right-to-left languages.
  if (!/[A-Za-z]/.test(t)) return rtl && /[→⟶]/.test(t) ? s.replace(/→/g, '←').replace(/⟶/g, '⟵') : null;
  const key = t.replace(/\s+/g, ' '), hit = dict[key];
  if (hit) return s.replace(t, hit);
  for (const [re, rep] of patterns) if (re.test(key)) return s.replace(t, key.replace(re, rep));
  return rtl && t.includes('→') ? s.replace(/→/g, '←') : null;
}
function translate(root) {
  if (!dict || !root) return;
  if (root.nodeType === 3) { const v = tr(root.nodeValue); if (v != null && v !== root.nodeValue) root.nodeValue = v; return; }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => (n.nodeType === 1 && (SKIP.has(n.nodeName) || n.dataset?.noTr !== undefined) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const els = root.nodeType === 1 ? [root] : [];
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 3) { const v = tr(n.nodeValue); if (v != null && v !== n.nodeValue) n.nodeValue = v; }
    else els.push(n);
  }
  for (const el of els) for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v) { const t = tr(v); if (t != null && t !== v) el.setAttribute(a, t); } }
}

export async function startI18n() {
  const l = current(), meta = LANGS[l];
  document.documentElement.lang = l;
  document.documentElement.dir = meta.dir;
  if (!meta.load) return;
  const m = await meta.load();
  dict = m.strings; patterns = m.patterns || []; rtl = meta.dir === 'rtl';
  translate(document.body);
  obs = new MutationObserver(list => {
    for (const r of list) {
      if (r.type === 'characterData') translate(r.target);
      else if (r.type === 'attributes') translate(r.target);
      else r.addedNodes.forEach(translate);
    }
    obs.takeRecords(); // our own edits are not new content
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// A translated message from code (alerts, confirms).
export const t = s => (dict && tr(s)) || s;

// A one-line message drawn on a chart canvas, which the page translation cannot reach.
export function canvasNote(g, text) {
  g.font = '14px ' + getComputedStyle(document.body).fontFamily;
  if (rtl) { g.direction = 'rtl'; g.textAlign = 'right'; g.fillText(t(text), g.canvas.width / (devicePixelRatio || 1) - 12, 28); }
  else g.fillText(t(text), 12, 28);
}

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch {}
  location.reload();
}

export const picker = () => `<select id="langSel" class="langsel" aria-label="Language" data-no-tr>${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === current() ? 'selected' : ''}>${v.name}</option>`).join('')}</select>`;
