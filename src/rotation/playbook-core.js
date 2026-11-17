// Playbooks: Brightolio's block-based strategies. One JSON format is shared by the visual editor,
// the AI builder, the backtester (engine.js backtest) and the executor (runner.js / playbooks.js):
//
//   { kind: 'playbook', version: 1, rebalance: 'daily'|'weekly'|'monthly'|'quarterly', weekday?: 1-5,
//     benchmark: 'SPY', root: Block }
//   Block = { id, type: 'asset',  ticker, weight? }                       buy this ticker
//         | { id, type: 'cash',   weight? }                               hold nothing (cash)
//         | { id, type: 'group',  name?, weighting, children: [Block], weight? }
//         | { id, type: 'if',     cond, then: Block, else: Block, weight? }
//         | { id, type: 'filter', metric: [fn, n], select: 'top'|'bottom', count, weighting, children: [asset Block], weight? }
//   weighting = 'equal' | 'specified' (children's `weight` in %, adding to 100) | 'invvol' (inverse volatility)
//   cond = { a: metric, op: '>'|'<'|'>='|'<=', b: metric | number }  or  { need: k, of: [cond...] } (k of n true)
//   metric = [fn, TICKER, n] with fn from indicators.js (rsi, sma, close, ret, avgret, stdev, high, pstdev)
//
// No imports from the order path here: engine.js and the browser-side editor rules mirror this file.
import { FNS, LABEL, dailyVol } from './indicators.js';

