// Brightolio Script: a small language for custom indicators, strategies and alerts, written in the
// familiar Pine-style syntax (indicator(), ta.sma(close, 20), plot(), strategy.entry(), alertcondition()).
// It runs on whole price series at once: every value is either a number or a series as long as the
// bars. Shared by the browser (chart, backtest) and the server (alerts).
//
//   //@version=1
//   indicator("RSI cross", overlay=false)
//   len = input(14, "Length")
//   r = ta.rsi(close, len)
//   plot(r, "RSI")
//   hline(30)
//   buy = ta.crossover(r, 30)
//   strategy.entry("Long", strategy.long, when=buy)
//   strategy.close("Long", when=ta.crossunder(r, 70))
//   alertcondition(buy, "RSI crossed up through 30")
//
// Supported: numbers, strings, true/false, na; + - * / %; > < >= <= == !=; and or not; cond ? a : b;
// series[n] (the value n bars ago); [a, b] = f(...) for functions with several results; named
// arguments; // comments. Not supported: loops, if-blocks, var and user functions (keep scripts short).
import * as T from './indicators.js';

const err = (m, line) => Object.assign(new Error(line ? `Line ${line}: ${m}` : m), { status: 400 });

// ---------- tokens ----------
const KW = new Set(['and', 'or', 'not', 'true', 'false', 'na']);
function tokens(src, line) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') break;
    const m = /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)/i.exec(src.slice(i));
    if (m) { out.push({ t: 'num', v: +m[1] }); i += m[1].length; continue; }
    if (c === '"' || c === "'") { const j = src.indexOf(c, i + 1); if (j < 0) throw err('A text has no closing quote', line); out.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (id) { out.push({ t: KW.has(id[0]) ? 'kw' : 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(:=|==|!=|>=|<=|[-+*/%<>=?:()[\],])/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[1] }); i += op[1].length; continue; }
    throw err(`Unexpected "${c}"`, line);
  }
  return out;
}

// ---------- parser (expressions by precedence) ----------
function parser(tk, line) {
  let p = 0;
  const peek = (v) => tk[p] && (v === undefined || tk[p].v === v) ? tk[p] : null;
  const eat = v => { if (!peek(v)) throw err(`Expected "${v}"`, line); return tk[p++]; };
  const expr = () => ternary();
  const ternary = () => { const c = or(); if (peek('?')) { p++; const a = expr(); eat(':'); const b = expr(); return { k: 'if', c, a, b }; } return c; };
  const bin = (next, ops) => () => { let l = next(); while (tk[p] && ops.includes(tk[p].v) && (tk[p].t === 'op' || tk[p].t === 'kw')) { const o = tk[p++].v; l = { k: 'bin', o, l, r: next() }; } return l; };
  const unary = () => { if (peek('-') || peek('not') || peek('+')) { const o = tk[p++].v; return { k: 'un', o, e: unary() }; } return post(); };
  const mul = bin(unary, ['*', '/', '%']), add = bin(mul, ['+', '-']), cmp = bin(add, ['>', '<', '>=', '<=']), eq = bin(cmp, ['==', '!=']), and = bin(eq, ['and']), or = bin(and, ['or']);
  const post = () => { let e = atom(); while (peek('[')) { p++; const n = expr(); eat(']'); e = { k: 'idx', e, n }; } return e; };
  const atom = () => {
    const t = tk[p++];
    if (!t) throw err('The line ends too early', line);
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'kw') { if (t.v === 'true') return { k: 'num', v: 1 }; if (t.v === 'false') return { k: 'num', v: 0 }; if (t.v === 'na') return { k: 'na' }; throw err(`Unexpected "${t.v}"`, line); }
    if (t.v === '(') { const e = expr(); eat(')'); return e; }
    if (t.v === '[') { const items = []; while (!peek(']')) { items.push(expr()); if (peek(',')) p++; } eat(']'); return { k: 'list', items }; }
    if (t.t === 'id') {
      if (peek('(')) { p++; const args = [], named = {}; while (!peek(')')) { if (tk[p]?.t === 'id' && tk[p + 1]?.v === '=') { const n = tk[p].v; p += 2; named[n] = expr(); } else args.push(expr()); if (peek(',')) p++; else break; } eat(')'); return { k: 'call', f: t.v, args, named }; }
      return { k: 'var', n: t.v };
    }
    throw err(`Unexpected "${t.v}"`, line);
  };
  return { expr, done: () => p >= tk.length, peek, eat, get p() { return p; }, set p(v) { p = v; } };
}

