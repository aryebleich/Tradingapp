// Market intelligence: the unstructured and institutional data traders read, turned into answers.
//   - AI earnings-call summaries: paste a transcript (or a long filing), get the numbers,
//     guidance, risks, tone and the questions analysts pressed on. Long texts are summarized in
//     parts, then together. Without an AI model the key sentences and numbers are extracted.
//   - Unusual options flow: contracts trading far above their open interest, with the premium paid
//     (from the options chain; real time, 15-minute delay or end of day by plan).
//   - Dark-pool (off-exchange) activity: daily volume reported to FINRA's trade-reporting
//     facilities (where dark pools and wholesalers report) and its short share, from FINRA's free
//     daily Reg SHO files; spikes above the 20-day average are flagged.
//   - Whale wallets: large Bitcoin and Ethereum addresses the user follows; big moves are alerted.
//   - Ask in plain words: "unusual options on NVDA", "dark pool activity in AAPL", "summarize this
//     call" — the question is routed to the right tool.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { aiLimits, upgrade, useQuota } from './aiplans.js';
import { nyTime } from './time.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const ticker = s => { const x = String(s || '').trim().toUpperCase(); if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(x)) throw bad('Give a valid symbol'); return x; };

// ---------- earnings-call summaries ----------
const KEY = /\b(revenue|sales|guidance|outlook|expect|forecast|margin|earnings per share|eps|growth|grew|declin|record|raise|lower|headwind|tailwind|demand|backlog|buyback|repurchase|dividend|free cash flow|operating income|net income|bookings|subscribers|users|customers|ai\b|tariff|inflation|capex|capital expenditure)/i;
export function extractive(text, max = 14) {
  const sentences = String(text).replace(/\s+/g, ' ').match(/[^.!?]{20,400}[.!?]/g) || [];
  const scored = sentences.map((s, i) => ({ s: s.trim(), i, score: (KEY.test(s) ? 3 : 0) + (s.match(/\$?\d[\d,.]*\s*(%|percent|billion|million|bps|basis points)/gi) || []).length * 2 + (/(we expect|guidance|outlook|for the (full )?year|next quarter)/i.test(s) ? 3 : 0) }));
  const top = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.i - b.i).map(x => x.s);
  const numbers = [...new Set((String(text).match(/\$?\d[\d,.]*\s*(?:%|percent|billion|million|bps)/gi) || []).slice(0, 30))];
  const guidance = top.filter(s => /(expect|guidance|outlook|forecast|next quarter|full year|fiscal)/i.test(s)).slice(0, 5);
  const risks = sentences.filter(s => /(risk|headwind|uncertain|pressure|declin|challeng|tariff|slowdown|weak)/i.test(s)).slice(0, 5).map(s => s.trim());
  const pos = (text.match(/\b(strong|record|growth|grew|expanded|raising|raised|increase[ds]?|exceeded|beat|momentum|confident|accelerat)/gi) || []).length, neg = (text.match(/\b(weak|declin|miss|headwind|challeng|pressure|slow|uncertain)/gi) || []).length;
  return { highlights: top.slice(0, 8), keyNumbers: numbers.slice(0, 15), guidance, risks, tone: pos > neg * 1.5 ? 'Confident' : neg > pos * 1.5 ? 'Cautious' : 'Mixed', analystQuestions: sentences.filter(s => /\?/.test(s) || /(question|could you|can you)/i.test(s)).slice(0, 5).map(s => s.trim()), by: 'key sentences (no AI model set up)' };
}
const SUMMARY = { type: 'object', properties: { highlights: { type: 'array', items: { type: 'string' } }, keyNumbers: { type: 'array', items: { type: 'string' } }, guidance: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } }, tone: { type: 'string' }, analystQuestions: { type: 'array', items: { type: 'string' } } }, required: ['highlights', 'keyNumbers', 'guidance', 'risks', 'tone'] };
export async function summarize(text, title = '') {
  const { llmEnabled, jsonCall } = await import('./llm.js');
  if (!llmEnabled()) return extractive(text);
  const parts = []; for (let i = 0; i < text.length; i += 24000) parts.push(text.slice(i, i + 24000));
  const sys = 'You summarize earnings calls for investors in plain English: exact figures with units, guidance as stated, risks management named, tone, and the questions analysts pressed on. Never invent numbers.';
  try {
    const each = [];
    for (const [k, p] of parts.slice(0, 12).entries()) each.push(await jsonCall({ system: sys, user: `${title ? title + ' — ' : ''}part ${k + 1} of ${Math.min(parts.length, 12)}:\n\n${p}`, schema: SUMMARY, maxTokens: 1200 }));
    const merged = each.length === 1 ? each[0] : await jsonCall({ system: sys + ' Merge these part summaries into one, without repeating.', user: JSON.stringify(each), schema: SUMMARY, maxTokens: 1500 });
    return { ...merged, by: 'AI' };
  } catch { return extractive(text); }
}

