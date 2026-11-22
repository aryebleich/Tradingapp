// Diversification with AI (Track & plan → Risk → Diversification): a score from sector, region, asset
// type, single-holding weight, fund overlap and correlation, and up to three suggestions. Each comes
// with "why" and a preview of the account before and after: it is never an order. Pro gets every
// suggestion; free members see the score and the first suggestion. Education, not advice.
import express from 'express';
import { requireUser } from './auth.js';
import { accountSummary, getBars } from './brokers.js';
import { classify } from './wealth.js';
import { isPaid } from './fees.js';

const r1 = x => +(+x).toFixed(1);
const BROAD = new Set(['Broad US market', 'Broad world market']);
// Funds that track the same or largely the same stocks.
const INDEX_OF = { SPY: 'S&P 500', VOO: 'S&P 500', IVV: 'S&P 500', SPLG: 'S&P 500', VTI: 'US total market', ITOT: 'US total market', QQQ: 'Nasdaq-100', QQQM: 'Nasdaq-100', VT: 'World', VXUS: 'World ex-US', VEA: 'Developed ex-US', IEFA: 'Developed ex-US', EFA: 'Developed ex-US' };
const CONTAINS = { 'US total market': ['S&P 500', 'Nasdaq-100'], 'S&P 500': ['Nasdaq-100'], World: ['S&P 500', 'US total market', 'Nasdaq-100', 'World ex-US', 'Developed ex-US'], 'World ex-US': ['Developed ex-US'] };
const typeOf = (sym, sector) => (sym.includes('/') ? 'Crypto' : sector === 'Bonds' ? 'Bonds' : sector === 'Cash & T-bills' ? 'Cash' : sector === 'Gold & commodities' ? 'Commodities' : sector === 'Real estate' ? 'Real estate' : 'Stocks');
export const NOTE = 'Education, not investment advice. A preview shows what the account would look like; it never places an order.';

