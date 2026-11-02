// Blueprints: the library's strategy designs with the tickers taken out. Each one keeps the
// structure and the rules of one of the original strategies (kept for the owner in Admin →
// Original strategies), under a new name, with empty ticker slots the user fills:
//   leveraged slots ("L1", "L2", ...) for 2x/3x and volatility ETFs, and
//   ETF and stock slots ("E1", "E2", ...) for ordinary funds and shares.
// In the rules a slot is written "$L1" (an indicator on it, ["rsi", "$L1", 10]) and "@$L1" (buy it).
// List strategies (momentum, pullback, macro) take two lists instead: ETFs and stocks, and
// leveraged ETFs. When every slot has a ticker the design is turned into concrete rules that the
// engine runs exactly like any other strategy.
import { TEMPLATES } from './templates.js';
import { validSymbol } from '../brokers.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Leveraged and volatility ETFs (2x, 3x, inverse leveraged, VIX futures).
export const LEVERAGED = new Set('TQQQ SQQQ SPXL SPXS UPRO SPXU SSO SDS QLD QID TECL TECS SOXL SOXS FAS FAZ GDXU GDXD NUGT DUST TNA TZA LABU LABD TMF TMV UDOW SDOW UVXY UVIX SVXY SVIX VXX FNGU FNGD BULZ BERZ TSLL NVDL CURE DRN DRV YINN YANG ERX ERY BITX BITU USD SSG ROM REW UCO SCO BOIL KOLD'.split(' '));
export const isLeveraged = t => LEVERAGED.has(String(t || '').toUpperCase());
// What each original ticker did, so the empty slot says what kind of ticker belongs there.
const ROLE = {
  TQQQ: 'Leveraged Nasdaq-100, bull (e.g. 3x)', SQQQ: 'Leveraged Nasdaq-100, bear', SPXL: 'Leveraged S&P 500, bull', UPRO: 'Leveraged S&P 500, bull', SPXS: 'Leveraged S&P 500, bear',
  TECL: 'Leveraged technology, bull', TECS: 'Leveraged technology, bear', SOXL: 'Leveraged semiconductors, bull', FAS: 'Leveraged financials, bull', FAZ: 'Leveraged financials, bear',
  GDXU: 'Leveraged gold miners, bull', GDXD: 'Leveraged gold miners, bear', UVXY: 'Volatility (VIX futures), a hedge for sharp drops', UVIX: 'Volatility (VIX futures), a hedge for sharp drops',
  SPY: 'Broad US market index', QQQ: 'Nasdaq-100 index', IWM: 'Small-cap index', XLK: 'Technology sector', TLT: 'Long-term Treasury bonds', BND: 'Total bond market', BSV: 'Short-term bonds',
  BIL: 'T-bills (cash-like)', BTAL: 'Anti-beta / market-neutral hedge', PSQ: 'Inverse Nasdaq-100 (1x)', KMLM: 'Managed futures / trend', GLD: 'Gold', IBIT: 'Bitcoin fund',
};
const roleOf = t => ROLE[t] || (isLeveraged(t) ? 'Leveraged ETF' : 'ETF or stock');

// New names and plain descriptions for the designs.
const META = {
  bg_ensemble: { id: 'bp_regime_tree', name: 'Regime Decision Tree', tagline: 'Step-by-step tree: an exhaustion gate, then momentum chooses a fast risk-on path or a slow defensive path', about: 'Every day, walks a tree of comparisons from the top. An RSI exhaustion gate on one leveraged pair comes first; then momentum on a broad index decides between a fast path (a leveraged bull ETF, with a volatility hedge when it is overbought) and a slow path through bonds, sector ETFs and hedges. Holds one ticker at a time.' },
  multi_model: { id: 'bp_four_sleeve', name: 'Four-Sleeve Rotation', tagline: '4 independent models, each with a quarter of the money', about: 'Four separate small models each manage 25%: a trend model on a broad index, a sector model, a 3-index trend vote, and a second trend model with a defensive fallback. Each picks its own ticker every day.' },
  lev_etf_rotation: { id: 'bp_bull_bear_switch', name: 'Bull / Bear Switch', tagline: 'One leveraged ETF at 100%, switched by the market trend', about: 'Above the 200-day average (bull market): a leveraged bull ETF, unless the indexes are overbought, then a volatility hedge. Below it (bear market): buys oversold dips, otherwise rotates between bear ETFs and short-term bonds.' },
  gold_miner: { id: 'bp_exhaustion_fade', name: 'Exhaustion Fade', tagline: 'Fade RSI extremes on one pair, follow momentum otherwise', about: 'Sells strength and buys weakness when one leveraged pair is at an RSI extreme; otherwise follows index momentum against bonds. Some steps are left for you to write.' },
  cl_momentum: { id: 'bp_top_momentum', name: 'Top Momentum Pick', tagline: 'Holds the strongest performer of your list', about: 'Once a week, ranks your list by its return over the lookback and holds the strongest one (or the top few).' },
  pullback_mr: { id: 'bp_dip_buyer', name: 'Dip Buyer', tagline: 'Buys dips in an uptrend from your list, sells the bounce', about: 'Buys names from your list that are in a long uptrend but dipped below their lower Bollinger band with weak RSI; sells on the bounce, a trend break, or after a set number of days.' },
  macro_rotation: { id: 'bp_return_mix', name: 'Predicted-Return Mix', tagline: 'Weights your assets by their predicted return', about: 'Once a month, gives money only to the assets you expect to rise, in proportion to the prediction (typed by you, or a recent-return stand-in). One asset can be capped; the total never goes above 100%.' },
};

