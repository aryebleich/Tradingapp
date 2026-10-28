// A small Markdown-to-PDF writer for documents such as the private README: headings, paragraphs,
// lists, tables (as rows), code blocks, and "Page N of M" at the bottom of every page. It uses the
// standard PDF fonts (Helvetica, Courier), so no font files are needed; characters outside Latin-1
// are replaced with close plain-text equivalents.
const W = 612, H = 792, M = 56, BODY = W - 2 * M, FOOT = 34;

const REPLACE = { '→': '->', '←': '<-', '↔': '<->', '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '\u0095', '·': '\u00b7', '✓': 'v', '✗': 'x', '≈': '~', '≥': '>=', '≤': '<=', '×': 'x', '−': '-', '▸': '>', '€': 'EUR', '\u00a0': ' ' };
const latin = s => String(s).replace(/[^\x00-\xff]/g, c => REPLACE[c] ?? (/\p{Extended_Pictographic}/u.test(c) ? '' : '?')).replace(/[\x00-\x08\x0b-\x1f]/g, '');
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\x80-\xff]/g, c => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0'));
// Approximate Helvetica widths (in em) for line wrapping; Courier is 0.6 em for every character.
const cw = c => (/[il.,'|!:;tfjI\x95]/.test(c) ? 0.28 : /[mwMW@%]/.test(c) ? 0.86 : /[A-Z]/.test(c) ? 0.68 : /[0-9]/.test(c) ? 0.556 : c === ' ' ? 0.278 : 0.53);
const width = (s, size, mono) => (mono ? s.length * 0.6 : [...s].reduce((a, c) => a + cw(c), 0)) * size;
function wrap(text, size, max, mono) {
  const out = []; let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word;
    if (width(next, size, mono) <= max || !line) line = next; else { out.push(line); line = word; }
    while (width(line, size, mono) > max && line.length > 1) { // a single very long word
      let k = line.length; while (k > 1 && width(line.slice(0, k), size, mono) > max) k--;
      out.push(line.slice(0, k)); line = line.slice(k);
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
const inline = s => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/<[^>]+>/g, '');

// Markdown → a list of styled lines.
function layout(md) {
  const lines = [], add = (text, o) => lines.push({ text, ...o });
  const para = (t, o = {}) => { const size = o.size || 10.5, indent = o.indent || 0; wrap(latin(inline(t)), size, BODY - indent, o.mono).forEach((l, i) => add((i === 0 && o.bullet ? '\u0095  ' : i && o.bullet ? '    ' : '') + l, { size, font: o.font || 'F1', indent, gap: o.gap ?? size * 1.42 })); };
  const src = String(md).replace(/\r/g, '').split('\n');
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    if (/^```/.test(l)) { // code block
      i++; while (i < src.length && !/^```/.test(src[i])) { wrap(latin(src[i]) || ' ', 8.5, BODY - 12, true).forEach(t => add(t, { size: 8.5, font: 'F3', indent: 12, gap: 11 })); i++; }
      add('', { size: 6, gap: 6 }); continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const size = [0, 19, 14.5, 12, 11][h[1].length]; add('', { size: 6, gap: h[1].length === 1 ? 4 : 10 }); para(h[2], { size, font: 'F2', gap: size * 1.35 }); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) { // table row; separator rows are skipped
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = /^\s*\|[\s:|-]+\|\s*$/.test(src[i + 1] || '');
      para(cells.join('   |   '), { size: 9.5, font: head ? 'F2' : 'F1', indent: 6, gap: 13.5 }); continue;
    }
    const b = /^(\s*)[-*]\s+(.*)$/.exec(l), n = /^(\s*)(\d+)\.\s+(.*)$/.exec(l);
    if (b) { para(b[2], { bullet: true, indent: 12 + Math.min(3, Math.floor(b[1].length / 2)) * 12 }); continue; }
    if (n) { para(`${n[2]}. ${n[3]}`, { indent: 12 + Math.min(3, Math.floor(n[1].length / 2)) * 12 }); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { add('', { size: 6, gap: 8, rule: true }); continue; }
    if (!l.trim()) { add('', { size: 6, gap: 6 }); continue; }
    // A paragraph: join the following plain lines.
    let t = l.trim();
    while (i + 1 < src.length && src[i + 1].trim() && !/^(#|```|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(src[i + 1])) t += ' ' + src[++i].trim();
    para(t);
  }
  return lines;
}

export function markdownPdf(md, { title = 'Document' } = {}) {
  const lines = layout(md), pages = [[]];
  let y = H - M;
  for (const l of lines) {
    if (y - l.gap < M + FOOT) { pages.push([]); y = H - M; if (!l.text) continue; }
    y -= l.gap;
    pages[pages.length - 1].push({ ...l, y });
  }
  const T = latin(title), objs = [];
  const obj = body => (objs.push(body), objs.length);
  const catalog = obj(null), pagesId = obj(null);
  const fonts = { F1: obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), F2: obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'), F3: obj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>') };
  const kids = pages.map((pg, i) => {
    const ops = pg.map(l => (l.rule ? `0.8 G ${M} ${l.y + 3} m ${W - M} ${l.y + 3} l S 0 G` : l.text ? `BT /${l.font} ${l.size} Tf ${M + l.indent} ${l.y.toFixed(1)} Td (${esc(l.text)}) Tj ET` : '')).filter(Boolean);
    // Footer: the title on the left, "Page N of M" centered.
    const pn = `Page ${i + 1} of ${pages.length}`;
    ops.push(`0.6 g BT /F1 8.5 Tf ${M} ${M - 22} Td (${esc(T.slice(0, 70))}) Tj ET`, `BT /F1 9 Tf ${(W / 2 - width(pn, 9) / 2).toFixed(1)} ${M - 22} Td (${esc(pn)}) Tj ET 0 g`, `0.85 G ${M} ${M - 10} m ${W - M} ${M - 10} l S 0 G`);
    const stream = ops.join('\n');
    const content = obj(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    return obj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R /Resources << /Font << /F1 ${fonts.F1} 0 R /F2 ${fonts.F2} 0 R /F3 ${fonts.F3} 0 R >> >> >>`);
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = obj(`<< /Title (${esc(T)}) /Producer (QuantPocket) >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = objs.map((body, i) => { const at = Buffer.byteLength(out, 'latin1'); out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { pdf: Buffer.from(out, 'latin1'), pages: pages.length };
}
