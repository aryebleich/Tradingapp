// News and sentiment: headline sentiment from a finance word list, social sentiment from StockTwits
// (bullish / bearish tags), an AI daily brief of the news for your symbols, and a short podcast
// script of it that the browser reads aloud. Works without an AI key (simpler brief).
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { one, run, now } from './db.js';
import { requireUser, rateLimit } from './auth.js';
import * as D from './alpaca/data.js';

const POS = 'beat beats beating surge surges soar soars soared record upgrade upgraded upgrades outperform outperforms growth grows grew profit profitable strong stronger gain gains rally rallies raise raises raised boost boosts bullish jump jumps jumped top tops exceed exceeds exceeded approve approved approval win wins won expand expands expansion buyback rebound rebounds recover recovery optimistic upbeat breakthrough partnership launch launches accelerate accelerates higher high-margin'.split(' ');
const NEG = 'miss misses missed plunge plunges plunged fall falls fell drop drops dropped downgrade downgraded downgrades lawsuit sue sued probe recall recalls loss losses weak weaker cut cuts layoffs layoff bearish slump slumps warn warns warning bankruptcy fraud decline declines declined delay delays halt halts investigation fine fined penalty default defaults lower slowdown slows crash crashes tumble tumbles sink sinks concern concerns risk risks downturn shortfall writedown impairment resign resigns'.split(' ');
const NOT = new Set(['not', 'no', "n't", 'never', 'without']);
const posSet = new Set(POS), negSet = new Set(NEG);

// -1 (negative) to +1 (positive); a negation within the two words before flips a hit.
export function scoreText(text) {
  const w = String(text || '').toLowerCase().replace(/[^a-z'\- ]/g, ' ').split(/\s+/).filter(Boolean);
  let p = 0, n = 0;
  w.forEach((x, i) => {
    const flip = NOT.has(w[i - 1]) || NOT.has(w[i - 2]) || /n't$/.test(w[i - 1] || '');
    if (posSet.has(x)) flip ? n++ : p++; else if (negSet.has(x)) flip ? p++ : n++;
  });
  return p + n ? +((p - n) / (p + n)).toFixed(2) : 0;
}
export const label = s => (s > 0.2 ? 'positive' : s < -0.2 ? 'negative' : 'neutral');

async function cached(key, ttl, fn) {
  const c = await one('SELECT v, at FROM cache WHERE k = ?', key);
  if (c && now() - c.at < ttl) return JSON.parse(c.v);
  const v = await fn();
  await run('INSERT INTO cache (k, v, at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at', key, JSON.stringify(v), now());
  return v;
}
const STOCKTWITS = () => (process.env.STOCKTWITS_URL || 'https://api.stocktwits.com/api/2').replace(/\/$/, '');
// Share of recent StockTwits posts tagged bullish, among those tagged at all.
export async function social(symbol) {
  return cached('st:' + symbol, 10 * 60e3, async () => {
    try {
      const r = await fetch(`${STOCKTWITS()}/streams/symbol/${encodeURIComponent(symbol.replace('/', '.'))}.json`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'QuantPocket' } });
      if (!r.ok) return { symbol, available: false };
      const d = await r.json(), msgs = d.messages || [];
      const bull = msgs.filter(m => m.entities?.sentiment?.basic === 'Bullish').length, bear = msgs.filter(m => m.entities?.sentiment?.basic === 'Bearish').length;
      return { symbol, available: true, posts: msgs.length, bullish: bull, bearish: bear, bullishPct: bull + bear ? Math.round(bull / (bull + bear) * 100) : null, watchers: d.symbol?.watchlist_count ?? null };
    } catch { return { symbol, available: false }; }
  });
}

export async function sentiment(symbols) {
  const news = D.dataEnabled() ? await D.news({ symbols, limit: 40 }).catch(() => []) : [];
  const items = news.map(n => { const s = scoreText(`${n.headline} ${n.summary || ''}`); return { id: n.id, headline: n.headline, summary: n.summary, url: n.url, source: n.source, at: n.created_at, symbols: n.symbols, score: s, label: label(s) }; });
  const bySymbol = await Promise.all(symbols.map(async sym => {
    const mine = items.filter(i => i.symbols?.includes(sym)), avg = mine.length ? mine.reduce((a, i) => a + i.score, 0) / mine.length : null;
    return { symbol: sym, articles: mine.length, newsScore: avg == null ? null : +avg.toFixed(2), newsLabel: avg == null ? null : label(avg), social: await social(sym) };
  }));
  return { newsAvailable: D.dataEnabled(), items, bySymbol };
}

let client;
export async function brief(symbols) {
  const s = await sentiment(symbols);
  const lines = s.items.slice(0, 25).map(i => `- [${i.label}] ${i.headline} (${(i.symbols || []).join(', ')}, ${i.source})`).join('\n');
  const soc = s.bySymbol.map(b => `${b.symbol}: news ${b.newsLabel || 'n/a'}, StockTwits ${b.social.bullishPct != null ? b.social.bullishPct + '% bullish' : 'n/a'}`).join('; ');
  if (!process.env.ANTHROPIC_API_KEY || !s.items.length) {
    const top = s.items.slice(0, 6);
    const text = top.length ? top.map(i => `- **${i.headline}** (${(i.symbols || []).join(', ')}) - ${i.label}`).join('\n') : 'No news found for these symbols right now.';
    const script = `Here is your QuantPocket market brief. ${top.map(i => i.headline + '.').join(' ')} Sentiment: ${soc}. That's the brief. Remember this is information, not advice.`;
    return { brief: text, script, sentiment: s, ai: false };
  }
  client ||= new Anthropic();
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 3000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['brief', 'script'], properties: { brief: { type: 'string', description: 'Markdown summary: 4-8 bullets grouped by theme, then one line on overall sentiment' }, script: { type: 'string', description: 'A 2-3 minute spoken podcast script for one host, plain sentences, no stage directions or markdown' } } } } },
    system: 'You write a short, neutral market news brief for a retail trader from the headlines given. Do not invent facts beyond them, do not give advice, mention sentiment only as reported.',
    messages: [{ role: 'user', content: `Symbols: ${symbols.join(', ')}\nSentiment: ${soc}\nHeadlines:\n${lines}` }],
  });
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined to write this brief'), { status: 502 });
  const out = JSON.parse(res.content.find(b => b.type === 'text').text);
  return { ...out, sentiment: s, ai: true };
}

export const sentimentRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const syms = req => String(req.query.symbols || req.body?.symbols || 'SPY,AAPL,NVDA,TSLA').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 12);
  r.get('/sentiment', async (req, res) => res.json(await sentiment(syms(req))));
  r.post('/brief', async (req, res) => {
    if (!rateLimit('brief:' + req.user.id, 12, 3600e3)) throw Object.assign(new Error('Too many briefs this hour'), { status: 429 });
    res.json(await brief(syms(req)));
  });
  return r;
})();
