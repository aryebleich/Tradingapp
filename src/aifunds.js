// AI long/short portfolios ("hedge-fund style", in the user's own account): the user picks a style
// and a risk level; every week the engine builds a book of longs and shorts (or an inverse-ETF hedge
// where the account cannot short), an AI writes a short memo on why, and the trades are placed:
// automatically on the practice account, and only after the user approves them on a real account.
// It is not a pooled fund: nobody else's money is in it, and it is the user's own choice of rules.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { getBars, lastPrice, accountSummary, placeOrder, ACCOUNT_IDS } from './brokers.js';
import { UNIVERSE } from './fundamentals.js';
import { leaders } from './invest.js';
import { llmEnabled, jsonCall } from './llm.js';
import { nyTime } from './time.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const r2 = (x, d = 2) => +(+x || 0).toFixed(d);
const ago = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

export const STYLES = {
  neutral: { name: 'Market neutral momentum', about: 'Long the strongest stocks, short the weakest, about the same amount each way: aims to earn the gap between winners and losers whichever way the market goes.' },
  hedged: { name: 'Leaders, hedged', about: 'Long the market leaders, with a smaller short (or inverse ETF) against the index to soften drops.' },
  trend: { name: 'All-weather trend', about: 'Stocks, bonds, gold, commodities and real estate funds: long what is in an uptrend, short (or hedge) what is in a downtrend.' },
};
// Gross long / short as a share of the account, by risk 1 (careful) to 5 (bold).
export const EXPOSURE = { 1: [0.5, 0.3], 2: [0.7, 0.4], 3: [0.9, 0.6], 4: [1.0, 0.8], 5: [1.2, 1.0] };
const TREND_ETFS = ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'IEF', 'GLD', 'DBC', 'VNQ'];

// The book for a style from price series: [{ symbol, weight }] with negative weights for shorts.
export function buildBook(style, risk, series, { canShort = true, names = 5 } = {}) {
  const [L, S] = EXPOSURE[risk] || EXPOSURE[3];
  const rows = leaders(series);
  const longs = [], shorts = [];
  if (style === 'trend') {
    const up = rows.filter(r => r.aboveAverages), down = rows.filter(r => !r.aboveAverages && r.rs != null && r.rs < 50);
    longs.push(...up.slice(0, names)); shorts.push(...down.slice(-names));
  } else {
    longs.push(...rows.filter(r => r.leader || r.rs >= 70).slice(0, names));
    shorts.push(...rows.filter(r => !r.aboveAverages && r.rs != null && r.rs <= 30).slice(-names));
  }
  const book = longs.map(r => ({ symbol: r.symbol, weight: r2(L / Math.max(1, longs.length), 4), why: `relative strength ${r.rs}${r.isNew ? ', new leader' : ''}` }));
  const shortTotal = style === 'hedged' ? S * 0.6 : S;
  if (shortTotal > 0) {
    if (canShort && shorts.length && style !== 'hedged') book.push(...shorts.map(r => ({ symbol: r.symbol, weight: -r2(shortTotal / shorts.length, 4), why: `weak: relative strength ${r.rs}, below its averages` })));
    else book.push({ symbol: 'SH', weight: r2(shortTotal, 4), why: canShort ? 'index hedge (inverse S&P 500 fund)' : 'index hedge: this account cannot sell short, so an inverse S&P 500 fund stands in' });
  }
  return book;
}
// Turns a book into whole-share (fractional on paper) target quantities.
export const targets = (book, equity, prices, fractional = true) => Object.fromEntries(book.filter(b => prices[b.symbol] > 0).map(b => { const q = equity * b.weight / prices[b.symbol]; return [b.symbol, fractional ? +q.toFixed(4) : Math.trunc(q)]; }));
// Trades that move the fund's holdings to the targets (sells first so cash is free for buys).
export function tradesFor(held, tgt) {
  const syms = new Set([...Object.keys(held), ...Object.keys(tgt)]), out = [];
  for (const s of syms) { const d = +((tgt[s] || 0) - (held[s] || 0)).toFixed(4); if (Math.abs(d) > 1e-4) out.push({ symbol: s, side: d > 0 ? 'buy' : 'sell', qty: Math.abs(d), short: d < 0 && (tgt[s] || 0) < 0 }); }
  return out.sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1));
}