export const WEIGHTINGS = { equal: 'Equal weight', specified: 'Specified weights', invvol: 'Inverse volatility' };
export const REBALANCES = { daily: 'Every trading day', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
export const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_BLOCKS = 300, MAX_DEPTH = 40;

const label = m => (typeof m === 'number' ? String(m) : `${(LABEL[m[0]] || (() => m[0]))(m[2])} of ${m[1]}`);
export const condLabel = c => (c.of ? `${c.need} of ${c.of.length}: ${c.of.map(condLabel).join('; ')}` : `${label(c.a)} ${c.op} ${label(c.b)}`);

// Every problem in a Playbook, so the editor and the AI builder can show them all at once.
// Returns { ok, problems, playbook } where playbook is the cleaned copy (ids filled in, tickers upper-case).
export function checkPlaybook(input) {
  const problems = [];
  let n = 0, seq = 0;
  const err = (where, msg) => problems.push(`${where}: ${msg}`);
  const sym = (t, where) => { const T = String(t || '').trim().toUpperCase(); if (!SYMBOL.test(T)) err(where, `"${t ?? ''}" is not a valid ticker`); return T; };
  const metric = (m, where) => {
    if (typeof m === 'number' && Number.isFinite(m)) return m;
    if (typeof m === 'string' && m.trim() !== '' && Number.isFinite(+m)) return +m;
    if (!Array.isArray(m) || m.length < 2) { err(where, 'a value is an indicator like ["sma", "SPY", 200] or a number'); return 0; }
    const [fn, t, len] = m;
    if (!FNS.includes(fn)) err(where, `unknown indicator "${fn}" (use ${FNS.join(', ')})`);
    const L = fn === 'close' ? 0 : Math.round(+len);
    if (fn !== 'close' && !(L >= 1 && L <= 400)) err(where, 'indicator length must be 1 to 400 days');
    return [fn, sym(t, where), L];
  };
  const cond = (c, where) => {
    if (!c || typeof c !== 'object') { err(where, 'a condition is missing'); return { a: 0, op: '>', b: 0 }; }
    if (Array.isArray(c.of)) {
      if (!c.of.length || c.of.length > 10) err(where, 'a vote needs 1 to 10 conditions');
      const of = c.of.slice(0, 10).map((x, i) => cond(x, `${where} vote ${i + 1}`));
      const need = Math.round(+c.need);
      if (!(need >= 1 && need <= of.length)) err(where, `votes needed must be 1 to ${of.length}`);
      return { need, of };
    }
    if (!OPS[c.op]) err(where, 'compare with >, <, >= or <=');
    return { a: metric(c.a, where), op: c.op, b: metric(c.b, where) };
  };
  const block = (b, where, depth) => {
    if (++n > MAX_BLOCKS) { if (n === MAX_BLOCKS + 1) err('Playbook', `too many blocks (at most ${MAX_BLOCKS})`); return { type: 'cash' }; }
    if (depth > MAX_DEPTH) { err(where, 'blocks are nested too deeply'); return { type: 'cash' }; }
    if (!b || typeof b !== 'object') { err(where, 'a block is missing'); return { type: 'cash' }; }
    const o = { id: String(b.id || `b${++seq}`).slice(0, 40), type: b.type };
    if (b.weight !== undefined && b.weight !== null && b.weight !== '') o.weight = +b.weight;
    const name = b.name || b.type;
    const w = `${where} (${name}${b.ticker ? ' ' + b.ticker : ''})`;
    if (b.type === 'asset') o.ticker = sym(b.ticker, w);
    else if (b.type === 'cash') { /* holds nothing */ }
    else if (b.type === 'group' || b.type === 'filter') {
      if (b.name) o.name = String(b.name).slice(0, 60);
      o.weighting = b.weighting || 'equal';
      if (!WEIGHTINGS[o.weighting]) err(w, `weighting must be ${Object.keys(WEIGHTINGS).join(', ')}`);
      if (!Array.isArray(b.children) || !b.children.length) err(w, 'needs at least one block inside');
      o.children = (b.children || []).map((c, i) => block(c, `${w} › ${i + 1}`, depth + 1));
      if (o.weighting === 'specified') {
        const bad = o.children.find(c => !(c.weight > 0));
        if (bad) err(w, 'with specified weights every block inside needs a weight above 0%');
        const tot = o.children.reduce((a, c) => a + (+c.weight || 0), 0);
        if (Math.abs(tot - 100) > 0.01) err(w, `specified weights add up to ${+tot.toFixed(2)}%, not 100%`);
      }
      if (b.type === 'filter') {
        if (o.weighting === 'specified') err(w, 'a filter weights what it picks equally or by inverse volatility');
        const [fn, len] = Array.isArray(b.metric) ? b.metric : [];
        if (!FNS.includes(fn) || fn === 'close') err(w, 'rank by an indicator such as ["ret", 63] or ["rsi", 10]');
        o.metric = [fn, Math.round(+len) || 0];
        if (fn && fn !== 'close' && !(o.metric[1] >= 1 && o.metric[1] <= 400)) err(w, 'ranking length must be 1 to 400 days');
        o.select = b.select === 'bottom' ? 'bottom' : 'top';
        o.count = Math.round(+b.count);
        if (!(o.count >= 1 && o.count <= o.children.length)) err(w, `pick 1 to ${o.children.length}`);
        if (o.children.some(c => c.type !== 'asset')) err(w, 'a filter ranks assets only');
      }
    } else if (b.type === 'if') {
      o.cond = cond(b.cond, w);
      o.then = block(b.then, `${w} › then`, depth + 1);
      o.else = block(b.else, `${w} › else`, depth + 1);
    } else err(w, `unknown block type "${b.type}"`);
    return o;
  };
  const p = input && typeof input === 'object' ? input : {};
  const out = { kind: 'playbook', version: 1, rebalance: p.rebalance || 'monthly', benchmark: 'SPY' };
  if (!REBALANCES[out.rebalance]) err('Rebalance', `use ${Object.keys(REBALANCES).join(', ')}`);
  if (out.rebalance === 'weekly') { out.weekday = Math.round(+(p.weekday ?? 3)); if (!(out.weekday >= 1 && out.weekday <= 5)) err('Rebalance', 'weekday must be Monday (1) to Friday (5)'); }
  out.benchmark = sym(p.benchmark || 'SPY', 'Benchmark');
  out.root = block(p.root, 'Playbook', 0);
  if (!problems.length && !tickers(out).length) problems.push('Playbook: add at least one asset');
  return { ok: !problems.length, problems, playbook: out };
}

// Tickers the Playbook buys or reads, and the benchmark.
export function tickers(pb, { reads = true } = {}) {
  const out = new Set();
  const m = x => { if (Array.isArray(x)) out.add(x[1]); };
  const c = x => { if (!x) return; if (x.of) x.of.forEach(c); else { m(x.a); m(x.b); } };
  const walk = b => {
    if (!b) return;
    if (b.type === 'asset') out.add(b.ticker);
    (b.children || []).forEach(walk);
    if (b.type === 'if') { if (reads) c(b.cond); walk(b.then); walk(b.else); }
  };
  walk(pb.root);
  if (reads && pb.benchmark) out.add(pb.benchmark);
  return [...out].filter(Boolean);
}

// Target weights for a day. `val(metric)` returns a number (NaN = no data); `closesOf(t)` gives the
// closes up to that day (for volatility and ranking). `trace` says which condition decided what.
export function evaluate(pb, val, closesOf) {
  const weights = {}, trace = [];
  let complete = true;
  const vol = t => { const v = dailyVol(closesOf(t)); return Number.isFinite(v) && v > 0 ? v : NaN; };
  const blockVol = b => { const ts = tickers({ root: b }, { reads: false }); const vs = ts.map(vol).filter(Number.isFinite); return vs.length ? vs.reduce((a, x) => a + x, 0) / vs.length : NaN; };
  const shares = (kids, weighting, share) => {
    if (weighting === 'specified') return kids.map(k => share * (+k.weight || 0) / 100);
    if (weighting === 'invvol') {
      const inv = kids.map(k => 1 / blockVol(k));
      if (inv.every(Number.isFinite)) { const s = inv.reduce((a, x) => a + x, 0); return inv.map(x => share * x / s); }
      trace.push({ id: null, note: 'Inverse volatility needs price history; used equal weights' });
    }
    return kids.map(() => share / kids.length);
  };
  const test = c => {
    if (c.of) { const r = c.of.map(test); return r.some(x => x === null) ? null : r.filter(Boolean).length >= c.need; }
    const a = val(c.a), b = val(c.b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return OPS[c.op](a, b);
  };
  const node = (b, share) => {
    if (!(share > 0) || !b) return;
    if (b.type === 'asset') weights[b.ticker] = (weights[b.ticker] || 0) + share;
    else if (b.type === 'cash') { /* stays in cash */ }
    else if (b.type === 'group') { const s = shares(b.children, b.weighting, share); b.children.forEach((k, i) => node(k, s[i])); }
    else if (b.type === 'if') {
      const r = test(b.cond);
      if (r === null) { complete = false; trace.push({ id: b.id, rule: condLabel(b.cond), result: 'no data' }); return; }
      trace.push({ id: b.id, rule: condLabel(b.cond), result: r ? 'then' : 'else' });
      node(r ? b.then : b.else, share);
    } else if (b.type === 'filter') {
      const [fn, len] = b.metric;
      const scored = b.children.map(k => ({ k, v: val([fn, k.ticker, len]) })).filter(x => Number.isFinite(x.v));
      if (!scored.length) { complete = false; trace.push({ id: b.id, rule: `rank by ${label([fn, '…', len])}`, result: 'no data' }); return; }
      scored.sort((x, y) => (b.select === 'top' ? y.v - x.v : x.v - y.v));
      const pick = scored.slice(0, b.count).map(x => x.k);
      trace.push({ id: b.id, rule: `${b.select} ${b.count} by ${(LABEL[fn] || (() => fn))(len)}`, result: pick.map(k => k.ticker).join(', ') });
      const s = shares(pick, b.weighting, share); pick.forEach((k, i) => node(k, s[i]));
    }
  };
  node(pb.root, 1);
  for (const t of Object.keys(weights)) weights[t] = +weights[t].toFixed(6);
  return { weights, trace, complete };
}

// Is `day` a rebalance day? `isTradingDay` comes from the market calendar (holidays included).
export function rebalanceDue(pb, day, isTradingDay, prevTradingDay) {
  if (!isTradingDay(day)) return false;
  const d = new Date(day + 'T12:00:00Z');
  if (pb.rebalance === 'daily') return true;
  if (pb.rebalance === 'weekly') return d.getUTCDay() === (pb.weekday ?? 3);
  const prev = prevTradingDay(day), pm = +prev.slice(5, 7), m = +day.slice(5, 7);
  if (pb.rebalance === 'monthly') return pm !== m;
  if (pb.rebalance === 'quarterly') return pm !== m && [1, 4, 7, 10].includes(m);
  return false;
}

// ---------- the existing designs, converted (for the library seed) ----------
// tree strategies: each sleeve becomes a group block with its weight; cmp, band, higher and vote steps
// become if blocks; momentum lists become a filter. Kinds that keep their own state (pullback) or need
// typed-in predictions (macro) have no Playbook equivalent and are left out.
export function fromSpec(spec) {
  const pbBase = { kind: 'playbook', version: 1, rebalance: spec.rebalance === 'weekly' ? 'weekly' : spec.rebalance === 'monthly' ? 'monthly' : 'daily', ...(spec.rebalance === 'weekly' ? { weekday: spec.weekday ?? 3 } : {}), benchmark: 'SPY' };
  if (spec.kind === 'momentum') {
    const p = spec.params;
    return { ...pbBase, root: { type: 'filter', name: 'Strongest of the list', metric: ['ret', p.lookback], select: 'top', count: p.top || 1, weighting: 'equal', children: p.universe.map(t => ({ type: 'asset', ticker: t })) } };
  }
  if (spec.kind !== 'tree') return null;
  const sleeve = sl => {
    const steps = new Map(sl.steps.map(s => [s.id, s]));
    const to = (target, depth) => {
      if (!target) return { type: 'cash' };
      if (String(target).startsWith('@')) return { type: 'asset', ticker: target.slice(1) };
      if (depth > MAX_DEPTH - 2) throw new Error('too deep');
      const s = steps.get(target);
      if (!s || s.t === 'missing') throw new Error('incomplete');
      if (s.t === 'cmp') return { type: 'if', cond: { a: s.a, op: s.op, b: s.b }, then: to(s.yes, depth + 1), else: to(s.no, depth + 1) };
      if (s.t === 'higher') return { type: 'if', cond: { a: s.a, op: '>=', b: s.b }, then: to(s.aTo, depth + 1), else: to(s.bTo, depth + 1) };
      if (s.t === 'vote') return { type: 'if', cond: { need: s.need, of: s.conds.map(c => ({ a: c.a, op: c.op, b: c.b })) }, then: to(s.yes, depth + 1), else: to(s.no, depth + 1) };
      if (s.t === 'band') {
        let mid = to(s.mid, depth + 1);
        if (s.lo != null) mid = { type: 'if', cond: { a: s.a, op: '<', b: s.lo }, then: to(s.loTo, depth + 1), else: mid };
        if (s.hi != null) mid = { type: 'if', cond: { a: s.a, op: '>', b: s.hi }, then: to(s.hiTo, depth + 1), else: mid };
        return mid;
      }
      throw new Error('unknown step');
    };
    return to(sl.steps[0]?.id, 0);
  };
  try {
    const kids = spec.sleeves.map(sl => ({ ...sleeve(sl), name: sl.name, weight: +(sl.weight * 100).toFixed(4) }));
    const tot = kids.reduce((a, k) => a + k.weight, 0);
    if (tot < 99.99) kids.push({ type: 'cash', weight: +(100 - tot).toFixed(4) });
    return { ...pbBase, root: kids.length === 1 ? { ...kids[0], weight: undefined } : { type: 'group', name: 'Sleeves', weighting: 'specified', children: kids } };
  } catch { return null; }
}