const clone = x => JSON.parse(JSON.stringify(x));
// Walks every ticker in a tree spec: fn(ticker) returns the replacement.
function mapTickers(spec, fn) {
  const m = x => (Array.isArray(x) ? [x[0], fn(x[1]), x[2]] : x);
  const to = x => (typeof x === 'string' && x.startsWith('@') ? '@' + fn(x.slice(1)) : x);
  for (const sl of spec.sleeves || []) for (const st of sl.steps) {
    for (const k of ['a', 'b']) if (st[k] !== undefined) st[k] = m(st[k]);
    for (const k of ['yes', 'no', 'hiTo', 'loTo', 'mid', 'aTo', 'bTo']) if (st[k] !== undefined) st[k] = to(st[k]);
    for (const c of st.conds || []) { c.a = m(c.a); c.b = m(c.b); }
  }
  return spec;
}

export function fromTemplate(t) {
  const meta = META[t.id] || { id: 'bp_' + t.id, name: t.name, tagline: t.tagline, about: t.about };
  const out = { id: meta.id, original: t.id, name: meta.name, tagline: meta.tagline, about: meta.about, kind: t.kind, rebalance: t.rebalance, risk: t.risk, ...(t.weekday ? { weekday: t.weekday } : {}) };
  if (t.kind === 'tree') {
    const slots = {}, keyOf = {}; let nl = 0, ne = 0;
    const spec = mapTickers(clone({ sleeves: t.sleeves }), tk => {
      if (!keyOf[tk]) { const lev = isLeveraged(tk), key = lev ? `L${++nl}` : `E${++ne}`; keyOf[tk] = key; slots[key] = { kind: lev ? 'lev' : 'etf', role: roleOf(tk), example: tk, ticker: '' }; }
      return '$' + keyOf[tk];
    });
    // Labels mention the original tickers; slots replace them.
    for (const sl of spec.sleeves) { sl.name = sl.name.replace(/:.*$/, ''); for (const st of sl.steps) if (st.label) st.label = st.label.replace(/\b[A-Z]{2,5}\b/g, x => (keyOf[x] ? '$' + keyOf[x] : x)); }
    Object.assign(out, { slots, sleeves: spec.sleeves });
  } else {
    const p = clone(t.params), list = p.universe || p.assets || [];
    const ex = { etf: list.filter(x => !isLeveraged(x)), lev: list.filter(isLeveraged) };
    if (t.kind === 'macro') { ex.predictions = p.predictions; ex.btc = p.btc; Object.assign(p, { assets: [], predictions: {}, btc: '' }); }
    else p.universe = [];
    Object.assign(out, { params: p, lists: { etf: [], lev: [] }, examples: ex });
  }
  return out;
}
export const BLUEPRINTS = TEMPLATES.map(fromTemplate);
export const blueprint = id => BLUEPRINTS.find(b => b.id === id);
export const blueprintsList = () => BLUEPRINTS.map(b => ({ id: b.id, name: b.name, tagline: b.tagline, about: b.about, kind: b.kind, rebalance: b.rebalance, risk: b.risk,
  slots: b.slots ? Object.entries(b.slots).map(([k, s]) => ({ key: k, kind: s.kind, role: s.role, example: s.example })) : null, examples: b.examples || null, sleeves: b.sleeves?.length || 0, steps: b.sleeves ? b.sleeves.reduce((a, s) => a + s.steps.length, 0) : 0 }));