// ---------- unusual options flow ----------
const flowCache = new Map();
export function unusual(contracts, spot) {
  return contracts.filter(c => (c.volume || 0) >= 100 && (c.volume || 0) >= 1.5 * Math.max(1, c.openInterest || 0))
    .map(c => { const mid = c.bid && c.ask ? (c.bid + c.ask) / 2 : c.last || 0; return { symbol: c.symbol, type: c.type, strike: c.strike, expiration: c.expiration, volume: c.volume, openInterest: c.openInterest || 0, ratio: +(c.volume / Math.max(1, c.openInterest || 0)).toFixed(1), premium: Math.round(c.volume * mid * 100), iv: c.iv ? +(c.iv * 100).toFixed(1) : null, moneyness: spot ? (c.type === 'call' ? (c.strike > spot ? 'out of the money' : 'in the money') : (c.strike < spot ? 'out of the money' : 'in the money')) : null }; })
    .sort((a, b) => b.premium - a.premium).slice(0, 25);
}
async function optionsFlow(user, symbol) {
  const lim = aiLimits(user), D = await import('./alpaca/data.js');
  if (!D.dataEnabled()) throw bad('Options flow needs the Alpaca market-data connection (Admin → Market data).', 503);
  const ttl = { realtime: 30e3, delayed: 15 * 60e3, eod: 6 * 3600e3 }[lim.optionsFlow], key = symbol + ':' + lim.optionsFlow, hit = flowCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const { lastPrice } = await import('./brokers.js');
  const [chain, spot] = await Promise.all([D.optionChain(symbol), lastPrice(symbol, user.id).catch(() => null)]);
  const rows = unusual(chain.contracts, spot), calls = rows.filter(r => r.type === 'call').reduce((a, r) => a + r.premium, 0), puts = rows.filter(r => r.type === 'put').reduce((a, r) => a + r.premium, 0);
  const v = { symbol, spot, at: Date.now(), freshness: lim.optionsFlow, rows, callPremium: calls, putPremium: puts, lean: calls > puts * 1.5 ? 'Bullish (more call premium)' : puts > calls * 1.5 ? 'Bearish (more put premium)' : 'Mixed' };
  flowCache.set(key, { at: Date.now(), v });
  return v;
}