// Overlapping funds: the same index held twice, or a fund that already contains another.
export function overlaps(symbols) {
  const held = symbols.filter(s => INDEX_OF[s]), out = [];
  for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
    const a = INDEX_OF[held[i]], b = INDEX_OF[held[j]];
    if (a === b) out.push({ a: held[i], b: held[j], why: `${held[i]} and ${held[j]} both track the ${a}: holding both adds nothing.` });
    else if (CONTAINS[a]?.includes(b) || CONTAINS[b]?.includes(a)) { const big = CONTAINS[a]?.includes(b) ? held[i] : held[j], small = big === held[i] ? held[j] : held[i]; out.push({ a: big, b: small, why: `${big} already holds most of what ${small} holds.` }); }
  }
  return out;
}
// Average pairwise correlation of daily returns (the largest holdings with price history).
export function avgCorrelation(series) {
  const keys = Object.keys(series).filter(k => series[k]?.length > 60); if (keys.length < 2) return null;
  const rets = Object.fromEntries(keys.map(k => { const c = series[k].slice(-253); return [k, c.slice(1).map((x, i) => x / c[i] - 1)]; }));
  const corr = (x, y) => { const n = Math.min(x.length, y.length); const a = x.slice(-n), b = y.slice(-n); const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0; };
  let s = 0, n = 0; for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { s += corr(rets[keys[i]], rets[keys[j]]); n++; }
  return n ? +(s / n).toFixed(2) : null;
}
// holdings: [{ symbol, value, sector, region }]. Returns the score, its parts and the breakdowns.
export function score(holdings, { correlation = null } = {}) {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (!(total > 0)) return { score: null, parts: [], total: 0, note: 'Nothing held yet.' };
  const pct = v => v / total * 100, group = key => { const g = {}; for (const h of holdings) g[h[key]] = (g[h[key]] || 0) + h.value; return Object.entries(g).map(([name, v]) => ({ name, pct: r1(pct(v)) })).sort((a, b) => b.pct - a.pct); };
  const sectors = group('sector'), regions = group('region'), types = group('type');
  const single = holdings.filter(h => !BROAD.has(h.sector) && h.sector !== 'Bonds').sort((a, b) => b.value - a.value)[0];
  const maxOne = single ? pct(single.value) : 0, topSector = sectors.find(s => !BROAD.has(s.name) && s.name !== 'Bonds'), us = regions.find(r => r.name === 'United States')?.pct || 0, ov = overlaps(holdings.map(h => h.symbol));
  const parts = [
    { name: 'Largest single holding', points: maxOne <= 10 ? 25 : maxOne <= 25 ? 15 : maxOne <= 40 ? 5 : 0, of: 25, detail: single ? `${single.symbol} is ${r1(maxOne)}% of the account` : 'Only funds' },
    { name: 'Largest sector', points: !topSector || topSector.pct <= 25 ? 20 : topSector.pct <= 40 ? 10 : 0, of: 20, detail: topSector ? `${topSector.name}: ${topSector.pct}%` : 'Spread through broad funds' },
    { name: 'Countries', points: us <= 80 ? 15 : us <= 95 ? 8 : 3, of: 15, detail: `${r1(us)}% in the United States` },
    { name: 'Kinds of assets', points: types.length >= 3 ? 15 : types.length === 2 ? 10 : 4, of: 15, detail: types.map(t => `${t.name} ${t.pct}%`).join(', ') },
    { name: 'How alike they move', points: correlation == null ? 8 : correlation < 0.4 ? 15 : correlation < 0.6 ? 9 : correlation < 0.8 ? 4 : 0, of: 15, detail: correlation == null ? 'Not enough price history' : `average correlation ${correlation} (1 = always together)` },
    { name: 'Fund overlap', points: ov.length ? 3 : 10, of: 10, detail: ov.length ? ov.map(o => o.why).join(' ') : 'No funds that hold the same stocks' },
  ];
  const s = parts.reduce((a, p) => a + p.points, 0);
  return { score: s, label: s >= 75 ? 'Well spread' : s >= 50 ? 'Partly spread' : 'Concentrated', parts, sectors, regions, types, overlaps: ov, single: single ? { symbol: single.symbol, pct: r1(maxOne) } : null, us: r1(us), total };
}
// Up to three suggestions, the clearest first. A preview moves dollars from one holding to another
// on paper and scores the result.
export function suggestions(holdings, sc) {
  const total = sc.total, out = [], has = s => holdings.some(h => h.symbol === s);
  if (sc.single && sc.single.pct > 25) { const dollars = Math.round(total * (sc.single.pct - 20) / 100); out.push({ title: `Trim ${sc.single.symbol} to about 20%`, why: `${sc.single.symbol} is ${sc.single.pct}% of the account: one company's bad news would hit most of your money.`, sell: { symbol: sc.single.symbol, dollars }, buy: { symbol: has('VTI') ? 'VTI' : 'VT', dollars } }); }
  const top = sc.sectors.find(s => !BROAD.has(s.name) && s.name !== 'Bonds');
  if (top && top.pct > 40 && !out.length) { const from = holdings.filter(h => h.sector === top.name).sort((a, b) => b.value - a.value)[0]; out.push({ title: `Spread out of ${top.name}`, why: `${top.pct}% is in ${top.name}; a downturn in one industry would hit most of the account.`, sell: { symbol: from.symbol, dollars: Math.round(total * 0.1) }, buy: { symbol: 'VT', dollars: Math.round(total * 0.1) } }); }
  if (sc.us > 95 && !has('VXUS') && !has('VT')) out.push({ title: 'Add countries outside the US', why: `${sc.us}% is in US companies. An international fund spreads the risk across countries.`, sell: null, buy: { symbol: 'VXUS', dollars: Math.round(total * 0.15) }, fromCash: true });
  for (const o of sc.overlaps.slice(0, 1)) { const b = holdings.find(h => h.symbol === o.b); if (b) out.push({ title: `Combine ${o.b} into ${o.a}`, why: o.why + ' Combining them keeps the same exposure with fewer moving parts.', sell: { symbol: o.b, dollars: Math.round(b.value) }, buy: { symbol: o.a, dollars: Math.round(b.value) } }); }
  if (!sc.types.some(t => t.name === 'Bonds') && out.length < 3) out.push({ title: 'Consider a bond fund for steadier swings', why: 'Everything is in stocks (or similar). Bonds usually swing less, so a slice of them softens drops, at the cost of lower expected growth.', sell: null, buy: { symbol: 'BND', dollars: Math.round(total * 0.1) }, fromCash: true });
  return out.slice(0, 3).map(s => ({ ...s, preview: preview(holdings, s) }));
}
const CLASSES = { VT: ['Broad world market', 'Global'], VTI: ['Broad US market', 'United States'], VXUS: ['Broad world market', 'International'], BND: ['Bonds', 'United States'] };
export function preview(holdings, s) {
  const after = holdings.map(h => ({ ...h }));
  if (s.sell) { const h = after.find(x => x.symbol === s.sell.symbol); if (h) h.value = Math.max(0, h.value - s.sell.dollars); }
  if (s.buy) { const h = after.find(x => x.symbol === s.buy.symbol); if (h) h.value += s.buy.dollars; else { const [sector, region] = CLASSES[s.buy.symbol] || ['Other', 'Unknown']; after.push({ symbol: s.buy.symbol, value: s.buy.dollars, sector, region, type: typeOf(s.buy.symbol, sector) }); } }
  const before = score(holdings), now = score(after.filter(h => h.value > 0));
  return { scoreBefore: before.score, scoreAfter: now.score, topBefore: before.sectors[0], topAfter: now.sectors[0], usBefore: before.us, usAfter: now.us, cashNeeded: s.fromCash ? s.buy.dollars : 0 };
}

export const diversifyRouter = (() => {
  const r = express.Router(); r.use(requireUser);
  r.get('/', async (req, res) => {
    try {
      const account = String(req.query.account || 'paper'), sum = await accountSummary(req.user.id, account);
      const pos = (sum.positions || []).filter(p => +p.value > 0);
      const holdings = await Promise.all(pos.map(async p => { const [sector, region] = await classify(p.symbol).catch(() => ['Other', 'Unknown']); return { symbol: p.symbol, value: +p.value, sector, region, type: typeOf(p.symbol, sector) }; }));
      const start = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10), series = {};
      await Promise.all([...holdings].sort((a, b) => b.value - a.value).slice(0, 8).map(async h => { const b = await getBars(h.symbol, start, req.user.id).catch(() => null); if (b) series[h.symbol] = b.closes; }));
      const sc = score(holdings, { correlation: avgCorrelation(series) }), all = sc.score == null ? [] : suggestions(holdings, sc), paid = isPaid(req.user);
      res.json({ account, ...sc, holdings, suggestions: paid ? all : all.slice(0, 1), more: paid ? 0 : Math.max(0, all.length - 1), paid, cash: sum.cash, note: NOTE });
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not read this account right now.' }); }
  });
  return r;
})();
