// The chart co-pilot: a question about a chart in plain words ("Highlight all head-and-shoulders
// patterns from the last quarter and cross-reference with short interest spikes") becomes drawings
// on the chart and a short answer. It finds the patterns, support and resistance zones and
// trendlines (public/chartai.js), adds the strikes with the most option open interest, and checks
// the asked period against short-sale and off-exchange volume spikes (FINRA's daily files cover
// about the last five weeks). Every point is given by date, so the chart places it on its own bars.
import express from 'express';
import { requireUser } from './auth.js';
import { aiLimits, useQuota } from './aiplans.js';
import { analyze, parsePrompt } from '../public/chartai.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const NAMES = { hs: 'head and shoulders', ihs: 'inverse head and shoulders', dtop: 'double top', dbottom: 'double bottom', asc: 'ascending triangle', desc: 'descending triangle', sym: 'symmetrical triangle' };

async function barsFor(symbol, userId) {
  const D = await import('./alpaca/data.js');
  if (D.dataEnabled()) {
    try { const r = (await D.bars([symbol], { timeframe: '1Day', start: new Date(Date.now() - 3 * 365 * 864e5).toISOString(), limit: 10000 }))?.[symbol]; if (r?.length > 60) return { bars: r.map(x => ({ t: Date.parse(x.t), o: x.o, h: x.h, l: x.l, c: x.c })), ohlc: true }; } catch {}
  }
  const { getBars } = await import('./brokers.js'), b = await getBars(symbol, new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10), userId);
  return { bars: b.closes.map((c, i) => ({ t: Date.parse(b.dates[i]), o: c, h: c, l: c, c })), ohlc: false };
}

export async function optionLevels(symbol) {
  const D = await import('./alpaca/data.js'); if (!D.dataEnabled()) return null;
  const chain = await D.optionChain(symbol).catch(() => null); if (!chain?.contracts?.length) return null;
  const by = {}; for (const c of chain.contracts) { const k = c.type + ':' + c.strike; by[k] = (by[k] || 0) + (c.openInterest || 0); }
  const top = type => Object.entries(by).filter(([k]) => k.startsWith(type)).map(([k, oi]) => ({ strike: +k.split(':')[1], oi })).filter(x => x.oi > 0).sort((a, b) => b.oi - a.oi).slice(0, 3);
  return { calls: top('call'), puts: top('put') };
}