// ---------- values: numbers or series ----------
const isS = v => Array.isArray(v);
const nz = v => (v == null || Number.isNaN(v) ? null : v);
function lift(f, ...xs) {
  const n = xs.find(isS)?.length;
  if (n == null) return nz(f(...xs));
  const out = new Array(n);
  for (let i = 0; i < n; i++) { const a = xs.map(x => (isS(x) ? x[i] : x)); out[i] = a.some(v => v == null) ? null : nz(f(...a)); }
  return out;
}
const series = (v, n) => (isS(v) ? v : new Array(n).fill(v ?? null));

export function run(source, bars, { inputs = {} } = {}) {
  const n = bars.length, env = Object.create(null), out = { title: 'Script', overlay: true, plots: [], hlines: [], entries: [], closes: [], alerts: [], inputs: [] };
  const col = k => bars.map(b => b[k]);
  Object.assign(env, { open: col('o'), high: col('h'), low: col('l'), close: col('c'), volume: col('v'), hl2: bars.map(b => (b.h + b.l) / 2), hlc3: bars.map(b => (b.h + b.l + b.c) / 3), ohlc4: bars.map(b => (b.o + b.h + b.l + b.c) / 4), bar_index: bars.map((_, i) => i), time: bars.map(b => b.t), 'strategy.long': 'long', 'strategy.short': 'short' });
  const num = (v, name) => { if (isS(v)) throw err(`${name} must be a number, not a series`); return +v; };
  const S = v => series(v, n);
  const ind = (id, params, k = 0) => T.compute(id, bars, params).lines[k].values;
  const F = {
    input: (a, nm) => { const title = nm.title ?? a[1] ?? `input ${out.inputs.length + 1}`, v = title in inputs ? +inputs[title] : a[0] ?? nm.defval; out.inputs.push({ title, value: v }); return v; },
    'input.int': (a, nm) => Math.round(F.input(a, nm)), 'input.float': (a, nm) => F.input(a, nm),
    indicator: (a, nm) => { out.title = String(a[0] ?? nm.title ?? 'Script'); out.overlay = !!(nm.overlay ?? true); return null; },
    strategy: (a, nm) => { out.title = String(a[0] ?? nm.title ?? 'Strategy'); out.overlay = nm.overlay == null ? true : !!nm.overlay; out.strategy = true; return null; },
    plot: (a, nm) => { out.plots.push({ title: String(a[1] ?? nm.title ?? `Plot ${out.plots.length + 1}`), values: S(a[0]), color: nm.color || null }); return null; },
    hline: (a, nm) => { out.hlines.push({ price: num(a[0], 'hline'), title: String(a[1] ?? nm.title ?? '') }); return null; },
    'strategy.entry': (a, nm) => { out.strategy = true; out.entries.push({ id: String(a[0] ?? 'Long'), dir: (a[1] ?? nm.direction) === 'short' ? 'short' : 'long', when: S(nm.when ?? a[2] ?? 1) }); return null; },
    'strategy.close': (a, nm) => { out.closes.push({ id: String(a[0] ?? 'Long'), when: S(nm.when ?? a[1] ?? 1) }); return null; },
    alertcondition: (a, nm) => { out.alerts.push({ title: String(a[1] ?? nm.title ?? 'Alert'), when: S(a[0]) }); return null; },
    'ta.sma': a => T.sma(S(a[0]), num(a[1], 'length')), 'ta.ema': a => T.ema(S(a[0]), num(a[1], 'length')), 'ta.wma': a => T.wma(S(a[0]), num(a[1], 'length')), 'ta.rma': a => T.rma(S(a[0]), num(a[1], 'length')),
    'ta.rsi': a => T.rsi(S(a[0]), num(a[1], 'length')), 'ta.stdev': a => T.stdev(S(a[0]), num(a[1], 'length')), 'ta.highest': a => (a.length > 1 ? T.highest(S(a[0]), num(a[1], 'length')) : T.highest(env.high, num(a[0], 'length'))),
    'ta.lowest': a => (a.length > 1 ? T.lowest(S(a[0]), num(a[1], 'length')) : T.lowest(env.low, num(a[0], 'length'))), 'ta.change': a => T.change(S(a[0]), a[1] == null ? 1 : num(a[1], 'length')), 'ta.roc': a => T.roc(S(a[0]), num(a[1], 'length')),
    'ta.mom': a => T.change(S(a[0]), num(a[1], 'length')), 'ta.sum': a => T.sum(S(a[0]), num(a[1], 'length')), 'ta.tr': () => T.tr(bars), 'ta.atr': a => T.atr(bars, num(a[0], 'length')),
    'ta.crossover': a => { const x = S(a[0]), y = S(a[1]); return x.map((v, i) => (!i || v == null || y[i] == null || x[i - 1] == null || y[i - 1] == null ? 0 : v > y[i] && x[i - 1] <= y[i - 1] ? 1 : 0)); },
    'ta.crossunder': a => { const x = S(a[0]), y = S(a[1]); return x.map((v, i) => (!i || v == null || y[i] == null || x[i - 1] == null || y[i - 1] == null ? 0 : v < y[i] && x[i - 1] >= y[i - 1] ? 1 : 0)); },
    'ta.cross': a => lift((p, q) => p || q, F['ta.crossover'](a), F['ta.crossunder'](a)),
    'ta.macd': a => { const src = S(a[0] ?? env.close), m = lift((p, q) => p - q, T.ema(src, a[1] ?? 12), T.ema(src, a[2] ?? 26)), sg = T.ema(m, a[3] ?? 9); return [m, sg, lift((p, q) => p - q, m, sg)]; },
    'ta.bb': a => { const m = T.sma(S(a[0]), num(a[1], 'length')), d = T.stdev(S(a[0]), num(a[1], 'length')), k = num(a[2] ?? 2, 'mult'); return [m, lift((x, y) => x + k * y, m, d), lift((x, y) => x - k * y, m, d)]; },
    'ta.stoch': a => { const len = num(a[3] ?? a[1] ?? 14, 'length'), hh = T.highest(S(a[1] ?? env.high), len), ll = T.lowest(S(a[2] ?? env.low), len); return lift((c, h, l) => (h === l ? 50 : (c - l) / (h - l) * 100), S(a[0]), hh, ll); },
    'ta.cci': a => ind('cci', { length: num(a[1] ?? 20, 'length') }), 'ta.mfi': a => ind('mfi', { length: num(a[1] ?? 14, 'length') }), 'ta.obv': () => ind('obv', {}), 'ta.vwap': () => ind('vwap', {}),
    'ta.supertrend': a => [ind('supertrend', { factor: num(a[0] ?? 3, 'factor'), length: num(a[1] ?? 10, 'length') })], 'ta.dmi': a => T.compute('dmi', bars, { length: num(a[0] ?? 14, 'length') }).lines.map(l => l.values),
    'ta.adx': a => ind('adx', { length: num(a[0] ?? 14, 'length') }), 'ta.psar': () => ind('psar', {}),
    // Any library indicator: ind("keltner", "Upper", length=20)
    ind: (a, nm) => { const r = T.compute(String(a[0]), bars, nm); const k = a[1] == null ? 0 : r.lines.findIndex(l => l.name === a[1]); if (k < 0) throw err(`"${a[0]}" has no line called "${a[1]}"`); return r.lines[k].values; },
    'math.abs': a => lift(Math.abs, a[0]), 'math.max': a => lift(Math.max, ...a), 'math.min': a => lift(Math.min, ...a), 'math.sqrt': a => lift(Math.sqrt, a[0]), 'math.log': a => lift(Math.log, a[0]), 'math.pow': a => lift(Math.pow, a[0], a[1]), 'math.round': a => lift(v => Math.round(v), a[0]),
    abs: a => lift(Math.abs, a[0]), max: a => lift(Math.max, ...a), min: a => lift(Math.min, ...a), nz: a => (isS(a[0]) ? a[0].map(v => v ?? (a[1] ?? 0)) : a[0] ?? (a[1] ?? 0)), na: a => lift(v => (v == null ? 1 : 0), a[0] ?? null),
    'color.new': a => a[0], 'color.rgb': a => `rgb(${a[0]},${a[1]},${a[2]})`,
  };
  const COLORS = { 'color.red': '#e11d48', 'color.green': '#16a34a', 'color.blue': '#2563eb', 'color.orange': '#f97316', 'color.purple': '#8b5cf6', 'color.yellow': '#eab308', 'color.gray': '#64748b', 'color.white': '#ffffff', 'color.black': '#000000', 'color.teal': '#0d9488', 'color.aqua': '#06b6d4', 'color.fuchsia': '#d946ef', 'color.lime': '#84cc16', 'color.maroon': '#7f1d1d', 'color.navy': '#1e3a8a', 'color.olive': '#4d7c0f', 'color.silver': '#94a3b8' };
  const ev = (e, line) => {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'na': return null;
      case 'var': if (e.n in env) return env[e.n]; if (e.n in COLORS) return COLORS[e.n]; throw err(`"${e.n}" is not defined`, line);
      case 'list': return e.items.map(x => ev(x, line));
      case 'un': { const v = ev(e.e, line); return e.o === '-' ? lift(x => -x, v) : e.o === '+' ? v : lift(x => (x ? 0 : 1), v); }
      case 'idx': { const v = ev(e.e, line), k = num(ev(e.n, line), 'the [ ] offset'); return isS(v) ? T.shift(v, k) : v; }
      case 'if': { const c = ev(e.c, line), a = ev(e.a, line), b = ev(e.b, line); if (!isS(c) && !isS(a) && !isS(b)) return c ? a : b; const C = S(c), A = S(a), B = S(b); return C.map((x, i) => (x ? A[i] : B[i])); }
      case 'bin': {
        const l = ev(e.l, line), r = ev(e.r, line);
        const f = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => (b === 0 ? null : a / b), '%': (a, b) => a % b, '>': (a, b) => +(a > b), '<': (a, b) => +(a < b), '>=': (a, b) => +(a >= b), '<=': (a, b) => +(a <= b), '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b), and: (a, b) => +(!!a && !!b), or: (a, b) => +(!!a || !!b) }[e.o];
        if (typeof l === 'string' || typeof r === 'string') return e.o === '+' ? String(l) + String(r) : e.o === '==' ? +(l === r) : +(l !== r);
        return lift(f, l, r);
      }
      case 'call': {
        const fn = F[e.f]; if (!fn) throw err(`Unknown function ${e.f}()`, line);
        const named = Object.fromEntries(Object.entries(e.named).map(([k, v]) => [k, ev(v, line)]));
        try { return fn(e.args.map(a => ev(a, line)), named); } catch (x) { throw x.status ? x : err(`${e.f}(): ${x.message}`, line); }
      }
    }
    throw err('Cannot read this expression', line);
  };
  const lines = String(source || '').split(/\r?\n/);
  if (lines.length > 400) throw err('Scripts are limited to 400 lines');
  lines.forEach((raw, k) => {
    const line = k + 1, txt = raw.trim();
    if (!txt || txt.startsWith('//')) return;
    const tk = tokens(txt, line); if (!tk.length) return;
    const P = parser(tk, line);
    // [a, b, c] = f(...)
    if (tk[0].v === '[') {
      const names = []; let j = 1; while (tk[j] && tk[j].v !== ']') { if (tk[j].t === 'id') names.push(tk[j].v); j++; }
      if (tk[j + 1]?.v === "=") { P.p = j + 2; const v = ev(P.expr(), line); if (!P.done()) throw err('Unexpected text at the end', line); if (!Array.isArray(v) || !Array.isArray(v[0])) throw err('This function gives one result; use name = …', line); names.forEach((nm, i) => (env[nm] = v[i] ?? null)); return; }
    }
    if (tk[0].t === 'id' && (tk[1]?.v === '=' || tk[1]?.v === ':=')) { P.p = 2; env[tk[0].v] = ev(P.expr(), line); if (!P.done()) throw err('Unexpected text at the end', line); return; }
    ev(P.expr(), line);
    if (!P.done()) throw err('Unexpected text at the end', line);
  });
  return out;
}