// ---------- dark-pool (off-exchange) activity, from FINRA's daily files ----------
const FINRA = () => (process.env.FINRA_CDN_URL || 'https://cdn.finra.org/equity/regsho/daily').replace(/\/$/, '');
const dayFiles = new Map();
export function parseRegSho(text) {
  const m = new Map();
  for (const line of String(text).split('\n').slice(1)) { const [, sym, short, , total] = line.split('|'); if (sym && +total > 0) m.set(sym.trim(), { short: +short, total: +total }); }
  return m;
}
async function finraDay(kind, ymd) {
  const key = kind + ymd; if (dayFiles.has(key)) return dayFiles.get(key);
  const r = await fetch(`${FINRA()}/${kind}shvol${ymd}.txt`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r) throw bad('FINRA could not be reached just now; try again later.', 503);
  const v = r.ok ? parseRegSho(await r.text()) : null;
  if (v || (r && r.status === 404)) { dayFiles.set(key, v); if (dayFiles.size > 120) dayFiles.delete(dayFiles.keys().next().value); }
  return v;
}
export async function darkPool(symbol, days = 25) {
  const out = []; let d = new Date(Date.parse(nyTime().day + 'T12:00:00Z') - 864e5);
  for (let tries = 0; out.length < days && tries < days * 2; tries++, d = new Date(d.getTime() - 864e5)) {
    if ([0, 6].includes(d.getUTCDay())) continue;
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const [trf, cnms] = await Promise.all([finraDay('FNRA', ymd), finraDay('CNMS', ymd)]); // throws at once when FINRA is unreachable
    const t = trf?.get(symbol), c = cnms?.get(symbol);
    if (t || c) out.push({ day: d.toISOString().slice(0, 10), offExchange: t?.total ?? null, shortPct: c ? +(c.short / c.total * 100).toFixed(1) : null });
  }
  if (!out.length) throw bad('FINRA data was not available just now; try again later.', 503);
  out.reverse();
  const vols = out.map(x => x.offExchange).filter(Boolean), avg = vols.slice(0, -1).reduce((a, x) => a + x, 0) / Math.max(1, vols.length - 1);
  for (const x of out) x.spike = !!(x.offExchange && avg && x.offExchange > 1.8 * avg);
  return { symbol, days: out, avgOffExchange: Math.round(avg), latest: out.at(-1), note: 'Off-exchange volume is what dark pools and wholesalers report to FINRA each day (published the next morning); short % is the share of that volume sold short. It shows where volume traded, not who bought or sold.' };
}

// ---------- whale wallets ----------
export async function checkWhales(t = now()) {
  const { walletAmount } = await import('./money.js'), { notifyUser } = await import('./notify-user.js');
  let n = 0;
  for (const w of await all('SELECT * FROM whale_wallets')) {
    const bal = await walletAmount(w.chain, w.address).catch(() => null); if (bal == null) continue;
    const moved = w.balance != null && Math.abs(bal - w.balance) >= w.threshold;
    await run('UPDATE whale_wallets SET prev_balance = balance, balance = ?, checked_at = ?, moved_at = CASE WHEN ? THEN ? ELSE moved_at END WHERE id = ?', bal, t, moved ? 1 : 0, t, w.id);
    if (moved) { n++; await notifyUser(w.user_id, `Whale wallet ${w.label || w.address.slice(0, 10)} moved ${(bal - w.balance > 0 ? '+' : '')}${(bal - w.balance).toFixed(2)} ${w.chain.toUpperCase()} (now ${bal.toFixed(2)}).`).catch(() => {}); }
  }
  return n;
}

// ---------- plain-language questions ----------
export function route(q) {
  const t = String(q || ''), l = t.toLowerCase();
  const sym = ([...t.matchAll(/\$?\b([A-Z]{1,5})\b/g)].map(m => m[1]).find(s => !['AI', 'ETF', 'THE', 'AND', 'FOR', 'ON', 'IN', 'OF', 'A', 'I', 'US', 'CEO', 'EPS', 'OTM', 'ITM', 'IV'].includes(s))) || null;
  if (/whale|wallet|on-?chain/.test(l)) return { intent: 'whales' };
  if (/transcript|earnings call|conference call|summari[sz]e/.test(l)) return { intent: 'earnings', symbol: sym };
  if (/option|flow|sweep|calls?|puts?/.test(l)) return { intent: 'flow', symbol: sym };
  if (/dark ?pool|off-?exchange|short (volume|interest|sale)|block/.test(l)) return { intent: 'darkpool', symbol: sym };
  if (/13f|institution|fund|hedge fund|berkshire|holdings/.test(l)) return { intent: 'institutions', symbol: sym };
  return { intent: 'assistant', symbol: sym };
}

