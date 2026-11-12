// Optional features: each one is off until the user switches it on in Settings → Optional
// features. Nothing here places an order by itself except the family allowance, which the user
// sets up with an amount and a schedule. Every answer is information, not advice.
import express from 'express';
import { all, one, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { nyTime, stockSession, isCryptoSymbol } from './time.js';
import { realizedGains } from './tax.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const r2 = x => +(+x || 0).toFixed(2);
const usd = x => (x < 0 ? '-$' : '$') + Math.abs(+x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x, d = 1) => `${x > 0 ? '+' : ''}${(+x).toFixed(d)}%`;
const DAY = 864e5;
const SYM = /^[A-Z][A-Z0-9.\/-]{0,14}$/;

// key → [name, what it does, group]
export const EXTRAS = {
  myday: ['My day', 'A card on Home: what changed in your account since yesterday, in three sentences, with one next step.', 'Everyday'],
  statement: ['Monthly statement in plain words', 'On the 1st of each month, one short page by email (or text): what you have, what changed, no jargon.', 'Everyday'],
  voice: ['Voice commands', 'A microphone button in the header: say "open positions", "price of Apple" or ask the assistant a question.', 'Everyday'],
  goals: ['Goals in plain words', 'Type "I need $40,000 for a wedding in three years" and get a mix, a monthly amount and the chance of reaching it.', 'Everyday'],
  family: ['Family accounts', 'Children with their own goal and an allowance that is invested automatically from one of your accounts.', 'Everyday'],
  devil: ['A second opinion before every order', 'Before you confirm, see the case against the trade: what would have to be true for it to lose.', 'Before you trade'],
  coach: ['Behaviour coach', 'Learns your own patterns from your history (selling winners early, buying after a run) and warns you when you repeat one.', 'Before you trade'],
  taxticket: ['Tax-aware selling', 'Before you sell, see the tax on this exact sale and whether waiting or another lot is cheaper.', 'Before you trade'],
  replay: ['Mistake replay', 'For each losing trade: what you paid, how low it went, and what a stop would have saved.', 'Learn from your trades'],
  explain: ['Explain this move', 'Pick a day on any stock and see what most likely moved it: the market, the news, earnings.', 'Learn from your trades'],
  autopsy: ['Strategy autopsy', 'When a bot stops working: which market condition changed, and which of its rules is failing.', 'Learn from your trades'],
  promises: ['Earnings-call promise check', 'Compare this quarter\'s call with the last one and list the promises that were dropped.', 'Research'],
  crowd: ['Crowd check', 'Compare your mix, without names, with other members and see where you are unusually concentrated.', 'Research'],
  shailos: ['Questions for your rav', 'Flags holdings that commonly raise a question of ribbis or of the business itself, to ask a rav.', 'Research'],
};
export async function extrasFor(userId) {
  const s = await getSetting(userId, 'extras', null) || {};
  return Object.fromEntries(Object.keys(EXTRAS).map(k => [k, s[k] === true]));
}
const need = k => async (req, res, next) => ((await extrasFor(req.user.id))[k] ? next() : res.status(403).json({ error: `Switch on "${EXTRAS[k][0]}" in Settings first` }));

// ---------- data ----------
const acctId = a => (a === 'paper' || a === 'alpaca' || /^alpaca:\d{1,3}$/.test(a) || ['tradier', 'tastytrade', 'schwab', 'tradestation'].includes(a) ? a : 'paper');
const summary = async (userId, account) => (await import('./brokers.js')).accountSummary(userId, account);
const fillsOf = (userId, account) => all('SELECT symbol, side, qty, price, at FROM fills WHERE user_id = ? AND account = ? ORDER BY at', userId, account);
async function daily(symbol, days, userId) {
  const { dailyBars } = await import('./scripts.js');
  return (await dailyBars(symbol, days, userId).catch(() => null)) || [];
}
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const sma = (xs, n) => (xs.length >= n ? xs.slice(-n).reduce((s, x) => s + x, 0) / n : null);
function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let g = 0, l = 0;
  for (let i = closes.length - n; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const vol = closes => { const r = closes.slice(1).map((c, i) => Math.log(c / closes[i])); if (r.length < 5) return null; const m = r.reduce((s, x) => s + x, 0) / r.length; return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100; };

// ---------- My day ----------
export function myDay(a) {
  const prev = a.lastEquity || a.equity, chg = a.equity - prev, p = prev ? chg / prev * 100 : 0;
  const lines = [`Your account is worth ${usd(a.equity)}${prev && Math.abs(chg) >= 0.005 ? `, ${chg >= 0 ? 'up' : 'down'} ${usd(Math.abs(chg))} (${pct(p, 2)}) since yesterday` : ', the same as yesterday'}.`];
  const ps = [...(a.positions || [])].filter(x => x.value);
  if (ps.length) {
    const big = [...ps].sort((x, y) => Math.abs(y.pnl || 0) - Math.abs(x.pnl || 0))[0], top = [...ps].sort((x, y) => y.value - x.value)[0], w = a.equity ? top.value / a.equity * 100 : 0;
    lines.push(`You hold ${ps.length} position${ps.length === 1 ? '' : 's'}; ${big.symbol} matters most right now, ${big.pnl >= 0 ? 'ahead' : 'behind'} by ${usd(Math.abs(big.pnl || 0))} in total.`);
    lines.push(`${usd(a.cash)} is in cash (${a.equity ? Math.round(a.cash / a.equity * 100) : 0}% of the account)${w >= 35 ? `, and ${top.symbol} alone is ${Math.round(w)}% of it` : ''}.`);
    const next = w >= 35 ? [`${top.symbol} is a large share of your money. See what a fall in it would do.`, '#/riskview']
      : a.cash / (a.equity || 1) > 0.5 ? ['More than half is in cash. A regular plan puts it to work a little at a time.', '#/sp500']
        : Math.abs(p) >= 3 ? ['A big day either way is a good moment to look at the long-term view, not to act.', '#/longterm'] : ['Nothing needs doing today. Review your risk limits once in a while.', '#/risk'];
    return { lines, next: { text: next[0], href: next[1] } };
  }
  lines.push('You hold no positions yet.');
  lines.push(`${usd(a.cash)} is in cash, ready to use.`);
  return { lines, next: { text: 'Place a first small practice trade, or start a regular plan.', href: '#/trade' } };
}

// ---------- Mistake replay ----------
// rows: realized lots (tax.js); bars: { SYMBOL: [{t, l, c}] }. A stop sits `stopPct` under the buy.
export function replayTrades(rows, bars, stopPct = 8) {
  const out = [];
  for (const r of rows.filter(x => x.gain < 0 && !x.short)) {
    const buy = r.cost / r.qty, sell = r.proceeds / r.qty, b = (bars[r.symbol] || []).filter(x => x.t >= r.acquired - DAY && x.t <= r.sold + DAY);
    const low = b.length ? Math.min(...b.map(x => x.l ?? x.c)) : null, stop = buy * (1 - stopPct / 100);
    const hit = low != null && low <= stop && sell < stop, saved = hit ? r2((stop - sell) * r.qty) : 0;
    const high = b.length ? Math.max(...b.map(x => x.h ?? x.c)) : null;
    out.push({ symbol: r.symbol, qty: r.qty, bought: r.acquired, sold: r.sold, buy: r2(buy), sell: r2(sell), loss: r2(r.gain), lossPct: +((sell / buy - 1) * 100).toFixed(1), days: Math.max(1, Math.round((r.sold - r.acquired) / DAY)),
      low: low == null ? null : r2(low), high: high == null ? null : r2(high), wasAhead: high != null && high > buy * 1.03, stop: r2(stop), saved,
      lesson: hit ? `A stop ${stopPct}% under your price would have sold at ${usd(stop)} and saved ${usd(saved)}.` : high != null && high > buy * 1.03 ? `It was ahead by ${pct((high / buy - 1) * 100)} at its best. A trailing stop would have kept part of that.` : `The loss stayed inside ${stopPct}%: a stop would not have changed it. The entry is what to look at.` });
  }
  return out.sort((a, b) => a.loss - b.loss).slice(0, 40);
}

// ---------- Behaviour coach ----------
// Patterns in the user's own closed trades and buys. bars: { SYMBOL: [{t, c}] } (for "bought after a run").
export function habits(fills, bars = {}) {
  const lots = realizedGains(fills).filter(r => !r.short), out = [];
  const wins = lots.filter(r => r.gain > 0), losses = lots.filter(r => r.gain < 0), hold = r => (r.sold - r.acquired) / DAY, avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  if (wins.length >= 3 && losses.length >= 3) {
    const w = avg(wins.map(hold)), l = avg(losses.map(hold));
    if (l > w * 1.5 && l - w >= 2) out.push({ key: 'earlyWinners', side: 'sell', text: `You hold losing trades ${Math.round(l)} days on average but winning ones only ${Math.round(w)}: winners are sold early and losers are kept.` });
    const aw = avg(wins.map(r => r.gain)), al = Math.abs(avg(losses.map(r => r.gain)));
    if (al > aw * 1.5) out.push({ key: 'bigLosses', side: 'buy', text: `Your average loss (${usd(al)}) is larger than your average win (${usd(aw)}). A stop on each trade keeps one loss from undoing several wins.` });
  }
  const buys = fills.filter(f => f.side === 'buy');
  let chased = 0, checked = 0;
  for (const f of buys) {
    const b = (bars[f.symbol] || []).filter(x => x.t < f.at).slice(-4);
    if (b.length < 4) continue; checked++;
    if (b[1].c > b[0].c && b[2].c > b[1].c && b[3].c > b[2].c) chased++;
  }
  if (checked >= 5 && chased / checked >= 0.5) out.push({ key: 'chasing', side: 'buy', text: `${chased} of your last ${checked} buys came after three days of rising prices: you tend to buy after a run.` });
  const span = fills.length ? (fills.at(-1).at - fills[0].at) / (7 * DAY) : 0;
  if (fills.length >= 20 && span > 0 && fills.length / Math.max(span, 1) > 15) out.push({ key: 'overtrading', side: 'any', text: `You place about ${Math.round(fills.length / Math.max(span, 1))} trades a week. Every trade has a cost, even when the commission is zero.` });
  const rebuy = buys.filter(f => fills.some(s => s.side === 'sell' && s.symbol === f.symbol && s.at < f.at && f.at - s.at < 3 * DAY && s.price < f.price)).length;
  if (buys.length >= 6 && rebuy / buys.length >= 0.25) out.push({ key: 'rebuy', side: 'buy', text: `${rebuy} times you bought a stock back within three days of selling it, at a higher price.` });
  return { trades: lots.length, wins: wins.length, losses: losses.length, habits: out };
}

// ---------- Second opinion ----------
export function devilPoints({ symbol, side, dollars = 0, equity = 0, held = 0, closes = [], earningsSoon = false }) {
  const pts = [], last = closes.at(-1), buy = side !== 'sell';
  const s50 = sma(closes, 50), s200 = sma(closes, 200), r = rsi(closes), hi = closes.length ? Math.max(...closes.slice(-252)) : null, lo = closes.length ? Math.min(...closes.slice(-252)) : null, v = vol(closes.slice(-61));
  if (buy) {
    if (r != null && r >= 70) pts.push(`${symbol} has risen fast (RSI ${Math.round(r)}). Buyers who waited for a pause have often paid less.`);
    if (s200 && last < s200) pts.push(`The price is under its 200-day average: the longer trend is down, and a bounce can be short.`);
    if (hi && last >= hi * 0.98) pts.push(`It is at its high of the year. If this is the top of a range, the next move is down.`);
    if (closes.length >= 6 && last / closes.at(-6) - 1 >= 0.08) pts.push(`It is up ${pct((last / closes.at(-6) - 1) * 100)} in a week. Part of the good news is already in the price.`);
    if (equity && (held + dollars) / equity >= 0.25) pts.push(`After this order ${symbol} would be about ${Math.round((held + dollars) / equity * 100)}% of the account. One bad report would move everything you have.`);
    if (v != null && v >= 45) pts.push(`It swings a lot (about ${Math.round(v)}% a year). A normal week can take ${Math.round(v / 7)}% off it.`);
  } else {
    if (r != null && r <= 30) pts.push(`${symbol} has fallen fast (RSI ${Math.round(r)}). Selling after a sharp drop has often meant selling near a low.`);
    if (s200 && last > s200 && s50 && s50 > s200) pts.push(`The trend is still up (price and 50-day average above the 200-day). Sellers in an uptrend often buy back higher.`);
    if (lo && last <= lo * 1.03) pts.push(`It is near its low of the year. If nothing changed in the company, this may be the worst price to sell at.`);
  }
  if (earningsSoon) pts.push(`Earnings are due within days. The price can jump 5-10% either way overnight.`);
  if (!pts.length) pts.push(buy ? `Nothing stands out against it in the price. The risk left is the ordinary one: the market as a whole can fall, and ${symbol} with it.` : `Nothing stands out against selling in the price. The risk left is that it keeps rising without you.`);
  return pts.slice(0, 4);
}

// ---------- Tax-aware selling ----------
// lots: open long lots [{qty, price, at}] oldest first; rates { bracket, stateRate }.
export function taxOfSale(lots, qty, price, { bracket = 0.24, stateRate = 0.05 } = {}, t = Date.now()) {
  const lt = bracket <= 0.12 ? 0 : bracket <= 0.35 ? 0.15 : 0.20, rate = long => (long ? lt : bracket) + stateRate;
  const take = order => { let left = qty, tax = 0, gain = 0, st = 0; for (const l of order) { if (left <= 1e-9) break; const q = Math.min(left, l.qty), g = (price - l.price) * q, long = t - l.at > 365 * DAY; gain += g; tax += g * rate(long); if (!long) st += q; left -= q; } return { gain: r2(gain), tax: r2(tax), shortTermQty: +st.toFixed(6), covered: left <= 1e-9 }; };
  const fifo = take(lots), best = take([...lots].sort((a, b) => (price - a.price) * rate(t - a.at > 365 * DAY) - (price - b.price) * rate(t - b.at > 365 * DAY)));
  // Waiting: the day the newest lot used (first in, first out) turns long-term.
  let left = qty, wait = null;
  for (const l of lots) { if (left <= 1e-9) break; const q = Math.min(left, l.qty); left -= q; if (t - l.at <= 365 * DAY && price > l.price) wait = Math.max(wait || 0, l.at + 366 * DAY); }
  const later = wait ? take(lots.map(l => ({ ...l, at: l.at - (wait - t) }))) : null;
  return { gain: fifo.gain, tax: fifo.tax, shortTermQty: fifo.shortTermQty, covered: fifo.covered,
    cheaperLots: fifo.tax - best.tax >= 1 ? { tax: best.tax, saves: r2(fifo.tax - best.tax) } : null,
    wait: later && fifo.tax - later.tax >= 1 ? { until: wait, days: Math.ceil((wait - t) / DAY), tax: later.tax, saves: r2(fifo.tax - later.tax) } : null };
}
export function openLots(fills, symbol) {
  const book = [];
  for (const f of fills.filter(x => x.symbol === symbol)) {
    if (f.side === 'buy') book.push({ qty: +f.qty, price: +f.price, at: f.at });
    else { let left = +f.qty; while (left > 1e-9 && book.length) { const q = Math.min(left, book[0].qty); book[0].qty -= q; left -= q; if (book[0].qty <= 1e-9) book.shift(); } }
  }
  return book;
}

// ---------- Goals ----------
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, a: 1, an: 1 };
export function parseGoal(text) {
  const t = String(text || '').toLowerCase();
  const m = /\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?/.exec(t.replace(/(\d)\s+(?=\d{3}\b)/g, '$1'));
  if (!m) return null;
  const amount = +m[1].replace(/,/g, '') * ({ k: 1e3, thousand: 1e3, m: 1e6, million: 1e6 }[m[2]] || 1);
  const rest = t.slice(m.index + m[0].length);
  const y = /(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|a|an)\s*(?:and a half\s*)?(year|yr|month)/.exec(rest) || /(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|a|an)\s*(?:and a half\s*)?(year|yr|month)/.exec(t);
  const byYear = /\b(?:by|in)\s+(20\d\d)\b/.exec(t);
  let years = y ? (WORDS[y[1]] ?? +y[1]) / (y[2] === 'month' ? 12 : 1) : byYear ? Math.max(0.5, +byYear[1] - new Date().getFullYear()) : null;
  if (!(amount >= 100) || !(years > 0)) return null;
  years = Math.min(50, years);
  const what = /for (?:a |an |my |our |the )?([a-z][a-z' -]{2,40}?)(?:\s+(?:in|by|within)\b|[.,!?]|$)/.exec(t)?.[1]?.trim() || 'my goal';
  return { amount: Math.round(amount), years: +years.toFixed(2), what };
}
// Mix by time left; monthly amount at the mix's expected return; chance by a normal approximation.
const erf = x => { const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); };
export function goalPlan({ amount, years, saved = 0, monthly = null }) {
  const stocks = years <= 2 ? 10 : years <= 4 ? 30 : years <= 7 ? 50 : years <= 12 ? 70 : 85;
  const mu = (stocks * 0.07 + (100 - stocks) * 0.035) / 100, sd = (stocks * 0.16 + (100 - stocks) * 0.04) / 100, n = Math.round(years * 12), rm = mu / 12;
  const fvSaved = saved * (1 + rm) ** n, annuity = rm ? ((1 + rm) ** n - 1) / rm : n;
  const needed = Math.max(0, (amount - fvSaved) / annuity), pay = monthly ?? needed;
  const expected = fvSaved + pay * annuity, paid = saved + pay * n;
  // The invested part is uncertain; spread grows with time and with the share in stocks.
  const spread = Math.max(1, expected * sd * Math.sqrt(years) * 0.6);
  const chance = Math.round(Math.min(99, Math.max(1, 50 * (1 + erf((expected - amount) / (spread * Math.SQRT2))))));
  return { stocks, bonds: 100 - stocks, mix: stocks >= 70 ? [['VTI', Math.round(stocks * 0.7)], ['VXUS', stocks - Math.round(stocks * 0.7)], ['BND', 100 - stocks]] : [['VTI', stocks], ['BND', Math.round((100 - stocks) * 0.6)], ['SGOV', 100 - stocks - Math.round((100 - stocks) * 0.6)]],
    months: n, monthlyNeeded: Math.ceil(needed), monthly: Math.ceil(pay), expected: Math.round(expected), paidIn: Math.round(paid), chance, returnPct: +(mu * 100).toFixed(1) };
}

// ---------- Earnings-call promise check ----------
const PROMISE = /\b(we (?:will|expect|plan|intend|aim|are on track|remain on track|are committed|anticipate|target)|we'll|we're (?:going to|on track|targeting)|expect(?:s|ed)? to|plan(?:s|ned)? to|on track to|by (?:year[- ]end|the end of|q[1-4]|fiscal|20\d\d)|guidance|target of|goal of|launch(?:ing)? (?:in|by|next)|will (?:launch|open|reach|deliver|return|achieve|complete|expand|reduce|grow))\b/i;
const STOP = new Set('the a an and or of to in for on with at by from we our us is are was were be been will would should can could may might this that these those it its as than then also more most very new next last year quarter fiscal expect expects expected plan plans planned target targets goal goals track remain continue continues going about over under into per have has had not'.split(' '));
const keys = s => [...new Set(s.toLowerCase().replace(/[^a-z0-9%$. -]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w) && !/^\d+(\.\d+)?%?$/.test(w)))];
export function promiseCheck(prev, cur) {
  const sents = t => String(t || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"])/).map(s => s.trim()).filter(s => s.length >= 40 && s.length <= 400);
  const curText = String(cur || '').toLowerCase(), curWords = new Set(keys(curText));
  const out = [];
  for (const s of sents(prev)) {
    if (!PROMISE.test(s)) continue;
    const k = keys(s); if (k.length < 3) continue;
    const hit = k.filter(w => curWords.has(w)).length / k.length;
    out.push({ promise: s, mentioned: Math.round(hit * 100), status: hit >= 0.6 ? 'kept in view' : hit >= 0.35 ? 'mentioned less' : 'dropped' });
  }
  const order = { dropped: 0, 'mentioned less': 1, 'kept in view': 2 };
  return { promises: out.length, dropped: out.filter(o => o.status === 'dropped').length, list: out.sort((a, b) => order[a.status] - order[b.status] || a.mentioned - b.mentioned).slice(0, 30) };
}

// ---------- Strategy autopsy ----------
export function autopsyOf(kind, closes) {
  if (closes.length < 120) return { ok: false, text: 'Not enough price history to compare.' };
  const recent = closes.slice(-41), before = closes.slice(-252, -40), vNow = vol(recent), vWas = vol(before), last = closes.at(-1), s50 = sma(closes, 50), s200 = sma(closes, 200);
  const ret = (last / closes.at(-41) - 1) * 100, trendUp = s200 ? last > s200 && s50 > s200 : last > s50, range = (Math.max(...recent) - Math.min(...recent)) / last * 100;
  const changed = [], failing = [];
  if (vNow && vWas && vNow > vWas * 1.5) changed.push(`Prices swing ${Math.round(vNow / vWas * 100 - 100)}% more than they did over the past year.`);
  if (vNow && vWas && vNow < vWas * 0.6) changed.push(`Prices are much calmer than over the past year (swings down ${Math.round(100 - vNow / vWas * 100)}%).`);
  changed.push(trendUp ? `The trend is up (${pct(ret)} in two months).` : ret < -5 ? `The trend is down (${pct(ret)} in two months).` : `The price is going sideways (${pct(ret)} in two months, inside a ${Math.round(range)}% range).`);
  if (kind === 'grid') { if (Math.abs(ret) > 12) failing.push(`A grid earns when the price moves up and down inside its range. A one-way move of ${pct(ret)} carries it out of the range: it keeps ${ret < 0 ? 'buying on the way down' : 'selling early on the way up'}.`); if (vNow && vWas && vNow < vWas * 0.6) failing.push('In a calm market the price rarely crosses a grid level, so few trades complete.'); }
  if (kind === 'scalp') { if (!trendUp && ret < -5) failing.push('It buys small dips. In a falling market each dip is followed by a lower one, so the stop is hit before the target.'); if (vNow && vWas && vNow < vWas * 0.6) failing.push('The dips it waits for are not happening: the market is too calm for its entry.'); if (vNow && vWas && vNow > vWas * 1.5) failing.push('Swings are now wider than its stop, so normal noise takes it out of trades that would have worked.'); }
  if (kind === 'dca') { if (ret < -8) failing.push('Regular buying looks worst in a falling market: every purchase so far is under water. This is the plan working as designed, at lower prices.'); }
  if (kind === 'rule' || kind === 'trend') { if (Math.abs(ret) < 4 && range < 12) failing.push('Rules that follow a trend or wait for an extreme get false signals in a sideways market: entries reverse before they pay.'); if (vNow && vWas && vNow > vWas * 1.5) failing.push('With wider swings, its stop is hit by ordinary noise.'); if (!trendUp && ret < -5) failing.push('Its buy signals come in a downtrend, where bounces are short.'); }
  if (!failing.length) failing.push('Nothing in the market explains a change by itself. A short run of losses is normal for any rule; judge it over more trades.');
  return { ok: true, changed, failing, numbers: { twoMonths: +ret.toFixed(1), volNow: vNow && Math.round(vNow), volYear: vWas && Math.round(vWas), trendUp } };
}

// ---------- Questions for your rav ----------
// Holdings whose business is lending at interest, or which commonly raise a question. A list to
// ask about, never a ruling.
const RIBBIS = { banks: ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC', 'SCHW', 'COF', 'BK', 'STT', 'FITB', 'KEY', 'RF', 'HBAN', 'CFG', 'MTB', 'ZION', 'ALLY', 'SOFI', 'KRE', 'KBE', 'XLF', 'VFH'],
  lenders: ['AXP', 'DFS', 'SYF', 'UPST', 'LC', 'AFRM', 'OMF', 'NAVI', 'SLM', 'RKT', 'UWMC', 'NLY', 'AGNC', 'STWD', 'BXMT', 'ARCC', 'MAIN', 'FSK', 'OBDC'],
  bonds: ['BND', 'AGG', 'BNDX', 'LQD', 'HYG', 'JNK', 'TLT', 'IEF', 'SHY', 'SGOV', 'BIL', 'SHV', 'VCIT', 'VCSH', 'MUB', 'TIP', 'EMB', 'TMF', 'TBT'],
  insurers: ['BRK.B', 'PGR', 'ALL', 'TRV', 'MET', 'PRU', 'AIG', 'CB', 'AFL'] };
const WHY = { banks: 'A bank earns mostly by lending at interest. Whether owning its shares is a question of ribbis depends on who owns the bank and how you hold it.', lenders: 'This company\'s business is lending at interest.', bonds: 'A bond fund is a loan that pays interest. Government and corporate bonds are treated differently.', insurers: 'Insurers hold large bond portfolios and some lend directly.' };
export function shailos(positions) {
  const out = [];
  for (const p of positions) for (const [k, list] of Object.entries(RIBBIS)) if (list.includes(String(p.symbol).toUpperCase())) out.push({ symbol: p.symbol, value: r2(p.value), topic: k === 'bonds' ? 'Bonds' : k === 'banks' ? 'Banks' : k === 'lenders' ? 'Lenders' : 'Insurers', why: WHY[k] });
  return out;
}

// ---------- Crowd check ----------
export function shape(a) {
  const ps = (a.positions || []).filter(p => p.value > 0), eq = a.equity || 0;
  if (!(eq > 0)) return null;
  const top = ps.length ? Math.max(...ps.map(p => p.value)) / eq * 100 : 0;
  return { holdings: ps.length, top: +top.toFixed(1), cash: +(Math.max(0, a.cash) / eq * 100).toFixed(1), band: eq < 10000 ? 'under $10,000' : eq < 100000 ? '$10,000 to $100,000' : 'over $100,000' };
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
export function crowdCompare(me, others) {
  const peers = others.filter(o => o.band === me.band), use = peers.length >= 5 ? peers : others;
  if (use.length < 5) return { enough: false, members: others.length };
  const m = k => +median(use.map(o => o[k])).toFixed(1), notes = [];
  const med = { holdings: m('holdings'), top: m('top'), cash: m('cash') };
  if (me.top > Math.max(25, med.top * 1.8)) notes.push(`Your largest holding is ${me.top}% of your account; for members like you it is typically ${med.top}%.`);
  if (me.holdings > 0 && me.holdings < med.holdings / 2) notes.push(`You hold ${me.holdings} position${me.holdings === 1 ? '' : 's'}; members like you typically hold ${Math.round(med.holdings)}.`);
  if (me.cash > Math.max(40, med.cash * 2)) notes.push(`${me.cash}% of your account is in cash; typically it is ${med.cash}%.`);
  if (!notes.length) notes.push('Your mix is close to what members like you hold: nothing unusual.');
  return { enough: true, members: use.length, group: peers.length >= 5 ? me.band : 'all members', me, median: med, notes };
}

// ---------- Monthly statement ----------
export async function statementFor(userId, t = now()) {
  const { accountsFor } = await import('./ext/routes.js');
  const month = new Date(t - 5 * DAY).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' });
  const start = dayOf(t - 35 * DAY), lines = [`Your Brightolio statement for ${month}`, ''];
  for (const a of (await accountsFor(userId)).filter(x => x.connected)) {
    const s = await summary(userId, a.id).catch(() => null); if (!s) continue;
    const then = await one('SELECT equity FROM equity_history WHERE user_id = ? AND account = ? AND day >= ? ORDER BY day LIMIT 1', userId, a.id, start);
    const n = (await one('SELECT COUNT(*) n FROM fills WHERE user_id = ? AND account = ? AND at >= ?', userId, a.id, t - 31 * DAY))?.n || 0;
    const top = [...(s.positions || [])].sort((x, y) => y.value - x.value).slice(0, 3).map(p => `${p.symbol} ${usd(p.value)}`).join(', ');
    lines.push(`${a.id === 'paper' ? 'Practice account' : a.name}${a.live ? '' : ' (not real money)'}`, `  Worth now: ${usd(s.equity)}${then ? ` (${usd(s.equity - then.equity)} over the month, ${pct(then.equity ? (s.equity / then.equity - 1) * 100 : 0)})` : ''}`,
      `  In cash: ${usd(s.cash)}. Positions: ${(s.positions || []).length}${top ? ` (largest: ${top})` : ''}.`, `  Trades this month: ${n}.`, '');
  }
  lines.push('This is a summary of your own accounts, not advice. Your brokerage statement is the official record.');
  return lines.join('\n');
}
export async function runStatements(t = now()) {
  const n = nyTime(t);
  if (+n.day.slice(8, 10) !== 1 || n.minutes < 540) return 0; // the 1st, from 9 AM New York
  let sent = 0;
  for (const row of await all("SELECT user_id FROM user_settings WHERE k = 'extras'").catch(() => [])) {
    if (!(await extrasFor(row.user_id)).statement || await getSetting(row.user_id, 'statementSent', '') === n.day.slice(0, 7)) continue;
    await setSetting(row.user_id, 'statementSent', n.day.slice(0, 7));
    try { const { notifyUser } = await import('./notify-user.js'); await notifyUser(row.user_id, await statementFor(row.user_id, t)); sent++; } catch (e) { console.warn('statement', row.user_id, e.message); }
  }
  return sent;
}

// ---------- Family accounts ----------
export async function familyFor(userId) {
  const kids = await all('SELECT * FROM family_members WHERE user_id = ? ORDER BY id', userId), out = [];
  const { lastPrice } = await import('./brokers.js');
  for (const k of kids) {
    const lots = await all('SELECT symbol, SUM(qty) qty, SUM(qty * price) cost FROM family_ledger WHERE member_id = ? GROUP BY symbol', k.id);
    let value = 0, cost = 0;
    for (const l of lots) { const px = await lastPrice(l.symbol, userId).catch(() => l.cost / l.qty); value += l.qty * px; cost += l.cost; }
    out.push({ id: k.id, name: k.name, born: k.born, goal: k.goal, symbol: k.symbol, amount: k.amount, everyDays: k.every_days, account: k.account, active: !!k.active, nextAt: k.next_at, value: r2(value), paidIn: r2(cost), gain: r2(value - cost) });
  }
  return out;
}
export async function runFamily(t = now()) {
  let done = 0;
  for (const k of await all('SELECT * FROM family_members WHERE active = 1 AND next_at <= ?', t)) {
    if (!(await extrasFor(k.user_id)).family) continue;
    if (!isCryptoSymbol(k.symbol) && !stockSession(t)) continue; // stocks and funds: during the session
    await run('UPDATE family_members SET next_at = ? WHERE id = ?', t + k.every_days * DAY, k.id); // claimed first: never twice
    try {
      const { placeOrder } = await import('./brokers.js');
      const r = await placeOrder(k.user_id, k.account, { symbol: k.symbol, side: 'buy', notional: k.amount }, 'family');
      const price = +r.price || +r.fillPrice || 0, qty = +r.qty || (price ? k.amount / price : 0);
      if (qty > 0 && price > 0) await run('INSERT INTO family_ledger (member_id, user_id, symbol, qty, price, at) VALUES (?,?,?,?,?,?)', k.id, k.user_id, k.symbol, qty, price, t);
      await audit(k.user_id, 'family_allowance', { member: k.id, symbol: k.symbol, amount: k.amount });
      done++;
    } catch (e) { console.warn('family', k.id, e.message); }
  }
  return done;
}

// ---------- routes ----------
export const extrasRouter = (() => {
  const r = express.Router();
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(e.status || 400).json({ error: e.message }));
  r.use(requireUser);
  r.get('/', wrap(async (req, res) => res.json({ on: await extrasFor(req.user.id), list: Object.entries(EXTRAS).map(([k, [name, what, group]]) => ({ key: k, name, what, group })) })));
  r.put('/', wrap(async (req, res) => {
    const cur = await extrasFor(req.user.id), b = req.body?.on || {};
    const next = Object.fromEntries(Object.keys(EXTRAS).map(k => [k, k in b ? b[k] === true : cur[k]]));
    await setSetting(req.user.id, 'extras', next);
    res.json({ on: next });
  }));

  r.get('/myday', need('myday'), wrap(async (req, res) => res.json(myDay(await summary(req.user.id, acctId(req.query.account))))));

  r.get('/replay', need('replay'), wrap(async (req, res) => {
    const account = acctId(req.query.account), rows = realizedGains(await fillsOf(req.user.id, account)).filter(x => x.gain < 0 && !x.short).sort((a, b) => a.gain - b.gain).slice(0, 40), bars = {};
    for (const s of [...new Set(rows.map(x => x.symbol))].slice(0, 25)) bars[s] = await daily(s, 800, req.user.id);
    res.json({ account, trades: replayTrades(rows, bars, Math.min(30, Math.max(2, +req.query.stop || 8))) });
  }));

  const habitsOf = async (userId, account) => {
    const fills = await fillsOf(userId, account), bars = {};
    for (const s of [...new Set(fills.filter(f => f.side === 'buy').slice(-30).map(f => f.symbol))].slice(0, 15)) bars[s] = await daily(s, 400, userId);
    return habits(fills, bars);
  };
  r.get('/coach', need('coach'), wrap(async (req, res) => res.json(await habitsOf(req.user.id, acctId(req.query.account)))));

  // Before an order: whatever the user switched on, in one answer.
  r.post('/before-order', wrap(async (req, res) => {
    const on = await extrasFor(req.user.id), b = req.body || {}, account = acctId(b.account), symbol = String(b.symbol || '').toUpperCase(), side = b.side === 'sell' ? 'sell' : 'buy';
    if (!SYM.test(symbol) || !(on.devil || on.coach || on.taxticket)) return res.json({});
    const out = {}, a = await summary(req.user.id, account).catch(() => null), held = a?.positions?.find(p => p.symbol === symbol);
    const bars = on.devil ? await daily(symbol, 420, req.user.id) : [], last = bars.at(-1)?.c || held?.price || 0;
    const qty = +b.qty > 0 ? +b.qty : +b.notional > 0 && last ? +b.notional / last : 0, dollars = +b.notional > 0 ? +b.notional : qty * last;
    if (on.devil) out.devil = devilPoints({ symbol, side, dollars, equity: a?.equity || 0, held: held?.value || 0, closes: bars.map(x => x.c) });
    if (on.coach) { const h = await habitsOf(req.user.id, account).catch(() => ({ habits: [] })); out.coach = h.habits.filter(x => x.side === side || x.side === 'any').map(x => x.text).slice(0, 2); }
    if (on.taxticket && side === 'sell' && qty > 0 && last > 0) {
      const lots = openLots(await fillsOf(req.user.id, account), symbol);
      if (lots.length) { const t = taxOfSale(lots, qty, +b.limit_price > 0 ? +b.limit_price : last, { bracket: req.user.tax_bracket ?? 0.24, stateRate: req.user.state_tax ?? 0.05 }); if (t.covered) out.tax = t; }
    }
    res.json(out);
  }));

  r.get('/explain', need('explain'), wrap(async (req, res) => {
    const symbol = String(req.query.symbol || '').toUpperCase(); if (!SYM.test(symbol)) throw bad('Type a symbol');
    const [b, spy] = await Promise.all([daily(symbol, 400, req.user.id), daily('SPY', 400, req.user.id)]);
    if (b.length < 30) return res.json({ symbol, empty: `There is no price history for ${symbol} right now.` });
    const moves = b.slice(1).map((x, i) => ({ day: dayOf(x.t), t: x.t, pct: +((x.c / b[i].c - 1) * 100).toFixed(2), close: x.c, volume: x.v, avgVol: sma(b.slice(Math.max(0, i - 19), i + 1).map(y => y.v || 0), Math.min(20, i + 1)) }));
    const pick = req.query.day ? moves.find(m => m.day === req.query.day) || moves.filter(m => m.day <= req.query.day).at(-1) : [...moves.slice(-60)].sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct))[0];
    if (!pick) return res.json({ symbol, empty: 'No trading day was found for that date.' });
    const mk = spy.findIndex(x => dayOf(x.t) === pick.day), market = mk > 0 ? +((spy[mk].c / spy[mk - 1].c - 1) * 100).toFixed(2) : null;
    const typical = Math.sqrt(moves.slice(-120).reduce((s, m) => s + m.pct ** 2, 0) / Math.min(120, moves.length)), causes = [];
    if (market != null && Math.sign(market) === Math.sign(pick.pct) && Math.abs(market) >= 1) causes.push(`The whole market moved ${pct(market, 2)} that day, which explains about ${Math.min(100, Math.round(Math.abs(market) / Math.abs(pick.pct) * 100))}% of it.`);
    else if (market != null) causes.push(`The market moved only ${pct(market, 2)}: this was about ${symbol} itself.`);
    if (pick.volume && pick.avgVol && pick.volume > pick.avgVol * 1.8) causes.push(`Trading was ${(pick.volume / pick.avgVol).toFixed(1)} times the usual volume: a sign of news, a report or a large holder acting.`);
    let news = [];
    try { const D = await import('./alpaca/data.js'); if (D.dataEnabled()) news = ((await D.news({ symbols: symbol, limit: 8, start: new Date(pick.t - 2 * DAY).toISOString(), end: new Date(pick.t + DAY).toISOString() })) || []).map(n => ({ headline: n.headline, source: n.source, url: n.url, at: n.created_at })).slice(0, 6); } catch {}
    if (news.some(n => /earnings|results|quarter|guidance|revenue|eps/i.test(n.headline))) causes.push('Headlines that day were about earnings or guidance.');
    if (!news.length) causes.push('No headlines were found for that day. Check the company\'s filings for a report or announcement.');
    res.json({ symbol, day: pick.day, pct: pick.pct, close: r2(pick.close), market, unusual: +(Math.abs(pick.pct) / (typical || 1)).toFixed(1), causes, news, biggest: [...moves.slice(-60)].sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct)).slice(0, 6).map(m => ({ day: m.day, pct: m.pct })) });
  }));

  r.get('/autopsy', need('autopsy'), wrap(async (req, res) => {
    const bots = await all('SELECT id, kind, name, symbol, active FROM ai_bots WHERE user_id = ? ORDER BY id DESC LIMIT 30', req.user.id).catch(() => []), out = [];
    for (const b of bots) out.push({ id: b.id, name: b.name, kind: b.kind, symbol: b.symbol, active: !!b.active, ...autopsyOf(b.kind, (await daily(b.symbol, 400, req.user.id)).map(x => x.c)) });
    res.json({ bots: out });
  }));
  r.post('/autopsy', need('autopsy'), wrap(async (req, res) => {
    const symbol = String(req.body?.symbol || '').toUpperCase(), kind = ['dca', 'grid', 'scalp', 'rule', 'trend'].includes(req.body?.kind) ? req.body.kind : 'rule';
    if (!SYM.test(symbol)) throw bad('Type a symbol');
    res.json({ symbol, kind, ...autopsyOf(kind, (await daily(symbol, 400, req.user.id)).map(x => x.c)) });
  }));

  r.post('/promises', need('promises'), wrap(async (req, res) => {
    const prev = String(req.body?.previous || ''), cur = String(req.body?.current || '');
    if (prev.length < 400 || cur.length < 400) throw bad('Paste both calls: the earlier one and the latest one');
    if (prev.length + cur.length > 1.2e6) throw bad('The two calls together are limited to about 1 MB of text');
    res.json(promiseCheck(prev, cur));
  }));

  r.get('/goals', need('goals'), wrap(async (req, res) => res.json({ goals: (await getSetting(req.user.id, 'goals', [])).map(g => ({ ...g, plan: goalPlan(g) })) })));
  r.post('/goals/plan', need('goals'), wrap(async (req, res) => {
    const g = parseGoal(req.body?.text); if (!g) throw bad('Say the amount and when, for example: I need $40,000 for a wedding in three years');
    const saved = Math.max(0, +req.body?.saved || 0);
    res.json({ ...g, saved, plan: goalPlan({ ...g, saved }) });
  }));
  r.post('/goals', need('goals'), wrap(async (req, res) => {
    const b = req.body || {}, amount = +b.amount, years = +b.years;
    if (!(amount >= 100 && amount <= 1e9) || !(years > 0 && years <= 50)) throw bad('Give an amount and the number of years');
    const list = await getSetting(req.user.id, 'goals', []);
    if (list.length >= 12) throw bad('You can keep up to 12 goals');
    list.push({ id: Date.now(), what: String(b.what || 'My goal').slice(0, 60), amount: Math.round(amount), years, saved: Math.max(0, +b.saved || 0), monthly: +b.monthly > 0 ? Math.round(+b.monthly) : null, at: now() });
    await setSetting(req.user.id, 'goals', list); res.json({ ok: true });
  }));
  r.delete('/goals/:id', need('goals'), wrap(async (req, res) => { await setSetting(req.user.id, 'goals', (await getSetting(req.user.id, 'goals', [])).filter(g => String(g.id) !== req.params.id)); res.json({ ok: true }); }));

  r.get('/crowd', need('crowd'), wrap(async (req, res) => {
    const me = shape(await summary(req.user.id, acctId(req.query.account))); if (!me) throw bad('This account has no value to compare');
    await setSetting(req.user.id, 'crowdShape', { ...me, at: now() });
    const others = (await all("SELECT user_id, v FROM user_settings WHERE k = 'crowdShape' AND user_id != ?", req.user.id).catch(() => [])).map(x => { try { return JSON.parse(x.v); } catch { return null; } }).filter(x => x && now() - x.at < 60 * DAY);
    res.json(crowdCompare(me, others));
  }));

  r.get('/shailos', need('shailos'), wrap(async (req, res) => {
    const a = await summary(req.user.id, acctId(req.query.account)), list = shailos(a.positions || []), block = await (await import('./values.js')).shabbosBlock(req.user.id).catch(() => null);
    res.json({ list, shabbosOn: !!(await getSetting(req.user.id, 'values', null))?.shabbos, restingNow: !!block });
  }));

  r.get('/statement', need('statement'), wrap(async (req, res) => res.json({ text: await statementFor(req.user.id) })));
  r.post('/statement/send', need('statement'), wrap(async (req, res) => { const { notifyUser } = await import('./notify-user.js'); await notifyUser(req.user.id, await statementFor(req.user.id)); res.json({ ok: true }); }));

  r.get('/family', need('family'), wrap(async (req, res) => res.json({ members: await familyFor(req.user.id) })));
  r.post('/family', need('family'), wrap(async (req, res) => {
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 40), symbol = String(b.symbol || 'VTI').toUpperCase(), amount = +b.amount, every = Math.round(+b.everyDays || 7);
    if (!name) throw bad('Give the child\'s name');
    if (!SYM.test(symbol)) throw bad('Give a valid symbol');
    if (!(amount >= 1 && amount <= 10000)) throw bad('The allowance must be between $1 and $10,000');
    if (![7, 14, 30].includes(every)) throw bad('Choose weekly, every two weeks or monthly');
    if ((await one('SELECT COUNT(*) n FROM family_members WHERE user_id = ?', req.user.id)).n >= 12) throw bad('Up to 12 family members');
    await run('INSERT INTO family_members (user_id, name, born, goal, symbol, amount, every_days, account, active, next_at, created_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)', req.user.id, name, +b.born || null, String(b.goal || '').slice(0, 80), symbol, r2(amount), every, acctId(b.account), now(), now());
    res.json({ ok: true });
  }));
  r.put('/family/:id', need('family'), wrap(async (req, res) => { await run('UPDATE family_members SET active = ? WHERE id = ? AND user_id = ?', req.body?.active ? 1 : 0, +req.params.id, req.user.id); res.json({ ok: true }); }));
  r.delete('/family/:id', need('family'), wrap(async (req, res) => { await run('DELETE FROM family_ledger WHERE member_id = ? AND user_id = ?', +req.params.id, req.user.id); await run('DELETE FROM family_members WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); }));
  return r;
})();