async function seriesFor(style, userId) {
  const list = style === 'trend' ? TREND_ETFS : UNIVERSE.slice(0, 80), out = {};
  for (let i = 0; i < list.length; i += 10) await Promise.all(list.slice(i, i + 10).map(async s => { const b = await getBars(s, ago(560), userId).catch(() => null); if (b?.closes?.length > 260) out[s] = b.closes; }));
  return out;
}
async function memoFor(f, book) {
  const plain = `${STYLES[f.style].name}, risk ${f.risk} of 5. Longs: ${book.filter(b => b.weight > 0 && b.symbol !== 'SH').map(b => b.symbol).join(', ') || 'none'}. ${book.some(b => b.weight < 0) ? 'Shorts: ' + book.filter(b => b.weight < 0).map(b => b.symbol).join(', ') + '.' : book.some(b => b.symbol === 'SH') ? 'Hedge: SH (inverse S&P 500).' : ''}`;
  if (!llmEnabled()) return plain;
  try {
    const r = await jsonCall({ system: 'You write a 3-4 sentence plain-English memo for a rules-based long/short portfolio. Describe what the rules picked and the main risks. Never tell the reader to buy or sell, never promise returns.', user: JSON.stringify({ style: STYLES[f.style], risk: f.risk, book }), schema: { type: 'object', properties: { memo: { type: 'string' } }, required: ['memo'] }, maxTokens: 400 });
    return String(r.memo || plain).slice(0, 900);
  } catch { return plain; }
}
const parse = f => f && { ...f, book: JSON.parse(f.book || '[]'), held: JSON.parse(f.held || '{}'), pending: f.pending ? JSON.parse(f.pending) : null, active: !!f.active };

// One weekly turn: new book, memo, trades (placed on paper, waiting for approval on a real account).
export async function runFund(f, { force = false } = {}) {
  f = parse(f);
  const acct = await accountSummary(f.user_id, f.account);
  const canShort = f.account === 'paper' || acct.equity >= 2000;
  const series = await seriesFor(f.style, f.user_id);
  const book = buildBook(f.style, f.risk, series, { canShort });
  const prices = {}; await Promise.all(book.map(async b => { prices[b.symbol] = await lastPrice(b.symbol, f.user_id).catch(() => null); }));
  const capital = Math.min(acct.equity, f.capital || acct.equity);
  const tgt = targets(book, capital, prices, f.account === 'paper'), trades = tradesFor(f.held, tgt);
  // NAV: the old book's return since the last turn, at today's prices.
  let nav = f.nav || 100;
  if (f.book.length) { const r = f.book.reduce((t, b) => t + (b.entry && prices[b.symbol] ? b.weight * (prices[b.symbol] / b.entry - 1) : 0), 0); nav = r2(nav * (1 + r), 4); }
  const memo = await memoFor(f, book);
  const newBook = book.map(b => ({ ...b, entry: prices[b.symbol] }));
  if (f.account === 'paper') {
    const done = [];
    for (const t of trades) { try { await placeOrder(f.user_id, 'paper', { symbol: t.symbol, side: t.side, qty: t.qty, allowShort: true }, 'aifund'); done.push({ ...t, ok: true }); } catch (e) { done.push({ ...t, ok: false, error: e.message }); } }
    const held = { ...f.held }; for (const t of done.filter(x => x.ok)) held[t.symbol] = +((held[t.symbol] || 0) + (t.side === 'buy' ? t.qty : -t.qty)).toFixed(4);
    await run('UPDATE ai_funds SET book = ?, held = ?, nav = ?, memo = ?, last_run = ?, pending = NULL WHERE id = ?', JSON.stringify(newBook), JSON.stringify(held), nav, memo, now(), f.id);
    return { placed: done, memo, book: newBook, nav };
  }
  await run('UPDATE ai_funds SET pending = ?, nav = ?, memo = ?, last_run = ? WHERE id = ?', JSON.stringify({ trades, book: newBook, at: now() }), nav, memo, now(), f.id);
  return { pending: trades, memo, book: newBook, nav };
}
// Monday mornings after the open (New York), once a week per portfolio.
export async function runAiFunds(t = now()) {
  const n = nyTime(t); if (n.weekend || n.minutes < 600 || n.minutes > 900) return 0;
  let done = 0;
  for (const f of await all('SELECT * FROM ai_funds WHERE active = 1')) {
    if (f.last_run && t - f.last_run < 6.5 * 864e5) continue;
    try { await runFund(f); done++; } catch (e) { console.warn('ai fund', f.id, e.message); }
  }
  return done;
}

