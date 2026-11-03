// Plain-language research: find stocks by numbers you can check (size, price vs earnings, growth,
// profit margin, sector), and short summaries of a company's latest SEC filing and news. Every
// summary links to the original source with its date, and says it is a summary, not advice.
import express from 'express';
import { requireUser, rateLimit } from './auth.js';
import { screen, fiscalYear } from './fundamentals.js';
import { filing } from './research.js';
import { sectorOf } from './portfoliorisk.js';
import { spend } from './credits.js';
import { validSymbol } from './brokers.js';
import * as D from './alpaca/data.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const sym = s => { const x = String(s || '').trim().toUpperCase(); if (!validSymbol(x)) throw bad('Type a stock symbol, e.g. AAPL'); return x; };
const SUMMARY_RULES = 'Write for a beginner in short, plain sentences. Only use facts in the text given; never guess numbers. Do not tell the reader to buy or sell and never promise or predict returns. Keep each item under 30 words.';

// The criteria the screener offers, with what each one means in plain words.
export const CRITERIA = [
  { id: 'marketCap', name: 'Company size (market value)', unit: '$B', scale: 1e9, about: 'What the whole company is worth on the stock market: share price × number of shares.' },
  { id: 'pe', name: 'Price / earnings (P/E)', unit: 'x', about: 'How many dollars you pay for $1 of yearly profit. Lower can mean cheaper; very low can mean trouble.' },
  { id: 'pb', name: 'Price / book (P/B)', unit: 'x', about: 'Price compared with what the company owns minus what it owes.' },
  { id: 'ps', name: 'Price / sales (P/S)', unit: 'x', about: 'Price compared with a year of sales; useful when a company has no profit yet.' },
  { id: 'netMargin', name: 'Profit margin', unit: '%', about: 'Of every $100 of sales, how much is left as profit.' },
  { id: 'revenueGrowth', name: 'Sales growth (last year)', unit: '%', about: 'How much more the company sold than the year before.' },
  { id: 'epsGrowth', name: 'Earnings growth (last year)', unit: '%', about: 'How much profit per share grew compared with the year before.' },
];

// Keep only the rows that match every filter: { key: [min, max] } in display units, plus sectors.
export function applyCriteria(rows, filters = {}, sectors = []) {
  return rows.filter(r => {
    if (sectors.length && !sectors.includes(r.sector)) return false;
    for (const c of CRITERIA) {
      const f = filters[c.id]; if (!f) continue;
      const [lo, hi] = f, v = r[c.id] == null ? null : r[c.id] / (c.scale || 1);
      if ((lo != null || hi != null) && v == null) return false;
      if (lo != null && v < lo) return false;
      if (hi != null && v > hi) return false;
    }
    return true;
  });
}

export const plainResearchRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/screen', async (req, res) => {
    const d = await screen(req.user.id).catch(e => ({ unavailable: true, message: 'Company financials from the SEC are not available right now; try again in a few minutes.', detail: String(e.message).slice(0, 120), all: [], year: fiscalYear() }));
    const rows = (d.all || []).map(x => ({ symbol: x.symbol, name: x.name, price: x.price, marketCap: x.marketCap, pe: x.pe, pb: x.pb, ps: x.ps, netMargin: x.netMargin, revenueGrowth: x.revenueGrowth, epsGrowth: x.epsGrowth, style: x.style, sector: sectorOf(x.symbol) }));
    res.json({ unavailable: !!d.unavailable, message: d.message, year: d.year, at: d.at, rows, criteria: CRITERIA, sectors: [...new Set(rows.map(x => x.sector))].sort(),
      source: { name: 'SEC EDGAR company filings (XBRL frames)', url: 'https://www.sec.gov/edgar/search/' } });
  });

  // The latest 10-K or 10-Q in plain words, with a link to the filing and its date.
  r.get('/filing/:symbol', async (req, res) => {
    if (!rateLimit('filing:' + req.user.id, 30, 3600e3)) throw bad('Too many summaries this hour', 429);
    const s = sym(req.params.symbol), form = req.query.form === '10-Q' ? '10-Q' : '10-K';
    const f = await filing(s, form).catch(e => { throw bad(e.message, 404); });
    const base = { symbol: s, company: f.company, form, filed: f.filed, period: f.period, url: f.url, excerpts: { business: f.business.slice(0, 900), riskFactors: f.riskFactors.slice(0, 900), mdna: f.mdna.slice(0, 900) } };
    const { llmEnabled, jsonCall } = await import('./llm.js');
    if (!llmEnabled()) return res.json({ ...base, summary: null, note: 'AI summaries are off on this server; here are the opening lines of each section.' });
    await spend(req.user, 'filing', { memo: s });
    const summary = await jsonCall({
      system: `You summarize a US company's SEC filing. ${SUMMARY_RULES}`,
      user: `${f.company} ${form} filed ${f.filed} for the period ending ${f.period}.\n\nBUSINESS:\n${f.business}\n\nRISK FACTORS:\n${f.riskFactors}\n\nMANAGEMENT DISCUSSION:\n${f.mdna}`,
      schema: { type: 'object', additionalProperties: false, required: ['plain', 'business', 'risks', 'numbers', 'watch'], properties: {
        plain: { type: 'string', description: 'Two or three sentences: what this company does and how the period went.' },
        business: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } }, numbers: { type: 'array', items: { type: 'string' }, description: 'Key figures exactly as stated in the text.' }, watch: { type: 'array', items: { type: 'string' }, description: 'Things the company itself says to watch.' } } },
      maxTokens: 1500,
    });
    res.json({ ...base, summary });
  });

  // News for a symbol: every headline with its source, link and time, plus a short neutral summary
  // that points to the headlines it used by number.
  r.get('/news/:symbol', async (req, res) => {
    if (!rateLimit('rnews:' + req.user.id, 60, 3600e3)) throw bad('Too many news lookups this hour', 429);
    const s = String(req.params.symbol || '').trim().toUpperCase();
    if (!validSymbol(s) && !/^[A-Z0-9]{2,10}\/[A-Z]{3,4}$/.test(s)) throw bad('Type a symbol, e.g. AAPL');
    if (!D.dataEnabled()) return res.json({ symbol: s, items: [], unavailable: true, message: 'News needs a market-data connection (an Alpaca account or the server\'s Alpaca data key).' });
    const items = (await D.news({ symbols: s, limit: 15 }).catch(() => [])).map((n, i) => ({ n: i + 1, headline: n.headline, summary: n.summary || '', source: n.source, url: n.url, at: n.created_at }));
    const { llmEnabled, jsonCall } = await import('./llm.js');
    let summary = null;
    if (items.length && llmEnabled() && req.query.summary !== '0') {
      summary = await jsonCall({
        system: `You summarize news headlines about one stock. ${SUMMARY_RULES} Each point must cite the headline numbers it comes from.`,
        user: items.map(i => `[${i.n}] ${i.at?.slice(0, 10)} ${i.source}: ${i.headline}. ${i.summary.slice(0, 300)}`).join('\n'),
        schema: { type: 'object', additionalProperties: false, required: ['points'], properties: { points: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'refs'], properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'integer' } } } } } } },
        maxTokens: 800,
      }).catch(() => null);
      if (summary) summary.points = summary.points.slice(0, 6).map(p => ({ text: p.text, refs: p.refs.filter(n => n >= 1 && n <= items.length) }));
    }
    res.json({ symbol: s, items, summary });
  });
  return r;
})();
