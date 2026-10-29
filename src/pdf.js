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
  const para = (t, o = {}) => { const size = o.size || 9, indent = o.indent || 0; wrap(latin(inline(t)), size, BODY - indent, o.mono).forEach((l, i) => add((i === 0 && o.bullet ? '\u0095  ' : i && o.bullet ? '    ' : '') + l, { size, font: o.font || 'F1', indent, gap: o.gap ?? size * 1.42 })); };
  const src = String(md).replace(/\r/g, '').split('\n');
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    if (/^```/.test(l)) { // code block
      i++; while (i < src.length && !/^```/.test(src[i])) { wrap(latin(src[i]) || ' ', 7.5, BODY - 12, true).forEach(t => add(t, { size: 7.5, font: 'F3', indent: 12, gap: 9.5 })); i++; }
      add('', { size: 6, gap: 6 }); continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const size = [0, 16, 12.5, 10.5, 9.5][h[1].length]; add('', { size: 6, gap: h[1].length === 1 ? 4 : 10 }); const at = lines.length; para(h[2], { size, font: 'F2', gap: size * 1.35 }); lines[at].heading = { level: h[1].length, text: latin(inline(h[2])) }; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) { // table row; separator rows are skipped
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = /^\s*\|[\s:|-]+\|\s*$/.test(src[i + 1] || '');
      para(cells.join('   |   '), { size: 8, font: head ? 'F2' : 'F1', indent: 6, gap: 11.5 }); continue;
    }
    const b = /^(\s*)[-*]\s+(.*)$/.exec(l), n = /^(\s*)(\d+)\.\s+(.*)$/.exec(l);
    if (b) { para(b[2], { bullet: true, indent: 10 + Math.min(3, Math.floor(b[1].length / 2)) * 10 }); continue; }
    if (n) { para(`${n[2]}. ${n[3]}`, { indent: 10 + Math.min(3, Math.floor(n[1].length / 2)) * 10 }); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { add('', { size: 6, gap: 8, rule: true }); continue; }
    if (!l.trim()) { add('', { size: 6, gap: 6 }); continue; }
    // A paragraph: join the following plain lines.
    let t = l.trim();
    while (i + 1 < src.length && src[i + 1].trim() && !/^(#|```|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(src[i + 1])) t += ' ' + src[++i].trim();
    para(t);
  }
  return lines;
}

// Lines → pages; records the page each heading lands on.
function paginate(lines) {
  const pages = [[]], at = [];
  let y = H - M;
  for (const l of lines) {
    if (y - l.gap < M + FOOT) { pages.push([]); y = H - M; if (!l.text) continue; }
    y -= l.gap;
    pages[pages.length - 1].push({ ...l, y });
    if (l.heading) at.push({ ...l.heading, page: pages.length, y: y + l.size });
  }
  return { pages, at };
}
// "Contents" with the page of each section (## headings), dotted out to the page number.
function contents(heads) {
  const out = [{ text: 'Contents', size: 14, font: 'F2', indent: 0, gap: 20 }, { text: '', size: 6, gap: 6 }];
  for (const h of heads) {
    const indent = (h.level - 2) * 14, size = h.level === 2 ? 9.5 : 8.5, num = String(h.page);
    let name = h.text; while (name.length > 3 && width(name, size) > BODY - indent - 60) name = name.slice(0, -2);
    const dots = '.'.repeat(Math.max(2, Math.floor((BODY - indent - width(name, size) - width(num, size) - 16) / (width('.', size) * 1.12))));
    out.push({ text: `${name} ${dots}`, right: num, size, font: h.level === 2 ? 'F2' : 'F1', indent, gap: size * 1.6, link: { page: h.page, y: h.y } });
  }
  return out;
}

// The Brightfolio symbol in PDF drawing commands: a blue tile, three bars, a rising line and a
// yellow spark (the same shapes as favicon.svg, drawn on a 64-unit grid).
function logoOps(x, y, size) {
  const k = size / 64, X = v => (x + v * k).toFixed(2), Y = v => (y + size - v * k).toFixed(2);
  const rr = (x0, y0, w, h, r) => { const c = r * 0.5523; return `${X(x0 + r)} ${Y(y0)} m ${X(x0 + w - r)} ${Y(y0)} l ${X(x0 + w - r + c)} ${Y(y0)} ${X(x0 + w)} ${Y(y0 + r - c)} ${X(x0 + w)} ${Y(y0 + r)} c ${X(x0 + w)} ${Y(y0 + h - r)} l ${X(x0 + w)} ${Y(y0 + h - r + c)} ${X(x0 + w - r + c)} ${Y(y0 + h)} ${X(x0 + w - r)} ${Y(y0 + h)} c ${X(x0 + r)} ${Y(y0 + h)} l ${X(x0 + r - c)} ${Y(y0 + h)} ${X(x0)} ${Y(y0 + h - r + c)} ${X(x0)} ${Y(y0 + h - r)} c ${X(x0)} ${Y(y0 + r)} l ${X(x0)} ${Y(y0 + r - c)} ${X(x0 + r - c)} ${Y(y0)} ${X(x0 + r)} ${Y(y0)} c h f`; };
  return [
    '0.110 0.306 0.847 rg', rr(0, 0, 64, 64, 16),
    '0.478 0.639 0.890 rg', rr(12, 40, 10, 12, 2.5), rr(27, 33, 10, 19, 2.5), rr(42, 27, 10, 25, 2.5),
    `1 1 1 RG ${(4.5 * k).toFixed(2)} w 1 J 1 j ${X(11)} ${Y(35)} m ${X(25)} ${Y(27)} l ${X(33)} ${Y(30)} l ${X(46)} ${Y(19)} l S`,
    `0.992 0.878 0.278 rg ${X(50.5)} ${Y(7)} m ${X(52.4)} ${Y(12.1)} l ${X(57.5)} ${Y(14)} l ${X(52.4)} ${Y(15.9)} l ${X(50.5)} ${Y(21)} l ${X(48.6)} ${Y(15.9)} l ${X(43.5)} ${Y(14)} l ${X(48.6)} ${Y(12.1)} l h f`,
    '0 g 0 G 1 w',
  ].join('\n');
}
// A cover page: the symbol, the name, the document title and the date.
function coverOps(title, subtitle) {
  const ops = [logoOps(W / 2 - 48, H - 300, 96)];
  const word = 'Brightfolio', ws = 30, ww = width(word, ws) * 1.04;
  ops.push(`BT /F2 ${ws} Tf 0.043 0.129 0.251 rg ${(W / 2 - ww / 2).toFixed(1)} ${H - 352} Td (Bright) Tj 0.114 0.306 0.847 rg (folio) Tj ET 0 g`);
  const lines = wrap(latin(title), 17, BODY - 60);
  lines.forEach((l, i) => ops.push(`BT /F2 17 Tf ${(W / 2 - width(l, 17) / 2).toFixed(1)} ${(H - 410 - i * 24).toFixed(1)} Td (${esc(l)}) Tj ET`));
  if (subtitle) { const t = latin(subtitle); ops.push(`0.45 g BT /F1 11 Tf ${(W / 2 - width(t, 11) / 2).toFixed(1)} ${(H - 420 - lines.length * 24).toFixed(1)} Td (${esc(t)}) Tj ET 0 g`); }
  ops.push(`0.85 G ${M + 80} ${M + 40} m ${W - M - 80} ${M + 40} l S 0 G`);
  return ops.join('\n');
}

export function markdownPdf(md, { title = 'Document', toc = true, cover = null, coverTitle = null, subtitle = '' } = {}) {
  const body = paginate(layout(md));
  const heads = body.at.filter(h => h.level === 2 || h.level === 3);
  // Documents with contents get a cover page first (unless told otherwise).
  cover ??= toc && heads.length >= 3;
  const front = cover ? 1 : 0;
  let tocPages = [];
  if (toc && heads.length >= 3) {
    // The document starts on a fresh page after the cover and contents, so each section moves back
    // by that many pages.
    let n = 1, list;
    for (let i = 0; i < 3; i++) {
      list = paginate(contents(heads.map(h => ({ ...h, page: h.page + front + n }))));
      if (list.pages.length === n) break;
      n = list.pages.length;
    }
    tocPages = list.pages;
  }
  const pages = [...(cover ? [{ cover: true }] : []), ...tocPages, ...body.pages];
  const T = latin(title), objs = [];
  const obj = body => (objs.push(body), objs.length);
  const catalog = obj(null), pagesId = obj(null);
  const fonts = { F1: obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), F2: obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'), F3: obj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>') };
  // Page objects are numbered first, so contents lines can link to pages that come later.
  const kids = pages.map(() => obj(null));
  pages.forEach((pg, i) => {
    const annots = [];
    let ops;
    if (pg.cover) ops = [coverOps(latin(coverTitle || title), subtitle || new Date().toISOString().slice(0, 10))];
    else {
      ops = pg.map(l => (l.rule ? `0.8 G ${M} ${l.y + 3} m ${W - M} ${l.y + 3} l S 0 G` : l.text ? `BT /${l.font} ${l.size} Tf ${M + l.indent} ${l.y.toFixed(1)} Td (${esc(l.text)}) Tj ET` + (l.right ? ` BT /${l.font} ${l.size} Tf ${(W - M - width(l.right, l.size) * 1.05).toFixed(1)} ${l.y.toFixed(1)} Td (${esc(l.right)}) Tj ET` : '') : '')).filter(Boolean);
      // Contents lines are links to their section.
      for (const l of pg) if (l.link && kids[l.link.page - 1]) annots.push(obj(`<< /Type /Annot /Subtype /Link /Rect [${M + l.indent} ${(l.y - 3).toFixed(1)} ${W - M} ${(l.y + l.size).toFixed(1)}] /Border [0 0 0] /Dest [${kids[l.link.page - 1]} 0 R /XYZ 0 ${(l.link.y + 12).toFixed(1)} 0] >>`));
      // Footer: the title on the left, "Page N of M" centered.
      const pn = `Page ${i + 1} of ${pages.length}`;
      ops.push(`0.6 g BT /F1 8.5 Tf ${M} ${M - 22} Td (${esc(T.slice(0, 70))}) Tj ET`, `BT /F1 9 Tf ${(W / 2 - width(pn, 9) / 2).toFixed(1)} ${M - 22} Td (${esc(pn)}) Tj ET 0 g`, `0.85 G ${M} ${M - 10} m ${W - M} ${M - 10} l S 0 G`);
    }
    const stream = ops.join('\n');
    const content = obj(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    objs[kids[i] - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map(a => `${a} 0 R`).join(' ')}]` : ''} /Resources << /Font << /F1 ${fonts.F1} 0 R /F2 ${fonts.F2} 0 R /F3 ${fonts.F3} 0 R >> >> >>`;
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = obj(`<< /Title (${esc(T)}) /Producer (Brightfolio) >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = objs.map((body, i) => { const at = Buffer.byteLength(out, 'latin1'); out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { pdf: Buffer.from(out, 'latin1'), pages: pages.length };
}