export async function ask(user, symbol, prompt) {
  const want = parsePrompt(prompt), { bars, ohlc } = await barsFor(symbol, user.id);
  const from = want.days ? Math.max(0, bars.length - want.days) : Math.max(0, bars.length - 252);
  const a = analyze(bars, { from }), T = i => bars[Math.max(0, Math.min(bars.length - 1, i))].t;
  const pats = a.patterns.filter(p => want.patterns.includes(p.key) && p.to >= from);
  const out = { symbol, ask: want, from: T(from), ohlc, zones: [], trendlines: [], patterns: [], options: null, short: null };
  if (want.zones) out.zones = a.zones.map(z => ({ ...z, from: T(z.from), to: T(z.to) }));
  if (want.trendlines) out.trendlines = a.trendlines.map(l => ({ ...l, a: { t: T(l.a.i), p: l.a.p }, b: { t: T(l.b.i), p: l.b.p } }));
  out.patterns = pats.map(p => ({ name: p.name, key: p.key, bias: p.bias, from: T(p.from), to: T(p.to), neckline: p.neckline ?? null, points: p.points.map(q => ({ t: T(q.i), p: q.p })) }));
  if (want.options) out.options = await optionLevels(symbol).catch(() => null);
  if (want.short) {
    try {
      const { darkPool } = await import('./intel.js'), d = await darkPool(symbol);
      const sp = d.days.map(x => x.shortPct).filter(x => x != null), avg = sp.reduce((s, x) => s + x, 0) / Math.max(1, sp.length);
      const spikes = d.days.filter(x => (x.shortPct != null && x.shortPct > avg + 8) || x.spike).map(x => ({ day: x.day, shortPct: x.shortPct, offExchange: x.offExchange }));
      const covered = Date.parse(d.days[0].day);
      for (const p of out.patterns) p.shortSpikes = p.to < covered ? null : spikes.filter(s => Date.parse(s.day) >= p.from - 5 * 864e5 && Date.parse(s.day) <= p.to + 10 * 864e5).map(s => s.day);
      out.short = { avgShortPct: +avg.toFixed(1), spikes, coveredFrom: d.days[0].day };
    } catch (e) { out.short = { error: e.message }; }
  }
  // The answer in plain words.
  const lines = [];
  if (want.patterns.length) {
    const asked = want.patterns.map(k => NAMES[k]).join(', ');
    lines.push(pats.length ? `Found ${pats.length} ${pats.length === 1 ? 'pattern' : 'patterns'} (${asked}) ${want.days ? `in the last ${want.days} trading days` : 'in the last year'}: ${out.patterns.map(p => `${p.name} ${new Date(p.from).toISOString().slice(0, 10)} to ${new Date(p.to).toISOString().slice(0, 10)}${p.neckline ? ` (neckline ${p.neckline})` : ''}`).join('; ')}.` : `No ${asked} ${want.days ? `in the last ${want.days} trading days` : 'in the last year'}.`);
  }
  if (out.zones.length) lines.push(`Nearest support: ${out.zones.filter(z => z.kind === 'support').slice(0, 2).map(z => `${z.lo}–${z.hi} (${z.touches} touches)`).join(', ') || 'none found'}. Nearest resistance: ${out.zones.filter(z => z.kind === 'resistance').slice(0, 2).map(z => `${z.lo}–${z.hi} (${z.touches} touches)`).join(', ') || 'none found'}.`);
  if (out.trendlines.length) lines.push(out.trendlines.map(l => `${l.kind === 'support' ? 'Rising support' : 'Falling resistance'} trendline${l.broken ? ' (broken)' : ''} at ${l.b.p.toFixed(2)} now.`).join(' '));
  if (want.options) lines.push(out.options ? `Most open interest: calls at ${out.options.calls.map(x => x.strike).join(', ') || '-'}; puts at ${out.options.puts.map(x => x.strike).join(', ') || '-'}.` : 'Option levels need the Alpaca market-data connection.');
  if (want.short && out.short && !out.short.error) {
    const hit = out.patterns.filter(p => p.shortSpikes?.length);
    lines.push(`Short-sale volume averaged ${out.short.avgShortPct}% of off-exchange volume since ${out.short.coveredFrom}; ${out.short.spikes.length} spike day${out.short.spikes.length === 1 ? '' : 's'}${out.short.spikes.length ? ` (${out.short.spikes.slice(-4).map(s => s.day).join(', ')})` : ''}.${out.patterns.length ? ` ${hit.length ? `${hit.length} of the patterns line up with a spike.` : 'None of the patterns line up with a spike.'}` : ''} FINRA's daily files reach back about five weeks; reported short interest (twice a month) is not included.`);
  } else if (want.short && out.short?.error) lines.push('Short-volume data was not available just now.');
  if (!ohlc) lines.push('Using daily closes only: connect a market-data source for full candles.');
  out.answer = lines.join(' ');
  return out;
}

export const chartCopilotRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.post('/ask', async (req, res) => {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase(), prompt = String(req.body?.prompt || '').slice(0, 500);
    if (!/^[A-Z][A-Z0-9.\/-]{0,14}$/.test(symbol)) throw bad('Open a chart first');
    if (prompt.trim().length < 3) throw bad('Ask a question about the chart');
    const left = await useQuota(req.user, 'copilot', aiLimits(req.user).copilot, 'day', 'Chart co-pilot questions');
    res.json({ ...(await ask(req.user, symbol, prompt)), left });
  });
  return r;
})();
