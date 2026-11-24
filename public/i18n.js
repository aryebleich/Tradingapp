// Language switching for the app. English is the source; other languages are dictionaries of
// exact phrases (plus a few patterns for sentences with numbers), applied to every text node and
// to placeholder/title/aria-label attributes, also on content that loads later (MutationObserver).
// Right-to-left languages flip the layout with dir="rtl".
export const LANGS = {
  en: { name: 'English', dir: 'ltr' },
  // English in plain words: the same screens with simpler labels. Only the get-started screens have
  // plain wording so far (the rest is the standard English), see DECISIONS.md A2.
  'en-plain': { name: 'English (plain words)', dir: 'ltr', plain: true },
  yi: { name: 'אידיש', dir: 'rtl', load: () => import('./i18n/yi.js') },
  // Simple translations (menus and main buttons): ./i18n/simple.js
  es: { name: 'Español', dir: 'ltr', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('es')) },
  fr: { name: 'Français', dir: 'ltr', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('fr')) },
  de: { name: 'Deutsch', dir: 'ltr', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('de')) },
  pt: { name: 'Português', dir: 'ltr', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('pt')) },
  ru: { name: 'Русский', dir: 'ltr', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('ru')) },
  he: { name: 'עברית', dir: 'rtl', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('he')) },
  ar: { name: 'العربية', dir: 'rtl', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('ar')) },
  zh: { name: '中文', dir: 'ltr', simple: true, load: () => import('./i18n/simple.js').then(m => m.forLang('zh')) },
};
const KEY = 'qp_lang';
export const current = () => { try { const l = localStorage.getItem(KEY); return LANGS[l] ? l : detect(); } catch { return detect(); } };
// Before a choice is saved: the browser's language, if the app has it (Yiddish is 'yi' or 'ji').
export function detect() {
  const codes = (navigator.languages?.length ? navigator.languages : [navigator.language || 'en']).map(c => String(c).toLowerCase().split('-')[0]);
  for (const c of codes) { const k = c === 'ji' ? 'yi' : c; if (LANGS[k] && k !== 'en-plain') return k; }
  return 'en';
}

let dict = null, patterns = [], obs = null;
const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEXTAREA', 'CANVAS', 'svg']);

let rtl = false;
function tr(s) {
  const t = s.trim();
  if (!t || !dict) return null;
  // Arrows show reading direction, so they flip in right-to-left languages.
  if (!/[A-Za-z]/.test(t)) return rtl && /[→⟶]/.test(t) ? s.replace(/→/g, '←').replace(/⟶/g, '⟵') : null;
  const key = t.replace(/\s+/g, ' '), hit = dict[key];
  if (hit) return s.replace(t, hit);
  // A function pattern written m => m[1] gets the match array; one written like a String.replace
  // callback, (m, a, b) => ..., gets the match and each group as its own argument (some Yiddish
  // patterns are written that way: with the array alone their groups were undefined and they threw).
  for (const [re, rep] of patterns) { const m = key.match(re); if (m) return s.replace(t, typeof rep === 'function' ? key.slice(0, m.index) + (rep.length > 1 ? rep(...m) : rep(m)) + key.slice(m.index + m[0].length) : key.replace(re, rep)); }
  return rtl && t.includes('→') ? s.replace(/→/g, '←') : null;
}
// Every change is remembered next to the original text, so switching language never needs a reload:
// the page goes back to the English it was written in, or to the chosen language, in place.
const txt = new WeakMap(); // text node -> { base: original, out: what we wrote }
const att = new WeakMap(); // element -> Map(attribute -> { base, out })
function setText(n) {
  const rec = txt.get(n), now = n.nodeValue;
  const base = rec && rec.out === now ? rec.base : now; // the page changed the text itself: that is the new original
  const out = tr(base) ?? base;
  if (out !== now) n.nodeValue = out;
  txt.set(n, { base, out });
}
function setAttr(el, a) {
  const now = el.getAttribute(a); if (now == null) return;
  let m = att.get(el); if (!m) att.set(el, (m = new Map()));
  const rec = m.get(a), base = rec && rec.out === now ? rec.base : now;
  const out = tr(base) ?? base;
  if (out !== now) el.setAttribute(a, out);
  m.set(a, { base, out });
}
function translate(root) {
  if (!root) return;
  if (root.nodeType === 3) { setText(root); return; }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => (n.nodeType === 1 && (SKIP.has(n.nodeName) || n.dataset?.noTr !== undefined) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const els = root.nodeType === 1 ? [root] : [];
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 3) setText(n);
    else els.push(n);
  }
  for (const el of els) for (const a of ATTRS) if (el.hasAttribute?.(a)) setAttr(el, a);
}


// Switches the page to a language, in place. English (and English in plain words) has no dictionary.
export async function applyLang(l) {
  const meta = LANGS[l] || LANGS.en;
  document.documentElement.lang = meta.plain ? 'en' : l;
  document.documentElement.dir = meta.dir;
  rtl = meta.dir === 'rtl';
  if (meta.load) { const m = await meta.load(); dict = m.strings; patterns = m.patterns || []; }
  else { dict = null; patterns = []; }
  translate(document.body);
}

export async function startI18n() {
  await applyLang(current());
  if (obs) return;
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
// A short note drawn on an empty chart, wrapped to the chart's width (phones are narrow).
export function canvasNote(g, text) {
  g.font = '14px ' + getComputedStyle(document.body).fontFamily;
  const w = g.canvas.width / (devicePixelRatio || 1), max = w - 24, lines = [];
  let cur = '';
  for (const word of t(text).split(' ')) { const next = cur ? cur + ' ' + word : word; if (cur && g.measureText(next).width > max) { lines.push(cur); cur = word; } else cur = next; }
  if (cur) lines.push(cur);
  if (rtl) { g.direction = 'rtl'; g.textAlign = 'right'; }
  lines.forEach((l, i) => g.fillText(l, rtl ? w - 12 : 12, 28 + i * 20));
}

// Saves the choice on this device and switches the page now (no reload). The account copy is saved by app.js.
export async function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch {}
  await applyLang(l);
  window.dispatchEvent(new Event('qp-lang'));
}

export const picker = () => `<select id="langSel" class="langsel" aria-label="Language" data-no-tr>${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === current() ? 'selected' : ''}>${v.name}</option>`).join('')}</select>`;