// Backtest: an entry signal opens a position at the next bar's open, a close signal (or the opposite
// entry) closes it at the next bar's open. One position at a time, all money in, no fees.
export function backtest(result, bars, { capital = 10000 } = {}) {
  const n = bars.length, sig = i => ({ open: result.entries.find(e => e.when[i]), close: result.closes.some(c => c.when[i]) });
  const trades = [], equity = []; let pos = null, cash = capital;
  for (let i = 0; i < n; i++) {
    const s = i ? sig(i - 1) : { open: null, close: false }, px = bars[i].o ?? bars[i].c;
    if (pos && (s.close || (s.open && s.open.dir !== pos.dir))) {
      const ret = pos.dir === 'long' ? px / pos.price - 1 : pos.price / px - 1; cash = pos.cash * (1 + ret);
      trades.push({ dir: pos.dir, entry: pos.price, exit: px, entryT: pos.t, exitT: bars[i].t, ret: +(ret * 100).toFixed(2) }); pos = null;
    }
    if (!pos && s.open) pos = { dir: s.open.dir, price: px, t: bars[i].t, cash };
    const mark = pos ? pos.cash * (1 + (pos.dir === 'long' ? bars[i].c / pos.price - 1 : pos.price / bars[i].c - 1)) : cash;
    equity.push(+mark.toFixed(2));
  }
  const wins = trades.filter(t => t.ret > 0), losses = trades.filter(t => t.ret <= 0);
  let peak = -Infinity, dd = 0; for (const e of equity) { peak = Math.max(peak, e); dd = Math.min(dd, e / peak - 1); }
  const gross = s => s.reduce((a, t) => a + Math.abs(t.ret), 0);
  return { trades, equity, final: equity.at(-1) ?? capital, totalReturn: +(((equity.at(-1) ?? capital) / capital - 1) * 100).toFixed(2), winRate: trades.length ? +(wins.length / trades.length * 100).toFixed(1) : null, profitFactor: losses.length ? +(gross(wins) / (gross(losses) || 1)).toFixed(2) : wins.length ? null : null, maxDrawdown: +(dd * 100).toFixed(2), open: pos ? { dir: pos.dir, entry: pos.price } : null, buyHold: +((bars.at(-1).c / bars[0].c - 1) * 100).toFixed(2) };
}

// Alerts that fire on the last bar.
export const firing = result => result.alerts.filter(a => a.when.at(-1)).map(a => a.title);

export const EXAMPLE = `//@version=1
strategy("RSI and trend", overlay=true)
len = input(14, "RSI length")
fast = ta.ema(close, 20)
slow = ta.ema(close, 50)
r = ta.rsi(close, len)
plot(fast, "EMA 20", color=color.orange)
plot(slow, "EMA 50", color=color.blue)
buy = ta.crossover(fast, slow) and r < 70
sell = ta.crossunder(fast, slow) or r > 80
strategy.entry("Long", strategy.long, when=buy)
strategy.close("Long", when=sell)
alertcondition(buy, "Trend turned up")`;