// ---------- designs: slots → concrete rules ----------
const SLOT_RE = /^\$([LE]\d{1,2})$/;
export const isDesign = spec => !!(spec && (spec.slots || spec.lists));
// What is still empty, in plain words.
export function missingSlots(design) {
  if (!isDesign(design)) return [];
  if (design.slots) {
    const used = new Set();
    mapTickers(clone({ sleeves: design.sleeves }), t => { const m = SLOT_RE.exec(t); if (m) used.add(m[1]); return t; });
    return [...used].sort().filter(k => !design.slots[k]?.ticker).map(k => `${k} (${design.slots[k]?.role || (k.startsWith('L') ? 'leveraged ETF' : 'ETF or stock')})`);
  }
  const n = (design.lists.etf?.length || 0) + (design.lists.lev?.length || 0);
  return n ? [] : [design.kind === 'macro' ? 'the assets to hold' : 'the tickers to scan'];
}
// The design with the original tickers filled in (the "Fill with the examples" button).
export function withExamples(design) {
  const out = clone(design);
  if (out.slots) for (const sl of Object.values(out.slots)) if (!sl.ticker) sl.ticker = sl.example || '';
  if (out.lists && out.examples) {
    out.lists = { etf: out.lists.etf?.length ? out.lists.etf : out.examples.etf || [], lev: out.lists.lev?.length ? out.lists.lev : out.examples.lev || [] };
    if (out.kind === 'macro') { out.params.predictions = { ...(out.examples.predictions || {}), ...(out.params.predictions || {}) }; if (!out.params.btc) out.params.btc = out.examples.btc || ''; }
  }
  return out;
}
// Concrete rules for the engine (throws with what is missing).
export function materialize(design) {
  if (!isDesign(design)) return design;
  const miss = missingSlots(design);
  if (miss.length) throw bad(`Choose a ticker for: ${miss.join(', ')}`, 409);
  const out = clone(design);
  delete out.slots; delete out.lists; delete out.examples;
  if (design.slots) {
    mapTickers(out, t => { const m = SLOT_RE.exec(t); return m ? design.slots[m[1]].ticker : t; });
    for (const sl of out.sleeves) for (const st of sl.steps) if (st.label) st.label = st.label.replace(/\$([LE]\d{1,2})/g, (x, k) => design.slots[k]?.ticker || x);
  } else {
    const all = [...new Set([...(design.lists.etf || []), ...(design.lists.lev || [])])];
    if (design.kind === 'macro') { out.params.assets = all; out.params.predictions = Object.fromEntries(all.map(a => [a, design.params.predictions?.[a] ?? null])); }
    else out.params.universe = all;
  }
  return out;
}
// Cleans the slot part of a design sent by the browser; the rules are checked by validateSpec.
export function cleanSlots(design, base) {
  const out = { ...design };
  if (base.slots || design.slots) {
    const src = design.slots || base.slots, slots = {};
    for (const [k, s] of Object.entries(src || {}).slice(0, 40)) {
      if (!/^[LE]\d{1,2}$/.test(k)) throw bad(`Unknown slot ${k}`);
      const ticker = String(s?.ticker || '').trim().toUpperCase().replace(/^([A-Z]{2,6})USD$/, '$1/USD');
      if (ticker && !validSymbol(ticker) && !/^[A-Z0-9]{2,10}\/[A-Z]{3,4}$/.test(ticker)) throw bad(`"${s.ticker}" is not a valid ticker`);
      slots[k] = { kind: k.startsWith('L') ? 'lev' : 'etf', role: String(s?.role || base.slots?.[k]?.role || '').slice(0, 80), example: base.slots?.[k]?.example || s?.example || '', ticker };
    }
    out.slots = slots;
  }
  if (base.lists || design.lists) {
    const list = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).map(x => String(x).trim().toUpperCase()).filter(Boolean))].slice(0, 100);
    const lists = { etf: list(design.lists?.etf), lev: list(design.lists?.lev) };
    const wrong = [...lists.etf, ...lists.lev].find(t => !validSymbol(t));
    if (wrong) throw bad(`"${wrong}" is not a valid ticker`);
    out.lists = lists;
  }
  return out;
}
// Swaps slots for placeholder tickers so the shared rule checker can check a design, then back.
const PH = k => 'SLOT' + k;
export function withPlaceholders(design) {
  const out = clone(design);
  if (design.slots) mapTickers(out, t => { const m = SLOT_RE.exec(t); return m ? PH(m[1]) : t; });
  if (design.lists) { const ph = ['SLOTLIST']; if (design.kind === 'macro') { out.params.assets = ph; out.params.predictions = { SLOTLIST: null }; out.params.btc = null; } else out.params.universe = ph; }
  return out;
}
export function fromPlaceholders(spec, design) {
  const out = clone(spec);
  if (design.slots) mapTickers(out, t => { const m = /^SLOT([LE]\d{1,2})$/.exec(t); return m ? '$' + m[1] : t; });
  if (design.lists) { if (design.kind === 'macro') { out.params.assets = []; out.params.predictions = design.params?.predictions || {}; out.params.btc = design.params?.btc || ''; } else out.params.universe = []; }
  out.slots = design.slots; out.lists = design.lists; if (design.examples) out.examples = design.examples;
  return out;
}
