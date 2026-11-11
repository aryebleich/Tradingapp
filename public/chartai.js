// Chart structure, found automatically: swing points, support and resistance zones, trendlines,
// and chart patterns (head and shoulders, inverse head and shoulders, double tops and bottoms,
// ascending, descending and symmetrical triangles). Shared by the chart (instant overlays) and the
// server (the chart co-pilot that answers questions in plain words). Bars: { t, o, h, l, c },
// oldest first; with closes only, o = h = l = c.

// Swing highs and lows: a bar higher (lower) than the k bars on each side.
export function pivots(bars, k = 4) {
  const out = [];
  for (let i = k; i < bars.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k; j++) { if (j === i) continue; if (bars[j].h >= bars[i].h) hi = false; if (bars[j].l <= bars[i].l) lo = false; }
    if (hi) out.push({ i, p: bars[i].h, kind: 'high' });
    if (lo) out.push({ i, p: bars[i].l, kind: 'low' });
  }
  return out;
}

// Zones where price turned at least twice (within about 1.5%), closest to the last price first.
export function zones(bars, piv = pivots(bars), tol = 0.015) {
  const last = bars.at(-1)?.c; if (!last) return [];
  const sorted = [...piv].sort((a, b) => a.p - b.p), groups = [];
  for (const p of sorted) { const g = groups.at(-1); if (g && p.p <= g.lo * (1 + tol)) { g.pts.push(p); g.hi = Math.max(g.hi, p.p); } else groups.push({ lo: p.p, hi: p.p, pts: [p] }); }
  return groups.filter(g => g.pts.length >= 2).map(g => {
    const mid = (g.lo + g.hi) / 2;
    return { type: 'zone', kind: mid < last ? 'support' : 'resistance', lo: +g.lo.toFixed(4), hi: +Math.max(g.hi, g.lo * 1.002).toFixed(4), touches: g.pts.length, from: Math.min(...g.pts.map(p => p.i)), to: bars.length - 1, distance: +((mid / last - 1) * 100).toFixed(2) };
  }).sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance)).slice(0, 6);
}

// Trendlines through the last two rising swing lows (support) and falling swing highs (resistance).
export function trendlines(bars, piv = pivots(bars)) {
  const out = [], n = bars.length - 1;
  const fit = (pts, kind) => {
    for (let a = pts.length - 2; a >= Math.max(0, pts.length - 5); a--) {
      const p1 = pts[a], p2 = pts.at(-1); if (p2.i - p1.i < 8) continue;
      const slope = (p2.p - p1.p) / (p2.i - p1.i); if (kind === 'support' ? slope <= 0 : slope >= 0) continue;
      const at = i => p1.p + slope * (i - p1.i);
      // The line must not be broken by closes between its points.
      let ok = true; for (let i = p1.i; i <= p2.i; i++) if (kind === 'support' ? bars[i].c < at(i) * 0.99 : bars[i].c > at(i) * 1.01) { ok = false; break; }
      if (ok) { out.push({ type: 'trendline', kind, a: { i: p1.i, p: p1.p }, b: { i: n, p: +at(n).toFixed(4) }, broken: kind === 'support' ? bars[n].c < at(n) : bars[n].c > at(n) }); return; }
    }
  };
  fit(piv.filter(p => p.kind === 'low'), 'support'); fit(piv.filter(p => p.kind === 'high'), 'resistance');
  return out;
}

const near = (a, b, tol) => Math.abs(a - b) / ((a + b) / 2) <= tol;
// Chart patterns among consecutive swing points.
export function patterns(bars, piv = pivots(bars)) {
  const out = [], highs = piv.filter(p => p.kind === 'high'), lows = piv.filter(p => p.kind === 'low');
  const between = (a, b, kind) => (kind === 'low' ? lows : highs).filter(p => p.i > a.i && p.i < b.i);
  // Head and shoulders (top) / inverse (bottom).
  for (const [list, kind, inv] of [[highs, 'low', false], [lows, 'high', true]]) {
    for (let j = 0; j + 2 < list.length; j++) {
      const [l, h, r] = [list[j], list[j + 1], list[j + 2]];
      const head = inv ? h.p < l.p && h.p < r.p : h.p > l.p && h.p > r.p;
      if (!head || !near(l.p, r.p, 0.04) || Math.abs(h.p / ((l.p + r.p) / 2) - 1) < 0.03 || r.i - l.i < 15) continue;
      const t1 = between(l, h, kind)[0], t2 = between(h, r, kind)[0]; if (!t1 || !t2) continue;
      out.push({ type: 'pattern', name: inv ? 'Inverse head and shoulders' : 'Head and shoulders', key: inv ? 'ihs' : 'hs', bias: inv ? 'bull' : 'bear', from: l.i, to: r.i, points: [l, t1, h, t2, r].map(p => ({ i: p.i, p: p.p })), neckline: +((t1.p + t2.p) / 2).toFixed(4) });
    }
  }
  // Double tops and bottoms: two swings within 2%, at least 10 bars apart, with a 4% move between.
  for (const [list, kind, top] of [[highs, 'low', true], [lows, 'high', false]]) {
    for (let j = 0; j + 1 < list.length; j++) {
      const [a, b] = [list[j], list[j + 1]]; if (b.i - a.i < 10 || !near(a.p, b.p, 0.02)) continue;
      const mid = between(a, b, kind); if (!mid.length) continue;
      const m = top ? Math.min(...mid.map(p => p.p)) : Math.max(...mid.map(p => p.p));
      if (Math.abs(m / a.p - 1) < 0.04) continue;
      out.push({ type: 'pattern', name: top ? 'Double top' : 'Double bottom', key: top ? 'dtop' : 'dbottom', bias: top ? 'bear' : 'bull', from: a.i, to: b.i, points: [{ i: a.i, p: a.p }, { i: mid[0].i, p: m }, { i: b.i, p: b.p }], neckline: +m.toFixed(4) });
    }
  }
  // Triangles: the last three swing highs and lows converge.
  const H = highs.slice(-3), L = lows.slice(-3);
  if (H.length === 3 && L.length === 3) {
    const sh = (H[2].p - H[0].p) / (H[2].i - H[0].i), sl = (L[2].p - L[0].p) / (L[2].i - L[0].i), flat = (s, p) => Math.abs(s * 20 / p) < 0.01;
    let name = null, key = null, bias = 'neutral';
    if (flat(sh, H[0].p) && sl > 0) { name = 'Ascending triangle'; key = 'asc'; bias = 'bull'; }
    else if (flat(sl, L[0].p) && sh < 0) { name = 'Descending triangle'; key = 'desc'; bias = 'bear'; }
    else if (sh < 0 && sl > 0) { name = 'Symmetrical triangle'; key = 'sym'; }
    if (name) out.push({ type: 'pattern', name, key, bias, from: Math.min(H[0].i, L[0].i), to: bars.length - 1, points: [...H, ...L].sort((a, b) => a.i - b.i).map(p => ({ i: p.i, p: p.p })), upper: [{ i: H[0].i, p: H[0].p }, { i: H[2].i, p: H[2].p }], lower: [{ i: L[0].i, p: L[0].p }, { i: L[2].i, p: L[2].p }] });
  }
  return out.sort((a, b) => a.to - b.to);
}