export const intelRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => res.json({ limits: aiLimits(req.user), summaries: await all('SELECT id, symbol, title, created_at FROM earnings_summaries WHERE user_id = ? ORDER BY id DESC LIMIT 30', req.user.id), whales: await all('SELECT * FROM whale_wallets WHERE user_id = ? ORDER BY id DESC', req.user.id) }));
  r.post('/earnings', async (req, res) => {
    const lim = aiLimits(req.user), text = String(req.body?.text || '');
    if (!lim.earningsSummaries) throw upgrade('AI earnings-call summaries', p => p.earningsSummaries > 0);
    if (text.length < 500) throw bad('Paste the transcript (at least a few paragraphs)');
    if (text.length > 600e3) throw bad('Up to about 600,000 characters (a very long call)');
    const left = await useQuota(req.user, 'earnings', lim.earningsSummaries, 'month', 'AI earnings-call summaries');
    const symbol = req.body.symbol ? ticker(req.body.symbol) : null, title = String(req.body.title || '').slice(0, 120);
    const s = await summarize(text, `${symbol || ''} ${title}`.trim());
    const id = Number((await run('INSERT INTO earnings_summaries (user_id, symbol, title, summary, created_at) VALUES (?,?,?,?,?)', req.user.id, symbol, title || null, JSON.stringify(s), now())).lastInsertRowid);
    res.json({ id, symbol, title, summary: s, left, words: text.split(/\s+/).length });
  });
  r.get('/earnings/:id', async (req, res) => { const s = await one('SELECT * FROM earnings_summaries WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!s) throw bad('Not found', 404); res.json({ ...s, summary: JSON.parse(s.summary) }); });
  r.get('/flow', async (req, res) => res.json(await optionsFlow(req.user, ticker(req.query.symbol))));
  r.get('/darkpool', async (req, res) => res.json(await darkPool(ticker(req.query.symbol))));
  r.post('/whales', async (req, res) => {
    const lim = aiLimits(req.user), b = req.body || {};
    if ((await one('SELECT COUNT(*) n FROM whale_wallets WHERE user_id = ?', req.user.id)).n >= lim.whales) throw upgrade(`Following more than ${lim.whales} whale wallets`, p => p.whales > lim.whales);
    const chain = b.chain === 'eth' ? 'eth' : 'btc', address = String(b.address || '').trim();
    if (chain === 'btc' ? !/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/.test(address) : !/^0x[a-fA-F0-9]{40}$/.test(address)) throw bad(`That is not a ${chain === 'btc' ? 'Bitcoin' : 'Ethereum'} address`);
    const threshold = Math.max(0.01, +b.threshold || (chain === 'btc' ? 100 : 1000));
    await run('INSERT OR IGNORE INTO whale_wallets (user_id, chain, address, label, threshold) VALUES (?,?,?,?,?)', req.user.id, chain, address, String(b.label || '').slice(0, 40) || null, threshold);
    const { walletAmount } = await import('./money.js'); const bal = await walletAmount(chain, address).catch(() => null);
    if (bal != null) await run('UPDATE whale_wallets SET balance = ?, checked_at = ? WHERE user_id = ? AND chain = ? AND address = ?', bal, now(), req.user.id, chain, address);
    res.json({ ok: true, balance: bal });
  });
  r.delete('/whales/:id', async (req, res) => { await run('DELETE FROM whale_wallets WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  r.post('/ask', async (req, res) => {
    const q = String(req.body?.q || '').slice(0, 500), rt = route(q);
    // A data source that is down (FINRA's files, the options feed) gives an answer, not an error.
    const tryIt = async f => { try { return { result: await f() }; } catch (e) { return { result: null, hint: e.message }; } };
    if (rt.intent === 'flow' && rt.symbol) return res.json({ ...rt, ...(await tryIt(() => optionsFlow(req.user, rt.symbol))) });
    if (rt.intent === 'darkpool' && rt.symbol) return res.json({ ...rt, ...(await tryIt(() => darkPool(rt.symbol))) });
    if (rt.intent === 'whales') return res.json({ ...rt, result: await all('SELECT * FROM whale_wallets WHERE user_id = ?', req.user.id) });
    res.json({ ...rt, result: null, hint: rt.intent === 'earnings' ? 'Paste the transcript in the Earnings calls box below.' : rt.intent === 'institutions' ? 'Institutional portfolios (13F) show what large funds own and changed.' : rt.symbol ? `Ask about ${rt.symbol} with "options flow", "dark pool" or "short volume", or ask the AI assistant.` : 'Add a ticker, for example "unusual options on NVDA" or "dark pool activity in AAPL".' });
  });
  return r;
})();
