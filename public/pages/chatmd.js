// A small, safe Markdown renderer for the AI team Chat. Everything the model writes is escaped first;
// the only HTML produced is the fixed set of tags below. Raw HTML in model output is shown as text, never
// rendered. Links open in a new tab and only http(s) and mailto addresses become links.
// Supports: headings, paragraphs, bold, italic, inline code, links, bullet and numbered lists, block quotes,
// rules, tables, fenced code blocks with simple syntax highlighting. An unclosed code fence (while a reply is
// still streaming) is drawn as a code block already, so the layout does not jump when the fence closes.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function safeHref(u) {
  const s = String(u ?? '').trim();
  if (/[\u0000-\u001f\s]/.test(s)) return null;
  return /^(https?:\/\/[^\s/]+|mailto:[^\s@]+@[^\s@]+)/i.test(s) ? s : null;
}

const INLINE = /`([^`\n]+)`|\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])/g;
export function inline(text, depth = 0) {
  const src = String(text ?? '');
  if (depth > 3) return esc(src);
  let out = '', last = 0;
  for (const m of src.matchAll(INLINE)) {
    out += esc(src.slice(last, m.index)); last = m.index + m[0].length;
    if (m[1] !== undefined) out += `<code>${esc(m[1])}</code>`;
    else if (m[2] !== undefined) { const h = safeHref(m[3]); out += h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${inline(m[2], depth + 1)}</a>` : `${inline(m[2], depth + 1)} (${esc(m[3])})`; }
    else if (m[4] !== undefined || m[5] !== undefined) out += `<strong>${inline(m[4] ?? m[5], depth + 1)}</strong>`;
    else out += `<em>${inline(m[6] ?? m[7], depth + 1)}</em>`;
  }
  return out + esc(src.slice(last));
}

// ---------- syntax highlighting (tokens are escaped one by one) ----------
const KW = {
  js: 'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this null undefined true false',
  py: 'def return if elif else for while in not and or import from as class try except finally raise with lambda yield None True False pass break continue global async await',
  sh: 'if then else fi for do done while case esac function export echo cd local return in',
  sql: 'select from where and or not insert into values update set delete create table index primary key references join left right inner outer on group by order limit as null is in like distinct count sum',
};
const FAMILY = { js: 'js', javascript: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js', json: 'js', node: 'js', py: 'py', python: 'py', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', sql: 'sql', sqlite: 'sql' };
export function highlight(code, lang) {
  const fam = FAMILY[String(lang || '').toLowerCase()];
  if (!fam) return esc(code);
  const kw = new Set(KW[fam].split(' ')), hashComment = fam === 'py' || fam === 'sh', ci = fam === 'sql';
  const re = hashComment ? /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g
    : fam === 'sql' ? /(--[^\n]*)|('(?:[^'\n]|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)/g
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let out = '', last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index)); last = m.index + m[0].length;
    const cls = m[1] ? 'tk-c' : m[2] ? 'tk-s' : m[3] ? 'tk-n' : kw.has(ci ? m[4].toLowerCase() : m[4]) ? 'tk-k' : null;
    out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
  }
  return out + esc(code.slice(last));
}

const codeBlock = (code, lang, open) => `<div class="md-code${open ? ' md-open' : ''}"><div class="md-codebar"><span>${esc(lang || 'text')}</span><button type="button" class="md-copy" data-copy-code>Copy code</button></div><pre tabindex="0"><code>${highlight(code, lang)}</code></pre></div>`;
const isTableSep = l => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes('-') && (l.includes('|') || /-{3,}/.test(l));
const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function render(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(l);
    if (fence) {
      const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`), body = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
      const open = i >= lines.length; i++;
      out.push(codeBlock(body.join('\n'), fence[2], open));
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { const lvl = Math.min(6, h[1].length + 2); out.push(`<h${lvl} class="md-h">${inline(h[2])}</h${lvl}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table" tabindex="0"><table><thead><tr>${head.map(c => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/, ol = /^\s*(\d{1,9})[.)]\s+(.*)$/;
    if (ul.test(l) || ol.test(l)) {
      const ordered = !ul.test(l), re = ordered ? ol : ul, items = [], start = ordered ? +ol.exec(l)[1] : 1;
      while (i < lines.length && re.test(lines[i])) { const m = re.exec(lines[i++]); items.push(ordered ? m[2] : m[1]); }
      out.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ol>` : `<ul>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${render(q.join('\n'))}</blockquote>`); continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(`{3,}|~{3,})/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^\s*([-*+]|\d{1,9}[.)])\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    if (!para.length) { out.push(`<p>${inline(lines[i++])}</p>`); continue; }
    out.push(`<p>${para.map(p => inline(p)).join('<br>')}</p>`);
  }
  return out.join('\n');
}