// Daily bars into weekly ones, keeping the index of each week's last day.
export function weekly(bars) {
  const out = [];
  for (const [i, b] of bars.entries()) {
    const d = new Date(typeof b.t === 'number' ? b.t : Date.parse(b.t)), wk = Math.floor((d.getTime() / 864e5 + 3) / 7);
    const w = out.at(-1);
    if (w && w.wk === wk) { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.t = b.t; w.last = i; }
    else out.push({ wk, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, first: i, last: i });
  }
  return out;
}
// Everything at once, on daily bars and (for longer charts) weekly bars mapped back to days.
export function analyze(bars, { from = 0 } = {}) {
  const piv = pivots(bars), out = { zones: zones(bars, piv), trendlines: trendlines(bars, piv), patterns: patterns(bars, piv).filter(p => p.to >= from) };
  if (bars.length > 200) {
    const w = weekly(bars), wp = patterns(w, pivots(w, 2)).map(p => ({ ...p, name: p.name + ' (weekly)', timeframe: 'weekly', from: w[p.from].first, to: w[p.to].last, points: p.points.map(q => ({ i: w[q.i].last, p: q.p })) }));
    out.patterns.push(...wp.filter(p => p.to >= from));
  }
  return out;
}

// What a chart question asks for: patterns, zones, lines, option levels, short volume, and the period.
export const PATTERN_WORDS = [[/double tops?/, 'dtop'], [/double bottoms?/, 'dbottom'], [/ascending triangles?/, 'asc'], [/descending triangles?/, 'desc'], [/symmetrical triangles?/, 'sym'], [/(?<!ascending |descending |symmetrical )triangles?/, 'asc,desc,sym']];
export function parsePrompt(text) {
  const t = String(text || '').toLowerCase(), out = { patterns: [], zones: false, trendlines: false, options: false, short: false, days: null };
  // "Inverse head and shoulders" asks for the inverse only; a plain mention asks for the top pattern.
  if (/(inverse|inverted|reverse) head[- ]and[- ]shoulders?/.test(t)) out.patterns.push('ihs');
  if (/head[- ]and[- ]shoulders?|h&s/.test(t.replace(/(inverse|inverted|reverse) head[- ]and[- ]shoulders?/g, ''))) out.patterns.push('hs');
  for (const [re, k] of PATTERN_WORDS) if (re.test(t)) for (const x of k.split(',')) if (!out.patterns.includes(x)) out.patterns.push(x);
  if (/all patterns|any pattern|chart patterns?/.test(t)) out.patterns = ['hs', 'ihs', 'dtop', 'dbottom', 'asc', 'desc', 'sym'];
  out.zones = /support|resistance/.test(t) || (/\b(levels?|zones?)\b/.test(t) && !/option|open interest/.test(t));
  out.trendlines = /trend ?lines?|trend line|channel/.test(t);
  out.options = /option|open interest|\boi\b|gamma|call wall|put wall/.test(t);
  out.short = /short (interest|volume|sale|selling)|shorts?\b/.test(t);
  const m = /last\s+(\d+)\s*(day|week|month|year)s?/.exec(t);
  out.days = m ? +m[1] * { day: 1, week: 5, month: 21, year: 252 }[m[2]] : /last quarter|past quarter|3 months/.test(t) ? 63 : /last month|past month/.test(t) ? 21 : /last week|past week/.test(t) ? 5 : /last year|past year|12 months/.test(t) ? 252 : /6 months|half a year/.test(t) ? 126 : null;
  if (!out.patterns.length && !out.zones && !out.trendlines && !out.options && !out.short) { out.zones = true; out.trendlines = true; out.patterns = ['hs', 'ihs', 'dtop', 'dbottom', 'asc', 'desc', 'sym']; }
  return out;
}