export const aiFundsRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const mine = async req => { const f = await one('SELECT * FROM ai_funds WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); if (!f) throw bad('Not found', 404); return f; };
  r.get('/', async (req, res) => res.json({ styles: STYLES, exposure: EXPOSURE, funds: (await all('SELECT * FROM ai_funds WHERE user_id = ? ORDER BY id', req.user.id)).map(parse) }));
  r.post('/', async (req, res) => {
    const b = req.body || {};
    if (!STYLES[b.style]) throw bad('Pick a style');
    const account = ACCOUNT_IDS.includes(b.account) ? b.account : 'paper', risk = Math.min(5, Math.max(1, Math.round(+b.risk || 3)));
    if ((await one('SELECT COUNT(*) n FROM ai_funds WHERE user_id = ?', req.user.id)).n >= 5) throw bad('Up to 5 portfolios');
    const id = Number((await run('INSERT INTO ai_funds (user_id, name, style, risk, account, capital, book, held, nav, active, created_at) VALUES (?,?,?,?,?,?,?,?,100,1,?)', req.user.id, String(b.name || STYLES[b.style].name).slice(0, 60), b.style, risk, account, Math.max(0, +b.capital || 0) || null, '[]', '{}', now())).lastInsertRowid);
    await audit(req.user.id, 'aifund_created', { id, style: b.style, account }, req.ip);
    res.json({ id });
  });
  r.post('/:id/run', async (req, res) => res.json(await runFund(await mine(req), { force: true })));
  // A real account: the user approves the waiting trades, then they are placed.
  r.post('/:id/approve', async (req, res) => {
    const f = parse(await mine(req)); if (!f.pending) throw bad('Nothing is waiting');
    const done = [], held = { ...f.held };
    for (const t of f.pending.trades) { try { await placeOrder(req.user.id, f.account, { symbol: t.symbol, side: t.side, qty: t.qty, allowShort: t.short }, 'aifund'); done.push({ ...t, ok: true }); held[t.symbol] = +((held[t.symbol] || 0) + (t.side === 'buy' ? t.qty : -t.qty)).toFixed(4); } catch (e) { done.push({ ...t, ok: false, error: e.message }); } }
    await run('UPDATE ai_funds SET book = ?, held = ?, pending = NULL WHERE id = ?', JSON.stringify(f.pending.book), JSON.stringify(held), f.id);
    await audit(req.user.id, 'aifund_approved', { id: f.id, trades: done.length }, req.ip);
    res.json({ placed: done });
  });
  r.put('/:id', async (req, res) => { const f = await mine(req); await run('UPDATE ai_funds SET active = ? WHERE id = ?', req.body?.active === false ? 0 : 1, f.id); res.json({ ok: true }); });
  r.delete('/:id', async (req, res) => { const f = await mine(req); await run('DELETE FROM ai_funds WHERE id = ?', f.id); res.json({ ok: true, note: 'The portfolio is removed; positions it opened stay in the account.' }); });
  return r;
})();
